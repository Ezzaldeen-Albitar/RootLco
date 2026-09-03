/**
 * POST /api/v1/platform/organizations/{tenantId}/status (PRE-P1-29 Wave B).
 *
 * The tenant lifecycle transition, and the operation that makes §6.3's bootstrap
 * window self-closing rather than permanent.
 *
 * Without it Wave B composes to a control plane that CREATES tenants in
 * `provisioning` and can never move one out, so the window every bootstrap
 * policy is predicated on would never close for any tenant — §9.3 names
 * "bootstrap succeeds against a tenant that is already live" as the escalation
 * that window exists to prevent. Measured: with the window open the bootstrap
 * insert is admitted; after a legal transition to `active` the identical insert
 * is refused.
 *
 * ## What this route does NOT do
 *
 * It does not validate the transition graph. `org.guard_tenant_status_transition`
 * (M4) enforces it for EVERY writer — including a direct UPDATE by a role holding
 * the column grant — so duplicating the graph here would put one rule in two
 * places and let them drift. An illegal destination raises `check_violation`
 * from the trigger, not from TypeScript.
 *
 * It does not write history. `org.emit_tenant_status_history` (M3) writes exactly
 * one row per real status change, whatever performed it.
 *
 * It does not carry an actor. The history row's `actor_id` is server-derived by
 * `shared.stamp_status_history()` from `iam.current_user_id()`, which is also
 * what the platform-authority predicate resolves from — so attribution and
 * authority come from the same trusted value and a request document cannot
 * influence either. A caller-supplied value must never become the input to an
 * authority predicate.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ tenantId: schemas.uuid });

/**
 * The destination vocabulary is the graph's, minus `provisioning`: the window
 * closes on the first legal transition and nothing reopens it. M4 refuses a
 * return to `provisioning` even if this schema admitted it, and the `FOR UPDATE`
 * policy's `WITH CHECK` omits it too — two independent controls, which is why
 * the proof carries two mutations.
 */
export const Body = z
  .object({
    to: z.enum(['active', 'suspended', 'closed']),
    reason: z.string().min(1).max(500),
    correlationId: schemas.uuid.optional(),
  })
  .strict();

export const ORGANIZATION_LIFECYCLE_OPERATION = defineOperation({
  id: 'platform.organization-lifecycle',
  module: 'platform',
  method: 'POST',
  path: '/platform/organizations/{tenantId}/status',
  summary: 'Transition a tenant lifecycle status from the control plane.',
  permissions: ['platform.organization.lifecycle'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'org.tenant.status_changed',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ tenantId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    ORGANIZATION_LIFECYCLE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const input = await parseJsonBody(raw, Body);
      await platformModule().organizations.changeStatus(db, {
        tenantId: params.tenantId,
        toState: input.to,
        reason: input.reason,
        ...(input.correlationId !== undefined ? { correlationId: input.correlationId } : {}),
      });
      return { body: { tenantId: params.tenantId, status: input.to } };
    },
    { params }
  );
}
