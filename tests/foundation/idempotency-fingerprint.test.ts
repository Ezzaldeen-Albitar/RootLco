/**
 * Properties of the principal-bound idempotency fingerprint (ADV-04).
 *
 * The backend suite proves the *behaviour* — that a second principal is refused
 * and learns nothing. This suite attacks the *digest*, which needs no database:
 * if two different (principal, method, path, body) tuples can collide, the
 * behaviour proofs rest on nothing.
 *
 * The concatenation-ambiguity class is the one that matters. A digest over
 * `a + sep + b` collides whenever a value can contain the separator, so the
 * preimage is length-prefixed instead. These tests exist to fail if anyone
 * "simplifies" that back to a join.
 */
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { buildRequestContext, type RequestContext } from '@/server/context/request-context';
import { requestFingerprint } from '@/server/http/idempotency';
import { AppFailure } from '@/server/errors/app-failure';

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const USER_A = '33333333-3333-4333-8333-333333333333';
const USER_B = '44444444-4444-4444-8444-444444444444';

function contextFor(tenantId: string, userId: string): RequestContext {
  return buildRequestContext({
    correlationId: randomUUID(),
    principal: { tenantId, userId },
    operation: 'test.command',
    module: 'test',
  });
}

const REQUEST = { method: 'POST', path: '/things', body: { amount: 10 } } as const;

describe('the fingerprint binds the principal', () => {
  it('differs for two principals in the same tenant, same request', () => {
    const a = requestFingerprint(contextFor(TENANT_A, USER_A), REQUEST);
    const b = requestFingerprint(contextFor(TENANT_A, USER_B), REQUEST);
    expect(a).not.toBe(b);
  });

  it('differs for the same principal id in two tenants', () => {
    const a = requestFingerprint(contextFor(TENANT_A, USER_A), REQUEST);
    const b = requestFingerprint(contextFor(TENANT_B, USER_A), REQUEST);
    expect(a).not.toBe(b);
  });

  it('is stable across contexts that differ only in correlation id', () => {
    const a = requestFingerprint(contextFor(TENANT_A, USER_A), REQUEST);
    const b = requestFingerprint(contextFor(TENANT_A, USER_A), REQUEST);
    expect(a).toBe(b);
  });

  it('is a plain SHA-256 digest that reveals nothing about the principal', () => {
    const digest = requestFingerprint(contextFor(TENANT_A, USER_A), REQUEST);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toContain(USER_A.replace(/-/g, ''));
    expect(digest).not.toContain(TENANT_A.replace(/-/g, ''));
  });
});

describe('the preimage is unambiguous', () => {
  const context = contextFor(TENANT_A, USER_A);

  it('does not collide when a separator is moved between path and body', () => {
    // The classic concatenation collision: if the preimage were joined on a
    // separator, these two would produce identical bytes.
    const a = requestFingerprint(context, { method: 'POST', path: '/a', body: 'b/c' });
    const b = requestFingerprint(context, { method: 'POST', path: '/a/b', body: 'c' });
    expect(a).not.toBe(b);
  });

  it('does not collide when a separator is moved between params and body', () => {
    // The same property, on the two components that are still free-form. The
    // path and method are now drawn from a validated/literal set, so framing is
    // no longer their only defence — but it is still the ONLY defence params and
    // body have, which is why the property keeps a test of its own.
    const a = requestFingerprint(context, {
      method: 'POST',
      path: '/things',
      params: { id: 'a' },
      body: 'b|c',
    });
    const b = requestFingerprint(context, {
      method: 'POST',
      path: '/things',
      params: { id: 'a|b' },
      body: 'c',
    });
    expect(a).not.toBe(b);
  });

  // The two cases below used to assert that framing SURVIVED a hostile path.
  // They now assert something stronger: such a path never reaches the digest at
  // all. A newline cannot occur in a registered route template, and a template
  // that is not registered is a programming error, so hashing it would bind an
  // idempotency key to a target nobody declared.
  it('refuses to fingerprint a path with an embedded newline', () => {
    expect(() =>
      requestFingerprint(context, { method: 'POST', path: '/a\nPOST\n/b', body: null })
    ).toThrowError(/unregistered route template/);
  });

  it('refuses an empty path and a method that absorbed part of one', () => {
    // The method is checked first, so `POST/x` is refused as a verb before the
    // empty path is ever considered. Both halves are asserted separately rather
    // than assuming which guard fires.
    expect(() =>
      requestFingerprint(context, { method: 'POST/x', path: '', body: null })
    ).toThrowError(/unroutable method/);
    expect(() =>
      requestFingerprint(context, { method: 'POST', path: '', body: null })
    ).toThrowError(/unregistered route template/);
    expect(() =>
      requestFingerprint(context, { method: 'POST/x', path: '/x', body: null })
    ).toThrowError(/unroutable method/);
  });

  it('refuses a verb outside the routed set rather than hashing it', () => {
    // `find` over a frozen literal array is what ends the CodeQL dataflow, and
    // it is only sound because a miss is refused instead of falling through.
    for (const verb of ['TRACE', 'CONNECT', 'PROPFIND', '', 'POST ']) {
      expect(() => requestFingerprint(context, { ...REQUEST, method: verb })).toThrowError(
        /unroutable method/
      );
    }
  });

  it('accepts every verb this platform actually routes, and a parameterised template', () => {
    for (const verb of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      expect(() => requestFingerprint(context, { ...REQUEST, method: verb })).not.toThrow();
    }
    expect(() =>
      requestFingerprint(context, {
        ...REQUEST,
        path: '/work-orders/{workOrderId}/history',
      })
    ).not.toThrow();
  });

  it('separates a missing key from an explicitly null one', () => {
    const a = requestFingerprint(context, { ...REQUEST, body: { amount: 10 } });
    const b = requestFingerprint(context, { ...REQUEST, body: { amount: 10, note: null } });
    expect(a).not.toBe(b);
  });

  it('treats an undefined value as absent, so it cannot silently change identity', () => {
    const a = requestFingerprint(context, { ...REQUEST, body: { amount: 10 } });
    const b = requestFingerprint(context, { ...REQUEST, body: { amount: 10, note: undefined } });
    expect(a).toBe(b);
  });

  it('is insensitive to key order but sensitive to value change', () => {
    const ordered = requestFingerprint(context, { ...REQUEST, body: { a: 1, b: 2 } });
    const shuffled = requestFingerprint(context, { ...REQUEST, body: { b: 2, a: 1 } });
    const changed = requestFingerprint(context, { ...REQUEST, body: { a: 1, b: 3 } });
    expect(ordered).toBe(shuffled);
    expect(ordered).not.toBe(changed);
  });

  it('normalises the method case, and refuses an upper-case template', () => {
    expect(requestFingerprint(context, { ...REQUEST, method: 'post' })).toBe(
      requestFingerprint(context, { ...REQUEST, method: 'POST' })
    );
    // Registered templates are lower-case by construction, so a differently
    // cased one is not a different route — it is an unregistered one. This
    // previously produced a DIFFERENT fingerprint, silently splitting one route
    // into two idempotency identities; it is now refused.
    expect(() => requestFingerprint(context, { ...REQUEST, path: '/API/Things' })).toThrowError(
      /unregistered route template/
    );
  });
});

describe('a client-supplied identity cannot reach the binding', () => {
  it('a forged identity field in the body does not impersonate that principal', () => {
    const attacker = contextFor(TENANT_A, USER_B);
    const forged = requestFingerprint(attacker, {
      ...REQUEST,
      body: { ...REQUEST.body, userId: USER_A, created_by: USER_A, principal: { userId: USER_A } },
    });
    const genuine = requestFingerprint(contextFor(TENANT_A, USER_A), REQUEST);

    expect(forged).not.toBe(genuine);
  });

  it('a forged tenant field in the body does not cross tenants', () => {
    const attacker = contextFor(TENANT_B, USER_A);
    const forged = requestFingerprint(attacker, {
      ...REQUEST,
      body: { ...REQUEST.body, tenantId: TENANT_A },
    });
    const genuine = requestFingerprint(contextFor(TENANT_A, USER_A), REQUEST);

    expect(forged).not.toBe(genuine);
  });
});

describe('an unresolved principal fails closed', () => {
  it('throws ERR-IAM-002 rather than returning an unbound fingerprint', () => {
    const unauthenticated = {
      ...contextFor(TENANT_A, USER_A),
      principal: undefined,
    } as unknown as RequestContext;

    expect(() => requestFingerprint(unauthenticated, REQUEST)).toThrow(AppFailure);
    try {
      requestFingerprint(unauthenticated, REQUEST);
    } catch (caught) {
      expect((caught as AppFailure).code).toBe('ERR-IAM-002');
    }
  });

  it('throws when the principal exists but carries no ids', () => {
    const empty = {
      ...contextFor(TENANT_A, USER_A),
      principal: { tenantId: '', userId: '' },
    } as unknown as RequestContext;

    expect(() => requestFingerprint(empty, REQUEST)).toThrow(AppFailure);
  });
});
