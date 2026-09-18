import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { VehicleSpecificationsScreen } from '@/features/inventory/components/VehicleSpecificationsScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Vehicle service capacities (P1-32).
 *
 * `inv.item.read` gates the page — the specification list declares exactly that
 * code — and it is checked BEFORE any read is issued. `inv.specification.manage`
 * decides whether recording, confirming and retiring are offered, and must be
 * held TENANT-WIDE, which only the server can decide. `veh.vehicle.read` decides
 * whether the make and model catalogue is requested at all; without it the make
 * is named by its identifier instead of chosen from a list.
 */
export default async function InventoryVehicleSpecificationsPage({
  params,
}: {
  readonly params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.inventory', href: '/inventory' },
    { labelKey: 'inventory.specifications.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.itemRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.specifications.title"
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
        titleKey="inventory.specifications.title"
        descriptionKey="inventory.specifications.description"
        crumbs={crumbs}
      />
      <PageBody>
        <VehicleSpecificationsScreen
          locale={locale}
          messages={messages}
          canManage={holds(session.permissions, INVENTORY_PERMISSIONS.specificationManage)}
          canReadCatalogue={holds(session.permissions, INVENTORY_PERMISSIONS.vehicleRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.specifications.title');
