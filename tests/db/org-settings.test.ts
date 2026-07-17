/**
 * Phase 1-3 — versioned settings, tax foundation, feature overrides and
 * resolution precedence (P1-03-DB-012/014/015, P1-03-QA-005 subset).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  BRANCH_A1,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  TENANT_A,
  TENANT_B,
  USER_A,
  withRolledBackTx,
} from './helpers';

const SYS = '00000000-0000-4000-8000-000000000001';
const T0 = '2026-01-01T00:00:00Z';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  // Feature-resolution fixtures: default false, plan entitles TRUE for tenant A.
  await admin.query(
    `INSERT INTO org.feature_flags (flag_code, name, default_enabled, created_by)
     VALUES ('fx_feat', 'Resolution fixture flag', false, $1)
     ON CONFLICT (flag_code) DO NOTHING`,
    [SYS]
  );
  const plan = await admin.query(
    `INSERT INTO org.subscription_plans (plan_code, name, entitlement_document, status, effective_from, created_by)
     VALUES ('fx_res', 'Resolution plan', '{"fx_feat": true}', 'active', $1, $2) RETURNING id`,
    [T0, SYS]
  );
  await admin.query(
    `INSERT INTO org.tenant_subscriptions (tenant_id, plan_id, status, effective_from, assigned_by, created_by)
     VALUES ($1, $2, 'active', $3, $4, $4)`,
    [TENANT_A, plan.rows[0].id, T0, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('org.company_settings / org.branch_settings — versioned, append-only', () => {
  it('a change is a NEW VERSION; both versions stay readable; current = max(version)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query(
        `INSERT INTO org.company_settings (tenant_id, company_id, setting_key, setting_value, value_type, version, created_by)
         VALUES ($1, $2, 'invoice.footer', '"v1 footer"', 'string', 1, $3),
                ($1, $2, 'invoice.footer', '"v2 footer"', 'string', 2, $3)`,
        [TENANT_A, COMPANY_A1, USER_A]
      );
      const all = await c.query(
        `SELECT version, setting_value FROM org.company_settings
         WHERE setting_key = 'invoice.footer' ORDER BY version`
      );
      expect(all.rows).toHaveLength(2);
      const current = await c.query(
        `SELECT setting_value FROM org.company_settings
         WHERE tenant_id = $1 AND company_id = $2 AND setting_key = 'invoice.footer'
         ORDER BY version DESC LIMIT 1`,
        [TENANT_A, COMPANY_A1]
      );
      expect(current.rows[0].setting_value).toBe('v2 footer');
    });
  });

  it('duplicate (scope, key, version) is rejected — the constraint referees allocation (23505)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await c.query(
        `INSERT INTO org.company_settings (tenant_id, company_id, setting_key, setting_value, value_type, version, created_by)
         VALUES ($1, $2, 'dup.key', 'true', 'boolean', 1, $3)`,
        [TENANT_A, COMPANY_A1, USER_A]
      );
      await expectSqlState(
        c.query(
          `INSERT INTO org.company_settings (tenant_id, company_id, setting_key, setting_value, value_type, version, created_by)
           VALUES ($1, $2, 'dup.key', 'false', 'boolean', 1, $3)`,
          [TENANT_A, COMPANY_A1, USER_A]
        ),
        '23505'
      );
    });
  });

  it('typed validation is real: declared type must match the JSON value (23514)', async () => {
    for (const [type, value] of [
      ['number', '"not a number"'],
      ['boolean', '123'],
      ['string', 'true'],
      ['json', '"scalar"'],
    ]) {
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
        await expectSqlState(
          c.query(
            `INSERT INTO org.company_settings (tenant_id, company_id, setting_key, setting_value, value_type, version, created_by)
             VALUES ($1, $2, 'typed.key', $3::jsonb, $4, 1, $5)`,
            [TENANT_A, COMPANY_A1, value, type, USER_A]
          ),
          '23514'
        );
      });
    }
  });

  it('no update path exists for application roles — versions are immutable (42501)', async () => {
    const s = await admin.query(
      `INSERT INTO org.company_settings (tenant_id, company_id, setting_key, setting_value, value_type, version, created_by)
       VALUES ($1, $2, 'frozen.key', '"frozen"', 'string', 1, $3) RETURNING id`,
      [TENANT_A, COMPANY_A1, USER_A]
    );
    try {
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
        await expectSqlState(
          c.query(`UPDATE org.company_settings SET setting_value = '"tampered"' WHERE id = $1`, [
            s.rows[0].id,
          ]),
          '42501'
        );
      });
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
        await expectSqlState(
          c.query('DELETE FROM org.company_settings WHERE id = $1', [s.rows[0].id]),
          '42501'
        );
      });
      // Even the admin connection cannot rewrite the identity/value columns.
      await expectSqlState(
        admin.query(`UPDATE org.company_settings SET setting_value = '"rewritten"' WHERE id = $1`, [
          s.rows[0].id,
        ]),
        '23514'
      );
    } finally {
      await admin.query('DELETE FROM org.company_settings WHERE id = $1', [s.rows[0].id]);
    }
  });

  it('cross-tenant setting writes are denied (WITH CHECK → 42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO org.company_settings (tenant_id, company_id, setting_key, setting_value, value_type, version, created_by)
           VALUES ($1, $2, 'smuggled.key', 'true', 'boolean', 1, $3)`,
          [TENANT_B, COMPANY_A1, USER_A]
        ),
        '42501'
      );
    });
  });

  it('branch settings carry the full branch composite (cross-scope FK → 23503)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.branch_settings (tenant_id, company_id, branch_id, setting_key, setting_value, value_type, version, created_by)
         VALUES ($1, $2, $3, 'orphan.key', 'true', 'boolean', 1, $4)`,
        [TENANT_B, COMPANY_A1, BRANCH_A1, USER_A]
      ),
      '23503'
    );
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const { rows } = await c.query(
        `INSERT INTO org.branch_settings (tenant_id, company_id, branch_id, setting_key, setting_value, value_type, version, created_by)
         VALUES ($1, $2, $3, 'branch.key', '42', 'number', 1, $4) RETURNING id`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
      );
      expect(rows).toHaveLength(1);
    });
  });
});

describe('org.tax_classes / org.tax_rates — NUMERIC, ranged, non-overlapping, unseeded', () => {
  it('tax rate columns are NUMERIC, never float (catalog assertion)', async () => {
    const { rows } = await admin.query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_schema = 'org' AND table_name = 'tax_rates' AND column_name = 'rate'`
    );
    expect(rows[0].data_type).toBe('numeric');
  });

  it('zero tax rows are seeded — every rate is tenant configuration (OIR-04 open)', async () => {
    const { rows } = await admin.query(
      `SELECT (SELECT count(*)::int FROM org.tax_classes) AS classes,
              (SELECT count(*)::int FROM org.tax_rates) AS rates`
    );
    expect(rows[0]).toEqual({ classes: 0, rates: 0 });
  });

  it('a runtime session manages its own tax configuration; rates outside [0,1] are rejected', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      const cls = await c.query(
        `INSERT INTO org.tax_classes (tenant_id, company_id, tax_class_code, name, created_by)
         VALUES ($1, $2, 'standard', 'Standard tax class', $3) RETURNING id`,
        [TENANT_A, COMPANY_A1, USER_A]
      );
      const classId = cls.rows[0].id;
      await c.query(
        `INSERT INTO org.tax_rates (tenant_id, company_id, tax_class_id, rate, effective_from, created_by)
         VALUES ($1, $2, $3, 0.160000, '2026-01-01', $4)`,
        [TENANT_A, COMPANY_A1, classId, USER_A]
      );
      await expectSqlState(
        c.query(
          `INSERT INTO org.tax_rates (tenant_id, company_id, tax_class_id, rate, effective_from, created_by)
           VALUES ($1, $2, $3, 1.500000, '2027-01-01', $4)`,
          [TENANT_A, COMPANY_A1, classId, USER_A]
        ),
        '23514'
      );
    });
  });

  it('overlapping ACTIVE rates for one class are rejected (23P01); successive ones are fine', async () => {
    const cls = await admin.query(
      `INSERT INTO org.tax_classes (tenant_id, company_id, tax_class_code, name, created_by)
       VALUES ($1, $2, 'overlap_cls', 'Overlap class', $3) RETURNING id`,
      [TENANT_A, COMPANY_A1, USER_A]
    );
    const classId = cls.rows[0].id;
    try {
      await admin.query(
        `INSERT INTO org.tax_rates (tenant_id, company_id, tax_class_id, rate, effective_from, effective_to, created_by)
         VALUES ($1, $2, $3, 0.100000, '2026-01-01', '2026-07-01', $4)`,
        [TENANT_A, COMPANY_A1, classId, USER_A]
      );
      await expectSqlState(
        admin.query(
          `INSERT INTO org.tax_rates (tenant_id, company_id, tax_class_id, rate, effective_from, created_by)
           VALUES ($1, $2, $3, 0.200000, '2026-03-01', $4)`,
          [TENANT_A, COMPANY_A1, classId, USER_A]
        ),
        '23P01'
      );
      await admin.query(
        `INSERT INTO org.tax_rates (tenant_id, company_id, tax_class_id, rate, effective_from, created_by)
         VALUES ($1, $2, $3, 0.200000, '2026-07-01', $4)`,
        [TENANT_A, COMPANY_A1, classId, USER_A]
      );
    } finally {
      await admin.query('DELETE FROM org.tax_rates WHERE tax_class_id = $1', [classId]);
      await admin.query('DELETE FROM org.tax_classes WHERE id = $1', [classId]);
    }
  });

  it("a tax rate cannot reference another tenant's tax class (23503)", async () => {
    const cls = await admin.query(
      `INSERT INTO org.tax_classes (tenant_id, company_id, tax_class_code, name, created_by)
       VALUES ($1, $2, 'a_only_cls', 'Tenant A class', $3) RETURNING id`,
      [TENANT_A, COMPANY_A1, USER_A]
    );
    try {
      await expectSqlState(
        admin.query(
          `INSERT INTO org.tax_rates (tenant_id, company_id, tax_class_id, rate, effective_from, created_by)
           VALUES ($1, $2, $3, 0.050000, '2026-01-01', $4)`,
          [TENANT_B, COMPANY_A1, cls.rows[0].id, USER_A]
        ),
        '23503'
      );
    } finally {
      await admin.query('DELETE FROM org.tax_classes WHERE id = $1', [cls.rows[0].id]);
    }
  });
});

describe('org.resolve_feature_enabled — override > plan > default (runtime role)', () => {
  it('platform default applies when no plan entitlement and no override exist', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B }, async (c) => {
      const { rows } = await c.query(`SELECT org.resolve_feature_enabled('fx_feat', now()) AS v`);
      expect(rows[0].v).toBe(false);
    });
  });

  it("plan entitlement overrides the default (tenant A's plan entitles fx_feat)", async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      const { rows } = await c.query(`SELECT org.resolve_feature_enabled('fx_feat', now()) AS v`);
      expect(rows[0].v).toBe(true);
    });
  });

  it('a tenant override beats the plan; its expiry restores the plan value', async () => {
    await admin.query(
      `INSERT INTO org.tenant_feature_overrides (tenant_id, flag_code, enabled, reason, effective_from, effective_to, created_by)
       VALUES ($1, 'fx_feat', false, 'fixture: temporary kill-switch', '2026-02-01', '2026-03-01', $2)`,
      [TENANT_A, USER_A]
    );
    try {
      await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
        const during = await c.query(
          `SELECT org.resolve_feature_enabled('fx_feat', '2026-02-15T00:00:00Z') AS v`
        );
        expect(during.rows[0].v).toBe(false);
        const after = await c.query(
          `SELECT org.resolve_feature_enabled('fx_feat', '2026-03-15T00:00:00Z') AS v`
        );
        expect(after.rows[0].v).toBe(true);
      });
    } finally {
      await admin.query(
        `DELETE FROM org.tenant_feature_overrides WHERE tenant_id = $1 AND flag_code = 'fx_feat'`,
        [TENANT_A]
      );
    }
  });

  it('overlapping overrides for one tenant+flag are rejected (23P01); history rows persist', async () => {
    await admin.query(
      `INSERT INTO org.tenant_feature_overrides (tenant_id, flag_code, enabled, reason, effective_from, effective_to, created_by)
       VALUES ($1, 'fx_feat', true, 'fixture: window one', '2026-05-01', '2026-06-01', $2)`,
      [TENANT_A, USER_A]
    );
    try {
      await expectSqlState(
        admin.query(
          `INSERT INTO org.tenant_feature_overrides (tenant_id, flag_code, enabled, reason, effective_from, created_by)
           VALUES ($1, 'fx_feat', false, 'fixture: overlapping', '2026-05-15', $2)`,
          [TENANT_A, USER_A]
        ),
        '23P01'
      );
    } finally {
      await admin.query(
        `DELETE FROM org.tenant_feature_overrides WHERE tenant_id = $1 AND flag_code = 'fx_feat'`,
        [TENANT_A]
      );
    }
  });

  it('an unregistered flag raises rather than silently returning false (P0002)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      await expectSqlState(
        c.query(`SELECT org.resolve_feature_enabled('no_such_flag', now())`),
        'P0002'
      );
    });
  });

  it('runtime cannot write overrides — platform-assigned in this phase (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO org.tenant_feature_overrides (tenant_id, flag_code, enabled, reason, effective_from, created_by)
           VALUES ($1, 'fx_feat', true, 'self-service attempt', now(), $2)`,
          [TENANT_A, USER_A]
        ),
        '42501'
      );
    });
  });
});
