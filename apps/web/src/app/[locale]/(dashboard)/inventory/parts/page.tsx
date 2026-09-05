import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { PartsScreen } from '@/features/inventory/components/PartsScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { readWorkOrderDetail } from '@/features/work-orders/api';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The parts of one work order (P1-30, `W5`, FE-011 issues and FE-012 returns).
 *
 * `inv.stock.read` gates the page — the part-issue list is the read every
 * operator of this screen makes — and it is checked BEFORE any read is issued,
 * including the work-order header. `inv.stock.operate` offers issuing and
 * returning; `wo.work_order.read` decides whether the header and the required
 * parts are read; `org.branch.read` whether a branch list is requested when the
 * order's branch cannot be read.
 */
export default async function InventoryPartsPage({
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
  const crumbs = [
    { labelKey: 'nav.inventory', href: '/inventory' },
    { labelKey: 'inventory.parts.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.stockRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.parts.title"
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

  const canReadWorkOrder = holds(session.permissions, INVENTORY_PERMISSIONS.workOrderRead);
  let workOrder: WorkOrderListEntry | null = null;
  let workOrderRefused = false;
  if (workOrderId !== null && canReadWorkOrder) {
    const detail = await readWorkOrderDetail(workOrderId);
    if (detail.status === 'ok') workOrder = detail.data.workOrder;
    // Holding the code and still not getting the order (another branch, or
    // nothing there) is not "no access": the screen says the read was refused.
    else workOrderRefused = true;
  }

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="inventory.parts.title"
        descriptionKey="inventory.parts.description"
        crumbs={crumbs}
      />
      <PageBody>
        <PartsScreen
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          workOrder={workOrder}
          workOrderRefused={workOrderRefused}
          canOperate={holds(session.permissions, INVENTORY_PERMISSIONS.operate)}
          canReadWorkOrder={canReadWorkOrder}
          canReadBranches={holds(session.permissions, INVENTORY_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.parts.title');
