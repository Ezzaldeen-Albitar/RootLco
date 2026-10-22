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
  /**
   * The companies in `companies` whose settings this caller may read — where
   * `iam.company-settings-read` would answer rather than refuse. Empty when there
   * is none.
   *
   * Published because the session's permission codes cannot say it: a reader
   * holding `org.company.read` only through a branch grant holds the code and is
   * still refused a company's settings. The answer comes from
   * `OrganizationSettingsService.readableCompanySettingIds`, which asks the same
   * two checks the read enforces, so the list and the refusal cannot disagree.
   * Additive: a client that does not know the field loses nothing.
   */
  readonly companySettingsReadableIds: readonly string[];
  /**
   * Which of a few branch-scoped ACTION codes the caller holds in each published
   * branch (finance QA fixes D). See `BranchPermissionsView`. Additive: a client
   * that does not know the field loses nothing.
   */
  readonly branchPermissions: BranchPermissionsView;
}

/**
 * The codes a screen offers an action on per branch, published per branch.
 *
 * The session's `permissions` are the tenant-wide UNION: a holder of
 * `sal.credit.approve` in one branch only carries the code, so a screen gated on
 * the union offered Approve on another branch's credit note and the route
 * answered 403. These are the branch-scoped actions a screen offers on a
 * document of a particular branch; each is answered for every published branch
 * by `iam.has_permission_in_scope`, the function the action's own route asks, so
 * the published answer and the refusal cannot disagree. No new permission and no
 * new rule: the server stays the authority and still refuses on its own.
 *
 * A short declared list rather than every code the caller holds: the read runs
 * on every page, and codes times branches function calls for an administrator
 * holding every code would make each page pay for answers no screen asks.
 * `codes` travels on the wire so a client knows which codes are covered and
 * keeps its tenant-wide check for any other.
 */
export const BRANCH_GATED_PERMISSION_CODES = Object.freeze([
  // Approving or rejecting a credit note (`sal.credit-note-approve` / `-reject`).
  'sal.credit.approve',
  // Approving or rejecting a receipt reversal (`sal.receipt-reversal-approve` / `-reject`).
  'sal.reversal.approve',
  // Applying a receipt as a third-party payment (`sal.payment-allocate`, ADR-023 D14).
  'sal.payment.third_party',
  // Approving or rejecting a refund request (`sal.refund-approve` / `-reject`, ADR-023 D2).
  'sal.refund.approve',
] as const);

/** The per-branch answer for `BRANCH_GATED_PERMISSION_CODES`. */
export interface BranchPermissionsView {
  /** The codes answered below; any other code is not covered by this field. */
  readonly codes: readonly string[];
  /** Every published branch, each with the covered codes the caller holds there. */
  readonly branches: readonly BranchPermissionEntry[];
}

/** One branch's covered codes. */
export interface BranchPermissionEntry {
  readonly branchId: string;
  readonly permissions: readonly string[];
}

/** The one question the working context asks of the settings service. */
export interface CompanySettingsReach {
  readableCompanySettingIds(
    db: DbHandle,
    candidateCompanyIds: readonly string[]
  ): Promise<readonly string[]>;
}

export class WorkingContextService {
  constructor(
    private readonly workingContext: WorkingContextRepository,
    private readonly companySettings: CompanySettingsReach
  ) {}

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
        companySettingsReadableIds: [],
        branchPermissions: { codes: [...BRANCH_GATED_PERMISSION_CODES], branches: [] },
      };
    }

    const companies = await this.workingContext.listCompanies(db);
    const branches = await this.workingContext.listBranches(db);
    const reachable = new Set(companies.map((company) => company.id));
    // A branch whose company is inactive is dropped rather than published with a
    // `companyId` the same response does not name. A selector that offered one
    // would be a two-level choice whose first level is missing.
    const published = branches.filter((branch: WorkingContextBranchRow) =>
      reachable.has(branch.companyId)
    );
    const held =
      published.length === 0
        ? []
        : await this.workingContext.heldInBranches(
            db,
            BRANCH_GATED_PERMISSION_CODES,
            published.map((branch) => ({ companyId: branch.companyId, branchId: branch.id }))
          );
    return {
      tenantId: context.principal.tenantId,
      unrestricted: shape.unrestricted,
      companies,
      branches: published,
      branchPermissions: {
        codes: [...BRANCH_GATED_PERMISSION_CODES],
        branches: published.map((branch) => ({
          branchId: branch.id,
          permissions: held
            .filter((entry) => entry.branchId === branch.id)
            .map((entry) => entry.code),
        })),
      },
      companySettingsReadableIds: await this.companySettings.readableCompanySettingIds(
        db,
        companies.map((company) => company.id)
      ),
    };
  }
}
