/**
 * GET /api/v1/appointment-catalogue/management/source-channels (P1-27
 * remediation executed by P1-18, `P1-27-INT-018`).
 *
 * The catalogue of source channels as an ADMINISTRATOR sees it — the read the
 * management commands were shipped without.
 *
 * `GET /appointment-catalogue/source-channels` is the PICKER read and stays
 * exactly as it is: `apt.appointment.read`, active entries only, four columns, no
 * version. It cannot also be the administration read, and the gap that left was
 * not cosmetic. Retiring an entry made it invisible to every read there is, so
 * nothing could show it and therefore nothing could restore it; and no read
 * published the `recordVersion` that the rename and the lifecycle command both
 * require as `If-Match`. Between them, the management surface was reachable
 * only by a client that had just written the row and still held the response.
 *
 * Two relations reference a channel — `apt.appointments` and
 * `rec.walk_in_references` — so a channel an operator stops using is one they
 * retire rather than remove, and retirement is exactly what the picker hides.
 *
 * This operation answers both halves: no `status` filter, and `status` and
 * `recordVersion` projected. `scope` is projected as well, because a platform
 * default is visible and NOT editable — the commands answer an explained 403 for
 * one — so a screen that could not tell the two apart would render controls that
 * are guaranteed to fail.
 *
 * ## Why a separate operation rather than a flag on the picker
 *
 * `?includeRetired=true` on the existing GET would be one operation with two
 * authorization answers, and the honest form of that is two operations. The
 * split is what keeps `apt.catalogue.manage` meaningful: a caller holding
 * `apt.appointment.read` sees what it may offer, and does not acquire the
 * catalogue's administrative view — including the entries an operator
 * deliberately withdrew — by being able to read a picker.
 *
 * Tenant scoping is the dual-scope predicate `(scope = 'platform' OR tenant_id =
 * $1)` in addition to RLS, per the repository's house rule; a `tenant_id`
 * equality predicate would hide the platform catalogue RLS deliberately shows.
 *
 * `low-risk-metadata` as the picker read uses: a small tenant-scoped reference
 * list carrying no personal data. Zero rows still ship — an empty page is the
 * no-fake-data policy working, and this endpoint is how an operator fills it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas, searchParamsToObject } from '@/server/http/validation';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Query = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const SOURCE_CHANNEL_MANAGEMENT_LIST_OPERATION = defineOperation({
  id: 'apt.catalogue-source-channel-management-list',
  module: 'reception',
  method: 'GET',
  path: '/appointment-catalogue/management/source-channels',
  summary: 'List every source channel in the caller tenant catalogue, retired entries included.',
  permissions: ['apt.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  return handleOperation(
    SOURCE_CHANNEL_MANAGEMENT_LIST_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      body: await receptionModule().intakeCatalogues.listForManagement(
        db,
        'source_channels',
        parseOrFail(Query, searchParamsToObject(new URL(raw.url).searchParams), 'query')
      ),
    })
  );
}
