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
    // P1-25 builds the frame. Anything claiming `available` here is claiming a
    // screen exists, and only the overview and the gallery do.
    const available = ALL.filter((entry) => entry.status === 'available').map((e) => e.key);
    expect(available.sort()).toEqual(['gallery', 'overview']);
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
    expect(parent?.children?.map((child) => child.key)).toEqual(['work-orders.diagnostics']);
  });

  it('widens as capabilities widen, and never further', () => {
    const capabilities = { permissions: ['crm.customer.read', 'veh.vehicle.read'] };
    const keys = visibleNavigation(NAVIGATION, capabilities).flatMap((group) =>
      group.items.map((entry) => entry.key)
    );
    expect(keys.sort()).toEqual(['customers', 'gallery', 'overview', 'vehicles']);
  });
});
