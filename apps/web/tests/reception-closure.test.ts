import { describe, expect, it } from 'vitest';
import {
  CUSTOMER_REPORTED_KINDS,
  closureReasonProblem,
  conflictKindOf,
  hasEdge,
  hasRegisteredMedia,
  isCustomerReported,
  nextVersionAfter,
  receptionAffordances,
  reaches,
  unknownStatuses,
} from '@/features/receptions/check-in/closure';
import {
  EVIDENCE_KINDS,
  MAX_CLOSURE_REASON,
  RECEPTION_STATUSES,
  RECEPTION_TRANSITIONS,
  TERMINAL_RECEPTION_STATUSES,
  canApprove,
  canClose,
  canConvert,
} from '@/features/receptions/receptions-contract';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

/**
 * The closure rules (`P1-28-FE-020`/`FE-022`), as decided rather than as drawn.
 *
 * ## Every case iterates the frozen vocabulary, never a hand list
 *
 * `RECEPTION_STATUSES` and `EVIDENCE_KINDS` mirror frozen CHECK constraints. A
 * case that named three statuses would pass forever while a fourth went
 * unhandled — the defect class this phase keeps meeting. So the loops are over
 * the vocabularies themselves, and `unknownStatuses` is asserted empty so a
 * vocabulary that grew a member this module has never been asked about fails
 * here rather than in an operator's hands.
 *
 * ## The derivation is checked against the graph by a SECOND route
 *
 * A test that recomputed `receptionAffordances` the same way it is implemented
 * would assert nothing. Each expectation below is taken from
 * `RECEPTION_TRANSITIONS` directly — direct edge membership — and the approval
 * case is cross-checked against the contract's own `canApprove`, which states
 * the same rule as a literal. Two independent statements of one truth, held
 * against each other.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

describe('the transition graph is what the affordances are read from', () => {
  it('knows every status in the frozen vocabulary', () => {
    expect(unknownStatuses(RECEPTION_STATUSES)).toEqual([]);
    // Anti-vacuity: a vocabulary of one would make every loop below trivial.
    expect(RECEPTION_STATUSES.length).toBeGreaterThan(4);
  });

  it('offers each terminal exit exactly where the graph has that edge', () => {
    for (const status of RECEPTION_STATUSES) {
      const affordances = receptionAffordances(status);
      expect(affordances.closeWithoutWork, status).toBe(
        RECEPTION_TRANSITIONS[status]?.includes('closed_without_work') ?? false
      );
      expect(affordances.refuse, status).toBe(
        RECEPTION_TRANSITIONS[status]?.includes('refused') ?? false
      );
    }
  });

  it('agrees with the contract about both exits and the conversion', () => {
    for (const status of RECEPTION_STATUSES) {
      const affordances = receptionAffordances(status);
      // `canClose` is the contract's own statement of the same rule.
      expect(affordances.closeWithoutWork, status).toBe(canClose(status));
      expect(affordances.refuse, status).toBe(canClose(status));
      expect(affordances.convert, status).toBe(canConvert(status));
    }
  });

  it('treats approval as REACHABILITY, because approve can walk two edges', () => {
    for (const status of RECEPTION_STATUSES) {
      expect(receptionAffordances(status).approve, status).toBe(canApprove(status));
    }
    // The distinction that makes it reachability and not an edge: `opened` has
    // no direct edge to `authorized`, and approve is still legal from it.
    expect(hasEdge('opened', 'authorized')).toBe(false);
    expect(reaches('opened', 'authorized')).toBe(true);
    expect(receptionAffordances('opened').approve).toBe(true);
  });

  it('refuses every command from every terminal status', () => {
    for (const status of TERMINAL_RECEPTION_STATUSES) {
      expect(receptionAffordances(status), status).toEqual({
        approve: false,
        convert: false,
        closeWithoutWork: false,
        refuse: false,
      });
    }
  });

  it('does not report a status as reaching itself without an edge', () => {
    // `reaches` walks at least one edge, so a terminal state does not "reach"
    // the state it already is — which is what keeps the approve affordance off
    // an `authorized` visit, whose re-approval is 409 ERR-TRN-001.
    expect(reaches('authorized', 'authorized')).toBe(false);
    expect(receptionAffordances('authorized').approve).toBe(false);
  });
});

describe('the mandatory closure reason', () => {
  it('refuses nothing and whitespace, naming a translated key', () => {
    for (const value of ['', '   ', '\n\t ']) {
      const problem = closureReasonProblem(value);
      expect(problem, JSON.stringify(value)).toBe('receptions.closure.error.reasonRequired');
      expect(EN[problem as string]).toBeTruthy();
      expect(AR[problem as string]).toBeTruthy();
    }
  });

  it('bounds it at the route’s own limit and not one character earlier', () => {
    expect(closureReasonProblem('x'.repeat(MAX_CLOSURE_REASON))).toBeNull();
    const problem = closureReasonProblem('x'.repeat(MAX_CLOSURE_REASON + 1));
    expect(problem).toBe('receptions.closure.error.reasonTooLong');
    expect(EN[problem as string]).toBeTruthy();
    expect(AR[problem as string]).toBeTruthy();
  });

  it('measures the TRIMMED value, as the adapter does', () => {
    // `closeSchema` trims before bounding. A reason of surrounding spaces is
    // empty to the backend, so it must be empty here too.
    expect(closureReasonProblem('  abandoned by the customer  ')).toBeNull();
    expect(closureReasonProblem(` ${'x'.repeat(MAX_CLOSURE_REASON)} `)).toBeNull();
  });
});

describe('the two 409s a guarded command can meet', () => {
  it('reads a version conflict as stale and everything else as blocked', () => {
    // `failureMessageKey` returns `state.conflict.title` for ERR-CON-001 alone.
    expect(conflictKindOf('state.conflict.title')).toBe('stale');
    expect(conflictKindOf('state.conflict.blocked.title')).toBe('blocked');
    expect(conflictKindOf(undefined)).toBe('blocked');
  });

  it('fails CLOSED: an unrecognised key is blocked, never stale', () => {
    // Getting this backwards would invite a retry against a state that refuses
    // the command, which is the ERR-TRN-001 loop this distinction exists to
    // prevent.
    for (const key of ['', 'something.else', 'state.conflict', 'action.failed']) {
      expect(conflictKindOf(key), key).toBe('blocked');
    }
  });
});

describe('the version after approve', () => {
  it('is the answer, whether the command applied one edge or two', () => {
    // From `inspecting`: one edge, sent + 1. From `opened`: two edges in one
    // transaction, sent + 2. Both are the response's own number, and a screen
    // computing either would be wrong for the other.
    expect(nextVersionAfter(7, 8)).toBe(8);
    expect(nextVersionAfter(7, 9)).toBe(9);
  });

  it('does not invent a version the backend did not state', () => {
    // A shape nobody predicts — the response is still the truth.
    expect(nextVersionAfter(4, 4)).toBe(4);
    expect(nextVersionAfter(4, 41)).toBe(41);
  });
});

describe('a customer’s concern is not a technical finding', () => {
  it('classifies every evidence kind in the frozen vocabulary', () => {
    for (const kind of EVIDENCE_KINDS) {
      expect(typeof isCustomerReported(kind), kind).toBe('boolean');
    }
    // Exactly one kind carries the customer's own report; the other seven are
    // observations staff made at reception.
    const reported = EVIDENCE_KINDS.filter(isCustomerReported);
    expect(reported).toEqual(['complaint']);
    expect(CUSTOMER_REPORTED_KINDS).toEqual(['complaint']);
  });

  it('has the "not yet technically verified" sentence in BOTH catalogues', () => {
    for (const key of [
      'receptions.summary.notVerified',
      'receptions.summary.customerReported',
      'receptions.summary.staffObserved',
      'receptions.summary.complaintWordsRestricted',
    ]) {
      expect(EN[key], `${key} missing from en`).toBeTruthy();
      expect(AR[key], `${key} missing from ar`).toBeTruthy();
      // Real Arabic, not an English string copied across.
      expect(/[؀-ۿ]/.test(AR[key] as string), `${key} carries no Arabic`).toBe(true);
    }
  });
});

describe('media is registered and pending, never uploaded', () => {
  it('reads a document reference as registered media and nothing else as media', () => {
    expect(hasRegisteredMedia('11111111-1111-4111-8111-111111111111')).toBe(true);
    for (const value of [null, undefined, '', 0, false, {}]) {
      expect(hasRegisteredMedia(value), JSON.stringify(value ?? null)).toBe(false);
    }
  });

  it('says "registered, pending" in both catalogues', () => {
    const key = 'receptions.summary.mediaRegistered';
    expect(EN[key]).toContain('registered');
    expect(EN[key]).toContain('pending');
    expect(/[؀-ۿ]/.test(AR[key] as string)).toBe(true);
  });

  it('lets no reception string claim an upload, in either language', () => {
    /*
     * `P1-OD-025` is open: no upload path exists in this phase. The ONE place
     * either catalogue mentions uploading is `vehicles.media.blocked`, and it
     * mentions it to DENY it ("nothing is uploaded or stored until it is
     * made") — a denial is the opposite of the claim this guards against, so
     * the sweep is over the reception namespace, where a claim would be one.
     */
    for (const [catalogue, name] of [
      [EN, 'en'],
      [AR, 'ar'],
    ] as const) {
      const claims = Object.entries(catalogue)
        .filter(([entry]) => entry.startsWith('receptions.'))
        .filter(([, value]) => /\bupload(ed|ing|s)?\b|\bرفع\b|\bمرفوع/i.test(String(value)));
      expect(
        claims.map(([entry]) => entry),
        `${name} claims an upload`
      ).toEqual([]);
    }

    // Anti-vacuity: the sweep really looked at the reception namespace.
    expect(Object.keys(EN).filter((key) => key.startsWith('receptions.')).length).toBeGreaterThan(
      100
    );
  });
});
