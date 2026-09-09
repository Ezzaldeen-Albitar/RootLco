/**
 * The vehicle-delivery contract this phase consumes (P1-31, FE-002 eligibility,
 * FE-003 authorized receiver, FE-004 checklist results, FE-006 signatures,
 * FE-007 delivery history).
 *
 * | operation                            | method | path                                          | permissions (ALL required)              |
 * | ------------------------------------ | ------ | --------------------------------------------- | --------------------------------------- |
 * | `sal.delivery-read`                  | GET    | `/deliveries/{deliveryId}`                    | `sal.delivery.view`                     |
 * | `sal.delivery-eligibility-read`      | GET    | `/deliveries/{deliveryId}/eligibility`        | `sal.delivery.view`, `sal.finance.view` |
 * | `sal.delivery-receiver-read`         | GET    | `/deliveries/{deliveryId}/authorized-receiver`| `sal.delivery.view`                     |
 * | `sal.delivery-signature-list`        | GET    | `/deliveries/{deliveryId}/signatures`         | `sal.delivery.view`                     |
 * | `sal.delivery-checklist-result-list` | GET    | `/deliveries/{deliveryId}/checklist-results`  | `sal.delivery.view`                     |
 * | `sal.delivery-status-history`        | GET    | `/deliveries/{deliveryId}/status-history`     | `sal.delivery.view`                     |
 * | `sal.work-order-delivery-read`       | GET    | `/work-orders/{workOrderId}/delivery`         | `sal.delivery.view`                     |
 *
 * Typed from the routes that own the shapes and the views in
 * `apps/api/src/modules/delivery/application/delivery-read-service.ts`. This
 * slice is READ-ONLY: creation, receiver verification, signing and completion
 * are separate tasks, so nothing here describes a request body and the
 * request-payload parity gate has nothing to mirror.
 *
 * ## The eligibility read needs a SECOND permission, and the page must respect it
 *
 * `sal.delivery-eligibility-read` declares `sal.delivery.view` AND
 * `sal.finance.view`, because one of the eight blockers it composes is the
 * customer's open balance. A caller holding only the delivery code is refused at
 * the route with a 403 — so the screen does not issue the read at all for such a
 * caller, and says why in its own words instead. Asking and being refused would
 * put a denial in the backend's log for a decision this screen could make.
 *
 * ## Not every blocker means the same thing
 *
 * Five of the eight blockers exist only because the application composes them;
 * the database primitive enforces three. Each composed fact therefore reports
 * whether it could be ESTABLISHED. A blocker whose fact is unestablished means
 * "this could not be read", which is an operator's cue to raise a platform
 * problem — not to chase the customer. The two are rendered differently on
 * purpose; collapsing them turns a fail-closed default into a silent outage.
 *
 * ## Identifiers are identifiers
 *
 * No delivery read resolves a name. `deliveringEmployeeId` has no foreign key
 * anywhere in the platform and nothing turns it into a person; the receiver is a
 * partner identifier; the vehicle is an identifier. The screen renders them as
 * labelled references and invents no lookup that the backend does not publish.
 *
 * ## Two references are sensitive, and stay references
 *
 * `identityEvidenceDocumentVersionId` and `signatureDocumentVersionId` point at
 * stored documents. No identity-document content and no signature image is read,
 * requested or rendered here: the screen states that the evidence is on file and
 * offers no way to fetch the bytes.
 *
 * ## No figure crosses this boundary
 *
 * Not one delivery read carries an amount. `financial_balance_outstanding` is a
 * blocker CODE, not a number, and `finalOdometerReadingId` is a reference to a
 * reading rather than a reading. Nothing in this feature formats or computes
 * money, which is why the phase carries no arithmetic-gate area yet.
 */

/** The permissions the delivery screens consult, as the backend registers them. */
export const DELIVERY_PERMISSIONS = {
  /** Every delivery read, and the page's own gate. */
  view: 'sal.delivery.view',
  /** Demanded by the eligibility read ALONGSIDE `view`, because one blocker is financial. */
  financeView: 'sal.finance.view',
  /** The authority that may override the one overridable blocker. Never a gate here. */
  complete: 'sal.delivery.complete',
} as const;

/** `ck_delivery_records_status`, mirrored. */
export const DELIVERY_STATUSES = [
  'ready',
  'receiver_verified',
  'signed',
  'delivered',
  'exception',
] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** The eight blocker codes the eligibility composition can raise, mirrored verbatim. */
export const BLOCKER_CODES = [
  'work_order_not_complete',
  'quality_control_not_passed',
  'financial_balance_outstanding',
  'part_obligation_outstanding',
  'checklist_incomplete',
  'receiver_not_verified',
  'signature_missing',
  'delivery_state_invalid',
] as const;
export type BlockerCode = (typeof BLOCKER_CODES)[number];

/** `ck_delivery_signatures_signer_role`, mirrored. */
export const SIGNER_ROLES = ['receiver', 'delivering_employee', 'witness'] as const;
export type SignerRole = (typeof SIGNER_ROLES)[number];

/** `ck_delivery_checklist_results_outcome`, mirrored. */
export const CHECKLIST_OUTCOMES = ['passed', 'failed', 'waived'] as const;
export type ChecklistOutcome = (typeof CHECKLIST_OUTCOMES)[number];

/**
 * The page each list asks for.
 *
 * A choice, not the route's bound: the three paged reads default to 50 and
 * refuse anything above 100, so this sits well inside what they accept.
 */
export const PAGE_SIZE = 25;

/**
 * The message key that names a code in the operator's language.
 *
 * A lookup rather than a string built from the code, so a value the backend
 * adds without a translation renders as a visible gap rather than as a key that
 * happens to look plausible — and so the catalogue holds no snake-case word.
 */
export const BLOCKER_LABEL_KEYS: Readonly<Record<string, string>> = {
  work_order_not_complete: 'delivery.blocker.workOrderNotComplete',
  quality_control_not_passed: 'delivery.blocker.qualityControlNotPassed',
  financial_balance_outstanding: 'delivery.blocker.financialBalanceOutstanding',
  part_obligation_outstanding: 'delivery.blocker.partObligationOutstanding',
  checklist_incomplete: 'delivery.blocker.checklistIncomplete',
  receiver_not_verified: 'delivery.blocker.receiverNotVerified',
  signature_missing: 'delivery.blocker.signatureMissing',
  delivery_state_invalid: 'delivery.blocker.deliveryStateInvalid',
} satisfies Readonly<Record<BlockerCode, string>>;

/** The message key for a delivery status. */
export const STATUS_LABEL_KEYS: Readonly<Record<string, string>> = {
  ready: 'delivery.status.ready',
  receiver_verified: 'delivery.status.receiverVerified',
  signed: 'delivery.status.signed',
  delivered: 'delivery.status.delivered',
  exception: 'delivery.status.exception',
} satisfies Readonly<Record<DeliveryStatus, string>>;

/** The message key for a signer role. */
export const SIGNER_ROLE_LABEL_KEYS: Readonly<Record<string, string>> = {
  receiver: 'delivery.signerRole.receiver',
  delivering_employee: 'delivery.signerRole.deliveringEmployee',
  witness: 'delivery.signerRole.witness',
} satisfies Readonly<Record<SignerRole, string>>;

/** The message key for a checklist outcome. */
export const OUTCOME_LABEL_KEYS: Readonly<Record<string, string>> = {
  passed: 'delivery.outcome.passed',
  failed: 'delivery.outcome.failed',
  waived: 'delivery.outcome.waived',
} satisfies Readonly<Record<ChecklistOutcome, string>>;

/**
 * Resolve a value the backend sent to the key that names it.
 *
 * Returns `null` for a value this build does not know, and every caller renders
 * the raw code in that case. Guessing a key would print the key itself as if it
 * were a label; printing the code at least names the thing the backend said.
 */
export function labelKeyFor<K extends string>(
  table: Readonly<Record<K, string>>,
  value: string
): string | null {
  const known = table as Readonly<Record<string, string | undefined>>;
  return known[value] ?? null;
}

/** A cursor page exactly as the backend publishes one — no total, and none invented. */
export interface DeliveryPage<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * The delivery record — `DeliveryRecordView`.
 *
 * `status` is typed as the wire's `string` rather than as `DeliveryStatus`: the
 * check constraint is the database's and a value added there must reach the
 * screen as itself, not be narrowed away by a type this side invented.
 */
export interface DeliveryRecord {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly receptionVisitId: string;
  readonly vehicleId: string;
  /** The bare identifier the column holds. Nothing in the platform names it. */
  readonly deliveringEmployeeId: string;
  readonly status: string;
  readonly deliveredAt: string | null;
  /** A vehicle odometer-reading identifier. NOT a reading value. */
  readonly finalOdometerReadingId: string | null;
  /** The value a completion's mandatory version guard takes. */
  readonly recordVersion: number;
}

/** `sal.work-order-delivery-read` — `WorkOrderDeliveryView`. Absence is a delivery of `null`. */
export interface WorkOrderDelivery {
  readonly workOrderId: string;
  readonly delivery: DeliveryRecord | null;
}

/** One composed fact and its provenance — `EligibilityFact`. */
export interface EligibilityFact {
  readonly blocker: string;
  /** False means the fact was not read and the blocker is ASSUMED, not observed. */
  readonly established: boolean;
  /** The protected table or module port the fact came from. */
  readonly source: string;
}

/** A mandatory checklist item the delivery has not satisfied — `ChecklistGapRow`. */
export interface ChecklistGap {
  readonly templateItemId: string;
  readonly templateId: string;
  readonly itemCode: string;
  readonly label: string;
}

/** Which blockers may be overridden at all, and the authority each needs. */
export interface OverridableBlocker {
  readonly code: string;
  readonly permission: string;
}

/** `sal.delivery-eligibility-read` — `EligibilityView`. */
export interface DeliveryEligibility {
  readonly deliveryId: string;
  readonly workOrderId: string;
  readonly status: string;
  /** Server-derived, always. No client input reaches this decision. */
  readonly eligible: boolean;
  readonly blockers: readonly string[];
  /** Empty on a read: only a completion applies an override. */
  readonly overridden: readonly string[];
  readonly facts: readonly EligibilityFact[];
  /** A bounded sample of unsatisfied mandatory items, capped by the read at 20. */
  readonly checklistGaps: readonly ChecklistGap[];
  readonly overridable: readonly OverridableBlocker[];
  /** The version a completion would have to name. Republished on every read. */
  readonly recordVersion: number;
}

/** `AuthorizedReceiverRecordView`. The identity reference is sensitive and stays a reference. */
export interface AuthorizedReceiver {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly receiverPartnerId: string;
  /** A stored-document reference. No content is ever requested for it. */
  readonly identityEvidenceDocumentVersionId: string | null;
  readonly verifiedBy: string;
  readonly verifiedAt: string;
  readonly recordVersion: number;
}

/** `sal.delivery-receiver-read` — `DeliveryReceiverEnvelope`. `null` before verification. */
export interface DeliveryReceiverEnvelope {
  readonly deliveryId: string;
  readonly receiver: AuthorizedReceiver | null;
}

/** `DeliverySignatureRecordView`. The document reference is never dereferenced here. */
export interface DeliverySignature {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly signerRole: string;
  readonly signatureDocumentVersionId: string;
  readonly signedAt: string;
}

/** `sal.delivery-signature-list` — `DeliverySignaturesEnvelope`. */
export interface DeliverySignaturesEnvelope {
  readonly deliveryId: string;
  readonly signatures: DeliveryPage<DeliverySignature>;
}

/** `ChecklistResultRecordView` — a recorded result, with the item's own code and label. */
export interface ChecklistResult {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly templateItemId: string;
  readonly itemCode: string;
  readonly label: string;
  readonly outcome: string;
  readonly waiverReason: string | null;
  readonly recordedBy: string;
  readonly recordVersion: number;
}

/** `sal.delivery-checklist-result-list` — `DeliveryChecklistResultsEnvelope`. */
export interface DeliveryChecklistResultsEnvelope {
  readonly deliveryId: string;
  readonly results: DeliveryPage<ChecklistResult>;
}

/** One transition of the append-only delivery ledger — `DeliveryStatusHistoryEntryView`. */
export interface DeliveryStatusTransition {
  readonly id: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason: string | null;
  readonly actorId: string;
  readonly occurredAt: string;
}

/** `sal.delivery-status-history` — `DeliveryStatusHistoryEnvelope`. */
export interface DeliveryStatusHistoryEnvelope {
  readonly deliveryId: string;
  readonly transitions: DeliveryPage<DeliveryStatusTransition>;
}
