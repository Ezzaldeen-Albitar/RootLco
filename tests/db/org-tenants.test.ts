/**
 * Phase 1-3 — org.tenants and org.tenant_status_history (P1-03-DB-001/002,
 * P1-03-QA-001 tenant surface).
 *
 * Every isolation assertion runs as the NON-OWNER runtime login. The admin
 * connection provisions fixtures only and is never RLS evidence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  readonlyPool,
  runtimePool,
  TENANT_A,
  TENANT_B,
  USER_A,
  withRolledBackTx,
} from './helpers';

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  readonly = readonlyPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await readonly.end();
  await admin.end();
});

describe('org.tenants — self-tenant projection (no enumeration)', () => {
  it('a session sees exactly its own tenant row and nothing else', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const all = await c.query('SELECT id, tenant_code FROM org.tenants');
      expect(all.rows).toHaveLength(1);
      expect(all.rows[0].id).toBe(TENANT_A);
    });
  });

  it('addressing another tenant by its known id returns zero rows (ids are not authorization)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_A }, async (c) => {
      const { rows } = await c.query('SELECT id FROM org.tenants WHERE id = $1', [TENANT_A]);
      expect(rows).toHaveLength(0);
    });
  });

  it('a session with NO context sees zero tenants (enumeration structurally denied)', async () => {
    await withRolledBackTx(runtime, {}, async (c) => {
      const { rows } = await c.query('SELECT id FROM org.tenants');
      expect(rows).toHaveLength(0);
    });
  });

  it('the readonly archetype also sees only its own tenant', async () => {
    await withRolledBackTx(readonly, { tenantId: TENANT_A }, async (c) => {
      const { rows } = await c.query('SELECT tenant_code FROM org.tenants');
      expect(rows.map((r) => r.tenant_code)).toEqual(['tenant_a']);
    });
  });
});

describe('org.tenants — platform administration is not an application capability', () => {
  it('runtime cannot INSERT a tenant (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO org.tenants (tenant_code, display_name, default_locale, default_timezone, created_by)
           VALUES ('rogue_tenant', 'Rogue', 'en', 'UTC', $1)`,
          [USER_A]
        ),
        '42501'
      );
    });
  });

  it('runtime without org.settings.manage changes no tenant row', async () => {
    // DBCR-P1-14-001 moved this boundary from the privilege layer to the policy
    // layer: `app_runtime` now holds UPDATE on three settings columns, gated by
    // `upd_tenants_settings` on `org.settings.manage`. USER_A holds no grant, so
    // the policy matches nothing — and a policy denial on UPDATE affects zero
    // rows rather than raising, which is what this asserts.
    const result = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(`UPDATE org.tenants SET display_name = 'renamed' WHERE id = $1`, [TENANT_A])
    );
    expect(result.rowCount).toBe(0);
  });

  it('runtime holds no privilege on any tenant column beyond the three settings columns', async () => {
    // The grant itself is the control for everything else: status, record_version
    // and the identity columns were never granted, so they are refused before any
    // policy is consulted.
    for (const sql of [
      `UPDATE org.tenants SET tenant_code = 'renamed_code' WHERE id = $1`,
      `UPDATE org.tenants SET status = 'suspended' WHERE id = $1`,
      `UPDATE org.tenants SET record_version = 99 WHERE id = $1`,
    ]) {
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
        expectSqlState(c.query(sql, [TENANT_A]), '42501')
      );
    }
  });

  it('runtime cannot DELETE a tenant (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(c.query('DELETE FROM org.tenants WHERE id = $1', [TENANT_A]), '42501');
    });
  });
});

describe('org.tenants — integrity rules', () => {
  it('tenant_code is immutable even for the admin connection (23514)', async () => {
    await expectSqlState(
      admin.query(`UPDATE org.tenants SET tenant_code = 'renamed_code' WHERE id = $1`, [TENANT_A]),
      '23514'
    );
  });

  it('status is constrained to the four lifecycle states (23514)', async () => {
    await expectSqlState(
      admin.query(`UPDATE org.tenants SET status = 'zombie' WHERE id = $1`, [TENANT_A]),
      '23514'
    );
  });

  it('the initial provisioning state is deterministic (column default)', async () => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO org.tenants (tenant_code, display_name, default_locale, default_timezone, created_by)
         VALUES ('fresh_tenant', 'Fresh', 'en', 'UTC', $1)
         RETURNING status`,
        [USER_A]
      );
      expect(rows[0].status).toBe('provisioning');
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });

  it('default_locale and default_timezone must reference approved reference data (23503)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.tenants (tenant_code, display_name, default_locale, default_timezone, created_by)
         VALUES ('bad_locale_tenant', 'Bad', 'xx-YY', 'UTC', $1)`,
        [USER_A]
      ),
      '23503'
    );
  });
});

describe('org.change_tenant_status — atomic transition + append-only history', () => {
  it('a valid transition updates the row AND writes the history row in one transaction', async () => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT org.change_tenant_status($1, 'suspended', 'fixture: pause', $2)`, [
        TENANT_A,
        USER_A,
      ]);
      const t = await client.query('SELECT status FROM org.tenants WHERE id = $1', [TENANT_A]);
      expect(t.rows[0].status).toBe('suspended');
      const h = await client.query(
        `SELECT from_state, to_state, reason, actor_id FROM org.tenant_status_history
         WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
        [TENANT_A]
      );
      expect(h.rows[0]).toMatchObject({
        from_state: 'active',
        to_state: 'suspended',
        reason: 'fixture: pause',
        actor_id: USER_A,
      });
      // Rollback reverts BOTH the status and the history row — one transaction.
      await client.query('ROLLBACK');
      const after = await admin.query('SELECT status FROM org.tenants WHERE id = $1', [TENANT_A]);
      expect(after.rows[0].status).toBe('active');
      const hAfter = await admin.query(
        'SELECT count(*)::int AS n FROM org.tenant_status_history WHERE tenant_id = $1',
        [TENANT_A]
      );
      expect(hAfter.rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it('a transition without a reason is rejected (23514)', async () => {
    await expectSqlState(
      admin.query(`SELECT org.change_tenant_status($1, 'suspended', '   ', $2)`, [
        TENANT_A,
        USER_A,
      ]),
      '23514'
    );
  });

  it('a no-op transition is rejected (23514)', async () => {
    await expectSqlState(
      admin.query(`SELECT org.change_tenant_status($1, 'active', 'no-op', $2)`, [TENANT_A, USER_A]),
      '23514'
    );
  });

  it('closed is terminal: no transition may leave it (23514)', async () => {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT org.change_tenant_status($1, 'closed', 'fixture: close', $2)`, [
        TENANT_A,
        USER_A,
      ]);
      await expectSqlState(
        client.query(`SELECT org.change_tenant_status($1, 'active', 'reopen attempt', $2)`, [
          TENANT_A,
          USER_A,
        ]),
        '23514'
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('runtime cannot execute the transition function (SECURITY INVOKER + no grants → 42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`SELECT org.change_tenant_status($1, 'suspended', 'escalation attempt', $2)`, [
          TENANT_A,
          USER_A,
        ]),
        '42501'
      );
    });
  });
});

describe('org.tenant_status_history — append-only for application roles', () => {
  beforeAll(async () => {
    // A committed history row to read back and to attack.
    await admin.query(
      `SELECT org.change_tenant_status($1, 'suspended', 'fixture: attack row', $2)`,
      [TENANT_B, USER_A]
    );
    await admin.query(`SELECT org.change_tenant_status($1, 'active', 'fixture: restore', $2)`, [
      TENANT_B,
      USER_A,
    ]);
  });

  it('a tenant reads only its own history', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_A }, async (c) => {
      const { rows } = await c.query(
        'SELECT to_state FROM org.tenant_status_history ORDER BY occurred_at'
      );
      expect(rows.map((r) => r.to_state)).toEqual(['suspended', 'active']);
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const { rows } = await c.query('SELECT id FROM org.tenant_status_history');
      expect(rows).toHaveLength(0);
    });
  });

  it('runtime cannot INSERT history directly (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO org.tenant_status_history (tenant_id, from_state, to_state, reason, actor_id)
           VALUES ($1, 'active', 'suspended', 'forged', $2)`,
          [TENANT_B, USER_A]
        ),
        '42501'
      );
    });
  });

  it('runtime cannot UPDATE history (history is evidence — 42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`UPDATE org.tenant_status_history SET reason = 'rewritten'`),
        '42501'
      );
    });
  });

  it('runtime cannot DELETE history (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_A }, async (c) => {
      await expectSqlState(c.query('DELETE FROM org.tenant_status_history'), '42501');
    });
  });

  it('a history row requires a non-blank reason even for admin (23514)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.tenant_status_history (tenant_id, from_state, to_state, reason, actor_id)
         VALUES ($1, 'active', 'suspended', '  ', $2)`,
        [TENANT_B, USER_A]
      ),
      '23514'
    );
  });
});
