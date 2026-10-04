'use client';

import { useEffect, useState } from 'react';
import { readPersonName } from './person-read';

/**
 * What an administration screen knows about the person behind an account
 * reference. Four outcomes, because the platform has four, and in none of them
 * does the reference reach the screen:
 *
 *   - `named` — the directory answered with a name.
 *   - `denied` — the reader does not hold `iam.user.read`; no request is made.
 *   - `unresolved` — the reference names no current account (or a blank name).
 *   - `unavailable` — the read did not answer, so nothing was learned.
 */
export type PersonName =
  | { readonly status: 'named'; readonly displayName: string }
  | { readonly status: 'denied' }
  | { readonly status: 'unresolved' }
  | { readonly status: 'unavailable' };

/** What every person on the page resolved to, keyed by account reference. */
export type PersonNames = ReadonlyMap<string, PersonName>;

const NO_PEOPLE: PersonNames = new Map();

/**
 * The names behind the account references a list is holding.
 *
 * One read per DISTINCT reference, only for references actually on the page,
 * and none at all without `iam.user.read`. The reads are dropped when the set of
 * references changes or the screen unmounts, so a stale answer never lands on a
 * newer list.
 *
 * Lives in administration's shared folder on purpose: importing the receptions
 * read-back hook made the approval-limits page load a P1-28 feature tree, which
 * the P1-28 access gate (`tests/ci/p1-28-access-gate.test.ts`) counts as a
 * fifteenth P1-28 screen.
 */
export function usePersonNames(ids: readonly string[], canRead: boolean): PersonNames {
  // The references as ONE stable string, so the effect re-runs when the SET
  // changes rather than on every render that rebuilds the array.
  const key = canRead ? [...new Set(ids)].sort().join(',') : '';
  const [held, setHeld] = useState<{ readonly key: string; readonly names: PersonNames }>({
    key: '',
    names: NO_PEOPLE,
  });

  useEffect(() => {
    if (key === '') return;
    let cancelled = false;
    void (async () => {
      const resolved = await Promise.all(
        key.split(',').map(async (id) => {
          // A read that never came back is `unavailable`, not a crash of the list.
          try {
            return [id, await readPersonName(id)] as const;
          } catch {
            return [id, { status: 'unavailable' } as PersonName] as const;
          }
        })
      );
      if (!cancelled) setHeld({ key, names: new Map(resolved) });
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  if (!canRead) return NO_PEOPLE;
  return held.key === key ? held.names : NO_PEOPLE;
}
