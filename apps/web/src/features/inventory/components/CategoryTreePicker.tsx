'use client';

import { useId, useMemo } from 'react';
import Button from '@mui/material/Button';

import { TreePicker } from '@/components/pickers/TreePicker';
import { MuiLoadingState } from '@/components/states/MuiStates';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateWithValues } from '@/i18n/get-messages';
import { foldSearchText } from '@/lib/text/normalization';

import { asTreeItems } from '../category-tree';
import { pathText, type CategoryList } from './CategoryTree';

/**
 * One item category chosen from the whole tree (P1-32-PRE-OD-INV2B).
 *
 * Built on `TreePicker` (contract H1–H5) over the same data the category
 * screen draws: `useAllItemCategories`, every page of
 * `inv.item-category-list`, so no category beyond the first hundred is
 * missing. Each row reads the category's NAME, an inactive one says so, and
 * the chosen category's whole path is said under the tree — two categories of
 * the same name in different branches read apart by where they sit.
 *
 * The code is not drawn (P1-32-PRE-OD-INVH). It is typed by whoever creates
 * the category — lower-case letters, digits and underscores — and it is the
 * thing being managed in the categories table and on the category screen, where
 * it keeps its own column. In a picker it was noise after every name
 * ("odqa spare parts (odqa_parts)"). The one case it still serves is two
 * categories of the same name under the same parent, which nothing else on the
 * row tells apart: there, and only there, the code follows the name in
 * brackets, as a unit picker does for two units of one name. "The same name"
 * is what an operator would read as the same: compared after the repository's
 * own name folding (`foldSearchText`: case, runs of white space, tatweel and
 * the Arabic vowel marks, the alef forms) on the composed form of the text, so
 * "Pads" and "Pads " or "PADS", and "فلاتر" and "فلاتـر", count as one. Only
 * the comparison is folded; the name is drawn exactly as it is stored.
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
  const items = useMemo(() => {
    if (read.status !== 'ok') return [];
    // How many categories share a name under one parent: only those need their code.
    const place = (category: { parentCategoryId: string | null; name: string }) =>
      `${category.parentCategoryId ?? ''}\u0000${
        foldSearchText(category.name.normalize('NFC').replace(/\s+/gu, ' ').trim()) ?? ''
      }`;
    const sharing = new Map<string, number>();
    for (const category of read.items) {
      sharing.set(place(category), (sharing.get(place(category)) ?? 0) + 1);
    }
    return asTreeItems(read.items, (category) => {
      const name =
        (sharing.get(place(category)) ?? 0) > 1
          ? `${category.name} (${category.code})`
          : category.name;
      return category.status === 'active' ? name : `${name} — ${inactive}`;
    });
  }, [read, inactive]);

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
