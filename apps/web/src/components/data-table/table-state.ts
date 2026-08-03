/**
 * The data table's request and response contracts, and the rules for what may
 * appear in a URL.
 *
 * ## Server-driven, and the word means something
 *
 * `page`, `sort`, `filters` and `search` are REQUEST parameters sent to the
 * backend. Nothing in this module sorts, filters or paginates an array. A table
 * that sorts the current page client-side while calling itself server-driven is
 * worse than one that admits to being client-side: it looks correct until the
 * data outgrows one page, and then it silently sorts a window instead of a set.
 *
 * ## URL-state safety
 *
 * Table state belongs in the URL — a shared link, a bookmark and the back button
 * are all worth having. But a URL is written to browser history, to server
 * access logs, to proxy logs, and to the `Referer` header of every outbound
 * request from the page. So a URL may carry WHICH filter is applied, never the
 * VALUE an operator typed.
 *
 * The rule enforced below: a filter is a registered key plus a value drawn from
 * a declared option set. Free text — a customer name, a phone number, a VIN, a
 * plate, a note — is never serialised. `search` is deliberately part of that
 * prohibition: it is the single most likely place for a customer's name to end
 * up in a proxy log.
 */

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  readonly columnId: string;
  readonly direction: SortDirection;
}

/** A filter the operator has applied: a registered key and a declared option. */
export interface FilterState {
  readonly key: string;
  readonly value: string;
}

export interface TableRequest {
  readonly page: number;
  readonly pageSize: number;
  /** `null` means "the server's natural order", not "unsorted client-side". */
  readonly sort: SortState | null;
  readonly filters: readonly FilterState[];
  /** Held in memory only. Never serialised — see the module note. */
  readonly search: string;
}

/**
 * A page of rows as the server returned it.
 *
 * ## `total` is nullable, and that is the honest shape
 *
 * The backend paginates by CURSOR: `shared` list operations return
 * `{ items, nextCursor, hasMore }` and publish **no count at all**
 * (`apps/api/src/server/db/pagination.ts`). Counting a large filtered set on
 * every page is exactly the query that falls over first, so the absence is a
 * decision, not an omission.
 *
 * `total: null` means *the server does not publish a count*. The table then
 * shows the current page with Previous and Next, and hides First, Last and the
 * "showing x–y of z" range — because the last page of a cursor-paginated set is
 * not knowable without walking it.
 *
 * The alternative was to invent a total: the current page's length, or a guess.
 * That produces a pager which is correct on page one and lies from page two
 * onward, and the lie is invisible in review because the type is satisfied.
 */
export interface TableResponse<Row> {
  readonly rows: readonly Row[];
  /** `null` when the server publishes no count — see the note above. */
  readonly total: number | null;
  readonly page: number;
  readonly pageSize: number;
  /** The server's own end-of-set signal. Required whenever `total` is null. */
  readonly hasMore?: boolean;
}

export const PAGE_SIZES = Object.freeze([10, 25, 50, 100]);
export const DEFAULT_PAGE_SIZE = 25;

export const INITIAL_REQUEST: TableRequest = Object.freeze({
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  sort: null,
  filters: Object.freeze([]),
  search: '',
});

/** A filter the table is allowed to apply, and the only values it may take. */
export interface FilterDefinition {
  readonly key: string;
  readonly labelKey: string;
  readonly options: readonly { readonly value: string; readonly labelKey: string }[];
}

/**
 * Keys that must never be serialised, whatever a caller registers.
 *
 * A defence in depth: the option-set rule below already excludes free text, but
 * a future filter registered with a wide option set — `customerName` with every
 * customer as an "option" — would slip through it. These names are refused
 * outright.
 */
export const FORBIDDEN_URL_KEYS = Object.freeze([
  'search',
  'q',
  'query',
  'name',
  'customer',
  'customername',
  'phone',
  'mobile',
  'email',
  'vin',
  'chassis',
  'plate',
  'registration',
  'note',
  'notes',
  'comment',
  'amount',
  'total',
  'price',
  'balance',
  'token',
  'session',
  'sessionid',
  'jwt',
  'authorization',
]);

export function isForbiddenUrlKey(key: string): boolean {
  return FORBIDDEN_URL_KEYS.includes(key.toLowerCase().replace(/[^a-z]/g, ''));
}

/**
 * Serialises the parts of the request that are safe to publish.
 *
 * Returns URLSearchParams containing page, pageSize, sort and registered
 * filters whose values are declared options. Everything else is dropped
 * silently by design — a caller that passes an unsafe value gets a safe URL,
 * not an exception that a `catch` somewhere turns back into an unsafe URL.
 */
export function toSearchParams(
  request: TableRequest,
  definitions: readonly FilterDefinition[]
): URLSearchParams {
  const params = new URLSearchParams();
  if (request.page > 1) params.set('page', String(request.page));
  if (request.pageSize !== DEFAULT_PAGE_SIZE) params.set('pageSize', String(request.pageSize));
  if (request.sort) params.set('sort', `${request.sort.columnId}:${request.sort.direction}`);

  for (const filter of request.filters) {
    if (isForbiddenUrlKey(filter.key)) continue;
    const definition = definitions.find((candidate) => candidate.key === filter.key);
    if (!definition) continue;
    // The value must be one the definition declares. This is what keeps an
    // operator's typed text out of the address bar even if a filter control is
    // later changed from a select into a text box.
    if (!definition.options.some((option) => option.value === filter.value)) continue;
    params.append(filter.key, filter.value);
  }
  return params;
}

/** Rebuilds a request from a URL, discarding anything it does not recognise. */
export function fromSearchParams(
  params: URLSearchParams,
  definitions: readonly FilterDefinition[]
): TableRequest {
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
  const rawSize = Number.parseInt(params.get('pageSize') ?? '', 10);
  const pageSize = PAGE_SIZES.includes(rawSize) ? rawSize : DEFAULT_PAGE_SIZE;

  let sort: SortState | null = null;
  const rawSort = params.get('sort');
  if (rawSort) {
    const [columnId, direction] = rawSort.split(':');
    if (columnId && (direction === 'asc' || direction === 'desc')) sort = { columnId, direction };
  }

  const filters: FilterState[] = [];
  for (const definition of definitions) {
    for (const value of params.getAll(definition.key)) {
      if (definition.options.some((option) => option.value === value)) {
        filters.push({ key: definition.key, value });
      }
    }
  }

  // `search` is never read back from the URL, because it is never written to it.
  return { page, pageSize, sort, filters, search: '' };
}

// --- transitions -------------------------------------------------------------
//
// Every one of these returns a NEW request. Sorting or filtering resets to page
// one, because staying on page seven of a result set that just changed shape
// shows the operator an arbitrary window of different data.

export function withPage(request: TableRequest, page: number): TableRequest {
  return { ...request, page: Math.max(1, page) };
}

export function withPageSize(request: TableRequest, pageSize: number): TableRequest {
  const size = PAGE_SIZES.includes(pageSize) ? pageSize : DEFAULT_PAGE_SIZE;
  return { ...request, pageSize: size, page: 1 };
}

/** Cycles a column: unsorted → ascending → descending → unsorted. */
export function withToggledSort(request: TableRequest, columnId: string): TableRequest {
  const current = request.sort;
  if (!current || current.columnId !== columnId) {
    return { ...request, sort: { columnId, direction: 'asc' }, page: 1 };
  }
  if (current.direction === 'asc') {
    return { ...request, sort: { columnId, direction: 'desc' }, page: 1 };
  }
  return { ...request, sort: null, page: 1 };
}

export function withFilter(request: TableRequest, filter: FilterState): TableRequest {
  const without = request.filters.filter(
    (candidate) => !(candidate.key === filter.key && candidate.value === filter.value)
  );
  return { ...request, filters: [...without, filter], page: 1 };
}

export function withoutFilter(request: TableRequest, filter: FilterState): TableRequest {
  return {
    ...request,
    filters: request.filters.filter(
      (candidate) => !(candidate.key === filter.key && candidate.value === filter.value)
    ),
    page: 1,
  };
}

export function withoutAllFilters(request: TableRequest): TableRequest {
  return { ...request, filters: [], search: '', page: 1 };
}

export function withSearch(request: TableRequest, search: string): TableRequest {
  return { ...request, search, page: 1 };
}

/**
 * How many pages a counted set has.
 *
 * Returns `null` for an uncounted (cursor-paginated) set rather than a plausible
 * number. A caller that renders `page / pages` has to handle the null, which is
 * the point: there is no honest denominator to print.
 */
export function pageCount(total: number | null, pageSize: number): number | null {
  if (total === null) return null;
  return total === 0 ? 1 : Math.ceil(total / pageSize);
}

/** Whether any narrowing is applied — decides "empty" versus "no results". */
export function isNarrowed(request: TableRequest): boolean {
  return request.filters.length > 0 || request.search.trim().length > 0;
}
