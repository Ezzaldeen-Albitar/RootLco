/**
 * Which policy a public operation is actually throttled by (PMR-001, PMR-002).
 *
 * The P1-15-SR-004 fix made `handleOperation` enforce a rate-limit policy before
 * the handler for `public: true` operations, because a policy keyed on tenant or
 * user cannot throttle a request that has neither. The first version of that fix
 * substituted `public-probe` for **every** public operation, unconditionally.
 *
 * That was wrong in two directions, and both are silent — the route keeps
 * working, it is just governed by something other than what its own registration
 * says:
 *
 *  * **Downgrade.** The four unauthenticated `iam.auth-*` operations declare
 *    `auth-adjacent`: 10 requests a minute, `securityRelevant: true`. The
 *    substitution replaced it with `public-probe`: 120 a minute,
 *    `securityRelevant: false`. Credential stuffing got twelve times the budget
 *    and stopped raising a security signal, while each route's own
 *    `publicReason` text still said it was "bounded by the auth-adjacent
 *    rate-limit policy".
 *  * **Hole.** `policyFor` returned `undefined` for an operation declaring no
 *    policy *before* reaching the public branch, and `defineOperation()` does not
 *    require one — so a future public route with no declaration would have been
 *    throttled by nothing at all, which is the defect SR-004 was about.
 *
 * The rule now: a declared policy that is already sessionless is kept; anything
 * else — session-keyed, or absent — becomes `public-probe`. Substitution can only
 * make a public route more throttled, never less.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { policyFor } from '@/server/http/route-handler';
import { RATE_LIMIT_POLICIES } from '@/server/http/rate-limit';
import { API_ROUTES_ROOT } from '../../scripts/lib/repository-paths.mjs';

type Op = Parameters<typeof policyFor>[0];

/** A registration shaped just enough for `policyFor`. */
function op(overrides: Partial<Op>): Op {
  return {
    id: 'test.op',
    module: 'meta',
    method: 'GET',
    path: '/test',
    summary: 'test',
    permissions: [],
    scope: 'tenant',
    auditClass: 'none',
    public: false,
    ...overrides,
  } as Op;
}

describe('P1-15 / public rate-limit policy resolution', () => {
  it('keeps a sessionless declared policy instead of widening it', () => {
    const resolved = policyFor(op({ public: true, rateLimitPolicy: 'auth-adjacent' }));
    expect(resolved?.name).toBe('auth-adjacent');
    expect(resolved?.limit).toBe(10);
    expect(resolved?.securityRelevant).toBe(true);
  });

  it('substitutes public-probe for a session-keyed declared policy', () => {
    const resolved = policyFor(op({ public: true, rateLimitPolicy: 'standard-command' }));
    expect(resolved?.name).toBe('public-probe');
  });

  it('substitutes public-probe when a public operation declares no policy at all', () => {
    const resolved = policyFor(op({ public: true }));
    expect(resolved?.name).toBe('public-probe');
  });

  it('never resolves a public operation to no policy', () => {
    for (const declared of [undefined, 'expensive-read', 'standard-command', 'public-probe']) {
      const resolved = policyFor(
        op({ public: true, ...(declared ? { rateLimitPolicy: declared } : {}) })
      );
      expect(resolved, `public operation declaring ${String(declared)}`).toBeDefined();
    }
  });

  it('leaves an authenticated operation exactly as declared', () => {
    expect(policyFor(op({ rateLimitPolicy: 'expensive-read' }))?.name).toBe('expensive-read');
    expect(policyFor(op({ rateLimitPolicy: 'standard-command' }))?.name).toBe('standard-command');
    expect(policyFor(op({}))).toBeUndefined();
  });

  it('refuses an unknown policy name rather than silently dropping the throttle', () => {
    expect(() => policyFor(op({ rateLimitPolicy: 'does-not-exist' }))).toThrow(
      /unknown rate-limit/
    );
    expect(() => policyFor(op({ public: true, rateLimitPolicy: 'does-not-exist' }))).toThrow(
      /unknown rate-limit/
    );
  });
});

/**
 * Reads the registrations from committed source rather than from an imported
 * registry: a route module pulls in the whole server composition, and this tier
 * has no database. The scan is the same technique the observability suite uses,
 * and the count assertion below is what stops it silently matching nothing.
 */
function publicRegistrations(): Array<{ file: string; id: string; policy: string | undefined }> {
  const root = API_ROUTES_ROOT;
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry === 'route.ts') files.push(full);
    }
  };
  walk(root);

  const found: Array<{ file: string; id: string; policy: string | undefined }> = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    for (const block of source.split('defineOperation(').slice(1)) {
      if (!/^[\s\S]{0,3000}?\bpublic:\s*true/.test(block)) continue;
      const id = /\bid:\s*'([^']+)'/.exec(block)?.[1];
      if (!id) continue;
      const policy = /\brateLimitPolicy:\s*'([^']+)'/.exec(block)?.[1];
      found.push({ file, id, policy });
    }
  }
  return found;
}

describe('P1-15 / the registrations, as committed', () => {
  const publicOps = publicRegistrations();

  it('finds exactly the six public registrations, so the scan is not vacuous', () => {
    expect(publicOps.map((o) => o.id).sort()).toEqual([
      'iam.auth-login',
      'iam.auth-logout',
      'iam.auth-password-reset',
      'iam.auth-password-reset-completion',
      'shared.health-live',
      'shared.health-ready',
    ]);
  });

  it('every public registration resolves to a policy that a sessionless request can be keyed by', () => {
    for (const { id, policy } of publicOps) {
      expect(policy, `${id} declares no rateLimitPolicy`).toBeDefined();
      expect(RATE_LIMIT_POLICIES[policy!], `${id} names unknown policy ${policy}`).toBeDefined();

      const resolved = policyFor(op({ public: true, rateLimitPolicy: policy! }));
      expect(resolved, id).toBeDefined();
      expect(resolved!.keyBy, id).not.toContain('tenant');
      expect(resolved!.keyBy, id).not.toContain('user');
    }
  });

  it('the two health probes declare a tenant-keyed policy and are therefore substituted', () => {
    // This is the SR-004 case, kept explicit: `low-risk-metadata` keys on tenant,
    // which a probe never has. Substitution is correct here — and it is correct
    // *because* the declaration is session-keyed, not because the route is public.
    for (const { id, policy } of publicOps.filter((o) => o.id.startsWith('shared.health-'))) {
      const declared = RATE_LIMIT_POLICIES[policy!]!;
      expect(declared.keyBy, id).toContain('tenant');
      expect(policyFor(op({ public: true, rateLimitPolicy: policy! }))?.name, id).toBe(
        'public-probe'
      );
    }
  });

  it('the four auth registrations declare auth-adjacent, as their own publicReason text claims', () => {
    for (const { id, policy } of publicOps.filter((o) => o.id.startsWith('iam.auth-'))) {
      expect(policy, id).toBe('auth-adjacent');
      // And resolution keeps it — this is the assertion that fails against the
      // unconditional substitution.
      expect(policyFor(op({ public: true, rateLimitPolicy: policy! }))?.name, id).toBe(
        'auth-adjacent'
      );
    }
  });

  it('public-probe is looser than auth-adjacent, which is why the substitution direction matters', () => {
    const probe = RATE_LIMIT_POLICIES['public-probe']!;
    const auth = RATE_LIMIT_POLICIES['auth-adjacent']!;
    expect(probe.limit).toBeGreaterThan(auth.limit);
    expect(auth.securityRelevant).toBe(true);
    expect(probe.securityRelevant).toBe(false);
  });
});
