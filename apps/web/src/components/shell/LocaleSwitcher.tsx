'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
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
 * The query string is deliberately DROPPED. Table state is safe to publish by
 * construction, but re-attaching it here would mean this component has to know
 * which parameters are safe — a second place for that rule to be wrong. Losing
 * a page number on a language change is a smaller cost than a second
 * URL-safety policy.
 */
export function LocaleSwitcher({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const pathname = usePathname() ?? `/${locale}`;

  return (
    <nav aria-label={translate(messages, 'locale.switch')}>
      <ul className="flex items-center gap-1">
        {LOCALES.map((candidate) => {
          const active = candidate === locale;
          return (
            <li key={candidate}>
              <Link
                href={swapLocale(pathname, candidate)}
                hrefLang={candidate}
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
