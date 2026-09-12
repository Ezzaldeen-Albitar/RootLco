/**
 * Delivery eligibility composition and cross-module reads (Phase 1-22).
 *
 * ## This file is the financial gate on vehicle handover
 *
 * `sal.complete_delivery` enforces three preconditions and no others: a verified
 * authorized receiver row, no unsatisfied mandatory checklist item, and at least one
 * signature. It reads **no work-order state, no quality-control outcome and no
 * financial balance at all** — verified against the deployed function body in
 * `supabase/migrations/20260724094000_sal_delivery.sql`. There is no trigger, CHECK
 * constraint or foreign key anywhere in `sal` that refuses a handover against an
 * unpaid issued invoice.
 *
 * So five of the eight `BLOCKER_CODES` exist only because this file composes them,
 * and if this composition is deleted the database will release a vehicle to a
 * customer who has not paid, whose work order is still open, and whose quality
 * control failed, without complaint. **The application is the only defence.** That is
 * why every fact below reports whether it could be *established*, and why an
 * unestablished fact counts as a blocker PRESENT rather than absent.
 *
 * `delivery_state_invalid` is one of the five, which is easy to miss. The primitive
 * short-circuits on `status = 'delivered'` and has **no** predicate on `'exception'`,
 * so it would complete a delivery that had been marked as an exception. Nothing in the
 * DDL refuses that either — `ck_delivery_records_status` merely lists the value.
 *
 * ## Where each fact comes from
 *
 * | Blocker                          | Source                                                                        |
 * | -------------------------------- | ----------------------------------------------------------------------------- |
 * | `delivery_state_invalid`         | this module's own `sal.delivery_records.status`                               |
 * | `work_order_not_complete`        | `@/modules/work-order` — the row's state, resolved against the live catalog   |
 * | `quality_control_not_passed`     | `@/modules/quality` — `gate.evaluate`, i.e. closure blockers B5a/B5b/B6       |
 * | `financial_balance_outstanding`  | `@/modules/billing` — `openReceivableForWorkOrder`                            |
 * | `part_obligation_outstanding`    | `@/modules/inventory` — `reads.openCommitmentsFor`                            |
 * | `checklist_incomplete`           | this module's `mandatoryChecklistGaps`, transcribed from the primitive's gate  |
 * | `receiver_not_verified`          | this module's `sal.authorized_receivers`, same predicate as the gate           |
 * | `signature_missing`              | this module's `sal.delivery_signatures`, same predicate as the gate            |
 *
 * No fact is read from a schema this module does not own. Nothing is read from a
 * request body: `composeEligibility` has no parameter through which a client could
 * assert eligibility, and this service passes it none.
 */
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { billingModule } from '@/modules/billing';
import { inventoryModule } from '@/modules/inventory';
import { qualityModule } from '@/modules/quality';
import { workOrderModule } from '@/modules/work-order';
import { Decimal, MONEY } from '@/modules/pricing';
import {
  OVERRIDABLE_BLOCKERS,
  composeEligibility,
  type BlockerCode,
  type EligibilityDecision,
} from '../domain/delivery';
import { pageRequest, type Page, type PageRequest } from '@/server/db/pagination';
import {
  CHECKLIST_RESULT_ORDER,
  DELIVERY_RECORD_ORDER,
  SIGNATURE_ORDER,
  STATUS_HISTORY_ORDER,
} from '../data/delivery-repository';
import type {
  ChecklistGapRow,
  DeliveryRecordRow,
  DeliveryRepository,
  DeliveryScope,
} from '../data/delivery-repository';

/**
 * One composed fact, with its provenance and whether it could be established.
 *
 * `established: false` is the interesting case and the reason this shape exists: a
 * blocker raised because a fact is UNKNOWN is operationally different from one raised
 * because the fact is known and bad. An operator seeing
 * `financial_balance_outstanding` with `established: false` must go and fix the
 * platform, not chase the customer for money — and without this field the two are
 * indistinguishable, which is how a fail-closed default turns into a silent outage.
 */
export interface EligibilityFact {
  readonly blocker: BlockerCode;
  /** True when the underlying fact was actually read. False means "assumed blocking". */
  readonly established: boolean;
  /** The protected table or public port the fact came from. */
  readonly source: string;
}

/** What `readEligibility` returns. */
export interface EligibilityView {
  readonly deliveryId: string;
  readonly workOrderId: string;
  readonly status: string;
  /** Server-derived, always. Never read from, and never influenced by, client input. */
  readonly eligible: boolean;
  readonly blockers: readonly BlockerCode[];
  /** Empty here: a read never applies an override. `completeDelivery` does that. */
  readonly overridden: readonly BlockerCode[];
  readonly facts: readonly EligibilityFact[];
  /** Bounded sample of unsatisfied mandatory items, so `checklist_incomplete` is actionable. */
  readonly checklistGaps: readonly ChecklistGapRow[];
  /** Which blockers may be overridden at all, and the permission each needs. */
  readonly overridable: readonly { readonly code: BlockerCode; readonly permission: string }[];
  /**
   * The delivery's current optimistic-concurrency counter, published so that
   * `sal.delivery-complete` is REACHABLE.
   *
   * That operation is `versionGuarded`, so `handleOperation` requires an `If-Match`
   * whose value `parseIfMatch` accepts only as an exact positive integer — there is no
   * `*` wildcard. Meanwhile `tg_delivery_records_touch_metadata` bumps
   * `record_version` on every `advanceStatus`, so the receiver-verify and
   * signature-attach steps each raise it. Without this field the only version a client
   * ever saw was the `1` in the create response, and by the time a delivery was
   * completable that value was stale — the guard answered 409 and named nothing to
   * re-read. This read IS the re-read.
   */
  readonly recordVersion: number;
}

/**
 * The subset of the composition that a work order carries on its own (P1-31 D-3).
 *
 * Returned by `composeWorkOrderFacts` and consumed by the readiness queue, which
 * must answer for work orders that have NO delivery record — so it can carry only
 * the four facts keyed on `workOrderId`, never the four keyed on a delivery id.
 * `clear` is the four-fact verdict and is deliberately NOT called `eligible`: a
 * handover is decided by `composeEligibility` over all eight, and a name that
 * suggested otherwise is how the delivery-bound half gets skipped.
 */
export interface WorkOrderEligibilityFacts {
  readonly facts: readonly EligibilityFact[];
  /** The blockers those four facts raise, in `BLOCKER_CODES` order. */
  readonly blockers: readonly BlockerCode[];
  /** Every one of the four established AND raising no blocker. */
  readonly clear: boolean;
}

/** The composition plus the evidence behind it, shared with the write path. */
export interface ComposedEligibility {
  readonly decision: EligibilityDecision;
  readonly facts: readonly EligibilityFact[];
  readonly checklistGaps: readonly ChecklistGapRow[];
}

/**
 * The delivery record itself (P1-31 P-3).
 *
 * Every timestamp crosses the wire as an ISO-8601 string, matching
 * `DeliveryForWarranty` below rather than emitting a `Date` the serialiser would
 * render differently.
 *
 * **There is no money on this projection and none is omitted.** A delivery record
 * carries no amount column of any kind: `finalOdometerReadingId` is a reference to a
 * `veh.odometer_readings` row and NOT an odometer value, so the decimal-string rule
 * has nothing to apply to here. The reading's value is read through the vehicle
 * odometer-history operation, which is where that `numeric(12,1)` already crosses
 * as a string.
 *
 * `deliveringEmployeeId` is an `org.employees` id, and the name beside it is the
 * SNAPSHOT the database stamped when the handover was recorded — not a lookup
 * performed here. That distinction is the whole of P1-31 prerequisite P-17: the
 * column carried NO foreign key until then, nothing in the platform resolved it
 * to a person, and the unlabelled register row in
 * `docs/product/owner-workflow-requirements.md` behind Owner requirement
 * OWR-2026-09-06-G-10 recorded exactly that gap. The Owner decision of
 * 2026-09-10 closed it. This read still performs no join and invents no
 * identity: it publishes the id the row holds and the name the row holds —
 * including `null`, which is what a handover recorded before P-17 carries when
 * its delivering employee id resolved to nobody.
 */
export interface DeliveryRecordView {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly receptionVisitId: string;
  readonly vehicleId: string;
  readonly deliveringEmployeeId: string;
  /**
   * The stamped snapshot, not a resolved name. Immutable once written, and
   * `null` on a pre-P-17 handover whose delivering identity was never resolved
   * — the one thing this read will not do is invent a name for it.
   */
  readonly deliveringEmployeeDisplayName: string | null;
  readonly status: string;
  readonly deliveredAt: string | null;
  /** A `veh.odometer_readings` id. NOT a reading value. */
  readonly finalOdometerReadingId: string | null;
  /** The value `sal.delivery-complete`'s mandatory `If-Match` takes. */
  readonly recordVersion: number;
}

/**
 * The live delivery a work order has, or the fact that it has none (P1-31 P-2).
 *
 * Shaped on `WorkOrderInvoiceView`, the read this one is modelled after, for the
 * same reason: absence is a 200 with `delivery: null`, and a work order the caller
 * cannot see is `ERR-RES-001`. Collapsing those two would answer "no delivery" for a
 * work order in a branch the caller cannot see — an existence oracle disguised as an
 * empty result.
 */
export interface WorkOrderDeliveryView {
  readonly workOrderId: string;
  readonly delivery: DeliveryRecordView | null;
}

/**
 * The verified receiver of a delivery, as a ROW (P1-31 P-4).
 *
 * Until now this row existed on the read side only as the boolean
 * `receiver_not_verified` blocker, so a screen could learn *whether* a receiver was
 * verified and never *who*.
 *
 * `identityEvidenceDocumentVersionId` is a REFERENCE and nothing more. No identity
 * document content is read, stored, logged or returned by this module, and the whole
 * row is gated by `sal.delivery.view` in `sel_authorized_receivers_gated` — which is
 * precisely why the reference alone is treated as sensitive.
 */
export interface AuthorizedReceiverRecordView {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly receiverPartnerId: string;
  readonly identityEvidenceDocumentVersionId: string | null;
  readonly verifiedBy: string;
  readonly verifiedAt: string;
  readonly recordVersion: number;
}

/** A delivery's checklist result, as recorded (P1-31 P-4). */
export interface ChecklistResultRecordView {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly templateItemId: string;
  /** The template item code, as the write path already returns it. */
  readonly itemCode: string;
  /** The item label, so a result is renderable while the template has no surface. */
  readonly label: string;
  readonly outcome: string;
  readonly waiverReason: string | null;
  readonly recordedBy: string;
  readonly recordVersion: number;
}

/**
 * A delivery signature (P1-31 P-4).
 *
 * `signatureDocumentVersionId` is a reference to a `shared.document_versions` row
 * and **raw signature bytes never appear here**. Nor is a download offered by this
 * module, which is a scope boundary rather than an impossibility: the shared
 * attachment path's `requestDownload` refuses a version with `ERR-DOC-001` while it is
 * not `accepted` — a state check. P1-22 recorded the rest as "no application path can
 * produce acceptance" (`P1-22-L-04`); that is no longer the rule, because
 * `20260815090000_shared_reception_evidence_foundation.sql` adds `GRANT INSERT ON
 * shared.file_scan_results` and `GRANT UPDATE(status) ON shared.document_versions`.
 * Corrected by P1-31 prerequisite P-14.
 */
export interface DeliverySignatureRecordView {
  readonly id: string;
  readonly deliveryRecordId: string;
  readonly signerRole: string;
  readonly signatureDocumentVersionId: string;
  readonly signedAt: string;
}

/** One transition of the append-only delivery ledger (P1-31 P-5). */
export interface DeliveryStatusHistoryEntryView {
  readonly id: string;
  readonly fromStatus: string | null;
  readonly toStatus: string;
  readonly reason: string | null;
  readonly actorId: string;
  readonly occurredAt: string;
}

/**
 * The four envelopes the subresource reads answer with.
 *
 * Named and exported rather than written inline at the return type, because
 * `scripts/ci/check-named-wire-shapes.mjs` refuses an anonymous type on the wire:
 * an unnamed shape cannot be referenced by a contract document, a frontend adapter
 * or a review, so it is a wire contract nobody can cite.
 *
 * Each carries `deliveryId` beside its payload so a response is self-identifying
 * when it is cached, logged or composed into a delivery document, and so `null` or
 * an empty page is never a bare answer with no subject.
 */
export interface DeliveryReceiverEnvelope {
  readonly deliveryId: string;
  /** `null` before verification — the normal state of a fresh delivery, not a refusal. */
  readonly receiver: AuthorizedReceiverRecordView | null;
}

export interface DeliveryChecklistResultsEnvelope {
  readonly deliveryId: string;
  readonly results: Page<ChecklistResultRecordView>;
}

export interface DeliverySignaturesEnvelope {
  readonly deliveryId: string;
  readonly signatures: Page<DeliverySignatureRecordView>;
}

export interface DeliveryStatusHistoryEnvelope {
  readonly deliveryId: string;
  readonly transitions: Page<DeliveryStatusHistoryEntryView>;
}

/** The delivery projection the `warranty` module is allowed to see. */
export interface DeliveryForWarranty {
  readonly id: string;
  readonly status: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly workOrderId: string;
  readonly vehicleId: string;
  readonly deliveredAt: string | null;
  readonly finalOdometerReadingId: string | null;
}

/**
 * `DeliveryRecordRow` → `DeliveryView`. ONE mapper for this row shape.
 *
 * `readDelivery` and `readWorkOrderDelivery` both go through it, so the delivery a
 * screen reads by id and the delivery it reaches through a work order are the same
 * wire contract rather than two that can drift.
 */
export const toDeliveryView = (row: DeliveryRecordRow): DeliveryRecordView => ({
  id: row.id,
  companyId: row.companyId,
  branchId: row.branchId,
  workOrderId: row.workOrderId,
  receptionVisitId: row.receptionVisitId,
  vehicleId: row.vehicleId,
  deliveringEmployeeId: row.deliveringEmployeeId,
  deliveringEmployeeDisplayName: row.deliveringEmployeeDisplayName,
  status: row.status,
  deliveredAt: row.deliveredAt === null ? null : row.deliveredAt.toISOString(),
  finalOdometerReadingId: row.finalOdometerReadingId,
  recordVersion: row.recordVersion,
});

export class DeliveryReadService {
  public constructor(private readonly repository: DeliveryRepository) {}

  /**
   * The delivery, or the uniform 404 that does not distinguish absent from
   * out-of-scope, re-authorized against the row's own company and branch.
   *
   * `authorizeScope` is called AFTER the row is read, with BOTH ids, because
   * `requireScopedPermissions` fails closed on an empty target and a delivery
   * addressed only by id has no scope to name until it has been read. RLS visibility
   * is not authority: `app.branch_ids` is the permission-blind union of every active
   * grant, so a caller can *see* a delivery in a branch where they hold no
   * `sal.delivery.manage` (P1-18-A-01).
   */
  public async requireDelivery(
    db: DbHandle,
    deliveryId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<DeliveryRecordRow> {
    const row = await this.repository.findDelivery(db, deliveryId);
    if (row === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Delivery ${deliveryId} is not visible in the caller's scope`,
      });
    }
    await authorizeScope({ companyId: row.companyId, branchId: row.branchId });
    return row;
  }

  // -------------------------------------------------------------------------
  // The P1-31 read seam (prerequisites P-2 … P-5 of `docs/phase-1/phase-1-31/
  // a0-preflight.md`).
  //
  // Six operations that make an already-created delivery RECOVERABLE. Before them
  // the record was write-only after creation: five of six delivery operations were
  // writes, the single read returned blockers rather than the record, and a second
  // create answered ERR-RES-002 naming only the work order — so the delivery id was
  // unrecoverable once the create response was gone.
  //
  // Every one of them is scoped the same way and it is the only way this module
  // scopes an id-addressed read: read the row, then `authorizeScope` against the
  // row's OWN company and branch. `scope: 'branch'` is inert without a target,
  // because `requiresScopedEvaluation` returns false on an empty one whatever the
  // declaration says, and RLS cannot contain that — `app.branch_ids` is the
  // permission-blind union of every active grant, so visibility is not authority
  // (P1-18-A-01). No caller-supplied company or branch is read anywhere below.
  // -------------------------------------------------------------------------

  /**
   * `sal.delivery-read` — the delivery record (P-3).
   *
   * Publishes `DeliveryRepository.findDelivery` through the existing
   * `requireDelivery`, which already decides the uniform 404 and then re-authorizes.
   * It adds no query and no second mapper.
   *
   * `recordVersion` is published in the body and as the ETag by the route, for the
   * same reason the eligibility read publishes it: `sal.delivery-complete` is
   * version-guarded and `parseIfMatch` accepts only an exact positive integer, so a
   * caller needs a current version to act at all.
   */
  public async readDelivery(
    db: DbHandle,
    deliveryId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<DeliveryRecordView> {
    return toDeliveryView(await this.requireDelivery(db, deliveryId, authorizeScope));
  }

  /**
   * `sal.work-order-delivery-read` — the live delivery a work order has (P-2).
   *
   * ## This is the recovery seam
   *
   * `findLiveDeliveryForWorkOrder` has existed since P1-22 with exactly one caller:
   * the duplicate-create refusal in `DeliveryService`, which is not reachable by a
   * screen and which answers `ERR-RES-002` naming only the work order. So the
   * delivery id could not be discovered once the create response was lost. This
   * publishes that existing read unchanged — no new query, no second mapper — and
   * that is the whole fix.
   *
   * ## At most one row, by partial unique index
   *
   * `uq_delivery_records_work_order_active` (`status <> 'exception' AND deleted_at
   * IS NULL`) makes the live delivery for a work order unique, and the query mirrors
   * that predicate exactly. So this is a singleton read: no pagination, no ordering
   * contract, no cursor — there is no ordered set to page.
   *
   * A delivery marked `exception` is therefore reported as `null`, deliberately: the
   * index permits a new delivery for that work order, so "the live delivery" is
   * absent in the only sense the schema recognises.
   *
   * ## Absence is a 200, not a 404
   *
   * A visible work order with no live delivery answers
   * `{ workOrderId, delivery: null }`. A work order that is not visible answers
   * `ERR-RES-001`, decided by `requireWorkOrder` BEFORE any scope decision. The
   * work-order module is asked for the row rather than this module reading
   * `wo.work_orders`, which it may not do (ADR-001 rule 3) and which is also where
   * the company and branch the delivery query predicates on come from.
   */
  public async readWorkOrderDelivery(
    db: DbHandle,
    workOrderId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<WorkOrderDeliveryView> {
    const workOrder = await workOrderModule().workOrders.requireWorkOrder(
      db,
      workOrderId,
      authorizeScope
    );
    const scope: DeliveryScope = {
      companyId: workOrder.companyId,
      branchId: workOrder.branchId,
    };
    const delivery = await this.repository.findLiveDeliveryForWorkOrder(db, scope, workOrder.id);
    return {
      workOrderId: workOrder.id,
      delivery: delivery === null ? null : toDeliveryView(delivery),
    };
  }

  /**
   * `sal.delivery-list` — a branch's delivery records, newest first (P-2b).
   *
   * ## Scope is authorized BEFORE any row is read
   *
   * The exact opposite order from every other read on this seam, and deliberately
   * so. An id-addressed read has no scope to name until the row has been read, so
   * `requireDelivery` reads first and authorizes against the row's OWN company and
   * branch. A list has no row to take a scope from, so the caller must name one and
   * the server must refuse it before reading anything.
   *
   * Two things follow. `sel_delivery_records_scope` narrows on the permission-blind
   * union of the caller's allowed branches, so an optional pair would let a caller
   * holding `sal.delivery.view` in one branch read every branch it holds any grant
   * in (P1-18-A-01). And authorizing first stops the empty/non-empty difference from
   * reporting whether a branch has deliveries at all — a caller with no grant in the
   * named scope is refused, never handed an empty page.
   *
   * Client-asserted scope is never authoritative: the pair names a target and
   * `authorizeScope` decides. RLS stays default-deny underneath and narrows again on
   * the caller's own grants.
   *
   * ## One mapper
   *
   * Rows come back through `toDeliveryView`, the same mapper `sal.delivery-read` and
   * `sal.work-order-delivery-read` use, so a listed delivery and a read one are one
   * wire contract rather than two that can drift.
   */
  public async listDeliveries(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
      readonly workOrderId?: string | undefined;
      readonly vehicleId?: string | undefined;
    },
    page: { readonly cursor?: string | undefined; readonly limit?: number | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<Page<DeliveryRecordView>> {
    await authorizeScope({ companyId: filter.companyId, branchId: filter.branchId });
    const request: PageRequest = pageRequest(DELIVERY_RECORD_ORDER, page);
    const result = await this.repository.listDeliveries(db, filter, request);
    return { ...result, items: result.items.map(toDeliveryView) };
  }

  /**
   * `sal.delivery-receiver-read` — the verified receiver, as a row (P-4).
   *
   * Publishes `DeliveryRepository.findReceiver`, which the eligibility composition
   * already calls and then collapses into the boolean `receiver_not_verified`
   * blocker. No new query, no second mapper.
   *
   * Absence is a 200 with `receiver: null`, not a 404, and for the same reason as
   * the work-order read above: the DELIVERY's visibility is the not-found decision,
   * and it has already been made by `requireDelivery`. A 404 here would say nothing
   * a caller who just read the delivery does not already know, and would make "no
   * receiver yet" — the normal state of a fresh delivery — indistinguishable from a
   * scope refusal.
   *
   * `findReceiver` carries **no `deleted_at` predicate**, transcribed from
   * `sal.complete_delivery`'s own receiver gate, which has none either. That is
   * deliberate and is preserved here: a read that filtered it would report no
   * receiver for a delivery the primitive would happily complete.
   */
  public async readReceiver(
    db: DbHandle,
    deliveryId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<DeliveryReceiverEnvelope> {
    const delivery = await this.requireDelivery(db, deliveryId, authorizeScope);
    const scope: DeliveryScope = { companyId: delivery.companyId, branchId: delivery.branchId };
    const row = await this.repository.findReceiver(db, scope, delivery.id);
    return {
      deliveryId: delivery.id,
      receiver:
        row === null
          ? null
          : {
              id: row.id,
              deliveryRecordId: row.deliveryRecordId,
              receiverPartnerId: row.receiverPartnerId,
              identityEvidenceDocumentVersionId: row.identityEvidenceDocumentVersionId,
              verifiedBy: row.verifiedBy,
              verifiedAt: row.verifiedAt.toISOString(),
              recordVersion: row.recordVersion,
            },
    };
  }

  /**
   * `sal.delivery-checklist-result-list` — what has been recorded (P-4).
   *
   * The eligibility read publishes the GAPS — mandatory items with no satisfying
   * result, capped at 20, with `missingCount` computed and then dropped
   * (**P1-27-INT-088**). This publishes the RESULTS, which is the opposite set and
   * the one a delivery document is composed from. It does not close INT-088: the gap
   * side is untouched by this slice and remains as recorded.
   *
   * Paged, because the checklist template is unbounded and this module owns no
   * ceiling on it.
   */
  public async readChecklistResults(
    db: DbHandle,
    deliveryId: string,
    page: { limit?: number | undefined; cursor?: string | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<DeliveryChecklistResultsEnvelope> {
    const delivery = await this.requireDelivery(db, deliveryId, authorizeScope);
    const scope: DeliveryScope = { companyId: delivery.companyId, branchId: delivery.branchId };
    const request: PageRequest = pageRequest(CHECKLIST_RESULT_ORDER, page);
    const rows = await this.repository.listChecklistResults(db, scope, delivery.id, request);
    return {
      deliveryId: delivery.id,
      results: {
        ...rows,
        items: rows.items.map((row) => ({
          id: row.id,
          deliveryRecordId: row.deliveryRecordId,
          templateItemId: row.templateItemId,
          itemCode: row.itemCode,
          label: row.label,
          outcome: row.outcome,
          waiverReason: row.waiverReason,
          recordedBy: row.recordedBy,
          recordVersion: row.recordVersion,
        })),
      },
    };
  }

  /**
   * `sal.delivery-signature-list` — the signatures bound to a delivery (P-4).
   *
   * The eligibility read publishes only `signature_missing`, a boolean over
   * `hasSignature`. This publishes the rows.
   *
   * Every entry carries a `shared.document_versions` REFERENCE and no bytes, and no
   * download is offered from here — see `DeliverySignatureView`.
   */
  public async readSignatures(
    db: DbHandle,
    deliveryId: string,
    page: { limit?: number | undefined; cursor?: string | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<DeliverySignaturesEnvelope> {
    const delivery = await this.requireDelivery(db, deliveryId, authorizeScope);
    const scope: DeliveryScope = { companyId: delivery.companyId, branchId: delivery.branchId };
    const request: PageRequest = pageRequest(SIGNATURE_ORDER, page);
    const rows = await this.repository.listSignatures(db, scope, delivery.id, request);
    return {
      deliveryId: delivery.id,
      signatures: {
        ...rows,
        items: rows.items.map((row) => ({
          id: row.id,
          deliveryRecordId: row.deliveryRecordId,
          signerRole: row.signerRole,
          signatureDocumentVersionId: row.signatureDocumentVersionId,
          signedAt: row.signedAt.toISOString(),
        })),
      },
    };
  }

  /**
   * `sal.delivery-status-history` — the append-only transition ledger (P-5,
   * **P1-27-INT-089**).
   *
   * `sal.delivery_status_history` is written on every transition and was read
   * nowhere. Newest first; the oldest row is already the origin, because every
   * advance appends its own row with its `from_status` rather than relying on an
   * AFTER UPDATE trigger — so no synthetic `origin` block is published.
   */
  public async readStatusHistory(
    db: DbHandle,
    deliveryId: string,
    page: { limit?: number | undefined; cursor?: string | undefined },
    authorizeScope: ScopeAuthorizer
  ): Promise<DeliveryStatusHistoryEnvelope> {
    const delivery = await this.requireDelivery(db, deliveryId, authorizeScope);
    const scope: DeliveryScope = { companyId: delivery.companyId, branchId: delivery.branchId };
    const request: PageRequest = pageRequest(STATUS_HISTORY_ORDER, page);
    const rows = await this.repository.listStatusHistory(db, scope, delivery.id, request);
    return {
      deliveryId: delivery.id,
      transitions: {
        ...rows,
        items: rows.items.map((row) => ({
          id: row.id,
          fromStatus: row.fromStatus,
          toStatus: row.toStatus,
          reason: row.reason,
          actorId: row.actorId,
          occurredAt: row.occurredAt.toISOString(),
        })),
      },
    };
  }

  /**
   * `sal.delivery-eligibility-read` — why this delivery may or may not complete.
   *
   * The route declares `sal.delivery.manage` **and** `sal.finance.view`, and the
   * second is load-bearing rather than defensive: the financial blocker is composed
   * from `sal.invoice_open_receivable`, whose inputs (`sal.invoice_amounts`,
   * `sal.receipts`, `sal.payment_allocations`) are gated whole-row by that
   * permission. A caller without it would be answered by an RLS-invisible zero — the
   * blocker would report "nothing outstanding" *because it could not see the invoice*,
   * which is the most dangerous possible failure mode for this operation. This service
   * additionally refuses to read an absent invoice as a paid one (see
   * `readFinancialFact`), so invisibility cannot pass as settlement even if the route
   * declaration were ever weakened.
   */
  public async readEligibility(
    db: DbHandle,
    deliveryId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<EligibilityView> {
    const delivery = await this.requireDelivery(db, deliveryId, authorizeScope);
    const composed = await this.composeFor(db, delivery);
    return {
      deliveryId: delivery.id,
      workOrderId: delivery.workOrderId,
      status: delivery.status,
      eligible: composed.decision.eligible,
      blockers: composed.decision.blockers,
      overridden: composed.decision.overridden,
      facts: composed.facts,
      checklistGaps: composed.checklistGaps,
      overridable: OVERRIDABLE_BLOCKERS,
      recordVersion: delivery.recordVersion,
    };
  }

  /**
   * Composes the decision for an already-read (and, on the write path, already
   * LOCKED) delivery row.
   *
   * Shared with `DeliveryService.completeDelivery`, which calls it inside the
   * transaction after taking the delivery's row lock — so the decision the primitive
   * acts on is the decision that was composed, not one a concurrent credit note or
   * part issue invalidated in between.
   *
   * The eight facts are gathered concurrently because they are independent reads on
   * one snapshot and a delivery record is not a hot row; serialising them would add
   * five round trips inside a lock for no ordering benefit.
   */
  public async composeFor(db: DbHandle, delivery: DeliveryRecordRow): Promise<ComposedEligibility> {
    const scope: DeliveryScope = { companyId: delivery.companyId, branchId: delivery.branchId };
    const facts: EligibilityFact[] = [];

    const [workOrder, quality, financial, parts, gaps, receiver, signature] = await Promise.all([
      this.readWorkOrderFact(db, delivery.workOrderId),
      this.readQualityFact(db, delivery.workOrderId),
      this.readFinancialFact(db, delivery.workOrderId),
      this.readPartObligationFact(db, delivery.workOrderId),
      this.repository.mandatoryChecklistGaps(db, scope, delivery.id),
      this.repository.findReceiver(db, scope, delivery.id),
      this.repository.hasSignature(db, scope, delivery.id),
    ]);

    facts.push(
      {
        blocker: 'delivery_state_invalid',
        established: true,
        source: 'sal.delivery_records.status',
      },
      workOrder.fact,
      quality.fact,
      financial.fact,
      parts.fact,
      {
        blocker: 'checklist_incomplete',
        established: true,
        source:
          'sal.delivery_checklist_template_items ⋈ sal.delivery_checklist_templates ' +
          '∖ sal.delivery_checklist_results',
      },
      { blocker: 'receiver_not_verified', established: true, source: 'sal.authorized_receivers' },
      { blocker: 'signature_missing', established: true, source: 'sal.delivery_signatures' }
    );

    const decision = composeEligibility({
      deliveryStatus: delivery.status,
      workOrderComplete: workOrder.complete,
      qualityControlPassed: quality.passed,
      hasOutstandingBalance: financial.outstanding,
      hasOutstandingPartObligation: parts.outstanding,
      mandatoryChecklistComplete: gaps.missingCount === 0,
      receiverVerified: receiver !== null,
      signatureRecorded: signature,
    });

    return { decision, facts, checklistGaps: gaps.sample };
  }

  /**
   * The FOUR eligibility facts that are keyed on a work order alone (P1-31 D-3).
   *
   * ## Why four and not eight
   *
   * `composeFor` above needs a delivery ROW: `delivery_state_invalid` reads that
   * row's status, and `checklist_incomplete`, `receiver_not_verified` and
   * `signature_missing` are all counted against the delivery's own id. None of the
   * four is answerable for a work order that has no delivery record yet, which is
   * precisely the population the readiness queue exists to show — the Owner's D-3
   * decision is that an eligible work order with NO delivery must appear in it.
   *
   * The other four take `workOrderId` and nothing else, so they are exactly the
   * subset that can be established before a delivery exists. This method calls
   * `composeFor`'s own private readers rather than restating any of them: a second
   * definition of the financial fact is the failure the module docblock above is
   * written to prevent, and it would be the one gate with no database backstop.
   *
   * ## Blocking and unestablished are both refused
   *
   * `clear` demands that every fact be `established` AND that no blocker be raised.
   * The conjunction is deliberate redundancy: each reader already fails closed —
   * an unresolvable state is not complete, an absent invoice is not settlement —
   * so the two conditions coincide today, and stating both means a future reader
   * that reports an unestablished fact as harmless cannot make this queue offer a
   * vehicle for handover.
   */
  public async composeWorkOrderFacts(
    db: DbHandle,
    workOrderId: string
  ): Promise<WorkOrderEligibilityFacts> {
    const [workOrder, quality, financial, parts] = await Promise.all([
      this.readWorkOrderFact(db, workOrderId),
      this.readQualityFact(db, workOrderId),
      this.readFinancialFact(db, workOrderId),
      this.readPartObligationFact(db, workOrderId),
    ]);

    const facts: readonly EligibilityFact[] = [
      workOrder.fact,
      quality.fact,
      financial.fact,
      parts.fact,
    ];
    // Pushed in `BLOCKER_CODES` order, so two rows of the same page never report
    // the same set of reasons in two different sequences.
    const blockers: BlockerCode[] = [];
    if (!workOrder.complete) blockers.push('work_order_not_complete');
    if (!quality.passed) blockers.push('quality_control_not_passed');
    if (financial.outstanding) blockers.push('financial_balance_outstanding');
    if (parts.outstanding) blockers.push('part_obligation_outstanding');

    return {
      facts,
      blockers,
      clear: blockers.length === 0 && facts.every((fact) => fact.established),
    };
  }

  /**
   * `deliveryForWarranty` — the delivery projection `warranty` may read.
   *
   * `wty.warranty_records` carries `delivery_record_id`, `company_id`, `branch_id` and
   * a vehicle, and the `warranty` module may not read `sal.delivery_records` to find
   * them (ADR-001 rule 3). It returns `status` and `deliveredAt` rather than a
   * pre-computed "may issue" boolean, because the delivery-committed precondition is
   * `wty.issue_warranty`'s to enforce and a second opinion here could disagree with it.
   *
   * `null` covers absent and out-of-scope alike; the caller decides what to disclose.
   * There is deliberately **no authorization of its own**: it is called inside the
   * warranty-generation transaction against a delivery that operation has already
   * authorized, and demanding `sal.delivery.manage` of every caller allowed to issue a
   * warranty would be a different and wrong rule. Nothing sensitive crosses: no
   * receiver, no identity-evidence reference, no signature reference.
   */
  public async deliveryForWarranty(
    db: DbHandle,
    deliveryId: string
  ): Promise<DeliveryForWarranty | null> {
    const row = await this.repository.findDelivery(db, deliveryId);
    if (row === null) return null;
    return {
      id: row.id,
      status: row.status,
      companyId: row.companyId,
      branchId: row.branchId,
      workOrderId: row.workOrderId,
      vehicleId: row.vehicleId,
      deliveredAt: row.deliveredAt === null ? null : row.deliveredAt.toISOString(),
      finalOdometerReadingId: row.finalOdometerReadingId,
    };
  }

  // -------------------------------------------------------------------------
  // The five facts that come from outside this module's tables.
  // Each one fails CLOSED: an answer that cannot be established is blocking.
  // -------------------------------------------------------------------------

  /**
   * Is the work order finished?
   *
   * `wo.work_order_states` is a catalog TABLE that tenants may shadow, so "complete"
   * is resolved by asking `@/modules/work-order` for the live catalog rather than by
   * comparing against a hardcoded state name. `isClosed` is the column that means it.
   *
   * An unresolvable state code counts as NOT complete — the same choice
   * `WorkOrderService.jobScope` makes for terminality. A state the catalog no longer
   * resolves is not one anything can certify as finished, and certifying it would
   * release a vehicle on the strength of a row nobody can interpret.
   */
  private async readWorkOrderFact(
    db: DbHandle,
    workOrderId: string
  ): Promise<{ complete: boolean; fact: EligibilityFact }> {
    const services = workOrderModule();
    // No `authorizeScope` argument: the DELIVERY has already been authorized against
    // its own company and branch, and `sal.delivery_records`'s composite foreign key
    // to `wo.work_orders` is on `(tenant, company, branch, id)` — so the work order is
    // in that same authorized scope by construction, not by assumption.
    const workOrder = await services.workOrders.requireWorkOrder(db, workOrderId);
    const states = await services.workOrderCatalog.workOrderStates(db);
    const state = states.find((candidate) => candidate.code === workOrder.state);
    return {
      complete: state?.isClosed ?? false,
      fact: {
        blocker: 'work_order_not_complete',
        established: state !== undefined,
        source: '@/modules/work-order — wo.work_orders.state against wo.work_order_states',
      },
    };
  }

  /**
   * Did quality control pass?
   *
   * `qualityModule().gate.evaluate` reports the three `qms` conditions the work-order
   * closure guard raises as B5a, B5b and B6: a failed record with no passing record
   * superseding it, a mandatory check configured with no passing record, and
   * safety-critical rework without independent sign-off. All three collapse into this
   * one blocker because `BLOCKER_CODES` is a closed vocabulary with a single quality
   * entry — widening it would change a contract this phase does not own — and because
   * the operator's remedy for all three is the same: get quality control signed off.
   */
  private async readQualityFact(
    db: DbHandle,
    workOrderId: string
  ): Promise<{ passed: boolean; fact: EligibilityFact }> {
    const status = await qualityModule().gate.evaluate(db, workOrderId);
    return {
      passed:
        !status.failedWithoutPass &&
        !status.mandatoryPassMissing &&
        !status.unsignedSafetyCriticalRework,
      fact: {
        blocker: 'quality_control_not_passed',
        established: true,
        source: '@/modules/quality — gate.evaluate (B5a, B5b, B6)',
      },
    };
  }

  /**
   * Is money still owed on this work order?
   *
   * **The only gate on the handover's financial precondition, in the entire system.**
   * `sal.complete_delivery` does not look at a balance, no trigger on
   * `sal.delivery_records` does, and `rec.custody_history`'s own guards govern custody
   * rather than money. Deleting this method would not fail a single database
   * constraint.
   *
   * Three answers are "outstanding", and only the first is an actual debt:
   *
   *  1. `hasOutstanding` — a real balance on the live invoice.
   *  2. `balanceVisible === false` — the caller does not hold `sal.finance.view`, so
   *     the amount rows are RLS-invisible and the balance is UNKNOWN. Billing already
   *     answers `hasOutstanding: true` in that case; this is stated again because an
   *     invisible zero passing as a settled zero is the single worst failure this
   *     operation can have, and it must not depend on one module's implementation
   *     detail. The route requires `sal.finance.view` so this case should not arise
   *     for an authorized caller; it is handled anyway.
   *  3. `null` — no live invoice for the work order.
   *
   * ## Case 3 is a deliberate DISAGREEMENT with the billing port's own documentation
   *
   * `openReceivableForWorkOrder`'s doc comment says a caller must treat `null` as "no
   * financial blocker, never as unknown". This module treats it as the blocker being
   * PRESENT, and the divergence is recorded here rather than resolved silently:
   *
   *  - `null` conflates two facts. Billing returns it both when no live invoice exists
   *    AND when `findWorkOrderScope` sees no work order — the second of which is
   *    genuinely unknown. A consumer cannot tell them apart, so it must treat the union
   *    conservatively.
   *  - An unbilled vehicle has not been paid for. "Nothing was invoiced" is not
   *    settlement, and this is the one gate with no database backstop, so the safe
   *    direction is the blocking one.
   *  - The consequence is proportionate and auditable rather than obstructive: a
   *    legitimately unbilled handover — an internal job, goodwill work — completes
   *    through the documented override, which requires `sal.delivery.complete`, a
   *    stated reason, and leaves both in the audit record. A silent pass leaves nothing.
   *
   * The amount is never parsed into a `number`. Where it IS visible, billing's
   * `hasOutstanding` is confirmed against an independent exact `Decimal` comparison
   * and the two are combined with OR — deliberate redundancy on the one gate the
   * database does not hold, and it can only ever make the answer more conservative.
   */
  private async readFinancialFact(
    db: DbHandle,
    workOrderId: string
  ): Promise<{ outstanding: boolean; fact: EligibilityFact }> {
    const blocker: BlockerCode = 'financial_balance_outstanding';
    const receivable = await billingModule().reads.openReceivableForWorkOrder(db, workOrderId);

    if (receivable === null) {
      return {
        outstanding: true,
        fact: {
          blocker,
          established: false,
          source:
            '@/modules/billing — no live invoice for this work order; an unbilled handover is ' +
            'not a settled one, and the same null also covers an invisible work order',
        },
      };
    }
    if (!receivable.balanceVisible) {
      return {
        outstanding: true,
        fact: {
          blocker,
          established: false,
          source:
            '@/modules/billing — the balance is hidden by sal.finance.view, so it is unknown ' +
            'rather than zero',
        },
      };
    }
    /**
     * A live invoice that has not been ISSUED is a blocker, and this branch exists so the
     * response says which of the two zeros it is.
     *
     * `sal.invoice_open_receivable` returns `0` for a `draft` by design, so a draft
     * carrying five thousand of derived amounts answered "nothing outstanding" and the
     * independent `Decimal` re-check below CONFIRMED that zero rather than questioning it.
     * Creating a draft invoice therefore removed this blocker, making the composition
     * strictly less blocking than for a work order with no invoice at all — where `null`
     * blocks on the stated principle that "nothing was invoiced is not settlement".
     *
     * `established: true`, unlike the two cases above: this is not a fact we failed to
     * establish. We established it exactly, and it says the money is not collectable yet.
     */
    if (!receivable.collectable) {
      return {
        outstanding: true,
        fact: {
          blocker,
          established: true,
          source:
            `@/modules/billing — the live invoice is "${receivable.status}" and not yet issued, ` +
            'so its open receivable is structurally zero rather than settled; issue it or ' +
            'override with a reason',
        },
      };
    }

    // Re-derived, not merely trusted. `amount` is a `numeric(18,4)` decimal STRING;
    // `Decimal.fromDatabase` refuses a value the column could not have held, and the
    // comparison is exact — no double is materialised at any point.
    const confirmed =
      receivable.amount !== null &&
      Decimal.fromDatabase(receivable.amount, MONEY).greaterThan(Decimal.zero(MONEY));
    return {
      outstanding: receivable.hasOutstanding || confirmed,
      fact: {
        blocker,
        established: true,
        source: '@/modules/billing — openReceivableForWorkOrder (sal.invoice_open_receivable)',
      },
    };
  }

  /**
   * Is stock still committed to this work order?
   *
   * `inventoryModule().reads.openCommitmentsFor` counts active reservations and
   * issued-but-unreturned part issues — the two conditions
   * `DEFERRED_CLOSURE_BLOCKERS` assigned to P1-21 and that `wo.work_orders`'
   * `parts_forward_state` was left as a hook for. Handing over a vehicle while parts
   * are still reserved against its work order leaves the reservation stranded, so the
   * same fact gates this operation.
   */
  private async readPartObligationFact(
    db: DbHandle,
    workOrderId: string
  ): Promise<{ outstanding: boolean; fact: EligibilityFact }> {
    const commitments = await inventoryModule().reads.openCommitmentsFor(db, workOrderId);
    return {
      outstanding: commitments.blocking,
      fact: {
        blocker: 'part_obligation_outstanding',
        established: true,
        source: '@/modules/inventory — reads.openCommitmentsFor',
      },
    };
  }
}
