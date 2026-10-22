import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A request's transaction never hands its connection two statements at once.
 *
 * The acceptance runtime's stderr carried `pg`'s warning "Calling client.query()
 * when the client is already executing a query is deprecated" (Owner directive
 * checkpoint, observation OBS-5). Several services start reads together with
 * `Promise.all` on the ONE client a transaction owns — a statement `pg` 8 queues
 * and warns about, and `pg` 9 refuses. `server/db/transaction.ts` now orders the
 * statements itself, so the client is only ever asked for the next statement
 * once the previous one has settled.
 *
 * The pool is replaced by a stand-in client that THROWS when a statement arrives
 * while another is still running, which is exactly the condition the warning is
 * printed for. Everything else is the real transaction module.
 */

class OverlapError extends Error {}

interface FakeClient {
  readonly statements: string[];
  readonly overlaps: string[];
  query: (text: string) => Promise<{ rows: never[]; rowCount: number }>;
  release: (destroy?: boolean) => void;
}

let current: FakeClient;

function fakeClient(failOn: ReadonlySet<string> = new Set()): FakeClient {
  let running: string | null = null;
  const client: FakeClient = {
    statements: [],
    overlaps: [],
    async query(text: string) {
      if (running !== null) {
        client.overlaps.push(`${text} while ${running}`);
        throw new OverlapError(`overlapping statement: ${text} while ${running}`);
      }
      running = text;
      client.statements.push(text);
      // A real round trip: the statement is outstanding across a macrotask, so a
      // sibling started in the same tick would find it still running.
      await new Promise((resolve) => setTimeout(resolve, 1));
      running = null;
      if (failOn.has(text)) throw new Error(`refused: ${text}`);
      return { rows: [], rowCount: 0 };
    },
    release: vi.fn(),
  };
  return client;
}

vi.mock('@api/server/db/pool', () => ({
  acquirePrimaryClient: async () => current,
  acquirePlatformClient: async () => current,
}));

vi.mock('@api/server/config/backend-config', () => ({
  backendConfig: () => ({ DB_STATEMENT_TIMEOUT_MS: 15_000 }),
}));

vi.mock('@api/server/observability/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { withTransaction, withSavepoint } = await import('@api/server/db/transaction');

const context = {
  correlationId: 'corr-serial-queries',
  causationId: null,
  principal: {
    tenantId: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
  },
  companyIds: [],
  branchIds: [],
  operation: 'test.serial-queries',
  module: 'test',
  startedAtMs: 0,
  startedAt: new Date(0),
} as never;

/** The caller's own statements, without the transaction's opening context. */
function callerStatements(client: FakeClient): string[] {
  return client.statements.filter(
    (text) => !text.startsWith('BEGIN') && !text.startsWith('SELECT set_config')
  );
}

beforeEach(() => {
  current = fakeClient();
});

describe('statements started together on one transaction run one after another', () => {
  it('runs a Promise.all of reads in the order they were asked for, with no overlap', async () => {
    const results = await withTransaction(context, (db) =>
      Promise.all([db.query('SELECT 1'), db.query('SELECT 2'), db.query('SELECT 3')])
    );
    expect(results).toHaveLength(3);
    expect(current.overlaps).toEqual([]);
    expect(callerStatements(current)).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3', 'COMMIT']);
    expect(current.statements[0]).toBe('BEGIN READ WRITE');
    expect(current.release).toHaveBeenCalledWith(undefined);
  });

  it('orders a savepoint handle and its parent on the same connection', async () => {
    await withTransaction(context, (db) =>
      Promise.all([
        withSavepoint(db, (nested) =>
          Promise.all([nested.query('SELECT inner_a'), nested.query('SELECT inner_b')])
        ),
        db.query('SELECT outer'),
      ])
    );
    expect(current.overlaps).toEqual([]);
    expect(callerStatements(current)).toEqual([
      'SAVEPOINT sp_1',
      'SELECT outer',
      'SELECT inner_a',
      'SELECT inner_b',
      'RELEASE SAVEPOINT sp_1',
      'COMMIT',
    ]);
  });

  it('keeps a failure its own, lets the queued sibling run, and rolls back AFTER it', async () => {
    current = fakeClient(new Set(['SELECT broken']));
    await expect(
      withTransaction(context, (db) =>
        Promise.all([db.query('SELECT broken'), db.query('SELECT sibling')])
      )
    ).rejects.toThrow('refused: SELECT broken');
    // No overlap even though the rollback was asked for while the sibling was
    // still waiting: it runs after the sibling, as `pg`'s own queue ran it.
    expect(current.overlaps).toEqual([]);
    expect(callerStatements(current)).toEqual(['SELECT broken', 'SELECT sibling', 'ROLLBACK']);
    expect(current.release).toHaveBeenCalledWith(undefined);
  });

  it('FALSIFICATION: the stand-in client does refuse two statements at once', async () => {
    // Without the transaction's ordering, the same Promise.all reaches the client
    // directly and the second statement meets the first still running.
    const raw = fakeClient();
    const outcome = await Promise.allSettled([raw.query('SELECT 1'), raw.query('SELECT 2')]);
    expect(outcome[1]?.status).toBe('rejected');
    expect(raw.overlaps).toEqual(['SELECT 2 while SELECT 1']);
  });
});
