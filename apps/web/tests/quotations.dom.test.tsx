import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * The quotations of a work order and the builder, rendered (P1-30, `W3`,
 * FE-003 and FE-005).
 *
 * The properties under test: the list is reached from a work order and reads
 * on first paint; a refusal is never "no quotations"; the builder sends lines
 * as strings and prices nothing; a refused discount renders as a refusal with
 * its reference and hint, never as a quotation; and the route page decides
 * before it reads.
 *
 * Labels are matched ANCHORED (the field frame decorates them) and scoped.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);
// The line discount is labelled "Discount" and the requester "Discount requested by":
// an anchored prefix answers for both, so this one is matched whole.
const labelledExactly = (key: string) => new RegExp(`^${escape(EN[key] as string)}$`);

const listQuotations = vi.fn();
const createQuotation = vi.fn();
vi.mock('@/features/quotations/api', () => ({
  listQuotations: (...args: unknown[]) => listQuotations(...args),
  createQuotation: (...args: unknown[]) => createQuotation(...args),
  readQuotation: vi.fn(),
  listRevisions: vi.fn(),
  readRevision: vi.fn(),
  readRevisionDecisions: vi.fn(),
  createQuotationRevision: vi.fn(),
  issueQuotation: vi.fn(),
  decideRevision: vi.fn(),
  decideItem: vi.fn(),
}));

const listServices = vi.fn();
vi.mock('@/features/services/api', () => ({
  listServices: (...args: unknown[]) => listServices(...args),
}));

const readWorkOrderDetail = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'operator@test.local' }),
}));

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { QuotationsScreen } = await import('@/features/quotations/components/QuotationsScreen');
type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | undefined>>;
}) => Promise<React.ReactNode>;
const QuotationsPage = (await import('@/app/[locale]/(dashboard)/quotations/page'))
  .default as unknown as RoutePage;

const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const QUOTATION_ID = '33333333-3333-4333-8333-333333333333';
const SERVICE_ID = '55555555-5555-4555-8555-555555555555';
const PARTNER_ID = '88888888-8888-4888-8888-888888888888';

function summary(over: Record<string, unknown> = {}) {
  return {
    id: QUOTATION_ID,
    quotationNumber: 'QUO-000001',
    workOrderId: WORK_ORDER_ID,
    companyId: 'c',
    branchId: 'b',
    currency: 'JOD',
    status: 'draft',
    payerPartnerRef: null,
    currentRevisionId: null,
    recordVersion: 1,
    ...over,
  };
}

const workOrder = {
  id: WORK_ORDER_ID,
  companyId: 'c',
  branchId: 'b',
  receptionVisitId: 'r',
  vehicleId: 'v',
  kind: 'ordinary',
  state: 'open',
  partsForwardState: 'none',
  displayNumber: 'WO-000042',
  openedAt: '2026-09-01T08:00:00Z',
  recordVersion: 2,
  customer: {
    partnerId: PARTNER_ID,
    displayName: 'Layla Haddad',
    relationshipRole: 'vehicle_owner',
    hasAdditionalParties: false,
  },
  vehicle: { vehicleId: 'v', registrationPlate: '12-34567', makeModel: 'Toyota Corolla' },
};

function page(rows: readonly unknown[]) {
  return { status: 'ok' as const, rows, nextCursor: null, hasMore: false, correlationId: 'corr' };
}
const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <QuotationsScreen
      locale="en"
      messages={en}
      workOrderId={WORK_ORDER_ID}
      workOrder={workOrder as never}
      canManage={false}
      canReadServices={false}
      {...over}
    />
  );
}

async function renderPage(params: Record<string, string>, search: Record<string, string> = {}) {
  const tree = await QuotationsPage({
    params: Promise.resolve(params),
    searchParams: Promise.resolve(search),
  });
  return renderLtr(tree as React.ReactElement);
}

const builderForm = () =>
  screen.findByRole('form', { name: EN['quotations.build.heading'] as string });

beforeEach(() => {
  vi.clearAllMocks();
  listQuotations.mockResolvedValue(page([summary()]));
  readWorkOrderDetail.mockResolvedValue(
    okRead({ workOrder, jobs: [], nextStates: [], reachableStates: [] })
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

describe('reached from a work order', () => {
  it('without a work order, explains and takes an identifier', async () => {
    const user = userEvent.setup();
    renderScreen({ workOrderId: null, workOrder: null });
    expect(screen.getByText(EN['quotations.choose.explain'] as string)).toBeVisible();
    expect(listQuotations).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText(labelled('quotations.choose.workOrderId')), 'nope');
    await user.click(
      screen.getByRole('button', { name: EN['quotations.choose.submit'] as string })
    );
    expect(await screen.findByText(EN['quotations.common.idFormat'] as string)).toBeVisible();
    expect(push).not.toHaveBeenCalled();
    await user.clear(screen.getByLabelText(labelled('quotations.choose.workOrderId')));
    await user.type(
      screen.getByLabelText(labelled('quotations.choose.workOrderId')),
      WORK_ORDER_ID
    );
    await user.click(
      screen.getByRole('button', { name: EN['quotations.choose.submit'] as string })
    );
    expect(push).toHaveBeenCalledWith(`/en/quotations?workOrderId=${WORK_ORDER_ID}`);
  });

  it('with a work order, reads on first paint and names the work order and customer', async () => {
    renderScreen();
    await waitFor(() => expect(listQuotations).toHaveBeenCalled());
    expect(listQuotations.mock.calls[0]?.[0]).toBe(WORK_ORDER_ID);
    expect(screen.getByText('WO-000042')).toBeVisible();
    expect(screen.getByText('Layla Haddad')).toBeVisible();
    const table = await screen.findByRole('table');
    expect(within(table).getByText('QUO-000001')).toBeVisible();
    expect(within(table).getByText(EN['quotations.status.draft'] as string)).toBeVisible();
  });

  it('says when the work order itself could not be read, and still lists', async () => {
    renderScreen({ workOrder: null });
    expect(screen.getByText(EN['quotations.list.workOrderNotReadable'] as string)).toBeVisible();
    expect(await screen.findByRole('table')).toBeVisible();
  });

  it('renders the denied state instead of an empty list', async () => {
    listQuotations.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr',
    });
    renderScreen();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['quotations.list.none'] as string)).toBeNull();
  });

  it('says there are none when the server answers none', async () => {
    listQuotations.mockResolvedValue(page([]));
    renderScreen();
    expect(await screen.findByText(EN['quotations.list.none'] as string)).toBeVisible();
  });
});

describe('the builder sends lines as strings and prices nothing', () => {
  it('is not offered without quo.quotation.manage', () => {
    renderScreen({ canManage: false });
    expect(
      screen.queryByRole('button', { name: EN['quotations.list.create'] as string })
    ).toBeNull();
  });

  it('creates a quotation from a line, prefilling the payer from the work order, then moves to it', async () => {
    const user = userEvent.setup();
    createQuotation.mockResolvedValue({
      state: { status: 'success', messageKey: 'quotations.create.success', attempt: 1 },
      created: { ...summary({ id: 'new-id' }), currentRevision: null },
    });
    renderScreen({ canManage: true });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    expect(within(form).getByLabelText(labelled('quotations.build.payer'))).toHaveValue(PARTNER_ID);
    await user.type(
      within(form).getByLabelText(labelled('quotations.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '2.5');
    await user.type(within(form).getByLabelText(labelledExactly('quotations.lines.discount')), '5');
    await user.type(
      within(form).getByLabelText(labelled('quotations.lines.description')),
      'Front pads'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );

    await waitFor(() => expect(createQuotation).toHaveBeenCalled());
    const body = createQuotation.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(body['workOrderId']).toBe(WORK_ORDER_ID);
    expect(body['payerPartnerRef']).toBe(PARTNER_ID);
    const lines = body['lines'] as Record<string, unknown>[];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.['serviceId']).toBe(SERVICE_ID);
    // Strings, as typed: the server prices the line; nothing here multiplied anything.
    expect(lines[0]?.['quantity']).toBe('2.5');
    expect(typeof lines[0]?.['discount']).toBe('string');
    expect(lines[0]?.['discount']).toMatch(/^5(\.0000)?$/);
    expect(lines[0]?.['description']).toBe('Front pads');
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/quotations/new-id'));
  });

  it('refuses a zero quantity and a malformed service before any request', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    await user.type(within(form).getByLabelText(labelled('quotations.picker.serviceIdField')), 'x');
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '0');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['quotations.lines.quantityFormat'] as string)
    ).toBeVisible();
    expect(
      within(form).getAllByText(EN['quotations.common.idFormat'] as string).length
    ).toBeGreaterThan(0);
    expect(createQuotation).not.toHaveBeenCalled();
  });

  it('adds and removes lines, never below one', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    const removeButtons = () =>
      within(form).getAllByRole('button', { name: EN['quotations.lines.remove'] as string });
    expect(removeButtons()[0]).toBeDisabled();
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.lines.add'] as string })
    );
    expect(removeButtons()).toHaveLength(2);
    expect(removeButtons()[0]).toBeEnabled();
    await user.click(removeButtons()[1] as HTMLElement);
    expect(removeButtons()).toHaveLength(1);
  });

  it('a refused discount renders as a refusal with its reference and the hint, and no quotation', async () => {
    const user = userEvent.setup();
    createQuotation.mockResolvedValue({
      state: {
        status: 'denied',
        messageKey: 'state.denied.title',
        correlationId: 'corr-d',
        attempt: 1,
      },
      created: null,
    });
    renderScreen({ canManage: true });
    await user.click(screen.getByRole('button', { name: EN['quotations.list.create'] as string }));
    const form = await builderForm();
    await user.type(
      within(form).getByLabelText(labelled('quotations.picker.serviceIdField')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '1');
    await user.type(
      within(form).getByLabelText(labelledExactly('quotations.lines.discount')),
      '900'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.build.submit'] as string })
    );
    await waitFor(() => expect(createQuotation).toHaveBeenCalled());
    const alert = await within(form).findByRole('alert');
    expect(alert.textContent).toContain(EN['state.denied.title'] as string);
    expect(alert.textContent).toContain(EN['quotations.build.discountRefusedHint'] as string);
    expect(alert.textContent).toContain('corr-d');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('the /quotations route page decides before it reads', () => {
  it('refuses without quo.quotation.read, and issues no read', async () => {
    PERMISSIONS = [];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listQuotations).not.toHaveBeenCalled();
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
  });

  it('reads the work order only with wo.work_order.read, and lists either way', async () => {
    PERMISSIONS = ['quo.quotation.read'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
    expect(screen.getByText(EN['quotations.list.workOrderNotReadable'] as string)).toBeVisible();
    await waitFor(() => expect(listQuotations).toHaveBeenCalled());
  });

  it('with wo.work_order.read, names the work order; with manage, offers the builder', async () => {
    PERMISSIONS = ['quo.quotation.read', 'wo.work_order.read', 'quo.quotation.manage'];
    await renderPage({ locale: 'en' }, { workOrderId: WORK_ORDER_ID });
    expect(readWorkOrderDetail).toHaveBeenCalledWith(WORK_ORDER_ID);
    expect(screen.getByText('WO-000042')).toBeVisible();
    expect(
      screen.getByRole('button', { name: EN['quotations.list.create'] as string })
    ).toBeVisible();
  });

  it('without a work order in the address, offers the chooser', async () => {
    PERMISSIONS = ['quo.quotation.read'];
    await renderPage({ locale: 'en' });
    expect(screen.getByText(EN['quotations.choose.explain'] as string)).toBeVisible();
    expect(listQuotations).not.toHaveBeenCalled();
  });

  it('a locale it does not serve is not found', async () => {
    PERMISSIONS = ['quo.quotation.read'];
    await expect(renderPage({ locale: 'xx' })).rejects.toThrow('notFound');
  });
});

describe('Arabic, right to left', () => {
  it('renders the list in Arabic with the same behaviour', async () => {
    renderRtl(
      <QuotationsScreen
        locale="ar"
        messages={ar}
        workOrderId={WORK_ORDER_ID}
        workOrder={workOrder as never}
        canManage={false}
        canReadServices={false}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    const table = await screen.findByRole('table');
    expect(within(table).getByText('QUO-000001')).toBeVisible();
    expect(within(table).getByText(AR['quotations.status.draft'] as string)).toBeVisible();
  });
});
