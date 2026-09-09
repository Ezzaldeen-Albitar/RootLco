/**
 * POST /api/v1/warranty-policies/{policyId}/status (Phase 1-31, P-10).
 *
 * Archives (`archived`) or restores (`active`) one warranty policy.
 *
 * ## There is no delete, and there cannot be
 *
 * Neither `wty.warranty_policies` nor `wty.warranty_coverage` carries a DELETE grant or
 * a DELETE policy for any application role, so a hard removal is refused by the
 * database however it is asked for. That is the property that matters here: every
 * warranty record cites its policy AND its coverage by id, and
 * `fk_warranty_records_policy` and `fk_warranty_records_coverage` are
 * `ON DELETE RESTRICT` — a policy that could vanish would take the terms of every
 * warranty ever issued under it with it.
 *
 * ## Why it restores as well as archives
 *
 * `uq_warranty_policies_code` is `(tenant_id, company_id, policy_code) WHERE deleted_at
 * IS NULL`. The predicate names `deleted_at` and says nothing about `status`, so an
 * archived policy still holds its code and re-adding that code is a `23505`. An
 * archive-only command would burn the code for the company permanently — the
 * `apt.catalogue-source-channel-status-set` precedent, for the same reason.
 *
 * ## What archiving DOES and does NOT do
 *
 * It removes the policy from `listActivePolicies`, which is what `resolvePolicy`
 * counts — so archiving a company's ONLY active policy makes every subsequent
 * generation that does not name a policy answer `ERR-RES-001`, and naming this one
 * explicitly reaches `assertPolicyActive`, which refuses it by name.
 *
 * It does NOT touch the coverage rows, and that is deliberate rather than an oversight.
 * `wty.issue_warranty` selects coverage on the COVERAGE's own `status` and never reads
 * the policy's, so `assertPolicyActive` is the only defence at issue time and this
 * command leaves that rule exactly where it is. A cascade would also be irreversible:
 * restoring the policy could not tell which coverage rows the cascade archived from
 * which an operator archived, and `ex_warranty_coverage_no_overlap` might refuse to put
 * them back at all. To withdraw one window of terms, archive the COVERAGE row.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { WARRANTY_LIFECYCLE_STATUSES, warrantyModule } from '@/modules/warranty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ policyId: schemas.uuid }).strict();
export const StatusBody = z.object({ status: z.enum(WARRANTY_LIFECYCLE_STATUSES) }).strict();

export const WARRANTY_POLICY_STATUS_OPERATION = defineOperation({
  id: 'wty.warranty-policy-status-set',
  module: 'warranty',
  method: 'POST',
  path: '/warranty-policies/{policyId}/status',
  summary: 'Archive or restore one warranty policy.',
  permissions: ['wty.policy.manage'],
  // `company`, re-authorized by the service against the row's own company
  // (P1-18-A-01: a declared scope is inert without a target). Company-wide, because
  // archiving the only active policy stops every branch of the company issuing a
  // warranty.
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'wty.warranty_policy.status_changed',
  // Both guards, as `apt.catalogue-source-channel-status-set` declares them: the
  // version makes the transition decide against the state the caller actually read,
  // and the key makes a retried request return the first answer instead of a version
  // conflict the client cannot distinguish from a real one.
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ policyId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    WARRANTY_POLICY_STATUS_OPERATION,
    request,
    async ({ db, request: req, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, StatusBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const changed = await warrantyModule().policies.setPolicyStatus(
        db,
        params.policyId,
        expectedVersion,
        input.status,
        authorizeScope
      );
      return { body: changed, recordVersion: changed.recordVersion };
    },
    { params: raw, body }
  );
}
