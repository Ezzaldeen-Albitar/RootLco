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
 * `receivingEmployeeId` names the IAM account that actually accepted custody
 * (FE-007). It is OPTIONAL and defaults to the authenticated user; a supplied id
 * is validated by `rec.stamp_receiving_employee_identity()` inside the same
 * transaction, which refuses anything that is not an active, same-tenant,
 * branch-eligible account and stamps the display-name snapshot itself. Nothing
 * about the employee is taken on the body's word — including the snapshot, which
 * the body cannot carry at all.
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
import {
  parseJsonBody,
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import { MAX_SEARCH_FRAGMENT, MIN_SEARCH_FRAGMENT } from '@/shared/text/search-terms';
import {
  MAX_SOC_PERCENT,
  MAX_WALK_IN_NOTE,
  MIN_SOC_PERCENT,
  RECEPTION_STATUSES,
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

export const Body = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid,
    vehicleId: schemas.uuid,
    // Optional because the Owner's FE-007 decision makes the AUTHENTICATED user
    // the default custodian: omitting the field means "I received it myself",
    // which is the ordinary case. Supplying one names a colleague, and the
    // database — not this schema — decides whether that colleague is an active,
    // branch-eligible, same-tenant account.
    receivingEmployeeId: schemas.uuid.optional(),
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
  successStatus: 201,
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

// ---------------------------------------------------------------------------
// GET /api/v1/receptions — the branch reception board (P1-27 remediation
// executed by P1-18, `P1-27-INT-011`). Most recently received first, with
// `recordVersion` on every row because the guarded writes are addressed from
// the list. Company and branch are REQUIRED for authorization rather than
// convenience: RLS narrows to the permission-blind union of every grant, so the
// pair travels as the `authorizationTarget` and `iam.has_permission_in_scope`
// decides against the branch actually read (P1-18-A-01).
// ---------------------------------------------------------------------------

/**
 * `branchId` is OPTIONAL (Owner directive, P1-32-PRE-OD-UX).
 *
 * Omitting it asks for every branch of the company the caller may read, which is
 * how a person who works in three branches sees their day without picking one
 * three times. It is not a widening: `authorizedBranches` decides the set, one
 * branch at a time, against this operation's own declared codes, and refuses a
 * caller that holds none of them — see `resolveAuthorizedBranches`. Naming a
 * branch is unchanged and is still refused exactly as before, by the
 * `scopeTargetOption` target below.
 */
const ListQuery = z
  .object({
    companyId: schemas.uuid,
    branchId: schemas.uuid.optional(),
    status: z.enum(RECEPTION_STATUSES).optional(),
    vehicleId: schemas.uuid.optional(),
    /**
     * Inclusive bounds on the instant custody was accepted (Owner directive,
     * P1-32-PRE-OD-UX) — the column the board already orders on, so the filter
     * and the ordering date the same business fact.
     */
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    /**
     * One free-text box (Owner directive, P1-32-PRE-OD-UX): part of a party's
     * name, the tail of their phone number, part of any plate the vehicle has
     * carried, part of its VIN, or part of the reception number. It narrows a
     * board the caller is already entitled to and never widens one.
     */
    q: z.string().min(MIN_SEARCH_FRAGMENT).max(MAX_SEARCH_FRAGMENT).optional(),
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict()
  .superRefine((query, context) => {
    if (
      query.from !== undefined &&
      query.to !== undefined &&
      Date.parse(query.to) < Date.parse(query.from)
    ) {
      // An inverted range matches nothing by construction, so answering it with
      // an empty page would read as "no visits" rather than "bad request" — the
      // rule `apt.appointment-list` already applies to its own window. Compared
      // as INSTANTS: both values carry an explicit offset, and a lexical
      // comparison of offset-bearing ISO strings is wrong in both directions.
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'to must not be earlier than from',
      });
    }
  });

export const RECEPTION_LIST_OPERATION = defineOperation({
  id: 'rec.reception-list',
  module: 'reception',
  method: 'GET',
  path: '/receptions',
  summary: 'List the reception visits of one branch, most recently received first.',
  permissions: ['rec.reception.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    RECEPTION_LIST_OPERATION,
    request,
    async ({ db, authorizedBranches }) => {
      // Parsed INSIDE the handler so a malformed query is rendered as the
      // shared problem document rather than an unhandled 500.
      const query = parseOrFail(ListQuery, raw, 'query');
      // A named branch was already decided by the `scopeTargetOption` target
      // below, so it is passed through unchanged; an omitted one is resolved
      // here, inside the transaction, against the caller's own grants.
      const branchIds =
        query.branchId === undefined ? await authorizedBranches(query.companyId) : [query.branchId];
      return {
        body: await receptionModule().receptionRead.listReceptions(db, {
          companyId: query.companyId,
          branchIds,
          status: query.status,
          vehicleId: query.vehicleId,
          from: query.from,
          to: query.to,
          q: query.q,
          cursor: query.cursor,
          limit: query.limit,
        }),
      };
    },
    // `scopeTargetOption` can only make authorization STRICTER: a malformed or
    // absent pair yields no target and the schema above then refuses. Tenant is
    // never accepted from the client; it comes from the resolved principal.
    scopeTargetOption(raw)
  );
}
