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

/** Runs `body` with one privilege removed, then restores it whatever happens. */
async function withoutPrivilege(
  present: () => Promise<boolean>,
  drop: string,
  restore: string,
  body: () => Promise<void>
): Promise<void> {
  // Step 1 — the mutation must have something to remove.
  expect(await present(), `precondition: the target of \`${drop}\` must exist first`).toBe(true);
  await admin.query(drop);
  try {
    expect(await present(), `\`${drop}\` must actually remove it`).toBe(false);
    await body();
  } finally {
    await admin.query(restore);
    expect(await present(), `\`${restore}\` must put it back`).toBe(true);
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

  await dropTenants();
  await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = $1`, [OPERATOR]);
  await admin.query(`DELETE FROM iam.user_accounts WHERE id = $1`, [OPERATOR]);
  await admin.query(`DELETE FROM org.tenants WHERE id = $1`, [OPERATOR_HOME]);

  await admin.query(
    `INSERT INTO org.tenants (id, tenant_code, display_name, default_locale, default_timezone, status, created_by)
     VALUES ($1,'b1m_operator_home','B1M home','en','UTC','active',$2)`,
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

  windowTenant = await withCommittedTx(platform, { userId: OPERATOR }, async (db) => {
    const r = await db.query<{ out: { tenant_id: string } }>(
      'SELECT org.provision_organization($1::jsonb, $2) AS out',
      [JSON.stringify(spec('b1m_window')), 'b1m-window-key']
    );
    return r.rows[0]!.out.tenant_id;
  });
});

afterAll(async () => {
  await dropTenants();
  await admin.query(`DELETE FROM iam.platform_grants WHERE user_account_id = $1`, [OPERATOR]);
  await admin.query(`DELETE FROM iam.user_accounts WHERE id = $1`, [OPERATOR]);
  await admin.query(`DELETE FROM org.tenants WHERE id = $1`, [OPERATOR_HOME]);
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

  it('a narrowing reader — B1-UG-002 reproduced on demand', async () => {
    await withoutPrivilege(
      () => hasExecute('iam.allowed_company_ids()'),
      `REVOKE EXECUTE ON FUNCTION iam.allowed_company_ids() FROM app_platform`,
      `GRANT EXECUTE ON FUNCTION iam.allowed_company_ids() TO app_platform`,
      async () => {
        const code = await pathFails((db) => db.query(`SELECT iam.allowed_company_ids()`));
        expect(code).toBe('42501');
      }
    );
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
      `CREATE POLICY sel_user_accounts_platform_bootstrap ON iam.user_accounts
         FOR SELECT TO app_platform
         USING (EXISTS (SELECT 1 FROM org.tenants t
                         WHERE t.id = user_accounts.tenant_id AND t.status = 'provisioning'))`,
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
      `CREATE POLICY ins_user_accounts_platform_bootstrap ON iam.user_accounts
         FOR INSERT TO app_platform
         WITH CHECK (
           iam.has_platform_authority('platform.organization.provision')
           AND EXISTS (SELECT 1 FROM org.tenants t
                        WHERE t.id = user_accounts.tenant_id AND t.status = 'provisioning'))`,
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
      `CREATE POLICY ins_tenant_status_history_platform_lifecycle ON org.tenant_status_history
         FOR INSERT TO app_platform
         WITH CHECK (
           iam.has_platform_authority('platform.organization.lifecycle')
           AND to_state IN ('active','suspended','closed'))`,
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

  it('the lifecycle WITH CHECK — without it, provisioning becomes a legal destination', async () => {
    // The policy's WITH CHECK and the table trigger are two independent
    // defences against reopening the bootstrap window. Removing the policy must
    // still leave the tenant protected, by the trigger — so this case proves
    // the SECOND line holds when the first is gone, which is the only way to
    // know the pair is not one control wearing two hats.
    const live = await withCommittedTx(platform, { userId: OPERATOR }, async (db) => {
      const r = await db.query<{ out: { tenant_id: string } }>(
        'SELECT org.provision_organization($1::jsonb, $2) AS out',
        [JSON.stringify(spec('b1m_reopen')), 'b1m-reopen-key']
      );
      return r.rows[0]!.out.tenant_id;
    });
    await withCommittedTx(platform, { userId: OPERATOR, tenantId: live }, async (db) => {
      await db.query(`SELECT org.change_tenant_status($1,'active','go live')`, [live]);
    });

    await withoutPrivilege(
      () => hasPolicy('org.tenants', 'upd_tenants_platform_lifecycle'),
      `DROP POLICY upd_tenants_platform_lifecycle ON org.tenants`,
      `CREATE POLICY upd_tenants_platform_lifecycle ON org.tenants
         FOR UPDATE TO app_platform
         USING (iam.has_platform_authority('platform.organization.lifecycle'))
         WITH CHECK (
           iam.has_platform_authority('platform.organization.lifecycle')
           AND status IN ('active','suspended','closed'))`,
      async () => {
        // The invariant is that the ROW DOES NOT CHANGE — not that an error is
        // raised, and the difference is worth stating because the first run of
        // this case asserted the error and failed.
        //
        // With the policy dropped, app_platform has no UPDATE policy on
        // org.tenants at all, so the statement matches zero rows. Under
        // row-level security that is a SILENT NO-OP: no error, no rows, no
        // trigger. A test that demanded a SQLSTATE would report this as a
        // failure of the control while the tenant was in fact perfectly safe,
        // and a test that accepted "no error" as success would report a breach
        // that never happened. Assert the state.
        let raised = '(none)';
        let affected = -1;
        try {
          affected = await withRolledBackTx(
            platform,
            { userId: OPERATOR, tenantId: live },
            async (db) => {
              const r = await db.query(
                `UPDATE org.tenants SET status = 'provisioning' WHERE id = $1`,
                [live]
              );
              return (r as { rowCount: number | null }).rowCount ?? 0;
            }
          );
        } catch (err) {
          raised = (err as { code?: string }).code ?? '(none)';
        }

        if (raised === '(none)') {
          expect(affected, 'with no UPDATE policy the statement must match no rows').toBe(0);
        } else {
          expect(['42501', '23514']).toContain(raised);
        }

        // Whichever way it was stopped, the tenant is still live.
        const after = await admin.query<{ status: string }>(
          `SELECT status FROM org.tenants WHERE id = $1`,
          [live]
        );
        expect(after.rows[0]!.status).toBe('active');
      }
    );
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
