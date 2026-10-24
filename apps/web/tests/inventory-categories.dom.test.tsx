import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import {
  inBranch,
  messagesFor,
  renderLtr as renderInLtr,
  renderRtl as renderInRtl,
} from './render';
import { USER_ID, item, itemPage } from './support/stock-operations';

/**
 * The item category tree and the category picker built on it
 * (P1-32-PRE-OD-INV2B).
 *
 * The properties under test, in English and in Arabic (right to left):
 *
 *  - The tree is read WHOLE: every cursor page of the category list, not the
 *    first hundred, active and inactive alike.
 *  - It is drawn from each row's parent: roots, children, six and more levels;
 *    a row whose parent is missing is drawn at the top level and says so.
 *  - Two categories of the same name in different branches read apart by their
 *    path; an inactive category says it is one.
 *  - The search keeps every match under its ancestors, opened; open-all and
 *    close-all; the tree view's keyboard model, with Enter choosing a row.
 *  - Choosing a category lists the items filed under it (`categoryId`), each a
 *    link to its own page; nothing per category is counted.
 *  - The page refuses before any read without `inv.item.read`, says plainly
 *    that nothing here changes a category, and points a holder of
 *    `inv.item.manage` at the create form.
 *  - The address may name the category the page opens on
 *    (P1-32-PRE-OD-INV2): it is read after the gate, only an identifier the
 *    tree holds is chosen, and anything else opens with nothing chosen.
 *  - The picker chooses one category from the same tree and clears it.
 */

type Catalogue = Record<string, string>;
const CATALOGUES: Record<'en' | 'ar', Catalogue> = { en: en as Catalogue, ar: ar as Catalogue };

const listItemCategoryPage = vi.fn();
const listItems = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listItemCategoryPage: (...args: unknown[]) => listItemCategoryPage(...args),
  listItems: (...args: unknown[]) => listItems(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    userId: USER_ID,
    permissions: PERMISSIONS,
    email: 'operator@test.local',
  }),
}));

// A pass-through spy on the tree view: it draws the real tree unchanged and
// records the choice the screen hands it, so a case can prove what the tree
// view was given and not only what it drew.
const treeSelections: string[] = [];
vi.mock('@/features/inventory/components/CategoryTree', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/inventory/components/CategoryTree')>();
  return {
    ...actual,
    CategoryTreeView: (props: Parameters<typeof actual.CategoryTreeView>[0]) => {
      treeSelections.push(props.selected);
      return createElement(actual.CategoryTreeView, props);
    },
  };
});

const { useAllItemCategories } = await import('@/features/inventory/components/CategoryTree');
const { CATEGORY_PAGE_BUDGET, buildCategoryForest, pathOf, readAllCategories, searchCategories } =
  await import('@/features/inventory/category-tree');
const { CategoryTreePicker } = await import('@/features/inventory/components/CategoryTreePicker');
type RoutePage = (args: {
  params: Promise<Record<string, string>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<React.ReactNode>;
const CategoriesPage = (await import('@/app/[locale]/(dashboard)/inventory/categories/page'))
  .default as unknown as RoutePage;

function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(messagesFor(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const RENDER = {
  en: (ui: ReactElement) => renderInLtr(withMui(inBranch(ui), 'en')),
  ar: (ui: ReactElement) => renderInRtl(withMui(inBranch(ui, { locale: 'ar' }), 'ar')),
} as const;

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const idOf = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface CategoryRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly description: string | null;
  readonly parentCategoryId: string | null;
  readonly status: 'active' | 'inactive';
  readonly recordVersion: number;
}

function category(
  n: number,
  code: string,
  name: string,
  parent: number | null,
  status: 'active' | 'inactive' = 'active'
): CategoryRow {
  return {
    id: idOf(n),
    code,
    name,
    description: null,
    parentCategoryId: parent === null ? null : idOf(parent),
    status,
    recordVersion: 1,
  };
}

const page = (items: readonly CategoryRow[], nextCursor: string | null) => ({
  status: 'ok' as const,
  data: { items, nextCursor, hasMore: nextCursor !== null },
  correlationId: 'corr',
});

/** Hands the rows out a hundred at a time, cursor `p2`, `p3`, … in code order. */
function serve(rows: readonly CategoryRow[]) {
  const sorted = [...rows].sort((a, b) => a.code.localeCompare(b.code));
  listItemCategoryPage.mockImplementation(async (cursor: string | null) => {
    const index = cursor === null ? 0 : Number(cursor.slice(1)) - 1;
    const slice = sorted.slice(index * 100, index * 100 + 100);
    const more = (index + 1) * 100 < sorted.length;
    return page(slice, more ? `p${index + 2}` : null);
  });
}

/** Two branches with a "Pads" each, an inactive root, and a lone root. */
const BRAKES = [
  category(1, 'front_brakes', 'Front brakes', null),
  category(2, 'front_pads', 'Pads', 1),
  category(3, 'rear_brakes', 'Rear brakes', null),
  category(4, 'rear_pads', 'Pads', 3),
  category(5, 'retired_tools', 'Retired tools', null, 'inactive'),
  category(6, 'tools', 'Tools', null),
];

/** Ten roots of so many children each, every root followed by its own. */
const grouped = (children: number) =>
  Array.from({ length: 10 }, (_, r) => [
    category(1000 + r, `group_${r}`, `Group ${r}`, null),
    ...Array.from({ length: children }, (_, k) =>
      category(
        2000 + r * 100 + k,
        `group_${r}_part_${String(k).padStart(2, '0')}`,
        `Part ${r}-${k}`,
        1000 + r
      )
    ),
  ]).flat();

/** Ten roots of twenty-five children each: 260 rows over three pages. */
const WIDE = grouped(25);

/**
 * Ten roots of twenty children each: 210 rows, so two full pages and a third
 * of ten — the last ten children of a root that arrived on the second page.
 *
 * It is this wide and no wider on purpose. The tree view looks every row it
 * draws up in the whole tree, so drawing a catalogue open costs the square of
 * its rows under jsdom; ten equal groups reach a third page at twenty children
 * each, and a third page of ten rows says more than a third page of one.
 */
const THREE_PAGES = grouped(20);

/**
 * The same rows, counting how often one is drawn. A row's label reads its
 * `name` once each time it is rendered, and once the tree is built nothing
 * else reads a name unless a search is typed or a row is chosen — so the count
 * moves by one for every row React renders again.
 */
function watched(rows: readonly CategoryRow[]) {
  let read = 0;
  return {
    rows: rows.map(
      (row) =>
        new Proxy(row, {
          get(target, key, receiver) {
            if (key === 'name') read += 1;
            return Reflect.get(target, key, receiver) as unknown;
          },
        })
    ),
    labelsDrawn: () => read,
  };
}

/** Seven levels, each the only child of the one above. */
const DEEP = Array.from({ length: 7 }, (_, level) =>
  category(3000 + level, `level_${level}`, `Level ${level}`, level === 0 ? null : 3000 + level - 1)
);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const node = (code: string) => {
  const found = document.querySelector<HTMLElement>(`[data-category-code="${code}"]`);
  if (!found) throw new Error(`no tree row for ${code}`);
  return found;
};
const maybeNode = (code: string) =>
  document.querySelector<HTMLElement>(`[data-category-code="${code}"]`);
/** The row's own label — the first text of its name inside it, before any child row. */
const labelOf = (code: string, name: string) =>
  within(node(code)).getAllByText(name)[0] as HTMLElement;
const rows = () => screen.queryAllByRole('treeitem');

async function openPage(
  locale: 'en' | 'ar',
  permissions: readonly string[] = ['inv.item.read'],
  query?: Record<string, string | string[] | undefined>,
  searchParams: Promise<Record<string, string | string[] | undefined>> = Promise.resolve(
    query ?? {}
  )
) {
  PERMISSIONS = permissions;
  const view = RENDER[locale](
    (await CategoriesPage({
      params: Promise.resolve({ locale }),
      searchParams,
    })) as ReactElement
  );
  return view;
}

/** No row of the tree is the chosen one. */
const nothingChosen = () =>
  rows().every(
    (row) =>
      row.getAttribute('aria-selected') !== 'true' && row.getAttribute('aria-checked') !== 'true'
  );

/** The rows the Tab key stops on — the tree view keeps exactly one. */
const tabStops = () => rows().filter((row) => row.getAttribute('tabindex') === '0');

async function treeReady() {
  await waitFor(() => expect(screen.getByRole('tree')).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  treeSelections.length = 0;
  listItems.mockResolvedValue(itemPage([]));
  serve(BRAKES);
});

/* ------------------------------------------------------------------ *
 * The page
 * ------------------------------------------------------------------ */

describe.each(['en', 'ar'] as const)('the category tree (%s)', (locale) => {
  const t = (key: string): string => {
    const said = CATALOGUES[locale][key];
    if (said === undefined) throw new Error(`no message ${key}`);
    return said;
  };
  const user = () => userEvent.setup();

  it('opens on the category the address names, every ancestor open and its items listed', async () => {
    serve(DEEP);
    await openPage(locale, ['inv.item.read'], { category: idOf(3006) });
    await treeReady();
    // No search typed: the ancestors are open because the row was named.
    expect(rows()).toHaveLength(7);
    for (let level = 0; level < 6; level += 1) {
      expect(node(`level_${level}`).getAttribute('aria-expanded')).toBe('true');
    }
    expect(node('level_6').getAttribute('aria-checked')).toBe('true');
    // The tree's one Tab stop is the chosen row, and the Tab key lands on it.
    expect(tabStops()).toEqual([node('level_6')]);
    act(() => screen.getByRole('button', { name: t('inventory.categories.collapseAll') }).focus());
    await user().tab();
    expect(document.activeElement).toBe(node('level_6'));
    const path = await screen.findByRole('navigation', {
      name: t('inventory.categories.path.label'),
    });
    expect(within(path).getAllByRole('listitem')).toHaveLength(7);
    expect(screen.queryByTestId('categories-choose')).toBeNull();
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    expect(listItems.mock.calls.at(-1)?.[0]).toEqual({ categoryId: idOf(3006) });
    // A later click changes the choice as it always did.
    await user().click(labelOf('level_2', 'Level 2'));
    await waitFor(() =>
      expect(listItems.mock.calls.at(-1)?.[0]).toEqual({ categoryId: idOf(3002) })
    );
  });

  it('takes the first value when the address names the category twice', async () => {
    serve(DEEP);
    await openPage(locale, ['inv.item.read'], { category: [idOf(3003), idOf(3006)] });
    await treeReady();
    expect(node('level_3').getAttribute('aria-checked')).toBe('true');
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    expect(listItems.mock.calls.at(-1)?.[0]).toEqual({ categoryId: idOf(3003) });
  });

  it.each([
    ['a value that is not an identifier', 'level_6'],
    ['an identifier the tree does not hold', idOf(9999)],
  ])('opens with nothing chosen for %s', async (_case, value) => {
    serve(DEEP);
    await openPage(locale, ['inv.item.read'], { category: value });
    await treeReady();
    expect(screen.getByTestId('categories-choose').textContent).toBe(
      t('inventory.categories.detail.choose')
    );
    expect(rows().length).toBeGreaterThan(0);
    expect(nothingChosen()).toBe(true);
    // The tree view is handed no choice at all — not the identifier it does
    // not hold — so its one Tab stop is the first row.
    expect(treeSelections.length).toBeGreaterThan(0);
    expect([...new Set(treeSelections)]).toEqual(['']);
    expect(tabStops()).toEqual([rows()[0]]);
    expect(listItems).not.toHaveBeenCalled();
  });

  it('refuses without the catalogue read even when the address names a category', async () => {
    // The address is a thenable whose `then` is a spy: awaiting it anywhere
    // calls `then`, so a page that read the address before its refusal fails here.
    const consumed = vi.fn((resolve: (query: Record<string, string>) => void) =>
      resolve({ category: idOf(3006) })
    );
    const searchParams = { then: consumed } as unknown as Promise<
      Record<string, string | string[] | undefined>
    >;
    await openPage(locale, [], undefined, searchParams);
    expect(screen.getByText(t('state.denied.title'))).toBeTruthy();
    expect(consumed).not.toHaveBeenCalled();
    expect(listItemCategoryPage).not.toHaveBeenCalled();
    expect(listItems).not.toHaveBeenCalled();
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('says there are no categories yet, and still says nothing here changes one', async () => {
    serve([]);
    await openPage(locale);
    const empty = await screen.findByTestId('categories-empty');
    expect(empty.textContent).toContain(t('inventory.categories.none'));
    expect(screen.queryByRole('tree')).toBeNull();
    const notice = screen.getByTestId('categories-read-only');
    expect(notice.textContent).toContain(t('inventory.categories.readOnly.body'));
    expect(notice.textContent).toContain(t('inventory.categories.everyItem'));
  });

  it('reads every cursor page of a wide catalogue and draws all of it', async () => {
    const catalogue = watched(THREE_PAGES);
    serve(catalogue.rows);
    await openPage(locale);
    await treeReady();
    expect(listItemCategoryPage.mock.calls.map((call) => call[0])).toEqual([null, 'p2', 'p3']);
    // Two full pages and a part of a third, each asked for with the cursor before it.
    const served = await Promise.all(
      listItemCategoryPage.mock.results.map((result) => result.value as ReturnType<typeof page>)
    );
    expect(served.map((answer) => answer.data.items.length)).toEqual([100, 100, 10]);
    // Ten roots drawn closed; opening everything draws all 210 rows.
    expect(rows()).toHaveLength(10);
    const closed = catalogue.labelsDrawn();
    await user().click(screen.getByRole('button', { name: t('inventory.categories.expandAll') }));
    await waitFor(() => expect(rows()).toHaveLength(210));
    // Each of the 200 children is drawn once, and no root a second time.
    expect(catalogue.labelsDrawn() - closed).toBe(200);
    // Every category of every page is on screen once, in the order the pages
    // gave them, and each sits inside the row of its own parent.
    const drawn = [...document.querySelectorAll<HTMLElement>('[data-category-code]')];
    expect(drawn.map((row) => row.dataset.categoryCode)).toEqual(
      THREE_PAGES.map((row) => row.code)
    );
    const codeOf = new Map(THREE_PAGES.map((row) => [row.id, row.code]));
    expect(
      drawn.map(
        (row) =>
          row.parentElement?.closest<HTMLElement>('[data-category-code]')?.dataset.categoryCode ??
          null
      )
    ).toEqual(
      THREE_PAGES.map((row) =>
        row.parentCategoryId === null ? null : codeOf.get(row.parentCategoryId)
      )
    );
    // A row that arrived on the THIRD page is in the tree under its parent —
    // which arrived on the second.
    expect(node('group_9').contains(node('group_9_part_19'))).toBe(true);
    expect(screen.queryByText(t('inventory.categories.truncated'))).toBeNull();
    // Closing every branch draws no row again: the rows on screen are closed
    // as they stand. Each used to be rendered again on every such click, and
    // the tree view looks a rendered row's children up in the whole tree.
    const open = catalogue.labelsDrawn();
    await user().click(screen.getByRole('button', { name: t('inventory.categories.collapseAll') }));
    await waitFor(() => expect(node('group_0').getAttribute('aria-expanded')).toBe('false'));
    expect(catalogue.labelsDrawn() - open).toBe(0);
  });

  it('stops on a repeated cursor and says the list may be incomplete', async () => {
    listItemCategoryPage.mockImplementation(async () => page([BRAKES[0] as CategoryRow], 'again'));
    await openPage(locale);
    await treeReady();
    expect(listItemCategoryPage).toHaveBeenCalledTimes(2);
    expect(screen.getByText(t('inventory.categories.truncated'))).toBeTruthy();
  });

  it('draws seven levels and opens every ancestor of a deep match with its path', async () => {
    serve(DEEP);
    await openPage(locale);
    await treeReady();
    await user().type(
      screen.getByRole('searchbox', { name: t('inventory.categories.search.label') }),
      'level_6'
    );
    await waitFor(() => expect(rows()).toHaveLength(7));
    for (let level = 0; level < 6; level += 1) {
      expect(node(`level_${level}`).getAttribute('aria-expanded')).toBe('true');
    }
    await user().click(labelOf('level_6', 'Level 6'));
    const path = await screen.findByRole('navigation', {
      name: t('inventory.categories.path.label'),
    });
    const steps = within(path).getAllByRole('listitem');
    expect(steps).toHaveLength(7);
    expect(steps.map((step) => step.textContent?.replace('/', '').trim())).toEqual(
      DEEP.map((row) => row.name)
    );
    expect(within(path).getByText('Level 6').getAttribute('aria-current')).toBe('location');
  });

  it('keeps two categories of the same name apart by their path', async () => {
    await openPage(locale);
    await treeReady();
    await user().type(
      screen.getByRole('searchbox', { name: t('inventory.categories.search.label') }),
      'pads'
    );
    // Both matches, each under its own opened parent; nothing else.
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect(node('front_brakes').getAttribute('aria-expanded')).toBe('true');
    expect(node('rear_brakes').getAttribute('aria-expanded')).toBe('true');
    expect(maybeNode('tools')).toBeNull();

    await user().click(labelOf('front_pads', 'Pads'));
    const path = () =>
      screen.getByRole('navigation', { name: t('inventory.categories.path.label') });
    await waitFor(() => expect(path().textContent).toContain('Front brakes'));
    expect(path().textContent).not.toContain('Rear brakes');

    await user().click(labelOf('rear_pads', 'Pads'));
    await waitFor(() => expect(path().textContent).toContain('Rear brakes'));
    expect(path().textContent).not.toContain('Front brakes');
    // Each row carries its unique code beside the shared name.
    expect(node('front_pads').textContent).toContain('front_pads');
    expect(node('rear_pads').textContent).toContain('rear_pads');
  });

  it('labels an inactive category, and draws one with a missing parent at the top', async () => {
    serve([...BRAKES, category(7, 'lost_child', 'Lost child', 999)]);
    await openPage(locale);
    await treeReady();
    expect(within(node('retired_tools')).getByTestId('category-inactive').textContent).toBe(
      t('inventory.setup.status.inactive')
    );
    expect(within(node('tools')).queryByTestId('category-inactive')).toBeNull();
    const lost = node('lost_child');
    expect(lost.parentElement?.getAttribute('role')).toBe('tree');
    expect(within(lost).getByTestId('category-misplaced').textContent).toBe(
      t('inventory.categories.misplaced')
    );
  });

  it('says so when a search matches nothing, and gives the tree back when cleared', async () => {
    await openPage(locale);
    await treeReady();
    const box = screen.getByRole('searchbox', { name: t('inventory.categories.search.label') });
    await user().type(box, 'zzz');
    expect(await screen.findByText(t('inventory.categories.search.none'))).toBeTruthy();
    expect(screen.queryByRole('tree')).toBeNull();
    await user().clear(box);
    await treeReady();
    expect(rows()).toHaveLength(4);
  });

  it('moves, opens, closes and chooses with the keyboard, mirrored in Arabic', async () => {
    await openPage(locale);
    await treeReady();
    const open = locale === 'ar' ? '{ArrowLeft}' : '{ArrowRight}';
    const close = locale === 'ar' ? '{ArrowRight}' : '{ArrowLeft}';
    const keys = user();
    act(() => node('front_brakes').focus());
    await keys.keyboard('{End}');
    expect(document.activeElement).toBe(node('tools'));
    await keys.keyboard('{Home}');
    expect(document.activeElement).toBe(node('front_brakes'));
    await keys.keyboard(open);
    expect(node('front_brakes').getAttribute('aria-expanded')).toBe('true');
    await keys.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(node('front_pads'));
    await keys.keyboard('{Enter}');
    expect(node('front_pads').getAttribute('aria-checked')).toBe('true');
    await waitFor(() =>
      expect(
        screen.getByRole('navigation', { name: t('inventory.categories.path.label') }).textContent
      ).toContain('Front brakes')
    );
    await keys.keyboard('{ArrowUp}');
    await keys.keyboard(close);
    expect(node('front_brakes').getAttribute('aria-expanded')).toBe('false');
    // Enter on a row with children chooses it AND opens it.
    await keys.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(node('rear_brakes'));
    await keys.keyboard('{Enter}');
    expect(node('rear_brakes').getAttribute('aria-checked')).toBe('true');
    expect(node('rear_brakes').getAttribute('aria-expanded')).toBe('true');
  });

  it('lists the items filed under the chosen category, each a link to its page', async () => {
    listItems.mockResolvedValue(itemPage([item]));
    await openPage(locale);
    await treeReady();
    await user().click(labelOf('tools', 'Tools'));
    await waitFor(() => expect(listItems).toHaveBeenCalled());
    expect(listItems.mock.calls.at(-1)?.[0]).toEqual({ categoryId: idOf(6) });
    expect(listItems.mock.calls.at(-1)?.[2]).toBeNull();
    const grid = await screen.findByTestId('categories-items-grid');
    const link = await within(grid).findByRole('link', { name: item.sku });
    expect(link.getAttribute('href')).toBe(`/${locale}/inventory/items/${item.id}`);
    expect(screen.getByText(t('inventory.categories.items.scope'))).toBeTruthy();

    await user().click(labelOf('retired_tools', 'Retired tools'));
    await waitFor(() => expect(listItems.mock.calls.at(-1)?.[0]).toEqual({ categoryId: idOf(5) }));
    expect(screen.getByTestId('categories-detail-status').textContent).toBe(
      t('inventory.setup.status.inactive')
    );
  });

  it('pages the items of the chosen category with the server cursor, keeping the category', async () => {
    const second = { ...item, id: 'c0000000-0000-4000-8000-0000000000f2', sku: 'BRK-002' };
    listItems.mockImplementation(
      async (_criteria: unknown, _request: unknown, cursor: string | null) =>
        cursor === null
          ? { ...itemPage([item]), nextCursor: 'cur-2', hasMore: true }
          : itemPage([second])
    );
    await openPage(locale);
    await treeReady();
    await user().click(labelOf('tools', 'Tools'));
    const grid = await screen.findByTestId('categories-items-grid');
    await within(grid).findByRole('link', { name: item.sku });
    const first = listItems.mock.calls.length;
    await user().click(screen.getByRole('button', { name: t('table.nextPage') }));
    await waitFor(() => expect(listItems.mock.calls.length).toBeGreaterThan(first));
    const call = listItems.mock.calls.at(-1);
    expect(call?.[0]).toEqual({ categoryId: idOf(6) });
    expect(call?.[2]).toBe('cur-2');
    expect(await within(grid).findByRole('link', { name: 'BRK-002' })).toBeTruthy();
  });

  it('says a category with no items has none', async () => {
    await openPage(locale);
    await treeReady();
    await user().click(labelOf('tools', 'Tools'));
    const empty = await screen.findByTestId('categories-items-empty');
    expect(empty.textContent).toContain(t('inventory.categories.items.none'));
  });

  it('points only a holder of the manage code at the create form', async () => {
    await openPage(locale, ['inv.item.read']);
    await treeReady();
    expect(screen.queryByTestId('categories-setup-link')).toBeNull();
  });

  it('offers the create form to a holder of the manage code, and nothing that writes here', async () => {
    await openPage(locale, ['inv.item.read', 'inv.item.manage']);
    await treeReady();
    const link = screen.getByTestId('categories-setup-link');
    expect(link.getAttribute('href')).toBe(`/${locale}/inventory/setup`);
    expect(link.textContent).toBe(t('inventory.categories.readOnly.create'));
    expect(screen.queryByRole('textbox')).toBeNull();
    const buttons = screen.getAllByRole('button').map((button) => button.textContent);
    expect(buttons).toEqual([
      t('inventory.categories.expandAll'),
      t('inventory.categories.collapseAll'),
    ]);
  });

  it('refuses without the catalogue read and reads nothing', async () => {
    await openPage(locale, []);
    expect(screen.getByText(t('state.denied.title'))).toBeTruthy();
    expect(listItemCategoryPage).not.toHaveBeenCalled();
    expect(listItems).not.toHaveBeenCalled();
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('says the list is unavailable and reads every page again on retry', async () => {
    listItemCategoryPage.mockResolvedValueOnce({ status: 'unavailable', correlationId: 'corr-9' });
    await openPage(locale);
    const failure = await screen.findByTestId('categories-failure');
    expect(failure.textContent).toContain('corr-9');
    await user().click(within(failure).getByRole('button', { name: t('state.retry') }));
    await treeReady();
    expect(listItemCategoryPage).toHaveBeenCalledTimes(2);
  });

  it('lays the page out right to left in Arabic only', async () => {
    await openPage(locale);
    await treeReady();
    expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    expect(screen.getByRole('tree').getAttribute('aria-label')).toBe(
      t('inventory.categories.tree.label')
    );
  });
});

/* ------------------------------------------------------------------ *
 * The picker
 * ------------------------------------------------------------------ */

function PickerHarness({
  locale,
  onChange,
}: {
  readonly locale: 'en' | 'ar';
  readonly onChange: (id: string) => void;
}) {
  const categories = useAllItemCategories();
  const [value, setValue] = useState('');
  return (
    <CategoryTreePicker
      messages={messagesFor(locale)}
      categories={categories}
      label="Category"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

function FieldHarness({
  locale,
  onChange,
  clearLabel,
  required,
}: {
  readonly locale: 'en' | 'ar';
  readonly onChange: (id: string) => void;
  readonly clearLabel?: string | null;
  readonly required?: boolean;
}) {
  const categories = useAllItemCategories();
  const [value, setValue] = useState('');
  return (
    <CategoryTreePicker
      messages={messagesFor(locale)}
      categories={categories}
      label="Category"
      value={value}
      clearLabel={clearLabel}
      required={required}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe.each(['en', 'ar'] as const)('the category picker (%s)', (locale) => {
  const t = (key: string): string => {
    const said = CATALOGUES[locale][key];
    if (said === undefined) throw new Error(`no message ${key}`);
    return said;
  };

  it('chooses a category from the whole tree, says its path, and clears it', async () => {
    serve([...BRAKES, ...WIDE]);
    const onChange = vi.fn();
    RENDER[locale](<PickerHarness locale={locale} onChange={onChange} />);
    const tree = await screen.findByRole('tree', { name: 'Category' });
    expect(listItemCategoryPage).toHaveBeenCalledTimes(3);
    const user = userEvent.setup();

    // A row from the last page is offered too.
    expect(within(tree).getByText('Group 9')).toBeTruthy();
    expect(
      within(tree).getByText(`Retired tools — ${t('inventory.setup.status.inactive')}`)
    ).toBeTruthy();

    await user.click(within(tree).getByText('Rear brakes'));
    expect(onChange).toHaveBeenLastCalledWith(idOf(3));
    await user.click(await within(tree).findByText('Pads'));
    expect(onChange).toHaveBeenLastCalledWith(idOf(4));
    await waitFor(() => expect(tree.getAttribute('aria-describedby')).toBeTruthy());
    const described = document.getElementById(
      (tree.getAttribute('aria-describedby') as string).split(' ')[0] as string
    );
    expect(described?.textContent).toContain('Rear brakes / Pads');

    await user.click(within(tree).getByText(t('inventory.categories.picker.none')));
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  it('says when the categories cannot be read for this account', async () => {
    listItemCategoryPage.mockResolvedValue({ status: 'denied', correlationId: 'corr' });
    RENDER[locale](<PickerHarness locale={locale} onChange={vi.fn()} />);
    expect(await screen.findByText(t('inventory.categories.picker.refused'))).toBeTruthy();
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByRole('button', { name: t('state.retry') })).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The picker, as a form field (P1-32-PRE-OD-INV2A, the INV2B review)
 * ------------------------------------------------------------------ */

describe.each(['en', 'ar'] as const)('the category picker as a form field (%s)', (locale) => {
  const t = (key: string): string => {
    const said = CATALOGUES[locale][key];
    if (said === undefined) throw new Error(`no message ${key}`);
    return said;
  };

  it('says the categories are unavailable inside a group named by its field, and a retry walks every page again', async () => {
    listItemCategoryPage.mockResolvedValueOnce({ status: 'unavailable', correlationId: 'corr-u' });
    RENDER[locale](<FieldHarness locale={locale} onChange={vi.fn()} />);
    const group = await screen.findByRole('group', { name: 'Category' });
    expect(within(group).getByText(t('inventory.categories.picker.unavailable'))).toBeTruthy();
    await userEvent.setup().click(within(group).getByRole('button', { name: t('state.retry') }));
    expect(await screen.findByRole('tree', { name: 'Category' })).toBeTruthy();
    expect(listItemCategoryPage).toHaveBeenCalledTimes(2);
    expect(listItemCategoryPage.mock.calls.map((call) => call[0])).toEqual([null, null]);
  });

  it('while reading, says so inside a group named by its field', async () => {
    listItemCategoryPage.mockReturnValue(new Promise(() => undefined));
    RENDER[locale](<FieldHarness locale={locale} onChange={vi.fn()} required />);
    const group = screen.getByRole('group', { name: 'Category' });
    expect(within(group).getByRole('status').textContent).toContain(t('state.loading'));
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('draws no "No category" row for a required field that passes clearLabel null', async () => {
    RENDER[locale](<FieldHarness locale={locale} onChange={vi.fn()} clearLabel={null} required />);
    const tree = await screen.findByRole('tree', { name: 'Category' });
    expect(within(tree).queryByText(t('inventory.categories.picker.none'))).toBeNull();
    expect(tree.getAttribute('aria-required')).toBe('true');
    // The four top-level categories, and no row before them.
    expect(within(tree).getAllByRole('treeitem')).toHaveLength(4);
  });

  it('says an empty catalogue is empty, in the description of the field', async () => {
    serve([]);
    RENDER[locale](<FieldHarness locale={locale} onChange={vi.fn()} />);
    const tree = await screen.findByRole('tree', { name: 'Category' });
    const described = (tree.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    expect(described).toContain(t('inventory.categories.none'));
  });

  /*
   * P1-32-PRE-OD-INVH — the picker drew `name (code)` on every row. The code is
   * typed when a category is created and has its own column where categories
   * are managed; in a picker it was noise after each name. A row is the name.
   */
  it('names each category and draws no code: two of one name under different parents read alike, apart by place', async () => {
    serve(BRAKES);
    RENDER[locale](<PickerHarness locale={locale} onChange={vi.fn()} />);
    const tree = await screen.findByRole('tree', { name: 'Category' });
    const user = userEvent.setup();
    await user.click(within(tree).getByText('Front brakes'));
    await user.click(within(tree).getByText('Rear brakes'));
    await waitFor(() => expect(within(tree).getAllByText('Pads')).toHaveLength(2));
    const text = tree.textContent ?? '';
    // (`tools` is also a word of the name "Retired tools": the codes that are
    // not a word of any name are looked for as they are, the rest in brackets.)
    for (const row of BRAKES) {
      expect(text, row.code).not.toContain(row.code.includes('_') ? row.code : `(${row.code})`);
    }
    expect(text).not.toMatch(/\([a-z][a-z0-9_]*\)/);
    // An inactive category still says so, after its name.
    expect(
      within(tree).getByText(`Retired tools — ${t('inventory.setup.status.inactive')}`)
    ).toBeTruthy();
    // And each "Pads" sits under its own parent.
    const parents = within(tree)
      .getAllByText('Pads')
      .map((row) => row.closest('[role="group"]')?.closest('[role="treeitem"]')?.textContent ?? '');
    expect(parents[0]).toContain('Front brakes');
    expect(parents[1]).toContain('Rear brakes');
  });

  it('adds the code only where two categories of one name share a parent', async () => {
    serve([
      category(1, 'front_brakes', 'Front brakes', null),
      category(2, 'pads_oem', 'Pads', 1),
      category(3, 'pads_aftermarket', 'Pads', 1),
      category(4, 'discs', 'Discs', 1),
      category(5, 'tools', 'Tools', null),
      category(6, 'tools_old', 'Tools', null, 'inactive'),
    ]);
    RENDER[locale](<PickerHarness locale={locale} onChange={vi.fn()} />);
    const tree = await screen.findByRole('tree', { name: 'Category' });
    const user = userEvent.setup();
    await user.click(within(tree).getByText('Front brakes'));
    // Nothing else on the row tells the two apart, so their codes do.
    expect(await within(tree).findByText('Pads (pads_oem)')).toBeTruthy();
    expect(within(tree).getByText('Pads (pads_aftermarket)')).toBeTruthy();
    expect(within(tree).getByText('Tools (tools)')).toBeTruthy();
    expect(
      within(tree).getByText(`Tools (tools_old) — ${t('inventory.setup.status.inactive')}`)
    ).toBeTruthy();
    // A name that is alone under its parent has none.
    expect(within(tree).getByText('Discs')).toBeTruthy();
    expect(within(tree).getByText('Front brakes')).toBeTruthy();
    expect(tree.textContent).not.toContain('front_brakes');
    expect(tree.textContent).not.toContain('(discs)');
  });

  /*
   * "The same name" is what an operator would read as the same. Names that
   * differ only in case, in spaces, or in tatweel and Arabic vowel marks cannot
   * be told apart on a row, so they get their codes too. The comparison alone is
   * folded: each name is drawn exactly as it is stored.
   */
  it('counts names an operator cannot tell apart as the same, and draws each as stored', async () => {
    serve([
      category(1, 'root', 'Parts', null),
      // Latin: a trailing space, upper case, a doubled inner space.
      category(2, 'pads_a', 'Brake pads', 1),
      category(3, 'pads_b', 'Brake pads ', 1),
      category(4, 'pads_c', 'BRAKE PADS', 1),
      category(5, 'pads_d', 'Brake  pads', 1),
      // Arabic: plain, with tatweel, with vowel marks.
      category(6, 'filters_a', 'فلاتر', 1),
      category(7, 'filters_b', 'فلاتـر', 1),
      category(8, 'filters_c', 'فَلاتِر', 1),
      // Really different names keep to themselves.
      category(9, 'discs', 'Brake discs', 1),
      category(10, 'oils', 'زيوت', 1),
    ]);
    RENDER[locale](<PickerHarness locale={locale} onChange={vi.fn()} />);
    const tree = await screen.findByRole('tree', { name: 'Category' });
    const user = userEvent.setup();
    await user.click(within(tree).getByText('Parts'));
    await within(tree).findByText('Brake discs');
    const labels = within(tree)
      .getAllByRole('treeitem')
      .map((row) => row.querySelector('.MuiTreeItem-label')?.textContent ?? '');
    expect(labels).toEqual(
      expect.arrayContaining([
        'Brake pads (pads_a)',
        'Brake pads  (pads_b)',
        'BRAKE PADS (pads_c)',
        'Brake  pads (pads_d)',
        'فلاتر (filters_a)',
        'فلاتـر (filters_b)',
        'فَلاتِر (filters_c)',
        'Brake discs',
        'زيوت',
      ])
    );
    expect(tree.textContent).not.toContain('(discs)');
    expect(tree.textContent).not.toContain('(oils)');
    expect(tree.textContent).not.toContain('(root)');
  });

  it('chooses with the keyboard: Down and Enter open a parent and choose a leaf, Space chooses', async () => {
    const onChange = vi.fn();
    RENDER[locale](<FieldHarness locale={locale} onChange={onChange} />);
    const tree = await screen.findByRole('tree', { name: 'Category' });
    const keys = userEvent.setup();
    const none = within(tree).getAllByRole('treeitem')[0] as HTMLElement;
    act(() => none.focus());
    await keys.keyboard('{ArrowDown}');
    // Enter on a row with children opens it rather than choosing it.
    await keys.keyboard('{Enter}');
    await within(tree).findByText('Pads');
    await keys.keyboard('{ArrowDown}');
    await keys.keyboard('{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(idOf(2));
    await keys.keyboard('{ArrowDown}');
    await keys.keyboard(' ');
    expect(onChange).toHaveBeenLastCalledWith(idOf(3));
  });
});

/* ------------------------------------------------------------------ *
 * category-tree.ts, pure
 * ------------------------------------------------------------------ */

describe('category-tree.ts', () => {
  it('stops after the page budget and says the list was cut short', async () => {
    let served = 0;
    const reader = vi.fn(async () => {
      served += 1;
      return page([category(served, `c_${served}`, `C ${served}`, null)], `p${served + 1}`);
    });
    const result = await readAllCategories(reader);
    expect(reader).toHaveBeenCalledTimes(CATEGORY_PAGE_BUDGET);
    expect(result).toMatchObject({ status: 'ok', truncated: true, pages: CATEGORY_PAGE_BUDGET });
    expect(result !== null && result.status === 'ok' ? result.items.length : -1).toBe(
      CATEGORY_PAGE_BUDGET
    );
  });

  it('draws an A -> B -> A cycle with exactly one misplaced member, and a search ends', () => {
    const forest = buildCategoryForest([category(1, 'a', 'A', 2), category(2, 'b', 'B', 1)]);
    expect([...forest.misplaced]).toEqual([idOf(1)]);
    expect(pathOf(forest, idOf(2)).map((row) => row.name)).toEqual(['A', 'B']);
    expect(pathOf(forest, idOf(1)).map((row) => row.name)).toEqual(['A']);
    const found = searchCategories(forest, 'b', 'en');
    expect([...found.matches]).toEqual([idOf(2)]);
    expect([...found.visible].sort()).toEqual([idOf(1), idOf(2)].sort());
    const wide = searchCategories(forest, '', 'en');
    expect(wide.visible.size).toBe(2);
  });
});
