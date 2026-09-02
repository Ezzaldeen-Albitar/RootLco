import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { QualityQueueScreen } from '@/features/quality/components/QualityQueueScreen';
import { QUALITY_PERMISSIONS } from '@/features/quality/quality-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * `/work-orders/quality` (P1-29 W8) — the branch QC queue on
 * `qms.qc-record-branch-list`. Gated on `qms.quality_control.read` BEFORE any
 * read; the branch target is chosen from the session's own companies and
 * branches, never typed.
 */
export default async function QualityQueuePage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.workOrders', href: '/work-orders' },
    { labelKey: 'nav.quality' },
  ];

  if (!holds(session.permissions, QUALITY_PERMISSIONS.qcRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="quality.queue.title"
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
        titleKey="quality.queue.title"
        descriptionKey="quality.queue.description"
        crumbs={crumbs}
      />
      <PageBody>
        <QualityQueueScreen
          locale={locale}
          messages={messages}
          companyIds={session.companyIds}
          branchIds={session.branchIds}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('quality.queue.title');
