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
 * The plan ADMINISTRATION surface (P1-31, FE-008 policy administration) adds the five
 * writes P-10 published, every one of them on the administration code and none of
 * them on the read:
 *
 * | operation                          | method | path                                                            | permissions           |
 * | ---------------------------------- | ------ | --------------------------------------------------------------- | --------------------- |
 * | `wty.warranty-policy-create`       | POST   | `/warranty-policies`                                              | `wty.policy.manage`   |
 * | `wty.warranty-policy-rename`       | PATCH  | `/warranty-policies/{policyId}`                                   | `wty.policy.manage`   |
 * | `wty.warranty-policy-status-set`   | POST   | `/warranty-policies/{policyId}/status`                            | `wty.policy.manage`   |
 * | `wty.warranty-coverage-create`     | POST   | `/warranty-policies/{policyId}/coverage-windows`                  | `wty.policy.manage`   |
 * | `wty.warranty-coverage-status-set` | POST   | `/warranty-policies/{policyId}/coverage-windows/{coverageId}/status` | `wty.policy.manage`  |
 *
 * `wty.warranty-policy-read` is no longer read-but-uncalled: the plan screen is
 * addressed against it, and every mutation re-reads through it so what the screen
 * shows afterwards is the server's answer rather than the request this side sent.
 *
 * ## Three of the five require `If-Match`, and two of those require a key as well
 *
 * `rename`, `policy-status-set` and `coverage-status-set` are registered
 * `versionGuarded`, so the backend raises `ERR-CON-002` without the header. Every
 * adapter here takes the version as a REQUIRED argument, so there is no call shape
 * that omits it. `create`, `coverage-create` and `policy-status-set` are registered
 * idempotent and the TRANSPORT mints their key from the published contract —
 * `coverage-status-set` deliberately is not, because a restore can be refused by
 * rows written since and a replayed success would hide that refusal.
 *
 * ## The two versions are different counters
 *
 * A plan and a window of cover terms each carry their own `recordVersion`, on
 * different rows, and the plan screen holds both at once. Sending one where the
 * other belongs is the mistake this surface makes easy, so the two never share a
 * variable and the coverage commands take the COVERAGE row's version.
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
  /**
   * The authority to CREATE a plan, rename one, retire or restore one, and to add
   * or retire a window of cover terms.
   *
   * Seeded since P1-08 and declared by the five policy and coverage WRITES P-10
   * published. It is deliberately not `read`: `wty.warranty-detail` records that
   * borrowing this code for a read "would be worse: it grants coverage
   * administration", which is exactly what these five operations are. The
   * administration screens are gated on `read` and draw their controls on this, so a
   * warranty clerk sees the plans and an administrator changes them.
   */
  policyManage: 'wty.policy.manage',
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

/* ------------------------------------------------------------------ *
 * Plan administration (P1-31, FE-008 policy administration)
 *
 * The five WRITES P-10 published, plus the single-policy read they are all
 * addressed against. Every bound below is transcribed from
 * `apps/api/src/modules/warranty/domain/warranty.ts`, which is itself the module's
 * transcription of the CHECK constraints — so a control refuses what the column
 * refuses and the operator is told by the field rather than by a request that was
 * rejected whole.
 * ------------------------------------------------------------------ */

/**
 * `ck_warranty_policies_code`, mirrored: a lower-case machine reference.
 *
 * It is chosen once and never changed. The rename operation accepts the NAME and
 * refuses this field, because a re-coded plan is a different configuration wearing
 * the old one's identity and a warranty issued last year would cite a code that has
 * since moved.
 */
export const POLICY_CODE_FORMAT = /^[a-z][a-z0-9_]{1,62}$/;

/** `MAX_POLICY_NAME` in the warranty domain — the boundary's bound, not a column's. */
export const MAX_POLICY_NAME = 200;

/** `ck_warranty_coverage_duration`, mirrored. A count of months, never an amount. */
export const MIN_DURATION_MONTHS = 1;
export const MAX_DURATION_MONTHS = 2147483647;

/** `ck_warranty_coverage_odometer`, mirrored. A distance, carried as an exact string. */
export const MIN_ODOMETER_ALLOWANCE = 1;
export const MAX_ODOMETER_ALLOWANCE = 2147483647;

/** The date spelling both coverage routes accept. */
export const COVERAGE_DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A whole number, as a STRING.
 *
 * Used to admit `odometerAllowance` before it is sent, and the value is never
 * converted on the way: the route takes a string of digits, the column is
 * `numeric`, and turning a distance into a double to check it is the one place a
 * reading could quietly change. `durationMonths` is separate — it crosses the wire
 * as a JSON number because a count of months is not a measurement.
 */
export const WHOLE_NUMBER = /^\d+$/;

/**
 * `WarrantyCoverageTermsView` — one window of cover terms on the administration
 * surface.
 *
 * A superset of `WarrantyCoverage`, which a warranty carries: the six fields that
 * describe the terms are spelled identically, and this adds `policyId` and
 * `recordVersion`. The version is the COVERAGE row's own and is what its status
 * command expects in `If-Match` — never the plan's, which is a different counter on
 * a different row. The two live in one screen, which is exactly the shape a caller
 * can get wrong silently.
 */
export interface WarrantyCoverageTerms {
  readonly id: string;
  readonly policyId: string;
  readonly coveredScope: string;
  readonly durationMonths: number;
  readonly odometerAllowance: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

/**
 * `WarrantyPolicyDetailView` — a plan WITH its cover terms, in a published order.
 *
 * The coverage is not paged and is not filtered by state. Retired windows arrive
 * with the rest deliberately: they are the history that explains a warranty issued
 * under terms since replaced, and hiding them would make the restore command
 * unreachable.
 */
export interface WarrantyPolicyDetail {
  readonly policy: WarrantyPolicySummary;
  readonly coverage: readonly WarrantyCoverageTerms[];
}

/**
 * The body `wty.warranty-coverage-create` accepts, and the same shape the plan
 * create route embeds under `coverage[]`.
 *
 * `odometerAllowance` is OMITTED rather than sent empty when the terms set no
 * distance limit — that is what a NULL column means there, and the route's body is
 * `.strict()` about an empty string. `effectiveTo` is omitted the same way for a
 * window that is still in force.
 */
export interface WarrantyCoverageCreateBody {
  readonly coveredScope: CoveredScope;
  readonly durationMonths: number;
  readonly odometerAllowance?: string;
  readonly effectiveFrom: string;
  readonly effectiveTo?: string;
}

/**
 * The body `wty.warranty-policy-create` accepts.
 *
 * `companyId` is a CLAIM rather than a scope: the service re-authorizes it against
 * the caller's own grants before a row is written. `status` is refused by the route
 * — a plan cannot be created already retired — and so is `id`.
 */
export interface WarrantyPolicyCreateBody {
  readonly companyId: string;
  readonly policyCode: string;
  readonly name: string;
  readonly coverage?: readonly WarrantyCoverageCreateBody[];
}

/** The body `wty.warranty-policy-rename` accepts: the name and nothing else. */
export interface WarrantyPolicyRenameBody {
  readonly name: string;
}

/** The body both status commands accept. */
export interface WarrantyStatusSetBody {
  readonly status: WarrantyConfigurationStatus;
}

/**
 * The catalogue codes the five administration writes answer with.
 *
 * `ERR-CON-002` is listed and is never expected: the backend raises it when
 * `If-Match` is absent, and every version-guarded adapter in this feature takes the
 * version as a REQUIRED argument, so the header cannot be left off from here. It is
 * named so that the day it appears it is recognised as a defect on this side rather
 * than reported to an operator as an ordinary conflict.
 */
export const POLICY_ERROR_CODES = {
  /**
   * A conflict. THREE different causes share this code and the screen must tell
   * them apart by the violation rule below, because they lead an operator
   * somewhere different: a stale version (no rule), a window already covered
   * (`overlapping_coverage`), and a plan reference already used
   * (`duplicate_code`).
   */
  conflict: 'ERR-CON-001',
  /** `If-Match` was absent. Unreachable from this feature; see above. */
  missingVersion: 'ERR-CON-002',
  /** The input was refused at the boundary or by a CHECK constraint. */
  invalid: 'ERR-VAL-001',
  /** The authority was not held. */
  denied: 'ERR-IAM-001',
  /** The plan or the window could not be resolved. */
  missing: 'ERR-RES-001',
} as const;

/**
 * `ex_warranty_coverage_no_overlap` refused the row — BR-WTY-001.
 *
 * Raised both by adding a window over a covered one and by restoring a window whose
 * dates have been re-covered since. The backend gives both the same rule because to
 * a caller they mean the same thing, and the screen says so in one sentence.
 */
export const OVERLAPPING_COVERAGE_RULE = 'overlapping_coverage';

/** `uq_warranty_policies_code` refused the row: the reference is already in use. */
export const DUPLICATE_POLICY_CODE_RULE = 'duplicate_code';
