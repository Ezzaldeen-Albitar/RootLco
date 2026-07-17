/**
 * Phase 1-4 Increment F — audit subsystem (P1-04-DB-014..017, 022).
 *
 * iam.audit_append is the sole writer; the per-tenant SHA-256 chain
 * (iam.audit_integrity_links) makes any later alteration or deletion of a
 * committed record detectable via iam.audit_verify_chain. Restricted/secret
 * detail values are masked. Audit tables are platform-only in this increment.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  TENANT_A,
  USER_A,
  withRolledBackTx,
} from './helpers';

const ACTOR = USER_A;
const ENTITY = 'eeee0000-0000-4000-8000-000000000001';

let admin: Pool;
let runtime: Pool;

async function append(
  details: Array<Record<string, unknown>> = [],
  opts: { actorKind?: string; action?: string } = {}
): Promise<string> {
  const r = await admin.query(
    `SELECT iam.audit_append($1,$2,$3,$4,'iam.test',$5,NULL,NULL,NULL,NULL,$6::jsonb) AS id`,
    [
      TENANT_A,
      ACTOR,
      opts.actorKind ?? 'user',
      opts.action ?? 'create',
      ENTITY,
      JSON.stringify(details),
    ]
  );
  return r.rows[0].id;
}

async function verify(): Promise<{ ok: boolean; first_bad_seq?: number; reason?: string }> {
  const r = await admin.query(`SELECT iam.audit_verify_chain($1) AS v`, [TENANT_A]);
  return r.rows[0].v;
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
});

beforeEach(async () => {
  await admin.query(`DELETE FROM iam.audit_records WHERE tenant_id = $1`, [TENANT_A]);
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('iam.audit_append — record + details + link, one transaction', () => {
  it('writes a record, its details, and a genesis-anchored link; chain verifies', async () => {
    const id = await append([{ field: 'name', old: null, new: 'X', class: 'internal' }]);
    const rec = await admin.query(`SELECT seq, action FROM iam.audit_records WHERE id=$1`, [id]);
    expect(rec.rows[0]).toMatchObject({ seq: '1', action: 'create' });
    const det = await admin.query(
      `SELECT count(*)::int AS n FROM iam.audit_record_details WHERE audit_record_id=$1`,
      [id]
    );
    expect(det.rows[0].n).toBe(1);
    const link = await admin.query(
      `SELECT seq, prev_hash = decode(repeat('00',32),'hex') AS genesis, octet_length(record_hash) AS hl
       FROM iam.audit_integrity_links WHERE audit_record_id=$1`,
      [id]
    );
    expect(link.rows[0]).toMatchObject({ seq: '1', genesis: true, hl: 32 });
    expect((await verify()).ok).toBe(true);
  });

  it('masks restricted/secret detail values (raw never stored)', async () => {
    const id = await append([
      { field: 'salary', old: '1000', new: '2000', class: 'restricted' },
      { field: 'note', old: 'a', new: 'b', class: 'internal' },
    ]);
    const rows = await admin.query(
      `SELECT field_name, old_value_masked, new_value_masked FROM iam.audit_record_details
       WHERE audit_record_id=$1 ORDER BY field_name`,
      [id]
    );
    const salary = rows.rows.find((r) => r.field_name === 'salary');
    expect(salary.old_value_masked).toBe('***');
    expect(salary.new_value_masked).toBe('***');
    const note = rows.rows.find((r) => r.field_name === 'note');
    expect(note.new_value_masked).toBe('b'); // internal kept
  });

  it('chains consecutive records (each prev_hash equals the prior record_hash)', async () => {
    await append();
    await append();
    await append();
    const links = await admin.query(
      `SELECT seq, prev_hash, record_hash FROM iam.audit_integrity_links
       WHERE tenant_id=$1 ORDER BY seq`,
      [TENANT_A]
    );
    expect(links.rows.map((r) => Number(r.seq))).toEqual([1, 2, 3]);
    expect(links.rows[1].prev_hash).toEqual(links.rows[0].record_hash);
    expect(links.rows[2].prev_hash).toEqual(links.rows[1].record_hash);
    expect((await verify()).ok).toBe(true);
  });

  it('a failing append aborts atomically (nothing persists)', async () => {
    await expectSqlState(append([], { actorKind: 'bogus' }), '23514');
    const n = await admin.query(
      `SELECT count(*)::int AS n FROM iam.audit_records WHERE tenant_id=$1`,
      [TENANT_A]
    );
    expect(n.rows[0].n).toBe(0);
  });

  it('requires a tenant', async () => {
    await expectSqlState(
      admin.query(`SELECT iam.audit_append(NULL,$1,'system','x','iam.test')`, [ACTOR]),
      '23514'
    );
  });
});

describe('iam.audit_verify_chain — tamper and gap detection', () => {
  it('detects an altered record (hash mismatch)', async () => {
    await append();
    await append();
    await append();
    expect((await verify()).ok).toBe(true);
    await admin.query(
      `UPDATE iam.audit_records SET action='TAMPERED' WHERE tenant_id=$1 AND seq=2`,
      [TENANT_A]
    );
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('hash_mismatch');
    expect(v.first_bad_seq).toBe(2);
  });

  it('detects a tampered detail value', async () => {
    const id = await append([{ field: 'x', old: '1', new: '2', class: 'internal' }]);
    await append();
    expect((await verify()).ok).toBe(true);
    await admin.query(
      `UPDATE iam.audit_record_details SET new_value_masked='9' WHERE audit_record_id=$1`,
      [id]
    );
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('hash_mismatch');
    expect(v.first_bad_seq).toBe(1);
  });

  it('detects a missing record (seq gap)', async () => {
    await append();
    await append();
    await append();
    await admin.query(`DELETE FROM iam.audit_records WHERE tenant_id=$1 AND seq=2`, [TENANT_A]);
    const v = await verify();
    expect(v.ok).toBe(false);
    expect(v.reason).toBe('gap');
    expect(v.first_bad_seq).toBe(2);
  });
});

describe('iam.audit_append — concurrency cannot fork the chain', () => {
  it('10 concurrent appends produce unique consecutive seq and a valid chain', async () => {
    await Promise.all(
      Array.from({ length: 10 }, () =>
        admin.query(`SELECT iam.audit_append($1,$2,'system','concurrent','iam.test')`, [
          TENANT_A,
          ACTOR,
        ])
      )
    );
    const seqs = await admin.query(
      `SELECT seq FROM iam.audit_records WHERE tenant_id=$1 ORDER BY seq`,
      [TENANT_A]
    );
    expect(seqs.rows.map((r) => Number(r.seq))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await verify()).ok).toBe(true);
  });
});

describe('audit tables — platform-only (no runtime access in this increment)', () => {
  it('runtime cannot read, write, or append audit rows', async () => {
    await append();
    const ctx = { tenantId: TENANT_A, userId: ACTOR };
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(c.query(`SELECT * FROM iam.audit_records`), '42501')
    );
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(
        c.query(`DELETE FROM iam.audit_records WHERE tenant_id=$1`, [TENANT_A]),
        '42501'
      )
    );
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.audit_integrity_links SET record_hash=decode(repeat('00',32),'hex')`),
        '42501'
      )
    );
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(
        c.query(`SELECT iam.audit_append($1,$2,'user','x','iam.test')`, [TENANT_A, ACTOR]),
        '42501'
      )
    );
  });
});

describe('iam.security_events — payload-free platform log', () => {
  it('accepts tenant and platform (null-tenant) events; runtime cannot read', async () => {
    await admin.query(
      `INSERT INTO iam.security_events (tenant_id, event_type, severity) VALUES ($1,'brute_force','warning'), (NULL,'platform_probe','info')`,
      [TENANT_A]
    );
    try {
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
        expectSqlState(c.query(`SELECT * FROM iam.security_events`), '42501')
      );
    } finally {
      await admin.query(
        `DELETE FROM iam.security_events WHERE event_type IN ('brute_force','platform_probe')`
      );
    }
  });
});
