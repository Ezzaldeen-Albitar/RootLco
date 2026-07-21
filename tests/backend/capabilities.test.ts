/**
 * Executed evidence that DBCR-P1-13-001 is applied and sufficient
 * (P1-13-SEC-002).
 *
 * The change request recorded that the `app_runtime` archetype could not append
 * an audit record, publish an outbox event, store an idempotency key, or record
 * a security event. Migration
 * `20260725090000_iam_shared_runtime_write_capabilities.sql` closes that gap.
 * A claim read off a migration file is an opinion; this suite turns it into a
 * measurement, taken through the same `preflightPrivileges()` the application
 * itself runs at boot, on the identity the application actually deploys with.
 *
 * Three things are asserted, and none of them is sufficient alone:
 *
 *  - the four capabilities report AVAILABLE on `app_runtime`, so the foundation
 *    no longer fails closed and every later phase can emit audit records and
 *    events;
 *  - the role still carries NO BYPASSRLS, so the capability was granted without
 *    dissolving the isolation it operates inside;
 *  - the fail-closed path itself still works. It would be easy to "fix" the gap
 *    by weakening `requireCapability`, and then nothing would guard a future
 *    environment where a grant is missing. The gate is therefore exercised
 *    against a capability that genuinely is not held — outbox *dispatch*, which
 *    the migration deliberately left with `app_worker`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  READONLY_LOGIN,
  RUNTIME_LOGIN,
  TENANT_A,
  USER_PERMITTED,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  ensureBackendFixtures,
  ensureTestLogins,
  expectSqlState,
  readonlyAppPool,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import {
  FOUNDATION_CAPABILITIES,
  __resetCapabilitiesForTests,
  preflightPrivileges,
  type PrivilegePreflight,
} from '@/server/db/capabilities';
import { requireCapability } from '@/server/db/require-capability';
import { AppFailure } from '@/server/errors/app-failure';

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

async function preflightOn(pool: Pool): Promise<PrivilegePreflight> {
  __setPrimaryPoolForTests(pool);
  __resetCapabilitiesForTests();
  return withTransaction(contextFor({}), (db) => preflightPrivileges(db));
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool();
  readonly = readonlyAppPool();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await readonly.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('preflight under the deployed runtime identity', () => {
  it('reports all four foundation write capabilities as available', async () => {
    const preflight = await preflightOn(runtime);

    expect(preflight.currentRole).toBe(RUNTIME_LOGIN);
    expect(preflight.missing).toEqual([]);
    for (const report of preflight.capabilities) {
      expect(report.available, `${report.capability} must be available`).toBe(true);
      // The probe text is the evidence the change request quotes.
      expect(report.probe).toContain('current_user');
    }
    expect([...preflight.capabilities].map((r) => r.capability).sort()).toEqual(
      [...FOUNDATION_CAPABILITIES].sort()
    );
  });

  it('confirms the runtime login still carries no BYPASSRLS attribute', async () => {
    const preflight = await preflightOn(runtime);
    expect(preflight.bypassRlsAbsent).toBe(true);
  });

  it('passes requireCapability for every foundation capability', async () => {
    __setPrimaryPoolForTests(runtime);
    __resetCapabilitiesForTests();

    await withTransaction(contextFor({}), async (db) => {
      for (const capability of FOUNDATION_CAPABILITIES) {
        await expect(requireCapability(db, capability)).resolves.toBeUndefined();
      }
    });
  });

  it('writes an outbox envelope for its own tenant through the real grant', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', TENANT_A]);
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', USER_PERMITTED]);
      const inserted = await client.query<{ id: string; status: string }>(
        `INSERT INTO shared.event_outbox
           (tenant_id, event_key, event_type, aggregate_type, aggregate_id, schema_version,
            aggregate_version, producer, payload, headers, created_by)
         VALUES ($1, 'fx_p1_13_granted_probe', 'document.accepted', 'shared.document',
                 gen_random_uuid(), 1, 1, 'meta', '{}'::jsonb, '{}'::jsonb, $2)
         RETURNING id, status`,
        [TENANT_A, USER_PERMITTED]
      );
      expect(inserted.rows[0]?.status).toBe('pending');
    } finally {
      // Rolled back: this suite measures capability, it does not leave queue work.
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('the fail-closed gate is still armed', () => {
  it('refuses a capability the migration deliberately did not grant', async () => {
    // Dispatch stays with app_worker. If this ever starts passing, a producer
    // has gained the power to drain every tenant's queue.
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', TENANT_A]);
      const state = await expectSqlState(
        client.query(`SELECT * FROM shared.claim_outbox_events('fx-probe', 1)`),
        '42501'
      );
      expect(state).toBe('42501');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('reports every capability missing on the read-only archetype', async () => {
    // app_readonly was granted nothing by DBCR-P1-13-001 and must stay that way.
    // This doubles as the negative control for the suite above: if the migration
    // had been written with a role-less GRANT, this would light up.
    const preflight = await preflightOn(readonly);

    expect(preflight.currentRole).toBe(READONLY_LOGIN);
    expect([...preflight.missing].sort()).toEqual([...FOUNDATION_CAPABILITIES].sort());
    expect(preflight.bypassRlsAbsent).toBe(true);
  });

  it('fails closed through requireCapability with ERR-SYS-001 naming the capability', async () => {
    // Exercised on a connection that genuinely lacks the capability rather than
    // on a simulated one, so the proof is about the database and not about a
    // stub. Deleting this test would remove the only evidence that a wrongly
    // provisioned deployment is refused rather than silently degraded.
    __setPrimaryPoolForTests(readonly);
    __resetCapabilitiesForTests();

    const failure = await withTransaction(contextFor({}), async (db) => {
      try {
        await requireCapability(db, 'audit.append');
        return null;
      } catch (error) {
        return error;
      }
    });

    expect(failure).toBeInstanceOf(AppFailure);
    const appFailure = failure as AppFailure;
    expect(appFailure.code).toBe('ERR-SYS-001');
    expect(appFailure.status).toBe(500);
    expect(appFailure.message).toContain('audit.append');
    expect(appFailure.message).toContain(READONLY_LOGIN);
    expect(appFailure.message).toContain('DBCR-P1-13-001');
    // Nothing about the platform's grant configuration may reach a caller.
    expect(appFailure.safeDetails).toEqual({});
  });
});
