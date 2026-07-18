/**
 * Phase 1-4 Increment G — shared.status_history / shared.status_evidence and
 * the REUSE of shared.idempotency_keys (P1-04-DB-018..019).
 *
 * Status history is append-only and server-stamped. Idempotency is NOT
 * re-implemented — the existing shared.idempotency_keys is reused for IAM
 * operations. Isolation runs as the non-owner runtime login.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  TENANT_A,
  TENANT_B,
  USER_A,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

const ACTOR = USER_A;
const OTHER = 'c0000000-0000-4000-8000-0000000000ff';
const ENTITY = 'f1000000-0000-4000-8000-000000000001';
const HIST_A = 'f0000000-0000-4000-8000-000000000001';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await withCommittedTx(admin, { userId: ACTOR }, (c) =>
    c.query(
      `INSERT INTO shared.status_history (id, tenant_id, entity_type, entity_id, from_state, to_state, reason, actor_id)
       VALUES ($1,$2,'iam.role',$3,'draft','active','activate',$4)`,
      [HIST_A, TENANT_A, ENTITY, ACTOR]
    )
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('shared.status_history — append-only, server-stamped', () => {
  it('server-stamps actor and time; a forged actor is overwritten', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      const r = await c.query(
        `INSERT INTO shared.status_history (tenant_id, entity_type, entity_id, to_state, reason, actor_id)
         VALUES ($1,'iam.role',$2,'suspended','x',$3) RETURNING actor_id`,
        [TENANT_A, ENTITY, OTHER]
      );
      expect(r.rows[0].actor_id).toBe(ACTOR); // forged OTHER overwritten
    });
  });

  it('requires an actor in the session context', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.status_history (tenant_id, entity_type, entity_id, to_state, reason, actor_id)
           VALUES ($1,'iam.role',$2,'x','y',$3)`,
          [TENANT_A, ENTITY, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('rejects a no-op transition (from = to)', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.status_history (tenant_id, entity_type, entity_id, from_state, to_state, reason, actor_id)
           VALUES ($1,'iam.role',$2,'active','active','x',$3)`,
          [TENANT_A, ENTITY, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('a runtime session reads only its own tenant history and cannot write', async () => {
    const a = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.status_history WHERE id=$1`, [HIST_A])
    );
    expect(a.rows).toHaveLength(1);
    const b = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.status_history WHERE id=$1`, [HIST_A])
    );
    expect(b.rows).toHaveLength(0);
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.status_history (tenant_id, entity_type, entity_id, to_state, reason, actor_id)
           VALUES ($1,'iam.role',$2,'x','y',$3)`,
          [TENANT_A, ENTITY, ACTOR]
        ),
        '42501'
      )
    );
  });
});

describe('shared.status_evidence — placeholder reference, no Phase-1-5 FK', () => {
  it('accepts a placeholder evidence reference for a history row', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      const r = await c.query(
        `INSERT INTO shared.status_evidence (tenant_id, status_history_id, evidence_type, evidence_ref, created_by)
         VALUES ($1,$2,'document','DOC-REF-PLACEHOLDER',$3) RETURNING id`,
        [TENANT_A, HIST_A, ACTOR]
      );
      expect(r.rows).toHaveLength(1);
    });
  });

  it('has no foreign key to any document/Phase-1-5 table', async () => {
    const { rows } = await admin.query(
      `SELECT ccu.table_schema || '.' || ccu.table_name AS ref
       FROM information_schema.table_constraints tc
       JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema='shared' AND tc.table_name='status_evidence' AND tc.constraint_type='FOREIGN KEY'`
    );
    // only the status_history parent is referenced — nothing in crm/veh or a documents table
    expect(new Set(rows.map((r) => r.ref))).toEqual(new Set(['shared.status_history']));
  });

  it('rejects evidence whose tenant does not match the history (composite FK)', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.status_evidence (tenant_id, status_history_id, evidence_type, evidence_ref, created_by)
           VALUES ($1,$2,'document','X',$3)`,
          [TENANT_B, HIST_A, ACTOR]
        ),
        '23503'
      )
    );
  });
});

describe('shared.idempotency_keys — reused for IAM, not duplicated (P1-04-DB-019)', () => {
  it('exactly one idempotency table exists in the whole database', async () => {
    const { rows } = await admin.query(
      `SELECT table_schema || '.' || table_name AS fq FROM information_schema.tables
       WHERE table_type='BASE TABLE' AND table_name ~* 'idempotenc' ORDER BY 1`
    );
    expect(rows.map((r) => r.fq)).toEqual(['shared.idempotency_keys']);
  });

  it('scopes an IAM operation and rejects a duplicate key', async () => {
    const key = 'iam-op-key-0001';
    try {
      await admin.query(
        `INSERT INTO shared.idempotency_keys (tenant_id, operation, idempotency_key, request_fingerprint, response_document, created_by)
         VALUES ($1,'iam_provision_user',$2,'fp1','{}'::jsonb,$3)`,
        [TENANT_A, key, ACTOR]
      );
      await expectSqlState(
        admin.query(
          `INSERT INTO shared.idempotency_keys (tenant_id, operation, idempotency_key, request_fingerprint, response_document, created_by)
           VALUES ($1,'iam_provision_user',$2,'fp2','{}'::jsonb,$3)`,
          [TENANT_A, key, ACTOR]
        ),
        '23505'
      );
    } finally {
      await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key=$1`, [key]);
    }
  });

  it('concurrent first-use of the same key yields exactly one winner', async () => {
    const key = 'iam-op-key-race';
    const ins = () =>
      admin.query(
        `INSERT INTO shared.idempotency_keys (tenant_id, operation, idempotency_key, request_fingerprint, response_document, created_by)
         VALUES ($1,'iam_provision_user',$2,'fp','{}'::jsonb,$3)`,
        [TENANT_A, key, ACTOR]
      );
    try {
      const results = await Promise.allSettled([ins(), ins()]);
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const dup = results.filter(
        (r) => r.status === 'rejected' && (r.reason as { code?: string }).code === '23505'
      ).length;
      expect(ok).toBe(1);
      expect(dup).toBe(1);
    } finally {
      await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key=$1`, [key]);
    }
  });
});
