/**
 * `/inventory/categories` — the item category tree, read only
 * (P1-32-PRE-OD-INV2B, completion plan section 8).
 *
 * Gate before read: `inv.item.read` — the code both reads declare
 * (`inv.item-category-list`, and `inv.item-search` for a category's items) —
 * denies and returns before the screen's first request. `inv.item.manage`
 * decides only whether the way to the create form on `/inventory/setup` is
 * offered; nothing on this page writes. Tenant-wide: no branch is addressed.
 *
 * The address may name the category the page opens on (`?category=<id>`,
 * P1-32-PRE-OD-INV2; the item page's header links here that way). It is read
 * only after the gate, its first value is taken when it repeats, and anything
 * that is not an identifier is ignored. An identifier the tree does not hold
 * opens the page as it opens without one: nothing chosen.
 */

import { notFound } from 'next/navigation';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import { PermissionDeniedState } from '@/components/states/States';
import { requireSession } from '@/features/authentication/api/session';
import { holds } from '@/features/crm/permissions';
import { CategoriesScreen } from '@/features/inventory/components/CategoriesScreen';
import { INVENTORY_PERMISSIONS } from '@/features/inventory/inventory-contract';
import { isLocale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { pageMetadata } from '@/lib/page-metadata';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function InventoryCategoriesPage({
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
    { labelKey: 'nav.inventory', href: `/${locale}/inventory` },
    { labelKey: 'inventory.categories.title' },
  ];

  if (!holds(session.permissions, INVENTORY_PERMISSIONS.itemRead)) {
    return (
      <>
        <PageHeader
          locale={locale}
          messages={messages}
          titleKey="inventory.categories.title"
          crumbs={crumbs}
        />
        <PageBody>
          <PermissionDeniedState messages={messages} />
        </PageBody>
      </>
    );
  }

  const query = await searchParams;
  const raw = query['category'];
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  const initialCategoryId = candidate && UUID.test(candidate) ? candidate : null;

  return (
    <>
      <PageHeader
        locale={locale}
        messages={messages}
        titleKey="inventory.categories.title"
        descriptionKey="inventory.categories.description"
        crumbs={crumbs}
      />
      <PageBody>
        <CategoriesScreen
          locale={locale}
          messages={messages}
          canManage={holds(session.permissions, INVENTORY_PERMISSIONS.itemManage)}
          initialCategoryId={initialCategoryId}
        />
      </PageBody>
    </>
  );
}

export const generateMetadata = pageMetadata('inventory.categories.title');
