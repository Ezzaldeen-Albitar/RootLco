import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState, type ReactElement } from 'react';
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

const { useAllItemCategories } = await import('@/features/inventory/components/CategoryTree');
const { CategoryTreePicker } = await import('@/features/inventory/components/CategoryTreePicker');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
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

/** Ten roots of twenty-five children each: 260 rows over three pages. */
const WIDE = Array.from({ length: 10 }, (_, r) => [
  category(1000 + r, `group_${r}`, `Group ${r}`, null),
  ...Array.from({ length: 25 }, (_, k) =>
    category(
      2000 + r * 100 + k,
      `group_${r}_part_${String(k).padStart(2, '0')}`,
      `Part ${r}-${k}`,
      1000 + r
    )
  ),
]).flat();

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

async function openPage(locale: 'en' | 'ar', permissions: readonly string[] = ['inv.item.read']) {
  PERMISSIONS = permissions;
  const view = RENDER[locale](
    (await CategoriesPage({ params: Promise.resolve({ locale }) })) as ReactElement
  );
  return view;
}

async function treeReady() {
  await waitFor(() => expect(screen.getByRole('tree')).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
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
    serve(WIDE);
    await openPage(locale);
    await treeReady();
    expect(listItemCategoryPage.mock.calls.map((call) => call[0])).toEqual([null, 'p2', 'p3']);
    // Ten roots drawn closed; opening everything draws all 260 rows.
    expect(rows()).toHaveLength(10);
    await user().click(screen.getByRole('button', { name: t('inventory.categories.expandAll') }));
    await waitFor(() => expect(rows()).toHaveLength(260));
    // A row that arrived on the THIRD page is in the tree under its parent.
    expect(node('group_9').contains(node('group_9_part_24'))).toBe(true);
    expect(screen.queryByText(t('inventory.categories.truncated'))).toBeNull();
    await user().click(screen.getByRole('button', { name: t('inventory.categories.collapseAll') }));
    await waitFor(() => expect(node('group_0').getAttribute('aria-expanded')).toBe('false'));
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
    expect(within(tree).getByText('Group 9 (group_9)')).toBeTruthy();
    expect(
      within(tree).getByText(
        `Retired tools (retired_tools) — ${t('inventory.setup.status.inactive')}`
      )
    ).toBeTruthy();

    await user.click(within(tree).getByText('Rear brakes (rear_brakes)'));
    expect(onChange).toHaveBeenLastCalledWith(idOf(3));
    await user.click(await within(tree).findByText('Pads (rear_pads)'));
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
