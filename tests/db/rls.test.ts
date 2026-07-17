/**
 * Row-Level Security proof suite (P1-02-SEC-001/002, P1-02-QA-002/003).
 *
 * EVERY isolation assertion here executes as `rootlco_test_runtime`, a login
 * whose only power is membership in `app_runtime` (no BYPASSRLS, not the
 * table owner). Nothing executed as `postgres` is presented as RLS evidence —
 * in the Supabase local stack `postgres` carries BYPASSRLS, so owner-side
 * results prove nothing about isolation (recorded in the role standard).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  readonlyPool,
  ownerClient,
  ensureTestLogins,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  setContext,
  FIXTURE_SCHEMA,
  OWNER_LOGIN,
  TENANT_A,
  TENANT_B,
  USER_A,
} from './helpers';

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  // Provision one sequence per tenant (admin = provisioning path, not evidence).
  await admin.query(
    `INSERT INTO shared.number_sequences (tenant_id, sequence_code, prefix_template, pad_width, created_by)
     VALUES ($1, 'rls_probe', 'A-', 4, $3), ($2, 'rls_probe', 'B-', 4, $3)`,
    [TENANT_A, TENANT_B, USER_A]
  );
  runtime = runtimePool();
  readonly = readonlyPool();
});

afterAll(async () => {
  await runtime.end();
  await readonly.end();
  await cleanFixtures(admin);
  await admin.end();
});

describe('default deny', () => {
  it('a session with NO context sees zero tenant-owned rows', async () => {
    const { rows } = await runtime.query('SELECT count(*)::int AS n FROM shared.number_sequences');
    expect(rows[0].n).toBe(0);
  });

  it('a session with NO context cannot update anything (0 rows affected)', async () => {
    const result = await runtime.query(
      'UPDATE shared.number_sequences SET next_value = next_value'
    );
    expect(result.rowCount ?? 0).toBe(0);
  });

  it('context is transaction-local: it evaporates at ROLLBACK', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await setContext(client, { tenantId: TENANT_A });
      const inside = await client.query('SELECT count(*)::int AS n FROM shared.number_sequences');
      expect(inside.rows[0].n).toBe(1);
      await client.query('ROLLBACK');
      const outside = await client.query('SELECT count(*)::int AS n FROM shared.number_sequences');
      expect(outside.rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });
});

describe('tenant isolation (Tenant A vs Tenant B)', () => {
  it('Tenant A sees only Tenant A rows', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      const { rows } = await tx.query(
        'SELECT tenant_id, sequence_code FROM shared.number_sequences'
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].tenant_id).toBe(TENANT_A);
    });
  });

  it('Tenant A cannot read Tenant B rows even when addressing them directly', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      const { rows } = await tx.query(
        'SELECT count(*)::int AS n FROM shared.number_sequences WHERE tenant_id = $1',
        [TENANT_B]
      );
      expect(rows[0].n).toBe(0);
    });
  });

  it('Tenant A cannot write Tenant B rows (UPDATE affects 0 rows)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      const result = await tx.query(
        'UPDATE shared.number_sequences SET next_value = 999 WHERE tenant_id = $1',
        [TENANT_B]
      );
      expect(result.rowCount ?? 0).toBe(0);
    });
  });

  it('Tenant A cannot re-point its own row at Tenant B (WITH CHECK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      // tenant_id is not even in the runtime UPDATE column grant; both layers
      // (column grant and WITH CHECK) refuse this.
      await expectSqlState(
        tx.query('UPDATE shared.number_sequences SET tenant_id = $1', [TENANT_B]),
        '42501'
      );
    });
  });
});

describe('the runtime role cannot escape RLS', () => {
  it('cannot INSERT (no grant, no policy — provisioning is admin-only)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO shared.number_sequences (tenant_id, sequence_code, created_by)
           VALUES ($1, 'sneaky', $2)`,
          [TENANT_A, USER_A]
        ),
        '42501'
      );
    });
  });

  it('cannot DELETE (no grant, no policy)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(tx.query('DELETE FROM shared.number_sequences'), '42501');
    });
  });

  it('cannot ALTER TABLE ... DISABLE ROW LEVEL SECURITY (not the owner)', async () => {
    await expectSqlState(
      runtime.query('ALTER TABLE shared.number_sequences DISABLE ROW LEVEL SECURITY'),
      '42501'
    );
  });

  it('cannot use SET row_security = off to bypass (query errors instead)', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL row_security = off');
      await setContext(client, { tenantId: TENANT_A });
      await expectSqlState(client.query('SELECT count(*) FROM shared.number_sequences'), '42501');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('cannot create objects in module schemas (USAGE only, no CREATE)', async () => {
    await expectSqlState(runtime.query('CREATE TABLE shared.evil (id int)'), '42501');
  });
});

describe('function privileges are explicit, not PUBLIC defaults', () => {
  it('an unprivileged login cannot execute the allocator (PUBLIC EXECUTE revoked)', async () => {
    // rootlco_test_owner holds NO archetype membership. Before the REVOKE
    // ... FROM PUBLIC hardening, PostgreSQL's default would have let ANY role
    // call shared.next_display_number(); now it is an app_runtime capability.
    const owner = ownerClient();
    await owner.connect();
    try {
      await owner.query('BEGIN');
      await setContext(owner, { tenantId: TENANT_A });
      await expectSqlState(
        owner.query('SELECT * FROM shared.next_display_number($1)', ['rls_probe']),
        '42501' // permission denied for function
      );
      await owner.query('ROLLBACK');
    } finally {
      await owner.end();
    }
  });

  it('app_readonly cannot execute the allocator either', async () => {
    await withRolledBackTx(readonly, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query('SELECT * FROM shared.next_display_number($1)', ['rls_probe']),
        '42501'
      );
    });
  });
});

describe('read-only archetype', () => {
  it('app_readonly member can read its tenant rows', async () => {
    await withRolledBackTx(readonly, { tenantId: TENANT_A }, async (tx) => {
      const { rows } = await tx.query('SELECT count(*)::int AS n FROM shared.number_sequences');
      expect(rows[0].n).toBe(1);
    });
  });

  it('app_readonly member cannot UPDATE (no grant, no policy)', async () => {
    await withRolledBackTx(readonly, { tenantId: TENANT_A }, async (tx) => {
      await expectSqlState(
        tx.query('UPDATE shared.number_sequences SET next_value = next_value + 1'),
        '42501'
      );
    });
  });
});

describe('FORCE ROW LEVEL SECURITY (owner without BYPASSRLS)', () => {
  it('denies even the table owner when no policy exists', async () => {
    // Build a fixture table OWNED by a plain role, force RLS, and show the
    // owner itself is locked out. This is the honest demonstration: it does
    // not rely on `postgres` (which has BYPASSRLS and proves nothing).
    await admin.query(`CREATE SCHEMA IF NOT EXISTS ${FIXTURE_SCHEMA}`);
    await admin.query(`GRANT USAGE, CREATE ON SCHEMA ${FIXTURE_SCHEMA} TO ${OWNER_LOGIN}`);

    const owner = ownerClient();
    await owner.connect();
    try {
      await owner.query(`
        CREATE TABLE ${FIXTURE_SCHEMA}.force_rls_demo (
          id int PRIMARY KEY,
          tenant_id uuid NOT NULL
        )
      `);
      await owner.query(`INSERT INTO ${FIXTURE_SCHEMA}.force_rls_demo VALUES (1, $1)`, [TENANT_A]);
      await owner.query(`ALTER TABLE ${FIXTURE_SCHEMA}.force_rls_demo ENABLE ROW LEVEL SECURITY`);
      await owner.query(`ALTER TABLE ${FIXTURE_SCHEMA}.force_rls_demo FORCE ROW LEVEL SECURITY`);

      // SELECT: default deny returns nothing, even to the owner.
      const { rows } = await owner.query(
        `SELECT count(*)::int AS n FROM ${FIXTURE_SCHEMA}.force_rls_demo`
      );
      expect(rows[0].n).toBe(0);

      // INSERT: default deny raises for the owner too.
      await expectSqlState(
        owner.query(`INSERT INTO ${FIXTURE_SCHEMA}.force_rls_demo VALUES (2, $1)`, [TENANT_A]),
        '42501'
      );
    } finally {
      await owner.end();
    }
  });

  it('honest limit: an owner can still ALTER its own table — FORCE RLS guards against accidental owner queries, not a hostile owner', async () => {
    const owner = ownerClient();
    await owner.connect();
    try {
      // This is why runtime roles must never OWN tables (role standard): the
      // protection an owner can switch off is not a protection against the owner.
      await owner.query(`ALTER TABLE ${FIXTURE_SCHEMA}.force_rls_demo NO FORCE ROW LEVEL SECURITY`);
      const { rows } = await owner.query(
        `SELECT count(*)::int AS n FROM ${FIXTURE_SCHEMA}.force_rls_demo`
      );
      expect(rows[0].n).toBe(1);
    } finally {
      await owner.end();
    }
  });
});
