/**
 * Phase 1-4 Increment J — IAM permission catalog and baseline-role seeds
 * (P1-04-DB-025). Verifies the seeded catalog and the fictional-tenant baseline
 * roles, idempotence, and the absence of any Benzene-specific assignment.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Pool } from 'pg';
import { adminPool, cleanFixtures, ensureTestLogins } from './helpers';

const SEEDS_DIR = join(__dirname, '..', '..', 'supabase', 'seeds');
const SEED = join(SEEDS_DIR, '04_iam_permission_catalog.sql');
// Applied in dependency order so the suite is self-sufficient in CI (where the
// migration runner does NOT apply seeds); all seeds are idempotent.
const SEED_FILES = [
  '01_reference_data.sql',
  '02_benzene_pilot_provisioning.sql',
  '03_local_test_tenant.sql',
  '04_iam_permission_catalog.sql',
];

let admin: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin); // clear any tenant A/B leftovers from other suites
  for (const f of SEED_FILES) {
    await admin.query(readFileSync(join(SEEDS_DIR, f), 'utf8'));
  }
});

afterAll(async () => {
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
    // '.all' business permissions are named explicitly (e.g. session.view_all) — a
    // wildcard here would be permission_code containing * or %.
    expect(rows.filter((r) => /[*%]/.test(r.permission_code))).toEqual([]);
  });
});

describe('baseline roles (fictional tenant only)', () => {
  it('seeds the six baseline system roles into northwind_motors', async () => {
    const { rows } = await admin.query(
      `SELECT r.role_code, r.is_system FROM iam.roles r
       JOIN org.tenants t ON t.id = r.tenant_id AND t.tenant_code = 'northwind_motors'
       ORDER BY r.role_code`
    );
    expect(rows.map((r) => r.role_code)).toEqual([
      'branch_manager',
      'cashier',
      'platform_operator',
      'receptionist',
      'technician',
      'tenant_administrator',
    ]);
    expect(rows.every((r) => r.is_system === true)).toBe(true);
  });

  it('maps tenant_administrator to real catalog permissions (allow, no wildcard)', async () => {
    const { rows } = await admin.query(
      `SELECT p.permission_code, rp.effect FROM iam.role_permissions rp
       JOIN iam.roles r ON r.id = rp.role_id AND r.role_code = 'tenant_administrator'
       JOIN org.tenants t ON t.id = r.tenant_id AND t.tenant_code = 'northwind_motors'
       JOIN iam.permissions p ON p.id = rp.permission_id`
    );
    expect(rows.length).toBeGreaterThanOrEqual(10);
    expect(rows.every((r) => r.effect === 'allow')).toBe(true);
    expect(rows.map((r) => r.permission_code)).toContain('iam.user.manage');
  });

  it('assigns NO baseline role to any non-fictional tenant (no Benzene assignment)', async () => {
    const { rows } = await admin.query(
      `SELECT DISTINCT t.tenant_code FROM iam.roles r JOIN org.tenants t ON t.id = r.tenant_id`
    );
    // The only tenant carrying seeded roles is the fictional test tenant.
    expect(rows.map((r) => r.tenant_code)).toEqual(['northwind_motors']);
  });

  it('seeds no user accounts and no role grants (configuration only)', async () => {
    const users = await admin.query(`SELECT count(*)::int AS n FROM iam.user_accounts`);
    const grants = await admin.query(`SELECT count(*)::int AS n FROM iam.role_grants`);
    expect(users.rows[0].n).toBe(0);
    expect(grants.rows[0].n).toBe(0);
  });
});

describe('seed idempotence (P1-04-DB-025)', () => {
  it('re-running the catalog seed creates no duplicates', async () => {
    const before = await admin.query(
      `SELECT (SELECT count(*)::int FROM iam.permissions) AS perms,
              (SELECT count(*)::int FROM iam.roles) AS roles,
              (SELECT count(*)::int FROM iam.role_permissions) AS maps`
    );
    await admin.query(readFileSync(SEED, 'utf8'));
    const after = await admin.query(
      `SELECT (SELECT count(*)::int FROM iam.permissions) AS perms,
              (SELECT count(*)::int FROM iam.roles) AS roles,
              (SELECT count(*)::int FROM iam.role_permissions) AS maps`
    );
    expect(after.rows[0]).toEqual(before.rows[0]);
  });
});
