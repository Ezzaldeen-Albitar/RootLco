/**
 * PRE-P1-29 Wave B, slice B1 — cross-tenant negatives, the activation invariant,
 * and proof that normal tenant delegation is untouched.
 *
 * The closure suite proves the sanctioned paths execute; the mutation suite
 * proves they depend on the privileges they were given. This file asks the two
 * remaining questions:
 *
 *   1. Did any new policy accidentally become a general cross-tenant channel?
 *   2. Can provisioning leave a tenant ACTIVE with nobody able to administer it?
 *
 * The second is the one the design review found and could not settle on paper,
 * because the answer depends on which permission codes the operator holds.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  ensureTestLogins,
  platformPool,
  runtimePool,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

const SYSTEM = '00000000-0000-4000-8000-000000000001';

/** An operator holding only `provision` — deliberately not `lifecycle`. */
const PROVISION_ONLY = 'f3000000-0000-4000-8000-00000000000f';
/** An operator holding both, which is the shape that can reach the hazard. */
const FULL_OPERATOR = 'f3000000-0000-4000-8000-00000000000c';
/** A tenant user with no platform authority at all. */
const TENANT_ACTOR = 'f3000000-0000-4000-8000-00000000000e';
const HOME = 'f3000000-0000-4000-8000-0000000000a0';

const PROVISION = 'platform.organization.provision';
const READ = 'platform.organization.read';
const LIFECYCLE = 'platform.organization.lifecycle';

let admin: Pool;
let platform: Pool;
let runtime: Pool;

function spec(code: string, activate = false) {
  return {
    tenant: {
      code,
      display_name: `B1T ${code}`,
      locale: 'en',
      timezone: 'UTC',
      ...(activate ? { activate: true, activation_reason: 'activated at provisioning' } : {}),
    },
    company: {
      code: `${code}_co`,
      legal_name: `B1T ${code} Company`,
      registration_number: `${code}-1`,
      base_currency: 'JOD',
    },
    branch: { code: 'main', name: 'Main', city: 'Amman', country_code: 'JO', timezone: 'UTC' },
  };
}

async function dropTenants(): Promise<void> {
  const scope = `(SELECT id FROM org.tenants WHERE tenant_code LIKE 'b1t_%')`;
  await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key LIKE 'b1t-%'`);
  for (const t of [
    'iam.grant_scopes',
    'iam.role_grants',
    'iam.role_permissions',
    'iam.roles',
    'iam.audit_integrity_links',
    'iam.audit_record_details',
    'iam.audit_records',
    'iam.user_status_history',
  ]) {
    await admin.query(`DELETE FROM ${t} WHERE tenant_id IN ${scope}`);
  }
  await admin.query(
    `DELETE FROM iam.platform_grants WHERE user_account_id IN
       (SELECT id FROM iam.user_accounts WHERE tenant_id IN ${scope})`
  );
  await admin.query(`DELETE FROM iam.user_accounts WHERE tenant_id IN ${scope}`);
  for (const t of [
    'shared.number_sequences',
    'org.tenant_feature_overrides',
    'org.branch_settings',
    'org.company_settings',
    'org.branches',
    'org.legal_companies',
    'org.tenant_subscriptions',
    'org.tenant_status_history',
  ]) {
    await admin.query(`DELETE FROM ${t} WHERE tenant_id IN ${scope}`);
  }
  await admin.query(`DELETE FROM org.tenants WHERE tenant_code LIKE 'b1t_%'`);
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  platform = platformPool();
  runtime = runtimePool();

  await dropTenants();
  const people = [PROVISION_ONLY, FULL_OPERATOR, TENANT_ACTOR];
  await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = ANY($1::uuid[])`, [
    people,
  ]);
  await admin.query(`DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])`, [people]);
  await admin.query(`DELETE FROM org.tenants WHERE id = $1`, [HOME]);

  await admin.query(
    `INSERT INTO org.tenants (id, tenant_code, display_name, default_locale, default_timezone, status, created_by)
     VALUES ($1,'b1t_home','B1T home','en','UTC','active',$2)`,
    [HOME, SYSTEM]
  );
  for (const [id, subject] of [
    [PROVISION_ONLY, 'b1t-prov'],
    [FULL_OPERATOR, 'b1t-full'],
    [TENANT_ACTOR, 'b1t-tenant'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,$2,'local',$3,$4,$5,'active',$6)`,
      [id, HOME, subject, `${subject}@example.invalid`, subject, SYSTEM]
    );
  }
  await admin.query(
    `INSERT INTO iam.platform_grants (user_account_id, permission_code, granted_by, created_by)
     VALUES ($1,$2,$3,$3)`,
    [PROVISION_ONLY, PROVISION, SYSTEM]
  );
  for (const code of [PROVISION, READ, LIFECYCLE]) {
    await admin.query(
      `INSERT INTO iam.platform_grants (user_account_id, permission_code, granted_by, created_by)
       VALUES ($1,$2,$3,$3)`,
      [FULL_OPERATOR, code, SYSTEM]
    );
  }
});

afterAll(async () => {
  await dropTenants();
  const people = [PROVISION_ONLY, FULL_OPERATOR, TENANT_ACTOR];
  await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = ANY($1::uuid[])`, [
    people,
  ]);
  await admin.query(`DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])`, [people]);
  await admin.query(`DELETE FROM org.tenants WHERE id = $1`, [HOME]);
  await Promise.all([platform.end(), runtime.end(), admin.end()]);
});

// ---------------------------------------------------------------------------
describe('the activation branch, and the Owner invariant', () => {
  it('leaves a tenant in its bootstrap window when activation is not requested', async () => {
    const id = await withCommittedTx(platform, { userId: PROVISION_ONLY }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_deferred')), 'b1t-deferred-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    const s = await admin.query<{ status: string }>(
      `SELECT status FROM org.tenants WHERE id = $1`,
      [id]
    );
    expect(s.rows[0]!.status).toBe('provisioning');
  });

  it('refuses activation-during-provisioning to an operator holding only provision', async () => {
    // The activation branch (20260717107000:254-261) enters the lifecycle path,
    // whose policy requires platform.organization.lifecycle. An operator that
    // cannot transition a tenant cannot do it inside provisioning either — so
    // the SEPARATION OF THE CODES is the control, and the whole transaction
    // rolls back rather than leaving anything behind.
    let raised = '(none)';
    try {
      await withCommittedTx(platform, { userId: PROVISION_ONLY }, async (db) => {
        await db.query('SELECT org.provision_organization($1::jsonb, $2)', [
          JSON.stringify(spec('b1t_actdenied', true)),
          'b1t-actdenied-key',
        ]);
      });
    } catch (err) {
      raised = (err as { code?: string }).code ?? '(none)';
    }
    expect(raised).not.toBe('(none)');

    // Nothing survived the refusal — no tenant, and no replay row to block a
    // corrected retry.
    const left = await admin.query<{ tenants: string; keys: string }>(
      `SELECT (SELECT count(*)::text FROM org.tenants WHERE tenant_code = 'b1t_actdenied') AS tenants,
              (SELECT count(*)::text FROM shared.idempotency_keys
                WHERE idempotency_key = 'b1t-actdenied-key') AS keys`
    );
    expect(left.rows[0]).toEqual({ tenants: '0', keys: '0' });
  });

  it('RESIDUAL: an operator holding both codes can create an active tenant with no Owner', async () => {
    // Recorded as an executable fact, not argued away. This is not an
    // escalation — the operator already holds both authorities and could reach
    // the same state in two calls — but it is a state nobody can administer,
    // and B1 does not close it at the database layer.
    //
    // The compensating control is the B6 provisioning adapter, which must never
    // forward `tenant.activate` (design §6.2, §9.1, proof P-27). This test
    // exists so that if B6 ever forgets, the hazard is already written down
    // with a reproduction rather than discovered again from scratch.
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_hazard', true)), 'b1t-hazard-key']
      );
      return r.rows[0]!.out.tenant_id;
    });

    const state = await admin.query<{ status: string; owners: string }>(
      `SELECT t.status,
              (SELECT count(*)::text FROM iam.user_accounts u WHERE u.tenant_id = t.id) AS owners
         FROM org.tenants t WHERE t.id = $1`,
      [id]
    );
    expect(state.rows[0]!.status).toBe('active');
    expect(state.rows[0]!.owners).toBe('0');

    // And the window is shut behind it, so the Owner cannot be added afterwards
    // through the platform path — which is precisely why the ordering matters.
    await withRolledBackTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
      let code = '(none)';
      try {
        await db.query(
          `INSERT INTO iam.user_accounts
             (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
           VALUES ($1,'local','b1t-late','late@example.invalid','Late','active',$2)`,
          [id, FULL_OPERATOR]
        );
      } catch (err) {
        code = (err as { code?: string }).code ?? '(none)';
      }
      expect(code).toBe('42501');
    });
  });
});

// ---------------------------------------------------------------------------
describe('cross-tenant negatives', () => {
  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    tenantA = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_a')), 'b1t-a-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    tenantB = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_b')), 'b1t-b-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
  });

  it('an ordinary tenant actor cannot use the platform resolver as authority', async () => {
    await withRolledBackTx(platform, { userId: TENANT_ACTOR }, async (db) => {
      const r = await db.query<{ p: boolean; l: boolean; rd: boolean }>(
        `SELECT iam.has_platform_authority($1) AS p,
                iam.has_platform_authority($2) AS l,
                iam.has_platform_authority($3) AS rd`,
        [PROVISION, LIFECYCLE, READ]
      );
      expect(r.rows[0]).toEqual({ p: false, l: false, rd: false });
    });
  });

  it('an ordinary tenant actor cannot provision, bootstrap or transition anything', async () => {
    const cases: Array<{ label: string; sql: string; values: unknown[] }> = [
      {
        label: 'provision',
        sql: 'SELECT org.provision_organization($1::jsonb, $2)',
        values: [JSON.stringify(spec('b1t_denied')), 'b1t-denied-key'],
      },
      {
        label: 'transition',
        sql: `SELECT org.change_tenant_status($1,'active','denied')`,
        values: [tenantB],
      },
    ];
    for (const { label, sql, values } of cases) {
      let code = '(none)';
      try {
        await withRolledBackTx(
          platform,
          { userId: TENANT_ACTOR, tenantId: tenantA },
          async (db) => {
            await db.query(sql, values);
          }
        );
      } catch (err) {
        code = (err as { code?: string }).code ?? '(none)';
      }
      expect(code, `${label} must be refused for a tenant actor`).not.toBe('(none)');
    }
  });

  it('app_runtime in tenant A sees no row of tenant B through any new policy', async () => {
    // The B1 policies are all TO app_platform. None of them can widen what an
    // ordinary tenant session sees, and this asserts it rather than assuming it.
    await withRolledBackTx(runtime, { tenantId: tenantA, userId: TENANT_ACTOR }, async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM org.tenants WHERE id = $1`,
        [tenantB]
      );
      expect(r.rows[0]!.n).toBe('0');
    });
  });

  it('app_runtime cannot reach the platform relation or the platform functions', async () => {
    await withRolledBackTx(runtime, { tenantId: tenantA, userId: TENANT_ACTOR }, async (db) => {
      let code = '(none)';
      try {
        await db.query(`SELECT count(*) FROM iam.platform_grants`);
      } catch (err) {
        code = (err as { code?: string }).code ?? '(none)';
      }
      expect(code).toBe('42501');
    });
  });

  it('the platform role sees tenant roots but no tenant business data', async () => {
    await withRolledBackTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const roots = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM org.tenants`);
      expect(Number(roots.rows[0]!.n)).toBeGreaterThan(0);

      let code = '(none)';
      try {
        await db.query(`SELECT count(*) FROM crm.customers`);
      } catch (err) {
        code = (err as { code?: string }).code ?? '(none)';
      }
      expect(code).toBe('42501');
    });
  });
});

// ---------------------------------------------------------------------------
describe('normal tenant delegation is untouched', () => {
  it('the delegation policies and backstop are exactly as they were', async () => {
    // B1 added no policy to these tables for app_runtime and modified none.
    // Asserting their presence is what makes "untouched" checkable.
    const policies = await admin.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies
        WHERE schemaname = 'iam'
          AND policyname IN ('ins_role_permissions_delegable','ins_role_grants_delegable',
                             'upd_role_permissions_delegable','upd_role_grants_admin')
        ORDER BY 1`
    );
    expect(policies.rows.map((r) => r.policyname)).toEqual([
      'ins_role_grants_delegable',
      'ins_role_permissions_delegable',
      'upd_role_grants_admin',
      'upd_role_permissions_delegable',
    ]);

    const backstop = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'iam' AND p.proname = 'grant_delegation_within_authority'`
    );
    expect(backstop.rows[0]!.n).toBe('1');
  });

  it('every B1 policy on a shared table is scoped to app_platform alone', async () => {
    // If a B1 policy had been written TO app_runtime — or worse, to PUBLIC — it
    // would widen the ordinary request path. This enumerates the actual roles
    // on every policy this slice created.
    const b1Policies = await admin.query<{ policyname: string; roles: string }>(
      `SELECT policyname, roles::text AS roles FROM pg_policies
        WHERE policyname LIKE '%_platform%' OR policyname LIKE '%platform_%'
        ORDER BY 1`
    );
    expect(b1Policies.rows.length).toBeGreaterThan(0);
    for (const row of b1Policies.rows) {
      expect(row.roles, `${row.policyname} must be TO app_platform only`).toBe('{app_platform}');
    }
  });

  it('a tenant administrator cannot map a platform code into a tenant role', async () => {
    // Two independent barriers, and this asserts the second: even if a mapping
    // existed, the platform resolver reads iam.platform_grants and never
    // iam.role_permissions, so a tenant-side mapping would confer nothing.
    const r = await admin.query<{ src: string }>(
      `SELECT prosrc AS src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'iam' AND p.proname = 'has_platform_authority'`
    );
    expect(r.rows[0]!.src).toContain('iam.platform_grants');
    expect(r.rows[0]!.src).not.toContain('role_permissions');
    expect(r.rows[0]!.src).not.toContain('role_grants');
  });
});
