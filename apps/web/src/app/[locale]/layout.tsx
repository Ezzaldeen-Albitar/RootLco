import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { brandTheme } from '@/components/brand';
import { brandProductName } from '@/components/brand/theme';
import { NotificationHost } from '@/components/notifications';
import { DEFAULT_LOCALE, LOCALES, directionOf, isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
}

/**
 * The document title, in the caller's language.
 *
 * Added by the P1-26 Owner-acceptance remediation as `P1-26-F-046`. The
 * application had **no `<title>` at all**, on any route, in either language —
 * WCAG 2.4.2 (Page Titled, Level A), reported by axe as a *serious*
 * `document-title` violation on all fourteen authenticated routes.
 *
 * It survived the whole phase because nothing had ever scanned a rendered page:
 * the jsdom tier renders components, not documents, and the browser suite
 * asserted on landmarks rather than on `document.title`. A missing title is
 * invisible in every one of those and obvious the moment a screen reader
 * announces the page or an operator has two tabs open.
 *
 * `template` means each screen contributes only its own name and the product
 * name is appended once, here — so a screen cannot forget it and cannot
 * hard-code it.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const messages = getMessages(isLocale(locale) ? locale : DEFAULT_LOCALE);
  return {
    title: {
      default: `${brandProductName} — ${translate(messages, 'app.tagline')}`,
      template: `%s — ${brandProductName}`,
    },
    description: translate(messages, 'app.tagline'),
  };
}

/**
 * Locale layout — the single place `lang`, `dir` and the theme are applied.
 *
 * Applying them on <html> server-side is what prevents the direction flash: the
 * document arrives already correct rather than being corrected after hydration.
 */
export default async function LocaleLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const messages = getMessages(locale);

  return (
    <html lang={locale} dir={directionOf(locale)} data-theme={brandTheme}>
      {/*
        `app-viewport` is what makes the document a non-scrolling surface, and
        it is deliberately a CLASS on this body rather than a rule on every
        body: routes outside `[locale]` — the root page and Next's built-in
        not-found — have no shell and no inner scroller, and would become
        unreachable rather than scrollable. See `_reset.scss`.
      */}
      <body className="app-viewport">
        <a className="skip-link" href="#main">
          {translate(messages, 'app.skipToContent')}
        </a>
        {children}
        {/*
          The single notification authority, mounted ONCE and above every route
          group — `(auth)`, `(dashboard)` and `(design)` all inherit it, so a
          sign-in failure and a save failure are reported by the same component
          in the same place.

          It sits here rather than inside the shell because the shell is
          `overflow:hidden`: a toast rendered within it would be clipped. As a
          direct child of `<body>` with `position:fixed` it is measured against
          the viewport, contributes no document height, and stays visible however
          far `main` is scrolled.

          It is placed AFTER `{children}` so it comes last in DOM order, which
          means a keyboard user reaches the page content first and the
          notification stack last rather than being interrupted by it.
        */}
        <NotificationHost messages={messages} />
      </body>
    </html>
  );
}

/**
 * Rendered per REQUEST, not prerendered.
 *
 * The Content Security Policy carries a per-request nonce, and Next stamps that
 * nonce on its inline bootstrap scripts only while it is rendering. A page
 * generated at BUILD time has no nonce, so its bootstrap is blocked and the
 * page arrives blank — see src/lib/security/csp.ts, finding P1-25-F-022.
 *
 * A nonce CSP and prerendering are therefore incompatible, and this phase
 * chooses the policy. Every operational screen from P1-26 onward is
 * authenticated and dynamic in any case; a prerendered page with a disabled CSP
 * would be fast and unprotected.
 */
export const dynamic = 'force-dynamic';

export const dynamicParams = false;
export { DEFAULT_LOCALE };
