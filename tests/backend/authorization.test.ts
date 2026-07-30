/**
 * Authorization and entitlement are decided in the database (P1-13-BE-005, BR-IAM-001, BR-TEN-001).
 *
 * The permission model — deny precedence, grant validity windows, scope matching
 * — already exists in `iam.has_permission`, gated in Phase 1-4. Re-implementing
 * any of it in TypeScript would create a second source of truth, and the two
 * would drift silently until the drift was a breach. So the property this suite
 * protects is not "the middleware computes the right answer"; it is "the
 * middleware asks, and does not soften what it is told".
 *
 * Specifically:
 *
 *  - a deny mapping in ANY active granted role beats every allow (BR-IAM-001).
 *    Deny precedence is the mechanism by which access is *removed* from someone
 *    who still holds a broad role, so a layer that ORed the roles together would
 *    quietly reinstate access that was deliberately revoked;
 *  - a denial happens **before the handler body**, so a refused command leaves no
 *    trace in business tables. That is asserted by counting rows, not by reading
 *    the pipeline's source;
 *  - entitlement runs **after** authorization, and its denial never names the
 *    flag — flag codes are internal product shape and probing them is a
 *    documented abuse case;
 *  - an unregistered flag is an error, not a `false`. A typo must not silently
 *    disable a feature, and it must not silently enable one either.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import {
  COMMAND_PERMISSION,
  FEATURE_DISABLED,
  FEATURE_ENABLED,
  TENANT_A,
  USER_DENIED_BY_RULE,
  USER_PERMITTED,
  USER_UNPERMITTED,
  adminPool,
  cleanBackendFixtures,
  contextFor,
  countRows,
  ensureBackendFixtures,
  ensureTestLogins,
  runtimeAppPool,
} from './helpers';
import { __setPrimaryPoolForTests } from '@/server/db/pool';
import { withTransaction } from '@/server/db/transaction';
import { defineOperation, type RegisteredOperation } from '@/server/auth/operation-registry';
import {
  evaluatePermissions,
  requirePermissions,
  requireScopedPermissions,
} from '@/server/auth/authorization';
import {
  UnregisteredFeatureFlagError,
  isFeatureEnabled,
  requireFeature,
} from '@/server/auth/entitlement';
import { AppFailure } from '@/server/errors/app-failure';

let admin: Pool;
let runtime: Pool;
let COMMAND_OPERATION: RegisteredOperation;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanBackendFixtures(admin);
  await ensureBackendFixtures(admin);
  runtime = runtimeAppPool();
  __setPrimaryPoolForTests(runtime);

  // Registered here rather than imported: this suite is about the middleware, and
  // an operation declared in the test makes the security metadata under test
  // visible in the test.
  COMMAND_OPERATION = defineOperation({
    id: 'test.command',
    module: 'test',
    method: 'POST',
    path: '/test/command',
    summary: 'Fixture command used to exercise the authorization middleware.',
    permissions: [COMMAND_PERMISSION],
    scope: 'tenant',
  });
});

afterAll(async () => {
  __setPrimaryPoolForTests(undefined);
  await runtime.end();
  await cleanBackendFixtures(admin);
  await admin.end();
});

describe('requirePermissions delegates the decision to the database', () => {
  it('passes for a user holding an allow mapping through an active grant', async () => {
    await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) => {
      await expect(requirePermissions(db, COMMAND_OPERATION)).resolves.toBeUndefined();
      const decision = await evaluatePermissions(db, COMMAND_OPERATION);
      expect(decision.allowed).toBe(true);
      expect(decision.failedPermissions).toEqual([]);
    });
  });

  it('denies a user whose granted role carries no mapping for the code', async () => {
    const error = await withTransaction(contextFor({ userId: USER_UNPERMITTED }), async (db) =>
      requirePermissions(db, COMMAND_OPERATION).catch((caught: unknown) => caught)
    );

    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    expect((error as AppFailure).status).toBe(403);
    // Required codes are documented API metadata and are safe to disclose; the
    // resource never is, and is never mentioned.
    expect((error as AppFailure).safeDetails.requiredPermissions).toEqual([COMMAND_PERMISSION]);
  });

  it('lets a deny mapping beat an allow held through another active grant (BR-IAM-001)', async () => {
    // This user holds BOTH the allow role and the deny role. Under an "any allow
    // wins" reading they would pass; under BR-IAM-001 they must not.
    await withTransaction(contextFor({ userId: USER_DENIED_BY_RULE }), async (db) => {
      const decision = await evaluatePermissions(db, COMMAND_OPERATION);
      expect(decision.allowed).toBe(false);
      expect(decision.failedPermissions).toEqual([COMMAND_PERMISSION]);
    });

    const error = await withTransaction(contextFor({ userId: USER_DENIED_BY_RULE }), async (db) =>
      requirePermissions(db, COMMAND_OPERATION).catch((caught: unknown) => caught)
    );
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });

  it('denies when the session context carries no user at all', async () => {
    // `iam.has_permission` resolves an unset context to false rather than raising,
    // so the failure mode is denial and never an unhandled fault.
    const error = await withTransaction(contextFor({ userId: USER_UNPERMITTED }), async (db) => {
      await db.query("SELECT set_config('app.user_id', '', true)");
      return requirePermissions(db, COMMAND_OPERATION).catch((caught: unknown) => caught);
    });
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
  });
});

describe('a denied command performs no write', () => {
  it('leaves the business table untouched when authorization fails first', async () => {
    const before = await countRows(admin, 'crm.business_partners', 'tenant_id = $1', [TENANT_A]);

    const error = await withTransaction(contextFor({ userId: USER_UNPERMITTED }), async (db) => {
      // Exactly the pipeline's order: authorize, then run the handler body.
      await requirePermissions(db, COMMAND_OPERATION);
      await db.query(
        `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
         VALUES ($1, 'organization', $2, $3)`,
        [TENANT_A, `fx_denied_${randomUUID()}`, USER_UNPERMITTED]
      );
      return null;
    }).catch((caught: unknown) => caught);

    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    const after = await countRows(admin, 'crm.business_partners', 'tenant_id = $1', [TENANT_A]);
    expect(after).toBe(before);
  });
});

describe('entitlement resolves against the tenant, after authorization', () => {
  it('passes for an enabled flag', async () => {
    await withTransaction(contextFor({}), async (db) => {
      await expect(isFeatureEnabled(db, FEATURE_ENABLED)).resolves.toBe(true);
      await expect(requireFeature(db, FEATURE_ENABLED)).resolves.toBeUndefined();
    });
  });

  it('throws ERR-TEN-001 for a disabled flag without naming it', async () => {
    const error = await withTransaction(contextFor({}), async (db) => {
      expect(await isFeatureEnabled(db, FEATURE_DISABLED)).toBe(false);
      return requireFeature(db, FEATURE_DISABLED).catch((caught: unknown) => caught);
    });

    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-TEN-001');
    expect((error as AppFailure).status).toBe(403);
    // The developer-facing message may name the flag; the caller-safe payload,
    // which is all `problem.ts` reads, must carry nothing.
    expect((error as AppFailure).safeDetails).toEqual({});
  });

  it('raises UnregisteredFeatureFlagError for a flag nobody registered', async () => {
    const error = await withTransaction(contextFor({}), async (db) =>
      isFeatureEnabled(db, 'fx_p1_13_never_registered').catch((caught: unknown) => caught)
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(UnregisteredFeatureFlagError);
    expect((error as Error).message).toContain('fx_p1_13_never_registered');
  });
});

describe('requireScopedPermissions fails closed on an empty target (P1-18-A-01)', () => {
  /**
   * The guard this covers had **no test at all**, and how that was discovered matters more
   * than the test itself.
   *
   * The nightly `mutation-assurance` job exists to remove one guard at a time and require
   * the suite to notice. It could never run: its three manifest entries invoked
   * `npm run test:backend -- --config vitest.config.backend.ts`, and `test:backend` already
   * supplies `--config`, so vitest refused the duplicated flag and every target reported
   * `error` instead of `killed`. Fixing the invocation made the harness run for the first
   * time, and it immediately reported this guard as **survived**.
   *
   * What the guard does: reaching `requireScopedPermissions` means a choke point has
   * discovered a resource's real scope and is asking to be judged against it. If neither a
   * company nor a branch arrives, the decision would fall through to scope-blind
   * `iam.has_permission`, which answers yes for a principal holding the code ANYWHERE in
   * the tenant. That is P1-18-A-01 — a branch-scoped permission that is decorative — and
   * disabling this one condition restores it exactly.
   *
   * `USER_PERMITTED` holds the permission through an unrestricted tenant-wide grant, and
   * that choice is the whole design of these cases. A DENIED principal would raise
   * `ERR-IAM-001` either way, the assertion would still pass with the guard removed, and
   * the test would be vacuous in precisely the direction that matters. The assertions are
   * on the guard's own SENTENCE rather than only on the code, for the same reason: every
   * refusal on this path shares the code.
   */
  const DEFERRED_REFUSAL = 'deferred scoped authorization requires';

  it('denies a PERMITTED principal when neither company nor branch is supplied', async () => {
    // Sanity first: this principal really is allowed the operation, so the refusal below
    // is about the missing target and about nothing else.
    await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) => {
      await expect(requirePermissions(db, COMMAND_OPERATION)).resolves.toBeUndefined();
    });

    const error = await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) =>
      requireScopedPermissions(db, COMMAND_OPERATION, {}).catch((caught: unknown) => caught)
    );

    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-IAM-001');
    expect((error as AppFailure).status).toBe(403);
    expect((error as AppFailure).message).toContain(DEFERRED_REFUSAL);
    // Required codes are documented API metadata and safe to disclose; the resource is
    // not, and is never named.
    expect((error as AppFailure).safeDetails.requiredPermissions).toEqual([COMMAND_PERMISSION]);
  });

  /**
   * There is deliberately no case for `{ companyId: undefined, branchId: undefined }`.
   *
   * That is what a caller writes when it means "I could not resolve either", and it is
   * **unrepresentable**: the repository compiles with `exactOptionalPropertyTypes`, so
   * `AuthorizationTarget`'s optional properties reject an explicit `undefined` and `tsc`
   * refuses the call outright. Asserting it at runtime would need a cast, and a test that
   * has to defeat the type system to reach a branch is describing a state the program
   * cannot be in. The absent-property form above is the one the types permit, so it is the
   * one the guard has to catch.
   */

  it('does not raise the deferred refusal once a company IS named', async () => {
    // The other half, so the two cases above are not simply "this function always throws".
    // A named company may still be refused on scope — that is a different decision, made by
    // `iam.has_permission_in_scope` — so the assertion is that THIS guard did not fire,
    // identified by its own sentence rather than by the code every refusal here shares.
    const outcome = await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) =>
      requireScopedPermissions(db, COMMAND_OPERATION, { companyId: randomUUID() }).catch(
        (caught: unknown) => caught
      )
    );
    const message = outcome instanceof AppFailure ? outcome.message : '';
    expect(message).not.toContain(DEFERRED_REFUSAL);
  });

  it('does not exempt an operation merely because its declared scope is tenant', async () => {
    // `COMMAND_OPERATION` declares `scope: 'tenant'`, and the guard is deliberately NOT
    // keyed on that. Keying it on the declaration would exempt any operation that omitted
    // `scope` — `defineOperation` defaults it to `'tenant'` — so a future id-addressed
    // command that forgot one line would be decided scope-blind while looking entirely
    // correct at the call site.
    expect(COMMAND_OPERATION.scope).toBe('tenant');
    const error = await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) =>
      requireScopedPermissions(db, COMMAND_OPERATION, {}).catch((caught: unknown) => caught)
    );
    expect((error as AppFailure).message).toContain(DEFERRED_REFUSAL);
  });
});
