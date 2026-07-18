/**
 * Phase 1-5 Increment G — transactional event outbox.
 *
 * All worker-capability evidence runs as rootlco_test_worker, a constrained
 * member of app_worker. The admin connection is fixture/cleanup only.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  USER_A,
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  readonlyPool,
  runtimePool,
  workerPool,
} from './helpers';

const AGGREGATE_ID = 'a9000000-0000-4000-8000-000000000001';

let admin: Pool;
let worker: Pool;
let runtime: Pool;
let readonly: Pool;

async function insertEvent(
  eventKey: string,
  schemaVersion = 1,
  aggregateVersion = 1
): Promise<string> {
  const { rows } = await worker.query(
    `INSERT INTO shared.event_outbox (
       tenant_id, company_id, branch_id, event_key, event_type,
       aggregate_type, aggregate_id, schema_version, aggregate_version,
       producer, occurred_at, correlation_id, causation_id,
       payload, headers, created_by
     ) VALUES (
       $1, $2, $3, $4, 'work_order.created',
       'work_order', $5, $6, $7, 'backend.orders', now(),
       'a9000000-0000-4000-8000-000000000002', NULL,
       '{"work_order":"created"}', '{"source":"test"}', $8
     )
     RETURNING id`,
    [
      TENANT_A,
      COMPANY_A1,
      BRANCH_A1,
      eventKey,
      AGGREGATE_ID,
      schemaVersion,
      aggregateVersion,
      USER_A,
    ]
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  worker = workerPool(6);
  runtime = runtimePool();
  readonly = readonlyPool();
});

beforeEach(async () => {
  // Truncate-equivalent isolation while preserving FK-safe DELETE semantics.
  await admin.query('DELETE FROM shared.event_outbox');
});

afterAll(async () => {
  await worker.end();
  await runtime.end();
  await readonly.end();
  await cleanFixtures(admin);
  await admin.end();
});

describe('shared.event_outbox — worker boundary and envelope integrity', () => {
  it('inserts through the worker and rejects duplicate tenant event keys (23505)', async () => {
    const id = await insertEvent('evt.duplicate');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    await expectSqlState(insertEvent('evt.duplicate'), '23505');
  });

  it('rejects schema_version and aggregate_version below 1 (23514)', async () => {
    await expectSqlState(insertEvent('evt.schema-version-zero', 0, 1), '23514');
    await expectSqlState(insertEvent('evt.aggregate-version-zero', 1, 0), '23514');
  });

  it('denies runtime and readonly SELECT, runtime EXECUTE, and worker DELETE (42501)', async () => {
    await insertEvent('evt.denials');
    await expectSqlState(runtime.query('SELECT * FROM shared.event_outbox'), '42501');
    await expectSqlState(readonly.query('SELECT * FROM shared.event_outbox'), '42501');
    await expectSqlState(
      runtime.query(`SELECT * FROM shared.claim_outbox_events('runtime-1', 1)`),
      '42501'
    );
    await expectSqlState(worker.query('DELETE FROM shared.event_outbox'), '42501');
  });

  it.each(['claimed', 'published'])(
    'rejects a direct worker INSERT in terminal/noninitial state %s (23514)',
    async (status) => {
      const stamps =
        status === 'claimed'
          ? `status, claimed_at, claimed_by, attempt_count`
          : `status, published_at`;
      const values =
        status === 'claimed' ? `'claimed', now(), 'worker-direct', 1` : `'published', now()`;
      await expectSqlState(
        worker.query(
          `INSERT INTO shared.event_outbox (
             tenant_id, event_key, event_type, aggregate_type, aggregate_id,
             schema_version, aggregate_version, producer, occurred_at,
             created_by, ${stamps}
           ) VALUES ($1, $2, 'work_order.created', 'work_order', $3,
                     1, 1, 'backend.orders', now(), $4, ${values})`,
          [TENANT_A, `evt.direct.${status}`, AGGREGATE_ID, USER_A]
        ),
        '23514'
      );
    }
  );

  it('lets CHECK constraints reject a raw claimed UPDATE without claim stamps (23514)', async () => {
    const id = await insertEvent('evt.raw-claimed');
    await expectSqlState(
      worker.query(`UPDATE shared.event_outbox SET status = 'claimed' WHERE id = $1`, [id]),
      '23514'
    );
  });
});

describe('shared event-outbox worker lifecycle', () => {
  it('claims a due event and stamps claimant/time while incrementing attempt_count', async () => {
    const id = await insertEvent('evt.claim');
    const { rows } = await worker.query(`SELECT * FROM shared.claim_outbox_events('worker-a', 1)`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id,
      status: 'claimed',
      claimed_by: 'worker-a',
      attempt_count: 1,
    });
    expect(rows[0].claimed_at).toBeInstanceOf(Date);
  });

  it('two parallel worker connections claim disjoint sets whose union is all N rows', async () => {
    const n = 8;
    const ids = await Promise.all(
      Array.from({ length: n }, (_, i) => insertEvent(`evt.parallel.${i}`))
    );
    const c1 = await worker.connect();
    const c2 = await worker.connect();
    try {
      for (const client of [c1, c2]) {
        await client.query(`SET statement_timeout = '5s'`);
        await client.query(`SET lock_timeout = '2s'`);
      }
      const [a, b] = await Promise.all([
        c1.query(`SELECT id FROM shared.claim_outbox_events('worker-parallel-a', $1)`, [n / 2]),
        c2.query(`SELECT id FROM shared.claim_outbox_events('worker-parallel-b', $1)`, [n / 2]),
      ]);
      const aIds = a.rows.map((row) => row.id as string);
      const bIds = b.rows.map((row) => row.id as string);
      expect(aIds).toHaveLength(n / 2);
      expect(bIds).toHaveLength(n / 2);
      expect(aIds.filter((id) => bIds.includes(id))).toEqual([]);
      expect([...aIds, ...bIds].sort()).toEqual([...ids].sort());
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('reclaims a stale lease for a different claimant and increments the attempt again', async () => {
    const id = await insertEvent('evt.stale');
    await worker.query(`SELECT * FROM shared.claim_outbox_events('worker-stale-a', 1)`);
    await worker.query(
      `UPDATE shared.event_outbox SET claimed_at = now() - interval '10 minutes' WHERE id = $1`,
      [id]
    );
    const { rows } = await worker.query(
      `SELECT * FROM shared.claim_outbox_events('worker-stale-b', 1, interval '5 minutes')`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, claimed_by: 'worker-stale-b', attempt_count: 2 });
  });

  it('raises when the wrong claimant completes an event', async () => {
    const id = await insertEvent('evt.wrong-complete');
    await worker.query(`SELECT * FROM shared.claim_outbox_events('worker-owner', 1)`);
    await expect(
      worker.query(`SELECT shared.complete_outbox_event($1, 'worker-other')`, [id])
    ).rejects.toThrow(/not claimed/);
  });

  it('raises when the wrong claimant fails an event', async () => {
    const id = await insertEvent('evt.wrong-fail');
    await worker.query(`SELECT * FROM shared.claim_outbox_events('worker-fail-owner', 1)`);
    await expect(
      worker.query(
        `SELECT shared.fail_outbox_event(
           $1, 'worker-fail-other', 'not mine', interval '1 minute', 3
         )`,
        [id]
      )
    ).rejects.toThrow(/not claimed/);
  });

  it('completion persists published_at and clears both claim fields', async () => {
    const id = await insertEvent('evt.complete');
    await worker.query(`SELECT * FROM shared.claim_outbox_events('worker-complete', 1)`);
    await worker.query(`SELECT shared.complete_outbox_event($1, 'worker-complete')`, [id]);
    const { rows } = await worker.query(
      `SELECT status, published_at, claimed_at, claimed_by
       FROM shared.event_outbox WHERE id = $1`,
      [id]
    );
    expect(rows[0].status).toBe('published');
    expect(rows[0].published_at).toBeInstanceOf(Date);
    expect(rows[0].claimed_at).toBeNull();
    expect(rows[0].claimed_by).toBeNull();
  });

  it('failure schedules a future retry, clears claim fields, and is not claimable before due', async () => {
    const id = await insertEvent('evt.retry');
    await worker.query(`SELECT * FROM shared.claim_outbox_events('worker-retry', 1)`);
    await worker.query(
      `SELECT shared.fail_outbox_event($1, 'worker-retry', 'temporary provider failure', interval '1 hour', 3)`,
      [id]
    );
    const { rows } = await worker.query(
      `SELECT status, available_at, claimed_at, claimed_by, last_error
       FROM shared.event_outbox WHERE id = $1`,
      [id]
    );
    expect(rows[0]).toMatchObject({
      status: 'pending',
      claimed_at: null,
      claimed_by: null,
      last_error: 'temporary provider failure',
    });
    expect(rows[0].available_at.getTime()).toBeGreaterThan(Date.now());
    const dueNow = await worker.query(
      `SELECT id FROM shared.claim_outbox_events('worker-too-early', 1)`
    );
    expect(dueNow.rows).toHaveLength(0);
  });

  it('failure at max attempts dead-letters with last_error and clears claim fields', async () => {
    const id = await insertEvent('evt.dead');
    await worker.query(`SELECT * FROM shared.claim_outbox_events('worker-dead', 1)`);
    await worker.query(
      `SELECT shared.fail_outbox_event($1, 'worker-dead', 'permanent failure', interval '0', 1)`,
      [id]
    );
    const { rows } = await worker.query(
      `SELECT status, claimed_at, claimed_by, last_error
       FROM shared.event_outbox WHERE id = $1`,
      [id]
    );
    expect(rows[0]).toEqual({
      status: 'dead_letter',
      claimed_at: null,
      claimed_by: null,
      last_error: 'permanent failure',
    });
  });

  it('never reclaims published or dead-letter rows', async () => {
    const publishedId = await insertEvent('evt.terminal.published');
    await worker.query(`SELECT * FROM shared.claim_outbox_events('worker-published', 1)`);
    await worker.query(`SELECT shared.complete_outbox_event($1, 'worker-published')`, [
      publishedId,
    ]);

    const deadId = await insertEvent('evt.terminal.dead');
    await worker.query(`SELECT * FROM shared.claim_outbox_events('worker-dead-terminal', 1)`);
    await worker.query(
      `SELECT shared.fail_outbox_event($1, 'worker-dead-terminal', 'terminal', interval '0', 1)`,
      [deadId]
    );

    const { rows } = await worker.query(
      `SELECT id FROM shared.claim_outbox_events('worker-after-terminal', 10, interval '1 second')`
    );
    expect(rows).toHaveLength(0);
  });
});
