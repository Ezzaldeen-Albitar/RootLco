/**
 * The service-catalogue contract this phase consumes (P1-30, `W1`, FE-001).
 *
 * | operation                      | method | path                                          | permission           |
 * | ------------------------------ | ------ | --------------------------------------------- | -------------------- |
 * | `svc.service-list`             | GET    | `/services`                                   | `svc.service.read`   |
 * | `svc.service-detail`           | GET    | `/services/{serviceId}`                       | `svc.service.read`   |
 * | `svc.service-category-list`    | GET    | `/service-categories`                         | `svc.service.read`   |
 * | `org.branch-list`              | GET    | `/org/branches`                               | `org.branch.read`    |
 * | `svc.service-create`           | POST   | `/services`                                   | `svc.service.manage` |
 * | `svc.service-update`           | PATCH  | `/services/{serviceId}`                       | `svc.service.manage` |
 * | `svc.branch-availability-set`  | POST   | `/services/{serviceId}/branch-availability`   | `svc.service.manage` |
 * | `svc.service-version-create`   | POST   | `/services/{serviceId}/versions`              | `svc.service.manage` |
 * | `svc.service-version-publish`  | POST   | `/services/{serviceId}/versions/{id}/publication` | `svc.service.manage` |
 * | `svc.service-category-create`  | POST   | `/service-categories`                         | `svc.service.manage` |
 *
 * Typed from the routes that own the shapes —
 * `apps/api/src/app/api/v1/services/route.ts` and its siblings — and from the
 * views in `apps/api/src/modules/service-catalog/application/*`, which are what
 * those routes return. Nothing here is invented; every field below exists on
 * the published response, and `tests/backend/p1-30-w1-service-catalogue.test.ts`
 * PARSES the interfaces out of this file and holds them against a row that came
 * out of the database, in both directions.
 *
 * ## The response bodies here, the request bodies elsewhere
 *
 * Request payloads live in `lib/contracts/services-contract.ts`, one interface
 * per write, because `check-p1-30-payload-parity` compares that file against
 * the routes' zod schemas by operation id. A response has no schema to compare
 * against, so it is described here, beside the screen that renders it.
 *
 * ## Two things the backend does not publish, said here rather than hidden
 *
 * - There is NO list of a service's versions. `svc.service-version-create`
 *   answers with the draft it made, and that answer is the only place its id
 *   ever appears, so the detail screen holds the id it was just given and
 *   offers publication of THAT draft — it cannot show older ones.
 * - There is NO per-service availability read. Availability is WRITTEN with
 *   `svc.branch-availability-set` and can only be OBSERVED through
 *   `svc.service-list?availableAtBranchId=`. The catalogue therefore offers a
 *   branch filter, and the detail screen says what it cannot show.
 *
 * Both are recorded as findings against A0's read matrix. Neither is something
 * a screen may reconstruct on the client.
 *
 * ## No money crosses here
 *
 * The catalogue carries no price: resolution depends on company, branch,
 * customer class and date and is a different operation under a different
 * permission (`svc.price-resolve`, W2). `standardMinutes` on a labour time is
 * `numeric(10,2)` and travels as a decimal STRING; it is rendered as one.
 */

/** The permissions the W1 screens consult, as the backend registers them. */
export const SERVICE_PERMISSIONS = {
  read: 'svc.service.read',
  manage: 'svc.service.manage',
  /**
   * The branch picker's own code. `svc.service.read` does not imply it, so the
   * catalogue must be usable — with the availability filter degraded to a plain
   * identifier field — for an operator who holds the first and not the second.
   */
  branchRead: 'org.branch.read',
} as const;

/**
 * `ck_services_lifecycle_status`, mirrored. Two values, closed.
 *
 * Mirrored rather than imported: `apps/web` may not import from `apps/api`, and
 * the backend test holds this array against the route source so a third state
 * added in the Backend fails a test rather than a reviewer.
 *
 * `archived` is TERMINAL — `svc.guard_service_lifecycle` refuses the transition
 * back — which is why the catalogue renders it as "retired" and never offers
 * reactivation.
 */
export const SERVICE_LIFECYCLE_STATES = ['active', 'archived'] as const;
export type ServiceLifecycleState = (typeof SERVICE_LIFECYCLE_STATES)[number];

/** `ck_branch_service_availability_status`, mirrored. */
export const ACTIVATION_STATES = ['active', 'inactive'] as const;
export type ActivationState = (typeof ACTIVATION_STATES)[number];

/**
 * The external service code the backend accepts, mirrored from
 * `EXTERNAL_CODE` in `apps/api/src/modules/service-catalog/domain`.
 *
 * Checked on the client only so an operator hears about a malformed code
 * before the round trip; the backend is the authority and answers 422 with the
 * field named when the two ever disagree.
 */
export const EXTERNAL_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;

/** The lower-snake internal code a category carries, mirrored from `INTERNAL_CODE`. */
export const INTERNAL_CODE = /^[a-z][a-z0-9_]{1,62}$/;

/** Column widths, mirrored, so a form can refuse before the backend's 422 does. */
export const MAX_NAME = 200;
export const MAX_DESCRIPTION = 2000;
export const MAX_NOTES = 2000;

/**
 * One row of `svc.service-list` — `ServiceView` in
 * `service-catalog-service.ts`.
 *
 * `lifecycleStatus` is the closed vocabulary above and IS translated.
 * `categoryId` is an id for navigation; the category's name comes from the
 * category list, which the screen loads once and joins on the client for
 * DISPLAY — a label lookup, not arithmetic.
 */
export interface ServiceSummary {
  readonly id: string;
  readonly serviceCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: string;
  readonly lifecycleStatus: ServiceLifecycleState;
  readonly recordVersion: number;
}

/**
 * The body of `svc.service-detail` — the same `ServiceView`, named separately
 * because it is a different operation's response and the backend test holds
 * each against its own answer. `recordVersion` is the `If-Match` every guarded
 * write below needs, and the response carries it as an ETag as well.
 */
export interface ServiceDetail {
  readonly id: string;
  readonly serviceCode: string;
  readonly name: string;
  readonly description: string | null;
  readonly categoryId: string;
  readonly lifecycleStatus: ServiceLifecycleState;
  readonly recordVersion: number;
}

/** One row of `svc.service-category-list` — `ServiceCategoryView`. */
export interface ServiceCategory {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly parentCategoryId: string | null;
  readonly sortOrder: number | null;
  /** `active` or `inactive`. `svc.service-create` refuses an inactive category. */
  readonly status: ActivationState;
  readonly recordVersion: number;
}

/**
 * One standard labour time on a version — `LaborTimeView`.
 *
 * `standardMinutes` is `numeric(10,2)` and stays a decimal STRING. It is a
 * duration, not money, but the same rule applies for the same reason: a JSON
 * number would already have passed through IEEE-754 before any screen saw it.
 */
export interface LaborTime {
  readonly id: string;
  readonly laborCode: string | null;
  readonly standardMinutes: string;
  readonly unit: 'minutes';
  readonly skillRef: string | null;
  readonly status: string;
}

/**
 * The body of `svc.service-version-create` and of
 * `svc.service-version-publish` — `ServiceVersionView`.
 *
 * `effectiveFrom`/`effectiveTo` are ISO dates (`YYYY-MM-DD`); the range is
 * half-open and `effectiveTo` is `null` for a version with no end.
 */
export interface ServiceVersion {
  readonly id: string;
  readonly serviceId: string;
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly laborTimes: readonly LaborTime[];
}

/** The body of `svc.branch-availability-set` — `BranchAvailabilityView`. */
export interface BranchAvailability {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly serviceId: string;
  readonly isAvailable: boolean;
  readonly status: ActivationState;
  readonly recordVersion: number;
}

/**
 * One row of `org.branch-list` — `BranchReachView`, published under `items`.
 *
 * Read for the branch picker only. The backend remains the authority on which
 * branch a caller may set availability in: `svc.branch-availability-set`
 * authorizes the pair in its body against the caller's own grants. This list is
 * an affordance, never a permission.
 */
export interface BranchOption {
  readonly id: string;
  readonly companyId: string;
  readonly branchCode: string;
  readonly name: string;
  readonly city: string | null;
  readonly countryCode: string | null;
  readonly timezoneName: string;
  readonly status: string;
}

/**
 * What the catalogue may narrow by. Every key is one the route's `.strict()`
 * query accepts; there is no company or branch SCOPE among them, because the
 * list is tenant-wide catalogue reference data. `availableAtBranchId` is a
 * resource selector — "services available AT that branch" — and the backend
 * re-authorizes the named branch before answering.
 */
export interface ServiceListCriteria {
  readonly categoryId?: string;
  readonly lifecycleStatus?: ServiceLifecycleState;
  readonly availableAtBranchId?: string;
  /** `YYYY-MM-DD`: only services with a published version covering that date. */
  readonly effectiveOn?: string;
  /** A case-insensitive PREFIX on code or name; the backend escapes it. */
  readonly search?: string;
}
