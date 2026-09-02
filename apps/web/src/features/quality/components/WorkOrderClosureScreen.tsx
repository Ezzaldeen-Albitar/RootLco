'use client';

/**
 * The quality and closure view of one work order (P1-29 W8).
 *
 * Six panels, each on the operation and the code that owns it, each reading
 * its own truth and re-reading after its own writes:
 *
 * - **The closure gate** — `wo.work-order-closure-eligibility`, rendered as the
 *   backend states it: each blocker `B1..B6` with the backend's own message and
 *   the object that enforces it, plus the DEFERRED conditions the eligibility
 *   itself names. The screen invents no rule; it shows the ones the platform has.
 * - **QC records** — `qms.qc-record-list` / `-open` / `-detail`; each record's
 *   checklist is a JOIN of the vocabulary (`qms.qc-check-list`, W8's one Backend
 *   read) with the record's results, so an unanswered check is visible as
 *   unanswered and every result is addressed to the check's id; `-check-result`
 *   per check and `-finalize` with the record's `If-Match`.
 * - **Rework** — `qms.rework-list` / `-create` / `-sign-off` (`If-Match`); the
 *   cost only with `iam.sensitive.view` (`-cost-read` / `-cost-record`).
 * - **Reopen attempts** — `qms.reopen-attempt-list` / `-attempt`: an
 *   append-only log; the OUTCOME is the backend's, never the screen's.
 * - **Additional work** — `wo.additional-work-list` / `-request` /
 *   `-approval-read` / `-approval` (`If-Match`) / `-fulfillment` / `-withdraw`;
 *   the description only with `iam.sensitive.view`.
 * - **Closure** — `wo.work-order-closure` with the order's `If-Match`, to a
 *   terminal, non-cancelling state the order's own `nextStates` name.
 *
 * Every select inside a `<form action>` carries the epoch-key shape; every
 * version-guarded command hands its outcome onward so the version the screen
 * holds is renewed. Submit-for-QA is not here: it is `wo.work-order-transition`
 * on the detail, to whichever state the catalogue permits.
 */
import { useCallback, useEffect, useState } from 'react';
import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { EmptyState } from '@/components/states/States';
import { readWorkOrderDetail } from '@/features/work-orders/api';
import type { WorkOrderDetail } from '@/features/work-orders/work-orders-contract';
import type { ItemsOnly, ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import {
  closeWorkOrder,
  createRework,
  finalizeQcRecord,
  fulfillAdditionalWork,
  listAdditionalWork,
  listQcChecks,
  listQcRecords,
  listReopenAttempts,
  listReworkLinks,
  openQcRecord,
  raiseReopenAttempt,
  readAdditionalWorkApproval,
  readAdditionalWorkDetail,
  readClosureEligibility,
  readQcRecord,
  readReworkCost,
  recordAdditionalWorkApproval,
  recordAdditionalWorkDetail,
  recordReworkCost,
  requestAdditionalWork,
  signOffRework,
  withdrawAdditionalWork,
  writeQcCheckResult,
} from '../api';
import type {
  AdditionalWorkDetail,
  AdditionalWorkRequest,
  ClosureEligibility,
  CustomerApproval,
  QcCheckVocabularyEntry,
  QcRecord,
  QcRecordDetail,
  ReopenAttempt,
  ReworkLink,
} from '../quality-contract';

const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:opacity-60';
const SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';

const CHECK_RESULTS = ['pass', 'fail', 'na'] as const;
const OVERALL_RESULTS = ['passed', 'failed'] as const;
const DECISIONS = ['approved', 'rejected'] as const;
const CHANNELS = ['in_person', 'phone', 'email', 'sms', 'portal', 'other'] as const;
const FULFILLMENT = ['fulfilled', 'waived'] as const;

export interface ClosureCapabilities {
  readonly canReadQc: boolean;
  readonly canRecordQc: boolean;
  readonly canFinalizeQc: boolean;
  readonly canManageRework: boolean;
  readonly canSignOffRework: boolean;
  readonly canTransition: boolean;
  readonly canClose: boolean;
  readonly canRequestAdditionalWork: boolean;
  readonly canApproveAdditionalWork: boolean;
  readonly canViewSensitive: boolean;
}

function useReload(): readonly [number, () => void] {
  const [count, setCount] = useState(0);
  const reload = useCallback(() => setCount((n) => n + 1), []);
  return [count, reload];
}

function problemKeyOf(result: ActionState): string {
  if (result.status === 'conflict') return 'quality.closure.conflict';
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

function Panel({
  id,
  titleKey,
  messages,
  children,
}: {
  readonly id: string;
  readonly titleKey: string;
  readonly messages: Messages;
  readonly children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="rounded-lg border border-border bg-surface p-4">
      <h2 id={id} className="mb-3 text-section-title font-medium text-text-primary">
        {translateDynamic(messages, titleKey)}
      </h2>
      {children}
    </section>
  );
}

/** The shared settle-and-report of every command form: pending, problem, epoch. */
function useCommand(messages: Messages, onDone: () => void) {
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

export function WorkOrderClosureScreen({
  locale,
  messages,
  workOrderId,
  capabilities,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly capabilities: ClosureCapabilities;
}) {
  const [detail, setDetail] = useState<ReadState<WorkOrderDetail> | null>(null);
  const [eligibility, setEligibility] = useState<ReadState<ClosureEligibility> | null>(null);
  const [reloadCount, reload] = useReload();

  useEffect(() => {
    let cancelled = false;
    void readWorkOrderDetail(workOrderId).then((next) => {
      if (!cancelled) setDetail(next);
    });
    void readClosureEligibility(workOrderId).then((next) => {
      if (!cancelled) setEligibility(next);
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, reloadCount]);

  return (
    <div className="flex flex-col gap-6">
      <GatePanel messages={messages} eligibility={eligibility} detail={detail} />
      {capabilities.canReadQc ? (
        <QcPanel
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          capabilities={capabilities}
          onChanged={reload}
        />
      ) : null}
      {capabilities.canReadQc ? (
        <ReworkPanel
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          capabilities={capabilities}
          terminal={eligibility?.status === 'ok' ? eligibility.data.alreadyTerminal : null}
          onChanged={reload}
        />
      ) : null}
      {capabilities.canReadQc ? (
        <ReopenPanel
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          capabilities={capabilities}
          onChanged={reload}
        />
      ) : null}
      <AdditionalWorkPanel
        locale={locale}
        messages={messages}
        workOrderId={workOrderId}
        capabilities={capabilities}
        onChanged={reload}
      />
      <ClosurePanel
        messages={messages}
        workOrderId={workOrderId}
        detail={detail}
        eligibility={eligibility}
        capabilities={capabilities}
        onDone={reload}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ gate */

function GatePanel({
  messages,
  eligibility,
  detail,
}: {
  readonly messages: Messages;
  readonly eligibility: ReadState<ClosureEligibility> | null;
  readonly detail: ReadState<WorkOrderDetail> | null;
}) {
  return (
    <Panel id="closure-gate-heading" titleKey="quality.closure.gateHeading" messages={messages}>
      {detail?.status === 'ok' ? (
        <p className="mb-2 text-body text-text-secondary">
          <bdi>{detail.data.workOrder.displayNumber ?? detail.data.workOrder.id}</bdi> ·{' '}
          <code className="font-mono" dir="ltr">
            {detail.data.workOrder.state}
          </code>
        </p>
      ) : null}
      {eligibility === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : eligibility.status !== 'ok' ? (
        <ReadProblem messages={messages} state={eligibility} />
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-body font-medium text-text-primary">
            {translate(
              messages,
              eligibility.data.alreadyTerminal
                ? 'quality.closure.alreadyTerminal'
                : eligibility.data.eligible
                  ? 'quality.closure.eligible'
                  : 'quality.closure.notEligible'
            )}
          </p>
          {eligibility.data.blockers.length === 0 ? null : (
            <ul className="flex flex-col gap-1">
              {eligibility.data.blockers.map((blocker) => (
                <li key={blocker.code} className="text-body text-text-primary">
                  <code className="font-mono" dir="ltr">
                    {blocker.code}
                  </code>{' '}
                  {blocker.message}
                  <span className="text-caption text-text-muted">
                    {' '}
                    · {translate(messages, 'quality.closure.enforcedBy')}{' '}
                    <code className="font-mono" dir="ltr">
                      {blocker.enforcedBy}
                    </code>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {eligibility.data.deferred.conditions.length === 0 ? null : (
            <p className="text-caption text-text-muted">
              {translate(messages, 'quality.closure.deferred')}{' '}
              {eligibility.data.deferred.conditions.join(', ')} ·{' '}
              <bdi>{eligibility.data.deferred.reason}</bdi> ({eligibility.data.deferred.owner})
            </p>
          )}
          {eligibility.data.inventoryCommitments.blocking ? (
            <p className="text-body text-text-primary">
              {translate(messages, 'quality.closure.inventoryBlocking')}
              <span className="text-caption text-text-muted">
                {' '}
                · {translate(messages, 'quality.closure.activeReservations')}{' '}
                <span dir="ltr">{eligibility.data.inventoryCommitments.activeReservations}</span> ·{' '}
                {translate(messages, 'quality.closure.openIssues')}{' '}
                <span dir="ltr">{eligibility.data.inventoryCommitments.openIssues}</span>
              </span>
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  );
}

/* -------------------------------------------------------------------- qc */

function QcPanel({
  locale,
  messages,
  workOrderId,
  capabilities,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: () => void;
}) {
  const [records, setRecords] = useState<ReadState<ItemsOnly<QcRecord>> | null>(null);
  const [checks, setChecks] = useState<ReadState<ItemsOnly<QcCheckVocabularyEntry>> | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [reloadCount, reload] = useReload();
  const [notes, setNotes] = useState('');
  const { pending, problem, run } = useCommand(messages, () => {
    reload();
    onChanged();
  });

  useEffect(() => {
    let cancelled = false;
    void listQcRecords(workOrderId).then((next) => {
      if (!cancelled) setRecords(next);
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, reloadCount]);

  useEffect(() => {
    let cancelled = false;
    void listQcChecks().then((next) => {
      if (!cancelled) setChecks(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Panel id="qc-heading" titleKey="quality.closure.qcHeading" messages={messages}>
      {capabilities.canRecordQc ? (
        <form
          action={async () => {
            const ok = await run(() =>
              openQcRecord(workOrderId, notes.trim().length > 0 ? { notes: notes.trim() } : {})
            );
            if (ok) setNotes('');
          }}
          className="mb-3 flex flex-wrap items-end gap-3"
        >
          <TextField
            name="notes"
            label={translate(messages, 'quality.closure.qcNotes')}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {translate(messages, pending ? 'quality.closure.opening' : 'quality.closure.openQc')}
          </button>
          <Problem messages={messages} problem={problem} />
        </form>
      ) : null}
      {records === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : records.status !== 'ok' ? (
        <ReadProblem messages={messages} state={records} />
      ) : records.data.items.length === 0 ? (
        <EmptyState
          messages={messages}
          titleKey="quality.closure.noQcTitle"
          descriptionKey="quality.closure.noQcBody"
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {records.data.items.map((record) => (
            <li key={record.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-body font-medium text-text-primary">
                  {translateDynamic(messages, `quality.result.${record.overallResult}`)}
                </span>
                {record.finalizedAt ? (
                  <span className="text-caption text-text-muted">
                    {translate(messages, 'quality.queue.finalizedAt')}{' '}
                    {formatDateTime(record.finalizedAt, locale)}
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setOpenId(openId === record.id ? null : record.id)}
                  aria-expanded={openId === record.id}
                  className="ms-auto text-primary underline-offset-2 hover:underline"
                >
                  {translate(
                    messages,
                    openId === record.id
                      ? 'quality.closure.closeRecord'
                      : 'quality.closure.openRecord'
                  )}
                </button>
              </div>
              {openId === record.id ? (
                <QcRecordWorkbench
                  messages={messages}
                  recordId={record.id}
                  checks={checks}
                  capabilities={capabilities}
                  onChanged={() => {
                    reload();
                    onChanged();
                  }}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function QcRecordWorkbench({
  messages,
  recordId,
  checks,
  capabilities,
  onChanged,
}: {
  readonly messages: Messages;
  readonly recordId: string;
  readonly checks: ReadState<ItemsOnly<QcCheckVocabularyEntry>> | null;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ReadState<QcRecordDetail> | null>(null);
  const [reloadCount, reload] = useReload();
  const [pendingCheck, setPendingCheck] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readQcRecord(recordId).then((next) => {
      if (!cancelled) setDetail(next);
    });
    return () => {
      cancelled = true;
    };
  }, [recordId, reloadCount]);

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
  const open = data.record.finalizedAt === null;

  const answer = async (qcCheckId: string, result: string, note: string) => {
    setPendingCheck(qcCheckId);
    setProblem(null);
    const outcome = await writeQcCheckResult(recordId, qcCheckId, {
      result: result as (typeof CHECK_RESULTS)[number],
      ...(note.trim().length > 0 ? { note: note.trim() } : {}),
    });
    setPendingCheck(null);
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') reload();
    else setProblem(problemKeyOf(outcome));
  };

  return (
    <div className="mt-3 flex flex-col gap-3">
      {data.unresolvedMandatory.length > 0 ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'quality.closure.unresolvedMandatory')}{' '}
          {data.unresolvedMandatory.map((c) => c.code).join(', ')}
        </p>
      ) : null}
      {checks === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : checks.status !== 'ok' ? (
        <ReadProblem messages={messages} state={checks} />
      ) : (
        <ol className="flex flex-col gap-2">
          {checks.data.items.map((check) => {
            const result = data.results.find((r) => r.qcCheckId === check.id) ?? null;
            return (
              <li key={check.id} className="rounded-md bg-surface-subtle px-3 py-2">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-body text-text-primary">
                    <bdi>{check.name}</bdi>
                  </span>
                  <code className="font-mono text-caption" dir="ltr">
                    {check.code}
                  </code>
                  <span className="text-caption text-text-muted">
                    {check.isMandatory ? translate(messages, 'quality.closure.mandatory') : ''}
                    {check.isSafetyCritical
                      ? ` · ${translate(messages, 'quality.closure.safetyCritical')}`
                      : ''}
                    {check.status !== 'active'
                      ? ` · ${translateDynamic(messages, `quality.checkStatus.${check.status}`)}`
                      : ''}
                  </span>
                  <span className="ms-auto text-caption text-text-secondary">
                    {result === null
                      ? translate(messages, 'quality.closure.unanswered')
                      : `${translateDynamic(messages, `quality.checkResult.${result.result}`)}${result.note ? ` — ${result.note}` : ''}`}
                  </span>
                </div>
                {open && capabilities.canRecordQc && check.status === 'active' ? (
                  <CheckAnswerForm
                    messages={messages}
                    checkId={check.id}
                    pending={pendingCheck === check.id}
                    onSubmit={(result, note) => answer(check.id, result, note)}
                  />
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      <Problem messages={messages} problem={problem} />
      {open && capabilities.canFinalizeQc ? (
        <FinalizeForm
          messages={messages}
          recordId={recordId}
          recordVersion={data.record.recordVersion}
          onDone={() => {
            reload();
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function CheckAnswerForm({
  messages,
  checkId,
  pending,
  onSubmit,
}: {
  readonly messages: Messages;
  readonly checkId: string;
  readonly pending: boolean;
  readonly onSubmit: (result: string, note: string) => Promise<void>;
}) {
  const [result, setResult] = useState('');
  const [note, setNote] = useState('');
  const [attempt, setAttempt] = useState(0);
  return (
    <form
      action={async () => {
        if (!result) return;
        await onSubmit(result, note);
        setAttempt((n) => n + 1);
        setNote('');
      }}
      className="mt-2 flex flex-wrap items-end gap-2"
    >
      <SelectField
        key={`result-${checkId}-${attempt}`}
        name={`result-${checkId}`}
        label={translate(messages, 'quality.closure.checkResult')}
        defaultValue={result}
        onChange={(event) => setResult(event.target.value)}
        options={CHECK_RESULTS.map((value) => ({
          value,
          label: translate(messages, `quality.checkResult.${value}` as keyof Messages),
        }))}
        placeholder={translate(messages, 'quality.closure.chooseResult')}
      />
      <TextField
        name={`note-${checkId}`}
        label={translate(messages, 'quality.closure.note')}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />
      <button type="submit" disabled={pending || !result} className={SECONDARY_BUTTON}>
        {translate(messages, pending ? 'quality.closure.recording' : 'quality.closure.record')}
      </button>
    </form>
  );
}

function FinalizeForm({
  messages,
  recordId,
  recordVersion,
  onDone,
}: {
  readonly messages: Messages;
  readonly recordId: string;
  readonly recordVersion: number;
  readonly onDone: () => void;
}) {
  const [overallResult, setOverallResult] = useState('');
  const [notes, setNotes] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  return (
    <form
      action={async () => {
        if (!overallResult) return;
        setPending(true);
        setProblem(null);
        const outcome = await finalizeQcRecord(
          recordId,
          {
            overallResult: overallResult as (typeof OVERALL_RESULTS)[number],
            ...(notes.trim().length > 0 ? { notes: notes.trim() } : {}),
          },
          recordVersion
        );
        setPending(false);
        setAttempt((n) => n + 1);
        notifyActionResult(outcome, messages);
        if (outcome.status === 'success') {
          setOverallResult('');
          setNotes('');
          onDone();
          return;
        }
        setProblem(problemKeyOf(outcome));
      }}
      className="flex flex-wrap items-end gap-2 rounded-md border border-dashed border-border p-3"
    >
      <span className="basis-full text-caption font-medium text-text-secondary">
        {translate(messages, 'quality.closure.finalizeHeading')}
      </span>
      <SelectField
        key={`overallResult-${attempt}`}
        name="overallResult"
        label={translate(messages, 'quality.closure.overallResult')}
        defaultValue={overallResult}
        onChange={(event) => setOverallResult(event.target.value)}
        options={OVERALL_RESULTS.map((value) => ({
          value,
          label: translate(messages, `quality.result.${value}` as keyof Messages),
        }))}
        placeholder={translate(messages, 'quality.closure.chooseOverall')}
        required
      />
      <TextField
        name="notes"
        label={translate(messages, 'quality.closure.note')}
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
      />
      <button type="submit" disabled={pending || !overallResult} className={PRIMARY_BUTTON}>
        {translate(messages, pending ? 'quality.closure.finalizing' : 'quality.closure.finalize')}
      </button>
      <Problem messages={messages} problem={problem} />
    </form>
  );
}

/* ---------------------------------------------------------------- rework */

function ReworkPanel({
  locale,
  messages,
  workOrderId,
  capabilities,
  terminal,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly capabilities: ClosureCapabilities;
  /** The gate's `alreadyTerminal`; rework corrects a closed order, so the form waits for it. `null` while unknown. */
  readonly terminal: boolean | null;
  readonly onChanged: () => void;
}) {
  const [links, setLinks] = useState<ReadState<ItemsOnly<ReworkLink>> | null>(null);
  const [reloadCount, reload] = useReload();
  const [rootCause, setRootCause] = useState('');
  const [correctiveAction, setCorrectiveAction] = useState('');
  const [responsibility, setResponsibility] = useState('');
  const [safetyCritical, setSafetyCritical] = useState('');
  const [leadTechnicianId, setLeadTechnicianId] = useState('');
  const { pending, problem, attempt, run } = useCommand(messages, () => {
    reload();
    onChanged();
  });

  useEffect(() => {
    let cancelled = false;
    void listReworkLinks(workOrderId).then((next) => {
      if (!cancelled) setLinks(next);
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, reloadCount]);

  return (
    <Panel id="rework-heading" titleKey="quality.closure.reworkHeading" messages={messages}>
      {capabilities.canManageRework && terminal === false ? (
        <p className="mb-3 text-caption text-text-muted">
          {translate(messages, 'quality.closure.reworkNeedsClosed')}
        </p>
      ) : null}
      {capabilities.canManageRework && terminal === true ? (
        <form
          action={async () => {
            if (rootCause.trim().length === 0 || correctiveAction.trim().length === 0) return;
            const ok = await run(() =>
              createRework(workOrderId, {
                rootCause: rootCause.trim(),
                correctiveAction: correctiveAction.trim(),
                ...(responsibility.trim().length > 0
                  ? { responsibility: responsibility.trim() }
                  : {}),
                ...(leadTechnicianId.trim().length > 0
                  ? { leadTechnicianId: leadTechnicianId.trim() }
                  : {}),
                ...(safetyCritical === 'yes' ? { isSafetyCritical: true } : {}),
              })
            );
            if (ok) {
              setRootCause('');
              setCorrectiveAction('');
              setResponsibility('');
              setSafetyCritical('');
              setLeadTechnicianId('');
            }
          }}
          className="mb-3 flex flex-wrap items-end gap-3 rounded-md border border-dashed border-border p-3"
        >
          <span className="basis-full text-caption font-medium text-text-secondary">
            {translate(messages, 'quality.closure.openRework')}
          </span>
          <TextAreaField
            name="rootCause"
            label={translate(messages, 'quality.closure.rootCause')}
            value={rootCause}
            onChange={(event) => setRootCause(event.target.value)}
            rows={2}
            required
          />
          <TextAreaField
            name="correctiveAction"
            label={translate(messages, 'quality.closure.correctiveAction')}
            value={correctiveAction}
            onChange={(event) => setCorrectiveAction(event.target.value)}
            rows={2}
            required
          />
          <TextField
            name="responsibility"
            label={translate(messages, 'quality.closure.responsibility')}
            value={responsibility}
            onChange={(event) => setResponsibility(event.target.value)}
          />
          <TextField
            name="leadTechnicianId"
            label={translate(messages, 'quality.closure.leadTechnician')}
            description={translate(messages, 'quality.closure.leadTechnicianHint')}
            value={leadTechnicianId}
            onChange={(event) => setLeadTechnicianId(event.target.value)}
            dir="ltr"
          />
          <SelectField
            key={`safetyCritical-${attempt}`}
            name="safetyCritical"
            label={translate(messages, 'quality.closure.safetyCritical')}
            defaultValue={safetyCritical}
            onChange={(event) => setSafetyCritical(event.target.value)}
            options={[
              { value: 'yes', label: translate(messages, 'quality.closure.yes') },
              { value: 'no', label: translate(messages, 'quality.closure.no') },
            ]}
            placeholder={translate(messages, 'quality.closure.no')}
          />
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {translate(
              messages,
              pending ? 'quality.closure.opening' : 'quality.closure.createRework'
            )}
          </button>
          <Problem messages={messages} problem={problem} />
        </form>
      ) : null}
      {links === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : links.status !== 'ok' ? (
        <ReadProblem messages={messages} state={links} />
      ) : links.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quality.closure.noRework')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {links.data.items.map((link) => (
            <ReworkRow
              key={link.id}
              locale={locale}
              messages={messages}
              link={link}
              capabilities={capabilities}
              onChanged={() => {
                reload();
                onChanged();
              }}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function ReworkRow({
  locale,
  messages,
  link,
  capabilities,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly link: ReworkLink;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: () => void;
}) {
  const [signOffBy, setSignOffBy] = useState('');
  const [cost, setCost] = useState<ReadState<{ reworkCost: string; costCurrency: string }> | null>(
    null
  );
  const [reworkCost, setReworkCost] = useState('');
  const [costCurrency, setCostCurrency] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!capabilities.canViewSensitive) return;
    let cancelled = false;
    void readReworkCost(link.id).then((next) => {
      if (!cancelled) setCost(next);
    });
    return () => {
      cancelled = true;
    };
  }, [capabilities.canViewSensitive, link.id, link.recordVersion]);

  /*
   * The sign-off is version-guarded: the `If-Match` is the link's version this
   * row was rendered from, and `onChanged` re-reads the list so the next
   * command carries the renewed version rather than a stale one.
   */
  const signOff = async () => {
    if (signOffBy.trim().length === 0) return;
    setPending(true);
    setProblem(null);
    const outcome = await signOffRework(
      link.id,
      { signOffBy: signOffBy.trim() },
      link.recordVersion
    );
    setPending(false);
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      setSignOffBy('');
      onChanged();
      return;
    }
    setProblem(problemKeyOf(outcome));
  };

  const recordCost = async () => {
    if (reworkCost.trim().length === 0 || costCurrency.trim().length === 0) return;
    setPending(true);
    setProblem(null);
    const outcome = await recordReworkCost(link.id, {
      reworkCost: reworkCost.trim(),
      costCurrency: costCurrency.trim(),
    });
    setPending(false);
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      setReworkCost('');
      setCostCurrency('');
      onChanged();
      return;
    }
    setProblem(problemKeyOf(outcome));
  };

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-body font-medium text-text-primary">
          <bdi>{link.rootCause}</bdi>
        </span>
        <span className="text-caption text-text-muted">
          {translate(messages, 'quality.closure.correctiveAction')}:{' '}
          <bdi>{link.correctiveAction}</bdi>
        </span>
        {link.isSafetyCritical ? (
          <span className="text-caption text-text-muted">
            {translate(messages, 'quality.closure.safetyCritical')}
          </span>
        ) : null}
        <span className="text-caption text-text-muted">
          {link.signOffAt
            ? `${translate(messages, 'quality.closure.signedOff')} ${formatDateTime(link.signOffAt, locale)}`
            : translate(messages, 'quality.closure.notSignedOff')}
        </span>
        <code className="ms-auto font-mono text-caption" dir="ltr">
          {link.reworkWorkOrderId}
        </code>
      </div>
      {capabilities.canViewSensitive ? (
        <p className="mt-1 text-caption text-text-secondary">
          {translate(messages, 'quality.closure.cost')}:{' '}
          {cost === null
            ? translate(messages, 'state.loading')
            : cost.status === 'ok'
              ? `${cost.data.reworkCost} ${cost.data.costCurrency}`
              : cost.status === 'not-found'
                ? translate(messages, 'quality.closure.noCost')
                : translateDynamic(messages, `state.${cost.status}.title`)}
        </p>
      ) : null}
      {capabilities.canSignOffRework && link.signOffAt === null ? (
        <form action={() => void signOff()} className="mt-2 flex flex-wrap items-end gap-2">
          <TextField
            name={`signOffBy-${link.id}`}
            label={translate(messages, 'quality.closure.signOffBy')}
            description={translate(messages, 'quality.closure.signOffByHint')}
            value={signOffBy}
            onChange={(event) => setSignOffBy(event.target.value)}
            dir="ltr"
            required
          />
          <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
            {translate(messages, 'quality.closure.signOff')}
          </button>
        </form>
      ) : null}
      {capabilities.canManageRework && capabilities.canViewSensitive ? (
        <form action={() => void recordCost()} className="mt-2 flex flex-wrap items-end gap-2">
          <TextField
            name={`reworkCost-${link.id}`}
            label={translate(messages, 'quality.closure.cost')}
            value={reworkCost}
            onChange={(event) => setReworkCost(event.target.value)}
            inputMode="decimal"
            dir="ltr"
          />
          <TextField
            name={`costCurrency-${link.id}`}
            label={translate(messages, 'quality.closure.currency')}
            value={costCurrency}
            onChange={(event) => setCostCurrency(event.target.value)}
            dir="ltr"
          />
          <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
            {translate(messages, 'quality.closure.recordCost')}
          </button>
        </form>
      ) : null}
      <Problem messages={messages} problem={problem} />
    </li>
  );
}

/* ---------------------------------------------------------------- reopen */

function ReopenPanel({
  locale,
  messages,
  workOrderId,
  capabilities,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: () => void;
}) {
  const [attempts, setAttempts] = useState<ReadState<ItemsOnly<ReopenAttempt>> | null>(null);
  const [reloadCount, reload] = useReload();
  const [reason, setReason] = useState('');
  const { pending, problem, run } = useCommand(messages, () => {
    reload();
    onChanged();
  });

  useEffect(() => {
    let cancelled = false;
    void listReopenAttempts(workOrderId).then((next) => {
      if (!cancelled) setAttempts(next);
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, reloadCount]);

  return (
    <Panel id="reopen-heading" titleKey="quality.closure.reopenHeading" messages={messages}>
      <p className="mb-2 text-caption text-text-muted">
        {translate(messages, 'quality.closure.reopenNote')}
      </p>
      {capabilities.canTransition ? (
        <form
          action={async () => {
            if (reason.trim().length === 0) return;
            const ok = await run(() => raiseReopenAttempt(workOrderId, { reason: reason.trim() }));
            if (ok) setReason('');
          }}
          className="mb-3 flex flex-wrap items-end gap-3"
        >
          <TextField
            name="reason"
            label={translate(messages, 'quality.closure.reopenReason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
          <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
            {translate(
              messages,
              pending ? 'quality.closure.recording' : 'quality.closure.attemptReopen'
            )}
          </button>
          <Problem messages={messages} problem={problem} />
        </form>
      ) : null}
      {attempts === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : attempts.status !== 'ok' ? (
        <ReadProblem messages={messages} state={attempts} />
      ) : attempts.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quality.closure.noReopen')}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {attempts.data.items.map((attempt) => (
            <li key={attempt.id} className="text-body text-text-primary">
              <bdi>{attempt.reason}</bdi> —{' '}
              {translateDynamic(messages, `quality.reopenOutcome.${attempt.outcome}`)}
              <span className="text-caption text-text-muted">
                {' '}
                · {formatDateTime(attempt.requestedAt, locale)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ------------------------------------------------------- additional work */

function AdditionalWorkPanel({
  locale,
  messages,
  workOrderId,
  capabilities,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: () => void;
}) {
  const [requests, setRequests] = useState<ReadState<ItemsOnly<AdditionalWorkRequest>> | null>(
    null
  );
  const [reloadCount, reload] = useReload();
  const [summary, setSummary] = useState('');
  const [required, setRequired] = useState('');
  const { pending, problem, attempt, run } = useCommand(messages, () => {
    reload();
    onChanged();
  });

  useEffect(() => {
    let cancelled = false;
    void listAdditionalWork(workOrderId).then((next) => {
      if (!cancelled) setRequests(next);
    });
    return () => {
      cancelled = true;
    };
  }, [workOrderId, reloadCount]);

  return (
    <Panel
      id="additional-work-heading"
      titleKey="quality.closure.additionalWorkHeading"
      messages={messages}
    >
      {capabilities.canRequestAdditionalWork ? (
        <form
          action={async () => {
            if (summary.trim().length === 0) return;
            const ok = await run(() =>
              requestAdditionalWork(workOrderId, {
                summary: summary.trim(),
                ...(required === 'yes' ? { isRequired: true } : {}),
              })
            );
            if (ok) {
              setSummary('');
              setRequired('');
            }
          }}
          className="mb-3 flex flex-wrap items-end gap-3"
        >
          <TextField
            name="summary"
            label={translate(messages, 'quality.closure.additionalWorkSummary')}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            required
          />
          <SelectField
            key={`required-${attempt}`}
            name="isRequired"
            label={translate(messages, 'quality.closure.required')}
            defaultValue={required}
            onChange={(event) => setRequired(event.target.value)}
            options={[
              { value: 'yes', label: translate(messages, 'quality.closure.yes') },
              { value: 'no', label: translate(messages, 'quality.closure.no') },
            ]}
            placeholder={translate(messages, 'quality.closure.no')}
          />
          <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
            {translate(
              messages,
              pending ? 'quality.closure.recording' : 'quality.closure.requestWork'
            )}
          </button>
          <Problem messages={messages} problem={problem} />
        </form>
      ) : null}
      {requests === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : requests.status !== 'ok' ? (
        <ReadProblem messages={messages} state={requests} />
      ) : requests.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quality.closure.noAdditionalWork')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {requests.data.items.map((request) => (
            <AdditionalWorkRow
              key={request.id}
              locale={locale}
              messages={messages}
              request={request}
              capabilities={capabilities}
              onChanged={() => {
                reload();
                onChanged();
              }}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AdditionalWorkRow({
  locale,
  messages,
  request,
  capabilities,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly request: AdditionalWorkRequest;
  readonly capabilities: ClosureCapabilities;
  readonly onChanged: () => void;
}) {
  const [approval, setApproval] = useState<ReadState<CustomerApproval> | null>(null);
  const [detail, setDetail] = useState<ReadState<AdditionalWorkDetail> | null>(null);
  const [description, setDescription] = useState('');
  const [decision, setDecision] = useState('');
  const [channel, setChannel] = useState('');
  const [decidingPartyRoleId, setDecidingPartyRoleId] = useState('');
  const [presentedScope, setPresentedScope] = useState('');
  const [fulfillment, setFulfillment] = useState('');
  const [reason, setReason] = useState('');
  const { pending, problem, attempt, run } = useCommand(messages, onChanged);
  const [approvalPending, setApprovalPending] = useState(false);
  const [approvalProblem, setApprovalProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void readAdditionalWorkApproval(request.id).then((next) => {
      if (!cancelled) setApproval(next);
    });
    if (capabilities.canViewSensitive) {
      void readAdditionalWorkDetail(request.id).then((next) => {
        if (!cancelled) setDetail(next);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [request.id, request.recordVersion, capabilities.canViewSensitive]);

  /*
   * The approval is version-guarded on the request's version this row was
   * rendered from; `onChanged` re-reads the list so the version is renewed.
   */
  /*
   * The approval is version-guarded on the request's version this row was
   * rendered from; `onChanged` re-reads the list so the version is renewed.
   * Called directly, not through `run`, so the outcome is visibly handed onward.
   */
  const approve = async () => {
    if (
      !decision ||
      !channel ||
      decidingPartyRoleId.trim().length === 0 ||
      presentedScope.trim().length === 0
    ) {
      return;
    }
    setApprovalPending(true);
    setApprovalProblem(null);
    const outcome = await recordAdditionalWorkApproval(
      request.id,
      {
        decision: decision as (typeof DECISIONS)[number],
        channel: channel as (typeof CHANNELS)[number],
        decidingPartyRoleId: decidingPartyRoleId.trim(),
        presentedScope: presentedScope.trim(),
      },
      request.recordVersion
    );
    setApprovalPending(false);
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      setDecision('');
      setChannel('');
      setDecidingPartyRoleId('');
      setPresentedScope('');
      onChanged();
      return;
    }
    setApprovalProblem(problemKeyOf(outcome));
  };

  return (
    <li className="rounded-md border border-border p-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-body font-medium text-text-primary">
          <bdi>{request.summary}</bdi>
        </span>
        <code className="font-mono text-caption" dir="ltr">
          {request.state}
        </code>
        <code className="font-mono text-caption" dir="ltr">
          {request.fulfillmentState}
        </code>
        {request.isRequired ? (
          <span className="text-caption text-text-muted">
            {translate(messages, 'quality.closure.required')}
          </span>
        ) : null}
        <span className="ms-auto text-caption text-text-muted">
          {formatDateTime(request.createdAt, locale)}
        </span>
      </div>
      {capabilities.canViewSensitive ? (
        <p className="mt-1 text-caption text-text-secondary">
          {translate(messages, 'quality.closure.description')}:{' '}
          {detail === null
            ? translate(messages, 'state.loading')
            : detail.status === 'ok'
              ? detail.data.description
              : detail.status === 'not-found'
                ? translate(messages, 'quality.closure.noDescription')
                : translateDynamic(messages, `state.${detail.status}.title`)}
        </p>
      ) : null}
      <p className="mt-1 text-caption text-text-secondary">
        {translate(messages, 'quality.closure.approval')}:{' '}
        {approval === null
          ? translate(messages, 'state.loading')
          : approval.status === 'ok'
            ? `${translateDynamic(messages, `quality.decision.${approval.data.decision}`)} · ${translateDynamic(messages, `quality.channel.${approval.data.channel}`)} · ${formatDateTime(approval.data.decidedAt, locale)}`
            : approval.status === 'not-found'
              ? translate(messages, 'quality.closure.noApproval')
              : translateDynamic(messages, `state.${approval.status}.title`)}
      </p>
      {capabilities.canRequestAdditionalWork && capabilities.canViewSensitive ? (
        <form
          action={async () => {
            if (description.trim().length === 0) return;
            const ok = await run(() =>
              recordAdditionalWorkDetail(request.id, { description: description.trim() })
            );
            if (ok) setDescription('');
          }}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <TextField
            name={`description-${request.id}`}
            label={translate(messages, 'quality.closure.description')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
          <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
            {translate(messages, 'quality.closure.recordDescription')}
          </button>
        </form>
      ) : null}
      {capabilities.canApproveAdditionalWork && approval?.status === 'not-found' ? (
        <form action={() => void approve()} className="mt-2 flex flex-wrap items-end gap-2">
          <SelectField
            key={`decision-${request.id}-${attempt}`}
            name={`decision-${request.id}`}
            label={translate(messages, 'quality.closure.decision')}
            defaultValue={decision}
            onChange={(event) => setDecision(event.target.value)}
            options={DECISIONS.map((value) => ({
              value,
              label: translate(messages, `quality.decision.${value}` as keyof Messages),
            }))}
            placeholder={translate(messages, 'quality.closure.chooseDecision')}
            required
          />
          <SelectField
            key={`channel-${request.id}-${attempt}`}
            name={`channel-${request.id}`}
            label={translate(messages, 'quality.closure.channel')}
            defaultValue={channel}
            onChange={(event) => setChannel(event.target.value)}
            options={CHANNELS.map((value) => ({
              value,
              label: translate(messages, `quality.channel.${value}` as keyof Messages),
            }))}
            placeholder={translate(messages, 'quality.closure.chooseChannel')}
            required
          />
          <TextField
            name={`decidingPartyRoleId-${request.id}`}
            label={translate(messages, 'quality.closure.decidingParty')}
            description={translate(messages, 'quality.closure.decidingPartyHint')}
            value={decidingPartyRoleId}
            onChange={(event) => setDecidingPartyRoleId(event.target.value)}
            dir="ltr"
            required
          />
          <TextField
            name={`presentedScope-${request.id}`}
            label={translate(messages, 'quality.closure.presentedScope')}
            value={presentedScope}
            onChange={(event) => setPresentedScope(event.target.value)}
            required
          />
          <button type="submit" disabled={approvalPending} className={PRIMARY_BUTTON}>
            {translate(messages, 'quality.closure.recordApproval')}
          </button>
          <Problem messages={messages} problem={approvalProblem} />
        </form>
      ) : null}
      {capabilities.canRequestAdditionalWork ? (
        <form
          action={async () => {
            if (fulfillment) {
              const ok = await run(() =>
                fulfillAdditionalWork(request.id, {
                  fulfillmentState: fulfillment as (typeof FULFILLMENT)[number],
                  ...(reason.trim().length > 0 ? { reason: reason.trim() } : {}),
                })
              );
              if (ok) {
                setFulfillment('');
                setReason('');
              }
              return;
            }
            if (reason.trim().length === 0) return;
            const ok = await run(() =>
              withdrawAdditionalWork(request.id, { reason: reason.trim() })
            );
            if (ok) setReason('');
          }}
          className="mt-2 flex flex-wrap items-end gap-2"
        >
          <SelectField
            key={`fulfillment-${request.id}-${attempt}`}
            name={`fulfillment-${request.id}`}
            label={translate(messages, 'quality.closure.fulfillment')}
            defaultValue={fulfillment}
            onChange={(event) => setFulfillment(event.target.value)}
            options={FULFILLMENT.map((value) => ({
              value,
              label: translate(messages, `quality.fulfillment.${value}` as keyof Messages),
            }))}
            placeholder={translate(messages, 'quality.closure.withdrawInstead')}
          />
          <TextField
            name={`reason-${request.id}`}
            label={translate(messages, 'quality.closure.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <button type="submit" disabled={pending} className={SECONDARY_BUTTON}>
            {translate(
              messages,
              fulfillment ? 'quality.closure.recordFulfillment' : 'quality.closure.withdraw'
            )}
          </button>
        </form>
      ) : null}
      <Problem messages={messages} problem={problem} />
    </li>
  );
}

/* --------------------------------------------------------------- closure */

function ClosurePanel({
  messages,
  workOrderId,
  detail,
  eligibility,
  capabilities,
  onDone,
}: {
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly detail: ReadState<WorkOrderDetail> | null;
  readonly eligibility: ReadState<ClosureEligibility> | null;
  readonly capabilities: ClosureCapabilities;
  readonly onDone: () => void;
}) {
  const [toState, setToState] = useState('');
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  if (!capabilities.canTransition || !capabilities.canClose) return null;
  if (detail === null || detail.status !== 'ok') return null;
  const targets = detail.data.nextStates.filter((s) => s.isTerminal && !s.isCancellation);
  const chosen = targets.find((s) => s.code === toState) ?? null;
  const version = detail.data.workOrder.recordVersion;
  const eligible = eligibility?.status === 'ok' && eligibility.data.eligible;

  /*
   * Version-guarded: the `If-Match` is the order's version the detail carried,
   * and `onDone` re-reads the detail and the eligibility after every attempt —
   * a refused closure still names, in the eligibility, what stands in the way.
   */
  const close = async () => {
    if (chosen === null) return;
    if (chosen.requiresReason && reason.trim().length === 0) {
      setProblem('quality.closure.reasonRequired');
      return;
    }
    setPending(true);
    setProblem(null);
    const outcome = await closeWorkOrder(
      workOrderId,
      { toState: chosen.code, ...(reason.trim().length > 0 ? { reason: reason.trim() } : {}) },
      version
    );
    setPending(false);
    setAttempt((n) => n + 1);
    notifyActionResult(outcome, messages);
    if (outcome.status === 'success') {
      setToState('');
      setReason('');
      onDone();
      return;
    }
    setProblem(problemKeyOf(outcome));
    onDone();
  };

  return (
    <Panel id="closure-heading" titleKey="quality.closure.closeHeading" messages={messages}>
      {targets.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'quality.closure.noClosureTarget')}
        </p>
      ) : (
        <form action={() => void close()} className="flex flex-wrap items-end gap-3">
          <SelectField
            key={`toState-${attempt}`}
            name="toState"
            label={translate(messages, 'quality.closure.closeTo')}
            defaultValue={toState}
            onChange={(event) => setToState(event.target.value)}
            options={targets.map((s) => ({ value: s.code, label: s.code }))}
            placeholder={translate(messages, 'quality.closure.chooseState')}
            required
          />
          <TextField
            name="reason"
            label={translate(messages, 'quality.closure.reason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required={chosen?.requiresReason ?? false}
          />
          <button
            type="submit"
            disabled={pending || chosen === null || !eligible}
            className={PRIMARY_BUTTON}
          >
            {translate(messages, pending ? 'quality.closure.closing' : 'quality.closure.close')}
          </button>
          {!eligible ? (
            <p className="basis-full text-caption text-text-muted">
              {translate(messages, 'quality.closure.closeBlocked')}
            </p>
          ) : null}
          <Problem messages={messages} problem={problem} />
        </form>
      )}
    </Panel>
  );
}
