'use client';

import { useCallback, useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import { listDocumentCategories } from '@/features/attachments/api';
import { documentCategoryLabel } from '@/features/attachments/attachments-contract';
import { CaptureFileField } from '@/features/receptions/components/CaptureFileField';
import { DateTimeField } from '@/components/forms/mui/DateField';
import { FormSelectField } from '@/components/forms/mui/FormSelectField';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import { useReread } from '@/lib/api/use-reread';
import type { BranchTarget, CursorPage, ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import {
  assignmentRoleLabel,
  jobStateLabel,
  workOrderStateLabel,
} from '@/features/work-orders/work-orders-contract';
import type { Messages } from '@/i18n/get-messages';
import { formatMessage, translate, translateDynamic } from '@/i18n/get-messages';
import {
  captureJobEvidence,
  correctLaborSession,
  listJobEvidence,
  listLaborSessions,
  listWorkLog,
  recordWorkLog,
  resolveOwnAssignment,
  startLaborSession,
  stopLaborSession,
} from '../api';
import {
  unattachedRefusalKey,
  type LaborSession,
  type OwnAssignment,
  type TechnicianQueueEntry,
  type WorkLogEntry,
} from '../technicians-contract';
import { useHeldRefusal } from '@/lib/forms/use-local-refusal';

/**
 * One job of the technician's queue, opened for execution (P1-29, `W4`).
 *
 * ## The first thing this panel does is confirm whose job it is
 *
 * Before any write control is offered, the caller's own assignment is resolved
 * through `resolveOwnAssignment` — the queue row's `assignmentId` matched in
 * the job's assignment list — and the profile that comes back is the ONLY one
 * any write below is made against. The panel never receives a technician id
 * from a prop, a query string or a field; it learns it from the server and
 * passes the assignment back, and the adapter resolves it again on each write.
 *
 * ## Three authorities, three panels, three refusals
 *
 * Recording labour and notes needs `tech.labor.record`; reading the job's log
 * and evidence needs `wo.work_order.read`; capturing a document needs
 * `shared.document.manage` on top of recording. Each panel refuses on its own,
 * so a technician who may clock but may not read the log still sees their
 * clock. **These are affordances, never enforcement** — the backend decides
 * every one again.
 *
 * ## What is deliberately NOT here
 *
 * No pause (the platform has none — stopping the clock is the act), no job
 * transition (`wo.job.transition` is a separate authority this slice does not
 * consume), no edit or delete of a note (the table admits neither), no action
 * vocabulary on a note (no column holds one), and no timer kept as though it
 * were the record — elapsed time is derived from the server's `startedAt` and
 * nothing else.
 *
 * ## On the shared Material wrappers (ADR-022, Owner directive slice 4)
 *
 * The moments — a correction's start and end, a note's "when the work
 * happened" — are `DateTimeField`s on the working branch's clock (this route
 * serves one concrete branch), emitted with that branch's offset for that
 * moment. The native `datetime-local` boxes they replace were read on the
 * laptop's clock and converted with `new Date(…)`, so a technician on a laptop
 * set to another zone recorded the wrong hour. Every write stays busy until the
 * list it changed has been read again (`useReread`); a missing field is refused
 * on itself with the cursor moved there; and typed work is unsaved work.
 */
export interface WorkspaceCapabilities {
  readonly canRecordLabor: boolean;
  readonly canCorrectLabor: boolean;
  readonly canReadWork: boolean;
  readonly canCaptureDocuments: boolean;
}

export function JobWorkPanel({
  locale,
  messages,
  target,
  entry,
  capabilities,
  onBack,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: BranchTarget;
  readonly entry: TechnicianQueueEntry;
  readonly capabilities: WorkspaceCapabilities;
  readonly onBack: () => void;
}) {
  // Keyed on the branch's two ids, never on the `target` object:
  // `useBranchTarget` builds a new object on every render, and the screen
  // re-renders on working-context changes that do not move the branch — the
  // "discard unsaved work?" dialog opening and closing among them. A new read is
  // a new record to `useReread`, so keying on the object dropped the answer,
  // unmounted the work-log and evidence forms (and the file chosen in them) and
  // turned Stop into Start exactly when the operator chose to keep their work.
  const { companyId, branchId } = target;
  const resolve = useCallback(
    () => resolveOwnAssignment({ companyId, branchId }, entry.jobId, entry.assignmentId),
    [companyId, branchId, entry.jobId, entry.assignmentId]
  );
  const own = useReread(resolve).value;
  const identity = own !== null && own.status === 'ok' ? own.data : null;
  const t = (key: string) => translateDynamic(messages, key);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-section-title font-medium text-text-primary">
          <bdi>{entry.jobTitle}</bdi>
        </h2>
        <Button type="button" variant="outlined" onClick={onBack}>
          {translate(messages, 'technicians.workspace.close')}
        </Button>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-body sm:grid-cols-2">
        <Fact
          label={translate(messages, 'technicians.workspace.workOrder')}
          value={`${entry.displayNumber ?? translate(messages, 'workOrders.queue.column.noReference')} · ${workOrderStateLabel(entry.workOrderState, [], t)}`}
        />
        <Fact
          label={translate(messages, 'technicians.workspace.jobState')}
          value={jobStateLabel(entry.jobState, t)}
        />
        <Fact
          label={translate(messages, 'technicians.workspace.role')}
          value={assignmentRoleLabel(entry.assignmentRole, t)}
        />
        <Fact
          label={translate(messages, 'technicians.workspace.since')}
          value={formatDateTime(entry.validFrom, locale)}
        />
      </dl>

      {own === null ? (
        <p role="status" className="text-caption text-text-muted">
          {translate(messages, 'technicians.workspace.identityResolving')}
        </p>
      ) : own.status !== 'ok' ? (
        <p role="alert" className="text-body text-error">
          {translate(messages, 'technicians.workspace.identityRefused')}
          {own.correlationId
            ? ` ${translate(messages, 'action.reference')} ${own.correlationId}`
            : ''}
        </p>
      ) : null}

      <LaborPanel
        locale={locale}
        messages={messages}
        target={target}
        entry={entry}
        identity={identity}
        canRecordLabor={capabilities.canRecordLabor}
        canCorrectLabor={capabilities.canCorrectLabor}
      />

      {capabilities.canReadWork ? (
        <>
          <WorkLogPanel
            locale={locale}
            messages={messages}
            target={target}
            entry={entry}
            identity={identity}
            canRecordLabor={capabilities.canRecordLabor}
          />
          <EvidencePanel
            locale={locale}
            messages={messages}
            target={target}
            entry={entry}
            identity={identity}
            canCapture={capabilities.canRecordLabor && capabilities.canCaptureDocuments}
          />
        </>
      ) : (
        <p className="text-body text-text-secondary">
          {translate(messages, 'technicians.workspace.noWorkReadPermission')}
        </p>
      )}
    </div>
  );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-text-primary">
        <bdi>{value}</bdi>
      </dd>
    </div>
  );
}

function problemKeyOf(result: ActionState, conflictKey: string): string {
  if (result.status === 'conflict') return conflictKey;
  return result.messageKey ?? 'action.failed';
}

/**
 * The first page of a cursor-paged list, awaited on re-read, and the older
 * pages the operator asked for after it. The older pages belong to the first
 * page they were read after: a re-read drops them, so a page read before a
 * write is never shown beside the list the write produced.
 */
function usePagedList<Row>(
  read: () => Promise<ReadState<CursorPage<Row>>>,
  readMore: (cursor: string) => Promise<ReadState<CursorPage<Row>>>
) {
  const first = useReread(read);
  const firstRead = first.value;
  const [older, setOlder] = useState<{
    readonly after: unknown;
    readonly rows: readonly Row[];
    readonly cursor: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const current = older !== null && older.after === firstRead ? older : null;
  const rows =
    firstRead?.status === 'ok' ? [...firstRead.data.items, ...(current?.rows ?? [])] : [];
  const nextCursor =
    firstRead?.status !== 'ok'
      ? null
      : current === null
        ? firstRead.data.hasMore
          ? firstRead.data.nextCursor
          : null
        : current.cursor;
  const loadOlder = async () => {
    if (nextCursor === null || loading) return;
    setLoading(true);
    try {
      const next = await readMore(nextCursor);
      if (next.status !== 'ok') return;
      setOlder({
        after: firstRead,
        rows: [...(current?.rows ?? []), ...next.data.items],
        cursor: next.data.hasMore ? next.data.nextCursor : null,
      });
    } finally {
      setLoading(false);
    }
  };
  return {
    first: firstRead,
    rows,
    moreExists: nextCursor !== null,
    loadOlder,
    loading,
    reload: first.reload,
  };
}

/* ------------------------------------------------------------------ *
 * Labour
 * ------------------------------------------------------------------ */

function LaborPanel({
  locale,
  messages,
  target,
  entry,
  identity,
  canRecordLabor,
  canCorrectLabor,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: BranchTarget;
  readonly entry: TechnicianQueueEntry;
  readonly identity: OwnAssignment | null;
  readonly canRecordLabor: boolean;
  readonly canCorrectLabor: boolean;
}) {
  const read = useCallback(() => listLaborSessions(entry.jobId), [entry.jobId]);
  const readMore = useCallback(
    (cursor: string) => listLaborSessions(entry.jobId, cursor),
    [entry.jobId]
  );
  const list = usePagedList<LaborSession>(read, readMore);
  const reload = list.reload;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * A refused correction, by the session it was refused on.
   *
   * `tech.labor-session-correct` publishes `body.endedAt` when the window ends
   * at or before it starts and `body.startedAt` when it overlaps a session
   * already recorded. Both name a control the correction form really has, so
   * both belong beside it — and the form stays open with the times as typed,
   * because the cure is to adjust them rather than to start again.
   */
  const [correctionErrors, setCorrectionErrors] = useState<
    Readonly<Record<string, Readonly<Record<string, string>>>>
  >({});

  const sessions = list.rows;
  const active =
    identity === null
      ? null
      : (sessions.find(
          (session) =>
            session.endedAt === null && session.technicianProfileId === identity.technicianProfileId
        ) ?? null);

  /**
   * Sends one command and reports it, then waits for the sessions to be read
   * again before the clock is offered again. The outcome is handed back so a
   * caller can place the refusal where the reader can act on it.
   *
   * The clock refusals — a colleague's profile, an inactive profile, a session
   * already running — are all published against the profile the adapter
   * resolved, which is no control here, so `unattachedRefusalKey` lifts their
   * sentence into this panel's alert instead of leaving it unread.
   */
  const run = async (
    action: () => Promise<ActionState>,
    renew: () => Promise<void>
  ): Promise<ActionState> => {
    setProblem(null);
    setBusy(true);
    try {
      let result: ActionState;
      try {
        result = await action();
      } catch {
        setProblem('state.unavailable.message');
        return { status: 'unavailable', messageKey: 'state.unavailable.message' };
      }
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        // The truth is re-read; nothing is patched locally.
        await renew();
      } else {
        setProblem(
          unattachedRefusalKey(result.fieldErrors) ??
            problemKeyOf(result, 'technicians.workspace.conflict')
        );
      }
      return result;
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    await run(
      () => startLaborSession(target, entry.jobId, entry.assignmentId),
      () => reload()
    );
  };

  const stop = async (session: LaborSession) => {
    await run(
      () =>
        stopLaborSession(
          target,
          entry.jobId,
          entry.assignmentId,
          session.id,
          // The version on screen, never one fetched for the purpose.
          session.recordVersion
        ),
      () => reload()
    );
  };

  const correct = async (
    session: LaborSession,
    body: { startedAt: string; endedAt: string; reason: string }
  ): Promise<boolean> => {
    const result = await run(
      () =>
        correctLaborSession(
          target,
          entry.jobId,
          entry.assignmentId,
          session.id,
          body,
          session.recordVersion
        ),
      () => reload()
    );
    const moved = result.status === 'success';
    setCorrectionErrors((current) => ({
      ...current,
      [session.id]: moved ? {} : (result.fieldErrors ?? {}),
    }));
    return moved;
  };

  const first = list.first;

  return (
    <section aria-labelledby="labor-heading" className="flex flex-col gap-3">
      <h3 id="labor-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'technicians.workspace.laborHeading')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'technicians.workspace.laborNote')}
      </p>

      {!canRecordLabor ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'technicians.workspace.noLaborPermission')}
        </p>
      ) : identity === null ? null : active === null ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-body text-text-secondary">
            {translate(messages, 'technicians.workspace.noActiveSession')}
          </span>
          <Button
            type="button"
            variant="contained"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void start()}
          >
            {translate(
              messages,
              busy ? 'technicians.workspace.starting' : 'technicians.workspace.start'
            )}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-body text-text-primary">
            {translate(messages, 'technicians.workspace.activeSession')}{' '}
            <bdi>{formatDateTime(active.startedAt, locale)}</bdi> ·{' '}
            <Elapsed since={active.startedAt} messages={messages} />
          </span>
          <Button
            type="button"
            variant="contained"
            disabled={busy}
            aria-busy={busy || undefined}
            onClick={() => void stop(active)}
          >
            {translate(
              messages,
              busy ? 'technicians.workspace.stopping' : 'technicians.workspace.stop'
            )}
          </Button>
        </div>
      )}

      {problem === null ? null : (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, problem)}
        </p>
      )}

      <h4 className="text-body font-medium text-text-primary">
        {translate(messages, 'technicians.workspace.sessionsHeading')}
      </h4>
      {first === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : first.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={first.status}
          correlationId={first.correlationId}
          onRetry={() => void reload()}
        />
      ) : sessions.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'technicians.workspace.noSessions')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((session) => (
            <li key={session.id} className="rounded-md border border-border bg-surface p-3">
              <SessionRow
                locale={locale}
                messages={messages}
                session={session}
                mine={
                  identity !== null && session.technicianProfileId === identity.technicianProfileId
                }
                canCorrect={canCorrectLabor && identity !== null}
                busy={busy}
                fieldErrors={correctionErrors[session.id] ?? {}}
                onCorrect={(body) => correct(session, body)}
              />
            </li>
          ))}
        </ul>
      )}
      {list.moreExists ? (
        <div>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() => void list.loadOlder()}
            disabled={list.loading}
          >
            {translate(messages, 'technicians.workspace.olderSessions')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/** Elapsed time from the SERVER's start instant. The screen keeps no clock of its own. */
function Elapsed({ since, messages }: { readonly since: string; readonly messages: Messages }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const minutes = Math.max(0, Math.floor((now - new Date(since).getTime()) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return (
    <span>
      {translate(messages, 'technicians.workspace.elapsed')}{' '}
      <bdi>
        {formatMessage(translate(messages, 'technicians.workspace.elapsedValue'), {
          hours: String(hours),
          minutes: String(rest),
        })}
      </bdi>
    </span>
  );
}

function SessionRow({
  locale,
  messages,
  session,
  mine,
  canCorrect,
  busy,
  fieldErrors,
  onCorrect,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly session: LaborSession;
  readonly mine: boolean;
  readonly canCorrect: boolean;
  readonly busy: boolean;
  /** Catalogue keys by control name, for a correction the platform refused. */
  readonly fieldErrors: Readonly<Record<string, string>>;
  readonly onCorrect: (body: {
    startedAt: string;
    endedAt: string;
    reason: string;
  }) => Promise<boolean>;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [startedAt, setStartedAt] = useState(session.startedAt);
  const [endedAt, setEndedAt] = useState(session.endedAt ?? '');
  const [reason, setReason] = useState('');
  const [localErrors, setLocalErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(
    Object.keys(localErrors).length > 0 ? localErrors : fieldErrors,
    { startedAt, endedAt, reason }
  );

  const discard = () => {
    setStartedAt(session.startedAt);
    setEndedAt(session.endedAt ?? '');
    setReason('');
    setLocalErrors({});
  };
  /*
   * Unsaved work, declared to the shell, so a branch changed in the header asks
   * before it discards what is typed here: a typed reason, or a time moved from
   * what the session holds.
   */
  useUnsavedGuard(
    correcting &&
      (reason.trim().length > 0 ||
        startedAt !== session.startedAt ||
        endedAt !== (session.endedAt ?? '')),
    discard
  );

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const who = translate(
    messages,
    mine ? 'technicians.workspace.session.mine' : 'technicians.workspace.session.other'
  );
  const end =
    session.endedAt === null
      ? translate(messages, 'technicians.workspace.session.open')
      : formatDateTime(session.endedAt, locale);

  const submit = () => {
    const missing: Record<string, string> = {};
    if (startedAt === '') missing['startedAt'] = 'field.required';
    if (endedAt === '') missing['endedAt'] = 'field.required';
    if (startedAt !== '' && endedAt !== '' && Date.parse(endedAt) <= Date.parse(startedAt)) {
      missing['endedAt'] = 'technicians.workspace.correctInverted';
    }
    if (reason.trim().length === 0) missing['reason'] = 'field.required';
    setLocalErrors(missing);
    if (Object.keys(missing).length > 0) return;
    // The form closes only when the correction was accepted. A refused one
    // keeps both times exactly as they were typed, beside the sentence saying
    // what is wrong with them.
    void onCorrect({ startedAt, endedAt, reason: reason.trim() }).then((moved) => {
      if (!moved) return;
      setCorrecting(false);
      /*
       * The reason is CLEARED, because it has been recorded.
       *
       * Leaving it would strand the unsaved-work guard: the draft still held
       * text, so the shell went on asking "discard your unsaved work?" on every
       * branch switch for the rest of the session, for a correction that was
       * accepted minutes ago. A guard that is always dirty teaches an operator
       * to dismiss the question without reading it, which is worse than not
       * asking.
       */
      setReason('');
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-body">
        <span className="text-text-primary">
          {who} · <bdi>{formatDateTime(session.startedAt, locale)}</bdi> → <bdi>{end}</bdi>
          {session.correctionOfId === null
            ? ''
            : ` · ${translate(messages, 'technicians.workspace.session.correction')}`}
        </span>
        {/* A correction is offered only on the technician's OWN stopped sessions. */}
        {canCorrect && mine && session.endedAt !== null ? (
          <Button
            type="button"
            variant="outlined"
            size="small"
            aria-expanded={correcting}
            onClick={() => {
              if (correcting) discard();
              setCorrecting((value) => !value);
            }}
          >
            {translate(messages, 'technicians.workspace.correctHeading')}
          </Button>
        ) : null}
      </div>
      {correcting ? (
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            submit();
          }}
          className="grid gap-3 sm:grid-cols-2"
        >
          <DateTimeField
            messages={messages}
            label={translate(messages, 'technicians.workspace.correctStartedAt')}
            name={`startedAt-${session.id}`}
            value={startedAt}
            onChange={setStartedAt}
            error={errorFor('startedAt')}
            required
          />
          <DateTimeField
            messages={messages}
            label={translate(messages, 'technicians.workspace.correctEndedAt')}
            name={`endedAt-${session.id}`}
            value={endedAt}
            onChange={setEndedAt}
            min={startedAt === '' ? undefined : startedAt}
            error={errorFor('endedAt')}
            required
          />
          <FormTextField
            label={translate(messages, 'technicians.workspace.correctReason')}
            name={`reason-${session.id}`}
            value={reason}
            onChange={setReason}
            error={errorFor('reason')}
            required
          />
          <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
            <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
              {busy
                ? translate(messages, 'form.pending')
                : translate(messages, 'technicians.workspace.correctSubmit')}
            </Button>
            <p className="text-caption text-text-muted">
              {translate(messages, 'technicians.workspace.correctNote')}
            </p>
          </div>
        </form>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Work log
 * ------------------------------------------------------------------ */

function WorkLogPanel({
  locale,
  messages,
  target,
  entry,
  identity,
  canRecordLabor,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: BranchTarget;
  readonly entry: TechnicianQueueEntry;
  readonly identity: OwnAssignment | null;
  readonly canRecordLabor: boolean;
}) {
  const read = useCallback(() => listWorkLog(entry.jobId), [entry.jobId]);
  const readMore = useCallback((cursor: string) => listWorkLog(entry.jobId, cursor), [entry.jobId]);
  const list = usePagedList<WorkLogEntry>(read, readMore);
  const [text, setText] = useState('');
  const [loggedAt, setLoggedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(fieldErrors, { entry: text, loggedAt });

  /*
   * Unsaved work, declared to the shell, so a branch changed in the header asks
   * before it discards what is typed here.
   */
  useUnsavedGuard(text.trim().length > 0 || loggedAt.length > 0, () => {
    setText('');
    setLoggedAt('');
    setFieldErrors({});
  });

  const add = async () => {
    setProblem(null);
    if (text.trim().length === 0) {
      setFieldErrors({ entry: 'field.required' });
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      let result: ActionState;
      try {
        result = await recordWorkLog(target, entry.jobId, entry.assignmentId, {
          entry: text.trim(),
          // Omitted unless the technician said when: the backend then stamps now.
          // Otherwise the moment as the field holds it, with the branch's offset.
          ...(loggedAt.length > 0 ? { loggedAt } : {}),
        });
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(result, messages);
      if (result.status === 'success') {
        setText('');
        setLoggedAt('');
        await list.reload();
        return;
      }
      if (result.fieldErrors) setFieldErrors(result.fieldErrors);
      setProblem(problemKeyOf(result, 'technicians.workspace.conflict'));
    } finally {
      setBusy(false);
    }
  };

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const first = list.first;

  return (
    <section aria-labelledby="work-log-heading" className="flex flex-col gap-3">
      <h3 id="work-log-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'technicians.workspace.workLogHeading')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'technicians.workspace.workLogNote')}
      </p>

      {canRecordLabor && identity !== null ? (
        <form
          ref={formRef}
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            void add();
          }}
          className="flex flex-col gap-3"
        >
          <FormTextField
            label={translate(messages, 'technicians.workspace.entry')}
            name="entry"
            value={text}
            onChange={setText}
            error={errorFor('entry')}
            multiline
            rows={3}
            required
          />
          <div className="flex flex-wrap items-start gap-3">
            <DateTimeField
              messages={messages}
              label={translate(messages, 'technicians.workspace.loggedAt')}
              name="loggedAt"
              description={translate(messages, 'technicians.workspace.loggedAtHint')}
              value={loggedAt}
              onChange={setLoggedAt}
              error={errorFor('loggedAt')}
            />
            <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
              {translate(
                messages,
                busy ? 'technicians.workspace.adding' : 'technicians.workspace.addEntry'
              )}
            </Button>
          </div>
        </form>
      ) : null}

      {problem === null ? null : (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, problem)}
        </p>
      )}

      {first === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : first.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={first.status}
          correlationId={first.correlationId}
          onRetry={() => void list.reload()}
        />
      ) : list.rows.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'technicians.workspace.noWorkLog')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.rows.map((item) => (
            <li key={item.id} className="rounded-md border border-border bg-surface p-3">
              {/* Rendered as written. No edit and no delete exist to be offered. */}
              <p className="whitespace-pre-wrap text-body text-text-primary">
                <bdi>{item.entry}</bdi>
              </p>
              <p className="text-caption text-text-muted">
                {translate(messages, 'technicians.workspace.loggedAt')}{' '}
                <bdi>{formatDateTime(item.loggedAt, locale)}</bdi> ·{' '}
                {translate(messages, 'technicians.workspace.recordedAt')}{' '}
                <bdi>{formatDateTime(item.createdAt, locale)}</bdi>
              </p>
            </li>
          ))}
        </ul>
      )}
      {list.moreExists ? (
        <div>
          <Button
            type="button"
            variant="outlined"
            size="small"
            onClick={() => void list.loadOlder()}
            disabled={list.loading}
          >
            {translate(messages, 'technicians.workspace.olderEntries')}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Evidence
 * ------------------------------------------------------------------ */

function EvidencePanel({
  locale,
  messages,
  target,
  entry,
  identity,
  canCapture,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: BranchTarget;
  readonly entry: TechnicianQueueEntry;
  readonly identity: OwnAssignment | null;
  readonly canCapture: boolean;
}) {
  const readEvidence = useCallback(() => listJobEvidence(entry.jobId), [entry.jobId]);
  const list = useReread(readEvidence);
  const categories = useReread(canCapture ? listDocumentCategories : null);
  const [categoryCode, setCategoryCode] = useState('');
  const [evidenceType, setEvidenceType] = useState('');
  const [note, setNote] = useState('');
  /*
   * The form's EPOCH. React resets a `<form action={…}>` after its Server
   * Action settles (`form-reset-class.test.ts`), so every control is keyed on a
   * counter that moves when the action settles and is controlled — the remount
   * shows exactly what the state holds: the entries after a refusal, nothing
   * after a success.
   */
  const [attempt, setAttempt] = useState(0);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  const { errors, formRef } = useHeldRefusal(fieldErrors, { categoryCode, evidenceType, note });

  /*
   * Unsaved work, declared to the shell, so a branch changed in the header asks
   * before it discards what is typed here.
   */
  useUnsavedGuard(
    note.trim().length > 0 || categoryCode.length > 0 || evidenceType.length > 0,
    () => {
      setCategoryCode('');
      setEvidenceType('');
      setNote('');
      setFieldErrors({});
      setAttempt((n) => n + 1);
    }
  );

  const categoryRead = categories.value;
  const categoryList = categoryRead?.status === 'ok' ? categoryRead.data.items : null;
  const category = categoryList?.find((each) => each.categoryCode === categoryCode);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
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
      let outcome: Awaited<ReturnType<typeof captureJobEvidence>>;
      try {
        outcome = await captureJobEvidence(target, entry.jobId, entry.assignmentId, formData);
      } catch {
        setProblem('state.unavailable.message');
        return;
      }
      notifyActionResult(outcome, messages);
      if (outcome.status === 'success') {
        // The CATEGORY is cleared with the rest of the draft, so the
        // unsaved-work guard does not stay dirty after a capture that
        // succeeded.
        setCategoryCode('');
        setEvidenceType('');
        setNote('');
        await list.reload();
        return;
      }
      if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);
      setProblem(
        outcome.stage === undefined
          ? (outcome.messageKey ?? 'action.failed')
          : 'technicians.workspace.capturedPartial'
      );
    } finally {
      setPending(false);
      setAttempt((n) => n + 1);
    }
  };

  const shown = list.value;

  return (
    <section aria-labelledby="evidence-heading" className="flex flex-col gap-3">
      <h3 id="evidence-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'technicians.workspace.evidenceHeading')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'technicians.workspace.evidenceNote')}
      </p>

      {canCapture && identity !== null ? (
        categoryRead === null ? (
          <MuiLoadingState messages={messages} variant="inline" />
        ) : categoryList === null || categoryList.length === 0 ? (
          <p className="text-body text-text-secondary">
            {translate(messages, 'technicians.workspace.noCategories')}
          </p>
        ) : (
          <form
            ref={formRef}
            noValidate
            action={capture}
            className="flex flex-wrap items-start gap-3"
          >
            <FormSelectField
              key={`categoryCode-${attempt}`}
              name="categoryCode"
              label={translate(messages, 'technicians.workspace.evidenceCategory')}
              value={categoryCode}
              onChange={setCategoryCode}
              options={categoryList.map((each) => ({
                value: each.categoryCode,
                label: documentCategoryLabel(each.categoryCode, (key) =>
                  translateDynamic(messages, key)
                ),
              }))}
              placeholder={translate(messages, 'technicians.workspace.evidenceCategory')}
              error={errorFor('categoryCode')}
              required
            />
            <FormTextField
              key={`evidenceType-${attempt}`}
              name="evidenceType"
              label={translate(messages, 'technicians.workspace.evidenceType')}
              description={translate(messages, 'technicians.workspace.evidenceTypeHint')}
              value={evidenceType}
              onChange={setEvidenceType}
              error={errorFor('evidenceType')}
              required
            />
            <FormTextField
              key={`note-${attempt}`}
              name="note"
              label={translate(messages, 'technicians.workspace.evidenceNoteField')}
              value={note}
              onChange={setNote}
              error={errorFor('note')}
            />
            <CaptureFileField
              name="evidenceFile"
              label={translate(messages, 'technicians.workspace.chooseFile')}
              // The SERVER's list for the chosen category, or nothing.
              accept={category?.allowedContentTypes}
            />
            <Button
              type="submit"
              variant="contained"
              disabled={pending}
              aria-busy={pending || undefined}
            >
              {translate(
                messages,
                pending ? 'technicians.workspace.attaching' : 'technicians.workspace.attach'
              )}
            </Button>
            {errorFor('evidenceFile') ? (
              <p role="alert" className="basis-full text-body text-error">
                {errorFor('evidenceFile')}
              </p>
            ) : null}
          </form>
        )
      ) : null}

      {problem === null ? null : (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, problem)}
        </p>
      )}

      {shown === null ? (
        <MuiLoadingState messages={messages} variant="inline" />
      ) : shown.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={shown.status}
          correlationId={shown.correlationId}
          onRetry={() => void list.reload()}
        />
      ) : shown.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'technicians.workspace.noEvidence')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.data.items.map((item) => (
            <li key={item.id} className="rounded-md border border-border bg-surface p-3">
              <p className="text-body text-text-primary">
                <bdi>{item.evidenceType}</bdi>
                {item.note === null ? null : (
                  <>
                    {' — '}
                    <bdi>{item.note}</bdi>
                  </>
                )}
              </p>
              <p className="text-caption text-text-muted">
                {translate(messages, 'technicians.workspace.recordedAt')}{' '}
                <bdi>{formatDateTime(item.createdAt, locale)}</bdi>
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
