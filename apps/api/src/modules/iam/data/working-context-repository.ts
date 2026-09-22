/**
 * The caller's own working context — the companies and branches it may act in
 * (Owner directive, P1-32-PRE-OD-UX).
 *
 * ## Why this is not `org.company-list` plus `org.branch-list`
 *
 * Those two reads are the ADMINISTRATION reach: they answer "which organisational
 * rows may this administrator maintain", and they are guarded by `org.company.read`
 * and `org.branch.read`. A receptionist holds neither, and never should — yet every
 * branch-scoped screen has to know which branch it is showing before it can ask for
 * anything at all. Requiring an administration permission to answer "where do I
 * work" would either lock the product's own navigation behind administration rights
 * or push the tenant towards granting them, which is the wrong direction for a rule
 * that exists to restrain administration.
 *
 * So this read is guarded by `iam.user.read` — the same code the session read
 * carries — and it publishes nothing beyond the caller's own reach. Everything it
 * returns was resolved server-side from the caller's grants, so it discloses no
 * fact the caller does not already hold.
 *
 * ## The reach rule lives in row-level security, not in this file
 *
 * `sel_legal_companies_tenant` narrows `org.legal_companies` by the tenant AND by
 * `iam.allowed_company_ids()`; `sel_branches_scope` narrows `org.branches` by the
 * tenant, by `iam.allowed_company_ids()` and by `iam.allowed_branch_ids()`. Those
 * GUCs are the caller's resolved grant union, set by the request transaction and
 * never read from the request. Restating the union as a TypeScript predicate would
 * be a second definition of scope that can drift from the policy; the queries below
 * carry the tenant predicate as defence in depth and let the policy do the
 * narrowing, exactly as `BranchContextRepository` does.
 *
 * ## An unrestricted caller and a grant-less one are NOT the same empty
 *
 * `iam.allowed_company_ids()` returns NULL for an unset GUC, and the policies read
 * NULL as "no narrowing" — so both a tenant-wide operator and a principal holding
 * no grant at all arrive at the policy with the same empty context and would be
 * shown the whole tenant. For a tenant-wide operator that is correct. For a
 * grant-less principal it is not: it holds no authority anywhere, and the honest
 * answer to "where do I work" is nowhere.
 *
 * The two are distinguished HERE, from `iam.role_grants`, because only the grant
 * rows carry `scope_mode` and the GUC does not. `readGrantShape` asks the same
 * question `resolveScopeFor` asks — the same table, the same validity window, the
 * same `status = 'active'` — and the service refuses to run either list when the
 * caller holds no active grant.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/**
 * A defensive ceiling on both lists, matching `ORG_REACH_LIMIT`.
 *
 * Not pagination: a working context is a selector, not a browsable index, and a
 * tenant holds a handful of companies and branches. The ceiling exists so a
 * pathological tenant cannot turn a selector into an unbounded read.
 */
export const WORKING_CONTEXT_LIMIT = 500;

/** One company the caller may act in. */
export interface WorkingContextCompanyRow {
  readonly id: string;
  /** `org.legal_companies.legal_name`. */
  readonly name: string;
  /** `org.legal_companies.company_code`. Nullable on the wire, never in the column. */
  readonly code: string | null;
}

/** One branch the caller may act in. */
export interface WorkingContextBranchRow {
  readonly id: string;
  readonly companyId: string;
  /** `org.branches.branch_code`. */
  readonly code: string;
  readonly name: string;
  readonly city: string | null;
  /** `org.branches.timezone_name`, an IANA zone constrained to `shared.timezones`. */
  readonly timezone: string;
  readonly status: string;
}

/** What the caller's active grants say about the SHAPE of its reach. */
export interface GrantShape {
  /** At least one active grant carries `scope_mode = 'unrestricted'`. */
  readonly unrestricted: boolean;
  /** At least one active grant exists at all. */
  readonly anyGrant: boolean;
}

export class WorkingContextRepository extends Repository {
  protected readonly module = 'iam';

  /**
   * Whether the caller holds any active grant, and whether any of them is
   * tenant-wide.
   *
   * The validity window is part of the question, not a filter applied afterwards:
   * a grant whose `valid_to` has passed is not a grant, and `resolveScopeFor`
   * already excludes it from the scope GUCs. Asking the same question the same way
   * keeps this answer and the policy's narrowing describing one principal.
   */
  async readGrantShape(db: DbHandle): Promise<GrantShape> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ unrestricted: boolean; any_grant: boolean }>(
      db,
      `SELECT
          COALESCE(bool_or(g.scope_mode = 'unrestricted'), false) AS unrestricted,
          COUNT(*) > 0                                            AS any_grant
         FROM iam.role_grants g
        WHERE g.tenant_id = $1
          AND g.user_id   = $2
          AND g.status    = 'active'
          AND g.valid_from <= now()
          AND (g.valid_to IS NULL OR g.valid_to > now())`,
      [context.principal.tenantId, context.principal.userId]
    );
    return {
      unrestricted: row?.unrestricted === true,
      anyGrant: row?.any_grant === true,
    };
  }

  /**
   * The ACTIVE companies inside the caller's reach.
   *
   * `status = 'active'` rather than every row: an inactive company is not a place
   * work can be booked into, and offering one in a selector would invite a write
   * the domain will refuse later. A soft-deleted one is excluded for the same
   * reason the rest of this module excludes it.
   */
  async listCompanies(db: DbHandle): Promise<readonly WorkingContextCompanyRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{ id: string; legal_name: string; company_code: string }>(
      db,
      `SELECT id, legal_name, company_code
         FROM org.legal_companies
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND status = 'active'
        ORDER BY legal_name, id
        LIMIT ${WORKING_CONTEXT_LIMIT}`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      name: row.legal_name,
      code: row.company_code,
    }));
  }

  /**
   * The ACTIVE branches inside the caller's reach.
   *
   * `companyId` travels with every row because a branch name is only unambiguous
   * underneath its company: two companies in one tenant may each have a branch
   * called the same thing.
   */
  async listBranches(db: DbHandle): Promise<readonly WorkingContextBranchRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      company_id: string;
      branch_code: string;
      name: string;
      city: string | null;
      timezone_name: string;
      status: string;
    }>(
      db,
      `SELECT id, company_id, branch_code, name, city, timezone_name, status
         FROM org.branches
        WHERE tenant_id = $1
          AND deleted_at IS NULL
          AND status = 'active'
        ORDER BY name, id
        LIMIT ${WORKING_CONTEXT_LIMIT}`,
      [context.principal.tenantId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      code: row.branch_code,
      name: row.name,
      city: row.city,
      timezone: row.timezone_name,
      status: row.status,
    }));
  }
}
