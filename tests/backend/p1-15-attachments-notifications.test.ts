/**
 * P1-15 operation evidence — attachments and notification enqueue, driven
 * through the REAL wiring.
 *
 * Every assertion here runs `withTransaction(ctx, db => sharedServicesModule().…)`
 * on the deployed `app_runtime` identity (`rootlco_test_runtime`), so RLS, the
 * column grants added by DBCR-P1-15-001, the transaction wrapper, and the
 * audit/outbox path are all genuinely exercised. The `postgres` admin connection
 * appears only to provision preconditions and to read back what actually landed;
 * it carries BYPASSRLS, so nothing it does is evidence.
 *
 * The two deterministic local providers are installed for the whole suite:
 * `LocalStorageProvider` signs against an RFC 2606 `.invalid` host and can
 * *verify* what it signed — which is what turns "a signed URL was issued" from a
 * claim about a string into a checked property — and `LocalMessageProvider`
 * exists to prove it is never called, because enqueue must not reach a provider
 * inside the business transaction.
 *
 * Operations exercised here (coverage-gate references):
 *   shared.attachment-upload-authorize   shared.attachment-version-register
 *   shared.attachment-version-reject     shared.attachment-download-authorize
 *   shared.attachment-link-create        shared.attachment-link-withdraw
 *   shared.notification-enqueue
 *
 * ===========================================================================
 * DEFECT THIS SUITE FOUND, AND THE FIX IT NOW LOCKS
 * ===========================================================================
 * `DocumentRepository.nextVersionNumber()` originally serialised concurrent
 * registrations with `SELECT id FROM shared.documents … FOR UPDATE`. PostgreSQL
 * requires UPDATE privilege on at least one column of a table for ANY
 * row-locking clause, and migration
 * `20260728090000_shared_services_runtime_write_capabilities.sql` deliberately
 * grants `app_runtime` **no UPDATE at all** on `shared.documents` (§1: "there is
 * no UPDATE grant at all on this table"). Registration was therefore refused
 * with SQLSTATE 42501 before the version INSERT was ever attempted — on a caller
 * that HELD `shared.document.manage`.
 *
 * The withholding is correct and stays. What was wrong was taking a lock that
 * needs a *write* privilege in order to perform a *read*. Serialisation is now
 * `pg_advisory_xact_lock`, which needs no table privilege and is released by
 * COMMIT or ROLLBACK; `uq_document_versions_number` remains the authority.
 *
 * The success, audit, outbox, ordering and replay proofs below are the
 * regression lock for that fix.
 *
 * Denial shapes observed and asserted, not assumed. A failed INSERT policy is
 * SQLSTATE 42501 (`new row violates row-level security policy`); an UPDATE the
 * policy USING clause refuses affects zero rows with no error, which the service
 * reports as `ERR-IAM-001` (unlink) or `ERR-TRN-001` (reject); a row outside the
 * caller's tenant is simply not found, which is `ERR-RES-001`. Where the service
 * itself performs no permission check — `requestDownload` reads and signs, and
 * the gate lives in the operation pipeline — the denial is proved by invoking
 * `requirePermissions()` against the operation's own declaration, which is the
 * same database-evaluated check `handleOperation` runs.
 *
 * COVERAGE-EVIDENCE (P1-15 attachments and notifications):
 *   shared.attachment-upload-authorize: success denial cross-tenant audit
 *   shared.attachment-version-register: success denial cross-tenant audit outbox
 *   shared.attachment-version-reject: success denial audit
 *   shared.attachment-download-authorize: success denial audit
 *   shared.attachment-link-create: success denial cross-tenant audit outbox
 *   shared.attachment-link-withdraw: success denial audit
 *   shared.notification-enqueue: success denial cross-tenant audit outbox idempotency
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_UNPERMITTED,
  USER_TENANT_B,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import { requirePermissions } from '@/server/auth/authorization';
import {
  LocalMessageProvider,
  LocalStorageProvider,
  buildStorageKey,
  encodeUploadToken,
  decodeUploadToken,
  setMessageProvider,
  setStorageProvider,
  sharedServicesModule,
  __resetMessageProviderForTests,
  __resetStorageProviderForTests,
} from '@/modules/shared-services';
import type { AttachmentService } from '@/modules/shared-services/application/attachment-service';
import type { SharedNotificationService } from '@/modules/shared-services/application/notification-service';
import { ATTACHMENT_UPLOAD_AUTHORIZE_OPERATION } from '@/app/api/v1/attachments/upload-authorizations/route';
import { ATTACHMENT_VERSION_REGISTER_OPERATION } from '@/app/api/v1/attachments/versions/route';
import { ATTACHMENT_DOWNLOAD_AUTHORIZE_OPERATION } from '@/app/api/v1/attachments/documents/[documentId]/download-authorizations/route';
import { NOTIFICATION_ENQUEUE_OPERATION } from '@/app/api/v1/notifications/route';

// ---------------------------------------------------------------------------
// Deterministic fixtures. A distinct id space from every other backend suite,
// so a concurrent fixture can never collide with one of these. All of it is
// ephemeral scaffolding removed by cleanBackendFixtures(); no business data.
// ---------------------------------------------------------------------------

/** Tenant A principal holding BOTH shared-service permissions under test. */
const U_SHARED = 'a7000000-0000-4000-8000-000000000001';
const ROLE_SHARED = 'a7100000-0000-4000-8000-000000000001';

const CATEGORY_A = 'a7200000-0000-4000-8000-000000000001';
const CATEGORY_B = 'b7200000-0000-4000-8000-000000000001';
const CATEGORY_CODE_A = 'fx_p15_bx_cat';
const CATEGORY_CODE_B = 'fx_p15_bx_cat_b';

/** Tenant B rows, used only to prove a tenant-A caller cannot reach them. */
const DOC_B = 'b7300000-0000-4000-8000-000000000001';
const TEMPLATE_B = 'b7600000-0000-4000-8000-000000000001';
const TPLVER_B = 'b7700000-0000-4000-8000-000000000001';

const TEMPLATE_A = 'a7600000-0000-4000-8000-000000000001';
const TPLVER_A = 'a7700000-0000-4000-8000-000000000001';

const SHARED_PERMISSIONS = ['shared.document.manage', 'shared.notification.send'];

/** 64 lower-case hex characters — `ck_document_versions_sha256_len`. */
const SHA_HEX = 'ab'.repeat(32);
const CONTENT_TYPE = 'application/pdf';
const BYTE_SIZE = 1024;

let admin: Pool;
let runtime: Pool;
let attachments: AttachmentService;
let notifications: SharedNotificationService;
let storage: LocalStorageProvider;
let messages: LocalMessageProvider;

const asShared = () =>
  contextFor({ userId: U_SHARED, operation: 'shared.p1-15-evidence', module: 'shared-services' });
const asUnpriv = () =>
  contextFor({
    userId: USER_UNPERMITTED,
    operation: 'shared.p1-15-evidence',
    module: 'shared-services',
  });

// ---------------------------------------------------------------------------
// Small readers. `admin` is used here and only here — reading back what landed
// is not a capability claim, and a privilege-poor reader would make "absent" and
// "invisible" indistinguishable.
// ---------------------------------------------------------------------------

const auditCount = (action: string, entityId: string): Promise<number> =>
  countRows(admin, 'iam.audit_records', 'action = $1 AND entity_id = $2', [action, entityId]);

const outboxCount = (eventKey: string): Promise<number> =>
  countRows(admin, 'shared.event_outbox', 'tenant_id = $1 AND event_key = $2', [
    TENANT_A,
    eventKey,
  ]);

const versionStatus = async (versionId: string): Promise<string | undefined> => {
  const result = await admin.query<{ status: string }>(
    'SELECT status FROM shared.document_versions WHERE id = $1',
    [versionId]
  );
  return result.rows[0]?.status;
};

/** The upload request every attachment test varies one fact of. */
const uploadInput = (over: Partial<Parameters<AttachmentService['authorizeUpload']>[1]> = {}) => ({
  categoryCode: CATEGORY_CODE_A,
  entityType: 'org.legal_companies',
  entityId: COMPANY_A1,
  fileName: 'fx-p15-attachment.pdf',
  contentType: CONTENT_TYPE,
  byteSize: BYTE_SIZE,
  ...over,
});

/** Creates document metadata through the service and commits it. */
const authorizeUpload = () =>
  withTransaction(asShared(), (db) => attachments.authorizeUploadDetailed(db, uploadInput()));

/**
 * Provisions a document version as ADMIN.
 *
 * A precondition, never evidence: `registerVersion()` cannot run on the deployed
 * role (see the BLOCKER note at the top), and `accepted` additionally requires a
 * `clean` row in `shared.file_scan_results`, which **no application role may
 * write** — the withholding that keeps acceptance out of request code's reach.
 */
async function seedVersion(documentId: string, status: 'pending' | 'accepted'): Promise<string> {
  const versionId = randomUUID();
  const storageKey = buildStorageKey({
    environment: 'local',
    tenantId: TENANT_A,
    documentId,
    versionId,
  });
  await admin.query(
    `INSERT INTO shared.document_versions
       (id, tenant_id, document_id, version_number, storage_key, content_type,
        size_bytes, sha256, uploaded_by, created_by)
     VALUES ($1, $2, $3,
             (SELECT COALESCE(MAX(version_number), 0) + 1
                FROM shared.document_versions WHERE tenant_id = $2 AND document_id = $3),
             $4, $5, $6, decode($7, 'hex'), $8, $8)`,
    [versionId, TENANT_A, documentId, storageKey, CONTENT_TYPE, BYTE_SIZE, SHA_HEX, U_SHARED]
  );
  if (status === 'accepted') {
    await admin.query(
      `INSERT INTO shared.file_scan_results
         (id, tenant_id, version_id, scan_status, scanner_code, created_by)
       VALUES ($1, $2, $3, 'clean', 'fx_p15_fixture_scanner', $4)`,
      [randomUUID(), TENANT_A, versionId, U_SHARED]
    );
    await admin.query(`UPDATE shared.document_versions SET status = 'accepted' WHERE id = $1`, [
      versionId,
    ]);
  }
  return versionId;
}

/** Creates a live link through the service and commits it. */
const createLink = (documentId: string) =>
  withTransaction(asShared(), (db) =>
    attachments.link(db, {
      documentId,
      entityType: 'org.legal_companies',
      entityId: COMPANY_A1,
      linkPurpose: 'attachment',
    })
  );

/** The enqueue request every notification test varies one fact of. */
const queueInput = (
  over: Partial<Parameters<SharedNotificationService['queueMessage']>[1]> = {}
) => ({
  channel: 'email' as const,
  templateVersionId: TPLVER_A,
  locale: 'en',
  dedupeKey: `fx-p15-ntf-${randomUUID()}`,
  recipientRef: randomUUID(),
  variables: { name: 'fx <Recipient> & Co' },
  consentEvaluation: {
    granted: true,
    consentRecordId: 'fx-p15-consent',
    evaluatedAt: new Date(),
  },
  companyId: null,
  branchId: null,
  ...over,
});

// ---------------------------------------------------------------------------

async function seedSuiteFixtures(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, 'test_harness', 'fx_p15_bx_shared', 'fx-p15-bx-shared@example.test',
             'P1-15 Shared Fixture', 'active', $3)
     ON CONFLICT (id) DO NOTHING`,
    [U_SHARED, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $2, 'fx_p15_bx_shared', 'P1-15 shared services', $3)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_SHARED, TENANT_A, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = ANY($4::text[])
     ON CONFLICT DO NOTHING`,
    [TENANT_A, ROLE_SHARED, USER_A, SHARED_PERMISSIONS]
  );
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     SELECT $1, $2, $3, 'unrestricted', 'active', $4, $4
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3)`,
    [TENANT_A, U_SHARED, ROLE_SHARED, USER_A]
  );

  // Document categories: one per tenant, same shape, so the cross-tenant proof
  // differs from the success case in exactly one fact — which tenant owns it.
  for (const [id, tenant, code] of [
    [CATEGORY_A, TENANT_A, CATEGORY_CODE_A],
    [CATEGORY_B, TENANT_B, CATEGORY_CODE_B],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
          default_classification, default_retention_class, created_by)
       VALUES ($1, 'tenant', $2, $3, 'P1-15 fixture category',
               ARRAY['application/pdf']::text[], 1048576, 'internal', 'operational', $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, tenant, code, USER_A]
    );
  }

  // A tenant-B document, so "a TENANT_B id is not found from TENANT_A" is a
  // statement about a row that genuinely exists rather than about a typo.
  await admin.query(
    `INSERT INTO shared.documents
       (id, tenant_id, category_id, title, classification, retention_class, created_by)
     VALUES ($1, $2, $3, 'P1-15 fixture document B', 'internal', 'operational', $4)
     ON CONFLICT (id) DO NOTHING`,
    [DOC_B, TENANT_B, CATEGORY_B, USER_TENANT_B]
  );

  // Message templates. Versions are born drafts and then approved, because
  // `guard_template_version_lifecycle` refuses a version born approved — the
  // fixture obeys the same rule every legitimate writer does.
  for (const [id, tenant, code] of [
    [TEMPLATE_A, TENANT_A, 'fx_p15_bx_tpl'],
    [TEMPLATE_B, TENANT_B, 'fx_p15_bx_tpl'],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.message_templates
         (id, scope, tenant_id, template_code, name, channel, purpose, locale_code, status, created_by)
       VALUES ($1, 'tenant', $2, $3, 'P1-15 fixture template', 'email', 'transactional',
               'en', 'active', $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, tenant, code, USER_A]
    );
  }
  for (const [id, tenant, template] of [
    [TPLVER_A, TENANT_A, TEMPLATE_A],
    [TPLVER_B, TENANT_B, TEMPLATE_B],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.template_versions
         (id, tenant_id, template_id, version_number, subject, body, content_hash, created_by)
       VALUES ($1, $2, $3, 1, 'P1-15 fixture subject', 'Hello {{name}}, this is a fixture body.',
               decode(repeat('cc', 32), 'hex'), $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, tenant, template, USER_A]
    );
  }
  // approved_by is tenant-bound by a composite FK, so each version is approved
  // by one of its own tenant's users.
  for (const [id, approver] of [
    [TPLVER_A, U_SHARED],
    [TPLVER_B, USER_TENANT_B],
  ] as const) {
    await admin.query(
      `UPDATE shared.template_versions SET status = 'approved', approved_by = $2
        WHERE id = $1 AND status = 'draft'`,
      [id, approver]
    );
  }
}

beforeAll(async () => {
  __resetBackendConfigForTests();
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await seedSuiteFixtures();

  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);

  // Installed BEFORE the module is composed, so `installSharedServicesRuntime()`
  // keeps them (it only fills a port that is still Unconfigured) and no storage
  // or delivery configuration is read at all. The fixed signing key makes the
  // signature reproducible, which is what lets `verify()` be an assertion.
  storage = new LocalStorageProvider({
    bucket: 'fx-p15-attachments',
    signingKey: 'p1-15-local-signing-key-not-real',
  });
  messages = new LocalMessageProvider();
  setStorageProvider(storage);
  setMessageProvider(messages);

  const module_ = sharedServicesModule();
  attachments = module_.attachments;
  notifications = module_.notifications;
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  __resetStorageProviderForTests();
  __resetMessageProviderForTests();
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

// ===========================================================================
// shared.attachment-upload-authorize
// ===========================================================================
describe('shared.attachment-upload-authorize', () => {
  it('creates pending document metadata, signs an upload URL, and audits the issuance', async () => {
    const authorization = await authorizeUpload();

    // The document exists, and it is born `pending`: `status` is absent from the
    // INSERT grant, so the initial state is the column default the guard fixes.
    const document = await admin.query<{ status: string; title: string; tenant_id: string }>(
      'SELECT status, title, tenant_id FROM shared.documents WHERE id = $1',
      [authorization.documentId]
    );
    expect(document.rows[0]?.status).toBe('pending');
    expect(document.rows[0]?.tenant_id).toBe(TENANT_A);
    expect(document.rows[0]?.title).toBe('fx-p15-attachment.pdf');

    // The key is server-built and tenant-prefixed; no caller input reaches it.
    expect(authorization.storageKey.startsWith(`local/${TENANT_A}/`)).toBe(true);
    expect(authorization.storageKey.endsWith(authorization.documentId)).toBe(false);

    // The signed URL is a real signature over the key, method and expiry — the
    // adapter that issued it re-verifies it rather than the test parsing a string.
    expect(storage.verify(authorization.uploadUrl).valid).toBe(true);
    expect(authorization.method).toBe('PUT');
    expect(authorization.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // The returned token re-validates: it decodes to the document the call just
    // created, at the content type and ceiling the call resolved.
    const token = decodeUploadToken(authorization.uploadToken);
    expect(token.documentId).toBe(authorization.documentId);
    expect(token.contentType).toBe(CONTENT_TYPE);
    expect(token.maxBytes).toBe(1048576);
    expect(token.exp * 1000).toBeGreaterThan(Date.now());

    expect(await auditCount('shared.document.upload_authorized', authorization.documentId)).toBe(1);
  });

  it('denial: a principal without shared.document.manage is refused by the INSERT policy (42501)', async () => {
    const error = await withTransaction(asUnpriv(), (db) =>
      attachments.authorizeUploadDetailed(db, uploadInput()).catch((e: unknown) => e)
    );
    // An INSERT that fails RLS WITH CHECK raises 42501; it does not return zero
    // rows, so the service's `ERR-IAM-001` branch is not the observed shape here.
    expect((error as { code?: string }).code).toBe('42501');
    expect(await countRows(admin, 'shared.documents', 'created_by = $1', [USER_UNPERMITTED])).toBe(
      0
    );
  });

  it('denial: the operation gate refuses the same principal with ERR-IAM-001', async () => {
    const error = await withTransaction(asUnpriv(), (db) =>
      requirePermissions(db, ATTACHMENT_UPLOAD_AUTHORIZE_OPERATION).catch((e: unknown) => e)
    );
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });

  it('cross-tenant: a tenant-B category code is not found from tenant A', async () => {
    const error = await withTransaction(asShared(), (db) =>
      attachments
        .authorizeUploadDetailed(db, uploadInput({ categoryCode: CATEGORY_CODE_B }))
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-001');
  });
});

// ===========================================================================
// shared.attachment-version-register
// ===========================================================================
describe('shared.attachment-version-register', () => {
  it('success + audit + outbox: a pending version is registered, audited and published once', async () => {
    // Regression lock for the defect this suite found. The first implementation
    // of `nextVersionNumber()` took `SELECT … FOR UPDATE` on shared.documents to
    // serialise concurrent registrations, and PostgreSQL requires UPDATE
    // privilege on at least one column for ANY row-locking clause — which
    // DBCR-P1-15-001 deliberately withholds on that table. Registration was
    // therefore refused with 42501 before the INSERT was reached, on a caller
    // that HELD `shared.document.manage`.
    //
    // The withholding was right; taking a write-privileged lock to perform a
    // read was not. Serialisation is now `pg_advisory_xact_lock`, which needs no
    // table privilege and is released by COMMIT or ROLLBACK.
    const authorization = await authorizeUpload();

    const registered = await withTransaction(asShared(), (db) =>
      attachments.registerVersion(db, {
        uploadToken: authorization.uploadToken,
        documentId: authorization.documentId,
        checksumSha256: SHA_HEX,
        byteSize: BYTE_SIZE,
      })
    );

    expect(registered.documentId).toBe(authorization.documentId);
    expect(registered.versionNumber).toBe(1);

    // The row landed, and it landed PENDING — the initial-state guard permits
    // nothing else, and no path in this phase can accept it.
    const stored = await admin.query<{ status: string; version_number: number }>(
      `SELECT status, version_number FROM shared.document_versions WHERE id = $1`,
      [registered.versionId]
    );
    expect(stored.rows[0]?.status).toBe('pending');
    expect(stored.rows[0]?.version_number).toBe(1);

    expect(await auditCount('shared.document.version_registered', registered.versionId)).toBe(1);
    expect(await outboxCount(`document.version:${registered.versionId}`)).toBe(1);
  });

  it('a second registration for the same document is version 2, not a collision', async () => {
    // Proves the advisory lock and `uq_document_versions_number` agree: the
    // counter advances rather than two registrations racing to version 1.
    const first = await authorizeUpload();
    const firstVersion = await withTransaction(asShared(), (db) =>
      attachments.registerVersion(db, {
        uploadToken: first.uploadToken,
        documentId: first.documentId,
        checksumSha256: SHA_HEX,
        byteSize: BYTE_SIZE,
      })
    );
    expect(firstVersion.versionNumber).toBe(1);

    // A second authorization against the SAME document is not obtainable through
    // `authorizeUpload` (it always creates a new document), so the second version
    // is registered with a token minted for the same document id — which is
    // exactly what a client re-uploading a corrected file would present.
    const secondToken = encodeUploadToken({
      v: 1,
      documentId: first.documentId,
      versionId: randomUUID(),
      contentType: CONTENT_TYPE,
      maxBytes: BYTE_SIZE,
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const secondVersion = await withTransaction(asShared(), (db) =>
      attachments.registerVersion(db, {
        uploadToken: secondToken,
        documentId: first.documentId,
        checksumSha256: SHA_HEX,
        byteSize: BYTE_SIZE,
      })
    );
    expect(secondVersion.versionNumber).toBe(2);
  });

  it('replaying the same upload token is refused as a conflict, not silently accepted', async () => {
    const authorization = await authorizeUpload();
    const input = {
      uploadToken: authorization.uploadToken,
      documentId: authorization.documentId,
      checksumSha256: SHA_HEX,
      byteSize: BYTE_SIZE,
    };

    await withTransaction(asShared(), (db) => attachments.registerVersion(db, input));

    const error = await withTransaction(asShared(), (db) =>
      attachments.registerVersion(db, input).catch((e: unknown) => e)
    );
    // The version id is fixed in the token, so the replay collides on the primary
    // key. Reported as a conflict rather than returning the existing row: the
    // replayed checksum may differ from the one already recorded.
    expect((error as AppFailure).code).toBe('ERR-RES-002');

    expect(
      await countRows(admin, 'shared.document_versions', 'document_id = $1', [
        authorization.documentId,
      ])
    ).toBe(1);
  });

  it('denial: the operation gate refuses an unpermissioned principal with ERR-IAM-001', async () => {
    const error = await withTransaction(asUnpriv(), (db) =>
      requirePermissions(db, ATTACHMENT_VERSION_REGISTER_OPERATION).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });

  it('cross-tenant: a forged token naming a tenant-B document resolves to nothing (ERR-RES-001)', async () => {
    // The token is unsigned by design and carries no authority: the document is
    // re-loaded under RLS, so naming another tenant's document finds nothing.
    // This refusal happens before the blocked lock, so it is fully observable.
    const forged = encodeUploadToken({
      v: 1,
      documentId: DOC_B,
      versionId: randomUUID(),
      contentType: CONTENT_TYPE,
      maxBytes: BYTE_SIZE,
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const error = await withTransaction(asShared(), (db) =>
      attachments
        .registerVersion(db, {
          uploadToken: forged,
          documentId: null,
          checksumSha256: SHA_HEX,
          byteSize: BYTE_SIZE,
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-001');
    expect(await countRows(admin, 'shared.document_versions', 'document_id = $1', [DOC_B])).toBe(0);
  });
});

// ===========================================================================
// shared.attachment-version-reject
// ===========================================================================
describe('shared.attachment-version-reject', () => {
  it('rejects a pending version and audits the transition', async () => {
    const authorization = await authorizeUpload();
    const versionId = await seedVersion(authorization.documentId, 'pending');

    const result = await withTransaction(asShared(), (db) =>
      attachments.rejectVersion(db, versionId, 'fx-p15 rejected by the evidence suite')
    );
    expect(result.status).toBe('rejected');
    expect(await versionStatus(versionId)).toBe('rejected');
    expect(await auditCount('shared.document.version_rejected', versionId)).toBe(1);
  });

  it('denial: a principal without shared.document.manage rejects zero rows (ERR-TRN-001)', async () => {
    const authorization = await authorizeUpload();
    const versionId = await seedVersion(authorization.documentId, 'pending');

    const error = await withTransaction(asUnpriv(), (db) =>
      attachments.rejectVersion(db, versionId, 'nope').catch((e: unknown) => e)
    );
    // `upd_document_versions_reject` filters the row out of the USING clause, so
    // the UPDATE affects zero rows and raises nothing; the service can only
    // report that as a state refusal. The proof it was the POLICY is the row:
    // it is still pending, and no audit record was written.
    expect((error as AppFailure).code).toBe('ERR-TRN-001');
    expect(await versionStatus(versionId)).toBe('pending');
    expect(await auditCount('shared.document.version_rejected', versionId)).toBe(0);
  });

  it('a version that is already rejected cannot be rejected again', async () => {
    const authorization = await authorizeUpload();
    const versionId = await seedVersion(authorization.documentId, 'pending');
    await withTransaction(asShared(), (db) => attachments.rejectVersion(db, versionId, 'first'));

    const error = await withTransaction(asShared(), (db) =>
      attachments.rejectVersion(db, versionId, 'second').catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-TRN-001');
    expect(await auditCount('shared.document.version_rejected', versionId)).toBe(1);
  });
});

// ===========================================================================
// shared.attachment-download-authorize
// ===========================================================================
describe('shared.attachment-download-authorize', () => {
  it('signs a download URL for an accepted version and audits the issuance', async () => {
    const authorization = await authorizeUpload();
    const versionId = await seedVersion(authorization.documentId, 'accepted');

    const grant = await withTransaction(asShared(), (db) =>
      attachments.requestDownload(db, { documentId: authorization.documentId, versionId })
    );
    expect(storage.verify(grant.url).valid).toBe(true);
    expect(grant.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await auditCount('shared.document.download_authorized', versionId)).toBe(1);
  });

  it('denial: a pending version is refused with ERR-DOC-001 and nothing is signed or audited', async () => {
    const authorization = await authorizeUpload();
    const versionId = await seedVersion(authorization.documentId, 'pending');

    const error = await withTransaction(asShared(), (db) =>
      attachments
        .requestDownload(db, { documentId: authorization.documentId, versionId })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-DOC-001');
    expect(await auditCount('shared.document.download_authorized', versionId)).toBe(0);
  });

  it('denial: the operation gate refuses an unpermissioned principal with ERR-IAM-001', async () => {
    // `requestDownload()` performs no permission check of its own — it reads and
    // signs, and the gate is the operation declaration the pipeline enforces. So
    // the permission denial is proved where it actually lives.
    const error = await withTransaction(asUnpriv(), (db) =>
      requirePermissions(db, ATTACHMENT_DOWNLOAD_AUTHORIZE_OPERATION).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });

  it('cross-tenant: a tenant-B document has no version visible to tenant A', async () => {
    const error = await withTransaction(asShared(), (db) =>
      attachments.requestDownload(db, { documentId: DOC_B }).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-001');
  });
});

// ===========================================================================
// shared.attachment-link-create
// ===========================================================================
describe('shared.attachment-link-create', () => {
  it('establishes reachability, audits it, and publishes exactly one event', async () => {
    const authorization = await authorizeUpload();
    const { linkId } = await createLink(authorization.documentId);

    const link = await admin.query<{ entity_type: string; deleted_at: string | null }>(
      'SELECT entity_type, deleted_at FROM shared.document_links WHERE id = $1',
      [linkId]
    );
    expect(link.rows[0]?.entity_type).toBe('org.legal_companies');
    expect(link.rows[0]?.deleted_at).toBeNull();
    expect(await auditCount('shared.document.linked', linkId)).toBe(1);
    expect(await outboxCount(`document.link:${linkId}:linked`)).toBe(1);
  });

  it('denial: a principal without shared.document.manage is refused by the INSERT policy (42501)', async () => {
    const authorization = await authorizeUpload();
    const error = await withTransaction(asUnpriv(), (db) =>
      attachments
        .link(db, {
          documentId: authorization.documentId,
          entityType: 'org.legal_companies',
          entityId: COMPANY_A1,
          linkPurpose: 'attachment',
        })
        .catch((e: unknown) => e)
    );
    expect((error as { code?: string }).code).toBe('42501');
    expect(
      await countRows(admin, 'shared.document_links', 'document_id = $1', [
        authorization.documentId,
      ])
    ).toBe(0);
  });

  it('cross-tenant: a tenant-B document cannot be linked from tenant A (ERR-RES-001)', async () => {
    const error = await withTransaction(asShared(), (db) =>
      attachments
        .link(db, {
          documentId: DOC_B,
          entityType: 'org.legal_companies',
          entityId: COMPANY_A1,
          linkPurpose: 'attachment',
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-001');
    expect(await countRows(admin, 'shared.document_links', 'document_id = $1', [DOC_B])).toBe(0);
  });

  it('an entity type outside the allow-list is refused before any write (ERR-VAL-001)', async () => {
    const authorization = await authorizeUpload();
    const error = await withTransaction(asShared(), (db) =>
      attachments
        .link(db, {
          documentId: authorization.documentId,
          entityType: 'zz.not_a_table',
          entityId: COMPANY_A1,
          linkPurpose: 'attachment',
        })
        .catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
  });
});

// ===========================================================================
// shared.attachment-link-withdraw
// ===========================================================================
describe('shared.attachment-link-withdraw', () => {
  it('withdraws a link, retains the row, audits it, and publishes exactly one event', async () => {
    const authorization = await authorizeUpload();
    const { linkId } = await createLink(authorization.documentId);

    await withTransaction(asShared(), (db) => attachments.unlink(db, linkId));

    // The row survives: `app_runtime` holds no DELETE, because the fact that a
    // document WAS attached to an entity is itself evidence.
    const link = await admin.query<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM shared.document_links WHERE id = $1',
      [linkId]
    );
    expect(link.rowCount).toBe(1);
    expect(link.rows[0]?.deleted_at).not.toBeNull();
    expect(await auditCount('shared.document.unlinked', linkId)).toBe(1);
    expect(await outboxCount(`document.link:${linkId}:unlinked`)).toBe(1);
  });

  it('denial: a principal without shared.document.manage withdraws zero rows (ERR-IAM-001)', async () => {
    const authorization = await authorizeUpload();
    const { linkId } = await createLink(authorization.documentId);

    const error = await withTransaction(asUnpriv(), (db) =>
      attachments.unlink(db, linkId).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    const link = await admin.query<{ deleted_at: string | null }>(
      'SELECT deleted_at FROM shared.document_links WHERE id = $1',
      [linkId]
    );
    expect(link.rows[0]?.deleted_at).toBeNull();
    expect(await auditCount('shared.document.unlinked', linkId)).toBe(0);
  });

  it('a link that is already withdrawn is not found (ERR-RES-001)', async () => {
    const authorization = await authorizeUpload();
    const { linkId } = await createLink(authorization.documentId);
    await withTransaction(asShared(), (db) => attachments.unlink(db, linkId));

    const error = await withTransaction(asShared(), (db) =>
      attachments.unlink(db, linkId).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-001');
    expect(await auditCount('shared.document.unlinked', linkId)).toBe(1);
  });
});

// ===========================================================================
// shared.notification-enqueue
// ===========================================================================
describe('shared.notification-enqueue', () => {
  it('enqueues one pending message, audits it, publishes one event, and contacts no provider', async () => {
    const input = queueInput();
    const before = messages.callCount;

    const result = await withTransaction(asShared(), (db) =>
      notifications.queueMessageWithRendering(db, input)
    );
    expect(result.queued.deduplicated).toBe(false);

    // Content is rendered once, here, and deliberately not stored: the row keeps
    // only the digest. Variable values are HTML-escaped; the authored body is not.
    expect(result.rendered.body).toContain('fx &lt;Recipient&gt; &amp; Co');

    const row = await admin.query<{
      status: string;
      channel: string;
      recipient_user_id: string | null;
      recipient_digest: Buffer | null;
      dedupe_key: string;
    }>(
      `SELECT status, channel, recipient_user_id, recipient_digest, dedupe_key
         FROM shared.outbound_messages WHERE id = $1`,
      [result.queued.messageId]
    );
    expect(row.rows[0]?.status).toBe('pending');
    expect(row.rows[0]?.channel).toBe('email');
    // The recipient reference is not a tenant user, so only a tenant-salted
    // digest is stored and the raw reference never reaches the row.
    expect(row.rows[0]?.recipient_user_id).toBeNull();
    expect(row.rows[0]?.recipient_digest).not.toBeNull();

    expect(await auditCount('shared.notification.enqueued', result.queued.messageId)).toBe(1);
    expect(await outboxCount(`message.enqueued:${result.queued.messageId}`)).toBe(1);
    // Enqueue-first: no delivery provider is reached inside the source transaction.
    expect(messages.callCount).toBe(before);
  });

  it('resolves one scope for the row, the audit record and the event (PMR-004)', async () => {
    // A caller may name a branch and leave the company to the session. The row
    // resolved it that way; the audit record and the outbox event did not, so a
    // branch-scoped enqueue wrote `(company, branch)` to the message and
    // `(null, branch)` to the outbox — which
    // `ck_event_outbox_branch_requires_company` refuses, turning a valid request
    // into a fault. The three now read one resolved value.
    const context = contextFor({
      userId: U_SHARED,
      operation: 'shared.p1-15-evidence',
      module: 'shared-services',
      companyIds: [COMPANY_A1],
    });
    const input = queueInput({ companyId: null, branchId: null });

    const result = await withTransaction(context, (db) => notifications.queueMessage(db, input));

    const scopes = await admin.query<{ src: string; company_id: string | null }>(
      `SELECT 'message' AS src, company_id FROM shared.outbound_messages WHERE id = $1
       UNION ALL
       SELECT 'outbox'  AS src, company_id FROM shared.event_outbox
        WHERE tenant_id = $2 AND event_key = $3`,
      [result.messageId, TENANT_A, `message.enqueued:${result.messageId}`]
    );
    expect(scopes.rows).toHaveLength(2);
    const [a, b] = scopes.rows;
    // Same company on both, and it is the one the session supplied — not null.
    expect(a?.company_id).toBe(COMPANY_A1);
    expect(b?.company_id).toBe(COMPANY_A1);
  });

  it('denial: a principal without shared.notification.send is refused by the INSERT policy (42501)', async () => {
    const input = queueInput();
    const error = await withTransaction(asUnpriv(), (db) =>
      notifications.queueMessage(db, input).catch((e: unknown) => e)
    );
    expect((error as { code?: string }).code).toBe('42501');
    expect(
      await countRows(admin, 'shared.outbound_messages', 'tenant_id = $1 AND dedupe_key = $2', [
        TENANT_A,
        input.dedupeKey,
      ])
    ).toBe(0);
  });

  it('denial: the operation gate refuses the same principal with ERR-IAM-001', async () => {
    const error = await withTransaction(asUnpriv(), (db) =>
      requirePermissions(db, NOTIFICATION_ENQUEUE_OPERATION).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });

  it('cross-tenant: a tenant-B template version is not visible to tenant A (ERR-RES-001)', async () => {
    const input = queueInput({ templateVersionId: TPLVER_B });
    const error = await withTransaction(asShared(), (db) =>
      notifications.queueMessage(db, input).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-RES-001');
    expect(
      await countRows(admin, 'shared.outbound_messages', 'tenant_id = $1 AND dedupe_key = $2', [
        TENANT_A,
        input.dedupeKey,
      ])
    ).toBe(0);
  });

  it('idempotency: the same dedupe key twice returns deduplicated and creates exactly one row', async () => {
    const input = queueInput();

    const first = await withTransaction(asShared(), (db) => notifications.queueMessage(db, input));
    const second = await withTransaction(asShared(), (db) => notifications.queueMessage(db, input));

    expect(first.deduplicated).toBe(false);
    expect(second.deduplicated).toBe(true);
    expect(second.messageId).toBe(first.messageId);
    expect(
      await countRows(admin, 'shared.outbound_messages', 'tenant_id = $1 AND dedupe_key = $2', [
        TENANT_A,
        input.dedupeKey,
      ])
    ).toBe(1);
    // The replay writes neither a second audit record nor a second event.
    expect(await auditCount('shared.notification.enqueued', first.messageId)).toBe(1);
    expect(await outboxCount(`message.enqueued:${first.messageId}`)).toBe(1);
  });

  it('a consent evaluation that was not granted is refused with ERR-NTF-001 and creates nothing', async () => {
    const input = queueInput({
      consentEvaluation: {
        granted: false,
        consentRecordId: 'fx-p15-consent',
        evaluatedAt: new Date(),
      },
    });
    const error = await withTransaction(asShared(), (db) =>
      notifications.queueMessage(db, input).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-NTF-001');
    expect(
      await countRows(admin, 'shared.outbound_messages', 'tenant_id = $1 AND dedupe_key = $2', [
        TENANT_A,
        input.dedupeKey,
      ])
    ).toBe(0);
  });

  it('a channel the platform does not support is refused with ERR-VAL-001 and creates nothing', async () => {
    // `sms` is inside the frozen NotificationChannel union and outside
    // `ck_outbound_messages_channel`. The policy refuses it with a stable code
    // rather than letting it surface as a CHECK violation.
    const input = queueInput({ channel: 'sms' });
    const error = await withTransaction(asShared(), (db) =>
      notifications.queueMessage(db, input).catch((e: unknown) => e)
    );
    expect((error as AppFailure).code).toBe('ERR-VAL-001');
    expect(
      await countRows(admin, 'shared.outbound_messages', 'tenant_id = $1 AND dedupe_key = $2', [
        TENANT_A,
        input.dedupeKey,
      ])
    ).toBe(0);
  });
});

// ===========================================================================
// Atomicity — BR-INT-001
// ===========================================================================
describe('shared-services atomicity', () => {
  it('an injected failure after the outbox write leaves no document, version, link, audit or event', async () => {
    let documentId = '';
    let linkId = '';

    const rejection = await withTransaction(asShared(), async (db) => {
      const authorization = await attachments.authorizeUploadDetailed(db, uploadInput());
      documentId = authorization.documentId;
      // `link()` is the step that writes to shared.event_outbox, so the throw
      // below happens strictly after an outbox row exists in this transaction.
      const link = await attachments.link(db, {
        documentId,
        entityType: 'org.legal_companies',
        entityId: COMPANY_A1,
        linkPurpose: 'attachment',
      });
      linkId = link.linkId;
      throw new Error('injected failure after the outbox write');
    }).catch((e: unknown) => e);

    // The ids were produced, so the writes really happened inside the transaction
    // — this is a rollback proof, not a "nothing ever ran" proof.
    expect(documentId).not.toBe('');
    expect(linkId).not.toBe('');
    expect((rejection as Error).message).toBe('injected failure after the outbox write');

    expect(await countRows(admin, 'shared.documents', 'id = $1', [documentId])).toBe(0);
    // No version either. `registerVersion()` could not be part of this sequence
    // (see the BLOCKER note), so this asserts the weaker but still meaningful
    // fact that the rolled-back document carries no version rows.
    expect(
      await countRows(admin, 'shared.document_versions', 'document_id = $1', [documentId])
    ).toBe(0);
    expect(await countRows(admin, 'shared.document_links', 'id = $1', [linkId])).toBe(0);
    expect(await auditCount('shared.document.upload_authorized', documentId)).toBe(0);
    expect(await auditCount('shared.document.linked', linkId)).toBe(0);
    expect(await outboxCount(`document.link:${linkId}:linked`)).toBe(0);
  });
});
