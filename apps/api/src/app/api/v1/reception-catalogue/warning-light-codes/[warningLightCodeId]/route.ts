/**
 * PATCH /api/v1/reception-catalogue/warning-light-codes/{warningLightCodeId}
 * (P1-27 remediation executed by P1-18, `P1-27-INT-018`).
 *
 * Renames one tenant warning-light code. `code` is absent from the body and frozen by
 * `tg_warning_light_codes_immutable` besides: pre-service condition evidence is permanent and names the code it observed, so a re-coded entry
 * would be a different row wearing the old one's identity. Fixing a label is an
 * edit; a new code is a new entry.
 *
 * `status` is absent too — retirement is its own command, so the authority to
 * correct a typo is not the authority to withdraw a warning-light code from every
 * intake form.
 *
 * `If-Match` is mandatory. The list read publishes no record version, so the
 * caller's version comes from the create response or from a prior write — the
 * same contract every guarded command in this module uses.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { MAX_CATALOGUE_NAME, receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ warningLightCodeId: schemas.uuid });
const Body = z.object({ name: z.string().trim().min(1).max(MAX_CATALOGUE_NAME) }).strict();

export const WARNING_LIGHT_CODE_UPDATE_OPERATION = defineOperation({
  id: 'rec.catalogue-warning-light-code-update',
  module: 'reception',
  method: 'PATCH',
  path: '/reception-catalogue/warning-light-codes/{warningLightCodeId}',
  summary: 'Rename a warning-light code in the caller tenant catalogue.',
  permissions: ['rec.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'rec.warning_light_code.renamed',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ warningLightCodeId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    WARNING_LIGHT_CODE_UPDATE_OPERATION,
    request,
    async ({ db, request: req, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const updated = await receptionModule().intakeCatalogues.rename(
        db,
        'warning_light_codes',
        params.warningLightCodeId,
        expectedVersion,
        input.name
      );
      return { body: updated, recordVersion: updated.recordVersion };
    },
    { params: raw }
  );
}
