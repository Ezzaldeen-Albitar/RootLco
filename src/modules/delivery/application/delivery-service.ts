/**
 * Delivery commands (Phase 1-22, `sal.delivery-*`).
 *
 * Every method here runs inside the route handler's transaction, so the business
 * row, its status-ledger entry, its audit record and — for completion — its outbox
 * event share one commit. There is no publish-after-commit path: that is precisely
 * the window in which a crash tells nobody that a vehicle left the workshop.
 *
 * ## What the database enforces, and what this service must
 *
 * The protected `sal` schema owns more of this operation than usual, and it is worth
 * being precise about which parts:
 *
 *  - **one live delivery per work order** — `uq_delivery_records_work_order_active`;
 *  - **delivery/work-order coherence** — `sal.guard_delivery_coherence` (M-dlv-1)
 *    re-reads the work order and refuses any vehicle or visit that differs, which is
 *    why both are derived from the work-order port and never accepted from a caller;
 *  - **exactly one receiver per delivery** — `uq_authorized_receivers_delivery`;
 *  - **the receiver's authority at verification time** —
 *    `sal.guard_authorized_receiver` (M-dlv-2) requires a live
 *    `rec.reception_party_roles` row whose validity window contains `verified_at`;
 *  - **the waiver biconditional** — `ck_delivery_checklist_results_waiver`;
 *  - **the delivered shape, the custody release, and the three completion gates** —
 *    all inside `sal.complete_delivery`, under the delivery row's own lock.
 *
 * What the database does **not** enforce anywhere is the work-order state, the
 * quality-control outcome, the part obligations and — most consequentially — the
 * financial balance. `sal.complete_delivery` reads none of the four.
 * `DeliveryReadService.composeFor` is the only gate on them, this service is the only
 * caller that consults it before completing, and if either is removed the platform
 * will hand a vehicle to a customer with an unpaid issued invoice and no constraint
 * will object. The application is the only defence, and it is recomposed **inside**
 * the transaction after the row is locked so a concurrent credit note cannot open a
 * window between the decision and the handover.
 *
 * ## Nothing here reads, stores, logs or forwards signature or identity content
 *
 * Signatures and identity evidence are `shared.document_versions` REFERENCES. No
 * method fetches bytes, no audit detail carries them, no event payload mentions them
 * in the clear, and no log line names a document, a receiver or a delivery id. There
 * is deliberately no retrieval path: `DOWNLOADABLE_STATES` is `['accepted']`, no
 * application path can accept a version because no scanner is provisioned, so a
 * download method would be a contract that always fails (P1-22-L-04). **No claim is
 * made anywhere in this module that a stored signature is biometric, verified, or
 * legally binding.** It records that a document was bound to a handover, and nothing
 * more.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, sqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import { callerHoldsPermission, type ScopeAuthorizer } from '@/server/auth/authorization';
import { sharedServicesModule } from '@/modules/shared-services';
import { workOrderModule } from '@/modules/work-order';
import {
  DeliveryRuleError,
  MAX_REASON,
  assertChecklistResultShape,
  assertEligible,
  assertSignerRole,
  overridePermission,
  parseOdometerValue,
  withOverrides,
  type BlockerCode,
  type OdometerUnit,
} from '../domain/delivery';
import {
  SQLSTATE_NO_DATA_FOUND,
  type DeliveryRecordRow,
  type DeliveryRepository,
  type DeliveryScope,
  type DeliverySignatureRow,
} from '../data/delivery-repository';
import type { DeliveryReadService } from './delivery-read-service';

/** The delivery record as a caller sees it. */
export interface DeliveryView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly receptionVisitId: string;
  readonly vehicleId: string;
  readonly deliveringEmployeeId: string;
  readonly status: string;
  readonly deliveredAt: string | null;
  readonly finalOdometerReadingId: string | null;
  readonly recordVersion: number;
  /** True when an idempotent replay returned the delivery that already existed. */
  readonly replayed: boolean;
}

export interface AuthorizedReceiverView {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly receiverPartnerId: string;
  /**
   * A `shared.document_versions` REFERENCE, never content. The identity document is
   * not read, not summarised, and not returned in any form.
   */
  readonly identityEvidenceDocumentVersionId: string | null;
  readonly verifiedAt: string;
  /** The delivery's status after this call, so a caller need not re-read to see the advance. */
  readonly deliveryStatus: string;
  readonly replayed: boolean;
}

export interface ChecklistResultView {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly templateItemId: string;
  readonly itemCode: string;
  readonly outcome: string;
  readonly waiverReason: string | null;
  readonly replayed: boolean;
}

export interface SignatureView {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly signerRole: string;
  /** A reference to an immutable document version. No signature data crosses this boundary. */
  readonly signatureDocumentVersionId: string;
  readonly signedAt: string;
  readonly deliveryStatus: string;
  readonly replayed: boolean;
}

export interface CompletionView {
  readonly deliveryId: string;
  readonly status: string;
  readonly deliveredAt: string | null;
  readonly finalOdometerReadingId: string | null;
  /** Blockers an authorised caller overrode. Empty on every ordinary completion. */
  readonly overridden: readonly BlockerCode[];
  readonly recordVersion: number;
  /** True when the delivery was already `delivered`; no second event was published. */
  readonly replayed: boolean;
}

export interface CreateDeliveryInput {
  readonly workOrderId: string;
  /** `delivering_employee_id` — NOT NULL, and the DDL gives it no foreign key. */
  readonly deliveringEmployeeId: string;
  readonly idempotencyKey?: string | undefined;
}

export interface VerifyReceiverInput {
  readonly receiverPartnerId: string;
  readonly identityEvidenceDocumentVersionId?: string | undefined;
}

export interface RecordChecklistResultInput {
  readonly templateItemId: string;
  readonly outcome: string;
  readonly waiverReason?: string | undefined;
}

export interface AttachSignatureInput {
  readonly signerRole: string;
  readonly signatureDocumentVersionId: string;
}

export interface CompleteDeliveryInput {
  /** A decimal STRING for `numeric(12,1)`. Never a `number`, at any point on the path. */
  readonly finalOdometerValue: string;
  readonly odometerUnit?: OdometerUnit | undefined;
  /**
   * An explicit request to override the FINANCIAL blocker, and nothing else.
   *
   * Deliberately not a list of blocker codes. `OVERRIDABLE_BLOCKERS` contains exactly
   * one entry, and a generic list would publish an input shape in which a caller can
   * *name* `receiver_not_verified` or `checklist_incomplete` — blockers
   * `sal.complete_delivery` enforces itself, so an "override" of them would fail at
   * the database with a `check_violation` after this service had already recorded an
   * authorised override in the audit trail. A single-purpose field makes the wrong
   * request unexpressible instead of merely rejected.
   */
  readonly overrideFinancialBlocker?: { readonly reason: string } | undefined;
  /**
   * The `record_version` the caller believed the delivery was at, from `If-Match`.
   *
   * `sal.delivery-complete` is registered `versionGuarded: true`, so
   * `handleOperation` already REFUSES a request with no `If-Match` (`ERR-CON-002`)
   * and exposes the parsed value as `HandlerInput.expectedVersion`. Requiring the
   * header and never comparing it would be a guard that is present and vacuous — the
   * shape of defect that is hardest to notice, because every test that sends a
   * correct version passes either way.
   *
   * Optional here for one reason only: it is optional at the CALL SITE today. The
   * route parses the header and does not forward it, so until it does, this field is
   * `undefined` and the comparison below does not run. The fix is one argument at the
   * route, following the `additional-work` convention:
   * `async ({ db, expectedVersion, authorizeScope }) => …` and
   * `{ …, expectedVersion }` — see the report accompanying this module.
   */
  readonly expectedVersion?: number | undefined;
}

/** Version states this module accepts as a real, registered document version. */
const REFUSED_VERSION_STATES: readonly string[] = Object.freeze(['rejected', 'quarantined']);

/**
 * Translates the protected schema's refusals into the controlled error catalog.
 *
 * The SQLSTATE is the contract, not the message text. Two mappings are worth naming:
 * `23514` covers every one of `sal.guard_delivery_coherence`,
 * `sal.guard_authorized_receiver`, `ck_delivery_checklist_results_waiver`,
 * `veh.guard_odometer_reading` and the three gates inside `sal.complete_delivery` —
 * all of them mean "the database refused because the invariant would break", which is
 * `ERR-TRN-001` for a caller. And `P0002` (`no_data_found`) is
 * `sal.complete_delivery`'s own answer for a delivery it cannot see in tenant scope,
 * which is a 404 rather than a fault.
 *
 * Constraint names, trigger names and SQL fragments are never echoed to a caller.
 */
function toDomainFailure(error: unknown, what: string): never {
  if (error instanceof DeliveryRuleError) {
    throw new AppFailure('ERR-TRN-001', { message: error.message });
  }
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    throw new AppFailure('ERR-TRN-001', {
      message: `${what} was refused because it would break a delivery invariant`,
    });
  }
  if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
    throw new AppFailure('ERR-RES-001', {
      message: `${what} names a work order, visit, partner or document version that does not exist in scope`,
    });
  }
  if (isSqlState(error, SQLSTATE.uniqueViolation)) {
    throw new AppFailure('ERR-RES-002', {
      message: `${what} has already been recorded for this delivery`,
    });
  }
  if (sqlState(error) === SQLSTATE_NO_DATA_FOUND) {
    throw new AppFailure('ERR-RES-001', {
      message: `${what} addresses a delivery that is not visible in the caller's scope`,
    });
  }
  throw error;
}

/**
 * Runs a domain assertion and reports its refusal as a VALIDATION failure.
 *
 * `DeliveryRuleError` is raised by rules of two different kinds and they must not
 * share a status. `assertSignerRole`, `assertChecklistResultShape` and
 * `parseOdometerValue` refuse a malformed request — a 422 the caller fixes by sending
 * something else — while `assertEligible` refuses the current state of the world,
 * which is the 409 `toDomainFailure` produces. Routing both through one mapper would
 * tell a client to change its request when what it must change is the delivery.
 */
function validate<T>(path: string, run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof DeliveryRuleError) {
      throw new AppFailure('ERR-VAL-001', {
        message: error.message,
        safeDetails: { violations: [{ path, rule: 'custom' }] },
      });
    }
    throw error;
  }
}

const toDeliveryView = (row: DeliveryRecordRow, replayed: boolean): DeliveryView => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  workOrderId: row.workOrderId,
  receptionVisitId: row.receptionVisitId,
  vehicleId: row.vehicleId,
  deliveringEmployeeId: row.deliveringEmployeeId,
  status: row.status,
  deliveredAt: row.deliveredAt === null ? null : row.deliveredAt.toISOString(),
  finalOdometerReadingId: row.finalOdometerReadingId,
  recordVersion: row.recordVersion,
  replayed,
});

export class DeliveryService {
  public constructor(
    private readonly repository: DeliveryRepository,
    /**
     * The eligibility composition, shared with the read operation.
     *
     * Injected rather than duplicated: two implementations of "may this delivery
     * complete" would be two chances for the financial blocker to be dropped from one
     * of them, and the one that matters is the one the completion path consults. The
     * `GET .../eligibility` response and the gate applied at completion are therefore
     * the same code reading the same tables.
     */
    private readonly reads: DeliveryReadService
  ) {}

  // -------------------------------------------------------------------------
  // sal.delivery-create
  // -------------------------------------------------------------------------

  /**
   * Creates a delivery record for a work order.
   *
   * `vehicle_id` and `reception_visit_id` are **derived from the work order**, never
   * accepted from the request. That is both the correct provenance and the better
   * error: `sal.guard_delivery_coherence` re-reads the work order on INSERT and raises
   * `check_violation` unless both match, so a client-supplied value would be refused
   * anyway — as an opaque 409 from a trigger whose message this platform does not
   * echo, instead of never being asked for.
   *
   * The work order is **not** required to be complete here. A delivery record is the
   * container the checklist, the receiver and the signatures attach to during handover
   * preparation, and demanding a closed work order to create it would make the
   * preparation impossible. Completeness is a blocker at completion, which is where
   * the vehicle actually moves.
   *
   * No event is published. A prepared handover is not yet a fact any consumer can act
   * on, and `vehicle.delivered` is the only delivery event the catalog registers.
   */
  public async createDelivery(
    db: DbHandle,
    input: CreateDeliveryInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<DeliveryView> {
    // The work order is the scope authority for a delivery that does not exist yet:
    // `fk_delivery_records_work_order` is on `(tenant, company, branch, id)`, so the
    // delivery inherits exactly this pair and there is nothing else to authorize
    // against. `requireWorkOrder` performs the deferred scoped check itself, against
    // the row's own company and branch rather than an empty target.
    const workOrder = await workOrderModule().workOrders.requireWorkOrder(
      db,
      input.workOrderId,
      authorizeScope
    );
    const scope: DeliveryScope = {
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
    };

    /**
     * A replay is detected BEFORE the insert, not inferred from a `23505` afterwards.
     *
     * `uq_delivery_records_idempotency` would refuse the duplicate, but a unique
     * violation aborts the whole transaction — including the audit append — so the
     * retrying client would receive a 409 for a request that had already succeeded.
     * Resolving the key first makes a retry a success and a key reused for a
     * DIFFERENT work order a reportable conflict rather than a silent hand-back of
     * somebody else's delivery.
     */
    if (input.idempotencyKey !== undefined) {
      const existing = await this.repository.findDeliveryByIdempotencyKey(db, input.idempotencyKey);
      if (existing) {
        if (
          existing.workOrderId !== input.workOrderId ||
          existing.companyId !== scope.companyId ||
          existing.branchId !== scope.branchId
        ) {
          throw new AppFailure('ERR-INT-001', {
            message:
              'This idempotency key already created a delivery for a different work order or ' +
              'scope. Reuse a key only for an identical request.',
          });
        }
        return toDeliveryView(existing, true);
      }
    }

    // Mirrors `uq_delivery_records_work_order_active`. Checked here so the refusal is
    // a 409 the caller can act on rather than a transaction-aborting `23505`, and
    // checked again by the index so a concurrent request cannot slip past.
    const live = await this.repository.findLiveDeliveryForWorkOrder(db, scope, input.workOrderId);
    if (live) {
      throw new AppFailure('ERR-RES-002', {
        message:
          `Work order ${input.workOrderId} already has a live delivery record. Only one ` +
          'delivery may be open per work order.',
      });
    }

    let deliveryId: string;
    try {
      deliveryId = await this.repository.insertDelivery(db, {
        companyId: scope.companyId,
        branchId: scope.branchId,
        workOrderId: workOrder.id,
        // Derived, not supplied. See the method comment.
        receptionVisitId: workOrder.receptionVisitId,
        vehicleId: workOrder.vehicleId,
        deliveringEmployeeId: input.deliveringEmployeeId,
        idempotencyKey: input.idempotencyKey ?? null,
      });
    } catch (error) {
      toDomainFailure(error, 'Delivery creation');
    }

    const delivery = await this.repository.findDelivery(db, deliveryId);
    if (!delivery) {
      throw new AppFailure('ERR-SYS-001', { message: 'Delivery vanished after creation' });
    }

    /**
     * The genesis ledger row, written here because no trigger writes it.
     *
     * `wo.work_orders` has an AFTER UPDATE emitter and therefore *cannot* record its
     * own opening — the work-order module reports that as a separate `origin` block
     * rather than backfilling a row `shared.stamp_status_history` would stamp with a
     * time the order did not open at. Delivery is the opposite case: there is no
     * emitter at all, and the insert is happening now, so `now()` IS the genesis
     * moment and the ledger can be complete from its first entry. `from_status` is
     * NULL because nothing preceded `ready`.
     */
    await this.repository.appendStatusHistory(db, scope, {
      deliveryRecordId: delivery.id,
      fromStatus: null,
      toStatus: delivery.status,
      reason: null,
    });

    await appendAudit(db, {
      action: 'sal.delivery.created',
      entityType: 'sal.delivery_record',
      entityId: delivery.id,
      companyId: delivery.companyId,
      branchId: delivery.branchId,
      requestRef: 'sal.delivery-create',
      details: [
        { field: 'workOrderId', classification: 'internal', value: delivery.workOrderId },
        { field: 'vehicleId', classification: 'internal', value: delivery.vehicleId },
        {
          field: 'receptionVisitId',
          classification: 'internal',
          value: delivery.receptionVisitId,
        },
        {
          field: 'deliveringEmployeeId',
          classification: 'internal',
          value: delivery.deliveringEmployeeId,
        },
        { field: 'status', classification: 'internal', value: delivery.status },
      ],
    });

    return toDeliveryView(delivery, false);
  }

  // -------------------------------------------------------------------------
  // sal.delivery-receiver-verify
  // -------------------------------------------------------------------------

  /**
   * Records the one authorized receiver for a delivery.
   *
   * The substantive rule — that the receiver actually holds authority over this
   * vehicle — is `sal.guard_authorized_receiver` (M-dlv-2) and is deliberately NOT
   * re-implemented here: it requires a live `rec.reception_party_roles` row for the
   * delivery's visit whose `valid_from`/`valid_to` window contains `verified_at`, and
   * `rec` is another module's schema. What this method adds is a caller-safe
   * translation of that trigger's `check_violation`, because a bare 409 leaves an
   * operator with no idea that what is missing is a party role on the visit.
   *
   * `verified_at` is the column default. A caller who could choose it could choose a
   * moment at which a revoked authorisation was still valid, which would defeat the
   * only time-aware check in the whole delivery path.
   */
  public async verifyReceiver(
    db: DbHandle,
    deliveryId: string,
    input: VerifyReceiverInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<AuthorizedReceiverView> {
    // LOCKED, not merely read: this call both inserts the unique receiver row and may
    // advance the status, and an unlocked read-then-advance would let two concurrent
    // requests each believe they performed the `ready → receiver_verified` move and
    // each append a ledger row for it.
    const delivery = await this.lockForMutation(
      db,
      deliveryId,
      authorizeScope,
      'Receiver verification'
    );
    const scope: DeliveryScope = { companyId: delivery.companyId, branchId: delivery.branchId };

    const existing = await this.repository.findReceiver(db, scope, delivery.id);
    if (existing) {
      const identical =
        existing.receiverPartnerId === input.receiverPartnerId &&
        existing.identityEvidenceDocumentVersionId ===
          (input.identityEvidenceDocumentVersionId ?? null);
      if (identical) {
        return {
          id: existing.id,
          deliveryRecordId: existing.deliveryRecordId,
          receiverPartnerId: existing.receiverPartnerId,
          identityEvidenceDocumentVersionId: existing.identityEvidenceDocumentVersionId,
          verifiedAt: existing.verifiedAt.toISOString(),
          deliveryStatus: delivery.status,
          replayed: true,
        };
      }
      // A DIFFERENT receiver is refused rather than substituted, even though the
      // grant permits UPDATE. `uq_authorized_receivers_delivery` allows exactly one
      // row, so accepting a change would silently rewrite who the platform recorded
      // as having taken custody of a vehicle — and the `verified_at` the time-aware
      // guard evaluated would no longer be the one on the row. Correcting a wrong
      // receiver therefore has no path in this phase; that residual is deliberate and
      // visible rather than closed by a mutation nobody could audit.
      throw new AppFailure('ERR-RES-002', {
        message:
          `Delivery ${deliveryId} already has a verified receiver. A delivery admits exactly ` +
          'one, and it cannot be replaced.',
      });
    }

    if (input.identityEvidenceDocumentVersionId !== undefined) {
      await this.requireUsableDocumentVersion(
        db,
        delivery,
        input.identityEvidenceDocumentVersionId,
        'body.identityEvidenceDocumentVersionId'
      );
    }

    try {
      await this.repository.insertReceiver(db, scope, {
        deliveryRecordId: delivery.id,
        receiverPartnerId: input.receiverPartnerId,
        identityEvidenceDocumentVersionId: input.identityEvidenceDocumentVersionId ?? null,
      });
    } catch (error) {
      // M-dlv-2's refusal is the one `check_violation` on this path a caller can
      // actually act on, so it is named instead of being folded into the generic
      // invariant message. The trigger's own text is not forwarded.
      if (isSqlState(error, SQLSTATE.checkViolation)) {
        throw new AppFailure('ERR-TRN-001', {
          message:
            'The named receiver holds no valid reception party role for this delivery’s visit at ' +
            'the time of verification, so they may not take custody of the vehicle.',
        });
      }
      toDomainFailure(error, 'Receiver verification');
    }

    // Re-read rather than project the inserted id: `verified_at` is the column DEFAULT
    // (`now()`), and it is the exact value `sal.guard_authorized_receiver` evaluated
    // the party role's validity window against — so the caller must be told the
    // database's value, not an application guess at what `now()` was.
    const receiver = await this.repository.findReceiver(db, scope, delivery.id);
    if (!receiver) {
      throw new AppFailure('ERR-SYS-001', { message: 'Receiver vanished after verification' });
    }

    const status = await this.advanceIfLegal(db, scope, delivery, 'ready', 'receiver_verified');

    await appendAudit(db, {
      action: 'sal.delivery.receiver_verified',
      entityType: 'sal.authorized_receiver',
      entityId: receiver.id,
      companyId: delivery.companyId,
      branchId: delivery.branchId,
      requestRef: 'sal.delivery-receiver-verify',
      details: [
        { field: 'deliveryRecordId', classification: 'internal', value: delivery.id },
        // The partner is a person. `restricted` is collapsed to a fixed marker by
        // `iam.audit_mask`, so the trail records that a receiver was verified without
        // republishing who, which the gated row already holds.
        {
          field: 'receiverPartnerId',
          classification: 'restricted',
          value: receiver.receiverPartnerId,
        },
        // A REFERENCE to identity evidence is itself a way to reach identity
        // evidence, so it is classified with the evidence rather than beside it.
        {
          field: 'identityEvidenceDocumentVersionId',
          classification: 'restricted',
          value: receiver.identityEvidenceDocumentVersionId,
        },
        { field: 'deliveryStatus', classification: 'internal', value: status },
      ],
    });

    return {
      id: receiver.id,
      deliveryRecordId: receiver.deliveryRecordId,
      receiverPartnerId: receiver.receiverPartnerId,
      identityEvidenceDocumentVersionId: receiver.identityEvidenceDocumentVersionId,
      verifiedAt: receiver.verifiedAt.toISOString(),
      deliveryStatus: status,
      replayed: false,
    };
  }

  // -------------------------------------------------------------------------
  // sal.delivery-checklist-record
  // -------------------------------------------------------------------------

  /**
   * Records one checklist outcome against one template item.
   *
   * A re-record is **refused, not applied**, even though `app_runtime` holds UPDATE on
   * `sal.delivery_checklist_results`. `uq_delivery_checklist_results_item` allows one
   * row per `(delivery, item)`, so an UPDATE path would let a handover checklist be
   * rewritten after the fact — including turning a `failed` mandatory item into a
   * `waived` one — with no ledger of the change, because the table has no history
   * table behind it. Refusing keeps the record a record. An identical re-send is
   * answered as a replay, which is what a retrying client needs.
   *
   * This does not move the status machine: a checklist is filled in throughout
   * handover preparation and no `ck_delivery_records_status` value corresponds to
   * "checklist done".
   */
  public async recordChecklistResult(
    db: DbHandle,
    deliveryId: string,
    input: RecordChecklistResultInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<ChecklistResultView> {
    const waiverReason = input.waiverReason ?? null;
    // Shape first, before a lock is taken: a 422 should not queue behind a row lock.
    // `assertChecklistResultShape` is the biconditional
    // `ck_delivery_checklist_results_waiver` makes structural — a waiver without a
    // reason and a reason without a waiver are both refused.
    validate('body.outcome', () => assertChecklistResultShape(input.outcome, waiverReason));
    if (waiverReason !== null && waiverReason.length > MAX_REASON) {
      throw new AppFailure('ERR-VAL-001', {
        message: `waiver reason exceeds ${MAX_REASON} characters`,
        safeDetails: { violations: [{ path: 'body.waiverReason', rule: 'too_big' }] },
      });
    }

    const delivery = await this.lockForMutation(db, deliveryId, authorizeScope, 'Checklist record');
    const scope: DeliveryScope = { companyId: delivery.companyId, branchId: delivery.branchId };

    // The item must belong to the DELIVERY's company. `sal.delivery_checklist_*` are
    // company-scoped with no branch column, and
    // `fk_delivery_checklist_results_item (tenant, company, template_item)` would
    // refuse a foreign company's item as `23503` — a 404 stated here is the same
    // answer without an aborted transaction.
    const item = await this.repository.findTemplateItem(db, scope.companyId, input.templateItemId);
    if (!item) {
      throw new AppFailure('ERR-RES-001', {
        message: `Checklist item ${input.templateItemId} does not exist in this delivery's company`,
      });
    }

    const existing = await this.repository.findChecklistResult(db, scope, delivery.id, item.id);
    if (existing) {
      if (existing.outcome === input.outcome && existing.waiverReason === waiverReason) {
        return {
          id: existing.id,
          deliveryRecordId: existing.deliveryRecordId,
          templateItemId: existing.templateItemId,
          itemCode: item.itemCode,
          outcome: existing.outcome,
          waiverReason: existing.waiverReason,
          replayed: true,
        };
      }
      throw new AppFailure('ERR-INT-001', {
        message:
          `Checklist item ${item.itemCode} already has a recorded outcome for this delivery, and ` +
          'a recorded outcome is final. Send the identical request to retry, or record the ' +
          'divergence as a delivery exception.',
      });
    }

    let resultId: string;
    try {
      resultId = await this.repository.insertChecklistResult(db, scope, {
        deliveryRecordId: delivery.id,
        templateItemId: item.id,
        outcome: input.outcome,
        waiverReason,
      });
    } catch (error) {
      toDomainFailure(error, 'Checklist record');
    }

    await appendAudit(db, {
      action: 'sal.delivery.checklist_recorded',
      entityType: 'sal.delivery_checklist_result',
      entityId: resultId,
      companyId: delivery.companyId,
      branchId: delivery.branchId,
      requestRef: 'sal.delivery-checklist-record',
      details: [
        { field: 'deliveryRecordId', classification: 'internal', value: delivery.id },
        { field: 'templateItemId', classification: 'internal', value: item.id },
        { field: 'itemCode', classification: 'internal', value: item.itemCode },
        { field: 'isMandatory', classification: 'internal', value: String(item.isMandatory) },
        { field: 'outcome', classification: 'internal', value: input.outcome },
        { field: 'waiverReason', classification: 'internal', value: waiverReason },
      ],
    });

    return {
      id: resultId,
      deliveryRecordId: delivery.id,
      templateItemId: item.id,
      itemCode: item.itemCode,
      outcome: input.outcome,
      waiverReason,
      replayed: false,
    };
  }

  // -------------------------------------------------------------------------
  // sal.delivery-signature-attach
  // -------------------------------------------------------------------------

  /**
   * Binds a document version to the handover as a signature of a named role.
   *
   * The row records that a specific immutable `shared.document_versions` row was
   * bound to this delivery by this actor at this time. **It asserts nothing about the
   * document's content**: no bytes are read here, no signature is verified, nothing is
   * compared against a specimen, and no legal effect is claimed. The version's
   * `sha256` anchors what was bound, and that is the extent of the guarantee.
   *
   * `sal.delivery_signatures` has no unique constraint on `(delivery, role)` on
   * purpose — its own table comment says corrections are made by appending — so a
   * second signature for the same role with a different document is a legitimate
   * correction, and only an identical `(delivery, role, version)` triple is treated as
   * a retry.
   */
  public async attachSignature(
    db: DbHandle,
    deliveryId: string,
    input: AttachSignatureInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<SignatureView> {
    validate('body.signerRole', () => assertSignerRole(input.signerRole));

    const delivery = await this.lockForMutation(db, deliveryId, authorizeScope, 'Signature');
    const scope: DeliveryScope = { companyId: delivery.companyId, branchId: delivery.branchId };

    await this.requireUsableDocumentVersion(
      db,
      delivery,
      input.signatureDocumentVersionId,
      'body.signatureDocumentVersionId'
    );

    const existing = await this.repository.findSignature(db, scope, {
      deliveryRecordId: delivery.id,
      signerRole: input.signerRole,
      signatureDocumentVersionId: input.signatureDocumentVersionId,
    });
    if (existing) {
      return {
        id: existing.id,
        deliveryRecordId: existing.deliveryRecordId,
        signerRole: existing.signerRole,
        signatureDocumentVersionId: existing.signatureDocumentVersionId,
        signedAt: existing.signedAt.toISOString(),
        deliveryStatus: delivery.status,
        replayed: true,
      };
    }

    let signature: DeliverySignatureRow;
    try {
      signature = await this.repository.insertSignature(db, scope, {
        deliveryRecordId: delivery.id,
        signerRole: input.signerRole,
        signatureDocumentVersionId: input.signatureDocumentVersionId,
      });
    } catch (error) {
      toDomainFailure(error, 'Signature');
    }

    // `receiver_verified → signed` only. A signature recorded while the delivery is
    // still `ready` is stored but does not advance the status: calling a handover
    // `signed` before anyone verified who is receiving the vehicle would skip the one
    // step that establishes authority, and `ck_delivery_records_status` gives no state
    // for "signed but unverified". The signature is not lost — `sal.complete_delivery`
    // counts it — and verifying the receiver afterwards moves the record to
    // `receiver_verified`, from which a further signature advances it.
    const status = await this.advanceIfLegal(db, scope, delivery, 'receiver_verified', 'signed');

    await appendAudit(db, {
      action: 'sal.delivery.signature_recorded',
      entityType: 'sal.delivery_signature',
      entityId: signature.id,
      companyId: delivery.companyId,
      branchId: delivery.branchId,
      requestRef: 'sal.delivery-signature-attach',
      details: [
        { field: 'deliveryRecordId', classification: 'internal', value: delivery.id },
        { field: 'signerRole', classification: 'internal', value: signature.signerRole },
        // A reference, never content — and classified `restricted` because possessing
        // the reference is how signature evidence is reached. `iam.audit_mask`
        // collapses it to a marker, so the trail proves a signature was bound while
        // the gated row remains the only place the pointer lives.
        {
          field: 'signatureDocumentVersionId',
          classification: 'restricted',
          value: signature.signatureDocumentVersionId,
        },
        { field: 'deliveryStatus', classification: 'internal', value: status },
      ],
    });

    return {
      id: signature.id,
      deliveryRecordId: signature.deliveryRecordId,
      signerRole: signature.signerRole,
      signatureDocumentVersionId: signature.signatureDocumentVersionId,
      signedAt: signature.signedAt.toISOString(),
      deliveryStatus: status,
      replayed: false,
    };
  }

  // -------------------------------------------------------------------------
  // sal.delivery-complete
  // -------------------------------------------------------------------------

  /**
   * Completes the handover: captures the final odometer, releases custody, and
   * publishes `vehicle.delivered`.
   *
   * The sequence is deliberate and each step depends on the one before it:
   *
   *  1. **Lock** the delivery row. `sal.complete_delivery` takes the same lock in the
   *     same tenant scope as its first statement, so this is the same lock in the same
   *     order and cannot deadlock against it.
   *  2. **Replay check.** An already-`delivered` record returns immediately with no
   *     audit record and no event. This is what makes the operation idempotent at the
   *     application level: the primitive is idempotent too, but it returns the
   *     existing odometer id indistinguishably from a fresh completion, and a caller
   *     retrying a timed-out request must not cause a second `vehicle.delivered` to
   *     reach every consumer.
   *  3. **Recompose eligibility inside the lock.** The blocker set is derived here and
   *     now — not read from the request, and not carried over from an earlier
   *     `GET .../eligibility` — because an approved credit note or a part issue
   *     between the two would otherwise open exactly the window this gate exists to
   *     close.
   *  4. **Authorize the override, against the database.** Only
   *     `financial_balance_outstanding` is overridable, only with
   *     `sal.delivery.complete`, and the permission is evaluated by
   *     `iam.has_permission_in_scope` in this transaction against the delivery's own
   *     company and branch — not inferred from the route's declaration, which the
   *     pre-handler check may have satisfied scope-blind.
   *  5. **`assertEligible`**, then the primitive, then exactly one audit record and
   *     exactly one event.
   */
  public async completeDelivery(
    db: DbHandle,
    deliveryId: string,
    input: CompleteDeliveryInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<CompletionView> {
    // `numeric(12,1)` with `CHECK (value >= 0)`. Parsed as an exact decimal STRING and
    // passed on as one: it is bound to `$2::numeric` and never becomes a `number`,
    // because a rounded odometer reading is a wrong fact about a vehicle that a
    // warranty term may later be measured against.
    const odometerValue = validate('body.finalOdometerValue', () =>
      parseOdometerValue(input.finalOdometerValue)
    );
    const unit: OdometerUnit = input.odometerUnit ?? 'km';
    const overrideReason = input.overrideFinancialBlocker?.reason;
    if (
      overrideReason !== undefined &&
      (overrideReason.trim() === '' || overrideReason.length > MAX_REASON)
    ) {
      throw new AppFailure('ERR-VAL-001', {
        message: `override reason must be 1–${MAX_REASON} characters`,
        safeDetails: {
          violations: [{ path: 'body.overrideFinancialBlocker.reason', rule: 'custom' }],
        },
      });
    }

    const locked = await this.repository.lockDelivery(db, deliveryId);
    if (!locked) {
      throw new AppFailure('ERR-RES-001', {
        message: `Delivery ${deliveryId} is not visible in the caller's scope`,
      });
    }
    await authorizeScope({ companyId: locked.companyId, branchId: locked.branchId });

    // The optimistic-concurrency check, made against the LOCKED row and before any
    // state logic — the same order `AdditionalWorkService.withdraw` uses. A caller
    // acting on a stale view of a handover must be told, not silently applied to a
    // record that has moved on. Skipped while `expectedVersion` is undefined, which is
    // a property of the call site rather than of this rule; see the field's comment.
    if (input.expectedVersion !== undefined && locked.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: `Delivery ${deliveryId} was modified by another request; re-read and retry`,
      });
    }

    // The replay path. No audit, no event, no second custody release: the handover
    // already happened and saying so twice would be a lie in the trail and a
    // duplicate fact for every consumer.
    if (locked.status === 'delivered') {
      return {
        deliveryId: locked.id,
        status: locked.status,
        deliveredAt: locked.deliveredAt === null ? null : locked.deliveredAt.toISOString(),
        finalOdometerReadingId: locked.finalOdometerReadingId,
        overridden: [],
        recordVersion: locked.recordVersion,
        replayed: true,
      };
    }

    const composed = await this.reads.composeFor(db, locked);
    let decision = composed.decision;

    if (overrideReason !== undefined) {
      const permission = overridePermission('financial_balance_outstanding');
      /* c8 ignore next 5 -- unreachable while OVERRIDABLE_BLOCKERS declares the
         financial blocker; retained so removing that entry fails closed rather than
         granting an unauthorised override. */
      if (permission === null) {
        throw new AppFailure('ERR-TRN-001', {
          message: 'The financial blocker is not overridable in this deployment.',
        });
      }
      // Asked of the database, in this transaction, against the delivery's own scope.
      // The route's pre-handler check cannot substitute for this: with no target it
      // degrades to scope-blind `iam.has_permission`, so an actor granted
      // `sal.delivery.complete` in one branch would otherwise be able to override the
      // balance gate in every branch they can see (P1-18-A-01).
      const held = await callerHoldsPermission(db, permission, {
        companyId: locked.companyId,
        branchId: locked.branchId,
      });
      if (!held) {
        throw new AppFailure('ERR-IAM-001', {
          message: `Denied override of financial_balance_outstanding: missing ${permission}`,
          safeDetails: { requiredPermissions: [permission] },
        });
      }
      // `withOverrides` applies only blockers that are both overridable and
      // authorised, so an override requested when no balance is outstanding is a
      // no-op rather than a recorded exercise of authority.
      decision = withOverrides(decision, ['financial_balance_outstanding']);
    }

    if (
      !decision.eligible &&
      decision.blockers.includes('checklist_incomplete') &&
      composed.checklistGaps.length > 0
    ) {
      // Naming the items is worth its own refusal: `checklist_incomplete` alone sends
      // an operator hunting through a mandatory template, and the primitive's own scan
      // is COMPANY-scoped rather than template-scoped — the opposite of what a reader
      // expects — so an item from a template this delivery never used can be the thing
      // blocking it. The sample is `LIMIT`-bounded by the repository.
      throw new AppFailure('ERR-TRN-001', {
        message:
          `delivery is blocked: ${decision.blockers.join(', ')}; unsatisfied mandatory ` +
          `checklist item(s): ${composed.checklistGaps.map((gap) => gap.itemCode).join(', ')}`,
      });
    }
    try {
      assertEligible(decision);
    } catch (error) {
      toDomainFailure(error, 'Delivery completion');
    }

    try {
      await this.repository.completeDelivery(db, {
        deliveryId: locked.id,
        finalOdometerValue: odometerValue.toString(),
        odometerUnit: unit,
      });
    } catch (error) {
      // `uq_custody_history_released` is the exactly-once backstop on the custody
      // release (C1). A `23505` here means custody for this visit was already
      // released — by another delivery, or by a raw `rec` write — which is a state
      // conflict rather than a duplicate request, and generic "already recorded"
      // would send the caller looking for a delivery that does not exist.
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-TRN-001', {
          message:
            'Custody for this reception visit has already been released, so this delivery ' +
            'cannot release it again.',
        });
      }
      toDomainFailure(error, 'Delivery completion');
    }

    const delivered = await this.repository.findDelivery(db, locked.id);
    if (!delivered) {
      throw new AppFailure('ERR-SYS-001', { message: 'Delivery vanished after completion' });
    }

    await appendAudit(db, {
      action: 'sal.delivery.completed',
      entityType: 'sal.delivery_record',
      entityId: delivered.id,
      companyId: delivered.companyId,
      branchId: delivered.branchId,
      requestRef: 'sal.delivery-complete',
      details: [
        { field: 'workOrderId', classification: 'internal', value: delivered.workOrderId },
        { field: 'vehicleId', classification: 'internal', value: delivered.vehicleId },
        {
          field: 'status',
          classification: 'internal',
          previousValue: locked.status,
          value: delivered.status,
        },
        {
          field: 'finalOdometerReadingId',
          classification: 'internal',
          value: delivered.finalOdometerReadingId,
        },
        // The exercised authority, recorded whether or not it was used: an empty list
        // is the evidence that this handover cleared every gate on its own.
        {
          field: 'overriddenBlockers',
          classification: 'internal',
          value: decision.overridden.length === 0 ? null : decision.overridden.join(','),
        },
        {
          field: 'overrideReason',
          classification: 'internal',
          value: decision.overridden.length === 0 ? null : (overrideReason ?? null),
        },
      ],
    });

    await publishEvent(db, {
      eventType: 'vehicle.delivered',
      aggregateId: delivered.id,
      // The post-completion version. `shared.touch_row_metadata` advanced it by one on
      // the flip to `delivered`, so a consumer can order this event against a later
      // read of the same row.
      aggregateVersion: delivered.recordVersion,
      producer: 'delivery.delivery-service',
      companyId: delivered.companyId,
      branchId: delivered.branchId,
      // The delivery id keys the event, so even if two callers raced past the row lock
      // the second would be refused by `uq_event_outbox_event_key` rather than
      // telling every consumer the vehicle was handed over twice.
      eventKey: `vehicle.delivered:${delivered.id}`,
      payload: {
        deliveryRecordId: delivered.id,
        workOrderId: delivered.workOrderId,
        receptionVisitId: delivered.receptionVisitId,
        vehicleId: delivered.vehicleId,
        deliveredAt: delivered.deliveredAt === null ? null : delivered.deliveredAt.toISOString(),
        finalOdometerReadingId: delivered.finalOdometerReadingId,
        // Blocker CODES only. No amount, no invoice number, no receiver, no signature
        // or identity reference, and no odometer value: a consumer that may see any of
        // those reads the aggregate under its own authorization.
        overriddenBlockers: decision.overridden,
      },
    });

    return {
      deliveryId: delivered.id,
      status: delivered.status,
      deliveredAt: delivered.deliveredAt === null ? null : delivered.deliveredAt.toISOString(),
      finalOdometerReadingId: delivered.finalOdometerReadingId,
      overridden: decision.overridden,
      recordVersion: delivered.recordVersion,
      replayed: false,
    };
  }

  // -------------------------------------------------------------------------
  // Shared internals
  // -------------------------------------------------------------------------

  /**
   * Locks the delivery, authorizes against its own scope, and refuses a terminal one.
   *
   * `authorizeScope` is called with BOTH ids and only after the row is read, because
   * `requireScopedPermissions` fails closed on an empty target and a delivery
   * addressed by id has no scope to name until it has been read. `exception` and
   * `delivered` are refused for every subresource write: an exception is terminal for
   * this purpose per the domain rules, and a delivered handover is history — a
   * receiver, checklist result or signature appended afterwards would describe a
   * custody transfer that had already completed.
   */
  private async lockForMutation(
    db: DbHandle,
    deliveryId: string,
    authorizeScope: ScopeAuthorizer,
    what: string
  ): Promise<DeliveryRecordRow> {
    const delivery = await this.repository.lockDelivery(db, deliveryId);
    if (!delivery) {
      throw new AppFailure('ERR-RES-001', {
        message: `Delivery ${deliveryId} is not visible in the caller's scope`,
      });
    }
    await authorizeScope({ companyId: delivery.companyId, branchId: delivery.branchId });

    if (delivery.status === 'exception') {
      throw new AppFailure('ERR-TRN-001', {
        message: `${what} is not permitted on a delivery in the terminal "exception" state.`,
      });
    }
    if (delivery.status === 'delivered') {
      throw new AppFailure('ERR-TRN-001', {
        message: `${what} is not permitted: this delivery has already been completed.`,
      });
    }
    return delivery;
  }

  /**
   * Advances the status when the row is in `fromStatus`, and returns the status that
   * resulted.
   *
   * A row that is not in `fromStatus` is left alone and its current status is
   * returned, because these two advances are consequences of recording a receiver or a
   * signature rather than commands of their own: a second signature must not move a
   * `signed` delivery anywhere, and it must not be refused either. The compare-and-set
   * lives in the UPDATE's WHERE clause, so a lost race writes no ledger row rather
   * than a duplicate one.
   */
  private async advanceIfLegal(
    db: DbHandle,
    scope: DeliveryScope,
    delivery: DeliveryRecordRow,
    fromStatus: string,
    toStatus: string
  ): Promise<string> {
    if (delivery.status !== fromStatus) return delivery.status;

    const moved = await this.repository.advanceStatus(db, scope, delivery.id, fromStatus, toStatus);
    if (!moved) {
      // Somebody else moved the row between the lock and here, which under the row
      // lock should be impossible — reported rather than retried, and the ledger stays
      // silent because nothing moved on this transaction's account.
      const current = await this.repository.findDelivery(db, delivery.id);
      return current?.status ?? delivery.status;
    }
    await this.repository.appendStatusHistory(db, scope, {
      deliveryRecordId: delivery.id,
      fromStatus,
      toStatus,
      reason: null,
    });
    return toStatus;
  }

  /**
   * Refuses a document version that is not a usable, in-scope, registered version.
   *
   * Ownership is established through `@/modules/shared-services` rather than by
   * reading `shared.document_versions` here, because that table belongs to that
   * module and a second reader would be a second definition of what a valid
   * attachment is. Three checks are made on what it returns:
   *
   *  1. **Tenant** — `verifyEvidenceVersion` resolves the version under RLS and
   *     raises `ERR-RES-001` when it is not visible, so a cross-tenant reference
   *     cannot be bound. That refusal is passed through unchanged.
   *  2. **Company and branch** — refused when the version names a company or branch
   *     other than the delivery's. A version with both NULL is tenant-wide and
   *     accepted, matching how the quotation-evidence path reads the same fields.
   *  3. **State** — `rejected` and `quarantined` are refused with `ERR-DOC-001`, the
   *     code for a version that exists and is visible but whose state does not permit
   *     the action.
   *
   * `accepted` is deliberately NOT required, and the reason is structural rather than
   * lax: `shared.guard_document_version_transition` needs a clean scan record to reach
   * `accepted`, no scanner is provisioned anywhere in the platform, and no application
   * path can therefore accept a version (P1-22-L-04). Requiring it would make every
   * signature and every identity attachment impossible while appearing to be the
   * stricter choice. `sal.delivery_signatures`' own foreign key accepts any status, so
   * this rule — registered, in scope, not refused — is the whole of the application's
   * contribution, and it is stated rather than implied.
   *
   * `linkedToEntity` is intentionally not required. `sal.delivery_records` is not in
   * `LINKABLE_ENTITY_TYPES`, and the binding between a delivery and its evidence is
   * the foreign key on `sal.authorized_receivers` / `sal.delivery_signatures` — not a
   * `shared.document_links` row — so demanding a link would refuse every legitimate
   * call.
   */
  private async requireUsableDocumentVersion(
    db: DbHandle,
    delivery: DeliveryRecordRow,
    versionId: string,
    path: string
  ): Promise<void> {
    const version = await sharedServicesModule().attachments.verifyEvidenceVersion(
      db,
      versionId,
      'sal.delivery_records',
      delivery.id
    );

    if (
      (version.companyId !== null && version.companyId !== delivery.companyId) ||
      (version.branchId !== null && version.branchId !== delivery.branchId)
    ) {
      throw new AppFailure('ERR-VAL-001', {
        message:
          'The document version belongs to a different company or branch than this delivery.',
        safeDetails: { violations: [{ path, rule: 'custom' }] },
      });
    }
    if (REFUSED_VERSION_STATES.includes(version.status)) {
      throw new AppFailure('ERR-DOC-001', {
        message: 'The document version was refused by review or quarantine and cannot be bound.',
      });
    }
  }
}
