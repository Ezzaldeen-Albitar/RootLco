import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  FORBIDDEN_URL_KEYS,
  INITIAL_REQUEST,
  PAGE_SIZES,
  fromSearchParams,
  isForbiddenUrlKey,
  isNarrowed,
  pageCount,
  toSearchParams,
  withFilter,
  withPage,
  withPageSize,
  withSearch,
  withToggledSort,
  withoutAllFilters,
  withoutFilter,
  type FilterDefinition,
  type TableRequest,
} from '../src/components/data-table/table-state';

const DEFINITIONS: readonly FilterDefinition[] = [
  {
    key: 'status',
    labelKey: 'table.filters',
    options: [
      { value: 'open', labelKey: 'table.filters' },
      { value: 'closed', labelKey: 'table.filters' },
    ],
  },
  {
    key: 'branch',
    labelKey: 'table.filters',
    options: [{ value: 'b1', labelKey: 'table.filters' }],
  },
];

describe('paging', () => {
  it('never goes below page one', () => {
    expect(withPage(INITIAL_REQUEST, 0).page).toBe(1);
    expect(withPage(INITIAL_REQUEST, -5).page).toBe(1);
  });

  it('returns to page one when the page size changes', () => {
    // Page seven of 25-row pages is a different window at 100 rows a page.
    const onPageSeven = withPage(INITIAL_REQUEST, 7);
    expect(withPageSize(onPageSeven, 100)).toMatchObject({ page: 1, pageSize: 100 });
  });

  it('refuses a page size it does not offer', () => {
    expect(withPageSize(INITIAL_REQUEST, 999).pageSize).toBe(DEFAULT_PAGE_SIZE);
    for (const size of PAGE_SIZES) expect(withPageSize(INITIAL_REQUEST, size).pageSize).toBe(size);
  });

  it('reports at least one page even for an empty result', () => {
    // Zero pages would render "1 / 0", which reads as a bug to an operator.
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(1, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
  });
});

describe('sorting', () => {
  it('cycles unsorted, ascending, descending, unsorted', () => {
    let request: TableRequest = INITIAL_REQUEST;
    request = withToggledSort(request, 'name');
    expect(request.sort).toEqual({ columnId: 'name', direction: 'asc' });
    request = withToggledSort(request, 'name');
    expect(request.sort).toEqual({ columnId: 'name', direction: 'desc' });
    request = withToggledSort(request, 'name');
    expect(request.sort, 'the third press must REMOVE the sort').toBeNull();
  });

  it('starts a different column ascending rather than inheriting a direction', () => {
    const sorted = withToggledSort(withToggledSort(INITIAL_REQUEST, 'name'), 'name');
    expect(sorted.sort?.direction).toBe('desc');
    expect(withToggledSort(sorted, 'created').sort).toEqual({
      columnId: 'created',
      direction: 'asc',
    });
  });

  it('returns to page one when the sort changes', () => {
    expect(withToggledSort(withPage(INITIAL_REQUEST, 4), 'name').page).toBe(1);
  });
});

describe('filters', () => {
  const status = { key: 'status', value: 'open' };

  it('applies, removes and clears', () => {
    const applied = withFilter(INITIAL_REQUEST, status);
    expect(applied.filters).toEqual([status]);
    expect(withoutFilter(applied, status).filters).toEqual([]);
    const many = withFilter(withFilter(INITIAL_REQUEST, status), { key: 'branch', value: 'b1' });
    expect(withoutAllFilters(many).filters).toEqual([]);
  });

  it('does not apply the same filter twice', () => {
    expect(withFilter(withFilter(INITIAL_REQUEST, status), status).filters).toHaveLength(1);
  });

  it('clears the search when clearing all filters', () => {
    const narrowed = withSearch(withFilter(INITIAL_REQUEST, status), 'anything');
    expect(withoutAllFilters(narrowed).search).toBe('');
  });

  it('distinguishes "nothing exists" from "your filters excluded everything"', () => {
    expect(isNarrowed(INITIAL_REQUEST)).toBe(false);
    expect(isNarrowed(withFilter(INITIAL_REQUEST, status))).toBe(true);
    expect(isNarrowed(withSearch(INITIAL_REQUEST, 'abc'))).toBe(true);
    expect(isNarrowed(withSearch(INITIAL_REQUEST, '   ')), 'whitespace is not a search').toBe(
      false
    );
  });
});

describe('URL state is safe to publish', () => {
  it('serialises page, size and sort', () => {
    const request = withToggledSort(withPageSize(withPage(INITIAL_REQUEST, 3), 50), 'name');
    const params = toSearchParams({ ...request, page: 3 }, DEFINITIONS);
    expect(params.get('page')).toBe('3');
    expect(params.get('pageSize')).toBe('50');
    expect(params.get('sort')).toBe('name:asc');
  });

  it('omits defaults, so a plain view has a plain URL', () => {
    expect(toSearchParams(INITIAL_REQUEST, DEFINITIONS).toString()).toBe('');
  });

  it('NEVER serialises the search term', () => {
    // The single most likely place for a customer's name to reach a proxy log.
    const request = withSearch(INITIAL_REQUEST, 'Mohammed Al-Rashid 0791234567');
    const serialised = toSearchParams(request, DEFINITIONS).toString();
    expect(serialised).toBe('');
    expect(serialised).not.toContain('Mohammed');
    expect(serialised).not.toContain('0791234567');
  });

  it('drops a filter whose key is not registered', () => {
    const request = withFilter(INITIAL_REQUEST, { key: 'customerName', value: 'Layla' });
    expect(toSearchParams(request, DEFINITIONS).toString()).toBe('');
  });

  it('drops a filter value the definition does not declare', () => {
    // The property that survives a select being changed into a text box later.
    const request = withFilter(INITIAL_REQUEST, { key: 'status', value: 'Layla Haddad' });
    expect(toSearchParams(request, DEFINITIONS).toString()).toBe('');
  });

  it('keeps a registered key with a declared value', () => {
    const request = withFilter(INITIAL_REQUEST, { key: 'status', value: 'open' });
    expect(toSearchParams(request, DEFINITIONS).get('status')).toBe('open');
  });

  it('refuses a sensitive key even if someone registers it', () => {
    // Defence in depth: a filter registered with a very wide option set would
    // otherwise pass the declared-value rule.
    const wide: FilterDefinition[] = [
      { key: 'vin', labelKey: 'x', options: [{ value: 'JTDBR32E', labelKey: 'x' }] },
    ];
    const request = withFilter(INITIAL_REQUEST, { key: 'vin', value: 'JTDBR32E' });
    expect(toSearchParams(request, wide).toString()).toBe('');
  });

  it('names every sensitive key it refuses', () => {
    for (const key of ['search', 'phone', 'email', 'vin', 'plate', 'amount', 'sessionId', 'jwt']) {
      expect(isForbiddenUrlKey(key), key).toBe(true);
    }
    for (const key of ['status', 'branch', 'page', 'sort']) {
      expect(isForbiddenUrlKey(key), key).toBe(false);
    }
    expect(FORBIDDEN_URL_KEYS.length).toBeGreaterThan(15);
  });

  it('normalises before matching, so `customer_name` is caught too', () => {
    expect(isForbiddenUrlKey('customer_name')).toBe(true);
    expect(isForbiddenUrlKey('Customer-Name')).toBe(true);
    expect(isForbiddenUrlKey('SESSION_ID')).toBe(true);
  });
});

describe('reading state back from a URL', () => {
  it('round-trips what it serialised', () => {
    // Filter FIRST, then page — applying a filter deliberately resets to page
    // one, so the other order would silently test page 1 and pass for the wrong
    // reason.
    const request = withPage(withFilter(INITIAL_REQUEST, { key: 'status', value: 'closed' }), 2);
    const restored = fromSearchParams(toSearchParams(request, DEFINITIONS), DEFINITIONS);
    expect(restored.page).toBe(2);
    expect(restored.filters).toEqual([{ key: 'status', value: 'closed' }]);
  });

  it('never restores a search term, because none was ever written', () => {
    const params = new URLSearchParams('search=Layla&q=Layla');
    expect(fromSearchParams(params, DEFINITIONS).search).toBe('');
  });

  it('discards an undeclared filter value supplied by hand', () => {
    // A hand-edited URL is untrusted input like any other.
    const params = new URLSearchParams('status=<script>alert(1)</script>');
    expect(fromSearchParams(params, DEFINITIONS).filters).toEqual([]);
  });

  it('falls back to safe values for nonsense', () => {
    const params = new URLSearchParams('page=-4&pageSize=9999&sort=name:sideways');
    const restored = fromSearchParams(params, DEFINITIONS);
    expect(restored.page).toBe(1);
    expect(restored.pageSize).toBe(DEFAULT_PAGE_SIZE);
    expect(restored.sort).toBeNull();
  });

  it('ignores a filter key it does not know', () => {
    const params = new URLSearchParams('unknownKey=whatever');
    expect(fromSearchParams(params, DEFINITIONS).filters).toEqual([]);
  });
});
