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
 * Runs on `rootlco_test_runtime` (a member of `app_runtime`). Until
 * DBCR-P1-13-001 was applied, `shared.idempotency_keys` had no app-role grant
 * and no RLS policy at all; it now carries a tenant-scoped SELECT + INSERT
 * surface for exactly this path — and still no UPDATE and no DELETE, so a stored
 * response can never be rewritten.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  TENANT_A,
  TENANT_B,
  USER_PERMITTED,
  USER_SCOPED,
  USER_TENANT_B,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
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
let runtime: Pool;

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
  runtime = runtimeAppPool(4);
  __setPrimaryPoolForTests(runtime);
});

beforeEach(async () => {
  await admin.query('DELETE FROM shared.idempotency_keys WHERE tenant_id = ANY($1)', [
    [TENANT_A, TENANT_B],
  ]);
  await admin.query('DELETE FROM crm.timeline_events WHERE tenant_id = $1', [TENANT_A]);
  await admin.query('DELETE FROM crm.business_partners WHERE tenant_id = $1', [TENANT_A]);
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('replay with the same key and fingerprint', () => {
  it('returns the stored response without executing the command again', async () => {
    const key = keyFor('replay');
    const context = contextFor({});
    const fingerprint = requestFingerprint(context, {
      method: 'POST',
      path: '/test/command',
      body: { a: 1 },
    });
    const tag = `fx_p1_13_replay_${randomUUID()}`;
    let executions = 0;

    const first = await withTransaction(context, (db) =>
      withIdempotency(db, { operationId: OPERATION_ID, key, fingerprint }, async () => {
        executions += 1;
        return sideEffect(db, tag);
      })
    );
    expect(first.replayed).toBe(false);
    expect(executions).toBe(1);

    const second = await withTransaction(context, (db) =>
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
    const context = contextFor({});
    const a = requestFingerprint(context, { method: 'post', path: '/x', body: { b: 2, a: 1 } });
    const b = requestFingerprint(context, { method: 'POST', path: '/x', body: { a: 1, b: 2 } });
    expect(a).toBe(b);
  });
});

describe('replay with the same key and a different fingerprint', () => {
  it('rejects with ERR-INT-001 and executes nothing', async () => {
    const key = keyFor('conflict');
    const context = contextFor({});
    const original = requestFingerprint(context, {
      method: 'POST',
      path: '/test/command',
      body: { a: 1 },
    });
    const different = requestFingerprint(context, {
      method: 'POST',
      path: '/test/command',
      body: { a: 2 },
    });
    const tag = `fx_p1_13_conflict_${randomUUID()}`;
    let executions = 0;

    await withTransaction(context, (db) =>
      withIdempotency(db, { operationId: OPERATION_ID, key, fingerprint: original }, async () => {
        executions += 1;
        return sideEffect(db, tag);
      })
    );

    const error = await withTransaction(context, (db) =>
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
    const context = contextFor({});
    const fingerprint = requestFingerprint(context, {
      method: 'POST',
      path: '/test/command',
      body: {},
    });
    const prefix = `fx_p1_13_race_${randomUUID()}`;

    // Both transactions must read the (absent) key BEFORE either inserts, or the
    // race under test never happens.
    let arrived = 0;
    let release = (): void => undefined;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });

    const attempt = async (index: number): Promise<unknown> =>
      withTransaction(context, (db) =>
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
    const resolved = await withTransaction(context, (db) => resolveRace(db, race));
    expect(resolved.response).toBeDefined();
  });
});

describe('a key is durable only if its command committed', () => {
  it('stores nothing when the surrounding transaction rolls back', async () => {
    const key = keyFor('rollback');
    const context = contextFor({});
    const fingerprint = requestFingerprint(context, {
      method: 'POST',
      path: '/test/command',
      body: {},
    });
    const tag = `fx_p1_13_rollback_${randomUUID()}`;

    await expect(
      withTransaction(context, async (db) => {
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

/**
 * ADV-04 — replay ownership is bound to the authenticated principal.
 *
 * Before this fix, replay identity was `(tenant, operation, key)` and the
 * fingerprint covered only method, path and body. Two users of the same tenant
 * issuing the same request with the same key were indistinguishable, so the
 * second one received the first one's stored response document. The fix binds
 * tenant + principal into the fingerprint, so the second user fails the
 * fingerprint comparison and gets the ordinary conflict instead.
 *
 * The binding is server-resolved: `requestFingerprint` takes the frozen
 * `RequestContext`, so there is no parameter through which a request body could
 * supply an identity.
 */
describe('ADV-04: replay ownership is bound to the authenticated principal', () => {
  const REQUEST = { method: 'POST', path: '/test/command', body: { amount: 10 } } as const;

  it('1. same principal, same key, same payload replays the stored response', async () => {
    const key = keyFor('same-principal');
    const context = contextFor({ userId: USER_PERMITTED });
    const fingerprint = requestFingerprint(context, REQUEST);
    const tag = `fx_p1_13_adv04_same_${randomUUID()}`;
    let executions = 0;

    const first = await withTransaction(context, (db) =>
      withIdempotency(db, { operationId: OPERATION_ID, key, fingerprint }, async () => {
        executions += 1;
        return sideEffect(db, tag);
      })
    );
    // A genuine retry: a NEW context object for the same authenticated user,
    // as a second HTTP request would produce.
    const retryContext = contextFor({ userId: USER_PERMITTED });
    const second = await withTransaction(retryContext, (db) =>
      withIdempotency(
        db,
        { operationId: OPERATION_ID, key, fingerprint: requestFingerprint(retryContext, REQUEST) },
        async () => {
          executions += 1;
          return sideEffect(db, `${tag}_again`);
        }
      )
    );

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.value).toEqual({ tag });
    expect(executions).toBe(1);
  });

  it('2. same principal, same key, different payload is rejected', async () => {
    const key = keyFor('same-principal-diff-body');
    const context = contextFor({ userId: USER_PERMITTED });
    const tag = `fx_p1_13_adv04_body_${randomUUID()}`;

    await withTransaction(context, (db) =>
      withIdempotency(
        db,
        { operationId: OPERATION_ID, key, fingerprint: requestFingerprint(context, REQUEST) },
        () => sideEffect(db, tag)
      )
    );

    const error = await withTransaction(context, (db) =>
      withIdempotency(
        db,
        {
          operationId: OPERATION_ID,
          key,
          fingerprint: requestFingerprint(context, { ...REQUEST, body: { amount: 999 } }),
        },
        () => sideEffect(db, `${tag}_grafted`)
      )
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-INT-001');
  });

  it('3. a different principal in the same tenant is rejected without disclosing the result', async () => {
    const key = keyFor('cross-principal');
    const owner = contextFor({ userId: USER_PERMITTED });
    const intruder = contextFor({ userId: USER_SCOPED });
    const tag = `fx_p1_13_adv04_cross_${randomUUID()}`;
    let executions = 0;

    await withTransaction(owner, (db) =>
      withIdempotency(
        db,
        { operationId: OPERATION_ID, key, fingerprint: requestFingerprint(owner, REQUEST) },
        async () => {
          executions += 1;
          return sideEffect(db, tag);
        }
      )
    );

    // Byte-identical request. Only the authenticated principal differs.
    const error = await withTransaction(intruder, (db) =>
      withIdempotency(
        db,
        { operationId: OPERATION_ID, key, fingerprint: requestFingerprint(intruder, REQUEST) },
        async () => {
          executions += 1;
          return sideEffect(db, `${tag}_intruder`);
        }
      )
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AppFailure);
    const failure = error as AppFailure;

    // Rejected — and the intruder's command did not run either.
    expect(failure.code).toBe('ERR-INT-001');
    expect(executions).toBe(1);

    // No disclosure: the owner's stored response, the owner's identity, the
    // fingerprint and the key must not appear anywhere in what the caller sees.
    const disclosed = JSON.stringify({
      ...failure,
      message: failure.message,
      stack: failure.stack,
    });
    expect(disclosed).not.toContain(tag);
    expect(disclosed).not.toContain(USER_PERMITTED);
    expect(disclosed).not.toContain(key);
    expect(disclosed).not.toContain(requestFingerprint(owner, REQUEST));

    // Indistinguishable from an ordinary payload conflict — no oracle.
    const payloadConflict = await withTransaction(owner, (db) =>
      withIdempotency(
        db,
        {
          operationId: OPERATION_ID,
          key,
          fingerprint: requestFingerprint(owner, { ...REQUEST, body: { amount: 5 } }),
        },
        () => sideEffect(db, `${tag}_other`)
      )
    ).catch((caught: unknown) => caught);
    expect((payloadConflict as AppFailure).code).toBe(failure.code);
    expect((payloadConflict as AppFailure).message).toBe(failure.message);
  });

  it('4. a different tenant with the same key and payload stays isolated', async () => {
    const key = keyFor('cross-tenant');
    const tenantA = contextFor({ tenantId: TENANT_A, userId: USER_PERMITTED });
    const tenantB = contextFor({ tenantId: TENANT_B, userId: USER_TENANT_B });

    await withTransaction(tenantA, (db) =>
      withIdempotency(
        db,
        { operationId: OPERATION_ID, key, fingerprint: requestFingerprint(tenantA, REQUEST) },
        async () => ({ scope: 'A' })
      )
    );

    // Tenant B holds its own reservation: the unique constraint is per tenant,
    // and RLS means B never sees A's row in the first place.
    const outcome = await withTransaction(tenantB, (db) =>
      withIdempotency(
        db,
        { operationId: OPERATION_ID, key, fingerprint: requestFingerprint(tenantB, REQUEST) },
        async () => ({ scope: 'B' })
      )
    );

    expect(outcome.replayed).toBe(false);
    expect(outcome.value).toEqual({ scope: 'B' });
    expect(await storedKeys(key)).toBe(1);
    expect(
      await countRows(
        admin,
        'shared.idempotency_keys',
        'tenant_id = $1 AND operation = $2 AND idempotency_key = $3',
        [TENANT_B, OPERATION_CODE, key]
      )
    ).toBe(1);
  });

  it('7. a client-supplied actor field cannot influence the binding', () => {
    const context = contextFor({ userId: USER_PERMITTED });

    // Whatever the body claims, the fingerprint's identity component comes from
    // the context. Two bodies that differ only in a forged identity field must
    // therefore still differ (the body is hashed) — but neither may equal the
    // fingerprint the *claimed* user would legitimately produce.
    const forged = requestFingerprint(context, {
      ...REQUEST,
      body: { ...REQUEST.body, userId: USER_SCOPED, created_by: USER_SCOPED },
    });
    const legitimateVictim = requestFingerprint(contextFor({ userId: USER_SCOPED }), REQUEST);

    expect(forged).not.toBe(legitimateVictim);

    // And the binding really is the context: same body, different context user
    // ⇒ different fingerprint.
    expect(requestFingerprint(contextFor({ userId: USER_PERMITTED }), REQUEST)).not.toBe(
      legitimateVictim
    );
  });

  it('8. an unresolved principal fails closed rather than producing an unbound fingerprint', () => {
    const unauthenticated = {
      ...contextFor({}),
      principal: undefined,
    } as unknown as Parameters<typeof requestFingerprint>[0];

    expect(() => requestFingerprint(unauthenticated, REQUEST)).toThrow(AppFailure);
    try {
      requestFingerprint(unauthenticated, REQUEST);
    } catch (caught) {
      expect((caught as AppFailure).code).toBe('ERR-IAM-002');
    }
  });

  it('binds the principal into the digest rather than alongside it', () => {
    const a = requestFingerprint(contextFor({ userId: USER_PERMITTED }), REQUEST);
    const b = requestFingerprint(contextFor({ userId: USER_SCOPED }), REQUEST);
    const crossTenant = requestFingerprint(
      contextFor({ tenantId: TENANT_B, userId: USER_TENANT_B }),
      REQUEST
    );

    expect(a).not.toBe(b);
    expect(a).not.toBe(crossTenant);
    // Still a plain SHA-256 hex digest — nothing about the principal is readable.
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toContain(USER_PERMITTED.replace(/-/g, ''));
  });
});

describe('ADV-04: concurrency between two principals', () => {
  it('6. concurrent first use by different principals cannot share the stored result', async () => {
    const key = keyFor('race-principals');
    const owner = contextFor({ userId: USER_PERMITTED });
    const rival = contextFor({ userId: USER_SCOPED });
    const prefix = `fx_p1_13_adv04_race_${randomUUID()}`;
    const request = { method: 'POST', path: '/test/command', body: {} } as const;

    let arrived = 0;
    let release = (): void => undefined;
    const bothArrived = new Promise<void>((resolve) => {
      release = resolve;
    });

    const attempt = async (context: typeof owner, label: string): Promise<unknown> =>
      withTransaction(context, (db) =>
        withIdempotency(
          db,
          { operationId: OPERATION_ID, key, fingerprint: requestFingerprint(context, request) },
          async () => {
            arrived += 1;
            if (arrived === 2) release();
            await bothArrived;
            return sideEffect(db, `${prefix}_${label}`);
          }
        )
      ).catch((caught: unknown) => caught);

    const outcomes = await Promise.all([attempt(owner, 'owner'), attempt(rival, 'rival')]);

    // Exactly one durable execution and one stored row, as in the same-principal race.
    expect(
      await countRows(admin, 'crm.business_partners', 'display_name LIKE $1', [`${prefix}%`])
    ).toBe(1);
    expect(await storedKeys(key)).toBe(1);

    // The loser re-reads on a fresh transaction. Whoever lost, the re-read must
    // NOT hand over the winner's response when the principals differ.
    const race = outcomes.find((outcome) => outcome instanceof IdempotencyRaceError);
    expect(race).toBeInstanceOf(IdempotencyRaceError);

    const loserContext =
      (race as IdempotencyRaceError).fingerprint === requestFingerprint(owner, request)
        ? owner
        : rival;
    const resolved = await withTransaction(loserContext, (db) =>
      resolveRace(db, race as IdempotencyRaceError)
    ).catch((caught: unknown) => caught);

    expect(resolved).toBeInstanceOf(AppFailure);
    expect((resolved as AppFailure).code).toBe('ERR-INT-001');
  });
});
