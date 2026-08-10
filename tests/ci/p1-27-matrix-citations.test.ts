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
 * The file a citation names, or null.
 *
 * Rooted lookup first, then a UNIQUE-SUFFIX search. The suffix search exists
 * because route paths are cited the way a reader of that feature would write
 * them — `new/[kind]/page.tsx`, `[customerId]/page.tsx` — and enumerating every
 * route directory as a root would be a list that goes stale the first time a
 * route is added.
 *
 * Uniqueness is the point, not a convenience. `plates/route.ts` matched two files
 * and `history/route.ts` matched three; a citation that identifies more than one
 * file identifies none, so an ambiguous suffix resolves to null and is reported
 * exactly like a missing one.
 */
function resolveCited(file: string): string | null {
  for (const root of CITATION_ROOTS) {
    const candidate = join(root, file);
    if (existsSync(candidate)) return candidate;
  }
  const suffix = `/${file}`;
  const matches = TRACKED.filter((p) => p === file || p.endsWith(suffix));
  return matches.length === 1 ? join(ROOT, matches[0] as string) : null;
}

interface Citation {
  readonly task: string;
  readonly field: string;
  readonly file: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Citations, harvested from every string cell of every row.
 *
 * The pattern requires a path with a directory separator so a bare `foo.ts:12`
 * written in prose is not mistaken for a citation, and it accepts both a single
 * line and a range.
 */
function citations(): Citation[] {
  const parsed = JSON.parse(readFileSync(MATRIX, 'utf8')) as
    { tasks?: Record<string, unknown>[] } | Record<string, unknown>[];
  const rows = Array.isArray(parsed) ? parsed : (parsed.tasks ?? []);
  /*
   * Segments may contain brackets and parentheses.
   *
   * The first spelling of this used `[\w.-]+` per segment, which cannot cross
   * `[customerId]` or `(dashboard)` — so a fully-qualified Next.js route path
   * matched only its TAIL, and the check then reported the tail as an
   * unresolvable file. It was reporting the citations that had just been made
   * unambiguous as the broken ones.
   */
  const pattern =
    /((?:[\w.()[\]-]+\/)+[\w.()[\]-]+\.(?:ts|tsx|mjs|js|sql|json|md|yml)):(\d+)(?:-(\d+))?/g;
  const out: Citation[] = [];
  for (const row of rows) {
    const task = String((row as Record<string, unknown>).TASK_ID ?? '?');
    for (const [field, value] of Object.entries(row as Record<string, unknown>)) {
      if (typeof value !== 'string') continue;
      for (const m of value.matchAll(pattern)) {
        const from = Number(m[2]);
        out.push({ task, field, file: m[1] as string, from, to: Number(m[3] ?? m[2]) });
      }
    }
  }
  return out;
}

const ALL = citations();

describe('P1-27 — every matrix citation resolves', () => {
  it('finds citations at all, so nothing below passes over an empty list', () => {
    // Anti-vacuity. A regex that matched nothing would make every case here
    // green while asserting nothing, which is the shape this file exists to stop.
    expect(ALL.length, 'the matrix carries no file:line citation at all').toBeGreaterThan(50);
  });

  it('cites only files that exist', () => {
    const missing = ALL.filter((c) => resolveCited(c.file) === null).map(
      (c) => `${c.task}.${c.field} -> ${c.file}`
    );
    expect(missing, 'a matrix cell cites a file that is not in the repository').toEqual([]);
  });

  it('cites only lines that exist in the file it names', () => {
    const overshoot: string[] = [];
    for (const c of ALL) {
      const path = resolveCited(c.file);
      if (path === null) continue;
      const lines = readFileSync(path, 'utf8').split(/\r?\n/).length;
      if (c.to > lines || c.from < 1 || c.from > c.to) {
        overshoot.push(`${c.task}.${c.field} -> ${c.file}:${c.from}-${c.to} (file has ${lines})`);
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
      const body = readFileSync(path, 'utf8')
        .split(/\r?\n/)
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
