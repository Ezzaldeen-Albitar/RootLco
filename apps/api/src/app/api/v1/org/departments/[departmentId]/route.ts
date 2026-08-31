/**
 * PATCH /api/v1/org/departments/{departmentId} (PRE-P1-29 Wave C — G-6).
 *
 * The last third of G-6: *"no operation creates, lists or **updates** one."*
 *
 * ## Two fields, and the schema is not the reason
 *
 * `name` and `status` are the only settable columns, and that is
 * `tg_departments_immutable`'s ruling rather than a choice made here: it freezes
 * `tenant_id`, `company_id`, `branch_id`, `department_code`, `created_at` and
 * `created_by`. So a department cannot be moved into another branch by an
 * update, and its code cannot be recycled by editing it.
 *
 * The body is `.strict()` and omits those keys, so an attempt to move a
 * department is a 422 naming the field. The database refusal underneath it is
 * asserted separately, because a strict schema is undone by any later refactor
 * to a passthrough body while the trigger is not.
 *
 * ## Retirement is `status`, not archival
 *
 * `org.departments` has `archived_at`, and `uq_departments_branch_code_live` is
 * partial on `deleted_at IS NULL AND archived_at IS NULL` — so archiving a
 * department FREES its code for reuse, and an un-archive could then collide with
 * whatever took the code in the meantime. No shipped operation anywhere in this
 * repository has precedent for resolving that collision.
 *
 * So Wave C ships no archive verb. Retirement is `status = 'inactive'`, which
 * keeps the code reserved and is reversible without a collision. The omission is
 * deliberate and is recorded here rather than left to be discovered.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ departmentId: schemas.uuid }).strict();

export const Body = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    // Matches ck_departments_status. Retire and reinstate are the same verb.
    status: z.enum(['active', 'inactive']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field must be supplied',
  });

export const DEPARTMENT_UPDATE_OPERATION = defineOperation({
  id: 'org.department-update',
  module: 'iam',
  method: 'PATCH',
  path: '/org/departments/{departmentId}',
  summary: 'Rename a department, or retire and reinstate it.',
  permissions: ['org.department.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'org.department.updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ departmentId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DEPARTMENT_UPDATE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const result = await iamModule().organizationAdministration.updateDepartment(
        db,
        params.departmentId,
        parsed,
        expectedVersion,
        authorizeScope
      );
      return { body: result, recordVersion: result.department.recordVersion };
    },
    { params: raw, body }
  );
}
