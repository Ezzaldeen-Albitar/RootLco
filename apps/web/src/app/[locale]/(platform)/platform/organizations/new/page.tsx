import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { listPlans } from '@/features/platform/api';
import { requirePlatformSession } from '@/features/platform/api/session';
import { ProvisionOrganizationScreen } from '@/features/platform/components/ProvisionOrganizationScreen';
import { PLATFORM_PERMISSIONS, holds } from '@/features/platform/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Provisioning (P1-32-PRE-065) — `platform.organization.provision`.
 *
 * The plan choice is read only for an operator who may read the catalogue
 * (`platform.subscription.manage`); without it the subscription section is not
 * offered, and the organisation is created without one.
 */
export default async function PlatformProvisionPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requirePlatformSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'platform.nav.organizations', href: `/${locale}/platform/organizations` },
    { labelKey: 'platform.provision.title' },
  ];

  if (!holds(session.platformPermissions, PLATFORM_PERMISSIONS.organizationProvision)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="platform.provision.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const plans = holds(session.platformPermissions, PLATFORM_PERMISSIONS.subscriptionManage)
    ? await listPlans()
    : null;

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="platform.provision.title"
        descriptionKey="platform.provision.description"
        crumbs={crumbs}
      />
      <PageBody>
        <ProvisionOrganizationScreen
          locale={locale}
          messages={messages}
          plans={plans && plans.status === 'ok' ? plans.data.items : null}
          canActivate={holds(
            session.platformPermissions,
            PLATFORM_PERMISSIONS.organizationLifecycle
          )}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('platform.provision.title');
