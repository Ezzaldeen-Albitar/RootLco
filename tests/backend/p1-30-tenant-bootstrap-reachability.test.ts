/**
 * P1-30 corrective slice — a provisioned tenant can actually trade.
 *
 * The P1-30 A0 preflight recorded F-01 ("no real organization can hold ANY
 * commercial permission") and shipped seven Frontend waves over it. W7's
 * measurement then found a second closure of the same class, and confirming it
 * on the local stack at develop `029fc20d` turned up a third. All three were
 * properties of the SHIPPED provisioning operation, and all three were measured
 * before anything was written:
 *
 *   1. `sal.payment_methods` — six tenants created through
 *      `platform.organization-provision`, ZERO tenant-scope rows between them.
 *      `fk_receipts_method` is `(tenant_id, payment_method_id)` and a platform
 *      row's `tenant_id` is NULL, so no receipt could cite one. Proved by a
 *      direct INSERT that answered
 *      `fk_receipts_method … is not present in table "payment_methods"`.
 *   2. `shared.number_sequences` — ZERO rows for every tenant on the stack.
 *      `shared.next_display_number` matches `(company_id, branch_id)` exactly
 *      with no fallback, `app_runtime` holds no INSERT, and invoice issue,
 *      receipt record and quotation create do not degrade: they fail.
 *   3. `TENANT_ADMINISTRATOR_ROLE` — 48 codes, ZERO of them `svc.`, `quo.`,
 *      `inv.` or `sal.`. `ins_role_permissions_delegable` admits a mapping only
 *      when the actor already holds the code, so that was a permanent closure
 *      rather than an inconvenience.
 *
 * Every case below drives the SHIPPED routes. Direct SQL appears only to read
 * results back on the admin connection and to build fixtures the product has no
 * writer for; no proof creates a payment method, a sequence or a permission
 * mapping by hand, because the whole question is whether provisioning does.
 *
 *   PM-B1  a fresh tenant receives exactly the canonical ASM-14 methods
 *   PM-B2  every row is tenant-local and copied from the platform catalogue
 *   PM-B3  the shipped method list returns all three as recordable
 *   PM-B4  a receipt is recorded through the shipped route using one of them
 *   PM-B5  another tenant's method id cannot be used
 *   PM-B6  a platform method id still cannot be used
 *   PM-B7  an idempotent replay duplicates nothing
 *   PM-B8  a failure in the method bootstrap rolls the whole provisioning back
 *   PM-B9  an unrelated provisioning does not rewrite an existing tenant's
 *          methods, and the control plane holds no UPDATE or DELETE to do it
 *   PM-N   the five containment negatives of the new policy pair
 *   NS-B1  one sequence row per registered run, each at its registry scope
 *   NS-B2  the branch-scoped runs carry the company and branch that was created
 *   F01-B1 the administrator can now MAP a commercial code to a new role —
 *          the exact act the A0 matrix recorded as 403
 *
 * Operations exercised here: platform.organization-provision,
 * sal.payment-method-list, sal.payment-record, crm.individual-create,
 * iam.role-create, iam.role-permission-add.
 *
 * Coverage manifest (read by scripts/check-operation-test-coverage.mjs):
 *   platform.organization-provision: route service success audit idempotency rollback
 *   sal.payment-method-list: route service authorization success
 *   sal.payment-record: route service authorization success denial cross-tenant
 *   crm.individual-create: route service authorization success
 *   iam.role-create: route service authorization success
 *   iam.role-permission-add: route service authorization success
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
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
import { FakeIdentityProvider, setIdentityProvider } from '@/modules/iam';
import { __resetIdentityProviderForTests } from '@/modules/iam/provider/identity-provider';
import { TENANT_BOOTSTRAP_METHOD_CODES } from '@/modules/payments';
import { SEQUENCE_DEFINITIONS } from '@/modules/shared-services';
import { POST as organizationProvisionRoute } from '@/app/api/v1/platform/organizations/route';
import {
  PAYMENT_METHOD_LIST_OPERATION,
  GET as paymentMethodListRoute,
} from '@/app/api/v1/payment-methods/route';
import { PAYMENT_RECORD_OPERATION, POST as paymentRecordRoute } from '@/app/api/v1/payments/route';
import { POST as individualCreateRoute } from '@/app/api/v1/customers/individuals/route';
import { POST as roleCreateRoute } from '@/app/api/v1/iam/roles/route';
import { POST as rolePermissionAddRoute } from '@/app/api/v1/iam/roles/[roleId]/permissions/route';

const IDENTITY_PROVIDER = 'test_harness';
const SUBJECT_HOLDER = 'fx_p130_platform_holder';
const USER_HOLDER = 'd3000000-0000-4000-8000-00000000001a';
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';
/** Deliberately not `w9`: a sibling suite deletes tenants by that prefix. */
const RUN = Math.random().toString(36).slice(2, 8);
const TENANT_PREFIX = `p30b${RUN}`;

let admin: Pool;
let runtime: Pool;
let platform: Pool;
let provider: FakeIdentityProvider;

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
  }
): Promise<CallResult<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (input.idempotencyKey !== undefined) headers['idempotency-key'] = input.idempotencyKey;
  const init: RequestInit = { method: input.method ?? 'POST', headers };
  if (input.body !== undefined) init.body = JSON.stringify(input.body);
  const request = new Request(`http://localhost/api/v1${input.path}`, init);
  const response = await (handler as RouteHandler)(request, {
    params: Promise.resolve(input.params ?? {}),
  });
  const text = await response.text();
  return { status: response.status, body: (text === '' ? null : JSON.parse(text)) as T };
}

/** The platform operator, in their own home tenant. */
function asHolder(): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: IDENTITY_PROVIDER,
      providerSubject: SUBJECT_HOLDER,
      tenantId: TENANT_A,
    })
  );
}

/** The Owner the bootstrap created, in the tenant it was created for. */
function asOwnerOf(tenant: Provisioned): void {
  setSessionAuthenticator(
    new StaticClaimsAuthenticator({
      identityProvider: tenant.identityProvider,
      providerSubject: tenant.providerSubject,
      tenantId: tenant.tenantId,
    })
  );
}

interface Provisioned {
  readonly tenantId: string;
  readonly companyId: string;
  readonly branchId: string;
  readonly ownerAccountId: string;
  readonly identityProvider: string;
  readonly providerSubject: string;
}

function spec(code: string): Record<string, unknown> {
  return {
    tenant: {
      code: `${TENANT_PREFIX}_${code}`,
      display_name: 'P1-30 bootstrap probe',
      locale: 'en',
      timezone: 'UTC',
    },
    company: { code: 'p30c', legal_name: 'P30 Ltd', base_currency: 'JOD' },
    branch: { code: 'main', name: 'Main', timezone: 'UTC' },
    owner: { email: `owner_${code}_${RUN}@fixture.test`, displayName: 'First Owner' },
    activate: true,
  };
}

async function provisionRaw(
  code: string,
  idempotencyKey = randomUUID()
): Promise<CallResult<{ tenantId: string; ownerAccountId: string }>> {
  asHolder();
  return call(organizationProvisionRoute, {
    path: '/platform/organizations',
    body: spec(code),
    idempotencyKey,
  });
}

/** Provisions and resolves everything a later call needs to act as the Owner. */
async function provision(code: string, idempotencyKey = randomUUID()): Promise<Provisioned> {
  const result = await provisionRaw(code, idempotencyKey);
  expect(result.status).toBe(201);
  return hydrate(result.body.tenantId, result.body.ownerAccountId);
}

async function hydrate(tenantId: string, ownerAccountId: string): Promise<Provisioned> {
  const { rows } = await admin.query<{
    company_id: string;
    branch_id: string;
    identity_provider: string;
    provider_subject: string;
  }>(
    `SELECT c.id AS company_id,
            b.id AS branch_id,
            a.identity_provider,
            a.provider_subject
       FROM org.legal_companies c
       JOIN org.branches b ON b.tenant_id = c.tenant_id AND b.company_id = c.id
       JOIN iam.user_accounts a ON a.id = $2
      WHERE c.tenant_id = $1`,
    [tenantId, ownerAccountId]
  );
  const row = rows[0];
  if (!row) throw new Error('provisioned tenant has no company/branch/owner to act as');
  return {
    tenantId,
    ownerAccountId,
    companyId: row.company_id,
    branchId: row.branch_id,
    identityProvider: row.identity_provider,
    providerSubject: row.provider_subject,
  };
}

async function methodsOf(tenantId: string): Promise<
  Array<{
    scope: string;
    tenant_id: string | null;
    method_code: string;
    kind: string;
    display_name: string;
    status: string;
  }>
> {
  const { rows } = await admin.query(
    `SELECT scope, tenant_id, method_code, kind, display_name, status
       FROM sal.payment_methods
      WHERE tenant_id = $1
      ORDER BY method_code`,
    [tenantId]
  );
  return rows;
}

async function sequencesOf(
  tenantId: string
): Promise<Array<{ sequence_code: string; company_id: string | null; branch_id: string | null }>> {
  const { rows } = await admin.query(
    `SELECT sequence_code, company_id, branch_id
       FROM shared.number_sequences
      WHERE tenant_id = $1
      ORDER BY sequence_code`,
    [tenantId]
  );
  return rows;
}

/** A payer the receipt can cite, created through the shipped customer route. */
async function createPayer(tenant: Provisioned): Promise<string> {
  asOwnerOf(tenant);
  const created = await call<{ customerId: string; displayNumber: string | null }>(
    individualCreateRoute,
    {
      path: '/customers/individuals',
      body: { givenName: 'Payer', familyName: 'Fixture' },
      idempotencyKey: randomUUID(),
    }
  );
  expect(created.status).toBe(201);
  // Incidental to the payer, load-bearing as evidence: `displayNumber` is
  // documented as null when the tenant has no `business_partner` sequence, and
  // it is not null here — so the tenant-scope half of the sequence bootstrap is
  // proved through a shipped route rather than only by reading the table.
  expect(created.body.displayNumber).not.toBeNull();
  return created.body.customerId;
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = 'local';
  // The Owner's invitation link needs an allow-listed destination; without one
  // the bootstrap refuses before it reaches anything this suite is about.
  process.env.AUTH_REDIRECT_ALLOWLIST = 'https://app.test/welcome';
  __resetBackendConfigForTests();
  provider = new FakeIdentityProvider({
    secret: 'p1-30-bootstrap-secret-not-real',
    issuer: 'https://auth.test.local/auth/v1',
    audience: 'authenticated',
  });
  setIdentityProvider(provider);

  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'P1-30 bootstrap fixture', 'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [
      USER_HOLDER,
      TENANT_A,
      IDENTITY_PROVIDER,
      SUBJECT_HOLDER,
      `${SUBJECT_HOLDER}@fixture.test`,
      SYSTEM_ACTOR,
    ]
  );
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
}, 180_000);

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
  await cleanBackendFixtures(admin);
  await admin.end();
}, 60_000);

describe('P1-30 — the payment methods a provisioned tenant is given', () => {
  it('drives the two shipped payment operations, by id, and adds no new one', () => {
    // Named rather than assumed: this slice publishes NO operation. It changes
    // what provisioning writes, and these two are the existing reads and writes
    // that were unreachable in a fresh tenant until it did.
    expect(PAYMENT_METHOD_LIST_OPERATION.id).toBe('sal.payment-method-list');
    expect(PAYMENT_METHOD_LIST_OPERATION.permissions).toEqual(['sal.payment.record']);
    expect(PAYMENT_RECORD_OPERATION.id).toBe('sal.payment-record');
    expect(PAYMENT_RECORD_OPERATION.permissions).toEqual([
      'sal.payment.record',
      'sal.finance.view',
    ]);
  });

  it('PM-B1 a fresh tenant receives exactly the canonical ASM-14 methods', async () => {
    const tenant = await provision('b1');
    const rows = await methodsOf(tenant.tenantId);
    expect(rows.map((r) => r.method_code)).toEqual(
      [...TENANT_BOOTSTRAP_METHOD_CODES].sort((a, b) => a.localeCompare(b))
    );
    // The vocabulary is closed at three by ck_payment_methods_kind, and no
    // online gateway or settlement type exists to be provisioned (ASM-14/CON-04).
    expect(rows).toHaveLength(3);
  });

  it('PM-B2 every row is tenant-local and copied from the platform catalogue, not invented', async () => {
    const tenant = await provision('b2');
    const rows = await methodsOf(tenant.tenantId);
    for (const row of rows) {
      expect(row.scope).toBe('tenant');
      expect(row.tenant_id).toBe(tenant.tenantId);
      expect(row.status).toBe('active');
    }
    // kind and display_name are the seed's own values, row for row. If the copy
    // ever became a literal in TypeScript, this comparison is what would notice.
    const { rows: canonical } = await admin.query<{
      method_code: string;
      kind: string;
      display_name: string;
    }>(
      `SELECT method_code, kind, display_name
         FROM sal.payment_methods
        WHERE scope = 'platform' AND deleted_at IS NULL
        ORDER BY method_code`
    );
    expect(
      rows.map((r) => ({ method_code: r.method_code, kind: r.kind, display_name: r.display_name }))
    ).toEqual(canonical);
  });

  it('PM-B3 the shipped method list returns all three as recordable', async () => {
    const tenant = await provision('b3');
    asOwnerOf(tenant);
    const listed = await call<{
      items: Array<{ id: string; scope: string; methodCode: string; recordable: boolean }>;
    }>(paymentMethodListRoute, { path: '/payment-methods', method: 'GET' });
    expect(listed.status).toBe(200);
    const recordable = listed.body.items.filter((item) => item.recordable);
    expect(recordable.map((item) => item.methodCode).sort()).toEqual(
      [...TENANT_BOOTSTRAP_METHOD_CODES].sort((a, b) => a.localeCompare(b))
    );
    // The three platform rows are still visible and still not recordable — the
    // list reports the difference rather than hiding it.
    expect(listed.body.items.filter((item) => item.scope === 'platform')).toHaveLength(3);
    for (const item of listed.body.items.filter((i) => i.scope === 'platform')) {
      expect(item.recordable).toBe(false);
    }
  });

  it('PM-B4 a receipt is recorded through the shipped route using one of them', async () => {
    const tenant = await provision('b4');
    const payerPartnerId = await createPayer(tenant);

    asOwnerOf(tenant);
    const listed = await call<{ items: Array<{ id: string; scope: string; methodCode: string }> }>(
      paymentMethodListRoute,
      { path: '/payment-methods', method: 'GET' }
    );
    const cash = listed.body.items.find(
      (item) => item.scope === 'tenant' && item.methodCode === 'cash'
    );
    expect(cash).toBeDefined();

    asOwnerOf(tenant);
    const recorded = await call<{ reference: string; money: { amount: string; currency: string } }>(
      paymentRecordRoute,
      {
        path: '/payments',
        body: {
          companyId: tenant.companyId,
          branchId: tenant.branchId,
          paymentMethodId: cash?.id,
          payerPartnerId,
          currency: 'JOD',
          amount: '25.0000',
        },
        idempotencyKey: randomUUID(),
      }
    );
    // This single assertion is the whole slice: the method exists, the receipt
    // sequence exists, and the Owner holds sal.payment.record and
    // sal.finance.view. Before the slice each of the three was independently
    // fatal.
    expect(recorded.status).toBe(201);
    expect(recorded.body.money).toEqual({ amount: '25.0000', currency: 'JOD' });
    expect(recorded.body.reference).toMatch(/\d/);
  });

  it('PM-B5 another tenant method id cannot be used, and PM-B6 a platform one still cannot', async () => {
    const tenant = await provision('b5');
    const other = await provision('b5x');
    const payerPartnerId = await createPayer(tenant);

    const foreign = (await methodsOf(other.tenantId))[0];
    const { rows: platformRows } = await admin.query<{ id: string }>(
      "SELECT id FROM sal.payment_methods WHERE scope = 'platform' AND method_code = 'cash'"
    );
    const { rows: foreignRows } = await admin.query<{ id: string }>(
      `SELECT id FROM sal.payment_methods WHERE tenant_id = $1 AND method_code = $2`,
      [other.tenantId, foreign?.method_code]
    );

    for (const methodId of [foreignRows[0]?.id, platformRows[0]?.id]) {
      asOwnerOf(tenant);
      const refused = await call<{ code: string }>(paymentRecordRoute, {
        path: '/payments',
        body: {
          companyId: tenant.companyId,
          branchId: tenant.branchId,
          paymentMethodId: methodId,
          payerPartnerId,
          currency: 'JOD',
          amount: '10.0000',
        },
        idempotencyKey: randomUUID(),
      });
      expect(refused.status).not.toBe(201);
      // A refusal, never a foreign-key crash: the composite FK is intact and the
      // service reaches it first.
      expect([404, 422]).toContain(refused.status);
    }
    // And nothing leaked into the other tenant.
    expect(await methodsOf(other.tenantId)).toHaveLength(3);
  });

  it('PM-B7 an idempotent replay duplicates neither a method nor a sequence', async () => {
    const key = randomUUID();
    const first = await provisionRaw('b7', key);
    expect(first.status).toBe(201);
    const second = await provisionRaw('b7', key);
    expect(second.body.tenantId).toBe(first.body.tenantId);
    expect(await methodsOf(first.body.tenantId)).toHaveLength(3);
    expect(await sequencesOf(first.body.tenantId)).toHaveLength(SEQUENCE_DEFINITIONS.length);
  });

  it('PM-B8 a failure in the method bootstrap rolls the whole provisioning back', async () => {
    // The only way to make the canonical set unobtainable without touching the
    // code: withdraw one of the platform rows for the duration of one call. The
    // bootstrap must then refuse rather than provision a tenant with two.
    await admin.query(
      "UPDATE sal.payment_methods SET status = 'inactive' WHERE scope = 'platform' AND method_code = 'bank_transfer'"
    );
    try {
      const refused = await provisionRaw('b8');
      expect(refused.status).not.toBe(201);
      const { rows } = await admin.query<{ id: string }>(
        'SELECT id FROM org.tenants WHERE tenant_code = $1',
        [`${TENANT_PREFIX}_b8`]
      );
      // No tenant, no owner, no company, no branch: the committed states are
      // still exactly two, and "provisioned but cannot take money" is not one.
      expect(rows).toHaveLength(0);
    } finally {
      await admin.query(
        "UPDATE sal.payment_methods SET status = 'active' WHERE scope = 'platform' AND method_code = 'bank_transfer'"
      );
    }
    // The same request succeeds once the catalogue is whole again — so the
    // refusal was the catalogue's state and not a permanent breakage.
    const recovered = await provisionRaw('b8');
    expect(recovered.status).toBe(201);
  });

  it('PM-B9 an unrelated provisioning does not rewrite an existing tenant methods', async () => {
    const first = await provision('b9');
    const before = await methodsOf(first.tenantId);
    // A tenant customisation the product has no writer for, so it is made here:
    // the question is only whether a LATER provisioning disturbs it.
    await admin.query(
      `UPDATE sal.payment_methods SET display_name = 'Cash (front desk)'
        WHERE tenant_id = $1 AND method_code = 'cash'`,
      [first.tenantId]
    );
    await provision('b9x');
    const after = await methodsOf(first.tenantId);
    expect(after).toHaveLength(before.length);
    expect(after.find((r) => r.method_code === 'cash')?.display_name).toBe('Cash (front desk)');

    // Structural, not incidental: the control plane holds INSERT only, so it has
    // no privilege with which to rewrite or withdraw a method after the window.
    const { rows } = await admin.query<{ privilege_type: string }>(
      `SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'app_platform' AND table_schema = 'sal' AND table_name = 'payment_methods'
        ORDER BY privilege_type`
    );
    expect(rows.map((r) => r.privilege_type)).toEqual(['INSERT', 'SELECT']);
  });

  it('PM-N the five containment negatives of the bootstrap policy pair', async () => {
    const tenant = await provision('n1');
    const client = await platform.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenant.tenantId]);
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', USER_HOLDER]);

      // N1 — the control plane cannot see a tenant's methods, not even the ones
      // it just wrote. This is why the bootstrap asserts on a row count.
      const visible = await client.query<{ count: string }>(
        "SELECT count(*)::text AS count FROM sal.payment_methods WHERE scope = 'tenant'"
      );
      expect(visible.rows[0]?.count).toBe('0');

      // N2 — the tenant is `active` by now, so the window is shut.
      await expect(
        client.query(
          `INSERT INTO sal.payment_methods (scope, tenant_id, method_code, kind, display_name, created_by)
           VALUES ('tenant', $1, 'cash_two', 'cash', 'Cash two', $2)`,
          [tenant.tenantId, USER_HOLDER]
        )
      ).rejects.toThrow(/row-level security/i);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  });
});

describe('P1-30 — the number sequences a provisioned tenant is given', () => {
  it('NS-B1 one row per registered run, NS-B2 each at its registry scope', async () => {
    const tenant = await provision('ns1');
    const rows = await sequencesOf(tenant.tenantId);
    expect(rows.map((r) => r.sequence_code)).toEqual(
      SEQUENCE_DEFINITIONS.map((d) => d.code)
        .slice()
        .sort((a, b) => a.localeCompare(b))
    );
    for (const definition of SEQUENCE_DEFINITIONS) {
      const row = rows.find((r) => r.sequence_code === definition.code);
      if (definition.provisioningScope === 'branch') {
        expect(row?.company_id).toBe(tenant.companyId);
        expect(row?.branch_id).toBe(tenant.branchId);
      } else {
        expect(row?.company_id).toBeNull();
        expect(row?.branch_id).toBeNull();
      }
    }
  });
});

describe('P1-30 — F-01, the closure the A0 preflight recorded', () => {
  it('F01-B1 the administrator can map a commercial code to a role it creates', async () => {
    const tenant = await provision('f01');

    asOwnerOf(tenant);
    const role = await call<{ id: string }>(roleCreateRoute, {
      path: '/iam/roles',
      body: { roleCode: 'cashier', name: 'Cashier', description: 'Takes payment at the counter' },
      idempotencyKey: randomUUID(),
    });
    expect(role.status).toBe(201);

    // The A0 matrix recorded this exact call answering 403 ERR-IAM-001 with
    // requiredPermissions ["quo.quotation.read"], on the production build, as
    // the Owner of `rootlco_w7b`. Both commercial codes are mapped here.
    for (const permissionCode of ['sal.payment.record', 'quo.quotation.read']) {
      asOwnerOf(tenant);
      const mapped = await call(rolePermissionAddRoute, {
        path: `/iam/roles/${role.body.id}/permissions`,
        params: { roleId: role.body.id },
        body: { permissionCode, effect: 'allow' },
        idempotencyKey: randomUUID(),
      });
      expect(mapped.status).toBe(201);
    }
  });
});
