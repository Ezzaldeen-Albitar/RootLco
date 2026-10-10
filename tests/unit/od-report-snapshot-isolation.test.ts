import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P1-32-PRE-OD-FD16B — a report snapshot is ONE consistent read, written at READ
 * COMMITTED.
 *
 * The snapshot's rows are read page by page through the report run, so they are
 * read in a READ ONLY transaction at REPEATABLE READ: every statement of it reads
 * the one database snapshot its first statement took, and a payment committed
 * between two pages cannot appear in one and not the other. The save's own
 * transaction — insert, audit record, idempotency key — must NOT run at that level:
 * the audit chain numbers its next entry by reading the highest so far, which at
 * REPEATABLE READ misses every audited write the tenant committed meanwhile. Two
 * halves: the transaction honours the options, and neither snapshot route asks the
 * request's transaction for an isolation level (the backend suite proves the save
 * survives an audited write committed between its pages).
 */

const statements: string[] = [];
const captured = vi.hoisted(() => ({ options: [] as unknown[] }));

vi.mock('@api/server/db/pool', () => ({
  acquirePrimaryClient: async () => ({
    query: async (text: string) => {
      statements.push(text);
      return { rows: [], rowCount: 0 };
    },
    release: vi.fn(),
  }),
  acquirePlatformClient: async () => {
    throw new Error('not used');
  },
}));
vi.mock('@api/server/config/backend-config', () => ({
  backendConfig: () => ({ DB_STATEMENT_TIMEOUT_MS: 15_000 }),
}));
vi.mock('@api/server/observability/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock('@/server/http/route-handler', () => ({
  handleOperation: vi.fn(
    async (_operation: unknown, _request: unknown, _handler: unknown, options: unknown) => {
      captured.options.push(options);
      return new Response('{}', { status: 200 });
    }
  ),
}));

const { withTransaction } = await import('@api/server/db/transaction');
const snapshots = await import('@api/app/api/v1/reports/[reportCode]/snapshots/route');

const context = {
  correlationId: 'corr-snapshot-isolation',
  causationId: null,
  principal: {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
  },
  companyIds: [],
  branchIds: [],
  operation: 'test.snapshot-isolation',
  module: 'test',
  startedAtMs: 0,
  startedAt: new Date(0),
} as never;

beforeEach(() => {
  statements.length = 0;
  captured.options.length = 0;
});

describe('the transaction isolation a request asks for', () => {
  it('opens at REPEATABLE READ when asked, and at the server default otherwise', async () => {
    await withTransaction(context, async () => undefined, { isolation: 'repeatable read' });
    expect(statements[0]).toBe('BEGIN READ WRITE ISOLATION LEVEL REPEATABLE READ');
    statements.length = 0;
    await withTransaction(context, async () => undefined, {
      access: 'read only',
      isolation: 'repeatable read',
    });
    expect(statements[0]).toBe('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
    statements.length = 0;
    await withTransaction(context, async () => undefined);
    expect(statements[0]).toBe('BEGIN READ WRITE');
  });

  it('is asked for by neither snapshot route: the save writes its audit at READ COMMITTED', async () => {
    const reportCode = 'invoice_payment_summary';
    await snapshots.POST(
      new Request(`http://localhost/api/v1/reports/${reportCode}/snapshots`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: '2026-04-01', to: '2026-04-02' }),
      }),
      { params: Promise.resolve({ reportCode }) }
    );
    await snapshots.GET(
      new Request(`http://localhost/api/v1/reports/${reportCode}/snapshots?from=2026-04-01`),
      { params: Promise.resolve({ reportCode }) }
    );
    expect(captured.options).toHaveLength(2);
    expect(captured.options[0]).toMatchObject({ params: { reportCode } });
    expect(captured.options[0]).not.toHaveProperty('isolation');
    expect(captured.options[1]).not.toHaveProperty('isolation');
  });
});
