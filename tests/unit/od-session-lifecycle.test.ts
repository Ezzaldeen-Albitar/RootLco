import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { __resetBackendConfigForTests, backendConfig } from '@api/server/config/backend-config';

/**
 * The session lifecycle as the repository configures it today
 * (P1-32-PRE-OD-AUTHB; evidence for the open Owner decision AUTH01).
 *
 * These cases PIN what exists. They change no lifetime and add no invalidation:
 * whether other devices must lose access at once after a password change, a
 * revocation or a deactivation is AUTH01, and it stays open. A change to any
 * value below is that decision being taken, and it should arrive with the
 * decision rather than slip in under a test edit.
 *
 * The behaviour the values produce — each lifecycle event against the request
 * path — is pinned on a live database in `tests/backend/iam-auth-provider.test.ts`
 * ("the session lifecycle as it stands today").
 */

const ROOT = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** The active (uncommented) `key = value` lines of one TOML table, up to the next table. */
function tomlTable(source: string, table: string): Record<string, string> {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `[${table}]`);
  if (start < 0) return {};
  const values: Record<string, string> = {};
  for (const line of lines.slice(start + 1)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('[')) break;
    const match = /^([A-Za-z_]+)\s*=\s*(.+)$/.exec(trimmed);
    if (match?.[1] && match[2]) values[match[1]] = match[2];
  }
  return values;
}

describe('the access token (the provider configuration of the local stack)', () => {
  const config = read('supabase/config.toml');
  const auth = tomlTable(config, 'auth');

  it('lives for one hour', () => {
    expect(auth.jwt_expiry).toBe('3600');
  });

  it('is issued with a rotating refresh token', () => {
    expect(auth.enable_refresh_token_rotation).toBe('true');
    expect(auth.refresh_token_reuse_interval).toBe('10');
  });

  it('has no provider-side session timebox or inactivity limit switched on', () => {
    // `[auth.sessions]` exists only as a comment: the provider ends nothing by
    // age or inactivity itself. The idle limit RootLco applies is its own,
    // below, on `iam.user_sessions`.
    expect(config).not.toMatch(/^\s*\[auth\.sessions\]/m);
    expect(config).toMatch(/^#\s*\[auth\.sessions\]/m);
    expect(config).toMatch(/^#\s*timebox\s*=/m);
    expect(config).toMatch(/^#\s*inactivity_timeout\s*=/m);
  });
});

describe("the server-side session (RootLco's own row in iam.user_sessions)", () => {
  const saved = {
    idle: process.env.SESSION_IDLE_TIMEOUT_MINUTES,
    refresh: process.env.SESSION_ACTIVITY_REFRESH_SECONDS,
  };

  afterEach(() => {
    if (saved.idle === undefined) delete process.env.SESSION_IDLE_TIMEOUT_MINUTES;
    else process.env.SESSION_IDLE_TIMEOUT_MINUTES = saved.idle;
    if (saved.refresh === undefined) delete process.env.SESSION_ACTIVITY_REFRESH_SECONDS;
    else process.env.SESSION_ACTIVITY_REFRESH_SECONDS = saved.refresh;
    __resetBackendConfigForTests();
  });

  it('ends after 30 minutes without activity unless the deployment says otherwise', () => {
    delete process.env.SESSION_IDLE_TIMEOUT_MINUTES;
    delete process.env.SESSION_ACTIVITY_REFRESH_SECONDS;
    __resetBackendConfigForTests();
    expect(backendConfig().SESSION_IDLE_TIMEOUT_MINUTES).toBe(30);
    // Activity is recorded at most once a minute, so the idle clock can run up
    // to a minute behind the last request.
    expect(backendConfig().SESSION_ACTIVITY_REFRESH_SECONDS).toBe(60);
  });

  it("is checked on EVERY authenticated request, the console's included", () => {
    // One resolver serves the tenant workspace and the control plane alike, and
    // it reads the session row; nothing about a `platform.` operation skips it.
    const handler = read('apps/api/src/server/http/route-handler.ts');
    const claims = handler.indexOf('await sessionAuthenticator().authenticate(request)');
    const resolve = handler.indexOf('await resolveRequestContext({', claims);
    expect(claims).toBeGreaterThan(0);
    expect(resolve).toBeGreaterThan(claims);
    const resolver = read('apps/api/src/server/context/resolve-context.ts');
    expect(resolver).toContain(
      'if (!session || session.revoked || session.hardExpired || session.idleExpired)'
    );
    // The account must still be active; the ORGANISATION's status is not read.
    expect(resolver).toMatch(/AND status\s+= 'active'/);
    expect(resolver).not.toMatch(/org\.tenants/);
  });
});

describe('refresh', () => {
  it('has no route: the product publishes no way to extend a session', () => {
    const routes = readdirSync(join(ROOT, 'apps/api/src/app/api/v1/auth'));
    // The login route is here; nothing that refreshes is.
    expect(routes).toContain('login');
    expect(routes.some((name) => /refresh/i.test(name))).toBe(false);
  });

  it('is never stored by the web: the cookie holds the access token alone, until it expires', () => {
    const login = read('apps/web/src/features/authentication/actions/login.ts');
    expect(login).toContain(
      'await writeSession(result.data.accessToken, result.data.expiresAt, env.NEXT_PUBLIC_APP_ENV);'
    );
    expect(login).not.toMatch(/writeSession\([^)]*refreshToken/);
    const cookie = read('apps/web/src/lib/api/session-cookie.ts');
    expect(cookie).toContain('...(Number.isNaN(expires.getTime()) ? {} : { expires }),');
  });
});

describe('what a password change does to other sessions', () => {
  it('publishes only the two outcomes that happen, and never a revocation', () => {
    const service = read('apps/api/src/modules/iam/application/authentication-service.ts');
    expect(service).toContain(
      "readonly otherSessions: 'sessions-kept-until-expiry' | 'not-ended';"
    );
    // The platform password change asks the provider to sign the identity out
    // everywhere, which ends refresh tokens only, and writes no `revoked_at`.
    const change = service.slice(service.indexOf('async changeOwnPassword('));
    const end = change.indexOf('\n  }\n');
    const body = change.slice(0, end);
    expect(body).toContain('await this.provider.signOutEverywhere(session.accessToken);');
    expect(body).not.toMatch(/revoked_at|revokeAllSessionsFor/);
  });
});
