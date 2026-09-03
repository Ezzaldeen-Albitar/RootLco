/**
 * P1-29 W7 — the diagnostics screens in the DOM: what each renders from a real
 * response shape, what each offers per capability, and what each REFUSES to
 * invent (a type vocabulary, a checklist, a status move the report does not
 * name). The adapters are mocked at the module boundary; the request they
 * build is proved in `diagnostics-api.test.ts`, the response they receive in
 * `tests/backend/p1-29-w7-diagnostics-experience.test.ts`.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import { renderLtr } from './render';

const EN = en as Record<string, string>;
/** A message by key, as a string: the catalogue is complete, so a miss is a test defect. */
const t = (key: string): string => EN[key] ?? key;

const listDiagnosticTypes = vi.fn();
const listTemplates = vi.fn();
const readTemplate = vi.fn();
const listVersionItems = vi.fn();
const listPublishableVersions = vi.fn();
const listJobReports = vi.fn();
const readReport = vi.fn();
const readReportHistory = vi.fn();
const createTemplate = vi.fn();
const createReport = vi.fn();
const writeItemResult = vi.fn();
const transitionReport = vi.fn();
const completeReport = vi.fn();
vi.mock('@/features/diagnostics/api', () => ({
  listDiagnosticTypes: () => listDiagnosticTypes(),
  listTemplates: (...args: unknown[]) => listTemplates(...args),
  readTemplate: (...args: unknown[]) => readTemplate(...args),
  listVersionItems: (...args: unknown[]) => listVersionItems(...args),
  listPublishableVersions: (...args: unknown[]) => listPublishableVersions(...args),
  listJobReports: (...args: unknown[]) => listJobReports(...args),
  readReport: (...args: unknown[]) => readReport(...args),
  readReportHistory: (...args: unknown[]) => readReportHistory(...args),
  createTemplate: (...args: unknown[]) => createTemplate(...args),
  updateTemplate: vi.fn(),
  createVersion: vi.fn(),
  createItem: vi.fn(),
  setVersionStatus: vi.fn(),
  createReport: (...args: unknown[]) => createReport(...args),
  writeItemResult: (...args: unknown[]) => writeItemResult(...args),
  recordMeasurement: vi.fn(),
  recordDtc: vi.fn(),
  recordFinding: vi.fn(),
  recordRecommendation: vi.fn(),
  transitionReport: (...args: unknown[]) => transitionReport(...args),
  completeReport: (...args: unknown[]) => completeReport(...args),
  reviewReport: vi.fn(),
  captureReportEvidence: vi.fn(),
}));
vi.mock('@/features/attachments/api', () => ({
  listDocumentCategories: async () => ({ status: 'ok', correlationId: 'c', data: { items: [] } }),
}));
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: () => false,
}));

const { TemplateCatalogueScreen } =
  await import('@/features/diagnostics/components/TemplateCatalogueScreen');
const { TemplateDetailScreen } =
  await import('@/features/diagnostics/components/TemplateDetailScreen');
const { JobDiagnosticsScreen } =
  await import('@/features/diagnostics/components/JobDiagnosticsScreen');

const TEMPLATE = '11111111-1111-4111-8111-111111111111';
const VERSION = '22222222-2222-4222-8222-222222222222';
const JOB = '33333333-3333-4333-8333-333333333333';
const REPORT = '44444444-4444-4444-8444-444444444444';
const ITEM_A = '55555555-5555-4555-8555-555555555555';
const ITEM_B = '66666666-6666-4666-8666-666666666666';

const ok = <T,>(data: T) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const denied = { status: 'denied' as const, correlationId: 'corr-denied' };

const template = {
  id: TEMPLATE,
  code: 'brake_check',
  name: 'Brake check',
  diagnosticTypeId: 'type-1',
  status: 'active',
  createdAt: '2026-09-01T08:00:00.000Z',
  recordVersion: 1,
};
const draftVersion = {
  id: VERSION,
  templateId: TEMPLATE,
  versionNumber: 1,
  status: 'draft',
  publishedAt: null,
  itemCount: 2,
  recordVersion: 1,
};
const items = [
  {
    id: ITEM_A,
    itemCode: 'pad_depth',
    prompt: 'Measure the pad depth',
    responseType: 'numeric',
    unit: 'mm',
    isMandatory: true,
    validationRule: null,
    sequence: 1,
    recordVersion: 1,
  },
  {
    id: ITEM_B,
    itemCode: 'road_test',
    prompt: 'Road test performed',
    responseType: 'boolean',
    unit: null,
    isMandatory: false,
    validationRule: null,
    sequence: 2,
    recordVersion: 1,
  },
];
const report = {
  id: REPORT,
  workOrderId: '77777777-7777-4777-8777-777777777777',
  jobId: JOB,
  templateVersionId: VERSION,
  diagnosticTypeId: 'type-1',
  status: 'in_progress',
  revisionNumber: 1,
  summary: null,
  createdAt: '2026-09-02T08:00:00.000Z',
  recordVersion: 3,
};
const detail = {
  report,
  items: [
    {
      id: 'r1',
      templateItemId: ITEM_A,
      itemCode: 'pad_depth',
      resultValue: '24.5',
      notApplicableReason: null,
      recordVersion: 1,
    },
  ],
  measurements: [],
  dtcs: [],
  findings: [],
  recommendations: [],
  evidence: [],
  reviews: [],
  outstandingMandatory: [],
  nextStatuses: ['completed', 'cancelled'],
};
const history = {
  diagnosticReportId: REPORT,
  origin: { createdAt: '2026-09-02T08:00:00.000Z', createdBy: 'u1', initialStatus: 'draft' },
  transitions: { items: [], nextCursor: null, hasMore: false },
};

beforeEach(() => {
  for (const fn of [
    listDiagnosticTypes,
    listTemplates,
    readTemplate,
    listVersionItems,
    listPublishableVersions,
    listJobReports,
    readReport,
    readReportHistory,
    createTemplate,
    createReport,
    writeItemResult,
    transitionReport,
    completeReport,
  ]) {
    fn.mockReset();
  }
  listVersionItems.mockResolvedValue(ok({ items }));
  readReportHistory.mockResolvedValue(ok(history));
});

describe('the catalogue', () => {
  it('renders the list from the response and links each template to its detail', async () => {
    listDiagnosticTypes.mockResolvedValue(ok({ items: [] }));
    listTemplates.mockResolvedValue(ok({ items: [template], nextCursor: null, hasMore: false }));
    renderLtr(<TemplateCatalogueScreen locale="en" messages={en} canManage={false} />);
    const link = await screen.findByRole('link', { name: 'Brake check' });
    expect(link).toHaveAttribute('href', `/en/work-orders/diagnostics/${TEMPLATE}`);
    expect(
      screen.queryByRole('heading', { name: t('diagnostics.catalogue.createHeading') })
    ).toBeNull();
  });

  it('with catalogue rights and NO configured type, says so and offers no form', async () => {
    listDiagnosticTypes.mockResolvedValue(ok({ items: [] }));
    listTemplates.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    renderLtr(<TemplateCatalogueScreen locale="en" messages={en} canManage />);
    expect(await screen.findByText(t('diagnostics.catalogue.noTypesTitle'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('diagnostics.catalogue.create') })).toBeNull();
    expect(createTemplate).not.toHaveBeenCalled();
  });

  it('creates a template with the chosen type and reloads the list', async () => {
    listDiagnosticTypes.mockResolvedValue(
      ok({
        items: [
          {
            id: 'type-1',
            scope: 'tenant',
            code: 'brakes',
            name: 'Brakes',
            status: 'active',
            recordVersion: 1,
          },
        ],
      })
    );
    listTemplates.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    createTemplate.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    renderLtr(<TemplateCatalogueScreen locale="en" messages={en} canManage />);
    await user.type(
      await screen.findByLabelText(new RegExp(t('diagnostics.catalogue.code'))),
      'brake_check'
    );
    await user.type(
      screen.getByLabelText(new RegExp(`^${t('diagnostics.catalogue.name')}`)),
      'Brake check'
    );
    await user.selectOptions(
      screen.getByLabelText(new RegExp(t('diagnostics.catalogue.type'))),
      'type-1'
    );
    await user.click(screen.getByRole('button', { name: t('diagnostics.catalogue.create') }));
    await waitFor(() =>
      expect(createTemplate).toHaveBeenCalledWith({
        code: 'brake_check',
        name: 'Brake check',
        diagnosticTypeId: 'type-1',
      })
    );
    await waitFor(() => expect(listTemplates).toHaveBeenCalledTimes(2));
  });

  it('shows a refused list as the refusal it was, with its reference', async () => {
    listDiagnosticTypes.mockResolvedValue(ok({ items: [] }));
    listTemplates.mockResolvedValue(denied);
    renderLtr(<TemplateCatalogueScreen locale="en" messages={en} canManage={false} />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('corr-denied');
  });
});

describe('the template detail', () => {
  it('renders the versions and, opened, the items of one in checklist order', async () => {
    renderLtr(
      <TemplateDetailScreen
        locale="en"
        messages={en}
        templateId={TEMPLATE}
        initial={{ template, versions: [draftVersion] }}
        canManage={false}
      />
    );
    expect(screen.getByRole('heading', { name: 'Brake check' })).toBeInTheDocument();
    const list = await screen.findByRole('list', { name: '' }).catch(() => null);
    void list;
    expect(await screen.findByText('Measure the pad depth')).toBeInTheDocument();
    const prompts = screen
      .getAllByText(/Measure the pad depth|Road test performed/)
      .map((e) => e.textContent);
    expect(prompts).toEqual(['Measure the pad depth', 'Road test performed']);
    expect(screen.queryByRole('button', { name: t('diagnostics.template.publish') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('diagnostics.template.addItem') })).toBeNull();
  });

  it('offers authoring on a draft version only to catalogue rights, and not on a published one', async () => {
    renderLtr(
      <TemplateDetailScreen
        locale="en"
        messages={en}
        templateId={TEMPLATE}
        initial={{
          template,
          versions: [
            { ...draftVersion, status: 'published', publishedAt: '2026-09-02T09:00:00.000Z' },
          ],
        }}
        canManage
      />
    );
    await screen.findByText('Measure the pad depth');
    expect(screen.queryByRole('button', { name: t('diagnostics.template.addItem') })).toBeNull();
    expect(
      screen.getByRole('button', { name: t('diagnostics.template.retire') })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('diagnostics.template.publish') })).toBeNull();
  });
});

describe('the job workbench', () => {
  it('lists the reports, opens one, and joins the checklist to its results', async () => {
    listJobReports.mockResolvedValue(ok({ items: [report] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    readReport.mockResolvedValue(ok(detail));
    const user = userEvent.setup();
    renderLtr(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: false, canReview: false, canCapture: false }}
      />
    );
    await user.click(await screen.findByRole('button', { name: t('diagnostics.job.openReport') }));
    expect(await screen.findByText('Measure the pad depth')).toBeInTheDocument();
    // The answered item shows its answer; the unanswered one says so.
    expect(screen.getByText(`${t('diagnostics.report.answer')}: 24.5`)).toBeInTheDocument();
    expect(screen.getByText(t('diagnostics.report.unanswered'))).toBeInTheDocument();
    // The moves offered are the report's own, and completion is withheld without the code.
    expect(screen.getByRole('button', { name: /cancelled/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /in_progress/ })).toBeNull();
    expect(screen.queryByRole('button', { name: t('diagnostics.report.complete') })).toBeNull();
  });

  it('records an answer to the item by its id and re-reads the report', async () => {
    listJobReports.mockResolvedValue(ok({ items: [report] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    readReport.mockResolvedValue(ok(detail));
    writeItemResult.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    renderLtr(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: false, canReview: false, canCapture: false }}
      />
    );
    await user.click(await screen.findByRole('button', { name: t('diagnostics.job.openReport') }));
    const row = (await screen.findByText('Road test performed')).closest('li') as HTMLElement;
    await user.selectOptions(within(row).getByRole('combobox'), 'true');
    await user.click(within(row).getByRole('button', { name: t('diagnostics.report.record') }));
    await waitFor(() =>
      expect(writeItemResult).toHaveBeenCalledWith(REPORT, ITEM_B, { resultValue: 'true' })
    );
    await waitFor(() => expect(readReport).toHaveBeenCalledTimes(2));
  });

  it('completes with the version the detail was rendered from and hands the outcome onward', async () => {
    listJobReports.mockResolvedValue(ok({ items: [report] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    readReport.mockResolvedValue(ok(detail));
    completeReport.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    renderLtr(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: true, canReview: false, canCapture: false }}
      />
    );
    await user.click(await screen.findByRole('button', { name: t('diagnostics.job.openReport') }));
    await user.click(await screen.findByRole('button', { name: t('diagnostics.report.complete') }));
    await waitFor(() => expect(completeReport).toHaveBeenCalledWith(REPORT, {}, 3));
    await waitFor(() => expect(listJobReports).toHaveBeenCalledTimes(2));
  });

  it('without a published template, says a diagnostic cannot start and offers no form', async () => {
    listJobReports.mockResolvedValue(ok({ items: [] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    renderLtr(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: false, canReview: false, canCapture: false }}
      />
    );
    expect(await screen.findByText(t('diagnostics.job.noPublishable'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('diagnostics.job.start') })).toBeNull();
    expect(await screen.findByText(t('diagnostics.job.emptyTitle'))).toBeInTheDocument();
  });

  it('renders a refused report list as the refusal it was', async () => {
    listJobReports.mockResolvedValue(denied);
    renderLtr(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: false, canComplete: false, canReview: false, canCapture: false }}
      />
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('corr-denied');
    expect(listPublishableVersions).not.toHaveBeenCalled();
  });
});
