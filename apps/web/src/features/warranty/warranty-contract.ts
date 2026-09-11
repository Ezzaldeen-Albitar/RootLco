/**
 * The warranty contract this phase consumes (P1-31, FE-008 warranty record,
 * FE-009 warranty history as far as the backend publishes one).
 *
 * | operation               | method | path                                  | permissions (ALL required) |
 * | ----------------------- | ------ | ------------------------------------- | -------------------------- |
 * | `wty.warranty-list`     | GET    | `/warranties`                         | `wty.warranty.read`        |
 * | `wty.warranty-detail`   | GET    | `/warranties/{warrantyId}`            | `wty.warranty.read`        |
 * | `wty.warranty-generate` | POST   | `/deliveries/{deliveryId}/warranties` | `wty.warranty.issue`       |
 *
 * Typed from the routes that own the shapes and from `WarrantyView`,
 * `WarrantyRecordListView`, `WarrantyPolicyView`, `WarrantyCoverageView` and
 * `WarrantyItemView` in
 * `apps/api/src/modules/warranty/application/warranty-service.ts`.
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
 * `wty.warranty_record_status_history` has no reader anywhere in `apps/api/src`
 * (**CC-10**). So the history this feature can show is the vehicle-filtered LIST —
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
 * carries the policy in full, because no operation lists warranty policies and a
 * bare policy identifier would be one no caller could resolve.
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
