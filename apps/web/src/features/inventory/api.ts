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
  OpeningBatchCreateBody,
  OpeningBatchLineCreateBody,
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
} from '@/lib/contracts/inventory-contract';
import type { BranchOption } from '@/features/services/services-contract';
import {
  MATERIAL_DRAW_REASONS,
  type AdjustmentEcho,
  type AdjustmentState,
  type AvailabilityCriteria,
  type CreatedStockLocation,
  type GoodsReceiptDetail,
  type GoodsReceiptSummary,
  type InventoryItem,
  type IssueEcho,
  type ItemCategory,
  type ItemCostHistory,
  type ItemSearchCriteria,
  type MovementCriteria,
  type OpeningBatch,
  type OpeningBatchDetail,
  type OpeningBatchLine,
  type OpeningBatchSummary,
  type PartIssue,
  type RequiredPart,
  type ReservationCriteria,
  type ReservationEcho,
  type ReturnEcho,
  type StockAdjustment,
  type StockAvailability,
  type StockCountDetail,
  type StockCountSummary,
  type StockLocation,
  type StockMovement,
  type StockReservation,
  type StockTarget,
  type StockTransfer,
  type TransferDirection,
  type TransferEcho,
  type TransferSettlementEcho,
  type UnitOfMeasureOption,
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
function refusalOf(failure: ApiFailure, attempt: number, stateRefusedKey?: string): ActionState {
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
  options: { readonly stateRefusedKey?: string; readonly idempotencyKey?: string } = {}
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
    return { state: refusalOf(result, attempt, options.stateRefusedKey), created: null };
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
