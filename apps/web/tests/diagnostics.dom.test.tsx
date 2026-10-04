/**
 * P1-29 W7 — the diagnostics screens in the DOM: what each renders from a real
 * response shape, what each offers per capability, and what each REFUSES to
 * invent (a type vocabulary, a checklist, a status move the report does not
 * name). The adapters are mocked at the module boundary; the request they
 * build is proved in `diagnostics-api.test.ts`, the response they receive in
 * `tests/backend/p1-29-w7-diagnostics-experience.test.ts`.
 *
 * On the Material UI wrappers (ADR-022, Owner directive slice 4): the catalogue
 * is `OperationalGrid` (each row's action named with the template), every
 * form is `forms/mui/*`, completing and cancelling a report and publishing or
 * retiring a version are asked first (`ConfirmDialog`), and every status is
 * said in words — the raw codes are held absent.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import { renderLtr, renderRtl } from './render';

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;
/** A message by key, as a string: the catalogue is complete, so a miss is a test defect. */
const t = (key: string): string => EN[key] ?? key;
const arT = (key: string): string => AR[key] ?? key;

/** The product's Material provider, as the locale layout mounts it. */
function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const mount = (ui: ReactElement) => renderLtr(withMui(ui));
const mountAr = (ui: ReactElement) => renderRtl(withMui(ui, 'ar'));

/** The question a decision dialog asks, answered with its own confirm button. */
async function confirmIn(user: ReturnType<typeof userEvent.setup>, testId: string, name: string) {
  const dialog = await screen.findByTestId(testId);
  await user.click(within(dialog).getByRole('button', { name }));
}

/** The report's toggle: "Open", named with the report for assistive technology. */
const openReport = (label = t('diagnostics.job.openReport')) =>
  screen.findByRole('button', { name: new RegExp(`^${label}`) });

/** The field error's own element — the one `aria-describedby` names. */
const errorElement = (text: HTMLElement) => text.closest('[role="alert"]') as HTMLElement;

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
const createVersion = vi.fn();
const setVersionStatus = vi.fn();
const reviewReport = vi.fn();
const updateTemplate = vi.fn();
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
  updateTemplate: (...args: unknown[]) => updateTemplate(...args),
  createVersion: (...args: unknown[]) => createVersion(...args),
  createItem: vi.fn(),
  setVersionStatus: (...args: unknown[]) => setVersionStatus(...args),
  createReport: (...args: unknown[]) => createReport(...args),
  writeItemResult: (...args: unknown[]) => writeItemResult(...args),
  recordMeasurement: vi.fn(),
  recordDtc: vi.fn(),
  recordFinding: vi.fn(),
  recordRecommendation: vi.fn(),
  transitionReport: (...args: unknown[]) => transitionReport(...args),
  completeReport: (...args: unknown[]) => completeReport(...args),
  reviewReport: (...args: unknown[]) => reviewReport(...args),
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
    createVersion,
    setVersionStatus,
    reviewReport,
    updateTemplate,
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
    mount(<TemplateCatalogueScreen locale="en" messages={en} canManage={false} />);
    const link = await screen.findByRole('link', { name: /Brake check/ });
    expect(link).toHaveAttribute('href', `/en/work-orders/diagnostics/${TEMPLATE}`);
    // The row names its type by the type's name, never the reference.
    expect(document.body.textContent).not.toContain('type-1');
    expect(
      screen.queryByRole('heading', { name: t('diagnostics.catalogue.createHeading') })
    ).toBeNull();
  });

  it('with catalogue rights and NO configured type, says so and offers no form', async () => {
    listDiagnosticTypes.mockResolvedValue(ok({ items: [] }));
    listTemplates.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    mount(<TemplateCatalogueScreen locale="en" messages={en} canManage />);
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
    mount(<TemplateCatalogueScreen locale="en" messages={en} canManage />);
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
    mount(<TemplateCatalogueScreen locale="en" messages={en} canManage={false} />);
    // The grid's own refusal: the shared heading and the reference, and no rows.
    expect(await screen.findByText('corr-denied')).toBeInTheDocument();
    expect(screen.getByText(t('state.denied.title'))).toBeInTheDocument();
  });

  it("narrows by status as the read's key, back on page one", async () => {
    listDiagnosticTypes.mockResolvedValue(ok({ items: [] }));
    listTemplates.mockResolvedValue(ok({ items: [], nextCursor: null, hasMore: false }));
    const user = userEvent.setup();
    mount(<TemplateCatalogueScreen locale="en" messages={en} canManage={false} />);
    await screen.findByText(t('diagnostics.catalogue.emptyTitle'));
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${t('diagnostics.catalogue.filterStatus')}`)),
      'inactive'
    );
    await waitFor(() =>
      expect(listTemplates).toHaveBeenLastCalledWith({ status: 'inactive', limit: 25 }, null)
    );
    // "None with this status" — not "none yet", a claim about every template.
    expect(await screen.findByText(t('diagnostics.catalogue.noneMatchingTitle'))).toBeVisible();
  });
});

describe('the template detail', () => {
  it('renders the versions and, opened, the items of one in checklist order', async () => {
    mount(
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
    mount(
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

/**
 * The template's name and status are an EDIT of a stored record
 * (`useEditBaseline`): the baseline's version is the If-Match, a conflict
 * offers "Load the latest version" and discards the stale work, and a save
 * re-bases so the next save sends the version the re-read brought.
 */
describe('the template settings ride the edit baseline', () => {
  const renderSettings = () =>
    mount(
      <TemplateDetailScreen
        locale="en"
        messages={en}
        templateId={TEMPLATE}
        initial={{ template, versions: [] }}
        canManage
      />
    );
  const nameBox = () =>
    screen.getByLabelText(new RegExp(`^${t('diagnostics.catalogue.name')}`)) as HTMLInputElement;

  it('sends the baseline version, and after a save sends the version the re-read brought', async () => {
    updateTemplate.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    readTemplate.mockResolvedValue(
      ok({ template: { ...template, name: 'Brake check v2', recordVersion: 2 }, versions: [] })
    );
    const user = userEvent.setup();
    renderSettings();
    await user.clear(nameBox());
    await user.type(nameBox(), 'Brake check v2');
    await user.click(screen.getByRole('button', { name: t('diagnostics.template.save') }));
    await waitFor(() =>
      expect(updateTemplate).toHaveBeenCalledWith(TEMPLATE, { name: 'Brake check v2' }, 1)
    );
    // The re-read landed: the form is clean on what is stored, at version 2.
    await waitFor(() => expect(readTemplate).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(nameBox().value).toBe('Brake check v2'));
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${t('diagnostics.catalogue.filterStatus')}`)),
      'inactive'
    );
    await user.click(screen.getByRole('button', { name: t('diagnostics.template.save') }));
    await waitFor(() =>
      expect(updateTemplate).toHaveBeenLastCalledWith(TEMPLATE, { status: 'inactive' }, 2)
    );
  });

  /*
   * The baseline's version and the live one DIFFER here: another command's
   * re-read brings the template one version on while a rename is typed. Sending
   * the live `recordVersion` instead of `edit.version` left every other case
   * green, because there the two are the same number (fix round 2, PR #482).
   */
  it('keeps typed work on its baseline version when another command re-reads a newer template', async () => {
    createVersion.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    updateTemplate.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    readTemplate.mockResolvedValue(
      ok({ template: { ...template, recordVersion: 2 }, versions: [draftVersion] })
    );
    const user = userEvent.setup();
    renderSettings();
    await user.clear(nameBox());
    await user.type(nameBox(), 'Brake inspection');
    await user.click(screen.getByRole('button', { name: t('diagnostics.template.newVersion') }));
    await waitFor(() => expect(readTemplate).toHaveBeenCalledTimes(1));
    // The re-read landed (the new version is listed) and the typed name survived it.
    await waitFor(() =>
      expect(screen.queryByText(t('diagnostics.template.noVersions'))).toBeNull()
    );
    expect(nameBox().value).toBe('Brake inspection');
    await user.click(screen.getByRole('button', { name: t('diagnostics.template.save') }));
    await waitFor(() =>
      expect(updateTemplate).toHaveBeenCalledWith(TEMPLATE, { name: 'Brake inspection' }, 1)
    );
  });

  it('says a conflict and offers the latest version, which discards the stale work', async () => {
    updateTemplate.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.message',
      correlationId: 'corr-stale',
      attempt: 1,
    });
    readTemplate.mockResolvedValue(
      ok({ template: { ...template, name: 'Brakes, as renamed', recordVersion: 5 }, versions: [] })
    );
    const user = userEvent.setup();
    renderSettings();
    await user.clear(nameBox());
    await user.type(nameBox(), 'My stale rename');
    await user.click(screen.getByRole('button', { name: t('diagnostics.template.save') }));
    expect(await screen.findByText(t('diagnostics.template.conflict'))).toBeVisible();
    // The typed work survives the refusal until the operator chooses otherwise.
    expect(nameBox().value).toBe('My stale rename');
    await user.click(screen.getByRole('button', { name: t('form.loadLatest') }));
    await waitFor(() => expect(nameBox().value).toBe('Brakes, as renamed'));
    expect(screen.queryByText(t('diagnostics.template.conflict'))).toBeNull();
  });
});

describe('the item form points at what to fix (route sweep B3)', () => {
  it('moves the cursor to the first missing field and withdraws its complaint once it is filled', async () => {
    const user = userEvent.setup();
    mount(
      <TemplateDetailScreen
        locale="en"
        messages={en}
        templateId={TEMPLATE}
        initial={{ template, versions: [draftVersion] }}
        canManage
      />
    );
    const add = await screen.findByRole('button', { name: t('diagnostics.template.addItem') });
    await user.click(add);
    const code = screen.getByLabelText(new RegExp(`^${t('diagnostics.template.itemCode')}`));
    const prompt = screen.getByLabelText(new RegExp(`^${t('diagnostics.template.prompt')}`));
    await waitFor(() => expect(code).toHaveFocus());
    expect(prompt).toHaveAttribute('aria-invalid', 'true');
    await user.type(code, 'pad_depth');
    expect(code).not.toHaveAttribute('aria-invalid', 'true');
    expect(prompt).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('the job workbench', () => {
  it('lists the reports, opens one, and joins the checklist to its results', async () => {
    listJobReports.mockResolvedValue(ok({ items: [report] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    readReport.mockResolvedValue(ok(detail));
    const user = userEvent.setup();
    mount(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: false, canReview: false, canCapture: false }}
      />
    );
    await user.click(await openReport());
    expect(await screen.findByText('Measure the pad depth')).toBeInTheDocument();
    // The answered item shows its answer; the unanswered one says so.
    expect(screen.getByText(`${t('diagnostics.report.answer')}: 24.5`)).toBeInTheDocument();
    expect(screen.getByText(t('diagnostics.report.unanswered'))).toBeInTheDocument();
    // The moves offered are the report's own, said in words, and completion is
    // withheld without the code.
    expect(
      screen.getByRole('button', {
        name: `${t('diagnostics.report.moveTo')} ${t('diagnostics.reportStatus.cancelled')}`,
      })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('diagnostics.report.complete') })).toBeNull();
    // Browser QA row B.S3: no status reaches the page as its code.
    expect(screen.getByTestId('report-status')).toHaveTextContent(
      t('diagnostics.reportStatus.in_progress')
    );
    expect(document.body.textContent).not.toContain('in_progress');
    expect(document.body.textContent).not.toContain(' cancelled');
  });

  it('records an answer to the item by its id and re-reads the report', async () => {
    listJobReports.mockResolvedValue(ok({ items: [report] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    readReport.mockResolvedValue(ok(detail));
    writeItemResult.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    mount(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: false, canReview: false, canCapture: false }}
      />
    );
    await user.click(await openReport());
    const row = (await screen.findByText('Road test performed')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('radio', { name: t('diagnostics.report.yes') }));
    await user.click(within(row).getByRole('button', { name: t('diagnostics.report.record') }));
    await waitFor(() =>
      expect(writeItemResult).toHaveBeenCalledWith(REPORT, ITEM_B, { resultValue: 'true' })
    );
    await waitFor(() => expect(readReport).toHaveBeenCalledTimes(2));
  });

  it('refuses an item with neither an answer nor a reason on the answer, sending nothing', async () => {
    listJobReports.mockResolvedValue(ok({ items: [report] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    readReport.mockResolvedValue(ok(detail));
    const user = userEvent.setup();
    mount(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: false, canReview: false, canCapture: false }}
      />
    );
    await user.click(await openReport());
    const row = (await screen.findByText('Measure the pad depth')).closest('li') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: t('diagnostics.report.record') }));
    const answer = within(row).getByLabelText(new RegExp(`^${t('diagnostics.report.answer')}`));
    await waitFor(() => expect(answer).toHaveAttribute('aria-invalid', 'true'));
    await waitFor(() => expect(answer).toHaveFocus());
    expect(within(row).getByText(t('diagnostics.report.answerOrReason'))).toBeVisible();
    expect(writeItemResult).not.toHaveBeenCalled();
    // Typed, the complaint goes.
    await user.type(answer, '4');
    expect(answer).not.toHaveAttribute('aria-invalid');
  });

  it('completes with the version the detail was rendered from and hands the outcome onward', async () => {
    listJobReports.mockResolvedValue(ok({ items: [report] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    readReport.mockResolvedValue(ok(detail));
    completeReport.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    mount(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: true, canReview: false, canCapture: false }}
      />
    );
    await user.click(await openReport());
    await user.click(await screen.findByRole('button', { name: t('diagnostics.report.complete') }));
    // Asked first: nothing is sent until the question is answered.
    expect(completeReport).not.toHaveBeenCalled();
    await confirmIn(user, 'report-status-confirm', t('diagnostics.report.complete'));
    await waitFor(() => expect(completeReport).toHaveBeenCalledWith(REPORT, {}, 3));
    await waitFor(() => expect(listJobReports).toHaveBeenCalledTimes(2));
  });

  it('without a published template, says a diagnostic cannot start and offers no form', async () => {
    listJobReports.mockResolvedValue(ok({ items: [] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    mount(
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
    mount(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: false, canComplete: false, canReview: false, canCapture: false }}
      />
    );
    expect(await screen.findByText('corr-denied')).toBeInTheDocument();
    expect(screen.getByText(t('state.denied.title'))).toBeInTheDocument();
    expect(listPublishableVersions).not.toHaveBeenCalled();
  });
});

/**
 * Owner directive, user-facing errors: the diagnostics screens say what was
 * refused, where the reader can act on it.
 *
 * `body.copyFromVersionId` and `body.templateVersionId` name controls the two
 * forms have and were not reading. `versionId` and `items.<code>` name no
 * control at all — the first is a button, the second is one violation per
 * unanswered checklist item keyed by the item's own code — so both of those
 * belong in the form alert beside the button that raised them.
 */
describe('the diagnostics screens say why a command was refused', () => {
  it('puts the wrong-checklist refusal beside the copy control and keeps the choice', async () => {
    createVersion.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { copyFromVersionId: 'form.violation.foreign_template' },
      correlationId: 'corr-foreign',
      attempt: 1,
    });
    const user = userEvent.setup();
    mount(
      <TemplateDetailScreen
        locale="en"
        messages={en}
        templateId={TEMPLATE}
        initial={{ template, versions: [draftVersion] }}
        canManage
      />
    );
    const copyFrom = await screen.findByLabelText(
      new RegExp(`^${t('diagnostics.template.copyFrom')}`)
    );
    await user.selectOptions(copyFrom, VERSION);
    await user.click(screen.getByRole('button', { name: t('diagnostics.template.newVersion') }));

    const alert = errorElement(await screen.findByText(t('form.violation.foreign_template')));
    expect(alert).toBeVisible();
    expect(alert.id).not.toBe('');
    const settled = screen.getByLabelText(new RegExp(`^${t('diagnostics.template.copyFrom')}`));
    expect(settled.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    expect((settled as HTMLSelectElement).value).toBe(VERSION);
    expect(document.body.textContent).not.toContain('foreign_template');
  });

  it('lifts the empty-version refusal into the alert beside the publish button', async () => {
    setVersionStatus.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { versionId: 'form.violation.no_items' },
      correlationId: 'corr-empty',
      attempt: 1,
    });
    const user = userEvent.setup();
    mount(
      <TemplateDetailScreen
        locale="en"
        messages={en}
        templateId={TEMPLATE}
        initial={{ template, versions: [draftVersion] }}
        canManage
      />
    );
    await user.click(
      await screen.findByRole('button', { name: t('diagnostics.template.publish') })
    );
    expect(setVersionStatus).not.toHaveBeenCalled();
    await confirmIn(user, 'version-status-confirm', t('diagnostics.template.publish'));

    expect(await screen.findByText(t('form.violation.no_items'))).toBeVisible();
    expect(screen.queryByText(t('diagnostics.template.conflict'))).toBeNull();
    expect(document.body.textContent).not.toContain('no_items');
  });

  it('puts the unpublished-version refusal beside the template control on the workbench', async () => {
    listJobReports.mockResolvedValue(ok({ items: [] }));
    listPublishableVersions.mockResolvedValue(
      ok({
        items: [
          {
            versionId: VERSION,
            templateId: TEMPLATE,
            templateName: 'Brake check',
            versionNumber: 1,
            itemCount: 2,
          },
        ],
      })
    );
    createReport.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { templateVersionId: 'form.violation.not_published' },
      correlationId: 'corr-unpublished',
      attempt: 1,
    });
    const user = userEvent.setup();
    mount(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: false, canReview: false, canCapture: false }}
      />
    );
    await user.selectOptions(
      await screen.findByLabelText(new RegExp(`^${t('diagnostics.job.template')}`)),
      VERSION
    );
    await user.click(screen.getByRole('button', { name: t('diagnostics.job.start') }));

    const alert = errorElement(await screen.findByText(t('form.violation.not_published')));
    expect(alert).toBeVisible();
    expect(alert.id).not.toBe('');
    const settled = screen.getByLabelText(new RegExp(`^${t('diagnostics.job.template')}`));
    expect(settled.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    expect((settled as HTMLSelectElement).value).toBe(VERSION);
  });

  it('lifts the unanswered-items refusal into the alert, since each is keyed by its item code', async () => {
    listJobReports.mockResolvedValue(ok({ items: [report] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    readReport.mockResolvedValue(ok(detail));
    completeReport.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.invalid',
      fieldErrors: {
        pad_depth: 'form.violation.mandatory_item_unresolved',
        road_test: 'form.violation.mandatory_item_unresolved',
      },
      correlationId: 'corr-unresolved',
      attempt: 1,
    });
    const user = userEvent.setup();
    mount(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: true, canReview: false, canCapture: false }}
      />
    );
    await user.click(await openReport());
    await user.click(await screen.findByRole('button', { name: t('diagnostics.report.complete') }));
    await confirmIn(user, 'report-status-confirm', t('diagnostics.report.complete'));

    expect(await screen.findByText(t('form.violation.mandatory_item_unresolved'))).toBeVisible();
    expect(screen.queryByText(t('diagnostics.report.conflict'))).toBeNull();
    expect(document.body.textContent).not.toContain('mandatory_item_unresolved');
  });

  it('reads the unanswered-items refusal in Arabic', async () => {
    listJobReports.mockResolvedValue(ok({ items: [report] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    readReport.mockResolvedValue(ok(detail));
    completeReport.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.invalid',
      fieldErrors: { pad_depth: 'form.violation.mandatory_item_unresolved' },
      correlationId: 'corr-unresolved-ar',
      attempt: 1,
    });
    const user = userEvent.setup();
    mountAr(
      <JobDiagnosticsScreen
        locale="ar"
        messages={ar}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: true, canReview: false, canCapture: false }}
      />
    );
    await user.click(await openReport(arT('diagnostics.job.openReport')));
    await user.click(
      await screen.findByRole('button', { name: arT('diagnostics.report.complete') })
    );
    await confirmIn(user, 'report-status-confirm', arT('diagnostics.report.complete'));

    expect(await screen.findByText(arT('form.violation.mandatory_item_unresolved'))).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('lifts the own-review refusal into the review form alert', async () => {
    listJobReports.mockResolvedValue(ok({ items: [{ ...report, status: 'completed' }] }));
    listPublishableVersions.mockResolvedValue(ok({ items: [] }));
    readReport.mockResolvedValue(
      ok({ ...detail, report: { ...report, status: 'completed' }, nextStatuses: [] })
    );
    reviewReport.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.invalid',
      fieldErrors: { reviewer: 'form.violation.self_review' },
      correlationId: 'corr-self-review',
      attempt: 1,
    });
    const user = userEvent.setup();
    mount(
      <JobDiagnosticsScreen
        locale="en"
        messages={en}
        jobId={JOB}
        capabilities={{ canRecord: true, canComplete: false, canReview: true, canCapture: false }}
      />
    );
    await user.click(await openReport());
    await user.click(
      await screen.findByRole('radio', { name: t('diagnostics.reviewResult.approved') })
    );
    const notes = screen.getByLabelText(new RegExp(`^${t('diagnostics.report.reviewNotes')}`));
    await user.type(notes, 'Checked against the job card');
    await user.click(screen.getByRole('button', { name: t('diagnostics.report.review') }));

    expect(await screen.findByText(t('form.violation.self_review'))).toBeVisible();
    // The note survives, so the reader can hand the same words to a colleague.
    expect((notes as HTMLInputElement).value).toBe('Checked against the job card');
    expect(document.body.textContent).not.toContain('self_review');
  });

  it('leaves a refusal it has not been told about to the generic line', async () => {
    setVersionStatus.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { versionId: 'form.violation.a_rule_this_screen_never_heard_of' },
      correlationId: 'corr-unknown',
      attempt: 1,
    });
    const user = userEvent.setup();
    mount(
      <TemplateDetailScreen
        locale="en"
        messages={en}
        templateId={TEMPLATE}
        initial={{ template, versions: [draftVersion] }}
        canManage
      />
    );
    await user.click(
      await screen.findByRole('button', { name: t('diagnostics.template.publish') })
    );
    await confirmIn(user, 'version-status-confirm', t('diagnostics.template.publish'));

    expect(await screen.findByText(t('form.violation.invalid'))).toBeVisible();
    expect(document.body.textContent).not.toContain('a_rule_this_screen_never_heard_of');
  });
});
