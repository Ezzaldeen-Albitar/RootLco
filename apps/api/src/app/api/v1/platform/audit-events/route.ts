/**
 * GET /api/v1/platform/audit-events (P1-32-PRE-026).
 *
 * The platform operator's OWN audit trail: every record written in the
 * operator's home tenant, which is where every control-plane operation appends
 * its record with a `target_tenant_id` detail naming the organisation it was
 * about.
 *
 * It cannot read a tenant's own trail. `sel_audit_records_platform` is
 * `tenant_id = iam.current_tenant_id()`, and the operator's current tenant is its
 * home one; `targetTenantId` filters the operator's records BY their subject and
 * never widens what may be read.
 *
 * Bounded the way `iam.audit-event-list` is: `from` and `to` are mandatory, the
 * window is capped at 92 days, the page is clamped, and the filter set is a
 * fixed allow-list of bound parameters.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { platformModule } from '@/modules/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
    action: z.string().max(120).optional(),
    actorId: schemas.uuid.optional(),
    targetTenantId: schemas.uuid.optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

export const PLATFORM_AUDIT_SEARCH_OPERATION = defineOperation({
  id: 'platform.audit-search',
  module: 'platform',
  method: 'GET',
  path: '/platform/audit-events',
  summary: "Search the platform operator's own audit trail within a bounded date range.",
  permissions: ['platform.audit.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(PLATFORM_AUDIT_SEARCH_OPERATION, request, async ({ db, request: raw }) => {
    const query = parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query');
    return {
      body: await platformModule().insight.searchAudit(
        db,
        {
          from: query.from,
          to: query.to,
          action: query.action,
          actorId: query.actorId,
          targetTenantId: query.targetTenantId,
        },
        { cursor: query.cursor, limit: query.limit }
      ),
    };
  });
}
