/**
 * Employee register data access (P1-31 prerequisite P-17).
 *
 * `org.employees` is the tenant-owned employee identity the Owner decision of
 * 2026-09-10 established: distinct from the login account, from the
 * authenticated actor, and from the authorized receiver of a vehicle. It is a
 * NEW table, and the reason it had to be new was measured rather than assumed —
 * `tech.technician_profiles.user_id` and `iam.user_employee_links.user_id` are
 * both NOT NULL foreign keys into `iam.user_accounts`, so neither can hold a
 * person who has no reason to sign in.
 *
 * ## Every read is narrowed by RLS, never by a WHERE the caller can influence
 *
 * `sel_employees_scope` carries the full
 * `tenant / allowed_company_ids / allowed_branch_ids` predicate and the session
 * GUCs behind it are pushed by `transaction.ts` from the resolved principal. The
 * `tenant_id = $1` in each statement below is a partition hint for the planner
 * and a second belt, not the control: re-implementing the reach rule here would
 * be wrong for the unrestricted case, where the allowed-ids list is empty and
 * means *everything* rather than *nothing*.
 *
 * ## There is no delete, and there is no `deleted_at` writer
 *
 * The migration grants DELETE to no application role and creates no delete
 * policy, because removing an employee would orphan the deliveries that cite
 * them — `fk_delivery_records_delivering_employee` is `ON DELETE RESTRICT` and
 * would refuse it anyway. Retirement is `status = 'inactive'`. The reads still
 * filter `deleted_at IS NULL` so that a row soft-deleted by a future operator
 * path is invisible on the day that path exists rather than on the day someone
 * remembers.
 */
import { Repository } from '@/server/db/repository';
import type { DbHandle } from '@/server/db/transaction';
import {
  buildPage,
  cursorTimestamp,
  keysetFragment,
  type OrderingContract,
  type Page,
  type PageRequest,
} from '@/server/db/pagination';

/** Newest employee first, tie-broken by id, so the order is total. */
export const EMPLOYEE_ORDER: OrderingContract = Object.freeze({
  key: 'org.employees:created_at_desc',
  direction: 'desc',
});

/** One employee, in the single shape every read and every write publishes. */
export interface EmployeeRow {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly displayName: string;
  /** NULL when this employee has no login account. That is the point of the table. */
  readonly userAccountId: string | null;
  readonly employmentRef: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

const EMPLOYEE_COLUMNS = `id, company_id, branch_id, display_name, user_account_id,
  employment_ref, status, record_version`;

const EMPLOYEE_PAGE_COLUMNS = `${EMPLOYEE_COLUMNS},
  ${cursorTimestamp('created_at')} AS created_at_cursor`;

interface EmployeeColumns {
  readonly id: string;
  readonly company_id: string;
  readonly branch_id: string;
  readonly display_name: string;
  readonly user_account_id: string | null;
  readonly employment_ref: string | null;
  readonly status: string;
  readonly record_version: number;
}

const toEmployee = (row: EmployeeColumns): EmployeeRow => ({
  id: row.id,
  companyId: row.company_id,
  branchId: row.branch_id,
  displayName: row.display_name,
  userAccountId: row.user_account_id,
  employmentRef: row.employment_ref,
  status: row.status,
  recordVersion: row.record_version,
});

export class EmployeeRepository extends Repository {
  protected readonly module = 'iam';

  /**
   * Inserts an employee.
   *
   * `status` is not a parameter: a created employee is active. Offering it would
   * let an administrator create a register row that is inert on arrival, which
   * is a state with no stated purpose — the same reasoning
   * `tech.technician-create` records for `is_active`.
   */
  async createEmployee(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly displayName: string;
      readonly userAccountId?: string | undefined;
      readonly employmentRef?: string | undefined;
    }
  ): Promise<EmployeeRow> {
    const context = this.assertContext(db);
    const row = await this.runOne<EmployeeColumns>(
      db,
      `INSERT INTO org.employees
         (tenant_id, company_id, branch_id, display_name, user_account_id, employment_ref, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING ${EMPLOYEE_COLUMNS}`,
      [
        // The tenant and the actor come from the resolved principal, never from
        // the request. `ins_employees_scope` re-checks the tenant regardless.
        context.principal.tenantId,
        input.companyId,
        input.branchId,
        input.displayName,
        input.userAccountId ?? null,
        input.employmentRef ?? null,
        context.principal.userId,
      ]
    );
    if (row === null) throw new Error('employee insert returned no row');
    return toEmployee(row);
  }

  /** One live employee, or null when absent or out of the session's reach. */
  async readEmployee(db: DbHandle, employeeId: string): Promise<EmployeeRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<EmployeeColumns>(
      db,
      `SELECT ${EMPLOYEE_COLUMNS}
         FROM org.employees
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, employeeId]
    );
    return row === null ? null : toEmployee(row);
  }

  /**
   * Moves an employee between `active` and `inactive`, under the version guard.
   *
   * A `null` return means one of two things — the row moved under the caller, or
   * it was never visible — and the service maps both to `ERR-CON-001`.
   * Distinguishing them would leak whether a resource exists, which
   * `authorization.ts` requires denials never to do.
   */
  async setStatus(
    db: DbHandle,
    employeeId: string,
    status: string,
    expectedVersion: number
  ): Promise<EmployeeRow | null> {
    const context = this.assertContext(db);
    const row = await this.runOne<EmployeeColumns>(
      db,
      `UPDATE org.employees
          SET status = $4
        WHERE tenant_id = $1 AND id = $2 AND record_version = $3 AND deleted_at IS NULL
        RETURNING ${EMPLOYEE_COLUMNS}`,
      [context.principal.tenantId, employeeId, expectedVersion, status]
    );
    return row === null ? null : toEmployee(row);
  }

  /** One keyset page of a branch's register, newest first. */
  async pageEmployees(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
    },
    page: PageRequest
  ): Promise<Page<EmployeeRow>> {
    const context = this.assertContext(db);
    const values: unknown[] = [
      context.principal.tenantId,
      filter.companyId,
      filter.branchId,
      filter.status ?? null,
    ];
    const keyset = keysetFragment(
      page,
      { sort: 'created_at', id: 'id' },
      EMPLOYEE_ORDER,
      values.length + 1
    );
    const result = await this.run<EmployeeColumns & { created_at_cursor: string }>(
      db,
      `SELECT ${EMPLOYEE_PAGE_COLUMNS}
         FROM org.employees
        WHERE tenant_id = $1 AND company_id = $2 AND branch_id = $3
          AND deleted_at IS NULL
          AND ($4::text IS NULL OR status = $4)
          ${keyset.predicate}
        ${keyset.order}
        ${keyset.limitClause}`,
      [...values, ...keyset.values]
    );
    const rows = result.rows.map((row) => ({
      ...toEmployee(row),
      cursor: row.created_at_cursor,
    }));
    return buildPage(rows, page, EMPLOYEE_ORDER, (row) => ({
      sortValue: row.cursor,
      id: row.id,
    }));
  }

  /**
   * Whether the company/branch pair is visible to THIS session.
   *
   * The read runs under `sel_branches_scope`, so it answers "reachable", not
   * "exists" — which is exactly the question the create needs to ask before it
   * trusts a pair that came from the request body. Duplicated from the
   * department repository's `branchIsReachable` rather than shared, because the
   * two repositories are separate write models and a shared private helper
   * across them would be a boundary this module does not have.
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

  /** Whether a user account exists in this tenant, as this session can see it. */
  async userAccountExists(db: DbHandle, userAccountId: string): Promise<boolean> {
    const context = this.assertContext(db);
    const row = await this.runOne<{ ok: boolean }>(
      db,
      `SELECT true AS ok FROM iam.user_accounts
        WHERE tenant_id = $1 AND id = $2 AND deleted_at IS NULL`,
      [context.principal.tenantId, userAccountId]
    );
    return row?.ok === true;
  }
}
