import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { listOrganizationChoices } from '@/features/platform/api';
import { requirePlatformSession } from '@/features/platform/api/session';
import { PlatformAuditScreen } from '@/features/platform/components/PlatformAuditScreen';
import { PLATFORM_PERMISSIONS, holds } from '@/features/platform/permissions';
import { AUDIT_DEFAULT_WINDOW_DAYS } from '@/features/platform/types';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The platform audit trail (P1-32-PRE-068) — `platform.audit.read`.
 *
 * `?organization=` is the one parameter this page honours: the organisation
 * detail links here with it. It is an identifier the operator followed, never
 * free text, and a malformed value is ignored.
 */
export default async function PlatformAuditPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requirePlatformSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'platform.nav.overview', href: `/${locale}/platform` },
    { labelKey: 'platform.nav.audit' },
  ];

  if (!holds(session.platformPermissions, PLATFORM_PERMISSIONS.auditRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="platform.audit.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const query = await searchParams;
  const requested = typeof query.organization === 'string' ? query.organization : '';
  const organizations = holds(session.platformPermissions, PLATFORM_PERMISSIONS.organizationRead)
    ? await listOrganizationChoices()
    : [];
  const now = new Date();
  const from = new Date(now.getTime() - AUDIT_DEFAULT_WINDOW_DAYS * DAY_MS);

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="platform.audit.title"
        descriptionKey="platform.audit.description"
        crumbs={crumbs}
      />
      <PageBody fill>
        <PlatformAuditScreen
          locale={locale}
          messages={messages}
          initialFrom={from.toISOString().slice(0, 10)}
          initialTo={now.toISOString().slice(0, 10)}
          initialOrganizationId={UUID.test(requested) ? requested : ''}
          organizations={organizations}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('platform.audit.title');
