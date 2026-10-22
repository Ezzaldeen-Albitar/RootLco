import { describe, expect, it, vi } from 'vitest';
import {
  InventorySalesReturnService,
  exceedsReturnCeiling,
} from '@api/modules/inventory/application/inventory-sales-return-service';
import type { InventoryRepository } from '@api/modules/inventory/data/inventory-repository';
import type { InventoryStockService } from '@api/modules/inventory/application/inventory-stock-service';
import type { DbHandle } from '@api/server/db/transaction';

/**
 * A customer return of more than may still come back names its rule against the
 * quantity box (DX-1, finance QA fixes E).
 *
 * The refusal used to be a bare `ERR-TRN-001` with no safe details, so the return
 * form could only show its form-level sentence: the box was not marked, focus did
 * not move, and the sentence stayed after the quantity was corrected. It now
 * carries `stock_return_exceeds_remaining` at `body.quantity`, which the web
 * files under the quantity control. The same refusal arrives from two places —
 * the service's own pre-check and the ceiling trigger under the source lock, when
 * two tills race the last unit — and both are named the same way.
 *
 * No database: the repository and the stock service are stand-ins, so what is
 * observed is exactly what the service decides. The end-to-end proof through the
 * route is in `tests/backend/p1-32-sales-returns.test.ts`.
 */

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const SOURCE = '33333333-3333-4333-8333-333333333333';
const LOCATION = '44444444-4444-4444-8444-444444444444';

function serviceWith(options: {
  readonly remaining: string;
  readonly receive?: () => Promise<string>;
}) {
  const receiveSalesReturn = vi.fn(options.receive ?? (async () => 'return-1'));
  const repository = {
    readReturnableQuantity: vi.fn(async () => ({
      companyId: COMPANY,
      branchId: BRANCH,
      itemId: 'item-1',
      sourceQuantity: '5.000',
      returnedQuantity: '0.000',
      remainingQuantity: options.remaining,
    })),
    readSalesReturnByIdempotencyKey: vi.fn(async () => null),
    receiveSalesReturn,
  } as unknown as InventoryRepository;
  const stock = {
    requireLocation: vi.fn(async () => undefined),
  } as unknown as InventoryStockService;
  return { service: new InventorySalesReturnService(repository, stock), receiveSalesReturn };
}

const offer = (quantity: string) => ({
  sourceKind: 'invoice_line',
  sourceId: SOURCE,
  quantity,
  condition: 'restockable',
  receivedLocationId: LOCATION,
});

const db = {} as DbHandle;
const authorize = async (): Promise<void> => undefined;

async function refusalOf(promise: Promise<unknown>): Promise<Record<string, unknown>> {
  try {
    await promise;
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error('the return was not refused');
}

/** A driver error the way `pg` raises one. */
function databaseRefusal(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: '23514' });
}

describe('a return of more than may still come back', () => {
  it('names its rule against the quantity box, and writes nothing', async () => {
    const { service, receiveSalesReturn } = serviceWith({ remaining: '1.000' });
    const failure = await refusalOf(service.receive(db, offer('5'), authorize));
    expect(failure['code']).toBe('ERR-TRN-001');
    expect(failure['safeDetails']).toEqual({
      violations: [{ path: 'body.quantity', rule: 'stock_return_exceeds_remaining' }],
    });
    expect(receiveSalesReturn).not.toHaveBeenCalled();
  });

  it('accepts exactly what remains', async () => {
    const { service, receiveSalesReturn } = serviceWith({
      remaining: '1.000',
      // The write is reached; what happens after it is not this file's question.
      receive: async () => {
        throw databaseRefusal('stop here');
      },
    });
    await refusalOf(service.receive(db, offer('1.000'), authorize));
    expect(receiveSalesReturn).toHaveBeenCalledTimes(1);
  });

  it('names the ceiling trigger refusal of a racing till the same way', async () => {
    const { service } = serviceWith({
      remaining: '5.000',
      receive: async () => {
        throw databaseRefusal(
          'inv.sales_returns: returning 2.000 would exceed the 5.000 that left (4.000 already returned)'
        );
      },
    });
    const failure = await refusalOf(service.receive(db, offer('2'), authorize));
    expect(failure['code']).toBe('ERR-TRN-001');
    expect(failure['safeDetails']).toEqual({
      violations: [{ path: 'body.quantity', rule: 'stock_return_exceeds_remaining' }],
    });
  });

  it('leaves the guard refusals the quantity box cannot fix unnamed', async () => {
    const { service } = serviceWith({
      remaining: '5.000',
      receive: async () => {
        throw databaseRefusal(
          'inv.sales_returns: a return is received in the branch that sold or issued the part'
        );
      },
    });
    const failure = await refusalOf(service.receive(db, offer('2'), authorize));
    expect(failure['code']).toBe('ERR-TRN-001');
    expect(failure['safeDetails']).toEqual({});
  });
});

describe('exceedsReturnCeiling', () => {
  it('recognises only the quantity refusal of the ceiling guard', () => {
    expect(
      exceedsReturnCeiling(
        databaseRefusal('inv.sales_returns: returning 1 would exceed the 1 that left (1 already)')
      )
    ).toBe(true);
    expect(
      exceedsReturnCeiling(databaseRefusal('inv.sales_returns: the return names item a but b'))
    ).toBe(false);
    // The same words under another SQLSTATE are not the guard.
    expect(
      exceedsReturnCeiling(
        Object.assign(new Error('inv.sales_returns: returning 1 would exceed'), { code: '23505' })
      )
    ).toBe(false);
    expect(exceedsReturnCeiling(null)).toBe(false);
  });
});
