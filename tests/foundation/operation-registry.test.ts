/**
 * Protects the claim that an unguarded operation cannot exist.
 *
 * The registry is only a security control if every incomplete declaration is
 * *rejected*, loudly, at module load. A registry that quietly defaults a missing
 * permission list to "none required", or accepts an audited class with no audit
 * action, is worse than no registry at all: it produces a coverage report that
 * says everything is guarded while nothing is. Each rejection below corresponds
 * to one way that failure mode could be reintroduced.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  OperationRegistrationError,
  allOperations,
  defineOperation,
  getOperation,
  __resetOperationRegistryForTests,
} from '@/server/auth/operation-registry';

const BASE = {
  module: 'meta',
  method: 'GET',
  path: '/meta/ping',
  summary: 'Liveness probe used by the readiness check.',
} as const;

beforeEach(() => {
  __resetOperationRegistryForTests();
});

describe('accepted declarations', () => {
  it('registers a permissioned operation and applies the documented defaults', () => {
    const registered = defineOperation({
      ...BASE,
      id: 'meta.ping',
      permissions: ['meta.ping.read'],
    });

    expect(registered.permissions).toEqual(['meta.ping.read']);
    // Tenant scope and "no audit" are the safe defaults; both must be explicit
    // in the registered record so the coverage check can read them.
    expect(registered.scope).toBe('tenant');
    expect(registered.auditClass).toBe('none');
    expect(registered.public).toBe(false);
    expect(getOperation('meta.ping')).toBe(registered);
  });

  it('accepts a public operation only with a written reason', () => {
    const registered = defineOperation({
      ...BASE,
      id: 'meta.health',
      path: '/meta/health',
      public: true,
      publicReason: 'Unauthenticated liveness probe consumed by the platform health check.',
    });

    expect(registered.public).toBe(true);
    expect(registered.permissions).toEqual([]);
  });

  it('accepts an audited operation that names a catalogued audit action', () => {
    const registered = defineOperation({
      ...BASE,
      id: 'iam.grant-role',
      method: 'POST',
      path: '/iam/role-grants',
      permissions: ['iam.grant.manage'],
      auditClass: 'privileged',
      // From the controlled catalog. P1-13's fixture used `iam.role.granted`,
      // which was never registered anywhere — exactly the free-form-string
      // problem the catalog now prevents.
      auditAction: 'iam.grant.issued',
    });

    expect(registered.auditClass).toBe('privileged');
    expect(registered.auditAction).toBe('iam.grant.issued');
  });

  it('rejects an audit action that is not in the controlled catalog', () => {
    expect(() =>
      defineOperation({
        ...BASE,
        id: 'iam.invent-action',
        method: 'POST',
        path: '/iam/invented',
        permissions: ['iam.grant.manage'],
        auditClass: 'privileged',
        auditAction: 'iam.role.granted',
      })
    ).toThrow(/not in the audit-action catalog/);
  });

  it('rejects an audit action filed under the wrong class', () => {
    // `iam.grant.revoked` is a security action. Declaring it as `privileged`
    // would quietly change how the record is triaged.
    expect(() =>
      defineOperation({
        ...BASE,
        id: 'iam.misclassified',
        method: 'DELETE',
        path: '/iam/misclassified',
        permissions: ['iam.grant.manage'],
        auditClass: 'privileged',
        auditAction: 'iam.grant.revoked',
      })
    ).toThrow(/catalog classifies that action as "security"/);
  });

  it('returns every registration sorted by id', () => {
    defineOperation({ ...BASE, id: 'meta.zulu', path: '/meta/zulu', permissions: ['a.b.c'] });
    defineOperation({ ...BASE, id: 'meta.alpha', path: '/meta/alpha', permissions: ['a.b.c'] });

    expect(allOperations().map((operation) => operation.id)).toEqual(['meta.alpha', 'meta.zulu']);
  });
});

describe('rejected declarations', () => {
  it('rejects an operation that declares no permissions and is not public', () => {
    expect(() => defineOperation({ ...BASE, id: 'meta.unguarded' })).toThrow(
      OperationRegistrationError
    );
    expect(() => defineOperation({ ...BASE, id: 'meta.unguarded' })).toThrow(
      /declares no permission codes/
    );
  });

  it('rejects an empty permission array, which is the same hole spelled differently', () => {
    expect(() => defineOperation({ ...BASE, id: 'meta.empty', permissions: [] })).toThrow(
      /declares no permission codes/
    );
  });

  it('rejects a public operation with no publicReason', () => {
    expect(() => defineOperation({ ...BASE, id: 'meta.silent', public: true })).toThrow(
      /gives no publicReason/
    );
  });

  it('rejects an operation that is both public and permissioned', () => {
    expect(() =>
      defineOperation({
        ...BASE,
        id: 'meta.contradiction',
        public: true,
        publicReason: 'Contradictory declaration used to prove the guard.',
        permissions: ['meta.ping.read'],
      })
    ).toThrow(/public and also declares permissions/);
  });

  it('rejects an audited class with no audit action', () => {
    expect(() =>
      defineOperation({
        ...BASE,
        id: 'iam.unaudited',
        permissions: ['iam.role.grant'],
        auditClass: 'financial',
      })
    ).toThrow(/declares no auditAction/);
  });

  it('rejects an audit action declared under class "none"', () => {
    expect(() =>
      defineOperation({
        ...BASE,
        id: 'iam.classless',
        permissions: ['iam.role.grant'],
        auditAction: 'iam.role.granted',
      })
    ).toThrow(/audit class "none"/);
  });

  it('rejects a duplicate operation id', () => {
    defineOperation({ ...BASE, id: 'meta.ping', permissions: ['meta.ping.read'] });
    expect(() =>
      defineOperation({
        ...BASE,
        id: 'meta.ping',
        path: '/meta/ping-again',
        permissions: ['meta.ping.read'],
      })
    ).toThrow(/is already registered/);
  });

  it('rejects two operations claiming the same method and path', () => {
    defineOperation({ ...BASE, id: 'meta.ping', permissions: ['meta.ping.read'] });
    expect(() =>
      defineOperation({ ...BASE, id: 'meta.ping-clone', permissions: ['meta.ping.read'] })
    ).toThrow(/is already claimed by operation "meta.ping"/);
  });

  it('allows the same path under a different method', () => {
    defineOperation({ ...BASE, id: 'meta.ping', permissions: ['meta.ping.read'] });
    expect(() =>
      defineOperation({
        ...BASE,
        id: 'meta.ping-write',
        method: 'POST',
        permissions: ['meta.ping.write'],
      })
    ).not.toThrow();
  });

  it.each([
    { label: 'no dot', id: 'meta' },
    { label: 'upper case', id: 'Meta.Ping' },
    { label: 'underscore', id: 'meta.ping_probe' },
    { label: 'leading digit', id: '1meta.ping' },
    { label: 'trailing dot', id: 'meta.ping.' },
  ])('rejects a malformed id ($label)', ({ id }) => {
    expect(() => defineOperation({ ...BASE, id, permissions: ['meta.ping.read'] })).toThrow(
      /must be dotted lower-case/
    );
  });

  it.each([
    { label: 'no leading slash', path: 'meta/ping' },
    { label: 'upper case', path: '/Meta/Ping' },
    { label: 'absolute URL', path: 'https://example.invalid/meta/ping' },
    { label: 'query string', path: '/meta/ping?probe=1' },
  ])('rejects a malformed path ($label)', ({ path }) => {
    expect(() =>
      defineOperation({ ...BASE, id: 'meta.badpath', path, permissions: ['meta.ping.read'] })
    ).toThrow(/not a lower-case API path/);
  });
});

describe('registry isolation', () => {
  it('is emptied by the test seam so suites cannot leak registrations into each other', () => {
    defineOperation({ ...BASE, id: 'meta.ping', permissions: ['meta.ping.read'] });
    expect(allOperations()).toHaveLength(1);

    __resetOperationRegistryForTests();

    expect(allOperations()).toHaveLength(0);
    expect(getOperation('meta.ping')).toBeUndefined();
    // The route index is cleared too, or the path would stay permanently claimed.
    expect(() =>
      defineOperation({ ...BASE, id: 'meta.ping', permissions: ['meta.ping.read'] })
    ).not.toThrow();
  });
});
