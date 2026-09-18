import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { readStatistics } from '@/features/platform/api';
import { requirePlatformSession } from '@/features/platform/api/session';
import { PlatformOverview } from '@/features/platform/components/PlatformOverview';
import { ReadFailure } from '@/features/platform/components/ui';
import { PLATFORM_PERMISSIONS, holds } from '@/features/platform/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The console overview (P1-32-PRE-065) — `platform.statistics.read`.
 *
 * Decides on the platform authority BEFORE it reads, so an operator without the
 * statistics authority never spends an expensive read to be refused.
 */
export default async function PlatformOverviewPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requirePlatformSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'platform.nav.overview' }];

  if (!holds(session.platformPermissions, PLATFORM_PERMISSIONS.statisticsRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="platform.overview.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const statistics = await readStatistics();

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="platform.overview.title"
        descriptionKey="platform.overview.description"
        crumbs={crumbs}
      />
      <PageBody>
        {statistics.status === 'ok' ? (
          <PlatformOverview
            locale={locale}
            messages={messages}
            statistics={statistics.data}
            canReadOrganizations={holds(
              session.platformPermissions,
              PLATFORM_PERMISSIONS.organizationRead
            )}
          />
        ) : (
          <ReadFailure
            status={statistics.status}
            correlationId={statistics.correlationId}
            messages={messages}
          />
        )}
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('platform.overview.title');
