/**
 * P1-15 PUBLIC OPERATION EVIDENCE — every operation driven through its own HTTP
 * route handler.
 *
 * ===========================================================================
 * WHY THIS SUITE EXISTS, WHEN THREE OTHERS ALREADY COVER THESE SERVICES
 * ===========================================================================
 * `p1-15-attachments-notifications`, `p1-15-templates-transitions-export` and
 * `p1-15-dispatch-and-health` drive the *application services* on the deployed
 * `app_runtime` identity. That is real evidence, and it stays. What it does not
 * touch is the layer a client actually meets: the exported route function, the
 * request body schema, the `Idempotency-Key` and `If-Match` contracts, the
 * authorization gate inside `handleOperation`, and the status code and problem
 * document that come back.
 *
 * A service can be perfect while its route is wired to the wrong operation, asks
 * for the wrong permission, forgets `If-Match`, or returns 200 where it promised
 * 201 — and a service-level suite would stay green through all four. So every
 * assertion below starts from `new Request(...)` and ends at a `Response`.
 *
 * Nothing here is mocked:
 *
 *  - the real `sessionAuthenticator()` seam carries `StaticClaimsAuthenticator`,
 *    so `resolveRequestContext()` genuinely reads the account, its grants and its
 *    scope out of the database — a claim naming a tenant the account is not in
 *    resolves to nothing and is denied;
 *  - authorization is evaluated by `iam.has_permission` /
 *    `iam.has_permission_in_scope` inside the request transaction, on the runtime
 *    role, under RLS;
 *  - the two deterministic local providers are installed, so a signed URL is
 *    verified rather than asserted, and `LocalMessageProvider` is here to prove
 *    it is never called from a request transaction.
 *
 * The `postgres` admin connection provisions preconditions that no application
 * role may create (a `clean` file-scan row, an organization, a document
 * category) and reads back what landed. It carries BYPASSRLS, so nothing it does
 * is ever evidence.
 *
 * ===========================================================================
 * CROSS-TENANT PROOFS ARE BIDIRECTIONAL AND USE REAL ROWS
 * ===========================================================================
 * Tenant B has its own administrator holding the same five permissions, and its
 * fixtures are created **through the same routes**. So "a tenant-A caller cannot
 * reach it" is a statement about a document, template version, link and branch
 * that genuinely exist and were genuinely created by an authorized caller — not
 * about a made-up identifier that would be missing for either tenant.
 *
 * Operations exercised here (coverage-gate references):
 *   shared.attachment-upload-authorize    shared.attachment-version-register
 *   shared.attachment-version-reject      shared.attachment-download-authorize
 *   shared.attachment-link-create         shared.attachment-link-withdraw
 *   shared.notification-enqueue           shared.template-create
 *   shared.template-update                shared.template-version-create
 *   shared.template-version-revise        shared.template-version-approve
 *   shared.template-version-retire        shared.template-activation-set
 *   shared.template-version-preview       shared.branch-status-read
 *   shared.branch-status-change           shared.export-authorize
 *   shared.export-catalogue               shared.health-live
 *   shared.health-ready
 *
 * The two health operations are **public by declaration**, so their evidence
 * shape differs and is named honestly: `unauthenticated` rather than
 * `authorization`. What has to be proved for them is the opposite of a
 * permission gate — that the route answers with NO authenticator installed at
 * all, because an orchestrator has no session, and that answering without one
 * discloses nothing a session would have protected.
 *
 * COVERAGE-EVIDENCE (P1-15 route depth):
 *   shared.attachment-upload-authorize: route service authorization success denial cross-tenant audit idempotency
 *   shared.attachment-version-register: route service authorization success denial cross-tenant audit outbox idempotency
 *   shared.attachment-version-reject: route service authorization success denial cross-tenant audit
 *   shared.attachment-download-authorize: route service authorization success denial cross-tenant audit provider
 *   shared.attachment-link-create: route service authorization success denial cross-tenant audit outbox idempotency
 *   shared.attachment-link-withdraw: route service authorization success denial cross-tenant audit outbox
 *   shared.notification-enqueue: route service authorization success denial cross-tenant audit outbox idempotency provider
 *   shared.template-create: route service authorization success denial cross-tenant audit idempotency
 *   shared.template-update: route service authorization success denial cross-tenant audit stale-version
 *   shared.template-version-create: route service authorization success denial cross-tenant audit outbox idempotency
 *   shared.template-version-revise: route service authorization success denial cross-tenant audit stale-version
 *   shared.template-version-approve: route service authorization success denial cross-tenant audit outbox stale-version
 *   shared.template-version-retire: route service authorization success denial cross-tenant audit outbox stale-version
 *   shared.template-activation-set: route service authorization success denial cross-tenant audit stale-version
 *   shared.template-version-preview: route service authorization success denial cross-tenant
 *   shared.branch-status-read: route service authorization success cross-tenant isolation
 *   shared.branch-status-change: route service authorization success denial cross-tenant isolation audit outbox stale-version
 *   shared.export-authorize: route service authorization success denial audit
 *   shared.export-catalogue: route service authorization success
 *   shared.health-live: route service unauthenticated success
 *   shared.health-ready: route service unauthenticated success
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  COMPANY_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_UNPERMITTED,
  adminPool,
  cleanBackendFixtures,
  countRows,
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
import {
  LocalMessageProvider,
  LocalStorageProvider,
  setMessageProvider,
  setStorageProvider,
  __resetMessageProviderForTests,
  __resetStorageProviderForTests,
} from '@/modules/shared-services';

// --- The 19 authenticated P1-15 routes, imported exactly as Next.js loads them.
import {
  ATTACHMENT_UPLOAD_AUTHORIZE_OPERATION,
  POST as uploadAuthorizeRoute,
} from '@/app/api/v1/attachments/upload-authorizations/route';
import {
  ATTACHMENT_VERSION_REGISTER_OPERATION,
  POST as versionRegisterRoute,
} from '@/app/api/v1/attachments/versions/route';
import {
  ATTACHMENT_VERSION_REJECT_OPERATION,
  POST as versionRejectRoute,
} from '@/app/api/v1/attachments/versions/[versionId]/rejection/route';
import {
  ATTACHMENT_DOWNLOAD_AUTHORIZE_OPERATION,
  POST as downloadAuthorizeRoute,
} from '@/app/api/v1/attachments/documents/[documentId]/download-authorizations/route';
import {
  ATTACHMENT_LINK_CREATE_OPERATION,
  POST as linkCreateRoute,
} from '@/app/api/v1/attachments/documents/[documentId]/links/route';
import {
  ATTACHMENT_LINK_WITHDRAW_OPERATION,
  DELETE as linkWithdrawRoute,
} from '@/app/api/v1/attachments/links/[linkId]/route';
import {
  NOTIFICATION_ENQUEUE_OPERATION,
  POST as notificationEnqueueRoute,
} from '@/app/api/v1/notifications/route';
import {
  TEMPLATE_CREATE_OPERATION,
  POST as templateCreateRoute,
} from '@/app/api/v1/message-templates/route';
import {
  TEMPLATE_UPDATE_OPERATION,
  PATCH as templateUpdateRoute,
} from '@/app/api/v1/message-templates/[templateId]/route';
import {
  TEMPLATE_VERSION_CREATE_OPERATION,
  POST as templateVersionCreateRoute,
} from '@/app/api/v1/message-templates/[templateId]/versions/route';
import {
  TEMPLATE_ACTIVATION_OPERATION,
  PUT as templateActivationRoute,
} from '@/app/api/v1/message-templates/[templateId]/active-version/route';
import {
  TEMPLATE_VERSION_REVISE_OPERATION,
  PATCH as templateVersionReviseRoute,
} from '@/app/api/v1/template-versions/[versionId]/route';
import {
  TEMPLATE_VERSION_APPROVE_OPERATION,
  POST as templateVersionApproveRoute,
} from '@/app/api/v1/template-versions/[versionId]/approval/route';
import {
  TEMPLATE_VERSION_RETIRE_OPERATION,
  POST as templateVersionRetireRoute,
} from '@/app/api/v1/template-versions/[versionId]/retirement/route';
import {
  TEMPLATE_VERSION_PREVIEW_OPERATION,
  POST as templateVersionPreviewRoute,
} from '@/app/api/v1/template-versions/[versionId]/preview/route';
import {
  BRANCH_STATUS_CHANGE_OPERATION,
  BRANCH_STATUS_READ_OPERATION,
  GET as branchStatusReadRoute,
  POST as branchStatusChangeRoute,
} from '@/app/api/v1/organization/branches/[branchId]/status/route';
import {
  EXPORT_AUTHORIZE_OPERATION,
  POST as exportAuthorizeRoute,
} from '@/app/api/v1/exports/authorizations/route';
import {
  EXPORT_CATALOGUE_OPERATION,
  GET as exportCatalogueRoute,
} from '@/app/api/v1/exports/resources/route';
import { HEALTH_LIVE_OPERATION, GET as healthLiveRoute } from '@/app/api/v1/health/live/route';
import { HEALTH_READY_OPERATION, GET as healthReadyRoute } from '@/app/api/v1/health/ready/route';

// ---------------------------------------------------------------------------
// Fixtures. A distinct id space (d9…/e9…) from every other backend suite, so a
// concurrent fixture can never collide with one of these. All of it is ephemeral
// scaffolding removed by cleanBackendFixtures(); no business data is created,
// shipped or retained.
// ---------------------------------------------------------------------------

/** Tenant A administrator holding every permission the 19 routes declare. */
const U_RT_A = 'd9000000-0000-4000-8000-000000000001';
/** Tenant A administrator whose grant is narrowed to ONE branch. */
const U_RT_SCOPED = 'd9000000-0000-4000-8000-000000000002';
/** Tenant B administrator holding the same permissions, in the other tenant. */
const U_RT_B = 'd9000000-0000-4000-8000-00000000000b';

const ROLE_RT_A = 'd9100000-0000-4000-8000-000000000001';
const ROLE_RT_B = 'd9100000-0000-4000-8000-00000000000b';
const GRANT_RT_SCOPED = 'd9200000-0000-4000-8000-000000000002';

const SUBJECT_RT_A = 'fx_p15_rt_admin';
const SUBJECT_RT_SCOPED = 'fx_p15_rt_scoped';
const SUBJECT_RT_B = 'fx_p15_rt_admin_b';
const SUBJECT_UNPERMITTED = 'fx_p1_13_unpermitted';
const IDENTITY_PROVIDER = 'test_harness';

/** Document categories, one per tenant, identical apart from who owns them. */
const CATEGORY_RT_A = 'd9300000-0000-4000-8000-000000000001';
const CATEGORY_RT_B = 'd9300000-0000-4000-8000-00000000000b';
const CATEGORY_CODE_A = 'fx_p15_rt_cat';
const CATEGORY_CODE_B = 'fx_p15_rt_cat_b';

/** Tenant B organization, so a tenant-B branch exists to be refused. */
const COMPANY_B1 = 'd9400000-0000-4000-8000-00000000000b';
const BRANCH_B1 = 'd9500000-0000-4000-8000-00000000000b';

/** Two tenant-A branches: the scoped grant reaches the first and not the second. */
const BRANCH_RT_IN = 'd9500000-0000-4000-8000-000000000001';
const BRANCH_RT_OUT = 'd9500000-0000-4000-8000-000000000002';

const PERMISSIONS = [
  'org.settings.manage',
  'org.branch.read',
  'rpt.export',
  'shared.document.manage',
  'shared.notification.send',
];

const CONTENT_TYPE = 'application/pdf';
const BYTE_SIZE = 2048;
/** 64 lower-case hex characters — `ck_document_versions_sha256_len`. */
const SHA_HEX = 'cd'.repeat(32);
const TEMPLATE_BODY = 'Hello {{name}}, this is a P1-15 route-evidence body.';

let admin: Pool;
let runtime: Pool;
let storage: LocalStorageProvider;
let messages: LocalMessageProvider;

/** Unique per-run suffixes: template and branch codes are unique per tenant. */
let codeSeq = 0;
const nextTemplateCode = (): string => `fx_p15_rt_t${++codeSeq}`;

// ---------------------------------------------------------------------------
// The HTTP driver. Every operation below goes through this and nothing else.
// ---------------------------------------------------------------------------

type RouteFn = (
  request: Request,
  route: { params: Promise<Record<string, string>> }
) => Promise<Response>;

/**
 * Widens a Next.js route export to one call signature.
 *
 * The route handlers are declared with their own literal parameter shapes
 * (`{ params: Promise<{ templateId: string }> }`), which `strictFunctionTypes`
 * will not unify. The cast is confined to this one helper so the tests below
 * name the real exported function and nothing else.
 */
const asRoute = (handler: unknown): RouteFn => handler as RouteFn;

interface CallInput {
  readonly path: string;
  readonly method?: string;
  readonly params?: Record<string, string>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly ifMatch?: number | string;
}

interface CallResult<T> {
  readonly status: number;
  readonly body: T;
  readonly headers: Headers;
}

interface ProblemBody {
  readonly code?: string;
  readonly status?: number;
  readonly title?: string;
  readonly requiredPermissions?: readonly string[];
}

async function call<T>(handler: unknown, input: CallInput): Promise<CallResult<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  if (input.ifMatch !== undefined) {
    headers['if-match'] = typeof input.ifMatch === 'number' ? `"${input.ifMatch}"` : input.ifMatch;
  }
  const init: RequestInit = { method: input.method ?? 'POST', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const request = new Request(`http://localhost/api/v1${input.path}`, init);
  const response = await asRoute(handler)(request, {
    params: Promise.resolve(input.params ?? {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text === '' ? null : JSON.parse(text)) as T,
    headers: response.headers,
  };
}

function authenticateAs(providerSubject: string, tenantId: string = TENANT_A): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject,
      tenantId,
    })
  );
}

const asAdminA = (): void => authenticateAs(SUBJECT_RT_A);
const asScopedA = (): void => authenticateAs(SUBJECT_RT_SCOPED);
const asAdminB = (): void => authenticateAs(SUBJECT_RT_B, TENANT_B);
const asUnpermitted = (): void => authenticateAs(SUBJECT_UNPERMITTED);

// ---------------------------------------------------------------------------
// Readers. `admin` is used here and only here.
// ---------------------------------------------------------------------------

const auditCount = (action: string, entityId: string): Promise<number> =>
  countRows(admin, 'iam.audit_records', 'action = $1 AND entity_id = $2', [action, entityId]);

/**
 * Counts outbox rows by `event_key`, not by `aggregate_id`.
 *
 * Several P1-15 events share an aggregate — linking and withdrawing both name
 * the document — so counting by aggregate would let "an event was published"
 * pass on somebody else's event. The key is the identity the publisher
 * deduplicates on, so it is the one worth asserting.
 */
const outboxCount = (tenantId: string, eventKey: string): Promise<number> =>
  countRows(admin, 'shared.event_outbox', 'tenant_id = $1 AND event_key = $2', [
    tenantId,
    eventKey,
  ]);

const documentCount = (tenantId: string, documentId: string): Promise<number> =>
  countRows(admin, 'shared.documents', 'tenant_id = $1 AND id = $2', [tenantId, documentId]);

async function scalar<T>(sql: string, values: readonly unknown[]): Promise<T | undefined> {
  const result = await admin.query<Record<string, T>>(sql, values as unknown[]);
  const row = result.rows[0];
  return row ? Object.values(row)[0] : undefined;
}

const versionStatus = (versionId: string): Promise<string | undefined> =>
  scalar<string>('SELECT status FROM shared.document_versions WHERE id = $1', [versionId]);

/** `deleted_at` is the withdrawal stamp; the row itself is retained. */
const linkWithdrawnAt = (linkId: string): Promise<string | null | undefined> =>
  scalar<string | null>('SELECT deleted_at FROM shared.document_links WHERE id = $1', [linkId]);

const branchStatus = (branchId: string): Promise<string | undefined> =>
  scalar<string>('SELECT status FROM org.branches WHERE id = $1', [branchId]);

// ---------------------------------------------------------------------------
// Route-driven builders. Every precondition a test needs is produced by calling
// the real route, so a precondition that silently stopped working fails the test
// rather than hiding behind an admin INSERT.
// ---------------------------------------------------------------------------

interface UploadBody {
  readonly documentId: string;
  readonly uploadToken: string;
  readonly uploadUrl: string;
  readonly method: string;
  readonly contentType: string;
  readonly maxBytes: number;
  readonly expiresAt: string;
}

const uploadRequestBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  categoryCode: CATEGORY_CODE_A,
  entityType: 'org.legal_companies',
  entityId: COMPANY_A1,
  fileName: 'fx-p15-route.pdf',
  contentType: CONTENT_TYPE,
  byteSize: BYTE_SIZE,
  ...over,
});

async function authorizeUpload(over: Record<string, unknown> = {}): Promise<UploadBody> {
  const response = await call<UploadBody>(uploadAuthorizeRoute, {
    path: '/attachments/upload-authorizations',
    body: uploadRequestBody(over),
    idempotencyKey: randomUUID(),
  });
  expect(response.status).toBe(201);
  return response.body;
}

interface RegisteredBody {
  readonly documentId: string;
  readonly versionId: string;
  readonly versionNumber: number;
}

async function registerVersion(authorization: UploadBody): Promise<RegisteredBody> {
  const response = await call<RegisteredBody>(versionRegisterRoute, {
    path: '/attachments/versions',
    body: {
      uploadToken: authorization.uploadToken,
      documentId: authorization.documentId,
      checksumSha256: SHA_HEX,
      byteSize: BYTE_SIZE,
    },
    idempotencyKey: randomUUID(),
  });
  expect(response.status).toBe(201);
  return response.body;
}

/**
 * Marks a registered version accepted, as ADMIN.
 *
 * A precondition, never evidence: `guard_document_version_transition` accepts a
 * version only against a `clean` row in `shared.file_scan_results`, and NO
 * application role may write that table. No scanner exists, none is implemented,
 * and no code path in this repository produces a verdict — the fixture below is
 * the test harness standing in for a control that has not been chosen yet.
 */
async function acceptVersion(versionId: string, tenantId: string = TENANT_A): Promise<void> {
  await admin.query(
    `INSERT INTO shared.file_scan_results
       (id, tenant_id, version_id, scan_status, scanner_code, created_by)
     VALUES ($1, $2, $3, 'clean', 'fx_p15_route_fixture_scanner', $4)`,
    [randomUUID(), tenantId, versionId, tenantId === TENANT_A ? U_RT_A : U_RT_B]
  );
  // Two statements, not one, since P1-OD-025: `pending -> accepted` is refused
  // outright, because finalized evidence must have passed through scanning.
  await admin.query(`UPDATE shared.document_versions SET status = 'scanning' WHERE id = $1`, [
    versionId,
  ]);
  await admin.query(`UPDATE shared.document_versions SET status = 'accepted' WHERE id = $1`, [
    versionId,
  ]);
}

async function createLink(documentId: string): Promise<string> {
  const response = await call<{ linkId: string }>(linkCreateRoute, {
    path: `/attachments/documents/${documentId}/links`,
    params: { documentId },
    body: {
      entityType: 'org.legal_companies',
      entityId: COMPANY_A1,
      linkPurpose: 'attachment',
    },
    idempotencyKey: randomUUID(),
  });
  expect(response.status).toBe(201);
  return response.body.linkId;
}

async function createTemplate(over: Record<string, unknown> = {}): Promise<string> {
  const response = await call<{ templateId: string }>(templateCreateRoute, {
    path: '/message-templates',
    body: {
      templateCode: nextTemplateCode(),
      name: 'P1-15 route evidence template',
      channel: 'email',
      purpose: 'transactional',
      localeCode: 'en',
      ...over,
    },
    idempotencyKey: randomUUID(),
  });
  expect(response.status).toBe(201);
  return response.body.templateId;
}

interface VersionBody {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly status: string;
  readonly recordVersion: number;
  readonly variables: readonly string[];
}

async function createVersion(templateId: string, body = TEMPLATE_BODY): Promise<VersionBody> {
  const response = await call<VersionBody>(templateVersionCreateRoute, {
    path: `/message-templates/${templateId}/versions`,
    params: { templateId },
    body: { subject: 'P1-15 route subject', body },
    idempotencyKey: randomUUID(),
  });
  expect(response.status).toBe(201);
  return response.body;
}

async function approveVersion(versionId: string, expectedVersion = 1): Promise<void> {
  const response = await call<{ status: string }>(templateVersionApproveRoute, {
    path: `/template-versions/${versionId}/approval`,
    params: { versionId },
    ifMatch: expectedVersion,
  });
  expect(response.status).toBe(200);
  expect(response.body.status).toBe('approved');
}

/** Creates a template with one approved version, through the routes. */
async function approvedTemplate(): Promise<{ templateId: string; versionId: string }> {
  const templateId = await createTemplate();
  const version = await createVersion(templateId);
  await approveVersion(version.versionId, version.recordVersion);
  return { templateId, versionId: version.versionId };
}

const enqueueBody = (versionId: string, over: Record<string, unknown> = {}) => ({
  channel: 'email',
  templateVersionId: versionId,
  locale: 'en',
  dedupeKey: `fx-p15-rt-${randomUUID()}`,
  recipientRef: randomUUID(),
  variables: { name: 'Fixture Recipient' },
  consentEvaluation: {
    granted: true,
    consentRecordId: 'fx-p15-rt-consent',
    evaluatedAt: new Date().toISOString(),
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
     VALUES ($1, $4, $7, $8,  'fx-p15-rt-admin@example.test',  'P1-15 Route Admin A', 'active', $6),
            ($2, $4, $7, $9,  'fx-p15-rt-scoped@example.test', 'P1-15 Route Scoped',  'active', $6),
            ($3, $5, $7, $10, 'fx-p15-rt-admin-b@example.test','P1-15 Route Admin B', 'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      U_RT_A,
      U_RT_SCOPED,
      U_RT_B,
      TENANT_A,
      TENANT_B,
      USER_A,
      IDENTITY_PROVIDER,
      SUBJECT_RT_A,
      SUBJECT_RT_SCOPED,
      SUBJECT_RT_B,
    ]
  );

  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $3, 'fx_p15_rt_admin', 'P1-15 route administration', $5),
            ($2, $4, 'fx_p15_rt_admin', 'P1-15 route administration', $5)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE_RT_A, ROLE_RT_B, TENANT_A, TENANT_B, USER_A]
  );

  for (const [roleId, tenantId] of [
    [ROLE_RT_A, TENANT_A],
    [ROLE_RT_B, TENANT_B],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = ANY($4::text[])
       ON CONFLICT DO NOTHING`,
      [tenantId, roleId, USER_A, PERMISSIONS]
    );
  }

  // Grants carry no natural key, so a re-seed would otherwise stack duplicates.
  await admin.query('DELETE FROM iam.role_grants WHERE user_id = ANY($1::uuid[])', [
    [U_RT_A, U_RT_SCOPED, U_RT_B],
  ]);
  await admin.query(
    `INSERT INTO iam.role_grants
       (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES ($1, $2, $3, 'unrestricted', 'active', $6, $6),
            ($4, $5, $7, 'unrestricted', 'active', $6, $6)`,
    [TENANT_A, U_RT_A, ROLE_RT_A, TENANT_B, U_RT_B, USER_A, ROLE_RT_B]
  );

  // Tenant B organization: a real company and branch, so "invisible from tenant
  // A" is a statement about rows that exist.
  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, $2, 'fx_p15_rt_cb', 'P1-15 Route Company B', 'USD', $3)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY_B1, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches
       (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1, $5, $6, 'fx_p15_rt_bb', 'P1-15 Route Branch B', 'UTC', $7),
            ($2, $3, $4, 'fx_p15_rt_bin',  'P1-15 Route Branch In',  'UTC', $7),
            ($8, $3, $4, 'fx_p15_rt_bout', 'P1-15 Route Branch Out', 'UTC', $7)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH_B1, BRANCH_RT_IN, TENANT_A, COMPANY_A1, TENANT_B, COMPANY_B1, USER_A, BRANCH_RT_OUT]
  );

  // The narrowed grant. The "scoped grant needs a scope" trigger is DEFERRABLE
  // INITIALLY DEFERRED, so the grant and its scopes land in one transaction.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO iam.role_grants
         (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1, $2, $3, $4, 'scoped', 'active', $5, $5)`,
      [GRANT_RT_SCOPED, TENANT_A, U_RT_SCOPED, ROLE_RT_A, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
       VALUES ($1, $2, 'company', $3, $4)`,
      [TENANT_A, GRANT_RT_SCOPED, COMPANY_A1, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes
         (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1, $2, 'branch', $3, $4, $5)`,
      [TENANT_A, GRANT_RT_SCOPED, COMPANY_A1, BRANCH_RT_IN, USER_A]
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  for (const [id, tenantId, code] of [
    [CATEGORY_RT_A, TENANT_A, CATEGORY_CODE_A],
    [CATEGORY_RT_B, TENANT_B, CATEGORY_CODE_B],
  ] as const) {
    await admin.query(
      `INSERT INTO shared.document_categories
         (id, scope, tenant_id, category_code, name, allowed_content_types, max_size_bytes,
          default_classification, default_retention_class, created_by)
       VALUES ($1, 'tenant', $2, $3, 'P1-15 route fixture category',
               ARRAY['application/pdf']::text[], 1048576, 'internal', 'operational', $4)
       ON CONFLICT (id) DO NOTHING`,
      [id, tenantId, code, USER_A]
    );
  }
}

// ---------------------------------------------------------------------------

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  process.env.STORAGE_PROVIDER = 'local_fake';
  process.env.NOTIFICATION_PROVIDER = 'local_fake';
  __resetBackendConfigForTests();

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await seedSuiteFixtures();

  // The unpermitted subject is a shared-harness account. Pinning it to the id
  // the helper exports means "403" below is about a real account holding a role
  // with no permission mappings, not about a subject that resolves to nothing.
  const unpermitted = await scalar<string>(
    'SELECT id FROM iam.user_accounts WHERE provider_subject = $1',
    [SUBJECT_UNPERMITTED]
  );
  if (unpermitted !== USER_UNPERMITTED) {
    throw new Error(`Unpermitted fixture subject resolved to ${String(unpermitted)}`);
  }

  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);

  storage = new LocalStorageProvider({ bucket: 'fx-p15-route-bucket' });
  messages = new LocalMessageProvider();
  setStorageProvider(storage);
  setMessageProvider(messages);
}, 120_000);

afterEach(() => {
  __resetAuthenticatorForTests();
});

afterAll(async () => {
  __resetStorageProviderForTests();
  __resetMessageProviderForTests();
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

// ===========================================================================
// The pipeline fails closed before any operation body runs
// ===========================================================================

describe('the authenticated P1-15 surface with no session at all', () => {
  it('answers 401 ERR-IAM-002 and creates nothing', async () => {
    __resetAuthenticatorForTests();
    const before = await countRows(admin, 'shared.documents', 'tenant_id = $1', [TENANT_A]);

    const response = await call<ProblemBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body: uploadRequestBody(),
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('ERR-IAM-002');
    expect(response.headers.get('content-type')).toBe('application/problem+json');
    expect(await countRows(admin, 'shared.documents', 'tenant_id = $1', [TENANT_A])).toBe(before);
  });

  it('denies a session whose claimed tenant does not contain the account', async () => {
    // The account lives in tenant A; the claims name tenant B. The lookup finds
    // nothing and the request is denied rather than silently corrected.
    authenticateAs(SUBJECT_RT_A, TENANT_B);

    const response = await call<ProblemBody>(exportCatalogueRoute, {
      path: '/exports/resources',
      method: 'GET',
    });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('ERR-IAM-002');
  });
});

// ===========================================================================
// shared.attachment-upload-authorize
// ===========================================================================

describe('shared.attachment-upload-authorize', () => {
  it('answers 201 with a verifiable signed upload URL and audits the authorization', async () => {
    asAdminA();
    const key = randomUUID();

    const response = await call<UploadBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body: uploadRequestBody(),
      idempotencyKey: key,
    });

    expect(response.status).toBe(201);
    expect(response.body.method).toBe('PUT');
    expect(response.body.contentType).toBe(CONTENT_TYPE);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('x-correlation-id')).toMatch(/^[0-9a-f-]{36}$/);

    // The provider that signed it can verify it — "a URL was issued" becomes a
    // checked property rather than a claim about a string.
    expect(storage.verify(response.body.uploadUrl).valid).toBe(true);
    expect(response.body.uploadUrl).toContain('.invalid');

    expect(await documentCount(TENANT_A, response.body.documentId)).toBe(1);
    expect(await auditCount('shared.document.upload_authorized', response.body.documentId)).toBe(1);
  });

  it('never puts the storage key in the response body', async () => {
    asAdminA();
    const authorization = await authorizeUpload();
    const storageKey = await scalar<string>(
      `SELECT storage_key FROM shared.document_versions WHERE document_id = $1`,
      [authorization.documentId]
    );
    // No version is registered yet, so there is nothing to compare against — the
    // assertion that matters is that the *response* carries no key-shaped field.
    expect(storageKey).toBeUndefined();
    expect(Object.keys(authorization)).not.toContain('storageKey');
  });

  it('refuses a caller without shared.document.manage with 403 and no row', async () => {
    asUnpermitted();
    const before = await countRows(admin, 'shared.documents', 'tenant_id = $1', [TENANT_A]);

    const response = await call<ProblemBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body: uploadRequestBody(),
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ERR-IAM-001');
    expect(response.body.requiredPermissions).toEqual(
      ATTACHMENT_UPLOAD_AUTHORIZE_OPERATION.permissions
    );
    expect(await countRows(admin, 'shared.documents', 'tenant_id = $1', [TENANT_A])).toBe(before);
  });

  it("cannot use another tenant's document category", async () => {
    asAdminA();

    const response = await call<ProblemBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body: uploadRequestBody({ categoryCode: CATEGORY_CODE_B }),
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
  });

  it('refuses a content type the category does not allow', async () => {
    asAdminA();

    const response = await call<ProblemBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body: uploadRequestBody({ contentType: 'application/x-msdownload' }),
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ERR-VAL-001');
  });

  it('replays one document for a repeated Idempotency-Key', async () => {
    asAdminA();
    const key = randomUUID();
    const body = uploadRequestBody();

    const first = await call<UploadBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body,
      idempotencyKey: key,
    });
    const second = await call<UploadBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body,
      idempotencyKey: key,
    });

    expect(first.status).toBe(201);
    expect(second.body.documentId).toBe(first.body.documentId);
    expect(await documentCount(TENANT_A, first.body.documentId)).toBe(1);
    expect(await auditCount('shared.document.upload_authorized', first.body.documentId)).toBe(1);
  });

  it('requires an Idempotency-Key, because the command hands out a capability', async () => {
    asAdminA();
    const before = await countRows(admin, 'shared.documents', 'tenant_id = $1', [TENANT_A]);

    const response = await call<ProblemBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body: uploadRequestBody(),
    });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe('ERR-INT-002');
    expect(await countRows(admin, 'shared.documents', 'tenant_id = $1', [TENANT_A])).toBe(before);
  });
});

// ===========================================================================
// shared.attachment-version-register
// ===========================================================================

describe('shared.attachment-version-register', () => {
  it('answers 201, writes a pending version, audits it and publishes one event', async () => {
    asAdminA();
    const authorization = await authorizeUpload();

    const response = await call<RegisteredBody>(versionRegisterRoute, {
      path: '/attachments/versions',
      body: {
        uploadToken: authorization.uploadToken,
        documentId: authorization.documentId,
        checksumSha256: SHA_HEX,
        byteSize: BYTE_SIZE,
      },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(201);
    expect(response.body.documentId).toBe(authorization.documentId);
    expect(response.body.versionNumber).toBe(1);
    expect(await versionStatus(response.body.versionId)).toBe('pending');
    expect(await auditCount('shared.document.version_registered', response.body.versionId)).toBe(1);
    expect(await outboxCount(TENANT_A, `document.version:${response.body.versionId}`)).toBe(1);
  });

  it('refuses a caller without the permission with 403', async () => {
    asAdminA();
    const authorization = await authorizeUpload();
    asUnpermitted();

    const response = await call<ProblemBody>(versionRegisterRoute, {
      path: '/attachments/versions',
      body: {
        uploadToken: authorization.uploadToken,
        documentId: authorization.documentId,
        checksumSha256: SHA_HEX,
        byteSize: BYTE_SIZE,
      },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ERR-IAM-001');
    expect(response.body.requiredPermissions).toEqual(
      ATTACHMENT_VERSION_REGISTER_OPERATION.permissions
    );
  });

  it('refuses a genuine tenant-B upload token presented by a tenant-A caller', async () => {
    // The token is real: tenant B's administrator obtained it from this very
    // route. Presenting it in tenant A must find no document.
    asAdminB();
    const foreign = await call<UploadBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body: uploadRequestBody({ categoryCode: CATEGORY_CODE_B, entityId: COMPANY_B1 }),
      idempotencyKey: randomUUID(),
    });
    expect(foreign.status).toBe(201);

    asAdminA();
    const response = await call<ProblemBody>(versionRegisterRoute, {
      path: '/attachments/versions',
      body: {
        uploadToken: foreign.body.uploadToken,
        documentId: null,
        checksumSha256: SHA_HEX,
        byteSize: BYTE_SIZE,
      },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
    // Nothing landed on the tenant-B document either.
    expect(
      await countRows(admin, 'shared.document_versions', 'document_id = $1', [
        foreign.body.documentId,
      ])
    ).toBe(0);
  });

  it('refuses a documentId that disagrees with the token', async () => {
    asAdminA();
    const first = await authorizeUpload();
    const second = await authorizeUpload();

    const response = await call<ProblemBody>(versionRegisterRoute, {
      path: '/attachments/versions',
      body: {
        uploadToken: first.uploadToken,
        documentId: second.documentId,
        checksumSha256: SHA_HEX,
        byteSize: BYTE_SIZE,
      },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ERR-VAL-001');
  });

  it('replays one version for a repeated Idempotency-Key', async () => {
    asAdminA();
    const authorization = await authorizeUpload();
    const key = randomUUID();
    const body = {
      uploadToken: authorization.uploadToken,
      documentId: authorization.documentId,
      checksumSha256: SHA_HEX,
      byteSize: BYTE_SIZE,
    };

    const first = await call<RegisteredBody>(versionRegisterRoute, {
      path: '/attachments/versions',
      body,
      idempotencyKey: key,
    });
    const second = await call<RegisteredBody>(versionRegisterRoute, {
      path: '/attachments/versions',
      body,
      idempotencyKey: key,
    });

    expect(second.body.versionId).toBe(first.body.versionId);
    expect(
      await countRows(admin, 'shared.document_versions', 'document_id = $1', [
        authorization.documentId,
      ])
    ).toBe(1);
    expect(await outboxCount(TENANT_A, `document.version:${first.body.versionId}`)).toBe(1);
  });
});

// ===========================================================================
// shared.attachment-version-reject
// ===========================================================================

describe('shared.attachment-version-reject', () => {
  it('moves a pending version to rejected and audits the reason', async () => {
    asAdminA();
    const registered = await registerVersion(await authorizeUpload());

    const response = await call<{ versionId: string; status: string }>(versionRejectRoute, {
      path: `/attachments/versions/${registered.versionId}/rejection`,
      params: { versionId: registered.versionId },
      body: { reason: 'Route-evidence rejection' },
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('rejected');
    expect(await versionStatus(registered.versionId)).toBe('rejected');
    expect(await auditCount('shared.document.version_rejected', registered.versionId)).toBe(1);
  });

  it('refuses a caller without the permission with 403', async () => {
    asAdminA();
    const registered = await registerVersion(await authorizeUpload());
    asUnpermitted();

    const response = await call<ProblemBody>(versionRejectRoute, {
      path: `/attachments/versions/${registered.versionId}/rejection`,
      params: { versionId: registered.versionId },
      body: { reason: 'not mine to reject' },
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(
      ATTACHMENT_VERSION_REJECT_OPERATION.permissions
    );
    expect(await versionStatus(registered.versionId)).toBe('pending');
  });

  it("cannot reject another tenant's version", async () => {
    asAdminB();
    const foreignAuthorization = await call<UploadBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body: uploadRequestBody({ categoryCode: CATEGORY_CODE_B, entityId: COMPANY_B1 }),
      idempotencyKey: randomUUID(),
    });
    const foreign = await call<RegisteredBody>(versionRegisterRoute, {
      path: '/attachments/versions',
      body: {
        uploadToken: foreignAuthorization.body.uploadToken,
        documentId: foreignAuthorization.body.documentId,
        checksumSha256: SHA_HEX,
        byteSize: BYTE_SIZE,
      },
      idempotencyKey: randomUUID(),
    });
    expect(foreign.status).toBe(201);

    asAdminA();
    const response = await call<ProblemBody>(versionRejectRoute, {
      path: `/attachments/versions/${foreign.body.versionId}/rejection`,
      params: { versionId: foreign.body.versionId },
      body: { reason: 'reaching across a tenant boundary' },
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
    expect(await versionStatus(foreign.body.versionId)).toBe('pending');
  });

  it('refuses a version that is not pending — rejection is terminal', async () => {
    asAdminA();
    const registered = await registerVersion(await authorizeUpload());
    await call(versionRejectRoute, {
      path: `/attachments/versions/${registered.versionId}/rejection`,
      params: { versionId: registered.versionId },
      body: { reason: 'first rejection' },
    });

    const response = await call<ProblemBody>(versionRejectRoute, {
      path: `/attachments/versions/${registered.versionId}/rejection`,
      params: { versionId: registered.versionId },
      body: { reason: 'second rejection' },
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-TRN-001');
  });
});

// ===========================================================================
// shared.attachment-download-authorize
// ===========================================================================

describe('shared.attachment-download-authorize', () => {
  it('signs an accepted version and audits the authorization', async () => {
    asAdminA();
    const authorization = await authorizeUpload();
    const registered = await registerVersion(authorization);
    await acceptVersion(registered.versionId);

    const response = await call<{ url: string; expiresAt: string }>(downloadAuthorizeRoute, {
      path: `/attachments/documents/${authorization.documentId}/download-authorizations`,
      params: { documentId: authorization.documentId },
      body: { versionId: registered.versionId },
    });

    expect(response.status).toBe(200);
    expect(storage.verify(response.body.url).valid).toBe(true);
    expect(response.body.url).toContain('.invalid');
    expect(new Date(response.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    // The audit record names the version that was signed, not the document: the
    // capability is over one immutable object.
    expect(await auditCount('shared.document.download_authorized', registered.versionId)).toBe(1);
  });

  it('refuses a pending version with ERR-DOC-001 rather than signing it', async () => {
    asAdminA();
    const authorization = await authorizeUpload();
    const registered = await registerVersion(authorization);

    const response = await call<ProblemBody>(downloadAuthorizeRoute, {
      path: `/attachments/documents/${authorization.documentId}/download-authorizations`,
      params: { documentId: authorization.documentId },
      body: { versionId: registered.versionId },
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-DOC-001');
  });

  it('refuses a caller without the permission with 403', async () => {
    asAdminA();
    const authorization = await authorizeUpload();
    asUnpermitted();

    const response = await call<ProblemBody>(downloadAuthorizeRoute, {
      path: `/attachments/documents/${authorization.documentId}/download-authorizations`,
      params: { documentId: authorization.documentId },
      body: { versionId: null },
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(
      ATTACHMENT_DOWNLOAD_AUTHORIZE_OPERATION.permissions
    );
  });

  it("cannot sign another tenant's document", async () => {
    asAdminB();
    const foreign = await call<UploadBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body: uploadRequestBody({ categoryCode: CATEGORY_CODE_B, entityId: COMPANY_B1 }),
      idempotencyKey: randomUUID(),
    });

    asAdminA();
    const response = await call<ProblemBody>(downloadAuthorizeRoute, {
      path: `/attachments/documents/${foreign.body.documentId}/download-authorizations`,
      params: { documentId: foreign.body.documentId },
      body: { versionId: null },
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
  });
});

// ===========================================================================
// shared.attachment-link-create / shared.attachment-link-withdraw
// ===========================================================================

describe('shared.attachment-link-create', () => {
  it('answers 201, audits the link and publishes one event', async () => {
    asAdminA();
    const authorization = await authorizeUpload();

    const response = await call<{ linkId: string }>(linkCreateRoute, {
      path: `/attachments/documents/${authorization.documentId}/links`,
      params: { documentId: authorization.documentId },
      body: {
        entityType: 'org.legal_companies',
        entityId: COMPANY_A1,
        linkPurpose: 'attachment',
      },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(201);
    expect(await auditCount('shared.document.linked', response.body.linkId)).toBe(1);
    expect(await outboxCount(TENANT_A, `document.link:${response.body.linkId}:linked`)).toBe(1);
  });

  it('refuses a caller without the permission with 403', async () => {
    asAdminA();
    const authorization = await authorizeUpload();
    asUnpermitted();

    const response = await call<ProblemBody>(linkCreateRoute, {
      path: `/attachments/documents/${authorization.documentId}/links`,
      params: { documentId: authorization.documentId },
      body: {
        entityType: 'org.legal_companies',
        entityId: COMPANY_A1,
        linkPurpose: 'attachment',
      },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(ATTACHMENT_LINK_CREATE_OPERATION.permissions);
  });

  it('refuses an entity type that is not on the linkable registry', async () => {
    asAdminA();
    const authorization = await authorizeUpload();

    const response = await call<ProblemBody>(linkCreateRoute, {
      path: `/attachments/documents/${authorization.documentId}/links`,
      params: { documentId: authorization.documentId },
      body: {
        entityType: 'iam.user_accounts',
        entityId: USER_A,
        linkPurpose: 'attachment',
      },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ERR-VAL-001');
  });

  it("cannot link another tenant's document", async () => {
    asAdminB();
    const foreign = await call<UploadBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body: uploadRequestBody({ categoryCode: CATEGORY_CODE_B, entityId: COMPANY_B1 }),
      idempotencyKey: randomUUID(),
    });

    asAdminA();
    const response = await call<ProblemBody>(linkCreateRoute, {
      path: `/attachments/documents/${foreign.body.documentId}/links`,
      params: { documentId: foreign.body.documentId },
      body: {
        entityType: 'org.legal_companies',
        entityId: COMPANY_A1,
        linkPurpose: 'attachment',
      },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
  });

  it('replays one link for a repeated Idempotency-Key', async () => {
    asAdminA();
    const authorization = await authorizeUpload();
    const key = randomUUID();
    const body = {
      entityType: 'org.legal_companies',
      entityId: COMPANY_A1,
      linkPurpose: 'evidence',
    };

    const first = await call<{ linkId: string }>(linkCreateRoute, {
      path: `/attachments/documents/${authorization.documentId}/links`,
      params: { documentId: authorization.documentId },
      body,
      idempotencyKey: key,
    });
    const second = await call<{ linkId: string }>(linkCreateRoute, {
      path: `/attachments/documents/${authorization.documentId}/links`,
      params: { documentId: authorization.documentId },
      body,
      idempotencyKey: key,
    });

    expect(second.body.linkId).toBe(first.body.linkId);
    expect(
      await countRows(admin, 'shared.document_links', 'document_id = $1 AND link_purpose = $2', [
        authorization.documentId,
        'evidence',
      ])
    ).toBe(1);
  });
});

describe('shared.attachment-link-withdraw', () => {
  it('withdraws the link, keeps the row, audits it and publishes one event', async () => {
    asAdminA();
    const authorization = await authorizeUpload();
    const linkId = await createLink(authorization.documentId);

    const response = await call<{ linkId: string }>(linkWithdrawRoute, {
      path: `/attachments/links/${linkId}`,
      method: 'DELETE',
      params: { linkId },
    });

    expect(response.status).toBe(200);
    expect(response.body.linkId).toBe(linkId);
    // The row survives: the attachment fact is evidence, not a mistake to erase.
    expect(await countRows(admin, 'shared.document_links', 'id = $1', [linkId])).toBe(1);
    expect(await linkWithdrawnAt(linkId)).not.toBeNull();
    expect(await auditCount('shared.document.unlinked', linkId)).toBe(1);
    expect(await outboxCount(TENANT_A, `document.link:${linkId}:unlinked`)).toBe(1);
  });

  it('refuses a caller without the permission with 403 and leaves the link live', async () => {
    asAdminA();
    const authorization = await authorizeUpload();
    const linkId = await createLink(authorization.documentId);
    asUnpermitted();

    const response = await call<ProblemBody>(linkWithdrawRoute, {
      path: `/attachments/links/${linkId}`,
      method: 'DELETE',
      params: { linkId },
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(
      ATTACHMENT_LINK_WITHDRAW_OPERATION.permissions
    );
    expect(await linkWithdrawnAt(linkId)).toBeNull();
  });

  it("cannot withdraw another tenant's link", async () => {
    asAdminB();
    const foreign = await call<UploadBody>(uploadAuthorizeRoute, {
      path: '/attachments/upload-authorizations',
      body: uploadRequestBody({ categoryCode: CATEGORY_CODE_B, entityId: COMPANY_B1 }),
      idempotencyKey: randomUUID(),
    });
    const foreignLink = await call<{ linkId: string }>(linkCreateRoute, {
      path: `/attachments/documents/${foreign.body.documentId}/links`,
      params: { documentId: foreign.body.documentId },
      body: {
        entityType: 'org.legal_companies',
        entityId: COMPANY_B1,
        linkPurpose: 'attachment',
      },
      idempotencyKey: randomUUID(),
    });
    expect(foreignLink.status).toBe(201);

    asAdminA();
    const response = await call<ProblemBody>(linkWithdrawRoute, {
      path: `/attachments/links/${foreignLink.body.linkId}`,
      method: 'DELETE',
      params: { linkId: foreignLink.body.linkId },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(['ERR-RES-001', 'ERR-IAM-001']).toContain(response.body.code);
    expect(await linkWithdrawnAt(foreignLink.body.linkId)).toBeNull();
  });
});

// ===========================================================================
// shared.notification-enqueue
// ===========================================================================

describe('shared.notification-enqueue', () => {
  it('answers 202, audits, publishes one event and contacts no provider', async () => {
    asAdminA();
    const { versionId } = await approvedTemplate();
    const before = messages.callCount;

    const response = await call<{ messageId: string; deduplicated: boolean }>(
      notificationEnqueueRoute,
      {
        path: '/notifications',
        body: enqueueBody(versionId),
        idempotencyKey: randomUUID(),
      }
    );

    expect(response.status).toBe(202);
    expect(response.body.deduplicated).toBe(false);
    expect(await auditCount('shared.notification.enqueued', response.body.messageId)).toBe(1);
    expect(await outboxCount(TENANT_A, `message.enqueued:${response.body.messageId}`)).toBe(1);
    // Enqueue must not reach a provider inside the business transaction.
    expect(messages.callCount).toBe(before);
  });

  it('never returns the rendered content or the recipient address', async () => {
    asAdminA();
    const { versionId } = await approvedTemplate();

    const response = await call<Record<string, unknown>>(notificationEnqueueRoute, {
      path: '/notifications',
      body: enqueueBody(versionId),
      idempotencyKey: randomUUID(),
    });

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('Fixture Recipient');
    expect(serialized).not.toContain('Hello');
    expect(Object.keys(response.body).sort()).toEqual(['deduplicated', 'messageId']);
  });

  it('refuses a caller without shared.notification.send with 403', async () => {
    asAdminA();
    const { versionId } = await approvedTemplate();
    asUnpermitted();

    const response = await call<ProblemBody>(notificationEnqueueRoute, {
      path: '/notifications',
      body: enqueueBody(versionId),
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(NOTIFICATION_ENQUEUE_OPERATION.permissions);
  });

  it("cannot send from another tenant's template version", async () => {
    asAdminB();
    const foreignTemplateId = await createTemplate();
    const foreignVersion = await createVersion(foreignTemplateId);
    await approveVersion(foreignVersion.versionId, foreignVersion.recordVersion);

    asAdminA();
    const response = await call<ProblemBody>(notificationEnqueueRoute, {
      path: '/notifications',
      body: enqueueBody(foreignVersion.versionId),
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
  });

  it('refuses an unsupported channel without changing the frozen interface', async () => {
    asAdminA();
    const { versionId } = await approvedTemplate();

    const response = await call<ProblemBody>(notificationEnqueueRoute, {
      path: '/notifications',
      body: enqueueBody(versionId, { channel: 'sms' }),
      idempotencyKey: randomUUID(),
    });

    // `sms` is in the frozen TypeScript union and absent from the database
    // CHECK. The refusal is stable and states nothing about a provider.
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ERR-VAL-001');
  });

  it('refuses a request whose consent was not granted', async () => {
    asAdminA();
    const { versionId } = await approvedTemplate();

    const response = await call<ProblemBody>(notificationEnqueueRoute, {
      path: '/notifications',
      body: enqueueBody(versionId, {
        consentEvaluation: {
          granted: false,
          consentRecordId: null,
          evaluatedAt: new Date().toISOString(),
        },
      }),
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-NTF-001');
  });

  it('deduplicates on the dedupe key rather than enqueuing twice', async () => {
    asAdminA();
    const { versionId } = await approvedTemplate();
    const body = enqueueBody(versionId);

    const first = await call<{ messageId: string; deduplicated: boolean }>(
      notificationEnqueueRoute,
      { path: '/notifications', body, idempotencyKey: randomUUID() }
    );
    const second = await call<{ messageId: string; deduplicated: boolean }>(
      notificationEnqueueRoute,
      { path: '/notifications', body, idempotencyKey: randomUUID() }
    );

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.body.deduplicated).toBe(true);
    expect(second.body.messageId).toBe(first.body.messageId);
    expect(await outboxCount(TENANT_A, `message.enqueued:${first.body.messageId}`)).toBe(1);
  });
});

// ===========================================================================
// Template administration
// ===========================================================================

describe('shared.template-create', () => {
  it('answers 201 and audits the creation', async () => {
    asAdminA();
    const code = nextTemplateCode();

    const response = await call<{ templateId: string }>(templateCreateRoute, {
      path: '/message-templates',
      body: {
        templateCode: code,
        name: 'P1-15 route template',
        channel: 'email',
        purpose: 'transactional',
        localeCode: 'en',
      },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(201);
    expect(await auditCount('shared.template.created', response.body.templateId)).toBe(1);
    expect(
      await countRows(admin, 'shared.message_templates', 'id = $1 AND tenant_id = $2', [
        response.body.templateId,
        TENANT_A,
      ])
    ).toBe(1);
  });

  it('refuses a caller without org.settings.manage with 403', async () => {
    asUnpermitted();

    const response = await call<ProblemBody>(templateCreateRoute, {
      path: '/message-templates',
      body: {
        templateCode: nextTemplateCode(),
        name: 'refused',
        channel: 'email',
        purpose: 'transactional',
        localeCode: 'en',
      },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(TEMPLATE_CREATE_OPERATION.permissions);
  });

  it('lets both tenants own the same template code without colliding', async () => {
    const shared = nextTemplateCode();

    asAdminA();
    const a = await createTemplate({ templateCode: shared });
    asAdminB();
    const b = await createTemplate({ templateCode: shared });

    expect(a).not.toBe(b);
    expect(await countRows(admin, 'shared.message_templates', 'template_code = $1', [shared])).toBe(
      2
    );
  });

  it('refuses a duplicate identity inside one tenant', async () => {
    asAdminA();
    const code = nextTemplateCode();
    await createTemplate({ templateCode: code });

    const response = await call<ProblemBody>(templateCreateRoute, {
      path: '/message-templates',
      body: {
        templateCode: code,
        name: 'duplicate',
        channel: 'email',
        purpose: 'transactional',
        localeCode: 'en',
      },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('replays one template for a repeated Idempotency-Key', async () => {
    asAdminA();
    const key = randomUUID();
    const body = {
      templateCode: nextTemplateCode(),
      name: 'P1-15 idempotent template',
      channel: 'email',
      purpose: 'transactional',
      localeCode: 'en',
    };

    const first = await call<{ templateId: string }>(templateCreateRoute, {
      path: '/message-templates',
      body,
      idempotencyKey: key,
    });
    const second = await call<{ templateId: string }>(templateCreateRoute, {
      path: '/message-templates',
      body,
      idempotencyKey: key,
    });

    expect(second.body.templateId).toBe(first.body.templateId);
    expect(
      await countRows(admin, 'shared.message_templates', 'template_code = $1', [body.templateCode])
    ).toBe(1);
  });
});

describe('shared.template-update', () => {
  it('renames the template, audits it and bumps the ETag', async () => {
    asAdminA();
    const templateId = await createTemplate();

    const response = await call<{ templateId: string }>(templateUpdateRoute, {
      path: `/message-templates/${templateId}`,
      method: 'PATCH',
      params: { templateId },
      body: { name: 'Renamed by the route' },
      ifMatch: 1,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe('"2"');
    expect(await auditCount('shared.template.updated', templateId)).toBe(1);
    expect(
      await scalar<string>('SELECT name FROM shared.message_templates WHERE id = $1', [templateId])
    ).toBe('Renamed by the route');
  });

  it('refuses a caller without the permission with 403', async () => {
    asAdminA();
    const templateId = await createTemplate();
    asUnpermitted();

    const response = await call<ProblemBody>(templateUpdateRoute, {
      path: `/message-templates/${templateId}`,
      method: 'PATCH',
      params: { templateId },
      body: { name: 'refused' },
      ifMatch: 1,
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(TEMPLATE_UPDATE_OPERATION.permissions);
  });

  it("cannot rename another tenant's template", async () => {
    asAdminB();
    const foreignId = await createTemplate();

    asAdminA();
    const response = await call<ProblemBody>(templateUpdateRoute, {
      path: `/message-templates/${foreignId}`,
      method: 'PATCH',
      params: { templateId: foreignId },
      body: { name: 'reaching across a tenant boundary' },
      ifMatch: 1,
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
  });

  it('refuses a stale record version with 409 ERR-CON-001', async () => {
    asAdminA();
    const templateId = await createTemplate();

    const response = await call<ProblemBody>(templateUpdateRoute, {
      path: `/message-templates/${templateId}`,
      method: 'PATCH',
      params: { templateId },
      body: { name: 'stale' },
      ifMatch: 99,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-CON-001');
  });

  it('refuses a request with no If-Match at all with 428', async () => {
    asAdminA();
    const templateId = await createTemplate();

    const response = await call<ProblemBody>(templateUpdateRoute, {
      path: `/message-templates/${templateId}`,
      method: 'PATCH',
      params: { templateId },
      body: { name: 'unguarded' },
    });

    expect(response.status).toBe(428);
    expect(response.body.code).toBe('ERR-CON-002');
  });
});

describe('shared.template-version-create', () => {
  it('answers 201 with a draft, audits it and publishes one event', async () => {
    asAdminA();
    const templateId = await createTemplate();

    const response = await call<VersionBody>(templateVersionCreateRoute, {
      path: `/message-templates/${templateId}/versions`,
      params: { templateId },
      body: { subject: 'P1-15 route subject', body: TEMPLATE_BODY },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(201);
    // A version is always born a draft, whatever the caller asks for.
    expect(response.body.status).toBe('draft');
    expect(response.body.variables).toEqual(['name']);
    expect(await auditCount('shared.template.version_created', response.body.versionId)).toBe(1);
    expect(await outboxCount(TENANT_A, `template.change:${templateId}:version_created:1`)).toBe(1);
  });

  it('refuses a caller without the permission with 403', async () => {
    asAdminA();
    const templateId = await createTemplate();
    asUnpermitted();

    const response = await call<ProblemBody>(templateVersionCreateRoute, {
      path: `/message-templates/${templateId}/versions`,
      params: { templateId },
      body: { subject: null, body: TEMPLATE_BODY },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(
      TEMPLATE_VERSION_CREATE_OPERATION.permissions
    );
  });

  it("cannot add a version to another tenant's template", async () => {
    asAdminB();
    const foreignId = await createTemplate();

    asAdminA();
    const response = await call<ProblemBody>(templateVersionCreateRoute, {
      path: `/message-templates/${foreignId}/versions`,
      params: { templateId: foreignId },
      body: { subject: null, body: TEMPLATE_BODY },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
  });

  it('refuses content that cannot be rendered within the configured ceiling', async () => {
    asAdminA();
    const templateId = await createTemplate();

    const response = await call<ProblemBody>(templateVersionCreateRoute, {
      path: `/message-templates/${templateId}/versions`,
      params: { templateId },
      // The route accepts 100 000 characters; the renderer's ceiling is 20 000.
      // A version that could never be rendered must not be storable, because it
      // would fail for the first time at send.
      body: { subject: null, body: `Hello {{name}}. ${'x'.repeat(40_000)}` },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ERR-VAL-001');
    expect(
      await countRows(admin, 'shared.template_versions', 'template_id = $1', [templateId])
    ).toBe(0);
  });

  it('replays one version for a repeated Idempotency-Key', async () => {
    asAdminA();
    const templateId = await createTemplate();
    const key = randomUUID();
    const body = { subject: 'idempotent', body: TEMPLATE_BODY };

    const first = await call<VersionBody>(templateVersionCreateRoute, {
      path: `/message-templates/${templateId}/versions`,
      params: { templateId },
      body,
      idempotencyKey: key,
    });
    const second = await call<VersionBody>(templateVersionCreateRoute, {
      path: `/message-templates/${templateId}/versions`,
      params: { templateId },
      body,
      idempotencyKey: key,
    });

    expect(second.body.versionId).toBe(first.body.versionId);
    expect(
      await countRows(admin, 'shared.template_versions', 'template_id = $1', [templateId])
    ).toBe(1);
  });
});

describe('shared.template-version-revise', () => {
  it('revises a draft, audits it and bumps the ETag', async () => {
    asAdminA();
    const templateId = await createTemplate();
    const version = await createVersion(templateId);

    const response = await call<{ versionId: string }>(templateVersionReviseRoute, {
      path: `/template-versions/${version.versionId}`,
      method: 'PATCH',
      params: { versionId: version.versionId },
      body: { subject: 'Revised subject', body: 'Revised body for {{name}}.' },
      ifMatch: version.recordVersion,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('etag')).toBe(`"${version.recordVersion + 1}"`);
    expect(await auditCount('shared.template.version_created', version.versionId)).toBe(2);
    expect(
      await scalar<string>('SELECT body FROM shared.template_versions WHERE id = $1', [
        version.versionId,
      ])
    ).toBe('Revised body for {{name}}.');
  });

  it('refuses a caller without the permission with 403', async () => {
    asAdminA();
    const version = await createVersion(await createTemplate());
    asUnpermitted();

    const response = await call<ProblemBody>(templateVersionReviseRoute, {
      path: `/template-versions/${version.versionId}`,
      method: 'PATCH',
      params: { versionId: version.versionId },
      body: { subject: null, body: 'refused' },
      ifMatch: version.recordVersion,
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(
      TEMPLATE_VERSION_REVISE_OPERATION.permissions
    );
  });

  it("cannot revise another tenant's draft", async () => {
    asAdminB();
    const foreign = await createVersion(await createTemplate());

    asAdminA();
    const response = await call<ProblemBody>(templateVersionReviseRoute, {
      path: `/template-versions/${foreign.versionId}`,
      method: 'PATCH',
      params: { versionId: foreign.versionId },
      body: { subject: null, body: 'reaching across a tenant boundary' },
      ifMatch: foreign.recordVersion,
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
  });

  it('refuses to revise approved content — it is immutable', async () => {
    asAdminA();
    const templateId = await createTemplate();
    const version = await createVersion(templateId);
    await approveVersion(version.versionId, version.recordVersion);

    const response = await call<ProblemBody>(templateVersionReviseRoute, {
      path: `/template-versions/${version.versionId}`,
      method: 'PATCH',
      params: { versionId: version.versionId },
      body: { subject: null, body: 'changing approved content' },
      ifMatch: version.recordVersion + 1,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-TRN-001');
  });

  it('refuses a stale record version with 409 ERR-CON-001', async () => {
    asAdminA();
    const version = await createVersion(await createTemplate());

    const response = await call<ProblemBody>(templateVersionReviseRoute, {
      path: `/template-versions/${version.versionId}`,
      method: 'PATCH',
      params: { versionId: version.versionId },
      body: { subject: null, body: 'stale revision of {{name}}' },
      ifMatch: 99,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-CON-001');
  });
});

describe('shared.template-version-approve', () => {
  it('approves the draft, takes the approver from the session, audits and publishes', async () => {
    asAdminA();
    const templateId = await createTemplate();
    const version = await createVersion(templateId);

    const response = await call<{ status: string }>(templateVersionApproveRoute, {
      path: `/template-versions/${version.versionId}/approval`,
      params: { versionId: version.versionId },
      ifMatch: version.recordVersion,
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('approved');
    // The approver is never a request field: it comes from the resolved session.
    expect(
      await scalar<string>('SELECT approved_by FROM shared.template_versions WHERE id = $1', [
        version.versionId,
      ])
    ).toBe(U_RT_A);
    expect(await auditCount('shared.template.version_approved', version.versionId)).toBe(1);
    expect(await outboxCount(TENANT_A, `template.change:${templateId}:version_approved:1`)).toBe(1);
  });

  it('refuses a caller without the permission with 403', async () => {
    asAdminA();
    const version = await createVersion(await createTemplate());
    asUnpermitted();

    const response = await call<ProblemBody>(templateVersionApproveRoute, {
      path: `/template-versions/${version.versionId}/approval`,
      params: { versionId: version.versionId },
      ifMatch: version.recordVersion,
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(
      TEMPLATE_VERSION_APPROVE_OPERATION.permissions
    );
  });

  it("cannot approve another tenant's draft", async () => {
    asAdminB();
    const foreign = await createVersion(await createTemplate());

    asAdminA();
    const response = await call<ProblemBody>(templateVersionApproveRoute, {
      path: `/template-versions/${foreign.versionId}/approval`,
      params: { versionId: foreign.versionId },
      ifMatch: foreign.recordVersion,
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
  });

  it('refuses a version that is no longer a draft', async () => {
    asAdminA();
    const version = await createVersion(await createTemplate());
    await approveVersion(version.versionId, version.recordVersion);

    const response = await call<ProblemBody>(templateVersionApproveRoute, {
      path: `/template-versions/${version.versionId}/approval`,
      params: { versionId: version.versionId },
      ifMatch: version.recordVersion + 1,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-TRN-001');
  });

  it('refuses a stale record version with 409 ERR-CON-001', async () => {
    asAdminA();
    const version = await createVersion(await createTemplate());

    const response = await call<ProblemBody>(templateVersionApproveRoute, {
      path: `/template-versions/${version.versionId}/approval`,
      params: { versionId: version.versionId },
      ifMatch: 99,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-CON-001');
  });
});

describe('shared.template-activation-set', () => {
  it('points the template at an approved version, audits it and bumps the ETag', async () => {
    asAdminA();
    const templateId = await createTemplate();
    const version = await createVersion(templateId);
    await approveVersion(version.versionId, version.recordVersion);

    const response = await call<{ activeVersionId: string | null }>(templateActivationRoute, {
      path: `/message-templates/${templateId}/active-version`,
      method: 'PUT',
      params: { templateId },
      body: { versionId: version.versionId },
      ifMatch: 1,
    });

    expect(response.status).toBe(200);
    expect(response.body.activeVersionId).toBe(version.versionId);
    expect(response.headers.get('etag')).toBe('"2"');
    expect(
      await scalar<string>('SELECT active_version_id FROM shared.message_templates WHERE id = $1', [
        templateId,
      ])
    ).toBe(version.versionId);
    expect(await auditCount('shared.template.updated', templateId)).toBe(1);
  });

  it('refuses to activate a version that is still a draft', async () => {
    asAdminA();
    const templateId = await createTemplate();
    const version = await createVersion(templateId);

    const response = await call<ProblemBody>(templateActivationRoute, {
      path: `/message-templates/${templateId}/active-version`,
      method: 'PUT',
      params: { templateId },
      body: { versionId: version.versionId },
      ifMatch: 1,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(response.status).toBeLessThan(500);
  });

  it('refuses a caller without the permission with 403', async () => {
    asAdminA();
    const templateId = await createTemplate();
    asUnpermitted();

    const response = await call<ProblemBody>(templateActivationRoute, {
      path: `/message-templates/${templateId}/active-version`,
      method: 'PUT',
      params: { templateId },
      body: { versionId: null },
      ifMatch: 1,
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(TEMPLATE_ACTIVATION_OPERATION.permissions);
  });

  it("cannot set the active version of another tenant's template", async () => {
    asAdminB();
    const foreignId = await createTemplate();

    asAdminA();
    const response = await call<ProblemBody>(templateActivationRoute, {
      path: `/message-templates/${foreignId}/active-version`,
      method: 'PUT',
      params: { templateId: foreignId },
      body: { versionId: null },
      ifMatch: 1,
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
  });

  it('refuses a stale record version with 409 ERR-CON-001', async () => {
    asAdminA();
    const templateId = await createTemplate();

    const response = await call<ProblemBody>(templateActivationRoute, {
      path: `/message-templates/${templateId}/active-version`,
      method: 'PUT',
      params: { templateId },
      body: { versionId: null },
      ifMatch: 99,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-CON-001');
  });
});

describe('shared.template-version-retire', () => {
  it('retires an approved version that no template points at, audits and publishes', async () => {
    asAdminA();
    const templateId = await createTemplate();
    const version = await createVersion(templateId);
    await approveVersion(version.versionId, version.recordVersion);

    const response = await call<{ status: string }>(templateVersionRetireRoute, {
      path: `/template-versions/${version.versionId}/retirement`,
      params: { versionId: version.versionId },
      ifMatch: version.recordVersion + 1,
    });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('retired');
    expect(await auditCount('shared.template.version_retired', version.versionId)).toBe(1);
    expect(await outboxCount(TENANT_A, `template.change:${templateId}:version_retired:1`)).toBe(1);
  });

  it('refuses to retire the version a template still points at', async () => {
    asAdminA();
    const templateId = await createTemplate();
    const version = await createVersion(templateId);
    await approveVersion(version.versionId, version.recordVersion);
    await call(templateActivationRoute, {
      path: `/message-templates/${templateId}/active-version`,
      method: 'PUT',
      params: { templateId },
      body: { versionId: version.versionId },
      ifMatch: 1,
    });

    const response = await call<ProblemBody>(templateVersionRetireRoute, {
      path: `/template-versions/${version.versionId}/retirement`,
      params: { versionId: version.versionId },
      ifMatch: version.recordVersion + 1,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-TRN-001');
  });

  it('refuses a caller without the permission with 403', async () => {
    asAdminA();
    const version = await createVersion(await createTemplate());
    await approveVersion(version.versionId, version.recordVersion);
    asUnpermitted();

    const response = await call<ProblemBody>(templateVersionRetireRoute, {
      path: `/template-versions/${version.versionId}/retirement`,
      params: { versionId: version.versionId },
      ifMatch: version.recordVersion + 1,
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(
      TEMPLATE_VERSION_RETIRE_OPERATION.permissions
    );
  });

  it("cannot retire another tenant's version", async () => {
    asAdminB();
    const foreign = await createVersion(await createTemplate());
    await approveVersion(foreign.versionId, foreign.recordVersion);

    asAdminA();
    const response = await call<ProblemBody>(templateVersionRetireRoute, {
      path: `/template-versions/${foreign.versionId}/retirement`,
      params: { versionId: foreign.versionId },
      ifMatch: foreign.recordVersion + 1,
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
  });

  it('refuses a stale record version with 409 ERR-CON-001', async () => {
    asAdminA();
    const version = await createVersion(await createTemplate());
    await approveVersion(version.versionId, version.recordVersion);

    const response = await call<ProblemBody>(templateVersionRetireRoute, {
      path: `/template-versions/${version.versionId}/retirement`,
      params: { versionId: version.versionId },
      ifMatch: 99,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-CON-001');
  });
});

describe('shared.template-version-preview', () => {
  it('renders with sample values, sends nothing and writes no audit record', async () => {
    asAdminA();
    const templateId = await createTemplate();
    const version = await createVersion(templateId);
    const before = messages.callCount;

    const response = await call<{ subject: string | null; body: string }>(
      templateVersionPreviewRoute,
      {
        path: `/template-versions/${version.versionId}/preview`,
        params: { versionId: version.versionId },
        body: { variables: { name: 'Preview Recipient' } },
      }
    );

    expect(response.status).toBe(200);
    expect(response.body.body).toContain('Preview Recipient');
    expect(messages.callCount).toBe(before);
    expect(
      await countRows(admin, 'shared.outbound_messages', 'tenant_id = $1 AND dedupe_key = $2', [
        TENANT_A,
        'preview',
      ])
    ).toBe(0);
  });

  it('answers 422 rather than 500 when a variable is missing', async () => {
    asAdminA();
    const version = await createVersion(await createTemplate());

    const response = await call<ProblemBody>(templateVersionPreviewRoute, {
      path: `/template-versions/${version.versionId}/preview`,
      params: { versionId: version.versionId },
      body: { variables: {} },
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ERR-VAL-001');
  });

  it('answers 422 for a placeholder named after an Object.prototype member', async () => {
    asAdminA();
    const templateId = await createTemplate();
    const version = await createVersion(templateId, 'Hello {{constructor}}.');

    const response = await call<ProblemBody>(templateVersionPreviewRoute, {
      path: `/template-versions/${version.versionId}/preview`,
      params: { versionId: version.versionId },
      body: { variables: {} },
    });

    // The regression lock for the prototype-chain defect: a 500 here would mean
    // the missing-variable check had gone back to `in`/dotted lookup.
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ERR-VAL-001');
  });

  it('refuses a caller without the permission with 403', async () => {
    asAdminA();
    const version = await createVersion(await createTemplate());
    asUnpermitted();

    const response = await call<ProblemBody>(templateVersionPreviewRoute, {
      path: `/template-versions/${version.versionId}/preview`,
      params: { versionId: version.versionId },
      body: { variables: { name: 'x' } },
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(
      TEMPLATE_VERSION_PREVIEW_OPERATION.permissions
    );
  });

  it("cannot preview another tenant's version", async () => {
    asAdminB();
    const foreign = await createVersion(await createTemplate());

    asAdminA();
    const response = await call<ProblemBody>(templateVersionPreviewRoute, {
      path: `/template-versions/${foreign.versionId}/preview`,
      params: { versionId: foreign.versionId },
      body: { variables: { name: 'x' } },
    });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ERR-RES-001');
  });
});

// ===========================================================================
// Status transitions
// ===========================================================================

describe('shared.branch-status-read', () => {
  it('reports the current state, the reachable states and an ETag', async () => {
    asAdminA();

    const response = await call<{
      state: string;
      recordVersion: number;
      nextStates: readonly string[];
    }>(branchStatusReadRoute, {
      path: `/organization/branches/${BRANCH_RT_OUT}/status`,
      method: 'GET',
      params: { branchId: BRANCH_RT_OUT },
    });

    expect(response.status).toBe(200);
    expect(response.body.state).toBe('active');
    expect(response.body.nextStates).toEqual(['inactive']);
    expect(response.headers.get('etag')).toBe(`"${response.body.recordVersion}"`);
  });

  it('refuses a caller without org.branch.read with 403', async () => {
    asUnpermitted();

    const response = await call<ProblemBody>(branchStatusReadRoute, {
      path: `/organization/branches/${BRANCH_RT_OUT}/status`,
      method: 'GET',
      params: { branchId: BRANCH_RT_OUT },
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(BRANCH_STATUS_READ_OPERATION.permissions);
  });

  it("cannot read another tenant's branch", async () => {
    asAdminA();

    const response = await call<ProblemBody>(branchStatusReadRoute, {
      path: `/organization/branches/${BRANCH_B1}/status`,
      method: 'GET',
      params: { branchId: BRANCH_B1 },
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(['ERR-RES-001', 'ERR-IAM-001']).toContain(response.body.code);
  });

  it('refuses a branch outside the caller grant scope, and allows one inside it', async () => {
    asScopedA();

    const inScope = await call<{ state: string }>(branchStatusReadRoute, {
      path: `/organization/branches/${BRANCH_RT_IN}/status`,
      method: 'GET',
      params: { branchId: BRANCH_RT_IN },
    });
    const outOfScope = await call<ProblemBody>(branchStatusReadRoute, {
      path: `/organization/branches/${BRANCH_RT_OUT}/status`,
      method: 'GET',
      params: { branchId: BRANCH_RT_OUT },
    });

    expect(inScope.status).toBe(200);
    expect(outOfScope.status).toBe(403);
    expect(outOfScope.body.code).toBe('ERR-IAM-001');
  });
});

describe('shared.branch-status-change', () => {
  it('changes the state, writes module-owned history, audits and publishes one event', async () => {
    asAdminA();
    const read = await call<{ recordVersion: number }>(branchStatusReadRoute, {
      path: `/organization/branches/${BRANCH_RT_OUT}/status`,
      method: 'GET',
      params: { branchId: BRANCH_RT_OUT },
    });

    const response = await call<{ from: string; to: string; recordVersion: number }>(
      branchStatusChangeRoute,
      {
        path: `/organization/branches/${BRANCH_RT_OUT}/status`,
        params: { branchId: BRANCH_RT_OUT },
        body: { to: 'inactive', reason: 'Route-evidence deactivation' },
        ifMatch: read.body.recordVersion,
      }
    );

    expect(response.status).toBe(200);
    expect(response.body.from).toBe('active');
    expect(response.body.to).toBe('inactive');
    expect(await branchStatus(BRANCH_RT_OUT)).toBe('inactive');
    expect(
      await countRows(admin, 'org.branch_status_history', 'branch_id = $1 AND to_state = $2', [
        BRANCH_RT_OUT,
        'inactive',
      ])
    ).toBe(1);
    expect(await auditCount('org.branch.status_changed', BRANCH_RT_OUT)).toBe(1);
    expect(
      await outboxCount(TENANT_A, `org.branch:${BRANCH_RT_OUT}:${response.body.recordVersion}`)
    ).toBe(1);
  });

  it('refuses a repeat of the transition it has already made', async () => {
    asAdminA();
    const read = await call<{ recordVersion: number; state: string }>(branchStatusReadRoute, {
      path: `/organization/branches/${BRANCH_RT_OUT}/status`,
      method: 'GET',
      params: { branchId: BRANCH_RT_OUT },
    });
    expect(read.body.state).toBe('inactive');

    const response = await call<ProblemBody>(branchStatusChangeRoute, {
      path: `/organization/branches/${BRANCH_RT_OUT}/status`,
      params: { branchId: BRANCH_RT_OUT },
      body: { to: 'inactive', reason: 'already there' },
      ifMatch: read.body.recordVersion,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-TRN-001');
  });

  it('refuses a caller without org.settings.manage with 403', async () => {
    asUnpermitted();

    const response = await call<ProblemBody>(branchStatusChangeRoute, {
      path: `/organization/branches/${BRANCH_RT_IN}/status`,
      params: { branchId: BRANCH_RT_IN },
      body: { to: 'inactive', reason: 'refused' },
      ifMatch: 1,
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(BRANCH_STATUS_CHANGE_OPERATION.permissions);
    expect(await branchStatus(BRANCH_RT_IN)).toBe('active');
  });

  it('refuses a branch outside the caller grant scope', async () => {
    asScopedA();
    const before = await branchStatus(BRANCH_RT_IN);

    const response = await call<ProblemBody>(branchStatusChangeRoute, {
      path: `/organization/branches/${BRANCH_B1}/status`,
      params: { branchId: BRANCH_B1 },
      body: { to: 'inactive', reason: 'out of scope' },
      ifMatch: 1,
    });

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('ERR-IAM-001');
    expect(await branchStatus(BRANCH_RT_IN)).toBe(before);
    expect(await branchStatus(BRANCH_B1)).toBe('active');
  });

  it("cannot change another tenant's branch", async () => {
    asAdminA();

    const response = await call<ProblemBody>(branchStatusChangeRoute, {
      path: `/organization/branches/${BRANCH_B1}/status`,
      params: { branchId: BRANCH_B1 },
      body: { to: 'inactive', reason: 'reaching across a tenant boundary' },
      ifMatch: 1,
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(await branchStatus(BRANCH_B1)).toBe('active');
  });

  it('refuses a stale record version with 409 ERR-CON-001', async () => {
    asAdminA();

    const response = await call<ProblemBody>(branchStatusChangeRoute, {
      path: `/organization/branches/${BRANCH_RT_IN}/status`,
      params: { branchId: BRANCH_RT_IN },
      body: { to: 'inactive', reason: 'stale' },
      ifMatch: 99,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe('ERR-CON-001');
    expect(await branchStatus(BRANCH_RT_IN)).toBe('active');
  });

  it('refuses a reason longer than the governed maximum', async () => {
    asAdminA();
    const read = await call<{ recordVersion: number }>(branchStatusReadRoute, {
      path: `/organization/branches/${BRANCH_RT_IN}/status`,
      method: 'GET',
      params: { branchId: BRANCH_RT_IN },
    });

    const response = await call<ProblemBody>(branchStatusChangeRoute, {
      path: `/organization/branches/${BRANCH_RT_IN}/status`,
      params: { branchId: BRANCH_RT_IN },
      body: { to: 'inactive', reason: 'x'.repeat(5000) },
      ifMatch: read.body.recordVersion,
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ERR-VAL-001');
    expect(await branchStatus(BRANCH_RT_IN)).toBe('active');
  });
});

// ===========================================================================
// Export authorization
// ===========================================================================

describe('shared.export-catalogue', () => {
  it('lists the exportable resources for a caller holding rpt.export', async () => {
    asAdminA();

    const response = await call<{ resources: readonly { code: string }[] }>(exportCatalogueRoute, {
      path: '/exports/resources',
      method: 'GET',
    });

    expect(response.status).toBe(200);
    expect(response.body.resources.map((r) => r.code).sort()).toEqual([
      'branches',
      'documents',
      'outbound_messages',
    ]);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
  });

  it('refuses a caller without rpt.export with 403', async () => {
    asUnpermitted();

    const response = await call<ProblemBody>(exportCatalogueRoute, {
      path: '/exports/resources',
      method: 'GET',
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(EXPORT_CATALOGUE_OPERATION.permissions);
  });
});

describe('shared.export-authorize', () => {
  it('authorizes a bounded export, produces no file and writes an export-class audit', async () => {
    asAdminA();
    const before = await countRows(admin, 'iam.audit_records', 'action = $1 AND tenant_id = $2', [
      'shared.export.authorized',
      TENANT_A,
    ]);

    const response = await call<{ generated: boolean; fields: readonly string[] }>(
      exportAuthorizeRoute,
      {
        path: '/exports/authorizations',
        body: {
          resource: 'documents',
          fields: ['id', 'status'],
          filters: [{ field: 'status', operator: 'eq', value: 'active' }],
          reason: 'P1-15 route evidence export',
        },
      }
    );

    expect(response.status).toBe(200);
    // Authorization only: P1-15 produces no export file.
    expect(response.body.generated).toBe(false);
    expect(
      await countRows(admin, 'iam.audit_records', 'action = $1 AND tenant_id = $2', [
        'shared.export.authorized',
        TENANT_A,
      ])
    ).toBe(before + 1);
  });

  it('refuses a caller without rpt.export with 403 and writes no audit record', async () => {
    asUnpermitted();
    const before = await countRows(admin, 'iam.audit_records', 'action = $1 AND tenant_id = $2', [
      'shared.export.authorized',
      TENANT_A,
    ]);

    const response = await call<ProblemBody>(exportAuthorizeRoute, {
      path: '/exports/authorizations',
      body: {
        resource: 'documents',
        fields: [],
        filters: [],
        reason: 'refused',
      },
    });

    expect(response.status).toBe(403);
    expect(response.body.requiredPermissions).toEqual(EXPORT_AUTHORIZE_OPERATION.permissions);
    expect(
      await countRows(admin, 'iam.audit_records', 'action = $1 AND tenant_id = $2', [
        'shared.export.authorized',
        TENANT_A,
      ])
    ).toBe(before);
  });

  it('refuses an unregistered resource', async () => {
    asAdminA();

    const response = await call<ProblemBody>(exportAuthorizeRoute, {
      path: '/exports/authorizations',
      body: {
        resource: 'iam_user_accounts',
        fields: [],
        filters: [],
        reason: 'not exportable',
      },
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ERR-VAL-001');
  });

  it('refuses a filter on a field that is not filterable', async () => {
    asAdminA();

    const response = await call<ProblemBody>(exportAuthorizeRoute, {
      path: '/exports/authorizations',
      body: {
        resource: 'documents',
        fields: ['id'],
        filters: [{ field: 'title', operator: 'prefix', value: 'a' }],
        reason: 'read oracle attempt',
      },
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ERR-VAL-001');
  });

  it('requires a reason — an export is never anonymous', async () => {
    asAdminA();

    const response = await call<ProblemBody>(exportAuthorizeRoute, {
      path: '/exports/authorizations',
      body: {
        resource: 'documents',
        fields: ['id'],
        filters: [],
        reason: '',
      },
    });

    expect(response.status).toBe(422);
    expect(response.body.code).toBe('ERR-VAL-001');
  });
});

// ===========================================================================
// The two public operations
//
// These are the only P1-15 routes that answer without a session, so their
// evidence is the mirror image of every block above: not "the permission gate
// refuses", but "there is deliberately no gate, the declaration says so and
// says why, and answering ungated discloses nothing".
// ===========================================================================

describe('shared.health-live', () => {
  it('answers 200 with exactly { status, uptimeSeconds } and NO authenticator installed', async () => {
    __resetAuthenticatorForTests();

    const response = await call<{ status: string; uptimeSeconds: number }>(healthLiveRoute, {
      path: '/health/live',
      method: 'GET',
    });

    expect(response.status).toBe(200);
    expect(Object.keys(response.body).sort()).toEqual(['status', 'uptimeSeconds']);
    expect(response.body.status).toBe('alive');
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  it('declares itself public with a stated reason and audits nothing', async () => {
    expect(HEALTH_LIVE_OPERATION.public).toBe(true);
    expect(HEALTH_LIVE_OPERATION.publicReason ?? '').not.toBe('');
    expect(HEALTH_LIVE_OPERATION.auditClass).toBe('none');
    expect(HEALTH_LIVE_OPERATION.permissions).toEqual([]);
  });

  it('discloses no host, database name, role or driver detail', async () => {
    __resetAuthenticatorForTests();

    const response = await call<Record<string, unknown>>(healthLiveRoute, {
      path: '/health/live',
      method: 'GET',
    });
    const serialized = JSON.stringify(response.body).toLowerCase();

    for (const secret of ['postgres', 'rootlco_test', 'app_runtime', '127.0.0.1', '54322']) {
      expect(serialized).not.toContain(secret);
    }
  });
});

describe('shared.health-ready', () => {
  it('probes the dependency and answers a bounded verdict with NO session', async () => {
    __resetAuthenticatorForTests();

    const response = await call<{
      status: string;
      checks: readonly { name: string; ok: boolean }[];
    }>(healthReadyRoute, { path: '/health/ready', method: 'GET' });

    expect([200, 503]).toContain(response.status);
    expect(['ready', 'degraded', 'unavailable']).toContain(response.body.status);
    expect(response.body.checks.length).toBeGreaterThan(0);
    // Check entries carry a name and a boolean and nothing else: no role, no
    // host, no driver message.
    for (const check of response.body.checks) {
      expect(Object.keys(check).sort()).toEqual(['name', 'ok']);
    }
    expect(response.headers.get('cache-control')).toBe('no-store, private');
  });

  it('declares itself public with a stated reason and audits nothing', async () => {
    expect(HEALTH_READY_OPERATION.public).toBe(true);
    expect(HEALTH_READY_OPERATION.publicReason ?? '').not.toBe('');
    expect(HEALTH_READY_OPERATION.auditClass).toBe('none');
    expect(HEALTH_READY_OPERATION.permissions).toEqual([]);
  });

  it('leaks no host, database name, role or driver detail into the body', async () => {
    __resetAuthenticatorForTests();

    const response = await call<Record<string, unknown>>(healthReadyRoute, {
      path: '/health/ready',
      method: 'GET',
    });
    const serialized = JSON.stringify(response.body).toLowerCase();

    for (const secret of [
      'postgres',
      'rootlco_test',
      'app_runtime',
      '127.0.0.1',
      '54322',
      'password',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
