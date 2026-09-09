'use server';

import { PAGE_SIZE } from './delivery-contract';
import { query, readOperation, type ReadState } from '@/lib/api/read-operation';
import type {
  DeliveryChecklistResultsEnvelope,
  DeliveryEligibility,
  DeliveryReceiverEnvelope,
  DeliveryRecord,
  DeliverySignaturesEnvelope,
  DeliveryStatusHistoryEnvelope,
  WorkOrderDelivery,
} from './delivery-contract';

/**
 * The delivery read adapters (P1-31, FE-002/003/004/006/007).
 *
 * Every function here is a read and there is not one write in the file. This
 * slice renders the delivery custody chain; creating a delivery, verifying its
 * receiver, attaching a signature and completing the handover are separate
 * tasks with their own authority, and adding a write adapter before the screen
 * that owns it is how a dead declaration gets in.
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

const deliveryPath = (deliveryId: string, suffix = '') =>
  `/api/v1/deliveries/${encodeURIComponent(deliveryId)}${suffix}`;

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
