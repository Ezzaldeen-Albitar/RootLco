'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { ErrorState } from '@/components/states/States';
import { localeFromPathname } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';
import { report } from '@/lib/observability/client-log';

/**
 * Route-group error boundary.
 *
 * `error.digest` is the ONLY thing shown from the error object. It is an opaque
 * server-generated hash that support can match against the server log; the
 * message and stack stay where they belong. Rendering `error.message` here is
 * the common shortcut and it publishes internal paths and query fragments to
 * whoever is looking at the screen.
 *
 * The same restraint applies to what is REPORTED. The digest and the route
 * without its query string go to the monitoring boundary; the message and the
 * stack do not, because a Next.js error message routinely contains a file path
 * and a serialised prop.
 */
export default function DashboardError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  /*
   * The locale comes from the PATH, not from `DEFAULT_LOCALE`.
   *
   * An error boundary is a client component and Next gives it no `params`, so
   * reading the default was the obvious thing to do — and it is exactly the
   * defect recorded as `P1-26-F-059`, where the English interface announced its
   * loading state in Arabic because `DEFAULT_LOCALE` is `'ar'`. Here it fails
   * the other way: an Arabic operator who hits a route error gets an English
   * page inside a `lang="ar" dir="rtl"` document.
   *
   * `loading.tsx` was fixed for this and its two siblings were not. Same fix,
   * same reason (`P1-26-F-071`).
   */
  const messages = getMessages(localeFromPathname(usePathname()));

  useEffect(() => {
    // Not a setState — a report. The effect runs once per distinct error, so an
    // error that renders twice is not counted twice.
    report({
      level: 'error',
      event: 'web.boundary.dashboard',
      correlationId: error.digest ?? null,
      route: window.location.pathname,
    });
  }, [error.digest]);

  return (
    <ErrorState
      messages={messages}
      {...(error.digest ? { correlationId: error.digest } : {})}
      action={
        <button
          type="button"
          onClick={reset}
          className="rounded-md bg-primary px-4 py-2 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover"
        >
          {translate(messages, 'state.retry')}
        </button>
      }
    />
  );
}
