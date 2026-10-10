'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  BackendUnavailableState,
  ErrorState,
  LoadingState,
  NoResultsState,
  PermissionDeniedState,
  SessionExpiredState,
} from '@/components/states/States';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
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
 *
 * ## An ended session is not a fault, and it gets no Try-again
 *
 * It used to arrive as `failed` and render "Something went wrong" over a button
 * that re-issued the same request with the same dead session — which fails
 * identically, every time, and tells the operator nothing about the one thing
 * they have to do. It is its own phase now, it says so, and the only control it
 * offers is the way back to signing in.
 */
export function SearchStates({
  messages,
  locale,
  phase,
  correlationId,
  idle = null,
  onClearFilters,
  retry,
}: {
  readonly messages: Messages;
  /**
   * Only so the sign-in link keeps the operator in their own language. Optional
   * because a caller that never meets an ended session — a component rendered
   * under a resolved session, under test — should not have to invent one; the
   * link is simply not offered without it, and the sentence still is.
   */
  readonly locale?: Locale | undefined;
  readonly phase: SearchPhase;
  readonly correlationId?: string | null | undefined;
  /** What to show before anything has been asked for. */
  readonly idle?: ReactNode;
  /** Offered beside "no matches", so a too-narrow filter has a way back. */
  readonly onClearFilters?: ReactNode | undefined;
  /** Offered on an outage and on a fault. Never on a refusal or an ended session. */
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
    case 'expired':
      // No retry either, for the same reason and a stronger one: the session is
      // gone, so the only thing that can change the answer is signing in again.
      return (
        <SessionExpiredState
          messages={messages}
          {...(locale === undefined
            ? {}
            : {
                action: (
                  <Link
                    href={`/${locale}/login`}
                    className="text-primary underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2"
                  >
                    {translate(messages, 'auth.backToLogin')}
                  </Link>
                ),
              })}
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
