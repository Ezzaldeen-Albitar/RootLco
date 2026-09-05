import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import { SERVICE_LIFECYCLE_STATES } from '@/features/services/services-contract';

/**
 * The service catalogue, rendered (P1-30, `W1`, FE-001).
 *
 * The properties under test are the ones a catalogue gets wrong: hiding a
 * retired service, turning a refusal into "no services", inventing a category
 * name for an id it cannot resolve, and offering a branch list to an operator
 * who may not read one.
 *
 * Labels are matched ANCHORED and scoped. The field frame decorates a label
 * (a required marker, an optional hint), so an exact match misses; a bare
 * substring over-matches, because the lifecycle filter offers the same two
 * words the badges show and both forms label a field "Category". So a label is
 * matched from its start, and the table and the create form are addressed by
 * their own accessible names.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A label matcher anchored at the start of the label text. */
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

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
  return renderLtr(tree as React.ReactElement);
}

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { ServiceCatalogueScreen } =
  await import('@/features/services/components/ServiceCatalogueScreen');
const ServiceCataloguePage = (await import('@/app/[locale]/(dashboard)/services/page'))
  .default as unknown as RoutePage;

const CATEGORY = '55555555-5555-4555-8555-555555555555';
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

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const deniedRead = { status: 'denied' as const, correlationId: 'corr' };

function renderCatalogue(over: Record<string, unknown> = {}) {
  return renderLtr(
    <ServiceCatalogueScreen
      locale="en"
      messages={en}
      canManage={false}
      canReadBranches={false}
      {...over}
    />
  );
}

const showButton = () =>
  screen.getByRole('button', { name: EN['services.catalogue.show'] as string });
const createForm = () => screen.findByRole('form', { name: EN['services.create.title'] as string });

beforeEach(() => {
  vi.clearAllMocks();
  listServices.mockResolvedValue(page([row()]));
  listServiceCategories.mockResolvedValue(
    okRead({
      items: [{ id: CATEGORY, code: 'engine', name: 'Engine', status: 'active' }],
      nextCursor: null,
      hasMore: false,
    })
  );
  listBranches.mockResolvedValue(
    okRead({ items: [{ id: BRANCH, companyId: COMPANY, branchCode: 'B1', name: 'Main' }] })
  );
});

describe('the catalogue is tenant-wide, so it reads on first paint', () => {
  it('issues the read without waiting for a filter', async () => {
    renderCatalogue();
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    expect(listServices.mock.calls[0]?.[0]).toEqual({});
    expect(await screen.findByText('OIL-CHANGE')).toBeVisible();
  });

  it('sends the filters under the names the route accepts, and only once chosen', async () => {
    const user = userEvent.setup();
    renderCatalogue();
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    listServices.mockClear();

    await user.type(screen.getByLabelText(labelled('services.catalogue.search')), 'OIL');
    await user.selectOptions(
      screen.getByLabelText(labelled('services.catalogue.lifecycle')),
      'archived'
    );
    await user.click(showButton());
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    expect(listServices.mock.calls[0]?.[0]).toEqual({ search: 'OIL', lifecycleStatus: 'archived' });
  });

  it('offers exactly the lifecycle vocabulary the contract mirrors', () => {
    renderCatalogue();
    const select = screen.getByLabelText(labelled('services.catalogue.lifecycle'));
    const values = within(select)
      .getAllByRole('option')
      .map((option) => (option as HTMLOptionElement).value)
      .filter((value) => value !== '');
    expect(values).toEqual([...SERVICE_LIFECYCLE_STATES]);
  });
});

describe('retired and unavailable services render as such', () => {
  it('shows a retired service, marked retired, beside an active one', async () => {
    listServices.mockResolvedValue(
      page([row(), row({ id: 'r-1', serviceCode: 'OLD-SVC', lifecycleStatus: 'archived' })])
    );
    renderCatalogue();
    expect(await screen.findByText('OLD-SVC')).toBeVisible();
    // Among the ROWS: the lifecycle filter offers the same two words as options.
    const table = screen.getByRole('table');
    expect(within(table).getByText(EN['services.lifecycle.archived'] as string)).toBeVisible();
    expect(within(table).getByText(EN['services.lifecycle.active'] as string)).toBeVisible();
  });

  it('renders the category NAME when the taxonomy has it', async () => {
    renderCatalogue();
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('Engine')).toBeVisible();
  });

  it('renders the identifier and says so when the category is not in the loaded list', async () => {
    listServices.mockResolvedValue(page([row({ categoryId: 'unknown-category-id' })]));
    renderCatalogue();
    expect(await screen.findByText('unknown-category-id')).toBeVisible();
    expect(screen.getByText(EN['services.catalogue.unknownCategory'] as string)).toBeVisible();
  });
});

describe('a refusal is a refusal', () => {
  it('renders the denied state instead of an empty catalogue', async () => {
    listServices.mockResolvedValue({ ...deniedRead, rows: [], nextCursor: null, hasMore: false });
    renderCatalogue();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['services.catalogue.noneMatching'] as string)).toBeNull();
  });

  it('says the taxonomy was refused rather than pretending it is empty', async () => {
    listServiceCategories.mockResolvedValue(deniedRead);
    renderCatalogue();
    expect(
      await screen.findByText(EN['services.catalogue.categoriesRefused'] as string)
    ).toBeVisible();
  });
});

describe('the branch filter follows the operator’s access', () => {
  it('without org.branch.read, offers an identifier field and never asks for the list', () => {
    renderCatalogue({ canReadBranches: false });
    expect(screen.getByLabelText(labelled('services.catalogue.branchIdField'))).toBeVisible();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('with org.branch.read, offers the branch list by code and name', async () => {
    const user = userEvent.setup();
    renderCatalogue({ canReadBranches: true });
    await waitFor(() => expect(listBranches).toHaveBeenCalled());
    const select = await screen.findByLabelText(labelled('services.catalogue.availableAtBranch'));
    expect(within(select).getByRole('option', { name: 'B1 — Main' })).toBeInTheDocument();
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    listServices.mockClear();
    await user.selectOptions(select, BRANCH);
    await user.click(showButton());
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    // A resource selector, sent under the route's own name.
    expect(listServices.mock.calls[0]?.[0]).toEqual({ availableAtBranchId: BRANCH });
  });

  it('refuses an identifier that is not one, and reads nothing', async () => {
    const user = userEvent.setup();
    renderCatalogue({ canReadBranches: false });
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    listServices.mockClear();
    await user.type(
      screen.getByLabelText(labelled('services.catalogue.branchIdField')),
      'not-a-branch'
    );
    await user.click(showButton());
    expect(
      await screen.findByText(EN['services.catalogue.branchIdFormat'] as string)
    ).toBeVisible();
    expect(listServices).not.toHaveBeenCalled();
  });
});

describe('creating, offered only to those who may', () => {
  it('does not offer the create forms without svc.service.manage', () => {
    renderCatalogue({ canManage: false });
    expect(
      screen.queryByRole('button', { name: EN['services.catalogue.create'] as string })
    ).toBeNull();
  });

  it('creates a service and moves to it', async () => {
    const user = userEvent.setup();
    createService.mockResolvedValue({
      state: { status: 'success', messageKey: 'services.create.success', attempt: 1 },
      created: row({ id: 'new-id' }),
    });
    renderCatalogue({ canManage: true });
    await waitFor(() => expect(listServiceCategories).toHaveBeenCalled());
    await user.click(
      screen.getByRole('button', { name: EN['services.catalogue.create'] as string })
    );

    const form = await createForm();
    await user.selectOptions(
      within(form).getByLabelText(labelled('services.create.category')),
      CATEGORY
    );
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

  it('refuses a malformed service code before any request', async () => {
    const user = userEvent.setup();
    renderCatalogue({ canManage: true });
    await waitFor(() => expect(listServiceCategories).toHaveBeenCalled());
    await user.click(
      screen.getByRole('button', { name: EN['services.catalogue.create'] as string })
    );
    const form = await createForm();
    await user.selectOptions(
      within(form).getByLabelText(labelled('services.create.category')),
      CATEGORY
    );
    await user.type(within(form).getByLabelText(labelled('services.create.code')), 'bad code!');
    await user.type(within(form).getByLabelText(labelled('services.create.name')), 'x');
    await user.click(
      within(form).getByRole('button', { name: EN['services.create.submit'] as string })
    );
    expect(await within(form).findByText(EN['services.create.codeFormat'] as string)).toBeVisible();
    expect(createService).not.toHaveBeenCalled();
  });

  it('with no category yet, says a category must come first and holds the service form', async () => {
    const user = userEvent.setup();
    listServiceCategories.mockResolvedValue(
      okRead({ items: [], nextCursor: null, hasMore: false })
    );
    renderCatalogue({ canManage: true });
    await waitFor(() => expect(listServiceCategories).toHaveBeenCalled());
    await user.click(
      screen.getByRole('button', { name: EN['services.catalogue.create'] as string })
    );
    const form = await createForm();
    expect(
      await within(form).findByText(EN['services.create.needsCategory'] as string)
    ).toBeVisible();
    expect(
      within(form).getByRole('button', { name: EN['services.create.submit'] as string })
    ).toBeDisabled();
  });

  it('creates a category and offers it at once', async () => {
    const user = userEvent.setup();
    listServiceCategories.mockResolvedValue(
      okRead({ items: [], nextCursor: null, hasMore: false })
    );
    createServiceCategory.mockResolvedValue({
      state: { status: 'success', messageKey: 'services.category.success', attempt: 1 },
      created: { id: 'c-new', code: 'brakes', name: 'Brakes', status: 'active' },
    });
    renderCatalogue({ canManage: true });
    await waitFor(() => expect(listServiceCategories).toHaveBeenCalled());
    await user.click(
      screen.getByRole('button', { name: EN['services.catalogue.create'] as string })
    );
    await user.type(await screen.findByLabelText(labelled('services.category.code')), 'brakes');
    await user.type(screen.getByLabelText(labelled('services.category.name')), 'Brakes');
    await user.click(
      screen.getByRole('button', { name: EN['services.category.submit'] as string })
    );
    await waitFor(() =>
      expect(createServiceCategory).toHaveBeenCalledWith({ code: 'brakes', name: 'Brakes' })
    );
    const form = await createForm();
    const picker = within(form).getByLabelText(labelled('services.create.category'));
    expect(within(picker).getByRole('option', { name: 'brakes — Brakes' })).toBeInTheDocument();
    expect(
      within(form).getByRole('button', { name: EN['services.create.submit'] as string })
    ).toBeEnabled();
  });
});

describe('Arabic, right to left', () => {
  it('renders the catalogue in Arabic with the same behaviour', async () => {
    renderRtl(
      <ServiceCatalogueScreen locale="ar" messages={ar} canManage={false} canReadBranches={false} />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(
      screen.getByRole('button', { name: AR['services.catalogue.show'] as string })
    ).toBeVisible();
    expect(await screen.findByText('OIL-CHANGE')).toBeVisible();
    expect(
      within(screen.getByRole('table')).getByText(AR['services.lifecycle.active'] as string)
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
