'use client';

/**
 * A job's diagnostics (P1-29 W7): the reports on one job (`dia.diagnostic-list`),
 * starting one from the versions the backend will accept
 * (`dia.template-version-list-publishable` → `dia.diagnostic-create`), and the
 * workbench of the report that is open — the checklist, measurements, DTCs,
 * findings, recommendations, evidence, the status moves, completion, review and
 * history — each on the operation and permission that owns it.
 *
 * ## The checklist is a JOIN the screen performs
 *
 * `dia.diagnostic-detail` returns RESULTS keyed by `templateItemId`;
 * `dia.template-version-item-list` (W7's one Backend read) returns the
 * version's items in checklist order. The screen renders the items and looks up
 * each one's result, so an unanswered item is visible as unanswered rather than
 * absent, and every answer is addressed to the item's id — never to a code.
 *
 * ## What is offered is what the backend accepts
 *
 * Recording controls appear only while the report's status is one that
 * accepts entries (`draft`, `in_progress`); the status moves offered are the
 * report's own `nextStatuses`; completion needs `dia.diagnostic.complete` and
 * is refused by the backend while a mandatory item is outstanding — the
 * outstanding list is shown for that reason, not hidden. Nothing here edits or
 * deletes an entry, because nothing on the wire does. The version-guarded
 * commands (`transitionReport`, `completeReport`) hand their outcome onward so
 * the record version the screen holds is renewed after every move.
 *
 * ## On the shared Material wrappers (ADR-022, Owner directive slice 4)
 *
 * - Every entry form is `forms/mui/*`: a missing answer is refused on its own
 *   field (red, the sentence beside it, the cursor moved there) where the
 *   forms used to return silently from a press; a refusal from the service
 *   lands on the field it names; what was typed survives a refusal; and typed
 *   work is unsaved work until it is stored.
 * - Every command stays busy until the report has been read again
 *   (`useReread`), so a second press cannot re-send an entry or a stale version.
 * - Completing the report and cancelling it are asked first (`ConfirmDialog`):
 *   neither can be walked back here.
 * - The report's status, every move and every history line are said in words
 *   (browser QA row B.S3); the outstanding items by their prompt; the evidence
 *   category by its name where the platform defines one; and neither a document
 *   nor a reviewer is printed as a reference nobody can read.
 */
import { useCallback, useState } from 'react';
import Button from '@mui/material/Button';
import { listDocumentCategories } from '@/features/attachments/api';
import { documentCategoryLabel } from '@/features/attachments/attachments-contract';
import { CaptureFileField } from '@/features/receptions/components/CaptureFileField';
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { FormNumberField } from '@/components/forms/mui/FormNumberField';
import { FormRadioGroupField } from '@/components/forms/mui/FormRadioGroupField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import { useReread } from '@/lib/api/use-reread';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import {
  captureReportEvidence,
  completeReport,
  createReport,
  listJobReports,
  listPublishableVersions,
  listVersionItems,
  readReport,
  readReportHistory,
  recordDtc,
  recordFinding,
  recordMeasurement,
  recordRecommendation,
  reviewReport,
  transitionReport,
  writeItemResult,
} from '../api';
import {
  unattachedRefusalKey,
  type DiagnosticReportDetail,
  type ReportHistory,
  type TemplateItem,
} from '../diagnostics-contract';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';

const RECORDABLE = new Set(['draft', 'in_progress']);
const REPORT_STATUSES = ['draft', 'in_progress', 'completed', 'cancelled'];
const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
const DISPOSITIONS = ['monitor', 'repair_recommended', 'repair_required', 'no_action'] as const;
const DTC_STATUSES = ['active', 'pending', 'stored', 'cleared'] as const;
const PRIORITIES = ['low', 'medium', 'high'] as const;
const REVIEW_RESULTS = ['approved', 'rejected', 'needs_rework'] as const;
type ReportStatus = 'draft' | 'in_progress' | 'completed' | 'cancelled';

export interface DiagnosticsCapabilities {
  readonly canRecord: boolean;
  readonly canComplete: boolean;
  readonly canReview: boolean;
  readonly canCapture: boolean;
}

/** What a panel is told to re-read with, awaited by the command that asked. */
type Renew = () => Promise<void>;

function problemKeyOf(result: ActionState): string {
  if (result.status === 'conflict') return 'diagnostics.report.conflict';
  return result.messageKey ?? 'action.failed';
}

/** A report status in words; an unknown one keeps its code. */
function statusText(messages: Messages, code: string): string {
  return REPORT_STATUSES.includes(code)
    ? translateDynamic(messages, `diagnostics.reportStatus.${code}`)
    : code;
}

function ReadProblem({
  locale,
  messages,
  state,
  onRetry,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly state: Exclude<ReadState<unknown>, { readonly status: 'ok' }>;
  readonly onRetry: () => void;
}) {
  return (
    <MuiReadFailureState
      messages={messages}
      locale={locale}
      status={state.status}
      correlationId={state.correlationId}
      onRetry={onRetry}
    />
  );
}

function Problem({
  messages,
  problem,
  onReload,
}: {
  readonly messages: Messages;
  readonly problem: string | null;
  readonly onReload?: (() => void) | undefined;
}) {
  if (problem === null) return null;
  return (
    <div className="flex basis-full flex-wrap items-center gap-3">
      <p role="alert" className="text-body text-error">
        {translateDynamic(messages, problem)}
      </p>
      {onReload !== undefined && problem === 'diagnostics.report.conflict' ? (
        <Button type="button" variant="outlined" size="small" onClick={onReload}>
          {translate(messages, 'form.loadLatest')}
        </Button>
      ) : null}
    </div>
  );
}

/** A form's one submit, saying "Working…" while its write — and its re-read — is in flight. */
function Submit({
  messages,
  pending,
  labelKey,
  variant = 'outlined',
  disabled = false,
}: {
  readonly messages: Messages;
  readonly pending: boolean;
  readonly labelKey: string;
  readonly variant?: 'contained' | 'outlined';
  readonly disabled?: boolean;
}) {
  return (
    <Button
      type="submit"
      variant={variant}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
    >
      {pending ? translate(messages, 'form.pending') : translateDynamic(messages, labelKey)}
    </Button>
  );
}

export function JobDiagnosticsScreen({
  locale,
  messages,
  jobId,
  capabilities,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly jobId: string;
  readonly capabilities: DiagnosticsCapabilities;
}) {
  const readReports = useCallback(() => listJobReports(jobId), [jobId]);
  const reports = useReread(readReports);
  const [openReportId, setOpenReportId] = useState<string | null>(null);
  const list = reports.value;

  return (
    <div className="flex flex-col gap-6">
      {capabilities.canRecord ? (
        <StartReportForm
          locale={locale}
          messages={messages}
          jobId={jobId}
          onStarted={reports.reload}
        />
      ) : null}

      <section
        aria-labelledby="reports-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="reports-heading" className="mb-3 text-section-title font-medium text-text-primary">
          {translate(messages, 'diagnostics.job.reportsHeading')}
        </h2>
        {list === null ? (
          <MuiLoadingState messages={messages} variant="inline" />
        ) : list.status !== 'ok' ? (
          <ReadProblem
            locale={locale}
            messages={messages}
            state={list}
            onRetry={() => void reports.reload()}
          />
        ) : list.data.items.length === 0 ? (
          <MuiEmptyState
            messages={messages}
            titleKey="diagnostics.job.emptyTitle"
            descriptionKey="diagnostics.job.emptyBody"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {list.data.items.map((report) => {
              const open = openReportId === report.id;
              const name = `${translate(messages, 'diagnostics.job.report')} ${report.revisionNumber}`;
              return (
                <li key={report.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <span className="text-body font-medium text-text-primary">{name}</span>
                    <span className="text-caption text-text-secondary" data-testid="report-status">
                      {statusText(messages, report.status)}
                    </span>
                    <span className="text-caption text-text-muted">
                      <bdi>{formatDateTime(report.createdAt, locale)}</bdi>
                    </span>
                    <Button
                      type="button"
                      size="small"
                      variant="text"
                      onClick={() => setOpenReportId(open ? null : report.id)}
                      aria-expanded={open}
                      className="ms-auto"
                    >
                      {translate(
                        messages,
                        open ? 'diagnostics.job.closeReport' : 'diagnostics.job.openReport'
                      )}
                      <span className="sr-only"> — {name}</span>
                    </Button>
                  </div>
                  {open ? (
                    <ReportWorkbench
                      locale={locale}
                      messages={messages}
                      reportId={report.id}
                      capabilities={capabilities}
                      onListChanged={reports.reload}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function StartReportForm({
  locale,
  messages,
  jobId,
  onStarted,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly jobId: string;
  readonly onStarted: Renew;
}) {
  const readVersions = useCallback(() => listPublishableVersions(jobId), [jobId]);
  const versions = useReread(readVersions);
  const [templateVersionId, setTemplateVersionId] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * `body.templateVersionId` — the chosen version is not published, so no
   * inspection may be started from it. The sentence belongs beside the control
   * that holds the choice; the choice is kept, so the reader sees what they
   * picked while they pick again.
   */
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors: fieldErrorsRefusalErrors, formRef: fieldErrorsRefusalFormRef } = useHeldRefusal(
    fieldErrors,
    { templateVersionId }
  );
  useUnsavedGuard(templateVersionId !== '', () => {
    setTemplateVersionId('');
    setFieldErrors({});
    setProblem(null);
  });

  const submit = async () => {
    setProblem(null);
    if (templateVersionId.length === 0) {
      setFieldErrors({ templateVersionId: 'field.required' });
      return;
    }
    setFieldErrors({});
    setPending(true);
    try {
      let outcome: ActionState;
      try {
        outcome = await createReport(jobId, { templateVersionId });
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        setTemplateVersionId('');
        await onStarted();
        return;
      }
      setFieldErrors(outcome.fieldErrors ?? {});
      setProblem(problemKeyOf(outcome));
    } finally {
      setPending(false);
    }
  };

  const list = versions.value;

  return (
    <section
      aria-labelledby="start-report-heading"
      className="rounded-lg border border-border bg-surface p-4"
    >
      <h2
        id="start-report-heading"
        className="mb-3 text-section-title font-medium text-text-primary"
      >
        {translate(messages, 'diagnostics.job.startHeading')}
      </h2>
      {list === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : list.status !== 'ok' ? (
        <ReadProblem
          locale={locale}
          messages={messages}
          state={list}
          onRetry={() => void versions.reload()}
        />
      ) : list.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'diagnostics.job.noPublishable')}
        </p>
      ) : (
        <form
          ref={fieldErrorsRefusalFormRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            void submit();
          }}
          className="flex flex-wrap items-start gap-3"
        >
          <FormSelectField
            name="templateVersionId"
            label={translate(messages, 'diagnostics.job.template')}
            value={templateVersionId}
            onChange={setTemplateVersionId}
            options={list.data.items.map((version) => ({
              value: version.versionId,
              label: `${version.templateName} — ${translate(messages, 'diagnostics.template.version')} ${version.versionNumber} (${version.itemCount})`,
            }))}
            placeholder={translate(messages, 'diagnostics.job.chooseTemplate')}
            error={
              fieldErrorsRefusalErrors['templateVersionId']
                ? translateDynamic(messages, fieldErrorsRefusalErrors['templateVersionId'])
                : undefined
            }
            required
          />
          <Submit
            messages={messages}
            pending={pending}
            labelKey="diagnostics.job.start"
            variant="contained"
          />
          <Problem messages={messages} problem={problem} />
        </form>
      )}
    </section>
  );
}

function ReportWorkbench({
  locale,
  messages,
  reportId,
  capabilities,
  onListChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reportId: string;
  readonly capabilities: DiagnosticsCapabilities;
  readonly onListChanged: Renew;
}) {
  const readDetail = useCallback(() => readReport(reportId), [reportId]);
  const report = useReread(readDetail);
  const detail = report.value;
  const versionId = detail?.status === 'ok' ? detail.data.report.templateVersionId : null;
  const readItems = useCallback(() => listVersionItems(versionId ?? ''), [versionId]);
  const items = useReread(versionId === null ? null : readItems);
  const [historyEpoch, setHistoryEpoch] = useState(0);
  const reloadReport = report.reload;

  /** The report read again — and its history with it. */
  const reload = useCallback(async () => {
    await reloadReport();
    setHistoryEpoch((n) => n + 1);
  }, [reloadReport]);
  const changed = useCallback(async () => {
    await Promise.all([reload(), onListChanged()]);
  }, [reload, onListChanged]);

  if (detail === null) {
    return (
      <div className="mt-3">
        <MuiLoadingState messages={messages} variant="inline" />
      </div>
    );
  }
  if (detail.status !== 'ok') {
    return (
      <div className="mt-3">
        <ReadProblem
          locale={locale}
          messages={messages}
          state={detail}
          onRetry={() => void report.reload()}
        />
      </div>
    );
  }

  const data = detail.data;
  const recordable = capabilities.canRecord && RECORDABLE.has(data.report.status);

  return (
    <div className="mt-3 flex flex-col gap-4">
      <Checklist
        locale={locale}
        messages={messages}
        detail={data}
        items={items.value}
        onRetryItems={() => void items.reload()}
        recordable={recordable}
        onChanged={reload}
      />
      <Entries messages={messages} detail={data} />
      {recordable ? (
        <div className="grid gap-4 md:grid-cols-2">
          <MeasurementForm messages={messages} reportId={reportId} onDone={reload} />
          <DtcForm messages={messages} reportId={reportId} onDone={reload} />
          <FindingForm messages={messages} reportId={reportId} onDone={reload} />
          <RecommendationForm messages={messages} reportId={reportId} onDone={reload} />
        </div>
      ) : null}
      <EvidencePanel
        locale={locale}
        messages={messages}
        reportId={reportId}
        detail={data}
        canCapture={recordable && capabilities.canCapture}
        onDone={reload}
      />
      <StatusPanel
        messages={messages}
        reportId={reportId}
        detail={data}
        capabilities={capabilities}
        onDone={changed}
      />
      {capabilities.canReview ? (
        <ReviewForm messages={messages} reportId={reportId} onDone={reload} />
      ) : null}
      <HistoryPanel key={historyEpoch} locale={locale} messages={messages} reportId={reportId} />
    </div>
  );
}

function Checklist({
  locale,
  messages,
  detail,
  items,
  onRetryItems,
  recordable,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: DiagnosticReportDetail;
  readonly items: ReadState<{ readonly items: readonly TemplateItem[] }> | null;
  readonly onRetryItems: () => void;
  readonly recordable: boolean;
  readonly onChanged: Renew;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [pendingItem, setPendingItem] = useState<string | null>(null);

  const answer = async (
    templateItemId: string,
    resultValue: string,
    notApplicableReason: string
  ): Promise<boolean> => {
    setPendingItem(templateItemId);
    setProblem(null);
    try {
      const body =
        notApplicableReason.trim().length > 0
          ? { notApplicableReason: notApplicableReason.trim() }
          : { resultValue: resultValue.trim() };
      let outcome: ActionState;
      try {
        outcome = await writeItemResult(detail.report.id, templateItemId, body);
      } catch {
        setProblem('state.unavailable.message');
        return false;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        await onChanged();
        return true;
      }
      setProblem(problemKeyOf(outcome));
      return false;
    } finally {
      setPendingItem(null);
    }
  };

  return (
    <section aria-labelledby={`checklist-${detail.report.id}`} className="flex flex-col gap-2">
      <h3 id={`checklist-${detail.report.id}`} className="text-body font-medium text-text-primary">
        {translate(messages, 'diagnostics.report.checklistHeading')}
      </h3>
      {detail.outstandingMandatory.length > 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'diagnostics.report.outstanding')}{' '}
          {/* By what the item ASKS, as the checklist below says it. */}
          {detail.outstandingMandatory.map((o) => o.prompt).join(', ')}
        </p>
      ) : null}
      {items === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : items.status !== 'ok' ? (
        <ReadProblem locale={locale} messages={messages} state={items} onRetry={onRetryItems} />
      ) : items.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'diagnostics.template.noItems')}
        </p>
      ) : (
        <ol className="flex flex-col gap-2">
          {items.data.items.map((item) => {
            const result = detail.items.find((r) => r.templateItemId === item.id) ?? null;
            return (
              <li key={item.id} className="rounded-md bg-surface-subtle px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-caption text-text-muted">{item.sequence}.</span>
                  <span className="text-body text-text-primary">
                    <bdi>{item.prompt}</bdi>
                  </span>
                  <span className="text-caption text-text-muted">
                    {translateDynamic(messages, `diagnostics.responseType.${item.responseType}`)}
                    {item.unit ? ` · ${item.unit}` : ''}
                    {item.isMandatory
                      ? ` · ${translate(messages, 'diagnostics.template.mandatory')}`
                      : ''}
                  </span>
                  <span className="ms-auto text-caption text-text-secondary">
                    {result === null
                      ? translate(messages, 'diagnostics.report.unanswered')
                      : result.notApplicableReason !== null
                        ? `${translate(messages, 'diagnostics.report.notApplicable')}: ${result.notApplicableReason}`
                        : `${translate(messages, 'diagnostics.report.answer')}: ${answerText(messages, item, result.resultValue ?? '')}`}
                  </span>
                </div>
                {recordable ? (
                  <ItemAnswerForm
                    messages={messages}
                    item={item}
                    pending={pendingItem === item.id}
                    busy={pendingItem !== null}
                    onSubmit={(value, reason) => answer(item.id, value, reason)}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <Problem messages={messages} problem={problem} onReload={() => void onChanged()} />
    </section>
  );
}

/** A recorded answer as it reads: a yes-or-no in words, anything else as recorded. */
function answerText(messages: Messages, item: TemplateItem, value: string): string {
  if (item.responseType !== 'boolean') return value;
  if (value === 'true') return translate(messages, 'diagnostics.report.yes');
  if (value === 'false') return translate(messages, 'diagnostics.report.no');
  return value;
}

function ItemAnswerForm({
  messages,
  item,
  pending,
  busy,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly item: TemplateItem;
  readonly pending: boolean;
  readonly busy: boolean;
  readonly onSubmit: (resultValue: string, notApplicableReason: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(fieldErrors, { resultValue: value, reason });
  useUnsavedGuard(value.trim().length > 0 || reason.trim().length > 0, () => {
    setValue('');
    setReason('');
    setFieldErrors({});
  });
  const answerError = errors['resultValue']
    ? translateDynamic(messages, errors['resultValue'])
    : undefined;

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) return;
        if (value.trim().length === 0 && reason.trim().length === 0) {
          // Said on the answer, where the cursor is taken; the reason beside it
          // is the other way to answer.
          setFieldErrors({ resultValue: 'diagnostics.report.answerOrReason' });
          return;
        }
        setFieldErrors({});
        void onSubmit(value, reason).then((stored) => {
          if (!stored) return;
          setValue('');
          setReason('');
        });
      }}
      className="mt-2 flex flex-wrap items-start gap-3"
    >
      {item.responseType === 'boolean' ? (
        <FormRadioGroupField
          name={`result-${item.id}`}
          label={translate(messages, 'diagnostics.report.answer')}
          value={value}
          onChange={setValue}
          options={[
            { value: 'true', label: translate(messages, 'diagnostics.report.yes') },
            { value: 'false', label: translate(messages, 'diagnostics.report.no') },
          ]}
          error={answerError}
        />
      ) : item.responseType === 'numeric' ? (
        <FormNumberField
          name={`result-${item.id}`}
          label={translate(messages, 'diagnostics.report.answer')}
          value={value}
          onChange={setValue}
          unit={item.unit ?? undefined}
          unitId={`unit-${item.id}`}
          error={answerError}
        />
      ) : (
        <FormTextField
          name={`result-${item.id}`}
          label={translate(messages, 'diagnostics.report.answer')}
          value={value}
          onChange={setValue}
          error={answerError}
        />
      )}
      <FormTextField
        name={`reason-${item.id}`}
        label={translate(messages, 'diagnostics.report.notApplicableReason')}
        value={reason}
        onChange={setReason}
      />
      <Submit
        messages={messages}
        pending={pending}
        disabled={busy && !pending}
        labelKey="diagnostics.report.record"
      />
    </form>
  );
}

function Entries({
  messages,
  detail,
}: {
  readonly messages: Messages;
  readonly detail: DiagnosticReportDetail;
}) {
  const none = (
    <p className="text-caption text-text-muted">{translate(messages, 'diagnostics.report.none')}</p>
  );
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <section aria-labelledby={`measurements-${detail.report.id}`}>
        <h3
          id={`measurements-${detail.report.id}`}
          className="text-body font-medium text-text-primary"
        >
          {translate(messages, 'diagnostics.report.measurementsHeading')}
        </h3>
        {detail.measurements.length === 0 ? (
          none
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.measurements.map((m) => (
              <li key={m.id} className="text-body text-text-primary">
                <bdi>{m.label}</bdi>:{' '}
                <span dir="ltr">
                  {m.measuredValue} {m.unit}
                </span>
                {m.withinRange === null
                  ? ''
                  : ` · ${translate(messages, m.withinRange ? 'diagnostics.report.withinRange' : 'diagnostics.report.outOfRange')}`}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby={`dtcs-${detail.report.id}`}>
        <h3 id={`dtcs-${detail.report.id}`} className="text-body font-medium text-text-primary">
          {translate(messages, 'diagnostics.report.dtcsHeading')}
        </h3>
        {detail.dtcs.length === 0 ? (
          none
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.dtcs.map((d) => (
              <li key={d.id} className="text-body text-text-primary">
                <code className="font-mono" dir="ltr">
                  {d.code}
                </code>{' '}
                {translateDynamic(messages, `diagnostics.dtcStatus.${d.dtcStatus}`)}
                {d.description ? ` — ${d.description}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby={`findings-${detail.report.id}`}>
        <h3 id={`findings-${detail.report.id}`} className="text-body font-medium text-text-primary">
          {translate(messages, 'diagnostics.report.findingsHeading')}
        </h3>
        {detail.findings.length === 0 ? (
          none
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.findings.map((f) => (
              <li key={f.id} className="text-body text-text-primary">
                {translateDynamic(messages, `diagnostics.severity.${f.severity}`)} ·{' '}
                {translateDynamic(messages, `diagnostics.disposition.${f.disposition}`)} —{' '}
                <bdi>{f.description}</bdi>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby={`recommendations-${detail.report.id}`}>
        <h3
          id={`recommendations-${detail.report.id}`}
          className="text-body font-medium text-text-primary"
        >
          {translate(messages, 'diagnostics.report.recommendationsHeading')}
        </h3>
        {detail.recommendations.length === 0 ? (
          none
        ) : (
          <ul className="flex flex-col gap-1">
            {detail.recommendations.map((r) => (
              <li key={r.id} className="text-body text-text-primary">
                {translateDynamic(messages, `diagnostics.priority.${r.priority}`)} —{' '}
                <bdi>{r.recommendation}</bdi>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The shared settle-and-report of every entry form: pending (through the
 * re-read), the problem, and the refusal's field errors.
 */
function useEntryForm(messages: Messages, onDone: Renew) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const run = async (action: () => Promise<ActionState>): Promise<boolean> => {
    setPending(true);
    setProblem(null);
    setFieldErrors({});
    try {
      let outcome: ActionState;
      try {
        outcome = await action();
      } catch {
        setProblem('state.unavailable.message');
        return false;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        await onDone();
        return true;
      }
      setFieldErrors(outcome.fieldErrors ?? {});
      /*
       * The review refusal names `reviewer`, which is the signed-in user and so
       * is no control on any of these forms; without this its sentence — ask a
       * colleague to review it — was filed under a name nothing renders.
       */
      setProblem(unattachedRefusalKey(outcome.fieldErrors, []) ?? problemKeyOf(outcome));
      return false;
    } finally {
      setPending(false);
    }
  };
  return { pending, problem, fieldErrors, run } as const;
}

/**
 * One entry form's draft, its own refusals and the service's, and the unsaved
 * work it declares until it is stored.
 */
function useEntryDraft<Draft extends Record<string, string>>(
  empty: Draft,
  serverErrors: Readonly<Record<string, string>>
) {
  const [draft, setDraft] = useState<Draft>(empty);
  const [localErrors, setLocalErrors] = useState<Readonly<Record<string, string>>>({});
  const shown = Object.keys(localErrors).length > 0 ? localErrors : serverErrors;
  const { errors, formRef } = useHeldRefusal(shown, draft);
  useUnsavedGuard(
    Object.values(draft).some((value) => value.trim().length > 0),
    () => {
      setDraft(empty);
      setLocalErrors({});
    }
  );
  return {
    draft,
    set: (field: keyof Draft & string) => (value: string) =>
      setDraft((current) => ({ ...current, [field]: value })),
    reset: () => setDraft(empty),
    /** Refuses the missing fields, and says whether anything was missing. */
    refuseMissing: (fields: readonly (keyof Draft & string)[]): boolean => {
      const missing: Record<string, string> = {};
      for (const field of fields) {
        if ((draft[field] ?? '').trim().length === 0) missing[field] = 'field.required';
      }
      setLocalErrors(missing);
      return Object.keys(missing).length > 0;
    },
    errors,
    formRef,
  };
}

const FORM_FRAME = 'grid gap-3 rounded-md border border-dashed border-border p-3 content-start';

function MeasurementForm({
  messages,
  reportId,
  onDone,
}: {
  readonly messages: Messages;
  readonly reportId: string;
  readonly onDone: Renew;
}) {
  const { pending, problem, fieldErrors, run } = useEntryForm(messages, onDone);
  const { draft, set, reset, refuseMissing, errors, formRef } = useEntryDraft(
    { label: '', measuredValue: '', unit: '' },
    fieldErrors
  );
  const errorFor = (field: string) =>
    errors[field] ? translateDynamic(messages, errors[field]) : undefined;
  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || refuseMissing(['label', 'measuredValue', 'unit'])) return;
        void run(() =>
          recordMeasurement(reportId, {
            label: draft.label.trim(),
            measuredValue: draft.measuredValue.trim(),
            unit: draft.unit.trim(),
          })
        ).then((ok) => {
          if (ok) reset();
        });
      }}
      className={FORM_FRAME}
    >
      <span className="text-caption font-medium text-text-secondary">
        {translate(messages, 'diagnostics.report.addMeasurement')}
      </span>
      <FormTextField
        name="label"
        label={translate(messages, 'diagnostics.report.measurementLabel')}
        value={draft.label}
        onChange={set('label')}
        error={errorFor('label')}
        required
      />
      <FormNumberField
        name="measuredValue"
        label={translate(messages, 'diagnostics.report.measuredValue')}
        value={draft.measuredValue}
        onChange={set('measuredValue')}
        error={errorFor('measuredValue')}
        required
      />
      <FormTextField
        name="unit"
        label={translate(messages, 'diagnostics.template.unit')}
        value={draft.unit}
        onChange={set('unit')}
        error={errorFor('unit')}
        dir="ltr"
        required
      />
      <div className="flex flex-wrap items-center gap-3">
        <Submit messages={messages} pending={pending} labelKey="diagnostics.report.record" />
        <Problem messages={messages} problem={problem} />
      </div>
    </form>
  );
}

function DtcForm({
  messages,
  reportId,
  onDone,
}: {
  readonly messages: Messages;
  readonly reportId: string;
  readonly onDone: Renew;
}) {
  const { pending, problem, fieldErrors, run } = useEntryForm(messages, onDone);
  const { draft, set, reset, refuseMissing, errors, formRef } = useEntryDraft(
    { code: '', dtcStatus: '', description: '' },
    fieldErrors
  );
  const errorFor = (field: string) =>
    errors[field] ? translateDynamic(messages, errors[field]) : undefined;
  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || refuseMissing(['code'])) return;
        const { code, dtcStatus, description } = draft;
        void run(() =>
          recordDtc(reportId, {
            code: code.trim(),
            ...(description.trim().length > 0 ? { description: description.trim() } : {}),
            ...(dtcStatus ? { dtcStatus: dtcStatus as (typeof DTC_STATUSES)[number] } : {}),
          })
        ).then((ok) => {
          if (ok) reset();
        });
      }}
      className={FORM_FRAME}
    >
      <span className="text-caption font-medium text-text-secondary">
        {translate(messages, 'diagnostics.report.addDtc')}
      </span>
      <FormTextField
        name="code"
        label={translate(messages, 'diagnostics.report.dtcCode')}
        value={draft.code}
        onChange={set('code')}
        error={errorFor('code')}
        dir="ltr"
        autoComplete="off"
        required
      />
      <FormSelectField
        name="dtcStatus"
        label={translate(messages, 'diagnostics.report.dtcStatus')}
        value={draft.dtcStatus}
        onChange={set('dtcStatus')}
        options={DTC_STATUSES.map((value) => ({
          value,
          label: translate(messages, `diagnostics.dtcStatus.${value}`),
        }))}
        placeholder={translate(messages, 'diagnostics.report.dtcStatusDefault')}
        error={errorFor('dtcStatus')}
      />
      <FormTextField
        name="description"
        label={translate(messages, 'diagnostics.report.description')}
        value={draft.description}
        onChange={set('description')}
        error={errorFor('description')}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Submit messages={messages} pending={pending} labelKey="diagnostics.report.record" />
        <Problem messages={messages} problem={problem} />
      </div>
    </form>
  );
}

function FindingForm({
  messages,
  reportId,
  onDone,
}: {
  readonly messages: Messages;
  readonly reportId: string;
  readonly onDone: Renew;
}) {
  const { pending, problem, fieldErrors, run } = useEntryForm(messages, onDone);
  const { draft, set, reset, refuseMissing, errors, formRef } = useEntryDraft(
    { severity: '', disposition: '', description: '' },
    fieldErrors
  );
  const errorFor = (field: string) =>
    errors[field] ? translateDynamic(messages, errors[field]) : undefined;
  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || refuseMissing(['severity', 'disposition', 'description'])) return;
        const { severity, disposition, description } = draft;
        void run(() =>
          recordFinding(reportId, {
            severity: severity as (typeof SEVERITIES)[number],
            disposition: disposition as (typeof DISPOSITIONS)[number],
            description: description.trim(),
          })
        ).then((ok) => {
          if (ok) reset();
        });
      }}
      className={FORM_FRAME}
    >
      <span className="text-caption font-medium text-text-secondary">
        {translate(messages, 'diagnostics.report.addFinding')}
      </span>
      <FormSelectField
        name="severity"
        label={translate(messages, 'diagnostics.report.severity')}
        value={draft.severity}
        onChange={set('severity')}
        options={SEVERITIES.map((value) => ({
          value,
          label: translate(messages, `diagnostics.severity.${value}`),
        }))}
        placeholder={translate(messages, 'diagnostics.report.chooseSeverity')}
        error={errorFor('severity')}
        required
      />
      <FormSelectField
        name="disposition"
        label={translate(messages, 'diagnostics.report.disposition')}
        value={draft.disposition}
        onChange={set('disposition')}
        options={DISPOSITIONS.map((value) => ({
          value,
          label: translate(messages, `diagnostics.disposition.${value}`),
        }))}
        placeholder={translate(messages, 'diagnostics.report.chooseDisposition')}
        error={errorFor('disposition')}
        required
      />
      <FormTextField
        name="description"
        label={translate(messages, 'diagnostics.report.description')}
        value={draft.description}
        onChange={set('description')}
        error={errorFor('description')}
        multiline
        rows={2}
        required
      />
      <div className="flex flex-wrap items-center gap-3">
        <Submit messages={messages} pending={pending} labelKey="diagnostics.report.record" />
        <Problem messages={messages} problem={problem} />
      </div>
    </form>
  );
}

function RecommendationForm({
  messages,
  reportId,
  onDone,
}: {
  readonly messages: Messages;
  readonly reportId: string;
  readonly onDone: Renew;
}) {
  const { pending, problem, fieldErrors, run } = useEntryForm(messages, onDone);
  const { draft, set, reset, refuseMissing, errors, formRef } = useEntryDraft(
    { recommendation: '', priority: '' },
    fieldErrors
  );
  const errorFor = (field: string) =>
    errors[field] ? translateDynamic(messages, errors[field]) : undefined;
  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || refuseMissing(['recommendation'])) return;
        const { recommendation, priority } = draft;
        void run(() =>
          recordRecommendation(reportId, {
            recommendation: recommendation.trim(),
            ...(priority ? { priority: priority as (typeof PRIORITIES)[number] } : {}),
          })
        ).then((ok) => {
          if (ok) reset();
        });
      }}
      className={FORM_FRAME}
    >
      <span className="text-caption font-medium text-text-secondary">
        {translate(messages, 'diagnostics.report.addRecommendation')}
      </span>
      <FormTextField
        name="recommendation"
        label={translate(messages, 'diagnostics.report.recommendation')}
        value={draft.recommendation}
        onChange={set('recommendation')}
        error={errorFor('recommendation')}
        multiline
        rows={2}
        required
      />
      <FormSelectField
        name="priority"
        label={translate(messages, 'diagnostics.report.priority')}
        value={draft.priority}
        onChange={set('priority')}
        options={PRIORITIES.map((value) => ({
          value,
          label: translate(messages, `diagnostics.priority.${value}`),
        }))}
        placeholder={translate(messages, 'diagnostics.report.priorityDefault')}
        error={errorFor('priority')}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Submit messages={messages} pending={pending} labelKey="diagnostics.report.record" />
        <Problem messages={messages} problem={problem} />
      </div>
    </form>
  );
}

/**
 * Evidence on the report: the file goes up through ONE Server Action that takes
 * the form's data (`captureReportEvidence`), so this is the one form here that
 * keeps `action={…}`. React resets such a form's DOM once the action settles,
 * so every control carries the epoch shape — a `key` that moves with each
 * settlement — and is controlled, so the remount shows exactly what the state
 * holds: the operator's entries after a refusal, nothing after a success.
 */
function EvidencePanel({
  locale,
  messages,
  reportId,
  detail,
  canCapture,
  onDone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reportId: string;
  readonly detail: DiagnosticReportDetail;
  readonly canCapture: boolean;
  readonly onDone: Renew;
}) {
  const categories = useReread(canCapture ? listDocumentCategories : null);
  const [categoryCode, setCategoryCode] = useState('');
  const [evidenceType, setEvidenceType] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  // Question f: the cursor goes to the first refused field, and a complaint
  // goes once its field changes (route sweep B3).
  const { errors: fieldErrorsRefusalErrors, formRef: fieldErrorsRefusalFormRef } = useHeldRefusal(
    fieldErrors,
    { categoryCode, evidenceType, note }
  );
  /** Moves with every settled capture: the controls remount on the state. */
  const [attempt, setAttempt] = useState(0);
  useUnsavedGuard(
    categoryCode !== '' || evidenceType.trim().length > 0 || note.trim().length > 0,
    () => {
      setCategoryCode('');
      setEvidenceType('');
      setNote('');
      setFieldErrors({});
      setAttempt((n) => n + 1);
    }
  );

  const read = categories.value;
  const list = read?.status === 'ok' ? read.data.items : null;
  const category = list?.find((each) => each.categoryCode === categoryCode);
  const errorFor = (name: string): string | undefined => {
    const key = fieldErrorsRefusalErrors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const capture = async (formData: FormData) => {
    const missing: Record<string, string> = {};
    if (categoryCode === '') missing['categoryCode'] = 'field.required';
    if (evidenceType.trim().length === 0) missing['evidenceType'] = 'field.required';
    if (Object.keys(missing).length > 0) {
      setFieldErrors(missing);
      setAttempt((n) => n + 1);
      return;
    }
    setPending(true);
    setProblem(null);
    setFieldErrors({});
    try {
      let outcome: Awaited<ReturnType<typeof captureReportEvidence>>;
      try {
        outcome = await captureReportEvidence(reportId, formData);
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        setCategoryCode('');
        setEvidenceType('');
        setNote('');
        await onDone();
        return;
      }
      if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);
      setProblem(
        outcome.stage === undefined
          ? (outcome.messageKey ?? 'action.failed')
          : 'diagnostics.report.capturedPartial'
      );
    } finally {
      setPending(false);
      setAttempt((n) => n + 1);
    }
  };

  return (
    <section aria-labelledby={`evidence-${reportId}`} className="flex flex-col gap-2">
      <h3 id={`evidence-${reportId}`} className="text-body font-medium text-text-primary">
        {translate(messages, 'diagnostics.report.evidenceHeading')}
      </h3>
      {canCapture ? (
        read === null ? (
          <MuiLoadingState messages={messages} variant="inline" />
        ) : list === null || list.length === 0 ? (
          <p className="text-body text-text-secondary">
            {translate(messages, 'diagnostics.report.noCategories')}
          </p>
        ) : (
          <form
            ref={fieldErrorsRefusalFormRef}
            noValidate
            action={capture}
            className="flex flex-wrap items-start gap-3"
          >
            <FormSelectField
              key={`categoryCode-${attempt}`}
              name="categoryCode"
              label={translate(messages, 'diagnostics.report.evidenceCategory')}
              value={categoryCode}
              onChange={setCategoryCode}
              options={list.map((each) => ({
                value: each.categoryCode,
                label: documentCategoryLabel(each.categoryCode, (key) =>
                  translateDynamic(messages, key)
                ),
              }))}
              placeholder={translate(messages, 'diagnostics.report.evidenceCategory')}
              error={errorFor('categoryCode')}
              required
            />
            <FormTextField
              key={`evidenceType-${attempt}`}
              name="evidenceType"
              label={translate(messages, 'diagnostics.report.evidenceType')}
              description={translate(messages, 'diagnostics.report.evidenceTypeHint')}
              value={evidenceType}
              onChange={setEvidenceType}
              error={errorFor('evidenceType')}
              required
            />
            <FormTextField
              key={`note-${attempt}`}
              name="note"
              label={translate(messages, 'diagnostics.report.evidenceNote')}
              value={note}
              onChange={setNote}
              error={errorFor('note')}
            />
            <CaptureFileField
              name="evidenceFile"
              label={translate(messages, 'diagnostics.report.chooseFile')}
              accept={category?.allowedContentTypes}
            />
            <Submit
              messages={messages}
              pending={pending}
              labelKey="diagnostics.report.attach"
              variant="contained"
            />
            {errorFor('evidenceFile') ? (
              <p role="alert" className="basis-full text-body text-error">
                {errorFor('evidenceFile')}
              </p>
            ) : null}
            <Problem messages={messages} problem={problem} />
          </form>
        )
      ) : null}
      {detail.evidence.length === 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'diagnostics.report.none')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {detail.evidence.map((item) => (
            <li key={item.id} className="text-body text-text-primary">
              <bdi>{item.evidenceType}</bdi>
              {item.note === null ? null : (
                <>
                  {' — '}
                  <bdi>{item.note}</bdi>
                </>
              )}
              <span className="text-caption text-text-muted">
                {' · '}
                <bdi>{formatDateTime(item.createdAt, locale)}</bdi>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusPanel({
  messages,
  reportId,
  detail,
  capabilities,
  onDone,
}: {
  readonly messages: Messages;
  readonly reportId: string;
  readonly detail: DiagnosticReportDetail;
  readonly capabilities: DiagnosticsCapabilities;
  readonly onDone: Renew;
}) {
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [asking, setAsking] = useState<ReportStatus | null>(null);
  const version = detail.report.recordVersion;
  const moves = capabilities.canRecord ? detail.nextStatuses.filter((s) => s !== 'completed') : [];
  const canComplete = capabilities.canComplete && detail.nextStatuses.includes('completed');
  useUnsavedGuard(reason.trim().length > 0 || summary.trim().length > 0, () => {
    setReason('');
    setSummary('');
  });

  /*
   * Both commands are version-guarded: the `If-Match` is the version this panel
   * was rendered from, and after either one the record has moved. `onDone`
   * re-reads the detail (and the list), so the next command carries the renewed
   * version rather than the one this panel can no longer vouch for — and the
   * buttons wait for that re-read before they are offered again.
   */
  const move = async (toStatus: ReportStatus) => {
    setPending(true);
    setProblem(null);
    try {
      let outcome: ActionState;
      try {
        outcome = await transitionReport(
          reportId,
          { toStatus, ...(reason.trim().length > 0 ? { reason: reason.trim() } : {}) },
          version
        );
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        setReason('');
        await onDone();
        return;
      }
      setProblem(problemKeyOf(outcome));
    } finally {
      setPending(false);
      setAsking(null);
    }
  };

  const complete = async () => {
    setPending(true);
    setProblem(null);
    try {
      let outcome: ActionState;
      try {
        outcome = await completeReport(
          reportId,
          summary.trim().length > 0 ? { summary: summary.trim() } : {},
          version
        );
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        setSummary('');
        await onDone();
        return;
      }
      /*
       * Completion is refused one violation per unanswered required item, keyed
       * by the item's own code — no control on this panel is named after a
       * checklist item, so the sentence telling the technician to answer them
       * first had nowhere to appear. It is shown here, beside the button that
       * raised it.
       */
      setProblem(unattachedRefusalKey(outcome.fieldErrors, []) ?? problemKeyOf(outcome));
    } finally {
      setPending(false);
      setAsking(null);
    }
  };

  return (
    <section aria-labelledby={`status-${reportId}`} className="flex flex-col gap-2">
      <h3 id={`status-${reportId}`} className="text-body font-medium text-text-primary">
        {translate(messages, 'diagnostics.report.statusHeading')}:{' '}
        <span data-testid="report-status-now">{statusText(messages, detail.report.status)}</span>
      </h3>
      {detail.report.summary ? (
        <p className="text-body text-text-primary">
          <bdi>{detail.report.summary}</bdi>
        </p>
      ) : null}
      {moves.length > 0 || canComplete ? (
        <div className="flex flex-wrap items-start gap-3">
          <FormTextField
            name={`reason-${reportId}`}
            label={translate(messages, 'diagnostics.report.reason')}
            value={reason}
            onChange={setReason}
          />
          {moves.map((toStatus) => (
            <Button
              key={toStatus}
              type="button"
              variant="outlined"
              disabled={pending}
              onClick={() => {
                // Cancelling ends the report: asked first. Any other move is a step.
                if (toStatus === 'cancelled') setAsking('cancelled');
                else void move(toStatus as ReportStatus);
              }}
            >
              {translate(messages, 'diagnostics.report.moveTo')} {statusText(messages, toStatus)}
            </Button>
          ))}
          {canComplete ? (
            <>
              <FormTextField
                name={`summary-${reportId}`}
                label={translate(messages, 'diagnostics.report.summary')}
                value={summary}
                onChange={setSummary}
              />
              <Button
                type="button"
                variant="contained"
                disabled={pending}
                aria-busy={pending || undefined}
                onClick={() => setAsking('completed')}
              >
                {translate(messages, 'diagnostics.report.complete')}
              </Button>
            </>
          ) : null}
          <Problem messages={messages} problem={problem} onReload={() => void onDone()} />
        </div>
      ) : null}
      {detail.reviews.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {detail.reviews.map((review) => (
            <li key={review.id} className="text-body text-text-primary">
              {translateDynamic(messages, `diagnostics.reviewResult.${review.reviewResult}`)}
              {review.notes ? ` — ${review.notes}` : ''}
            </li>
          ))}
        </ul>
      ) : null}
      <ConfirmDialog
        open={asking !== null}
        onCancel={() => setAsking(null)}
        onConfirm={() => {
          if (asking === 'completed') void complete();
          else if (asking !== null) void move(asking);
        }}
        title={translate(
          messages,
          asking === 'completed'
            ? 'diagnostics.report.confirmCompleteTitle'
            : 'diagnostics.report.confirmCancelTitle'
        )}
        description={translate(
          messages,
          asking === 'completed'
            ? 'diagnostics.report.confirmCompleteBody'
            : 'diagnostics.report.confirmCancelBody'
        )}
        confirmLabel={
          asking === 'completed'
            ? translate(messages, 'diagnostics.report.complete')
            : `${translate(messages, 'diagnostics.report.moveTo')} ${statusText(messages, 'cancelled')}`
        }
        messages={messages}
        destructive={asking === 'cancelled'}
        pending={pending}
        testId="report-status-confirm"
      />
    </section>
  );
}

function ReviewForm({
  messages,
  reportId,
  onDone,
}: {
  readonly messages: Messages;
  readonly reportId: string;
  readonly onDone: Renew;
}) {
  const { pending, problem, fieldErrors, run } = useEntryForm(messages, onDone);
  const { draft, set, reset, refuseMissing, errors, formRef } = useEntryDraft(
    { reviewResult: '', notes: '' },
    fieldErrors
  );
  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (pending || refuseMissing(['reviewResult'])) return;
        const { reviewResult, notes } = draft;
        void run(() =>
          reviewReport(reportId, {
            reviewResult: reviewResult as (typeof REVIEW_RESULTS)[number],
            ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
          })
        ).then((ok) => {
          if (ok) reset();
        });
      }}
      className="flex flex-wrap items-start gap-3 rounded-md border border-dashed border-border p-3"
    >
      <span className="basis-full text-caption font-medium text-text-secondary">
        {translate(messages, 'diagnostics.report.reviewHeading')}
      </span>
      <FormRadioGroupField
        name={`reviewResult-${reportId}`}
        label={translate(messages, 'diagnostics.report.reviewResult')}
        value={draft.reviewResult}
        onChange={set('reviewResult')}
        options={REVIEW_RESULTS.map((value) => ({
          value,
          label: translate(messages, `diagnostics.reviewResult.${value}`),
        }))}
        required
        error={
          errors['reviewResult'] ? translateDynamic(messages, errors['reviewResult']) : undefined
        }
      />
      <FormTextField
        name={`reviewNotes-${reportId}`}
        label={translate(messages, 'diagnostics.report.reviewNotes')}
        value={draft.notes}
        onChange={set('notes')}
      />
      <Submit
        messages={messages}
        pending={pending}
        labelKey="diagnostics.report.review"
        variant="contained"
      />
      <Problem messages={messages} problem={problem} />
    </form>
  );
}

/**
 * The report's status history, a cursor page at a time. The workbench remounts
 * it (`key`) whenever the report is read again, so the first page is always
 * the newest.
 */
function HistoryPanel({
  locale,
  messages,
  reportId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reportId: string;
}) {
  const readFirst = useCallback(() => readReportHistory(reportId, null), [reportId]);
  const first = useReread(readFirst);
  const [more, setMore] = useState<{
    readonly source: typeof readFirst;
    readonly pages: readonly ReportHistory['transitions'][];
  } | null>(null);
  const [loading, setLoading] = useState(false);

  const firstRead = first.value;
  const pages = [
    ...(firstRead?.status === 'ok' ? [firstRead.data.transitions] : []),
    ...(more !== null && more.source === readFirst ? more.pages : []),
  ];
  const last = pages.at(-1) ?? null;
  const loadMore = async () => {
    if (last === null || !last.hasMore || last.nextCursor === null || loading) return;
    setLoading(true);
    try {
      const next = await readReportHistory(reportId, last.nextCursor);
      if (next.status === 'ok') {
        setMore((current) => ({
          source: readFirst,
          pages: [
            ...(current !== null && current.source === readFirst ? current.pages : []),
            next.data.transitions,
          ],
        }));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <section aria-labelledby={`history-${reportId}`} className="flex flex-col gap-2">
      <h3 id={`history-${reportId}`} className="text-body font-medium text-text-primary">
        {translate(messages, 'diagnostics.report.historyHeading')}
      </h3>
      {firstRead === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : firstRead.status !== 'ok' ? (
        <ReadProblem
          locale={locale}
          messages={messages}
          state={firstRead}
          onRetry={() => void first.reload()}
        />
      ) : (
        <ol className="flex flex-col gap-1">
          <li className="text-caption text-text-muted">
            {translate(messages, 'diagnostics.report.opened')}{' '}
            <bdi>{formatDateTime(firstRead.data.origin.createdAt, locale)}</bdi> ·{' '}
            {statusText(messages, firstRead.data.origin.initialStatus)}
          </li>
          {pages.flatMap((page) =>
            page.items.map((entry) => (
              <li key={entry.id} className="text-body text-text-primary">
                {entry.fromState === null
                  ? statusText(messages, entry.toState)
                  : `${statusText(messages, entry.fromState)} → ${statusText(messages, entry.toState)}`}
                {entry.reason ? (
                  <>
                    {' — '}
                    <bdi>{entry.reason}</bdi>
                  </>
                ) : null}
                <span className="text-caption text-text-muted">
                  {' · '}
                  <bdi>{formatDateTime(entry.occurredAt, locale)}</bdi>
                </span>
              </li>
            ))
          )}
        </ol>
      )}
      {last !== null && last.hasMore ? (
        <div>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() => void loadMore()}
            disabled={loading}
            aria-busy={loading || undefined}
          >
            {translate(messages, loading ? 'state.loading' : 'diagnostics.report.moreHistory')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
