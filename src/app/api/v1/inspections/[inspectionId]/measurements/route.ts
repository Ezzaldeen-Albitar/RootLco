/**
 * POST /api/v1/inspections/{inspectionId}/measurements (Phase 1-19, P1-19-BE-010).
 *
 * Records one numeric reading against a diagnostic report.
 *
 * ## The value crosses as a decimal STRING and is compared in the database
 *
 * `dia.measurements.measured_value` is bare `numeric` — no precision, no scale, no
 * range — so IEEE-754 cannot represent every value it holds. The reading crosses this
 * boundary as a string, is stored by casting in SQL, and is compared against the
 * item's configured range as `numeric` **in the database**. A bound of `0.1` compared
 * in a double would misjudge readings the column stores exactly.
 *
 * ## Out of range is RECORDED, not refused
 *
 * `within_range` is a nullable boolean the application computes, and its three values
 * are all meaningful: `true` in spec, `false` out of spec, `null` **no range was
 * configured**. It is never flattened, because `false` would assert an out-of-spec
 * reading that nobody checked. And an out-of-spec reading is written rather than
 * rejected — a diagnostic exists to record what is wrong with a vehicle, so refusing
 * the observation would make the worst cases unreportable.
 *
 * The configured range lives in `dia.template_items.validation_rule`, a nullable
 * `jsonb` column with no CHECK and no seeded row anywhere; its shape
 * (`{min, max, options}`) is therefore this phase's documented decision rather than a
 * schema fact — see `ValidationRule` in the domain layer.
 *
 * ## Naming an item pins the unit and the type
 *
 * `ck_template_items_unit` makes a numeric item's unit mandatory, so a reading in
 * different units against that item is a reading that means nothing; and a reading
 * against a `boolean` item is incoherent. Neither is a schema rule — the foreign key
 * names no response type — so both are checked here.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import {
  DECIMAL_VALUE,
  MAX_MEASUREMENT_LABEL,
  MAX_MEASUREMENT_UNIT,
  diagnosticsModule,
} from '@/modules/diagnostics';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ inspectionId: schemas.uuid });

const Body = z
  .object({
    templateItemId: schemas.uuid.optional(),
    label: z.string().trim().min(1).max(MAX_MEASUREMENT_LABEL),
    measuredValue: z
      .string()
      .regex(DECIMAL_VALUE, 'must be a decimal with at most 6 places')
      .describe('decimal string; the column is unbounded numeric and never a JS number'),
    unit: z.string().trim().min(1).max(MAX_MEASUREMENT_UNIT),
  })
  .strict();

export const DIAGNOSTIC_MEASUREMENT_OPERATION = defineOperation({
  id: 'dia.diagnostic-measurement-record',
  module: 'diagnostics',
  method: 'POST',
  path: '/inspections/{inspectionId}/measurements',
  summary: 'Record a numeric reading, flagged against the item’s configured range.',
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
    DIAGNOSTIC_MEASUREMENT_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      const parsed = parseOrFail(Body, body, 'body');
      const measurement = await diagnosticsModule().reports.recordMeasurement(
        db,
        params.inspectionId,
        {
          templateItemId: parsed.templateItemId,
          label: parsed.label,
          measuredValue: parsed.measuredValue,
          unit: parsed.unit,
        },
        authorizeScope
      );
      return { status: 201, body: measurement, recordVersion: measurement.recordVersion };
    },
    { params: raw, body }
  );
}
