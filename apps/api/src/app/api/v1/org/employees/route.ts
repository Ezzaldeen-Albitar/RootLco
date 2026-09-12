/**
 * GET / POST /api/v1/org/employees (P1-31 prerequisite P-17).
 *
 * The employee register. Before this slice the platform had no employee at all:
 * it had LOGIN ACCOUNTS, and `sal.delivery_records.delivering_employee_id`
 * carried no foreign key, so the person who handed a vehicle over was whatever
 * uuid a client sent.
 *
 * ## The two verbs take DIFFERENT permissions, and that is the point
 *
 *   GET  -> `org.employee.read`   (new, risk `low`)
 *   POST -> `org.employee.manage` (new, risk `medium`)
 *
 * Both codes are minted by this slice, and the split follows `org.department`
 * exactly. Reusing the manage code for the list would force every handover clerk
 * — anyone who must CHOOSE a delivering employee — to hold the authority to
 * alter the organisation's roster. The permission catalogue names that failure
 * in its own words as "over-granting by omission rather than by decision".
 *
 * The suite proves the split rather than asserting it: an actor holding only
 * `org.employee.manage` is REFUSED the list, and an actor holding only
 * `org.employee.read` is refused the create. If someone later "simplifies" this
 * to one code, those two cases go red.
 *
 * ## Create is the only employee operation that trusts the request for scope
 *
 * There is no row to resolve yet, so the company/branch pair comes from the body
 * and is authorized BEFORE the insert, with `ins_employees_scope` as the backstop
 * behind it. Every other employee operation resolves the row first and re-decides
 * against the row's own pair. This is the same arrangement
 * `tech.technician-create` and `org.department-create` use, for the same reason.
 *
 * ## `userAccountId` is optional, and that is the whole reason this table exists
 *
 * `tech.technician_profiles.user_id` and `iam.user_employee_links.user_id` are
 * both NOT NULL foreign keys into `iam.user_accounts`. A workshop that sends
 * someone out to hand a vehicle over cannot always give that person a login, and
 * neither existing table can hold them.
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
import {
  EMPLOYEE_STATUSES,
  MAX_EMPLOYEE_DISPLAY_NAME,
  MAX_EMPLOYEE_EMPLOYMENT_REF,
  iamRegistryModule,
} from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Query = z
  .object({
    // BOTH required. An employee list with no branch would be a tenant-wide read
    // behind a branch-scoped permission, and `scope: 'branch'` is inert without a
    // target — `requiresScopedEvaluation` returns false on an empty one whatever
    // the declaration says.
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    // Optional, and the unfiltered list shows retired employees: the reinstate
    // command would otherwise be unreachable from the register it acts on.
    status: z.enum(EMPLOYEE_STATUSES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const Body = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    displayName: z.string().trim().min(1).max(MAX_EMPLOYEE_DISPLAY_NAME),
    /** The login account this person signs in with, when they have one at all. */
    userAccountId: schemas.uuid.optional(),
    /** Opaque non-PII link to an employment record held elsewhere. */
    employmentRef: z.string().trim().min(1).max(MAX_EMPLOYEE_EMPLOYMENT_REF).optional(),
  })
  .strict();

/**
 * Each declaration sits immediately before ITS OWN handler, and that placement is
 * load-bearing rather than stylistic: `scripts/p1-19-endpoint-inventory.mjs`
 * decides whether a `scope: 'branch'` claim is enforced by reading the text
 * BETWEEN one `defineOperation` and the next.
 */
export const EMPLOYEE_LIST_OPERATION = defineOperation({
  id: 'org.employee-list',
  module: 'iam',
  method: 'GET',
  path: '/org/employees',
  summary: "List a branch's employee register.",
  permissions: ['org.employee.read'],
  scope: 'branch',
  auditClass: 'none',
  // `expensive-read` rather than `low-risk-metadata`: this is a keyset-paged read
  // a screen scrolls, not a bounded selector fetched once.
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    EMPLOYEE_LIST_OPERATION,
    request,
    async ({ db }) => {
      const query = parseOrFail(Query, raw, 'query');
      return {
        body: await iamRegistryModule().employees.listEmployees(db, {
          companyId: query.companyId,
          branchId: query.branchId,
          status: query.status,
          cursor: query.cursor,
          limit: query.limit,
        }),
      };
    },
    scopeTargetOption(raw)
  );
}

export const EMPLOYEE_CREATE_OPERATION = defineOperation({
  id: 'org.employee-create',
  successStatus: 201,
  module: 'iam',
  method: 'POST',
  path: '/org/employees',
  summary: 'Add an employee to a branch register.',
  permissions: ['org.employee.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'org.employee.created',
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
    EMPLOYEE_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(Body, body, 'body');
      const created = await iamRegistryModule().employees.createEmployee(
        db,
        {
          companyId: parsed.companyId,
          branchId: parsed.branchId,
          displayName: parsed.displayName,
          userAccountId: parsed.userAccountId,
          employmentRef: parsed.employmentRef,
        },
        authorizeScope
      );
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    // Both halves, on the `tech.technician-create` precedent. `scopeTargetOption`
    // narrows the PRE-handler check to the named pair, and the service re-decides
    // the same pair before the insert; the two are not redundant, because the
    // pre-handler check runs before the body has been schema-validated and the
    // service's runs after.
    { body, ...scopeTargetOption(body) }
  );
}
