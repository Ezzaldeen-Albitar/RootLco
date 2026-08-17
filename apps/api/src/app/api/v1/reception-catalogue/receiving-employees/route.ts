/**
 * GET /api/v1/reception-catalogue/receiving-employees — FE-007 picker.
 *
 * Returns only active same-tenant IAM users whose live role-grant scope covers
 * the requested branch. Disabled/archived users remain readable through the
 * immutable snapshot on an existing reception, but are never offered here.
 *
 * ## Why `rec.reception.manage` and not `rec.reception.read`
 *
 * This list answers one question — "whom may I name as the custodian on the
 * check-in I am about to open" — so it is gated by the capability that opens
 * one. `rec.reception.read` is a low-risk code held by the board, the service
 * advisor and the cashier, none of whom select a custodian, and none of whom
 * need the tenant's staff names to do their job.
 *
 * It DISCLOSES strictly less than the alternative it replaces. The check-in
 * screen previously populated its picker from `iam.user-list`, which names every
 * account in the tenant; this names the active accounts eligible for one branch.
 *
 * ## The picker is not the authority
 *
 * `rec.stamp_receiving_employee_identity()` decides, inside the insert. This
 * query is deliberately the same predicate so the two cannot drift into a form
 * where the screen offers an id the write refuses — but a caller that never
 * calls this endpoint is subject to exactly the same rule, which is the point of
 * putting it in the database.
 *
 * The list does NOT widen for an actor holding
 * `rec.reception.receiving_employee.assign_any`. Reaching into another branch is
 * an explicit administrative act taken against the user directory, not a picker
 * that silently grows under a permission the operator cannot see.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const RECEIVING_EMPLOYEE_LIST_OPERATION = defineOperation({
  id: 'rec.receiving-employee-list',
  module: 'reception',
  method: 'GET',
  path: '/reception-catalogue/receiving-employees',
  summary: 'List active IAM users eligible to receive custody in one branch.',
  permissions: ['rec.reception.manage'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    RECEIVING_EMPLOYEE_LIST_OPERATION,
    request,
    async ({ db }) => ({
      body: await receptionModule().receptionRead.listReceivingEmployees(
        db,
        parseOrFail(Query, raw, 'query')
      ),
    }),
    scopeTargetOption(raw)
  );
}
