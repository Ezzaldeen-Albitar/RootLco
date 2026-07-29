/**
 * CWE-916 — secret material must never reach a persisted fingerprint.
 *
 * `shared.idempotency_keys.request_fingerprint` is a SHA-256 that is stored and
 * retained. SHA-256 is fast and unkeyed, so for any input drawn from a small
 * space — a password, a PIN, a six-digit OTP — a digest in a table is an offline
 * guessing target, and every other framed component (tenant, principal, method,
 * path) is knowable to whoever holds that table.
 *
 * ## What was and was not true when this was written
 *
 * CodeQL reported the password from the two password-reset routes flowing into
 * this digest. That path was **not reachable**, and the evidence is pinned below
 * rather than asserted in prose: `route-handler.ts` fingerprints only when
 * `operation.idempotent === true`, both password routes are `public: true` and
 * declare no idempotency, and `requestFingerprint` already refuses a request
 * with no authenticated principal.
 *
 * Nothing enforced any of that. One `idempotent: true` on a future credential
 * route would have made the alert true, silently, with no test failing — so the
 * fix is the guard and the registry gate, not a dismissal.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildRequestContext, type RequestContext } from '@/server/context/request-context';
import { assertNoSecretMaterial, requestFingerprint } from '@/server/http/idempotency';
import { AppFailure, isAppFailure } from '@/server/errors/app-failure';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '33333333-3333-4333-8333-333333333333';

const context = (): RequestContext =>
  buildRequestContext({
    correlationId: randomUUID(),
    principal: { tenantId: TENANT, userId: USER },
    operation: 'test.command',
    module: 'test',
  });

/** A value that must never appear anywhere, no matter how the guard reports. */
const SECRET = 'correct-horse-battery-staple-9f3a';

const capture = (run: () => unknown): AppFailure => {
  try {
    run();
  } catch (error) {
    if (isAppFailure(error)) return error;
    throw error;
  }
  throw new Error('expected the call to throw');
};

describe('the fingerprint refuses secret material', () => {
  it('refuses a top-level password field before hashing anything', () => {
    const failure = capture(() =>
      requestFingerprint(context(), {
        method: 'POST',
        path: '/auth/password',
        body: { password: SECRET },
      })
    );
    expect(failure.code).toBe('ERR-INT-003');
  });

  it('never places the secret VALUE in the failure, only the field name', () => {
    const failure = capture(() =>
      requestFingerprint(context(), {
        method: 'POST',
        path: '/auth/password',
        body: { password: SECRET },
      })
    );
    expect(JSON.stringify(failure.safeDetails)).not.toContain(SECRET);
    expect(failure.message).not.toContain(SECRET);
    expect(failure.message).toContain('password');
  });

  it('sees a secret nested inside an object', () => {
    expect(
      capture(() =>
        requestFingerprint(context(), {
          method: 'POST',
          path: '/x',
          body: { credentials: { user: 'a', clientSecret: SECRET } },
        })
      ).code
    ).toBe('ERR-INT-003');
  });

  it('sees a secret nested inside an array of objects', () => {
    expect(
      capture(() =>
        requestFingerprint(context(), {
          method: 'POST',
          path: '/x',
          body: { entries: [{ ok: 1 }, { otp: '123456' }] },
        })
      ).code
    ).toBe('ERR-INT-003');
  });

  it('sees a secret in the resolved route parameters, not only the body', () => {
    expect(
      capture(() =>
        requestFingerprint(context(), {
          method: 'POST',
          path: '/x/{recoveryCode}',
          body: null,
          params: { recovery_code: SECRET },
        })
      ).code
    ).toBe('ERR-INT-003');
  });

  it('covers every declared sensitive name, in several spellings', () => {
    const names = [
      'password',
      'passwd',
      'pwd',
      'passphrase',
      'secret',
      'client_secret',
      'clientSecret',
      'credential',
      'otp',
      'totp',
      'pin',
      'recovery_code',
      'recoveryCode',
      'security_answer',
      'private_key',
      'privateKey',
      'refresh_token',
      'refreshToken',
      'access_token',
      'accessToken',
      'session_token',
      'api_key',
      'apiKey',
      'auth_token',
      'authToken',
      'newPassword',
      'confirm_password',
    ];
    for (const name of names) {
      const failure = capture(() =>
        requestFingerprint(context(), {
          method: 'POST',
          path: '/x',
          body: { [name]: SECRET },
        })
      );
      expect(failure.code, name).toBe('ERR-INT-003');
    }
  });

  it('does not fire on ordinary business fields', () => {
    // A guard that refuses everything is a guard that gets deleted. These are
    // real field names from the registry's own routes.
    const benign = {
      customerId: 'a',
      documentId: 'b',
      uploadToken: 'c',
      contentType: 'd',
      keyAccountManager: 'e',
      description: 'f',
      pinnedNote: 'g',
      tokenizedAt: 'h',
      openingBalance: 1,
      items: [{ quantity: 2, unitPrice: '3.00' }],
    };
    expect(() =>
      requestFingerprint(context(), { method: 'POST', path: '/x', body: benign })
    ).not.toThrow();
  });

  it('still produces a stable digest for a request with no secret', () => {
    const request = { method: 'POST', path: '/things', body: { amount: 10 } } as const;
    const a = requestFingerprint(context(), request);
    const b = requestFingerprint(context(), request);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('answers ERR-IAM-002 first when there is no principal, before looking at the body', () => {
    // Ordering matters. `buildRequestContext` always carries a principal, so an
    // unresolved one is constructed directly — which is the shape
    // `requestFingerprint` guards with `context.principal?.tenantId`. An
    // unauthenticated caller must learn nothing about the body, so the
    // missing-principal answer has to win.
    const anonymous = { principal: undefined } as unknown as RequestContext;
    expect(
      capture(() =>
        requestFingerprint(anonymous, {
          method: 'POST',
          path: '/x',
          body: { password: SECRET },
        })
      ).code
    ).toBe('ERR-IAM-002');
  });

  it('answers a CLIENT error, so a caller cannot manufacture a 500 at will', () => {
    // The regression an adversarial review caught in the first version of this
    // guard. `options.body` is the RAW pre-validation JSON — routes obtain it
    // with `request.clone().json()` before `handleOperation` runs — so any
    // authenticated caller could append a `password` key to any of the 107
    // idempotent endpoints and turn a would-be 422 into a server error. The
    // refusal is right; the 500 was not.
    const failure = capture(() =>
      requestFingerprint(context(), {
        method: 'POST',
        path: '/things',
        body: { amount: 10, password: SECRET },
      })
    );
    expect(failure.code).toBe('ERR-INT-003');
    expect(failure.status, 'a caller-supplied field must never yield a 5xx').toBeLessThan(500);
    expect(failure.status).toBe(400);
  });

  it('bounds its own traversal so a hostile nesting depth cannot hang it', () => {
    let deep: Record<string, unknown> = { password: SECRET };
    for (let i = 0; i < 5_000; i += 1) deep = { nested: deep };
    // Past the depth bound the guard stops looking; it must return rather than
    // recurse to a stack overflow. Either outcome is acceptable except a crash.
    expect(() => assertNoSecretMaterial(deep, 'body')).not.toThrow(RangeError);
  });
});

/**
 * The registration gate. The runtime guard fails a REQUEST; this fails the
 * BUILD, which is where a configuration defect belongs.
 *
 * It reads the route sources rather than the runtime registry on purpose. The
 * registry only knows an operation once its module has been imported, so a
 * registry-based check would silently cover whatever happened to be loaded — the
 * vacuous-gate shape this repository has been bitten by before. The filesystem
 * knows every route unconditionally.
 */
describe('no route declares idempotency alongside secret material', () => {
  const ROUTES = join(__dirname, '../../src/app/api');

  const routeFiles = (dir: string, out: string[] = []): string[] => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) routeFiles(full, out);
      else if (entry.name === 'route.ts') out.push(full);
    }
    return out;
  };

  const files = routeFiles(ROUTES);

  it('finds the route tree, so this gate cannot pass by scanning nothing', () => {
    expect(files.length).toBeGreaterThan(80);
    expect(
      files.filter((f) => readFileSync(f, 'utf8').includes('idempotent: true')).length
    ).toBeGreaterThan(50);
  });

  it('no idempotent route declares a secret-shaped field in a Zod schema', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      if (!source.includes('idempotent: true')) continue;
      // Field declarations only — `name: z.…` — so a mention in a comment or a
      // response mapping does not trip the gate.
      for (const [, name] of source.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*z\./gm)) {
        try {
          assertNoSecretMaterial({ [name ?? '']: 'x' }, 'body');
        } catch {
          offenders.push(`${relative(ROUTES, file).replace(/\\/g, '/')} -> ${name}`);
        }
      }
    }
    expect(
      offenders,
      'an idempotent operation cannot fingerprint secret material — see ERR-INT-003'
    ).toEqual([]);
  });

  it('would catch a secret field if one were added to an idempotent route', () => {
    // Proves the previous assertion is not vacuous: the same matcher, run over a
    // synthetic route, must produce an offender.
    const synthetic = [
      "export const OP = defineOperation({ id: 'x.y', idempotent: true });",
      'const Body = z.object({',
      '  documentId: z.string(),',
      '  newPassword: z.string(),',
      '});',
    ].join('\n');
    const found: string[] = [];
    for (const [, name] of synthetic.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*z\./gm)) {
      try {
        assertNoSecretMaterial({ [name ?? '']: 'x' }, 'body');
      } catch {
        found.push(name ?? '');
      }
    }
    expect(found).toEqual(['newPassword']);
  });
});
