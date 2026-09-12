import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * The report screens, rendered (P1-31, FE-011, FE-012, FE-013, FE-014).
 *
 * ONE screen serves every report code, so the properties under test are
 * properties of the CONTRACT rather than of any one report: the catalogue is
 * rendered as the operation returned it, including a definition the platform
 * cannot run; both pages decide the permission before they read; the run screen
 * asks for nothing until an operator names a branch and a period; the columns,
 * their kinds, the grouping and the drill-through all come out of the response;
 * every measure reaches the screen as the characters the server sent; the
 * timezone and the filter context travel with the result; and each refusal is
 * drawn as itself rather than as an empty report.
 *
 * Two envelope shapes are exercised on purpose. The shape `develop` publishes
 * carries the deprecated state counts and no grouping, filter context or branch;
 * the shape the dataset slice adds carries all three. A screen that required
 * either would break against the other the day it merged.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/*
 * A required control's `<label>` carries a decorative asterisk, so its label
 * text is the catalogue string PLUS a character the catalogue does not hold.
 * Anchoring at the start matches the label without asserting the marker, which
 * is a styling decision rather than a property of this screen.
 */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listReportCatalogue = vi.fn();
const readReport = vi.fn();
const readReportScopes = vi.fn();
const runReport = vi.fn();
vi.mock('@/features/reports/reports-api', () => ({
  listReportCatalogue: (...args: unknown[]) => listReportCatalogue(...args),
  readReport: (...args: unknown[]) => readReport(...args),
  readReportScopes: (...args: unknown[]) => readReportScopes(...args),
  runReport: (...args: unknown[]) => runReport(...args),
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    permissions: PERMISSIONS,
    email: 'manager@test.local',
    companyIds: [COMPANY_ID],
    branchIds: [BRANCH_ID],
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { ReportCatalogueScreen } =
  await import('@/features/reports/components/ReportCatalogueScreen');
const { ReportScreen } = await import('@/features/reports/components/ReportScreen');
type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<React.ReactNode>;
const CataloguePage = (await import('@/app/[locale]/(dashboard)/reports/page'))
  .default as unknown as RoutePage;
const ReportRoutePage = (await import('@/app/[locale]/(dashboard)/reports/[reportCode]/page'))
  .default as unknown as RoutePage;

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const WORK_ORDER_ID = '44444444-4444-4444-8444-444444444444';
const PARTNER_ID = '88888888-8888-4888-8888-888888888888';
const CODE = 'work_orders_by_status';
const READ = 'rpt.report.read';

const SCOPES = {
  status: 'ok' as const,
  data: {
    companies: [{ id: COMPANY_ID, legalName: 'Workshop company' }],
    branches: [{ id: BRANCH_ID, companyId: COMPANY_ID, name: 'Service branch' }],
  },
  correlationId: null,
};

const BASELINE = {
  reportCode: CODE,
  name: CODE,
  scopeLevel: 'branch',
  exportPermissionCode: null,
  versionNumber: null,
  parameterSchema: {},
  publishedAt: null,
  recordVersion: 0,
  executable: true,
  source: 'platform',
  titleKey: 'reports.work_orders_by_status.title',
};

/** A workshop's own definition of a code the engine does not implement. */
const UNRUNNABLE = {
  ...BASELINE,
  reportCode: 'branch_cash_position',
  name: 'Counter takings',
  versionNumber: 2,
  publishedAt: '2026-09-01T00:00:00.000Z',
  recordVersion: 4,
  executable: false,
  source: 'tenant',
  titleKey: null,
};

const cataloguePage = (
  items: readonly unknown[],
  hasMore = false,
  nextCursor: string | null = null
) => ({
  status: 'ok' as const,
  data: { items, nextCursor, hasMore },
  correlationId: null,
});

/** The columns and rows `work_orders_by_status` publishes today. */
const COLUMNS = [
  { key: 'workOrder', kind: 'reference', drillThrough: '/work-orders/{id}' },
  { key: 'customer', kind: 'reference', drillThrough: null },
  { key: 'openedAt', kind: 'date', drillThrough: null },
  { key: 'state', kind: 'text', drillThrough: null },
];

const ROW = {
  cells: [
    { key: 'workOrder', label: 'W-000123', value: WORK_ORDER_ID },
    { key: 'customer', label: 'Hani Motors', value: PARTNER_ID },
    { key: 'openedAt', label: null, value: '2026-09-03T07:15:00.000Z' },
    { key: 'state', label: 'Awaiting parts', value: 'awaiting_parts' },
  ],
};

/** The envelope `develop` publishes: state counts, and no grouping. */
const OLD_ENVELOPE = {
  reportCode: CODE,
  titleKey: 'reports.work_orders_by_status.title',
  scope: 'branch',
  period: { from: '2026-09-01', to: '2026-09-08', timezone: 'Asia/Amman' },
  generatedAt: '2026-09-12T09:00:00.000Z',
  freshness: 'live',
  columns: COLUMNS,
  countsByState: [{ stateCode: 'awaiting_parts', stateName: 'Awaiting parts', count: 4 }],
  rows: { items: [ROW], nextCursor: null, hasMore: false },
};

/** The envelope the dataset slice adds: grouping, filter context and branch. */
const NEW_ENVELOPE = {
  ...OLD_ENVELOPE,
  filters: { companyId: COMPANY_ID, branchId: BRANCH_ID },
  branch: { id: BRANCH_ID, name: 'Named by the run' },
  groups: [
    {
      key: { currency: 'JOD', documentType: 'invoice' },
      label: null,
      measures: { invoiced: '1234.5600', outstanding: '200.0000' },
    },
  ],
  countsByState: [],
};

const runOk = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr-run' });

/*
 * The three regions of a run, addressed by their own accessible names.
 *
 * The screen deliberately draws the same value in more than one place — a state
 * name is a row cell and a group label, an amount is a row cell and a measure —
 * so an assertion that searched the whole document could pass against the wrong
 * one. Naming the region is what makes each case say which half it means.
 */
const rowsTable = () =>
  screen.getByRole('table', { name: EN['reports.run.rowsCaption'] as string });
const totalsTable = () =>
  screen.getByRole('table', { name: EN['reports.groups.caption'] as string });
/** A context fact, addressed by its own label rather than by position. */
const fact = (key: string) => screen.getByText(EN[key] as string).parentElement as HTMLElement;

beforeEach(() => {
  listReportCatalogue.mockReset();
  readReport.mockReset();
  readReportScopes.mockReset();
  runReport.mockReset();
  PERMISSIONS = [READ];
  listReportCatalogue.mockResolvedValue(cataloguePage([BASELINE, UNRUNNABLE]));
  readReport.mockResolvedValue({ status: 'ok', data: BASELINE, correlationId: null });
  readReportScopes.mockResolvedValue(SCOPES);
  runReport.mockResolvedValue(runOk(OLD_ENVELOPE));
});

async function renderCataloguePage() {
  const ui = await CataloguePage({
    params: Promise.resolve({ locale: 'en' }),
    searchParams: Promise.resolve({}),
  });
  return renderLtr(ui as React.ReactElement);
}

async function renderReportPage(
  locale = 'en',
  search: Record<string, string | string[] | undefined> = {}
) {
  const ui = await ReportRoutePage({
    params: Promise.resolve({ locale, reportCode: CODE }),
    searchParams: Promise.resolve(search),
  });
  return locale === 'ar'
    ? renderRtl(ui as React.ReactElement)
    : renderLtr(ui as React.ReactElement);
}

/** Fills the form and runs the report, returning the rendered container. */
async function showReport(locale = 'en') {
  const rendered = await renderReportPage(locale);
  const user = userEvent.setup();
  const messages = locale === 'ar' ? AR : EN;
  const label = (key: string) => new RegExp(`^${escape(messages[key] as string)}`);
  await user.selectOptions(
    screen.getByRole('combobox', { name: label('reports.run.company') }),
    COMPANY_ID
  );
  await user.selectOptions(
    screen.getByRole('combobox', { name: label('reports.run.branch') }),
    BRANCH_ID
  );
  const from = screen.getByLabelText(label('reports.run.from'));
  const to = screen.getByLabelText(label('reports.run.to'));
  await user.type(from, '2026-09-01');
  await user.type(to, '2026-09-08');
  await user.click(screen.getByRole('button', { name: messages['reports.run.show'] as string }));
  await waitFor(() => expect(runReport).toHaveBeenCalled());
  return rendered;
}

describe('both report pages decide the permission before they read', () => {
  it('refuses the catalogue without the report read code, and reads nothing', async () => {
    PERMISSIONS = [];
    await renderCataloguePage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listReportCatalogue).not.toHaveBeenCalled();
  });

  it('refuses one report without the code, and never asks for its definition', async () => {
    PERMISSIONS = [];
    await renderReportPage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(readReport).not.toHaveBeenCalled();
    expect(readReportScopes).not.toHaveBeenCalled();
  });

  it('renders the catalogue for a caller who holds the code', async () => {
    await renderCataloguePage();
    await waitFor(() => expect(listReportCatalogue).toHaveBeenCalled());
    expect(screen.queryByText(EN['state.denied.title'] as string)).toBeNull();
  });

  it('prints the backend’s reference on a refusal it made, and none on its own', async () => {
    // A denial decided by this page logged nothing, so a reference would lead
    // nowhere. A denial decided by the backend is in its logs and is the only
    // diagnostic an operator ever sees.
    PERMISSIONS = [];
    const { unmount } = await renderReportPage();
    expect(screen.queryByText(/corr-def/)).toBeNull();
    unmount();
    PERMISSIONS = [READ];
    readReport.mockResolvedValue({ status: 'denied', correlationId: 'corr-def' });
    await renderReportPage();
    expect(screen.getByText(/corr-def/)).toBeVisible();
  });
});

describe('the catalogue renders what the operation returned, and decides nothing', () => {
  it('names a platform baseline by its message and shows its code as a code', async () => {
    await renderCataloguePage();
    const title = await screen.findByText(EN['reports.work_orders_by_status.title'] as string);
    expect(title).toBeVisible();
    expect(screen.getAllByText(CODE).length).toBeGreaterThan(0);
  });

  it('shows a workshop’s own definition under the name that workshop gave it', async () => {
    await renderCataloguePage();
    expect(await screen.findByText('Counter takings')).toBeVisible();
    expect(
      screen.getAllByText(EN['reports.catalogue.origin.workshop'] as string).length
    ).toBeGreaterThan(0);
  });

  it('marks a definition the platform cannot run as not runnable, honestly', async () => {
    // `executable` is the platform's own answer. A screen that inferred it from
    // the presence of a code would offer a run whose only outcome is a refusal.
    const { container } = await renderCataloguePage();
    const row = (await within(container).findByText('Counter takings')).closest(
      'tr'
    ) as HTMLElement;
    expect(within(row).getByText(EN['reports.catalogue.runnable.no'] as string)).toBeVisible();
    const baselineRow = (
      await within(container).findByText(EN['reports.work_orders_by_status.title'] as string)
    ).closest('tr') as HTMLElement;
    expect(
      within(baselineRow).getByText(EN['reports.catalogue.runnable.yes'] as string)
    ).toBeVisible();
  });

  it('links every row to its own report screen, including one that cannot be run', async () => {
    await renderCataloguePage();
    const baseline = await screen.findByRole('link', {
      name: new RegExp(escape(EN['reports.work_orders_by_status.title'] as string)),
    });
    expect(baseline).toHaveAttribute('href', `/en/reports/${CODE}`);
    expect(screen.getByRole('link', { name: /Counter takings/ })).toHaveAttribute(
      'href',
      '/en/reports/branch_cash_position'
    );
  });

  it('offers no download anywhere, because there is no operation to offer', async () => {
    await renderCataloguePage();
    expect(await screen.findByText(EN['reports.catalogue.noDownload'] as string)).toBeVisible();
    expect(screen.queryByRole('link', { name: /download/i })).toBeNull();
  });

  it('says an empty catalogue is empty rather than drawing an empty table', async () => {
    listReportCatalogue.mockResolvedValue(cataloguePage([]));
    renderLtr(<ReportCatalogueScreen locale="en" messages={en} />);
    expect(await screen.findByText(EN['reports.catalogue.noneTitle'] as string)).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it.each([
    ['denied', 'state.denied.title'],
    ['unavailable', 'state.unavailable.title'],
    ['expired', 'state.expired.title'],
  ])('draws a %s catalogue read as itself, never as an empty list', async (status, key) => {
    listReportCatalogue.mockResolvedValue({ status, correlationId: 'corr-cat' });
    renderLtr(<ReportCatalogueScreen locale="en" messages={en} />);
    expect(await screen.findByText(EN[key] as string)).toBeVisible();
    expect(screen.queryByText(EN['reports.catalogue.noneTitle'] as string)).toBeNull();
  });

  it('offers the next page only when the server said there is one', async () => {
    listReportCatalogue.mockResolvedValue(cataloguePage([BASELINE], true, 'next-cursor'));
    renderLtr(<ReportCatalogueScreen locale="en" messages={en} />);
    const next = await screen.findByRole('button', { name: EN['reports.page.next'] as string });
    expect(next).toBeEnabled();
    expect(
      screen.getByRole('button', { name: EN['reports.page.previous'] as string })
    ).toBeDisabled();
    await userEvent.setup().click(next);
    await waitFor(() =>
      expect(listReportCatalogue).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: 'next-cursor' })
      )
    );
  });
});

describe('the report screen requests nothing until it has a branch and a period', () => {
  it('shows the idle state and issues no run', async () => {
    await renderReportPage();
    expect(await screen.findByText(EN['reports.run.idleTitle'] as string)).toBeVisible();
    expect(runReport).not.toHaveBeenCalled();
  });

  it('refuses an empty period at the form rather than spending a request', async () => {
    // `to` is the first day EXCLUDED, so an equal pair covers no day at all.
    await renderReportPage();
    const user = userEvent.setup();
    await user.selectOptions(
      screen.getByRole('combobox', { name: labelled('reports.run.company') }),
      COMPANY_ID
    );
    await user.selectOptions(
      screen.getByRole('combobox', { name: labelled('reports.run.branch') }),
      BRANCH_ID
    );
    await user.type(screen.getByLabelText(labelled('reports.run.from')), '2026-09-08');
    await user.type(screen.getByLabelText(labelled('reports.run.to')), '2026-09-08');
    await user.click(screen.getByRole('button', { name: EN['reports.run.show'] as string }));
    expect(await screen.findByText(EN['reports.run.toAfterFrom'] as string)).toBeVisible();
    expect(runReport).not.toHaveBeenCalled();
  });

  it('states the half-open rule beside the two controls', async () => {
    await renderReportPage();
    expect(await screen.findByText(EN['reports.run.periodRule'] as string)).toBeVisible();
    expect(screen.getByText(EN['reports.run.fromHint'] as string)).toBeVisible();
    expect(screen.getByText(EN['reports.run.toHint'] as string)).toBeVisible();
  });

  it('sends the branch pair and the two days exactly as chosen', async () => {
    await showReport();
    expect(runReport).toHaveBeenCalledWith(
      expect.objectContaining({
        reportCode: CODE,
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        from: '2026-09-01',
        to: '2026-09-08',
        cursor: null,
      })
    );
  });

  it('offers named scope choices rather than a box to type an identifier into', async () => {
    await renderReportPage();
    expect(await screen.findByRole('option', { name: 'Workshop company' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Service branch' })).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('draws no form at all for a report the platform cannot run', async () => {
    readReport.mockResolvedValue({
      status: 'ok',
      data: { ...BASELINE, executable: false },
      correlationId: null,
    });
    await renderReportPage();
    expect(await screen.findByText(EN['reports.run.notRunnableTitle'] as string)).toBeVisible();
    expect(screen.queryByRole('button', { name: EN['reports.run.show'] as string })).toBeNull();
    expect(runReport).not.toHaveBeenCalled();
  });

  it('says a caller with no branch has no branch, rather than showing an empty report', async () => {
    readReportScopes.mockResolvedValue({
      status: 'ok',
      data: { companies: [], branches: [] },
      correlationId: null,
    });
    await renderReportPage();
    expect(await screen.findByText(EN['reports.run.noScopesTitle'] as string)).toBeVisible();
    expect(runReport).not.toHaveBeenCalled();
  });

  it('answers an unpublished or unknown code as not found, and says no more', async () => {
    readReport.mockResolvedValue({ status: 'not-found', correlationId: null });
    await renderReportPage();
    expect(screen.getByText(EN['state.notFound.title'] as string)).toBeVisible();
    expect(readReportScopes).not.toHaveBeenCalled();
  });
});

describe('the address may fill the form in, and may not run it', () => {
  it('fills the four controls from the address and still runs nothing', async () => {
    // The operational overview links here carrying the branch and the period its
    // summary was read over, so the rows are the rows behind the figure.
    await renderReportPage('en', {
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from: '2026-09-01',
      to: '2026-09-08',
    });
    expect(
      (screen.getByRole('combobox', { name: labelled('reports.run.company') }) as HTMLSelectElement)
        .value
    ).toBe(COMPANY_ID);
    expect(
      (screen.getByRole('combobox', { name: labelled('reports.run.branch') }) as HTMLSelectElement)
        .value
    ).toBe(BRANCH_ID);
    expect(screen.getByLabelText(labelled('reports.run.from'))).toHaveValue('2026-09-01');
    expect(screen.getByLabelText(labelled('reports.run.to'))).toHaveValue('2026-09-08');
    // Filled in is not submitted. Nothing is read until the operator asks.
    expect(runReport).not.toHaveBeenCalled();
    expect(screen.getByText(EN['reports.run.idleTitle'] as string)).toBeVisible();
  });

  it('drops a branch the caller’s own directory does not hold, and guesses nothing', async () => {
    await renderReportPage('en', { branchId: '99999999-9999-4999-8999-999999999999' });
    const branch = screen.getByRole('combobox', {
      name: labelled('reports.run.branch'),
    }) as HTMLSelectElement;
    // The caller has exactly one branch, which is what the form offers; the branch
    // in the address is not shown, and is not substituted for either.
    expect(branch.value).toBe(BRANCH_ID);
    expect(screen.queryByText('99999999-9999-4999-8999-999999999999')).toBeNull();
    expect(runReport).not.toHaveBeenCalled();
  });

  it('refuses a period in the address that is not a calendar day', async () => {
    await renderReportPage('en', { from: 'yesterday', to: '2026-9-1' });
    expect(screen.getByLabelText(labelled('reports.run.from'))).toHaveValue('');
    expect(screen.getByLabelText(labelled('reports.run.to'))).toHaveValue('');
  });
});

describe('the result is rendered from the envelope, column kind by column kind', () => {
  it('heads each column with its own name and keeps the server’s order', async () => {
    await showReport();
    const headers = within(rowsTable())
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual([
      EN['reports.field.workOrder'],
      EN['reports.field.customer'],
      EN['reports.field.openedAt'],
      EN['reports.field.state'],
    ]);
  });

  it('links a reference to the screen this application serves, and only that one', async () => {
    await showReport();
    const link = await screen.findByRole('link', { name: 'W-000123' });
    expect(link).toHaveAttribute('href', `/en/work-orders/${WORK_ORDER_ID}`);
    // The customer column publishes no template — there is no customer screen the
    // report may name — so the name is rendered and no link is offered.
    expect(screen.getByText('Hani Motors').closest('a')).toBeNull();
  });

  it('shows a date exactly as the server published it, in no other zone', async () => {
    // The period is resolved in the branch's zone. Re-rendering an instant in the
    // reader's own zone would put a row in a different day from the one the
    // report counted it in.
    await showReport();
    expect(await screen.findByText('2026-09-03T07:15:00.000Z')).toBeVisible();
  });

  it('renders a catalogue label rather than the code behind it', async () => {
    await showReport();
    expect(within(rowsTable()).getByText('Awaiting parts')).toBeVisible();
    expect(within(rowsTable()).queryByText('awaiting_parts')).toBeNull();
  });

  it('shows a reference with no label as an absence, never as an internal identifier', async () => {
    runReport.mockResolvedValue(
      runOk({
        ...OLD_ENVELOPE,
        rows: {
          items: [
            {
              cells: [
                { key: 'workOrder', label: null, value: WORK_ORDER_ID },
                { key: 'customer', label: null, value: PARTNER_ID },
                { key: 'openedAt', label: null, value: '2026-09-03T07:15:00.000Z' },
                { key: 'state', label: 'Awaiting parts', value: 'awaiting_parts' },
              ],
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      })
    );
    await showReport();
    expect(
      (await screen.findAllByText(EN['reports.cell.noReference'] as string)).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText(WORK_ORDER_ID)).toBeNull();
    expect(screen.queryByText(PARTNER_ID)).toBeNull();
  });

  it('renders an exact measure as the characters the server sent', async () => {
    runReport.mockResolvedValue(
      runOk({
        ...NEW_ENVELOPE,
        columns: [
          { key: 'quantity', kind: 'quantity', drillThrough: null },
          { key: 'duration', kind: 'duration', drillThrough: null },
          { key: 'invoicedAmount', kind: 'money', drillThrough: null },
        ],
        rows: {
          items: [
            {
              cells: [
                { key: 'quantity', label: null, value: '12.500' },
                { key: 'duration', label: null, value: '5400' },
                { key: 'invoicedAmount', label: null, value: '1234.5600' },
              ],
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      })
    );
    const { container } = await showReport();
    // Character for character: not rounded, not re-scaled, not grouped, not
    // turned into hours, and not given a currency the cell does not carry.
    const rows = within(rowsTable());
    expect(rows.getByText('12.500')).toBeVisible();
    expect(rows.getByText('5400')).toBeVisible();
    expect(rows.getByText('1234.5600')).toBeVisible();
    expect(within(container).queryByText('1,234.56')).toBeNull();
    expect(within(container).queryByText('1.5')).toBeNull();
    expect(within(container).queryByText('1h 30m')).toBeNull();
  });

  it('says a column with no cell is not reported rather than drawing it empty', async () => {
    runReport.mockResolvedValue(
      runOk({
        ...OLD_ENVELOPE,
        rows: {
          items: [{ cells: [{ key: 'workOrder', label: 'W-000123', value: WORK_ORDER_ID }] }],
          nextCursor: null,
          hasMore: false,
        },
      })
    );
    const { container } = await showReport();
    expect(
      (await within(container).findAllByText(EN['reports.cell.missing'] as string)).length
    ).toBe(3);
  });

  it('shows a machine name for a column this build has no words for', async () => {
    runReport.mockResolvedValue(
      runOk({
        ...OLD_ENVELOPE,
        columns: [{ key: 'somethingNew', kind: 'text', drillThrough: null }],
        rows: {
          items: [{ cells: [{ key: 'somethingNew', label: null, value: 'a-code' }] }],
          nextCursor: null,
          hasMore: false,
        },
      })
    );
    const { container } = await showReport();
    expect(await within(container).findByText('somethingNew')).toBeVisible();
    expect(within(container).getByText('a-code')).toBeVisible();
  });

  it('says the period held nothing rather than claiming the branch has nothing', async () => {
    runReport.mockResolvedValue(
      runOk({ ...OLD_ENVELOPE, rows: { items: [], nextCursor: null, hasMore: false } })
    );
    await showReport();
    expect(await screen.findByText(EN['reports.run.noRows'] as string)).toBeVisible();
  });
});

describe('the period, the zone and the filter context travel with the result', () => {
  it('shows the period and the zone the server resolved it in', async () => {
    const { container } = await showReport();
    expect(await within(container).findByText('2026-09-01')).toBeVisible();
    expect(within(container).getByText('2026-09-08')).toBeVisible();
    expect(within(container).getByText('Asia/Amman')).toBeVisible();
    expect(within(container).getByText(EN['reports.context.periodNote'] as string)).toBeVisible();
  });

  it('states how current the answer is, in the server’s own terms', async () => {
    await showReport();
    expect(await screen.findByText(EN['reports.context.freshness.live'] as string)).toBeVisible();
    expect(screen.getByText('2026-09-12T09:00:00.000Z')).toBeVisible();
  });

  it('names an unrecognised freshness as itself rather than calling it live', async () => {
    runReport.mockResolvedValue(runOk({ ...OLD_ENVELOPE, freshness: 'cached' }));
    const { container } = await showReport();
    expect(await within(container).findByText('cached')).toBeVisible();
    expect(
      within(container).queryByText(EN['reports.context.freshness.live'] as string)
    ).toBeNull();
  });

  it('names the branch the run resolved, in preference to the one it was picked by', async () => {
    runReport.mockResolvedValue(runOk(NEW_ENVELOPE));
    const { container } = await showReport();
    expect(await within(container).findByText('Named by the run')).toBeVisible();
  });

  it('falls back to the chosen branch name when the envelope carries none', async () => {
    await showReport();
    expect(within(fact('reports.context.branch')).getByText('Service branch')).toBeVisible();
    expect(within(fact('reports.context.company')).getByText('Workshop company')).toBeVisible();
  });
});

describe('the totals are the server’s, over the whole period and never over the page', () => {
  it('reads the deprecated state counts when the envelope carries no grouping', async () => {
    await showReport();
    const totals = within(totalsTable());
    expect(totals.getByText('Awaiting parts')).toBeVisible();
    expect(totals.getByText('4')).toBeVisible();
    expect(totals.getByText(EN['reports.field.count'] as string)).toBeVisible();
  });

  it('reads the grouping when the envelope carries one, and keeps each measure distinct', async () => {
    runReport.mockResolvedValue(runOk(NEW_ENVELOPE));
    await showReport();
    const totals = within(totalsTable());
    // Grouped by currency and document kind, each measure in its own column, and
    // nothing summed, netted or crossed between them.
    expect(totals.getByText('JOD')).toBeVisible();
    expect(totals.getByText('invoice')).toBeVisible();
    expect(totals.getByText('1234.5600')).toBeVisible();
    expect(totals.getByText('200.0000')).toBeVisible();
    expect(totals.getByText(EN['reports.field.invoiced'] as string)).toBeVisible();
    expect(totals.getByText(EN['reports.field.outstanding'] as string)).toBeVisible();
  });

  it('says the totals cover the period rather than the page on screen', async () => {
    await showReport();
    expect(await screen.findByText(EN['reports.run.pagingNote'] as string)).toBeVisible();
  });

  it('draws no totals table when the server grouped nothing', async () => {
    runReport.mockResolvedValue(runOk({ ...OLD_ENVELOPE, countsByState: [] }));
    await showReport();
    expect(screen.queryByText(EN['reports.groups.heading'] as string)).toBeNull();
  });
});

describe('a refused run is drawn as a refusal, never as a report with nothing in it', () => {
  it.each([
    ['denied', 'state.denied.title'],
    ['not-found', 'state.notFound.title'],
    ['error', 'state.error.title'],
    ['unavailable', 'state.unavailable.title'],
  ])('draws a %s run as itself', async (status, key) => {
    runReport.mockResolvedValue({ status, correlationId: 'corr-run' });
    await showReport();
    expect(await screen.findByText(EN[key] as string)).toBeVisible();
    expect(screen.queryByText(EN['reports.run.noRows'] as string)).toBeNull();
  });

  it('does not tell a missing authority apart from a missing report', async () => {
    // The run service answers the same refusal whether the caller may not run
    // reports, may not read this dataset's rows, or named a pair outside their
    // own workshop. A screen that distinguished them would be a way to find out
    // which datasets exist.
    runReport.mockResolvedValue({ status: 'denied', correlationId: 'corr-run' });
    await showReport();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(/wo\./)).toBeNull();
    expect(screen.queryByText(/rpt\./)).toBeNull();
  });
});

describe('the screens read in Arabic as Arabic', () => {
  it('renders the catalogue headings and the report name from the Arabic catalogue', async () => {
    renderRtl(<ReportCatalogueScreen locale="ar" messages={ar} />);
    expect(
      await screen.findByText(AR['reports.work_orders_by_status.title'] as string)
    ).toBeVisible();
    expect(screen.getByText(AR['reports.catalogue.column.runnable'] as string)).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('renders the run context and the half-open rule in Arabic', async () => {
    const { container } = await showReport('ar');
    expect(
      await within(container).findByText(AR['reports.context.timezone'] as string)
    ).toBeVisible();
    expect(within(container).getByText(AR['reports.run.periodRule'] as string)).toBeVisible();
    // The two days and the zone are identifiers and stay left to right in both
    // directions; only the words around them change.
    expect(within(container).getByText('Asia/Amman')).toBeVisible();
  });

  it('keeps the same screen for both languages rather than a second Arabic one', () => {
    renderRtl(
      <ReportScreen locale="ar" messages={ar} definition={BASELINE} scopeOptions={SCOPES} />
    );
    expect(screen.getByText(AR['reports.run.show'] as string)).toBeVisible();
  });
});
