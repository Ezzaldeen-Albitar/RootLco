/**
 * P1-32-PRE-OD-FD16B — the review residuals of the as-of report (Owner decision
 * D16, P1-32-PRE-OD-FD16A), at the service, with the database and the dataset
 * ports replaced by fakes so each rule is exercised on its own.
 *
 *  a) "Now" is the DATABASE's reading: the default moment of a period that has not
 *     closed, `asOf=now`, and the upper bound a chosen moment is held to all come
 *     from the transaction's `now()` (`periodInstants().readAt`), never from the
 *     application server's clock. The fake database clock below stands months
 *     before the real one, so a run that read `new Date()` answers differently.
 *  b) An export refusal names `body.asOf`, where an export carries the moment.
 *  c) The paging cursor carries the moment: a later page without `asOf` is computed
 *     as of the cursor's moment, a different moment beside the cursor is refused,
 *     and a cursor that carries no moment is refused as malformed.
 *
 * Each case fails against the FD16A service, which read `new Date()`, refused
 * `now` as a malformed instant, named `query.asOf` in an export and minted a cursor
 * that carried no moment.
 */
import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReportRunService } from '@api/modules/reporting/application/report-run-service';
import { ReportExportService } from '@api/modules/reporting/application/report-export-service';
import type { ReportCatalogueRepository } from '@api/modules/reporting/data/report-catalogue-repository';
import { AppFailure } from '@api/server/errors/app-failure';

const calls = vi.hoisted(() => ({
  permission: vi.fn(),
  branch: vi.fn(),
  invoices: vi.fn(),
  receipts: vi.fn(),
  parties: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/server/auth/authorization', () => ({ callerHoldsPermission: calls.permission }));
vi.mock('@/server/audit/audit', () => ({ appendAudit: calls.audit }));
vi.mock('@/server/config/backend-config', () => ({
  backendConfig: () => ({ EXPORT_MAX_ROWS: 100 }),
}));
vi.mock('@/modules/iam', () => ({
  iamOrganizationContext: () => ({ branches: { findBranch: calls.branch } }),
}));
vi.mock('@/modules/billing', () => ({
  billingModule: () => ({ reportPort: { invoiceDocuments: calls.invoices } }),
}));
vi.mock('@/modules/payments', () => ({
  paymentsModule: () => ({ reportPort: { receiptDocuments: calls.receipts } }),
}));
vi.mock('@/modules/crm', () => ({
  crmModule: () => ({ customerRead: { resolveDisplayIdentities: calls.parties } }),
}));

const db = {} as never;
const CODE = 'invoice_payment_summary';
const COMPANY = 'a1320000-0000-4000-8000-000000000001';
const BRANCH = 'a1320000-0000-4000-8000-000000000002';

/** The period opens and closes on these instants (the fake database's answer). */
const OPENS = new Date('2026-05-09T21:00:00.000Z');
const CLOSES_OPEN_PERIOD = new Date('2099-01-01T00:00:00.000Z');
/**
 * The DATABASE's "now". Months before the real clock, so a service that read
 * `new Date()` instead would produce a different moment and accept moments this
 * clock has not reached.
 */
const DB_NOW = new Date('2026-05-10T15:00:00.000Z');

const periodInstants = vi.fn();
const findByCode = vi.fn();
const repository = { periodInstants, findByCode } as unknown as ReportCatalogueRepository;
const runs = new ReportRunService(repository);

const input = {
  reportCode: CODE,
  companyId: COMPANY,
  branchId: BRANCH,
  from: '2026-05-10',
  to: '2099-01-01',
};

function invoice(id: string, sortValue: string) {
  return {
    documentType: 'invoice' as const,
    documentId: id,
    documentNumber: `INV-${id.slice(-3)}`,
    documentDate: sortValue,
    partyId: 'a1320000-0000-4000-8000-0000000000aa',
    partyRole: 'payer' as const,
    currencyCode: 'USD',
    status: 'issued',
    invoicedAmount: '10.0000',
    outstanding: '10.0000',
    creditNoteAmount: null,
    creditStatus: 'none',
    sortValue,
  };
}

const FIRST = 'a1320000-0000-4000-8000-000000000101';
const SECOND = 'a1320000-0000-4000-8000-000000000102';

function decode(cursor: string | null): Record<string, string> {
  return JSON.parse(Buffer.from(cursor ?? '', 'base64url').toString('utf8')) as Record<
    string,
    string
  >;
}

function cursorWith(fields: Record<string, string>): string {
  return Buffer.from(JSON.stringify(fields), 'utf8').toString('base64url');
}

async function refusal(promise: Promise<unknown>): Promise<AppFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppFailure) return error;
    throw error;
  }
  throw new Error('expected a refusal');
}

beforeEach(() => {
  vi.clearAllMocks();
  calls.permission.mockResolvedValue(true);
  calls.audit.mockResolvedValue(undefined);
  calls.branch.mockResolvedValue({ name: 'Reported branch', timezoneName: 'Asia/Amman' });
  calls.parties.mockResolvedValue(new Map());
  calls.invoices.mockResolvedValue({
    totals: [],
    creditNoteTotals: [],
    documents: [
      invoice(FIRST, '2026-05-10T12:00:00.000002Z'),
      invoice(SECOND, '2026-05-10T11:00:00.000001Z'),
    ],
  });
  calls.receipts.mockResolvedValue({ totals: [], documents: [] });
  findByCode.mockResolvedValue(null);
  periodInstants.mockResolvedValue({ opens: OPENS, closes: CLOSES_OPEN_PERIOD, readAt: DB_NOW });
});

describe('a) "now" is the database transaction’s reading', () => {
  it('defaults a period that has not closed to the database read time', async () => {
    const view = await runs.run(db, input);
    expect(view.freshness).toBe('as_of');
    expect(view.asOf).toBe(DB_NOW.toISOString());
    expect(calls.invoices).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ asOf: DB_NOW.toISOString() }),
      expect.anything()
    );
  });

  it('answers asOf=now with the database read time', async () => {
    const view = await runs.run(db, { ...input, asOf: 'now' });
    expect(view.asOf).toBe(DB_NOW.toISOString());
  });

  it('refuses a chosen moment the database clock has not reached', async () => {
    // Before the real clock, after the database's: refused as after the read.
    const failure = await refusal(runs.run(db, { ...input, asOf: '2026-05-10T16:00:00Z' }));
    expect(failure.code).toBe('ERR-VAL-001');
    expect(failure.safeDetails).toEqual({
      violations: [{ path: 'query.asOf', rule: 'after_read_time' }],
    });
  });
});

describe('b) an export refusal names the body, where an export carries the moment', () => {
  it('reports a moment before the period as body.asOf', async () => {
    findByCode.mockResolvedValue({
      id: 'a1320000-0000-4000-8000-000000000003',
      report_code: CODE,
      status: 'published',
      version_number: 1,
      scope_level: 'branch',
      export_permission_code: 'rpt.export',
      parameter_schema: {},
    });
    const exports = new ReportExportService(repository, runs);
    const failure = await refusal(
      exports.generate(db, { ...input, asOf: '2026-05-01T00:00:00Z', reason: 'Month end' })
    );
    expect(failure.code).toBe('ERR-VAL-001');
    expect(failure.safeDetails).toEqual({
      violations: [{ path: 'body.asOf', rule: 'before_period_start' }],
    });
    expect(calls.audit).not.toHaveBeenCalled();
  });
});

describe('c) the cursor carries the moment', () => {
  const MOMENT = '2026-05-10T13:30:00.000Z';

  it('mints a next-page cursor bound to the moment the page was computed as of', async () => {
    const view = await runs.run(db, { ...input, asOf: MOMENT, limit: 1 });
    expect(view.rows.hasMore).toBe(true);
    const cursor = decode(view.rows.nextCursor);
    expect(cursor.a).toBe(MOMENT);
    expect(cursor.i).toBe(FIRST);
  });

  it('computes a later page without asOf as of the cursor’s moment', async () => {
    const first = await runs.run(db, { ...input, asOf: MOMENT, limit: 1 });
    calls.invoices.mockClear();
    const next = await runs.run(db, { ...input, cursor: first.rows.nextCursor ?? '', limit: 1 });
    // Not the default (the database read time): the moment the first page used.
    expect(next.asOf).toBe(MOMENT);
    expect(calls.invoices).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ asOf: MOMENT }),
      expect.objectContaining({ after: expect.objectContaining({ id: FIRST }) })
    );
  });

  it('accepts the same moment beside the cursor and refuses a different one', async () => {
    const first = await runs.run(db, { ...input, asOf: MOMENT, limit: 1 });
    const cursor = first.rows.nextCursor ?? '';
    const same = await runs.run(db, { ...input, asOf: '2026-05-10T16:30:00+03:00', cursor });
    expect(same.asOf).toBe(MOMENT);

    for (const other of ['2026-05-10T14:00:00Z', 'now']) {
      const failure = await refusal(runs.run(db, { ...input, asOf: other, cursor }));
      expect(failure.code).toBe('ERR-VAL-001');
      expect(failure.safeDetails).toEqual({
        violations: [{ path: 'query.cursor', rule: 'as_of_mismatch' }],
      });
    }
  });

  it('refuses a cursor that carries no moment', async () => {
    const failure = await refusal(
      runs.run(db, {
        ...input,
        cursor: cursorWith({
          k: 'sal.invoice_payment_summary:document_date_desc',
          v: '2026-05-10T12:00:00.000002Z',
          i: FIRST,
        }),
      })
    );
    expect(failure.code).toBe('ERR-PAG-001');
    expect(calls.invoices).not.toHaveBeenCalled();
  });
});
