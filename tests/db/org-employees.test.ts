/**
 * P1-31 P-17 — the employee register, and the delivering employee it makes real.
 *
 * Two migrations are under test:
 * `20260910090000_org_employees.sql` and
 * `20260910091000_sal_delivery_delivering_employee_identity.sql`.
 *
 * Everything here is proved at the DATABASE rather than at the API, because the
 * application is not the authority. A job, a future service or a psql session
 * writes through the same policies and the same trigger, and a rule enforced only
 * in TypeScript is a rule every other writer skips. The API's translation of these
 * refusals into field-level violations is proved separately, in
 * `tests/backend/p1-31-delivering-employee-seam.test.ts`.
 *
 * The obligations, one describe block each:
 *
 *   1. `org.employees` is tenant-isolated by RLS and READABLE across the tenant,
 *      while a branch-scoped session still cannot write into a branch it does
 *      not hold;
 *   2. no application role may DELETE an employee — retirement is a status;
 *   3. `sal.delivery_records.delivering_employee_id` refuses a uuid that names no
 *      employee, which is the state the column was in until this slice;
 *   4. the eligibility trigger refuses a RETIRED, a SOFT-DELETED and an
 *      other-tenant employee, ACCEPTS one whose home branch is another branch of
 *      the same tenant, and stamps the display-name snapshot from the row rather
 *      than from the caller;
 *   5. the operator command's own core, imported from
 *      `scripts/platform/backfill-delivering-employee-identity.mjs` rather than
 *      retyped, mints exactly one employee per RESOLVABLE legacy value, stamps
 *      its snapshot, and leaves an unresolvable one untouched and listed for
 *      review — while the migration itself ships no row write at all;
 *   6. the review list that step 5 produces is readable only inside its own
 *      tenant and writable by no application role at all, its INSERT policy
 *      refusing every row on purpose.
 *
 * The read scope and the missing branch rule are both the Owner clarification of
 * 2026-09-10: an employee's home branch is informational and transferable, and it
 * must never become a restriction against authorized work in another branch of
 * the same tenant.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client, Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  readonlyPool,
  runtimePool,
  withRolledBackTx,
} from './helpers';
import {
  P11,
  ctxA,
  deliveringEmployee,
  expectFail,
  makeWorkOrder,
  seedP111Base,
  cleanP111Committed,
} from './p1-11-helpers';
import {
  BACKFILL_AUDIT_ACTION,
  backfillOneTenant,
  validationVerdict,
} from '../../scripts/platform/backfill-delivering-employee-identity.mjs';

const SYS = '00000000-0000-4000-8000-000000000001';

/** A second branch in the SAME company — the "other branch" of obligation 4. */
const BRANCH_A2 = 'f1310000-0000-4000-8000-0000001700b2';

/** Tenant B's own company and branch. `ensureOrgFixtures` provisions neither. */
const COMPANY_B = 'f1310000-0000-4000-8000-000000170bc1';
const BRANCH_B = 'f1310000-0000-4000-8000-000000170bb1';

/** The application roles. `postgres` OWNS the table and is not one of them. */
const APPLICATION_ROLES = ['app_runtime', 'app_readonly', 'app_worker', 'app_platform'];

/** An identifier that names no employee anywhere — the forged-officer probe. */
const UNKNOWN_EMPLOYEE = 'f1310000-0000-4000-8000-0000001700ff';

const MIGRATION_DIR = join(__dirname, '..', '..', 'supabase', 'migrations');
const BACKFILL_MIGRATION = '20260910091000_sal_delivery_delivering_employee_identity.sql';

type Q = { query: Client['query'] };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

const insertEmployee = async (
  c: Q,
  input: {
    readonly tenantId?: string;
    readonly companyId?: string;
    readonly branchId?: string;
    readonly displayName?: string;
    readonly status?: string;
    readonly employmentRef?: string | null;
  } = {}
): Promise<string> =>
  (
    await c.query(
      `INSERT INTO org.employees
         (tenant_id, company_id, branch_id, display_name, employment_ref, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        input.tenantId ?? TENANT_A,
        input.companyId ?? COMPANY_A1,
        input.branchId ?? BRANCH_A1,
        input.displayName ?? 'Fixture handover officer',
        input.employmentRef ?? null,
        input.status ?? 'active',
        USER_A,
      ]
    )
  ).rows[0].id as string;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
  runtime = runtimePool();
  readonly = readonlyPool();

  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'fx_p131_p17_a2','Fixture Branch A2','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A1, SYS]
  );
  // Tenant B owns no company and no branch in the shared org fixtures, and the
  // isolation cases below need a real one: an employee that cannot be created is
  // not evidence that it cannot be seen.
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'fx_p131_p17_b1','Fixture Company B1','USD',$3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B, TENANT_B, SYS]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'fx_p131_p17_b1','Fixture Branch B1','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B, TENANT_B, COMPANY_B, SYS]
  );
}, 240_000);

afterAll(async () => {
  if (runtime) await runtime.end();
  if (readonly) await readonly.end();
  if (admin) {
    await cleanP111Committed(admin).catch(() => undefined);
    await admin
      .query(`DELETE FROM org.employees WHERE tenant_id = ANY($1::uuid[])`, [[TENANT_A, TENANT_B]])
      .catch(() => undefined);
    await admin
      .query(`DELETE FROM org.branches WHERE id = ANY($1::uuid[])`, [[BRANCH_A2, BRANCH_B]])
      .catch(() => undefined);
    await admin
      .query(`DELETE FROM org.legal_companies WHERE id = $1`, [COMPANY_B])
      .catch(() => undefined);
    await cleanFixtures(admin);
    await admin.end();
  }
});

// ===========================================================================
describe('1. org.employees is tenant-isolated, read tenant-wide and written scope-restricted', () => {
  it('Tenant A cannot see an employee of Tenant B, even addressing it directly', async () => {
    const foreign = (
      await admin.query<{ id: string }>(
        `INSERT INTO org.employees
           (tenant_id, company_id, branch_id, display_name, created_by)
         VALUES ($1,$2,$3,'Officer of the other tenant',$4) RETURNING id`,
        [TENANT_B, COMPANY_B, BRANCH_B, SYS]
      )
    ).rows[0];
    expect(foreign).toBeDefined();

    await withRolledBackTx(runtime, ctxA, async (c) => {
      const visible = await c.query(`SELECT id FROM org.employees WHERE id = $1`, [foreign?.id]);
      expect(visible.rowCount).toBe(0);
      // Not merely unreadable: unwritable. `upd_employees_scope` narrows the USING
      // clause, so the update matches nothing rather than being refused.
      const updated = await c.query(`UPDATE org.employees SET status = 'inactive' WHERE id = $1`, [
        foreign?.id,
      ]);
      expect(updated.rowCount).toBe(0);
    });

    await admin.query(`DELETE FROM org.employees WHERE id = $1`, [foreign?.id]);
  });

  it('a session cannot write an employee into ANOTHER tenant (WITH CHECK)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectFail(
        c,
        '42501',
        `INSERT INTO org.employees (tenant_id, company_id, branch_id, display_name, created_by)
         VALUES ($1,$2,$3,'Officer smuggled across a tenant',$4)`,
        [TENANT_B, COMPANY_B, BRANCH_B, USER_A]
      );
    });
  });

  it('a BRANCH-scoped session CAN READ an employee based in another branch of its tenant', async () => {
    // The Owner clarification of 2026-09-10, at the primitive: `sel_employees_tenant`
    // bounds the read at the TENANT and at nothing narrower, because a
    // branch-restricted operator recording a handover has to be able to resolve a
    // colleague based elsewhere. Without this the delivery trigger — which runs
    // SECURITY INVOKER under this very session — would refuse that handover as an
    // employee that does not exist, and the home branch would be a fence after all.
    const elsewhere = await insertEmployee(
      { query: admin.query.bind(admin) },
      { branchId: BRANCH_A2, displayName: 'Officer based in the other branch' }
    );
    try {
      await withRolledBackTx(
        runtime,
        { tenantId: TENANT_A, userId: USER_A, companyIds: [COMPANY_A1], branchIds: [BRANCH_A1] },
        async (c) => {
          const visible = await c.query<{ display_name: string }>(
            `SELECT display_name FROM org.employees WHERE id = $1`,
            [elsewhere]
          );
          expect(visible.rowCount).toBe(1);
          expect(visible.rows[0]?.display_name).toBe('Officer based in the other branch');

          // Readable is not writable. `upd_employees_scope` keeps its branch
          // predicate, so administering this person is still somebody else's job.
          const updated = await c.query(
            `UPDATE org.employees SET status = 'inactive' WHERE id = $1`,
            [elsewhere]
          );
          expect(updated.rowCount).toBe(0);
        }
      );
    } finally {
      await admin.query(`DELETE FROM org.employees WHERE id = $1`, [elsewhere]);
    }
  });

  it('a BRANCH-scoped session cannot insert into a branch it does not hold', async () => {
    await withRolledBackTx(
      runtime,
      { tenantId: TENANT_A, userId: USER_A, companyIds: [COMPANY_A1], branchIds: [BRANCH_A1] },
      async (c) => {
        // Its own branch is allowed, so the refusal below is the SCOPE and not the
        // grant, the policy's existence, or the table.
        const mine = await insertEmployee(c, { branchId: BRANCH_A1 });
        expect(mine).toBeTruthy();
        await expectFail(
          c,
          '42501',
          `INSERT INTO org.employees (tenant_id, company_id, branch_id, display_name, created_by)
           VALUES ($1,$2,$3,'Officer of a branch this session may not reach',$4)`,
          [TENANT_A, COMPANY_A1, BRANCH_A2, USER_A]
        );
      }
    );
  });

  it('refuses a blank display name and a blank employment reference', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectFail(
        c,
        '23514',
        `INSERT INTO org.employees (tenant_id, company_id, branch_id, display_name, created_by)
         VALUES ($1,$2,$3,'   ',$4)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
      );
      await expectFail(
        c,
        '23514',
        `INSERT INTO org.employees
           (tenant_id, company_id, branch_id, display_name, employment_ref, created_by)
         VALUES ($1,$2,$3,'Officer','  ',$4)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
      );
    });
  });

  it('admits one employee per employment reference among live rows in a tenant', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await insertEmployee(c, { employmentRef: 'fx_p131_p17_unique' });
      await expectFail(
        c,
        '23505',
        `INSERT INTO org.employees
           (tenant_id, company_id, branch_id, display_name, employment_ref, created_by)
         VALUES ($1,$2,$3,'Second holder of one reference','fx_p131_p17_unique',$4)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
      );
    });
  });
});

// ===========================================================================
describe('2. an employee is retired, never removed', () => {
  it('grants DELETE on org.employees to no application role', async () => {
    // `postgres` owns the table and therefore holds every privilege on it; the
    // claim is about the roles the APPLICATION connects as, and it is asserted
    // against the same four every other posture case in this tier names.
    const { rows } = await admin.query<{ grantee: string; privilege_type: string }>(
      `SELECT grantee, privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'org' AND table_name = 'employees'
          AND privilege_type = 'DELETE' AND grantee = ANY($1::text[])`,
      [APPLICATION_ROLES]
    );
    expect(rows).toEqual([]);

    // Non-vacuity: the same query for SELECT is NOT empty, so an empty answer
    // above is the absence of a grant rather than a query that matches nothing.
    const readable = await admin.query(
      `SELECT grantee FROM information_schema.role_table_grants
        WHERE table_schema = 'org' AND table_name = 'employees'
          AND privilege_type = 'SELECT' AND grantee = ANY($1::text[])`,
      [APPLICATION_ROLES]
    );
    expect(readable.rowCount).toBeGreaterThan(0);
  });

  it('creates no DELETE policy for org.employees', async () => {
    const { rows } = await admin.query<{ polname: string }>(
      `SELECT p.polname FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'org' AND c.relname = 'employees' AND p.polcmd = 'd'`
    );
    expect(rows).toEqual([]);
  });

  it('freezes the tenant, the company and the provenance, and leaves the branch mutable', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const employee = await insertEmployee(c);
      // A transfer is a legitimate act under Owner assumption A-2, so the guard
      // deliberately does NOT freeze branch_id. Asserted rather than assumed: a
      // later "tidy" that added it here would silently forbid transfers.
      const moved = await c.query(`UPDATE org.employees SET branch_id = $2 WHERE id = $1`, [
        employee,
        BRANCH_A2,
      ]);
      expect(moved.rowCount).toBe(1);
      // A DIFFERENT value, because the guard compares old to new: re-setting a
      // column to what it already holds changes nothing and must not raise.
      await expectFail(c, '23514', `UPDATE org.employees SET created_by = $2 WHERE id = $1`, [
        employee,
        USER_B,
      ]);
    });
  });
});

// ===========================================================================
describe('3. the delivering employee is a real identity', () => {
  it('refuses a uuid that names no employee (23503) — the state the column was in', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo, visit, vehicle } = await makeWorkOrder(c, 'p17fk');
      // 22023 from the eligibility trigger, which fires BEFORE the foreign key is
      // consulted and refuses on a lookup that finds nothing. The key underneath
      // is asserted separately below, by name, because a trigger can be dropped
      // and a constraint cannot be dropped silently.
      await expectFail(
        c,
        '22023',
        `INSERT INTO sal.delivery_records
           (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
            delivering_employee_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, visit, vehicle, UNKNOWN_EMPLOYEE, USER_A]
      );
    });
  });

  it('carries the composite foreign key on (tenant_id, delivering_employee_id), ON DELETE RESTRICT', async () => {
    const { rows } = await admin.query<{ definition: string; validated: boolean }>(
      `SELECT pg_get_constraintdef(c.oid) AS definition, c.convalidated AS validated
         FROM pg_constraint c
        WHERE c.conname = 'fk_delivery_records_delivering_employee'`
    );
    expect(rows).toHaveLength(1);
    const definition = rows[0]?.definition ?? '';
    // The TENANT and nothing narrower. A four-column key would have made the
    // employee's home branch a constraint on every delivery that names them,
    // which is exactly what the Owner clarification of 2026-09-10 forbids.
    expect(definition).toContain('tenant_id, delivering_employee_id');
    expect(definition).toContain('org.employees(tenant_id, id)');
    expect(definition).not.toContain('company_id');
    expect(definition).toContain('ON DELETE RESTRICT');

    // This database resolved every legacy value it had — it had none — so the
    // migration's DO block validated the key rather than leaving it enforcing
    // only future rows. Read from `convalidated` rather than from the printed
    // definition, because that is the catalogue's own answer.
    expect(rows[0]?.validated).toBe(true);
    const review = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM sal.delivery_legacy_identity_review`
    );
    expect(review.rows[0]?.n).toBe('0');
  });
});

// ===========================================================================
describe('4. the eligibility trigger, and the snapshot it stamps', () => {
  it('refuses a RETIRED employee (22023)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo, visit, vehicle } = await makeWorkOrder(c, 'p17inact');
      const employee = await insertEmployee(c, { status: 'inactive' });
      await expectFail(
        c,
        '22023',
        `INSERT INTO sal.delivery_records
           (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
            delivering_employee_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, visit, vehicle, employee, USER_A]
      );
    });
  });

  it('refuses a SOFT-DELETED employee (22023)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo, visit, vehicle } = await makeWorkOrder(c, 'p17del');
      const employee = await insertEmployee(c);
      await c.query(`UPDATE org.employees SET deleted_at = now() WHERE id = $1`, [employee]);
      await expectFail(
        c,
        '22023',
        `INSERT INTO sal.delivery_records
           (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
            delivering_employee_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, visit, vehicle, employee, USER_A]
      );
    });
  });

  it('ACCEPTS an employee based in ANOTHER BRANCH of the same tenant, and stamps them', async () => {
    // This case asserted a refusal until the Owner clarification of 2026-09-10.
    // The home branch is informational and transferable: refusing a colleague
    // sent to another site would be refusing authorized work, so the trigger
    // does not read the employee's branch at all and the key does not name it.
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo, visit, vehicle } = await makeWorkOrder(c, 'p17branch');
      const employee = await insertEmployee(c, {
        branchId: BRANCH_A2,
        displayName: 'Officer based in the other branch',
      });
      const delivery = (
        await c.query<{ id: string; branch_id: string; delivering_employee_display_name: string }>(
          `INSERT INTO sal.delivery_records
             (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
              delivering_employee_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           RETURNING id, branch_id, delivering_employee_display_name`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, wo, visit, vehicle, employee, USER_A]
        )
      ).rows[0];
      // Accepted, stamped from the employee's own row, and recorded in the
      // WORK ORDER's branch: the employee's branch is not copied anywhere.
      expect(delivery?.branch_id).toBe(BRANCH_A1);
      expect(delivery?.delivering_employee_display_name).toBe('Officer based in the other branch');
    });
  });

  it('refuses an employee of ANOTHER TENANT (22023)', async () => {
    // What replaced the branch rule. The lookup is bounded by tenant twice over —
    // `sel_employees_tenant` and the trigger's own `tenant_id = NEW.tenant_id` —
    // and answers absent, soft-deleted and foreign with ONE refusal, so a delivery
    // insert cannot be used to probe another organisation's roster.
    const foreign = (
      await admin.query<{ id: string }>(
        `INSERT INTO org.employees
           (tenant_id, company_id, branch_id, display_name, created_by)
         VALUES ($1,$2,$3,'Officer of the other tenant',$4) RETURNING id`,
        [TENANT_B, COMPANY_B, BRANCH_B, SYS]
      )
    ).rows[0];
    try {
      await withRolledBackTx(runtime, ctxA, async (c) => {
        const { wo, visit, vehicle } = await makeWorkOrder(c, 'p17foreign');
        await expectFail(
          c,
          '22023',
          `INSERT INTO sal.delivery_records
             (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
              delivering_employee_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, wo, visit, vehicle, foreign?.id, USER_A]
        );
      });
    } finally {
      await admin.query(`DELETE FROM org.employees WHERE id = $1`, [foreign?.id]);
    }
  });

  it('stamps the snapshot from the ROW and throws away what the caller supplied', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { wo, visit, vehicle } = await makeWorkOrder(c, 'p17stamp');
      const employee = await insertEmployee(c, { displayName: 'The officer on duty' });
      const delivery = (
        await c.query<{ id: string }>(
          `INSERT INTO sal.delivery_records
             (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
              delivering_employee_id, delivering_employee_display_name, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'ignored by the server',$8) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, wo, visit, vehicle, employee, USER_A]
        )
      ).rows[0];

      const stored = await c.query<{ delivering_employee_display_name: string }>(
        `SELECT delivering_employee_display_name FROM sal.delivery_records WHERE id = $1`,
        [delivery?.id]
      );
      expect(stored.rows[0]?.delivering_employee_display_name).toBe('The officer on duty');

      // And it is immutable afterwards, so a rename cannot rewrite what a customer
      // already signed. Retiring the employee leaves the snapshot untouched.
      await expectFail(
        c,
        '23514',
        `UPDATE sal.delivery_records SET delivering_employee_display_name = 'rewritten' WHERE id = $1`,
        [delivery?.id]
      );
      await c.query(`UPDATE org.employees SET display_name = 'Renamed' WHERE id = $1`, [employee]);
      const after = await c.query<{ delivering_employee_display_name: string }>(
        `SELECT delivering_employee_display_name FROM sal.delivery_records WHERE id = $1`,
        [delivery?.id]
      );
      expect(after.rows[0]?.delivering_employee_display_name).toBe('The officer on duty');
    });
  });

  it('refuses to remove an employee a delivery still names (23503)', async () => {
    /*
     * One connection, and as the ADMIN, for two reasons that are not stylistic.
     * No application role holds DELETE at all, so a runtime refusal would be a
     * privilege error and would prove nothing about the key. And the delivery has
     * to be VISIBLE to the deleting statement: a row written on the runtime
     * connection inside an open transaction is invisible to any other session, so
     * a two-connection version of this case would delete an employee nothing
     * appeared to reference and pass while proving the opposite.
     */
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      const q = { query: client.query.bind(client) };
      const { wo, visit, vehicle } = await makeWorkOrder(q, 'p17restrict');
      const employee = await deliveringEmployee(q, 'restrict');
      await client.query(
        `INSERT INTO sal.delivery_records
           (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
            delivering_employee_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, wo, visit, vehicle, employee, USER_A]
      );
      await expect(
        client.query(`DELETE FROM org.employees WHERE id = $1`, [employee])
      ).rejects.toMatchObject({ code: '23503' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

// ===========================================================================
describe('5. the legacy mint, driven as the operator command drives it', () => {
  /*
   * The mint and the review write USED to be statements in migration 141, and
   * these cases used to slice them out of the committed file and replay them.
   * `scripts/ci/migration-replay-checks.mjs` refused that migration on the hosted
   * run — correctly: a migration that INSERTs into `org.employees` is, to any
   * scanner and any reviewer, indistinguishable from one that ships fabricated
   * people. The row-level work now lives in
   * `scripts/platform/backfill-delivering-employee-identity.mjs`, so these cases
   * drive THAT — `backfillOneTenant`, the command's own core, imported rather than
   * retyped, on the very rows an operator would meet. Both proofs survive the
   * move: a resolvable legacy value is minted and stamped, an unresolvable one is
   * left untouched and listed, and the key validates in the first case and refuses
   * to in the second. The command's STRUCTURAL properties — that no statement it
   * can execute is a DELETE, a TRUNCATE or a DROP, and that its single UPDATE can
   * only fill a NULL snapshot — are asserted in
   * `tests/backend/p1-31-delivering-employee-backfill.test.ts` (DEB-1), which is
   * also where its input and authority gates are proved.
   */

  /** The real organisation row, read rather than invented. */
  const tenantTarget = async (): Promise<{
    id: string;
    tenant_code: string;
    status: string;
  }> =>
    (
      await admin.query<{ id: string; tenant_code: string; status: string }>(
        `SELECT id, tenant_code, status FROM org.tenants WHERE id = $1`,
        [TENANT_A]
      )
    ).rows[0]!;

  it('mints exactly one employee per legacy value, stamps it, and never invents a person', async () => {
    const target = await tenantTarget();
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );

      // Reproduce the pre-migration state INSIDE this transaction: drop the key and
      // the guard, write a legacy row naming a LOGIN ACCOUNT id exactly as every
      // fixture in this repository used to, then put them back.
      await client.query(
        `ALTER TABLE sal.delivery_records
           DROP CONSTRAINT fk_delivery_records_delivering_employee`
      );
      await client.query(
        `DROP TRIGGER tg_delivery_records_delivering_employee ON sal.delivery_records`
      );

      const { wo, visit, vehicle } = await makeWorkOrder(
        { query: client.query.bind(client) },
        'p17bf'
      );
      const delivery = (
        await client.query<{ id: string }>(
          `INSERT INTO sal.delivery_records
             (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
              delivering_employee_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$7) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, wo, visit, vehicle, P11.APPROVER_USER]
        )
      ).rows[0];

      // Every delivery of this tenant carrying NO snapshot, listed BEFORE the
      // command runs. The stamped count it reports is compared with how many of
      // exactly THESE rows ended up carrying one, rather than with a number this
      // test chose or with a count the command could have computed itself.
      const nullBefore = (
        await client.query<{ id: string }>(
          `SELECT id FROM sal.delivery_records
            WHERE tenant_id = $1 AND delivering_employee_display_name IS NULL`,
          [TENANT_A]
        )
      ).rows.map((row) => row.id);
      expect(nullBefore).toContain(delivery?.id);

      const result = await backfillOneTenant(client, target, {
        operatorAccountId: USER_A,
        environment: 'local-acceptance',
      });

      // TWO legacy rows for the same person would still mint ONE employee: the
      // statement is DISTINCT ON (tenant, legacy value), which is what makes the
      // legacy uuid usable as a primary key. The home branch it takes from the
      // earliest of those rows is informational, so which one it picks is not a
      // decision the command has to defend — only that it picks exactly one.
      expect(result.minted).toEqual([P11.APPROVER_USER]);
      expect(result.unresolved).toEqual([]);
      expect(result.outcome).toBe('processed');

      const employee = await client.query<{
        id: string;
        status: string;
        user_account_id: string;
        display_name: string;
      }>(`SELECT id, status, user_account_id, display_name FROM org.employees WHERE id = $1`, [
        P11.APPROVER_USER,
      ]);
      const row = employee.rows[0];
      expect(row?.id).toBe(P11.APPROVER_USER);
      expect(row?.user_account_id).toBe(P11.APPROVER_USER);
      expect(row?.status).toBe('inactive');
      // The name came from the account, not from anywhere this test chose.
      const account = await client.query<{ display_name: string }>(
        `SELECT display_name FROM iam.user_accounts WHERE id = $1`,
        [P11.APPROVER_USER]
      );
      expect(row?.display_name).toBe(account.rows[0]?.display_name);

      // The snapshot the migration can no longer take, because the identity it
      // names is minted after the migration has run. NULL means "never resolved",
      // so a row the command DID resolve must not keep one.
      const filled = (
        await client.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM sal.delivery_records
            WHERE id = ANY($1::uuid[]) AND delivering_employee_display_name IS NOT NULL`,
          [nullBefore]
        )
      ).rows[0]?.n;
      expect(String(result.stamped)).toBe(filled);
      expect(result.stamped).toBeGreaterThanOrEqual(1);
      const stamped = await client.query<{ delivering_employee_display_name: string | null }>(
        `SELECT delivering_employee_display_name FROM sal.delivery_records WHERE id = $1`,
        [delivery?.id]
      );
      expect(stamped.rows[0]?.delivering_employee_display_name).toBe(account.rows[0]?.display_name);

      // The operator act is recorded in the tenant it changed.
      const audit = await client.query<{ actor_id: string }>(
        `SELECT actor_id FROM iam.audit_records WHERE tenant_id = $1 AND action = $2`,
        [TENANT_A, BACKFILL_AUDIT_ACTION]
      );
      expect(audit.rowCount).toBe(1);
      expect(audit.rows[0]?.actor_id).toBe(USER_A);

      // And the foreign key the migration adds is now satisfiable AND validatable,
      // which is the property the mint exists to establish.
      await client.query(
        `ALTER TABLE sal.delivery_records
           ADD CONSTRAINT fk_delivery_records_delivering_employee
           FOREIGN KEY (tenant_id, delivering_employee_id)
           REFERENCES org.employees (tenant_id, id) ON DELETE RESTRICT NOT VALID`
      );
      await client.query(
        `ALTER TABLE sal.delivery_records
           VALIDATE CONSTRAINT fk_delivery_records_delivering_employee`
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('leaves an UNRESOLVABLE legacy value untouched, lists it, and withholds validation', async () => {
    const target = await tenantTarget();
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );

      // The pre-migration state again, and this time the legacy value names
      // NOBODY — not an account, not an employee. This is the case the Owner
      // clarification of 2026-09-10 settled: do not RAISE, do not substitute the
      // actor, do not fabricate a person. Leave the history alone and report it.
      await client.query(
        `ALTER TABLE sal.delivery_records
           DROP CONSTRAINT fk_delivery_records_delivering_employee`
      );
      await client.query(
        `DROP TRIGGER tg_delivery_records_delivering_employee ON sal.delivery_records`
      );

      const { wo, visit, vehicle } = await makeWorkOrder(
        { query: client.query.bind(client) },
        'p17orphan'
      );
      const delivery = (
        await client.query<{ id: string }>(
          `INSERT INTO sal.delivery_records
             (tenant_id, company_id, branch_id, work_order_id, reception_visit_id, vehicle_id,
              delivering_employee_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, wo, visit, vehicle, UNKNOWN_EMPLOYEE, USER_A]
        )
      ).rows[0];

      const result = await backfillOneTenant(client, target);
      // Nothing is minted for it — the mint joins iam.user_accounts and this value
      // is in no such row.
      expect(result.minted).toEqual([]);
      expect(result.unresolved).toContain(delivery?.id);

      const listed = await client.query<{ legacy_value: string; delivery_id: string }>(
        `SELECT delivery_id, legacy_value FROM sal.delivery_legacy_identity_review
          WHERE delivery_id = $1`,
        [delivery?.id]
      );
      expect(listed.rows[0]?.legacy_value).toBe(UNKNOWN_EMPLOYEE);

      // The delivery itself is EXACTLY as it was: the same uuid, and no name
      // invented for a person nobody identified.
      const untouched = await client.query<{
        delivering_employee_id: string;
        delivering_employee_display_name: string | null;
      }>(
        `SELECT delivering_employee_id, delivering_employee_display_name
           FROM sal.delivery_records WHERE id = $1`,
        [delivery?.id]
      );
      expect(untouched.rows[0]?.delivering_employee_id).toBe(UNKNOWN_EMPLOYEE);
      expect(untouched.rows[0]?.delivering_employee_display_name).toBeNull();

      // And the key still lands, NOT VALID, so every FUTURE row is bound while the
      // unresolved history survives. The command WITHHOLDS validation here, and
      // that refusal is not a matter of taste: validating is what fails.
      await client.query(
        `ALTER TABLE sal.delivery_records
           ADD CONSTRAINT fk_delivery_records_delivering_employee
           FOREIGN KEY (tenant_id, delivering_employee_id)
           REFERENCES org.employees (tenant_id, id) ON DELETE RESTRICT NOT VALID`
      );
      const verdict = await validationVerdict(client);
      expect(verdict.verdict).toBe('withheld');
      expect(verdict.unresolved).not.toBe('0');
      await expect(
        client.query(
          `ALTER TABLE sal.delivery_records
             VALIDATE CONSTRAINT fk_delivery_records_delivering_employee`
        )
      ).rejects.toMatchObject({ code: '23503' });
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('ships NO mint in the migration, and names the command that owns it', () => {
    const source = readFileSync(join(MIGRATION_DIR, BACKFILL_MIGRATION), 'utf8');
    // The defect the hosted run found, asserted so it cannot come back: no row
    // write into either table, at any level of this file.
    expect(source).not.toMatch(/INSERT\s+INTO\s+org\.employees/i);
    expect(source).not.toMatch(/INSERT\s+INTO\s+sal\.delivery_legacy_identity_review/i);
    expect(source).toContain('scripts/platform/backfill-delivering-employee-identity.mjs');
    // The structure it does keep, and the ONE condition under which it is entitled
    // to claim the history satisfies the key: no history at all.
    expect(source).toContain('NOT VALID');
    expect(source).toContain('VALIDATE CONSTRAINT fk_delivery_records_delivering_employee');
    expect(source).toContain('SELECT count(*) INTO v_deliveries FROM sal.delivery_records;');
    expect(source).toContain('RAISE NOTICE');
    // The refusal that used to be here — a RAISE on a dangling value — was removed
    // with the Owner clarification of 2026-09-10, so its absence is asserted too.
    expect(source).not.toContain('P-17 migration refused');
  });

  it('has no unresolved delivering identity on this database', async () => {
    // The probe itself, over the live table rather than over the file.
    const { rows } = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM sal.delivery_records record
        WHERE NOT EXISTS (
          SELECT 1 FROM org.employees employee
           WHERE employee.tenant_id = record.tenant_id
             AND employee.id = record.delivering_employee_id
        )`
    );
    expect(rows[0]?.n).toBe('0');
  });
});

// ===========================================================================
describe('6. the review list is tenant-isolated and read-only to every application role', () => {
  /*
   * Nothing in the product reads or writes this table: the operator command
   * writes it and no operation publishes it. That is exactly why its policy is
   * asserted here rather than assumed — a list nothing exercises is a list
   * whose isolation nothing would have caught. Both halves matter and neither
   * implies the other: a row readable across the tenant boundary would expose
   * one organisation's unresolved handovers to another, and a list its own
   * tenant can edit is not evidence of anything.
   *
   * The two rows are provisioned on the ADMIN connection and COMMITTED, because
   * a row written inside an open transaction on one connection is invisible to
   * every other session — a rolled-back provisioning would only have proved
   * that an invisible row is invisible.
   *
   * `delivery_id` is deliberately not a foreign key (the migration says why),
   * so these fixtures need no delivery behind them; `tenant_id` IS one, and
   * both tenants exist in the shared org fixtures. The admin connection writes
   * them because it owns the table — the same privileged identity the operator
   * command runs on, and the only one that can.
   */
  const REVIEW_DELIVERY_A = 'f1310000-0000-4000-8000-0000001700c1';
  const REVIEW_LEGACY_A = 'f1310000-0000-4000-8000-0000001700c2';
  const REVIEW_DELIVERY_B = 'f1310000-0000-4000-8000-0000001700d1';
  const REVIEW_LEGACY_B = 'f1310000-0000-4000-8000-0000001700d2';

  const provisionReviewRows = async (): Promise<void> => {
    await admin.query(
      `INSERT INTO sal.delivery_legacy_identity_review (tenant_id, delivery_id, legacy_value)
       VALUES ($1,$2,$3),($4,$5,$6)`,
      [TENANT_A, REVIEW_DELIVERY_A, REVIEW_LEGACY_A, TENANT_B, REVIEW_DELIVERY_B, REVIEW_LEGACY_B]
    );
  };

  const removeReviewRows = async (): Promise<void> => {
    await admin.query(
      `DELETE FROM sal.delivery_legacy_identity_review WHERE delivery_id = ANY($1::uuid[])`,
      [[REVIEW_DELIVERY_A, REVIEW_DELIVERY_B]]
    );
  };

  it('shows a runtime and a read-only session their own tenant row and not the other', async () => {
    await provisionReviewRows();
    try {
      for (const pool of [runtime, readonly]) {
        await withRolledBackTx(pool, ctxA, async (c) => {
          const mine = await c.query<{ legacy_value: string }>(
            `SELECT legacy_value FROM sal.delivery_legacy_identity_review WHERE delivery_id = $1`,
            [REVIEW_DELIVERY_A]
          );
          expect(mine.rowCount).toBe(1);
          expect(mine.rows[0]?.legacy_value).toBe(REVIEW_LEGACY_A);

          // Addressed directly by the other half of its primary key, so an empty
          // answer is the POLICY and not a tenant filter this query remembered
          // to write.
          const theirs = await c.query(
            `SELECT legacy_value FROM sal.delivery_legacy_identity_review WHERE delivery_id = $1`,
            [REVIEW_DELIVERY_B]
          );
          expect(theirs.rowCount).toBe(0);

          // And the unfiltered table is exactly this tenant and no other.
          const everything = await c.query<{ tenant_id: string }>(
            `SELECT DISTINCT tenant_id FROM sal.delivery_legacy_identity_review`
          );
          expect(everything.rows.map((row) => row.tenant_id)).toEqual([TENANT_A]);
        });
      }
    } finally {
      await removeReviewRows();
    }
  });

  it('refuses INSERT, UPDATE and DELETE from the runtime login (42501)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // Its OWN tenant, and a row shaped exactly like the one the operator
      // command writes, so each refusal below is the absent GRANT rather than a
      // tenant predicate the statement failed to satisfy. `42501` is the privilege
      // check, which happens before any policy is consulted: the table does carry
      // an INSERT policy, and it refuses every row (`WITH CHECK (false)`), so the
      // decision is declared in pg_policy instead of inferred from an absence.
      await expectFail(
        c,
        '42501',
        `INSERT INTO sal.delivery_legacy_identity_review (tenant_id, delivery_id, legacy_value)
         VALUES ($1,$2,$3)`,
        [TENANT_A, REVIEW_DELIVERY_A, REVIEW_LEGACY_A]
      );
      await expectFail(
        c,
        '42501',
        `UPDATE sal.delivery_legacy_identity_review SET legacy_value = $1 WHERE tenant_id = $2`,
        [REVIEW_LEGACY_A, TENANT_A]
      );
      await expectFail(
        c,
        '42501',
        `DELETE FROM sal.delivery_legacy_identity_review WHERE tenant_id = $1`,
        [TENANT_A]
      );
    });
  });

  it('declares the refusal as a policy that admits nothing, not as a missing policy', async () => {
    // Every sal, wty and rpt table owes a tenant-scoped SELECT and INSERT policy
    // (tests/db/p1-11-isolation.test.ts enumerates them from the catalog). This
    // table is deliberately unwritable, so the invariant is met by a policy whose
    // WITH CHECK is `false` rather than by exempting the table: the decision is
    // readable in pg_policy instead of inferred from an absence. The 42501 above
    // is what actually stops a write; this is what says why nobody was granted it.
    const { rows } = await admin.query<{ polname: string; cmd: string; qual: string | null }>(
      `SELECT p.polname, p.polcmd AS cmd, pg_get_expr(p.polwithcheck, p.polrelid) AS qual
         FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'sal' AND c.relname = 'delivery_legacy_identity_review'
        ORDER BY p.polname`
    );
    expect(rows.map((row) => row.polname)).toEqual([
      'ins_delivery_legacy_identity_review_refused',
      'sel_delivery_legacy_identity_review_tenant',
    ]);
    const insert = rows.find((row) => row.cmd === 'a');
    expect(insert?.polname).toBe('ins_delivery_legacy_identity_review_refused');
    expect(insert?.qual).toBe('false');
    // No UPDATE and no DELETE policy at all: those need no declaration, because
    // nothing in the design ever wanted one.
    expect(rows.map((row) => row.cmd).sort()).toEqual(['a', 'r']);
  });
});
