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
 * The reproof vocabulary, and the prose marker each cell must open with.
 *
 * `PROTECTED_REPROOF` is a paragraph, because the reason matters and a token
 * cannot carry one. A paragraph is also unreadable by a gate, which is how 23
 * rows came to sit under one word — `OUTSTANDING` — that said nothing about
 * WHICH kind of re-run was owed. Two entirely different obligations were filed
 * under it:
 *
 *   the authenticated browser tier had not been observed at the closing
 *   candidate. That tier is called by `pr-ci.yml` on every pull request whose
 *   head is a branch of this repository, so what it waits on is an EXACT-HEAD
 *   CANDIDATE run — available before the merge;
 *
 *   a job only a push to a protected branch starts. That one genuinely waits
 *   for the merge.
 *
 * Filing the first under a word that reads as the second is what built the
 * deadlock. So the token is derived from the marker the cell opens with, the
 * markers are enumerated, and an unrecognised opening is a HARD ERROR rather
 * than an unknown value — a blank or unmatched cell is exactly how a lifecycle
 * obligation stops being counted.
 */
export const REPROOF_MARKERS = Object.freeze([
  ['NOT REQUIRED', 'NOT_REQUIRED'],
  ['PENDING CANDIDATE OBSERVATION', 'PENDING_CANDIDATE_OBSERVATION'],
  ['PENDING PROTECTED MERGE', 'PENDING_PROTECTED_MERGE'],
  ['TAKEN GREEN', 'TAKEN_GREEN'],
  ['TAKEN RED', 'TAKEN_RED'],
]);

export const REPROOF_STATUSES = Object.freeze(REPROOF_MARKERS.map(([, token]) => token));

/** The token a `PROTECTED_REPROOF` cell declares. Throws rather than guessing. */
export function reproofStatus(taskId, prose) {
  const text = String(prose ?? '').trimStart();
  for (const [marker, token] of REPROOF_MARKERS) {
    if (text.startsWith(marker)) return token;
  }
  throw new Error(
    `${taskId}: its PROTECTED_REPROOF cell opens with none of ` +
      `${REPROOF_MARKERS.map(([m]) => `"${m}"`).join(', ')}. ` +
      'The reproof kind must be declared in the first words of the cell, because a ' +
      'paragraph nothing can read is how 23 rows spent a phase under one word that ' +
      'meant two different things.'
  );
}

/**
 * Every evidence field a task must account for. A field may be `N/A` only with a
 * rationale — never blank, because a blank reads as "nobody looked" and as
 * "nothing to look at" at the same time.
 *
 * ## Why `PROTECTED_REPROOF` is a column and not a verdict
 *
 * Two different things were being written into one word. A task whose feature is
 * wrong is PARTIAL. A task whose feature is right, and proved at this candidate,
 * but whose evidence includes a job that only a push to `develop` or `main`
 * starts, is not a defective feature — it is a complete feature with an unpaid
 * reproof. Both were being recorded as PARTIAL, which made the register unable
 * to distinguish "this does not work" from "this has not been re-run yet", and
 * the phase cannot close on either reading without knowing which it is.
 *
 * So the judgement splits. `FINAL_VERDICT` is the TASK verdict and answers *is
 * the canonical requirement satisfied at this candidate head*. `PROTECTED_REPROOF`
 * — with its controlled token in `PROTECTED_REPROOF_STATUS` — answers *does
 * anything on this row still wait on a re-run, and of which kind*.
 *
 * ## The sentence that used to be here, and why it was wrong
 *
 * It read: *"A row may be `PASS` with an OUTSTANDING reproof; the phase still may
 * not close until every OUTSTANDING one is taken."* The first clause is right.
 * The second conflated **candidate acceptance** with **post-merge reproof**, and
 * that conflation is a closed cycle: the branch cannot merge until every row is
 * PASS, a row cannot be PASS while its reproof is outstanding, and the reproof is
 * a job only the merge starts.
 *
 * The authority for splitting them is the plan itself.
 * `docs/phase-1/phase-1-27/canonical-plan.md:189` states `P1-27-QA-005` in full
 * as **"Regression and immutable evidence packaging"** and binds it to nothing
 * else. The plan mentions protected change control exactly twice, at lines 98 and
 * 100, and both are about routing a **Backend** defect through protected
 * remediation — not about proving a Frontend task on protected `develop`. **No
 * canonical task requires proof on protected `develop`.**
 *
 * A protected re-run is therefore a property of the GATE LIFECYCLE, not a
 * requirement of any task, and the two now live in different places:
 * `scripts/ci/check-p1-27-lifecycle.mjs` owns the lifecycle, this file owns the
 * tasks, and `PENDING_PROTECTED_MERGE` is a legitimate expected pre-merge value
 * that is neither `PASS`, nor `FAIL`, nor a defect.
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
  'PROTECTED_REPROOF',
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
      // Derived, never judged: the token is a reading of the prose beside it, so
      // the two cannot disagree. A second hand-written field would be a second
      // authority for one fact, which is the shape this phase keeps punishing.
      if (field === 'PROTECTED_REPROOF') {
        row.PROTECTED_REPROOF_STATUS = reproofStatus(task.TASK_ID, row[field]);
      }
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
    /**
     * The reproof debt, counted per KIND rather than under one word.
     *
     * A `PASS` row with a pending reproof is a complete feature and an unpaid
     * re-run, and the kind decides who pays it: a
     * `PENDING_CANDIDATE_OBSERVATION` is discharged by the exact-head run before
     * the merge, a `PENDING_PROTECTED_MERGE` only after it. Summing them
     * separately means the phase cannot be read as closeable from `totals`
     * alone, and cannot be read as DEADLOCKED either — which is the reading the
     * single `OUTSTANDING` count produced.
     *
     * Every token is emitted even at zero. A key that appears only when it is
     * non-zero cannot be cited by a document, and an absent count reads as
     * "none" and as "nobody counted" at the same time.
     */
    protectedReproof: Object.fromEntries(
      REPROOF_STATUSES.map((token) => [
        token,
        rows.filter((r) => r.PROTECTED_REPROOF_STATUS === token).length,
      ])
    ),
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
