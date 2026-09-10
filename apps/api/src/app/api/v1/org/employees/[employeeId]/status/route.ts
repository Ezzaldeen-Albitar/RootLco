/**
 * POST /api/v1/org/employees/{employeeId}/status (P1-31 prerequisite P-17).
 *
 * Retires (`inactive`) or reinstates (`active`) one employee.
 *
 * ## There is no delete, and there cannot be
 *
 * `org.employees` carries no DELETE grant and no delete policy for any
 * application role, so a hard removal is refused by the database however it is
 * asked for. That is the property that matters: every delivery cites its
 * delivering employee by id for the life of the record and
 * `fk_delivery_records_delivering_employee` is `ON DELETE RESTRICT`, so an
 * employee that could vanish would take the handover history with them.
 *
 * ## Why it reinstates as well as retires
 *
 * `status` is the only retirement this register has. A one-way command would
 * make a mistaken retirement permanent, and `uq_employees_employment_ref_live` is
 * partial on `deleted_at` rather than on `status`, so a retired employee still
 * holds their employment reference and a replacement row could not reuse it.
 * This is the `apt.catalogue-source-channel-status-set` shape, for the same
 * reasons.
 *
 * ## What retiring DOES and does NOT do
 *
 * `sal.stamp_delivering_employee_identity` refuses a non-active employee on
 * INSERT, so retiring stops this person being named on a NEW handover
 * immediately, at the database, for every writer. It changes nothing about
 * handovers already recorded: each carries its own
 * `delivering_employee_display_name` snapshot, stamped server-side at creation
 * and frozen by `tg_delivery_records_immutable`.
 *
 * ## If-Match is mandatory and it is compared
 *
 * `versionGuarded: true` makes `handleOperation` parse the header; a missing one
 * is `ERR-CON-002` here rather than a silently unguarded write, and the service
 * compares the value in the UPDATE's own WHERE clause so a stale one is
 * `ERR-CON-001` from the database's own concurrency control.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { EMPLOYEE_STATUSES, iamRegistryModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ employeeId: schemas.uuid }).strict();

/** Mirrors `ck_employees_status`. Retire and reinstate are the same verb. */
export const StatusBody = z.object({ status: z.enum(EMPLOYEE_STATUSES) }).strict();

export const EMPLOYEE_STATUS_SET_OPERATION = defineOperation({
  id: 'org.employee-status-set',
  module: 'iam',
  method: 'POST',
  path: '/org/employees/{employeeId}/status',
  summary: 'Retire or reinstate one employee.',
  permissions: ['org.employee.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'org.employee.status_changed',
  // Version-guarded and deliberately NOT idempotent, on the
  // `wty.warranty-coverage-status-set` precedent: a stored replay would hide a
  // conflict raised by a change written since, and the version guard already
  // makes a duplicate submission safe.
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ employeeId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    EMPLOYEE_STATUS_SET_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(StatusBody, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const updated = await iamRegistryModule().employees.setStatus(
        db,
        params.employeeId,
        parsed.status,
        expectedVersion,
        authorizeScope
      );
      return { body: updated, recordVersion: updated.recordVersion };
    },
    { params: raw, body }
  );
}
