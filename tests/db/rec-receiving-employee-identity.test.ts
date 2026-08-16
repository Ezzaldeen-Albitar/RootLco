/**
 * FE-007 — the receiving employee is a real, eligible IAM identity
 * (`20260815093000_rec_receiving_employee_identity.sql`).
 *
 * Before this migration `rec.reception_visits.receiving_employee_id` carried no
 * foreign key at all: any uuid on earth was a legal custodian, and the column
 * therefore recorded a CLAIM rather than an identity. Everything proved here is
 * proved at the DATABASE, not at the API, because the application is not the
 * authority: a job, a future service or a psql session writes through the same
 * guard, and a rule enforced only in TypeScript is a rule any other writer skips.
 *
 * The five obligations of the Owner decision, one describe block each:
 *
 *   1. an unknown identifier is refused (there is no such thing as a bare uuid
 *      custodian any more);
 *   2. a non-active or soft-deleted account cannot be selected for a NEW
 *      reception, whatever authority the actor holds;
 *   3. a historical reception still reads back with the name captured at
 *      reception after the account is renamed AND disabled;
 *   4. an employee outside the visit's branch is refused for an ordinary actor
 *      and accepted for one holding
 *      `rec.reception.receiving_employee.assign_any` in that scope;
 *   5. a cross-tenant identifier is refused.
 *
 * Plus the two properties that make (3) meaningful at all: the snapshot is
 * stamped by the server (a caller-supplied value is overwritten, not trusted)
 * and it is immutable afterwards.
 *
 * Every assertion runs on the RUNTIME connection under RLS. The admin pool
 * provisions and disables accounts only — admin behaviour is never evidence.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  withCommittedTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';

const SYS = '00000000-0000-4000-8000-000000000001';

/** The permission the Owner made the gate for cross-branch selection. */
const ASSIGN_ANY = 'rec.reception.receiving_employee.assign_any';

/** A second branch in the SAME company — the "other branch" of obligation 4. */
const BRANCH_A2 = 'f0070000-0000-4000-8000-0000000000b2';

const EMP_BRANCH_A1 = 'f0070000-0000-4000-8000-0000000000e1';
const EMP_BRANCH_A2 = 'f0070000-0000-4000-8000-0000000000e2';
const EMP_DISABLED = 'f0070000-0000-4000-8000-0000000000e3';
const EMP_SOFT_DELETED = 'f0070000-0000-4000-8000-0000000000e4';
const EMP_NO_GRANT = 'f0070000-0000-4000-8000-0000000000e5';
/** The tenant-A actor who holds ASSIGN_ANY. Never a receiving employee here. */
const ACTOR_CROSS = 'f0070000-0000-4000-8000-0000000000e6';

const ROLE_BRANCH_A1 = 'f0070000-0000-4000-8000-0000000000r1';
const ROLE_BRANCH_A2 = 'f0070000-0000-4000-8000-0000000000r2';
const ROLE_UNRESTRICTED = 'f0070000-0000-4000-8000-0000000000r3';
const ROLE_CROSS = 'f0070000-0000-4000-8000-0000000000r4';
const GRANT_BRANCH_A1 = 'f0070000-0000-4000-8000-0000000000f1';
const GRANT_BRANCH_A2 = 'f0070000-0000-4000-8000-0000000000f2';

/** An identifier that names no row anywhere — the forged-custodian probe. */
const UNKNOWN_EMPLOYEE = 'f0070000-0000-4000-8000-0000000000ff';

const V1 = 'f0070000-0000-4000-8000-0000000000a1';
const V2 = 'f0070000-0000-4000-8000-0000000000a2';
const V3 = 'f0070000-0000-4000-8000-0000000000a3';
const V4 = 'f0070000-0000-4000-8000-0000000000a4';
const V5 = 'f0070000-0000-4000-8000-0000000000a5';
const V6 = 'f0070000-0000-4000-8000-0000000000a6';
const V7 = 'f0070000-0000-4000-8000-0000000000a7';
const V8 = 'f0070000-0000-4000-8000-0000000000a8';

const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxCross = { tenantId: TENANT_A, userId: ACTOR_CROSS };

let admin: Pool;
let runtime: Pool;

type Q = { query: Client['query'] };

const insWalkIn = async (c: Q, vehicle: string, branch = BRANCH_A1): Promise<string> =>
  (
    await c.query(
      `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, vehicle_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [TENANT_A, COMPANY_A1, branch, vehicle, USER_A]
    )
  ).rows[0].id as string;

/**
 * A minimal walk-in visit. `snapshot` is the value a CALLER tries to write into
 * the historical name column — the parameter exists so the server-stamp
 * assertion can pass something the server must throw away.
 */
const insVisit = async (
  c: Q,
  o: { walkIn: string; vehicle: string; employee: string; branch?: string; snapshot?: string }
): Promise<string> =>
  (
    await c.query(
      `INSERT INTO rec.reception_visits
         (tenant_id, company_id, branch_id, walk_in_id, vehicle_id, receiving_employee_id,
          receiving_employee_display_name, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        TENANT_A,
        COMPANY_A1,
        o.branch ?? BRANCH_A1,
        o.walkIn,
        o.vehicle,
        o.employee,
        o.snapshot ?? 'ignored by the server',
        USER_A,
      ]
    )
  ).rows[0].id as string;

async function seedAccount(input: {
  id: string;
  tenantId: string;
  subject: string;
  displayName: string;
}): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'test_harness',$3,$3 || '@example.test',$4,'active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [input.id, input.tenantId, input.subject, input.displayName, SYS]
  );
}

async function seedRole(id: string, tenantId: string, code: string): Promise<void> {
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,$3,$4) ON CONFLICT (id) DO NOTHING`,
    [id, tenantId, code, SYS]
  );
}

/** A scoped grant and its single branch scope, written in one transaction
 *  because `tg_role_grants_require_scope` is DEFERRABLE INITIALLY DEFERRED. */
async function seedBranchScopedGrant(input: {
  grantId: string;
  userId: string;
  roleId: string;
  branchId: string;
}): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5) ON CONFLICT (id) DO NOTHING`,
      [input.grantId, TENANT_A, input.userId, input.roleId, SYS]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       SELECT $1,$2,'branch',$3,$4,$5
        WHERE NOT EXISTS (
          SELECT 1 FROM iam.grant_scopes WHERE tenant_id = $1 AND grant_id = $2
        )`,
      [TENANT_A, input.grantId, COMPANY_A1, input.branchId, SYS]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedUnrestrictedGrant(userId: string, roleId: string): Promise<void> {
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     SELECT $1,$2,$3,'unrestricted',$4,$4
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.role_grants
         WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3 AND status = 'active'
      )`,
    [TENANT_A, userId, roleId, SYS]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();

  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'fx_fe007_a2','Fixture Branch A2','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A1, USER_A]
  );

  // The catalogue row the cross-branch gate resolves. Seeded here as well as in
  // supabase/seeds/04_iam_permission_catalog.sql, and idempotently, so this
  // suite proves the guard rather than proving that a seed happened to run.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ($1,'rec','Name a receiving employee who is not eligible for the visit branch','high',$2)
     ON CONFLICT (permission_code) DO NOTHING`,
    [ASSIGN_ANY, SYS]
  );

  await seedAccount({
    id: EMP_BRANCH_A1,
    tenantId: TENANT_A,
    subject: 'fx_fe007_emp_a1',
    displayName: 'Branch A1 Receiver',
  });
  await seedAccount({
    id: EMP_BRANCH_A2,
    tenantId: TENANT_A,
    subject: 'fx_fe007_emp_a2',
    displayName: 'Branch A2 Receiver',
  });
  await seedAccount({
    id: EMP_DISABLED,
    tenantId: TENANT_A,
    subject: 'fx_fe007_emp_disabled',
    displayName: 'Soon To Be Locked',
  });
  await seedAccount({
    id: EMP_SOFT_DELETED,
    tenantId: TENANT_A,
    subject: 'fx_fe007_emp_deleted',
    displayName: 'Soon To Be Deleted',
  });
  await seedAccount({
    id: EMP_NO_GRANT,
    tenantId: TENANT_A,
    subject: 'fx_fe007_emp_no_grant',
    displayName: 'Granted Nothing',
  });
  await seedAccount({
    id: ACTOR_CROSS,
    tenantId: TENANT_A,
    subject: 'fx_fe007_actor_cross',
    displayName: 'Cross Branch Administrator',
  });

  await seedRole(ROLE_BRANCH_A1, TENANT_A, 'fx_fe007_branch_a1');
  await seedRole(ROLE_BRANCH_A2, TENANT_A, 'fx_fe007_branch_a2');
  await seedRole(ROLE_UNRESTRICTED, TENANT_A, 'fx_fe007_unrestricted');
  await seedRole(ROLE_CROSS, TENANT_A, 'fx_fe007_cross');

  // ONLY the cross-branch role maps the permission. Nobody else in this suite
  // can hold it, which is what makes the refusal in obligation 4 meaningful.
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE_CROSS, SYS, ASSIGN_ANY]
  );

  await seedBranchScopedGrant({
    grantId: GRANT_BRANCH_A1,
    userId: EMP_BRANCH_A1,
    roleId: ROLE_BRANCH_A1,
    branchId: BRANCH_A1,
  });
  await seedBranchScopedGrant({
    grantId: GRANT_BRANCH_A2,
    userId: EMP_BRANCH_A2,
    roleId: ROLE_BRANCH_A2,
    branchId: BRANCH_A2,
  });
  await seedUnrestrictedGrant(EMP_DISABLED, ROLE_UNRESTRICTED);
  await seedUnrestrictedGrant(EMP_SOFT_DELETED, ROLE_UNRESTRICTED);
  await seedUnrestrictedGrant(ACTOR_CROSS, ROLE_CROSS);
  // EMP_NO_GRANT deliberately receives none.

  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
     VALUES ($1,$9,'FE007VIN0001','ice','active',$10),
            ($2,$9,'FE007VIN0002','ice','active',$10),
            ($3,$9,'FE007VIN0003','ice','active',$10),
            ($4,$9,'FE007VIN0004','ice','active',$10),
            ($5,$9,'FE007VIN0005','ice','active',$10),
            ($6,$9,'FE007VIN0006','ice','active',$10),
            ($7,$9,'FE007VIN0007','ice','active',$10),
            ($8,$9,'FE007VIN0008','ice','active',$10)
     ON CONFLICT (id) DO NOTHING`,
    [V1, V2, V3, V4, V5, V6, V7, V8, TENANT_A, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('an identifier that names nobody is not a custodian', () => {
  it('refuses an unknown receiving_employee_id', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const walkIn = await insWalkIn(c, V1);
      // 22023 is the eligibility guard, which fires BEFORE the foreign key is
      // consulted; 23503 would be the key itself. Either refuses the row, and
      // naming both keeps this honest about which layer answered first without
      // pinning an ordering the database does not promise.
      await expectSqlState(
        insVisit(c, { walkIn, vehicle: V1, employee: UNKNOWN_EMPLOYEE }),
        '22023',
        '23503'
      );
    });
  });

  it('refuses an employee who holds no live grant anywhere', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const walkIn = await insWalkIn(c, V2);
      await expectSqlState(insVisit(c, { walkIn, vehicle: V2, employee: EMP_NO_GRANT }), '22023');
    });
  });
});

describe('a disabled account is historical, never newly selectable', () => {
  it('refuses a locked account and a soft-deleted one, even for the cross-branch administrator', async () => {
    await admin.query(`UPDATE iam.user_accounts SET status = 'locked' WHERE id = $1`, [
      EMP_DISABLED,
    ]);
    await admin.query(`UPDATE iam.user_accounts SET deleted_at = now() WHERE id = $1`, [
      EMP_SOFT_DELETED,
    ]);
    try {
      await withRolledBackTx(runtime, ctxA, async (c) => {
        const walkIn = await insWalkIn(c, V3);
        await expectSqlState(insVisit(c, { walkIn, vehicle: V3, employee: EMP_DISABLED }), '22023');
      });
      await withRolledBackTx(runtime, ctxA, async (c) => {
        const walkIn = await insWalkIn(c, V4);
        await expectSqlState(
          insVisit(c, { walkIn, vehicle: V4, employee: EMP_SOFT_DELETED }),
          '22023'
        );
      });
      // The administrative authority widens WHICH BRANCH may be drawn from. It
      // does not widen WHICH LIFECYCLE STATE, and this is the assertion that
      // says so: the same actor who may reach across branches below is refused
      // here.
      await withRolledBackTx(runtime, ctxCross, async (c) => {
        const walkIn = await insWalkIn(c, V5);
        await expectSqlState(insVisit(c, { walkIn, vehicle: V5, employee: EMP_DISABLED }), '22023');
      });
    } finally {
      await admin.query(
        `UPDATE iam.user_accounts SET status = 'active', deleted_at = NULL WHERE id = ANY($1::uuid[])`,
        [[EMP_DISABLED, EMP_SOFT_DELETED]]
      );
    }
  });
});

describe('the display name is stamped by the server and frozen afterwards', () => {
  it('overwrites a caller-supplied snapshot with the account name', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const walkIn = await insWalkIn(c, V6);
      const id = await insVisit(c, {
        walkIn,
        vehicle: V6,
        employee: EMP_BRANCH_A1,
        snapshot: 'Somebody Else Entirely',
      });
      const { rows } = await c.query(
        `SELECT receiving_employee_display_name AS name FROM rec.reception_visits WHERE id = $1`,
        [id]
      );
      expect(rows[0].name).toBe('Branch A1 Receiver');
    });
  });

  it('refuses an UPDATE of the snapshot or of the employee id', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const walkIn = await insWalkIn(c, V7);
      const id = await insVisit(c, { walkIn, vehicle: V7, employee: EMP_BRANCH_A1 });
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          `UPDATE rec.reception_visits SET receiving_employee_display_name = 'Rewritten' WHERE id = $1`,
          [id]
        ),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE rec.reception_visits SET receiving_employee_id = $2 WHERE id = $1`, [
          id,
          EMP_BRANCH_A2,
        ]),
        '23514'
      );
    });
  });
});

describe('history survives a rename and a disable', () => {
  it('still reads back the name captured at reception', async () => {
    const visitId = await withCommittedTx(runtime, ctxA, async (c) => {
      const walkIn = await insWalkIn(c, V8);
      return insVisit(c, { walkIn, vehicle: V8, employee: EMP_BRANCH_A1 });
    });
    try {
      await admin.query(
        `UPDATE iam.user_accounts
            SET display_name = 'Renamed After The Fact', status = 'locked'
          WHERE id = $1`,
        [EMP_BRANCH_A1]
      );
      // Read on the RUNTIME connection: the historical row must remain readable
      // to the application, not merely to a superuser.
      const name = await withRolledBackTx(runtime, ctxA, async (c) => {
        const { rows } = await c.query(
          `SELECT receiving_employee_display_name AS name FROM rec.reception_visits WHERE id = $1`,
          [visitId]
        );
        return rows[0]?.name as string | undefined;
      });
      expect(name).toBe('Branch A1 Receiver');
    } finally {
      await admin.query(
        `UPDATE iam.user_accounts SET display_name = 'Branch A1 Receiver', status = 'active' WHERE id = $1`,
        [EMP_BRANCH_A1]
      );
      await admin.query(`DELETE FROM rec.reception_visits WHERE id = $1`, [visitId]);
      await admin.query(`DELETE FROM rec.walk_in_references WHERE vehicle_id = $1`, [V8]);
    }
  });
});

describe('cross-branch selection is an administrative act', () => {
  it('refuses an out-of-branch employee for an ordinary actor and accepts it for the authorized one', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const walkIn = await insWalkIn(c, V1);
      await expectSqlState(insVisit(c, { walkIn, vehicle: V1, employee: EMP_BRANCH_A2 }), '22023');
    });

    // Same employee, same branch, same statement — only the ACTOR differs, so
    // the permission is provably the only thing that moved.
    await withRolledBackTx(runtime, ctxCross, async (c) => {
      const walkIn = await insWalkIn(c, V1);
      const id = await insVisit(c, { walkIn, vehicle: V1, employee: EMP_BRANCH_A2 });
      const { rows } = await c.query(
        `SELECT receiving_employee_display_name AS name FROM rec.reception_visits WHERE id = $1`,
        [id]
      );
      expect(rows[0].name).toBe('Branch A2 Receiver');
    });
  });

  it('does not let the administrator reach an account that belongs to no branch at all', async () => {
    // The boundary the permission draws, stated as an assertion rather than as
    // a comment: it widens WHICH BRANCH, so it needs another branch to reach
    // into. EMP_NO_GRANT is active and same-tenant and still refused, because
    // an account with no live grant is in no branch for anyone to reach across
    // to — and a custodian with no operational standing is exactly the shape of
    // record this migration exists to stop.
    await withRolledBackTx(runtime, ctxCross, async (c) => {
      const walkIn = await insWalkIn(c, V2);
      await expectSqlState(insVisit(c, { walkIn, vehicle: V2, employee: EMP_NO_GRANT }), '22023');
    });
  });
});

describe('a tenant boundary is not a branch boundary', () => {
  it('refuses a tenant-B account for a tenant-A visit, with and without the administrative permission', async () => {
    for (const ctx of [ctxA, ctxCross]) {
      await withRolledBackTx(runtime, ctx, async (c) => {
        const walkIn = await insWalkIn(c, V3);
        // USER_B is a real, active account — in the OTHER tenant. RLS makes it
        // invisible to the guard's lookup, and the composite foreign key
        // (tenant_id, receiving_employee_id) refuses it besides.
        await expectSqlState(insVisit(c, { walkIn, vehicle: V3, employee: USER_B }), '22023');
      });
    }
  });

  it('refuses a tenant-A account for a tenant-B visit', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_B }, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO rec.reception_visits
             (tenant_id, company_id, branch_id, walk_in_id, vehicle_id, receiving_employee_id,
              receiving_employee_display_name, created_by)
           VALUES ($1,$2,$3,NULL,$4,$5,'x',$6)`,
          [TENANT_B, COMPANY_A1, BRANCH_A1, V1, USER_A, USER_B]
        ),
        // The branch belongs to tenant A, so this row cannot exist for several
        // independent reasons; the point is that NONE of them is "accepted".
        '22023',
        '23503',
        '23514',
        '42501'
      );
    });
  });
});
