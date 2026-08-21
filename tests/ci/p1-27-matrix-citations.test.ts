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
      for (const m of value.matchAll(new RegExp(pattern.source, 'g'))) {
        const from = Number(m[2]);
        out.push({ task, field, file: m[1] as string, from, to: Number(m[3] ?? m[2]) });
      }
    }
  }
  return out;
}

const ALL = citations(CITATION_PATTERN);
const NARROW = citations(NARROW_PATTERN);

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
});
