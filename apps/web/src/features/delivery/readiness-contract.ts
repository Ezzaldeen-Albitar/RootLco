/**
 * The ready-for-delivery queue contract (P1-31, FE-001, Owner decision **D-3**
 * of 2026-09-09).
 *
 * | operation                     | method | path                  | permissions (ALL required)                                    |
 * | ----------------------------- | ------ | --------------------- | ------------------------------------------------------------- |
 * | `sal.delivery-readiness-list` | GET    | `/delivery-readiness` | `sal.delivery.view`, `wo.work_order.read`, `sal.finance.view` |
 *
 * Typed from the route that owns the shape —
 * `apps/api/src/app/api/v1/delivery-readiness/route.ts` — and from
 * `DeliveryReadinessRowView` in
 * `apps/api/src/modules/delivery/application/delivery-readiness-service.ts`.
 *
 * ## Why this is a different file from `delivery-contract.ts`
 *
 * That file types the delivery RECORD and its subresources: the reads a screen
 * issues once it already holds a delivery identifier. This one types the queue
 * that answers the question before there is a delivery at all — which work
 * orders may be handed over, including the ones with no delivery record yet.
 * They are separate surfaces with separate permissions and separate lifetimes,
 * and keeping them apart is also what lets the handover-panel work proceed in
 * its own branch without either change standing on the other.
 *
 * ## The queue never decides readiness, and could not
 *
 * `readyToStartDelivery` is composed by the server on every read, from the same
 * fact readers the release checks use. Nothing in this application recomputes
 * it, infers it from an empty reason list, or offers a control that would ask
 * the server to filter by it — the route publishes no such parameter, for the
 * stated reason that a request able to express "only the ready ones" is a
 * request able to express its opposite.
 *
 * An empty reason list is therefore **not** the same fact as "ready". The server
 * states in terms that a work order already handed over raises no reason here,
 * because the reasons bound to a delivery row are outside this surface's four —
 * so a row can carry no reason at all and still not be ready. The screen renders
 * the two fields it was given and derives neither from the other.
 *
 * ## Four reasons, not eight
 *
 * `delivery-contract.ts` mirrors all eight reason codes the release check can
 * raise. This queue carries only the four that are counted against a work order
 * on its own — the other four are counted against a delivery ROW's identifier,
 * and for a work order that has no delivery they are unaskable rather than
 * clear. The four are named below so a fifth arriving from the backend is
 * visible here rather than silently rendered as though it had always belonged.
 *
 * ## No amount crosses this boundary
 *
 * Money appears as a reason CODE and a provenance phrase, never as a figure. The
 * route publishes no balance, no amount and no currency, and nothing in this
 * feature formats or computes one.
 *
 * ## The work order is mirrored, not imported
 *
 * The row's `workOrder` is the work-order module's own published summary — the
 * backend deliberately reuses it rather than inventing a projection, so the
 * queue and the work-order board spell a work order one way. It is mirrored here
 * rather than imported from `features/work-orders` because a feature does not
 * import another feature; the mirror is of the ROUTE's shape, which is the same
 * thing both mirrors are typed from.
 */
import type { DeliveryRecord, EligibilityFact } from './delivery-contract';

/** Named options from the existing tenant-scoped organization directory reads. */
export interface DeliveryReadinessScopeOptions {
  readonly companies: readonly { readonly id: string; readonly legalName: string }[];
  readonly branches: readonly {
    readonly id: string;
    readonly companyId: string;
    readonly name: string;
  }[];
}

/**
 * The three codes `sal.delivery-readiness-list` registers. All three are
 * required, and the page tests all three before it renders anything.
 *
 * `financeView` is the decisive one and is not defensive tidiness. One of the
 * four reasons is composed from the customer's open balance, whose rows live
 * behind that code — so a caller without it would be answered from an invisible
 * zero and shown a vehicle as releasable when money is owed on it. The release
 * check on a single delivery declares the same code for the same composition.
 *
 * `workOrderRead` is required because every row of this queue IS a work order:
 * publishing a branch's work orders behind the delivery code alone would be a
 * second, quieter way to read the work-order board.
 */
export const DELIVERY_READINESS_PERMISSIONS = {
  view: 'sal.delivery.view',
  workOrderRead: 'wo.work_order.read',
  financeView: 'sal.finance.view',
} as const;

/**
 * The four reasons this surface can report, mirrored verbatim.
 *
 * A subset of `BLOCKER_CODES` in `delivery-contract.ts`, deliberately: the other
 * four are keyed on a delivery identifier this queue's rows may not have.
 */
export const READINESS_BLOCKER_CODES = [
  'work_order_not_complete',
  'quality_control_not_passed',
  'financial_balance_outstanding',
  'part_obligation_outstanding',
] as const;
export type ReadinessBlockerCode = (typeof READINESS_BLOCKER_CODES)[number];

/**
 * The page sizes the route accepts, mirrored because they are NOT the platform's.
 *
 * The route refuses anything above the maximum rather than quietly returning
 * fewer rows than were asked for, so a client that sends more gets an error
 * instead of a short page. The table offers 100 as an option, so the two numbers
 * have to be known on this side and the request has to respect them.
 *
 * The ceiling is low on purpose: a row's verdict costs about five reads to
 * compose, so a hundred-row page is five hundred round trips.
 */
export const READINESS_PAGE_SIZE = 20;
export const MAX_READINESS_PAGE_SIZE = 50;

/**
 * The page size a request may actually carry.
 *
 * Shared by the adapter, which sends it, and by the screen, which says so when
 * the operator asked for more than the queue will serve. Capping silently is
 * what the route refused to do; capping visibly is the honest half of it.
 */
export function readinessPageSize(requested: number): number {
  if (!Number.isInteger(requested) || requested < 1) return READINESS_PAGE_SIZE;
  return requested > MAX_READINESS_PAGE_SIZE ? MAX_READINESS_PAGE_SIZE : requested;
}

/**
 * The party who brought the vehicle for this work order, as at its opening.
 *
 * Nullable, and the absence is ordinary rather than a fault: a visit may name no
 * service requester. The role travels with the name because the vehicle's owner
 * is a different question and may be a different person.
 */
export interface ReadinessCustomer {
  readonly partnerId: string;
  readonly displayName: string;
  readonly relationshipRole: string;
  readonly hasAdditionalParties: boolean;
}

/** The vehicle, rendered rather than referenced. */
export interface ReadinessVehicle {
  readonly vehicleId: string;
  readonly registrationPlate: string | null;
  readonly makeModel: string | null;
}

/**
 * The work order a row is about — the published work-order summary.
 *
 * `state` is a `string` and stays one: the state catalogue is extensible by the
 * workshop, so a code this build has never seen must reach the screen as itself
 * rather than be narrowed away by a type invented on this side.
 */
export interface ReadinessWorkOrder {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly receptionVisitId: string;
  readonly vehicleId: string;
  readonly kind: string;
  readonly state: string;
  readonly partsForwardState: string;
  readonly displayNumber: string | null;
  readonly openedAt: string;
  readonly recordVersion: number;
  readonly customer: ReadinessCustomer | null;
  readonly vehicle: ReadinessVehicle;
}

/**
 * One row of the queue — `DeliveryReadinessRowView`.
 *
 * `delivery` is the live handover of this work order, or nothing at all. It is
 * absent both when no handover has been started and when the only one was marked
 * as a problem; the backend treats those as the same answer and this side does
 * not widen it.
 *
 * `blockers` is typed as `string` rather than as the four-member union, for the
 * reason `delivery-contract.ts` gives for the same field: a code the backend
 * adds must arrive as itself and be rendered as itself, not be dropped by a type
 * this side wrote down first.
 */
export interface DeliveryReadinessRow {
  readonly workOrder: ReadinessWorkOrder;
  readonly delivery: DeliveryRecord | null;
  /** The four work-order-level checks, each with its provenance and whether it could be read. */
  readonly facts: readonly EligibilityFact[];
  /** The subset of those four that are holding the vehicle back. */
  readonly blockers: readonly string[];
  /** Server-derived, always. Never inferred from an empty reason list — see the file note. */
  readonly readyToStartDelivery: boolean;
}
