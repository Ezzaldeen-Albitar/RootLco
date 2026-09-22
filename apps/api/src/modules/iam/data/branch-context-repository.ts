/**
 * Branch context — the organizational facts another module needs about ONE
 * branch (P1-31 prerequisite P-11).
 *
 * ## Why this port exists
 *
 * The report engine buckets a calendar period in the branch's own timezone, so
 * every run has to resolve `org.branches.timezone_name` for the branch it was
 * asked about. `org.*` is this module's schema (ADR-001 rule 3), and nothing on
 * the iam surface exposed a single-branch read: `listBranches` is the
 * administration REACH read, bounded by `ORG_REACH_LIMIT` and shaped for a
 * selector, and reading a whole page to find one row would be the wrong
 * question asked expensively.
 *
 * `pricing` and `service-catalog` each read `org.branches` in their own
 * repository, and that precedent is deliberately NOT extended here. Both read a
 * containment PREDICATE — does this branch belong to this company — which is a
 * boolean about structure. This reads two of the branch's own attributes, which
 * is the owning module's data, and duplicating that read would put a second
 * answer to "what timezone is this branch in" in the tree.
 *
 * ## Why it is a repository on the surface rather than a service
 *
 * It carries no rule. It is a read the owning module performs on behalf of
 * another — exactly what `reception`'s `PartyContextRepository` and inventory's
 * open-commitments port are — so wrapping it in a service would add a layer with
 * nothing in it.
 *
 * ## It is not an authorization decision, and cannot be used as one
 *
 * `sel_branches_scope` narrows `org.branches` by the tenant AND by the caller's
 * permission-blind `allowed_company_ids()` / `allowed_branch_ids()` union, so a
 * null answer means "not visible to this caller" and not "does not exist" — a
 * caller must not read existence out of it. The run service consults it only
 * AFTER it has evaluated the dataset's permission at the branch scope, so a
 * caller who cannot read the data never learns whether the branch is there.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

export interface BranchContextRow {
  readonly branchId: string;
  readonly companyId: string;
  /** `org.branches.name` — a single `text` column, with no localised variant. */
  readonly name: string;
  /** `org.branches.timezone_name`, an IANA zone constrained to `shared.timezones`. */
  readonly timezoneName: string;
}

export class BranchContextRepository extends Repository {
  protected readonly module = 'iam';

  /**
   * One branch of one company, or null when it is absent or out of the caller's
   * RLS reach.
   *
   * The company is part of the KEY rather than a returned field to be checked
   * afterwards. `iam.has_permission_in_scope` is disjunctive across grant
   * scopes, so a caller naming their own branch with another company's id
   * satisfies a permission check on the branch row alone; resolving the pair as
   * a pair is what makes an incoherent one answer nothing at all — the reason
   * `pricing` and `service-catalog` both refuse the pair before they use it.
   */
  async findBranch(
    db: DbHandle,
    scope: { readonly companyId: string; readonly branchId: string }
  ): Promise<BranchContextRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<{
      id: string;
      company_id: string;
      name: string;
      timezone_name: string;
    }>(
      db,
      `SELECT id, company_id, name, timezone_name
         FROM org.branches
        WHERE tenant_id = $1 AND company_id = $2 AND id = $3
          AND deleted_at IS NULL`,
      [context.principal.tenantId, scope.companyId, scope.branchId]
    );
    return row === null
      ? null
      : {
          branchId: row.id,
          companyId: row.company_id,
          name: row.name,
          timezoneName: row.timezone_name,
        };
  }

  /**
   * Every branch of ONE company that is within this caller's RLS reach.
   *
   * ## Why the reach read and not `listBranches`
   *
   * `OrganizationAdministrationRepository.listBranches` is the ADMINISTRATION
   * read: it is bounded by `ORG_REACH_LIMIT`, shaped for a selector, and gated
   * by an administration permission the operator of a workshop dashboard has no
   * reason to hold. This is the same two attributes `findBranch` already
   * publishes, asked for a company instead of for a branch, and it exists so a
   * consumer that must answer "for all the branches I can see" does not have to
   * ask for a page and hope it was long enough.
   *
   * ## It is NOT an authorization decision, and cannot be used as one
   *
   * Exactly as `findBranch` records. `sel_branches_scope` narrows on the
   * permission-BLIND `iam.allowed_company_ids()` / `allowed_branch_ids()` union
   * (P1-18-A-01), so a row appearing here means only that some active grant
   * touches that branch — never that the caller may read the data a consumer is
   * about to aggregate for it. A caller must evaluate its own permission
   * against each pair before it counts anything, which is what
   * `DashboardSummaryService` does and what this comment exists to make
   * unavoidable.
   *
   * UNBOUNDED, deliberately, and bounded in fact by the schema: a branch is an
   * organisational structure created by an administrator, not a transaction, so
   * the row count is the size of the organisation and not of its trading. A
   * keyset page here would hand a consumer a partial branch set with no way to
   * tell that it was partial, which for an aggregate is worse than a long read —
   * it is a wrong total that looks right.
   */
  async listBranchesForCompany(
    db: DbHandle,
    companyId: string
  ): Promise<readonly BranchContextRow[]> {
    const context = this.assertContext(db);
    const result = await this.run<{
      id: string;
      company_id: string;
      name: string;
      timezone_name: string;
    }>(
      db,
      `SELECT id, company_id, name, timezone_name
         FROM org.branches
        WHERE tenant_id = $1 AND company_id = $2
          AND deleted_at IS NULL
        ORDER BY name, id`,
      [context.principal.tenantId, companyId]
    );
    return result.rows.map((row) => ({
      branchId: row.id,
      companyId: row.company_id,
      name: row.name,
      timezoneName: row.timezone_name,
    }));
  }
}
