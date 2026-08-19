'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import {
  ErrorState,
  LoadingState,
  PermissionDeniedState,
  SessionExpiredState,
  SkeletonRows,
} from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';
import type { ActionState } from '@/lib/forms/action-result';
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
 * The pieces every condition-evidence step renders (P1-28, Wave E).
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
 */

/* ---------------------------------------------------------------------- *
 * States
 * ---------------------------------------------------------------------- */

/**
 * Every non-idle table state, with Retry on the one that can be retried.
 *
 * A skeleton on first load rather than a spinner: the shape of what is coming
 * is known, and a list that appears in place of its own outline does not reflow
 * the step under the operator's hands.
 */
export function EvidenceStates({
  messages,
  status,
  correlationId,
  onRetry,
  skeleton = true,
}: {
  readonly messages: Messages;
  readonly status: string;
  readonly correlationId: string | undefined;
  readonly onRetry: () => void;
  readonly skeleton?: boolean;
}) {
  if (status === 'loading') {
    return skeleton ? <SkeletonRows rows={3} /> : <LoadingState messages={messages} />;
  }
  if (status === 'denied') {
    return (
      <PermissionDeniedState messages={messages} {...(correlationId ? { correlationId } : {})} />
    );
  }
  if (status === 'expired') return <SessionExpiredState messages={messages} />;
  return (
    <ErrorState
      messages={messages}
      action={
        <button type="button" onClick={onRetry} className={SECONDARY_BUTTON}>
          {translate(messages, 'state.retry')}
        </button>
      }
      {...(correlationId ? { correlationId } : {})}
    />
  );
}

export const PRIMARY_BUTTON =
  'rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

export const SECONDARY_BUTTON =
  'rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring';

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
function InstantOrRaw({ value, locale }: { readonly value: string; readonly locale: Locale }) {
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
        wanted.map(async (id) => [id, resolvePersonName(await readUserIdentity(id))] as const)
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

/** One evidence kind's read-back, paged by `rec.reception-condition-evidence-list`. */
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
  if (table.status !== 'idle') {
    return (
      <EvidenceStates
        messages={messages}
        status={table.status}
        correlationId={table.correlationId}
        onRetry={table.refresh}
      />
    );
  }

  const rows = table.response?.rows ?? [];
  const fields = rowFieldsFor(kind);

  return (
    <div className="flex flex-col gap-2">
      {isRestrictedNarrative(kind) ? (
        // Said, not hinted. The read genuinely cannot return the narrative for
        // this caller, and a thin row with no explanation reads as data loss.
        <p className="text-caption text-text-muted" lang={locale}>
          {translate(messages, 'receptions.evidence.restrictedReadBack')}
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'receptions.evidence.readBackEmpty')}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-md border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-col gap-1 px-3 py-2">
              <p className="text-caption text-text-secondary">
                <InstantOrRaw value={row.recordedAt} locale={locale} />
              </p>
              <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {fields.map((field) => {
                  const value = primitiveField(row, field.field);
                  if (value === null) return null;
                  return (
                    <div key={field.field} className="flex flex-wrap items-baseline gap-2">
                      <dt className="text-caption text-text-muted">
                        {translateDynamic(messages, field.labelKey)}
                      </dt>
                      <dd className="text-body text-text-primary">
                        {field.kind === 'vocabulary' ? (
                          translateDynamic(messages, `${field.vocabularyPrefix ?? ''}${value}`)
                        ) : field.kind === 'datetime' ? (
                          <InstantOrRaw value={value} locale={locale} />
                        ) : field.kind === 'person' ? (
                          // An ACCOUNT, so a name — or the reason there is not
                          // one. Never the identifier: a dangling value rendered
                          // where a person's name goes reads as a person.
                          <PersonName messages={messages} resolved={people.get(value)} />
                        ) : field.kind === 'identifier' ? (
                          // A code, a uuid or an exact numeric rendered `::text`
                          // by the database. LTR and monospaced so it is read as
                          // the token it is, and never reformatted.
                          <code className="font-mono text-caption" dir="ltr">
                            {value}
                          </code>
                        ) : (
                          value
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </li>
          ))}
        </ul>
      )}

      {table.response?.hasMore ? (
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
          ? translateDynamic(messages, state.messageKey)
          : translate(messages, 'action.failed')}
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
