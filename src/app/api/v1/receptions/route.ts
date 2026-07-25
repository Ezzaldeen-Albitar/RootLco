/**
 * POST /api/v1/receptions — accept a vehicle into custody (Phase 1-18,
 * P1-18-BE-005, P1-18-BE-006, P1-18-BE-007, P1-18-BE-008).
 *
 * A visit has exactly one origin — an appointment XOR a walk-in
 * (`ck_reception_visits_one_origin`) — so the body carries a discriminated origin
 * rather than two nullable ids that could arrive both set or both empty. A walk-in
 * is a first-class origin record, never an appointment with the calendar fields
 * left blank.
 *
 * The visit, its mandatory service-requester role, the initial `accepted` custody
 * event and the first status-history row are written by the frozen
 * `rec.accept_check_in()` primitive in one statement, so there is no window in which
 * a vehicle is held with no custody record.
 *
 * `companyId` and `branchId` are the scope this operation is authorized against, so
 * for an appointment origin the module REFUSES a body that names anything other
 * than the appointment's own company and branch. They cannot merely be ignored in
 * favour of the appointment's: the authorization target is read from this body
 * before the transaction opens, so a divergent body would authorize one branch and
 * write in another.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { handleOperation } from '@/server/http/route-handler';
import { parseJsonBody, schemas, scopeTargetOption } from '@/server/http/validation';
import {
  MAX_SOC_PERCENT,
  MAX_WALK_IN_NOTE,
  MIN_SOC_PERCENT,
  receptionModule,
} from '@/modules/reception';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Origin = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('appointment'), appointmentId: schemas.uuid }).strict(),
  z
    .object({
      kind: z.literal('walk_in'),
      requesterPartnerId: schemas.uuid.nullable().default(null),
      note: z.string().min(1).max(MAX_WALK_IN_NOTE).nullable().default(null),
    })
    .strict(),
]);

const Body = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    vehicleId: schemas.uuid,
    receivingEmployeeId: schemas.uuid,
    serviceRequesterPartnerId: schemas.uuid,
    origin: Origin,
    odometerReadingId: schemas.uuid.nullable().default(null),
    fuelLevelId: schemas.uuid.nullable().default(null),
    // `numeric(5, 2)`, so a fractional charge level is meaningful and not coerced
    // to a whole percent here.
    evSocPercent: z.number().min(MIN_SOC_PERCENT).max(MAX_SOC_PERCENT).nullable().default(null),
  })
  .strict();

export const RECEPTION_CREATE_OPERATION = defineOperation({
  id: 'rec.reception-create',
  module: 'reception',
  method: 'POST',
  path: '/receptions',
  summary: 'Open a reception visit and accept custody of the vehicle.',
  permissions: ['rec.reception.manage'],
  scope: 'branch',
  auditClass: 'privileged',
  auditAction: 'rec.reception.created',
  idempotent: true,
  rateLimitPolicy: 'standard-command',
  cacheCategory: 'never',
});

export async function POST(request: Request): Promise<Response> {
  const body = await request
    .clone()
    .json()
    .catch(() => null);
  return handleOperation(
    RECEPTION_CREATE_OPERATION,
    request,
    async ({ db, request: raw }) => {
      const created = await receptionModule().receptions.create(db, await parseJsonBody(raw, Body));
      return { status: 201, body: created, recordVersion: created.recordVersion };
    },
    // See the appointment-create route for the full reasoning: `scope: 'branch'`
    // is inert without a target, and the RLS scope GUC is the union of every
    // grant the caller holds, so opening a visit and taking custody would be
    // reachable in a branch where the caller only reads. The target makes the
    // permission evaluate against the grant that actually covers this branch.
    { body, ...scopeTargetOption(body) }
  );
}
