import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  BranchSwitch,
  OTHER_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';
import { forgetRememberedBranch } from './support/branch-switch';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import { addDays, dayIn } from '../src/lib/branch-time';
import { formatReportTime } from '../src/features/reports/report-labels';

/**
 * A screen inside the locale layout's Material provider, as the application
 * renders it. The scope form's two days are the MIT date pickers since
 * P1-32-PRE-OD-REPA (ADR-022), and a picker needs the provider.
 */
function withPickers(ui: React.ReactElement, locale = 'en') {
  return (
    <UiFoundationProvider
      locale={locale === 'ar' ? 'ar' : 'en'}
      text={muiTextOf(getMessages(locale === 'ar' ? 'ar' : 'en'))}
    >
      {ui}
    </UiFoundationProvider>
  );
}

/**
 * The operational overview, rendered (P1-31, FE-010 and FE-016; Owner decision
 * **D-19** of 2026-09-12).
 *
 * The properties under test are the ones D-19 attached to the decision, and each
 * is a property of the screen rather than of a report: the page decides the
 * permission before it reads; the four approved domains are each one run of their
 * own report, asking for one row; every figure is the string the server sent, with
 * nothing summed, divided, re-scaled or crossed between sections; the recorded
 * labour section never calls a duration productivity; the invoice section keeps
 * its six measures apart and grouped by currency; a refused domain is a refusal
 * beside three that answered; a domain with no published summary shows no summary
 * rather than an invented one; and the branch may be fixed by the address but is
 * never written into the source.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/*
 * A required control's `<label>` carries a decorative asterisk, so anchoring at
 * the start matches the label without asserting a styling decision.
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

const contract = await import('@/features/reports/overview-contract');
type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<React.ReactNode>;
const OverviewPage = (await import('@/app/[locale]/(dashboard)/reports/overview/page'))
  .default as unknown as RoutePage;
const { ReportOverviewScreen } = await import('@/features/reports/components/ReportOverviewScreen');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const READ = 'rpt.report.read';
const FROM = '2026-09-01';
const TO = '2026-09-08';

const SCOPES = {
  status: 'ok' as const,
  data: {
    companies: [{ id: COMPANY_ID, legalName: 'Workshop company' }],
    branches: [{ id: BRANCH_ID, companyId: COMPANY_ID, name: 'Service branch' }],
  },
  correlationId: null,
};

/** A published, runnable definition of one of the four approved codes. */
const definition = (reportCode: string, executable = true) => ({
  reportCode,
  name: reportCode,
  scopeLevel: 'branch',
  exportPermissionCode: null,
  versionNumber: null,
  parameterSchema: {},
  publishedAt: null,
  recordVersion: 0,
  executable,
  source: 'platform',
  titleKey: `reports.${reportCode}.title`,
});

const CATALOGUE = (items: readonly unknown[]) => ({
  status: 'ok' as const,
  data: { items, nextCursor: null, hasMore: false },
  correlationId: null,
});

const ALL_FOUR = contract.OVERVIEW_REPORT_CODES.map((code) => definition(code));

/** The envelope every run answers with, minus the groups the domain publishes. */
const envelope = (reportCode: string) => ({
  reportCode,
  titleKey: `reports.${reportCode}.title`,
  scope: 'branch',
  period: { from: FROM, to: TO, timezone: 'Asia/Amman' },
  generatedAt: '2026-09-12T09:00:00.000Z',
  freshness: 'live',
  columns: [],
  filters: { companyId: COMPANY_ID, branchId: BRANCH_ID },
  branch: { id: BRANCH_ID, name: 'Named by the run' },
  rows: { items: [], nextCursor: null, hasMore: false },
  countsByState: [],
});

/**
 * The groups each of the four datasets publishes, as the run service publishes
 * them: every measure a string, computed over the whole selection.
 */
const GROUPS: Readonly<Record<string, readonly unknown[]>> = {
  work_orders_by_status: [
    { key: { state: 'awaiting_parts' }, label: 'Awaiting parts', measures: { count: '4' } },
  ],
  technician_labor_time: [
    { key: { technician: 'Rami' }, label: 'Rami', measures: { durationSeconds: '5400' } },
  ],
  inventory_movements: [
    {
      key: { item: 'Brake pad', unit: 'piece', movementType: 'receipt' },
      label: null,
      measures: { quantityIn: '12.500', quantityOut: '0.000' },
    },
    {
      key: { item: 'Engine oil', unit: 'litre', movementType: 'issue' },
      label: null,
      measures: { quantityIn: '0.000', quantityOut: '7.250' },
    },
  ],
  invoice_payment_summary: [
    {
      key: { currency: 'JOD', documentType: 'invoice' },
      label: null,
      measures: { invoiced: '1234.5600', outstanding: '200.0000' },
    },
    {
      key: { currency: 'JOD', documentType: 'credit_note' },
      label: null,
      measures: { creditNotes: '50.0000' },
    },
    {
      key: { currency: 'JOD', documentType: 'receipt' },
      label: null,
      measures: { receipts: '900.0000', allocated: '800.0000', unallocated: '100.0000' },
    },
  ],
};

const runOk = (reportCode: string) => ({
  status: 'ok' as const,
  data: { ...envelope(reportCode), groups: GROUPS[reportCode] ?? [] },
  correlationId: `corr-${reportCode}`,
});

/** Answers each of the four codes with its own published groups. */
function allFourPublish() {
  runReport.mockImplementation(async (input: { readonly reportCode: string }) =>
    runOk(input.reportCode)
  );
}

/** The section of one domain, addressed by the report's own name. */
const panel = (reportCode: string, messages: Record<string, string> = EN) =>
  screen.getByRole('region', { name: messages[`reports.${reportCode}.title`] as string });
/** The same section, or null when the overview drew none for it. */
const queryPanel = (reportCode: string, messages: Record<string, string> = EN) =>
  screen.queryByRole('region', { name: messages[`reports.${reportCode}.title`] as string });
/** A context fact, addressed by its own label rather than by position. */
const fact = (key: string) => screen.getByText(EN[key] as string).parentElement as HTMLElement;

beforeEach(() => {
  listReportCatalogue.mockReset();
  readReport.mockReset();
  readReportScopes.mockReset();
  runReport.mockReset();
  PERMISSIONS = [READ];
  readReportScopes.mockResolvedValue(SCOPES);
  listReportCatalogue.mockResolvedValue(CATALOGUE(ALL_FOUR));
  allFourPublish();
});

async function renderOverview(
  locale = 'en',
  search: Record<string, string | string[] | undefined> = {}
) {
  const ui = await OverviewPage({
    params: Promise.resolve({ locale }),
    searchParams: Promise.resolve(search),
  });
  const wrapped = withPickers(ui as React.ReactElement, locale);
  return locale === 'ar' ? renderRtl(wrapped) : renderLtr(wrapped);
}

/**
 * Types a day into a picker, part by part, in the order both catalogues write
 * one (day, month, year). The picker is a group of spin buttons named by its
 * label.
 */
async function typeDay(
  user: ReturnType<typeof userEvent.setup>,
  label: RegExp,
  day: string
): Promise<HTMLElement> {
  const [year, month, date] = day.split('-');
  const group = screen.getByRole('group', { name: label });
  await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
  await user.keyboard(`${date ?? ''}${month ?? ''}${year ?? ''}`);
  return group;
}

/** Names the period and submits. The pair is already the caller's only one. */
async function showOverview(
  locale = 'en',
  search: Record<string, string | string[] | undefined> = {}
) {
  const rendered = await renderOverview(locale, search);
  const user = userEvent.setup();
  const messages = locale === 'ar' ? AR : EN;
  const label = (key: string) => new RegExp(`^${escape(messages[key] as string)}`);
  await typeDay(user, label('reports.run.from'), FROM);
  await typeDay(user, label('reports.run.to'), TO);
  await user.click(
    screen.getByRole('button', { name: messages['reports.overview.show'] as string })
  );
  await waitFor(() =>
    expect(screen.queryByText(messages['reports.overview.idleTitle'] as string)).toBeNull()
  );
  return rendered;
}

describe('the overview decides the permission before it reads anything', () => {
  it('refuses without the report read code, and issues no read at all', async () => {
    PERMISSIONS = [];
    await renderOverview();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(readReportScopes).not.toHaveBeenCalled();
    expect(listReportCatalogue).not.toHaveBeenCalled();
    expect(runReport).not.toHaveBeenCalled();
  });

  it('reads the directory and the catalogue for a caller who holds it', async () => {
    await renderOverview();
    expect(readReportScopes).toHaveBeenCalled();
    expect(listReportCatalogue).toHaveBeenCalled();
    // Still nothing run: the four runs are branch-scoped and wait for a branch
    // and a period.
    expect(runReport).not.toHaveBeenCalled();
    expect(screen.getByText(EN['reports.overview.idleTitle'] as string)).toBeVisible();
  });

  it.each([
    ['denied', 'state.denied.title'],
    ['unavailable', 'state.unavailable.title'],
  ])('draws a %s catalogue read as itself rather than as four empty sections', async (s, key) => {
    listReportCatalogue.mockResolvedValue({ status: s, correlationId: 'corr-cat' });
    await renderOverview();
    expect(screen.getByText(EN[key] as string)).toBeVisible();
    expect(runReport).not.toHaveBeenCalled();
  });

  it('says a caller with no branch has no branch, and runs nothing', async () => {
    readReportScopes.mockResolvedValue({
      status: 'ok',
      data: { companies: [], branches: [] },
      correlationId: null,
    });
    await renderOverview();
    expect(screen.getByText(EN['reports.run.noScopesTitle'] as string)).toBeVisible();
    expect(runReport).not.toHaveBeenCalled();
  });
});

describe('the four approved domains are four runs of their own reports', () => {
  it('runs exactly the four approved codes, once each, asking for one row', async () => {
    await showOverview();
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(4));
    const codes = runReport.mock.calls.map(
      (call) => (call[0] as { reportCode: string }).reportCode
    );
    expect(codes).toEqual([...contract.OVERVIEW_REPORT_CODES]);
    for (const call of runReport.mock.calls) {
      expect(call[0]).toEqual({
        reportCode: expect.any(String),
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        from: FROM,
        to: TO,
        cursor: null,
        // One row, because the overview shows summaries and no rows: the groups
        // are computed over the whole selection and are not a page total.
        limit: 1,
      });
    }
  });

  it('shows the work-order counts the server grouped, as the characters it sent', async () => {
    await showOverview();
    const section = within(await waitFor(() => panel('work_orders_by_status')));
    // The state in the reader's language, not the server's English name.
    expect(section.getByText(EN['workOrders.state.awaiting_parts'] as string)).toBeVisible();
    expect(section.queryByText('Awaiting parts')).toBeNull();
    expect(section.getByText('4')).toBeVisible();
    expect(section.getByText(EN['reports.field.count'] as string)).toBeVisible();
  });

  it('shows recorded labour duration in the seconds the server sent, never in hours', async () => {
    await showOverview();
    const section = within(await waitFor(() => panel('technician_labor_time')));
    expect(section.getByText('5400')).toBeVisible();
    expect(section.getByText(EN['reports.field.durationSeconds'] as string)).toBeVisible();
    // Not divided, not rounded, not turned into another unit.
    expect(section.queryByText('1.5')).toBeNull();
    expect(section.queryByText('90')).toBeNull();
    expect(section.queryByText(/1h/)).toBeNull();
  });

  it('never calls a recorded duration productivity, in either language', async () => {
    // D-19 approves "recorded technician labor duration, without calling it
    // productivity", and forbids inventing performance scores.
    for (const locale of ['en', 'ar']) {
      const messages = locale === 'ar' ? AR : EN;
      const { unmount } = await showOverview(locale);
      const section = await waitFor(() => panel('technician_labor_time', messages));
      const text = (section.textContent ?? '').toLowerCase();
      expect(text.length).toBeGreaterThan(0);
      for (const word of contract.LABOUR_FORBIDDEN_WORDS) {
        expect(text, `${locale}: ${word}`).not.toContain(word.toLowerCase());
      }
      unmount();
    }
  });

  it('keeps stock movements apart by item, unit and kind, and sums nothing', async () => {
    await showOverview();
    const section = within(await waitFor(() => panel('inventory_movements')));
    expect(section.getByText('Brake pad')).toBeVisible();
    expect(section.getByText('Engine oil')).toBeVisible();
    expect(section.getByText('piece')).toBeVisible();
    expect(section.getByText('litre')).toBeVisible();
    expect(section.getByText('12.500')).toBeVisible();
    expect(section.getByText('7.250')).toBeVisible();
    // A cross-item, cross-unit total would be this number. It is nowhere,
    // because adding a piece to a litre is not a measurement.
    expect(section.queryByText('19.750')).toBeNull();
    expect(section.queryByText('19.75')).toBeNull();
  });

  it('keeps the six money measures distinct, each with its own heading', async () => {
    await showOverview();
    const section = within(await waitFor(() => panel('invoice_payment_summary')));
    const headings = section.getAllByRole('columnheader').map((cell) => cell.textContent);
    for (const name of [
      'invoiced',
      'outstanding',
      'creditNotes',
      'receipts',
      'allocated',
      'unallocated',
    ]) {
      expect(headings, name).toContain(EN[`reports.field.${name}`] as string);
    }
    // Six DISTINCT headings: a repeated word would be two measures an operator
    // cannot tell apart.
    const six = new Set(
      ['invoiced', 'outstanding', 'creditNotes', 'receipts', 'allocated', 'unallocated'].map(
        (name) => EN[`reports.field.${name}`] as string
      )
    );
    expect(six.size).toBe(6);
    // Grouped by currency and document kind, and nothing netted across them: the
    // three document kinds are three rows of the one currency, never one row.
    expect(section.getAllByText('JOD')).toHaveLength(3);
    expect(section.getByText('invoice')).toBeVisible();
    expect(section.getByText('credit_note')).toBeVisible();
    expect(section.getByText('receipt')).toBeVisible();
    expect(section.getByText('1234.5600')).toBeVisible();
    expect(section.getByText('50.0000')).toBeVisible();
    expect(section.getByText('100.0000')).toBeVisible();
    expect(section.queryByText('1184.5600')).toBeNull();
    expect(section.queryByText('1284.5600')).toBeNull();
  });

  it('shows an absent measure as absent rather than as a zero', async () => {
    // A credit-note group carries no receipt total. Printing `0` there would say
    // no money was received, which is a measurement nobody took.
    await showOverview();
    const section = within(await waitFor(() => panel('invoice_payment_summary')));
    expect(section.getAllByText(EN['reports.groups.noMeasure'] as string).length).toBeGreaterThan(
      0
    );
  });
});

describe('the period, the zone and the branch travel with the summaries', () => {
  it('states the period, the zone it was resolved in, the branch and how current it is', async () => {
    await showOverview();
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(4));
    // The two days written for reading on the branch's clock, each keeping the
    // day itself as its machine value, and the zone named for a reader with its
    // offset — never the stored identifier, as on the report screen (DF-B5).
    const from = screen.getByTestId('overview-period-from');
    expect(from).toHaveTextContent(formatReportTime(FROM, 'en', 'Asia/Amman'));
    expect(from).toHaveAttribute('dateTime', FROM);
    const to = screen.getByTestId('overview-period-to');
    expect(to).toHaveTextContent(formatReportTime(TO, 'en', 'Asia/Amman'));
    expect(to).toHaveAttribute('dateTime', TO);
    expect(screen.getByTestId('overview-zone')).toHaveTextContent('Jordan Time (GMT+3)');
    expect(screen.queryByText('Asia/Amman')).toBeNull();
    expect(within(fact('reports.context.branch')).getByText('Named by the run')).toBeVisible();
    expect(
      within(fact('reports.context.freshness')).getByText(
        EN['reports.context.freshness.live'] as string
      )
    ).toBeVisible();
    // On the branch's clock (Asia/Amman) and in the reader's format, never raw ISO.
    const readAt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Amman',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date('2026-09-12T09:00:00.000Z'));
    expect(readAt).toContain('12:00');
    expect(within(fact('reports.context.generatedAt')).getByText(readAt)).toBeVisible();
    expect(
      within(fact('reports.context.generatedAt')).queryByText('2026-09-12T09:00:00.000Z')
    ).toBeNull();
  });

  it('names an unrecognised freshness as itself rather than calling it live', async () => {
    runReport.mockImplementation(async (input: { readonly reportCode: string }) => {
      const answer = runOk(input.reportCode);
      return { ...answer, data: { ...answer.data, freshness: 'cached' } };
    });
    const { container } = await showOverview();
    expect(await within(container).findByText('cached')).toBeVisible();
    expect(
      within(container).queryByText(EN['reports.context.freshness.live'] as string)
    ).toBeNull();
  });

  it('links each section to its own report, carrying the branch and the period', async () => {
    await showOverview();
    const section = within(await waitFor(() => panel('work_orders_by_status')));
    const link = section.getByRole('link', { name: EN['reports.overview.openReport'] as string });
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('/en/reports/work_orders_by_status?')).toBe(true);
    const query = new URLSearchParams(href.slice(href.indexOf('?') + 1));
    expect(query.get('companyId')).toBe(COMPANY_ID);
    expect(query.get('branchId')).toBe(BRANCH_ID);
    expect(query.get('from')).toBe(FROM);
    expect(query.get('to')).toBe(TO);
  });
});

describe('a domain that cannot answer says so, and the others still answer', () => {
  it('draws one refused domain as a refusal beside three that answered', async () => {
    runReport.mockImplementation(async (input: { readonly reportCode: string }) =>
      input.reportCode === 'invoice_payment_summary'
        ? { status: 'denied', correlationId: 'corr-denied' }
        : runOk(input.reportCode)
    );
    await showOverview();
    const refused = within(await waitFor(() => panel('invoice_payment_summary')));
    expect(refused.getByText(EN['state.denied.title'] as string)).toBeVisible();
    // The reference the backend logged is the only diagnostic an operator sees.
    expect(refused.getByText(/corr-denied/)).toBeVisible();
    // No zero stands in for the refusal, and nothing in that section is a figure.
    expect(refused.queryByRole('table')).toBeNull();
    expect(refused.queryByText('0')).toBeNull();
    // The other three still show their own numbers.
    expect(within(panel('work_orders_by_status')).getByText('4')).toBeVisible();
    expect(within(panel('technician_labor_time')).getByText('5400')).toBeVisible();
    expect(within(panel('inventory_movements')).getByText('12.500')).toBeVisible();
  });

  it('issues no run for a report the platform cannot run, and says why', async () => {
    listReportCatalogue.mockResolvedValue(
      CATALOGUE([
        definition('work_orders_by_status'),
        definition('technician_labor_time', false),
        definition('inventory_movements'),
        definition('invoice_payment_summary'),
      ])
    );
    await showOverview();
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(3));
    const codes = runReport.mock.calls.map(
      (call) => (call[0] as { reportCode: string }).reportCode
    );
    expect(codes).not.toContain('technician_labor_time');
    const section = within(panel('technician_labor_time'));
    expect(section.getByText(EN['reports.overview.notRunnable'] as string)).toBeVisible();
    expect(section.queryByRole('table')).toBeNull();
  });

  it('draws no section for a domain the catalogue does not publish, and runs nothing for it', async () => {
    listReportCatalogue.mockResolvedValue(CATALOGUE([definition('work_orders_by_status')]));
    await showOverview();
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(1));
    expect(await waitFor(() => panel('work_orders_by_status'))).toBeVisible();
    for (const code of [
      'technician_labor_time',
      'inventory_movements',
      'invoice_payment_summary',
    ]) {
      expect(queryPanel(code), code).toBeNull();
    }
    expect(screen.queryByText(EN['reports.overview.notPublished'] as string)).toBeNull();
  });

  it('says once that no overview report is available when the catalogue holds none of the four, and runs nothing (FD2B)', async () => {
    listReportCatalogue.mockResolvedValue(CATALOGUE([]));
    await showOverview();
    expect(await screen.findByText(EN['reports.overview.noReportsTitle'] as string)).toBeVisible();
    expect(screen.getByText(EN['reports.overview.noReportsBody'] as string)).toBeVisible();
    for (const code of [
      'work_orders_by_status',
      'technician_labor_time',
      'inventory_movements',
      'invoice_payment_summary',
    ]) {
      expect(queryPanel(code), code).toBeNull();
    }
    expect(runReport).not.toHaveBeenCalled();
  });

  it('says it in Arabic too (FD2B)', async () => {
    listReportCatalogue.mockResolvedValue(CATALOGUE([]));
    await showOverview('ar');
    expect(await screen.findByText(AR['reports.overview.noReportsTitle'] as string)).toBeVisible();
    expect(runReport).not.toHaveBeenCalled();
  });

  it('draws no empty-catalogue notice while any of the four is available (FD2B)', async () => {
    listReportCatalogue.mockResolvedValue(CATALOGUE([definition('work_orders_by_status')]));
    await showOverview();
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(EN['reports.overview.noReportsTitle'] as string)).toBeNull();
  });

  it('shows a caller without the finance report neither its title nor its caption (D17)', async () => {
    /*
     * Owner decision D17: a quotation user does not see finance reports. The
     * catalogue such a caller receives holds no invoice-and-payment entry, so the
     * overview draws no panel for it — no heading, no caption, no link into it.
     */
    listReportCatalogue.mockResolvedValue(
      CATALOGUE(ALL_FOUR.filter((entry) => entry.reportCode !== 'invoice_payment_summary'))
    );
    await showOverview();
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(3));
    const codes = runReport.mock.calls.map(
      (call) => (call[0] as { reportCode: string }).reportCode
    );
    expect(codes).not.toContain('invoice_payment_summary');
    expect(await waitFor(() => panel('work_orders_by_status'))).toBeVisible();
    expect(screen.queryByText(EN['reports.invoice_payment_summary.title'] as string)).toBeNull();
    expect(screen.queryByText(EN['reports.overview.caption.invoices'] as string)).toBeNull();
    expect(queryPanel('invoice_payment_summary')).toBeNull();
  });

  it('fabricates no summary when the engine published none', async () => {
    runReport.mockImplementation(async (input: { readonly reportCode: string }) => {
      const answer = runOk(input.reportCode);
      const data: Record<string, unknown> = { ...answer.data };
      delete data['groups'];
      return { ...answer, data };
    });
    await showOverview();
    const section = within(await waitFor(() => panel('inventory_movements')));
    expect(section.getByText(EN['reports.overview.noSummary'] as string)).toBeVisible();
    expect(section.queryByRole('table')).toBeNull();
    // Nothing was derived from the rows, and no zero was drawn in its place.
    expect(section.queryByText('0')).toBeNull();
    expect(section.queryByText('0.000')).toBeNull();
  });

  it('reads the deprecated state counts only for the domain that publishes them', async () => {
    // The envelope `develop` publishes carries `countsByState` and no grouping.
    // Reading it is reading the server's own answer; deriving the other three
    // domains from anything would not be.
    runReport.mockImplementation(async (input: { readonly reportCode: string }) => {
      const answer = runOk(input.reportCode);
      const data: Record<string, unknown> = { ...answer.data };
      delete data['groups'];
      data['countsByState'] = [
        { stateCode: 'awaiting_parts', stateName: 'Awaiting parts', count: 4 },
      ];
      return { ...answer, data };
    });
    await showOverview();
    const counts = within(await waitFor(() => panel('work_orders_by_status')));
    expect(counts.getByText(EN['workOrders.state.awaiting_parts'] as string)).toBeVisible();
    expect(counts.getByText('4')).toBeVisible();
    expect(
      within(panel('invoice_payment_summary')).getByText(EN['reports.overview.noSummary'] as string)
    ).toBeVisible();
  });

  it('says an empty summary is an empty period, not an absent report', async () => {
    runReport.mockImplementation(async (input: { readonly reportCode: string }) => {
      const answer = runOk(input.reportCode);
      return { ...answer, data: { ...answer.data, groups: [] } };
    });
    await showOverview();
    const section = within(await waitFor(() => panel('inventory_movements')));
    expect(section.getByText(EN['reports.overview.noneInPeriod'] as string)).toBeVisible();
    expect(section.queryByText(EN['reports.overview.noSummary'] as string)).toBeNull();
  });
});

describe('the working branch and today answer on arrival (route sweep B3)', () => {
  afterEach(forgetRememberedBranch);

  function renderInContext(snapshot = branchSnapshot(), fixedBranchId: string | null = null) {
    return renderLtr(
      withPickers(
        inBranch(
          <>
            <BranchSwitch to="all" label="everywhere" />
            <ReportOverviewScreen
              locale="en"
              messages={en}
              scopeOptions={SCOPES as never}
              catalogue={CATALOGUE(ALL_FOUR) as never}
              fixedBranchId={fixedBranchId}
            />
          </>,
          { snapshot }
        )
      )
    );
  }

  it('runs the four reports for the working branch over today on arrival', async () => {
    allFourPublish();
    renderInContext();
    const today = dayIn('Asia/Riyadh');
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(4));
    for (const call of runReport.mock.calls) {
      expect(call[0]).toMatchObject({
        companyId: COMPANY_ID,
        branchId: BRANCH_ID,
        from: today,
        to: addDays(today, 1),
      });
    }
    expect(screen.queryByText(EN['reports.overview.idleTitle'] as string)).toBeNull();
  });

  it('under "All my branches" runs nothing and says an overview covers one branch', async () => {
    const user = userEvent.setup();
    renderInContext(
      branchSnapshot([
        { ...OTHER_BRANCH, id: BRANCH_ID },
        { ...OTHER_BRANCH, name: 'Another workshop' },
      ])
    );
    await user.click(screen.getByRole('button', { name: 'everywhere' }));
    expect(await screen.findByText(EN['reports.run.oneBranchNote'] as string)).toBeVisible();
    expect(runReport).not.toHaveBeenCalled();
  });
});

describe('the four reads are spent once per branch and period (route sweep B3 review)', () => {
  /*
   * Each run is an expensive read limited per minute, and the overview issues
   * four at a time. A re-render with the same selection used to issue the four
   * again (the selection was a new object every render), and switching to a
   * branch and back issued them again for figures already on the page.
   */
  afterEach(() => {
    forgetRememberedBranch();
    vi.restoreAllMocks();
  });

  const TWO_SCOPES = {
    status: 'ok' as const,
    data: {
      companies: SCOPES.data.companies,
      branches: [
        { id: BRANCH_ID, companyId: COMPANY_ID, name: 'Service branch' },
        { id: OTHER_BRANCH_ID, companyId: COMPANY_ID, name: 'Second service branch' },
      ],
    },
    correlationId: null,
  };
  const TWO_BRANCHES = branchSnapshot([
    { ...OTHER_BRANCH, id: BRANCH_ID, companyId: COMPANY_ID, name: 'Service branch' },
    { ...OTHER_BRANCH, id: OTHER_BRANCH_ID, companyId: COMPANY_ID, name: 'Second service branch' },
  ]);
  const catalogue = CATALOGUE(ALL_FOUR);

  function tree(published: ReturnType<typeof CATALOGUE> = catalogue) {
    return withPickers(
      inBranch(
        <>
          <BranchSwitch to={BRANCH_ID} label="first" />
          <BranchSwitch to={OTHER_BRANCH_ID} label="second" />
          <ReportOverviewScreen
            locale="en"
            messages={en}
            scopeOptions={TWO_SCOPES as never}
            catalogue={published as never}
          />
        </>,
        { snapshot: TWO_BRANCHES }
      )
    );
  }

  const runsFor = (branchId: string) =>
    runReport.mock.calls.filter((call) => (call[0] as { branchId: string }).branchId === branchId)
      .length;

  it('issues no new run when the screen re-renders with the same selection', async () => {
    allFourPublish();
    const user = userEvent.setup();
    const rendered = renderLtr(tree());
    await user.click(screen.getByRole('button', { name: 'first' }));
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(4));
    await screen.findByRole('region', {
      name: EN['reports.work_orders_by_status.title'] as string,
    });

    rendered.rerender(tree());
    rendered.rerender(tree());
    // Give any effect the re-render scheduled the chance to issue its reads.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runReport).toHaveBeenCalledTimes(4);
  });

  it('shows a branch read in the last minute again instead of reading it again', async () => {
    allFourPublish();
    const user = userEvent.setup();
    renderLtr(tree());

    await user.click(screen.getByRole('button', { name: 'first' }));
    await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(4));
    await user.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() => expect(runsFor(OTHER_BRANCH_ID)).toBe(4));
    await user.click(screen.getByRole('button', { name: 'first' }));

    // The first branch's figures are on screen again, and not one run was spent.
    expect(
      await within(await waitFor(() => panel('work_orders_by_status'))).findByText('4')
    ).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runsFor(BRANCH_ID)).toBe(4);
    expect(runReport).toHaveBeenCalledTimes(8);
  });

  it('reads a branch again once its answers are more than a minute old', async () => {
    allFourPublish();
    const user = userEvent.setup();
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(start);
    renderLtr(tree());

    await user.click(screen.getByRole('button', { name: 'first' }));
    await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(4));
    await user.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() => expect(runsFor(OTHER_BRANCH_ID)).toBe(4));

    clock.mockReturnValue(start + 61_000);
    await user.click(screen.getByRole('button', { name: 'first' }));
    await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(8));
  });

  it('says a throttled section is waiting, with the wait the server advised', async () => {
    runReport.mockImplementation(async (input: { readonly reportCode: string }) =>
      input.reportCode === 'inventory_movements'
        ? {
            status: 'unavailable',
            correlationId: 'corr-429',
            throttled: true,
            retryAfterSeconds: 20,
          }
        : runOk(input.reportCode)
    );
    const user = userEvent.setup();
    renderLtr(tree());
    await user.click(screen.getByRole('button', { name: 'first' }));

    const throttled = within(await waitFor(() => panel('inventory_movements')));
    expect(throttled.getByText(EN['state.unavailable.title'] as string)).toBeVisible();
    expect(
      throttled.getByText(
        (EN['state.throttled.messageWithSeconds'] as string).replace('{seconds}', '20')
      )
    ).toBeVisible();
    // Not a fault: the generic failure is not what the operator is told.
    expect(throttled.queryByText(EN['state.error.title'] as string)).toBeNull();
    expect(within(panel('work_orders_by_status')).getByText('4')).toBeVisible();

    // The wait is enforced, not only reported: inside it nothing is sent, for
    // another branch or for this one again. When the reads go is pinned below.
    await user.click(screen.getByRole('button', { name: 'second' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runsFor(OTHER_BRANCH_ID)).toBe(0);
    await user.click(screen.getByRole('button', { name: 'first' }));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runsFor(BRANCH_ID)).toBe(4);
  });

  it('says a throttled section is waiting, without a figure when none was advised', async () => {
    runReport.mockImplementation(async (input: { readonly reportCode: string }) =>
      input.reportCode === 'inventory_movements'
        ? { status: 'unavailable', correlationId: null, throttled: true, retryAfterSeconds: null }
        : runOk(input.reportCode)
    );
    const user = userEvent.setup();
    renderLtr(tree());
    await user.click(screen.getByRole('button', { name: 'first' }));
    const throttled = within(await waitFor(() => panel('inventory_movements')));
    expect(throttled.getByText(EN['state.throttled.message'] as string)).toBeVisible();
  });

  it.each([
    [
      'a throttled run with no wait advised',
      {
        status: 'unavailable',
        correlationId: 'corr-429',
        throttled: true,
        retryAfterSeconds: null,
      },
    ],
    ['an unavailable run', { status: 'unavailable', correlationId: 'corr-down' }],
    ['a failed run', { status: 'error', correlationId: 'corr-failed' }],
    ['an expired session', { status: 'expired', correlationId: null }],
  ])('does not keep %s: switching away and back reads it again', async (_name, answer) => {
    /*
     * Each of these says "try again" (or "sign in again"), not something about
     * the branch. Kept, a switch back within the minute would show the failure
     * again with no read behind it — the retry it asked for would never happen.
     */
    runReport.mockImplementation(async (input: { readonly reportCode: string }) =>
      input.reportCode === 'inventory_movements' ? answer : runOk(input.reportCode)
    );
    const user = userEvent.setup();
    renderLtr(tree());

    await user.click(screen.getByRole('button', { name: 'first' }));
    await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(4));
    await user.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() => expect(runsFor(OTHER_BRANCH_ID)).toBe(4));
    await user.click(screen.getByRole('button', { name: 'first' }));

    await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(8));
  });

  it('keeps a refusal, which is a fact about the branch, for the minute', async () => {
    runReport.mockImplementation(async (input: { readonly reportCode: string }) =>
      input.reportCode === 'inventory_movements'
        ? { status: 'denied', correlationId: 'corr-denied' }
        : runOk(input.reportCode)
    );
    const user = userEvent.setup();
    renderLtr(tree());

    await user.click(screen.getByRole('button', { name: 'first' }));
    await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(4));
    await user.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() => expect(runsFor(OTHER_BRANCH_ID)).toBe(4));
    await user.click(screen.getByRole('button', { name: 'first' }));

    expect(
      await within(await waitFor(() => panel('inventory_movements'))).findByText(
        EN['state.denied.title'] as string
      )
    ).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runsFor(BRANCH_ID)).toBe(4);
  });

  it('reads again instead of showing a kept answer once the catalogue has changed', async () => {
    /*
     * A grant withdrawn, then the page refreshed: the catalogue that arrives is
     * a different one, and figures read under the old one must not be shown
     * under it from memory.
     */
    allFourPublish();
    const user = userEvent.setup();
    const rendered = renderLtr(tree());

    await user.click(screen.getByRole('button', { name: 'first' }));
    await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(4));
    await user.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() => expect(runsFor(OTHER_BRANCH_ID)).toBe(4));

    const narrower = CATALOGUE(
      ALL_FOUR.filter((entry) => entry.reportCode !== 'invoice_payment_summary')
    );
    rendered.rerender(tree(narrower));
    await waitFor(() => expect(runsFor(OTHER_BRANCH_ID)).toBe(7));

    await user.click(screen.getByRole('button', { name: 'first' }));

    // Read again under the catalogue it is now shown under: three runs, because
    // the withdrawn report is no longer one this caller can run.
    await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(7));
    await waitFor(() => expect(panel('work_orders_by_status')).toBeVisible());
    expect(queryPanel('invoice_payment_summary')).toBeNull();
  });

  describe('the wait the server advised is kept, for every run this page sends', () => {
    /*
     * The server limits the run per operation, tenant and user — every report,
     * every branch and every period share one bucket — so a wait it advised
     * holds for all of them, and the reads go again once it has passed.
     */
    afterEach(() => {
      vi.useRealTimers();
    });

    const THROTTLED = {
      status: 'unavailable',
      correlationId: 'corr-429',
      throttled: true,
      retryAfterSeconds: 20,
    };
    const waitMessage = new RegExp(
      `^${escape(EN['state.throttled.messageWithSeconds'] as string).replace(
        escape('{seconds}'),
        '\\d+'
      )}$`
    );

    it('sends nothing inside the wait, on any branch, and reads once it has passed', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      runReport.mockImplementation(async (input: { readonly reportCode: string }) =>
        input.reportCode === 'inventory_movements' ? THROTTLED : runOk(input.reportCode)
      );
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderLtr(tree());

      await user.click(screen.getByRole('button', { name: 'first' }));
      await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(4));
      await within(await waitFor(() => panel('inventory_movements'))).findByText(waitMessage);

      // Another branch inside the wait: the same bucket, so nothing is sent and
      // every section says it is waiting.
      await user.click(screen.getByRole('button', { name: 'second' }));
      for (const code of contract.OVERVIEW_REPORT_CODES) {
        expect(
          await within(await waitFor(() => panel(code))).findByText(waitMessage),
          code
        ).toBeVisible();
      }
      await vi.advanceTimersByTimeAsync(50);
      expect(runsFor(OTHER_BRANCH_ID)).toBe(0);

      // And back again, still inside it: nothing.
      await user.click(screen.getByRole('button', { name: 'first' }));
      await vi.advanceTimersByTimeAsync(50);
      expect(runsFor(BRANCH_ID)).toBe(4);
      expect(within(panel('work_orders_by_status')).getByText(waitMessage)).toBeVisible();

      // Once it has passed, the selection on screen is read — and only it.
      allFourPublish();
      await vi.advanceTimersByTimeAsync(20_000);
      await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(8));
      expect(runsFor(OTHER_BRANCH_ID)).toBe(0);
      expect(await within(panel('inventory_movements')).findByText('12.500')).toBeVisible();
      expect(screen.queryByText(waitMessage)).toBeNull();
    });

    it('reads again on its own once the wait has passed, without a switch', async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      runReport.mockImplementation(async (input: { readonly reportCode: string }) =>
        input.reportCode === 'inventory_movements' ? THROTTLED : runOk(input.reportCode)
      );
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      renderLtr(tree());

      await user.click(screen.getByRole('button', { name: 'first' }));
      await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(4));
      await within(await waitFor(() => panel('inventory_movements'))).findByText(waitMessage);

      await vi.advanceTimersByTimeAsync(19_000);
      expect(runsFor(BRANCH_ID)).toBe(4);

      allFourPublish();
      await vi.advanceTimersByTimeAsync(1_000);
      await waitFor(() => expect(runsFor(BRANCH_ID)).toBe(8));
      expect(await within(panel('inventory_movements')).findByText('12.500')).toBeVisible();
    });
  });
});

describe('FE-016 fixes the branch from the address, and never from a literal', () => {
  it('fixes both selectors at the named branch and still runs the four reports', async () => {
    await showOverview('en', { branchId: BRANCH_ID });
    const branch = screen.getByRole('combobox', { name: labelled('reports.run.branch') });
    expect(branch).toBeDisabled();
    expect((branch as HTMLSelectElement).value).toBe(BRANCH_ID);
    const company = screen.getByRole('combobox', { name: labelled('reports.run.company') });
    expect(company).toBeDisabled();
    expect((company as HTMLSelectElement).value).toBe(COMPANY_ID);
    expect(screen.getByText(EN['reports.overview.branchFixed'] as string)).toBeVisible();
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(4));
    expect((runReport.mock.calls[0]?.[0] as { branchId: string }).branchId).toBe(BRANCH_ID);
  });

  it('leaves the selectors open when the address names no branch', async () => {
    await renderOverview();
    expect(screen.getByRole('combobox', { name: labelled('reports.run.branch') })).toBeEnabled();
    expect(screen.queryByText(EN['reports.overview.branchFixed'] as string)).toBeNull();
  });

  it('renders the no-branch body for a branch outside the caller’s own directory', async () => {
    // Never a guess and never another branch: whether that branch exists at all
    // is not something this screen may disclose.
    await renderOverview('en', { branchId: OTHER_BRANCH_ID });
    expect(screen.getByText(EN['reports.run.noScopesTitle'] as string)).toBeVisible();
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(runReport).not.toHaveBeenCalled();
  });

  it('takes the first value when the address names a branch twice', async () => {
    await renderOverview('en', { branchId: [BRANCH_ID, OTHER_BRANCH_ID] });
    const branch = screen.getByRole('combobox', { name: labelled('reports.run.branch') });
    expect((branch as HTMLSelectElement).value).toBe(BRANCH_ID);
  });
});

describe('the overview reads in Arabic as Arabic', () => {
  it('renders the sections, the context and the copy from the Arabic catalogue', async () => {
    const { container } = await showOverview('ar');
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(4));
    expect(document.documentElement.dir).toBe('rtl');
    expect(within(container).getByText(AR['reports.overview.serverNote'] as string)).toBeVisible();
    expect(within(container).getByText(AR['reports.context.timezone'] as string)).toBeVisible();
    for (const code of contract.OVERVIEW_REPORT_CODES) {
      expect(panel(code, AR)).toBeVisible();
    }
    // The zone is named in Arabic with its offset, never as the identifier; the
    // exact figures stay as the server sent them in both directions.
    expect(within(container).getByTestId('overview-zone')).toHaveTextContent(
      'توقيت الأردن (غرينتش+3)'
    );
    expect(within(container).queryByText('Asia/Amman')).toBeNull();
    expect(within(panel('technician_labor_time', AR)).getByText('5400')).toBeVisible();
  });
});

describe('the overview contract is the four approved domains and their own measures', () => {
  it('names the four approved codes, in the order the decision lists them', () => {
    expect([...contract.OVERVIEW_REPORT_CODES]).toEqual([
      'work_orders_by_status',
      'technician_labor_time',
      'inventory_movements',
      'invoice_payment_summary',
    ]);
    expect(contract.OVERVIEW_ROW_LIMIT).toBe(1);
  });

  it('names every group key and measure through a message both catalogues hold', () => {
    // A measure whose name has no message would be shown to a receptionist as an
    // identifier. `reports.field.*` is the one namespace all three of a column, a
    // group key and a measure are named by.
    for (const section of contract.OVERVIEW_SECTIONS) {
      for (const name of [...section.keyNames, ...section.measureNames]) {
        const key = contract.overviewFieldKey(name);
        expect(EN[key], `${name} in en`).toBeTypeOf('string');
        expect(AR[key], `${name} in ar`).toBeTypeOf('string');
      }
      expect(EN[section.titleKey], section.reportCode).toBeTypeOf('string');
      expect(EN[section.captionKey], section.captionKey).toBeTypeOf('string');
      expect(AR[section.captionKey], section.captionKey).toBeTypeOf('string');
    }
  });

  it('carries the selection into the report link, encoding every value', () => {
    const href = contract.overviewReportHref('ar', 'invoice_payment_summary', {
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from: FROM,
      to: TO,
    });
    expect(href).toBe(
      `/ar/reports/invoice_payment_summary?companyId=${COMPANY_ID}&branchId=${BRANCH_ID}&from=${FROM}&to=${TO}`
    );
  });
});

describe('the scope form on Material UI (P1-32-PRE-OD-REPA)', () => {
  it('spends the four reads once for two presses inside one moment', async () => {
    await renderOverview();
    const user = userEvent.setup();
    await typeDay(user, labelled('reports.run.from'), FROM);
    await typeDay(user, labelled('reports.run.to'), TO);
    const show = screen.getByRole('button', { name: EN['reports.overview.show'] as string });
    await act(async () => {
      show.click();
      show.click();
    });
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(4));
    await screen.findByTestId('overview-zone');
    expect(runReport).toHaveBeenCalledTimes(4);
  });

  it('shows the overview on Enter in a day, as the native box did', async () => {
    await renderOverview();
    const user = userEvent.setup();
    await typeDay(user, labelled('reports.run.from'), FROM);
    await typeDay(user, labelled('reports.run.to'), TO);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(4));
    expect(runReport).toHaveBeenCalledWith(expect.objectContaining({ from: FROM, to: TO }));
  });

  it('refuses a day only partly typed as unfinished, puts the cursor there, and reads nothing', async () => {
    await renderOverview('ar');
    const user = userEvent.setup();
    const named = (key: string) => new RegExp(`^${escape(AR[key] as string)}`);
    const from = screen.getByRole('group', { name: named('reports.run.from') });
    await user.click(within(from).getAllByRole('spinbutton')[0] as HTMLElement);
    await user.keyboard('0109');
    await typeDay(user, named('reports.run.to'), TO);
    await user.click(screen.getByRole('button', { name: AR['reports.overview.show'] as string }));
    await waitFor(() => expect(from).toHaveAttribute('aria-invalid', 'true'));
    expect(from).toHaveAccessibleDescription(
      new RegExp(escape(AR['reports.run.dayIncomplete'] as string))
    );
    await waitFor(() => expect(from.contains(document.activeElement)).toBe(true));
    expect(runReport).not.toHaveBeenCalled();
  });

  it('draws each summary as a table named by its report, in Arabic too', async () => {
    const { container } = await showOverview('ar');
    await waitFor(() => expect(runReport).toHaveBeenCalledTimes(4));
    const tables = within(container).getAllByRole('table');
    expect(tables.length).toBeGreaterThan(0);
    for (const table of tables) {
      expect(table).toHaveAccessibleName();
    }
    expect(document.documentElement.dir).toBe('rtl');
  });
});
