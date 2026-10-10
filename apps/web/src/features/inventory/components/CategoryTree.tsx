'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import Button from '@mui/material/Button';
import { SimpleTreeView } from '@mui/x-tree-view/SimpleTreeView';
import { TreeItem } from '@mui/x-tree-view/TreeItem';

import { FormTextField } from '@/components/forms/mui/FormTextField';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';

import { listItemCategoryPage } from '../api';
import {
  ancestorIds,
  buildCategoryForest,
  expandableIds,
  foldTerm,
  pathOf,
  readAllCategories,
  searchCategories,
  type AllCategoriesRead,
  type CategoryForest,
} from '../category-tree';
import type { ItemCategory } from '../inventory-contract';

/**
 * The item category tree, browsed (P1-32-PRE-OD-INV2B).
 *
 * Drawn with the MUI X Community tree view — the same package `TreePicker`
 * wraps (ADR-022, "use only for genuine hierarchy") — because browsing needs
 * what a form field does not: opening and closing every branch at once, a
 * search that keeps each match under its ancestors, and a row that says it is
 * inactive or misplaced beside its name. Nothing here writes.
 *
 * Keyboard: the tree view's own model — one tab stop, Up and Down move, Right
 * opens and Left closes (mirrored under right to left), Home and End jump to
 * the first and last row, `*` opens the siblings, a letter jumps by name, Space
 * chooses. Enter chooses the row too, and on a row with children also opens or
 * closes it, so a parent can be chosen without leaving the keyboard's flow.
 */

export type CategoryRead =
  | { readonly status: 'loading' }
  | Exclude<AllCategoriesRead, { status: 'ok' }>
  | {
      readonly status: 'ok';
      readonly items: readonly ItemCategory[];
      readonly truncated: boolean;
      readonly forest: CategoryForest;
    };

export interface CategoryList {
  readonly read: CategoryRead;
  /** Read every page again. */
  readonly retry: () => void;
}

/**
 * Every page of `inv.item-category-list`, walked with its cursor, shaped once.
 * A later walk supersedes an earlier one; an unmounted screen keeps nothing.
 *
 * `enabled` (on unless stated) lets a screen that needs the categories only
 * sometimes — the material requirements, which name a category on some rows
 * and offer one in a form that may never open — read nothing until it does
 * (`P1-32-PRE-OD-INV5`). Once read, the answer is kept while it is switched
 * off again; nothing is read twice for it.
 */
export function useAllItemCategories(enabled = true): CategoryList {
  const [read, setRead] = useState<CategoryRead>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [wanted, setWanted] = useState(enabled);
  // Latched: asked for once, the read is not withdrawn when the need passes.
  if (enabled && !wanted) setWanted(true);
  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    void readAllCategories(listItemCategoryPage, () => live).then((result) => {
      if (!live || result === null) return;
      setRead(
        result.status === 'ok'
          ? {
              status: 'ok',
              items: result.items,
              truncated: result.truncated,
              forest: buildCategoryForest(result.items),
            }
          : result
      );
    });
    return () => {
      live = false;
    };
  }, [attempt, wanted]);
  const retry = useCallback(() => {
    setRead({ status: 'loading' });
    setAttempt((current) => current + 1);
  }, []);
  return { read, retry };
}

/** The name, the code beside it, and what else the row must say. */
function CategoryLabel({
  messages,
  category,
  misplaced,
  match,
}: {
  readonly messages: Messages;
  readonly category: ItemCategory;
  readonly misplaced: boolean;
  readonly match: boolean;
}) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
      <bdi className={match ? 'font-medium text-text-primary' : 'text-text-primary'}>
        {category.name}
      </bdi>
      <code className="font-mono text-caption text-text-secondary" dir="ltr">
        {category.code}
      </code>
      {category.status === 'inactive' ? (
        <span
          className="rounded-sm border border-border px-1 text-caption text-text-secondary"
          data-testid="category-inactive"
        >
          {translate(messages, 'inventory.setup.status.inactive')}
        </span>
      ) : null}
      {misplaced ? (
        <span className="text-caption text-text-secondary" data-testid="category-misplaced">
          {translate(messages, 'inventory.categories.misplaced')}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The chosen category's place in the tree, top level first. Every ancestor is
 * a button that chooses it, so two categories of the same name read apart by
 * the path above them.
 */
export function CategoryPath({
  messages,
  forest,
  categoryId,
  onChoose,
  testId = 'category-path',
}: {
  readonly messages: Messages;
  readonly forest: CategoryForest;
  readonly categoryId: string;
  readonly onChoose?: ((id: string) => void) | undefined;
  readonly testId?: string | undefined;
}) {
  const path = pathOf(forest, categoryId);
  if (path.length === 0) return null;
  return (
    <nav aria-label={translate(messages, 'inventory.categories.path.label')} data-testid={testId}>
      <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-body">
        {path.map((category, index) => {
          const last = index === path.length - 1;
          return (
            <li key={category.id} className="flex items-center gap-x-1">
              {index > 0 ? (
                <span aria-hidden="true" className="text-text-muted">
                  /
                </span>
              ) : null}
              {last || !onChoose ? (
                <bdi aria-current={last ? 'location' : undefined} className="font-medium">
                  {category.name}
                </bdi>
              ) : (
                <Button
                  type="button"
                  variant="text"
                  size="small"
                  onClick={() => onChoose(category.id)}
                >
                  <bdi>{category.name}</bdi>
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** The path as one line of text — a picker's description, a heading. */
export function pathText(forest: CategoryForest, id: string): string {
  return pathOf(forest, id)
    .map((category) => category.name)
    .join(' / ');
}

export interface CategoryTreeViewProps {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly forest: CategoryForest;
  /** The chosen category's id, or `''`. */
  readonly selected: string;
  readonly onSelect: (id: string) => void;
  readonly testId?: string | undefined;
}

/**
 * The tree with its own search and "open all" / "close all". The search narrows
 * what is drawn to the matches, their ancestors (opened) and what lies under a
 * match (closed); clearing it gives back the tree as it was opened before.
 */
export function CategoryTreeView({
  locale,
  messages,
  forest,
  selected,
  onSelect,
  testId = 'category-tree',
}: CategoryTreeViewProps) {
  const [term, setTerm] = useState('');
  const folded = foldTerm(term, locale);
  const searching = folded.length > 0;
  const search = useMemo(
    () => (searching ? searchCategories(forest, folded, locale) : null),
    [forest, folded, locale, searching]
  );

  // What the operator opened by hand, and — while a search is in force — what
  // the search opened plus anything opened or closed since.
  const [browsing, setBrowsing] = useState<readonly string[]>(() =>
    selected === '' ? [] : [...ancestorIds(forest, selected)]
  );
  const [searchOpen, setSearchOpen] = useState<readonly string[]>([]);
  const [searchedFor, setSearchedFor] = useState('');
  const [followed, setFollowed] = useState(selected);
  // Adjusted during render, React's shape for "follow a prop": a new term opens
  // exactly the ancestors of its matches; a choice made elsewhere (the path
  // above the tree) and a cleared search both open the chosen row's ancestors,
  // so the choice stays in view. What the operator opened stays open.
  const opening = (current: readonly string[]) => {
    const wanted = selected === '' ? [] : ancestorIds(forest, selected);
    const missing = wanted.filter((id) => !current.includes(id));
    return missing.length > 0 ? [...current, ...missing] : current;
  };
  if (searchedFor !== folded) {
    setSearchedFor(folded);
    setSearchOpen(search ? search.expanded : []);
    if (!search) setBrowsing(opening(browsing));
  }
  if (followed !== selected) {
    setFollowed(selected);
    if (search) setSearchOpen(opening(searchOpen));
    else setBrowsing(opening(browsing));
  }
  const expanded = search ? searchOpen : browsing;
  const setExpanded = search ? setSearchOpen : setBrowsing;

  const visible = search?.visible ?? null;
  const shown = (id: string) => visible === null || visible.has(id);

  const onItemKeyDown = (id: string) => (event: KeyboardEvent<HTMLLIElement>) => {
    // Enter on a row with children opens it (the tree view's own rule); it
    // chooses the row as well. The event bubbles through every ancestor row,
    // so only the row that holds the focus answers.
    if (event.key !== 'Enter' || event.target !== event.currentTarget) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (id !== selected) onSelect(id);
  };

  const render = (id: string): ReactNode => {
    const category = forest.byId.get(id);
    if (!category || !shown(id)) return null;
    const children = (forest.children.get(id) ?? []).filter(shown);
    return (
      <TreeItem
        key={id}
        itemId={id}
        label={
          <CategoryLabel
            messages={messages}
            category={category}
            misplaced={forest.misplaced.has(id)}
            match={search?.matches.has(id) ?? false}
          />
        }
        onKeyDown={onItemKeyDown(id)}
        data-testid={`${testId}-item`}
        data-category-code={category.code}
      >
        {children.map(render)}
      </TreeItem>
    );
  };

  const roots = forest.roots.filter(shown);
  const allOpen = search ? [...search.visible].filter((id) => forest.children.has(id)) : null;

  return (
    <div className="flex min-w-0 flex-col gap-3" data-testid={testId}>
      <FormTextField
        label={translate(messages, 'inventory.categories.search.label')}
        description={translate(messages, 'inventory.categories.search.help')}
        type="search"
        value={term}
        onChange={setTerm}
        maxLength={200}
        autoComplete="off"
        testId={`${testId}-search`}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outlined"
          size="small"
          onClick={() => setExpanded(allOpen ?? [...expandableIds(forest)])}
        >
          {translate(messages, 'inventory.categories.expandAll')}
        </Button>
        <Button type="button" variant="outlined" size="small" onClick={() => setExpanded([])}>
          {translate(messages, 'inventory.categories.collapseAll')}
        </Button>
      </div>
      {searching && roots.length === 0 ? (
        <p role="status" className="text-body text-text-secondary" data-testid={`${testId}-none`}>
          {translate(messages, 'inventory.categories.search.none')}
        </p>
      ) : (
        <SimpleTreeView
          aria-label={translate(messages, 'inventory.categories.tree.label')}
          className="rounded-md border border-border bg-surface p-2"
          selectedItems={selected === '' ? null : selected}
          onSelectedItemsChange={(_event, next) => {
            if (next !== null) onSelect(next);
          }}
          expandedItems={[...expanded]}
          onExpandedItemsChange={(_event, next) => setExpanded(next)}
        >
          {roots.map(render)}
        </SimpleTreeView>
      )}
    </div>
  );
}
