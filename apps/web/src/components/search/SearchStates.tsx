'use client';

import type { ReactNode } from 'react';
import {
  BackendUnavailableState,
  ErrorState,
  LoadingState,
  NoResultsState,
  PermissionDeniedState,
} from '@/components/states/States';
import type { Messages } from '@/i18n/get-messages';
import type { SearchPhase } from '@/lib/api/use-search-request';

/**
 * Everything a search can be except an answer, rendered once.
 *
 * ## Why this is one component and not five conditionals per screen
 *
 * There are six non-ready phases and every screen that searches has to render
 * all of them. Written per screen that is six chances each to collapse two into
 * one — and the pair that always collapses is "you may not see this" into "no
 * matches", which tells an operator that a customer does not exist when the
 * truth is that they are not allowed to look.
 *
 * ## "No matches" appears only after an answer
 *
 * `empty` is reachable only from a COMPLETED read that returned no rows —
 * `useSearchRequest` has no state in which an in-flight request looks like an
 * absence. So this component never has to guess, and the screen never shows an
 * absence it has not established.
 *
 * `idle` renders whatever the page passes as `idle`, which is usually a
 * sentence saying what may be searched for. It is NOT an empty state: nothing
 * has been asked, so there is nothing to report.
 */
export function SearchStates({
  messages,
  phase,
  correlationId,
  idle = null,
  onClearFilters,
  retry,
}: {
  readonly messages: Messages;
  readonly phase: SearchPhase;
  readonly correlationId?: string | null | undefined;
  /** What to show before anything has been asked for. */
  readonly idle?: ReactNode;
  /** Offered beside "no matches", so a too-narrow filter has a way back. */
  readonly onClearFilters?: ReactNode | undefined;
  /** Offered on an outage and on a fault. Never on a refusal. */
  readonly retry?: ReactNode | undefined;
}) {
  const reference = correlationId ?? undefined;

  switch (phase) {
    case 'ready':
      // The caller renders the rows. Nothing to say here.
      return null;
    case 'idle':
      return <>{idle}</>;
    case 'loading':
      return <LoadingState messages={messages} />;
    case 'empty':
      return <NoResultsState messages={messages} onClearFilters={onClearFilters} />;
    case 'unavailable':
      return (
        <BackendUnavailableState
          messages={messages}
          {...(reference ? { correlationId: reference } : {})}
          {...(retry ? { action: retry } : {})}
        />
      );
    case 'refused':
      // No retry. The same request on the same session is refused identically,
      // and a button that cannot work is worse than no button.
      return (
        <PermissionDeniedState
          messages={messages}
          {...(reference ? { correlationId: reference } : {})}
        />
      );
    case 'failed':
      return (
        <ErrorState
          messages={messages}
          {...(reference ? { correlationId: reference } : {})}
          {...(retry ? { action: retry } : {})}
        />
      );
  }
}
