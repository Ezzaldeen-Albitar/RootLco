/**
 * Context binding and row-level isolation (P1-13-BE-003, P1-13-BE-004, P1-02-SEC-002).
 *
 * The property protected here is the one whose failure is silent and total: in a
 * pooled multi-tenant application, a session variable that outlives its
 * transaction serves one tenant's data to the next request on the same physical
 * connection, and nothing in the response looks wrong.
 *
 * Four independent guarantees are asserted, deliberately at different layers,
 * because any one of them alone would be a single point of failure:
 *
 *  1. **The application refuses first.** `Repository.assertContext()` throws
 *     `ERR-CTX-001` *before* a statement is issued. Relying only on RLS would
 *     also be safe, but it would return an empty result set — indistinguishable
 *     from "no data" — instead of naming the invariant that was violated.
 *  2. **The connection cannot cheat.** The runtime login carries no BYPASSRLS, so
 *     the database's own answer is the final one.
 *  3. **The database enforces the tenant.** Tenant B's context cannot see tenant
 *     A's row even when the row is addressed by primary key.
 *  4. **The context evaporates at COMMIT.** `set_config(..., true)` is
 *     transaction-local; a fresh transaction on the *same pooled connection* must
 *     start with no tenant at all. This is asserted with a single-connection pool
 *     precisely so connection reuse is guaranteed rather than hoped for.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  RUNTIME_LOGIN,
  TENANT_A,
  TENANT_B,
  USER_PERMITTED,
  USER_TENANT_B,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction, type DbHandle } from '@/server/db/transaction';
import { Repository } from '@/server/db/repository';
import { AppFailure } from '@/server/errors/app-failure';
import type { RequestContext } from '@/server/context/request-context';
import { metaModule } from '@/modules/meta';

/**
 * Minimal repository used only to reach the base-class guard and to issue a
 * query with NO tenant predicate of its own — so what the test observes is RLS,
 * not the repository's own WHERE clause.
 */
class ProbeRepository extends Repository {
  protected readonly module = 'test-probe';

  async readTenantById(db: DbHandle, tenantId: string): Promise<{ id: string } | null> {
    return this.runOne<{ id: string }>(db, 'SELECT id FROM org.tenants WHERE id = $1', [tenantId]);
  }
}

/** A handle that records whether the guard let a statement through. */
function countingHandle(context: RequestContext | undefined): {
  handle: DbHandle;
  statements: () => number;
} {
  let issued = 0;
  const handle = {
    context: context as RequestContext,
    depth: 0,
    query: async () => {
      issued += 1;
      throw new Error('a statement reached the database despite a missing context');
    },
  } as unknown as DbHandle;
  return { handle, statements: () => issued };
}

let admin: Pool;
let runtime: Pool;
/** Single connection, so "the same pooled connection" is a fact, not a guess. */
let pinned: Pool;
const repository = new ProbeRepository();

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool();
  pinned = runtimeAppPool(1);
  __setPrimaryPoolForTests(runtime);
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await pinned.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('the repository guard fails closed before any statement', () => {
  it('throws ERR-CTX-001 for a handle with no context at all', async () => {
    const { handle, statements } = countingHandle(undefined);

    await expect(repository.readTenantById(handle, TENANT_A)).rejects.toBeInstanceOf(AppFailure);
    await repository.readTenantById(handle, TENANT_A).catch((error: unknown) => {
      expect((error as AppFailure).code).toBe('ERR-CTX-001');
    });
    expect(statements()).toBe(0);
  });

  it('throws ERR-CTX-001 for a context whose tenant is blank', async () => {
    const blank = {
      ...contextFor({}),
      principal: { tenantId: '', userId: '' },
    } as unknown as RequestContext;
    const { handle, statements } = countingHandle(blank);

    const error = await repository
      .readTenantById(handle, TENANT_A)
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-CTX-001');
    expect((error as AppFailure).status).toBe(500);
    expect(statements()).toBe(0);
  });
});

describe('the runtime connection cannot bypass row-level security', () => {
  it('holds no BYPASSRLS attribute', async () => {
    const result = await runtime.query<{ role: string; bypass: boolean }>(
      `SELECT current_user AS role,
              COALESCE((SELECT r.rolbypassrls FROM pg_roles r WHERE r.rolname = current_user), false)
                AS bypass`
    );
    expect(result.rows[0]?.role).toBe(RUNTIME_LOGIN);
    expect(result.rows[0]?.bypass).toBe(false);
  });
});

describe('a scoped session sees its own tenant and nothing else', () => {
  it('resolves the tenant through the reference repository', async () => {
    const result = await withTransaction(
      contextFor({ tenantId: TENANT_A, userId: USER_PERMITTED, operation: 'meta.ping' }),
      (db) => metaModule().ping.ping(db)
    );

    expect(result.status).toBe('ok');
    expect(result.tenantRef).toBe(TENANT_A);
    // No narrowing was requested, so the caller is operating tenant-wide.
    expect(result.effectiveScope).toBe('tenant');
  });

  it("does not return tenant A's row under tenant B's context, even by primary key", async () => {
    const row = await withTransaction(
      contextFor({ tenantId: TENANT_B, userId: USER_TENANT_B }),
      (db) => repository.readTenantById(db, TENANT_A)
    );
    expect(row).toBeNull();

    // Control: the same query under tenant B's own id does return a row, so the
    // null above is isolation and not a broken query.
    const own = await withTransaction(
      contextFor({ tenantId: TENANT_B, userId: USER_TENANT_B }),
      (db) => repository.readTenantById(db, TENANT_B)
    );
    expect(own?.id).toBe(TENANT_B);
  });
});

describe('session context is transaction-local', () => {
  it('leaves no tenant behind on the pooled connection after COMMIT', async () => {
    __setPrimaryPoolForTests(pinned);
    try {
      const inside = await withTransaction(contextFor({ tenantId: TENANT_A }), async (db) => {
        const result = await db.query<{ tenant: string | null }>(
          "SELECT current_setting('app.tenant_id', true) AS tenant"
        );
        return result.rows[0]?.tenant ?? null;
      });
      expect(inside).toBe(TENANT_A);

      // Same pool, max = 1: this is necessarily the same physical connection.
      const after = await pinned.query<{ tenant: string | null }>(
        "SELECT current_setting('app.tenant_id', true) AS tenant"
      );
      expect(after.rows[0]?.tenant ?? '').toBe('');
    } finally {
      __setPrimaryPoolForTests(runtime);
    }
  });

  it('leaves no tenant behind on the pooled connection after ROLLBACK', async () => {
    __setPrimaryPoolForTests(pinned);
    try {
      await expect(
        withTransaction(contextFor({ tenantId: TENANT_A }), async () => {
          throw new Error('deliberate rollback');
        })
      ).rejects.toThrow('deliberate rollback');

      const after = await pinned.query<{ tenant: string | null }>(
        "SELECT current_setting('app.tenant_id', true) AS tenant"
      );
      expect(after.rows[0]?.tenant ?? '').toBe('');

      // And a fresh transaction on that connection sees only its own tenant.
      const row = await withTransaction(
        contextFor({ tenantId: TENANT_B, userId: USER_TENANT_B }),
        (db) => repository.readTenantById(db, TENANT_A)
      );
      expect(row).toBeNull();
    } finally {
      __setPrimaryPoolForTests(runtime);
    }
  });
});
