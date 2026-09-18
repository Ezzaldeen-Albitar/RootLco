import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { AdjustmentsScreen } from '@/features/inventory/components/AdjustmentsScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Stock adjustments (P1-32): request a correction, and have a different person
 * decide it.
 *
 * `inv.stock.read` gates the page and is checked BEFORE any read is issued.
 * `inv.stock.operate` offers the request form; `inv.adjustment.approve` the
 * decision; `org.branch.read` the branch list. The signed-in person is passed so
 * the screen can say why a request they made themselves is not theirs to decide.
 */
export default async function InventoryAdjustmentsPage({
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
    { labelKey: 'inventory.adjustments.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.stockRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.adjustments.title"
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
        titleKey="inventory.adjustments.title"
        descriptionKey="inventory.adjustments.description"
        crumbs={crumbs}
      />
      <PageBody>
        <AdjustmentsScreen
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

export const generateMetadata = pageMetadata('inventory.adjustments.title');
