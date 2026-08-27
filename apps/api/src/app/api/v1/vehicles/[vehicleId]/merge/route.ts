/**
 * POST /api/v1/vehicles/{vehicleId}/merge (Phase 1-17, FR-VEH-003, P1-17-BE-004).
 *
 * Merges the path vehicle (the source) into the survivor named in the body. The
 * plan text writes this as `{vehicleId}:merge`; it is a `/merge` sub-resource
 * because the phase's route convention rules out colon-verb paths and a `:` is
 * not a legal directory name on Windows. The operation, permission, and semantics
 * are exactly as specified.
 *
 * An approval reference is mandatory: `veh.vehicle_merges.approval_ref` is
 * `NOT NULL` and not-blank, because a merge is irreversible in practice — the
 * source becomes a frozen redirect — so it records who authorised it, not merely
 * who executed it.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, parseOrFail, schemas } from '@/server/http/validation';
import { MAX_APPROVAL_REF, vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid });
export const Body = z
  .object({
    /** The vehicle that survives. The path vehicle is redirected into it. */
    survivorId: schemas.uuid,
    approvalRef: z.string().min(1).max(MAX_APPROVAL_REF),
  })
  .strict();

export const VEHICLE_MERGE_OPERATION = defineOperation({
  id: 'veh.vehicle-merge',
  module: 'vehicle',
  method: 'POST',
  path: '/vehicles/{vehicleId}/merge',
  summary: 'Merge a duplicate vehicle into the surviving record.',
  permissions: ['veh.vehicle.merge'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'veh.vehicle.merged',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ vehicleId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    VEHICLE_MERGE_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 200,
      body: await vehicleModule().vehicleIdentity.mergeVehicle(
        db,
        params.vehicleId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}
