/**
 * The canonical P1-27 task matrix — 42 rows, one per canonical task.
 *
 * ## Why this exists
 *
 * The largest structural failure of this phase was treating **33 adjudicated
 * items as though they were the 42 canonical tasks**. Nine tasks — `FE-005`,
 * `FE-006`, `FE-011`, `FE-012`, `FE-014`, `FE-025`, `FE-027`, `QA-004`,
 * `DO-001` — appeared in no status table anywhere, and `RESOLVED / 42 = 42` was
 * written from a table of 33 plus a remainder nobody listed.
 *
 * A count assembled from a table plus an unlisted remainder is not a count.
 *
 * So the universe is DERIVED from `canonical-plan.md` rather than maintained:
 * the id, the canonical name, the Backend operations and the canonical test id
 * all come from the plan's own tables. A task cannot be forgotten, because it is
 * not this file's job to remember it.
 *
 * ## What is derived and what is judged
 *
 * Derived (never hand-written here):
 *   TASK_ID · CATEGORY · CANONICAL_REQUIREMENT · CANONICAL_SOURCE ·
 *   BACKEND_CONTRACTS · CANONICAL_TEST_ID
 *
 * Judged, and therefore carried in `verdicts.json` beside this generator:
 *   every evidence field and FINAL_VERDICT.
 *
 * The split is the point. A generator that invented verdicts would be a
 * document describing itself; a hand-written universe would go stale the moment
 * the plan changed. `tests/ci/p1-27-task-matrix.test.ts` reconciles both halves.
 *
 * Usage:  node scripts/ci/build-p1-27-task-matrix.mjs [--check]
 * Exit:   0 written / in sync · 1 drifted (--check) · 2 IO error.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');

export const PLAN = 'docs/phase-1/phase-1-27/canonical-plan.md';
export const VERDICTS = 'docs/phase-1/phase-1-27/task-matrix-verdicts.json';
export const MATRIX = 'docs/phase-1/phase-1-27/task-matrix.json';

const native = (p) => join(ROOT, p.split(posix.sep).join(sep));

/** The canonical universe, by prefix. Sizes are asserted, not assumed. */
export const CATEGORIES = Object.freeze({
  FE: { category: 'Frontend', count: 29 },
  SEC: { category: 'Security', count: 4 },
  QA: { category: 'QA', count: 5 },
  DO: { category: 'DevOps', count: 2 },
  DOC: { category: 'Documentation', count: 2 },
});

export const VERDICTS_ALLOWED = Object.freeze(['PASS', 'PARTIAL', 'FAIL']);

/**
 * Every evidence field a task must account for. A field may be `N/A` only with a
 * rationale — never blank, because a blank reads as "nobody looked" and as
 * "nothing to look at" at the same time.
 */
export const EVIDENCE_FIELDS = Object.freeze([
  'IMPLEMENTATION_SURFACES',
  'NORMAL_NAVIGATION_ENTRY',
  'BACKEND_READ_CONTRACTS',
  'BACKEND_WRITE_CONTRACTS',
  'REQUIRED_PERMISSIONS',
  'TENANT_ISOLATION_REQUIREMENT',
  'LOADING_STATE',
  'EMPTY_STATE',
  'ZERO_RESULT_STATE',
  'ERROR_STATE',
  'DENIAL_STATE',
  'CONFLICT_STATE',
  'ARABIC_EVIDENCE',
  'ENGLISH_EVIDENCE',
  'RTL_LTR_EVIDENCE',
  'ACCESSIBILITY_EVIDENCE',
  'PRODUCTION_REACHABILITY',
  'PRODUCTION_TEST_EVIDENCE',
  'NEGATIVE_OR_MUTATION_PROOF',
  'ROUND5_FINDING_IDS',
  'DOCUMENTATION_EVIDENCE',
]);

/** Parse the canonical plan's task tables. One row per canonical task. */
export function readCanonicalTasks(root = ROOT) {
  const source = readFileSync(join(root, PLAN.split(posix.sep).join(sep)), 'utf8');
  const tasks = [];
  for (const line of source.split(/\r?\n/)) {
    const row =
      /^\|\s*`P1-27-((?:FE|SEC|QA|DO|DOC))-(\d+)`\s*\|\s*([^|]+?)\s*\|(?:\s*([^|]*?)\s*\|)?(?:\s*([^|]*?)\s*\|)?/.exec(
        line
      );
    if (!row) continue;
    const [, prefix, ordinal, name, operations, testId] = row;
    const id = `${prefix}-${ordinal}`;
    if (tasks.some((t) => t.id === id)) continue; // the plan restates ids in prose tables
    tasks.push({
      TASK_ID: id,
      CATEGORY: CATEGORIES[prefix].category,
      CANONICAL_REQUIREMENT: name,
      CANONICAL_SOURCE: `${PLAN} — the ${CATEGORIES[prefix].category} task table`,
      CANONICAL_BACKEND_OPERATIONS: (operations ?? '')
        .split(',')
        .map((s) => s.trim().replace(/^`|`$/g, ''))
        .filter((s) => s && s !== '—' && !/^TC-/.test(s)),
      CANONICAL_TEST_ID: (testId ?? '').trim().replace(/^`|`$/g, '') || 'N/A — the plan binds none',
    });
  }
  return tasks;
}

export function buildMatrix(root = ROOT) {
  const tasks = readCanonicalTasks(root);
  const verdictPath = native(VERDICTS);
  const verdicts = existsSync(verdictPath) ? JSON.parse(readFileSync(verdictPath, 'utf8')) : {};

  const rows = tasks.map((task) => {
    const judged = verdicts[task.TASK_ID] ?? {};
    const row = { ...task };
    for (const field of EVIDENCE_FIELDS) {
      row[field] = judged[field] ?? 'NOT YET ASSESSED';
    }
    row.FINAL_VERDICT = judged.FINAL_VERDICT ?? 'PARTIAL';
    row.VERDICT_RATIONALE =
      judged.VERDICT_RATIONALE ??
      'No per-task assessment has been recorded yet. PARTIAL is the honest default: a task is not PASS because nobody has looked at it.';
    return row;
  });

  const byCategory = {};
  for (const [prefix, meta] of Object.entries(CATEGORIES)) {
    byCategory[meta.category] = rows.filter((r) => r.TASK_ID.startsWith(`${prefix}-`)).length;
  }

  return {
    what: 'The 42 canonical P1-27 tasks, one row each, with the universe derived from canonical-plan.md.',
    whyDerived:
      'This phase once counted 33 adjudicated items as 42 canonical tasks. Nine were listed nowhere. The universe is read from the plan so a task cannot be forgotten.',
    verdictsAreJudged: `Every evidence field and FINAL_VERDICT comes from ${VERDICTS}, which is hand-written and reviewable. Only the universe is generated.`,
    howToRegenerate: 'npm run matrix:p1-27',
    taskCount: rows.length,
    byCategory,
    totals: {
      PASS: rows.filter((r) => r.FINAL_VERDICT === 'PASS').length,
      PARTIAL: rows.filter((r) => r.FINAL_VERDICT === 'PARTIAL').length,
      FAIL: rows.filter((r) => r.FINAL_VERDICT === 'FAIL').length,
    },
    tasks: rows,
  };
}

export const serialise = (matrix) => `${JSON.stringify(matrix, null, 2)}\n`;

function main(argv) {
  const check = argv.includes('--check');
  const target = native(MATRIX);
  let matrix;
  try {
    matrix = buildMatrix(ROOT);
  } catch (error) {
    process.stderr.write(`::error::cannot build the P1-27 task matrix: ${error.message}\n`);
    return 2;
  }
  const rendered = serialise(matrix);

  if (!check) {
    writeFileSync(target, rendered, 'utf8');
    process.stdout.write(
      `wrote ${MATRIX} — ${matrix.taskCount} tasks, ` +
        `PASS ${matrix.totals.PASS} / PARTIAL ${matrix.totals.PARTIAL} / FAIL ${matrix.totals.FAIL}\n`
    );
    return 0;
  }

  if (!existsSync(target)) {
    process.stderr.write(`::error::${MATRIX} does not exist. Run \`npm run matrix:p1-27\`.\n`);
    return 1;
  }
  if (readFileSync(target, 'utf8') !== rendered) {
    process.stderr.write(
      `::error::${MATRIX} no longer matches the canonical plan and the recorded verdicts. ` +
        'Regenerate it in the same commit: `npm run matrix:p1-27`.\n'
    );
    return 1;
  }
  process.stdout.write(
    `task matrix in sync — ${matrix.taskCount} tasks, ` +
      `PASS ${matrix.totals.PASS} / PARTIAL ${matrix.totals.PARTIAL} / FAIL ${matrix.totals.FAIL}\n`
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exit(main(process.argv.slice(2)));
}
