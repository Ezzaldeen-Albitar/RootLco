/**
 * Reception-to-work-order conversion — application service (Phase 1-18,
 * P1-18-BE-019).
 *
 * One command, and the only one in this module whose whole point is being
 * exactly-once. Four things make it so, in this order:
 *
 *  1. the visit is locked `FOR UPDATE`, so two concurrent conversions serialise
 *     here rather than both reading `authorized`;
 *  2. an existing work order for the visit is returned as it stands instead of a
 *     second one being created, so a replay is answered rather than duplicated;
 *  3. `converted` is terminal, so the visit itself refuses a later attempt;
 *  4. `uq_work_orders_ordinary_origin` is the database's own backstop, surfacing
 *     a second ordinary work order for the same visit as `23505`.
 *
 * Exactly one minimal work order is created. No job, service line, part, or
 * assignment: how work is organised is Phase 1-19's contract, and deciding it
 * here would be this module answering a question nobody asked it.
 *
 * `wo.guard_work_order_refs` holds every precondition — the visit visible and
 * authorized, the vehicle coherent, custody accepted, an approved authorization
 * present, the initial state non-terminal. None of them is re-implemented here;
 * its refusal arrives as `23514` and becomes a stable 409.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { appendAudit } from '@/server/audit/audit';
import { isSqlState, SQLSTATE } from '@/server/db/repository';
import type {
  ReceptionConversionRepository,
  WorkOrderRow,
} from '../data/reception-conversion-repository';
import type { ReceptionRepository } from '../data/reception-repository';
import { assertConvertible, assertStandingAuthorization } from '../domain/reception';
import type { DisplayNumberAllocator } from './appointment-service';

/** Sequence that renders a work-order number. Registered in the shared registry. */
const WORK_ORDER_SEQUENCE = 'work_order';

export interface ReceptionConverted {
  readonly receptionVisitId: string;
  readonly workOrderId: string;
  /** `null` when the tenant has not provisioned a work-order-number sequence. */
  readonly displayNumber: string | null;
  readonly state: string;
  /** True when this request found the conversion already done and changed nothing. */
  readonly alreadyConverted: boolean;
}

export class ReceptionConversionService extends ApplicationService {
  protected readonly module = 'reception';

  constructor(
    private readonly conversion: ReceptionConversionRepository,
    private readonly receptions: ReceptionRepository,
    private readonly numbers: DisplayNumberAllocator
  ) {
    super();
  }

  async convertToWorkOrder(
    db: DbHandle,
    receptionVisitId: string,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<ReceptionConverted> {
    const visit = await this.receptions.lockVisit(db, receptionVisitId);
    if (!visit) {
      throw new AppFailure('ERR-RES-001', { message: 'Reception was not found' });
    }

    // Authorize against the LOCKED visit's own branch before anything else
    // (P1-18-A-01). This route declares `scope: 'branch'` but is addressed by id,
    // so the pre-handler check had no target and fell back to the scope-blind
    // `iam.has_permission`; `app.branch_ids` is the permission-blind union of the
    // caller's grants, so RLS admits the row too. Placing the check here — before
    // the existing-work-order read, before `assertConvertible`, before the
    // standing-authorization evaluation, and before any allocator advance —
    // means a denial rolls back with no work order, no linkage, no lifecycle
    // change, no audit row and no outbox envelope.
    await authorizeScope({ companyId: visit.companyId, branchId: visit.branchId });

    // Read inside the lock, and before the lifecycle check: a visit that has
    // already been converted is terminal, so `assertConvertible` would refuse it
    // and a retried request would get a 409 for work that succeeded. Returning the
    // work order the first attempt created is the honest answer to "convert this".
    const existing = await this.conversion.workOrderForVisit(db, receptionVisitId);
    if (existing) {
      return {
        receptionVisitId,
        workOrderId: existing.id,
        displayNumber: existing.displayNumber,
        state: existing.state,
        alreadyConverted: true,
      };
    }

    assertConvertible(visit.receptionStatus);

    // Checked after the replay read and before anything is written. `wo.
    // guard_work_order_refs` re-tests that an approved authorization EXISTS, but
    // an approval that was later withdrawn still satisfies it, so a work order
    // could be opened against a customer's withdrawn consent. A replay is
    // deliberately still answered above: the work order already exists, and
    // refusing to describe it would not un-create it.
    assertStandingAuthorization(await this.receptions.standingAuthorizations(db, receptionVisitId));

    // Allocated inside the caller's transaction, so a conversion that rolls back
    // does not burn a work-order number. An unprovisioned tenant gets a work order
    // with no printed number rather than a refused conversion.
    const displayNumber = (await this.numbers.isProvisioned(db, {
      sequenceCode: WORK_ORDER_SEQUENCE,
    }))
      ? (await this.numbers.allocate(db, { sequenceCode: WORK_ORDER_SEQUENCE })).displayNumber
      : null;

    let workOrder: WorkOrderRow | null;
    try {
      workOrder = await this.conversion.insertWorkOrder(db, {
        companyId: visit.companyId,
        branchId: visit.branchId,
        receptionVisitId,
        vehicleId: visit.vehicleId,
        displayNumber,
      });
    } catch (error) {
      throw this.mapConversionFailure(error);
    }
    if (!workOrder) {
      throw new AppFailure('ERR-IAM-001', { message: 'Conversion was refused by policy' });
    }

    // The visit moves last, so the work order exists before anything calls the
    // visit converted. The caller's version is the predicate: a stale view writes
    // zero rows and the whole transaction — work order included — rolls back.
    let changed: number;
    try {
      changed = await this.receptions.setStatus(db, receptionVisitId, 'converted', expectedVersion);
    } catch (error) {
      throw this.mapConversionFailure(error);
    }
    if (changed === 0) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The reception changed while this request was in flight; retry',
      });
    }

    await appendAudit(db, {
      action: 'rec.reception.converted_to_work_order',
      entityType: 'wo.work_order',
      entityId: workOrder.id,
      companyId: visit.companyId,
      branchId: visit.branchId,
      details: [
        { field: 'reception_visit_id', classification: 'internal', value: receptionVisitId },
        { field: 'vehicle_id', classification: 'internal', value: visit.vehicleId },
        { field: 'display_number', classification: 'public', value: workOrder.displayNumber },
        { field: 'state', classification: 'public', value: workOrder.state },
      ],
    });

    // No event. The approved event catalog contains no entry for this fact, and
    // minting one would publish a contract no consumer agreed to and no reviewer
    // saw. The durable record is the work order plus the visit's status ledger,
    // both written by this transaction.

    return {
      receptionVisitId,
      workOrderId: workOrder.id,
      displayNumber: workOrder.displayNumber,
      state: workOrder.state,
      alreadyConverted: false,
    };
  }

  /** Maps the frozen `wo` guard SQLSTATEs; re-throws anything else. */
  private mapConversionFailure(error: unknown): AppFailure | unknown {
    if (isSqlState(error, SQLSTATE.insufficientPrivilege)) {
      // A row-level policy refused the work-order insert: the caller's grant does
      // not reach this branch. An authorization outcome leaves as one rather
      // than as ERR-SYS-001.
      return new AppFailure('ERR-IAM-001', {
        message: 'This reception is outside the scope your access grants',
      });
    }
    if (isSqlState(error, SQLSTATE.uniqueViolation)) {
      // uq_work_orders_ordinary_origin, or the work-order display-number unique.
      // Both are resolved by retrying: the first means a concurrent transaction
      // committed the conversion first, the second that the allocated number is
      // already on a live work order.
      return new AppFailure('ERR-RES-002', {
        message:
          'A work order already exists for this reception, or the allocated work-order number is in use',
      });
    }
    if (isSqlState(error, SQLSTATE.checkViolation)) {
      // `wo.guard_work_order_refs` preconditions, or the reception transition
      // guard. Both mean the reception is not ready, which a retry cannot fix.
      return new AppFailure('ERR-TRN-001', {
        message:
          'The reception is not ready to convert: it must be authorized, hold accepted custody and an approved authorization, and name the same vehicle',
      });
    }
    if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
      return new AppFailure('ERR-RES-001', {
        message: 'A record the work order references was not found in this tenant',
      });
    }
    return error;
  }
}
