/**
 * Operational stock alerts (Owner directive).
 *
 * Five reads and one small configuration surface. Every alert here is an
 * EXPLAINABLE READ over rows the caller is already authorized to see: it states
 * its rule, publishes every input the rule consumed, and stamps the instant the
 * database answered. Nothing in this file guesses, scores, weights, ranks by an
 * undisclosed heuristic, or asks anything outside this database — a reader can
 * redo the arithmetic from the response and get the same answer.
 *
 * ## Why the inputs travel with the finding
 *
 * An alert a reader cannot check is a claim, not a fact. "This item is low" is
 * unusable without the level it was compared against and the quantity that was
 * there; "consumption is unusual" is unusable without the baseline, the windows
 * and the multiple. So every view below carries its own evidence, and every list
 * carries `asOf` — the database's `now()` inside the request's transaction, not
 * this process's clock, because a freshness stamp that does not belong to the
 * snapshot invites a reader to trust a figure that was stale when it rendered.
 *
 * ## Nothing here writes stock or money
 *
 * The only writes are on `inv.item_reorder_levels`, which holds a threshold and
 * a preferred order quantity. No movement, no balance, no adjustment, no amount.
 *
 * ## Which permissions, and why those
 *
 * READS use `inv.stock.read`. Each of the four stock alerts is a statement about
 * balances, counted variances, the movement ledger or a transfer in flight — the
 * very rows `inv.stock.read` already governs — and the alert reveals nothing the
 * underlying read does not. Requiring a new code would mean a storekeeper who may
 * read the stock could not be told when it ran low.
 *
 * WRITES use `inv.item.manage`. A reorder level is a property of the ITEM, in the
 * same sense and with the same narrowing rules as `inv.item_sale_prices`, which
 * that code already governs. `inv.stock.operate` would be wrong: nothing here
 * moves stock, and an operator who may issue parts should not thereby be able to
 * redefine what "low" means for the branch.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { pageRequest, type Page } from '@/server/db/pagination';
import { callerHoldsPermissionTenantWide, type ScopeAuthorizer } from '@/server/auth/authorization';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  AGED_TRANSIT_ORDER,
  COUNT_DISCREPANCY_ORDER,
  LOW_STOCK_ORDER,
  REORDER_LEVEL_ORDER,
  UNUSUAL_CONSUMPTION_ORDER,
  type AgedInTransitRow,
  type ConsumptionPeriodRow,
  type CountDiscrepancyRow,
  type InventoryRepository,
  type LowStockRow,
  type ReorderLevelRow,
  type UnusualConsumptionRow,
} from '../data/inventory-repository';
import { parseCountedQuantity, parseQuantity } from './inventory-failures';

const MANAGE_PERMISSION = 'inv.item.manage';

/**
 * The bounds every configurable alert input is clamped to, published as part of
 * the contract rather than hidden in a validator.
 *
 * They exist so a caller cannot turn an explainable read into an unbounded scan:
 * `UNUSUAL_CONSUMPTION_BOUNDS` alone decides how much of the movement ledger one
 * request may aggregate (at most `periodDays.max * (baselinePeriods.max + 1)`
 * days), and a request outside them is refused with the bound named rather than
 * silently reinterpreted.
 */
export const UNUSUAL_CONSUMPTION_BOUNDS = Object.freeze({
  periodDays: Object.freeze({ min: 1, max: 31, default: 7 }),
  baselinePeriods: Object.freeze({ min: 2, max: 12, default: 4 }),
  /** The multiple of the baseline median. A decimal STRING, never a float. */
  multiple: Object.freeze({ min: '1.5', max: '50', default: '3' }),
  /** The absolute floor, so a jump from 0.1 to 0.4 units is not an alert. */
  minimumQty: Object.freeze({ min: '0', max: '1000000', default: '1' }),
});

/** The bounds the aged-in-transit read accepts. */
export const AGED_TRANSIT_BOUNDS = Object.freeze({
  minimumAgeDays: Object.freeze({ min: 1, max: 365, default: 7 }),
});

/** One configured reorder level as the API renders it. */
export interface ReorderLevelView {
  readonly id: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  /** Null means every company of the tenant. */
  readonly companyId: string | null;
  /** Null means every branch of the named company. */
  readonly branchId: string | null;
  /** Null makes the level about the branch as a whole rather than one shelf. */
  readonly locationId: string | null;
  readonly locationCode: string | null;
  /** Exact decimal strings — `numeric(12,3)`, never a JSON number. */
  readonly reorderLevelQty: string;
  readonly preferredOrderQty: string | null;
  readonly status: string;
  readonly retiredAt: string | null;
  readonly recordVersion: number;
}

/** A reorder-level write, with whether it changed anything. */
export interface ReorderLevelWriteView extends ReorderLevelView {
  /** True when the call left the row exactly as it already was. */
  readonly replayed: boolean;
}

/** A list of configured levels, stamped with the instant it was read. */
export interface ReorderLevelListView {
  readonly asOf: string;
  readonly levels: Page<ReorderLevelView>;
}

/** One low-stock finding, with everything the comparison used. */
export interface LowStockView {
  readonly reorderLevelId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly companyId: string;
  readonly branchId: string;
  /** `branch` when the level is about the whole branch, `location` when one shelf. */
  readonly scope: string;
  readonly locationId: string | null;
  readonly locationCode: string | null;
  readonly onHandQty: string;
  readonly reservedQty: string;
  readonly availableQty: string;
  readonly reorderLevelQty: string;
  /** `reorderLevelQty - availableQty`, computed in `numeric` by the database. */
  readonly shortfallQty: string;
  readonly preferredOrderQty: string | null;
}

/** The low-stock answer: the rule, the instant, and the page. */
export interface LowStockAlertView {
  readonly asOf: string;
  readonly rule: LowStockRuleView;
  readonly findings: Page<LowStockView>;
}

/** The low-stock rule in words, beside the figures it produced. */
export interface LowStockRuleView {
  readonly statement: string;
  /** Location types excluded from a branch total, named rather than implied. */
  readonly excludedLocationTypes: readonly string[];
}

/** One counted line whose variance was not zero. */
export interface CountDiscrepancyView {
  readonly countId: string;
  readonly lineId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly locationId: string;
  readonly locationCode: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly snapshotQty: string;
  readonly countedQty: string | null;
  readonly movementDeltaDuringCount: string;
  readonly varianceQty: string;
  /** When the count was reconciled — the date the discrepancy was established. */
  readonly countedOn: string;
  readonly adjustmentId: string | null;
  /** `pending`, `approved` or `rejected`; null when no adjustment was raised. */
  readonly adjustmentStatus: string | null;
  readonly adjustmentApprovedAt: string | null;
}

/** The count-discrepancy answer. */
export interface CountDiscrepancyAlertView {
  readonly asOf: string;
  readonly rule: { readonly statement: string };
  readonly findings: Page<CountDiscrepancyView>;
}

/** One compared window, exactly as the database cut it. */
export interface ConsumptionPeriodView {
  readonly from: string;
  readonly to: string;
  readonly issuedQty: string;
}

/** One item whose issued quantity broke out of its own preceding history. */
export interface UnusualConsumptionView {
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly observedQty: string;
  readonly baselineMedianQty: string;
  readonly observedPeriod: ConsumptionPeriodView;
  /** Oldest first, one entry per baseline window. Nothing is weighted. */
  readonly baselinePeriods: readonly ConsumptionPeriodView[];
}

/** The rule the unusual-consumption read applied, with its numbers. */
export interface UnusualConsumptionRuleView {
  readonly statement: string;
  readonly periodDays: number;
  readonly baselinePeriods: number;
  readonly multiple: string;
  readonly minimumQty: string;
  readonly baselineStatistic: string;
}

/** The unusual-consumption answer. */
export interface UnusualConsumptionAlertView {
  readonly asOf: string;
  readonly rule: UnusualConsumptionRuleView;
  readonly findings: Page<UnusualConsumptionView>;
}

/** One transfer still in transit past the age the caller asked about. */
export interface AgedInTransitView {
  readonly transferId: string;
  readonly itemId: string;
  readonly sku: string;
  readonly itemName: string;
  readonly status: string;
  readonly companyId: string;
  readonly fromBranchId: string;
  readonly fromLocationId: string;
  readonly fromLocationCode: string;
  readonly toBranchId: string;
  readonly toLocationId: string;
  readonly toLocationCode: string;
  readonly quantity: string;
  readonly receivedQuantity: string | null;
  /** Still in transit: dispatched less received less resolved, from the schema. */
  readonly outstandingQuantity: string;
  readonly dispatchedAt: string;
  readonly ageDays: number;
}

/** The aged-in-transit answer. */
export interface AgedInTransitAlertView {
  readonly asOf: string;
  readonly rule: { readonly statement: string; readonly minimumAgeDays: number };
  readonly findings: Page<AgedInTransitView>;
}

const iso = (value: Date | null): string | null => (value === null ? null : value.toISOString());

function refuse(path: string, rule: string, message: string): never {
  throw new AppFailure('ERR-VAL-001', {
    message,
    safeDetails: { violations: [{ path, rule }] },
  });
}

function toReorderLevelView(row: ReorderLevelRow): ReorderLevelView {
  return {
    id: row.id,
    itemId: row.itemId,
    sku: row.sku,
    itemName: row.itemName,
    companyId: row.companyId,
    branchId: row.branchId,
    locationId: row.locationId,
    locationCode: row.locationCode,
    reorderLevelQty: row.reorderLevelQty,
    preferredOrderQty: row.preferredOrderQty,
    status: row.status,
    retiredAt: iso(row.retiredAt),
    recordVersion: row.recordVersion,
  };
}

function toLowStockView(row: LowStockRow): LowStockView {
  return {
    reorderLevelId: row.reorderLevelId,
    itemId: row.itemId,
    sku: row.sku,
    itemName: row.itemName,
    companyId: row.companyId,
    branchId: row.branchId,
    scope: row.scope,
    locationId: row.locationId,
    locationCode: row.locationCode,
    onHandQty: row.onHandQty,
    reservedQty: row.reservedQty,
    availableQty: row.availableQty,
    reorderLevelQty: row.reorderLevelQty,
    shortfallQty: row.shortfallQty,
    preferredOrderQty: row.preferredOrderQty,
  };
}

function toCountDiscrepancyView(row: CountDiscrepancyRow): CountDiscrepancyView {
  return {
    countId: row.countId,
    lineId: row.lineId,
    companyId: row.companyId,
    branchId: row.branchId,
    locationId: row.locationId,
    locationCode: row.locationCode,
    itemId: row.itemId,
    sku: row.sku,
    itemName: row.itemName,
    snapshotQty: row.snapshotQty,
    countedQty: row.countedQty,
    movementDeltaDuringCount: row.movementDeltaDuringCount,
    varianceQty: row.varianceQty,
    countedOn: row.reconciledAt.toISOString(),
    adjustmentId: row.adjustmentId,
    adjustmentStatus: row.adjustmentStatus,
    adjustmentApprovedAt: iso(row.adjustmentApprovedAt),
  };
}

const toPeriodView = (period: ConsumptionPeriodRow): ConsumptionPeriodView => ({
  from: period.from,
  to: period.to,
  issuedQty: period.issuedQty,
});

function toUnusualConsumptionView(row: UnusualConsumptionRow): UnusualConsumptionView {
  return {
    itemId: row.itemId,
    sku: row.sku,
    itemName: row.itemName,
    companyId: row.companyId,
    branchId: row.branchId,
    observedQty: row.observedQty,
    baselineMedianQty: row.baselineMedianQty,
    observedPeriod: toPeriodView(row.observedPeriod),
    baselinePeriods: row.baselinePeriods.map(toPeriodView),
  };
}

function toAgedInTransitView(row: AgedInTransitRow): AgedInTransitView {
  return {
    transferId: row.transferId,
    itemId: row.itemId,
    sku: row.sku,
    itemName: row.itemName,
    status: row.status,
    companyId: row.companyId,
    fromBranchId: row.fromBranchId,
    fromLocationId: row.fromLocationId,
    fromLocationCode: row.fromLocationCode,
    toBranchId: row.toBranchId,
    toLocationId: row.toLocationId,
    toLocationCode: row.toLocationCode,
    quantity: row.quantity,
    receivedQuantity: row.receivedQuantity,
    outstandingQuantity: row.outstandingQuantity,
    dispatchedAt: row.dispatchedAt.toISOString(),
    ageDays: row.ageDays,
  };
}

/**
 * Refuses an integer outside its published bound, naming the bound.
 *
 * Clamping silently would make two requests with different parameters return the
 * same page and give no hint why, which is the opposite of explainable.
 */
function assertWithin(
  value: number,
  bound: { readonly min: number; readonly max: number },
  path: string
): number {
  if (!Number.isInteger(value) || value < bound.min || value > bound.max) {
    refuse(path, 'out_of_range', `Must be a whole number between ${bound.min} and ${bound.max}`);
  }
  return value;
}

/**
 * Refuses a decimal-string parameter outside its published bound.
 *
 * Compared as decimals through the inventory `Quantity` type rather than as
 * floats: the bounds are part of a published contract and `parseFloat` would
 * decide them in IEEE-754, which is not how any other quantity in this module is
 * compared.
 */
function assertDecimalWithin(
  raw: string,
  bound: { readonly min: string; readonly max: string },
  path: string
): string {
  const value = parseCountedQuantity(raw, path.replace(/^query\./, ''));
  const min = parseCountedQuantity(bound.min, path.replace(/^query\./, ''));
  const max = parseCountedQuantity(bound.max, path.replace(/^query\./, ''));
  if (min.isGreaterThan(value) || value.isGreaterThan(max)) {
    refuse(path, 'out_of_range', `Must be between ${bound.min} and ${bound.max}`);
  }
  return value.toString();
}

export class InventoryAlertService {
  public constructor(private readonly repository: InventoryRepository) {}

  // -------------------------------------------------------------------------
  // Reorder levels — the configuration the low-stock alert reads.
  // -------------------------------------------------------------------------

  /** The configured levels, newest narrowing and all, so an operator sees the whole picture. */
  public async listReorderLevels(
    db: DbHandle,
    filter: {
      readonly itemId?: string | undefined;
      readonly companyId?: string | undefined;
      readonly branchId?: string | undefined;
      readonly includeRetired?: boolean | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined }
  ): Promise<ReorderLevelListView> {
    const asOf = await this.repository.readAsOf(db);
    const result = await this.repository.listReorderLevels(
      db,
      filter,
      pageRequest(REORDER_LEVEL_ORDER, page)
    );
    return {
      asOf: asOf.toISOString(),
      levels: { ...result, items: result.items.map(toReorderLevelView) },
    };
  }

  /**
   * States the level for one signature: inserts it, or revises the live row that
   * already holds that signature.
   *
   * Revising rather than inserting is what keeps `uq_item_reorder_levels_signature`
   * from turning an ordinary threshold change into a unique-violation the caller
   * cannot act on, and it keeps the history in `record_version` rather than
   * scattering it across duplicate rows. A call that would leave both quantities
   * exactly as they are is answered `replayed: true` and writes nothing at all —
   * including no audit record, because nothing happened.
   */
  public async setReorderLevel(
    db: DbHandle,
    input: {
      readonly itemId: string;
      readonly companyId?: string | undefined;
      readonly branchId?: string | undefined;
      readonly locationId?: string | undefined;
      readonly reorderLevelQty: string;
      readonly preferredOrderQty?: string | undefined;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<ReorderLevelWriteView> {
    if (input.branchId !== undefined && input.companyId === undefined) {
      refuse(
        'body.companyId',
        'branch_needs_company',
        'A level narrowed to a branch must name the company that branch belongs to'
      );
    }
    if (input.locationId !== undefined && input.branchId === undefined) {
      refuse(
        'body.branchId',
        'location_needs_branch',
        'A level narrowed to a stock location must name the branch that location is in'
      );
    }
    if (input.companyId === undefined) {
      // A level with no company applies in every branch of every company, so the
      // authority must be held the same way. Checked here and not by the route:
      // `scope: 'tenant'` with no concrete target degrades to the scope-blind
      // permission read, which a grant confined to ONE branch satisfies — and that
      // caller would otherwise redefine "low" for the whole organisation.
      if (!(await callerHoldsPermissionTenantWide(db, MANAGE_PERMISSION))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'A reorder level with no company applies in every branch of the organisation, so ' +
            'setting one requires inv.item.manage granted across the organisation. Name the ' +
            'company to set a level for one.',
          safeDetails: { requiredPermissions: [MANAGE_PERMISSION] },
        });
      }
    } else {
      await authorizeScope({
        companyId: input.companyId,
        ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
      });
    }

    // Zero is a legitimate level — "tell me the moment this runs out" — so the
    // threshold is parsed with the counted-quantity rule, which permits it. The
    // preferred order quantity is a quantity somebody would actually buy, so it
    // goes through the postable rule, which does not.
    const reorderLevelQty = parseCountedQuantity(input.reorderLevelQty, 'reorderLevelQty');
    const preferredOrderQty =
      input.preferredOrderQty === undefined
        ? null
        : parseQuantity(input.preferredOrderQty, 'preferredOrderQty').toString();

    const signature = {
      itemId: input.itemId,
      companyId: input.companyId ?? null,
      branchId: input.branchId ?? null,
      locationId: input.locationId ?? null,
    };
    const existing = await this.repository.findActiveReorderLevel(db, signature);

    if (existing !== null) {
      const unchanged =
        parseCountedQuantity(existing.reorderLevelQty, 'reorderLevelQty').toString() ===
          reorderLevelQty.toString() &&
        (existing.preferredOrderQty === null
          ? preferredOrderQty === null
          : preferredOrderQty !== null &&
            parseQuantity(existing.preferredOrderQty, 'preferredOrderQty').toString() ===
              preferredOrderQty);
      if (unchanged) {
        return { ...toReorderLevelView(existing), replayed: true };
      }
      const revised = await this.repository.reviseReorderLevel(
        db,
        existing.id,
        { reorderLevelQty: reorderLevelQty.toString(), preferredOrderQty },
        existing.recordVersion
      );
      if (revised === null) {
        throw new AppFailure('ERR-CON-001', {
          message: 'The reorder level changed while this request was being handled; read it again',
        });
      }
      const after = await this.requireLevel(db, existing.id);
      await this.recordSet(db, after);
      return { ...after, replayed: false };
    }

    let created: string;
    try {
      created = await this.repository.insertReorderLevel(db, signature, {
        reorderLevelQty: reorderLevelQty.toString(),
        preferredOrderQty,
      });
    } catch (error) {
      if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
        throw new AppFailure('ERR-RES-001', {
          message: 'The item, company, branch or stock location named is not in this organisation',
        });
      }
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-CON-001', {
          message: 'A level for this item and scope was created concurrently; read it again',
        });
      }
      throw error;
    }
    const after = await this.requireLevel(db, created);
    await this.recordSet(db, after);
    return { ...after, replayed: false };
  }

  /**
   * Retires a level, keeping the row.
   *
   * The history of what a branch once thought it needed is worth keeping, and the
   * signature is freed by the partial unique index rather than by a delete, so a
   * replacement can be set immediately. Retiring an already-retired level changes
   * nothing and answers `replayed: true`.
   */
  public async retireReorderLevel(
    db: DbHandle,
    levelId: string,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReorderLevelWriteView> {
    const current = await this.repository.readReorderLevel(db, levelId);
    if (current === null) {
      throw new AppFailure('ERR-RES-001', { message: `Reorder level ${levelId} was not found` });
    }
    if (current.companyId === null) {
      if (!(await callerHoldsPermissionTenantWide(db, MANAGE_PERMISSION))) {
        throw new AppFailure('ERR-IAM-001', {
          message:
            'This level applies in every branch of the organisation, so retiring it requires ' +
            'inv.item.manage granted across the organisation.',
          safeDetails: { requiredPermissions: [MANAGE_PERMISSION] },
        });
      }
    } else {
      await authorizeScope({
        companyId: current.companyId,
        ...(current.branchId === null ? {} : { branchId: current.branchId }),
      });
    }
    if (current.status === 'retired') {
      return { ...toReorderLevelView(current), replayed: true };
    }
    if (current.recordVersion !== expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The reorder level has changed since it was read; read it again and retry',
      });
    }
    const retired = await this.repository.retireReorderLevel(db, levelId, expectedVersion);
    if (retired === null) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The reorder level has changed since it was read; read it again and retry',
      });
    }
    const after = await this.requireLevel(db, levelId);
    await appendAudit(db, {
      action: 'inv.item_reorder_level.retired',
      entityType: 'inv.item_reorder_level',
      entityId: after.id,
      ...(after.companyId === null ? {} : { companyId: after.companyId }),
      ...(after.branchId === null ? {} : { branchId: after.branchId }),
      requestRef: 'inv.reorder-level-retire',
      details: [
        { field: 'itemId', classification: 'internal', value: after.itemId },
        { field: 'locationId', classification: 'internal', value: after.locationId },
        { field: 'reorderLevelQty', classification: 'internal', value: after.reorderLevelQty },
      ],
    });
    return { ...after, replayed: false };
  }

  // -------------------------------------------------------------------------
  // The four stock alerts.
  // -------------------------------------------------------------------------

  /**
   * Items at or below the level configured for them, in one branch.
   *
   * The branch is authorized before it is read, unconditionally, for the reason
   * `readAvailability` records: `app.branch_ids` is the union of every active
   * grant regardless of which permission carries it, so RLS alone would let a
   * principal holding `inv.stock.read` in one branch read another branch they
   * merely have some grant in.
   */
  public async listLowStock(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<LowStockAlertView> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const asOf = await this.repository.readAsOf(db);
    const result = await this.repository.listLowStock(
      db,
      filter,
      pageRequest(LOW_STOCK_ORDER, page)
    );
    return {
      asOf: asOf.toISOString(),
      rule: {
        statement:
          'An item is low when its available quantity — on hand less reserved, the balance ' +
          "row's own generated column — is at or below the reorder level configured for it. " +
          'A level naming a stock location is compared against that location; a level naming ' +
          'none is compared against the branch total. Where more than one level could apply, ' +
          'the narrower wins: branch over company over the whole organisation. An item with ' +
          'no configured level is never low.',
        excludedLocationTypes: ['quarantine', 'transit'],
      },
      findings: { ...result, items: result.items.map(toLowStockView) },
    };
  }

  /**
   * How many items are low in one branch (Owner directive — the dashboard).
   *
   * NO authorization is performed here, and that is the opposite of what
   * `listLowStock` above does — so it is stated rather than left to be noticed.
   * `listLowStock` is reached by a route whose whole subject is one branch, and
   * it re-authorizes that pair inside the transaction. This is reached by the
   * dashboard, which has already evaluated `inv.stock.read` against every branch
   * in its set and omits the figure entirely for a caller that does not hold it.
   * Re-authorizing here would put a second, differently-shaped scope decision
   * behind a number, and the two would eventually disagree about which branch a
   * caller may count.
   *
   * The count and the alert list share one SQL selection, so the dashboard's
   * figure is the length of the list an operator would see if they opened it.
   */
  public async countLowStock(
    db: DbHandle,
    filter: { readonly companyId: string; readonly branchId: string }
  ): Promise<number> {
    return this.repository.countLowStock(db, filter);
  }

  /** Counted lines whose variance was not zero, on counts that were reconciled. */
  public async listCountDiscrepancies(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId?: string | undefined;
      readonly locationId?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<CountDiscrepancyAlertView> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const asOf = await this.repository.readAsOf(db);
    const result = await this.repository.listCountDiscrepancies(
      db,
      filter,
      pageRequest(COUNT_DISCREPANCY_ORDER, page)
    );
    return {
      asOf: asOf.toISOString(),
      rule: {
        statement:
          'A discrepancy is a reconciled stock count line whose variance is not zero. The ' +
          'variance is the stored generated column — counted less snapshot plus the movements ' +
          'posted while the shelf was being counted — so it is the same figure the adjustment ' +
          'was raised from. Open counts are excluded: their lines are a tally in progress.',
      },
      findings: { ...result, items: result.items.map(toCountDiscrepancyView) },
    };
  }

  /**
   * Items whose issued quantity broke out of their OWN preceding history.
   *
   * The rule is stated in the response as well as here, with its numbers, because
   * a threshold a reader cannot see is a threshold they cannot argue with.
   */
  public async listUnusualConsumption(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId?: string | undefined;
      readonly periodDays?: number | undefined;
      readonly baselinePeriods?: number | undefined;
      readonly multiple?: string | undefined;
      readonly minimumQty?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<UnusualConsumptionAlertView> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });

    const periodDays = assertWithin(
      filter.periodDays ?? UNUSUAL_CONSUMPTION_BOUNDS.periodDays.default,
      UNUSUAL_CONSUMPTION_BOUNDS.periodDays,
      'query.periodDays'
    );
    const baselinePeriods = assertWithin(
      filter.baselinePeriods ?? UNUSUAL_CONSUMPTION_BOUNDS.baselinePeriods.default,
      UNUSUAL_CONSUMPTION_BOUNDS.baselinePeriods,
      'query.baselinePeriods'
    );
    const multiple = assertDecimalWithin(
      filter.multiple ?? UNUSUAL_CONSUMPTION_BOUNDS.multiple.default,
      UNUSUAL_CONSUMPTION_BOUNDS.multiple,
      'query.multiple'
    );
    const minimumQty = assertDecimalWithin(
      filter.minimumQty ?? UNUSUAL_CONSUMPTION_BOUNDS.minimumQty.default,
      UNUSUAL_CONSUMPTION_BOUNDS.minimumQty,
      'query.minimumQty'
    );

    const asOf = await this.repository.readAsOf(db);
    const result = await this.repository.listUnusualConsumption(
      db,
      {
        companyId: filter.companyId,
        branchId: filter.branchId,
        periodDays,
        baselinePeriods,
        multiple,
        minimumQty,
        ...(filter.itemId === undefined ? {} : { itemId: filter.itemId }),
      },
      pageRequest(UNUSUAL_CONSUMPTION_ORDER, page)
    );
    return {
      asOf: asOf.toISOString(),
      rule: {
        statement:
          `An item is reported when the quantity issued in the last ${periodDays} day(s) is at ` +
          `least ${multiple} times the median of the ${baselinePeriods} preceding windows of ` +
          `the same length, and is at least ${minimumQty} unit(s). The median is the lower of ` +
          'the two middle values on an even count, taken over the windows exactly as listed ' +
          'on each finding. No window is weighted and no window is dropped. When the median ' +
          'is zero the multiple is satisfied by any quantity, so the minimum is what decides. ' +
          'Issued means a stock movement of type issue in the named branch.',
        periodDays,
        baselinePeriods,
        multiple,
        minimumQty,
        baselineStatistic: 'median (lower of the two middle values on an even count)',
      },
      findings: { ...result, items: result.items.map(toUnusualConsumptionView) },
    };
  }

  /** Transfers dispatched long ago that have still not fully arrived. */
  public async listAgedInTransit(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly itemId?: string | undefined;
      readonly minimumAgeDays?: number | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<AgedInTransitAlertView> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const minimumAgeDays = assertWithin(
      filter.minimumAgeDays ?? AGED_TRANSIT_BOUNDS.minimumAgeDays.default,
      AGED_TRANSIT_BOUNDS.minimumAgeDays,
      'query.minimumAgeDays'
    );
    const asOf = await this.repository.readAsOf(db);
    const result = await this.repository.listAgedInTransit(
      db,
      {
        companyId: filter.companyId,
        branchId: filter.branchId,
        minimumAgeDays,
        ...(filter.itemId === undefined ? {} : { itemId: filter.itemId }),
      },
      pageRequest(AGED_TRANSIT_ORDER, page)
    );
    return {
      asOf: asOf.toISOString(),
      rule: {
        statement:
          `A transfer is reported when it was dispatched more than ${minimumAgeDays} day(s) ` +
          'ago and is still dispatched or only partly received. The remaining quantity is the ' +
          "schema's own outstanding figure — dispatched less received less resolved — and the " +
          'age is whole days between dispatch and the instant stamped on this answer. Both ' +
          'ends are served: the named branch is matched as the source or the destination.',
        minimumAgeDays,
      },
      findings: { ...result, items: result.items.map(toAgedInTransitView) },
    };
  }

  // -------------------------------------------------------------------------

  private async requireLevel(db: DbHandle, levelId: string): Promise<ReorderLevelView> {
    const row = await this.repository.readReorderLevel(db, levelId);
    if (row === null) {
      throw new AppFailure('ERR-RES-001', { message: `Reorder level ${levelId} was not found` });
    }
    return toReorderLevelView(row);
  }

  private async recordSet(db: DbHandle, level: ReorderLevelView): Promise<void> {
    await appendAudit(db, {
      action: 'inv.item_reorder_level.set',
      entityType: 'inv.item_reorder_level',
      entityId: level.id,
      ...(level.companyId === null ? {} : { companyId: level.companyId }),
      ...(level.branchId === null ? {} : { branchId: level.branchId }),
      requestRef: 'inv.reorder-level-set',
      details: [
        { field: 'itemId', classification: 'internal', value: level.itemId },
        { field: 'locationId', classification: 'internal', value: level.locationId },
        { field: 'reorderLevelQty', classification: 'internal', value: level.reorderLevelQty },
        { field: 'preferredOrderQty', classification: 'internal', value: level.preferredOrderQty },
      ],
    });
  }
}
