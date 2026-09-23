/**
 * GET /api/v1/work-orders — the branch work-order board (Phase 1-19,
 * P1-19-BE-006).
 *
 * ## There is no POST here, and that is the phase boundary
 *
 * The execution brief asked for `POST /api/v1/work-orders`. Reception's conversion
 * (`POST /api/v1/receptions/{receptionId}/convert-to-work-order`, P1-18-BE-019)
 * already inserts `wo.work_orders`, holding the reception-visit lock and answering
 * a replay with the work order it already created, and
 * `uq_work_orders_ordinary_origin` is the database backstop designed around that
 * one path. A second insert here would not hold that lock, so two concurrent
 * callers using two different paths would race for the same partial unique index
 * and one would receive a raw `23505`. Creation therefore stays where it is; this
 * phase consumes the shell. The reconciliation is recorded in the phase
 * traceability matrix rather than left as an unexplained gap in the contract.
 *
 * ## Company and branch are required, for authorization rather than convenience
 *
 * `scope: 'branch'` is inert without a target: `requiresScopedEvaluation` returns
 * false on an empty one whatever the declaration says, so the check degrades to
 * scope-blind `iam.has_permission` — and RLS cannot compensate, because
 * `app.branch_ids` is the permission-blind union of every active grant
 * (P1-18-A-01). A caller holding `wo.work_order.read` in one branch and any grant
 * at all in another would see the second branch's board. Naming the pair in the
 * query lets it be passed as the `authorizationTarget`, so
 * `iam.has_permission_in_scope` decides against the branch actually read.
 */
import { z } from 'zod';
import { defineOperation } from '@/server/auth/operation-registry';
import { AppFailure } from '@/server/errors/app-failure';
import { handleOperation } from '@/server/http/route-handler';
import {
  parseOrFail,
  schemas,
  scopeTargetOption,
  searchParamsToObject,
} from '@/server/http/validation';
import {
  MAX_WORK_ORDER_SEARCH_FRAGMENT,
  MIN_WORK_ORDER_SEARCH_FRAGMENT,
  WORK_ORDER_KINDS,
  WORK_ORDER_STATE_GROUPS,
  workOrderModule,
} from '@/modules/work-order';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * `state` is an opaque catalog code, deliberately not a TypeScript enum:
 * `wo.work_order_states` is tenant-extensible, so an unknown code must return an
 * empty page rather than a 422 about a state the tenant may legitimately have
 * defined. `kind` IS a closed vocabulary — `ck_work_orders_kind` allows exactly
 * two values — so it is validated here.
 */
/**
 * A query-string boolean, read as a literal.
 *
 * `z.coerce.boolean()` would make `?assignedToMe=false` TRUE, because coercion
 * only asks whether the string is non-empty — so the flag that narrows a board
 * would widen it on the one value a caller uses to turn it off.
 */
const BooleanFlag = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true')
  .optional();

const Query = z
  .object({
    companyId: schemas.uuid,
    /**
     * OPTIONAL (Owner directive, P1-32-PRE-OD-UX). Omitted, it asks for every
     * branch of the company the caller may read; `authorizedBranches` decides
     * that set one branch at a time against this operation's declared code and
     * refuses a caller holding none. A named branch is decided exactly as
     * before, by the `scopeTargetOption` target below.
     */
    branchId: schemas.uuid.optional(),
    state: z
      .string()
      .regex(/^[a-z][a-z0-9_]{1,62}$/, 'must be a lower-snake state code')
      .optional(),
    /**
     * The state GROUP (Owner directive, P1-32-PRE-OD-UX) — the control a board
     * actually offers, because nobody opens a workshop screen thinking in
     * catalogue codes.
     *
     * A CLOSED vocabulary where `state` is open, and the two are not the same
     * kind of thing: `state` is a tenant's own code and must not be validated
     * against a TypeScript list, while a group is a question about the
     * catalogue's `is_terminal` / `is_cancellation` flags and is resolved from
     * the live rows inside the module. An unknown group is therefore a 422 and
     * an unknown state is still an empty page.
     *
     * Mutually exclusive with `state`, refused below rather than ANDed. ANDing
     * them is well defined in SQL and useless to a caller: every combination is
     * either the state on its own or an empty page that looks like a missing
     * row. A 422 naming the conflict is the difference between a bug the caller
     * can fix and a board that silently shows nothing.
     */
    stateGroup: z.enum(WORK_ORDER_STATE_GROUPS).optional(),
    kind: z.enum(WORK_ORDER_KINDS).optional(),
    openedFrom: z.string().datetime({ offset: true }).optional(),
    openedTo: z.string().datetime({ offset: true }).optional(),
    /**
     * Inclusive bounds on the COMPLETION instant (Owner directive,
     * P1-32-PRE-OD-UX) — the same value the row publishes as `completedAt`, so
     * the window and the column a board sorts by describe one fact.
     *
     * Beside `openedFrom`/`openedTo` and not instead of them: "opened last week"
     * and "finished last week" are different questions, and a month-end handover
     * report asks the second one. A work order that is not currently in a
     * terminal state has no completion instant, so either bound narrows the
     * board to finished work by construction.
     */
    completedFrom: z.string().datetime({ offset: true }).optional(),
    completedTo: z.string().datetime({ offset: true }).optional(),
    /**
     * BR-05. Narrows to work orders whose reception visit names this partner in
     * ANY role — a customer search wants every car they are connected to.
     *
     * There is deliberately NO `asOf` parameter beside it. The reference instant
     * for the customer projection is server-derived from the work order; a
     * client-supplied one would be an oracle and a way to read a party role out
     * of its window. `.strict()` makes sending one a 422 rather than a silent
     * ignore.
     */
    customerId: schemas.uuid.optional(),
    /**
     * P1-32. Exact work-order number. Digits typed on an Arabic keyboard are
     * folded to ASCII before the comparison; nothing else about the number is
     * changed, because it is an identifier.
     */
    number: z.string().min(1).max(MAX_WORK_ORDER_SEARCH_FRAGMENT).optional(),
    /**
     * P1-32. One free-text box: part of the work-order number, part of the name of
     * a party on its reception visit, part of any plate its vehicle has carried,
     * or part of its VIN. Company and branch stay REQUIRED beside it — the box
     * narrows a board, it never widens one.
     */
    q: z
      .string()
      .min(MIN_WORK_ORDER_SEARCH_FRAGMENT)
      .max(MAX_WORK_ORDER_SEARCH_FRAGMENT)
      .optional(),
    /**
     * The board flags (Owner directive, P1-32-PRE-OD-UX). Each is backed by a
     * state or a column the schema really keeps:
     *
     *   assignedToMe      a LIVE row in `wo.job_assignments` for the caller's own
     *                     technician profile — and an EMPTY page, never the whole
     *                     board, when the caller has no such profile;
     *   awaitingParts     `wo.work_orders.parts_forward_state` is `requested` or
     *                     `reserved_elsewhere` (parts not yet in hand) AND the
     *                     order is not in a terminal state — the predicate the
     *                     dashboard's "waiting for parts" figure counts with;
     *   awaitingApproval  a live, undeleted additional-work request is still
     *                     `pending` — the predicate the dashboard's "waiting for
     *                     the customer to agree" figure counts with;
     *   awaitingQuality   a quality-control record's `overall_result` is `pending`;
     *   readyForDelivery  the state is closed and not a cancellation, resolved
     *                     from the LIVE catalogue exactly as the delivery
     *                     readiness queue resolves it.
     *
     * `dueAt`, `approvalState` and `deliveryReadiness` were asked for and are
     * ABSENT: see `WorkOrderBoardSummary` for what the schema does and does not
     * record.
     *
     * `z.enum(['true','false'])` rather than `z.coerce.boolean()`: coercion makes
     * every non-empty string true, so `?assignedToMe=false` would silently mean
     * true. `.strict()` keeps an unknown flag a 422.
     */
    assignedToMe: BooleanFlag,
    awaitingParts: BooleanFlag,
    awaitingApproval: BooleanFlag,
    awaitingQuality: BooleanFlag,
    readyForDelivery: BooleanFlag,
    cursor: schemas.cursor.optional(),
    limit: schemas.limit.optional(),
  })
  .strict();

/**
 * The two cross-field refusals this query carries, as CATALOGUED rule tokens.
 *
 * Asserted here rather than in a `superRefine`, and the difference is what the
 * caller receives. `toViolations` publishes `issue.code` as the rule, and every
 * Zod refinement issue carries the code `custom` — so a refinement can state its
 * reason only in an English `message` that the problem document does not even
 * publish, and the browser maps `custom` to a generic sentence. A token the
 * catalogue carries is what turns the refusal into words an operator can act on,
 * in their own language.
 *
 * The shape is the ordinary one — `{ path, rule }` under `ERR-VAL-001` — so this
 * is indistinguishable from a schema violation to every consumer.
 */
function assertQueryCoherent(query: z.infer<typeof Query>): void {
  const violations: { readonly path: string; readonly rule: string }[] = [];
  if (query.state !== undefined && query.stateGroup !== undefined) {
    // Refused rather than ANDed. See `stateGroup` above: the intersection is
    // either the state itself or nothing, and "nothing" reaching a board as an
    // empty page is indistinguishable from a branch with no work in it.
    violations.push({ path: 'query.stateGroup', rule: 'state_and_group_exclusive' });
  }
  if (
    query.completedFrom !== undefined &&
    query.completedTo !== undefined &&
    Date.parse(query.completedTo) < Date.parse(query.completedFrom)
  ) {
    // An inverted window matches nothing by construction, so answering it with
    // an empty page would read as "nothing was finished" rather than "bad
    // request" — the rule `rec.reception-list` and `apt.appointment-list`
    // already apply to their own windows. Compared as INSTANTS: both values
    // carry an explicit offset, and a lexical comparison of offset-bearing ISO
    // strings is wrong in both directions.
    violations.push({ path: 'query.completedTo', rule: 'completion_window_inverted' });
  }
  if (violations.length === 0) return;
  throw new AppFailure('ERR-VAL-001', {
    // Not published: `problemFor` renders the catalogue title and the
    // violations, never this string. It exists for the log line.
    message: 'The board query asks for two things that cannot both be true',
    safeDetails: { violations },
  });
}

export const WORK_ORDER_LIST_OPERATION = defineOperation({
  id: 'wo.work-order-list',
  module: 'work-order',
  method: 'GET',
  path: '/work-orders',
  summary: 'List the work orders of one branch, newest opened first.',
  permissions: ['wo.work_order.read'],
  scope: 'branch',
  auditClass: 'none',
  rateLimitPolicy: 'expensive-read',
  branchNarrowing: 'authorized-union',
  cacheCategory: 'never',
});

export async function GET(request: Request): Promise<Response> {
  const raw = searchParamsToObject(new URL(request.url).searchParams);
  return handleOperation(
    WORK_ORDER_LIST_OPERATION,
    request,
    async ({ db, authorizedBranches }) => {
      // Parsed INSIDE the handler so a malformed query is rendered as the shared
      // problem document by the pipeline. Parsing it outside would let the
      // `AppFailure` escape the route function entirely, and the caller would see
      // an unhandled 500 instead of a 422 naming the field.
      const query = parseOrFail(Query, raw, 'query');
      assertQueryCoherent(query);
      const branchIds =
        query.branchId === undefined ? await authorizedBranches(query.companyId) : [query.branchId];
      return {
        body: await workOrderModule().workOrders.list(
          db,
          {
            companyId: query.companyId,
            branchIds,
            state: query.state,
            kind: query.kind,
            openedFrom: query.openedFrom === undefined ? undefined : new Date(query.openedFrom),
            openedTo: query.openedTo === undefined ? undefined : new Date(query.openedTo),
            completedFrom:
              query.completedFrom === undefined ? undefined : new Date(query.completedFrom),
            completedTo: query.completedTo === undefined ? undefined : new Date(query.completedTo),
            customerId: query.customerId,
            number: query.number,
            q: query.q,
            awaitingParts: query.awaitingParts,
            awaitingApproval: query.awaitingApproval,
            // Resolved INSIDE the module: every one of these is a question about
            // the tenant's own catalogue, its own technician register or another
            // module's schema, and a route that answered them would re-implement
            // the module — or, for quality, read a table it may not name.
            ...(await workOrderModule().workOrders.resolveBoardFilters(db, {
              companyId: query.companyId,
              branchIds,
              assignedToMe: query.assignedToMe,
              readyForDelivery: query.readyForDelivery,
              awaitingQuality: query.awaitingQuality,
              stateGroup: query.stateGroup,
            })),
          },
          { cursor: query.cursor, limit: query.limit }
        ),
      };
    },
    // The pre-handler target, and what now stands behind it.
    //
    // `scopeTargetOption` reads the pair out of not-yet-validated input and
    // yields a target only when BOTH are well-formed UUIDs, so it can only ever
    // make authorization stricter (P1-18-A-01).
    //
    // What it can no longer do is carry the whole decision. Since the Owner
    // directive (P1-32-PRE-OD-UX) an absent `branchId` is LEGAL, so an absent
    // pair yields no target and this pre-handler check degrades to the
    // scope-blind `iam.has_permission` — it is NOT refused by the schema any
    // more, and a comment saying so would be describing the old contract. The
    // decision for that request is made inside the transaction by
    // `resolveAuthorizedBranches`, which evaluates this operation's declared
    // codes once per candidate branch of the named company and refuses a caller
    // that holds none. Tenant is never accepted from the client either way; it
    // comes from the resolved principal.
    scopeTargetOption(raw)
  );
}
