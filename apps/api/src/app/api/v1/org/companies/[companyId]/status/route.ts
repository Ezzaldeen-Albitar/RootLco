/**
 * POST /api/v1/org/companies/{companyId}/status (PRE-P1-29 Wave C — G-4).
 *
 * This operation exists to give `org.change_company_status` a caller.
 *
 * The Wave C sub-slice shipped that function, granted `EXECUTE` on it to
 * `app_runtime`, proved it against a live database — and NOTHING in the product
 * called it. That is the "declared but never wired" class which dominated P1-27:
 * a capability that exists, passes every gate, and is unreachable from the
 * outside. A migration that ships a function no route calls has not shipped a
 * feature; it has shipped a fixture.
 *
 * ## What this route does NOT do
 *
 * It does not validate the two-state graph, it does not refuse a no-op, it does
 * not write the history row, and it does not derive the actor. Every one of
 * those lives in the database:
 *
 *   - `org.change_company_status` refuses a blank reason, an unknown
 *     destination and a no-op, and publishes `app.status_reason`;
 *   - `org.emit_company_status_history` writes the history row and refuses an
 *     UPDATE that published no reason;
 *   - `shared.stamp_status_history()` derives the actor from the session.
 *
 * Restating any of that here would create a second rule that can drift from the
 * one the database actually enforces. The route's whole job is to carry an
 * authenticated, authorized, scoped request to the function.
 *
 * `reason` is REQUIRED in the body because the function raises without one — so
 * omitting it would produce a 500-shaped database error where a 422 belongs.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ companyId: schemas.uuid }).strict();

export const Body = z
  .object({
    // The two-state vocabulary, matching ck_legal_companies_status exactly.
    // 'suspended' and 'provisioning' are TENANT states; a company that accepted
    // them would be asking the database for a transition it cannot make.
    status: z.enum(['active', 'inactive']),
    reason: z.string().trim().min(1).max(512),
  })
  .strict();

export const COMPANY_STATUS_SET_OPERATION = defineOperation({
  id: 'org.company-status-set',
  module: 'iam',
  method: 'POST',
  path: '/org/companies/{companyId}/status',
  summary: 'Move a legal company along its two-state lifecycle.',
  permissions: ['org.company.manage'],
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'org.company.status_changed',
  // Idempotent because a retried deactivation must not append a second history
  // row. The function would refuse the replay as a no-op, but a 422 on a network
  // retry is a worse answer than the original 200.
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ companyId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    COMPANY_STATUS_SET_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const result = await iamModule().organizationAdministration.setCompanyStatus(
        db,
        params.companyId,
        { status: parsed.status, reason: parsed.reason },
        authorizeScope
      );
      return { body: result, recordVersion: result.company.recordVersion };
    },
    { params: raw, body }
  );
}
