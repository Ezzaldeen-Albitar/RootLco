import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_ENDED_SEGMENT, mayEndSession } from '@/features/authentication/api/session-ended';
import { SESSION_COOKIE } from '@/lib/api/session-cookie';

/**
 * P1-26-F-077 — an EXPIRED session must redirect, not answer HTTP 500.
 *
 * `readSession` cleared the session cookie the moment the backend answered 401.
 * It runs inside a Server Component render, Next forbids cookie mutation there,
 * and so the render threw and every protected route returned 500 to the one
 * visitor who most needed a redirect. Reproduced on `develop` e100fe86:
 *
 *   GET /en/administration  ->  500      (stale cookie)
 *   GET /en/administration  ->  307      (no cookie at all)
 *
 * The second line is why it survived review and a green suite: with no cookie,
 * `authorizedClient()` returns null and the function returns BEFORE the
 * mutation, so the ordinary "not signed in" path was correct and only the
 * expired one was broken.
 *
 * ## The mock is the whole point
 *
 * `cookies()` below refuses to mutate exactly as Next does during a render, and
 * the redirect helper re-throws anything that is not a redirect. So the old code
 * fails these tests with the real production error rather than with an assertion
 * about a call count — a test that only counted `delete()` calls would pass
 * against a version that still threw.
 */

const RENDER_MUTATION_ERROR = 'Cookies can only be modified in a Server Action or Route Handler.';

const jar = vi.hoisted(() => ({
  /** Server Components render with this false; Route Handlers set it true. */
  mutationAllowed: false,
  deleted: [] as string[],
  token: null as string | null,
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.token === null ? undefined : { name, value: jar.token }),
    delete: (name: string) => {
      if (!jar.mutationAllowed) throw new Error(RENDER_MUTATION_ERROR);
      jar.deleted.push(name);
    },
    set: () => {
      if (!jar.mutationAllowed) throw new Error(RENDER_MUTATION_ERROR);
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

const { requireSession, readSession } = await import('@/features/authentication/api/session');
const { GET } = await import('@/app/[locale]/(auth)/session-ended/route');

const SESSION = {
  userId: '2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e',
  tenantId: '2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e',
  email: 'operator@example.test',
  displayName: 'Operator',
  companyIds: [],
  branchIds: [],
  permissions: ['iam.user.read'],
};

/** A backend answer, shaped the way the API actually publishes failures. */
function respond(status: number, body: unknown = { title: 'x', status }) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
    },
  });
}

function answerSessionWith(status: number, body?: unknown) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => respond(status, body))
  );
}

/**
 * Runs `work` and returns the path it redirected to.
 *
 * Anything that is NOT a redirect is re-thrown, so a cookie mutation inside a
 * render surfaces here as the production error and fails the test — which is
 * precisely the regression being guarded.
 */
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

beforeEach(() => {
  jar.mutationAllowed = false;
  jar.deleted = [];
  jar.token = 'stale.expired.token';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('an expired session on a protected route', () => {
  it('REDIRECTS instead of answering 500', async () => {
    answerSessionWith(401);
    // Before the fix this threw `Cookies can only be modified in a Server Action
    // or Route Handler` and the route answered 500.
    const target = await redirectTarget(() => requireSession('en'));
    expect(target).toBe(`/en/${SESSION_ENDED_SEGMENT}`);
  });

  it('mutates NOTHING while rendering', async () => {
    answerSessionWith(401);
    const state = await readSession();
    expect(state).toEqual({ ok: false, problem: 'expired', correlationId: expect.anything() });
    expect(jar.deleted).toEqual([]);
  });

  it('carries the locale, so an Arabic operator is not returned to English', async () => {
    answerSessionWith(401);
    expect(await redirectTarget(() => requireSession('ar'))).toBe(`/ar/${SESSION_ENDED_SEGMENT}`);
  });
});

describe('the session-ended Route Handler', () => {
  const request = (secFetchSite: string | null) =>
    new Request('http://localhost:3100/en/session-ended', {
      headers: secFetchSite === null ? {} : { 'sec-fetch-site': secFetchSite },
    });

  const params = (locale: string) => ({ params: Promise.resolve({ locale }) });

  beforeEach(() => {
    // A Route Handler is one of the two contexts Next permits to write a cookie.
    jar.mutationAllowed = true;
  });

  it('clears the cookie and lands on sign-in with the SAME reason as before', async () => {
    const target = await redirectTarget(() => GET(request('same-origin'), params('en')));
    expect(jar.deleted).toEqual([SESSION_COOKIE]);
    // The operator's visible destination is unchanged by this fix.
    expect(target).toBe('/en/login?reason=expired');
  });

  it('completes the journey the redirect starts', async () => {
    // The handler's own path is the one `requireSession` sends an expired
    // session to. If these two ever disagree the operator lands on a 404.
    answerSessionWith(401);
    jar.mutationAllowed = false;
    const first = await redirectTarget(() => requireSession('en'));

    // Take the handler's input from what `requireSession` actually produced,
    // rather than restating it — a target these two disagree about is a 404.
    const [, locale = '', segment = ''] = first.split('/');
    expect([locale, segment]).toEqual(['en', SESSION_ENDED_SEGMENT]);

    jar.mutationAllowed = true;
    const second = await redirectTarget(() => GET(request('same-origin'), params(locale)));
    expect(second).toBe('/en/login?reason=expired');
    expect(jar.deleted).toEqual([SESSION_COOKIE]);
  });

  it('refuses an unknown locale rather than redirecting somewhere invented', async () => {
    await expect(GET(request('same-origin'), params('de'))).rejects.toThrow('NEXT_NOT_FOUND');
    expect(jar.deleted).toEqual([]);
  });

  it('is served from the path the constant names', () => {
    // Anti-drift: `requireSession` builds the target from SESSION_ENDED_SEGMENT,
    // and Next resolves it from the directory name. A rename of one is a 404.
    const here = dirname(fileURLToPath(import.meta.url));
    const route = join(
      here,
      '..',
      'src',
      'app',
      '[locale]',
      '(auth)',
      SESSION_ENDED_SEGMENT,
      'route.ts'
    );
    expect(existsSync(route), `no route handler at ${route}`).toBe(true);
  });
});

describe('ending a session cross-site', () => {
  it('clears for our own redirect, our own router, and the address bar', () => {
    expect(mayEndSession('same-origin')).toBe(true);
    expect(mayEndSession('none')).toBe(true);
    // Not a browser, so not a request-forgery vector — and refusing here would
    // silently stop the clearing for every non-browser caller.
    expect(mayEndSession(null)).toBe(true);
  });

  it('does NOT let another site sign the operator out', () => {
    // `<img src="https://app.example/en/session-ended">` on any page.
    expect(mayEndSession('cross-site')).toBe(false);
    // A sibling subdomain is a different origin.
    expect(mayEndSession('same-site')).toBe(false);
  });

  it('still redirects when it declines to clear', async () => {
    jar.mutationAllowed = true;
    const target = await redirectTarget(() =>
      GET(
        new Request('http://localhost:3100/en/session-ended', {
          headers: { 'sec-fetch-site': 'cross-site' },
        }),
        { params: Promise.resolve({ locale: 'en' }) }
      )
    );
    expect(jar.deleted).toEqual([]);
    expect(target).toBe('/en/login?reason=expired');
  });
});

describe('a 403 is not an expired session', () => {
  it('keeps the cookie — clearing a VALID credential was the lockout', async () => {
    // `P1-26-F-022`: the account authenticates but lacks `iam.user.read`.
    // Clearing on 403 produced sign in -> 403 -> cleared -> sign in, for ever.
    answerSessionWith(403);
    const target = await redirectTarget(() => requireSession('en'));
    expect(target).toBe('/en/login?reason=forbidden');
    expect(jar.deleted).toEqual([]);
    expect(target).not.toContain(SESSION_ENDED_SEGMENT);
  });

  it('reports forbidden, not expired', async () => {
    answerSessionWith(403);
    const state = await readSession();
    expect(state.ok).toBe(false);
    if (!state.ok) expect(state.problem).toBe('forbidden');
  });
});

describe('the other failures keep their cookie too', () => {
  it('does not destroy a good session because the backend was unreachable', async () => {
    answerSessionWith(503);
    expect(await redirectTarget(() => requireSession('en'))).toBe('/en/login?reason=unavailable');
    expect(jar.deleted).toEqual([]);
  });

  it('sends a visitor with no cookie straight to sign-in', async () => {
    // This path always worked: `authorizedClient()` returns null before any
    // mutation, which is exactly why the 500 above went unnoticed.
    jar.token = null;
    expect(await redirectTarget(() => requireSession('en'))).toBe('/en/login?reason=signed-out');
    expect(jar.deleted).toEqual([]);
  });

  it('treats a 200 of the wrong SHAPE as unusable rather than trusting it', async () => {
    answerSessionWith(200, { userId: 'x' });
    expect(await redirectTarget(() => requireSession('en'))).toBe('/en/login?reason=unavailable');
  });
});

describe('a valid session', () => {
  it('renders, redirecting nowhere and clearing nothing', async () => {
    // The control. Without it every assertion above could pass against a
    // function that redirected unconditionally.
    answerSessionWith(200, SESSION);
    await expect(requireSession('en')).resolves.toMatchObject({ email: SESSION.email });
    expect(jar.deleted).toEqual([]);
  });
});
