/**
 * POST /api/v1/inspections/{inspectionId}/dtcs (Phase 1-19, P1-19-BE-010).
 *
 * Records one diagnostic trouble code read off the vehicle.
 *
 * `ck_dtc_records_code_format` is `^[PBCU][0-9][0-9A-F]{3}$` and the shape is exact
 * rather than approximate: the first character is the system letter, the SECOND is
 * decimal, and only the last three are hex — and all of it upper case. So `P0300` is
 * valid while `p0300`, `PA300` and `P0G00` are not. Mirrored in the domain layer so a
 * malformed code is a 422 naming the field rather than a `23514` from the insert.
 *
 * `dtc_status` defaults to `active`, which is the honest reading of a code a
 * technician has just pulled: `pending`, `stored` and `cleared` are statements about
 * the vehicle's own memory that the caller has to make deliberately.
 *
 * Nothing here interprets the code. There is no DTC catalog in the protected schema —
 * `description` is free text and nullable — so this phase records what was read and
 * does not pretend to know what it means.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  DTC_CODE,
  DTC_STATUSES,
  MAX_DTC_DESCRIPTION,
  diagnosticsModule,
} from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ inspectionId: schemas.uuid });

export const Body = z
  .object({
    code: z.string().regex(DTC_CODE, 'must be an OBD-II code such as P0300'),
    description: z.string().trim().min(1).max(MAX_DTC_DESCRIPTION).optional(),
    dtcStatus: z.enum(DTC_STATUSES).optional(),
  })
  .strict();

export const DIAGNOSTIC_DTC_OPERATION = defineOperation({
  id: 'dia.diagnostic-dtc-record',
  successStatus: 201,
  module: 'diagnostics',
  method: 'POST',
  path: '/inspections/{inspectionId}/dtcs',
  summary: 'Record a diagnostic trouble code against a report.',
  permissions: ['dia.diagnostic.record'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'dia.diagnostic.entry_recorded',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ inspectionId: string }> }
): Promise<Response> {
  const raw = await route.params;
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    DIAGNOSTIC_DTC_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const dtc = await diagnosticsModule().reports.recordDtc(
        db,
        params.inspectionId,
        {
          code: parsed.code,
          description: parsed.description,
          dtcStatus: parsed.dtcStatus,
        },
        authorizeScope
      );
      return { status: 201, body: dtc, recordVersion: dtc.recordVersion };
    },
    { params: raw, body }
  );
}
