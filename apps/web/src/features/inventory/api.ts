'use server';

import type { TableRequest } from '@/components/data-table/table-state';
import type { ServerPage } from '@/components/data-table/use-server-table';
import { authorizedClient } from '@/lib/api/server-client';
import {
  STATUS_BY_KIND,
  branchTargetQuery,
  query,
  readOperation,
  type CursorPage,
  type ItemsOnly,
  type ReadState,
} from '@/lib/api/read-operation';
import { VIOLATION_KEY_PREFIX, type ApiFailure } from '@/lib/api/client';
import { fromFailure, success, type ActionState } from '@/lib/forms/action-result';
import type {
  GoodsReceiptCreateBody,
  ItemCategoryCreateBody,
  ItemCreateBody,
  ItemIdentifierAddBody,
  ItemSalePriceSetBody,
  MaterialExceptionCreateBody,
  MaterialExceptionDecideBody,
  MaterialRequestCancelBody,
  MaterialRequestCloseBody,
  MaterialRequirementApproveBody,
  MaterialRequirementCancelBody,
  OpeningBatchCreateBody,
  OpeningBatchLineCreateBody,
  ReorderLevelSetBody,
  SalesReturnCreateBody,
  StockAdjustmentApproveBody,
  StockAdjustmentCreateBody,
  StockCountCancelBody,
  StockCountLineRecordBody,
  StockCountOpenBody,
  StockIssueCreateBody,
  StockLocationCreateBody,
  StockReservationCreateBody,
  StockReservationReleaseBody,
  StockReturnCreateBody,
  StockTransferCancelBody,
  StockTransferCreateBody,
  StockTransferDiscrepancyResolveBody,
  StockTransferReceiveBody,
  StockTransferWriteOffDecideBody,
  UnitConversionSetBody,
  VehicleSpecificationCreateBody,
} from '@/lib/contracts/inventory-contract';
import type { BranchOption } from '@/features/services/services-contract';
import {
  ALERT_PAGE_SIZE,
  MATERIAL_DRAW_REASONS,
  type AdjustmentEcho,
  type AdjustmentState,
  type AgedInTransitAlerts,
  type AvailabilityCriteria,
  type BarcodeResolution,
  type CountDiscrepancyAlerts,
  type CreatedStockLocation,
  type GoodsReceiptDetail,
  type GoodsReceiptSummary,
  type InventoryItem,
  type IssueEcho,
  type ItemCategory,
  type ItemCostHistory,
  type ItemIdentifierEcho,
  type ItemIdentifierList,
  type ItemLabel,
  type ItemSalePrice,
  type ItemSalePriceList,
  type ItemSearchCriteria,
  type LowStockAlerts,
  type MaterialException,
  type MaterialRequestEcho,
  type MaterialRequirement,
  type MaterialRequirementCreateBody,
  type MaterialRequirementDetail,
  type MaterialRequirementState,
  type MovementCriteria,
  type OpeningBatch,
  type OpeningBatchDetail,
  type OpeningBatchLine,
  type OpeningBatchSummary,
  type PartIssue,
  type ReorderLevelEcho,
  type ReorderLevelList,
  type RequiredPart,
  type ReservationCriteria,
  type ReservationEcho,
  type ReturnCondition,
  type ReturnEcho,
  type ReturnableQuantity,
  type SalesReturnEcho,
  type SalesReturnRow,
  type SalesReturnSourceKind,
  type StockAdjustment,
  type StockAvailability,
  type StockCountDetail,
  type StockCountSummary,
  type StockLocation,
  type StockMovement,
  type StockReservation,
  type StockTarget,
  type SettlementDecision,
  type StockTransfer,
  type TransferDirection,
  type TransferEcho,
  type TransferSettlement,
  type TransferSettlementEcho,
  type UnitConversion,
  type UnitConversionEcho,
  type UnitOfMeasureOption,
  type UnusualConsumptionAlerts,
  type VehicleSpecification,
  type VehicleSpecificationEcho,
  type VehicleSpecificationState,
} from './inventory-contract';

/**
 * The inventory adapters (P1-30, `W4`, FE-008/009/010; `W5`, FE-011/012/013).
 *
 * Nothing here fetches directly: `authorizedClient()` is the only network owner
 * in this application. This file turns operations into view states and does
 * no arithmetic: every quantity is passed through as the string the server
 * sent, and `available` is the database's generated figure, never a difference
 * taken here.
 *
 * ## Two kinds of read
 *
 * `inv.item-search` is tenant-wide — `inv.item_master` has no company or
 * branch — so it travels through `query()` with no target. The stock reads
 * (`inv.stock-availability-read`, `inv.stock-reservation-list`,
 * `inv.stock-location-list`) are `scope: 'branch'` and their routes demand
 * `companyId` and `branchId`: they are the read's TARGET, re-authorized
 * server-side, and travel through `branchTargetQuery`, which refuses a scope
 * name among ordinary filters by design.
 *
 * ## Nothing is version-guarded
 *
 * No inventory write takes `If-Match`. `inv.stock-reservation-create` is
 * marked idempotent, so the transport attaches a header key — that key replays
 * a STORED response. The reservation itself is kept once per `idempotencyKey`
 * in the BODY: a second request naming the same body key answers 200 with the
 * reservation already made and `replayed: true`, which is the statement the
 * screen makes. The screen therefore sends one body key per opened form.
 * `inv.stock-reservation-release` is NOT marked idempotent, so no key is sent;
 * it is idempotent in effect and reports `replayed` when the reservation was
 * already past `active`.
 *
 * ## W5: the parts of a work order, and the ledger
 *
 * `inv.work-order-part-issue-list` and `wo.required-part-list` name the work
 * order in the path — the parent IS the target, one guard — and travel through
 * `query()`. `inv.stock-movement-list` is branch-targeted like the other stock
 * reads and is AUDITED on the server: the screen calls it only on an explicit
 * action. The two writes, `inv.stock-issue-create` and `inv.stock-return-create`,
 * are marked idempotent (the transport attaches the header key) and take no
 * body key, so they echo no `replayed`.
 *
 * ## W10: an opening batch is reachable again
 *
 * `inv.opening-batch-list` is branch-targeted like the other stock reads;
 * `inv.opening-batch-read` names the batch in the path and lets the server
 * decide scope from the row. Both are published on `inv.stock.read` — the code
 * the opening-stock page already gates on — and together they are what lets an
 * operator return to a draft after a reload, and a second person reach a batch
 * they did not count in their own session.
 */

/** A write that creates or returns something the screen must then hold on to. */
export type CreateOutcome<T> = {
  readonly state: ActionState;
  /** The row on success, `null` on any other outcome. */
  readonly created: T | null;
};

const EMPTY = { rows: [], nextCursor: null, hasMore: false } as const;

const expired = (attempt: number): ActionState => ({
  status: 'expired',
  messageKey: 'state.expired.title',
  attempt,
});

async function page<T>(path: string): Promise<ServerPage<T>> {
  const client = await authorizedClient();
  if (!client) return { ...EMPTY, status: 'expired', correlationId: null };
  const result = await client.get<CursorPage<T>>(path);
  if (!result.ok) {
    return { ...EMPTY, status: STATUS_BY_KIND[result.kind], correlationId: result.correlationId };
  }
  return {
    status: 'ok',
    rows: result.data.items,
    nextCursor: result.data.nextCursor,
    hasMore: result.data.hasMore,
    correlationId: result.correlationId,
  };
}

/** The item catalogue (`inv.item-search`), tenant-wide, one page at a time. */
export async function listItems(
  criteria: ItemSearchCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<InventoryItem>> {
  return page<InventoryItem>(
    '/api/v1/items' +
      query({
        categoryId: criteria.categoryId,
        itemType: criteria.itemType,
        lifecycleStatus: criteria.lifecycleStatus,
        stockTrackedOnly: criteria.stockTrackedOnly,
        search: criteria.search,
        cursor,
        limit: request.pageSize,
      })
  );
}

/**
 * Stock availability (`inv.stock-availability-read`) for one branch — one row
 * per (item, location) cell, quarantine excluded unless asked for.
 */
export async function listAvailability(
  target: StockTarget,
  criteria: AvailabilityCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<StockAvailability>> {
  return page<StockAvailability>(
    '/api/v1/stock-availability' +
      branchTargetQuery(target, {
        itemId: criteria.itemId,
        locationId: criteria.locationId,
        includeQuarantine: criteria.includeQuarantine,
        cursor,
        limit: request.pageSize,
      })
  );
}

/** The reservations of one branch (`inv.stock-reservation-list`), newest first. */
export async function listReservations(
  target: StockTarget,
  criteria: ReservationCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<StockReservation>> {
  return page<StockReservation>(
    '/api/v1/stock-reservations' +
      branchTargetQuery(target, {
        itemId: criteria.itemId,
        locationId: criteria.locationId,
        workOrderId: criteria.workOrderId,
        status: criteria.status,
        cursor,
        limit: request.pageSize,
      })
  );
}

/**
 * The locations of one branch (`inv.stock-location-list`), for the pickers.
 * One page of the route's maximum; the screen reads `hasMore` rather than
 * assuming the branch fitted.
 */
export async function listLocations(
  target: StockTarget
): Promise<ReadState<CursorPage<StockLocation>>> {
  return readOperation<CursorPage<StockLocation>>(
    '/api/v1/stock-locations' + branchTargetQuery(target, { limit: 100 })
  );
}

/** The tenant's branches (`org.branch-list`), for the target picker; its refusal is its own. */
export async function listBranches(): Promise<ReadState<ItemsOnly<BranchOption>>> {
  return readOperation<ItemsOnly<BranchOption>>('/api/v1/org/branches');
}

/** The part issues of one work order (`inv.work-order-part-issue-list`), newest first; the parent is the target. */
export async function listPartIssues(
  workOrderId: string,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<PartIssue>> {
  return page<PartIssue>(
    `/api/v1/work-orders/${encodeURIComponent(workOrderId)}/part-issues` +
      query({ cursor, limit: request.pageSize })
  );
}

/** The required parts of one work order (`wo.required-part-list`) — a bounded list, no page. */
export async function listRequiredParts(
  workOrderId: string
): Promise<ReadState<ItemsOnly<RequiredPart>>> {
  return readOperation<ItemsOnly<RequiredPart>>(
    `/api/v1/work-orders/${encodeURIComponent(workOrderId)}/required-parts`
  );
}

/**
 * The movement ledger of one branch (`inv.stock-movement-list`), newest
 * sequence first. AUDITED on the server — call it on an explicit action only.
 */
export async function listMovements(
  target: StockTarget,
  criteria: MovementCriteria,
  request: TableRequest,
  cursor: string | null
): Promise<ServerPage<StockMovement>> {
  return page<StockMovement>(
    '/api/v1/stock-movements' +
      branchTargetQuery(target, {
        itemId: criteria.itemId,
        locationId: criteria.locationId,
        workOrderId: criteria.workOrderId,
        movementType: criteria.movementType,
        referenceKind: criteria.referenceKind,
        occurredFrom: criteria.occurredFrom,
        occurredTo: criteria.occurredTo,
        cursor,
        limit: request.pageSize,
      })
  );
}

/* ------------------------------------------------------------------ *
 * Writes
 * ------------------------------------------------------------------ */

/**
 * Reserve stock (`inv.stock-reservation-create`). The server resolves the
 * location's branch and authorizes it; a fresh booking is 201, a replay of the
 * same key 200 with `replayed: true` — both are `ok` to the transport, and the
 * screen tells them apart from the body.
 */
export async function createReservation(
  body: StockReservationCreateBody,
  attempt = 1
): Promise<CreateOutcome<ReservationEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<ReservationEcho>('POST', '/api/v1/stock-reservations', body);
  if (!result.ok) return { state: refusalOf(result, attempt), created: null };
  return {
    state: {
      ...success('inventory.reserve.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/**
 * Issue parts to a work order (`inv.stock-issue-create`). The transport attaches
 * the header key. An issue against a reservation consumes it; one larger than
 * the reservation is refused (409), which the screen renders as the refusal it
 * is.
 */
export async function createIssue(
  body: StockIssueCreateBody,
  attempt = 1
): Promise<CreateOutcome<IssueEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<IssueEcho>('POST', '/api/v1/stock-issues', body);
  if (!result.ok) return { state: refusalOf(result, attempt), created: null };
  return {
    state: { ...success('inventory.issue.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Return issued parts (`inv.stock-return-create`). The transport attaches the
 * header key. The echo carries the server's running `totalReturned` and the
 * `issuedQuantity` it is measured against, shown as stated.
 */
export async function createReturn(
  body: StockReturnCreateBody,
  attempt = 1
): Promise<CreateOutcome<ReturnEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<ReturnEcho>('POST', '/api/v1/stock-returns', body);
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: { ...success('inventory.return.success', attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * Release a reservation (`inv.stock-reservation-release`). Not marked
 * idempotent, so the transport sends no key; the server reports `replayed`
 * when the reservation was already past `active`. Releasing a consumed
 * reservation returns no stock — the parts left through an issue.
 */
export async function releaseReservation(
  reservationId: string,
  body: StockReservationReleaseBody,
  attempt = 1
): Promise<CreateOutcome<ReservationEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<ReservationEcho>(
    'POST',
    `/api/v1/stock-reservations/${encodeURIComponent(reservationId)}/release`,
    body
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('inventory.release.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/* ------------------------------------------------------------------ *
 * W10 — inventory setup and opening stock (CC-05)
 * ------------------------------------------------------------------ */

/**
 * The tenant's item categories (`inv.item-category-list`, `inv.item.read`).
 * Tenant-wide, code order, and small: one page of a hundred is the whole
 * catalogue of any workshop this phase serves; a longer one would say so in
 * `hasMore`, which the screen renders as a truncation note rather than hiding.
 */
export async function listItemCategories(): Promise<ReadState<CursorPage<ItemCategory>>> {
  return readOperation<CursorPage<ItemCategory>>(`/api/v1/item-categories${query({ limit: 100 })}`);
}

/**
 * The units a tenant may count in (`inv.uom-list`, `inv.item.read`): the
 * platform set plus the tenant's own. No tenant unit WRITER exists (register
 * area B, B-22), so the screen offers this list and says where it comes from.
 */
export async function listUnitsOfMeasure(): Promise<ReadState<ItemsOnly<UnitOfMeasureOption>>> {
  return readOperation<ItemsOnly<UnitOfMeasureOption>>('/api/v1/units-of-measure');
}

/**
 * Create a category (`inv.item-category-create`). Tenant-wide: requires
 * `inv.item.manage` held tenant-wide, which the server checks and the screen
 * cannot; a branch-scoped holder is refused with 403 and the screen renders
 * that as the refusal it is. The transport attaches the idempotency key.
 */
export async function createItemCategory(
  body: ItemCategoryCreateBody,
  attempt = 1
): Promise<CreateOutcome<ItemCategory>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<ItemCategory>('POST', '/api/v1/item-categories', body);
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('inventory.setup.category.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/**
 * Create a catalogue item (`inv.item-create`). A row and nothing else: no
 * cost, no stock. The echo is the same shape the item search publishes, so a
 * created item can be shown beside the search results without a second read.
 */
export async function createItem(
  body: ItemCreateBody,
  attempt = 1
): Promise<CreateOutcome<InventoryItem>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<InventoryItem>('POST', '/api/v1/items', body);
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('inventory.setup.item.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/**
 * Create a stock location (`inv.stock-location-create`). Branch-scoped by the
 * pair in the body; the hierarchy rules (a warehouse has no parent, storage
 * and quarantine need a warehouse parent of the same branch) are the server's,
 * stated by the field, and the form repeats only the two it can know before
 * sending.
 */
export async function createStockLocation(
  body: StockLocationCreateBody,
  attempt = 1
): Promise<CreateOutcome<CreatedStockLocation>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<CreatedStockLocation>('POST', '/api/v1/stock-locations', body);
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('inventory.setup.location.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/**
 * The opening batches of one branch (`inv.opening-batch-list`,
 * `inv.stock.read`), newest first.
 *
 * Branch-targeted like every other stock read: the route names `companyId` and
 * `branchId` as required and re-authorizes that pair, so the target travels
 * through `branchTargetQuery`. One page of fifty, and the caller reads
 * `hasMore` rather than assuming the branch fitted — the screen says so instead
 * of pretending it listed everything.
 *
 * No `status` filter is sent. The route accepts one and the screen shows every
 * batch with the status the server gave it: an approver looking for something
 * to approve and an operator returning to their own draft are both served by
 * one list, and a filter nothing sends would be surface with no consumer.
 */
export async function listOpeningBatches(
  target: StockTarget
): Promise<ReadState<CursorPage<OpeningBatchSummary>>> {
  return readOperation<CursorPage<OpeningBatchSummary>>(
    '/api/v1/opening-inventory-batches' + branchTargetQuery(target, { limit: 50 })
  );
}

/**
 * One batch with its counted lines (`inv.opening-batch-read`, `inv.stock.read`).
 *
 * The path names the batch and nothing else — the server decides scope from the
 * row's own company and branch, and answers 404 for a batch it will not show
 * before it decides anything, so a `not-found` here says nothing about whether
 * the id exists elsewhere. Quantities arrive as decimal strings and are passed
 * through untouched.
 */
export async function readOpeningBatch(batchId: string): Promise<ReadState<OpeningBatchDetail>> {
  return readOperation<OpeningBatchDetail>(
    `/api/v1/opening-inventory-batches/${encodeURIComponent(batchId)}`
  );
}

/**
 * Open an opening-inventory batch (`inv.opening-batch-create`). The batch is
 * the only path by which stock first appears. The echo is what the screen shows
 * immediately; the batch itself is then reachable through
 * `listOpeningBatches` and `readOpeningBatch`, which is how a reload, a new
 * sign-in, or the second person reaches it.
 */
export async function createOpeningBatch(
  body: OpeningBatchCreateBody,
  attempt = 1
): Promise<CreateOutcome<OpeningBatch>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<OpeningBatch>('POST', '/api/v1/opening-inventory-batches', body);
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('inventory.opening.batch.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/** Add a counted line to a draft batch (`inv.opening-batch-line-create`). `quantity` is the exact decimal string. */
export async function createOpeningBatchLine(
  batchId: string,
  body: OpeningBatchLineCreateBody,
  attempt = 1
): Promise<CreateOutcome<OpeningBatchLine>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<OpeningBatchLine>(
    'POST',
    `/api/v1/opening-inventory-batches/${encodeURIComponent(batchId)}/lines`,
    body
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('inventory.opening.line.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/**
 * Approve a batch (`inv.opening-batch-approve`), which posts the opening
 * movements. Bodyless: the batch is in the path and the approver is the
 * caller. The server refuses the person who counted it (409, maker ≠
 * checker) — the screen renders that refusal as published and offers nothing
 * around it.
 */
export async function approveOpeningBatch(
  batchId: string,
  attempt = 1
): Promise<CreateOutcome<OpeningBatch>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<OpeningBatch>(
    'POST',
    `/api/v1/opening-inventory-batches/${encodeURIComponent(batchId)}/approval`,
    undefined
  );
  if (!result.ok) return { state: fromFailure(result, attempt), created: null };
  return {
    state: {
      ...success('inventory.opening.approve.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/* ------------------------------------------------------------------ *
 * P1-32 — stock operations: transfers, goods receipts, cost history,
 * adjustments and counts
 * ------------------------------------------------------------------ */

/** The server's catalogue code for a refused state change. */
const STATE_REFUSED = 'ERR-TRN-001';
/** The server's catalogue code for a work-order draw its material requirement does not allow. */
const DRAW_REFUSED = 'ERR-INV-001';
/** The server's catalogue code for a resource this organisation does not have. */
const RESOURCE_MISSING = 'ERR-RES-001';

/**
 * What a `404 ERR-RES-001` means for one particular write (DEF-T-14).
 *
 * A generic not-found title is the right sentence when the thing addressed in
 * the PATH is absent. It is the wrong sentence when the path resolved and
 * something the BODY named did not: setting a price in a currency the
 * organisation does not carry answered "Not found" with a correlation
 * reference and nothing else, on a form whose currency box is free text and
 * whose screen publishes no list of the currencies that exist.
 *
 * This carries the caller's own sentence for that case and the field it belongs
 * beside. The rule of `client.ts` holds: where the server cannot distinguish a
 * cause, the cause is not guessed at — the sentence names every candidate the
 * server named and claims to know which only when the server does.
 */
interface MissingResourceNote {
  readonly messageKey: string;
  readonly field: string;
  readonly fieldKey: string;
}

/**
 * A failure as the operator should read it.
 *
 * `fromFailure` maps a failure KIND to a sentence, and every 409 is one kind.
 * The server's own message never reaches the wire (`problemFor` publishes the
 * catalogue entry and the safe details only), so the reason an operator needs
 * is recovered from what IS published:
 *
 * - `ERR-INV-001` carries `materialDraw.reason`, one of five published values,
 *   and each has its own sentence naming the remedy;
 * - `ERR-TRN-001` means the record's state refuses the act, and the act is
 *   known here, so the caller names the sentence that says what the state
 *   refuses (`stateRefusedKey`).
 *
 * A banner that already names a specific violation keeps it: that is the more
 * precise reason, and replacing it would downgrade the message.
 */
function refusalOf(
  failure: ApiFailure,
  attempt: number,
  stateRefusedKey?: string,
  missing?: MissingResourceNote
): ActionState {
  const state = fromFailure(failure, attempt);
  if (state.messageKey?.startsWith(VIOLATION_KEY_PREFIX) === true) return state;
  const code = failure.problem?.code;
  const draw = failure.problem?.materialDraw;
  if (
    code === DRAW_REFUSED &&
    draw !== undefined &&
    (MATERIAL_DRAW_REASONS as readonly string[]).includes(draw.reason)
  ) {
    return { ...state, messageKey: `inventory.refusal.materialDraw.${draw.reason}` };
  }
  if (code === STATE_REFUSED && stateRefusedKey !== undefined) {
    return { ...state, messageKey: stateRefusedKey };
  }
  if (code === RESOURCE_MISSING && missing !== undefined) {
    return {
      ...state,
      messageKey: missing.messageKey,
      fieldErrors: { ...(state.fieldErrors ?? {}), [missing.field]: missing.fieldKey },
    };
  }
  return state;
}

/**
 * One unguarded POST or PUT whose answer the screen holds on to, with the refusal
 * said plainly. The two version-guarded writes below do NOT go through here: a
 * guarded send is written out with its literal path so the version-sourcing
 * gates can attribute it.
 */
async function write<T>(
  method: 'POST' | 'PUT',
  path: string,
  body: unknown,
  successKey: string,
  attempt: number,
  options: {
    readonly stateRefusedKey?: string;
    readonly idempotencyKey?: string;
    readonly missing?: MissingResourceNote;
  } = {}
): Promise<CreateOutcome<T>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<T>(
    method,
    path,
    body,
    options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }
  );
  if (!result.ok) {
    return {
      state: refusalOf(result, attempt, options.stateRefusedKey, options.missing),
      created: null,
    };
  }
  return {
    state: { ...success(successKey, attempt), correlationId: result.correlationId },
    created: result.data,
  };
}

/**
 * A branch's transfers (`inv.stock-transfer-list`), newest first, read as the
 * sender (`outbound`) or as the destination (`inbound`). One page of fifty; the
 * screen says so when `hasMore` is set.
 */
export async function listTransfers(
  target: StockTarget,
  direction: TransferDirection
): Promise<ReadState<CursorPage<StockTransfer>>> {
  return readOperation<CursorPage<StockTransfer>>(
    '/api/v1/stock-transfers' + branchTargetQuery(target, { direction, limit: 50 })
  );
}

/**
 * Dispatch a transfer (`inv.stock-transfer-create`): the quantity leaves the
 * source and sits in transit. A replay of the body key answers the transfer
 * already made with `replayed: true`.
 */
export async function createTransfer(
  body: StockTransferCreateBody,
  attempt = 1
): Promise<CreateOutcome<TransferEcho>> {
  return write<TransferEcho>(
    'POST',
    '/api/v1/stock-transfers',
    body,
    'inventory.transfers.create.success',
    attempt,
    { stateRefusedKey: 'inventory.transfers.create.refused' }
  );
}

/**
 * Receive what arrived (`inv.stock-transfer-receive`). Less than is still in
 * transit leaves the transfer partly received; the echo carries the server's
 * `outstandingQuantity`, which the screen shows as stated.
 */
export async function receiveTransfer(
  transferId: string,
  body: StockTransferReceiveBody,
  attempt = 1
): Promise<CreateOutcome<TransferEcho>> {
  return write<TransferEcho>(
    'POST',
    `/api/v1/stock-transfers/${encodeURIComponent(transferId)}/receipt`,
    body,
    'inventory.transfers.receive.success',
    attempt,
    { stateRefusedKey: 'inventory.transfers.receive.refused' }
  );
}

/** Cancel a dispatched transfer (`inv.stock-transfer-cancel`); the quantity returns to the origin. */
export async function cancelTransfer(
  transferId: string,
  body: StockTransferCancelBody,
  attempt = 1
): Promise<CreateOutcome<TransferEcho>> {
  return write<TransferEcho>(
    'POST',
    `/api/v1/stock-transfers/${encodeURIComponent(transferId)}/cancellation`,
    body,
    'inventory.transfers.cancel.success',
    attempt,
    { stateRefusedKey: 'inventory.transfers.cancel.refused' }
  );
}

/**
 * Settle units that did not arrive (`inv.stock-transfer-discrepancy-resolve`):
 * back to the origin at once, or a write-off that waits for a second person.
 *
 * The settlement keeps the HEADER key for its whole life (there is no body key),
 * so the screen passes one key per opened form: pressing the button again after
 * a lost answer replays the first settlement instead of returning the units twice.
 */
export async function resolveTransferDiscrepancy(
  transferId: string,
  body: StockTransferDiscrepancyResolveBody,
  idempotencyKey: string,
  attempt = 1
): Promise<CreateOutcome<TransferSettlementEcho>> {
  return write<TransferSettlementEcho>(
    'POST',
    `/api/v1/stock-transfers/${encodeURIComponent(transferId)}/discrepancy-resolution`,
    body,
    body.kind === 'write_off'
      ? 'inventory.transfers.resolve.writeOffRequested'
      : 'inventory.transfers.resolve.returned',
    attempt,
    { stateRefusedKey: 'inventory.transfers.resolve.refused', idempotencyKey }
  );
}

/**
 * A branch's write-offs (`inv.stock-transfer-settlement-list`), for transfers it
 * sent or is receiving, newest first, narrowed to one decision. One page of fifty.
 */
export async function listTransferWriteOffs(
  target: StockTarget,
  status: SettlementDecision
): Promise<ReadState<CursorPage<TransferSettlement>>> {
  return readOperation<CursorPage<TransferSettlement>>(
    '/api/v1/stock-transfer-settlements' +
      branchTargetQuery(target, { kind: 'write_off', status, limit: 50 })
  );
}

/**
 * Approve or reject a pending write-off (`inv.stock-transfer-write-off-decide`).
 * Refused (409) for the requester and for a write-off already decided; the
 * transport attaches the idempotency key the operation is published with.
 */
export async function decideTransferWriteOff(
  settlementId: string,
  body: StockTransferWriteOffDecideBody,
  attempt = 1
): Promise<CreateOutcome<TransferSettlementEcho>> {
  return write<TransferSettlementEcho>(
    'POST',
    `/api/v1/stock-transfer-settlements/${encodeURIComponent(settlementId)}/decision`,
    body,
    body.decision === 'approved'
      ? 'inventory.transfers.writeOffs.decide.approved'
      : 'inventory.transfers.writeOffs.decide.rejected',
    attempt,
    { stateRefusedKey: 'inventory.transfers.writeOffs.decide.refused' }
  );
}

/** A branch's goods receipts (`inv.goods-receipt-list`), newest first, one page of fifty. */
export async function listGoodsReceipts(
  target: StockTarget
): Promise<ReadState<CursorPage<GoodsReceiptSummary>>> {
  return readOperation<CursorPage<GoodsReceiptSummary>>(
    '/api/v1/goods-receipts' + branchTargetQuery(target, { limit: 50 })
  );
}

/** One receipt with its lines (`inv.goods-receipt-read`); lines say whether they are priced, never the figure. */
export async function readGoodsReceipt(receiptId: string): Promise<ReadState<GoodsReceiptDetail>> {
  return readOperation<GoodsReceiptDetail>(
    `/api/v1/goods-receipts/${encodeURIComponent(receiptId)}`
  );
}

/** Create a DRAFT receipt with its lines (`inv.goods-receipt-create`). Nothing is on hand until it is posted. */
export async function createGoodsReceipt(
  body: GoodsReceiptCreateBody,
  attempt = 1
): Promise<CreateOutcome<GoodsReceiptDetail>> {
  return write<GoodsReceiptDetail>(
    'POST',
    '/api/v1/goods-receipts',
    body,
    'inventory.receipts.create.success',
    attempt,
    { stateRefusedKey: 'inventory.receipts.create.refused' }
  );
}

/**
 * Post a draft receipt (`inv.goods-receipt-post`). Bodyless; `ifMatch` is the
 * RECEIPT's `recordVersion` exactly as the last read or write answered it.
 */
export async function postGoodsReceipt(
  receiptId: string,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<GoodsReceiptDetail>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<GoodsReceiptDetail>(
    'POST',
    `/api/v1/goods-receipts/${encodeURIComponent(receiptId)}/posting`,
    undefined,
    { ifMatch }
  );
  if (!result.ok) {
    return {
      state: refusalOf(result, attempt, 'inventory.receipts.post.refused'),
      created: null,
    };
  }
  return {
    state: {
      ...success('inventory.receipts.post.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/**
 * An item's cost history in one branch (`inv.item-cost-history-read`,
 * `inv.cost.view`): the latest unit cost, the weighted average the server
 * computed, and the newest layers.
 */
export async function readItemCostHistory(
  itemId: string,
  target: StockTarget
): Promise<ReadState<ItemCostHistory>> {
  return readOperation<ItemCostHistory>(
    `/api/v1/items/${encodeURIComponent(itemId)}/cost-history` +
      branchTargetQuery(target, { limit: 20 })
  );
}

/** A branch's stock adjustments (`inv.stock-adjustment-list`), newest first, optionally one status. */
export async function listAdjustments(
  target: StockTarget,
  status: AdjustmentState | null
): Promise<ReadState<CursorPage<StockAdjustment>>> {
  return readOperation<CursorPage<StockAdjustment>>(
    '/api/v1/stock-adjustments' + branchTargetQuery(target, { status, limit: 50 })
  );
}

/** Request an adjustment (`inv.stock-adjustment-create`): pending, no stock effect, until a second person approves. */
export async function createAdjustment(
  body: StockAdjustmentCreateBody,
  attempt = 1
): Promise<CreateOutcome<AdjustmentEcho>> {
  return write<AdjustmentEcho>(
    'POST',
    '/api/v1/stock-adjustments',
    body,
    'inventory.adjustments.create.success',
    attempt,
    { stateRefusedKey: 'inventory.adjustments.create.refused' }
  );
}

/**
 * Approve or reject a pending adjustment (`inv.stock-adjustment-approve`).
 * Refused (409) for the requester and for an adjustment already decided.
 */
export async function decideAdjustment(
  adjustmentId: string,
  body: StockAdjustmentApproveBody,
  attempt = 1
): Promise<CreateOutcome<AdjustmentEcho>> {
  return write<AdjustmentEcho>(
    'POST',
    `/api/v1/stock-adjustments/${encodeURIComponent(adjustmentId)}/approval`,
    body,
    body.decision === 'approved'
      ? 'inventory.adjustments.decide.approved'
      : 'inventory.adjustments.decide.rejected',
    attempt,
    { stateRefusedKey: 'inventory.adjustments.decide.refused' }
  );
}

/** A branch's stock counts (`inv.stock-count-list`) with the server's variance figures, newest first. */
export async function listStockCounts(
  target: StockTarget
): Promise<ReadState<CursorPage<StockCountSummary>>> {
  return readOperation<CursorPage<StockCountSummary>>(
    '/api/v1/stock-counts' + branchTargetQuery(target, { limit: 50 })
  );
}

/** One count with its lines, movements during the count and variances (`inv.stock-count-read`). */
export async function readStockCount(countId: string): Promise<ReadState<StockCountDetail>> {
  return readOperation<StockCountDetail>(`/api/v1/stock-counts/${encodeURIComponent(countId)}`);
}

/** Open a count of one location (`inv.stock-count-open`), snapshotting what it holds. */
export async function openStockCount(
  body: StockCountOpenBody,
  attempt = 1
): Promise<CreateOutcome<StockCountDetail>> {
  return write<StockCountDetail>(
    'POST',
    '/api/v1/stock-counts',
    body,
    'inventory.counts.open.success',
    attempt,
    { stateRefusedKey: 'inventory.counts.open.refused' }
  );
}

/**
 * Record the counted quantity of one item (`inv.stock-count-line-record`).
 * `ifMatch` is the COUNT's `recordVersion` as the last read or write answered it;
 * the answer is the whole count again, with the server's new variance.
 */
export async function recordStockCountLine(
  countId: string,
  itemId: string,
  body: StockCountLineRecordBody,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<StockCountDetail>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<StockCountDetail>(
    'PUT',
    `/api/v1/stock-counts/${encodeURIComponent(countId)}/lines/${encodeURIComponent(itemId)}`,
    body,
    { ifMatch }
  );
  if (!result.ok) {
    return { state: refusalOf(result, attempt, 'inventory.counts.closed'), created: null };
  }
  return {
    state: {
      ...success('inventory.counts.line.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}

/** Reconcile a count (`inv.stock-count-reconcile`): each variance raises a PENDING adjustment; nothing posts. */
export async function reconcileStockCount(
  countId: string,
  attempt = 1
): Promise<CreateOutcome<StockCountDetail>> {
  return write<StockCountDetail>(
    'POST',
    `/api/v1/stock-counts/${encodeURIComponent(countId)}/reconciliation`,
    undefined,
    'inventory.counts.reconcile.success',
    attempt,
    { stateRefusedKey: 'inventory.counts.closed' }
  );
}

/** Cancel an open count (`inv.stock-count-cancel`) without raising any adjustment. */
export async function cancelStockCount(
  countId: string,
  body: StockCountCancelBody,
  attempt = 1
): Promise<CreateOutcome<StockCountDetail>> {
  return write<StockCountDetail>(
    'POST',
    `/api/v1/stock-counts/${encodeURIComponent(countId)}/cancellation`,
    body,
    'inventory.counts.cancel.success',
    attempt,
    { stateRefusedKey: 'inventory.counts.closed' }
  );
}

/* ------------------------------------------------------------------ *
 * P1-32 — identifiers, scanning, labels, selling prices and returns.
 *
 * Three of these reads name the ITEM in the path and take no query at all:
 * `inv.item_master` has no company or branch column, so an identifier, a label
 * and a price list are tenant-wide and the item is the authorization subject.
 * `inv.barcode-resolve` is tenant-wide too and takes a branch ONLY when the
 * caller also wants the item's stock there — which the server additionally
 * gates on `inv.stock.read` at that concrete branch, because holding
 * `inv.item.read` is not authority to read stock.
 *
 * The two returns reads are branch-shaped in different ways.
 * `inv.sales-return-list` is addressed to a branch like every other stock list.
 * `inv.returnable-quantity-read` names a SOURCE, not a branch: the server
 * resolves the company and branch from the source row itself, so a caller
 * cannot learn what a branch it holds no authority in has sold.
 *
 * Nothing here is version-guarded. The identifier and return writes are marked
 * idempotent, so the transport attaches the header key — and the screens derive
 * that key ONCE per user confirmation, which is what makes a doubled scanner
 * frame replay the first write instead of writing twice.
 * ------------------------------------------------------------------ */

const itemPath = (itemId: string, suffix: string) =>
  `/api/v1/items/${encodeURIComponent(itemId)}${suffix}`;

/**
 * An item's codes (`inv.item-identifier-list`), live ones first.
 *
 * `includeRetired` asks for the retired rows as well, so a person can see that a
 * code was withdrawn rather than wonder where it went.
 */
export async function listIdentifiers(
  itemId: string,
  includeRetired = false
): Promise<ReadState<ItemIdentifierList>> {
  return readOperation<ItemIdentifierList>(
    itemPath(itemId, '/identifiers') + query({ includeRetired: includeRetired ? 'true' : null })
  );
}

/**
 * What a label printer needs for one item (`inv.item-label-data`): the stock
 * code, the name, the code to print with its symbology hint, and the unit and
 * pack quantity that code stands for. No price — the read is tenant-wide and a
 * price is narrowed to a branch, so there is no single figure it could publish.
 */
export async function readItemLabel(itemId: string): Promise<ReadState<ItemLabel>> {
  return readOperation<ItemLabel>(itemPath(itemId, '/label'));
}

/**
 * Resolve a scanned code to its item (`inv.barcode-resolve`).
 *
 * `at` asks for the item's stock at one branch as well; omit it and
 * `availability` comes back null. A code carried by more than one item is
 * REFUSED rather than resolved to either — the screen says which, and offers no
 * choice, because choosing would put the wrong part on a customer's bill in
 * exactly the case the operator cannot see.
 */
export async function resolveBarcode(
  value: string,
  at: (StockTarget & { readonly locationId?: string }) | null = null
): Promise<ReadState<BarcodeResolution>> {
  const path = `/api/v1/barcodes/${encodeURIComponent(value)}`;
  return readOperation<BarcodeResolution>(
    at === null ? path : path + branchTargetQuery(at, { locationId: at.locationId ?? null })
  );
}

/**
 * An item's configured selling prices (`inv.item-sale-price-list`), most
 * specific first: branch rows, then company rows, then the tenant-wide row. Each
 * is the server's exact decimal string, labelled with what it applies to.
 */
export async function listSalePrices(itemId: string): Promise<ReadState<ItemSalePriceList>> {
  return readOperation<ItemSalePriceList>(itemPath(itemId, '/sale-prices'));
}

/**
 * How much of a source may still come back (`inv.returnable-quantity-read`).
 *
 * Three figures, always: what left, what has already come back, and the
 * remainder. ADVISORY — the binding ceiling is re-checked under the source row
 * lock when the return is received, so two counters reading the same remainder
 * still produce one winner.
 */
export async function readReturnable(
  sourceKind: SalesReturnSourceKind,
  sourceId: string
): Promise<ReadState<ReturnableQuantity>> {
  return readOperation<ReturnableQuantity>(
    '/api/v1/returnable-quantities' + query({ sourceKind, sourceId })
  );
}

/** A branch's received returns (`inv.sales-return-list`), newest first. */
export async function listSalesReturns(
  target: StockTarget,
  filter: { readonly condition?: ReturnCondition | undefined } = {}
): Promise<ReadState<CursorPage<SalesReturnRow>>> {
  return readOperation<CursorPage<SalesReturnRow>>(
    '/api/v1/sales-returns' +
      branchTargetQuery(target, { condition: filter.condition ?? null, limit: 50 })
  );
}

/**
 * Attach a code to an item (`inv.item-identifier-add`).
 *
 * The value is the code printed on the part or its packaging; nothing here
 * invents a manufacturer code. The database generates the normalised form and
 * checks the retail check digit, so a mistyped GTIN is refused with the field
 * named rather than stored. `idempotencyKey` is derived once per user
 * confirmation, so a doubled scanner frame replays the first write.
 */
export async function addIdentifier(
  itemId: string,
  body: ItemIdentifierAddBody,
  idempotencyKey: string,
  attempt = 1
): Promise<CreateOutcome<ItemIdentifierEcho>> {
  return write<ItemIdentifierEcho>(
    'POST',
    itemPath(itemId, '/identifiers'),
    body,
    'inventory.identifiers.add.success',
    attempt,
    { stateRefusedKey: 'inventory.identifiers.add.refused', idempotencyKey }
  );
}

/**
 * Withdraw a code (`inv.item-identifier-retire`). No body: the item and the
 * identifier are the path, and the caller is the actor. A retired code stops
 * matching a scan and stays visible as withdrawn.
 */
export async function retireIdentifier(
  itemId: string,
  identifierId: string,
  attempt = 1
): Promise<CreateOutcome<ItemIdentifierEcho>> {
  return write<ItemIdentifierEcho>(
    'POST',
    itemPath(itemId, `/identifiers/${encodeURIComponent(identifierId)}/retirement`),
    undefined,
    'inventory.identifiers.retire.success',
    attempt,
    { stateRefusedKey: 'inventory.identifiers.retire.refused' }
  );
}

/**
 * Allocate this tenant's next internal code for an item
 * (`inv.item-barcode-assign`). No body at all: the code comes from the tenant's
 * own counter under an advisory lock, never from the client — which is why an
 * internal code can never collide with, or be mistaken for, a manufacturer one.
 */
export async function assignInternalBarcode(
  itemId: string,
  attempt = 1
): Promise<CreateOutcome<ItemIdentifierEcho>> {
  return write<ItemIdentifierEcho>(
    'POST',
    itemPath(itemId, '/internal-barcode'),
    undefined,
    'inventory.identifiers.internal.success',
    attempt,
    { stateRefusedKey: 'inventory.identifiers.internal.refused' }
  );
}

/**
 * Set what the tenant sells an item for (`inv.item-sale-price-set`).
 *
 * Exactly one live row exists per (item, company, branch) signature, so this
 * SETS rather than appends and a repeated call changes nothing. The price is the
 * exact decimal string the operator typed; nothing on this side rounds, scales
 * or reformats it.
 *
 * DEF-T-14: the 404 this write can answer is usually NOT about the item in the
 * path. `inv.item_sale_prices` has a foreign key on each of the company, the
 * branch, the tax class and the currency, and the service maps every one of
 * them to `ERR-RES-001` with one message. The generic not-found title said none
 * of that, so a price refused for a currency the organisation does not carry
 * read as "Not found" and a correlation reference.
 *
 * The item is the fifth candidate and is named as one: `setSalePrice` calls
 * `requireItem` FIRST (`inventory-catalog-service.ts`), which raises the same
 * `ERR-RES-001` when the item in the path is gone — a screen left open across a
 * retirement reaches it. The server distinguishes none of the five in anything
 * this client may read, so the sentence below names all five rather than
 * asserting a cause. The currency box still carries a field message, because
 * that box is free text and no operation publishes the currencies the
 * organisation uses; that message says what is true only once the reader has
 * ruled the other candidates out, and claims nothing before then.
 */
export async function setSalePrice(
  itemId: string,
  body: ItemSalePriceSetBody,
  attempt = 1
): Promise<CreateOutcome<ItemSalePrice>> {
  return write<ItemSalePrice>(
    'POST',
    itemPath(itemId, '/sale-prices'),
    body,
    'inventory.prices.set.success',
    attempt,
    {
      stateRefusedKey: 'inventory.prices.set.refused',
      missing: {
        messageKey: 'inventory.prices.set.notInOrganisation',
        field: 'currencyCode',
        fieldKey: 'inventory.prices.set.currencyNotCarried',
      },
    }
  );
}

/**
 * Receive a returned part (`inv.sales-return-create`).
 *
 * The source bounds the quantity — the server re-checks the ceiling under the
 * source row lock and refuses a return beyond it (409) — and the condition
 * decides the shelf: `restockable` goes back into sellable stock, `damaged` into
 * the quarantine location the body names, where it is unavailable because of
 * where it sits. A return against an issued counter sale raises a PENDING credit
 * note, which a second person still approves; the echo carries its identifier.
 * `idempotencyKey` is derived once per confirmation, so a repeated scan of the
 * part being handed back replays the first receipt.
 */
export async function createSalesReturn(
  body: SalesReturnCreateBody,
  idempotencyKey: string,
  attempt = 1
): Promise<CreateOutcome<SalesReturnEcho>> {
  return write<SalesReturnEcho>(
    'POST',
    '/api/v1/sales-returns',
    body,
    'inventory.returns.create.success',
    attempt,
    { stateRefusedKey: 'inventory.returns.create.refused', idempotencyKey }
  );
}

/* ------------------------------------------------------------------ *
 * P1-32 — material demand control, and the two facts it depends on
 * ------------------------------------------------------------------ */

/**
 * A branch material requirements (`inv.material-requirement-list`), newest
 * first, narrowed to one work order by the parts screen.
 *
 * Every figure on a row is the server exact decimal string in the requirement
 * unit. Nothing here adds or subtracts: `remainingQuantity` is published, and a
 * remainder recomputed on this side would disagree with the server the moment a
 * draw landed between the read and the render.
 */
export async function listMaterialRequirements(
  target: StockTarget,
  filter: {
    readonly workOrderId?: string | undefined;
    readonly status?: MaterialRequirementState | undefined;
  } = {}
): Promise<ReadState<CursorPage<MaterialRequirement>>> {
  return readOperation<CursorPage<MaterialRequirement>>(
    '/api/v1/material-requirements' +
      branchTargetQuery(target, {
        workOrderId: filter.workOrderId ?? null,
        status: filter.status ?? null,
        limit: 100,
      })
  );
}

/**
 * One requirement and its exceptions (`inv.material-requirement-read`).
 *
 * The figures bind only when a draw reads them under the requirement lock, so
 * this read is what the screen SHOWS and never what it decides with: a draw
 * beyond the allowance is refused by the server, and the refusal is what the
 * operator is told.
 */
export async function readMaterialRequirement(
  requirementId: string
): Promise<ReadState<MaterialRequirementDetail>> {
  return readOperation<MaterialRequirementDetail>(
    `/api/v1/material-requirements/${encodeURIComponent(requirementId)}`
  );
}

/**
 * Ask for material for one service line (`inv.material-requirement-create`).
 *
 * `basis: 'specification'` asks the server to derive the allowance from the
 * confirmed specification for the work order vehicle. It is not refused when
 * there is none: the requirement is stored as `approval_required` naming the
 * fact that is missing, which is what the panel then renders.
 * `basis: 'entered'` carries an allowance the operator read somewhere and the
 * source they read it from — a capacity with no source is not accepted here,
 * and no field on this side is prefilled with a guess.
 */
export async function createMaterialRequirement(
  body: MaterialRequirementCreateBody,
  attempt = 1
): Promise<CreateOutcome<MaterialRequirementDetail>> {
  return write<MaterialRequirementDetail>(
    'POST',
    '/api/v1/material-requirements',
    body,
    'inventory.material.create.success',
    attempt,
    { stateRefusedKey: 'inventory.material.create.refused' }
  );
}

/**
 * Decide a requirement someone else asked for
 * (`inv.material-requirement-approve`).
 *
 * The requester may not decide it whatever codes they hold: the service refuses
 * them and a database constraint refuses them again. The panel hides the control
 * from the person who asked AND renders the server refusal if it ever arrives,
 * because a hidden control is a courtesy and the constraint is the rule.
 */
export async function decideMaterialRequirement(
  requirementId: string,
  body: MaterialRequirementApproveBody,
  attempt = 1
): Promise<CreateOutcome<MaterialRequirementDetail>> {
  return write<MaterialRequirementDetail>(
    'POST',
    `/api/v1/material-requirements/${encodeURIComponent(requirementId)}/approval`,
    body,
    'inventory.material.decide.success',
    attempt,
    { stateRefusedKey: 'inventory.material.decide.refused' }
  );
}

/**
 * Look again for the fact a requirement lacks
 * (`inv.material-requirement-recheck`). No body: the requirement is the path
 * and the caller is the actor. It either finds the newly confirmed
 * specification or the newly stated conversion and moves to `pending_approval`,
 * or stays where it is with the same reason.
 */
export async function recheckMaterialRequirement(
  requirementId: string,
  attempt = 1
): Promise<CreateOutcome<MaterialRequirementDetail>> {
  return write<MaterialRequirementDetail>(
    'POST',
    `/api/v1/material-requirements/${encodeURIComponent(requirementId)}/recheck`,
    undefined,
    'inventory.material.recheck.success',
    attempt,
    { stateRefusedKey: 'inventory.material.recheck.refused' }
  );
}

/**
 * Withdraw a requirement (`inv.material-requirement-cancel`). Refused while
 * anything is still committed against it — release or return the stock first.
 */
export async function cancelMaterialRequirement(
  requirementId: string,
  body: MaterialRequirementCancelBody,
  attempt = 1
): Promise<CreateOutcome<MaterialRequirementDetail>> {
  return write<MaterialRequirementDetail>(
    'POST',
    `/api/v1/material-requirements/${encodeURIComponent(requirementId)}/cancellation`,
    body,
    'inventory.material.cancel.success',
    attempt,
    { stateRefusedKey: 'inventory.material.cancel.refused' }
  );
}

/**
 * Ask for a FINITE extra quantity (`inv.material-exception-create`).
 *
 * An approved exception raises the allowance by exactly the quantity asked for,
 * in the requirement own unit. There is no unbounded exception and no second
 * allowance: the server states the resulting allowance on approval.
 */
export async function requestMaterialException(
  requirementId: string,
  body: MaterialExceptionCreateBody,
  attempt = 1
): Promise<CreateOutcome<MaterialException>> {
  return write<MaterialException>(
    'POST',
    `/api/v1/material-requirements/${encodeURIComponent(requirementId)}/exceptions`,
    body,
    'inventory.material.exception.success',
    attempt,
    { stateRefusedKey: 'inventory.material.exception.refused' }
  );
}

/**
 * Decide an exception (`inv.material-exception-decide`) — a different approver
 * again, refused for the person who asked.
 */
export async function decideMaterialException(
  exceptionId: string,
  body: MaterialExceptionDecideBody,
  attempt = 1
): Promise<CreateOutcome<MaterialException>> {
  return write<MaterialException>(
    'POST',
    `/api/v1/material-exceptions/${encodeURIComponent(exceptionId)}/decision`,
    body,
    'inventory.material.exceptionDecision.success',
    attempt,
    { stateRefusedKey: 'inventory.material.exceptionDecision.refused' }
  );
}

/**
 * Finish a material request (`inv.material-request-close`). The echo names the
 * reservations the closure released; a repeat answers the request already
 * closed with `replayed` and releases nothing a second time.
 */
export async function closeMaterialRequest(
  requestId: string,
  body: MaterialRequestCloseBody,
  attempt = 1
): Promise<CreateOutcome<MaterialRequestEcho>> {
  return write<MaterialRequestEcho>(
    'POST',
    `/api/v1/material-requests/${encodeURIComponent(requestId)}/closure`,
    body,
    'inventory.material.request.close.success',
    attempt,
    { stateRefusedKey: 'inventory.material.request.close.refused' }
  );
}

/** Withdraw a material request (`inv.material-request-cancel`), with its reason. */
export async function cancelMaterialRequest(
  requestId: string,
  body: MaterialRequestCancelBody,
  attempt = 1
): Promise<CreateOutcome<MaterialRequestEcho>> {
  return write<MaterialRequestEcho>(
    'POST',
    `/api/v1/material-requests/${encodeURIComponent(requestId)}/cancellation`,
    body,
    'inventory.material.request.cancel.success',
    attempt,
    { stateRefusedKey: 'inventory.material.request.cancel.refused' }
  );
}

/**
 * The tenant unit conversions (`inv.unit-conversion-list`), optionally the ones
 * that apply to one item — its own rows and the tenant-wide ones.
 */
export async function listUnitConversions(
  filter: {
    readonly itemId?: string | undefined;
    readonly includeRetired?: boolean | undefined;
  } = {}
): Promise<ReadState<CursorPage<UnitConversion>>> {
  return readOperation<CursorPage<UnitConversion>>(
    '/api/v1/unit-conversions' +
      query({
        itemId: filter.itemId ?? null,
        includeRetired: filter.includeRetired === true ? 'true' : null,
        limit: 100,
      })
  );
}

/**
 * State an exact conversion (`inv.unit-conversion-set`).
 *
 * One row says "1 from-unit = factor to-units" and nothing else. There is no
 * implied reverse — 1 / factor is not exact in general — so a conversion the
 * other way is a row of its own, stated by the same form. Stating a conversion
 * whose signature is already live retires the row it replaces in the same
 * transaction, so a changed factor is a new attributable fact and the old one
 * stays readable.
 */
export async function setUnitConversion(
  body: UnitConversionSetBody,
  attempt = 1
): Promise<CreateOutcome<UnitConversionEcho>> {
  return write<UnitConversionEcho>(
    'POST',
    '/api/v1/unit-conversions',
    body,
    'inventory.conversions.set.success',
    attempt,
    { stateRefusedKey: 'inventory.conversions.set.refused' }
  );
}

/**
 * Retire a conversion (`inv.unit-conversion-retire`). No body: the conversion is
 * the path and the caller is the actor. A retired row stops resolving and stays
 * readable as the fact it was.
 */
export async function retireUnitConversion(
  conversionId: string,
  attempt = 1
): Promise<CreateOutcome<UnitConversionEcho>> {
  return write<UnitConversionEcho>(
    'POST',
    `/api/v1/unit-conversions/${encodeURIComponent(conversionId)}/retirement`,
    undefined,
    'inventory.conversions.retire.success',
    attempt,
    { stateRefusedKey: 'inventory.conversions.retire.refused' }
  );
}

/** The tenant vehicle service specifications (`inv.vehicle-specification-list`), newest first. */
export async function listVehicleSpecifications(
  filter: {
    readonly makeId?: string | undefined;
    readonly modelId?: string | undefined;
    readonly serviceCondition?: string | undefined;
    readonly status?: VehicleSpecificationState | undefined;
  } = {}
): Promise<ReadState<CursorPage<VehicleSpecification>>> {
  return readOperation<CursorPage<VehicleSpecification>>(
    '/api/v1/vehicle-fluid-specifications' +
      query({
        makeId: filter.makeId ?? null,
        modelId: filter.modelId ?? null,
        serviceCondition: filter.serviceCondition ?? null,
        status: filter.status ?? null,
        limit: 100,
      })
  );
}

/**
 * Record a service capacity (`inv.vehicle-specification-create`), UNCONFIRMED.
 *
 * Recording resolves nothing. Only a confirmed specification answers for a
 * vehicle, and there is no zero capacity and no default: a vehicle no confirmed
 * specification answers for gets a requirement that says exactly that.
 */
export async function createVehicleSpecification(
  body: VehicleSpecificationCreateBody,
  attempt = 1
): Promise<CreateOutcome<VehicleSpecificationEcho>> {
  return write<VehicleSpecificationEcho>(
    'POST',
    '/api/v1/vehicle-fluid-specifications',
    body,
    'inventory.specifications.create.success',
    attempt,
    { stateRefusedKey: 'inventory.specifications.create.refused' }
  );
}

/**
 * Confirm a specification (`inv.vehicle-specification-confirm`). No body: the
 * specification is the path and the caller is the confirmer. From here a
 * derived requirement for a matching vehicle takes its allowance from it.
 */
export async function confirmVehicleSpecification(
  specificationId: string,
  attempt = 1
): Promise<CreateOutcome<VehicleSpecificationEcho>> {
  return write<VehicleSpecificationEcho>(
    'POST',
    `/api/v1/vehicle-fluid-specifications/${encodeURIComponent(specificationId)}/confirmation`,
    undefined,
    'inventory.specifications.confirm.success',
    attempt,
    { stateRefusedKey: 'inventory.specifications.confirm.refused' }
  );
}

/** Retire a specification (`inv.vehicle-specification-retire`). It stops answering for any vehicle. */
export async function retireVehicleSpecification(
  specificationId: string,
  attempt = 1
): Promise<CreateOutcome<VehicleSpecificationEcho>> {
  return write<VehicleSpecificationEcho>(
    'POST',
    `/api/v1/vehicle-fluid-specifications/${encodeURIComponent(specificationId)}/retirement`,
    undefined,
    'inventory.specifications.retire.success',
    attempt,
    { stateRefusedKey: 'inventory.specifications.retire.refused' }
  );
}

/* ------------------------------------------------------------------ *
 * Operational stock alerts (Owner directive) — four READS, no writes
 * ------------------------------------------------------------------ */

/*
 * HOW MANY FINDINGS ONE CARD ASKS FOR is declared in `inventory-contract.ts`,
 * not here, and it is imported above.
 *
 * This file carries `'use server'`, and such a module may export async
 * functions and types and nothing else: every other export is handed to the
 * client as a server reference, which is a thing a number cannot be. The gate
 * `validate:use-server-exports` says so, and it said so about this constant.
 * The figure is a contract value in any case — it describes what the cards ask
 * the server for — so the contract is where it belongs.
 */

/**
 * `inv.low-stock-alert-read` — what this branch is running out of.
 *
 * Branch-targeted like every other stock read: the pair is the read's TARGET
 * and is re-authorized server-side, so it travels through `branchTargetQuery`.
 * Nothing here computes: the shortfall and the preferred order quantity are the
 * server's own strings, and the preferred quantity is a SUGGESTION that orders
 * nothing.
 */
export async function readLowStockAlerts(
  target: StockTarget,
  limit: number = ALERT_PAGE_SIZE
): Promise<ReadState<LowStockAlerts>> {
  return readOperation<LowStockAlerts>(
    '/api/v1/inventory-alerts/low-stock' + branchTargetQuery(target, { limit })
  );
}

/** `inv.count-discrepancy-alert-read` — where the shelf and the ledger disagreed. */
export async function readCountDiscrepancyAlerts(
  target: StockTarget,
  limit: number = ALERT_PAGE_SIZE
): Promise<ReadState<CountDiscrepancyAlerts>> {
  return readOperation<CountDiscrepancyAlerts>(
    '/api/v1/inventory-alerts/count-discrepancies' + branchTargetQuery(target, { limit })
  );
}

/**
 * `inv.unusual-consumption-alert-read` — items leaving far faster than they have.
 *
 * The rule's numbers travel with the answer, so the card states the rule in the
 * reader's own language rather than printing the server's English sentence.
 * None of those numbers is sent: the server's published defaults decide the
 * window, and a screen that invented one would be asking a different question
 * from the one the card explains.
 */
export async function readUnusualConsumptionAlerts(
  target: StockTarget,
  limit: number = ALERT_PAGE_SIZE
): Promise<ReadState<UnusualConsumptionAlerts>> {
  return readOperation<UnusualConsumptionAlerts>(
    '/api/v1/inventory-alerts/unusual-consumption' + branchTargetQuery(target, { limit })
  );
}

/** `inv.aged-in-transit-alert-read` — consignments that left and have not arrived. */
export async function readAgedInTransitAlerts(
  target: StockTarget,
  limit: number = ALERT_PAGE_SIZE
): Promise<ReadState<AgedInTransitAlerts>> {
  return readOperation<AgedInTransitAlerts>(
    '/api/v1/inventory-alerts/aged-in-transit' + branchTargetQuery(target, { limit })
  );
}

/* ------------------------------------------------------------------ *
 * Reorder levels — what the low-stock rule reads (DEF-T-08)
 * ------------------------------------------------------------------ */

/**
 * `inv.reorder-level-list` — every configured level, `inv.stock.read`.
 *
 * NOT branch-targeted: a level may name no company at all, so the list is a
 * tenant read that the caller may NARROW by company and branch. That is why the
 * pair travels through `query()` as a filter rather than through
 * `branchTargetQuery` as an authorization target.
 *
 * Retired rows are left out unless asked for. A retired level is history — it
 * explains why an alert used to fire — and mixing it into the live list would
 * invite a reader to think it still governs something.
 */
export async function listReorderLevels(
  filter: {
    readonly itemId?: string | undefined;
    readonly companyId?: string | undefined;
    readonly branchId?: string | undefined;
    readonly includeRetired?: boolean | undefined;
  } = {}
): Promise<ReadState<ReorderLevelList>> {
  return readOperation<ReorderLevelList>(
    '/api/v1/reorder-levels' +
      query({
        itemId: filter.itemId ?? null,
        companyId: filter.companyId ?? null,
        branchId: filter.branchId ?? null,
        includeRetired: filter.includeRetired === true ? 'true' : null,
        limit: 100,
      })
  );
}

/**
 * `inv.reorder-level-set` — the quantity at or below which an item counts as low.
 *
 * Exactly one live row exists per signature, so this SETS rather than appends
 * and a repeated call answers `replayed: true` having changed nothing. Both
 * quantities are the exact decimal strings the operator typed; nothing here
 * rounds, scales or reformats them.
 */
export async function setReorderLevel(
  body: ReorderLevelSetBody,
  attempt = 1
): Promise<CreateOutcome<ReorderLevelEcho>> {
  return write<ReorderLevelEcho>(
    'POST',
    '/api/v1/reorder-levels',
    body,
    'inventory.reorderLevels.set.success',
    attempt,
    { stateRefusedKey: 'inventory.reorderLevels.set.refused' }
  );
}

/**
 * `inv.reorder-level-retire` — stop a level governing, keep it as history.
 *
 * Version-guarded, so it is written out with its literal path rather than going
 * through `write`: `ifMatch` is the LEVEL's own `recordVersion` exactly as the
 * last read or write answered it, never a list's and never defaulted. Retiring
 * an already-retired level changes nothing and answers `replayed: true`.
 */
export async function retireReorderLevel(
  reorderLevelId: string,
  ifMatch: number,
  attempt = 1
): Promise<CreateOutcome<ReorderLevelEcho>> {
  const client = await authorizedClient();
  if (!client) return { state: expired(attempt), created: null };
  const result = await client.send<ReorderLevelEcho>(
    'POST',
    `/api/v1/reorder-levels/${encodeURIComponent(reorderLevelId)}/retirement`,
    undefined,
    { ifMatch }
  );
  if (!result.ok) {
    return {
      state: refusalOf(result, attempt, 'inventory.reorderLevels.retire.refused'),
      created: null,
    };
  }
  return {
    state: {
      ...success('inventory.reorderLevels.retire.success', attempt),
      correlationId: result.correlationId,
    },
    created: result.data,
  };
}
