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
  ACCEPTED_VERSION_STATUS,
  DOCUMENT_VERSION_STATUSES,
} from '@/features/attachments/attachments-contract';
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

type Catalogue = 'en' | 'ar';

const CATALOGUES: readonly (readonly [Record<string, string>, Catalogue])[] = [
  [EN, 'en'],
  [AR, 'ar'],
];

/** Words that assert a version HAS become finalized evidence. */
const ACCEPTANCE: Record<Catalogue, (value: string) => boolean> = {
  en: (value) =>
    /\b(accepted|satisfied|counted|met|complete[d]?|final(ised|ized)?|verified)\b/i.test(value),
  ar: (value) =>
    ['مقبول', 'مستوفى', 'محتسَب', 'محتسب', 'مكتمل', 'نهائي', 'موثَّق'].some((word) =>
      value.includes(word)
    ),
};

/** Words that assert the FILE exists — legitimate, and what the old ban forbade. */
const ON_FILE: Record<Catalogue, (value: string) => boolean> = {
  en: (value) => /\b(upload(ed|ing|s)?|record(ed)?|stored|attached|on file)\b/i.test(value),
  ar: (value) =>
    ['مرفوع', 'رفع', 'سُجِّل', 'مسجَّل', 'مخزَّن'].some((word) => value.includes(word)),
};

/** The denial that stops "the file is here" from reading as "this is met". */
const DENIAL: Record<Catalogue, (value: string) => boolean> = {
  en: (value) => /\b(not|no|nothing|never|yet|until|cannot)\b/i.test(value),
  ar: (value) => ['لم', 'لا', 'ليس', 'غير', 'بعد'].some((word) => value.includes(word)),
};

/**
 * The vocabulary a version's lifecycle is named in, per language.
 *
 * The English half is built FROM `DOCUMENT_VERSION_STATUSES`, because the status
 * tokens are themselves the English words a screen would reach for, and then
 * widened by the three the catalogue actually renders for the states whose copy
 * avoids its token ("checked", "withheld", "refused"). The Arabic half cannot be
 * derived that way — the tokens are English — so it is listed, and the case
 * below proves both halves by requiring each to match all five labels.
 */
const LIFECYCLE: Record<Catalogue, (value: string) => boolean> = {
  en: (value) =>
    new RegExp(
      `\\b(${[...DOCUMENT_VERSION_STATUSES, 'checked', 'withheld', 'refused'].join('|')})\\b`,
      'i'
    ).test(value),
  ar: (value) =>
    ['مقبول', 'مرفوض', 'محجوز', 'يُفحص', 'قيد', 'انتظار'].some((word) => value.includes(word)),
};

/**
 * What is wrong with one capture label, or `null` when nothing is.
 *
 * A function rather than four inline assertions, so the one rule reaches the
 * real catalogues, a planted breach it must reject, and a compliant form it must
 * accept — the three applications this repository asks of a universal rule.
 */
function capturePhraseProblem(
  value: string,
  catalogue: Catalogue,
  assertsAcceptance: boolean
): string | null {
  const asserts = ACCEPTANCE[catalogue](value);
  if (asserts !== assertsAcceptance) {
    return asserts
      ? 'calls a version that is not accepted finalized evidence'
      : 'does not say the version was accepted';
  }
  if (!assertsAcceptance && ON_FILE[catalogue](value) && !DENIAL[catalogue](value)) {
    return 'says the file is on record without denying that it counts';
  }
  return null;
}

/**
 * A file may be on record without being evidence (`P1-OD-025`, RESOLVED).
 *
 * ## What replaced a ban on the word "upload"
 *
 * This block used to assert that no string under `receptions.` mentioned
 * uploading, because no upload path existed. One does now, and the ban had
 * become a ban on an honest sentence: `receptions.capture.version.pending` reads
 * "Uploaded, not yet checked", and every word of it is true. What has to hold
 * instead is the Owner decision itself — a file may be described as being on
 * record, but a requirement is satisfied ONLY by a finalized ACCEPTED version
 * (`ACCEPTED_VERSION_STATUS`; `evidence-capture.ts` finalizes on nothing else).
 * So no label may describe a pending, scanning, quarantined or rejected version
 * as accepted, counted, satisfied, final or complete, and a label that says the
 * file is on record must deny in the same breath that it counts.
 *
 * ## Why the sweep is over LABELS and not over the namespace
 *
 * A vocabulary check cannot tell `accepted` in a claim from `accepted` in a
 * denial: `receptions.capture.state.recordedNotCounted` says "nothing here has
 * been accepted yet", which is the honest form of what a label may not say. So
 * the sweep is the five version labels — where the word is the entire statement
 * — plus `attachments.capture.storeUnavailable`, which the same surface renders
 * when a capture reaches no store at all. Widened to every reception string it
 * would fail honest sentences, and a rule that has to be suppressed somewhere is
 * a rule that stops being applied anywhere.
 *
 * ## Why the Arabic arm is a substring list and never a `\b` regex
 *
 * `\b` in JavaScript is a boundary in the ASCII `\w` class, and Arabic letters
 * are not `\w`, so a `\b` written beside one can never bind. The sweep this
 * replaces spelled `\bمرفوع` against an `ar.json` value that BEGINS with مرفوع:
 * its Arabic arm had never once been able to fail, in either direction. Both
 * halves of that are asserted below rather than described.
 */
describe('a file on record, and the one state that is evidence', () => {
  it('reads a document reference as registered media and nothing else as media', () => {
    expect(hasRegisteredMedia('11111111-1111-4111-8111-111111111111')).toBe(true);
    for (const value of [null, undefined, '', 0, false, {}]) {
      expect(hasRegisteredMedia(value), JSON.stringify(value ?? null)).toBe(false);
    }
  });

  it('says a file is on record in the summary, and names no lifecycle state', () => {
    /*
     * `rec.reception-condition-evidence-list` projects `evidence_document_id`
     * and joins no document or version table, so no status travels with the
     * reference — `hasRegisteredMedia` says exactly that, and `SummaryStep` and
     * `AcknowledgementDocument` render this one string from that predicate
     * alone. A sentence naming `pending` would therefore be naming a state
     * nobody read, and it would be wrong precisely when the version had already
     * been accepted — on the acknowledgement a customer takes away.
     */
    const key = 'receptions.summary.mediaRegistered';
    for (const [catalogue, name] of CATALOGUES) {
      const value = catalogue[key];
      expect(value, `${key} missing from ${name}`).toBeTruthy();
      expect(ON_FILE[name](value as string), `${name} does not say a file is on record`).toBe(true);
      expect(LIFECYCLE[name](value as string), `${name} names a lifecycle state`).toBe(false);
      expect(ACCEPTANCE[name](value as string), `${name} claims the file is evidence`).toBe(false);
    }
    // Real Arabic, not an English string copied across.
    expect(/[؀-ۿ]/.test(AR[key] as string)).toBe(true);

    // Non-vacuity, both ways. The vocabulary catches every state the product
    // does name — all five labels, in both languages — and it catches the
    // wording this very string used to carry, which is the regression it is
    // here to stop returning.
    for (const status of DOCUMENT_VERSION_STATUSES) {
      const label = `receptions.capture.version.${status}`;
      expect(LIFECYCLE.en(EN[label] as string), `en ${status}`).toBe(true);
      expect(LIFECYCLE.ar(AR[label] as string), `ar ${status}`).toBe(true);
    }
    expect(LIFECYCLE.en('Media registered, pending')).toBe(true);
    expect(LIFECYCLE.ar('الوسائط مسجَّلة، قيد الانتظار')).toBe(true);
  });

  it('lets a version be called uploaded, and only an ACCEPTED one evidence', () => {
    let examined = 0;
    for (const status of DOCUMENT_VERSION_STATUSES) {
      const key = `receptions.capture.version.${status}`;
      // Derived from the contract, never listed: a sixth status added to
      // `ck_document_versions_status` arrives here as a missing key rather than
      // as a label nobody wrote a rule for.
      const assertsAcceptance = status === ACCEPTED_VERSION_STATUS;
      for (const [catalogue, name] of CATALOGUES) {
        const value = catalogue[key];
        expect(value, `${key} missing from ${name}`).toBeTruthy();
        expect(
          capturePhraseProblem(value as string, name, assertsAcceptance),
          `${name} ${key}`
        ).toBeNull();
        examined += 1;
      }
    }

    // The failure notice rendered on the same surface (`attachments/api.ts`
    // answers it when the store cannot be reached). It is not under
    // `receptions.`, and the sweep it replaces stopped at that prefix.
    for (const [catalogue, name] of CATALOGUES) {
      const key = 'attachments.capture.storeUnavailable';
      const value = catalogue[key];
      expect(value, `${key} missing from ${name}`).toBeTruthy();
      expect(capturePhraseProblem(value as string, name, false), `${name} ${key}`).toBeNull();
      examined += 1;
    }

    // Anti-vacuity: the loop above really examined every label, in both
    // languages, and the catalogues carry no version label outside the frozen
    // vocabulary — an orphan `receptions.capture.version.*` key would be copy
    // for a state the contract does not have, which no branch would ever render.
    expect(examined).toBe((DOCUMENT_VERSION_STATUSES.length + 1) * 2);
    expect(
      Object.keys(EN)
        .filter((key) => key.startsWith('receptions.capture.version.'))
        .sort()
    ).toEqual(
      DOCUMENT_VERSION_STATUSES.map((status) => `receptions.capture.version.${status}`).sort()
    );
    expect(Object.keys(EN).filter((key) => key.startsWith('receptions.')).length).toBeGreaterThan(
      100
    );
  });

  it('rejects the wordings that would make those labels dishonest', () => {
    // A planted breach per shape the rule exists to catch, because no real
    // catalogue value carries one and a rule proved only against compliant
    // input has not been proved at all.
    const breaches: readonly (readonly [string, Catalogue, boolean])[] = [
      // On record, with nothing to say it does not count yet.
      ['Uploaded', 'en', false],
      ['مرفوع', 'ar', false],
      ['Recorded as evidence', 'en', false],
      // An acceptance word on a version that has not been accepted.
      ['Accepted, being checked', 'en', false],
      ['مقبول، قيد الفحص', 'ar', false],
      // And the accepted label losing the only claim it is required to make.
      ['Being checked', 'en', true],
      ['قيد الفحص', 'ar', true],
    ];
    for (const [value, catalogue, assertsAcceptance] of breaches) {
      expect(
        capturePhraseProblem(value, catalogue, assertsAcceptance),
        `${catalogue}: ${value}`
      ).not.toBeNull();
    }

    // And the compliant forms it must ACCEPT, so the rule is a rule and not a
    // ban on saying anything at all.
    const compliant: readonly (readonly [string, Catalogue, boolean])[] = [
      ['Uploaded, not yet checked', 'en', false],
      ['Stored, but it does not count yet', 'en', false],
      ['مرفوع ولا يُحتسب بعد', 'ar', false],
      ['Accepted', 'en', true],
      ['مقبول', 'ar', true],
    ];
    for (const [value, catalogue, assertsAcceptance] of compliant) {
      expect(
        capturePhraseProblem(value, catalogue, assertsAcceptance),
        `${catalogue}: ${value}`
      ).toBeNull();
    }
    expect(breaches.length + compliant.length).toBe(12);
  });

  it('proves the Arabic matcher can fire, which the sweep it replaces could not', () => {
    const pending = AR['receptions.capture.version.pending'] as string;
    // The trap, stated as an assertion: `\b` cannot bind beside an Arabic
    // letter, so the old `\bمرفوع` did not match a value that STARTS with it.
    expect(/\bمرفوع/.test(pending)).toBe(false);
    expect(pending.startsWith('مرفوع')).toBe(true);

    // The replacement fires, on the real catalogue, in both directions.
    expect(ON_FILE.ar(pending)).toBe(true);
    expect(DENIAL.ar(pending)).toBe(true);
    expect(ACCEPTANCE.ar(pending)).toBe(false);
    expect(ACCEPTANCE.ar(AR['receptions.capture.version.accepted'] as string)).toBe(true);
    expect(ACCEPTANCE.ar('مقبول كدليل')).toBe(true);

    // Every Arabic label is Arabic, so none of the above passed on English text
    // that happened to be sitting in the Arabic catalogue.
    for (const status of DOCUMENT_VERSION_STATUSES) {
      expect(
        /[؀-ۿ]/.test(AR[`receptions.capture.version.${status}`] as string),
        `ar ${status} carries no Arabic`
      ).toBe(true);
    }
  });
});
