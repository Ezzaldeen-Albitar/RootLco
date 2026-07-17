/**
 * Reusable pattern proofs: append-only status history and the idempotency-key
 * storage pattern (P1-02-DB-008, P1-02-DB-013).
 *
 * Both are DOCUMENTED patterns whose behaviour is proven here against
 * disposable fixtures. The permanent shared.idempotency_keys table is
 * deliberately NOT created in Phase 1-2 (no business operation exists to be
 * idempotent yet); the fixture pins the semantics later phases must implement.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  cleanFixtures,
  withRolledBackTx,
  withCommittedTx,
  expectSqlState,
  FIXTURE_SCHEMA,
  TENANT_A,
  TENANT_B,
  USER_A,
} from './helpers';

let admin: Pool;
let runtime: Pool;
const S = FIXTURE_SCHEMA;
const ENTITY = 'e0000000-0000-4000-8000-00000000000e';

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await admin.query(`CREATE SCHEMA ${S}`);

  // ---- Status-history template (append-only, same-transaction discipline) --
  await admin.query(`
    CREATE TABLE ${S}.entity_status_history (
      id             uuid        NOT NULL DEFAULT gen_random_uuid(),
      tenant_id      uuid        NOT NULL,
      entity_id      uuid        NOT NULL,
      from_state     text        NULL,
      to_state       text        NOT NULL,
      reason         text        NULL,
      actor_id       uuid        NOT NULL,
      occurred_at    timestamptz NOT NULL DEFAULT now(),
      correlation_id uuid        NULL,
      CONSTRAINT pk_entity_status_history PRIMARY KEY (id),
      CONSTRAINT ck_entity_status_history_state_change
        CHECK (from_state IS DISTINCT FROM to_state)
    )
  `);
  await admin.query(`ALTER TABLE ${S}.entity_status_history ENABLE ROW LEVEL SECURITY`);
  await admin.query(`ALTER TABLE ${S}.entity_status_history FORCE ROW LEVEL SECURITY`);
  await admin.query(`
    CREATE POLICY sel_entity_status_history_tenant ON ${S}.entity_status_history
      FOR SELECT TO app_runtime USING (tenant_id = iam.current_tenant_id())
  `);
  await admin.query(`
    CREATE POLICY ins_entity_status_history_tenant ON ${S}.entity_status_history
      FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id())
  `);
  // Append-only runtime grants: INSERT + SELECT. No UPDATE, no DELETE — and no
  // policy for them either (two independent layers both deny).
  await admin.query(`GRANT USAGE ON SCHEMA ${S} TO app_runtime`);
  await admin.query(`GRANT SELECT, INSERT ON ${S}.entity_status_history TO app_runtime`);

  // ---- Idempotency-key template ------------------------------------------
  await admin.query(`
    CREATE TABLE ${S}.idempotency_keys (
      id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
      tenant_id           uuid        NOT NULL,
      idempotency_key     text        NOT NULL,
      request_fingerprint text        NOT NULL,
      operation_name      text        NOT NULL,
      status              text        NOT NULL DEFAULT 'in_progress',
      response_snapshot   jsonb       NULL,
      created_at          timestamptz NOT NULL DEFAULT now(),
      expires_at          timestamptz NOT NULL,
      completed_at        timestamptz NULL,
      CONSTRAINT pk_idempotency_keys PRIMARY KEY (id),
      CONSTRAINT uq_idempotency_keys_tenant_key UNIQUE (tenant_id, idempotency_key),
      CONSTRAINT ck_idempotency_keys_status
        CHECK (status IN ('in_progress', 'completed', 'failed'))
    )
  `);
});

afterAll(async () => {
  await runtime?.end();
  await cleanFixtures(admin);
  await admin.end();
});

describe('append-only status history (as the runtime role)', () => {
  beforeAll(() => {
    runtime = runtimePool();
  });

  it('accepts an INSERT with the entity change in the same transaction', async () => {
    await withCommittedTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const { rowCount } = await tx.query(
        `INSERT INTO ${S}.entity_status_history
           (tenant_id, entity_id, from_state, to_state, reason, actor_id)
         VALUES ($1, $2, 'draft', 'submitted', 'fixture', $3)`,
        [TENANT_A, ENTITY, USER_A]
      );
      expect(rowCount).toBe(1);
    });
  });

  it('rejects a no-op transition (from_state = to_state)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO ${S}.entity_status_history
             (tenant_id, entity_id, from_state, to_state, actor_id)
           VALUES ($1, $2, 'draft', 'draft', $3)`,
          [TENANT_A, ENTITY, USER_A]
        ),
        '23514'
      );
    });
  });

  it('DENIES UPDATE to the runtime role (history is evidence)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query(`UPDATE ${S}.entity_status_history SET reason = 'rewritten'`),
        '42501'
      );
    });
  });

  it('DENIES DELETE to the runtime role', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(tx.query(`DELETE FROM ${S}.entity_status_history`), '42501');
    });
  });

  it('cannot write history into another tenant (WITH CHECK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO ${S}.entity_status_history
             (tenant_id, entity_id, to_state, actor_id)
           VALUES ($1, $2, 'submitted', $3)`,
          [TENANT_B, ENTITY, USER_A]
        ),
        '42501'
      );
    });
  });
});

describe('idempotency-key storage pattern (semantics pinned for later phases)', () => {
  const KEY = 'client-key-001';
  const FINGERPRINT_1 = 'sha256:aaaa';
  const FINGERPRINT_2 = 'sha256:bbbb';

  it('stores the first request and its completed response snapshot', async () => {
    const { rowCount } = await admin.query(
      `INSERT INTO ${S}.idempotency_keys
         (tenant_id, idempotency_key, request_fingerprint, operation_name,
          status, response_snapshot, expires_at, completed_at)
       VALUES ($1, $2, $3, 'create_thing', 'completed', '{"result":"ok"}', now() + interval '24 hours', now())`,
      [TENANT_A, KEY, FINGERPRINT_1]
    );
    expect(rowCount).toBe(1);
  });

  it('same tenant + same key: the unique constraint stops a second execution', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO ${S}.idempotency_keys
           (tenant_id, idempotency_key, request_fingerprint, operation_name, expires_at)
         VALUES ($1, $2, $3, 'create_thing', now() + interval '24 hours')`,
        [TENANT_A, KEY, FINGERPRINT_1]
      ),
      '23505'
    );
  });

  it('same key + same fingerprint: the caller replays the ORIGINAL response', async () => {
    const { rows } = await admin.query(
      `SELECT response_snapshot, request_fingerprint = $3 AS fingerprint_matches
       FROM ${S}.idempotency_keys
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [TENANT_A, KEY, FINGERPRINT_1]
    );
    expect(rows[0].fingerprint_matches).toBe(true);
    expect(rows[0].response_snapshot).toEqual({ result: 'ok' });
  });

  it('same key + DIFFERENT fingerprint: detected as a conflict, never replayed', async () => {
    const { rows } = await admin.query(
      `SELECT request_fingerprint = $3 AS fingerprint_matches
       FROM ${S}.idempotency_keys
       WHERE tenant_id = $1 AND idempotency_key = $2`,
      [TENANT_A, KEY, FINGERPRINT_2]
    );
    // The stored fingerprint does not match → the application layer MUST
    // refuse (HTTP 422/409 semantics), not execute and not replay.
    expect(rows[0].fingerprint_matches).toBe(false);
  });

  it('different tenants may use the same key independently', async () => {
    const { rowCount } = await admin.query(
      `INSERT INTO ${S}.idempotency_keys
         (tenant_id, idempotency_key, request_fingerprint, operation_name, expires_at)
       VALUES ($1, $2, $3, 'create_thing', now() + interval '24 hours')`,
      [TENANT_B, KEY, FINGERPRINT_2]
    );
    expect(rowCount).toBe(1);
  });

  it('expiry is data, and cleanup is a controlled deletion (retention standard)', async () => {
    const { rows } = await admin.query(
      `SELECT count(*)::int AS expired FROM ${S}.idempotency_keys WHERE expires_at < now()`
    );
    expect(rows[0].expired).toBe(0); // nothing in this fixture is expired yet
  });
});
