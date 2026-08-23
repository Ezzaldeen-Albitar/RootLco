/**
 * Phase 1-4 Increment J — structural IAM permission catalog and ephemeral
 * baseline-role configuration (P1-04-DB-025).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { adminPool, cleanFixtures, deleteTenantCascade, ensureTestLogins, USER_A } from './helpers';

const SEEDS_DIR = join(__dirname, '..', '..', 'supabase', 'seeds');
const SEED_FILES = ['01_reference_data.sql', '04_iam_permission_catalog.sql'];
const IAM_KEY = 'fx-iam-provision-v1';
const ROLE_CODES = [
  'platform_operator',
  'tenant_administrator',
  'branch_manager',
  'receptionist',
  'technician',
  'cashier',
];

let admin: Pool;
let tenantId: string;

async function runSeeds(): Promise<void> {
  for (const file of SEED_FILES) {
    await admin.query(readFileSync(join(SEEDS_DIR, file), 'utf8'));
  }
}

async function insertBaselineRoles(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.roles (tenant_id, role_code, name, is_system, created_by)
     SELECT $1, valueset.code, valueset.name, true, $2
     FROM (VALUES
       ('platform_operator', 'Platform Operator'),
       ('tenant_administrator', 'Tenant Administrator'),
       ('branch_manager', 'Branch Manager'),
       ('receptionist', 'Receptionist'),
       ('technician', 'Technician'),
       ('cashier', 'Cashier')
     ) AS valueset(code, name)
     WHERE NOT EXISTS (
       SELECT 1 FROM iam.roles role
        WHERE role.tenant_id = $1
          AND role.role_code = valueset.code
          AND role.deleted_at IS NULL
     )`,
    [tenantId, USER_A]
  );

  await admin.query(
    `INSERT INTO iam.role_permissions
       (tenant_id, role_id, permission_id, effect, created_by)
     SELECT role.tenant_id, role.id, permission.id, 'allow', $2
     FROM iam.roles role
     JOIN (VALUES
       ('platform_operator', 'org.tenant.read'),
       ('platform_operator', 'org.subscription.manage'),
       ('platform_operator', 'iam.audit.view'),
       ('tenant_administrator', 'org.company.manage'),
       ('tenant_administrator', 'org.branch.manage'),
       ('tenant_administrator', 'org.department.manage'),
       ('tenant_administrator', 'org.settings.manage'),
       ('tenant_administrator', 'org.tax.manage'),
       ('tenant_administrator', 'iam.user.manage'),
       ('tenant_administrator', 'iam.role.manage'),
       ('tenant_administrator', 'iam.grant.manage'),
       ('tenant_administrator', 'iam.approval.manage'),
       ('tenant_administrator', 'iam.audit.view'),
       ('tenant_administrator', 'iam.session.view_all'),
       ('tenant_administrator', 'iam.login.view_all'),
       ('branch_manager', 'org.branch.read'),
       ('branch_manager', 'org.department.manage'),
       ('branch_manager', 'iam.user.read'),
       ('receptionist', 'org.branch.read'),
       ('receptionist', 'iam.user.read'),
       ('technician', 'org.branch.read'),
       ('cashier', 'org.branch.read'),
       ('cashier', 'iam.approval.manage')
     ) AS mapping(role_code, permission_code)
       ON mapping.role_code = role.role_code
     JOIN iam.permissions permission
       ON permission.permission_code = mapping.permission_code
     WHERE role.tenant_id = $1
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);

  const stale = await admin.query(`SELECT id FROM org.tenants WHERE tenant_code = 'fxprov_iam'`);
  await deleteTenantCascade(
    admin,
    stale.rows.map((row) => row.id)
  );
  await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key = $1`, [IAM_KEY]);

  await runSeeds();
  const spec = {
    actor_id: USER_A,
    tenant: {
      code: 'fxprov_iam',
      display_name: 'Ephemeral IAM Tenant',
      locale: 'en',
      timezone: 'UTC',
    },
    company: {
      code: 'fxprov_iam_main',
      legal_name: 'Ephemeral IAM Company',
      base_currency: 'USD',
    },
    branch: { code: 'main', name: 'Ephemeral IAM Branch', timezone: 'UTC' },
    sequences: [{ code: 'org_document', prefix_template: 'DOC-', pad_width: 6 }],
  };
  const provisioned = await admin.query(
    `SELECT org.provision_organization($1::jsonb, $2) AS result`,
    [JSON.stringify(spec), IAM_KEY]
  );
  tenantId = provisioned.rows[0].result.tenant_id;
  await insertBaselineRoles();
});

afterAll(async () => {
  if (tenantId) await deleteTenantCascade(admin, [tenantId]);
  await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key = $1`, [IAM_KEY]);
  await admin.end();
});

describe('IAM permission catalog seed (P1-04-DB-025)', () => {
  it('seeds the approved org/iam permission catalog with valid risk levels', async () => {
    const { rows } = await admin.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE domain='org')::int AS org,
              count(*) FILTER (WHERE domain='iam')::int AS iam,
              bool_and(risk_level IN ('low','medium','high','critical')) AS risk_ok
       FROM iam.permissions WHERE domain IN ('org','iam')`
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(19);
    expect(rows[0].org).toBeGreaterThanOrEqual(9);
    expect(rows[0].iam).toBeGreaterThanOrEqual(10);
    expect(rows[0].risk_ok).toBe(true);
  });

  it('contains NO wildcard permission code', async () => {
    const { rows } = await admin.query(
      `SELECT permission_code FROM iam.permissions WHERE permission_code ~ '[*%]' OR permission_code LIKE '%.all'`
    );
    expect(rows.filter((row) => /[*%]/.test(row.permission_code))).toEqual([]);
  });
});

describe('ephemeral baseline roles', () => {
  it('creates the six baseline system roles for the ephemeral tenant', async () => {
    const { rows } = await admin.query(
      `SELECT role_code, is_system FROM iam.roles
        WHERE tenant_id = $1
        ORDER BY role_code`,
      [tenantId]
    );
    expect(rows.map((row) => row.role_code)).toEqual([
      'branch_manager',
      'cashier',
      'platform_operator',
      'receptionist',
      'technician',
      'tenant_administrator',
    ]);
    expect(rows.every((row) => row.is_system === true)).toBe(true);
  });

  it('maps tenant_administrator to real catalog permissions (allow, no wildcard)', async () => {
    const { rows } = await admin.query(
      `SELECT permission.permission_code, role_permission.effect
       FROM iam.role_permissions role_permission
       JOIN iam.roles role
         ON role.id = role_permission.role_id
        AND role.tenant_id = role_permission.tenant_id
        AND role.role_code = 'tenant_administrator'
       JOIN iam.permissions permission ON permission.id = role_permission.permission_id
       WHERE role.tenant_id = $1`,
      [tenantId]
    );
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.every((row) => row.effect === 'allow')).toBe(true);
    expect(rows.map((row) => row.permission_code)).toContain('iam.user.manage');
  });

  it('creates no baseline roles for any other tenant', async () => {
    const { rows } = await admin.query(
      `SELECT DISTINCT tenant_id FROM iam.roles
        WHERE role_code = ANY($1::text[])
          AND tenant_id <> $2`,
      [ROLE_CODES, tenantId]
    );
    expect(rows).toEqual([]);
  });

  it('creates no user accounts and no role grants (configuration only)', async () => {
    const users = await admin.query(`SELECT count(*)::int AS n FROM iam.user_accounts`);
    const grants = await admin.query(`SELECT count(*)::int AS n FROM iam.role_grants`);
    expect(users.rows[0].n).toBe(0);
    expect(grants.rows[0].n).toBe(0);
  });
});

describe('fixture idempotence (P1-04-DB-025)', () => {
  it('re-running the catalog and WHERE NOT EXISTS fixtures creates no duplicates', async () => {
    const before = await admin.query(
      `SELECT (SELECT count(*)::int FROM iam.permissions) AS perms,
              (SELECT count(*)::int FROM iam.roles WHERE tenant_id = $1) AS roles,
              (SELECT count(*)::int FROM iam.role_permissions WHERE tenant_id = $1) AS maps`,
      [tenantId]
    );
    await runSeeds();
    await insertBaselineRoles();
    const after = await admin.query(
      `SELECT (SELECT count(*)::int FROM iam.permissions) AS perms,
              (SELECT count(*)::int FROM iam.roles WHERE tenant_id = $1) AS roles,
              (SELECT count(*)::int FROM iam.role_permissions WHERE tenant_id = $1) AS maps`,
      [tenantId]
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
