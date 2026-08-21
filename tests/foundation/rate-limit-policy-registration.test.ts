/**
 * Every operation's declared rate-limit policy must be one that exists
 * (`P1-27-INT-113`).
 *
 * The defect: `rateLimitPolicy` was typed `string` and `RATE_LIMIT_POLICIES` was
 * annotated `Readonly<Record<string, RateLimitPolicy>>`, which erased its keys.
 * Six shipped operations declared `'standard-read'` — a name that was never
 * registered — and `policyFor()` threw on every request to them. Because that
 * call sat ABOVE `handleOperation`'s try block, the throw escaped the error
 * contract entirely and became an unhandled 500, before authentication, for
 * every caller. Measured against the running API: six 500s, where three controls
 * declaring a registered policy answered 401 `ERR-IAM-002`.
 *
 * The name is now a compile-time union, so this suite should be unable to fail.
 * It exists anyway. A type can be widened back by anyone who finds it
 * inconvenient, and `RATE_LIMIT_POLICIES` is also read at RUNTIME by key. This
 * asserts the property the product depends on, not the mechanism that currently
 * provides it.
 *
 * **The route modules are discovered from the filesystem, not listed here.** A
 * hand-written import list is exactly how this defect survived: the operations
 * were registered somewhere, and no suite that enumerated them ever included
 * these six. A list that must be maintained is a list that will be incomplete.
 *
 * A text scan over the route files would also have been wrong, and this file
 * proves it: the comments added by the fix contain the literal `'standard-read'`
 * in prose, so a scanner would flag the repair as the defect. Only loading the
 * registry answers the question.
 */
import { readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { allOperations, type RegisteredOperation } from '@/server/auth/operation-registry';
import { RATE_LIMIT_POLICIES, type RateLimitPolicy } from '@/server/http/rate-limit';
import { policyFor } from '@/server/http/route-handler';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROUTE_ROOT = resolve(HERE, '..', '..', 'apps', 'api', 'src', 'app', 'api', 'v1');
const REGISTERED = new Set(Object.keys(RATE_LIMIT_POLICIES));

function routeModules(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...routeModules(full));
    else if (entry.name === 'route.ts') found.push(full);
  }
  return found;
}

let operations: readonly RegisteredOperation[] = [];

beforeAll(async () => {
  // Importing a route module executes its `defineOperation()` call, which is
  // what puts the operation in the registry. The import IS the setup.
  for (const file of routeModules(ROUTE_ROOT)) {
    await import(pathToFileURL(file).href);
  }
  operations = allOperations();
  // The explicit timeout is load-bearing, not padding. Every route module pulls
  // in the server composition behind it, and two hundred of them exceed vitest's
  // 10 s hook default whenever the transform cache is cold — which it is on a
  // clean CI checkout. This suite passed in isolation and timed out inside the
  // full tier, and a hook timeout SKIPS the tests rather than failing them, so
  // the tier would have reported "7 skipped" and stayed green while measuring
  // nothing.
}, 180_000);

describe('rate-limit policy registration', () => {
  it('loaded the whole route tree, so the walks below are not vacuous', () => {
    // Without this, a broken import path would empty every assertion in the file
    // and the suite would pass by measuring nothing.
    expect(routeModules(ROUTE_ROOT).length).toBeGreaterThan(150);
    expect(operations.length).toBeGreaterThan(150);
    expect(operations.filter((op) => op.rateLimitPolicy !== undefined).length).toBeGreaterThan(150);
  });

  it('registers the five documented policies', () => {
    expect([...REGISTERED].sort()).toEqual([
      'auth-adjacent',
      'expensive-read',
      'low-risk-metadata',
      'public-probe',
      'standard-command',
    ]);
  });

  it('never registers `standard-read`, the name six operations used to declare', () => {
    // Not a tautology. If someone "fixes" this finding by minting the missing
    // policy instead of correcting the six routes, those operations would start
    // working and six choices of budget and key would have been made by
    // accident. Adding it is a decision, not a repair.
    expect(REGISTERED.has('standard-read')).toBe(false);
  });

  it('every declared policy name is registered', () => {
    const unknown = operations
      .filter((op) => op.rateLimitPolicy !== undefined)
      .filter((op) => !REGISTERED.has(op.rateLimitPolicy as string))
      .map((op) => `${op.id} -> "${op.rateLimitPolicy as string}"`);
    expect(
      unknown,
      'These operations name a rate-limit policy that does not exist. Every request to them ' +
        `throws in policyFor() before the handler runs:\n  ${unknown.join('\n  ')}`
    ).toEqual([]);
  });

  it('policyFor resolves for every operation without throwing', () => {
    // The behavioural half. The assertion above compares strings; this runs the
    // function that actually failed, which is what a caller experiences.
    const failures: string[] = [];
    for (const op of operations) {
      try {
        const resolved: RateLimitPolicy | undefined = policyFor(op);
        if (op.rateLimitPolicy !== undefined && resolved === undefined) {
          failures.push(`${op.id} declares "${op.rateLimitPolicy}" and resolved to undefined`);
        }
      } catch (error) {
        failures.push(`${op.id} threw: ${(error as Error).message}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('no public operation is throttled by a policy keyed on tenant or user', () => {
    // A public route has no tenant and no user, so such a policy collapses every
    // caller in the world into one bucket (P1-15-SR-004). Asserted here because
    // this is already the suite that resolves every policy.
    const wrong = operations
      .filter((op) => op.public === true)
      .map((op) => ({ id: op.id, policy: policyFor(op) }))
      .filter(
        ({ policy }) =>
          policy !== undefined && (policy.keyBy.includes('tenant') || policy.keyBy.includes('user'))
      )
      .map(({ id, policy }) => `${id} -> ${policy?.name}`);
    expect(wrong, wrong.join('\n')).toEqual([]);
  });

  it('the six operations that were dead now resolve to a real policy', () => {
    // Named explicitly. The walk above would pass if these routes were deleted;
    // this fails if they lose their throttle or disappear.
    const wasDead = [
      'shared.document-read',
      'shared.notification-list',
      'shared.notification-read',
      'shared.notification-delivery-list',
      'rpt.report-read',
      'rpt.report-catalogue',
    ];
    for (const id of wasDead) {
      const op = operations.find((candidate) => candidate.id === id);
      expect(op, `${id} must still be registered`).toBeDefined();
      const policy = policyFor(op as RegisteredOperation);
      expect(policy, `${id} must resolve to a policy`).toBeDefined();
      expect(REGISTERED.has(policy?.name ?? ''), `${id} -> ${policy?.name}`).toBe(true);
    }
  });
});
