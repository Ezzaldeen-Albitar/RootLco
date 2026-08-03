import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/**
 * The design route group — the component gallery, and nothing else.
 *
 * ## Why it is separate from `(dashboard)`
 *
 * P1-26 makes every operational screen require a session. The gallery is not an
 * operational screen: it renders fixed fixtures, holds no customer or business
 * data, exposes no privileged capability, and exists so a designer or reviewer
 * can look at the component set. It is already gated by `galleryEnabled()`,
 * which serves a 404 in production unless a deployment opts in.
 *
 * Putting it behind the session would have been *more* locked down and would
 * have broken the review workflow it exists for — a reviewer looking at
 * components does not necessarily hold an account in a tenant. The environment
 * gate stays the control, and this group records that as a decision rather than
 * leaving it as a side effect of where the file happened to sit.
 *
 * It renders the shell with NO capabilities, so the sidebar shows only the
 * ungated entries. There is no account menu, because there is no account.
 */
export default async function DesignLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <AppShell locale={locale} messages={getMessages(locale)}>
      {children}
    </AppShell>
  );
}
