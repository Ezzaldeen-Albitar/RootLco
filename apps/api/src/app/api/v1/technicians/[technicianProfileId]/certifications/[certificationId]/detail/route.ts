/**
 * PUT /api/v1/technicians/{technicianProfileId}/certifications/{certificationId}/detail (PRE-P1-29-BR-03).
 *
 * The RESTRICTED certificate number, and the only operation in this slice that
 * touches restricted data.
 *
 * ## The conjunction is the intent; the policy is the guarantee
 *
 * `tech.technician_certification_details` is one of exactly three tables in this
 * domain whose RLS consults a permission code: every SELECT, INSERT and UPDATE
 * policy on it additionally requires `iam.has_permission('iam.sensitive.view')`.
 * So the `tech.technician.manage AND iam.sensitive.view` conjunction declared
 * here states the intent, and the row layer enforces it independently — the one
 * place in this domain with real defence in depth for a permission. Everywhere
 * else the declaration is the sole control, which is why `BR-08a` exists.
 *
 * The shape matches the three shipped restricted-sidecar operations exactly:
 * `wo.additional-work-detail-record`, the rework cost write, and this.
 *
 * ## The audit row records the fact, never the number
 *
 * `iam.audit_records` is NOT gated by `iam.sensitive.view`. Copying a certificate
 * number into an audit detail would publish restricted data to every auditor, so
 * the audit records the classification and that a number was set. That is the
 * `qms.rework.cost_recorded` precedent, applied deliberately rather than by
 * resemblance.
 *
 * ## PUT, because there is one number per credential
 *
 * `uq_technician_certification_details_cert` is unique per live certification, so
 * re-sending replaces rather than accumulating. A correction to a mistyped number
 * is a replacement, not a second row.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { MAX_CERTIFICATE_NUMBER, technicianModule } from '@/modules/technician';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const Params = z.object({
  technicianProfileId: schemas.uuid,
  certificationId: schemas.uuid,
});

export const Body = z
  .object({
    certificateNumber: z.string().trim().min(1).max(MAX_CERTIFICATE_NUMBER),
  })
  .strict();

export const TECHNICIAN_CERTIFICATION_DETAIL_OPERATION = defineOperation({
  id: 'tech.technician-certification-detail-record',
  module: 'technician',
  method: 'PUT',
  path: '/technicians/{technicianProfileId}/certifications/{certificationId}/detail',
  summary: 'Record the restricted certificate number for a certification a technician holds.',
  permissions: ['tech.technician.manage', 'iam.sensitive.view'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'tech.technician.certificate_number_recorded',
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function PUT(
  request: Request,
  route: { params: Promise<{ technicianProfileId: string; certificationId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    TECHNICIAN_CERTIFICATION_DETAIL_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      return {
        body: await technicianModule().roster.setCertificateNumber(
          db,
          params.technicianProfileId,
          params.certificationId,
          parsed.certificateNumber,
          authorizeScope
        ),
      };
    },
    { params: raw, body }
  );
}
