import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requirePlatformSession } from '@/features/platform/api/session';
import { OrganizationsScreen } from '@/features/platform/components/OrganizationsScreen';
import { PLATFORM_PERMISSIONS, holds } from '@/features/platform/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/** The organisation list (P1-32-PRE-065) — `platform.organization.read`. */
export default async function PlatformOrganizationsPage({
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
    { labelKey: 'platform.nav.organizations' },
  ];

  if (!holds(session.platformPermissions, PLATFORM_PERMISSIONS.organizationRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="platform.organizations.title"
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
        titleKey="platform.organizations.title"
        descriptionKey="platform.organizations.description"
        crumbs={crumbs}
      />
      <PageBody fill>
        <OrganizationsScreen
          locale={locale}
          messages={messages}
          canProvision={holds(
            session.platformPermissions,
            PLATFORM_PERMISSIONS.organizationProvision
          )}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('platform.organizations.title');
