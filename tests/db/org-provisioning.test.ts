/**
 * Phase 1-3 — structural seeds and atomic organization provisioning
 * (P1-03-DB-019/020/022, P1-03-QA-006 subset).
 *
 * Every organization in this suite is an ephemeral fixture created through the
 * generic provisioning function and cascade-deleted by the suite.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  deleteTenantCascade,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  USER_A,
  withRolledBackTx,
} from './helpers';

const SEEDS_DIR = join(__dirname, '..', '..', 'supabase', 'seeds');
const BASE_SEEDS = ['01_reference_data.sql', '04_iam_permission_catalog.sql'];
const DECLARED_REFERENCE_SEEDS = [...BASE_SEEDS, '05_shared_reference.sql'];
const PLAN_CODE = 'fx_prov_plan';
const A_KEY = 'fx-prov-a-v1';
const B_KEY = 'fx-prov-b-v1';

const specA = {
  actor_id: USER_A,
  tenant: {
    code: 'fxprov_a',
    display_name: 'Ephemeral Provisioning Tenant A',
    locale: 'ar',
    timezone: 'Asia/Amman',
    activate: true,
    activation_reason: 'ephemeral provisioning assertion',
  },
  subscription: {
    plan_code: PLAN_CODE,
    status: 'draft',
    effective_from: '2026-07-01T00:00:00Z',
  },
  company: {
    code: 'fxprov_a_main',
    legal_name: 'Ephemeral Provisioning Company A',
    base_currency: 'JOD',
  },
  branch: {
    code: 'main',
    name: 'Ephemeral Main Branch A',
    timezone: 'Asia/Amman',
    country_code: 'JO',
    city: 'Amman',
  },
  sequences: [{ code: 'org_document', prefix_template: 'DOC-', pad_width: 6 }],
};

const specB = {
  actor_id: USER_A,
  tenant: {
    code: 'fxprov_b',
    display_name: 'Ephemeral Provisioning Tenant B',
    locale: 'en',
    timezone: 'UTC',
    activate: true,
    activation_reason: 'ephemeral generic-path assertion',
  },
  subscription: {
    plan_code: PLAN_CODE,
    status: 'draft',
    effective_from: '2026-07-01T00:00:00Z',
  },
  company: {
    code: 'fxprov_b_main',
    legal_name: 'Ephemeral Provisioning Company B',
    base_currency: 'USD',
  },
  branch: { code: 'main', name: 'Ephemeral Main Branch B', timezone: 'UTC' },
  sequences: [{ code: 'org_document', prefix_template: 'DOC-', pad_width: 6 }],
};

let admin: Pool;
let runtime: Pool;
let tenantAId: string;
let tenantBId: string;
interface ProvisioningResult {
  tenant_id: string;
  subscription_id?: string;
  company_id: string;
  branch_id: string;
}
let resultA: ProvisioningResult;

async function runSeeds(pool: Pool, files: string[]): Promise<void> {
  for (const file of files) {
    await pool.query(readFileSync(join(SEEDS_DIR, file), 'utf8'));
  }
}

async function orgFootprint(pool: Pool, tenantId: string) {
  const { rows } = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM org.tenants WHERE id = $1) AS tenants,
       (SELECT count(*)::int FROM org.tenant_status_history WHERE tenant_id = $1) AS history,
       (SELECT count(*)::int FROM org.tenant_subscriptions WHERE tenant_id = $1) AS subscriptions,
       (SELECT count(*)::int FROM org.legal_companies WHERE tenant_id = $1) AS companies,
       (SELECT count(*)::int FROM org.branches WHERE tenant_id = $1) AS branches,
       (SELECT count(*)::int FROM shared.number_sequences WHERE tenant_id = $1) AS sequences`,
    [tenantId]
  );
  return rows[0];
}

async function provision(pool: Pool, spec: object, key: string) {
  const { rows } = await pool.query('SELECT org.provision_organization($1::jsonb, $2) AS result', [
    JSON.stringify(spec),
    key,
  ]);
  return rows[0].result as ProvisioningResult;
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);

  const stale = await admin.query(
    `SELECT id FROM org.tenants
      WHERE tenant_code LIKE 'fxprov%'
         OR tenant_code LIKE 'fx\\_prov%'`
  );
  await deleteTenantCascade(
    admin,
    stale.rows.map((row) => row.id)
  );
  await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key LIKE 'fx-%'`);
  await admin.query(`DELETE FROM org.subscription_plans WHERE plan_code = $1`, [PLAN_CODE]);

  await runSeeds(admin, BASE_SEEDS);
  await admin.query(
    `INSERT INTO org.subscription_plans
       (plan_code, name, description, entitlement_document, capacity_limits,
        status, effective_from, created_by)
     SELECT $1, 'Ephemeral Provisioning Plan', 'Test-only active plan', '{}', '{}',
            'active', '2026-01-01T00:00:00Z', $2
     WHERE NOT EXISTS (
       SELECT 1 FROM org.subscription_plans WHERE plan_code = $1 AND status = 'active'
     )`,
    [PLAN_CODE, USER_A]
  );

  resultA = await provision(admin, specA, A_KEY);
  tenantAId = resultA.tenant_id;
  const resultB = await provision(admin, specB, B_KEY);
  tenantBId = resultB.tenant_id;
});

afterAll(async () => {
  const fixtures = await admin.query(
    `SELECT id FROM org.tenants
      WHERE tenant_code LIKE 'fxprov%'
         OR tenant_code LIKE 'fx\\_prov%'`
  );
  await deleteTenantCascade(
    admin,
    fixtures.rows.map((row) => row.id)
  );
  await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key LIKE 'fx-%'`);
  await admin.query(`DELETE FROM org.subscription_plans WHERE plan_code = $1`, [PLAN_CODE]);
  await runtime.end();
  await admin.end();
});

describe('seed and provisioning idempotence (P1-03-DB-019/020)', () => {
  it('re-runs seeds 01/04/05 and replays provisioning without changing rows', async () => {
    await runSeeds(admin, ['05_shared_reference.sql']);
    const refsBefore = await admin.query(
      `SELECT (SELECT count(*)::int FROM shared.currencies) AS currencies,
              (SELECT count(*)::int FROM shared.timezones) AS timezones,
              (SELECT count(*)::int FROM shared.languages) AS languages,
              (SELECT count(*)::int FROM iam.permissions) AS permissions,
              (SELECT count(*)::int FROM shared.retention_classes) AS retention_classes`
    );
    const footprintBefore = await orgFootprint(admin, tenantAId);

    await runSeeds(admin, DECLARED_REFERENCE_SEEDS);
    await runSeeds(admin, DECLARED_REFERENCE_SEEDS);
    const replay = await provision(admin, specA, A_KEY);

    const refsAfter = await admin.query(
      `SELECT (SELECT count(*)::int FROM shared.currencies) AS currencies,
              (SELECT count(*)::int FROM shared.timezones) AS timezones,
              (SELECT count(*)::int FROM shared.languages) AS languages,
              (SELECT count(*)::int FROM iam.permissions) AS permissions,
              (SELECT count(*)::int FROM shared.retention_classes) AS retention_classes`
    );
    expect(refsAfter.rows[0]).toEqual(refsBefore.rows[0]);
    expect(replay).toEqual(resultA);
    expect(await orgFootprint(admin, tenantAId)).toEqual(footprintBefore);
  });
});

describe('ephemeral pilot-shape provisioning', () => {
  it('provisions exactly ONE complete organization with ar locale and draft subscription', async () => {
    expect(await orgFootprint(admin, tenantAId)).toEqual({
      tenants: 1,
      history: 2,
      subscriptions: 1,
      companies: 1,
      branches: 1,
      sequences: 1,
    });
    const tenant = await admin.query(
      `SELECT status, default_locale FROM org.tenants WHERE id = $1`,
      [tenantAId]
    );
    expect(tenant.rows[0]).toEqual({ status: 'active', default_locale: 'ar' });
    const subscription = await admin.query(
      `SELECT status FROM org.tenant_subscriptions WHERE tenant_id = $1`,
      [tenantAId]
    );
    expect(subscription.rows[0].status).toBe('draft');
  });

  it('unknown registration facts stay NULL', async () => {
    const { rows } = await admin.query(
      `SELECT registration_number, tax_registration_number
       FROM org.legal_companies WHERE tenant_id = $1`,
      [tenantAId]
    );
    expect(rows[0]).toEqual({ registration_number: null, tax_registration_number: null });
  });

  it('the customer marker appears in NO function source and NO schema object name', async () => {
    const customerMarker = ['ben', 'zene'].join('');
    const funcs = await admin.query(
      `SELECT n.nspname || '.' || p.proname AS fq
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('org','iam','shared','crm','veh')
         AND p.prosrc ILIKE '%' || $1 || '%'`,
      [customerMarker]
    );
    expect(funcs.rows).toEqual([]);
    const objects = await admin.query(
      `SELECT table_schema || '.' || table_name AS fq
       FROM information_schema.tables
       WHERE table_schema IN ('org','iam','shared','crm','veh')
         AND table_name ILIKE '%' || $1 || '%'`,
      [customerMarker]
    );
    expect(objects.rows).toEqual([]);
    const columns = await admin.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema IN ('org','iam','shared','crm','veh')
         AND column_name ILIKE '%' || $1 || '%'`,
      [customerMarker]
    );
    expect(columns.rows).toEqual([]);
  });

  it('the two ephemeral tenants are mutually invisible (runtime role)', async () => {
    await withRolledBackTx(runtime, { tenantId: tenantAId }, async (client) => {
      const { rows } = await client.query('SELECT tenant_code FROM org.tenants');
      expect(rows.map((row) => row.tenant_code)).toEqual(['fxprov_a']);
      const other = await client.query('SELECT id FROM org.legal_companies WHERE tenant_id = $1', [
        tenantBId,
      ]);
      expect(other.rows).toHaveLength(0);
    });
    await withRolledBackTx(runtime, { tenantId: tenantBId }, async (client) => {
      const { rows } = await client.query('SELECT tenant_code FROM org.tenants');
      expect(rows.map((row) => row.tenant_code)).toEqual(['fxprov_b']);
    });
  });

  it('the generic en/UTC path has the same complete footprint', async () => {
    expect(await orgFootprint(admin, tenantBId)).toEqual({
      tenants: 1,
      history: 2,
      subscriptions: 1,
      companies: 1,
      branches: 1,
      sequences: 1,
    });
  });
});

describe('org.provision_organization — atomicity, idempotency, failure injection', () => {
  const spec = (overrides: Record<string, unknown> = {}) => ({
    actor_id: USER_A,
    tenant: {
      code: 'fx_prov_tenant',
      display_name: 'Provisioning Test Tenant',
      locale: 'en',
      timezone: 'UTC',
      activate: true,
      activation_reason: 'test activation',
    },
    subscription: {
      plan_code: PLAN_CODE,
      status: 'draft',
      effective_from: '2026-07-01T00:00:00Z',
    },
    company: { code: 'fx_prov_co', legal_name: 'Prov Co', base_currency: 'USD' },
    branch: { code: 'main', name: 'Prov Main', timezone: 'UTC' },
    sequences: [{ code: 'org_document', prefix_template: 'DOC-', pad_width: 6 }],
    ...overrides,
  });

  it('provisions a full organization and the retry replays WITHOUT creating anything', async () => {
    const first = await admin.query(
      `SELECT org.provision_organization($1::jsonb, 'fx-key-1') AS r`,
      [JSON.stringify(spec())]
    );
    const r1 = first.rows[0].r;
    expect(r1.tenant_id).toBeTruthy();
    expect(r1.company_id).toBeTruthy();
    expect(r1.branch_id).toBeTruthy();
    const before = await orgFootprint(admin, r1.tenant_id);
    expect(before).toEqual({
      tenants: 1,
      history: 2,
      subscriptions: 1,
      companies: 1,
      branches: 1,
      sequences: 1,
    });

    const retry = await admin.query(
      `SELECT org.provision_organization($1::jsonb, 'fx-key-1') AS r`,
      [JSON.stringify(spec())]
    );
    expect(retry.rows[0].r).toEqual(r1);
    expect(await orgFootprint(admin, r1.tenant_id)).toEqual(before);
  });

  it('the same key with a CONFLICTING request fails (23000)', async () => {
    await expectSqlState(
      admin.query(`SELECT org.provision_organization($1::jsonb, 'fx-key-1')`, [
        JSON.stringify(
          spec({ company: { code: 'fx_other', legal_name: 'X', base_currency: 'USD' } })
        ),
      ]),
      '23000'
    );
  });

  it('failure at the COMPANY step (bad currency) rolls back EVERYTHING including the key', async () => {
    const bad = spec({
      tenant: { ...spec().tenant, code: 'fx_prov_fail1' },
      company: { code: 'fx_fail_co', legal_name: 'Fail Co', base_currency: 'ZZZ' },
    });
    await expectSqlState(
      admin.query(`SELECT org.provision_organization($1::jsonb, 'fx-key-fail1')`, [
        JSON.stringify(bad),
      ]),
      '23503'
    );
    const tenant = await admin.query(
      `SELECT count(*)::int AS n FROM org.tenants WHERE tenant_code = 'fx_prov_fail1'`
    );
    expect(tenant.rows[0].n).toBe(0);
    const key = await admin.query(
      `SELECT count(*)::int AS n FROM shared.idempotency_keys WHERE idempotency_key = 'fx-key-fail1'`
    );
    expect(key.rows[0].n).toBe(0);
  });

  it('failure at the OVERRIDES step (unknown flag) rolls back everything', async () => {
    const bad = spec({
      tenant: { ...spec().tenant, code: 'fx_prov_fail2' },
      feature_overrides: [{ flag_code: 'flag_that_does_not_exist', enabled: true, reason: 'boom' }],
    });
    await expectSqlState(
      admin.query(`SELECT org.provision_organization($1::jsonb, 'fx-key-fail2')`, [
        JSON.stringify(bad),
      ]),
      '23503'
    );
    const tenant = await admin.query(
      `SELECT count(*)::int AS n FROM org.tenants WHERE tenant_code = 'fx_prov_fail2'`
    );
    expect(tenant.rows[0].n).toBe(0);
  });

  it('failure at the SEQUENCE step (invalid pad_width) rolls back everything', async () => {
    const bad = spec({
      tenant: { ...spec().tenant, code: 'fx_prov_fail3' },
      sequences: [{ code: 'org_document', pad_width: -1 }],
    });
    await expectSqlState(
      admin.query(`SELECT org.provision_organization($1::jsonb, 'fx-key-fail3')`, [
        JSON.stringify(bad),
      ]),
      '23514'
    );
    const tenant = await admin.query(
      `SELECT count(*)::int AS n FROM org.tenants WHERE tenant_code = 'fx_prov_fail3'`
    );
    expect(tenant.rows[0].n).toBe(0);
    const sequences = await admin.query(
      `SELECT count(*)::int AS n FROM shared.number_sequences s
       JOIN org.tenants t ON t.id = s.tenant_id WHERE t.tenant_code = 'fx_prov_fail3'`
    );
    expect(sequences.rows[0].n).toBe(0);
  });

  it('a runtime session cannot execute the provisioning function (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: tenantBId, userId: USER_A }, async (client) => {
      await expectSqlState(
        client.query(`SELECT org.provision_organization($1::jsonb, 'fx-key-escalate')`, [
          JSON.stringify(spec({ tenant: { ...spec().tenant, code: 'fx_prov_escalate' } })),
        ]),
        '42501'
      );
    });
  });

  it('runtime has no access to the idempotency table at all (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: tenantBId }, async (client) => {
      await expectSqlState(client.query('SELECT count(*) FROM shared.idempotency_keys'), '42501');
    });
  });
});
