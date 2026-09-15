/**
 * P1-31 SEC-002, the file-access half — the SERVER refuses a download of a delivery's
 * signature document, and the refusal discloses nothing.
 *
 * ## What existed, and what was missing
 *
 * `apps/web/tests/delivery-signature-refusal.dom.test.tsx` proves the handover screen
 * offers no affordance to dereference a stored signature document. Its adapter is
 * mocked, so it proves nothing about the API: `security-and-qa-evidence.md` § 2 records
 * that no server-side refused-download negative existed. This suite is that negative.
 *
 * ## The real download path, read from the code
 *
 * The delivery module ships no signature retrieval of its own; the signatures route
 * says retrieval of a `shared.document_versions` row "is the shared attachment path's
 * contract". That path is `POST /attachments/documents/{documentId}/download-authorizations`
 * (`shared.attachment-download-authorize`): it declares `shared.document.manage` at
 * `tenant` scope, and `AttachmentService.requestDownload` reads the version under the
 * caller's RLS, refuses anything not `accepted`, and only then signs a short-lived URL
 * and appends a security-class audit record. A URL is the only thing that could carry
 * bytes out, so "no bytes disclosed" is measured as: no URL in the response, the storage
 * provider never asked to sign, and no download audit record written.
 *
 * ## Why every refusal here is non-vacuous
 *
 * The signature is bound to a real delivery through the real attach route, read back
 * through the real signature list, and ACCEPTED — so the only reason any request below
 * is refused is the caller. The first case is the control: a holder of the file-access
 * permission IS issued a download for the very same version.
 *
 * The caller refused for lacking the permission CAN read the signature ledger, so it
 * holds the reference and is refused only for the missing code. The foreign-tenant
 * caller holds the permission in its own tenant, so its refusal is the tenant boundary,
 * and it is compared with the answer for a document that exists nowhere, so the refusal
 * is shown not to confirm the document exists.
 *
 * ## The live-link contract, added by the same branch (CC-63 (c))
 *
 * The second describe block below covers the rule the path did NOT hold when this file
 * was first written: a document is reachable through a live link to an entity the caller
 * may see, never by knowing an identifier. Its fixture is a document identical to the
 * signature one in tenant, category, company, branch and version state, differing only
 * in what it is attached to — so every refusal it records is the link and nothing else.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
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
import { BRANCH_A2, PARTNER_A, establishP1_19Fixtures, type Principal } from './p1-19-helpers';
import {
  SAL_FULL,
  authAs,
  cleanP1_22Fixtures,
  establishP1_22Fixtures,
  seedReadyDelivery,
  type SeededDelivery,
} from './p1-22-helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { __resetAuthenticatorForTests } from '@/server/context/principal';
import {
  LINKABLE_ENTITY_TYPES,
  LocalStorageProvider,
  buildStorageKey,
  setStorageProvider,
  __resetStorageProviderForTests,
} from '@/modules/shared-services';
import {
  ATTACHMENT_DOWNLOAD_AUTHORIZE_OPERATION,
  POST as DOWNLOAD_AUTHORIZE,
} from '@/app/api/v1/attachments/documents/[documentId]/download-authorizations/route';
import {
  GET as LIST_SIGNATURES,
  POST as ATTACH_SIGNATURE,
} from '@/app/api/v1/deliveries/[deliveryId]/signatures/route';

/** Literal, so the coverage gates can see this file invoke the operation. */
const DOWNLOAD_OPERATION_ID = 'shared.attachment-download-authorize';
const FILE_ACCESS = 'shared.document.manage';
const DOWNLOAD_AUDIT = 'shared.document.download_authorized';

// ---------------------------------------------------------------------------
// Fixtures owned by this suite. A distinct id space; removed by the tenant cascade.
// ---------------------------------------------------------------------------

const SIG_CATEGORY = 'f1319100-0000-4000-8000-0000000000a1';
const SIG_CATEGORY_CODE = 'fx_p131_dl_signature';
const SIG_DOCUMENT = 'f1319100-0000-4000-8000-0000000000a2';
const SIG_VERSION = 'f1319100-0000-4000-8000-0000000000a3';

/**
 * A second accepted version of the SAME linked document, left `pending`.
 *
 * It proves the state check still decides after the link check: the document is
 * reachable, so the only thing left to refuse is the version's own state.
 */
const SIG_PENDING_VERSION = 'f1319100-0000-4000-8000-0000000000a4';

/** A document identical to the signature one in every respect except reachability. */
const LOOSE_DOCUMENT = 'f1319100-0000-4000-8000-0000000000e1';
const LOOSE_VERSION = 'f1319100-0000-4000-8000-0000000000e2';

/** Tenant A, unrestricted, holding the file-access permission and nothing else. */
const DL_FILE_ACCESS: Principal = {
  roleId: 'f1319100-0000-4000-8000-0000000000b1',
  userId: 'f1319100-0000-4000-8000-0000000000b2',
  subject: 'fx_p1_31_dl_file_access',
  tenantId: TENANT_A,
  permissions: [FILE_ACCESS],
};

/** Tenant A, unrestricted: can read the signature ledger, lacks the file-access code. */
const DL_LEDGER_ONLY: Principal = {
  roleId: 'f1319100-0000-4000-8000-0000000000c1',
  userId: 'f1319100-0000-4000-8000-0000000000c2',
  subject: 'fx_p1_31_dl_ledger_only',
  tenantId: TENANT_A,
  permissions: ['sal.delivery.view', 'sal.delivery.manage'],
};

/**
 * Tenant A, holding the file-access permission on a grant SCOPED to another branch.
 *
 * The download operation declares `tenant` scope, so `iam.has_permission` admits this
 * caller: the permission gate is unchanged by this slice and still tenant-wide. What
 * refuses it is the linked entity's own RLS — `sel_work_orders_scope` narrows on
 * `iam.allowed_branch_ids()` — so the work order the signature hangs from is invisible
 * to it and the document is therefore unreachable.
 */
const DL_OTHER_BRANCH: Principal = {
  roleId: 'f1319100-0000-4000-8000-0000000000f1',
  userId: 'f1319100-0000-4000-8000-0000000000f2',
  subject: 'fx_p1_31_dl_other_branch',
  tenantId: TENANT_A,
  permissions: [FILE_ACCESS],
  scope: { companyId: COMPANY_A1, branchId: BRANCH_A2 },
  grantId: 'f1319100-0000-4000-8000-0000000000f3',
};

/** Tenant B, unrestricted, holding the file-access permission in its OWN tenant. */
const DL_TENANT_B: Principal = {
  roleId: 'f1319100-0000-4000-8000-0000000000d1',
  userId: 'f1319100-0000-4000-8000-0000000000d2',
  subject: 'fx_p1_31_dl_tenant_b',
  tenantId: TENANT_B,
  permissions: [FILE_ACCESS],
};

/** Counts every signing request, so "nothing was signed" is measured, not inferred. */
class CountingStorageProvider extends LocalStorageProvider {
  public downloadsSigned = 0;

  override async signDownload(
    request: Parameters<LocalStorageProvider['signDownload']>[0]
  ): ReturnType<LocalStorageProvider['signDownload']> {
    this.downloadsSigned += 1;
    return super.signDownload(request);
  }
}

let admin: Pool;
let runtime: Pool;
let storage: CountingStorageProvider;
let delivery: SeededDelivery;
let storageKey: string;

interface ProblemBody {
  readonly code?: string;
  readonly status?: number;
  readonly title?: string;
  readonly requiredPermissions?: readonly string[];
}

async function seedLocalPrincipal(principal: Principal): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,$3,$4,$4||'@example.test','P1-31 download refusal principal','active',$5)
     ON CONFLICT (id) DO NOTHING`,
    [principal.userId, principal.tenantId, IDENTITY_PROVIDER, principal.subject, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,'P1-31 download refusal fixture',$4) ON CONFLICT (id) DO NOTHING`,
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
  const existing = await admin.query(
    `SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3`,
    [principal.tenantId, principal.userId, principal.roleId]
  );
  if (existing.rowCount !== 0) return;
  if (principal.scope === undefined) {
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,'unrestricted',$4,$4)`,
      [principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    return;
  }
  // A scoped grant and its scope row must commit together: `tg_role_grants_scope_present`
  // is a DEFERRED constraint trigger, so a scoped active grant with no scope row never
  // persists and the two statements cannot be sent separately.
  const grantId = principal.grantId;
  if (grantId === undefined) {
    throw new Error(`the scoped principal ${principal.subject} declares no grant id`);
  }
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO iam.role_grants
         (id, tenant_id, user_id, role_id, scope_mode, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped',$5,$5)`,
      [grantId, principal.tenantId, principal.userId, principal.roleId, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes
         (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1,$2,'branch',$3,$4,$5)`,
      [principal.tenantId, grantId, principal.scope.companyId, principal.scope.branchId, USER_A]
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
 * The delivery's signature document: registered in the delivery's own company and
 * branch, attached to its work order, and ACCEPTED through the scan lifecycle the guard
 * enforces. Admin SQL, because a real upload needs a written object; none of it is
 * access evidence.
 */
async function seedAcceptedSignatureDocument(): Promise<void> {
  storageKey = buildStorageKey({
    environment: 'local',
    tenantId: TENANT_A,
    documentId: SIG_DOCUMENT,
    versionId: SIG_VERSION,
  });
  await admin.query(
    `INSERT INTO shared.document_categories
       (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
        default_classification, default_retention_class, created_by)
     VALUES ($1,'tenant',$2,$3,'P1-31 delivery signature fixture',
             ARRAY['image/png']::text[], 1048576, 'restricted', 'evidence-audit', $4)
     ON CONFLICT (id) DO NOTHING`,
    [SIG_CATEGORY, TENANT_A, SIG_CATEGORY_CODE, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, company_id, branch_id, category_id, title, classification,
        retention_class, created_by)
     VALUES ($1,$2,$3,$4,$5,'P1-31 handover signature','restricted','evidence-audit',$6)
     ON CONFLICT (id) DO NOTHING`,
    [SIG_DOCUMENT, TENANT_A, delivery.companyId, delivery.branchId, SIG_CATEGORY, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes,
        sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,1,$4,'image/png',2048,decode(repeat('ef',32),'hex'),$5,$5)
     ON CONFLICT (id) DO NOTHING`,
    [SIG_VERSION, TENANT_A, SIG_DOCUMENT, storageKey, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.file_scan_results
       (id, tenant_id, version_id, scan_status, scanner_code, created_by)
     VALUES ($1,$2,$3,'clean','fx_p131_dl_fixture_scanner',$4)`,
    [randomUUID(), TENANT_A, SIG_VERSION, USER_A]
  );
  // `pending -> accepted` is refused by the guard; acceptance passes through scanning.
  await admin.query(`UPDATE shared.document_versions SET status = 'scanning' WHERE id = $1`, [
    SIG_VERSION,
  ]);
  await admin.query(`UPDATE shared.document_versions SET status = 'accepted' WHERE id = $1`, [
    SIG_VERSION,
  ]);
  await admin.query(
    `INSERT INTO shared.document_links
       (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
     VALUES ($1,$2,'wo.work_orders',$3,'signature',$4,$4)`,
    [TENANT_A, SIG_DOCUMENT, delivery.workOrderId, USER_A]
  );
  // A second version of the SAME reachable document, left pending on purpose.
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes,
        sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,2,$4,'image/png',2048,decode(repeat('ee',32),'hex'),$5,$5)
     ON CONFLICT (id) DO NOTHING`,
    [
      SIG_PENDING_VERSION,
      TENANT_A,
      SIG_DOCUMENT,
      buildStorageKey({
        environment: 'local',
        tenantId: TENANT_A,
        documentId: SIG_DOCUMENT,
        versionId: SIG_PENDING_VERSION,
      }),
      USER_A,
    ]
  );
}

/**
 * A document identical to the signature one — same tenant, category, company, branch,
 * and an ACCEPTED version — and attached to nothing.
 *
 * It is the whole of CC-63 (c) in one fixture: before this slice the only difference
 * between it and the signature document was a row in `shared.document_links`, and that
 * difference changed nothing about who could download it.
 */
async function seedUnlinkedDocument(): Promise<void> {
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, company_id, branch_id, category_id, title, classification,
        retention_class, created_by)
     VALUES ($1,$2,$3,$4,$5,'P1-31 unreachable attachment','restricted','evidence-audit',$6)
     ON CONFLICT (id) DO NOTHING`,
    [LOOSE_DOCUMENT, TENANT_A, delivery.companyId, delivery.branchId, SIG_CATEGORY, USER_A]
  );
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type, size_bytes,
        sha256, uploaded_by, created_by)
     VALUES ($1,$2,$3,1,$4,'image/png',2048,decode(repeat('ed',32),'hex'),$5,$5)
     ON CONFLICT (id) DO NOTHING`,
    [
      LOOSE_VERSION,
      TENANT_A,
      LOOSE_DOCUMENT,
      buildStorageKey({
        environment: 'local',
        tenantId: TENANT_A,
        documentId: LOOSE_DOCUMENT,
        versionId: LOOSE_VERSION,
      }),
      USER_A,
    ]
  );
  await admin.query(
    `INSERT INTO shared.file_scan_results
       (id, tenant_id, version_id, scan_status, scanner_code, created_by)
     VALUES ($1,$2,$3,'clean','fx_p131_dl_fixture_scanner',$4)`,
    [randomUUID(), TENANT_A, LOOSE_VERSION, USER_A]
  );
  await admin.query(`UPDATE shared.document_versions SET status = 'scanning' WHERE id = $1`, [
    LOOSE_VERSION,
  ]);
  await admin.query(`UPDATE shared.document_versions SET status = 'accepted' WHERE id = $1`, [
    LOOSE_VERSION,
  ]);
}

/** Attaches `LOOSE_DOCUMENT` to an entity and answers the link's identifier. */
async function linkLooseDocument(entityType: string, entityId: string): Promise<string> {
  const created = await admin.query<{ id: string }>(
    `INSERT INTO shared.document_links
       (tenant_id, document_id, entity_type, entity_id, link_purpose, linked_by, created_by)
     VALUES ($1,$2,$3,$4,'attachment',$5,$5) RETURNING id`,
    [TENANT_A, LOOSE_DOCUMENT, entityType, entityId, USER_A]
  );
  const id = created.rows[0]?.id;
  if (id === undefined) throw new Error('the fixture link insert returned no row');
  return id;
}

/** Withdraws a link the way the product does — `deleted_at`, never a delete. */
const withdrawLink = (linkId: string): Promise<unknown> =>
  admin.query(`UPDATE shared.document_links SET deleted_at = now() WHERE id = $1`, [linkId]);

const bodyOf = async <T>(response: Response): Promise<T> => (await response.json()) as T;

const requestDownload = (documentId: string, versionId: string): Promise<Response> =>
  DOWNLOAD_AUTHORIZE(
    new Request(
      `http://localhost/api/v1/attachments/documents/${documentId}/download-authorizations`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ versionId }),
      }
    ),
    { params: Promise.resolve({ documentId }) }
  );

const listSignatures = (deliveryId: string): Promise<Response> =>
  LIST_SIGNATURES(new Request(`http://localhost/api/v1/deliveries/${deliveryId}/signatures`), {
    params: Promise.resolve({ deliveryId }),
  });

const downloadAudits = (versionId: string = SIG_VERSION): Promise<number> =>
  countRows(admin, 'iam.audit_records', 'action = $1 AND entity_id = $2', [
    DOWNLOAD_AUDIT,
    versionId,
  ]);

/** Everything a refused download must NOT carry, asserted over the raw response text. */
function expectNothingDisclosed(text: string): void {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  expect(parsed).not.toHaveProperty('url');
  expect(parsed).not.toHaveProperty('expiresAt');
  expect(text).not.toContain(storageKey);
  expect(text).not.toContain('.invalid');
  expect(text).not.toContain(SIG_VERSION);
  expect(text).not.toContain(SIG_DOCUMENT);
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  process.env.STORAGE_PROVIDER = 'local_fake';
  __resetBackendConfigForTests();

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await establishP1_19Fixtures(admin);
  runtime = runtimeAppPool(6);
  __setPrimaryPoolForTests(runtime);
  await establishP1_22Fixtures(admin);
  for (const principal of [DL_FILE_ACCESS, DL_LEDGER_ONLY, DL_TENANT_B, DL_OTHER_BRANCH]) {
    await seedLocalPrincipal(principal);
  }

  storage = new CountingStorageProvider({ bucket: 'fx-p131-download-refusal' });
  setStorageProvider(storage);

  delivery = await seedReadyDelivery('p131_dl_refusal');
  await seedAcceptedSignatureDocument();
  await seedUnlinkedDocument();

  // Bound through the product, so the version under test IS this delivery's signature.
  authAs(SAL_FULL);
  const attached = await ATTACH_SIGNATURE(
    new Request(`http://localhost/api/v1/deliveries/${delivery.deliveryId}/signatures`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': randomUUID() },
      body: JSON.stringify({ signerRole: 'receiver', signatureDocumentVersionId: SIG_VERSION }),
    }),
    { params: Promise.resolve({ deliveryId: delivery.deliveryId }) }
  );
  if (attached.status !== 201) {
    throw new Error(`the signature fixture could not be bound: HTTP ${String(attached.status)}`);
  }
  __resetAuthenticatorForTests();
}, 240_000);

afterAll(async () => {
  __resetAuthenticatorForTests();
  __resetStorageProviderForTests();
  __setPrimaryPoolForTests(undefined);
  await cleanP1_22Fixtures().catch(() => undefined);
  if (runtime) await runtime.end();
  if (admin) {
    await cleanBackendFixtures(admin);
    await admin.end();
  }
});

describe(`${DOWNLOAD_OPERATION_ID} refuses the delivery signature document`, () => {
  it('declares the file-access permission, so that is the code a refusal names', () => {
    expect(ATTACHMENT_DOWNLOAD_AUTHORIZE_OPERATION.id).toBe(DOWNLOAD_OPERATION_ID);
    expect(ATTACHMENT_DOWNLOAD_AUTHORIZE_OPERATION.permissions).toEqual([FILE_ACCESS]);
  });

  it('control: a holder of the file-access permission is issued a download for it', async () => {
    authAs(DL_FILE_ACCESS);
    const signedBefore = storage.downloadsSigned;
    const auditsBefore = await downloadAudits();

    const response = await requestDownload(SIG_DOCUMENT, SIG_VERSION);
    expect(response.status).toBe(200);
    const body = await bodyOf<{ url: string; expiresAt: string }>(response);
    expect(storage.verify(body.url).valid).toBe(true);
    expect(storage.downloadsSigned).toBe(signedBefore + 1);
    expect(await downloadAudits()).toBe(auditsBefore + 1);
  });

  it('refuses a caller who holds the signature reference but lacks the file-access permission', async () => {
    authAs(DL_LEDGER_ONLY);
    // The caller genuinely holds the reference: the ledger read names this version.
    const ledger = await listSignatures(delivery.deliveryId);
    expect(ledger.status).toBe(200);
    const envelope = await bodyOf<{
      signatures: { items: readonly { signatureDocumentVersionId: string }[] };
    }>(ledger);
    expect(envelope.signatures.items.map((item) => item.signatureDocumentVersionId)).toContain(
      SIG_VERSION
    );

    const signedBefore = storage.downloadsSigned;
    const auditsBefore = await downloadAudits();

    const refused = await requestDownload(SIG_DOCUMENT, SIG_VERSION);
    expect(refused.status).toBe(403);
    expect(refused.headers.get('content-type')).toContain('application/problem+json');
    const text = await refused.text();
    const problem = JSON.parse(text) as ProblemBody;
    expect(problem.code).toBe('ERR-IAM-001');
    expect(problem.requiredPermissions).toEqual([FILE_ACCESS]);
    expectNothingDisclosed(text);

    expect(storage.downloadsSigned).toBe(signedBefore);
    expect(await downloadAudits()).toBe(auditsBefore);
  });

  it('refuses a caller from another tenant with the uniform not-found, disclosing nothing', async () => {
    authAs(DL_TENANT_B);
    const signedBefore = storage.downloadsSigned;
    const auditsBefore = await downloadAudits();

    const refused = await requestDownload(SIG_DOCUMENT, SIG_VERSION);
    expect(refused.status).toBe(404);
    expect(refused.headers.get('content-type')).toContain('application/problem+json');
    const text = await refused.text();
    const problem = JSON.parse(text) as ProblemBody;
    expect(problem.code).toBe('ERR-RES-001');
    expectNothingDisclosed(text);

    expect(storage.downloadsSigned).toBe(signedBefore);
    expect(await downloadAudits()).toBe(auditsBefore);

    // Indistinguishable from a document that exists nowhere, so the refusal does not
    // confirm that tenant A holds this document.
    const invented = randomUUID();
    const nowhere = await requestDownload(invented, randomUUID());
    expect(nowhere.status).toBe(refused.status);
    const nowhereProblem = await bodyOf<ProblemBody>(nowhere);
    expect(nowhereProblem.code).toBe(problem.code);
    expect(nowhereProblem.title).toBe(problem.title);
    expect(Object.keys(nowhereProblem).sort()).toEqual(Object.keys(problem).sort());
  });
});

/**
 * CC-63 (c) — a document is reachable through a LIVE LINK to an entity the caller may
 * see, and never by knowing an identifier.
 *
 * `document-access-and-file-security.md` § 3 and Owner requirement H-13 both say it, and
 * `attachment-lifecycle.md` claimed the download path enforced it while the path read no
 * link at all. These cases are that enforcement. Each one differs from the control above
 * in exactly one fact, and every refusal is measured as a delta: nothing signed, nothing
 * audited.
 */
describe(`${DOWNLOAD_OPERATION_ID} requires a live link to a visible entity`, () => {
  it('every linkable entity type names a table keyed by a single uuid column called id', async () => {
    // The reachability query selects `id` from the relation the token names, for every
    // token in the allow-list. A table keyed on anything else would make that statement
    // fail at runtime, so the assumption is asserted against the catalog rather than
    // trusted.
    const { rows } = await admin.query<{ relation: string; column_name: string; kind: string }>(
      `SELECT c.relnamespace::regnamespace::text || '.' || c.relname AS relation,
              a.attname AS column_name,
              format_type(a.atttypid, a.atttypmod) AS kind
         FROM pg_index i
         JOIN pg_class c ON c.oid = i.indrelid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (i.indkey)
        WHERE i.indisprimary
          AND c.relnamespace::regnamespace::text || '.' || c.relname = ANY($1::text[])`,
      [[...LINKABLE_ENTITY_TYPES]]
    );
    expect(rows.map((row) => `${row.relation} ${row.column_name} ${row.kind}`).sort()).toEqual(
      [...LINKABLE_ENTITY_TYPES].map((token) => `${token} id uuid`).sort()
    );
  });

  it('refuses an accepted version of an unlinked document exactly as it refuses an invented id', async () => {
    authAs(DL_FILE_ACCESS);
    const signedBefore = storage.downloadsSigned;
    const auditsBefore = await downloadAudits(LOOSE_VERSION);

    const refused = await requestDownload(LOOSE_DOCUMENT, LOOSE_VERSION);
    expect(refused.status).toBe(404);
    expect(refused.headers.get('content-type')).toContain('application/problem+json');
    const problem = await bodyOf<ProblemBody>(refused);
    expect(problem.code).toBe('ERR-RES-001');

    // Same caller, same permission, same tenant: the only difference from the control is
    // that this document is attached to nothing.
    expect(storage.downloadsSigned).toBe(signedBefore);
    expect(await downloadAudits(LOOSE_VERSION)).toBe(auditsBefore);

    const nowhere = await requestDownload(randomUUID(), randomUUID());
    const nowhereProblem = await bodyOf<ProblemBody>(nowhere);
    expect(nowhere.status).toBe(refused.status);
    expect(nowhereProblem.code).toBe(problem.code);
    expect(nowhereProblem.title).toBe(problem.title);
    expect(Object.keys(nowhereProblem).sort()).toEqual(Object.keys(problem).sort());
  });

  it('refuses a document whose only link has been withdrawn', async () => {
    const linkId = await linkLooseDocument('wo.work_orders', delivery.workOrderId);
    try {
      // Live first: the same request succeeds, so the refusal after the withdrawal is the
      // withdrawal and nothing else.
      authAs(DL_FILE_ACCESS);
      const granted = await requestDownload(LOOSE_DOCUMENT, LOOSE_VERSION);
      expect(granted.status).toBe(200);

      await withdrawLink(linkId);

      authAs(DL_FILE_ACCESS);
      const signedBefore = storage.downloadsSigned;
      const auditsBefore = await downloadAudits(LOOSE_VERSION);
      const refused = await requestDownload(LOOSE_DOCUMENT, LOOSE_VERSION);
      expect(refused.status).toBe(404);
      expect((await bodyOf<ProblemBody>(refused)).code).toBe('ERR-RES-001');
      expect(storage.downloadsSigned).toBe(signedBefore);
      expect(await downloadAudits(LOOSE_VERSION)).toBe(auditsBefore);
    } finally {
      await admin.query(`DELETE FROM shared.document_links WHERE id = $1`, [linkId]);
    }
  });

  it('issues a URL when one withdrawn link sits beside one live, visible link', async () => {
    const withdrawn = await linkLooseDocument('wo.work_orders', delivery.workOrderId);
    await withdrawLink(withdrawn);
    const live = await linkLooseDocument('rec.reception_visits', delivery.visitId);
    try {
      authAs(DL_FILE_ACCESS);
      const signedBefore = storage.downloadsSigned;
      const auditsBefore = await downloadAudits(LOOSE_VERSION);

      const response = await requestDownload(LOOSE_DOCUMENT, LOOSE_VERSION);
      expect(response.status).toBe(200);
      const body = await bodyOf<{ url: string }>(response);
      expect(storage.verify(body.url).valid).toBe(true);
      expect(storage.downloadsSigned).toBe(signedBefore + 1);
      expect(await downloadAudits(LOOSE_VERSION)).toBe(auditsBefore + 1);
    } finally {
      await admin.query(`DELETE FROM shared.document_links WHERE id = ANY($1::uuid[])`, [
        [withdrawn, live],
      ]);
    }
  });

  it('refuses a caller whose grant is scoped to a branch that cannot see the linked work order', async () => {
    // Measured, not assumed: `sel_work_orders_scope` narrows on company AND branch, and
    // this delivery is not in the branch the grant names.
    expect(delivery.branchId).not.toBe(BRANCH_A2);
    const invisible = await admin.query(
      `SELECT 1 FROM wo.work_orders WHERE id = $1 AND branch_id = $2`,
      [delivery.workOrderId, BRANCH_A2]
    );
    expect(invisible.rowCount).toBe(0);

    authAs(DL_OTHER_BRANCH);
    const signedBefore = storage.downloadsSigned;
    const auditsBefore = await downloadAudits();

    const refused = await requestDownload(SIG_DOCUMENT, SIG_VERSION);
    expect(refused.status).toBe(404);
    const text = await refused.text();
    expect((JSON.parse(text) as ProblemBody).code).toBe('ERR-RES-001');
    expectNothingDisclosed(text);
    expect(storage.downloadsSigned).toBe(signedBefore);
    expect(await downloadAudits()).toBe(auditsBefore);

    // The permission gate did NOT refuse it: the same caller is issued a URL for a
    // document linked to an entity its own branch scope admits. So the refusal above is
    // the linked entity's visibility and not the tenant-wide permission check.
    // `sel_business_partners_tenant` narrows on the tenant alone, so a branch-scoped
    // grant sees this row.
    const reachable = await linkLooseDocument('crm.business_partners', PARTNER_A);
    try {
      authAs(DL_OTHER_BRANCH);
      const granted = await requestDownload(LOOSE_DOCUMENT, LOOSE_VERSION);
      expect(granted.status).toBe(200);
    } finally {
      await admin.query(`DELETE FROM shared.document_links WHERE id = $1`, [reachable]);
    }
  });

  it('still refuses a non-accepted version of a reachable document with the state code', async () => {
    authAs(DL_FILE_ACCESS);
    const signedBefore = storage.downloadsSigned;
    const auditsBefore = await downloadAudits(SIG_PENDING_VERSION);

    const refused = await requestDownload(SIG_DOCUMENT, SIG_PENDING_VERSION);
    expect(refused.status).toBe(409);
    expect((await bodyOf<ProblemBody>(refused)).code).toBe('ERR-DOC-001');
    expect(storage.downloadsSigned).toBe(signedBefore);
    expect(await downloadAudits(SIG_PENDING_VERSION)).toBe(auditsBefore);
  });
});
