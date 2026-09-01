import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CLASSES,
  CLEAN_ROOM,
  CI_EVIDENCE,
  FAILURES,
  RUN_RECORD_REQUIRED_FIELDS,
  SEALED_DOCUMENTS,
  SELF_CHECK_CASES,
  VALUE_TOKEN,
  evaluate,
  judge,
  judgeRunCompleteness,
  parseRegions,
  runCompleteness,
  selfCheck,
  tokensIn,
} from '../../scripts/ci/check-p1-27-closing-values.mjs';

/**
 * The gate that says who decides each value on the two evidence pages, tested
 * for the two ways a gate like it fails.
 *
 * **It can inspect nothing.** A classifier that only reads values a document
 * opts into reports zero problems about a document that opts nothing in. The
 * coverage rule is what closes that, and the cases below drive it with a
 * document holding an unclaimed figure to prove the rule fires.
 *
 * **It can declare a failure no input produces.** `FAILURES` is a table of names
 * the gate can print, and a name nothing can reach is a claim about strictness
 * rather than strictness. Every id in it is required to be reachable from the
 * self-check table, which is the same discipline `p1-27-lifecycle.test.ts`
 * applies to its blocker list — and which caught two unreachable blockers there.
 */

const ROOT = join(__dirname, '../..');
const readRepo = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

describe('P1-27 closing values — the gate is not vacuous', () => {
  it('reaches every declared failure from the self-check table', () => {
    /*
     * `UNKNOWN_CLASS` and `BAD_STANDING` and the rest are only worth declaring
     * if some input reaches them. The check is a set comparison rather than a
     * count, so an id added without a case fails by name.
     */
    const reachable = new Set(SELF_CHECK_CASES.map((c: { expect: string }) => c.expect));
    const declared = Object.keys(FAILURES);
    const unreachable = declared.filter((id) => !reachable.has(id));
    // Four ids are reached through shared code paths rather than by a case of
    // their own; each is named here so the exemption is a decision rather than
    // an oversight, and the exemption list is required to be exhaustive below.
    const SHARED_PATH = [
      'UNKNOWN_CLASS',
      'BAD_STANDING',
      'HOSTED_VALUE_CLAIMS_LOCAL_PROVENANCE',
      'PROTECTED_PENDING_NOT_STATED',
      'UNBOUND_DERIVABLE_VALUE',
    ];
    expect(unreachable.sort(), 'a declared failure no self-check case reaches').toEqual(
      [...SHARED_PATH].sort()
    );
  });

  it('reaches each shared-path failure with a directed input', () => {
    /*
     * The exemptions above are not an amnesty. Each is driven here, so the whole
     * of `FAILURES` is proved reachable — just not all of it from the table the
     * gate runs on every invocation.
     */
    const base = () => JSON.parse(JSON.stringify(minimal()));

    const unknownClass = base();
    unknownClass.ledger.values[0].class = 'DERIVABLE_VIBES';
    expect(judge(unknownClass).failureIds).toContain('UNKNOWN_CLASS');

    const badStanding = base();
    badStanding.ledger.values[0].standing = 'HISTORICAL';
    expect(judge(badStanding).failureIds).toContain('BAD_STANDING');

    const hostedLocal = base();
    hostedLocal.ledger.values.push({
      id: 'H',
      class: 'HOSTED_ARTIFACT_ATTESTED',
      standing: 'PENDING_CANDIDATE_OBSERVATION',
      document: CLEAN_ROOM,
      value: null,
      collection: 'the run',
      binding: { kind: 'derived', table: 'counts', name: 'apps/web/tests' },
    });
    expect(judge(hostedLocal).failureIds).toContain('HOSTED_VALUE_CLAIMS_LOCAL_PROVENANCE');

    const pendingUnstated = base();
    pendingUnstated.ledger.values.push({
      id: 'P',
      class: 'PROTECTED_POST_MERGE_ONLY',
      standing: 'PENDING_PROTECTED_MERGE',
      document: CLEAN_ROOM,
      value: null,
      pendingPhrase: 'A SENTENCE THE PAGE DOES NOT CARRY',
    });
    expect(judge(pendingUnstated).failureIds).toContain('PROTECTED_PENDING_NOT_STATED');

    const unbound = base();
    unbound.ledger.values[0].binding = { kind: 'derived', table: 'counts', name: 'no/such/tree' };
    expect(judge(unbound).failureIds).toContain('UNBOUND_DERIVABLE_VALUE');
  });

  it('resolves the `schemaBaseline` binding, and refuses a field that is not there', () => {
    /*
     * The binding kind added so `QA-005` could compare a record row against the
     * DATABASE baseline instead of against `Migrations applied` — a superseded
     * hosted measurement fixed at the head it describes. One row cannot answer
     * to a fixed historical head and a moving baseline at once, and while it
     * did, raising `migrationCount` turned one red gate into a different one.
     *
     * Both directions, because a resolver that returned a value for every field
     * name would satisfy the positive case and prove nothing. The negative case
     * is the one that makes the positive mean something.
     */
    const resolved = JSON.parse(JSON.stringify(minimal()));
    resolved.schemaBaseline = { migrationCount: 123 };
    resolved.ledger.values[0].binding = { kind: 'schemaBaseline', field: 'migrationCount' };
    resolved.ledger.values[0].value = '123';
    expect(judge(resolved).failureIds).not.toContain('UNBOUND_DERIVABLE_VALUE');

    const disagrees = JSON.parse(JSON.stringify(resolved));
    disagrees.ledger.values[0].value = '122';
    expect(judge(disagrees).failureIds).toContain('DERIVED_VALUE_DISAGREES');

    const absent = JSON.parse(JSON.stringify(resolved));
    absent.ledger.values[0].binding = { kind: 'schemaBaseline', field: 'noSuchField' };
    expect(judge(absent).failureIds).toContain('UNBOUND_DERIVABLE_VALUE');
  });

  it('refuses every mutation in the self-check table, on every invocation', () => {
    // The same table runs inside the gate. Asserting it here as well is the
    // difference between "the negative proofs exist" and "the negative proofs
    // are consulted", and this repository has shipped the first without the
    // second more than once.
    expect(SELF_CHECK_CASES.length, 'the self-check table is empty').toBeGreaterThanOrEqual(10);
    expect(selfCheck()).toEqual([]);
  });

  it('accepts nothing when the mutation is inverted', () => {
    /*
     * A self-check that returns "no failures" for a table of NO cases would
     * satisfy the case above perfectly. Feeding it a case whose expectation is a
     * failure the input cannot produce must be reported.
     */
    const impossible = [
      { id: 'X', what: 'an unmutated tree', expect: 'RUN_RECORD_STALE', mutate: () => {} },
    ];
    expect(selfCheck(impossible)).not.toEqual([]);
  });
});

describe('P1-27 closing values — the token scanner', () => {
  it('reads a figure and ignores an identifier that contains digits', () => {
    /*
     * The boundary rule is the whole usability of the scan. `P1-27` and
     * `QA-005` are names; `#214` and a backticked run id are values. Getting
     * this wrong in either direction is fatal: too loose and a hundred false
     * findings bury a real one, too tight and a figure hides inside a hyphen.
     */
    const identifiers = 'P1-27 QA-005 H-24 phase-1-27 P1-G27 sha256 2026-08-11 js/no-op';
    expect(tokensIn(identifiers).map((t: { value: string }) => t.value)).toEqual([]);

    const values = 'run `31312531302`, #214, **20 completed**, 95.53%, 197.2 MiB';
    expect(tokensIn(values).map((t: { value: string }) => t.value)).toEqual([
      '31312531302',
      '214',
      '20',
      '95.53%',
      '197.2',
    ]);
  });

  it('reads a verdict stated as a table cell and not the same word in prose', () => {
    const table = '| gate | decision |\n| --- | --- |\n| ci | **Go** |\n';
    expect(tokensIn(table).map((t: { value: string }) => t.value)).toEqual(['Go']);
    expect(tokensIn('the run was green and the gate said Go later on')).toEqual([]);
  });

  it('is anchored, so a longer number cannot satisfy a shorter claim', () => {
    // `toContain('70 web test files')` is satisfied by "170 web test files".
    // The token is a maximal run, so the overstatement is a DIFFERENT token.
    const overstated = 'holds **170 web test files**';
    expect(overstated.includes('70 web test files')).toBe(true);
    expect(tokensIn(overstated).map((t: { value: string }) => t.value)).toEqual(['170']);
    expect(VALUE_TOKEN.global, 'the scanner must be global or it reads one token').toBe(true);
  });
});

describe('P1-27 closing values — the pages are tiled', () => {
  it('covers both evidence pages edge to edge, with no gap', () => {
    for (const relative of SEALED_DOCUMENTS) {
      const parsed = parseRegions(relative, readRepo(relative));
      expect(parsed.problems, `${relative} does not tile`).toEqual([]);
      expect(parsed.gaps, `${relative} has unsealed text`).toEqual([]);
      expect(parsed.regions.length, `${relative} declares no region`).toBeGreaterThan(3);
    }
  });

  it('marks every excluded region with a banner a reader can see', () => {
    /*
     * An HTML comment is invisible in the rendered page. A section excluded from
     * the seal only in a comment reads exactly like current evidence, which is
     * the state the "Hosted corroboration at the same head" section was in while
     * describing a head the branch had left behind.
     */
    let excluded = 0;
    for (const relative of SEALED_DOCUMENTS) {
      for (const region of parseRegions(relative, readRepo(relative)).regions) {
        if (region.kind !== 'historical' && region.kind !== 'example') continue;
        excluded += 1;
        expect(region.text, `${relative}: ${region.name} has no visible banner`).toMatch(
          /^>\s*\*\*(?:HISTORICAL|SUPERSEDED|NON-NORMATIVE)\b/m
        );
      }
    }
    expect(excluded, 'no region is excluded — this assertion would be vacuous').toBeGreaterThan(3);
  });
});

describe('P1-27 closing values — the live pages', () => {
  const result = evaluate(ROOT);

  it('classifies every current value, and reports the five measured counts as zero', () => {
    /*
     * `RUN_RECORD_*` is excluded, and the exclusion is the point rather than a
     * softening. These cases execute INSIDE the run that produces the next
     * record, and the record is written after the run ends — so a case asserting
     * the record is fresh reads the PREVIOUS one and, when that is stale, fails,
     * which makes the new record stale, for ever. It deadlocked exactly so.
     *
     * Record freshness belongs to the gate, which runs outside any tier, and it
     * is proved by mutation there. Everything else the gate decides — the
     * classification of every value, the five counts — is stable under its own
     * execution and is asserted whole.
     */
    const classification = result.problems.filter((p: string) => !p.startsWith('RUN_RECORD_'));
    expect(classification, 'the live pages carry a value the gate refuses').toEqual([]);
    const { EXCLUDED_VALUES, ...required } = result.counters;
    expect(required).toEqual({
      UNCLASSIFIED_CURRENT_VALUES: 0,
      UNBOUND_DERIVABLE_VALUES: 0,
      HOSTED_VALUES_WITHOUT_PROVENANCE: 0,
      PROTECTED_VALUES_MISREPRESENTED_AS_PREMERGE: 0,
      HISTORICAL_VALUES_COUNTED_AS_CURRENT: 0,
    });
    /*
     * `EXCLUDED_VALUES` is a measurement rather than a target. It counts the
     * tokens in banner-marked `historical` and `example` regions, which the
     * coverage rule deliberately does not scan — and it is asserted non-zero
     * because a page with nothing excluded would make the five zeros above
     * trivially true by having deleted its own history.
     */
    expect(
      EXCLUDED_VALUES,
      'no value is excluded — the five zeros above are cheap'
    ).toBeGreaterThan(20);
  });

  it('uses every class it declares, or none of them silently', () => {
    // A taxonomy nothing populates is a taxonomy nobody has tested. Each class
    // is reported, and the two that decide the current seal must be non-empty —
    // a page with no locally derivable value is a page proving nothing.
    for (const name of Object.keys(CLASSES)) {
      expect(result.byClass, `class ${name} is not reported`).toHaveProperty(name);
    }
    expect(result.byClass.DERIVABLE_LOCAL, 'no value is locally derivable').toBeGreaterThan(0);
    expect(result.byClass.DERIVABLE_GIT, 'no value is bound to git').toBeGreaterThan(0);
  });

  it('carries the ledger contract on every CURRENT hosted value, and states none before a candidate observation exists', () => {
    /*
     * REBOUND — the same correction the web tier records in
     * `apps/web/tests/p1-27-round-five-register.test.ts`. This case required
     * the CURRENT hosted list to equal [] unconditionally, which was the honest
     * state while no candidate existed and a contradiction the moment QA-005
     * sealed one: the seal RECORDS hosted attestations as CURRENT, so the old
     * rule asserted the phase could never reach its own terminal state.
     *
     * What the case is about survives, two-sided and state-aware:
     *
     *   - While the LIFECYCLE ledger records no candidate observation, a hosted
     *     figure presented as current would describe a run nobody has taken, so
     *     the CURRENT list must still be empty — the old rule, now conditional
     *     on the state that made it true.
     *   - Once a candidate observation is recorded, every CURRENT hosted value
     *     must carry full provenance — runId, job id, 40-hex headSha, the same
     *     contract `checkLedgerShape` enforces on the lifecycle ledger — so a
     *     figure is promoted to CURRENT only by naming the run that makes it
     *     so, never quietly. And at least one must exist: an observation the
     *     pages do not cite is a record and a seal disagreeing in silence.
     */
    const ledger = JSON.parse(readRepo(`${PHASE_DIR}/evidence/closing-value-ledger.json`)) as {
      values: {
        id: string;
        class: string;
        standing: string;
        provenance?: { runId?: string; job?: string; headSha?: string };
      }[];
    };
    const hosted = ledger.values.filter((v) => v.class === 'HOSTED_ARTIFACT_ATTESTED');
    expect(hosted.length, 'no hosted value is classified at all').toBeGreaterThan(5);

    const lifecycle = JSON.parse(readRepo(`${PHASE_DIR}/evidence/lifecycle-ledger.json`)) as {
      observations?: {
        CANDIDATE_HOSTED_CI?: { observed?: string | null };
        CANDIDATE_AUTHENTICATED_BROWSER?: { observed?: string | null };
      };
    };
    const candidateObserved =
      (lifecycle.observations?.CANDIDATE_HOSTED_CI?.observed ?? null) !== null ||
      (lifecycle.observations?.CANDIDATE_AUTHENTICATED_BROWSER?.observed ?? null) !== null;

    const current = hosted.filter((v) => v.standing === 'CURRENT');
    if (!candidateObserved) {
      expect(
        current.map((v) => v.id),
        'a hosted value is stated as current while the lifecycle ledger records no candidate observation'
      ).toEqual([]);
      return;
    }
    expect(
      current.length,
      'the lifecycle ledger records a candidate observation and no hosted value cites it as CURRENT'
    ).toBeGreaterThan(0);
    const unproven = current
      .filter(
        (v) =>
          !v.provenance?.runId ||
          !v.provenance?.job ||
          !/^[0-9a-f]{40}$/.test(String(v.provenance?.headSha ?? ''))
      )
      .map((v) => v.id);
    expect(
      unproven,
      'a CURRENT hosted value names no runId, no job id or no 40-hex headSha'
    ).toEqual([]);
  });
});

const PHASE_DIR = 'docs/phase-1/phase-1-27';

/** The smallest tree `judge` accepts, for the directed cases above. */
function minimal(): unknown {
  return {
    docs: {
      [CLEAN_ROOM]: '<!-- seal: current t -->\n\nIt holds **70 files**.\n\n<!-- seal: end t -->\n',
      [CI_EVIDENCE]: '<!-- seal: narrative n -->\n\nNothing.\n\n<!-- seal: end n -->\n',
    },
    files: {},
    derived: { counts: { 'apps/web/tests': 70 } },
    git: {},
    baseline: { tiers: {} },
    runs: { tiers: {} },
    tierFiles: {},
    executableChanges: {},
    lifecycle: { observations: { CODE_CANDIDATE_SHA: null, PROTECTED_MERGE: { taken: false } } },
    ledger: {
      values: [
        {
          id: 'FILES',
          class: 'DERIVABLE_LOCAL',
          standing: 'CURRENT',
          document: CLEAN_ROOM,
          locator: 'It holds **70 files**.',
          value: '70',
          binding: { kind: 'derived', table: 'counts', name: 'apps/web/tests' },
        },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// The zero-case false-green class (PRE-P1-29 run-ledger residual).
//
// A test file can be COUNTED in a vitest report and contribute zero assertions:
// a file that fails to collect, a suite whose top-level throw happens before any
// `it` registers, a `describe` that returns early. vitest reports
// `numFailedTests: 0` for all of those. A ledger that records only
// tests/passed/failed/files therefore sees a SMALLER GREEN RUN and nothing else,
// and the tier total moves on an unchanged tree with no gate objecting.
//
// These cases drive the guard with reports shaped like the real thing rather
// than asserting that the guard exists.
// ---------------------------------------------------------------------------
describe('the run ledger cannot report green over a case that vanished', () => {
  const file = (
    name: string,
    cases: number,
    status: 'passed' | 'failed' = 'passed'
  ): Record<string, unknown> => ({
    name,
    status,
    assertionResults: Array.from({ length: cases }, () => ({ status: 'passed' })),
  });

  it('Z1 accepts a run where every counted file contributed a case', () => {
    const record = runCompleteness(
      { success: true, testResults: [file('a.test.ts', 3), file('b.test.ts', 7)] },
      0
    );
    expect(record.filesWithoutCases).toEqual([]);
    expect(record.failedSuites).toEqual([]);
    expect(judgeRunCompleteness('unit', record)).toEqual([]);
  });

  it('Z2 refuses a run where a counted file contributed ZERO cases', () => {
    // The exact historical shape: the report still says success, the failure
    // count is still zero, and one file simply ran nothing.
    const record = runCompleteness(
      { success: true, testResults: [file('a.test.ts', 3), file('silent.test.ts', 0)] },
      0
    );
    expect(record.filesWithoutCases).toEqual(['silent.test.ts']);
    const ids = judgeRunCompleteness('unit', record).map((p) => p.id);
    expect(ids).toContain('RUN_RECORD_FILE_RAN_NO_CASES');
  });

  it('Z3 refuses a record that cannot SEE a vanished file at all', () => {
    // A ledger written before this guard existed carries none of the four
    // fields. That is INCOMPLETE, not clean: an absent field is not evidence of
    // absence, and reading `undefined` as "nothing wrong" is the same false
    // green one layer up.
    const legacy = { tests: 3045, passed: 3045, failed: 0, files: 112 };
    const ids = judgeRunCompleteness('unit', legacy).map((p) => p.id);
    expect(ids).toContain('RUN_RECORD_INCOMPLETE');
    for (const field of RUN_RECORD_REQUIRED_FIELDS) {
      expect(legacy).not.toHaveProperty(field);
    }
  });

  it('Z4 refuses a failure that zero failed CASES would otherwise mask', () => {
    // Two independent maskings, because they arrive by different routes: a
    // suite that failed before any case ran, and a runner that exited non-zero
    // while every case it managed to run passed.
    const suiteFailed = runCompleteness(
      { success: true, testResults: [file('a.test.ts', 3), file('broken.test.ts', 0, 'failed')] },
      0
    );
    expect(suiteFailed.failedSuites).toEqual(['broken.test.ts']);
    expect(judgeRunCompleteness('unit', suiteFailed).map((p) => p.id)).toContain(
      'RUN_RECORD_SUITE_FAILED'
    );

    const exitedRed = runCompleteness({ success: true, testResults: [file('a.test.ts', 3)] }, 1);
    expect(judgeRunCompleteness('unit', exitedRed).map((p) => p.id)).toContain(
      'RUN_RECORD_RUN_NOT_SUCCESSFUL'
    );
  });

  it('Z5 never returns green for a malformed or absent record', () => {
    // Each of these is a way a record can be unreadable rather than bad, and
    // the answer to all of them must be a problem — never an empty list, which
    // the caller reads as "this tier is fine".
    for (const shape of [undefined, null, {}, { exitCode: 0 }, { filesWithoutCases: [] }]) {
      expect(judgeRunCompleteness('unit', shape as never).length).toBeGreaterThan(0);
    }

    // And a reporter that contradicts its own counts.
    const contradicted = runCompleteness(
      { success: false, testResults: [file('a.test.ts', 3)] },
      0
    );
    expect(contradicted.reporterSuccess).toBe(false);
    expect(judgeRunCompleteness('unit', contradicted).map((p) => p.id)).toContain(
      'RUN_RECORD_RUN_NOT_SUCCESSFUL'
    );
  });

  it('every problem id it can raise is declared in the failure vocabulary', () => {
    // The gate declares its failure names in one table; a rule that raises an
    // undeclared id would report something no reader can look up.
    const raised = new Set([
      ...judgeRunCompleteness('unit', {}).map((p) => p.id),
      ...judgeRunCompleteness(
        'unit',
        runCompleteness({ success: false, testResults: [file('x.test.ts', 0, 'failed')] }, 1)
      ).map((p) => p.id),
    ]);
    expect(raised.size).toBeGreaterThan(0);
    for (const id of raised) expect(FAILURES).toHaveProperty(id);
  });
});
