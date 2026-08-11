import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  caseCount,
  checkDocument,
  deriveCounts,
  evaluate,
} from '../../scripts/ci/check-p1-27-doc-counts.mjs';

/**
 * The gate that makes a documented count derivable rather than remembered.
 *
 * Round five found thirteen stale numbers in the phase records — `E-03` to
 * `E-12`, `G-07`, `G-08` — and they are one defect wearing thirteen faces: a
 * count written by hand that nothing recomputes. Correcting thirteen numbers
 * produces thirteen numbers that will be wrong again.
 *
 * These cases prove the gate bites, and that its honesty about `it.each` is real
 * rather than a sentence in a docblock.
 */

describe('counts are derived from the tree', () => {
  interface Derived {
    counts: Record<string, number>;
    cases: Record<string, number>;
    lines: Record<string, number>;
  }
  const derived = deriveCounts() as unknown as Derived;
  const files = (key: string): number => {
    const n = derived.counts[key];
    expect(n, `${key} is not derived at all`).toBeTypeOf('number');
    return n as number;
  };

  it('derives real, non-trivial counts', () => {
    // Without this the comparisons below could pass over an empty table, which
    // is the failure mode every absence sweep in this phase hit at least once.
    for (const key of ['scripts/ci', 'tests/ci', 'apps/web/tests', 'supabase/migrations']) {
      expect(files(key), `${key} derived as ${files(key)}`).toBeGreaterThan(3);
    }
    expect(Object.keys(derived.lines).length, 'no phase document was measured').toBeGreaterThan(20);
    expect(Object.keys(derived.cases).length, 'no test file was counted').toBeGreaterThan(40);
  });

  it('refuses a stated count that disagrees with the tree', () => {
    const wrong = `<!-- derived: files tests/ci = ${files('tests/ci') + 1} -->`;
    const problems = checkDocument('x.md', wrong, derived);
    expect(problems.length, 'a wrong count passed').toBe(1);
    expect(problems[0]).toContain('the tree holds');
  });

  it('accepts a stated count that matches', () => {
    const right = `<!-- derived: files tests/ci = ${files('tests/ci')} -->`;
    expect(checkDocument('x.md', right, derived)).toEqual([]);
  });

  it('refuses a claim about something it cannot derive, rather than passing it', () => {
    /*
     * The dangerous direction. A gate that ignored an unknown name would let a
     * document opt a number in, spell the name wrong, and be silently unchecked —
     * which is indistinguishable from being checked.
     */
    const problems = checkDocument('x.md', '<!-- derived: files tests/nowhere = 3 -->', derived);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('cannot derive');
  });
});

describe('the case count is honest about what it cannot see', () => {
  it('counts plain cases', () => {
    expect(caseCount("it('a', () => {});\nit('b', () => {});\n")).toBe(2);
    expect(caseCount("test('a', () => {});")).toBe(1);
  });

  it('does not count a case that is only mentioned in a comment', () => {
    // The seventh instance of prose-read-as-code in this phase was a gate that
    // did exactly this. Comments are stripped first.
    expect(caseCount("// it('not a real case', () => {});\nit('real', () => {});\n")).toBe(1);
    expect(caseCount("/**\n * it('documented', …)\n */\nit('real', () => {});\n")).toBe(1);
  });

  it('EXCLUDES a file using `it.each` rather than reporting a wrong number', () => {
    /*
     * `it.each` expands at runtime into one case per table row, and a static
     * count cannot know how many. Returning a number here would be wrong for
     * exactly the files that most need care — `crm-customer-search.test.ts` runs
     * 41 cases from 26 literal call sites.
     *
     * `null` removes the file from the checked set. A count that is right for
     * most files and quietly wrong for a few is worse than one that says which
     * files it covers.
     */
    expect(caseCount("it.each([[1],[2]])('x', () => {});\nit('y', () => {});\n")).toBeNull();
    expect(caseCount("test.each(rows)('x', () => {});")).toBeNull();
  });

  it('does not mistake a method call for a case', () => {
    // `.it(` and `unit(` are not cases. A boundary that matched them would
    // inflate every count in the repository.
    expect(caseCount('const n = suite.it(1);\nconst m = unit(2);\n')).toBe(0);
  });
});

describe('the live repository agrees with its own documents', () => {
  it('has no disagreement between a stated count and the tree', () => {
    const result = evaluate();
    expect(result.problems, 'a phase document states a count the tree contradicts').toEqual([]);
  });

  it('actually owns some claims, so the case above is not vacuous', () => {
    const result = evaluate();
    expect(result.claims, 'no document opts any count into the gate').toBeGreaterThan(5);
    expect(result.documents, 'no phase document was scanned').toBeGreaterThan(20);
  });
});

/* ------------------------------------------------------------------ *
 * The two evidence pages — `QA005-03`, `QA005-05`, `QA005-09`
 * ------------------------------------------------------------------ */

/**
 * `clean-room-evidence.md` and `ci-evidence.md` carry the phase's measurements,
 * and almost none of those numbers was read by anything.
 *
 * Three findings of one family are closed here.
 *
 * `QA005-03` — **"the recorded head is real" was a describe title.** The check
 * behind it was `toMatch(/^[0-9a-f]{40}$/)`, a SHAPE test that `deadbeef`
 * repeated five times satisfies perfectly. A shape is not an existence, and a
 * head nothing can resolve is not evidence of anything. Every sha these pages
 * cite is now looked up in the object database and required to be reachable
 * from the branch the record describes.
 *
 * `QA005-05` — **a substring match on a number only catches understatement.**
 * `toContain('65 web test files')` is satisfied by "165 web test files". Every
 * figure below is extracted and compared as a NUMBER, which is bounded on both
 * sides by construction: `\d+` is greedy and the match starts at the FIRST digit
 * of the run, so a longer number is captured whole and fails the comparison.
 *
 * `QA005-09` — **most figures on both pages are decorative.** They were recorded
 * from named artefacts and checked by nothing. This does not close all of it —
 * a hosted run's coverage percentage, its RLS cell count and its schema hash are
 * facts about a runner that no local check can re-derive — but every figure that
 * IS derivable is derived here, including the historical ones: a measurement of
 * a past head is checkable against that head's tree, because the tree is still
 * in the object database.
 *
 * ## Why these cases are in this file rather than one of their own
 *
 * `deliverable-manifest.md` carries `<!-- derived: files tests/ci = 39 -->`, and
 * the gate this file tests is what enforces it. A fortieth file in `tests/ci`
 * would turn that document red, and the phase directory belongs to another
 * branch. The subject is the same in either place: a number a document states
 * about this repository.
 */

const ROOT = join(__dirname, '../..');
const PHASE = 'docs/phase-1/phase-1-27';
const readRepo = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

const CLEAN_ROOM = readRepo(`${PHASE}/clean-room-evidence.md`);
const CI_EVIDENCE = readRepo(`${PHASE}/ci-evidence.md`);

/** stderr is piped rather than inherited so a deliberate miss is not noise. */
const git = (...args: string[]): string =>
  execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

/**
 * Does this repository hold `sha` as a commit?
 *
 * `QA005-03`. `^{commit}` matters: `cat-file -e` on a bare object id succeeds for
 * a blob or a tree too, and a recorded head that resolved to a blob would be as
 * useless as one that resolved to nothing.
 */
function commitExists(sha: string): boolean {
  try {
    git('cat-file', '-e', `${sha}^{commit}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether this clone was truncated, and the reason these checks state when a
 * commit is absent.
 *
 * `actions/checkout` fetches depth 1 by default. Every case below that reads a
 * SUPERSEDED head — the recorded measurements, the cited candidate — needs
 * history this repository has, and a runner may not. Locally they all passed;
 * hosted, two failed, one of them reporting
 * "78c458723671… is not a commit in this repository" about a commit that is in
 * the repository. That sentence is alarming and wrong: the commit exists, the
 * CLONE does not have it.
 *
 * So the job that runs these checks now takes `fetch-depth: 0`
 * (`.github/workflows/ci.yml`), and this exists to make the failure name the
 * real cause if that is ever undone — rather than accusing the record of citing
 * a commit that never existed, or, worse, being softened into a skip. A check
 * that cannot see its evidence must say which of the two is missing.
 */
function shallowNote(): string {
  try {
    return git('rev-parse', '--is-shallow-repository').trim() === 'true'
      ? ' — THIS CLONE IS SHALLOW, so the commit may exist and simply not be present here; the job needs `fetch-depth: 0`'
      : '';
  } catch {
    return '';
  }
}

/** Is `sha` the same commit as `ref`, or one of its ancestors? */
function isAncestorOrEqual(sha: string, ref: string): boolean {
  try {
    git('merge-base', '--is-ancestor', sha, ref);
    return true;
  } catch {
    return false;
  }
}

/** Paths under `pathspec` in the tree of `sha`, repository-relative. */
function filesAt(sha: string, pathspec: string): string[] {
  return git('ls-tree', '-r', '--name-only', sha, '--', pathspec).split('\n').filter(Boolean);
}

const webTestFilesAt = (sha: string): string[] =>
  filesAt(sha, 'apps/web/tests').filter((p) => /\.test\.tsx?$/.test(p));

/**
 * The root unit tier's files at `sha`, by the same rule the runner applies.
 *
 * `vitest.config.ts` includes `tests/**\/*.test.ts` and excludes `tests/db/**`
 * and `tests/backend/**`, which run under their own configurations against a
 * database. The rule is mirrored here and asserted against the config below, so
 * a change to either one fails rather than silently measuring a different set.
 */
const UNIT_TIER_EXCLUDED = ['tests/db/', 'tests/backend/'];
const unitTierFilesAt = (sha: string): string[] =>
  filesAt(sha, 'tests').filter(
    (p) => /\.test\.ts$/.test(p) && !UNIT_TIER_EXCLUDED.some((dir) => p.startsWith(dir))
  );

/** `*.test.ts(x)` under the WORKING tree's web suite — the live count. */
function liveWebTestFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) walk(`${dir}/${entry.name}`);
      else if (/\.test\.tsx?$/.test(entry.name)) out.push(`${dir}/${entry.name}`);
    }
  };
  walk('apps/web/tests');
  return out;
}

/** A capture group as a string. The compiler cannot know the pattern declares it. */
const group = (match: RegExpExecArray | RegExpMatchArray, index: number): string =>
  match[index] ?? '';

/** How many jobs `ci-gate` governed at `sha`, from the declaration at that head. */
function declaredJobsAt(sha: string): number {
  const source = git('show', `${sha}:scripts/ci/evaluate-ci-gate.mjs`);
  const block = /export const DECLARED_JOBS = \[([\s\S]*?)\n\];/.exec(source);
  expect(block, `${sha} declares no DECLARED_JOBS array`).not.toBeNull();
  return [...group(block as RegExpExecArray, 1).matchAll(/\{\s*id:\s*'/g)].length;
}

/**
 * The number a document states, AS A NUMBER (`QA005-05`).
 *
 * The pattern must capture the digits in group 1. Comparing the result with
 * `toBe` is what makes the assertion two-sided; `toContain` of the same digits
 * would accept any longer number containing them.
 */
function figure(source: string, pattern: RegExp, what: string): number {
  const found = pattern.exec(source);
  expect(found, `the record makes no statement matching ${what}`).not.toBeNull();
  return Number(group(found as RegExpExecArray, 1));
}

/**
 * Every commit sha the evidence pages cite, as backticked hex tokens.
 *
 * Two exclusions, both deliberate. A 64-character digest cannot match, because
 * the run has to be followed immediately by the closing backtick. An all-digit
 * token is a workflow run id — `31312531302` is legal hexadecimal and is not a
 * commit — so at least one `a`-`f` is required, which no abbreviation this
 * repository records has ever lacked.
 */
function citedHeads(...sources: string[]): string[] {
  const out = new Set<string>();
  for (const source of sources) {
    for (const m of source.matchAll(/`([0-9a-f]{7,40})`/g)) {
      const token = group(m, 1);
      if (/[a-f]/.test(token)) out.add(token);
    }
  }
  return [...out].sort();
}

/** `| \`head\` | what it recorded | why it is superseded |` — one row per head. */
interface SupersededRow {
  readonly head: string;
  readonly recorded: string;
  readonly why: string;
}
function supersededRows(source: string): SupersededRow[] {
  return [...source.matchAll(/^\|\s*`([0-9a-f]{7,40})`\s*\|([^|]*)\|([^|]*)\|\s*$/gm)].map((m) => ({
    head: group(m, 1),
    recorded: group(m, 2).trim(),
    why: group(m, 3).trim(),
  }));
}

/** The head the record describes while it declares itself superseded. */
const DESCRIBED_HEAD = /^\*\*Everything under[\s\S]{0,120}?`([0-9a-f]{40})`/m;
/** The head a CURRENT record pins, once the closing candidate exists. */
const CANDIDATE_HEAD = /CODE_CANDIDATE_SHA`?\s*\|\s*`([0-9a-f]{40})`/;

/** The head both pages are about, whichever of the two honest states they are in. */
function recordedHead(): string | undefined {
  return (CANDIDATE_HEAD.exec(CLEAN_ROOM) ?? DESCRIBED_HEAD.exec(CLEAN_ROOM))?.[1];
}

describe('P1-27-QA-005 — a recorded head is a commit this repository holds', () => {
  it('refuses a well-formed 40-character sha that names no object', () => {
    /*
     * `QA005-03`, mutation-proved. The literal below satisfies the check that
     * was there — it is forty lower-case hexadecimal characters — and names
     * nothing. If `commitExists` is ever weakened back into a shape test, this
     * is the case that dies.
     */
    const wellFormed = 'deadbeef'.repeat(5);
    expect(wellFormed, 'the fixture must satisfy the old shape check').toMatch(/^[0-9a-f]{40}$/);
    expect(commitExists(wellFormed), '`deadbeef` × 5 must not resolve to a commit').toBe(false);
    expect(commitExists(git('rev-parse', 'HEAD').trim()), 'HEAD must resolve').toBe(true);
  });

  it('finds every head the two evidence pages cite in the object database', () => {
    const heads = citedHeads(CLEAN_ROOM, CI_EVIDENCE);
    // Anti-vacuity: an empty set would agree with "none is missing" perfectly.
    expect(heads.length, 'the evidence pages cite no commit at all').toBeGreaterThanOrEqual(4);
    const missing = heads.filter((sha) => !commitExists(sha));
    expect(missing, 'a recorded head names no commit in this repository').toEqual([]);
  });

  it('requires every cited head to be reachable from the branch under test', () => {
    /*
     * Existence is not enough on its own: a commit fetched from an abandoned
     * branch exists and describes a tree this record is not about. Reachability
     * from `HEAD` is the property that makes "this is the tree that was
     * measured" checkable.
     */
    const heads = citedHeads(CLEAN_ROOM, CI_EVIDENCE);
    expect(heads.length, 'the evidence pages cite no commit at all').toBeGreaterThanOrEqual(4);
    const unreachable = heads.filter((sha) => !isAncestorOrEqual(sha, 'HEAD'));
    expect(unreachable, 'a recorded head is not an ancestor of this branch').toEqual([]);

    // And the relation is directional, so the case above cannot be passing on a
    // predicate that answers true for everything.
    expect(isAncestorOrEqual('HEAD', 'HEAD~1'), 'ancestry must not be symmetric').toBe(false);
  });

  it('pins a candidate head that exists, or says plainly that there is none yet', () => {
    /*
     * The two honest states of a clean-room record, and the guard holds in both.
     *
     * CURRENT: a closing candidate exists, `CODE_CANDIDATE_SHA` names it, and it
     * must be a real commit this branch contains.
     *
     * SUPERSEDED: the branch is still receiving code, so no measurement is
     * current. The page must say so and must still name the head it describes —
     * an unnamed head cannot be checked at all, which is how a stale record
     * survives.
     */
    const candidate = CANDIDATE_HEAD.exec(CLEAN_ROOM)?.[1];
    if (candidate === undefined) {
      expect(CLEAN_ROOM, 'no candidate is pinned and the record does not say so').toMatch(
        /^##\s+SUPERSEDED\b/m
      );
      const described = DESCRIBED_HEAD.exec(CLEAN_ROOM)?.[1];
      expect(described, 'a superseded record must still name the head it describes').toBeDefined();
      expect(
        commitExists(described as string),
        `${described} is not a commit here` + shallowNote()
      ).toBe(true);
      return;
    }
    expect(
      commitExists(candidate),
      `${candidate} is not a commit in this repository` + shallowNote()
    ).toBe(true);
    expect(isAncestorOrEqual(candidate, 'HEAD'), `${candidate} is not on this branch`).toBe(true);
  });
});

describe('P1-27-QA-005 — a stated figure is compared as a number, not as a substring', () => {
  it('shows what the substring comparison could not see', () => {
    /*
     * `QA005-05`, demonstrated rather than asserted in prose. The overstatement
     * satisfies `toContain` and is refused by the numeric comparison, which is
     * the entire difference between the two.
     */
    const overstated = 'The live web suite holds **170 web test files**, every one of';
    const pattern = /holds \*\*(\d+) web test files\*\*/;
    expect(overstated.includes('70 web test files'), 'the substring match is blind here').toBe(
      true
    );
    expect(Number((pattern.exec(overstated) as RegExpExecArray)[1])).toBe(170);
    expect(figure(overstated, pattern, 'the fixture')).not.toBe(70);
  });

  it('states the number of web test files the live tree actually holds', () => {
    const live = liveWebTestFiles().length;
    expect(live, 'the web suite was not walked at all').toBeGreaterThan(20);
    expect(
      figure(
        CLEAN_ROOM,
        /live web suite holds \*\*(\d+) web test files\*\*/,
        'the live file count'
      ),
      `apps/web/tests holds ${live} test files`
    ).toBe(live);
  });

  it('states the executed web total the committed baseline carries, wherever it repeats it', () => {
    /*
     * The figure appears twice — once in the `## Current tree` sentence and once
     * in "**The 1586 is local.**" four paragraphs down. One of them was read by
     * a test and the other was a decoration beside it, which is exactly how a
     * page comes to disagree with itself.
     */
    const baseline = JSON.parse(readRepo('.github/ci-baselines/test-count-baseline.json')) as {
      tiers: Record<string, { minTests: number; measured: number } | undefined>;
    };
    const web = baseline.tiers.web;
    expect(web, 'no committed floor for the web tier').toBeDefined();
    const executed = figure(
      CLEAN_ROOM,
      /current tree executes \*\*(\d+)\*\* tests/,
      'the current executed total'
    );
    expect(executed, 'the record and the baseline disagree').toBe(
      (web as { measured: number }).measured
    );
    expect(
      /*
       * `local` OR `HOSTED`. This pinned the WORD rather than the number, so it
       * could not survive QA-005 replacing the local figure with the hosted
       * measurement of the closing candidate — the exact transition the sentence
       * exists to describe. What this case is about is that the page does not
       * state two different executed totals; the provenance adjective is not the
       * subject.
       */
      figure(CLEAN_ROOM, /\*\*The (\d+) is (?:local|HOSTED)/, 'the restated executed total'),
      'the page states two different executed totals'
    ).toBe(executed);
    expect(executed).toBeGreaterThanOrEqual((web as { minTests: number }).minTests);
  });
});

describe('P1-27-QA-005 — a measurement of a past head is checked against that head', () => {
  it('states the test-file counts the superseded head really held', () => {
    /*
     * `QA005-09`. "1216 tests across 65 web test files" was recorded from a run
     * and read by nothing, and the file half of it is not a runner's opinion —
     * it is a property of the tree at that commit, which is still here. So it is
     * derived from `git ls-tree` at the head the page names.
     */
    const sha = recordedHead();
    expect(sha, 'the record names no head at all').toBeDefined();
    const head = sha as string;
    expect(commitExists(head), `${head} is not a commit in this repository` + shallowNote()).toBe(
      true
    );

    const web = webTestFilesAt(head).length;
    expect(web, `${head} has no web tests — the comparison would be vacuous`).toBeGreaterThan(20);
    expect(
      figure(
        CLEAN_ROOM,
        /\|\s*Web tier\s*\|\s*\*\*\d+\*\* tests, \d+ failed, across (\d+) web test files/,
        'the superseded web tier row'
      ),
      `apps/web/tests held ${web} test files at ${head.slice(0, 8)}`
    ).toBe(web);
    expect(
      figure(CLEAN_ROOM, /The web figure above was (\d+) files at that head/, 'the prose beneath'),
      'the prose restates the row and disagrees with it'
    ).toBe(web);

    const unit = unitTierFilesAt(head).length;
    expect(unit, `${head} has no unit tests — the comparison would be vacuous`).toBeGreaterThan(20);
    expect(
      figure(
        CLEAN_ROOM,
        /\|\s*Root unit tier\s*\|\s*\*\*\d+\*\* tests, \d+ failed, across (\d+) files/,
        'the superseded root unit tier row'
      ),
      `the unit tier held ${unit} files at ${head.slice(0, 8)}`
    ).toBe(unit);
  });

  it('measures the unit tier by the rule the runner actually applies', () => {
    // The set `unitTierFilesAt` walks is only the right one while the runner
    // agrees. If either glob moves, this fails instead of the counts above
    // quietly becoming a measurement of a different tier.
    const config = readRepo('vitest.config.ts');
    expect(config, 'the unit include glob moved').toContain("include: ['tests/**/*.test.ts']");
    for (const excluded of UNIT_TIER_EXCLUDED) {
      expect(config, `${excluded} is no longer excluded from the unit tier`).toContain(
        `'${excluded}**'`
      );
    }
  });

  it('states the migration count the superseded head really held', () => {
    const sha = recordedHead() as string;
    expect(commitExists(sha), `${sha} is not a commit in this repository`).toBe(true);
    const migrations = filesAt(sha, 'supabase/migrations').filter((p) => p.endsWith('.sql')).length;
    expect(migrations, 'no migrations at that head — the comparison is vacuous').toBeGreaterThan(
      50
    );
    expect(
      figure(CLEAN_ROOM, /\|\s*Migrations applied\s*\|\s*(\d+)\s*\|/, 'the migrations applied row'),
      `${sha.slice(0, 8)} carried ${migrations} migrations`
    ).toBe(migrations);
  });

  it('states the number of jobs the gate governed at that head', () => {
    /*
     * "**Go** — 13 governed jobs" is a claim about `DECLARED_JOBS` in
     * `evaluate-ci-gate.mjs` as it stood at the head under test, not as it
     * stands now. Read from that head, so the sentence stays true when the
     * declaration grows and false if it was wrong when written.
     */
    const sha = recordedHead() as string;
    expect(commitExists(sha), `${sha} is not a commit in this repository`).toBe(true);
    const governed = declaredJobsAt(sha);
    expect(governed, 'no governed jobs at that head — the comparison is vacuous').toBeGreaterThan(
      5
    );
    expect(
      figure(CI_EVIDENCE, /\*\*Go\*\* — (\d+) governed jobs/, 'the ci-gate decision row'),
      `the gate declared ${governed} jobs at ${sha.slice(0, 8)}`
    ).toBe(governed);
  });

  it('states the drift that made QA-005 necessary, in commits and in test files', () => {
    /*
     * "It stayed on this page while the tree moved 47 commits and 5 test files
     * past it" is the sentence the whole task exists for, and it was checked by
     * nothing. Both numbers are differences between two heads this page names,
     * so both are derivable — and the heads are read out of the table by what
     * their rows SAY rather than by position, so a reordering cannot silently
     * repoint the comparison.
     */
    const rows = supersededRows(CLEAN_ROOM);
    expect(rows.length, 'the superseded table lists no head').toBeGreaterThanOrEqual(2);
    const stale = rows.find((row) => /moved \d+ commits/.test(row.why));
    const briefed = rows.find((row) => /audit was briefed against/.test(row.why));
    expect(stale, 'no row states the drift').toBeDefined();
    expect(briefed, 'no row names the head the audit was briefed against').toBeDefined();

    const from = (stale as SupersededRow).head;
    const to = (briefed as SupersededRow).head;
    const commits = Number(git('rev-list', '--count', `${from}..${to}`).trim());
    const files = webTestFilesAt(to).length - webTestFilesAt(from).length;
    expect(commits, 'the two heads are the same commit').toBeGreaterThan(0);

    const drift = /tree moved (\d+) commits and (\d+) test files past it/.exec(CLEAN_ROOM);
    expect(drift, 'the record no longer states the drift').not.toBeNull();
    const statedCommits = group(drift as RegExpExecArray, 1);
    const statedFiles = group(drift as RegExpExecArray, 2);
    expect(Number(statedCommits), `${from}..${to} is ${commits} commits`).toBe(commits);
    expect(Number(statedFiles), `${from}..${to} adds ${files} web test files`).toBe(files);
  });

  it('states file counts for the earlier superseded heads that those heads really held', () => {
    /*
     * The rows kept as history are held to the same standard as the current
     * one. "web 763 / 38" and "repository 1640 / 74" are the executed totals and
     * the FILE counts; the totals are a runner's output and cannot be re-derived
     * here, the file counts are properties of a tree that is still in this
     * repository.
     */
    const problems: string[] = [];
    let compared = 0;
    for (const row of supersededRows(CLEAN_ROOM)) {
      if (!commitExists(row.head)) {
        problems.push(`${row.head} is listed and names no commit here`);
        continue;
      }
      const web = /web \d+(?: tests)? \/ (\d+)/.exec(row.recorded);
      if (web) {
        compared += 1;
        const actual = webTestFilesAt(row.head).length;
        if (Number(web[1]) !== actual) {
          problems.push(`${row.head} records ${web[1]} web test files; its tree holds ${actual}`);
        }
      }
      const repository = /repository \d+ \/ (\d+)/.exec(row.recorded);
      if (repository) {
        compared += 1;
        const actual = unitTierFilesAt(row.head).length;
        if (Number(repository[1]) !== actual) {
          problems.push(
            `${row.head} records ${repository[1]} unit files; its tree holds ${actual}`
          );
        }
      }
    }
    expect(
      compared,
      'no superseded row states a file count — this would be vacuous' + shallowNote()
    ).toBeGreaterThan(1);
    expect(problems, 'a superseded row disagrees with the tree it describes').toEqual([]);
  });
});

describe('P1-27-QA-005 — the two evidence pages agree with each other and the baselines', () => {
  it('quotes the schema hash and migration count the committed baseline carries', () => {
    /*
     * The schema hash looked like the least checkable figure on the page — a
     * sixty-four character digest produced by a hosted job. It is not: the same
     * digest is pinned in `schema-baseline.json`, which is what the replay job
     * compares against, so the record and the gate can be required to name the
     * same schema. `a677eb05…` is the hash this one REPLACED, and the note in
     * that baseline still says so, which is exactly the kind of near-miss a
     * substring comparison would have accepted.
     */
    const baseline = JSON.parse(readRepo('.github/ci-baselines/schema-baseline.json')) as {
      schemaHash?: string;
      migrationCount?: number;
    };
    expect(baseline.schemaHash, 'the schema baseline pins no hash').toMatch(/^[0-9a-f]{64}$/);
    const quoted = /\|\s*Schema hash\s*\|\s*`([0-9a-f]{64})`/.exec(CLEAN_ROOM)?.[1];
    expect(quoted, 'the record quotes no schema hash').toBe(baseline.schemaHash);
    expect(
      figure(CLEAN_ROOM, /\|\s*Migrations applied\s*\|\s*(\d+)\s*\|/, 'the migrations applied row'),
      'the record and the schema baseline disagree about the migration count'
    ).toBe(baseline.migrationCount);
  });

  it('states a CodeQL figure that both pages share and the committed ceiling permits', () => {
    /*
     * "**0**, repository-wide" appears on both pages and was read by neither.
     * The measurement itself belongs to a hosted analysis and cannot be
     * re-derived here — but `codeql-baseline.json` carries the RATCHET the gate
     * enforces, so a record claiming more open findings than the ceiling allows
     * is a record contradicting the gate beside it, and the two pages claiming
     * different numbers is the drift `QA-005` exists to catch.
     */
    const ceiling = (
      JSON.parse(readRepo('.github/ci-baselines/codeql-baseline.json')) as {
        maximumOpenFindings?: number;
      }
    ).maximumOpenFindings;
    expect(ceiling, 'the CodeQL baseline records no ceiling').toBeTypeOf('number');
    const pattern = /\|\s*CodeQL open alerts\s*\|\s*\*\*(\d+)\*\*/;
    const inClean = figure(CLEAN_ROOM, pattern, 'the clean-room CodeQL row');
    const inCi = figure(CI_EVIDENCE, pattern, 'the CI CodeQL row');
    expect(inCi, 'the two records disagree about the open CodeQL findings').toBe(inClean);
    expect(inClean, `the committed ceiling is ${ceiling}`).toBeLessThanOrEqual(ceiling as number);
  });

  it('names the same head and the same hosted run in both records', () => {
    /*
     * Two records that disagree about which tree they describe is the state this
     * phase was in: each was internally consistent and they were not consistent
     * with each other.
     */
    const inClean = recordedHead();
    const inCi = /\|\s*Head at that time\s*\|\s*`([0-9a-f]{40})`/.exec(CI_EVIDENCE)?.[1];
    expect(inClean, 'the clean-room record names no head').toBeDefined();
    expect(inCi, 'the CI record names no head').toBe(inClean);

    const run = /\|\s*Workflow run\s*\|\s*`(\d+)`/;
    const cleanRun = run.exec(CLEAN_ROOM)?.[1];
    expect(cleanRun, 'the clean-room record cites no workflow run').toBeDefined();
    expect(run.exec(CI_EVIDENCE)?.[1], 'the two records cite different runs').toBe(cleanRun);
  });

  it('records the same check totals and the same per-tier totals in both records', () => {
    const checks =
      /Required checks\s*\|\s*\*\*(\d+) completed[\s,·]+(\d+) failed[\s,·]+(\d+) pending/;
    const inClean = checks.exec(CLEAN_ROOM);
    const inCi = checks.exec(CI_EVIDENCE);
    expect(inClean, 'the clean-room record states no check totals').not.toBeNull();
    expect(inCi, 'the CI record states no check totals').not.toBeNull();
    expect(
      (inCi as RegExpExecArray).slice(1, 4),
      'the two records disagree about the checks'
    ).toEqual((inClean as RegExpExecArray).slice(1, 4));
    expect(Number((inClean as RegExpExecArray)[1]), 'zero checks completed').toBeGreaterThan(0);

    // The hosted per-tier rows and the clean-room tier rows describe the same
    // run at the same head, so they cannot differ.
    expect(
      figure(CLEAN_ROOM, /\|\s*Web tests\s*\|\s*(\d+) passed/, 'the hosted web total'),
      'the hosted and clean-room web totals disagree'
    ).toBe(figure(CLEAN_ROOM, /\|\s*Web tier\s*\|\s*\*\*(\d+)\*\* tests/, 'the web tier row'));
    expect(
      figure(CLEAN_ROOM, /\|\s*Unit tests\s*\|\s*(\d+) passed/, 'the hosted unit total'),
      'the hosted and clean-room unit totals disagree'
    ).toBe(
      figure(CLEAN_ROOM, /\|\s*Root unit tier\s*\|\s*\*\*(\d+)\*\* tests/, 'the unit tier row')
    );
  });

  it('cites the authenticated-tier run the committed baseline records', () => {
    /*
     * `H-15`'s correction rests on one hosted run, and the sentence carrying it
     * was checked by nothing. `unrun-test-tiers.json` records that run in full,
     * so the two are compared: the id, the passed and failed counts, and the
     * abbreviation — which must be a prefix of the full sha the baseline names
     * and a commit this repository holds.
     */
    /*
     * Matched against WHITESPACE-COLLAPSED text, not the raw file. The first
     * version of this check anchored on a literal space before "against
     * candidate" and a `\s*\n?` after it. Prettier wraps that paragraph in
     * between the two, so the sentence was on the page, correct, and invisible —
     * the check reported "the CI record cites no authenticated run" about a
     * record that cited it. That is `B-02` exactly, in a case written after
     * `B-02` was fixed, so the collapse is applied here rather than the regex
     * being taught this one wrap.
     */
    const cited =
      /run `(\d+)`, (\d+) tests, (\d+) failed, against candidate `([0-9a-f]{7,40})`/.exec(
        CI_EVIDENCE.replace(/\s+/g, ' ')
      );
    expect(cited, 'the CI record cites no authenticated run').not.toBeNull();
    const found = cited as RegExpExecArray;
    const runId = group(found, 1);
    const passed = group(found, 2);
    const failed = group(found, 3);
    const abbreviated = group(found, 4);

    const observation = String(
      (
        JSON.parse(readRepo('.github/ci-baselines/unrun-test-tiers.json')) as {
          hostedObservation?: string;
        }
      ).hostedObservation ?? ''
    );
    const recorded = new RegExp(
      String.raw`Run ${runId}, commit ([0-9a-f]{40}),[^.]*: PASSED\. \d+ tests planned, (\d+) passed, (\d+) failed`
    ).exec(observation);
    expect(recorded, `the baseline records no passing run ${runId}`).not.toBeNull();
    const parsed = recorded as RegExpExecArray;
    const fullSha = group(parsed, 1);
    const baselinePassed = group(parsed, 2);
    const baselineFailed = group(parsed, 3);

    expect(Number(passed), 'the record and the baseline disagree about the run').toBe(
      Number(baselinePassed)
    );
    expect(Number(failed)).toBe(Number(baselineFailed));
    expect(fullSha.startsWith(abbreviated), `${abbreviated} is not a prefix of ${fullSha}`).toBe(
      true
    );
    expect(
      commitExists(fullSha),
      `${fullSha} is not a commit in this repository` + shallowNote()
    ).toBe(true);
  });

  it('states a floor, a measurement and a headroom that agree arithmetically', () => {
    /*
     * "The floor is now 1180 against a measured 1216 — see the baseline for why
     * the headroom is 36 rather than 0 or 66." Three numbers, one of which is
     * the difference of the other two, and nothing was checking the subtraction.
     *
     * The figures are NOT compared against the live baseline: they describe the
     * run that ESTABLISHED the floor, and the floor has been raised since. What
     * is checkable without a time machine is that the page is consistent with
     * itself and with the measurement it names elsewhere.
     */
    const established = /floor is\s*\n?now (\d+) against a measured (\d+)/.exec(CI_EVIDENCE);
    expect(established, 'the CI record states no established floor').not.toBeNull();
    const floor = group(established as RegExpExecArray, 1);
    const measured = group(established as RegExpExecArray, 2);
    const headroom = figure(CI_EVIDENCE, /headroom is (\d+) rather than/, 'the headroom');
    expect(headroom, `${measured} − ${floor} is not ${headroom}`).toBe(
      Number(measured) - Number(floor)
    );
    expect(
      Number(measured),
      'the floor was established from a run whose web total this page states differently'
    ).toBe(figure(CLEAN_ROOM, /\|\s*Web tier\s*\|\s*\*\*(\d+)\*\* tests/, 'the web tier row'));
  });

  it('counts the clean-room exceptions it names', () => {
    /*
     * "two, named below" is a number written as a word, one table row above a
     * section that names them. Both halves are on the page and neither was read.
     */
    const WORDS: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5 };
    const stated = /\|\s*`validate:\*` exceptions\s*\|\s*([a-z]+), named below/.exec(CLEAN_ROOM);
    expect(stated, 'the record states no exception count').not.toBeNull();
    const word = group(stated as RegExpExecArray, 1);
    expect(Object.keys(WORDS), `"${word}" is not a number this case can read`).toContain(word);
    const named = [...CLEAN_ROOM.matchAll(/\*\*`(validate:[a-z-]+)`\.\*\*/g)].map((m) => m[1]);
    expect(new Set(named).size, 'the record names no excepted gate').toBeGreaterThan(0);
    expect(new Set(named).size, `the record says ${word} and names ${named.join(', ')}`).toBe(
      WORDS[word]
    );
  });
});
