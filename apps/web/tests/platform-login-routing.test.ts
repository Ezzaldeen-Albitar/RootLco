import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_ENDED_SEGMENT } from '@/features/authentication/api/session-ended';

/**
 * Where a signed-in account lands, and who may enter the Platform Owner Console
 * (P1-32-PRE-061).
 *
 * The platform operator holds no tenant role by construction, so the workspace
 * session read answers 403 for exactly the account the console exists for. The
 * properties under test:
 *
 *   1. a tenant operator whose workspace session answers 200 lands on the
 *      workspace, and the platform session is never consulted;
 *   2. an account refused by the workspace but admitted by the platform session
 *      lands on the console — at sign-in, and when it opens the workspace root;
 *   3. an account refused by both keeps today's destination and today's
 *      `reason=forbidden`;
 *   4. the console itself admits only a platform session carrying authority.
 *
 * The backend is a stubbed `fetch` that answers by path, so each case states
 * exactly what each of the two session reads said.
 */

const jar = vi.hoisted(() => ({
  token: 'issued.session.token' as string | null,
  set: [] as string[],
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.token === null ? undefined : { name, value: jar.token }),
    set: (name: string) => {
      jar.set.push(name);
    },
    delete: () => {
      throw new Error('a session read must not clear a cookie');
    },
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (target: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { target });
  },
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));

const { loginAction } = await import('@/features/authentication/actions/login');
const { requireSession } = await import('@/features/authentication/api/session');
const { destinationAfterSignIn, readPlatformSession, requirePlatformSession } =
  await import('@/features/platform/api/session');
const { ApiClient } = await import('@/lib/api/client');

const USER = '2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e';

const TENANT_SESSION = {
  userId: USER,
  tenantId: USER,
  email: 'operator@example.test',
  displayName: 'Operator',
  companyIds: [],
  branchIds: [],
  permissions: ['iam.user.read'],
};

const PLATFORM_SESSION = {
  userId: USER,
  homeTenantId: USER,
  platformPermissions: ['platform.organization.read', 'platform.statistics.read'],
};

function respond(status: number, body: unknown = { title: 'x', status }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' },
  });
}

interface Answers {
  readonly login?: number;
  readonly tenant: number;
  readonly platform: number;
  readonly platformBody?: unknown;
}

let calls: string[] = [];

function backend(answers: Answers) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL) => {
      const path = new URL(String(input)).pathname;
      calls.push(path);
      if (path === '/api/v1/auth/login') {
        const status = answers.login ?? 200;
        return status === 200
          ? respond(200, {
              accessToken: 'issued.session.token',
              refreshToken: null,
              expiresAt: '2099-01-01T00:00:00.000Z',
              user: { id: USER, email: 'x@example.test', displayName: 'X', tenantId: USER },
            })
          : respond(status);
      }
      if (path === '/api/v1/auth/session') {
        return answers.tenant === 200 ? respond(200, TENANT_SESSION) : respond(answers.tenant);
      }
      if (path === '/api/v1/platform/session') {
        return answers.platform === 200
          ? respond(200, answers.platformBody ?? PLATFORM_SESSION)
          : respond(answers.platform);
      }
      return respond(404);
    })
  );
}

async function redirectTarget(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') {
      return (error as Error & { target: string }).target;
    }
    throw error;
  }
  throw new Error('expected a redirect, and nothing redirected');
}

function credentials(locale = 'en'): FormData {
  const form = new FormData();
  form.set('email', 'owner@example.test');
  form.set('password', 'correct horse battery staple');
  form.set('locale', locale);
  return form;
}

beforeEach(() => {
  jar.token = 'issued.session.token';
  jar.set = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sign-in decides the destination on the server', () => {
  it('sends a tenant operator to the workspace, and never asks the platform', async () => {
    backend({ tenant: 200, platform: 403 });
    const target = await redirectTarget(() => loginAction({ status: 'idle' }, credentials()));
    expect(target).toBe('/en');
    expect(calls).not.toContain('/api/v1/platform/session');
    expect(jar.set.length).toBe(1);
  });

  it('sends the platform operator to the console', async () => {
    backend({ tenant: 403, platform: 200 });
    const target = await redirectTarget(() => loginAction({ status: 'idle' }, credentials('ar')));
    expect(target).toBe('/ar/platform');
    expect(calls).toEqual([
      '/api/v1/auth/login',
      '/api/v1/auth/session',
      '/api/v1/platform/session',
    ]);
  });

  it('keeps the workspace destination when neither session admits the account', async () => {
    backend({ tenant: 403, platform: 403 });
    const target = await redirectTarget(() => loginAction({ status: 'idle' }, credentials()));
    expect(target).toBe('/en');
  });

  it('writes no cookie and redirects nowhere when the credentials are refused', async () => {
    backend({ login: 401, tenant: 200, platform: 200 });
    const state = await loginAction({ status: 'idle' }, credentials());
    expect(state.status).toBe('error');
    expect(jar.set).toEqual([]);
    expect(calls).toEqual(['/api/v1/auth/login']);
  });
});

describe('destinationAfterSignIn, directly', () => {
  const client = () =>
    new ApiClient({
      baseUrl: 'http://127.0.0.1:3000',
      defaultHeaders: { authorization: 'Bearer issued.session.token' },
    });

  it('covers all three branches', async () => {
    backend({ tenant: 200, platform: 200 });
    expect(await destinationAfterSignIn(client(), 'en')).toBe('/en');
    backend({ tenant: 403, platform: 200 });
    expect(await destinationAfterSignIn(client(), 'en')).toBe('/en/platform');
    backend({ tenant: 403, platform: 403 });
    expect(await destinationAfterSignIn(client(), 'en')).toBe('/en');
  });
});

describe('the workspace root routes a platform operator instead of stranding them', () => {
  it('redirects a forbidden workspace session to the console when the platform admits it', async () => {
    backend({ tenant: 403, platform: 200 });
    expect(await redirectTarget(() => requireSession('en'))).toBe('/en/platform');
  });

  it('keeps reason=forbidden when the platform refuses too', async () => {
    backend({ tenant: 403, platform: 403 });
    expect(await redirectTarget(() => requireSession('en'))).toBe('/en/login?reason=forbidden');
  });

  it('leaves a tenant operator untouched', async () => {
    backend({ tenant: 200, platform: 200 });
    const session = await requireSession('en');
    expect(session.permissions).toEqual(['iam.user.read']);
    expect(calls).toEqual(['/api/v1/auth/session']);
  });

  it('does not consult the platform for an expired session', async () => {
    backend({ tenant: 401, platform: 200 });
    expect(await redirectTarget(() => requireSession('en'))).toBe(`/en/${SESSION_ENDED_SEGMENT}`);
    expect(calls).not.toContain('/api/v1/platform/session');
  });
});

describe('the console admits only a platform session with authority', () => {
  it('returns the session when the platform read answers with authority', async () => {
    backend({ tenant: 403, platform: 200 });
    const session = await requirePlatformSession('en');
    expect(session.platformPermissions).toContain('platform.organization.read');
  });

  it('refuses a tenant operator', async () => {
    backend({ tenant: 200, platform: 403 });
    expect(await redirectTarget(() => requirePlatformSession('ar'))).toBe(
      '/ar/login?reason=forbidden'
    );
  });

  it('refuses a platform answer carrying no authority', async () => {
    backend({
      tenant: 403,
      platform: 200,
      platformBody: { ...PLATFORM_SESSION, platformPermissions: [] },
    });
    expect(await redirectTarget(() => requirePlatformSession('en'))).toBe(
      '/en/login?reason=forbidden'
    );
  });

  it('treats a malformed answer as unusable rather than trusting it', async () => {
    backend({ tenant: 403, platform: 200, platformBody: { userId: USER } });
    const state = await readPlatformSession();
    expect(state.ok).toBe(false);
    if (!state.ok) expect(state.problem).toBe('unavailable');
  });

  it('sends an expired token through the session-ended route', async () => {
    backend({ tenant: 401, platform: 401 });
    expect(await redirectTarget(() => requirePlatformSession('en'))).toBe(
      `/en/${SESSION_ENDED_SEGMENT}`
    );
  });

  it('sends a visitor with no cookie to sign in', async () => {
    jar.token = null;
    backend({ tenant: 200, platform: 200 });
    expect(await redirectTarget(() => requirePlatformSession('en'))).toBe(
      '/en/login?reason=signed-out'
    );
    expect(calls).toEqual([]);
  });
});
