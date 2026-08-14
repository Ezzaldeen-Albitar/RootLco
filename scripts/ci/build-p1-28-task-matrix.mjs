/**
 * The canonical P1-28 task matrix — 35 rows, one per canonical task.
 *
 * ## Why this exists on day one
 *
 * P1-27's largest structural failure was treating 33 adjudicated items as
 * though they were its 42 canonical tasks: nine tasks appeared in no status
 * table anywhere, and `RESOLVED / 42 = 42` was written from a table of 33 plus
 * a remainder nobody listed. That authority was rebuilt mid-phase, at the cost
 * of five adversarial rounds.
 *
 * P1-28 builds the authority BEFORE the first screen, per exit criterion U1
 * of the workshop frontend program
 * (docs/product/workshop/frontend-implementation-program.md:152): the
 * universe is DERIVED from
 * `docs/phase-1/phase-1-28/canonical-plan.md` rather than maintained — the id,
 * the canonical name, the Backend operations and the canonical test id all
 * come from the plan's own tables. A task cannot be forgotten, because it is
 * not this file's job to remember it.
 *
 * ## What is derived and what is judged
 *
 * Derived (never hand-written here):
 *   TASK_ID · CATEGORY · CANONICAL_REQUIREMENT · CANONICAL_SOURCE ·
 *   CANONICAL_BACKEND_OPERATIONS · CANONICAL_TEST_ID
 *
 * Judged, and therefore carried in `task-matrix-verdicts.json` beside the
 * plan: every evidence field and FINAL_VERDICT.
 *
 * The split is the point. A generator that invented verdicts would be a
 * document describing itself; a hand-written universe would go stale the
 * moment the plan changed. `tests/ci/p1-28-matrix.test.ts` reconciles both
 * halves.
 *
 * An operation bound as `id [MISSING Rn]` names a contract that does not exist
 * at the archaeology head and the remediation that will create it
 * (`contract-archaeology.md` §4). The marker travels into the matrix
 * deliberately: a binding that pretended the operation existed would be the
 * P1-27 "declared but never wired" class, one layer up.
 *
 * Usage:  node scripts/ci/build-p1-28-task-matrix.mjs [--check]
 * Exit:   0 written / in sync · 1 drifted (--check) · 2 IO error.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, posix, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(HERE, '..', '..');

export const PLAN = 'docs/phase-1/phase-1-28/canonical-plan.md';
export const VERDICTS = 'docs/phase-1/phase-1-28/task-matrix-verdicts.json';
export const MATRIX = 'docs/phase-1/phase-1-28/task-matrix.json';

const native = (p) => join(ROOT, p.split(posix.sep).join(sep));

/** The canonical universe, by prefix. Sizes are asserted, not assumed. */
export const CATEGORIES = Object.freeze({
  FE: { category: 'Frontend', count: 22 },
  SEC: { category: 'Security', count: 4 },
  QA: { category: 'QA', count: 5 },
  DO: { category: 'DevOps', count: 2 },
  DOC: { category: 'Documentation', count: 2 },
});

export const VERDICTS_ALLOWED = Object.freeze(['PASS', 'PARTIAL', 'FAIL']);

/**
 * The reproof vocabulary, and the prose marker each cell must open with.
 *
 * Carried verbatim from the P1-27 lifecycle convention, where filing two
 * different obligations under one word — `OUTSTANDING` — built a closure
 * deadlock. `PROTECTED_REPROOF` is a paragraph because the reason matters; the
 * token is DERIVED from the paragraph's first words so the two cannot
 * disagree; and an unrecognised opening is a HARD ERROR rather than an unknown
 * value, because a blank or unmatched cell is exactly how a lifecycle
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
      'paragraph nothing can read is how 23 P1-27 rows spent a phase under one word ' +
      'that meant two different things.'
  );
}

/**
 * Every evidence field a task must account for. A field may be `N/A` only with
 * a rationale — never blank, because a blank reads as "nobody looked" and as
 * "nothing to look at" at the same time.
 *
 * The set is the P1-27 field set with three additions and one rename, all
 * dictated by the day-one shape of this register:
 *
 *   `REQUEST_SCHEMA` / `RESPONSE_SCHEMA` — filled from the contract
 *   archaeology NOW, before any screen, so the first adapter is written
 *   against a recorded contract instead of a guess;
 *
 *   `OWNER_REQUIREMENT_MAPPING` — the row in the Owner workflow table
 *   (`docs/product/owner-workflow-requirements.md:147-180`) or Owner register
 *   block this task answers, because P1-27's Owner acceptance failed against
 *   requirements no task row had ever claimed;
 *
 *   `FINDING_IDS` — the P1-27 field was `ROUND5_FINDING_IDS`, named for a
 *   register this phase does not have. A field named for another phase's
 *   register would be a lie in a field name; the generic name holds whatever
 *   register P1-28 accrues.
 *
 * `PROTECTED_REPROOF` remains a column and not a verdict, for the reason the
 * P1-27 generator documents at length: a task whose feature is wrong is
 * PARTIAL; a task whose feature is right but whose evidence still awaits a
 * re-run is a complete feature with an unpaid reproof; and conflating the two
 * is what deadlocked P1-27's closure. `FINAL_VERDICT` answers "is the
 * canonical requirement satisfied at this candidate head"; the reproof column
 * answers "does anything on this row still wait on a re-run, and of which
 * kind".
 */
export const EVIDENCE_FIELDS = Object.freeze([
  'IMPLEMENTATION_SURFACES',
  'NORMAL_NAVIGATION_ENTRY',
  'BACKEND_READ_CONTRACTS',
  'BACKEND_WRITE_CONTRACTS',
  'REQUEST_SCHEMA',
  'RESPONSE_SCHEMA',
  'REQUIRED_PERMISSIONS',
  'OWNER_REQUIREMENT_MAPPING',
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
  'FINDING_IDS',
  'DOCUMENTATION_EVIDENCE',
]);

/** Parse the canonical plan's task tables. One row per canonical task. */
export function readCanonicalTasks(root = ROOT) {
  const source = readFileSync(join(root, PLAN.split(posix.sep).join(sep)), 'utf8');
  const tasks = [];
  for (const line of source.split(/\r?\n/)) {
    const row =
      /^\|\s*`P1-28-((?:FE|SEC|QA|DO|DOC))-(\d+)`\s*\|\s*([^|]+?)\s*\|(?:\s*([^|]*?)\s*\|)?(?:\s*([^|]*?)\s*\|)?/.exec(
        line
      );
    if (!row) continue;
    const [, prefix, ordinal, name, operations, testId] = row;
    const id = `${prefix}-${ordinal}`;
    if (tasks.some((t) => t.id === id || t.TASK_ID === id)) continue; // the plan restates ids in prose tables
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
      // authority for one fact, which is the shape P1-27 kept punishing.
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
    what: 'The 35 canonical P1-28 tasks, one row each, with the universe derived from canonical-plan.md.',
    whyDerived:
      'P1-27 once counted 33 adjudicated items as 42 canonical tasks, with nine listed nowhere. P1-28 derives the universe from its plan on day one so a task cannot be forgotten.',
    verdictsAreJudged: `Every evidence field and FINAL_VERDICT comes from ${VERDICTS}, which is hand-written and reviewable. Only the universe is generated.`,
    howToRegenerate: 'npm run matrix:p1-28',
    taskCount: rows.length,
    byCategory,
    totals: {
      PASS: rows.filter((r) => r.FINAL_VERDICT === 'PASS').length,
      PARTIAL: rows.filter((r) => r.FINAL_VERDICT === 'PARTIAL').length,
      FAIL: rows.filter((r) => r.FINAL_VERDICT === 'FAIL').length,
    },
    /**
     * The reproof debt, counted per KIND rather than under one word, exactly as
     * P1-27 ended up doing after the single `OUTSTANDING` count produced a
     * deadlocked reading. Every token is emitted even at zero: a key that
     * appears only when it is non-zero cannot be cited by a document, and an
     * absent count reads as "none" and as "nobody counted" at the same time.
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
    process.stderr.write(`::error::cannot build the P1-28 task matrix: ${error.message}\n`);
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
    process.stderr.write(`::error::${MATRIX} does not exist. Run \`npm run matrix:p1-28\`.\n`);
    return 1;
  }
  if (readFileSync(target, 'utf8') !== rendered) {
    process.stderr.write(
      `::error::${MATRIX} no longer matches the canonical plan and the recorded verdicts. ` +
        'Regenerate it in the same commit: `npm run matrix:p1-28`.\n'
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
