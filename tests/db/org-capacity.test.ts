/**
 * Subscription capacity enforcement — migration 20260916093000.
 *
 * `org.subscription_plans.capacity_limits` was validated on write and read by
 * nothing, so every ceiling a plan declared was decoration. These cases prove
 * the reader at the database, where every writer — the two new creation
 * operations, the invitation path, and anything a later phase adds — has to
 * pass through it.
 *
 * Each case builds its OWN organisation under the `odorg_` prefix and the
 * cleanup removes exactly that prefix. Attaching a limited plan to the shared
 * fixture tenants would change the ceiling every other suite runs under.
 *
 * Obligations:
 *   1. no subscription, or a plan naming no key, is UNLIMITED — never zero;
 *   2. a reached ceiling refuses with `capacity_limit_reached` and a json DETAIL
 *      naming kind, limit and used, for companies, branches and user seats;
 *   3. an archived account holds no seat and a soft-deleted branch holds no
 *      capacity;
 *   4. a tenant in `provisioning` is exempt; a suspended one is refused with
 *      `tenant_not_active`;
 *   5. two concurrent creations of the last permitted branch: exactly one wins;
 *   6. the RESTRICTIVE insert policies require the manage permission AND an
 *      unnarrowed session, and never admit another tenant;
 *   7. the branch numbering authority admits only a per-branch row of this
 *      tenant, under org.branch.manage;
 *   8. org.capacity_usage publishes the fixed shape with null for unlimited.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import {
  adminPool,
  deleteTenantCascade,
  ensureOrgFixtures,
  ensureTestLogins,
  expectSqlState,
  runtimeClient,
  setContext,
  type SessionContext,
} from './helpers';

const admin = adminPool();
const SYS = '00000000-0000-4000-8000-000000000001';
const RUN = randomUUID().slice(0, 8);
const PREFIX = 'odorg_';
let sequence = 0;

type Limits = Partial<Record<'max_companies' | 'max_branches' | 'max_users', number>>;

interface Organisation {
  readonly tenantId: string;
  readonly companyId: string;
  readonly actorId: string;
}

const nextCode = (label: string): string => `${PREFIX}${label}_${RUN}_${++sequence}`;

/**
 * An organisation with one company, one actor, and — when `limits` is given —
 * an active subscription to a plan declaring exactly those limits.
 *
 * Built as the owner in the order the ceilings allow: the company and the
 * actor land BEFORE the subscription is attached, so they are written under no
 * ceiling at all, and every case below counts them as already in use. The
 * tenant is inserted `active` directly, as the shared org fixtures are — this is
 * a fixture, not the lifecycle under test.
 */
async function organisation(
  input: { readonly limits?: Limits; readonly codes?: readonly string[] } = {}
): Promise<Organisation> {
  const tenantId = randomUUID();
  const companyId = randomUUID();
  const actorId = randomUUID();
  await admin.query(
    `INSERT INTO org.tenants (id, tenant_code, display_name, status, default_locale, default_timezone, created_by)
     VALUES ($1, $2, 'Capacity fixture', 'active', 'en', 'UTC', $3)`,
    [tenantId, nextCode('t'), SYS]
  );
  await admin.query(
    `INSERT INTO org.legal_companies (id, tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, $2, $3, 'Capacity fixture company', 'USD', $4)`,
    [companyId, tenantId, nextCode('c'), SYS]
  );
  const subject = nextCode('s');
  await admin.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, 'test_harness', $3, $4, 'Capacity fixture actor', 'active', $5)`,
    [actorId, tenantId, subject, `${subject}@example.test`, SYS]
  );
  const codes = input.codes ?? ['org.company.manage', 'org.branch.manage'];
  if (codes.length > 0) {
    const roleId = randomUUID();
    await admin.query(
      `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by) VALUES ($1, $2, $3, 'Capacity fixture role', $4)`,
      [roleId, tenantId, nextCode('r'), SYS]
    );
    await admin.query(
      `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
       SELECT $1, $2, id, 'allow', $3 FROM iam.permissions WHERE permission_code = ANY($4::text[])`,
      [tenantId, roleId, SYS, codes]
    );
    await admin.query(
      `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1, $2, $3, 'unrestricted', 'active', $4, $4)`,
      [tenantId, actorId, roleId, SYS]
    );
  }
  if (input.limits !== undefined) {
    const planId = randomUUID();
    await admin.query(
      `INSERT INTO org.subscription_plans (id, plan_code, name, capacity_limits, status, effective_from, created_by)
       VALUES ($1, $2, 'Capacity fixture plan', $3::jsonb, 'active', now() - interval '1 day', $4)`,
      [planId, nextCode('p'), JSON.stringify(input.limits), SYS]
    );
    await admin.query(
      `INSERT INTO org.tenant_subscriptions (tenant_id, plan_id, status, effective_from, assigned_by, created_by)
       VALUES ($1, $2, 'active', now() - interval '1 day', $3, $3)`,
      [tenantId, planId, SYS]
    );
  }
  return { tenantId, companyId, actorId };
}

const insertBranchAsOwner = (org: Organisation, companyId = org.companyId) =>
  admin.query(
    `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1, $2, $3, 'Capacity fixture branch', 'UTC', $4) RETURNING id`,
    [org.tenantId, companyId, nextCode('b'), SYS]
  );

const insertCompanyAsOwner = (org: Organisation) =>
  admin.query(
    `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
     VALUES ($1, $2, 'Capacity fixture company', 'USD', $3) RETURNING id`,
    [org.tenantId, nextCode('c'), SYS]
  );

const insertUserAsOwner = (org: Organisation, status = 'invited') => {
  const subject = nextCode('u');
  return admin.query(
    `INSERT INTO iam.user_accounts
       (tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, 'test_harness', $2, $3, 'Capacity fixture user', $4, $5) RETURNING id`,
    [org.tenantId, subject, `${subject}@example.test`, status, SYS]
  );
};

/** Runs `fn` as app_runtime in its own committed-or-rolled-back transaction. */
async function asRuntime<T>(
  ctx: SessionContext,
  fn: (client: Client) => Promise<T>,
  commit = false
): Promise<T> {
  const client = runtimeClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, ctx);
    const result = await fn(client);
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

/** The refusal, captured whole: SQLSTATE, message and parsed DETAIL. */
async function refusal(
  promise: Promise<unknown>
): Promise<{ code: string; message: string; detail: unknown }> {
  try {
    await promise;
  } catch (error) {
    const e = error as { code?: string; message?: string; detail?: string };
    return {
      code: e.code ?? '(none)',
      message: e.message ?? '',
      detail: e.detail === undefined ? undefined : JSON.parse(e.detail),
    };
  }
  throw new Error('expected the statement to be refused, and it succeeded');
}

const usage = async (tenantId: string) =>
  (await admin.query<{ usage: unknown }>(`SELECT org.capacity_usage($1) AS usage`, [tenantId]))
    .rows[0]!.usage;

beforeAll(async () => {
  await ensureTestLogins(admin);
  // Reference rows only (currencies, timezones, languages); the shared tenants
  // it also writes are never given a subscription here.
  await ensureOrgFixtures(admin);
});

afterAll(async () => {
  const { rows } = await admin.query<{ id: string }>(
    `SELECT id FROM org.tenants WHERE tenant_code LIKE 'odorg\\_%'`
  );
  await deleteTenantCascade(
    admin,
    rows.map((row) => row.id)
  );
  await admin.query(`DELETE FROM org.subscription_plans WHERE plan_code LIKE 'odorg\\_%'`);
  await admin.end();
});

describe('capacity: unlimited is the absence of a ceiling, never zero (1, 8)', () => {
  it('admits growth with no subscription and publishes null limits', async () => {
    const org = await organisation();
    await insertCompanyAsOwner(org);
    await insertBranchAsOwner(org);
    await insertUserAsOwner(org);
    expect(await usage(org.tenantId)).toEqual({
      companies: { used: 2, limit: null },
      branches: { used: 1, limit: null },
      users: { used: 2, limit: null },
    });
  });

  it('treats a plan that names no key for a kind as unlimited for that kind', async () => {
    const org = await organisation({ limits: { max_users: 5 } });
    await insertBranchAsOwner(org);
    await insertBranchAsOwner(org);
    const shape = (await usage(org.tenantId)) as Record<string, { limit: number | null }>;
    expect(shape.branches!.limit).toBeNull();
    expect(shape.companies!.limit).toBeNull();
    expect(shape.users!.limit).toBe(5);
  });
});

describe('capacity: a reached ceiling refuses with a machine-readable detail (2)', () => {
  it('refuses the company beyond max_companies', async () => {
    const org = await organisation({ limits: { max_companies: 1 } });
    const refused = await refusal(insertCompanyAsOwner(org));
    expect(refused).toEqual({
      code: '23514',
      message: 'capacity_limit_reached',
      detail: { kind: 'companies', limit: 1, used: 1 },
    });
  });

  it('refuses the branch beyond max_branches', async () => {
    const org = await organisation({ limits: { max_branches: 2 } });
    await insertBranchAsOwner(org);
    await insertBranchAsOwner(org);
    const refused = await refusal(insertBranchAsOwner(org));
    expect(refused).toEqual({
      code: '23514',
      message: 'capacity_limit_reached',
      detail: { kind: 'branches', limit: 2, used: 2 },
    });
  });

  it('refuses the seat beyond max_users', async () => {
    // The actor already holds one seat.
    const org = await organisation({ limits: { max_users: 2 } });
    await insertUserAsOwner(org, 'invited');
    const refused = await refusal(insertUserAsOwner(org, 'invited'));
    expect(refused).toEqual({
      code: '23514',
      message: 'capacity_limit_reached',
      detail: { kind: 'users', limit: 2, used: 2 },
    });
  });
});

describe('capacity: only live units hold capacity (3)', () => {
  it('does not count an archived account as a seat', async () => {
    const org = await organisation({ limits: { max_users: 2 } });
    const locked = await insertUserAsOwner(org, 'invited');
    await admin.query(
      `UPDATE iam.user_accounts SET status = 'archived', deleted_at = now() WHERE id = $1`,
      [locked.rows[0]!.id]
    );
    // One seat (the actor) is held; the archived account holds none.
    await insertUserAsOwner(org, 'invited');
    expect(((await usage(org.tenantId)) as { users: unknown }).users).toEqual({
      used: 2,
      limit: 2,
    });
  });

  it('does not count a soft-deleted branch', async () => {
    const org = await organisation({ limits: { max_branches: 1 } });
    const first = await insertBranchAsOwner(org);
    await admin.query(`UPDATE org.branches SET deleted_at = now(), deleted_by = $2 WHERE id = $1`, [
      first.rows[0]!.id,
      SYS,
    ]);
    await insertBranchAsOwner(org);
    expect(((await usage(org.tenantId)) as { branches: unknown }).branches).toEqual({
      used: 1,
      limit: 1,
    });
  });
});

describe('capacity: organisation status (4)', () => {
  it('exempts a tenant that is still provisioning', async () => {
    const tenantId = randomUUID();
    await admin.query(
      `INSERT INTO org.tenants (id, tenant_code, display_name, default_locale, default_timezone, created_by)
       VALUES ($1, $2, 'Provisioning fixture', 'en', 'UTC', $3)`,
      [tenantId, nextCode('t'), SYS]
    );
    const planId = randomUUID();
    await admin.query(
      `INSERT INTO org.subscription_plans (id, plan_code, name, capacity_limits, status, effective_from, created_by)
       VALUES ($1, $2, 'Zero plan', '{"max_companies":0,"max_branches":0,"max_users":0}'::jsonb, 'active', now() - interval '1 day', $3)`,
      [planId, nextCode('p'), SYS]
    );
    await admin.query(
      `INSERT INTO org.tenant_subscriptions (tenant_id, plan_id, status, effective_from, assigned_by, created_by)
       VALUES ($1, $2, 'active', now() - interval '1 day', $3, $3)`,
      [tenantId, planId, SYS]
    );
    const company = await admin.query<{ id: string }>(
      `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
       VALUES ($1, $2, 'Provisioning company', 'USD', $3) RETURNING id`,
      [tenantId, nextCode('c'), SYS]
    );
    await admin.query(
      `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
       VALUES ($1, $2, $3, 'Provisioning branch', 'UTC', $4)`,
      [tenantId, company.rows[0]!.id, nextCode('b'), SYS]
    );
    // Zero ceilings, and both writes landed: the exemption is real.
    expect(await usage(tenantId)).toEqual({
      companies: { used: 1, limit: 0 },
      branches: { used: 1, limit: 0 },
      users: { used: 0, limit: 0 },
    });
  });

  it('refuses growth of a suspended organisation with tenant_not_active', async () => {
    const tenantId = randomUUID();
    await admin.query(
      `INSERT INTO org.tenants (id, tenant_code, display_name, status, default_locale, default_timezone, created_by)
       VALUES ($1, $2, 'Suspended fixture', 'suspended', 'en', 'UTC', $3)`,
      [tenantId, nextCode('t'), SYS]
    );
    const refused = await refusal(
      admin.query(
        `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
         VALUES ($1, $2, 'Refused company', 'USD', $3)`,
        [tenantId, nextCode('c'), SYS]
      )
    );
    expect(refused.code).toBe('23514');
    expect(refused.message).toBe('tenant_not_active');
    expect(refused.detail).toEqual({ status: 'suspended' });
  });
});

describe('capacity: concurrency (5)', () => {
  it('lets exactly one of two concurrent last-branch creations win (x3)', async () => {
    for (let rep = 0; rep < 3; rep++) {
      const org = await organisation({ limits: { max_branches: 1 } });
      const ctx: SessionContext = { tenantId: org.tenantId, userId: org.actorId };

      const attempt = async (): Promise<string> => {
        const client = runtimeClient();
        await client.connect();
        try {
          await client.query('BEGIN');
          await setContext(client, ctx);
          await client.query(
            `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
             VALUES ($1, $2, $3, 'Race branch', 'UTC', $4)`,
            [org.tenantId, org.companyId, nextCode('race'), org.actorId]
          );
          // Hold the transaction open briefly so the two genuinely overlap.
          await client.query('SELECT pg_sleep(0.2)');
          await client.query('COMMIT');
          return 'ok';
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          const e = error as { code?: string; message?: string };
          return `${e.code}:${e.message}`;
        } finally {
          await client.end();
        }
      };

      const results = await Promise.all([attempt(), attempt()]);
      expect(
        results.filter((r) => r === 'ok'),
        `rep ${rep}: exactly one winner`
      ).toHaveLength(1);
      expect(
        results.filter((r) => r === '23514:capacity_limit_reached'),
        `rep ${rep}: the loser is refused by the ceiling`
      ).toHaveLength(1);
      const committed = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM org.branches WHERE tenant_id = $1`,
        [org.tenantId]
      );
      expect(committed.rows[0]!.n).toBe(1);
    }
  });
});

describe('capacity: the RESTRICTIVE creation authority (6)', () => {
  it('admits an unnarrowed actor holding the manage permission', async () => {
    const org = await organisation();
    const ctx = { tenantId: org.tenantId, userId: org.actorId };
    const created = await asRuntime(ctx, (client) =>
      client.query(
        `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
         VALUES ($1, $2, $3, 'Runtime branch', 'UTC', $4) RETURNING id`,
        [org.tenantId, org.companyId, nextCode('b'), org.actorId]
      )
    );
    expect(created.rows).toHaveLength(1);
    const company = await asRuntime(ctx, (client) =>
      client.query(
        `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
         VALUES ($1, $2, 'Runtime company', 'USD', $3) RETURNING id`,
        [org.tenantId, nextCode('c'), org.actorId]
      )
    );
    expect(company.rows).toHaveLength(1);
  });

  it('refuses an actor without org.branch.manage or org.company.manage', async () => {
    const org = await organisation({ codes: ['org.branch.read', 'org.company.read'] });
    const ctx = { tenantId: org.tenantId, userId: org.actorId };
    await expectSqlState(
      asRuntime(ctx, (client) =>
        client.query(
          `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
           VALUES ($1, $2, $3, 'Refused branch', 'UTC', $4)`,
          [org.tenantId, org.companyId, nextCode('b'), org.actorId]
        )
      ),
      '42501'
    );
    await expectSqlState(
      asRuntime(ctx, (client) =>
        client.query(
          `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
           VALUES ($1, $2, 'Refused company', 'USD', $3)`,
          [org.tenantId, nextCode('c'), org.actorId]
        )
      ),
      '42501'
    );
  });

  it('refuses a company-narrowed session even with the permission', async () => {
    const org = await organisation();
    const ctx = { tenantId: org.tenantId, userId: org.actorId, companyIds: [org.companyId] };
    await expectSqlState(
      asRuntime(ctx, (client) =>
        client.query(
          `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
           VALUES ($1, $2, $3, 'Narrowed branch', 'UTC', $4)`,
          [org.tenantId, org.companyId, nextCode('b'), org.actorId]
        )
      ),
      '42501'
    );
    await expectSqlState(
      asRuntime(ctx, (client) =>
        client.query(
          `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
           VALUES ($1, $2, 'Narrowed company', 'USD', $3)`,
          [org.tenantId, nextCode('c'), org.actorId]
        )
      ),
      '42501'
    );
  });

  it('never admits a write into another tenant (isolation)', async () => {
    const alpha = await organisation();
    const bravo = await organisation();
    // Bravo's administrator, holding both permissions, names alpha's tenant.
    const ctx = { tenantId: bravo.tenantId, userId: bravo.actorId };
    await expectSqlState(
      asRuntime(ctx, (client) =>
        client.query(
          `INSERT INTO org.legal_companies (tenant_id, company_code, legal_name, base_currency_code, created_by)
           VALUES ($1, $2, 'Cross-tenant company', 'USD', $3)`,
          [alpha.tenantId, nextCode('c'), bravo.actorId]
        )
      ),
      '42501'
    );
    await expectSqlState(
      asRuntime(ctx, (client) =>
        client.query(
          `INSERT INTO org.branches (tenant_id, company_id, branch_code, name, timezone_name, created_by)
           VALUES ($1, $2, $3, 'Cross-tenant branch', 'UTC', $4)`,
          [alpha.tenantId, alpha.companyId, nextCode('b'), bravo.actorId]
        )
      ),
      '42501'
    );
    // And bravo's session cannot read alpha's usage: the counts run under RLS.
    const seen = await asRuntime(ctx, (client) =>
      client.query<{ usage: { companies: { used: number } } }>(
        `SELECT org.capacity_usage($1) AS usage`,
        [alpha.tenantId]
      )
    );
    expect(seen.rows[0]!.usage.companies.used).toBe(0);
  });
});

describe('capacity: the per-branch numbering authority (7)', () => {
  it('admits the branch-scoped runs for a real branch of this tenant', async () => {
    const org = await organisation();
    const ctx = { tenantId: org.tenantId, userId: org.actorId };
    const branch = await insertBranchAsOwner(org);
    const written = await asRuntime(ctx, (client) =>
      client.query(
        `INSERT INTO shared.number_sequences (tenant_id, company_id, branch_id, sequence_code, created_by)
         VALUES ($1, $2, $3, 'invoice', $4)`,
        [org.tenantId, org.companyId, branch.rows[0]!.id, org.actorId]
      )
    );
    expect(written.rowCount).toBe(1);
  });

  it('refuses a tenant-wide run, which stays platform-only', async () => {
    const org = await organisation();
    const ctx = { tenantId: org.tenantId, userId: org.actorId };
    await expectSqlState(
      asRuntime(ctx, (client) =>
        client.query(
          `INSERT INTO shared.number_sequences (tenant_id, sequence_code, created_by)
           VALUES ($1, 'vehicle', $2)`,
          [org.tenantId, org.actorId]
        )
      ),
      '42501'
    );
  });

  it('refuses without org.branch.manage, and refuses another tenant', async () => {
    const reader = await organisation({ codes: ['org.branch.read'] });
    const branch = await insertBranchAsOwner(reader);
    await expectSqlState(
      asRuntime({ tenantId: reader.tenantId, userId: reader.actorId }, (client) =>
        client.query(
          `INSERT INTO shared.number_sequences (tenant_id, company_id, branch_id, sequence_code, created_by)
           VALUES ($1, $2, $3, 'invoice', $4)`,
          [reader.tenantId, reader.companyId, branch.rows[0]!.id, reader.actorId]
        )
      ),
      '42501'
    );
    const other = await organisation();
    await expectSqlState(
      asRuntime({ tenantId: other.tenantId, userId: other.actorId }, (client) =>
        client.query(
          `INSERT INTO shared.number_sequences (tenant_id, company_id, branch_id, sequence_code, created_by)
           VALUES ($1, $2, $3, 'invoice', $4)`,
          [reader.tenantId, reader.companyId, branch.rows[0]!.id, other.actorId]
        )
      ),
      '42501'
    );
  });
});
