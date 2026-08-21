import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { DataTable, type Column, type TableStatus } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { MoneyField } from '@/components/forms/MoneyField';
import { TextField } from '@/components/forms/Field';
import { PageHeader } from '@/components/shell/PageHeader';
import { LocaleSwitcher, swapLocale } from '@/components/shell/LocaleSwitcher';
import { Sidebar } from '@/components/shell/Sidebar';
import { NAVIGATION, flattenNavigation, hrefFor, navigationLinks } from '@/config/navigation';
import { getMessages } from '@/i18n/get-messages';
import { visibleNavigation } from '@/lib/permissions';
import { BOTH_DIRECTIONS, renderLtr, renderRtl } from './render';

// `useSearchParams` joined the mock when the locale switcher began preserving
// safe query parameters. An empty instance is the honest default: these cases
// assert the SWAP, and the carrying rule has its own tests below.
vi.mock('next/navigation', () => ({
  usePathname: () => '/en',
  useSearchParams: () => new URLSearchParams(''),
}));

const messages = getMessages('en');
const arabic = getMessages('ar');

const FULL = { permissions: NAVIGATION.flatMap((g) => g.items.map((i) => i.permission ?? 'x')) };

describe('sidebar', () => {
  const groups = visibleNavigation(NAVIGATION, FULL);

  it('is a navigation landmark with an accessible name', () => {
    renderLtr(
      <Sidebar locale="en" messages={messages} groups={groups} pathname="/en" collapsed={false} />
    );
    expect(screen.getByRole('navigation', { name: 'Modules' })).toBeInTheDocument();
  });

  it('marks the current route with aria-current', () => {
    renderLtr(
      <Sidebar locale="en" messages={messages} groups={groups} pathname="/en" collapsed={false} />
    );
    const overview = screen.getByRole('link', { name: 'Overview' });
    expect(overview).toHaveAttribute('aria-current', 'page');
  });

  it('renders a planned module as NOT a link', () => {
    // An operator who clicks a module and lands on a 404 stops trusting the
    // whole navigation.
    //
    // The example is `Inventory`, not `Customers`. Customers was planned when
    // this test was written and became available in P1-27 — so the assertion
    // started failing against a module that had simply been built. Inventory is
    // a later phase, which is what makes it a valid stand-in today; whoever
    // builds it will land here for the same reason and should move the example
    // on again rather than weaken the claim.
    renderLtr(
      <Sidebar locale="en" messages={messages} groups={groups} pathname="/en" collapsed={false} />
    );
    expect(screen.queryByRole('link', { name: /Inventory/ })).toBeNull();
    const planned = screen.getByText('Inventory', { selector: 'span' });
    expect(planned.closest('[aria-disabled="true"]')).not.toBeNull();
  });

  it('renders an AVAILABLE module as a real link', () => {
    // The other half, and the one that would have caught a `status` left at
    // `planned` after the screen shipped: a built module that still renders as
    // disabled text is unreachable from the sidebar, and nothing else in this
    // suite would notice.
    renderLtr(
      <Sidebar locale="en" messages={messages} groups={groups} pathname="/en" collapsed={false} />
    );
    const customers = screen.getByRole('link', { name: /Customers/ });
    expect(customers).toHaveAttribute('href', '/en/crm/customers');
  });

  it('keeps the accessible name when collapsed', async () => {
    const { rerender } = renderLtr(
      <Sidebar locale="en" messages={messages} groups={groups} pathname="/en" collapsed={false} />
    );
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    rerender(<Sidebar locale="en" messages={messages} groups={groups} pathname="/en" collapsed />);
    // Collapsing is a VISUAL affordance; it must not change what a screen
    // reader announces.
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
  });

  it('shows only what the actor may see', () => {
    const groupsForNobody = visibleNavigation(NAVIGATION, { permissions: [] });
    renderLtr(
      <Sidebar
        locale="en"
        messages={messages}
        groups={groupsForNobody}
        pathname="/en"
        collapsed={false}
      />
    );
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.queryByText('Billing')).toBeNull();
  });

  it('renders in Arabic under RTL', () => {
    renderRtl(
      <Sidebar locale="ar" messages={arabic} groups={groups} pathname="/ar" collapsed={false} />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('navigation', { name: 'الوحدات' })).toBeInTheDocument();
  });
});

/**
 * One current page, on every route the navigation declares.
 *
 * ## The defect
 *
 * Driven by hand against a production build, `/en/vehicles/duplicates` returned
 * TWO `aria-current="page"` links:
 *
 *     [ {"text":"Vehicles","href":"/en/vehicles","ariaCurrent":"page"},
 *       {"text":"Review duplicate vehicles","href":"/en/vehicles/duplicates","ariaCurrent":"page"} ]
 *
 * `/vehicles` is a path prefix of `/vehicles/duplicates` and the two entries are
 * SIBLINGS, not parent and child, so the prefix match — which is deliberate and
 * must survive, because `/vehicles/new` has to light up Vehicles — made both of
 * them claim to be the page. `aria-current="page"` names the current page, and
 * two of them tell a screen-reader user there are two.
 *
 * ## Why it is driven over the real config
 *
 * A fixture navigation would have proved a property of the fixture. The corpus
 * below is every route `NAVIGATION` declares, expanded from the real model, in
 * both renderings — the 64px rail renders a parent as a link and hides its
 * children, so the two states genuinely differ and only one of them was ever
 * looked at. The pair that reproduced the defect is asserted present by name, so
 * the day someone renames or removes those entries this stops being a
 * regression test silently.
 */
describe('exactly one item in the sidebar says it is the current page', () => {
  /*
   * Every permission in the model INCLUDING the children's.
   *
   * The `FULL` at the top of this file walks `group.items` only, so six
   * Administration children and six Settings children are invisible to it — and
   * a corpus that cannot render the child entries cannot see a defect that is
   * about which of two entries carries the marker.
   */
  const groups = visibleNavigation(NAVIGATION, {
    permissions: flattenNavigation(NAVIGATION).map((item) => item.permission ?? 'x'),
  });

  /** Every declared route, plus the deeper URLs no navigation entry names. */
  const ROUTES: readonly string[] = [
    ...new Set(flattenNavigation(NAVIGATION).map((item) => hrefFor('en', item))),
    // A record page. No nav entry points here, and the module above it must
    // still be the current page — this is the case exact matching would break.
    '/en/vehicles/a1b2c3d4-0000-4000-8000-000000000001',
    '/en/crm/customers/2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f',
    '/en/vehicles/new',
  ];

  function markedAt(pathname: string, collapsed: boolean): string[] {
    const { container, unmount } = renderLtr(
      <Sidebar
        locale="en"
        messages={messages}
        groups={groups}
        pathname={pathname}
        collapsed={collapsed}
      />
    );
    const nav = container.querySelector('[data-testid="sidebar-navigation"]');
    expect(nav, 'the sidebar navigation did not render').not.toBeNull();
    const marked = Array.from(nav?.querySelectorAll('[aria-current="page"]') ?? []).map(
      (node) => `${node.tagName}:${node.textContent ?? ''}`
    );
    unmount();
    return marked;
  }

  it.each([false, true])(
    'renders exactly the links `navigationLinks` names (collapsed=%s)',
    (collapsed) => {
      /*
       * The two copies of the disclosure rule, held together.
       *
       * `currentPageKey` decides which entry is the page by asking
       * `navigationLinks` which entries are links at all, and that function
       * states `hasChildren && !collapsed` a second time — `Sidebar.tsx` keeps
       * the original line because `hostile-mutations.mjs` `M-OA-04` anchors on
       * it verbatim. Two copies of a rule drift; this is what notices.
       *
       * It compares against what is actually RENDERED, not against a second
       * reading of the model, so it also catches the component growing a branch
       * the model does not know about.
       */
      const { container } = renderLtr(
        <Sidebar
          locale="en"
          messages={messages}
          groups={groups}
          pathname="/en"
          collapsed={collapsed}
        />
      );
      const nav = container.querySelector('[data-testid="sidebar-navigation"]');
      const rendered = Array.from(nav?.querySelectorAll('a[href]') ?? [])
        .map((node) => node.getAttribute('href') ?? '')
        .sort();
      const declared = navigationLinks(groups, collapsed)
        .map((item) => hrefFor('en', item))
        .sort();

      expect(rendered.length, 'the sidebar rendered no links at all').toBeGreaterThan(4);
      expect(rendered).toEqual(declared);
    }
  );

  it('drives the REAL navigation model, and it contains the pair that reproduced this', () => {
    // Anti-vacuity. A loop over an empty corpus passes and proves nothing.
    expect(ROUTES.length).toBeGreaterThan(15);
    expect(ROUTES).toContain('/en/vehicles');
    expect(ROUTES).toContain('/en/vehicles/duplicates');
    expect(ROUTES).toContain('/en/crm/customers');
    expect(ROUTES).toContain('/en/crm/customer-duplicates');
  });

  it.each(['/en/vehicles/duplicates', '/en/crm/customer-duplicates'])(
    'marks ONE current page on the duplicate queue at %s',
    (pathname) => {
      // The reproduction, named on its own: before the fix the vehicle queue
      // returned two links here, and the CRM twin returned one only because
      // `/crm/customer-duplicates` happens not to sit under `/crm/customers/`.
      const expanded = markedAt(pathname, false);
      expect(expanded, expanded.join(' | ')).toHaveLength(1);
      const rail = markedAt(pathname, true);
      expect(rail, rail.join(' | ')).toHaveLength(1);
    }
  );

  it.each(ROUTES)('never marks more than one current page on %s', (pathname) => {
    for (const collapsed of [false, true]) {
      const marked = markedAt(pathname, collapsed);
      expect(
        marked.length,
        `${pathname} (${collapsed ? 'rail' : 'expanded'}) marked ${marked.length}: ${marked.join(' | ')}`
      ).toBeLessThanOrEqual(1);
    }
  });

  it.each([
    // De-duplicated: `settings` and `settings.organization` name the same route,
    // and two cases with the same title read as one flaky case rather than two.
    ...new Set(
      flattenNavigation(NAVIGATION)
        .filter((item) => item.status === 'available')
        .map((item) => hrefFor('en', item))
    ),
  ])('still marks one current page on the built route %s', (pathname) => {
    // The other half. "At most one" is satisfied by marking NOTHING, which
    // would be a different accessibility defect wearing the same green tick.
    expect(markedAt(pathname, false)).toHaveLength(1);
    expect(markedAt(pathname, true)).toHaveLength(1);
  });

  it('keeps the module marked on a record page no navigation entry names', () => {
    // The prefix match is deliberate and must survive: a vehicle profile has no
    // entry of its own, and Vehicles is the nearest thing to where the operator
    // is. Exact matching would have left this page with no current item at all.
    const marked = markedAt('/en/vehicles/a1b2c3d4-0000-4000-8000-000000000001', false);
    expect(marked).toHaveLength(1);
    expect(marked[0]).toContain('Vehicles');
  });

  it('gives the marker to the queue and leaves the module above it visibly active', () => {
    renderLtr(
      <Sidebar
        locale="en"
        messages={messages}
        groups={groups}
        pathname="/en/vehicles/duplicates"
        collapsed={false}
      />
    );
    const vehicles = screen.getByRole('link', { name: 'Vehicles' });
    // The whole point of separating the two concepts: the treatment stays
    // prefix-based, only the announcement moved.
    expect(vehicles).not.toHaveAttribute('aria-current');
    expect(vehicles.className).toContain('bg-sidebar-active-background');
    expect(screen.getByRole('link', { name: 'Review duplicate vehicles' })).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});

describe('page header', () => {
  it('renders exactly one h1', () => {
    renderLtr(
      <PageHeader
        locale="en"
        messages={messages}
        titleKey="overview.title"
        descriptionKey="overview.description"
        crumbs={[{ labelKey: 'nav.overview', href: '/en' }, { labelKey: 'nav.gallery' }]}
      />
    );
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('marks the last breadcrumb as the current page and does not link it', () => {
    renderLtr(
      <PageHeader
        locale="en"
        messages={messages}
        titleKey="gallery.title"
        crumbs={[{ labelKey: 'nav.overview', href: '/en' }, { labelKey: 'nav.gallery' }]}
      />
    );
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByText('Component gallery')).toHaveAttribute('aria-current', 'page');
    expect(within(nav).queryByRole('link', { name: 'Component gallery' })).toBeNull();
  });

  it('marks ONE current page even when a parent crumb carries no href', () => {
    /*
     * The reproduction, held on its own.
     *
     * `Breadcrumbs` read `last || !crumb.href` — one branch answering two
     * different questions. "This crumb has no href" is not "this crumb is the
     * current page", and three routes passed a parent with no href on their
     * success branch, so index 0 and index 1 both announced themselves as the
     * page inside one breadcrumb landmark. The `Crumb` interface said the
     * opposite in words the whole time.
     */
    const { container } = renderLtr(
      <PageHeader
        locale="en"
        messages={messages}
        titleKey="vehicles.duplicates.title"
        crumbs={[{ labelKey: 'nav.vehicles' }, { labelKey: 'vehicles.duplicates.title' }]}
      />
    );
    const nav = breadcrumbLandmark(container);
    const marked = markedInside(nav);
    expect(marked, marked.join(' | ')).toHaveLength(1);
    expect(marked[0]).toBe('Review duplicate vehicles');
  });

  it('renders a route-less ancestor as plain text — not a link, and not current', () => {
    /*
     * The decided behaviour for the case the type still permits.
     *
     * `Crumb.href` is optional and `crumbs` is a plain array, so "every crumb
     * but the last has an href" cannot be stated in the type without turning
     * the prop into a tuple — which every `const crumbs = [...]` call site in
     * Administration would then fail to satisfy. So the component decides it
     * instead: a NON-LAST crumb with no href names an ancestor that has no
     * route of its own. It is rendered as plain muted text — not a link,
     * because there is nowhere to go, and never `aria-current`, because it is
     * not the page. The marker stays singular whatever a caller passes.
     *
     * That this case does not occur in this product is a separate claim, and it
     * is asserted below over the real trails rather than assumed here.
     */
    const { container } = renderLtr(
      <PageHeader
        locale="en"
        messages={messages}
        titleKey="vehicles.duplicates.title"
        crumbs={[{ labelKey: 'nav.vehicles' }, { labelKey: 'vehicles.duplicates.title' }]}
      />
    );
    const nav = breadcrumbLandmark(container);
    const ancestor = within(nav).getByText('Vehicles');
    expect(ancestor.tagName).toBe('SPAN');
    expect(ancestor).not.toHaveAttribute('aria-current');
    expect(within(nav).queryByRole('link', { name: 'Vehicles' })).toBeNull();
  });
});

/** The breadcrumb landmark, by the accessible name the shell actually gives it. */
function breadcrumbLandmark(container: HTMLElement): HTMLElement {
  const nav = container.querySelector<HTMLElement>(
    `nav[aria-label="${messages['shell.breadcrumbs']}"]`
  );
  expect(nav, 'the breadcrumb landmark did not render').not.toBeNull();
  return nav as HTMLElement;
}

/** The text of every node inside `nav` claiming to be the current page. */
function markedInside(nav: HTMLElement): string[] {
  return Array.from(nav.querySelectorAll('[aria-current="page"]')).map(
    (node) => node.textContent ?? ''
  );
}

/**
 * Exactly one breadcrumb says it is the page — over the trails the ROUTES pass.
 *
 * ## Why this is not the sidebar sweep one describe up
 *
 * That sweep scopes itself to `[data-testid="sidebar-navigation"]`, which is
 * precisely why this was invisible: the same defect class, one landmark over,
 * with nothing looking inside it. The sidebar fix (`currentPageKey`) separated
 * "which module am I in" from "which page am I on"; this is the same separation
 * applied to the breadcrumb — `aria-current="page"` belongs to the last crumb,
 * and having no href belongs to any crumb that has nowhere to point.
 *
 * ## Why the corpus is parsed rather than written
 *
 * The three routes that reproduced this pass their crumbs as an inline literal
 * at the call site. A fixture trail here would have proved a property of the
 * fixture; the component was never the whole defect, the call sites were half of
 * it. So the real arrays are read out of the source that renders them, and a
 * route added tomorrow is in the corpus the day it is written rather than the
 * day someone remembers to list it. Hand-listing is what let the duplicate-`h1`
 * defect survive its own fix in this phase.
 */
describe('exactly one breadcrumb says it is the current page', () => {
  const TRAILS = crumbTrailsInSource();

  /** Real keys for the crumbs whose `labelKey` the source computes at runtime. */
  const RUNTIME_LABEL_KEYS = ['nav.overview', 'nav.gallery', 'nav.profile'];

  function renderTrail(trail: SourceTrail) {
    return renderLtr(
      <PageHeader
        locale="en"
        messages={messages}
        titleKey="overview.title"
        crumbs={trail.crumbs.map((crumb, index) => ({
          labelKey: crumb.labelKey ?? (RUNTIME_LABEL_KEYS[index] as string),
          ...(crumb.href === null ? {} : { href: crumb.href }),
        }))}
      />
    );
  }

  it('really read the trails the application renders', () => {
    // Anti-vacuity. A sweep over an empty corpus passes and proves nothing, and
    // a reader that silently stopped matching would produce exactly that.
    expect(TRAILS.length, 'no breadcrumb trail was found in src/**').toBeGreaterThan(15);
    expect(TRAILS.every((trail) => trail.crumbs.length > 0)).toBe(true);

    // The four call sites that carried the defect, by name. Three were reported;
    // the vehicle profile is the fourth and was found by this sweep.
    const withMultipleCrumbs = TRAILS.filter((trail) => trail.crumbs.length > 1).map(
      (trail) => trail.file
    );
    for (const file of [
      'src/app/[locale]/(dashboard)/vehicles/duplicates/page.tsx',
      'src/app/[locale]/(dashboard)/vehicles/new/page.tsx',
      'src/app/[locale]/(dashboard)/vehicles/[vehicleId]/page.tsx',
      'src/app/[locale]/(dashboard)/crm/customer-duplicates/page.tsx',
    ]) {
      expect(withMultipleCrumbs, `${file} passes no multi-crumb trail`).toContain(file);
    }

    // Every `href` in the corpus resolved to a real path. An unresolvable one
    // would otherwise be read as "this crumb has no href" and quietly weaken
    // every case below into asserting nothing.
    const unresolved = TRAILS.flatMap((trail) =>
      trail.crumbs
        .filter((crumb) => crumb.hasHref && crumb.href === null)
        .map(() => `${trail.file}:${trail.line}`)
    );
    expect(unresolved, `the crumb reader could not resolve: ${unresolved.join(', ')}`).toEqual([]);
  });

  it.each(TRAILS.map((trail) => [`${trail.file}:${trail.line}`, trail] as const))(
    'marks exactly one current page in the trail at %s',
    (_where, trail) => {
      const { container } = renderTrail(trail);
      const marked = markedInside(breadcrumbLandmark(container));
      expect(marked, `marked ${marked.length}: ${marked.join(' | ')}`).toHaveLength(1);
    }
  );

  it.each(TRAILS.map((trail) => [`${trail.file}:${trail.line}`, trail] as const))(
    'gives the marker to the LAST crumb in the trail at %s',
    (_where, trail) => {
      // The other half. "At most one" is satisfied by marking nothing, and by
      // marking the wrong crumb — both are green against the case above.
      const { container } = renderTrail(trail);
      const nav = breadcrumbLandmark(container);
      const items = Array.from(nav.querySelectorAll('li'));
      expect(items).toHaveLength(trail.crumbs.length);
      const lastItem = items[items.length - 1] as HTMLElement;
      expect(markedInside(lastItem)).toHaveLength(1);
    }
  );

  it.each(TRAILS.map((trail) => [`${trail.file}:${trail.line}`, trail] as const))(
    'leaves a route back from every ancestor in the trail at %s',
    (_where, trail) => {
      /*
       * The second half of the defect, and the one an operator feels.
       *
       * A parent crumb rendered as a `<span>` is not merely a duplicated
       * marker: it is a duplicate queue and a create form with no breadcrumb
       * route back to the list they belong to. Every crumb but the last is a
       * link here, which is also what makes "no route-less ancestor exists in
       * this product" a measurement rather than an assumption.
       */
      const { container } = renderTrail(trail);
      const nav = breadcrumbLandmark(container);
      const links = Array.from(nav.querySelectorAll('a[href]'));
      expect(links, `${trail.crumbs.length - 1} ancestor(s), ${links.length} link(s)`).toHaveLength(
        trail.crumbs.length - 1
      );
      expect(links.every((link) => (link.getAttribute('href') ?? '').length > 0)).toBe(true);
    }
  );
});

describe('locale switcher', () => {
  it('swaps only the locale segment', () => {
    expect(swapLocale('/en/gallery', 'ar')).toBe('/ar/gallery');
    expect(swapLocale('/ar', 'en')).toBe('/en');
    expect(swapLocale('/en/work-orders/diagnostics', 'ar')).toBe('/ar/work-orders/diagnostics');
  });

  it('prefixes a path that carries no locale rather than overwriting a segment', () => {
    expect(swapLocale('/gallery', 'ar')).toBe('/ar/gallery');
    expect(swapLocale('/', 'en')).toBe('/en');
  });

  it('renders real links, so direction is set by the server on the next document', () => {
    renderLtr(<LocaleSwitcher locale="en" messages={messages} />);
    const arabicLink = screen.getByRole('link', { name: 'العربية' });
    expect(arabicLink).toHaveAttribute('href', '/ar');
    expect(arabicLink).toHaveAttribute('hreflang', 'ar');
  });
});

interface Row {
  readonly id: string;
  readonly reference: string;
  readonly amount: string;
}

const ROWS: Row[] = [
  { id: '1', reference: 'DOC-000001', amount: '10.0000' },
  { id: '2', reference: 'DOC-000002', amount: '20.0000' },
];

const COLUMNS: readonly Column<Row>[] = [
  { id: 'reference', headerKey: 'column.reference', sortable: true, cell: (r) => r.reference },
  { id: 'amount', headerKey: 'column.amount', numeric: true, cell: (r) => r.amount },
];

function TableHost({ status = 'idle' }: { readonly status?: TableStatus }) {
  const [request, setRequest] = useState<TableRequest>(INITIAL_REQUEST);
  return (
    <DataTable
      messages={messages}
      columns={COLUMNS}
      rowId={(row) => row.id}
      request={request}
      response={{ rows: ROWS, total: 42, page: request.page, pageSize: request.pageSize }}
      status={status}
      onRequestChange={setRequest}
      caption="Fixtures"
    />
  );
}

describe('data table', () => {
  it('announces the sort state on the header, not only with an arrow', async () => {
    const user = userEvent.setup();
    renderLtr(<TableHost />);
    const header = screen.getByRole('columnheader', { name: /Reference/ });
    expect(header).toHaveAttribute('aria-sort', 'none');
    await user.click(within(header).getByRole('button'));
    expect(screen.getByRole('columnheader', { name: /Reference/ })).toHaveAttribute(
      'aria-sort',
      'ascending'
    );
  });

  it('gives pagination controls word names, not glyph names', () => {
    renderLtr(<TableHost />);
    // "«" is announced as "left-pointing double angle quotation mark", which is
    // both wrong and direction-dependent.
    for (const name of ['First page', 'Previous page', 'Next page', 'Last page']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('announces the visible range politely', () => {
    renderLtr(<TableHost />);
    const status = screen.getByText(/Showing/);
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('1–25');
    expect(status).toHaveTextContent('42');
  });

  it('disables paging backwards on the first page', () => {
    renderLtr(<TableHost />);
    expect(screen.getByRole('button', { name: 'First page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous page' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next page' })).toBeEnabled();
  });

  it('marks the body busy while loading', () => {
    renderLtr(<TableHost status="loading" />);
    // aria-busy on the body, so assistive technology knows the rows are being
    // replaced rather than reading a half-updated table.
    const [, body] = screen.getAllByRole('rowgroup');
    expect(body).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('DOC-000001')).toBeNull();
  });

  it('renders the denied state INSTEAD of the rows', () => {
    renderLtr(<TableHost status="denied" />);
    // A denied table that paints its rows and covers them has already sent the
    // data to the browser.
    expect(screen.queryByText('DOC-000001')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('You do not have access');
  });

  it('has no axe violations in either direction', async () => {
    for (const [, renderIn] of BOTH_DIRECTIONS) {
      const { container, unmount } = renderIn(<TableHost />);
      const results = await axe(container);
      expect(results.violations).toEqual([]);
      unmount();
    }
  });
});

describe('form controls', () => {
  it('associates label, description and error with the control', () => {
    renderLtr(
      <TextField
        label="Name"
        description="A short label"
        error="This field is required."
        required
      />
    );
    const input = screen.getByLabelText(/Name/);
    expect(input).toHaveAccessibleDescription(/A short label/);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-required', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('This field is required.');
  });

  it('keeps a money amount as a string and canonicalises on blur', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderLtr(
      <MoneyField messages={messages} label="Amount" currency="JOD" value="" onChange={onChange} />
    );
    const input = screen.getByLabelText(/Amount/);
    await user.type(input, '12.5');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('12.5000', true);
    expect(input).toHaveValue('12.5000');
  });

  it('is a text input, not a number input', () => {
    // A number input silently accepts exponent notation, drops leading zeros and
    // hands back a value the browser already coerced.
    renderLtr(
      <MoneyField messages={messages} label="Amount" currency="JOD" value="" onChange={vi.fn()} />
    );
    const input = screen.getByLabelText(/Amount/);
    expect(input).toHaveAttribute('type', 'text');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveAttribute('dir', 'ltr');
  });

  it('reports an invalid amount rather than coercing it', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    renderLtr(
      <MoneyField messages={messages} label="Amount" currency="JOD" value="" onChange={onChange} />
    );
    await user.type(screen.getByLabelText(/Amount/), '12.00001');
    await user.tab();
    expect(onChange).toHaveBeenLastCalledWith('12.00001', false);
    expect(screen.getByRole('alert')).toHaveTextContent('At most four decimal places.');
  });

  it('has no axe violations in either direction', async () => {
    for (const [, renderIn] of BOTH_DIRECTIONS) {
      const { container, unmount } = renderIn(
        <TextField label="Name" description="A short label" required />
      );
      const results = await axe(container);
      expect(results.violations).toEqual([]);
      unmount();
    }
  });
});

/**
 * A breadcrumb trail exactly as some file in `src/**` passes it.
 *
 * `labelKey` is `null` when the source computes it (`{ labelKey: titleKey }` on
 * the customer create route). Only the SHAPE of a trail matters to the cases
 * above — which crumbs carry an href, and how many there are — so a computed
 * label is substituted rather than resolved. `hasHref` is kept apart from
 * `href`: "the source passes no href" and "the reader could not work out what
 * the href is" are different facts, and collapsing them would turn a reader that
 * stopped working into a corpus that silently proves nothing.
 */
interface SourceCrumb {
  readonly labelKey: string | null;
  readonly href: string | null;
  readonly hasHref: boolean;
}

interface SourceTrail {
  /** Repository-relative, forward slashes, so a failure names the call site. */
  readonly file: string;
  readonly line: number;
  readonly crumbs: readonly SourceCrumb[];
}

/**
 * Every crumb array in `src/**`, read with the TypeScript parser.
 *
 * A regex over the source is what this phase keeps getting wrong — it reads
 * prose in a docblock as code, and it cannot tell `crumbs={crumbs}` from
 * `crumbs={[…]}`. The real parser can, so the corpus is the syntax rather than
 * a pattern that resembles it.
 *
 * Both forms are collected: the inline `crumbs={[…]}` attribute, and the
 * `const crumbs = [...]` an Administration route declares once and passes to
 * both of its branches.
 */
function crumbTrailsInSource(): readonly SourceTrail[] {
  const root = join(process.cwd(), 'src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith('.tsx')) files.push(path);
    }
  };
  walk(root);

  const trails: SourceTrail[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    if (!text.includes('crumbs')) continue;
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      const array = crumbArrayOf(node);
      if (array) {
        trails.push({
          file: relative(process.cwd(), file).split(sep).join('/'),
          line: source.getLineAndCharacterOfPosition(array.getStart(source)).line + 1,
          crumbs: array.elements.map(readSourceCrumb),
        });
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return trails;
}

/** The array literal a node passes as `crumbs`, or `null` if it passes none. */
function crumbArrayOf(node: ts.Node): ts.ArrayLiteralExpression | null {
  if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && node.name.text === 'crumbs') {
    const initializer = node.initializer;
    if (
      initializer &&
      ts.isJsxExpression(initializer) &&
      initializer.expression &&
      ts.isArrayLiteralExpression(initializer.expression)
    ) {
      return initializer.expression;
    }
    // `crumbs={crumbs}` — the array itself is collected at its declaration.
    return null;
  }
  if (
    ts.isVariableDeclaration(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'crumbs' &&
    node.initializer &&
    ts.isArrayLiteralExpression(node.initializer)
  ) {
    return node.initializer;
  }
  return null;
}

function readSourceCrumb(element: ts.Expression): SourceCrumb {
  if (!ts.isObjectLiteralExpression(element)) {
    return { labelKey: null, href: null, hasHref: true };
  }
  let labelKey: string | null = null;
  let href: string | null = null;
  let hasHref = false;
  for (const property of element.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
    if (property.name.text === 'labelKey') labelKey = staticText(property.initializer);
    if (property.name.text === 'href') {
      hasHref = true;
      href = staticText(property.initializer);
    }
  }
  return { labelKey, href, hasHref };
}

/**
 * A string the source states outright, with each `${identifier}` filled in.
 *
 * Every crumb href in this application is a literal or a template, and every
 * hole in one is a plain identifier: the locale, or — since the reception
 * acknowledgement gained a visit as its parent crumb — a route parameter naming
 * the record the ancestor page is for. `locale` resolves to `en` because a
 * rendered trail needs a real locale segment; any other identifier resolves to a
 * stable placeholder segment, which is all this suite needs of it. What it
 * asserts about an href is that the ancestor HAS one and that it is not empty;
 * which record it points at is not a property of the breadcrumb.
 *
 * Anything that is not a plain identifier — a call, a member access, a
 * conditional — still returns `null`, and the corpus case fails naming the file
 * rather than treating an href it could not read as an absent one. That is the
 * property this function exists to protect: an unreadable href must never be
 * silently downgraded into "this crumb is the current page".
 */
function staticText(node: ts.Expression): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      if (!ts.isIdentifier(span.expression)) return null;
      text += `${span.expression.text === 'locale' ? 'en' : 'record-id'}${span.literal.text}`;
    }
    return text;
  }
  return null;
}
