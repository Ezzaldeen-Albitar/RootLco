/**
 * GET /api/v1/vehicles/{vehicleId}/documents — documents reachable from a vehicle
 * (Phase 1-17, P1-17-BE-012).
 *
 * Lists the ids of documents linked to the vehicle through live shared links, via
 * the sanctioned `shared.document_ids_for_entity` resolver. Deliberately list-only:
 * linking a document is the shared attachments operation (`POST
 * /attachments/documents/{documentId}/links` with entityType `veh.vehicle`), and
 * this phase provides no production object store, no scanner-acceptance workflow,
 * and no byte download — the response carries document ids, never a storage key or
 * bytes. Gated by `shared.document.manage`: document reachability is
 * document-domain information, held to the document permission rather than the
 * lower vehicle-read.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseOrFail, schemas } from '@/server/http/validation';
import { vehicleModule } from '@/modules/vehicle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ vehicleId: schemas.uuid });

export const VEHICLE_DOCUMENT_LIST_OPERATION = defineOperation({
  id: 'veh.vehicle-document-list',
  module: 'vehicle',
  method: 'GET',
  path: '/vehicles/{vehicleId}/documents',
  summary: 'List the documents reachable from a vehicle.',
  permissions: ['shared.document.manage'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ vehicleId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  return handleOperation(
    VEHICLE_DOCUMENT_LIST_OPERATION,
    request,
    async ({ db }) => ({
      body: await vehicleModule().vehicleHistory.listDocuments(db, params.vehicleId),
    }),
    { params }
  );
}
