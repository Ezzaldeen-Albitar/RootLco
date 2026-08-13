'use client';

import { useCallback, type ReactNode } from 'react';
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
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly kind: EvidenceKind;
  readonly table: ReturnType<typeof useEvidenceTable>;
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
