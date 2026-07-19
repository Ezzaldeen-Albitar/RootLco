/**
 * Phase 1-9 shared test fixtures.
 *
 * A work order originates from an AUTHORIZED Phase 1-8 reception visit. Building
 * one requires the full reception chain (walk-in -> accept_check_in -> approving
 * role -> approved authorization -> authorized), plus a Vehicle, partners, and a
 * technician profile (which needs an iam.user_accounts identity row). These
 * helpers assemble that chain so the P1-9 suites can focus on their invariants.
 *
 * The platform Work Order / Job state graph is SEEDED (real codes: draft, open,
 * in_progress, ...), so tests use those codes directly.
 */
import type { Client, Pool } from 'pg';
import { TENANT_A, TENANT_B, COMPANY_A1, BRANCH_A1, USER_A } from './helpers';

type Q = { query: Client['query'] };

/** Deterministic Phase 1-9 fixture UUIDs (d9 family). */
export const P9 = {
  V_A: 'd9a00000-0000-4000-8000-0000000000f1', // Vehicle (tenant A)
  V_A2: 'd9a00000-0000-4000-8000-0000000000f2', // second Vehicle (tenant A)
  V_B: 'd9b00000-0000-4000-8000-0000000000f1', // Vehicle (tenant B)
  SR: 'd9a00000-0000-4000-8000-0000000000a1', // service-requester partner (A)
  AP: 'd9a00000-0000-4000-8000-0000000000a2', // approving partner (A)
  TECH_USER: 'd9a00000-0000-4000-8000-0000000000c1', // technician identity (A)
  TECH_PROFILE: 'd9a00000-0000-4000-8000-0000000000c2', // technician profile (A)
  TECH_USER2: 'd9a00000-0000-4000-8000-0000000000c3',
  TECH_PROFILE2: 'd9a00000-0000-4000-8000-0000000000c4',
};

export const ctxA = { tenantId: TENANT_A, userId: USER_A };

/** Provisions the committed base fixtures every P1-9 suite reuses (admin). */
export async function seedP109Base(admin: Pool): Promise<void> {
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
     VALUES ($1,$2,'WO09VIN0000000001','ice','active',$4),
            ($3,$5,'WO09VIN0000000002','ice','active',$4),
            ($6,$2,'WO09VIN0000000003','ice','active',$4)
     ON CONFLICT (id) DO NOTHING`,
    [P9.V_A, TENANT_A, P9.V_B, USER_A, TENANT_B, P9.V_A2]
  );
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1,$3,'individual','WO Service Requester',$4),($2,$3,'individual','WO Approver',$4)
     ON CONFLICT (id) DO NOTHING`,
    [P9.SR, P9.AP, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$3,'fixture','wo-tech-1','wo-tech-1@fixture.test','WO Technician 1','active',$4),
            ($2,$3,'fixture','wo-tech-2','wo-tech-2@fixture.test','WO Technician 2','active',$4)
     ON CONFLICT (id) DO NOTHING`,
    [P9.TECH_USER, P9.TECH_USER2, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO tech.technician_profiles (id, tenant_id, company_id, branch_id, user_id, trade, created_by)
     VALUES ($1,$3,$4,$5,$6,'mechanical',$7),($2,$3,$4,$5,$8,'electrical',$7)
     ON CONFLICT (id) DO NOTHING`,
    [
      P9.TECH_PROFILE,
      P9.TECH_PROFILE2,
      TENANT_A,
      COMPANY_A1,
      BRANCH_A1,
      P9.TECH_USER,
      USER_A,
      P9.TECH_USER2,
    ]
  );
}

/**
 * Builds an AUTHORIZED reception visit in the caller's transaction (context must
 * already be tenant A). Returns the visit id. Vehicle defaults to V_A.
 */
export async function makeAuthorizedVisit(c: Q, vehicle: string = P9.V_A): Promise<string> {
  const wi = (
    await c.query(
      `INSERT INTO rec.walk_in_references (tenant_id, company_id, branch_id, vehicle_id, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [TENANT_A, COMPANY_A1, BRANCH_A1, vehicle, USER_A]
    )
  ).rows[0].id;
  const visit = (
    await c.query(`SELECT rec.accept_check_in($1,$2,$3,NULL,$4,$5,$6,NULL,NULL,NULL,NULL) AS id`, [
      COMPANY_A1,
      BRANCH_A1,
      vehicle,
      wi,
      USER_A,
      P9.SR,
    ])
  ).rows[0].id;
  await c.query(
    `INSERT INTO rec.reception_party_roles
       (tenant_id, company_id, branch_id, reception_visit_id, partner_id, relationship_role, created_by)
     VALUES ($1,$2,$3,$4,$5,'approving_party',$6)`,
    [TENANT_A, COMPANY_A1, BRANCH_A1, visit, P9.AP, USER_A]
  );
  await c.query(`UPDATE rec.reception_visits SET reception_status='inspecting' WHERE id=$1`, [
    visit,
  ]);
  await c.query(
    `INSERT INTO rec.authorizations
       (tenant_id, company_id, branch_id, reception_visit_id, authorizing_role, partner_id, decision, channel, created_by)
     VALUES ($1,$2,$3,$4,'approving_party',$5,'approved','in_person',$6)`,
    [TENANT_A, COMPANY_A1, BRANCH_A1, visit, P9.AP, USER_A]
  );
  await c.query(`UPDATE rec.reception_visits SET reception_status='authorized' WHERE id=$1`, [
    visit,
  ]);
  return visit;
}

/** Inserts a draft work order for an authorized visit; returns its id. */
export async function newWorkOrder(
  c: Q,
  visit: string,
  opts: { kind?: string; vehicle?: string } = {}
): Promise<string> {
  const { rows } = await c.query(
    `INSERT INTO wo.work_orders
       (tenant_id, company_id, branch_id, reception_visit_id, vehicle_id, kind, state, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,'draft',$7) RETURNING id`,
    [
      TENANT_A,
      COMPANY_A1,
      BRANCH_A1,
      visit,
      opts.vehicle ?? P9.V_A,
      opts.kind ?? 'ordinary',
      USER_A,
    ]
  );
  return rows[0].id;
}

/** Transitions a work order to a new state (reason optional via app.status_reason). */
export async function moveWO(c: Q, id: string, state: string, reason?: string): Promise<void> {
  if (reason !== undefined) {
    await c.query(`SELECT set_config('app.status_reason',$1,true)`, [reason]);
  }
  await c.query(`UPDATE wo.work_orders SET state=$2 WHERE id=$1`, [id, state]);
  if (reason !== undefined) {
    await c.query(`SELECT set_config('app.status_reason','',true)`);
  }
}
