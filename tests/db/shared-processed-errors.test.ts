/**
 * Phase 1-5 Increment H — processed-event claims and durable error records.
 *
 * Worker-capability evidence runs through rootlco_test_worker (app_worker).
 * Admin is limited to fixture setup/cleanup; runtime/readonly prove denial.
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

const EVENT_ID = 'a7000000-0000-4000-8000-000000000001';
const RESOLVER_ID = 'a0000000-0000-4000-8000-000000000099';

interface ErrorInsert {
  errorCode?: string;
  severity?: string;
  status?: string;
  context?: unknown;
  resolvedAt?: Date | null;
  resolvedBy?: string | null;
}

let admin: Pool;
let worker: Pool;
let runtime: Pool;
let readonly: Pool;

async function insertError(options: ErrorInsert = {}): Promise<string> {
  const {
    errorCode = `fx_error_${crypto.randomUUID().replaceAll('-', '')}`,
    severity = 'error',
    status = 'open',
    context = { message: 'sanitized fixture failure', attempt: 1 },
    resolvedAt = null,
    resolvedBy = null,
  } = options;
  const { rows } = await worker.query(
    `INSERT INTO shared.error_records (
       tenant_id, company_id, branch_id, error_code, source, operation,
       severity, retryable, correlation_id, context, status,
       resolved_at, resolved_by, created_by
     ) VALUES (
       $1, $2, $3, $4, 'worker.dispatch', 'publish integration event',
       $5, true, 'a7000000-0000-4000-8000-000000000002', $6::jsonb, $7,
       $8, $9, $10
     )
     RETURNING id`,
    [
      TENANT_A,
      COMPANY_A1,
      BRANCH_A1,
      errorCode,
      severity,
      JSON.stringify(context),
      status,
      resolvedAt,
      resolvedBy,
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
  await admin.query(`DELETE FROM shared.processed_events WHERE consumer_code LIKE 'fx\\_%'`);
  await admin.query(`DELETE FROM shared.error_records WHERE error_code LIKE 'fx\\_%'`);
});

afterAll(async () => {
  await worker.end();
  await runtime.end();
  await readonly.end();
  await cleanFixtures(admin);
  await admin.end();
});

describe('shared.processed_events — append-only atomic claims', () => {
  it('rejects duplicate (consumer_code, event_id) claims with 23505', async () => {
    const sql = `INSERT INTO shared.processed_events
      (consumer_code, event_id, tenant_id, outcome, metadata, created_by)
      VALUES ('fx_duplicate', $1, $2, 'applied', '{"result":"ok"}', $3)`;
    await worker.query(sql, [EVENT_ID, TENANT_A, USER_A]);
    await expectSqlState(worker.query(sql, [EVENT_ID, TENANT_A, USER_A]), '23505');
  });

  it('allows exactly one of two concurrent atomic claimants to receive a row', async () => {
    const c1 = await worker.connect();
    const c2 = await worker.connect();
    const sql = `INSERT INTO shared.processed_events
      (consumer_code, event_id, tenant_id, outcome, metadata, created_by)
      VALUES ('fx_atomic_claim', $1, NULL, 'applied', '{}', $2)
      ON CONFLICT DO NOTHING
      RETURNING event_id`;
    try {
      const [first, second] = await Promise.all([
        c1.query(sql, [EVENT_ID, USER_A]),
        c2.query(sql, [EVENT_ID, USER_A]),
      ]);
      expect(first.rows.length + second.rows.length).toBe(1);
      expect([first.rows.length, second.rows.length].sort()).toEqual([0, 1]);
    } finally {
      c1.release();
      c2.release();
    }
  });

  it('rejects an outcome outside applied/skipped/failed with 23514', async () => {
    await expectSqlState(
      worker.query(
        `INSERT INTO shared.processed_events
          (consumer_code, event_id, outcome, created_by)
         VALUES ('fx_bad_outcome', gen_random_uuid(), 'retrying', $1)`,
        [USER_A]
      ),
      '23514'
    );
  });
});

describe('shared.error_records — sanitized durable facts and lifecycle', () => {
  it('inserts a valid tenant/company/branch-scoped sanitized error through the worker', async () => {
    const id = await insertError({
      errorCode: 'fx_valid_error',
      context: { message: 'provider timed out', detail: { attempt: 2 }, tags: ['safe'] },
    });
    const { rows } = await worker.query(
      `SELECT tenant_id, company_id, branch_id, status, record_version
       FROM shared.error_records WHERE id = $1`,
      [id]
    );
    expect(rows[0]).toMatchObject({
      tenant_id: TENANT_A,
      company_id: COMPANY_A1,
      branch_id: BRANCH_A1,
      status: 'open',
      record_version: 1,
    });
  });

  it('rejects invalid severity and status values with 23514', async () => {
    await expectSqlState(insertError({ errorCode: 'fx_bad_severity', severity: 'fatal' }), '23514');
    await expectSqlState(insertError({ errorCode: 'fx_bad_status', status: 'closed' }), '23514');
  });

  it.each([
    ['top-level sensitive key', { password: 'redacted' }],
    ['nested sensitive key', { a: { api_key: 'redacted' } }],
    ['array-nested sensitive key', { items: [{ safe: true }, { credential: 'redacted' }] }],
    ['JWT-shaped value', { diagnostic: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature_1' }],
    ['AWS access-key-shaped value', { diagnostic: 'prefix-AKIA1234567890ABCDEF-suffix' }],
  ])('rejects %s recursively with 23514', async (_label, context) => {
    await expectSqlState(insertError({ context }), '23514');
  });

  it('rejects embedded JWT-shaped substrings recursively but accepts a benign eyJ marker', async () => {
    await expectSqlState(insertError({ context: { diagnostic: 'Bearer eyJab.cd.ef' } }), '23514');
    await expectSqlState(
      insertError({ context: { items: [{ diagnostic: ['safe', 'Bearer eyJab.cd.ef'] }] } }),
      '23514'
    );

    const id = await insertError({
      errorCode: 'fx_benign_eyj_marker',
      context: { diagnostic: 'Bearer eyJab without dot segments' },
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepts nested sanitized context', async () => {
    const id = await insertError({
      errorCode: 'fx_sanitized_context',
      context: {
        message: 'request failed after redaction',
        diagnostic: { code: 503, retry: true },
        items: [{ label: 'safe' }],
      },
    });
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('rejects a direct resolved INSERT with 23514', async () => {
    await expectSqlState(
      insertError({
        errorCode: 'fx_direct_resolved',
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: RESOLVER_ID,
      }),
      '23514'
    );
  });

  it('permits open → acknowledged → resolved and server-stamps resolution', async () => {
    const id = await insertError({ errorCode: 'fx_lifecycle' });
    await worker.query(`UPDATE shared.error_records SET status = 'acknowledged' WHERE id = $1`, [
      id,
    ]);
    const { rows } = await worker.query(
      `UPDATE shared.error_records
          SET status = 'resolved', resolved_by = $2
        WHERE id = $1
      RETURNING status, resolved_at, resolved_by, record_version`,
      [id, RESOLVER_ID]
    );
    expect(rows[0].status).toBe('resolved');
    expect(rows[0].resolved_at).toBeInstanceOf(Date);
    expect(rows[0].resolved_by).toBe(RESOLVER_ID);
    expect(rows[0].record_version).toBe(3);
  });

  it('also permits the direct open → resolved path with resolver attribution', async () => {
    const id = await insertError({ errorCode: 'fx_direct_resolution' });
    const { rows } = await worker.query(
      `UPDATE shared.error_records
          SET status = 'resolved', resolved_by = $2
        WHERE id = $1
      RETURNING status, resolved_at, resolved_by`,
      [id, RESOLVER_ID]
    );
    expect(rows[0].status).toBe('resolved');
    expect(rows[0].resolved_at).toBeInstanceOf(Date);
    expect(rows[0].resolved_by).toBe(RESOLVER_ID);
  });

  it('treats resolved as terminal', async () => {
    const id = await insertError({ errorCode: 'fx_terminal' });
    await worker.query(
      `UPDATE shared.error_records SET status = 'resolved', resolved_by = $2 WHERE id = $1`,
      [id, RESOLVER_ID]
    );
    await expectSqlState(
      worker.query(`UPDATE shared.error_records SET status = 'acknowledged' WHERE id = $1`, [id]),
      '23514'
    );
  });

  it('rejects resolving without resolved_by', async () => {
    const id = await insertError({ errorCode: 'fx_missing_resolver' });
    await expectSqlState(
      worker.query(`UPDATE shared.error_records SET status = 'resolved' WHERE id = $1`, [id]),
      '23514'
    );
  });

  it('rejects mutation of recorded identity/context facts', async () => {
    const id = await insertError({ errorCode: 'fx_immutable' });
    await expectSqlState(
      worker.query(`UPDATE shared.error_records SET error_code = 'fx_changed' WHERE id = $1`, [id]),
      '23514'
    );
  });
});

describe('Increment H role boundary', () => {
  it('denies runtime and readonly SELECT on both tables with 42501', async () => {
    for (const pool of [runtime, readonly]) {
      await expectSqlState(pool.query('SELECT * FROM shared.processed_events'), '42501');
      await expectSqlState(pool.query('SELECT * FROM shared.error_records'), '42501');
    }
  });

  it('denies worker DELETE on both tables with 42501', async () => {
    await expectSqlState(worker.query('DELETE FROM shared.processed_events'), '42501');
    await expectSqlState(worker.query('DELETE FROM shared.error_records'), '42501');
  });
});
