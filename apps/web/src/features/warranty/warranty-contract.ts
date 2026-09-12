/**
 * The warranty contract this phase consumes (P1-31, FE-008 warranty record,
 * FE-009 warranty history as far as the backend publishes one).
 *
 * | operation                  | method | path                                  | permissions (ALL required) |
 * | -------------------------- | ------ | ------------------------------------- | -------------------------- |
 * | `wty.warranty-list`        | GET    | `/warranties`                         | `wty.warranty.read`        |
 * | `wty.warranty-detail`      | GET    | `/warranties/{warrantyId}`            | `wty.warranty.read`        |
 * | `wty.warranty-generate`    | POST   | `/deliveries/{deliveryId}/warranties` | `wty.warranty.issue`       |
 * | `wty.warranty-policy-list` | GET    | `/warranty-policies`                  | `wty.warranty.read`        |
 * | `wty.warranty-policy-read` | GET    | `/warranty-policies/{policyId}`       | `wty.warranty.read`        |
 *
 * The last row is listed because it EXISTS and answers the same code, not because
 * this feature calls it: the picker needs a policy's identifier, code, name and
 * state, and the list publishes all four, so no adapter here reads one policy on its
 * own. It is named so the next reader of this table does not repeat the measurement.
 *
 * Typed from the routes that own the shapes and from `WarrantyView`,
 * `WarrantyRecordListView`, `WarrantyPolicyView`, `WarrantyCoverageView` and
 * `WarrantyItemView` in
 * `apps/api/src/modules/warranty/application/warranty-service.ts`, and from
 * `WarrantyPolicySummaryView` in `warranty-policy-service.ts`.
 *
 * ## The policy a warranty is issued under is CHOSEN from a published list
 *
 * `wty.warranty-policy-list` (P-10) lists a company's warranty policies, is gated on
 * `wty.warranty.read` — the read code, deliberately, so a warranty clerk can see the
 * plans they may issue under — and accepts `status`, `cursor` and `limit`. Its own
 * docblock names the generation form's picker as the reason it exists. So the issue
 * surface offers the plans by name and never asks an operator to type an identifier
 * it has no way to discover.
 *
 * ## The list is addressed to ONE branch, and the pair is a TARGET
 *
 * `wty.warranty-list` makes `companyId` and `branchId` required query fields and
 * treats them as the read's `authorizationTarget`. The route's docblock gives the
 * reason: `sel_warranty_records_scope` narrows on `iam.allowed_branch_ids()`, the
 * permission-blind union of every active grant, so an optional pair would mean the
 * read code held in one branch reads every branch the caller has any grant in. The
 * pair therefore travels through `branchTargetQuery`, the one door `lib/api` opens
 * for a resource pair — never through `query()`, which refuses the names outright.
 *
 * ## One filter, because the record names one
 *
 * `vehicleId`. The route is `.strict()`, so an unknown parameter is a 422 rather
 * than a filter silently dropped — a caller who mistyped a filter and was shown the
 * whole branch would read it as that vehicle's warranties. Nothing else is offered
 * here, because nothing else is offered there.
 *
 * ## FE-009 is PARTIAL, and the missing half is named rather than simulated
 *
 * `wty.warranty_status_history` — the table's real name, spelled as
 * `20260724095000_wty_warranty.sql` creates it — has no reader anywhere in
 * `apps/api/src` (**CC-10**, which records the same table under a longer name that no
 * migration ever used). So the history this feature can show is the vehicle-filtered LIST —
 * every warranty issued for one vehicle, newest first — and not the per-record
 * transition ledger the table holds. The reader is named as a backend prerequisite
 * (**P-18 warranty history reader**) in `warranty-record-screens.md`. No transition
 * is derived, inferred or composed on this side: a ledger assembled from a record's
 * current state would be a second, wrong authority on what happened to it.
 *
 * ## No money, by measurement
 *
 * `wty` has 80 columns and not one is an amount, a currency or a cap in any unit of
 * account, so no response in this feature carries money and nothing here formats or
 * computes any. `odometerAtIssue`, `odometerLimit` and `odometerAllowance` are
 * DISTANCE readings, published as exact decimal strings and kept as strings.
 *
 * ## Two odometer fields are named differently because they mean different things
 *
 * The record's `odometerLimit` is the ABSOLUTE reading at which cover lapses; the
 * coverage's `odometerAllowance` is the RELATIVE distance the coverage grants. They
 * are the same column name in two tables and the wrong one is a silently wrong
 * warranty, so the two are labelled apart on screen as well as in these types.
 *
 * ## Identifiers stay identifiers
 *
 * The vehicle, the work order and the delivery are bare references: no warranty read
 * resolves any of them to a name and nothing here invents a lookup. The policy is
 * the exception, and deliberately so — the detail and list reads both carry the
 * policy's own code and name, so it is rendered as the named thing the backend sent.
 */

/** The permissions the warranty screens consult, as the backend registers them. */
export const WARRANTY_PERMISSIONS = {
  /** Both reads, and the gate on both warranty pages. */
  read: 'wty.warranty.read',
  /**
   * The authority to CREATE a warranty from a committed handover.
   *
   * Separate from `read` on purpose: `wty.warranty-detail` used to declare this
   * write code for a read, which over-granted by omission, and P-7 minted the read
   * code to end that. Nothing here may collapse them back together.
   */
  issue: 'wty.warranty.issue',
  /**
   * `org.branch-list`, consulted only to decide whether a branch PICKER is offered.
   *
   * A warranty reader does not necessarily hold it, and the list read does not need
   * it: the branch pair is typed in by hand when the directory cannot be read, so a
   * caller without this code still reaches every branch their grants allow.
   */
  branchRead: 'org.branch.read',
} as const;

/** `ck_warranty_records_status`, mirrored. */
export const WARRANTY_STATUSES = [
  'issued',
  'active',
  'expired',
  'voided',
  'claimed_against',
] as const;
export type WarrantyStatus = (typeof WARRANTY_STATUSES)[number];

/** `ck_warranty_policies_status` and `ck_warranty_coverage_status`, mirrored. */
export const WARRANTY_CONFIGURATION_STATUSES = ['active', 'archived'] as const;
export type WarrantyConfigurationStatus = (typeof WARRANTY_CONFIGURATION_STATUSES)[number];

/**
 * The only state a warranty can actually be issued under.
 *
 * `wty.warranty-generate` refuses a policy that is not `active` as `ERR-TRN-001`, and
 * resolves the company's single ACTIVE policy when none is named. So the picker asks
 * the list for this state rather than filtering the whole set on this side: an
 * archived plan offered in a control is a choice whose only outcome is a refusal.
 * The filter is the route's own — `status` is optional there, and the unfiltered list
 * stays available to a configuration screen that must reach an archived row.
 */
export const ISSUABLE_POLICY_STATUS: WarrantyConfigurationStatus = 'active';

/** `ck_warranty_coverage_scope`, mirrored. */
export const COVERED_SCOPES = ['all', 'service', 'part'] as const;
export type CoveredScope = (typeof COVERED_SCOPES)[number];

/** `ck_warranty_record_items_kind`, mirrored. */
export const WARRANTY_ITEM_KINDS = ['service', 'part'] as const;
export type WarrantyItemKind = (typeof WARRANTY_ITEM_KINDS)[number];

/**
 * The delivery stage a warranty can be generated from.
 *
 * `wty.guard_warranty_record_coherence` refuses an INSERT whose delivery is not
 * `delivered`, and every term of the warranty is dated from `delivered_at`. The
 * value is mirrored from `ck_delivery_records_status` rather than invented, and it
 * decides only whether the control is OFFERED — the server decides again, and its
 * refusal is what the screen reports.
 */
export const WARRANTY_ELIGIBLE_DELIVERY_STATUS = 'delivered';

/**
 * The page this feature asks for.
 *
 * A choice, not the route's bound: `wty.warranty-list` refuses anything above 100,
 * so this sits well inside what it accepts.
 */
export const PAGE_SIZE = 25;

/**
 * The message key that names a closed-vocabulary value in the operator's language.
 *
 * A lookup rather than a key built from the value, so a word the backend adds
 * without a translation renders as the code the backend actually sent rather than as
 * a dotted internal string that looks like a label — and so this catalogue holds no
 * snake-case word of its own.
 */
export const WARRANTY_STATUS_LABEL_KEYS: Readonly<Record<string, string>> = {
  issued: 'warranty.status.issued',
  active: 'warranty.status.active',
  expired: 'warranty.status.expired',
  voided: 'warranty.status.voided',
  claimed_against: 'warranty.status.claimedAgainst',
} satisfies Readonly<Record<WarrantyStatus, string>>;

/** The message key for a policy or coverage lifecycle state. */
export const CONFIGURATION_STATUS_LABEL_KEYS: Readonly<Record<string, string>> = {
  active: 'warranty.configurationStatus.active',
  archived: 'warranty.configurationStatus.archived',
} satisfies Readonly<Record<WarrantyConfigurationStatus, string>>;

/** The message key for what a coverage window covers. */
export const COVERED_SCOPE_LABEL_KEYS: Readonly<Record<string, string>> = {
  all: 'warranty.coveredScope.all',
  service: 'warranty.coveredScope.service',
  part: 'warranty.coveredScope.part',
} satisfies Readonly<Record<CoveredScope, string>>;

/** The message key for what kind of thing a covered item is. */
export const ITEM_KIND_LABEL_KEYS: Readonly<Record<string, string>> = {
  service: 'warranty.itemKind.service',
  part: 'warranty.itemKind.part',
} satisfies Readonly<Record<WarrantyItemKind, string>>;

/**
 * Resolve a value the backend sent to the key that names it.
 *
 * Returns `null` for a value this build does not know, and every caller renders the
 * raw code in that case. Guessing a key would print the key itself as if it were a
 * label; printing the code at least names the thing the backend said.
 */
export function labelKeyFor(table: Readonly<Record<string, string>>, value: string): string | null {
  const known = table as Readonly<Record<string, string | undefined>>;
  return known[value] ?? null;
}

/** A cursor page exactly as the backend publishes one — no total, and none invented. */
export interface WarrantyPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/** `WarrantyPolicyView` — the policy a record cites, carried by BOTH reads. */
export interface WarrantyPolicy {
  readonly id: string;
  readonly policyCode: string;
  readonly name: string;
  /** The wire's `string`; the check constraint is the database's to widen. */
  readonly status: string;
}

/**
 * `WarrantyPolicySummaryView` — one row of `wty.warranty-policy-list`.
 *
 * A superset of `WarrantyPolicy`: the four fields a warranty carries are spelled
 * identically, and the list adds `companyId` and `recordVersion`. The company is why
 * it is read here at all — the list is TENANT-scoped and answers for every company
 * the caller's grants reach, so a picker standing on one handover narrows to that
 * handover's company rather than offering a plan the generation would refuse.
 * `recordVersion` belongs to the two commands over a policy and is carried because
 * the wire carries it, not because anything in this feature writes one.
 */
export interface WarrantyPolicySummary {
  readonly id: string;
  readonly companyId: string;
  readonly policyCode: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

/**
 * `WarrantyPolicyListView` — the policy list's body.
 *
 * The page is NAMED rather than bare: the route answers `{ policies: { ... } }`, and
 * flattening it here would make this type disagree with the wire at the one place a
 * disagreement is invisible until runtime.
 */
export interface WarrantyPolicyListBody {
  readonly policies: WarrantyPage<WarrantyPolicySummary>;
}

/**
 * `WarrantyCoverageView` — the terms a record cites. Every value is operator
 * configuration, and none of it is defaulted anywhere in this application.
 */
export interface WarrantyCoverage {
  readonly id: string;
  readonly coveredScope: string;
  readonly durationMonths: number;
  /** The coverage's RELATIVE allowance as an exact decimal string, or absent when unlimited. */
  readonly odometerAllowance: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
}

/** `WarrantyItemView` — one covered job or part. */
export interface WarrantyItem {
  readonly id: string;
  readonly itemKind: string;
  readonly sourceJobId: string | null;
  readonly sourcePartId: string | null;
  readonly description: string;
}

/**
 * `WarrantyView` — one warranty record, with its terms and its covered items.
 *
 * `status` is typed as the wire's `string` rather than as `WarrantyStatus`: the check
 * constraint is the database's and a value added there must reach the screen as
 * itself, not be narrowed away by a type this side invented.
 */
export interface WarrantyRecord {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly workOrderId: string;
  readonly deliveryRecordId: string;
  readonly status: string;
  readonly startDate: string;
  readonly expiryDate: string;
  readonly odometerAtIssue: string;
  /** The ABSOLUTE ceiling, or absent when the coverage sets no distance limit. */
  readonly odometerLimit: string | null;
  readonly policy: WarrantyPolicy;
  readonly coverage: WarrantyCoverage;
  readonly items: readonly WarrantyItem[];
  readonly recordVersion: number;
  /** True when an idempotent replay returned the warranty that already existed. */
  readonly replayed: boolean;
}

/**
 * `WarrantyRecordListView` — one warranty on a list page.
 *
 * Every field is spelled exactly as the detail read spells it, so a screen that lists
 * warranties and then opens one sees ONE shape rather than two. It carries no
 * coverage terms and no covered items — both belong to the detail read — and it
 * carries the policy in full, so a row can name the plan it was issued under without
 * a second read per row. `wty.warranty-policy-list` would resolve a bare identifier,
 * but one request per listed warranty is not how a list is drawn.
 */
export interface WarrantyListRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly vehicleId: string;
  readonly workOrderId: string;
  readonly deliveryRecordId: string;
  readonly status: string;
  readonly startDate: string;
  readonly expiryDate: string;
  readonly odometerAtIssue: string;
  readonly odometerLimit: string | null;
  readonly policy: WarrantyPolicy;
  readonly recordVersion: number;
}

/**
 * The catalogue codes a warranty generation answers with that mean something more
 * specific than their HTTP kind.
 *
 * A code is branched on only where the backend genuinely distinguishes a cause and
 * the distinction changes what the operator should do. The service's own sentence
 * never crosses the wire — `problemFor` assembles the document from the catalogue
 * entry and the failure's safe details — so the screen states each cause in its own
 * plain words rather than quoting a message it cannot read.
 */
export const WARRANTY_ERROR_CODES = {
  /**
   * A live warranty already spans this window for the same vehicle under the same
   * coverage. Arrives as a conflict, and it is a fact about the vehicle rather than
   * about a stale view.
   */
  alreadyCovered: 'ERR-CON-001',
  /** The same idempotency key is already recorded for this tenant. */
  alreadyRecorded: 'ERR-INT-001',
  /**
   * Nothing to issue against: no coverage configured for the handover date, or no
   * single active policy to resolve. Both are operator configuration, never a default.
   */
  notConfigured: 'ERR-RES-001',
  /** The handover does not satisfy a precondition — it must be completed first. */
  refused: 'ERR-TRN-001',
  /** The authority to issue was not held. */
  denied: 'ERR-IAM-001',
} as const;
