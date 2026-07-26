/**
 * Shared Phase 1-19 backend fixture (Wave 4).
 *
 * ## Work orders here are created by the REAL conversion route
 *
 * `wo.work_orders` is never inserted by this file. P1-19's whole boundary claim is
 * that reception's conversion (P1-18-BE-019) is the only creation path, and a test
 * helper that inserted the row itself would prove the P1-19 surface works against a
 * shell no shipped code produces — the exact gap that makes an integration claim
 * hollow. So `createWorkOrder()` seeds a reception visit through the frozen
 * `rec.accept_check_in()` primitive (upstream of this phase, and admin-built so a
 * regression in check-in cannot be mistaken for one here) and then drives
 * `POST /receptions/{id}/convert-to-work-order` exactly as a client would.
 *
 * ## Arrangement uses the real routes wherever a route exists
 *
 * Moving a work order out of `draft` uses the transition route, not an admin
 * UPDATE, because an admin UPDATE would have to satisfy
 * `wo.guard_work_order_transition` anyway and would additionally have to set
 * `app.status_reason` by hand — reproducing in the fixture the very mechanism the
 * suite is meant to prove the service performs. Where no route exists yet (job
 * states are Wave 5), arrangement is admin SQL and is labelled as such.
 *
 * Because arrangement writes real audit and outbox rows, every "exactly one"
 * assertion in the suites counts rows for a SPECIFIC aggregate and action rather
 * than tenant-wide. A tenant-wide delta would be measuring the fixture.
 *
 * `createWorkOrder()` leaves the session authenticator set to the privileged
 * fixture subject; every test sets its own principal with `authAs` immediately
 * before the request it is asserting on.
 */
import type { Pool } from 'pg';
import { BRANCH_A1, COMPANY_A1, IDENTITY_PROVIDER, TENANT_A, TENANT_B, USER_A } from './helpers';
import { StaticClaimsAuthenticator, setSessionAuthenticator } from '@/server/context/principal';
import { POST as CONVERT } from '@/app/api/v1/receptions/[receptionId]/convert-to-work-order/route';
import { POST as TRANSITION } from '@/app/api/v1/work-orders/[workOrderId]/transition/route';

/** Platform actor the seeded permission catalog attributes its rows to. */
export const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';

/** A second tenant-A branch, so "granted elsewhere" names a real branch. */
export const BRANCH_A2 = 'a1100000-0000-4000-8000-0000000000a2';
/** Tenant B org scaffolding: the shared fixtures build tenant A's only. */
export const COMPANY_B1 = 'b1000000-0000-4000-8000-000000000001';
export const BRANCH_B1 = 'b1100000-0000-4000-8000-000000000001';

export const PARTNER_A = 'c1900000-0000-4000-8000-0000000000d1';
export const PARTNER_B = 'c1900000-0000-4000-8000-0000000000d2';

/** Technician profiles: one per fixture branch, plus tenant B's. */
export const TECH_A1 = 'c1900000-0000-4000-8000-00000000020a';
export const TECH_A1_ALT = 'c1900000-0000-4000-8000-00000000020b';
export const TECH_A1_INACTIVE = 'c1900000-0000-4000-8000-00000000020c';
export const TECH_A2 = 'c1900000-0000-4000-8000-00000000020d';
export const TECH_B1 = 'c1900000-0000-4000-8000-00000000020e';

/** Tenant-scoped catalog codes. No `tech.` rows are seeded by the repository. */
export const SKILL_BRAKES = 'fx_p1_19_brakes';
export const SKILL_HYBRID = 'fx_p1_19_hybrid';
export const LEVEL_JUNIOR = 'fx_p1_19_junior';
export const LEVEL_SENIOR = 'fx_p1_19_senior';
export const CERT_HV = 'fx_p1_19_high_voltage';

/** Ranks the fixture skill levels carry, so a test can state a minimum. */
export const RANK_JUNIOR = 10;
export const RANK_SENIOR = 20;

const CONVERT_PERMISSION = 'rec.reception.convert';
const READ = 'wo.work_order.read';
const TRANSITION_PERMISSION = 'wo.work_order.transition';
const CLOSE = 'wo.work_order.close';
const JOB_MANAGE = 'wo.job.manage';
const JOB_TRANSITION = 'wo.job.transition';
const ASSIGNMENT_MANAGE = 'tech.assignment.manage';
const TECHNICIAN_READ = 'tech.technician.read';
const LABOR_RECORD = 'tech.labor.record';
const LABOR_CORRECT = 'tech.labor.correct';

/** One fixture principal: its ids, its subject, and what it may do. */
export interface Principal {
  readonly roleId: string;
  readonly userId: string;
  readonly subject: string;
  readonly tenantId: string;
  readonly permissions: readonly string[];
  /** When set, the grant is `scoped` to this company/branch pair. */
  readonly scope?: { readonly companyId: string; readonly branchId: string };
  readonly grantId?: string;
}

/** Tenant A, unrestricted, every Wave 4 permission including closure. */
export const FULL: Principal = {
  roleId: 'c1900000-0000-4000-8000-0000000000a1',
  userId: 'c1900000-0000-4000-8000-0000000000a2',
  subject: 'fx_p1_19_full',
  tenantId: TENANT_A,
  permissions: [
    CONVERT_PERMISSION,
    READ,
    TRANSITION_PERMISSION,
    CLOSE,
    JOB_MANAGE,
    JOB_TRANSITION,
    ASSIGNMENT_MANAGE,
    TECHNICIAN_READ,
    LABOR_RECORD,
    LABOR_CORRECT,
  ],
};

/**
 * Tenant A, unrestricted, everything EXCEPT `wo.work_order.close`.
 *
 * This principal is the whole point of splitting closure from transition: it can
 * park an order awaiting parts and cannot end the workshop's liability for the
 * vehicle. Without it the second permission would be documentary.
 */
export const NO_CLOSE: Principal = {
  roleId: 'c1900000-0000-4000-8000-0000000000b1',
  userId: 'c1900000-0000-4000-8000-0000000000b2',
  subject: 'fx_p1_19_no_close',
  tenantId: TENANT_A,
  permissions: [
    READ,
    TRANSITION_PERMISSION,
    JOB_MANAGE,
    JOB_TRANSITION,
    ASSIGNMENT_MANAGE,
    TECHNICIAN_READ,
    LABOR_RECORD,
    LABOR_CORRECT,
  ],
};

/** Tenant A, unrestricted, read only — the 403 probe for every command. */
export const READER: Principal = {
  roleId: 'c1900000-0000-4000-8000-0000000000c1',
  userId: 'c1900000-0000-4000-8000-0000000000c2',
  subject: 'fx_p1_19_reader',
  tenantId: TENANT_A,
  permissions: [READ],
};

/**
 * Tenant A, holding every Wave 4 permission but granted ONLY in `BRANCH_A2`.
 *
 * The isolation probe. RLS alone cannot refuse this principal anything in
 * `BRANCH_A1`, because `app.branch_ids` is the permission-blind union of its
 * grants — only a scoped permission evaluation against the resource's own branch
 * can (P1-18-A-01).
 */
export const SCOPED_ELSEWHERE: Principal = {
  roleId: 'c1900000-0000-4000-8000-0000000000e1',
  userId: 'c1900000-0000-4000-8000-0000000000e2',
  subject: 'fx_p1_19_scoped',
  tenantId: TENANT_A,
  permissions: [
    READ,
    TRANSITION_PERMISSION,
    CLOSE,
    JOB_MANAGE,
    JOB_TRANSITION,
    ASSIGNMENT_MANAGE,
    TECHNICIAN_READ,
    LABOR_RECORD,
    LABOR_CORRECT,
  ],
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
  grantId: 'c1900000-0000-4000-8000-0000000000e3',
};

/**
 * Tenant A, holding the Wave 4 permissions in `BRANCH_A2` — and ALSO holding an
 * unrelated permission in `BRANCH_A1`.
 *
 * This is the P1-18-A-01 principal, and the second grant is the whole point.
 * `iam.allowed_branch_ids()` is the union of every active grant regardless of the
 * permission it carries, so RLS makes `BRANCH_A1` rows VISIBLE to this caller —
 * it cannot answer 404. The only thing that can refuse a write in `BRANCH_A1` is
 * a scoped permission evaluation against the row's own branch, because
 * `iam.has_permission_in_scope` matches a `branch` scope row on `branch_id` alone
 * and the granting grant names `BRANCH_A2`.
 *
 * `SCOPED_ELSEWHERE` above holds no grant in `BRANCH_A1` at all, so RLS hides the
 * row from it and it gets a uniform 404. Both probes matter: the 404 is
 * defence in depth, the 403 is the control being tested.
 */
export const PERMISSION_ELSEWHERE: Principal = {
  roleId: 'c1900000-0000-4000-8000-00000000010a',
  userId: 'c1900000-0000-4000-8000-00000000010b',
  subject: 'fx_p1_19_permission_elsewhere',
  tenantId: TENANT_A,
  permissions: [
    READ,
    TRANSITION_PERMISSION,
    CLOSE,
    JOB_MANAGE,
    JOB_TRANSITION,
    ASSIGNMENT_MANAGE,
    TECHNICIAN_READ,
    LABOR_RECORD,
    LABOR_CORRECT,
  ],
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
  grantId: 'c1900000-0000-4000-8000-00000000010c',
};
/** The second role/grant that widens `PERMISSION_ELSEWHERE`'s RLS reach into A1. */
const WIDENING_ROLE = 'c1900000-0000-4000-8000-00000000010d';
const WIDENING_GRANT = 'c1900000-0000-4000-8000-00000000010e';
/** Deliberately NOT a work-order permission: it widens reach, never authority. */
const WIDENING_PERMISSION = 'org.tenant.read';

/** Tenant B, unrestricted IN ITS OWN TENANT — the cross-tenant probe. */
export const TENANT_B_FULL: Principal = {
  roleId: 'c1900000-0000-4000-8000-0000000000f1',
  userId: 'c1900000-0000-4000-8000-0000000000f2',
  subject: 'fx_p1_19_tenant_b',
  tenantId: TENANT_B,
  permissions: [
    CONVERT_PERMISSION,
    READ,
    TRANSITION_PERMISSION,
    CLOSE,
    JOB_MANAGE,
    JOB_TRANSITION,
    ASSIGNMENT_MANAGE,
    TECHNICIAN_READ,
    LABOR_RECORD,
    LABOR_CORRECT,
  ],
};

export const PRINCIPALS: readonly Principal[] = [
  FULL,
  NO_CLOSE,
  READER,
  SCOPED_ELSEWHERE,
  PERMISSION_ELSEWHERE,
  TENANT_B_FULL,
];

let admin: Pool;
/** Monotonic, so every fixture vehicle carries a distinct 17-character VIN. */
let vinSeq = 0;

export function authAs(principal: Principal): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: principal.subject,
      tenantId: principal.tenantId,
    })
  );
}

/** Authenticates as a raw subject/tenant pair, for the unpermitted-role probe. */
export function authAsSubject(subject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId,
    })
  );
}

export async function count(sql: string, values: readonly unknown[] = []): Promise<number> {
  const result = await admin.query<{ n: string }>(sql, [...values]);
  return Number(result.rows[0]?.n ?? '0');
}

/** Audit records for ONE action against ONE entity. Never a tenant-wide delta. */
export function auditCount(action: string, entityId: string): Promise<number> {
  return count(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );
}

/** Outbox rows for ONE event type against ONE aggregate. */
export function outboxCount(eventType: string, aggregateId: string): Promise<number> {
  return count(
    `SELECT count(*)::text AS n FROM shared.event_outbox
      WHERE event_type = $1 AND aggregate_id = $2`,
    [eventType, aggregateId]
  );
}

/** Ledger rows for one work order. */
export function historyCount(workOrderId: string): Promise<number> {
  return count(
    `SELECT count(*)::text AS n FROM wo.work_order_status_history WHERE work_order_id = $1`,
    [workOrderId]
  );
}

/** The live work-order row, read as admin — never RLS evidence. */
export async function readWorkOrder(
  workOrderId: string
): Promise<{ state: string; version: number } | null> {
  const result = await admin.query<{ state: string; record_version: number }>(
    `SELECT state, record_version FROM wo.work_orders WHERE id = $1`,
    [workOrderId]
  );
  const row = result.rows[0];
  return row ? { state: row.state, version: row.record_version } : null;
}

export async function readJob(
  jobId: string
): Promise<{ state: string; title: string; jobType: string | null; version: number } | null> {
  const result = await admin.query<{
    state: string;
    title: string;
    job_type: string | null;
    record_version: number;
  }>(`SELECT state, title, job_type, record_version FROM wo.jobs WHERE id = $1`, [jobId]);
  const row = result.rows[0];
  return row
    ? { state: row.state, title: row.title, jobType: row.job_type, version: row.record_version }
    : null;
}

/**
 * Blocks until `expected` backends are waiting on a lock in this database.
 *
 * A race between two in-flight requests cannot be asserted until both have
 * actually reached the contended row; waiting for that is what makes the outcome
 * deterministic rather than a coin toss decided by the event loop.
 */
export async function waitForBlockedBackends(expected: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let seen = 0;
  while (Date.now() < deadline) {
    const result = await admin.query<{ n: string }>(
      `SELECT count(DISTINCT a.pid)::text AS n
         FROM pg_stat_activity a
         JOIN pg_locks l ON l.pid = a.pid
        WHERE NOT l.granted
          AND a.datname = current_database()
          AND a.pid <> pg_backend_pid()`
    );
    seen = Number(result.rows[0]?.n ?? '0');
    if (seen >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `expected ${expected} backends blocked on a lock within ${timeoutMs}ms, saw ${seen}; ` +
      'the race was not forced, so the outcome would prove nothing'
  );
}

async function seedPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-19 Principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-19 fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [principal.roleId, principal.tenantId, principal.subject, USER_A]
  );
  for (const code of principal.permissions) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
        WHERE p.permission_code = $4
       ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
      [principal.tenantId, principal.roleId, USER_A, code]
    );
  }

  if (principal.scope === undefined) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    return;
  }
  // A scoped active grant must carry at least one scope, and that is a DEFERRABLE
  // constraint trigger — so the grant and its scope land in one transaction.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [principal.grantId, principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [
        principal.tenantId,
        principal.grantId,
        principal.scope.companyId,
        principal.scope.branchId,
        USER_A,
      ]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Builds every Phase 1-19 fixture the suites share.
 *
 * Call after `ensureBackendFixtures`. The permission codes are the seeded
 * catalog's own, inserted `ON CONFLICT DO NOTHING`, so a database carrying the
 * seed sees no drift and one that does not still resolves what the routes declare.
 */
export async function establishP1_19Fixtures(pool: Pool): Promise<void> {
  admin = pool;

  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ($1,'rec','Convert an approved reception into a work order','high',$2)
     ON CONFLICT (permission_code) DO NOTHING`,
    [CONVERT_PERMISSION, SYSTEM_ACTOR]
  );

  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'company_b1','Fixture Company B1','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B1, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches
       (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_b1','Fixture Branch B1','UTC',$4),
            ($5,$6,$7,'branch_a2','Fixture Branch A2','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B1, TENANT_B, COMPANY_B1, USER_A, BRANCH_A2, TENANT_A, COMPANY_A1]
  );

  for (const principal of PRINCIPALS) await seedPrincipal(principal);

  // The widening grant: a SECOND role for PERMISSION_ELSEWHERE, carrying an
  // unrelated permission and scoped to BRANCH_A1. It puts A1 into that user's
  // `iam.allowed_branch_ids()` union without giving it any work-order authority
  // there, which is the only way to test that a scoped permission check — and not
  // RLS — is what refuses the write.
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_19_widening','P1-19 widening',$3) ON CONFLICT (id) DO NOTHING`,
    [WIDENING_ROLE, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = $4
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, WIDENING_ROLE, USER_A, WIDENING_PERMISSION]
  );
  const widening = await admin.connect();
  try {
    await widening.query('BEGIN');
    await widening.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [WIDENING_GRANT, TENANT_A, PERMISSION_ELSEWHERE.userId, WIDENING_ROLE, USER_A]
    );
    await widening.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [TENANT_A, WIDENING_GRANT, COMPANY_A1, BRANCH_A1, USER_A]
    );
    await widening.query('COMMIT');
  } catch (error) {
    await widening.query('ROLLBACK');
    throw error;
  } finally {
    widening.release();
  }

  // Business partners the receptions name as service requester. Every rec/crm
  // trigger stamps its actor from `app.user_id`, so each insert runs in a
  // context-set transaction.
  for (const [tenantId, partnerId] of [
    [TENANT_A, PARTNER_A],
    [TENANT_B, PARTNER_B],
  ] as const) {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, tenantId]
      );
      await client.query(
        `INSERT INTO crm.business_partners
           (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
         VALUES ($1,$2,'organization','Reception Requester','active',$3)
         ON CONFLICT (id) DO NOTHING`,
        [partnerId, tenantId, USER_A]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  // Work-order numbering. Provisioning a sequence is an operator action —
  // `app_runtime` holds no INSERT on `shared.number_sequences` — and conversion
  // allocates from it, so both tenants need one.
  for (const tenantId of [TENANT_A, TENANT_B]) {
    await admin.query(
      `INSERT INTO shared.number_sequences
         (tenant_id, sequence_code, prefix_template, next_value, pad_width, period_reset_rule, created_by)
       VALUES ($1,'work_order','WO-',1,6,'never',$2)`,
      [tenantId, USER_A]
    );
  }
}

/**
 * Builds the `tech` fixtures Wave 5 assignment needs.
 *
 * Admin SQL, and necessarily so: the technician catalogs, profiles, held skills,
 * held certifications and availability intervals have no write route in this phase —
 * they are operator/HR data, and P1-19 only READS them to decide eligibility. What
 * matters is that the rows are the real shape the eligibility engine queries, not
 * that a route created them.
 *
 * Every catalog row is TENANT-scoped: the repository seeds no `tech.` rows at all,
 * so a platform-scoped fixture would be inventing platform reference data.
 *
 * The availability windows are deliberately a SPLIT SHIFT — two touching half-open
 * intervals — because `ex_technician_availability_overlap` excludes on
 * `tstzrange(from, to)` with `&&` and `[08:00,12:00)` does not overlap
 * `[12:00,17:00)`. A technician available for every minute of 09:00–13:00 has no
 * single row spanning it, which is exactly what `coveredByUnion` exists to handle.
 */
export async function establishTechnicianFixtures(): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );

    for (const [code, name] of [
      [SKILL_BRAKES, 'Brake systems'],
      [SKILL_HYBRID, 'Hybrid and EV'],
    ] as const) {
      await client.query(
        `INSERT INTO tech.skills (scope, tenant_id, code, name, status, created_by)
         VALUES ('tenant',$1,$2,$3,'active',$4)`,
        [TENANT_A, code, name, USER_A]
      );
    }
    for (const [code, name, rank] of [
      [LEVEL_JUNIOR, 'Junior', RANK_JUNIOR],
      [LEVEL_SENIOR, 'Senior', RANK_SENIOR],
    ] as const) {
      await client.query(
        `INSERT INTO tech.skill_levels (scope, tenant_id, code, name, rank, status, created_by)
         VALUES ('tenant',$1,$2,$3,$4,'active',$5)`,
        [TENANT_A, code, name, rank, USER_A]
      );
    }
    await client.query(
      `INSERT INTO tech.certifications
         (scope, tenant_id, code, name, is_safety_critical, status, created_by)
       VALUES ('tenant',$1,$2,'High-voltage systems',true,'active',$3)`,
      [TENANT_A, CERT_HV, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  // Tenant A: a senior brake technician in A1, an alternate in A1 for reassignment,
  // an INACTIVE profile in A1, and one in A2 so branch scope has a real other side.
  await seedTechnician({
    id: TECH_A1,
    branchId: BRANCH_A1,
    skills: [{ code: SKILL_BRAKES, level: LEVEL_SENIOR }],
    certifications: [CERT_HV],
  });
  await seedTechnician({
    id: TECH_A1_ALT,
    branchId: BRANCH_A1,
    skills: [{ code: SKILL_BRAKES, level: LEVEL_JUNIOR }],
  });
  await seedTechnician({ id: TECH_A1_INACTIVE, branchId: BRANCH_A1, isActive: false });
  await seedTechnician({
    id: TECH_A2,
    branchId: BRANCH_A2,
    skills: [{ code: SKILL_BRAKES, level: LEVEL_SENIOR }],
  });
  await seedTechnician({
    id: TECH_B1,
    tenantId: TENANT_B,
    companyId: COMPANY_B1,
    branchId: BRANCH_B1,
  });
}

/** The split-shift window every fixture technician is available for. */
export const AVAILABLE_FROM = '2026-07-26T08:00:00.000Z';
export const AVAILABLE_MID = '2026-07-26T12:00:00.000Z';
export const AVAILABLE_TO = '2026-07-26T17:00:00.000Z';
/** A window inside the split shift that no SINGLE availability row spans. */
export const SPLIT_WINDOW = Object.freeze({
  from: '2026-07-26T09:00:00.000Z',
  to: '2026-07-26T13:00:00.000Z',
});

async function seedTechnician(input: {
  readonly id: string;
  readonly branchId: string;
  readonly tenantId?: string;
  readonly companyId?: string;
  readonly isActive?: boolean;
  readonly skills?: readonly { readonly code: string; readonly level: string }[];
  readonly certifications?: readonly string[];
}): Promise<void> {
  const tenantId = input.tenantId ?? TENANT_A;
  const companyId = input.companyId ?? COMPANY_A1;
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, tenantId]
    );
    // `fk_technician_profiles_user` anchors the profile to an identity in the SAME
    // tenant, and `uq_technician_profiles_active_user` allows one live profile per
    // user — so each fixture technician needs its own account rather than sharing
    // the harness user.
    const account = await client.query<{ id: string }>(
      `INSERT INTO iam.user_accounts
         (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1,$2,$3,$3||'@example.test','Fixture Technician','active',$4)
       RETURNING id`,
      [tenantId, IDENTITY_PROVIDER, `fx_p1_19_tech_${input.id.slice(-4)}`, USER_A]
    );
    const technicianUserId = account.rows[0]?.id ?? '';
    await client.query(
      `INSERT INTO tech.technician_profiles
         (id, tenant_id, company_id, branch_id, user_id, trade, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,'mechanic',$6,$7)`,
      [
        input.id,
        tenantId,
        companyId,
        input.branchId,
        technicianUserId,
        input.isActive ?? true,
        USER_A,
      ]
    );
    for (const skill of input.skills ?? []) {
      await client.query(
        `INSERT INTO tech.technician_skills
           (tenant_id, company_id, branch_id, technician_profile_id, skill_id, skill_level_id, created_by)
         SELECT $1,$2,$3,$4,s.id,l.id,$5
           FROM tech.skills s, tech.skill_levels l
          WHERE s.code = $6 AND l.code = $7`,
        [tenantId, companyId, input.branchId, input.id, USER_A, skill.code, skill.level]
      );
    }
    for (const code of input.certifications ?? []) {
      await client.query(
        `INSERT INTO tech.technician_certifications
           (tenant_id, company_id, branch_id, technician_profile_id, certification_id,
            issued_on, expires_on, cert_status, created_by)
         SELECT $1,$2,$3,$4,c.id,'2026-01-01','2027-01-01','active',$5
           FROM tech.certifications c WHERE c.code = $6`,
        [tenantId, companyId, input.branchId, input.id, USER_A, code]
      );
    }
    // The split shift: two touching half-open intervals, neither of which spans
    // SPLIT_WINDOW alone.
    for (const [from, to] of [
      [AVAILABLE_FROM, AVAILABLE_MID],
      [AVAILABLE_MID, AVAILABLE_TO],
    ] as const) {
      await client.query(
        `INSERT INTO tech.technician_availability
           (tenant_id, company_id, branch_id, technician_profile_id, available_from,
            available_to, availability_kind, created_by)
         VALUES ($1,$2,$3,$4,$5::timestamptz,$6::timestamptz,'available',$7)`,
        [tenantId, companyId, input.branchId, input.id, from, to, USER_A]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface SeededVisit {
  readonly visitId: string;
  readonly vehicleId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly recordVersion: number;
}

/**
 * An `authorized` reception visit, built as admin in one transaction.
 *
 * The frozen `rec.accept_check_in()` primitive performs the check-in — visit, the
 * mandatory service-requester role, the accepted custody event and the first
 * status-history row — because hand-rolling those four would produce a fixture
 * that satisfies `wo.guard_work_order_refs` without satisfying the reception
 * contract, and that guard is exactly what must not be faked past.
 */
export async function seedAuthorizedVisit(
  input: {
    readonly tenantId?: string;
    readonly companyId?: string;
    readonly branchId?: string;
    readonly partnerId?: string;
  } = {}
): Promise<SeededVisit> {
  const tenantId = input.tenantId ?? TENANT_A;
  const companyId = input.companyId ?? COMPANY_A1;
  const branchId = input.branchId ?? BRANCH_A1;
  const partnerId = input.partnerId ?? (tenantId === TENANT_B ? PARTNER_B : PARTNER_A);
  const vin = `1P19${String(++vinSeq).padStart(13, '0')}`;

  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, tenantId]
    );
    const vehicle = await client.query<{ id: string }>(
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$2,'ice','active',$3) RETURNING id`,
      [tenantId, vin, USER_A]
    );
    const vehicleId = vehicle.rows[0]?.id ?? '';

    const walkIn = await client.query<{ id: string }>(
      `INSERT INTO rec.walk_in_references
         (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tenantId, companyId, branchId, vehicleId, partnerId, USER_A]
    );

    const visit = await client.query<{ id: string }>(
      `SELECT rec.accept_check_in($1::uuid,$2::uuid,$3::uuid,NULL::uuid,$4::uuid,$5::uuid,$6::uuid) AS id`,
      [companyId, branchId, vehicleId, walkIn.rows[0]?.id ?? '', USER_A, partnerId]
    );
    const visitId = visit.rows[0]?.id ?? '';

    // The frozen activation contract: `authorized` needs an approved
    // authorization from a party already holding an authorizing role, and the
    // check-in primitive created exactly one — `service_requester`.
    await client.query(
      `INSERT INTO rec.authorizations
         (tenant_id, company_id, branch_id, reception_visit_id, authorizing_role,
          partner_id, decision, channel, created_by)
       VALUES ($1,$2,$3,$4,'service_requester',$5,'approved','in_person',$6)`,
      [tenantId, companyId, branchId, visitId, partnerId, USER_A]
    );
    await client.query(
      `UPDATE rec.reception_visits SET reception_status = 'inspecting' WHERE id = $1`,
      [visitId]
    );
    await client.query(
      `UPDATE rec.reception_visits SET reception_status = 'authorized' WHERE id = $1`,
      [visitId]
    );

    const current = await client.query<{ record_version: number }>(
      `SELECT record_version FROM rec.reception_visits WHERE id = $1`,
      [visitId]
    );
    await client.query('COMMIT');
    return {
      visitId,
      vehicleId,
      companyId,
      branchId,
      recordVersion: current.rows[0]?.record_version ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export interface SeededWorkOrder {
  readonly workOrderId: string;
  readonly visitId: string;
  readonly vehicleId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly state: string;
  readonly recordVersion: number;
}

/** Sends one transition request as the given principal. */
export function transitionRequest(
  workOrderId: string,
  body: unknown,
  options: { readonly version?: number | null; readonly key?: string } = {}
): Promise<Response> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotency-key': options.key ?? crypto.randomUUID(),
  };
  if (options.version !== null && options.version !== undefined) {
    headers['if-match'] = String(options.version);
  }
  return TRANSITION(
    new Request(`http://localhost/api/v1/work-orders/${workOrderId}/transition`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ workOrderId }) }
  );
}

/**
 * A work order in `draft`, created through the authoritative conversion route.
 *
 * `draft` is where the shipped shell lands: reception writes six columns and
 * leaves `state` to the frozen column default, deliberately, so this phase owns
 * what happens next. `draft` has `allows_jobs = false`, which is why a job fixture
 * must advance the order first.
 */
export async function createWorkOrder(
  input: {
    readonly tenantId?: string;
    readonly companyId?: string;
    readonly branchId?: string;
    readonly as?: Principal;
  } = {}
): Promise<SeededWorkOrder> {
  const visit = await seedAuthorizedVisit({
    ...(input.tenantId === undefined ? {} : { tenantId: input.tenantId }),
    ...(input.companyId === undefined ? {} : { companyId: input.companyId }),
    ...(input.branchId === undefined ? {} : { branchId: input.branchId }),
  });
  const principal = input.as ?? (input.tenantId === TENANT_B ? TENANT_B_FULL : FULL);
  authAs(principal);
  const response = await CONVERT(
    new Request(`http://localhost/api/v1/receptions/${visit.visitId}/convert-to-work-order`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': String(visit.recordVersion),
      },
      body: '{}',
    }),
    { params: Promise.resolve({ receptionId: visit.visitId }) }
  );
  if (response.status !== 200 && response.status !== 201) {
    throw new Error(
      `fixture conversion failed with ${response.status}: ${await response.text()}` +
        ' — the P1-18 creation path is the only one this phase may use'
    );
  }
  const body = (await response.json()) as { workOrderId?: string };
  const workOrderId = body.workOrderId ?? '';
  const row = await readWorkOrder(workOrderId);
  return {
    workOrderId,
    visitId: visit.visitId,
    vehicleId: visit.vehicleId,
    companyId: visit.companyId,
    branchId: visit.branchId,
    state: row?.state ?? '',
    recordVersion: row?.version ?? 0,
  };
}

/**
 * Advances a work order along the real graph, through the real route.
 *
 * Arrangement only. An admin UPDATE would have to satisfy the same guard AND set
 * `app.status_reason` by hand, which would reproduce in the fixture the mechanism
 * the suites exist to prove the service performs.
 */
export async function advance(
  workOrderId: string,
  path: readonly { readonly toState: string; readonly reason?: string }[],
  as: Principal = FULL
): Promise<number> {
  let version = (await readWorkOrder(workOrderId))?.version ?? 0;
  for (const step of path) {
    authAs(as);
    const response = await transitionRequest(
      workOrderId,
      step.reason === undefined ? { toState: step.toState } : step,
      { version }
    );
    if (response.status !== 200) {
      throw new Error(
        `fixture advance to ${step.toState} failed with ${response.status}: ${await response.text()}`
      );
    }
    version = ((await response.json()) as { recordVersion: number }).recordVersion;
  }
  return version;
}

/** A work order in `open` — the first state that accepts jobs. */
export async function createOpenWorkOrder(
  input: { readonly branchId?: string } = {}
): Promise<SeededWorkOrder> {
  const created = await createWorkOrder(input);
  const version = await advance(created.workOrderId, [{ toState: 'open' }]);
  return { ...created, state: 'open', recordVersion: version };
}
