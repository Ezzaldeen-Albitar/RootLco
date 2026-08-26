/**
 * Customer decisions on additional work (Phase 1-19, P1-19-BE-007).
 *
 * `POST` records the decision; `GET` reads it back with its evidence.
 *
 * ## One request, one transaction, two writes in a forced order
 *
 * `wo.guard_additional_work_state` refuses `state = 'approved'` on the request unless
 * an `approved` row already exists in `wo.customer_approvals` for it. So this endpoint
 * records the decision and then moves the request, and it must be ONE call: split into
 * two, there would be a window in which a decision exists and the request does not
 * reflect it — the closure gate would still see a pending required request while the
 * customer had already agreed — and a failure between the two would leave that window
 * open for ever. Everything happens inside the operation's transaction, so a failure
 * anywhere leaves no approval, no evidence, no state change, no audit record and no
 * outbox row.
 *
 * ## What the caller may not choose
 *
 *  - **The actor.** Taken from the resolved principal, never from the body.
 *  - **`decidedAt`.** Server-stamped, then frozen by `tg_customer_approvals_immutable`
 *    — a caller-supplied time could precede the request and could never be corrected.
 *  - **A storage key.** Evidence names a document VERSION that the Phase 1-15
 *    attachment service created; `wo.customer_approval_evidence` has no column for a
 *    key and this route has no field for one.
 *  - **The deciding party, freely.** `wo.guard_customer_approval_coherence` resolves
 *    request → work order → reception visit and refuses a
 *    `rec.reception_party_roles` row belonging to any other visit or tenant. The party
 *    who agrees is one already recorded on the visit that produced the work order.
 *
 * `If-Match` is mandatory and is the stale-scope control. `presentedScope` is a
 * verbatim record of what the customer was shown, and nothing in the schema ties it to
 * the request's content — so binding the decision to the request version the advisor
 * was looking at is the only way a request that moved in between can be detected. A
 * decision against a moved request is `ERR-CON-001`, not silently attached to
 * different work.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import {
  APPROVAL_CHANNELS,
  APPROVAL_DECISIONS,
  MAX_APPROVAL_EVIDENCE,
  MAX_EVIDENCE_NOTE,
  MAX_EVIDENCE_TYPE,
  MAX_PRESENTED_SCOPE,
  workOrderModule,
} from '@/modules/work-order';
/**
 * Side-effect import: it INSTALLS the commercial-approval port (P1-20-BE-013).
 *
 * `@/modules/quotation` calls `setCommercialApprovalReader` at module scope, and this
 * route is the only path that consumes it. Nothing else in `src/` imports the
 * quotation module — no middleware, no instrumentation, no bootstrap barrel — so
 * without this line the port's installation depended on request ORDER: a fresh Node
 * process (cold start, restart, scale-out) that received this endpoint before any
 * `/quotations*` route had been loaded found the port missing and answered
 * `ERR-SYS-001`. Fail-closed, so no unvalidated link was ever written, but
 * P1-20-BE-013 was intermittently unavailable for reasons a caller could not see.
 *
 * It cannot be a named import: the module is needed for its side effect, not its
 * surface, and `work-order` must not import `quotation` (that is the cycle the port
 * exists to avoid). A route may import both, which is why the installation belongs
 * here. `scripts/p1-20-endpoint-inventory.mjs` enforces the pairing so a future route
 * citing a quotation revision cannot omit it.
 */
import '@/modules/quotation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ requestId: schemas.uuid });

/**
 * Evidence binds an EXACT immutable document version, and only that.
 *
 * `wo.customer_approval_evidence` is append-only — `app_runtime` holds SELECT and
 * INSERT and nothing else — so a version bound here can never be substituted or
 * removed. That is why the version id is the input and the document id is not: a
 * document reference would let the underlying bytes change under a recorded decision.
 */
const Evidence = z
  .object({
    documentVersionId: schemas.uuid,
    evidenceType: z.string().trim().min(1).max(MAX_EVIDENCE_TYPE),
    note: z.string().trim().min(1).max(MAX_EVIDENCE_NOTE).optional(),
  })
  .strict();

export const Body = z
  .object({
    // Both vocabularies are the CHECK constraints' own, read off `pg_constraint`.
    // `ck_customer_approvals_decision` has exactly two values and no `declined`;
    // `ck_customer_approvals_channel` includes `other`, so refusing it here would
    // refuse something the database accepts.
    decision: z.enum(APPROVAL_DECISIONS),
    channel: z.enum(APPROVAL_CHANNELS),
    decidingPartyRoleId: schemas.uuid,
    presentedScope: z.string().trim().min(1).max(MAX_PRESENTED_SCOPE),
    evidence: z.array(Evidence).max(MAX_APPROVAL_EVIDENCE).optional(),
    /**
     * The approved quotation revision this decision rests on (P1-20-BE-013).
     *
     * Optional: additional work may be approved without a priced quotation, and
     * wo.customer_approvals.quotation_revision_ref is nullable. When supplied it is
     * validated through the commercial-approval port - same work order, same
     * company and branch, current, issued, unexpired, and ACCEPTED - before
     * anything is written.
     *
     * It is accepted at decision time and nowhere else, because
     * tg_customer_approvals_immutable freezes the column: there is no later moment
     * at which this link could be established.
     */
    quotationRevisionRef: schemas.uuid.optional(),
  })
  .strict();

export const ADDITIONAL_WORK_APPROVAL_OPERATION = defineOperation({
  id: 'wo.additional-work-approval',
  module: 'work-order',
  method: 'POST',
  path: '/additional-work/{requestId}/approval',
  summary: 'Record the customer decision on an additional-work request.',
  // A high-risk permission of its own, separate from `wo.additional_work.request`:
  // the workshop raising extra work and the customer agreeing to pay for it are
  // different authorities, and one person holding both is a policy choice a tenant
  // makes by granting them, not one this route makes by conflating them.
  permissions: ['wo.additional_work.approve'],
  scope: 'branch',
  auditClass: 'approval',
  auditAction: 'wo.customer_approval.recorded',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ requestId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    ADDITIONAL_WORK_APPROVAL_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const decided = await workOrderModule().additionalWork.decide(
        db,
        params.requestId,
        {
          decision: parsed.decision,
          channel: parsed.channel,
          decidingPartyRoleId: parsed.decidingPartyRoleId,
          presentedScope: parsed.presentedScope,
          expectedVersion,
          evidence: parsed.evidence,
          quotationRevisionRef: parsed.quotationRevisionRef,
        },
        authorizeScope
      );
      return {
        status: 201,
        body: decided,
        recordVersion: decided.request.recordVersion,
      };
    },
    { params: raw, body }
  );
}

export const ADDITIONAL_WORK_APPROVAL_READ_OPERATION = defineOperation({
  id: 'wo.additional-work-approval-read',
  module: 'work-order',
  method: 'GET',
  path: '/additional-work/{requestId}/approval',
  summary: 'Read the recorded customer decision and its evidence.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ requestId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    ADDITIONAL_WORK_APPROVAL_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: await workOrderModule().additionalWork.approval(db, params.requestId, authorizeScope),
      };
    },
    { params: raw }
  );
}
