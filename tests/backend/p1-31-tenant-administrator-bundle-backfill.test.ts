/**
 * P1-31 — the tenant administrator bundle backfill, proved on real rows
 * (Owner decision **D-2** of 2026-09-08; P1-31 CC-11, closing CC-03 and CC-08).
 *
 * `scripts/platform/backfill-tenant-administrator-bundle.mjs` is the one
 * sanctioned way an EXISTING organisation's administrator role is brought up to
 * the current `TENANT_ADMINISTRATOR_ROLE.permissionCodes`. It is driven here as
 * a module on the admin connection — the same privileged connection an operator
 * would use — and its properties are asserted rather than described.
 *
 * ## Why a privileged connection, and why that is the whole argument
 *
 * `ins_role_permissions_platform_bootstrap` (20260831093000) is the only policy
 * admitting the platform role to `iam.role_permissions`, and its WITH CHECK
 * requires `org.tenants.status = 'provisioning'`. Every organisation this
 * backfill exists for is `active`, and the table is FORCE ROW LEVEL SECURITY.
 * A route would be refused by the database; publishing one would need a
 * migration widening that policy permanently. BF-9 measures the refusal rather
 * than asserting it, so the choice of mechanism is falsifiable.
 *
 * ## The five obligations, one test each
 *
 *   BF-1  an organisation on the OLD bundle gains exactly the missing codes and
 *         no others, and every mapping row it already had survives by id
 *   BF-2  running it again changes nothing: `unchanged`, no row, no audit record
 *   BF-3  a role customised beyond the bundle is NOT WRITTEN AT ALL — every row
 *         it had survives by id, it gains nothing (not even the codes it lacks),
 *         and it is reported as `customised` with each reason (the Owner's rule
 *         recorded with the `sal.credit.manage` widening: never overwrite a
 *         customised role)
 *   BF-4  after the backfill a principal of that organisation performs reads the
 *         stale bundle refused, including `wty.warranty-detail` — the read the
 *         P-7 re-pointing took away (CC-08)
 *   BF-5  no other tenant is touched: a second stale organisation is unchanged,
 *         row for row, and gains no audit record
 *
 * and four more that hold the mechanism honest:
 *
 *   BF-6  the authority gate is real: an account without
 *         `platform.organization.provision` is refused, and no code is minted
 *   BF-7  the bundle the tool widens to is the CONSTANT the provisioning path
 *         writes — the parser and the import agree, so the two cannot drift
 *   BF-8  additive only, structurally: the script issues no DELETE and no
 *         UPDATE, and a dry run leaves the database exactly as it found it
 *   BF-9  a route could not do this — the platform INSERT policy refuses an
 *         active tenant, which is why no migration is added
 *   BF-10 the claim that a widening needs no edit to the script, measured for the
 *         Owner directive of 2026-09-17: an organisation on the 85-code bundle is
 *         offered EXACTLY the codes widened since — that directive's three and
 *         `sal.credit.manage` — by a dry run that writes nothing, and then by the
 *         applied run
 *   BF-11 the `sal.credit.manage` widening: an organisation on the 88-code bundle
 *         is offered exactly that ONE code; the dry run writes nothing; the applied
 *         run adds it to the standard administrator role and to no other role — a
 *         cashier role in the same organisation is untouched — with one audit
 *         record; and a second run is a no-op
 *   BF-12 an administrator role the tenant customised through the SHIPPED role
 *         editor (a bundle code removed) is skipped and reported as
 *         `tenant-edit:iam.role.permission_removed`, one the organisation archived
 *         and re-created itself through the SHIPPED role operations as
 *         `created-inside-organisation`, and one it renamed through
 *         `iam.role-update` as `tenant-edit:iam.role.updated` — none gains
 *         `sal.credit.manage`, and none is written
 *   BF-13 the creator check fails closed and is keyed on platform authority: a
 *         role whose creator names no account is `creator-unknown`, one written
 *         by another organisation's account holding no platform grant is
 *         `creator-not-platform-operator`, and one written by a platform operator
 *         whose HOME is this very organisation is still the standard role and is
 *         widened
 *   BF-14 granting the standard role to a second account is reported
 *         (`holders`, `tenantGrantedHolders`) and is not a reason to skip
 *   BF-15 two runs against the same organisation at once: exactly one widens,
 *         the other finds nothing missing, one audit record, no failure
 *   BF-16 a run waits on the organisation's advisory lock and computes its
 *         difference only after the holder has committed
 *   BF-17 one organisation's failure is rolled back and reported as `failed`
 *         while the next organisation in the same run is widened and committed
 *
 * ## Where it runs
 *
 * On the SHARED database, like `p1-31-provisioning-bundle.test.ts`, and against
 * tenants THIS SUITE provisions through the shipped provisioning route and drops
 * afterwards. Nothing here reads or writes an organisation it did not create.
 * The stale state is constructed by removing, from the suite's own fresh
 * tenants, exactly the twenty-two codes widened onto the bundle since — which
 * reproduces the 67-code bundle those organisations really hold.
 *
 * Operations exercised: platform.organization-provision, iam.role-create,
 * iam.role-update, iam.role-permission-add, iam.role-permission-remove,
 * iam.grant-issue, wty.warranty-list, wty.warranty-detail.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  TENANT_A,
  adminPool,
  cleanBackendFixtures,
  deleteTenantCascade,
  ensureBackendFixtures,
  ensureTestLogins,
  platformAppPool,
  runtimeAppPool,
} from './helpers';
import { __resetBackendConfigForTests } from '@/server/config/backend-config';
import { __setPlatformPoolForTests, __setPrimaryPoolForTests } from '@/server/db/pool';
import {
  StaticClaimsAuthenticator,
  __resetAuthenticatorForTests,
  setSessionAuthenticator,
} from '@/server/context/principal';
import {
  FakeIdentityProvider,
  TENANT_ADMINISTRATOR_ROLE,
  setIdentityProvider,
} from '@/modules/iam';
import { __resetIdentityProviderForTests } from '@/modules/iam/provider/identity-provider';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import {
  BACKFILL_AUDIT_ACTION,
  REQUIRED_PLATFORM_CODE,
  TARGET_ROLE_CODE,
  readTenantAdministratorBundle,
  runBackfill,
  tenantLockKey,
} from '../../scripts/platform/backfill-tenant-administrator-bundle.mjs';
import { POST as organizationProvisionRoute } from '@/app/api/v1/platform/organizations/route';
import { POST as roleCreateRoute } from '@/app/api/v1/iam/roles/route';
import { PATCH as roleUpdateRoute } from '@/app/api/v1/iam/roles/[roleId]/route';
import { POST as grantIssueRoute } from '@/app/api/v1/iam/grants/route';
import { POST as rolePermissionAddRoute } from '@/app/api/v1/iam/roles/[roleId]/permissions/route';
import { DELETE as rolePermissionRemoveRoute } from '@/app/api/v1/iam/roles/[roleId]/permissions/[mappingId]/route';
import { WARRANTY_LIST_OPERATION, GET as warrantyListRoute } from '@/app/api/v1/warranties/route';
import {
  WARRANTY_DETAIL_OPERATION,
  GET as warrantyDetailRoute,
} from '@/app/api/v1/warranties/[warrantyId]/route';

/**
 * The eleven codes the five P1-31 widenings added (#322 P-1's six, #349 P-7's
 * one, P-10's one, P-11's one and P-17's two). Written out rather than derived:
 * removing these from a freshly provisioned role reproduces the 67-code bundle
 * the real organisations hold, and a list computed from the constant under test
 * would prove nothing.
 *
 * `wty.policy.manage` joined on 2026-09-09 when P-10 published the five
 * operations that declare it, closing CC-01, and `rpt.report.configure` the same
 * day when P-11 published the seven that declare it, closing CC-02. Together they
 * are the reason this backfill owes a THIRD operator run — ONE run covering both
 * codes, not one each. An organisation provisioned on the 74-code bundle can read
 * a warranty and cannot configure the policy any warranty must be issued under,
 * and can open the report catalogue and put nothing in it, because both published
 * report reads filter on published status and no other code can set that value.
 */
const P1_31_ADDED = Object.freeze([
  'sal.delivery.manage',
  'sal.delivery.view',
  'sal.delivery.complete',
  'wty.warranty.issue',
  'rpt.report.read',
  'iam.audit.view',
  'wty.warranty.read',
  'wty.policy.manage',
  'rpt.report.configure',
  // P1-31 prerequisite P-17, both MINTED by that slice. They are the reason this
  // backfill owes a FOURTH operator run: an organisation provisioned on the
  // 76-code bundle has no employee register at all, and `sal.delivery-create`
  // now refuses a delivering employee that does not exist — so without this run
  // that organisation cannot record a single handover.
  'org.employee.read',
  'org.employee.manage',
]);

/**
 * The Owner directive of 2026-09-16 carries `org.company.manage` and
 * `org.branch.manage`. The backfill reads the bundle, so it owes these two to every
 * organisation as well, and a 67-code organisation is missing all thirteen.
 */
const OWNER_DIRECTIVE_ADDED = Object.freeze(['org.company.manage', 'org.branch.manage']);

/** Every code a 67-code organisation is missing from the current bundle. */
const BACKFILLED = Object.freeze([...P1_31_ADDED, ...OWNER_DIRECTIVE_ADDED]);

/** The bundle before the five P1-31 widenings. Unchanged by all five. */
const BUNDLE_BEFORE = 67;

/**
 * The five P1-32 material codes (P1-32-PRE-134), carried after P1-31. They are the
 * reason this backfill owes a FIFTH operator run: since every reservation and issue
 * for a work order draws on an approved material requirement, an organisation
 * provisioned on the 78-code bundle cannot ask for or approve one, so it cannot issue
 * a part to a job. The run is an operator act and is not performed by the slice.
 */
const P1_32_ADDED = Object.freeze([
  'inv.material.request',
  'inv.material.approve',
  'inv.material.exception.approve',
  'inv.unit_conversion.manage',
  'inv.specification.manage',
]);

/**
 * Three of the four codes the QA campaign measured as permanently closed in every
 * platform-provisioned organisation (Owner directive 2026-09-17). They are the
 * reason this backfill owes a SIXTH operator run — ONE run covering all three, not
 * one each. An organisation provisioned on the 85-code bundle can create a work
 * order and never say what work is on it, can register a customer and never record
 * a telephone number for it, and can run a reception from check-in to conversion
 * without anyone being able to record the pre-service condition. The script reads
 * the bundle from source, so it carries these without an edit; the run is an
 * operator act and is not performed by this slice.
 *
 * The fourth code the campaign measured, `inv.cost.view`, is NOT in the bundle and
 * so is not in any backfill offer: its exclusion is a recorded decision (P1-30
 * change control CC-12, open; register gap E-14) that only the Owner may reverse.
 * BF-10 asserts its absence from the offer for that reason.
 */
const OD_QA_ADDED = Object.freeze([
  'wo.work_order.line.manage',
  'crm.customer.profile.write',
  'rec.reception.evidence.manage',
]);

/**
 * The Owner's credit-note decision: `sal.credit.manage` for the standard tenant
 * administrator. It is the reason this backfill owes a SEVENTH operator run — and the
 * first under the rule that a customised administrator role is skipped whole rather
 * than completed (BF-3, BF-12). In an organisation provisioned on the 88-code bundle a
 * customer return raises a credit note and nobody can read, request or approve one.
 */
const CREDIT_ADDED = Object.freeze(['sal.credit.manage']);

/** Every code widened onto the 67-code bundle since: what a stale organisation lacks. */
const WIDENED = Object.freeze([...BACKFILLED, ...P1_32_ADDED, ...OD_QA_ADDED, ...CREDIT_ADDED]);

/** A real catalogue code the bundle deliberately does NOT carry (P1-31 CC-04). */
const CUSTOMISATION_CODE = 'rpt.export';

/** The bundle code the customised tenant denies for itself. */
const DENIED_CODE = 'sal.delivery.complete';

const IDENTITY_PROVIDER = 'test_harness';
const SUBJECT_HOLDER = 'fx_p131bf_platform_holder';
const USER_HOLDER = 'd3110000-0000-4000-8000-00000000002a';
/** An account that exists and holds NO platform grant — BF-6's negative. */
const SUBJECT_STRANGER = 'fx_p131bf_stranger';
const USER_STRANGER = 'd3110000-0000-4000-8000-00000000002b';
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';
/** Distinct from every sibling suite's prefix: they delete tenants by prefix. */
const RUN = Math.random().toString(36).slice(2, 8);
const TENANT_PREFIX = `p31bf${RUN}`;
const HOLDER_EMAIL = `${SUBJECT_HOLDER}@fixture.test`;
const STRANGER_EMAIL = `${SUBJECT_STRANGER}@fixture.test`;

let admin: Pool;
let runtime: Pool;
let platform: Pool;

/** The bundle as the SCRIPT reads it, from `bootstrap-roles.ts`. */
const parsedBundle = readTenantAdministratorBundle();

interface CallResult<T> {
  readonly status: number;
  readonly body: T;
}
type RouteHandler = (
  request: Request,
  route: { params: Promise<Record<string, string>> }
) => Promise<Response>;

async function call<T>(
  handler: unknown,
  input: {
    readonly path: string;
    readonly method?: string;
    readonly body?: unknown;
    readonly params?: Record<string, string>;
    readonly idempotencyKey?: string;
    readonly ifMatch?: number;
  }
): Promise<CallResult<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  if (input.ifMatch !== undefined) headers['if-match'] = String(input.ifMatch);
  const init: RequestInit = { method: input.method ?? 'POST', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const request = new Request(`http://localhost/api/v1${input.path}`, init);
  const response = await (handler as RouteHandler)(request, {
    params: Promise.resolve(input.params ?? {}),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

function asHolder(): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: SUBJECT_HOLDER,
      tenantId: TENANT_A,
    })
  );
}

interface Provisioned {
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly ownerAccountId: string;
  readonly tenantAdministratorRoleId: string;
  readonly identityProvider: string;
  readonly providerSubject: string;
  readonly companyId: string;
  readonly branchId: string;
}

function asOwnerOf(tenant: Provisioned): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: tenant.identityProvider,
      providerSubject: tenant.providerSubject,
      tenantId: tenant.tenantId,
    })
  );
}

async function provision(code: string): Promise<Provisioned> {
  asHolder();
  const tenantCode = `${TENANT_PREFIX}_${code}`;
  const result = await call<{
    tenantId: string;
    ownerAccountId: string;
    tenantAdministratorRoleId: string;
  }>(organizationProvisionRoute, {
    path: '/platform/organizations',
    body: {
      tenant: {
        code: tenantCode,
        display_name: 'P1-31 backfill probe',
        locale: 'en',
        timezone: 'UTC',
      },
      company: { code: 'p31bfc', legal_name: 'P31 Backfill Ltd', base_currency: 'JOD' },
      branch: { code: 'main', name: 'Main', timezone: 'UTC' },
      owner: { email: `owner_${code}_${RUN}@fixture.test`, displayName: 'First Owner' },
      activate: true,
    },
    idempotencyKey: randomUUID(),
  });
  expect(result.status).toBe(201);
  const identity = await admin.query<{ identity_provider: string; provider_subject: string }>(
    'SELECT identity_provider, provider_subject FROM iam.user_accounts WHERE id = $1',
    [result.body.ownerAccountId]
  );
  const row = identity.rows[0];
  if (!row) throw new Error('provisioned owner account has no identity to act as');
  const company = await admin.query<{ id: string }>(
    'SELECT id FROM org.legal_companies WHERE tenant_id = $1',
    [result.body.tenantId]
  );
  const branch = await admin.query<{ id: string }>(
    'SELECT id FROM org.branches WHERE tenant_id = $1',
    [result.body.tenantId]
  );
  const companyId = company.rows[0]?.id;
  const branchId = branch.rows[0]?.id;
  if (!companyId || !branchId) throw new Error('provisioned organisation has no company or branch');
  return {
    tenantId: result.body.tenantId,
    tenantCode,
    ownerAccountId: result.body.ownerAccountId,
    tenantAdministratorRoleId: result.body.tenantAdministratorRoleId,
    identityProvider: row.identity_provider,
    providerSubject: row.provider_subject,
    companyId,
    branchId,
  };
}

/** Allow-codes mapped onto one role. */
async function codesOfRole(roleId: string): Promise<string[]> {
  const { rows } = await admin.query<{ permission_code: string }>(
    `SELECT p.permission_code
       FROM iam.role_permissions rp
       JOIN iam.permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1 AND rp.effect = 'allow'
      ORDER BY p.permission_code`,
    [roleId]
  );
  return rows.map((r) => r.permission_code);
}

/** Every mapping row of a role, by id — the fingerprint BF-1 and BF-5 compare. */
async function mappingRows(roleId: string): Promise<string[]> {
  const { rows } = await admin.query<{ fingerprint: string }>(
    `SELECT rp.id || ':' || p.permission_code || ':' || rp.effect AS fingerprint
       FROM iam.role_permissions rp
       JOIN iam.permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1
      ORDER BY p.permission_code`,
    [roleId]
  );
  return rows.map((r) => r.fingerprint);
}

async function backfillAuditCount(tenantId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    'SELECT count(*)::int AS n FROM iam.audit_records WHERE tenant_id = $1 AND action = $2',
    [tenantId, BACKFILL_AUDIT_ACTION]
  );
  return rows[0]?.n ?? 0;
}

/** Removes the twenty-two widened codes, reproducing the 67-code bundle on a fresh role. */
async function makeStale(tenant: Provisioned): Promise<void> {
  await admin.query(
    `DELETE FROM iam.role_permissions
      WHERE role_id = $1
        AND permission_id IN (SELECT id FROM iam.permissions WHERE permission_code = ANY($2::text[]))`,
    [tenant.tenantAdministratorRoleId, [...WIDENED]]
  );
  expect(await codesOfRole(tenant.tenantAdministratorRoleId)).toHaveLength(BUNDLE_BEFORE);
}

function backfillInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    environment: 'local-acceptance',
    dryRun: false,
    all: false,
    tenants: [],
    db: {},
    operator: { email: HOLDER_EMAIL },
    evidencePath: '',
    ...overrides,
  };
}

/** One organisation's line in the tool's report. */
interface BackfillOrganisation {
  readonly tenantId: string;
  readonly tenantCode: string;
  readonly status: string;
  readonly outcome: 'widened' | 'unchanged' | 'no-administrator-role' | 'customised' | 'failed';
  readonly roleId: string | null;
  readonly heldBefore: number;
  readonly heldAfter: number;
  readonly added: readonly string[];
  readonly blockedByDeny: readonly string[];
  readonly customisations: readonly string[];
  readonly withheld?: readonly string[];
  readonly holders?: number;
  readonly tenantGrantedHolders?: number;
  readonly failure?: string;
  readonly auditRecordId?: string;
}

interface BackfillReport {
  readonly outcome: 'applied' | 'dry-run';
  readonly operatorAccountId: string;
  readonly bundleSize: number;
  readonly considered: number;
  readonly widened: number;
  readonly unchanged: number;
  readonly skipped: number;
  readonly customised: number;
  readonly failed: number;
  readonly organisations: readonly BackfillOrganisation[];
}

/** Drives the script against the real database, on the admin connection. */
async function backfill(overrides: Record<string, unknown>): Promise<BackfillReport> {
  const client = await admin.connect();
  try {
    return (await runBackfill(client, backfillInput(overrides), parsedBundle)) as BackfillReport;
  } finally {
    client.release();
  }
}

/** The same, on a client the caller holds — for the concurrency cases. */
async function backfillOn(
  client: PoolClient,
  overrides: Record<string, unknown>
): Promise<BackfillReport> {
  return (await runBackfill(client, backfillInput(overrides), parsedBundle)) as BackfillReport;
}

/** The current record version of a role, for `iam.role-update`'s If-Match. */
async function roleVersion(roleId: string): Promise<number> {
  const { rows } = await admin.query<{ record_version: number }>(
    'SELECT record_version FROM iam.roles WHERE id = $1',
    [roleId]
  );
  const version = rows[0]?.record_version;
  if (version === undefined) throw new Error(`role ${roleId} has no record version`);
  return version;
}

/** Puts a freshly provisioned standard role on the 88-code bundle (no sal.credit.manage). */
async function withoutCreditCode(roleId: string): Promise<void> {
  await admin.query(
    `DELETE FROM iam.role_permissions
      WHERE role_id = $1
        AND permission_id IN (SELECT id FROM iam.permissions WHERE permission_code = ANY($2::text[]))`,
    [roleId, [...CREDIT_ADDED]]
  );
}

/** Mapping rows of one role that grant `sal.credit.manage`. */
async function creditMappings(roleId: string): Promise<number> {
  const { rows } = await admin.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM iam.role_permissions rp
       JOIN iam.permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1 AND p.permission_code = 'sal.credit.manage'`,
    [roleId]
  );
  return rows[0]?.n ?? 0;
}

/** An account of a provisioned organisation that is NOT its first administrator. */
async function seedMember(tenant: Provisioned, label: string): Promise<string> {
  const userId = randomUUID();
  const subject = `fx_p31bf_${label}_${RUN}`;
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
    [
      userId,
      tenant.tenantId,
      IDENTITY_PROVIDER,
      subject,
      `${subject}@fixture.test`,
      `P31 backfill ${label}`,
      tenant.ownerAccountId,
    ]
  );
  return userId;
}

/**
 * Replaces an organisation's standard role with one WRITTEN BY `creatorId` — the one
 * row this suite constructs directly rather than through an operation, because what
 * it varies is exactly the column no operation lets a test choose: `created_by` is
 * the session principal on every write path and immutable afterwards
 * (`tg_roles_immutable`). The provisioned role is archived, and the replacement is
 * mapped to the same allow-codes minus `sal.credit.manage`, so the only thing that
 * differs from a stale standard role is who wrote it.
 */
async function replaceStandardRole(tenant: Provisioned, creatorId: string): Promise<string> {
  const client = await admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE iam.roles SET deleted_at = now() WHERE id = $1', [
      tenant.tenantAdministratorRoleId,
    ]);
    const role = await client.query<{ id: string }>(
      `INSERT INTO iam.roles (tenant_id, role_code, name, description, is_system, created_by)
       VALUES ($1, $2, 'Administrator', 'Replacement', false, $3) RETURNING id`,
      [tenant.tenantId, TARGET_ROLE_CODE, creatorId]
    );
    const roleId = role.rows[0]?.id ?? '';
    await client.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, rp.permission_id, 'allow', $4
         FROM iam.role_permissions rp
         JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $3 AND rp.effect = 'allow' AND p.permission_code <> 'sal.credit.manage'`,
      [tenant.tenantId, roleId, tenant.tenantAdministratorRoleId, creatorId]
    );
    await client.query('COMMIT');
    return roleId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Waits until some backend is blocked on an advisory lock, or gives up. */
async function someoneWaitsOnAdvisoryLock(): Promise<boolean> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const { rows } = await admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity
        WHERE wait_event_type = 'Lock' AND wait_event = 'advisory'`
    );
    if ((rows[0]?.n ?? 0) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return false;
}

/** The first organisation in a report, refusing an empty one rather than reading undefined. */
function only(report: BackfillReport): BackfillOrganisation {
  const organisation = report.organisations[0];
  if (organisation === undefined) throw new Error('the backfill reported no organisation');
  return organisation;
}

let stale: Provisioned;
let customised: Provisioned;
let bystander: Provisioned;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  process.env.AUTH_REDIRECT_ALLOWLIST = 'https://app.test/welcome';
  __resetBackendConfigForTests();
  setIdentityProvider(
    new FakeIdentityProvider({
      secret: 'p1-31-backfill-secret-not-real',
      issuer: 'https://auth.test.local/auth/v1',
      audience: 'authenticated',
    })
  );

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  for (const [id, subject, email] of [
    [USER_HOLDER, SUBJECT_HOLDER, HOLDER_EMAIL],
    [USER_STRANGER, SUBJECT_STRANGER, STRANGER_EMAIL],
  ] as const) {
    await admin.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5, 'P1-31 backfill fixture', 'active', $6)
       ON CONFLICT (id) DO NOTHING`,
      [id, TENANT_A, IDENTITY_PROVIDER, subject, email, SYSTEM_ACTOR]
    );
  }
  // Only the holder gets platform authority. The stranger stays an ordinary
  // account so BF-6's refusal is about the grant and nothing else.
  for (const code of [
    'platform.organization.provision',
    'platform.organization.lifecycle',
    'platform.organization.read',
  ]) {
    await admin.query(
      `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
       VALUES ($1, $2, $3, $3) ON CONFLICT DO NOTHING`,
      [USER_HOLDER, code, SYSTEM_ACTOR]
    );
  }
  runtime = runtimeAppPool(6);
  platform = platformAppPool(6);
  __setPrimaryPoolForTests(runtime);
  __setPlatformPoolForTests(platform);

  stale = await provision('stale');
  customised = await provision('custom');
  bystander = await provision('bystdr');

  await makeStale(stale);
  await makeStale(customised);
  await makeStale(bystander);

  // The customised tenant's own decisions about its own administrator role: one
  // allow BEYOND the bundle, and one deny INSIDE it.
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'allow', $4 FROM iam.permissions p WHERE p.permission_code = $3`,
    [customised.tenantId, customised.tenantAdministratorRoleId, CUSTOMISATION_CODE, SYSTEM_ACTOR]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'deny', $4 FROM iam.permissions p WHERE p.permission_code = $3`,
    [customised.tenantId, customised.tenantAdministratorRoleId, DENIED_CODE, SYSTEM_ACTOR]
  );
}, 240_000);

afterAll(async () => {
  __resetAuthenticatorForTests();
  __resetIdentityProviderForTests();
  __setPrimaryPoolForTests(undefined);
  __setPlatformPoolForTests(undefined);
  await runtime.end();
  await platform.end();
  const provisioned = await admin.query<{ id: string }>(
    'SELECT id FROM org.tenants WHERE tenant_code LIKE $1',
    [`${TENANT_PREFIX}%`]
  );
  await deleteTenantCascade(
    admin,
    provisioned.rows.map((row) => row.id)
  );
  await admin.query(
    "DELETE FROM shared.idempotency_keys WHERE operation IN ('org_provisioning','platform_organization_provision')"
  );
  await admin.query('DELETE FROM iam.platform_grants WHERE account_id = $1', [USER_HOLDER]);
  await admin.query('DELETE FROM iam.user_accounts WHERE id = ANY($1::uuid[])', [
    [USER_HOLDER, USER_STRANGER],
  ]);
  await cleanBackendFixtures(admin);
  await admin.end();
}, 120_000);

describe('P1-31 D-2 — the mechanism', () => {
  it('BF-7 the tool widens to the constant the provisioning path writes, and the two cannot drift', () => {
    expect([...parsedBundle].sort()).toEqual([...TENANT_ADMINISTRATOR_ROLE.permissionCodes].sort());
    expect(parsedBundle).toHaveLength(TENANT_ADMINISTRATOR_ROLE.permissionCodes.length);
    // The eight this backfill exists to deliver are in it, and the withheld
    // export code is not: a backfill must never widen past the bundle.
    for (const code of WIDENED) expect(parsedBundle).toContain(code);
    expect(parsedBundle).not.toContain(CUSTOMISATION_CODE);
    expect(parsedBundle).toHaveLength(BUNDLE_BEFORE + WIDENED.length);
  });

  it('BF-8 additive only, structurally: the script issues no DELETE and no UPDATE', () => {
    const source = readFileSync(
      join(REPOSITORY_ROOT, 'scripts', 'platform', 'backfill-tenant-administrator-bundle.mjs'),
      'utf8'
    );
    // Every SQL statement the tool can execute, read out of the template
    // literals it sends. A revoking verb cannot hide in a comment: only the
    // statements are inspected.
    const statements = [...source.matchAll(/client\.query\(\s*(`[^`]*`|'[^']*')/g)].map((m) =>
      (m[1] ?? '').replace(/^[`']|[`']$/g, '').trim()
    );
    expect(statements.length).toBeGreaterThan(6);
    for (const statement of statements) {
      expect(statement).not.toMatch(/\bDELETE\b/i);
      // `FOR UPDATE` is a row LOCK (BF-15, BF-16), not a write; any other UPDATE is.
      expect(statement.replace(/\bFOR\s+UPDATE\b/gi, 'FOR ROW-LOCK')).not.toMatch(/\bUPDATE\b/i);
      expect(statement).not.toMatch(/\bTRUNCATE\b/i);
      expect(statement).not.toMatch(/\bREVOKE\b/i);
    }
    // Its only write to the mapping table is an allow insert.
    const writes = statements.filter((s) => /INSERT INTO iam\.role_permissions/i.test(s));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatch(/'allow'/);
  });

  it('BF-6 the authority gate is real: an account without the platform code is refused', async () => {
    const before = await codesOfRole(stale.tenantAdministratorRoleId);
    await expect(
      backfill({ tenants: [stale.tenantId], operator: { email: STRANGER_EMAIL } })
    ).rejects.toMatchObject({ exitCode: 4 });
    await expect(
      backfill({ tenants: [stale.tenantId], operator: { email: `absent_${RUN}@fixture.test` } })
    ).rejects.toMatchObject({ exitCode: 4 });
    // Refused, and nothing moved.
    expect(await codesOfRole(stale.tenantAdministratorRoleId)).toEqual(before);
    // The gate names an EXISTING platform permission; none is minted.
    expect(REQUIRED_PLATFORM_CODE).toBe('platform.organization.provision');
    const { rows } = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM iam.permissions WHERE permission_code = $1',
      [REQUIRED_PLATFORM_CODE]
    );
    expect(rows[0]?.n).toBe(1);
  });

  it('BF-9 a route could not do this: the platform INSERT policy refuses an active tenant', async () => {
    const { rows } = await admin.query<{ qual: string }>(
      `SELECT with_check AS qual FROM pg_policies
        WHERE schemaname = 'iam' AND tablename = 'role_permissions'
          AND policyname = 'ins_role_permissions_platform_bootstrap'`
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.qual).toMatch(/provisioning/);
    // And the organisations the backfill is for are not in that state.
    const { rows: state } = await admin.query<{ status: string }>(
      'SELECT status FROM org.tenants WHERE id = $1',
      [stale.tenantId]
    );
    expect(state[0]?.status).toBe('active');
    // The table forces RLS, so the owner connection is bound by it too; only a
    // BYPASSRLS role can write here, which is what the operator connection is.
    const { rows: forced } = await admin.query<{ relforcerowsecurity: boolean }>(
      `SELECT relforcerowsecurity FROM pg_class
        WHERE oid = 'iam.role_permissions'::regclass`
    );
    expect(forced[0]?.relforcerowsecurity).toBe(true);
  });
});

describe('P1-31 D-2 — the five obligations, on real rows', () => {
  it('BF-8b a dry run leaves the database exactly as it found it', async () => {
    const before = await mappingRows(stale.tenantAdministratorRoleId);
    const auditBefore = await backfillAuditCount(stale.tenantId);
    const result = await backfill({ tenants: [stale.tenantId], dryRun: true });
    expect(result.outcome).toBe('dry-run');
    expect(only(result)).toMatchObject({ outcome: 'widened' });
    expect(await mappingRows(stale.tenantAdministratorRoleId)).toEqual(before);
    expect(await backfillAuditCount(stale.tenantId)).toBe(auditBefore);
  });

  it('BF-1 an organisation on the old bundle gains exactly the missing codes and no others', async () => {
    const before = await codesOfRole(stale.tenantAdministratorRoleId);
    const beforeRows = await mappingRows(stale.tenantAdministratorRoleId);
    expect(before).toHaveLength(BUNDLE_BEFORE);
    for (const code of WIDENED) expect(before).not.toContain(code);

    const result = await backfill({ tenants: [stale.tenantId] });
    expect(result.outcome).toBe('applied');
    expect(result.organisations).toHaveLength(1);
    expect(only(result)).toMatchObject({
      tenantId: stale.tenantId,
      tenantCode: stale.tenantCode,
      outcome: 'widened',
      heldBefore: BUNDLE_BEFORE,
      heldAfter: parsedBundle.length,
      blockedByDeny: [],
    });
    expect(only(result).added).toEqual([...WIDENED].sort());

    const after = await codesOfRole(stale.tenantAdministratorRoleId);
    expect(after).toEqual([...TENANT_ADMINISTRATOR_ROLE.permissionCodes].sort());
    // Exactly the delta, computed on the rows rather than trusted from the report.
    expect(after.filter((code) => !before.includes(code))).toEqual([...WIDENED].sort());
    expect(before.filter((code) => !after.includes(code))).toEqual([]);
    // NOTHING was revoked: every mapping row that existed still exists, by id.
    const afterRows = await mappingRows(stale.tenantAdministratorRoleId);
    for (const row of beforeRows) expect(afterRows).toContain(row);
    expect(afterRows).toHaveLength(beforeRows.length + WIDENED.length);

    // It recorded what it changed, in that organisation's own audit trail.
    expect(await backfillAuditCount(stale.tenantId)).toBe(1);
    const { rows: detail } = await admin.query<{ field_name: string; new_value_masked: string }>(
      `SELECT d.field_name, d.new_value_masked
         FROM iam.audit_records r
         JOIN iam.audit_record_details d ON d.audit_record_id = r.id
        WHERE r.tenant_id = $1 AND r.action = $2 AND d.field_name = 'permission_codes_added'`,
      [stale.tenantId, BACKFILL_AUDIT_ACTION]
    );
    expect(detail[0]?.new_value_masked).toBe([...WIDENED].sort().join(','));
  });

  it('BF-2 running it again changes nothing', async () => {
    const before = await mappingRows(stale.tenantAdministratorRoleId);
    const auditBefore = await backfillAuditCount(stale.tenantId);
    const result = await backfill({ tenants: [stale.tenantId] });
    expect(only(result)).toMatchObject({
      outcome: 'unchanged',
      heldBefore: parsedBundle.length,
      heldAfter: parsedBundle.length,
    });
    expect(only(result).added).toEqual([]);
    expect(await mappingRows(stale.tenantAdministratorRoleId)).toEqual(before);
    // No second audit record: an idempotent no-op records nothing.
    expect(await backfillAuditCount(stale.tenantId)).toBe(auditBefore);
  });

  it('BF-3 a customised role is skipped whole: nothing written, every row kept, each reason reported', async () => {
    const before = await mappingRows(customised.tenantAdministratorRoleId);
    const auditBefore = await backfillAuditCount(customised.tenantId);
    expect(await codesOfRole(customised.tenantAdministratorRoleId)).toContain(CUSTOMISATION_CODE);

    const result = await backfill({ tenants: [customised.tenantId] });
    const organisation = only(result);
    expect(organisation).toMatchObject({ outcome: 'customised', added: [] });
    expect(result.customised).toBe(1);
    expect(result.widened).toBe(0);
    // Both of the tenant's own decisions are named, and nothing else is.
    expect(organisation.customisations).toEqual([
      `deny:${DENIED_CODE}`,
      `beyond-bundle:${CUSTOMISATION_CODE}`,
    ]);
    expect(organisation.blockedByDeny).toEqual([DENIED_CODE]);
    // What the standard role WOULD have gained is reported, and was not written.
    expect(organisation.withheld).toEqual(
      [...WIDENED].filter((code) => code !== DENIED_CODE).sort()
    );
    expect(organisation.withheld).toContain('sal.credit.manage');

    // Row for row, id for id: the extra allow and the deny included, nothing added.
    expect(await mappingRows(customised.tenantAdministratorRoleId)).toEqual(before);
    expect(await codesOfRole(customised.tenantAdministratorRoleId)).not.toContain(
      'sal.credit.manage'
    );
    expect(await backfillAuditCount(customised.tenantId)).toBe(auditBefore);
    const { rows: effect } = await admin.query<{ effect: string }>(
      `SELECT rp.effect FROM iam.role_permissions rp
         JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 AND p.permission_code = $2`,
      [customised.tenantAdministratorRoleId, DENIED_CODE]
    );
    expect(effect).toHaveLength(1);
    expect(effect[0]?.effect).toBe('deny');
  });

  it('BF-3b no role other than the tenant administrator role is touched', async () => {
    // A role the tenant built for itself, with one code of its own.
    asOwnerOf(customised);
    const created = await call<{ id: string }>(roleCreateRoute, {
      path: '/iam/roles',
      body: {
        roleCode: `custom_${RUN}`,
        name: 'Custom',
        description: 'A role the tenant owns',
      },
      idempotencyKey: randomUUID(),
    });
    expect(created.status).toBe(201);
    const roleId = created.body.id;
    const mapped = await call(rolePermissionAddRoute, {
      path: `/iam/roles/${roleId}/permissions`,
      params: { roleId },
      body: { permissionCode: 'wo.work_order.read', effect: 'allow' },
      idempotencyKey: randomUUID(),
    });
    expect(mapped.status).toBe(201);
    const before = await mappingRows(roleId);
    expect(before).toHaveLength(1);

    await backfill({ tenants: [customised.tenantId] });
    expect(await mappingRows(roleId)).toEqual(before);
    expect(TARGET_ROLE_CODE).toBe('tenant_administrator');
  });

  it('BF-4 after the backfill a principal performs the reads the stale bundle refused, warranty detail included', async () => {
    // `bystander` is still stale here; BF-5 depends on that and runs after.
    const probe = await provision('read');
    await makeStale(probe);
    const warrantyId = randomUUID();

    asOwnerOf(probe);
    const listBefore = await call<{ code?: string; requiredPermissions?: string[] }>(
      warrantyListRoute,
      {
        path: `/warranties?companyId=${probe.companyId}&branchId=${probe.branchId}&limit=5`,
        method: 'GET',
      }
    );
    expect(listBefore.status).toBe(403);
    expect(listBefore.body.code).toBe('ERR-IAM-001');
    expect(listBefore.body.requiredPermissions).toEqual(['wty.warranty.read']);

    const detailBefore = await call<{ code?: string; requiredPermissions?: string[] }>(
      warrantyDetailRoute,
      {
        path: `/warranties/${warrantyId}`,
        method: 'GET',
        params: { warrantyId },
      }
    );
    expect(detailBefore.status).toBe(403);
    expect(detailBefore.body.code).toBe('ERR-IAM-001');
    expect(detailBefore.body.requiredPermissions).toEqual(['wty.warranty.read']);

    const result = await backfill({ tenants: [probe.tenantId] });
    expect(only(result)).toMatchObject({ outcome: 'widened' });

    asOwnerOf(probe);
    const listAfter = await call<{ items: unknown[] }>(warrantyListRoute, {
      path: `/warranties?companyId=${probe.companyId}&branchId=${probe.branchId}&limit=5`,
      method: 'GET',
    });
    expect(listAfter.status).toBe(200);
    expect(Array.isArray(listAfter.body.items)).toBe(true);

    // The detail read the P-7 re-pointing took away (CC-08). The organisation
    // holds no warranty, so the authorized answer is 404 — what matters is that
    // it is no longer the 403 the permission gate raised a moment ago.
    const detailAfter = await call<{ code?: string }>(warrantyDetailRoute, {
      path: `/warranties/${warrantyId}`,
      method: 'GET',
      params: { warrantyId },
    });
    expect(detailAfter.status).not.toBe(403);
    expect(detailAfter.status).toBe(404);

    // Both reads are gated on the minted code, by declaration.
    expect(WARRANTY_LIST_OPERATION.permissions).toEqual(['wty.warranty.read']);
    expect(WARRANTY_DETAIL_OPERATION.permissions).toEqual(['wty.warranty.read']);
  });

  it('BF-5 no other tenant is touched', async () => {
    const before = await mappingRows(bystander.tenantAdministratorRoleId);
    expect(before).toHaveLength(BUNDLE_BEFORE);
    const auditBefore = await backfillAuditCount(bystander.tenantId);

    const result = await backfill({ tenants: [stale.tenantId, customised.tenantId] });
    expect(result.organisations.map((o) => o.tenantId)).toEqual([
      stale.tenantId,
      customised.tenantId,
    ]);

    // Row for row, id for id, effect for effect.
    expect(await mappingRows(bystander.tenantAdministratorRoleId)).toEqual(before);
    expect(await backfillAuditCount(bystander.tenantId)).toBe(auditBefore);
    expect(auditBefore).toBe(0);
  });

  it('BF-5b a sweep reports the list it acted on rather than sweeping silently', async () => {
    const result = await backfill({ all: true, dryRun: true });
    const codes = result.organisations.map((o) => o.tenantCode);
    // Every organisation is named in the report, including the ones it skipped.
    expect(codes).toContain(bystander.tenantCode);
    expect(codes).toContain(stale.tenantCode);
    expect(result.considered).toBe(result.organisations.length);
    // A tenant with no administrator role is reported and skipped, never created.
    const skipped = result.organisations.filter((o) => o.outcome === 'no-administrator-role');
    for (const organisation of skipped) expect(organisation.roleId).toBeNull();
    const { rows } = await admin.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM iam.roles WHERE tenant_id = $1 AND role_code = $2',
      [TENANT_A, TARGET_ROLE_CODE]
    );
    expect(rows[0]?.n).toBe(0);
  });

  it('BF-10 an organisation on the 85-code bundle is offered exactly the codes widened since (the three of the 2026-09-17 directive and sal.credit.manage), and a dry run offers them without writing', async () => {
    // The script parses `bootstrap-roles.ts` at run time rather than carrying a
    // copy of the list, so a widening needs no edit to it — which is a claim, and
    // this is the measurement of it for THIS widening. The organisation is put on
    // the 85-code bundle the shipped operation wrote the day before, not on the
    // 67-code one BF-1 uses, so the difference the script computes can only be
    // the three codes the directive added and the one the credit-note decision added.
    const since85 = [...OD_QA_ADDED, ...CREDIT_ADDED];
    const organisation = await provision('odqa');
    await admin.query(
      `DELETE FROM iam.role_permissions
        WHERE role_id = $1
          AND permission_id IN (SELECT id FROM iam.permissions WHERE permission_code = ANY($2::text[]))`,
      [organisation.tenantAdministratorRoleId, since85]
    );
    const before = await codesOfRole(organisation.tenantAdministratorRoleId);
    expect(before).toHaveLength(parsedBundle.length - since85.length);
    expect(before).toHaveLength(85);
    for (const code of since85) expect(before).not.toContain(code);

    const beforeRows = await mappingRows(organisation.tenantAdministratorRoleId);
    const auditBefore = await backfillAuditCount(organisation.tenantId);

    const dryRun = await backfill({ tenants: [organisation.tenantId], dryRun: true });
    expect(dryRun.outcome).toBe('dry-run');
    expect(only(dryRun)).toMatchObject({
      tenantId: organisation.tenantId,
      outcome: 'widened',
      heldBefore: 85,
      heldAfter: parsedBundle.length,
      blockedByDeny: [],
    });
    // EXACTLY the three, and no other code: the whole point of the case. In
    // particular `inv.cost.view` is not offered, because CC-12 keeps it out of the
    // bundle the script reads.
    expect(only(dryRun).added).toEqual([...since85].sort());
    expect(only(dryRun).added).not.toContain('inv.cost.view');
    // A dry run writes nothing, so the offer above is an offer and not a report
    // of something that has already happened.
    expect(await mappingRows(organisation.tenantAdministratorRoleId)).toEqual(beforeRows);
    expect(await backfillAuditCount(organisation.tenantId)).toBe(auditBefore);

    const applied = await backfill({ tenants: [organisation.tenantId] });
    expect(only(applied).added).toEqual([...since85].sort());
    expect(await codesOfRole(organisation.tenantAdministratorRoleId)).toEqual(
      [...TENANT_ADMINISTRATOR_ROLE.permissionCodes].sort()
    );
  });

  it('BF-11 an organisation on the 88-code bundle is offered exactly sal.credit.manage, and only its standard administrator role gains it', async () => {
    const organisation = await provision('crn');

    // A cashier role the organisation built for itself through the shipped role
    // editor. Its mappings append `iam.role.permission_added` records naming THIS
    // role, which must not be read as a customisation of the administrator role.
    asOwnerOf(organisation);
    const cashier = await call<{ id: string }>(roleCreateRoute, {
      path: '/iam/roles',
      body: { roleCode: `cashier_${RUN}`, name: 'Cashier', description: 'Takes payments' },
      idempotencyKey: randomUUID(),
    });
    expect(cashier.status).toBe(201);
    const cashierRoleId = cashier.body.id;
    for (const permissionCode of ['sal.invoice.manage', 'sal.finance.view', 'sal.payment.record']) {
      asOwnerOf(organisation);
      const mapped = await call(rolePermissionAddRoute, {
        path: `/iam/roles/${cashierRoleId}/permissions`,
        params: { roleId: cashierRoleId },
        body: { permissionCode, effect: 'allow' },
        idempotencyKey: randomUUID(),
      });
      expect(mapped.status).toBe(201);
    }
    const cashierBefore = await mappingRows(cashierRoleId);

    // BF-14: the organisation gives its standard role to a SECOND account through the
    // shipped grant operation. That does not customise the role, so it is still
    // widened — but the report says how many accounts the widening reaches.
    const deputy = await seedMember(organisation, 'deputy');
    asOwnerOf(organisation);
    const granted = await call(grantIssueRoute, {
      path: '/iam/grants',
      body: { userId: deputy, roleId: organisation.tenantAdministratorRoleId },
      idempotencyKey: randomUUID(),
    });
    expect(granted.status).toBe(201);

    // The standard role, put on the 88-code bundle every organisation provisioned
    // before the credit-note decision holds.
    const roleId = organisation.tenantAdministratorRoleId;
    await admin.query(
      `DELETE FROM iam.role_permissions
        WHERE role_id = $1
          AND permission_id IN (SELECT id FROM iam.permissions WHERE permission_code = ANY($2::text[]))`,
      [roleId, [...CREDIT_ADDED]]
    );
    expect(await codesOfRole(roleId)).toHaveLength(88);
    const beforeRows = await mappingRows(roleId);
    const auditBefore = await backfillAuditCount(organisation.tenantId);

    // Named by tenant CODE, the form an operator types.
    const dryRun = await backfill({ tenants: [organisation.tenantCode], dryRun: true });
    expect(dryRun.outcome).toBe('dry-run');
    expect(only(dryRun)).toMatchObject({
      tenantId: organisation.tenantId,
      outcome: 'widened',
      heldBefore: 88,
      heldAfter: parsedBundle.length,
      customisations: [],
      // The first owner (granted by the platform operator) and the deputy (granted by
      // the organisation itself).
      holders: 2,
      tenantGrantedHolders: 1,
    });
    expect(only(dryRun).added).toEqual(['sal.credit.manage']);
    expect(await mappingRows(roleId)).toEqual(beforeRows);
    expect(await backfillAuditCount(organisation.tenantId)).toBe(auditBefore);

    const applied = await backfill({ tenants: [organisation.tenantCode] });
    expect(only(applied)).toMatchObject({ outcome: 'widened', added: ['sal.credit.manage'] });
    expect(await codesOfRole(roleId)).toEqual(
      [...TENANT_ADMINISTRATOR_ROLE.permissionCodes].sort()
    );
    const afterRows = await mappingRows(roleId);
    for (const row of beforeRows) expect(afterRows).toContain(row);
    expect(afterRows).toHaveLength(beforeRows.length + 1);
    expect(await backfillAuditCount(organisation.tenantId)).toBe(auditBefore + 1);

    // The cashier role gained nothing: not broadened, not even read for writing.
    expect(await mappingRows(cashierRoleId)).toEqual(cashierBefore);
    expect(await codesOfRole(cashierRoleId)).not.toContain('sal.credit.manage');

    // Idempotent: a second run writes nothing and records nothing.
    const again = await backfill({ tenants: [organisation.tenantCode] });
    expect(only(again)).toMatchObject({ outcome: 'unchanged', added: [] });
    expect(await mappingRows(roleId)).toEqual(afterRows);
    expect(await backfillAuditCount(organisation.tenantId)).toBe(auditBefore + 1);
  });

  it('BF-12 an administrator role the tenant edited through the role editor, or created itself, is skipped and reported, and gains nothing', async () => {
    // (a) EDITED. The organisation's own administrator removes a bundle code from its
    // own role through the shipped remove operation. From the rows alone that role is
    // indistinguishable from one provisioned on an older bundle; its audit trail is
    // what tells them apart.
    const edited = await provision('edit');
    const editedRoleId = edited.tenantAdministratorRoleId;
    await admin.query(
      `DELETE FROM iam.role_permissions
        WHERE role_id = $1
          AND permission_id IN (SELECT id FROM iam.permissions WHERE permission_code = ANY($2::text[]))`,
      [editedRoleId, [...CREDIT_ADDED]]
    );
    const { rows: mapping } = await admin.query<{ id: string }>(
      `SELECT rp.id FROM iam.role_permissions rp
         JOIN iam.permissions p ON p.id = rp.permission_id
        WHERE rp.role_id = $1 AND p.permission_code = 'rpt.report.read'`,
      [editedRoleId]
    );
    const mappingId = mapping[0]?.id ?? '';
    expect(mappingId).not.toBe('');
    asOwnerOf(edited);
    const removed = await call(rolePermissionRemoveRoute, {
      path: `/iam/roles/${editedRoleId}/permissions/${mappingId}`,
      method: 'DELETE',
      params: { roleId: editedRoleId, mappingId },
    });
    expect(removed.status).toBe(200);
    const editedRows = await mappingRows(editedRoleId);

    // (b) CREATED INSIDE. The organisation archives the provisioned role through the
    // shipped role-update operation and builds its own under the same code through
    // the shipped role-create operation. It wears the standard code and is not the
    // standard role.
    const inside = await provision('inside');
    asOwnerOf(inside);
    const archived = await call(roleUpdateRoute, {
      path: `/iam/roles/${inside.tenantAdministratorRoleId}`,
      method: 'PATCH',
      params: { roleId: inside.tenantAdministratorRoleId },
      body: { archive: true },
      ifMatch: await roleVersion(inside.tenantAdministratorRoleId),
    });
    expect(archived.status).toBe(200);
    asOwnerOf(inside);
    const recreated = await call<{ id: string }>(roleCreateRoute, {
      path: '/iam/roles',
      body: { roleCode: TARGET_ROLE_CODE, name: 'Administrator', description: 'Our own' },
      idempotencyKey: randomUUID(),
    });
    expect(recreated.status).toBe(201);
    const insideRows = await mappingRows(recreated.body.id);

    // (c) RENAMED. The organisation repurposes its standard role through the shipped
    // role-update operation, changing nothing but its name.
    const renamed = await provision('renamed');
    const renamedRoleId = renamed.tenantAdministratorRoleId;
    await withoutCreditCode(renamedRoleId);
    asOwnerOf(renamed);
    const rename = await call(roleUpdateRoute, {
      path: `/iam/roles/${renamedRoleId}`,
      method: 'PATCH',
      params: { roleId: renamedRoleId },
      body: { name: 'Front desk' },
      ifMatch: await roleVersion(renamedRoleId),
    });
    expect(rename.status).toBe(200);
    const renamedRows = await mappingRows(renamedRoleId);

    const result = await backfill({
      tenants: [edited.tenantId, inside.tenantId, renamed.tenantId],
    });
    expect(result.customised).toBe(3);
    expect(result.widened).toBe(0);
    const [first, second, third] = result.organisations;
    expect(first).toMatchObject({
      tenantId: edited.tenantId,
      outcome: 'customised',
      added: [],
      customisations: ['tenant-edit:iam.role.permission_removed'],
    });
    expect(first?.withheld).toEqual(['rpt.report.read', 'sal.credit.manage']);
    expect(second).toMatchObject({
      tenantId: inside.tenantId,
      roleId: recreated.body.id,
      outcome: 'customised',
      added: [],
      customisations: ['created-inside-organisation'],
    });
    expect(second?.withheld).toContain('sal.credit.manage');
    expect(third).toMatchObject({
      tenantId: renamed.tenantId,
      roleId: renamedRoleId,
      outcome: 'customised',
      added: [],
      customisations: ['tenant-edit:iam.role.updated'],
      withheld: ['sal.credit.manage'],
    });

    // None was written, and none gained an audit record.
    expect(await mappingRows(editedRoleId)).toEqual(editedRows);
    expect(await mappingRows(recreated.body.id)).toEqual(insideRows);
    expect(await mappingRows(renamedRoleId)).toEqual(renamedRows);
    expect(await codesOfRole(editedRoleId)).not.toContain('sal.credit.manage');
    expect(await backfillAuditCount(edited.tenantId)).toBe(0);
    expect(await backfillAuditCount(inside.tenantId)).toBe(0);
    expect(await backfillAuditCount(renamed.tenantId)).toBe(0);
  });

  it('BF-13 the creator check fails closed, and is keyed on platform authority rather than on the creator home organisation', async () => {
    // (a) A creator that names no account at all.
    const unknown = await provision('crunk');
    const unknownRoleId = await replaceStandardRole(unknown, randomUUID());
    // (b) A creator of ANOTHER organisation holding no platform grant.
    const foreign = await provision('crfor');
    const foreignRoleId = await replaceStandardRole(foreign, USER_STRANGER);
    // (c) A platform operator whose HOME is this very organisation. The old test —
    // "is the creator's organisation this one?" — would have called this the
    // tenant's own role; what makes it the standard role is the platform grant.
    const home = await provision('crhome');
    const homeOperator = await seedMember(home, 'home_operator');
    await admin.query(
      `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
       VALUES ($1, 'platform.organization.manage', $2, $2)`,
      [homeOperator, SYSTEM_ACTOR]
    );
    const homeRoleId = await replaceStandardRole(home, homeOperator);
    try {
      const before = await Promise.all(
        [unknownRoleId, foreignRoleId].map((roleId) => mappingRows(roleId))
      );

      const result = await backfill({
        tenants: [unknown.tenantId, foreign.tenantId, home.tenantId],
      });
      const [first, second, third] = result.organisations;
      expect(first).toMatchObject({
        roleId: unknownRoleId,
        outcome: 'customised',
        added: [],
        customisations: ['creator-unknown'],
        withheld: ['sal.credit.manage'],
      });
      expect(second).toMatchObject({
        roleId: foreignRoleId,
        outcome: 'customised',
        added: [],
        customisations: ['creator-not-platform-operator'],
        withheld: ['sal.credit.manage'],
      });
      expect(third).toMatchObject({
        roleId: homeRoleId,
        outcome: 'widened',
        added: ['sal.credit.manage'],
        customisations: [],
      });
      expect(result.failed).toBe(0);

      // The two it refused were not written; the one it recognised was.
      expect(await mappingRows(unknownRoleId)).toEqual(before[0]);
      expect(await mappingRows(foreignRoleId)).toEqual(before[1]);
      expect(await backfillAuditCount(unknown.tenantId)).toBe(0);
      expect(await backfillAuditCount(foreign.tenantId)).toBe(0);
      expect(await codesOfRole(homeRoleId)).toContain('sal.credit.manage');
      expect(await backfillAuditCount(home.tenantId)).toBe(1);
    } finally {
      await admin.query('DELETE FROM iam.platform_grants WHERE account_id = $1', [homeOperator]);
    }
  });

  it('BF-15 two runs against the same organisation at once: one widens, the other finds nothing missing, and nothing fails', async () => {
    const organisation = await provision('race');
    const roleId = organisation.tenantAdministratorRoleId;
    await withoutCreditCode(roleId);
    const auditBefore = await backfillAuditCount(organisation.tenantId);

    const left = await admin.connect();
    const right = await admin.connect();
    try {
      const [a, b] = await Promise.all([
        backfillOn(left, { tenants: [organisation.tenantId] }),
        backfillOn(right, { tenants: [organisation.tenantId] }),
      ]);
      const outcomes = [only(a).outcome, only(b).outcome].sort();
      expect(outcomes).toEqual(['unchanged', 'widened']);
      expect(a.failed + b.failed).toBe(0);
    } finally {
      left.release();
      right.release();
    }
    // Exactly one mapping, exactly one audit record.
    expect(await creditMappings(roleId)).toBe(1);
    expect(await backfillAuditCount(organisation.tenantId)).toBe(auditBefore + 1);
  });

  it('BF-16 a run waits on the organisation advisory lock and computes its difference only after the holder commits', async () => {
    const organisation = await provision('lock');
    const roleId = organisation.tenantAdministratorRoleId;
    await withoutCreditCode(roleId);

    const holder = await admin.connect();
    const runner = await admin.connect();
    try {
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        tenantLockKey(organisation.tenantId),
      ]);
      const pending = backfillOn(runner, { tenants: [organisation.tenantId] });
      // The run is BLOCKED on the lock rather than reading the role.
      expect(await someoneWaitsOnAdvisoryLock()).toBe(true);
      // Meanwhile the holder completes the role — as a concurrent run would have.
      await holder.query(
        `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
         SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p
          WHERE p.permission_code = 'sal.credit.manage'`,
        [organisation.tenantId, roleId, USER_HOLDER]
      );
      await holder.query('COMMIT');

      const report = await pending;
      expect(only(report)).toMatchObject({ outcome: 'unchanged', added: [] });
      expect(report.failed).toBe(0);
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      holder.release();
      runner.release();
    }
    expect(await creditMappings(roleId)).toBe(1);
    expect(await backfillAuditCount(organisation.tenantId)).toBe(0);
  });

  it('BF-17 one organisation failing is rolled back and reported, and the next one in the same run is still widened', async () => {
    const blocked = await provision('fail');
    const healthy = await provision('ok');
    await withoutCreditCode(blocked.tenantAdministratorRoleId);
    await withoutCreditCode(healthy.tenantAdministratorRoleId);
    const blockedBefore = await mappingRows(blocked.tenantAdministratorRoleId);

    const holder = await admin.connect();
    const runner = await admin.connect();
    try {
      // The first organisation cannot be locked within the run's statement budget.
      await holder.query('BEGIN');
      await holder.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        tenantLockKey(blocked.tenantId),
      ]);
      await runner.query("SET statement_timeout = '1500ms'");
      const report = await backfillOn(runner, { tenants: [blocked.tenantId, healthy.tenantId] });
      await runner.query('RESET statement_timeout');

      expect(report.outcome).toBe('applied');
      expect(report.failed).toBe(1);
      expect(report.widened).toBe(1);
      const [first, second] = report.organisations;
      expect(first).toMatchObject({ tenantId: blocked.tenantId, outcome: 'failed', added: [] });
      // The reason is stated, as the SQLSTATE the database gave.
      expect(first?.failure).toMatch(/^57014: /);
      expect(second).toMatchObject({
        tenantId: healthy.tenantId,
        outcome: 'widened',
        added: ['sal.credit.manage'],
      });
    } finally {
      await holder.query('ROLLBACK').catch(() => undefined);
      await runner.query('RESET statement_timeout').catch(() => undefined);
      holder.release();
      runner.release();
    }
    // The failed organisation is exactly as it was; the healthy one was committed.
    expect(await mappingRows(blocked.tenantAdministratorRoleId)).toEqual(blockedBefore);
    expect(await backfillAuditCount(blocked.tenantId)).toBe(0);
    expect(await codesOfRole(healthy.tenantAdministratorRoleId)).toContain('sal.credit.manage');
    expect(await backfillAuditCount(healthy.tenantId)).toBe(1);
  });
});
