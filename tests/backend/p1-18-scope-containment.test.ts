/**
 * Scoped-authorization containment for every id-addressed P1-18 command
 * (P1-18-A-01).
 *
 * ===========================================================================
 * WHAT THIS SUITE EXISTS TO PROVE, AND WHY THE EXISTING ONES COULD NOT
 * ===========================================================================
 * Ten P1-18 operations declare `scope: 'branch'` and are addressed by a
 * resource id, so at the moment the pre-handler authorization check runs there
 * is no company or branch to name. `requiresScopedEvaluation` returns false on
 * an empty target REGARDLESS of the declared scope, so the decision came from
 * `iam.has_permission`, which does not consult `iam.grant_scopes` at all. RLS
 * does not close the gap either: `resolve-context.ts` publishes `app.branch_ids`
 * as the union of every ACTIVE grant the caller holds, without regard to which
 * permission any of those grants carries.
 *
 * Put those two facts together and a caller who holds the operation's
 * permission in branch B1, plus any unrelated grant in branch B2, could act on
 * a B2 resource: RLS admitted the row because B2 is in the union, and the
 * permission check said yes because it never looked at scope.
 *
 * Every P1-18 suite that predates this one models a narrowed principal with a
 * SINGLE branch grant (`p1-18-reception-approval.test.ts:962`,
 * `p1-18-appointment-lifecycle.test.ts`), so RLS answers 404 before the
 * permission decision is ever observable. Those tests are correct — they simply
 * cannot see this. Proving the escalation needs a principal whose grants span
 * TWO branches with the permission in only one of them, which is what
 * `PRINCIPAL_UNION` below is.
 *
 * ===========================================================================
 * THE FIXTURE MODEL
 * ===========================================================================
 * Six principals, all in tenant A except the last:
 *
 *   PRINCIPAL_BRANCH_B1_PERMISSION   one scoped grant, branch B1, full P1-18
 *                                    permissions
 *   PRINCIPAL_BRANCH_B2_PERMISSION   one scoped grant, branch B2, full P1-18
 *                                    permissions
 *   PRINCIPAL_COMPANY_C_PERMISSION   grant 1: company-scoped to company C with
 *                                    the permissions; grant 2: company-scoped
 *                                    to a DIFFERENT company, carrying only
 *                                    unrelated authority
 *   PRINCIPAL_TENANT_WIDE_PERMISSION one unrestricted grant
 *   PRINCIPAL_UNION                  grant 1: branch B1 WITH the permissions;
 *                                    grant 2: branch B2 WITHOUT them, carrying
 *                                    only unrelated authority
 *   PRINCIPAL_DENIED                 an allow grant and a deny grant on the same
 *                                    codes (BR-IAM-001 deny precedence)
 *
 * `PRINCIPAL_UNION`'s second grant is BRANCH-scoped on purpose. An earlier
 * fixture in this repository added a `company`-type `grant_scopes` row beside a
 * `branch` one, which by the platform's own contract makes the whole grant
 * company-wide — and then read the resulting (correct) allow as a defect. The
 * shape of a grant is asserted directly below, in
 * `describe('the fixtures themselves')`, so this suite cannot repeat that
 * mistake silently: if the union principal ever acquires a company-scope row,
 * or the B2 role ever acquires one of the ten permissions, the fixture
 * assertions fail before any behavioural test runs.
 *
 * The company principal's second grant is COMPANY-scoped for a related reason
 * that is worth writing down because it is not obvious. `resolveScopeFor`
 * aggregates `branch_id` across ALL grants and publishes the result as
 * `app.branch_ids`; the `rec`/`apt` policies then require the row's branch to
 * be in that list whenever it is non-empty. So attaching a BRANCH-scoped second
 * grant to a company-scoped principal would collapse its visibility to that one
 * branch and hide its own company behind RLS — the fixture would then prove
 * nothing about authorization. Keeping both of its grants company-scoped leaves
 * `app.branch_ids` empty, so RLS narrows by company only and the refusal in the
 * other company is attributable to the permission check rather than to RLS.
 *
 * Every request goes through the exported route handler on the least-privilege
 * `app_runtime` role, and every denial is followed by reading back, as admin,
 * everything the command would have written: the resource's own state and
 * version, the domain rows, the audit record, the outbox envelope, and the
 * idempotency reservation. A denial that rolled back leaves none of them.
 *
 * Operations exercised here: all ten id-addressed P1-18 commands. The creation
 * commands (`rec.reception-create`, `apt.appointment-create`) are fixture
 * machinery only — they already pass an `authorizationTarget` and are evidenced
 * by their own suites.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   apt.appointment-reschedule: route service authorization denial isolation cross-tenant
 *   apt.appointment-cancel: route service authorization denial isolation cross-tenant
 *   apt.appointment-no-show: route service authorization denial isolation cross-tenant
 *   rec.reception-party-role: route service authorization denial isolation cross-tenant
 *   rec.reception-authorization: route service authorization denial isolation cross-tenant
 *   rec.reception-approve: route service authorization denial isolation cross-tenant
 *   rec.reception-condition-evidence: route service authorization denial isolation cross-tenant
 *   rec.reception-signature: route service authorization denial isolation cross-tenant
 *   rec.reception-refusal: route service authorization denial isolation cross-tenant
 *   rec.reception-convert-to-work-order: route service authorization denial isolation cross-tenant
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { resolveScopeFor } from '@/server/context/resolve-context';
import type { DbHandle } from '@/server/db/transaction';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { POST as CREATE_APPOINTMENT } from '@/app/api/v1/appointments/route';
import { POST as RESCHEDULE } from '@/app/api/v1/appointments/[appointmentId]/reschedule/route';
import { POST as CANCEL } from '@/app/api/v1/appointments/[appointmentId]/cancel/route';
import { POST as NO_SHOW } from '@/app/api/v1/appointments/[appointmentId]/no-show/route';
import { POST as CREATE_RECEPTION } from '@/app/api/v1/receptions/route';
import { POST as PARTY_ROLE } from '@/app/api/v1/receptions/[receptionId]/party-roles/route';
import { POST as AUTHORIZATION } from '@/app/api/v1/receptions/[receptionId]/authorizations/route';
import { POST as APPROVE } from '@/app/api/v1/receptions/[receptionId]/approve/route';
import { POST as CONDITION_EVIDENCE } from '@/app/api/v1/receptions/[receptionId]/condition-evidence/route';
import { POST as SIGNATURE } from '@/app/api/v1/receptions/[receptionId]/signatures/route';
import { POST as REFUSAL } from '@/app/api/v1/receptions/[receptionId]/refusals/route';
import { POST as CONVERT } from '@/app/api/v1/receptions/[receptionId]/convert-to-work-order/route';

// ---------------------------------------------------------------------------
// Organisational fixtures. Four real scopes, so no assertion below addresses a
// fabricated id: B1 and B2 are two branches of ONE company in tenant A, D is a
// branch of a SECOND tenant-A company, and TB belongs to tenant B.
// ---------------------------------------------------------------------------
const BRANCH_B2 = 'c1b80000-0000-4000-8000-000000000011';
const COMPANY_D = 'c1b80000-0000-4000-8000-000000000012';
const BRANCH_D = 'c1b80000-0000-4000-8000-000000000013';
const COMPANY_TB = 'c1b80000-0000-4000-8000-000000000014';
const BRANCH_TB = 'c1b80000-0000-4000-8000-000000000015';

// --- Principals. Each is (role, user, subject) and, when scoped, grant ids. ---
const ROLE_B1 = 'c1b80000-0000-4000-8000-000000000021';
const USER_B1 = 'c1b80000-0000-4000-8000-000000000022';
const GRANT_B1 = 'c1b80000-0000-4000-8000-000000000023';
const PRINCIPAL_BRANCH_B1_PERMISSION = 'fx_p1_18_sc_branch_b1';

const ROLE_B2 = 'c1b80000-0000-4000-8000-000000000031';
const USER_B2 = 'c1b80000-0000-4000-8000-000000000032';
const GRANT_B2 = 'c1b80000-0000-4000-8000-000000000033';
const PRINCIPAL_BRANCH_B2_PERMISSION = 'fx_p1_18_sc_branch_b2';

const ROLE_COMPANY_C = 'c1b80000-0000-4000-8000-000000000041';
const USER_COMPANY_C = 'c1b80000-0000-4000-8000-000000000042';
const GRANT_COMPANY_C = 'c1b80000-0000-4000-8000-000000000043';
/** The company principal's unrelated foothold in the OTHER company. */
const GRANT_COMPANY_C_ELSEWHERE = 'c1b80000-0000-4000-8000-000000000044';
const PRINCIPAL_COMPANY_C_PERMISSION = 'fx_p1_18_sc_company_c';

const ROLE_TENANT_WIDE = 'c1b80000-0000-4000-8000-000000000051';
const USER_TENANT_WIDE = 'c1b80000-0000-4000-8000-000000000052';
const PRINCIPAL_TENANT_WIDE_PERMISSION = 'fx_p1_18_sc_tenant_wide';

const USER_UNION = 'c1b80000-0000-4000-8000-000000000062';
/** Carries the ten permissions, scoped to B1 alone. */
const GRANT_UNION_PERMITTED = 'c1b80000-0000-4000-8000-000000000063';
/** Carries unrelated authority only, scoped to B2 alone. */
const GRANT_UNION_VISIBILITY = 'c1b80000-0000-4000-8000-000000000064';
const PRINCIPAL_UNION = 'fx_p1_18_sc_union';

const ROLE_DENY = 'c1b80000-0000-4000-8000-000000000071';
const USER_DENIED = 'c1b80000-0000-4000-8000-000000000072';
const PRINCIPAL_DENIED = 'fx_p1_18_sc_denied';

/** The role that grants visibility and nothing this suite tests. */
const ROLE_VISIBILITY = 'c1b80000-0000-4000-8000-000000000081';

const ROLE_TENANT_B = 'c1b80000-0000-4000-8000-000000000091';
const USER_TENANT_B = 'c1b80000-0000-4000-8000-000000000092';
const SUBJ_TENANT_B = 'fx_p1_18_sc_tenant_b';

// --- Domain fixtures. --------------------------------------------------------
const PARTNER_A = 'c1b80000-0000-4000-8000-0000000000a1';
const PARTNER_B = 'c1b80000-0000-4000-8000-0000000000a2';
const TYPE_A = 'c1b80000-0000-4000-8000-0000000000a3';
const TYPE_B = 'c1b80000-0000-4000-8000-0000000000a4';
const REASON_A = 'c1b80000-0000-4000-8000-0000000000a5';
const REASON_B = 'c1b80000-0000-4000-8000-0000000000a6';
/**
 * A signature document and its one immutable version, PER TENANT.
 *
 * `rec.signatures` binds a signature to a document version, and both are
 * tenant-scoped rows. Reusing tenant A's document for the tenant-B leg of the
 * cross-tenant case would make that call fail on the document rather than
 * succeed, and the "the row really was actionable in its own tenant" control —
 * the thing that proves the cross-tenant 404 came from the boundary and not
 * from an unusable fixture — would silently stop proving it.
 */
const CATEGORY_A = 'c1b80000-0000-4000-8000-0000000000a7';
const DOC_SIG_A = 'c1b80000-0000-4000-8000-0000000000a8';
const VER_SIG_A = 'c1b80000-0000-4000-8000-0000000000a9';
const CATEGORY_B = 'c1b80000-0000-4000-8000-0000000000b1';
const DOC_SIG_B = 'c1b80000-0000-4000-8000-0000000000b2';
const VER_SIG_B = 'c1b80000-0000-4000-8000-0000000000b3';
/** 32 bytes of hex — `ck_document_versions_sha256_len`. */
const SHA_HEX = 'b'.repeat(64);

const APPOINTMENTS = 'http://localhost/api/v1/appointments';
const RECEPTIONS = 'http://localhost/api/v1/receptions';

/**
 * Every permission the ten operations declare, in one list.
 *
 * The permitted roles below hold all of them, so a refusal in any test is
 * always about SCOPE and never about a missing code — which is the distinction
 * this suite exists to make.
 */
const P1_18_PERMISSIONS = [
  'apt.appointment.manage',
  'apt.appointment.lifecycle.manage',
  'rec.reception.manage',
  'rec.reception.party.manage',
  'rec.reception.authorization.verify',
  'rec.reception.approve',
  'rec.reception.evidence.manage',
  'rec.reception.signature.manage',
  'rec.reception.convert',
] as const;

/**
 * The unrelated authority a visibility-only grant carries.
 *
 * `org.tenant.read` is a real seeded platform code, so the visibility grant is
 * a grant a real deployment could issue rather than an empty shell. It appears
 * in none of the ten operations' `permissions` arrays.
 */
const UNRELATED_PERMISSION = 'org.tenant.read';

interface Body {
  readonly appointmentId?: string;
  readonly receptionVisitId?: string;
  readonly workOrderId?: string;
  readonly recordVersion?: number;
  readonly lifecycleStatus?: string;
  readonly receptionStatus?: string;
  readonly code?: string;
}

/** A real company + branch that some fixture resource lives in. */
interface Scope {
  readonly label: string;
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly partnerId: string;
  readonly typeId: string;
  readonly reasonId: string;
  /** The tenant's own signature document and the exact version signed against. */
  readonly documentId: string;
  readonly documentVersionId: string;
  /** The subject able to create fixtures there. */
  readonly operator: string;
}

let admin: Pool;
let runtime: Pool;
let vehicleCounter = 0;

const SCOPE_B1: Scope = {
  label: 'branch B1',
  tenantId: TENANT_A,
  companyId: COMPANY_A1,
  branchId: BRANCH_A1,
  partnerId: PARTNER_A,
  typeId: TYPE_A,
  reasonId: REASON_A,
  documentId: DOC_SIG_A,
  documentVersionId: VER_SIG_A,
  operator: PRINCIPAL_TENANT_WIDE_PERMISSION,
};
const SCOPE_B2: Scope = { ...SCOPE_B1, label: 'branch B2', branchId: BRANCH_B2 };
const SCOPE_OTHER_COMPANY: Scope = {
  ...SCOPE_B1,
  label: 'company D branch',
  companyId: COMPANY_D,
  branchId: BRANCH_D,
};
const SCOPE_TENANT_B: Scope = {
  label: 'tenant B',
  tenantId: TENANT_B,
  companyId: COMPANY_TB,
  branchId: BRANCH_TB,
  partnerId: PARTNER_B,
  typeId: TYPE_B,
  reasonId: REASON_B,
  documentId: DOC_SIG_B,
  documentVersionId: VER_SIG_B,
  operator: SUBJ_TENANT_B,
};

function authAs(subject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId,
    })
  );
}

/** Authenticates as whoever may create fixtures in `scope`. */
const authAsOperator = (scope: Scope): void => authAs(scope.operator, scope.tenantId);

// ---------------------------------------------------------------------------
// Route drivers. Every request runs the exported handler with a real Request,
// so authentication, scope resolution, authorization, If-Match, idempotency and
// the transaction are all on trial — not just the service.
// ---------------------------------------------------------------------------

function headers(key: string, ifMatch?: number): HeadersInit {
  return {
    'content-type': 'application/json',
    'idempotency-key': key,
    ...(ifMatch === undefined ? {} : { 'if-match': String(ifMatch) }),
  };
}

/**
 * Drives one sub-resource route handler.
 *
 * Generic over the path-parameter shape so each handler keeps its own exact
 * signature — `{ appointmentId }` or `{ receptionId }` — with no cast. A cast
 * here would be the wrong tool twice over: it would hide a genuine mismatch if a
 * route's parameter name ever changed, and this suite exists precisely to catch
 * a route that was wired incorrectly.
 */
function post<P extends Record<string, string>>(
  handler: (request: Request, route: { params: Promise<P> }) => Promise<Response>,
  url: string,
  params: P,
  body: unknown,
  key: string,
  ifMatch?: number
): Promise<Response> {
  const request = new Request(url, {
    method: 'POST',
    headers: headers(key, ifMatch),
    body: JSON.stringify(body),
  });
  return handler(request, { params: Promise.resolve(params) });
}

// ---------------------------------------------------------------------------
// Admin-side fixture machinery and read-backs. This connection bypasses RLS, so
// nothing here is ever evidence about runtime behaviour: it provisions state
// and it counts what actually landed.
// ---------------------------------------------------------------------------

async function inTenantContext<T>(
  tenantId: string,
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, tenantId]
    );
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** A fresh vehicle per resource: only one non-terminal visit may exist per vehicle. */
async function newVehicle(tenantId: string): Promise<string> {
  vehicleCounter += 1;
  const vin = `P118SCOPE${String(vehicleCounter).padStart(8, '0')}`;
  return inTenantContext(tenantId, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$2,'ice','active',$3) RETURNING id`,
      [tenantId, vin, USER_A]
    );
    return inserted.rows[0]?.id ?? '';
  });
}

async function scalar(sql: string, values: readonly unknown[]): Promise<string | null> {
  const result = await admin.query<{ value: string | null }>(sql, [...values]);
  return result.rows[0]?.value ?? null;
}

const count = async (sql: string, values: readonly unknown[]): Promise<number> =>
  Number((await scalar(sql, values)) ?? '0');

/**
 * The narrowest `DbHandle` `resolveScopeFor` actually needs.
 *
 * It reads two rows and touches nothing else on the handle, so wrapping the
 * admin pool is enough to exercise the SHIPPED resolver rather than a copy of
 * its query. `context` and `depth` are never referenced on this path.
 *
 * One limit, stated because it bounds what the assertions below mean: the admin
 * pool binds the `postgres` superuser, which is BYPASSRLS, and this helper sets
 * no session GUCs. `resolveScopeFor`'s account lookup carries no tenant
 * predicate in SQL — the claimed tenant is enforced by `sel_user_accounts_tenant`
 * — so under this handle that policy is NOT in force. The `userId`/`tenantId`
 * assertions therefore rest on the unique provider-identity index rather than on
 * tenant RLS, and must not be read as tenant-binding proofs.
 *
 * What these tests DO measure soundly is the thing they exist for: the branch
 * and company sets are produced by the resolver's own SQL aggregate over active
 * grants, not by RLS, so the permission-blind union is measured exactly — and
 * strictly better than the hand-written query this replaced.
 */
const handleFor = (pool: Pool): DbHandle =>
  ({
    query: (text: string, values?: readonly unknown[]) => pool.query(text, values as unknown[]),
  }) as unknown as DbHandle;

const auditCount = (action: string): Promise<number> =>
  count(`SELECT count(*)::text AS value FROM iam.audit_records WHERE action = $1`, [action]);

const outboxCount = (eventType: string, aggregateId: string): Promise<number> =>
  count(
    `SELECT count(*)::text AS value FROM shared.event_outbox
      WHERE event_type = $1 AND aggregate_id = $2`,
    [eventType, aggregateId]
  );

const idempotencyRows = (key: string): Promise<number> =>
  count(`SELECT count(*)::text AS value FROM shared.idempotency_keys WHERE idempotency_key = $1`, [
    key,
  ]);

// ---------------------------------------------------------------------------
// Fixture creation through the REAL creation routes, as the operator for the
// scope. Using the API rather than direct inserts means every fixture satisfies
// the same frozen guards a production row would.
// ---------------------------------------------------------------------------

async function bookAppointment(scope: Scope): Promise<string> {
  authAsOperator(scope);
  const vehicleId = await newVehicle(scope.tenantId);
  const response = await CREATE_APPOINTMENT(
    new Request(APPOINTMENTS, {
      method: 'POST',
      headers: headers(crypto.randomUUID()),
      body: JSON.stringify({
        companyId: scope.companyId,
        branchId: scope.branchId,
        vehicleId,
        requesterPartnerId: scope.partnerId,
        appointmentTypeId: scope.typeId,
        requestedFrom: '2026-11-02T09:00:00Z',
        requestedTo: '2026-11-02T10:00:00Z',
      }),
    })
  );
  const parsed = (await response.json()) as Body;
  if (response.status !== 201 || !parsed.appointmentId) {
    throw new Error(
      `booking failed in ${scope.label}: ${response.status} ${JSON.stringify(parsed)}`
    );
  }
  return parsed.appointmentId;
}

/** Books and then confirms, which is the only state a no-show is reachable from. */
async function bookConfirmedAppointment(scope: Scope): Promise<string> {
  const appointmentId = await bookAppointment(scope);
  authAsOperator(scope);
  const confirmed = await post(
    RESCHEDULE,
    `${APPOINTMENTS}/${appointmentId}/reschedule`,
    { appointmentId },
    { confirmedFrom: '2026-11-02T09:00:00Z', confirmedTo: '2026-11-02T10:00:00Z' },
    crypto.randomUUID(),
    1
  );
  if (confirmed.status !== 200) {
    throw new Error(`confirm failed in ${scope.label}: ${confirmed.status}`);
  }
  return appointmentId;
}

async function openReception(scope: Scope): Promise<string> {
  authAsOperator(scope);
  const vehicleId = await newVehicle(scope.tenantId);
  const response = await CREATE_RECEPTION(
    new Request(RECEPTIONS, {
      method: 'POST',
      headers: headers(crypto.randomUUID()),
      body: JSON.stringify({
        companyId: scope.companyId,
        branchId: scope.branchId,
        vehicleId,
        receivingEmployeeId: USER_A,
        serviceRequesterPartnerId: scope.partnerId,
        origin: { kind: 'walk_in' },
      }),
    })
  );
  const parsed = (await response.json()) as Body;
  if (response.status !== 201 || !parsed.receptionVisitId) {
    throw new Error(
      `check-in failed in ${scope.label}: ${response.status} ${JSON.stringify(parsed)}`
    );
  }
  return parsed.receptionVisitId;
}

/** Opens a visit and records the approved authorization it needs to advance. */
async function openApprovableReception(scope: Scope): Promise<string> {
  const receptionId = await openReception(scope);
  authAsOperator(scope);
  const decision = await post(
    AUTHORIZATION,
    `${RECEPTIONS}/${receptionId}/authorizations`,
    { receptionId },
    { authorizingRole: 'service_requester', partnerId: scope.partnerId, decision: 'approved' },
    crypto.randomUUID()
  );
  if (decision.status !== 201) {
    throw new Error(`authorization failed in ${scope.label}: ${decision.status}`);
  }
  return receptionId;
}

/** Opens, authorizes and approves — the only state a conversion is reachable from. */
async function openAuthorizedReception(scope: Scope): Promise<string> {
  const receptionId = await openApprovableReception(scope);
  authAsOperator(scope);
  const approved = await post(
    APPROVE,
    `${RECEPTIONS}/${receptionId}/approve`,
    { receptionId },
    {},
    crypto.randomUUID(),
    1
  );
  if (approved.status !== 200) {
    throw new Error(`approval failed in ${scope.label}: ${approved.status}`);
  }
  return receptionId;
}

const appointmentVersion = (id: string): Promise<number> =>
  count(`SELECT record_version::text AS value FROM apt.appointments WHERE id = $1`, [id]);
const receptionVersion = (id: string): Promise<number> =>
  count(`SELECT record_version::text AS value FROM rec.reception_visits WHERE id = $1`, [id]);

// ---------------------------------------------------------------------------
// The ten operations, each as a triple of (arrange, act, probe).
//
// `probe` reads back EVERYTHING the command would have written. A denial is
// asserted by comparing the probe before and after: equal means the transaction
// left nothing behind — no lifecycle change, no domain row, no audit record, no
// outbox envelope. The idempotency reservation is checked separately, by key.
// ---------------------------------------------------------------------------

interface Arranged {
  readonly id: string;
  readonly version: number;
  readonly scope: Scope;
}

interface OperationCase {
  readonly id: string;
  readonly arrange: (scope: Scope) => Promise<Arranged>;
  readonly act: (target: Arranged, key: string) => Promise<Response>;
  readonly probe: (target: Arranged) => Promise<Record<string, number | string | null>>;
  /** What a successful call answers with. */
  readonly successStatus: number;
}

const arrangeAppointment = async (scope: Scope): Promise<Arranged> => {
  const id = await bookAppointment(scope);
  return { id, version: await appointmentVersion(id), scope };
};

const arrangeConfirmedAppointment = async (scope: Scope): Promise<Arranged> => {
  const id = await bookConfirmedAppointment(scope);
  return { id, version: await appointmentVersion(id), scope };
};

const arrangeReception = async (scope: Scope): Promise<Arranged> => {
  const id = await openReception(scope);
  return { id, version: await receptionVersion(id), scope };
};

const arrangeApprovable = async (scope: Scope): Promise<Arranged> => {
  const id = await openApprovableReception(scope);
  return { id, version: await receptionVersion(id), scope };
};

const arrangeAuthorized = async (scope: Scope): Promise<Arranged> => {
  const id = await openAuthorizedReception(scope);
  return { id, version: await receptionVersion(id), scope };
};

async function appointmentProbe(
  target: Arranged,
  action: string
): Promise<Record<string, number | string | null>> {
  const row = await admin.query<{
    lifecycle_status: string;
    record_version: number;
    confirmed_from: Date | null;
    cancelled_at: Date | null;
    no_show_recorded_at: Date | null;
  }>(
    `SELECT lifecycle_status, record_version, confirmed_from, cancelled_at, no_show_recorded_at
       FROM apt.appointments WHERE id = $1`,
    [target.id]
  );
  const found = row.rows[0];
  return {
    status: found?.lifecycle_status ?? null,
    version: found?.record_version ?? -1,
    confirmed: found?.confirmed_from ? 'set' : 'unset',
    cancelled: found?.cancelled_at ? 'set' : 'unset',
    noShow: found?.no_show_recorded_at ? 'set' : 'unset',
    audit: await auditCount(action),
    outbox: await outboxCount('appointment.changed', target.id),
    history: await count(
      `SELECT count(*)::text AS value FROM apt.appointment_status_history WHERE appointment_id = $1`,
      [target.id]
    ),
  };
}

async function receptionProbe(
  target: Arranged,
  action: string,
  extra: Record<string, number> = {}
): Promise<Record<string, number | string | null>> {
  const row = await admin.query<{ reception_status: string; record_version: number }>(
    `SELECT reception_status, record_version FROM rec.reception_visits WHERE id = $1`,
    [target.id]
  );
  const found = row.rows[0];
  return {
    status: found?.reception_status ?? null,
    version: found?.record_version ?? -1,
    audit: await auditCount(action),
    outbox: await outboxCount('reception.approved', target.id),
    ...extra,
  };
}

const OPERATIONS: readonly OperationCase[] = [
  {
    id: 'apt.appointment-reschedule',
    arrange: arrangeAppointment,
    act: (target, key) =>
      post(
        RESCHEDULE,
        `${APPOINTMENTS}/${target.id}/reschedule`,
        { appointmentId: target.id },
        { confirmedFrom: '2026-11-02T13:00:00Z', confirmedTo: '2026-11-02T14:00:00Z' },
        key,
        target.version
      ),
    probe: (target) => appointmentProbe(target, 'apt.appointment.rescheduled'),
    successStatus: 200,
  },
  {
    id: 'apt.appointment-cancel',
    arrange: arrangeAppointment,
    act: (target, key) =>
      post(
        CANCEL,
        `${APPOINTMENTS}/${target.id}/cancel`,
        { appointmentId: target.id },
        { cancellationReasonId: target.scope.reasonId },
        key,
        target.version
      ),
    probe: (target) => appointmentProbe(target, 'apt.appointment.cancelled'),
    successStatus: 200,
  },
  {
    id: 'apt.appointment-no-show',
    arrange: arrangeConfirmedAppointment,
    act: (target, key) =>
      post(
        NO_SHOW,
        `${APPOINTMENTS}/${target.id}/no-show`,
        { appointmentId: target.id },
        {},
        key,
        target.version
      ),
    probe: (target) => appointmentProbe(target, 'apt.appointment.no_show_recorded'),
    successStatus: 200,
  },
  {
    id: 'rec.reception-party-role',
    arrange: arrangeReception,
    act: (target, key) =>
      post(
        PARTY_ROLE,
        `${RECEPTIONS}/${target.id}/party-roles`,
        { receptionId: target.id },
        { partnerId: target.scope.partnerId, relationshipRole: 'vehicle_user' },
        key
      ),
    probe: async (target) =>
      receptionProbe(target, 'rec.reception.party_role_assigned', {
        roles: await count(
          `SELECT count(*)::text AS value FROM rec.reception_party_roles WHERE reception_visit_id = $1`,
          [target.id]
        ),
      }),
    successStatus: 201,
  },
  {
    id: 'rec.reception-authorization',
    arrange: arrangeReception,
    act: (target, key) =>
      post(
        AUTHORIZATION,
        `${RECEPTIONS}/${target.id}/authorizations`,
        { receptionId: target.id },
        {
          authorizingRole: 'service_requester',
          partnerId: target.scope.partnerId,
          decision: 'approved',
        },
        key
      ),
    probe: async (target) =>
      receptionProbe(target, 'rec.reception.authorization_recorded', {
        authorizations: await count(
          `SELECT count(*)::text AS value FROM rec.authorizations WHERE reception_visit_id = $1`,
          [target.id]
        ),
      }),
    successStatus: 201,
  },
  {
    id: 'rec.reception-approve',
    arrange: arrangeApprovable,
    act: (target, key) =>
      post(
        APPROVE,
        `${RECEPTIONS}/${target.id}/approve`,
        { receptionId: target.id },
        {},
        key,
        target.version
      ),
    probe: async (target) =>
      receptionProbe(target, 'rec.reception.approved', {
        history: await count(
          `SELECT count(*)::text AS value FROM rec.reception_status_history WHERE reception_visit_id = $1`,
          [target.id]
        ),
      }),
    successStatus: 200,
  },
  {
    id: 'rec.reception-condition-evidence',
    arrange: arrangeReception,
    act: (target, key) =>
      post(
        CONDITION_EVIDENCE,
        `${RECEPTIONS}/${target.id}/condition-evidence`,
        { receptionId: target.id },
        // An inspection header, deliberately NOT a complaint. Of the eight
        // evidence kinds this one command accepts, two write a RESTRICTED
        // narrative row — `rec.complaint_details` and
        // `rec.vehicle_content_details` — and both of those INSERT policies end
        // with `AND iam.has_permission('iam.sensitive.view')`, a SECOND
        // capability on top of the operation's declared
        // `rec.reception.evidence.manage`. None of this suite's principals holds
        // it, so a complaint is refused for every one of them, in every branch,
        // in every company — a denial that says nothing whatsoever about scope.
        // `rec.visual_inspections` carries the plain tenant/company/branch
        // predicate and nothing else (`ins_visual_inspections_scope`), so a
        // refusal here is attributable to the scoped authorization decision
        // alone, which is the only thing this suite exists to prove.
        { kind: 'inspection', inspectorId: USER_A },
        key
      ),
    probe: async (target) =>
      receptionProbe(target, 'rec.reception.evidence_recorded', {
        inspections: await count(
          `SELECT count(*)::text AS value FROM rec.visual_inspections WHERE reception_visit_id = $1`,
          [target.id]
        ),
      }),
    successStatus: 201,
  },
  {
    id: 'rec.reception-signature',
    arrange: arrangeReception,
    act: (target, key) =>
      post(
        SIGNATURE,
        `${RECEPTIONS}/${target.id}/signatures`,
        { receptionId: target.id },
        {
          signerRole: 'service_requester',
          signerPartnerId: target.scope.partnerId,
          signatureDocumentId: target.scope.documentId,
          signatureDocumentVersionId: target.scope.documentVersionId,
          captureMethod: 'drawn',
          purpose: 'custody_acceptance',
        },
        key
      ),
    probe: async (target) =>
      receptionProbe(target, 'rec.reception.signature_recorded', {
        signatures: await count(
          `SELECT count(*)::text AS value FROM rec.signatures WHERE reception_visit_id = $1`,
          [target.id]
        ),
      }),
    successStatus: 201,
  },
  {
    id: 'rec.reception-refusal',
    arrange: arrangeReception,
    act: (target, key) =>
      post(
        REFUSAL,
        `${RECEPTIONS}/${target.id}/refusals`,
        { receptionId: target.id },
        { refusalType: 'signature' },
        key
      ),
    probe: async (target) =>
      receptionProbe(target, 'rec.reception.refusal_recorded', {
        refusals: await count(
          `SELECT count(*)::text AS value FROM rec.refusals WHERE reception_visit_id = $1`,
          [target.id]
        ),
      }),
    successStatus: 201,
  },
  {
    id: 'rec.reception-convert-to-work-order',
    arrange: arrangeAuthorized,
    act: (target, key) =>
      post(
        CONVERT,
        `${RECEPTIONS}/${target.id}/convert-to-work-order`,
        { receptionId: target.id },
        {},
        key,
        target.version
      ),
    probe: async (target) =>
      receptionProbe(target, 'rec.reception.converted_to_work_order', {
        workOrders: await count(
          `SELECT count(*)::text AS value FROM wo.work_orders WHERE reception_visit_id = $1`,
          [target.id]
        ),
      }),
    successStatus: 200,
  },
];

/**
 * Drives one operation as `subject` and asserts a refusal that changed nothing.
 *
 * `expected` is the status the boundary should answer with: 403 where the
 * caller can SEE the row but holds no permission in its branch, 404 where RLS
 * hides the row entirely. Both are proved the same way — the probe is identical
 * before and after, and no idempotency reservation survives — because "denied"
 * has to mean the whole transaction rolled back, not merely that the response
 * said no.
 */
async function expectRefusal(
  operation: OperationCase,
  target: Arranged,
  subject: string,
  expected: number,
  tenantId = TENANT_A
): Promise<void> {
  const before = await operation.probe(target);
  const key = crypto.randomUUID();

  authAs(subject, tenantId);
  const response = await operation.act(target, key);
  const body = (await response.json()) as Body;

  expect(response.status, `${operation.id} as ${subject}`).toBe(expected);
  expect(body.code).toBe(expected === 403 ? 'ERR-IAM-001' : 'ERR-RES-001');
  expect(await operation.probe(target)).toEqual(before);
  expect(await idempotencyRows(key)).toBe(0);
}

/** Drives one operation as `subject` and asserts it succeeded and wrote. */
async function expectSuccess(
  operation: OperationCase,
  target: Arranged,
  subject: string
): Promise<void> {
  const before = await operation.probe(target);
  const key = crypto.randomUUID();

  authAs(subject);
  const response = await operation.act(target, key);
  expect(response.status, `${operation.id} as ${subject}`).toBe(operation.successStatus);
  expect(await operation.probe(target)).not.toEqual(before);
  expect(await idempotencyRows(key)).toBe(1);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

async function seedRole(
  tenantId: string,
  roleId: string,
  code: string,
  permissions: readonly string[],
  effect: 'allow' | 'deny' = 'allow'
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-18 scope containment fixture',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, code, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,$5::text,$3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A, [...permissions], effect]
  );
}

async function seedUser(tenantId: string, userId: string, subject: string): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','Scope Containment Fixture','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
}

/**
 * Issues one BRANCH-scoped grant.
 *
 * The grant row and its single scope row land in ONE transaction because the
 * "a scoped grant needs a scope" constraint trigger is DEFERRABLE INITIALLY
 * DEFERRED. Exactly one `grant_scopes` row is written, of type `branch`: adding
 * a `company` row beside it would make the whole grant company-wide, which is
 * the fixture error an earlier revision made and then misread as a defect.
 */
async function issueBranchGrant(input: {
  readonly tenantId: string;
  readonly grantId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly companyId: string;
  readonly branchId: string;
}): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [input.grantId, input.tenantId, input.userId, input.roleId, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [input.tenantId, input.grantId, input.companyId, input.branchId, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Issues one COMPANY-scoped grant: a single `company` scope row, no branch row. */
async function issueCompanyGrant(input: {
  readonly tenantId: string;
  readonly grantId: string;
  readonly userId: string;
  readonly roleId: string;
  readonly companyId: string;
}): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [input.grantId, input.tenantId, input.userId, input.roleId, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
       VALUES ($1,$2,'company',$3,$4)`,
      [input.tenantId, input.grantId, input.companyId, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  // The P1-18 permission codes belong to the seeded catalog file; the local
  // database is provisioned from the frozen Release 2 baseline, so they are
  // inserted here rather than assumed. A database that already carries them is
  // used as-is.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('apt.appointment.manage','apt','Create and reschedule appointments in the caller scope','medium',$1),
            ('apt.appointment.lifecycle.manage','apt','Cancel an appointment or record a no-show','medium',$1),
            ('rec.reception.manage','rec','Open a reception visit and accept vehicle custody','medium',$1),
            ('rec.reception.party.manage','rec','Assign and close dated party roles on a reception','medium',$1),
            ('rec.reception.authorization.verify','rec','Verify and record reception authorization decisions','high',$1),
            ('rec.reception.approve','rec','Approve a reception visit for work','high',$1),
            ('rec.reception.evidence.manage','rec','Record pre-service condition evidence on a reception','medium',$1),
            ('rec.reception.signature.manage','rec','Capture reception signatures and refusals','high',$1),
            ('rec.reception.convert','rec','Convert an authorized reception into a work order','high',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  // Four real scopes. B2 is a second branch of company A1; D is a branch of a
  // SECOND tenant-A company, so "outside its company" addresses a real row; TB
  // is tenant B's own company and branch.
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'p118_sc_b2','P1-18 Scope Branch B2','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B2, TENANT_A, COMPANY_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'p118_sc_company_d','P1-18 Scope Company D','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_D, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'p118_sc_d','P1-18 Scope Branch D','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_D, TENANT_A, COMPANY_D, USER_A]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'p118_sc_company_tb','P1-18 Scope Company TB','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_TB, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'p118_sc_tb','P1-18 Scope Branch TB','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_TB, TENANT_B, COMPANY_TB, USER_A]
  );

  // Roles. `ROLE_VISIBILITY` deliberately carries NO P1-18 permission: it is
  // what makes a second grant a foothold rather than an authority.
  await seedRole(TENANT_A, ROLE_B1, 'fx_p118_sc_b1', P1_18_PERMISSIONS);
  await seedRole(TENANT_A, ROLE_B2, 'fx_p118_sc_b2', P1_18_PERMISSIONS);
  await seedRole(TENANT_A, ROLE_COMPANY_C, 'fx_p118_sc_company_c', P1_18_PERMISSIONS);
  await seedRole(TENANT_A, ROLE_TENANT_WIDE, 'fx_p118_sc_tenant_wide', P1_18_PERMISSIONS);
  await seedRole(TENANT_A, ROLE_VISIBILITY, 'fx_p118_sc_visibility', [UNRELATED_PERMISSION]);
  await seedRole(TENANT_A, ROLE_DENY, 'fx_p118_sc_deny', P1_18_PERMISSIONS, 'deny');
  await seedRole(TENANT_B, ROLE_TENANT_B, 'fx_p118_sc_tenant_b', P1_18_PERMISSIONS);

  await seedUser(TENANT_A, USER_B1, PRINCIPAL_BRANCH_B1_PERMISSION);
  await seedUser(TENANT_A, USER_B2, PRINCIPAL_BRANCH_B2_PERMISSION);
  await seedUser(TENANT_A, USER_COMPANY_C, PRINCIPAL_COMPANY_C_PERMISSION);
  await seedUser(TENANT_A, USER_TENANT_WIDE, PRINCIPAL_TENANT_WIDE_PERMISSION);
  await seedUser(TENANT_A, USER_UNION, PRINCIPAL_UNION);
  await seedUser(TENANT_A, USER_DENIED, PRINCIPAL_DENIED);
  await seedUser(TENANT_B, USER_TENANT_B, SUBJ_TENANT_B);

  // Unrestricted grants: the tenant-wide operator, the denied principal's allow
  // side and its deny side, and tenant B's own operator.
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$6,$6),
            ($1,$4,$3,'unrestricted',$6,$6),
            ($1,$4,$5,'unrestricted',$6,$6)`,
    [TENANT_A, USER_TENANT_WIDE, ROLE_TENANT_WIDE, USER_DENIED, ROLE_DENY, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [TENANT_B, USER_TENANT_B, ROLE_TENANT_B, USER_A]
  );

  await issueBranchGrant({
    tenantId: TENANT_A,
    grantId: GRANT_B1,
    userId: USER_B1,
    roleId: ROLE_B1,
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
  });
  await issueBranchGrant({
    tenantId: TENANT_A,
    grantId: GRANT_B2,
    userId: USER_B2,
    roleId: ROLE_B2,
    companyId: COMPANY_A1,
    branchId: BRANCH_B2,
  });

  // The company principal: authority across company A1, and a foothold in
  // company D that carries no P1-18 permission at all.
  //
  // BOTH grants are company-scoped. A branch-scoped second grant would put a
  // branch id into `app.branch_ids`, and the `rec`/`apt` policies narrow on that
  // list as soon as it is non-empty — which would hide company A1's own branches
  // from this principal and turn the "outside its company" case into an RLS 404
  // that proves nothing about the permission check.
  await issueCompanyGrant({
    tenantId: TENANT_A,
    grantId: GRANT_COMPANY_C,
    userId: USER_COMPANY_C,
    roleId: ROLE_COMPANY_C,
    companyId: COMPANY_A1,
  });
  await issueCompanyGrant({
    tenantId: TENANT_A,
    grantId: GRANT_COMPANY_C_ELSEWHERE,
    userId: USER_COMPANY_C,
    roleId: ROLE_VISIBILITY,
    companyId: COMPANY_D,
  });

  // THE escalation fixture: the permission in B1 only, and unrelated authority
  // in B2. `app.branch_ids` will contain both, so RLS admits a B2 row.
  await issueBranchGrant({
    tenantId: TENANT_A,
    grantId: GRANT_UNION_PERMITTED,
    userId: USER_UNION,
    roleId: ROLE_B1,
    companyId: COMPANY_A1,
    branchId: BRANCH_A1,
  });
  await issueBranchGrant({
    tenantId: TENANT_A,
    grantId: GRANT_UNION_VISIBILITY,
    userId: USER_UNION,
    roleId: ROLE_VISIBILITY,
    companyId: COMPANY_A1,
    branchId: BRANCH_B2,
  });

  // Requesters and appointment catalogs, one per tenant.
  await inTenantContext(TENANT_A, async (client) => {
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','P1-18 Scope Requester A','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_A, TENANT_A, USER_A]
    );
  });
  await inTenantContext(TENANT_B, async (client) => {
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','P1-18 Scope Requester B','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_B, TENANT_B, USER_A]
    );
  });
  await admin.query(
    `INSERT INTO apt.appointment_types (id, scope, tenant_id, code, name, status, created_by)
     VALUES ($1,'tenant',$2,'fx_p118_sc_service','P1-18 Scope Service A','active',$5),
            ($3,'tenant',$4,'fx_p118_sc_service','P1-18 Scope Service B','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [TYPE_A, TENANT_A, TYPE_B, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO apt.cancellation_reasons (id, scope, tenant_id, code, name, status, created_by)
     VALUES ($1,'tenant',$2,'fx_p118_sc_reason','Customer request A','active',$5),
            ($3,'tenant',$4,'fx_p118_sc_reason','Customer request B','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [REASON_A, TENANT_A, REASON_B, TENANT_B, USER_A]
  );

  // A signature document and its one immutable version, in EACH tenant. Both
  // are needed: `rec.signatures` binds to a document version, and a version is
  // a tenant-scoped row, so tenant B has to sign against tenant B's own.
  for (const [categoryId, documentId, versionId, tenantId] of [
    [CATEGORY_A, DOC_SIG_A, VER_SIG_A, TENANT_A],
    [CATEGORY_B, DOC_SIG_B, VER_SIG_B, TENANT_B],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
          default_classification, default_retention_class, created_by)
       VALUES ($1,'tenant',$2,'p118_sc_docs','P1-18 scope documents',
               ARRAY['application/pdf']::text[], 1048576, 'internal', 'evidence-audit', $3)
       ON CONFLICT (id) DO NOTHING`,
      [categoryId, tenantId, USER_A]
    );
    await admin.query(
      `INSERT INTO shared.documents
         (id, tenant_id, category_id, title, classification, retention_class, status, created_by)
       VALUES ($1,$2,$3,'P1-18 scope signature','internal','evidence-audit','pending',$4)
       ON CONFLICT (id) DO NOTHING`,
      [documentId, tenantId, categoryId, USER_A]
    );
    await admin.query(
      `INSERT INTO shared.document_versions
         (id, tenant_id, document_id, version_number, storage_key, content_type,
          size_bytes, sha256, uploaded_by, created_by)
       VALUES ($1,$2,$3,1,$4,'application/pdf',1024, decode($5,'hex'), $6, $6)
       ON CONFLICT (id) DO NOTHING`,
      [versionId, tenantId, documentId, `p118-sc/${documentId}`, SHA_HEX, USER_A]
    );
  }

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

// ---------------------------------------------------------------------------
// The fixtures are load-bearing, so they are asserted rather than assumed.
// ---------------------------------------------------------------------------

describe('the fixtures themselves', () => {
  it('gives PRINCIPAL_UNION the permission in B1 and only unrelated authority in B2', async () => {
    const scopes = await admin.query<{
      grant_id: string;
      scope_type: string;
      company_id: string | null;
      branch_id: string | null;
    }>(
      `SELECT grant_id, scope_type, company_id, branch_id
         FROM iam.grant_scopes
        WHERE grant_id = ANY($1::uuid[])
        ORDER BY grant_id`,
      [[GRANT_UNION_PERMITTED, GRANT_UNION_VISIBILITY]]
    );

    // Exactly two scope rows, both `branch`. A `company` row on either grant
    // would silently widen it to the whole company and make every escalation
    // assertion below meaningless.
    expect(scopes.rows).toHaveLength(2);
    expect(scopes.rows.every((row) => row.scope_type === 'branch')).toBe(true);
    expect(scopes.rows.map((row) => row.branch_id).sort()).toEqual([BRANCH_A1, BRANCH_B2].sort());

    // The permission-bearing grant covers B1 and nothing else.
    const permitted = scopes.rows.filter((row) => row.grant_id === GRANT_UNION_PERMITTED);
    expect(permitted).toHaveLength(1);
    expect(permitted[0]?.branch_id).toBe(BRANCH_A1);

    // And the B2 grant's role holds NONE of the ten operations' permissions.
    const overlap = await count(
      `SELECT count(*)::text AS value
         FROM iam.role_permissions rp
         JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 AND p.permission_code = ANY($2::text[])`,
      [ROLE_VISIBILITY, [...P1_18_PERMISSIONS]]
    );
    expect(overlap).toBe(0);
  });

  it('publishes both branches through the REAL resolver, so RLS admits B2', async () => {
    // This is the other half of the defect: the resolved branch set is the
    // union of every active grant, regardless of which permission any of them
    // carries.
    //
    // An earlier revision asserted that by running its own hand-written query
    // over `iam.role_grants`/`iam.grant_scopes`. That was worthless as a guard
    // — it re-implemented `resolveScopeFor` instead of calling it, omitted the
    // `valid_from`/`valid_to` predicates the real resolver applies, and would
    // therefore have stayed green through exactly the narrowing its own comment
    // claimed to catch. It now calls the shipped resolver.
    const scope = await resolveScopeFor(handleFor(admin), {
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: PRINCIPAL_UNION,
      tenantId: TENANT_A,
    });

    expect(scope).not.toBeNull();
    expect(scope?.userId).toBe(USER_UNION);
    expect(scope?.tenantId).toBe(TENANT_A);
    expect(scope?.unrestricted).toBe(false);
    expect([...(scope?.branchIds ?? [])].sort()).toEqual([BRANCH_A1, BRANCH_B2].sort());
  });

  it('leaves the company principal with NO branch narrowing, through the REAL resolver', async () => {
    // The company fixture's whole point: two company-scoped grants and no
    // branch row anywhere, so `app.branch_ids` is empty and RLS narrows by
    // company only. If a branch row ever appears, the company cases stop
    // testing authorization and start testing RLS.
    const scope = await resolveScopeFor(handleFor(admin), {
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: PRINCIPAL_COMPANY_C_PERMISSION,
      tenantId: TENANT_A,
    });

    expect(scope?.unrestricted).toBe(false);
    expect(scope?.branchIds).toEqual([]);
    expect([...(scope?.companyIds ?? [])].sort()).toEqual([COMPANY_A1, COMPANY_D].sort());
  });

  it('leaves the tenant-wide principal unrestricted, through the REAL resolver', async () => {
    // An unrestricted grant must publish NO narrowing at all — passing scoped
    // companies alongside it would silently narrow a tenant-wide operator.
    const scope = await resolveScopeFor(handleFor(admin), {
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: PRINCIPAL_TENANT_WIDE_PERMISSION,
      tenantId: TENANT_A,
    });

    expect(scope?.unrestricted).toBe(true);
    expect(scope?.companyIds).toEqual([]);
    expect(scope?.branchIds).toEqual([]);
  });

  it('gives the company principal two company rows and no branch narrowing at all', async () => {
    const rows = await admin.query<{
      grant_id: string;
      scope_type: string;
      company_id: string | null;
      branch_id: string | null;
    }>(
      `SELECT grant_id, scope_type, company_id, branch_id
         FROM iam.grant_scopes WHERE grant_id = ANY($1::uuid[])`,
      [[GRANT_COMPANY_C, GRANT_COMPANY_C_ELSEWHERE]]
    );
    expect(rows.rows).toHaveLength(2);
    // Every branch id must be NULL. One non-null branch would put this principal
    // under branch narrowing and hide its own company from it, which would make
    // the company cases below pass or fail for reasons that have nothing to do
    // with the permission check under test.
    expect(rows.rows.every((row) => row.branch_id === null)).toBe(true);
    expect(rows.rows.every((row) => row.scope_type === 'company')).toBe(true);

    const permitted = rows.rows.find((row) => row.grant_id === GRANT_COMPANY_C);
    expect(permitted?.company_id).toBe(COMPANY_A1);
    const elsewhere = rows.rows.find((row) => row.grant_id === GRANT_COMPANY_C_ELSEWHERE);
    expect(elsewhere?.company_id).toBe(COMPANY_D);
  });

  it('gives each single-branch principal exactly one branch scope row', async () => {
    for (const [grantId, branchId] of [
      [GRANT_B1, BRANCH_A1],
      [GRANT_B2, BRANCH_B2],
    ] as const) {
      const rows = await admin.query<{ scope_type: string; branch_id: string | null }>(
        `SELECT scope_type, branch_id FROM iam.grant_scopes WHERE grant_id = $1`,
        [grantId]
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]?.scope_type).toBe('branch');
      expect(rows.rows[0]?.branch_id).toBe(branchId);
    }
  });
});

// ---------------------------------------------------------------------------
// The containment matrix, one describe per operation.
//
// Every operation is proved individually. A representative operation would not
// do: the ten reach the check through FOUR different application choke points,
// and a route that forgets to pass the authorizer compiles perfectly well.
// ---------------------------------------------------------------------------

describe.each(OPERATIONS.map((operation) => [operation.id, operation] as const))(
  '%s: scoped-authorization containment',
  (id, operation) => {
    it('refuses the permission-union escalation and leaves nothing behind', async () => {
      // The headline case. PRINCIPAL_UNION holds this operation's permission in
      // branch B1 and only unrelated authority in branch B2, and the target is
      // in B2. RLS admits the row — B2 is in the caller's branch union — so the
      // only thing that can refuse this is the permission being evaluated
      // against the LOCKED row's own branch.
      const target = await operation.arrange(SCOPE_B2);
      await expectRefusal(operation, target, PRINCIPAL_UNION, 403);

      // And the same principal, the same request shape, on a resource inside
      // the branch its permission-bearing grant actually covers: allowed. So
      // the refusal above was the scope and nothing else — not a missing code,
      // not a broken fixture, not the operation being unreachable.
      const inGrantedBranch = await operation.arrange(SCOPE_B1);
      await expectSuccess(operation, inGrantedBranch, PRINCIPAL_UNION);
    });

    it('admits a branch-scoped principal that holds the permission in that branch', async () => {
      const target = await operation.arrange(SCOPE_B2);
      await expectSuccess(operation, target, PRINCIPAL_BRANCH_B2_PERMISSION);
    });

    it('refuses a branch-scoped principal outside its branch', async () => {
      // PRINCIPAL_BRANCH_B1_PERMISSION holds every permission, in B1 only, and
      // has no second grant — so RLS hides the B2 row and the answer is the
      // uniform 404 rather than 403. Recorded as its own case because it is the
      // shape the pre-existing suites already covered, and it must keep working.
      const target = await operation.arrange(SCOPE_B2);
      await expectRefusal(operation, target, PRINCIPAL_BRANCH_B1_PERMISSION, 404);
    });

    it('admits a company-wide principal inside its company and refuses it outside', async () => {
      const inside = await operation.arrange(SCOPE_B1);
      await expectSuccess(operation, inside, PRINCIPAL_COMPANY_C_PERMISSION);

      // A second branch of the SAME company, still inside the company grant.
      const alsoInside = await operation.arrange(SCOPE_B2);
      await expectSuccess(operation, alsoInside, PRINCIPAL_COMPANY_C_PERMISSION);

      // Company D: the principal can SEE this row, because its second grant is
      // company-scoped there and puts company D into `app.company_ids` — and
      // that grant carries no P1-18 permission, while the grant that does carry
      // them reaches company A1 only. So the refusal is the permission check
      // answering about company D, not RLS hiding the row.
      const outside = await operation.arrange(SCOPE_OTHER_COMPANY);
      await expectRefusal(operation, outside, PRINCIPAL_COMPANY_C_PERMISSION, 403);
    });

    it('admits an unrestricted principal anywhere in its tenant', async () => {
      const target = await operation.arrange(SCOPE_OTHER_COMPANY);
      await expectSuccess(operation, target, PRINCIPAL_TENANT_WIDE_PERMISSION);
    });

    it('refuses an explicit deny even where the caller also holds an allow', async () => {
      // BR-IAM-001 deny precedence is global, so this refusal arrives before the
      // handler ever runs. It is asserted here to prove the second, in-
      // transaction check neither softens nor duplicates it.
      const target = await operation.arrange(SCOPE_B1);
      await expectRefusal(operation, target, PRINCIPAL_DENIED, 403);
    });

    it('refuses a cross-tenant target without disclosing that it exists', async () => {
      // A REAL tenant-B resource, created by a real tenant-B principal that
      // holds the very same permissions in its own tenant. The tenant-A caller
      // is unrestricted, so nothing but the tenant boundary can refuse it, and
      // the answer is the uniform not-found.
      const target = await operation.arrange(SCOPE_TENANT_B);
      await expectRefusal(operation, target, PRINCIPAL_TENANT_WIDE_PERMISSION, 404);

      // The tenant-B resource really was actionable all along: its own tenant
      // completes it. Without this the 404 above could have come from an
      // unusable fixture rather than from the boundary.
      authAs(SUBJ_TENANT_B, TENANT_B);
      const own = await operation.act(target, crypto.randomUUID());
      expect(own.status, `${id} in its own tenant`).toBe(operation.successStatus);
    });
  }
);
