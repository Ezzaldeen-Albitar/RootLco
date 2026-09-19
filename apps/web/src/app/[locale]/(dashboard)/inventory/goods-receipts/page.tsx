import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { GoodsReceiptsScreen } from '@/features/inventory/components/GoodsReceiptsScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Goods receipts and the item cost history (P1-32).
 *
 * `inv.stock.read` gates the page and is checked BEFORE any read is issued.
 * `inv.stock.operate` offers the receipt form and posting; `inv.cost.view` the
 * unit-cost fields and the cost history; `org.branch.read` the branch list.
 */
export default async function InventoryGoodsReceiptsPage({
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
    { labelKey: 'inventory.receipts.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.stockRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.receipts.title"
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
        titleKey="inventory.receipts.title"
        descriptionKey="inventory.receipts.description"
        crumbs={crumbs}
      />
      <PageBody>
        <GoodsReceiptsScreen
          locale={locale}
          messages={messages}
          canOperate={holds(session.permissions, INVENTORY_PERMISSIONS.operate)}
          canViewCost={holds(session.permissions, INVENTORY_PERMISSIONS.costView)}
          canReadBranches={holds(session.permissions, INVENTORY_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.receipts.title');
