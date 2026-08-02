import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/**
 * The dashboard route group.
 *
 * Every operational screen lives under here and inherits the shell. The group
 * is parenthesised so it adds no URL segment — `/en/customers`, not
 * `/en/dashboard/customers`, because an operator's URL should name what they
 * are looking at and not the layout that happens to wrap it.
 *
 * Capabilities are NOT passed yet. `AppShell` defaults to no capabilities, so
 * the sidebar currently shows only the ungated entries. That is the correct
 * behaviour until there is a session to read them from — the alternative,
 * defaulting to "everything", would make the first authenticated render a
 * downgrade instead of an upgrade.
 */
export default async function DashboardLayout({
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
