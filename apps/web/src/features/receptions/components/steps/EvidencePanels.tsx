'use client';

import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import {
  MuiErrorState,
  MuiExpiredState,
  MuiLoadingState,
  MuiNotFoundState,
  MuiRefusedState,
  MuiUnavailableState,
} from '@/components/states/MuiStates';
import { FailureExplanation } from '@/components/states/States';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import { IDLE, invalid, unreachable, type ActionState } from '@/lib/forms/action-result';
import { useClearOnCorrect } from '@/lib/forms/use-clear-on-correct';
import { listConditionEvidence } from '../../api';
import type { ConditionEvidenceEntry, EvidenceKind } from '../../receptions-contract';
import {
  coverageOf,
  isRestrictedNarrative,
  primitiveField,
  rowFieldsFor,
  sessionEvidenceOf,
  type SessionEvidence,
} from '../../check-in/evidence';
import {
  PERSON_NAME_NOTICE_KEYS,
  resolvePersonName,
  type PersonName,
} from '../../people/person-name';
import { readUserIdentity } from '../../support-api';

/**
 * The pieces every condition-evidence step renders (P1-28, Wave E), on the
 * Material UI wrappers (ADR-022).
 *
 * Written once because eight steps otherwise ship eight renderings of the same
 * four things — the read-back list, the loading/denied/expired/error/retry set,
 * the "what this session captured" list and the inline outcome line — and each
 * copy is a chance for one of them to disagree with the others about what the
 * read actually returns.
 *
 * ## The two lists are two different claims and are labelled as two
 *
 * `rec.reception-condition-evidence-list` never selects the restricted
 * narrative tables, so a complaint's words and a content item's description are
 * NOT in the read-back. `EvidenceReadBack` therefore renders the published
 * envelope and, for a restricted kind, states in words that the narrative is
 * not re-readable without `iam.sensitive.view` — while `SessionCaptureList`
 * shows what this browser tab recorded, labelled as a session record that does
 * not survive a reload. Neither is presented as the other.
 *
 * ## Every step form works the same way (`useStepForm`)
 *
 * The capture forms of the wizard share one behaviour, so it is written here
 * once: a refusal — this screen's own or the service's — is filed under the
 * field it is about, marked on that field (red, the sentence beside it,
 * `aria-invalid`), the cursor is moved to the first one, every entry is kept,
 * and the complaint is withdrawn as soon as its field is edited. Anything typed
 * or chosen is unsaved work (`useUnsavedGuard`): leaving the page or switching
 * branch asks first, and a confirmed discard empties the form. A write whose
 * answer never arrives (the connection dropped) is said as that, with the
 * entries kept and the button usable again.
 */

/* ---------------------------------------------------------------------- *
 * States
 * ---------------------------------------------------------------------- */

/**
 * Every non-idle read state, with Retry on the ones that can be retried.
 *
 * A skeleton on first load rather than a spinner: the shape of what is coming
 * is known, and a list that appears in place of its own outline does not reflow
 * the step under the operator's hands. A throttled or unanswered read (429, 5xx)
 * is `unavailable` — "try again" — never a fault; a denial and an ended session
 * offer no retry, because the same request would be refused the same way.
 */
export function EvidenceStates({
  messages,
  locale,
  status,
  correlationId,
  onRetry,
  skeleton = true,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly status: string;
  readonly correlationId: string | null | undefined;
  readonly onRetry: () => void;
  readonly skeleton?: boolean;
}) {
  if (status === 'loading') {
    return <MuiLoadingState messages={messages} variant={skeleton ? 'rows' : 'inline'} rows={3} />;
  }
  if (status === 'denied') {
    return <MuiRefusedState messages={messages} correlationId={correlationId} />;
  }
  if (status === 'expired') return <MuiExpiredState messages={messages} locale={locale} />;
  if (status === 'unavailable' || status === 'throttled') {
    return (
      <MuiUnavailableState messages={messages} onRetry={onRetry} correlationId={correlationId} />
    );
  }
  return <MuiErrorState messages={messages} onRetry={onRetry} correlationId={correlationId} />;
}

/**
 * A single record's read that did not answer: the same arms as
 * `EvidenceStates`, with "not found" said as itself rather than as a fault.
 */
export function RecordReadState({
  messages,
  locale,
  status,
  correlationId,
  onRetry,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly status: string;
  readonly correlationId: string | null | undefined;
  readonly onRetry?: (() => void) | undefined;
}) {
  if (status === 'not-found') return <MuiNotFoundState messages={messages} />;
  if (onRetry === undefined) {
    if (status === 'loading') return <MuiLoadingState messages={messages} rows={2} />;
    if (status === 'denied') {
      return <MuiRefusedState messages={messages} correlationId={correlationId} />;
    }
    if (status === 'expired') return <MuiExpiredState messages={messages} locale={locale} />;
    if (status === 'unavailable') {
      return <MuiUnavailableState messages={messages} correlationId={correlationId} />;
    }
    return <MuiErrorState messages={messages} correlationId={correlationId} />;
  }
  return (
    <EvidenceStates
      messages={messages}
      locale={locale}
      status={status}
      correlationId={correlationId}
      onRetry={onRetry}
    />
  );
}

/* ---------------------------------------------------------------------- *
 * The read-back
 * ---------------------------------------------------------------------- */

/**
 * An instant, rendered — or the raw value, when it is not one.
 *
 * `formatDateTime` throws `RangeError: Invalid time value` on anything `Date`
 * cannot parse, and a throw inside a list row takes the WHOLE step down: the
 * operator loses the evidence panel because one timestamp was not what this
 * screen expected. The union publishes these fields through `ISO_MS(...)` and
 * they should always be parseable, but "should" is not a rendering strategy for
 * a value that crossed a network. An unreadable instant is shown exactly as it
 * arrived, monospaced, rather than formatted into a lie or thrown away.
 */
export function InstantOrRaw({
  value,
  locale,
}: {
  readonly value: string;
  readonly locale: Locale;
}) {
  if (Number.isNaN(Date.parse(value))) {
    return (
      <code className="font-mono text-caption" dir="ltr">
        {value}
      </code>
    );
  }
  return (
    <time dateTime={value} dir="ltr">
      {formatDateTime(value, locale)}
    </time>
  );
}

/* ---------------------------------------------------------------------- *
 * Accounts, resolved to names
 * ---------------------------------------------------------------------- */

/** What every `person` field on the page resolved to, keyed by account. */
export type PersonNames = ReadonlyMap<string, PersonName>;

const NO_PEOPLE: PersonNames = new Map();

/**
 * The names behind the account identifiers a read-back is holding.
 *
 * One `iam.user-detail` read per DISTINCT identifier, and only for identifiers
 * actually on the page — a read-back of twenty-five inspections opened by the
 * same person costs one read, not twenty-five.
 *
 * ## This is now the ONLY consumer of `iam.user.read` in the phase
 *
 * It used to share the code with the receiving-employee picker, and the
 * disposition leaned on that: the picker discloses the directory anyway, so
 * resolving a name beside it adds nothing. `DBCR-P1-18-002` took the picker off
 * `iam.user-list` entirely, so the argument has to stand on its own — and it
 * does, on the stronger half it always had. `GET /auth/session` requires
 * `iam.user.read`, so every operator who can load the application holds it; and
 * the identifiers resolved here are ALREADY on the page. Turning one into the
 * name of the person it names discloses nothing the reader was not looking at.
 *
 * Without the permission the hook makes no request at all and every identifier
 * resolves to `denied` — the same posture every P1-28 route takes toward a gate
 * it can decide itself, and one that keeps a rate-limited operation unspent.
 *
 * Nothing here ever yields the identifier. The four outcomes are
 * `people/person-name.ts`'s, and this is the surface they were written for: an
 * ACTOR has no stored display name, unlike the receiving employee, whose name is
 * a snapshot on the visit and never comes through here.
 */
export function usePersonNames(ids: readonly string[], canRead: boolean): PersonNames {
  // The identifiers as ONE stable string, so the effect re-runs when the SET
  // changes rather than on every render that rebuilds the array.
  const key = canRead ? [...new Set(ids)].sort().join(',') : '';
  const [held, setHeld] = useState<{ readonly key: string; readonly names: PersonNames }>({
    key: '',
    names: NO_PEOPLE,
  });

  useEffect(() => {
    if (key === '') return;
    let cancelled = false;
    void (async () => {
      const wanted = key.split(',');
      const resolved = await Promise.all(
        wanted.map(async (id) => {
          // A read that never came back is `unavailable`, not a crash of the
          // whole panel — the same four outcomes as a read that answered.
          try {
            return [id, resolvePersonName(await readUserIdentity(id))] as const;
          } catch {
            return [id, { status: 'unavailable' } as PersonName] as const;
          }
        })
      );
      // Awaited before the only state write, so this is not a synchronous
      // setState inside an effect body.
      if (!cancelled) setHeld({ key, names: new Map(resolved) });
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!canRead) return NO_PEOPLE;
  return held.key === key ? held.names : NO_PEOPLE;
}

/**
 * One account, as a name or as the reason there is not one.
 *
 * `undefined` — the read has not answered yet — is `unavailable` rather than a
 * blank: "we have not asked" and "this identifier names nobody" are different
 * facts, and F1 on the acknowledgement sheet was exactly the second printed for
 * the first.
 */
function PersonName({
  messages,
  resolved,
}: {
  readonly messages: Messages;
  readonly resolved: PersonName | undefined;
}) {
  if (resolved === undefined) {
    return (
      <span className="text-text-secondary">
        {translate(messages, PERSON_NAME_NOTICE_KEYS.unavailable)}
      </span>
    );
  }
  if (resolved.status === 'named') return <>{resolved.displayName}</>;
  return (
    <span className="text-text-secondary">
      {translate(messages, PERSON_NAME_NOTICE_KEYS[resolved.status])}
    </span>
  );
}

/** The `person` identifiers a page of rows carries, for `usePersonNames`. */
export function personIdsOf(
  kind: EvidenceKind,
  rows: readonly ConditionEvidenceEntry[]
): readonly string[] {
  const fields = rowFieldsFor(kind).filter((field) => field.kind === 'person');
  if (fields.length === 0) return [];
  const ids: string[] = [];
  for (const row of rows) {
    for (const field of fields) {
      const value = primitiveField(row, field.field);
      if (value !== null && value !== '') ids.push(value);
    }
  }
  return ids;
}

/**
 * One evidence kind's read-back, paged by `rec.reception-condition-evidence-list`.
 *
 * Still read through a Server Action, so a page a visit refresh has superseded
 * is IGNORED by the table (its reply is dropped), not cancelled on the wire.
 */
export function useEvidenceTable(visitId: string, kind: EvidenceKind, loadKey: string) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listConditionEvidence(visitId, kind, request, cursor),
    [visitId, kind]
  );
  return useServerTable<ConditionEvidenceEntry>(load, {
    initial: { ...INITIAL_REQUEST, pageSize: 25 },
    loadKey,
  });
}

/**
 * The recorded rows of one kind, in `OperationalGrid` — the server's pages
 * walked with its cursor, never counted — one column per field the read
 * publishes for that kind, after the moment it was recorded.
 */
export function EvidenceReadBack({
  locale,
  messages,
  kind,
  table,
  people = NO_PEOPLE,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly kind: EvidenceKind;
  readonly table: ReturnType<typeof useEvidenceTable>;
  /**
   * Names for the `person` fields this kind carries, from `usePersonNames`.
   *
   * Defaulted so the seven kinds with no `person` field pass nothing, and so a
   * caller that forgets renders the honest "could not be read" rather than the
   * identifier — the failure mode of an omission is a cautious sentence, never a
   * uuid on a screen.
   */
  readonly people?: PersonNames;
}) {
  const fields = rowFieldsFor(kind);
  const columns = useMemo<readonly OperationalColumn<ConditionEvidenceEntry>[]>(
    () => [
      {
        id: 'recordedAt',
        headerKey: 'receptions.acknowledgement.columnRecordedAt',
        cell: (row) => <InstantOrRaw value={row.recordedAt} locale={locale} />,
      },
      ...fields.map((field): OperationalColumn<ConditionEvidenceEntry> => ({
        id: field.field,
        headerKey: field.labelKey,
        cell: (row) => {
          const value = primitiveField(row, field.field);
          if (value === null) return null;
          if (field.kind === 'vocabulary') {
            return translateDynamic(messages, `${field.vocabularyPrefix ?? ''}${value}`);
          }
          if (field.kind === 'datetime') return <InstantOrRaw value={value} locale={locale} />;
          if (field.kind === 'person') {
            // An ACCOUNT, so a name — or the reason there is not one. Never
            // the identifier: a dangling value rendered where a person's
            // name goes reads as a person.
            return <PersonName messages={messages} resolved={people.get(value)} />;
          }
          if (field.kind === 'identifier') {
            // A code or an exact numeric rendered `::text` by the database.
            // LTR and monospaced so it is read as the token it is, and never
            // reformatted.
            return (
              <code className="font-mono text-caption" dir="ltr">
                {value}
              </code>
            );
          }
          return value;
        },
      })),
    ],
    [fields, locale, messages, people]
  );

  const rows = table.response?.rows ?? [];

  return (
    <div className="flex flex-col gap-2">
      {isRestrictedNarrative(kind) ? (
        // Said, not hinted. The read genuinely cannot return the narrative for
        // this caller, and a thin row with no explanation reads as data loss.
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.evidence.restrictedReadBack')}
        </p>
      ) : null}

      <OperationalGrid<ConditionEvidenceEntry>
        messages={messages}
        locale={locale}
        label={translateDynamic(messages, `receptions.evidenceKind.${kind}`)}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        density="compact"
        suppressEmptyState
        testId={`evidence-read-back-${kind}`}
      />

      {table.status === 'idle' && table.response !== null && rows.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'receptions.evidence.readBackEmpty')}
        </p>
      ) : null}

      {table.status === 'idle' && table.response?.hasMore ? (
        <p className="text-caption text-text-muted">
          {translate(messages, 'receptions.evidence.morePages')}
        </p>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * What this session captured
 * ---------------------------------------------------------------------- */

/**
 * The rows this browser tab wrote, from each write's own response.
 *
 * Rendered ONLY when there is something to render: an empty "captured this
 * session" panel on an already-populated visit would suggest the visit itself
 * is empty, which the read-back beside it contradicts.
 */
export function SessionCaptureList({
  locale,
  messages,
  kind,
  captured,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly kind: EvidenceKind;
  readonly captured: readonly SessionEvidence[];
}) {
  const mine = sessionEvidenceOf(captured, kind);
  if (mine.length === 0) return null;

  return (
    <section
      aria-label={translate(messages, 'receptions.evidence.sessionHeading')}
      className="flex flex-col gap-2 rounded-md border border-border bg-surface-subtle p-3"
    >
      <h5 className="text-caption font-medium text-text-secondary">
        {translate(messages, 'receptions.evidence.sessionHeading')}
      </h5>
      <p className="text-caption text-text-muted" lang={locale}>
        {translate(messages, 'receptions.evidence.sessionNote')}
      </p>
      <ul className="flex flex-col gap-1">
        {mine.map((entry) => (
          <li key={entry.evidenceId} className="text-body text-text-primary">
            {entry.summary}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------------- *
 * Notices and outcomes
 * ---------------------------------------------------------------------- */

/**
 * Why a kind cannot be captured right now, from the coverage table.
 *
 * The statement is the coverage row's own `noticeKey`, so the reason an
 * operator reads and the reason the test asserts are the same string.
 */
export function CoverageNotice({
  locale,
  messages,
  kind,
  extra,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly kind: EvidenceKind;
  readonly extra?: ReactNode;
}) {
  const coverage = coverageOf(kind);
  if (coverage === null || coverage.noticeKey === null) return null;
  return (
    <div
      role="note"
      data-testid={`evidence-notice-${kind}`}
      className="rounded-md border border-border bg-surface-subtle p-3"
    >
      <p className="text-body text-text-primary" lang={locale}>
        {translateDynamic(messages, coverage.noticeKey)}
      </p>
      {extra}
    </div>
  );
}

/** A write control withdrawn, with the reason stated rather than greyed out. */
export function WriteWithdrawn({
  locale,
  messages,
  messageKey,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly messageKey: string;
}) {
  return (
    <p className="text-caption text-text-muted" lang={locale}>
      {translateDynamic(messages, messageKey)}
    </p>
  );
}

/**
 * The form's inline outcome line. The toast is raised by the step's `settle`.
 *
 * A conflict does NOT guess which rule refused: the evidence writes share the
 * non-disclosing 409 `ERR-TRN-001` with the state guard, exactly as the parties
 * step's copy already states.
 */
export function StepOutcome({
  messages,
  state,
}: {
  readonly messages: Messages;
  readonly state: ActionState;
}) {
  if (state.status === 'idle' || state.status === 'success') return null;
  return (
    <p role="alert" className="text-body text-error">
      {state.status === 'conflict'
        ? translate(messages, 'receptions.evidence.conflict')
        : state.messageKey
          ? translateWithValues(messages, state.messageKey, state.messageValues)
          : translate(messages, 'action.failed')}
      <FailureExplanation messages={messages} messageKey={state.messageKey ?? ''} />
      {state.correlationId ? (
        <code className="ms-2 font-mono text-caption">{state.correlationId}</code>
      ) : null}
    </p>
  );
}

/** The panel every evidence step is built out of: a heading, a body, a form. */
export function EvidenceSection({
  id,
  messages,
  headingKey,
  children,
}: {
  readonly id: string;
  readonly messages: Messages;
  readonly headingKey: string;
  readonly children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
    >
      <h4 id={`${id}-heading`} className="text-body font-medium text-text-primary">
        {translateDynamic(messages, headingKey)}
      </h4>
      {children}
    </section>
  );
}

/** "Try again", for a read the operator can ask for once more. */
export function RetryButton({
  messages,
  onRetry,
  testId,
}: {
  readonly messages: Messages;
  readonly onRetry: () => void;
  readonly testId?: string | undefined;
}) {
  return (
    <Button type="button" variant="outlined" size="small" onClick={onRetry} data-testid={testId}>
      {translate(messages, 'state.retry')}
    </Button>
  );
}

/** A form's one submit, saying "Working…" while its write is in flight. */
export function SubmitButton({
  messages,
  pending,
  labelKey,
  disabled = false,
  testId,
}: {
  readonly messages: Messages;
  readonly pending: boolean;
  readonly labelKey: string;
  readonly disabled?: boolean;
  readonly testId?: string | undefined;
}) {
  return (
    <div>
      <Button
        type="submit"
        variant="contained"
        disabled={pending || disabled}
        aria-busy={pending || undefined}
        data-testid={testId}
      >
        {pending ? translate(messages, 'form.pending') : translateDynamic(messages, labelKey)}
      </Button>
    </div>
  );
}

/* ---------------------------------------------------------------------- *
 * The step form
 * ---------------------------------------------------------------------- */

export interface StepFormOptions<Draft extends object> {
  readonly messages: Messages;
  /** The form as it opens, and as a confirmed discard leaves it. */
  readonly empty: Draft;
  /**
   * The refusals this screen can decide itself, before a request is spent,
   * each filed under the name of the field it is about — the name the
   * service's own refusal of that value arrives under.
   */
  readonly check: (draft: Draft) => Readonly<Record<string, string>>;
  /** The sentence over a locally refused form. `form.formError` unless stated. */
  readonly refusedKey?: string | undefined;
  /** The write. Its answer is rendered; a rejected promise is "no answer". */
  readonly send: (draft: Draft, attempt: number) => Promise<ActionState>;
  /** After the answer is on screen: the toast, the re-reads. Never throws. */
  readonly settle?: ((result: ActionState, draft: Draft) => Promise<void> | void) | undefined;
  /**
   * The name a refusal of a draft field arrives under, where it is not the
   * field's own — `reporter` is refused as `reportedByPartnerId`. Editing the
   * field withdraws a complaint filed under either name.
   */
  readonly errorNames?: Partial<Record<keyof Draft & string, string>> | undefined;
  /**
   * The form after a stored write. Empty unless stated — a finding keeps the
   * inspection it was filed under, so the next one is one choice shorter.
   */
  readonly afterStored?: ((draft: Draft) => Draft) | undefined;
}

export interface StepForm<Draft extends object> {
  readonly draft: Draft;
  /** Sets one field, and withdraws the complaint that was about it. */
  readonly update: <Key extends keyof Draft & string>(field: Key, value: Draft[Key]) => void;
  readonly state: ActionState;
  readonly pending: boolean;
  /** The standing complaint about `field`, translated, until it is edited. */
  readonly fieldError: (field: string) => string | undefined;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  /** Whether anything entered differs from what the form opened with. */
  readonly dirty: boolean;
}

function sameDraft<Draft extends object>(left: Draft, right: Draft): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if ((left as Record<string, unknown>)[key] !== (right as Record<string, unknown>)[key]) {
      return false;
    }
  }
  return true;
}

/**
 * One capture form of the wizard — see "Every step form works the same way".
 *
 * The form's element and the cursor are the caller's: it installs
 * `useFocusFirstInvalid(form.state)` on the `<form>` itself, so a ref never
 * travels inside the object this hook returns.
 *
 * The draft is held here and compared with the form it opened as (or with the
 * form a stored write left): anything that differs is unsaved work, declared to
 * the shell, and a confirmed discard puts the form back. The attempt counter is
 * kept across a discard, so the next refusal is still a NEW attempt for the
 * refusal hooks.
 */
export function useStepForm<Draft extends object>({
  messages,
  empty,
  check,
  refusedKey,
  errorNames,
  send,
  settle,
  afterStored,
}: StepFormOptions<Draft>): StepForm<Draft> {
  const [baseline, setBaseline] = useState<Draft>(empty);
  const [draft, setDraft] = useState<Draft>(empty);
  const [state, setState] = useState<ActionState>(IDLE);
  const [pending, setPending] = useState(false);
  const corrections = useClearOnCorrect(state);

  const dirty = !sameDraft(draft, baseline);
  useUnsavedGuard(dirty, () => {
    setDraft(baseline);
    setState((current) => ({ status: 'idle', attempt: current.attempt ?? 0 }));
  });

  const update = <Key extends keyof Draft & string>(field: Key, value: Draft[Key]) => {
    corrections.noteEdited(field);
    const alias = errorNames?.[field];
    if (alias !== undefined) corrections.noteEdited(alias);
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const submit = async () => {
    const attempt = (state.attempt ?? 0) + 1;
    const problems = check(draft);
    if (Object.keys(problems).length > 0) {
      setState(invalid(problems, attempt, refusedKey));
      return;
    }
    setPending(true);
    let result: ActionState;
    try {
      result = await send(draft, attempt);
    } catch {
      // No answer came back: said as that, with every entry kept.
      setState(unreachable(attempt));
      return;
    } finally {
      setPending(false);
    }
    setState(result);
    if (result.status === 'success') {
      const next = afterStored ? afterStored(draft) : empty;
      setBaseline(next);
      setDraft(next);
    }
    await settle?.(result, draft);
  };

  return {
    draft,
    update,
    state,
    pending,
    fieldError: (field) => {
      const key = corrections.errorFor(field);
      return key === undefined ? undefined : translateDynamic(messages, key);
    },
    onSubmit: (event) => {
      event.preventDefault();
      if (pending) return;
      void submit();
    },
    dirty,
  };
}
