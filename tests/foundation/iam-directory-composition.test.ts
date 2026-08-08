import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The IAM read surface composes without an identity provider (`P1-27-INT-026`).
 *
 * ## The defect this guards
 *
 * `iamModule()`'s composition root calls `installIamRuntime()`, which builds the
 * Supabase adapter from configuration and reads `clientEnv()`. Any module that
 * composed IAM merely to turn an actor id into a name therefore made its own
 * read depend on `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
 * and answer `ERR-SYS-001` wherever those are unset.
 *
 * That was measured, not feared: the first draft of the vehicle history fix
 * wired `listHistory` to `iamModule()` and turned two green backend tests into
 * 500s — the `P1-27-INT-113` shape, an operation failing every request because
 * of a composition-time dependency.
 *
 * The repository had already met this wall twice and routed around it rather
 * than through it. `server/auth/authorization.ts:171-174` and `:232-233` both
 * refuse to reach `@/modules/iam` for a permission check, in prose, because
 * doing so "would force that module's composition root — including its Supabase
 * client configuration — to boot on any request that prices a discounted line".
 *
 * `iamDirectory()` is the root that removes the wall. This file is what keeps it
 * removed.
 *
 * ## Why the contrast is asserted too
 *
 * Asserting only that `iamDirectory()` composes would pass just as happily in an
 * environment where the variables happen to be set — proving nothing. The second
 * case asserts that `iamModule()`, under the identical unset environment, still
 * fails. One passing and one failing is the evidence; either alone is not.
 *
 * `vi.resetModules()` before each import is what makes that possible:
 * `composeModule` memoises per closure and `installIamRuntime` is idempotent, so
 * a registry shared with an earlier test would answer from a provider somebody
 * else already installed.
 */

/*
 * Thirty seconds, matching `canonical-documents.test.ts:33` and
 * `module-boundaries.test.ts:40`, which raise it for the same reason.
 *
 * Every case here calls `vi.resetModules()` and then `await import('@/modules/iam')`,
 * so each pays for a COLD transform and import of the whole IAM module graph.
 *
 * Stated honestly, because the first attempt at this comment got the mechanism
 * wrong: on an idle machine the file passes comfortably — measured at 1.4 s for
 * the slowest case, and the full 79-file tier green at 1692/1692. The failures
 * that prompted this appeared only while six concurrent review agents were
 * saturating the CPU, and under that load four OTHER files in this tier
 * (`operation-coverage-gate`, `dependency-path-proof`, `route-templates`,
 * `repository-paths`) time out too, on unmutated trees.
 *
 * So this is insurance against a loaded CI runner, not a fix for a reproduced
 * defect, and it is the cheapest member of a family this repository has already
 * been bitten by. It weakens no assertion: the bound has nothing to do with the
 * property under test, and `vi.resetModules()` stays, because without it
 * `composeModule`'s per-closure memoisation would hand this file a registry
 * somebody else had already booted a provider into.
 */
vi.setConfig({ testTimeout: 30_000 });

const PROVIDER_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'AUTH_JWT_SECRET',
  'AUTH_JWT_ISSUER',
] as const;

const saved = new Map<string, string | undefined>();

beforeEach(() => {
  vi.resetModules();
  for (const name of PROVIDER_ENV) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of saved) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  saved.clear();
});

describe('the identity directory needs no identity provider', () => {
  it('composes with every provider variable unset', async () => {
    const { iamDirectory } = await import('@/modules/iam');
    // The whole point. A module that only wants to name an actor must not be
    // made to configure an authentication provider to do it.
    expect(() => iamDirectory()).not.toThrow();
  });

  it('exposes a directory service that can resolve identities', async () => {
    const { iamDirectory } = await import('@/modules/iam');
    const composed = iamDirectory();
    expect(composed.directory).toBeDefined();
    expect(typeof composed.directory.resolveDisplayIdentities).toBe('function');
  });

  it('memoises, so composing twice constructs once', async () => {
    const { iamDirectory } = await import('@/modules/iam');
    expect(iamDirectory()).toBe(iamDirectory());
  });
});

describe('this guard is not vacuous', () => {
  it('the full module root DOES still fail under the same unset environment', async () => {
    const { iamModule } = await import('@/modules/iam');
    // If this ever stops throwing, the environment under test has provider
    // configuration after all and the case above proves nothing — so the two
    // assertions must be read together.
    expect(() => iamModule()).toThrow();
  });

  it('the two roots are independent — composing the directory does not boot the provider', async () => {
    const { iamDirectory, iamModule } = await import('@/modules/iam');
    iamDirectory();
    // `composeModule` memoises per closure rather than per module name. If the
    // directory had booted the runtime as a side effect, this would now succeed
    // and the coupling would be back with nothing to notice it.
    expect(() => iamModule()).toThrow();
  });
});
