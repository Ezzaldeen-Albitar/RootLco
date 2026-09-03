/**
 * GET /api/v1/work-orders/{workOrderId}/timeline (P1-29-W6 — `INT-043`, Owner
 * requirement 16).
 *
 * The work order's history as ONE chronology. `INT-043` measured that "the work
 * order has its own status ledger and its children hang off different
 * identifiers": to read what happened to an order a client had to walk its
 * status ledger, every job's ledger, every job's assignments, labour, log and
 * evidence, each report's ledger and each QC record's — and interleave them
 * itself. This read does the interleaving, and it stays a VIEW over those
 * ledgers, which the Owner's own rule demands: "these must not become three
 * independently mutable copies". No table is added; nothing is written.
 *
 * ## Four modules, one page, no cross-schema SQL
 *
 * The events belong to `wo`, `tech`, `dia` and `qms`. ADR-001 forbids one
 * module reading another's schema, so each answers the same windowed question
 * over its own tables and the work-order module merges the windows with the
 * keyset semantics `server/db/timeline.ts` describes. Every source over-fetches
 * one row, so the page is complete across boundaries and nothing duplicates.
 *
 * ## Kinds the caller may not see are OMITTED, and the response says so
 *
 * `wo.work_order.read` opens the timeline. Assignments and labour sessions
 * name a member of staff and cost `tech.technician.read` (`T-05`); report
 * status costs `dia.diagnostic.read`; QC status costs
 * `qms.quality_control.read`. A caller without one of those receives a
 * timeline WITHOUT that kind and an `omittedKinds` entry naming the kind and
 * the code — the `wo.job-detail` `assignments` posture (omitted, not emptied),
 * made explicit, because a history with silent gaps is worse than a history
 * with declared ones.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ workOrderId: schemas.uuid });
export const WorkOrderTimelineQuery = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const WORK_ORDER_TIMELINE_OPERATION = defineOperation({
  id: 'wo.work-order-timeline',
  module: 'work-order',
  method: 'GET',
  path: '/work-orders/{workOrderId}/timeline',
  summary: 'Read the unified history of a work order across every ledger, newest first.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ workOrderId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    WORK_ORDER_TIMELINE_OPERATION,
    request,
    async ({ db, request: req, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(
        WorkOrderTimelineQuery,
        searchParamsToObject(new URL(req.url).searchParams),
        'query'
      );
      return {
        body: await workOrderModule().jobBoard.workOrderTimeline(
          db,
          params.workOrderId,
          { cursor: query.cursor, limit: query.limit },
          authorizeScope
        ),
      };
    },
    { params: raw }
  );
}
