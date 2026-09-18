import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { UnitConversionsScreen } from '@/features/inventory/components/UnitConversionsScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Exact unit conversions (P1-32).
 *
 * `inv.item.read` gates the page — the conversion list declares exactly that
 * code — and it is checked BEFORE any read is issued. `inv.unit_conversion.manage`
 * decides whether stating and retiring are offered; it must be held TENANT-WIDE,
 * which only the server can decide, so a branch-confined holder sees the controls
 * and is refused by the server, and the screen renders that refusal as published.
 */
export default async function InventoryUnitConversionsPage({
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
    { labelKey: 'inventory.conversions.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.itemRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.conversions.title"
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
        titleKey="inventory.conversions.title"
        descriptionKey="inventory.conversions.description"
        crumbs={crumbs}
      />
      <PageBody>
        <UnitConversionsScreen
          locale={locale}
          messages={messages}
          canManage={holds(session.permissions, INVENTORY_PERMISSIONS.unitConversionManage)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.conversions.title');
