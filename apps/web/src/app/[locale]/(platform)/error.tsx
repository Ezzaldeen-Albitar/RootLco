'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { ErrorState } from '@/components/states/States';
import { localeFromPathname } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';
import { report } from '@/lib/observability/client-log';

/**
 * Server-failure boundary for the Platform Owner Console route group.
 *
 * Each console page already draws a REFUSED read as a refusal. This catches the
 * other half: a render that throws. Without this file such a failure escaped the
 * console entirely — there is no boundary above this group — and the operator
 * lost the shell, the navigation and the language along with the page.
 *
 * `error.digest` is the only thing taken from the error object, and the only
 * thing reported. It is an opaque server-generated reference support can match
 * against the log; a Next.js error message routinely carries a file path and a
 * serialised property, and neither belongs on a screen or in a beacon.
 *
 * The locale comes from the PATH: a boundary is a client component and Next
 * gives it no `params`, so `DEFAULT_LOCALE` would draw an English page inside an
 * Arabic document (P1-26-F-071).
 */
export default function PlatformError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const messages = getMessages(localeFromPathname(usePathname()));

  useEffect(() => {
    report({
      level: 'error',
      event: 'web.boundary.platform',
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
          className="rounded-md bg-primary px-4 py-2 text-button font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {translate(messages, 'state.retry')}
        </button>
      }
    />
  );
}
