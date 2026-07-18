/**
 * Phase 1-5 Increment I — shared settings and localization
 * (P1-05-DB-014, P1-05-DB-015, P1-05-QA-006).
 *
 * Covers immutable version allocation, typed JSON validation, runtime setting
 * resolution, tenant isolation, governed localization lifecycle, the
 * one-approved-text referee, missing-translation reporting, and SELECT-only
 * application-role posture.
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
  withRolledBackTx,
} from './helpers';

const SYS = '00000000-0000-4000-8000-000000000001';
const VISIBLE_KEY = 'f8100000-0000-4000-8000-000000000001';
const VISIBLE_TEXT = 'f8200000-0000-4000-8000-000000000001';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  await admin.query(
    `INSERT INTO shared.system_settings
       (scope, tenant_id, setting_key, setting_value, value_type, version, created_by)
     VALUES
       ('platform',NULL,'fx_override','"platform-v1"','string',1,$1),
       ('platform',NULL,'fx_override','"platform-v2"','string',2,$1),
       ('tenant',$2,'fx_override','"tenant-a"','string',1,$1),
       ('tenant',$3,'fx_override','"tenant-b"','string',1,$1),
       ('platform',NULL,'fx_fallback','42','number',1,$1),
       ('platform',NULL,'fx_version_bump','"old"','string',1,$1)`,
    [SYS, TENANT_A, TENANT_B]
  );

  await admin.query(
    `INSERT INTO shared.localization_keys
       (id, key_code, context, description, created_by)
     VALUES ($1,'fx_visible','Runtime visibility fixture','Ephemeral test key',$2)`,
    [VISIBLE_KEY, SYS]
  );
  await admin.query(
    `INSERT INTO shared.localized_texts
       (id, key_id, locale_code, version, text_value, created_by)
     VALUES ($1,$2,'en',1,'Visible draft',$3)`,
    [VISIBLE_TEXT, VISIBLE_KEY, SYS]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('shared.system_settings — immutable versioned rows', () => {
  it('stores platform and tenant versions and resolves current as highest version', async () => {
    const { rows } = await admin.query(
      `SELECT scope, tenant_id, version, setting_value
       FROM shared.system_settings
       WHERE setting_key='fx_override'
       ORDER BY scope, tenant_id NULLS FIRST, version`
    );
    expect(rows).toHaveLength(4);
    expect(rows.filter((r) => r.scope === 'platform').map((r) => r.version)).toEqual([1, 2]);
    expect(rows.filter((r) => r.scope === 'tenant')).toHaveLength(2);
  });

  it('rejects a duplicate tenant allocation with 23505', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(
        `INSERT INTO shared.system_settings
           (scope, tenant_id, setting_key, setting_value, value_type, version, created_by)
         VALUES ('tenant',$1,'fx_dup_tenant','true','boolean',1,$2)`,
        [TENANT_A, SYS]
      );
      await expectSqlState(
        c.query(
          `INSERT INTO shared.system_settings
             (scope, tenant_id, setting_key, setting_value, value_type, version, created_by)
           VALUES ('tenant',$1,'fx_dup_tenant','false','boolean',1,$2)`,
          [TENANT_A, SYS]
        ),
        '23505'
      );
    });
  });

  it('uses NULLS NOT DISTINCT to reject two platform rows at the same key/version', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      await c.query(
        `INSERT INTO shared.system_settings
           (scope, tenant_id, setting_key, setting_value, value_type, version, created_by)
         VALUES ('platform',NULL,'fx_dup_platform','true','boolean',1,$1)`,
        [SYS]
      );
      await expectSqlState(
        c.query(
          `INSERT INTO shared.system_settings
             (scope, tenant_id, setting_key, setting_value, value_type, version, created_by)
           VALUES ('platform',NULL,'fx_dup_platform','false','boolean',1,$1)`,
          [SYS]
        ),
        '23505'
      );
    });
  });

  it('reuses org.validate_setting_value and rejects every declared-type mismatch', async () => {
    const trigger = await admin.query(
      `SELECT pn.nspname AS function_schema, p.proname AS function_name
       FROM pg_trigger t
       JOIN pg_class c ON c.oid=t.tgrelid
       JOIN pg_namespace n ON n.oid=c.relnamespace
       JOIN pg_proc p ON p.oid=t.tgfoid
       JOIN pg_namespace pn ON pn.oid=p.pronamespace
       WHERE n.nspname='shared' AND c.relname='system_settings'
         AND t.tgname='tg_system_settings_validate_value'`
    );
    expect(trigger.rows[0]).toEqual({
      function_schema: 'org',
      function_name: 'validate_setting_value',
    });

    const mismatches = [
      ['string', '123'],
      ['number', '"not-number"'],
      ['boolean', '0'],
      ['json', 'true'],
    ] as const;
    for (const [valueType, jsonValue] of mismatches) {
      await withRolledBackTx(admin, {}, async (c) => {
        await expectSqlState(
          c.query(
            `INSERT INTO shared.system_settings
               (scope, setting_key, setting_value, value_type, version, created_by)
             VALUES ('platform',$1,$2::jsonb,$3,1,$4)`,
            [`fx_type_${valueType}`, jsonValue, valueType, SYS]
          ),
          '23514'
        );
      });
    }
  });

  it('rejects an actual change to every column, including record_version', async () => {
    const setting = await admin.query(
      `SELECT id FROM shared.system_settings
       WHERE scope='platform' AND setting_key='fx_fallback' AND version=1`
    );
    const id = setting.rows[0].id as string;
    const changes = [
      `id = gen_random_uuid()`,
      `scope = 'tenant'`,
      `tenant_id = '${TENANT_A}'::uuid`,
      `setting_key = 'fx_changed'`,
      `setting_value = '43'::jsonb`,
      `value_type = 'json'`,
      `is_sensitive = NOT is_sensitive`,
      `version = version + 1`,
      `effective_from = effective_from + interval '1 second'`,
      `record_version = record_version + 1`,
      `created_at = created_at + interval '1 second'`,
      `created_by = '${USER_A}'::uuid`,
    ];
    for (const assignment of changes) {
      await withRolledBackTx(admin, {}, async (c) => {
        await expectSqlState(
          c.query(`UPDATE shared.system_settings SET ${assignment} WHERE id=$1`, [id]),
          '23514'
        );
      });
    }
  });

  it('resolves tenant override, platform fallback, and no-context platform only via runtime', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      const { rows } = await c.query(
        `SELECT shared.resolve_setting('fx_override') AS overridden,
                shared.resolve_setting('fx_fallback') AS fallback`
      );
      expect(rows[0]).toEqual({ overridden: 'tenant-a', fallback: 42 });
    });

    await withRolledBackTx(runtime, {}, async (c) => {
      const { rows } = await c.query(`SELECT shared.resolve_setting('fx_override') AS value`);
      expect(rows[0].value).toBe('platform-v2');
    });
  });

  it('changes the current value only by INSERTing version n+1', async () => {
    await admin.query(
      `INSERT INTO shared.system_settings
         (scope, setting_key, setting_value, value_type, version, created_by)
       VALUES ('platform','fx_version_bump','"new"','string',2,$1)`,
      [SYS]
    );
    await withRolledBackTx(runtime, {}, async (c) => {
      const { rows } = await c.query(`SELECT shared.resolve_setting('fx_version_bump') AS value`);
      expect(rows[0].value).toBe('new');
    });
  });
});

describe('shared localization — governed platform content', () => {
  it('creates a key, reports it missing, approves once, retires, and approves its replacement', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const key = await c.query(
        `INSERT INTO shared.localization_keys
           (key_code, context, description, created_by)
         VALUES ('fx_workflow','Vehicle card','Ephemeral workflow key',$1)
         RETURNING id`,
        [SYS]
      );
      const keyId = key.rows[0].id as string;
      const texts = await c.query(
        `INSERT INTO shared.localized_texts
           (key_id, locale_code, version, text_value, created_by)
         VALUES
           ($1,'en',1,'Vehicle',$2),
           ($1,'en',2,'Vehicle replacement',$2)
         RETURNING id, version`,
        [keyId, SYS]
      );
      const v1 = texts.rows.find((r) => r.version === 1)?.id as string;
      const v2 = texts.rows.find((r) => r.version === 2)?.id as string;

      const before = await c.query(`SELECT * FROM shared.missing_translations('en')`);
      expect(before.rows.map((r) => r.missing_translations)).toContain('fx_workflow');

      await c.query(
        `UPDATE shared.localized_texts SET status='approved', approved_by=$1 WHERE id=$2`,
        [USER_A, v1]
      );
      const approved = await c.query(
        `SELECT status, approved_at IS NOT NULL AS stamped
         FROM shared.localized_texts WHERE id=$1`,
        [v1]
      );
      expect(approved.rows[0]).toEqual({ status: 'approved', stamped: true });

      await c.query('SAVEPOINT second_approval');
      await expectSqlState(
        c.query(`UPDATE shared.localized_texts SET status='approved', approved_by=$1 WHERE id=$2`, [
          USER_B,
          v2,
        ]),
        '23505'
      );
      await c.query('ROLLBACK TO SAVEPOINT second_approval');

      await c.query('SAVEPOINT immutable_content');
      await expectSqlState(
        c.query(`UPDATE shared.localized_texts SET text_value='Changed' WHERE id=$1`, [v1]),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT immutable_content');

      await c.query(`UPDATE shared.localized_texts SET status='retired' WHERE id=$1`, [v1]);
      await c.query(
        `UPDATE shared.localized_texts SET status='approved', approved_by=$1 WHERE id=$2`,
        [USER_B, v2]
      );

      const final = await c.query(
        `SELECT version, status, approved_at IS NOT NULL AS approved_stamped,
                retired_at IS NOT NULL AS retired_stamped
         FROM shared.localized_texts WHERE key_id=$1 ORDER BY version`,
        [keyId]
      );
      expect(final.rows).toEqual([
        { version: 1, status: 'retired', approved_stamped: true, retired_stamped: true },
        { version: 2, status: 'approved', approved_stamped: true, retired_stamped: false },
      ]);

      const after = await c.query(`SELECT * FROM shared.missing_translations('en')`);
      expect(after.rows.map((r) => r.missing_translations)).not.toContain('fx_workflow');
    });
  });

  it('rejects direct INSERT as approved even when approval fields are supplied', async () => {
    await withRolledBackTx(admin, {}, async (c) => {
      const key = await c.query(
        `INSERT INTO shared.localization_keys (key_code, description, created_by)
         VALUES ('fx_direct_approved','Direct-state guard fixture',$1) RETURNING id`,
        [SYS]
      );
      await expectSqlState(
        c.query(
          `INSERT INTO shared.localized_texts
             (key_id, locale_code, version, text_value, status, approved_at, approved_by, created_by)
           VALUES ($1,'en',1,'Forbidden','approved',now(),$2,$3)`,
          [key.rows[0].id, USER_A, SYS]
        ),
        '23514'
      );
    });
  });

  it('rejects an unregistered locale in missing_translations with invalid_parameter_value', async () => {
    await withRolledBackTx(runtime, {}, async (c) => {
      await expectSqlState(c.query(`SELECT * FROM shared.missing_translations('zz')`), '22023');
    });
  });
});

describe('runtime grants and RLS', () => {
  it('shows platform plus own-tenant settings and never another tenant setting', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      const { rows } = await c.query(
        `SELECT DISTINCT tenant_id FROM shared.system_settings
         WHERE setting_key='fx_override' ORDER BY tenant_id NULLS FIRST`
      );
      expect(rows).toEqual([{ tenant_id: null }, { tenant_id: TENANT_A }]);
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_B }, async (c) => {
      const { rows } = await c.query(
        `SELECT DISTINCT tenant_id FROM shared.system_settings
         WHERE setting_key='fx_override' ORDER BY tenant_id NULLS FIRST`
      );
      expect(rows).toEqual([{ tenant_id: null }, { tenant_id: TENANT_B }]);
    });
  });

  it('makes the platform localization catalogue/content readable to every tenant', async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await withRolledBackTx(runtime, { tenantId }, async (c) => {
        const { rows } = await c.query(
          `SELECT k.key_code, t.text_value
           FROM shared.localization_keys k
           JOIN shared.localized_texts t ON t.key_id=k.id
           WHERE k.id=$1 AND t.id=$2`,
          [VISIBLE_KEY, VISIBLE_TEXT]
        );
        expect(rows).toEqual([{ key_code: 'fx_visible', text_value: 'Visible draft' }]);
      });
    }
  });

  it('denies runtime writes on system_settings, localization_keys, and localized_texts', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.system_settings
             (scope, tenant_id, setting_key, setting_value, value_type, version, created_by)
           VALUES ('tenant',$1,'fx_runtime_write','true','boolean',1,$2)`,
          [TENANT_A, USER_A]
        ),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.localization_keys (key_code, description, created_by)
           VALUES ('fx_runtime_key','Forbidden',$1)`,
          [USER_A]
        ),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO shared.localized_texts
             (key_id, locale_code, version, text_value, created_by)
           VALUES ($1,'en',2,'Forbidden',$2)`,
          [VISIBLE_KEY, USER_A]
        ),
        '42501'
      );
    });
  });
});
