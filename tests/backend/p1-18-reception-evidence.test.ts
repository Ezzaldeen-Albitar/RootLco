/**
 * Reception condition evidence, signatures and refusals, end to end (Phase 1-18,
 * P1-18-BE-011 … P1-18-BE-017).
 *
 * Drives the three real routes through the fixed pipeline on the least-privilege
 * `app_runtime` role. Everything here is about what a workshop can later prove
 * about a vehicle it took custody of, so the suite is written against the three
 * ways that proof can be destroyed:
 *
 *  - **evidence that never landed** — every success asserts the row is in the
 *    table it belongs in, counted, not merely that the response said 201;
 *  - **evidence that landed in the wrong place** — a finding whose inspection or
 *    a mark whose map belongs to a *different* reception visit must be refused as
 *    a missing resource, because the composite foreign keys only reach as far as
 *    the branch and would happily bind the evidence to another vehicle;
 *  - **evidence that was quietly rewritten** — prior evidence is read back after
 *    a second recording, and `rec.signatures` is attacked directly through the
 *    runtime pool with UPDATE and DELETE.
 *
 * Operations exercised here: rec.reception-condition-evidence,
 * rec.reception-signature, rec.reception-refusal.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   rec.reception-condition-evidence: route service authorization success denial cross-tenant isolation audit idempotency rollback
 *   rec.reception-signature: route service authorization success denial cross-tenant isolation audit idempotency
 *   rec.reception-refusal: route service authorization success denial cross-tenant isolation audit idempotency
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
  countRows,
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
import { POST as EVIDENCE } from '@/app/api/v1/receptions/[receptionId]/condition-evidence/route';
import { POST as SIGNATURE } from '@/app/api/v1/receptions/[receptionId]/signatures/route';
import { POST as REFUSAL } from '@/app/api/v1/receptions/[receptionId]/refusals/route';
import { POST as APPROVE } from '@/app/api/v1/receptions/[receptionId]/approve/route';

// --- Actors ----------------------------------------------------------------
/** Tenant A, unrestricted, holds evidence + signature + approve. */
const ROLE_FULL = 'c1180000-0000-4000-8000-0000000000a1';
const USER_FULL = 'c1180000-0000-4000-8000-0000000000a2';
const SUBJ_FULL = 'fx_p1_18_ev_full';
/** Tenant A, unrestricted, holds ONLY `rec.reception.evidence.manage`. */
const ROLE_EVID = 'c1180000-0000-4000-8000-0000000000a3';
const USER_EVID = 'c1180000-0000-4000-8000-0000000000a4';
const SUBJ_EVID = 'fx_p1_18_ev_evidence_only';
/** Tenant A, unrestricted, holds ONLY `rec.reception.signature.manage`. */
const ROLE_SIGN = 'c1180000-0000-4000-8000-0000000000a5';
const USER_SIGN = 'c1180000-0000-4000-8000-0000000000a6';
const SUBJ_SIGN = 'fx_p1_18_ev_signature_only';
/** Tenant A, same permissions, grant NARROWED to branch A2. */
const ROLE_B2 = 'c1180000-0000-4000-8000-0000000000a7';
const USER_B2 = 'c1180000-0000-4000-8000-0000000000a8';
const SUBJ_B2 = 'fx_p1_18_ev_branch_a2';
const GRANT_B2 = 'c1180000-0000-4000-8000-0000000000a9';
/** Tenant B, unrestricted, holds the very same permissions in its own tenant. */
const ROLE_TB = 'c1180000-0000-4000-8000-0000000000b1';
const USER_TB = 'c1180000-0000-4000-8000-0000000000b2';
const SUBJ_TB = 'fx_p1_18_ev_tenant_b';

// --- Organisation ----------------------------------------------------------
/** A second branch in tenant A's company: the isolation target. */
const BRANCH_A2 = 'a1100000-0000-4000-8000-000000000018';
const COMPANY_B1 = 'b1000000-0000-4000-8000-000000000018';
const BRANCH_B1 = 'b1100000-0000-4000-8000-000000000018';

// --- Reference data --------------------------------------------------------
const PARTNER_A = 'c1180000-0000-4000-8000-0000000000d1';
const PARTNER_B = 'c1180000-0000-4000-8000-0000000000d2';
const CATEGORY_A = 'c1180000-0000-4000-8000-0000000000e1';
/** The damage-map template document and its one version. */
const DOC_MAP = 'c1180000-0000-4000-8000-0000000000e2';
const VER_MAP = 'c1180000-0000-4000-8000-0000000000e3';
/** A second document, so "a version of another document" is a real row. */
const DOC_SIG = 'c1180000-0000-4000-8000-0000000000e4';
const VER_SIG = 'c1180000-0000-4000-8000-0000000000e5';
const LAMP = 'c1180000-0000-4000-8000-0000000000f1';
const REASON_ACTIVE = 'c1180000-0000-4000-8000-0000000000f2';
const REASON_INACTIVE = 'c1180000-0000-4000-8000-0000000000f3';

/**
 * What a full reception clerk holds.
 *
 * `iam.sensitive.view` is in this list because the database demands it, not
 * because the operation asks for it. Two of the eight evidence kinds write a
 * `restricted` narrative row — `rec.complaint_details` (the customer's own
 * words) and `rec.vehicle_content_details` (what was left in the car) — and the
 * frozen Phase 1-8 policies `ins_complaint_details_gated` and
 * `ins_vehicle_content_details_gated` both carry
 * `AND iam.has_permission('iam.sensitive.view')` in their WITH CHECK. The
 * `rec.reception-condition-evidence` registration declares only
 * `rec.reception.evidence.manage`, so that dependency is undeclared; see the
 * fail-closed case at the end of the condition-evidence block, which pins the
 * behaviour a caller without it actually gets today.
 */
const PERMISSIONS = [
  'rec.reception.evidence.manage',
  'rec.reception.signature.manage',
  'rec.reception.approve',
  'iam.sensitive.view',
] as const;

const R = 'http://localhost/api/v1/receptions';
/** 32 bytes of hex — `ck_document_versions_sha256_len`. */
const SHA_HEX = 'a'.repeat(64);

interface Body {
  readonly receptionVisitId?: string;
  readonly kind?: string;
  readonly evidenceId?: string;
  readonly signatureId?: string;
  readonly purpose?: string;
  readonly refusalId?: string;
  readonly refusalType?: string;
  readonly receptionStatus?: string;
  readonly code?: string;
}

let admin: Pool;
let runtime: Pool;

function authAs(subject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId,
    })
  );
}

// ---------------------------------------------------------------------------
// Route drivers. Every one of them is the exported handler, called with a real
// Request, so the whole pipeline (authenticate, resolve scope, authorize,
// transaction, idempotency) runs exactly as it does in the deployment.
// ---------------------------------------------------------------------------

function recordEvidence(
  receptionId: string,
  body: unknown,
  key = crypto.randomUUID()
): Promise<Response> {
  return EVIDENCE(
    new Request(`${R}/${receptionId}/condition-evidence`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ receptionId }) }
  );
}

function recordSignature(
  receptionId: string,
  body: unknown,
  key = crypto.randomUUID()
): Promise<Response> {
  return SIGNATURE(
    new Request(`${R}/${receptionId}/signatures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ receptionId }) }
  );
}

function recordRefusal(
  receptionId: string,
  body: unknown,
  key = crypto.randomUUID()
): Promise<Response> {
  return REFUSAL(
    new Request(`${R}/${receptionId}/refusals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': key },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ receptionId }) }
  );
}

function approve(receptionId: string, version: number): Promise<Response> {
  return APPROVE(
    new Request(`${R}/${receptionId}/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': String(version),
      },
      body: '{}',
    }),
    { params: Promise.resolve({ receptionId }) }
  );
}

const json = async (response: Response): Promise<Body> => (await response.json()) as Body;

/** A canonical signature body bound to DOC_SIG and its own version. */
function signatureBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    signerRole: 'service_requester',
    signerPartnerId: PARTNER_A,
    signatureDocumentId: DOC_SIG,
    signatureDocumentVersionId: VER_SIG,
    captureMethod: 'drawn',
    purpose: 'custody_acceptance',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Read-back counters. All admin, never RLS evidence — they answer "did the row
// land", which is the only thing that makes a COVERAGE-EVIDENCE flag true.
// ---------------------------------------------------------------------------

const complaints = (visit: string): Promise<number> =>
  countRows(admin, 'rec.complaints', 'reception_visit_id = $1', [visit]);
const complaintDetails = (visit: string): Promise<number> =>
  countRows(
    admin,
    'rec.complaint_details',
    'complaint_id IN (SELECT id FROM rec.complaints WHERE reception_visit_id = $1)',
    [visit]
  );
const inspections = (visit: string): Promise<number> =>
  countRows(admin, 'rec.visual_inspections', 'reception_visit_id = $1', [visit]);
const conditionItems = (visit: string): Promise<number> =>
  countRows(
    admin,
    'rec.condition_items',
    'inspection_id IN (SELECT id FROM rec.visual_inspections WHERE reception_visit_id = $1)',
    [visit]
  );
const damageMaps = (visit: string): Promise<number> =>
  countRows(admin, 'rec.damage_maps', 'reception_visit_id = $1', [visit]);
const damageMarks = (visit: string): Promise<number> =>
  countRows(
    admin,
    'rec.damage_marks',
    'damage_map_id IN (SELECT id FROM rec.damage_maps WHERE reception_visit_id = $1)',
    [visit]
  );
const contents = (visit: string): Promise<number> =>
  countRows(admin, 'rec.vehicle_contents', 'reception_visit_id = $1', [visit]);
const contentDetails = (visit: string): Promise<number> =>
  countRows(
    admin,
    'rec.vehicle_content_details',
    'content_id IN (SELECT id FROM rec.vehicle_contents WHERE reception_visit_id = $1)',
    [visit]
  );
const warningLights = (visit: string): Promise<number> =>
  countRows(admin, 'rec.warning_light_observations', 'reception_visit_id = $1', [visit]);
const leaks = (visit: string): Promise<number> =>
  countRows(admin, 'rec.leak_observations', 'reception_visit_id = $1', [visit]);
const signatures = (visit: string): Promise<number> =>
  countRows(admin, 'rec.signatures', 'reception_visit_id = $1', [visit]);
const refusals = (visit: string): Promise<number> =>
  countRows(admin, 'rec.refusals', 'reception_visit_id = $1', [visit]);

/** Every table `recordConditionEvidence` can write, summed. */
async function allEvidenceRows(visit: string): Promise<number> {
  const counts = await Promise.all([
    complaints(visit),
    complaintDetails(visit),
    inspections(visit),
    conditionItems(visit),
    damageMaps(visit),
    damageMarks(visit),
    contents(visit),
    contentDetails(visit),
    warningLights(visit),
    leaks(visit),
  ]);
  return counts.reduce((total, value) => total + value, 0);
}

const auditCount = (action: string, entityId: string): Promise<number> =>
  countRows(admin, 'iam.audit_records', 'action = $1 AND entity_id = $2', [action, entityId]);

/** Audit records filed against ANY row of a table, for a given visit's subtree. */
const auditCountIn = (action: string, subquery: string, visit: string): Promise<number> =>
  countRows(admin, 'iam.audit_records', `action = $1 AND entity_id IN (${subquery})`, [
    action,
    visit,
  ]);

/**
 * Moves a visit along the frozen graph as a fixture step.
 *
 * `rec.emit_reception_status_history` refuses to record a transition with no
 * actor in the session context, so the actor is set exactly as the application
 * sets it. The fixture obeys the same contract every legitimate writer does.
 */
async function setVisitStatus(visit: string, status: string): Promise<void> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query('UPDATE rec.reception_visits SET reception_status = $2 WHERE id = $1', [
      visit,
      status,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function visitStatus(visit: string): Promise<{ status: string; version: number }> {
  const result = await admin.query<{ reception_status: string; record_version: number }>(
    'SELECT reception_status, record_version FROM rec.reception_visits WHERE id = $1',
    [visit]
  );
  const row = result.rows[0];
  return { status: row?.reception_status ?? '', version: row?.record_version ?? 0 };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Opens a real reception visit through the frozen `rec.accept_check_in()`
 * primitive, so the visit, its mandatory `service_requester` party role, the
 * accepted custody event, and the first status-history row all exist exactly as
 * a genuine check-in leaves them. A fresh vehicle per visit, because
 * `uq_reception_visits_open_vehicle` allows a vehicle only one live visit.
 */
let vinSeq = 0;
async function newVisit(
  options: {
    readonly tenantId?: string;
    readonly companyId?: string;
    readonly branchId?: string;
    readonly partnerId?: string;
  } = {}
): Promise<string> {
  const tenantId = options.tenantId ?? TENANT_A;
  const companyId = options.companyId ?? COMPANY_A1;
  const branchId = options.branchId ?? BRANCH_A1;
  const partnerId = options.partnerId ?? PARTNER_A;
  vinSeq += 1;
  const vin = `P118EV${String(vinSeq).padStart(11, '0')}`;

  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, tenantId]
    );
    const vehicle = (
      await client.query<{ id: string }>(
        `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
         VALUES ($1,$2,'ice','active',$3) RETURNING id`,
        [tenantId, vin, USER_A]
      )
    ).rows[0]!.id;
    const walkIn = (
      await client.query<{ id: string }>(
        `INSERT INTO rec.walk_in_references
           (tenant_id, company_id, branch_id, vehicle_id, requester_partner_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [tenantId, companyId, branchId, vehicle, partnerId, USER_A]
      )
    ).rows[0]!.id;
    const visit = (
      await client.query<{ id: string }>(
        `SELECT rec.accept_check_in($1::uuid,$2::uuid,$3::uuid,NULL::uuid,$4::uuid,$5::uuid,$6::uuid) AS id`,
        [companyId, branchId, vehicle, walkIn, USER_A, partnerId]
      )
    ).rows[0]!.id;
    await client.query('COMMIT');
    return visit;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedActor(input: {
  readonly tenantId: string;
  readonly roleId: string;
  readonly userId: string;
  readonly subject: string;
  readonly permissions: readonly string[];
  readonly scoped?: {
    readonly grantId: string;
    readonly companyId: string;
    readonly branchId: string;
  };
}): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-18 evidence actor','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [input.userId, input.tenantId, IDENTITY_PROVIDER, input.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-18 evidence role',$4) ON CONFLICT (id) DO NOTHING`,
    [input.roleId, input.tenantId, input.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [input.tenantId, input.roleId, USER_A, [...input.permissions]]
  );

  if (!input.scoped) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [input.tenantId, input.userId, input.roleId, USER_A]
    );
    return;
  }

  // The "a scoped grant needs a scope" trigger is DEFERRABLE INITIALLY DEFERRED,
  // so the grant and both scope rows must land in one transaction.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [input.scoped.grantId, input.tenantId, input.userId, input.roleId, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
       VALUES ($1,$2,'company',$3,$4)`,
      [input.tenantId, input.scoped.grantId, input.scoped.companyId, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [input.tenantId, input.scoped.grantId, input.scoped.companyId, input.scoped.branchId, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function seedDocument(documentId: string, versionId: string, title: string): Promise<void> {
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, category_id, title, classification, retention_class, status, created_by)
     VALUES ($1,$2,$3,$4,'internal','evidence-audit','pending',$5)
     ON CONFLICT (id) DO NOTHING`,
    [documentId, TENANT_A, CATEGORY_A, title, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type,
        size_bytes, sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,1,$4,'application/pdf',1024, decode($5,'hex'), $6, $6)
     ON CONFLICT (id) DO NOTHING`,
    [versionId, TENANT_A, documentId, `p118-ev/${documentId}`, SHA_HEX, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  // The reception permission codes exist in the seeded catalog file; the local
  // database is provisioned from the frozen Release 2 baseline, so they are
  // inserted here rather than assumed. `ON CONFLICT DO NOTHING` means a database
  // that already carries them is used as-is.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('rec.reception.evidence.manage','rec','Record pre-service condition evidence on a reception','medium',$1),
            ('rec.reception.signature.manage','rec','Capture reception signatures and refusals','high',$1),
            ('rec.reception.approve','rec','Approve a reception visit for work','high',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  // A second branch in tenant A, and a real company/branch in tenant B: both
  // isolation and cross-tenant have to address rows that genuinely exist.
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_a2_p118','Fixture Branch A2','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'company_b1_p118','Fixture Company B1','USD',$3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B1, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_b1_p118','Fixture Branch B1','UTC',$4)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B1, TENANT_B, COMPANY_B1, USER_A]
  );

  await seedActor({
    tenantId: TENANT_A,
    roleId: ROLE_FULL,
    userId: USER_FULL,
    subject: SUBJ_FULL,
    permissions: PERMISSIONS,
  });
  await seedActor({
    tenantId: TENANT_A,
    roleId: ROLE_EVID,
    userId: USER_EVID,
    subject: SUBJ_EVID,
    permissions: ['rec.reception.evidence.manage'],
  });
  await seedActor({
    tenantId: TENANT_A,
    roleId: ROLE_SIGN,
    userId: USER_SIGN,
    subject: SUBJ_SIGN,
    permissions: ['rec.reception.signature.manage'],
  });
  await seedActor({
    tenantId: TENANT_A,
    roleId: ROLE_B2,
    userId: USER_B2,
    subject: SUBJ_B2,
    permissions: PERMISSIONS,
    scoped: { grantId: GRANT_B2, companyId: COMPANY_A1, branchId: BRANCH_A2 },
  });
  await seedActor({
    tenantId: TENANT_B,
    roleId: ROLE_TB,
    userId: USER_TB,
    subject: SUBJ_TB,
    permissions: PERMISSIONS,
  });

  // Partners. The crm triggers stamp their actor from `app.user_id`, so the
  // fixture runs inside a context-set transaction exactly as the application does.
  for (const [partnerId, tenantId, name] of [
    [PARTNER_A, TENANT_A, 'Reception Requester A'],
    [PARTNER_B, TENANT_B, 'Reception Requester B'],
  ] as const) {
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, tenantId]
      );
      await client.query(
        `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
         VALUES ($1,$2,'individual',$3,'active',$4) ON CONFLICT (id) DO NOTHING`,
        [partnerId, tenantId, name, USER_A]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  await admin.query(
    `INSERT INTO shared.document_categories
       (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
        default_classification, default_retention_class, created_by)
     VALUES ($1,'tenant',$2,'p118_ev_docs','P1-18 evidence documents',
             ARRAY['application/pdf']::text[], 1048576, 'internal', 'evidence-audit', $3)
     ON CONFLICT (id) DO NOTHING`,
    [CATEGORY_A, TENANT_A, USER_A]
  );
  await seedDocument(DOC_MAP, VER_MAP, 'P1-18 damage map template');
  await seedDocument(DOC_SIG, VER_SIG, 'P1-18 signature capture');

  await admin.query(
    `INSERT INTO rec.warning_light_codes (id, scope, tenant_id, code, name, created_by)
     VALUES ($1,'platform',NULL,'fx_p118_ev_engine','Engine warning lamp',$2)
     ON CONFLICT (id) DO NOTHING`,
    [LAMP, USER_A]
  );
  await admin.query(
    `INSERT INTO rec.refusal_reasons (id, scope, tenant_id, code, name, status, created_by)
     VALUES ($1,'platform',NULL,'fx_p118_ev_declined','Customer declined','active',$3),
            ($2,'platform',NULL,'fx_p118_ev_retired','Retired reason','inactive',$3)
     ON CONFLICT (id) DO NOTHING`,
    [REASON_ACTIVE, REASON_INACTIVE, USER_A]
  );

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

// ===========================================================================
// Authorization
// ===========================================================================
describe('authorization', () => {
  it('refuses all three routes with 401 when no session is installed, writing nothing', async () => {
    const visit = await newVisit();
    __resetAuthenticatorForTests();

    expect(
      (
        await recordEvidence(visit, {
          kind: 'complaint',
          category: 'noise',
          complaintText: 'unauthenticated',
        })
      ).status
    ).toBe(401);
    expect((await recordSignature(visit, signatureBody())).status).toBe(401);
    expect((await recordRefusal(visit, { refusalType: 'signature' })).status).toBe(401);

    expect(await allEvidenceRows(visit)).toBe(0);
    expect(await signatures(visit)).toBe(0);
    expect(await refusals(visit)).toBe(0);
  });

  it('refuses all three routes with 403 for a principal holding no reception permission', async () => {
    const visit = await newVisit();
    authAs(SUBJECT_UNPERMITTED);

    expect(
      (
        await recordEvidence(visit, {
          kind: 'complaint',
          category: 'noise',
          complaintText: 'unpermitted',
        })
      ).status
    ).toBe(403);
    expect((await recordSignature(visit, signatureBody())).status).toBe(403);
    expect((await recordRefusal(visit, { refusalType: 'signature' })).status).toBe(403);

    expect(await allEvidenceRows(visit)).toBe(0);
    expect(await signatures(visit)).toBe(0);
    expect(await refusals(visit)).toBe(0);
  });

  /**
   * The separation the route files claim in prose, asserted.
   *
   * Condition evidence carries `rec.reception.evidence.manage`; signature and
   * refusal carry `rec.reception.signature.manage`, which is a *high*-risk code.
   * Every other test in this file authenticates as SUBJ_FULL, which holds both —
   * so folding signature capture into the evidence permission would leave the
   * whole suite green while a caller with intake-only authority could sign on a
   * customer's behalf. These two cases are what make the split load-bearing.
   */
  it('refuses signature and refusal to an evidence-only principal, and evidence to a signature-only one', async () => {
    const visit = await newVisit();

    authAs(SUBJ_EVID);
    const signatureDenied = await recordSignature(visit, signatureBody());
    expect(signatureDenied.status).toBe(403);
    expect((await json(signatureDenied)).code).toBe('ERR-IAM-001');
    expect((await recordRefusal(visit, { refusalType: 'signature' })).status).toBe(403);
    // The same principal genuinely can record condition evidence, so the two
    // refusals above are about the permission and not about a broken fixture.
    // A leak observation is used rather than a complaint because this principal
    // deliberately holds no `iam.sensitive.view`, and a complaint writes a
    // `restricted` narrative row the database gates on it.
    expect(
      (
        await recordEvidence(visit, {
          kind: 'leak',
          leakType: 'water',
          vehicleZone: 'boot_floor',
        })
      ).status
    ).toBe(201);

    authAs(SUBJ_SIGN);
    const evidenceDenied = await recordEvidence(visit, {
      kind: 'complaint',
      category: 'noise',
      complaintText: 'signature-only principal may not record this',
    });
    expect(evidenceDenied.status).toBe(403);
    expect((await json(evidenceDenied)).code).toBe('ERR-IAM-001');
    expect((await recordSignature(visit, signatureBody())).status).toBe(201);

    // Exactly the two permitted recordings landed: the evidence-only principal's
    // leak and the signature-only principal's signature. Nothing the other four
    // attempts asked for exists.
    expect(await leaks(visit)).toBe(1);
    expect(await signatures(visit)).toBe(1);
    expect(await complaints(visit)).toBe(0);
    expect(await refusals(visit)).toBe(0);
  });
});

// ===========================================================================
// rec.reception-condition-evidence
// ===========================================================================
describe('rec.reception-condition-evidence', () => {
  it('records every one of the eight evidence kinds into its own table, and audits each', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();

    const complaint = await recordEvidence(visit, {
      kind: 'complaint',
      category: 'mechanical',
      severity: 'high',
      complaintText: 'A knocking noise under load.',
      reportedByPartnerId: PARTNER_A,
    });
    expect(complaint.status).toBe(201);
    expect((await json(complaint)).kind).toBe('complaint');

    const inspection = await recordEvidence(visit, { kind: 'inspection', inspectorId: USER_A });
    expect(inspection.status).toBe(201);
    const inspectionId = (await json(inspection)).evidenceId ?? '';

    const item = await recordEvidence(visit, {
      kind: 'condition_item',
      inspectionId,
      findingCategory: 'scratch',
      vehicleZone: 'left_front_door',
      severity: 'moderate',
      findingNote: 'Two parallel scratches.',
    });
    expect(item.status).toBe(201);

    const map = await recordEvidence(visit, {
      kind: 'damage_map',
      documentId: DOC_MAP,
      documentVersionId: VER_MAP,
      mapType: 'exterior',
      perspective: 'front',
    });
    expect(map.status).toBe(201);
    const damageMapId = (await json(map)).evidenceId ?? '';

    const mark = await recordEvidence(visit, {
      kind: 'damage_mark',
      damageMapId,
      markType: 'dent',
      vehicleZone: 'front_bumper',
      coordX: 0.25,
      coordY: 0.75,
      note: 'Shallow dent.',
    });
    expect(mark.status).toBe(201);

    const content = await recordEvidence(visit, {
      kind: 'contents',
      itemDescription: 'Child seat',
      quantity: 1,
      location: 'rear bench',
      declaredValue: 120,
      declaredCurrency: 'USD',
      declaredByPartnerId: PARTNER_A,
    });
    expect(content.status).toBe(201);

    const lamp = await recordEvidence(visit, {
      kind: 'warning_light',
      warningLightCodeId: LAMP,
      observedState: 'flashing',
    });
    expect(lamp.status).toBe(201);

    const leak = await recordEvidence(visit, {
      kind: 'leak',
      leakType: 'oil',
      vehicleZone: 'engine_bay',
      severity: 'minor',
    });
    expect(leak.status).toBe(201);

    // One row per kind, in the table that kind belongs to — including the two
    // `restricted` detail rows that a caller never sees back.
    expect(await complaints(visit)).toBe(1);
    expect(await complaintDetails(visit)).toBe(1);
    expect(await inspections(visit)).toBe(1);
    expect(await conditionItems(visit)).toBe(1);
    expect(await damageMaps(visit)).toBe(1);
    expect(await damageMarks(visit)).toBe(1);
    expect(await contents(visit)).toBe(1);
    expect(await contentDetails(visit)).toBe(1);
    expect(await warningLights(visit)).toBe(1);
    expect(await leaks(visit)).toBe(1);

    // One audit record per recording, all filed against the visit.
    expect(await auditCount('rec.reception.evidence_recorded', visit)).toBe(8);
  });

  it('refuses a damage mark outside the 0..1 coordinate box on either axis', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();
    const damageMapId =
      (
        await json(
          await recordEvidence(visit, {
            kind: 'damage_map',
            documentId: DOC_MAP,
            documentVersionId: VER_MAP,
            mapType: 'exterior',
          })
        )
      ).evidenceId ?? '';

    const outX = await recordEvidence(visit, {
      kind: 'damage_mark',
      damageMapId,
      markType: 'scratch',
      vehicleZone: 'roof',
      coordX: 1.5,
      coordY: 0.5,
    });
    expect(outX.status).toBe(422);
    expect((await json(outX)).code).toBe('ERR-VAL-001');

    const outY = await recordEvidence(visit, {
      kind: 'damage_mark',
      damageMapId,
      markType: 'scratch',
      vehicleZone: 'roof',
      coordX: 0.5,
      coordY: -0.1,
    });
    expect(outY.status).toBe(422);
    expect((await json(outY)).code).toBe('ERR-VAL-001');

    expect(await damageMarks(visit)).toBe(0);
    // A mark placed at the boundary is legal, so the two refusals are about the
    // range and not about marks being unrecordable.
    expect(
      (
        await recordEvidence(visit, {
          kind: 'damage_mark',
          damageMapId,
          markType: 'scratch',
          vehicleZone: 'roof',
          coordX: 0,
          coordY: 1,
        })
      ).status
    ).toBe(201);
    expect(await damageMarks(visit)).toBe(1);
  });

  // The same shape as the coordinate case above, for the two numerics that were
  // bounded on one side only. `rec.vehicle_contents.quantity` is `integer` and
  // `rec.vehicle_content_details.declared_value` is `numeric(14, 2)`; the frozen
  // CHECKs give a floor (`> 0`, `>= 0`) and nothing else, so a large number used
  // to reach PostgreSQL and come back as SQLSTATE 22003 — which nothing maps, so
  // an authenticated caller could turn a typo into a 500 and a monitoring
  // incident. The at-the-limit control is the half that matters: it proves the
  // ceilings are the columns' own and not a guess tightened past them.
  it('refuses contents numerics past their column ceilings and accepts them at the ceiling', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();

    const bigQuantity = await recordEvidence(visit, {
      kind: 'contents',
      itemDescription: 'Cargo pallets',
      quantity: 3_000_000_000,
    });
    expect(bigQuantity.status).toBe(422);
    expect((await json(bigQuantity)).code).toBe('ERR-VAL-001');

    const bigValue = await recordEvidence(visit, {
      kind: 'contents',
      itemDescription: 'Sealed case',
      declaredValue: 1e13,
      declaredCurrency: 'USD',
    });
    expect(bigValue.status).toBe(422);
    expect((await json(bigValue)).code).toBe('ERR-VAL-001');

    // Neither refusal wrote anything — not the parent row, and not the
    // `restricted` detail row that carries the value.
    expect(await contents(visit)).toBe(0);
    expect(await contentDetails(visit)).toBe(0);

    const atCeiling = await recordEvidence(visit, {
      kind: 'contents',
      itemDescription: 'Cargo pallets',
      quantity: 2_147_483_647,
      declaredValue: 999_999_999_999.99,
      declaredCurrency: 'USD',
    });
    expect(atCeiling.status).toBe(201);
    expect(await contents(visit)).toBe(1);
    expect(await contentDetails(visit)).toBe(1);
  });

  it('refuses a finding on an inspection that is no longer in progress', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();
    const inspectionId =
      (await json(await recordEvidence(visit, { kind: 'inspection', inspectorId: USER_A })))
        .evidenceId ?? '';

    // Completing the inspection is not a P1-18 endpoint; the state is set
    // directly so `rec.guard_condition_item_open` is what the test measures.
    await admin.query(
      `UPDATE rec.visual_inspections
          SET inspection_status = 'completed', completed_at = now()
        WHERE id = $1`,
      [inspectionId]
    );

    const refused = await recordEvidence(visit, {
      kind: 'condition_item',
      inspectionId,
      findingCategory: 'dent',
      vehicleZone: 'tailgate',
    });
    expect(refused.status).toBe(422);
    expect((await json(refused)).code).toBe('ERR-VAL-001');
    expect(await conditionItems(visit)).toBe(0);
  });

  it('refuses a damage map bound to a version that belongs to a different document', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();

    const refused = await recordEvidence(visit, {
      kind: 'damage_map',
      documentId: DOC_MAP,
      // A real, visible version of tenant A — but of the OTHER document.
      documentVersionId: VER_SIG,
      mapType: 'exterior',
    });
    expect(refused.status).toBe(422);
    expect((await json(refused)).code).toBe('ERR-VAL-001');
    expect(await damageMaps(visit)).toBe(0);
  });

  /**
   * The parent-scoping hole.
   *
   * `rec.condition_items` keys on (tenant, company, branch, inspection) and
   * `rec.damage_marks` on (tenant, company, branch, map), so a parent belonging to
   * a DIFFERENT visit in the same branch satisfies every foreign key. Nothing in
   * the schema stops a finding about one customer's car from being filed under
   * another's; only the module's own visit-scoped resolve does, and it must answer
   * as if the parent did not exist rather than surfacing a constraint error.
   */
  it('refuses an inspection or damage map that belongs to another reception visit, as a 404', async () => {
    authAs(SUBJ_FULL);
    const other = await newVisit();
    const visit = await newVisit();

    const foreignInspection =
      (await json(await recordEvidence(other, { kind: 'inspection', inspectorId: USER_A })))
        .evidenceId ?? '';
    const foreignMap =
      (
        await json(
          await recordEvidence(other, {
            kind: 'damage_map',
            documentId: DOC_MAP,
            documentVersionId: VER_MAP,
            mapType: 'interior',
          })
        )
      ).evidenceId ?? '';
    expect(foreignInspection).toBeTruthy();
    expect(foreignMap).toBeTruthy();

    const itemElsewhere = await recordEvidence(visit, {
      kind: 'condition_item',
      inspectionId: foreignInspection,
      findingCategory: 'crack',
      vehicleZone: 'windscreen',
    });
    expect(itemElsewhere.status).toBe(404);
    expect((await json(itemElsewhere)).code).toBe('ERR-RES-001');

    const markElsewhere = await recordEvidence(visit, {
      kind: 'damage_mark',
      damageMapId: foreignMap,
      markType: 'rust',
      vehicleZone: 'sill',
      coordX: 0.1,
      coordY: 0.1,
    });
    expect(markElsewhere.status).toBe(404);
    expect((await json(markElsewhere)).code).toBe('ERR-RES-001');

    // Nothing was grafted onto the other visit's inspection or map either.
    expect(await conditionItems(other)).toBe(0);
    expect(await damageMarks(other)).toBe(0);
    expect(await conditionItems(visit)).toBe(0);
    expect(await damageMarks(visit)).toBe(0);
  });

  it('never overwrites prior evidence: a second complaint leaves the first intact', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();

    const first = await json(
      await recordEvidence(visit, {
        kind: 'complaint',
        category: 'noise',
        complaintText: 'Rattle over speed bumps.',
      })
    );
    const second = await json(
      await recordEvidence(visit, {
        kind: 'complaint',
        category: 'electrical',
        severity: 'critical',
        complaintText: 'Headlights flicker at idle.',
      })
    );
    expect(first.evidenceId).toBeTruthy();
    expect(second.evidenceId).not.toBe(first.evidenceId);

    expect(await complaints(visit)).toBe(2);
    expect(await complaintDetails(visit)).toBe(2);
    const texts = await admin.query<{ complaint_text: string }>(
      `SELECT d.complaint_text FROM rec.complaint_details d
         JOIN rec.complaints c ON c.id = d.complaint_id
        WHERE c.reception_visit_id = $1 ORDER BY d.created_at`,
      [visit]
    );
    expect(texts.rows.map((row) => row.complaint_text)).toEqual([
      'Rattle over speed bumps.',
      'Headlights flicker at idle.',
    ]);
  });

  it('refuses a second observation of the same warning lamp, and evidence on a terminal reception', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();
    expect(
      (await recordEvidence(visit, { kind: 'warning_light', warningLightCodeId: LAMP })).status
    ).toBe(201);
    const duplicate = await recordEvidence(visit, {
      kind: 'warning_light',
      warningLightCodeId: LAMP,
      observedState: 'flashing',
    });
    expect(duplicate.status).toBe(409);
    expect((await json(duplicate)).code).toBe('ERR-RES-002');
    expect(await warningLights(visit)).toBe(1);

    // `closed_without_work` is terminal, so the visit is closed to further
    // evidence — the reception is over and its record is what it is. Closing it
    // is not one of the three operations under test, so it is done directly; the
    // actor context is set because the status-history trigger insists on one,
    // which is itself the frozen contract this fixture must not bypass.
    await setVisitStatus(visit, 'closed_without_work');
    const late = await recordEvidence(visit, {
      kind: 'leak',
      leakType: 'coolant',
      vehicleZone: 'engine_bay',
    });
    expect(late.status).toBe(409);
    expect((await json(late)).code).toBe('ERR-TRN-001');
    expect(await leaks(visit)).toBe(0);
  });

  it('replays an identical idempotency key without recording a second complaint', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();
    const key = crypto.randomUUID();
    const body = {
      kind: 'complaint',
      category: 'performance',
      complaintText: 'Loses power on inclines.',
    };

    const first = await json(await recordEvidence(visit, body, key));
    const replay = await json(await recordEvidence(visit, body, key));
    expect(first.evidenceId).toBeTruthy();
    expect(replay.evidenceId).toBe(first.evidenceId);

    expect(await complaints(visit)).toBe(1);
    expect(await complaintDetails(visit)).toBe(1);
    expect(await auditCount('rec.reception.evidence_recorded', visit)).toBe(1);
  });

  /**
   * Contents is the two-row kind: the metadata row and the `restricted`
   * description row are one decision. A declared currency with no declared value
   * fails `ck_vehicle_content_details_currency` on the SECOND insert, after the
   * first has already landed inside the transaction — which is exactly the shape
   * that leaves a half-written contents record if the two are not atomic.
   */
  it('rolls back a failed contents recording, leaving no row in either table and no audit', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();

    const failed = await recordEvidence(visit, {
      kind: 'contents',
      itemDescription: 'Laptop bag',
      quantity: 1,
      declaredCurrency: 'USD',
    });
    expect(failed.status).toBe(422);
    expect((await json(failed)).code).toBe('ERR-VAL-001');

    expect(await contents(visit)).toBe(0);
    expect(await contentDetails(visit)).toBe(0);
    expect(await auditCount('rec.reception.evidence_recorded', visit)).toBe(0);

    // The same body with a value commits, so the rollback above is about the
    // injected failure rather than about contents being unrecordable.
    expect(
      (
        await recordEvidence(visit, {
          kind: 'contents',
          itemDescription: 'Laptop bag',
          quantity: 1,
          declaredValue: 500,
          declaredCurrency: 'USD',
        })
      ).status
    ).toBe(201);
    expect(await contents(visit)).toBe(1);
    expect(await contentDetails(visit)).toBe(1);
  });

  it('refuses a tenant-A principal recording evidence on a real tenant-B reception, writing nothing', async () => {
    // A genuine tenant-B visit with a genuine tenant-B requester, opened through
    // the same primitive — not a random id that belongs to nobody.
    const theirVisit = await newVisit({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      partnerId: PARTNER_B,
    });

    authAs(SUBJ_FULL);
    const refused = await recordEvidence(theirVisit, {
      kind: 'complaint',
      category: 'body',
      complaintText: 'Reaching across the tenant boundary.',
    });
    expect(refused.status).toBe(404);
    expect((await json(refused)).code).toBe('ERR-RES-001');
    expect(await allEvidenceRows(theirVisit)).toBe(0);
    expect(await auditCount('rec.reception.evidence_recorded', theirVisit)).toBe(0);

    // And the reverse: a tenant-B principal holding the very same permission in
    // its own tenant cannot reach a tenant-A reception, so authorization passes
    // and only the tenant filter can be what refuses.
    const ourVisit = await newVisit();
    authAs(SUBJ_TB, TENANT_B);
    const reverse = await recordEvidence(ourVisit, {
      kind: 'complaint',
      category: 'body',
      complaintText: 'Reaching back the other way.',
    });
    expect(reverse.status).toBe(404);
    expect(await allEvidenceRows(ourVisit)).toBe(0);

    // The tenant-B principal genuinely can record on its own visit.
    expect(
      (
        await recordEvidence(theirVisit, {
          kind: 'complaint',
          category: 'body',
          complaintText: 'Their own reception, their own tenant.',
        })
      ).status
    ).toBe(201);
    expect(await complaints(theirVisit)).toBe(1);
  });

  it('refuses a branch-A2-scoped principal recording evidence on a branch-A1 reception', async () => {
    const inA1 = await newVisit({ branchId: BRANCH_A1 });
    const inA2 = await newVisit({ branchId: BRANCH_A2 });

    authAs(SUBJ_B2);
    const refused = await recordEvidence(inA1, {
      kind: 'complaint',
      category: 'other',
      complaintText: 'Out of the caller branch.',
    });
    expect(refused.status).toBe(404);
    expect((await json(refused)).code).toBe('ERR-RES-001');
    expect(await allEvidenceRows(inA1)).toBe(0);
    expect(await auditCount('rec.reception.evidence_recorded', inA1)).toBe(0);

    // Same principal, same permission, same tenant — inside its own branch it
    // works, so the refusal above is scope narrowing and nothing else.
    expect(
      (
        await recordEvidence(inA2, {
          kind: 'complaint',
          category: 'other',
          complaintText: 'Inside the caller branch.',
        })
      ).status
    ).toBe(201);
    expect(await complaints(inA2)).toBe(1);
  });

  /**
   * The undeclared permission dependency, pinned fail-closed.
   *
   * `rec.reception-condition-evidence` declares `rec.reception.evidence.manage`
   * and nothing else, but a `complaint` writes the customer's own words into
   * `rec.complaint_details`, whose frozen INSERT policy also demands
   * `iam.sensitive.view`. A caller holding exactly the declared permission
   * therefore cannot record a complaint at all.
   *
   * Two things are asserted: the refusal is reported as a DENIAL (403,
   * `ERR-IAM-001`, via the `insufficientPrivilege` branch of
   * `mapEvidenceFailure`) rather than as a server fault, and the write does not
   * land in either table with no audit record claiming it did.
   *
   * The status assertion is load-bearing. Before the mapping existed the RLS
   * refusal escaped unmapped and the caller received 500 / ERR-SYS-001 — an
   * authorization outcome reported as a server fault, which any authenticated
   * caller could have triggered at will to manufacture exception-monitor
   * incidents. Pinning 403 here is what stops that regressing.
   */
  it('fails closed for a caller without iam.sensitive.view: denial, and no restricted complaint row', async () => {
    authAs(SUBJ_EVID);
    const visit = await newVisit();

    const response = await recordEvidence(visit, {
      kind: 'complaint',
      category: 'noise',
      complaintText: 'The customer said the brakes squeal.',
    });
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe('ERR-IAM-001');
    expect(await complaints(visit)).toBe(0);
    expect(await complaintDetails(visit)).toBe(0);
    expect(await auditCount('rec.reception.evidence_recorded', visit)).toBe(0);
  });
});

// ===========================================================================
// rec.reception-signature
// ===========================================================================
describe('rec.reception-signature', () => {
  it('records a signature against an exact document version, audits it, and replays idempotently', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();
    const key = crypto.randomUUID();

    const first = await recordSignature(
      visit,
      signatureBody({ signatureHash: 'ab'.repeat(32) }),
      key
    );
    expect(first.status).toBe(201);
    const created = await json(first);
    expect(created.signatureId).toBeTruthy();
    expect(created.purpose).toBe('custody_acceptance');

    const replay = await json(
      await recordSignature(visit, signatureBody({ signatureHash: 'ab'.repeat(32) }), key)
    );
    expect(replay.signatureId).toBe(created.signatureId);

    expect(await signatures(visit)).toBe(1);
    expect(await auditCount('rec.reception.signature_recorded', created.signatureId ?? '')).toBe(1);

    const stored = await admin.query<{
      signature_document_id: string;
      signature_document_version_id: string;
      hash_bytes: number;
    }>(
      `SELECT signature_document_id, signature_document_version_id,
              octet_length(signature_hash) AS hash_bytes
         FROM rec.signatures WHERE id = $1`,
      [created.signatureId]
    );
    expect(stored.rows[0]?.signature_document_id).toBe(DOC_SIG);
    expect(stored.rows[0]?.signature_document_version_id).toBe(VER_SIG);
    expect(Number(stored.rows[0]?.hash_bytes)).toBe(32);
  });

  it('refuses a signature version that belongs to another document, and a malformed hash', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();

    const wrongVersion = await recordSignature(
      visit,
      signatureBody({ signatureDocumentId: DOC_SIG, signatureDocumentVersionId: VER_MAP })
    );
    expect(wrongVersion.status).toBe(422);
    expect((await json(wrongVersion)).code).toBe('ERR-VAL-001');

    const badHash = await recordSignature(visit, signatureBody({ signatureHash: 'NOTHEX' }));
    expect(badHash.status).toBe(422);
    expect((await json(badHash)).code).toBe('ERR-VAL-001');

    const longHash = await recordSignature(
      visit,
      signatureBody({ signatureHash: 'ab'.repeat(65) })
    );
    expect(longHash.status).toBe(422);
    expect((await json(longHash)).code).toBe('ERR-VAL-001');

    expect(await signatures(visit)).toBe(0);
  });

  it('is append-only: the runtime role may neither update nor delete a recorded signature', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();
    const signatureId =
      (await json(await recordSignature(visit, signatureBody()))).signatureId ?? '';
    expect(signatureId).toBeTruthy();

    // The deployed identity itself, not a simulated missing grant.
    expect(
      await expectSqlState(
        runtime.query('UPDATE rec.signatures SET purpose = $2 WHERE id = $1', [
          signatureId,
          'other',
        ]),
        '42501'
      )
    ).toBe('42501');
    expect(
      await expectSqlState(
        runtime.query('DELETE FROM rec.signatures WHERE id = $1', [signatureId]),
        '42501'
      )
    ).toBe('42501');

    const survived = await admin.query<{ purpose: string }>(
      'SELECT purpose FROM rec.signatures WHERE id = $1',
      [signatureId]
    );
    expect(survived.rowCount).toBe(1);
    expect(survived.rows[0]?.purpose).toBe('custody_acceptance');
    expect(await signatures(visit)).toBe(1);
  });

  it('refuses a tenant-A principal signing on a real tenant-B reception, writing nothing', async () => {
    const theirVisit = await newVisit({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      partnerId: PARTNER_B,
    });

    authAs(SUBJ_FULL);
    const refused = await recordSignature(theirVisit, signatureBody({ signerPartnerId: null }));
    expect(refused.status).toBe(404);
    expect((await json(refused)).code).toBe('ERR-RES-001');
    expect(await signatures(theirVisit)).toBe(0);
    expect(
      await auditCountIn(
        'rec.reception.signature_recorded',
        'SELECT id FROM rec.signatures WHERE reception_visit_id = $2',
        theirVisit
      )
    ).toBe(0);
  });

  it('refuses a branch-A2-scoped principal signing on a branch-A1 reception', async () => {
    const inA1 = await newVisit({ branchId: BRANCH_A1 });
    const inA2 = await newVisit({ branchId: BRANCH_A2 });

    authAs(SUBJ_B2);
    const refused = await recordSignature(inA1, signatureBody());
    expect(refused.status).toBe(404);
    expect((await json(refused)).code).toBe('ERR-RES-001');
    expect(await signatures(inA1)).toBe(0);

    expect((await recordSignature(inA2, signatureBody())).status).toBe(201);
    expect(await signatures(inA2)).toBe(1);
  });
});

// ===========================================================================
// rec.reception-refusal
// ===========================================================================
describe('rec.reception-refusal', () => {
  it('records a refusal with a governed reason, audits it, and replays idempotently', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();
    const key = crypto.randomUUID();
    const body = {
      refusalType: 'signature',
      refusalReasonId: REASON_ACTIVE,
      refusingPartnerId: PARTNER_A,
    };

    const first = await recordRefusal(visit, body, key);
    expect(first.status).toBe(201);
    const created = await json(first);
    expect(created.refusalId).toBeTruthy();
    expect(created.refusalType).toBe('signature');

    const replay = await json(await recordRefusal(visit, body, key));
    expect(replay.refusalId).toBe(created.refusalId);

    expect(await refusals(visit)).toBe(1);
    expect(await auditCount('rec.reception.refusal_recorded', created.refusalId ?? '')).toBe(1);
  });

  /**
   * A refusal is a fact about a step that did NOT happen. The danger is that a
   * downstream reader treats "there is a row about the signature" as "the party
   * signed", so this asserts the opposite directly: after a signature refusal the
   * reception still cannot be approved, because approval needs an *approved*
   * authorization and a refusal is not one.
   */
  it('is never readable as consent: approval still fails after a signature refusal', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();

    const recorded = await recordRefusal(visit, {
      refusalType: 'signature',
      refusalReasonId: REASON_ACTIVE,
      refusingPartnerId: PARTNER_A,
    });
    expect(recorded.status).toBe(201);
    expect(await refusals(visit)).toBe(1);

    const before = await visitStatus(visit);
    expect(before.status).toBe('opened');

    const rejected = await approve(visit, before.version);
    expect(rejected.status).toBe(409);
    expect((await json(rejected)).code).toBe('ERR-TRN-001');

    // The visit did not creep forward, and the refusal is still on file.
    const after = await visitStatus(visit);
    expect(after.status).toBe('opened');
    expect(after.version).toBe(before.version);
    expect(await refusals(visit)).toBe(1);
    expect(
      await countRows(
        admin,
        'rec.authorizations',
        "reception_visit_id = $1 AND decision = 'approved'",
        [visit]
      )
    ).toBe(0);
  });

  it('refuses a reason that is no longer active, while the active one is accepted', async () => {
    authAs(SUBJ_FULL);
    const visit = await newVisit();

    const archived = await recordRefusal(visit, {
      refusalType: 'intake_step',
      refusalReasonId: REASON_INACTIVE,
    });
    expect(archived.status).toBe(422);
    expect((await json(archived)).code).toBe('ERR-VAL-001');
    expect(await refusals(visit)).toBe(0);

    expect(
      (
        await recordRefusal(visit, {
          refusalType: 'intake_step',
          refusalReasonId: REASON_ACTIVE,
        })
      ).status
    ).toBe(201);
    expect(await refusals(visit)).toBe(1);
  });

  it('refuses a tenant-A principal recording a refusal on a real tenant-B reception, writing nothing', async () => {
    const theirVisit = await newVisit({
      tenantId: TENANT_B,
      companyId: COMPANY_B1,
      branchId: BRANCH_B1,
      partnerId: PARTNER_B,
    });

    authAs(SUBJ_FULL);
    const refused = await recordRefusal(theirVisit, {
      refusalType: 'authorization',
      refusalReasonId: REASON_ACTIVE,
    });
    expect(refused.status).toBe(404);
    expect((await json(refused)).code).toBe('ERR-RES-001');
    expect(await refusals(theirVisit)).toBe(0);
    expect(
      await auditCountIn(
        'rec.reception.refusal_recorded',
        'SELECT id FROM rec.refusals WHERE reception_visit_id = $2',
        theirVisit
      )
    ).toBe(0);
  });

  it('refuses a branch-A2-scoped principal recording a refusal on a branch-A1 reception', async () => {
    const inA1 = await newVisit({ branchId: BRANCH_A1 });
    const inA2 = await newVisit({ branchId: BRANCH_A2 });

    authAs(SUBJ_B2);
    const refused = await recordRefusal(inA1, { refusalType: 'other' });
    expect(refused.status).toBe(404);
    expect((await json(refused)).code).toBe('ERR-RES-001');
    expect(await refusals(inA1)).toBe(0);

    expect((await recordRefusal(inA2, { refusalType: 'other' })).status).toBe(201);
    expect(await refusals(inA2)).toBe(1);
  });
});
