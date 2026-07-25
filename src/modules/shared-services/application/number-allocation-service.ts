/**
 * Display-number allocation (P1-15).
 *
 * ## Why this is an in-process service and not an endpoint
 *
 * The Number Sequence and Display Number Standard binds allocation to *the same
 * transaction as the business write that consumes the number*. A standalone
 * `POST /numbers` would commit a number that no document carries, producing a
 * permanent gap in a sequence whose whole purpose is to be gapless on issued
 * documents — and it would do so while *appearing* to promise gaplessness.
 *
 * So the contract is a service that takes an already-open `DbHandle`:
 *
 * ```ts
 * await withTransaction(context, async (db) => {
 *   const number = await sharedServices().numbers.allocate(db, { sequenceCode: 'invoice' });
 *   await invoices.insert(db, { ...input, invoiceNumber: number.displayNumber });
 * });
 * ```
 *
 * Rollback takes the allocation with it, because the counter advance and the
 * business insert are the same transaction. That is the guarantee; it is only
 * claimed where it holds.
 *
 * ## What the caller cannot control
 *
 * The tenant is never a parameter — `shared.next_display_number()` reads
 * `iam.current_tenant_id()`, which comes from the transaction-local context the
 * wrapper set. Prefix, pad width, and reset rule live on the sequence row and
 * are not inputs. The sequence code must be in the reviewed registry. Together
 * that leaves a caller with exactly one decision: *which* recognised sequence,
 * within a scope it already holds.
 */
import { ApplicationService } from '@/server/layering';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';
import { sqlState } from '@/server/db/repository';
import { log } from '@/server/observability/logger';
import { metrics, METRICS } from '@/server/observability/metrics';
import { ALLOCATION_SQLSTATE, NumberSequenceRepository } from '../data/number-sequence-repository';
import {
  findSequenceDefinition,
  SEQUENCE_CODE_PATTERN,
  type SequenceDefinition,
} from '../domain/sequence-registry';

export interface AllocateNumberInput {
  /** Must be a code registered in `domain/sequence-registry.ts`. */
  readonly sequenceCode: string;
  /** Company narrowing. Omit for the tenant-wide sequence. */
  readonly companyId?: string | null;
  /** Branch narrowing. Requires `companyId`, mirroring the table CHECK. */
  readonly branchId?: string | null;
}

export interface AllocatedNumber {
  /** Rendered number, e.g. `INV-2026-000042`. Presentation data, never a key. */
  readonly displayNumber: string;
  /** Raw counter value as a decimal string — `bigint` does not fit a JS number. */
  readonly sequenceValue: string;
  readonly sequenceCode: string;
}

export class NumberAllocationService extends ApplicationService {
  protected readonly module = 'shared-services';

  constructor(private readonly sequences: NumberSequenceRepository) {
    super();
  }

  /**
   * Allocates the next number for `sequenceCode` in the caller's transaction.
   *
   * Failures are mapped to stable catalog codes rather than surfaced as
   * SQLSTATEs: a caller can act on "not configured" and on "out of scope", and
   * can act on neither if both arrive as `ERR-SYS-001`.
   */
  async allocate(db: DbHandle, input: AllocateNumberInput): Promise<AllocatedNumber> {
    const definition = this.requireRegistered(input.sequenceCode);
    const companyId = input.companyId ?? null;
    const branchId = input.branchId ?? null;

    if (branchId !== null && companyId === null) {
      // Mirrors `ck_number_sequences_branch_requires_company`. Rejected here so
      // the caller gets a validation failure rather than a constraint violation.
      throw new AppFailure('ERR-VAL-001', {
        message: 'A branch-scoped allocation must also name its company',
        safeDetails: {
          violations: [{ path: 'branchId', rule: 'branch_requires_company' }],
        },
      });
    }

    let row;
    try {
      row = await this.sequences.allocate(db, {
        sequenceCode: definition.code,
        companyId,
        branchId,
      });
    } catch (error) {
      throw this.translate(error, definition);
    }

    if (!row) {
      // The function always returns one record or raises; a null row means the
      // contract changed underneath us, which is a fault, not a client error.
      throw new AppFailure('ERR-SYS-001', {
        message: `shared.next_display_number returned no row for "${definition.code}"`,
      });
    }

    metrics().increment(METRICS.numberAllocationCount, {
      sequence: definition.code,
      result: 'success',
    });
    // The sequence code is low-cardinality catalogue metadata; the allocated
    // number is business data and is deliberately absent from the log line.
    //
    // `scoped` is computed here rather than inline so the logged expression
    // names no identifier at all. `tests/foundation/p1-15-observability.test.ts`
    // scans these objects textually and refuses any expression that mentions a
    // company, tenant, document or key — a boolean *derived from* an identifier
    // is safe, but an exemption for it would be a hole, so the derivation moves
    // out of the log call instead.
    const scoped = companyId !== null;
    log.info('Display number allocated', {
      module: this.module,
      operation: db.context.operation,
      correlationId: db.context.correlationId,
      result: 'success',
      context: { sequence: definition.code, scoped },
    });

    return {
      displayNumber: row.display_number,
      sequenceValue: row.sequence_value,
      sequenceCode: definition.code,
    };
  }

  /**
   * Reports whether a sequence is provisioned in a scope, without allocating.
   *
   * Provisioning is an operator action (`app_runtime` holds no INSERT on
   * `shared.number_sequences`), so a module that needs to fail early — before
   * doing expensive work it would have to roll back — can ask first.
   */
  async isProvisioned(db: DbHandle, input: AllocateNumberInput): Promise<boolean> {
    const definition = this.requireRegistered(input.sequenceCode);
    const row = await this.sequences.describe(db, {
      sequenceCode: definition.code,
      companyId: input.companyId ?? null,
      branchId: input.branchId ?? null,
    });
    return row !== null;
  }

  private requireRegistered(code: string): SequenceDefinition {
    if (!SEQUENCE_CODE_PATTERN.test(code)) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'Sequence code does not match the platform code format',
        safeDetails: { violations: [{ path: 'sequenceCode', rule: 'invalid_format' }] },
      });
    }
    const definition = findSequenceDefinition(code);
    if (!definition) {
      // Never echoes the submitted code: it reaches logs, and an unrecognised
      // code is exactly the input a caller controls.
      throw new AppFailure('ERR-VAL-001', {
        message: 'Sequence code is not registered in the platform sequence registry',
        safeDetails: { violations: [{ path: 'sequenceCode', rule: 'unregistered_sequence' }] },
      });
    }
    return definition;
  }

  /**
   * Maps the SQLSTATEs the allocation path raises on purpose.
   *
   * `no_data_found` means the sequence is recognised but not provisioned in this
   * scope — a configuration gap the caller cannot fix by changing the request,
   * so it is reported as a missing resource rather than a validation failure.
   * `insufficient_privilege` means the requested company or branch is outside
   * the session's resolved scope, which is an authorization denial and is
   * reported with the same uniform shape as any other.
   * `check_violation` means the period guard refused to let the run move
   * backwards (DBCR-P1-15-002). The allocation is aborted, nothing is issued,
   * and the correct client behaviour is to retry in a fresh transaction — so it
   * is reported as a conflict rather than as a fault, which would say nothing.
   */
  private translate(error: unknown, definition: SequenceDefinition): unknown {
    const state = sqlState(error);
    if (state === ALLOCATION_SQLSTATE.periodRegression) {
      metrics().increment(METRICS.numberAllocationCount, {
        sequence: definition.code,
        result: 'period-regression',
      });
      return new AppFailure('ERR-CON-001', {
        message:
          'The sequence period moved backwards and the allocation was refused; retry in a new transaction',
        cause: error,
      });
    }
    if (state === ALLOCATION_SQLSTATE.noSequenceInScope) {
      metrics().increment(METRICS.numberAllocationCount, {
        sequence: definition.code,
        result: 'not-provisioned',
      });
      return new AppFailure('ERR-RES-001', {
        message: `No number sequence is provisioned for "${definition.code}" in this scope`,
        cause: error,
      });
    }
    if (state === ALLOCATION_SQLSTATE.scopeRefused) {
      metrics().increment(METRICS.numberAllocationCount, {
        sequence: definition.code,
        result: 'denied',
      });
      return new AppFailure('ERR-IAM-001', {
        message: 'The requested allocation scope is outside the session scope',
        cause: error,
      });
    }
    metrics().increment(METRICS.numberAllocationCount, {
      sequence: definition.code,
      result: 'failure',
    });
    return error;
  }
}
