/**
 * DBCR-P1-15-002 — how the allocation service reports the period guard.
 *
 * Migration 118 makes `shared.guard_number_sequence_regression()` refuse a
 * backwards `current_period`. That refusal is reachable from the allocation path
 * (only through a database host whose clock stepped backwards, since the
 * allocator now reads `clock_timestamp()`), and it aborts the transaction with
 * SQLSTATE 23514 having issued nothing.
 *
 * Left untranslated it would surface as `ERR-SYS-001`, which tells a caller
 * nothing and invites a retry loop against a fault. The correct client
 * behaviour is *retry in a new transaction*, which is what `ERR-CON-001` means.
 * This suite pins that mapping, and pins that the three pre-existing mappings
 * did not move.
 *
 * The repository is a stub: the point is the translation table, and the database
 * behaviour it translates is proved on the real role in
 * `tests/db/p1-15-number-sequence-period-hardening.test.ts`.
 */
import { describe, it, expect } from 'vitest';
import { NumberAllocationService } from '@/modules/shared-services/application/number-allocation-service';
import type { NumberSequenceRepository } from '@/modules/shared-services/data/number-sequence-repository';
import { ALLOCATION_SQLSTATE } from '@/modules/shared-services/data/number-sequence-repository';
import { AppFailure } from '@/server/errors/app-failure';
import type { DbHandle } from '@/server/db/transaction';

class DriverError extends Error {
  constructor(readonly code: string) {
    super(`stub driver error ${code}`);
  }
}

function serviceThatFailsWith(code: string): NumberAllocationService {
  const repository = {
    allocate: () => Promise.reject(new DriverError(code)),
  } as unknown as NumberSequenceRepository;
  return new NumberAllocationService(repository);
}

const DB = {} as DbHandle;

async function failureFor(code: string): Promise<AppFailure> {
  const service = serviceThatFailsWith(code);
  try {
    await service.allocate(DB, { sequenceCode: 'invoice' });
  } catch (error) {
    return error as AppFailure;
  }
  throw new Error('allocate resolved, but the stub repository always rejects');
}

describe('P1-15 number allocation — SQLSTATE translation', () => {
  it('exposes the period-regression state as part of the contract', () => {
    expect(ALLOCATION_SQLSTATE.periodRegression).toBe('23514');
  });

  it('reports the period guard as a retryable conflict, not a fault', async () => {
    const failure = await failureFor(ALLOCATION_SQLSTATE.periodRegression);
    expect(failure).toBeInstanceOf(AppFailure);
    expect(failure.code).toBe('ERR-CON-001');
    expect(failure.message).toContain('retry in a new transaction');
  });

  it('still reports an unprovisioned sequence as a missing resource', async () => {
    const failure = await failureFor(ALLOCATION_SQLSTATE.noSequenceInScope);
    expect(failure.code).toBe('ERR-RES-001');
  });

  it('still reports an out-of-scope company or branch as an authorization denial', async () => {
    const failure = await failureFor(ALLOCATION_SQLSTATE.scopeRefused);
    expect(failure.code).toBe('ERR-IAM-001');
  });

  it('does not swallow an unrecognised driver error', async () => {
    const failure = await failureFor('40001'); // serialization_failure
    expect(failure).toBeInstanceOf(DriverError);
    expect(failure).not.toBeInstanceOf(AppFailure);
  });

  it('never echoes the submitted sequence code in a failure message', async () => {
    const service = serviceThatFailsWith(ALLOCATION_SQLSTATE.periodRegression);
    await expect(
      service.allocate(DB, { sequenceCode: 'not_a_registered_code' })
    ).rejects.toMatchObject({ code: 'ERR-VAL-001' });
    await expect(
      service.allocate(DB, { sequenceCode: 'not_a_registered_code' })
    ).rejects.not.toMatchObject({ message: expect.stringContaining('not_a_registered_code') });
  });
});
