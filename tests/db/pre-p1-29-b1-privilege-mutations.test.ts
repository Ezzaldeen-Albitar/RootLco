/**
 * PRE-P1-29 Wave B, slice B1 — mutation proofs for the required-privilege matrix.
 *
 * ## What this file is for
 *
 * `pre-p1-29-b1-platform-privilege-closure.test.ts` asserts that every
 * sanctioned control-plane path executes. That is necessary and it is not
 * sufficient: a suite can be green because the privileges are right, or green
 * because it never actually depended on them. This file settles which, by
 * removing one dependency at a time and requiring the path to go RED.
 *
 * Every case here follows the same three steps, and the first is the one that
 * usually gets skipped:
 *
 *   1. PROVE THE TARGET EXISTS. A mutation that removes something already
 *      absent changes nothing, and a test that then reports a refusal is
 *      measuring the wrong cause. Each case asserts the grant or policy is
 *      present before touching it.
 *   2. Remove it, and require the exact failure.
 *   3. Restore it in `finally`, and re-prove the path is GREEN again.
 *
 * Step 3 matters as much as step 2: without it a later failure in this file
 * would leave the developer database permanently under-granted, and every
 * subsequent suite would fail for a reason that has nothing to do with itself.
 *
 * ## Why the mutations commit
 *
 * DDL is transactional in PostgreSQL, so the tidy version of this file would
 * mutate and roll back inside one transaction. It cannot: the mutation is made
 * on the admin connection and the path executes on the platform connection, and
 * an uncommitted change on one is invisible to the other. So each mutation
 * commits, runs, and is restored — which is also closer to what a real
 * regression would look like.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  roleSurfaceFingerprint,
  ensureTestLogins,
  platformPool,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

const SYSTEM = '00000000-0000-4000-8000-000000000001';
const OPERATOR = 'f2000000-0000-4000-8000-00000000000f';
const OPERATOR_HOME = 'f2000000-0000-4000-8000-0000000000a0';
const PROVISION = 'platform.organization.provision';
const READ = 'platform.organization.read';
const LIFECYCLE = 'platform.organization.lifecycle';

let admin: Pool;
/** The platform surface as this file found it — see roleSurfaceFingerprint. */
let surfaceBaseline: string;
let platform: Pool;
/** A committed tenant sitting inside its bootstrap window, for the whole file. */
let windowTenant: string;

function spec(code: string) {
  return {
    tenant: { code, display_name: `B1M ${code}`, locale: 'en', timezone: 'UTC' },
    company: {
      code: `${code}_co`,
      legal_name: `B1M ${code} Company`,
      registration_number: `${code}-1`,
      base_currency: 'JOD',
    },
    branch: { code: 'main', name: 'Main', city: 'Amman', country_code: 'JO', timezone: 'UTC' },
  };
}

async function dropTenants(): Promise<void> {
  const scope = `(SELECT id FROM org.tenants WHERE tenant_code LIKE 'b1m_%')`;
  await admin.query(`DELETE FROM shared.idempotency_keys WHERE idempotency_key LIKE 'b1m-%'`);
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
  await admin.query(`DELETE FROM org.tenants WHERE tenant_code LIKE 'b1m_%'`);
}
/**
 * Gives a tenant a recoverable Owner so it can be activated at all.
 *
 * org.guard_tenant_status_transition now refuses provisioning -> active unless
 * org.tenant_has_recoverable_owner is true. Every mutation that exercises the
 * lifecycle therefore has to do what a real bootstrap does first, or it fails
 * for the wrong reason and proves nothing about the privilege under test.
 */
async function establishOwner(tenantId: string): Promise<void> {
  await withCommittedTx(platform, { userId: OPERATOR, tenantId }, async (db) => {
    const tag = 'own-' + tenantId.slice(0, 8);
    const account = await db.query<{ id: string }>(
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,'local',$2,$3,'Owner','active',$4) RETURNING id`,
      [tenantId, tag, tag + '@example.invalid', OPERATOR]
    );
    const role = await db.query<{ id: string }>(
      `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
       VALUES ($1,'company_owner','Company Owner',$2) RETURNING id`,
      [tenantId, OPERATOR]
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
      [tenantId, role.rows[0]!.id, OPERATOR]
    );
    await db.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted','active',$4,$4)`,
      [tenantId, account.rows[0]!.id, role.rows[0]!.id, OPERATOR]
    );
  });
}

/** True iff app_platform currently holds EXECUTE on the named function. */
async function hasExecute(signature: string): Promise<boolean> {
  const r = await admin.query<{ ok: boolean }>(
    `SELECT has_function_privilege('app_platform', $1, 'EXECUTE') AS ok`,
    [signature]
  );
  return r.rows[0]!.ok;
}

/** True iff app_platform currently holds the named table privilege. */
async function hasTable(table: string, privilege: string): Promise<boolean> {
  const r = await admin.query<{ ok: boolean }>(
    `SELECT has_table_privilege('app_platform', $1, $2) AS ok`,
    [table, privilege]
  );
  return r.rows[0]!.ok;
}

/** True iff app_platform holds the privilege on that ONE column. */
async function hasColumn(table: string, column: string, privilege: string): Promise<boolean> {
  const r = await admin.query<{ ok: boolean }>(
    `SELECT has_column_privilege('app_platform', $1, $2, $3) AS ok`,
    [table, column, privilege]
  );
  return r.rows[0]!.ok;
}

/** True iff the named policy exists on the named table. */
async function hasPolicy(table: string, policy: string): Promise<boolean> {
  const [schema, name] = table.split('.');
  const r = await admin.query<{ n: string }>(
    `SELECT count(*)::text AS n FROM pg_policies
      WHERE schemaname = $1 AND tablename = $2 AND policyname = $3`,
    [schema, name, policy]
  );
  return r.rows[0]!.n === '1';
}

/**
 * Passed where a hand-written CREATE POLICY used to be.
 *
 * The hand-copied form failed in the worst way available to it. Two restores in
 * this file carried the PRE-REMEDIATION text of policies that had since been
 * tightened, so running the suite silently reverted the tenant term on
 * sel_role_grants_platform_lifecycle and the coherence terms on
 * ins_tenant_status_history_platform_lifecycle IN THE LIVE DATABASE. Nothing
 * caught it: every assertion keyed on the policy NAME, and the definition
 * round-trip added afterwards agreed too, because by then the live policy
 * already matched the stale literal it was being compared against. The suite was
 * green and the database was weaker than its own migrations.
 *
 * A mutation may now only put back what it took away.
 */
const RESTORE_FROM_CATALOGUE = '-- restore is derived from the live policy before the drop';

/** Reconstructs a CREATE POLICY statement for a policy that exists right now. */
async function captureCreatePolicy(table: string, policy: string): Promise<string> {
  const [schema, name] = table.split('.');
  const r = await admin.query<{
    cmd: string;
    roles: string;
    qual: string | null;
    withcheck: string | null;
  }>(
    `SELECT cmd, array_to_string(roles, ', ') AS roles, qual, with_check AS withcheck
       FROM pg_policies WHERE schemaname = $1 AND tablename = $2 AND policyname = $3`,
    [schema, name, policy]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`cannot capture ${table}.${policy}: it does not exist`);
  const parts = [`CREATE POLICY ${policy} ON ${table}`, `FOR ${row.cmd} TO ${row.roles}`];
  if (row.qual !== null) parts.push(`USING (${row.qual})`);
  if (row.withcheck !== null) parts.push(`WITH CHECK (${row.withcheck})`);
  return parts.join(' ');
}

/** The USING and WITH CHECK of a policy, as PostgreSQL renders them. */
async function policyDefinition(table: string, policy: string): Promise<string> {
  const [schema, name] = table.split('.');
  const r = await admin.query<{ def: string }>(
    `SELECT coalesce(qual,'-') || ' :: ' || coalesce(with_check,'-') AS def
       FROM pg_policies WHERE schemaname = $1 AND tablename = $2 AND policyname = $3`,
    [schema, name, policy]
  );
  return r.rows[0]?.def ?? '(absent)';
}

/**
 * Runs `body` with one privilege removed, then restores it whatever happens.
 *
 * `snapshot` is optional and is what stops the restore from lying. Every policy
 * restore in this file is a hand-copied literal, and both the precondition and
 * the restore assertion key on the policy NAME — so a restore that reinstates a
 * SEMANTICALLY DIFFERENT predicate satisfies them both, leaves the database
 * weakened for every later case in the run, and is invisible to the matrix test,
 * which also keys on names. That is the same class as the already-found bug
 * where a column-list GRANT was used to restore a table-level one; passing a
 * snapshot closes it for policies too.
 */
async function withoutPrivilege(
  present: () => Promise<boolean>,
  drop: string,
  restore: string,
  body: () => Promise<void>,
  snapshot?: () => Promise<string>
): Promise<void> {
  // Step 1 — the mutation must have something to remove.
  expect(await present(), `precondition: the target of \`${drop}\` must exist first`).toBe(true);
  // If the mutation touches a POLICY, capture it — both its rendered predicate
  // and a CREATE statement that will put it back exactly — before dropping it.
  // The target is derived from the DROP statement, so every policy case in this
  // file and every one added later is covered without opting in.
  // Broadened, and then made fail-closed, because the narrow form was a hole.
  // The guard only recognised a bare `DROP POLICY <name> ON <table>`; writing the
  // mutation as `DROP POLICY IF EXISTS` or `ALTER POLICY` left target null, so no
  // restore was derived, the hand-written-restore hard error never fired, and the
  // suite could put back whatever it liked. A guard that a different spelling
  // walks past is not a guard.
  const target =
    /(?:DROP|ALTER)\s+POLICY\s+(?:IF\s+EXISTS\s+)?"?(\w+)"?\s+ON\s+([\w."]+)/i.exec(drop);
  if (!target && /\bPOLICY\b/i.test(drop)) {
    throw new Error(
      'this mutation touches a POLICY in a form the restore harness does not recognise, ' +
        'so it cannot derive a catalogue restore: ' +
        drop
    );
  }
  const probe = snapshot ?? (target ? () => policyDefinition(target[2]!, target[1]!) : undefined);
  const before = probe ? await probe() : null;
  // Prefixed with a DROP, because a mutation may REPLACE a policy rather than
  // merely remove it — in which case a bare CREATE collides with the weakened
  // one the mutation installed.
  const derivedRestore = target
    ? `DROP POLICY IF EXISTS ${target[1]!} ON ${target[2]!}; ` +
      (await captureCreatePolicy(target[2]!, target[1]!))
    : null;
  await admin.query(drop);
  try {
    expect(await present(), `\`${drop}\` must actually remove it`).toBe(false);
    await body();
  } finally {
    // The DERIVED statement wins for policies. `restore` is only used for
    // grants, which have no catalogue form to reconstruct from.
    const effective = derivedRestore ?? restore;
    if (derivedRestore && restore !== RESTORE_FROM_CATALOGUE) {
      throw new Error(
        'a policy mutation must pass RESTORE_FROM_CATALOGUE, not a hand-copied CREATE POLICY'
      );
    }
    await admin.query(effective);
    expect(await present(), `\`${effective}\` must put it back`).toBe(true);
    if (probe) {
      expect(
        await probe(),
        'the restore must reinstate the SAME predicate, not merely a policy of the same name'
      ).toBe(before);
    }
  }
}

/** Asserts the platform path fails, and returns the SQLSTATE it failed with. */
async function pathFails(
  run: (db: { query: (sql: string, values?: unknown[]) => Promise<unknown> }) => Promise<unknown>
): Promise<string> {
  try {
    await withRolledBackTx(platform, { userId: OPERATOR, tenantId: windowTenant }, run);
  } catch (err) {
    return (err as { code?: string }).code ?? '(none)';
  }
  throw new Error('expected the path to fail, but it succeeded');
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  platform = platformPool();
  surfaceBaseline = await roleSurfaceFingerprint(admin, 'app_platform');

  await dropTenants();
  await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = $1`, [OPERATOR]);
  await admin.query(`DELETE FROM iam.user_accounts WHERE id = $1`, [OPERATOR]);
  await admin.query(`DELETE FROM org.tenants WHERE id = $1`, [OPERATOR_HOME]);

  await admin.query(
  // 'provisioning', then an owner, then activation — the order the product uses.
  // A tenant may not ARRIVE at 'active' without a recoverable administrator, by
  // INSERT or by UPDATE, and the operator's home tenant is not exempt just
  // because it exists to hold an account.
    `INSERT INTO org.tenants (id, tenant_code, display_name, default_locale, default_timezone, status, created_by)
     VALUES ($1,'b1m_operator_home','B1M home','en','UTC','provisioning',$2)`,
    [OPERATOR_HOME, SYSTEM]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'local','b1m-operator','b1m@example.invalid','B1M Operator','active',$3)`,
    [OPERATOR, OPERATOR_HOME, SYSTEM]
  );
  for (const code of [PROVISION, READ, LIFECYCLE]) {
    await admin.query(
      `INSERT INTO iam.platform_grants (user_account_id, permission_code, granted_by, created_by)
       VALUES ($1,$2,$3,$3)`,
      [OPERATOR, code, SYSTEM]
    );
  }

  // The operator's own account becomes its home tenant's administrator, so the
  // home tenant can go live at all. Ordinary tenant authority — platform
  // authority is still the separate relation, which is the whole point of it.
  const homeRole = await admin.query<{ id: string }>(
    `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
     VALUES ($1,'fx_home_owner','Home owner',$2) RETURNING id`,
    [OPERATOR_HOME, SYSTEM]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p
      WHERE p.permission_code IN ('iam.role.manage', 'iam.grant.manage', 'iam.user.manage')`,
    [OPERATOR_HOME, homeRole.rows[0]!.id, SYSTEM]
  );
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted','active',$4,$4)`,
    [OPERATOR_HOME, OPERATOR, homeRole.rows[0]!.id, SYSTEM]
  );
  await admin.query(`UPDATE org.tenants SET status = 'active' WHERE id = $1`, [OPERATOR_HOME]);

  windowTenant = await withCommittedTx(platform, { userId: OPERATOR }, async (db) => {
    const r = await db.query<{ out: { tenant_id: string } }>(
      'SELECT org.provision_organization($1::jsonb, $2) AS out',
      [JSON.stringify(spec('b1m_window')), 'b1m-window-key']
    );
    return r.rows[0]!.out.tenant_id;
  });
  await establishOwner(windowTenant);
});

afterAll(async () => {
  await dropTenants();
  await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = $1`, [OPERATOR]);
  await admin.query(`DELETE FROM iam.user_accounts WHERE id = $1`, [OPERATOR]);
  await admin.query(`DELETE FROM org.tenants WHERE id = $1`, [OPERATOR_HOME]);
  // Every mutation in this file restores what it took. Proving that is not
  // optional: a suite here once left two policies in their pre-remediation form
  // and stayed green, because every assertion matched on the policy NAME. This
  // compares the whole surface — predicates, grants, memberships, role
  // attributes — against what the file found when it started.
  expect(
    await roleSurfaceFingerprint(admin, 'app_platform'),
    'this suite must leave the platform surface exactly as it found it'
  ).toBe(surfaceBaseline);
  await Promise.all([platform.end(), admin.end()]);
});

// ---------------------------------------------------------------------------
describe('removing an EXECUTE turns its path red', () => {
  it('the resolver — B2 reproduced on demand', async () => {
    await withoutPrivilege(
      () => hasExecute('iam.has_platform_authority(text)'),
      `REVOKE EXECUTE ON FUNCTION iam.has_platform_authority(text) FROM app_platform`,
      `GRANT EXECUTE ON FUNCTION iam.has_platform_authority(text) TO app_platform`,
      async () => {
        // Every platform policy calls it, so a read that worked a moment ago
        // now raises rather than answering false. That distinction IS B2.
        const code = await pathFails((db) => db.query(`SELECT count(*) FROM org.tenants`));
        expect(code).toBe('42501');
      }
    );
  });

  it('an audit helper — B1 reproduced on demand', async () => {
    await withoutPrivilege(
      () => hasExecute('iam.audit_canonical(uuid)'),
      `REVOKE EXECUTE ON FUNCTION iam.audit_canonical(uuid) FROM app_platform`,
      `GRANT EXECUTE ON FUNCTION iam.audit_canonical(uuid) TO app_platform`,
      async () => {
        const code = await pathFails((db) =>
          db.query(
            `SELECT iam.audit_append($1,$2,'user','b1.mutation','tenant',$1,NULL,NULL,NULL,'m','[]'::jsonb)`,
            [windowTenant, OPERATOR]
          )
        );
        // The writer holds EXECUTE; the helper it calls does not. Granting the
        // entry point alone is exactly the defect B1 named.
        expect(code).toBe('42501');
      }
    );
  });

  it('the entry function itself', async () => {
    await withoutPrivilege(
      () => hasExecute('org.provision_organization(jsonb, text)'),
      `REVOKE EXECUTE ON FUNCTION org.provision_organization(jsonb, text) FROM app_platform`,
      `GRANT EXECUTE ON FUNCTION org.provision_organization(jsonb, text) TO app_platform`,
      async () => {
        const code = await pathFails((db) =>
          db.query('SELECT org.provision_organization($1::jsonb, $2)', [
            JSON.stringify(spec('b1m_noexec')),
            'b1m-noexec-key',
          ])
        );
        expect(code).toBe('42501');
      }
    );
  });

  it('WITHDRAWN: B1-UG-002 was not an under-grant, and the mutation proved nothing', async () => {
    /*
     * Recorded rather than deleted, because the mistake is the useful part.
     *
     * The two narrowing readers were granted here as a repair "found by
     * execution". The 42501 that prompted it came from a PROBE that called them
     * directly — no sanctioned path does. The mutation then revoked the grant
     * and called the helper directly again, so the only thing it turned red was
     * its own probe. A test can manufacture the dependency it then verifies.
     *
     * The grants are withdrawn. What remains is a stronger property than the one
     * the grant was supposed to protect: the control plane cannot ask what
     * narrowing it carries, and no policy of its own would consult the answer.
     */
    for (const fn of ['iam.allowed_company_ids()', 'iam.allowed_branch_ids()']) {
      expect(await hasExecute(fn), fn + ' must NOT be executable by app_platform').toBe(false);
    }
    const consulting = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_policies
        WHERE 'app_platform' = ANY (roles)
          AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%allowed_%_ids%'`
    );
    expect(consulting.rows[0]!.n).toBe('0');

    // And the refusal is real, not merely absent from the catalogue.
    const code = await pathFails((db) => db.query(`SELECT iam.allowed_company_ids()`));
    expect(code).toBe('42501');
  });
});

// ---------------------------------------------------------------------------
describe('removing a table privilege turns its path red', () => {
  it('the tenant INSERT', async () => {
    await withoutPrivilege(
      () => hasTable('org.tenants', 'INSERT'),
      `REVOKE INSERT ON org.tenants FROM app_platform`,
      `GRANT INSERT ON org.tenants TO app_platform`,
      async () => {
        const code = await pathFails((db) =>
          db.query('SELECT org.provision_organization($1::jsonb, $2)', [
            JSON.stringify(spec('b1m_noins')),
            'b1m-noins-key',
          ])
        );
        expect(code).toBe('42501');
      }
    );
  });

  it('the status-column UPDATE', async () => {
    await withoutPrivilege(
      async () => {
        const r = await admin.query<{ ok: boolean }>(
          `SELECT has_column_privilege('app_platform','org.tenants','status','UPDATE') AS ok`
        );
        return r.rows[0]!.ok;
      },
      `REVOKE UPDATE (status) ON org.tenants FROM app_platform`,
      `GRANT UPDATE (status) ON org.tenants TO app_platform`,
      async () => {
        const code = await pathFails((db) =>
          db.query(`SELECT org.change_tenant_status($1,'active','mutation')`, [windowTenant])
        );
        expect(code).toBe('42501');
      }
    );
  });

  it('the history INSERT — finding 5 reproduced on demand', async () => {
    await withoutPrivilege(
      () => hasTable('org.tenant_status_history', 'INSERT'),
      `REVOKE INSERT ON org.tenant_status_history FROM app_platform`,
      `GRANT INSERT ON org.tenant_status_history TO app_platform`,
      async () => {
        // The status UPDATE succeeds and the history INSERT two statements
        // later does not, so the whole transition rolls back. This is the shape
        // the fifth design finding described, on demand.
        const code = await pathFails((db) =>
          db.query(`SELECT org.change_tenant_status($1,'active','mutation')`, [windowTenant])
        );
        expect(code).toBe('42501');
      }
    );
  });

  it('the read-back SELECT that RETURNING needs — B1-UG-001 reproduced on demand', async () => {
    await withoutPrivilege(
      () => hasPolicy('iam.user_accounts', 'sel_user_accounts_platform_bootstrap'),
      `DROP POLICY sel_user_accounts_platform_bootstrap ON iam.user_accounts`,
      RESTORE_FROM_CATALOGUE,
      async () => {
        // The plain INSERT still succeeds — which is precisely why this defect
        // survived three rounds of document review.
        await withRolledBackTx(
          platform,
          { userId: OPERATOR, tenantId: windowTenant },
          async (db) => {
            const plain = await db.query(
              `INSERT INTO iam.user_accounts
               (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
             VALUES ($1,'local','b1m-plain','p@example.invalid','P','active',$2)`,
              [windowTenant, OPERATOR]
            );
            expect(plain.rowCount).toBe(1);
          }
        );

        const code = await pathFails((db) =>
          db.query(
            `INSERT INTO iam.user_accounts
               (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
             VALUES ($1,'local','b1m-ret','r@example.invalid','R','active',$2) RETURNING id`,
            [windowTenant, OPERATOR]
          )
        );
        expect(code).toBe('42501');
      }
    );
  });
});

// ---------------------------------------------------------------------------
describe('removing a policy turns its path red', () => {
  it('the bootstrap WITH CHECK on the Owner account', async () => {
    await withoutPrivilege(
      () => hasPolicy('iam.user_accounts', 'ins_user_accounts_platform_bootstrap'),
      `DROP POLICY ins_user_accounts_platform_bootstrap ON iam.user_accounts`,
      RESTORE_FROM_CATALOGUE,
      async () => {
        const code = await pathFails((db) =>
          db.query(
            `INSERT INTO iam.user_accounts
               (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
             VALUES ($1,'local','b1m-nopol','n@example.invalid','N','active',$2)`,
            [windowTenant, OPERATOR]
          )
        );
        expect(code).toBe('42501');
      }
    );
  });

  it('the lifecycle history policy — the two paths need two policies', async () => {
    await withoutPrivilege(
      () => hasPolicy('org.tenant_status_history', 'ins_tenant_status_history_platform_lifecycle'),
      `DROP POLICY ins_tenant_status_history_platform_lifecycle ON org.tenant_status_history`,
      RESTORE_FROM_CATALOGUE,
      async () => {
        // With only the PROVISIONING history policy left, the transition fails —
        // because the status UPDATE has already moved the parent out of
        // `provisioning`, so that policy's predicate is false. This is finding
        // 5 stated as an executable fact rather than as an argument.
        const code = await pathFails((db) =>
          db.query(`SELECT org.change_tenant_status($1,'active','mutation')`, [windowTenant])
        );
        expect(code).toBe('42501');
      }
    );
  });

  it('the lifecycle WITH CHECK — the trigger is a SECOND defence, not the same one', async () => {
    /*
     * This case used to DROP the policy outright, and that made it vacuous.
     *
     * With no UPDATE policy at all, app_platform's statement matches zero rows:
     * a silent no-op, no error, and — the part that mattered — NO TRIGGER. The
     * test then asserted the tenant was still active, which was trivially true,
     * and its comment claimed to prove "the second line holds when the first is
     * gone". It would have passed identically with
     * org.guard_tenant_status_transition deleted.
     *
     * To actually exercise the trigger the policy has to ADMIT the write. So the
     * mutation now replaces the policy with one whose WITH CHECK permits
     * anything, leaving the trigger as the only thing standing between the
     * control plane and a reopened bootstrap window.
     */
    const live = await withCommittedTx(platform, { userId: OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1m_reopen')), 'b1m-reopen-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await establishOwner(live);
    await withCommittedTx(platform, { userId: OPERATOR, tenantId: live }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1,'active','go live')`, [live]);
    });

    await withoutPrivilege(
      async () =>
        (await policyDefinition('org.tenants', 'upd_tenants_platform_lifecycle')).includes(
          'status = ANY'
        ),
      `DROP POLICY upd_tenants_platform_lifecycle ON org.tenants;
       CREATE POLICY upd_tenants_platform_lifecycle ON org.tenants
         FOR UPDATE TO app_platform
         USING (iam.has_platform_authority('platform.organization.lifecycle'))
         WITH CHECK (iam.has_platform_authority('platform.organization.lifecycle'))`,
      RESTORE_FROM_CATALOGUE,
      async () => {
        // The policy now admits the row, so the statement reaches the table and
        // the trigger fires. 23514 is the trigger and nothing else: a policy
        // refusal would be 42501, and a silent no-op would be no error at all.
        let raised = '(none)';
        try {
          await withCommittedTx(platform, { userId: OPERATOR, tenantId: live }, async (db) => {
            await db.query(`UPDATE org.tenants SET status = 'provisioning' WHERE id = $1`, [live]);
          });
        } catch (err) {
          raised = (err as { code?: string }).code ?? '(none)';
        }
        expect(raised, 'the trigger must refuse, not the policy and not silence').toBe('23514');

        const after = await admin.query<{ status: string }>(
          `SELECT status FROM org.tenants WHERE id = $1`,
          [live]
        );
        expect(after.rows[0]!.status).toBe('active');
      }
    );

    // And with the real policy back, the window is refused twice over.
    const restored = await policyDefinition('org.tenants', 'upd_tenants_platform_lifecycle');
    expect(restored).toContain('status = ANY');
  });
});

// ---------------------------------------------------------------------------
describe('the table backstop survives the policy being gone', () => {
  it('refuses an illegal transition even on a connection that bypasses RLS', async () => {
    const t = await withCommittedTx(platform, { userId: OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1m_trigger')), 'b1m-trigger-key']
      );
      return r.rows[0]!.out.tenant_id;
    });

    await establishOwner(t);

    const present = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_trigger
        WHERE tgname = 'tg_tenants_status_transition' AND NOT tgisinternal`
    );
    expect(present.rows[0]!.n).toBe('1');

    // The admin connection is superuser/BYPASSRLS, so no policy applies to it.
    // Anything that refuses here is the trigger and nothing else.
    await admin.query(`UPDATE org.tenants SET status = 'active' WHERE id = $1`, [t]);
    await expect(
      admin.query(`UPDATE org.tenants SET status = 'provisioning' WHERE id = $1`, [t])
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      admin.query(`UPDATE org.tenants SET status = 'closed' WHERE id = $1`, [t])
    ).resolves.toBeTruthy();
    await expect(
      admin.query(`UPDATE org.tenants SET status = 'active' WHERE id = $1`, [t])
    ).rejects.toMatchObject({ code: '23514' });
  });
});

// ---------------------------------------------------------------------------
describe('the readiness path — B1-UG-003, B1-UG-004 and B1-UG-005', () => {
  /*
   * Three of the five under-grants live on the lifecycle path rather than the
   * bootstrap path, and none of them had a mutation until now. That mattered:
   * all three were REPAIRED in migration source, so the suites were green, but
   * nothing proved the repairs were load-bearing. A grant nobody depends on and
   * a grant nobody has removed look identical from a passing test.
   *
   * Each case provisions its own tenant. The shared windowTenant is not usable
   * here because activating it would take it out of its bootstrap window for
   * every later case in this file.
   */
  async function readyTenant(code: string): Promise<string> {
    const id = await withCommittedTx(platform, { userId: OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec(code)), code.replace(/_/g, '-') + '-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await establishOwner(id);
    return id;
  }

  /** Attempts a transition as the platform role; returns the SQLSTATE or '(none)'. */
  async function transitionFails(tenant: string, to: string): Promise<string> {
    try {
      await withCommittedTx(platform, { userId: OPERATOR, tenantId: tenant }, async (db) => {
        await db.query('SELECT org.change_tenant_status($1, $2, $3)', [tenant, to, 'b1 mutation']);
      });
    } catch (err) {
      return (err as { code?: string }).code ?? '(none)';
    }
    return '(none)';
  }

  it('the readiness function EXECUTE — B1-UG-003 reproduced on demand', async () => {
    const t = await readyTenant('b1m_ug003');
    await withoutPrivilege(
      () => hasExecute('org.tenant_has_recoverable_owner(uuid)'),
      `REVOKE EXECUTE ON FUNCTION org.tenant_has_recoverable_owner(uuid) FROM app_platform`,
      `GRANT EXECUTE ON FUNCTION org.tenant_has_recoverable_owner(uuid) TO app_platform`,
      async () => {
        // The guard trigger calls it as the WRITING role, so the privilege is
        // needed by a function the caller never names. Without it the transition
        // raises rather than being refused on its merits.
        expect(await transitionFails(t, 'active')).toBe('42501');
      }
    );
    // Restored: the same transition now succeeds, so the mutation was the cause.
    expect(await transitionFails(t, 'active')).toBe('(none)');
    const after = await admin.query<{ s: string }>(
      `SELECT status AS s FROM org.tenants WHERE id = $1`,
      [t]
    );
    expect(after.rows[0]!.s).toBe('active');
  });

  it('the tenant_id column of iam.user_accounts — B1-UG-004 reproduced on demand', async () => {
    const t = await readyTenant('b1m_ug004');
    // Three of the four columns were already granted. Only tenant_id was
    // missing, and it is the one the readiness join needs — which is why the
    // grant read as complete right up until it ran.
    for (const col of ['id', 'status', 'deleted_at']) {
      expect(await hasColumn('iam.user_accounts', col, 'SELECT')).toBe(true);
    }
    await withoutPrivilege(
      () => hasColumn('iam.user_accounts', 'tenant_id', 'SELECT'),
      `REVOKE SELECT (tenant_id) ON iam.user_accounts FROM app_platform`,
      `GRANT SELECT (tenant_id) ON iam.user_accounts TO app_platform`,
      async () => {
        expect(await transitionFails(t, 'active')).toBe('42501');
        // The other three are untouched, so this is a one-column proof.
        expect(await hasColumn('iam.user_accounts', 'id', 'SELECT')).toBe(true);
      }
    );
    expect(await transitionFails(t, 'active')).toBe('(none)');
  });

  it('the lifecycle read of role_grants — B1-UG-005 reproduced on demand', async () => {
    // B1-UG-005 is the one no negative test could have found: the failure was a
    // REFUSAL of something legitimate. So the mutation has to be driven from the
    // positive control — reactivation of a tenant that genuinely has an owner.
    const t = await readyTenant('b1m_ug005');
    expect(await transitionFails(t, 'active')).toBe('(none)');
    expect(await transitionFails(t, 'suspended')).toBe('(none)');

    await withoutPrivilege(
      () => hasPolicy('iam.role_grants', 'sel_role_grants_platform_lifecycle'),
      `DROP POLICY sel_role_grants_platform_lifecycle ON iam.role_grants`,
      RESTORE_FROM_CATALOGUE,
      async () => {
        // The grant still exists and the owner is still active. Only the control
        // plane's ability to SEE the grant has gone — and readiness, being
        // SECURITY INVOKER, therefore answers false and refuses a perfectly
        // legal reactivation. 23514, not 42501: not a privilege error, the
        // invariant firing on a false negative.
        const stillThere = await admin.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM iam.role_grants
             WHERE tenant_id = $1 AND status = 'active'`,
          [t]
        );
        expect(stillThere.rows[0]!.n).toBe('1');
        expect(await transitionFails(t, 'active')).toBe('23514');
      }
    );

    expect(await transitionFails(t, 'active')).toBe('(none)');
    const after = await admin.query<{ s: string }>(
      `SELECT status AS s FROM org.tenants WHERE id = $1`,
      [t]
    );
    expect(after.rows[0]!.s).toBe('active');
  });
});

// ---------------------------------------------------------------------------
describe('the row lock the lifecycle takes', () => {
  /*
   * org.change_tenant_status opens with SELECT status ... FOR UPDATE
   * (20260717101000:199). It is a read, so it needs both halves — the table
   * privilege and a policy that admits the row — and the two fail in visibly
   * different ways. Only one of them looks like a permission problem, which is
   * exactly why both are worth pinning.
   */
  async function lifecycleFails(tenant: string): Promise<string> {
    try {
      await withCommittedTx(platform, { userId: OPERATOR, tenantId: tenant }, async (db) => {
        await db.query('SELECT org.change_tenant_status($1, $2, $3)', [
          tenant,
          'active',
          'b1 lock mutation',
        ]);
      });
    } catch (err) {
      return (err as { code?: string }).code ?? '(none)';
    }
    return '(none)';
  }

  async function readyTenant(code: string): Promise<string> {
    const id = await withCommittedTx(platform, { userId: OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec(code)), code.replace(/_/g, '-') + '-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await establishOwner(id);
    return id;
  }

  it('removing SELECT on org.tenants stops the FOR UPDATE read', async () => {
    const t = await readyTenant('b1m_lock');
    await withoutPrivilege(
      () => hasTable('org.tenants', 'SELECT'),
      `REVOKE SELECT ON org.tenants FROM app_platform`,
      // Exactly what 20260822092000:116 grants. An earlier draft restored a
      // COLUMN list here, which reads as equivalent and is not: has_table_privilege
      // stays false after a column-only grant, so the restore assertion caught it
      // — and the run left the database under-granted for every later case.
      `GRANT SELECT ON org.tenants TO app_platform`,
      async () => {
        expect(await lifecycleFails(t)).toBe('42501');
      }
    );
    expect(await lifecycleFails(t)).toBe('(none)');
  });

  it('removing the RLS SELECT policy makes the tenant look non-existent instead', async () => {
    const t = await readyTenant('b1m_nopol');
    await withoutPrivilege(
      () => hasPolicy('org.tenants', 'sel_tenants_platform'),
      `DROP POLICY sel_tenants_platform ON org.tenants`,
      RESTORE_FROM_CATALOGUE,
      async () => {
        // Not 42501. Row-level security removes the ROW, so the lock read finds
        // nothing and the function reports that the tenant does not exist. A
        // refusal arriving in the vocabulary of absence is the harder kind to
        // diagnose, and it is worth having written down.
        expect(await lifecycleFails(t)).toBe('P0002');
        const untouched = await admin.query<{ s: string }>(
          `SELECT status AS s FROM org.tenants WHERE id = $1`,
          [t]
        );
        expect(untouched.rows[0]!.s).toBe('provisioning');
      }
    );
    expect(await lifecycleFails(t)).toBe('(none)');
  });
});

// ---------------------------------------------------------------------------
describe('the two identity SELECT policies are distinct, not redundant', () => {
  /*
   * Permissive policies combine with OR, so adding one can silently cover a gap
   * another exists to expose. Not hypothetical here: the first repair for
   * B1-UG-005 gave app_platform an unconditional lifecycle read of
   * iam.user_accounts, and it made the B1-UG-001 mutation stop reproducing —
   * the new policy answered the very read whose ABSENCE that mutation
   * demonstrates. The repair was then narrowed to accounts that actually hold an
   * active grant, which is both less privilege and a restored proof.
   *
   * This case is the standing guard on that property.
   */
  it('the lifecycle read does not cover a newly created Owner that holds no grant yet', async () => {
    const t = await withCommittedTx(platform, { userId: OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1m_interact')), 'b1m-interact-key']
      );
      return r.rows[0]!.out.tenant_id;
    });

    // The precondition that makes this an INTERACTION test rather than a repeat
    // of the B1-UG-001 mutation: the other policy is present throughout.
    expect(await hasPolicy('iam.user_accounts', 'sel_user_accounts_platform_lifecycle')).toBe(true);

    await withoutPrivilege(
      () => hasPolicy('iam.user_accounts', 'sel_user_accounts_platform_bootstrap'),
      `DROP POLICY sel_user_accounts_platform_bootstrap ON iam.user_accounts`,
      RESTORE_FROM_CATALOGUE,
      async () => {
        expect(await hasPolicy('iam.user_accounts', 'sel_user_accounts_platform_lifecycle')).toBe(
          true
        );

        // A brand-new Owner holds no grant yet, so the lifecycle policy's EXISTS
        // arm is false and it cannot answer this read. B1-UG-001 reproduces.
        let code = '(none)';
        try {
          await withRolledBackTx(platform, { userId: OPERATOR, tenantId: t }, async (db) => {
            await db.query(
              `INSERT INTO iam.user_accounts
                 (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
               VALUES ($1,'local','b1m-int','i@example.invalid','I','active',$2) RETURNING id`,
              [t, OPERATOR]
            );
          });
        } catch (err) {
          code = (err as { code?: string }).code ?? '(none)';
        }
        expect(code).toBe('42501');

        // The other half of distinctness: once an account DOES hold an active
        // grant, the lifecycle policy admits it — narrowly, and on its own.
        //
        // The fixture is built on the ADMIN connection, deliberately. Building it
        // through the platform path would need INSERT ... RETURNING on
        // iam.user_accounts, which is the exact read this mutation has removed —
        // the setup would fail for the reason under test and prove nothing.
        await admin.query(
          `INSERT INTO iam.user_accounts
             (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
           VALUES ($1,'local','b1m-int-owner','int-owner@example.invalid','Int Owner','active',$2)`,
          [t, SYSTEM]
        );
        await admin.query(
          `INSERT INTO iam.roles (tenant_id, role_code, name, created_by)
           VALUES ($1,'company_owner','Company Owner',$2)`,
          [t, SYSTEM]
        );
        await admin.query(
          `INSERT INTO iam.role_grants
             (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
           SELECT $1, u.id, r.id, 'unrestricted', 'active', $2, $2
             FROM iam.user_accounts u, iam.roles r
            WHERE u.tenant_id = $1 AND u.provider_subject = 'b1m-int-owner'
              AND r.tenant_id = $1 AND r.role_code = 'company_owner'`,
          [t, SYSTEM]
        );
        const seen = await withRolledBackTx(
          platform,
          { userId: OPERATOR, tenantId: t },
          async (db) => {
            const r = await db.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM iam.user_accounts WHERE tenant_id = $1`,
              [t]
            );
            return r.rows[0]!.n;
          }
        );
        expect(seen).toBe('1');
      }
    );
  });
});
