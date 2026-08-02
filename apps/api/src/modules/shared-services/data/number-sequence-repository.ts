/**
 * Number-sequence data access (P1-15).
 *
 * One statement, on purpose: the whole allocation — the `SELECT … FOR UPDATE`
 * that serialises concurrent allocators, the period-reset decision, the
 * increment, and the rendering — happens inside
 * `shared.next_display_number()`. Re-implementing any of it here would create a
 * second allocator that could disagree with the first, and the guard trigger
 * `shared.guard_number_sequence_regression()` would then be the only thing
 * standing between a bug and a re-issued invoice number.
 *
 * The function is `SECURITY INVOKER`, so it runs with the caller's privileges:
 * `app_runtime` holds `EXECUTE` on it, `SELECT` on the table, and a
 * **column-restricted** `UPDATE (next_value, current_period)` — verified
 * against the live catalog, not assumed. Everything else on the row (metadata,
 * `record_version`) is written by `shared.touch_row_metadata()`.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/** SQLSTATEs the allocation path raises deliberately. */
export const ALLOCATION_SQLSTATE = {
  /** `RAISE … USING ERRCODE = 'no_data_found'` — no sequence row in this scope. */
  noSequenceInScope: 'P0002',
  /** `RAISE … USING ERRCODE = 'insufficient_privilege'` — scope or context refused. */
  scopeRefused: '42501',
  /**
   * `check_violation`, raised by `shared.guard_number_sequence_regression()`.
   *
   * Reachable from the allocation path in exactly one situation, and only since
   * DBCR-P1-15-002 made it so: the row's `current_period` is *later* than the key
   * the allocator computes, so writing the computed key back would move the
   * period backwards. The allocator now reads `clock_timestamp()`, and every
   * allocator shares one database clock, so this cannot arise from a stale
   * transaction — it needs the host clock itself to have stepped backwards.
   *
   * It is mapped rather than left to surface as a fault because the correct
   * client behaviour is *retry in a new transaction*, and `ERR-SYS-001` does not
   * say that.
   */
  periodRegression: '23514',
} as const;

export interface AllocationRequest {
  readonly sequenceCode: string;
  /** Company narrowing. `null` selects the tenant-wide sequence row. */
  readonly companyId: string | null;
  /** Branch narrowing. `null` selects the company- or tenant-wide row. */
  readonly branchId: string | null;
}

export interface AllocationRow {
  readonly display_number: string;
  /** `bigint`, returned by the driver as a string so no precision is lost. */
  readonly sequence_value: string;
}

export class NumberSequenceRepository extends Repository {
  protected readonly module = 'shared-services';

  /**
   * Allocates the next number in the caller's transaction.
   *
   * There is no `COMMIT` here and there must never be one: the number is
   * consumed by the business row written in the same transaction, so a rollback
   * takes the allocation with it. Committing separately would leave a number
   * that no document carries — a gap that looks like a deleted record.
   */
  async allocate(db: DbHandle, request: AllocationRequest): Promise<AllocationRow | null> {
    return this.runOne<AllocationRow>(
      db,
      `SELECT display_number, sequence_value
         FROM shared.next_display_number(
                p_sequence_code => $1,
                p_company_id    => $2::uuid,
                p_branch_id     => $3::uuid)`,
      [request.sequenceCode, request.companyId, request.branchId]
    );
  }

  /**
   * Reads a sequence's configuration for diagnostics and tests.
   *
   * Deliberately does **not** return `next_value`: exposing the counter through
   * an application read would let a caller learn how many documents a tenant has
   * issued without allocating one, and nothing in P1-15 needs it.
   */
  async describe(
    db: DbHandle,
    request: AllocationRequest
  ): Promise<{
    readonly sequence_code: string;
    readonly prefix_template: string;
    readonly pad_width: number;
    readonly period_reset_rule: string;
  } | null> {
    const context = this.assertContext(db);
    return this.runOne(
      db,
      `SELECT sequence_code, prefix_template, pad_width, period_reset_rule
         FROM shared.number_sequences
        WHERE tenant_id = $1
          AND sequence_code = $2
          AND company_id IS NOT DISTINCT FROM $3::uuid
          AND branch_id  IS NOT DISTINCT FROM $4::uuid`,
      [context.principal.tenantId, request.sequenceCode, request.companyId, request.branchId]
    );
  }
}
