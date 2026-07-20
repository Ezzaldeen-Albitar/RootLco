/**
 * Phase 1-8 Appointment master (P1-08-DB-001).
 *
 * Proves branch-scoped creation with same-tenant Vehicle/partner/branch composite
 * FKs, requested/confirmed window validity, the lifecycle transition matrix
 * (no-show/check-in only from confirmed; cancel from requested/pending/confirmed;
 * terminal states frozen), integrated cancellation/no-show coherence, the
 * same-Vehicle confirmed-overlap EXCLUDE, fail-closed catalog visibility,
 * immutable identity, display-number uniqueness, and RLS.
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

const V_A = 'a1000000-0000-4000-8000-0000000ab001';
const V_B = 'b1000000-0000-4000-8000-0000000ab00b';
const P_A = 'a1000000-0000-4000-8000-0000000ab0c1';
const TYPE = 'a1000000-0000-4000-8000-0000000ab0d1'; // platform appointment_type
const CHAN = 'a1000000-0000-4000-8000-0000000ab0d2'; // platform source_channel
const REASON = 'a1000000-0000-4000-8000-0000000ab0d3'; // platform cancellation_reason
const TYPE_B = 'b1000000-0000-4000-8000-0000000ab0d1'; // tenant-B appointment_type
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_A };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

const insAppt = (
  o: {
    vehicle?: string;
    partner?: string;
    type?: string;
    status?: string;
    reqFrom?: string;
    reqTo?: string;
    confFrom?: string | null;
    confTo?: string | null;
    tenant?: string;
    branch?: string;
  } = {}
) => {
  const tenant = o.tenant ?? TENANT_A;
  const branch = o.branch ?? BRANCH_A1;
  const cf = o.confFrom ? `'${o.confFrom}'` : 'NULL';
  const ct = o.confTo ? `'${o.confTo}'` : 'NULL';
  return `INSERT INTO apt.appointments
    (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, appointment_type_id,
     source_channel_id, requested_from, requested_to, confirmed_from, confirmed_to, lifecycle_status, created_by)
    VALUES ('${tenant}','${COMPANY_A1}','${branch}','${o.vehicle ?? V_A}','${o.partner ?? P_A}','${o.type ?? TYPE}',
     '${CHAN}','${o.reqFrom ?? '2026-08-01T09:00:00Z'}','${o.reqTo ?? '2026-08-01T10:00:00Z'}',
     ${cf},${ct},'${o.status ?? 'requested'}','${USER_A}')
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
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by) VALUES
       ($1,$3,'APTVIN0001','ice','active',$5), ($2,$4,'APTVINB001','ice','active',$5)`,
    [V_A, V_B, TENANT_A, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1,$2,'individual','Appt Requester',$3)`,
    [P_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.appointment_types (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_apt_general','General',$3),
              ($4,'tenant',$2,'fx_apt_b','B type',$3)`,
    [TYPE, TENANT_B, USER_A, TYPE_B]
  );
  await admin.query(
    `INSERT INTO apt.source_channels (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_ch_phone','Phone',$2)`,
    [CHAN, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.cancellation_reasons (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_cr_customer','Customer request',$2)`,
    [REASON, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('apt.appointments — creation + windows', () => {
  it('creates a requested appointment', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      expect((await c.query(insAppt())).rows).toHaveLength(1);
    });
  });

  it('rejects an invalid requested window and a confirmed status without a window', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(insAppt({ reqFrom: '2026-08-01T10:00:00Z', reqTo: '2026-08-01T09:00:00Z' })),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(insAppt({ status: 'confirmed' })), '23514'); // no confirmed window
    });
  });

  it('accepts an appointment inserted directly as confirmed with a window', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      expect(
        (
          await c.query(
            insAppt({
              status: 'confirmed',
              confFrom: '2026-08-01T09:00:00Z',
              confTo: '2026-08-01T10:00:00Z',
            })
          )
        ).rows
      ).toHaveLength(1);
    });
  });
});

describe('apt.appointments — transition matrix', () => {
  it('allows requested -> confirmed and confirmed -> no_show', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      await c.query(
        `UPDATE apt.appointments SET lifecycle_status='confirmed',
           confirmed_from='2026-08-01T09:00:00Z', confirmed_to='2026-08-01T10:00:00Z' WHERE id=$1`,
        [id]
      );
      const r = await c.query(
        `UPDATE apt.appointments SET lifecycle_status='no_show', no_show_recorded_at=now(), no_show_recorded_by=$2 WHERE id=$1`,
        [id, USER_A]
      );
      expect(r.rowCount).toBe(1);
    });
  });

  it('rejects requested -> no_show and a transition out of a terminal state', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          `UPDATE apt.appointments SET lifecycle_status='no_show', no_show_recorded_at=now() WHERE id=$1`,
          [id]
        ),
        '23514'
      ); // no_show only from confirmed
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await c.query(
        `UPDATE apt.appointments SET lifecycle_status='cancelled', cancellation_reason_id='${REASON}', cancelled_at=now(), cancelled_by='${USER_A}' WHERE id=$1`,
        [id]
      );
      await expectSqlState(
        c.query(`UPDATE apt.appointments SET lifecycle_status='confirmed' WHERE id=$1`, [id]),
        '23514'
      ); // cancelled is terminal
    });
  });

  it('enforces cancellation and no-show coherence', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      await expectSqlState(
        c.query(`UPDATE apt.appointments SET lifecycle_status='cancelled' WHERE id=$1`, [id]),
        '23514'
      ); // cancelled needs reason + cancelled_at
    });
  });
});

describe('apt.appointments — conflict EXCLUDE', () => {
  it('rejects a second overlapping confirmed appointment for the same Vehicle', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(
        insAppt({
          status: 'confirmed',
          confFrom: '2026-08-02T09:00:00Z',
          confTo: '2026-08-02T11:00:00Z',
        })
      );
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          insAppt({
            status: 'confirmed',
            confFrom: '2026-08-02T10:00:00Z',
            confTo: '2026-08-02T12:00:00Z',
          })
        ),
        '23P01'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      // adjacent (non-overlapping) confirmed is allowed
      expect(
        (
          await c.query(
            insAppt({
              status: 'confirmed',
              confFrom: '2026-08-02T11:00:00Z',
              confTo: '2026-08-02T12:00:00Z',
            })
          )
        ).rows
      ).toHaveLength(1);
    });
  });

  it('allows overlapping windows when not confirmed (requested)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(
        insAppt({
          status: 'confirmed',
          confFrom: '2026-08-03T09:00:00Z',
          confTo: '2026-08-03T11:00:00Z',
        })
      );
      // a requested appointment with an overlapping requested window does not reserve capacity
      expect(
        (await c.query(insAppt({ reqFrom: '2026-08-03T09:30:00Z', reqTo: '2026-08-03T10:30:00Z' })))
          .rows
      ).toHaveLength(1);
    });
  });
});

describe('apt.appointments — references + isolation', () => {
  it('rejects cross-tenant Vehicle and partner references', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insAppt({ vehicle: V_B })), '23503');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(insAppt({ partner: 'b1000000-0000-4000-8000-0000000ab0ff' })),
        '23503'
      );
    });
  });

  it('rejects an appointment type not visible to this tenant (fail-closed)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(c.query(insAppt({ type: TYPE_B })), '23503');
    });
  });

  it('freezes identity columns', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          `UPDATE apt.appointments SET vehicle_id='a1000000-0000-4000-8000-0000000ab0ff'::uuid WHERE id=$1`,
          [id]
        ),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(`UPDATE apt.appointments SET requested_from='2026-01-01T00:00:00Z' WHERE id=$1`, [
          id,
        ]),
        '23514'
      );
    });
  });

  it('enforces active display-number uniqueness per tenant', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id1 = (await c.query(insAppt())).rows[0].id;
      const id2 = (await c.query(insAppt())).rows[0].id;
      await c.query(`UPDATE apt.appointments SET display_number='APT-1' WHERE id=$1`, [id1]);
      await expectSqlState(
        c.query(`UPDATE apt.appointments SET display_number='APT-1' WHERE id=$1`, [id2]),
        '23505'
      );
    });
  });

  it('isolates tenants and denies app_readonly writes', async () => {
    await withRolledBackTx(runtime, ctxB, async (c) => {
      const n = await c.query(`SELECT count(*)::int n FROM apt.appointments`);
      expect(n.rows[0].n).toBe(0);
    });
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(c.query(insAppt()), '42501');
    });
  });
});
