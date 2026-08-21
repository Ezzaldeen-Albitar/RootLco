import { describe, expect, it } from 'vitest';
import {
  canPage,
  hasFurtherPage,
  membershipVerdict,
  readCompleteness,
} from '@/components/data-table/read-completeness';
import type { TableStatus } from '@/components/data-table/DataTable';

/**
 * The completeness primitive, driven at every corner of the real contract.
 *
 * ## Why a page number is half the question
 *
 * `readCompleteness` answers ONE thing — may an absence found in the rows in
 * hand be stated as a fact about the whole set? Its first form asked only
 * `hasMore`, which is a fact about what lies AHEAD of the page in hand and says
 * nothing about what lies behind it. On the last page of a five-page read the
 * server correctly publishes `hasMore: false`, and the old derivation read that
 * as "the set was covered" while four pages of it had scrolled out of view.
 *
 * That is not hypothetical. Every screen the truncation repair touched renders a
 * `CursorPager` beside its notice, so the operator is INVITED to move, and one
 * click restored the exact sentences the repair removed: the custody default
 * withdrawn as an established ineligibility, the finding gate stating the visit
 * has no open inspection, the handoff notice dropping a pre-selected vehicle.
 *
 * `use-cursor-pages.ts` states the model this is derived from: pages are walked
 * in order from page one, no page can be jumped to, and only a walk from page
 * one to a page reporting `hasMore: false` has observed the whole set. A caller
 * standing anywhere else holds a WINDOW.
 *
 * The corners are a table rather than four hand-written cases because the defect
 * was precisely that one corner of it was unreachable by any fixture.
 */
const IDLE: TableStatus = 'idle';

describe('readCompleteness — the page number is half the question', () => {
  const CORNERS = [
    {
      page: 1,
      hasMore: false,
      verdict: 'complete' as const,
      why: 'page one reporting nothing further IS the whole set',
    },
    {
      page: 1,
      hasMore: true,
      verdict: 'truncated' as const,
      why: 'the server says rows exist beyond this page',
    },
    {
      page: 2,
      hasMore: false,
      verdict: 'truncated' as const,
      why: 'the last page of a walk is still a window: page one is not in hand',
    },
    {
      page: 2,
      hasMore: true,
      verdict: 'truncated' as const,
      why: 'unread in both directions',
    },
  ];

  for (const corner of CORNERS) {
    it(`page ${corner.page} + hasMore ${corner.hasMore} -> ${corner.verdict}`, () => {
      expect(readCompleteness(IDLE, corner.hasMore, corner.page), corner.why).toBe(corner.verdict);
    });
  }

  it('reports pending while the read is in flight, on any page', () => {
    for (const page of [1, 2, 7]) {
      expect(readCompleteness('loading', undefined, page)).toBe('pending');
      expect(readCompleteness('loading', false, page)).toBe('pending');
    }
  });

  it('reports unreadable for every non-idle settled status, on any page', () => {
    for (const status of ['error', 'denied', 'expired', 'unavailable'] as TableStatus[]) {
      expect(readCompleteness(status, false, 1)).toBe('unreadable');
      expect(readCompleteness(status, false, 3)).toBe('unreadable');
    }
  });

  it('never calls an undefined hasMore complete beyond page one', () => {
    // `useServerTable` hands `response: null` on every non-ok page, so
    // `response?.hasMore` is `undefined` exactly where trusting `false` is the bug.
    expect(readCompleteness(IDLE, undefined, 1)).toBe('complete');
    expect(readCompleteness(IDLE, undefined, 2)).toBe('truncated');
  });
});

describe('hasFurtherPage — a DIFFERENT question from set completeness', () => {
  /*
   * Splitting the two apart is the repair. A pager asks "is there a page after
   * this one", which is `hasMore` and nothing else; a notice asks "did I see the
   * set", which needs the page number too. Answering both from one value is what
   * made page two truncated AND pageable-forward in the same breath, which would
   * have left a Next button enabled at the end of a list.
   */
  it('is exactly the settled hasMore, independent of the page', () => {
    expect(hasFurtherPage(IDLE, true)).toBe(true);
    expect(hasFurtherPage(IDLE, false)).toBe(false);
    expect(hasFurtherPage(IDLE, undefined)).toBe(false);
    expect(hasFurtherPage('loading', true)).toBe(false);
    expect(hasFurtherPage('error', true)).toBe(false);
  });

  it('disagrees with readCompleteness on the last page of a walk', () => {
    expect(readCompleteness(IDLE, false, 2)).toBe('truncated');
    expect(hasFurtherPage(IDLE, false)).toBe(false);
  });
});

describe('canPage — a truncation notice always has somewhere to go', () => {
  it('offers the pager on page one only when more exists', () => {
    expect(canPage(1, IDLE, false)).toBe(false);
    expect(canPage(1, IDLE, true)).toBe(true);
  });

  it('always offers it past page one, so the walk can be undone', () => {
    expect(canPage(2, IDLE, false)).toBe(true);
    expect(canPage(2, 'error', false)).toBe(true);
  });
});

describe('membershipVerdict — presence survives truncation, absence does not', () => {
  const ROWS = [{ id: 'a' }, { id: 'b' }];
  const is = (id: string) => (row: { id: string }) => row.id === id;

  it('calls a found row present on any page and any status', () => {
    expect(membershipVerdict(IDLE, { rows: ROWS, hasMore: true }, is('a'), 1)).toBe('present');
    expect(membershipVerdict(IDLE, { rows: ROWS, hasMore: false }, is('a'), 4)).toBe('present');
  });

  it('calls an absence absent ONLY from a page-one read that covered the set', () => {
    expect(membershipVerdict(IDLE, { rows: ROWS, hasMore: false }, is('z'), 1)).toBe('absent');
  });

  it('refuses to call it absent from page two — the defect, stated as a case', () => {
    /*
     * The reproducer in prose: a customer's twenty-sixth vehicle is handed over,
     * the operator clicks Next to look at the rest of the list, and page two
     * reports `hasMore: false`. The row IS in the set and IS the pre-selection;
     * calling it `absent` printed "that vehicle is not in this customer's list"
     * and dropped the selection the operator arrived with.
     */
    expect(membershipVerdict(IDLE, { rows: ROWS, hasMore: false }, is('z'), 2)).toBe(
      'unknown-truncated'
    );
  });

  it('separates a truncated page from a failed read and from one in flight', () => {
    expect(membershipVerdict(IDLE, { rows: ROWS, hasMore: true }, is('z'), 1)).toBe(
      'unknown-truncated'
    );
    expect(membershipVerdict('error', null, is('z'), 1)).toBe('unknown-unreadable');
    expect(membershipVerdict('loading', null, is('z'), 1)).toBe('pending');
  });
});
