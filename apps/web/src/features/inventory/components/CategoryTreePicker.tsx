'use client';

import { useId, useMemo } from 'react';
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
 * Drawn by the setup screen (the item's category and a new category's parent)
 * and the vehicle specifications (P1-32-PRE-OD-INV2A); the material
 * requirements panel still draws the one-page `CategoryPicker` in `shared.tsx`,
 * a different control.
 *
 * While the read is in flight, and when it fails, there is no tree to carry the
 * field's name, so the wait or the failure is drawn inside a `group` labelled
 * by the field's own label (`aria-labelledby`): a screen reader that lands on
 * the sentence hears which field it is about.
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
  const labelId = `${useId()}-label`;
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
      <div
        className="flex flex-col gap-1"
        data-testid={testId}
        role="group"
        aria-labelledby={labelId}
      >
        <span id={labelId} className="text-label font-medium text-text-primary">
          {label}
          {required ? (
            <span aria-hidden="true" className="ms-1 text-error">
              *
            </span>
          ) : null}
        </span>
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
        {error ? (
          <p role="alert" className="text-supporting text-error">
            {error}
          </p>
        ) : null}
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
