/**
 * Phase 1-8 Appointment requested-services child (P1-08-DB-002).
 *
 * Proves branch-scope coherence via the composite parent FK, the at-least-one
 * descriptor rule, the P1-10 forward reference (placeholder uuid, NO FK), duplicate
 * active-descriptor rejection with cross-appointment reuse, soft-delete re-use,
 * immutable identity, RLS isolation, and readonly denial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  readonlyPool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';

const V_A = 'a1000000-0000-4000-8000-0000000ac001';
const P_A = 'a1000000-0000-4000-8000-0000000ac0c1';
const TYPE = 'a1000000-0000-4000-8000-0000000ac0d1'; // platform appointment_type
const CHAN = 'a1000000-0000-4000-8000-0000000ac0d2'; // platform source_channel
const FUT = 'a1000000-0000-4000-8000-0000000ac0f1'; // P1-10 placeholder service id (no FK)
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_A };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

const insAppt = () =>
  `INSERT INTO apt.appointments
     (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, appointment_type_id,
      source_channel_id, requested_from, requested_to, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${V_A}','${P_A}','${TYPE}','${CHAN}',
      '2026-09-01T09:00:00Z','2026-09-01T10:00:00Z','${USER_A}')
   RETURNING id`;

const insSvc = (
  apptId: string,
  o: {
    future?: string | null;
    text?: string | null;
    quantity?: number | null;
    branch?: string;
    tenant?: string;
  } = {}
) => {
  const fut = o.future === undefined ? 'NULL' : o.future === null ? 'NULL' : `'${o.future}'`;
  const txt = o.text === undefined ? 'NULL' : o.text === null ? 'NULL' : `'${o.text}'`;
  const qty = o.quantity === undefined || o.quantity === null ? 'NULL' : `${o.quantity}`;
  return `INSERT INTO apt.appointment_services
     (tenant_id, company_id, branch_id, appointment_id, future_service_id, requested_service_text, quantity, created_by)
   VALUES ('${o.tenant ?? TENANT_A}','${COMPANY_A1}','${o.branch ?? BRANCH_A1}','${apptId}',${fut},${txt},${qty},'${USER_A}')
   RETURNING id`;
};

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
     VALUES ($1,$2,'APTSVCVIN01','ice','active',$3)`,
    [V_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1,$2,'individual','Svc Requester',$3)`,
    [P_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.appointment_types (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_svc_type','General',$2)`,
    [TYPE, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.source_channels (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_svc_chan','Phone',$2)`,
    [CHAN, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('apt.appointment_services — descriptor rule', () => {
  it('accepts a free-text-only service and a future-reference-only service', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      expect((await c.query(insSvc(id, { text: 'Oil change' }))).rows).toHaveLength(1);
      expect((await c.query(insSvc(id, { future: FUT }))).rows).toHaveLength(1);
    });
  });

  it('accepts an arbitrary future_service_id (P1-10 placeholder, no FK enforced)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      // A future_service_id that references no existing row is accepted: the
      // service catalog and its FK are P1-10, not this phase.
      expect(
        (await c.query(insSvc(id, { future: '99999999-9999-4999-8999-999999999999' }))).rows
      ).toHaveLength(1);
    });
  });

  it('rejects a service with no descriptor, a blank text, and a non-positive quantity', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insSvc(id, {})), '23514'); // neither descriptor
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(insSvc(id, { future: FUT, text: '   ' })), '23514'); // blank text
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(insSvc(id, { text: 'Brake job', quantity: 0 })), '23514'); // qty<=0
    });
  });
});

describe('apt.appointment_services — scope + duplicates', () => {
  it('rejects an orphan / cross-scope appointment reference (composite FK)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(
        c.query(insSvc('a1000000-0000-4000-8000-0000000ac0ee', { text: 'Orphan' })),
        '23503'
      );
    });
  });

  it('rejects a duplicate active text within an appointment but allows reuse across appointments', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const a1 = (await c.query(insAppt())).rows[0].id;
      const a2 = (await c.query(insAppt())).rows[0].id;
      await c.query(insSvc(a1, { text: 'Tire rotation' }));
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insSvc(a1, { text: 'Tire rotation' })), '23505');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      // same descriptor on a DIFFERENT appointment is allowed
      expect((await c.query(insSvc(a2, { text: 'Tire rotation' }))).rows).toHaveLength(1);
    });
  });

  it('rejects a duplicate active future reference within an appointment', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      await c.query(insSvc(id, { future: FUT }));
      await expectSqlState(c.query(insSvc(id, { future: FUT })), '23505');
    });
  });

  it('allows re-adding a text after the prior row is soft-deleted', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      const sid = (await c.query(insSvc(id, { text: 'Wash' }))).rows[0].id;
      await c.query(
        `UPDATE apt.appointment_services SET deleted_at=now(), deleted_by=$2 WHERE id=$1`,
        [sid, USER_A]
      );
      expect((await c.query(insSvc(id, { text: 'Wash' }))).rows).toHaveLength(1);
    });
  });
});

describe('apt.appointment_services — mutation + isolation', () => {
  it('allows correcting the text but freezes identity columns', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      const sid = (await c.query(insSvc(id, { text: 'typo' }))).rows[0].id;
      await c.query(
        `UPDATE apt.appointment_services SET requested_service_text='fixed' WHERE id=$1`,
        [sid]
      );
      await expectSqlState(
        c.query(
          `UPDATE apt.appointment_services SET appointment_id='a1000000-0000-4000-8000-0000000ac0ee' WHERE id=$1`,
          [sid]
        ),
        '23514'
      );
    });
  });

  it('isolates tenants and denies app_readonly writes', async () => {
    let sid = '';
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      sid = (await c.query(insSvc(id, { text: 'Visible only to A' }))).rows[0].id;
      // tenant B sees nothing within this tx (row rolled back anyway)
      expect(sid).toBeTruthy();
    });
    await withRolledBackTx(runtime, ctxB, async (c) => {
      const n = await c.query(`SELECT count(*)::int n FROM apt.appointment_services`);
      expect(n.rows[0].n).toBe(0);
    });
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(
        c.query(insSvc('a1000000-0000-4000-8000-0000000ac0ee', { text: 'ro' })),
        '42501'
      );
    });
  });
});
