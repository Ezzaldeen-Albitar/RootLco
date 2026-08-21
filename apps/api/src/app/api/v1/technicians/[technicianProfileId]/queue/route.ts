/**
 * GET /api/v1/technicians/{technicianProfileId}/queue (Phase 1-19, P1-19-BE-016).
 *
 * The live work of one technician: every active assignment, with the job and the
 * parent work order it belongs to, in one query rather than one per row.
 *
 * The profile is resolved through the `technician` module BEFORE any `wo` row is
 * read, and that ordering is the access control: an id outside the caller's scope
 * answers 404 without touching an assignment, so the queue cannot be used to
 * enumerate work by guessing profile ids. The scope the deferred check runs against
 * is the profile's own company and branch (P1-18-A-01).
 *
 * The projection deliberately carries no employee-derived detail beyond the profile
 * id the caller already named — no user id, no trade, no employment reference,
 * nothing from `tech.technician_certification_details`, whose `classification`
 * column marks it restricted. A queue answers "what is this technician on", not
 * "who is this technician".
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { workOrderModule } from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ technicianProfileId: schemas.uuid });

export const TECHNICIAN_QUEUE_OPERATION = defineOperation({
  id: 'tech.technician-queue',
  module: 'technician',
  method: 'GET',
  path: '/technicians/{technicianProfileId}/queue',
  summary: 'Read the active assignments of one technician.',
  permissions: ['tech.technician.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ technicianProfileId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    TECHNICIAN_QUEUE_OPERATION,
    request,
    async ({ db, authorizeScope }) => {
      const params = parseOrFail(Params, raw, 'path');
      return {
        body: {
          technicianProfileId: params.technicianProfileId,
          items: await workOrderModule().jobAssignments.queue(
            db,
            params.technicianProfileId,
            authorizeScope
          ),
        },
      };
    },
    { params: raw }
  );
}
