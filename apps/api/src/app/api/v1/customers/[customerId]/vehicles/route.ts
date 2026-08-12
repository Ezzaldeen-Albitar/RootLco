/**
 * GET/POST /api/v1/customers/{customerId}/vehicles (Phase 1-16, FR-VEH-003,
 * P1-16-BE-018; GET added by the P1-16 remediation for `P1-27-INT-012`).
 *
 * POST links a customer to an existing vehicle in a role. This route creates
 * **no** vehicle schema and no vehicle: `veh.vehicles` is the vehicle module's,
 * and this operation only records a relationship between two records that
 * already exist. Both sides are resolved under the caller's tenant first, so a
 * relationship can never span two tenants.
 *
 * GET is the read the POST never published: the Customer→Vehicle direction was
 * write-only, while the Vehicle→Customer direction has had
 * `veh.vehicle-relationship-list` since P1-17. Both read the same
 * `veh.vehicle_relationships` rows; this one answers the customer profile's
 * vehicles tab (P1-28-FE-008) as a keyset page, newest link first, each row
 * carrying the vehicle identity `veh.vehicles` itself holds.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  searchParamsToObject,
} from '@/server/http/validation';
import { crmModule, VEHICLE_RELATIONSHIP_ROLES } from '@/modules/crm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ customerId: schemas.uuid });
const Body = z
  .object({
    vehicleId: schemas.uuid,
    relationshipRole: z.enum(VEHICLE_RELATIONSHIP_ROLES),
  })
  .strict();

export const VEHICLE_LINK_OPERATION = defineOperation({
  id: 'crm.vehicle-link',
  module: 'crm',
  method: 'POST',
  path: '/customers/{customerId}/vehicles',
  summary: 'Link a customer to a vehicle in a relationship role.',
  permissions: ['crm.customer.vehicle.manage'],
  scope: 'tenant',
  auditClass: 'privileged',
  auditAction: 'crm.customer.vehicle_linked',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const params = parseOrFail(Params, await route.params, 'path');
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    VEHICLE_LINK_OPERATION,
    request,
    async ({ db, request: raw }) => ({
      status: 201,
      body: await crmModule().customerIdentity.linkVehicle(
        db,
        params.customerId,
        await parseJsonBody(raw, Body)
      ),
    }),
    { params, body }
  );
}

// ---------------------------------------------------------------------------
// GET — the customer's vehicle relationships (P1-27 remediation executed by
// P1-16, `P1-27-INT-012`). History rows travel with `active: false` rather than
// being filtered: who was linked to which vehicle is a dated business fact, and
// the open interval (`validTo === null`) is what the screen leads with.
// ---------------------------------------------------------------------------

const ListQuery = z
  .object({ cursor: schemas.cursor.optional(), limit: schemas.limit.optional() })
  .strict();

export const CUSTOMER_VEHICLE_LIST_OPERATION = defineOperation({
  id: 'crm.customer-vehicle-list',
  module: 'crm',
  method: 'GET',
  path: '/customers/{customerId}/vehicles',
  summary: 'List the vehicles linked to a customer.',
  permissions: ['crm.customer.read'],
  scope: 'tenant',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(
  request: Request,
  route: { params: Promise<{ customerId: string }> }
): Promise<Response> {
  const raw = await route.params;
  return handleOperation(
    CUSTOMER_VEHICLE_LIST_OPERATION,
    request,
    async ({ db, request: req }) => {
      // Parsed INSIDE the handler so a malformed path id or query is rendered
      // as the shared 422 problem document rather than an escaping AppFailure
      // (the P1-18 read-surface doctrine; the sibling POST above predates it).
      const path = parseOrFail(Params, raw, 'path');
      const query = parseOrFail(
        ListQuery,
        searchParamsToObject(new URL(req.url).searchParams),
        'query'
      );
      return {
        body: await crmModule().customerRead.listVehicles(db, path.customerId, query),
      };
    },
    { params: raw }
  );
}
