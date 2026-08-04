import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { AuthShowcase, BrandMark } from '@/components/brand';
import { LocaleSwitcher } from '@/components/shell/LocaleSwitcher';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/**
 * The authentication route group.
 *
 * A separate group from `(dashboard)` because these screens are reached with no
 * session, and the shell they must NOT have is the one carrying navigation to
 * places the visitor cannot go. The parentheses add no URL segment, so the
 * routes stay `/ar/login` rather than `/ar/auth/login`.
 *
 * ## The layout
 *
 * A deep navy panel and a calm white card. Navy is the structural colour in the
 * approved direction — the same surface the sidebar uses — so the first screen a
 * user meets and the application behind it are recognisably one product. Green
 * appears once, on the submit button, because it is the action colour and this
 * page has exactly one action.
 *
 * The panel is decorative and disappears below `lg`. It carries no instruction
 * and no control, so a narrow viewport loses nothing by dropping it — which is
 * the test for whether a decorative panel is really decorative.
 */
export default async function AuthLayout({
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
    <div className="grid min-h-dvh grid-cols-1 bg-app-background lg:grid-cols-[1fr_minmax(28rem,36rem)]">
      <AuthShowcase messages={messages} />

      <main id="main" tabIndex={-1} className="flex flex-col focus:outline-none">
        <div className="flex items-center justify-between p-4">
          <span className="text-text-heading lg:invisible">
            <BrandMark />
          </span>
          <LocaleSwitcher locale={locale} messages={messages} />
        </div>
        <div className="flex flex-1 items-center justify-center px-4 pb-16">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </main>
    </div>
  );
}
