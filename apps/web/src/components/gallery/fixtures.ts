/**
 * Gallery fixtures.
 *
 * Fixed, invented, obviously-not-real values. No customer, vehicle, invoice or
 * operator that exists anywhere appears here, and nothing on this page is
 * fetched — the gallery must render identically on a machine with no database,
 * no API and no network, because that is what makes it usable as a visual
 * regression surface.
 *
 * The reference strings are deliberately shaped like the real ones (a prefix and
 * a padded sequence) without being any real record's identifier, so column
 * widths and RTL behaviour are representative.
 */

export interface FixtureRow {
  readonly id: string;
  readonly reference: string;
  readonly descriptionKey: string;
  readonly status: 'open' | 'closed' | 'pending';
  readonly updated: string;
  readonly amount: string;
}

/** Deterministic: the same rows in the same order on every render. */
export const FIXTURE_ROWS: readonly FixtureRow[] = Object.freeze([
  {
    id: 'f-1',
    reference: 'DOC-000101',
    descriptionKey: 'fixture.rowA',
    status: 'open',
    updated: '2026-03-02T09:15:00.000Z',
    amount: '1250.0000',
  },
  {
    id: 'f-2',
    reference: 'DOC-000102',
    descriptionKey: 'fixture.rowB',
    status: 'pending',
    updated: '2026-03-02T11:40:00.000Z',
    amount: '84.5000',
  },
  {
    id: 'f-3',
    reference: 'DOC-000103',
    descriptionKey: 'fixture.rowC',
    status: 'closed',
    updated: '2026-03-03T08:05:00.000Z',
    amount: '19999.9900',
  },
  {
    id: 'f-4',
    reference: 'DOC-000104',
    descriptionKey: 'fixture.rowD',
    status: 'open',
    updated: '2026-03-03T14:20:00.000Z',
    amount: '0.0000',
  },
  {
    id: 'f-5',
    reference: 'DOC-000105',
    descriptionKey: 'fixture.rowE',
    status: 'closed',
    updated: '2026-03-04T07:55:00.000Z',
    amount: '340.7500',
  },
]);

export const FIXTURE_CURRENCY = 'JOD';

export const FIXTURE_FILTER_DEFINITIONS = Object.freeze([
  {
    key: 'status',
    labelKey: 'column.status',
    options: Object.freeze([
      { value: 'open', labelKey: 'fixture.statusOpen' },
      { value: 'pending', labelKey: 'fixture.statusPending' },
      { value: 'closed', labelKey: 'fixture.statusClosed' },
    ]),
  },
]);

export const FIXTURE_STATUS_KEY = {
  open: 'fixture.statusOpen',
  pending: 'fixture.statusPending',
  closed: 'fixture.statusClosed',
} as const;

/**
 * Applies the request to the fixtures.
 *
 * This is the GALLERY's stand-in for a server, and it is named so nobody
 * mistakes it for the table sorting its own data: the table receives a
 * `TableResponse` exactly as it would from an API call. The real screens in
 * P1-26 replace this function with a request; the table does not change.
 */
export function simulateServer(
  rows: readonly FixtureRow[],
  request: {
    page: number;
    pageSize: number;
    sort: { columnId: string; direction: 'asc' | 'desc' } | null;
    filters: readonly { key: string; value: string }[];
    search: string;
  }
): { rows: readonly FixtureRow[]; total: number; page: number; pageSize: number } {
  let working = [...rows];

  for (const filter of request.filters) {
    if (filter.key === 'status') working = working.filter((row) => row.status === filter.value);
  }

  const search = request.search.trim().toLowerCase();
  if (search) working = working.filter((row) => row.reference.toLowerCase().includes(search));

  if (request.sort) {
    const { columnId, direction } = request.sort;
    working.sort((a, b) => {
      const left = String(a[columnId as keyof FixtureRow] ?? '');
      const right = String(b[columnId as keyof FixtureRow] ?? '');
      const comparison = left.localeCompare(right);
      return direction === 'asc' ? comparison : -comparison;
    });
  }

  const total = working.length;
  const start = (request.page - 1) * request.pageSize;
  return {
    rows: working.slice(start, start + request.pageSize),
    total,
    page: request.page,
    pageSize: request.pageSize,
  };
}
