/**
 * GET /api/v1/qc-checks (P1-29-W8).
 *
 * The QC check vocabulary the caller tenant is configured with — platform rows
 * and the tenant's own, a tenant row shadowing the platform row of the same
 * code, exactly as `qms.qc_checks` has been resolved by this module since
 * P1-19 to decide the quality gate. Published by nothing until W8 measured the
 * quality and closure view against the routes: `qms.qc-record-detail` returns
 * the record's RESULTS and the mandatory checks still OPEN, so a screen could
 * address a mandatory check by id only while it was unanswered, and an
 * optional check never. `tests/backend/p1-29-w8-qc-check-list` asserts that
 * absence on the real response before proving this read.
 *
 * ## Read on `qms.quality_control.read`, and no new permission
 *
 * A vocabulary is metadata about the records it classifies. The caller who
 * may read a QC record may learn which checks exist; requiring
 * `qms.quality_control.record` here would mean a reader cannot name the check
 * a result answers.
 *
 * ## Both statuses, each row saying which — deliberately unpaged and `.strict()`
 *
 * A record written against a retired check still needs its name, so retired
 * rows come back with their status; whether a check may be ANSWERED stays the
 * write path's decision, which reads active rows only. The vocabulary is
 * bounded by configuration, as the diagnostic types are: a page boundary would
 * imply a set that does not exist, and an unknown parameter is a client defect
 * worth naming rather than ignoring.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, searchParamsToObject } from '@/server/http/validation';
import { qualityModule } from '@/modules/quality';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const QcCheckListQuery = z.object({}).strict();

export const QC_CHECK_LIST_OPERATION = defineOperation({
  id: 'qms.qc-check-list',
  module: 'quality',
  method: 'GET',
  path: '/qc-checks',
  summary: 'Read the QC check vocabulary the caller tenant is configured with.',
  permissions: ['qms.quality_control.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(QC_CHECK_LIST_OPERATION, request, async ({ db, request: raw }) => {
    parseOrFail(QcCheckListQuery, searchParamsToObject(new URL(raw.url).searchParams), 'query');
    return { body: { items: await qualityModule().gate.vocabulary(db) } };
  });
}
