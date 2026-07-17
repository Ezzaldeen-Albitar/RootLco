/**
 * Phase 1-3 — feature definitions, subscription plans, tenant subscriptions
 * (P1-03-DB-003/004, P1-03-DB-015 platform part, P1-03-QA-005 subset).
 *
 * Isolation and resolution assertions run as the NON-OWNER runtime login.
 * Admin provisions platform fixtures (fx_ prefix) — never RLS evidence.
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
  withRolledBackTx,
} from './helpers';

const SYS = '00000000-0000-4000-8000-000000000001';
const T0 = '2026-01-01T00:00:00Z';
const T1 = '2026-06-01T00:00:00Z';

let admin: Pool;
let runtime: Pool;
let flagId: string;
let planV1: string;
let planV2: string;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);

  const flag = await admin.query(
    `INSERT INTO org.feature_flags (flag_code, name, default_enabled, created_by)
     VALUES ('fx_inspections', 'Inspections module', false, $1) RETURNING id`,
    [SYS]
  );
  flagId = flag.rows[0].id;

  const v1 = await admin.query(
    `INSERT INTO org.subscription_plans
       (plan_code, name, entitlement_document, capacity_limits, status, effective_from, effective_to, created_by)
     VALUES ('fx_pilot', 'Pilot plan v1', '{"fx_inspections": true}', '{"max_branches": 3}',
             'active', $1, $2, $3) RETURNING id`,
    [T0, T1, SYS]
  );
  planV1 = v1.rows[0].id;

  const v2 = await admin.query(
    `INSERT INTO org.subscription_plans
       (plan_code, name, entitlement_document, status, effective_from, created_by)
     VALUES ('fx_pilot', 'Pilot plan v2', '{"fx_inspections": false}', 'active', $1, $2)
     RETURNING id`,
    [T1, SYS]
  );
  planV2 = v2.rows[0].id;

  // Tenant A: v1 active for [T0,T1), v2 active from T1. Tenant B: nothing.
  await admin.query(
    `INSERT INTO org.tenant_subscriptions
       (tenant_id, plan_id, status, effective_from, effective_to, assigned_by, created_by)
     VALUES ($1, $2, 'active', $3, $4, $5, $5), ($1, $6, 'active', $4, NULL, $5, $5)`,
    [TENANT_A, planV1, T0, T1, USER_A, planV2]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('platform tables are readable but never writable by application roles', () => {
  it('runtime reads feature definitions', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      const { rows } = await c.query(
        `SELECT default_enabled FROM org.feature_flags WHERE flag_code = 'fx_inspections'`
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].default_enabled).toBe(false);
    });
  });

  it('runtime cannot modify a platform feature definition (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`UPDATE org.feature_flags SET default_enabled = true WHERE id = $1`, [flagId]),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO org.feature_flags (flag_code, name, created_by) VALUES ('fx_rogue', 'Rogue', $1)`,
          [USER_A]
        ),
        '42501'
      );
    });
  });

  it('draft plan versions are invisible to application roles', async () => {
    const draft = await admin.query(
      `INSERT INTO org.subscription_plans (plan_code, name, status, effective_from, created_by)
       VALUES ('fx_secret_draft', 'Unannounced plan', 'draft', now(), $1) RETURNING id`,
      [SYS]
    );
    try {
      await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
        const visible = await c.query(
          `SELECT plan_code FROM org.subscription_plans WHERE plan_code = 'fx_secret_draft'`
        );
        expect(visible.rows).toHaveLength(0);
        const published = await c.query(
          `SELECT count(*)::int AS n FROM org.subscription_plans WHERE plan_code = 'fx_pilot'`
        );
        expect(published.rows[0].n).toBe(2);
      });
    } finally {
      await admin.query('DELETE FROM org.subscription_plans WHERE id = $1', [draft.rows[0].id]);
    }
  });

  it('runtime cannot create or modify plans (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO org.subscription_plans (plan_code, name, status, effective_from, created_by)
           VALUES ('fx_rogue_plan', 'Rogue', 'active', now(), $1)`,
          [USER_A]
        ),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`UPDATE org.subscription_plans SET name = 'hacked' WHERE id = $1`, [planV1]),
        '42501'
      );
    });
  });
});

describe('plan entitlement/capacity validation (real, trigger-enforced)', () => {
  it('an entitlement key that is not a registered flag is rejected (23514)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.subscription_plans (plan_code, name, entitlement_document, status, effective_from, created_by)
         VALUES ('fx_bad_key', 'Bad', '{"not_a_flag": true}', 'draft', now(), $1)`,
        [SYS]
      ),
      '23514'
    );
  });

  it('a non-boolean entitlement value is rejected (23514)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.subscription_plans (plan_code, name, entitlement_document, status, effective_from, created_by)
         VALUES ('fx_bad_val', 'Bad', '{"fx_inspections": "yes"}', 'draft', now(), $1)`,
        [SYS]
      ),
      '23514'
    );
  });

  it('a negative capacity limit is rejected (23514)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.subscription_plans (plan_code, name, capacity_limits, status, effective_from, created_by)
         VALUES ('fx_bad_cap', 'Bad', '{"max_branches": -1}', 'draft', now(), $1)`,
        [SYS]
      ),
      '23514'
    );
  });

  it('a non-object entitlement document is rejected (23514)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.subscription_plans (plan_code, name, entitlement_document, status, effective_from, created_by)
         VALUES ('fx_bad_shape', 'Bad', '["fx_inspections"]', 'draft', now(), $1)`,
        [SYS]
      ),
      '23514'
    );
  });
});

describe('effective-dating overlap rules (EXCLUDE, btree_gist)', () => {
  it('overlapping ACTIVE versions of the same plan_code are rejected (23P01)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.subscription_plans (plan_code, name, status, effective_from, created_by)
         VALUES ('fx_pilot', 'Overlapping v3', 'active', $1, $2)`,
        ['2026-03-01T00:00:00Z', SYS]
      ),
      '23P01'
    );
  });

  it('a DRAFT version may overlap freely (drafting the next version is normal)', async () => {
    const { rows } = await admin.query(
      `INSERT INTO org.subscription_plans (plan_code, name, status, effective_from, created_by)
       VALUES ('fx_pilot', 'Draft v3', 'draft', $1, $2) RETURNING id`,
      ['2026-03-01T00:00:00Z', SYS]
    );
    await admin.query('DELETE FROM org.subscription_plans WHERE id = $1', [rows[0].id]);
  });

  it('overlapping ACTIVE subscriptions for one tenant are rejected (23P01)', async () => {
    await expectSqlState(
      admin.query(
        `INSERT INTO org.tenant_subscriptions
           (tenant_id, plan_id, status, effective_from, assigned_by, created_by)
         VALUES ($1, $2, 'active', $3, $4, $4)`,
        [TENANT_A, planV1, '2026-02-01T00:00:00Z', USER_A]
      ),
      '23P01'
    );
  });

  it('the same window is fine for ANOTHER tenant (per-tenant exclusion)', async () => {
    const { rows } = await admin.query(
      `INSERT INTO org.tenant_subscriptions
         (tenant_id, plan_id, status, effective_from, effective_to, assigned_by, created_by)
       VALUES ($1, $2, 'active', $3, $4, $5, $5) RETURNING id`,
      [TENANT_B, planV1, T0, T1, USER_A]
    );
    await admin.query('DELETE FROM org.tenant_subscriptions WHERE id = $1', [rows[0].id]);
  });

  it('a cancelled assignment may overlap (history rows do not block reassignment)', async () => {
    const { rows } = await admin.query(
      `INSERT INTO org.tenant_subscriptions
         (tenant_id, plan_id, status, effective_from, assigned_by, created_by)
       VALUES ($1, $2, 'cancelled', $3, $4, $4) RETURNING id`,
      [TENANT_A, planV1, '2026-02-01T00:00:00Z', USER_A]
    );
    await admin.query('DELETE FROM org.tenant_subscriptions WHERE id = $1', [rows[0].id]);
  });
});

describe('point-in-time resolution (deterministic, tenant-scoped, runtime role)', () => {
  it('resolves the correct plan version either side of the changeover instant', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      const before = await c.query(`SELECT org.current_subscription_plan_id($1) AS p`, [
        '2026-03-01T00:00:00Z',
      ]);
      expect(before.rows[0].p).toBe(planV1);
      const after = await c.query(`SELECT org.current_subscription_plan_id($1) AS p`, [
        '2026-07-01T00:00:00Z',
      ]);
      expect(after.rows[0].p).toBe(planV2);
    });
  });

  it('resolves NULL before any assignment existed', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A }, async (c) => {
      const { rows } = await c.query(`SELECT org.current_subscription_plan_id($1) AS p`, [
        '2025-01-01T00:00:00Z',
      ]);
      expect(rows[0].p).toBeNull();
    });
  });

  it('another tenant resolves NULL — a subscription is never visible across tenants', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B }, async (c) => {
      const { rows } = await c.query(`SELECT org.current_subscription_plan_id($1) AS p`, [
        '2026-03-01T00:00:00Z',
      ]);
      expect(rows[0].p).toBeNull();
      const direct = await c.query('SELECT id FROM org.tenant_subscriptions');
      expect(direct.rows).toHaveLength(0);
    });
  });

  it('no context resolves NULL (default deny)', async () => {
    await withRolledBackTx(runtime, {}, async (c) => {
      const { rows } = await c.query('SELECT org.current_subscription_plan_id(now()) AS p');
      expect(rows[0].p).toBeNull();
    });
  });
});

describe('assignment history protection', () => {
  it('runtime cannot INSERT/UPDATE/DELETE subscription assignments (42501)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO org.tenant_subscriptions
             (tenant_id, plan_id, status, effective_from, assigned_by, created_by)
           VALUES ($1, $2, 'active', now(), $3, $3)`,
          [TENANT_A, planV1, USER_A]
        ),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(
        c.query(`UPDATE org.tenant_subscriptions SET status = 'cancelled'`),
        '42501'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (c) => {
      await expectSqlState(c.query('DELETE FROM org.tenant_subscriptions'), '42501');
    });
  });

  it('an assignment cannot be re-pointed at another tenant or plan (23514)', async () => {
    await expectSqlState(
      admin.query(`UPDATE org.tenant_subscriptions SET tenant_id = $1 WHERE tenant_id = $2`, [
        TENANT_B,
        TENANT_A,
      ]),
      '23514'
    );
  });
});
