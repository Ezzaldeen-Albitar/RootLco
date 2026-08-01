/**
 * Reference repository (P1-13-BE-003).
 *
 * The exemplar deliberately reads **no business table**: `meta.ping` proves the
 * plumbing, and touching a domain table would make the reference endpoint a
 * business endpoint, which P1-13 is explicitly not allowed to deliver.
 *
 * What it does prove is the controlled-access contract end to end:
 *
 *  - it extends `Repository`, so the context guard runs before any statement;
 *  - its query is **tenant-scoped by an explicit predicate** as well as by RLS.
 *    `org.tenants` is readable under the caller's context, and the predicate
 *    `id = iam.current_tenant_id()` states the intent in the SQL. Belt and
 *    braces: RLS is the guarantee, the predicate is the declaration, and a test
 *    asserts both are present;
 *  - every value is bound, never interpolated;
 *  - the result is bounded — one row, by primary key.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface TenantScopeRow {
  readonly tenantId: string;
  readonly companyCount: number;
  readonly branchCount: number;
}

export class MetaRepository extends Repository {
  protected readonly module = 'meta';

  /**
   * Confirms the session context resolves inside the database and reports how
   * many companies/branches the request is narrowed to. Reads only `org.tenants`
   * plus the session's own context functions.
   */
  async readScope(db: DbHandle): Promise<TenantScopeRow | null> {
    const row = await this.runOne<{
      tenant_id: string;
      company_count: string;
      branch_count: string;
    }>(
      db,
      `SELECT t.id AS tenant_id,
              COALESCE(array_length(iam.current_company_ids(), 1), 0)::text AS company_count,
              COALESCE(array_length(iam.current_branch_ids(), 1), 0)::text  AS branch_count
         FROM org.tenants t
        WHERE t.id = iam.current_tenant_id()`
    );
    if (!row) return null;
    return {
      tenantId: row.tenant_id,
      companyCount: Number(row.company_count),
      branchCount: Number(row.branch_count),
    };
  }
}
