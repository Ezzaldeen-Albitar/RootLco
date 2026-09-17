/**
 * P1-32 preparatory slice 2 — returns with a condition and a credit, end to end
 * through their route handlers (P1-32-PRE-112…116).
 *
 * Every assertion counts a side effect — a balance, a movement, a credit note, an
 * audit row — because a status alone cannot tell a return that restocked a part
 * from one that did nothing. The properties this suite exists to hold:
 *
 *  - a restockable return goes back into the cell it is received in; a damaged one
 *    goes into quarantine and stays out of sellable availability;
 *  - a return against an issued counter sale raises exactly ONE pending credit note,
 *    for the returned share of that line, and links it;
 *  - a return against a part issue raises none;
 *  - the ceiling counts `inv.part_returns` as well, so the two return paths cannot
 *    each spend the same issued quantity;
 *  - a doubled scan under one Idempotency-Key receives the part once;
 *  - the operation needs BOTH `inv.stock.operate` and `sal.finance.view`, and a
 *    caller that holds them in another branch — or in another tenant — is answered
 *    "not found", because the source it names is hidden from it by RLS before any
 *    authority is consulted.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   inv.sales-return-create: route service authorization success denial cross-tenant audit idempotency isolation
 *   inv.sales-return-list: route service authorization success isolation
 *   inv.returnable-quantity-read: route service authorization success cross-tenant isolation
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  USER_A,
} from './helpers';
import { createOpenWorkOrder, establishP1_19Fixtures, PARTNER_A } from './p1-19-helpers';
import {
  INV_COUNTER,
  INV_COUNTER_SCOPED_A2,
  INV_FULL,
  INV_TENANT_B_COUNTER,
  ITEM_A,
  QUARANTINE_A1,
  auditCountFor,
  authAs,
  cleanP1_21Fixtures,
  countRowsOf,
  establishP1_21Fixtures,
  freshLocation,
  seedStock,
} from './p1-21-helpers';
import { POST as SALE_PRICE_SET } from '@/app/api/v1/items/[itemId]/sale-prices/route';
import { POST as COUNTER_SALE_CREATE } from '@/app/api/v1/counter-sales/route';
import { POST as ISSUE_INVOICE } from '@/app/api/v1/invoices/[invoiceId]/issuance/route';
import { POST as ISSUE_PART } from '@/app/api/v1/stock-issues/route';
import { POST as RETURN_PART } from '@/app/api/v1/stock-returns/route';
import {
  GET as SALES_RETURN_LIST,
  POST as SALES_RETURN_CREATE,
} from '@/app/api/v1/sales-returns/route';
import { GET as RETURNABLE } from '@/app/api/v1/returnable-quantities/route';

let admin: Pool;

type ParamHandler<P> = (request: Request, route: { params: Promise<P> }) => Promise<Response>;

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const post = (
  handler: (request: Request) => Promise<Response>,
  path: string,
  body: unknown,
  key: string = randomUUID()
): Promise<Response> =>
  handler(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    })
  );

const receiveReturn = (body: unknown, key?: string): Promise<Response> =>
  post(SALES_RETURN_CREATE, '/api/v1/sales-returns', body, key);

const listReturns = (query: string): Promise<Response> =>
  SALES_RETURN_LIST(new Request(`http://localhost/api/v1/sales-returns?${query}`));

const readReturnable = (sourceKind: string, sourceId: string): Promise<Response> =>
  RETURNABLE(
    new Request(
      `http://localhost/api/v1/returnable-quantities?sourceKind=${sourceKind}&sourceId=${sourceId}`
    )
  );

interface ReturnBody {
  readonly id: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly itemId: string;
  readonly quantity: string;
  readonly condition: string;
  readonly receivedLocationId: string;
  readonly quarantineLocationId: string | null;
  readonly creditNoteId: string | null;
  readonly status: string;
  readonly recordVersion: number;
  readonly replayed: boolean;
}

interface ReturnableBody {
  readonly sourceQuantity: string;
  readonly returnedQuantity: string;
  readonly remainingQuantity: string;
}

const onHandOf = (itemId: string, locationId: string): Promise<number> =>
  countRowsOf(
    `SELECT COALESCE(sum(on_hand_qty), 0)::text AS n FROM inv.stock_balances
      WHERE tenant_id = $1 AND item_id = $2 AND location_id = $3`,
    [TENANT_A, itemId, locationId]
  );

const returnMovementsOf = (returnId: string): Promise<number> =>
  countRowsOf(
    `SELECT count(*)::text AS n FROM inv.stock_movements
      WHERE tenant_id = $1 AND reference_kind = 'sales_return' AND reference_id = $2`,
    [TENANT_A, returnId]
  );

/** A counter sale, issued, with its stock already off the shelf. */
async function issuedSale(
  cell: string,
  quantity: string,
  unitPrice = '20.0000'
): Promise<{ readonly invoiceId: string; readonly lineId: string }> {
  authAs(INV_COUNTER);
  await (SALE_PRICE_SET as ParamHandler<{ itemId: string }>)(
    new Request(`http://localhost/api/v1/items/${ITEM_A}/sale-prices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        currencyCode: 'USD',
        unitPrice,
      }),
    }),
    { params: Promise.resolve({ itemId: ITEM_A }) }
  );
  const sale = await bodyOf<{
    invoice: { id: string };
    lines: readonly { id: string }[];
    recordVersion: number;
  }>(
    await post(COUNTER_SALE_CREATE, '/api/v1/counter-sales', {
      companyId: COMPANY_A1,
      branchId: BRANCH_A1,
      customerPartnerId: PARTNER_A,
      lines: [{ itemId: ITEM_A, locationId: cell, quantity }],
    })
  );
  await (ISSUE_INVOICE as ParamHandler<{ invoiceId: string }>)(
    new Request(`http://localhost/api/v1/invoices/${sale.invoice.id}/issuance`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        'if-match': String(sale.recordVersion),
      },
    }),
    { params: Promise.resolve({ invoiceId: sale.invoice.id }) }
  );
  return { invoiceId: sale.invoice.id, lineId: sale.lines[0]?.id ?? '' };
}

/** A part issued to a work order, so a `part_issue` source exists. */
async function issuedPart(cell: string, quantity: string): Promise<string> {
  // `open` is the first state that accepts parts (`assertWorkOrderAcceptsParts`).
  const workOrder = await createOpenWorkOrder();
  authAs(INV_COUNTER);
  const issue = await bodyOf<{ id: string }>(
    await post(ISSUE_PART, '/api/v1/stock-issues', {
      workOrderId: workOrder.workOrderId,
      itemId: ITEM_A,
      locationId: cell,
      quantity,
    })
  );
  return issue.id;
}

async function provisionInvoiceSequence(): Promise<void> {
  await admin.query(
    `INSERT INTO shared.number_sequences
       (tenant_id, company_id, branch_id, sequence_code, prefix_template, next_value,
        pad_width, period_reset_rule, created_by)
     VALUES ($1,$2,$3,'invoice','ODSR-',1,6,'never',$4)
     ON CONFLICT (tenant_id, sequence_code, company_id, branch_id) DO NOTHING`,
    [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  await establishP1_21Fixtures(admin);
  await provisionInvoiceSequence();
}, 180_000);

afterAll(async () => {
  await cleanP1_21Fixtures();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('inv.sales-return-create', () => {
  it('restocks a returned sale, credits the customer once, and audits the receipt', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '10' });
    const sale = await issuedSale(cell, '4');
    expect(await onHandOf(ITEM_A, cell)).toBe(6);

    authAs(INV_COUNTER);
    const response = await receiveReturn({
      sourceKind: 'invoice_line',
      sourceId: sale.lineId,
      quantity: '1',
      condition: 'restockable',
      receivedLocationId: cell,
      reason: 'Wrong part',
    });
    expect(response.status).toBe(201);
    const received = await bodyOf<ReturnBody>(response);
    expect(received.condition).toBe('restockable');
    expect(received.itemId).toBe(ITEM_A);
    expect(received.status).toBe('credited');
    expect(received.creditNoteId).not.toBeNull();
    expect(received.replayed).toBe(false);

    // The part is back on the shelf, through ONE movement.
    expect(await onHandOf(ITEM_A, cell)).toBe(7);
    expect(await returnMovementsOf(received.id)).toBe(1);
    expect(await auditCountFor('inv.sales_return.received', received.id)).toBe(1);

    // One pending credit note, for a quarter of the 80.0000 line: 20.0000.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM sal.credit_notes
          WHERE tenant_id = $1 AND invoice_id = $2 AND approval_state = 'pending'`,
        [TENANT_A, sale.invoiceId]
      )
    ).toBe(1);
    const amount = await countRowsOf(
      `SELECT amount::text AS n FROM sal.credit_notes WHERE id = $1`,
      [received.creditNoteId]
    );
    expect(amount).toBe(20);
  });

  it('sends a damaged return to quarantine and leaves sellable stock alone', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '6' });
    const sale = await issuedSale(cell, '2');
    expect(await onHandOf(ITEM_A, cell)).toBe(4);
    const quarantineBefore = await onHandOf(ITEM_A, QUARANTINE_A1);

    authAs(INV_COUNTER);
    const received = await bodyOf<ReturnBody>(
      await receiveReturn({
        sourceKind: 'invoice_line',
        sourceId: sale.lineId,
        quantity: '1',
        condition: 'damaged',
        receivedLocationId: cell,
        quarantineLocationId: QUARANTINE_A1,
        reason: 'Returned broken',
      })
    );
    expect(received.quarantineLocationId).toBe(QUARANTINE_A1);
    // Sellable stock is unchanged; the unit is in quarantine.
    expect(await onHandOf(ITEM_A, cell)).toBe(4);
    expect(await onHandOf(ITEM_A, QUARANTINE_A1)).toBe(quarantineBefore + 1);

    // A damaged return that names no quarantine is refused at the edge.
    const noQuarantine = await receiveReturn({
      sourceKind: 'invoice_line',
      sourceId: sale.lineId,
      quantity: '1',
      condition: 'damaged',
      receivedLocationId: cell,
    });
    expect(noQuarantine.status).toBe(422);
  });

  it('bounds the total against both return paths', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '12' });
    const issueId = await issuedPart(cell, '3');

    authAs(INV_COUNTER);
    // One back the old way, one the new way, one left.
    expect(
      (await post(RETURN_PART, '/api/v1/stock-returns', { partIssueId: issueId, quantity: '1' }))
        .status
    ).toBe(201);
    expect(
      (
        await receiveReturn({
          sourceKind: 'part_issue',
          sourceId: issueId,
          quantity: '1',
          condition: 'restockable',
          receivedLocationId: cell,
        })
      ).status
    ).toBe(201);

    const remaining = await bodyOf<ReturnableBody>(await readReturnable('part_issue', issueId));
    expect(remaining).toMatchObject({
      sourceQuantity: '3.000',
      returnedQuantity: '2.000',
      remainingQuantity: '1.000',
    });

    // Two more would exceed what left: refused, and nothing moves.
    const before = await onHandOf(ITEM_A, cell);
    const excess = await receiveReturn({
      sourceKind: 'part_issue',
      sourceId: issueId,
      quantity: '2',
      condition: 'restockable',
      receivedLocationId: cell,
    });
    expect(excess.status).toBe(409);
    expect(await onHandOf(ITEM_A, cell)).toBe(before);
    // An internal return credits nothing.
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.sales_returns
          WHERE tenant_id = $1 AND source_id = $2 AND credit_note_id IS NOT NULL`,
        [TENANT_A, issueId]
      )
    ).toBe(0);
  });

  it('replays one idempotency key instead of receiving the part twice', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '8' });
    const issueId = await issuedPart(cell, '2');
    authAs(INV_COUNTER);
    const body = {
      sourceKind: 'part_issue',
      sourceId: issueId,
      quantity: '1',
      condition: 'restockable',
      receivedLocationId: cell,
    };
    const key = randomUUID();
    const first = await bodyOf<ReturnBody>(await receiveReturn(body, key));
    const before = await onHandOf(ITEM_A, cell);

    const replay = await receiveReturn(body, key);
    // 200 rather than 201: the stored response is replayed and the handler is never
    // re-entered, so a doubled scanner frame does not take the part back twice.
    expect(replay.status).toBe(200);
    expect((await bodyOf<ReturnBody>(replay)).id).toBe(first.id);
    expect(await onHandOf(ITEM_A, cell)).toBe(before);
    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.sales_returns WHERE tenant_id = $1 AND source_id = $2`,
        [TENANT_A, issueId]
      )
    ).toBe(1);
    expect(await auditCountFor('inv.sales_return.received', first.id)).toBe(1);
  });

  it('refuses a caller without the financial permission, and hides another branch and another tenant', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '5' });
    const issueId = await issuedPart(cell, '2');
    const body = {
      sourceKind: 'part_issue',
      sourceId: issueId,
      quantity: '1',
      condition: 'restockable',
      receivedLocationId: cell,
    };

    // Every inventory code and no `sal.` code: the operation declares two because a
    // return of a SALE raises a credit note, and the database gates that on the second.
    authAs(INV_FULL);
    expect((await receiveReturn(body)).status).toBe(403);

    // The whole authority, held in branch A2. The answer is 404 rather than 403,
    // and deliberately so: the source is a part issue of branch A1, which
    // `sel_part_issues_scope` hides from a caller whose allowed-branch union is
    // {A2}. The service resolves the source before it can authorize anything, so a
    // caller learns nothing about what another branch issued — including whether it
    // exists.
    authAs(INV_COUNTER_SCOPED_A2);
    expect((await receiveReturn(body)).status).toBe(404);

    // Another tenant: the source is not found rather than refused, so nothing is
    // learned about what this branch issued.
    authAs(INV_TENANT_B_COUNTER);
    expect((await receiveReturn(body)).status).toBe(404);

    expect(
      await countRowsOf(
        `SELECT count(*)::text AS n FROM inv.sales_returns WHERE tenant_id = $1 AND source_id = $2`,
        [TENANT_A, issueId]
      )
    ).toBe(0);
  });
});

describe('inv.returnable-quantity-read', () => {
  it('answers for a sale line and 404s a source that is not returnable', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '9' });
    const sale = await issuedSale(cell, '3');

    authAs(INV_COUNTER);
    const response = await readReturnable('invoice_line', sale.lineId);
    expect(response.status).toBe(200);
    expect(await bodyOf<ReturnableBody>(response)).toMatchObject({
      sourceQuantity: '3.000',
      returnedQuantity: '0.000',
      remainingQuantity: '3.000',
    });

    // A source that does not exist, and one that belongs to another tenant, are the
    // same answer.
    expect((await readReturnable('invoice_line', randomUUID())).status).toBe(404);
    authAs(INV_TENANT_B_COUNTER);
    expect((await readReturnable('invoice_line', sale.lineId)).status).toBe(404);
  });
});

describe('inv.sales-return-list', () => {
  it('lists the branch returns and refuses a branch the caller does not hold', async () => {
    const cell = await freshLocation();
    await seedStock({ itemId: ITEM_A, locationId: cell, quantity: '7' });
    const sale = await issuedSale(cell, '2');
    authAs(INV_COUNTER);
    const received = await bodyOf<ReturnBody>(
      await receiveReturn({
        sourceKind: 'invoice_line',
        sourceId: sale.lineId,
        quantity: '1',
        condition: 'restockable',
        receivedLocationId: cell,
      })
    );

    const response = await listReturns(
      `companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&sourceKind=invoice_line&limit=50`
    );
    expect(response.status).toBe(200);
    const body = await bodyOf<{ items: readonly (ReturnBody & { sku: string })[] }>(response);
    expect(body.items.map((row) => row.id)).toContain(received.id);
    expect(body.items.every((row) => row.sourceKind === 'invoice_line')).toBe(true);
    expect(body.items.find((row) => row.id === received.id)?.sku).toBeTruthy();

    authAs(INV_COUNTER_SCOPED_A2);
    expect(
      (await listReturns(`companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&limit=50`)).status
    ).toBe(403);
  });
});
