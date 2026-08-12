/**
 * The P1-27 closure lifecycle, as a state machine rather than as a sentence.
 *
 * ## The cycle this exists to break
 *
 * The phase carried a closure rule that could not be satisfied in any order:
 *
 *   the branch may not merge until every task row is PASS
 *   -> a row may not be PASS while its reproof is OUTSTANDING
 *   -> the reproof is a job only a push to `develop` starts
 *   -> that push is the merge
 *
 * Every step of that is individually defensible and the conjunction is a
 * deadlock. It survived because two different facts were being written into one
 * word: *is the canonical requirement satisfied* and *has every re-run this row
 * mentions been taken*. A row whose feature is wrong and a row whose feature is
 * right but unrepeated were both recorded the same way, so no reader could tell
 * a defect from an unpaid observation, and the phase could be argued as blocked
 * or as closeable from the same table.
 *
 * ## The authority for splitting them
 *
 * `docs/phase-1/phase-1-27/canonical-plan.md` states `P1-27-QA-005` in full, at
 * line 189 of its task list, as:
 *
 *     "Regression and immutable evidence packaging"
 *
 * and nothing else. The plan mentions protected change control exactly twice,
 * at lines 98 and 100, and both are about routing a **Backend** defect through
 * protected remediation — not about proving a Frontend task on protected
 * `develop`. **No canonical task requires proof on protected `develop`.**
 *
 * So a protected re-run is a property of the GATE LIFECYCLE and not a
 * requirement of any task, and the two are separated here:
 *
 *   TASK_VERDICT              is the canonical requirement satisfied at the
 *   (`FINAL_VERDICT`)         candidate head — the only question a task answers.
 *   PROTECTED_REPROOF_STATUS  does anything on this row wait on a job that only
 *                             a protected push starts. A lifecycle property.
 *
 * `PENDING_PROTECTED_MERGE` is therefore a legitimate, expected pre-merge value.
 * It is not `PASS`, it is not `FAIL`, and it is not a defect. A row carrying it
 * does not block the candidate merge, and the phase is NOT "closed" while it is
 * outstanding — those are three different statements and the old single word
 * could make only one of them.
 *
 * ## The three states
 *
 *   PRE_MERGE_CANDIDATE           implementation tasks satisfied · no open or
 *                                 partial DEFECT · the code candidate is frozen ·
 *                                 exact-head hosted CI green · exact-head
 *                                 authenticated browser green · QA-005 candidate
 *                                 evidence sealed · every protected-only field
 *                                 explicitly PENDING_PROTECTED_MERGE.
 *                                 The candidate may merge. The phase is NOT
 *                                 closed here, and this file says so in the state
 *                                 word rather than leaving it to a reader.
 *
 *   POST_MERGE_PROTECTED_REPROOF  the protected merge SHA is verified · protected
 *                                 CI green · protected authenticated browser
 *                                 green · every PENDING_PROTECTED_MERGE field
 *                                 filled from protected evidence. The Owner may
 *                                 be handed the running application.
 *
 *   OWNER_ACCEPTANCE              still manual, still the Owner's act against the
 *                                 running application, and still the only thing
 *                                 that closes the phase. Silence is not Pass.
 *
 * ## Why a frozen CODE candidate, and not a frozen head
 *
 * "Exact-head evidence" taken literally re-creates the deadlock in a smaller
 * form: recording the result of a run changes the tree, so the run is no longer
 * at the head, so the record is stale the moment it is written. The honest unit
 * is the **code candidate** — the last commit at which a non-documentation file
 * changed. Documentation commits after it do not invalidate a run, and that is
 * checked rather than asserted: `executableChangesSince` asks git for the paths
 * that moved and classifies each with `classify-changes.mjs`, the repository's
 * own authority for what counts as documentation.
 *
 * This is exactly the reasoning the phase already applied by hand when it
 * declared `03e84f1f` a SUPERSEDED code candidate because six committed
 * executable files had changed since. That judgement is now a rule.
 *
 * ## Problems and blockers are different lists, on purpose
 *
 *   `blockers` — the lifecycle's own answer. A blocker is an expected state of
 *                an unfinished phase, not a fault. `PENDING_PROTECTED_MERGE`
 *                deliberately produces none.
 *   `problems` — this gate failing. A ledger that claims an observation it
 *                cannot support, or declares a state the tree does not hold, is
 *                a fault and exits 1.
 *
 * Conflating them is how "the phase is not finished yet" became indistinguishable
 * from "something is broken", which is the same conflation one level up.
 *
 * ## The gate proves it can fail before it reports that it passed
 *
 * Every rule is applied in exactly one function, `judge`, and `main` drives that
 * function over a table of fact-sets it is REQUIRED to reject before it looks at
 * the repository — the mechanism `build-p1-27-evidence-manifest.mjs` records
 * having needed after three of its rules were stubbed out and it exited 0 each
 * time. The eight cases below are the eight negative proofs this lifecycle was
 * required to produce, expressed as data:
 *
 *   A  a real implementation task PARTIAL          -> merge blocked
 *   B  an actionable finding OPEN                  -> merge blocked
 *   C  exact-head hosted CI red                    -> merge blocked
 *   D  exact-head authenticated browser red        -> merge blocked
 *   E  protected-reproof-only evidence PENDING     -> merge PERMITTED, state
 *                                                     PRE_MERGE_CANDIDATE, not
 *                                                     PASS and not a deadlock
 *   F  after merge, protected reproof red          -> Owner handoff blocked
 *   G  after merge, protected reproof green        -> Owner handoff permitted
 *   H  Owner acceptance absent                     -> closure blocked
 *
 * C, D, F and G cannot be produced by making real hosted CI fail, so they are
 * driven with synthetic inputs, which is how `evaluate-ci-gate.mjs` has always
 * been tested. That is stated rather than implied: no run was made red to write
 * this file.
 *
 * Usage:  node scripts/ci/check-p1-27-lifecycle.mjs [--json]
 * Exit:   0 the ledger matches the tree · 1 it does not, or the self-check
 *         failed · 2 IO error.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { classify, classifyPath } from './classify-changes.mjs';
import { readRegisterRows, readClassRows } from './check-p1-27-doc-counts.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');

export const PHASE_DIR = 'docs/phase-1/phase-1-27';
export const LEDGER_PATH = `${PHASE_DIR}/evidence/lifecycle-ledger.json`;
export const MATRIX_PATH = `${PHASE_DIR}/task-matrix.json`;
export const REGISTER_PATH = `${PHASE_DIR}/adversarial-round-five.md`;

const native = (root, p) => join(root, p.split(posix.sep).join(sep));

/**
 * The lifecycle states, in the only order they can be reached.
 *
 * `CANDIDATE_INCOMPLETE` is not a failure state. It is where a phase spends
 * almost all of its life, and naming it is the point: the previous model had no
 * word for "not finished and nothing is wrong", so every such state had to be
 * written as a PARTIAL task or an OPEN finding.
 */
export const STATES = Object.freeze([
  'CANDIDATE_INCOMPLETE',
  'PRE_MERGE_CANDIDATE',
  'PROTECTED_REPROOF_INCOMPLETE',
  'POST_MERGE_PROTECTED_REPROOF',
  'OWNER_ACCEPTANCE',
]);

/** A task's verdict vocabulary. The task question, and only the task question. */
export const TASK_VERDICTS = Object.freeze(['PASS', 'PARTIAL', 'FAIL']);

/**
 * The protected-reproof vocabulary, which is a LIFECYCLE property.
 *
 * `PENDING_PROTECTED_MERGE` is the legitimate expected pre-merge value and
 * produces no blocker before the merge. `PENDING_CANDIDATE_OBSERVATION` exists
 * because most of what this phase had recorded as an unpaid PROTECTED reproof is
 * nothing of the sort — the authenticated browser tier is called by `pr-ci.yml`
 * on every pull request whose head is a branch of this repository, so the
 * observation those rows wait on is an exact-head candidate run, and calling it
 * protected-only was the mislabel that built the deadlock.
 */
export const REPROOF_STATUSES = Object.freeze([
  'NOT_REQUIRED',
  'PENDING_CANDIDATE_OBSERVATION',
  'PENDING_PROTECTED_MERGE',
  'TAKEN_GREEN',
  'TAKEN_RED',
]);

/** What an observation may say. `null` is "nobody has looked", and is not RED. */
export const OBSERVATIONS = Object.freeze(['GREEN', 'RED']);

/**
 * Every blocker this lifecycle can raise, with the phase it belongs to.
 *
 * Enumerated rather than produced ad hoc so a blocker cannot be invented by a
 * typo and then silently never match a declaration. `tests/ci/p1-27-lifecycle.test.ts`
 * requires every id `judge` can emit to be in this table and every entry in this
 * table to be reachable from at least one self-check case.
 */
export const BLOCKERS = Object.freeze({
  IMPLEMENTATION_TASK_NOT_PASS: 'candidate',
  QA005_CANDIDATE_EVIDENCE_UNSEALED: 'candidate',
  DEFECT_OPEN: 'candidate',
  DEFECT_PARTIAL: 'candidate',
  CANDIDATE_EVIDENCE_SEAL_PENDING: 'candidate',
  CODE_CANDIDATE_NOT_FROZEN: 'candidate',
  CODE_CANDIDATE_SUPERSEDED: 'candidate',
  CANDIDATE_HOSTED_CI_NOT_OBSERVED: 'candidate',
  CANDIDATE_HOSTED_CI_RED: 'candidate',
  CANDIDATE_AUTHENTICATED_BROWSER_NOT_OBSERVED: 'candidate',
  CANDIDATE_AUTHENTICATED_BROWSER_RED: 'candidate',
  PROTECTED_MERGE_NOT_TAKEN: 'protected',
  PROTECTED_MERGE_SHA_UNVERIFIED: 'protected',
  PROTECTED_CI_NOT_OBSERVED: 'protected',
  PROTECTED_CI_RED: 'protected',
  PROTECTED_AUTHENTICATED_BROWSER_NOT_OBSERVED: 'protected',
  PROTECTED_AUTHENTICATED_BROWSER_RED: 'protected',
  PROTECTED_REPROOF_FIELD_STILL_PENDING: 'protected',
  OWNER_ACCEPTANCE_NOT_TAKEN: 'owner',
  OWNER_ACCEPTANCE_FAIL: 'owner',
});

/* ------------------------------------------------------------------ *
 * The judgement. Every rule fires here or nowhere.
 * ------------------------------------------------------------------ */

const add = (list, id, detail) => {
  list.push(detail ? `${id}: ${detail}` : id);
};

/**
 * The blocker id of an entry, without its detail.
 *
 * Written with `indexOf`/`slice` rather than `split(':')[0]` because the latter
 * is typed `string | undefined` under `noUncheckedIndexedAccess`, and a caller
 * that has to widen a set to hold `undefined` is a caller that will eventually
 * put one in it.
 */
export function blockerId(entry) {
  const text = String(entry);
  const colon = text.indexOf(':');
  return colon === -1 ? text : text.slice(0, colon);
}

/**
 * @typedef {object} LifecycleFacts
 * @property {{id: string, verdict: string, reproof?: string}[]} [tasks]
 * @property {{id: string, status: string, klass: string|null}[]} [findings]
 * @property {{frozen?: boolean, superseded?: string[]}} [codeCandidate]
 * @property {{hostedCi?: string|null, authenticatedBrowser?: string|null}} [candidate]
 * @property {{taken?: boolean, shaVerified?: boolean, ci?: string|null,
 *             authenticatedBrowser?: string|null}} [protectedMerge]
 * @property {string|null} [ownerAcceptance]
 */

/**
 * Every field is optional, and that is deliberate rather than lax: absence and
 * `null` both mean "nobody has looked", and a required field would force a
 * caller to invent a value for a fact it does not have — which is how "not
 * observed" turns into "observed, and fine".
 *
 * @param {LifecycleFacts} facts
 */
export function judge(facts) {
  const candidate = [];
  const protectedPhase = [];
  const owner = [];

  /* ---- candidate: the tasks ------------------------------------- */
  for (const task of facts.tasks ?? []) {
    if (task.id === 'QA-005') {
      // QA-005 is CANDIDATE ASSURANCE: `canonical-plan.md:189` states it as
      // "Regression and immutable evidence packaging" and binds it to no
      // protected job. It may PASS before the merge, once the exact-head
      // evidence it seals is complete. It is separated from the other 41
      // because its blocker is a different sentence to a reader.
      if (task.verdict !== 'PASS') {
        add(candidate, 'QA005_CANDIDATE_EVIDENCE_UNSEALED', `verdict ${task.verdict}`);
      }
      continue;
    }
    if (task.verdict !== 'PASS') {
      add(candidate, 'IMPLEMENTATION_TASK_NOT_PASS', `${task.id} is ${task.verdict}`);
    }
  }

  /* ---- candidate: the findings ----------------------------------- *
   * A DEFECT and a PENDING EVENT are different things and the register's
   * vocabulary now says which is which. `ACTIONABLE` OPEN or PARTIAL is a
   * defect and blocks the merge. `PENDING_PROTECTED_EVENT` does not block it
   * and is not a defect. `SEALED` is neither: it is a candidate-evidence
   * obligation that QA-005 discharges, so it blocks the merge and closes in the
   * same act that seals QA-005 — a sequence, not a cycle.
   */
  for (const finding of facts.findings ?? []) {
    const pending = finding.status === 'OPEN' || finding.status === 'PARTIAL';
    if (!pending) continue;
    if (finding.klass === 'ACTIONABLE') {
      add(
        candidate,
        finding.status === 'OPEN' ? 'DEFECT_OPEN' : 'DEFECT_PARTIAL',
        `${finding.id} is an actionable ${finding.status} defect`
      );
    } else if (finding.klass === 'SEALED') {
      add(candidate, 'CANDIDATE_EVIDENCE_SEAL_PENDING', `${finding.id} is ${finding.status}`);
    }
    // PENDING_PROTECTED_EVENT and DISPOSITIONED raise nothing. That is the
    // whole content of the distinction, and it is one line so it can be read.
  }

  /* ---- candidate: the frozen code candidate ---------------------- *
   * The freshness rule is CLOSURE-AWARE, and the boundary is the Owner's PASS.
   *
   * The freeze exists so the runs, the merge and the handoff all describe one
   * executable tree; every one of those acts is gated above and behind it.
   * Once the Owner has accepted — the terminal act, which nothing after it can
   * gate — an executable commit is post-closure work, and re-deriving
   * "changed since the candidate" against a HEAD that has moved past the
   * closed phase would hold the repository red forever: the first such commit
   * is the closure wave itself, whose guard lifts are executable BY DESIGN
   * (their docblocks promised a reviewable edit on acceptance). So supersession
   * blocks while the phase is open and is silenced only by an explicit PASS —
   * never by the count reaching zero, never by the merge alone: a post-merge,
   * pre-acceptance executable change still blocks, because the Owner must be
   * handed the merged content and nothing newer. The self-check drives both
   * directions.
   */
  const closed = facts.ownerAcceptance === 'PASS';
  const code = facts.codeCandidate ?? {};
  if (!code.frozen) {
    add(candidate, 'CODE_CANDIDATE_NOT_FROZEN', 'the ledger records no code candidate');
  } else if (!closed && (code.superseded ?? []).length > 0) {
    add(
      candidate,
      'CODE_CANDIDATE_SUPERSEDED',
      `${code.superseded.length} executable file(s) changed since: ${code.superseded.slice(0, 6).join(', ')}`
    );
  }

  /* ---- candidate: the two exact-head observations ---------------- */
  const obs = facts.candidate ?? {};
  if (obs.hostedCi === null || obs.hostedCi === undefined) {
    add(candidate, 'CANDIDATE_HOSTED_CI_NOT_OBSERVED');
  } else if (obs.hostedCi === 'RED') {
    add(candidate, 'CANDIDATE_HOSTED_CI_RED');
  }
  if (obs.authenticatedBrowser === null || obs.authenticatedBrowser === undefined) {
    add(candidate, 'CANDIDATE_AUTHENTICATED_BROWSER_NOT_OBSERVED');
  } else if (obs.authenticatedBrowser === 'RED') {
    add(candidate, 'CANDIDATE_AUTHENTICATED_BROWSER_RED');
  }

  /*
   * The obligation that makes `PENDING_CANDIDATE_OBSERVATION` mean something.
   *
   * Without this the label was decorative: 23 rows could sit in it forever, and
   * `TAKEN_GREEN` was a state nothing could ever reach. Once BOTH exact-head
   * observations are green there is nothing left to wait for, so a row still
   * claiming to be waiting is a record that has not been updated — and that is a
   * blocker, not a pending event.
   *
   * Deliberately gated on both being GREEN rather than merely observed: a red
   * run is already a blocker above, and reporting a stale-pending row as well
   * would bury the real failure under bookkeeping.
   */
  if (obs.hostedCi === 'GREEN' && obs.authenticatedBrowser === 'GREEN') {
    for (const task of facts.tasks ?? []) {
      if (task.reproof === 'PENDING_CANDIDATE_OBSERVATION') {
        add(candidate, 'CANDIDATE_OBSERVATION_TAKEN_BUT_FIELD_STILL_PENDING', task.id);
      }
    }
  }

  /* ---- protected: only reachable once the candidate is clean ----- */
  const prot = facts.protectedMerge ?? {};
  if (!prot.taken) {
    add(protectedPhase, 'PROTECTED_MERGE_NOT_TAKEN');
  } else {
    // A protected merge is verified by its SECOND PARENT: the merge commit's
    // first parent is the protected branch, so checking the first parent proves
    // only that `develop` is `develop`.
    if (!prot.shaVerified) add(protectedPhase, 'PROTECTED_MERGE_SHA_UNVERIFIED');
    if (prot.ci === null || prot.ci === undefined) add(protectedPhase, 'PROTECTED_CI_NOT_OBSERVED');
    else if (prot.ci === 'RED') add(protectedPhase, 'PROTECTED_CI_RED');
    if (prot.authenticatedBrowser === null || prot.authenticatedBrowser === undefined) {
      add(protectedPhase, 'PROTECTED_AUTHENTICATED_BROWSER_NOT_OBSERVED');
    } else if (prot.authenticatedBrowser === 'RED') {
      add(protectedPhase, 'PROTECTED_AUTHENTICATED_BROWSER_RED');
    }
    for (const task of facts.tasks ?? []) {
      if (task.reproof === 'PENDING_PROTECTED_MERGE') {
        add(protectedPhase, 'PROTECTED_REPROOF_FIELD_STILL_PENDING', task.id);
      }
    }
  }

  /* ---- owner ------------------------------------------------------ */
  if (facts.ownerAcceptance === 'FAIL') add(owner, 'OWNER_ACCEPTANCE_FAIL');
  else if (facts.ownerAcceptance !== 'PASS') add(owner, 'OWNER_ACCEPTANCE_NOT_TAKEN');

  const MERGE_PERMITTED = candidate.length === 0;
  const OWNER_HANDOFF_PERMITTED = MERGE_PERMITTED && protectedPhase.length === 0;
  const CLOSURE_PERMITTED = OWNER_HANDOFF_PERMITTED && owner.length === 0;

  let STATE;
  if (!MERGE_PERMITTED) STATE = 'CANDIDATE_INCOMPLETE';
  else if (!prot.taken) STATE = 'PRE_MERGE_CANDIDATE';
  else if (!OWNER_HANDOFF_PERMITTED) STATE = 'PROTECTED_REPROOF_INCOMPLETE';
  else if (!CLOSURE_PERMITTED) STATE = 'POST_MERGE_PROTECTED_REPROOF';
  else STATE = 'OWNER_ACCEPTANCE';

  return {
    STATE,
    MERGE_PERMITTED,
    OWNER_HANDOFF_PERMITTED,
    CLOSURE_PERMITTED,
    blockers: [...candidate, ...protectedPhase, ...owner],
    candidateBlockers: candidate,
    protectedBlockers: protectedPhase,
    ownerBlockers: owner,
  };
}

/* ------------------------------------------------------------------ *
 * The self-check — the eight negative proofs, as data
 * ------------------------------------------------------------------ */

/** A candidate that satisfies every pre-merge condition. The baseline to break. */
const CLEAN_CANDIDATE = Object.freeze({
  tasks: [
    { id: 'FE-001', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
    { id: 'QA-005', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
  ],
  findings: [{ id: 'F-01', status: 'FIXED', klass: 'SEALED' }],
  codeCandidate: { frozen: true, superseded: [] },
  candidate: { hostedCi: 'GREEN', authenticatedBrowser: 'GREEN' },
  protectedMerge: { taken: false },
  ownerAcceptance: null,
});

const facts = (over = {}) => ({ ...CLEAN_CANDIDATE, ...over });

/** A merged candidate whose protected reproof is complete. */
const MERGED_GREEN = Object.freeze({
  taken: true,
  shaVerified: true,
  ci: 'GREEN',
  authenticatedBrowser: 'GREEN',
});

export const SELF_CHECK_CASES = Object.freeze([
  {
    name: 'the clean candidate is PRE_MERGE_CANDIDATE and may merge',
    facts: facts(),
    expects: {
      STATE: 'PRE_MERGE_CANDIDATE',
      MERGE_PERMITTED: true,
      OWNER_HANDOFF_PERMITTED: false,
      CLOSURE_PERMITTED: false,
    },
    raises: [],
  },
  {
    name: 'A — a real implementation task PARTIAL blocks the merge',
    facts: facts({
      tasks: [
        { id: 'FE-001', verdict: 'PARTIAL', reproof: 'NOT_REQUIRED' },
        { id: 'QA-005', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
      ],
    }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['IMPLEMENTATION_TASK_NOT_PASS'],
  },
  {
    name: 'B — an actionable finding OPEN blocks the merge',
    facts: facts({ findings: [{ id: 'F-99', status: 'OPEN', klass: 'ACTIONABLE' }] }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['DEFECT_OPEN'],
  },
  {
    name: 'B2 — an actionable finding PARTIAL blocks the merge',
    facts: facts({ findings: [{ id: 'F-98', status: 'PARTIAL', klass: 'ACTIONABLE' }] }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['DEFECT_PARTIAL'],
  },
  {
    name: 'C — exact-head hosted CI red blocks the merge',
    facts: facts({ candidate: { hostedCi: 'RED', authenticatedBrowser: 'GREEN' } }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['CANDIDATE_HOSTED_CI_RED'],
  },
  {
    name: 'C2 — hosted CI never observed is not the same as green',
    facts: facts({ candidate: { hostedCi: null, authenticatedBrowser: 'GREEN' } }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['CANDIDATE_HOSTED_CI_NOT_OBSERVED'],
  },
  {
    name: 'D — exact-head authenticated browser red blocks the merge',
    facts: facts({ candidate: { hostedCi: 'GREEN', authenticatedBrowser: 'RED' } }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['CANDIDATE_AUTHENTICATED_BROWSER_RED'],
  },
  {
    name: 'D2 — the authenticated browser never observed is not green either',
    facts: facts({ candidate: { hostedCi: 'GREEN', authenticatedBrowser: null } }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['CANDIDATE_AUTHENTICATED_BROWSER_NOT_OBSERVED'],
  },
  {
    /*
     * E is the case the whole file exists for. A row whose reproof is
     * PENDING_PROTECTED_MERGE is not PASS-by-default, is not a defect, and does
     * not deadlock: the merge is permitted, the state is PRE_MERGE_CANDIDATE
     * and the phase is NOT closed. All four assertions are made, because a case
     * that only checked `MERGE_PERMITTED` would also pass if the pending field
     * had been quietly treated as satisfied.
     */
    name: 'E — protected-reproof-only evidence PENDING permits the merge and closes nothing',
    facts: facts({
      tasks: [
        { id: 'FE-001', verdict: 'PASS', reproof: 'PENDING_PROTECTED_MERGE' },
        { id: 'QA-005', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
      ],
    }),
    expects: {
      STATE: 'PRE_MERGE_CANDIDATE',
      MERGE_PERMITTED: true,
      OWNER_HANDOFF_PERMITTED: false,
      CLOSURE_PERMITTED: false,
    },
    raises: ['PROTECTED_MERGE_NOT_TAKEN'],
    forbids: ['DEFECT_OPEN', 'DEFECT_PARTIAL', 'IMPLEMENTATION_TASK_NOT_PASS'],
  },
  {
    name: 'F — after the merge, a red protected reproof blocks the Owner handoff',
    facts: facts({ protectedMerge: { ...MERGED_GREEN, ci: 'RED' } }),
    expects: { STATE: 'PROTECTED_REPROOF_INCOMPLETE', OWNER_HANDOFF_PERMITTED: false },
    raises: ['PROTECTED_CI_RED'],
  },
  {
    name: 'F2 — a red protected authenticated browser blocks it too',
    facts: facts({ protectedMerge: { ...MERGED_GREEN, authenticatedBrowser: 'RED' } }),
    expects: { STATE: 'PROTECTED_REPROOF_INCOMPLETE', OWNER_HANDOFF_PERMITTED: false },
    raises: ['PROTECTED_AUTHENTICATED_BROWSER_RED'],
  },
  {
    /*
     * Never observed is not red, and neither is green. Both cases exist because
     * a ledger that recorded only "not green" could be satisfied by never
     * looking — which is how a required check becomes optional without anybody
     * editing the word "required".
     */
    name: 'F2b — a protected reproof never observed blocks the handoff too',
    facts: facts({ protectedMerge: { ...MERGED_GREEN, ci: null, authenticatedBrowser: null } }),
    expects: { STATE: 'PROTECTED_REPROOF_INCOMPLETE', OWNER_HANDOFF_PERMITTED: false },
    raises: ['PROTECTED_CI_NOT_OBSERVED', 'PROTECTED_AUTHENTICATED_BROWSER_NOT_OBSERVED'],
  },
  {
    name: 'F3 — an unverified merge SHA blocks it, because the second parent is the proof',
    facts: facts({ protectedMerge: { ...MERGED_GREEN, shaVerified: false } }),
    expects: { STATE: 'PROTECTED_REPROOF_INCOMPLETE', OWNER_HANDOFF_PERMITTED: false },
    raises: ['PROTECTED_MERGE_SHA_UNVERIFIED'],
  },
  {
    name: 'F4 — a field still PENDING_PROTECTED_MERGE after the merge blocks the handoff',
    facts: facts({
      tasks: [
        { id: 'FE-001', verdict: 'PASS', reproof: 'PENDING_PROTECTED_MERGE' },
        { id: 'QA-005', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
      ],
      protectedMerge: MERGED_GREEN,
    }),
    expects: { STATE: 'PROTECTED_REPROOF_INCOMPLETE', OWNER_HANDOFF_PERMITTED: false },
    raises: ['PROTECTED_REPROOF_FIELD_STILL_PENDING'],
  },
  {
    name: 'G — after the merge, a green protected reproof permits the Owner handoff',
    facts: facts({
      tasks: [
        { id: 'FE-001', verdict: 'PASS', reproof: 'TAKEN_GREEN' },
        { id: 'QA-005', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
      ],
      protectedMerge: MERGED_GREEN,
    }),
    expects: {
      STATE: 'POST_MERGE_PROTECTED_REPROOF',
      OWNER_HANDOFF_PERMITTED: true,
      CLOSURE_PERMITTED: false,
    },
    raises: ['OWNER_ACCEPTANCE_NOT_TAKEN'],
  },
  {
    name: 'H — Owner acceptance absent blocks official closure',
    facts: facts({ protectedMerge: MERGED_GREEN, ownerAcceptance: null }),
    expects: { CLOSURE_PERMITTED: false },
    raises: ['OWNER_ACCEPTANCE_NOT_TAKEN'],
  },
  {
    name: 'H2 — Owner acceptance FAIL blocks closure, and says which it is',
    facts: facts({ protectedMerge: MERGED_GREEN, ownerAcceptance: 'FAIL' }),
    expects: { CLOSURE_PERMITTED: false },
    raises: ['OWNER_ACCEPTANCE_FAIL'],
  },
  {
    name: 'the whole lifecycle completes only on an explicit Owner PASS',
    facts: facts({ protectedMerge: MERGED_GREEN, ownerAcceptance: 'PASS' }),
    expects: { STATE: 'OWNER_ACCEPTANCE', CLOSURE_PERMITTED: true },
    raises: [],
  },
  {
    name: 'a superseded code candidate blocks the merge and names the files',
    facts: facts({ codeCandidate: { frozen: true, superseded: ['scripts/ci/a.mjs'] } }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['CODE_CANDIDATE_SUPERSEDED'],
  },
  {
    /*
     * The closure boundary of the freshness rule, in both directions.
     *
     * After the Owner's explicit PASS, an executable commit is post-closure
     * work — the first one is the acceptance wave's own guard lifts — and must
     * not regress a closed phase to CANDIDATE_INCOMPLETE, or the repository
     * holds red forever on every commit after the closure.
     */
    name: 'post-closure executable changes do not reopen a phase the Owner accepted',
    facts: facts({
      codeCandidate: { frozen: true, superseded: ['scripts/ci/a.mjs'] },
      protectedMerge: MERGED_GREEN,
      ownerAcceptance: 'PASS',
    }),
    expects: { STATE: 'OWNER_ACCEPTANCE', MERGE_PERMITTED: true, CLOSURE_PERMITTED: true },
    raises: [],
    forbids: ['CODE_CANDIDATE_SUPERSEDED'],
  },
  {
    /*
     * The other direction: the merge alone does NOT relax the freeze. Between
     * the merge and the acceptance the Owner must be handed the merged
     * content, so a post-merge executable change still blocks until the PASS.
     */
    name: 'a post-merge, pre-acceptance executable change still blocks the handoff chain',
    facts: facts({
      codeCandidate: { frozen: true, superseded: ['scripts/ci/a.mjs'] },
      protectedMerge: MERGED_GREEN,
      ownerAcceptance: null,
    }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['CODE_CANDIDATE_SUPERSEDED'],
  },
  {
    name: 'an unfrozen code candidate blocks the merge',
    facts: facts({ codeCandidate: { frozen: false, superseded: [] } }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['CODE_CANDIDATE_NOT_FROZEN'],
  },
  {
    name: 'a SEALED finding still OPEN blocks the merge; a PENDING_PROTECTED_EVENT does not',
    facts: facts({
      findings: [
        { id: 'QA005-01', status: 'OPEN', klass: 'SEALED' },
        { id: 'X-01', status: 'OPEN', klass: 'PENDING_PROTECTED_EVENT' },
        { id: 'A42-13', status: 'PARTIAL', klass: 'DISPOSITIONED' },
      ],
    }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['CANDIDATE_EVIDENCE_SEAL_PENDING'],
    forbids: ['DEFECT_OPEN', 'DEFECT_PARTIAL'],
  },
  {
    name: 'QA-005 unsealed blocks the merge under its own name, not as a task defect',
    facts: facts({
      tasks: [
        { id: 'FE-001', verdict: 'PASS', reproof: 'NOT_REQUIRED' },
        { id: 'QA-005', verdict: 'PARTIAL', reproof: 'NOT_REQUIRED' },
      ],
    }),
    expects: { STATE: 'CANDIDATE_INCOMPLETE', MERGE_PERMITTED: false },
    raises: ['QA005_CANDIDATE_EVIDENCE_UNSEALED'],
    forbids: ['IMPLEMENTATION_TASK_NOT_PASS'],
  },
]);

/**
 * Drive `judge` over the table. Returns the ways it failed to fail.
 *
 * Runs inside the gate on every invocation, in CI and locally, because the
 * mutation that would defeat this file is a mutation TO this file and the gate
 * is what has to notice. A rule that always returns "no blocker" and a rule that
 * works produce identical output against a sound tree.
 */
export function selfCheck(cases = SELF_CHECK_CASES) {
  const failures = [];
  for (const kase of cases) {
    const verdict = judge(kase.facts);
    const ids = new Set(verdict.blockers.map(blockerId));
    for (const [field, want] of Object.entries(kase.expects)) {
      if (verdict[field] !== want) {
        failures.push(
          `${kase.name}: judge() reported ${field} = ${verdict[field]}, expected ${want}`
        );
      }
    }
    for (const id of kase.raises ?? []) {
      if (!ids.has(id))
        failures.push(`${kase.name}: expected blocker ${id}, got [${[...ids].join(', ')}]`);
    }
    for (const id of kase.forbids ?? []) {
      if (ids.has(id)) failures.push(`${kase.name}: raised ${id}, which this case forbids`);
    }
    for (const id of ids) {
      if (!(id in BLOCKERS)) failures.push(`${kase.name}: raised undeclared blocker ${id}`);
    }
  }
  return failures;
}

/* ------------------------------------------------------------------ *
 * Reading the repository
 * ------------------------------------------------------------------ */

/**
 * The non-documentation paths that changed between a commit and `until`
 * (default `HEAD`).
 *
 * `runGit` is injectable so the rule can be exercised without a repository, and
 * `classify-changes.mjs` decides what documentation is — reimplementing that
 * judgement here would give the repository two answers to one question, which is
 * how `docs/**` came to be treated three different ways in three scanners.
 *
 * `until` exists because a diff with only one side pinned MOVES with every
 * commit: "changed since the candidate" was the right question while the
 * candidate gated a merge, and becomes a different question the moment the
 * phase closes and work continues. A record that must stay true forever pins
 * both sides — the P1-24 lesson, applied here when the closure record needed
 * the candidate↔run-head equivalence to survive post-closure commits.
 */
export function executableChangesSince(sha, root = ROOT, runGit = defaultGit, until = 'HEAD') {
  const raw = runGit(['diff', '--name-only', `${sha}..${until}`], root);
  const files = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return files.filter((file) => classifyPath(file) !== DOCUMENTATION_CATEGORY).sort();
}

/**
 * The one category `classify-changes.mjs` calls documentation.
 *
 * Named rather than inlined so a reader can see that this file takes the
 * repository's answer instead of holding an opinion. `classify()` is imported
 * beside it and used by `documentationOnlySet` below, which is the assertion
 * that the two agree — a constant naming a policy the code does not consult is
 * the defect `evaluate-ci-gate.mjs` records having shipped.
 */
export const DOCUMENTATION_CATEGORY = 'docs';

/** True when `classify` agrees this set is documentation-only. Used by the tests. */
export function documentationOnlySet(files) {
  return files.length > 0 && classify(files).documentationOnly;
}

function defaultGit(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/** Does this repository hold that object at all? An unresolvable sha is not evidence. */
export function commitExists(sha, root = ROOT, runGit = defaultGit) {
  try {
    runGit(['cat-file', '-e', `${sha}^{commit}`], root);
    return true;
  } catch {
    return false;
  }
}

/**
 * The ledger's shape rules. A claim this gate cannot support is a PROBLEM, not a
 * blocker: it means the record is wrong, which is a different failure from the
 * phase being unfinished.
 */
export function checkLedgerShape(ledger) {
  const problems = [];
  const observed = ledger?.observations;
  if (!observed || typeof observed !== 'object') {
    return [`${LEDGER_PATH}: has no \`observations\` block`];
  }

  const named = [
    ['CANDIDATE_HOSTED_CI', observed.CANDIDATE_HOSTED_CI],
    ['CANDIDATE_AUTHENTICATED_BROWSER', observed.CANDIDATE_AUTHENTICATED_BROWSER],
    ['PROTECTED_CI', observed.PROTECTED_CI],
    ['PROTECTED_AUTHENTICATED_BROWSER', observed.PROTECTED_AUTHENTICATED_BROWSER],
  ];
  for (const [name, entry] of named) {
    if (!entry || typeof entry !== 'object') {
      problems.push(`${LEDGER_PATH}: \`${name}\` is missing`);
      continue;
    }
    const result = entry.observed ?? null;
    if (result !== null && !OBSERVATIONS.includes(result)) {
      problems.push(
        `${LEDGER_PATH}: \`${name}.observed\` is "${result}" — the vocabulary is ` +
          `${OBSERVATIONS.join(', ')} or null for "nobody has looked"`
      );
      continue;
    }
    /*
     * An observation is a RECORD of a run, not the run. A cell claiming GREEN or
     * RED with no run id and no head is testimony, and this phase has already
     * shipped a page whose "the recorded head is real" check was a 40-hex regex
     * that `deadbeef` five times satisfied.
     */
    if (result !== null) {
      if (!entry.runId)
        problems.push(`${LEDGER_PATH}: \`${name}\` claims ${result} and names no runId`);
      if (!entry.jobId)
        problems.push(`${LEDGER_PATH}: \`${name}\` claims ${result} and names no jobId`);
      if (!/^[0-9a-f]{40}$/.test(String(entry.headSha ?? ''))) {
        problems.push(`${LEDGER_PATH}: \`${name}\` claims ${result} and names no 40-hex headSha`);
      }
    }
  }

  const merge = observed.PROTECTED_MERGE;
  if (!merge || typeof merge !== 'object') {
    problems.push(`${LEDGER_PATH}: \`PROTECTED_MERGE\` is missing`);
  } else if (merge.taken) {
    if (!/^[0-9a-f]{40}$/.test(String(merge.mergeSha ?? ''))) {
      problems.push(
        `${LEDGER_PATH}: \`PROTECTED_MERGE.taken\` is true and names no 40-hex mergeSha`
      );
    }
    if (!/^[0-9a-f]{40}$/.test(String(merge.secondParent ?? ''))) {
      problems.push(
        `${LEDGER_PATH}: \`PROTECTED_MERGE.taken\` is true and names no 40-hex secondParent — ` +
          'a protected merge is verified by its SECOND parent; the first is the protected branch itself'
      );
    }
  }

  const owner = observed.OWNER_ACCEPTANCE?.result ?? null;
  if (owner !== null && owner !== 'PASS' && owner !== 'FAIL') {
    problems.push(`${LEDGER_PATH}: \`OWNER_ACCEPTANCE.result\` is "${owner}" — PASS, FAIL or null`);
  }

  const declared = ledger?.declared;
  if (!declared || typeof declared !== 'object') {
    problems.push(`${LEDGER_PATH}: has no \`declared\` block`);
  } else if (!STATES.includes(declared.STATE)) {
    problems.push(
      `${LEDGER_PATH}: declares STATE "${declared.STATE}" — the states are ${STATES.join(', ')}`
    );
  }
  return problems;
}

/** Read every fact the lifecycle turns on, from the tree. */
export function readFacts(root = ROOT, runGit = defaultGit) {
  const ledgerPath = native(root, LEDGER_PATH);
  if (!existsSync(ledgerPath)) throw new Error(`${LEDGER_PATH} does not exist`);
  const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));

  const matrixPath = native(root, MATRIX_PATH);
  if (!existsSync(matrixPath)) throw new Error(`${MATRIX_PATH} does not exist`);
  const matrix = JSON.parse(readFileSync(matrixPath, 'utf8'));
  const tasks = (matrix.tasks ?? []).map((row) => ({
    id: row.TASK_ID,
    verdict: row.FINAL_VERDICT,
    reproof: row.PROTECTED_REPROOF_STATUS,
  }));

  const registerSource = readFileSync(native(root, REGISTER_PATH), 'utf8');
  const klassOf = new Map(readClassRows(registerSource).map((r) => [r.id, r.klass]));
  const findings = readRegisterRows(registerSource).map((row) => ({
    id: row.id,
    status: row.status,
    klass: klassOf.get(row.id) ?? null,
  }));

  const observed = ledger.observations ?? {};
  const candidateSha = observed.CODE_CANDIDATE_SHA ?? null;
  let codeCandidate = { frozen: false, superseded: [] };
  if (candidateSha) {
    if (!commitExists(candidateSha, root, runGit)) {
      throw new Error(
        `${LEDGER_PATH}: CODE_CANDIDATE_SHA ${candidateSha} is not a commit in this repository, ` +
          'so nothing here can be checked against it'
      );
    }
    codeCandidate = {
      frozen: true,
      superseded: executableChangesSince(candidateSha, root, runGit),
    };
  }

  const merge = observed.PROTECTED_MERGE ?? {};
  return {
    ledger,
    tasks,
    findings,
    codeCandidate,
    candidate: {
      hostedCi: observed.CANDIDATE_HOSTED_CI?.observed ?? null,
      authenticatedBrowser: observed.CANDIDATE_AUTHENTICATED_BROWSER?.observed ?? null,
    },
    protectedMerge: {
      taken: Boolean(merge.taken),
      shaVerified: Boolean(merge.secondParentVerified),
      ci: observed.PROTECTED_CI?.observed ?? null,
      authenticatedBrowser: observed.PROTECTED_AUTHENTICATED_BROWSER?.observed ?? null,
    },
    ownerAcceptance: observed.OWNER_ACCEPTANCE?.result ?? null,
  };
}

/**
 * The ledger must declare what the tree holds, exactly.
 *
 * A gate that only printed the derived state would never fail, so nothing would
 * ever notice a rule that stopped firing. Requiring the ledger to state the same
 * answer means introducing a blocker — a task going PARTIAL, a finding going
 * ACTIONABLE, an observation going RED — is a build failure that names the
 * blocker, and REMOVING one is a build failure too.
 */
export function compareDeclaration(ledger, verdict) {
  const problems = [];
  const declared = ledger?.declared ?? {};

  if (declared.STATE !== verdict.STATE) {
    problems.push(
      `${LEDGER_PATH}: declares STATE ${declared.STATE}; the tree holds ${verdict.STATE}`
    );
  }
  for (const flag of ['MERGE_PERMITTED', 'OWNER_HANDOFF_PERMITTED', 'CLOSURE_PERMITTED']) {
    if (declared[flag] !== verdict[flag]) {
      problems.push(
        `${LEDGER_PATH}: declares ${flag} = ${declared[flag]}; the tree holds ${verdict[flag]}`
      );
    }
  }

  const declaredIds = [...new Set((declared.BLOCKERS ?? []).map(String))].sort();
  const derivedIds = [...new Set(verdict.blockers.map(blockerId))].sort();
  for (const id of derivedIds) {
    if (!declaredIds.includes(id)) {
      const detail = verdict.blockers.filter((b) => blockerId(b) === id).join(' | ');
      problems.push(
        `${LEDGER_PATH}: the tree raises ${id}, which the ledger does not declare — ${detail}`
      );
    }
  }
  for (const id of declaredIds) {
    if (!derivedIds.includes(id)) {
      problems.push(
        `${LEDGER_PATH}: declares blocker ${id}, which the tree no longer raises — ` +
          'a blocker that has been discharged must be removed in the same commit that discharges it'
      );
    }
    if (!(id in BLOCKERS)) {
      problems.push(`${LEDGER_PATH}: declares blocker ${id}, which is not in the BLOCKERS table`);
    }
  }
  return problems;
}

/** Every task row's reproof status must be in the vocabulary. */
export function checkReproofVocabulary(tasks) {
  const problems = [];
  for (const task of tasks) {
    if (!TASK_VERDICTS.includes(task.verdict)) {
      problems.push(`${MATRIX_PATH}: ${task.id} carries TASK verdict "${task.verdict}"`);
    }
    if (!REPROOF_STATUSES.includes(task.reproof)) {
      problems.push(
        `${MATRIX_PATH}: ${task.id} carries PROTECTED_REPROOF_STATUS "${task.reproof}" — ` +
          `the vocabulary is ${REPROOF_STATUSES.join(', ')}. A blank or unrecognised value is how ` +
          'a lifecycle obligation stops being counted'
      );
    }
  }
  return problems;
}

export function evaluate(root = ROOT, runGit = defaultGit) {
  const read = readFacts(root, runGit);
  const verdict = judge(read);
  const problems = [
    ...checkLedgerShape(read.ledger),
    ...checkReproofVocabulary(read.tasks),
    ...compareDeclaration(read.ledger, verdict),
  ];
  return { ok: problems.length === 0, problems, verdict };
}

function main(argv) {
  const failures = selfCheck();
  if (failures.length > 0) {
    process.stderr.write(
      '::error::the P1-27 lifecycle gate failed its own self-check: a rule accepted a state it is ' +
        'required to block. A state machine that cannot refuse a transition is a diagram.\n'
    );
    for (const failure of failures) process.stderr.write(`  ${failure}\n`);
    return 1;
  }

  let result;
  try {
    result = evaluate(ROOT);
  } catch (error) {
    process.stderr.write(`::error::cannot read the P1-27 lifecycle ledger: ${error.message}\n`);
    return 2;
  }

  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
  for (const problem of result.problems) process.stderr.write(`::error::${problem}\n`);

  const { verdict } = result;
  process.stdout.write(
    `P1-27 lifecycle: ${verdict.STATE} — merge ${verdict.MERGE_PERMITTED ? 'permitted' : 'blocked'}, ` +
      `Owner handoff ${verdict.OWNER_HANDOFF_PERMITTED ? 'permitted' : 'blocked'}, ` +
      `official closure ${verdict.CLOSURE_PERMITTED ? 'permitted' : 'blocked'}; ` +
      `${verdict.blockers.length} blocker(s), ${result.problems.length} disagreement(s).\n`
  );
  for (const blocker of verdict.blockers) process.stdout.write(`  blocker: ${blocker}\n`);
  return result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)));
}
