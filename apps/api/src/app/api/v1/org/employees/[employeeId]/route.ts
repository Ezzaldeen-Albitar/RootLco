/**
 * GET /api/v1/org/employees/{employeeId} (P1-31 prerequisite P-17).
 *
 * One employee, and the version a caller needs before it can retire or reinstate
 * one.
 *
 * ## Absent and unreachable are ONE answer
 *
 * The service resolves the row FIRST and re-authorizes against the row's own
 * company and branch, so a caller cannot reach another branch by naming an id
 * from it. Absent, soft-deleted, out of reach and in another tenant all return
 * the same `ERR-RES-001`. Distinguishing them would turn the register into a way
 * to enumerate another organisation's people, which is exactly what a read gated
 * on `org.employee.read` must never be.
 *
 * ## The version is published as the ETag as well as in the body
 *
 * `org.employee-status-set` is version-guarded and `parseIfMatch` accepts only an
 * exact positive integer, so a caller needs a current version to act at all.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { iamRegistryModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ employeeId: schemas.uuid }).strict();

export const EMPLOYEE_DETAIL_OPERATION = defineOperation({
  id: 'org.employee-detail',
  module: 'iam',
  method: 'GET',
  path: '/org/employees/{employeeId}',
  summary: 'Read one employee from a branch register.',
  permissions: ['org.employee.read'],
  // `branch`, re-authorized by the service against the ROW's own pair rather than
  // against an empty target — a declared scope is inert without one (P1-18-A-01).
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ employeeId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    EMPLOYEE_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const employee = await iamRegistryModule().employees.readEmployee(
        db,
        params.employeeId,
        authorizeScope
      );
      return { body: employee, recordVersion: employee.recordVersion };
    },
    { params: raw }
  );
}
