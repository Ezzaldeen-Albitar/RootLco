import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The root ESLint ignore list — `P1-26-F-060`, and `P1-27-F-001`.
 *
 * ## Why a test guards a list of globs
 *
 * ESLint does not read `.gitignore`. So any directory that local tooling
 * generates is walked and linted unless the flat config names it, and the
 * contents are always someone else's minified code:
 *
 * - `P1-26-F-060`: `.local/` holds the dedicated Chrome profile. Root lint
 *   walked its bundled scripts and reported **25,508 problems**.
 * - `P1-27-F-001`: `supabase/.temp/` holds the Edge Runtime bundle that
 *   `supabase start` writes. Root lint reported **154 errors** at column 30,000
 *   in `start-secrets/…/main/index.ts`.
 *
 * Both failures share a shape that makes them expensive: **hosted CI never has
 * the directory**, because CI does not run a browser profile or `supabase
 * start` before linting. So the gate is green on every pull request and red on
 * every developer machine that followed the project's own setup instructions —
 * and `npm run lint` feeds `verify:repository`, which is a required aggregate.
 *
 * The same defect arriving twice in one release is the reason this is a test
 * and not a comment. A comment explains the last one; a test fails on the next.
 */

const CONFIG = readFileSync(join(process.cwd(), 'eslint.config.mjs'), 'utf8');

/**
 * Just the globs inside `globalIgnores([...])`.
 *
 * Asserting against the whole file matched the COMMENT that explains this very
 * fix — the comment names `start-secrets` as the file that triggered it, so
 * "the config must not name a file inside the temp directory" failed on its own
 * rationale. Same trap the P1-27 security sweeps hit: a text search cannot tell
 * "does this" from "explains why it does not do this". The list is extracted so
 * the assertions read the decision rather than the prose about it.
 */
const IGNORE_LIST = (() => {
  const start = CONFIG.indexOf('globalIgnores([');
  if (start === -1) return '';
  const end = CONFIG.indexOf('])', start);
  return end === -1 ? '' : CONFIG.slice(start, end);
})();

/**
 * The recursive-glob suffix, assembled rather than written.
 *
 * Writing it literally puts the two characters that open a block comment into
 * this file, and `check-test-honesty.mjs` strips comments with
 * `/\/\*[\s\S]*?\*\//g` before counting tests. A glob literal therefore opens a
 * comment that runs to the next occurrence of the closing pair — swallowing
 * every `it()` between them and making the gate report, correctly from where it
 * stands, that this file declares no test (`TH-003`).
 *
 * The gate is not wrong to be naive here; it guards 293 files and a smarter
 * stripper is a change with that blast radius, made deliberately and verified on
 * its own. So this file keeps the two characters apart instead, and the runtime
 * value is byte-identical to the glob in the config.
 */
const STAR = '*';
const ANY = `/${STAR}${STAR}`;

/**
 * Directories that exist only on a developer machine, each created by a command
 * this repository documents. Every one must be ignored by the root config.
 */
const LOCALLY_GENERATED: readonly { glob: string; createdBy: string }[] = [
  { glob: `.next${ANY}`, createdBy: 'next build' },
  { glob: `.next-dev${ANY}`, createdBy: 'next dev' },
  { glob: `.local${ANY}`, createdBy: 'the dev launcher and acceptance bootstrap' },
  { glob: `coverage${ANY}`, createdBy: 'vitest --coverage' },
  { glob: `out${ANY}`, createdBy: 'next export' },
  { glob: `build${ANY}`, createdBy: 'a workspace build' },
  { glob: `supabase/.temp${ANY}`, createdBy: 'supabase start' },
  { glob: `supabase/.branches${ANY}`, createdBy: 'supabase branching' },
];

describe('the root ESLint config ignores every locally generated tree', () => {
  it('extracted a real ignore list to assert against', () => {
    // Without this every assertion below would pass against an empty string if
    // the helper were renamed or the extraction broke.
    expect(IGNORE_LIST).toContain('globalIgnores');
    expect(IGNORE_LIST.length).toBeGreaterThan(80);
    expect(IGNORE_LIST.length).toBeLessThan(CONFIG.length);
  });

  it.each(LOCALLY_GENERATED.map((entry) => [entry.glob, entry.createdBy] as const))(
    'ignores %s, created by %s',
    (glob) => {
      expect(IGNORE_LIST).toContain(`'${glob}'`);
    }
  );

  it('ignores the whole supabase temp directory, not one file inside it', () => {
    // Its contents are CLI-version-dependent — `pgdelta`, `start-secrets` and
    // `cli-latest` today. Naming a file would fix one machine and break on the
    // next Supabase CLI release.
    expect(IGNORE_LIST).toContain(`'supabase/.temp${ANY}'`);
    expect(IGNORE_LIST).not.toContain('start-secrets');
    expect(IGNORE_LIST).not.toContain('index.ts');
  });

  it('still lints the source it is supposed to lint', () => {
    // The opposite failure: an ignore list wide enough to be quiet everywhere.
    const forbidden = [
      `'src${ANY}'`,
      `'scripts${ANY}'`,
      `'tests${ANY}'`,
      `'${STAR}${STAR}/${STAR}'`,
      `'${STAR}'`,
    ];
    for (const glob of forbidden) {
      expect(IGNORE_LIST, `${glob} would silence real code`).not.toContain(glob);
    }
  });
});
