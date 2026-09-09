/**
 * GET / POST /api/v1/warranty-policies (Phase 1-31, prerequisite P-10).
 *
 * A company's warranty policies, as configuration. `GET` lists the policies the caller
 * can see; `POST` creates one, with its effective-dated coverage, in one transaction.
 *
 * ## Why this exists at all — PPD-04
 *
 * `wty.warranty_policies` and `wty.warranty_coverage` landed in P1-11 with SELECT,
 * INSERT and UPDATE grants and an INSERT and an UPDATE policy each, and **no code
 * anywhere in `apps/api` had ever written either table**. The `wty.policy.manage` code
 * the catalogue has seeded since P1-08 was declared by NO operation and named by NO
 * row-level-security predicate — the "declared but never wired" defect this phase keeps
 * finding, in its purest form.
 *
 * The consequence A0 records is total: `wty.warranty-generate` resolves the policy to
 * issue under as the one the caller named or the company's ONLY active one, and refuses
 * a company with none as `ERR-RES-001` — "a policy and its effective-dated coverage are
 * operator configuration; the backend does not create one". Since nothing could create
 * one, **no tenant provisioned through the product could ever issue a warranty.** The
 * backend suites reach the surface by seeding `wty.warranty_policies` with admin SQL,
 * which is itself the measurement.
 *
 * ## Why the collection is top-level and not nested under a company
 *
 * The same reason `/service-categories` and `/delivery-checklist-templates` are: a
 * caller may configure several companies, every row carries its own `companyId`, and
 * `sel_warranty_policies_scope` already narrows the set to the companies the caller's
 * grants reach. A `/companies/{companyId}/warranty-policies` shape would make the
 * cross-company list — the one an administrator actually wants — unreachable.
 *
 * ## No money
 *
 * `wty` has 80 columns and not one is an amount, a currency or a cap in any unit of
 * account. `durationMonths` is a count of months and is an `integer`, rendered as a JSON
 * number: the decimal-string rule this codebase applies to money exists because
 * `numeric` cannot survive IEEE-754, which does not apply to an `integer`.
 * `odometerAllowance` is a DISTANCE and is carried as an exact decimal string, matching
 * how every odometer reading crosses the wire in this codebase.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import {
  COVERAGE_DATE_FORMAT,
  COVERED_SCOPES,
  MAX_DURATION_MONTHS,
  MAX_ODOMETER_ALLOWANCE,
  MAX_POLICY_NAME,
  MIN_DURATION_MONTHS,
  MIN_ODOMETER_ALLOWANCE,
  POLICY_CODE_FORMAT,
  WARRANTY_LIFECYCLE_STATUSES,
  warrantyModule,
} from '@/modules/warranty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Query surface — a closed allow-list: one filter and pagination.
 *
 * `status` is offered because it is the one narrowing a screen genuinely needs: the
 * picker on the warranty-generation form must show the policies a warranty can
 * actually be issued under, and `resolvePolicy` counts exactly the ACTIVE ones. It is
 * OPTIONAL and the list is unfiltered by default, because a configuration list that
 * hid archived rows would make the restore command unreachable — the trap
 * `apt.catalogue-source-channel-status-set` records for its own catalogue.
 *
 * No `companyId` filter is offered, and that is deliberate rather than an omission:
 * every row carries its own `companyId`, `sel_warranty_policies_scope` already narrows
 * to the companies the caller's grants reach, and a filter that could only ever narrow
 * that further is a branch, a denial case and a coverage obligation for no capability.
 * `svc.service-category-list` states the same rule.
 */
const ListQuery = z
  .object({
    status: z.enum(WARRANTY_LIFECYCLE_STATUSES).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const WARRANTY_POLICY_LIST_OPERATION = defineOperation({
  id: 'wty.warranty-policy-list',
  module: 'warranty',
  method: 'GET',
  path: '/warranty-policies',
  summary: 'List the warranty policies visible to the caller.',
  // `wty.warranty.read`, the code P-7 minted, and NOT `wty.policy.manage`. A policy
  // picker is needed by everyone who issues a warranty and by everyone who reads one:
  // `wty.warranty-generate` accepts a `policyId` it cannot invent, and
  // `wty.warranty-list` publishes a policy block on every row precisely so the id can
  // be resolved. Gating the picker on the ADMINISTRATION code would mean a warranty
  // clerk could name a policy only by guessing its id. The rows carry no personal
  // data — a code, a name, a status, and durations — so the read code is the
  // least-privilege one that works.
  permissions: ['wty.warranty.read'],
  // `tenant`, and this is the substantive scope decision on the READ side. Both tables
  // have a company and NO branch, so a company target would be satisfiable only by a
  // company-wide or unrestricted grant — which would deny the policy list to a
  // warranty clerk scoped to one branch, the exact principal `wty.warranty-generate`
  // is built for (`scope: 'branch'`). `sel_warranty_policies_scope` narrows by
  // `iam.allowed_company_ids()`, which includes the company of a branch-scoped grant
  // because `ck_grant_scopes_shape` requires every scope row to name its company. The
  // WRITES below re-authorize against the target company and do not rely on this.
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(WARRANTY_POLICY_LIST_OPERATION, request, async ({ db, request: raw }) => {
    const query = parseOrFail(
      ListQuery,
      searchParamsToObject(new URL(raw.url).searchParams),
      'query'
    );
    return {
      body: await warrantyModule().policies.listPolicies(
        db,
        { ...(query.status === undefined ? {} : { status: query.status }) },
        {
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
          ...(query.limit === undefined ? {} : { limit: query.limit }),
        }
      ),
    };
  });
}

/**
 * One coverage window, as the create body and the add route both accept it.
 *
 * `status` is refused: the column defaults to `active`, and
 * `ex_warranty_coverage_no_overlap` is PARTIAL on `status = 'active'`, so a coverage
 * born `archived` could be written into a window that is already covered and then
 * reactivated into a violation later.
 *
 * `durationMonths` is a JSON number because the column is an `integer` and a count of
 * months is not an amount. `odometerAllowance` is a STRING of digits, because it is a
 * distance and every odometer value in this codebase crosses the wire as an exact
 * decimal string — `veh.odometer_readings.value` is `numeric`, and using one spelling
 * for the reading and another for the allowance is how a float gets onto the path.
 * Omitting it means an unlimited-distance coverage, which is what a NULL column means.
 */
export const CoverageBody = z
  .object({
    coveredScope: z.enum(COVERED_SCOPES),
    durationMonths: z.number().int().min(MIN_DURATION_MONTHS).max(MAX_DURATION_MONTHS),
    odometerAllowance: z
      .string()
      .regex(/^\d+$/, 'odometerAllowance must be a whole number of distance units')
      .refine(
        (value) => {
          const parsed = Number.parseInt(value, 10);
          return parsed >= MIN_ODOMETER_ALLOWANCE && parsed <= MAX_ODOMETER_ALLOWANCE;
        },
        `odometerAllowance must be between ${String(MIN_ODOMETER_ALLOWANCE)} and ${String(MAX_ODOMETER_ALLOWANCE)}`
      )
      .optional(),
    effectiveFrom: z.string().regex(COVERAGE_DATE_FORMAT, 'effectiveFrom must be YYYY-MM-DD'),
    effectiveTo: z
      .string()
      .regex(COVERAGE_DATE_FORMAT, 'effectiveTo must be YYYY-MM-DD')
      .optional(),
  })
  .strict()
  // `ck_warranty_coverage_effective` is `effective_to IS NULL OR effective_to >
  // effective_from`. Mirrored here so an inverted window is a 422 naming the field
  // rather than a `23514` naming a constraint; the CHECK is still the authority.
  .refine((value) => value.effectiveTo === undefined || value.effectiveTo > value.effectiveFrom, {
    message: 'effectiveTo must be later than effectiveFrom',
    path: ['effectiveTo'],
  });

/**
 * Create body — a closed allow-list.
 *
 * It refuses `id`, so a caller cannot choose a primary key, and refuses `status`, so a
 * policy cannot be created already `archived` — one `assertPolicyActive` refuses at
 * issue time while it still holds its code. The column defaults to `active`.
 *
 * `companyId` is REQUIRED and is a claim, not a scope: the service authorizes it
 * against the caller's own grants before anything is written, and
 * `fk_warranty_policies_company` resolves it with the tenant taken from the session
 * context, so a company belonging to another tenant cannot be named into existence.
 *
 * `coverage` may be omitted, but when it is present it lands in the SAME transaction as
 * the header — a policy that exists with half of its terms is not a state this surface
 * can produce.
 */
export const CreateBody = z
  .object({
    companyId: schemas.uuid,
    policyCode: z
      .string()
      .regex(POLICY_CODE_FORMAT, 'policyCode must match ^[a-z][a-z0-9_]{1,62}$'),
    name: z.string().trim().min(1).max(MAX_POLICY_NAME),
    coverage: z.array(CoverageBody).optional(),
  })
  .strict();

export const WARRANTY_POLICY_CREATE_OPERATION = defineOperation({
  id: 'wty.warranty-policy-create',
  successStatus: 201,
  module: 'warranty',
  method: 'POST',
  path: '/warranty-policies',
  summary: 'Create a warranty policy, with its effective-dated coverage, for one company.',
  // `wty.policy.manage` — the seeded catalogue code this operation is the FIRST in the
  // repository to declare. Nothing was minted: the code has existed in
  // `supabase/seeds/04_iam_permission_catalog.sql` since P1-08 and its own contract
  // named it as the authority for exactly this act. `wty.warranty-detail` records the
  // converse, that borrowing it for a READ "would be worse: it grants coverage
  // administration" — which is precisely what this operation is.
  permissions: ['wty.policy.manage'],
  // `company`, and the target is supplied by the SERVICE against the body's claimed
  // company before the row is written — a declared scope is inert without a target
  // (P1-18-A-01), so the declaration alone decides nothing. The authority must be
  // company-wide because a coverage row authored here sets the terms of every warranty
  // issued in every BRANCH of that company: `resolvePolicy` picks the company's only
  // active policy for all of them, and neither table has a branch column at all.
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'wty.warranty_policy.created',
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
    WARRANTY_POLICY_CREATE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const parsed = parseOrFail(CreateBody, body, 'body');
      const created = await warrantyModule().policies.createPolicy(
        db,
        {
          companyId: parsed.companyId,
          policyCode: parsed.policyCode,
          name: parsed.name,
          coverage: parsed.coverage ?? [],
        },
        authorizeScope
      );
      // The ETag is the POLICY's version, which is what `If-Match` on the rename and
      // the status command expects. A coverage row carries its own counter and is
      // fetched with the detail read.
      return { status: 201, body: created, recordVersion: created.policy.recordVersion };
    },
    { body }
  );
}
