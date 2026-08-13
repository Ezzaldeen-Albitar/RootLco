/**
 * The `iam.user.read` disposition — `P1-28-SEC-001`.
 *
 * Pure module: a decision written down where a test can hold it, because the
 * decision is the deliverable. `tests/p1-28-security.test.ts` checks every claim
 * below against the route source, the operation register and the screen that
 * renders the statement, so this is a record rather than a reassurance.
 *
 * ## The overload, said plainly
 *
 * `rec.reception_visits.receiving_employee_id` is `NOT NULL` with **no foreign
 * key and no defined referent** (migration `20260721097000:62`); the employee
 * master never shipped. The check-in screen therefore offers PLATFORM USERS as
 * candidates, because a user id is the only identity this platform can resolve
 * to a name, and it reads them with `iam.user-list` — `GET /api/v1/iam/users`,
 * which registers `iam.user.read` and declares `scope: 'tenant'`.
 *
 * **What that permission grants, exactly:**
 *
 *   - `iam.user-list` — every user account in the caller's tenant, paged, each
 *     row carrying `id`, `email`, `displayName` and `status`. There is no branch
 *     narrowing: the operation's scope is the whole tenant, so a branch-scoped
 *     receptionist who holds the code reads accounts from every branch.
 *   - `iam.user-detail` — one account by id, the same fields.
 *   - `iam.auth-session` — the session bootstrap, which registers the SAME code.
 *
 * The third entry is the one that decides how this reads. `GET /auth/session`
 * requires `iam.user.read`, so **every operator who can load the application at
 * all already holds it**: the receiving-employee picker widens nobody's access,
 * it re-uses a directory the sign-in already opened. What it does do is put that
 * directory in front of a receptionist who had no reason to see it, which is a
 * real thing to have decided rather than a thing to have assumed.
 *
 * ## What is NOT claimed
 *
 * That this is the right long-term shape. It is not. The narrower read a
 * reception desk actually wants — the receiving employees of THIS branch — does
 * not exist anywhere in the platform, and inventing one is Backend work that a
 * Frontend branch may not do. The gap is recorded as `G-EMP` / remediation `R6`
 * in `docs/phase-1/phase-1-28/contract-archaeology.md` §4, owned by P1-18 and
 * blocked on Owner register question A. Until that lands, the honest position is
 * this file: use the one read that exists, state on screen what it opens, and
 * keep the debt named.
 */

/** The permission the receiving-employee picker consumes. */
export const STAFF_DIRECTORY_PERMISSION = 'iam.user.read';

/** Every operation that one code opens, so the disposition can be checked. */
export const STAFF_DIRECTORY_OPERATIONS = Object.freeze([
  'iam.user-list',
  'iam.user-detail',
  'iam.auth-session',
]);

/**
 * The operation whose requirement makes the code universal.
 *
 * Named separately because it carries the whole argument: without it the picker
 * would be asking for a capability an operator might not otherwise have, and the
 * disposition would have to be a different one.
 */
export const STAFF_DIRECTORY_BOOTSTRAP_OPERATION = 'iam.auth-session';

/** The scope `iam.user-list` declares. Not branch — that is the overload. */
export const STAFF_DIRECTORY_SCOPE = 'tenant';

/** The statement the check-in screen puts beside the picker, in both catalogues. */
export const STAFF_DIRECTORY_NOTICE_KEY = 'receptions.checkIn.employeeDirectoryScope';

/** The named open decision this disposition stands on until it is answered. */
export const STAFF_DIRECTORY_OPEN_DECISION = 'G-EMP';
