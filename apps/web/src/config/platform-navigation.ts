import type { NavigationGroup } from './navigation';

/**
 * The Platform Owner Console navigation (P1-32-PRE-062).
 *
 * A separate model from `NAVIGATION`, on purpose. The workspace sidebar is gated
 * by tenant permissions and the console by platform authority codes; a single
 * model would let a tenant item appear for the platform operator, or a console
 * item for a tenant user, the moment a code was mistyped. Two models make the
 * two audiences structurally distinct, and `visibleNavigation` filters each the
 * same way.
 *
 * Every item carries its own platform code, written as a literal because
 * `src/config` does not import feature code; `tests/platform-navigation.test.ts`
 * holds each literal equal to `PLATFORM_PERMISSIONS`. `plans` is gated on
 * `platform.subscription.manage` because the plan catalogue read declares that
 * code, not the organisation read.
 */
export const PLATFORM_NAVIGATION: readonly NavigationGroup[] = Object.freeze([
  {
    key: 'platform',
    labelKey: 'platform.nav.group',
    items: [
      {
        key: 'platform-overview',
        labelKey: 'platform.nav.overview',
        icon: 'overview',
        href: '/platform',
        permission: 'platform.statistics.read',
        status: 'available',
        scope: 'tenant',
        exact: true,
      },
      {
        key: 'platform-organizations',
        labelKey: 'platform.nav.organizations',
        icon: 'administration',
        href: '/platform/organizations',
        permission: 'platform.organization.read',
        status: 'available',
        scope: 'tenant',
      },
      {
        key: 'platform-plans',
        labelKey: 'platform.nav.plans',
        icon: 'pricing',
        href: '/platform/plans',
        permission: 'platform.subscription.manage',
        status: 'available',
        scope: 'tenant',
      },
      {
        key: 'platform-audit',
        labelKey: 'platform.nav.audit',
        icon: 'reports',
        href: '/platform/audit',
        permission: 'platform.audit.read',
        status: 'available',
        scope: 'tenant',
      },
    ],
  },
]);
