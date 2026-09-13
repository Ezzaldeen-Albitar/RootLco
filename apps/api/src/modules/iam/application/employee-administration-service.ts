/**
 * Employee register administration (P1-31 prerequisite P-17).
 *
 * The Owner decision of 2026-09-10 settled what a *delivering employee* is: a
 * TENANT-OWNED IDENTITY, distinct from the login account, from the
 * authenticated actor, and from the authorized receiver of a vehicle, with a
 * server-validated reference and organisational assignment, and with historical
 * attribution preserved. This service is the whole of the surface that creates
 * and retires one; `org.employees` is the table.
 *
 * ## Why a new table, measured rather than assumed
 *
 * `tech.technician_profiles.user_id` and `iam.user_employee_links.user_id` are
 * both NOT NULL foreign keys into `iam.user_accounts`. Either would have been
 * cheaper to reuse and neither can represent a person with no reason to sign in,
 * which is precisely the person a workshop most often sends out to hand a
 * vehicle over. That is the entire justification, and it is a measurement.
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
 * ## One refusal for "you cannot see this employee"
 *
 * Absent, soft-deleted, in another branch this caller cannot reach, and in
 * another tenant are ONE `ERR-RES-001`, decided before any scope decision. That
 * follows `wty.warranty-policy-read`, the newest read in the repository to face
 * the same question, and it is what stops the register becoming an existence
 * oracle for another tenant's roster.
 *
 * Since the Owner clarification of 2026-09-10 that uniformity is the
 * APPLICATION's work rather than a side effect of RLS. `sel_employees_tenant`
 * reads tenant-wide — it has to, because an employee's home branch must not
 * restrict authorized work in another branch, and the delivery module resolves
 * a colleague from anywhere in the tenant through that same policy. So the two
 * row-addressed operations here re-authorize the row's own company and branch
 * and answer a scope refusal with the SAME not-found the register gives an
 * absent id, instead of letting a 403 confirm that the employee exists.
 *
 * ## What is deliberately NOT here
 *
 * No rename and no transfer. Both are legitimate acts and neither has an Owner
 * decision behind it yet: a rename would have to state what happens to the
 * display-name snapshots already taken on past handovers, and a transfer would
 * have to state what happens to deliveries recorded in the branch the employee
 * is leaving. Shipping either without that answer would settle it by accident.
 * `branch_id` is left MUTABLE by the schema so that a transfer command can be
 * added without a second migration; nothing here writes it.
 *
 * No delete, at any level. The migration grants DELETE to no application role,
 * and `fk_delivery_records_delivering_employee` is `ON DELETE RESTRICT`.
 * Retirement is `status = 'inactive'`, which keeps every past handover readable.
 */
import { AppFailure } from '@/server/errors/app-failure';
import { appendAudit } from '@/server/audit/audit';
import { SQLSTATE, isSqlState } from '@/server/db/repository';
import { pageRequest, type Page } from '@/server/db/pagination';
import type { DbHandle } from '@/server/db/transaction';
import type { AuthorizationTarget } from '@/server/auth/authorization';
import {
  EMPLOYEE_ORDER,
  type EmployeeRepository,
  type EmployeeRow,
} from '../data/employee-repository';

/**
 * The employee as every operation on this surface publishes it.
 *
 * An alias rather than an empty extending interface: an interface that declares
 * no members is exactly its supertype, and the lint rule that says so is right.
 * The alias still gives the routes a name to import, which is what the
 * named-wire-shapes gate asks for.
 */
export type EmployeeView = EmployeeRow;

/**
 * The projection another module needs to decide whether an employee may be
 * named on a record it owns.
 *
 * Deliberately narrower than `EmployeeView`: it carries no `employmentRef` and
 * no `recordVersion`, because a caller deciding "may this person be named here"
 * has no use for either and publishing them would make this port a second read
 * surface for the register.
 *
 * It carries no `companyId` and no `branchId` either, and that omission is a
 * rule rather than economy. The Owner clarification of 2026-09-10 settled that
 * an employee's home branch never decides whether they may be named on work
 * elsewhere in their own tenant, so a consumer of this port has no legitimate
 * use for it — and a field that is present is a field a future rule can start
 * comparing.
 */
export interface EmployeeAssignmentView {
  readonly id: string;
  readonly displayName: string;
  readonly status: string;
}

/** The two statuses `ck_employees_status` admits. Retire and reinstate are one verb. */
export const EMPLOYEE_STATUSES = Object.freeze(['active', 'inactive'] as const);

/** Mirrors the column widths the routes validate against. */
export const MAX_EMPLOYEE_DISPLAY_NAME = 200;
export const MAX_EMPLOYEE_EMPLOYMENT_REF = 64;

type ScopeAuthorizer = (target: AuthorizationTarget) => Promise<void>;

export class EmployeeAdministrationService {
  constructor(private readonly repository: EmployeeRepository) {}

  /**
   * One keyset page of a branch's register.
   *
   * The company/branch pair is authorized at the ROUTE through
   * `scopeTargetOption`, on the `org.department-list` and `tech.technician-list`
   * precedent: `scope: 'branch'` is inert without a target, because
   * `requiresScopedEvaluation` returns false on an empty one whatever the
   * declaration says.
   */
  async listEmployees(
    db: DbHandle,
    filter: {
      readonly companyId: string;
      readonly branchId: string;
      readonly status?: string | undefined;
      readonly cursor?: string | undefined;
      readonly limit?: number | undefined;
    }
  ): Promise<Page<EmployeeView>> {
    return this.repository.pageEmployees(
      db,
      { companyId: filter.companyId, branchId: filter.branchId, status: filter.status },
      pageRequest(EMPLOYEE_ORDER, { limit: filter.limit, cursor: filter.cursor })
    );
  }

  /** One employee, re-authorized against the row's OWN company and branch. */
  async readEmployee(
    db: DbHandle,
    employeeId: string,
    authorizeScope: ScopeAuthorizer
  ): Promise<EmployeeView> {
    const employee = await this.repository.readEmployee(db, employeeId);
    if (employee === null) throw notFound();
    // BOTH halves of the pair, taken from the ROW. Passing only the branch would
    // leave the company unchecked, and `iam.has_permission_in_scope` treats an
    // absent company as unscoped.
    await authorizeScopeAsNotFound(authorizeScope, {
      companyId: employee.companyId,
      branchId: employee.branchId,
    });
    return employee;
  }

  /**
   * Creates an employee.
   *
   * Create is the only employee operation that trusts the request for its scope,
   * and only because there is no row to resolve yet. The pair is authorized
   * BEFORE the insert and `ins_employees_scope` is the backstop behind it — the
   * arrangement `tech.technician-create` and `org.department-create` both use.
   */
  async createEmployee(
    db: DbHandle,
    input: {
      readonly companyId: string;
      readonly branchId: string;
      readonly displayName: string;
      readonly userAccountId?: string | undefined;
      readonly employmentRef?: string | undefined;
    },
    authorizeScope: ScopeAuthorizer
  ): Promise<EmployeeView> {
    await authorizeScope({ companyId: input.companyId, branchId: input.branchId });

    // The pair is re-checked against what this session can actually SEE, before
    // the insert. `authorizeScope` alone is not enough: an actor holding
    // `org.employee.manage` UNRESTRICTED in their own tenant satisfies the
    // permission for any pair they name, so a cross-tenant pair would reach the
    // INSERT and be refused there — by a composite foreign key, as a 500. That
    // is the defect W24 reported on the department create before its own check
    // existed; the write was never possible, but a denial arriving as a server
    // fault reaches the error monitor as an incident and tells the caller
    // nothing.
    if (!(await this.repository.branchIsReachable(db, input.companyId, input.branchId))) {
      throw notFound();
    }

    // Same argument for the optional account link, and one more: the composite
    // key `(tenant_id, user_account_id)` makes a foreign account a 23503, and a
    // caller who mistyped an id deserves to be told which field is wrong.
    if (
      input.userAccountId !== undefined &&
      !(await this.repository.userAccountExists(db, input.userAccountId))
    ) {
      throw new AppFailure('ERR-VAL-001', {
        message: 'The named user account is not visible in this tenant',
        safeDetails: { violations: [{ path: 'body.userAccountId', rule: 'custom' }] },
      });
    }

    let created: EmployeeRow;
    try {
      created = await this.repository.createEmployee(db, input);
    } catch (error) {
      // `uq_employees_user_account_live` and `uq_employees_employment_ref_live`.
      // A duplicate is a caller conflict, not a server fault, and route-handler
      // sends every 5xx to the exception monitor — so letting the 23505 through
      // would be silent in the response and noisy in the wrong place.
      if (isSqlState(error, SQLSTATE.uniqueViolation)) {
        throw new AppFailure('ERR-RES-002', {
          message:
            'An employee already holds that user account or employment reference in this tenant',
        });
      }
      throw error;
    }

    await appendAudit(db, {
      action: 'org.employee.created',
      entityType: 'org.employee',
      entityId: created.id,
      companyId: created.companyId,
      branchId: created.branchId,
      details: [
        // The display name is the organisation's own label for a person, so it
        // is `internal` rather than `public` — the classification
        // `iam.user_accounts.display_name` already carries.
        { field: 'display_name', classification: 'internal', value: created.displayName },
        { field: 'status', classification: 'public', value: created.status },
        {
          field: 'user_account_id',
          classification: 'internal',
          value: created.userAccountId,
        },
      ],
    });

    return created;
  }

  /**
   * Retires or reinstates an employee, under the mandatory version guard.
   *
   * Bidirectional, and that is not a convenience: `status` is the ONLY retirement
   * this table has — there is no delete and no archive — so a one-way command
   * would make a mistaken retirement permanent.
   */
  async setStatus(
    db: DbHandle,
    employeeId: string,
    status: string,
    expectedVersion: number,
    authorizeScope: ScopeAuthorizer
  ): Promise<EmployeeView> {
    const current = await this.repository.readEmployee(db, employeeId);
    if (current === null) throw notFound();
    await authorizeScopeAsNotFound(authorizeScope, {
      companyId: current.companyId,
      branchId: current.branchId,
    });

    const updated = await this.repository.setStatus(db, employeeId, status, expectedVersion);
    if (updated === null) throw stale();

    await appendAudit(db, {
      action: 'org.employee.status_changed',
      entityType: 'org.employee',
      entityId: updated.id,
      companyId: updated.companyId,
      branchId: updated.branchId,
      details: [
        {
          field: 'status',
          classification: 'public',
          previousValue: current.status,
          value: updated.status,
        },
      ],
    });

    return updated;
  }

  /**
   * The port another module calls to decide whether it may name this employee.
   *
   * Returns `null` for absent, soft-deleted and another tenant alike, because
   * the caller must not be able to tell them apart — and because the caller's
   * own refusal is a field-level validation failure rather than a scope
   * decision. The scope is the TENANT: `sel_employees_tenant` is what bounds
   * this read, and no branch or company predicate narrows it, because the home
   * branch is not a restriction (Owner clarification of 2026-09-10).
   *
   * Lifecycle is returned rather than judged here: the delivery module needs to
   * say WHICH rule was broken, and a boolean could not.
   */
  async findAssignable(db: DbHandle, employeeId: string): Promise<EmployeeAssignmentView | null> {
    const employee = await this.repository.readEmployee(db, employeeId);
    if (employee === null) return null;
    return {
      id: employee.id,
      displayName: employee.displayName,
      status: employee.status,
    };
  }
}

/**
 * The uniform refusal for "this employee is not visible to you".
 *
 * Absent, soft-deleted, out of reach and in another tenant are one answer. A
 * caller outside the scope and a caller naming a random uuid must be told the
 * same thing, or the register becomes a way to enumerate another organisation's
 * people.
 */
function notFound(): AppFailure {
  return new AppFailure('ERR-RES-001', {
    message: 'The employee is not visible in this scope',
  });
}

/**
 * Authorizes a row's own scope and reports a refusal as "not visible".
 *
 * `sel_employees_tenant` reads tenant-wide, so a row addressed by an
 * administrator of another branch is now RETURNED by the repository and refused
 * here. Letting the 403 through would answer two questions where the register
 * answers one: it would confirm to any authenticated principal of the tenant
 * that a given employee id exists. The scope decision is unchanged — only the
 * shape of the refusal is, and it is the shape an absent id already gets.
 *
 * Only `ERR-IAM-001`, the scope denial `requireScopedPermissions` raises, is
 * translated. Anything else is a fault and is rethrown untouched.
 */
async function authorizeScopeAsNotFound(
  authorizeScope: ScopeAuthorizer,
  target: AuthorizationTarget
): Promise<void> {
  try {
    await authorizeScope(target);
  } catch (error) {
    if (error instanceof AppFailure && error.code === 'ERR-IAM-001') throw notFound();
    throw error;
  }
}

function stale(): AppFailure {
  return new AppFailure('ERR-CON-001', {
    message: 'The record changed since it was read',
  });
}
