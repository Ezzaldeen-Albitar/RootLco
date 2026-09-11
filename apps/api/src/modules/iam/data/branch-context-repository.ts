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
}
