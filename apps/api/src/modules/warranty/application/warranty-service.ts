/**
 * Warranty generation (Phase 1-22, `wty.warranty-generate` and `wty.warranty-detail`).
 *
 * Two operations, and the shorter list is the more important one: this service
 * **generates** warranty records and **reads** them back. It does not intake,
 * assess, adjudicate or reimburse a claim, because there is no claim table in any
 * schema under any name and creating one needs a migration this phase forbids
 * (`P1-22-L-01`). Nothing here writes `'claimed_against'`; `assertWritableStatus`
 * makes that structural rather than a matter of care.
 *
 * ## What the application adds to `wty.issue_warranty`
 *
 * The primitive is authoritative for the terms and this service never second-guesses
 * them. What it adds is the four things the primitive demonstrably does not do:
 *
 *  1. **The policy's own status.** `wty.issue_warranty` filters coverage on
 *     `status = 'active'` and never looks at `wty.warranty_policies.status`, so an
 *     archived policy with one live coverage row would issue a warranty. The
 *     database does not close that gap — `assertPolicyActive` does, and it is the
 *     ONLY defence.
 *  2. **A controlled configuration error.** With no coverage effective at the
 *     delivery date the primitive raises a bare refusal naming a constraint this
 *     platform never echoes. The pre-check turns that into `ERR-RES-001` naming the
 *     policy code and the date, which is the difference between an operator fixing
 *     configuration and an operator filing a bug.
 *  3. **Policy resolution.** The primitive takes a `policy_id` and cannot choose
 *     one. When the caller does not name a policy this service uses the company's
 *     single active policy and refuses when there is none or more than one. It never
 *     picks one — a guessed policy is a guessed duration, and this phase invents no
 *     term of a warranty.
 *  4. **Covered items.** `wty.warranty_record_items` has no primitive and no
 *     constraint tying an item to the coverage that pays for it, so the eligibility
 *     rule (`coversItemKind` against the coverage's `covered_scope`) is enforced
 *     here and nowhere else.
 *
 * ## Exactly one audit record and exactly one event
 *
 * A replay writes neither. The primitive is idempotent on
 * `(tenant_id, idempotency_key)` and returns the id that already exists, which from
 * the outside is indistinguishable from a fresh issue — so the replay is resolved
 * *before* the call and returns the existing record with `replayed: true`. Without
 * that, a retrying client would produce one warranty and N audit records claiming N
 * warranties were issued. `uq_event_outbox_event_key` is the backstop: the event key
 * is derived from the record id, so a second publication for the same record cannot
 * be written even if this logic were bypassed.
 *
 * ## No money, anywhere
 *
 * `wty` has 80 columns and not one of them is monetary — no amount, no currency, no
 * coverage cap in any unit of account. So no view here carries a money field, and
 * inventing one (a "covered value", a "warranty reserve") would be fabricating a
 * business fact the schema cannot hold.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { isSqlState, sqlState, SQLSTATE } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { ScopeAuthorizer } from '@/server/auth/authorization';
import { deliveryModule } from '@/modules/delivery';
import { workOrderModule, type LineRow } from '@/modules/work-order';
import {
  MAX_COVERED_ITEMS,
  type WarrantyCoverageRow,
  type WarrantyPolicyRow,
  type WarrantyRecordItemRow,
  type WarrantyRecordRow,
  type WarrantyRepository,
} from '../data/warranty-repository';
import {
  WarrantyRuleError,
  assertCoverageConfigured,
  assertDeliveryDelivered,
  assertPolicyActive,
  assertWritableStatus,
  coversItemKind,
} from '../domain/warranty';

/**
 * `no_data_found`.
 *
 * Not in `SQLSTATE` (the foundation registry, which this module may not edit) and
 * handled here for a specific reason: the P1-22 contract for `wty.issue_warranty`
 * describes its missing-coverage path as raising `P0002`, while the DEPLOYED
 * function in `20260724095000_wty_warranty.sql` raises `check_violation` for the
 * same case. Both are mapped, so this service produces the same controlled
 * configuration error whichever definition a database carries — and the coverage
 * pre-check means neither should normally be reached at all.
 */
const NO_DATA_FOUND = 'P0002';

/**
 * The delivery facts warranty generation needs — and nothing else.
 *
 * Deliberately the smallest possible surface on `@/modules/delivery`. The vehicle,
 * the work order and every term of the warranty are read off the record the
 * primitive creates, so this module never has to agree with the delivery module
 * about them; the four fields below are exactly what is needed *before* the record
 * exists: the scope to authorize against, the status to refuse on, and the timestamp
 * the coverage window is resolved from.
 *
 * `sal.delivery_records` is NEVER queried from here. It belongs to `delivery`, and
 * the boundary is what stops two modules disagreeing about when a handover happened.
 *
 * `deliveredAt` is typed loosely on purpose: it is passed straight through to
 * PostgreSQL as a bound parameter and cast there, so this module does not need to
 * know whether the port hands over an ISO string or a `Date` — and must not convert
 * it, because a Node-side date conversion would resolve the calendar day on a
 * different clock than `wty.issue_warranty` does.
 */
export interface WarrantyDeliveryFacts {
  readonly companyId: string;
  readonly branchId: string;
  readonly status: string;
  readonly deliveredAt: string | Date | null;
}

export interface GenerateWarrantyInput {
  readonly deliveryRecordId: string;
  /** Omitted only when the company has exactly one active policy. */
  readonly policyId?: string | undefined;
  readonly idempotencyKey?: string | undefined;
}

/** One covered job or part, as returned to a caller. */
export interface WarrantyItemView {
  readonly id: string;
  readonly itemKind: string;
  readonly sourceJobId: string | null;
  readonly sourcePartId: string | null;
  readonly description: string;
}

/** The coverage terms a record cites. Every value is operator configuration. */
export interface WarrantyCoverageView {
  readonly id: string;
  readonly coveredScope: string;
  readonly durationMonths: number;
  /**
   * The coverage's RELATIVE allowance, or null for unlimited distance.
   *
   * Named differently from the record's `odometerLimit` on purpose: this is the
   * distance the coverage grants, that one is the absolute reading at which it
   * lapses. They are the same column name in two tables and the wrong one is a
   * silently wrong warranty.
   */
  readonly odometerAllowance: string | null;
  readonly effectiveFrom: string;
  readonly effectiveTo: string | null;
  readonly status: string;
}

export interface WarrantyPolicyView {
  readonly id: string;
  readonly policyCode: string;
  readonly name: string;
  readonly status: string;
}

/**
 * A warranty record as a caller sees it.
 *
 * No monetary field, because `wty` has none. `status` is reported verbatim from the
 * record and the only value this phase can create is `'issued'`.
 */
export interface WarrantyView {
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
  /** ABSOLUTE ceiling, or null when the coverage sets no distance limit. */
  readonly odometerLimit: string | null;
  readonly policy: WarrantyPolicyView;
  readonly coverage: WarrantyCoverageView;
  readonly items: readonly WarrantyItemView[];
  readonly recordVersion: number;
  /** True when an idempotent replay returned the warranty that already existed. */
  readonly replayed: boolean;
}

/**
 * Translates the protected schema's refusals into the controlled error catalog.
 *
 * The SQLSTATE is the contract, never the message text — no constraint name, no
 * function name and no SQL fragment reaches a caller. Two mappings carry real
 * information rather than being defensive filler:
 *
 *  - **`23P01` is a conflict, not a fault.** `ex_warranty_records_no_overlap` is a
 *    gist EXCLUDE over `daterange(start_date, expiry_date, '[]')` per
 *    `(tenant, vehicle, coverage)`, so it fires when a live warranty for the same
 *    vehicle and the same coverage already spans the new window — typically a second
 *    delivery of the same vehicle inside an unexpired warranty. Note the interval
 *    asymmetry that makes this easy to misjudge: coverage windows are half-open
 *    `'[)'` and record windows are CLOSED `'[]'`, so two records that merely touch at
 *    an endpoint DO collide while two coverage rows in the same position do not.
 *    Answering 500 here would tell a caller the server broke when in fact the
 *    database enforced exactly the rule it exists to enforce.
 *  - **`23505` is the idempotency key, not a duplicate record.** The only unique
 *    index that a warranty INSERT can violate is
 *    `uq_warranty_records_idempotency (tenant_id, idempotency_key)`, and it is NOT
 *    narrowed by RLS — so it is the one thing that still fires when the key was used
 *    in a branch the caller cannot see.
 */
function toDomainFailure(error: unknown, what: string): never {
  if (error instanceof WarrantyRuleError) {
    throw new AppFailure('ERR-TRN-001', { message: error.message });
  }
  if (isSqlState(error, SQLSTATE.exclusionViolation)) {
    throw new AppFailure('ERR-CON-001', {
      message:
        `${what} overlaps a warranty that is already live for this vehicle under the same ` +
        'coverage. Void or wait out the existing record before issuing another.',
    });
  }
  if (isSqlState(error, SQLSTATE.uniqueViolation)) {
    throw new AppFailure('ERR-INT-001', {
      message: `${what} used an idempotency key that is already recorded for this tenant`,
    });
  }
  if (sqlState(error) === NO_DATA_FOUND) {
    throw new AppFailure('ERR-RES-001', {
      message:
        `${what} found no warranty coverage configured for the delivery date. Coverage ` +
        'duration and limits are operator configuration and are never defaulted.',
    });
  }
  if (isSqlState(error, SQLSTATE.checkViolation)) {
    // Reached only as a race or a data gap, because delivery status, policy status
    // and coverage are all pre-checked above. The two survivors are a delivery whose
    // status changed inside this transaction's window and a delivery with no
    // `final_odometer_reading_id` — which this module cannot pre-check, because the
    // reading lives in `veh.odometer_readings` and belongs to another module.
    throw new AppFailure('ERR-TRN-001', {
      message:
        `${what} was refused because the delivery no longer satisfies a warranty ` +
        'precondition: it must be delivered and carry a final odometer reading.',
    });
  }
  if (isSqlState(error, SQLSTATE.foreignKeyViolation)) {
    throw new AppFailure('ERR-RES-001', {
      message: `${what} names a delivery, policy or coverage that does not exist in scope`,
    });
  }
  throw error;
}

/**
 * Runs a domain assertion and maps its refusal onto an EXPLICITLY chosen code.
 *
 * The code is a parameter rather than a default because the four domain assertions
 * are genuinely different answers: an archived policy is a state refusal the caller
 * cannot fix by editing the request (`ERR-TRN-001`), missing coverage is
 * configuration (`ERR-RES-001`), and a status this phase may not write is a server
 * invariant the caller had no part in (`ERR-SYS-001`). Collapsing them to one code
 * would tell every caller the same useless thing.
 *
 * An unmapped `WarrantyRuleError` would surface as `ERR-SYS-001` — a 500 telling a
 * caller its request broke the server when the server in fact refused it — so every
 * call site into `domain/warranty.ts` goes through here.
 */
function ruleRefusal<T>(code: 'ERR-TRN-001' | 'ERR-RES-001' | 'ERR-SYS-001', run: () => T): T {
  try {
    return run();
  } catch (error) {
    if (error instanceof WarrantyRuleError) {
      throw new AppFailure(code, { message: error.message });
    }
    throw error;
  }
}

export class WarrantyService {
  public constructor(private readonly repository: WarrantyRepository) {}

  // -------------------------------------------------------------------------
  // `wty.warranty-generate`
  // -------------------------------------------------------------------------

  /**
   * Generates a warranty record from a committed delivery.
   *
   * The order of operations is the design, not an accident:
   *
   *  1. the delivery is obtained through the delivery module's public port, so the
   *     handover fact has exactly one owner;
   *  2. `authorizeScope` runs on the delivery's OWN company and branch, after the
   *     read. A scoped permission is inert without a target — `requiresScopedEvaluation`
   *     returns false on an empty one whatever the operation declares — so passing
   *     both ids is what makes this a branch check rather than a tenant-wide one
   *     (P1-18-A-01, and H6: `iam.has_permission_in_scope` matches company OR branch,
   *     so both must be named);
   *  3. the delivery must be `delivered`. `wty.guard_warranty_record_coherence` and
   *     the primitive both require it, and neither locks the delivery row — so this
   *     pre-check produces the caller-safe refusal while the COMMIT is what makes
   *     the precondition real;
   *  4. a replay is resolved before anything is written;
   *  5. the policy is resolved, its status checked, and coverage confirmed;
   *  6. the primitive issues the record; and only then
   *  7. items, audit and event are written from the record the database created.
   *
   * Step 7 reads the coverage back off `warranty_records.coverage_id` rather than
   * reusing the row from step 5. Both selections order by `effective_from DESC LIMIT 1`
   * and `ex_warranty_coverage_no_overlap` is per `covered_scope`, so two active
   * coverages can legitimately share an `effective_from` and the tie is broken
   * arbitrarily in both places. Trusting the prediction would risk deciding item
   * eligibility from a `covered_scope` the record does not actually cite.
   */
  public async generateWarranty(
    db: DbHandle,
    input: GenerateWarrantyInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<WarrantyView> {
    const delivery = await this.deliveryFacts(db, input.deliveryRecordId);
    await authorizeScope({ companyId: delivery.companyId, branchId: delivery.branchId });

    ruleRefusal('ERR-TRN-001', () => assertDeliveryDelivered(delivery.status));

    // A delivered handover with no timestamp cannot be dated, and every term of a
    // warranty is dated from it. Refused rather than substituted with `now()`, which
    // would backdate or postdate the coverage window by however long the gap is.
    const deliveredAt = delivery.deliveredAt;
    if (deliveredAt === null) {
      throw new AppFailure('ERR-TRN-001', {
        message:
          'This delivery records no handover time, so a warranty start date cannot be ' +
          'derived from it',
      });
    }

    const replay = await this.resolveReplay(db, input, authorizeScope);
    if (replay !== null) return replay;

    const policy = await this.resolvePolicy(db, delivery.companyId, input.policyId);
    ruleRefusal('ERR-TRN-001', () => assertPolicyActive(policy.status, policy.policyCode));

    const resolution = await this.repository.findCoverageEffectiveOn(
      db,
      delivery.companyId,
      policy.id,
      deliveredAt
    );
    ruleRefusal('ERR-RES-001', () =>
      assertCoverageConfigured(resolution.coverage, policy.policyCode, resolution.effectiveOn)
    );

    await this.refuseDuplicateForPolicy(db, delivery, input.deliveryRecordId, policy.id);

    let recordId: string;
    try {
      const issued = await this.repository.issueWarranty(
        db,
        input.deliveryRecordId,
        policy.id,
        db.context.correlationId,
        input.idempotencyKey ?? null
      );
      recordId = issued.id;
    } catch (error) {
      toDomainFailure(error, 'Warranty generation');
    }

    const created = await this.repository.findWarrantyRecord(db, recordId);
    if (created === null) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'Warranty record vanished immediately after wty.issue_warranty created it',
      });
    }
    const record = created.record;

    // The primitive writes 'issued'. Asserting it makes the claim structural: if a
    // future definition ever produced another status — 'claimed_against' above all —
    // this operation refuses instead of publishing an event asserting a lifecycle
    // fact P1-22 does not implement (P1-22-L-01).
    ruleRefusal('ERR-SYS-001', () => assertWritableStatus(record.status));

    const coverage = await this.repository.findCoverage(db, record.companyId, record.coverageId);
    if (coverage === null) {
      // `fk_warranty_records_coverage` guarantees the row, and the record's company
      // is the caller's own, so invisibility here would mean a scope inconsistency
      // rather than a caller error.
      throw new AppFailure('ERR-SYS-001', {
        message: 'The coverage cited by a warranty record just created is not readable',
      });
    }

    const items = await this.recordCoveredItems(db, record, coverage, authorizeScope);

    await appendAudit(db, {
      action: 'wty.warranty.issued',
      entityType: 'wty.warranty_record',
      entityId: record.id,
      companyId: record.companyId,
      branchId: record.branchId,
      requestRef: 'wty.warranty-generate',
      details: [
        { field: 'deliveryRecordId', classification: 'internal', value: record.deliveryRecordId },
        { field: 'workOrderId', classification: 'internal', value: record.workOrderId },
        { field: 'vehicleId', classification: 'internal', value: record.vehicleId },
        { field: 'policyCode', classification: 'internal', value: policy.policyCode },
        { field: 'coverageId', classification: 'internal', value: record.coverageId },
        { field: 'coveredScope', classification: 'internal', value: coverage.coveredScope },
        {
          field: 'durationMonths',
          classification: 'internal',
          value: String(coverage.durationMonths),
        },
        { field: 'startDate', classification: 'internal', value: record.startDate },
        { field: 'expiryDate', classification: 'internal', value: record.expiryDate },
        { field: 'odometerAtIssue', classification: 'internal', value: record.odometerAtIssue },
        { field: 'odometerLimit', classification: 'internal', value: record.odometerLimit },
        { field: 'coveredItemCount', classification: 'internal', value: String(items.length) },
      ],
    });

    await publishEvent(db, {
      eventType: 'warranty.issued',
      aggregateId: record.id,
      aggregateVersion: record.recordVersion,
      producer: 'warranty.warranty-service',
      companyId: record.companyId,
      branchId: record.branchId,
      // The record id keys the event, so a producer that retries its own command
      // cannot emit `warranty.issued` twice for one warranty:
      // `uq_event_outbox_event_key` refuses the second write.
      eventKey: `warranty.issued:${record.id}`,
      payload: {
        warrantyRecordId: record.id,
        deliveryRecordId: record.deliveryRecordId,
        workOrderId: record.workOrderId,
        vehicleId: record.vehicleId,
        policyId: record.policyId,
        policyCode: policy.policyCode,
        coverageId: record.coverageId,
        coveredScope: coverage.coveredScope,
        durationMonths: coverage.durationMonths,
        startDate: record.startDate,
        expiryDate: record.expiryDate,
        odometerAtIssue: record.odometerAtIssue,
        odometerLimit: record.odometerLimit,
        status: record.status,
        coveredItemCount: items.length,
      },
    });

    return this.toView(record, policy, coverage, items, false);
  }

  // -------------------------------------------------------------------------
  // `wty.warranty-detail`
  // -------------------------------------------------------------------------

  /**
   * One warranty record with its covered items, policy code and coverage terms.
   *
   * There is no monetary field in the response because there is none in `wty` — not
   * a covered value, not a cap, not a currency. A "warranty value" would have to be
   * invented, and a caller would reasonably treat it as authoritative.
   *
   * `authorizeScope` runs after the read, against the record's own company and
   * branch. A record outside the caller's grants is invisible to RLS and reported as
   * `ERR-RES-001`, which is indistinguishable from "no such record" by design.
   */
  public async readWarranty(
    db: DbHandle,
    warrantyRecordId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<WarrantyView> {
    const found = await this.repository.findWarrantyRecord(db, warrantyRecordId);
    if (found === null) {
      throw new AppFailure('ERR-RES-001', {
        message: `Warranty record ${warrantyRecordId} is not visible`,
      });
    }
    const record = found.record;
    await authorizeScope({ companyId: record.companyId, branchId: record.branchId });

    const [policy, coverage] = await Promise.all([
      this.repository.findPolicy(db, record.companyId, record.policyId),
      this.repository.findCoverage(db, record.companyId, record.coverageId),
    ]);
    if (policy === null || coverage === null) {
      // Both are composite foreign keys into the record's own company, which the
      // caller demonstrably has scope for — so this is an inconsistency, not a 404.
      throw new AppFailure('ERR-SYS-001', {
        message: 'A warranty record cites a policy or coverage row that is not readable',
      });
    }
    return this.toView(record, policy, coverage, found.items, false);
  }

  // -------------------------------------------------------------------------
  // Internals.
  // -------------------------------------------------------------------------

  /**
   * The delivery, through the delivery module's public port.
   *
   * The single point of contact with `@/modules/delivery`, so the contract this
   * module depends on is stated in one place: a call taking the transaction handle
   * and a delivery id, answering the four facts in `WarrantyDeliveryFacts` or
   * nothing. Anything absent — or out of the caller's scope, which RLS makes the
   * same thing — is a uniform `ERR-RES-001`.
   *
   * The annotation admits `null` and `undefined` so the port may report an absent
   * delivery either way, or not at all; warranty generation treats all three the
   * same. Widening the annotation rather than casting keeps the compiler as the
   * thing that checks the contract — if the port ever stops answering the four facts
   * this module needs, this line fails to build instead of failing at run time.
   */
  private async deliveryFacts(
    db: DbHandle,
    deliveryRecordId: string
  ): Promise<WarrantyDeliveryFacts> {
    // `reads`, not the module root: the delivery port splits by direction, and the
    // handover fact is a read. Reaching for the root here compiled against an
    // imagined surface and was caught by `tsc` rather than at run time, which is the
    // argument for the widened annotation above.
    const facts: WarrantyDeliveryFacts | null | undefined =
      await deliveryModule().reads.deliveryForWarranty(db, deliveryRecordId);
    if (facts === null || facts === undefined) {
      throw new AppFailure('ERR-RES-001', {
        message: `Delivery ${deliveryRecordId} is not visible`,
      });
    }
    return facts;
  }

  /**
   * Returns the warranty an idempotency key already produced, or null.
   *
   * The lookup is tenant-wide because the unique index is; the checks after it are
   * what make that safe. A key that resolves to a DIFFERENT delivery is a key reused
   * for a different request, which `ERR-INT-001` exists for and which must never be
   * answered with someone else's warranty. And `authorizeScope` is re-run against the
   * existing record's own scope, because the caller was authorized for the delivery's
   * branch and the record — although the coherence guard ties the two together — is
   * the row actually being disclosed.
   */
  private async resolveReplay(
    db: DbHandle,
    input: GenerateWarrantyInput,
    authorizeScope: ScopeAuthorizer
  ): Promise<WarrantyView | null> {
    if (input.idempotencyKey === undefined) return null;
    const existing = await this.repository.findWarrantyRecordByIdempotencyKey(
      db,
      input.idempotencyKey
    );
    if (existing === null) return null;

    if (existing.deliveryRecordId !== input.deliveryRecordId) {
      throw new AppFailure('ERR-INT-001', {
        message:
          'This idempotency key already issued a warranty for a different delivery. Reuse a ' +
          'key only for an identical request.',
      });
    }
    if (input.policyId !== undefined && existing.policyId !== input.policyId) {
      throw new AppFailure('ERR-INT-001', {
        message:
          'This idempotency key already issued a warranty under a different policy. Reuse a ' +
          'key only for an identical request.',
      });
    }
    await authorizeScope({ companyId: existing.companyId, branchId: existing.branchId });

    const found = await this.repository.findWarrantyRecord(db, existing.id);
    if (found === null) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'A warranty record resolved by idempotency key could not be re-read',
      });
    }
    const [policy, coverage] = await Promise.all([
      this.repository.findPolicy(db, existing.companyId, existing.policyId),
      this.repository.findCoverage(db, existing.companyId, existing.coverageId),
    ]);
    if (policy === null || coverage === null) {
      throw new AppFailure('ERR-SYS-001', {
        message: 'A replayed warranty cites a policy or coverage row that is not readable',
      });
    }
    // No audit, no event, no item. The work was done by the original call and the
    // records it wrote are the record of it; a second set would say a second
    // warranty was issued.
    return this.toView(found.record, policy, coverage, found.items, true);
  }

  /**
   * The policy to issue under: the one the caller named, or the company's only one.
   *
   * There is no third branch. When a company has no active policy the operation is
   * refused as configuration (`ERR-RES-001`) because nothing the caller sends can
   * fix it; when it has more than one the caller must choose (`ERR-VAL-001`, with the
   * field named so the fix is obvious). Defaulting to "the newest" or "the first
   * alphabetically" would silently bind a customer to a duration nobody chose.
   *
   * The named-policy path deliberately does NOT filter on `status`, so an archived
   * policy reaches `assertPolicyActive` and produces a refusal that says so rather
   * than a 404 that does not.
   */
  private async resolvePolicy(
    db: DbHandle,
    companyId: string,
    policyId: string | undefined
  ): Promise<WarrantyPolicyRow> {
    if (policyId !== undefined) {
      const named = await this.repository.findPolicy(db, companyId, policyId);
      if (named === null) {
        throw new AppFailure('ERR-RES-001', {
          message: `Warranty policy ${policyId} is not visible in this company`,
        });
      }
      return named;
    }

    // Two is all that is needed: none, one, or "more than one".
    const candidates = await this.repository.listActivePolicies(db, companyId, 2);
    const only = candidates[0];
    if (only === undefined) {
      throw new AppFailure('ERR-RES-001', {
        message:
          'No active warranty policy is configured for this company. A policy and its ' +
          'effective-dated coverage are operator configuration; the backend does not create one.',
      });
    }
    if (candidates.length > 1) {
      throw new AppFailure('ERR-VAL-001', {
        message:
          'This company has more than one active warranty policy, so the policy to issue ' +
          'under must be named. It is never inferred.',
        safeDetails: { violations: [{ path: 'body.policyId', rule: 'custom' }] },
      });
    }
    return only;
  }

  /**
   * Refuses a second live warranty for the same delivery under the same policy.
   *
   * `ex_warranty_records_no_overlap` would refuse it anyway, as `23P01`. This
   * pre-check exists because the constraint's key is `(vehicle, coverage, daterange)`
   * and cannot say *why* in terms the caller recognises, while the far more common
   * case — the same delivery submitted twice without an idempotency key — is
   * expressible exactly. The constraint remains the enforcement point: an overlap
   * arising from a DIFFERENT delivery of the same vehicle is invisible here and is
   * caught by `toDomainFailure`.
   */
  private async refuseDuplicateForPolicy(
    db: DbHandle,
    delivery: WarrantyDeliveryFacts,
    deliveryRecordId: string,
    policyId: string
  ): Promise<void> {
    const existing = await this.repository.listWarrantiesForDelivery(
      db,
      delivery.companyId,
      delivery.branchId,
      deliveryRecordId
    );
    const live = existing.find(
      (row) => row.policyId === policyId && (row.status === 'issued' || row.status === 'active')
    );
    if (live !== undefined) {
      throw new AppFailure('ERR-CON-001', {
        message:
          'A live warranty has already been issued for this delivery under this policy. ' +
          'Supply an idempotency key to make a retry safe, or name a different policy.',
      });
    }
  }

  /**
   * Records one covered item per eligible delivered line.
   *
   * Eligibility is `coversItemKind` against the coverage's own `covered_scope`, and
   * an ineligible line produces NO item — a `covered_scope = 'part'` coverage
   * generates a warranty listing the parts and not the labour, because that is what
   * the operator configured. Nothing in the schema relates an item to a coverage, so
   * **this is the only place the rule is enforced.**
   *
   * The lines come from the work-order module's public port, for both kinds:
   * `wo.work_order_service_lines` and `wo.required_parts` are its tables and reading
   * them from here would be exactly the boundary violation ADR-001 forbids. Its
   * `lines()` re-resolves the work order and — because the scope authorizer is passed
   * through — re-authorizes against the work order's OWN company and branch, which
   * is a second, independent check that the delivery and the work order live in the
   * same place.
   *
   * A coverage that covers nothing this work order contains yields a record with no
   * items. That is a real outcome, not a failure: the warranty exists, and listing
   * nothing is more honest than listing lines the coverage does not pay for.
   */
  private async recordCoveredItems(
    db: DbHandle,
    record: WarrantyRecordRow,
    coverage: WarrantyCoverageRow,
    authorizeScope: ScopeAuthorizer
  ): Promise<readonly WarrantyRecordItemRow[]> {
    const workOrders = workOrderModule().workOrders;
    const eligible: Array<{ readonly kind: 'service' | 'part'; readonly line: LineRow }> = [];

    if (coversItemKind(coverage.coveredScope, 'service')) {
      const lines = await workOrders.lines(db, 'service', record.workOrderId, authorizeScope);
      for (const line of lines) eligible.push({ kind: 'service', line });
    }
    if (coversItemKind(coverage.coveredScope, 'part')) {
      const lines = await workOrders.lines(db, 'part', record.workOrderId, authorizeScope);
      for (const line of lines) eligible.push({ kind: 'part', line });
    }

    if (eligible.length > MAX_COVERED_ITEMS) {
      // Refused rather than truncated. A warranty that silently omits covered work
      // misstates the coverage it grants, and the caller cannot detect the omission.
      throw new AppFailure('ERR-TRN-001', {
        message:
          `This work order has ${eligible.length} lines the coverage would cover, more than ` +
          `the ${MAX_COVERED_ITEMS} a single warranty record may list. The warranty was not ` +
          'issued, because listing only some of the covered work would misstate the coverage.',
      });
    }

    const items: WarrantyRecordItemRow[] = [];
    for (const entry of eligible) {
      items.push(
        await this.repository.insertWarrantyRecordItem(db, {
          warrantyRecordId: record.id,
          // Taken from the record, never from the caller: the composite FK requires
          // the parent in the SAME tenant/company/branch.
          companyId: record.companyId,
          branchId: record.branchId,
          itemKind: entry.kind,
          // `source_job_id` is the job the line hangs off, for either kind — a
          // required part belongs to a job as much as a labour line does.
          sourceJobId: entry.line.jobId,
          // `source_part_id` is the `wo.required_parts` ROW, not the catalog item:
          // the row is what was delivered on this work order, and the item can be
          // reached through it. Null for a service line.
          sourcePartId: entry.kind === 'part' ? entry.line.id : null,
          description: entry.line.description,
        })
      );
    }
    return items;
  }

  /** Projects the record, its policy, its coverage and its items into one view. */
  private toView(
    record: WarrantyRecordRow,
    policy: WarrantyPolicyRow,
    coverage: WarrantyCoverageRow,
    items: readonly WarrantyRecordItemRow[],
    replayed: boolean
  ): WarrantyView {
    return {
      id: record.id,
      companyId: record.companyId,
      branchId: record.branchId,
      vehicleId: record.vehicleId,
      workOrderId: record.workOrderId,
      deliveryRecordId: record.deliveryRecordId,
      status: record.status,
      startDate: record.startDate,
      expiryDate: record.expiryDate,
      odometerAtIssue: record.odometerAtIssue,
      odometerLimit: record.odometerLimit,
      policy: {
        id: policy.id,
        policyCode: policy.policyCode,
        name: policy.name,
        status: policy.status,
      },
      coverage: {
        id: coverage.id,
        coveredScope: coverage.coveredScope,
        durationMonths: coverage.durationMonths,
        // RELATIVE, and renamed here so it cannot be mistaken for the record's
        // ABSOLUTE `odometerLimit` above.
        odometerAllowance: coverage.odometerLimit,
        effectiveFrom: coverage.effectiveFrom,
        effectiveTo: coverage.effectiveTo,
        status: coverage.status,
      },
      items: items.map((item) => ({
        id: item.id,
        itemKind: item.itemKind,
        sourceJobId: item.sourceJobId,
        sourcePartId: item.sourcePartId,
        description: item.description,
      })),
      recordVersion: record.recordVersion,
      replayed,
    };
  }
}
