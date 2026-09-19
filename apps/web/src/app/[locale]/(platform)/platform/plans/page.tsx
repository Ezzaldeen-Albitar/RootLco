import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { listPlans } from '@/features/platform/api';
import { requirePlatformSession } from '@/features/platform/api/session';
import { PlansScreen } from '@/features/platform/components/PlansScreen';
import { ReadFailure } from '@/features/platform/components/ui';
import { PLATFORM_PERMISSIONS, holds } from '@/features/platform/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The plan catalogue (P1-32-PRE-068) — `platform.subscription.manage`.
 *
 * `platform.plan-list` declares the subscription authority, not the
 * organisation read, so that is the code this page decides on: gating the list
 * on the organisation read would show a table the server then refuses.
 */
export default async function PlatformPlansPage({
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
    { labelKey: 'platform.nav.plans' },
  ];

  if (!holds(session.platformPermissions, PLATFORM_PERMISSIONS.subscriptionManage)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="platform.plans.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const plans = await listPlans();

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="platform.plans.title"
        descriptionKey="platform.plans.description"
        crumbs={crumbs}
      />
      <PageBody>
        {plans.status === 'ok' ? (
          <PlansScreen locale={locale} messages={messages} plans={plans.data.items} />
        ) : (
          <ReadFailure
            status={plans.status}
            correlationId={plans.correlationId}
            messages={messages}
          />
        )}
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('platform.plans.title');
