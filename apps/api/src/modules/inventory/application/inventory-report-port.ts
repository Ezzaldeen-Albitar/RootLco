/**
 * The inventory module's REPORTING port (P1-31 prerequisite P-11, slice 3).
 *
 * ## Why a port and not a query in the reporting module
 *
 * `inv.*` is private to this module — `index.ts` says so, ADR-001 rule 3 requires
 * it and the boundary checker enforces it — so the SQL that selects and totals
 * stock movements lives here and the reporting module asks for the answer. That
 * is the same shape as `WorkOrderReportPort` and `LaborReportPort` on the two
 * datasets before this one, and as `OpenInventoryCommitments`, which this module
 * already exposes so the work-order board can see open commitments without
 * reading `inv.` itself.
 *
 * ## Why a separate class rather than a method on `InventoryReadService`
 *
 * Two measured reasons, not one of style.
 *
 * First, `InventoryReadService.listMovements` takes a `ScopeAuthorizer` and
 * WRITES AN AUDIT ROW (`inv.movement_history.read`) on every call. A report run
 * is already an audited operation in its own right; a second audit row per run,
 * attributed to a different operation, would put an entry in the trail for an
 * operation the caller never invoked.
 *
 * Second, that service also holds the stock reads the availability screens use. A
 * cross-module consumer should depend on the ONE thing it needs, and this class
 * holds a single read.
 *
 * ## It performs NO authorization
 *
 * Deliberately, and stated so it is not mistaken for an omission. The caller —
 * `ReportRunService` — has already evaluated the dataset's declared read code
 * (`inv.stock.read`, the code `inv.stock-movement-list` declares for the same
 * rows) against the company and branch it passes here, at the run operation's
 * branch scope, and RLS narrows the statements underneath. A second,
 * differently-shaped check here would be a second definition of scope.
 *
 * ## It resolves no names beyond the master data on the row
 *
 * Unlike the labour report there is no directory lookup: an item, a unit and a
 * location are all `inv` master data, joined in the same statement. So no label
 * on this report can be narrowed by a capability the caller lacks, and none is
 * invented either — every label below is a column that exists.
 */
import { ApplicationService } from '@/server/layering';
import type { DbHandle } from '@/server/db/transaction';
import { pageRequest, type Page } from '@/server/db/pagination';
import {
  MOVEMENT_REPORT_ORDER,
  type InventoryRepository,
  type MovementReportFilter,
} from '../data/inventory-repository';

/** One movement of the reported period, as the reporting module publishes it. */
export interface MovementReportEntry {
  readonly movementId: string;
  /** An ISO-8601 instant, serialised UTC exactly as every other read publishes one. */
  readonly occurredAt: string;
  /**
   * The business row that caused the movement, in two halves.
   *
   * `inv.stock_movements` carries a `reference_kind` / `reference_id` pair and
   * `uq_stock_movements_source` makes the pair single-use per direction, so the
   * two together ARE the movement's document reference. They are published
   * separately rather than concatenated here: joining them into one string would
   * make this module the authority on how a reference is spelled, which belongs
   * to whoever renders it.
   */
  readonly referenceKind: string;
  readonly referenceId: string;
  /** `opening`, `issue`, `return`, `damage` or `adjustment` — the whole CHECK vocabulary. */
  readonly movementType: string;
  /** `in` or `out`. Constrained per type by `ck_stock_movements_type_direction`. */
  readonly direction: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly locationName: string;
  /** A decimal string, unrounded, in `uomCode`. Always positive. */
  readonly quantity: string;
  readonly uomCode: string;
  readonly uomName: string;
}

/**
 * One total of the WHOLE selection, keyed by item, unit and movement type.
 *
 * There is deliberately no grand total and no single "net movement" figure. D-5
 * forbids a single quantity across unlike items, D-4 requires totals "separated
 * by item and by compatible unit" and requires a return and a transfer to keep
 * their distinct meanings — so `quantityIn` and `quantityOut` are two measures
 * inside one movement type, never one signed sum, and no measure spans two items
 * or two units.
 */
export interface MovementReportTotal {
  readonly itemId: string;
  readonly sku: string;
  readonly uomCode: string;
  readonly movementType: string;
  /** Sum of the movements with `direction = 'in'`, decimal string, unrounded. */
  readonly quantityIn: string;
  /** Sum of the movements with `direction = 'out'`, decimal string, unrounded. */
  readonly quantityOut: string;
}

export interface MovementReportSummary {
  /**
   * Every (item, unit, movement type) that has a movement in the period, and only
   * those.
   *
   * No zero row for an item that did not move. A movement type is a vocabulary
   * term, but an ITEM is catalogue data a tenant may hold thousands of rows of,
   * and listing every one at zero would turn a movement report into a catalogue
   * dump whose totals are all zero — a different report, which nobody asked for.
   */
  readonly totals: readonly MovementReportTotal[];
  /** One keyset page of the selection the totals were computed over. */
  readonly movements: Page<MovementReportEntry>;
}

/** Cursor and limit, exactly as the other reporting ports accept them. */
export interface MovementReportPageInput {
  readonly cursor?: string | undefined;
  readonly limit?: number | undefined;
}

export class InventoryReportPort extends ApplicationService {
  protected readonly module = 'inventory';

  constructor(private readonly repository: InventoryRepository) {
    super();
  }

  /**
   * The branch's stock movements in a period: a page of movements and the total
   * of every (item, unit, movement type) over the whole selection.
   *
   * The ordering contract is `MOVEMENT_REPORT_ORDER` — newest `occurred_at`
   * first, row-id tie-break — and NOT the ledger screen's `MOVEMENT_ORDER`. The
   * two are different orderings over the same table, which is why the report's
   * key is qualified: a cursor minted for one is refused by the other rather than
   * reinterpreted, because re-using a cursor across orderings silently produces a
   * wrong page.
   *
   * The cursor decode stays behind this surface, for the reason the other
   * reporting ports state: a consumer that decoded the cursor itself would be
   * validating it against a contract it had to guess.
   */
  async movementSummary(
    db: DbHandle,
    filter: MovementReportFilter,
    page: MovementReportPageInput
  ): Promise<MovementReportSummary> {
    const report = await this.repository.movementReport(
      db,
      filter,
      pageRequest(MOVEMENT_REPORT_ORDER, page)
    );

    return {
      totals: report.totals.map((row) => ({
        itemId: row.itemId,
        sku: row.sku,
        uomCode: row.uomCode,
        movementType: row.movementType,
        quantityIn: row.quantityIn,
        quantityOut: row.quantityOut,
      })),
      movements: {
        ...report.page,
        items: report.page.items.map((row) => ({
          movementId: row.id,
          occurredAt: row.occurredAt.toISOString(),
          referenceKind: row.referenceKind,
          referenceId: row.referenceId,
          movementType: row.movementType,
          direction: row.direction,
          itemId: row.itemId,
          sku: row.sku,
          itemName: row.itemName,
          locationId: row.locationId,
          locationCode: row.locationCode,
          locationName: row.locationName,
          // Carried through unchanged. No `Number`, no `toFixed`, no arithmetic:
          // `numeric(12,3)` arrives from `pg` as a decimal string and a quantity
          // that is converted once is a quantity that has lost its third decimal.
          quantity: row.quantity,
          uomCode: row.uomCode,
          uomName: row.uomName,
        })),
      },
    };
  }
}
