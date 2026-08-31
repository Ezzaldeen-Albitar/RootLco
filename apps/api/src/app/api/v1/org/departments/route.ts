/**
 * GET / POST /api/v1/org/departments (PRE-P1-29 Wave C — G-6).
 *
 * G-6 in the gap register reads: *"Departments have a table and can scope a
 * grant, but no operation creates, lists or updates one."* This file is two
 * thirds of the answer, and the POST below is the FIRST INSERT into
 * `org.departments` that has ever existed in the product.
 *
 * That absence was not cosmetic. `iam.grant_scopes` carries a `department_id`
 * with a foreign key to `org.departments`, so a role grant could be scoped to a
 * department — while no path could create the department to scope it to. The
 * table held zero rows and nothing could change that.
 *
 * ## The two verbs take DIFFERENT permissions, and that is the point
 *
 *   GET  -> `org.department.read`   (new in Wave C, risk `low`)
 *   POST -> `org.department.manage` (existing, risk `medium`)
 *
 * `org.department.read` is a genuinely new code rather than a duplicate. Reusing
 * `org.department.manage` for the list would force every scope picker — anyone
 * who needs to CHOOSE a department — to hold the authority to RESTRUCTURE the
 * organisation. The permission catalogue names that failure in its own words as
 * "over-granting by omission rather than by decision", and the canonical
 * permission-reuse register examined the three existing codes and found each
 * one wanting.
 *
 * The suite proves the split rather than asserting it: an actor holding only
 * `org.department.manage` is REFUSED the list, and an actor holding only
 * `org.department.read` is refused the create. If someone later "simplifies"
 * this to one code, those two cases go red.
 *
 * ## Create is the only department operation that trusts the request for scope
 *
 * There is no row to resolve yet, so the company/branch pair comes from the body
 * and is authorized BEFORE the insert, with `ins_departments_scope` as the
 * backstop behind it. Every other department operation resolves the row first
 * and re-decides against the row's own pair. This is the same arrangement
 * `tech.technician-create` uses, for the same reason.
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
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Query = z
  .object({
    // BOTH required. A department list with no branch would be a tenant-wide
    // read behind a branch-scoped permission, and `scope: 'branch'` is inert
    // without a target — `requiresScopedEvaluation` returns false on an empty
    // one whatever the declaration says.
    companyId: schemas.uuid,
    branchId: schemas.uuid,
  })
  .strict();

export const Body = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    // Mirrors ck_departments_code_format exactly, so a malformed code is a 422
    // naming the field rather than a 23514 from a check constraint.
    departmentCode: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/, 'must match ^[a-z][a-z0-9_]{1,62}$'),
    name: z.string().trim().min(1).max(200),
  })
  .strict();

export const DEPARTMENT_LIST_OPERATION = defineOperation({
  id: 'org.department-list',
  module: 'iam',
  method: 'GET',
  path: '/org/departments',
  summary: "List a branch's departments.",
  permissions: ['org.department.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    DEPARTMENT_LIST_OPERATION,
    request,
    async ({ db }) => {
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await iamModule().organizationAdministration.listDepartments(db, {
          companyId: query.companyId,
          branchId: query.branchId,
        }),
      };
    },
    scopeTargetOption(raw)
  );
}

export const DEPARTMENT_CREATE_OPERATION = defineOperation({
  id: 'org.department-create',
  successStatus: 201,
  module: 'iam',
  method: 'POST',
  path: '/org/departments',
  summary: 'Create a department inside a branch.',
  permissions: ['org.department.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'org.department.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DEPARTMENT_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(Body, body, 'body');
      const result = await iamModule().organizationAdministration.createDepartment(
        db,
        {
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          departmentCode: parsed.departmentCode,
          name: parsed.name,
        },
        authorizeScope
      );
      return {
        status: 201,
        body: result,
        recordVersion: result.department.recordVersion,
      };
    },
    { body }
  );
}
