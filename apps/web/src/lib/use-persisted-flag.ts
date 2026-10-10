'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * A boolean preference that survives a reload, read without a hydration flash.
 *
 * ## Why `useSyncExternalStore` and not `useState` + `useEffect`
 *
 * `localStorage` cannot be read during render: the server has no such object,
 * so the server HTML and the first client render disagree and React discards
 * the tree. The obvious workaround — start with a default and `setState` in an
 * effect — is what `react-hooks/set-state-in-effect` exists to catch, and the
 * rule is right. It renders twice, and the user sees the default for one frame:
 * the sidebar visibly un-collapses on every page load.
 *
 * `useSyncExternalStore` is the mechanism built for this. It takes a SERVER
 * snapshot used during SSR and hydration, and a client snapshot read from the
 * real store afterwards, so React knows the two are allowed to differ and
 * commits the stored value without a wasted render.
 *
 * ## What may be stored this way
 *
 * Interface preferences only — a collapse flag, a density choice, a column set.
 * Nothing that names a customer, a tenant, a branch, a record or a permission,
 * and nothing that would matter if another user of the same machine read it.
 */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // `storage` fires only in OTHER tabs, which is exactly what it is for here:
  // collapse the sidebar in one tab and the others follow.
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function notify(): void {
  for (const listener of listeners) listener();
}

export function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === 'true';
  } catch {
    // Private mode, blocked storage, or a quota error. The fallback is a
    // complete answer and there is nothing useful to report to the operator.
    return fallback;
  }
}

export function writeFlag(key: string, value: boolean): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // The preference simply does not persist. Not worth an error state.
  }
  notify();
}

export function usePersistedFlag(
  key: string,
  fallback = false
): readonly [boolean, (next: boolean) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readFlag(key, fallback),
    // The server snapshot. It MUST be the fallback and must not touch storage —
    // this runs where `window` does not exist.
    () => fallback
  );
  const set = useCallback((next: boolean) => writeFlag(key, next), [key]);
  return [value, set] as const;
}

/**
 * The same store, for a preference whose value is a short SYMBOL rather than a
 * yes/no.
 *
 * ## Why this lives here instead of beside its one caller
 *
 * `apps/web/tests/security.test.ts` asserts that exactly one file under `src`
 * names `localStorage` at all, and that file is this one. That assertion is the
 * control: it is what makes "nothing that names a customer, a record or a
 * permission is in browser storage" checkable rather than a habit. A second
 * module reading storage directly would have to weaken it, so the second kind
 * of preference is served from the same authority instead.
 *
 * ## What may be stored this way, and what still may not
 *
 * The rule above this function is unchanged and it is the binding one:
 * interface preferences only. The value must be meaningless to anyone reading
 * it on a shared machine and must grant nothing. A remembered working branch
 * qualifies — it is a reference the server publishes to that operator anyway,
 * it carries no name, and every request that uses it is re-authorized
 * server-side. A session, a token, a customer, a vehicle or a permission set
 * does not qualify and never will.
 *
 * `null` means "no preference recorded", which is a different state from "the
 * empty string", so writing `null` REMOVES the entry rather than storing a
 * blank.
 */
export function readPreference(key: string): string | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null || raw.length === 0 ? null : raw;
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string | null): void {
  try {
    if (value === null || value.length === 0) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Private mode, blocked storage, or a quota error. The preference simply
    // does not survive the reload; nothing the operator can act on.
  }
  notify();
}

/**
 * A stored symbol, read without a hydration flash and kept in step across tabs.
 *
 * The server snapshot is `null` — the honest "nothing is known yet" — for the
 * same reason `usePersistedFlag` returns the fallback there: this runs where
 * `window` does not exist, and inventing a value would make the server HTML and
 * the first client render disagree.
 */
export function usePersistedPreference(
  key: string
): readonly [string | null, (next: string | null) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => readPreference(key),
    () => null
  );
  const set = useCallback((next: string | null) => writePreference(key, next), [key]);
  return [value, set] as const;
}
