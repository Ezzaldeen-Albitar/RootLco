/**
 * The pricing contract this phase consumes (P1-30, `W2`, FE-002 and FE-006).
 *
 * | operation                          | method | path                                                    | permission          |
 * | ---------------------------------- | ------ | ------------------------------------------------------- | ------------------- |
 * | `svc.price-list-list`              | GET    | `/price-lists`                                          | `svc.price.read`    |
 * | `svc.price-list-detail`            | GET    | `/price-lists/{priceListId}`                            | `svc.price.read`    |
 * | `svc.price-rule-list`              | GET    | `/price-lists/{priceListId}/versions/{versionId}/rules` | `svc.price.read`    |
 * | `svc.price-resolve`                | GET    | `/prices`                                               | `svc.price.read`    |
 * | `org.branch-list`                  | GET    | `/org/branches`                                         | `org.branch.read`   |
 * | `svc.service-list`                 | GET    | `/services`                                             | `svc.service.read`  |
 * | `svc.price-list-create`            | POST   | `/price-lists`                                          | `svc.price.manage`  |
 * | `svc.price-list-version-create`    | POST   | `/price-lists/{priceListId}/versions`                   | `svc.price.manage`  |
 * | `svc.price-list-version-publish`   | POST   | `/price-lists/{priceListId}/versions/{id}/publication`  | `svc.price.publish` |
 * | `svc.price-rule-record`            | POST   | `/price-lists/{priceListId}/versions/{id}/rules`        | `svc.price.manage`  |
 * | `svc.price-list-assignment-create` | POST   | `/price-list-assignments`                               | `svc.price.manage`  |
 *
 * Typed from the routes that own the shapes — `apps/api/src/app/api/v1/price-lists/**`,
 * `price-list-assignments/route.ts`, `prices/route.ts` — and from the views in
 * `apps/api/src/modules/pricing/application/*`, which are what those routes
 * return. Nothing here is invented; every field exists on the published
 * response, and `tests/backend/p1-30-w2-pricing.test.ts` PARSES the interfaces
 * out of this file and holds them against rows that came out of the database,
 * in both directions.
 *
 * ## The response bodies here, the request bodies elsewhere
 *
 * Request payloads live in `lib/contracts/pricing-contract.ts`, one interface
 * per write, because `check-p1-30-payload-parity` compares that file against
 * the routes' zod schemas by operation id.
 *
 * ## Money is the server's, always
 *
 * `amount`, `unitPrice` and `taxRate` arrive as decimal STRINGS and leave this
 * application as the same strings. `taxRate` is a FRACTION of one — `0.160000`
 * is sixteen hundredths — and is rendered as the server states it; turning it
 * into a percentage would be arithmetic, which the phase's closure gate
 * (`P1-30 RENDERS SERVER ARITHMETIC ONLY`) forbids. `specificity` is a number the
 * server computed from a rule's narrowing; it is rendered, never recomputed.
 *
 * ## Which record version a guarded write needs
 *
 * `svc.price-list-version-create` and `svc.price-list-version-publish` guard
 * the PRICE LIST's `recordVersion` — the row the backend locks first — while
 * their own responses carry the VERSION's `recordVersion`. So the number to send
 * back is the one on `PriceListDetail`, never the one on a write's answer, and
 * the detail is re-read after every guarded write.
 *
 * ## Reads the backend does not publish, said here rather than hidden
 *
 * - There is NO list of a price list's assignments, and no way to change or
 *   end one. An assignment can be RECORDED here and only observed through
 *   `svc.price-resolve`.
 * - There is NO separate list of versions: they arrive inside the detail,
 *   bounded at one hundred, with `versionsTruncated` saying when the bound bit.
 * - A rule cannot be changed or removed; a published version's rules are
 *   frozen by the backend.
 * - The price-list list is BOUNDED (at most one hundred rows), not paged: no
 *   cursor exists, so the screen says the bound rather than inventing a page.
 */

/** The permissions the W2 screens consult, as the backend registers them. */
export const PRICING_PERMISSIONS = {
  read: 'svc.price.read',
  manage: 'svc.price.manage',
  /**
   * Publication is a separate code, and the backend demands it held for the
   * whole workshop — a branch-scoped holder is refused with 403.
   */
  publish: 'svc.price.publish',
  /** The branch picker's own code; `svc.price.read` does not imply it. */
  branchRead: 'org.branch.read',
  /** The service picker's own code; without it a service is named by identifier. */
  serviceRead: 'svc.service.read',
} as const;

/**
 * `ck_price_list_versions_status`, mirrored — `PRICE_LIST_VERSION_STATES` in
 * `apps/api/src/modules/pricing/domain/pricing.ts`. `published` may only move
 * to `archived`; a draft is the only state that takes rules.
 */
export const PRICE_LIST_VERSION_STATES = ['draft', 'published', 'archived'] as const;
export type PriceListVersionState = (typeof PRICE_LIST_VERSION_STATES)[number];

/** `ck_price_lists_status` / `ck_price_rules_status` / assignments, mirrored. */
export const ACTIVATION_STATES = ['active', 'inactive'] as const;
export type ActivationState = (typeof ACTIVATION_STATES)[number];

/** The external code a price list carries, mirrored from `EXTERNAL_CODE`. */
export const EXTERNAL_CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$/;

/** The lower-snake code a customer class carries, mirrored from `INTERNAL_CODE`. */
export const INTERNAL_CODE = /^[a-z][a-z0-9_]{1,62}$/;

/** ISO 4217 alphabetic, as the create route validates it. */
export const CURRENCY_CODE = /^[A-Z]{3}$/;

/** `YYYY-MM-DD`, as every date field on this surface is validated. */
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A rule amount as the route accepts it: non-negative, at most four decimal
 * places, no sign, no exponent. Mirrored from `rules/route.ts`. Checked on the
 * client only so an operator hears about a malformed amount before the round
 * trip; the backend is the authority.
 */
export const AMOUNT = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/;

/** Column widths and bounds, mirrored, so a form can refuse before the 422 does. */
export const MAX_NAME = 200;
export const MAX_DESCRIPTION = 2000;
export const MAX_NOTES = 2000;
export const MAX_PRIORITY = 1_000_000;
/** The most rows `svc.price-list-list` answers with; there is no cursor. */
export const LIST_BOUND = 100;

/** One row of `svc.price-list-list`, and the body of `svc.price-list-create` — `PriceListView`. */
export interface PriceListSummary {
  readonly id: string;
  readonly priceListCode: string;
  readonly name: string;
  /** ISO 4217, frozen at creation. Every rule of the list is in it. */
  readonly currency: string;
  readonly description: string | null;
  readonly status: ActivationState;
  readonly recordVersion: number;
}

/**
 * One version — `PriceListVersionView`: the body of `svc.price-list-version-create`
 * and of `svc.price-list-version-publish`, and an element of `PriceListDetail.versions`.
 *
 * `recordVersion` here is the VERSION's, which no write on this surface asks
 * for. `effectiveFrom`/`effectiveTo` are `YYYY-MM-DD`; the range is half-open.
 */
export interface PriceListVersion {
  readonly id: string;
  readonly priceListId: string;
  readonly versionNo: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: PriceListVersionState;
  readonly notes: string | null;
  readonly recordVersion: number;
}

/**
 * The body of `svc.price-list-detail` — `PriceListDetailView`.
 *
 * `recordVersion` is the LIST's, the `If-Match` both guarded writes need; the
 * response carries it as an ETag as well. `versions` is ordered newest first
 * and bounded at one hundred; `versionsTruncated` says when the bound bit.
 * It carries no rules and no amounts.
 */
export interface PriceListDetail {
  readonly id: string;
  readonly priceListCode: string;
  readonly name: string;
  readonly currency: string;
  readonly description: string | null;
  readonly status: ActivationState;
  readonly recordVersion: number;
  readonly versions: readonly PriceListVersion[];
  readonly versionsTruncated: boolean;
}

/** The service a rule prices, as the rules list projects it. */
export interface PriceRuleService {
  readonly id: string;
  readonly serviceCode: string;
  readonly name: string;
}

/** A rule's narrowing. `null` in a slot means "regardless of that slot". */
export interface PriceRuleNarrowing {
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly customerClass: string | null;
}

/**
 * One row of `svc.price-rule-list` — `PriceRuleListView`.
 *
 * `amount` is a `numeric(18,4)` decimal STRING in `currency`, which is the
 * parent list's. `specificity` (0 to 7) is the server's weight for the
 * narrowing — it wins before `priority` is consulted — and is rendered as the
 * number the server sent.
 */
export interface PriceRuleRow {
  readonly id: string;
  readonly priceListVersionId: string;
  readonly service: PriceRuleService;
  readonly appliesTo: PriceRuleNarrowing;
  readonly amount: string;
  readonly currency: string;
  readonly taxClassId: string | null;
  readonly priority: number;
  readonly specificity: number;
  readonly status: ActivationState;
  readonly recordVersion: number;
}

/**
 * The body of `svc.price-rule-list` — `PriceListRulesView`.
 *
 * `currency` sits on the envelope as well as on every rule so an empty `rules`
 * still says what the list is denominated in. `truncated` says when the bound
 * of two hundred bit.
 */
export interface PriceListRules {
  readonly priceListId: string;
  readonly versionId: string;
  readonly versionNo: number;
  readonly versionStatus: PriceListVersionState;
  readonly currency: string;
  readonly rules: readonly PriceRuleRow[];
  readonly truncated: boolean;
}

/** The body of `svc.price-rule-record` — `PriceRuleView`, the write's echo. */
export interface PriceRuleEcho {
  readonly id: string;
  readonly amount: string;
  readonly currency: string;
  readonly recordVersion: number;
}

/** The body of `svc.price-list-assignment-create` — `PriceListAssignmentView`. No money. */
export interface PriceListAssignment {
  readonly id: string;
  readonly priceListId: string;
  readonly companyId: string | null;
  readonly branchId: string | null;
  readonly customerClass: string | null;
  readonly priority: number;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: ActivationState;
  readonly recordVersion: number;
}

/**
 * The body of `svc.price-resolve` — `asOf` beside `ResolvedPrice`.
 *
 * `unitPrice` is a `numeric(18,4)` decimal STRING in `currency`. `taxRate` is a
 * `numeric(9,6)` decimal STRING holding a FRACTION of one; `0.000000` is a rule
 * with no tax class. A tax class whose rate is not recorded is a refusal from
 * the server, never a zero here.
 */
export interface ResolvedPrice {
  readonly asOf: string;
  readonly priceRuleId: string;
  readonly unitPrice: string;
  readonly currency: string;
  readonly taxClassId: string | null;
  readonly taxRate: string;
  readonly taxClassCode: string | null;
}

/**
 * What a price lookup names. `serviceId`, `companyId` and `branchId` are all
 * MANDATORY on the route; the company/branch pair is the read's TARGET and
 * travels through `branchTargetQuery`, never among the filters.
 */
export interface PriceLookupCriteria {
  readonly serviceId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly customerClass?: string;
  /** `YYYY-MM-DD`; today, by the server's clock, when omitted. */
  readonly asOf?: string;
}
