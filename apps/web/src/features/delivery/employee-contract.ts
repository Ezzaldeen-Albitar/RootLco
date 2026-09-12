/**
 * The employee register, as the handover surface consumes it (P1-31, FE-002).
 *
 * | operation            | method | path                        | permissions (ALL required) |
 * | -------------------- | ------ | --------------------------- | -------------------------- |
 * | `org.employee-list`  | GET    | `/org/employees`            | `org.employee.read`        |
 * | `org.employee-detail`| GET    | `/org/employees/{employeeId}` | `org.employee.read`      |
 *
 * Typed from the routes that own the shapes —
 * `apps/api/src/app/api/v1/org/employees/route.ts` and its `{employeeId}`
 * sibling — and from `EmployeeView` in
 * `apps/api/src/modules/iam/application/employee-administration-service.ts`.
 *
 * ## Why the delivery feature carries this and not an organisation feature
 *
 * The register exists, in the Owner's own words, so that a handover names a
 * **tenant-owned employee identity** rather than an unvalidated reference. The
 * one screen in this application that needs it is the one that starts a
 * handover, and this mirror is typed for exactly that need: two reads, no
 * writes, and no administration surface. The four operations the backend
 * publishes include a create and a status command; neither is mirrored here,
 * because nothing in this feature may administer a roster.
 *
 * ## The branch is a TARGET, and both halves are required
 *
 * `org.employee-list` makes `companyId` and `branchId` mandatory and authorizes
 * exactly that pair before a row is read, so the pair travels through
 * `branchTargetQuery` — the only door `lib/api` opens for a resource pair.
 * `query()` refuses both names outright, because "I am in branch Y" is a claim
 * about the caller that the server resolves from the session.
 *
 * ## A home branch is not a restriction, and this surface must not make it one
 *
 * The Owner clarified on 2026-09-10 that an employee's home branch must never
 * restrict authorized work in another branch of the same organisation. The
 * backend implements that literally: `fk_delivery_records_delivering_employee`
 * names the organisation and nothing narrower, and
 * `DeliveryService.createDelivery` refuses only an unknown employee and a
 * retired one — there is no branch rule to mirror.
 *
 * So a picker built on this contract offers the work order's own branch first
 * because that is where the colleague usually stands, and it must leave the
 * operator able to name another branch of the same organisation. Narrowing the
 * candidates to one branch and calling it validation would re-impose, in a
 * browser, exactly the restriction the Owner removed from the database.
 *
 * ## Nothing here decides who may be named
 *
 * The list is an affordance. The create operation resolves the reference again,
 * under the caller's own read rules, and
 * `sal.stamp_delivering_employee_identity` decides once more inside the
 * transaction. This tier composes no eligibility rule of its own, and the two
 * refusals it renders are the server's own decisions read back from the problem
 * document.
 *
 * ## No login account is read, and no person is described
 *
 * The register publishes an optional login-account reference and an opaque
 * employment reference. Neither is dereferenced here: the account reference is
 * not resolved to a user, and the employment reference is shown as the reference
 * it is, beside the name, so two colleagues sharing a name can be told apart.
 * Nothing in this feature asks for a person's contact details, role, department
 * or employment history, and no such read exists to ask.
 */

/** The permissions the employee register publishes, as the backend registers them. */
export const EMPLOYEE_PERMISSIONS = {
  /**
   * Both reads. Deliberately NOT the code that administers the register:
   * choosing who handed a vehicle over must not require the authority to alter
   * the organisation's roster, and the backend split the two codes for exactly
   * that reason.
   */
  read: 'org.employee.read',
} as const;

/**
 * `ck_employees_status`, mirrored.
 *
 * Two values, because retiring and reinstating are one verb on this register.
 */
export const EMPLOYEE_STATUSES = ['active', 'inactive'] as const;
export type EmployeeStatus = (typeof EMPLOYEE_STATUSES)[number];

/**
 * The only state a new handover may name.
 *
 * A retired employee is refused by the create operation with its own rule, so
 * offering one would be offering a choice whose only outcome is a refusal. The
 * list is asked for this state rather than filtered after it arrives: filtering
 * a page client-side would silently shorten it and hide the rows beyond it.
 */
export const ASSIGNABLE_EMPLOYEE_STATUS: EmployeeStatus = 'active';

/**
 * The page the picker asks for.
 *
 * A choice well inside what the route accepts: `schemas.limit` refuses anything
 * above `MAX_EMPLOYEE_PAGE_SIZE`, and a request above it is an error rather than
 * a shorter page — so the ceiling is applied on this side, before the request is
 * spent, instead of being discovered from a refusal.
 */
export const EMPLOYEE_PAGE_SIZE = 50;

/** `schemas.limit` in `apps/api/src/server/http/validation.ts` — the route's own bound. */
export const MAX_EMPLOYEE_PAGE_SIZE = 100;

/** The page size actually sent: the caller's wish, capped at what the route serves. */
export function employeePageSize(requested: number): number {
  if (!Number.isInteger(requested) || requested < 1) return EMPLOYEE_PAGE_SIZE;
  return Math.min(requested, MAX_EMPLOYEE_PAGE_SIZE);
}

/**
 * One employee of the register — `EmployeeView`.
 *
 * `status` is typed as the wire's `string` rather than as `EmployeeStatus`: the
 * check constraint is the database's, and a value added there must reach the
 * screen as itself instead of being narrowed away by a type this side invented.
 */
export interface EmployeeSummary {
  readonly id: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly displayName: string;
  /** The login account this person signs in with, absent when they have none. */
  readonly userAccountId: string | null;
  /** An opaque reference to an employment record held elsewhere. Never resolved here. */
  readonly employmentRef: string | null;
  readonly status: string;
  readonly recordVersion: number;
}

/** `org.employee-list` — a cursor page, exactly as the backend publishes one. */
export interface EmployeePage {
  readonly items: readonly EmployeeSummary[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

/**
 * The catalogue codes a handover START answers with that mean something more
 * specific than their HTTP kind.
 *
 * Branched on only where the backend genuinely distinguishes a cause and the
 * distinction changes what the operator does next. Everything else keeps the
 * shared wording, because inventing a sentence per code would claim knowledge
 * the problem document does not carry.
 */
export const DELIVERY_START_ERROR_CODES = {
  /** The employee could not be named — see `DELIVERY_START_RULES` for which way. */
  refusedEmployee: 'ERR-VAL-001',
  /** This work order already has a live handover. */
  alreadyStarted: 'ERR-RES-002',
  /** The authority was not held. `requiredPermissions` names it when the server did. */
  denied: 'ERR-IAM-001',
} as const;

/**
 * The two rule tokens the create operation distinguishes on the employee field.
 *
 * `ERR-VAL-001` carries both causes and the problem document's first violation
 * is the only machine-readable statement of which one it is. They need different
 * corrections from an operator — name somebody else, or have this person
 * reinstated — so they are worded apart. The server deliberately reports an
 * employee it will not show you and an employee that does not exist as the SAME
 * rule, and nothing on this side may guess between them.
 */
export const DELIVERY_START_RULES = {
  /** Not a live employee of this organisation, or not one this caller may see. */
  unknown: 'custom',
  /** A real employee of this organisation who has been retired. */
  retired: 'inactive_employee',
} as const;

/** The field the create operation's violations name. */
export const DELIVERY_START_FIELD = 'deliveringEmployeeId';
