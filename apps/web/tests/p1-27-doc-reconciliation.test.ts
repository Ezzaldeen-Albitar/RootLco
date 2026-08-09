import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

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

  it('no longer claims seven operations are unbuilt', () => {
    // The exact sentence that was true when written and false when read.
    const traceability = read('evidence', 'task-traceability.md');
    expect(traceability).not.toContain('are simply not built');
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
  it('ships evidence/change-log.md, as every sibling phase does', () => {
    /*
     * `DOC-002` is "Operator / developer guidance AND change-log update".
     * `phase-1-19`, `-20` and `-21` each ship `evidence/change-log.md`, and two
     * inventory scripts bind the identically-titled task to that path.
     *
     * P1-27 shipped no such artefact and no document recorded a decision to drop
     * it — half a named canonical deliverable, covered by a register cell that
     * cited an automated proof which did not exist.
     */
    expect(existsSync(join(PHASE, 'evidence', 'change-log.md'))).toBe(true);
  });

  it('follows the convention its sibling phases established', () => {
    const siblings = ['phase-1-19', 'phase-1-20', 'phase-1-21'].filter((p) =>
      existsSync(join(REPO, 'docs', 'phase-1', p, 'evidence', 'change-log.md'))
    );
    // If the convention ever disappears, this stops being a convention argument
    // and somebody has to think about it again.
    expect(siblings.length, 'no sibling phase ships a change log any more').toBeGreaterThan(0);
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

  it('states the phase status in the log itself', () => {
    expect(read('evidence', 'change-log.md')).toContain('OWNER ACCEPTANCE: FAIL');
  });
});

describe('QA-005 — the evidence records point at this branch', () => {
  it('records a clean-room result', () => {
    expect(existsSync(join(PHASE, 'clean-room-evidence.md'))).toBe(true);
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
     * Written-out numbers, because that is how the offending sentence was
     * written — "Twenty-one remain open", not "21". A digit-only check would
     * have missed the very defect that prompted this.
     */
    const WORDS: Record<string, number> = {
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

    const claims = [...live.matchAll(/([A-Za-z-]+|\d+)\s+remain\s+open/gi)].map((m) => {
      const token = (m[1] ?? '').toLowerCase();
      return /^\d+$/.test(token) ? Number(token) : WORDS[token];
    });

    for (const claimed of claims) {
      if (claimed === undefined) continue; // not a number word — nothing to check
      expect(
        claimed,
        `the prose claims ${claimed} remain open; the Summary table has ${unresolved} OPEN/BLOCKED row(s)`
      ).toBe(unresolved);
    }
  });

  it('does not record a task as both fixed and unresolved', () => {
    // A row cannot be FIXED and OPEN at once. Catches a half-applied edit, which
    // is how a status table drifts in the first place.
    const rows = summaryRows();
    for (const status of rows) {
      const fixed = /^FIXED/.test(status);
      const unresolved = /^(OPEN|BLOCKED)/.test(status);
      expect(fixed && unresolved, `contradictory status cell: "${status}"`).toBe(false);
    }
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

  it('states counts its rows support', () => {
    const { doc, findings, disposition } = rows();
    const closed = disposition.filter((r) => /FIXED/.test(r.status)).length;
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
        return entry.isDirectory() ? walk(path) : match.test(entry.name) ? [path] : [];
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

    // The gate's own number, from the gate's own source of truth: the two trees
    // it walks. Quoting gate output the gate does not produce is `MAN-01`.
    expect(manifest, `the ownership gate reports ${crm + vehicles} files`).toContain(
      `**${crm + vehicles} files across 2 trees, 0 failures**`
    );
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
        return entry.isDirectory() ? walk(path) : /\.test\.tsx?$/.test(entry.name) ? [path] : [];
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
    const runs = [
      ...doc.matchAll(/`[\w.-]+\.test\.tsx?`\s*—\s*((?:"(?:[^"\\]|\\.)*"(?:,\s*)?)+)/g),
    ];
    const cited = runs
      .flatMap((run) => [...(run[1] ?? '').matchAll(/"((?:[^"\\]|\\.)*)"/g)])
      .map((m) => (m[1] ?? '').replace(/\\"/g, '"'))
      .filter((title) => title.length >= 12);
    expect(cited.length, 'no quoted case titles were found to check').toBeGreaterThan(3);

    const missing = cited.filter((title) => !source.includes(title));
    expect(missing, 'the document quotes a test case title that exists in no test file').toEqual(
      []
    );
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
