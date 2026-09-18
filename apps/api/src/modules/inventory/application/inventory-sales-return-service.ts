/**
 * Returns, with a condition and a credit (P1-32-PRE-112…116).
 *
 * A part comes back. Two things decide what happens to it, and they are
 * independent: WHERE it came from, and WHAT CONDITION it is in.
 *
 *  - The SOURCE bounds the quantity. A return cites the part issue it was fitted
 *    from or the counter-sale invoice line it was sold on, and
 *    `inv.guard_sales_return_ceiling` locks that source and refuses a total past
 *    what actually left. For a part issue the ceiling counts the legacy
 *    `inv.part_returns` rows as well, so `POST /stock-returns` and this operation
 *    cannot each spend the same quantity.
 *  - The CONDITION decides the shelf. `restockable` posts into the receiving
 *    location; `damaged` posts into a quarantine location, which is unsellable
 *    because of where it IS rather than because a column says so.
 *
 * ## Where the guarantees live
 *
 * In `inv.receive_sales_return`, which writes the row, posts the one movement
 * through `inv.post_stock_movement`, and — for an invoice-line source — raises the
 * credit note through `sal.request_return_credit_note`. This service adds only what
 * those functions cannot state readably: who may act, which field a refusal is
 * about, and the audit trail.
 *
 * ## Why this operation needs a financial permission
 *
 * Because it can move money. A return against an issued counter sale raises a
 * PENDING credit note, and both the read of the line's amount
 * (`sel_invoice_line_amounts_gated`) and the insert of the note
 * (`ins_credit_notes_gated`) require `sal.finance.view` — so the route declares it
 * rather than advertising an operation that would fail inside the database for
 * half its inputs. A purely internal return of a part issued to a job, which
 * raises no credit note, remains available through `POST /stock-returns` on
 * `inv.stock.operate` alone.
 *
 * ## What no return does
 *
 * Approve its own credit. The note is born pending and the existing
 * `sal.credit-note-approve` still requires a second person, who re-checks the
 * amount against the invoice's open receivable under the invoice lock.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { pageRequest, type Page } from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import {
  SALES_RETURN_ORDER,
  type InventoryRepository,
  type ReturnableQuantityRow,
  type SalesReturnListRow,
  type SalesReturnRow,
} from '../data/inventory-repository';
import { Quantity, assertLegalMovementReference } from '../domain/inventory';
import { parseQuantity, toDomainFailure } from './inventory-failures';
import type { InventoryStockService } from './inventory-stock-service';

export interface SalesReturnView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly itemId: string;
  /** Exact decimal strings, never numbers. */
  readonly quantity: string;
  readonly condition: string;
  readonly receivedLocationId: string;
  readonly quarantineLocationId: string | null;
  readonly reason: string | null;
  /** The pending credit note this return raised, or null when it raised none. */
  readonly creditNoteId: string | null;
  readonly status: string;
  readonly recordVersion: number;
  readonly createdAt: string;
  /** True when an idempotent replay returned the return that already existed. */
  readonly replayed: boolean;
}

export interface SalesReturnListView extends Omit<SalesReturnView, 'replayed'> {
  readonly sku: string;
}

/** What the counter sees before it accepts anything (P1-32-PRE-116). */
export interface ReturnableQuantityView {
  readonly sourceKind: string;
  readonly sourceId: string;
  readonly itemId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly sourceQuantity: string;
  readonly returnedQuantity: string;
  readonly remainingQuantity: string;
}

function toSalesReturnView(row: SalesReturnRow, replayed: boolean): SalesReturnView {
  return {
    id: row.id,
    companyId: row.companyId,
    branchId: row.branchId,
    sourceKind: row.sourceKind,
    sourceId: row.sourceId,
    itemId: row.itemId,
    quantity: row.quantity,
    condition: row.condition,
    receivedLocationId: row.receivedLocationId,
    quarantineLocationId: row.quarantineLocationId,
    reason: row.reason,
    creditNoteId: row.creditNoteId,
    status: row.status,
    recordVersion: row.recordVersion,
    createdAt: row.createdAt.toISOString(),
    replayed,
  };
}

function toSalesReturnListView(row: SalesReturnListRow): SalesReturnListView {
  const { replayed: _replayed, ...view } = toSalesReturnView(row, false);
  return { ...view, sku: row.sku };
}

export class InventorySalesReturnService {
  public constructor(
    private readonly repository: InventoryRepository,
    private readonly stock: InventoryStockService
  ) {}

  /**
   * Receives a return: one row, one `return`/`in` movement, and at most one credit.
   *
   * The order is deliberate. The source is resolved first so the branch that sold
   * or issued the part is the branch authorized — a caller cannot receive into a
   * branch it holds no authority in by naming one of its locations. The
   * idempotency key is resolved next, before any work: `uq_sales_returns_idempotency`
   * would refuse the duplicate anyway, but as `23505`, which a retrying client
   * cannot tell apart from a genuine conflict.
   */
  public async receive(
    db: DbHandle,
    input: {
      readonly sourceKind: string;
      readonly sourceId: string;
      readonly quantity: string;
      readonly condition: string;
      readonly receivedLocationId: string;
      readonly quarantineLocationId?: string;
      readonly reason?: string;
      readonly idempotencyKey?: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<SalesReturnView> {
    const quantity = parseQuantity(input.quantity);
    assertLegalMovementReference('return', 'sales_return', 'in');

    if (input.condition === 'damaged' && input.quarantineLocationId === undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message:
          'A damaged return must name the quarantine location it is received into, so the ' +
          'quantity leaves sellable stock by where it sits.',
        safeDetails: { violations: [{ path: 'body.quarantineLocationId', rule: 'invalid_type' }] },
      });
    }
    if (input.condition === 'restockable' && input.quarantineLocationId !== undefined) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'A restockable return goes back into sellable stock and names no quarantine.',
        safeDetails: { violations: [{ path: 'body.quarantineLocationId', rule: 'custom' }] },
      });
    }

    const source = await this.requireSource(db, input.sourceKind, input.sourceId);
    await authorizeScope({ companyId: source.companyId, branchId: source.branchId });

    // Checked here so the counter is told the remaining figure rather than a bare
    // invariant refusal. The binding check is still the ceiling trigger, under the
    // source lock, which is what makes two tills racing the last unit safe.
    const remaining = Quantity.fromDatabase(source.remainingQuantity, 'remainingQuantity');
    if (quantity.isGreaterThan(remaining)) {
      throw new AppFailure('ERR-TRN-001', {
        message:
          `Only ${remaining.toString()} of the ${source.sourceQuantity} that left may still be ` +
          `returned; ${quantity.toString()} was offered`,
      });
    }

    const existing =
      input.idempotencyKey === undefined
        ? null
        : await this.repository.readSalesReturnByIdempotencyKey(db, input.idempotencyKey);
    if (existing) {
      if (
        existing.sourceKind !== input.sourceKind ||
        existing.sourceId !== input.sourceId ||
        existing.condition !== input.condition ||
        !Quantity.fromDatabase(existing.quantity, 'quantity').equals(quantity)
      ) {
        throw new AppFailure('ERR-INT-001', {
          message:
            'This idempotency key already received a different return. Reuse a key only for an ' +
            'identical request.',
        });
      }
      await authorizeScope({ companyId: existing.companyId, branchId: existing.branchId });
      return toSalesReturnView(existing, true);
    }

    // Both ends of the posting are checked before the call, so a wrong location is
    // named as such instead of arriving as a bare invariant refusal.
    await this.stock.requireLocation(db, input.receivedLocationId);
    if (input.quarantineLocationId !== undefined) {
      await this.stock.requireLocation(db, input.quarantineLocationId);
    }

    let returnId: string;
    try {
      returnId = await this.repository.receiveSalesReturn(db, {
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        quantity: quantity.toString(),
        condition: input.condition,
        receivedLocationId: input.receivedLocationId,
        quarantineLocationId: input.quarantineLocationId ?? null,
        reason: input.reason ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      });
    } catch (error) {
      toDomainFailure(error, 'Sales return');
    }

    const received = await this.requireReturn(db, returnId);
    // The `in` leg is published for the reason the part return's is: a consumer
    // projecting availability from `stock.movement.posted` that never saw stock
    // come back would diverge from the ledger, monotonically.
    await this.stock.publishPostedMovements(db, 'sales_return', received.id);

    await appendAudit(db, {
      action: 'inv.sales_return.received',
      entityType: 'inv.sales_return',
      entityId: received.id,
      companyId: received.companyId,
      branchId: received.branchId,
      requestRef: 'inv.sales-return-create',
      details: [
        { field: 'sourceKind', classification: 'internal', value: received.sourceKind },
        { field: 'sourceId', classification: 'internal', value: received.sourceId },
        { field: 'itemId', classification: 'internal', value: received.itemId },
        { field: 'quantity', classification: 'internal', value: received.quantity },
        { field: 'condition', classification: 'internal', value: received.condition },
        {
          field: 'landedLocationId',
          classification: 'internal',
          value:
            received.condition === 'damaged'
              ? (received.quarantineLocationId ?? received.receivedLocationId)
              : received.receivedLocationId,
        },
        // The credit note's IDENTITY, not its amount: `iam.audit_records` is not
        // gated by `sal.finance.view`, so recording the figure here would route a
        // restricted amount around the policy that restricts it. The note itself
        // carries the amount, under that policy.
        { field: 'creditNoteId', classification: 'internal', value: received.creditNoteId },
      ],
    });

    return toSalesReturnView(received, false);
  }

  /** One branch's returns, newest first. */
  public async list(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly sourceKind?: string | undefined;
      readonly sourceId?: string | undefined;
      readonly condition?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<SalesReturnListView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const result = await this.repository.listSalesReturns(
      db,
      filter,
      pageRequest(SALES_RETURN_ORDER, page)
    );
    return { ...result, items: result.items.map(toSalesReturnListView) };
  }

  /**
   * How much of a source may still come back.
   *
   * The figure the counter shows before it accepts anything, and the answer to the
   * question `inv.part_returns` could never be asked: it counts BOTH return tables,
   * so a part half-returned through the old path reports the honest remainder here.
   */
  public async readReturnable(
    db: DbHandle,
    sourceKind: string,
    sourceId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReturnableQuantityView> {
    const source = await this.requireSource(db, sourceKind, sourceId);
    await authorizeScope({ companyId: source.companyId, branchId: source.branchId });
    return {
      sourceKind,
      sourceId,
      itemId: source.itemId,
      companyId: source.companyId,
      branchId: source.branchId,
      sourceQuantity: source.sourceQuantity,
      returnedQuantity: source.returnedQuantity,
      remainingQuantity: source.remainingQuantity,
    };
  }

  private async requireSource(
    db: DbHandle,
    sourceKind: string,
    sourceId: string
  ): Promise<ReturnableQuantityRow> {
    const source = await this.repository.readReturnableQuantity(db, sourceKind, sourceId);
    if (!source) {
      // One message for "no such row" and for "an unissued sale": a caller that may
      // not see the document must not learn which of the two it is.
      throw new AppFailure('ERR-RES-001', {
        message: `No returnable ${sourceKind === 'invoice_line' ? 'sale' : 'issue'} ${sourceId} was found`,
      });
    }
    return source;
  }

  private async requireReturn(db: DbHandle, returnId: string): Promise<SalesReturnRow> {
    const row = await this.repository.readSalesReturn(db, returnId);
    if (!row) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'The sales return vanished after it was written',
      });
    }
    return row;
  }
}
