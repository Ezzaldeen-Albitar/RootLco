import { notFound } from 'next/navigation';

import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { LabelsScreen } from '@/features/inventory/components/LabelsScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

/**
 * Printable shelf and part labels (P1-32).
 *
 * `inv.item.read` gates the page and is checked BEFORE any read is issued — the
 * label data, the barcode resolution and the catalogue search are all that code.
 * No other capability is handed to the screen: a label carries no price and no
 * stock figure, so nothing on it is gated on anything else.
 */
export default async function InventoryLabelsPage({
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
    { labelKey: 'inventory.labels.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.itemRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.labels.title"
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
        titleKey="inventory.labels.title"
        descriptionKey="inventory.labels.description"
        crumbs={crumbs}
      />
      <PageBody>
        <LabelsScreen locale={locale} messages={messages} />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.labels.title');
