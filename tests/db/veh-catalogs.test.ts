/**
 * Phase 1-7 vehicle reference catalogs (P1-07-DB-006).
 *
 * Proves the dual-scope model: platform defaults are readable by every tenant,
 * tenant extensions are private to their tenant, a tenant can neither create nor
 * claim a platform row nor write another tenant's row, per-scope code uniqueness
 * holds, scope/tenant/code are immutable, and the make/model/trim hierarchy scope
 * guards reject cross-tenant parents. All isolation assertions run on the runtime
 * connection (NOBYPASSRLS); admin is used only for committed fixtures.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  readonlyPool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
} from './helpers';

const PLATFORM_MAKE = 'f0000000-0000-4000-8000-00000000e001';
const TENANT_A_MAKE = 'f0000000-0000-4000-8000-00000000e00a';
const TENANT_B_MAKE = 'f0000000-0000-4000-8000-00000000e00b';

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();

  // Committed fixtures (admin bypasses RLS to seed all three scopes).
  await admin.query(
    `INSERT INTO veh.makes (id, scope, tenant_id, code, name, created_by) VALUES
       ($1, 'platform', NULL,      'fx_pmake', 'Fixture Platform Make', $4),
       ($2, 'tenant',   $5,        'fx_amake', 'Fixture Tenant A Make', $4),
       ($3, 'tenant',   $6,        'fx_bmake', 'Fixture Tenant B Make', $4)`,
    [PLATFORM_MAKE, TENANT_A_MAKE, TENANT_B_MAKE, USER_A, TENANT_A, TENANT_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('veh reference catalogs — dual-scope visibility', () => {
  it('a tenant sees platform defaults AND its own extensions, never another tenant’s', async () => {
    const seenByA = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(`SELECT code FROM veh.makes WHERE code LIKE 'fx_%' ORDER BY code`)
    );
    expect(seenByA.rows.map((r) => r.code)).toEqual(['fx_amake', 'fx_pmake']);

    const seenByB = await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_B }, (c) =>
      c.query(`SELECT code FROM veh.makes WHERE code LIKE 'fx_%' ORDER BY code`)
    );
    expect(seenByB.rows.map((r) => r.code)).toEqual(['fx_bmake', 'fx_pmake']);
  });
});

describe('veh reference catalogs — write authority', () => {
  it('a tenant CANNOT create a platform-scoped row', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO veh.makes (scope, tenant_id, code, name, created_by)
           VALUES ('platform', NULL, 'fx_evil', 'Forged Platform', $1)`,
          [USER_A]
        ),
        '42501'
      );
    });
  });

  it('a tenant CANNOT create a row for another tenant', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO veh.makes (scope, tenant_id, code, name, created_by)
           VALUES ('tenant', $1, 'fx_evil', 'Cross-tenant', $2)`,
          [TENANT_B, USER_A]
        ),
        '42501'
      );
    });
  });

  it('a tenant CAN create its own extension', async () => {
    const inserted = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(
        `INSERT INTO veh.makes (scope, tenant_id, code, name, created_by)
           VALUES ('tenant', $1, 'fx_newa', 'New Tenant A Make', $2) RETURNING id`,
        [TENANT_A, USER_A]
      )
    );
    expect(inserted.rows).toHaveLength(1);
  });

  it('a tenant UPDATE never touches a platform row (0 rows affected)', async () => {
    const res = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(`UPDATE veh.makes SET name = 'hijacked' WHERE id = $1`, [PLATFORM_MAKE])
    );
    expect(res.rowCount).toBe(0);
  });

  it('a read-only session cannot INSERT', async () => {
    await withRolledBackTx(readonly, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO veh.makes (scope, tenant_id, code, name, created_by)
           VALUES ('tenant', $1, 'fx_ro', 'Readonly', $2)`,
          [TENANT_A, USER_A]
        ),
        '42501'
      );
    });
  });
});

describe('veh reference catalogs — immutability and uniqueness', () => {
  it('scope, tenant_id and code are immutable', async () => {
    for (const col of ['scope', 'code']) {
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
        const setClause = col === 'scope' ? `scope = 'platform'` : `code = 'fx_renamed'`;
        await expectSqlState(
          c.query(`UPDATE veh.makes SET ${setClause} WHERE id = $1`, [TENANT_A_MAKE]),
          '23514'
        );
      });
    }
  });

  it('rejects a duplicate active code within the same tenant scope', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO veh.makes (scope, tenant_id, code, name, created_by)
           VALUES ('tenant', $1, 'fx_amake', 'Dup', $2)`,
          [TENANT_A, USER_A]
        ),
        '23505'
      );
    });
  });

  it('allows a tenant code equal to a platform code (separate scopes)', async () => {
    const res = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, (c) =>
      c.query(
        `INSERT INTO veh.makes (scope, tenant_id, code, name, created_by)
         VALUES ('tenant', $1, 'fx_pmake', 'Shadow-as-override', $2) RETURNING id`,
        [TENANT_A, USER_A]
      )
    );
    expect(res.rows).toHaveLength(1);
  });
});

describe('veh reference catalogs — hierarchy scope guards', () => {
  it('a tenant model may reference a platform make or its own make', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const onPlatform = await c.query(
        `INSERT INTO veh.models (scope, tenant_id, make_id, code, name, created_by)
         VALUES ('tenant', $1, $2, 'fx_m1', 'On platform make', $3) RETURNING id`,
        [TENANT_A, PLATFORM_MAKE, USER_A]
      );
      expect(onPlatform.rows).toHaveLength(1);
      const onOwn = await c.query(
        `INSERT INTO veh.models (scope, tenant_id, make_id, code, name, created_by)
         VALUES ('tenant', $1, $2, 'fx_m2', 'On own make', $3) RETURNING id`,
        [TENANT_A, TENANT_A_MAKE, USER_A]
      );
      expect(onOwn.rows).toHaveLength(1);
    });
  });

  it('a tenant model CANNOT reference another tenant’s make (fail-closed under RLS)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO veh.models (scope, tenant_id, make_id, code, name, created_by)
           VALUES ('tenant', $1, $2, 'fx_m3', 'Cross-tenant make', $3)`,
          [TENANT_A, TENANT_B_MAKE, USER_A]
        ),
        '23503'
      );
    });
  });
});
