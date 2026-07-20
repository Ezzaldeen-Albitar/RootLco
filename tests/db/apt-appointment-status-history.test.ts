/**
 * Phase 1-8 append-only Appointment status history (P1-08-DB-003).
 *
 * Proves the emit trigger writes exactly one row per real lifecycle change and
 * nothing on a no-op, deterministic seq ordering, GUC-captured reason/correlation,
 * coherence rejection of forged transitions, append-only (no UPDATE/DELETE), and
 * RLS isolation.
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

const V_A = 'a1000000-0000-4000-8000-0000000ad001';
const P_A = 'a1000000-0000-4000-8000-0000000ad0c1';
const TYPE = 'a1000000-0000-4000-8000-0000000ad0d1';
const CHAN = 'a1000000-0000-4000-8000-0000000ad0d2';
const REASON = 'a1000000-0000-4000-8000-0000000ad0d3';
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_A };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

const insAppt = (status = 'requested', conf = false) =>
  `INSERT INTO apt.appointments
     (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, appointment_type_id,
      source_channel_id, requested_from, requested_to, confirmed_from, confirmed_to, lifecycle_status, created_by)
   VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${V_A}','${P_A}','${TYPE}','${CHAN}',
      '2026-10-01T09:00:00Z','2026-10-01T10:00:00Z',
      ${conf ? "'2026-10-01T09:00:00Z'" : 'NULL'},${conf ? "'2026-10-01T10:00:00Z'" : 'NULL'},
      '${status}','${USER_A}')
   RETURNING id`;

const confirm = (id: string) =>
  `UPDATE apt.appointments SET lifecycle_status='confirmed',
     confirmed_from='2026-10-01T09:00:00Z', confirmed_to='2026-10-01T10:00:00Z' WHERE id='${id}'`;

const history = (id: string) =>
  `SELECT from_state, to_state, reason, correlation_id, actor_id, seq
     FROM apt.appointment_status_history WHERE appointment_id='${id}' ORDER BY seq`;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
     VALUES ($1,$2,'APTHISTVIN1','ice','active',$3)`,
    [V_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1,$2,'individual','Hist Requester',$3)`,
    [P_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.appointment_types (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_hist_type','General',$2)`,
    [TYPE, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.source_channels (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_hist_chan','Phone',$2)`,
    [CHAN, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.cancellation_reasons (id, scope, tenant_id, code, name, created_by)
       VALUES ($1,'platform',NULL,'fx_hist_reason','Customer request',$2)`,
    [REASON, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

describe('apt.appointment_status_history — emission', () => {
  it('emits exactly one row per real transition, ordered by seq', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      await c.query(confirm(id));
      await c.query(
        `UPDATE apt.appointments SET lifecycle_status='no_show', no_show_recorded_at=now(), no_show_recorded_by='${USER_A}' WHERE id='${id}'`
      );
      const rows = (await c.query(history(id))).rows;
      expect(rows.map((r) => [r.from_state, r.to_state])).toEqual([
        ['requested', 'confirmed'],
        ['confirmed', 'no_show'],
      ]);
      expect(Number(rows[1].seq)).toBeGreaterThan(Number(rows[0].seq));
      expect(rows[0].actor_id).toBe(USER_A); // server-stamped
    });
  });

  it('writes no history row for a no-op update (status unchanged)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      await c.query(`UPDATE apt.appointments SET display_number='APT-NOOP' WHERE id='${id}'`);
      const n = await c.query(
        `SELECT count(*)::int n FROM apt.appointment_status_history WHERE appointment_id='${id}'`
      );
      expect(n.rows[0].n).toBe(0);
    });
  });

  it('captures reason and correlation from transaction GUCs', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      await c.query(`SELECT set_config('app.status_reason','slot freed',true)`);
      await c.query(
        `SELECT set_config('app.correlation_id','11111111-1111-4111-8111-111111111111',true)`
      );
      await c.query(confirm(id));
      const row = (await c.query(history(id))).rows[0];
      expect(row.reason).toBe('slot freed');
      expect(row.correlation_id).toBe('11111111-1111-4111-8111-111111111111');
    });
  });
});

describe('apt.appointment_status_history — integrity', () => {
  it('rejects a forged direct insert whose to_state does not match the live master', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id; // master is 'requested'
      await expectSqlState(
        c.query(
          `INSERT INTO apt.appointment_status_history
             (tenant_id, company_id, branch_id, appointment_id, from_state, to_state)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','${id}','requested','cancelled')`
        ),
        '23514'
      );
    });
  });

  it('rejects a forged history row for an appointment in another scope', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO apt.appointment_status_history
             (tenant_id, company_id, branch_id, appointment_id, from_state, to_state)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','a1000000-0000-4000-8000-0000000ad0ee','requested','confirmed')`
        ),
        '23503'
      );
    });
  });

  it('denies UPDATE and DELETE on the append-only ledger', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insAppt())).rows[0].id;
      await c.query(confirm(id));
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(
          `UPDATE apt.appointment_status_history SET to_state='cancelled' WHERE appointment_id='${id}'`
        ),
        '42501'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(
        c.query(`DELETE FROM apt.appointment_status_history WHERE appointment_id='${id}'`),
        '42501'
      );
    });
  });

  it('isolates tenants and denies app_readonly direct inserts', async () => {
    await withRolledBackTx(runtime, ctxB, async (c) => {
      const n = await c.query(`SELECT count(*)::int n FROM apt.appointment_status_history`);
      expect(n.rows[0].n).toBe(0);
    });
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(
        c.query(
          `INSERT INTO apt.appointment_status_history
             (tenant_id, company_id, branch_id, appointment_id, from_state, to_state)
           VALUES ('${TENANT_A}','${COMPANY_A1}','${BRANCH_A1}','a1000000-0000-4000-8000-0000000ad0ee','requested','confirmed')`
        ),
        '42501'
      );
    });
  });
});
