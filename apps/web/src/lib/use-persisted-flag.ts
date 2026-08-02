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
