import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  labelKey: 'nav.dashboard',
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
      // P1-32 preparation: the department and employee registers, each gated on
      // its list operation's own read code.
      'administration.departments',
      // P1-32-PRE-OD-DISC-01: the company discount threshold, gated on
      // `svc.price.read` — the code its read declares.
      'administration.discountThreshold',
      'administration.employees',
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
      // Owner directive, operational alerts: the Attention area at `/attention`,
      // gated on `inv.stock.read` — the code four of its five cards declare.
      'attention',
      // P1-30 W6: the invoice of a work order at `/invoices`, gated on
      // `sal.invoice.manage` — the code every invoice read requires.
      'billing',
      // P1-30 W1: the service catalogue at `/services`, gated on
      // `svc.service.read` — the permission its list operation requires.
      'catalog',
      /*
       * DEF-T-07: the credit notes of a branch at `/credit-notes`, gated on
       * `sal.credit.manage`. A return raised a credit note, told the operator a
       * second person had to approve it, and nothing in the navigation could
       * open one. The reads also require `sal.finance.view`, which the PAGE
       * checks — a navigation gate names one code, as every other row here does.
       */
      'creditNotes',
      // Both duplicate queues are in the sidebar, each behind its OWN
      // `*.duplicate.review` code. They had screens and no route into them —
      // a page nobody can reach is not delivered.
      'customer-duplicates',
      'customers',
      // P1-31 FE-001: the ready-for-delivery queue at `/delivery`, gated on
      // `sal.delivery.view` — the module's own read code — AND, since route
      // sweep B3, on `wo.work_order.read` and `sal.finance.view`, the other two
      // codes its one read declares (`alsoRequires`): the page holds nothing
      // for a caller missing either.
      'delivery',
      'gallery',
      // P1-30 W4: item search, stock availability and reservations at `/inventory`.
      'inventory',
      // P1-32 stock operations: the parent's own route as a child (a disclosure
      // parent carries no current-page marker), and the four screens, each gated
      // on `inv.stock.read`.
      'inventory.adjustments',
      /*
       * P1-32 barcodes and the counter: selling over the counter, taking a part
       * back, and printing labels. Each names the code its own PAGE gates on,
       * which is deliberately not one code for all three — a counter sale is an
       * invoice (`sal.invoice.manage`), a customer return is stock
       * (`inv.stock.read`), and a label is the catalogue (`inv.item.read`).
       */
      'inventory.counterSales',
      'inventory.counts',
      'inventory.customerReturns',
      'inventory.goods-receipts',
      'inventory.labels',
      'inventory.stock',
      'inventory.transfers',
      /*
       * P1-32 material demand control: the two facts a work-order requirement is
       * derived from. Both gate on `inv.item.read` — the code their list
       * operations declare — while the writes on them need a second, tenant-wide
       * code each, which is not what a navigation gate names.
       */
      'inventory.unitConversions',
      'inventory.vehicleSpecifications',
      'overview',
      // P1-30 W7: the branch's receipts at `/payments`, gated on
      // `sal.finance.view` — the only code both receipt reads declare, and the
      // one a cashier holds. A NEW entry: the module had no navigation row.
      'payments',
      // P1-30 W2: price lists, versions, rules and the price lookup at `/pricing`,
      // gated on `svc.price.read` — the permission its reads require.
      'pricing',
      // P1-30 W3: the quotations of a work order at `/quotations`, gated on
      // `quo.quotation.read` — the permission its reads require.
      'quotations',
      // P1-28 Wave D: the Reception entry landed WITH its first screen, the
      // check-in wizard at `/receptions/check-in` (`P1-28-FE-007`).
      'receptions',
      // P1-31 FE-011 … FE-014: the report catalogue at `/reports`, gated on
      // `rpt.report.read` — the code all three report operations declare. The
      // rows a given report returns need that report's own dataset codes as
      // well; those are per-report and only the server can evaluate them.
      'reports',
      // P1-31 FE-010: the catalogue child names its parent's own route so the
      // disclosure parent has a link to mark as the current page, and the
      // operational overview at `/reports/overview` is the FE-010 screen. Both
      // carry `rpt.report.read`, the code the parent already names.
      'reports.catalogue',
      'reports.overview',
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
      // P1-31 FE-008 landed the branch's warranty records at /warranty, gated on
      // `wty.warranty.read` — the code BOTH warranty reads declare, minted by P-7
      // so that reading a warranty no longer borrows the authority to issue one.
      'warranty',
      // The work-order board landed with P1-29 W1 at /work-orders, gated on
      // `wo.work_order.read` — the permission its only operation requires.
      'work-orders',
      // P1-29 W7: the inspection-template catalogue at `/work-orders/diagnostics`.
      'work-orders.diagnostics',
      // P1-29 W8: the branch QC queue at `/work-orders/quality`.
      'work-orders.quality',
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
      // `billing` left this list in P1-30 W6, and `payments` was ADDED as an
      // available entry in W7 (the module had no navigation row before it).
      // `customers` and `vehicles` left this list in P1-27, and `appointments`
      // in P1-28, when the screens they point at were built. `delivery` left
      // this list in P1-31 FE-001.
      'documents',
      // `inventory` left this list in P1-30 W4.
      'notifications',
      // `reports` left this list in P1-31 FE-011 … FE-014, when the catalogue and
      // the report screen were built.
      // `technicians` left this list in P1-29 W4, when the workspace was built.
      // `work-orders` left this list in P1-29 W1, `work-orders.diagnostics` in
      // W7 and `work-orders.quality` in W8.
    ]);
  });

  it('gates every entry on a permission that exists in the platform catalogue', () => {
    // `org.settings.read` was the previous Settings gate and is in NO catalogue
    // and NO operation — so "unknown means denied" hid the entry from every
    // actor who ever existed (finding P1-26-F-011).
    //
    // This assertion was scoped to the `administration` group and to a copied
    // list of seven codes, so it was green over `sal.delivery.read` — a code in
    // no catalogue, on the delivery entry, in another group (RES-05). P1-31 P-8
    // widened it: EVERY gated entry in EVERY group, including `planned` ones,
    // read against the seed itself rather than against a transcription of it.
    const seed = readFileSync(
      join(__dirname, '..', '..', '..', 'supabase', 'seeds', '04_iam_permission_catalog.sql'),
      'utf8'
    );
    // Only a VALUES row begins with `('code',`; the seed's prose comments begin
    // with `--` and are therefore never read as codes.
    const CATALOGUE = new Set(
      [...seed.matchAll(/^\s*\('([a-z0-9_]+(?:\.[a-z0-9_]+)+)'\s*,/gm)].map((m) => m[1])
    );
    expect(CATALOGUE.size, 'the catalogue seed parsed to nothing').toBeGreaterThan(100);
    const gated = ALL.filter((entry) => entry.permission !== null);
    expect(gated.length, 'no gated navigation entry was examined').toBeGreaterThan(0);
    for (const entry of gated) {
      expect(CATALOGUE.has(entry.permission!), `${entry.key} → ${entry.permission}`).toBe(true);
      for (const code of entry.alsoRequires ?? []) {
        expect(CATALOGUE.has(code), `${entry.key} → ${code}`).toBe(true);
      }
    }
  });

  it('requires a permission for every module except the design gallery', () => {
    const ungated = ALL.filter((entry) => entry.permission === null).map((e) => e.key);
    expect(ungated.sort()).toEqual(['gallery']);
    // The dashboard is gated on the one code its summary read is entitled by,
    // `wo.work_order.read`. Ungated, it offered the page to staff it could only
    // refuse.
    expect(ALL.find((entry) => entry.key === 'overview')?.permission).toBe('wo.work_order.read');
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
    expect(keys.sort()).toEqual(['gallery']);
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
    // first operation (customer search) requires. The dashboard does NOT: it
    // needs `wo.work_order.read`, which these capabilities do not hold.
    expect(keys.sort()).toEqual(['customers', 'gallery', 'vehicles', 'walk-in']);
  });

  it('offers the delivery queue only with every code its one read declares', () => {
    /*
     * The queue's page draws the shared refusal for a caller missing any of the
     * three, so an entry shown on the delivery code alone landed on a refusal.
     * Each code is dropped in turn: the entry must disappear every time.
     */
    const all = ['sal.delivery.view', 'wo.work_order.read', 'sal.finance.view'];
    const offered = (permissions: readonly string[]) =>
      visibleNavigation(NAVIGATION, { permissions })
        .flatMap((group) => group.items)
        .some((entry) => entry.key === 'delivery');
    expect(offered(all)).toBe(true);
    for (const missing of all) {
      expect(offered(all.filter((code) => code !== missing)), `offered without ${missing}`).toBe(
        false
      );
    }
  });

  it('reads `alsoRequires` as a conjunction, never as "any of"', () => {
    const gated = item({ permission: 'a.b.c', alsoRequires: ['d.e.f', 'g.h.i'] });
    const shown = (permissions: readonly string[]) =>
      visibleNavigation([{ key: 'g', labelKey: 'nav.dashboard', items: [gated] }], {
        permissions,
      }).length === 1;
    expect(shown(['a.b.c', 'd.e.f', 'g.h.i'])).toBe(true);
    expect(shown(['a.b.c', 'd.e.f'])).toBe(false);
    expect(shown(['d.e.f', 'g.h.i'])).toBe(false);
    expect(shown(['a.b.c'])).toBe(false);
  });
});
