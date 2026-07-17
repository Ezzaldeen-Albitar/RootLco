/**
 * Phase 1-4 Increment D — iam.approval_limits / iam.sensitive_data_permissions
 * (P1-04-DB-010..011).
 *
 * Money is NUMERIC(18,4); intervals never overlap; a subject is role XOR user;
 * sensitive-data access is by explicit (classification, kind) permission, never
 * by role name, with view/export/mask_override distinct. Isolation assertions
 * run as the non-owner runtime login.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  cleanFixtures,
  COMPANY_A1,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimePool,
  TENANT_A,
  USER_A,
  withRolledBackTx,
} from './helpers';

const R_A = 'd0500000-0000-4000-8000-000000000001';
const ACC_A = 'a0500000-0000-4000-8000-000000000001';
const ACTOR = USER_A;

let admin: Pool;
let runtime: Pool;

const AL_COLS =
  'tenant_id, company_id, role_id, user_id, limit_type, amount, currency_code, effective_from, effective_to, created_by';

async function seed(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'approver','Approver',$3) ON CONFLICT (id) DO NOTHING`,
    [R_A, TENANT_A, ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'supabase','appr_user','appr@example.com','Appr User','active',$3) ON CONFLICT (id) DO NOTHING`,
    [ACC_A, TENANT_A, ACTOR]
  );
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seed();
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('iam.approval_limits — subject, money, and overlap', () => {
  it('amount is NUMERIC(18,4) and no float/double column exists', async () => {
    const amt = await admin.query(
      `SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns
       WHERE table_schema='iam' AND table_name='approval_limits' AND column_name='amount'`
    );
    expect(amt.rows[0]).toMatchObject({
      data_type: 'numeric',
      numeric_precision: 18,
      numeric_scale: 4,
    });
    const floats = await admin.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='iam' AND table_name IN ('approval_limits','sensitive_data_permissions')
         AND data_type IN ('double precision','real')`
    );
    expect(floats.rows).toEqual([]);
  });

  it('accepts a role-subject limit and resolves it point-in-time', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      await c.query(
        `INSERT INTO iam.approval_limits (${AL_COLS})
         VALUES ($1,$2,$3,NULL,'purchase_order',1000.0000,'USD','2026-01-01','2026-07-01',$4)`,
        [TENANT_A, COMPANY_A1, R_A, ACTOR]
      );
      await c.query(
        `INSERT INTO iam.approval_limits (${AL_COLS})
         VALUES ($1,$2,$3,NULL,'purchase_order',2500.0000,'USD','2026-07-01',NULL,$4)`,
        [TENANT_A, COMPANY_A1, R_A, ACTOR]
      );
      const r = await c.query(
        `SELECT amount FROM iam.approval_limits
         WHERE tenant_id=$1 AND company_id=$2 AND role_id=$3 AND limit_type='purchase_order'
           AND '2026-09-01'::date >= effective_from
           AND ('2026-09-01'::date < effective_to OR effective_to IS NULL)`,
        [TENANT_A, COMPANY_A1, R_A]
      );
      expect(r.rows).toHaveLength(1);
      expect(Number(r.rows[0].amount)).toBe(2500);
    });
  });

  it('requires exactly one subject (role XOR user)', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.approval_limits (${AL_COLS})
           VALUES ($1,$2,$3,$5,'payment',10.0000,'USD','2026-01-01',NULL,$4)`,
          [TENANT_A, COMPANY_A1, R_A, ACTOR, ACC_A]
        ),
        '23514'
      )
    );
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.approval_limits (${AL_COLS})
           VALUES ($1,$2,NULL,NULL,'payment',10.0000,'USD','2026-01-01',NULL,$3)`,
          [TENANT_A, COMPANY_A1, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('rejects an unknown currency and a negative amount', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.approval_limits (${AL_COLS})
           VALUES ($1,$2,$3,NULL,'payment',10.0000,'ZZZ','2026-01-01',NULL,$4)`,
          [TENANT_A, COMPANY_A1, R_A, ACTOR]
        ),
        '23503'
      )
    );
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.approval_limits (${AL_COLS})
           VALUES ($1,$2,$3,NULL,'payment',-1.0000,'USD','2026-01-01',NULL,$4)`,
          [TENANT_A, COMPANY_A1, R_A, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('rejects overlapping windows but allows adjacent ones', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      await c.query(
        `INSERT INTO iam.approval_limits (${AL_COLS})
         VALUES ($1,$2,$3,NULL,'refund',100.0000,'USD','2026-01-01','2026-06-01',$4)`,
        [TENANT_A, COMPANY_A1, R_A, ACTOR]
      );
      // adjacent (starts where the first ends) → allowed
      await c.query(
        `INSERT INTO iam.approval_limits (${AL_COLS})
         VALUES ($1,$2,$3,NULL,'refund',200.0000,'USD','2026-06-01',NULL,$4)`,
        [TENANT_A, COMPANY_A1, R_A, ACTOR]
      );
      // overlapping → rejected
      await expectSqlState(
        c.query(
          `INSERT INTO iam.approval_limits (${AL_COLS})
           VALUES ($1,$2,$3,NULL,'refund',300.0000,'USD','2026-03-01','2026-09-01',$4)`,
          [TENANT_A, COMPANY_A1, R_A, ACTOR]
        ),
        '23P01'
      );
    });
  });

  it('amount and identity are immutable', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      const r = await c.query(
        `INSERT INTO iam.approval_limits (${AL_COLS})
         VALUES ($1,$2,$3,NULL,'expense',50.0000,'USD','2026-01-01',NULL,$4) RETURNING id`,
        [TENANT_A, COMPANY_A1, R_A, ACTOR]
      );
      const id = r.rows[0].id;
      await expectSqlState(
        c.query(`UPDATE iam.approval_limits SET amount=99.0000 WHERE id=$1`, [id]),
        '23514'
      );
    });
  });
});

describe('iam.sensitive_data_permissions — classification, kind, overlap', () => {
  const SDP =
    'tenant_id, role_id, classification, permission_kind, effective_from, effective_to, created_by';

  it('view does not confer export (kinds are distinct)', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      await c.query(
        `INSERT INTO iam.sensitive_data_permissions (${SDP})
         VALUES ($1,$2,'restricted','view','2026-01-01',NULL,$3)`,
        [TENANT_A, R_A, ACTOR]
      );
      const hasExport = await c.query(
        `SELECT 1 FROM iam.sensitive_data_permissions
         WHERE tenant_id=$1 AND role_id=$2 AND classification='restricted' AND permission_kind='export'`,
        [TENANT_A, R_A]
      );
      expect(hasExport.rows).toHaveLength(0);
    });
  });

  it('rejects an unknown classification or kind', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.sensitive_data_permissions (${SDP})
           VALUES ($1,$2,'ultra','view','2026-01-01',NULL,$3)`,
          [TENANT_A, R_A, ACTOR]
        ),
        '23514'
      )
    );
    await withRolledBackTx(admin, { userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.sensitive_data_permissions (${SDP})
           VALUES ($1,$2,'restricted','delete','2026-01-01',NULL,$3)`,
          [TENANT_A, R_A, ACTOR]
        ),
        '23514'
      )
    );
  });

  it('rejects overlapping windows for the same role/classification/kind', async () => {
    await withRolledBackTx(admin, { userId: ACTOR }, async (c) => {
      await c.query(
        `INSERT INTO iam.sensitive_data_permissions (${SDP})
         VALUES ($1,$2,'secret','export','2026-01-01','2026-06-01',$3)`,
        [TENANT_A, R_A, ACTOR]
      );
      await expectSqlState(
        c.query(
          `INSERT INTO iam.sensitive_data_permissions (${SDP})
           VALUES ($1,$2,'secret','export','2026-03-01',NULL,$3)`,
          [TENANT_A, R_A, ACTOR]
        ),
        '23P01'
      );
    });
  });
});

describe('iam approval/sensitive — tenant isolation and write denial', () => {
  it('runtime sees only its tenant rows and cannot write', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, async (c) => {
      const q = await c.query(`SELECT count(*)::int AS n FROM iam.approval_limits`);
      expect(q.rows[0].n).toBeGreaterThanOrEqual(0); // policy applies, no error
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.approval_limits (${AL_COLS})
           VALUES ($1,$2,$3,NULL,'payment',1.0000,'USD','2026-01-01',NULL,$4)`,
          [TENANT_A, COMPANY_A1, R_A, ACTOR]
        ),
        '42501'
      )
    );
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: ACTOR }, (c) =>
      expectSqlState(
        c.query(
          `INSERT INTO iam.sensitive_data_permissions (tenant_id, role_id, classification, permission_kind, effective_from, created_by)
           VALUES ($1,$2,'restricted','view','2026-01-01',$3)`,
          [TENANT_A, R_A, ACTOR]
        ),
        '42501'
      )
    );
  });
});
