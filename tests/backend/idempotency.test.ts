/**
 * Idempotent command execution (P1-13-BE-012, FR-INT-002).
 *
 * A client that never sees a response cannot know whether the command ran. It
 * will retry. The `Idempotency-Key` contract exists so that retry is safe, and
 * the three cases below are the whole contract:
 *
 *  - **Replay, same fingerprint** → return the stored response WITHOUT running
 *    the command again. The assertion here counts executions, because "returns
 *    the right JSON" would also pass if the command had quietly run twice —
 *    which is precisely the bug the header exists to prevent.
 *  - **Same key, different fingerprint** → `ERR-INT-001`, and neither version
 *    runs. Either the client reused a key by mistake or someone is grafting a
 *    new command onto a trusted key; executing either would be wrong.
 *  - **Concurrent first use** → the unique index arbitrates. Both callers may
 *    *start*, but only one transaction commits, so exactly one execution becomes
 *    durable and exactly one row is stored. The loser's work is discarded with
 *    its transaction — which is why this is asserted by counting committed side
 *    effects rather than callback invocations.
 *
 * The fourth assertion is the one that makes the other three trustworthy: the
 * reservation row is written INSIDE the caller's transaction, so a key exists if
 * and only if the command it guards committed. Reserving in a separate
 * transaction would strand keys for rolled-back commands and permanently block
 * the client's retry — turning a transient failure into a dead command.
 *
 * Runs on the DBCR-P1-13-001 rehearsal role: `shared.idempotency_keys` has no
 * app-role grant and no RLS policy in the frozen baseline.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  USER_PERMITTED,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  crRehearsalPool,
  dropCrRehearsalRole,
  ensureBackendFixtures,
  ensureCrRehearsalRole,
  ensureTestLogins,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction, type DbHandle } from '@/server/db/transaction';
import {
  IdempotencyRaceError,
  requestFingerprint,
  resolveRace,
  toOperationCode,
  withIdempotency,
} from '@/server/http/idempotency';
import { AppFailure } from '@/server/errors/app-failure';

const OPERATION_ID = 'test.idempotent-command';
const OPERATION_CODE = toOperationCode(OPERATION_ID);

let admin: Pool;
let rehearsal: Pool;

function keyFor(tag: string): string {
  return `fx-p1-13-${tag}-${randomUUID()}`;
}

/** A durable side effect, so "did it run?" is answered by the database. */
async function sideEffect(db: DbHandle, tag: string): Promise<{ tag: string }> {
  await db.query(
    `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
     VALUES ($1, 'organization', $2, $3)`,
    [TENANT_A, tag, USER_PERMITTED]
  );
  return { tag };
}

async function storedKeys(key: string): Promise<number> {
  return countRows(
    admin,
    'shared.idempotency_keys',
    'tenant_id = $1 AND operation = $2 AND idempotency_key = $3',
    [TENANT_A, OPERATION_CODE, key]
  );
}

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  await ensureCrRehearsalRole(admin);
  rehearsal = crRehearsalPool(4);
  __setPrimaryPoolForTests(rehearsal);
});

beforeEach(async () => {
  await admin.query('DELETE FROM shared.idempotency_keys WHERE tenant_id = $1', [TENANT_A]);
  await admin.query('DELETE FROM crm.timeline_events WHERE tenant_id = $1', [TENANT_A]);
  await admin.query('DELETE FROM crm.business_partners WHERE tenant_id = $1', [TENANT_A]);
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await rehearsal.end();
  await cleanBackendFixtures(admin);
  await dropCrRehearsalRole(admin);
  await admin.end();
});

describe('replay with the same key and fingerprint', () => {
  it('returns the stored response without executing the command again', async () => {
    const key = keyFor('replay');
    const fingerprint = requestFingerprint({
      method: 'POST',
      path: '/test/command',
      body: { a: 1 },
    });
    const tag = `fx_p1_13_replay_${randomUUID()}`;
    let executions = 0;

    const first = await withTransaction(contextFor({}), (db) =>
      withIdempotency(db, { operationId: OPERATION_ID, key, fingerprint }, async () => {
        executions += 1;
        return sideEffect(db, tag);
      })
    );
    expect(first.replayed).toBe(false);
    expect(executions).toBe(1);

    const second = await withTransaction(contextFor({}), (db) =>
      withIdempotency(db, { operationId: OPERATION_ID, key, fingerprint }, async () => {
        executions += 1;
        return sideEffect(db, `${tag}_again`);
      })
    );

    expect(second.replayed).toBe(true);
    expect(second.value).toEqual({ tag });
    // The whole contract in one number: the callback did not run a second time.
    expect(executions).toBe(1);
    expect(
      await countRows(admin, 'crm.business_partners', 'display_name LIKE $1', [`${tag}%`])
    ).toBe(1);
    expect(await storedKeys(key)).toBe(1);
  });

  it('canonicalises the request so key order cannot change the fingerprint', () => {
    const a = requestFingerprint({ method: 'post', path: '/x', body: { b: 2, a: 1 } });
    const b = requestFingerprint({ method: 'POST', path: '/x', body: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });
});

describe('replay with the same key and a different fingerprint', () => {
  it('rejects with ERR-INT-001 and executes nothing', async () => {
    const key = keyFor('conflict');
    const original = requestFingerprint({ method: 'POST', path: '/test/command', body: { a: 1 } });
    const different = requestFingerprint({ method: 'POST', path: '/test/command', body: { a: 2 } });
    const tag = `fx_p1_13_conflict_${randomUUID()}`;
    let executions = 0;

    await withTransaction(contextFor({}), (db) =>
      withIdempotency(db, { operationId: OPERATION_ID, key, fingerprint: original }, async () => {
        executions += 1;
        return sideEffect(db, tag);
      })
    );

    const error = await withTransaction(contextFor({}), (db) =>
      withIdempotency(db, { operationId: OPERATION_ID, key, fingerprint: different }, async () => {
        executions += 1;
        return sideEffect(db, `${tag}_grafted`);
      })
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-INT-001');
    expect((error as AppFailure).status).toBe(409);
    expect(executions).toBe(1);
    expect(await storedKeys(key)).toBe(1);
  });
});

describe('concurrent first use of one key', () => {
  it('commits exactly one execution and stores exactly one row', async () => {
    const key = keyFor('race');
    const fingerprint = requestFingerprint({ method: 'POST', path: '/test/command', body: {} });
    const prefix = `fx_p1_13_race_${randomUUID()}`;

    // Both transactions must read the (absent) key BEFORE either inserts, or the
    // race under test never happens.
    let arrived = 0;
    let release = (): void => undefined;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });

    const attempt = async (index: number): Promise<unknown> =>
      withTransaction(contextFor({}), (db) =>
        withIdempotency(db, { operationId: OPERATION_ID, key, fingerprint }, async () => {
          arrived += 1;
          if (arrived === 2) release();
          await bothArrived;
          return sideEffect(db, `${prefix}_${index}`);
        })
      ).catch((caught: unknown) => caught);

    const outcomes = await Promise.all([attempt(1), attempt(2)]);

    const races = outcomes.filter((outcome) => outcome instanceof IdempotencyRaceError);
    expect(races).toHaveLength(1);

    // One durable execution, one stored key: the loser's transaction took its
    // side effect down with it.
    expect(
      await countRows(admin, 'crm.business_partners', 'display_name LIKE $1', [`${prefix}%`])
    ).toBe(1);
    expect(await storedKeys(key)).toBe(1);

    // The loser re-reads the winner's response on a fresh transaction, which is
    // what the route handler does before answering.
    const race = races[0] as IdempotencyRaceError;
    const resolved = await withTransaction(contextFor({}), (db) => resolveRace(db, race));
    expect(resolved.response).toBeDefined();
  });
});

describe('a key is durable only if its command committed', () => {
  it('stores nothing when the surrounding transaction rolls back', async () => {
    const key = keyFor('rollback');
    const fingerprint = requestFingerprint({ method: 'POST', path: '/test/command', body: {} });
    const tag = `fx_p1_13_rollback_${randomUUID()}`;

    await expect(
      withTransaction(contextFor({}), async (db) => {
        await withIdempotency(db, { operationId: OPERATION_ID, key, fingerprint }, () =>
          sideEffect(db, tag)
        );
        throw new Error('injected failure after the reservation');
      })
    ).rejects.toThrow('injected failure after the reservation');

    expect(await storedKeys(key)).toBe(0);
    expect(await countRows(admin, 'crm.business_partners', 'display_name = $1', [tag])).toBe(0);

    // And therefore the retry is not blocked: the same key still works.
    const retry = await withTransaction(contextFor({}), (db) =>
      withIdempotency(db, { operationId: OPERATION_ID, key, fingerprint }, () =>
        sideEffect(db, tag)
      )
    );
    expect(retry.replayed).toBe(false);
    expect(await storedKeys(key)).toBe(1);
  });
});
