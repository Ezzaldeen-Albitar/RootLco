/**
 * POST /api/v1/template-versions/{versionId}/status (PRE-P1-29-BR-04).
 *
 * Publishes or retires one template version.
 *
 * ## One command, because it is one guarded transition
 *
 * `dia.guard_template_version_publish` is `BEFORE UPDATE OF status` and enforces
 * `draft → published → retired`. Publish and retire are therefore the same
 * operation with different targets, and modelling them as `POST …/publication`
 * plus `DELETE` would give one guarded transition two verbs that can drift apart.
 * `DELETE` is granted to nobody in this domain in any case — `app_runtime` holds
 * SELECT, INSERT and UPDATE only.
 *
 * ## `toStatus` is a CLOSED enum, unlike `wo.work-order-transition`'s `toState`
 *
 * This is the distinction `execution-decision.md` §5 binding 4 warns about, and
 * getting it backwards in either direction is a defect. The work-order graph is a
 * live tenant-extensible catalogue and must never be hard-coded; this one is a
 * plpgsql guard plus a CHECK constraint and is NOT tenant-overridable, so the
 * contract states it explicitly and the mirror declares an enum here and none
 * there.
 *
 * `draft` is absent from the enum: a version is born `draft` and the guard
 * refuses every move back to it, so offering it would advertise a transition that
 * can only fail.
 *
 * ## Why an illegal move is `ERR-TRN-001` and never `ERR-CON-001`
 *
 * A version conflict is fixed by re-reading and retrying. An illegal move is
 * fixed by nothing. Rendering the same banner for both trains a user to reload
 * and retry an action that will never succeed, which is why the error catalogue
 * separates them and why this route must not blur them.
 *
 * `If-Match` is required: the version comes from the template detail read or this
 * command's own response, never from arithmetic on a number the client holds.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { diagnosticsModule, TEMPLATE_VERSION_TARGET_STATUSES } from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ versionId: schemas.uuid });

export const TemplateVersionStatusBody = z
  .object({ toStatus: z.enum(TEMPLATE_VERSION_TARGET_STATUSES) })
  .strict();

export const TEMPLATE_VERSION_STATUS_OPERATION = defineOperation({
  id: 'dia.template-version-status-set',
  module: 'diagnostics',
  method: 'POST',
  path: '/template-versions/{versionId}/status',
  summary: 'Publish or retire an inspection template version.',
  permissions: ['dia.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'dia.template_version.status_changed',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ versionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TEMPLATE_VERSION_STATUS_OPERATION,
    request,
    async ({ db, request: req, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, TemplateVersionStatusBody);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const changed = await diagnosticsModule().templates.setVersionStatus(
        db,
        params.versionId,
        input.toStatus,
        expectedVersion
      );
      return { body: changed, recordVersion: changed.recordVersion };
    },
    { params: raw, body }
  );
}
