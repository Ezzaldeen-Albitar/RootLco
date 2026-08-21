/**
 * The `iam.user.read` disposition — `P1-28-SEC-001`.
 *
 * Pure module: a decision written down where a test can hold it, because the
 * decision is the deliverable. `tests/p1-28-security.test.ts` checks every claim
 * below against the route source, the operation register and the screens that
 * consume it, so this is a record rather than a reassurance.
 *
 * ## What this code is still spent on, and what it no longer is
 *
 * It is NO LONGER spent on the receiving-employee picker. That picker read
 * `iam.user-list` — every account in the tenant, at tenant scope — because
 * `rec.reception_visits.receiving_employee_id` had no referent and a user id was
 * the only identity the platform could resolve to a name. `DBCR-P1-18-002`
 * replaced it with `rec.receiving-employee-list`, and
 * `receiving-employee-directory.ts` carries that disposition.
 *
 * What remains is the population that genuinely has no snapshot: the ACTORS on a
 * read-back. `EvidencePanels` renders who recorded an inspection, who bound a
 * piece of evidence and who signed, and those are audit identifiers written by
 * the platform rather than fields with a stored display name. One
 * `iam.user-detail` read per DISTINCT identifier on the page resolves them.
 *
 * **What the code grants, exactly:**
 *
 *   - `iam.user-list` — every user account in the caller's tenant, paged, each
 *     row carrying `id`, `email`, `displayName` and `status`. There is no branch
 *     narrowing: the operation's scope is the whole tenant. **No P1-28 surface
 *     consumes it any more**, which is asserted rather than stated.
 *   - `iam.user-detail` — one account by id, the same fields. This is the one
 *     the actor-name resolution spends.
 *   - `iam.auth-session` — the session bootstrap, which registers the SAME code.
 *
 * The third entry decides how this reads. `GET /auth/session` requires
 * `iam.user.read`, so **every operator who can load the application at all
 * already holds it**: resolving an actor's name widens nobody's access. It was
 * never a comfortable argument for a PICKER — "this discloses nothing new" is
 * weaker than "this discloses less" — but for turning an identifier already on
 * the page into the name of the person it names, it is the right one.
 *
 * ## What is NOT claimed
 *
 * That an employee master exists. It does not. `iam.user_accounts` is a record
 * of platform ACCOUNTS, and every surface that shows one of these names is
 * showing who operated the system, never who is employed where. The wizard
 * header and the acknowledgement sheet no longer come through here at all.
 */

/** The permission the actor-name resolution consumes. */
export const USER_DIRECTORY_PERMISSION = 'iam.user.read';

/** Every operation that one code opens, so the disposition can be checked. */
export const USER_DIRECTORY_OPERATIONS = Object.freeze([
  'iam.user-list',
  'iam.user-detail',
  'iam.auth-session',
]);

/**
 * The operation whose requirement makes the code universal.
 *
 * Named separately because it carries the whole argument: without it, resolving
 * a name would be asking for a capability an operator might not otherwise have,
 * and the disposition would have to be a different one.
 */
export const USER_DIRECTORY_BOOTSTRAP_OPERATION = 'iam.auth-session';

/**
 * The one this code opens that NO P1-28 surface may consume.
 *
 * Stated as a constant so the prohibition is checkable: a commit that points any
 * reception or appointment screen back at the tenant-wide account list fails a
 * case that names the operation it went back to.
 */
export const USER_DIRECTORY_FORBIDDEN_OPERATION = 'iam.user-list';

/** The operation the actor-name resolution actually spends. */
export const USER_DIRECTORY_ACTOR_OPERATION = 'iam.user-detail';

/** The scope `iam.user-list` declares. Not branch — that is why it is forbidden. */
export const USER_DIRECTORY_SCOPE = 'tenant';
