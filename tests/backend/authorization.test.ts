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
  BRANCH_A1,
  COMMAND_PERMISSION,
  COMPANY_A1,
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
  requireScopeClaimInTenant,
  requireScopeTargetInTenant,
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

/**
 * CC-14 — the scope-target probe, against the deployed schema and its policies.
 *
 * The unit tier (`tests/foundation/p1-18-scoped-authorization.test.ts`, F9) pins the
 * statement shape and the bindings with a fake handle. What only a real server can
 * answer is whether the predicate MEANS anything: that `ensureOrgFixtures`'
 * COMPANY_A1/BRANCH_A1 pair really resolves, and that a pair that exists nowhere is
 * refused with the same document as one that exists in another tenant.
 *
 * `USER_PERMITTED` holds an unrestricted grant, so `iam.allowed_branch_ids()` is NULL
 * and `sel_branches_scope` narrows to the tenant alone. That is the caller the probe
 * exists for: the one `iam.has_permission_in_scope` cannot refuse.
 */
describe('CC-14 scope target resolved inside the tenant', () => {
  it('resolves the tenant own company and branch pair', async () => {
    await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) => {
      // Resolves means "does not throw". A returned value would be a decision the
      // caller could ignore, which is why this function has none.
      await expect(
        requireScopeTargetInTenant(db, COMMAND_OPERATION, {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
        })
      ).resolves.toBeUndefined();
    });
  });

  it('resolves a half-specified and an empty target without consulting the database', async () => {
    await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) => {
      // A company that exists nowhere: if the probe ran at all this would refuse.
      await expect(
        requireScopeTargetInTenant(db, COMMAND_OPERATION, { companyId: randomUUID() })
      ).resolves.toBeUndefined();
      await expect(
        requireScopeTargetInTenant(db, COMMAND_OPERATION, { branchId: randomUUID() })
      ).resolves.toBeUndefined();
      await expect(requireScopeTargetInTenant(db, COMMAND_OPERATION, {})).resolves.toBeUndefined();
    });
  });

  it('refuses a pair that exists nowhere and an in-tenant pair of the wrong company identically', async () => {
    const outcomes = await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) => {
      // Sequential, not Promise.all: `TransactionHandle` forwards to a single pg
      // client, so two overlapping statements would be a test of the pool rather
      // than of the probe, and this file issues its statements one at a time
      // everywhere else.
      const nowhere = await requireScopeTargetInTenant(db, COMMAND_OPERATION, {
        companyId: randomUUID(),
        branchId: randomUUID(),
      }).catch((caught: unknown) => caught);
      const wrongCompany = await requireScopeTargetInTenant(db, COMMAND_OPERATION, {
        // A REAL branch of this tenant, named under a company it does not belong
        // to. This is the H6 shape, and it must be indistinguishable from the
        // invented pair above.
        companyId: randomUUID(),
        branchId: BRANCH_A1,
      }).catch((caught: unknown) => caught);
      return { nowhere, wrongCompany };
    });

    for (const outcome of [outcomes.nowhere, outcomes.wrongCompany]) {
      expect(outcome).toBeInstanceOf(AppFailure);
      const failure = outcome as AppFailure;
      expect(failure.code).toBe('ERR-IAM-001');
      expect(failure.status).toBe(403);
      expect(failure.safeDetails).toEqual({ requiredPermissions: [COMMAND_PERMISSION] });
      // It is the target refusal, not the deferred-target one: two different
      // defects that share a code would otherwise be impossible to tell apart.
      expect(failure.message).not.toContain('deferred scoped authorization requires');
    }

    // Identical message, so the refusal cannot be read as an existence oracle.
    expect((outcomes.nowhere as AppFailure).message).toBe(
      (outcomes.wrongCompany as AppFailure).message
    );
  });

  it('refuses a soft-deleted branch exactly as it refuses a missing one', async () => {
    // Soft-deleted through the admin pool and restored in a finally, so the shared
    // fixture branch survives for every other suite on this database.
    await admin.query(`UPDATE org.branches SET deleted_at = now() WHERE id = $1`, [BRANCH_A1]);
    try {
      const outcome = await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) =>
        requireScopeTargetInTenant(db, COMMAND_OPERATION, {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
        }).catch((caught: unknown) => caught)
      );
      expect(outcome).toBeInstanceOf(AppFailure);
      expect((outcome as AppFailure).code).toBe('ERR-IAM-001');
      expect((outcome as AppFailure).status).toBe(403);
    } finally {
      await admin.query(`UPDATE org.branches SET deleted_at = NULL WHERE id = $1`, [BRANCH_A1]);
    }

    // And the restore worked, so a later suite does not inherit a deleted branch.
    await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) => {
      await expect(
        requireScopeTargetInTenant(db, COMMAND_OPERATION, {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
        })
      ).resolves.toBeUndefined();
    });
  });

  it('refuses a caller whose grant union hides an in-tenant branch its permission covers', async () => {
    // The mixed-grant corner, stated at this tier because it is a property of the
    // POLICY rather than of any route: the probe reads `org.branches` under
    // `sel_branches_scope`, which narrows by `iam.allowed_branch_ids()`. A context
    // carrying a branch narrowing that excludes BRANCH_A1 therefore cannot see it,
    // and the refusal means "not visible to this caller", not "not in the tenant".
    // `tests/backend/p1-21-inventory-reads.test.ts` proves the same corner end to end
    // with a principal whose two REAL grants produce this narrowing.
    const outcome = await withTransaction(
      contextFor({ userId: USER_PERMITTED, companyIds: [COMPANY_A1], branchIds: [randomUUID()] }),
      async (db) =>
        requireScopeTargetInTenant(db, COMMAND_OPERATION, {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
        }).catch((caught: unknown) => caught)
    );
    expect(outcome).toBeInstanceOf(AppFailure);
    expect((outcome as AppFailure).code).toBe('ERR-IAM-001');
  });
});

/**
 * CC-56 — the same question asked of a WRITE, whose scope arrives in the body.
 *
 * `requireScopeClaimInTenant` is the sibling of the probe above, for the requests the
 * GET path cannot serve. Its company-only arm reads `org.legal_companies` under
 * `sel_legal_companies_tenant`, which the unit tier cannot judge at all: that policy
 * narrows by `iam.current_tenant_id()` AND `iam.allowed_company_ids()`, and whether
 * those two mean what this probe assumes is a question only a real server answers.
 *
 * The four cases below are the four the sibling block proves for `org.branches`,
 * asked of the company arm and of the ORDER the services call it in — soft deletion,
 * a grant union that hides an in-tenant row, a claim with nothing to resolve, and the
 * permission decision running first.
 */
describe('CC-56 scope claim resolved inside the tenant', () => {
  it('refuses a soft-deleted company exactly as it refuses one that exists nowhere', async () => {
    // The positive control first: without it, every refusal below could be the probe
    // refusing everything.
    await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) => {
      await expect(
        requireScopeClaimInTenant(db, COMMAND_OPERATION, { companyId: COMPANY_A1 })
      ).resolves.toBeUndefined();
    });

    // Soft-deleted through the admin pool and restored in a finally, exactly as the
    // branch case above does, so the shared fixture company survives this suite.
    await admin.query(`UPDATE org.legal_companies SET deleted_at = now() WHERE id = $1`, [
      COMPANY_A1,
    ]);
    let deleted: unknown;
    let nowhere: unknown;
    try {
      const outcomes = await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) => {
        // Sequential, for the reason the sibling block states: one pg client.
        const softDeleted = await requireScopeClaimInTenant(db, COMMAND_OPERATION, {
          companyId: COMPANY_A1,
        }).catch((caught: unknown) => caught);
        const invented = await requireScopeClaimInTenant(db, COMMAND_OPERATION, {
          companyId: randomUUID(),
        }).catch((caught: unknown) => caught);
        return { softDeleted, invented };
      });
      deleted = outcomes.softDeleted;
      nowhere = outcomes.invented;
    } finally {
      await admin.query(`UPDATE org.legal_companies SET deleted_at = NULL WHERE id = $1`, [
        COMPANY_A1,
      ]);
    }

    for (const outcome of [deleted, nowhere]) {
      expect(outcome).toBeInstanceOf(AppFailure);
      const failure = outcome as AppFailure;
      expect(failure.code).toBe('ERR-IAM-001');
      expect(failure.status).toBe(403);
      expect(failure.safeDetails).toEqual({ requiredPermissions: [COMMAND_PERMISSION] });
      // Neither names the company it was handed, or the refusal would echo a guess.
      expect(failure.message).not.toContain(COMPANY_A1);
    }
    // Byte-identical, so a soft-deleted company is indistinguishable from an invented
    // one. This is the disclosure property, not an approximation of it.
    expect((deleted as AppFailure).message).toBe((nowhere as AppFailure).message);

    // And the restore worked, so no later suite inherits a deleted company.
    await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) => {
      await expect(
        requireScopeClaimInTenant(db, COMMAND_OPERATION, { companyId: COMPANY_A1 })
      ).resolves.toBeUndefined();
    });
  });

  it('refuses an in-tenant company the caller grant union hides', async () => {
    // The corner that makes "not visible to this caller" the honest reading of the
    // refusal, rather than "not in this tenant". The company is REAL, is in the
    // caller's own tenant and is resolvable by the same caller one line above — it is
    // `iam.allowed_company_ids()` that hides it, exactly as the branch probe's own
    // mixed-grant case shows for `iam.allowed_branch_ids()`.
    const outcome = await withTransaction(
      contextFor({ userId: USER_PERMITTED, companyIds: [randomUUID()] }),
      async (db) =>
        requireScopeClaimInTenant(db, COMMAND_OPERATION, { companyId: COMPANY_A1 }).catch(
          (caught: unknown) => caught
        )
    );
    expect(outcome).toBeInstanceOf(AppFailure);
    expect((outcome as AppFailure).code).toBe('ERR-IAM-001');
    expect((outcome as AppFailure).status).toBe(403);

    // Anti-vacuity: the SAME claim, by the SAME user, with no narrowing.
    await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) => {
      await expect(
        requireScopeClaimInTenant(db, COMMAND_OPERATION, { companyId: COMPANY_A1 })
      ).resolves.toBeUndefined();
    });
  });

  it('resolves an empty claim, and refuses a half claim that names a branch and no company', async () => {
    /*
     * CC-56 (c). A claim naming a branch and no company used to return without a
     * statement — a guard failing OPEN on input it cannot resolve. It is now refused
     * with the uniform refusal a foreign pair receives.
     *
     * The half claim names a REAL branch this caller can see: the full pair it belongs
     * to resolves one line below. So the refusal is about the missing company, not
     * about the branch, and a probe that still resolved the branch alone would pass the
     * positive control and fail here.
     */
    const outcomes = await withTransaction(contextFor({ userId: USER_PERMITTED }), async (db) => {
      await expect(requireScopeClaimInTenant(db, COMMAND_OPERATION, {})).resolves.toBeUndefined();
      await expect(
        requireScopeClaimInTenant(db, COMMAND_OPERATION, {
          companyId: COMPANY_A1,
          branchId: BRANCH_A1,
        })
      ).resolves.toBeUndefined();
      // Sequential, for the reason the sibling blocks state: one pg client.
      const half = await requireScopeClaimInTenant(db, COMMAND_OPERATION, {
        branchId: BRANCH_A1,
      }).catch((caught: unknown) => caught);
      const invented = await requireScopeClaimInTenant(db, COMMAND_OPERATION, {
        branchId: randomUUID(),
      }).catch((caught: unknown) => caught);
      const foreignPair = await requireScopeClaimInTenant(db, COMMAND_OPERATION, {
        companyId: randomUUID(),
        branchId: randomUUID(),
      }).catch((caught: unknown) => caught);
      return { half, invented, foreignPair };
    });

    for (const outcome of [outcomes.half, outcomes.invented, outcomes.foreignPair]) {
      expect(outcome).toBeInstanceOf(AppFailure);
      const failure = outcome as AppFailure;
      expect(failure.code).toBe('ERR-IAM-001');
      expect(failure.status).toBe(403);
      expect(failure.safeDetails).toEqual({ requiredPermissions: [COMMAND_PERMISSION] });
      expect(failure.message).not.toContain(BRANCH_A1);
    }
    // The half claim is indistinguishable from a foreign pair: the same message, byte
    // for byte, so the refusal does not reveal which half was missing.
    expect((outcomes.half as AppFailure).message).toBe(
      (outcomes.foreignPair as AppFailure).message
    );
    expect((outcomes.invented as AppFailure).message).toBe(
      (outcomes.foreignPair as AppFailure).message
    );
  });

  it('is reached only after the permission decision, and answers with the same shape', async () => {
    /*
     * The ORDER is the services' to keep — `authorizeScope` first, the claim second —
     * and it is observable only when BOTH would refuse. So both refusals are taken
     * for the same caller and the same invisible company, and the order the services
     * use is asserted to produce the permission one.
     *
     * If the claim ran first, a caller holding none of the operation's codes would be
     * told the company is invisible instead of being told what it lacks — which is
     * the trap CC-14 records for the read path and the reason the probe is second
     * there too.
     */
    const invisible = { companyId: randomUUID() };

    const inServiceOrder = await withTransaction(
      contextFor({ userId: USER_UNPERMITTED }),
      async (db) => {
        await requirePermissions(db, COMMAND_OPERATION);
        await requireScopeClaimInTenant(db, COMMAND_OPERATION, invisible);
      }
    ).catch((caught: unknown) => caught);

    expect(inServiceOrder).toBeInstanceOf(AppFailure);
    const permissionDenial = inServiceOrder as AppFailure;
    expect(permissionDenial.message).toContain(`missing ${COMMAND_PERMISSION}`);
    expect(permissionDenial.message).not.toContain('not visible');

    // The claim refusal the reversed order would have produced, for the same caller
    // and the same company. Both exist, so the assertion above is about ORDER and not
    // about only one of the two being reachable.
    const claimFirst = await withTransaction(contextFor({ userId: USER_UNPERMITTED }), async (db) =>
      requireScopeClaimInTenant(db, COMMAND_OPERATION, invisible).catch((caught: unknown) => caught)
    );
    expect(claimFirst).toBeInstanceOf(AppFailure);
    const claimRefusal = claimFirst as AppFailure;
    expect(claimRefusal.message).toContain('not visible');

    // CC-56 (a): the two refusals of one operation publish the SAME safe details, so
    // a caller cannot tell from the document which of them answered. This is what the
    // route handler's injection buys — the claim probe is handed the operation and
    // publishes its declared codes, rather than publishing nothing.
    expect(claimRefusal.status).toBe(permissionDenial.status);
    expect(claimRefusal.code).toBe(permissionDenial.code);
    expect(claimRefusal.safeDetails).toEqual(permissionDenial.safeDetails);
    expect(claimRefusal.safeDetails).toEqual({ requiredPermissions: [COMMAND_PERMISSION] });
  });
});
