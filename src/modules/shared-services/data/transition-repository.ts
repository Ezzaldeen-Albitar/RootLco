/**
 * Status-transition adapters (P1-15).
 *
 * The engine never writes SQL. Each aggregate supplies an adapter with three
 * jobs — load the snapshot, move the state under a version guard, append the
 * module-owned history row — and the engine sequences them inside one
 * transaction with the audit record and the outbox event.
 *
 * Why an adapter per aggregate instead of one generic writer: the history tables
 * differ in shape and in guard, and the guards are the point. Driving them
 * through a single `INSERT INTO {table}` would mean interpolating a table name
 * and losing every column-level check that makes those histories trustworthy.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/** What the engine needs to know about an aggregate before deciding. */
export interface AggregateSnapshot {
  readonly id: string;
  readonly state: string;
  readonly recordVersion: number;
  readonly companyId: string | null;
  readonly branchId: string | null;
}

export interface TransitionAdapter {
  /** Matches `TransitionDefinition.aggregate`. */
  readonly aggregate: string;
  load(db: DbHandle, id: string): Promise<AggregateSnapshot | null>;
  /** Version-guarded state change. Returns the affected row count. */
  applyState(
    db: DbHandle,
    input: { readonly id: string; readonly to: string; readonly expectedVersion: number }
  ): Promise<number>;
  /** Appends the module-owned history row. */
  recordHistory(
    db: DbHandle,
    input: {
      readonly id: string;
      readonly from: string;
      readonly to: string;
      readonly reason: string;
    }
  ): Promise<void>;
}

/**
 * `org.branch` adapter.
 *
 * The history table is `org.branch_status_history`, which is exactly the kind of
 * table the generic `shared.status_history` is not: a real composite FK to
 * `(tenant_id, branch_id)`, a CHECK restricting both states to the branch state
 * set, a `from_state IS DISTINCT FROM to_state` guard, a mandatory non-blank
 * reason, and `org.stamp_branch_history()` overwriting `actor_id` and
 * `occurred_at` from the session — so neither the actor nor the time of a
 * recorded change can be supplied by the caller.
 */
export class BranchTransitionAdapter extends Repository implements TransitionAdapter {
  protected readonly module = 'shared-services';
  public readonly aggregate = 'org.branch';

  async load(db: DbHandle, id: string): Promise<AggregateSnapshot | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      status: string;
      record_version: number;
      company_id: string;
    }>(
      db,
      `SELECT id, status, record_version, company_id
         FROM org.branches
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, id]
    );
    if (!row) return null;
    return {
      id: row.id,
      state: row.status,
      recordVersion: row.record_version,
      companyId: row.company_id,
      branchId: row.id,
    };
  }

  async applyState(
    db: DbHandle,
    input: { readonly id: string; readonly to: string; readonly expectedVersion: number }
  ): Promise<number> {
    const context = this.assertContext(db);
    // `record_version` is not incremented here: shared.touch_row_metadata()
    // advances it in a BEFORE trigger, so doing it in the SET list would double it.
    const result = await this.run(
      db,
      `UPDATE org.branches
          SET status = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND deleted_at IS NULL`,
      [context.principal.tenantId, input.id, input.expectedVersion, input.to]
    );
    return result.rowCount ?? 0;
  }

  async recordHistory(
    db: DbHandle,
    input: {
      readonly id: string;
      readonly from: string;
      readonly to: string;
      readonly reason: string;
    }
  ): Promise<void> {
    const context = this.assertContext(db);
    // `actor_id` and `occurred_at` are supplied because the columns are NOT NULL,
    // and are then OVERWRITTEN by org.stamp_branch_history() from the session —
    // which is what makes them unforgeable. The correlation id is carried so the
    // history row joins to the audit record and the request log.
    await this.run(
      db,
      `INSERT INTO org.branch_status_history
         (tenant_id, branch_id, from_state, to_state, reason, actor_id, correlation_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        context.principal.tenantId,
        input.id,
        input.from,
        input.to,
        input.reason,
        context.principal.userId,
        context.correlationId,
      ]
    );
  }

  /** History rows for a branch, newest first. Used by tests and by the API. */
  async history(
    db: DbHandle,
    branchId: string,
    limit: number
  ): Promise<readonly { from_state: string | null; to_state: string; reason: string }[]> {
    const context = this.assertContext(db);
    const result = await this.run<{ from_state: string | null; to_state: string; reason: string }>(
      db,
      `SELECT from_state, to_state, reason
         FROM org.branch_status_history
        WHERE tenant_id = $1 AND branch_id = $2
        ORDER BY occurred_at DESC
        LIMIT $3`,
      [context.principal.tenantId, branchId, limit]
    );
    return result.rows;
  }
}
