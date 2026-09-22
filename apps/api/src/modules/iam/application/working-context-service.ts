/**
 * The working-context read (Owner directive, P1-32-PRE-OD-UX).
 *
 * Answers one question — *where may I work?* — for the caller itself, and nothing
 * else. See `WorkingContextRepository` for why it is guarded by `iam.user.read`
 * rather than by the administration reach codes, and why the narrowing is left to
 * row-level security.
 */
import type { DbHandle } from '@/server/db/transaction';
import type { RequestContext } from '@/server/context/request-context';
import { AppFailure } from '@/server/errors/app-failure';
import type {
  WorkingContextBranchRow,
  WorkingContextCompanyRow,
  WorkingContextRepository,
} from '../data/working-context-repository';

/** The wire shape of `GET /api/v1/auth/working-context`. */
export interface WorkingContextView {
  readonly tenantId: string;
  /**
   * Whether the caller holds a tenant-wide grant.
   *
   * Stated rather than inferred from the list lengths: a tenant that happens to
   * hold one company and one branch produces identical lists for a tenant-wide
   * operator and for a branch-scoped one, and a screen that guessed from the
   * lengths would be right until the tenant opened its second branch.
   */
  readonly unrestricted: boolean;
  readonly companies: readonly WorkingContextCompanyRow[];
  readonly branches: readonly WorkingContextBranchRow[];
}

export class WorkingContextService {
  constructor(private readonly workingContext: WorkingContextRepository) {}

  private contextOf(db: DbHandle): RequestContext {
    const context = db?.context;
    if (!context?.principal?.tenantId) {
      throw new AppFailure('ERR-CTX-001', {
        message: 'iam: working context requested without a resolved request context',
      });
    }
    return context;
  }

  /**
   * The caller's own companies and branches.
   *
   * A principal holding NO active grant is answered with two empty arrays and no
   * further statement. That is not an optimisation: the scope GUCs an unrestricted
   * operator and a grant-less principal arrive with are byte-identical — both
   * unset — so the policies would show the grant-less principal the whole tenant.
   * The grant shape is the only place the two differ, so it is read first and it
   * decides.
   */
  async describe(db: DbHandle): Promise<WorkingContextView> {
    const context = this.contextOf(db);
    const shape = await this.workingContext.readGrantShape(db);
    if (!shape.anyGrant) {
      return {
        tenantId: context.principal.tenantId,
        unrestricted: false,
        companies: [],
        branches: [],
      };
    }

    const companies = await this.workingContext.listCompanies(db);
    const branches = await this.workingContext.listBranches(db);
    const reachable = new Set(companies.map((company) => company.id));
    return {
      tenantId: context.principal.tenantId,
      unrestricted: shape.unrestricted,
      companies,
      // A branch whose company is inactive is dropped rather than published with a
      // `companyId` the same response does not name. A selector that offered one
      // would be a two-level choice whose first level is missing.
      branches: branches.filter((branch: WorkingContextBranchRow) =>
        reachable.has(branch.companyId)
      ),
    };
  }
}
