/**
 * `/inventory/setup` — the inventory setup surface (P1-30 W10, change-control
 * CC-05): categories, units, items and stock locations, the master data a
 * fresh organisation needs before any stock can exist.
 *
 * Gate before read: `inv.item.read` denies and returns before the screen's
 * first request (the category and unit lists). The three create forms are
 * offered on `inv.item.manage`, which the server checks tenant-wide; the
 * location list needs `inv.stock.read`; the branch picker `org.branch.read`.
 * Reached from the inventory page and from the opening-stock page.
 */

import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { SetupScreen } from '@/features/inventory/components/SetupScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

export default async function InventorySetupPage({
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
    { labelKey: 'inventory.setup.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.itemRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.setup.title"
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
        titleKey="inventory.setup.title"
        descriptionKey="inventory.setup.description"
        crumbs={crumbs}
      />
      <PageBody>
        <SetupScreen
          locale={locale}
          messages={messages}
          canManage={holds(session.permissions, INVENTORY_PERMISSIONS.itemManage)}
          canReadStock={holds(session.permissions, INVENTORY_PERMISSIONS.stockRead)}
          canReadBranches={holds(session.permissions, INVENTORY_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.setup.title');
