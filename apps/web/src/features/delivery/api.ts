'use server';

import { authorizedClient } from '@/lib/api/server-client';
import type { ApiFailure } from '@/lib/api/client';
import { query, readOperation, type ReadState } from '@/lib/api/read-operation';
import { fromFailure, success, type ActionState } from '@/lib/forms/action-result';
import type {
  DeliveryChecklistRecordBody,
  DeliveryCompleteBody,
  DeliveryCreateBody,
  DeliveryReceiverVerifyBody,
  DeliverySignatureAttachBody,
} from '@/lib/contracts/delivery-contract';
import { ACTIVE_TEMPLATE_STATUS, DELIVERY_ERROR_CODES, PAGE_SIZE } from './delivery-contract';
import type {
  ActiveChecklist,
  ChecklistTemplateDetail,
  ChecklistTemplateListEnvelope,
  DeliveryChecklistResultsEnvelope,
  DeliveryEligibility,
  DeliveryReceiverEnvelope,
  DeliveryRecord,
  DeliverySignaturesEnvelope,
  DeliveryStatusHistoryEnvelope,
  WorkOrderDelivery,
} from './delivery-contract';

/**
 * The delivery adapters (P1-31, FE-002/003/004/006/007).
 *
 * The reads came first and rendered the custody chain. The writes below are the
 * execution slice, and each one exists because a control on the delivery screen
 * sends it: opening a handover, verifying its receiver, recording a checklist
 * outcome, binding a signature and completing the release. Nothing here is
 * declared ahead of the screen that calls it, which is how a dead declaration
 * gets in.
 *
 * Nothing here fetches. `readOperation` calls `authorizedClient()`, the only
 * network owner in this application, and turns a transport outcome into a view
 * state — so a refusal reaches the screen as a refusal and never as an empty
 * list, which an operator reads as "there is nothing here".
 *
 * ## Absence is a 200, and the screens rely on it
 *
 * A delivery with no verified receiver answers with `receiver: null`; a delivery
 * with no signatures answers with an empty page; a work order with no delivery
 * answers with `delivery: null`. None of those is a 404 and none is a refusal.
 * A `not-found` from any of these reads therefore means the SUBJECT could not be
 * resolved — a delivery in another branch, or an identifier that names nothing —
 * and the screens say exactly that.
 *
 * ## The eligibility read is not called speculatively
 *
 * It declares `sal.finance.view` on top of `sal.delivery.view` and answers 403
 * without it. The page decides that before it asks, so this adapter is never
 * reached by a caller the route would refuse. The function still maps a `denied`
 * faithfully, because the backend remains the authority and a grant can change
 * between the page's decision and the request.
 *
 * ## The cursor is the server's, and so is the end of the set
 *
 * `cursor` is passed back exactly as it arrived and never parsed; `hasMore` and
 * `nextCursor` are the server's own end-of-set signals. No total is requested
 * and none is invented.
 */

/**
 * The path of one delivery, or of one of its subresources.
 *
 * A function DECLARATION rather than an arrow constant, and that is not a style
 * choice. The P1-28 access gate resolves helper-built paths by parsing exactly
 * this shape, and this screen is inside its scope: a path it cannot resolve is
 * an operation it cannot see, and every permission the screen consults for that
 * operation is then reported as surplus privilege. A helper the gate can read is
 * how the least-privilege rule stays a measurement instead of a guess.
 */
function deliveryPath(deliveryId: string, suffix = ''): string {
  return `/api/v1/deliveries/${encodeURIComponent(deliveryId)}${suffix}`;
}

/** The delivery record itself (`sal.delivery-read`). */
export async function readDelivery(deliveryId: string): Promise<ReadState<DeliveryRecord>> {
  return readOperation<DeliveryRecord>(deliveryPath(deliveryId));
}

/**
 * Whether this delivery may complete, and every reason it may not
 * (`sal.delivery-eligibility-read`). Needs the financial read code as well as
 * the delivery one — see the file docblock.
 */
export async function readEligibility(deliveryId: string): Promise<ReadState<DeliveryEligibility>> {
  return readOperation<DeliveryEligibility>(deliveryPath(deliveryId, '/eligibility'));
}

/**
 * The verified receiver, or the fact that there is none yet
 * (`sal.delivery-receiver-read`). The identity-evidence field it carries is a
 * reference; nothing here asks for the document behind it.
 */
export async function readReceiver(
  deliveryId: string
): Promise<ReadState<DeliveryReceiverEnvelope>> {
  return readOperation<DeliveryReceiverEnvelope>(deliveryPath(deliveryId, '/authorized-receiver'));
}

/** The signatures collected so far, newest first (`sal.delivery-signature-list`). */
export async function listSignatures(
  deliveryId: string,
  cursor: string | null
): Promise<ReadState<DeliverySignaturesEnvelope>> {
  return readOperation<DeliverySignaturesEnvelope>(
    deliveryPath(deliveryId, '/signatures') + query({ cursor, limit: PAGE_SIZE })
  );
}

/** The checklist results recorded against this delivery (`sal.delivery-checklist-result-list`). */
export async function listChecklistResults(
  deliveryId: string,
  cursor: string | null
): Promise<ReadState<DeliveryChecklistResultsEnvelope>> {
  return readOperation<DeliveryChecklistResultsEnvelope>(
    deliveryPath(deliveryId, '/checklist-results') + query({ cursor, limit: PAGE_SIZE })
  );
}

/** The append-only transition ledger, newest first (`sal.delivery-status-history`). */
export async function listStatusHistory(
  deliveryId: string,
  cursor: string | null
): Promise<ReadState<DeliveryStatusHistoryEnvelope>> {
  return readOperation<DeliveryStatusHistoryEnvelope>(
    deliveryPath(deliveryId, '/status-history') + query({ cursor, limit: PAGE_SIZE })
  );
}

/**
 * The live delivery of one work order, or the fact that it has none
 * (`sal.work-order-delivery-read`).
 *
 * A delivery marked as an exception is reported by the backend as `null`. That
 * is the operation's contract and this adapter neither widens nor narrows it:
 * "no live delivery" is what the work-order screen states.
 */
export async function readWorkOrderDelivery(
  workOrderId: string
): Promise<ReadState<WorkOrderDelivery>> {
  return readOperation<WorkOrderDelivery>(
    `/api/v1/work-orders/${encodeURIComponent(workOrderId)}/delivery`
  );
}

/* ------------------------------------------------------------------------- *
 * The checklist configuration
 * ------------------------------------------------------------------------- */

/** How many template pages this assembly will walk before it stops asking. */
const MAX_TEMPLATE_PAGES = 20;

/**
 * Every item of every ACTIVE checklist template the caller can read.
 *
 * ## Why this is assembled here and not read as one thing
 *
 * No operation publishes "the checklist of this handover". The completion
 * primitive evaluates mandatory items scoped to the delivery's COMPANY rather
 * than to any one template, so the set that binds a handover is the union of the
 * company's active templates — which is exactly what the two template reads
 * publish between them. Assembling it in one Server Action keeps the order of
 * the calls on the server and hands the screen one outcome instead of several
 * refusals to interpret.
 *
 * ## A partial answer is not returned as a whole one
 *
 * If any read in the sequence is refused, that refusal is the result. A screen
 * that showed the templates it managed to read would present an incomplete
 * checklist as the checklist, and the operator would work through it believing
 * they had finished.
 *
 * The page walk is bounded. Asking forever is worse than stopping, and the
 * template count returned is what lets the screen state what it counted.
 */
export async function readActiveChecklistItems(): Promise<ReadState<ActiveChecklist>> {
  const templates: ChecklistTemplateDetail[] = [];
  let cursor: string | null = null;
  let templateCount = 0;

  for (let page = 0; page < MAX_TEMPLATE_PAGES; page += 1) {
    const listed: ReadState<ChecklistTemplateListEnvelope> =
      await readOperation<ChecklistTemplateListEnvelope>(
        '/api/v1/delivery-checklist-templates' + query({ cursor, limit: PAGE_SIZE })
      );
    if (listed.status !== 'ok') return listed;

    for (const template of listed.data.templates.items) {
      templateCount += 1;
      if (template.status !== ACTIVE_TEMPLATE_STATUS) continue;
      const detail = await readOperation<ChecklistTemplateDetail>(
        `/api/v1/delivery-checklist-templates/${encodeURIComponent(template.id)}`
      );
      if (detail.status !== 'ok') return detail;
      templates.push(detail.data);
    }

    if (!listed.data.templates.hasMore || listed.data.templates.nextCursor === null) {
      return {
        status: 'ok',
        data: { templates, templateCount },
        correlationId: listed.correlationId,
      };
    }
    cursor = listed.data.templates.nextCursor;
  }

  return { status: 'ok', data: { templates, templateCount }, correlationId: null };
}

/* ------------------------------------------------------------------------- *
 * The writes
 * ------------------------------------------------------------------------- */

/**
 * A write outcome, plus the catalogue code when the backend published one.
 *
 * The code travels because three of these operations distinguish causes that
 * change what an operator should do next, and the HTTP kind alone collapses
 * them: a stale version, a blocked handover and a refused override arrive as a
 * bare 409 or 403. Only codes the screen actually branches on are read, and
 * nothing here invents a sentence per code.
 */
export interface DeliveryWriteState extends ActionState {
  /** The catalogue code the problem document carried. Absent when it carried none. */
  readonly code?: string;
  /** The authority a refused override named, when it named one. */
  readonly requiredPermissions?: readonly string[];
}

/** The delivery a successful creation opened, so the screen can open it. */
export interface StartDeliveryOutcome extends DeliveryWriteState {
  readonly created?: DeliveryRecord;
}

/**
 * Open a handover for a work order (`sal.delivery-create`).
 *
 * `sal.delivery.manage`, branch-scoped, idempotent, 201. The vehicle and the
 * visit are NOT sent: the service derives both from the work order, so the one
 * decision the caller makes is who is handing the vehicle over.
 *
 * A second attempt against the same work order is refused by
 * `uq_delivery_records_work_order_active`, and that refusal is the truth rather
 * than an inconvenience — one live handover per work order.
 */
export async function startDelivery(
  body: DeliveryCreateBody,
  attempt = 1
): Promise<StartDeliveryOutcome> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<DeliveryRecord>('POST', '/api/v1/deliveries', body);
  if (!result.ok) return withCode(fromFailure(result, attempt), result);
  return { ...success('delivery.start.done', attempt), created: result.data };
}

/**
 * Verify who may collect the vehicle (`sal.delivery-receiver-verify`).
 *
 * The caller nominates a partner; the platform decides authority.
 * `sal.guard_authorized_receiver` requires that partner to hold a reception
 * party role for this delivery's visit that is valid at the moment of
 * verification, so a role that has expired does not authorise a collection
 * today. That refusal reaches the screen as a refusal and is never restated as
 * though this tier had judged it.
 */
export async function verifyReceiver(
  deliveryId: string,
  body: DeliveryReceiverVerifyBody,
  attempt = 1
): Promise<DeliveryWriteState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<unknown>(
    'POST',
    deliveryPath(deliveryId, '/authorized-receiver'),
    body
  );
  if (!result.ok) return withCode(fromFailure(result, attempt), result);
  return success('delivery.receiver.verified', attempt);
}

/**
 * Record one checklist outcome (`sal.delivery-checklist-record`).
 *
 * A recorded outcome is FINAL. An identical re-send is answered as a replay, and
 * a second, different outcome for the same item is refused with the idempotency
 * conflict code — which the screen states as "already recorded" rather than as a
 * generic conflict, because the two lead an operator to do different things.
 *
 * The waiver rule is a biconditional in the database, so a reason is sent only
 * with a waived outcome and the form requires one there.
 */
export async function recordChecklistResult(
  deliveryId: string,
  body: DeliveryChecklistRecordBody,
  attempt = 1
): Promise<DeliveryWriteState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<unknown>(
    'POST',
    deliveryPath(deliveryId, '/checklist-results'),
    body
  );
  if (!result.ok) return withCode(fromFailure(result, attempt), result);
  return success('delivery.checklist.recorded', attempt);
}

/**
 * Bind a signature document to the handover (`sal.delivery-signature-attach`).
 *
 * Append-only, and a reference rather than an image. The version this names is
 * produced by the capture chain in `signature-capture.ts`; this adapter carries
 * the identifier that chain returned and asserts nothing about what the document
 * holds or whose mark is in it.
 */
export async function attachSignature(
  deliveryId: string,
  body: DeliverySignatureAttachBody,
  attempt = 1
): Promise<DeliveryWriteState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const result = await client.send<unknown>('POST', deliveryPath(deliveryId, '/signatures'), body);
  if (!result.ok) return withCode(fromFailure(result, attempt), result);
  return success('delivery.signature.attached', attempt);
}

/** What a completion needs, with the version guard stated as its own field. */
export interface CompleteDeliveryInput {
  readonly deliveryId: string;
  /**
   * The `recordVersion` the ELIGIBILITY read republished.
   *
   * Not the version a checklist result or a signature answered with: both of
   * those move the delivery row, so a version taken from either is stale by
   * construction. The eligibility read is the one that publishes the number a
   * completion must quote, and it republishes it on every read.
   */
  readonly ifMatch: number;
  readonly finalOdometerValue: string;
  readonly odometerUnit?: 'km' | 'mi' | undefined;
  /** Present only when the operator asked to override the financial blocker. */
  readonly overrideReason?: string | undefined;
}

/**
 * Release the vehicle (`sal.delivery-complete`).
 *
 * ## One retry, and only for a stale version
 *
 * A record-version conflict means the delivery moved between the eligibility
 * read and this request — the ordinary consequence of recording a result or
 * attaching a signature a moment earlier. So the eligibility read is repeated
 * ONCE, and if it republishes a different version the completion is re-sent
 * against it. That is a genuine second attempt rather than a replay: the first
 * request was refused and applied nothing, and the transport mints a fresh
 * idempotency key for a fresh logical attempt.
 *
 * A second conflict is reported, not retried. Retrying a conflict in a loop is
 * how a screen turns somebody else's concurrent work into a race it keeps losing
 * without ever saying so.
 *
 * ## Nothing here decides eligibility
 *
 * The reasons behind a blocked completion are not in the refusal — the problem
 * document carries the catalogue code and no service prose — so the screen reads
 * them back from the eligibility operation, which publishes the blocker list and
 * the unsatisfied item codes as data. This tier composes no decision of its own
 * at any point.
 */
export async function completeDelivery(
  input: CompleteDeliveryInput,
  attempt = 1
): Promise<DeliveryWriteState> {
  const client = await authorizedClient();
  if (!client) return { status: 'expired', messageKey: 'state.expired.title', attempt };

  const body: DeliveryCompleteBody = {
    finalOdometerValue: input.finalOdometerValue,
    ...(input.odometerUnit === undefined ? {} : { odometerUnit: input.odometerUnit }),
    ...(input.overrideReason === undefined
      ? {}
      : { overrideFinancialBlocker: { reason: input.overrideReason } }),
  };
  /*
   * Built at each call site rather than hoisted into a variable, so the method
   * sits immediately before the path. The access gate reads the method from the
   * text adjacent to a helper call; a hoisted path is attributed to a GET, and
   * the completion's own permissions then look like privilege nothing needs.
   */
  const first = await client.send<unknown>(
    'POST',
    deliveryPath(input.deliveryId, '/completion'),
    body,
    { ifMatch: input.ifMatch }
  );
  if (first.ok) return success('delivery.completion.done', attempt);
  if (first.problem?.code !== DELIVERY_ERROR_CODES.staleVersion) {
    return withCode(fromFailure(first, attempt), first);
  }

  const reread = await readEligibility(input.deliveryId);
  if (reread.status !== 'ok' || reread.data.recordVersion === input.ifMatch) {
    return withCode(fromFailure(first, attempt), first);
  }

  const second = await client.send<unknown>(
    'POST',
    deliveryPath(input.deliveryId, '/completion'),
    body,
    { ifMatch: reread.data.recordVersion }
  );
  if (!second.ok) return withCode(fromFailure(second, attempt + 1), second);
  return success('delivery.completion.done', attempt + 1);
}

/**
 * Carries the catalogue code and any named authority onto the action state.
 *
 * Separate from `fromFailure` because that helper is shared by every form in the
 * product and its contract is deliberately narrow: translation keys and a
 * correlation reference. A catalogue code is neither — it is a machine value
 * this feature branches on — so it is added here, beside the operations that
 * distinguish causes, rather than widened into the shape twenty other screens
 * render.
 */
function withCode(state: ActionState, failure: ApiFailure): DeliveryWriteState {
  const problem = failure.problem;
  return {
    ...state,
    ...(problem?.code === undefined ? {} : { code: problem.code }),
    ...(problem?.requiredPermissions === undefined
      ? {}
      : { requiredPermissions: problem.requiredPermissions }),
  };
}
