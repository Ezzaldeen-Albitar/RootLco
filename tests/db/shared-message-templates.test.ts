/**
 * Phase 1-5 Increment E — shared.message_templates / shared.template_versions
 * (P1-05-DB-007, P1-05-DB-008).
 *
 * Covers dual-scope visibility, scope mirroring, structural active-version
 * ownership, initial-state and one-way lifecycle guards, immutable approved
 * content, activation/retirement serialization, concurrent approval, tenant
 * isolation under FORCE RLS, and SELECT-only runtime grants.
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
  USER_B,
  withCommittedTx,
  withRolledBackTx,
} from './helpers';

const ACTOR = USER_A;

// Deterministic Increment-E fixture ids with a fresh e4 prefix. Committed only
// for this suite and removed by cleanFixtures in afterAll.
const TEMPLATE_PLATFORM = 'e4000000-0000-4000-8000-000000000001';
const TEMPLATE_A = 'e4000000-0000-4000-8000-0000000000a1';
const TEMPLATE_B = 'e4000000-0000-4000-8000-0000000000b1';
const VERSION_PLATFORM = 'e4100000-0000-4000-8000-000000000001';
const VERSION_A_APPROVED = 'e4100000-0000-4000-8000-0000000000a1';
const VERSION_A_DRAFT = 'e4100000-0000-4000-8000-0000000000a2';
const VERSION_B_APPROVED = 'e4100000-0000-4000-8000-0000000000b1';
const VERSION_CONCURRENT = 'e4100000-0000-4000-8000-0000000000c1';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  await withCommittedTx(admin, {}, async (c) => {
    await c.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES
         ($1,$2,'fixture','e4-user-a','e4-user-a@example.invalid','E4 User A','active',$1),
         ($3,$4,'fixture','e4-user-b','e4-user-b@example.invalid','E4 User B','active',$1)`,
      [USER_A, TENANT_A, USER_B, TENANT_B]
    );

    await c.query(
      `INSERT INTO shared.message_templates
         (id, scope, tenant_id, template_code, name, channel, purpose, locale_code, description, created_by)
       VALUES
         ($1,'platform',NULL,'fx_receipt','Receipt','email','transactional','en','Platform fixture',$4),
         ($2,'tenant',$5,'receipt','Receipt','email','transactional','en','Tenant A fixture',$4),
         ($3,'tenant',$6,'receipt','Receipt','email','transactional','en','Tenant B fixture',$4)`,
      [TEMPLATE_PLATFORM, TEMPLATE_A, TEMPLATE_B, ACTOR, TENANT_A, TENANT_B]
    );

    await c.query(
      `INSERT INTO shared.template_versions
         (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
       VALUES
         ($1,NULL,$2,1,'Platform subject','Platform body',extensions.digest('Platform subject|Platform body','sha256'),$8),
         ($3,$9,$4,1,'Tenant A subject','Tenant A body',extensions.digest('Tenant A subject|Tenant A body','sha256'),$8),
         ($5,$9,$4,2,'Tenant A draft','Tenant A draft body',extensions.digest('Tenant A draft|Tenant A draft body','sha256'),$8),
         ($6,$10,$7,1,'Tenant B subject','Tenant B body',extensions.digest('Tenant B subject|Tenant B body','sha256'),$8)`,
      [
        VERSION_PLATFORM,
        TEMPLATE_PLATFORM,
        VERSION_A_APPROVED,
        TEMPLATE_A,
        VERSION_A_DRAFT,
        VERSION_B_APPROVED,
        TEMPLATE_B,
        ACTOR,
        TENANT_A,
        TENANT_B,
      ]
    );

    await c.query(
      `UPDATE shared.template_versions
          SET status = 'approved', approved_by = $1
        WHERE id = ANY($2::uuid[])`,
      [ACTOR, [VERSION_PLATFORM, VERSION_A_APPROVED]]
    );
    await c.query(
      `UPDATE shared.template_versions
          SET status = 'approved', approved_by = $1
        WHERE id = $2`,
      [USER_B, VERSION_B_APPROVED]
    );
  });
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('shared.message_templates — dual-scope identity and activation', () => {
  it('records platform and tenant identities with no initial active version', async () => {
    const { rows } = await admin.query(
      `SELECT scope, tenant_id, active_version_id, status
       FROM shared.message_templates WHERE id=$1`,
      [TEMPLATE_PLATFORM]
    );
    expect(rows[0]).toEqual({
      scope: 'platform',
      tenant_id: null,
      active_version_id: null,
      status: 'active',
    });
  });

  it('rejects inconsistent scope/tenant combinations', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.message_templates
             (scope, tenant_id, template_code, name, channel, purpose, locale_code, created_by)
           VALUES ('platform',$1,'fx_bad_scope','Bad scope','email','system','en',$2)`,
          [TENANT_A, ACTOR]
        ),
        '23514'
      )
    );
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.message_templates
             (scope, tenant_id, template_code, name, channel, purpose, locale_code, created_by)
           VALUES ('tenant',NULL,'fx_bad_tenant','Bad tenant','email','system','en',$1)`,
          [ACTOR]
        ),
        '23514'
      )
    );
  });

  it('enforces platform identity uniqueness while allowing the same tenant identity across tenants', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.message_templates
             (scope, template_code, name, channel, purpose, locale_code, created_by)
           VALUES ('platform','fx_receipt','Receipt duplicate','email','transactional','en',$1)`,
          [ACTOR]
        ),
        '23505'
      )
    );
    const both = await admin.query(
      `SELECT tenant_id FROM shared.message_templates
       WHERE template_code='receipt' ORDER BY tenant_id`
    );
    expect(both.rows).toHaveLength(2);
  });

  it('requires a known locale and preserves immutable identity columns', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.message_templates
             (scope, template_code, name, channel, purpose, locale_code, created_by)
           VALUES ('platform','fx_unknown_locale','Unknown locale','email','system','zz',$1)`,
          [ACTOR]
        ),
        '23503'
      )
    );
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.message_templates SET template_code='renamed' WHERE id=$1`, [
          TEMPLATE_A,
        ]),
        '23514'
      )
    );
  });

  it('rejects an invalid purpose', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.message_templates
             (scope, template_code, name, channel, purpose, locale_code, created_by)
           VALUES ('platform','fx_bad_purpose','Bad purpose','email','invalid','en',$1)`,
          [ACTOR]
        ),
        '23514'
      )
    );
  });

  it('rejects a blank name', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.message_templates
             (scope, template_code, name, channel, purpose, locale_code, created_by)
           VALUES ('platform','fx_blank_name','   ','email','system','en',$1)`,
          [ACTOR]
        ),
        '23514'
      )
    );
  });

  it('rejects INSERT with active_version_id even when the version is approved', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.message_templates
             (scope, tenant_id, template_code, name, channel, purpose, locale_code, active_version_id, created_by)
           VALUES ('tenant',$1,'insert_active','Insert active','email','system','en',$2,$3)`,
          [TENANT_A, VERSION_A_APPROVED, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('activates an approved own version', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(`UPDATE shared.message_templates SET active_version_id=$1 WHERE id=$2`, [
        VERSION_A_APPROVED,
        TEMPLATE_A,
      ]);
      const { rows } = await c.query(
        `SELECT active_version_id FROM shared.message_templates WHERE id=$1`,
        [TEMPLATE_A]
      );
      expect(rows[0].active_version_id).toBe(VERSION_A_APPROVED);
    });
  });

  it('rejects activation of a draft version', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.message_templates SET active_version_id=$1 WHERE id=$2`, [
          VERSION_A_DRAFT,
          TEMPLATE_A,
        ]),
        '23514'
      )
    );
  });

  it("rejects another template's approved version through the structural FK", async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.message_templates SET active_version_id=$1 WHERE id=$2`, [
          VERSION_B_APPROVED,
          TEMPLATE_A,
        ]),
        '23503'
      )
    );
  });

  it('runtime sees platform plus own-tenant templates only and cannot write', async () => {
    const own = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.message_templates ORDER BY id`)
    );
    const ids = own.rows.map((r) => r.id);
    expect(ids).toContain(TEMPLATE_PLATFORM);
    expect(ids).toContain(TEMPLATE_A);
    expect(ids).not.toContain(TEMPLATE_B);

    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.message_templates
             (scope, tenant_id, template_code, name, channel, purpose, locale_code, created_by)
           VALUES ('tenant',$1,'no_runtime_write','No runtime write','email','system','en',$2)`,
          [TENANT_A, ACTOR]
        ),
        '42501'
      )
    );
  });
});

describe('shared.template_versions — scope and governed lifecycle', () => {
  it('mirrors platform and tenant scope and exposes approved stamps', async () => {
    const { rows } = await admin.query(
      `SELECT tenant_id, status, approved_at IS NOT NULL AS stamped, approved_by, retired_at
       FROM shared.template_versions WHERE id=$1`,
      [VERSION_A_APPROVED]
    );
    expect(rows[0]).toEqual({
      tenant_id: TENANT_A,
      status: 'approved',
      stamped: true,
      approved_by: ACTOR,
      retired_at: null,
    });
  });

  it('rejects a version whose tenant_id does not mirror its template', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.template_versions
             (tenant_id, template_id, version_number, body, content_hash, created_by)
           VALUES ($1,$2,9,'wrong scope',extensions.digest('wrong scope','sha256'),$3)`,
          [TENANT_B, TEMPLATE_A, ACTOR]
        ),
        '23514'
      )
    );
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.template_versions
             (tenant_id, template_id, version_number, body, content_hash, created_by)
           VALUES ($1,$2,9,'platform mismatch',extensions.digest('platform mismatch','sha256'),$3)`,
          [TENANT_A, TEMPLATE_PLATFORM, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('rejects direct INSERT as approved or retired', async () => {
    for (const status of ['approved', 'retired']) {
      await withRolledBackTx(admin, {}, (c) =>
        expectSqlState(
          c.query(
            `INSERT INTO shared.template_versions
               (tenant_id, template_id, version_number, body, content_hash, status,
                approved_at, approved_by, retired_at, created_by)
             VALUES ($1,$2,20,'terminal insert',extensions.digest('terminal insert','sha256'),$3,
                     now(),$4,CASE WHEN $3='retired' THEN now() ELSE NULL END,$4)`,
            [TENANT_A, TEMPLATE_A, status, ACTOR]
          ),
          '23514'
        )
      );
    }
  });

  it('rejects approval without approved_by', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.template_versions SET status='approved' WHERE id=$1`, [
          VERSION_A_DRAFT,
        ]),
        '23514'
      )
    );
  });

  it('rejects invalid content hashes', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO shared.template_versions
             (tenant_id, template_id, version_number, body, content_hash, created_by)
           VALUES ($1,$2,21,'bad hash',decode('00','hex'),$3)`,
          [TENANT_A, TEMPLATE_A, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('keeps approved content immutable', async () => {
    await withRolledBackTx(admin, {}, (c) =>
      expectSqlState(
        c.query(`UPDATE shared.template_versions SET body='changed' WHERE id=$1`, [
          VERSION_A_APPROVED,
        ]),
        '23514'
      )
    );
  });

  it('rejects retirement while active', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(`UPDATE shared.message_templates SET active_version_id=$1 WHERE id=$2`, [
        VERSION_A_APPROVED,
        TEMPLATE_A,
      ]);
      await expectSqlState(
        c.query(`UPDATE shared.template_versions SET status='retired' WHERE id=$1`, [
          VERSION_A_APPROVED,
        ]),
        '23514'
      );
    });
  });

  it('retires after deactivation and server-stamps retired_at', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(`UPDATE shared.message_templates SET active_version_id=$1 WHERE id=$2`, [
        VERSION_A_APPROVED,
        TEMPLATE_A,
      ]);
      await c.query(`UPDATE shared.message_templates SET active_version_id=NULL WHERE id=$1`, [
        TEMPLATE_A,
      ]);
      const { rows } = await c.query(
        `UPDATE shared.template_versions SET status='retired' WHERE id=$1
         RETURNING status, approved_at IS NOT NULL AS approved, approved_by, retired_at IS NOT NULL AS retired`,
        [VERSION_A_APPROVED]
      );
      expect(rows[0]).toEqual({
        status: 'retired',
        approved: true,
        approved_by: ACTOR,
        retired: true,
      });
    });
  });

  it('allows exactly one winner when two transactions approve the same draft', async () => {
    await withCommittedTx(admin, {}, (c) =>
      c.query(
        `INSERT INTO shared.template_versions
           (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
         VALUES ($1,$2,$3,30,'Concurrent','Concurrent body',
                 extensions.digest('Concurrent|Concurrent body','sha256'),$4)`,
        [VERSION_CONCURRENT, TENANT_A, TEMPLATE_A, ACTOR]
      )
    );

    const approve = () =>
      withCommittedTx(admin, {}, async (c) => {
        await c.query(`SET LOCAL statement_timeout = '5s'`);
        return c.query(
          `UPDATE shared.template_versions
              SET status='approved', approved_by=$1
            WHERE id=$2
            RETURNING id`,
          [ACTOR, VERSION_CONCURRENT]
        );
      });

    const outcomes = await Promise.allSettled([approve(), approve()]);
    expect(outcomes.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter((result) => result.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.code).toBe('23514');

    const { rows } = await admin.query(
      `SELECT status, approved_at IS NOT NULL AS stamped
       FROM shared.template_versions WHERE id=$1`,
      [VERSION_CONCURRENT]
    );
    expect(rows[0]).toEqual({ status: 'approved', stamped: true });
  });

  it('runtime sees platform plus own-tenant versions only', async () => {
    const own = await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      c.query(`SELECT id FROM shared.template_versions ORDER BY id`)
    );
    const ids = own.rows.map((r) => r.id);
    expect(ids).toContain(VERSION_PLATFORM);
    expect(ids).toContain(VERSION_A_APPROVED);
    expect(ids).not.toContain(VERSION_B_APPROVED);
  });
});
