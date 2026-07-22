/**
 * Phase 1-14 unit suite: token verification, provider behaviour, domain rules,
 * and the controlled audit-action catalog.
 *
 * Nothing here touches a database or a network. That is deliberate: these are
 * the decisions that must be right *before* a request reaches the database, and
 * they are the ones an integration test would exercise only incidentally.
 *
 * The token tests are the centre of gravity. Every one of them corresponds to a
 * published way of defeating a JWT verifier — `alg: none`, algorithm confusion,
 * a truncated signature, a missing `exp`, an issuer or audience from somewhere
 * else — and they assert the verifier's *uniform* refusal, because a verifier
 * that says which check failed is an oracle for iterating on a forged token.
 *
 * Operation decision-logic proven here at UNIT depth (coverage-gate references;
 * wired-service integration for these is a tracked residual, R-8):
 *   iam.auth-login  iam.auth-logout  iam.auth-session  iam.auth-password-reset
 *   iam.auth-password-reset-completion  iam.invitation-activate
 */
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyBearerToken } from '@/modules/iam/provider/token-verifier';
import { ProviderFailure } from '@/modules/iam/provider/identity-provider';
import { FakeIdentityProvider } from '@/modules/iam/provider/fake-provider';
import { IdentityPolicy } from '@/modules/iam/domain/identity-policy';
import { DelegationPolicy } from '@/modules/iam/domain/delegation-policy';
import { CredentialPolicy } from '@/modules/iam/domain/credential-policy';
import {
  AUDIT_ACTIONS,
  auditActionViolation,
  findAuditAction,
  requireAuditAction,
} from '@/server/auth/audit-actions';
import { isAppFailure } from '@/server/errors/app-failure';

const SECRET = 'unit-test-signing-secret-not-a-real-key';
const ISSUER = 'https://auth.local.test/auth/v1';
const AUDIENCE = 'authenticated';
const NOW = 1_800_000_000_000; // Fixed instant; nothing here reads the wall clock.

const OPTIONS = {
  secret: SECRET,
  issuer: ISSUER,
  audience: AUDIENCE,
  algorithms: ['HS256'],
  clockSkewSeconds: 60,
  now: () => NOW,
};

const b64 = (value: object): string =>
  Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

function sign(header: object, payload: object, secret = SECRET, digest = 'sha256'): string {
  const h = b64(header);
  const p = b64(payload);
  const signature = createHmac(digest, secret).update(`${h}.${p}`).digest('base64url');
  return `${h}.${p}.${signature}`;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const seconds = Math.floor(NOW / 1000);
  return {
    sub: '11111111-1111-4111-8111-111111111111',
    iss: ISSUER,
    aud: AUDIENCE,
    iat: seconds - 10,
    exp: seconds + 3600,
    email: 'unit@example.test',
    session_id: 'session-ref-1',
    app_metadata: { tenant_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    ...overrides,
  };
}

const validToken = (): string => sign({ alg: 'HS256', typ: 'JWT' }, claims());

describe('bearer-token verification', () => {
  it('accepts a well-formed token and returns identity only', () => {
    const verified = verifyBearerToken(validToken(), OPTIONS);
    expect(verified.subject).toBe('11111111-1111-4111-8111-111111111111');
    expect(verified.tenantId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(verified.sessionRef).toBe('session-ref-1');
    // Nothing resembling authorization crosses this boundary.
    expect(Object.keys(verified).sort()).toEqual([
      'email',
      'expiresAt',
      'sessionRef',
      'subject',
      'tenantId',
    ]);
  });

  it('refuses "alg: none" outright', () => {
    // The classic. An unsigned token with a plausible payload.
    const header = b64({ alg: 'none', typ: 'JWT' });
    const payload = b64(claims());
    expect(() => verifyBearerToken(`${header}.${payload}.`, OPTIONS)).toThrow(ProviderFailure);
    expect(() => verifyBearerToken(`${header}.${payload}.`, OPTIONS)).toThrow(
      /algorithm is not permitted/
    );
  });

  it('refuses an algorithm outside the configured allow-list', () => {
    const token = sign({ alg: 'HS512', typ: 'JWT' }, claims(), SECRET, 'sha512');
    expect(() => verifyBearerToken(token, OPTIONS)).toThrow(/algorithm is not permitted/);
  });

  it('refuses an allow-listed algorithm this build does not implement', () => {
    // Misconfiguration must fail closed and loudly, never fall through to accept.
    const token = sign({ alg: 'RS256', typ: 'JWT' }, claims());
    expect(() => verifyBearerToken(token, { ...OPTIONS, algorithms: ['RS256'] })).toThrow(
      /implements HMAC algorithms only/
    );
  });

  it('refuses a token signed with a different key', () => {
    const token = sign({ alg: 'HS256', typ: 'JWT' }, claims(), 'a-different-secret');
    expect(() => verifyBearerToken(token, OPTIONS)).toThrow(/signature does not verify/);
  });

  it('refuses a truncated or padded signature without throwing on length', () => {
    // `timingSafeEqual` throws on a length mismatch; the verifier must compare
    // lengths first and answer with the ordinary refusal.
    const token = validToken();
    const truncated = `${token.slice(0, token.lastIndexOf('.') + 1)}AAAA`;
    expect(() => verifyBearerToken(truncated, OPTIONS)).toThrow(/signature does not verify/);
  });

  it('refuses a foreign issuer and a foreign audience', () => {
    expect(() =>
      verifyBearerToken(sign({ alg: 'HS256' }, claims({ iss: 'https://elsewhere.test' })), OPTIONS)
    ).toThrow(/issuer does not match/);
    expect(() =>
      verifyBearerToken(sign({ alg: 'HS256' }, claims({ aud: 'anon' })), OPTIONS)
    ).toThrow(/audience does not match/);
  });

  it('accepts an audience array containing the expected value', () => {
    const token = sign({ alg: 'HS256' }, claims({ aud: ['other', AUDIENCE] }));
    expect(verifyBearerToken(token, OPTIONS).subject).toBeTruthy();
  });

  it('requires an expiry and honours it within the configured skew', () => {
    const seconds = Math.floor(NOW / 1000);
    expect(() =>
      verifyBearerToken(sign({ alg: 'HS256' }, claims({ exp: undefined })), OPTIONS)
    ).toThrow(/expiry is missing/);
    // 30 s past expiry, inside the 60 s skew: still accepted.
    expect(
      verifyBearerToken(sign({ alg: 'HS256' }, claims({ exp: seconds - 30 })), OPTIONS).subject
    ).toBeTruthy();
    // 90 s past expiry, outside the skew: refused.
    expect(() =>
      verifyBearerToken(sign({ alg: 'HS256' }, claims({ exp: seconds - 90 })), OPTIONS)
    ).toThrow(/token has expired/);
  });

  it('refuses a token that is not yet valid or was issued in the future', () => {
    const seconds = Math.floor(NOW / 1000);
    expect(() =>
      verifyBearerToken(sign({ alg: 'HS256' }, claims({ nbf: seconds + 600 })), OPTIONS)
    ).toThrow(/not yet valid/);
    expect(() =>
      verifyBearerToken(sign({ alg: 'HS256' }, claims({ iat: seconds + 600 })), OPTIONS)
    ).toThrow(/issued in the future/);
  });

  it('refuses a malformed token shape', () => {
    for (const bad of ['', 'not-a-token', 'a.b', 'a.b.c.d']) {
      expect(() => verifyBearerToken(bad, OPTIONS)).toThrow(ProviderFailure);
    }
  });

  it('reports a missing tenant binding as null rather than inventing one', () => {
    const token = sign({ alg: 'HS256' }, claims({ app_metadata: {} }));
    expect(verifyBearerToken(token, OPTIONS).tenantId).toBeNull();
  });

  it('ignores a tenant binding placed in user-writable metadata', () => {
    // `user_metadata` is editable by the end user. Only `app_metadata`, which is
    // service-role-only, may carry the binding.
    const token = sign(
      { alg: 'HS256' },
      claims({
        app_metadata: {},
        user_metadata: { tenant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
      })
    );
    expect(verifyBearerToken(token, OPTIONS).tenantId).toBeNull();
  });

  it('fails closed when no signing secret is configured', () => {
    expect(() => verifyBearerToken(validToken(), { ...OPTIONS, secret: '' })).toThrow(
      /No signing secret is configured/
    );
  });
});

describe('the deterministic provider double', () => {
  const provider = (): FakeIdentityProvider =>
    new FakeIdentityProvider({ secret: SECRET, issuer: ISSUER, audience: AUDIENCE });

  it('mints tokens the real verifier accepts', async () => {
    const fake = provider();
    fake.seed({
      email: 'a@example.test',
      password: 'correct-horse',
      confirmed: true,
      tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const session = await fake.authenticate('a@example.test', 'correct-horse');
    const verified = verifyBearerToken(session.accessToken, { ...OPTIONS, now: () => Date.now() });
    expect(verified.subject).toBe(session.subject);
    expect(verified.sessionRef).toBe(session.sessionRef);
  });

  it('answers unknown address, wrong password, unconfirmed, and disabled identically', async () => {
    const fake = provider();
    fake.seed({ email: 'known@example.test', password: 'pw-correct', confirmed: true });
    fake.seed({ email: 'unconfirmed@example.test', password: 'pw-correct', confirmed: false });
    fake.seed({
      email: 'banned@example.test',
      password: 'pw-correct',
      confirmed: true,
      disabled: true,
    });

    const reasons: string[] = [];
    for (const [email, password] of [
      ['nobody@example.test', 'pw-correct'],
      ['known@example.test', 'pw-wrong'],
      ['unconfirmed@example.test', 'pw-correct'],
      ['banned@example.test', 'pw-correct'],
    ] as const) {
      await fake.authenticate(email, password).catch((error: unknown) => {
        reasons.push((error as ProviderFailure).reason);
      });
    }
    expect(reasons).toEqual([
      'invalid-credentials',
      'invalid-credentials',
      'invalid-credentials',
      'invalid-credentials',
    ]);
  });

  it('consumes a recovery token on first use, so a replayed link fails', async () => {
    const fake = provider();
    fake.seed({ email: 'reset@example.test', password: 'old-password', confirmed: true });
    await fake.requestPasswordReset({
      email: 'reset@example.test',
      redirectTo: 'https://app.test/x',
    });
    const token = fake.deliveries.at(-1)?.token as string;

    await expect(fake.completePasswordReset(token, 'new-password-1')).resolves.toBeTruthy();
    await expect(fake.completePasswordReset(token, 'new-password-2')).rejects.toThrow(
      /Recovery token is not valid/
    );
  });

  it('says nothing about an unknown address on a reset request', async () => {
    const fake = provider();
    await expect(
      fake.requestPasswordReset({ email: 'nobody@example.test', redirectTo: 'https://app.test/x' })
    ).resolves.toBeUndefined();
    // Nothing was sent, and the caller cannot tell.
    expect(fake.deliveries).toHaveLength(0);
  });

  it('revokes every session of an identity when it is disabled', async () => {
    const fake = provider();
    const seeded = fake.seed({ email: 'x@example.test', password: 'pw-correct', confirmed: true });
    const session = await fake.authenticate('x@example.test', 'pw-correct');
    await expect(fake.verifyToken(session.accessToken)).resolves.toBeTruthy();

    await fake.setDisabled(seeded.subject, true);
    await expect(fake.verifyToken(session.accessToken)).rejects.toThrow(/session was revoked/);
  });

  it('consumes a refresh token on use, so a stolen copy cannot be replayed', async () => {
    const fake = provider();
    fake.seed({ email: 'r@example.test', password: 'pw-correct', confirmed: true });
    const first = await fake.authenticate('r@example.test', 'pw-correct');
    const refresh = first.refreshToken as string;

    await expect(fake.refreshSession(refresh)).resolves.toBeTruthy();
    await expect(fake.refreshSession(refresh)).rejects.toThrow(/not recognised/);
  });

  it('reports an outage as retryable rather than as a credential verdict', async () => {
    const fake = provider();
    fake.outage = true;
    await fake.authenticate('a@example.test', 'pw').catch((error: unknown) => {
      expect((error as ProviderFailure).reason).toBe('provider-unavailable');
      expect((error as ProviderFailure).retryable).toBe(true);
    });
  });
});

describe('identity lifecycle rules', () => {
  const policy = new IdentityPolicy();

  it('mirrors the transition graph iam.change_user_status enforces', () => {
    expect(policy.canTransition('invited', 'active')).toBe(true);
    expect(policy.canTransition('invited', 'archived')).toBe(true);
    expect(policy.canTransition('active', 'locked')).toBe(true);
    expect(policy.canTransition('locked', 'active')).toBe(true);
    // `archived` is terminal, and `invited → locked` is not a transition.
    expect(policy.canTransition('archived', 'active')).toBe(false);
    expect(policy.canTransition('invited', 'locked')).toBe(false);
  });

  it('refuses an illegal transition and a no-op with distinct rules', () => {
    expect(() => policy.assertTransition('archived', 'active')).toThrow(/cannot move/);
    expect(() => policy.assertTransition('active', 'active')).toThrow(/already active/);
  });

  it('never locks an account that is not active', () => {
    // A manual lock keeps its recorded reason; an invited account cannot be
    // locked by someone guessing at its address.
    for (const state of ['invited', 'locked', 'archived'] as const) {
      expect(
        policy.assessFailedLogin({ recentFailures: 99, maxAttempts: 5, currentState: state })
          .shouldLock
      ).toBe(false);
    }
  });

  it('signals only at or above the threshold', () => {
    expect(
      policy.assessFailedLogin({ recentFailures: 4, maxAttempts: 5, currentState: 'active' })
        .shouldLock
    ).toBe(false);
    expect(
      policy.assessFailedLogin({ recentFailures: 5, maxAttempts: 5, currentState: 'active' })
        .shouldLock
    ).toBe(true);
  });

  it('rejects a blank, oversized, or control-character reason', () => {
    expect(() => policy.assertReason('   ')).toThrow(/1-500 characters|1–500 characters/);
    expect(() => policy.assertReason('x'.repeat(501))).toThrow();
    expect(() => policy.assertReason('line one\nline two')).toThrow(/control characters/);
    expect(policy.assertReason('  Left the company.  ')).toBe('Left the company.');
  });
});

describe('delegation and escalation rules', () => {
  const policy = new DelegationPolicy();
  const ACTOR = '22222222-2222-4222-8222-222222222222';
  const OTHER = '33333333-3333-4333-8333-333333333333';
  const COMPANY = '44444444-4444-4444-8444-444444444444';
  const BRANCH = '55555555-5555-4555-8555-555555555555';

  const OTHER_COMPANY = '66666666-6666-4666-8666-666666666666';
  const OTHER_BRANCH = '77777777-7777-4777-8777-777777777777';
  const DEPARTMENT = '88888888-8888-4888-8888-888888888888';

  // Default actor: a BRANCH-scoped administrator (holds branch BRANCH of company
  // COMPANY). The branch's parent company appears in actorCompanyIds — which is
  // exactly why membership there must NOT grant company-wide authority.
  const facts = (over: Partial<Parameters<typeof policy.assertDelegable>[0]> = {}) => ({
    actorUserId: ACTOR,
    actorPermissions: new Set(['iam.user.manage']),
    actorUnrestricted: false,
    actorCompanyIds: new Set([COMPANY]),
    actorBranchIds: new Set([BRANCH]),
    actorScopes: [{ scopeType: 'branch' as const, companyId: COMPANY, branchId: BRANCH }],
    ...over,
  });

  it('refuses a self-directed administrative action', () => {
    expect(() => policy.assertNotSelf(facts(), ACTOR, 'grant')).toThrow(/their own access/);
    expect(() => policy.assertNotSelf(facts(), OTHER, 'grant')).not.toThrow();
  });

  it('refuses delegating a permission the actor does not hold', () => {
    expect(() => policy.assertDelegable(facts(), ['sal.reversal.approve'], 'allow')).toThrow(
      /may not delegate/
    );
    expect(() => policy.assertDelegable(facts(), ['iam.user.manage'], 'allow')).not.toThrow();
  });

  it('never blocks a deny mapping', () => {
    // Refusing to let an administrator REMOVE access they do not hold would be a
    // safety regression, not a safety control.
    expect(() => policy.assertDelegable(facts(), ['sal.reversal.approve'], 'deny')).not.toThrow();
  });

  it('treats an empty held-scope set as "everything" only for an unrestricted actor', () => {
    const scoped = facts({
      actorCompanyIds: new Set<string>(),
      actorUnrestricted: false,
      actorScopes: [],
    });
    expect(() =>
      policy.assertScopeWithinAuthority(scoped, { scopeType: 'company', companyId: COMPANY })
    ).toThrow(/outside the administrator granted authority/);

    const unrestricted = facts({ actorCompanyIds: new Set<string>(), actorUnrestricted: true });
    expect(() =>
      policy.assertScopeWithinAuthority(unrestricted, { scopeType: 'company', companyId: COMPANY })
    ).not.toThrow();
  });

  it('refuses an unrestricted (tenant-wide) delegation by a scoped actor (confirmed-High fix)', () => {
    // The whole point of the remediation: an empty scope list is a tenant-wide
    // grant, and a scoped administrator may not issue one.
    expect(() => policy.assertUnrestrictedDelegationAllowed(facts())).toThrow(
      /may not issue an unrestricted/
    );
    const unrestricted = facts({ actorUnrestricted: true });
    expect(() => policy.assertUnrestrictedDelegationAllowed(unrestricted)).not.toThrow();
  });

  it('a branch-scoped actor cannot delegate a company-wide scope', () => {
    // The branch's company is in actorCompanyIds, but holding a branch is not
    // holding the company: a company-wide request must be refused.
    expect(() =>
      policy.assertScopeWithinAuthority(facts(), { scopeType: 'company', companyId: COMPANY })
    ).toThrow(/outside the administrator granted authority/);
  });

  it('a branch-scoped actor may delegate its own branch and a department within it', () => {
    expect(() =>
      policy.assertScopeWithinAuthority(facts(), {
        scopeType: 'branch',
        companyId: COMPANY,
        branchId: BRANCH,
      })
    ).not.toThrow();
    expect(() =>
      policy.assertScopeWithinAuthority(facts(), {
        scopeType: 'department',
        companyId: COMPANY,
        branchId: BRANCH,
        departmentId: DEPARTMENT,
      })
    ).not.toThrow();
  });

  it('a branch-scoped actor cannot delegate another branch or another company', () => {
    expect(() =>
      policy.assertScopeWithinAuthority(facts(), {
        scopeType: 'branch',
        companyId: COMPANY,
        branchId: OTHER_BRANCH,
      })
    ).toThrow(/outside the administrator granted authority/);
    expect(() =>
      policy.assertScopeWithinAuthority(facts(), {
        scopeType: 'company',
        companyId: OTHER_COMPANY,
      })
    ).toThrow(/outside the administrator granted authority/);
  });

  it('a company-scoped actor covers its company, branches and departments, but not another company', () => {
    const companyScoped = facts({
      actorBranchIds: new Set<string>(),
      actorScopes: [{ scopeType: 'company' as const, companyId: COMPANY }],
    });
    for (const scope of [
      { scopeType: 'company' as const, companyId: COMPANY },
      { scopeType: 'branch' as const, companyId: COMPANY, branchId: BRANCH },
      {
        scopeType: 'department' as const,
        companyId: COMPANY,
        branchId: BRANCH,
        departmentId: DEPARTMENT,
      },
    ]) {
      expect(() => policy.assertScopeWithinAuthority(companyScoped, scope)).not.toThrow();
    }
    expect(() =>
      policy.assertScopeWithinAuthority(companyScoped, {
        scopeType: 'company',
        companyId: OTHER_COMPANY,
      })
    ).toThrow(/outside the administrator granted authority/);
  });

  it('a department-scoped actor covers only that exact department', () => {
    const deptScoped = facts({
      actorBranchIds: new Set<string>(),
      actorScopes: [
        {
          scopeType: 'department' as const,
          companyId: COMPANY,
          branchId: BRANCH,
          departmentId: DEPARTMENT,
        },
      ],
    });
    expect(() =>
      policy.assertScopeWithinAuthority(deptScoped, {
        scopeType: 'department',
        companyId: COMPANY,
        branchId: BRANCH,
        departmentId: DEPARTMENT,
      })
    ).not.toThrow();
    // Cannot widen to the branch or company that contains the department.
    expect(() =>
      policy.assertScopeWithinAuthority(deptScoped, {
        scopeType: 'branch',
        companyId: COMPANY,
        branchId: BRANCH,
      })
    ).toThrow(/outside the administrator granted authority/);
    expect(() =>
      policy.assertScopeWithinAuthority(deptScoped, { scopeType: 'company', companyId: COMPANY })
    ).toThrow(/outside the administrator granted authority/);
  });

  it('enforces the shape each scope type requires', () => {
    expect(() =>
      policy.assertScopeShape({ scopeType: 'company', companyId: COMPANY, branchId: BRANCH })
    ).toThrow(/not valid for its type/);
    expect(() => policy.assertScopeShape({ scopeType: 'branch', companyId: COMPANY })).toThrow();
    expect(() =>
      policy.assertScopeShape({ scopeType: 'branch', companyId: COMPANY, branchId: BRANCH })
    ).not.toThrow();
  });

  it('protects a platform-owned role and the last holder of a permission', () => {
    expect(() => policy.assertNotSystemRole(true)).toThrow(/platform contract/);
    expect(() => policy.assertNotSystemRole(false)).not.toThrow();
    expect(() => policy.assertNotLastHolder(0, 'iam.user.manage')).toThrow(/unadministrable/);
    expect(() => policy.assertNotLastHolder(1, 'iam.user.manage')).not.toThrow();
  });
});

describe('credential-flow rules', () => {
  const policy = new CredentialPolicy();

  it('permits nothing when the redirect allow-list is empty', () => {
    expect(() => policy.resolveRedirect(undefined, [])).toThrow(/must be configured/);
    expect(() => policy.resolveRedirect('https://app.test/x', [])).toThrow(/must be configured/);
  });

  it('matches a redirect exactly, never by prefix', () => {
    const allow = ['https://app.test/reset'];
    expect(policy.resolveRedirect('https://app.test/reset', allow)).toBe('https://app.test/reset');
    // The prefix-matching bug, stated as a test: this host is not that host.
    expect(() => policy.resolveRedirect('https://app.test.attacker.test/reset', allow)).toThrow(
      /not allow-listed/
    );
    expect(() => policy.resolveRedirect('https://app.test/reset/../evil', allow)).toThrow();
    // No destination supplied falls back to the first allow-listed entry.
    expect(policy.resolveRedirect(undefined, allow)).toBe('https://app.test/reset');
  });

  it('bounds a password without echoing it', () => {
    expect(() => policy.assertPasswordBounds('short')).toThrow(/8-200|8–200/);
    expect(() => policy.assertPasswordBounds('x'.repeat(201))).toThrow();
    try {
      policy.assertPasswordBounds('secret1');
    } catch (error) {
      // The rule code and path may appear; the value never may.
      expect(JSON.stringify(isAppFailure(error) ? error.safeDetails : {})).not.toContain('secret1');
    }
  });

  it('validates an approval amount against numeric(18,4)', () => {
    expect(() => policy.assertApprovalAmount('1000.5000', 'JOD')).not.toThrow();
    expect(() => policy.assertApprovalAmount('0', 'USD')).not.toThrow();
    // Negative, over-scaled, over-wide, and non-numeric all refused.
    expect(() => policy.assertApprovalAmount('-1', 'USD')).toThrow();
    expect(() => policy.assertApprovalAmount('1.00001', 'USD')).toThrow();
    expect(() => policy.assertApprovalAmount('1'.repeat(15), 'USD')).toThrow();
    expect(() => policy.assertApprovalAmount('1e3', 'USD')).toThrow();
    expect(() => policy.assertApprovalAmount('10', 'usd')).toThrow();
  });

  it('requires an effective window to end after it starts', () => {
    expect(() => policy.assertEffectiveWindow('2026-01-01', null)).not.toThrow();
    expect(() => policy.assertEffectiveWindow('2026-01-01', '2026-01-02')).not.toThrow();
    expect(() => policy.assertEffectiveWindow('2026-01-02', '2026-01-01')).toThrow(
      /after its start/
    );
    expect(() => policy.assertEffectiveWindow('2026-01-01', '2026-01-01')).toThrow();
  });
});

describe('the controlled audit-action catalog', () => {
  it('allocates every code exactly once', () => {
    const codes = AUDIT_ACTIONS.map((action) => action.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('gives every action a class, an entity type, and a past-tense description', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(action.code).toMatch(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/);
      expect(['privileged', 'approval', 'financial', 'export', 'security']).toContain(action.class);
      expect(action.entityType).toMatch(/^[a-z]+\.[a-z_]+$/);
      expect(action.description.length).toBeGreaterThan(20);
    }
  });

  it('resolves a registered code and refuses an unregistered one', () => {
    expect(findAuditAction('iam.grant.issued')?.class).toBe('privileged');
    expect(findAuditAction('iam.role.granted')).toBeUndefined();
    expect(() => requireAuditAction('iam.role.granted')).toThrow(/not registered/);
  });

  it('reports an unregistered action and a class mismatch, and passes a correct pair', () => {
    expect(auditActionViolation('x.y', 'privileged', 'nope.invented')).toMatch(/not in the/);
    expect(auditActionViolation('x.y', 'privileged', 'iam.grant.revoked')).toMatch(
      /classifies that action as "security"/
    );
    expect(auditActionViolation('x.y', 'security', 'iam.grant.revoked')).toBeNull();
    // `none` short-circuits: the registry reports the missing-action case itself.
    expect(auditActionViolation('x.y', 'none', undefined)).toBeNull();
  });
});
