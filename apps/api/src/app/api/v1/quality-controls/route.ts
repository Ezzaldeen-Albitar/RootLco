/**
 * GET /api/v1/quality-controls (PRE-P1-29-BR-06 — `INS-13`, `DEP-B4`).
 *
 * The branch QC queue. Thirteen `qms` operations shipped and every one of them
 * read QC records **per work order**, so a QC supervisor could inspect a record
 * they already had the id of and could not see the queue they were supposed to be
 * working through.
 *
 * ## `overallResult` IS an enum here — and job `state` is not
 *
 * The two fields look alike and are governed differently, so the difference is
 * worth stating where it is easy to get wrong. `qms.qc_status_history`
 * CHECK-constrains the same three literals — `pending`, `passed`, `failed` — so
 * this vocabulary is CLOSED and the mirror declares an enum for it.
 *
 * `wo.job_states` is a tenant-extensible catalogue, so the job list's `state` is
 * an opaque code and the mirror must declare **no** enum for that one. Getting
 * this backwards in either direction is a defect: an enum on a tenant-extensible
 * field refuses a tenant's own configuration, and a missing enum on a closed one
 * lets a typo through to an empty page.
 *
 * ## The scope pair is required, for the same reason as `GET /jobs`
 *
 * A collection read makes `scope: 'branch'` inert without a target, and
 * `app.branch_ids` is the permission-blind union of every grant (`P1-18-A-01`).
 * `T-02` applies here with full force.
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
import { QC_OVERALL_RESULTS, workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const QcBranchListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    overallResult: z.enum(QC_OVERALL_RESULTS).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const QC_RECORD_BRANCH_LIST_OPERATION = defineOperation({
  id: 'qms.qc-record-branch-list',
  module: 'quality',
  method: 'GET',
  path: '/quality-controls',
  summary: 'List the quality-control records of one branch, newest first.',
  permissions: ['qms.quality_control.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    QC_RECORD_BRANCH_LIST_OPERATION,
    request,
    async ({ db }) => {
      const query = parseOrFail(QcBranchListQuery, raw, 'query');
      return {
        body: await workOrderModule().jobBoard.listQcRecords(
          db,
          {
            companyId: query.companyId,
            branchId: query.branchId,
            overallResult: query.overallResult,
          },
          { cursor: query.cursor, limit: query.limit }
        ),
      };
    },
    scopeTargetOption(raw)
  );
}
