/**
 * POST /api/v1/warranty-policies/{policyId}/coverage-windows/{coverageId}/status
 * (Phase 1-31, P-10).
 *
 * Archives (`archived`) or reactivates (`active`) one coverage window.
 *
 * ## This is the command that actually changes a company's warranty terms
 *
 * `wty.issue_warranty` selects the coverage to apply with `status = 'active' AND
 * deleted_at IS NULL AND effective_from <= start AND (effective_to IS NULL OR
 * effective_to > start)`, and it never reads the POLICY's status. So archiving the row
 * effective today is what stops those terms being granted to the next vehicle, while
 * every warranty already issued under it stays readable and intact —
 * `wty.warranty-detail` resolves the coverage a record cites whatever its status.
 *
 * ## Reactivation can be refused, and the refusal is not a fault
 *
 * `ex_warranty_coverage_no_overlap` is PARTIAL on `status = 'active'`, so an archived
 * row is outside it: its window may have been re-covered by a newer row while it was
 * archived. Putting it back would then place two active coverages over one day for one
 * `(policy, covered_scope)`, and the primitive's `ORDER BY effective_from DESC LIMIT 1`
 * would be arbitrary between them — a customer bound to whichever row the planner
 * happened to return. The constraint refuses it as `23P01` and this surface reports it
 * as `ERR-CON-001` with `rule: 'overlapping_coverage'`, the same rule an insert into a
 * covered window produces, because to a caller the two mean the same thing.
 *
 * ## There is no delete and no edit
 *
 * No DELETE grant and no DELETE policy exist on `wty.warranty_coverage` for any
 * application role, and `fk_warranty_records_coverage` is `ON DELETE RESTRICT`. There
 * is no PATCH either: `tg_warranty_coverage_immutable` freezes `policy_id` and
 * `effective_from`, and re-closing `effective_to` in place would restate the terms a
 * customer was already bound to. Archive and add — see the coverage create route.
 *
 * ## The `If-Match` version is the COVERAGE row's own
 *
 * Never the policy's. The path names both rows and they carry independent counters,
 * which is exactly the shape a caller can get wrong silently; the create route
 * publishes the coverage version as its ETag for this reason.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { WARRANTY_LIFECYCLE_STATUSES, warrantyModule } from '@/modules/warranty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ policyId: schemas.uuid, coverageId: schemas.uuid }).strict();
export const CoverageStatusBody = z
  .object({ status: z.enum(WARRANTY_LIFECYCLE_STATUSES) })
  .strict();

export const WARRANTY_COVERAGE_STATUS_OPERATION = defineOperation({
  id: 'wty.warranty-coverage-status-set',
  module: 'warranty',
  method: 'POST',
  path: '/warranty-policies/{policyId}/coverage-windows/{coverageId}/status',
  summary: 'Archive or reactivate one warranty coverage window.',
  permissions: ['wty.policy.manage'],
  // `company`, re-authorized by the service against the POLICY's own company once it
  // is read (P1-18-A-01: a declared scope is inert without a target).
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'wty.warranty_policy.coverage_status_changed',
  // Version-guarded, so the transition decides against the row the caller actually
  // read. NOT declared idempotent, and that is the one place this command departs from
  // the policy status command beside it: a reactivation can be refused by
  // `ex_warranty_coverage_no_overlap`, and an idempotency reservation that replayed a
  // stored success would hide a conflict raised by rows written since. The version
  // guard already makes a duplicate submission safe — the second one loses.
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ policyId: string; coverageId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    WARRANTY_COVERAGE_STATUS_OPERATION,
    request,
    async ({ db, request: req, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, CoverageStatusBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const changed = await warrantyModule().policies.setCoverageStatus(
        db,
        params.policyId,
        params.coverageId,
        expectedVersion,
        input.status,
        authorizeScope
      );
      return { body: changed, recordVersion: changed.recordVersion };
    },
    { params: raw, body }
  );
}
