/**
 * Executed evidence for DBCR-P1-13-001 (P1-13-SEC-002).
 *
 * The change request claims the `app_runtime` archetype cannot append an audit
 * record, publish an outbox event, store an idempotency key, or record a
 * security event. A claim read off a migration file is an opinion; this suite
 * turns it into a measurement, taken through the same `preflightPrivileges()`
 * the application itself runs at boot.
 *
 * Both halves matter and neither is sufficient alone:
 *
 *  - under the deployed identity the four capabilities MUST report missing, and
 *    the gate MUST fail closed with a message naming the capability and the
 *    change request — not a bare 42501 surfacing from three layers down. A
 *    foundation that "degraded gracefully" here would commit state changes with
 *    no audit record, which is worse than refusing the command;
 *  - under a role holding exactly what the change request proposes, the same
 *    preflight MUST report all four available. That is what makes the request
 *    falsifiable: it proves the proposed grant set is sufficient rather than
 *    merely plausible, and it is why the rest of these suites can execute the
 *    real transactional behaviour instead of describing it.
 *
 * The day the change request is approved and applied to `app_runtime`, the first
 * half of this suite is the thing that must be revisited — deliberately, and
 * with the diff in hand.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  CR_REHEARSAL_LOGIN,
  RUNTIME_LOGIN,
  TENANT_A,
  USER_PERMITTED,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  crRehearsalPool,
  dropCrRehearsalRole,
  ensureBackendFixtures,
  ensureCrRehearsalRole,
  ensureTestLogins,
  expectSqlState,
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
let rehearsal: Pool;

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
  await ensureCrRehearsalRole(admin);
  runtime = runtimeAppPool();
  rehearsal = crRehearsalPool();
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await rehearsal.end();
  await cleanBackendFixtures(admin);
  await dropCrRehearsalRole(admin);
  await admin.end();
});

describe('preflight under the deployed runtime identity', () => {
  it('reports all four foundation write capabilities as missing', async () => {
    const preflight = await preflightOn(runtime);

    expect(preflight.currentRole).toBe(RUNTIME_LOGIN);
    expect([...preflight.missing].sort()).toEqual([...FOUNDATION_CAPABILITIES].sort());
    for (const report of preflight.capabilities) {
      expect(report.available).toBe(false);
      // The probe text is the evidence the change request quotes.
      expect(report.probe).toContain('current_user');
    }
  });

  it('confirms the runtime login carries no BYPASSRLS attribute', async () => {
    const preflight = await preflightOn(runtime);
    expect(preflight.bypassRlsAbsent).toBe(true);
  });

  it('refuses an outbox INSERT with insufficient_privilege at the database', async () => {
    const client = await runtime.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', TENANT_A]);
      await client.query('SELECT set_config($1, $2, true)', ['app.user_id', USER_PERMITTED]);
      const state = await expectSqlState(
        client.query(
          `INSERT INTO shared.event_outbox
             (tenant_id, event_key, event_type, aggregate_type, aggregate_id, schema_version,
              aggregate_version, producer, payload, headers, created_by)
           VALUES ($1, 'fx_p1_13_denied_probe', 'document.accepted', 'shared.document',
                   gen_random_uuid(), 1, 1, 'meta', '{}'::jsonb, '{}'::jsonb, $2)`,
          [TENANT_A, USER_PERMITTED]
        ),
        // 42501 is the grant refusal; 42501 is also what a policy-less table
        // yields for a role with no INSERT privilege at all. Either is a denial.
        '42501'
      );
      expect(state).toBe('42501');
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });

  it('fails closed through requireCapability with ERR-SYS-001 naming the capability', async () => {
    __setPrimaryPoolForTests(runtime);
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
    expect(appFailure.message).toContain(RUNTIME_LOGIN);
    expect(appFailure.message).toContain('DBCR-P1-13-001');
    // Nothing about the platform's grant configuration may reach a caller.
    expect(appFailure.safeDetails).toEqual({});
  });
});

describe('preflight under the DBCR-P1-13-001 rehearsal identity', () => {
  it('reports all four capabilities as available and still no BYPASSRLS', async () => {
    const preflight = await preflightOn(rehearsal);

    expect(preflight.currentRole).toBe(CR_REHEARSAL_LOGIN);
    expect(preflight.missing).toEqual([]);
    expect(preflight.bypassRlsAbsent).toBe(true);
    for (const report of preflight.capabilities) {
      expect(report.available).toBe(true);
    }
  });

  it('passes requireCapability for every foundation capability', async () => {
    __setPrimaryPoolForTests(rehearsal);
    __resetCapabilitiesForTests();

    await withTransaction(contextFor({}), async (db) => {
      for (const capability of FOUNDATION_CAPABILITIES) {
        await expect(requireCapability(db, capability)).resolves.toBeUndefined();
      }
    });
  });
});
