/**
 * The permission codes P1-26's screens reference.
 *
 * Named constants rather than string literals scattered through eighteen files,
 * so a typo is a compile error instead of a control that silently never appears.
 * That failure mode is not hypothetical: the P1-25 Settings entry was gated on
 * `org.settings.read`, a code in no catalogue and no operation, and "unknown
 * means denied" hid it from every actor who has ever existed (`P1-26-F-011`).
 *
 * Every code below is:
 *   1. seeded in `supabase/seeds/04_iam_permission_catalog.sql`, and
 *   2. required by an operation this phase actually calls.
 *
 * `apps/web/tests/administration.test.ts` asserts both, so a code that drifts out
 * of the catalogue fails the build rather than hiding a screen.
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
