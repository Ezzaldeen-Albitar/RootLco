'use client';

import { useCallback, useEffect, useState } from 'react';
import { listDocumentCategories } from '@/features/attachments/api';
import type { DocumentCategory } from '@/features/attachments/attachments-contract';
import { CaptureFileField } from '@/features/receptions/components/CaptureFileField';
import { SelectField, TextAreaField, TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { BranchTarget, CursorPage, ItemsOnly, ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
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
import type {
  JobEvidenceEntry,
  LaborSession,
  OwnAssignment,
  TechnicianQueueEntry,
  WorkLogEntry,
} from '../technicians-contract';

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
 */
export interface WorkspaceCapabilities {
  readonly canRecordLabor: boolean;
  readonly canCorrectLabor: boolean;
  readonly canReadWork: boolean;
  readonly canCaptureDocuments: boolean;
}

const SECONDARY_BUTTON =
  'rounded-md border border-border px-4 py-2 text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle disabled:opacity-60';
const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:opacity-60';

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
  const [own, setOwn] = useState<ReadState<OwnAssignment> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void resolveOwnAssignment(target, entry.jobId, entry.assignmentId).then((next) => {
      if (!cancelled) setOwn(next);
    });
    return () => {
      cancelled = true;
    };
  }, [target, entry.jobId, entry.assignmentId]);

  const identity = own !== null && own.status === 'ok' ? own.data : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-section-title font-medium text-text-primary">{entry.jobTitle}</h2>
        <button type="button" onClick={onBack} className={SECONDARY_BUTTON}>
          {translate(messages, 'technicians.workspace.close')}
        </button>
      </div>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-body sm:grid-cols-2">
        <Fact
          label={translate(messages, 'technicians.workspace.workOrder')}
          value={`${entry.displayNumber ?? entry.workOrderId} · ${entry.workOrderState}`}
        />
        <Fact
          label={translate(messages, 'technicians.workspace.jobState')}
          value={entry.jobState}
        />
        <Fact
          label={translate(messages, 'technicians.workspace.role')}
          value={entry.assignmentRole}
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
      <dd className="text-text-primary">{value}</dd>
    </div>
  );
}

/**
 * A read that can be re-issued, with the cancelled guard the lint rule wants.
 *
 * The function is named `reload` because that is what it is, and because
 * `check-p1-28-version-sourcing` recognises the name as a renewal: a panel that
 * sends a guarded command must be seen to re-read afterwards.
 */
function useReload(): readonly [number, () => void] {
  const [reloadCount, setReloadCount] = useState(0);
  const reload = useCallback(() => setReloadCount((n) => n + 1), []);
  return [reloadCount, reload];
}

function problemKeyOf(result: ActionState, conflictKey: string): string {
  if (result.status === 'conflict') return conflictKey;
  return result.messageKey ?? 'action.failed';
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
  const [page, setPage] = useState<ReadState<CursorPage<LaborSession>> | null>(null);
  const [older, setOlder] = useState<readonly LaborSession[]>([]);
  const [reloadCount, reload] = useReload();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void listLaborSessions(entry.jobId).then((next) => {
      if (cancelled) return;
      setPage(next);
      setOlder([]);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.jobId, reloadCount]);

  const sessions = page !== null && page.status === 'ok' ? [...page.data.items, ...older] : [];
  const active =
    identity === null
      ? null
      : (sessions.find(
          (session) =>
            session.endedAt === null && session.technicianProfileId === identity.technicianProfileId
        ) ?? null);

  /** Sends one command and reports it. True when the record moved and must be re-read. */
  const run = async (action: () => Promise<ActionState>): Promise<boolean> => {
    setProblem(null);
    setBusy(true);
    const result = await action();
    setBusy(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') return true;
    setProblem(problemKeyOf(result, 'technicians.workspace.conflict'));
    return false;
  };

  const start = async () => {
    if (await run(() => startLaborSession(target, entry.jobId, entry.assignmentId))) reload();
  };

  const stop = async (session: LaborSession) => {
    const moved = await run(() =>
      stopLaborSession(
        target,
        entry.jobId,
        entry.assignmentId,
        session.id,
        // The version on screen, never one fetched for the purpose.
        session.recordVersion
      )
    );
    // The truth is re-read; nothing is patched locally.
    if (moved) reload();
  };

  const correct = async (
    session: LaborSession,
    body: { startedAt: string; endedAt: string; reason: string }
  ) => {
    const moved = await run(() =>
      correctLaborSession(
        target,
        entry.jobId,
        entry.assignmentId,
        session.id,
        body,
        session.recordVersion
      )
    );
    if (moved) reload();
  };

  const loadOlder = async () => {
    if (page === null || page.status !== 'ok' || !page.data.hasMore) return;
    const cursor = older.length === 0 ? page.data.nextCursor : lastCursor;
    if (cursor === null) return;
    const next = await listLaborSessions(entry.jobId, cursor);
    if (next.status !== 'ok') return;
    setLastCursor(next.data.hasMore ? next.data.nextCursor : null);
    setOlder((current) => [...current, ...next.data.items]);
  };
  const [lastCursor, setLastCursor] = useState<string | null>(null);
  const moreExists =
    page !== null &&
    page.status === 'ok' &&
    page.data.hasMore &&
    (older.length === 0 || lastCursor !== null);

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
          <button
            type="button"
            disabled={busy}
            onClick={() => void start()}
            className={PRIMARY_BUTTON}
          >
            {translate(
              messages,
              busy ? 'technicians.workspace.starting' : 'technicians.workspace.start'
            )}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-body text-text-primary">
            {translate(messages, 'technicians.workspace.activeSession')}{' '}
            {formatDateTime(active.startedAt, locale)} ·{' '}
            <Elapsed since={active.startedAt} messages={messages} />
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={() => void stop(active)}
            className={PRIMARY_BUTTON}
          >
            {translate(
              messages,
              busy ? 'technicians.workspace.stopping' : 'technicians.workspace.stop'
            )}
          </button>
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
      {page === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : page.status !== 'ok' ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, `state.${page.status}.title`)}
          {page.correlationId
            ? ` ${translate(messages, 'action.reference')} ${page.correlationId}`
            : ''}
        </p>
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
                onCorrect={(body) => correct(session, body)}
              />
            </li>
          ))}
        </ul>
      )}
      {moreExists ? (
        <button type="button" onClick={() => void loadOlder()} className={SECONDARY_BUTTON}>
          {translate(messages, 'technicians.workspace.olderSessions')}
        </button>
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
      {translate(messages, 'technicians.workspace.elapsed')} {hours}h {rest}m
    </span>
  );
}

function SessionRow({
  locale,
  messages,
  session,
  mine,
  canCorrect,
  onCorrect,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly session: LaborSession;
  readonly mine: boolean;
  readonly canCorrect: boolean;
  readonly onCorrect: (body: {
    startedAt: string;
    endedAt: string;
    reason: string;
  }) => Promise<void>;
}) {
  const [correcting, setCorrecting] = useState(false);
  const [startedAt, setStartedAt] = useState(toLocalInput(session.startedAt));
  const [endedAt, setEndedAt] = useState(
    session.endedAt === null ? '' : toLocalInput(session.endedAt)
  );
  const [reason, setReason] = useState('');

  const who = translate(
    messages,
    mine ? 'technicians.workspace.session.mine' : 'technicians.workspace.session.other'
  );
  const end =
    session.endedAt === null
      ? translate(messages, 'technicians.workspace.session.open')
      : formatDateTime(session.endedAt, locale);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-body">
        <span className="text-text-primary">
          {who} · {formatDateTime(session.startedAt, locale)} → {end}
          {session.correctionOfId === null
            ? ''
            : ` · ${translate(messages, 'technicians.workspace.session.correction')}`}
        </span>
        {/* A correction is offered only on the technician's OWN stopped sessions. */}
        {canCorrect && mine && session.endedAt !== null ? (
          <button
            type="button"
            onClick={() => setCorrecting((value) => !value)}
            className={SECONDARY_BUTTON}
          >
            {translate(messages, 'technicians.workspace.correctHeading')}
          </button>
        ) : null}
      </div>
      {correcting ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (startedAt.length === 0 || endedAt.length === 0 || reason.trim().length === 0)
              return;
            void onCorrect({
              startedAt: new Date(startedAt).toISOString(),
              endedAt: new Date(endedAt).toISOString(),
              reason: reason.trim(),
            }).then(() => setCorrecting(false));
          }}
          className="flex flex-wrap items-end gap-3"
        >
          <TextField
            type="datetime-local"
            label={translate(messages, 'technicians.workspace.correctStartedAt')}
            value={startedAt}
            onChange={(event) => setStartedAt(event.target.value)}
            required
          />
          <TextField
            type="datetime-local"
            label={translate(messages, 'technicians.workspace.correctEndedAt')}
            value={endedAt}
            onChange={(event) => setEndedAt(event.target.value)}
            required
          />
          <TextField
            label={translate(messages, 'technicians.workspace.correctReason')}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            required
          />
          <button type="submit" className={PRIMARY_BUTTON}>
            {translate(messages, 'technicians.workspace.correctSubmit')}
          </button>
          <p className="basis-full text-caption text-text-muted">
            {translate(messages, 'technicians.workspace.correctNote')}
          </p>
        </form>
      ) : null}
    </div>
  );
}

/** An ISO instant as a `datetime-local` value, in the browser's own zone. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
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
  const [page, setPage] = useState<ReadState<CursorPage<WorkLogEntry>> | null>(null);
  const [older, setOlder] = useState<readonly WorkLogEntry[]>([]);
  const [lastCursor, setLastCursor] = useState<string | null>(null);
  const [reloadCount, reload] = useReload();
  const [text, setText] = useState('');
  const [loggedAt, setLoggedAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});

  useEffect(() => {
    let cancelled = false;
    void listWorkLog(entry.jobId).then((next) => {
      if (cancelled) return;
      setPage(next);
      setOlder([]);
      setLastCursor(null);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.jobId, reloadCount]);

  const entries = page !== null && page.status === 'ok' ? [...page.data.items, ...older] : [];
  const moreExists =
    page !== null &&
    page.status === 'ok' &&
    page.data.hasMore &&
    (older.length === 0 || lastCursor !== null);

  const loadOlder = async () => {
    if (page === null || page.status !== 'ok') return;
    const cursor = older.length === 0 ? page.data.nextCursor : lastCursor;
    if (cursor === null) return;
    const next = await listWorkLog(entry.jobId, cursor);
    if (next.status !== 'ok') return;
    setLastCursor(next.data.hasMore ? next.data.nextCursor : null);
    setOlder((current) => [...current, ...next.data.items]);
  };

  const add = async () => {
    setProblem(null);
    setFieldErrors({});
    if (text.trim().length === 0) {
      setFieldErrors({ entry: 'field.required' });
      return;
    }
    setBusy(true);
    const result = await recordWorkLog(target, entry.jobId, entry.assignmentId, {
      entry: text.trim(),
      // Omitted unless the technician said when: the backend then stamps now.
      ...(loggedAt.length > 0 ? { loggedAt: new Date(loggedAt).toISOString() } : {}),
    });
    setBusy(false);
    notifyActionResult(result, messages);
    if (result.status === 'success') {
      setText('');
      setLoggedAt('');
      reload();
      return;
    }
    if (result.fieldErrors) setFieldErrors(result.fieldErrors);
    setProblem(problemKeyOf(result, 'technicians.workspace.conflict'));
  };

  const errorFor = (name: string): string | undefined => {
    const key = fieldErrors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

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
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
          className="flex flex-col gap-3"
        >
          <TextAreaField
            label={translate(messages, 'technicians.workspace.entry')}
            value={text}
            onChange={(event) => setText(event.target.value)}
            error={errorFor('entry')}
            required
          />
          <div className="flex flex-wrap items-end gap-3">
            <TextField
              type="datetime-local"
              label={translate(messages, 'technicians.workspace.loggedAt')}
              description={translate(messages, 'technicians.workspace.loggedAtHint')}
              value={loggedAt}
              onChange={(event) => setLoggedAt(event.target.value)}
              error={errorFor('loggedAt')}
            />
            <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
              {translate(
                messages,
                busy ? 'technicians.workspace.adding' : 'technicians.workspace.addEntry'
              )}
            </button>
          </div>
        </form>
      ) : null}

      {problem === null ? null : (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, problem)}
        </p>
      )}

      {page === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : page.status !== 'ok' ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, `state.${page.status}.title`)}
          {page.correlationId
            ? ` ${translate(messages, 'action.reference')} ${page.correlationId}`
            : ''}
        </p>
      ) : entries.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'technicians.workspace.noWorkLog')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((item) => (
            <li key={item.id} className="rounded-md border border-border bg-surface p-3">
              {/* Rendered as written. No edit and no delete exist to be offered. */}
              <p className="whitespace-pre-wrap text-body text-text-primary">{item.entry}</p>
              <p className="text-caption text-text-muted">
                {translate(messages, 'technicians.workspace.loggedAt')}{' '}
                {formatDateTime(item.loggedAt, locale)} ·{' '}
                {translate(messages, 'technicians.workspace.recordedAt')}{' '}
                {formatDateTime(item.createdAt, locale)}
              </p>
            </li>
          ))}
        </ul>
      )}
      {moreExists ? (
        <button type="button" onClick={() => void loadOlder()} className={SECONDARY_BUTTON}>
          {translate(messages, 'technicians.workspace.olderEntries')}
        </button>
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
  const [list, setList] = useState<ReadState<ItemsOnly<JobEvidenceEntry>> | null>(null);
  const [categories, setCategories] = useState<readonly DocumentCategory[] | null>(null);
  const [reloadCount, reload] = useReload();
  const [categoryCode, setCategoryCode] = useState('');
  const [evidenceType, setEvidenceType] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  /*
   * The form's EPOCH. React resets a `<form action={…}>` after its Server
   * Action settles, and a controlled `<select>` does not survive that reset —
   * its default is frozen at mount (`form-reset-class.test.ts`). So the select
   * is keyed on a counter that moves when the action settles, and carries a
   * `defaultValue` React re-applies on the remount. The text boxes are
   * controlled, which for text IS the safe shape.
   */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void listJobEvidence(entry.jobId).then((next) => {
      if (!cancelled) setList(next);
    });
    return () => {
      cancelled = true;
    };
  }, [entry.jobId, reloadCount]);

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
    <section aria-labelledby="evidence-heading" className="flex flex-col gap-3">
      <h3 id="evidence-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'technicians.workspace.evidenceHeading')}
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'technicians.workspace.evidenceNote')}
      </p>

      {canCapture && identity !== null ? (
        categories === null ? (
          <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
        ) : categories.length === 0 ? (
          <p className="text-body text-text-secondary">
            {translate(messages, 'technicians.workspace.noCategories')}
          </p>
        ) : (
          <form
            action={async (formData: FormData) => {
              setPending(true);
              setProblem(null);
              setFieldErrors({});
              const outcome = await captureJobEvidence(
                target,
                entry.jobId,
                entry.assignmentId,
                formData
              );
              setPending(false);
              setAttempt((n) => n + 1);
              notifyActionResult(outcome, messages);
              if (outcome.status === 'success') {
                setEvidenceType('');
                setNote('');
                reload();
                return;
              }
              if (outcome.fieldErrors) setFieldErrors(outcome.fieldErrors);
              setProblem(
                outcome.stage === undefined
                  ? (outcome.messageKey ?? 'action.failed')
                  : 'technicians.workspace.capturedPartial'
              );
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <SelectField
              key={`categoryCode-${attempt}`}
              name="categoryCode"
              label={translate(messages, 'technicians.workspace.evidenceCategory')}
              defaultValue={categoryCode}
              onChange={(event) => setCategoryCode(event.target.value)}
              options={categories.map((each) => ({
                value: each.categoryCode,
                label: each.categoryCode,
              }))}
              placeholder={translate(messages, 'technicians.workspace.evidenceCategory')}
              error={errorFor('categoryCode')}
              required
            />
            <TextField
              name="evidenceType"
              label={translate(messages, 'technicians.workspace.evidenceType')}
              description={translate(messages, 'technicians.workspace.evidenceTypeHint')}
              value={evidenceType}
              onChange={(event) => setEvidenceType(event.target.value)}
              error={errorFor('evidenceType')}
              required
            />
            <TextField
              name="note"
              label={translate(messages, 'technicians.workspace.evidenceNoteField')}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              error={errorFor('note')}
            />
            <CaptureFileField
              name="evidenceFile"
              label={translate(messages, 'technicians.workspace.chooseFile')}
              // The SERVER's list for the chosen category, or nothing.
              accept={category?.allowedContentTypes}
            />
            <button type="submit" disabled={pending} className={PRIMARY_BUTTON}>
              {translate(
                messages,
                pending ? 'technicians.workspace.attaching' : 'technicians.workspace.attach'
              )}
            </button>
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

      {list === null ? (
        <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
      ) : list.status !== 'ok' ? (
        <p role="alert" className="text-body text-error">
          {translateDynamic(messages, `state.${list.status}.title`)}
          {list.correlationId
            ? ` ${translate(messages, 'action.reference')} ${list.correlationId}`
            : ''}
        </p>
      ) : list.data.items.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'technicians.workspace.noEvidence')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.items.map((item) => (
            <li key={item.id} className="rounded-md border border-border bg-surface p-3">
              <p className="text-body text-text-primary">
                {item.evidenceType}
                {item.note === null ? '' : ` — ${item.note}`}
              </p>
              <p className="text-caption text-text-muted">
                {translate(messages, 'technicians.workspace.recordedAt')}{' '}
                {formatDateTime(item.createdAt, locale)} ·{' '}
                {translate(messages, 'technicians.workspace.documentReference')}{' '}
                {item.documentVersionId}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
