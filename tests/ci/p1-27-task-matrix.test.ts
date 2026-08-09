import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildMatrix,
  serialise,
  readCanonicalTasks,
  CATEGORIES,
  EVIDENCE_FIELDS,
  VERDICTS_ALLOWED,
  MATRIX,
} from '../../scripts/ci/build-p1-27-task-matrix.mjs';

/**
 * The canonical 42-task authority.
 *
 * ## The failure this exists to make impossible
 *
 * `final-task-adjudication.md` carried a Summary table of **33** adjudicated
 * items and a block reading `RESOLVED / 42 = 42`. Nine canonical tasks —
 * `FE-005`, `FE-006`, `FE-011`, `FE-012`, `FE-014`, `FE-025`, `FE-027`,
 * `QA-004`, `DO-001` — had a row in no status table anywhere in the phase. The
 * total was a table plus a remainder nobody had listed, and it survived four
 * adversarial rounds before a fifth derived the missing ids.
 *
 * A count is only a count if something can enumerate what it counts.
 *
 * ## Two authorities, deliberately
 *
 * The UNIVERSE is derived from `canonical-plan.md`: ids, names, Backend
 * operations, canonical test ids. A task cannot be dropped by forgetting it,
 * because nothing here remembers it.
 *
 * The VERDICTS are hand-written in `task-matrix-verdicts.json`, because judging
 * a task is a judgement. A generator that produced its own verdicts would be a
 * document describing itself.
 *
 * These cases hold the seam.
 */

const ROOT = join(__dirname, '../..');

interface Row {
  readonly TASK_ID: string;
  readonly CATEGORY: string;
  readonly CANONICAL_REQUIREMENT: string;
  readonly CANONICAL_SOURCE: string;
  readonly FINAL_VERDICT: string;
  readonly VERDICT_RATIONALE: string;
  readonly [field: string]: unknown;
}

const matrix = JSON.parse(readFileSync(join(ROOT, MATRIX), 'utf8')) as {
  taskCount: number;
  byCategory: Record<string, number>;
  totals: Record<string, number>;
  tasks: Row[];
};

/** The expected universe, spelled out. Not derived — this is the specification. */
const EXPECTED: readonly string[] = [
  ...Array.from({ length: 29 }, (_, i) => `FE-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 4 }, (_, i) => `SEC-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 5 }, (_, i) => `QA-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 2 }, (_, i) => `DO-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 2 }, (_, i) => `DOC-${String(i + 1).padStart(3, '0')}`),
];

describe('the canonical task universe is exactly 42, enumerated', () => {
  it('holds 42 tasks', () => {
    expect(matrix.taskCount).toBe(42);
    expect(matrix.tasks.length).toBe(42);
    expect(EXPECTED.length, 'the specification itself must be 42').toBe(42);
  });

  it('holds exactly the expected ids — none missing, none extra, none twice', () => {
    const ids = matrix.tasks.map((t) => t.TASK_ID);
    const missing = EXPECTED.filter((id) => !ids.includes(id));
    const unexpected = ids.filter((id) => !EXPECTED.includes(id));
    const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);

    // Named individually, because "9 missing" is the message that let this run
    // for four rounds. The ids are what a reader can act on.
    expect(missing, 'canonical tasks absent from the matrix').toEqual([]);
    expect(unexpected, 'ids in the matrix that are not canonical tasks').toEqual([]);
    expect(duplicated, 'an id appears twice').toEqual([]);
  });

  it('splits into the canonical categories exactly', () => {
    for (const meta of Object.values(CATEGORIES)) {
      expect(matrix.byCategory[meta.category], `${meta.category} count`).toBe(meta.count);
    }
    const sum = Object.values(CATEGORIES).reduce((n, m) => n + m.count, 0);
    expect(sum, 'the category sizes do not sum to 42').toBe(42);
  });

  it('reads its universe from the canonical plan, not from a hand-written list', () => {
    /*
     * If this ever fails, the generator has stopped tracking the plan — which is
     * the state that produced the nine unlisted tasks. The plan is the authority
     * and the matrix must be a projection of it.
     */
    const fromPlan = readCanonicalTasks(ROOT).map((t: { TASK_ID: string }) => t.TASK_ID);
    expect(fromPlan.sort()).toEqual([...EXPECTED].sort());
  });

  it('gives every task a canonical requirement and a source', () => {
    for (const task of matrix.tasks) {
      expect(
        task.CANONICAL_REQUIREMENT.length,
        `${task.TASK_ID} has no requirement`
      ).toBeGreaterThan(3);
      expect(task.CANONICAL_SOURCE, `${task.TASK_ID} cites no canonical source`).toContain(
        'canonical-plan.md'
      );
    }
  });
});

describe('every task accounts for every evidence field', () => {
  it('leaves no field silently blank', () => {
    /*
     * A blank cell reads as "nobody looked" and as "nothing to look at" at the
     * same time, and this phase has been bitten by both readings. `N/A` is
     * allowed; `N/A` without a reason is not.
     */
    const gaps: string[] = [];
    for (const task of matrix.tasks) {
      for (const field of EVIDENCE_FIELDS) {
        const value = task[field];
        const text = Array.isArray(value) ? value.join(' ') : String(value ?? '');
        if (text.trim() === '') gaps.push(`${task.TASK_ID}.${field} is blank`);
        else if (/^N\/A\s*$/i.test(text.trim())) {
          gaps.push(`${task.TASK_ID}.${field} is N/A with no rationale`);
        }
      }
    }
    expect(gaps).toEqual([]);
  });

  it('uses only the allowed verdicts, and never UNKNOWN', () => {
    for (const task of matrix.tasks) {
      expect(VERDICTS_ALLOWED, `${task.TASK_ID} verdict "${task.FINAL_VERDICT}"`).toContain(
        task.FINAL_VERDICT
      );
      expect(
        task.VERDICT_RATIONALE.length,
        `${task.TASK_ID} verdict has no rationale`
      ).toBeGreaterThan(20);
    }
    expect(JSON.stringify(matrix).includes('"UNKNOWN"'), 'UNKNOWN is not a verdict').toBe(false);
  });

  it('declares totals its own rows support', () => {
    const count = (verdict: string) =>
      matrix.tasks.filter((t) => t.FINAL_VERDICT === verdict).length;
    for (const verdict of VERDICTS_ALLOWED) {
      expect(matrix.totals[verdict], `${verdict} total`).toBe(count(verdict));
    }
    expect(
      count('PASS') + count('PARTIAL') + count('FAIL'),
      'the verdicts do not account for every task'
    ).toBe(42);
  });

  it('does not let an unassessed task read as PASS', () => {
    /*
     * The default for a task nobody has assessed is PARTIAL, not PASS. That is
     * the whole difference between "42 tasks exist" and "42 tasks are delivered",
     * and conflating them is what this file was written for.
     */
    for (const task of matrix.tasks) {
      if (String(task.PRODUCTION_TEST_EVIDENCE).includes('NOT YET ASSESSED')) {
        expect(task.FINAL_VERDICT, `${task.TASK_ID} is unassessed and not PARTIAL`).not.toBe(
          'PASS'
        );
      }
    }
  });
});

describe('the generated matrix is what the generator produces now', () => {
  it('is byte-identical to a fresh build', () => {
    // The `--check` mode CI runs, asserted here so a hand-edited matrix cannot
    // pass while claiming to be derived.
    expect(serialise(buildMatrix(ROOT))).toBe(readFileSync(join(ROOT, MATRIX), 'utf8'));
  });
});
