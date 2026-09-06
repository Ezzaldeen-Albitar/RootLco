/**
 * `/inventory/opening-stock` — the opening-inventory batch (P1-30 W10,
 * change-control CC-05): the only path by which stock first appears in a
 * fresh organisation, through the product.
 *
 * Gate before read: `inv.stock.read` denies and returns before the screen's
 * first request (the location list for the chosen branch). Opening a batch
 * and adding lines are offered on `inv.stock.operate`; the approval on
 * `inv.adjustment.approve`, and the server still refuses the person who
 * counted (maker ≠ checker). The branch picker needs `org.branch.read`.
 */

import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { OpeningStockScreen } from '@/features/inventory/components/OpeningStockScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

export default async function InventoryOpeningStockPage({
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
    { labelKey: 'inventory.opening.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.stockRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.opening.title"
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
        titleKey="inventory.opening.title"
        descriptionKey="inventory.opening.description"
        crumbs={crumbs}
      />
      <PageBody>
        <OpeningStockScreen
          locale={locale}
          messages={messages}
          canOperate={holds(session.permissions, INVENTORY_PERMISSIONS.operate)}
          canApprove={holds(session.permissions, INVENTORY_PERMISSIONS.approve)}
          canReadBranches={holds(session.permissions, INVENTORY_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.opening.title');
