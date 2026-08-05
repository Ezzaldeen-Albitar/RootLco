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
        // `/crm/customers`, not `/customers`. The route lives under the feature
        // segment so the customer profile, its components and the duplicate
        // queue share one parent — and so a future non-CRM "customers" surface
        // cannot collide with it.
        href: '/crm/customers',
        permission: 'crm.customer.read',
        // Built in P1-27. It was `planned` while the entry pointed at a route
        // that did not exist; leaving that word on a live screen would tell an
        // operator the thing in front of them is not real.
        status: 'available',
        scope: 'company',
      },
      {
        key: 'customer-duplicates',
        labelKey: 'nav.customerDuplicates',
        icon: 'customers',
        href: '/crm/customer-duplicates',
        // Its OWN permission, not `crm.customer.read`. Reviewing possible
        // duplicates is a separate capability, and most operators who may read a
        // customer may not decide whether two records are the same person.
        permission: 'crm.customer.duplicate.review',
        status: 'available',
        scope: 'company',
      },
      {
        key: 'vehicles',
        labelKey: 'nav.vehicles',
        icon: 'vehicles',
        href: '/vehicles',
        permission: 'veh.vehicle.read',
        // Built in P1-27. Left as `planned` it would have told an operator that
        // the screen in front of them is not real.
        status: 'available',
        scope: 'company',
      },
      {
        key: 'vehicle-duplicates',
        labelKey: 'nav.vehicleDuplicates',
        icon: 'vehicles',
        href: '/vehicles/duplicates',
        permission: 'veh.vehicle.duplicate.review',
        status: 'available',
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
      /*
       * Delivered by P1-26. Every permission below is a code that exists in
       * `supabase/seeds/04_iam_permission_catalog.sql` and is required by the
       * operation the screen calls — checked against the catalogue, not
       * assumed. The previous `org.settings.read` entry named a code that is in
       * no catalogue and in no operation, so "unknown means denied" hid the
       * Settings entry from every actor who ever existed (finding P1-26-F-011).
       */
      {
        key: 'administration',
        labelKey: 'nav.administration',
        icon: 'administration',
        href: '/administration',
        permission: 'iam.user.read',
        status: 'available',
        scope: 'tenant',
        children: [
          {
            key: 'administration.users',
            labelKey: 'nav.users',
            icon: 'administration',
            href: '/administration/users',
            permission: 'iam.user.read',
            status: 'available',
            scope: 'tenant',
          },
          {
            key: 'administration.roles',
            labelKey: 'nav.roles',
            icon: 'administration',
            href: '/administration/roles',
            permission: 'iam.role.read',
            status: 'available',
            scope: 'tenant',
          },
          {
            key: 'administration.permissions',
            labelKey: 'nav.permissions',
            icon: 'administration',
            href: '/administration/permissions',
            permission: 'iam.role.read',
            status: 'available',
            scope: 'tenant',
          },
          {
            key: 'administration.approvalLimits',
            labelKey: 'nav.approvalLimits',
            icon: 'administration',
            href: '/administration/approval-limits',
            permission: 'iam.approval.manage',
            status: 'available',
            scope: 'tenant',
          },
          {
            key: 'administration.auditLog',
            labelKey: 'nav.auditLog',
            icon: 'reports',
            href: '/administration/audit-log',
            permission: 'iam.audit.view',
            status: 'available',
            scope: 'tenant',
          },
        ],
      },
      {
        key: 'settings',
        labelKey: 'nav.settings',
        icon: 'settings',
        href: '/administration/organization',
        permission: 'org.tenant.read',
        status: 'available',
        scope: 'tenant',
        children: [
          {
            key: 'settings.organization',
            labelKey: 'nav.organization',
            icon: 'settings',
            href: '/administration/organization',
            permission: 'org.tenant.read',
            status: 'available',
            scope: 'tenant',
          },
          {
            key: 'settings.numberingRules',
            labelKey: 'nav.numberingRules',
            icon: 'settings',
            href: '/administration/numbering-rules',
            permission: 'org.settings.manage',
            status: 'available',
            scope: 'company',
          },
          {
            key: 'settings.taxes',
            labelKey: 'nav.taxes',
            icon: 'settings',
            href: '/administration/taxes',
            // The screen calls the company-settings operations, which require
            // `org.company.read` and `org.settings.manage`. Gating it on
            // `org.tax.manage` — which no operation it calls requires — is the
            // same defect P1-26-F-011 recorded, repeated (P1-26-F-029).
            permission: 'org.settings.manage',
            status: 'available',
            scope: 'company',
          },
          {
            key: 'settings.currencies',
            labelKey: 'nav.currencies',
            icon: 'settings',
            href: '/administration/currencies',
            permission: 'org.settings.manage',
            status: 'available',
            scope: 'company',
          },
          {
            key: 'settings.languages',
            labelKey: 'nav.languages',
            icon: 'settings',
            href: '/administration/languages',
            permission: 'org.tenant.read',
            status: 'available',
            scope: 'tenant',
          },
          {
            key: 'settings.systemSettings',
            labelKey: 'nav.systemSettings',
            icon: 'settings',
            href: '/administration/system-settings',
            permission: 'org.settings.manage',
            status: 'available',
            scope: 'tenant',
          },
        ],
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
