/**
 * /api/v1/reports/{reportCode}/snapshots — frozen report snapshots and their
 * restatements (Owner decision D16, P1-32-PRE-OD-FD16B).
 *
 * POST saves a frozen copy of ONE run of a report — its period, zone, as-of
 * moment, filters, columns and every row — or, naming the latest snapshot of that
 * period and a reason, a RESTATEMENT of it. GET lists a branch's snapshots of the
 * report, newest first, without their rows.
 *
 * ## One consistent read, written at READ COMMITTED
 *
 * The rows are read page by page through the same report run the screen and the
 * export use, and the service reads them in a READ ONLY transaction of its own at
 * REPEATABLE READ, so the stored copy is one consistent read. This route's own
 * transaction — the insert, the audit record and the idempotency key — stays at the
 * server's READ COMMITTED: the audit chain's numbering must see every audited write
 * the tenant committed while the pages were read (see the service's header).
 *
 * ## Permissions
 *
 * Saving declares `rpt.export` and `rpt.report.read` at the branch, and the
 * service requires every code the dataset needs as well — a snapshot is a durable
 * copy of the figures, and no dedicated snapshot code exists yet (an open Owner
 * question). Listing declares `rpt.report.read`; the service requires the
 * dataset's codes and row-level security admits a snapshot only to a caller
 * holding every code it froze.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import {
  MAX_RESTATEMENT_REASON,
  reportingModule,
  type ReportSnapshotCreatedView,
  type ReportSnapshotListView,
} from '@/modules/reporting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The schema's own `ck_report_snapshots_code` shape, enforced before any query. */
const ReportCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,62}$/, 'report code must match ^[a-z][a-z0-9_]{1,62}$');

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD calendar day');

/**
 * The same scope and period as the rows read, the optional moment (Owner decision
 * D16: an instant with an offset; absent, the report's own default), and for a
 * restatement the snapshot it replaces and why.
 */
export const SnapshotBody = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    from: Day,
    to: Day,
    asOf: z.iso.datetime({ offset: true }).optional(),
    restatesSnapshotId: schemas.uuid.optional(),
    // Checked for content by the service, so a blank reason on a restatement is a
    // refusal by rule that is recorded (ADR-023 D12), not a schema error.
    reason: z.string().max(MAX_RESTATEMENT_REASON).optional(),
  })
  .strict();

/** `.strict()` so a mistyped filter is refused rather than ignored. */
const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    from: Day.optional(),
    to: Day.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const REPORT_SNAPSHOT_CREATE_OPERATION = defineOperation({
  id: 'rpt.report-snapshot-create',
  successStatus: 201,
  module: 'reporting',
  method: 'POST',
  path: '/reports/{reportCode}/snapshots',
  summary: 'Save a frozen snapshot of a report run, or restate the latest one with a reason.',
  permissions: ['rpt.export', 'rpt.report.read'],
  scope: 'branch',
  auditClass: 'financial',
  auditAction: 'rpt.report.snapshot_created',
  idempotent: true,
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  requestBodySchema: z.toJSONSchema(SnapshotBody),
  pathParameterSchemas: { reportCode: z.toJSONSchema(ReportCode) },
});

export const REPORT_SNAPSHOT_LIST_OPERATION = defineOperation({
  id: 'rpt.report-snapshot-list',
  module: 'reporting',
  method: 'GET',
  path: '/reports/{reportCode}/snapshots',
  summary: 'List the saved snapshots of a report in one branch, newest first, without their rows.',
  permissions: ['rpt.report.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
  queryParameterSchema: z.toJSONSchema(ListQuery),
  pathParameterSchemas: { reportCode: z.toJSONSchema(ReportCode) },
});

export async function POST(
  request: Request,
  context: { params: Promise<{ reportCode: string }> }
): Promise<Response> {
  const params = await context.params;
  const body: unknown = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    REPORT_SNAPSHOT_CREATE_OPERATION,
    request,
    async ({ db, request: incoming, authorizeScope, requireScopeClaim, replayIfRetried }) => {
      const code = parseOrFail(ReportCode, params.reportCode, 'path.reportCode');
      const input = await parseJsonBody(incoming, SnapshotBody);
      const target = { companyId: input.companyId, branchId: input.branchId };
      await authorizeScope(target);
      await requireScopeClaim(target);
      const created: ReportSnapshotCreatedView = await reportingModule().snapshots.create(
        db,
        {
          reportCode: code,
          companyId: input.companyId,
          branchId: input.branchId,
          from: input.from,
          to: input.to,
          asOf: input.asOf,
          restatesSnapshotId: input.restatesSnapshotId,
          reason: input.reason,
        },
        { replayIfRetried }
      );
      return { status: 201, body: created };
    },
    { ...scopeTargetOption(body), params, body }
  );
}

export async function GET(
  request: Request,
  context: { params: Promise<{ reportCode: string }> }
): Promise<Response> {
  const params = await context.params;
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    REPORT_SNAPSHOT_LIST_OPERATION,
    request,
    async ({ db }) => {
      const code = parseOrFail(ReportCode, params.reportCode, 'path.reportCode');
      const query = parseOrFail(ListQuery, raw, 'query');
      const listed: ReportSnapshotListView = await reportingModule().snapshots.list(db, {
        reportCode: code,
        companyId: query.companyId,
        branchId: query.branchId,
        from: query.from,
        to: query.to,
        cursor: query.cursor,
        limit: query.limit,
      });
      return { body: listed };
    },
    // Scoped before the schema, as the rows read is: the pair is the target.
    scopeTargetOption(raw)
  );
}
