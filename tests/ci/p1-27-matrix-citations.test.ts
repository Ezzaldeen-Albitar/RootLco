import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `file:line` citation in the 42-task matrix must point at something real.
 *
 * ## The defect this exists for
 *
 * The matrix is the document the PASS rule is applied against, and its cells cite
 * evidence as `path/to/file.ts:120-134`. Line numbers are the least stable thing
 * in a repository: five branches landed in one wave, one of them added 580 lines
 * near the top of `p1-27-security.test.ts`, and every citation below that point
 * silently began describing a different piece of code.
 *
 * It had already happened once in the other direction. A regeneration re-pinned
 * twenty-three rows from a stale range to a range that was NOT the assertion they
 * described — the new target was a helper and a docblock — inside the same commit
 * whose headline was "31 stale citations re-pinned". Nothing could tell, because
 * nothing read a citation.
 *
 * ## What this checks, and what it deliberately does not
 *
 * It cannot know whether a cited range proves the sentence beside it; that is a
 * judgement. It can know three things that are facts:
 *
 *   1. the cited file exists;
 *   2. the cited lines exist in it;
 *   3. a citation into a TEST file lands on at least one `expect(` — because a
 *      citation whose range holds no assertion is, whatever else it is, not
 *      evidence.
 *
 * The third is the one that catches the failure above. A range covering a
 * docblock, an import block or a helper passes the first two and fails this.
 */

const ROOT = join(process.cwd());
const MATRIX = join(ROOT, 'docs', 'phase-1', 'phase-1-27', 'task-matrix.json');

/**
 * Where a cited path may be rooted.
 *
 * The matrix cites in the spelling a reader of that file would use, which for the
 * web application is workspace-relative (`lib/api/client.ts`, `tests/…`) and for
 * repository tooling is repository-relative (`scripts/ci/…`, `docs/…`). Both are
 * legitimate; a check that knew only one would report fifty-nine false failures
 * and teach the next author that this file is noise.
 *
 * Ordered most specific first so a name existing under two roots resolves the way
 * a reader would read it.
 */
const CITATION_ROOTS = [ROOT, join(ROOT, 'apps', 'web'), join(ROOT, 'apps', 'api')];

/**
 * Every tracked file, once, as a repository-relative POSIX path.
 *
 * `git ls-files` rather than a walk: a citation must point at something the
 * repository actually carries, and a build artefact under `.next` or a file in
 * `node_modules` is not evidence even when it exists on this disk.
 */
const TRACKED: string[] = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

/**
 * What a citation's path resolved to, and when it did not, why.
 *
 * The two failure modes are reported apart because they need different repairs.
 * ABSENT means the file is gone or misspelled — repoint or drop the cell.
 * AMBIGUOUS means the name is real but shared, and the repair is to qualify the
 * citation with enough leading path to single one out; the candidates are
 * carried so the message can name them and the repair needs no second search.
 */
type Resolution =
  | { readonly kind: 'FOUND'; readonly path: string }
  | { readonly kind: 'ABSENT' }
  | { readonly kind: 'AMBIGUOUS'; readonly candidates: readonly string[] };

/**
 * The file a citation names, or why it names none.
 *
 * Rooted lookup first, then a UNIQUE-SUFFIX search. The suffix search exists
 * because route paths are cited the way a reader of that feature would write
 * them — `new/[kind]/page.tsx`, `[customerId]/page.tsx` — and enumerating every
 * route directory as a root would be a list that goes stale the first time a
 * route is added.
 *
 * Uniqueness is the point, not a convenience. `plates/route.ts` matched two files
 * and `history/route.ts` matched three; a citation that identifies more than one
 * file identifies none, so an ambiguous suffix resolves to nothing and is
 * reported exactly like a missing one.
 *
 * `H-19` widened WHAT reaches this function — bare filenames now do — and that
 * is the whole reason the ambiguous branch matters. A bare `page.tsx` matches
 * twenty-eight tracked files; a reader following it has twenty-eight places to
 * look, which is the same as none.
 *
 * ## Why the results are cached (`H-18`)
 *
 * Not an optimisation. Widening the pattern took the corpus from 161 citations
 * to 673, and the three cases below each resolved and re-read every one of them
 * — the same file read up to twenty-three times per case. Standalone that was
 * comfortable; under a full `tests/ci` run it took `cites only lines that exist`
 * to 6225 ms against the default five-second case budget and FAILED, in the same
 * load-dependent way `H-18` records for `dependency-path-proof.mjs`.
 *
 * That file was fixed by caching its source corpus rather than by buying a
 * bigger timeout, and the reasoning transfers exactly: the work was repeated,
 * not slow, and a timeout raised over repeated work only moves the cliff. The
 * whole file now costs one resolution and one read per distinct path.
 *
 * Contents cannot change within a run — nothing here writes to the tree.
 */
const RESOLUTIONS = new Map<string, Resolution>();
const BODIES = new Map<string, string[]>();

function resolve(file: string): Resolution {
  const cached = RESOLUTIONS.get(file);
  if (cached) return cached;

  const compute = (): Resolution => {
    for (const root of CITATION_ROOTS) {
      const candidate = join(root, file);
      if (existsSync(candidate)) return { kind: 'FOUND', path: candidate };
    }
    const suffix = `/${file}`;
    const matches = TRACKED.filter((p) => p === file || p.endsWith(suffix));
    if (matches.length === 1) return { kind: 'FOUND', path: join(ROOT, matches[0] as string) };
    if (matches.length === 0) return { kind: 'ABSENT' };
    return { kind: 'AMBIGUOUS', candidates: matches };
  };

  const result = compute();
  RESOLUTIONS.set(file, result);
  return result;
}

/** A resolved file's lines, read once. */
function lines(path: string): string[] {
  const cached = BODIES.get(path);
  if (cached) return cached;
  const body = readFileSync(path, 'utf8').split(/\r?\n/);
  BODIES.set(path, body);
  return body;
}

function resolveCited(file: string): string | null {
  const r = resolve(file);
  return r.kind === 'FOUND' ? r.path : null;
}

interface Citation {
  readonly task: string;
  readonly field: string;
  readonly file: string;
  readonly from: number;
  readonly to: number;
  /**
   * The symbol the citation says its range contains, when it names one.
   *
   * `null` for a legacy citation, and legacy is not a lesser citizen: the three
   * checks above apply to an anchored and an unanchored citation identically.
   * An anchor buys one additional check and takes nothing away.
   */
  readonly anchor: string | null;
}

/*
 * Segments may contain brackets and parentheses.
 *
 * The first spelling of this used `[\w.-]+` per segment, which cannot cross
 * `[customerId]` or `(dashboard)` — so a fully-qualified Next.js route path
 * matched only its TAIL, and the check then reported the tail as an
 * unresolvable file. It was reporting the citations that had just been made
 * unambiguous as the broken ones.
 */
const SEGMENT = String.raw`[\w.()[\]-]+`;
const EXTENSION = '(?:ts|tsx|mjs|js|sql|json|md|yml)';

/**
 * `H-19`. The leading directory is OPTIONAL, and that is the whole finding.
 *
 * This pattern required at least one separator — `(?:SEGMENT\/)+` — on the
 * stated reasoning that a bare `foo.ts:12` in prose is not a citation. The
 * matrix does not write that way. It establishes a file once in full and then
 * refers back to it by basename for the rest of the row: `[customerId]/page.tsx:36-137`
 * in `IMPLEMENTATION_SURFACES`, then `page.tsx:62`, `page.tsx:82-103`,
 * `page.tsx:130` in five cells beneath it. Those are citations by every
 * definition this file uses, and they were the MAJORITY: 161 of 673 carried a
 * separator, so 512 — 76% — were never read by the check written to read them.
 *
 * Two of the invisible ones were the exact defect this file exists for.
 * `FE-001.PRODUCTION_TEST_EVIDENCE -> p1-27-qa.test.ts:82-85` is an entry in a
 * fixture TABLE and `QA-002.NEGATIVE_OR_MUTATION_PROOF -> api-client.test.ts:450-464`
 * is a DOCBLOCK. A gate reporting a clean result over a quarter of its input is
 * worse than no gate, because the clean result is what gets quoted.
 *
 * The stated risk of the widening is real and is handled by `resolve()` rather
 * than by the pattern: a bare name is only accepted when it identifies exactly
 * one tracked file. A word in prose that happens to end in `.ts:12` resolves to
 * nothing and is reported, which is the correct outcome for a citation nobody
 * can follow.
 */
const CITATION_PATTERN = new RegExp(
  String.raw`((?:${SEGMENT}\/)*${SEGMENT}\.${EXTENSION}):(\d+)(?:-(\d+))?`,
  'g'
);

/** The pattern this file shipped with, kept only to prove the widening is one. */
const NARROW_PATTERN = new RegExp(
  String.raw`((?:${SEGMENT}\/)+${SEGMENT}\.${EXTENSION}):(\d+)(?:-(\d+))?`,
  'g'
);

/**
 * ## The anchor, and the drift it exists to stop
 *
 * A line number answers "where was this when it was written". It cannot answer
 * "is it still there", and the difference is the whole history of this file:
 * twenty-three citations in these records were re-pinned in one commit because
 * the files beneath them had grown, and every one of them had been correct on
 * the day it was typed. Nothing detected the drift, because a line number that
 * still exists is indistinguishable from a line number that still means
 * something.
 *
 * So a citation may now name the construct it points at:
 *
 *     lib/api/client.ts:806-807#state.conflict.blocked.title
 *     apps/web/src/lib/api/client.ts:503#isAbort
 *
 * and the check becomes falsifiable: the cited range must literally contain the
 * token. When the file grows and the range slides off, the token stops being
 * inside it and the gate says so, naming the lines where the token now is.
 *
 * ## What this proves, and what it emphatically does not
 *
 * LOCATION ONLY. It proves a citation still points at the construct it names.
 * It cannot prove the sentence beside the citation is true, and the distinction
 * is not theoretical in this corpus: several cells point at code that still
 * exists while describing behaviour that was later changed. `H-02` is the
 * clearest. `task-matrix-verdicts.json` cells 250 and 276 both read "Resolves
 * to `state.conflict.title` (`lib/api/client.ts:369`, en.json:706); no bespoke
 * copy. Finding `H-02`" — and `adversarial-round-five.md:131` records `H-02` as
 * FIXED, closed by `fd511409`, with `apps/web/src/lib/api/client.ts:803-807`
 * now choosing `state.conflict.title` for `ERR-CON-001` alone and
 * `state.conflict.blocked.title` for every other code. The cells describe the
 * behaviour from before the fix. An anchor on either of them would pass, and
 * would be right to pass: the construct is where the citation says it is. Those
 * cells were deliberately left unanchored and unrepaired, because repairing a
 * claim is a judgement and this file makes none.
 *
 * Read a green result here as "every anchored citation still points at its
 * construct", never as "the records are true".
 *
 * ## Why the anchor is read separately from the patterns
 *
 * `CITATION_PATTERN` and `NARROW_PATTERN` stop at the digits and are left
 * exactly as they were. The anchor is read from the text FOLLOWING a match
 * rather than by widening the pattern, so an anchored citation is harvested
 * byte-for-byte identically to the unanchored spelling — same file, same
 * `from`, same `to`, same population. The `H-19` superset assertion, the
 * anti-vacuity floor and the three existing cases keep measuring precisely what
 * they measured before; adding an optional group to a pattern that other cases
 * assert counts over would have put that at risk for no gain.
 *
 * The token accepts word characters, `.`, `$`, `-` and `#`. The `#` is in the
 * set so a private class member can be anchored — `client.ts:428-520##request`
 * — where the FIRST `#` is the delimiter and `#request` is the token.
 */
const ANCHOR_TOKEN_CHARACTER = String.raw`[\w.$#-]`;

/** The anchor that follows a citation, when a well-formed one does. */
const ANCHOR_SUFFIX = new RegExp(String.raw`^#(${ANCHOR_TOKEN_CHARACTER}+)`);

/**
 * A `#` that opens no token: `client.ts:759#`, `client.ts:759# `, ``client.ts:759#` ``.
 *
 * A SEPARATE detector, and separate on purpose. Written as an optional group on
 * the harvest — `(?:#(TOKEN))?` — a malformed anchor is simply not captured,
 * the citation is read as legacy, and the strongest check in this file silently
 * declines to run on the one citation whose author was trying to invoke it. A
 * typo would buy a weaker gate and report nothing. This regex therefore asks
 * the opposite question — is there a `#` here that is NOT a token — and its
 * answer is an error rather than an absence.
 */
const MALFORMED_ANCHOR_PATTERN = new RegExp(
  String.raw`((?:${SEGMENT}\/)*${SEGMENT}\.${EXTENSION}):(\d+)(?:-(\d+))?#(?!${ANCHOR_TOKEN_CHARACTER})`,
  'g'
);

/** One citation as it appears in a single cell, before a task and field are attached. */
interface Harvested {
  readonly file: string;
  readonly from: number;
  readonly to: number;
  readonly anchor: string | null;
}

/**
 * Every citation in one piece of text, with its anchor when it carries one.
 *
 * Exported shape rather than an inline loop so the deterministic fixture below
 * exercises the REAL harvest against literal strings. A fixture that reimplemented
 * the parse would prove the fixture.
 */
function harvest(text: string, pattern: RegExp = CITATION_PATTERN): Harvested[] {
  const out: Harvested[] = [];
  for (const m of text.matchAll(new RegExp(pattern.source, 'g'))) {
    const tail = text.slice((m.index ?? 0) + m[0].length);
    const anchored = ANCHOR_SUFFIX.exec(tail);
    out.push({
      file: m[1] as string,
      from: Number(m[2]),
      to: Number(m[3] ?? m[2]),
      anchor: anchored === null ? null : (anchored[1] as string),
    });
  }
  return out;
}

/** Every `#` in one piece of text that follows a citation and opens no token. */
function malformedAnchorsIn(text: string): string[] {
  return [...text.matchAll(MALFORMED_ANCHOR_PATTERN)].map((m) => m[0]);
}

/** Does the cited range literally contain the token the citation names? */
function anchorHolds(anchor: string, from: number, to: number, body: readonly string[]): boolean {
  return body
    .slice(from - 1, to)
    .join('\n')
    .includes(anchor);
}

/** Every line of a file on which the token appears, so a failure is also the repair. */
function anchorSightings(anchor: string, body: readonly string[]): number[] {
  const seen: number[] = [];
  body.forEach((line, index) => {
    if (line.includes(anchor)) seen.push(index + 1);
  });
  return seen;
}

/**
 * The identity of a protected anchor: WHICH claim names WHICH symbol in WHICH file.
 *
 * The line number is deliberately absent. Re-anchoring a citation onto the same
 * construct after the file grew is the correct maintenance action and must not
 * disturb the baseline; moving the anchor onto a DIFFERENT symbol, or deleting
 * it, is a change of claim and must.
 */
function anchorIdentity(parts: {
  readonly task: string;
  readonly field: string;
  readonly file: string;
  readonly anchor: string;
}): string {
  return `${parts.task} | ${parts.field} | ${parts.file} | ${parts.anchor}`;
}

function rows(): Record<string, unknown>[] {
  const parsed = JSON.parse(readFileSync(MATRIX, 'utf8')) as
    { tasks?: Record<string, unknown>[] } | Record<string, unknown>[];
  return Array.isArray(parsed) ? parsed : (parsed.tasks ?? []);
}

/**
 * Citations, harvested from every string cell of every row.
 *
 * Accepts both a single line and a range.
 */
function citations(pattern: RegExp): Citation[] {
  const out: Citation[] = [];
  for (const row of rows()) {
    const task = String(row.TASK_ID ?? '?');
    for (const [field, value] of Object.entries(row)) {
      if (typeof value !== 'string') continue;
      for (const found of harvest(value, pattern)) {
        out.push({ task, field, ...found });
      }
    }
  }
  return out;
}

/** Every malformed anchor in the matrix, located well enough to be repaired. */
function malformedAnchors(): string[] {
  const out: string[] = [];
  for (const row of rows()) {
    const task = String(row.TASK_ID ?? '?');
    for (const [field, value] of Object.entries(row)) {
      if (typeof value !== 'string') continue;
      for (const text of malformedAnchorsIn(value)) out.push(`${task}.${field} -> ${text}`);
    }
  }
  return out;
}

const ALL = citations(CITATION_PATTERN);
const NARROW = citations(NARROW_PATTERN);
const ANCHORED = ALL.filter(
  (c): c is Citation & { anchor: string } => typeof c.anchor === 'string'
);
const MALFORMED = malformedAnchors();

/**
 * The anchors this repository refuses to lose, keyed by identity.
 *
 * Follows the convention of its neighbours in `.github/ci-baselines/`: prose
 * fields stating what the file is and why it exists, a policy, and the data.
 */
interface AnchorBaseline {
  readonly anchors: ReadonlyArray<{
    readonly key: string;
    readonly task: string;
    readonly field: string;
    readonly file: string;
    readonly anchor: string;
    readonly why: string;
  }>;
}

const ANCHOR_BASELINE = JSON.parse(
  readFileSync(join(ROOT, '.github', 'ci-baselines', 'p1-27-citation-anchors.json'), 'utf8')
) as AnchorBaseline;

describe('P1-27 — every matrix citation resolves', () => {
  it('finds citations at all, so nothing below passes over an empty list', () => {
    // Anti-vacuity. A regex that matched nothing would make every case here
    // green while asserting nothing, which is the shape this file exists to stop.
    expect(ALL.length, 'the matrix carries no file:line citation at all').toBeGreaterThan(50);
  });

  it('H-19: reads the bare-filename citations, which are most of them', () => {
    /*
     * The anti-regression for the finding, asserted on the DOCUMENT rather than
     * on a fixture, because the fault was never in the regex's ability to match
     * — it was that the corpus it was pointed at is written in the spelling it
     * excluded. A fixture-only proof would go green again the moment someone
     * re-narrowed the pattern.
     *
     * SUPERSET, not strictly greater, for the reason
     * `p1-27-doc-reconciliation.test.ts` records at `B-05`: if the matrix were
     * ever fully qualified — which is one of the two correct repairs for the
     * failures below — a strictly-greater assertion would punish the fix. The
     * invariant that must always hold is that nothing the narrow pattern read is
     * now unread. The strict improvement is proved deterministically beneath.
     */
    expect(
      ALL.length,
      `the widened pattern reads ${ALL.length} citations and must not read fewer than the ` +
        `original's ${NARROW.length}`
    ).toBeGreaterThanOrEqual(NARROW.length);

    const bare = ALL.filter((c) => !c.file.includes('/'));
    expect(
      bare.length,
      'no citation without a directory separator was read; either the matrix stopped writing ' +
        'them or the pattern narrowed back'
    ).toBeGreaterThan(0);
  });

  it('H-19: the narrow pattern cannot see a bare-filename citation, and this one can', () => {
    // Deterministic, so the widening is proved rather than inferred from a
    // document that may be rewritten tomorrow.
    const cell = 'asserted at `profile-api.ts:47-49` and `apps/web/lib/x.ts:10-20`.';
    const narrow = [...cell.matchAll(new RegExp(NARROW_PATTERN.source, 'g'))].map((m) => m[1]);
    const wide = [...cell.matchAll(new RegExp(CITATION_PATTERN.source, 'g'))].map((m) => m[1]);
    expect(narrow, 'the original pattern skipped the bare citation').toEqual(['apps/web/lib/x.ts']);
    expect(wide, 'the widened pattern must read both').toEqual([
      'profile-api.ts',
      'apps/web/lib/x.ts',
    ]);
  });

  it('cites only files that exist, and only names that identify ONE of them', () => {
    /*
     * Ambiguity is a failure, not a near miss. A cell citing `page.tsx:62` names
     * twenty-eight tracked files; a reader following it has to guess, and the
     * cell reads as evidence while proving nothing. The repair is to qualify the
     * citation with enough leading path to single one out, so the candidates are
     * named here — the message is the repair instruction.
     */
    const unresolved: string[] = [];
    for (const c of ALL) {
      const r = resolve(c.file);
      if (r.kind === 'FOUND') continue;
      const where = `${c.task}.${c.field} -> ${c.file}:${c.from}-${c.to}`;
      unresolved.push(
        r.kind === 'ABSENT'
          ? `${where} — no such tracked file`
          : `${where} — AMBIGUOUS across ${r.candidates.length}: ${r.candidates.slice(0, 4).join(', ')}${r.candidates.length > 4 ? ', …' : ''}`
      );
    }
    expect(
      unresolved,
      'a matrix cell cites a file that is not in the repository, or a bare name that identifies ' +
        'more than one file'
    ).toEqual([]);
  });

  it('cites only lines that exist in the file it names', () => {
    const overshoot: string[] = [];
    for (const c of ALL) {
      const path = resolveCited(c.file);
      if (path === null) continue;
      const length = lines(path).length;
      if (c.to > length || c.from < 1 || c.from > c.to) {
        overshoot.push(`${c.task}.${c.field} -> ${c.file}:${c.from}-${c.to} (file has ${length})`);
      }
    }
    expect(overshoot, 'a matrix cell cites a line past the end of the file').toEqual([]);
  });

  it('lands on an assertion when it cites a test file', () => {
    /*
     * The discriminating case. A range that holds no `expect(` is not evidence,
     * however true the sentence beside it may be — and the twenty-three rows that
     * pointed at a helper and a docblock passed every other check here.
     *
     * Single-line citations are exempt: pointing at one line of a suite is a
     * pointer to a place, not a claim that the line is the assertion.
     */
    const offenders: string[] = [];
    for (const c of ALL) {
      if (!/\.test\.tsx?$/.test(c.file)) continue;
      if (c.to === c.from) continue;
      const path = resolveCited(c.file);
      if (path === null) continue;
      const body = lines(path)
        .slice(c.from - 1, c.to)
        .join('\n');
      if (!body.includes('expect(')) {
        offenders.push(`${c.task}.${c.field} -> ${c.file}:${c.from}-${c.to} holds no expect(`);
      }
    }
    expect(offenders, 'a matrix cell cites a range of a test file that asserts nothing').toEqual(
      []
    );
  });

  it('an anchored citation still contains the symbol it names', () => {
    /*
     * The fourth check, and the only one that can detect drift rather than
     * absence. The three above ask whether a target exists; this one asks
     * whether the target is still the thing the sentence beside it is about.
     *
     * The message carries the repair. A drifted anchor is almost always a
     * WORKING citation that slid by a few lines when the file grew, so the
     * lines where the token now lives are the new range — naming them means the
     * next author does not have to re-run the search this case has already run.
     * When the token is nowhere in the file at all, that is a different fault
     * (renamed or deleted construct, or an anchor typed against the wrong file)
     * and it is reported as a different sentence, because the repair is
     * different too: it is a judgement about the claim, not a line number.
     *
     * Anti-vacuity sits inside this case rather than beside it. An empty
     * `ANCHORED` would make `offenders` trivially empty and this case would
     * report a clean anchor corpus while reading none.
     */
    const offenders: string[] = [];
    for (const c of ANCHORED) {
      const path = resolveCited(c.file);
      if (path === null) continue;
      const body = lines(path);
      if (anchorHolds(c.anchor, c.from, c.to, body)) continue;
      const where = anchorSightings(c.anchor, body);
      const at = `${c.task}.${c.field} -> ${c.file}:${c.from}-${c.to}#${c.anchor}`;
      offenders.push(
        where.length === 0
          ? `${at} — \`${c.anchor}\` appears NOWHERE in ${c.file}; the construct was renamed or removed, or the anchor names the wrong file`
          : `${at} — \`${c.anchor}\` is not in the cited range; it is at ${where.length > 6 ? `${where.slice(0, 6).join(', ')}, … (${where.length} lines)` : where.join(', ')}`
      );
    }
    expect(
      ANCHORED.length,
      'no anchored citation was read, so this case asserted nothing'
    ).toBeGreaterThan(0);
    expect(
      offenders,
      'an anchored matrix citation no longer contains the symbol it names — the range drifted'
    ).toEqual([]);
  });

  it('refuses a malformed anchor instead of reading the citation as legacy', () => {
    /*
     * The failure mode this stops is silent DOWNGRADE. `client.ts:759#` is a
     * citation whose author reached for the anchor check and mistyped; read
     * through an optional group it is a perfectly ordinary legacy citation, and
     * the strongest check in this file declines to run on it while reporting
     * green. A gate that quietly does less on a typo is worse than one that
     * does less always, because nobody can see the difference.
     */
    expect(
      MALFORMED,
      'a citation is followed by a `#` that opens no anchor token; either complete the anchor ' +
        'or remove the `#` — it must not fall back to an unanchored citation'
    ).toEqual([]);
  });

  it('keeps every anchor the baseline protects, by identity and not by count', () => {
    /*
     * The ratchet. `.github/ci-baselines/p1-27-citation-anchors.json` names the
     * anchors that must go on existing and go on resolving.
     *
     * Keyed by TASK_ID, field, cited file and token — and NOT by line number,
     * which is the entire point: re-anchoring `client.ts:806-807#foo` to
     * `client.ts:812-813#foo` after the file grows is the maintenance this
     * mechanism is FOR, and it must not read as a loss. Moving the anchor onto
     * a different symbol, or deleting it, is a change of claim and does.
     *
     * An aggregate cannot satisfy this. A count-based ratchet is payable in the
     * wrong currency: delete the anchor from the row that mattered, add one to a
     * row that did not, and the total is restored while the protection is gone.
     * Every key is looked for individually, so the only thing that discharges an
     * entry is that entry.
     *
     * There is NO `--update` flag and nothing regenerates this file. Removing a
     * protected anchor is a hand edit to a committed baseline, reviewed like any
     * other. That is deliberate friction: the twenty-three drifted citations
     * this mechanism was built for were all produced by a regeneration nobody
     * read.
     */
    const present = new Map(ANCHORED.map((c) => [anchorIdentity(c), c]));

    const inconsistent = ANCHOR_BASELINE.anchors.filter((e) => e.key !== anchorIdentity(e));
    expect(
      inconsistent.map((e) => e.key),
      'a baseline entry`s `key` disagrees with its own task/field/file/anchor fields, so it ' +
        'protects something other than what it reads as protecting'
    ).toEqual([]);

    const missing: string[] = [];
    const drifted: string[] = [];
    for (const entry of ANCHOR_BASELINE.anchors) {
      const found = present.get(entry.key);
      if (found === undefined) {
        missing.push(`${entry.key} — ${entry.why}`);
        continue;
      }
      const path = resolveCited(found.file);
      if (path === null || !anchorHolds(found.anchor, found.from, found.to, lines(path))) {
        drifted.push(`${entry.key} — present at :${found.from}-${found.to} but not resolving`);
      }
    }

    expect(
      ANCHOR_BASELINE.anchors.length,
      'the anchor baseline is empty, so this ratchet protects nothing'
    ).toBeGreaterThan(0);
    expect(
      missing,
      'a protected citation anchor is gone from the matrix. Adding an anchor elsewhere does not ' +
        'pay for it. If the removal is intended, edit .github/ci-baselines/p1-27-citation-anchors.json ' +
        'by hand and say why in the commit'
    ).toEqual([]);
    expect(drifted, 'a protected citation anchor is present but no longer resolves').toEqual([]);
  });

  it('discriminates: proves the anchor check on literal text, not only on the records', () => {
    /*
     * Deterministic, for the reason `H-19` is proved deterministically a few
     * cases above: a proof that lives only on the live documents evaporates the
     * moment the documents are rewritten, and these documents are rewritten
     * often. The three properties are asserted against literal strings and a
     * literal body, so they hold whatever the matrix later says.
     *
     * The fourth assertion is the one that protects the three EXISTING checks:
     * an anchored citation must harvest to the same file and the same range as
     * the unanchored spelling of the same citation. If that ever stops being
     * true, `ALL.length`, the anti-vacuity floor and the `H-19` superset
     * assertion have quietly begun measuring a different population.
     */
    const body = [
      "import { join } from 'node:path';", // 1
      '', // 2
      'export function violationKeysOf(problem: ProblemDetails): string[] {', // 3
      '  return problem.violations.map((v) => v.key);', // 4
      '}', // 5
    ];

    // A valid anchor over a range that really holds the token.
    const good = harvest('proved at `lib/api/client.ts:3-4#violationKeysOf` today.');
    expect(good, 'the anchor was not read off a well-formed citation').toEqual([
      { file: 'lib/api/client.ts', from: 3, to: 4, anchor: 'violationKeysOf' },
    ]);
    expect(anchorHolds('violationKeysOf', 3, 4, body)).toBe(true);

    // The same token, a range it is not in — the drift case, which must FAIL.
    expect(anchorHolds('violationKeysOf', 1, 2, body)).toBe(false);
    expect(
      anchorSightings('violationKeysOf', body),
      'the failure message must be able to name where the token really is'
    ).toEqual([3]);

    // A token that is nowhere in the file at all — reported, not crashed.
    expect(anchorHolds('fieldErrorsOf', 1, 5, body)).toBe(false);
    expect(anchorSightings('fieldErrorsOf', body)).toEqual([]);

    // A private member: the FIRST `#` delimits, the rest is the token.
    expect(harvest('`lib/api/client.ts:428-520##request` holds it.')).toEqual([
      { file: 'lib/api/client.ts', from: 428, to: 520, anchor: '#request' },
    ]);

    // Malformed. It must be REJECTED, and must not pass as a legacy citation.
    for (const cell of [
      'see `lib/api/client.ts:759#`',
      'see lib/api/client.ts:759# for the mapping',
      'see `lib/api/client.ts:759#` for the mapping',
    ]) {
      expect(harvest(cell)[0]?.anchor, `${cell}: a broken anchor was captured as one`).toBe(null);
      expect(
        malformedAnchorsIn(cell),
        `${cell}: a broken anchor was silently downgraded to a legacy citation`
      ).not.toEqual([]);
    }
    expect(
      malformedAnchorsIn('see `lib/api/client.ts:759#state.denied.title` for the mapping'),
      'a well-formed anchor must not be reported as malformed'
    ).toEqual([]);

    // The existing three checks must see an anchored citation exactly as they
    // see the unanchored one: same file, same from, same to, same population.
    const anchoredCell = 'a `lib/api/client.ts:806-807#state.conflict.blocked.title` b';
    const plainCell = 'a `lib/api/client.ts:806-807` b';
    const strip = (h: Harvested[]) => h.map(({ file, from, to }) => ({ file, from, to }));
    expect(
      strip(harvest(anchoredCell)),
      'an anchor changed what the unmodified patterns harvest'
    ).toEqual(strip(harvest(plainCell)));
    expect(harvest(anchoredCell, NARROW_PATTERN).length).toBe(
      harvest(plainCell, NARROW_PATTERN).length
    );
  });
});
