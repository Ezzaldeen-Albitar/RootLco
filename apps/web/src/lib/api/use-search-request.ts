'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TableStatus } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, withPage, type TableRequest } from '@/components/data-table/table-state';
import { useCursorPages, type CursorPages } from '@/components/data-table/use-cursor-pages';
import type { ServerTable } from '@/components/data-table/use-server-table';
import { SEARCH_DEBOUNCE_MS, useDebouncedValue } from '../use-debounced-value';
import type { CursorPage, ReadState } from './read-operation';

/**
 * One search, run as the operator types, with the previous one abandoned.
 *
 * ## The three failures this closes, in order of how often they bite
 *
 * 1. **A superseded answer winning.** Type "Kha", type "Khal": the first read
 *    is slower and lands second, and the operator watches results for a term
 *    they have already finished replacing. A cancelled flag per effect is not
 *    enough on its own — an effect that has been cleaned up can still be racing
 *    a sibling — so every request carries a SEQUENCE number and only the latest
 *    may commit.
 * 2. **Every failure looking the same.** A refusal, an outage and a genuinely
 *    empty result are three different sentences with three different next
 *    steps, and a hook that returns `rows: []` for all three forces the screen
 *    to render "no matches" over a permission failure.
 * 3. **"No results" shown before there is an answer.** `empty` is reached only
 *    from a COMPLETED read that returned no rows. There is no state in which an
 *    in-flight request renders as an absence.
 *
 * ## Paging is the backend's, not this hook's
 *
 * The operations behind these screens paginate by CURSOR and publish no count.
 * An operator still thinks in pages and still presses Previous, so the cursor
 * that OPENED each visited page is kept — page one's is `null`, page N's is the
 * `nextCursor` page N−1 returned — and going back is one request with a cursor
 * already in hand rather than a walk from the start.
 *
 * `useCursorPages` already owns that bookkeeping for `useServerTable`, and it
 * is reused rather than reimplemented: two copies of cursor arithmetic is two
 * chances to get the off-by-one wrong in different ways.
 *
 * The stack is thrown away whenever the CRITERIA, an explicit submission or the
 * working-branch version changes, and the page returns to one. A cursor is
 * issued against an ordering contract; spending one from a previous contract
 * returns a window of a set that no longer exists, and those rows look entirely
 * plausible. The same key that resets the stack is part of what a held answer
 * is filed under, so a late response for an older criteria-and-cursor pair
 * cannot be committed even if it arrives after the reset.
 *
 * ## What `signal` can and cannot do here
 *
 * Every read in this application goes through a Server Action, because the
 * bearer token lives in a cookie the browser cannot read. A Server Action call
 * cannot carry an `AbortSignal` across the boundary, so aborting does not stop
 * the work the server has already started — what it does, reliably, is
 * guarantee that a superseded answer is DISCARDED rather than rendered, and
 * give a loader that does reach a real `fetch` (anything under `src/lib/api`)
 * something to pass on. Both halves are stated because the weaker one is the
 * one a reader would otherwise assume.
 */

export type SearchPhase =
  /** Nothing has been asked for. No request has been made. */
  | 'idle'
  /** A request is in flight, or a keystroke has not settled yet. */
  | 'loading'
  /** Answered, with rows. */
  | 'ready'
  /** Answered, with none. Only ever reached from a completed read. */
  | 'empty'
  /** Could not be reached, timed out, or was throttled. Worth retrying. */
  | 'unavailable'
  /** The caller may not read this. Retrying cannot change it. */
  | 'refused'
  /** Anything else, including an ended session. */
  | 'failed';

export interface SearchOutcome<Row> {
  readonly phase: SearchPhase;
  readonly rows: readonly Row[];
  /** The whole page, for a screen that pages. Null until a read succeeds. */
  readonly page: CursorPage<Row> | null;
  /** A translation KEY, never server prose. Null unless the phase is a failure. */
  readonly error: string | null;
  readonly correlationId: string | null;
}

export interface SearchResult<Row> extends SearchOutcome<Row> {
  /** The page in hand, counting from one. */
  readonly pageNumber: number;
  /** The server's own end-of-set signal. False until a read has answered. */
  readonly hasMore: boolean;
  /** Moves forward one page. Does nothing when the server says there is none. */
  readonly next: () => void;
  /** Moves back one page, using the cursor that opened it. */
  readonly previous: () => void;
  /**
   * The same read, in the shape `DataTable` and `CursorPager` already speak.
   *
   * Offered so a screen can swap `useServerTable` for this hook without
   * rewriting its table, its pager or its assertions — the two differ in how
   * the request is DECIDED (settled, submitted, abandoned) and not at all in
   * what a page of rows is.
   */
  readonly table: ServerTable<Row>;
  /**
   * Ask NOW, without waiting for the term to settle.
   *
   * Enter and the Search control are statements of intent, and making an
   * operator who has already decided wait out a 300 ms timer is the interface
   * being slower than the person using it. Calling it twice with the same term
   * re-issues, which is what makes it usable as a retry.
   */
  readonly submit: () => void;
}

const IDLE: SearchOutcome<never> = {
  phase: 'idle',
  rows: [],
  page: null,
  error: null,
  correlationId: null,
};

/**
 * How a read outcome becomes a phase.
 *
 * `expired` is `failed` rather than `unavailable` on purpose: the two differ in
 * what the operator must do next, and offering "try again" to somebody whose
 * session has ended is offering a button that cannot work.
 */
function outcomeOf<Row>(state: ReadState<CursorPage<Row>>): SearchOutcome<Row> {
  if (state.status === 'ok') {
    return {
      phase: state.data.items.length === 0 ? 'empty' : 'ready',
      rows: state.data.items,
      page: state.data,
      error: null,
      correlationId: state.correlationId,
    };
  }
  const phase: SearchPhase =
    state.status === 'denied'
      ? 'refused'
      : state.status === 'unavailable'
        ? 'unavailable'
        : 'failed';
  const error =
    state.status === 'denied'
      ? 'state.denied.title'
      : state.status === 'expired'
        ? 'state.expired.message'
        : state.status === 'not-found'
          ? 'state.notFound.title'
          : state.status === 'unavailable'
            ? 'state.unavailable.title'
            : 'state.error.title';
  return { phase, rows: [], page: null, error, correlationId: state.correlationId };
}

export function useSearchRequest<Row, Criteria>(options: {
  /**
   * What to ask for, or `null` for "nothing yet".
   *
   * `null` is how a screen says the operator has not expressed an intent — a
   * box with fewer characters than the backend accepts, or a form that has not
   * been touched. No request is made and the phase stays `idle`, which is what
   * makes "no request before intent" a property of this hook rather than
   * something every screen has to remember.
   */
  readonly criteria: Criteria | null;
  /**
   * One page of the read.
   *
   * `cursor` is `null` for the first page and otherwise the `nextCursor` the
   * previous page returned — the same contract `useServerTable` hands its
   * loader, so an adapter written for one works unchanged with the other.
   */
  readonly load: (
    criteria: Criteria,
    cursor: string | null,
    signal: AbortSignal
  ) => Promise<ReadState<CursorPage<Row>>>;
  /**
   * Anything outside the criteria that changes what the answer means — the
   * working-context version above all. A branch change abandons the read in
   * flight AND bypasses the debounce, so the first read after a switch is for
   * the branch that is now selected rather than for the one the settled key
   * still remembers.
   */
  readonly version?: number;
  readonly debounceMs?: number;
}): SearchResult<Row> {
  const { criteria, load, version = 0, debounceMs = SEARCH_DEBOUNCE_MS } = options;

  /*
   * The criteria, serialised.
   *
   * A screen builds its criteria inline, so the OBJECT is new on every render
   * and is useless as an effect key. Its content is not: two objects that
   * serialise the same ask for the same thing. It follows that criteria must be
   * JSON-serialisable, which they already are — every one of them becomes query
   * parameters.
   */
  const key = criteria === null ? null : JSON.stringify(criteria);
  const settledKey = useDebouncedValue(key, debounceMs);

  /*
   * An explicit submission skips the wait.
   *
   * `forced.key` is the term the operator submitted. While the box still holds
   * that term the settled value is bypassed; the moment they type again the key
   * moves on and the debounce takes over. `nonce` is what lets the same term be
   * submitted twice — pressing Search again on a failed read has to re-issue.
   */
  const [forced, setForced] = useState<{ readonly key: string; readonly nonce: number } | null>(
    null
  );

  /* The held answer, declared here because the version adjustment below drops it. */
  const [held, setHeld] = useState<{
    readonly key: string;
    readonly outcome: SearchOutcome<Row>;
  } | null>(null);

  /*
   * A WORKING-CONTEXT CHANGE IS AN EXPLICIT SUBMISSION, and this is the defect
   * that made it one.
   *
   * `version` was part of the request key and `activeKey` was the DEBOUNCED
   * one, so the two moved on different clocks. A branch changed in the header
   * produced new criteria immediately — the screens derive their scope during
   * render — while `settledKey` still held the previous branch's criteria for
   * up to 300 ms. The key that went out was therefore the OLD branch's criteria
   * at the NEW version: one whole read issued for the branch the operator had
   * just left, answered, and rendered under the new branch's heading. Worse
   * than a stale list, and the exact failure the version was added to prevent.
   *
   * A switch is an intent, not a keystroke, so it is treated as a submission of
   * whatever the criteria are NOW: the debounce is bypassed, the nonce moves so
   * an identical ask still re-issues, and the held answer is dropped rather
   * than left to be filtered out by its key.
   *
   * The request already IN FLIGHT needs nothing here. The read effect is keyed
   * on the wanted key, the version is part of it, so the effect is torn down
   * and its cleanup aborts the previous controller — and the continuation
   * refuses to commit on an aborted signal. Bumping the sequence as well would
   * be writing a ref during render for a guarantee the abort already gives.
   *
   * Adjusted DURING render — React's documented shape for "reset state when an
   * input changes". An effect would paint one frame of the previous branch's
   * request first, which is the thing being fixed.
   */
  const [lastVersion, setLastVersion] = useState(version);
  if (version !== lastVersion) {
    setLastVersion(version);
    setHeld(null);
    if (key === null) setForced(null);
    else setForced((previous) => ({ key, nonce: (previous?.nonce ?? 0) + 1 }));
  }

  const submitted = forced !== null && forced.key === key;
  const activeKey = submitted ? key : settledKey;
  const wanted =
    activeKey === null ? null : `${activeKey}#${version}#${submitted ? forced.nonce : 0}`;

  const submit = useCallback(() => {
    if (key === null) return;
    setForced((previous) => ({ key, nonce: (previous?.nonce ?? 0) + 1 }));
  }, [key]);

  /*
   * The criteria that produced each key, and the latest loader.
   *
   * The loader is here for the ordinary reason: it is a new function on every
   * render and would re-read on every render if it were a dependency, and
   * excluding it with a suppression would be a suppression.
   *
   * The criteria are here for a sharper reason. While the debounce lags, the
   * key being fetched is the SETTLED one and `criteria` is already the newer
   * object — so reading the current criteria at issue time fetched one thing
   * and filed the answer under the name of another. The rows would then be
   * shown the moment the debounce caught up, as if they had been read for the
   * newer term. The map hands back the criteria that the key actually names, so
   * what is fetched and what it is filed under cannot come apart.
   *
   * Bounded, because a search box generates a key per keystroke and this must
   * not grow with the session.
   */
  const box = useRef<{
    load: typeof load;
    seen: Map<string, Criteria>;
    cursors: CursorPages | null;
  }>({ load, seen: new Map(), cursors: null });
  useEffect(() => {
    box.current.load = load;
    if (key === null || criteria === null) return;
    const seen = box.current.seen;
    seen.set(key, criteria);
    while (seen.size > 8) {
      const oldest = seen.keys().next().value;
      if (oldest === undefined) break;
      seen.delete(oldest);
    }
  });

  /*
   * The ordering contract: everything that invalidates every held cursor.
   *
   * The criteria, the working-branch version and the submission nonce. A page
   * number is NOT part of it — walking to page two must not throw away the
   * cursor that got there.
   */
  const ordering = `${activeKey ?? ''}#${version}#${submitted ? forced.nonce : 0}`;
  const cursors = useCursorPages(ordering);
  /*
   * The cursor stack joins the box for the same reason the loader did.
   *
   * Its identity changes every time a cursor is remembered — which happens as a
   * RESULT of the read below — so listing it as a dependency re-runs the read
   * that produced it, for ever. `use-server-table.ts` reaches the same place and
   * silences the rule; carrying it through the box that already exists here
   * states the same thing without a suppression. The refreshing effect is
   * declared FIRST, and React runs effects in declaration order after a commit,
   * so the read always sees the stack belonging to its own render.
   */
  useEffect(() => {
    box.current.cursors = cursors;
  });

  const [pageNumber, setPageNumber] = useState(1);
  const [lastOrdering, setLastOrdering] = useState(ordering);
  /*
   * Back to page one when the contract changes, adjusted DURING render.
   *
   * `useCursorPages` resets its own stack on the same key, and this is the
   * other half of that reset: `use-server-table.ts` records what happens when
   * only one of the two moves — the stack goes back to `[null]` while the page
   * number stays where it was, so `cursorFor(2)` returns null, page two is read
   * with the START cursor, and the pager is permanently out by one for that
   * filter. Both halves, or neither.
   */
  if (ordering !== lastOrdering) {
    setLastOrdering(ordering);
    if (pageNumber !== 1) setPageNumber(1);
  }

  const wantedPage = ordering === lastOrdering ? pageNumber : 1;
  const wantedKey = wanted === null ? null : `${wanted}#${wantedPage}`;

  const sequence = useRef(0);

  useEffect(() => {
    if (wantedKey === null || activeKey === null) return undefined;
    const asked = box.current.seen.get(activeKey);
    if (asked === undefined) return undefined;
    const stack = box.current.cursors;
    if (stack === null) return undefined;
    const cursor = stack.cursorFor(wantedPage);
    const controller = new AbortController();
    sequence.current += 1;
    const mine = sequence.current;
    void (async () => {
      // Awaited before any state write, so nothing here is a synchronous
      // setState inside an effect body.
      const state = await box.current.load(asked, cursor, controller.signal);
      // Two guards, not one. The abort covers this effect being cleaned up; the
      // sequence covers a slower SIBLING request that was started earlier and is
      // still in flight. The key carries the criteria AND the page, so a late
      // answer for an older pair cannot be shown under a newer one.
      if (controller.signal.aborted || mine !== sequence.current) return;
      const outcome = outcomeOf(state);
      setHeld({ key: wantedKey, outcome });
      if (outcome.page !== null) stack.remember(wantedPage, outcome.page.nextCursor);
    })();
    return () => controller.abort();
  }, [wantedKey, activeKey, wantedPage]);

  const outcome = useMemo<SearchOutcome<Row>>(() => {
    if (wantedKey === null) return IDLE as SearchOutcome<Row>;
    // Loading is DERIVED — "what I am holding is not what I want" — rather than
    // written at the top of the effect, which would cascade a render on every
    // keystroke and is what `react-hooks/set-state-in-effect` exists to catch.
    if (held === null || held.key !== wantedKey) {
      return { phase: 'loading', rows: [], page: null, error: null, correlationId: null };
    }
    return held.outcome;
  }, [wantedKey, held]);

  const hasMore = outcome.page?.hasMore ?? false;

  const next = useCallback(() => {
    setPageNumber((current) => current + 1);
  }, []);
  const previous = useCallback(() => {
    setPageNumber((current) => (current > 1 ? current - 1 : current));
  }, []);

  /*
   * `TableStatus` and `SearchPhase` say the same six things in different words.
   *
   * `idle` and `empty` both map to the table's `idle` — an answered read — and
   * the ZERO-ROW case is the table's to render or the screen's to suppress,
   * exactly as it was under `useServerTable`.
   */
  const status: TableStatus =
    outcome.phase === 'idle' || outcome.phase === 'loading'
      ? 'loading'
      : outcome.phase === 'refused'
        ? 'denied'
        : outcome.phase === 'unavailable'
          ? 'unavailable'
          : outcome.phase === 'failed'
            ? outcome.error === 'state.expired.message'
              ? 'expired'
              : outcome.error === 'state.notFound.title'
                ? 'not-found'
                : 'error'
            : 'idle';

  const request: TableRequest = useMemo(() => withPage(INITIAL_REQUEST, wantedPage), [wantedPage]);

  const table: ServerTable<Row> = useMemo(
    () => ({
      request,
      // Only the PAGE is a request parameter here. Sorting and filtering are the
      // screen's own criteria, and a table control that changed them behind the
      // screen's back would put the two out of step.
      setRequest: (nextRequest) => setPageNumber(Math.max(1, nextRequest.page)),
      response:
        outcome.phase === 'ready' || outcome.phase === 'empty'
          ? {
              rows: outcome.rows,
              // Never invented. These operations publish `hasMore` and no count.
              total: null,
              page: wantedPage,
              pageSize: request.pageSize,
              hasMore,
            }
          : null,
      status,
      correlationId: outcome.correlationId ?? undefined,
      refresh: submit,
    }),
    [request, outcome, wantedPage, hasMore, status, submit]
  );

  return { ...outcome, submit, pageNumber: wantedPage, hasMore, next, previous, table };
}
