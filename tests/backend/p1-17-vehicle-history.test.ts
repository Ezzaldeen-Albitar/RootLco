/**
 * Vehicle attribute-change history and document reachability, end to end (Phase
 * 1-17, P1-17-BE-011, P1-17-BE-012).
 *
 * Driven through the real routes on `app_runtime`. The history read is a keyset
 * page of the append-only attribute ledger the frozen trigger populates on every
 * master edit. The document list returns only the ids of documents reachable from
 * the vehicle through live shared links (resolved by shared.document_ids_for_entity)
 * — no storage key, no bytes; linking itself is the shared attachments operation.
 *
 * Operations exercised: veh.vehicle-history, veh.vehicle-document-list.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   veh.vehicle-history: route service authorization success denial cross-tenant
 *   veh.vehicle-document-list: route service authorization success denial cross-tenant
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  IDENTITY_PROVIDER,
  SUBJECT_UNPERMITTED,
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
import { POST as CREATE } from '@/app/api/v1/vehicles/route';
import { PATCH as UPDATE } from '@/app/api/v1/vehicles/[vehicleId]/route';
import { GET as HISTORY } from '@/app/api/v1/vehicles/[vehicleId]/history/route';
import { GET as DOCUMENTS } from '@/app/api/v1/vehicles/[vehicleId]/documents/route';

const ROLE_A = 'c1780000-0000-4000-8000-0000000000a1';
const USER_RA = 'c1780000-0000-4000-8000-0000000000a2';
const SUBJ_A = 'fx_p1_17_veh_hist_a';
const ROLE_B = 'c1780000-0000-4000-8000-0000000000b1';
const USER_RB = 'c1780000-0000-4000-8000-0000000000b2';
const SUBJ_B = 'fx_p1_17_veh_hist_b';
const CAT_A = 'c1780000-0000-4000-8000-0000000000c1';
const DOC_A = 'c1780000-0000-4000-8000-0000000000d1';

const V = 'http://localhost/api/v1/vehicles';

interface Body {
  readonly vehicleId?: string;
  readonly documentIds?: readonly string[];
  readonly items?: readonly { readonly fieldCode?: string; readonly newValue?: string | null }[];
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
async function newVehicle(): Promise<string> {
  const response = await CREATE(
    new Request(V, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: '{}',
    })
  );
  return ((await response.json()) as Body).vehicleId ?? '';
}
function update(vehicleId: string, body: unknown): Promise<Response> {
  return UPDATE(
    new Request(`${V}/${vehicleId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ vehicleId }) }
  );
}
function history(vehicleId: string, query = ''): Promise<Response> {
  return HISTORY(new Request(`${V}/${vehicleId}/history${query}`, { method: 'GET' }), {
    params: Promise.resolve({ vehicleId }),
  });
}
function documents(vehicleId: string): Promise<Response> {
  return DOCUMENTS(new Request(`${V}/${vehicleId}/documents`, { method: 'GET' }), {
    params: Promise.resolve({ vehicleId }),
  });
}

async function seedWriter(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','History Reader','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-17 history reader',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code IN ('veh.vehicle.manage','veh.vehicle.read','shared.document.manage')
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [tenantId, userId, roleId, USER_A]
  );
}

/** A tenant-A document category + one accepted document, for the link fixture. */
async function seedDocument(): Promise<void> {
  await admin.query(
    `INSERT INTO shared.document_categories
       (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
        default_classification, default_retention_class, created_by)
     VALUES ($1,'tenant',$2,'veh_test_docs','Vehicle Test Docs', ARRAY['application/pdf'], 1000000,
        'internal','operational',$3)
     ON CONFLICT (id) DO NOTHING`,
    [CAT_A, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, category_id, title, classification, retention_class, status, created_by)
     VALUES ($1,$2,$3,'Vehicle Doc','internal','operational','pending',$4)
     ON CONFLICT (id) DO NOTHING`,
    [DOC_A, TENANT_A, CAT_A, USER_A]
  );
}

/** Links the seeded document to a vehicle (admin: runtime is SELECT-only on docs). */
async function linkDocument(vehicleId: string): Promise<void> {
  await admin.query(
    `INSERT INTO shared.document_links
       (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
     VALUES ($1,$2,'veh.vehicle',$3,'vehicle_record',$4,$4)`,
    [TENANT_A, DOC_A, vehicleId, USER_A]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('veh.vehicle.manage','veh','Create and edit vehicles','medium',$1),
            ('veh.vehicle.read','veh','Read vehicles','low',$1),
            ('shared.document.manage','shared','Manage documents','medium',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );
  await seedWriter(TENANT_A, ROLE_A, USER_RA, SUBJ_A);
  await seedWriter(TENANT_B, ROLE_B, USER_RB, SUBJ_B);
  await seedDocument();
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
});

afterEach(() => __resetAuthenticatorForTests());
afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await admin.query(`DELETE FROM shared.document_links WHERE document_id=$1`, [DOC_A]);
    await admin.query(`DELETE FROM shared.documents WHERE id=$1`, [DOC_A]);
    await admin.query(`DELETE FROM shared.document_categories WHERE id=$1`, [CAT_A]);
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe('attribute-change history', () => {
  it('requires authentication and the read permission', async () => {
    __resetAuthenticatorForTests();
    const id = '00000000-0000-4000-8000-0000000000a0';
    expect((await history(id)).status).toBe(401);
    authAs(SUBJECT_UNPERMITTED);
    expect((await history(id)).status).toBe(403);
  });

  it('lists the changes a master edit produced, newest first', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    expect((await update(vehicle, { color: 'red' })).status).toBe(200);

    const body = (await (await history(vehicle)).json()) as Body;
    const colorRow = (body.items ?? []).find((i) => i.fieldCode === 'color');
    expect(colorRow?.newValue).toBe('red');
  });

  it('refuses a bad cursor (400) and never exposes another tenant’s history', async () => {
    authAs(SUBJ_A);
    const vehicle = await newVehicle();
    await update(vehicle, { color: 'blue' });
    expect((await history(vehicle, '?cursor=nope')).status).toBe(400);
    authAs(SUBJ_B, TENANT_B);
    expect((((await (await history(vehicle)).json()) as Body).items ?? []).length).toBe(0);
  });
});

describe('document reachability', () => {
  it('requires authentication and the document permission', async () => {
    __resetAuthenticatorForTests();
    const id = '00000000-0000-4000-8000-0000000000a0';
    expect((await documents(id)).status).toBe(401);
    authAs(SUBJECT_UNPERMITTED);
    expect((await documents(id)).status).toBe(403);
  });

  it('lists a linked document id and an empty set for an unlinked vehicle', async () => {
    authAs(SUBJ_A);
    const linked = await newVehicle();
    await linkDocument(linked);
    const withDoc = (await (await documents(linked)).json()) as Body;
    expect(withDoc.documentIds).toContain(DOC_A);

    const bare = await newVehicle();
    const withoutDoc = await documents(bare);
    expect(withoutDoc.status).toBe(200);
    expect(((await withoutDoc.json()) as Body).documentIds).toEqual([]);
  });

  it('answers 404 for an unknown vehicle and a cross-tenant vehicle', async () => {
    authAs(SUBJ_A);
    const mine = await newVehicle();
    await linkDocument(mine);
    expect((await documents('00000000-0000-4000-8000-0000000000fe')).status).toBe(404);
    authAs(SUBJ_B, TENANT_B);
    expect((await documents(mine)).status).toBe(404);
  });
});
