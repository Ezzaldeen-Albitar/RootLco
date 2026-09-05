import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { readWorkOrderInvoice } from '@/features/billing/api';
import { BILLING_PERMISSIONS } from '@/features/billing/billing-contract';
import { InvoiceScreen } from '@/features/billing/components/InvoiceScreen';
import { holds } from '@/features/crm/permissions';
import { readWorkOrderDetail } from '@/features/work-orders/api';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The invoice of a work order (P1-30, `W6`, FE-014, FE-015, FE-019, FE-020).
 *
 * `sal.invoice.manage` gates the page — every invoice read declares it — and
 * it is checked BEFORE any read, the work-order header included. The other
 * codes decide what the screen OFFERS: `sal.finance.view` the amounts, the
 * preview, creating and issuing; `sal.invoice.issue` the act of issuing;
 * `wo.work_order.read` whether the order's header is read. There is no
 * invoice list: a work order named in the address is the only way in.
 */
export default async function InvoicesPage({
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
  const crumbs = [{ labelKey: 'nav.billing' }];

  if (!holds(session.permissions, BILLING_PERMISSIONS.manage)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="invoices.page.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const query = await searchParams;
  const raw = query['workOrderId'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const workOrderId = candidate && UUID.test(candidate) ? candidate : null;

  const canReadWorkOrder = holds(session.permissions, BILLING_PERMISSIONS.workOrderRead);
  let workOrder: WorkOrderListEntry | null = null;
  let workOrderRefused: { readonly reference: string | null } | null = null;
  if (workOrderId !== null && canReadWorkOrder) {
    const detail = await readWorkOrderDetail(workOrderId);
    if (detail.status === 'ok') workOrder = detail.data.workOrder;
    // Holding the code and still not getting the order is a refusal, said with
    // its reference, not "no access".
    else workOrderRefused = { reference: detail.correlationId };
  }
  const initialInvoice = workOrderId !== null ? await readWorkOrderInvoice(workOrderId) : null;

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="invoices.page.title"
        descriptionKey="invoices.page.description"
        crumbs={crumbs}
      />
      <PageBody>
        <InvoiceScreen
          // A new work order in the address is a new screen: the chooser's
          // navigation keeps the page instance, and the screen seeds its read
          // state once from its props.
          key={workOrderId ?? 'none'}
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          workOrder={workOrder}
          workOrderRefused={workOrderRefused}
          initialInvoice={initialInvoice}
          canViewFinance={holds(session.permissions, BILLING_PERMISSIONS.financeView)}
          canIssue={holds(session.permissions, BILLING_PERMISSIONS.issue)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('invoices.page.title');
