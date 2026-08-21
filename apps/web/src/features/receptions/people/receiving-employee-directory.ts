/**
 * What the receiving-employee picker reads, and what that discloses —
 * `P1-28-SEC-001`, Owner decision `FE-007`.
 *
 * Pure module: a decision written down where a test can hold it, because the
 * decision is the deliverable. `tests/p1-28-security.test.ts` checks every claim
 * below against the route source, the operation register and the screen that
 * renders the statement, so this is a record rather than a reassurance.
 *
 * ## This file replaces a disposition, and the replacement is a NARROWING
 *
 * It used to record why the picker read `iam.user-list`. That was the honest
 * position while `rec.reception_visits.receiving_employee_id` carried no foreign
 * key and no employee master existed anywhere in the platform: a user id was the
 * only identity that resolved to a name, so the picker offered the tenant's
 * whole user directory and the screen said so out loud.
 *
 * `DBCR-P1-18-002` ended that. The picker now reads
 * `rec.receiving-employee-list`, and every axis moves the same way:
 *
 * | | the old read | this read |
 * | - | - | - |
 * | operation | `iam.user-list` | `rec.receiving-employee-list` |
 * | permission | `iam.user.read` | `rec.reception.manage` |
 * | declared scope | `tenant` | `branch` |
 * | rows offered | every account in the tenant | active accounts whose live role grants cover THIS branch |
 *
 * ## Why the permission is `rec.reception.manage`
 *
 * The list answers exactly one question — whom may I name as the custodian on
 * the check-in I am about to open — so it costs the capability that opens one.
 * `rec.reception.read` would have been the wrong code: the board, the service
 * advisor and the cashier hold it, none of them selects a custodian, and none of
 * them needs the tenant's staff names to do their job.
 *
 * The old disposition rested on the opposite argument — that `iam.user.read` was
 * held by everyone already, because `GET /auth/session` requires it, so the
 * picker widened nobody's access. That was true and it was never comfortable:
 * "this discloses nothing new" is a weaker claim than "this discloses less".
 *
 * ## What is NOT claimed
 *
 * That holding `rec.reception.receiving_employee.assign_any` makes this list
 * longer. It does not, deliberately. Naming somebody outside the branch is an
 * explicit administrative act taken against the user directory; a picker that
 * silently grew under a permission the operator cannot see would reintroduce the
 * disclosure this change removed, and quietly.
 *
 * And that this screen decides anything. `rec.stamp_receiving_employee_identity()`
 * decides inside the insert, against the ACTOR's authority in the visit's own
 * scope. The query behind this operation is deliberately the same predicate so
 * the two cannot drift into a shape where the screen offers an id the write
 * refuses — but a caller that never loads this picker is subject to the same
 * rule, which is the point of putting it in the database.
 */

/** The permission the receiving-employee picker consumes. */
export const RECEIVING_EMPLOYEE_PERMISSION = 'rec.reception.manage';

/** The operation it consumes. One read, not a directory. */
export const RECEIVING_EMPLOYEE_OPERATION = 'rec.receiving-employee-list';

/**
 * The scope that operation declares. `branch` — that is the whole change.
 *
 * Named as its own constant because the previous value was the defect: a
 * `tenant`-scoped read behind a picker on a branch-scoped screen is how a
 * receptionist ended up holding the staff list of every branch in the company.
 */
export const RECEIVING_EMPLOYEE_SCOPE = 'branch';

/**
 * The operation and permission this replaced.
 *
 * Kept, and checked, so the narrowing is falsifiable rather than asserted: a
 * commit that points the picker back at the user directory fails a case that
 * names what it went back to. A removed disclosure that nothing remembers is a
 * disclosure waiting to be re-added by somebody who was not here.
 */
export const RECEIVING_EMPLOYEE_SUPERSEDED = Object.freeze({
  operation: 'iam.user-list',
  permission: 'iam.user.read',
  scope: 'tenant',
});

/**
 * The permission that lets an actor name a custodian outside the branch.
 *
 * Declared by NO operation, and that is not an oversight — see the docblock.
 * It is consumed inside the database function, which is why this constant
 * exists only to be asserted against the seed catalogue and never sent.
 */
export const RECEIVING_EMPLOYEE_CROSS_BRANCH_PERMISSION =
  'rec.reception.receiving_employee.assign_any';

/** The statement the check-in screen puts beside the picker, in both catalogues. */
export const RECEIVING_EMPLOYEE_NOTICE_KEY = 'receptions.checkIn.employeeDirectoryScope';
