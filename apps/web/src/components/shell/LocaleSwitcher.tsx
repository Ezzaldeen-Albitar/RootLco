'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { carriableSearchParams } from '@/components/data-table/table-state';
import { LOCALES, isLocale, type Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

/**
 * The locale switcher.
 *
 * Renders real `<a>` links to the same path under the other locale, not a
 * client-side state toggle. That matters for three reasons:
 *
 *   1. `lang` and `dir` are set on `<html>` by the SERVER layout. Switching
 *      client-side would leave the document in the previous direction until a
 *      re-render, which is the direction flash the architecture exists to avoid.
 *   2. The path is preserved, so an operator switching language stays on the
 *      screen they were reading.
 *   3. A link works without JavaScript and can be opened in a new tab.
 *
 * ## The query string is now PRESERVED, through the existing authority
 *
 * It used to be dropped, and the reason given was sound: re-attaching it here
 * would have made this component a second opinion about which parameters are
 * safe to publish. The fix is not to accept that cost but to remove the second
 * opinion — `carriableSearchParams` lives in `table-state.ts`, beside the code
 * that WRITES those parameters, and both sides of the rule move together.
 *
 * So an operator on page 3 of Users, sorted by name, switching to Arabic, stays
 * on page 3 of Users sorted by name. Anything not on the allow-list is dropped,
 * which is why a token or a customer name cannot ride along even if some future
 * screen puts one in its URL.
 */
export function LocaleSwitcher({
  locale,
  messages,
  className,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** Lets the header and the auth card space it differently without a fork. */
  readonly className?: string | undefined;
}) {
  const pathname = usePathname() ?? `/${locale}`;
  // `useSearchParams` returns a read-only instance; `carriableSearchParams`
  // copies rather than mutating it.
  const search = useSearchParams();

  return (
    <nav aria-label={translate(messages, 'locale.switch')} className={className}>
      <ul className="flex items-center gap-1">
        {LOCALES.map((candidate) => {
          const active = candidate === locale;
          return (
            <li key={candidate}>
              <Link
                href={withCarriedQuery(swapLocale(pathname, candidate), search)}
                hrefLang={candidate}
                lang={candidate}
                aria-current={active ? 'true' : undefined}
                className={`rounded-md px-2 py-1 text-supporting transition-colors duration-fast ease-standard ${
                  active
                    ? 'bg-primary-subtle font-medium text-primary'
                    : 'text-text-secondary hover:bg-surface-subtle hover:text-text-primary'
                }`}
              >
                {translate(messages, `locale.${candidate}` as keyof Messages)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Appends the carriable query parameters to a path.
 *
 * Pure and separately testable: given a path and any query, it returns what the
 * link will point at, so "no secret survives a language change" is a unit test
 * and not a browser observation.
 */
export function withCarriedQuery(path: string, search: URLSearchParams | string): string {
  const carried = carriableSearchParams(search).toString();
  return carried ? `${path}?${carried}` : path;
}

/**
 * Replaces the locale segment, preserving the rest of the path.
 *
 * Only the FIRST segment is touched, and only when it is a locale this
 * application serves — a path that does not start with one is prefixed rather
 * than having an arbitrary segment overwritten.
 */
export function swapLocale(pathname: string, next: Locale): string {
  const [, first, ...rest] = pathname.split('/');
  if (first && isLocale(first)) {
    return `/${[next, ...rest].join('/')}`.replace(/\/$/, '') || `/${next}`;
  }
  const suffix = pathname.replace(/^\//, '');
  return suffix ? `/${next}/${suffix}` : `/${next}`;
}
