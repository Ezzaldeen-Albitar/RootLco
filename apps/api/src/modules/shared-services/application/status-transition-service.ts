/**
 * Status-transition engine (P1-15).
 *
 * One method, one transaction, six steps in a fixed order:
 *
 *   resolve definition → load snapshot → check origin → move state (version
 *   guarded) → append module-owned history → audit → publish event
 *
 * The order is the design. State moves *before* history is written so a failed
 * version guard costs nothing; history and audit are written *inside* the same
 * transaction so a committed state change without its history is not
 * representable; the outbox row goes last so the event exists if and only if the
 * whole thing committed (BR-INT-001).
 *
 * ## What a caller cannot do
 *
 * Name an unregistered aggregate or target state (there is no graph to extend at
 * runtime). Skip a state (`from` is an explicit list, and the current state must
 * be in it). Supply the actor or the timestamp (the history trigger overwrites
 * both from the session). Move a row it cannot see (RLS) or in a scope it does
 * not hold (the operation's scope requirement plus the branch RLS predicate).
 * Win a race with a stale version (the guard's `record_version` predicate).
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { assertVersionMatched } from '@/server/db/concurrency';
import { appendAudit } from '@/server/audit/audit';
import { publishEvent } from '@/server/events/publisher';
import { log } from '@/server/observability/logger';
import { metrics, METRICS } from '@/server/observability/metrics';
import {
  findAggregate,
  findTransition,
  MAX_TRANSITION_REASON,
  reachableStates,
  type TransitionDefinition,
} from '../domain/transitions';
import type { AggregateSnapshot, TransitionAdapter } from '../data/transition-repository';

export interface ApplyTransitionInput {
  /** Registered aggregate, e.g. `org.branch`. */
  readonly aggregate: string;
  readonly id: string;
  readonly to: string;
  /** Required where the history column demands one. Stored verbatim. */
  readonly reason: string;
  /** Expected `record_version` from `If-Match`. */
  readonly expectedVersion: number;
}

export interface TransitionResult {
  readonly aggregate: string;
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly recordVersion: number;
  /** Target states now reachable. Lets a client render its next options. */
  readonly nextStates: readonly string[];
}

export class StatusTransitionService extends ApplicationService {
  protected readonly module = 'shared-services';

  private readonly adapters: ReadonlyMap<string, TransitionAdapter>;

  constructor(adapters: readonly TransitionAdapter[]) {
    super();
    this.adapters = new Map(adapters.map((adapter) => [adapter.aggregate, adapter]));
  }

  /** Registered aggregates that have an adapter installed. */
  supportedAggregates(): readonly string[] {
    return [...this.adapters.keys()].sort();
  }

  async apply(db: DbHandle, input: ApplyTransitionInput): Promise<TransitionResult> {
    const definition = this.resolve(input);
    const adapter = this.adapters.get(input.aggregate);
    if (!adapter) {
      // Registered in the domain but with no adapter wired: a composition bug,
      // never a caller error.
      throw new AppFailure('ERR-SYS-001', {
        message: `No transition adapter is installed for aggregate "${input.aggregate}"`,
      });
    }

    const reason = input.reason.trim();
    if (definition.requiresReason && reason.length === 0) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'This transition requires a reason',
        safeDetails: { violations: [{ path: 'body.reason', rule: 'required' }] },
      });
    }
    if (reason.length > MAX_TRANSITION_REASON) {
      throw new AppFailure('ERR-VAL-001', {
        message: `Reason may be at most ${MAX_TRANSITION_REASON} characters`,
        safeDetails: { violations: [{ path: 'body.reason', rule: 'too_long' }] },
      });
    }

    const snapshot = await adapter.load(db, input.id);
    if (!snapshot) {
      // Out of scope and non-existent are deliberately indistinguishable.
      throw new AppFailure('ERR-RES-001', { message: 'Aggregate not found in the caller scope' });
    }

    // The origin check below reads `snapshot`, and the UPDATE further down is
    // guarded by `expectedVersion`. Comparing them here makes the two agree
    // *before* anything is written (P1-15-SR-012): otherwise a caller whose
    // `If-Match` is stale still passes the origin check against a state they did
    // not observe, and only the UPDATE's row count catches it — after the shape
    // of the decision has already been settled on a version the caller never
    // saw. Refusing first also gives the caller the conflict rather than an
    // origin-state message about a row that has since moved.
    if (snapshot.recordVersion !== input.expectedVersion) {
      throw new AppFailure('ERR-CON-001', {
        message: 'The aggregate changed since it was read',
      });
    }

    if (!definition.from.includes(snapshot.state)) {
      metrics().increment(METRICS.transitionConflictCount, {
        aggregate: definition.aggregate,
        to: definition.to,
        reason: snapshot.state === definition.to ? 'already-in-state' : 'invalid-origin',
      });
      throw new AppFailure('ERR-TRN-001', {
        message: `Cannot move to "${definition.to}" from "${snapshot.state}"`,
      });
    }

    const affected = await adapter.applyState(db, {
      id: input.id,
      to: definition.to,
      expectedVersion: input.expectedVersion,
    });
    // Zero rows means a stale version OR a row that moved out of scope between
    // the load and the update. Both are conflicts; distinguishing them would
    // leak which one happened.
    assertVersionMatched(affected);

    await adapter.recordHistory(db, {
      id: input.id,
      from: snapshot.state,
      to: definition.to,
      reason,
    });

    await appendAudit(db, {
      action: definition.auditAction,
      entityType: definition.aggregate,
      entityId: input.id,
      companyId: snapshot.companyId,
      branchId: snapshot.branchId,
      details: [
        {
          field: 'status',
          classification: 'internal',
          previousValue: snapshot.state,
          value: definition.to,
        },
        // The reason is operator-authored free text about a business decision.
        // `internal` rather than `public`: it may name a person or a dispute.
        { field: 'reason', classification: 'internal', value: reason },
      ],
    });

    if (definition.eventType) {
      await publishEvent(db, {
        eventType: definition.eventType,
        aggregateId: input.id,
        aggregateVersion: input.expectedVersion + 1,
        producer: 'shared.transitions',
        // No reason and no free text in the payload: an event is replicated
        // further than the row it describes, and a consumer that needs the
        // reason can read the history under its own authorization.
        payload: { from: snapshot.state, to: definition.to },
        eventKey: `${definition.aggregate}:${input.id}:${input.expectedVersion + 1}`,
        companyId: snapshot.companyId,
        branchId: snapshot.branchId,
      });
    }

    metrics().increment(METRICS.transitionCount, {
      aggregate: definition.aggregate,
      to: definition.to,
      result: 'success',
    });
    log.info('Status transition applied', {
      module: this.module,
      operation: db.context.operation,
      correlationId: db.context.correlationId,
      result: 'success',
      context: { aggregate: definition.aggregate, from: snapshot.state, to: definition.to },
    });

    return {
      aggregate: definition.aggregate,
      id: input.id,
      from: snapshot.state,
      to: definition.to,
      recordVersion: input.expectedVersion + 1,
      nextStates: reachableStates(definition.aggregate, definition.to),
    };
  }

  /** Reads current state and options without changing anything. */
  async describe(
    db: DbHandle,
    aggregate: string,
    id: string
  ): Promise<{ state: string; recordVersion: number; nextStates: readonly string[] }> {
    if (!findAggregate(aggregate)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Aggregate is not registered with the transition engine',
        safeDetails: { violations: [{ path: 'aggregate', rule: 'unregistered_aggregate' }] },
      });
    }
    const adapter = this.adapters.get(aggregate);
    const snapshot: AggregateSnapshot | null = adapter ? await adapter.load(db, id) : null;
    if (!snapshot) {
      throw new AppFailure('ERR-RES-001', { message: 'Aggregate not found in the caller scope' });
    }
    return {
      state: snapshot.state,
      recordVersion: snapshot.recordVersion,
      nextStates: reachableStates(aggregate, snapshot.state),
    };
  }

  private resolve(input: ApplyTransitionInput): TransitionDefinition {
    if (!findAggregate(input.aggregate)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Aggregate is not registered with the transition engine',
        safeDetails: { violations: [{ path: 'aggregate', rule: 'unregistered_aggregate' }] },
      });
    }
    const definition = findTransition(input.aggregate, input.to);
    if (!definition) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Target state is not registered for this aggregate',
        safeDetails: { violations: [{ path: 'body.to', rule: 'unregistered_transition' }] },
      });
    }
    return definition;
  }
}
