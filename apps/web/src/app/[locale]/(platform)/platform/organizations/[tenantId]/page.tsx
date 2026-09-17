import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { listCharges, listPlans, readOrganization } from '@/features/platform/api';
import { requirePlatformSession } from '@/features/platform/api/session';
import { OrganizationDetailScreen } from '@/features/platform/components/OrganizationDetailScreen';
import { ReadFailure } from '@/features/platform/components/ui';
import { PLATFORM_PERMISSIONS, holds } from '@/features/platform/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One organisation (P1-32-PRE-066) — `platform.organization.read`.
 *
 * The page decides on the organisation authority before reading. The plan
 * catalogue is read only for a subscription manager and the charges only for a
 * billing reader, so neither panel costs a refused read for anyone else.
 */
export default async function PlatformOrganizationPage({
  params,
}: {
  readonly params: Promise<{ locale: string; tenantId: string }>;
}) {
  const { locale, tenantId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requirePlatformSession(locale);
  const messages = getMessages(locale);
  const permissions = session.platformPermissions;
  const crumbs = [
    { labelKey: 'platform.nav.organizations', href: `/${locale}/platform/organizations` },
    { labelKey: 'platform.detail.title' },
  ];

  if (!holds(permissions, PLATFORM_PERMISSIONS.organizationRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="platform.detail.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const organization = await readOrganization(tenantId);
  if (organization.status !== 'ok') {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="platform.detail.title"
          crumbs={crumbs}
        />
        <PageBody>
          <ReadFailure
            status={organization.status}
            correlationId={organization.correlationId}
            messages={messages}
          />
        </PageBody>
      </>
    );
  }

  const canManageSubscription = holds(permissions, PLATFORM_PERMISSIONS.subscriptionManage);
  const canReadBilling = holds(permissions, PLATFORM_PERMISSIONS.billingRead);
  const plans = canManageSubscription ? await listPlans() : null;
  const charges = canReadBilling ? await listCharges(tenantId) : null;

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="platform.detail.title"
        crumbs={crumbs}
      />
      <PageBody>
        <h2 className="mb-4 text-page-title font-semibold text-text-primary">
          {organization.data.displayName}
        </h2>
        <OrganizationDetailScreen
          locale={locale}
          messages={messages}
          organization={organization.data}
          plans={plans && plans.status === 'ok' ? plans.data.items : null}
          charges={charges}
          today={new Date().toISOString().slice(0, 10)}
          capabilities={{
            canChangeLifecycle: holds(permissions, PLATFORM_PERMISSIONS.organizationLifecycle),
            canManageOrganization: holds(permissions, PLATFORM_PERMISSIONS.organizationManage),
            canManageSubscription,
            canReadBilling,
            canManageBilling: holds(permissions, PLATFORM_PERMISSIONS.billingManage),
            canReadAudit: holds(permissions, PLATFORM_PERMISSIONS.auditRead),
          }}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('platform.detail.title');
