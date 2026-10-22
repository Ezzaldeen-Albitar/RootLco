import { treeShape, type TreePickerItem } from '@/components/pickers/TreePicker';
import type { CursorPage, ReadFailureStatus, ReadState } from '@/lib/api/read-operation';

import type { ItemCategory } from './inventory-contract';

/**
 * The item category tree, read whole and shaped once (P1-32-PRE-OD-INV2B).
 *
 * `inv.item_categories` names each row's parent (`parent_category_id`, with a
 * cycle guard in the database), and `inv.item-category-list` publishes it as
 * `parentCategoryId`, one cursor page at a time in code order. Everything here
 * is pure: the walk takes the page reader as an argument, and the shape is
 * `TreePicker`'s own `treeShape`, so the browsing tree and the picker place
 * every row in the same spot.
 */

/** One page per request; the route's own ceiling. */
export const CATEGORY_PAGE_SIZE = 100;

/**
 * How many pages one walk may spend before it stops and says so. Not a cap on
 * the catalogue anyone expects — 500 pages is fifty thousand categories — but a
 * bound on a loop whose end is decided by the server's answers.
 */
export const CATEGORY_PAGE_BUDGET = 500;

export type CategoryPageReader = (
  cursor: string | null
) => Promise<ReadState<CursorPage<ItemCategory>>>;

export type AllCategoriesRead =
  | {
      readonly status: 'ok';
      readonly items: readonly ItemCategory[];
      /** The walk stopped before the server said there was no more. */
      readonly truncated: boolean;
      readonly pages: number;
    }
  | { readonly status: ReadFailureStatus; readonly correlationId: string | null };

/**
 * Every page of the category list, in the server's order.
 *
 * The walk follows `nextCursor` while `hasMore` holds. It stops — and reports
 * `truncated` rather than pretending the list is whole — when a cursor repeats
 * or the page budget is spent. A failed page fails the whole read: half a tree
 * would place children at the top level as if their parents did not exist.
 * `isCurrent` lets the caller abandon a walk it no longer wants.
 */
export async function readAllCategories(
  readPage: CategoryPageReader,
  isCurrent: () => boolean = () => true
): Promise<AllCategoriesRead | null> {
  const items: ItemCategory[] = [];
  const ids = new Set<string>();
  const seen = new Set<string>();
  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    const state = await readPage(cursor);
    if (!isCurrent()) return null;
    if (state.status !== 'ok') {
      return { status: state.status, correlationId: state.correlationId };
    }
    pages += 1;
    // A row a later page repeats is kept once: the tree draws each id once.
    for (const row of state.data.items) {
      if (ids.has(row.id)) continue;
      ids.add(row.id);
      items.push(row);
    }
    const next = state.data.nextCursor;
    if (!state.data.hasMore || next === null) {
      return { status: 'ok', items, truncated: false, pages };
    }
    if (seen.has(next) || pages >= CATEGORY_PAGE_BUDGET) {
      return { status: 'ok', items, truncated: true, pages };
    }
    seen.add(next);
    cursor = next;
  }
}

export interface CategoryForest {
  readonly byId: ReadonlyMap<string, ItemCategory>;
  /** Top-level ids in the server's order, including any row the tree could not place. */
  readonly roots: readonly string[];
  readonly children: ReadonlyMap<string, readonly string[]>;
  /**
   * Rows drawn at the top level although they name a parent: the parent is not
   * in the list, or a cycle hid it. The database refuses both, so this is
   * defensive, and every such row says so beside its name.
   */
  readonly misplaced: ReadonlySet<string>;
}

/** The categories as `TreePicker` rows; the label is the name, the code travels beside it. */
export function asTreeItems(
  items: readonly ItemCategory[],
  label: (category: ItemCategory) => string = (category) => category.name
): readonly TreePickerItem[] {
  return items.map((category) => ({
    id: category.id,
    parentId: category.parentCategoryId,
    label: label(category),
  }));
}

export function buildCategoryForest(items: readonly ItemCategory[]): CategoryForest {
  const byId = new Map(items.map((category) => [category.id, category]));
  const shape = treeShape(asTreeItems(items));
  const children = new Map<string, readonly string[]>();
  for (const [parent, rows] of shape.children) {
    children.set(
      parent,
      rows.map((row) => row.id)
    );
  }
  const roots = shape.roots.map((row) => row.id);
  const misplaced = new Set(
    shape.roots.filter((row) => row.parentId !== null).map((row) => row.id)
  );
  return { byId, roots, children, misplaced };
}

/** The ids of a category's ancestors, nearest first, as the tree places them. */
export function ancestorIds(forest: CategoryForest, id: string): readonly string[] {
  if (forest.misplaced.has(id)) return [];
  const found: string[] = [];
  let current = forest.byId.get(id)?.parentCategoryId ?? null;
  while (current !== null && forest.byId.has(current) && !found.includes(current)) {
    found.push(current);
    if (forest.misplaced.has(current)) break;
    current = forest.byId.get(current)?.parentCategoryId ?? null;
  }
  return found;
}

/** The category and its ancestors, top level first — what a breadcrumb draws. */
export function pathOf(forest: CategoryForest, id: string): readonly ItemCategory[] {
  const self = forest.byId.get(id);
  if (!self) return [];
  const path = ancestorIds(forest, id)
    .map((ancestor) => forest.byId.get(ancestor))
    .filter((category): category is ItemCategory => category !== undefined)
    .reverse();
  return [...path, self];
}

/** Every id that has children: what "expand all" opens. */
export function expandableIds(forest: CategoryForest): readonly string[] {
  return [...forest.children.keys()];
}

/** Every id under a category, at any depth. */
function descendantsOf(forest: CategoryForest, id: string, into: Set<string>): void {
  for (const child of forest.children.get(id) ?? []) {
    if (into.has(child)) continue;
    into.add(child);
    descendantsOf(forest, child, into);
  }
}

/** A search term as it is compared: trimmed and folded to lower case in the page's language. */
export function foldTerm(term: string, locale: string): string {
  return term.trim().toLocaleLowerCase(locale);
}

export interface CategorySearch {
  /** The rows whose name or code holds the term. */
  readonly matches: ReadonlySet<string>;
  /** What the tree draws: the matches, every ancestor of one, and everything under one. */
  readonly visible: ReadonlySet<string>;
  /** The ancestors of every match — opened so each match is in view with its context. */
  readonly expanded: readonly string[];
}

/**
 * The tree narrowed to a term without losing where each match sits. A match
 * deep in the tree is drawn under its whole chain of ancestors, opened; a
 * match's own children stay drawn (closed), so a matching parent can still be
 * explored. The comparison is a substring of the name or the code.
 */
export function searchCategories(
  forest: CategoryForest,
  term: string,
  locale: string
): CategorySearch {
  const folded = foldTerm(term, locale);
  const matches = new Set<string>();
  for (const category of forest.byId.values()) {
    if (
      category.name.toLocaleLowerCase(locale).includes(folded) ||
      category.code.toLocaleLowerCase(locale).includes(folded)
    ) {
      matches.add(category.id);
    }
  }
  const visible = new Set<string>(matches);
  const expanded = new Set<string>();
  for (const id of matches) {
    for (const ancestor of ancestorIds(forest, id)) {
      visible.add(ancestor);
      expanded.add(ancestor);
    }
    descendantsOf(forest, id, visible);
  }
  return { matches, visible, expanded: [...expanded] };
}
