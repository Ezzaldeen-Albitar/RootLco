import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { PLATFORM_NAVIGATION } from '@/config/platform-navigation';
import { requirePlatformSession } from '@/features/platform/api/session';
import { AccountMenu } from '@/features/authentication/components/AccountMenu';
import { isLocale } from '@/i18n/config';
import { getMessages, translate } from '@/i18n/get-messages';

/**
 * The Platform Owner Console route group (P1-32-PRE-062).
 *
 * The platform session is resolved HERE, before any console markup exists, so
 * no page under this group can render for a caller the platform session read
 * refuses. The shell is the workspace shell with the console's own navigation
 * model, gated by platform authority codes, and a header label naming the
 * console so it is never mistaken for an organisation's workspace.
 *
 * The session carries no email or name by decision, so the account menu shows a
 * role label and offers sign-out only.
 */
export default async function PlatformLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requirePlatformSession(locale);
  const messages = getMessages(locale);

  return (
    <AppShell
      locale={locale}
      messages={messages}
      navigation={PLATFORM_NAVIGATION}
      capabilities={{ permissions: session.platformPermissions }}
      contextLabel={translate(messages, 'platform.console.title')}
      account={
        <AccountMenu
          locale={locale}
          messages={messages}
          displayName={translate(messages, 'platform.console.operator')}
          email=""
          showProfile={false}
        />
      }
    >
      {children}
    </AppShell>
  );
}
