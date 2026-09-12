import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The report ADAPTERS (P1-31, FE-011 … FE-014).
 *
 * The rendering tests replace this module wholesale and the backend proof calls
 * the routes directly, so neither says what request an adapter builds. That is
 * asserted here, with only the transport replaced.
 *
 * The properties this file protects: each read reaches the operation the screen
 * claims it does; the company and branch travel as the run's authorization
 * TARGET and never as a scope the browser asserted; the half-open period is
 * passed through exactly as it was typed, with no day added, no offset applied
 * and no default supplied; no request may ask for more rows than the route's own
 * schema accepts; an empty period is refused before a request is spent; a branch
 * the caller's own directory does not list is refused without the run being
 * attempted; and every refusal arrives as a refusal rather than as an empty
 * report — which an operator reads as "there was no work in that period".
 *
 * It also pins that this feature has NO write adapter. Reports are read. An
 * operation that authored or exported one would be a different surface with a
 * different authority, and neither exists here.
 */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const adapters = await import('@/features/reports/reports-api');
const { listReportCatalogue, readReport, readReportScopes, runReport } = adapters;
const contract = await import('@/features/reports/reports-contract');
const { MAX_REPORT_PAGE_SIZE, REPORT_PAGE_SIZE, reportPageSize } = contract;

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_BRANCH_ID = '33333333-3333-4333-8333-333333333333';
const CURSOR = 'cmVwb3J0LWN1cnNvcg';
const CODE = 'work_orders_by_status';

const ok = (data: unknown) => ({ ok: true as const, data, correlationId: 'corr-1' });
const failure = (kind: string) => ({ ok: false as const, kind, correlationId: 'corr-9' });

const DIRECTORY = {
  '/api/v1/org/companies': { items: [{ id: COMPANY_ID, legalName: 'Workshop company' }] },
  '/api/v1/org/branches': {
    items: [{ id: BRANCH_ID, companyId: COMPANY_ID, name: 'Service branch' }],
  },
} as const;

const RUN = {
  reportCode: CODE,
  titleKey: 'reports.work_orders_by_status.title',
  scope: 'branch',
  period: { from: '2026-09-01', to: '2026-09-08', timezone: 'Asia/Amman' },
  generatedAt: '2026-09-12T09:00:00.000Z',
  freshness: 'live',
  columns: [],
  countsByState: [],
  rows: { items: [], nextCursor: null, hasMore: false },
};

/** Answers the two directory reads, and hands everything else to the caller. */
function transport(answer: (path: string) => unknown) {
  get.mockImplementation(async (path: string) => {
    const directory = (DIRECTORY as Record<string, unknown>)[path];
    if (directory !== undefined) return ok(directory);
    return answer(path);
  });
}

/** The paths the transport was asked for, in order. */
const requested = () => get.mock.calls.map((call) => String(call[0]));

/** The one path that is not a directory read. */
const requestedRun = () =>
  requested().find((path) => !(path in (DIRECTORY as Record<string, unknown>))) ?? null;

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
});

describe('each read reaches the operation the screen claims it does', () => {
  it('lists the catalogue at the reports path, sending a bounded page size', async () => {
    transport(() => ok({ items: [], nextCursor: null, hasMore: false }));
    const state = await listReportCatalogue({ cursor: null, limit: REPORT_PAGE_SIZE });
    expect(state.status).toBe('ok');
    expect(requested()).toEqual([`/api/v1/reports?limit=${String(REPORT_PAGE_SIZE)}`]);
  });

  it('sends a catalogue cursor when it was given one, and omits it when it was not', async () => {
    transport(() => ok({ items: [], nextCursor: null, hasMore: false }));
    await listReportCatalogue({ cursor: CURSOR, limit: REPORT_PAGE_SIZE });
    expect(requested()[0]).toContain(`cursor=${CURSOR}`);
    get.mockClear();
    await listReportCatalogue({ cursor: null, limit: REPORT_PAGE_SIZE });
    expect(requested()[0]).not.toContain('cursor=');
  });

  it('reads one definition by code, encoded into the path', async () => {
    transport(() => ok({ reportCode: CODE }));
    await readReport(CODE);
    expect(requested()).toEqual([`/api/v1/reports/${CODE}`]);
  });

  it('encodes a code rather than interpolating it into the path raw', async () => {
    transport(() => ok({ reportCode: 'x' }));
    await readReport('a/b c');
    expect(requested()[0]).toBe('/api/v1/reports/a%2Fb%20c');
  });

  it('runs a report under the rows path of that code', async () => {
    transport(() => ok(RUN));
    const state = await runReport({
      reportCode: CODE,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from: '2026-09-01',
      to: '2026-09-08',
      cursor: null,
      limit: REPORT_PAGE_SIZE,
    });
    expect(state.status).toBe('ok');
    expect(requestedRun()).toContain(`/api/v1/reports/${CODE}/rows?`);
  });

  it('reads both organization directories for the named scope choices', async () => {
    transport(() => ok({ items: [] }));
    const state = await readReportScopes();
    expect(state.status).toBe('ok');
    expect(requested()).toEqual(['/api/v1/org/companies', '/api/v1/org/branches']);
  });
});

describe('the branch pair is the run target, and the period travels untouched', () => {
  it('names the company and the branch the report is about', async () => {
    transport(() => ok(RUN));
    await runReport({
      reportCode: CODE,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from: '2026-09-01',
      to: '2026-09-08',
      cursor: null,
      limit: REPORT_PAGE_SIZE,
    });
    const path = String(requestedRun());
    expect(path).toContain(`companyId=${COMPANY_ID}`);
    expect(path).toContain(`branchId=${BRANCH_ID}`);
  });

  it('sends the two days exactly as they were given, adding nothing to either', async () => {
    // The half-open period is the OPERATOR's: `to` is already the first day
    // excluded. An adapter that added a day "to make it exclusive" would report
    // one day more than was asked for, and the total would be wrong by a day
    // every time without anything looking broken.
    transport(() => ok(RUN));
    await runReport({
      reportCode: CODE,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from: '2026-09-01',
      to: '2026-09-08',
      cursor: null,
      limit: REPORT_PAGE_SIZE,
    });
    const path = String(requestedRun());
    expect(path).toContain('from=2026-09-01');
    expect(path).toContain('to=2026-09-08');
    // No instant, no offset, no zone: the server resolves the two days in the
    // reported branch's own zone, and a time sent from here would override it.
    expect(path).not.toContain('T00');
    expect(path).not.toMatch(/from=\d{4}-\d{2}-\d{2}T/);
  });

  it('carries a run cursor and drops it when there is none', async () => {
    transport(() => ok(RUN));
    await runReport({
      reportCode: CODE,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from: '2026-09-01',
      to: '2026-09-08',
      cursor: CURSOR,
      limit: REPORT_PAGE_SIZE,
    });
    expect(String(requestedRun())).toContain(`cursor=${CURSOR}`);
  });

  it('refuses to send a scope the browser asserted among the ordinary filters', async () => {
    // `branchTargetQuery` is the only door for the pair, and it throws rather
    // than preferring one of two copies. The property is asserted through the
    // adapter so that a future filter named after a scope fails here.
    transport(() => ok(RUN));
    await runReport({
      reportCode: CODE,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from: '2026-09-01',
      to: '2026-09-08',
      cursor: null,
      limit: REPORT_PAGE_SIZE,
    });
    const path = String(requestedRun());
    expect(path.match(/companyId=/g)).toHaveLength(1);
    expect(path.match(/branchId=/g)).toHaveLength(1);
    expect(path).not.toContain('tenantId=');
  });
});

describe('no request asks for more rows than the route accepts', () => {
  it('caps a page size above the route ceiling instead of sending it', () => {
    expect(reportPageSize(MAX_REPORT_PAGE_SIZE + 1)).toBe(MAX_REPORT_PAGE_SIZE);
    expect(reportPageSize(1000)).toBe(MAX_REPORT_PAGE_SIZE);
  });

  it('keeps a size the route accepts, and repairs one that is not a size at all', () => {
    expect(reportPageSize(REPORT_PAGE_SIZE)).toBe(REPORT_PAGE_SIZE);
    expect(reportPageSize(1)).toBe(1);
    expect(reportPageSize(0)).toBe(MAX_REPORT_PAGE_SIZE);
    expect(reportPageSize(-5)).toBe(MAX_REPORT_PAGE_SIZE);
    expect(reportPageSize(12.5)).toBe(MAX_REPORT_PAGE_SIZE);
  });

  it('sends the capped size on the run and on the catalogue', async () => {
    transport((path) => (path.includes('/rows') ? ok(RUN) : ok({ items: [] })));
    await runReport({
      reportCode: CODE,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from: '2026-09-01',
      to: '2026-09-08',
      cursor: null,
      limit: 1000,
    });
    expect(String(requestedRun())).toContain(`limit=${String(MAX_REPORT_PAGE_SIZE)}`);
    get.mockClear();
    await listReportCatalogue({ cursor: null, limit: 1000 });
    expect(requested()[0]).toContain(`limit=${String(MAX_REPORT_PAGE_SIZE)}`);
  });
});

describe('a request that cannot be honoured is refused before it is spent', () => {
  it.each([
    ['2026-09-08', '2026-09-08'],
    ['2026-09-09', '2026-09-08'],
    ['', '2026-09-08'],
    ['2026-09-01', 'not-a-day'],
  ])('refuses the period %s to %s without reading anything', async (from, to) => {
    transport(() => ok(RUN));
    const state = await runReport({
      reportCode: CODE,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from,
      to,
      cursor: null,
      limit: REPORT_PAGE_SIZE,
    });
    expect(state.status).toBe('error');
    expect(get).not.toHaveBeenCalled();
  });

  it('refuses a branch the caller’s own directory does not list', async () => {
    // A Server Action is callable without the screen that offers the choices.
    transport(() => ok(RUN));
    const state = await runReport({
      reportCode: CODE,
      companyId: COMPANY_ID,
      branchId: OTHER_BRANCH_ID,
      from: '2026-09-01',
      to: '2026-09-08',
      cursor: null,
      limit: REPORT_PAGE_SIZE,
    });
    expect(state.status).toBe('denied');
    expect(requestedRun()).toBeNull();
  });

  it('passes on a directory refusal rather than calling it a denied run', async () => {
    get.mockResolvedValue(failure('unavailable'));
    const state = await runReport({
      reportCode: CODE,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from: '2026-09-01',
      to: '2026-09-08',
      cursor: null,
      limit: REPORT_PAGE_SIZE,
    });
    expect(state.status).toBe('unavailable');
  });
});

describe('a refusal arrives as a refusal, never as an empty report', () => {
  it.each([
    ['forbidden', 'denied'],
    ['not-found', 'not-found'],
    ['validation', 'error'],
    ['rate-limited', 'unavailable'],
    ['unauthenticated', 'expired'],
    ['server', 'error'],
  ])('maps a %s outcome of the run to %s', async (kind, expected) => {
    transport(() => failure(kind));
    const state = await runReport({
      reportCode: CODE,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from: '2026-09-01',
      to: '2026-09-08',
      cursor: null,
      limit: REPORT_PAGE_SIZE,
    });
    expect(state.status).toBe(expected);
  });

  it.each([
    ['forbidden', 'denied'],
    ['not-found', 'not-found'],
  ])('maps a %s outcome of the definition read to %s', async (kind, expected) => {
    transport(() => failure(kind));
    const state = await readReport(CODE);
    expect(state.status).toBe(expected);
  });

  it('reports an ended session rather than an empty catalogue', async () => {
    authorizedClient.mockResolvedValue(null as unknown);
    const state = await listReportCatalogue({ cursor: null, limit: REPORT_PAGE_SIZE });
    expect(state.status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('this feature reads, and has no write path at all', () => {
  it('publishes exactly four reads and nothing that sends', () => {
    // Reports are read. Authoring a definition is a separate surface with its
    // own authority, and there is no export operation to call — so an adapter
    // that sent anything from here would be reaching for neither.
    expect(Object.keys(adapters).sort()).toEqual([
      'listReportCatalogue',
      'readReport',
      'readReportScopes',
      'runReport',
    ]);
  });

  it('never uses the transport’s sending half', async () => {
    transport(() => ok(RUN));
    await listReportCatalogue({ cursor: null, limit: REPORT_PAGE_SIZE });
    await readReport(CODE);
    await runReport({
      reportCode: CODE,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      from: '2026-09-01',
      to: '2026-09-08',
      cursor: null,
      limit: REPORT_PAGE_SIZE,
    });
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the contract mirrors what the operations publish', () => {
  it('accepts a half-open period and refuses an empty or reversed one', () => {
    expect(contract.isReportPeriod('2026-09-01', '2026-09-02')).toBe(true);
    expect(contract.isReportPeriod('2026-09-01', '2026-09-01')).toBe(false);
    expect(contract.isReportPeriod('2026-09-02', '2026-09-01')).toBe(false);
    expect(contract.isReportDay('2026-09-01')).toBe(true);
    expect(contract.isReportDay('2026-9-1')).toBe(false);
  });

  it('knows every column kind the engine can publish, and admits no other', () => {
    for (const kind of ['text', 'date', 'count', 'reference', 'duration', 'quantity', 'money']) {
      expect(contract.isReportColumnKind(kind), kind).toBe(true);
    }
    expect(contract.isReportColumnKind('percentage')).toBe(false);
  });

  it('reads the deprecated state counts only when the newer grouping is absent', () => {
    const withCounts = {
      ...RUN,
      countsByState: [{ stateCode: 'open', stateName: 'Open', count: 3 }],
    };
    expect(contract.reportGroups(withCounts)).toEqual([
      { key: { state: 'open' }, label: 'Open', measures: { count: '3' } },
    ]);
    // The newer envelope DERIVES the deprecated field from the new one, so
    // reading both would count the one dataset that carries both twice.
    const withGroups = {
      ...withCounts,
      groups: [{ key: { state: 'open' }, label: 'Open', measures: { count: '3' } }],
    };
    expect(contract.reportGroups(withGroups)).toHaveLength(1);
    expect(contract.reportGroups({ ...RUN, groups: [] })).toEqual([]);
  });

  it('links a reference only to a route this application actually serves', () => {
    const row = { cells: [{ key: 'workOrder', label: 'W-1', value: 'abc' }] };
    const column = { key: 'workOrder', kind: 'reference', drillThrough: '/work-orders/{id}' };
    expect(contract.drillThroughHref(column, row, row.cells[0]!, 'en')).toBe('/en/work-orders/abc');
    // Published by the engine, and there is no screen behind it in this
    // application. A link would be an offer to visit a page that does not exist.
    const technician = { key: 'technician', kind: 'reference', drillThrough: '/technicians/{id}' };
    expect(contract.drillThroughHref(technician, row, row.cells[0]!, 'en')).toBeNull();
  });

  it('resolves a per-kind drill-through by the row’s own discriminating value', () => {
    const row = {
      cells: [
        { key: 'document', label: 'INV-1', value: 'doc-1' },
        { key: 'documentType', label: 'Invoice', value: 'invoice' },
      ],
    };
    const column = {
      key: 'document',
      kind: 'reference',
      drillThrough: null,
      drillThroughByKind: {
        discriminator: 'documentType',
        templates: { invoice: '/work-orders/{id}', credit_note: null },
      },
    };
    expect(contract.drillThroughTemplate(column, row)).toBe('/work-orders/{id}');
    const credited = {
      cells: [
        { key: 'document', label: 'CN-1', value: 'doc-2' },
        { key: 'documentType', label: 'Credit note', value: 'credit_note' },
      ],
    };
    // A kind published as having no target route, and a kind the report never
    // mentioned, are different answers and neither invents a link.
    expect(contract.drillThroughTemplate(column, credited)).toBeNull();
    const unknown = {
      cells: [
        { key: 'document', label: 'X-1', value: 'doc-3' },
        { key: 'documentType', label: 'Something else', value: 'voucher' },
      ],
    };
    expect(contract.drillThroughTemplate(column, unknown)).toBeNull();
  });
});
