import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requirePlatformSession } from '@/features/platform/api/session';
import { AccountSecurityScreen } from '@/features/platform/components/AccountSecurityScreen';
import { PLATFORM_PERMISSIONS, holds } from '@/features/platform/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Account and security for the platform operator — `platform.organization.read`.
 *
 * The page decides on the same code its one operation declares, which is also
 * the console's base entitlement: every platform grant set contains it, so
 * every operator who can open the console can reach their own password. Gating
 * it on anything narrower would show a form the server then refuses; gating it
 * on a NEW code would hide it from every operator already provisioned.
 *
 * The page performs NO read of its own. Everything it shows about the identity
 * is already in the session the layout resolved, so there is no second request
 * to fail and nothing on this page can disclose more than the session did.
 */
export default async function PlatformAccountPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requirePlatformSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'platform.nav.overview', href: `/${locale}/platform` },
    { labelKey: 'platform.nav.account' },
  ];

  if (!holds(session.platformPermissions, PLATFORM_PERMISSIONS.organizationRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="platform.account.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="platform.account.title"
        descriptionKey="platform.account.description"
        crumbs={crumbs}
      />
      <PageBody>
        <AccountSecurityScreen messages={messages} session={session} />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('platform.account.title');
