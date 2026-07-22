/**
 * GET /api/v1/audit-events (P1-14, ADV-03 boundary).
 *
 * The canonical audit-view operation. Reading the audit trail is itself
 * privileged, so the read is audited — a reviewer must be able to see who looked
 * at the record of who did what.
 *
 * Three bounds keep this from being a bulk-export tool wearing a list endpoint's
 * clothes:
 *
 *  - **`from` and `to` are mandatory**, and the window may not exceed 92 days.
 *    Defaulting the range would make the most expensive possible query the one a
 *    caller gets by supplying nothing;
 *  - **the page size is clamped** by the foundation's `MAX_PAGE_SIZE`;
 *  - **the filter set is a fixed allow-list** — action, entity type, entity id,
 *    actor, company, branch — every one a bound parameter in a fixed statement.
 *    There is no expression language and no dynamic column, because a flexible
 *    audit filter is an inference tool.
 *
 * Export is out of scope and no endpoint offers it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { iamModule } from '@/modules/iam';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z.object({
  from: z.string().datetime(),
  to: z.string().datetime(),
  cursor: schemas.cursor.optional(),
  limit: schemas.limit.optional(),
  action: z.string().max(120).optional(),
  entityType: z.string().max(120).optional(),
  entityId: schemas.uuid.optional(),
  actorId: schemas.uuid.optional(),
  companyId: schemas.uuid.optional(),
  branchId: schemas.uuid.optional(),
});

export const AUDIT_EVENT_LIST_OPERATION = defineOperation({
  id: 'iam.audit-event-list',
  module: 'iam',
  method: 'GET',
  path: '/audit-events',
  summary: 'List audit records within a bounded date range.',
  permissions: ['iam.audit.view'],
  scope: 'tenant',
  auditClass: 'security',
  auditAction: 'iam.audit.viewed',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(AUDIT_EVENT_LIST_OPERATION, request, async ({ db, request: raw }) => {
    const url = new URL(raw.url);
    const query = parseOrFail(Query, searchParamsToObject(url.searchParams), 'query');
    return {
      body: await iamModule().auditView.list(
        db,
        { cursor: query.cursor, limit: query.limit },
        {
          from: query.from,
          to: query.to,
          action: query.action,
          entityType: query.entityType,
          entityId: query.entityId,
          actorId: query.actorId,
          companyId: query.companyId,
          branchId: query.branchId,
        }
      ),
    };
  });
}
