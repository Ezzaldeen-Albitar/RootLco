import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { QuotationsScreen } from '@/features/quotations/components/QuotationsScreen';
import { QUOTATION_PERMISSIONS } from '@/features/quotations/quotations-contract';
import { SERVICE_PERMISSIONS } from '@/features/services/services-contract';
import { readWorkOrderDetail } from '@/features/work-orders/api';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The quotations of a work order, and the builder (P1-30, `W3`, FE-003, FE-005).
 *
 * `quo.quotation.read` gates the page, because the list IS that read; it is
 * checked BEFORE any read is issued. The work order named in the address is
 * read afterwards, and only when the operator holds `wo.work_order.read` — it
 * is context for the screen (number, state, customer, the payer to prefill),
 * not a gate, and its refusal leaves the quotations list standing. The other
 * codes decide what the screen OFFERS: `quo.quotation.manage` opens the
 * builder and `svc.service.read` lets a service be found by code.
 */
export default async function QuotationsPage({
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
  const crumbs = [{ labelKey: 'nav.quotations' }];

  if (!holds(session.permissions, QUOTATION_PERMISSIONS.read)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="quotations.list.title"
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

  let workOrder: WorkOrderListEntry | null = null;
  if (workOrderId !== null && holds(session.permissions, QUOTATION_PERMISSIONS.workOrderRead)) {
    const detail = await readWorkOrderDetail(workOrderId);
    if (detail.status === 'ok') workOrder = detail.data.workOrder;
  }

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="quotations.list.title"
        descriptionKey="quotations.list.description"
        crumbs={crumbs}
      />
      <PageBody>
        <QuotationsScreen
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          workOrder={workOrder}
          canManage={holds(session.permissions, QUOTATION_PERMISSIONS.manage)}
          canReadServices={holds(session.permissions, SERVICE_PERMISSIONS.read)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('quotations.list.title');
