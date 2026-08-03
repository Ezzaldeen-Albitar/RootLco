import { describe, expect, it } from 'vitest';
import {
  EMAIL_MAX,
  EMAIL_MIN,
  PASSWORD_MAX,
  PASSWORD_MIN,
  forgotPasswordSchema,
  issueKeysByField,
  loginSchema,
  setPasswordSchema,
} from '@/features/authentication/schemas/credentials';
import {
  TOKEN_PARAMS,
  afterResetPath,
  isTokenShaped,
  tokenFromQuery,
} from '@/features/authentication/api/recovery-token';
import { isUnrestrictedScope } from '@/features/authentication/types/session';
import { sessionCookieAttributes, SESSION_COOKIE } from '@/lib/api/session-cookie';
import { fromFailure, invalid, success, IDLE } from '@/lib/forms/action-result';
import { initialsOf } from '@/features/authentication/components/AccountMenu';
import en from '../src/i18n/messages/en.json';

/**
 * P1-26-QA-001 / P1-26-SEC-002 — authentication.
 *
 * These test the rules that are invisible when they work: that a failure does
 * not become an oracle, that a token does not travel, and that a cookie carries
 * the attributes that make it unreadable by page script.
 */

const UUID = '2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e';

describe('the sign-in schema', () => {
  it('requires a workspace identifier that is a real UUID', () => {
    const bad = loginSchema.safeParse({ tenantId: 'not-a-uuid', email: 'a@b.co', password: 'x' });
    expect(bad.success).toBe(false);
    if (!bad.success)
      expect(issueKeysByField(bad.error).tenantId).toBe('auth.login.error.tenantId');
  });

  it('does NOT enforce a password length on sign-in', () => {
    // An existing account may predate any bound. Refusing to submit a short
    // password would tell the operator their own stored credential is invalid
    // when the truth is that it is simply wrong, or the account is not active.
    const result = loginSchema.safeParse({ tenantId: UUID, email: 'a@b.co', password: 'x' });
    expect(result.success).toBe(true);
  });

  it('enforces the backend password bounds when a password is CREATED', () => {
    const short = setPasswordSchema.safeParse({
      token: 'a'.repeat(20),
      password: 'x'.repeat(PASSWORD_MIN - 1),
      confirmPassword: 'x'.repeat(PASSWORD_MIN - 1),
    });
    expect(short.success).toBe(false);

    const ok = setPasswordSchema.safeParse({
      token: 'a'.repeat(20),
      password: 'x'.repeat(PASSWORD_MIN),
      confirmPassword: 'x'.repeat(PASSWORD_MIN),
    });
    expect(ok.success).toBe(true);
  });

  it('mirrors the published bounds exactly', () => {
    // Copied from CredentialPolicy and the route schemas. A divergence should be
    // a visible edit here, not a discovery in production.
    expect([PASSWORD_MIN, PASSWORD_MAX]).toEqual([8, 200]);
    expect([EMAIL_MIN, EMAIL_MAX]).toEqual([3, 320]);
  });

  it('refuses two passwords that do not match', () => {
    const result = setPasswordSchema.safeParse({
      token: 'a'.repeat(20),
      password: 'correct horse battery',
      confirmPassword: 'correct horse batteru',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(issueKeysByField(result.error).confirmPassword).toBe('auth.reset.error.mismatch');
    }
  });

  it('asks for no tenant on the forgot-password form', () => {
    // The reset request answers identically for every address; asking for a
    // tenant would imply the answer depends on it.
    expect(Object.keys(forgotPasswordSchema.shape)).toEqual(['email']);
  });

  it('produces translation KEYS, never sentences', () => {
    const result = loginSchema.safeParse({ tenantId: '', email: '', password: '' });
    expect(result.success).toBe(false);
    if (!result.success) {
      for (const key of Object.values(issueKeysByField(result.error))) {
        expect(Object.keys(en), `${key} is not a message key`).toContain(key);
      }
    }
  });
});

describe('the recovery token', () => {
  it('accepts the parameter names providers actually use', () => {
    expect([...TOKEN_PARAMS]).toEqual(['token', 'access_token', 'code']);
    expect(tokenFromQuery({ access_token: 'a'.repeat(32) })).toBe('a'.repeat(32));
    expect(tokenFromQuery({ code: 'b'.repeat(12) })).toBe('b'.repeat(12));
  });

  it('is bounded by the backend contract, not trusted', () => {
    expect(isTokenShaped('short')).toBe(false);
    expect(isTokenShaped('a'.repeat(2049))).toBe(false);
    expect(isTokenShaped('a'.repeat(2048))).toBe(true);
    // Outside the bounded alphabet: a 20-kilobyte blob of anything must not be
    // posted as if it were a credential.
    expect(isTokenShaped('has spaces in it')).toBe(false);
    expect(isTokenShaped('<script>alert(1)</script>')).toBe(false);
  });

  it('returns null rather than a partial match', () => {
    expect(tokenFromQuery({})).toBeNull();
    expect(tokenFromQuery({ token: 'tiny' })).toBeNull();
    expect(tokenFromQuery({ nonsense: 'a'.repeat(32) })).toBeNull();
  });

  it('sends a completed reset to a FIXED path, with no redirect parameter', () => {
    // An open redirect on the page that completes a credential change is the
    // highest-value one in any application: the visitor arrived from an email
    // and is primed to trust whatever it shows them next.
    expect(afterResetPath('en')).toBe('/en/login');
    expect(afterResetPath('ar')).toBe('/ar/login');
  });
});

describe('the session cookie', () => {
  it('is httpOnly and sameSite lax in every environment', () => {
    for (const env of ['local', 'preview', 'production']) {
      const attributes = sessionCookieAttributes(env);
      expect(attributes.httpOnly, env).toBe(true);
      expect(attributes.sameSite, env).toBe('lax');
      expect(attributes.path, env).toBe('/');
    }
  });

  it('is secure everywhere except the plain-HTTP local runtime', () => {
    // A secure cookie is silently discarded over http://127.0.0.1, so forcing it
    // locally would break sign-in in the one environment a developer uses to
    // notice it is broken.
    expect(sessionCookieAttributes('local').secure).toBe(false);
    expect(sessionCookieAttributes('preview').secure).toBe(true);
    expect(sessionCookieAttributes('production').secure).toBe(true);
  });

  it('uses a namespaced name that cannot collide with a UI preference', () => {
    expect(SESSION_COOKIE.startsWith('rootlco.')).toBe(true);
  });
});

describe('resolved scope', () => {
  const base = {
    userId: UUID,
    tenantId: UUID,
    email: 'a@b.co',
    displayName: 'A',
    permissions: [],
  };

  it('treats an EMPTY scope as unrestricted, not as no access', () => {
    // The backend's own delegation policy uses exactly this test. Inverting it
    // is easy and expensive.
    expect(isUnrestrictedScope({ ...base, companyIds: [], branchIds: [] })).toBe(true);
    expect(isUnrestrictedScope({ ...base, companyIds: [UUID], branchIds: [] })).toBe(false);
    expect(isUnrestrictedScope({ ...base, companyIds: [], branchIds: [UUID] })).toBe(false);
  });
});

describe('action results', () => {
  const failure = (kind: Parameters<typeof fromFailure>[0]['kind']) =>
    ({ ok: false, kind, status: null, problem: null, correlationId: 'cid' }) as const;

  it('maps a 401 to expired and a 403 to denied', () => {
    expect(fromFailure(failure('unauthenticated'), 1).status).toBe('expired');
    expect(fromFailure(failure('forbidden'), 1).status).toBe('denied');
    expect(fromFailure(failure('conflict'), 1).status).toBe('conflict');
    expect(fromFailure(failure('rate-limited'), 1).status).toBe('throttled');
  });

  it('lets an operation override the message when a failure must not be informative', () => {
    const state = fromFailure(failure('forbidden'), 1, 'auth.login.error.failed');
    expect(state.messageKey).toBe('auth.login.error.failed');
  });

  it('carries an attempt number, so an identical failure is re-announced', () => {
    // Without it, submitting the same wrong password twice renders an identical
    // node and the second failure is announced to nobody.
    expect(fromFailure(failure('server'), 7).attempt).toBe(7);
    expect(invalid({}, 3).attempt).toBe(3);
    expect(success('admin.saved', 4).attempt).toBe(4);
  });

  it('starts idle with no message', () => {
    expect(IDLE.status).toBe('idle');
    expect(IDLE.messageKey).toBeUndefined();
  });

  it('names only message KEYS that exist in the catalogue', () => {
    for (const kind of [
      'unauthenticated',
      'forbidden',
      'not-found',
      'conflict',
      'validation',
      'rate-limited',
      'server',
      'unavailable',
      'timeout',
      'cancelled',
      'network',
    ] as const) {
      const state = fromFailure(failure(kind), 1);
      expect(Object.keys(en), `${kind} → ${state.messageKey}`).toContain(state.messageKey);
    }
  });
});

describe('account initials', () => {
  it('cuts at a character boundary, not a code unit', () => {
    expect(initialsOf('Ezzaldeen Albitar')).toBe('EA');
    expect(initialsOf('عز الدين البيطار')).toBe('عا');
    expect(initialsOf('  single  ')).toBe('s');
    expect(initialsOf('')).toBe('');
  });
});
