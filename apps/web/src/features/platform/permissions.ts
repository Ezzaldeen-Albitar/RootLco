/**
 * The platform authority codes the Platform Owner Console consults
 * (P1-32-PRE-060).
 *
 * Every one starts `platform.`, and that prefix is what routes the backend's
 * authorization to the platform authority rather than to a tenant role. These
 * are the codes the operations declare in their `defineOperation` blocks under
 * `apps/api/src/app/api/v1/platform/**`, repeated here as values and pinned by
 * `tests/platform-navigation.test.ts`.
 *
 * Holding a code only decides what the console OFFERS. Every read and every
 * write is still decided by the server, and its refusal is the one shown.
 */
export const PLATFORM_PERMISSIONS = {
  organizationRead: 'platform.organization.read',
  organizationProvision: 'platform.organization.provision',
  organizationLifecycle: 'platform.organization.lifecycle',
  organizationManage: 'platform.organization.manage',
  subscriptionManage: 'platform.subscription.manage',
  billingRead: 'platform.billing.read',
  billingManage: 'platform.billing.manage',
  statisticsRead: 'platform.statistics.read',
  auditRead: 'platform.audit.read',
} as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];

/** Exact membership. A prefix match would let one code stand in for another. */
export function holds(permissions: readonly string[], code: PlatformPermission): boolean {
  return permissions.includes(code);
}
