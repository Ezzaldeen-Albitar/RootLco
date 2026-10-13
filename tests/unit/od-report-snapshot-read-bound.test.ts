import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * P1-32-PRE-OD-FD16C — the bound on concurrent snapshot reads, and the race path
 * of a duplicate original.
 *
 * A snapshot save reads its pages on a SECOND pooled connection
 * (`readWholeReport`) while the request's own transaction holds the first, so a
 * save in flight holds two. At most `DB_POOL_MAX - 2` reads (never fewer than one)
 * run at once in a process; the next save is refused at once with the platform's
 * throttling refusal, ERR-RTE-001, before it asks for a second connection. The
 * slot is given back whether the read succeeded or failed.
 *
 * `readWholeReport` is pinned as the ONLY place the service acquires a connection
 * of its own: a second acquisition elsewhere would escape the bound.
 *
 * And a save that loses the race at `uq_report_snapshots_original` is recorded
 * against the winning snapshot, as the check before the read records it (ADR-023
 * D12), and against the branch only when the winner cannot be read.
 */

const config = vi.hoisted(() => ({ DB_POOL_MAX: 10, EXPORT_MAX_ROWS: 1000 }));
const tx = vi.hoisted(() => ({
  acquisitions: 0,
  hold: null as Promise<void> | null,
  fail: false,
}));

vi.mock('@api/server/config/backend-config', () => ({
  backendConfig: () => config,
}));
vi.mock('@api/server/db/transaction', () => ({
  withTransaction: async (
    context: unknown,
    fn: (db: unknown) => Promise<unknown>,
    _options: unknown
  ) => {
    tx.acquisitions += 1;
    if (tx.hold !== null) await tx.hold;
    if (tx.fail) throw new Error('the read failed');
    return fn({ context, depth: 0, query: vi.fn() });
  },
  withSavepoint: async (db: unknown, fn: (nested: unknown) => Promise<unknown>) => fn(db),
}));
vi.mock('@api/server/auth/authorization', () => ({
  callerHoldsPermission: async () => true,
}));
vi.mock('@api/server/audit/audit', () => ({ appendAudit: vi.fn(async () => undefined) }));
vi.mock('@api/modules/iam', () => ({
  iamOrganizationContext: () => ({ branches: { findBranch: async () => ({}) } }),
  iamDirectory: () => ({ directory: { resolveDisplayIdentities: async () => new Map() } }),
}));
vi.mock('@api/server/observability/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { ReportSnapshotService, snapshotReadCapacity, SNAPSHOT_READ_BUSY_RETRY_SECONDS } =
  await import('@api/modules/reporting/application/report-snapshot-service');
const { AppFailure } = await import('@api/server/errors/app-failure');
const { businessRefusalOf } = await import('@api/server/audit/business-refusals');

const COMPANY = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';
const WINNER = '33333333-3333-4333-8333-333333333333';
const SAVED = '44444444-4444-4444-8444-444444444444';
const REPORT = 'invoice_payment_summary';

const db = {
  context: {
    correlationId: 'corr-snapshot-bound',
    causationId: null,
    principal: {
      tenantId: '55555555-5555-4555-8555-555555555555',
      userId: '66666666-6666-4666-8666-666666666666',
    },
    companyIds: [],
    branchIds: [],
    operation: 'rpt.report-snapshot-create',
    module: 'reporting',
    startedAtMs: 0,
    startedAt: new Date(0),
  },
  depth: 0,
  query: vi.fn(),
} as never;

function storedRow(id: string, from: string) {
  return {
    id,
    reportCode: REPORT,
    companyId: COMPANY,
    branchId: BRANCH,
    periodFrom: from,
    periodToExclusive: '2026-05-02',
    timezoneName: 'Asia/Amman',
    asOf: new Date('2026-05-02T00:00:00Z'),
    generatedAt: new Date('2026-05-02T01:00:00Z'),
    generatedBy: '66666666-6666-4666-8666-666666666666',
    rowCount: 0,
    rowsDigest: '0'.repeat(64),
    restatesSnapshotId: null,
    restatedBySnapshotId: null,
    restatementReason: null,
    difference: null,
    columns: [],
    requiredPermissions: ['sal.finance.view'],
  };
}

function service(repository: Record<string, unknown> = {}) {
  const runs = {
    run: async () => ({
      asOf: '2026-05-02T00:00:00.000Z',
      period: { from: '2026-05-01', to: '2026-05-02', timezone: 'Asia/Amman' },
      columns: [],
      rows: { items: [], hasMore: false, nextCursor: null },
    }),
  };
  const repo = {
    findOriginal: async () => null,
    insert: async () => storedRow(SAVED, '2026-05-01'),
    ...repository,
  };
  return new ReportSnapshotService(repo as never, runs as never);
}

const save = (svc: InstanceType<typeof ReportSnapshotService>, from = '2026-05-01') =>
  svc.create(db, {
    reportCode: REPORT,
    companyId: COMPANY,
    branchId: BRANCH,
    from,
    to: '2026-05-02',
  });

/** Settles the pending microtasks, so every started save reaches its read. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  config.DB_POOL_MAX = 10;
  tx.acquisitions = 0;
  tx.hold = null;
  tx.fail = false;
});

describe('the bound on concurrent snapshot reads', () => {
  it('is two under the pool size, and never below one', () => {
    expect(snapshotReadCapacity(10)).toBe(8);
    expect(snapshotReadCapacity(4)).toBe(2);
    expect(snapshotReadCapacity(3)).toBe(1);
    expect(snapshotReadCapacity(2)).toBe(1);
    expect(snapshotReadCapacity(1)).toBe(1);
  });

  it('refuses the save beyond it at once with the throttling refusal, and admits one after', async () => {
    config.DB_POOL_MAX = 4;
    let release: () => void = () => undefined;
    tx.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const svc = service();
    const held = [save(svc), save(svc)];
    await settle();
    expect(tx.acquisitions).toBe(2);

    const refused = await save(svc).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AppFailure);
    expect((refused as InstanceType<typeof AppFailure>).code).toBe('ERR-RTE-001');
    expect((refused as InstanceType<typeof AppFailure>).safeDetails.retryAfterSeconds).toBe(
      SNAPSHOT_READ_BUSY_RETRY_SECONDS
    );
    // Refused before a second connection was asked for.
    expect(tx.acquisitions).toBe(2);

    release();
    await Promise.all(held);
    tx.hold = null;
    await expect(save(svc)).resolves.toMatchObject({ snapshot: { id: SAVED } });
    expect(tx.acquisitions).toBe(3);
  });

  it('gives the slot back when the read fails', async () => {
    config.DB_POOL_MAX = 3;
    const svc = service();
    tx.fail = true;
    await expect(save(svc)).rejects.toThrow('the read failed');
    tx.fail = false;
    await expect(save(svc)).resolves.toMatchObject({ snapshot: { id: SAVED } });
  });

  it('acquires exactly one connection of its own per save, in readWholeReport alone', async () => {
    await save(service());
    expect(tx.acquisitions).toBe(1);

    const source = readFileSync(
      fileURLToPath(
        new URL(
          '../../apps/api/src/modules/reporting/application/report-snapshot-service.ts',
          import.meta.url
        )
      ),
      'utf8'
    );
    const acquisitions = [...source.matchAll(/\bwithTransaction\(/g)].map((m) => m.index);
    expect(acquisitions).toHaveLength(1);
    expect(source).not.toMatch(/\bacquire(Primary|Platform)Client\b|\bwithReadOnlyTransaction\(/);
    const start = source.indexOf('private async readWholeReport(');
    const end = source.indexOf('private async readPages(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(acquisitions[0]).toBeGreaterThan(start);
    expect(acquisitions[0]).toBeLessThan(end);
  });
});

describe('a duplicate original that lost the race at the unique index', () => {
  const uniqueLoss = () =>
    Object.assign(new Error('duplicate key value'), {
      code: '23505',
      constraint: 'uq_report_snapshots_original',
    });

  it('is recorded against the winning snapshot, as the check before the read records it', async () => {
    let lookups = 0;
    const svc = service({
      // Nothing before the read; the winner after the insert lost.
      findOriginal: async () => {
        lookups += 1;
        return lookups === 1 ? null : storedRow(WINNER, '2026-05-01');
      },
      insert: async () => {
        throw uniqueLoss();
      },
    });
    const refused = await save(svc).catch((error: unknown) => error);
    expect((refused as InstanceType<typeof AppFailure>).code).toBe('ERR-RES-002');
    expect(businessRefusalOf(refused)).toEqual({
      entityType: 'rpt.report_snapshot',
      entityId: WINNER,
      rule: 'report_snapshot_exists',
    });
    expect(lookups).toBe(2);
  });

  it('is recorded against the branch only when the winner cannot be read', async () => {
    for (const second of [async () => null, async () => Promise.reject(new Error('unreadable'))]) {
      let lookups = 0;
      const svc = service({
        findOriginal: async () => {
          lookups += 1;
          return lookups === 1 ? null : second();
        },
        insert: async () => {
          throw uniqueLoss();
        },
      });
      const refused = await save(svc).catch((error: unknown) => error);
      expect((refused as InstanceType<typeof AppFailure>).code).toBe('ERR-RES-002');
      expect(businessRefusalOf(refused)).toEqual({
        entityType: 'org.branch',
        entityId: BRANCH,
        rule: 'report_snapshot_exists',
      });
    }
  });
});
