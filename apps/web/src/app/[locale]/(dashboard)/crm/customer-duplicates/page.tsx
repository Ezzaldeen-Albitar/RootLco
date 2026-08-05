import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { DuplicateReviewScreen } from '@/features/crm/customers/components/DuplicateReviewScreen';
import { CRM_PERMISSIONS, holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * The duplicate-candidate review queue (`P1-27-FE-016`).
 *
 * Gated on `crm.customer.duplicate.review`, which is what
 * `GET /api/v1/customer-duplicates` requires. The route renders the denial
 * **instead of** the screen so a denied operator never issues the first read.
 *
 * `crm.customer.merge` is deliberately **not** checked here. It gates a control
 * inside the screen, not the page: a reviewer who may clear false pairs should
 * still reach this queue even when they may not merge, and hiding the whole page
 * from them would remove work they are entitled to do.
 */
export default async function CustomerDuplicatesPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);

  if (!holds(session.permissions, CRM_PERMISSIONS.duplicateReview)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="crm.duplicates.title"
          crumbs={[{ labelKey: 'nav.customers' }, { labelKey: 'crm.duplicates.title' }]}
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
        titleKey="crm.duplicates.title"
        descriptionKey="crm.duplicates.description"
        crumbs={[{ labelKey: 'nav.customers' }, { labelKey: 'crm.duplicates.title' }]}
      />
      <PageBody fill>
        <DuplicateReviewScreen locale={locale} messages={messages} />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('crm.duplicates.title');
