import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { MovementsScreen } from '@/features/inventory/components/MovementsScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { readWorkOrderDetail } from '@/features/work-orders/api';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stock movements (P1-30, `W5`, FE-013): the ledger of one branch.
 *
 * `inv.stock.read` gates the page and is checked BEFORE any read. The screen
 * reads the working branch's recent movements on arrival (route sweep B2); the
 * read is recorded server-side and the screen says so. `inv.item.read` and
 * `wo.work_order.read` decide whether the item and the job are found by name or
 * given as labelled references. A work order named in the address prefills the
 * filter — by its number when the operator may read it.
 */
export default async function InventoryMovementsPage({
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
    { labelKey: 'inventory.movements.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.stockRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.movements.title"
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
  if (canReadWorkOrders && workOrderId !== null) {
    const detail = await readWorkOrderDetail(workOrderId);
    if (detail.status === 'ok') initialWorkOrder = detail.data.workOrder;
  }

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="inventory.movements.title"
        descriptionKey="inventory.movements.description"
        crumbs={crumbs}
      />
      <PageBody>
        <MovementsScreen
          locale={locale}
          messages={messages}
          initialWorkOrderId={workOrderId}
          initialWorkOrder={initialWorkOrder}
          canReadWorkOrders={canReadWorkOrders}
          canReadItems={holds(session.permissions, INVENTORY_PERMISSIONS.itemRead)}
          canReadBranches={holds(session.permissions, INVENTORY_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.movements.title');
