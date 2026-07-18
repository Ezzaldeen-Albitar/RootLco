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

// Synthetic credential-shaped values are constructed at RUNTIME from non-matching
// fragments, so no complete AWS-key- or JWT-shaped literal is ever stored in
// source control (it would trip `npm run security:tracked-secrets`, correctly).
// At run time they still match the sanitizer's patterns, so the sanitizer is
// exercised against genuine credential shapes. See
// docs/phase-1/phase-1-5/event-payload-security-rules.md §3.
function buildSyntheticAwsAccessKeyId(): string {
  const providerPrefix = String.fromCharCode(65, 75, 73, 65); // "AKIA"
  return `${providerPrefix}${'F0'.repeat(8)}`; // + 16 chars from [0-9A-Z]
}

function encodeBase64Url(value: object): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function buildSyntheticJwt(): string {
  return [
    encodeBase64Url({ alg: 'HS256', typ: 'JWT' }),
    encodeBase64Url({ sub: 'synthetic-security-test' }),
    Buffer.from('synthetic-test-signature', 'utf8').toString('base64url'),
  ].join('.');
}

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
    ['JWT-shaped value', { diagnostic: buildSyntheticJwt() }],
    [
      'AWS access-key-shaped value',
      { diagnostic: `prefix-${buildSyntheticAwsAccessKeyId()}-suffix` },
    ],
  ])('rejects %s recursively with 23514', async (_label, context) => {
    await expectSqlState(insertError({ context }), '23514');
  });

  it('builds credential shapes at runtime, proves they match, and the sanitizer rejects them without survival', async () => {
    const awsKey = buildSyntheticAwsAccessKeyId();
    const jwt = buildSyntheticJwt();

    // The generated values genuinely carry the shapes the sanitizer hunts,
    // under neutral (non-sensitive) keys so rejection is driven by the VALUE
    // shape, not by a key-name match.
    expect(awsKey).toMatch(/^AKIA[0-9A-Z]{16}$/);
    expect(jwt.split('.')).toHaveLength(3);
    expect(jwt).toMatch(/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

    await expectSqlState(insertError({ context: { diagnostic: awsKey } }), '23514');
    await expectSqlState(insertError({ context: { a: { b: [{ note: jwt }] } } }), '23514');

    // Neither rejected value survives anywhere in stored error metadata.
    const survivors = await worker.query(
      `SELECT count(*)::int AS n FROM shared.error_records
       WHERE strpos(context::text, $1) > 0 OR strpos(context::text, $2) > 0`,
      [awsKey, jwt]
    );
    expect(survivors.rows[0].n).toBe(0);
  });

  it('rejects embedded JWT-shaped substrings recursively but accepts a benign eyJ marker', async () => {
    // A genuine JWT shape embedded in a Bearer prefix (built at runtime — no
    // JWT-dot-dot literal in source), directly and array-nested.
    const bearer = `Bearer ${buildSyntheticJwt()}`;
    await expectSqlState(insertError({ context: { diagnostic: bearer } }), '23514');
    await expectSqlState(
      insertError({ context: { items: [{ diagnostic: ['safe', bearer] }] } }),
      '23514'
    );

    // A benign string that merely starts with the eyJ marker but has no dotted
    // segments is NOT credential-shaped and is accepted.
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
