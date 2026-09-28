import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
  RETIRED_BOX,
} from './render';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  stayOnBranch,
  switchExpectingQuestion,
  switchWithoutQuestion,
} from './support/branch-switch';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import { SERVICE_LIFECYCLE_STATES } from '@/features/services/services-contract';

/**
 * The service catalogue, rendered (P1-30, `W1`, FE-001) — on the shared
 * Material UI wrappers (`P1-32-PRE-OD-MUISP`, ADR-022).
 *
 * The properties under test are the ones a catalogue gets wrong: hiding a
 * retired service, turning a refusal or an outage into "no services", printing
 * an identifier for a category it cannot name, and offering a branch list to an
 * operator who may not read one. And the ones the move onto the wrappers must
 * keep: the search goes to the server as typed, a filter change is a new read,
 * a date only partly typed never reaches the read, the category is chosen from
 * the taxonomy's own hierarchy, and a create form that refuses marks the field,
 * keeps what was typed and puts the cursor on it.
 *
 * Labels are matched ANCHORED and scoped: the field frame decorates a label (a
 * required marker), and the filter and the create form both name a
 * "Category".
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A label matcher anchored at the start of the label text. */
const labelled = (key: string, catalogue: Record<string, string> = EN) =>
  new RegExp(`^${escape(catalogue[key] as string)}`);

const listServices = vi.fn();
const listServiceCategories = vi.fn();
const listBranches = vi.fn();
const createService = vi.fn();
const createServiceCategory = vi.fn();
vi.mock('@/features/services/api', () => ({
  listServices: (...args: unknown[]) => listServices(...args),
  listServiceCategories: () => listServiceCategories(),
  listBranches: () => listBranches(),
  createService: (...args: unknown[]) => createService(...args),
  createServiceCategory: (...args: unknown[]) => createServiceCategory(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  // `notFound()` throws in Next; a stub that returned would let a route render
  // past a locale it does not serve.
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

// The route pages are rendered here too: an async server component that no
// unit test renders sits in the coverage denominator at 0% and is exactly the
// "dashboard-routes-unrendered" gap the web coverage baseline records. The
// session is the only server dependency; it is the page's permission source.
let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'operator@test.local' }),
}));

type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
async function renderPage(page: RoutePage, params: Record<string, string>) {
  const tree = await page({ params: Promise.resolve(params) });
  return renderLtr(withMui(tree as ReactElement));
}

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { ServiceCatalogueScreen } =
  await import('@/features/services/components/ServiceCatalogueScreen');
const ServiceCataloguePage = (await import('@/app/[locale]/(dashboard)/services/page'))
  .default as unknown as RoutePage;

const CATEGORY = '66666666-6666-4666-8666-666666666666';
const CHILD_CATEGORY = '77777777-7777-4777-8777-777777777777';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const COMPANY = '11111111-1111-4111-8111-111111111111';

function row(over: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    serviceCode: 'OIL-CHANGE',
    name: 'Oil change',
    description: null,
    categoryId: CATEGORY,
    lifecycleStatus: 'active',
    recordVersion: 1,
    ...over,
  };
}

function page(rows: readonly unknown[], hasMore = false) {
  return {
    status: 'ok' as const,
    rows,
    nextCursor: hasMore ? 'c1' : null,
    hasMore,
    correlationId: 'corr',
  };
}

const failedPage = (status: string) => ({
  status,
  rows: [],
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr-f',
});

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const deniedRead = { status: 'denied' as const, correlationId: 'corr' };

/** The taxonomy as the read answers it: a parent and a child filed under it. */
const TAXONOMY = [
  { id: CATEGORY, code: 'engine', name: 'Engine', parentCategoryId: null, status: 'active' },
  {
    id: CHILD_CATEGORY,
    code: 'engine_oil',
    name: 'Engine oil',
    parentCategoryId: CATEGORY,
    status: 'active',
  },
];

/** The product's Material provider, as the locale layout mounts it. */
function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

function renderCatalogue(over: Record<string, unknown> = {}) {
  return renderLtr(
    withMui(
      <ServiceCatalogueScreen
        locale="en"
        messages={en}
        canManage={false}
        canReadBranches={false}
        {...over}
      />
    )
  );
}

/** The criteria of the latest read. */
const lastCriteria = () => listServices.mock.calls.at(-1)?.[0];
const grid = () => screen.findByRole('grid', { name: EN['services.catalogue.caption'] as string });
const filterTree = () =>
  screen.getByRole('tree', { name: labelled('services.catalogue.category') });
const createToggle = () =>
  screen.getByRole('button', { name: EN['services.catalogue.create'] as string });
const createForm = () => screen.findByRole('form', { name: EN['services.create.title'] as string });

async function typeDay(
  user: ReturnType<typeof userEvent.setup>,
  group: HTMLElement,
  digits: string
): Promise<void> {
  await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
  await user.keyboard(digits);
}

beforeEach(() => {
  vi.clearAllMocks();
  listServices.mockResolvedValue(page([row()]));
  listServiceCategories.mockResolvedValue(
    okRead({ items: TAXONOMY, nextCursor: null, hasMore: false })
  );
  listBranches.mockResolvedValue(
    okRead({ items: [{ id: BRANCH, companyId: COMPANY, branchCode: 'B1', name: 'Main' }] })
  );
});

describe('the catalogue is tenant-wide, so it reads on first paint', () => {
  it('issues the read without waiting for a filter, and lists it in the grid', async () => {
    renderCatalogue();
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    expect(listServices.mock.calls[0]?.[0]).toEqual({});
    const table = await grid();
    expect(await within(table).findByText('OIL-CHANGE')).toBeVisible();
    // No total is published, so none is drawn: the footer says the page only.
    expect(screen.getByTestId('service-catalogue-grid-page')).toHaveTextContent('1');
  });

  it('sends the typed term to the server as typed, Arabic-Indic digits included', async () => {
    const user = userEvent.setup();
    renderCatalogue();
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    const box = screen.getByRole('searchbox', { name: EN['services.catalogue.search'] as string });
    await user.type(box, 'OIL-٣');
    await waitFor(() => expect(lastCriteria()).toEqual({ search: 'OIL-٣' }));
    // The digits are echoed as Latin for reading only. The echo is true because
    // `svc.service-list` folds the digits on both sides of its comparison
    // (tests/unit/p1-32-service-search-digits.test.ts and the backend suite).
    expect(screen.getByTestId('digits-echo')).toHaveTextContent(
      `${EN['form.digitsEcho'] as string} OIL-3`
    );
    expect(screen.getByText(EN['services.catalogue.searchExample'] as string)).toBeVisible();
  });

  it('Enter asks at once, and Escape clears the term and reads the whole catalogue', async () => {
    const user = userEvent.setup();
    renderCatalogue();
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    const box = screen.getByRole('searchbox', { name: EN['services.catalogue.search'] as string });
    await user.type(box, 'OIL{Enter}');
    await waitFor(() => expect(lastCriteria()).toEqual({ search: 'OIL' }));
    await user.keyboard('{Escape}');
    expect(box).toHaveValue('');
    await waitFor(() => expect(lastCriteria()).toEqual({}));
  });

  it('offers exactly the lifecycle vocabulary the contract mirrors, and a choice is a new read', async () => {
    const user = userEvent.setup();
    renderCatalogue();
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    const chips = screen.getByRole('group', { name: EN['services.catalogue.lifecycle'] as string });
    const offered = within(chips)
      .getAllByRole('button')
      .map((chip) => chip.textContent);
    expect(offered).toEqual([
      EN['filters.chips.all'],
      ...SERVICE_LIFECYCLE_STATES.map((state) => EN[`services.lifecycle.${state}`]),
    ]);
    await user.click(
      within(chips).getByRole('button', { name: EN['services.lifecycle.archived'] as string })
    );
    await waitFor(() => expect(lastCriteria()).toEqual({ lifecycleStatus: 'archived' }));
  });
});

describe('the category is chosen from the taxonomy’s own hierarchy', () => {
  it('draws a child category under its parent, and choosing it filters by it', async () => {
    const user = userEvent.setup();
    renderCatalogue();
    await waitFor(() => expect(listServiceCategories).toHaveBeenCalled());
    const tree = filterTree();
    const parent = await within(tree).findByRole('treeitem', { name: /^Engine$/ });
    // The child sits inside its parent's group, not beside it.
    await user.click(within(parent).getByText('Engine'));
    await waitFor(() => expect(lastCriteria()).toEqual({ categoryId: CATEGORY }));
    // Opening the parent shows the child, nested.
    parent.focus();
    await user.keyboard('{ArrowRight}');
    const child = await within(parent).findByRole('treeitem', { name: 'Engine oil' });
    await user.click(within(child).getByText('Engine oil'));
    await waitFor(() => expect(lastCriteria()).toEqual({ categoryId: CHILD_CATEGORY }));
    // "Any category" lifts the filter.
    await user.click(within(tree).getByText(EN['services.catalogue.anyCategory'] as string));
    await waitFor(() => expect(lastCriteria()).toEqual({}));
  });

  it('says a refused taxonomy under the tree, and names no category by identifier', async () => {
    listServiceCategories.mockResolvedValue(deniedRead);
    renderCatalogue();
    // Said under the tree, after the tree's own help.
    expect(
      await screen.findByText(
        new RegExp(escape(EN['services.catalogue.categoriesRefused'] as string))
      )
    ).toBeVisible();
    const table = await grid();
    expect(
      await within(table).findByText(EN['services.catalogue.unknownCategory'] as string)
    ).toBeVisible();
    expect(within(table).queryByText(CATEGORY)).toBeNull();
  });
});

describe('the published-on day is a calendar day, and a half-typed one is refused', () => {
  it('sends a whole day, and holds the day in force while the entry is unfinished', async () => {
    const user = userEvent.setup();
    renderCatalogue();
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    const group = screen.getByRole('group', { name: labelled('services.catalogue.effectiveOn') });
    await typeDay(user, group, '01102026');
    await waitFor(() => expect(lastCriteria()).toEqual({ effectiveOn: '2026-10-01' }));

    // Erasing the year leaves a day only partly typed: the field says so, and
    // the list keeps the day that was last whole rather than dropping it.
    const calls = listServices.mock.calls.length;
    const year = within(group).getAllByRole('spinbutton')[2] as HTMLElement;
    await user.click(year);
    await user.keyboard('{Backspace}');
    await waitFor(() => expect(group).toHaveAttribute('aria-invalid', 'true'));
    expect(group).toHaveAccessibleDescription(
      new RegExp(escape(EN['services.catalogue.dateFormat'] as string))
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(listServices.mock.calls.slice(calls).map((call) => call[0])).not.toContainEqual({});

    // Finished again: the complaint goes and the whole day is read.
    await user.keyboard('2027');
    await waitFor(() => expect(group).not.toHaveAttribute('aria-invalid'));
    await waitFor(() => expect(lastCriteria()).toEqual({ effectiveOn: '2027-10-01' }));
  });
});

describe('retired services, refusals and outages render as themselves', () => {
  it('shows a retired service, marked retired, beside an active one', async () => {
    listServices.mockResolvedValue(
      page([row(), row({ id: 'r-1', serviceCode: 'OLD-SVC', lifecycleStatus: 'archived' })])
    );
    renderCatalogue();
    const table = await grid();
    expect(await within(table).findByText('OLD-SVC')).toBeVisible();
    expect(within(table).getByText(EN['services.lifecycle.archived'] as string)).toBeVisible();
    expect(within(table).getByText(EN['services.lifecycle.active'] as string)).toBeVisible();
  });

  it('renders the category NAME when the taxonomy has it', async () => {
    renderCatalogue();
    const table = await grid();
    expect(await within(table).findByText('Engine')).toBeVisible();
  });

  it('says in words when the category is not in the loaded list — never the identifier', async () => {
    const unknown = '88888888-8888-4888-8888-888888888888';
    listServices.mockResolvedValue(page([row({ categoryId: unknown })]));
    renderCatalogue();
    const table = await grid();
    expect(
      await within(table).findByText(EN['services.catalogue.unknownCategory'] as string)
    ).toBeVisible();
    expect(screen.queryByText(unknown)).toBeNull();
  });

  it('renders the refused state instead of an empty catalogue', async () => {
    listServices.mockResolvedValue(failedPage('denied'));
    renderCatalogue();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByRole('grid')).toBeNull();
    expect(screen.queryByText(EN['state.empty.title'] as string)).toBeNull();
  });

  it('a throttled or unanswered read is "unavailable, try again", never an empty list', async () => {
    const user = userEvent.setup();
    listServices.mockResolvedValueOnce(failedPage('unavailable'));
    renderCatalogue();
    expect(await screen.findByText(EN['state.unavailable.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['state.empty.title'] as string)).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
    await user.click(screen.getByRole('button', { name: EN['state.retry'] as string }));
    const table = await grid();
    expect(await within(table).findByText('OIL-CHANGE')).toBeVisible();
  });

  it('an empty catalogue with nothing narrowing it is "nothing here yet", not "no matches"', async () => {
    listServices.mockResolvedValue(page([]));
    renderCatalogue();
    expect(await screen.findByTestId('service-catalogue-empty')).toBeVisible();
    expect(screen.queryByText(EN['state.noResults.title'] as string)).toBeNull();
  });

  it('an empty answer to a filter says "no matches" and offers to clear the filters', async () => {
    const user = userEvent.setup();
    renderCatalogue();
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    listServices.mockResolvedValue(page([]));
    const chips = screen.getByRole('group', { name: EN['services.catalogue.lifecycle'] as string });
    await user.click(
      within(chips).getByRole('button', { name: EN['services.lifecycle.archived'] as string })
    );
    expect(await screen.findByText(EN['state.noResults.title'] as string)).toBeVisible();
    listServices.mockResolvedValue(page([row()]));
    await user.click(screen.getByRole('button', { name: EN['table.clearFilters'] as string }));
    await waitFor(() => expect(lastCriteria()).toEqual({}));
  });
});

describe('the branch filter follows the operator’s access', () => {
  it('without org.branch.read or a working context, says so and offers no box', () => {
    renderCatalogue({ canReadBranches: false });
    expect(screen.queryByLabelText(RETIRED_BOX.en.branch)).toBeNull();
    expect(screen.getByText(EN['services.catalogue.branchesNotOffered'] as string)).toBeVisible();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('without org.branch.read, the working context names the branches to filter by', async () => {
    const user = userEvent.setup();
    renderLtr(
      withMui(
        inBranch(
          <ServiceCatalogueScreen
            locale="en"
            messages={en}
            canManage={false}
            canReadBranches={false}
          />
        )
      )
    );
    const select = screen.getByLabelText(labelled('services.catalogue.availableAtBranch'));
    expect(
      within(select).getByRole('option', { name: `${TEST_BRANCH.code} — ${TEST_BRANCH.name}` })
    ).toBeInTheDocument();
    expect(listBranches).not.toHaveBeenCalled();
    await user.selectOptions(select, TEST_BRANCH.id);
    await waitFor(() => expect(lastCriteria()).toEqual({ availableAtBranchId: TEST_BRANCH.id }));
  });

  it('with org.branch.read, offers the branch list by code and name', async () => {
    const user = userEvent.setup();
    renderCatalogue({ canReadBranches: true });
    await waitFor(() => expect(listBranches).toHaveBeenCalled());
    const select = await screen.findByLabelText(labelled('services.catalogue.availableAtBranch'));
    expect(within(select).getByRole('option', { name: 'B1 — Main' })).toBeInTheDocument();
    await user.selectOptions(select, BRANCH);
    // A resource selector, sent under the route's own name.
    await waitFor(() => expect(lastCriteria()).toEqual({ availableAtBranchId: BRANCH }));
  });
});

/* -------------------------------------------------------------------- *
 * P1-30 CC-15, the services copy of the branch picker.
 *
 * `items === null` meant both "no request was made" and "the request has not
 * answered", so a PERMITTED operator met a free-text identifier box on every
 * first paint.
 * -------------------------------------------------------------------- */
describe('CC-15 — the services branch picker says which state it is in', () => {
  const listedBranches = okRead({
    items: [{ id: BRANCH, companyId: COMPANY, branchCode: 'B1', name: 'Main' }],
  });

  it('while a permitted read is in flight, waits — and offers no field at all', async () => {
    let release: (value: unknown) => void = () => {};
    listBranches.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderCatalogue({ canReadBranches: true });
    expect(screen.getByText(EN['services.catalogue.branchesLoading'] as string)).toHaveAttribute(
      'role',
      'status'
    );
    expect(screen.queryByLabelText(RETIRED_BOX.en.branch)).toBeNull();
    expect(screen.queryByLabelText(labelled('services.catalogue.availableAtBranch'))).toBeNull();
    release(listedBranches);
    expect(
      await screen.findByLabelText(labelled('services.catalogue.availableAtBranch'))
    ).toBeVisible();
    expect(screen.queryByText(EN['services.catalogue.branchesLoading'] as string)).toBeNull();
  });

  it('with no branch listed, says so and offers no box to type a reference into', async () => {
    listBranches.mockResolvedValue(okRead({ items: [] }));
    renderCatalogue({ canReadBranches: true });
    expect(await screen.findByText(EN['services.catalogue.branchesNone'] as string)).toBeVisible();
    expect(screen.queryByLabelText(RETIRED_BOX.en.branch)).toBeNull();
    expect(screen.queryByLabelText(labelled('services.catalogue.availableAtBranch'))).toBeNull();
  });

  it('a failure that could clear offers a retry, and the list then arrives', async () => {
    const user = userEvent.setup();
    listBranches
      .mockResolvedValueOnce({ status: 'unavailable', correlationId: 'corr' })
      .mockResolvedValueOnce(listedBranches);
    renderCatalogue({ canReadBranches: true });
    const sentence = await screen.findByText(
      EN['services.catalogue.branchesUnavailable'] as string
    );
    expect(sentence).toBeVisible();
    await user.click(
      within(sentence.parentElement as HTMLElement).getByRole('button', {
        name: EN['state.retry'] as string,
      })
    );
    expect(
      await screen.findByLabelText(labelled('services.catalogue.availableAtBranch'))
    ).toBeVisible();
    expect(listBranches).toHaveBeenCalledTimes(2);
  });

  it('states a refusal, and an ended session, without offering a second attempt', async () => {
    listBranches.mockResolvedValue(deniedRead);
    const first = renderCatalogue({ canReadBranches: true });
    expect(
      await screen.findByText(EN['services.catalogue.branchesRefused'] as string)
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
    first.unmount();

    listBranches.mockResolvedValue({ status: 'expired', correlationId: 'corr' });
    renderCatalogue({ canReadBranches: true });
    expect(await screen.findByText(EN['state.expired.message'] as string)).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('in Arabic, a read in flight is a wait and not an identifier box', async () => {
    let release: (value: unknown) => void = () => {};
    listBranches.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderRtl(
      withMui(
        <ServiceCatalogueScreen locale="ar" messages={ar} canManage={false} canReadBranches />,
        'ar'
      )
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR['services.catalogue.branchesLoading'] as string)).toHaveAttribute(
      'role',
      'status'
    );
    expect(screen.queryByLabelText(RETIRED_BOX.ar.branch)).toBeNull();
    release(listedBranches);
    expect(
      await screen.findByLabelText(labelled('services.catalogue.availableAtBranch', AR))
    ).toBeVisible();
  });

  it('in Arabic, a zero-row list says so and offers no identifier box', async () => {
    listBranches.mockResolvedValue(okRead({ items: [] }));
    renderRtl(
      withMui(
        <ServiceCatalogueScreen locale="ar" messages={ar} canManage={false} canReadBranches />,
        'ar'
      )
    );
    expect(await screen.findByText(AR['services.catalogue.branchesNone'] as string)).toBeVisible();
    expect(screen.queryByLabelText(RETIRED_BOX.ar.branch)).toBeNull();
  });
});

describe('creating, offered only to those who may', () => {
  it('does not offer the create forms without svc.service.manage', () => {
    renderCatalogue({ canManage: false });
    expect(
      screen.queryByRole('button', { name: EN['services.catalogue.create'] as string })
    ).toBeNull();
  });

  it('creates a service under a category chosen from the tree, and moves to it', async () => {
    const user = userEvent.setup();
    createService.mockResolvedValue({
      state: { status: 'success', messageKey: 'services.create.success', attempt: 1 },
      created: row({ id: 'new-id' }),
    });
    renderCatalogue({ canManage: true });
    await waitFor(() => expect(listServiceCategories).toHaveBeenCalled());
    await user.click(createToggle());

    const form = await createForm();
    const tree = within(form).getByRole('tree', { name: labelled('services.create.category') });
    await user.click(await within(tree).findByText('Engine'));
    await user.type(within(form).getByLabelText(labelled('services.create.code')), 'BRAKE-PADS');
    await user.type(within(form).getByLabelText(labelled('services.create.name')), 'Brake pads');
    await user.click(
      within(form).getByRole('button', { name: EN['services.create.submit'] as string })
    );

    await waitFor(() => expect(createService).toHaveBeenCalled());
    expect(createService.mock.calls[0]?.[0]).toEqual({
      serviceCategoryId: CATEGORY,
      serviceCode: 'BRAKE-PADS',
      name: 'Brake pads',
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/services/new-id'));
  });

  it('a refused form marks the field, keeps the typed values, focuses the first problem and clears on correction', async () => {
    for (const [locale, catalogue, render] of [
      ['en', EN, renderLtr],
      ['ar', AR, renderRtl],
    ] as const) {
      const user = userEvent.setup();
      const view = render(
        withMui(
          <ServiceCatalogueScreen
            locale={locale}
            messages={locale === 'en' ? en : ar}
            canManage
            canReadBranches={false}
          />,
          locale
        )
      );
      await waitFor(() => expect(listServiceCategories).toHaveBeenCalled());
      await user.click(
        screen.getByRole('button', { name: catalogue['services.catalogue.create'] as string })
      );
      const form = await screen.findByRole('form', {
        name: catalogue['services.create.title'] as string,
      });
      const code = within(form).getByLabelText(labelled('services.create.code', catalogue));
      await user.type(code, 'bad code!');
      await user.click(
        within(form).getByRole('button', { name: catalogue['services.create.submit'] as string })
      );
      // The first thing to fix is the category, and the cursor lands in its tree.
      const tree = within(form).getByRole('tree', {
        name: labelled('services.create.category', catalogue),
      });
      await waitFor(() => expect(tree, locale).toHaveAttribute('aria-invalid', 'true'));
      await waitFor(() => expect(tree.contains(document.activeElement), locale).toBe(true));
      expect(code, locale).toHaveAttribute('aria-invalid', 'true');
      expect(code, locale).toHaveAccessibleDescription(
        new RegExp(escape(catalogue['services.create.codeFormat'] as string))
      );
      expect(code, locale).toHaveValue('bad code!');
      expect(createService, locale).not.toHaveBeenCalled();
      // Correcting the code withdraws its complaint; the category's stands.
      await user.clear(code);
      await user.type(code, 'GOOD-CODE');
      expect(code, locale).not.toHaveAttribute('aria-invalid');
      expect(tree, locale).toHaveAttribute('aria-invalid', 'true');
      view.unmount();
    }
  });

  it('with no category yet, says a category must come first and holds the service form', async () => {
    const user = userEvent.setup();
    listServiceCategories.mockResolvedValue(
      okRead({ items: [], nextCursor: null, hasMore: false })
    );
    renderCatalogue({ canManage: true });
    await waitFor(() => expect(listServiceCategories).toHaveBeenCalled());
    await user.click(createToggle());
    const form = await createForm();
    expect(
      await within(form).findByText(EN['services.create.needsCategory'] as string)
    ).toBeVisible();
    expect(
      within(form).getByRole('button', { name: EN['services.create.submit'] as string })
    ).toBeDisabled();
  });

  it('creates a category filed under a parent, and offers it at once in the tree', async () => {
    const user = userEvent.setup();
    createServiceCategory.mockResolvedValue({
      state: { status: 'success', messageKey: 'services.category.success', attempt: 1 },
      created: {
        id: 'c-new',
        code: 'brakes',
        name: 'Brakes',
        parentCategoryId: CATEGORY,
        status: 'active',
      },
    });
    renderCatalogue({ canManage: true });
    await waitFor(() => expect(listServiceCategories).toHaveBeenCalled());
    await user.click(createToggle());
    const categoryForm = await screen.findByRole('form', {
      name: EN['services.category.new'] as string,
    });
    await user.type(
      within(categoryForm).getByLabelText(labelled('services.category.code')),
      'brakes'
    );
    await user.type(
      within(categoryForm).getByLabelText(labelled('services.category.name')),
      'Brakes'
    );
    const parentTree = within(categoryForm).getByRole('tree', {
      name: labelled('services.category.parent'),
    });
    await user.click(await within(parentTree).findByText('Engine'));
    await user.click(
      within(categoryForm).getByRole('button', { name: EN['services.category.submit'] as string })
    );
    await waitFor(() =>
      expect(createServiceCategory).toHaveBeenCalledWith({
        code: 'brakes',
        name: 'Brakes',
        parentCategoryId: CATEGORY,
      })
    );
    // Offered at once, filed under its parent in the service form's tree.
    const form = await createForm();
    const tree = within(form).getByRole('tree', { name: labelled('services.create.category') });
    const parent = within(tree).getByRole('treeitem', { name: /^Engine$/ });
    parent.focus();
    await user.keyboard('{ArrowRight}');
    expect(await within(parent).findByRole('treeitem', { name: 'Brakes' })).toBeInTheDocument();
  });

  it('a category form with nothing chosen for a parent sends no parent', async () => {
    const user = userEvent.setup();
    createServiceCategory.mockResolvedValue({
      state: { status: 'success', messageKey: 'services.category.success', attempt: 1 },
      created: { id: 'c-top', code: 'body', name: 'Body', parentCategoryId: null },
    });
    renderCatalogue({ canManage: true });
    await waitFor(() => expect(listServiceCategories).toHaveBeenCalled());
    await user.click(createToggle());
    const categoryForm = await screen.findByRole('form', {
      name: EN['services.category.new'] as string,
    });
    await user.type(
      within(categoryForm).getByLabelText(labelled('services.category.code')),
      'body'
    );
    await user.type(
      within(categoryForm).getByLabelText(labelled('services.category.name')),
      'Body'
    );
    await user.click(
      within(categoryForm).getByRole('button', { name: EN['services.category.submit'] as string })
    );
    await waitFor(() =>
      expect(createServiceCategory).toHaveBeenCalledWith({ code: 'body', name: 'Body' })
    );
  });
});

describe('typed and not created is unsaved work', () => {
  afterEach(forgetRememberedBranch);

  function renderWithSwitch() {
    return renderLtr(
      withMui(
        inBranch(
          <>
            <BranchSwitch to={OTHER_BRANCH.id} label="second" />
            <ServiceCatalogueScreen locale="en" messages={en} canManage canReadBranches={false} />
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
        )
      )
    );
  }

  it('an untouched create form lets the branch change without asking', async () => {
    const user = userEvent.setup();
    renderWithSwitch();
    await user.click(createToggle());
    await createForm();
    await switchWithoutQuestion(user, 'second');
  });

  it('a typed service asks first; staying keeps it, discarding empties it', async () => {
    const user = userEvent.setup();
    renderWithSwitch();
    await user.click(createToggle());
    const form = await createForm();
    const name = within(form).getByLabelText(labelled('services.create.name'));
    await user.type(name, 'Brake pads');

    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(name).toHaveValue('Brake pads');

    await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
    await waitFor(() => expect(name).toHaveValue(''));
  });

  it('a typed category asks first; staying keeps it, discarding empties it', async () => {
    const user = userEvent.setup();
    renderWithSwitch();
    await user.click(createToggle());
    const categoryForm = await screen.findByRole('form', {
      name: EN['services.category.new'] as string,
    });
    const code = within(categoryForm).getByLabelText(labelled('services.category.code'));
    const name = within(categoryForm).getByLabelText(labelled('services.category.name'));
    await user.type(code, 'brakes');
    await user.type(name, 'Brakes');

    await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
    expect(code).toHaveValue('brakes');
    expect(name).toHaveValue('Brakes');

    await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
    await waitFor(() => expect(code).toHaveValue(''));
    expect(name).toHaveValue('');
    expect(createServiceCategory).not.toHaveBeenCalled();
  });
});

describe('Arabic, right to left', () => {
  it('renders the catalogue in Arabic with the same behaviour', async () => {
    renderRtl(
      withMui(
        <ServiceCatalogueScreen
          locale="ar"
          messages={ar}
          canManage={false}
          canReadBranches={false}
        />,
        'ar'
      )
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(
      screen.getByRole('searchbox', { name: AR['services.catalogue.search'] as string })
    ).toBeVisible();
    const table = await screen.findByRole('grid', {
      name: AR['services.catalogue.caption'] as string,
    });
    expect(await within(table).findByText('OIL-CHANGE')).toBeVisible();
    expect(within(table).getByText(AR['services.lifecycle.active'] as string)).toBeVisible();
    expect(
      screen.getByRole('tree', { name: labelled('services.catalogue.category', AR) })
    ).toBeVisible();
  });
});

describe('the /services route page decides before it reads', () => {
  it('refuses an operator without svc.service.read, and issues no read', async () => {
    PERMISSIONS = [];
    await renderPage(ServiceCataloguePage, { locale: 'en' });
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listServices).not.toHaveBeenCalled();
  });

  it('renders the catalogue with svc.service.read, and withholds creation without manage', async () => {
    PERMISSIONS = ['svc.service.read'];
    await renderPage(ServiceCataloguePage, { locale: 'en' });
    expect(await screen.findByText('OIL-CHANGE')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: EN['services.catalogue.create'] as string })
    ).toBeNull();
  });

  it('offers creation to a manager', async () => {
    PERMISSIONS = ['svc.service.read', 'svc.service.manage'];
    await renderPage(ServiceCataloguePage, { locale: 'en' });
    expect(
      screen.getByRole('button', { name: EN['services.catalogue.create'] as string })
    ).toBeVisible();
  });

  it('a locale it does not serve is not found', async () => {
    PERMISSIONS = ['svc.service.read'];
    await expect(renderPage(ServiceCataloguePage, { locale: 'xx' })).rejects.toThrow('notFound');
  });
});
