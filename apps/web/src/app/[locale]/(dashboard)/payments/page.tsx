import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { PaymentsScreen } from '@/features/payments/components/PaymentsScreen';
import { PAYMENT_PERMISSIONS } from '@/features/payments/payments-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Payments and receipts (P1-30, `W7`, FE-016, FE-017, FE-018, FE-021).
 *
 * `sal.finance.view` gates the page — it is the ONLY code both receipt reads
 * declare, and the one a cashier holds. It is checked BEFORE any read is
 * issued. The other codes decide what the screen OFFERS: `sal.payment.record`
 * the payment form AND the method list it needs (that reference read is gated
 * by the recording authority, a least-privilege gap the read-surface matrix
 * records); `sal.payment.allocate` the act of applying a receipt to an invoice;
 * `org.branch.read` whether a branch list is requested for the target picker.
 *
 * This is where the cashier shape reaches the open balance (FE-019): the
 * invoice screen of `W6` is gated on `sal.invoice.manage`, which a cashier does
 * not hold, so the balance after an allocation is read here instead.
 *
 * Two addresses lead in: a receipt, opened straight onto its detail, and an
 * invoice, which filters the branch's receipts to the ones already applied to
 * it and prefills the allocation form.
 */
export default async function PaymentsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [{ labelKey: 'nav.payments' }];

  if (!holds(session.permissions, PAYMENT_PERMISSIONS.financeView)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="payments.page.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const query = await searchParams;
  const one = (name: string): string | null => {
    const raw = query[name];
    const candidate = Array.isArray(raw) ? raw[0] : raw;
    return candidate && UUID.test(candidate) ? candidate : null;
  };

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="payments.page.title"
        descriptionKey="payments.page.description"
        crumbs={crumbs}
      />
      <PageBody>
        <PaymentsScreen
          locale={locale}
          messages={messages}
          initialReceiptId={one('paymentId')}
          initialInvoiceId={one('invoiceId')}
          canRecord={holds(session.permissions, PAYMENT_PERMISSIONS.record)}
          canAllocate={holds(session.permissions, PAYMENT_PERMISSIONS.allocate)}
          canReadBranches={holds(session.permissions, PAYMENT_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('payments.page.title');
