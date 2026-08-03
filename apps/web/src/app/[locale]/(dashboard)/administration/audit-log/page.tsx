import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { DEFAULT_WINDOW_DAYS } from '@/features/administration/audit/types';
import { AuditLogScreen } from '@/features/administration/audit/components/AuditLogScreen';
import { PERMISSIONS, holds } from '@/features/administration/shared/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Audit log.
 *
 * The opening range is computed on the SERVER. Computing it in the browser would
 * make the first request depend on the visitor's clock, so two operators in
 * different time zones would open the same screen on different windows and see
 * different rows — and neither would know why.
 */
export default async function AuditLogPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.administration', href: `/${locale}/administration` },
    { labelKey: 'nav.auditLog' },
  ];

  if (!holds(session.permissions, PERMISSIONS.auditView)) {
    return (
      <>
        <PageHeader locale={locale} messages={messages} titleKey="audit.title" crumbs={crumbs} />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const now = new Date();
  const from = new Date(now.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="audit.title"
        descriptionKey="audit.description"
        crumbs={crumbs}
      />
      <PageBody>
        <AuditLogScreen
          locale={locale}
          messages={messages}
          initialFrom={isoDate(from)}
          initialTo={isoDate(now)}
        />
      </PageBody>
    </>
  );
}

/** YYYY-MM-DD in UTC, which is what a date input expects and what the range means. */
function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/** The document title. Same key as the visible header, so they cannot disagree. */
export const generateMetadata = pageMetadata('audit.title');
