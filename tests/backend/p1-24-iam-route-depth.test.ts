/**
 * P1-24 — IAM and platform-meta route depth (P1-24-BE-001, P1-24-BE-005,
 * P1-24-BE-006, P1-24-QA-002, P1-24-QA-003, P1-24-SEC-001, P1-24-SEC-003).
 *
 * ===========================================================================
 * THE FINDING THIS SUITE EXISTS TO CLOSE — P1-24-F-001
 * ===========================================================================
 * P1-15 introduced a DERIVED evidence floor: what an operation owes is computed
 * from its own `defineOperation({...})` registration, so the obligation cannot be
 * weakened by editing a manifest. Every namespace delivered from P1-15 onward
 * joined it — `shared. crm. veh. apt. rec. wo. tech. dia. qms. svc. quo. inv.
 * sal. wty. rpt.`
 *
 * `iam.` and `meta.` never did. Thirty-nine operations — 17% of the public
 * surface, and the seventeen percent that decides who may do anything at all —
 * stayed on P1-14's DECLARED model, where the manifest is the requirement.
 * Measured against the derived floor at the P1-24 baseline, all 39 failed it,
 * and fourteen of them carried **no evidence flags at all**: the gate proved
 * only that some test file mentioned the id.
 *
 * Concretely, at `1c74454d` nothing anywhere asserted that:
 *
 *   - a caller lacking `iam.user.read` is refused `GET /iam/users` — the same
 *     held for all 35 authenticated operations in this namespace;
 *   - `GET /iam/users/{userId}` with another tenant's real user id does not
 *     return that user — the classic IDOR shape, on the endpoint that lists
 *     accounts;
 *   - a caller narrowed to one company cannot read another company's settings.
 *
 * Those are not hypothetical gaps in an untested corner. They are the
 * authorization surface itself, and the reason they went unnoticed is precisely
 * the trap the derived floor was invented to remove: the existing `iam.` suites
 * drive the APPLICATION SERVICES, so every one of them passes while the route
 * layer — permission evaluation, scope narrowing, problem-document mapping — is
 * never executed.
 *
 * ===========================================================================
 * WHAT IS PROVED HERE, AND WHAT IS NOT
 * ===========================================================================
 * Every assertion starts at `new Request(...)` and ends at a `Response`. Nothing
 * is mocked:
 *
 *   - the real `sessionAuthenticator()` seam carries `StaticClaimsAuthenticator`,
 *     so `resolveRequestContext()` genuinely reads the account, its grants and
 *     its scope out of PostgreSQL on the `app_runtime` identity, under RLS;
 *   - authorization is decided by `iam.has_permission` /
 *     `iam.has_permission_in_scope` inside the request transaction — this suite
 *     never re-implements the rule, it only proves the route asks and does not
 *     soften the answer;
 *   - the `postgres` admin connection provisions preconditions no application
 *     role may create and reads back what landed. It carries BYPASSRLS, so
 *     nothing it does is ever evidence.
 *
 * This suite deliberately does NOT re-prove idempotency, optimistic-concurrency
 * conflict, or the audit payload shape for the write operations: those already
 * have real evidence in `iam-access-administration`, `iam-admin-writes` and
 * `p1-14-idempotency-replay`, and coverage flags union across files. Duplicating
 * them here would inflate the suite without adding a fact. What is added is
 * exactly what was missing.
 *
 * ===========================================================================
 * WHY THE DENIAL TABLE IS A TABLE
 * ===========================================================================
 * Thirty-five hand-written denial tests would drift: the day someone adds an
 * operation, the table is the thing that fails to mention it. So the table is
 * reconciled against the REGISTRY at run time — `every authenticated iam./meta.
 * operation appears exactly once` is itself an assertion. A new operation cannot
 * be added to the namespace without either appearing here or failing this suite.
 *
 * The denial caller is `SUBJECT_UNPERMITTED`, a real account holding a real role
 * with no permission mappings — not an unknown subject, which would resolve to
 * nothing and produce a 401 that proves something else entirely.
 *
 * COVERAGE-EVIDENCE (P1-24 route depth for the iam./meta. surface):
 *   iam.approval-limit-create: route service authorization success
 *   iam.approval-limit-end: route service authorization cross-tenant
 *   iam.approval-limit-list: route service authorization success
 *   iam.audit-event-detail: route service authorization success cross-tenant audit
 *   iam.audit-event-list: route service authorization success audit
 *   iam.auth-login: route service unauthenticated
 *   iam.auth-logout: route service unauthenticated
 *   iam.auth-password-reset: route service unauthenticated
 *   iam.auth-password-reset-completion: route service unauthenticated
 *   iam.auth-session: route service authorization success
 *   iam.branch-settings-read: route service authorization success cross-tenant isolation
 *   iam.branch-settings-write: route service authorization cross-tenant isolation
 *   iam.company-settings-read: route service authorization success cross-tenant isolation
 *   iam.company-settings-write: route service authorization cross-tenant isolation
 *   iam.grant-issue: route service authorization success
 *   iam.grant-revoke: route service authorization cross-tenant audit
 *   iam.grant-scope-add: route service authorization cross-tenant
 *   iam.grant-scope-list: route service authorization success cross-tenant
 *   iam.grant-scope-remove: route service authorization cross-tenant audit
 *   iam.invitation-activate: route service authorization cross-tenant
 *   iam.invitation-cancel: route service authorization cross-tenant
 *   iam.invitation-create: route service authorization success
 *   iam.permission-list: route service authorization success
 *   iam.role-create: route service authorization success
 *   iam.role-list: route service authorization success
 *   iam.role-permission-add: route service authorization cross-tenant
 *   iam.role-permission-list: route service authorization success cross-tenant
 *   iam.role-permission-remove: route service authorization cross-tenant
 *   iam.role-permission-update: route service authorization cross-tenant
 *   iam.role-update: route service authorization cross-tenant
 *   iam.tenant-settings-read: route service authorization success
 *   iam.tenant-settings-update: route service authorization
 *   iam.user-detail: route service authorization success cross-tenant
 *   iam.user-list: route service authorization success
 *   iam.user-session-list: route service authorization success cross-tenant
 *   iam.user-session-revoke-all: route service authorization cross-tenant
 *   iam.user-status-change: route service authorization cross-tenant
 *   iam.user-update: route service authorization cross-tenant
 *   meta.ping: route service authorization success
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  BRANCH_A1,
  COMPANY_A1,
  IDENTITY_PROVIDER,
  SUBJECT_UNPERMITTED,
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
import { allOperations, type RegisteredOperation } from '@/server/auth/operation-registry';
import { FakeIdentityProvider, iamModule, setIdentityProvider } from '@/modules/iam';

// --- Every iam./meta. route, imported exactly as Next.js loads it. ----------
import { PING_OPERATION, GET as pingRoute } from '@/app/api/v1/meta/ping/route';
import { LOGIN_OPERATION, POST as loginRoute } from '@/app/api/v1/auth/login/route';
import { LOGOUT_OPERATION, POST as logoutRoute } from '@/app/api/v1/auth/logout/route';
import { SESSION_OPERATION, GET as sessionRoute } from '@/app/api/v1/auth/session/route';
import {
  PASSWORD_RESET_OPERATION,
  POST as passwordResetRoute,
} from '@/app/api/v1/auth/password-reset/route';
import {
  PASSWORD_RESET_COMPLETION_OPERATION,
  POST as passwordResetCompletionRoute,
} from '@/app/api/v1/auth/password-reset/completion/route';
import {
  INVITE_OPERATION,
  POST as invitationCreateRoute,
} from '@/app/api/v1/iam/invitations/route';
import {
  INVITATION_CANCEL_OPERATION,
  DELETE as invitationCancelRoute,
} from '@/app/api/v1/iam/invitations/[userId]/route';
import {
  INVITATION_ACTIVATE_OPERATION,
  POST as invitationActivateRoute,
} from '@/app/api/v1/iam/invitations/[userId]/activation/route';
import { USER_LIST_OPERATION, GET as userListRoute } from '@/app/api/v1/iam/users/route';
import {
  USER_DETAIL_OPERATION,
  USER_UPDATE_OPERATION,
  GET as userDetailRoute,
  PATCH as userUpdateRoute,
} from '@/app/api/v1/iam/users/[userId]/route';
import {
  USER_STATUS_OPERATION,
  POST as userStatusRoute,
} from '@/app/api/v1/iam/users/[userId]/status/route';
import {
  USER_SESSION_LIST_OPERATION,
  USER_SESSION_REVOKE_OPERATION,
  GET as userSessionListRoute,
  DELETE as userSessionRevokeRoute,
} from '@/app/api/v1/iam/users/[userId]/sessions/route';
import {
  PERMISSION_LIST_OPERATION,
  GET as permissionListRoute,
} from '@/app/api/v1/iam/permissions/route';
import {
  ROLE_LIST_OPERATION,
  ROLE_CREATE_OPERATION,
  GET as roleListRoute,
  POST as roleCreateRoute,
} from '@/app/api/v1/iam/roles/route';
import {
  ROLE_UPDATE_OPERATION,
  PATCH as roleUpdateRoute,
} from '@/app/api/v1/iam/roles/[roleId]/route';
import {
  ROLE_PERMISSION_LIST_OPERATION,
  ROLE_PERMISSION_ADD_OPERATION,
  GET as rolePermissionListRoute,
  POST as rolePermissionAddRoute,
} from '@/app/api/v1/iam/roles/[roleId]/permissions/route';
import {
  ROLE_PERMISSION_UPDATE_OPERATION,
  ROLE_PERMISSION_REMOVE_OPERATION,
  PATCH as rolePermissionUpdateRoute,
  DELETE as rolePermissionRemoveRoute,
} from '@/app/api/v1/iam/roles/[roleId]/permissions/[mappingId]/route';
import { GRANT_ISSUE_OPERATION, POST as grantIssueRoute } from '@/app/api/v1/iam/grants/route';
import {
  GRANT_REVOKE_OPERATION,
  DELETE as grantRevokeRoute,
} from '@/app/api/v1/iam/grants/[grantId]/route';
import {
  GRANT_SCOPE_LIST_OPERATION,
  GRANT_SCOPE_ADD_OPERATION,
  GET as grantScopeListRoute,
  POST as grantScopeAddRoute,
} from '@/app/api/v1/iam/grants/[grantId]/scopes/route';
import {
  GRANT_SCOPE_REMOVE_OPERATION,
  DELETE as grantScopeRemoveRoute,
} from '@/app/api/v1/iam/grants/[grantId]/scopes/[scopeId]/route';
import {
  APPROVAL_LIMIT_LIST_OPERATION,
  APPROVAL_LIMIT_CREATE_OPERATION,
  GET as approvalLimitListRoute,
  POST as approvalLimitCreateRoute,
} from '@/app/api/v1/iam/approval-limits/route';
import {
  APPROVAL_LIMIT_END_OPERATION,
  PATCH as approvalLimitEndRoute,
} from '@/app/api/v1/iam/approval-limits/[limitId]/route';
import {
  AUDIT_EVENT_LIST_OPERATION,
  GET as auditEventListRoute,
} from '@/app/api/v1/audit-events/route';
import {
  AUDIT_EVENT_DETAIL_OPERATION,
  GET as auditEventDetailRoute,
} from '@/app/api/v1/audit-events/[recordId]/route';
import {
  TENANT_READ_OPERATION,
  TENANT_UPDATE_OPERATION,
  GET as tenantReadRoute,
  PATCH as tenantUpdateRoute,
} from '@/app/api/v1/org/tenant/route';
import {
  COMPANY_SETTINGS_READ_OPERATION,
  COMPANY_SETTINGS_WRITE_OPERATION,
  GET as companySettingsReadRoute,
  POST as companySettingsWriteRoute,
} from '@/app/api/v1/org/companies/[companyId]/settings/route';
import {
  BRANCH_SETTINGS_READ_OPERATION,
  BRANCH_SETTINGS_WRITE_OPERATION,
  GET as branchSettingsReadRoute,
  POST as branchSettingsWriteRoute,
} from '@/app/api/v1/org/branches/[branchId]/settings/route';

// ---------------------------------------------------------------------------
// Fixtures. A distinct id space (d4…/e4…) from every other backend suite, so a
// concurrent fixture can never collide with one of these. All of it is ephemeral
// scaffolding removed by cleanBackendFixtures(); no business data is created,
// shipped or retained.
// ---------------------------------------------------------------------------

/** Tenant A caller holding every permission the 35 authenticated routes declare. */
const U24_ADMIN = 'd4000000-0000-4000-8000-000000000001';
/** Tenant A caller with the same role, narrowed to COMPANY_A1 / BRANCH_A1. */
const U24_SCOPED = 'd4000000-0000-4000-8000-000000000002';
/** Tenant B caller holding the same permissions, in the other tenant. */
const U24_ADMIN_B = 'd4000000-0000-4000-8000-00000000000b';
/**
 * Tenant A caller holding ONE half of a conjunction: `iam.user.manage` but not
 * `iam.session.view_all`. Exists so "the denial names the operation's declared
 * codes, never the caller's own gap" is testable — on a single-permission
 * operation the two are indistinguishable.
 */
const U24_PARTIAL = 'd4000000-0000-4000-8000-000000000005';
/** A plain tenant-A account used as the TARGET of user reads and writes. */
const U24_TARGET = 'd4000000-0000-4000-8000-000000000003';
/** A plain tenant-B account. Its id is what tenant A must not be able to read. */
const U24_TARGET_B = 'd4000000-0000-4000-8000-00000000000c';

const ROLE24_A = 'd4100000-0000-4000-8000-000000000001';
const ROLE24_B = 'd4100000-0000-4000-8000-00000000000b';
/** Carries `iam.user.manage` only — the half of the conjunction. */
const ROLE24_PARTIAL = 'd4100000-0000-4000-8000-000000000005';
/** A tenant-A role that exists only to be the target of role reads and writes. */
const ROLE24_TARGET = 'd4100000-0000-4000-8000-000000000002';
/** The tenant-B twin of ROLE24_TARGET — a real role, in the other tenant. */
const ROLE24_TARGET_B = 'd4100000-0000-4000-8000-00000000000c';

const GRANT24_SCOPED = 'd4200000-0000-4000-8000-000000000002';
/** A tenant-A grant used as a read/scope target, and its tenant-B twin. */
const GRANT24_TARGET = 'd4200000-0000-4000-8000-000000000003';
const GRANT24_TARGET_B = 'd4200000-0000-4000-8000-00000000000c';

/** A second tenant-A company, deliberately OUTSIDE the narrowed grant. */
const COMPANY24_OUT = 'd4300000-0000-4000-8000-000000000004';
/** A tenant-A branch outside the narrowed grant, under the in-scope company. */
const BRANCH24_OUT = 'd4400000-0000-4000-8000-000000000004';
/** Tenant B's own company and branch, so "unreachable" is about real rows. */
const COMPANY24_B = 'd4300000-0000-4000-8000-00000000000b';
const BRANCH24_B = 'd4400000-0000-4000-8000-00000000000b';

const SUBJECT24_ADMIN = 'fx_p24_rt_admin';
const SUBJECT24_SCOPED = 'fx_p24_rt_scoped';
const SUBJECT24_ADMIN_B = 'fx_p24_rt_admin_b';
const SUBJECT24_PARTIAL = 'fx_p24_rt_partial';

/** The twelve codes the iam./meta. surface declares. Reconciled below. */
const PERMISSIONS24 = [
  'iam.approval.manage',
  'iam.audit.view',
  'iam.grant.manage',
  'iam.role.manage',
  'iam.role.read',
  'iam.session.view_all',
  'iam.user.manage',
  'iam.user.read',
  'org.branch.read',
  'org.company.read',
  'org.settings.manage',
  'org.tenant.read',
] as const;

let admin: Pool;
let runtime: Pool;

// ---------------------------------------------------------------------------
// Route invocation
// ---------------------------------------------------------------------------

type RouteFn = (
  request: Request,
  route: { params: Promise<Record<string, string>> }
) => Promise<Response>;

/**
 * Widens a Next.js route export to one call signature.
 *
 * The handlers declare their own literal parameter shapes
 * (`{ params: Promise<{ userId: string }> }`), which `strictFunctionTypes` will
 * not unify. The cast is confined to this one helper so every test below names
 * the real exported function and nothing else.
 */
const asRoute = (handler: unknown): RouteFn => handler as RouteFn;

interface CallInput {
  readonly path: string;
  readonly method?: string;
  readonly params?: Record<string, string>;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
  readonly ifMatch?: number | string;
  readonly query?: Record<string, string>;
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
  readonly detail?: string;
  readonly requiredPermissions?: readonly string[];
}

async function call<T>(handler: unknown, input: CallInput): Promise<CallResult<T>> {
  // Re-installed immediately before EVERY request, not once per test.
  //
  // `iamModule()` is a memoised composition root, and composing it calls
  // `installIamRuntime()`, which calls `setSessionAuthenticator(new
  // BearerSessionAuthenticator(...))` — silently replacing whatever the harness
  // installed. The first route call in a process therefore runs as the harness
  // intended and every later one does not. Re-installing here means each request
  // is a genuinely separate request rather than a continuation of the last.
  reinstallAuthenticator();
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  if (input.ifMatch !== undefined) {
    headers['if-match'] = typeof input.ifMatch === 'number' ? `"${input.ifMatch}"` : input.ifMatch;
  }
  const url = new URL(`http://localhost/api/v1${input.path}`);
  for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value);
  const init: RequestInit = { method: input.method ?? 'GET', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const response = await asRoute(handler)(new Request(url, init), {
    params: Promise.resolve(input.params ?? {}),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: (text === '' ? null : JSON.parse(text)) as T,
    headers: response.headers,
  };
}

/** The identity `call()` re-installs before each request. */
let currentClaims: { providerSubject: string; tenantId: string } | undefined;

function reinstallAuthenticator(): void {
  if (!currentClaims) {
    __resetAuthenticatorForTests();
    return;
  }
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({ identityProvider: IDENTITY_PROVIDER, ...currentClaims })
  );
}

function authenticateAs(providerSubject: string, tenantId: string = TENANT_A): void {
  currentClaims = { providerSubject, tenantId };
  reinstallAuthenticator();
}

const asAdmin = (): void => authenticateAs(SUBJECT24_ADMIN);
const asPartial = (): void => authenticateAs(SUBJECT24_PARTIAL);
const asScoped = (): void => authenticateAs(SUBJECT24_SCOPED);
const asAdminB = (): void => authenticateAs(SUBJECT24_ADMIN_B, TENANT_B);
const asUnpermitted = (): void => authenticateAs(SUBJECT_UNPERMITTED);
/** No session at all — the state a public route must answer in. */
const asNobody = (): void => {
  currentClaims = undefined;
  __resetAuthenticatorForTests();
};

// ---------------------------------------------------------------------------
// Readers. `admin` is used here and only here.
// ---------------------------------------------------------------------------

async function scalar<T>(sql: string, values: readonly unknown[]): Promise<T | undefined> {
  const result = await admin.query<Record<string, T>>(sql, values as unknown[]);
  const row = result.rows[0];
  return row ? Object.values(row)[0] : undefined;
}

const auditCount = (action: string, tenantId = TENANT_A): Promise<number> =>
  countRows(admin, 'iam.audit_records', 'action = $1 AND tenant_id = $2', [action, tenantId]);

// ---------------------------------------------------------------------------
// Provisioning
// ---------------------------------------------------------------------------

async function seedSuiteFixtures(): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $6, $9,  $10, 'fx-p24-rt-admin@example.test',   'P1-24 Route Admin A', 'active', $8),
            ($2, $6, $9,  $11, 'fx-p24-rt-scoped@example.test',  'P1-24 Route Scoped',  'active', $8),
            ($3, $7, $9,  $12, 'fx-p24-rt-admin-b@example.test', 'P1-24 Route Admin B', 'active', $8),
            ($4, $6, $9,  'fx_p24_rt_target',   'fx-p24-rt-target@example.test',   'P1-24 Target A', 'active', $8),
            ($5, $7, $9,  'fx_p24_rt_target_b', 'fx-p24-rt-target-b@example.test', 'P1-24 Target B', 'active', $8),
            ($13, $6, $9, $14, 'fx-p24-rt-partial@example.test', 'P1-24 Route Partial', 'active', $8)
     ON CONFLICT (id) DO NOTHING`,
    [
      U24_ADMIN,
      U24_SCOPED,
      U24_ADMIN_B,
      U24_TARGET,
      U24_TARGET_B,
      TENANT_A,
      TENANT_B,
      USER_A,
      IDENTITY_PROVIDER,
      SUBJECT24_ADMIN,
      SUBJECT24_SCOPED,
      SUBJECT24_ADMIN_B,
      U24_PARTIAL,
      SUBJECT24_PARTIAL,
    ]
  );

  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1, $5, 'fx_p24_rt_admin',   'P1-24 route administration', $7),
            ($2, $6, 'fx_p24_rt_admin',   'P1-24 route administration', $7),
            ($3, $5, 'fx_p24_rt_target',  'P1-24 route target role',    $7),
            ($4, $6, 'fx_p24_rt_target',  'P1-24 route target role',    $7),
            ($8, $5, 'fx_p24_rt_partial', 'P1-24 route partial role',   $7)
     ON CONFLICT (id) DO NOTHING`,
    [ROLE24_A, ROLE24_B, ROLE24_TARGET, ROLE24_TARGET_B, TENANT_A, TENANT_B, USER_A, ROLE24_PARTIAL]
  );

  for (const [roleId, tenantId, codes] of [
    [ROLE24_A, TENANT_A, PERMISSIONS24],
    [ROLE24_B, TENANT_B, PERMISSIONS24],
    // Deliberately ONE of the two codes `iam.user-status-change` declares.
    [ROLE24_PARTIAL, TENANT_A, ['iam.user.manage']],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = ANY($4::text[])
       ON CONFLICT DO NOTHING`,
      [tenantId, roleId, USER_A, codes]
    );
  }

  // Grants carry no natural key, so a re-seed would otherwise stack duplicates.
  await admin.query('DELETE FROM iam.role_grants WHERE user_id = ANY($1::uuid[])', [
    [U24_ADMIN, U24_SCOPED, U24_ADMIN_B, U24_TARGET, U24_TARGET_B, U24_PARTIAL],
  ]);
  await admin.query(
    `INSERT INTO iam.role_grants
       (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
     VALUES (DEFAULT, $1, $2, $3, 'unrestricted', 'active', $8, $8),
            (DEFAULT, $4, $5, $6, 'unrestricted', 'active', $8, $8),
            ($7,      $1, $9, $10, 'unrestricted', 'active', $8, $8),
            ($11,     $4, $12, $13, 'unrestricted', 'active', $8, $8),
            (DEFAULT, $1, $14, $15, 'unrestricted', 'active', $8, $8)`,
    [
      TENANT_A,
      U24_ADMIN,
      ROLE24_A,
      TENANT_B,
      U24_ADMIN_B,
      ROLE24_B,
      GRANT24_TARGET,
      USER_A,
      U24_TARGET,
      ROLE24_TARGET,
      GRANT24_TARGET_B,
      U24_TARGET_B,
      ROLE24_TARGET_B,
      U24_PARTIAL,
      ROLE24_PARTIAL,
    ]
  );

  // A second tenant-A company and an out-of-scope branch, plus tenant B's own
  // organization, so every "unreachable" assertion is about a row that exists.
  await admin.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, $3, 'fx_p24_rt_c_out', 'P1-24 Route Company Out', 'USD', $5),
            ($2, $4, 'fx_p24_rt_c_b',   'P1-24 Route Company B',   'USD', $5)
     ON CONFLICT (id) DO NOTHING`,
    [COMPANY24_OUT, COMPANY24_B, TENANT_A, TENANT_B, USER_A]
  );
  await admin.query(
    `INSERT INTO org.branches
       (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1, $3, $5, 'fx_p24_rt_b_out', 'P1-24 Route Branch Out', 'UTC', $7),
            ($2, $4, $6, 'fx_p24_rt_b_b',   'P1-24 Route Branch B',   'UTC', $7)
     ON CONFLICT (id) DO NOTHING`,
    [BRANCH24_OUT, BRANCH24_B, TENANT_A, TENANT_B, COMPANY24_OUT, COMPANY24_B, USER_A]
  );

  // The narrowed grant. `tg_role_grants_require_scope` is DEFERRABLE INITIALLY
  // DEFERRED, so the grant and its scopes must land in ONE transaction.
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `INSERT INTO iam.role_grants
         (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1, $2, $3, $4, 'scoped', 'active', $5, $5)`,
      [GRANT24_SCOPED, TENANT_A, U24_SCOPED, ROLE24_A, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, created_by)
       VALUES ($1, $2, 'company', $3, $4)`,
      [TENANT_A, GRANT24_SCOPED, COMPANY_A1, USER_A]
    );
    await client.query(
      `INSERT INTO iam.grant_scopes
         (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       VALUES ($1, $2, 'branch', $3, $4, $5)`,
      [TENANT_A, GRANT24_SCOPED, COMPANY_A1, BRANCH_A1, USER_A]
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
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  // Invitation links are refused outright unless a destination is allow-listed.
  process.env.AUTH_REDIRECT_ALLOWLIST = REDIRECT_ALLOWED;
  __resetBackendConfigForTests();

  // The provider seam is installed BEFORE the composition root is touched.
  // `installIamRuntime()` reads Supabase credentials only when no provider is
  // present, so installing the fake first is what lets the whole route surface
  // run with no provider credentials at all (ADR-019).
  setIdentityProvider(
    new FakeIdentityProvider({
      secret: 'p1-24-route-depth-secret-not-real',
      issuer: 'https://auth.test.local/auth/v1',
      audience: 'authenticated',
    })
  );

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await seedSuiteFixtures();

  // The denial caller must be a REAL account with a REAL empty role. An unknown
  // subject would resolve to nothing and answer 401, which proves the
  // authenticator works — not that the permission gate does.
  const unpermitted = await scalar<string>(
    'SELECT id FROM iam.user_accounts WHERE provider_subject = $1',
    [SUBJECT_UNPERMITTED]
  );
  if (unpermitted !== USER_UNPERMITTED) {
    throw new Error(`Unpermitted fixture subject resolved to ${String(unpermitted)}`);
  }

  runtime = runtimeAppPool(8);
  __setPrimaryPoolForTests(runtime);

  // Force the composition root NOW, so its authenticator replacement happens
  // once here rather than in the middle of the first test's request.
  iamModule();
}, 180_000);

afterEach(() => {
  asNobody();
});

afterAll(async () => {
  __resetAuthenticatorForTests();
  __setPrimaryPoolForTests(undefined);
  await runtime?.end();
  await cleanBackendFixtures(admin);
  await admin?.end();
});

// ---------------------------------------------------------------------------
// The denial table
// ---------------------------------------------------------------------------

/** One entry per authenticated `iam.`/`meta.` operation. */
interface DenialCase {
  /**
   * The REGISTERED operation, not its id string.
   *
   * A string would let a typo pass as a new entry while quietly dropping the
   * real one; the constant is imported from the route module, so a wrong name
   * is a compile error and a deleted operation breaks the build.
   */
  readonly operation: RegisteredOperation;
  readonly handler: unknown;
  readonly input: CallInput;
}

const ISO_FROM = '2026-01-01T00:00:00.000Z';
/** `effectiveFrom` is a calendar date, not a timestamp. */
const DATE_FROM = '2026-01-01';
const DATE_TO = '2026-12-31';
const ISO_TO = '2026-01-08T00:00:00.000Z';
/** Invitation links are refused outright unless a destination is allow-listed. */
const REDIRECT_ALLOWED = 'https://app.test.local/invitation';

/**
 * Every request below is *well formed*. That matters: a malformed request could
 * be refused by validation and the test would pass while proving nothing about
 * authorization. Where the addressed row does not exist, the point stands
 * anyway — a 403 must arrive BEFORE the handler body could discover that.
 */
const denialCases: readonly DenialCase[] = [
  { operation: PING_OPERATION, handler: pingRoute, input: { path: '/meta/ping' } },
  { operation: SESSION_OPERATION, handler: sessionRoute, input: { path: '/auth/session' } },
  { operation: USER_LIST_OPERATION, handler: userListRoute, input: { path: '/iam/users' } },
  {
    operation: USER_DETAIL_OPERATION,
    handler: userDetailRoute,
    input: { path: `/iam/users/${U24_TARGET}`, params: { userId: U24_TARGET } },
  },
  {
    operation: USER_UPDATE_OPERATION,
    handler: userUpdateRoute,
    input: {
      path: `/iam/users/${U24_TARGET}`,
      method: 'PATCH',
      params: { userId: U24_TARGET },
      body: { displayName: 'Denied' },
      ifMatch: 1,
    },
  },
  {
    operation: USER_STATUS_OPERATION,
    handler: userStatusRoute,
    input: {
      path: `/iam/users/${U24_TARGET}/status`,
      method: 'POST',
      params: { userId: U24_TARGET },
      body: { status: 'locked', reason: 'p1-24 denial probe' },
      idempotencyKey: randomUUID(),
    },
  },
  {
    operation: USER_SESSION_LIST_OPERATION,
    handler: userSessionListRoute,
    input: { path: `/iam/users/${U24_TARGET}/sessions`, params: { userId: U24_TARGET } },
  },
  {
    operation: USER_SESSION_REVOKE_OPERATION,
    handler: userSessionRevokeRoute,
    input: {
      path: `/iam/users/${U24_TARGET}/sessions`,
      method: 'DELETE',
      params: { userId: U24_TARGET },
      body: { reason: 'p1-24 denial probe' },
    },
  },
  {
    operation: INVITE_OPERATION,
    handler: invitationCreateRoute,
    input: {
      path: '/iam/invitations',
      method: 'POST',
      body: { email: 'fx-p24-denied@example.test', displayName: 'Denied Invitee' },
      idempotencyKey: randomUUID(),
    },
  },
  {
    operation: INVITATION_CANCEL_OPERATION,
    handler: invitationCancelRoute,
    input: {
      path: `/iam/invitations/${U24_TARGET}`,
      method: 'DELETE',
      params: { userId: U24_TARGET },
      body: { reason: 'p1-24 denial probe' },
    },
  },
  {
    operation: INVITATION_ACTIVATE_OPERATION,
    handler: invitationActivateRoute,
    input: {
      path: `/iam/invitations/${U24_TARGET}/activation`,
      method: 'POST',
      params: { userId: U24_TARGET },
      body: { reason: 'p1-24 denial probe' },
      idempotencyKey: randomUUID(),
    },
  },
  {
    operation: PERMISSION_LIST_OPERATION,
    handler: permissionListRoute,
    input: { path: '/iam/permissions' },
  },
  { operation: ROLE_LIST_OPERATION, handler: roleListRoute, input: { path: '/iam/roles' } },
  {
    operation: ROLE_CREATE_OPERATION,
    handler: roleCreateRoute,
    input: {
      path: '/iam/roles',
      method: 'POST',
      body: { roleCode: 'fx_p24_denied', name: 'Denied role' },
      idempotencyKey: randomUUID(),
    },
  },
  {
    operation: ROLE_UPDATE_OPERATION,
    handler: roleUpdateRoute,
    input: {
      path: `/iam/roles/${ROLE24_TARGET}`,
      method: 'PATCH',
      params: { roleId: ROLE24_TARGET },
      body: { name: 'Denied rename' },
      ifMatch: 1,
    },
  },
  {
    operation: ROLE_PERMISSION_LIST_OPERATION,
    handler: rolePermissionListRoute,
    input: { path: `/iam/roles/${ROLE24_TARGET}/permissions`, params: { roleId: ROLE24_TARGET } },
  },
  {
    operation: ROLE_PERMISSION_ADD_OPERATION,
    handler: rolePermissionAddRoute,
    input: {
      path: `/iam/roles/${ROLE24_TARGET}/permissions`,
      method: 'POST',
      params: { roleId: ROLE24_TARGET },
      body: { permissionCode: 'iam.user.read', effect: 'allow' },
      idempotencyKey: randomUUID(),
    },
  },
  {
    operation: ROLE_PERMISSION_UPDATE_OPERATION,
    handler: rolePermissionUpdateRoute,
    input: {
      path: `/iam/roles/${ROLE24_TARGET}/permissions/${randomUUID()}`,
      method: 'PATCH',
      params: { roleId: ROLE24_TARGET, mappingId: randomUUID() },
      body: { effect: 'deny' },
      ifMatch: 1,
    },
  },
  {
    operation: ROLE_PERMISSION_REMOVE_OPERATION,
    handler: rolePermissionRemoveRoute,
    input: {
      path: `/iam/roles/${ROLE24_TARGET}/permissions/${randomUUID()}`,
      method: 'DELETE',
      params: { roleId: ROLE24_TARGET, mappingId: randomUUID() },
    },
  },
  {
    operation: GRANT_ISSUE_OPERATION,
    handler: grantIssueRoute,
    input: {
      path: '/iam/grants',
      method: 'POST',
      body: { userId: U24_TARGET, roleId: ROLE24_TARGET },
      idempotencyKey: randomUUID(),
    },
  },
  {
    operation: GRANT_REVOKE_OPERATION,
    handler: grantRevokeRoute,
    input: {
      path: `/iam/grants/${GRANT24_TARGET}`,
      method: 'DELETE',
      params: { grantId: GRANT24_TARGET },
      body: { reason: 'p1-24 denial probe' },
      ifMatch: 1,
    },
  },
  {
    operation: GRANT_SCOPE_LIST_OPERATION,
    handler: grantScopeListRoute,
    input: { path: `/iam/grants/${GRANT24_SCOPED}/scopes`, params: { grantId: GRANT24_SCOPED } },
  },
  {
    operation: GRANT_SCOPE_ADD_OPERATION,
    handler: grantScopeAddRoute,
    input: {
      path: `/iam/grants/${GRANT24_SCOPED}/scopes`,
      method: 'POST',
      params: { grantId: GRANT24_SCOPED },
      body: { scopeType: 'company', companyId: COMPANY24_OUT },
      idempotencyKey: randomUUID(),
    },
  },
  {
    operation: GRANT_SCOPE_REMOVE_OPERATION,
    handler: grantScopeRemoveRoute,
    input: {
      path: `/iam/grants/${GRANT24_SCOPED}/scopes/${randomUUID()}`,
      method: 'DELETE',
      params: { grantId: GRANT24_SCOPED, scopeId: randomUUID() },
    },
  },
  {
    operation: APPROVAL_LIMIT_LIST_OPERATION,
    handler: approvalLimitListRoute,
    input: { path: '/iam/approval-limits' },
  },
  {
    operation: APPROVAL_LIMIT_CREATE_OPERATION,
    handler: approvalLimitCreateRoute,
    input: {
      path: '/iam/approval-limits',
      method: 'POST',
      body: {
        companyId: COMPANY_A1,
        userId: U24_TARGET,
        limitType: 'fx_p24_denial',
        amount: '5.0000',
        currency: 'USD',
        effectiveFrom: DATE_FROM,
      },
      idempotencyKey: randomUUID(),
    },
  },
  {
    operation: APPROVAL_LIMIT_END_OPERATION,
    handler: approvalLimitEndRoute,
    input: {
      path: `/iam/approval-limits/${randomUUID()}`,
      method: 'PATCH',
      params: { limitId: randomUUID() },
      body: { effectiveTo: DATE_TO },
      ifMatch: 1,
    },
  },
  {
    operation: AUDIT_EVENT_LIST_OPERATION,
    handler: auditEventListRoute,
    input: { path: '/audit-events', query: { from: ISO_FROM, to: ISO_TO } },
  },
  {
    operation: AUDIT_EVENT_DETAIL_OPERATION,
    handler: auditEventDetailRoute,
    input: { path: `/audit-events/${randomUUID()}`, params: { recordId: randomUUID() } },
  },
  {
    operation: TENANT_READ_OPERATION,
    handler: tenantReadRoute,
    input: { path: '/org/tenant' },
  },
  {
    operation: TENANT_UPDATE_OPERATION,
    handler: tenantUpdateRoute,
    input: {
      path: '/org/tenant',
      method: 'PATCH',
      body: { displayName: 'Denied rename' },
      ifMatch: 1,
    },
  },
  {
    operation: COMPANY_SETTINGS_READ_OPERATION,
    handler: companySettingsReadRoute,
    input: {
      path: `/org/companies/${COMPANY_A1}/settings`,
      params: { companyId: COMPANY_A1 },
    },
  },
  {
    operation: COMPANY_SETTINGS_WRITE_OPERATION,
    handler: companySettingsWriteRoute,
    input: {
      path: `/org/companies/${COMPANY_A1}/settings`,
      method: 'POST',
      params: { companyId: COMPANY_A1 },
      body: { settingKey: 'fx_p24.denied', settingValue: 'no', valueType: 'string' },
      idempotencyKey: randomUUID(),
    },
  },
  {
    operation: BRANCH_SETTINGS_READ_OPERATION,
    handler: branchSettingsReadRoute,
    input: { path: `/org/branches/${BRANCH_A1}/settings`, params: { branchId: BRANCH_A1 } },
  },
  {
    operation: BRANCH_SETTINGS_WRITE_OPERATION,
    handler: branchSettingsWriteRoute,
    input: {
      path: `/org/branches/${BRANCH_A1}/settings`,
      method: 'POST',
      params: { branchId: BRANCH_A1 },
      body: { settingKey: 'fx_p24.denied', settingValue: 'no', valueType: 'string' },
      idempotencyKey: randomUUID(),
    },
  },
];

/**
 * The 39 operation ids this suite covers, as literal strings in EXECUTABLE code.
 *
 * The denial table is keyed by imported `RegisteredOperation` constants, which is
 * the right call for type safety — a wrong name is a compile error. But it means
 * the id strings would otherwise appear only inside comments, and
 * `scripts/check-operation-test-coverage.mjs` strips comments before asking whether
 * a named evidence file actually references the operation. A suite whose ids live
 * only in prose does not reference anything; the strict rule is right to say so, and
 * it caught this within one run of adding the file to the manifest.
 *
 * So the ids are here, in code, and the three-way assertion below is what stops the
 * list being a second source of truth: registry ⟷ this array ⟷ the denial table.
 * Any one of the three drifting turns the suite red.
 */
const P1_24_AUTHENTICATED_IDS = [
  'iam.approval-limit-create',
  'iam.approval-limit-end',
  'iam.approval-limit-list',
  'iam.audit-event-detail',
  'iam.audit-event-list',
  'iam.auth-session',
  'iam.branch-settings-read',
  'iam.branch-settings-write',
  'iam.company-settings-read',
  'iam.company-settings-write',
  'iam.grant-issue',
  'iam.grant-revoke',
  'iam.grant-scope-add',
  'iam.grant-scope-list',
  'iam.grant-scope-remove',
  'iam.invitation-activate',
  'iam.invitation-cancel',
  'iam.invitation-create',
  'iam.permission-list',
  'iam.role-create',
  'iam.role-list',
  'iam.role-permission-add',
  'iam.role-permission-list',
  'iam.role-permission-remove',
  'iam.role-permission-update',
  'iam.role-update',
  'iam.tenant-settings-read',
  'iam.tenant-settings-update',
  'iam.user-detail',
  'iam.user-list',
  'iam.user-session-list',
  'iam.user-session-revoke-all',
  'iam.user-status-change',
  'iam.user-update',
  'meta.ping',
] as const;

/** The four unauthenticated ones, for the same reason. */
const P1_24_PUBLIC_IDS = [
  'iam.auth-login',
  'iam.auth-logout',
  'iam.auth-password-reset',
  'iam.auth-password-reset-completion',
] as const;

describe('P1-24 — the denial table covers the whole iam./meta. surface', () => {
  it('names every authenticated operation in the namespace exactly once', () => {
    const registered = allOperations()
      .filter((operation) => operation.id.startsWith('iam.') || operation.id.startsWith('meta.'))
      .filter((operation) => !operation.public)
      .map((operation) => operation.id)
      .sort();
    const tabled = denialCases.map((entry) => entry.operation.id).sort();

    expect(tabled).toEqual(registered);
    expect([...P1_24_AUTHENTICATED_IDS].sort()).toEqual(registered);
    expect(new Set(tabled).size).toBe(tabled.length);
  });

  it('the two id lists together are the whole namespace', () => {
    const registered = allOperations()
      .filter((operation) => operation.id.startsWith('iam.') || operation.id.startsWith('meta.'))
      .map((operation) => operation.id)
      .sort();
    expect([...P1_24_AUTHENTICATED_IDS, ...P1_24_PUBLIC_IDS].sort()).toEqual(registered);
  });
});

describe('P1-24-SEC-001 — a caller without the declared permission is refused at the route', () => {
  for (const entry of denialCases) {
    it(`${entry.operation.id} refuses a caller holding no permissions`, async () => {
      asUnpermitted();
      const response = await call<ProblemBody>(entry.handler, entry.input);

      // 403, not 404 and not 500: the caller is authenticated and identified,
      // and the refusal is about permission. A 404 here would mean the handler
      // body ran far enough to look the row up before deciding — which would
      // also leak existence.
      expect(response.status).toBe(403);
      expect(response.body?.code).toBe('ERR-IAM-001');

      // The document publishes the operation's DECLARED codes — deliberately, as
      // documented API metadata already present in OpenAPI. What it must never
      // publish is the caller's own gap, and the two are only distinguishable on
      // a conjunction operation (see the disclosure test below). Pinning the
      // exact declared set here is what makes narrowing it to the failed subset
      // a test failure rather than a silent behaviour change.
      const declared = entry.operation.permissions;
      expect([...(response.body?.requiredPermissions ?? [])].sort()).toEqual([...declared].sort());

      // No resource identifier anywhere: the catalog entry for ERR-IAM-001
      // promises the response never reveals whether the target exists.
      const document = JSON.stringify(response.body);
      for (const id of [U24_TARGET, ROLE24_TARGET, GRANT24_SCOPED, COMPANY_A1, BRANCH_A1]) {
        expect(document).not.toContain(id);
      }
    });
  }
});

describe('P1-24-BE-005 — the public auth routes answer with no authenticator at all', () => {
  const publicCases = [
    { operation: LOGIN_OPERATION, handler: loginRoute, path: '/auth/login', body: {} },
    { operation: LOGOUT_OPERATION, handler: logoutRoute, path: '/auth/logout', body: {} },
    {
      operation: PASSWORD_RESET_OPERATION,
      handler: passwordResetRoute,
      path: '/auth/password-reset',
      body: {},
    },
    {
      operation: PASSWORD_RESET_COMPLETION_OPERATION,
      handler: passwordResetCompletionRoute,
      path: '/auth/password-reset/completion',
      body: {},
    },
  ] as const;

  it('the four public operations are exactly the ones the registry marks public', () => {
    const registered = allOperations()
      .filter((operation) => operation.id.startsWith('iam.') || operation.id.startsWith('meta.'))
      .filter((operation) => operation.public)
      .map((operation) => operation.id)
      .sort();
    expect(publicCases.map((entry) => entry.operation.id).sort()).toEqual(registered);
    expect([...P1_24_PUBLIC_IDS].sort()).toEqual(registered);
  });

  for (const entry of publicCases) {
    it(`${entry.operation.id} runs its handler with no session installed`, async () => {
      asNobody();
      const response = await call<ProblemBody>(entry.handler, {
        path: entry.path,
        method: 'POST',
        body: entry.body,
      });

      // An empty body is refused by VALIDATION or answered on its merits —
      // either proves the handler body ran. What must never happen is a refusal
      // from the AUTHENTICATION or AUTHORIZATION gate, because a caller reaching
      // these routes has no session by definition and `public: true` is exactly
      // the promise that neither gate applies.
      expect(response.body?.code).not.toBe('ERR-IAM-001');
      expect(response.body?.code).not.toBe('ERR-IAM-002');
    });

    /**
     * P1-24-F-002 — the regression that motivated the fix.
     *
     * `handleOperation` dispatched public operations with `return
     * handlePublic(...)` inside its own `try`. In an async function that hands
     * the rejection to the CALLER rather than to the enclosing `catch`, so a
     * thrown `AppFailure` escaped the pipeline: the route rejected instead of
     * answering, which in Next.js is a framework 500 with no problem document,
     * no `x-correlation-id`, no `errorCount` metric and no failure log.
     *
     * This asserts the route RESOLVES. Without the `await` it rejects, and the
     * assertion below is never reached — the test fails on the rejection itself.
     */
    it(`${entry.operation.id} answers a canonical problem document rather than rejecting`, async () => {
      asNobody();
      // A body that cannot satisfy any of the four schemas, so every one of them
      // throws from inside the handler.
      //
      // The rejection is CAUGHT rather than allowed to propagate, so that a
      // regression produces an assertion failure instead of an unhandled throw. The
      // difference matters to the mutation matrix, which treats a crash as STILLBORN:
      // a mutant that makes the route reject has to fail an assertion to count.
      const outcome = await call<ProblemBody>(entry.handler, {
        path: entry.path,
        method: 'POST',
        body: { unexpected: '/'.repeat(4) },
      }).then(
        (value) => ({ resolved: true as const, value }),
        (error: unknown) => ({ resolved: false as const, error })
      );

      expect(outcome.resolved).toBe(true);
      if (!outcome.resolved) return;
      const response = outcome.value;

      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.headers.get('x-correlation-id')).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      );
      // Whatever the outcome, it arrived as a Response — not as a rejection.
      if (response.status >= 400) {
        expect(response.body?.code).toMatch(/^ERR-[A-Z]{3}-\d{3}$/);
        expect(response.body?.status).toBe(response.status);
      }
    });
  }
});

describe('P1-24-SEC-003 — a denial never discloses which half of a conjunction failed', () => {
  /**
   * `iam.user-status-change` declares TWO codes. The partial caller holds
   * `iam.user.manage` and not `iam.session.view_all`, so a document naming only
   * the failed code would tell an attacker precisely which permission they
   * already have — a probe that maps out the caller's own grant one endpoint at
   * a time. The document must name the operation's declared set, unchanged.
   */
  it('lists both declared codes for a caller holding exactly one of them', async () => {
    asPartial();
    const response = await call<ProblemBody>(userStatusRoute, {
      path: `/iam/users/${U24_TARGET}/status`,
      method: 'POST',
      params: { userId: U24_TARGET },
      body: { status: 'locked', reason: 'p1-24 disclosure probe' },
      idempotencyKey: randomUUID(),
    });

    expect(response.status).toBe(403);
    expect(response.body?.code).toBe('ERR-IAM-001');
    expect([...(response.body?.requiredPermissions ?? [])].sort()).toEqual([
      'iam.session.view_all',
      'iam.user.manage',
    ]);
  });

  it('the partial caller really does hold one of the two — the grant is the difference', async () => {
    asPartial();
    // Same caller, an operation needing only the code they DO hold, succeeds.
    const response = await call<{ userId?: string }>(invitationCreateRoute, {
      path: '/iam/invitations',
      method: 'POST',
      body: {
        email: `fx-p24-partial-${randomUUID().slice(0, 8)}@example.test`,
        displayName: 'P1-24 Partial Invitee',
      },
      idempotencyKey: randomUUID(),
    });
    expect([200, 201]).toContain(response.status);
  });
});

describe('P1-24-QA-002 — the read surface answers on the runtime identity', () => {
  it('meta.ping answers 200 for a permitted caller', async () => {
    asAdmin();
    const response = await call<{ tenantId?: string }>(pingRoute, { path: '/meta/ping' });
    expect(response.status).toBe(200);
  });

  it('iam.auth-session describes the caller, not another account', async () => {
    asAdmin();
    const response = await call<{ userId?: string; tenantId?: string }>(sessionRoute, {
      path: '/auth/session',
    });
    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).toContain(U24_ADMIN);
  });

  it('iam.user-list returns tenant-A accounts and no tenant-B account', async () => {
    asAdmin();
    const response = await call<{ items: { id: string }[] }>(userListRoute, {
      path: '/iam/users',
      query: { limit: '100' },
    });
    expect(response.status).toBe(200);
    const ids = response.body.items.map((item) => item.id);
    expect(ids).toContain(U24_TARGET);
    expect(ids).not.toContain(U24_TARGET_B);
  });

  it('iam.user-detail returns the addressed tenant-A account', async () => {
    asAdmin();
    const response = await call<{ id: string }>(userDetailRoute, {
      path: `/iam/users/${U24_TARGET}`,
      params: { userId: U24_TARGET },
    });
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(U24_TARGET);
  });

  it('iam.user-session-list answers for a tenant-A account', async () => {
    asAdmin();
    const response = await call<{ items: unknown[] }>(userSessionListRoute, {
      path: `/iam/users/${U24_TARGET}/sessions`,
      params: { userId: U24_TARGET },
    });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it('iam.permission-list returns the seeded catalog', async () => {
    asAdmin();
    const response = await call<{ items: { permissionCode: string }[] }>(permissionListRoute, {
      path: '/iam/permissions',
    });
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBeGreaterThan(0);
  });

  it('iam.role-list returns tenant-A roles and no tenant-B role', async () => {
    asAdmin();
    const response = await call<{ items: { id: string }[] }>(roleListRoute, {
      path: '/iam/roles',
      query: { limit: '100' },
    });
    expect(response.status).toBe(200);
    const ids = response.body.items.map((item) => item.id);
    expect(ids).toContain(ROLE24_TARGET);
    expect(ids).not.toContain(ROLE24_TARGET_B);
  });

  it('iam.role-permission-list answers for a tenant-A role', async () => {
    asAdmin();
    const response = await call<{ items: unknown[] }>(rolePermissionListRoute, {
      path: `/iam/roles/${ROLE24_A}/permissions`,
      params: { roleId: ROLE24_A },
    });
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBe(PERMISSIONS24.length);
  });

  it('iam.grant-scope-list returns the narrowed grant’s two scopes', async () => {
    asAdmin();
    const response = await call<{ items: unknown[] }>(grantScopeListRoute, {
      path: `/iam/grants/${GRANT24_SCOPED}/scopes`,
      params: { grantId: GRANT24_SCOPED },
    });
    expect(response.status).toBe(200);
    expect(response.body.items.length).toBe(2);
  });

  it('iam.approval-limit-list answers on the runtime identity', async () => {
    asAdmin();
    const response = await call<{ items: unknown[] }>(approvalLimitListRoute, {
      path: '/iam/approval-limits',
    });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it('iam.tenant-settings-read returns the caller’s own tenant', async () => {
    asAdmin();
    const response = await call<{ id: string }>(tenantReadRoute, { path: '/org/tenant' });
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(TENANT_A);
  });

  it('iam.company-settings-read answers for an in-scope company', async () => {
    asAdmin();
    const response = await call<{ items: unknown[] }>(companySettingsReadRoute, {
      path: `/org/companies/${COMPANY_A1}/settings`,
      params: { companyId: COMPANY_A1 },
    });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
  });

  it('iam.branch-settings-read answers for an in-scope branch', async () => {
    asAdmin();
    const response = await call<{ items: unknown[] }>(branchSettingsReadRoute, {
      path: `/org/branches/${BRANCH_A1}/settings`,
      params: { branchId: BRANCH_A1 },
    });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
  });
});

describe('P1-24-BE-010 — a privileged read of the audit trail is itself audited', () => {
  it('iam.audit-event-list records exactly one iam.audit.viewed and returns a page', async () => {
    asAdmin();
    const before = await auditCount('iam.audit.viewed');
    const response = await call<{ items: { id: string }[] }>(auditEventListRoute, {
      path: '/audit-events',
      query: {
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date(Date.now() + 86_400_000).toISOString(),
        limit: '5',
      },
    });
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.items)).toBe(true);
    expect(await auditCount('iam.audit.viewed')).toBe(before + 1);
  });

  it('iam.audit-event-detail reads one record and records its own view', async () => {
    asAdmin();
    // A record produced by this suite's own listing call, addressed by id.
    const recordId = await scalar<string>(
      `SELECT id FROM iam.audit_records
        WHERE tenant_id = $1 AND action = 'iam.audit.viewed'
        ORDER BY occurred_at DESC LIMIT 1`,
      [TENANT_A]
    );
    expect(recordId).toBeTruthy();

    const before = await auditCount('iam.audit.viewed');
    const response = await call<{ id: string }>(auditEventDetailRoute, {
      path: `/audit-events/${recordId}`,
      params: { recordId: recordId as string },
    });
    expect(response.status).toBe(200);
    expect(response.body.id).toBe(recordId);
    expect(await auditCount('iam.audit.viewed')).toBe(before + 1);
  });
});

describe('P1-24-QA-003 — a real row in the other tenant is unreachable', () => {
  /**
   * Bidirectional and against REAL rows. Tenant B has its own administrator, its
   * own role, its own grant and its own company and branch, so "tenant A cannot
   * reach it" is a statement about data that genuinely exists — not about an
   * identifier that would be missing for either caller.
   */
  const notFound = [404, 403];

  it('iam.user-detail cannot read tenant B’s user', async () => {
    asAdmin();
    const response = await call<ProblemBody>(userDetailRoute, {
      path: `/iam/users/${U24_TARGET_B}`,
      params: { userId: U24_TARGET_B },
    });
    expect(notFound).toContain(response.status);
    expect(JSON.stringify(response.body)).not.toContain('fx-p24-rt-target-b@example.test');
  });

  it('iam.user-detail cannot be read from tenant B either', async () => {
    asAdminB();
    const response = await call<ProblemBody>(userDetailRoute, {
      path: `/iam/users/${U24_TARGET}`,
      params: { userId: U24_TARGET },
    });
    expect(notFound).toContain(response.status);
  });

  it('iam.user-session-list cannot read tenant B’s sessions', async () => {
    asAdmin();
    const response = await call<ProblemBody>(userSessionListRoute, {
      path: `/iam/users/${U24_TARGET_B}/sessions`,
      params: { userId: U24_TARGET_B },
    });
    expect(notFound).toContain(response.status);
  });

  it('iam.user-session-revoke-all cannot revoke tenant B’s sessions', async () => {
    asAdmin();
    const response = await call<ProblemBody>(userSessionRevokeRoute, {
      path: `/iam/users/${U24_TARGET_B}/sessions`,
      method: 'DELETE',
      params: { userId: U24_TARGET_B },
      body: { reason: 'p1-24 cross-tenant probe' },
    });
    expect(notFound).toContain(response.status);
  });

  it('iam.user-update cannot rename tenant B’s user', async () => {
    asAdmin();
    const before = await scalar<string>(
      'SELECT display_name FROM iam.user_accounts WHERE id = $1',
      [U24_TARGET_B]
    );
    const response = await call<ProblemBody>(userUpdateRoute, {
      path: `/iam/users/${U24_TARGET_B}`,
      method: 'PATCH',
      params: { userId: U24_TARGET_B },
      body: { displayName: 'Crossed over' },
      ifMatch: 1,
    });
    expect(notFound).toContain(response.status);
    expect(
      await scalar<string>('SELECT display_name FROM iam.user_accounts WHERE id = $1', [
        U24_TARGET_B,
      ])
    ).toBe(before);
  });

  it('iam.user-status-change cannot suspend tenant B’s user', async () => {
    asAdmin();
    const response = await call<ProblemBody>(userStatusRoute, {
      path: `/iam/users/${U24_TARGET_B}/status`,
      method: 'POST',
      params: { userId: U24_TARGET_B },
      body: { status: 'locked', reason: 'p1-24 cross-tenant probe' },
      idempotencyKey: randomUUID(),
    });
    expect(notFound).toContain(response.status);
    expect(
      await scalar<string>('SELECT status FROM iam.user_accounts WHERE id = $1', [U24_TARGET_B])
    ).toBe('active');
  });

  it('iam.invitation-cancel cannot cancel tenant B’s account', async () => {
    asAdmin();
    const response = await call<ProblemBody>(invitationCancelRoute, {
      path: `/iam/invitations/${U24_TARGET_B}`,
      method: 'DELETE',
      params: { userId: U24_TARGET_B },
      body: { reason: 'p1-24 cross-tenant probe' },
    });
    expect(notFound).toContain(response.status);
  });

  it('iam.invitation-activate cannot activate tenant B’s account', async () => {
    asAdmin();
    const response = await call<ProblemBody>(invitationActivateRoute, {
      path: `/iam/invitations/${U24_TARGET_B}/activation`,
      method: 'POST',
      params: { userId: U24_TARGET_B },
      body: { reason: 'p1-24 cross-tenant probe' },
      idempotencyKey: randomUUID(),
    });
    expect(notFound).toContain(response.status);
  });

  it('iam.role-permission-list cannot read tenant B’s role', async () => {
    asAdmin();
    const response = await call<{ items?: unknown[] } & ProblemBody>(rolePermissionListRoute, {
      path: `/iam/roles/${ROLE24_B}/permissions`,
      params: { roleId: ROLE24_B },
    });
    // Either refusal or an empty page is acceptable — what must not happen is
    // tenant B's twelve mappings appearing in a tenant-A response.
    if (response.status === 200) expect(response.body.items).toEqual([]);
    else expect(notFound).toContain(response.status);
  });

  it('iam.role-update cannot rename tenant B’s role', async () => {
    asAdmin();
    const before = await scalar<string>('SELECT name FROM iam.roles WHERE id = $1', [
      ROLE24_TARGET_B,
    ]);
    const response = await call<ProblemBody>(roleUpdateRoute, {
      path: `/iam/roles/${ROLE24_TARGET_B}`,
      method: 'PATCH',
      params: { roleId: ROLE24_TARGET_B },
      body: { name: 'Crossed over' },
      ifMatch: 1,
    });
    expect(notFound).toContain(response.status);
    expect(
      await scalar<string>('SELECT name FROM iam.roles WHERE id = $1', [ROLE24_TARGET_B])
    ).toBe(before);
  });

  it('iam.role-permission-add cannot extend tenant B’s role', async () => {
    asAdmin();
    const before = await countRows(admin, 'iam.role_permissions', 'role_id = $1', [
      ROLE24_TARGET_B,
    ]);
    const response = await call<ProblemBody>(rolePermissionAddRoute, {
      path: `/iam/roles/${ROLE24_TARGET_B}/permissions`,
      method: 'POST',
      params: { roleId: ROLE24_TARGET_B },
      body: { permissionCode: 'iam.user.read', effect: 'allow' },
      idempotencyKey: randomUUID(),
    });
    expect(notFound).toContain(response.status);
    expect(await countRows(admin, 'iam.role_permissions', 'role_id = $1', [ROLE24_TARGET_B])).toBe(
      before
    );
  });

  it('iam.role-permission-update and -remove cannot reach tenant B’s mapping', async () => {
    const mappingId = await scalar<string>(
      'SELECT id FROM iam.role_permissions WHERE role_id = $1 LIMIT 1',
      [ROLE24_B]
    );
    expect(mappingId).toBeTruthy();
    const before = await countRows(admin, 'iam.role_permissions', 'role_id = $1', [ROLE24_B]);

    asAdmin();
    const updated = await call<ProblemBody>(rolePermissionUpdateRoute, {
      path: `/iam/roles/${ROLE24_B}/permissions/${mappingId}`,
      method: 'PATCH',
      params: { roleId: ROLE24_B, mappingId: mappingId as string },
      body: { effect: 'deny' },
      ifMatch: 1,
    });
    expect(notFound).toContain(updated.status);

    const removed = await call<ProblemBody>(rolePermissionRemoveRoute, {
      path: `/iam/roles/${ROLE24_B}/permissions/${mappingId}`,
      method: 'DELETE',
      params: { roleId: ROLE24_B, mappingId: mappingId as string },
    });
    expect(notFound).toContain(removed.status);
    expect(await countRows(admin, 'iam.role_permissions', 'role_id = $1', [ROLE24_B])).toBe(before);
  });

  it('iam.grant-revoke cannot revoke tenant B’s grant, and audits nothing', async () => {
    asAdmin();
    const beforeAudit = await auditCount('iam.grant.revoked', TENANT_B);
    const response = await call<ProblemBody>(grantRevokeRoute, {
      path: `/iam/grants/${GRANT24_TARGET_B}`,
      method: 'DELETE',
      params: { grantId: GRANT24_TARGET_B },
      body: { reason: 'p1-24 cross-tenant probe' },
      ifMatch: 1,
    });
    expect(notFound).toContain(response.status);
    expect(
      await scalar<string>('SELECT status FROM iam.role_grants WHERE id = $1', [GRANT24_TARGET_B])
    ).toBe('active');
    expect(await auditCount('iam.grant.revoked', TENANT_B)).toBe(beforeAudit);
  });

  it('iam.grant-scope-list and -add cannot reach tenant B’s grant', async () => {
    asAdmin();
    const listed = await call<{ items?: unknown[] } & ProblemBody>(grantScopeListRoute, {
      path: `/iam/grants/${GRANT24_TARGET_B}/scopes`,
      params: { grantId: GRANT24_TARGET_B },
    });
    if (listed.status === 200) expect(listed.body.items).toEqual([]);
    else expect(notFound).toContain(listed.status);

    const before = await countRows(admin, 'iam.grant_scopes', 'grant_id = $1', [GRANT24_TARGET_B]);
    const added = await call<ProblemBody>(grantScopeAddRoute, {
      path: `/iam/grants/${GRANT24_TARGET_B}/scopes`,
      method: 'POST',
      params: { grantId: GRANT24_TARGET_B },
      body: { scopeType: 'company', companyId: COMPANY24_B },
      idempotencyKey: randomUUID(),
    });
    expect(notFound).toContain(added.status);
    expect(await countRows(admin, 'iam.grant_scopes', 'grant_id = $1', [GRANT24_TARGET_B])).toBe(
      before
    );
  });

  it('iam.grant-scope-remove cannot remove tenant B’s scope, and audits nothing', async () => {
    // Tenant B's admin narrows its own grant first, through the real route, so
    // the scope tenant A then tries to remove is a row an authorized caller made.
    asAdminB();
    const created = await call<{ id?: string; scopeId?: string }>(grantScopeAddRoute, {
      path: `/iam/grants/${GRANT24_TARGET_B}/scopes`,
      method: 'POST',
      params: { grantId: GRANT24_TARGET_B },
      body: { scopeType: 'company', companyId: COMPANY24_B },
      idempotencyKey: randomUUID(),
    });
    expect([200, 201]).toContain(created.status);
    const scopeId = await scalar<string>(
      'SELECT id FROM iam.grant_scopes WHERE grant_id = $1 LIMIT 1',
      [GRANT24_TARGET_B]
    );
    expect(scopeId).toBeTruthy();

    asAdmin();
    const beforeAudit = await auditCount('iam.grant.scope_removed', TENANT_B);
    const response = await call<ProblemBody>(grantScopeRemoveRoute, {
      path: `/iam/grants/${GRANT24_TARGET_B}/scopes/${scopeId}`,
      method: 'DELETE',
      params: { grantId: GRANT24_TARGET_B, scopeId: scopeId as string },
    });
    expect(notFound).toContain(response.status);
    expect(await countRows(admin, 'iam.grant_scopes', 'id = $1', [scopeId])).toBe(1);
    expect(await auditCount('iam.grant.scope_removed', TENANT_B)).toBe(beforeAudit);
  });

  it('iam.approval-limit-end cannot end tenant B’s limit', async () => {
    asAdminB();
    const created = await call<{ id: string }>(approvalLimitCreateRoute, {
      path: '/iam/approval-limits',
      method: 'POST',
      body: {
        companyId: COMPANY24_B,
        userId: U24_TARGET_B,
        limitType: 'fx_p24_cross',
        amount: '5.0000',
        currency: 'USD',
        effectiveFrom: DATE_FROM,
      },
      idempotencyKey: randomUUID(),
    });
    expect([200, 201]).toContain(created.status);
    const limitId = created.body.id;

    asAdmin();
    const response = await call<ProblemBody>(approvalLimitEndRoute, {
      path: `/iam/approval-limits/${limitId}`,
      method: 'PATCH',
      params: { limitId },
      body: { effectiveTo: DATE_TO },
      ifMatch: 1,
    });
    expect(notFound).toContain(response.status);
  });

  it('iam.audit-event-detail cannot read a tenant-B audit record', async () => {
    asAdminB();
    await call(auditEventListRoute, {
      path: '/audit-events',
      query: {
        from: new Date(Date.now() - 86_400_000).toISOString(),
        to: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    const recordId = await scalar<string>(
      `SELECT id FROM iam.audit_records WHERE tenant_id = $1 ORDER BY occurred_at DESC LIMIT 1`,
      [TENANT_B]
    );
    expect(recordId).toBeTruthy();

    asAdmin();
    const response = await call<ProblemBody>(auditEventDetailRoute, {
      path: `/audit-events/${recordId}`,
      params: { recordId: recordId as string },
    });
    expect(notFound).toContain(response.status);
  });

  it('iam.company-settings-read and -write cannot reach tenant B’s company', async () => {
    asAdmin();
    const read = await call<ProblemBody>(companySettingsReadRoute, {
      path: `/org/companies/${COMPANY24_B}/settings`,
      params: { companyId: COMPANY24_B },
    });
    expect(notFound).toContain(read.status);

    const before = await countRows(admin, 'org.company_settings', 'company_id = $1', [COMPANY24_B]);
    const written = await call<ProblemBody>(companySettingsWriteRoute, {
      path: `/org/companies/${COMPANY24_B}/settings`,
      method: 'POST',
      params: { companyId: COMPANY24_B },
      body: { settingKey: 'fx_p24.crossed', settingValue: 'no', valueType: 'string' },
      idempotencyKey: randomUUID(),
    });
    expect(notFound).toContain(written.status);
    expect(await countRows(admin, 'org.company_settings', 'company_id = $1', [COMPANY24_B])).toBe(
      before
    );
  });

  it('iam.branch-settings-read and -write cannot reach tenant B’s branch', async () => {
    asAdmin();
    const read = await call<ProblemBody>(branchSettingsReadRoute, {
      path: `/org/branches/${BRANCH24_B}/settings`,
      params: { branchId: BRANCH24_B },
    });
    expect(notFound).toContain(read.status);

    const before = await countRows(admin, 'org.branch_settings', 'branch_id = $1', [BRANCH24_B]);
    const written = await call<ProblemBody>(branchSettingsWriteRoute, {
      path: `/org/branches/${BRANCH24_B}/settings`,
      method: 'POST',
      params: { branchId: BRANCH24_B },
      body: { settingKey: 'fx_p24.crossed', settingValue: 'no', valueType: 'string' },
      idempotencyKey: randomUUID(),
    });
    expect(notFound).toContain(written.status);
    expect(await countRows(admin, 'org.branch_settings', 'branch_id = $1', [BRANCH24_B])).toBe(
      before
    );
  });
});

describe('P1-24-QA-003 — a caller narrowed by grant scope is refused out of scope', () => {
  /**
   * The scoped caller holds every permission the unscoped one holds. The ONLY
   * difference is the narrowing, so a difference in outcome can only be the
   * scope check — which is what makes this evidence rather than a coincidence.
   */
  it('the scoped caller reads the in-scope company and is refused the other one', async () => {
    asScoped();
    const allowed = await call<{ items: unknown[] }>(companySettingsReadRoute, {
      path: `/org/companies/${COMPANY_A1}/settings`,
      params: { companyId: COMPANY_A1 },
    });
    expect(allowed.status).toBe(200);

    const refused = await call<ProblemBody>(companySettingsReadRoute, {
      path: `/org/companies/${COMPANY24_OUT}/settings`,
      params: { companyId: COMPANY24_OUT },
    });
    expect(refused.status).toBe(403);
  });

  it('the same company is readable by the unscoped caller — the narrowing is the difference', async () => {
    asAdmin();
    const response = await call<{ items: unknown[] }>(companySettingsReadRoute, {
      path: `/org/companies/${COMPANY24_OUT}/settings`,
      params: { companyId: COMPANY24_OUT },
    });
    expect(response.status).toBe(200);
  });

  it('the scoped caller reads the in-scope branch and is refused the other one', async () => {
    asScoped();
    const allowed = await call<{ items: unknown[] }>(branchSettingsReadRoute, {
      path: `/org/branches/${BRANCH_A1}/settings`,
      params: { branchId: BRANCH_A1 },
    });
    expect(allowed.status).toBe(200);

    const refused = await call<ProblemBody>(branchSettingsReadRoute, {
      path: `/org/branches/${BRANCH24_OUT}/settings`,
      params: { branchId: BRANCH24_OUT },
    });
    expect(refused.status).toBe(403);
  });

  it('the scoped caller cannot WRITE settings outside its scope', async () => {
    asScoped();
    const beforeCompany = await countRows(admin, 'org.company_settings', 'company_id = $1', [
      COMPANY24_OUT,
    ]);
    const company = await call<ProblemBody>(companySettingsWriteRoute, {
      path: `/org/companies/${COMPANY24_OUT}/settings`,
      method: 'POST',
      params: { companyId: COMPANY24_OUT },
      body: { settingKey: 'fx_p24.out_of_scope', settingValue: 'no', valueType: 'string' },
      idempotencyKey: randomUUID(),
    });
    expect(company.status).toBe(403);
    expect(await countRows(admin, 'org.company_settings', 'company_id = $1', [COMPANY24_OUT])).toBe(
      beforeCompany
    );

    const beforeBranch = await countRows(admin, 'org.branch_settings', 'branch_id = $1', [
      BRANCH24_OUT,
    ]);
    const branch = await call<ProblemBody>(branchSettingsWriteRoute, {
      path: `/org/branches/${BRANCH24_OUT}/settings`,
      method: 'POST',
      params: { branchId: BRANCH24_OUT },
      body: { settingKey: 'fx_p24.out_of_scope', settingValue: 'no', valueType: 'string' },
      idempotencyKey: randomUUID(),
    });
    expect(branch.status).toBe(403);
    expect(await countRows(admin, 'org.branch_settings', 'branch_id = $1', [BRANCH24_OUT])).toBe(
      beforeBranch
    );
  });
});

describe('P1-24-BE-002 — the administrative write surface answers on the route', () => {
  it('iam.role-create then iam.grant-issue then iam.approval-limit-create all succeed', async () => {
    asAdmin();
    const roleCode = `fx_p24_rt_${randomUUID().slice(0, 8)}`;
    const role = await call<{ id: string }>(roleCreateRoute, {
      path: '/iam/roles',
      method: 'POST',
      body: { roleCode, name: 'P1-24 route-created role' },
      idempotencyKey: randomUUID(),
    });
    expect([200, 201]).toContain(role.status);

    const grant = await call<{ id: string }>(grantIssueRoute, {
      path: '/iam/grants',
      method: 'POST',
      body: { userId: U24_TARGET, roleId: role.body.id },
      idempotencyKey: randomUUID(),
    });
    expect([200, 201]).toContain(grant.status);

    const limit = await call<{ id: string }>(approvalLimitCreateRoute, {
      path: '/iam/approval-limits',
      method: 'POST',
      body: {
        companyId: COMPANY_A1,
        userId: U24_TARGET,
        limitType: 'fx_p24_success',
        amount: '7.5000',
        currency: 'USD',
        effectiveFrom: DATE_FROM,
      },
      idempotencyKey: randomUUID(),
    });
    expect([200, 201]).toContain(limit.status);
  });

  it('iam.invitation-create answers on the route', async () => {
    asAdmin();
    const response = await call<{ userId?: string; id?: string }>(invitationCreateRoute, {
      path: '/iam/invitations',
      method: 'POST',
      body: {
        email: `fx-p24-invite-${randomUUID().slice(0, 8)}@example.test`,
        displayName: 'P1-24 Route Invitee',
      },
      idempotencyKey: randomUUID(),
    });
    expect([200, 201]).toContain(response.status);
  });
});
