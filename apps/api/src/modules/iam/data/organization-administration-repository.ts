/**
 * Company, branch and department ADMINISTRATION data access (PRE-P1-29 Wave C).
 *
 * Separate from `organization-repository.ts`, which owns settings. That file's
 * header explains why settings are append-only version rows; none of that
 * applies here, and folding administration into it would put two unrelated
 * write models behind one class.
 *
 * ## Every read is narrowed by RLS, never by a WHERE the caller can influence
 *
 * `sel_legal_companies_tenant`, `sel_branches_scope` and `sel_departments_scope`
 * each carry the full `tenant / allowed_company_ids / allowed_branch_ids`
 * predicate, and the session GUCs behind them are pushed by `transaction.ts`
 * from the resolved principal. So "the companies you may reach" is computed in
 * ONE place, in the database, and this file must not re-implement it in
 * TypeScript — a second copy would be wrong for the unrestricted case, where the
 * allowed-ids list is empty and means *everything*, not *nothing*.
 *
 * That is also why the list queries carry no tenant predicate of their own. It
 * would be redundant at best; at worst it would look like the control and
 * outlive the policy that actually is one.
 *
 * ## Why the updates return a row rather than a count
 *
 * Each UPDATE is guarded by `record_version` and returns the updated row. A
 * `null` return therefore means one of two things — the row moved under the
 * caller, or it was never visible — and the service maps both to `ERR-CON-001`.
 * Distinguishing them would leak whether a resource exists, which
 * `authorization.ts` requires denials never to do.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';

/** A company as the reach list publishes it. Names, not internals. */
export interface CompanyReachRow {
  readonly id: string;
  readonly companyCode: string;
  readonly legalName: string;
  readonly status: string;
}

/** A company as an administration write returns it. */
export interface CompanyRecordRow extends CompanyReachRow {
  readonly baseCurrencyCode: string;
  readonly recordVersion: number;
}

/** A branch as the reach list publishes it. */
export interface BranchReachRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchCode: string;
  readonly name: string;
  readonly city: string | null;
  readonly countryCode: string | null;
  readonly timezoneName: string;
  readonly status: string;
}

/** A branch as an administration write returns it. */
export interface BranchRecordRow extends BranchReachRow {
  readonly addressLine1: string | null;
  readonly addressLine2: string | null;
  readonly region: string | null;
  readonly postalCode: string | null;
  readonly recordVersion: number;
}

/** A department, in the one shape both the read and the writes publish. */
export interface DepartmentRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly departmentCode: string;
  readonly name: string;
  readonly status: string;
  readonly recordVersion: number;
}

/** Fields a company update may carry. Everything else is refused at the route. */
export interface CompanyChanges {
  readonly legalName?: string | undefined;
  readonly baseCurrencyCode?: string | undefined;
  readonly registrationNumber?: string | null | undefined;
  readonly taxRegistrationNumber?: string | null | undefined;
}

/** Fields a branch update may carry. */
export interface BranchChanges {
  readonly name?: string | undefined;
  readonly addressLine1?: string | null | undefined;
  readonly addressLine2?: string | null | undefined;
  readonly city?: string | null | undefined;
  readonly region?: string | null | undefined;
  readonly postalCode?: string | null | undefined;
  readonly countryCode?: string | null | undefined;
  readonly timezoneName?: string | undefined;
}

/** Fields a department update may carry — the only two that are not immutable. */
export interface DepartmentChanges {
  readonly name?: string | undefined;
  readonly status?: string | undefined;
}

/**
 * A defensive ceiling on the reach lists.
 *
 * Not pagination: a tenant holds a handful of legal entities, and the selector
 * these lists exist to feed is a dropdown rather than a browsable index. The
 * ceiling is here so a pathological tenant cannot turn a selector into an
 * unbounded read, and it is deliberately far above any plausible real value so
 * that reaching it is a signal rather than a routine truncation.
 */
export const ORG_REACH_LIMIT = 500;

export class OrganizationAdministrationRepository extends Repository {
  protected readonly module = 'iam';

  // --- companies ------------------------------------------------------------

  async listCompanies(db: DbHandle): Promise<readonly CompanyReachRow[]> {
    const result = await this.run<{
      id: string;
      company_code: string;
      legal_name: string;
      status: string;
    }>(
      db,
      `SELECT id, company_code, legal_name, status
         FROM org.legal_companies
        WHERE deleted_at IS NULL
        ORDER BY legal_name, id
        LIMIT ${ORG_REACH_LIMIT}`
    );
    return result.rows.map((row) => ({
      id: row.id,
      companyCode: row.company_code,
      legalName: row.legal_name,
      status: row.status,
    }));
  }

  async readCompany(db: DbHandle, companyId: string): Promise<CompanyRecordRow | null> {
    const row = await this.runOne<{
      id: string;
      company_code: string;
      legal_name: string;
      base_currency_code: string;
      status: string;
      record_version: number;
    }>(
      db,
      `SELECT id, company_code, legal_name, base_currency_code, status, record_version
         FROM org.legal_companies WHERE id = $1 AND deleted_at IS NULL`,
      [companyId]
    );
    return row === null ? null : toCompanyRecord(row);
  }

  /**
   * `status` is absent from the SET list on purpose, not by omission: a status
   * change must go through org.change_company_status so that migration 133's
   * emitter writes the history row. An UPDATE here that touched status would be
   * refused anyway — the emitter raises without `app.status_reason` — but the
   * column is left out so the refusal is a design statement rather than an
   * accident of a missing GUC.
   */
  async updateCompany(
    db: DbHandle,
    companyId: string,
    changes: CompanyChanges,
    expectedVersion: number
  ): Promise<CompanyRecordRow | null> {
    const row = await this.runOne<{
      id: string;
      company_code: string;
      legal_name: string;
      base_currency_code: string;
      status: string;
      record_version: number;
    }>(
      db,
      `UPDATE org.legal_companies
          SET legal_name              = COALESCE($3, legal_name),
              base_currency_code      = COALESCE($4, base_currency_code),
              registration_number     = CASE WHEN $5::boolean THEN $6 ELSE registration_number END,
              tax_registration_number = CASE WHEN $7::boolean THEN $8 ELSE tax_registration_number END
        WHERE id = $1 AND record_version = $2 AND deleted_at IS NULL
        RETURNING id, company_code, legal_name, base_currency_code, status, record_version`,
      [
        companyId,
        expectedVersion,
        changes.legalName ?? null,
        changes.baseCurrencyCode ?? null,
        // Two parameters per nullable field: a CASE on "was the key present"
        // rather than COALESCE, because these columns are legitimately settable
        // to NULL and COALESCE cannot distinguish "clear it" from "leave it".
        changes.registrationNumber !== undefined,
        changes.registrationNumber ?? null,
        changes.taxRegistrationNumber !== undefined,
        changes.taxRegistrationNumber ?? null,
      ]
    );
    return row === null ? null : toCompanyRecord(row);
  }

  /**
   * The sanctioned transition. TypeScript validates nothing about the graph and
   * inserts no history: migration 133 owns both, and a second copy here would be
   * a place for them to drift.
   */
  async changeCompanyStatus(
    db: DbHandle,
    companyId: string,
    toState: string,
    reason: string
  ): Promise<void> {
    await this.run(db, `SELECT org.change_company_status($1, $2, $3)`, [
      companyId,
      toState,
      reason,
    ]);
  }

  // --- branches -------------------------------------------------------------

  async listBranches(db: DbHandle): Promise<readonly BranchReachRow[]> {
    const result = await this.run<{
      id: string;
      company_id: string;
      branch_code: string;
      name: string;
      city: string | null;
      country_code: string | null;
      timezone_name: string;
      status: string;
    }>(
      db,
      `SELECT id, company_id, branch_code, name, city, country_code, timezone_name, status
         FROM org.branches
        WHERE deleted_at IS NULL
        ORDER BY name, id
        LIMIT ${ORG_REACH_LIMIT}`
    );
    // company_id travels with every row because P-1's selector is a two-level
    // choice: a branch name is only unambiguous underneath its company.
    return result.rows.map((row) => ({
      id: row.id,
      companyId: row.company_id,
      branchCode: row.branch_code,
      name: row.name,
      city: row.city,
      countryCode: row.country_code,
      timezoneName: row.timezone_name,
      status: row.status,
    }));
  }

  async readBranch(db: DbHandle, branchId: string): Promise<BranchRecordRow | null> {
    const row = await this.runOne<BranchColumns>(
      db,
      `${BRANCH_SELECT} FROM org.branches WHERE id = $1 AND deleted_at IS NULL`,
      [branchId]
    );
    return row === null ? null : toBranchRecord(row);
  }

  /**
   * `status` is absent for the reason the branch precedent already established:
   * `shared.branch-status-change` owns it, and duplicating a transition in a
   * general update is how two paths acquire two different rules.
   */
  async updateBranch(
    db: DbHandle,
    branchId: string,
    changes: BranchChanges,
    expectedVersion: number
  ): Promise<BranchRecordRow | null> {
    const row = await this.runOne<BranchColumns>(
      db,
      `UPDATE org.branches
          SET name          = COALESCE($3, name),
              timezone_name = COALESCE($4, timezone_name),
              address_line1 = CASE WHEN $5::boolean  THEN $6  ELSE address_line1 END,
              address_line2 = CASE WHEN $7::boolean  THEN $8  ELSE address_line2 END,
              city          = CASE WHEN $9::boolean  THEN $10 ELSE city END,
              region        = CASE WHEN $11::boolean THEN $12 ELSE region END,
              postal_code   = CASE WHEN $13::boolean THEN $14 ELSE postal_code END,
              country_code  = CASE WHEN $15::boolean THEN $16 ELSE country_code END
        WHERE id = $1 AND record_version = $2 AND deleted_at IS NULL
        RETURNING id, company_id, branch_code, name, address_line1, address_line2, city,
                  region, postal_code, country_code, timezone_name, status, record_version`,
      [
        branchId,
        expectedVersion,
        changes.name ?? null,
        changes.timezoneName ?? null,
        changes.addressLine1 !== undefined,
        changes.addressLine1 ?? null,
        changes.addressLine2 !== undefined,
        changes.addressLine2 ?? null,
        changes.city !== undefined,
        changes.city ?? null,
        changes.region !== undefined,
        changes.region ?? null,
        changes.postalCode !== undefined,
        changes.postalCode ?? null,
        changes.countryCode !== undefined,
        changes.countryCode ?? null,
      ]
    );
    return row === null ? null : toBranchRecord(row);
  }

  // --- departments ----------------------------------------------------------

  /**
   * The first INSERT into org.departments that has ever existed in the product.
   * Before this, the table, its policies and its grants were all present and no
   * code path could put a row in one — which is why a grant could name a
   * department that could not be created.
   */
  /**
   * Whether the company/branch pair is visible to THIS session.
   *
   * The read runs under `sel_branches_scope`, so it answers "reachable", not
   * "exists" — which is exactly the question the create needs to ask before it
   * trusts a pair that came from the request body.
   */
  async branchIsReachable(db: DbHandle, companyId: string, branchId: string): Promise<boolean> {
    const row = await this.runOne<{ ok: boolean }>(
      db,
      `SELECT true AS ok FROM org.branches
        WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [branchId, companyId]
    );
    return row?.ok === true;
  }

  async createDepartment(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly departmentCode: string;
      readonly name: string;
    }
  ): Promise<DepartmentRow> {
    const row = await this.runOne<DepartmentColumns>(
      db,
      `INSERT INTO org.departments
         (tenant_id, company_id, branch_id, department_code, name, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, company_id, branch_id, department_code, name, status, record_version`,
      [
        // The tenant and the actor come from the resolved principal, never from
        // the request. ins_departments_scope re-checks the tenant regardless.
        db.context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.departmentCode,
        input.name,
        db.context.principal.userId,
      ]
    );
    if (row === null) throw new Error('department insert returned no row');
    return toDepartment(row);
  }

  async listDepartments(
    db: DbHandle,
    scope: { readonly companyId: string; readonly branchId: string }
  ): Promise<readonly DepartmentRow[]> {
    const result = await this.run<DepartmentColumns>(
      db,
      `SELECT id, company_id, branch_id, department_code, name, status, record_version
         FROM org.departments
        WHERE company_id = $1 AND branch_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
        ORDER BY name, id
        LIMIT ${ORG_REACH_LIMIT}`,
      [scope.companyId, scope.branchId]
    );
    return result.rows.map(toDepartment);
  }

  async readDepartment(db: DbHandle, departmentId: string): Promise<DepartmentRow | null> {
    const row = await this.runOne<DepartmentColumns>(
      db,
      `SELECT id, company_id, branch_id, department_code, name, status, record_version
         FROM org.departments WHERE id = $1 AND deleted_at IS NULL`,
      [departmentId]
    );
    return row === null ? null : toDepartment(row);
  }

  /**
   * Only `name` and `status` are settable, and that is the schema's ruling
   * rather than a policy of this file: tg_departments_immutable freezes
   * tenant_id, company_id, branch_id, department_code, created_at and
   * created_by, so a department cannot be renamed into another branch and its
   * code cannot be recycled by editing it.
   */
  async updateDepartment(
    db: DbHandle,
    departmentId: string,
    changes: DepartmentChanges,
    expectedVersion: number
  ): Promise<DepartmentRow | null> {
    const row = await this.runOne<DepartmentColumns>(
      db,
      `UPDATE org.departments
          SET name   = COALESCE($3, name),
              status = COALESCE($4, status)
        WHERE id = $1 AND record_version = $2 AND deleted_at IS NULL
        RETURNING id, company_id, branch_id, department_code, name, status, record_version`,
      [departmentId, expectedVersion, changes.name ?? null, changes.status ?? null]
    );
    return row === null ? null : toDepartment(row);
  }
}

interface BranchColumns {
  readonly id: string;
  readonly company_id: string;
  readonly branch_code: string;
  readonly name: string;
  readonly address_line1: string | null;
  readonly address_line2: string | null;
  readonly city: string | null;
  readonly region: string | null;
  readonly postal_code: string | null;
  readonly country_code: string | null;
  readonly timezone_name: string;
  readonly status: string;
  readonly record_version: number;
}

interface DepartmentColumns {
  readonly id: string;
  readonly company_id: string;
  readonly branch_id: string;
  readonly department_code: string;
  readonly name: string;
  readonly status: string;
  readonly record_version: number;
}

const BRANCH_SELECT = `SELECT id, company_id, branch_code, name, address_line1, address_line2,
                              city, region, postal_code, country_code, timezone_name, status,
                              record_version`;

function toCompanyRecord(row: {
  readonly id: string;
  readonly company_code: string;
  readonly legal_name: string;
  readonly base_currency_code: string;
  readonly status: string;
  readonly record_version: number;
}): CompanyRecordRow {
  return {
    id: row.id,
    companyCode: row.company_code,
    legalName: row.legal_name,
    baseCurrencyCode: row.base_currency_code,
    status: row.status,
    recordVersion: row.record_version,
  };
}

function toBranchRecord(row: BranchColumns): BranchRecordRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchCode: row.branch_code,
    name: row.name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    region: row.region,
    postalCode: row.postal_code,
    countryCode: row.country_code,
    timezoneName: row.timezone_name,
    status: row.status,
    recordVersion: row.record_version,
  };
}

function toDepartment(row: DepartmentColumns): DepartmentRow {
  return {
    id: row.id,
    companyId: row.company_id,
    branchId: row.branch_id,
    departmentCode: row.department_code,
    name: row.name,
    status: row.status,
    recordVersion: row.record_version,
  };
}
