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
  /**
   * Match this item's route EXACTLY rather than by longest prefix.
   *
   * Needed by a child that points at its own parent's route: `/administration`
   * is a prefix of `/administration/users`, so under the default rule the
   * Administration overview entry would be highlighted on every administration
   * screen and the operator would see two current pages at once.
   */
  readonly exact?: boolean;
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
  /**
   * A review queue, not a list.
   *
   * The two duplicate queues used the same icon as the search screens they sit
   * beside, so nothing but the (truncated) label distinguished "all customers"
   * from "customer records that may be the same person and need a decision".
   * A queue that needs human attention gets an attention glyph.
   */
  | 'duplicate-review'
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
        icon: 'duplicate-review',
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
        icon: 'duplicate-review',
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
          /*
           * `/administration` is a real page, and since the Owner-acceptance
           * remediation a parent row is a DISCLOSURE CONTROL rather than a link
           * — it opens and closes its children instead of navigating.
           *
           * Without this entry that page would have become unreachable from the
           * navigation: the only thing that pointed at it was the parent, and
           * the parent stopped pointing anywhere. A route that exists and cannot
           * be reached is worse than one that was never built, because nothing
           * in the interface admits it is there.
           *
           * `settings` needs no equivalent entry: its own href is already
           * `/administration/organization`, which its first child names.
           */
          {
            key: 'administration.overview',
            labelKey: 'nav.administrationOverview',
            icon: 'administration',
            href: '/administration',
            permission: 'iam.user.read',
            status: 'available',
            scope: 'tenant',
            // `/administration` is a prefix of every screen below it.
            exact: true,
          },
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
  if (item.href === '/' || item.exact) return pathname === target || pathname === `${target}/`;
  return pathname === target || pathname.startsWith(`${target}/`);
}

/**
 * Whether this item, or anything beneath it, is the page the operator is on.
 *
 * This is what keeps a collapsed group honest: a parent whose child is the
 * current page must still show as current, and must open itself, or collapsing
 * the group makes the current page impossible to find.
 */
export function containsActive(pathname: string, locale: Locale, item: NavigationItem): boolean {
  if (isActive(pathname, locale, item)) return true;
  return (item.children ?? []).some((child) => containsActive(pathname, locale, child));
}
