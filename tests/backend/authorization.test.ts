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
import { evaluatePermissions, requirePermissions } from '@/server/auth/authorization';
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
