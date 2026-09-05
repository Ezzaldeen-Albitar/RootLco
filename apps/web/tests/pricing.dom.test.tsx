import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * Price lists and the price lookup, rendered (P1-30, `W2`, FE-002 and FE-006).
 *
 * The properties under test are the ones a pricing screen gets wrong: turning
 * a refusal into "no price lists", claiming a bounded list is complete,
 * offering a branch list to an operator who may not read one, and — above all
 * — rendering a figure the server did not send. The lookup renders
 * `unitPrice`, `taxRate` and `taxClassCode` exactly as returned; a refusal of
 * the lookup renders as a refusal, never as zero.
 *
 * Labels are matched ANCHORED (the field frame decorates them) and scoped.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listPriceLists = vi.fn();
const createPriceList = vi.fn();
const resolvePrice = vi.fn();
const listBranches = vi.fn();
vi.mock('@/features/pricing/api', () => ({
  listPriceLists: () => listPriceLists(),
  createPriceList: (...args: unknown[]) => createPriceList(...args),
  resolvePrice: (...args: unknown[]) => resolvePrice(...args),
  listBranches: () => listBranches(),
  readPriceList: vi.fn(),
  listPriceRules: vi.fn(),
  createPriceListVersion: vi.fn(),
  publishPriceListVersion: vi.fn(),
  recordPriceRule: vi.fn(),
  createPriceListAssignment: vi.fn(),
}));

const listServices = vi.fn();
vi.mock('@/features/services/api', () => ({
  listServices: (...args: unknown[]) => listServices(...args),
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

const { PricingScreen } = await import('@/features/pricing/components/PricingScreen');
const PricingPage = (await import('@/app/[locale]/(dashboard)/pricing/page'))
  .default as unknown as RoutePage;

const LIST_ID = '33333333-3333-4333-8333-333333333333';
const SERVICE_ID = '55555555-5555-4555-8555-555555555555';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const COMPANY = '11111111-1111-4111-8111-111111111111';

function row(over: Record<string, unknown> = {}) {
  return {
    id: LIST_ID,
    priceListCode: 'RETAIL',
    name: 'Retail',
    currency: 'JOD',
    description: null,
    status: 'active',
    recordVersion: 1,
    ...over,
  };
}

function page(rows: readonly unknown[]) {
  return { status: 'ok' as const, rows, nextCursor: null, hasMore: false, correlationId: 'corr' };
}

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const deniedRead = { status: 'denied' as const, correlationId: 'corr' };

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <PricingScreen
      locale="en"
      messages={en}
      canManage={false}
      canReadBranches={false}
      canReadServices={false}
      {...over}
    />
  );
}

const lookupForm = () => screen.getByRole('form', { name: EN['pricing.lookup.heading'] as string });

beforeEach(() => {
  vi.clearAllMocks();
  listPriceLists.mockResolvedValue(page([row()]));
  listBranches.mockResolvedValue(
    okRead({ items: [{ id: BRANCH, companyId: COMPANY, branchCode: 'B1', name: 'Main' }] })
  );
  listServices.mockResolvedValue(
    page([
      {
        id: SERVICE_ID,
        serviceCode: 'OIL-CHANGE',
        name: 'Oil change',
        description: null,
        categoryId: 'c',
        lifecycleStatus: 'active',
        recordVersion: 1,
      },
    ])
  );
});

describe('the lists read on first paint and render as returned', () => {
  it('issues the read without waiting for a filter and shows the row', async () => {
    renderScreen();
    await waitFor(() => expect(listPriceLists).toHaveBeenCalled());
    const table = await screen.findByRole('table');
    expect(within(table).getByText('RETAIL')).toBeVisible();
    expect(within(table).getByText('JOD')).toBeVisible();
    expect(within(table).getByText(EN['pricing.status.active'] as string)).toBeVisible();
  });

  it('marks an inactive list as inactive, beside an active one', async () => {
    listPriceLists.mockResolvedValue(
      page([row(), row({ id: 'l-2', priceListCode: 'OLD', status: 'inactive' })])
    );
    renderScreen();
    const table = await screen.findByRole('table');
    expect(await within(table).findByText('OLD')).toBeVisible();
    expect(within(table).getByText(EN['pricing.status.inactive'] as string)).toBeVisible();
  });

  it('renders the denied state instead of an empty list', async () => {
    listPriceLists.mockResolvedValue({ ...deniedRead, rows: [], nextCursor: null, hasMore: false });
    renderScreen();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['pricing.list.none'] as string)).toBeNull();
  });

  it('says there are none when the server answers none', async () => {
    listPriceLists.mockResolvedValue(page([]));
    renderScreen();
    expect(await screen.findByText(EN['pricing.list.none'] as string)).toBeVisible();
  });

  it('states the bound when the server answered exactly the bound', async () => {
    listPriceLists.mockResolvedValue(
      page(Array.from({ length: 100 }, (_, i) => row({ id: `l-${i}`, priceListCode: `L${i}` })))
    );
    renderScreen();
    expect(await screen.findByText(EN['pricing.list.bound'] as string)).toBeVisible();
  });
});

describe('creating, offered only to those who may', () => {
  it('does not offer the create form without svc.price.manage', () => {
    renderScreen({ canManage: false });
    expect(screen.queryByRole('button', { name: EN['pricing.list.create'] as string })).toBeNull();
  });

  it('creates a list and moves to it', async () => {
    const user = userEvent.setup();
    createPriceList.mockResolvedValue({
      state: { status: 'success', messageKey: 'pricing.create.success', attempt: 1 },
      created: row({ id: 'new-id' }),
    });
    renderScreen({ canManage: true });
    await user.click(screen.getByRole('button', { name: EN['pricing.list.create'] as string }));
    const form = await screen.findByRole('form', { name: EN['pricing.create.title'] as string });
    await user.type(within(form).getByLabelText(labelled('pricing.create.code')), 'RETAIL-2');
    await user.type(within(form).getByLabelText(labelled('pricing.create.name')), 'Retail two');
    await user.type(within(form).getByLabelText(labelled('pricing.create.currency')), 'JOD');
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.create.submit'] as string })
    );
    await waitFor(() => expect(createPriceList).toHaveBeenCalled());
    expect(createPriceList.mock.calls[0]?.[0]).toEqual({
      priceListCode: 'RETAIL-2',
      name: 'Retail two',
      currency: 'JOD',
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/pricing/new-id'));
  });

  it('refuses a malformed currency before any request', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    await user.click(screen.getByRole('button', { name: EN['pricing.list.create'] as string }));
    const form = await screen.findByRole('form', { name: EN['pricing.create.title'] as string });
    await user.type(within(form).getByLabelText(labelled('pricing.create.code')), 'RETAIL-2');
    await user.type(within(form).getByLabelText(labelled('pricing.create.name')), 'Retail two');
    await user.type(within(form).getByLabelText(labelled('pricing.create.currency')), 'jod');
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.create.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['pricing.create.currencyFormat'] as string)
    ).toBeVisible();
    expect(createPriceList).not.toHaveBeenCalled();
  });
});

describe('the lookup renders the server’s figures, never its own', () => {
  const resolved = {
    asOf: '2026-09-05',
    priceRuleId: 'rule-1',
    unitPrice: '77.5000',
    currency: 'JOD',
    taxClassId: 'tc-1',
    taxRate: '0.160000',
    taxClassCode: 'standard',
  };

  it('with both lists, finds a service by code, picks a branch, and sends the target pair', async () => {
    const user = userEvent.setup();
    resolvePrice.mockResolvedValue(okRead(resolved));
    renderScreen({ canReadBranches: true, canReadServices: true });
    await waitFor(() => expect(listBranches).toHaveBeenCalled());
    const form = lookupForm();

    await user.type(within(form).getByLabelText(labelled('pricing.picker.serviceSearch')), 'OIL');
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.picker.search'] as string })
    );
    await waitFor(() => expect(listServices).toHaveBeenCalled());
    expect(listServices.mock.calls[0]?.[0]).toEqual({ search: 'OIL' });
    const service = await within(form).findByLabelText(labelled('pricing.lookup.service'));
    await user.selectOptions(service, SERVICE_ID);
    await user.selectOptions(
      within(form).getByLabelText(labelled('pricing.lookup.branch')),
      BRANCH
    );
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.lookup.submit'] as string })
    );

    await waitFor(() => expect(resolvePrice).toHaveBeenCalled());
    expect(resolvePrice.mock.calls[0]?.[0]).toEqual({
      serviceId: SERVICE_ID,
      companyId: COMPANY,
      branchId: BRANCH,
    });

    const result = await screen.findByRole('region', {
      name: EN['pricing.lookup.resultHeading'] as string,
    });
    // The rate is the server's fraction string, verbatim — not a percentage.
    expect(within(result).getByText('0.160000')).toBeVisible();
    expect(within(result).queryByText(/16 ?%/)).toBeNull();
    expect(within(result).getByText('standard')).toBeVisible();
    expect(within(result).getByText('2026-09-05')).toBeVisible();
    expect(within(result).getByText('rule-1')).toBeVisible();
    // The price is rendered with its ISO code; no figure other than the server's appears.
    expect(within(result).getByText(/77\.5/)).toBeVisible();
    expect(within(result).getByText(/JOD/)).toBeVisible();
  });

  it('without either list, takes identifiers and never asks for the lists', async () => {
    const user = userEvent.setup();
    resolvePrice.mockResolvedValue(okRead(resolved));
    renderScreen({ canReadBranches: false, canReadServices: false });
    const form = lookupForm();
    expect(listBranches).not.toHaveBeenCalled();
    await user.type(
      within(form).getByLabelText(labelled('pricing.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('pricing.common.companyIdField')),
      COMPANY
    );
    await user.type(within(form).getByLabelText(labelled('pricing.common.branchIdField')), BRANCH);
    await user.type(within(form).getByLabelText(labelled('pricing.lookup.customerClass')), 'fleet');
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.lookup.submit'] as string })
    );
    await waitFor(() => expect(resolvePrice).toHaveBeenCalled());
    expect(resolvePrice.mock.calls[0]?.[0]).toEqual({
      serviceId: SERVICE_ID,
      companyId: COMPANY,
      branchId: BRANCH,
      customerClass: 'fleet',
    });
    expect(listServices).not.toHaveBeenCalled();
  });

  it('refuses a malformed identifier before any request', async () => {
    const user = userEvent.setup();
    renderScreen();
    const form = lookupForm();
    await user.type(
      within(form).getByLabelText(labelled('pricing.picker.serviceIdField')),
      'not-a-service'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.lookup.submit'] as string })
    );
    expect(
      (await within(form).findAllByText(EN['pricing.common.idFormat'] as string)).length
    ).toBeGreaterThan(0);
    expect(resolvePrice).not.toHaveBeenCalled();
  });

  it('renders a lookup that resolved nothing as a refusal, with the reference, and no zero', async () => {
    const user = userEvent.setup();
    resolvePrice.mockResolvedValue({ status: 'error', correlationId: 'corr-7' });
    renderScreen();
    const form = lookupForm();
    await user.type(
      within(form).getByLabelText(labelled('pricing.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('pricing.common.companyIdField')),
      COMPANY
    );
    await user.type(within(form).getByLabelText(labelled('pricing.common.branchIdField')), BRANCH);
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.lookup.submit'] as string })
    );
    expect(await screen.findByText(EN['pricing.lookup.failed'] as string)).toBeVisible();
    expect(screen.getByText('corr-7')).toBeVisible();
    expect(screen.queryByText(/0\.0000/)).toBeNull();
  });

  it('renders a refused lookup as refused', async () => {
    const user = userEvent.setup();
    resolvePrice.mockResolvedValue(deniedRead);
    renderScreen();
    const form = lookupForm();
    await user.type(
      within(form).getByLabelText(labelled('pricing.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('pricing.common.companyIdField')),
      COMPANY
    );
    await user.type(within(form).getByLabelText(labelled('pricing.common.branchIdField')), BRANCH);
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.lookup.submit'] as string })
    );
    expect(await screen.findByText(EN['pricing.lookup.refused'] as string)).toBeVisible();
  });
});

describe('Arabic, right to left', () => {
  it('renders the lists in Arabic with the same behaviour', async () => {
    renderRtl(
      <PricingScreen
        locale="ar"
        messages={ar}
        canManage={false}
        canReadBranches={false}
        canReadServices={false}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('RETAIL')).toBeVisible();
    expect(within(table).getByText(AR['pricing.status.active'] as string)).toBeVisible();
    expect(
      screen.getByRole('button', { name: AR['pricing.lookup.submit'] as string })
    ).toBeVisible();
  });
});

describe('the /pricing route page decides before it reads', () => {
  it('refuses an operator without svc.price.read, and issues no read', async () => {
    PERMISSIONS = [];
    await renderPage(PricingPage, { locale: 'en' });
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listPriceLists).not.toHaveBeenCalled();
  });

  it('renders the screen with svc.price.read, and withholds creation without manage', async () => {
    PERMISSIONS = ['svc.price.read'];
    await renderPage(PricingPage, { locale: 'en' });
    expect(await screen.findByRole('table')).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['pricing.list.create'] as string })).toBeNull();
  });

  it('offers creation to a manager', async () => {
    PERMISSIONS = ['svc.price.read', 'svc.price.manage'];
    await renderPage(PricingPage, { locale: 'en' });
    expect(screen.getByRole('button', { name: EN['pricing.list.create'] as string })).toBeVisible();
  });

  it('a locale it does not serve is not found', async () => {
    PERMISSIONS = ['svc.price.read'];
    await expect(renderPage(PricingPage, { locale: 'xx' })).rejects.toThrow('notFound');
  });
});
