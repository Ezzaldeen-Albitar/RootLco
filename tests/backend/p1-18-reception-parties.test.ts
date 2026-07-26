/**
 * Reception party roles and authorization verification, end to end (Phase 1-18,
 * P1-18-BE-009, P1-18-BE-010).
 *
 * These two operations are the reception module's authority chain: who a party is
 * to the vehicle, and whether that party may approve work on it. Both are frozen
 * Phase 1-8 contracts and the suite is written to hold the *properties*, not the
 * shapes:
 *
 *  - `rec.reception_party_roles` has immutable identity columns
 *    (`tg_reception_party_roles_immutable`), so a role change is a supersession —
 *    close the open interval, append a replacement. The supersession test reads
 *    the original row back column by column and proves nothing but `valid_to`
 *    moved.
 *  - `rec.guard_authorization_authority` is the sole authority on whether a
 *    partner may decide. It requires an *active* role in the narrower authorizing
 *    set, which is why `vehicle_user` is refused (driving is not authority) and
 *    why an authorization is refused again the moment the role's interval closes.
 *  - The refusal must not tell a guessing caller which roles the partner holds or
 *    which would have qualified; that is an enumeration of another party's
 *    relationships to the vehicle. The response body is asserted field by field.
 *  - `rec.authorizations` is INSERT + SELECT only, proven against the deployed
 *    `app_runtime` identity rather than asserted from a migration comment.
 *
 * Operations exercised here: rec.reception-party-role, rec.reception-authorization.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   rec.reception-party-role: route service authorization success denial cross-tenant isolation audit idempotency
 *   rec.reception-authorization: route service authorization success denial cross-tenant isolation audit idempotency
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  SUBJECT_UNPERMITTED,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { RECEPTION_PARTY_ROLES } from '@/modules/reception';
import { POST as ASSIGN_ROLE } from '@/app/api/v1/receptions/[receptionId]/party-roles/route';
import { POST as AUTHORIZE } from '@/app/api/v1/receptions/[receptionId]/authorizations/route';

/** Tenant-A principal holding both reception permissions, unrestricted. */
const ROLE_RECEPTION = 'c1180000-0000-4000-8000-0000000000a1';
const USER_RECEPTION = 'c1180000-0000-4000-8000-0000000000a2';
const SUBJ_RECEPTION = 'fx_p1_18_parties_a';
/** Tenant-A principal holding the same permissions, narrowed to BRANCH_A2. */
const ROLE_NARROWED = 'c1180000-0000-4000-8000-0000000000b1';
const USER_NARROWED = 'c1180000-0000-4000-8000-0000000000b2';
const SUBJ_NARROWED = 'fx_p1_18_parties_narrowed';
const GRANT_NARROWED = 'c1180000-0000-4000-8000-0000000000b3';

// Two single-permission principals. Without them the two operations in this file
// share a fixture that grants BOTH codes, so swapping the authorizations route's
// high-risk `rec.reception.authorization.verify` for the medium-risk
// `rec.reception.party.manage` -- letting a front-desk clerk record a customer's
// approval decision -- would leave the whole suite green.
const ROLE_PARTY_ONLY = 'c1180000-0000-4000-8000-0000000000b4';
const USER_PARTY_ONLY = 'c1180000-0000-4000-8000-0000000000b5';
const SUBJ_PARTY_ONLY = 'fx_p1_18_parties_party_only';
const ROLE_AUTHZ_ONLY = 'c1180000-0000-4000-8000-0000000000b6';
const USER_AUTHZ_ONLY = 'c1180000-0000-4000-8000-0000000000b7';
const SUBJ_AUTHZ_ONLY = 'fx_p1_18_parties_authz_only';

/** A second branch in the same company, and a whole org for tenant B. */
const BRANCH_A2 = 'c1180000-0000-4000-8000-0000000000c1';
const COMPANY_B1 = 'c1180000-0000-4000-8000-0000000000c2';
const BRANCH_B1 = 'c1180000-0000-4000-8000-0000000000c3';

/** The partner every fixture visit is checked in for; holds `service_requester`. */
const PARTNER_REQUESTER = 'c1180000-0000-4000-8000-0000000000d1';
/** Assigned `vehicle_owner` by the tests that need authority. */
const PARTNER_OWNER = 'c1180000-0000-4000-8000-0000000000d2';
/** Assigned `vehicle_user` — present on the visit but with no authority. */
const PARTNER_DRIVER = 'c1180000-0000-4000-8000-0000000000d3';
/** Holds no role on any visit at all. */
const PARTNER_STRANGER = 'c1180000-0000-4000-8000-0000000000d4';
/** Tenant B's requester, for the real cross-tenant visit. */
const PARTNER_B = 'c1180000-0000-4000-8000-0000000000d5';

const R = 'http://localhost/api/v1/receptions';

interface Body {
  readonly receptionVisitId?: string;
  readonly partyRoleId?: string;
  readonly relationshipRole?: string;
  readonly superseded?: boolean;
  readonly authorizationId?: string;
  readonly decision?: string;
  readonly code?: string;
  readonly violations?: readonly { readonly path: string; readonly rule: string }[];
}

/** Every column of a party-role row that a supersession must leave alone. */
interface PartyRoleRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly company_id: string;
  readonly branch_id: string;
  readonly reception_visit_id: string;
  readonly partner_id: string;
  readonly relationship_role: string;
  readonly valid_from: Date;
  readonly valid_to: Date | null;
  readonly assignment_source: string | null;
  readonly created_at: Date;
  readonly created_by: string;
}

let admin: Pool;
let runtime: Pool;

/** Visits reused by the guard suites; each test that mutates state makes its own. */
let visitForGuards = '';

function authAs(providerSubject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId,
    })
  );
}

function assignRole(
  receptionId: string,
  body: unknown,
  key = crypto.randomUUID()
): Promise<Response> {
  return ASSIGN_ROLE(
    new Request(`${R}/${receptionId}/party-roles`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ receptionId }) }
  );
}

function authorize(
  receptionId: string,
  body: unknown,
  key = crypto.randomUUID()
): Promise<Response> {
  return AUTHORIZE(
    new Request(`${R}/${receptionId}/authorizations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ receptionId }) }
  );
}

async function countWhere(sql: string, values: readonly unknown[]): Promise<number> {
  const result = await admin.query<{ n: string }>(sql, [...values]);
  return Number(result.rows[0]?.n ?? '0');
}

const roleCount = (visitId: string, partnerId: string, role: string): Promise<number> =>
  countWhere(
    `SELECT count(*)::text AS n FROM rec.reception_party_roles
      WHERE reception_visit_id = $1 AND partner_id = $2 AND relationship_role = $3`,
    [visitId, partnerId, role]
  );

const openRoleCount = (visitId: string, partnerId: string, role: string): Promise<number> =>
  countWhere(
    `SELECT count(*)::text AS n FROM rec.reception_party_roles
      WHERE reception_visit_id = $1 AND partner_id = $2 AND relationship_role = $3
        AND valid_to IS NULL AND deleted_at IS NULL`,
    [visitId, partnerId, role]
  );

const authorizationCount = (visitId: string): Promise<number> =>
  countWhere(`SELECT count(*)::text AS n FROM rec.authorizations WHERE reception_visit_id = $1`, [
    visitId,
  ]);

const auditCount = (action: string, entityId: string): Promise<number> =>
  countWhere(
    `SELECT count(*)::text AS n FROM iam.audit_records WHERE action = $1 AND entity_id = $2`,
    [action, entityId]
  );

async function readPartyRole(id: string): Promise<PartyRoleRow | undefined> {
  const result = await admin.query<PartyRoleRow>(
    `SELECT id, tenant_id, company_id, branch_id, reception_visit_id, partner_id,
            relationship_role, valid_from, valid_to, assignment_source, created_at, created_by
       FROM rec.reception_party_roles WHERE id = $1`,
    [id]
  );
  return result.rows[0];
}

/**
 * Creates a real, open reception visit through the frozen `rec.accept_check_in()`
 * primitive, as admin. Fixture provisioning only — nothing here is evidence about
 * runtime behaviour, and the visit it leaves behind is exactly the one the routes
 * under test will address.
 */
async function seedVisit(
  options: {
    readonly tenantId?: string;
    readonly companyId?: string;
    readonly branchId?: string;
    readonly requesterPartnerId?: string;
  } = {}
): Promise<string> {
  const tenantId = options.tenantId ?? TENANT_A;
  const companyId = options.companyId ?? COMPANY_A1;
  const branchId = options.branchId ?? BRANCH_A1;
  const requester = options.requesterPartnerId ?? PARTNER_REQUESTER;

  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    // Every rec/veh trigger stamps its actor from `app.user_id`, and
    // `rec.accept_check_in()` reads both GUCs directly, so the whole fixture runs
    // in one context-set transaction.
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
      [USER_A, tenantId]
    );
    // A visit needs its own vehicle: `uq_reception_visits_open_vehicle` allows one
    // open visit per vehicle per tenant.
    const vehicle = await client.query<{ id: string }>(
      `INSERT INTO veh.vehicles (tenant_id, powertrain_category, created_by)
       VALUES ($1, 'ice', $2) RETURNING id`,
      [tenantId, USER_A]
    );
    const vehicleId = vehicle.rows[0]?.id ?? '';
    const walkIn = await client.query<{ id: string }>(
      `INSERT INTO rec.walk_in_references
         (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [tenantId, companyId, branchId, vehicleId, requester, USER_A]
    );
    const visit = await client.query<{ id: string }>(
      `SELECT rec.accept_check_in($1::uuid, $2::uuid, $3::uuid, NULL::uuid, $4::uuid,
                                  $5::uuid, $6::uuid) AS id`,
      [companyId, branchId, vehicleId, walkIn.rows[0]?.id, USER_A, requester]
    );
    await client.query('COMMIT');
    return visit.rows[0]?.id ?? '';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedRolePermissions(
  tenantId: string,
  roleId: string,
  code: string,
  permissionCodes: readonly string[] = [
    'rec.reception.party.manage',
    'rec.reception.authorization.verify',
  ]
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, $3, 'P1-18 reception parties', $4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, code, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A, permissionCodes]
  );
}

async function seedAccount(
  tenantId: string,
  userId: string,
  subject: string,
  label: string
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $4 || '@example.test', $5, 'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, label, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('rec.reception.party.manage', 'rec',
             'Assign and close dated party roles on a reception', 'medium', $1),
            ('rec.reception.authorization.verify', 'rec',
             'Verify and record reception authorization decisions', 'high', $1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  // A second branch inside the same company, so a narrowed grant is refused by
  // branch and not by company, and a whole tenant-B org for the cross-tenant visit.
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1, $2, $3, 'branch_a2', 'Fixture Branch A2', 'UTC', $4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, $2, 'company_b1', 'Fixture Company B1', 'USD', $3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B1, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1, $2, $3, 'branch_b1', 'Fixture Branch B1', 'UTC', $4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B1, TENANT_B, COMPANY_B1, USER_A]
  );

  await seedAccount(TENANT_A, USER_RECEPTION, SUBJ_RECEPTION, 'Reception Desk');
  await seedAccount(TENANT_A, USER_NARROWED, SUBJ_NARROWED, 'Reception Desk Branch A2');
  await seedRolePermissions(TENANT_A, ROLE_RECEPTION, SUBJ_RECEPTION);
  await seedRolePermissions(TENANT_A, ROLE_NARROWED, SUBJ_NARROWED);
  await seedAccount(TENANT_A, USER_PARTY_ONLY, SUBJ_PARTY_ONLY, 'Party Roles Only');
  await seedAccount(TENANT_A, USER_AUTHZ_ONLY, SUBJ_AUTHZ_ONLY, 'Authorization Verify Only');
  await seedRolePermissions(TENANT_A, ROLE_PARTY_ONLY, SUBJ_PARTY_ONLY, [
    'rec.reception.party.manage',
  ]);
  await seedRolePermissions(TENANT_A, ROLE_AUTHZ_ONLY, SUBJ_AUTHZ_ONLY, [
    'rec.reception.authorization.verify',
  ]);
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', $4, $4),
            ($1, $5, $6, 'unrestricted', $4, $4),
            ($1, $7, $8, 'unrestricted', $4, $4)`,
    [
      TENANT_A,
      USER_RECEPTION,
      ROLE_RECEPTION,
      USER_A,
      USER_PARTY_ONLY,
      ROLE_PARTY_ONLY,
      USER_AUTHZ_ONLY,
      ROLE_AUTHZ_ONLY,
    ]
  );

  // The scoped grant and its scopes must land together: the "a scoped grant needs
  // a scope" trigger is DEFERRABLE INITIALLY DEFERRED.
  const scoped = await admin.connect();
  try {
    await scoped.query('BEGIN');
    await scoped.query(
      `INSERT INTO iam.role_grants
         (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1, $2, $3, $4, 'scoped', $5, $5)`,
      [GRANT_NARROWED, TENANT_A, USER_NARROWED, ROLE_NARROWED, USER_A]
    );
    await scoped.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
       VALUES ($1, $2, 'company', $3, $4)`,
      [TENANT_A, GRANT_NARROWED, COMPANY_A1, USER_A]
    );
    await scoped.query(
      `INSERT INTO iam.grant_scopes
         (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1, $2, 'branch', $3, $4, $5)`,
      [TENANT_A, GRANT_NARROWED, COMPANY_A1, BRANCH_A2, USER_A]
    );
    await scoped.query('COMMIT');
  } catch (error) {
    await scoped.query('ROLLBACK');
    throw error;
  } finally {
    scoped.release();
  }

  const partners = await admin.connect();
  try {
    await partners.query('BEGIN');
    await partners.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
      [USER_A, TENANT_A]
    );
    await partners.query(
      `INSERT INTO crm.business_partners
         (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1, $5, 'individual', 'Reception Requester', 'active', $6),
              ($2, $5, 'individual', 'Reception Owner',     'active', $6),
              ($3, $5, 'individual', 'Reception Driver',    'active', $6),
              ($4, $5, 'individual', 'Reception Stranger',  'active', $6)
       ON CONFLICT (id) DO NOTHING`,
      [PARTNER_REQUESTER, PARTNER_OWNER, PARTNER_DRIVER, PARTNER_STRANGER, TENANT_A, USER_A]
    );
    await partners.query('COMMIT');
  } catch (error) {
    await partners.query('ROLLBACK');
    throw error;
  } finally {
    partners.release();
  }

  const partnersB = await admin.connect();
  try {
    await partnersB.query('BEGIN');
    await partnersB.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
      [USER_A, TENANT_B]
    );
    await partnersB.query(
      `INSERT INTO crm.business_partners
         (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1, $2, 'individual', 'Tenant B Requester', 'active', $3)
       ON CONFLICT (id) DO NOTHING`,
      [PARTNER_B, TENANT_B, USER_A]
    );
    await partnersB.query('COMMIT');
  } catch (error) {
    await partnersB.query('ROLLBACK');
    throw error;
  } finally {
    partnersB.release();
  }

  visitForGuards = await seedVisit();

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => __resetAuthenticatorForTests());

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('authentication and authorization', () => {
  it('answers 401 on both routes with no authenticator installed', async () => {
    __resetAuthenticatorForTests();
    expect(
      (
        await assignRole(visitForGuards, {
          partnerId: PARTNER_OWNER,
          relationshipRole: 'vehicle_owner',
        })
      ).status
    ).toBe(401);
    expect(
      (
        await authorize(visitForGuards, {
          authorizingRole: 'service_requester',
          partnerId: PARTNER_REQUESTER,
          decision: 'approved',
        })
      ).status
    ).toBe(401);
  });

  it('answers 403 for an authenticated caller with neither reception permission', async () => {
    authAs(SUBJECT_UNPERMITTED);
    const role = await assignRole(visitForGuards, {
      partnerId: PARTNER_OWNER,
      relationshipRole: 'vehicle_owner',
    });
    expect(role.status).toBe(403);
    expect(((await role.json()) as Body).code).toBe('ERR-IAM-001');

    const decision = await authorize(visitForGuards, {
      authorizingRole: 'service_requester',
      partnerId: PARTNER_REQUESTER,
      decision: 'approved',
    });
    expect(decision.status).toBe(403);
    expect(((await decision.json()) as Body).code).toBe('ERR-IAM-001');

    // A denial performs no work: the check-in's own service-requester role is
    // still the only role on the visit, and no decision was recorded.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM rec.reception_party_roles WHERE reception_visit_id = $1`,
        [visitForGuards]
      )
    ).toBe(1);
    expect(await authorizationCount(visitForGuards)).toBe(0);
  });

  /**
   * The split between the two operations, pinned in both directions.
   *
   * These two routes carry DIFFERENT permissions on purpose:
   * `rec.reception.party.manage` is medium risk (who is attached to a visit),
   * `rec.reception.authorization.verify` is high risk (whose instruction the
   * workshop may act on). Every other P1-18 suite pins its split; this one did
   * not, because both fixture roles held both codes. A regression that gave the
   * authorizations route the medium-risk code would then have gone unnoticed.
   */
  it('refuses /authorizations to a caller holding only rec.reception.party.manage', async () => {
    authAs(SUBJ_PARTY_ONLY);
    const before = await authorizationCount(visitForGuards);

    const decision = await authorize(visitForGuards, {
      authorizingRole: 'service_requester',
      partnerId: PARTNER_REQUESTER,
      decision: 'approved',
    });
    expect(decision.status).toBe(403);
    expect(((await decision.json()) as Body).code).toBe('ERR-IAM-001');
    expect(await authorizationCount(visitForGuards)).toBe(before);

    // The control: the same principal CAN do the thing its own permission names,
    // so the refusal above is about the permission and not about the fixture.
    const role = await assignRole(visitForGuards, {
      partnerId: PARTNER_OWNER,
      relationshipRole: 'vehicle_owner',
    });
    expect(role.status).toBe(201);
  });

  it('refuses /party-roles to a caller holding only rec.reception.authorization.verify', async () => {
    authAs(SUBJ_AUTHZ_ONLY);
    const before = await countWhere(
      `SELECT count(*)::text AS n FROM rec.reception_party_roles WHERE reception_visit_id = $1`,
      [visitForGuards]
    );

    const role = await assignRole(visitForGuards, {
      partnerId: PARTNER_DRIVER,
      relationshipRole: 'vehicle_user',
    });
    expect(role.status).toBe(403);
    expect(((await role.json()) as Body).code).toBe('ERR-IAM-001');
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM rec.reception_party_roles WHERE reception_visit_id = $1`,
        [visitForGuards]
      )
    ).toBe(before);

    // The control: this principal CAN record a decision, which is what its own
    // permission names.
    const decision = await authorize(visitForGuards, {
      authorizingRole: 'service_requester',
      partnerId: PARTNER_REQUESTER,
      decision: 'approved',
    });
    expect(decision.status).toBe(201);
  });
});

describe('rec.reception-party-role: assignment', () => {
  it('assigns one dated role, replays a repeated key, and audits it once', async () => {
    authAs(SUBJ_RECEPTION);
    const visit = await seedVisit();
    const key = crypto.randomUUID();
    const response = await assignRole(
      visit,
      {
        partnerId: PARTNER_OWNER,
        relationshipRole: 'vehicle_owner',
        assignmentSource: 'front desk',
      },
      key
    );
    expect(response.status).toBe(201);
    const first = (await response.json()) as Body;
    expect(first.partyRoleId).toBeTruthy();
    expect(first.relationshipRole).toBe('vehicle_owner');
    expect(first.superseded).toBe(false);

    const row = await readPartyRole(first.partyRoleId ?? '');
    expect(row?.valid_to).toBeNull();
    expect(row?.partner_id).toBe(PARTNER_OWNER);
    expect(row?.relationship_role).toBe('vehicle_owner');
    expect(row?.reception_visit_id).toBe(visit);
    expect(row?.assignment_source).toBe('front desk');
    // Scope comes from the visit, never from the request body.
    expect(row?.company_id).toBe(COMPANY_A1);
    expect(row?.branch_id).toBe(BRANCH_A1);

    // A same-key retry replays the stored response; the load-bearing proof is that
    // there is still exactly one row.
    const replay = await assignRole(
      visit,
      {
        partnerId: PARTNER_OWNER,
        relationshipRole: 'vehicle_owner',
        assignmentSource: 'front desk',
      },
      key
    );
    expect(replay.ok).toBe(true);
    expect(((await replay.json()) as Body).partyRoleId).toBe(first.partyRoleId);
    expect(await roleCount(visit, PARTNER_OWNER, 'vehicle_owner')).toBe(1);

    expect(await auditCount('rec.reception.party_role_assigned', first.partyRoleId ?? '')).toBe(1);
  });

  it('supersedes rather than edits: the original row only ever gains a valid_to', async () => {
    authAs(SUBJ_RECEPTION);
    const visit = await seedVisit();
    const original = (await (
      await assignRole(visit, {
        partnerId: PARTNER_OWNER,
        relationshipRole: 'vehicle_owner',
        assignmentSource: 'front desk',
      })
    ).json()) as Body;
    const before = await readPartyRole(original.partyRoleId ?? '');
    expect(before).toBeDefined();
    expect(before?.valid_to).toBeNull();

    const response = await assignRole(visit, {
      partnerId: PARTNER_OWNER,
      relationshipRole: 'vehicle_owner',
      assignmentSource: 'portal',
      supersede: true,
    });
    expect(response.status).toBe(201);
    const replacement = (await response.json()) as Body;
    expect(replacement.superseded).toBe(true);
    expect(replacement.partyRoleId).not.toBe(original.partyRoleId);

    // The identity columns are immutable by trigger, so a role change cannot be an
    // edit. Every one of them is compared, not a representative sample: this is the
    // assertion that fails if `tg_reception_party_roles_immutable` is ever relaxed
    // and the service starts re-dating history in place.
    const after = await readPartyRole(original.partyRoleId ?? '');
    expect(after?.valid_to).not.toBeNull();
    expect(after?.id).toBe(before?.id);
    expect(after?.tenant_id).toBe(before?.tenant_id);
    expect(after?.company_id).toBe(before?.company_id);
    expect(after?.branch_id).toBe(before?.branch_id);
    expect(after?.reception_visit_id).toBe(before?.reception_visit_id);
    expect(after?.partner_id).toBe(before?.partner_id);
    expect(after?.relationship_role).toBe(before?.relationship_role);
    expect(after?.valid_from.getTime()).toBe(before?.valid_from.getTime());
    expect(after?.assignment_source).toBe(before?.assignment_source);
    expect(after?.created_at.getTime()).toBe(before?.created_at.getTime());
    expect(after?.created_by).toBe(before?.created_by);
    // The closed interval is a real interval, not a zero-width one.
    expect((after?.valid_to as Date).getTime()).toBeGreaterThan(
      (before?.valid_from as Date).getTime()
    );

    // Two rows in the history, exactly one of them open, and the open one carries
    // the new provenance.
    expect(await roleCount(visit, PARTNER_OWNER, 'vehicle_owner')).toBe(2);
    expect(await openRoleCount(visit, PARTNER_OWNER, 'vehicle_owner')).toBe(1);
    const current = await readPartyRole(replacement.partyRoleId ?? '');
    expect(current?.valid_to).toBeNull();
    expect(current?.assignment_source).toBe('portal');
  });

  it('refuses a second open assignment of the same partner in the same role', async () => {
    authAs(SUBJ_RECEPTION);
    const visit = await seedVisit();
    expect(
      (await assignRole(visit, { partnerId: PARTNER_DRIVER, relationshipRole: 'payer' })).status
    ).toBe(201);

    // A different key, so this is a genuine second command rather than a replay.
    const duplicate = await assignRole(visit, {
      partnerId: PARTNER_DRIVER,
      relationshipRole: 'payer',
    });
    expect(duplicate.status).toBe(409);
    expect(((await duplicate.json()) as Body).code).toBe('ERR-RES-002');
    expect(await roleCount(visit, PARTNER_DRIVER, 'payer')).toBe(1);
  });

  it('refuses a relationship role outside the frozen seven-value vocabulary', async () => {
    authAs(SUBJ_RECEPTION);
    const visit = await seedVisit();
    const response = await assignRole(visit, {
      partnerId: PARTNER_OWNER,
      relationshipRole: 'chief_mechanic',
    });
    expect(response.status).toBe(422);
    const body = (await response.json()) as Body;
    expect(body.code).toBe('ERR-VAL-001');
    expect((body.violations ?? []).map((violation) => violation.path)).toContain(
      'body.relationshipRole'
    );
    expect(await roleCount(visit, PARTNER_OWNER, 'chief_mechanic')).toBe(0);
  });
});

describe('rec.reception-authorization: verification', () => {
  it('records an approval for a partner holding an active service_requester role', async () => {
    authAs(SUBJ_RECEPTION);
    const visit = await seedVisit();
    const key = crypto.randomUUID();
    const payload = {
      authorizingRole: 'service_requester',
      partnerId: PARTNER_REQUESTER,
      decision: 'approved',
      channel: 'phone',
      authorizedScope: { services: ['brake_inspection'] },
    };
    const response = await authorize(visit, payload, key);
    expect(response.status).toBe(201);
    const first = (await response.json()) as Body;
    expect(first.authorizationId).toBeTruthy();
    expect(first.decision).toBe('approved');

    const row = await admin.query<{
      partner_id: string;
      authorizing_role: string;
      decision: string;
      channel: string;
      company_id: string;
      branch_id: string;
    }>(
      `SELECT partner_id, authorizing_role, decision, channel, company_id, branch_id
         FROM rec.authorizations WHERE id = $1`,
      [first.authorizationId]
    );
    expect(row.rows[0]?.partner_id).toBe(PARTNER_REQUESTER);
    expect(row.rows[0]?.authorizing_role).toBe('service_requester');
    expect(row.rows[0]?.decision).toBe('approved');
    expect(row.rows[0]?.channel).toBe('phone');
    expect(row.rows[0]?.company_id).toBe(COMPANY_A1);
    expect(row.rows[0]?.branch_id).toBe(BRANCH_A1);

    const replay = await authorize(visit, payload, key);
    expect(replay.ok).toBe(true);
    expect(((await replay.json()) as Body).authorizationId).toBe(first.authorizationId);
    expect(await authorizationCount(visit)).toBe(1);

    expect(
      await auditCount('rec.reception.authorization_recorded', first.authorizationId ?? '')
    ).toBe(1);
  });

  it('refuses a partner with no role on the visit without naming a single role', async () => {
    authAs(SUBJ_RECEPTION);
    const visit = await seedVisit();
    const refused = await authorize(visit, {
      authorizingRole: 'approving_party',
      partnerId: PARTNER_STRANGER,
      decision: 'approved',
    });
    expect(refused.status).toBe(409);

    // The whole response document is inspected, not one field of it. A caller who
    // is guessing must not learn which roles this partner holds, which roles would
    // have qualified, or that the partner is known to the visit at all — that is an
    // enumeration of another party's relationship to the vehicle. Pinning the exact
    // field set is what makes this hold: a `detail` or `violations` field added
    // later would carry the database's own "partner X holds no active authorizing
    // role on visit Y" message straight to the caller, and this assertion fails.
    const raw = await refused.text();
    for (const role of RECEPTION_PARTY_ROLES) {
      expect(raw).not.toContain(role);
    }
    expect(raw).not.toContain(PARTNER_STRANGER);
    expect(raw).not.toContain(visit);
    const body = JSON.parse(raw) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['code', 'correlationId', 'status', 'title', 'type']);
    expect(body['code']).toBe('ERR-TRN-001');

    expect(await authorizationCount(visit)).toBe(0);
  });

  it('refuses a partner holding only vehicle_user — driving is not authority', async () => {
    authAs(SUBJ_RECEPTION);
    const visit = await seedVisit();
    expect(
      (await assignRole(visit, { partnerId: PARTNER_DRIVER, relationshipRole: 'vehicle_user' }))
        .status
    ).toBe(201);
    expect(await openRoleCount(visit, PARTNER_DRIVER, 'vehicle_user')).toBe(1);

    // `vehicle_user` is deliberately absent from `ck_authorizations_role`, so the
    // driver has to claim a role it does not hold; `rec.guard_authorization_authority`
    // is what refuses it, and the refusal is the same 409 a stranger receives.
    const refused = await authorize(visit, {
      authorizingRole: 'vehicle_owner',
      partnerId: PARTNER_DRIVER,
      decision: 'approved',
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Body).code).toBe('ERR-TRN-001');
    expect(await authorizationCount(visit)).toBe(0);
  });

  it('refuses a new authorization once the authorizing role has been closed', async () => {
    authAs(SUBJ_RECEPTION);
    const visit = await seedVisit();
    expect(
      (await assignRole(visit, { partnerId: PARTNER_OWNER, relationshipRole: 'vehicle_owner' }))
        .status
    ).toBe(201);

    // While the interval is open the same request succeeds, so the only thing that
    // changes below is `valid_to`.
    const allowed = await authorize(visit, {
      authorizingRole: 'vehicle_owner',
      partnerId: PARTNER_OWNER,
      decision: 'approved',
    });
    expect(allowed.status).toBe(201);

    // Closing the interval is fixture work — the route only ever closes-and-reopens
    // — but the state it produces is exactly the one a superseded role leaves behind.
    const closer = await admin.connect();
    try {
      await closer.query('BEGIN');
      await closer.query(
        `SELECT set_config('app.user_id', $1, true), set_config('app.tenant_id', $2, true)`,
        [USER_A, TENANT_A]
      );
      const closed = await closer.query(
        `UPDATE rec.reception_party_roles SET valid_to = now()
          WHERE reception_visit_id = $1 AND partner_id = $2
            AND relationship_role = 'vehicle_owner' AND valid_to IS NULL`,
        [visit, PARTNER_OWNER]
      );
      expect(closed.rowCount).toBe(1);
      await closer.query('COMMIT');
    } catch (error) {
      await closer.query('ROLLBACK');
      throw error;
    } finally {
      closer.release();
    }
    expect(await openRoleCount(visit, PARTNER_OWNER, 'vehicle_owner')).toBe(0);

    const refused = await authorize(visit, {
      authorizingRole: 'vehicle_owner',
      partnerId: PARTNER_OWNER,
      decision: 'approved',
    });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as Body).code).toBe('ERR-TRN-001');
    // Authority is time-effective, not historical: the one decision on the visit is
    // the one taken while the role was open.
    expect(await authorizationCount(visit)).toBe(1);
  });

  it('cannot rewrite a recorded authorization even as the deployed runtime role', async () => {
    // `rec.authorizations` is granted SELECT + INSERT and nothing else, so a
    // decision is superseded by a later row and can never be edited. Proven on the
    // identity the application actually deploys with, not on the admin connection.
    const client = await runtime.connect();
    try {
      await expectSqlState(
        client.query(`UPDATE rec.authorizations SET decision = 'approved'`),
        '42501'
      );
      await expectSqlState(client.query(`DELETE FROM rec.authorizations`), '42501');
    } finally {
      client.release();
    }
  });
});

describe('rec.reception-authorization: the claimed role must be held', () => {
  /**
   * `rec.guard_authorization_authority` proves the partner MAY decide; it never
   * compares the claimed `authorizing_role` with a role they hold. The column is
   * immutable on an append-only row, so an unchecked label is a permanent
   * misstatement in the record a dispute would be settled from.
   *
   * `PARTNER_REQUESTER` holds `service_requester` — the role the check-in
   * primitive creates — and no other. Claiming `vehicle_owner` must be refused
   * even though the party is genuinely entitled to authorize.
   */
  it('refuses a role the party does not hold, even when it may authorize', async () => {
    authAs(SUBJ_RECEPTION);
    const before = await authorizationCount(visitForGuards);

    const response = await authorize(visitForGuards, {
      authorizingRole: 'vehicle_owner',
      partnerId: PARTNER_REQUESTER,
      decision: 'approved',
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as Body).code).toBe('ERR-TRN-001');
    expect(await authorizationCount(visitForGuards)).toBe(before);

    // The control: the role this party actually holds is accepted, so the
    // refusal is about the label and not about the party.
    const held = await authorize(visitForGuards, {
      authorizingRole: 'service_requester',
      partnerId: PARTNER_REQUESTER,
      decision: 'approved',
    });
    expect(held.status).toBe(201);
    expect(await authorizationCount(visitForGuards)).toBe(before + 1);
  });
});

describe('tenant and branch isolation', () => {
  it('refuses both operations against a real tenant-B reception, writing nothing', async () => {
    // A real visit, in tenant B, addressed by its real id — not a random UUID,
    // which would prove only that unknown ids are refused.
    const foreign = await seedVisit({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      requesterPartnerId: PARTNER_B,
    });
    expect(foreign).toBeTruthy();
    const rolesBefore = await countWhere(
      `SELECT count(*)::text AS n FROM rec.reception_party_roles WHERE reception_visit_id = $1`,
      [foreign]
    );
    // The check-in primitive wrote the mandatory service-requester role, so the
    // baseline is one, and any leak would push it to two.
    expect(rolesBefore).toBe(1);

    authAs(SUBJ_RECEPTION);
    const role = await assignRole(foreign, {
      partnerId: PARTNER_OWNER,
      relationshipRole: 'vehicle_owner',
    });
    expect(role.status).toBe(404);
    expect(((await role.json()) as Body).code).toBe('ERR-RES-001');

    const decision = await authorize(foreign, {
      authorizingRole: 'service_requester',
      partnerId: PARTNER_B,
      decision: 'approved',
    });
    expect(decision.status).toBe(404);
    expect(((await decision.json()) as Body).code).toBe('ERR-RES-001');

    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM rec.reception_party_roles WHERE reception_visit_id = $1`,
        [foreign]
      )
    ).toBe(1);
    expect(await authorizationCount(foreign)).toBe(0);
    // And nothing tenant-A-shaped landed in tenant B either.
    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM rec.reception_party_roles
          WHERE reception_visit_id = $1 AND partner_id = $2`,
        [foreign, PARTNER_OWNER]
      )
    ).toBe(0);
  });

  it('refuses both operations for a principal granted only another branch', async () => {
    const inBranchA1 = await seedVisit({ branchId: BRANCH_A1 });
    const inBranchA2 = await seedVisit({ branchId: BRANCH_A2 });

    authAs(SUBJ_NARROWED);
    // The narrowed principal holds both permissions, so authorization passes and
    // the only thing that can refuse this is the branch predicate on the visit.
    const role = await assignRole(inBranchA1, {
      partnerId: PARTNER_OWNER,
      relationshipRole: 'vehicle_owner',
    });
    expect(role.status).toBe(404);
    expect(((await role.json()) as Body).code).toBe('ERR-RES-001');

    const decision = await authorize(inBranchA1, {
      authorizingRole: 'service_requester',
      partnerId: PARTNER_REQUESTER,
      decision: 'approved',
    });
    expect(decision.status).toBe(404);
    expect(((await decision.json()) as Body).code).toBe('ERR-RES-001');

    expect(
      await countWhere(
        `SELECT count(*)::text AS n FROM rec.reception_party_roles WHERE reception_visit_id = $1`,
        [inBranchA1]
      )
    ).toBe(1);
    expect(await authorizationCount(inBranchA1)).toBe(0);

    // The control that makes the two refusals above mean something: the same
    // principal, the same payloads, inside the branch it was actually granted.
    expect(
      (
        await assignRole(inBranchA2, {
          partnerId: PARTNER_OWNER,
          relationshipRole: 'vehicle_owner',
        })
      ).status
    ).toBe(201);
    expect(
      (
        await authorize(inBranchA2, {
          authorizingRole: 'service_requester',
          partnerId: PARTNER_REQUESTER,
          decision: 'approved',
        })
      ).status
    ).toBe(201);
    expect(await authorizationCount(inBranchA2)).toBe(1);
  });
});
