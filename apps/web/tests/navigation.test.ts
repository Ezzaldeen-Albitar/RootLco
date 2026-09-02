import { describe, expect, it } from 'vitest';
import {
  NAVIGATION,
  flattenNavigation,
  hrefFor,
  isActive,
  type NavigationItem,
} from '../src/config/navigation';
import { NO_CAPABILITIES, hasPermission, visibleNavigation } from '../src/lib/permissions';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

const ALL = flattenNavigation();

const item = (over: Partial<NavigationItem> = {}): NavigationItem => ({
  key: 'k',
  labelKey: 'nav.overview',
  icon: 'overview',
  href: '/x',
  permission: null,
  status: 'available',
  scope: 'branch',
  ...over,
});

describe('the navigation model', () => {
  it('gives every entry a unique key', () => {
    const keys = ALL.map((entry) => entry.key);
    expect(new Set(keys).size, `duplicate keys: ${keys.join(', ')}`).toBe(keys.length);
  });

  it('names a translation key for every label, and never literal text', () => {
    for (const entry of ALL) {
      expect(entry.labelKey, entry.key).toMatch(/^nav\./);
      expect(Object.keys(en), `${entry.labelKey} missing from en`).toContain(entry.labelKey);
      expect(Object.keys(ar), `${entry.labelKey} missing from ar`).toContain(entry.labelKey);
    }
    for (const group of NAVIGATION) {
      expect(Object.keys(en)).toContain(group.labelKey);
      expect(Object.keys(ar)).toContain(group.labelKey);
    }
  });

  it('marks every module whose screens do not exist yet as planned', () => {
    // `available` is a claim that a screen exists. P1-25 built the frame, the
    // overview and the gallery; P1-26 built authentication and administration;
    // P1-27 built the CRM and Vehicle screens; P1-28 is landing the
    // appointment and reception screens wave by wave. Everything else is still
    // a route definition for a later phase and must render as visibly
    // unavailable rather than as a link that 404s.
    const available = ALL.filter((entry) => entry.status === 'available').map((e) => e.key);
    expect(available.sort()).toEqual([
      'administration',
      'administration.approvalLimits',
      'administration.auditLog',
      // The parent row became a DISCLOSURE at Owner acceptance — it opens and
      // closes its children instead of navigating — so `/administration` needs
      // a child of its own or the page it serves becomes unreachable.
      'administration.overview',
      'administration.permissions',
      'administration.roles',
      'administration.users',
      // Built in P1-28 (`P1-28-FE-001`): the branch calendar at
      // `/appointments`, flipped in the same change that landed the screen.
      'appointments',
      // Both duplicate queues are in the sidebar, each behind its OWN
      // `*.duplicate.review` code. They had screens and no route into them —
      // a page nobody can reach is not delivered.
      'customer-duplicates',
      'customers',
      'gallery',
      'overview',
      // P1-28 Wave D: the Reception entry landed WITH its first screen, the
      // check-in wizard at `/receptions/check-in` (`P1-28-FE-007`).
      'receptions',
      'settings',
      'settings.currencies',
      'settings.languages',
      'settings.numberingRules',
      'settings.organization',
      'settings.systemSettings',
      'settings.taxes',
      // The technician workspace landed with P1-29 W4 at /technicians/me,
      // gated on `tech.technician.read` — the permission its queue requires.
      // The child names the same route as its parent; see navigation.ts.
      'technicians',
      'technicians.me',
      'vehicle-duplicates',
      'vehicles',
      // The walk-in intake screen landed with P1-28-FE-006 at
      // /reception/walk-in, gated on the permission its first operation
      // (customer search) requires.
      'walk-in',
      // The work-order board landed with P1-29 W1 at /work-orders, gated on
      // `wo.work_order.read` — the permission its only operation requires.
      'work-orders',
      // The board child names the same route as its parent, so the expanded
      // sidebar has a link to mark as the current page. See navigation.ts.
      'work-orders.queue',
    ]);
  });

  it('keeps every module without a screen marked planned', () => {
    const planned = ALL.filter((entry) => entry.status === 'planned').map((e) => e.key);
    // The business modules P1-27 and later deliver. If one of these ever turns
    // `available` without a screen, the sidebar starts producing 404s.
    expect(planned.sort()).toEqual([
      'billing',
      'catalog',
      // `customers` and `vehicles` left this list in P1-27, and `appointments`
      // in P1-28, when the screens they point at were built.
      'delivery',
      'documents',
      'inventory',
      'notifications',
      'reports',
      // `technicians` left this list in P1-29 W4, when the workspace was built.
      // `work-orders` left this list in P1-29 W1. Its two CHILDREN stay: the
      // diagnostics and quality screens are W7 and W8 and do not exist yet.
      'work-orders.diagnostics',
      'work-orders.quality',
    ]);
  });

  it('gates every P1-26 entry on a permission that exists in the platform catalogue', () => {
    // `org.settings.read` was the previous Settings gate and is in NO catalogue
    // and NO operation — so "unknown means denied" hid the entry from every
    // actor who ever existed (finding P1-26-F-011). These are the codes seeded
    // by supabase/seeds/04_iam_permission_catalog.sql that P1-26's operations
    // actually require.
    const CATALOGUE = new Set([
      'iam.user.read',
      'iam.role.read',
      'iam.approval.manage',
      'iam.audit.view',
      'org.tenant.read',
      'org.settings.manage',
      'org.tax.manage',
    ]);
    const administration = NAVIGATION.find((group) => group.key === 'administration');
    expect(administration).toBeDefined();
    const entries = flattenNavigation([administration!]);
    for (const entry of entries) {
      if (entry.permission === null) continue;
      expect(CATALOGUE.has(entry.permission), `${entry.key} → ${entry.permission}`).toBe(true);
    }
  });

  it('requires a permission for every module except the two ungated ones', () => {
    const ungated = ALL.filter((entry) => entry.permission === null).map((e) => e.key);
    expect(ungated.sort()).toEqual(['gallery', 'overview']);
  });

  it('declares a scope for every entry', () => {
    for (const entry of ALL) {
      expect(['tenant', 'company', 'branch'], entry.key).toContain(entry.scope);
    }
  });
});

describe('route building', () => {
  it('places every route under the locale', () => {
    expect(hrefFor('ar', item({ href: '/customers' }))).toBe('/ar/customers');
    expect(hrefFor('en', item({ href: '/customers' }))).toBe('/en/customers');
  });

  it('does not produce a trailing slash for the overview', () => {
    expect(hrefFor('en', item({ href: '/' }))).toBe('/en');
  });
});

describe('active-route matching', () => {
  const workOrders = item({ href: '/work-orders' });

  it('matches the exact route', () => {
    expect(isActive('/en/work-orders', 'en', workOrders)).toBe(true);
  });

  it('keeps the parent active from a child route', () => {
    // An operator two levels deep must still see which module they are in.
    expect(isActive('/en/work-orders/diagnostics', 'en', workOrders)).toBe(true);
  });

  it('does not match a route that merely shares a prefix', () => {
    // `/work-orders-archive` is a different module, not a child.
    expect(isActive('/en/work-orders-archive', 'en', workOrders)).toBe(false);
  });

  it('matches the overview only at the root', () => {
    const overview = item({ href: '/' });
    expect(isActive('/en', 'en', overview)).toBe(true);
    expect(isActive('/en/', 'en', overview)).toBe(true);
    // Without the exact-match branch the overview would be active on every page.
    expect(isActive('/en/customers', 'en', overview)).toBe(false);
  });

  it('does not match across locales', () => {
    expect(isActive('/ar/work-orders', 'en', workOrders)).toBe(false);
  });
});

describe('permission filtering — unknown means denied', () => {
  it('hides an item whose permission the actor does not hold', () => {
    expect(hasPermission({ permissions: ['crm.customer.read'] }, 'wo.work_order.read')).toBe(false);
  });

  it('shows an item whose permission the actor holds', () => {
    expect(hasPermission({ permissions: ['wo.work_order.read'] }, 'wo.work_order.read')).toBe(true);
  });

  it('treats a null requirement as ungated, NOT as "holds everything"', () => {
    expect(hasPermission({ permissions: [] }, null)).toBe(true);
    expect(hasPermission({ permissions: [] }, 'anything')).toBe(false);
  });

  it('denies everything when capabilities are absent', () => {
    // The decisive case. A permission set that failed to load must produce an
    // empty sidebar, never a complete one.
    for (const capabilities of [null, undefined, NO_CAPABILITIES]) {
      expect(hasPermission(capabilities, 'crm.customer.read')).toBe(false);
    }
  });

  it('shows only the ungated entries to an actor with no capabilities', () => {
    const visible = visibleNavigation(NAVIGATION, NO_CAPABILITIES);
    const keys = visible.flatMap((group) => group.items.map((entry) => entry.key));
    expect(keys.sort()).toEqual(['gallery', 'overview']);
  });

  it('removes a group whose every item is hidden', () => {
    // An empty group heading tells the operator a module exists and they cannot
    // have it — useless, and a small disclosure.
    const visible = visibleNavigation(NAVIGATION, NO_CAPABILITIES);
    for (const group of visible) expect(group.items.length).toBeGreaterThan(0);
    expect(visible.map((g) => g.key)).not.toContain('commerce');
  });

  it('filters children independently of their parent', () => {
    const capabilities = { permissions: ['wo.work_order.read', 'dia.diagnostic.read'] };
    const visible = visibleNavigation(NAVIGATION, capabilities);
    const parent = visible
      .flatMap((group) => group.items)
      .find((entry) => entry.key === 'work-orders');
    expect(parent).toBeDefined();
    // `work-orders.queue` rides on the same code as its parent; `.diagnostics`
    // on its own; `.quality` on a code these capabilities do not hold, and is
    // therefore absent — which is what makes this independent filtering.
    expect(parent?.children?.map((child) => child.key)).toEqual([
      'work-orders.queue',
      'work-orders.diagnostics',
    ]);
  });

  it('widens as capabilities widen, and never further', () => {
    const capabilities = { permissions: ['crm.customer.read', 'veh.vehicle.read'] };
    const keys = visibleNavigation(NAVIGATION, capabilities).flatMap((group) =>
      group.items.map((entry) => entry.key)
    );
    // `walk-in` appears with `crm.customer.read` because that is the code its
    // first operation (customer search) requires.
    expect(keys.sort()).toEqual(['customers', 'gallery', 'overview', 'vehicles', 'walk-in']);
  });
});
