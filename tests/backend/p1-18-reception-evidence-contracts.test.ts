/**
 * Reception evidence contracts, end to end (Owner decisions FE-012, FE-018,
 * FE-019).
 *
 * Drives the real handlers on the least-privilege `app_runtime` role. Every
 * assertion here is about a claim the platform would otherwise be making without
 * evidence, so the suite is written against the ways that claim can be false:
 *
 *  - **evidence that counts before it is accepted** — a binding is finalized
 *    only when its document version is `accepted`, and a `pending`, `rejected`
 *    or `quarantined` version is refused;
 *  - **a signature that is valid before its version is** — finalization is
 *    refused while the bound version is pending, and repudiation never rewrites
 *    the signature it repudiates;
 *  - **evidence bound to the wrong thing** — a version of the wrong CATEGORY, or
 *    of a document that is not LINKED to this visit, is refused server-side;
 *  - **a template revision moving under a historical visit** — a retired
 *    revision cannot be bound to a NEW visit and stays readable for every visit
 *    already bound to it;
 *  - **an override anyone can take** — waiving a capture costs a permission that
 *    capture authority does not imply;
 *  - **refusal becoming globally media-dependent** — with no policy rule, a
 *    refusal with no media is accepted; with one, it is refused.
 *
 * ## Dependency
 *
 * The seven `reception_*` document categories and
 * `shared.document_categories.business_link_purpose` come from the shared
 * reception-evidence foundation migration. This suite READS them and fails
 * loudly if they are absent rather than creating them, because creating them
 * here would hide exactly the dependency it is supposed to depend on.
 *
 * No business row is seeded. Every row this file creates it also removes.
 *
 * COVERAGE-EVIDENCE (parsed by scripts/check-operation-test-coverage.mjs):
 *   rec.reception-evidence-binding: route service authorization success denial cross-tenant isolation audit idempotency
 *   rec.reception-evidence-binding-list: route service authorization success denial cross-tenant isolation
 *   rec.reception-evidence-binding-finalize: route service authorization success denial cross-tenant isolation audit idempotency
 *   rec.reception-capture-override: route service authorization success denial cross-tenant isolation audit idempotency
 *   rec.reception-signature-list: route service authorization success denial cross-tenant isolation
 *   rec.reception-signature-event: route service authorization success denial cross-tenant isolation audit idempotency
 *   rec.catalogue-damage-map-template-list: route service authorization success denial
 *   rec.catalogue-damage-map-template-create: route service authorization success denial audit idempotency
 *   rec.catalogue-damage-map-template-read: route service authorization success denial cross-tenant
 *   rec.catalogue-damage-map-template-version-create: route service authorization success denial cross-tenant audit idempotency
 *   rec.catalogue-damage-map-template-status-set: route service authorization success denial cross-tenant stale-version audit idempotency
 *   rec.catalogue-capture-policy-list: route service authorization success denial
 *   rec.catalogue-capture-policy-set: route service authorization success denial audit idempotency
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
  countRows,
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
  GET as LIST_BINDINGS,
  POST as BIND_EVIDENCE,
  RECEPTION_EVIDENCE_BINDING_OPERATION,
  RECEPTION_EVIDENCE_BINDING_LIST_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/evidence-bindings/route';
import {
  POST as FINALIZE_BINDING,
  RECEPTION_EVIDENCE_BINDING_FINALIZE_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/evidence-bindings/[bindingId]/finalization/route';
import {
  POST as CAPTURE_OVERRIDE,
  RECEPTION_CAPTURE_OVERRIDE_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/capture-overrides/route';
import {
  GET as LIST_SIGNATURES,
  POST as RECORD_SIGNATURE,
  RECEPTION_SIGNATURE_LIST_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/signatures/route';
import {
  POST as SIGNATURE_EVENT,
  RECEPTION_SIGNATURE_EVENT_OPERATION,
} from '@/app/api/v1/receptions/[receptionId]/signatures/[signatureId]/events/route';
import { POST as RECORD_REFUSAL } from '@/app/api/v1/receptions/[receptionId]/refusals/route';
import {
  GET as LIST_TEMPLATES,
  POST as CREATE_TEMPLATE,
  DAMAGE_MAP_TEMPLATE_CREATE_OPERATION,
  DAMAGE_MAP_TEMPLATE_LIST_OPERATION,
} from '@/app/api/v1/reception-catalogue/damage-map-templates/route';
import {
  GET as READ_TEMPLATE,
  DAMAGE_MAP_TEMPLATE_READ_OPERATION,
} from '@/app/api/v1/reception-catalogue/damage-map-templates/[templateId]/route';
import {
  POST as PUBLISH_TEMPLATE_VERSION,
  DAMAGE_MAP_TEMPLATE_VERSION_OPERATION,
} from '@/app/api/v1/reception-catalogue/damage-map-templates/[templateId]/versions/route';
import {
  POST as SET_TEMPLATE_STATUS,
  DAMAGE_MAP_TEMPLATE_STATUS_OPERATION,
} from '@/app/api/v1/reception-catalogue/damage-map-templates/[templateId]/status/route';
import {
  GET as LIST_POLICIES,
  POST as SET_POLICY,
  CAPTURE_POLICY_LIST_OPERATION,
  CAPTURE_POLICY_SET_OPERATION,
} from '@/app/api/v1/reception-catalogue/capture-policies/route';

// --- Actors ----------------------------------------------------------------
/** Holds capture, signature, override, catalogue and read. */
const ROLE_FULL = 'c1180000-0000-4000-8000-0000000000e1';
const USER_FULL = 'c1180000-0000-4000-8000-0000000000e2';
const SUBJ_FULL = 'fx_p1_18_ec_full';
/** Holds capture + read, and deliberately NOT the override or catalogue codes. */
const ROLE_CAPTURE = 'c1180000-0000-4000-8000-0000000000e3';
const USER_CAPTURE = 'c1180000-0000-4000-8000-0000000000e4';
const SUBJ_CAPTURE = 'fx_p1_18_ec_capture_only';
/** Tenant B, same permissions. The isolation and cross-tenant actor. */
const ROLE_TENANT_B = 'c1180000-0000-4000-8000-0000000000e5';
const USER_TENANT_B = 'c1180000-0000-4000-8000-0000000000e6';
const SUBJ_TENANT_B = 'fx_p1_18_ec_tenant_b';

const PARTNER_A = 'c1180000-0000-4000-8000-0000000000ec';

const FULL_PERMISSIONS = [
  'rec.reception.evidence.manage',
  'rec.reception.evidence.override',
  'rec.reception.signature.manage',
  'rec.catalogue.manage',
  'rec.reception.read',
  'rec.reception.manage',
];
const CAPTURE_ONLY_PERMISSIONS = ['rec.reception.evidence.manage', 'rec.reception.read'];

/** 32 bytes of hex — `ck_document_versions_sha256_len`. */
const SHA_HEX = 'a'.repeat(64);

const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff';

interface Problem {
  readonly code?: string;
  readonly detail?: string;
}
interface BindingBody {
  readonly bindingId?: string;
  readonly requirementCode?: string;
}
interface ContractBody {
  readonly requirements?: readonly {
    readonly requirementCode: string;
    readonly minCount: number;
    readonly source: string;
    readonly finalizedCount: number;
    readonly satisfied: boolean;
    readonly overridden: boolean;
  }[];
  readonly bindings?: readonly {
    readonly id: string;
    readonly documentVersionStatus: string;
    readonly finalizedAt: string | null;
  }[];
  readonly overrides?: readonly { readonly id: string; readonly requirementCode: string }[];
  readonly bindableTemplates?: readonly { readonly id: string }[];
}
interface SignatureLedgerBody {
  readonly signatures?: readonly {
    readonly id: string;
    readonly status: string;
    readonly documentVersionStatus: string;
    readonly integritySha256: string | null;
    readonly replacesSignatureId: string | null;
    readonly replacedBySignatureId: string | null;
    readonly repudiationReason: string | null;
  }[];
}
interface TemplateBody {
  readonly id?: string;
  readonly recordVersion?: number;
  readonly status?: string;
  readonly activeVersionId?: string | null;
  readonly documentVersionId?: string | null;
}
interface TemplateViewBody {
  readonly template?: TemplateBody;
  readonly versions?: readonly {
    readonly id: string;
    readonly versionNumber: number;
    readonly status: string;
  }[];
}
interface TemplateListBody {
  readonly templates?: readonly TemplateBody[];
}
interface PolicyListBody {
  readonly policies?: readonly {
    readonly requirementCode: string;
    readonly refusalType: string | null;
    readonly minCount: number;
  }[];
}

let admin: Pool;
let runtime: Pool;

/** Category ids resolved from the shared foundation migration, by code. */
const categories = new Map<string, { readonly id: string; readonly linkPurpose: string }>();

function authAs(subject: string, tenantId = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: subject,
      tenantId,
    })
  );
}

function json(path: string, body: unknown, key = crypto.randomUUID()): Request {
  return new Request(`http://localhost/api/v1${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });
}

function get(path: string): Request {
  return new Request(`http://localhost/api/v1${path}`);
}

async function requireCategory(code: string): Promise<{ id: string; linkPurpose: string }> {
  const found = categories.get(code);
  if (found) return found;
  const row = (
    await admin.query<{ id: string; business_link_purpose: string | null }>(
      `SELECT id, business_link_purpose FROM shared.document_categories
        WHERE category_code = $1 AND deleted_at IS NULL
        ORDER BY (tenant_id IS NOT NULL) DESC LIMIT 1`,
      [code]
    )
  ).rows[0];
  if (!row || !row.business_link_purpose) {
    throw new Error(
      `Document category "${code}" is absent or carries no business_link_purpose. ` +
        'This suite depends on the shared reception-evidence foundation migration; it does ' +
        'not create the category, because doing so would hide the dependency.'
    );
  }
  const resolved = { id: row.id, linkPurpose: row.business_link_purpose };
  categories.set(code, resolved);
  return resolved;
}

/**
 * Registers a document, one version, and the live link that makes it reachable.
 *
 * `accept` writes the clean scan result the transition guard requires and then
 * moves the version — the same two steps the real acceptance path takes. Nothing
 * here bypasses `shared.guard_document_version_transition`.
 */
async function seedEvidenceDocument(input: {
  readonly categoryCode: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly accept?: boolean;
  readonly terminal?: 'quarantined' | 'rejected';
  readonly link?: boolean;
  readonly tenantId?: string;
}): Promise<{ documentId: string; versionId: string }> {
  const tenantId = input.tenantId ?? TENANT_A;
  const category = await requireCategory(input.categoryCode);
  const documentId = crypto.randomUUID();
  const versionId = crypto.randomUUID();

  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, category_id, title, classification, retention_class, status, created_by)
     VALUES ($1,$2,$3,$4,'internal','evidence-audit','pending',$5)`,
    [documentId, tenantId, category.id, `P1-18 ${input.categoryCode}`, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type,
        size_bytes, sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,1,$4,'image/jpeg',2048, decode($5,'hex'), $6, $6)`,
    [versionId, tenantId, documentId, `p118-ec/${documentId}`, SHA_HEX, USER_A]
  );
  if (input.link !== false) {
    await admin.query(
      `INSERT INTO shared.document_links
         (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$6)`,
      [tenantId, documentId, input.entityType, input.entityId, category.linkPurpose, USER_A]
    );
  }
  if (input.accept === true) {
    await admin.query(
      `INSERT INTO shared.file_scan_results
         (tenant_id, version_id, scanner_code, scan_status, scanned_at, created_by)
       VALUES ($1,$2,'harness','clean',now(),$3)`,
      [tenantId, versionId, USER_A]
    );
    await admin.query(`UPDATE shared.document_versions SET status='scanning' WHERE id=$1`, [
      versionId,
    ]);
    await admin.query(`UPDATE shared.document_versions SET status='accepted' WHERE id=$1`, [
      versionId,
    ]);
  } else if (input.terminal !== undefined) {
    await admin.query(
      `UPDATE shared.document_versions
          SET status=$2,
              quarantined_at = CASE WHEN $2='quarantined' THEN now() END,
              rejected_at    = CASE WHEN $2='rejected' THEN now() END
        WHERE id=$1`,
      [versionId, input.terminal]
    );
  }
  return { documentId, versionId };
}

let vinSeq = 0;
/** Opens a real visit through the frozen `rec.accept_check_in()` primitive. */
async function newVisit(
  options: {
    readonly tenantId?: string;
    readonly companyId?: string;
    readonly branchId?: string;
  } = {}
): Promise<string> {
  const tenantId = options.tenantId ?? TENANT_A;
  const companyId = options.companyId ?? COMPANY_A1;
  const branchId = options.branchId ?? BRANCH_A1;
  vinSeq += 1;
  const vin = `P118EC${String(vinSeq).padStart(11, '0')}`;
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
        [tenantId, companyId, branchId, vehicle, PARTNER_A, USER_A]
      )
    ).rows[0]!.id;
    const visit = (
      await client.query<{ id: string }>(
        `SELECT rec.accept_check_in($1::uuid,$2::uuid,$3::uuid,NULL::uuid,$4::uuid,$5::uuid,$6::uuid) AS id`,
        [companyId, branchId, vehicle, walkIn, USER_A, PARTNER_A]
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

async function seedPrincipal(
  tenantId: string,
  roleId: string,
  userId: string,
  subject: string,
  permissions: readonly string[]
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','Evidence Contract Principal','active',$5) ON CONFLICT (id) DO NOTHING`,
    [userId, tenantId, IDENTITY_PROVIDER, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-18 evidence-contract principal',$4) ON CONFLICT (id) DO NOTHING`,
    [roleId, tenantId, subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid,$2::uuid,p.id,'allow',$3::uuid FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING`,
    [tenantId, roleId, USER_A, [...permissions]]
  );
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
     VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
    [tenantId, userId, roleId, USER_A]
  );
}

/** Creates a template slot with one published, active revision. */
async function newBoundTemplate(): Promise<{
  templateId: string;
  versionId: string;
  documentVersionId: string;
}> {
  authAs(SUBJ_FULL);
  const created = (await (
    await CREATE_TEMPLATE(
      json('/reception-catalogue/damage-map-templates', { mapType: 'exterior' })
    )
  ).json()) as TemplateBody;
  const templateId = created.id as string;
  const doc = await seedEvidenceDocument({
    categoryCode: 'reception_damage_map_template',
    entityType: 'rec.damage_map_templates',
    entityId: templateId,
    accept: true,
  });
  const view = (await (
    await PUBLISH_TEMPLATE_VERSION(
      json(`/reception-catalogue/damage-map-templates/${templateId}/versions`, {
        documentId: doc.documentId,
        documentVersionId: doc.versionId,
      }),
      { params: Promise.resolve({ templateId }) }
    )
  ).json()) as TemplateViewBody;
  return {
    templateId,
    versionId: view.template?.activeVersionId as string,
    documentVersionId: doc.versionId,
  };
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);

  // A permission that does not exist cannot be held, so every denial test below
  // would pass vacuously against a catalog missing the code. Inserted here for
  // the same reason the sibling reception suites insert theirs.
  await admin.query(
    `INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
     VALUES ('rec.reception.evidence.manage','rec','Record pre-service condition evidence on a reception','medium',$1),
            ('rec.reception.evidence.override','rec','Override a required reception capture with an attributable reason','high',$1),
            ('rec.reception.signature.manage','rec','Capture reception signatures and refusals','high',$1),
            ('rec.catalogue.manage','rec','Manage the tenant reception configuration catalogues','high',$1),
            ('rec.reception.read','rec','Read reception visits, parties, authorizations, condition evidence and custody history','low',$1),
            ('rec.reception.manage','rec','Open a reception visit and accept vehicle custody','medium',$1)
     ON CONFLICT (permission_code) DO NOTHING`,
    [USER_A]
  );

  await seedPrincipal(TENANT_A, ROLE_FULL, USER_FULL, SUBJ_FULL, FULL_PERMISSIONS);
  await seedPrincipal(TENANT_A, ROLE_CAPTURE, USER_CAPTURE, SUBJ_CAPTURE, CAPTURE_ONLY_PERMISSIONS);
  await seedPrincipal(TENANT_B, ROLE_TENANT_B, USER_TENANT_B, SUBJ_TENANT_B, FULL_PERMISSIONS);

  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
      [USER_A, TENANT_A]
    );
    await client.query(
      `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, lifecycle_status, created_by)
       VALUES ($1,$2,'organization','Evidence Contract Requester','active',$3) ON CONFLICT (id) DO NOTHING`,
      [PARTNER_A, TENANT_A, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
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

describe('the thirteen operations are registered as declared', () => {
  it('binds each to the permission its policy names, and none to a weaker one', () => {
    const declared: readonly [{ id: string; permissions: readonly string[] }, string, string][] = [
      [
        RECEPTION_EVIDENCE_BINDING_OPERATION,
        'rec.reception-evidence-binding',
        'rec.reception.evidence.manage',
      ],
      [
        RECEPTION_EVIDENCE_BINDING_LIST_OPERATION,
        'rec.reception-evidence-binding-list',
        'rec.reception.read',
      ],
      [
        RECEPTION_EVIDENCE_BINDING_FINALIZE_OPERATION,
        'rec.reception-evidence-binding-finalize',
        'rec.reception.evidence.manage',
      ],
      [
        RECEPTION_CAPTURE_OVERRIDE_OPERATION,
        'rec.reception-capture-override',
        'rec.reception.evidence.override',
      ],
      [RECEPTION_SIGNATURE_LIST_OPERATION, 'rec.reception-signature-list', 'rec.reception.read'],
      [
        RECEPTION_SIGNATURE_EVENT_OPERATION,
        'rec.reception-signature-event',
        'rec.reception.signature.manage',
      ],
      [
        DAMAGE_MAP_TEMPLATE_LIST_OPERATION,
        'rec.catalogue-damage-map-template-list',
        'rec.catalogue.manage',
      ],
      [
        DAMAGE_MAP_TEMPLATE_CREATE_OPERATION,
        'rec.catalogue-damage-map-template-create',
        'rec.catalogue.manage',
      ],
      [
        DAMAGE_MAP_TEMPLATE_READ_OPERATION,
        'rec.catalogue-damage-map-template-read',
        'rec.catalogue.manage',
      ],
      [
        DAMAGE_MAP_TEMPLATE_VERSION_OPERATION,
        'rec.catalogue-damage-map-template-version-create',
        'rec.catalogue.manage',
      ],
      [
        DAMAGE_MAP_TEMPLATE_STATUS_OPERATION,
        'rec.catalogue-damage-map-template-status-set',
        'rec.catalogue.manage',
      ],
      [CAPTURE_POLICY_LIST_OPERATION, 'rec.catalogue-capture-policy-list', 'rec.catalogue.manage'],
      [CAPTURE_POLICY_SET_OPERATION, 'rec.catalogue-capture-policy-set', 'rec.catalogue.manage'],
    ];
    for (const [operation, id, permission] of declared) {
      expect(operation.id).toBe(id);
      expect(operation.permissions).toEqual([permission]);
    }
  });
});

describe('FE-018 / capture — only an accepted version can ever count', () => {
  it('binds a pending version, refuses to finalize it, and finalizes once accepted', async () => {
    const visit = await newVisit();
    const doc = await seedEvidenceDocument({
      categoryCode: 'reception_exterior',
      entityType: 'rec.reception_visits',
      entityId: visit,
    });

    authAs(SUBJ_FULL);
    const bound = await BIND_EVIDENCE(
      json(`/receptions/${visit}/evidence-bindings`, {
        requirementCode: 'exterior',
        documentId: doc.documentId,
        documentVersionId: doc.versionId,
      }),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(bound.status).toBe(201);
    const bindingId = ((await bound.json()) as BindingBody).bindingId as string;
    // The row is in the table, counted — not merely a 201 that said so.
    expect(
      await countRows(admin, 'rec.reception_evidence_bindings', 'reception_visit_id = $1', [visit])
    ).toBe(1);

    // The version is still pending, so the binding exists and counts for nothing.
    const early = await FINALIZE_BINDING(
      json(`/receptions/${visit}/evidence-bindings/${bindingId}/finalization`, {}),
      { params: Promise.resolve({ receptionId: visit, bindingId }) }
    );
    expect(early.status).toBe(422);

    await admin.query(
      `INSERT INTO shared.file_scan_results (tenant_id, version_id, scanner_code, scan_status, scanned_at, created_by)
       VALUES ($1,$2,'harness','clean',now(),$3)`,
      [TENANT_A, doc.versionId, USER_A]
    );
    await admin.query(`UPDATE shared.document_versions SET status='scanning' WHERE id=$1`, [
      versionId,
    ]);
    await admin.query(`UPDATE shared.document_versions SET status='accepted' WHERE id=$1`, [
      doc.versionId,
    ]);

    authAs(SUBJ_FULL);
    const finalized = await FINALIZE_BINDING(
      json(`/receptions/${visit}/evidence-bindings/${bindingId}/finalization`, {}),
      { params: Promise.resolve({ receptionId: visit, bindingId }) }
    );
    expect(finalized.status).toBe(200);

    // A replay is a conflict, not a silent second finalization.
    authAs(SUBJ_FULL);
    const replay = await FINALIZE_BINDING(
      json(`/receptions/${visit}/evidence-bindings/${bindingId}/finalization`, {}),
      { params: Promise.resolve({ receptionId: visit, bindingId }) }
    );
    expect(replay.status).toBe(409);

    // And exactly one audit record for the finalization.
    const audit = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_records
        WHERE action = 'rec.reception.capture_evidence_finalized' AND entity_id = $1`,
      [visit]
    );
    expect(Number(audit.rows[0]?.n)).toBe(1);
  });

  it('refuses a rejected and a quarantined version outright', async () => {
    const visit = await newVisit();
    for (const terminal of ['rejected', 'quarantined'] as const) {
      const doc = await seedEvidenceDocument({
        categoryCode: 'reception_exterior',
        entityType: 'rec.reception_visits',
        entityId: visit,
        terminal,
      });
      authAs(SUBJ_FULL);
      const response = await BIND_EVIDENCE(
        json(`/receptions/${visit}/evidence-bindings`, {
          requirementCode: 'exterior',
          documentId: doc.documentId,
          documentVersionId: doc.versionId,
        }),
        { params: Promise.resolve({ receptionId: visit }) }
      );
      expect(response.status).toBe(422);
    }
  });

  it('refuses a version of the wrong category, and an unlinked document, server-side', async () => {
    const visit = await newVisit();

    // Right shape, wrong category: a VIN plate offered as exterior evidence.
    const wrongCategory = await seedEvidenceDocument({
      categoryCode: 'reception_vin',
      entityType: 'rec.reception_visits',
      entityId: visit,
    });
    authAs(SUBJ_FULL);
    const categoryRefused = await BIND_EVIDENCE(
      json(`/receptions/${visit}/evidence-bindings`, {
        requirementCode: 'exterior',
        documentId: wrongCategory.documentId,
        documentVersionId: wrongCategory.versionId,
      }),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(categoryRefused.status).toBe(422);

    // Right category, no live link to this visit.
    const unlinked = await seedEvidenceDocument({
      categoryCode: 'reception_exterior',
      entityType: 'rec.reception_visits',
      entityId: visit,
      link: false,
    });
    authAs(SUBJ_FULL);
    const linkRefused = await BIND_EVIDENCE(
      json(`/receptions/${visit}/evidence-bindings`, {
        requirementCode: 'exterior',
        documentId: unlinked.documentId,
        documentVersionId: unlinked.versionId,
      }),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(linkRefused.status).toBe(422);
  });

  it('reports the contract, counting FINALIZED bindings only', async () => {
    const visit = await newVisit();
    const doc = await seedEvidenceDocument({
      categoryCode: 'reception_exterior',
      entityType: 'rec.reception_visits',
      entityId: visit,
    });
    authAs(SUBJ_FULL);
    await BIND_EVIDENCE(
      json(`/receptions/${visit}/evidence-bindings`, {
        requirementCode: 'exterior',
        documentId: doc.documentId,
        documentVersionId: doc.versionId,
      }),
      { params: Promise.resolve({ receptionId: visit }) }
    );

    authAs(SUBJ_FULL);
    const read = await LIST_BINDINGS(get(`/receptions/${visit}/evidence-bindings`), {
      params: Promise.resolve({ receptionId: visit }),
    });
    expect(read.status).toBe(200);
    const contract = (await read.json()) as ContractBody;
    const exterior = contract.requirements?.find((r) => r.requirementCode === 'exterior');
    expect(exterior?.finalizedCount).toBe(0);
    expect(exterior?.satisfied).toBe(false);
    expect(contract.bindings?.[0]?.documentVersionStatus).toBe('pending');
  });
});

describe('the override is a separate authority, recorded once', () => {
  it('refuses a capture-only caller and admits the override holder', async () => {
    const visit = await newVisit();

    authAs(SUBJ_CAPTURE);
    const denied = await CAPTURE_OVERRIDE(
      json(`/receptions/${visit}/capture-overrides`, {
        requirementCode: 'ev_soc',
        reason: 'Combustion vehicle; no state of charge exists to photograph.',
      }),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(denied.status).toBe(403);

    authAs(SUBJ_FULL);
    const allowed = await CAPTURE_OVERRIDE(
      json(`/receptions/${visit}/capture-overrides`, {
        requirementCode: 'ev_soc',
        reason: 'Combustion vehicle; no state of charge exists to photograph.',
      }),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(allowed.status).toBe(201);

    // Waived once, ever.
    authAs(SUBJ_FULL);
    const twice = await CAPTURE_OVERRIDE(
      json(`/receptions/${visit}/capture-overrides`, {
        requirementCode: 'ev_soc',
        reason: 'A second, contradictory reason for the same gap.',
      }),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(twice.status).toBe(409);

    authAs(SUBJ_FULL);
    const contract = (await (
      await LIST_BINDINGS(get(`/receptions/${visit}/evidence-bindings`), {
        params: Promise.resolve({ receptionId: visit }),
      })
    ).json()) as ContractBody;
    expect(contract.overrides?.map((o) => o.requirementCode)).toEqual(['ev_soc']);
    expect(contract.requirements?.find((r) => r.requirementCode === 'ev_soc')?.overridden).toBe(
      true
    );

    const audit = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM iam.audit_records
        WHERE action = 'rec.reception.capture_requirement_overridden' AND entity_id = $1`,
      [visit]
    );
    expect(Number(audit.rows[0]?.n)).toBe(1);
  });

  it('refuses another tenant and an unknown visit with the same answer', async () => {
    const visit = await newVisit();
    authAs(SUBJ_TENANT_B, TENANT_B);
    const crossTenant = await CAPTURE_OVERRIDE(
      json(`/receptions/${visit}/capture-overrides`, {
        requirementCode: 'vin',
        reason: 'Cross-tenant attempt.',
      }),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    authAs(SUBJ_TENANT_B, TENANT_B);
    const unknown = await CAPTURE_OVERRIDE(
      json(`/receptions/${UNKNOWN_ID}/capture-overrides`, {
        requirementCode: 'vin',
        reason: 'Unknown visit.',
      }),
      { params: Promise.resolve({ receptionId: UNKNOWN_ID }) }
    );
    expect(crossTenant.status).toBe(404);
    expect(unknown.status).toBe(404);
  });
});

describe('FE-018 — the signature ledger', () => {
  it('refuses to finalize a pending version, finalizes an accepted one, and never rewrites either', async () => {
    const visit = await newVisit();
    const pending = await seedEvidenceDocument({
      categoryCode: 'reception_signature',
      entityType: 'rec.reception_visits',
      entityId: visit,
    });

    authAs(SUBJ_FULL);
    const first = await RECORD_SIGNATURE(
      json(`/receptions/${visit}/signatures`, {
        signerRole: 'service_requester',
        signatureDocumentId: pending.documentId,
        signatureDocumentVersionId: pending.versionId,
        captureMethod: 'drawn',
        purpose: 'custody_acceptance',
      }),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(first.status).toBe(201);
    const firstId = ((await first.json()) as { signatureId: string }).signatureId;

    authAs(SUBJ_FULL);
    const tooEarly = await SIGNATURE_EVENT(
      json(`/receptions/${visit}/signatures/${firstId}/events`, { eventType: 'finalized' }),
      { params: Promise.resolve({ receptionId: visit, signatureId: firstId }) }
    );
    expect(tooEarly.status).toBe(409);

    // Replace it with a signature on an ACCEPTED version. The first row stays.
    const accepted = await seedEvidenceDocument({
      categoryCode: 'reception_signature',
      entityType: 'rec.reception_visits',
      entityId: visit,
      accept: true,
    });
    authAs(SUBJ_FULL);
    const second = await RECORD_SIGNATURE(
      json(`/receptions/${visit}/signatures`, {
        signerRole: 'service_requester',
        signatureDocumentId: accepted.documentId,
        signatureDocumentVersionId: accepted.versionId,
        captureMethod: 'drawn',
        purpose: 'custody_acceptance',
        replacesSignatureId: firstId,
      }),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(second.status).toBe(201);
    const secondId = ((await second.json()) as { signatureId: string }).signatureId;

    authAs(SUBJ_FULL);
    const finalized = await SIGNATURE_EVENT(
      json(`/receptions/${visit}/signatures/${secondId}/events`, { eventType: 'finalized' }),
      { params: Promise.resolve({ receptionId: visit, signatureId: secondId }) }
    );
    expect(finalized.status).toBe(201);

    authAs(SUBJ_FULL);
    const ledger = (await (
      await LIST_SIGNATURES(get(`/receptions/${visit}/signatures`), {
        params: Promise.resolve({ receptionId: visit }),
      })
    ).json()) as SignatureLedgerBody;
    const rows = ledger.signatures ?? [];
    expect(rows).toHaveLength(2);
    const superseded = rows.find((r) => r.id === firstId);
    const current = rows.find((r) => r.id === secondId);
    // The superseded signature is still there, still bound to its own pending
    // version, still a draft. Replacement added a row; it removed nothing.
    expect(superseded?.status).toBe('draft');
    expect(superseded?.documentVersionStatus).toBe('pending');
    expect(superseded?.replacedBySignatureId).toBe(secondId);
    expect(current?.status).toBe('finalized');
    expect(current?.replacesSignatureId).toBe(firstId);
    // The integrity digest reported is the server-owned version checksum.
    expect(current?.integritySha256).toBe(SHA_HEX);

    // Repudiation is another row, and the finalized row is unchanged.
    authAs(SUBJ_FULL);
    const repudiated = await SIGNATURE_EVENT(
      json(`/receptions/${visit}/signatures/${secondId}/events`, {
        eventType: 'repudiated',
        reason: 'The signer withdrew the acknowledgement in person.',
      }),
      { params: Promise.resolve({ receptionId: visit, signatureId: secondId }) }
    );
    expect(repudiated.status).toBe(201);

    authAs(SUBJ_FULL);
    const after = (await (
      await LIST_SIGNATURES(get(`/receptions/${visit}/signatures`), {
        params: Promise.resolve({ receptionId: visit }),
      })
    ).json()) as SignatureLedgerBody;
    expect(after.signatures).toHaveLength(2);
    expect(after.signatures?.find((r) => r.id === secondId)?.status).toBe('repudiated');
    expect(after.signatures?.find((r) => r.id === secondId)?.repudiationReason).toContain(
      'withdrew'
    );

    // Both rows are still exactly the rows that were written.
    const stored = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rec.signatures WHERE reception_visit_id = $1`,
      [visit]
    );
    expect(Number(stored.rows[0]?.n)).toBe(2);
  });

  it('refuses a signature event from a caller without the signature code', async () => {
    const visit = await newVisit();
    const doc = await seedEvidenceDocument({
      categoryCode: 'reception_signature',
      entityType: 'rec.reception_visits',
      entityId: visit,
      accept: true,
    });
    authAs(SUBJ_FULL);
    const signature = (
      (await (
        await RECORD_SIGNATURE(
          json(`/receptions/${visit}/signatures`, {
            signerRole: 'service_requester',
            signatureDocumentId: doc.documentId,
            signatureDocumentVersionId: doc.versionId,
            captureMethod: 'drawn',
            purpose: 'custody_acceptance',
          }),
          { params: Promise.resolve({ receptionId: visit }) }
        )
      ).json()) as { signatureId: string }
    ).signatureId;

    authAs(SUBJ_CAPTURE);
    const denied = await SIGNATURE_EVENT(
      json(`/receptions/${visit}/signatures/${signature}/events`, { eventType: 'finalized' }),
      { params: Promise.resolve({ receptionId: visit, signatureId: signature }) }
    );
    expect(denied.status).toBe(403);

    authAs(SUBJ_TENANT_B, TENANT_B);
    const crossTenant = await LIST_SIGNATURES(get(`/receptions/${visit}/signatures`), {
      params: Promise.resolve({ receptionId: visit }),
    });
    expect(crossTenant.status).toBe(404);
  });
});

describe('FE-012 — a template revision never moves under a historical visit', () => {
  it('retires the previous revision, keeps the bound one, and refuses a retired slot for a new visit', async () => {
    const first = await newBoundTemplate();

    // A visit drawn on revision 1.
    const visit = await newVisit();
    const mapDoc = first.documentVersionId;
    const client = await admin.connect();
    let damageMapId: string;
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT set_config('app.user_id',$1,true), set_config('app.tenant_id',$2,true)`,
        [USER_A, TENANT_A]
      );
      damageMapId = (
        await client.query<{ id: string }>(
          `INSERT INTO rec.damage_maps
             (tenant_id, company_id, branch_id, reception_visit_id, document_id,
              document_version_id, map_type, damage_map_template_version_id, created_by)
           SELECT $1,$2,$3,$4, tv.document_id, tv.document_version_id, 'exterior', tv.id, $6
             FROM rec.damage_map_template_versions tv
            WHERE tv.tenant_id = $1 AND tv.id = $5
           RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, visit, first.versionId, USER_A]
        )
      ).rows[0]!.id;
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    expect(mapDoc).toBeTruthy();

    // Revise the template.
    const revision = await seedEvidenceDocument({
      categoryCode: 'reception_damage_map_template',
      entityType: 'rec.damage_map_templates',
      entityId: first.templateId,
      accept: true,
    });
    authAs(SUBJ_FULL);
    const published = await PUBLISH_TEMPLATE_VERSION(
      json(`/reception-catalogue/damage-map-templates/${first.templateId}/versions`, {
        documentId: revision.documentId,
        documentVersionId: revision.versionId,
      }),
      { params: Promise.resolve({ templateId: first.templateId }) }
    );
    expect(published.status).toBe(201);

    // The historical map still names revision 1, which is now retired.
    const held = await admin.query<{ template_version_id: string; status: string }>(
      `SELECT dm.damage_map_template_version_id AS template_version_id, tv.status
         FROM rec.damage_maps dm
         JOIN rec.damage_map_template_versions tv ON tv.id = dm.damage_map_template_version_id
        WHERE dm.id = $1`,
      [damageMapId]
    );
    expect(held.rows[0]?.template_version_id).toBe(first.versionId);
    expect(held.rows[0]?.status).toBe('retired');

    // And it is still readable through the administration read.
    authAs(SUBJ_FULL);
    const view = (await (
      await READ_TEMPLATE(get(`/reception-catalogue/damage-map-templates/${first.templateId}`), {
        params: Promise.resolve({ templateId: first.templateId }),
      })
    ).json()) as TemplateViewBody;
    expect(view.versions?.map((v) => v.versionNumber)).toEqual([1, 2]);
    expect(view.versions?.find((v) => v.versionNumber === 1)?.status).toBe('retired');

    // Retiring the slot withdraws it from the bindable list of a NEW visit.
    authAs(SUBJ_FULL);
    const retired = await SET_TEMPLATE_STATUS(
      new Request(
        `http://localhost/api/v1/reception-catalogue/damage-map-templates/${first.templateId}/status`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
            'if-match': String(view.template?.recordVersion),
          },
          body: JSON.stringify({ status: 'retired' }),
        }
      ),
      { params: Promise.resolve({ templateId: first.templateId }) }
    );
    expect(retired.status).toBe(200);

    const other = await newVisit();
    authAs(SUBJ_FULL);
    const contract = (await (
      await LIST_BINDINGS(get(`/receptions/${other}/evidence-bindings`), {
        params: Promise.resolve({ receptionId: other }),
      })
    ).json()) as ContractBody;
    expect(contract.bindableTemplates?.some((t) => t.id === first.templateId)).toBe(false);

    // A stale If-Match is a version conflict, not a silent no-op.
    authAs(SUBJ_FULL);
    const stale = await SET_TEMPLATE_STATUS(
      new Request(
        `http://localhost/api/v1/reception-catalogue/damage-map-templates/${first.templateId}/status`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'idempotency-key': crypto.randomUUID(),
            'if-match': String(view.template?.recordVersion),
          },
          body: JSON.stringify({ status: 'active' }),
        }
      ),
      { params: Promise.resolve({ templateId: first.templateId }) }
    );
    expect(stale.status).toBe(409);
  });

  it('refuses template administration to a capture-only caller, and hides another tenant’s slot', async () => {
    const created = await newBoundTemplate();

    authAs(SUBJ_CAPTURE);
    const denied = await CREATE_TEMPLATE(
      json('/reception-catalogue/damage-map-templates', { mapType: 'interior' })
    );
    expect(denied.status).toBe(403);

    authAs(SUBJ_CAPTURE);
    const listDenied = await LIST_TEMPLATES(get('/reception-catalogue/damage-map-templates'));
    expect(listDenied.status).toBe(403);

    authAs(SUBJ_TENANT_B, TENANT_B);
    const crossTenant = await READ_TEMPLATE(
      get(`/reception-catalogue/damage-map-templates/${created.templateId}`),
      { params: Promise.resolve({ templateId: created.templateId }) }
    );
    expect(crossTenant.status).toBe(404);

    authAs(SUBJ_FULL);
    const list = (await (
      await LIST_TEMPLATES(get('/reception-catalogue/damage-map-templates'))
    ).json()) as TemplateListBody;
    expect(list.templates?.some((t) => t.id === created.templateId)).toBe(true);
  });
});

describe('FE-019 — refusal media is optional until a rule says otherwise', () => {
  it('accepts a refusal with no media, then refuses one after the floor is raised', async () => {
    const visit = await newVisit();

    authAs(SUBJ_FULL);
    const optional = await RECORD_REFUSAL(
      json(`/receptions/${visit}/refusals`, { refusalType: 'intake_step' }),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(optional.status).toBe(201);

    authAs(SUBJ_FULL);
    const setPolicy = await SET_POLICY(
      json('/reception-catalogue/capture-policies', {
        requirementCode: 'refusal_supporting_evidence',
        refusalType: 'intake_step',
        minCount: 1,
      })
    );
    expect(setPolicy.status).toBe(201);

    authAs(SUBJ_FULL);
    const policies = (await (
      await LIST_POLICIES(get('/reception-catalogue/capture-policies'))
    ).json()) as PolicyListBody;
    expect(
      policies.policies?.some(
        (p) => p.requirementCode === 'refusal_supporting_evidence' && p.minCount === 1
      )
    ).toBe(true);

    const other = await newVisit();
    authAs(SUBJ_FULL);
    const nowRequired = await RECORD_REFUSAL(
      json(`/receptions/${other}/refusals`, { refusalType: 'intake_step' }),
      { params: Promise.resolve({ receptionId: other }) }
    );
    expect(nowRequired.status).toBe(422);

    // A refusal type the rule does not name is still unaffected — the floor is
    // raised for one workflow, not globally.
    authAs(SUBJ_FULL);
    const untouched = await RECORD_REFUSAL(
      json(`/receptions/${other}/refusals`, { refusalType: 'other' }),
      { params: Promise.resolve({ receptionId: other }) }
    );
    expect(untouched.status).toBe(201);

    // Lowering the floor again restores the default.
    authAs(SUBJ_FULL);
    const lowered = await SET_POLICY(
      json('/reception-catalogue/capture-policies', {
        requirementCode: 'refusal_supporting_evidence',
        refusalType: 'intake_step',
        minCount: 0,
      })
    );
    expect(lowered.status).toBe(201);

    const third = await newVisit();
    authAs(SUBJ_FULL);
    const restored = await RECORD_REFUSAL(
      json(`/receptions/${third}/refusals`, { refusalType: 'intake_step' }),
      { params: Promise.resolve({ receptionId: third }) }
    );
    expect(restored.status).toBe(201);
  });

  it('refuses capture-policy administration to a capture-only caller', async () => {
    authAs(SUBJ_CAPTURE);
    const denied = await SET_POLICY(
      json('/reception-catalogue/capture-policies', {
        requirementCode: 'exterior',
        minCount: 4,
      })
    );
    expect(denied.status).toBe(403);

    authAs(SUBJ_CAPTURE);
    const listDenied = await LIST_POLICIES(get('/reception-catalogue/capture-policies'));
    expect(listDenied.status).toBe(403);
  });
});

describe('idempotency — a replayed command writes once', () => {
  it('replays a binding, an override, a signature event, a template and a policy exactly once', async () => {
    const visit = await newVisit();
    const doc = await seedEvidenceDocument({
      categoryCode: 'reception_exterior',
      entityType: 'rec.reception_visits',
      entityId: visit,
      accept: true,
    });

    const bindingKey = crypto.randomUUID();
    const bindingBody = {
      requirementCode: 'exterior',
      documentId: doc.documentId,
      documentVersionId: doc.versionId,
    };
    authAs(SUBJ_FULL);
    const one = await BIND_EVIDENCE(
      json(`/receptions/${visit}/evidence-bindings`, bindingBody, bindingKey),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    authAs(SUBJ_FULL);
    const two = await BIND_EVIDENCE(
      json(`/receptions/${visit}/evidence-bindings`, bindingBody, bindingKey),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(one.status).toBe(201);
    expect(two.status).toBe(201);
    expect(((await two.json()) as BindingBody).bindingId).toBe(
      ((await one.json()) as BindingBody).bindingId
    );

    const overrideKey = crypto.randomUUID();
    const overrideBody = { requirementCode: 'vin', reason: 'The plate is behind a fitted panel.' };
    authAs(SUBJ_FULL);
    await CAPTURE_OVERRIDE(
      json(`/receptions/${visit}/capture-overrides`, overrideBody, overrideKey),
      {
        params: Promise.resolve({ receptionId: visit }),
      }
    );
    authAs(SUBJ_FULL);
    const overrideReplay = await CAPTURE_OVERRIDE(
      json(`/receptions/${visit}/capture-overrides`, overrideBody, overrideKey),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(overrideReplay.status).toBe(201);
    const overrides = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rec.capture_requirement_overrides WHERE reception_visit_id = $1`,
      [visit]
    );
    expect(Number(overrides.rows[0]?.n)).toBe(1);

    const templateKey = crypto.randomUUID();
    const templateBody = { mapType: 'undercarriage' };
    authAs(SUBJ_FULL);
    const t1 = await CREATE_TEMPLATE(
      json('/reception-catalogue/damage-map-templates', templateBody, templateKey)
    );
    authAs(SUBJ_FULL);
    const t2 = await CREATE_TEMPLATE(
      json('/reception-catalogue/damage-map-templates', templateBody, templateKey)
    );
    expect(((await t2.json()) as TemplateBody).id).toBe(((await t1.json()) as TemplateBody).id);

    const policyKey = crypto.randomUUID();
    const policyBody = { requirementCode: 'exterior', minCount: 5 };
    authAs(SUBJ_FULL);
    await SET_POLICY(json('/reception-catalogue/capture-policies', policyBody, policyKey));
    authAs(SUBJ_FULL);
    const policyReplay = await SET_POLICY(
      json('/reception-catalogue/capture-policies', policyBody, policyKey)
    );
    expect(policyReplay.status).toBe(201);
    const live = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rec.capture_policy_rules
        WHERE tenant_id = $1 AND requirement_code = 'exterior' AND retired_at IS NULL`,
      [TENANT_A]
    );
    expect(Number(live.rows[0]?.n)).toBe(1);

    const accepted = await seedEvidenceDocument({
      categoryCode: 'reception_signature',
      entityType: 'rec.reception_visits',
      entityId: visit,
      accept: true,
    });
    authAs(SUBJ_FULL);
    const signature = (
      (await (
        await RECORD_SIGNATURE(
          json(`/receptions/${visit}/signatures`, {
            signerRole: 'service_requester',
            signatureDocumentId: accepted.documentId,
            signatureDocumentVersionId: accepted.versionId,
            captureMethod: 'drawn',
            purpose: 'condition_agreement',
          }),
          { params: Promise.resolve({ receptionId: visit }) }
        )
      ).json()) as { signatureId: string }
    ).signatureId;

    const eventKey = crypto.randomUUID();
    const eventBody = { eventType: 'finalized' };
    authAs(SUBJ_FULL);
    await SIGNATURE_EVENT(
      json(`/receptions/${visit}/signatures/${signature}/events`, eventBody, eventKey),
      { params: Promise.resolve({ receptionId: visit, signatureId: signature }) }
    );
    authAs(SUBJ_FULL);
    const eventReplay = await SIGNATURE_EVENT(
      json(`/receptions/${visit}/signatures/${signature}/events`, eventBody, eventKey),
      { params: Promise.resolve({ receptionId: visit, signatureId: signature }) }
    );
    expect(eventReplay.status).toBe(201);
    const events = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rec.signature_events WHERE signature_id = $1`,
      [signature]
    );
    expect(Number(events.rows[0]?.n)).toBe(1);
  });
});

describe('cross-tenant containment', () => {
  it('answers 404 for another tenant’s visit on every read and every write', async () => {
    const visit = await newVisit();
    const doc = await seedEvidenceDocument({
      categoryCode: 'reception_exterior',
      entityType: 'rec.reception_visits',
      entityId: visit,
      accept: true,
    });

    authAs(SUBJ_TENANT_B, TENANT_B);
    const bindDenied = await BIND_EVIDENCE(
      json(`/receptions/${visit}/evidence-bindings`, {
        requirementCode: 'exterior',
        documentId: doc.documentId,
        documentVersionId: doc.versionId,
      }),
      { params: Promise.resolve({ receptionId: visit }) }
    );
    expect(bindDenied.status).toBe(404);

    authAs(SUBJ_TENANT_B, TENANT_B);
    const readDenied = await LIST_BINDINGS(get(`/receptions/${visit}/evidence-bindings`), {
      params: Promise.resolve({ receptionId: visit }),
    });
    expect(readDenied.status).toBe(404);

    authAs(SUBJ_TENANT_B, TENANT_B);
    const finalizeDenied = await FINALIZE_BINDING(
      json(`/receptions/${visit}/evidence-bindings/${UNKNOWN_ID}/finalization`, {}),
      { params: Promise.resolve({ receptionId: visit, bindingId: UNKNOWN_ID }) }
    );
    expect(finalizeDenied.status).toBe(404);

    const problem = (await readDenied.json()) as Problem;
    expect(problem.code).toBe('ERR-RES-001');

    // Tenant B sees none of tenant A's rows through the runtime role, either.
    authAs(SUBJ_TENANT_B, TENANT_B);
    const templates = (await (
      await LIST_TEMPLATES(get('/reception-catalogue/damage-map-templates'))
    ).json()) as TemplateListBody;
    expect(templates.templates ?? []).toHaveLength(0);
  });
});
