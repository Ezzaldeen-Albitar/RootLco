/**
 * P1-32-PRE-023/024 — row-level security and integrity for the three tables the
 * Platform Owner Console adds: org.tenant_subscription_events,
 * org.subscription_charges and org.subscription_receipts.
 *
 * Proven on the real roles, never on the owner:
 *
 *   * app_runtime reads its OWN tenant's subscription events and nobody else's,
 *     and can write none;
 *   * app_runtime holds no privilege at all on charges or receipts — platform
 *     revenue is not tenant data;
 *   * app_platform without a grant reads nothing and writes nothing;
 *   * app_platform WITH `platform.billing.manage` is still bound by the
 *     database: a receipt in another currency is refused, and a charge settles
 *     exactly once.
 *
 * Fixture rows are written by the admin connection in tenants A and B and are
 * removed by the shared tenant cascade; the one platform-global row, a plan,
 * carries the `odpc_` prefix and is removed by that prefix alone.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import {
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
  adminPool,
  cleanFixtures,
  ensureOrgFixtures,
  ensureTestLogins,
  platformClient,
  runtimePool,
  setContext,
  withRolledBackTx,
} from './helpers';

const admin = adminPool();
const runtime = runtimePool();
const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';
const RUN = Math.random().toString(36).slice(2, 8);
const PLAN_CODE = `odpc_db_${RUN}`;

let planId = '';
let subscriptionA = '';
let subscriptionB = '';
let chargeA = '';

async function sqlState(run: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await run();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

async function asPlatform<T>(userId: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = platformClient();
  await client.connect();
  try {
    await client.query('BEGIN');
    await setContext(client, { tenantId: TENANT_A, userId });
    return await fn(client);
  } finally {
    await client.query('ROLLBACK');
    await client.end();
  }
}

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  planId = (
    await admin.query<{ id: string }>(
      `INSERT INTO org.subscription_plans
         (plan_code, name, status, effective_from, list_price, currency_code, term_months, created_by)
       VALUES ($1, 'Isolation probe plan', 'active', '2020-01-01', 10, 'JOD', 12, $2)
       RETURNING id`,
      [PLAN_CODE, SYSTEM_ACTOR]
    )
  ).rows[0]!.id;
  const subscribe = async (tenantId: string) =>
    (
      await admin.query<{ id: string }>(
        `INSERT INTO org.tenant_subscriptions
           (tenant_id, plan_id, status, effective_from, effective_to, assigned_by, created_by)
         VALUES ($1, $2, 'active', now() - interval '1 day', now() + interval '1 year', $3, $3)
         RETURNING id`,
        [tenantId, planId, SYSTEM_ACTOR]
      )
    ).rows[0]!.id;
  subscriptionA = await subscribe(TENANT_A);
  subscriptionB = await subscribe(TENANT_B);
  for (const [tenantId, subscriptionId] of [
    [TENANT_A, subscriptionA],
    [TENANT_B, subscriptionB],
  ] as const) {
    await admin.query(
      `INSERT INTO org.tenant_subscription_events
         (tenant_id, subscription_id, event_kind, to_plan_id, effective_from, reason, created_by)
       VALUES ($1, $2, 'assigned', $3, current_date, 'isolation probe', $4)`,
      [tenantId, subscriptionId, planId, SYSTEM_ACTOR]
    );
  }
  chargeA = (
    await admin.query<{ id: string }>(
      `INSERT INTO org.subscription_charges
         (tenant_id, subscription_id, amount, currency_code, due_on, description, created_by)
       VALUES ($1, $2, 100, 'JOD', current_date, 'isolation probe charge', $3)
       RETURNING id`,
      [TENANT_A, subscriptionA, SYSTEM_ACTOR]
    )
  ).rows[0]!.id;
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.query('DELETE FROM org.subscription_plans WHERE plan_code = $1', [PLAN_CODE]);
  await admin.end();
  await runtime.end();
});

describe('P1-32 subscription and billing tables', () => {
  it('enable and FORCE row-level security on all three', async () => {
    const { rows } = await admin.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'org'
          AND c.relname IN ('tenant_subscription_events', 'subscription_charges', 'subscription_receipts')
        ORDER BY c.relname`
    );
    expect(rows).toEqual([
      { relname: 'subscription_charges', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'subscription_receipts', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'tenant_subscription_events', relrowsecurity: true, relforcerowsecurity: true },
    ]);
  });

  it('lets a tenant read its own subscription events and never another tenant', async () => {
    const seen = async (tenantId: string, userId: string) =>
      withRolledBackTx(runtime, { tenantId, userId }, async (client) =>
        (
          await client.query<{ subscription_id: string }>(
            'SELECT subscription_id FROM org.tenant_subscription_events'
          )
        ).rows.map((row) => row.subscription_id)
      );
    expect(await seen(TENANT_A, USER_A)).toEqual([subscriptionA]);
    expect(await seen(TENANT_B, USER_B)).toEqual([subscriptionB]);
  });

  it('gives the tenant runtime no write on events and no privilege at all on revenue', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (client) => {
      expect(
        await sqlState(() =>
          client.query(
            `INSERT INTO org.tenant_subscription_events
               (tenant_id, subscription_id, event_kind, effective_from, reason, created_by)
             VALUES ($1, $2, 'renewed', current_date, 'forged', $3)`,
            [TENANT_A, subscriptionA, USER_A]
          )
        )
      ).toBe('42501');
    });
    for (const table of ['org.subscription_charges', 'org.subscription_receipts']) {
      await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (client) => {
        expect(await sqlState(() => client.query(`SELECT 1 FROM ${table}`))).toBe('42501');
      });
    }
  });

  it('shows app_platform nothing and admits no write without a platform grant', async () => {
    await asPlatform(USER_A, async (client) => {
      expect((await client.query('SELECT 1 FROM org.tenant_subscription_events')).rowCount).toBe(0);
      expect((await client.query('SELECT 1 FROM org.subscription_charges')).rowCount).toBe(0);
      expect(
        await sqlState(() =>
          client.query(
            `INSERT INTO org.subscription_charges
               (tenant_id, amount, currency_code, due_on, description, created_by)
             VALUES ($1, 5, 'JOD', current_date, 'no grant', $2)`,
            [TENANT_B, USER_A]
          )
        )
      ).toBe('42501');
    });
  });

  it('holds a billing manager to the currency rule and settles a charge exactly once', async () => {
    await admin.query(
      `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
       VALUES ($1, 'platform.billing.manage', $2, $2) ON CONFLICT DO NOTHING`,
      [USER_A, SYSTEM_ACTOR]
    );
    try {
      await asPlatform(USER_A, async (client) => {
        const receipt = (amount: string, currency: string) =>
          client.query(
            `INSERT INTO org.subscription_receipts
               (tenant_id, charge_id, amount, currency_code, received_on, method, created_by)
             VALUES ($1, $2, $3::numeric, $4, current_date, 'transfer', $5)`,
            [TENANT_A, chargeA, amount, currency, USER_A]
          );
        await client.query('SAVEPOINT currency');
        expect(await sqlState(() => receipt('10', 'USD'))).toBe('23514');
        await client.query('ROLLBACK TO SAVEPOINT currency');

        await receipt('100', 'JOD');
        const settled = await client.query<{ status: string; record_version: number }>(
          'SELECT status, record_version FROM org.subscription_charges WHERE id = $1',
          [chargeA]
        );
        expect(settled.rows[0]!.status).toBe('settled');
        await receipt('1', 'JOD');
        const after = await client.query<{ status: string; record_version: number }>(
          'SELECT status, record_version FROM org.subscription_charges WHERE id = $1',
          [chargeA]
        );
        expect(after.rows[0]).toEqual(settled.rows[0]);

        await client.query('SAVEPOINT revive');
        expect(
          await sqlState(() =>
            client.query(
              "UPDATE org.subscription_charges SET status = 'void', void_reason = 'late' WHERE id = $1",
              [chargeA]
            )
          )
        ).toBe('23514');
        await client.query('ROLLBACK TO SAVEPOINT revive');
      });
    } finally {
      await admin.query(
        "DELETE FROM iam.platform_grants WHERE account_id = $1 AND permission_code = 'platform.billing.manage'",
        [USER_A]
      );
    }
  });
});
