/**
 * Phase 1-3 — reference seeds, controlled provisioning packages, and atomic
 * organization provisioning (P1-03-DB-019/020/022, P1-03-QA-006 subset).
 *
 * The ONLY tests that may reference Benzene: they validate the controlled
 * pilot seed package (seed standard §3.3) and prove the mechanism is generic.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  USER_A,
  withRolledBackTx,
} from './helpers';

const SEEDS_DIR = join(__dirname, '..', '..', 'supabase', 'seeds');
const SEED_FILES = [
  '01_reference_data.sql',
  '02_benzene_pilot_provisioning.sql',
  '03_local_test_tenant.sql',
];

let admin: Pool;
let runtime: Pool;
let benzeneTenantId: string;
let northwindTenantId: string;

async function runAllSeeds(admin: Pool): Promise<void> {
  for (const f of SEED_FILES) {
    await admin.query(readFileSync(join(SEEDS_DIR, f), 'utf8'));
  }
}

async function orgFootprint(admin: Pool, tenantId: string) {
  const { rows } = await admin.query(
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

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  // db reset already ran the seeds; re-run them here so this suite is
  // self-sufficient AND doubles as the first idempotence pass.
  await runAllSeeds(admin);
  const b = await admin.query(
    `SELECT id FROM org.tenants WHERE tenant_code = 'benzene_vehicle_services'`
  );
  benzeneTenantId = b.rows[0].id;
  const n = await admin.query(`SELECT id FROM org.tenants WHERE tenant_code = 'northwind_motors'`);
  northwindTenantId = n.rows[0].id;
});

afterAll(async () => {
  // Remove only test-created provisioning artefacts (fx_ prefix), never seeds.
  const t = await admin.query(`SELECT id FROM org.tenants WHERE tenant_code LIKE 'fx\\_prov%'`);
  for (const row of t.rows) {
    const id = row.id;
    await admin.query('DELETE FROM shared.number_sequences WHERE tenant_id = $1', [id]);
    await admin.query('DELETE FROM org.tenant_feature_overrides WHERE tenant_id = $1', [id]);
    await admin.query('DELETE FROM org.branch_settings WHERE tenant_id = $1', [id]);
    await admin.query('DELETE FROM org.company_settings WHERE tenant_id = $1', [id]);
    await admin.query('DELETE FROM org.branches WHERE tenant_id = $1', [id]);
    await admin.query('DELETE FROM org.legal_companies WHERE tenant_id = $1', [id]);
    await admin.query('DELETE FROM org.tenant_subscriptions WHERE tenant_id = $1', [id]);
    await admin.query('DELETE FROM org.tenant_status_history WHERE tenant_id = $1', [id]);
    await admin.query('DELETE FROM org.tenants WHERE id = $1', [id]);
  }
  await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key LIKE 'fx-%'`);
  await runtime.end();
  await admin.end();
});

describe('seed idempotence (P1-03-DB-019/020)', () => {
  it('re-running EVERY seed file creates no duplicates anywhere', async () => {
    const before = {
      benzene: await orgFootprint(admin, benzeneTenantId),
      northwind: await orgFootprint(admin, northwindTenantId),
    };
    const refBefore = await admin.query(
      `SELECT (SELECT count(*)::int FROM shared.currencies) AS c,
              (SELECT count(*)::int FROM shared.timezones) AS t,
              (SELECT count(*)::int FROM shared.languages) AS l,
              (SELECT count(*)::int FROM org.subscription_plans WHERE plan_code = 'pilot') AS p`
    );
    await runAllSeeds(admin);
    await runAllSeeds(admin);
    const after = {
      benzene: await orgFootprint(admin, benzeneTenantId),
      northwind: await orgFootprint(admin, northwindTenantId),
    };
    const refAfter = await admin.query(
      `SELECT (SELECT count(*)::int FROM shared.currencies) AS c,
              (SELECT count(*)::int FROM shared.timezones) AS t,
              (SELECT count(*)::int FROM shared.languages) AS l,
              (SELECT count(*)::int FROM org.subscription_plans WHERE plan_code = 'pilot') AS p`
    );
    expect(after).toEqual(before);
    expect(refAfter.rows[0]).toEqual(refBefore.rows[0]);
  });
});

describe('the controlled Benzene pilot package (the ONLY Benzene-naming tests)', () => {
  it('provisions exactly ONE complete organization', async () => {
    const fp = await orgFootprint(admin, benzeneTenantId);
    expect(fp).toEqual({
      tenants: 1,
      history: 2, // NULL→provisioning, provisioning→active
      subscriptions: 1,
      companies: 1,
      branches: 1,
      sequences: 1,
    });
    const t = await admin.query(`SELECT status, default_locale FROM org.tenants WHERE id = $1`, [
      benzeneTenantId,
    ]);
    expect(t.rows[0]).toEqual({ status: 'active', default_locale: 'ar' });
    const s = await admin.query(
      `SELECT status FROM org.tenant_subscriptions WHERE tenant_id = $1`,
      [benzeneTenantId]
    );
    expect(s.rows[0].status).toBe('draft'); // draft assignment, per the package
  });

  it('unknown pilot facts stayed NULL — nothing was invented', async () => {
    const { rows } = await admin.query(
      `SELECT registration_number, tax_registration_number
       FROM org.legal_companies WHERE tenant_id = $1`,
      [benzeneTenantId]
    );
    expect(rows[0]).toEqual({ registration_number: null, tax_registration_number: null });
  });

  it('Benzene appears in NO function source and NO schema object name', async () => {
    const funcs = await admin.query(
      `SELECT n.nspname || '.' || p.proname AS fq
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('org','iam','shared','crm','veh')
         AND p.prosrc ILIKE '%benzene%'`
    );
    expect(funcs.rows).toEqual([]);
    const objects = await admin.query(
      `SELECT table_schema || '.' || table_name AS fq
       FROM information_schema.tables
       WHERE table_schema IN ('org','iam','shared','crm','veh')
         AND table_name ILIKE '%benzene%'`
    );
    expect(objects.rows).toEqual([]);
    const columns = await admin.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema IN ('org','iam','shared','crm','veh')
         AND column_name ILIKE '%benzene%'`
    );
    expect(columns.rows).toEqual([]);
  });

  it('the pilot and the fictional tenant are mutually invisible (runtime role)', async () => {
    await withRolledBackTx(runtime, { tenantId: benzeneTenantId }, async (c) => {
      const { rows } = await c.query('SELECT tenant_code FROM org.tenants');
      expect(rows.map((r) => r.tenant_code)).toEqual(['benzene_vehicle_services']);
      const other = await c.query('SELECT id FROM org.legal_companies WHERE tenant_id = $1', [
        northwindTenantId,
      ]);
      expect(other.rows).toHaveLength(0);
    });
    await withRolledBackTx(runtime, { tenantId: northwindTenantId }, async (c) => {
      const { rows } = await c.query('SELECT tenant_code FROM org.tenants');
      expect(rows.map((r) => r.tenant_code)).toEqual(['northwind_motors']);
    });
  });

  it('the fictional tenant used exactly the same generic path and footprint', async () => {
    const fp = await orgFootprint(admin, northwindTenantId);
    expect(fp).toEqual({
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
    subscription: { plan_code: 'pilot', status: 'draft', effective_from: '2026-07-01T00:00:00Z' },
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
    expect(retry.rows[0].r).toEqual(r1); // stored response, byte-identical
    const after = await orgFootprint(admin, r1.tenant_id);
    expect(after).toEqual(before); // nothing new
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
    const t = await admin.query(
      `SELECT count(*)::int AS n FROM org.tenants WHERE tenant_code = 'fx_prov_fail1'`
    );
    expect(t.rows[0].n).toBe(0); // no partial tenant
    const k = await admin.query(
      `SELECT count(*)::int AS n FROM shared.idempotency_keys WHERE idempotency_key = 'fx-key-fail1'`
    );
    expect(k.rows[0].n).toBe(0); // key rolled back too — a corrected retry starts clean
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
    const t = await admin.query(
      `SELECT count(*)::int AS n FROM org.tenants WHERE tenant_code = 'fx_prov_fail2'`
    );
    expect(t.rows[0].n).toBe(0);
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
    const t = await admin.query(
      `SELECT count(*)::int AS n FROM org.tenants WHERE tenant_code = 'fx_prov_fail3'`
    );
    expect(t.rows[0].n).toBe(0);
    const seq = await admin.query(
      `SELECT count(*)::int AS n FROM shared.number_sequences s
       JOIN org.tenants t ON t.id = s.tenant_id WHERE t.tenant_code = 'fx_prov_fail3'`
    );
    expect(seq.rows[0].n).toBe(0);
  });

  it('a runtime session cannot execute the provisioning function (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: northwindTenantId, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`SELECT org.provision_organization($1::jsonb, 'fx-key-escalate')`, [
          JSON.stringify(spec({ tenant: { ...spec().tenant, code: 'fx_prov_escalate' } })),
        ]),
        '42501'
      );
    });
  });

  it('runtime has no access to the idempotency table at all (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: northwindTenantId }, async (c) => {
      await expectSqlState(c.query('SELECT count(*) FROM shared.idempotency_keys'), '42501');
    });
  });
});
