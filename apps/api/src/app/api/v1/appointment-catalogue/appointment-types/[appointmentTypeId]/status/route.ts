/**
 * POST /api/v1/appointment-catalogue/appointment-types/{appointmentTypeId}/status
 * (P1-27 remediation executed by P1-18, `P1-27-INT-018`).
 *
 * Retires or restores one tenant appointment type. This is the ONLY removal
 * affordance, and it is deliberate in both directions.
 *
 * ## There is no delete, and there cannot be
 *
 * `app_runtime` holds no DELETE grant on `apt.appointment_types` and no DELETE
 * policy exists, so a hard removal is refused by the database however it is
 * asked for. That is the property that matters: appointments reference this row
 * by uuid, and a catalogue entry that could vanish would break every appointment
 * booked against it. Retiring sets `status = 'inactive'`, which the picker read
 * filters out — the type stops being offered to new bookings while every
 * existing reference stays satisfied.
 *
 * ## Why it restores as well as retires
 *
 * `uq_appointment_types_tenant_code` is `(tenant_id, code)
 * WHERE scope = 'tenant' AND deleted_at IS NULL`. The predicate names
 * `deleted_at`, NOT `status`, so a RETIRED row still holds its code and
 * re-adding that code is refused with a 23505. A retire-only command would
 * therefore burn the code for the tenant permanently. One bidirectional
 * lifecycle command instead — the `crm.customer-status-set` and
 * `shared.branch-status-change` precedent.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { AppFailure } from '@/server/errors/app-failure';
import { CATALOGUE_STATUSES, receptionModule } from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ appointmentTypeId: schemas.uuid });
export const Body = z.object({ status: z.enum(CATALOGUE_STATUSES) }).strict();

export const APPOINTMENT_TYPE_STATUS_OPERATION = defineOperation({
  id: 'apt.catalogue-appointment-type-status-set',
  module: 'reception',
  method: 'POST',
  path: '/appointment-catalogue/appointment-types/{appointmentTypeId}/status',
  summary: 'Retire or restore an appointment type in the caller tenant catalogue.',
  permissions: ['apt.catalogue.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'apt.appointment_type.status_changed',
  idempotent: true,
  versionGuarded: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ appointmentTypeId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    APPOINTMENT_TYPE_STATUS_OPERATION,
    request,
    async ({ db, request: req, expectedVersion }) => {
      const params = parseOrFail(Params, raw, 'path');
      const input = await parseJsonBody(req, Body);
      if (expectedVersion === null) {
        throw new AppFailure('ERR-CON-002', { message: 'If-Match is required' });
      }
      const changed = await receptionModule().intakeCatalogues.setStatus(
        db,
        'appointment_types',
        params.appointmentTypeId,
        expectedVersion,
        input.status
      );
      return { body: changed, recordVersion: changed.recordVersion };
    },
    { params: raw, body }
  );
}
