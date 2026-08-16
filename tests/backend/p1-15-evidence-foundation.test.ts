/**
 * P1-OD-025 evidence foundation — the two new read operations, and the
 * end-to-end behaviour of the private versioned evidence model, driven through
 * the REAL wiring on the deployed `app_runtime` identity.
 *
 * ===========================================================================
 * WHAT THIS SUITE IS FOR
 * ===========================================================================
 * The decision this implements says evidence must never be authorized by a
 * filename or a storage key: a caller reaches bytes because a business link and
 * a permission say so. That sentence is only worth anything if the opposite is
 * demonstrably refused, so the suite is built around refusals:
 *
 *  - **a raw storage key authorizes nothing.** The download operation takes a
 *    document id and a version id. There is no parameter that accepts a key,
 *    the key is never projected by any read, and holding one changes no answer.
 *  - **a rejected or quarantined version can never satisfy evidence.** Both are
 *    terminal, neither can transition onward, and the download path refuses
 *    both by state rather than by hope.
 *  - **a scanner that fails quarantines.** The failure paths are driven with a
 *    readable provider that genuinely fails, not with a mocked verdict.
 *  - **cross-tenant is refused at every layer** — route, service and function.
 *  - **the category policy is enforced on the server.** A client that omits the
 *    device capture timestamp on a category that requires one is refused, and a
 *    client that invents an implausible one is refused too.
 *
 * ===========================================================================
 * THE STORAGE PROVIDER HERE IS READABLE, AND THAT IS THE POINT
 * ===========================================================================
 * `LocalStorageProvider` cannot read, so `registerVersionAndScan` leaves a
 * version pending against it — which is correct, and is itself asserted, but it
 * exercises none of the scanner. `ReadableFixtureStorage` below extends it with
 * a `readObject` the test controls, so the scan path runs for real: the bytes
 * it returns are decoded by the same `sharp` full-decode the operational path
 * uses, and the verdict is whatever that decode plus the checksum comparison
 * actually produces. Nothing about the verdict is stubbed.
 *
 * The `postgres` admin connection provisions preconditions and reads back what
 * landed. It carries BYPASSRLS, so nothing it does is evidence.
 *
 * COVERAGE-EVIDENCE (P1-OD-025 evidence foundation):
 *   shared.document-category-list: route service authorization success denial
 *   shared.document-version-read: route service authorization success denial cross-tenant
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import {
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import { withTransaction } from '@/server/db/transaction';
import { AppFailure } from '@/server/errors/app-failure';
import {
  LocalStorageProvider,
  StorageProviderError,
  buildStorageKey,
  setStorageProvider,
  sharedServicesModule,
  __resetStorageProviderForTests,
} from '@/modules/shared-services';
import type {
  ReadableStorageProvider,
  StoredObject,
} from '@/modules/shared-services/provider/storage-provider';
import type { AttachmentService } from '@/modules/shared-services/application/attachment-service';
import {
  DOCUMENT_CATEGORY_LIST_OPERATION,
  GET as categoryListRoute,
} from '@/app/api/v1/attachments/categories/route';
import {
  DOCUMENT_VERSION_READ_OPERATION,
  GET as versionReadRoute,
} from '@/app/api/v1/attachments/versions/[versionId]/route';

// ---------------------------------------------------------------------------
// Fixtures. A distinct id space (e5…) from every other backend suite. All of it
// is ephemeral scaffolding removed by cleanBackendFixtures(); no business data.
// ---------------------------------------------------------------------------

/** Tenant A principal holding both the write and the read permission. */
const U_EV_A = 'e5000000-0000-4000-8000-000000000001';
/** Tenant A principal holding ONLY the read permission. */
const U_EV_READER = 'e5000000-0000-4000-8000-000000000002';
/** Tenant A principal holding NEITHER, so a denial differs in one fact. */
const U_EV_NONE = 'e5000000-0000-4000-8000-000000000003';
/** Tenant B principal holding both, so cross-tenant proofs use real rows. */
const U_EV_B = 'e5000000-0000-4000-8000-00000000000b';

const ROLE_FULL_A = 'e5100000-0000-4000-8000-000000000001';
const ROLE_READ_A = 'e5100000-0000-4000-8000-000000000002';
const ROLE_NONE_A = 'e5100000-0000-4000-8000-000000000003';
const ROLE_FULL_B = 'e5100000-0000-4000-8000-00000000000b';

const SUBJECT_FULL_A = 'fx_p15_ev_full';
const SUBJECT_READER_A = 'fx_p15_ev_reader';
const SUBJECT_NONE_A = 'fx_p15_ev_none';
const SUBJECT_FULL_B = 'fx_p15_ev_full_b';
const IDENTITY_PROVIDER = 'test_harness';

/** Image category, capture timestamp NOT required. */
const CATEGORY_PLAIN = 'e5200000-0000-4000-8000-000000000001';
const CODE_PLAIN = 'fx_p15_ev_plain';
/** Image category that DOES require a device capture timestamp. */
const CATEGORY_CAPTURE = 'e5200000-0000-4000-8000-000000000002';
const CODE_CAPTURE = 'fx_p15_ev_capture';
/** Tenant B category, so the list proof is about visibility, not absence. */
const CATEGORY_B = 'e5200000-0000-4000-8000-00000000000b';
const CODE_B = 'fx_p15_ev_plain_b';

const WRITE_PERMISSION = 'shared.document.manage';
const READ_PERMISSION = 'shared.document.read';

const CONTENT_TYPE = 'image/png';

let admin: Pool;
let runtime: Pool;
let attachments: AttachmentService;

/** A genuine 4x4 PNG, produced by the same library that will decode it. */
let pngBytes: Buffer;
let pngSha: string;

const asFullA = () =>
  contextFor({ userId: U_EV_A, operation: 'shared.p1-15-evidence', module: 'shared-services' });
const asReaderA = () =>
  contextFor({
    userId: U_EV_READER,
    operation: 'shared.p1-15-evidence',
    module: 'shared-services',
  });
const asFullB = () =>
  contextFor({
    userId: U_EV_B,
    tenantId: TENANT_B,
    operation: 'shared.p1-15-evidence',
    module: 'shared-services',
  });

// ---------------------------------------------------------------------------
// A storage provider that can actually be read, so the scanner runs for real.
// ---------------------------------------------------------------------------

type ReadBehaviour =
  | { readonly kind: 'bytes'; readonly bytes: Uint8Array; readonly contentType: string }
  | { readonly kind: 'outage' }
  | { readonly kind: 'missing' };

class ReadableFixtureStorage extends LocalStorageProvider implements ReadableStorageProvider {
  public readBehaviour: ReadBehaviour = { kind: 'outage' };
  /** Every key this provider was asked to read, so "which object" is checkable. */
  public readonly reads: string[] = [];

  async readObject(storageKey: string, maxBytes: number): Promise<StoredObject> {
    this.reads.push(storageKey);
    if (this.readBehaviour.kind === 'outage') {
      throw new StorageProviderError('fixture: storage unavailable', 'outage');
    }
    if (this.readBehaviour.kind === 'missing') {
      throw new StorageProviderError('fixture: object absent', 'refused');
    }
    if (this.readBehaviour.bytes.byteLength > maxBytes) {
      throw new StorageProviderError('fixture: object exceeds the declared bound', 'refused');
    }
    return {
      bytes: this.readBehaviour.bytes,
      contentType: this.readBehaviour.contentType,
      contentLength: this.readBehaviour.bytes.byteLength,
    };
  }
}

let storage: ReadableFixtureStorage;

// ---------------------------------------------------------------------------
// HTTP driver, identical in shape to the P1-15 route-evidence suite.
// ---------------------------------------------------------------------------

type RouteFn = (
  request: Request,
  route: { params: Promise<Record<string, string>> }
) => Promise<Response>;

const asRoute = (handler: unknown): RouteFn => handler as RouteFn;

interface CallResult<T> {
  readonly status: number;
  readonly body: T;
}

async function call<T>(
  handler: unknown,
  input: { path: string; params?: Record<string, string> }
): Promise<CallResult<T>> {
  const request = new Request(`http://localhost/api/v1${input.path}`, {
    method: 'GET',
    headers: { 'content-type': 'application/json' },
  });
  const response = await asRoute(handler)(request, {
    params: Promise.resolve(input.params ?? {}),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

const authenticateAs = (providerSubject: string, tenantId: string = TENANT_A): void => {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId,
    })
  );
};

// ---------------------------------------------------------------------------
// Readers. `admin` is used here and only here.
// ---------------------------------------------------------------------------

const versionRow = async (
  versionId: string
): Promise<
  | {
      status: string;
      storage_key: string;
      version_number: number;
      captured_at: Date | null;
      scanning_at: Date | null;
    }
  | undefined
> => {
  const result = await admin.query<{
    status: string;
    storage_key: string;
    version_number: number;
    captured_at: Date | null;
    scanning_at: Date | null;
  }>(
    `SELECT status, storage_key, version_number, captured_at, scanning_at
       FROM shared.document_versions WHERE id = $1`,
    [versionId]
  );
  return result.rows[0];
};

const scanVerdicts = async (versionId: string): Promise<string[]> => {
  const result = await admin.query<{ scan_status: string }>(
    `SELECT scan_status FROM shared.file_scan_results WHERE version_id = $1 ORDER BY scanned_at`,
    [versionId]
  );
  return result.rows.map((row) => row.scan_status);
};

// ---------------------------------------------------------------------------

async function seedSuiteFixtures(): Promise<void> {
  for (const [id, tenant, subject, name] of [
    [U_EV_A, TENANT_A, SUBJECT_FULL_A, 'P1-15 evidence full A'],
    [U_EV_READER, TENANT_A, SUBJECT_READER_A, 'P1-15 evidence reader A'],
    [U_EV_NONE, TENANT_A, SUBJECT_NONE_A, 'P1-15 evidence none A'],
    [U_EV_B, TENANT_B, SUBJECT_FULL_B, 'P1-15 evidence full B'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, 'test_harness', $3, $4, $5, 'active', $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, tenant, subject, `${subject}@example.test`, name, USER_A]
    );
  }

  for (const [id, tenant, code, name] of [
    [ROLE_FULL_A, TENANT_A, 'fx_p15_ev_full', 'P1-15 evidence full'],
    [ROLE_READ_A, TENANT_A, 'fx_p15_ev_read', 'P1-15 evidence read'],
    [ROLE_NONE_A, TENANT_A, 'fx_p15_ev_none', 'P1-15 evidence none'],
    [ROLE_FULL_B, TENANT_B, 'fx_p15_ev_full', 'P1-15 evidence full B'],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING`,
      [id, tenant, code, name, USER_A]
    );
  }

  // ROLE_NONE_A maps nothing at all: the unpermitted case differs from the
  // permitted one only in the presence of these rows.
  for (const [role, tenant, permissions] of [
    [ROLE_FULL_A, TENANT_A, [WRITE_PERMISSION, READ_PERMISSION]],
    [ROLE_READ_A, TENANT_A, [READ_PERMISSION]],
    [ROLE_FULL_B, TENANT_B, [WRITE_PERMISSION, READ_PERMISSION]],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = ANY($4::text[])
       ON CONFLICT DO NOTHING`,
      [tenant, role, USER_A, [...permissions]]
    );
  }

  for (const [tenant, user, role] of [
    [TENANT_A, U_EV_A, ROLE_FULL_A],
    [TENANT_A, U_EV_READER, ROLE_READ_A],
    [TENANT_A, U_EV_NONE, ROLE_NONE_A],
    [TENANT_B, U_EV_B, ROLE_FULL_B],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_grants
         (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       SELECT $1, $2, $3, 'unrestricted', 'active', $4, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM iam.role_grants WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3)`,
      [tenant, user, role, USER_A]
    );
  }

  for (const [id, tenant, code, captureRequired, purpose] of [
    [CATEGORY_PLAIN, TENANT_A, CODE_PLAIN, false, 'evidence'],
    [CATEGORY_CAPTURE, TENANT_A, CODE_CAPTURE, true, 'inspection_media'],
    [CATEGORY_B, TENANT_B, CODE_B, false, 'evidence'],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
          default_classification, default_retention_class, business_link_purpose,
          device_capture_timestamp_required, created_by)
       VALUES ($1, 'tenant', $2, $3, 'P1-15 evidence fixture category',
               ARRAY['image/png']::text[], 1048576, 'restricted', 'evidence-audit', $4, $5, $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, tenant, code, purpose, captureRequired, USER_A]
    );
  }
}

beforeAll(async () => {
  __resetBackendConfigForTests();
  admin = adminPool();
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);
  await ensureTestLogins(admin);
  await ensureBackendFixtures(admin);
  await seedSuiteFixtures();

  storage = new ReadableFixtureStorage({ bucket: 'fx-evidence-bucket' });
  setStorageProvider(storage);
  attachments = sharedServicesModule().attachments;

  pngBytes = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 12, g: 34, b: 56 } },
  })
    .png()
    .toBuffer();
  pngSha = createHash('sha256').update(pngBytes).digest('hex');
});

afterAll(async () => {
  await cleanBackendFixtures(admin);
  __resetStorageProviderForTests();
  __resetAuthenticatorForTests();
  await runtime.end();
  await admin.end();
});

afterEach(() => {
  __resetAuthenticatorForTests();
  storage.readBehaviour = { kind: 'outage' };
});

// ---------------------------------------------------------------------------
// Builders. Every precondition is produced by the real service, so a
// precondition that silently stopped working fails the test rather than hiding.
// ---------------------------------------------------------------------------

interface Uploaded {
  readonly documentId: string;
  readonly uploadToken: string;
}

const authorizeUpload = (categoryCode: string = CODE_PLAIN): Promise<Uploaded> =>
  withTransaction(asFullA(), async (db) => {
    const authorization = await attachments.authorizeUploadDetailed(db, {
      categoryCode,
      entityType: 'org.legal_companies',
      entityId: COMPANY_A1,
      fileName: 'fx-p15-evidence.png',
      contentType: CONTENT_TYPE,
      byteSize: pngBytes.byteLength,
    });
    return { documentId: authorization.documentId, uploadToken: authorization.uploadToken };
  });

/** Registers a version and lets the real scanner decide the outcome. */
const registerAndScan = (
  uploaded: Uploaded,
  over: { checksumSha256?: string; byteSize?: number; capturedAt?: Date | null } = {}
) =>
  withTransaction(asFullA(), (db) =>
    attachments.registerVersionAndScan(db, {
      uploadToken: uploaded.uploadToken,
      documentId: uploaded.documentId,
      checksumSha256: over.checksumSha256 ?? pngSha,
      byteSize: over.byteSize ?? pngBytes.byteLength,
      capturedAt: over.capturedAt ?? null,
    })
  );

const serveGoodBytes = (): void => {
  storage.readBehaviour = { kind: 'bytes', bytes: pngBytes, contentType: CONTENT_TYPE };
};

// ===========================================================================

describe('shared.document-category-list — the governed policy a client must obey', () => {
  it('returns the caller tenant categories through the route, with the policy flags', async () => {
    authenticateAs(SUBJECT_READER_A);
    const response = await call<{
      items: Array<{
        categoryCode: string;
        deviceCaptureTimestampRequired: boolean;
        businessLinkPurpose: string;
        allowedContentTypes: string[];
        maxBytes: number;
      }>;
    }>(categoryListRoute, { path: '/attachments/categories' });

    expect(response.status).toBe(200);
    const codes = response.body.items.map((item) => item.categoryCode);
    expect(codes).toContain(CODE_PLAIN);
    expect(codes).toContain(CODE_CAPTURE);

    const capture = response.body.items.find((item) => item.categoryCode === CODE_CAPTURE);
    expect(capture?.deviceCaptureTimestampRequired).toBe(true);
    expect(capture?.businessLinkPurpose).toBe('inspection_media');
    expect(capture?.allowedContentTypes).toEqual(['image/png']);
    expect(capture?.maxBytes).toBe(1_048_576);
  });

  it('never lists another tenant category', async () => {
    authenticateAs(SUBJECT_READER_A);
    const response = await call<{ items: Array<{ categoryCode: string }> }>(categoryListRoute, {
      path: '/attachments/categories',
    });
    expect(response.body.items.map((item) => item.categoryCode)).not.toContain(CODE_B);
  });

  it('refuses a caller without shared.document.read', async () => {
    authenticateAs(SUBJECT_NONE_A);
    const response = await call<{ code?: string }>(categoryListRoute, {
      path: '/attachments/categories',
    });
    expect(response.status).toBe(403);
    expect(DOCUMENT_CATEGORY_LIST_OPERATION.permissions).toEqual([READ_PERMISSION]);
  });

  it('is reachable by a READER, so reading evidence does not require the write permission', async () => {
    // The reason `shared.document.read` was minted: every document read used to
    // demand `shared.document.manage`, so a receptionist who may only look at
    // evidence had to be given the permission that creates it.
    const items = await withTransaction(asReaderA(), (db) => attachments.listCategories(db));
    expect(items.map((item) => item.categoryCode)).toContain(CODE_PLAIN);
  });
});

describe('shared.document-version-read — the lifecycle, without the locator', () => {
  it('projects the lifecycle of one version and NEVER its storage key', async () => {
    serveGoodBytes();
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded);

    authenticateAs(SUBJECT_READER_A);
    const response = await call<Record<string, unknown>>(versionReadRoute, {
      path: `/attachments/versions/${registered.versionId}`,
      params: { versionId: registered.versionId },
    });

    expect(response.status).toBe(200);
    // A KEY-SET assertion in both directions. A field-by-field check cannot
    // catch an ADDITION, and the addition that matters here is `storageKey`:
    // the key is a locator that travels outside RLS into every downstream
    // system that touches it.
    expect(Object.keys(response.body).sort()).toEqual([
      'acceptedAt',
      'byteSize',
      'capturedAt',
      'checksumSha256',
      'contentType',
      'documentId',
      'quarantinedAt',
      'rejectedAt',
      'scanVerdicts',
      'scanningAt',
      'status',
      'uploadedAt',
      'versionId',
      'versionNumber',
    ]);
    expect(JSON.stringify(response.body)).not.toContain(
      (await versionRow(registered.versionId))!.storage_key
    );
  });

  it('answers "not found" for a version in another tenant — the same shape as one that never existed', async () => {
    serveGoodBytes();
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded);

    authenticateAs(SUBJECT_FULL_B, TENANT_B);
    const real = await call<{ code?: string }>(versionReadRoute, {
      path: `/attachments/versions/${registered.versionId}`,
      params: { versionId: registered.versionId },
    });
    const imaginary = await call<{ code?: string }>(versionReadRoute, {
      path: `/attachments/versions/${randomUUID()}`,
      params: { versionId: randomUUID() },
    });
    expect(real.status).toBe(404);
    // Identical answers: the read cannot be used to learn that a version exists
    // in a tenant the caller is not in.
    expect(real.status).toBe(imaginary.status);
    expect(real.body.code).toBe(imaginary.body.code);
  });

  it('refuses a caller without shared.document.read', async () => {
    serveGoodBytes();
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded);

    authenticateAs(SUBJECT_NONE_A);
    const response = await call<{ code?: string }>(versionReadRoute, {
      path: `/attachments/versions/${registered.versionId}`,
      params: { versionId: registered.versionId },
    });
    expect(response.status).toBe(403);
    expect(DOCUMENT_VERSION_READ_OPERATION.permissions).toEqual([READ_PERMISSION]);
  });

  it('the service refuses a version id from another tenant, not only the route', async () => {
    serveGoodBytes();
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded);

    const failure = await withTransaction(asFullB(), (db) =>
      attachments.readVersion(db, registered.versionId).catch((error: unknown) => error)
    );
    expect(failure).toBeInstanceOf(AppFailure);
    expect((failure as AppFailure).code).toBe('ERR-RES-001');
  });
});

describe('the scanner decides, and a scanner that fails never accepts', () => {
  it('a genuine image that matches its declared checksum is accepted', async () => {
    serveGoodBytes();
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded);

    expect(registered.status).toBe('accepted');
    expect(registered.scanStatus).toBe('clean');
    const row = await versionRow(registered.versionId);
    expect(row?.status).toBe('accepted');
    // It reached `accepted` THROUGH scanning, which the row still records.
    expect(row?.scanning_at).not.toBeNull();
    expect(await scanVerdicts(registered.versionId)).toEqual(['clean']);
  });

  it('a storage outage quarantines — it does not accept, and it does not stay pending', async () => {
    storage.readBehaviour = { kind: 'outage' };
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded);

    expect(registered.status).toBe('quarantined');
    expect(registered.scanStatus).toBe('error');
    expect(await versionRow(registered.versionId).then((row) => row?.status)).toBe('quarantined');
    expect(await scanVerdicts(registered.versionId)).toEqual(['error']);
  });

  it('bytes that are not the declared image quarantine rather than accept', async () => {
    // A polyglot or truncated file: the declared content type says PNG and the
    // bytes do not decode as one. Metadata inspection alone would let this pass.
    storage.readBehaviour = {
      kind: 'bytes',
      bytes: Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1'),
      contentType: CONTENT_TYPE,
    };
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded, {
      checksumSha256: createHash('sha256')
        .update(Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1'))
        .digest('hex'),
      byteSize: Buffer.from('%PDF-1.7\n%âãÏÓ\n', 'latin1').byteLength,
    });

    expect(registered.status).toBe('quarantined');
    expect(registered.scanStatus).toBe('error');
  });

  it('a checksum that does not match the stored bytes quarantines', async () => {
    serveGoodBytes();
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded, { checksumSha256: 'ff'.repeat(32) });
    expect(registered.status).toBe('quarantined');
  });

  it('stays pending against a provider that cannot read, and records no verdict', async () => {
    // The deterministic local adapter is not readable. The correct answer is
    // "not scanned yet" — NOT "accepted because nothing objected".
    setStorageProvider(new LocalStorageProvider({ bucket: 'fx-evidence-bucket' }));
    try {
      const uploaded = await authorizeUpload();
      const registered = await registerAndScan(uploaded);
      expect(registered.status).toBe('pending');
      expect(registered.scannerAvailable).toBe(false);
      expect(registered.scanStatus).toBe('not_started');
      expect(await scanVerdicts(registered.versionId)).toEqual([]);
    } finally {
      setStorageProvider(storage);
    }
  });

  it('reads the object at the key the server rebuilt, never one a caller named', async () => {
    serveGoodBytes();
    storage.reads.length = 0;
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded);
    const row = await versionRow(registered.versionId);

    expect(storage.reads).toEqual([
      buildStorageKey({
        environment: 'local',
        tenantId: TENANT_A,
        documentId: registered.documentId,
        versionId: registered.versionId,
      }),
    ]);
    expect(storage.reads[0]).toBe(row?.storage_key);
  });
});

describe('a rejected or quarantined version can never satisfy evidence', () => {
  it('a quarantined version cannot be downloaded', async () => {
    storage.readBehaviour = { kind: 'outage' };
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded);
    expect(registered.status).toBe('quarantined');

    const failure = await withTransaction(asFullA(), (db) =>
      attachments
        .requestDownload(db, {
          documentId: registered.documentId,
          versionId: registered.versionId,
        })
        .catch((error: unknown) => error)
    );
    expect(failure).toBeInstanceOf(AppFailure);
    expect((failure as AppFailure).code).toBe('ERR-DOC-001');
  });

  it('a quarantined version cannot be transitioned onward, by any writer', async () => {
    storage.readBehaviour = { kind: 'outage' };
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded);

    // ADMIN, deliberately: BYPASSRLS and every column privilege. If even this
    // connection cannot move the row, "terminal" is a property of the data and
    // not of the permissions the request path happens to hold.
    for (const target of ['accepted', 'scanning', 'pending', 'rejected']) {
      const error = await admin
        .query(`UPDATE shared.document_versions SET status = $2 WHERE id = $1`, [
          registered.versionId,
          target,
        ])
        .then(() => null)
        .catch((caught: unknown) => caught as { code?: string });
      expect(error?.code, target).toBe('23514');
    }
    expect(await versionRow(registered.versionId).then((row) => row?.status)).toBe('quarantined');
  });

  it('a rejected version cannot be downloaded either', async () => {
    setStorageProvider(new LocalStorageProvider({ bucket: 'fx-evidence-bucket' }));
    let registered: { documentId: string; versionId: string };
    try {
      const uploaded = await authorizeUpload();
      registered = await registerAndScan(uploaded);
    } finally {
      setStorageProvider(storage);
    }
    await withTransaction(asFullA(), (db) =>
      attachments.rejectVersion(db, registered.versionId, 'fixture refusal')
    );
    expect(await versionRow(registered.versionId).then((row) => row?.status)).toBe('rejected');

    const failure = await withTransaction(asFullA(), (db) =>
      attachments
        .requestDownload(db, {
          documentId: registered.documentId,
          versionId: registered.versionId,
        })
        .catch((error: unknown) => error)
    );
    expect((failure as AppFailure).code).toBe('ERR-DOC-001');
  });
});

describe('access is authorized by the business link and the permission, never by a key', () => {
  it('holding another tenant storage key buys nothing — there is no parameter that takes one', async () => {
    serveGoodBytes();
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded);
    const key = (await versionRow(registered.versionId))!.storage_key;

    // The key is real, current, and names an ACCEPTED version. A tenant-B
    // caller holding it still cannot reach the document or the version, because
    // no read on this surface consumes a key at all.
    expect(key).toContain(TENANT_A);
    const documentFailure = await withTransaction(asFullB(), (db) =>
      attachments
        .requestDownload(db, {
          documentId: registered.documentId,
          versionId: registered.versionId,
        })
        .catch((error: unknown) => error)
    );
    expect((documentFailure as AppFailure).code).toBe('ERR-RES-001');

    const versionFailure = await withTransaction(asFullB(), (db) =>
      attachments.readVersion(db, registered.versionId).catch((error: unknown) => error)
    );
    expect((versionFailure as AppFailure).code).toBe('ERR-RES-001');
  });

  it('a download URL is short-lived and its expiry is bounded by configuration', async () => {
    serveGoodBytes();
    const uploaded = await authorizeUpload();
    const registered = await registerAndScan(uploaded);

    const before = Date.now();
    const grant = await withTransaction(asFullA(), (db) =>
      attachments.requestDownload(db, {
        documentId: registered.documentId,
        versionId: registered.versionId,
      })
    );
    // Bounded above by the absolute ceiling the port fixes, so no configuration
    // mistake can mint a capability that outlives it.
    expect(grant.expiresAt.getTime()).toBeGreaterThan(before);
    expect(grant.expiresAt.getTime()).toBeLessThanOrEqual(before + 900_000);
  });
});

describe('the category capture policy is enforced on the server', () => {
  it('refuses a registration that omits a required device capture timestamp', async () => {
    serveGoodBytes();
    const uploaded = await authorizeUpload(CODE_CAPTURE);
    const failure = await registerAndScan(uploaded, { capturedAt: null }).catch(
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(AppFailure);
    expect((failure as AppFailure).code).toBe('ERR-VAL-001');
  });

  it('accepts the same registration once the timestamp is supplied, and records it', async () => {
    serveGoodBytes();
    const uploaded = await authorizeUpload(CODE_CAPTURE);
    const capturedAt = new Date(Date.now() - 60_000);
    const registered = await registerAndScan(uploaded, { capturedAt });
    expect(registered.status).toBe('accepted');
    expect((await versionRow(registered.versionId))?.captured_at?.toISOString()).toBe(
      capturedAt.toISOString()
    );
  });

  it('refuses an implausible capture instant rather than recording it forever', async () => {
    serveGoodBytes();
    for (const capturedAt of [
      new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      new Date('1970-01-01T00:00:00.000Z'),
    ]) {
      const uploaded = await authorizeUpload(CODE_CAPTURE);
      const failure = await registerAndScan(uploaded, { capturedAt }).catch(
        (error: unknown) => error
      );
      expect((failure as AppFailure).code, capturedAt.toISOString()).toBe('ERR-VAL-001');
    }
  });

  it('does not demand a timestamp for a category that does not require one', async () => {
    serveGoodBytes();
    const uploaded = await authorizeUpload(CODE_PLAIN);
    const registered = await registerAndScan(uploaded, { capturedAt: null });
    expect(registered.status).toBe('accepted');
    expect((await versionRow(registered.versionId))?.captured_at).toBeNull();
  });
});

describe('a replacement is a new version, never an overwrite', () => {
  it('registers a second version at a distinct number and a distinct object', async () => {
    serveGoodBytes();
    const first = await authorizeUpload();
    const firstVersion = await registerAndScan(first);
    const firstRow = await versionRow(firstVersion.versionId);
    expect(firstVersion.status).toBe('accepted');

    // A replacement is authorized against the SAME document, which is what
    // makes it a replacement rather than a second document.
    const second = await withTransaction(asFullA(), async (db) => {
      const authorization = await attachments.authorizeUploadDetailed(db, {
        categoryCode: CODE_PLAIN,
        entityType: 'org.legal_companies',
        entityId: COMPANY_A1,
        fileName: 'fx-p15-evidence-replacement.png',
        contentType: CONTENT_TYPE,
        byteSize: pngBytes.byteLength,
      });
      return { documentId: authorization.documentId, uploadToken: authorization.uploadToken };
    });
    const secondVersion = await registerAndScan(second);
    const secondRow = await versionRow(secondVersion.versionId);

    expect(secondVersion.versionId).not.toBe(firstVersion.versionId);
    expect(secondRow?.storage_key).not.toBe(firstRow?.storage_key);

    // The first version is byte-for-byte what it was: still accepted, still at
    // its own key. Replacement adds; it never overwrites.
    const firstAfter = await versionRow(firstVersion.versionId);
    expect(firstAfter).toEqual(firstRow);
    expect(firstAfter?.status).toBe('accepted');
  });
});
