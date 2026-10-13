import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { InventoryScreen } from '@/features/inventory/components/InventoryScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { readWorkOrderDetail } from '@/features/work-orders/api';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Inventory (P1-30, `W4`, FE-008/009/010): the item search, stock
 * availability and reservations.
 *
 * `inv.item.read` gates the page — the item search is the read every operator
 * of this screen makes, and it is checked BEFORE any read is issued. The other
 * codes decide what the screen OFFERS: `inv.stock.read` opens the stock
 * panels, `inv.stock.operate` the reserve and release actions, and
 * `org.branch.read` decides whether a branch list is requested for the target.
 * A work order named in the address prefills the reservation filters — by its
 * number when `wo.work_order.read` lets the page read it, as a labelled
 * reference otherwise.
 */
export default async function InventoryPage({
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
  const crumbs = [{ labelKey: 'nav.inventory' }];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.itemRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.page.title"
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
  /*
   * The job the address names is shown by its number, found with the picker,
   * when the operator may read jobs (route sweep B2). Without that code the
   * reference stays in the labelled box it has always been in. A read that is
   * refused or finds nothing narrows nothing, and the screen says so.
   */
  const canReadWorkOrders = holds(session.permissions, INVENTORY_PERMISSIONS.workOrderRead);
  let initialWorkOrder: WorkOrderListEntry | null = null;
  if (
    canReadWorkOrders &&
    workOrderId !== null &&
    holds(session.permissions, INVENTORY_PERMISSIONS.stockRead)
  ) {
    const detail = await readWorkOrderDetail(workOrderId);
    if (detail.status === 'ok') initialWorkOrder = detail.data.workOrder;
  }

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="inventory.page.title"
        descriptionKey="inventory.page.description"
        crumbs={crumbs}
      />
      <PageBody>
        <InventoryScreen
          locale={locale}
          messages={messages}
          initialWorkOrderId={workOrderId}
          initialWorkOrder={initialWorkOrder}
          canReadWorkOrders={canReadWorkOrders}
          canReadStock={holds(session.permissions, INVENTORY_PERMISSIONS.stockRead)}
          canOperate={holds(session.permissions, INVENTORY_PERMISSIONS.operate)}
          canReadBranches={holds(session.permissions, INVENTORY_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.page.title');
