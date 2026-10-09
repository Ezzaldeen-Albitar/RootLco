'use client';

import { useMemo } from 'react';
import Button from '@mui/material/Button';

import { TreePicker } from '@/components/pickers/TreePicker';
import { MuiLoadingState } from '@/components/states/MuiStates';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateWithValues } from '@/i18n/get-messages';

import { asTreeItems } from '../category-tree';
import { pathText, type CategoryList } from './CategoryTree';

/**
 * One item category chosen from the whole tree (P1-32-PRE-OD-INV2B).
 *
 * Built on `TreePicker` (contract H1–H5) over the same data the category
 * screen draws: `useAllItemCategories`, every page of
 * `inv.item-category-list`, so no category beyond the first hundred is
 * missing. Each row reads `name (code)`, an inactive one says so, and the
 * chosen category's whole path is said under the tree — two categories of the
 * same name in different branches read apart.
 *
 * Single choice. `clearLabel` (on by default) draws a "no category" row first,
 * and choosing it reports `''`; a caller that must have a category passes
 * `clearLabel={null}` and `required`.
 *
 * Built for the setup item form, the vehicle specifications and the material
 * requirements panel; none of them draws it yet. The `CategoryPicker` in
 * `shared.tsx` is the one-page select those screens draw today and is a
 * different control.
 */
export interface CategoryTreePickerProps {
  readonly messages: Messages;
  /** `useAllItemCategories()` — the caller owns the read, so a screen reads once. */
  readonly categories: CategoryList;
  readonly label: string;
  /** The chosen category's id, or `''`. */
  readonly value: string;
  readonly onChange: (id: string) => void;
  /** The "no category" row's words; `null` draws none. Defaults to the catalogue's. */
  readonly clearLabel?: string | null | undefined;
  readonly description?: string | undefined;
  readonly error?: string | undefined;
  readonly required?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onEdit?: (() => void) | undefined;
  readonly testId?: string | undefined;
}

export function CategoryTreePicker({
  messages,
  categories,
  label,
  value,
  onChange,
  clearLabel,
  description,
  error,
  required,
  disabled,
  onEdit,
  testId = 'category-tree-picker',
}: CategoryTreePickerProps) {
  const { read, retry } = categories;
  const inactive = translate(messages, 'inventory.setup.status.inactive');
  const items = useMemo(
    () =>
      read.status === 'ok'
        ? asTreeItems(read.items, (category) =>
            category.status === 'active'
              ? `${category.name} (${category.code})`
              : `${category.name} (${category.code}) — ${inactive}`
          )
        : [],
    [read, inactive]
  );

  if (read.status !== 'ok') {
    return (
      <div className="flex flex-col gap-1" data-testid={testId}>
        <span className="text-label font-medium text-text-primary">{label}</span>
        {read.status === 'loading' ? (
          <MuiLoadingState messages={messages} variant="inline" />
        ) : (
          <div className="flex flex-wrap items-center gap-2" role="status">
            <span className="text-supporting text-text-secondary">
              {translate(
                messages,
                read.status === 'denied'
                  ? 'inventory.categories.picker.refused'
                  : 'inventory.categories.picker.unavailable'
              )}
            </span>
            {read.status === 'unavailable' || read.status === 'error' ? (
              <Button type="button" variant="outlined" size="small" onClick={retry}>
                {translate(messages, 'state.retry')}
              </Button>
            ) : null}
          </div>
        )}
      </div>
    );
  }

  const chosen =
    value !== '' && read.forest.byId.has(value)
      ? translateWithValues(messages, 'inventory.categories.picker.chosen', {
          path: pathText(read.forest, value),
        })
      : undefined;
  const truncated = read.truncated
    ? translate(messages, 'inventory.categories.truncated')
    : undefined;
  const empty =
    read.items.length === 0 ? translate(messages, 'inventory.categories.none') : undefined;
  const said = [chosen, empty, truncated, description].filter(Boolean).join(' ') || undefined;
  const none =
    clearLabel === null
      ? undefined
      : (clearLabel ?? translate(messages, 'inventory.categories.picker.none'));

  return (
    <TreePicker
      label={label}
      description={said}
      error={error}
      required={required}
      disabled={disabled}
      onEdit={onEdit}
      testId={testId}
      items={items}
      value={value}
      onChange={onChange}
      noneLabel={none}
    />
  );
}
