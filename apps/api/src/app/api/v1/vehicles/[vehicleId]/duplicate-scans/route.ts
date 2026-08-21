/**
 * POST /api/v1/vehicles/{vehicleId}/duplicate-scans (Phase 1-17, FR-VEH-003,
 * P1-17-BE-004).
 *
 * Scores this vehicle against comparable ones and records the candidates that
 * clear the threshold. Deterministic and explainable: fixed weighted comparisons
 * over data the tenant already holds, with `match_basis` recording which signals
 * fired. No model, no training set, no hidden state — the same data always
 * produces the same score. A scan decides nothing; it produces candidates for a
 * human to review, and never auto-merges.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid });

export const VEHICLE_DUPLICATE_SCAN_OPERATION = defineOperation({
  id: 'veh.vehicle-duplicate-scan',
  module: 'vehicle',
  method: 'POST',
  path: '/vehicles/{vehicleId}/duplicate-scans',
  summary: 'Score a vehicle against comparable ones and record duplicate candidates.',
  permissions: ['veh.vehicle.duplicate.review'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'veh.vehicle.duplicates_scanned',
  idempotent: true,
  // Comparison work, not a cheap lookup — throttled like the vehicle search.
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ vehicleId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    VEHICLE_DUPLICATE_SCAN_OPERATION,
    request,
    async ({ db }) => ({
      status: 200,
      body: await vehicleModule().vehicleIdentity.scanForDuplicates(db, params.vehicleId),
    }),
    { params }
  );
}
