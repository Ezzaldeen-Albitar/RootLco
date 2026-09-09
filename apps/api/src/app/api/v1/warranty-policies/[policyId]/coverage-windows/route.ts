/**
 * POST /api/v1/warranty-policies/{policyId}/coverage (Phase 1-31, P-10).
 *
 * Adds one effective-dated coverage window to an existing warranty policy.
 *
 * The policy's create route accepts its coverage in the same body, so this exists for
 * the later addition rather than for the first authoring: a policy's terms change when
 * a workshop decides next year's warranty runs for a different number of months, and
 * the way that is expressed is a NEW window beside the old one rather than an edit of
 * it.
 *
 * ## Why adding is the only way to change terms
 *
 * `tg_warranty_coverage_immutable` freezes `policy_id` and `effective_from`, so the two
 * fields deciding WHICH window a row occupies cannot move. Nothing freezes
 * `effective_to`, and this surface still refuses to edit it: warranties issued under a
 * window cite that coverage row by id for their whole life, so re-closing a window in
 * place would silently restate the terms a customer was already bound to. Archive the
 * row and add the one you meant — that leaves the superseded terms readable beside the
 * warranties that cite them. Recorded in
 * `docs/phase-1/phase-1-31/warranty-policy-seam.md` under "what this does not close".
 *
 * ## The overlap rule is the database's, and it is reported as a conflict
 *
 * `ex_warranty_coverage_no_overlap` is a gist EXCLUDE on
 * `(tenant, company, policy, covered_scope, daterange(from, to, '[)'))` where the row is
 * ACTIVE and live — BR-WTY-001. It is the enforcement point: this route sends the row
 * and maps `23P01` to `ERR-CON-001` with `rule: 'overlapping_coverage'`. The range is
 * HALF-OPEN, so a window ending on the day the next begins is legal and consecutive
 * terms need no gap.
 *
 * There is no read on this path: the coverage rows come back WITH their policy from
 * `GET /warranty-policies/{policyId}`, in a published order, because the terms of a
 * policy are read as one thing.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import {
  COVERAGE_DATE_FORMAT,
  COVERED_SCOPES,
  MAX_DURATION_MONTHS,
  MAX_ODOMETER_ALLOWANCE,
  MIN_DURATION_MONTHS,
  MIN_ODOMETER_ALLOWANCE,
  warrantyModule,
} from '@/modules/warranty';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ policyId: schemas.uuid }).strict();

/**
 * The same window shape the policy create route embeds under `coverage[]`.
 *
 * Restated here rather than imported from the sibling route, because no route module in
 * this application imports another and a leaf handler that pulled a collection handler
 * into its bundle would be the first. What is NOT restated is the part that could
 * actually drift: every bound comes from the module's own transcription of the CHECK
 * constraints — `COVERED_SCOPES`, the two duration bounds, the two distance bounds and
 * `COVERAGE_DATE_FORMAT` — so the two schemas cannot disagree about what the column
 * accepts. The backend suite asserts the two agree on a matrix of inputs, because a
 * caller must get the same answer for the same terms whether it authored them with the
 * policy or afterwards.
 */
export const CoverageCreateBody = z
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
  .refine((value) => value.effectiveTo === undefined || value.effectiveTo > value.effectiveFrom, {
    message: 'effectiveTo must be later than effectiveFrom',
    path: ['effectiveTo'],
  });

export const WARRANTY_COVERAGE_CREATE_OPERATION = defineOperation({
  id: 'wty.warranty-coverage-create',
  successStatus: 201,
  module: 'warranty',
  method: 'POST',
  path: '/warranty-policies/{policyId}/coverage-windows',
  summary: 'Add one effective-dated coverage window to a warranty policy.',
  permissions: ['wty.policy.manage'],
  // `company`, re-authorized by the service against the POLICY's own company once it
  // is read. Company-wide, because this row decides the terms of every warranty issued
  // in every branch of that company for the window it covers.
  scope: 'company',
  auditClass: 'privileged',
  auditAction: 'wty.warranty_policy.coverage_added',
  idempotent: true,
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
    WARRANTY_COVERAGE_CREATE_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, CoverageCreateBody);
      const created = await warrantyModule().policies.createCoverage(
        db,
        params.policyId,
        input,
        authorizeScope
      );
      // The ETag is the COVERAGE row's version, which is the value its own status
      // command expects in `If-Match` — deliberately not the policy's, which is a
      // different counter on a different row and is what the two policy commands
      // expect.
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { params: raw, body }
  );
}
