'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';

import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { MuiEmptyState, MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic, translateWithValues } from '@/i18n/get-messages';

import { listItems } from '../api';
import type { CategoryForest } from '../category-tree';
import type { InventoryItem, ItemCategory } from '../inventory-contract';
import { CategoryPath, CategoryTreeView, useAllItemCategories } from './CategoryTree';
import { LINK } from './stock-operations';

/**
 * `/inventory/categories` — the item category tree, read only
 * (P1-32-PRE-OD-INV2B, completion plan section 8).
 *
 * Every page of `inv.item-category-list` is read (the cursor is walked; there
 * is no hundred-row ceiling), active and inactive alike, and drawn as the tree
 * the rows' parents describe. Choosing a category shows its path and the items
 * filed directly under it (`inv.item-search` with `categoryId`), a page at a
 * time. Both reads are `inv.item.read`, the page's own gate.
 *
 * Nothing here writes. Renaming, moving and retiring a category have no
 * operation and wait on an Owner decision (CAT01); the only category write that
 * exists — creating one — lives on `/inventory/setup`, and a holder of
 * `inv.item.manage` is pointed there. Every item has a category (the database
 * requires one), so there is no "no category" bucket to draw. No figure per
 * category is shown: no read counts a category's items.
 */
export function CategoriesScreen({
  locale,
  messages,
  canManage,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `inv.item.manage` — only decides whether the way to the create form is offered. */
  readonly canManage: boolean;
}) {
  const categories = useAllItemCategories();
  const { read, retry } = categories;
  const [selected, setSelected] = useState('');

  const setupLink = canManage ? (
    <Link href={`/${locale}/inventory/setup`} className={LINK} data-testid="categories-setup-link">
      {translate(messages, 'inventory.categories.readOnly.create')}
    </Link>
  ) : null;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="categories-screen">
      <Alert severity="info" variant="outlined" data-testid="categories-read-only">
        <p className="text-body">{translate(messages, 'inventory.categories.readOnly.body')}</p>
        <p className="mt-1 text-body">{translate(messages, 'inventory.categories.everyItem')}</p>
        {setupLink ? <p className="mt-2">{setupLink}</p> : null}
      </Alert>

      {read.status === 'loading' ? (
        <MuiLoadingState messages={messages} testId="categories-loading" />
      ) : read.status !== 'ok' ? (
        <MuiReadFailureState
          messages={messages}
          locale={locale}
          status={read.status}
          correlationId={read.correlationId}
          onRetry={retry}
          descriptionKey="inventory.categories.unavailable"
          testId="categories-failure"
        />
      ) : read.items.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          descriptionKey="inventory.categories.none"
          testId="categories-empty"
        />
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-2">
          <section
            aria-labelledby="categories-tree-heading"
            className="flex min-w-0 flex-col gap-2"
          >
            <h2 id="categories-tree-heading" className="text-section-title text-text-heading">
              {translate(messages, 'inventory.categories.tree.heading')}
            </h2>
            {read.truncated ? (
              <p role="status" className="text-supporting text-text-secondary">
                {translate(messages, 'inventory.categories.truncated')}
              </p>
            ) : null}
            <CategoryTreeView
              locale={locale}
              messages={messages}
              forest={read.forest}
              selected={selected}
              onSelect={setSelected}
            />
          </section>
          <section
            aria-labelledby="categories-detail-heading"
            className="flex min-w-0 flex-col gap-3"
          >
            <h2 id="categories-detail-heading" className="text-section-title text-text-heading">
              {translate(messages, 'inventory.categories.detail.heading')}
            </h2>
            {selected === '' || !read.forest.byId.has(selected) ? (
              <p className="text-body text-text-secondary" data-testid="categories-choose">
                {translate(messages, 'inventory.categories.detail.choose')}
              </p>
            ) : (
              <CategoryDetail
                key={selected}
                locale={locale}
                messages={messages}
                forest={read.forest}
                category={read.forest.byId.get(selected) as ItemCategory}
                onChoose={setSelected}
              />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function CategoryDetail({
  locale,
  messages,
  forest,
  category,
  onChoose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly forest: CategoryForest;
  readonly category: ItemCategory;
  readonly onChoose: (id: string) => void;
}) {
  const subcategories = (forest.children.get(category.id) ?? []).length;
  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid="categories-detail">
      <CategoryPath
        messages={messages}
        forest={forest}
        categoryId={category.id}
        onChoose={onChoose}
      />
      <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-body sm:grid-cols-2">
        <div className="flex flex-col">
          <dt className="text-label text-text-secondary">
            {translate(messages, 'inventory.setup.categories.column.code')}
          </dt>
          <dd>
            <code className="font-mono text-caption" dir="ltr">
              {category.code}
            </code>
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-label text-text-secondary">
            {translate(messages, 'inventory.setup.categories.column.status')}
          </dt>
          <dd data-testid="categories-detail-status">
            {translateDynamic(messages, `inventory.setup.status.${category.status}`)}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-label text-text-secondary">
            {translate(messages, 'inventory.categories.detail.subcategories')}
          </dt>
          <dd>
            {subcategories === 0
              ? translate(messages, 'inventory.categories.detail.noSubcategories')
              : translateWithValues(messages, 'inventory.categories.detail.subcategoryCount', {
                  count: String(subcategories),
                })}
          </dd>
        </div>
        {category.description ? (
          <div className="flex flex-col sm:col-span-2">
            <dt className="text-label text-text-secondary">
              {translate(messages, 'inventory.categories.detail.description')}
            </dt>
            <dd>
              <bdi>{category.description}</bdi>
            </dd>
          </div>
        ) : null}
      </dl>
      <CategoryItems locale={locale} messages={messages} category={category} />
    </div>
  );
}

/** The items filed directly under one category, a page at a time. */
function CategoryItems({
  locale,
  messages,
  category,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly category: ItemCategory;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listItems({ categoryId: category.id }, request, cursor),
    [category.id]
  );
  const table = useServerTable<InventoryItem>(load, { initial: INITIAL_REQUEST });
  const columns = useMemo<readonly OperationalColumn<InventoryItem>[]>(
    () => [
      {
        id: 'sku',
        headerKey: 'inventory.items.column.sku',
        cell: (row) => (
          <Link href={`/${locale}/inventory/items/${row.id}`} className={LINK}>
            <code className="font-mono text-caption" dir="ltr">
              {row.sku}
            </code>
          </Link>
        ),
      },
      {
        id: 'name',
        headerKey: 'inventory.items.column.name',
        cell: (row) => <bdi>{row.name}</bdi>,
      },
      {
        id: 'itemType',
        headerKey: 'inventory.items.column.type',
        cell: (row) => (
          <span>{translateDynamic(messages, `inventory.itemType.${row.itemType}`)}</span>
        ),
      },
      {
        id: 'lifecycle',
        headerKey: 'inventory.items.column.lifecycle',
        cell: (row) => (
          <span className={row.lifecycleStatus === 'archived' ? 'text-text-secondary' : ''}>
            {translateDynamic(messages, `inventory.lifecycle.${row.lifecycleStatus}`)}
          </span>
        ),
      },
    ],
    [messages, locale]
  );

  return (
    <section aria-labelledby="categories-items-heading" className="flex min-w-0 flex-col gap-2">
      <h3 id="categories-items-heading" className="text-body font-medium text-text-primary">
        <bdi>
          {translateWithValues(messages, 'inventory.categories.items.heading', {
            name: category.name,
          })}
        </bdi>
      </h3>
      <p className="text-supporting text-text-secondary">
        {translate(messages, 'inventory.categories.items.scope')}
      </p>
      <OperationalGrid<InventoryItem>
        messages={messages}
        locale={locale}
        label={translateWithValues(messages, 'inventory.categories.items.heading', {
          name: category.name,
        })}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        suppressEmptyState
        testId="categories-items-grid"
      />
      {table.status === 'idle' && table.response && table.response.rows.length === 0 ? (
        <MuiEmptyState
          messages={messages}
          descriptionKey="inventory.categories.items.none"
          testId="categories-items-empty"
        />
      ) : null}
    </section>
  );
}
