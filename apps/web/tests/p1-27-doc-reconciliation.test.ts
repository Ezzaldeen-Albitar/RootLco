import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
 * The gate's own roots, imported rather than restated, so this file cannot go on
 * describing a tree list the gate has moved past.
 *
 * Loaded the same way `p1-27-security.test.ts` loads it — a dynamic import of
 * the `.mjs` by URL with an explicit shape — because the gate ships no type
 * declaration and a static import resolves to `any`, which `typecheck:web`
 * refuses under `noImplicitAny`.
 */
const GATE = (await import(
  pathToFileURL(join(process.cwd(), '..', '..', 'scripts', 'ci', 'check-p1-27-frontend.mjs')).href
)) as { readonly SCAN_ROOTS: readonly string[] };
const SCAN_ROOTS = GATE.SCAN_ROOTS;

/**
 * The phase records are reconciled against the repository (`P1-27-DOC-001`,
 * `P1-27-DOC-002`, `P1-27-QA-005`).
 *
 * ## The defect this exists for
 *
 * Every number in the P1-27 documents was DERIVED from the repository and then
 * MAINTAINED BY HAND. The one figure a test rebuilt — the `scripts/ci` count in
 * `documented-counts.test.ts` — is the one that self-corrected the moment it
 * drifted. Everything hand-copied went stale silently: a pinned SHA sixty
 * commits behind, test counts short by nearly two hundred, and a §9 table
 * asserting eleven unreachable operations while the gate beside it proved four.
 *
 * A record that no test recomputes is a claim, not evidence. This file makes
 * staleness a build failure.
 *
 * ## What it deliberately does NOT do
 *
 * It does not pin a commit SHA. A SHA recorded by hand is stale on the next
 * commit, including the one that records it, so the documents state a BRANCH and
 * the facts that outlive any single head. Where a document must name a head —
 * the clean-room record — this file asserts the record EXISTS and names the
 * branch, and the head is re-recorded at closure by the process that reads it.
 */

const REPO = join(process.cwd(), '..', '..');
const PHASE = join(REPO, 'docs', 'phase-1', 'phase-1-27');

function read(...parts: string[]): string {
  return readFileSync(join(PHASE, ...parts), 'utf8');
}

/**
 * The one canonical, greppable statement of where the phase stands.
 *
 * Every guarded document must carry this exact line. A document that merely
 * MENTIONS `OWNER ACCEPTANCE: FAIL` somewhere in a narrative does not state a
 * status — `evidence/task-traceability.md` mentioned it only in a past-tense
 * sentence about a superseded event, which would have kept the guard green while
 * the surrounding prose announced a Pass.
 */
const CURRENT_STATUS_LINE = 'CURRENT PHASE STATUS: OWNER ACCEPTANCE: FAIL';

/**
 * One paragraph, whitespace-normalised.
 *
 * `B-02`. A banned sentence was on the page and the ban did not see it:
 * `evidence/task-traceability.md` reads "are simply not\nbuilt" because Prettier
 * wraps prose at 80 columns, and `.not.toContain('are simply not built')`
 * compares against a string with a space where the file has a newline. The
 * check was green and the sentence it forbade was published.
 *
 * The acceptance guard in this same file already learned this lesson — it judges
 * PARAGRAPHS rather than lines, for exactly this reason — and the lesson had not
 * reached the case forty lines above it.
 */
function normalised(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/**
 * A symlink is refused rather than walked past (`QA005-12`).
 *
 * `Dirent.isDirectory()` is FALSE for a symlink pointing at a directory, so the
 * two walkers below would have skipped the tree beyond one and every count they
 * derive would have silently shrunk — in a file whose whole purpose is to stop
 * counts drifting. The same policy is applied by
 * `scripts/ci/check-p1-27-frontend.mjs` and
 * `scripts/ci/build-p1-27-evidence-manifest.mjs`.
 */
function assertNotSymlink(entry: { isSymbolicLink?: () => boolean }, path: string): void {
  if (typeof entry.isSymbolicLink === 'function' && entry.isSymbolicLink()) {
    throw new Error(
      `${path} is a symbolic link. These walkers refuse symlinks: a link is invisible to ` +
        '`isDirectory()`, so every file beyond it would be missing from a derived count with ' +
        'nothing to say so.'
    );
  }
}

describe('DOC-001 — §9 agrees with the gate that owns the question', () => {
  const manifest = JSON.parse(
    readFileSync(join(PHASE, 'canonical-write-reachability.json'), 'utf8')
  ) as { operations: Record<string, { classification: string; decisionRef?: string }> };

  const deliberatelyAbsent = Object.entries(manifest.operations)
    .filter(([, v]) => v.classification !== 'REACHABLE')
    .map(([k]) => k)
    .sort();

  it('names exactly the operations the manifest classifies as absent', () => {
    // The document used to list ELEVEN operations as having no call site while
    // the gate proved four. Two answers to one question, and the document is
    // the one a human reads.
    const traceability = read('evidence', 'task-traceability.md');
    for (const id of deliberatelyAbsent) {
      expect(traceability, `§9 does not name ${id}`).toContain(id);
    }
    expect(deliberatelyAbsent).toEqual([
      'crm.customer-merge',
      'crm.duplicate-scan',
      'veh.vehicle-duplicate-scan',
      'veh.vehicle-merge',
    ]);
  });

  it('states the count the gate reports, not a different one', () => {
    const traceability = read('evidence', 'task-traceability.md');
    const reachable = Object.values(manifest.operations).filter(
      (v) => v.classification === 'REACHABLE'
    ).length;
    expect(traceability).toContain(`REACHABLE = ${reachable}`);
    expect(traceability).toContain(`DELIBERATELY_ABSENT = ${deliberatelyAbsent.length}`);
  });

  it('no longer ASSERTS that seven operations are unbuilt (B-02)', () => {
    /*
     * The exact sentence that was true when written and false when read — and
     * the ban that could not see it.
     *
     * `.not.toContain('are simply not built')` was green while
     * `evidence/task-traceability.md:321` carried "are simply not\nbuilt": one
     * Prettier line wrap between "not" and "built" defeated a substring check.
     * The banned sentence was on the page for the whole of the remediation that
     * added the ban.
     *
     * Whitespace-normalised now, which is what the acceptance guard further down
     * this file already does — the technique existed in the same file and had
     * not reached here.
     *
     * The document is REQUIRED to keep discussing the retracted claim (§16
     * preserves superseded statements), so the ASSERTION is what is banned, not
     * the words: the sentence survives under a heading that quotes and corrects
     * it. Only text outside a quotation is judged.
     */
    const traceability = read('evidence', 'task-traceability.md');
    const asserted = traceability
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('>'))
      .join('\n');

    // Paragraph scope: a claim wrapped across three lines is still one claim.
    const claims = normalised(asserted)
      .split(/(?<=\.)\s/)
      .filter(
        (sentence) =>
          /are simply not built/i.test(sentence) &&
          // The correction itself names the sentence in order to retract it.
          !/(said|read|was|previously|earlier|version|retract|no longer|false)/i.test(sentence)
      );
    expect(
      claims,
      'the document asserts that operations are unbuilt; the gate says otherwise'
    ).toEqual([]);
  });

  it('B-02: the ban can see a wrapped sentence, which is the whole defect', () => {
    /*
     * Without this, the case above is a check that has never been shown to fire.
     * The first form of it could not fail on the very text it was written for.
     */
    const wrapped = 'The other seven are simply not\nbuilt, and that is that.';
    expect(wrapped.includes('are simply not built'), 'the original check').toBe(false);
    expect(normalised(wrapped).includes('are simply not built'), 'the fixed check').toBe(true);
  });

  it('resolves every call site the closed-by-D1 sub-table cites', () => {
    /*
     * The sub-table names, for each operation that had no call site at the audit,
     * the `file:line` that has one now. Nothing checked those cells, and three of
     * seven were wrong: the ownership and plate rows were TRANSPOSED (`:155` is
     * the `/plates` line inside `assignPlateAction`, `:212` is the `/ownerships`
     * line inside `transferOwnershipAction`) and `crm.vehicle-link` pointed at a
     * sentence inside a docblock rather than at the `client.send`.
     *
     * A false citation in an evidence table is worse than none: it looks like
     * proof. Each cell is resolved here — the file must exist, the line must
     * exist, and the line must carry the operation's own path segment.
     */
    const traceability = read('evidence', 'task-traceability.md');
    const SRC = join(REPO, 'apps', 'web', 'src', 'features');

    const CITED: readonly { op: string; file: string; needle: string }[] = [
      { op: 'crm.contact-add', file: 'crm/customers/profile-actions.ts', needle: '/contacts' },
      { op: 'crm.address-add', file: 'crm/customers/profile-actions.ts', needle: '/addresses' },
      {
        op: 'crm.customer-status-set',
        file: 'crm/customers/governance-actions.ts',
        needle: '/status',
      },
      { op: 'crm.vehicle-link', file: 'vehicles/relations-api.ts', needle: '/vehicles' },
      {
        op: 'veh.vehicle-ownership-transfer',
        file: 'vehicles/history-api.ts',
        needle: '/ownerships',
      },
      { op: 'veh.vehicle-plate-assign', file: 'vehicles/history-api.ts', needle: '/plates' },
      {
        op: 'veh.vehicle-odometer-record',
        file: 'vehicles/history-api.ts',
        needle: '/odometer-readings',
      },
    ];

    for (const { op, file, needle } of CITED) {
      const row = traceability
        .split('\n')
        .find((line) => line.includes(`\`${op}\``) && line.includes('.ts:'));
      expect(row, `§9 has no call-site row for ${op}`).toBeTruthy();

      const cite = /`([\w./-]+\.ts):(\d+)`/.exec(row ?? '');
      expect(cite, `${op}'s row carries no file:line citation`).toBeTruthy();

      const basename = cite?.[1] ?? '';
      const lineNo = Number(cite?.[2] ?? 0);
      expect(file.endsWith(basename), `${op} cites ${basename}, expected ${file}`).toBe(true);

      const lines = readFileSync(join(SRC, file), 'utf8').split('\n');
      expect(lineNo, `${op} cites line ${lineNo}, past the end of ${basename}`).toBeLessThanOrEqual(
        lines.length
      );
      expect(
        lines[lineNo - 1],
        `${basename}:${lineNo} does not carry ${needle} — the citation for ${op} is wrong`
      ).toContain(needle);
    }
  });

  it('gives every absent operation a decision reference', () => {
    // The gate refuses a blank one; this refuses a missing one in the record.
    for (const id of deliberatelyAbsent) {
      const entry = manifest.operations[id];
      expect(entry?.decisionRef, `${id} has no decision reference`).toBeTruthy();
    }
  });
});

describe('DOC-002 — the change log the task names actually exists', () => {
  it('ships an evidence/change-log.md that is about THIS phase (B-04)', () => {
    /*
     * `DOC-002` is "Operator / developer guidance AND change-log update".
     * `phase-1-19`, `-20` and `-21` each ship `evidence/change-log.md`, and two
     * inventory scripts bind the identically-titled task to that path.
     *
     * P1-27 shipped no such artefact and no document recorded a decision to drop
     * it — half a named canonical deliverable, covered by a register cell that
     * cited an automated proof which did not exist.
     *
     * `existsSync` alone was that proof, and it is satisfied by an empty file.
     * `B-04`: this case asserted a path, not a document. It now asserts that the
     * file is a change log FOR P1-27 — it names the phase, it has content, and
     * it records changes rather than merely existing.
     */
    const path = join(PHASE, 'evidence', 'change-log.md');
    expect(existsSync(path), 'DOC-002 names an artefact this phase does not ship').toBe(true);
    const log = read('evidence', 'change-log.md');
    expect(log.length, 'the change log is a stub').toBeGreaterThan(1000);
    expect(log, 'the change log does not say which phase it belongs to').toMatch(/P1-27|1-27/);
    // A change log records commits. A document with no commit reference is a
    // narrative, and the register cell would still read as satisfied.
    const commits = [...log.matchAll(/`[0-9a-f]{7,40}`/g)].length;
    expect(commits, 'the change log references no commit at all').toBeGreaterThan(3);
  });

  it('follows the convention its sibling phases established, in substance (B-04)', () => {
    /*
     * `B-04`. This case asserted something about phases 1-19, 1-20 and 1-21 and
     * nothing whatsoever about P1-27 — it would have passed with no P1-27 change
     * log at all, and its title claims otherwise.
     *
     * The convention argument is worth keeping: if the siblings ever stop
     * shipping one, the "every sibling does this" reasoning has to be reopened
     * rather than silently inherited. So both halves are asserted, and the P1-27
     * half is the one the title is about.
     */
    const siblings = ['phase-1-19', 'phase-1-20', 'phase-1-21'].filter((p) =>
      existsSync(join(REPO, 'docs', 'phase-1', p, 'evidence', 'change-log.md'))
    );
    expect(siblings.length, 'no sibling phase ships a change log any more').toBeGreaterThan(0);
    // The half that was missing: P1-27 is held to the convention it cites.
    expect(
      existsSync(join(PHASE, 'evidence', 'change-log.md')),
      `${siblings.length} sibling phase(s) ship a change log and P1-27 does not`
    ).toBe(true);
  });

  it('names every task the adjudication records as FIXED on this branch', () => {
    /*
     * DERIVED from `final-task-adjudication.md`, not from a hand-written list.
     *
     * This case used to assert four hard-coded strings — `SEC-001`, `FE-019`,
     * `FE-020` and `OWNER ACCEPTANCE: FAIL` — none of which is a wave heading,
     * while the change log claimed the test "fails if this file stops naming the
     * waves below". Every wave section could have been deleted and it would have
     * stayed green, and `FE-003` — a live gate hole, adjudicated FIXED on this
     * branch — was missing from the log entirely.
     *
     * A change log is the phase's answer to "what did you change". Deriving the
     * row set from the adjudication makes an omission a build failure, which is
     * the only thing that would have caught the one that happened.
     */
    const adjudication = read('final-task-adjudication.md');
    const fixed = [...adjudication.matchAll(/\|\s*`([A-Z]+-\d+)`\s*\|[^|]*\|\s*FIXED\b/g)].map(
      (m) => m[1] as string
    );

    expect(fixed.length, 'no FIXED rows were read from the adjudication').toBeGreaterThan(20);

    const log = read('evidence', 'change-log.md');
    const missing = [...new Set(fixed)].filter((task) => !log.includes(task));
    expect(
      missing,
      `the change log does not name these FIXED tasks:\n  ${missing.join('\n  ')}`
    ).toEqual([]);
  });

  it('states the phase status in the log itself, as a status and not a mention (B-04)', () => {
    /*
     * `B-04`. `toContain('OWNER ACCEPTANCE: FAIL')` is satisfied by a past-tense
     * narrative sentence — which is the precise hole the acceptance guard below
     * was rewritten to close, in `evidence/task-traceability.md`, where the only
     * occurrence of the string was a sentence about a superseded event. The same
     * weak form survived here.
     *
     * The canonical line is required instead: one exact, greppable statement of
     * where the phase stands now.
     */
    const log = read('evidence', 'change-log.md');
    expect(log, 'the change log states no CURRENT status line').toContain(CURRENT_STATUS_LINE);
  });
});

/**
 * The Owner-acceptance guard.
 *
 * Separated from the task-count guard on purpose, because conflating them is
 * what broke it. "Are the tasks resolved?" is derived from a table and changes
 * as work lands. "Has the Owner accepted the phase?" is a human act, is not
 * derivable from anything in this repository, and does not become true because
 * a count reached its maximum.
 *
 * The previous version nested the Owner check inside `if (open + blocked > 0)`,
 * so it evaporated on the commit that closed the last task — the exact moment a
 * premature closure claim becomes both likely and dangerous. An adversarial
 * review then found three further holes: `OWNER ACCEPTANCE: PASS` was banned
 * nowhere; the banned spelling (`PASS=42`) is one no document in this phase
 * uses, while five unbanned spellings of the identical claim were already on the
 * page; and `P1-27 CLOSED GO` — *this repository's actual closure vocabulary,
 * used by every earlier phase* — was not covered at all.
 *
 * So this describe is UNCONDITIONAL. Lifting it requires the Owner's verdict and
 * a deliberate edit here, which is a reviewable diff rather than a silent
 * arithmetic side effect.
 */
describe('no phase document may claim an acceptance the Owner has not given', () => {
  const GUARDED = [
    'final-task-adjudication.md',
    'evidence/task-traceability.md',
    'evidence/change-log.md',
    'adversarial-round-five.md',
    'clean-room-evidence.md',
    'ci-evidence.md',
  ];

  /**
   * Closure vocabulary, in the forms this repository actually writes.
   *
   * Whitespace-insensitive and case-insensitive: `PASS = 42` evades a substring
   * ban on `PASS=42`, and the document's own fenced blocks are spaced.
   */
  const CLOSURE_CLAIMS: readonly { pattern: RegExp; what: string }[] = [
    { pattern: /OWNER\s+ACCEPTANCE:\s*PASS/i, what: 'an Owner acceptance' },
    { pattern: /PHASE\s+1-27\s+OFFICIALLY\s+CLOSED/i, what: 'official closure' },
    { pattern: /P1-27\s+CANONICAL\s+SCOPE\s+VERIFIED/i, what: 'canonical scope verified' },
    { pattern: /P1-27\s+CLOSED(\s+GO)?\b/i, what: "this repository's own closure banner" },
    { pattern: /PHASE\s+1-27\s+CLOSED/i, what: 'phase closure' },
    { pattern: /\bP1-G27\b.*\bGO\b/i, what: 'a gate-record Go' },
    { pattern: /\b100\s*\/\s*100\s+VERIFIED/i, what: 'a verification banner' },
  ];

  /**
   * A line states the RULE or the HISTORY rather than making the claim.
   *
   * Both are legitimate and both must stay: the rule sentence ("closes only when
   * the Owner returns `OWNER ACCEPTANCE: PASS`") is what keeps the phase open,
   * and the history is required to be preserved rather than deleted. A guard
   * that cannot tell a claim from its own denial would force the record to erase
   * itself to stay green — which happened twice already.
   */
  const RULE_OR_HISTORY =
    /^\s*>|\bonly when\b|\bonly after\b|\buntil\b|\bawait|\bpending\b|\brequires\b|\breturns?\b|\bwould\b|\bmust not\b|\bmay not\b|\bcannot\b|\bnot\b.{0,40}\bclaim|\bpreviously\b|\bused to\b|\bwas written\b|\bsuperseded\b|\bretract|\bwithdraw|\bhistorical\b|\bbanned\b|\bforbidden\b|\bnever\b/i;

  it('states the CURRENT status in an unambiguous, greppable line', () => {
    /*
     * Presence of the string is not enough, and that was a real hole: in
     * `evidence/task-traceability.md` the only occurrence of
     * `OWNER ACCEPTANCE: FAIL` was a past-tense narrative about a superseded
     * event — "the Product Owner then tested the merged application by hand and
     * returned `OWNER ACCEPTANCE: FAIL`". A reader could have changed the
     * surrounding text to announce a Pass and the guard would have stayed green
     * on that historical sentence.
     *
     * One exact canonical line, in every guarded document, is the fix.
     */
    for (const doc of GUARDED) {
      const text = read(...doc.split('/'));
      expect(
        text,
        `${doc} carries no canonical current-status line; a narrative mention of the string is not a status`
      ).toContain(CURRENT_STATUS_LINE);
    }
  });

  it('makes no closure claim anywhere, whatever the task count says', () => {
    /*
     * PARAGRAPH scope, not line scope.
     *
     * A line-scoped version failed on the rule sentence itself, because Prettier
     * wraps prose: "P1-27 closes only when the Product Owner … explicitly returns
     * `OWNER ACCEPTANCE: PASS`" puts the qualifier two lines above the phrase.
     * Judging a wrapped sentence by one of its lines reads half a clause.
     *
     * The residual risk is stated rather than hidden: a paragraph containing both
     * a rule and a fresh claim is exempted by the rule. Paragraphs here are short,
     * and the alternative — sentence splitting over Markdown with inline code,
     * tables and abbreviations — has more ways to be wrong than this has.
     */
    const violations: string[] = [];
    for (const doc of GUARDED) {
      const text = read(...doc.split('/'));
      let line = 1;
      for (const paragraph of text.split(/\n\s*\n/)) {
        const start = line;
        line += paragraph.split('\n').length + 1;
        if (RULE_OR_HISTORY.test(paragraph)) continue;
        for (const claim of CLOSURE_CLAIMS) {
          const hit = claim.pattern.exec(paragraph);
          if (hit) violations.push(`${doc}:~${start} asserts ${claim.what} — "${hit[0]}"`);
        }
      }
    }
    expect(
      violations,
      'a phase document claims an acceptance or closure the Owner has not given'
    ).toEqual([]);
  });

  it('is not vacuous — it can see the strings it bans', () => {
    /*
     * Without this the case above passes over documents it failed to read, and
     * over a `RULE_OR_HISTORY` pattern so wide that every line is exempt. Both
     * were live risks: the exemption matches common words on purpose.
     */
    for (const doc of GUARDED) {
      expect(read(...doc.split('/')).length, `${doc} is empty`).toBeGreaterThan(200);
    }
    const sample = 'The gate record reads P1-27 CLOSED GO and the phase is done.';
    expect(RULE_OR_HISTORY.test(sample), 'the exemption swallows a plain claim').toBe(false);
    expect(CLOSURE_CLAIMS.some((c) => c.pattern.test(sample))).toBe(true);

    const ruled = 'The phase closes only when the Owner returns OWNER ACCEPTANCE: PASS.';
    expect(RULE_OR_HISTORY.test(ruled), 'the rule sentence must stay permitted').toBe(true);
  });

  it('bans the spaced and cased spellings, not one literal', () => {
    // `PASS=42` was the banned form; the documents write `RESOLVED / 42 = 42`,
    // "42 of 42" and `PASS = 42`. A ban on a spelling nobody uses is decoration.
    for (const text of ['OWNER ACCEPTANCE:   pass', 'Phase 1-27 Officially Closed']) {
      expect(CLOSURE_CLAIMS.some((c) => c.pattern.test(text))).toBe(true);
    }
  });
});

describe('QA-005 — the evidence records point at this branch', () => {
  it('records a clean-room result that says something about this branch (B-04)', () => {
    /*
     * `B-04`. `existsSync` is satisfied by an empty file, and the task it stands
     * for — `QA-005` — is about whether the recorded evidence describes the tree
     * under review. A path is not a record.
     *
     * The strong form of this property lives in
     * `tests/ci/p1-27-evidence-manifest.test.ts`, which drives the two honest
     * states of the document (superseded, or naming a full candidate head). What
     * belongs HERE is the part that case cannot see: that the file a reader of
     * the phase directory opens is a clean-room record for P1-27, not a stub.
     */
    const path = join(PHASE, 'clean-room-evidence.md');
    expect(existsSync(path), 'QA-005 names a record this phase does not ship').toBe(true);
    const record = read('clean-room-evidence.md');
    expect(record.length, 'the clean-room record is a stub').toBeGreaterThan(1000);
    expect(record, 'the record names no candidate-head field').toContain('CODE_CANDIDATE_SHA');
    expect(record, 'the record does not state the current phase status').toContain(
      CURRENT_STATUS_LINE
    );
  });

  it('asserts no closure while the adjudication still lists open tasks', () => {
    /*
     * The rule the phase brief states plainly: documentation must not claim
     * completion until the live derived audit reaches it.
     *
     * Checked against CLOSURE PHRASES, not against the bare string "42/42".
     * The first version of this case matched the number and failed on
     * `final-task-adjudication.md`'s own sentence "P1-27 is not at 42/42 and this
     * document does not claim it is" — a denial, and on the change log's
     * progression table, which records the original claim because §16 requires
     * the mistakes to be preserved. A rule that cannot tell an assertion from a
     * denial would force the record to delete its own history to stay green.
     *
     * Driven from the adjudication table, so the claim and the count cannot
     * disagree — which is how "42/42" came to be written the first time.
     */
    const adjudication = read('final-task-adjudication.md');
    const open = (adjudication.match(/\|\s*OPEN\b/g) ?? []).length;
    const blocked = (adjudication.match(/\|\s*BLOCKED\b/g) ?? []).length;

    /*
     * Only phrases that can ONLY be an assertion.
     *
     * `OWNER ACCEPTANCE: PASS` was in this list and had to come out: it appears
     * legitimately in the RULE — "P1-27 closes only when the Product Owner
     * manually tests the real application and explicitly returns
     * `OWNER ACCEPTANCE: PASS`" — which is the sentence that keeps the phase
     * open. Two versions of this case in a row could not tell a claim from its
     * own denial; the discriminator has to be a string with no honest use until
     * closure.
     */
    const CLOSURE_BANNERS = [
      'P1-27 CANONICAL SCOPE VERIFIED',
      'PHASE 1-27 OFFICIALLY CLOSED',
      'PASS=42',
      'FAIL=0',
    ];

    const DOCS = [
      'final-task-adjudication.md',
      'evidence/task-traceability.md',
      'evidence/change-log.md',
    ];

    for (const doc of DOCS) {
      const text = read(...doc.split('/'));

      /*
       * The task-count banners are forbidden only while rows contradict them.
       * `PASS=42` is a lie with an OPEN row on the page and a fact without one,
       * so the rule has to read the rows rather than ban the string outright.
       */
      if (open + blocked > 0) {
        for (const phrase of CLOSURE_BANNERS) {
          expect(
            text,
            `${doc} asserts "${phrase}" while ${open} open and ${blocked} blocked task(s) remain`
          ).not.toContain(phrase);
        }
      }

      /*
       * The Owner status is required UNCONDITIONALLY, and that is the point of
       * this edit.
       *
       * It used to sit inside the `open + blocked > 0` branch, which made the
       * whole guard evaporate at exactly the moment it mattered: the commit that
       * closes the last task takes the count to zero, and from then on these
       * records could have stopped saying the phase was unaccepted without a
       * single test noticing. A guard that switches itself off on success is the
       * defect class this phase has spent four rounds removing — this one was in
       * a file written to catch it.
       *
       * Forty-two tasks passing is a statement about tasks. Acceptance is the
       * Owner's, is not derivable from any count, and cannot be inferred from
       * silence.
       */
      expect(text, `${doc} does not state the current Owner status`).toContain(
        'OWNER ACCEPTANCE: FAIL'
      );

      // Phase-closure banners are never permissible ahead of an Owner Pass, no
      // matter what the task rows say.
      for (const phrase of ['PHASE 1-27 OFFICIALLY CLOSED', 'P1-27 CANONICAL SCOPE VERIFIED']) {
        expect(text, `${doc} declares the phase closed without an Owner Pass`).not.toContain(
          phrase
        );
      }
    }

    /*
     * Vacuity check. This counts TASK ROWS, not unresolved ones — the earlier
     * version asserted `open + blocked > 0`, which conflated "the table is
     * readable" with "something is still open" and would have gone red on the
     * commit that closed the final task.
     */
    const rows = (adjudication.match(/^\|\s*`[A-Z]+-\d{3}`\s*\|/gm) ?? []).length;
    expect(rows, 'no task rows were found in the adjudication').toBeGreaterThanOrEqual(30);
  });

  it('preserves the audit progression rather than erasing it', () => {
    // The evidence chain has to remain understandable: an initial 42/42 claim, an
    // adversarial audit that corrected it, and the remediation that followed.
    // Deleting the mistakes would leave a record nobody can check.
    const adjudication = read('final-task-adjudication.md');
    expect(adjudication).toContain('CANONICAL_TASK_PASS = 20');
    expect(adjudication).toContain('PASS_REFUTED');
    expect(adjudication).toMatch(/TRUE_PASS\s*=\s*9/);
  });
});

describe('the adjudication summary is DERIVED from its own rows', () => {
  /*
   * The defect this exists to stop, found by an adversarial recheck: the
   * document's closing prose read "Twenty-one remain open" while its own Summary
   * table listed exactly two non-closed rows. The table was maintained as work
   * landed; the sentence beneath it was not, and nothing in the repository could
   * tell them apart.
   *
   * So the prose may not state a total that the rows do not support. Note the
   * direction: this does not pin a NUMBER — pinning one would need editing every
   * time a task closes, which is the same hand-maintenance defect wearing a test
   * as a disguise. It pins the RELATIONSHIP.
   */
  const STATUS = /^\|\s*`[A-Z]+-\d{3}`\s*\|[^|]*\|\s*([A-Z][A-Za-z ()`0-9]*?)\s*\|/;

  /**
   * Written-out numbers, because that is how the offending sentence was written
   * — "Twenty-one remain open", not "21". A digit-only check would have missed
   * the very defect that prompted this.
   *
   * `none` and `zero` are here deliberately: the moment the last task closes is
   * exactly when a premature claim of completion becomes both likely and wrong,
   * and a table of number words that stops at one is a check with a blind spot
   * at the only value that matters (`B-03`).
   */
  const WORDS: Record<string, number> = {
    none: 0,
    zero: 0,
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    'twenty-one': 21,
    'twenty-two': 22,
    'twenty-three': 23,
    'thirty-three': 33,
  };

  /**
   * Every claim the prose makes about how many tasks are unresolved (`B-03`).
   *
   * The original matched `<word-or-number> remain open` and nothing else — one
   * five-word shape. With the document's blockquoted history excluded it
   * returned NOTHING, so the comparison beneath it ran over an empty list and
   * agreed with the table by construction.
   *
   * These are the forms this record actually uses. Returned as raw tokens so the
   * extractor can be exercised on its own, which is what makes the emptiness
   * above detectable rather than indistinguishable from agreement.
   */
  const COUNTED = String.raw`(?:tasks?|items?|findings?|entries|ids?)`;

  /**
   * Two shapes, both requiring the sentence to be ABOUT a countable set.
   *
   * A first attempt allowed the verb to be optional, and immediately matched
   * "20 of 20 required checks with 0 failed … and **0 open** CodeQL alerts" —
   * a true statement about security alerts read as a false claim about tasks.
   * A widened rule that invents findings is not an improvement on a narrow rule
   * that finds none, so the widening is bounded: either an explicit verb
   * (`remain`, `are`, `is`) or an explicit noun (`tasks`, `items`, `findings`).
   */
  const OPEN_TOTAL_VERB = new RegExp(
    String.raw`\b([A-Za-z-]+|\d+)\s+(?:${COUNTED}\s+)?(?:remains?|are|is)\s+(?:still\s+)?(?:open|unresolved)\b`,
    'gi'
  );
  const OPEN_TOTAL_NOUN = new RegExp(
    String.raw`\b([A-Za-z-]+|\d+)\s+(?:still\s+)?(?:open|unresolved)\s+${COUNTED}\b`,
    'gi'
  );

  function openTotalClaims(text: string): string[] {
    return (
      [...text.matchAll(OPEN_TOTAL_VERB), ...text.matchAll(OPEN_TOTAL_NOUN)]
        .map((m) => (m[1] ?? '').toLowerCase())
        // `the register is open` is not a count. Only number-shaped tokens are
        // claims about a total; everything else is ordinary prose.
        .filter((token) => /^\d+$/.test(token) || token in WORDS)
    );
  }

  function summaryRows() {
    return read('final-task-adjudication.md')
      .split('\n')
      .map((line) => STATUS.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => (m[1] ?? '').trim());
  }

  it('finds the task rows at all, so every case below can fail', () => {
    const rows = summaryRows();
    expect(rows.length, 'no `TASK-000 | verdict | status` rows matched').toBeGreaterThanOrEqual(30);
  });

  it('states no open-task total that contradicts the rows', () => {
    const rows = summaryRows();
    const unresolved = rows.filter((s) => /^(OPEN|BLOCKED)/.test(s)).length;

    /*
     * Blockquoted lines are EXCLUDED, and that exclusion is the whole
     * difficulty. This document is required to preserve superseded claims
     * rather than delete them, so the stale sentence "Twenty-one remain open"
     * still appears — quoted, under a heading explaining that it was wrong.
     *
     * The first version of this case had no such exclusion and duly failed on
     * the document's own correction, which would have forced the record to
     * erase its history to stay green. That is exactly the trap the
     * `CLOSURE_BANNERS` case above documents hitting twice; this is the third
     * time, so it is written down rather than merely fixed.
     *
     * A quoted claim is history. An unquoted one is an assertion. Only
     * assertions are checked.
     */
    const live = read('final-task-adjudication.md')
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('>'))
      .join('\n');

    const claims = openTotalClaims(live).map((token) =>
      /^\d+$/.test(token) ? Number(token) : WORDS[token]
    );

    for (const claimed of claims) {
      if (claimed === undefined) continue; // not a number word — nothing to check
      expect(
        claimed,
        `the prose claims ${claimed} remain open; the Summary table has ${unresolved} OPEN/BLOCKED row(s)`
      ).toBe(unresolved);
    }
  });

  it('B-03: the open-total check reads every phrasing the record uses, and can fire', () => {
    /*
     * The check above matched ONE five-word shape — `<number> remain open` — and
     * the document had already been corrected past it. With the blockquoted
     * history excluded, it extracted nothing at all: a rule with an empty input
     * set, asserting that every element of the empty set agrees with the table.
     *
     * Two things were wrong and both are fixed here. The phrasings are widened
     * to the forms this record actually writes, and the EXTRACTOR is exercised
     * directly — so "no disagreement found" now means the extractor looked,
     * rather than that it had nothing to look at.
     */
    const cases: readonly [string, string | undefined][] = [
      ['Twenty-one remain open …', 'twenty-one'],
      ['21 remain open', '21'],
      ['Two remains open at the time of writing', 'two'],
      ['Seventeen are open', 'seventeen'],
      ['Two are still open', 'two'],
      ['there are 3 open tasks', '3'],
      ['nine tasks remain unresolved', 'nine'],
      ['the register is complete', undefined],
      // The bound on the widening. This sentence is on the page, is true, and
      // is not a claim about tasks — a rule that read it as one would invent a
      // finding, which is worse than the narrow rule it replaced.
      ['`ci-gate` Go, 0 open CodeQL alerts repository-wide', undefined],
      ['the merge left an open question', undefined],
      ['`QA-005` was held open by design', undefined],
    ];
    for (const [sentence, expected] of cases) {
      const found = openTotalClaims(sentence);
      expect(found[0], `"${sentence}"`).toBe(expected);
    }
  });

  it('B-03: is not dormant when the count reaches zero', () => {
    /*
     * The other half. The loop above iterates the claims it found, so a document
     * that stops claiming anything satisfies it — and the moment the last task
     * closes is exactly when a premature "zero remain open" becomes both likely
     * and wrong. The extractor must see a zero claim so the comparison happens.
     */
    expect(openTotalClaims('Zero remain open')[0]).toBe('zero');
    expect(openTotalClaims('0 remain open')[0]).toBe('0');
    expect(openTotalClaims('none are open')[0]).toBe('none');
  });

  it('does not record a task as both fixed and unresolved (B-01)', () => {
    /*
     * A CASE THAT COULD NOT FAIL.
     *
     * It read `/^FIXED/.test(status) && /^(OPEN|BLOCKED)/.test(status)` — two
     * anchored patterns on ONE string. No input satisfies both, because a string
     * cannot start with two different words, so the assertion was `false && …`
     * for every row that has ever existed and for every row that ever could.
     * It has never examined anything.
     *
     * The property is real and worth keeping: a half-applied edit leaves a cell
     * reading `FIXED 600f70e / OPEN`, which is how a status table drifts. So the
     * markers are looked for ANYWHERE in the cell, which is the only way the
     * conjunction can ever be true.
     */
    const contradictory = summaryRows().filter(
      (status) => /\bFIXED\b/i.test(status) && /\b(OPEN|BLOCKED)\b/i.test(status)
    );
    expect(contradictory, 'a status cell records a task as both fixed and unresolved').toEqual([]);
  });

  it('B-01: the contradiction check can actually fire', () => {
    // The case above passed for its whole life over a condition no string
    // satisfies. This drives the same predicate with an input that must trip it,
    // so "no contradictory rows" means "none found" rather than "none findable".
    const contradicts = (status: string) =>
      /\bFIXED\b/i.test(status) && /\b(OPEN|BLOCKED)\b/i.test(status);
    expect(contradicts('FIXED 600f70e / OPEN'), 'a half-applied edit').toBe(true);
    expect(contradicts('BLOCKED — FIXED on a branch that cannot be merged')).toBe(true);
    expect(contradicts('FIXED `600f70e`'), 'an ordinary fixed row').toBe(false);
    expect(contradicts('OPEN'), 'an ordinary open row').toBe(false);
    // And the anchored form it replaced is shown to be the tautology it was.
    const oldForm = (s: string) => /^FIXED/.test(s) && /^(OPEN|BLOCKED)/.test(s);
    expect(oldForm('FIXED 600f70e / OPEN'), 'the original conjunction, on a real defect').toBe(
      false
    );
  });
});

describe('the round-four register reconciles against its own rows', () => {
  /*
   * The register became closure evidence, so it is held to the rule it exists to
   * enforce: a summary must derive from the rows beneath it.
   *
   * It did not. The disposition table carried `MAN-01`…`MAN-04` as a RANGE, so
   * `MAN-02` and `MAN-03` appeared in the findings table and could be resolved in
   * the disposition only by a reader who already knew the range was inclusive —
   * while a hand-typed `CLOSED = 27` sat underneath asserting they were closed.
   * They were, in fact, closed. Nothing in the document could show it.
   *
   * That is the rule `task-register.md` states about itself: "a range is not
   * searchable: a reader looking for `FE-004` in a register that says
   * `FE-003`–`FE-005` finds nothing and concludes the task was never delivered."
   * The same fault, in the record written to track the round that found it.
   */
  const REGISTER = 'adversarial-round-four.md';

  function rows() {
    const doc = read(REGISTER);
    const lines = doc.split('\n');

    // `| \`ID\` | severity | \`CLASS\` | \`target\` |`
    const findings = lines
      .map((line) => /^\|\s*`([^`]+)`\s*\|\s*(?:blocking|material|cosmetic)\s*\|/.exec(line))
      .filter((m): m is RegExpExecArray => m !== null)
      .map((m) => m[1] ?? '');

    // The disposition table, read from its heading to the derived-counts block.
    const start = lines.findIndex((line) => /^## Disposition/.test(line));
    const end = lines.findIndex((line, i) => i > start && /^```/.test(line));
    const disposition: { id: string; status: string }[] = [];
    for (const line of lines.slice(start, end === -1 ? undefined : end)) {
      if (!line.startsWith('|')) continue;
      const cells = line.split('|');
      const status = (cells[2] ?? '').trim();
      for (const m of (cells[1] ?? '').matchAll(/`([^`]+)`/g)) {
        disposition.push({ id: m[1] ?? '', status });
      }
    }
    return { doc, findings, disposition };
  }

  it('dispositions every finding, individually and exactly once', () => {
    const { findings, disposition } = rows();
    expect(findings.length, 'the findings table must be findable').toBeGreaterThanOrEqual(20);

    const duplicated = findings.filter((id, i) => findings.indexOf(id) !== i);
    expect(duplicated, 'a finding id appears twice').toEqual([]);

    const dispositioned = disposition.map((r) => r.id);
    const missing = findings.filter((id) => !dispositioned.includes(id));
    expect(
      missing,
      'a finding has no disposition row of its own — a range is not searchable'
    ).toEqual([]);

    const stray = dispositioned.filter((id) => !findings.includes(id));
    expect(stray, 'the disposition names something that is not a finding').toEqual([]);
  });

  /**
   * `B-06`. A disposition is CLOSED only when the cell asserts a fix.
   *
   * The test read `/FIXED/` unanchored, so `NOT FIXED`, `not yet FIXED` and
   * `cannot be FIXED` all counted as closed — and the derived `CLOSED = n` the
   * document has to match would have counted them too. A register that reads its
   * own negations as closures is worse than one with no derivation at all,
   * because the number then looks computed.
   *
   * The cells in this document are `**FIXED** <sha> — …`, so the marker is
   * required at the START of the cell (bold markers allowed) and any negation
   * before it disqualifies the row.
   */
  const isClosed = (status: string) =>
    /^\**\s*FIXED\b/i.test(status.trim()) && !/\b(not|never|cannot|un)\s*fixed\b/i.test(status);

  it('B-06: reads a negated status as open, not as closed', () => {
    expect(isClosed('**FIXED** `04885f5` — the checkbox key'), 'an ordinary closure').toBe(true);
    expect(isClosed('NOT FIXED — deferred to P1-28'), 'a negation').toBe(false);
    expect(isClosed('not yet FIXED'), 'a negation in the middle').toBe(false);
    expect(isClosed('OPEN — cannot be FIXED without an Owner decision')).toBe(false);
    // And the unanchored form it replaced is shown to be wrong on the same rows.
    expect(/FIXED/.test('NOT FIXED — deferred to P1-28'), 'the original predicate').toBe(true);
  });

  it('states counts its rows support', () => {
    const { doc, findings, disposition } = rows();
    const closed = disposition.filter((r) => isClosed(r.status)).length;
    const open = findings.length - closed;

    expect(doc, `there are ${findings.length} findings`).toContain(
      `FINDINGS   = ${findings.length}`
    );
    expect(doc, `${closed} are closed`).toContain(`CLOSED     = ${closed}`);
    expect(doc, `${open} remain open`).toContain(`OPEN       = ${String(open).padStart(2)}`);
  });
});

describe('the manifest states counts the repository can confirm', () => {
  /*
   * `MAN-01`…`MAN-04`. Four figures in `deliverable-manifest.md` were wrong at
   * once, and every one of them is countable in a second:
   *
   *   - the ownership gate's file count (said 40, reports 43) — quoted as gate
   *     OUTPUT, in the document the `DOC-001` fix edited to close that very
   *     desync and closed everywhere except inside itself;
   *   - `scripts/ci` (said 40, holds 41), while `final-task-adjudication.md`
   *     said 41 and treated it as settled — two canonical records disagreeing
   *     about a directory listing;
   *   - the CRM and vehicle source trees (said 18 and 22, hold 20 and 23),
   *     omitting `profile-actions.ts`, which carries two canonical write call
   *     sites;
   *   - the web tier (said 39 files / 803 cases, runs 64 / 1208).
   *
   * A number a reader can check in a second, wrong in a document whose purpose
   * is to be checked, is worse than no number. These are derived now.
   */
  const REPO_ROOT = join(process.cwd(), '..', '..');

  function countFiles(dir: string, match: RegExp): number {
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((entry) => {
        const path = join(d, entry.name);
        if (entry.isDirectory()) return walk(path);
        // `QA005-12`: a directory symlink reports `isDirectory() === false`, so
        // an unguarded walk skips everything beyond it and every count derived
        // here would silently shrink — in the file whose purpose is to stop
        // counts drifting.
        assertNotSymlink(entry, path);
        return match.test(entry.name) ? [path] : [];
      });
    return walk(dir).length;
  }

  it('counts scripts/ci and both feature trees as they are', () => {
    const manifest = read('deliverable-manifest.md');

    const ciScripts = countFiles(join(REPO_ROOT, 'scripts', 'ci'), /\.mjs$/);
    expect(manifest, `scripts/ci holds ${ciScripts} .mjs files`).toContain(
      `**${ciScripts}** in the directory`
    );

    const crm = countFiles(join(process.cwd(), 'src', 'features', 'crm'), /\.tsx?$/);
    const vehicles = countFiles(join(process.cwd(), 'src', 'features', 'vehicles'), /\.tsx?$/);
    expect(manifest, `the CRM tree holds ${crm} files`).toContain(`crm/\` (${crm} files)`);
    expect(manifest, `the vehicle tree holds ${vehicles} files`).toContain(
      `vehicles/\` (${vehicles} files)`
    );

    /*
     * The gate's own number, from the gate's own source of truth.
     *
     * This used to add up `crm + vehicles` and hard-code "across 2 trees",
     * under a comment claiming it read the gate's source of truth. It did not:
     * it read two directory names that happened to match, so the day the gate
     * grew a third tree the check went on asserting the old total — the exact
     * fault it exists to catch, in the check that catches it.
     *
     * `SCAN_ROOTS` is exported. Walking it means the tree count and the file
     * count both follow the gate wherever it goes, and a fourth tree needs no
     * edit here.
     */
    const gateFiles = SCAN_ROOTS.reduce(
      (n: number, root: string) => n + countFiles(join(REPO_ROOT, root), /\.tsx?$/),
      0
    );
    expect(
      manifest,
      `the ownership gate reports ${gateFiles} files across ${SCAN_ROOTS.length} trees`
    ).toContain(`**${gateFiles} files across ${SCAN_ROOTS.length} trees, 0 failures**`);
  });

  it('states a web tier total that matches the tier, in BOTH places it appears', () => {
    /*
     * Not the per-file table, which is explicitly a superseded snapshot — the
     * live claims. The count appears TWICE: as the §6.1 heading and as a §3
     * summary row, and the first correction updated only the heading. Two
     * statements of one fact drift independently unless both are read.
     */
    const files = countFiles(join(process.cwd(), 'tests'), /\.test\.tsx?$/);
    const manifest = read('deliverable-manifest.md');
    expect(manifest, `§6.1 must say the web tier has ${files} files`).toContain(
      `\`apps/web/tests\` (${files} files,`
    );
    expect(manifest, `§3 must say the web tier has ${files} files`).toMatch(
      new RegExp(`Web unit and component test files\\s*\\|\\s*\\*\\*${files}\\*\\*`)
    );
  });
});

describe('every test case the traceability document quotes actually exists', () => {
  /*
   * `TRC-01`. §2 of that document defines the Proof column as "a test file and
   * the **case within it**, quoted from the test's own title". Six titles have
   * been found not to exist across two rounds — two were fixed by the `DOC-001`
   * remediation and four survived it, in the document whose entire purpose is to
   * let a reader follow a task to the thing that proves it.
   *
   * A quoted title that matches nothing is worse than no citation: a reader
   * greps for it, finds nothing, and cannot tell whether the test was deleted or
   * never written. Checked mechanically now, because it has recurred every time
   * it was fixed by hand.
   */
  const TEST_DIR = join(process.cwd(), 'tests');

  function allTestSource(): string {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) return walk(path);
        // `QA005-12`. Worse here than in a count: a skipped subtree makes titles
        // that DO exist look missing, so the sweep would invent findings.
        assertNotSymlink(entry, path);
        return /\.test\.tsx?$/.test(entry.name) ? [path] : [];
      });
    return walk(TEST_DIR)
      .map((path) => readFileSync(path, 'utf8'))
      .join('\n');
  }

  it('resolves every quoted case title to a real test', () => {
    const source = allTestSource();
    expect(source.length, 'no test source was read').toBeGreaterThan(10_000);

    /*
     * Titles are quoted in the document as "…" inside a Proof cell that also
     * names a `*.test.ts` file. Only those are checked — prose in double quotes
     * elsewhere is not a citation, and treating it as one is how a sweep starts
     * reporting sentences.
     */
    const doc = read(join('evidence', 'task-traceability.md'));

    /*
     * Only cells that name a test FILE are read for titles, and a title may
     * itself contain an escaped quote — `"treats a MISSING flag as \"…\""` — so
     * the span allows escapes. The first version did not, truncated two titles
     * at their inner quote, and reported both as missing: a sweep inventing its
     * own findings, which is the failure mode a sweep must not have.
     */
    /*
     * `B-05`. The em dash does NOT follow the filename directly.
     *
     * The Proof column writes a file, often its case count, then the dash:
     *
     *     `crm-customer-search.test.ts` (40) — "sends only the six parameters…"
     *
     * The pattern required `\s*—` immediately after the closing backtick, so
     * every cell carrying a count was skipped — 34 of 82 file-naming cells, and
     * only 136 of 239 quoted titles were ever checked. The sweep reported full
     * coverage of 57% of the citations, which is the failure mode a sweep must
     * not have: silence that reads as a clean result.
     *
     * The parenthesised count is now optional and skipped over. Nothing else is
     * permitted between the file and the dash: allowing arbitrary prose there
     * would start matching quotations that are not citations at all.
     */
    const CITATION =
      /`[\w.-]+\.test\.tsx?`\s*(?:\([^)]*\)\s*)?—\s*((?:"(?:[^"\\]|\\.)*"(?:,\s*)?)+)/g;
    const runs = [...doc.matchAll(CITATION)];
    const cited = runs
      .flatMap((run) => [...(run[1] ?? '').matchAll(/"((?:[^"\\]|\\.)*)"/g)])
      .map((m) => (m[1] ?? '').replace(/\\"/g, '"'))
      .filter((title) => title.length >= 12);
    expect(cited.length, 'no quoted case titles were found to check').toBeGreaterThan(3);

    /*
     * The coverage of the sweep is itself asserted, because "0 missing" over a
     * subset is what this case reported for its whole life. Every cell that
     * names a test file AND quotes a title must have been read.
     */
    const openings = [...doc.matchAll(/`[\w.-]+\.test\.tsx?`\s*(?:\([^)]*\)\s*)?—\s*"/g)].length;
    expect(
      runs.length,
      `${openings} citations open with a file, a dash and a quote; the pattern parsed only ` +
        `${runs.length} of them, so the rest were never checked`
    ).toBe(openings);

    // And the widening is material, not cosmetic: the previous pattern read
    // markedly fewer of the same citations.
    const previouslyRead = [
      ...doc.matchAll(/`[\w.-]+\.test\.tsx?`\s*—\s*((?:"(?:[^"\\]|\\.)*"(?:,\s*)?)+)/g),
    ].length;
    /*
     * SUPERSET, not strictly greater.
     *
     * This asserted `toBeGreaterThan`, which held only while the document still
     * carried citations in the widened shape — a filename, a case count, then
     * the dash. Those counts were stale figures, and removing them was the right
     * fix for `G-07`. A strictly-greater assertion turns that into a failure, so
     * the check would have been quietly telling the next author to keep stale
     * numbers in the document in order to stay green. A test that punishes the
     * correct change is worse than no test.
     *
     * The invariant that must ALWAYS hold is that the widened pattern reads
     * every citation the original did. The strict improvement is proved
     * separately and deterministically, on the exact cell shape that defeated
     * the old pattern, in the `B-05` case below — which is where a proof of
     * widening belongs, because it does not depend on the document's contents.
     */
    expect(
      runs.length,
      `the widened pattern reads ${runs.length} citations and must not read fewer than the ` +
        `original's ${previouslyRead}`
    ).toBeGreaterThanOrEqual(previouslyRead);

    const missing = cited.filter((title) => !source.includes(title));
    expect(missing, 'the document quotes a test case title that exists in no test file').toEqual(
      []
    );
  });

  it('B-05: reads a cell whose case count sits between the file and the dash', () => {
    // Driven on the exact shape that was skipped, so the widening is proved
    // rather than assumed — and the old pattern is shown to miss it.
    const cell = '`crm-customer-search.test.ts` (40) — "sends only the six parameters"';
    const OLD = /`[\w.-]+\.test\.tsx?`\s*—\s*"/;
    const NEW = /`[\w.-]+\.test\.tsx?`\s*(?:\([^)]*\)\s*)?—\s*"/;
    expect(OLD.test(cell), 'the original pattern skipped this cell').toBe(false);
    expect(NEW.test(cell), 'the widened pattern must read it').toBe(true);
    // And the plain form still matches, so the widening did not trade one blind
    // spot for another.
    expect(NEW.test('`crm-customer-search.test.ts` — "publishes no total"')).toBe(true);
  });
});

describe('this file is not vacuous', () => {
  it('reads real documents from the real phase directory', () => {
    const files = readdirSync(PHASE);
    expect(files).toContain('final-task-adjudication.md');
    expect(files).toContain('canonical-write-reachability.json');
    expect(read('final-task-adjudication.md').length).toBeGreaterThan(2000);
  });
});
