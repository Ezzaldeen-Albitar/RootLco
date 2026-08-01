/**
 * Export estimation and permission probes (P1-15).
 *
 * The table name in the count query is interpolated, and that is safe here for
 * one specific reason: it comes from `EXPORT_RESOURCES`, a frozen code constant,
 * and never from a request. The registry entry is looked up by an exact string
 * match against the caller's `resource` code before this method is reached, so
 * an unregistered code cannot arrive. Every *value* is still a bound parameter.
 *
 * The count is bounded by construction — `LIMIT ceiling + 1` inside a subquery —
 * so a caller cannot make the database count ten million rows to be told the
 * answer is "too many". The `+ 1` is what distinguishes "exactly at the ceiling"
 * from "over it".
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export class ExportRepository extends Repository {
  protected readonly module = 'shared-services';

  /** True when the caller holds `permissionCode` anywhere in their scope. */
  async holdsPermission(db: DbHandle, permissionCode: string): Promise<boolean> {
    const row = await this.runOne<{ ok: boolean }>(db, `SELECT iam.has_permission($1) AS ok`, [
      permissionCode,
    ]);
    return row?.ok === true;
  }

  /** True when the caller holds `permissionCode` for a company/branch target. */
  async holdsPermissionInScope(
    db: DbHandle,
    permissionCode: string,
    companyId: string | null,
    branchId: string | null
  ): Promise<boolean> {
    const row = await this.runOne<{ ok: boolean }>(
      db,
      `SELECT iam.has_permission_in_scope($1, $2::uuid, $3::uuid) AS ok`,
      [permissionCode, companyId, branchId]
    );
    return row?.ok === true;
  }

  /**
   * Counts matching rows, stopping at `ceiling + 1`.
   *
   * Runs under RLS on the caller's own connection, so the count is of rows the
   * caller could actually read — which is what makes it a usable estimate rather
   * than a disclosure of how much data exists elsewhere.
   */
  async estimate(
    db: DbHandle,
    table: string,
    tenantColumn: string,
    predicate: string,
    values: readonly unknown[],
    ceiling: number
  ): Promise<{ rows: number; exceeded: boolean }> {
    const context = this.assertContext(db);
    const nextIndex = values.length + 2;
    const row = await this.runOne<{ n: string }>(
      db,
      `SELECT count(*) AS n
         FROM (
           SELECT 1
             FROM ${table}
            WHERE ${tenantColumn} = $1
              ${predicate}
            LIMIT $${nextIndex}
         ) AS bounded`,
      [context.principal.tenantId, ...values, ceiling + 1]
    );
    const rows = Number(row?.n ?? 0);
    return { rows: Math.min(rows, ceiling), exceeded: rows > ceiling };
  }
}
