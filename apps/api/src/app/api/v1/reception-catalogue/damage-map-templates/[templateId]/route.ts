/**
 * GET /api/v1/reception-catalogue/damage-map-templates/{templateId} (Owner
 * decision FE-012 — the historical half).
 *
 * One template slot with its FULL revision history, retired revisions and a
 * retired slot included.
 *
 * This is the read that makes "a retired template stays readable historically
 * but is unavailable for new visits" a real asymmetry rather than a sentence.
 * The bindable list (`GET /receptions/{receptionId}/evidence-bindings`) filters
 * to active slots with an active revision, and this one filters nothing: a visit
 * recorded two years ago names a revision id, and that id has to resolve to the
 * document version it was drawn on, forever.
 *
 * The `recordVersion` the status command requires as `If-Match` is supplied
 * here. Without a read that carries it, a retired slot could never be restored —
 * the same defect the intake-catalogue management remediation had to fix.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ templateId: schemas.uuid });

export const DAMAGE_MAP_TEMPLATE_READ_OPERATION = defineOperation({
  id: 'rec.catalogue-damage-map-template-read',
  module: 'reception',
  method: 'GET',
  path: '/reception-catalogue/damage-map-templates/{templateId}',
  summary: 'Read one damage-map template with every revision it has ever published.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'low-risk-metadata',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    DAMAGE_MAP_TEMPLATE_READ_OPERATION,
    request,
    async ({ db }) => {
      const params = parseOrFail(Params, raw, 'path');
      return { body: await receptionModule().receptionCapture.readTemplate(db, params.templateId) };
    },
    { params: raw }
  );
}
