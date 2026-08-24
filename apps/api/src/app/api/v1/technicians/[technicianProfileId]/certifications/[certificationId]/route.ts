/**
 * PATCH /api/v1/technicians/{technicianProfileId}/certifications/{certificationId} (PRE-P1-29-BR-03).
 *
 * ## Why this operation exists when the BR-03 contract named eight and not this
 *
 * It is a correction proved from the tree rather than a convenience. The column
 * is `cert_status text NOT NULL DEFAULT 'active'` with
 * `CHECK (cert_status IN ('active','expired','revoked'))`, and
 * `technician-eligibility-service.ts:127` refuses a `revoked` credential outright
 * while `certificationIsValidOn` refuses any non-`active` status. Without a write
 * path, two of the three states are unreachable in production and that refusal —
 * a real safety control on who may touch a vehicle — can never fire.
 *
 * A credential is also revoked or lapsed by its issuing body on a date the
 * printed expiry does not know, which is exactly why the status column exists
 * beside the date rather than being derived from it.
 *
 * ## What cannot be changed here
 *
 * `certification_id` and `issued_on` are both named by
 * `tg_technician_certifications_immutable`. Re-pointing a record at a different
 * credential, or back-dating when it was issued, would rewrite the eligibility
 * history every assignment made under it — so the body has no word for either,
 * and `.strict()` refuses a request that tries.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { CERTIFICATION_STATUSES, technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD calendar date');

export const Params = z.object({
  technicianProfileId: schemas.uuid,
  certificationId: schemas.uuid,
});

export const Body = z
  .object({
    certStatus: z.enum(CERTIFICATION_STATUSES).optional(),
    /** `null` clears the expiry: a credential that no longer lapses. */
    expiresOn: calendarDate.nullable().optional(),
  })
  .strict();

export const TECHNICIAN_CERTIFICATION_UPDATE_OPERATION = defineOperation({
  id: 'tech.technician-certification-update',
  module: 'technician',
  method: 'PATCH',
  path: '/technicians/{technicianProfileId}/certifications/{certificationId}',
  summary: 'Revoke, expire or re-date a certification a technician holds.',
  permissions: ['tech.technician.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.technician.certification_updated',
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PATCH(
  request: Request,
  route: { params: Promise<{ technicianProfileId: string; certificationId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TECHNICIAN_CERTIFICATION_UPDATE_OPERATION,
    request,
    async ({ db, expectedVersion, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      if (Object.keys(parsed).length === 0) {
        throw new AppFailure('ERR-VAL-001', {
          message: 'An update must change at least one field',
          safeDetails: { violations: [{ path: 'body', rule: 'empty-update' }] },
        });
      }
      const updated = await technicianModule().roster.updateCertification(
        db,
        params.technicianProfileId,
        params.certificationId,
        {
          certStatus: parsed.certStatus,
          expiresOn: parsed.expiresOn,
          expectedVersion,
        },
        authorizeScope
      );
      return { body: updated, recordVersion: updated.recordVersion };
    },
    { params: raw, body }
  );
}
