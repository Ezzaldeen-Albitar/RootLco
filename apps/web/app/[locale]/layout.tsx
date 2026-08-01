import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { brandTheme } from '@/components/brand';
import { DEFAULT_LOCALE, LOCALES, directionOf, isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';

export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }));
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
      <body>
        <a className="skip-link" href="#main">
          {translate(messages, 'app.skipToContent')}
        </a>
        {children}
      </body>
    </html>
  );
}

export const dynamicParams = false;
export { DEFAULT_LOCALE };
