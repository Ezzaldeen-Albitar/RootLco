import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
import { forgetRememberedBranch } from './support/branch-switch';

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
      canReadServices={true}
      {...over}
    />
  );
}

/** The screen inside a working context holding one branch — the `BRANCH` pair. */
function renderInBranch(over: Record<string, unknown> = {}) {
  return renderLtr(
    inBranch(
      <PricingScreen
        locale="en"
        messages={en}
        canManage={false}
        canReadBranches={false}
        canReadServices={true}
        {...over}
      />
    )
  );
}

const lookupForm = () => screen.getByRole('form', { name: EN['pricing.lookup.heading'] as string });

/**
 * The service, FOUND in the catalogue and chosen by code and name — the only
 * way to name one now. Without `svc.service.read` there is no box to type a
 * reference into (Owner directive, `P1-32-PRE-OD-UX`).
 */
async function pickService(user: ReturnType<typeof userEvent.setup>, form: HTMLElement) {
  const search = within(form).getByLabelText(labelled('pricing.picker.serviceSearch'));
  await user.clear(search);
  await user.type(search, 'OIL');
  await user.click(
    within(form).getByRole('button', { name: EN['pricing.picker.search'] as string })
  );
  const service = await within(form).findByRole('option', { name: /OIL-CHANGE/ });
  await user.selectOptions(service.closest('select') as HTMLSelectElement, SERVICE_ID);
}

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

  it('shows an unsupported currency beside the currency box, with the code still typed', async () => {
    createPriceList.mockResolvedValue({
      state: {
        status: 'invalid',
        messageKey: 'form.formError',
        fieldErrors: { currency: 'form.violation.unsupported_currency' },
        attempt: 1,
      },
      created: null,
    });
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    await user.click(screen.getByRole('button', { name: EN['pricing.list.create'] as string }));
    const form = await screen.findByRole('form', { name: EN['pricing.create.title'] as string });
    await user.type(within(form).getByLabelText(labelled('pricing.create.code')), 'RETAIL-2');
    await user.type(within(form).getByLabelText(labelled('pricing.create.name')), 'Retail two');
    await user.type(within(form).getByLabelText(labelled('pricing.create.currency')), 'JOD');
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.create.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['form.violation.unsupported_currency'] as string)
    ).toBeVisible();
    expect(within(form).getByLabelText(labelled('pricing.create.name'))).toHaveValue('Retail two');
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

  it('without either list, resolves for the working branch and never asks the directory', async () => {
    const user = userEvent.setup();
    resolvePrice.mockResolvedValue(okRead(resolved));
    renderInBranch({ canReadBranches: false, canReadServices: true });
    const form = lookupForm();
    expect(listBranches).not.toHaveBeenCalled();
    // The branch is the one the header holds, already chosen, and named.
    expect(within(form).getByLabelText(labelled('pricing.lookup.branch'))).toHaveValue(BRANCH);
    expect(within(form).queryByLabelText(RETIRED_BOX.en.company)).toBeNull();
    await pickService(user, form);
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
  });

  it('refuses a lookup with no service chosen, beside the service control, before any request', async () => {
    const user = userEvent.setup();
    renderInBranch();
    const form = lookupForm();
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.lookup.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['pricing.picker.serviceRequired'] as string)
    ).toBeVisible();
    expect(within(form).getByLabelText(labelled('pricing.lookup.service'))).toHaveAttribute(
      'aria-invalid',
      'true'
    );
    expect(resolvePrice).not.toHaveBeenCalled();
  });

  it('with the service catalogue, offers the search and no reference box', () => {
    renderInBranch({ canReadServices: true });
    const form = lookupForm();
    expect(within(form).getByLabelText(labelled('pricing.picker.serviceSearch'))).toBeVisible();
    expect(within(form).queryByLabelText(labelled('pricing.picker.serviceReference'))).toBeNull();
  });

  it('without the service catalogue, STILL looks a price up through the labelled service reference', async () => {
    // `svc.price-resolve` declares `svc.price.read` only, so a caller without
    // `svc.service.read` keeps the lookup the server answers for them.
    const user = userEvent.setup();
    resolvePrice.mockResolvedValue(okRead(resolved));
    renderInBranch({ canReadServices: false });
    const form = lookupForm();
    expect(
      within(form).getByText(EN['pricing.picker.servicesNotReadable'] as string)
    ).toBeVisible();
    const submit = within(form).getByRole('button', {
      name: EN['pricing.lookup.submit'] as string,
    });
    expect(submit).toBeEnabled();
    const box = within(form).getByLabelText(labelled('pricing.picker.serviceReference'));

    await user.type(box, 'OIL-CHANGE');
    await user.click(submit);
    expect(
      await within(form).findByText(EN['pricing.picker.serviceReferenceFormat'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(resolvePrice).not.toHaveBeenCalled();

    // Eight-four-four-four-twelve hex with no RFC version digit or variant: the
    // server's `z.string().uuid()` refuses it, so the box refuses it first.
    await user.clear(box);
    await user.type(box, '12345678-1234-0234-7234-123456789abc');
    await user.click(submit);
    expect(
      await within(form).findByText(EN['pricing.picker.serviceReferenceFormat'] as string)
    ).toBeVisible();
    expect(box).toHaveAttribute('aria-invalid', 'true');
    expect(resolvePrice).not.toHaveBeenCalled();

    await user.clear(box);
    await user.type(box, SERVICE_ID);
    await user.click(submit);
    await waitFor(() => expect(resolvePrice).toHaveBeenCalledTimes(1));
    expect(resolvePrice.mock.calls[0]?.[0]).toEqual({
      serviceId: SERVICE_ID,
      companyId: COMPANY,
      branchId: BRANCH,
    });
    expect(listServices).not.toHaveBeenCalled();
  });

  it('renders a lookup that resolved nothing as a refusal, with the reference, and no zero', async () => {
    const user = userEvent.setup();
    resolvePrice.mockResolvedValue({ status: 'error', correlationId: 'corr-7' });
    renderInBranch();
    const form = lookupForm();
    await pickService(user, form);
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
    renderInBranch();
    const form = lookupForm();
    await pickService(user, form);
    await user.click(
      within(form).getByRole('button', { name: EN['pricing.lookup.submit'] as string })
    );
    expect(await screen.findByText(EN['pricing.lookup.refused'] as string)).toBeVisible();
  });
});

describe('the lookup follows the header, not just its first value', () => {
  /*
   * The lookup's branch used to be copied from the working context once, on
   * mount. After a switch the header named one workshop and the form priced for
   * another. It now follows every change, drops the answer about the previous
   * branch, and a lookup still in flight cannot land under the new heading.
   */
  afterEach(forgetRememberedBranch);

  const priced = okRead({
    asOf: '2026-09-05',
    priceRuleId: 'rule-1',
    unitPrice: '77.5000',
    currency: 'JOD',
    taxClassId: 'tc-1',
    taxRate: '0.160000',
    taxClassCode: 'standard',
  });

  function renderTwo() {
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <BranchSwitch to="all" label="everywhere" />
          <PricingScreen
            locale="en"
            messages={en}
            canManage={false}
            canReadBranches={false}
            canReadServices={true}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
  }
  const branchControl = () =>
    within(lookupForm()).getByLabelText(labelled('pricing.lookup.branch'));
  async function lookUp(user: ReturnType<typeof userEvent.setup>) {
    // The service is not the branch's, so it survives a switch; it is chosen
    // again from the catalogue rather than typed.
    await pickService(user, lookupForm());
    await user.click(
      within(lookupForm()).getByRole('button', { name: EN['pricing.lookup.submit'] as string })
    );
  }

  it('resets the branch to the new working branch and clears the previous answer', async () => {
    const user = userEvent.setup();
    resolvePrice.mockResolvedValue(priced);
    renderTwo();
    await user.click(screen.getByRole('button', { name: 'first' }));
    expect(branchControl()).toHaveValue(TEST_BRANCH.id);
    await lookUp(user);
    expect(
      await screen.findByRole('region', { name: EN['pricing.lookup.resultHeading'] as string })
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() => expect(branchControl()).toHaveValue(OTHER_BRANCH.id));
    expect(
      screen.queryByRole('region', { name: EN['pricing.lookup.resultHeading'] as string })
    ).toBeNull();
    await lookUp(user);
    await waitFor(() => expect(resolvePrice).toHaveBeenCalledTimes(2));
    expect(resolvePrice.mock.calls[1]?.[0]).toEqual({
      serviceId: SERVICE_ID,
      companyId: OTHER_BRANCH.companyId,
      branchId: OTHER_BRANCH.id,
    });
  });

  it('under "All my branches" the lookup names no branch until one is chosen', async () => {
    const user = userEvent.setup();
    renderTwo();
    await user.click(screen.getByRole('button', { name: 'first' }));
    expect(branchControl()).toHaveValue(TEST_BRANCH.id);
    await user.click(screen.getByRole('button', { name: 'everywhere' }));
    await waitFor(() => expect(branchControl()).toHaveValue(''));
  });

  it('a lookup still in flight when the branch changes is dropped', async () => {
    const user = userEvent.setup();
    let answer: (value: unknown) => void = () => undefined;
    resolvePrice.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    renderTwo();
    await user.click(screen.getByRole('button', { name: 'first' }));
    await lookUp(user);
    await waitFor(() => expect(resolvePrice).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() => expect(branchControl()).toHaveValue(OTHER_BRANCH.id));
    answer(priced);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      screen.queryByRole('region', { name: EN['pricing.lookup.resultHeading'] as string })
    ).toBeNull();
    // Not left looking busy for a reply that no longer counts.
    expect(
      within(lookupForm()).getByRole('button', { name: EN['pricing.lookup.submit'] as string })
    ).toBeEnabled();
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

  it('states an unsupported currency in Arabic, beside the same box', async () => {
    createPriceList.mockResolvedValue({
      state: {
        status: 'invalid',
        messageKey: 'form.formError',
        fieldErrors: { currency: 'form.violation.unsupported_currency' },
        attempt: 1,
      },
      created: null,
    });
    const user = userEvent.setup();
    renderRtl(
      <PricingScreen
        locale="ar"
        messages={ar}
        canManage={true}
        canReadBranches={false}
        canReadServices={false}
      />
    );
    await user.click(screen.getByRole('button', { name: AR['pricing.list.create'] as string }));
    const form = await screen.findByRole('form', { name: AR['pricing.create.title'] as string });
    const arLabelled = (key: string) => new RegExp(`^${escape(AR[key] as string)}`);
    await user.type(within(form).getByLabelText(arLabelled('pricing.create.code')), 'RETAIL-2');
    await user.type(within(form).getByLabelText(arLabelled('pricing.create.name')), 'Retail two');
    await user.type(within(form).getByLabelText(arLabelled('pricing.create.currency')), 'JOD');
    await user.click(
      within(form).getByRole('button', { name: AR['pricing.create.submit'] as string })
    );
    expect(
      await within(form).findByText(AR['form.violation.unsupported_currency'] as string)
    ).toBeVisible();
  });
});

/* -------------------------------------------------------------------- *
 * P1-30 CC-15, the pricing copy of the branch picker.
 *
 * The register named the inventory copy; the same defect existed here, in a
 * second file, with its own message namespace. `items === null` meant both
 * "no request was made" and "the request has not answered", so a PERMITTED
 * operator met two free-text identifier fields on every first paint.
 * -------------------------------------------------------------------- */
describe('CC-15 — the pricing branch picker says which state it is in', () => {
  const permitted = { canReadBranches: true, canReadServices: true };
  const listed = okRead({
    items: [{ id: BRANCH, companyId: COMPANY, branchCode: 'B1', name: 'Main' }],
  });
  const submitButton = () =>
    within(lookupForm()).getByRole('button', { name: EN['pricing.lookup.submit'] as string });

  it('while a permitted read is in flight, waits — and offers no field at all', async () => {
    let release: (value: unknown) => void = () => {};
    listBranches.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderScreen(permitted);
    const form = lookupForm();
    expect(within(form).getByRole('status')).toHaveTextContent(
      EN['pricing.common.branchesLoading'] as string
    );
    expect(within(form).queryByLabelText(RETIRED_BOX.en.company)).toBeNull();
    expect(within(form).queryByLabelText(RETIRED_BOX.en.branch)).toBeNull();
    // The lookup REQUIRES the pair, so submitting while there is no control to
    // put an error on would fail silently.
    expect(submitButton()).toBeDisabled();
    release(listed);
    expect(
      await within(lookupForm()).findByLabelText(labelled('pricing.lookup.branch'))
    ).toBeVisible();
    expect(within(lookupForm()).queryByRole('status')).toBeNull();
    expect(submitButton()).toBeEnabled();
  });

  it('with no branch listed, says so, offers no box to type into, and holds the submit', async () => {
    listBranches.mockResolvedValue(okRead({ items: [] }));
    renderScreen(permitted);
    const form = lookupForm();
    expect(
      await within(form).findByText(EN['pricing.common.branchesNone'] as string)
    ).toBeVisible();
    expect(within(form).queryByLabelText(RETIRED_BOX.en.company)).toBeNull();
    expect(within(form).queryByLabelText(RETIRED_BOX.en.branch)).toBeNull();
    // The lookup needs a branch, and there is no control to put that complaint on.
    expect(submitButton()).toBeDisabled();
  });

  it('a failure that could clear offers a retry; a refusal does not', async () => {
    const user = userEvent.setup();
    listBranches
      .mockResolvedValueOnce({ status: 'unavailable', correlationId: 'corr' })
      .mockResolvedValueOnce(listed);
    renderScreen(permitted);
    expect(
      await within(lookupForm()).findByText(EN['pricing.common.branchesUnavailable'] as string)
    ).toBeVisible();
    await user.click(
      within(lookupForm()).getByRole('button', { name: EN['state.retry'] as string })
    );
    expect(
      await within(lookupForm()).findByLabelText(labelled('pricing.lookup.branch'))
    ).toBeVisible();
    expect(listBranches).toHaveBeenCalledTimes(2);
  });

  it('states a refusal without offering a second attempt at it', async () => {
    listBranches.mockResolvedValue(deniedRead);
    renderScreen(permitted);
    const form = lookupForm();
    expect(
      await within(form).findByText(EN['pricing.common.branchesRefused'] as string)
    ).toBeVisible();
    expect(within(form).queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('states an ended session as one, and offers no retry on a dead session', async () => {
    listBranches.mockResolvedValue({ status: 'expired', correlationId: 'corr' });
    renderScreen(permitted);
    const form = lookupForm();
    expect(await within(form).findByText(EN['state.expired.message'] as string)).toBeVisible();
    expect(within(form).queryByRole('button', { name: EN['state.retry'] as string })).toBeNull();
  });

  it('without org.branch.read, the working context still lists its branches, and no directory read is made', async () => {
    renderInBranch({ canReadBranches: false, canReadServices: true });
    const form = lookupForm();
    expect(listBranches).not.toHaveBeenCalled();
    expect(within(form).getByLabelText(labelled('pricing.lookup.branch'))).toHaveValue(BRANCH);
    expect(within(form).queryByLabelText(RETIRED_BOX.en.company)).toBeNull();
    expect(submitButton()).toBeEnabled();
  });

  it('with neither the directory nor a working context, says no branch is available and offers no box', () => {
    renderScreen({ canReadBranches: false, canReadServices: false });
    const form = lookupForm();
    expect(listBranches).not.toHaveBeenCalled();
    expect(within(form).getByText(EN['pricing.common.branchesNotOffered'] as string)).toBeVisible();
    expect(within(form).queryByLabelText(RETIRED_BOX.en.company)).toBeNull();
    expect(submitButton()).toBeDisabled();
  });

  it('in Arabic, a read in flight is a wait and not two identifier boxes', async () => {
    let release: (value: unknown) => void = () => {};
    listBranches.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    renderRtl(
      <PricingScreen
        locale="ar"
        messages={ar}
        canManage={false}
        canReadBranches={true}
        canReadServices={true}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    const form = screen.getByRole('form', { name: AR['pricing.lookup.heading'] as string });
    expect(within(form).getByRole('status')).toHaveTextContent(
      AR['pricing.common.branchesLoading'] as string
    );
    expect(within(form).queryByLabelText(RETIRED_BOX.ar.company)).toBeNull();
    release(listed);
    expect(
      await within(
        screen.getByRole('form', { name: AR['pricing.lookup.heading'] as string })
      ).findByLabelText(new RegExp(`^${escape(AR['pricing.lookup.branch'] as string)}`))
    ).toBeVisible();
  });

  it('in Arabic, a zero-row list says so and offers no identifier box', async () => {
    listBranches.mockResolvedValue(okRead({ items: [] }));
    renderRtl(
      <PricingScreen
        locale="ar"
        messages={ar}
        canManage={false}
        canReadBranches={true}
        canReadServices={true}
      />
    );
    const form = screen.getByRole('form', { name: AR['pricing.lookup.heading'] as string });
    expect(
      await within(form).findByText(AR['pricing.common.branchesNone'] as string)
    ).toBeVisible();
    expect(within(form).queryByLabelText(RETIRED_BOX.ar.branch)).toBeNull();
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
