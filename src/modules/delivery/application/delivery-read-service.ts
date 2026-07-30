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

/** The composition plus the evidence behind it, shared with the write path. */
export interface ComposedEligibility {
  readonly decision: EligibilityDecision;
  readonly facts: readonly EligibilityFact[];
  readonly checklistGaps: readonly ChecklistGapRow[];
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
        source: 'sal.delivery_checklist_template_items ∖ sal.delivery_checklist_results',
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
