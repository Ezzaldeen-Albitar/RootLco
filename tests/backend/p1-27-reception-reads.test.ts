/**
 * Reception reads — the six-GET read surface, end to end (P1-27 remediation
 * executed by P1-18: `P1-27-INT-010`, `-011`, `-015`, `-016`, `-017`, `-021`).
 *
 * The reception domain published eight operations and every one was a POST.
 * These suites drive the six new GET handlers through the fixed pipeline on the
 * least-privilege `app_runtime` role, and the decisive test is the ROUND TRIP:
 * the detail's published ETag drives a real `rec.reception-approve` with no
 * prior write in the session — the exact circumstance that was impossible
 * before, and the reason a visit was reachable in one unbroken session only.
 *
 * Three deliberate hostilities:
 *
 *  - the party-role cursor fixture writes ten rows in ONE statement so they
 *    share their timestamp to the microsecond, and the collision is ASSERTED
 *    before the walk — a fixture without the collision proves paging
 *    terminates, not that it loses nothing (`P1-27-INT-006`);
 *  - the raw response text of the evidence read is scanned for the restricted
 *    narrative columns — a field-by-field assertion cannot catch an ADDED
 *    column, and `rec.complaint_details` / `rec.vehicle_content_details` must
 *    never leak through operation E;
 *  - the history fixture plants a `seq` beyond `Number.MAX_SAFE_INTEGER`, so
 *    "bigint stays a string" is proven where it matters rather than asserted
 *    about a small number that would survive a float.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   rec.reception-detail: route service authorization success denial cross-tenant isolation
 *   rec.reception-list: route service authorization success denial isolation
 *   rec.reception-party-role-list: route service authorization success denial cross-tenant isolation
 *   rec.reception-authorization-list: route service authorization success denial cross-tenant isolation
 *   rec.reception-condition-evidence-list: route service authorization success denial cross-tenant isolation
 *   rec.reception-history: route service authorization success denial cross-tenant isolation
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
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
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import {
  GET as LIST_RECEPTIONS,
  POST as CREATE_RECEPTION,
  RECEPTION_LIST_OPERATION,
} from '@/app/api/v1/receptions/route';
import {
  GET as READ_RECEPTION,
  RECEPTION_DETAIL_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/route';
import {
  GET as LIST_PARTY_ROLES,
  RECEPTION_PARTY_ROLE_LIST_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/party-roles/route';
import {
  GET as LIST_AUTHORIZATIONS,
  POST as RECORD_AUTHORIZATION,
  RECEPTION_AUTHORIZATION_LIST_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/authorizations/route';
import {
  GET as LIST_CONDITION_EVIDENCE,
  POST as RECORD_EVIDENCE,
  RECEPTION_CONDITION_EVIDENCE_LIST_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/condition-evidence/route';
import {
  GET as LIST_HISTORY,
  RECEPTION_HISTORY_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/history/route';
import { POST as APPROVE } from '@/app/api/v1/receptions/[receptionId]/approve/route';

/** Tenant B's own company and branch — a real scope, not a fabricated id. */
const COMPANY_B1 = 'c1150000-0000-4000-8000-0000000000b1';
const BRANCH_B1 = 'c1150000-0000-4000-8000-0000000000b2';
/** A second branch of the same company, for the isolation split. */
const BRANCH_A2 = 'c1150000-0000-4000-8000-0000000000a2';

const ROLE_FULL = 'c1150000-0000-4000-8000-000000000101';
const USER_FULL = 'c1150000-0000-4000-8000-000000000102';
const SUBJ_FULL = 'fx_p1_27_rec_reader';

/** Every rec.* write code — but NOT rec.reception.read. */
const ROLE_NO_READ = 'c1150000-0000-4000-8000-000000000201';
const USER_NO_READ = 'c1150000-0000-4000-8000-000000000202';
const SUBJ_NO_READ = 'fx_p1_27_rec_no_read';

/**
 * PERMISSION_ELSEWHERE: rec.reception.read scoped to BRANCH_A2, plus a decoy
 * grant in BRANCH_A1 carrying an unrelated permission — the row is VISIBLE
 * (RLS unions every grant's branches) and must still be REFUSED (403).
 */
const ROLE_ELSEWHERE = 'c1150000-0000-4000-8000-000000000301';
const ROLE_DECOY = 'c1150000-0000-4000-8000-000000000304';
const USER_ELSEWHERE = 'c1150000-0000-4000-8000-000000000302';
const SUBJ_ELSEWHERE = 'fx_p1_27_rec_elsewhere';
const GRANT_ELSEWHERE = 'c1150000-0000-4000-8000-000000000303';
const GRANT_DECOY = 'c1150000-0000-4000-8000-000000000305';

/** SCOPED_ELSEWHERE: read scoped to BRANCH_A2 and NOTHING in BRANCH_A1 — 404. */
const ROLE_SCOPED = 'c1150000-0000-4000-8000-000000000401';
const USER_SCOPED = 'c1150000-0000-4000-8000-000000000402';
const SUBJ_SCOPED = 'fx_p1_27_rec_scoped';
const GRANT_SCOPED = 'c1150000-0000-4000-8000-000000000403';

const ROLE_TENANT_B = 'c1150000-0000-4000-8000-000000000501';
const USER_TENANT_B = 'c1150000-0000-4000-8000-000000000502';
const SUBJ_TENANT_B = 'fx_p1_27_rec_tenant_b';

const PARTNER_A = 'c1150000-0000-4000-8000-0000000000c1';
/** Ten partners so ten party roles can share one microsecond instant. */
const PARTNERS = Array.from(
  { length: 10 },
  (_, index) => `c1150000-0000-4000-8000-0000000000d${index.toString(16)}`
);
const FUEL_HALF = 'c1150000-0000-4000-8000-0000000000c3';
const LAMP = 'c1150000-0000-4000-8000-0000000000c4';
const CATEGORY_A = 'c1150000-0000-4000-8000-0000000000c5';
const DOC_MAP = 'c1150000-0000-4000-8000-0000000000c6';
const VER_MAP = 'c1150000-0000-4000-8000-0000000000c7';

/** One microsecond-precise instant with non-zero sub-millisecond digits. */
const INSTANT = '2026-08-05 09:00:00.123456+00';
/** A sequence value a JS float cannot hold exactly: 2^53 + 1. */
const GIANT_SEQ = '9007199254740993';
const SHA_HEX = 'a'.repeat(64);

const R = 'http://localhost/api/v1/receptions';

const FULL_PERMISSIONS = [
  'rec.reception.manage',
  'rec.reception.party.manage',
  'rec.reception.authorization.verify',
  'rec.reception.evidence.manage',
  'rec.reception.signature.manage',
  'rec.reception.approve',
  'rec.reception.convert',
  'rec.reception.read',
  'iam.sensitive.view',
];

interface Item {
  readonly [field: string]: unknown;
}
interface PageBody {
  readonly items?: readonly Item[];
  readonly nextCursor?: string | null;
  readonly hasMore?: boolean;
  readonly code?: string;
}
interface Detail {
  readonly [field: string]: unknown;
  readonly code?: string;
}

let admin: Pool;
let runtime: Pool;
let vehicleCounter = 0;

function authAs(subject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId,
    })
  );
}

type IdRead = (
  request: Request,
  route: { params: Promise<{ receptionId: string }> }
) => Promise<Response>;

function idRead(handler: IdRead, receptionId: string, segment = '', query = ''): Promise<Response> {
  return handler(new Request(`${R}/${receptionId}${segment}${query}`), {
    params: Promise.resolve({ receptionId }),
  });
}

const listReceptions = (query: string): Promise<Response> =>
  LIST_RECEPTIONS(new Request(`${R}${query}`));

function post(
  handler: IdRead,
  receptionId: string,
  segment: string,
  body: unknown
): Promise<Response> {
  return handler(
    new Request(`${R}/${receptionId}${segment}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ receptionId }) }
  );
}

function approve(receptionId: string, version: string): Promise<Response> {
  return APPROVE(
    new Request(`${R}/${receptionId}/approve`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': version,
      },
      body: '{}',
    }),
    { params: Promise.resolve({ receptionId }) }
  );
}

async function asAdminTx<T>(tenantId: string, run: (client: Pool) => Promise<T>): Promise<T> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, tenantId]
    );
    const result = await run(client as unknown as Pool);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function newVehicle(tenantId = TENANT_A): Promise<string> {
  vehicleCounter += 1;
  const vin = `P127RECREAD${String(vehicleCounter).padStart(6, '0')}`;
  return asAdminTx(tenantId, async (client) => {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       VALUES ($1,$2,'ev','active',$3) RETURNING id`,
      [tenantId, vin, USER_A]
    );
    return inserted.rows[0]?.id ?? '';
  });
}

/** Opens a reception through the real check-in route. Leaves it `opened`, RV 1. */
async function openReception(
  overrides: { readonly evSocPercent?: number; readonly fuelLevelId?: string } = {}
): Promise<{ id: string; vehicleId: string }> {
  const vehicleId = await newVehicle();
  const response = await CREATE_RECEPTION(
    new Request(R, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({
        companyId: COMPANY_A1,
        branchId: BRANCH_A1,
        vehicleId,
        receivingEmployeeId: USER_FULL,
        serviceRequesterPartnerId: PARTNER_A,
        origin: { kind: 'walk_in' },
        ...overrides,
      }),
    })
  );
  expect(response.status).toBe(201);
  return { id: ((await response.json()) as Detail).receptionVisitId as string, vehicleId };
}

async function scalar(sql: string, values: readonly unknown[]): Promise<string | null> {
  const result = await admin.query<{ value: string | null }>(sql, [...values]);
  return result.rows[0]?.value ?? null;
}

async function auditTotal(): Promise<number> {
  return Number((await scalar(`SELECT count(*)::text AS value FROM iam.audit_records`, [])) ?? '0');
}

/** Walks every page of an id-addressed list, returning the item ids in order. */
async function walk(
  handler: IdRead,
  receptionId: string,
  segment: string,
  limit: number
): Promise<readonly string[]> {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page += 1) {
    const query: string = cursor
      ? `?limit=${limit}&cursor=${encodeURIComponent(cursor)}`
      : `?limit=${limit}`;
    const response = await idRead(handler, receptionId, segment, query);
    expect(response.status, `page ${page}`).toBe(200);
    const body = (await response.json()) as PageBody;
    expect(Object.keys(body).sort(), `page ${page}`).toEqual(['hasMore', 'items', 'nextCursor']);
    seen.push(...(body.items ?? []).map((item) => String(item.id)));
    if (!body.hasMore || !body.nextCursor) return seen;
    cursor = body.nextCursor;
  }
  throw new Error('cursor did not terminate within 20 pages');
}

async function seedPrincipal(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string,
  permissions: readonly string[]
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','Reception Read Principal','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-27 reception read principal',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A, [...permissions]]
  );
}

/**
 * A real damage-map template revision bound to the fixture document.
 *
 * DBCR-P1-28-001 makes the revision MANDATORY on a new map: the route schema
 * refuses a payload without it, and the database guard refuses a NULL. A
 * fixture that named only the document and its version described a binding
 * the product no longer admits.
 */
async function seedDamageMapTemplate(): Promise<string> {
  const TPL = 'c1150000-0000-4000-8000-0000000000f1';
  const REV = 'c1150000-0000-4000-8000-0000000000f2';
  const cat = (
    await admin.query<{ id: string; purpose: string }>(
      `SELECT id, business_link_purpose AS purpose FROM shared.document_categories
        WHERE category_code = 'reception_damage_map_template' AND deleted_at IS NULL
        ORDER BY (tenant_id IS NOT NULL) DESC LIMIT 1`
    )
  ).rows[0];
  if (!cat) throw new Error('the reception_damage_map_template category is absent');
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, category_id, title, classification, retention_class, status, created_by)
     VALUES ($1,$2,$3,'DBCR-P1-28-001 damage-map template','internal','evidence-audit','pending',$4)
     ON CONFLICT (id) DO NOTHING`,
    [DOC_MAP, TENANT_A, cat.id, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type,
        size_bytes, sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,1,$4,'image/png',1024, decode($5,'hex'), $6, $6)
     ON CONFLICT (id) DO NOTHING`,
    [VER_MAP, TENANT_A, DOC_MAP, 'dbcr128/' + DOC_MAP, SHA_HEX, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.file_scan_results
       (tenant_id, version_id, scanner_code, scan_status, scanned_at, created_by)
     VALUES ($1,$2,'harness','clean',now(),$3) ON CONFLICT DO NOTHING`,
    [TENANT_A, VER_MAP, USER_A]
  );
  await admin.query(
    `UPDATE shared.document_versions SET status='scanning' WHERE id=$1 AND status='pending'`,
    [VER_MAP]
  );
  await admin.query(
    `UPDATE shared.document_versions SET status='accepted' WHERE id=$1 AND status='scanning'`,
    [VER_MAP]
  );
  await admin.query(
    `INSERT INTO rec.damage_map_templates
       (id, tenant_id, company_id, branch_id, map_type, perspective, created_by)
     VALUES ($1,$2,$3,$4,'exterior',NULL,$5) ON CONFLICT (id) DO NOTHING`,
    [TPL, TENANT_A, COMPANY_A1, BRANCH_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.document_links
       (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
     VALUES ($1,$2,'rec.damage_map_templates',$3,$4,$5,$5) ON CONFLICT DO NOTHING`,
    [TENANT_A, DOC_MAP, TPL, cat.purpose, USER_A]
  );
  await admin.query(
    `INSERT INTO rec.damage_map_template_versions
       (id, tenant_id, template_id, version_number, document_id, document_version_id, created_by)
     VALUES ($1,$2,$3,1,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
    [REV, TENANT_A, TPL, DOC_MAP, VER_MAP, USER_A]
  );
  return REV;
}

/** The revision every damage_map payload in this suite is bound to. */
let damageMapRevision = '';

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('rec.reception.manage','rec','Open a reception visit and accept vehicle custody','medium',$1),
            ('rec.reception.party.manage','rec','Assign and close dated party roles on a reception','medium',$1),
            ('rec.reception.authorization.verify','rec','Verify and record reception authorization decisions','high',$1),
            ('rec.reception.evidence.manage','rec','Record pre-service condition evidence on a reception','medium',$1),
            ('rec.reception.signature.manage','rec','Capture reception signatures and refusals','high',$1),
            ('rec.reception.approve','rec','Approve a reception visit for work','high',$1),
            ('rec.reception.convert','rec','Convert an approved reception into a work order','high',$1),
            ('rec.reception.read','rec','Read reception visits, parties, authorizations, condition evidence and custody history','low',$1),
            ('veh.vehicle.read','veh','Search and read vehicles in the caller tenant','low',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_a2_read','Fixture Branch A2 Read','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_A2, TENANT_A, COMPANY_A1, USER_A]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1,$2,'company_b1_read','Fixture Company B1 Read','USD',$3) ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B1, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'branch_b1_read','Fixture Branch B1 Read','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B1, TENANT_B, COMPANY_B1, USER_A]
  );

  await seedPrincipal(TENANT_A, ROLE_FULL, USER_FULL, SUBJ_FULL, FULL_PERMISSIONS);
  await seedPrincipal(
    TENANT_A,
    ROLE_NO_READ,
    USER_NO_READ,
    SUBJ_NO_READ,
    FULL_PERMISSIONS.filter((code) => code !== 'rec.reception.read')
  );
  await seedPrincipal(TENANT_A, ROLE_ELSEWHERE, USER_ELSEWHERE, SUBJ_ELSEWHERE, [
    'rec.reception.read',
  ]);
  await seedPrincipal(TENANT_A, ROLE_SCOPED, USER_SCOPED, SUBJ_SCOPED, ['rec.reception.read']);
  await seedPrincipal(TENANT_B, ROLE_TENANT_B, USER_TENANT_B, SUBJ_TENANT_B, FULL_PERMISSIONS);
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,'fx_p1_27_rec_decoy','P1-27 decoy role',$3) ON CONFLICT (id) DO NOTHING`,
    [ROLE_DECOY, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = 'veh.vehicle.read'
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [TENANT_A, ROLE_DECOY, USER_A]
  );

  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4), ($1,$5,$6,'unrestricted',$4,$4)`,
    [TENANT_A, USER_FULL, ROLE_FULL, USER_A, USER_NO_READ, ROLE_NO_READ]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [TENANT_B, USER_TENANT_B, ROLE_TENANT_B, USER_A]
  );
  const scoped = await admin.connect();
  try {
    await scoped.query('BEGIN');
    await scoped.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5), ($6,$2,$3,$7,'scoped',$5,$5), ($8,$2,$9,$10,'scoped',$5,$5)`,
      [
        GRANT_ELSEWHERE,
        TENANT_A,
        USER_ELSEWHERE,
        ROLE_ELSEWHERE,
        USER_A,
        GRANT_DECOY,
        ROLE_DECOY,
        GRANT_SCOPED,
        USER_SCOPED,
        ROLE_SCOPED,
      ]
    );
    await scoped.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5), ($1,$6,'branch',$3,$7,$5), ($1,$8,'branch',$3,$4,$5)`,
      [
        TENANT_A,
        GRANT_ELSEWHERE,
        COMPANY_A1,
        BRANCH_A2,
        USER_A,
        GRANT_DECOY,
        BRANCH_A1,
        GRANT_SCOPED,
      ]
    );
    await scoped.query('COMMIT');
  } catch (error) {
    await scoped.query('ROLLBACK');
    throw error;
  } finally {
    scoped.release();
  }

  await asAdminTx(TENANT_A, async (client) => {
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','Reception Read Requester','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_A, TENANT_A, USER_A]
    );
    for (const [index, partner] of PARTNERS.entries()) {
      await client.query(
        `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
         VALUES ($1,$2,'individual',$3,'active',$4) ON CONFLICT (id) DO NOTHING`,
        [partner, TENANT_A, `Occupant ${String(index).padStart(2, '0')}`, USER_A]
      );
    }
  });
  await admin.query(
    `INSERT INTO rec.fuel_levels (id, scope, tenant_id, code, name, created_by)
     VALUES ($1,'tenant',$2,'zz_read_half','Half Tank',$3) ON CONFLICT (id) DO NOTHING`,
    [FUEL_HALF, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO rec.warning_light_codes (id, scope, tenant_id, code, name, created_by)
     VALUES ($1,'tenant',$2,'zz_read_engine','Engine lamp',$3) ON CONFLICT (id) DO NOTHING`,
    [LAMP, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.document_categories
       (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
        default_classification, default_retention_class, created_by)
     VALUES ($1,'tenant',$2,'p127_read_docs','P1-27 read fixture documents',
             ARRAY['application/pdf']::text[], 1048576, 'internal', 'evidence-audit', $3)
     ON CONFLICT (id) DO NOTHING`,
    [CATEGORY_A, TENANT_A, USER_A]
  );
  // DBCR-P1-28-001: the damage-map document is created by the template seeder,
  // in the reception_damage_map_template category the guard demands.
  // shared.documents.category_id is immutable, so it cannot be created here
  // under the generic fixture category and moved afterwards.
  damageMapRevision = await seedDamageMapTemplate();

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.query(`DELETE FROM rec.fuel_levels WHERE id = $1`, [FUEL_HALF]);
    await admin.query(`DELETE FROM rec.warning_light_codes WHERE id = $1`, [LAMP]);
    await admin.end();
  }
});

describe('registration', () => {
  it('registers all six reads exactly as the plan says', () => {
    const declared = [
      [RECEPTION_DETAIL_OPERATION, 'rec.reception-detail', '/receptions/{receptionId}'],
      [RECEPTION_LIST_OPERATION, 'rec.reception-list', '/receptions'],
      [
        RECEPTION_PARTY_ROLE_LIST_OPERATION,
        'rec.reception-party-role-list',
        '/receptions/{receptionId}/party-roles',
      ],
      [
        RECEPTION_AUTHORIZATION_LIST_OPERATION,
        'rec.reception-authorization-list',
        '/receptions/{receptionId}/authorizations',
      ],
      [
        RECEPTION_CONDITION_EVIDENCE_LIST_OPERATION,
        'rec.reception-condition-evidence-list',
        '/receptions/{receptionId}/condition-evidence',
      ],
      [RECEPTION_HISTORY_OPERATION, 'rec.reception-history', '/receptions/{receptionId}/history'],
    ] as const;
    for (const [operation, id, path] of declared) {
      expect(operation.id, id).toBe(id);
      expect(operation.path, id).toBe(path);
      expect(operation.method, id).toBe('GET');
      expect(operation.permissions, id).toEqual(['rec.reception.read']);
      expect(operation.scope, id).toBe('branch');
      expect(operation.auditClass, id).toBe('none');
      expect(operation.rateLimitPolicy, id).toBe('expensive-read');
      expect(operation.idempotent ?? false, id).toBe(false);
      expect(operation.versionGuarded ?? false, id).toBe(false);
    }
  });
});

describe('authorization and the uniform 404', () => {
  it('answers 401 with no session and 403 when every write code is held but the read is not (denial)', async () => {
    authAs(SUBJ_FULL);
    const { id } = await openReception();

    __resetAuthenticatorForTests();
    expect((await idRead(READ_RECEPTION, id)).status).toBe(401);

    // The sharpest possible denial: this principal may open, evidence, approve
    // and convert the visit — and is refused the READ purely because
    // `rec.reception.read` is missing. No write code satisfies a read.
    authAs(SUBJ_NO_READ);
    for (const [handler, segment] of [
      [READ_RECEPTION, ''],
      [LIST_PARTY_ROLES, '/party-roles'],
      [LIST_AUTHORIZATIONS, '/authorizations'],
      [LIST_CONDITION_EVIDENCE, '/condition-evidence'],
      [LIST_HISTORY, '/history'],
    ] as const) {
      const response = await idRead(handler as IdRead, id, segment as string);
      expect(response.status, segment as string).toBe(403);
      expect(((await response.json()) as Detail).code, segment as string).toBe('ERR-IAM-001');
    }
    expect((await listReceptions(`?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`)).status).toBe(
      403
    );
  });

  it('answers the SAME 404 for other-tenant, never-existent and malformed-adjacent ids (cross-tenant)', async () => {
    authAs(SUBJ_FULL);
    const { id } = await openReception();

    authAs(SUBJ_TENANT_B, TENANT_B);
    for (const [handler, segment] of [
      [READ_RECEPTION, ''],
      [LIST_PARTY_ROLES, '/party-roles'],
      [LIST_AUTHORIZATIONS, '/authorizations'],
      [LIST_CONDITION_EVIDENCE, '/condition-evidence'],
      [LIST_HISTORY, '/history'],
    ] as const) {
      const foreign = await idRead(handler as IdRead, id, segment as string);
      expect(foreign.status, segment as string).toBe(404);
      expect(((await foreign.json()) as Detail).code, segment as string).toBe('ERR-RES-001');
    }

    authAs(SUBJ_FULL);
    const absent = await idRead(READ_RECEPTION, crypto.randomUUID());
    expect(absent.status).toBe(404);
    expect(((await absent.json()) as Detail).code).toBe('ERR-RES-001');
  });

  it('splits the isolation refusal: permission-elsewhere 403, scoped-elsewhere 404 (isolation)', async () => {
    authAs(SUBJ_FULL);
    const { id } = await openReception();

    // Visible through the decoy grant's branch union, refused by the deferred
    // scope evaluation: RLS visibility is not authority (P1-18-A-01).
    authAs(SUBJ_ELSEWHERE);
    const visibleButRefused = await idRead(READ_RECEPTION, id);
    expect(visibleButRefused.status).toBe(403);
    expect(((await visibleButRefused.json()) as Detail).code).toBe('ERR-IAM-001');

    // No grant reaches BRANCH_A1 at all: RLS hides the row and the answer is
    // the same 404 a nonexistent id gets — existence is not disclosed.
    authAs(SUBJ_SCOPED);
    const hidden = await idRead(READ_RECEPTION, id);
    expect(hidden.status).toBe(404);
    expect(((await hidden.json()) as Detail).code).toBe('ERR-RES-001');
  });

  it('refuses a scope-blind list: companyId omitted or malformed is 422, never a 200', async () => {
    authAs(SUBJ_FULL);
    expect((await listReceptions(`?branchId=${BRANCH_A1}`)).status).toBe(422);
    expect((await listReceptions(`?companyId=nope&branchId=${BRANCH_A1}`)).status).toBe(422);
    // Unknown parameters are refused, so a tenant cannot be smuggled (strict).
    expect(
      (await listReceptions(`?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&tenantId=${TENANT_B}`))
        .status
    ).toBe(422);
    // Tenant B addressing tenant A's branch: its grant is UNRESTRICTED, and an
    // unrestricted grant is tenant-bounded by construction —
    // `iam.has_permission_in_scope` short-circuits without consulting the
    // target. What contains the request is the tenant predicate, and the honest
    // answer is an EMPTY page rather than a 403 or 404 that would confirm the
    // foreign branch exists (the p1-19 work-order board states this doctrine).
    authAs(SUBJ_TENANT_B, TENANT_B);
    const foreign = await listReceptions(`?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}`);
    expect(foreign.status).toBe(200);
    expect(((await foreign.json()) as PageBody).items).toEqual([]);
    // Its OWN empty branch answers an empty page — the honest empty, not 404.
    const own = await listReceptions(`?companyId=${COMPANY_B1}&branchId=${BRANCH_B1}`);
    expect(own.status).toBe(200);
    const page = (await own.json()) as PageBody;
    expect(page.items).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it('answers 422 — not 500 — for a malformed path id, and refuses a bogus kind filter', async () => {
    authAs(SUBJ_FULL);
    expect((await idRead(READ_RECEPTION, 'not-a-uuid')).status).toBe(422);
    const { id } = await openReception();
    expect(
      (await idRead(LIST_CONDITION_EVIDENCE, id, '/condition-evidence', '?kind=bogus')).status
    ).toBe(422);
    expect((await idRead(LIST_HISTORY, id, '/history', '?limit=0')).status).toBe(422);
    expect((await idRead(LIST_HISTORY, id, '/history', '?limit=1000')).status).toBe(422);
  });
});

describe('the detail and the If-Match round trip', () => {
  it('publishes the exact contract keys, the ETag, and drives approve with it (success)', async () => {
    authAs(SUBJ_FULL);
    const { id, vehicleId } = await openReception({ evSocPercent: 42.5, fuelLevelId: FUEL_HALF });
    const audits = await auditTotal();

    const response = await idRead(READ_RECEPTION, id);
    expect(response.status).toBe(200);
    const etag = response.headers.get('etag');
    expect(etag).toBe('"1"');
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('x-correlation-id')).toBeTruthy();

    const body = (await response.json()) as Detail;
    // Both directions: every promised key, and no key beyond the promise.
    expect(Object.keys(body).sort()).toEqual([
      'appointmentId',
      'branchId',
      'companyId',
      'createdAt',
      'custodyAcceptedAt',
      'custodyReleasedAt',
      'displayNumber',
      'evSocPercent',
      'fuelLevelId',
      'fuelLevelName',
      'id',
      'odometerReadingId',
      'origin',
      // Sorted, because the assertion sorts: 'D' precedes 'I'.
      'receivingEmployeeDisplayName',
      'receivingEmployeeId',
      'receptionStatus',
      'recordVersion',
      'updatedAt',
      'vehicleDisplayNumber',
      'vehicleId',
      'walkInId',
    ]);
    expect(body.receptionStatus).toBe('opened');
    expect(body.origin).toBe('walk_in');
    expect(body.vehicleId).toBe(vehicleId);
    expect(body.receivingEmployeeId).toBe(USER_FULL);
    expect(body.receivingEmployeeDisplayName).toBe('Reception Read Principal');
    expect(body.fuelLevelName).toBe('Half Tank');
    // numeric(5,2) crosses the boundary as a STRING and stays one.
    expect(typeof body.evSocPercent).toBe('string');
    expect(body.evSocPercent).toBe('42.50');
    expect(body.custodyReleasedAt).toBeNull();
    expect(body.recordVersion).toBe(1);

    // A read is a read: no audit record was appended by any of it (delta).
    expect(await auditTotal()).toBe(audits);

    // THE POINT OF THE WHOLE TASK: record the approval prerequisite, re-read,
    // and feed the published header back as If-Match with no other write
    // holding the version.
    const decision = await post(RECORD_AUTHORIZATION, id, '/authorizations', {
      authorizingRole: 'service_requester',
      partnerId: PARTNER_A,
      decision: 'approved',
    });
    expect(decision.status).toBe(201);
    const reread = await idRead(READ_RECEPTION, id);
    const version = reread.headers.get('etag') ?? '';
    expect(version).toBe('"1"');
    expect((await approve(id, version)).status).toBe(200);
    // And a stale value — the version the row no longer holds — is refused.
    expect((await approve(id, version)).status).toBe(409);
  });
});

describe('party roles — the cursor loses nothing (P1-27-INT-006)', () => {
  it('walks ten same-microsecond roles at limit=4 with no loss and no duplicate', async () => {
    authAs(SUBJ_FULL);
    const { id } = await openReception();

    // Ten roles in ONE statement at one explicit microsecond instant. The
    // premise is asserted before the walk: without the collision this test
    // proves only that paging terminates.
    await asAdminTx(TENANT_A, async (client) => {
      await client.query(
        `INSERT INTO rec.reception_party_roles
           (id, tenant_id, company_id, branch_id, reception_visit_id, partner_id,
            relationship_role, valid_from, created_by)
         SELECT partner_id, $1, $2, $3, $4, partner_id, 'vehicle_user', $5::timestamptz, $6
           FROM unnest($7::uuid[]) AS t(partner_id)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, id, INSTANT, USER_A, PARTNERS]
      );
    });
    const collision = await scalar(
      `SELECT count(*)::text AS value FROM rec.reception_party_roles
        WHERE reception_visit_id = $1
          AND to_char(valid_from AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') = '2026-08-05T09:00:00.123456Z'`,
      [id]
    );
    expect(Number(collision)).toBe(10);

    // 10 planted + the mandatory service_requester the check-in primitive wrote.
    const ids = await walk(LIST_PARTY_ROLES, id, '/party-roles', 4);
    expect(ids).toHaveLength(11);
    expect(new Set(ids).size).toBe(11);

    // The active filter excludes a dated-out interval.
    await asAdminTx(TENANT_A, async (client) => {
      await client.query(
        `UPDATE rec.reception_party_roles SET valid_to = now()
          WHERE reception_visit_id = $1 AND partner_id = $2 AND relationship_role = 'vehicle_user'`,
        [id, PARTNERS[0]]
      );
    });
    const active = await idRead(LIST_PARTY_ROLES, id, '/party-roles', '?status=active&limit=100');
    const activeItems = ((await active.json()) as PageBody).items ?? [];
    expect(activeItems.map((item) => item.partnerId)).not.toContain(PARTNERS[0]);
    const ended = await idRead(LIST_PARTY_ROLES, id, '/party-roles', '?status=ended&limit=100');
    const endedItems = ((await ended.json()) as PageBody).items ?? [];
    expect(endedItems.map((item) => item.partnerId)).toEqual([PARTNERS[0]]);

    // Labels resolve: a partner id never stands alone.
    expect(activeItems.every((item) => typeof item.partnerDisplayName === 'string')).toBe(true);

    // A cursor issued by THIS list is refused by ANOTHER list: ordering
    // contracts are per-list and non-transferable.
    const first = await idRead(LIST_PARTY_ROLES, id, '/party-roles', '?limit=4');
    const cursor = ((await first.json()) as PageBody).nextCursor ?? '';
    const crossed = await idRead(
      LIST_HISTORY,
      id,
      '/history',
      `?cursor=${encodeURIComponent(cursor)}`
    );
    // 400, not 422: a cursor is not caller-authored input to validate, it is a
    // token this API issued, and `ERR-PAG-001` says the token does not belong
    // here. The distinction is the error catalog's, not this test's.
    expect(crossed.status).toBe(400);
    expect(((await crossed.json()) as Detail).code).toBe('ERR-PAG-001');
  });
});

describe('authorizations — refusal is not consent', () => {
  it('returns both tables rows and marks the LATEST word per partner as standing', async () => {
    authAs(SUBJ_FULL);
    const { id } = await openReception();

    const approved = await post(RECORD_AUTHORIZATION, id, '/authorizations', {
      authorizingRole: 'service_requester',
      partnerId: PARTNER_A,
      decision: 'approved',
    });
    expect(approved.status).toBe(201);

    // The second, cheaper way to say no: an authorization-type refusal. Written
    // admin-side with the exact column set the refusals route produces.
    await asAdminTx(TENANT_A, async (client) => {
      await client.query(
        `INSERT INTO rec.refusals
           (tenant_id, company_id, branch_id, reception_visit_id, refusal_type,
            refusing_partner_id, occurred_at, created_by)
         VALUES ($1,$2,$3,$4,'authorization',$5, now() + interval '1 second', $6)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, id, PARTNER_A, USER_A]
      );
    });

    const response = await idRead(LIST_AUTHORIZATIONS, id, '/authorizations', '?limit=100');
    expect(response.status).toBe(200);
    const items = ((await response.json()) as PageBody).items ?? [];
    expect(items).toHaveLength(2);

    const refusal = items.find((item) => item.kind === 'refusal');
    const approval = items.find((item) => item.kind === 'authorization');
    expect(refusal).toBeDefined();
    expect(approval).toBeDefined();
    // The withdrawal is the partner's CURRENT word; the approval is history.
    expect(refusal?.decision).toBe('declined');
    expect(refusal?.isStanding).toBe(true);
    expect(approval?.decision).toBe('approved');
    expect(approval?.isStanding).toBe(false);
    // A refusal has no claimed role and no channel; the projection says so
    // rather than inventing values.
    expect(refusal?.authorizingRole).toBeNull();
    expect(refusal?.channel).toBeNull();
    expect(refusal?.partnerDisplayName).toBe('Reception Read Requester');
  });
});

describe('condition evidence — eight kinds, and the restricted narrative never leaks', () => {
  it('lists every kind with its own key set, keeps numerics strings, and filters by kind', async () => {
    authAs(SUBJ_FULL);
    const { id } = await openReception();

    const record = async (body: Record<string, unknown>): Promise<string> => {
      const response = await post(RECORD_EVIDENCE, id, '/condition-evidence', body);
      expect(response.status, String(body.kind)).toBe(201);
      return ((await response.json()) as Detail).evidenceId as string;
    };

    await record({
      kind: 'complaint',
      category: 'noise',
      severity: 'high',
      complaintText: 'A grinding noise from the front left when braking downhill',
      reportedByPartnerId: PARTNER_A,
    });
    const inspectionId = await record({ kind: 'inspection', inspectorId: USER_A });
    await record({
      kind: 'condition_item',
      inspectionId,
      findingCategory: 'scratch',
      vehicleZone: 'front_left_door',
      severity: 'minor',
      findingNote: 'Two parallel scratches above the handle',
    });
    const mapId = await record({
      kind: 'damage_map',
      damageMapTemplateVersionId: damageMapRevision,
      documentId: DOC_MAP,
      documentVersionId: VER_MAP,
      mapType: 'exterior',
    });
    await record({
      kind: 'damage_mark',
      damageMapId: mapId,
      markType: 'dent',
      vehicleZone: 'rear_bumper',
      coordX: 0.12345,
      coordY: 0.5,
    });
    await record({
      kind: 'contents',
      itemDescription: 'A child seat and a toolbox',
      quantity: 2,
      location: 'trunk',
      declaredValue: 150,
      declaredCurrency: 'USD',
    });
    await record({ kind: 'warning_light', warningLightCodeId: LAMP, observedState: 'on' });
    await record({
      kind: 'leak',
      leakType: 'oil',
      vehicleZone: 'engine_bay',
      severity: 'minor',
      note: 'Fresh drops under the sump',
    });

    const response = await idRead(LIST_CONDITION_EVIDENCE, id, '/condition-evidence', '?limit=100');
    expect(response.status).toBe(200);
    const raw = await response.text();

    // The restricted narrative must not appear in the RAW TEXT: a key-set
    // assertion cannot catch an added column, and the customer's own words and
    // declared values are exactly what operation E promises never to carry.
    for (const forbidden of [
      'complaint_text',
      'complaintText',
      'grinding noise',
      'item_description',
      'itemDescription',
      'child seat',
      'declared_value',
      'declaredValue',
      'vin_raw',
      'chassis',
      'engine_no',
    ]) {
      expect(raw, forbidden).not.toContain(forbidden);
    }

    const items = (JSON.parse(raw) as PageBody).items ?? [];
    expect(items).toHaveLength(8);
    const byKind = new Map(items.map((item) => [String(item.kind), item]));
    expect([...byKind.keys()].sort()).toEqual([
      'complaint',
      'condition_item',
      'contents',
      'damage_map',
      'damage_mark',
      'inspection',
      'leak',
      'warning_light',
    ]);

    const common = ['evidenceDocumentId', 'id', 'kind', 'recordedAt'];
    const keySets: Record<string, readonly string[]> = {
      complaint: ['category', 'reportedByPartnerDisplayName', 'reportedByPartnerId', 'severity'],
      inspection: ['completedAt', 'inspectionStatus', 'inspectorId', 'startedAt'],
      condition_item: [
        'correctionOf',
        'findingCategory',
        'findingNote',
        'inspectionId',
        'severity',
        'vehicleZone',
      ],
      damage_map: ['documentId', 'documentVersionId', 'mapType', 'perspective'],
      damage_mark: ['coordX', 'coordY', 'damageMapId', 'markType', 'note', 'vehicleZone'],
      contents: ['location', 'quantity'],
      warning_light: [
        'note',
        'observedState',
        'warningLightCode',
        'warningLightCodeId',
        'warningLightName',
      ],
      leak: ['leakType', 'note', 'severity', 'vehicleZone'],
    };
    for (const [kind, extras] of Object.entries(keySets)) {
      const item = byKind.get(kind);
      expect(item, kind).toBeDefined();
      expect(Object.keys(item ?? {}).sort(), kind).toEqual([...common, ...extras].sort());
    }

    // Coordinates are numeric(6,5): strings in, strings out, no float ever.
    const mark = byKind.get('damage_mark');
    expect(typeof mark?.coordX).toBe('string');
    expect(typeof mark?.coordY).toBe('string');
    expect(mark?.coordX).toBe('0.12345');
    // The complaint header travels; the narrative does not.
    expect(byKind.get('complaint')?.reportedByPartnerDisplayName).toBe('Reception Read Requester');
    // The lamp resolves to its catalogue label.
    expect(byKind.get('warning_light')?.warningLightName).toBe('Engine lamp');

    // The kind filter narrows to the one requested.
    const leaks = await idRead(LIST_CONDITION_EVIDENCE, id, '/condition-evidence', '?kind=leak');
    const leakItems = (((await leaks.json()) as PageBody).items ?? []).map((item) => item.kind);
    expect(leakItems).toEqual(['leak']);
  });
});

describe('history — both ledgers, and bigint stays a string', () => {
  it('unions status and custody rows, survives a seq beyond MAX_SAFE_INTEGER, walks losslessly', async () => {
    authAs(SUBJ_FULL);
    const { id } = await openReception();

    // Ten status rows in ONE statement: they share now() to the microsecond by
    // construction. Coherence demands to_state equal the visit's current
    // status, so every row is a re-statement into 'opened' from 'inspecting'.
    await asAdminTx(TENANT_A, async (client) => {
      await client.query(
        `INSERT INTO rec.reception_status_history
           (tenant_id, company_id, branch_id, reception_visit_id, from_state, to_state)
         SELECT $1, $2, $3, $4, 'inspecting', 'opened' FROM generate_series(1, 10)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, id]
      );
      // One more with a planted GIANT seq — 2^53 + 1, which a JS float rounds.
      await client.query(
        `INSERT INTO rec.reception_status_history
           (tenant_id, company_id, branch_id, reception_visit_id, from_state, to_state, seq)
         OVERRIDING SYSTEM VALUE
         SELECT $1, $2, $3, $4, 'inspecting', 'opened', $5::bigint`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, id, GIANT_SEQ]
      );
    });
    const collision = await scalar(
      `SELECT count(*)::text AS value FROM (
         SELECT occurred_at, count(*) AS n FROM rec.reception_status_history
          WHERE reception_visit_id = $1 GROUP BY occurred_at HAVING count(*) >= 10
       ) AS grouped`,
      [id]
    );
    expect(Number(collision)).toBeGreaterThanOrEqual(1);

    // 11 planted + the initial 'opened' status row + the 'accepted' custody row.
    const ids = await walk(LIST_HISTORY, id, '/history', 4);
    expect(ids).toHaveLength(13);
    expect(new Set(ids).size).toBe(13);

    const response = await idRead(LIST_HISTORY, id, '/history', '?limit=100');
    const items = ((await response.json()) as PageBody).items ?? [];
    const kinds = new Set(items.map((item) => item.kind));
    expect(kinds).toEqual(new Set(['status', 'custody']));

    const custody = items.find((item) => item.kind === 'custody');
    expect(custody?.toState).toBe('accepted');
    expect(custody?.receivingPartnerId).toBe(PARTNER_A);
    expect(custody?.receivingPartnerDisplayName).toBe('Reception Read Requester');

    // Every seq is a string, and the giant one survived digit for digit — the
    // proof that no JS number ever touched it.
    expect(items.every((item) => typeof item.seq === 'string')).toBe(true);
    expect(items.map((item) => item.seq)).toContain(GIANT_SEQ);
  });
});

describe('the branch board', () => {
  it('lists the branch visits newest-received first with per-row record versions (success)', async () => {
    authAs(SUBJ_FULL);
    const first = await openReception();
    const second = await openReception();

    const response = await listReceptions(
      `?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&limit=100`
    );
    expect(response.status).toBe(200);
    const page = (await response.json()) as PageBody;
    expect(Object.keys(page).sort()).toEqual(['hasMore', 'items', 'nextCursor']);
    const ids = (page.items ?? []).map((item) => item.id);
    expect(ids.indexOf(second.id)).toBeLessThan(ids.indexOf(first.id));

    const row = (page.items ?? []).find((item) => item.id === first.id);
    expect(row).toBeDefined();
    expect(Object.keys(row ?? {}).sort()).toEqual([
      'custodyAcceptedAt',
      'custodyReleasedAt',
      'displayNumber',
      'id',
      'origin',
      'receptionStatus',
      'recordVersion',
      'vehicleDisplayNumber',
      'vehicleId',
    ]);
    expect(row?.recordVersion).toBe(1);

    // The status filter narrows to the vocabulary value asked for, and an
    // unknown status is refused by the schema, not silently matched to nothing.
    const opened = await listReceptions(
      `?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&status=opened&vehicleId=${first.vehicleId}&limit=100`
    );
    const openedIds = (((await opened.json()) as PageBody).items ?? []).map((item) => item.id);
    expect(openedIds).toEqual([first.id]);
    expect(
      (await listReceptions(`?companyId=${COMPANY_A1}&branchId=${BRANCH_A1}&status=bogus`)).status
    ).toBe(422);
  });
});
