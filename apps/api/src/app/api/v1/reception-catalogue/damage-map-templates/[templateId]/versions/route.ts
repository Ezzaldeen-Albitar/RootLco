/**
 * POST /api/v1/reception-catalogue/damage-map-templates/{templateId}/versions
 * (Owner decision FE-012).
 *
 * Publishes the next revision of a template slot.
 *
 * ## A revision is published, never edited
 *
 * `rec.damage_map_template_versions` has no UPDATE grant beyond retirement, and
 * the previous active revision is retired in the SAME transaction that inserts
 * the new one — `uq_damage_map_template_one_active` makes that mandatory. So a
 * slot never has two bindable revisions and never has none, and a visit already
 * bound to the old revision keeps it: `rec.damage_maps.damage_map_template_version_id`
 * is immutable, enforced by `tg_damage_maps_template_immutable`.
 *
 * That is the whole of "a historical visit retains its ORIGINAL version". It is
 * not a read filter — a read filter cannot stop a write — it is an immutable
 * column plus a guard that refuses a retired revision for a NEW map.
 *
 * ## What a revision must be
 *
 * An ACCEPTED document version in the `reception_damage_map_template` category,
 * with a live link from that document to this slot.
 * `rec.guard_damage_map_template_version()` owns all three conditions; a
 * pending, rejected or quarantined version is refused outright, because geometry
 * the platform has not accepted is geometry nobody should be drawing on.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ templateId: schemas.uuid });
export const Body = z
  .object({ documentId: schemas.uuid, documentVersionId: schemas.uuid })
  .strict();

export const DAMAGE_MAP_TEMPLATE_VERSION_OPERATION = defineOperation({
  id: 'rec.catalogue-damage-map-template-version-create',
  successStatus: 201,
  module: 'reception',
  method: 'POST',
  path: '/reception-catalogue/damage-map-templates/{templateId}/versions',
  summary: 'Publish the next revision of a damage-map template.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rec.damage_map_template.version_published',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DAMAGE_MAP_TEMPLATE_VERSION_OPERATION,
    request,
    async ({ db, request: raw, authorizeScope }) => ({
      status: 201,
      body: await receptionModule().receptionCapture.publishTemplateVersion(
        db,
        params.templateId,
        await parseJsonBody(raw, Body),
        authorizeScope
      ),
    }),
    { params, body }
  );
}
