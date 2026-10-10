import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { RefundsScreen } from '@/features/billing/components/RefundsScreen';
import { BILLING_PERMISSIONS } from '@/features/billing/billing-contract';
import { holds } from '@/features/crm/permissions';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Refunds (ADR-023 D2, part 2, P1-32-PRE-OD-FD2B): one branch's refund requests,
 * newest first, narrowed by state, customer and invoice.
 *
 * `sal.finance.view` gates the page, and is checked BEFORE any read is issued: it is
 * the code `sal.refund-request-list` declares, and the whole row of a refund request
 * is gated by it, so a caller without it meets a refusal here rather than an empty
 * list that would read as "nobody asked for a refund". The customer and invoice
 * filters are offered to holders of the codes their pickers' reads declare. Deciding
 * a request and recording its payout happen on the invoice's own refunds panel.
 */
export default async function RefundsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.refunds' }];

  if (!holds(session.permissions, BILLING_PERMISSIONS.financeView)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="refunds.page.title"
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
        titleKey="refunds.page.title"
        descriptionKey="refunds.page.description"
        crumbs={crumbs}
      />
      <PageBody>
        <RefundsScreen
          locale={locale}
          messages={messages}
          currentUserId={session.userId}
          canReadCustomers={holds(session.permissions, BILLING_PERMISSIONS.customerRead)}
          canSearchInvoices={holds(session.permissions, BILLING_PERMISSIONS.manage)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('refunds.page.title');
