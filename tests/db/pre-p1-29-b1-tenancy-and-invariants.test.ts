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
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  roleSurfaceFingerprint,
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
/** The platform surface as this file found it — see roleSurfaceFingerprint. */
let surfaceBaseline: string;
/** org.guard_tenant_status_transition as this file found it. */
let guardBaseline: string;
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

/**
 * Establishes a recoverable Owner for a tenant inside its bootstrap window.
 *
 * Activation now REQUIRES this: org.guard_tenant_status_transition refuses
 * provisioning -> active unless org.tenant_has_recoverable_owner is true, so a
 * tenant cannot go live with nobody able to administer it. Every test that
 * activates a tenant has to do the thing a real bootstrap does first, which is
 * the point of the invariant.
 */
async function establishOwner(pool: Pool, operator: string, tenantId: string): Promise<string> {
  return withCommittedTx(pool, { userId: operator, tenantId }, async (db) => {
    const account = await db.query<{ id: string }>(
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,'local',$2,$3,'Owner','active',$4) RETURNING id`,
      [
        tenantId,
        'owner-' + tenantId.slice(0, 8),
        'owner-' + tenantId.slice(0, 8) + '@example.invalid',
        operator,
      ]
    );
    const role = await db.query<{ id: string }>(
      `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
       VALUES ($1,'company_owner','Company Owner',$2) RETURNING id`,
      [tenantId, operator]
    );
    // The role has to CONFER something. Readiness resolves iam.role.manage and
    // iam.grant.manage through the role-permission mapping with the same
    // allow/deny arithmetic iam.has_permission uses, so an empty role is an
    // owner who can administer nothing.
    await db.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, p.id, 'allow', $3
         FROM iam.permissions p
        WHERE p.permission_code IN ('iam.role.manage', 'iam.grant.manage', 'iam.user.manage')`,
      [tenantId, role.rows[0]!.id, operator]
    );
    await db.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted','active',$4,$4)`,
      [tenantId, account.rows[0]!.id, role.rows[0]!.id, operator]
    );
    return account.rows[0]!.id;
  });
}

async function dropTenants(): Promise<void> {
  const scope = `(SELECT id FROM org.tenants WHERE tenant_code LIKE 'b1t_%')`;
  await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key LIKE 'b1t-%'`);
  // ONE transaction, because tg_role_grants_require_scope is DEFERRED: it checks
  // at COMMIT that every scoped ACTIVE grant still has at least one scope row.
  // Deleting iam.grant_scopes in its own autocommitted statement therefore fails
  // on any scoped grant the suite created — the scopes are gone and the grant is
  // still there. Inside one transaction both disappear before the check runs.
  const conn = await admin.connect();
  try {
    await conn.query('BEGIN');
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
      await conn.query(`DELETE FROM ${t} WHERE tenant_id IN ${scope}`);
    }
    await conn.query('COMMIT');
  } catch (err) {
    await conn.query('ROLLBACK');
    throw err;
  } finally {
    conn.release();
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
  surfaceBaseline = await roleSurfaceFingerprint(admin, 'app_platform');
  // This suite CREATE OR REPLACEs the transition guard to prove the readiness
  // invariant is load-bearing, and roleSurfaceFingerprint does not read function
  // bodies — so the guard is captured separately. Without both, a mutating suite
  // could leave either the privilege surface or the invariant itself weaker than
  // migration source and still return green, which has already happened once in
  // this slice with two policies.
  guardBaseline = (
    await admin.query<{ src: string }>(
      `SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'org' AND p.proname = 'guard_tenant_status_transition'`
    )
  ).rows[0]!.src;
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
  // 'provisioning', then an owner, then activation — the order the product uses.
  // A tenant may not ARRIVE at 'active' without a recoverable administrator, by
  // INSERT or by UPDATE, and the operator's home tenant is not exempt just
  // because it exists to hold an account.
    `INSERT INTO org.tenants (id, tenant_code, display_name, default_locale, default_timezone, status, created_by)
     VALUES ($1,'b1t_home','B1T home','en','UTC','provisioning',$2)`,
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

  // The operator's own account becomes its home tenant's administrator, so the
  // home tenant can go live at all. Ordinary tenant authority — platform
  // authority is still the separate relation, which is the whole point of it.
  const homeRole = await admin.query<{ id: string }>(
    `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
     VALUES ($1,'fx_home_owner','Home owner',$2) RETURNING id`,
    [HOME, SYSTEM]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p
      WHERE p.permission_code IN ('iam.role.manage', 'iam.grant.manage', 'iam.user.manage')`,
    [HOME, homeRole.rows[0]!.id, SYSTEM]
  );
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted','active',$4,$4)`,
    [HOME, FULL_OPERATOR, homeRole.rows[0]!.id, SYSTEM]
  );
  await admin.query(`UPDATE org.tenants SET status = 'active' WHERE id = $1`, [HOME]);
});

afterAll(async () => {
  await dropTenants();
  const people = [PROVISION_ONLY, FULL_OPERATOR, TENANT_ACTOR];
  await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = ANY($1::uuid[])`, [
    people,
  ]);
  await admin.query(`DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])`, [people]);
  await admin.query(`DELETE FROM org.tenants WHERE id = $1`, [HOME]);
  expect(
    await roleSurfaceFingerprint(admin, 'app_platform'),
    'this suite must leave the platform surface exactly as it found it'
  ).toBe(surfaceBaseline);
  const guardNow = (
    await admin.query<{ src: string }>(
      `SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'org' AND p.proname = 'guard_tenant_status_transition'`
    )
  ).rows[0]!.src;
  expect(guardNow, 'the transition guard must be restored byte-for-byte').toBe(guardBaseline);

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

  it('refuses activation-during-provisioning even to an operator holding BOTH codes', async () => {
    // This was previously recorded as a RESIDUAL and deferred to the B6 adapter:
    // an operator holding provision AND lifecycle could pass tenant.activate and
    // produce ACTIVE + no Owner + a shut bootstrap window in one call. It is not
    // an escalation — that operator already holds both authorities — but it is a
    // tenant nobody can administer, and no application-layer rule can make an
    // invalid STATE unrepresentable.
    //
    // It is now closed in the database: org.guard_tenant_status_transition
    // refuses provisioning -> active unless org.tenant_has_recoverable_owner is
    // true. The activation branch runs inside the provisioning transaction, so
    // the whole call rolls back and no tenant is created at all.
    let raised = '(none)';
    try {
      await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
        await db.query('SELECT org.provision_organization($1::jsonb, $2)', [
          JSON.stringify(spec('b1t_bothcodes', true)),
          'b1t-bothcodes-key',
        ]);
      });
    } catch (err) {
      raised = (err as { code?: string }).code ?? '(none)';
    }
    /*
     * P0002, not 23514, and the change is worth explaining rather than just
     * accepting.
     *
     * The refusal used to come from the readiness guard. It now arrives one step
     * earlier, from upd_tenants_platform_lifecycle's tenant term: provisioning
     * runs before the tenant exists, so the session has no app.tenant_id, the
     * UPDATE policy admits no row, and org.change_tenant_status's opening
     * SELECT ... FOR UPDATE reports that the tenant does not exist.
     *
     * The state is refused either way and the whole provisioning call still
     * rolls back — which is what the assertions below check. The guard remains
     * the backstop on every other door: the direct-UPDATE and direct-INSERT
     * cases in this file exercise it on the admin connection, where no policy
     * applies at all.
     */
    expect(raised).toBe('P0002');

    const left = await admin.query<{ tenants: string; keys: string }>(
      `SELECT (SELECT count(*)::text FROM org.tenants WHERE tenant_code = 'b1t_bothcodes') AS tenants,
              (SELECT count(*)::text FROM shared.idempotency_keys
                WHERE idempotency_key = 'b1t-bothcodes-key') AS keys`
    );
    expect(left.rows[0]).toEqual({ tenants: '0', keys: '0' });
  });

  it('refuses a DIRECT activation of a tenant with no recoverable owner', async () => {
    // Not only the sanctioned function: the trigger constrains every writer, so
    // this is asserted on the admin connection, which bypasses row-level
    // security entirely. Anything that refuses here is the trigger alone.
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_directact')), 'b1t-directact-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await expect(
      admin.query(`UPDATE org.tenants SET status = 'active' WHERE id = $1`, [id])
    ).rejects.toMatchObject({ code: '23514' });

    const after = await admin.query<{ status: string }>(
      `SELECT status FROM org.tenants WHERE id = $1`,
      [id]
    );
    expect(after.rows[0]!.status).toBe('provisioning');
  });

  it('accepts activation once a recoverable owner exists, and records it', async () => {
    // The positive control. Without it every refusal above could be a tenant
    // that simply cannot be activated at all.
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_ready')), 'b1t-ready-key']
      );
      return r.rows[0]!.out.tenant_id;
    });

    const ready = await admin.query<{ v: boolean }>(
      `SELECT org.tenant_has_recoverable_owner($1) AS v`,
      [id]
    );
    expect(ready.rows[0]!.v).toBe(false);

    await establishOwner(platform, FULL_OPERATOR, id);

    const readyNow = await admin.query<{ v: boolean }>(
      `SELECT org.tenant_has_recoverable_owner($1) AS v`,
      [id]
    );
    expect(readyNow.rows[0]!.v).toBe(true);

    await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1, 'active', 'owner established')`, [id]);
    });

    const state = await admin.query<{ status: string; history: string }>(
      `SELECT t.status,
              (SELECT count(*)::text FROM org.tenant_status_history h
                WHERE h.tenant_id = t.id AND h.to_state = 'active') AS history
         FROM org.tenants t WHERE t.id = $1`,
      [id]
    );
    expect(state.rows[0]!.status).toBe('active');
    expect(state.rows[0]!.history).toBe('1');
  });

  it('a revoked owner grant makes the tenant unactivatable again', async () => {
    // Readiness is a live question, not a one-time flag. Revoking the only grant
    // must take the tenant back out of the activatable set — which is what
    // distinguishes a derived predicate from an invented bootstrap_complete
    // column that nothing keeps honest.
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_revoked')), 'b1t-revoked-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await establishOwner(platform, FULL_OPERATOR, id);
    await admin.query(
      `UPDATE iam.role_grants SET status = 'revoked', revoked_at = now(),
              revoke_reason = 'b1 test' WHERE tenant_id = $1`,
      [id]
    );
    const ready = await admin.query<{ v: boolean }>(
      `SELECT org.tenant_has_recoverable_owner($1) AS v`,
      [id]
    );
    expect(ready.rows[0]!.v).toBe(false);
    await expect(
      admin.query(`UPDATE org.tenants SET status = 'active' WHERE id = $1`, [id])
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('MUTATION: removing the readiness check makes ACTIVE-without-owner reachable again', async () => {
    // The anti-vacuity proof for the whole invariant. Without it, every test
    // above could be passing because activation is broken for some unrelated
    // reason rather than because readiness is enforced.
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_mutate')), 'b1t-mutate-key']
      );
      return r.rows[0]!.out.tenant_id;
    });

    const original = await admin.query<{ src: string }>(
      `SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'org' AND p.proname = 'guard_tenant_status_transition'`
    );
    expect(original.rows[0]!.src).toContain('tenant_has_recoverable_owner');

    // Replace the guard with the graph-only version this slice started from.
    await admin.query(`
      CREATE OR REPLACE FUNCTION org.guard_tenant_status_transition()
      RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $mut$
      BEGIN
        IF OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
        IF NOT (
             (OLD.status = 'provisioning' AND NEW.status IN ('active','closed'))
          OR (OLD.status = 'active'       AND NEW.status IN ('suspended','closed'))
          OR (OLD.status = 'suspended'    AND NEW.status IN ('active','closed'))
        ) THEN
          RAISE EXCEPTION 'invalid tenant status transition % -> %', OLD.status, NEW.status
            USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
      END;
      $mut$;`);

    try {
      // The bad state is reachable again — which is what makes the real guard
      // load-bearing rather than decorative.
      await admin.query(`UPDATE org.tenants SET status = 'active' WHERE id = $1`, [id]);
      const bad = await admin.query<{ status: string; owners: string }>(
        `SELECT t.status,
                (SELECT count(*)::text FROM iam.role_grants g WHERE g.tenant_id = t.id) AS owners
           FROM org.tenants t WHERE t.id = $1`,
        [id]
      );
      expect(bad.rows[0]!.status).toBe('active');
      expect(bad.rows[0]!.owners).toBe('0');
    } finally {
      await admin.query(`SELECT pg_catalog.set_config('x.noop','',true)`);
      await admin.query(original.rows[0]!.src);
      const restored = await admin.query<{ src: string }>(
        `SELECT pg_get_functiondef(p.oid) AS src FROM pg_proc p
           JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'org' AND p.proname = 'guard_tenant_status_transition'`
      );
      expect(restored.rows[0]!.src).toContain('tenant_has_recoverable_owner');
    }
  });
});

// ---------------------------------------------------------------------------
describe('the readiness predicate itself', () => {
  /*
   * org.tenant_has_recoverable_owner is the whole invariant, so every way it can
   * be FALSE is enumerated here rather than inferred from the one path that
   * happens to be exercised elsewhere. It is derived from canonical artefacts —
   * an active grant inside its validity window held by an active undeleted
   * account of that tenant — so each falsity case is a real state the product
   * can reach, not a hypothetical.
   */
  async function freshTenant(code: string): Promise<string> {
    return withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec(code)), code.replace(/_/g, '-') + '-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
  }
  const ready = async (id: string): Promise<boolean> => {
    const r = await admin.query<{ v: boolean }>(
      `SELECT org.tenant_has_recoverable_owner($1) AS v`,
      [id]
    );
    return r.rows[0]!.v;
  };

  it('is false with no account and no grant', async () => {
    expect(await ready(await freshTenant('b1t_r_none'))).toBe(false);
  });

  it('is true for an active account holding a currently-valid active grant', async () => {
    const id = await freshTenant('b1t_r_ok');
    await establishOwner(platform, FULL_OPERATOR, id);
    expect(await ready(id)).toBe(true);
  });

  it('is false when the grant is revoked', async () => {
    const id = await freshTenant('b1t_r_revoked');
    await establishOwner(platform, FULL_OPERATOR, id);
    await admin.query(
      `UPDATE iam.role_grants SET status = 'revoked', revoked_at = now(),
              revoke_reason = 'b1 readiness case' WHERE tenant_id = $1`,
      [id]
    );
    expect(await ready(id)).toBe(false);
  });

  it('is false when the account is disabled', async () => {
    const id = await freshTenant('b1t_r_locked');
    await establishOwner(platform, FULL_OPERATOR, id);
    await admin.query(`UPDATE iam.user_accounts SET status = 'locked' WHERE tenant_id = $1`, [id]);
    expect(await ready(id)).toBe(false);
  });

  it('is false when the account is soft-deleted', async () => {
    const id = await freshTenant('b1t_r_deleted');
    await establishOwner(platform, FULL_OPERATOR, id);
    await admin.query(`UPDATE iam.user_accounts SET deleted_at = now() WHERE tenant_id = $1`, [id]);
    expect(await ready(id)).toBe(false);
  });

  it('is false when the grant has not started or has already expired', async () => {
    // valid_from is immutable after creation (tg_role_grants_immutable), which
    // is correct and means the window has to be CREATED, not edited. That is
    // also the more honest test: it exercises the shape a real out-of-window
    // grant would actually have.
    const mk = async (code: string, validFrom: string, validTo: string | null) => {
      const id = await freshTenant(code);
      await admin.query(
        `INSERT INTO iam.user_accounts
           (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
         VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7)`,
        [id, 'local', code + '-u', code + '@example.invalid', 'Owner', 'active', SYSTEM]
      );
      const acct = await admin.query<{ id: string }>(
        `SELECT id FROM iam.user_accounts WHERE tenant_id = $1 LIMIT 1`,
        [id]
      );
      const role = await admin.query<{ id: string }>(
        `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
         VALUES ($1,'company_owner','Company Owner',$2) RETURNING id`,
        [id, SYSTEM]
      );
      // Conferring, not merely existing: readiness resolves iam.role.manage and
      // iam.grant.manage, so a grant of an empty role is not an owner.
      await admin.query(
        `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
         SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p
          WHERE p.permission_code IN ('iam.role.manage', 'iam.grant.manage', 'iam.user.manage')`,
        [id, role.rows[0]!.id, SYSTEM]
      );
      await admin.query(
        `INSERT INTO iam.role_grants
           (tenant_id, user_id, role_id, scope_mode, status, valid_from, valid_to, granted_by, created_by)
         VALUES ($1,$2,$3,'unrestricted','active',$4::timestamptz,$5::timestamptz,$6,$6)`,
        [id, acct.rows[0]!.id, role.rows[0]!.id, validFrom, validTo, SYSTEM]
      );
      return id;
    };

    // Bind parameters carry VALUES, not SQL expressions, so the window is
    // computed here rather than written as an interval literal.
    const DAY = 86_400_000;
    const future = await mk('b1t_r_future', new Date(Date.now() + DAY).toISOString(), null);
    expect(await ready(future)).toBe(false);

    const past = await mk(
      'b1t_r_past',
      new Date(Date.now() - 2 * DAY).toISOString(),
      new Date(Date.now() - 3_600_000).toISOString()
    );
    expect(await ready(past)).toBe(false);
  });

  it('does not count a neighbouring tenant owner', async () => {
    // A perfectly good owner next door must not make this tenant look
    // administrable. This is the g.tenant_id = p_tenant term on its own.
    const withOwner = await freshTenant('b1t_r_neighbour');
    await establishOwner(platform, FULL_OPERATOR, withOwner);
    expect(await ready(withOwner)).toBe(true);

    const bare = await freshTenant('b1t_r_bare');
    expect(await ready(bare)).toBe(false);
  });

  /*
   * The C1 matrix: what the predicate must answer FALSE for.
   *
   * The defect this closes was that readiness asked whether a grant EXISTED and
   * never whether it CONFERRED anything, so a grant of an empty role read as an
   * owner while iam.has_permission answered false for every code. These cases
   * are the difference between those two questions, one shape at a time.
   */
  async function roleWith(
    tenant: string,
    code: string,
    perms: Array<[string, 'allow' | 'deny']>
  ): Promise<string> {
    const role = await admin.query<{ id: string }>(
      `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
       VALUES ($1,$2,$2,$3) RETURNING id`,
      [tenant, code, SYSTEM]
    );
    for (const [perm, effect] of perms) {
      await admin.query(
        `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
         SELECT $1, $2, p.id, $4, $3 FROM iam.permissions p WHERE p.permission_code = $5`,
        [tenant, role.rows[0]!.id, SYSTEM, effect, perm]
      );
    }
    return role.rows[0]!.id;
  }

  /** A scoped grant plus the scope row it needs, in ONE transaction. */
  async function scopedGrant(tenant: string, account: string, roleId: string): Promise<void> {
    const company = await admin.query<{ id: string }>(
      `SELECT id FROM org.legal_companies WHERE tenant_id = $1 LIMIT 1`,
      [tenant]
    );
    const conn = await admin.connect();
    try {
      await conn.query('BEGIN');
      const g = await conn.query<{ id: string }>(
        `INSERT INTO iam.role_grants
           (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
         VALUES ($1,$2,$3,'scoped','active',$4,$4) RETURNING id`,
        [tenant, account, roleId, SYSTEM]
      );
      await conn.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
         VALUES ($1,$2,'company',$3,$4)`,
        [tenant, g.rows[0]!.id, company.rows[0]!.id, SYSTEM]
      );
      await conn.query('COMMIT');
    } catch (err) {
      await conn.query('ROLLBACK');
      throw err;
    } finally {
      conn.release();
    }
  }

  async function accountWith(
    tenant: string,
    subject: string,
    roleIds: string[]
  ): Promise<string> {
    const acct = await admin.query<{ id: string }>(
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,'local',$2,$2 || '@example.invalid',$2,'active',$3) RETURNING id`,
      [tenant, subject, SYSTEM]
    );
    for (const roleId of roleIds) {
      await admin.query(
        `INSERT INTO iam.role_grants
           (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
         VALUES ($1,$2,$3,'unrestricted','active',$4,$4)`,
        [tenant, acct.rows[0]!.id, roleId, SYSTEM]
      );
    }
    return acct.rows[0]!.id;
  }

  it('is false for a grant of an EMPTY role — the C1 defect itself', async () => {
    const id = await freshTenant('b1t_c1_empty');
    const role = await roleWith(id, 'c1_empty', []);
    await accountWith(id, 'b1t-c1-empty', [role]);
    // The grant is real, active, in-window, and held by an active account. The
    // old predicate answered true here.
    const grants = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.role_grants WHERE tenant_id = $1 AND status = 'active'`,
      [id]
    );
    expect(grants.rows[0]!.n).toBe('1');
    expect(await ready(id)).toBe(false);
  });

  it('is false for a role holding only an UNRELATED permission', async () => {
    const id = await freshTenant('b1t_c1_unrelated');
    const role = await roleWith(id, 'c1_unrelated', [['org.tenant.read', 'allow']]);
    await accountWith(id, 'b1t-c1-unrelated', [role]);
    expect(await ready(id)).toBe(false);
  });

it('is false for any PROPER SUBSET of the three required codes', async () => {
    /*
     * Every one of the six proper non-empty subsets, because a predicate that
     * required only some of them would pass a single-code test and still call a
     * tenant recoverable that is not.
     *
     * iam.user.manage is the one an earlier revision omitted, and it is the one
     * the other two cannot do without: ck_role_grants_no_self_grant forbids
     * granting to yourself, so recovery needs a SECOND account — and creating
     * one, or activating one out of its default 'invited' state, is gated on
     * user.manage alone.
     */
    const R = 'iam.role.manage';
    const G = 'iam.grant.manage';
    const U = 'iam.user.manage';
    const subsets: Array<[string, string[]]> = [
      ['role only', [R]],
      ['grant only', [G]],
      ['user only', [U]],
      ['role+grant, no user — cannot create the successor', [R, G]],
      ['role+user, no grant — cannot confer the role', [R, U]],
      ['grant+user, no role — cannot define the authority', [G, U]],
    ];
    let i = 0;
    for (const [label, codes] of subsets) {
      const id = await freshTenant('b1t_c1_sub' + i);
      await accountWith(id, 'b1t-c1-sub' + i, [
        await roleWith(
          id,
          'c1_sub' + i,
          codes.map((code) => [code, 'allow'] as [string, 'allow'])
        ),
      ]);
      expect(await ready(id), label).toBe(false);
      i += 1;
    }

    // And the control: all three together.
    const all = await freshTenant('b1t_c1_all');
    await accountWith(all, 'b1t-c1-all', [
      await roleWith(all, 'c1_all', [
        [R, 'allow'],
        [G, 'allow'],
        [U, 'allow'],
      ]),
    ]);
    expect(await ready(all), 'all three together IS recovery').toBe(true);
  });

  /*
   * The next four cases exist because the FIRST repair of C1 introduced a fresh
   * critical defect of the same shape, and nothing here could see it.
   *
   * That repair filtered the permission aggregation to unrestricted grants and
   * joined iam.roles on deleted_at IS NULL. iam.has_permission does NEITHER — it
   * has no scope term and never mentions iam.roles at all. So a deny the
   * authority engine honours became invisible to the predicate, and the
   * predicate reported an owner the engine refuses: the original C1 trap,
   * reintroduced by its own fix.
   *
   * The rule these cases enforce is that the permission arithmetic must AGREE
   * with iam.has_permission on every input, in both directions. Each one
   * asserts the predicate and the engine together, so a future divergence in
   * either direction fails here rather than being discovered by a tenant.
   */
  const engineSaysAll = async (tenant: string, account: string): Promise<boolean> => {
    // iam.has_permission reads the SESSION context, so it has to be asked from a
    // session that is that account, in that tenant.
    return withRolledBackTx(runtime, { userId: account, tenantId: tenant }, async (db) => {
      const r = await db.query<{ ok: boolean }>(
        `SELECT iam.has_permission('iam.role.manage')
            AND iam.has_permission('iam.grant.manage')
            AND iam.has_permission('iam.user.manage') AS ok`
      );
      return r.rows[0]!.ok;
    });
  };

  it('agrees with the engine when a DENY arrives through a SCOPED grant', async () => {
    // The critical case. The deny is carried by a grant the predicate would once
    // have filtered out, while iam.has_permission — which has no scope term —
    // lets it win.
    const id = await freshTenant('b1t_f1_scopeddeny');
    const allow = await roleWith(id, 'f1_allow', [
      ['iam.role.manage', 'allow'],
      ['iam.grant.manage', 'allow'],
      ['iam.user.manage', 'allow'],
    ]);
    const deny = await roleWith(id, 'f1_deny', [['iam.user.manage', 'deny']]);
    const acct = await accountWith(id, 'b1t-f1-scopeddeny', [allow]);
    await scopedGrant(id, acct, deny);

    expect(await engineSaysAll(id, acct), 'the engine must refuse this account').toBe(false);
    expect(await ready(id), 'and so must readiness').toBe(false);
  });

  it('agrees with the engine when a DENY sits on a SOFT-DELETED role', async () => {
    // iam.has_permission never joins iam.roles, so a soft-deleted role still
    // denies. A predicate that filtered deleted roles out disagreed.
    const id = await freshTenant('b1t_f2_deldeny');
    const allow = await roleWith(id, 'f2_allow', [
      ['iam.role.manage', 'allow'],
      ['iam.grant.manage', 'allow'],
      ['iam.user.manage', 'allow'],
    ]);
    const deny = await roleWith(id, 'f2_deny', [['iam.grant.manage', 'deny']]);
    const acct = await accountWith(id, 'b1t-f2-deldeny', [allow, deny]);
    await admin.query(`UPDATE iam.roles SET deleted_at = now() WHERE id = $1`, [deny]);

    expect(await engineSaysAll(id, acct)).toBe(false);
    expect(await ready(id)).toBe(false);
  });

  it('agrees with the engine when the ALLOW sits on a SOFT-DELETED role', async () => {
    /*
     * The mirror, and the uncomfortable one: the engine says this account CAN
     * administer, so readiness says the tenant is recoverable, even though the
     * role conferring it has been soft-deleted.
     *
     * That is a property of iam.has_permission, which never consults
     * iam.roles.deleted_at — soft-deleting a role does not withdraw what it
     * confers. It is recorded as a pre-existing authority-engine question rather
     * than corrected here, because a readiness answer that DISAGREES with the
     * engine is worse than one that agrees with an engine that could be better.
     * If the engine is ever changed, this test fails and says so.
     */
    const id = await freshTenant('b1t_f4_delallow');
    const role = await roleWith(id, 'f4_allow', [
      ['iam.role.manage', 'allow'],
      ['iam.grant.manage', 'allow'],
      ['iam.user.manage', 'allow'],
    ]);
    const acct = await accountWith(id, 'b1t-f4-delallow', [role]);
    await admin.query(`UPDATE iam.roles SET deleted_at = now() WHERE id = $1`, [role]);

    const engine = await engineSaysAll(id, acct);
    expect(await ready(id), 'readiness must say whatever the engine says').toBe(engine);
    expect(engine, 'and today the engine still honours a soft-deleted role').toBe(true);
  });

  it('is false when the only qualifying grant is SCOPED rather than unrestricted', async () => {
    // iam.has_permission ignores scope, but iam.grant_delegation_within_authority
    // refuses a scoped actor creating an unrestricted successor — so a tenant
    // whose only administrators are branch-scoped cannot recover TENANT-WIDE
    // administration however many codes they hold. The predicate aggregates over
    // unrestricted grants only, which is what stops it reporting a ceiling it
    // cannot otherwise see.
    const id = await freshTenant('b1t_c1_scoped');
    const role = await roleWith(id, 'c1_scoped', [
      ['iam.role.manage', 'allow'],
      ['iam.grant.manage', 'allow'],
      ['iam.user.manage', 'allow'],
    ]);
    const acct = await admin.query<{ id: string }>(
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,'local','b1t-c1-scoped','scoped@example.invalid','Scoped','active',$2)
       RETURNING id`,
      [id, SYSTEM]
    );
    // tg_role_grants_require_scope is a DEFERRED constraint trigger: a scoped
    // active grant with no scope rows is refused at COMMIT, not at the
    // statement. So the grant and its scope have to land in ONE transaction —
    // two autocommitted statements can never satisfy it.
    const company = await admin.query<{ id: string }>(
      `SELECT id FROM org.legal_companies WHERE tenant_id = $1 LIMIT 1`,
      [id]
    );
    const conn = await admin.connect();
    try {
      await conn.query('BEGIN');
      const grant = await conn.query<{ id: string }>(
        `INSERT INTO iam.role_grants
           (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
         VALUES ($1,$2,$3,'scoped','active',$4,$4) RETURNING id`,
        [id, acct.rows[0]!.id, role, SYSTEM]
      );
      await conn.query(
        `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
         VALUES ($1,$2,'company',$3,$4)`,
        [id, grant.rows[0]!.id, company.rows[0]!.id, SYSTEM]
      );
      await conn.query('COMMIT');
    } catch (err) {
      await conn.query('ROLLBACK');
      throw err;
    } finally {
      conn.release();
    }
    expect(await ready(id)).toBe(false);
  });

  it('is false when a DENY on a required code is present anywhere', async () => {
    // Deny wins, exactly as iam.has_permission resolves it. The deny arrives
    // through a SECOND role, which is the shape it takes in practice — the
    // unique index on (tenant_id, role_id, permission_id) rules out both effects
    // on one role.
    const id = await freshTenant('b1t_c1_deny');
    const allow = await roleWith(id, 'c1_allow', [
      ['iam.role.manage', 'allow'],
      ['iam.grant.manage', 'allow'],
      ['iam.user.manage', 'allow'],
    ]);
    const deny = await roleWith(id, 'c1_deny', [['iam.grant.manage', 'deny']]);
    const acct = await accountWith(id, 'b1t-c1-deny', [allow, deny]);
    expect(acct).toBeTruthy();
    expect(await ready(id)).toBe(false);
  });

  /*
   * There was an 'is false when the role itself is soft-deleted' case here. It
   * asserted a DIVERGENCE: the predicate filtered soft-deleted roles out while
   * iam.has_permission does not consult iam.roles at all. Keeping it would mean
   * keeping the divergence, so it is superseded by the two engine-agreement
   * cases above, which assert the predicate and the engine give the SAME answer
   * on a soft-deleted role in both directions.
   */

  it('is true only once BOTH codes resolve, and follows each one out again', async () => {
    // §4: the bootstrap must establish real recovery capability, and removing
    // any single required permission must take readiness away again. That is
    // what stops a fixture from encoding a weaker definition than the predicate.
    const id = await freshTenant('b1t_c1_bootstrap');
    await establishOwner(platform, FULL_OPERATOR, id);
    expect(await ready(id)).toBe(true);

    for (const code of ['iam.role.manage', 'iam.grant.manage', 'iam.user.manage']) {
      const removed = await admin.query(
        `DELETE FROM iam.role_permissions rp
           USING iam.permissions p
          WHERE rp.permission_id = p.id AND rp.tenant_id = $1 AND p.permission_code = $2
        RETURNING rp.role_id, rp.permission_id`,
        [id, code]
      );
      expect(removed.rowCount, 'the bootstrap must actually have granted ' + code).toBe(1);
      expect(await ready(id), 'readiness must fall when ' + code + ' is removed').toBe(false);

      await admin.query(
        `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
         VALUES ($1,$2,$3,'allow',$4)`,
        [id, removed.rows[0]!.role_id, removed.rows[0]!.permission_id, SYSTEM]
      );
      expect(await ready(id), 'and return when ' + code + ' is restored').toBe(true);
    }
  });

  it('cannot be fooled by a cross-tenant account, because no such grant exists', async () => {
    /*
     * The two remaining falsity cases — a grant naming a FOREIGN tenant's
     * account, and an account holding a grant recorded under a foreign tenant —
     * turn out not to be states the predicate has to answer for. They are
     * unrepresentable: iam.role_grants carries a COMPOSITE foreign key
     *
     *   FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts(tenant_id, id)
     *
     * backed by uq_user_accounts_tenant_id, so the row is refused by the
     * database before any predicate sees it.
     *
     * That is a stronger answer than "the predicate returns false", and it is
     * worth asserting as a fact rather than assuming: if the constraint were
     * ever relaxed to a plain FK on user_id, the join term in
     * org.tenant_has_recoverable_owner would become the only thing standing
     * between a foreign account and a tenant looking administrable. This case
     * fails the day that changes.
     */
    const shape = await admin.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'iam.role_grants'::regclass AND conname = 'fk_role_grants_user'`
    );
    expect(shape.rows[0]!.def).toContain('FOREIGN KEY (tenant_id, user_id)');
    expect(shape.rows[0]!.def).toContain('iam.user_accounts(tenant_id, id)');

    const home = await freshTenant('b1t_r_xhome');
    const away = await freshTenant('b1t_r_xaway');
    const ownerId = await establishOwner(platform, FULL_OPERATOR, home);
    expect(await ready(home)).toBe(true);
    expect(await ready(away)).toBe(false);

    // A role in the AWAY tenant, granted to the HOME tenant's account. Attempted
    // on the admin connection, which bypasses row-level security entirely — so
    // the refusal is the constraint and nothing else.
    const awayRole = await admin.query<{ id: string }>(
      `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
       VALUES ($1,'company_owner','Company Owner',$2) RETURNING id`,
      [away, SYSTEM]
    );
    await expect(
      admin.query(
        `INSERT INTO iam.role_grants
           (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
         VALUES ($1,$2,$3,'unrestricted','active',$4,$4)`,
        [away, ownerId, awayRole.rows[0]!.id, SYSTEM]
      )
    ).rejects.toMatchObject({ code: '23503' });

    // And the away tenant is still not administrable.
    expect(await ready(away)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('reactivation is gated on CURRENT recoverability, not history', () => {
  /*
   * The gap this closes was real and I had reasoned my way past it: the guard
   * originally gated provisioning -> active only, on the grounds that a
   * suspended tenant "already had an owner". That is a claim about the past. A
   * tenant can be suspended PRECISELY BECAUSE its last administrator was
   * revoked, and reactivating it then yields a live tenant nobody can
   * administer — the same state, through a different door.
   */
  it('refuses suspended -> active when the only owner has been revoked', async () => {
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_reactivate')), 'b1t-reactivate-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await establishOwner(platform, FULL_OPERATOR, id);

    // live, then suspended, both legal
    await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1,'active','go live')`, [id]);
    });
    await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1,'suspended','pause')`, [id]);
    });

    // the administrator goes away while it is suspended
    await admin.query(
      `UPDATE iam.role_grants SET status = 'revoked', revoked_at = now(),
              revoke_reason = 'owner left' WHERE tenant_id = $1`,
      [id]
    );
    expect(
      (await admin.query<{ v: boolean }>(`SELECT org.tenant_has_recoverable_owner($1) AS v`, [id]))
        .rows[0]!.v
    ).toBe(false);

    // reactivation is refused, on the sanctioned path and on the bypassing one
    let viaFunction = '(none)';
    try {
      await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
        await db.query(`SELECT org.change_tenant_status($1,'active','bring it back')`, [id]);
      });
    } catch (err) {
      viaFunction = (err as { code?: string }).code ?? '(none)';
    }
    expect(viaFunction).toBe('23514');

    await expect(
      admin.query(`UPDATE org.tenants SET status = 'active' WHERE id = $1`, [id])
    ).rejects.toMatchObject({ code: '23514' });

    expect(
      (await admin.query<{ s: string }>(`SELECT status AS s FROM org.tenants WHERE id = $1`, [id]))
        .rows[0]!.s
    ).toBe('suspended');
  });

  it('allows suspended -> active once an owner is restored', async () => {
    // The positive control for the case above: the refusal must be about
    // recoverability, not about suspended tenants being unreactivatable.
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_restored')), 'b1t-restored-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await establishOwner(platform, FULL_OPERATOR, id);
    await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1,'active','go live')`, [id]);
    });
    await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1,'suspended','pause')`, [id]);
    });
    await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1,'active','resume')`, [id]);
    });
    expect(
      (await admin.query<{ s: string }>(`SELECT status AS s FROM org.tenants WHERE id = $1`, [id]))
        .rows[0]!.s
    ).toBe('active');
  });

  it('still allows closing a tenant nobody can administer', async () => {
    // Abandoning or pausing an unadministrable tenant must stay possible —
    // gating those would trap a tenant in a state it can never leave.
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_abandon')), 'b1t-abandon-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1,'closed','abandoned half-built')`, [id]);
    });
    expect(
      (await admin.query<{ s: string }>(`SELECT status AS s FROM org.tenants WHERE id = $1`, [id]))
        .rows[0]!.s
    ).toBe('closed');
  });
});

// ---------------------------------------------------------------------------
describe('a refused activation writes nothing that claims it happened', () => {
  /*
   * A guard that refuses the UPDATE but leaves a history row saying ACTIVE is
   * worse than no guard at all: the tenant reads as provisioning, the audit
   * trail reads as live, and the two disagree forever.
   *
   * The ordering is what makes this safe, and it is not obvious.
   * org.guard_tenant_status_transition is BEFORE UPDATE on org.tenants, and
   * org.change_tenant_status writes its history row AFTER the UPDATE statement
   * — so the exception is raised before the history INSERT is ever reached, and
   * the surrounding transaction takes the rest with it.
   */
  it('leaves no status-history row, no audit row and no replay row behind', async () => {
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_notrace')), 'b1t-notrace-key']
      );
      return r.rows[0]!.out.tenant_id;
    });

    const before = await admin.query<{ hist: string; audit: string }>(
      `SELECT (SELECT count(*)::text FROM org.tenant_status_history WHERE tenant_id = $1) AS hist,
              (SELECT count(*)::text FROM iam.audit_records WHERE tenant_id = $1) AS audit`,
      [id]
    );

    let code = '(none)';
    try {
      await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
        await db.query(`SELECT org.change_tenant_status($1,'active','no owner yet')`, [id]);
        // Deliberately after the refused call: if the guard did not raise, this
        // would commit an audit row and the assertions below would catch it.
        await db.query(
          `SELECT iam.audit_append($1,$2,'user','platform.organization.activated','tenant',$1,
                                   NULL,NULL,NULL,'b1','[]'::jsonb)`,
          [id, FULL_OPERATOR]
        );
      });
    } catch (err) {
      code = (err as { code?: string }).code ?? '(none)';
    }
    expect(code).toBe('23514');

    const after = await admin.query<{
      status: string;
      hist: string;
      active: string;
      audit: string;
      replay: string;
    }>(
      `SELECT t.status,
              (SELECT count(*)::text FROM org.tenant_status_history h WHERE h.tenant_id = t.id) AS hist,
              (SELECT count(*)::text FROM org.tenant_status_history h
                WHERE h.tenant_id = t.id AND h.to_state = 'active') AS active,
              (SELECT count(*)::text FROM iam.audit_records a WHERE a.tenant_id = t.id) AS audit,
              (SELECT count(*)::text FROM shared.idempotency_keys k
                WHERE k.tenant_id = t.id AND k.response_document::text LIKE '%active%') AS replay
         FROM org.tenants t WHERE t.id = $1`,
      [id]
    );
    expect(after.rows[0]!.status).toBe('provisioning');
    expect(after.rows[0]!.active).toBe('0');
    expect(after.rows[0]!.hist).toBe(before.rows[0]!.hist);
    expect(after.rows[0]!.audit).toBe(before.rows[0]!.audit);
    expect(after.rows[0]!.replay).toBe('0');
  });

  it('writes exactly one correct history row for a legal activation', async () => {
    // The positive control, and the place the history CONTENT is checked: a
    // refusal proving "nothing was written" is only meaningful if a success
    // writes the right thing.
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_trace')), 'b1t-trace-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await establishOwner(platform, FULL_OPERATOR, id);

    const at = new Date();
    await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1,'active','owner in place')`, [id]);
    });

    const rows = await admin.query<{
      from_state: string;
      to_state: string;
      reason: string;
      actor_id: string;
      occurred_at: Date;
    }>(
      `SELECT from_state, to_state, reason, actor_id, occurred_at
         FROM org.tenant_status_history
        WHERE tenant_id = $1 AND to_state = 'active'`,
      [id]
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0]!.from_state).toBe('provisioning');
    expect(rows.rows[0]!.to_state).toBe('active');
    expect(rows.rows[0]!.reason).toBe('owner in place');
    expect(rows.rows[0]!.actor_id).toBe(FULL_OPERATOR);
    // Stamped by the database, not by the caller: within a minute of the call
    // and not in the future.
    const delta = rows.rows[0]!.occurred_at.getTime() - at.getTime();
    expect(delta).toBeGreaterThanOrEqual(-1000);
    expect(delta).toBeLessThan(60_000);
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

  it('a NULL or empty narrowing scope widens nothing, proved on real rows', async () => {
    /*
     * C9 is the design assumption this attacks: an absent TENANT denies, but an
     * absent narrowing list WIDENS — iam.allowed_company_ids() returning NULL
     * means "not narrowed", not "narrowed to nothing". A platform session sets
     * its own GUCs and can simply leave them unset, so if any platform policy
     * consulted those helpers, unsetting them would be an escalation performed
     * with set_config.
     *
     * Helper return values are not the proof, so this runs on real rows in two
     * real tenants: an administrator in each, plus an ordinary employee in the
     * first who holds no grant at all.
     *
     * Both tenants are ACTIVATED first, deliberately. Inside the bootstrap
     * window sel_user_accounts_platform_bootstrap admits every identity row of
     * that tenant — correctly, since the control plane is creating them — so a
     * scope test run there would measure the window and not the scope. The first
     * draft of this test did exactly that and reported the employee as visible.
     */
    const live = async (code: string): Promise<string> => {
      const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
        const r = await db.query<{ out: { tenant_id: string } }>(
          'SELECT org.provision_organization($1::jsonb, $2) AS out',
          [JSON.stringify(spec(code)), code.replace(/_/g, '-') + '-key']
        );
        return r.rows[0]!.out.tenant_id;
      });
      const owner = await establishOwner(platform, FULL_OPERATOR, id);
      await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
        await db.query(`SELECT org.change_tenant_status($1,'active','scope fixture')`, [id]);
      });
      return owner;
    };

    const aOwner = await live('b1t_scope_a');
    const bOwner = await live('b1t_scope_b');
    const tenantIds = await admin.query<{ id: string }>(
      `SELECT id FROM org.tenants WHERE tenant_code IN ('b1t_scope_a','b1t_scope_b') ORDER BY tenant_code`
    );
    const [scopeA, scopeB] = tenantIds.rows.map((r) => r.id);

    // An ordinary employee of the live tenant A: a real row, no grant.
    const aPlain = await admin.query<{ id: string }>(
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,'local','b1t-scope-plain','plain@example.invalid','Plain','active',$2)
       RETURNING id`,
      [scopeA, SYSTEM]
    );

    // No platform policy consults the narrowing helpers at all. That is the
    // mechanism, and it is worth asserting rather than inferring from behaviour.
    const consulting = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_policies
        WHERE 'app_platform' = ANY (roles)
          AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%allowed_%_ids%'`
    );
    expect(consulting.rows[0]!.n).toBe('0');

    const visible = async (empty: boolean, tenantId?: string): Promise<string[]> =>
      // exactOptionalPropertyTypes: the key must be ABSENT, not present-and-undefined.
      withRolledBackTx(
        platform,
        tenantId === undefined
          ? { userId: FULL_OPERATOR }
          : { userId: FULL_OPERATOR, tenantId },
        async (db) => {
        if (empty) {
          await db.query(`SELECT set_config('app.company_ids','',true)`);
          await db.query(`SELECT set_config('app.branch_ids','',true)`);
        }
        // The narrowing helpers are not callable by this role at all, which is
        // the strongest form of "an absent scope cannot widen": there is no
        // answer to widen with. Only the context reader is asked here, and it
        // reports exactly what the caller selected — absent when nothing was.
        const scope = await db.query<{ t: string | null }>(
          `SELECT iam.current_tenant_id() AS t`
        );
        expect(scope.rows[0]!.t).toBe(tenantId ?? null);

        // A savepoint, because a refused statement aborts the transaction and
        // the row-visibility read below is the actual point of this test.
        await db.query(`SAVEPOINT business_probe`);
        let business = '(none)';
        try {
          await db.query(`SELECT count(*) FROM crm.business_partners`);
        } catch (err) {
          business = (err as { code?: string }).code ?? '(none)';
        }
        await db.query(`ROLLBACK TO SAVEPOINT business_probe`);
        // Refused at the PRIVILEGE layer, so no policy is reached and there is
        // nothing an absent scope could widen.
        expect(business).toBe('42501');

        const r = await db.query<{ id: string }>(
          `SELECT id FROM iam.user_accounts WHERE tenant_id IN ($1,$2) ORDER BY id`,
          [scopeA, scopeB]
        );
        return r.rows.map((x) => x.id);
      });

    for (const empty of [false, true]) {
      const label = empty ? 'empty-string scope' : 'unset scope';

      // With NO tenant context, nothing at all. The lifecycle read carries a
      // tenant term, so an absent tenant DENIES — the safe half of the C9
      // asymmetry — and the narrowing lists are not even callable by this role.
      expect(await visible(empty), label + ', no tenant').toEqual([]);

      // With tenant A selected, exactly A's administrator. Not A's ordinary
      // employee, because the policy also requires an active grant; and not B's
      // administrator, because the tenant term binds the read to one tenant.
      // An earlier revision omitted that term and returned both.
      const inA = await visible(empty, scopeA);
      expect(inA, label + ', tenant A').toEqual([aOwner]);
      expect(inA, label + ', tenant A').not.toContain(aPlain.rows[0]!.id);
      expect(inA, label + ', tenant A').not.toContain(bOwner);

      const inB = await visible(empty, scopeB);
      expect(inB, label + ', tenant B').toEqual([bOwner]);
    }
  });

  it('the platform role sees tenant roots but no tenant business data', async () => {
    await withRolledBackTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const roots = await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM org.tenants`);
      expect(Number(roots.rows[0]!.n)).toBeGreaterThan(0);

      // Named as a table that EXISTS. app_platform holds no USAGE on crm, so
      // the schema is refused before the relation is resolved and a misspelt
      // name would answer 42501 exactly like a real one.
      const real = await admin.query<{ ok: boolean }>(
        `SELECT to_regclass('crm.business_partners') IS NOT NULL AS ok`
      );
      expect(real.rows[0]!.ok).toBe(true);

      let code = '(none)';
      try {
        await db.query(`SELECT count(*) FROM crm.business_partners`);
      } catch (err) {
        code = (err as { code?: string }).code ?? '(none)';
      }
      expect(code).toBe('42501');
    });
  });
});

// ---------------------------------------------------------------------------
describe('a platform session with NO authority can do nothing', () => {
  /*
   * The implementation refuter found that six audit policies and the two replay
   * policies gated only on `tenant_id = iam.current_tenant_id()` — and a
   * platform session sets its own tenant context, so a connection holding zero
   * platform grants could name any tenant and append a chain-valid audit record
   * to it, or read every platform provisioning response ever stored.
   *
   * The runtime's equivalents use the same predicate safely because the runtime
   * cannot CHOOSE its tenant. The control plane can. These are the tests that
   * prove the added authority conjunct is load-bearing rather than decorative:
   * TENANT_ACTOR is a real account on the platform connection with no row in
   * iam.platform_grants at all.
   */
  it('cannot append an audit record for a tenant it names itself', async () => {
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_noauth_audit')), 'b1t-noauth-audit-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    let code = '(none)';
    try {
      await withRolledBackTx(platform, { userId: TENANT_ACTOR, tenantId: id }, async (db) => {
        await db.query(
          `SELECT iam.audit_append($1,$2,'user','forged','tenant',$1,NULL,NULL,NULL,'x','[]'::jsonb)`,
          [id, TENANT_ACTOR]
        );
      });
    } catch (err) {
      code = (err as { code?: string }).code ?? '(none)';
    }
    expect(code).toBe('42501');
  });

  it('cannot read the platform replay history', async () => {
    await withRolledBackTx(platform, { userId: TENANT_ACTOR }, async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM shared.idempotency_keys`
      );
      // Not an error — a row-level denial returns zero rows. The point is that
      // the stored provisioning responses, each carrying a real tenant, company
      // and branch id, are invisible without authority.
      expect(r.rows[0]!.n).toBe('0');
    });
  });

  it('sees the replay history once it holds the provisioning authority', async () => {
    // The positive control. Without it the test above would pass against a
    // table that is simply empty, which proves nothing at all.
    await withRolledBackTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM shared.idempotency_keys`
      );
      expect(Number(r.rows[0]!.n)).toBeGreaterThan(0);
    });
  });

  it('cannot write platform replay data for a tenant it names itself', async () => {
    // The read denial above is only half of it. A session that could WRITE a
    // replay row could pre-poison a provisioning key and make a later, properly
    // authorised provisioning call return an attacker-chosen response body.
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_noauth_write')), 'b1t-noauth-write-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    let code = '(none)';
    try {
      await withRolledBackTx(platform, { userId: TENANT_ACTOR, tenantId: id }, async (db) => {
        await db.query(
          `INSERT INTO shared.idempotency_keys
             (tenant_id, operation, idempotency_key, request_fingerprint, response_document, created_by)
           VALUES ($1,'org.provision','b1t-poison','deadbeef','{}'::jsonb,$2)`,
          [id, TENANT_ACTOR]
        );
      });
    } catch (err) {
      code = (err as { code?: string }).code ?? '(none)';
    }
    expect(code).toBe('42501');
  });

  it('cannot provision an organisation', async () => {
    let code = '(none)';
    try {
      await withCommittedTx(platform, { userId: TENANT_ACTOR }, async (db) => {
        await db.query('SELECT org.provision_organization($1::jsonb, $2)', [
          JSON.stringify(spec('b1t_noauth_prov')),
          'b1t-noauth-prov-key',
        ]);
      });
    } catch (err) {
      code = (err as { code?: string }).code ?? '(none)';
    }
    expect(code).toBe('42501');
    const left = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM org.tenants WHERE tenant_code = 'b1t_noauth_prov'`
    );
    expect(left.rows[0]!.n).toBe('0');
  });

  it('cannot move a tenant through its lifecycle', async () => {
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_noauth_life')), 'b1t-noauth-life-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await establishOwner(platform, FULL_OPERATOR, id);

    let code = '(none)';
    try {
      await withCommittedTx(platform, { userId: TENANT_ACTOR, tenantId: id }, async (db) => {
        await db.query(`SELECT org.change_tenant_status($1,'active','no authority')`, [id]);
      });
    } catch (err) {
      code = (err as { code?: string }).code ?? '(none)';
    }
    // Absence, not refusal: sel_tenants_platform admits the row only to a
    // session holding one of the three platform authorities, so the opening
    // SELECT ... FOR UPDATE finds nothing and the function reports the tenant
    // does not exist. Pinned deliberately — the shape of this refusal is the
    // thing a future caller will have to interpret.
    expect(code).toBe('P0002');

    const after = await admin.query<{ s: string }>(
      `SELECT status AS s FROM org.tenants WHERE id = $1`,
      [id]
    );
    expect(after.rows[0]!.s).toBe('provisioning');
  });

  it('cannot bootstrap an Owner into a tenant inside its window', async () => {
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_noauth_boot')), 'b1t-noauth-boot-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    let code = '(none)';
    try {
      await withRolledBackTx(platform, { userId: TENANT_ACTOR, tenantId: id }, async (db) => {
        await db.query(
          `INSERT INTO iam.user_accounts
             (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
           VALUES ($1,'local','b1t-noauth','na@example.invalid','NA','active',$2)`,
          [id, TENANT_ACTOR]
        );
      });
    } catch (err) {
      code = (err as { code?: string }).code ?? '(none)';
    }
    expect(code).toBe('42501');
  });

  it('resolves FALSE for every platform authority, and the operator resolves TRUE', async () => {
    // The resolver is the head of every path above. Both directions in one
    // place, because a false-for-everyone resolver would also make every
    // negative above pass for the wrong reason.
    for (const code of [PROVISION, READ, LIFECYCLE]) {
      const denied = await withRolledBackTx(platform, { userId: TENANT_ACTOR }, async (db) => {
        const r = await db.query<{ v: boolean }>(`SELECT iam.has_platform_authority($1) AS v`, [
          code,
        ]);
        return r.rows[0]!.v;
      });
      expect(denied, code + ' must be false for a session with no platform grant').toBe(false);

      const allowed = await withRolledBackTx(platform, { userId: FULL_OPERATOR }, async (db) => {
        const r = await db.query<{ v: boolean }>(`SELECT iam.has_platform_authority($1) AS v`, [
          code,
        ]);
        return r.rows[0]!.v;
      });
      expect(allowed, code + ' must be true for the full operator').toBe(true);
    }
  });

  it('cannot map a platform code into a tenant role during bootstrap', async () => {
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_platcode')), 'b1t-platcode-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await withRolledBackTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
      const role = await db.query<{ id: string }>(
        `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
         VALUES ($1,'owner','Owner',$2) RETURNING id`,
        [id, FULL_OPERATOR]
      );
      const platformCode = await db.query<{ id: string }>(
        `SELECT id FROM iam.permissions WHERE permission_code = $1`,
        [PROVISION]
      );
      const tenantCode = await db.query<{ id: string }>(
        `SELECT id FROM iam.permissions WHERE permission_code = 'org.tenant.read'`
      );

      // A tenant code maps fine...
      await db.query(`SAVEPOINT ok`);
      const good = await db.query(
        `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
         VALUES ($1,$2,$3,'allow',$4)`,
        [id, role.rows[0]!.id, tenantCode.rows[0]!.id, FULL_OPERATOR]
      );
      expect(good.rowCount).toBe(1);

      // ...and a platform code does not. It would confer no platform authority
      // — the resolver reads iam.platform_grants and never iam.role_permissions
      // — but it would make iam.has_permission('platform.…') answer true, which
      // is a trap for any future route that reaches for the wrong resolver.
      await db.query(`SAVEPOINT probe`);
      let code = '(none)';
      try {
        await db.query(
          `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
           VALUES ($1,$2,$3,'allow',$4)`,
          [id, role.rows[0]!.id, platformCode.rows[0]!.id, FULL_OPERATOR]
        );
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

// ---------------------------------------------------------------------------
describe('H1 — the invariant covers INSERT, not only UPDATE', () => {
  /*
   * The guard was BEFORE UPDATE only, so a row could be CREATED live and
   * ownerless. On that door the sole defence was the row-level policy
   * ins_tenants_platform_provisioning, which a BYPASSRLS connection walks past.
   * These assertions run on the ADMIN connection for exactly that reason:
   * anything that refuses here is the trigger and nothing else.
   */
  const NEW_ID = '11111111-2222-4333-8444-555555555555';

  afterEach(async () => {
    await admin.query(`DELETE FROM org.tenants WHERE id = $1`, [NEW_ID]);
  });

  it('refuses a direct INSERT of an ACTIVE tenant with no recoverable administration', async () => {
    await expect(
      admin.query(
        `INSERT INTO org.tenants
           (id, tenant_code, display_name, default_locale, default_timezone, status, created_by)
         VALUES ($1,'b1t_h1_active','H1 active','en','UTC','active',$2)`,
        [NEW_ID, SYSTEM]
      )
    ).rejects.toMatchObject({ code: '23514' });

    const left = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM org.tenants WHERE id = $1`,
      [NEW_ID]
    );
    expect(left.rows[0]!.n).toBe('0');
  });

  it('allows a direct INSERT of a PROVISIONING tenant', async () => {
    // The guard must not make tenant creation impossible. Provisioning is how
    // every tenant begins and no owner can exist before the row does.
    await expect(
      admin.query(
        `INSERT INTO org.tenants
           (id, tenant_code, display_name, default_locale, default_timezone, status, created_by)
         VALUES ($1,'b1t_h1_prov','H1 provisioning','en','UTC','provisioning',$2)`,
        [NEW_ID, SYSTEM]
      )
    ).resolves.toBeTruthy();

    const row = await admin.query<{ s: string }>(
      `SELECT status AS s FROM org.tenants WHERE id = $1`,
      [NEW_ID]
    );
    expect(row.rows[0]!.s).toBe('provisioning');
  });

  it('refuses an UPDATE that changes the tenant identity', async () => {
    // Readiness is asked about NEW.id, so the row must not be able to change
    // identity underneath the question. org.guard_immutable_columns does not
    // cover id.
    const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1t_h1_ident')), 'b1t-h1-ident-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await expect(
      admin.query(`UPDATE org.tenants SET id = $2 WHERE id = $1`, [id, NEW_ID])
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// ---------------------------------------------------------------------------
describe('H2 — platform lifecycle cannot fabricate status history', () => {
  /*
   * ins_tenant_status_history_platform_lifecycle carried authority and a
   * destination list and nothing else: no tenant term, no relation to the
   * tenant's actual state. A lifecycle holder could append a transition that
   * never happened, to ANY tenant, and org.stamp_tenant_status_history would
   * then stamp it with a real actor and a current timestamp — making the
   * fabrication indistinguishable from a genuine record, permanently, since no
   * role holds UPDATE or DELETE on the table.
   */
  let liveA: string;
  let liveB: string;

  beforeAll(async () => {
    const bring = async (code: string): Promise<string> => {
      const id = await withCommittedTx(platform, { userId: FULL_OPERATOR }, async (db) => {
        const r = await db.query<{ out: { tenant_id: string } }>(
          'SELECT org.provision_organization($1::jsonb, $2) AS out',
          [JSON.stringify(spec(code)), code.replace(/_/g, '-') + '-key']
        );
        return r.rows[0]!.out.tenant_id;
      });
      await establishOwner(platform, FULL_OPERATOR, id);
      await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: id }, async (db) => {
        await db.query(`SELECT org.change_tenant_status($1,'active','h2 fixture')`, [id]);
      });
      return id;
    };
    liveA = await bring('b1t_h2_a');
    liveB = await bring('b1t_h2_b');
  });

  // from_state is a parameter because org.tenant_status_history carries
  // CHECK (from_state IS DISTINCT FROM to_state). A probe that leaves them equal
  // is refused by that constraint and never reaches the policy under test — it
  // would look like a pass and prove nothing about coherence.
  const insertHistory = async (
    sessionTenant: string,
    rowTenant: string,
    toState: string,
    fromState = 'active'
  ): Promise<string> => {
    try {
      await withRolledBackTx(
        platform,
        { userId: FULL_OPERATOR, tenantId: sessionTenant },
        async (db) => {
          await db.query(
            `INSERT INTO org.tenant_status_history
               (tenant_id, from_state, to_state, reason, actor_id)
             VALUES ($1,$4,$2,'h2 probe',$3)`,
            [rowTenant, toState, FULL_OPERATOR, fromState]
          );
        }
      );
    } catch (err) {
      return (err as { code?: string }).code ?? '(none)';
    }
    return '(none)';
  };

  it('accepted the history the canonical transition wrote', async () => {
    // The positive control, and the reason the refusals below are about
    // fabrication rather than about the policy being broken outright.
    const rows = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM org.tenant_status_history
        WHERE tenant_id = $1 AND to_state = 'active'`,
      [liveA]
    );
    expect(rows.rows[0]!.n).toBe('1');
  });

  it('refuses a history row for tenant B while the session is on tenant A', async () => {
    expect(await insertHistory(liveA, liveB, 'suspended')).toBe('42501');
  });

  it('refuses a history row whose to_state disagrees with the tenant state', async () => {
    // liveA is 'active'. Claiming it moved to 'suspended' describes a transition
    // that did not happen, and the coherence term is what notices.
    expect(await insertHistory(liveA, liveA, 'suspended')).toBe('42501');
  });

  it('refuses a direct history insert whose destination is not the tenant state', async () => {
    /*
     * What the two remaining terms DO close, stated exactly.
     *
     * A third term was tried and withdrawn — it required from_state to continue
     * the tenant's chain, which would have closed the residual below, and it
     * chose the chain head by `ORDER BY occurred_at DESC, id DESC`. occurred_at
     * is now(), the TRANSACTION timestamp, so two transitions in one transaction
     * tie and the tie breaks on a random uuid: about half of such transactions
     * would have picked the wrong predecessor and rolled the whole transition
     * back, permanently. Refusing a truthful transition to block a redundant one
     * is the wrong trade.
     */
    for (const [from, to] of [
      ['active', 'suspended'],
      ['active', 'closed'],
      ['suspended', 'closed'],
    ] as const) {
      expect(
        await insertHistory(liveA, liveA, to, from),
        `${from} -> ${to} disagrees with the tenant's real state`
      ).toBe('42501');
    }
  });

  it('RESIDUAL: a redundant edge ending at the tenant real state is accepted', async () => {
    /*
     * Recorded as an executable fact rather than left as a gap in a document.
     *
     * A lifecycle operator can append a history row for a tenant it has selected
     * whose destination matches that tenant's actual current state — claiming,
     * here, a suspension and recovery that did not happen. What it CANNOT do is
     * misrepresent where the tenant is, write for a tenant it has not selected,
     * or write without an authority that org.stamp_tenant_status_history then
     * attributes to it by name.
     *
     * If this ever starts refusing, the chain term has been reintroduced and the
     * wedge described above needs re-examining before it ships.
     */
    expect(await insertHistory(liveA, liveA, 'active', 'suspended')).toBe('(none)');
  });

  it('records the row a REAL transition writes, and only that one', async () => {
    // The positive control lives on the sanctioned path, which is the only path
    // that can write here now.
    const before = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM org.tenant_status_history WHERE tenant_id = $1`,
      [liveB]
    );
    await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: liveB }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1,'suspended','h2 real transition')`, [
        liveB,
      ]);
    });
    const after = await admin.query<{ n: string; from_state: string; to_state: string }>(
      `SELECT (SELECT count(*)::text FROM org.tenant_status_history WHERE tenant_id = $1) AS n,
              h.from_state, h.to_state
         FROM org.tenant_status_history h
        WHERE h.tenant_id = $1 AND h.reason = 'h2 real transition'`,
      [liveB]
    );
    expect(Number(after.rows[0]!.n)).toBe(Number(before.rows[0]!.n) + 1);
    expect(after.rows[0]!.from_state).toBe('active');
    expect(after.rows[0]!.to_state).toBe('suspended');
  });

  it('stamps actor and timestamp on the sanctioned path, so neither can be spoofed', async () => {
    /*
     * The spoof has to be attempted where a write is actually possible, which
     * after the coherence terms means through org.change_tenant_status. It takes
     * a p_actor argument, so the attempt is real: name somebody else and see who
     * the row ends up attributed to.
     */
    const other = await admin.query<{ id: string }>(
      `SELECT id FROM iam.user_accounts WHERE tenant_id = $1 AND provider_subject LIKE 'owner-%'
        LIMIT 1`,
      [liveA]
    );
    expect(other.rows[0]?.id, 'the fixture must have somebody else to impersonate').toBeTruthy();

    const before = new Date();
    await withCommittedTx(platform, { userId: FULL_OPERATOR, tenantId: liveA }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1,'suspended','h2 spoof attempt',$2)`, [
        liveA,
        other.rows[0]!.id,
      ]);
    });

    const written = await admin.query<{ actor_id: string; occurred_at: Date }>(
      `SELECT actor_id, occurred_at FROM org.tenant_status_history
        WHERE tenant_id = $1 AND reason = 'h2 spoof attempt'`,
      [liveA]
    );
    expect(written.rows.length).toBe(1);
    // Two independent defences agree here: org.change_tenant_status prefers
    // iam.current_user_id() over p_actor, and org.stamp_tenant_status_history
    // overwrites actor_id and occurred_at regardless — the precedent
    // org.branch_status_history has set since 20260717103000.
    expect(written.rows[0]!.actor_id).toBe(FULL_OPERATOR);
    expect(written.rows[0]!.occurred_at.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
  });
});
