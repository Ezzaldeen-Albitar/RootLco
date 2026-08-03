/**
 * The permission codes P1-26's screens reference.
 *
 * Named constants rather than string literals scattered through eighteen files,
 * so a typo is a compile error instead of a control that silently never appears.
 * That failure mode is not hypothetical: the P1-25 Settings entry was gated on
 * `org.settings.read`, a code in no catalogue and no operation, and "unknown
 * means denied" hid it from every actor who has ever existed (`P1-26-F-011`).
 *
 * Every code below is seeded in `supabase/seeds/04_iam_permission_catalog.sql`,
 * and `apps/web/tests/administration.test.ts` asserts that — so a code that
 * drifts out of the platform catalogue fails the build rather than hiding a
 * screen.
 *
 * **Not every code is referenced by a screen.** `grantManage` and
 * `sensitiveView` are named because P1-26's operations declare them —
 * `iam.grant-issue`, and the sensitive-value branch of the settings read — and
 * because the phase that builds those screens will need them under the same
 * name. An earlier version of this comment claimed every code was *required by
 * an operation this phase calls*, which was two codes short of true
 * (`P1-26-F-030`).
 *
 * The test asserts catalogue membership, which is what it can prove. It does not
 * assert that every code is referenced, which would be a different and weaker
 * claim dressed up as the same one.
 *
 * **These gate VISIBILITY, never access.** The server checks every request and
 * its denial is the only one that means anything. Hiding a control the actor
 * cannot use is courtesy; it is not a security boundary and nothing here should
 * ever be mistaken for one.
 */
export const PERMISSIONS = {
  userRead: 'iam.user.read',
  userManage: 'iam.user.manage',
  roleRead: 'iam.role.read',
  roleManage: 'iam.role.manage',
  grantManage: 'iam.grant.manage',
  approvalManage: 'iam.approval.manage',
  auditView: 'iam.audit.view',
  sessionViewAll: 'iam.session.view_all',
  sensitiveView: 'iam.sensitive.view',
  tenantRead: 'org.tenant.read',
  companyRead: 'org.company.read',
  branchRead: 'org.branch.read',
  settingsManage: 'org.settings.manage',
  taxManage: 'org.tax.manage',
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export type AdministrationPermission = (typeof PERMISSIONS)[PermissionKey];

/** Every code this phase uses, for the catalogue-drift assertion. */
export const ADMINISTRATION_PERMISSIONS: readonly AdministrationPermission[] = Object.freeze(
  Object.values(PERMISSIONS)
);

export function holds(
  permissions: readonly string[],
  code: AdministrationPermission
): boolean {
  return permissions.includes(code);
}

/** True only when EVERY code is held. Used where an operation requires two. */
export function holdsAll(
  permissions: readonly string[],
  codes: readonly AdministrationPermission[]
): boolean {
  return codes.every((code) => permissions.includes(code));
}
