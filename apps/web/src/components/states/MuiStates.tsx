'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import Alert, { type AlertColor } from '@mui/material/Alert';
import AlertTitle from '@mui/material/AlertTitle';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Skeleton from '@mui/material/Skeleton';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { SearchPhase } from '@/lib/api/use-search-request';

/**
 * The read states, on Material UI — ADR-022 PR1.
 *
 * The same states `States.tsx` renders, with the same catalogue entries, drawn
 * with Material's `Alert`, `Skeleton` and `CircularProgress` so a screen that
 * moves onto the shared Material wrappers keeps one look. `States.tsx` stays:
 * every screen that has not moved still renders it, and the two say the same
 * sentences because they read the same keys.
 *
 * ## The rules both share
 *
 *   - **One state is never drawn as another.** A refusal is not "no matches", an
 *     outage is not "something went wrong", and an ended session is neither.
 *   - **A retry only where retrying can change the answer**: an outage, a fault
 *     and a stale read. Never on a refusal, and never on an ended session, whose
 *     only way forward is signing in again.
 *   - **No raw code.** The heading and the sentence come from the catalogue; the
 *     one diagnostic shown is the correlation reference, an opaque token support
 *     can look up and the browser can learn nothing from.
 *   - **`role="status"`, not `alert`.** These are the result of something the
 *     operator just did and are announced politely. Material's `Alert` would
 *     otherwise interrupt, which an empty list is not.
 */

interface StateProps {
  readonly messages: Messages;
  /** Offered only by the states where trying again can change the answer. */
  readonly onRetry?: (() => void) | undefined;
  readonly correlationId?: string | null | undefined;
  /** A further control the caller owns — "Clear all filters", "Add the first record". */
  readonly action?: ReactNode | undefined;
  readonly testId?: string | undefined;
}

function StateAlert({
  messages,
  severity,
  titleKey,
  descriptionKey,
  onRetry,
  correlationId,
  action,
  testId,
}: StateProps & {
  readonly severity: AlertColor;
  readonly titleKey: keyof Messages;
  readonly descriptionKey: keyof Messages;
}) {
  return (
    <Alert
      severity={severity}
      role="status"
      variant="outlined"
      data-testid={testId}
      data-state={severity}
      className="w-full"
    >
      <AlertTitle component="h2">{translate(messages, titleKey)}</AlertTitle>
      <p>{translate(messages, descriptionKey)}</p>
      {onRetry || action ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {onRetry ? (
            <Button type="button" variant="outlined" size="small" onClick={onRetry}>
              {translate(messages, 'state.retry')}
            </Button>
          ) : null}
          {action}
        </div>
      ) : null}
      {correlationId ? (
        <p className="mt-2 text-caption text-text-muted">
          {translate(messages, 'state.correlationId')}{' '}
          <code className="font-mono text-text-secondary">{correlationId}</code>
        </p>
      ) : null}
    </Alert>
  );
}

/** Nothing exists yet. Not "your filters excluded everything" — see `MuiNoResultsState`. */
export function MuiEmptyState({ messages, action, testId }: StateProps) {
  return (
    <StateAlert
      messages={messages}
      severity="info"
      titleKey="state.empty.title"
      descriptionKey="state.empty.description"
      action={action}
      testId={testId ?? 'state-empty'}
    />
  );
}

/**
 * A completed read matched nothing. Reached only from an answer, never while
 * loading. `reason` says what narrowed it: the request's filters, or a search
 * whose criteria the table does not hold — whose sentence offers no filter to
 * clear.
 */
export function MuiNoResultsState({
  messages,
  action,
  testId,
  reason = 'filters',
}: StateProps & { readonly reason?: 'filters' | 'search' }) {
  return (
    <StateAlert
      messages={messages}
      severity="info"
      titleKey={reason === 'search' ? 'state.noSearchMatches.title' : 'state.noResults.title'}
      descriptionKey={
        reason === 'search' ? 'state.noSearchMatches.description' : 'state.noResults.description'
      }
      action={action}
      testId={testId ?? 'state-no-results'}
    />
  );
}

/**
 * A read in flight.
 *
 * `rows` draws skeleton rows the height of a table row, so the content that
 * replaces them does not move the page; `inline` draws a small spinner for a
 * control that is waiting (a picker's search). Either way the only thing
 * announced is the word "Loading".
 */
export function MuiLoadingState({
  messages,
  variant = 'rows',
  rows = 6,
  testId,
}: {
  readonly messages: Messages;
  readonly variant?: 'rows' | 'inline';
  readonly rows?: number;
  readonly testId?: string | undefined;
}) {
  const label = translate(messages, 'state.loading');
  if (variant === 'inline') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2"
        data-testid={testId ?? 'state-loading'}
      >
        <CircularProgress size="var(--space-4)" aria-hidden="true" />
        <span className="text-supporting text-text-secondary">{label}</span>
      </div>
    );
  }
  return (
    <div role="status" aria-live="polite" data-testid={testId ?? 'state-loading'}>
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-col gap-2">
        {Array.from({ length: rows }, (_, index) => (
          <Skeleton key={index} variant="rounded" className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}

/** A fault. Worth retrying, and the reference is worth reporting. */
export function MuiErrorState({ messages, onRetry, correlationId, action, testId }: StateProps) {
  return (
    <StateAlert
      messages={messages}
      severity="error"
      titleKey="state.error.title"
      descriptionKey="state.error.description"
      onRetry={onRetry}
      correlationId={correlationId}
      action={action}
      testId={testId ?? 'state-error'}
    />
  );
}

/**
 * The service did not answer, answered too slowly, or throttled the read.
 * Retryable, and it says so; the reference goes with it (`P1-27-DO-002`).
 */
export function MuiUnavailableState({
  messages,
  onRetry,
  correlationId,
  action,
  testId,
}: StateProps) {
  return (
    <StateAlert
      messages={messages}
      severity="error"
      titleKey="state.unavailable.title"
      descriptionKey="state.unavailable.description"
      onRetry={onRetry}
      correlationId={correlationId}
      action={action}
      testId={testId ?? 'state-unavailable'}
    />
  );
}

/**
 * The caller may not read this. No retry: the same request on the same session
 * is refused identically. Names no record, module or permission.
 */
export function MuiRefusedState({
  messages,
  correlationId,
  testId,
}: Omit<StateProps, 'onRetry' | 'action'>) {
  return (
    <StateAlert
      messages={messages}
      severity="warning"
      titleKey="state.denied.title"
      descriptionKey="state.denied.description"
      correlationId={correlationId}
      testId={testId ?? 'state-refused'}
    />
  );
}

/**
 * The session ended while the screen was open. No retry; the way forward is
 * signing in again, offered as a link when the caller knows the locale.
 */
export function MuiExpiredState({
  messages,
  locale,
  testId,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly testId?: string | undefined;
}) {
  return (
    <StateAlert
      messages={messages}
      severity="warning"
      titleKey="state.expired.title"
      descriptionKey="state.expired.description"
      action={
        locale === undefined ? undefined : (
          <Link
            href={`/${locale}/login`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {translate(messages, 'auth.backToLogin')}
          </Link>
        )
      }
      testId={testId ?? 'state-expired'}
    />
  );
}

/** The record or page is not there, or not for this caller. */
export function MuiNotFoundState({ messages, action, testId }: Omit<StateProps, 'onRetry'>) {
  return (
    <StateAlert
      messages={messages}
      severity="info"
      titleKey="state.notFound.title"
      descriptionKey="state.notFound.description"
      action={action}
      testId={testId ?? 'state-not-found'}
    />
  );
}

/**
 * What is on screen is older than the record: someone changed it meanwhile.
 *
 * It reads the conflict entries — "Someone else changed this", "Reload to see
 * the current version" — because that is exactly what a stale view is, and a
 * second sentence for the same fact would be a second wording to keep in step.
 * Its retry reads the record again.
 */
export function MuiStaleState({ messages, onRetry, action, testId }: StateProps) {
  return (
    <StateAlert
      messages={messages}
      severity="warning"
      titleKey="state.conflict.title"
      descriptionKey="state.conflict.description"
      onRetry={onRetry}
      action={action}
      testId={testId ?? 'state-stale'}
    />
  );
}

/**
 * Everything a search can be except an answer — `SearchStates`, on Material UI.
 *
 * The same phases and the same decisions: `ready` renders nothing (the caller
 * renders the rows), `idle` renders what the caller passes, `empty` is reached
 * only from a completed read, and neither a refusal nor an ended session is
 * offered a retry.
 */
export function MuiSearchStates({
  messages,
  locale,
  phase,
  correlationId,
  idle = null,
  onClearFilters,
  onRetry,
}: {
  readonly messages: Messages;
  readonly locale?: Locale | undefined;
  readonly phase: SearchPhase;
  readonly correlationId?: string | null | undefined;
  readonly idle?: ReactNode;
  readonly onClearFilters?: ReactNode | undefined;
  readonly onRetry?: (() => void) | undefined;
}) {
  switch (phase) {
    case 'ready':
      return null;
    case 'idle':
      return <>{idle}</>;
    case 'loading':
      return <MuiLoadingState messages={messages} variant="inline" />;
    case 'empty':
      return <MuiNoResultsState messages={messages} action={onClearFilters} reason="search" />;
    case 'unavailable':
      return (
        <MuiUnavailableState messages={messages} onRetry={onRetry} correlationId={correlationId} />
      );
    case 'refused':
      return <MuiRefusedState messages={messages} correlationId={correlationId} />;
    case 'expired':
      return <MuiExpiredState messages={messages} locale={locale} />;
    case 'failed':
      return <MuiErrorState messages={messages} onRetry={onRetry} correlationId={correlationId} />;
  }
}
