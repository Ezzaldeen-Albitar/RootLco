import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { CustomerReturnsScreen } from '@/features/inventory/components/CustomerReturnsScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * A part coming back from a customer (P1-32).
 *
 * `inv.stock.read` gates the page and is checked BEFORE any read is issued — the
 * returnable-quantity read, the returns list and the location list are all that
 * code. Receiving a return needs `inv.stock.operate` AND `sal.finance.view`,
 * because a return against an issued sale raises a credit note from the sold
 * line's amount; the screen offers the form only to a caller holding both rather
 * than offering an act that would fail inside a transaction.
 */
export default async function CustomerReturnsPage({
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
    { labelKey: 'inventory.returns.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.stockRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.returns.title"
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
        titleKey="inventory.returns.title"
        descriptionKey="inventory.returns.description"
        crumbs={crumbs}
      />
      <PageBody>
        <CustomerReturnsScreen
          locale={locale}
          messages={messages}
          canOperate={
            holds(session.permissions, INVENTORY_PERMISSIONS.operate) &&
            holds(session.permissions, INVENTORY_PERMISSIONS.financeView)
          }
          canReadBranches={holds(session.permissions, INVENTORY_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.returns.title');
