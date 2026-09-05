import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { MovementsScreen } from '@/features/inventory/components/MovementsScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Stock movements (P1-30, `W5`, FE-013): the ledger of one branch.
 *
 * `inv.stock.read` gates the page and is checked BEFORE any read; the screen
 * itself reads the ledger only on an explicit action, because the read is
 * recorded server-side. `org.branch.read` decides whether a branch list is
 * requested for the target. A work order named in the address prefills the
 * filter.
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
          canReadBranches={holds(session.permissions, INVENTORY_PERMISSIONS.branchRead)}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.movements.title');
