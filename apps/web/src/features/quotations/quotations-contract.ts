/**
 * The quotation contract this phase consumes (P1-30, `W3`, FE-003/004/005/007).
 *
 * | operation                                | method | path                                          | permission             |
 * | ---------------------------------------- | ------ | --------------------------------------------- | ---------------------- |
 * | `quo.quotation-list`                     | GET    | `/work-orders/{workOrderId}/quotations`       | `quo.quotation.read`   |
 * | `quo.quotation-detail`                   | GET    | `/quotations/{quotationId}`                   | `quo.quotation.read`   |
 * | `quo.quotation-revision-list`            | GET    | `/quotations/{quotationId}/revisions`         | `quo.quotation.read`   |
 * | `quo.quotation-revision-detail`          | GET    | `/quotation-revisions/{revisionId}`           | `quo.quotation.read`   |
 * | `quo.quotation-revision-decisions-read`  | GET    | `/quotation-revisions/{revisionId}/decisions` | `quo.quotation.read`   |
 * | `iam.approval-limit-list`                | GET    | `/iam/approval-limits`                        | `iam.approval.manage`  |
 * | `quo.quotation-create`                   | POST   | `/quotations`                                 | `quo.quotation.manage` |
 * | `quo.quotation-revision-create`          | POST   | `/quotations/{quotationId}/revisions`         | `quo.quotation.manage` |
 * | `quo.quotation-issue`                    | POST   | `/quotations/{quotationId}/issue`             | `quo.quotation.manage` |
 * | `quo.quotation-revision-decide`          | POST   | `/quotation-revisions/{revisionId}/decisions` | `quo.decision.record`  |
 * | `quo.quotation-item-decide`              | POST   | `/quotation-items/{itemId}/decisions`         | `quo.decision.record`  |
 *
 * Typed from the routes that own the shapes and from the views in
 * `apps/api/src/modules/quotation/application/*`. Nothing here is invented;
 * `tests/backend/p1-30-w3-quotations.test.ts` PARSES the interfaces out of this
 * file and holds them against rows that came out of the database, in both
 * directions.
 *
 * ## Totals are captured figures
 *
 * A revision carries `subtotal`, `discountTotal`, `taxTotal` and `grandTotal`,
 * and every line carries `unitPrice`, `quantity`, `discount`, `taxRate`,
 * `taxAmount` and `lineTotal` — all decimal STRINGS the database computed and
 * constrained (`ck_quotation_revisions_totals`, `ck_quotation_items_line_total`).
 * A screen renders them and never re-derives one from another; that is the
 * phase's closure condition (`P1-30 RENDERS SERVER ARITHMETIC ONLY`).
 *
 * ## Which record version a guarded write needs
 *
 * `quo.quotation-issue` and `quo.quotation-revision-create` guard the
 * QUOTATION's `recordVersion` — the row the service locks — while their own
 * responses carry the REVISION's. The number to send is the one on
 * `QuotationDetail` (its ETag), never one from a revision's answer, and the
 * detail is re-read after every write.
 *
 * ## There is no discount request
 *
 * A discount is a field on a line. The backend authorizes it synchronously
 * inside the quotation write — a policy threshold decides whether an elevated
 * permission is needed, and the actor's approval limit decides whether the
 * amount is within reach — and refuses the whole document otherwise. So the
 * "discount request" of FE-005 is that field, and an approval-limit refusal is
 * rendered as the refusal it is, with its message and reference.
 *
 * ## Reads the backend does not publish, said here rather than hidden
 *
 * - No quotation list wider than one work order: quotations are reached FROM a
 *   work order.
 * - No line list of its own: lines arrive inside a revision.
 * - No read of a discount policy, a discount request, or a status history.
 * - Approval LIMITS are readable only through `iam.approval-limit-list`, which
 *   needs `iam.approval.manage`; without it the screen says the limits cannot
 *   be shown rather than pretending there are none.
 */

/** The permissions the W3 screens consult, as the backend registers them. */
export const QUOTATION_PERMISSIONS = {
  read: 'quo.quotation.read',
  manage: 'quo.quotation.manage',
  /** Recording a customer decision on a line or a whole revision. */
  decide: 'quo.decision.record',
  /** The approval-limit list, a separate and high-risk code. */
  limitsRead: 'iam.approval.manage',
  /** The service picker's own code. */
  serviceRead: 'svc.service.read',
  /** Creating a quotation demands the work order be readable too. */
  workOrderRead: 'wo.work_order.read',
} as const;

/** `ck_quotations_status`, mirrored. `cancelled` is in the constraint but no code path writes it. */
export const QUOTATION_STATES = [
  'draft',
  'active',
  'accepted',
  'rejected',
  'expired',
  'cancelled',
] as const;
export type QuotationState = (typeof QUOTATION_STATES)[number];

/**
 * `ck_quotation_revisions_status`, mirrored. An accepted quotation leaves its
 * revision `issued` — there is deliberately no accepted revision state.
 */
export const REVISION_STATES = ['draft', 'issued', 'superseded', 'rejected', 'expired'] as const;
export type RevisionState = (typeof REVISION_STATES)[number];

/** `ck_approval_decisions_decision`, mirrored: `rejected`, not declined. */
export const DECISIONS = ['approved', 'rejected'] as const;
export type Decision = (typeof DECISIONS)[number];

/** `ck_approval_decisions_channel`, mirrored. */
export const DECISION_CHANNELS = ['in_person', 'phone', 'portal', 'email', 'system'] as const;
export type DecisionChannel = (typeof DECISION_CHANNELS)[number];

/** `ck_approval_evidence_kind`, mirrored. `document` requires a document version. */
export const EVIDENCE_KINDS = ['document', 'verbal', 'portal', 'email'] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** `ck_quotation_items_kind`, mirrored. */
export const ITEM_KINDS = ['service', 'part'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

/** The lower-snake code a customer class carries, mirrored from `INTERNAL_CODE`. */
export const INTERNAL_CODE = /^[a-z][a-z0-9_]{1,62}$/;

/** A line quantity as the route accepts it: positive, at most three decimals. */
export const QUANTITY = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,3})?$/;

/** A line discount as the route accepts it: non-negative, at most four decimals. */
export const DISCOUNT = /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/;

/** Column widths and bounds, mirrored, so a form can refuse before the 422 does. */
export const MAX_ITEM_DESCRIPTION = 2000;
export const MAX_ITEMS_PER_REVISION = 200;
export const MAX_REFERENCE_NOTE = 2000;
/** The most rows the decisions read answers with; it has no cursor. */
export const DECISIONS_BOUND = 200;
/** The most rows the approval-limit list answers with; it has no cursor or count. */
export const APPROVAL_LIMIT_BOUND = 200;

/**
 * One priced line — `MoneyLine`. Every figure is a decimal STRING: `unitPrice`,
 * `discount`, `taxAmount`, `lineTotal` are `numeric(18,4)`, `quantity` is
 * `numeric(12,3)`, `taxRate` is a `numeric(9,6)` fraction of one.
 */
export interface QuotationLine {
  readonly id: string;
  readonly lineNumber: number;
  readonly itemKind: ItemKind;
  readonly serviceId: string | null;
  readonly description: string | null;
  readonly currency: string;
  readonly unitPrice: string;
  readonly quantity: string;
  readonly discount: string;
  readonly taxRate: string;
  readonly taxAmount: string;
  readonly lineTotal: string;
  readonly priceRuleRef: string | null;
}

/**
 * One revision with its lines — `RevisionView`: the body of
 * `quo.quotation-revision-detail`, of `quo.quotation-issue` and of
 * `quo.quotation-revision-create`, and `QuotationDetail.currentRevision`.
 *
 * `recordVersion` here is the REVISION's, which no write on this surface asks
 * for. The four totals are captured decimal strings.
 */
export interface QuotationRevision {
  readonly id: string;
  readonly revisionNumber: number;
  readonly status: RevisionState;
  readonly currency: string;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly grandTotal: string;
  readonly recordVersion: number;
  readonly lines: readonly QuotationLine[];
}

/**
 * One row of `quo.quotation-revision-list` — `RevisionHeaderView`: a revision
 * without its lines, plus `quotationId` and `isCurrent`, which the server
 * decides (the quotation's current revision, else the latest) — never derived
 * on the client from a status.
 */
export interface QuotationRevisionHeader {
  readonly id: string;
  readonly quotationId: string;
  readonly revisionNumber: number;
  readonly status: RevisionState;
  readonly currency: string;
  readonly issuedAt: string | null;
  readonly expiresAt: string | null;
  readonly subtotal: string;
  readonly discountTotal: string;
  readonly taxTotal: string;
  readonly grandTotal: string;
  readonly recordVersion: number;
  readonly isCurrent: boolean;
}

/**
 * The body of `quo.quotation-detail` and of `quo.quotation-create` —
 * `QuotationView`. `recordVersion` is the QUOTATION's: the `If-Match` both
 * guarded writes need, carried as the ETag as well. `currentRevision` is the
 * current revision, else the latest, else `null`.
 */
export interface QuotationDetail {
  readonly id: string;
  readonly quotationNumber: string;
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly currency: string;
  readonly status: QuotationState;
  readonly payerPartnerRef: string | null;
  readonly currentRevisionId: string | null;
  readonly recordVersion: number;
  readonly currentRevision: QuotationRevision | null;
}

/** One row of `quo.quotation-list` — `QuotationSummaryView`. No money field of any kind. */
export interface QuotationSummary {
  readonly id: string;
  readonly quotationNumber: string;
  readonly workOrderId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly currency: string;
  readonly status: QuotationState;
  readonly payerPartnerRef: string | null;
  readonly currentRevisionId: string | null;
  readonly recordVersion: number;
}

/** One piece of evidence behind a decision — `EvidenceView`. Never a storage key, never a name. */
export interface DecisionEvidence {
  readonly id: string;
  readonly evidenceKind: EvidenceKind;
  readonly documentVersionId: string | null;
  readonly referenceNote: string | null;
  readonly recordedAt: string;
}

/** One recorded line decision as the audit read projects it — `DecisionAuditView`. */
export interface LineDecision {
  readonly decisionId: string;
  readonly quotationRevisionId: string;
  readonly quotationItemId: string;
  readonly lineNumber: number;
  readonly description: string | null;
  readonly decision: Decision;
  readonly channel: DecisionChannel;
  readonly decidedAt: string;
  /** The staff account that recorded it — not the customer. */
  readonly recordedBy: string;
  readonly evidence: readonly DecisionEvidence[];
}

/**
 * The body of `quo.quotation-revision-decisions-read` — `RevisionDecisionAuditView`.
 * `outcome` is the server's roll-up (any rejection rejects; all approved
 * accepts; else `null`) and is rendered, never recomputed from the rows.
 */
export interface RevisionDecisions {
  readonly quotationId: string;
  readonly revisionId: string;
  readonly revisionStatus: RevisionState;
  readonly itemCount: number;
  readonly decidedCount: number;
  readonly outcome: 'accepted' | 'rejected' | null;
  readonly decisions: readonly LineDecision[];
}

/** The body of `quo.quotation-item-decide` — `DecisionView`, the write's echo. */
export interface ItemDecisionEcho {
  readonly decisionId: string;
  readonly quotationItemId: string;
  readonly quotationRevisionId: string;
  readonly decision: Decision;
  readonly channel: DecisionChannel;
  readonly decidedAt: string;
  readonly recordedBy: string;
  readonly evidenceId: string | null;
}

/** The body of `quo.quotation-revision-decide` — `RevisionDecisionView`. */
export interface RevisionDecisionEcho {
  readonly quotationId: string;
  readonly revisionId: string;
  readonly decision: Decision;
  readonly itemsDecided: number;
  readonly decisions: readonly ItemDecisionEcho[];
  /** The quotation's recomputed status, `null` while the revision is still undecided. */
  readonly quotationStatus: QuotationState | null;
}

/**
 * One row of `iam.approval-limit-list` — `ApprovalLimitRow`. `amount` is a
 * decimal string in `currencyCode`; the screen shows only rows whose
 * `limitType` is `discount`.
 */
export interface ApprovalLimit {
  readonly id: string;
  readonly companyId: string;
  readonly roleId: string | null;
  readonly userId: string | null;
  readonly limitType: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly recordVersion: number;
}
