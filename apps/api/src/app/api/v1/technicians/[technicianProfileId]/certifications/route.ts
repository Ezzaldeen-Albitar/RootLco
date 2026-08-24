/**
 * POST /api/v1/technicians/{technicianProfileId}/certifications (PRE-P1-29-BR-03).
 *
 * Records a credential a technician holds. Operational rather than restricted:
 * `tech.technician_certifications` is deliberately readable without
 * `iam.sensitive.view` so eligibility and expiry queries need no sensitive
 * permission — the certificate NUMBER is the restricted half and lives in its own
 * 1:1 sidecar.
 *
 * ## Dates are calendar dates, and the expiry rule is the database's
 *
 * `issued_on` and `expires_on` are `date`, not `timestamptz`: a credential is
 * valid for a day, not from an instant, and `certificationIsValidOn` compares
 * `YYYY-MM-DD` strings for exactly that reason. `ck_technician_certifications_expiry`
 * is `expires_on >= issued_on` — INCLUSIVE, so a credential issued and expiring on
 * the same day is legal. The service refuses the same condition first so the caller
 * gets a violation path instead of a transaction-aborting `23514`, and it uses the
 * database's `>=` rather than a stricter `>` invented in the API.
 *
 * ## `certStatus` is not in the body
 *
 * A recorded credential is `active` — that is the column default. Offering the
 * status here would let an administrator record a credential that is revoked on
 * arrival, which is a state with no stated purpose. Moving it later is
 * `PATCH .../certifications/{certificationId}`.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** `YYYY-MM-DD`. A calendar date, never an instant. */
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be a YYYY-MM-DD calendar date');

export const Params = z.object({ technicianProfileId: schemas.uuid });

export const Body = z
  .object({
    certificationId: schemas.uuid,
    issuedOn: calendarDate,
    expiresOn: calendarDate.optional(),
  })
  .strict();

export const TECHNICIAN_CERTIFICATION_RECORD_OPERATION = defineOperation({
  id: 'tech.technician-certification-record',
  module: 'technician',
  method: 'POST',
  path: '/technicians/{technicianProfileId}/certifications',
  summary: 'Record a certification a technician holds.',
  permissions: ['tech.technician.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.technician.certification_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ technicianProfileId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TECHNICIAN_CERTIFICATION_RECORD_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const created = await technicianModule().roster.recordCertification(
        db,
        params.technicianProfileId,
        {
          certificationId: parsed.certificationId,
          issuedOn: parsed.issuedOn,
          expiresOn: parsed.expiresOn,
        },
        authorizeScope
      );
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    { params: raw, body }
  );
}
