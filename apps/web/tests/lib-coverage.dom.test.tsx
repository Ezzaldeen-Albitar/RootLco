/**
 * Three small library modules that a promotion surfaced as under-covered.
 *
 * The `develop` -> `main` promotion diffs 921 commits, so every file touched
 * since the last promotion counts as "touched by this pull request" and is held
 * to the 60% floor. Three were below it: `page-metadata.ts` at 41.67%,
 * `use-persisted-flag.ts` at 0%, and `api/session-cookie.ts` at 42.86%.
 *
 * The floor is not the point. Each of these carries a rule its own docblock
 * states in strong terms — a title that must exist in both languages, a
 * preference read without a hydration flash, a `secure` attribute that must fail
 * closed — and none of those rules was asserted anywhere. Adding the assertions
 * is the honest way past the gate; adding the paths to an exemption list would
 * have moved the gate instead of the coverage.
 */
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const jar = new Map<string, string>();
const deleted: string[] = [];
const written: { name: string; value: string; options: Record<string, unknown> }[] = [];

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    delete: (name: string) => void deleted.push(name),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.set(name, value);
      written.push({ name, value, options });
    },
  }),
}));

import { DEFAULT_LOCALE } from '@/i18n/config';
import { pageMetadata } from '@/lib/page-metadata';
import { readFlag, writeFlag, usePersistedFlag } from '@/lib/use-persisted-flag';
import {
  SESSION_COOKIE,
  TENANT_HINT_COOKIE,
  sessionCookieAttributes,
  readSessionToken,
  readTenantHint,
  clearSession,
  writeSession,
  writeTenantHint,
} from '@/lib/api/session-cookie';

/* ---------------------------------------------------------------- metadata */

describe('pageMetadata — the tab and the heading cannot disagree', () => {
  it('translates the title in each locale', async () => {
    const generate = pageMetadata('admin.title' as never);
    const en = await generate({ params: Promise.resolve({ locale: 'en' }) });
    const ar = await generate({ params: Promise.resolve({ locale: 'ar' }) });

    expect(typeof en.title, 'the English title is not a string').toBe('string');
    expect(String(en.title).length, 'the English title is empty').toBeGreaterThan(0);
    expect(typeof ar.title).toBe('string');
    expect(String(ar.title).length).toBeGreaterThan(0);
    expect(String(ar.title), 'Arabic returned the English string').not.toBe(String(en.title));
  });

  it('falls back to the default locale rather than emitting no title', async () => {
    /*
     * `P1-26-F-046` was a missing `<title>` on every route — invisible to a
     * component tier and unmissable to a screen reader. A locale the router
     * never produces must still yield a title, because the alternative is the
     * defect coming back through an unexpected path.
     */
    const generate = pageMetadata('admin.title' as never);
    const odd = await generate({ params: Promise.resolve({ locale: 'kl' }) });
    const fallback = await generate({ params: Promise.resolve({ locale: DEFAULT_LOCALE }) });

    expect(String(odd.title).length, 'an unknown locale produced no title').toBeGreaterThan(0);
    // Asserted against the DECLARED default rather than against English: this
    // product's default locale is Arabic, and a test that assumed otherwise
    // would be asserting its author's expectation instead of the contract.
    expect(String(odd.title), 'the fallback is not the default locale').toBe(
      String(fallback.title)
    );
  });
});

/* ------------------------------------------------------------ persisted flag */

describe('usePersistedFlag storage — a preference, and never more than one', () => {
  const store = new Map<string, string>();
  const original = globalThis.window;

  beforeEach(() => {
    store.clear();
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
        setItem: (k: string, v: string) => void store.set(k, v),
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    });
  });
  afterEach(() => {
    vi.stubGlobal('window', original);
  });

  it('returns the fallback when nothing is stored, and the stored value once it is', () => {
    expect(readFlag('sidebar.collapsed', true), 'an absent key ignored its fallback').toBe(true);
    expect(readFlag('sidebar.collapsed', false)).toBe(false);

    writeFlag('sidebar.collapsed', true);
    expect(readFlag('sidebar.collapsed', false), 'the stored value was not read back').toBe(true);

    writeFlag('sidebar.collapsed', false);
    expect(readFlag('sidebar.collapsed', true)).toBe(false);
  });

  it('treats any value that is not "true" as false, rather than as truthy', () => {
    // The store is untyped text a previous version — or another tab — may have
    // written. Only the exact string counts.
    store.set('flag', 'yes');
    expect(readFlag('flag', true), '"yes" was read as true').toBe(false);
    store.set('flag', '1');
    expect(readFlag('flag', true)).toBe(false);
    store.set('flag', 'true');
    expect(readFlag('flag', false)).toBe(true);
  });

  it('answers with the fallback when storage throws, rather than propagating', () => {
    /*
     * Private mode, blocked storage, a quota error. The docblock says the
     * fallback is a complete answer — so a throw must not reach a render.
     */
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('storage is blocked');
        },
        setItem: () => {
          throw new Error('storage is blocked');
        },
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    });

    expect(readFlag('flag', true), 'a blocked read escaped as an exception').toBe(true);
    expect(readFlag('flag', false)).toBe(false);
    expect(() => writeFlag('flag', true), 'a blocked write escaped as an exception').not.toThrow();
  });
});

/* ------------------------------------------------------------ session cookie */

describe('sessionCookieAttributes — a security attribute that fails closed', () => {
  it('turns `secure` off for exactly one value, and on for everything else', () => {
    /*
     * `P1-26-F-023`: the earlier form derived this from a schema whose DEFAULT
     * was `local`, so a deployment that forgot to set NEXT_PUBLIC_APP_ENV served
     * the session over plain HTTP and nothing reported it. A security attribute
     * whose safe state depends on a variable being present is not a control.
     */
    expect(sessionCookieAttributes('local').secure, 'local must not force secure').toBe(false);

    for (const env of ['', 'Local', 'LOCAL', 'locale', 'production', 'staging', 'undefined']) {
      expect(sessionCookieAttributes(env).secure, `${env || '(empty)'} produced an insecure cookie`).toBe(
        true
      );
    }
  });

  it('is httpOnly, lax and root-scoped in every environment', () => {
    for (const env of ['local', 'production']) {
      const a = sessionCookieAttributes(env);
      expect(a.httpOnly, 'the session cookie became readable to scripts').toBe(true);
      expect(a.sameSite).toBe('lax');
      expect(a.path).toBe('/');
    }
  });
});

describe('session cookie reads — absent, empty and malformed are all "no session"', () => {
  beforeEach(() => {
    jar.clear();
    deleted.length = 0;
    written.length = 0;
  });

  it('reads a token, and reports no session for absent or empty', async () => {
    expect(await readSessionToken(), 'an absent cookie produced a token').toBeNull();

    jar.set(SESSION_COOKIE, '');
    expect(await readSessionToken(), 'an empty cookie produced a token').toBeNull();

    jar.set(SESSION_COOKIE, 'a-real-token');
    expect(await readSessionToken()).toBe('a-real-token');
  });

  it('refuses a tenant hint that is not a uuid', async () => {
    /*
     * The hint is deliberately NOT httpOnly — it is pre-fill convenience and
     * authorises nothing — so it is whatever the browser was last told to hold.
     * It reaches a form field, and a tampered value must not arrive there as
     * arbitrary text.
     */
    expect(await readTenantHint()).toBeNull();

    for (const bad of ['', 'not-a-uuid', '<script>', '../../etc/passwd', '0'.repeat(36)]) {
      jar.set(TENANT_HINT_COOKIE, bad);
      expect(await readTenantHint(), `${bad || '(empty)'} was accepted as a tenant`).toBeNull();
    }

    jar.set(TENANT_HINT_COOKIE, 'c0000000-0000-4000-8000-00000000000c');
    expect(await readTenantHint()).toBe('c0000000-0000-4000-8000-00000000000c');
  });

  it('clears the session cookie and nothing else', async () => {
    await clearSession();
    expect(deleted, 'clearing the session touched the wrong cookie').toEqual([SESSION_COOKIE]);
  });
});

describe('session cookie writes — the cookie must not outlive its token', () => {
  beforeEach(() => {
    jar.clear();
    deleted.length = 0;
    written.length = 0;
  });

  it('sets the expiry from the backend, so the cookie stops when the token does', async () => {
    /*
     * A cookie that outlives its token produces a request that is REJECTED
     * instead of a redirect to sign in, which reads to the operator as a broken
     * screen rather than an expired session.
     */
    await writeSession('a-token', '2030-01-01T00:00:00.000Z', 'production');

    expect(written).toHaveLength(1);
    expect(written[0]!.name).toBe(SESSION_COOKIE);
    expect(written[0]!.value).toBe('a-token');
    expect(written[0]!.options.expires, 'the backend expiry did not reach the cookie').toEqual(
      new Date('2030-01-01T00:00:00.000Z')
    );
    expect(written[0]!.options.httpOnly).toBe(true);
    expect(written[0]!.options.secure, 'a production session cookie was not secure').toBe(true);
  });

  it('omits the expiry rather than writing an invalid date', async () => {
    // `new Date('nonsense')` is an Invalid Date. Passing it to a cookie store
    // is worse than a session cookie: the attribute becomes meaningless.
    await writeSession('a-token', 'not-a-date', 'local');

    expect(written).toHaveLength(1);
    expect(written[0]!.options, 'an invalid date was written as an expiry').not.toHaveProperty(
      'expires'
    );
    expect(written[0]!.options.secure, 'local must not force secure').toBe(false);
  });

  it('writes a tenant hint only for a real uuid, and never httpOnly', async () => {
    for (const bad of ['', 'not-a-uuid', '../etc', '0'.repeat(36)]) {
      await writeTenantHint(bad, 'production');
    }
    expect(written, 'a malformed tenant reached the cookie store').toHaveLength(0);

    await writeTenantHint('c0000000-0000-4000-8000-00000000000c', 'production');
    expect(written).toHaveLength(1);
    expect(written[0]!.name).toBe(TENANT_HINT_COOKIE);
    // Deliberately readable: it is pre-fill convenience and authorises nothing.
    expect(written[0]!.options.httpOnly).toBe(false);
    expect(written[0]!.options.secure).toBe(true);
    expect(written[0]!.options.maxAge).toBe(60 * 60 * 24 * 180);
  });
});


describe('usePersistedFlag — the preference survives a reload without a flash', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('starts from storage rather than from the default, and writes through', () => {
    /*
     * The whole reason this is `useSyncExternalStore` and not `useState` plus
     * an effect: the effect form renders twice and the operator sees the
     * default for one frame — the sidebar visibly un-collapses on every page
     * load. So the FIRST value the hook yields must already be the stored one.
     */
    window.localStorage.setItem('sidebar.collapsed', 'true');

    const { result } = renderHook(() => usePersistedFlag('sidebar.collapsed', false));
    expect(result.current[0], 'the first render showed the default, not the stored value').toBe(
      true
    );

    act(() => result.current[1](false));
    expect(result.current[0], 'the hook did not reflect its own write').toBe(false);
    expect(window.localStorage.getItem('sidebar.collapsed')).toBe('false');
  });

  it('uses the fallback when nothing is stored', () => {
    const { result } = renderHook(() => usePersistedFlag('never.written', true));
    expect(result.current[0]).toBe(true);
  });

  it('follows a change made in another tab', () => {
    /*
     * `storage` fires only in OTHER tabs, which is exactly what it is for here:
     * collapse the sidebar in one tab and the others follow. Without a live
     * subscription the hook would hold a stale value until something else
     * re-rendered it.
     */
    const { result } = renderHook(() => usePersistedFlag('sidebar.collapsed', false));
    expect(result.current[0]).toBe(false);

    act(() => {
      window.localStorage.setItem('sidebar.collapsed', 'true');
      window.dispatchEvent(new StorageEvent('storage', { key: 'sidebar.collapsed' }));
    });
    expect(result.current[0], 'a change from another tab was not followed').toBe(true);
  });
});
