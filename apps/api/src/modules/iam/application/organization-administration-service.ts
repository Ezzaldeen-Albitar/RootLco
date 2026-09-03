/**
 * Company, branch and department administration (PRE-P1-29 Wave C).
 *
 * This service closes three canonical gaps at once, and it is worth naming what
 * each one actually was:
 *
 *  - **G-4** — `org.company.manage`, `org.branch.manage` and
 *    `org.department.manage` were seeded and guarded nothing. Not "guarded
 *    something weakly": they had zero references in the entire product, so
 *    holding one conferred exactly nothing.
 *  - **G-6** — `org.departments` had a table, policies, grants and a foreign key
 *    from `iam.grant_scopes`, and NO code path anywhere could insert a row. A
 *    grant could be scoped to a department that could never exist.
 *  - **P-1 / G-5** — the session published company and branch identifiers with
 *    no names and no operation returned the names, so a human-readable selector
 *    could not be built. The lists here are that operation.
 *
 * ## Every privileged operation appends its own audit record
 *
 * `route-handler.ts` writes NO audit record — `auditClass` and `auditAction` are
 * declaration metadata validated against a controlled catalogue, and nothing
 * else. PRE-P1-29 Wave B shipped two operations declaring `privileged` that
 * appended nothing for exactly this reason, and the defect was invisible to
 * every structural gate. So each mutation below calls `appendAudit` explicitly,
 * and the suite asserts a row DELTA rather than the declaration.
 *
 * ## What is deliberately NOT here
 *
 * No graph validation and no history insert for the company status change:
 * migration 133 owns both, its emitter refuses an UPDATE that publishes no
 * reason, and a TypeScript copy would be a second place for the rule to drift.
 * No tenant filter on the reads either — the RLS predicate is the reach rule,
 * and re-implementing it here would be wrong for the unrestricted case.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import type { AuthorizationTarget } from '@/server/auth/authorization';
import type {
  BranchChanges,
  BranchReachRow,
  BranchRecordRow,
  CompanyChanges,
  CompanyReachRow,
  CompanyRecordRow,
  DepartmentChanges,
  DepartmentRow,
  OrganizationAdministrationRepository,
} from '../data/organization-administration-repository';

/**
 * The wire shapes, re-exported under application-layer names.
 *
 * Aliases rather than empty extending interfaces: an interface that declares no
 * members is exactly its supertype, and the lint rule that says so is right.
 * The alias still gives the route a name to import, which is what the
 * named-wire-shapes gate asks for.
 */
export type CompanyReachView = CompanyReachRow;
export type BranchReachView = BranchReachRow;
export type CompanyRecordView = CompanyRecordRow;
export type BranchRecordView = BranchRecordRow;
export type DepartmentView = DepartmentRow;

/**
 * The response ENVELOPES, each named and exported.
 *
 * The named-wire-shapes gate asks for this and is right to: an inline
 * `Promise<{ items: ... }>` is invisible to the generated client and to anyone
 * reading the contract, so the shape that actually crosses the wire would have
 * no name anywhere in the repository.
 */
export interface CompanyListResult {
  readonly items: readonly CompanyReachView[];
}
export interface BranchListResult {
  readonly items: readonly BranchReachView[];
}
export interface DepartmentListResult {
  readonly items: readonly DepartmentView[];
}
export interface CompanyResult {
  readonly company: CompanyRecordView;
}
export interface BranchResult {
  readonly branch: BranchRecordView;
}
export interface DepartmentResult {
  readonly department: DepartmentView;
}

type ScopeAuthorizer = (target: AuthorizationTarget) => Promise<void>;

export class OrganizationAdministrationService {
  constructor(private readonly repository: OrganizationAdministrationRepository) {}

  // --- P-1: the reach lists -------------------------------------------------

  /**
   * The companies this actor may reach, by name.
   *
   * "May reach", not "exist": `sel_legal_companies_tenant` narrows by
   * `iam.allowed_company_ids()`, which the request context derives from the
   * actor's own active grants. An unrestricted actor sees the tenant's
   * companies; a company-scoped actor sees only theirs. One rule, one place.
   */
  async listCompanies(db: DbHandle): Promise<CompanyListResult> {
    return { items: await this.repository.listCompanies(db) };
  }

  /** The branches this actor may reach, by name, each under its company. */
  async listBranches(db: DbHandle): Promise<BranchListResult> {
    return { items: await this.repository.listBranches(db) };
  }

  // --- companies ------------------------------------------------------------

  async updateCompany(
    db: DbHandle,
    companyId: string,
    changes: CompanyChanges,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<CompanyResult> {
    // Resolved FIRST, then authorized against the row's OWN scope. A caller who
    // named a company they cannot reach is refused by the read, and one who can
    // reach it is re-checked against that company rather than against anything
    // they claimed — which is why no companyId travels in the body.
    const current = await this.repository.readCompany(db, companyId);
    if (current === null) throw notFound();
    await authorizeScope({ companyId: current.id });

    const updated = await this.repository.updateCompany(db, companyId, changes, expectedVersion);
    if (updated === null) throw stale();

    await appendAudit(db, {
      action: 'org.company.updated',
      entityType: 'org.legal_company',
      entityId: updated.id,
      details: auditChanges([
        ['legal_name', current.legalName, updated.legalName],
        ['base_currency_code', current.baseCurrencyCode, updated.baseCurrencyCode],
      ]),
    });

    return { company: updated };
  }

  /**
   * The sanctioned company transition, and the first caller
   * `org.change_company_status` has ever had.
   *
   * The function was granted to `app_runtime` when migration 133 landed and no
   * code called it — the "declared but never wired" class that dominated P1-27.
   */
  async setCompanyStatus(
    db: DbHandle,
    companyId: string,
    input: { readonly status: string; readonly reason: string },
    authorizeScope: ScopeAuthorizer
  ): Promise<CompanyResult> {
    const current = await this.repository.readCompany(db, companyId);
    if (current === null) throw notFound();
    await authorizeScope({ companyId: current.id });

    // No graph check here. org.change_company_status refuses a no-op, an unknown
    // destination and a blank reason itself, and its emitter writes the history
    // row — so a check in this method would be a second rule, not a safety net.
    await this.repository.changeCompanyStatus(db, companyId, input.status, input.reason);

    const updated = await this.repository.readCompany(db, companyId);
    if (updated === null) throw notFound();

    await appendAudit(db, {
      action: 'org.company.status_changed',
      entityType: 'org.legal_company',
      entityId: updated.id,
      details: [
        {
          field: 'status',
          classification: 'public',
          previousValue: current.status,
          value: updated.status,
        },
        // Operator-supplied justification, already stored verbatim in
        // org.company_status_history. Classified internal so the audit trail is
        // not the more exposed of the two copies.
        { field: 'reason', classification: 'internal', value: input.reason },
      ],
    });

    return { company: updated };
  }

  // --- branches -------------------------------------------------------------

  async updateBranch(
    db: DbHandle,
    branchId: string,
    changes: BranchChanges,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<BranchResult> {
    const current = await this.repository.readBranch(db, branchId);
    if (current === null) throw notFound();
    // Both halves of the pair, taken from the ROW. Passing only the branch would
    // leave the company unchecked, and `iam.has_permission_in_scope` treats an
    // absent company as unscoped.
    await authorizeScope({ companyId: current.companyId, branchId: current.id });

    const updated = await this.repository.updateBranch(db, branchId, changes, expectedVersion);
    if (updated === null) throw stale();

    await appendAudit(db, {
      action: 'org.branch.updated',
      entityType: 'org.branch',
      entityId: updated.id,
      details: auditChanges([
        ['name', current.name, updated.name],
        ['timezone_name', current.timezoneName, updated.timezoneName],
        ['city', current.city, updated.city],
        ['country_code', current.countryCode, updated.countryCode],
      ]),
    });

    return { branch: updated };
  }

  // --- departments ----------------------------------------------------------

  /**
   * Create is the only department operation that trusts the request for its
   * scope, and only because there is no row to resolve yet. The pair is
   * authorized BEFORE the insert, and `ins_departments_scope` is the backstop
   * behind that — the same arrangement `tech.technician-create` uses and for the
   * same reason.
   */
  async createDepartment(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly departmentCode: string;
      readonly name: string;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<DepartmentResult> {
    await authorizeScope({ companyId: input.companyId, branchId: input.branchId });

    // The pair is re-checked against what this session can actually SEE, before
    // the insert. authorizeScope alone is not enough: an actor holding
    // org.department.manage UNRESTRICTED in their own tenant satisfies the
    // permission for any pair they name, so a cross-tenant pair reached the
    // INSERT and was refused there — by a composite foreign key, as a 500.
    //
    // Measured, not theorised: this is what W24 reported before the check
    // existed. The write was never possible, but a denial arriving as a server
    // fault is still a defect — it reaches the error monitor as an incident and
    // tells the caller nothing.
    if (!(await this.repository.branchIsReachable(db, input.companyId, input.branchId))) {
      throw notFound();
    }

    let created;
    try {
      created = await this.repository.createDepartment(db, input);
    } catch (error) {
      // uq_departments_branch_code_live. A duplicate code is a caller conflict,
      // not a server fault, and route-handler sends every 5xx to the exception
      // monitor — so letting the 23505 through would be silent in the response
      // and noisy in the wrong place.
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-RES-002', {
          message: 'A department with that code already exists in this branch',
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'org.department.created',
      entityType: 'org.department',
      entityId: created.id,
      details: [
        { field: 'department_code', classification: 'public', value: created.departmentCode },
        { field: 'name', classification: 'public', value: created.name },
      ],
    });

    return { department: created };
  }

  async listDepartments(
    db: DbHandle,
    scope: { readonly companyId: string; readonly branchId: string }
  ): Promise<DepartmentListResult> {
    return { items: await this.repository.listDepartments(db, scope) };
  }

  async updateDepartment(
    db: DbHandle,
    departmentId: string,
    changes: DepartmentChanges,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<DepartmentResult> {
    const current = await this.repository.readDepartment(db, departmentId);
    if (current === null) throw notFound();
    await authorizeScope({ companyId: current.companyId, branchId: current.branchId });

    const updated = await this.repository.updateDepartment(
      db,
      departmentId,
      changes,
      expectedVersion
    );
    if (updated === null) throw stale();

    await appendAudit(db, {
      action: 'org.department.updated',
      entityType: 'org.department',
      entityId: updated.id,
      details: auditChanges([
        ['name', current.name, updated.name],
        ['status', current.status, updated.status],
      ]),
    });

    return { department: updated };
  }
}

/**
 * A uniform refusal for "you cannot reach this row".
 *
 * ERR-IAM-001 rather than a 404, because `authorization.ts` requires a denial
 * never to reveal whether the target exists. A caller outside the scope and a
 * caller naming a random uuid must be told the same thing.
 */
function notFound(): AppFailure {
  return new AppFailure('ERR-IAM-001', { message: 'The target is not reachable in this scope' });
}

function stale(): AppFailure {
  return new AppFailure('ERR-CON-001', {
    message: 'The record changed since it was read',
  });
}

/** Only the fields that actually moved, so the trail records changes not echoes. */
function auditChanges(
  fields: readonly (readonly [string, string | null, string | null])[]
): readonly {
  field: string;
  classification: 'public';
  previousValue: string | null;
  value: string | null;
}[] {
  return fields
    .filter(([, before, after]) => before !== after)
    .map(([field, before, after]) => ({
      field,
      classification: 'public' as const,
      previousValue: before,
      value: after,
    }));
}
