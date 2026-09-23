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
const { default: PlatformLayout } = await import('@/app/[locale]/(platform)/layout');
const { PLATFORM_NAVIGATION } = await import('@/config/platform-navigation');
const { NAVIGATION, flattenNavigation, hrefFor } = await import('@/config/navigation');
const { NO_CAPABILITIES, landingRoute, visibleNavigation } = await import('@/lib/permissions');

const USER = '2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e';

const TENANT_SESSION = {
  userId: USER,
  tenantId: USER,
  email: 'operator@example.test',
  displayName: 'Operator',
  companyIds: [],
  branchIds: [],
  // `wo.work_order.read` opens the dashboard, so this operator lands on the
  // workspace root; the case below takes it away.
  permissions: ['iam.user.read', 'wo.work_order.read'],
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
  readonly tenantBody?: unknown;
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
        return answers.tenant === 200
          ? respond(200, answers.tenantBody ?? TENANT_SESSION)
          : respond(answers.tenant);
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

  it('sends a tenant operator who cannot open the dashboard to the first screen they can', async () => {
    // The dashboard's summary is entitled by `wo.work_order.read`. Without it the
    // workspace root could only refuse this operator, so sign-in sends them to
    // the first navigation entry their codes open instead — here the
    // administration area `iam.user.read` opens — and still never asks the
    // platform.
    backend({
      tenant: 200,
      platform: 403,
      tenantBody: { ...TENANT_SESSION, permissions: ['iam.user.read'] },
    });
    const target = await redirectTarget(() => loginAction({ status: 'idle' }, credentials('ar')));
    expect(target).toBe('/ar/administration');
    expect(calls).not.toContain('/api/v1/platform/session');
  });

  it('keeps the workspace root when the session answer carries no permission list', async () => {
    backend({
      tenant: 200,
      platform: 403,
      tenantBody: { ...TENANT_SESSION, permissions: undefined },
    });
    const target = await redirectTarget(() => loginAction({ status: 'idle' }, credentials()));
    expect(target).toBe('/en');
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
    expect(session.permissions).toEqual(TENANT_SESSION.permissions);
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

describe('the console route group refuses at the LAYOUT, not only at the helper', () => {
  /**
   * The cases above call `requirePlatformSession` directly, which proves the
   * decision and not the wiring: a layout that forgot to call it would pass
   * every one of them. So the real layout is invoked here, with the same stubbed
   * backend, and it is the layout's own return that is asserted.
   */
  it('refuses a tenant operator before any console markup exists', async () => {
    backend({ tenant: 200, platform: 403 });
    expect(
      await redirectTarget(() =>
        PlatformLayout({ children: null, params: Promise.resolve({ locale: 'ar' }) })
      )
    ).toBe('/ar/login?reason=forbidden');
  });

  it('sends a visitor who is not signed in to sign in', async () => {
    jar.token = null;
    backend({ tenant: 200, platform: 200 });
    expect(
      await redirectTarget(() =>
        PlatformLayout({ children: null, params: Promise.resolve({ locale: 'en' }) })
      )
    ).toBe('/en/login?reason=signed-out');
  });

  it('admits a platform operator, under the console shell rather than the workspace one', async () => {
    backend({ tenant: 403, platform: 200 });
    const tree = (await PlatformLayout({
      children: null,
      params: Promise.resolve({ locale: 'en' }),
    })) as { props: Record<string, unknown> };
    expect((tree.props.capabilities as { permissions: string[] }).permissions).toEqual(
      PLATFORM_SESSION.platformPermissions
    );
    expect(tree.props.contextLabel).toBe('Platform Owner Console');
    // The navigation model is the console's own, so no workspace destination can
    // reach the sidebar of an account that holds no tenant role at all.
    expect(tree.props.navigation).toBe(PLATFORM_NAVIGATION);
  });

  it('is not a route at all for a locale this application does not publish', async () => {
    backend({ tenant: 403, platform: 200 });
    await expect(
      PlatformLayout({ children: null, params: Promise.resolve({ locale: 'fr' }) })
    ).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

/**
 * The rule every landing above is decided by (Owner directive, P1-32-PRE-OD-UX):
 * the FIRST entry of the tenant navigation the session's codes open, in the
 * order the sidebar draws them. Held here, beside the sign-in cases that use it,
 * rather than in the navigation model's own suite, because it is a question
 * about where an account lands.
 */
describe('where a signed-in tenant session lands', () => {
  it('lands on the dashboard when the session holds its code', () => {
    const route = landingRoute({ permissions: ['wo.work_order.read', 'crm.customer.read'] });
    expect(route?.key).toBe('overview');
    expect(route === null ? null : hrefFor('en', route)).toBe('/en');
  });

  it('lands on the first screen it can open when it cannot open the dashboard', () => {
    // Walk-in intake is the first entry after the dashboard and the Attention
    // area that `crm.customer.read` opens — so that is where this session goes,
    // rather than to a page that could only refuse it.
    const route = landingRoute({ permissions: ['crm.customer.read'] });
    expect(route?.key).toBe('walk-in');
    expect(route === null ? null : hrefFor('ar', route)).toBe('/ar/reception/walk-in');
  });

  it('never lands on an entry the sidebar would not offer', () => {
    for (const permissions of [[], ['crm.customer.read'], ['inv.stock.read'], ['iam.user.read']]) {
      const route = landingRoute({ permissions });
      const offered = visibleNavigation(NAVIGATION, { permissions }).flatMap((group) =>
        flattenNavigation([group])
      );
      expect(route, permissions.join(',')).not.toBeNull();
      expect(
        offered.map((entry) => entry.key),
        permissions.join(',')
      ).toContain(route?.key);
      expect(route?.status).toBe('available');
    }
  });

  it('never lands on the dashboard for a session with no capabilities', () => {
    expect(landingRoute(NO_CAPABILITIES)?.key).toBe('gallery');
    expect(landingRoute(null)?.key).toBe('gallery');
  });
});
