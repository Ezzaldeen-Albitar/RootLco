/**
 * POST /api/v1/reception-catalogue/damage-map-templates/{templateId}/status
 * (Owner decision FE-012).
 *
 * Retires or restores one template slot. There is no delete and there cannot be:
 * `app_runtime` holds no DELETE grant on `rec.damage_map_templates` and no
 * DELETE policy exists, so a hard removal is refused however it is asked for.
 *
 * ## Retiring withdraws the slot from NEW visits only
 *
 * `rec.guard_damage_map_template_binding()` refuses a retired slot for a new
 * damage map. Every map already bound to one of its revisions keeps that
 * revision, keeps resolving to the document version it was drawn on, and keeps
 * every mark placed on it at the coordinates they were placed at. That is the
 * asymmetry FE-012 asks for, and it is why retirement is a status rather than a
 * removal.
 *
 * ## And it restores
 *
 * A retired slot still owns its revision history and the visits bound to it, so
 * a one-way retirement would leave an operator with no way back other than
 * creating a second slot — which would fork the history of one diagram into two
 * identities. One bidirectional lifecycle command instead, the same shape the
 * intake catalogues use.
 *
 * `If-Match` is required. The version comes from
 * `GET /reception-catalogue/damage-map-templates/{templateId}` or from this
 * command's own response, never from arithmetic on a number the client already
 * holds.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { DAMAGE_MAP_TEMPLATE_STATUSES, receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ templateId: schemas.uuid });
export const Body = z.object({ status: z.enum(DAMAGE_MAP_TEMPLATE_STATUSES) }).strict();

export const DAMAGE_MAP_TEMPLATE_STATUS_OPERATION = defineOperation({
  id: 'rec.catalogue-damage-map-template-status-set',
  module: 'reception',
  method: 'POST',
  path: '/reception-catalogue/damage-map-templates/{templateId}/status',
  summary: 'Retire or restore a damage-map template of the caller tenant.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rec.damage_map_template.status_changed',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ templateId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DAMAGE_MAP_TEMPLATE_STATUS_OPERATION,
    request,
    async ({ db, request: req, authorizeScope, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const changed = await receptionModule().receptionCapture.setTemplateStatus(
        db,
        params.templateId,
        expectedVersion,
        input.status,
        authorizeScope
      );
      return { body: changed, recordVersion: changed.template.recordVersion };
    },
    { params: raw, body }
  );
}
