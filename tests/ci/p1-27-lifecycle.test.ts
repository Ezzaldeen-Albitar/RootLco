import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  BLOCKERS,
  DOCUMENTATION_CATEGORY,
  LEDGER_PATH,
  OBSERVATIONS,
  REPROOF_STATUSES,
  SELF_CHECK_CASES,
  STATES,
  TASK_VERDICTS,
  blockerId,
  checkLedgerShape,
  compareDeclaration,
  checkReproofVocabulary,
  documentationOnlySet,
  evaluate,
  executableChangesSince,
  judge,
  selfCheck,
} from '../../scripts/ci/check-p1-27-lifecycle.mjs';
import { REPROOF_MARKERS, reproofStatus } from '../../scripts/ci/build-p1-27-task-matrix.mjs';

/**
 * The P1-27 closure lifecycle, as a state machine.
 *
 * ## The failure this exists to make impossible
 *
 * The phase carried a closure rule that could not be satisfied in any order:
 * the branch may not merge until every task row is PASS, a row may not be PASS
 * while its reproof is OUTSTANDING, and the reproof is a job only the merge
 * starts. Every clause is individually defensible and the conjunction is a
 * deadlock, so the phase could be argued as blocked or as closeable from the
 * same table depending on which clause a reader started at.
 *
 * The cycle came from one word carrying two facts. They are separated now, and
 * these cases hold the separation:
 *
 *   FINAL_VERDICT             is the canonical requirement satisfied at the
 *                             candidate head. The task question.
 *   PROTECTED_REPROOF_STATUS  which kind of re-run, if any, this row still owes.
 *                             A lifecycle property, not a task requirement.
 *
 * ## Why the negative cases live in the gate and are only ASSERTED here
 *
 * `selfCheck` runs inside `check-p1-27-lifecycle.mjs` on every invocation, in CI
 * and locally, because the mutation that would defeat the gate is a mutation TO
 * the gate — and a rule that always returns "no blocker" and a rule that works
 * produce identical output against a sound tree. This file asserts the table is
 * complete and that it actually discriminates; it is a second reader, not the
 * only one.
 *
 * C, D, F and G cannot be produced by making real hosted CI fail. They are
 * driven with synthetic inputs, exactly as `tests/ci/ci-gate.test.ts` drives
 * `evaluate-ci-gate.mjs`. No run was made red to write this file.
 */

const ROOT = join(__dirname, '../..');

/** A candidate that satisfies every pre-merge condition. The baseline to break. */
const clean = () => ({
  tasks: [
    { id: 'FE-001', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
    { id: 'QA-005', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
  ],
  findings: [{ id: 'F-01', status: 'FIXED', klass: 'SEALED' }],
  codeCandidate: { frozen: true, superseded: [] as string[] },
  candidate: { hostedCi: 'GREEN' as string | null, authenticatedBrowser: 'GREEN' as string | null },
  protectedMerge: {
    taken: false,
    shaVerified: false,
    ci: null as string | null,
    authenticatedBrowser: null as string | null,
  },
  ownerAcceptance: null as string | null,
});

const merged = () => ({
  taken: true,
  shaVerified: true,
  ci: 'GREEN' as string | null,
  authenticatedBrowser: 'GREEN' as string | null,
});

describe('the lifecycle gate can fail before it reports that it passed', () => {
  it('passes its own self-check', () => {
    expect(selfCheck(), 'a rule accepted a state it is required to block').toEqual([]);
  });

  it('drives enough cases that the table is not decorative', () => {
    expect(SELF_CHECK_CASES.length).toBeGreaterThanOrEqual(16);
  });

  it('reaches every declared blocker from at least one case', () => {
    /*
     * A blocker nothing can raise is a rule that has never run. This phase has
     * recorded five scanners whose only defect was that nothing ever drove them
     * against an input they were supposed to reject.
     */
    const reached = new Set<string>();
    for (const kase of SELF_CHECK_CASES) {
      for (const entry of judge(kase.facts).blockers) reached.add(blockerId(entry));
    }
    expect(
      [...Object.keys(BLOCKERS)].filter((id) => !reached.has(id)),
      'unreachable blocker'
    ).toEqual([]);
  });

  it('raises no blocker outside the declared table', () => {
    for (const kase of SELF_CHECK_CASES) {
      for (const entry of judge(kase.facts).blockers) {
        expect(Object.keys(BLOCKERS), `${kase.name} raised ${entry}`).toContain(blockerId(entry));
      }
    }
  });

  it('notices when a rule stops firing', () => {
    /*
     * The discriminating case for `selfCheck` itself. A table of cases proves
     * nothing unless a broken rule makes it fail, so a deliberately wrong
     * expectation must be reported.
     */
    const sabotaged = [
      {
        name: 'a PARTIAL task wrongly expected to permit the merge',
        facts: {
          ...clean(),
          tasks: [
            { id: 'FE-001', verdict: 'PARTIAL', reproof: 'NOT_REQUIRED' },
            { id: 'QA-005', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
          ],
        },
        expects: { MERGE_PERMITTED: true },
        raises: [],
      },
    ];
    expect(selfCheck(sabotaged as never)).not.toEqual([]);
  });
});

describe('A — an implementation task that is not PASS blocks the candidate merge', () => {
  it.each(['PARTIAL', 'FAIL'])('%s blocks it, and names the task', (verdict) => {
    const facts = clean();
    facts.tasks = [
      { id: 'FE-017', verdict, reproof: 'NOT_REQUIRED' },
      { id: 'QA-005', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
    ];
    const result = judge(facts);
    expect(result.MERGE_PERMITTED).toBe(false);
    expect(result.STATE).toBe('CANDIDATE_INCOMPLETE');
    expect(result.blockers).toContain(`IMPLEMENTATION_TASK_NOT_PASS: FE-017 is ${verdict}`);
  });

  it('reports QA-005 under its own name, because it is candidate assurance', () => {
    /*
     * `canonical-plan.md` states `P1-27-QA-005` as "Regression and immutable
     * evidence packaging" and binds it to no protected job. It is the seal on
     * the candidate's own evidence, so an unsealed QA-005 is a different
     * sentence to a reader than a broken screen, and the blocker says which.
     */
    const facts = clean();
    facts.tasks = [
      { id: 'FE-001', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
      { id: 'QA-005', verdict: 'PARTIAL', reproof: 'NOT_REQUIRED' },
    ];
    const result = judge(facts);
    expect(result.MERGE_PERMITTED).toBe(false);
    expect(result.blockers.map(blockerId)).toContain('QA005_CANDIDATE_EVIDENCE_UNSEALED');
    expect(result.blockers.map(blockerId)).not.toContain('IMPLEMENTATION_TASK_NOT_PASS');
  });
});

describe('B — an actionable finding blocks the candidate merge; other classes do not', () => {
  it.each([
    ['OPEN', 'DEFECT_OPEN'],
    ['PARTIAL', 'DEFECT_PARTIAL'],
  ])('an ACTIONABLE %s finding raises %s', (status, blocker) => {
    const facts = clean();
    facts.findings = [{ id: 'F-99', status, klass: 'ACTIONABLE' }];
    const result = judge(facts);
    expect(result.MERGE_PERMITTED).toBe(false);
    expect(result.blockers.map(blockerId)).toContain(blocker);
  });

  it('a PENDING_PROTECTED_EVENT finding is not a defect and does not block the merge', () => {
    const facts = clean();
    facts.findings = [{ id: 'X-01', status: 'OPEN', klass: 'PENDING_PROTECTED_EVENT' }];
    const result = judge(facts);
    expect(result.MERGE_PERMITTED).toBe(true);
    expect(result.STATE).toBe('PRE_MERGE_CANDIDATE');
    expect(result.candidateBlockers).toEqual([]);
  });

  it('a SEALED finding blocks the merge, and is reported as a seal rather than a defect', () => {
    const facts = clean();
    facts.findings = [{ id: 'QA005-01', status: 'OPEN', klass: 'SEALED' }];
    const result = judge(facts);
    expect(result.MERGE_PERMITTED).toBe(false);
    expect(result.blockers.map(blockerId)).toContain('CANDIDATE_EVIDENCE_SEAL_PENDING');
    expect(result.blockers.map(blockerId)).not.toContain('DEFECT_OPEN');
  });

  it('a DISPOSITIONED finding blocks nothing', () => {
    const facts = clean();
    facts.findings = [{ id: 'A42-13', status: 'PARTIAL', klass: 'DISPOSITIONED' }];
    expect(judge(facts).MERGE_PERMITTED).toBe(true);
  });
});

describe('C and D — the two exact-head observations', () => {
  it.each([
    ['hostedCi', 'RED', 'CANDIDATE_HOSTED_CI_RED'],
    ['hostedCi', null, 'CANDIDATE_HOSTED_CI_NOT_OBSERVED'],
    ['authenticatedBrowser', 'RED', 'CANDIDATE_AUTHENTICATED_BROWSER_RED'],
    ['authenticatedBrowser', null, 'CANDIDATE_AUTHENTICATED_BROWSER_NOT_OBSERVED'],
  ])('%s = %s blocks the merge as %s', (field, value, blocker) => {
    const facts = clean();
    (facts.candidate as Record<string, string | null>)[field] = value as string | null;
    const result = judge(facts);
    expect(result.MERGE_PERMITTED).toBe(false);
    expect(result.STATE).toBe('CANDIDATE_INCOMPLETE');
    expect(result.blockers.map(blockerId)).toContain(blocker);
  });

  it('never observed and red are different blockers, because they are different facts', () => {
    /*
     * The distinction is load-bearing. A ledger that recorded "not green" for
     * both could be satisfied by never looking, which is how a check becomes
     * optional without anybody editing the word "required".
     */
    const notTaken = clean();
    notTaken.candidate.hostedCi = null;
    const red = clean();
    red.candidate.hostedCi = 'RED';
    expect(judge(notTaken).blockers).not.toEqual(judge(red).blockers);
  });
});

describe('E — PENDING_PROTECTED_MERGE is a legitimate pre-merge state', () => {
  const pending = () => {
    const facts = clean();
    facts.tasks = [
      { id: 'FE-001', verdict: 'PASS', reproof: 'PENDING_PROTECTED_MERGE' },
      { id: 'QA-005', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
    ];
    return facts;
  };

  it('permits the merge', () => {
    expect(judge(pending()).MERGE_PERMITTED).toBe(true);
  });

  it('is not a defect: it raises no candidate blocker at all', () => {
    expect(judge(pending()).candidateBlockers).toEqual([]);
  });

  it('does not close the phase — PRE_MERGE_CANDIDATE is not closure', () => {
    const result = judge(pending());
    expect(result.STATE).toBe('PRE_MERGE_CANDIDATE');
    expect(result.OWNER_HANDOFF_PERMITTED).toBe(false);
    expect(result.CLOSURE_PERMITTED).toBe(false);
  });

  it('does not deadlock: the merge it waits for is the merge it permits', () => {
    /*
     * The whole point. Take the merge the pre-merge state permits, and the
     * pending field becomes payable rather than staying pending forever.
     */
    const before = judge(pending());
    expect(before.MERGE_PERMITTED).toBe(true);

    const after = judge({ ...pending(), protectedMerge: merged() });
    expect(after.blockers.map(blockerId)).toContain('PROTECTED_REPROOF_FIELD_STILL_PENDING');

    const paid = pending();
    paid.tasks = paid.tasks.map((t) =>
      t.reproof === 'PENDING_PROTECTED_MERGE' ? { ...t, reproof: 'TAKEN_GREEN' } : t
    );
    const done = judge({ ...paid, protectedMerge: merged() });
    expect(done.OWNER_HANDOFF_PERMITTED).toBe(true);
  });
});

describe('F and G — the protected reproof', () => {
  it.each([
    ['ci', 'RED', 'PROTECTED_CI_RED'],
    ['ci', null, 'PROTECTED_CI_NOT_OBSERVED'],
    ['authenticatedBrowser', 'RED', 'PROTECTED_AUTHENTICATED_BROWSER_RED'],
    ['authenticatedBrowser', null, 'PROTECTED_AUTHENTICATED_BROWSER_NOT_OBSERVED'],
  ])('F — protected %s = %s blocks the Owner handoff as %s', (field, value, blocker) => {
    const protectedMerge = merged();
    (protectedMerge as Record<string, unknown>)[field] = value;
    const result = judge({ ...clean(), protectedMerge });
    expect(result.OWNER_HANDOFF_PERMITTED).toBe(false);
    expect(result.STATE).toBe('PROTECTED_REPROOF_INCOMPLETE');
    expect(result.blockers.map(blockerId)).toContain(blocker);
  });

  it('F — an unverified merge SHA blocks the handoff, because the SECOND parent is the proof', () => {
    const result = judge({ ...clean(), protectedMerge: { ...merged(), shaVerified: false } });
    expect(result.OWNER_HANDOFF_PERMITTED).toBe(false);
    expect(result.blockers.map(blockerId)).toContain('PROTECTED_MERGE_SHA_UNVERIFIED');
  });

  it('G — a green protected reproof advances the gate to POST_MERGE_PROTECTED_REPROOF', () => {
    const result = judge({ ...clean(), protectedMerge: merged() });
    expect(result.OWNER_HANDOFF_PERMITTED).toBe(true);
    expect(result.STATE).toBe('POST_MERGE_PROTECTED_REPROOF');
    expect(result.protectedBlockers).toEqual([]);
  });

  it('G — and it still does not close the phase', () => {
    expect(judge({ ...clean(), protectedMerge: merged() }).CLOSURE_PERMITTED).toBe(false);
  });
});

describe('H — Owner acceptance', () => {
  it('absent blocks official closure, and is not read as Pass', () => {
    const result = judge({ ...clean(), protectedMerge: merged(), ownerAcceptance: null });
    expect(result.CLOSURE_PERMITTED).toBe(false);
    expect(result.blockers.map(blockerId)).toContain('OWNER_ACCEPTANCE_NOT_TAKEN');
  });

  it('FAIL blocks closure under its own name, so it cannot be read as "not yet asked"', () => {
    const result = judge({ ...clean(), protectedMerge: merged(), ownerAcceptance: 'FAIL' });
    expect(result.CLOSURE_PERMITTED).toBe(false);
    expect(result.blockers.map(blockerId)).toContain('OWNER_ACCEPTANCE_FAIL');
  });

  it('only an explicit PASS permits closure', () => {
    const result = judge({ ...clean(), protectedMerge: merged(), ownerAcceptance: 'PASS' });
    expect(result.CLOSURE_PERMITTED).toBe(true);
    expect(result.STATE).toBe('OWNER_ACCEPTANCE');
  });
});

describe('the frozen CODE candidate', () => {
  it('an unfrozen candidate blocks the merge', () => {
    const result = judge({ ...clean(), codeCandidate: { frozen: false, superseded: [] } });
    expect(result.blockers.map(blockerId)).toContain('CODE_CANDIDATE_NOT_FROZEN');
  });

  it('a superseded candidate blocks the merge and names the files', () => {
    const result = judge({
      ...clean(),
      codeCandidate: { frozen: true, superseded: ['scripts/ci/a.mjs', 'apps/web/src/b.tsx'] },
    });
    expect(result.MERGE_PERMITTED).toBe(false);
    expect(result.blockers.join(' ')).toContain('scripts/ci/a.mjs');
  });

  it('classifies a diff with an injected git, so the rule needs no repository', () => {
    const fake = () => 'docs/phase-1/phase-1-27/task-register.md\nREADME.md\nscripts/ci/x.mjs\n';
    expect(executableChangesSince('deadbeef', ROOT, fake)).toEqual(['scripts/ci/x.mjs']);
  });

  it('a documentation-only diff supersedes nothing', () => {
    const fake = () => 'docs/phase-1/phase-1-27/task-matrix.json\ndocs/a.md\n';
    expect(executableChangesSince('deadbeef', ROOT, fake)).toEqual([]);
  });

  it('agrees with classify-changes.mjs rather than holding its own opinion', () => {
    /*
     * `DOCUMENTATION_CATEGORY` is a constant naming a policy, and this
     * repository has shipped one of those that the code did not consult. So the
     * two readings are compared against each other on the same input.
     */
    const docs = ['docs/phase-1/phase-1-27/task-matrix.json', 'docs/a.md'];
    expect(documentationOnlySet(docs)).toBe(true);
    expect(executableChangesSince('x', ROOT, () => docs.join('\n'))).toEqual([]);
    expect(DOCUMENTATION_CATEGORY).toBe('docs');

    const mixed = [...docs, 'package.json'];
    expect(documentationOnlySet(mixed)).toBe(false);
    expect(executableChangesSince('x', ROOT, () => mixed.join('\n'))).toEqual(['package.json']);
  });

  it('reads a real git range, so the injected case is not the only one exercised', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    expect(executableChangesSince(head, ROOT)).toEqual([]);
  });
});

describe('the ledger must declare what the tree holds', () => {
  const ledger = JSON.parse(readFileSync(join(ROOT, LEDGER_PATH), 'utf8'));

  it('is well formed', () => {
    expect(checkLedgerShape(ledger)).toEqual([]);
  });

  it('agrees with the tree at this head', () => {
    const result = evaluate(ROOT);
    expect(result.problems).toEqual([]);
  });

  it('reports the state honestly rather than reporting success', () => {
    /*
     * The gate is green and the phase is NOT mergeable. Those are compatible,
     * and keeping them compatible is the point: "the phase is not finished yet"
     * and "something is broken" are different, and the old model could say only
     * one of them.
     */
    const { verdict } = evaluate(ROOT);
    expect(verdict.MERGE_PERMITTED).toBe(false);
    expect(verdict.CLOSURE_PERMITTED).toBe(false);
    expect(STATES).toContain(verdict.STATE);
  });

  it('fails when the tree raises a blocker the ledger does not declare', () => {
    const stripped = { ...ledger, declared: { ...ledger.declared, BLOCKERS: [] } };
    const { verdict } = evaluate(ROOT);
    const problems = compareDeclaration(stripped, verdict);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join(' ')).toContain('which the ledger does not declare');
  });

  it('fails when the ledger declares a blocker the tree no longer raises', () => {
    const inflated = {
      ...ledger,
      declared: {
        ...ledger.declared,
        BLOCKERS: [...ledger.declared.BLOCKERS, 'OWNER_ACCEPTANCE_FAIL'],
      },
    };
    const { verdict } = evaluate(ROOT);
    expect(compareDeclaration(inflated, verdict).join(' ')).toContain('no longer raises');
  });

  it('fails when the ledger declares a state the tree does not hold', () => {
    const lying = {
      ...ledger,
      declared: { ...ledger.declared, STATE: 'PRE_MERGE_CANDIDATE', MERGE_PERMITTED: true },
    };
    const { verdict } = evaluate(ROOT);
    const problems = compareDeclaration(lying, verdict);
    expect(problems.join(' ')).toContain('declares STATE PRE_MERGE_CANDIDATE');
    expect(problems.join(' ')).toContain('declares MERGE_PERMITTED = true');
  });

  it('refuses an observation that claims a result and cites no run', () => {
    /*
     * An observation is a RECORD of a run, not the run. `QA005-03` was a check
     * that "the recorded head is real" satisfied by `deadbeef` five times.
     */
    const claimed = {
      ...ledger,
      observations: {
        ...ledger.observations,
        CANDIDATE_HOSTED_CI: { observed: 'GREEN', runId: null, jobId: null, headSha: null },
      },
    };
    const problems = checkLedgerShape(claimed).join(' ');
    expect(problems).toContain('names no runId');
    expect(problems).toContain('names no jobId');
    expect(problems).toContain('names no 40-hex headSha');
  });

  it('refuses a taken protected merge that names no second parent', () => {
    const claimed = {
      ...ledger,
      observations: {
        ...ledger.observations,
        PROTECTED_MERGE: { taken: true, mergeSha: 'a'.repeat(40), secondParent: null },
      },
    };
    expect(checkLedgerShape(claimed).join(' ')).toContain('names no 40-hex secondParent');
  });

  it('refuses an observation word outside the vocabulary', () => {
    const claimed = {
      ...ledger,
      observations: {
        ...ledger.observations,
        PROTECTED_CI: {
          observed: 'PROBABLY_FINE',
          runId: '1',
          jobId: '2',
          headSha: 'a'.repeat(40),
        },
      },
    };
    expect(checkLedgerShape(claimed).join(' ')).toContain('the vocabulary is');
    expect(OBSERVATIONS).toEqual(['GREEN', 'RED']);
  });
});

describe('TASK_VERDICT and PROTECTED_REPROOF_STATUS are separate vocabularies', () => {
  it('refuses a reproof status outside the vocabulary', () => {
    const problems = checkReproofVocabulary([
      { id: 'FE-001', verdict: 'PASS', reproof: 'OUTSTANDING' },
    ]);
    expect(problems.join(' ')).toContain('PROTECTED_REPROOF_STATUS "OUTSTANDING"');
  });

  it('refuses a blank reproof status, which is how an obligation stops being counted', () => {
    expect(
      checkReproofVocabulary([{ id: 'FE-001', verdict: 'PASS', reproof: undefined as never }])
    ).not.toEqual([]);
  });

  it('refuses a task verdict outside the vocabulary', () => {
    expect(
      checkReproofVocabulary([{ id: 'FE-001', verdict: 'MOSTLY', reproof: 'NOT_REQUIRED' }]).join(
        ' '
      )
    ).toContain('TASK verdict "MOSTLY"');
  });

  it('keeps the two vocabularies disjoint, so no value can be read as the other', () => {
    for (const verdict of TASK_VERDICTS) expect(REPROOF_STATUSES).not.toContain(verdict);
    for (const status of REPROOF_STATUSES) expect(TASK_VERDICTS).not.toContain(status);
  });

  it('derives the token from the prose marker, and refuses a cell that declares none', () => {
    for (const [marker, token] of REPROOF_MARKERS) {
      expect(reproofStatus('FE-001', `${marker} — because.`)).toBe(token);
      expect(REPROOF_STATUSES).toContain(token);
    }
    expect(() => reproofStatus('FE-001', 'OUTSTANDING — the authenticated browser tier')).toThrow(
      /opens with none of/
    );
    expect(() => reproofStatus('FE-001', '')).toThrow();
  });

  it('the committed matrix carries a status for every row', () => {
    const matrix = JSON.parse(
      readFileSync(join(ROOT, 'docs/phase-1/phase-1-27/task-matrix.json'), 'utf8')
    ) as { tasks: { TASK_ID: string; FINAL_VERDICT: string; PROTECTED_REPROOF_STATUS: string }[] };
    expect(matrix.tasks.length).toBe(42);
    for (const task of matrix.tasks) {
      expect(REPROOF_STATUSES, `${task.TASK_ID}`).toContain(task.PROTECTED_REPROOF_STATUS);
      expect(TASK_VERDICTS, `${task.TASK_ID}`).toContain(task.FINAL_VERDICT);
    }
  });
});
