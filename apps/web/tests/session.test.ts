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
  /** What `src/proxy.ts` recorded as the path being served; null = no header. */
  requestedPath: null as string | null,
  /** Cookie deletions and backend calls, in the order they happened. */
  events: [] as string[],
}));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers(
      jar.requestedPath === null ? {} : { 'x-rootlco-requested-path': jar.requestedPath }
    ),
  cookies: async () => ({
    get: (name: string) => (jar.token === null ? undefined : { name, value: jar.token }),
    delete: (name: string) => {
      if (!jar.mutationAllowed) throw new Error(RENDER_MUTATION_ERROR);
      jar.deleted.push(name);
      jar.events.push(`cookie-deleted:${name}`);
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
const { loadWorkingContext } = await import('@/features/working-context/api');
const { WORKING_CONTEXT_PATH, isWorkingContextShape, permitsInBranch, preferenceKeyFor } =
  await import('@/features/working-context/working-context-contract');
const { GET } = await import('@/app/[locale]/(auth)/session-ended/route');
const { logoutAction } = await import('@/features/authentication/actions/logout');
const { INTENDED_PATH_PARAM } = await import('@/features/authentication/api/intended-path');
const { REQUESTED_PATH_HEADER } =
  await import('@/features/authentication/api/requested-path-header');

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
  jar.requestedPath = null;
  jar.events = [];
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
    // `P1-26-F-022`: the account authenticated and its session read was refused
    // (then for lacking `iam.user.read`, which the read no longer declares since
    // P1-32-PRE-OD-FRX). Clearing on 403 produced sign in -> 403 -> cleared ->
    // sign in, for ever, and a 403 from any cause must still keep the cookie.
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

/**
 * P1-32-PRE-OD-FRX — the session read is an authenticated self-read.
 *
 * It used to require `iam.user.read`, so a role without the user-directory code
 * — the seeded technician and cashier roles, a quotations-only role — was
 * refused its own session on every dashboard page and sent back to sign-in with
 * `reason=forbidden`. The backend now answers any authenticated caller its own
 * facts; these cases hold the web half of that contract.
 */
describe('a role without the user-directory code opens the product', () => {
  const QUOTATIONS_ONLY = {
    ...SESSION,
    permissions: ['quo.quotation.read', 'quo.quotation.manage', 'wo.work_order.read'],
  };

  function answerByPath(session: unknown) {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        calls.push(path);
        if (path === '/api/v1/auth/session') return respond(200, session);
        if (path === WORKING_CONTEXT_PATH) return respond(200, CONTEXT_BODY);
        return respond(404);
      })
    );
    return calls;
  }

  it('is answered, not redirected to forbidden, when it holds only quo.* and wo.work_order.read', async () => {
    answerByPath(QUOTATIONS_ONLY);
    const session = await requireSession('en');
    expect(session.permissions).toEqual(QUOTATIONS_ONLY.permissions);
    expect(session.permissions).not.toContain('iam.user.read');
    expect(jar.deleted).toEqual([]);
  });

  it('renders the dashboard layout with its own permissions and working context', async () => {
    const calls = answerByPath(QUOTATIONS_ONLY);
    const { default: DashboardLayout } = await import('@/app/[locale]/(dashboard)/layout');
    // Throws NEXT_REDIRECT if the layout sends the operator anywhere; it must not.
    const tree = (await DashboardLayout({
      children: null,
      params: Promise.resolve({ locale: 'en' }),
    })) as { props: Record<string, unknown> };
    const snapshot = tree.props.snapshot as { status: string };
    expect(snapshot.status).toBe('ready');
    const scope = tree.props.children as { props: Record<string, unknown> };
    expect(scope.props.permissions).toEqual(QUOTATIONS_ONLY.permissions);
    expect(calls).toEqual(['/api/v1/auth/session', WORKING_CONTEXT_PATH]);
  });

  it('still sends an account holding NO code at all to sign-in as forbidden, cookie kept', async () => {
    // Answered 200 with its own facts now, where it used to be refused 403 — and
    // it still opens nothing, so the sign-in page's "not permitted to open the
    // application" stays the true sentence. The platform session is asked first
    // (the stub refuses it), which is how the platform operator still reaches
    // the console.
    const calls = answerByPath({ ...SESSION, permissions: [] });
    const target = await redirectTarget(() => requireSession('en'));
    expect(target).toBe('/en/login?reason=forbidden');
    expect(jar.deleted).toEqual([]);
    expect(calls).toContain('/api/v1/platform/session');
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

/**
 * The working-context read (`iam.working-context-read`).
 *
 * It sits beside the session read on purpose: the two are the same kind of
 * call, made in the same layout, against the same cookie, and the interesting
 * cases are the same ones. What the session read publishes is bare references
 * with an empty list standing for "unrestricted"; what this one publishes is
 * named, active entities plus an explicit `unrestricted`, which is the whole
 * reason the branch pickers could stop asking for a typed reference.
 */
const CONTEXT_BODY = {
  tenantId: '2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e',
  unrestricted: false,
  companies: [{ id: 'c-1', name: 'Northern Operations', code: 'NORTH' }],
  branches: [
    {
      id: 'b-1',
      companyId: 'c-1',
      code: 'B1',
      name: 'Main workshop',
      city: null,
      timezone: 'Asia/Riyadh',
      status: 'active',
    },
  ],
};

describe('the working-context read', () => {
  it('calls the published path and returns a ready snapshot', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(new URL(url).pathname);
        return respond(200, CONTEXT_BODY);
      })
    );
    const snapshot = await loadWorkingContext('user-1');
    expect(calls).toEqual([WORKING_CONTEXT_PATH]);
    expect(snapshot.status).toBe('ready');
    expect(snapshot.tenantId).toBe(CONTEXT_BODY.tenantId);
    expect(snapshot.accountId).toBe('user-1');
    expect(snapshot.branches).toHaveLength(1);
  });

  it('reports NO branch as its own state, not as a failure', async () => {
    // An operator with no branch has nothing to choose and nothing broken.
    // Collapsing this into `unavailable` would offer them a retry that can
    // never change the answer.
    answerSessionWith(200, { ...CONTEXT_BODY, branches: [] });
    const snapshot = await loadWorkingContext('user-1');
    expect(snapshot.status).toBe('none');
  });

  it('treats a 200 of the wrong shape as unreadable rather than as an empty workshop', async () => {
    // The failure this closes: a 200 carrying an error envelope would otherwise
    // publish `branches: undefined` and every screen would decide for itself
    // what that meant.
    answerSessionWith(200, { tenantId: 'x' });
    expect((await loadWorkingContext('user-1')).status).toBe('unavailable');
  });

  it('never throws, whatever the backend answers', async () => {
    for (const status of [401, 403, 429, 500, 503]) {
      answerSessionWith(status);
      const snapshot = await loadWorkingContext('user-1');
      expect(snapshot.status, String(status)).toBe('unavailable');
      expect(snapshot.branches).toEqual([]);
    }
  });

  it('reports no session as unreadable rather than as an error page', async () => {
    jar.token = null;
    expect((await loadWorkingContext('user-1')).status).toBe('unavailable');
  });

  it('refuses a body whose branch entries are not the published shape', () => {
    expect(isWorkingContextShape(CONTEXT_BODY)).toBe(true);
    expect(isWorkingContextShape({ ...CONTEXT_BODY, unrestricted: 'yes' })).toBe(false);
    expect(
      isWorkingContextShape({ ...CONTEXT_BODY, branches: [{ id: 'b-1', companyId: 'c-1' }] })
    ).toBe(false);
    expect(isWorkingContextShape(null)).toBe(false);
  });

  it('carries the companies whose settings may be read, and none when the field is absent', async () => {
    // Added to a published read, so an answer without it is still a working
    // context — but one that names no readable company, so no settings screen
    // makes a read the server would refuse. A present value of the wrong shape
    // fails closed like the rest of the body.
    answerSessionWith(200, { ...CONTEXT_BODY, companySettingsReadableIds: ['c-1'] });
    expect((await loadWorkingContext('user-1')).companySettingsReadableIds).toEqual(['c-1']);
    answerSessionWith(200, CONTEXT_BODY);
    const withoutField = await loadWorkingContext('user-1');
    expect(withoutField.status).toBe('ready');
    expect(withoutField.companySettingsReadableIds).toEqual([]);
    expect(isWorkingContextShape({ ...CONTEXT_BODY, companySettingsReadableIds: 'c-1' })).toBe(
      false
    );
    expect(isWorkingContextShape({ ...CONTEXT_BODY, companySettingsReadableIds: [1] })).toBe(false);
  });

  it('carries the per-branch answer for the branch-scoped action codes, and nothing when absent (finance QA fixes D)', async () => {
    const answer = {
      codes: ['sal.credit.approve'],
      branches: [
        { branchId: 'b-1', permissions: [] },
        { branchId: 'b-2', permissions: ['sal.credit.approve'] },
      ],
    };
    answerSessionWith(200, { ...CONTEXT_BODY, branchPermissions: answer });
    const carried = await loadWorkingContext('user-1');
    expect(carried.branchPermissions).toEqual(answer);
    answerSessionWith(200, CONTEXT_BODY);
    expect((await loadWorkingContext('user-1')).branchPermissions).toBeUndefined();
    // A present value of the wrong shape fails closed like the rest of the body.
    for (const broken of [
      'all',
      { codes: 'sal.credit.approve', branches: [] },
      { codes: [], branches: [{ branchId: 'b-1' }] },
      { codes: [], branches: [{ branchId: 1, permissions: [] }] },
    ]) {
      expect(isWorkingContextShape({ ...CONTEXT_BODY, branchPermissions: broken })).toBe(false);
    }
  });

  it('offers a covered code only in a branch the answer names it under; any other code is left to the session check', () => {
    const answer = {
      codes: ['sal.credit.approve'],
      branches: [
        { branchId: 'b-1', permissions: [] },
        { branchId: 'b-2', permissions: ['sal.credit.approve'] },
      ],
    };
    expect(permitsInBranch(answer, 'sal.credit.approve', 'b-2')).toBe(true);
    // Held in another branch only: not offered here.
    expect(permitsInBranch(answer, 'sal.credit.approve', 'b-1')).toBe(false);
    // A branch outside the answer, or none at all, fails closed.
    expect(permitsInBranch(answer, 'sal.credit.approve', 'b-9')).toBe(false);
    expect(permitsInBranch(answer, 'sal.credit.approve', null)).toBe(false);
    // A code the answer does not cover, or no answer, keeps the tenant-wide check.
    expect(permitsInBranch(answer, 'sal.payment.record', 'b-1')).toBe(true);
    expect(permitsInBranch(undefined, 'sal.credit.approve', 'b-1')).toBe(true);
  });

  it('keys the remembered choice to the workspace AND the account', () => {
    // A shared office machine is ordinary. Two operators signing in one after
    // the other must not inherit each other's branch.
    expect(preferenceKeyFor('t-1', 'u-1')).toBe('rootlco.working-context.t-1.u-1');
    expect(preferenceKeyFor('t-1', 'u-1')).not.toBe(preferenceKeyFor('t-1', 'u-2'));
    expect(preferenceKeyFor('t-1', 'u-1')).not.toBe(preferenceKeyFor('t-2', 'u-1'));
  });
});

/**
 * P1-32-PRE-OD-AUTHB — the page being refused travels to sign-in.
 *
 * `src/proxy.ts` records the path of the request being served; a protected
 * render that must send the operator to sign in carries it, re-checked, as the
 * intended path. Every case above runs with NO recorded path and keeps its exact
 * address, which is the other half of this: nothing changes when there is no
 * page to return to.
 */
describe('the intended page travels with the redirect to sign-in', () => {
  it('names the header the proxy writes', () => {
    // The mock above answers this name; if the two ever disagree every case
    // below passes against a header nobody sends.
    expect(REQUESTED_PATH_HEADER).toBe('x-rootlco-requested-path');
  });

  it('carries the page when there is no session at all', async () => {
    jar.token = null;
    jar.requestedPath = '/en/work-orders';
    expect(await redirectTarget(() => requireSession('en'))).toBe(
      `/en/login?reason=signed-out&${INTENDED_PATH_PARAM}=%2Fen%2Fwork-orders`
    );
  });

  it('carries the page in Arabic as well', async () => {
    jar.token = null;
    jar.requestedPath = '/ar/invoices';
    expect(await redirectTarget(() => requireSession('ar'))).toBe(
      `/ar/login?reason=signed-out&${INTENDED_PATH_PARAM}=%2Far%2Finvoices`
    );
  });

  it('carries the page through the session-ended handler when the token was rejected', async () => {
    answerSessionWith(401);
    jar.requestedPath = '/en/work-orders/2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e';
    const first = await redirectTarget(() => requireSession('en'));
    expect(first).toBe(
      `/en/${SESSION_ENDED_SEGMENT}?${INTENDED_PATH_PARAM}=` +
        '%2Fen%2Fwork-orders%2F2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e'
    );
    expect(jar.deleted).toEqual([]);

    // The handler receives exactly the address the render produced.
    jar.mutationAllowed = true;
    const second = await redirectTarget(() =>
      GET(
        new Request(`http://localhost:3100${first}`, {
          headers: { 'sec-fetch-site': 'same-origin' },
        }),
        { params: Promise.resolve({ locale: 'en' }) }
      )
    );
    expect(jar.deleted).toEqual([SESSION_COOKIE]);
    expect(second).toBe(
      `/en/login?reason=expired&${INTENDED_PATH_PARAM}=` +
        '%2Fen%2Fwork-orders%2F2f1c5b3e-6a4d-4b21-9c8e-1f2a3b4c5d6e'
    );
  });

  it('carries the page when the backend could not confirm the session', async () => {
    answerSessionWith(503);
    jar.requestedPath = '/en/payments';
    expect(await redirectTarget(() => requireSession('en'))).toBe(
      `/en/login?reason=unavailable&${INTENDED_PATH_PARAM}=%2Fen%2Fpayments`
    );
  });

  it('carries NO page for a refused session read — the same account opens nothing', async () => {
    answerSessionWith(403);
    jar.requestedPath = '/en/work-orders';
    expect(await redirectTarget(() => requireSession('en'))).toBe('/en/login?reason=forbidden');
  });

  it('sends an account holding no permission code to sign-in as forbidden, with no page', async () => {
    // P1-32-PRE-OD-FRX kept: answered 200 with no code, it is sent to sign-in
    // as `forbidden` with its cookie kept, after the platform session is asked
    // (and refused here), which is how the platform operator keeps reaching the
    // console.
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        const path = new URL(url).pathname;
        calls.push(path);
        return path === '/api/v1/auth/session'
          ? respond(200, { ...SESSION, permissions: [] })
          : respond(403);
      })
    );
    jar.requestedPath = '/en/work-orders';
    expect(await redirectTarget(() => requireSession('en'))).toBe('/en/login?reason=forbidden');
    expect(jar.deleted).toEqual([]);
    expect(calls).toContain('/api/v1/platform/session');
  });

  it('carries no page for the workspace root, which is the landing anyway', async () => {
    jar.token = null;
    jar.requestedPath = '/en';
    expect(await redirectTarget(() => requireSession('en'))).toBe('/en/login?reason=signed-out');
  });

  it.each([
    ['a protocol-relative address', '//evil.example/en/work-orders'],
    ['a backslash address', '/\\evil.example'],
    ['an absolute address', 'https://evil.example/en'],
    ['an encoded slash', '/en/%2F%2Fevil.example'],
    ['the sign-in page itself', '/en/login'],
    ['the session-ended handler', `/en/${SESSION_ENDED_SEGMENT}`],
  ])('drops %s recorded as the requested path', async (_label, recorded) => {
    jar.token = null;
    jar.requestedPath = recorded;
    expect(await redirectTarget(() => requireSession('en'))).toBe('/en/login?reason=signed-out');
  });
});

describe('the session-ended handler re-checks the intended page', () => {
  const handle = (query: string) =>
    redirectTarget(() =>
      GET(
        new Request(`http://localhost:3100/en/${SESSION_ENDED_SEGMENT}${query}`, {
          headers: { 'sec-fetch-site': 'same-origin' },
        }),
        { params: Promise.resolve({ locale: 'en' }) }
      )
    );

  beforeEach(() => {
    jar.mutationAllowed = true;
  });

  it.each([
    ['an absolute address', 'https%3A%2F%2Fevil.example%2Fen'],
    ['a protocol-relative address', '%2F%2Fevil.example'],
    ['a backslash address', '%2F%5Cevil.example'],
    ['a scheme', 'javascript%3Aalert(1)'],
    ['an encoded slash inside the path', '%2Fen%2F%252F%252Fevil.example'],
    ['a dot-dot segment', '%2Fen%2F..%2Fevil'],
    ['an unknown area', '%2Fen%2Fnot-a-screen'],
  ])('drops %s and lands on the plain expired address', async (_label, encoded) => {
    expect(await handle(`?${INTENDED_PATH_PARAM}=${encoded}`)).toBe('/en/login?reason=expired');
    // It still clears the rejected cookie: a hostile parameter changes nothing
    // about ending the session.
    expect(jar.deleted).toEqual([SESSION_COOKIE]);
  });

  it('never redirects to the intended page itself — only to sign-in', async () => {
    const target = await handle(`?${INTENDED_PATH_PARAM}=%2Fen%2Fwork-orders`);
    expect(target.startsWith('/en/login?')).toBe(true);
    expect(target).toBe(`/en/login?reason=expired&${INTENDED_PATH_PARAM}=%2Fen%2Fwork-orders`);
  });

  it('carries it even when it declines to clear a cross-site request', async () => {
    const target = await redirectTarget(() =>
      GET(
        new Request(
          `http://localhost:3100/en/${SESSION_ENDED_SEGMENT}?${INTENDED_PATH_PARAM}=%2Fen%2Fwork-orders`,
          { headers: { 'sec-fetch-site': 'cross-site' } }
        ),
        { params: Promise.resolve({ locale: 'en' }) }
      )
    );
    expect(jar.deleted).toEqual([]);
    expect(target).toBe(`/en/login?reason=expired&${INTENDED_PATH_PARAM}=%2Fen%2Fwork-orders`);
  });
});

/**
 * Sign-out, as the lifecycle stands (P1-32-PRE-OD-AUTHB, item 3).
 *
 * The cookie is cleared first and unconditionally, the backend is then told
 * with the token that was in it — `POST /api/v1/auth/logout` revokes exactly
 * that session row, which is what refuses the token at once although it has not
 * expired — and the operator lands on sign-in with `signed-out` and no intended
 * page: they chose to leave.
 */
describe('signing out', () => {
  function logoutForm(locale: string): FormData {
    const form = new FormData();
    form.set('locale', locale);
    return form;
  }

  beforeEach(() => {
    // A Server Action is the other context Next permits to write a cookie.
    jar.mutationAllowed = true;
    jar.token = 'live.session.token';
  });

  it('clears the cookie BEFORE it tells the backend, then lands on signed-out', async () => {
    const seen: { path: string; authorization: string | null }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        jar.events.push('backend-called');
        seen.push({
          path: new URL(url).pathname,
          authorization: new Headers(init?.headers).get('authorization'),
        });
        return respond(204);
      })
    );
    jar.requestedPath = '/en/work-orders';
    const target = await redirectTarget(() => logoutAction(logoutForm('en')));
    expect(jar.events).toEqual([`cookie-deleted:${SESSION_COOKIE}`, 'backend-called']);
    expect(seen).toEqual([
      { path: '/api/v1/auth/logout', authorization: 'Bearer live.session.token' },
    ]);
    expect(target).toBe('/en/login?reason=signed-out');
  });

  it('signs out in Arabic to the Arabic sign-in page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respond(204))
    );
    expect(await redirectTarget(() => logoutAction(logoutForm('ar')))).toBe(
      '/ar/login?reason=signed-out'
    );
  });

  it('still clears and redirects when the backend cannot be reached', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      })
    );
    expect(await redirectTarget(() => logoutAction(logoutForm('en')))).toBe(
      '/en/login?reason=signed-out'
    );
    expect(jar.deleted).toEqual([SESSION_COOKIE]);
  });

  it('calls nothing when there was no session, and still lands on signed-out', async () => {
    jar.token = null;
    const fetchSpy = vi.fn(async () => respond(204));
    vi.stubGlobal('fetch', fetchSpy);
    expect(await redirectTarget(() => logoutAction(logoutForm('en')))).toBe(
      '/en/login?reason=signed-out'
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
