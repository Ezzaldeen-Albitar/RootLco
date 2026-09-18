import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { TransfersScreen } from '@/features/inventory/components/TransfersScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Stock transfers (P1-32): dispatch, receive in full or in part, settle what did
 * not arrive, and cancel.
 *
 * `inv.stock.read` gates the page and is checked BEFORE any read is issued — the
 * transfer list, the write-off list and the location list are all that code.
 * `inv.stock.operate` and `inv.adjustment.approve` decide what the screen OFFERS;
 * `org.branch.read` whether a branch list is requested for the target.
 */
export default async function InventoryTransfersPage({
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
    { labelKey: 'inventory.transfers.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.stockRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.transfers.title"
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
        titleKey="inventory.transfers.title"
        descriptionKey="inventory.transfers.description"
        crumbs={crumbs}
      />
      <PageBody>
        <TransfersScreen
          locale={locale}
          messages={messages}
          currentUserId={session.userId}
          canOperate={holds(session.permissions, INVENTORY_PERMISSIONS.operate)}
          canApprove={holds(session.permissions, INVENTORY_PERMISSIONS.approve)}
          canReadBranches={holds(session.permissions, INVENTORY_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.transfers.title');
