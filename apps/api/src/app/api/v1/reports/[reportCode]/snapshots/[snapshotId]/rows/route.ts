/**
 * GET /api/v1/reports/{reportCode}/snapshots/{snapshotId}/rows — a saved
 * snapshot's frozen rows (Owner decision D16, P1-32-PRE-OD-FD16B).
 *
 * Answers the snapshot's metadata — period, zone, the moment its amounts were
 * computed as of, who saved it and when, the row count and the digest of the
 * stored rows — with the snapshot it restates and the one that restated it, the
 * difference a restatement carries, and one page of the rows exactly as they
 * were saved. Nothing is recomputed: a payment, credit or reversal recorded since
 * changes nothing here.
 *
 * The route declares `rpt.report.read` at the branch; the branch is the
 * SNAPSHOT's own, so the check is deferred until the row is read, as every
 * single-record read does. Row-level security additionally admits the snapshot
 * only to a caller holding every code it froze, and the service checks them
 * again. A snapshot that is absent, in another tenant, out of reach or not
 * readable to this caller answers the same "not found".
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { reportingModule, type ReportSnapshotRowsView } from '@/modules/reporting';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ReportCode = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,62}$/, 'report code must match ^[a-z][a-z0-9_]{1,62}$');

const Params = z.object({ reportCode: ReportCode, snapshotId: schemas.uuid }).strict();

const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const REPORT_SNAPSHOT_READ_OPERATION = defineOperation({
  id: 'rpt.report-snapshot-read',
  module: 'reporting',
  method: 'GET',
  path: '/reports/{reportCode}/snapshots/{snapshotId}/rows',
  summary: 'Read a saved report snapshot: its frozen rows, its metadata and its restatements.',
  permissions: ['rpt.report.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
  answersNotFound: true,
  queryParameterSchema: z.toJSONSchema(Query),
  pathParameterSchemas: {
    reportCode: z.toJSONSchema(ReportCode),
    snapshotId: z.toJSONSchema(schemas.uuid),
  },
});

export async function GET(
  request: Request,
  context: { params: Promise<{ reportCode: string; snapshotId: string }> }
): Promise<Response> {
  const raw = await context.params;
  const search = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    REPORT_SNAPSHOT_READ_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(Query, search, 'query');
      const read: ReportSnapshotRowsView = await reportingModule().snapshots.read(
        db,
        {
          reportCode: params.reportCode,
          snapshotId: params.snapshotId,
          cursor: query.cursor,
          limit: query.limit,
        },
        authorizeScope
      );
      return { body: read };
    },
    { params: raw }
  );
}
