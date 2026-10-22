'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';

/**
 * The baseline an edit form's work is based on: the stored values it last
 * matched and the `recordVersion` they were stored at.
 *
 * ## The defect class it closes
 *
 * Four review rounds on the service and pricing screens found the same kind of
 * bug in four panels: an unsaved-work prompt after a save or a publication, and
 * a discard that put back values older than what was stored. Each panel held
 * its own copy of "what the form last matched", and each re-based it in its own
 * way. One of those ways let a discard restore a baseline older than a refresh
 * that had already arrived: the form looked clean, and the next save sent the
 * old values of every field the operator had not touched, guarded by the NEW
 * version, which silently reverted another user's change.
 *
 * ## The rules, in one place
 *
 * - While the form is CLEAN, a refreshed record re-bases it: the form shows the
 *   stored values and the baseline takes the stored version.
 * - While the form is DIRTY, a refreshed record changes neither the typed
 *   values nor the baseline version.
 * - A write sends `version` — the BASELINE's — never the live record's. Work
 *   built on fields a refresh has since replaced is therefore refused by the
 *   server as a conflict instead of overwriting what the refresh brought.
 * - `discard()` re-bases on what is stored NOW, values and version, and leaves
 *   the form clean.
 * - `rebase(values, version?)` after a successful write re-bases on what was
 *   written and leaves the form clean, so nothing prompts afterwards. When the
 *   answer carries the new version it is passed; when it does not, the refresh
 *   that follows the write supplies it, because the form is clean by then.
 * - `dirty` is "the form's values differ from the baseline's", or work the
 *   values cannot show (`pending`, such as a day only partly typed).
 */
export interface EditBaseline<V> {
  /** What the form holds now. */
  readonly values: V;
  readonly setValues: Dispatch<SetStateAction<V>>;
  /** The stored values the form's work is based on. */
  readonly baseline: V;
  /** The version the baseline was stored at: the `If-Match` a write sends. */
  readonly version: number;
  readonly dirty: boolean;
  /**
   * Re-bases on what is stored now, values and version, and is clean. A caller
   * that changes what is stored in the same update (drops a held draft, say)
   * passes the values that will be stored.
   */
  readonly discard: (storedNow?: V) => void;
  /** Re-bases on `values` as written, at `version` when the answer carried it. */
  readonly rebase: (values: V, version?: number) => void;
}

export interface EditBaselineOptions<V> {
  /** The record's values as stored now — what a clean form shows. */
  readonly stored: V;
  /** The record's `recordVersion` as stored now. */
  readonly storedVersion: number;
  /**
   * Whether the form's values differ from the baseline's. Defaults to a
   * key-by-key `Object.is` comparison; a form that saves trimmed text compares
   * trimmed, so a trailing space alone is nothing to save.
   */
  readonly differs?: (values: V, baseline: V) => boolean;
  /** Unsaved work the values cannot show, such as a day only partly typed. */
  readonly pending?: boolean;
}

interface Held<V> {
  readonly values: V;
  readonly baseline: V;
  readonly version: number;
  /**
   * The stored version this baseline was taken against. A clean form re-bases
   * when the stored version moves away from it, which covers a refresh that
   * arrives while the form is clean and one that arrived while it was dirty
   * and is adopted the moment the operator's work is gone.
   */
  readonly seen: number;
}

function shallowDiffers<V>(values: V, baseline: V): boolean {
  if (Object.is(values, baseline)) return false;
  if (
    typeof values !== 'object' ||
    values === null ||
    typeof baseline !== 'object' ||
    baseline === null
  ) {
    return true;
  }
  const a = values as Record<string, unknown>;
  const b = baseline as Record<string, unknown>;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!Object.is(a[key], b[key])) return true;
  }
  return false;
}

export function useEditBaseline<V>(options: EditBaselineOptions<V>): EditBaseline<V> {
  const { stored, storedVersion, pending = false } = options;
  const differs = options.differs ?? shallowDiffers;
  const [held, setHeld] = useState<Held<V>>(() => ({
    values: stored,
    baseline: stored,
    version: storedVersion,
    seen: storedVersion,
  }));

  let current = held;
  const dirtyNow = pending || differs(current.values, current.baseline);
  if (!dirtyNow && storedVersion !== current.seen) {
    /*
     * A clean form follows the record: adjusted during render, React's shape
     * for "reset state when a prop changes", so the stale values are never
     * painted.
     */
    current = { values: stored, baseline: stored, version: storedVersion, seen: storedVersion };
    setHeld(current);
  }

  const setValues: Dispatch<SetStateAction<V>> = (next) =>
    setHeld((was) => ({
      ...was,
      values: typeof next === 'function' ? (next as (prev: V) => V)(was.values) : next,
    }));

  return {
    values: current.values,
    setValues,
    baseline: current.baseline,
    version: current.version,
    dirty: pending || differs(current.values, current.baseline),
    discard: (storedNow = stored) =>
      setHeld({
        values: storedNow,
        baseline: storedNow,
        version: storedVersion,
        seen: storedVersion,
      }),
    rebase: (values, version) =>
      setHeld((was) =>
        version === undefined
          ? // The answer did not carry the new version: the refresh brings it.
            { values, baseline: values, version: was.version, seen: was.seen }
          : { values, baseline: values, version, seen: storedVersion }
      ),
  };
}
