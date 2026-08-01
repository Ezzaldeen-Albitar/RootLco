import type { Locale } from '@/i18n/config';

/**
 * The navigation model — data, not components.
 *
 * Every entry below is a ROUTE DEFINITION, not a claim that a screen exists.
 * P1-25 builds the shell; the business screens belong to P1-26 and later. An
 * item whose screen is not built yet carries `status: 'planned'`, which renders
 * as visibly unavailable rather than as a link that 404s. Pretending otherwise
 * would make the sidebar a lie the first time someone clicked it.
 *
 * ## Why this is configuration
 *
 * A sidebar written as JSX grows a conditional per module and becomes the one
 * file every feature team edits. As data it can be filtered, tested, reordered
 * and permission-checked without touching a component — and the permission
 * filter can be proven correct by a test that never renders anything.
 */

/** A permission code as published by the backend's permission catalogue. */
export type PermissionCode = string;

export type NavigationStatus =
  /** The screen exists and is reachable. */
  | 'available'
  /** The route is defined for a later phase. Rendered visibly unavailable. */
  | 'planned';

/** The scope a module operates in, shown to the user so context is never guessed. */
export type NavigationScope = 'tenant' | 'company' | 'branch';

export interface NavigationItem {
  /** Stable key. Used for tests, persistence and analytics; never displayed. */
  readonly key: string;
  /** Translation key. Visible text NEVER appears literally in this file. */
  readonly labelKey: string;
  /** Icon name from the shared icon set. */
  readonly icon: IconName;
  /** Route relative to the locale segment, e.g. `/customers`. */
  readonly href: string;
  /**
   * Permission required to SEE the item.
   *
   * `null` means "no permission gates visibility" — used only for the overview.
   * Anything else must be held by the actor. A permission this client does not
   * recognise is treated as NOT held: unknown means denied, never allowed.
   */
  readonly permission: PermissionCode | null;
  readonly status: NavigationStatus;
  readonly scope: NavigationScope;
  /** Optional numeric badge, e.g. unread notifications. */
  readonly badgeKey?: string;
  readonly children?: readonly NavigationItem[];
}

export interface NavigationGroup {
  readonly key: string;
  readonly labelKey: string;
  readonly items: readonly NavigationItem[];
}

export type IconName =
  | 'overview'
  | 'customers'
  | 'vehicles'
  | 'appointments'
  | 'work-orders'
  | 'technicians'
  | 'catalog'
  | 'inventory'
  | 'billing'
  | 'delivery'
  | 'documents'
  | 'notifications'
  | 'reports'
  | 'administration'
  | 'settings'
  | 'gallery';

/**
 * The module map.
 *
 * Grouped the way an operator thinks about a workshop day — who is coming in,
 * what is being worked on, what is being sold, and what is being administered —
 * rather than by the order the modules were built.
 */
export const NAVIGATION: readonly NavigationGroup[] = Object.freeze([
  {
    key: 'work',
    labelKey: 'nav.group.work',
    items: [
      {
        key: 'overview',
        labelKey: 'nav.overview',
        icon: 'overview',
        href: '/',
        permission: null,
        status: 'available',
        scope: 'branch',
      },
      {
        key: 'appointments',
        labelKey: 'nav.appointments',
        icon: 'appointments',
        href: '/appointments',
        permission: 'apt.appointment.read',
        status: 'planned',
        scope: 'branch',
      },
      {
        key: 'work-orders',
        labelKey: 'nav.workOrders',
        icon: 'work-orders',
        href: '/work-orders',
        permission: 'wo.work_order.read',
        status: 'planned',
        scope: 'branch',
        children: [
          {
            key: 'work-orders.diagnostics',
            labelKey: 'nav.diagnostics',
            icon: 'work-orders',
            href: '/work-orders/diagnostics',
            permission: 'dia.diagnostic.read',
            status: 'planned',
            scope: 'branch',
          },
          {
            key: 'work-orders.quality',
            labelKey: 'nav.quality',
            icon: 'work-orders',
            href: '/work-orders/quality',
            permission: 'qms.quality_control.read',
            status: 'planned',
            scope: 'branch',
          },
        ],
      },
      {
        key: 'technicians',
        labelKey: 'nav.technicians',
        icon: 'technicians',
        href: '/technicians',
        permission: 'tech.technician.read',
        status: 'planned',
        scope: 'branch',
      },
    ],
  },
  {
    key: 'customers',
    labelKey: 'nav.group.customers',
    items: [
      {
        key: 'customers',
        labelKey: 'nav.customers',
        icon: 'customers',
        href: '/customers',
        permission: 'crm.customer.read',
        status: 'planned',
        scope: 'company',
      },
      {
        key: 'vehicles',
        labelKey: 'nav.vehicles',
        icon: 'vehicles',
        href: '/vehicles',
        permission: 'veh.vehicle.read',
        status: 'planned',
        scope: 'company',
      },
    ],
  },
  {
    key: 'commerce',
    labelKey: 'nav.group.commerce',
    items: [
      {
        key: 'catalog',
        labelKey: 'nav.catalog',
        icon: 'catalog',
        href: '/catalog',
        permission: 'svc.service.read',
        status: 'planned',
        scope: 'company',
      },
      {
        key: 'inventory',
        labelKey: 'nav.inventory',
        icon: 'inventory',
        href: '/inventory',
        permission: 'inv.item.read',
        status: 'planned',
        scope: 'branch',
      },
      {
        key: 'billing',
        labelKey: 'nav.billing',
        icon: 'billing',
        href: '/billing',
        permission: 'sal.invoice.read',
        status: 'planned',
        scope: 'branch',
      },
      {
        key: 'delivery',
        labelKey: 'nav.delivery',
        icon: 'delivery',
        href: '/delivery',
        permission: 'sal.delivery.read',
        status: 'planned',
        scope: 'branch',
      },
    ],
  },
  {
    key: 'records',
    labelKey: 'nav.group.records',
    items: [
      {
        key: 'documents',
        labelKey: 'nav.documents',
        icon: 'documents',
        href: '/documents',
        permission: 'shared.document.read',
        status: 'planned',
        scope: 'company',
      },
      {
        key: 'notifications',
        labelKey: 'nav.notifications',
        icon: 'notifications',
        href: '/notifications',
        permission: 'shared.notification.read',
        status: 'planned',
        scope: 'branch',
        badgeKey: 'notifications.unread',
      },
      {
        key: 'reports',
        labelKey: 'nav.reports',
        icon: 'reports',
        href: '/reports',
        permission: 'rpt.report.read',
        status: 'planned',
        scope: 'company',
      },
    ],
  },
  {
    key: 'administration',
    labelKey: 'nav.group.administration',
    items: [
      {
        key: 'administration',
        labelKey: 'nav.administration',
        icon: 'administration',
        href: '/administration',
        permission: 'iam.user.read',
        status: 'planned',
        scope: 'tenant',
      },
      {
        key: 'settings',
        labelKey: 'nav.settings',
        icon: 'settings',
        href: '/settings',
        permission: 'org.settings.read',
        status: 'planned',
        scope: 'company',
      },
      {
        key: 'gallery',
        labelKey: 'nav.gallery',
        icon: 'gallery',
        href: '/gallery',
        permission: null,
        status: 'available',
        scope: 'tenant',
      },
    ],
  },
]);

/** Every item, groups flattened and children included. */
export function flattenNavigation(
  groups: readonly NavigationGroup[] = NAVIGATION
): readonly NavigationItem[] {
  const out: NavigationItem[] = [];
  const visit = (items: readonly NavigationItem[]) => {
    for (const item of items) {
      out.push(item);
      if (item.children) visit(item.children);
    }
  };
  for (const group of groups) visit(group.items);
  return out;
}

/** Absolute path for an item under a locale. */
export function hrefFor(locale: Locale, item: Pick<NavigationItem, 'href'>): string {
  return item.href === '/' ? `/${locale}` : `/${locale}${item.href}`;
}

/**
 * Active-route matching.
 *
 * Longest-prefix, so `/work-orders/diagnostics` marks BOTH the child and its
 * parent active — an operator two levels deep must still see which module they
 * are in. The overview is matched exactly, or it would be active everywhere.
 */
export function isActive(pathname: string, locale: Locale, item: NavigationItem): boolean {
  const target = hrefFor(locale, item);
  if (item.href === '/') return pathname === target || pathname === `${target}/`;
  return pathname === target || pathname.startsWith(`${target}/`);
}
