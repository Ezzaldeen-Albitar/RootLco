import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { ItemCodesScreen } from '@/features/inventory/components/ItemCodesScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * One item's codes and selling prices (P1-32).
 *
 * `inv.item.read` gates the page and is checked BEFORE any read is issued — the
 * identifier list and the price list are both that code. `inv.item.manage`
 * decides what the screen OFFERS; the server additionally requires it
 * TENANT-WIDE for every identifier write, because a grant scoped to one branch
 * must not be able to redirect a scan in all of them.
 */
export default async function ItemCodesPage({
  params,
}: {
  readonly params: Promise<{ locale: string; itemId: string }>;
}) {
  const { locale, itemId } = await params;
  if (!isLocale(locale)) notFound();

  const session = await requireSession(locale);
  const messages = getMessages(locale);
  const crumbs = [
    { labelKey: 'nav.inventory', href: '/inventory' },
    { labelKey: 'inventory.identifiers.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.itemRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.identifiers.title"
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
        titleKey="inventory.identifiers.title"
        descriptionKey="inventory.identifiers.description"
        crumbs={crumbs}
      />
      <PageBody>
        <ItemCodesScreen
          locale={locale}
          messages={messages}
          itemId={itemId}
          canManage={holds(session.permissions, INVENTORY_PERMISSIONS.itemManage)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.identifiers.title');
