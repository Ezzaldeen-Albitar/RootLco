import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { requireSession } from '@/features/authentication/api/session';
import { AccountMenu } from '@/features/authentication/components/AccountMenu';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/**
 * The dashboard route group.
 *
 * Every operational screen lives under here and inherits the shell. The group
 * is parenthesised so it adds no URL segment — `/en/administration/users`, not
 * `/en/dashboard/administration/users`, because an operator's URL should name
 * what they are looking at and not the layout that happens to wrap it.
 *
 * ## The session is resolved HERE, before anything renders
 *
 * `requireSession` reads the `httpOnly` cookie, calls `GET /api/v1/auth/session`
 * and redirects to sign-in when there is no valid session. It runs in the
 * layout, so it runs before any child page's markup exists — which is what makes
 * "no protected-content flash" a structural property of the route group rather
 * than something every page has to remember.
 *
 * ## Capabilities
 *
 * The permission set the SERVER resolved for this request. P1-25 shipped this
 * shell defaulting to `NO_CAPABILITIES`, which was the honest appearance of "we
 * do not know yet"; now we do know, and the sidebar shows exactly what the
 * server says this actor holds. A failure to resolve is still an empty sidebar —
 * it redirects rather than falling back to a permissive default.
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

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  return (
    <AppShell
      locale={locale}
      messages={messages}
      capabilities={{ permissions: session.permissions }}
      account={
        <AccountMenu
          locale={locale}
          messages={messages}
          displayName={session.displayName}
          email={session.email}
        />
      }
    >
      {children}
    </AppShell>
  );
}
