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
 * deletes an entry, because nothing on the wire does.
 *
 * Every select inside a `<form action>` carries the epoch-key shape (`key` from
 * the form's `attempt`, `defaultValue`, `onChange`): React resets the form DOM
 * once the action settles, and that shape keeps the operator's choice when the
 * write is refused. The version-guarded commands (`transitionReport`,
 * `completeReport`) hand their outcome onward through `onDone` so the record
 * version the screen holds is renewed after every move.
 */
import { useCallback, useEffect, useState } from 'react';
import { listDocumentCategories } from '@/features/attachments/api';
import type { DocumentCategory } from '@/features/attachments/attachments-contract';
import { CaptureFileField } from '@/features/receptions/components/CaptureFileField';
import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { EmptyState } from '@/components/states/States';
import type { ItemsOnly, ReadState } from '@/lib/api/read-operation';
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
import type {
  DiagnosticReport,
  DiagnosticReportDetail,
  PublishableVersion,
  ReportHistory,
  TemplateItem,
} from '../diagnostics-contract';

const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';

const RECORDABLE = new Set(['draft', 'in_progress']);
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

function useReload(): readonly [number, () => void] {
  const [reloadCount, setReloadCount] = useState(0);
  const reload = useCallback(() => setReloadCount((n) => n + 1), []);
  return [reloadCount, reload];
}

function problemKeyOf(result: ActionState): string {
  if (result.status === 'conflict') return 'diagnostics.report.conflict';
  return result.messageKey ?? 'action.failed';
}

function ReadProblem({
  messages,
  state,
}: {
  readonly messages: Messages;
  readonly state: { readonly status: string; readonly correlationId: string | null };
}) {
  return (
    <p role="alert" className="text-body text-error">
      {translateDynamic(messages, `state.${state.status}.title`)}
      {state.correlationId
        ? ` ${translate(messages, 'action.reference')} ${state.correlationId}`
        : ''}
    </p>
  );
}

function Problem({
  messages,
  problem,
}: {
  readonly messages: Messages;
  readonly problem: string | null;
}) {
  if (problem === null) return null;
  return (
    <p role="alert" className="basis-full text-body text-error">
      {translateDynamic(messages, problem)}
    </p>
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
  const [reports, setReports] = useState<ReadState<ItemsOnly<DiagnosticReport>> | null>(null);
  const [reloadCount, reload] = useReload();
  const [openReportId, setOpenReportId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listJobReports(jobId).then((next) => {
      if (!cancelled) setReports(next);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId, reloadCount]);

  return (
    <div className="flex flex-col gap-6">
      {capabilities.canRecord ? (
        <StartReportForm messages={messages} jobId={jobId} onStarted={reload} />
      ) : null}

      <section
        aria-labelledby="reports-heading"
        className="rounded-lg border border-border bg-surface p-4"
      >
        <h2 id="reports-heading" className="mb-3 text-section-title font-medium text-text-primary">
          {translate(messages, 'diagnostics.job.reportsHeading')}
        </h2>
        {reports === null ? (
          <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
        ) : reports.status !== 'ok' ? (
          <ReadProblem messages={messages} state={reports} />
        ) : reports.data.items.length === 0 ? (
          <EmptyState
            messages={messages}
            titleKey="diagnostics.job.emptyTitle"
            descriptionKey="diagnostics.job.emptyBody"
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {reports.data.items.map((report) => (
              <li key={report.id} className="rounded-md border border-border p-3">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <span className="text-body font-medium text-text-primary">
                    {translate(messages, 'diagnostics.job.report')} {report.revisionNumber}
                  </span>
                  <code className="font-mono text-caption" dir="ltr">
                    {report.status}
                  </code>
                  <span className="text-caption text-text-muted">
                    {formatDateTime(report.createdAt, locale)}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpenReportId(openReportId === report.id ? null : report.id)}
                    aria-expanded={openReportId === report.id}
                    className="ms-auto text-primary underline-offset-2 hover:underline"
                  >
                    {translate(
                      messages,
                      openReportId === report.id
                        ? 'diagnostics.job.closeReport'
                        : 'diagnostics.job.openReport'
                    )}
                  </button>
                </div>
                {openReportId === report.id ? (
                  <ReportWorkbench
                    locale={locale}
                    messages={messages}
                    reportId={report.id}
                    capabilities={capabilities}
                    onListChanged={reload}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function StartReportForm({
  messages,
  jobId,
  onStarted,
}: {
  readonly messages: Messages;
  readonly jobId: string;
  readonly onStarted: () => void;
}) {
  const [versions, setVersions] = useState<ReadState<ItemsOnly<PublishableVersion>> | null>(null);
  const [templateVersionId, setTemplateVersionId] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void listPublishableVersions(jobId).then((next) => {
      if (!cancelled) setVersions(next);
    });
    return () => {
      cancelled = true;
    };
  }, [jobId]);

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
      {versions === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : versions.status !== 'ok' ? (
        <ReadProblem messages={messages} state={versions} />
      ) : versions.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'diagnostics.job.noPublishable')}
        </p>
      ) : (
        <form
          action={async () => {
            setPending(true);
            setProblem(null);
            if (templateVersionId.length === 0) {
              setPending(false);
              setAttempt((n) => n + 1);
              setProblem('field.required');
              return;
            }
            const outcome = await createReport(jobId, { templateVersionId });
            setPending(false);
            setAttempt((n) => n + 1);
            notifyActionResult(outcome, messages);
            if (outcome.status === 'success') {
              setTemplateVersionId('');
              onStarted();
              return;
            }
            setProblem(problemKeyOf(outcome));
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <SelectField
            key={`templateVersionId-${attempt}`}
            name="templateVersionId"
            label={translate(messages, 'diagnostics.job.template')}
            defaultValue={templateVersionId}
            onChange={(event) => setTemplateVersionId(event.target.value)}
            options={versions.data.items.map((version) => ({
              value: version.versionId,
              label: `${version.templateName} — ${translate(messages, 'diagnostics.template.version')} ${version.versionNumber} (${version.itemCount})`,
            }))}
            placeholder={translate(messages, 'diagnostics.job.chooseTemplate')}
            required
          />
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {translate(messages, pending ? 'diagnostics.job.starting' : 'diagnostics.job.start')}
          </button>
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
  readonly onListChanged: () => void;
}) {
  const [detail, setDetail] = useState<ReadState<DiagnosticReportDetail> | null>(null);
  const [items, setItems] = useState<ReadState<ItemsOnly<TemplateItem>> | null>(null);
  const [reloadCount, reload] = useReload();

  useEffect(() => {
    let cancelled = false;
    void readReport(reportId).then((next) => {
      if (cancelled) return;
      setDetail(next);
      if (next.status === 'ok') {
        void listVersionItems(next.data.report.templateVersionId).then((list) => {
          if (!cancelled) setItems(list);
        });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [reportId, reloadCount]);

  if (detail === null) {
    return (
      <p className="mt-3 text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
    );
  }
  if (detail.status !== 'ok') {
    return (
      <div className="mt-3">
        <ReadProblem messages={messages} state={detail} />
      </div>
    );
  }

  const data = detail.data;
  const recordable = capabilities.canRecord && RECORDABLE.has(data.report.status);
  const changed = () => {
    reload();
    onListChanged();
  };

  return (
    <div className="mt-3 flex flex-col gap-4">
      <Checklist
        messages={messages}
        detail={data}
        items={items}
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
      <HistoryPanel
        locale={locale}
        messages={messages}
        reportId={reportId}
        reloadCount={reloadCount}
      />
    </div>
  );
}

function Checklist({
  messages,
  detail,
  items,
  recordable,
  onChanged,
}: {
  readonly messages: Messages;
  readonly detail: DiagnosticReportDetail;
  readonly items: ReadState<ItemsOnly<TemplateItem>> | null;
  readonly recordable: boolean;
  readonly onChanged: () => void;
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
    const body =
      notApplicableReason.trim().length > 0
        ? { notApplicableReason: notApplicableReason.trim() }
        : { resultValue: resultValue.trim() };
    const outcome = await writeItemResult(detail.report.id, templateItemId, body);
    setPendingItem(null);
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      onChanged();
      return true;
    }
    setProblem(problemKeyOf(outcome));
    return false;
  };

  return (
    <section aria-labelledby={`checklist-${detail.report.id}`} className="flex flex-col gap-2">
      <h3 id={`checklist-${detail.report.id}`} className="text-body font-medium text-text-primary">
        {translate(messages, 'diagnostics.report.checklistHeading')}
      </h3>
      {detail.outstandingMandatory.length > 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'diagnostics.report.outstanding')}{' '}
          {detail.outstandingMandatory.map((o) => o.itemCode).join(', ')}
        </p>
      ) : null}
      {items === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : items.status !== 'ok' ? (
        <ReadProblem messages={messages} state={items} />
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
                        : `${translate(messages, 'diagnostics.report.answer')}: ${result.resultValue ?? ''}`}
                  </span>
                </div>
                {recordable ? (
                  <ItemAnswerForm
                    messages={messages}
                    item={item}
                    pending={pendingItem === item.id}
                    onSubmit={(value, reason) => answer(item.id, value, reason)}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <Problem messages={messages} problem={problem} />
    </section>
  );
}

function ItemAnswerForm({
  messages,
  item,
  pending,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly item: TemplateItem;
  readonly pending: boolean;
  readonly onSubmit: (resultValue: string, notApplicableReason: string) => Promise<boolean>;
}) {
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [attempt, setAttempt] = useState(0);
  return (
    <form
      action={async () => {
        const ok = await onSubmit(value, reason);
        setAttempt((n) => n + 1);
        if (ok) {
          setValue('');
          setReason('');
        }
      }}
      className="mt-2 flex flex-wrap items-end gap-2"
    >
      {item.responseType === 'boolean' ? (
        <SelectField
          key={`result-${item.id}-${attempt}`}
          name={`result-${item.id}`}
          label={translate(messages, 'diagnostics.report.answer')}
          defaultValue={value}
          onChange={(event) => setValue(event.target.value)}
          options={[
            { value: 'true', label: translate(messages, 'diagnostics.report.yes') },
            { value: 'false', label: translate(messages, 'diagnostics.report.no') },
          ]}
          placeholder={translate(messages, 'diagnostics.report.chooseAnswer')}
        />
      ) : (
        <TextField
          name={`result-${item.id}`}
          label={translate(messages, 'diagnostics.report.answer')}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          inputMode={item.responseType === 'numeric' ? 'decimal' : undefined}
          dir={item.responseType === 'numeric' ? 'ltr' : undefined}
        />
      )}
      <TextField
        name={`reason-${item.id}`}
        label={translate(messages, 'diagnostics.report.notApplicableReason')}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <button
        type="submit"
        disabled={pending || (value.trim().length === 0 && reason.trim().length === 0)}
        className={SECONDARY_BUTTON}
      >
        {translate(
          messages,
          pending ? 'diagnostics.report.recording' : 'diagnostics.report.record'
        )}
      </button>
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

/** The shared settle-and-report of every entry form: pending, problem, epoch. */
function useEntryForm(messages: Messages, onDone: () => void) {
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const run = async (action: () => Promise<ActionState>): Promise<boolean> => {
    setPending(true);
    setProblem(null);
    const outcome = await action();
    setPending(false);
    setAttempt((n) => n + 1);
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      onDone();
      return true;
    }
    setProblem(problemKeyOf(outcome));
    return false;
  };
  return { pending, problem, attempt, run } as const;
}

function MeasurementForm({
  messages,
  reportId,
  onDone,
}: {
  readonly messages: Messages;
  readonly reportId: string;
  readonly onDone: () => void;
}) {
  const [label, setLabel] = useState('');
  const [measuredValue, setMeasuredValue] = useState('');
  const [unit, setUnit] = useState('');
  const { pending, problem, run } = useEntryForm(messages, onDone);
  return (
    <form
      action={async () => {
        if (
          label.trim().length === 0 ||
          measuredValue.trim().length === 0 ||
          unit.trim().length === 0
        ) {
          return;
        }
        const ok = await run(() =>
          recordMeasurement(reportId, {
            label: label.trim(),
            measuredValue: measuredValue.trim(),
            unit: unit.trim(),
          })
        );
        if (ok) {
          setLabel('');
          setMeasuredValue('');
          setUnit('');
        }
      }}
      className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3"
    >
      <span className="basis-full text-caption font-medium text-text-secondary">
        {translate(messages, 'diagnostics.report.addMeasurement')}
      </span>
      <TextField
        name="label"
        label={translate(messages, 'diagnostics.report.measurementLabel')}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        required
      />
      <TextField
        name="measuredValue"
        label={translate(messages, 'diagnostics.report.measuredValue')}
        value={measuredValue}
        onChange={(e) => setMeasuredValue(e.target.value)}
        inputMode="decimal"
        dir="ltr"
        required
      />
      <TextField
        name="unit"
        label={translate(messages, 'diagnostics.template.unit')}
        value={unit}
        onChange={(e) => setUnit(e.target.value)}
        dir="ltr"
        required
      />
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        {translate(
          messages,
          pending ? 'diagnostics.report.recording' : 'diagnostics.report.record'
        )}
      </button>
      <Problem messages={messages} problem={problem} />
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
  readonly onDone: () => void;
}) {
  const [code, setCode] = useState('');
  const [dtcStatus, setDtcStatus] = useState('');
  const [description, setDescription] = useState('');
  const { pending, problem, attempt, run } = useEntryForm(messages, onDone);
  return (
    <form
      action={async () => {
        if (code.trim().length === 0) return;
        const ok = await run(() =>
          recordDtc(reportId, {
            code: code.trim(),
            ...(description.trim().length > 0 ? { description: description.trim() } : {}),
            ...(dtcStatus ? { dtcStatus: dtcStatus as (typeof DTC_STATUSES)[number] } : {}),
          })
        );
        if (ok) {
          setCode('');
          setDtcStatus('');
          setDescription('');
        }
      }}
      className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3"
    >
      <span className="basis-full text-caption font-medium text-text-secondary">
        {translate(messages, 'diagnostics.report.addDtc')}
      </span>
      <TextField
        name="code"
        label={translate(messages, 'diagnostics.report.dtcCode')}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        dir="ltr"
        required
      />
      <SelectField
        key={`dtcStatus-${attempt}`}
        name="dtcStatus"
        label={translate(messages, 'diagnostics.report.dtcStatus')}
        defaultValue={dtcStatus}
        onChange={(e) => setDtcStatus(e.target.value)}
        options={DTC_STATUSES.map((value) => ({
          value,
          label: translate(messages, `diagnostics.dtcStatus.${value}` as keyof Messages),
        }))}
        placeholder={translate(messages, 'diagnostics.report.dtcStatusDefault')}
      />
      <TextField
        name="description"
        label={translate(messages, 'diagnostics.report.description')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        {translate(
          messages,
          pending ? 'diagnostics.report.recording' : 'diagnostics.report.record'
        )}
      </button>
      <Problem messages={messages} problem={problem} />
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
  readonly onDone: () => void;
}) {
  const [severity, setSeverity] = useState('');
  const [disposition, setDisposition] = useState('');
  const [description, setDescription] = useState('');
  const { pending, problem, attempt, run } = useEntryForm(messages, onDone);
  return (
    <form
      action={async () => {
        if (description.trim().length === 0 || !severity || !disposition) return;
        const ok = await run(() =>
          recordFinding(reportId, {
            severity: severity as (typeof SEVERITIES)[number],
            disposition: disposition as (typeof DISPOSITIONS)[number],
            description: description.trim(),
          })
        );
        if (ok) {
          setSeverity('');
          setDisposition('');
          setDescription('');
        }
      }}
      className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3"
    >
      <span className="basis-full text-caption font-medium text-text-secondary">
        {translate(messages, 'diagnostics.report.addFinding')}
      </span>
      <SelectField
        key={`severity-${attempt}`}
        name="severity"
        label={translate(messages, 'diagnostics.report.severity')}
        defaultValue={severity}
        onChange={(e) => setSeverity(e.target.value)}
        options={SEVERITIES.map((value) => ({
          value,
          label: translate(messages, `diagnostics.severity.${value}` as keyof Messages),
        }))}
        placeholder={translate(messages, 'diagnostics.report.chooseSeverity')}
        required
      />
      <SelectField
        key={`disposition-${attempt}`}
        name="disposition"
        label={translate(messages, 'diagnostics.report.disposition')}
        defaultValue={disposition}
        onChange={(e) => setDisposition(e.target.value)}
        options={DISPOSITIONS.map((value) => ({
          value,
          label: translate(messages, `diagnostics.disposition.${value}` as keyof Messages),
        }))}
        placeholder={translate(messages, 'diagnostics.report.chooseDisposition')}
        required
      />
      <TextAreaField
        name="description"
        label={translate(messages, 'diagnostics.report.description')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        rows={2}
        required
      />
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        {translate(
          messages,
          pending ? 'diagnostics.report.recording' : 'diagnostics.report.record'
        )}
      </button>
      <Problem messages={messages} problem={problem} />
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
  readonly onDone: () => void;
}) {
  const [recommendation, setRecommendation] = useState('');
  const [priority, setPriority] = useState('');
  const { pending, problem, attempt, run } = useEntryForm(messages, onDone);
  return (
    <form
      action={async () => {
        if (recommendation.trim().length === 0) return;
        const ok = await run(() =>
          recordRecommendation(reportId, {
            recommendation: recommendation.trim(),
            ...(priority ? { priority: priority as (typeof PRIORITIES)[number] } : {}),
          })
        );
        if (ok) {
          setRecommendation('');
          setPriority('');
        }
      }}
      className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3"
    >
      <span className="basis-full text-caption font-medium text-text-secondary">
        {translate(messages, 'diagnostics.report.addRecommendation')}
      </span>
      <TextAreaField
        name="recommendation"
        label={translate(messages, 'diagnostics.report.recommendation')}
        value={recommendation}
        onChange={(e) => setRecommendation(e.target.value)}
        rows={2}
        required
      />
      <SelectField
        key={`priority-${attempt}`}
        name="priority"
        label={translate(messages, 'diagnostics.report.priority')}
        defaultValue={priority}
        onChange={(e) => setPriority(e.target.value)}
        options={PRIORITIES.map((value) => ({
          value,
          label: translate(messages, `diagnostics.priority.${value}` as keyof Messages),
        }))}
        placeholder={translate(messages, 'diagnostics.report.priorityDefault')}
      />
      <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
        {translate(
          messages,
          pending ? 'diagnostics.report.recording' : 'diagnostics.report.record'
        )}
      </button>
      <Problem messages={messages} problem={problem} />
    </form>
  );
}

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
  readonly onDone: () => void;
}) {
  const [categories, setCategories] = useState<readonly DocumentCategory[] | null>(null);
  const [categoryCode, setCategoryCode] = useState('');
  const [evidenceType, setEvidenceType] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!canCapture) return;
    let cancelled = false;
    void listDocumentCategories().then((next) => {
      if (cancelled) return;
      setCategories(next.status === 'ok' ? next.data.items : []);
    });
    return () => {
      cancelled = true;
    };
  }, [canCapture]);

  const category = categories?.find((each) => each.categoryCode === categoryCode);
  const errorFor = (name: string): string | undefined => {
    const key = fieldErrors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  return (
    <section aria-labelledby={`evidence-${reportId}`} className="flex flex-col gap-2">
      <h3 id={`evidence-${reportId}`} className="text-body font-medium text-text-primary">
        {translate(messages, 'diagnostics.report.evidenceHeading')}
      </h3>
      {canCapture ? (
        categories === null ? (
          <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
        ) : categories.length === 0 ? (
          <p className="text-body text-text-secondary">
            {translate(messages, 'diagnostics.report.noCategories')}
          </p>
        ) : (
          <form
            action={async (formData: FormData) => {
              setPending(true);
              setProblem(null);
              setFieldErrors({});
              const outcome = await captureReportEvidence(reportId, formData);
              setPending(false);
              setAttempt((n) => n + 1);
              notifyActionResult(outcome, messages);
              if (outcome.status === 'success') {
                setEvidenceType('');
                setNote('');
                onDone();
                return;
              }
              if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);
              setProblem(
                outcome.stage === undefined
                  ? (outcome.messageKey ?? 'action.failed')
                  : 'diagnostics.report.capturedPartial'
              );
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <SelectField
              key={`categoryCode-${attempt}`}
              name="categoryCode"
              label={translate(messages, 'diagnostics.report.evidenceCategory')}
              defaultValue={categoryCode}
              onChange={(event) => setCategoryCode(event.target.value)}
              options={categories.map((each) => ({
                value: each.categoryCode,
                label: each.categoryCode,
              }))}
              placeholder={translate(messages, 'diagnostics.report.evidenceCategory')}
              error={errorFor('categoryCode')}
              required
            />
            <TextField
              name="evidenceType"
              label={translate(messages, 'diagnostics.report.evidenceType')}
              description={translate(messages, 'diagnostics.report.evidenceTypeHint')}
              value={evidenceType}
              onChange={(event) => setEvidenceType(event.target.value)}
              error={errorFor('evidenceType')}
              required
            />
            <TextField
              name="note"
              label={translate(messages, 'diagnostics.report.evidenceNote')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              error={errorFor('note')}
            />
            <CaptureFileField
              name="evidenceFile"
              label={translate(messages, 'diagnostics.report.chooseFile')}
              accept={category?.allowedContentTypes}
            />
            <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
              {translate(
                messages,
                pending ? 'diagnostics.report.attaching' : 'diagnostics.report.attach'
              )}
            </button>
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
              {item.evidenceType}
              {item.note === null ? '' : ` — ${item.note}`}
              <span className="text-caption text-text-muted">
                {' '}
                · {formatDateTime(item.createdAt, locale)} ·{' '}
                {translate(messages, 'diagnostics.report.documentReference')}{' '}
                {item.documentVersionId}
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
  readonly onDone: () => void;
}) {
  const [reason, setReason] = useState('');
  const [summary, setSummary] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const version = detail.report.recordVersion;
  const moves = capabilities.canRecord ? detail.nextStatuses.filter((s) => s !== 'completed') : [];
  const canComplete = capabilities.canComplete && detail.nextStatuses.includes('completed');

  /*
   * Both commands are version-guarded: the `If-Match` is the version this panel
   * was rendered from, and after either one the record has moved. `onDone`
   * re-reads the detail (and the list), so the next command carries the renewed
   * version rather than the one this panel can no longer vouch for.
   */
  const move = async (toStatus: ReportStatus) => {
    setPending(true);
    setProblem(null);
    const outcome = await transitionReport(
      reportId,
      { toStatus, ...(reason.trim().length > 0 ? { reason: reason.trim() } : {}) },
      version
    );
    setPending(false);
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      setReason('');
      onDone();
      return;
    }
    setProblem(problemKeyOf(outcome));
  };

  const complete = async () => {
    setPending(true);
    setProblem(null);
    const outcome = await completeReport(
      reportId,
      summary.trim().length > 0 ? { summary: summary.trim() } : {},
      version
    );
    setPending(false);
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      setSummary('');
      onDone();
      return;
    }
    setProblem(problemKeyOf(outcome));
  };

  return (
    <section aria-labelledby={`status-${reportId}`} className="flex flex-col gap-2">
      <h3 id={`status-${reportId}`} className="text-body font-medium text-text-primary">
        {translate(messages, 'diagnostics.report.statusHeading')}:{' '}
        <code className="font-mono" dir="ltr">
          {detail.report.status}
        </code>
      </h3>
      {detail.report.summary ? (
        <p className="text-body text-text-primary">
          <bdi>{detail.report.summary}</bdi>
        </p>
      ) : null}
      {moves.length > 0 || canComplete ? (
        <div className="flex flex-wrap items-end gap-2">
          <TextField
            name="reason"
            label={translate(messages, 'diagnostics.report.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          {moves.map((toStatus) => (
            <button
              key={toStatus}
              type="button"
              disabled={pending}
              onClick={() => void move(toStatus as ReportStatus)}
              className={SECONDARY_BUTTON}
            >
              {translate(messages, 'diagnostics.report.moveTo')}{' '}
              <code className="font-mono" dir="ltr">
                {toStatus}
              </code>
            </button>
          ))}
          {canComplete ? (
            <>
              <TextField
                name="summary"
                label={translate(messages, 'diagnostics.report.summary')}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
              />
              <button
                type="button"
                disabled={pending}
                onClick={() => void complete()}
                className={PRIMARY_BUTTON}
              >
                {translate(messages, 'diagnostics.report.complete')}
              </button>
            </>
          ) : null}
          <Problem messages={messages} problem={problem} />
        </div>
      ) : null}
      {detail.reviews.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {detail.reviews.map((review) => (
            <li key={review.id} className="text-body text-text-primary">
              {translateDynamic(messages, `diagnostics.reviewResult.${review.reviewResult}`)}
              {review.notes ? ` — ${review.notes}` : ''}
              <span className="text-caption text-text-muted">
                {' '}
                · {translate(messages, 'diagnostics.report.reviewer')} {review.reviewerId}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
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
  readonly onDone: () => void;
}) {
  const [reviewResult, setReviewResult] = useState('');
  const [notes, setNotes] = useState('');
  const { pending, problem, attempt, run } = useEntryForm(messages, onDone);
  return (
    <form
      action={async () => {
        if (!reviewResult) return;
        const ok = await run(() =>
          reviewReport(reportId, {
            reviewResult: reviewResult as (typeof REVIEW_RESULTS)[number],
            ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
          })
        );
        if (ok) {
          setReviewResult('');
          setNotes('');
        }
      }}
      className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3"
    >
      <span className="basis-full text-caption font-medium text-text-secondary">
        {translate(messages, 'diagnostics.report.reviewHeading')}
      </span>
      <SelectField
        key={`reviewResult-${attempt}`}
        name="reviewResult"
        label={translate(messages, 'diagnostics.report.reviewResult')}
        defaultValue={reviewResult}
        onChange={(e) => setReviewResult(e.target.value)}
        options={REVIEW_RESULTS.map((value) => ({
          value,
          label: translate(messages, `diagnostics.reviewResult.${value}` as keyof Messages),
        }))}
        placeholder={translate(messages, 'diagnostics.report.chooseReviewResult')}
        required
      />
      <TextField
        name="notes"
        label={translate(messages, 'diagnostics.report.reviewNotes')}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />
      <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
        {translate(
          messages,
          pending ? 'diagnostics.report.reviewing' : 'diagnostics.report.review'
        )}
      </button>
      <Problem messages={messages} problem={problem} />
    </form>
  );
}

function HistoryPanel({
  locale,
  messages,
  reportId,
  reloadCount,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly reportId: string;
  readonly reloadCount: number;
}) {
  const [history, setHistory] = useState<ReadState<ReportHistory> | null>(null);
  const [pages, setPages] = useState<readonly ReportHistory['transitions'][]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readReportHistory(reportId, null).then((next) => {
      if (cancelled) return;
      setHistory(next);
      if (next.status === 'ok') setPages([next.data.transitions]);
    });
    return () => {
      cancelled = true;
    };
  }, [reportId, reloadCount]);

  const last = pages.at(-1) ?? null;
  const loadMore = async () => {
    if (last === null || !last.hasMore || last.nextCursor === null) return;
    setLoading(true);
    const next = await readReportHistory(reportId, last.nextCursor);
    setLoading(false);
    if (next.status === 'ok') setPages((current) => [...current, next.data.transitions]);
  };

  return (
    <section aria-labelledby={`history-${reportId}`} className="flex flex-col gap-2">
      <h3 id={`history-${reportId}`} className="text-body font-medium text-text-primary">
        {translate(messages, 'diagnostics.report.historyHeading')}
      </h3>
      {history === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : history.status !== 'ok' ? (
        <ReadProblem messages={messages} state={history} />
      ) : (
        <ol className="flex flex-col gap-1">
          <li className="text-caption text-text-muted">
            {translate(messages, 'diagnostics.report.opened')}{' '}
            {formatDateTime(history.data.origin.createdAt, locale)} ·{' '}
            <code className="font-mono" dir="ltr">
              {history.data.origin.initialStatus}
            </code>
          </li>
          {pages.flatMap((page) =>
            page.items.map((entry) => (
              <li key={entry.id} className="text-body text-text-primary">
                <code className="font-mono" dir="ltr">
                  {entry.fromState ?? '—'} → {entry.toState}
                </code>
                {entry.reason ? ` — ${entry.reason}` : ''}
                <span className="text-caption text-text-muted">
                  {' '}
                  · {formatDateTime(entry.occurredAt, locale)}
                </span>
              </li>
            ))
          )}
        </ol>
      )}
      {last !== null && last.hasMore ? (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={loading}
          className={SECONDARY_BUTTON}
        >
          {translate(messages, loading ? 'state.loading' : 'diagnostics.report.moreHistory')}
        </button>
      ) : null}
    </section>
  );
}
