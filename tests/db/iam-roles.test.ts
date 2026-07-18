/**
 * Phase 1-4 Increment B — iam.permissions / iam.roles / iam.role_permissions
 * (P1-04-DB-005..007, BR-IAM-001 deny precedence).
 *
 * Authorization is by permission, never by role name. Deny precedence is tested
 * here at the PERSISTED-DATA level (the resolution helper arrives in Increment
 * H). Every isolation assertion runs as the NON-OWNER runtime login.
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
  withRolledBackTx,
} from './helpers';

const P_READ = 'e0000000-0000-4000-8000-000000000001';
const P_WRITE = 'e0000000-0000-4000-8000-000000000002';
const ROLE_READER = 'd0000000-0000-4000-8000-000000000001';
const ROLE_WRITER = 'd0000000-0000-4000-8000-000000000002';
const ROLE_DENIER = 'd0000000-0000-4000-8000-000000000003';
const ROLE_SYSTEM = 'd0000000-0000-4000-8000-000000000004';
const ROLE_B = 'd0000000-0000-4000-8000-00000000000b';
const ACTOR = USER_A;

let admin: Pool;
let runtime: Pool;

/** Persisted-data deny-precedence resolution (what iam.has_permission encodes). */
async function granted(
  roleIds: string[],
  permissionId: string,
  tenant = TENANT_A
): Promise<boolean> {
  const { rows } = await admin.query(
    `SELECT
       EXISTS(SELECT 1 FROM iam.role_permissions
              WHERE tenant_id=$1 AND role_id = ANY($2::uuid[]) AND permission_id=$3 AND effect='allow')
       AND NOT EXISTS(SELECT 1 FROM iam.role_permissions
              WHERE tenant_id=$1 AND role_id = ANY($2::uuid[]) AND permission_id=$3 AND effect='deny')
         AS granted`,
    [tenant, roleIds, permissionId]
  );
  return rows[0].granted;
}

async function seed(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.permissions (id, permission_code, domain, description, risk_level, created_by)
     VALUES ($1,'test.thing.read','test','read','low', $3), ($2,'test.thing.write','test','write','high',$3)
     ON CONFLICT (id) DO NOTHING`,
    [P_READ, P_WRITE, ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, is_system, created_by)
     VALUES ($1,$6,'reader','Reader',false,$7),
            ($2,$6,'writer','Writer',false,$7),
            ($3,$6,'denier','Denier',false,$7),
            ($4,$6,'system_role','System',true,$7),
            ($5,$8,'reader_b','Reader B',false,$7)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_READER, ROLE_WRITER, ROLE_DENIER, ROLE_SYSTEM, ROLE_B, TENANT_A, ACTOR, TENANT_B]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     VALUES ($1,$2,$6,'allow',$9),
            ($1,$3,$7,'allow',$9), ($1,$3,$6,'allow',$9),
            ($1,$4,$7,'deny',$9),
            ($5,$8,$6,'allow',$9)
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_READER, ROLE_WRITER, ROLE_DENIER, TENANT_B, P_READ, P_WRITE, ROLE_B, ACTOR]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seed();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('iam.permissions — platform catalog, read-only to app roles', () => {
  it('runtime can read the catalog', async () => {
    const rows = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT permission_code FROM iam.permissions WHERE domain = 'test' ORDER BY 1`)
    );
    expect(rows.rows.map((r) => r.permission_code)).toEqual([
      'test.thing.read',
      'test.thing.write',
    ]);
  });

  it('runtime cannot INSERT, UPDATE, or DELETE a permission', async () => {
    const ctx = { tenantId: TENANT_A, userId: ACTOR };
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.permissions (permission_code, domain, description, created_by)
           VALUES ('test.x.y','test','x',$1)`,
          [ACTOR]
        ),
        '42501'
      )
    );
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.permissions SET description='z' WHERE id=$1`, [P_READ]),
        '42501'
      )
    );
    await withRolledBackTx(runtime, ctx, (c) =>
      expectSqlState(c.query(`DELETE FROM iam.permissions WHERE id=$1`, [P_READ]), '42501')
    );
  });

  it('permission_code is immutable even to admin', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.permissions SET permission_code='test.moved' WHERE id=$1`, [P_READ]),
        '23514'
      )
    );
  });

  it('a mapped permission cannot be deleted (ON DELETE RESTRICT)', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(c.query(`DELETE FROM iam.permissions WHERE id=$1`, [P_READ]), '23503')
    );
  });
});

describe('iam.roles — tenant-scoped, protected', () => {
  it('runtime sees only its own tenant roles', async () => {
    const a = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT role_code FROM iam.roles ORDER BY 1`)
    );
    expect(a.rows.map((r) => r.role_code)).toContain('reader');
    expect(a.rows.map((r) => r.role_code)).not.toContain('reader_b');
  });

  it('runtime cannot create a role (writes are platform-only)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.roles (tenant_id, role_code, name, created_by) VALUES ($1,'x','X',$2)`,
          [TENANT_A, ACTOR]
        ),
        '42501'
      )
    );
  });

  it('role_code, is_system, and tenant_id are immutable', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.roles SET role_code='moved' WHERE id=$1`, [ROLE_READER]),
        '23514'
      )
    );
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.roles SET is_system=true WHERE id=$1`, [ROLE_READER]),
        '23514'
      )
    );
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(`UPDATE iam.roles SET tenant_id=$2 WHERE id=$1`, [ROLE_READER, TENANT_B]),
        '23514'
      )
    );
  });

  it('role_code is unique per tenant among active roles, reusable after soft-delete', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.roles (tenant_id, role_code, name, created_by) VALUES ($1,'reader','Dup',$2)`,
          [TENANT_A, ACTOR]
        ),
        '23505'
      )
    );
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      await c.query(`UPDATE iam.roles SET deleted_at=now() WHERE id=$1`, [ROLE_READER]);
      const r = await c.query(
        `INSERT INTO iam.roles (tenant_id, role_code, name, created_by) VALUES ($1,'reader','Reborn',$2) RETURNING id`,
        [TENANT_A, ACTOR]
      );
      expect(r.rows).toHaveLength(1);
    });
  });
});

describe('iam.role_permissions — mapping integrity and cross-tenant safety', () => {
  it('rejects a duplicate (role, permission) mapping', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
           VALUES ($1,$2,$3,'allow',$4)`,
          [TENANT_A, ROLE_READER, P_READ, ACTOR]
        ),
        '23505'
      )
    );
  });

  it('rejects a mapping whose tenant does not match the role (composite FK)', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
           VALUES ($1,$2,$3,'allow',$4)`,
          [TENANT_B, ROLE_READER, P_READ, ACTOR]
        ),
        '23503'
      )
    );
  });

  it('rejects an invalid effect', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
           VALUES ($1,$2,$3,'maybe',$4)`,
          [TENANT_A, ROLE_SYSTEM, P_READ, ACTOR]
        ),
        '23514'
      )
    );
  });
});

describe('BR-IAM-001 — deny precedence is persisted, not naming', () => {
  it('a single deny overrides every allow for the same permission', async () => {
    // writer allows write; denier denies write. Together → not granted.
    expect(await granted([ROLE_WRITER, ROLE_DENIER], P_WRITE)).toBe(false);
  });

  it('allow with no matching deny grants the permission', async () => {
    expect(await granted([ROLE_READER], P_READ)).toBe(true);
    expect(await granted([ROLE_WRITER], P_WRITE)).toBe(true);
  });

  it('a role name confers nothing without a mapping', async () => {
    // system_role has no mappings at all.
    expect(await granted([ROLE_SYSTEM], P_READ)).toBe(false);
    expect(await granted([ROLE_SYSTEM], P_WRITE)).toBe(false);
  });
});
