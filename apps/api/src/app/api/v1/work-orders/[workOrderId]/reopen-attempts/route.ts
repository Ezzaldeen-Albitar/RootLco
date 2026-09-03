/**
 * Reopen attempts on a closed work order (Phase 1-19, P1-19-BE-018).
 *
 * `POST` records an attempt and then REFUSES it. `GET` lists what was recorded.
 *
 * ## The refusal is data, and that is not a softening
 *
 * BR-WO-002 admits no reopen. `qms.attempt_reopen` writes a `qms.reopen_attempts` row
 * whose `outcome` is CHECK-fixed to `'rejected'` — the vocabulary has exactly one
 * value — and never touches the work order.
 *
 * The POST therefore returns **201 with the recorded attempt and its refusal**, not a
 * 409. An earlier draft threw `ERR-QMS-001`, which looked more emphatic and was
 * strictly worse: the throw aborts the request's transaction, so the ledger row it had
 * just written rolled back with it and the ledger stayed empty. The refusal was real
 * and the record was not, which is exactly backwards for an endpoint whose entire
 * purpose is the record.
 *
 * So the REQUEST succeeds — a reopen attempt was asked for and one was recorded — and
 * the RESPONSE says the reopen was refused. An auditor asking "did anyone try to
 * reopen this after the vehicle was released" gets a ledger rather than silence.
 *
 * Corrective work goes through a linked REWORK work order, which stands beside the
 * closed original instead of editing it — `POST /work-orders/{id}/rework`. The refusal
 * message says so, because a refusal that names no alternative reads as a broken
 * feature.
 *
 * `requested_by` and `requested_at` are stamped by `qms.stamp_reopen_attempt()` from
 * the session and cannot be claimed. A work order that is NOT closed is a different
 * refusal — `ERR-TRN-001`, there is nothing to reopen — and the two are told apart
 * because the function says which.
 *
 * The permission is `wo.work_order.transition`: the act attempted is a work-order
 * state change, so the authority required to attempt it is the authority to move one.
 * Anything weaker would let a caller with no transition rights fill the ledger.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_REOPEN_REASON, qualityModule } from '@/modules/quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });
export const Body = z.object({ reason: z.string().trim().min(1).max(MAX_REOPEN_REASON) }).strict();

export const REOPEN_ATTEMPT_OPERATION = defineOperation({
  id: 'qms.reopen-attempt',
  successStatus: 201,
  module: 'quality',
  method: 'POST',
  path: '/work-orders/{workOrderId}/reopen-attempts',
  summary: 'Record — and refuse — an attempt to reopen a closed work order.',
  permissions: ['wo.work_order.transition'],
  scope: 'branch',
  auditClass: 'security',
  auditAction: 'qms.work_order.reopen_refused',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REOPEN_ATTEMPT_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const recorded = await qualityModule().rework.attemptReopen(
        db,
        params.workOrderId,
        parsed.reason,
        authorizeScope
      );
      return { status: 201, body: recorded };
    },
    { params: raw, body }
  );
}

export const REOPEN_ATTEMPT_LIST_OPERATION = defineOperation({
  id: 'qms.reopen-attempt-list',
  module: 'quality',
  method: 'GET',
  path: '/work-orders/{workOrderId}/reopen-attempts',
  summary: 'List the recorded reopen attempts on a work order.',
  permissions: ['qms.quality_control.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    REOPEN_ATTEMPT_LIST_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          items: await qualityModule().rework.reopenAttempts(
            db,
            params.workOrderId,
            authorizeScope
          ),
        },
      };
    },
    { params: raw }
  );
}
