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
  REPROOF_STATUSES,
  PLAN,
  VERDICTS,
  MATRIX,
} from '../../scripts/ci/build-p1-28-task-matrix.mjs';

/**
 * The canonical 35-task authority, held from DAY ONE of the phase.
 *
 * ## The failure this exists to make impossible
 *
 * P1-27's `final-task-adjudication.md` carried a Summary table of **33**
 * adjudicated items and a block reading `RESOLVED / 42 = 42`. Nine canonical
 * tasks had a row in no status table anywhere in the phase, and the miscount
 * survived four adversarial rounds before a fifth derived the missing ids.
 * P1-28 writes the enumerable universe before its first screen, so the state
 * "a task nothing lists" cannot come to exist.
 *
 * ## Two authorities, deliberately
 *
 * The UNIVERSE is derived from `canonical-plan.md` §5: ids, names, Backend
 * operations, canonical test ids. The VERDICTS are hand-written in
 * `task-matrix-verdicts.json`, because judging a task is a judgement. These
 * cases hold the seam — and, because the register was born together with the
 * contract archaeology, they also hold the day-one floor: every row ships with
 * its contract bindings recorded, not with placeholders to fill in later.
 */

const ROOT = join(__dirname, '../..');

interface Row {
  readonly TASK_ID: string;
  readonly CATEGORY: string;
  readonly CANONICAL_REQUIREMENT: string;
  readonly CANONICAL_SOURCE: string;
  readonly CANONICAL_BACKEND_OPERATIONS: readonly string[];
  readonly CANONICAL_TEST_ID: string;
  readonly PROTECTED_REPROOF_STATUS: string;
  readonly FINAL_VERDICT: string;
  readonly VERDICT_RATIONALE: string;
  readonly [field: string]: unknown;
}

const matrix = JSON.parse(readFileSync(join(ROOT, MATRIX), 'utf8')) as {
  taskCount: number;
  byCategory: Record<string, number>;
  totals: Record<string, number>;
  protectedReproof: Record<string, number>;
  tasks: Row[];
};

const plan = readFileSync(join(ROOT, PLAN), 'utf8');
const verdicts = JSON.parse(readFileSync(join(ROOT, VERDICTS), 'utf8')) as Record<
  string,
  Record<string, string>
>;

/** The expected universe, spelled out. Not derived — this is the specification. */
const EXPECTED: readonly string[] = [
  ...Array.from({ length: 22 }, (_, i) => `FE-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 4 }, (_, i) => `SEC-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 5 }, (_, i) => `QA-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 2 }, (_, i) => `DO-${String(i + 1).padStart(3, '0')}`),
  ...Array.from({ length: 2 }, (_, i) => `DOC-${String(i + 1).padStart(3, '0')}`),
];

describe('the canonical task universe is exactly 35, enumerated', () => {
  it('holds 35 tasks', () => {
    expect(matrix.taskCount).toBe(35);
    expect(matrix.tasks.length).toBe(35);
    expect(EXPECTED.length, 'the specification itself must be 35').toBe(35);
  });

  it('holds exactly the expected ids — none missing, none extra, none twice', () => {
    const ids = matrix.tasks.map((t) => t.TASK_ID);
    const missing = EXPECTED.filter((id) => !ids.includes(id));
    const unexpected = ids.filter((id) => !EXPECTED.includes(id));
    const duplicated = ids.filter((id, i) => ids.indexOf(id) !== i);

    // Named individually, because "9 missing" is the message that let P1-27's
    // miscount run for four rounds. The ids are what a reader can act on.
    expect(missing, 'canonical tasks absent from the matrix').toEqual([]);
    expect(unexpected, 'ids in the matrix that are not canonical tasks').toEqual([]);
    expect(duplicated, 'an id appears twice').toEqual([]);
  });

  it('splits into the canonical categories exactly', () => {
    for (const meta of Object.values(CATEGORIES)) {
      expect(matrix.byCategory[meta.category], `${meta.category} count`).toBe(meta.count);
    }
    const sum = Object.values(CATEGORIES).reduce((n, m) => n + m.count, 0);
    expect(sum, 'the category sizes do not sum to 35').toBe(35);
  });

  it('reads its universe from the canonical plan, not from a hand-written list', () => {
    /*
     * If this ever fails, the generator has stopped tracking the plan — which is
     * the state that produced P1-27's nine unlisted tasks. The plan is the
     * authority and the matrix must be a projection of it.
     */
    const fromPlan = readCanonicalTasks(ROOT).map((t: { TASK_ID: string }) => t.TASK_ID);
    expect(fromPlan.sort()).toEqual([...EXPECTED].sort());
  });

  it('states every id literally in the plan — no range shorthand anywhere', () => {
    /*
     * `RESOLVED / 42 = 42` was written from "a table plus a remainder nobody
     * listed" — a range is exactly that remainder in compressed form. Every one
     * of the 35 ids must appear in the plan as its own backticked table cell,
     * and neither the plan's §5 nor the verdicts file may compress a span of
     * ids into `FE-001..022`-style shorthand.
     */
    for (const id of EXPECTED) {
      expect(plan, `the plan does not state \`P1-28-${id}\` literally`).toContain(
        `\`P1-28-${id}\``
      );
    }
    const shorthand = /P1-28-(?:FE|SEC|QA|DO|DOC)-\d+\s*(?:\.\.+|…|–|—)\s*(?:P1-28-)?\d/;
    expect(shorthand.test(plan), 'the plan compresses ids into a range').toBe(false);
    for (const key of Object.keys(verdicts)) {
      expect(EXPECTED, `verdicts key "${key}" is not a canonical id`).toContain(key);
    }
    expect(Object.keys(verdicts).length, 'the verdicts file must judge all 35 rows').toBe(35);
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

  it('binds operations and catalogued test ids by category, per plan §5', () => {
    /*
     * Every Frontend task binds at least one operation — either registered at
     * the archaeology head or carried as `[MISSING Rn]`, which names the
     * remediation that will create it. An FE row with NO binding would be the
     * "declared but never wired" class one layer up. The non-Frontend
     * categories bind none, per the P1-27 §5.3 convention the plan restates.
     */
    for (const task of matrix.tasks) {
      const ops = task.CANONICAL_BACKEND_OPERATIONS;
      if (task.CATEGORY === 'Frontend') {
        expect(ops.length, `${task.TASK_ID} binds no operation`).toBeGreaterThan(0);
        for (const op of ops) {
          expect(
            /^(apt|rec|crm|veh|iam|wo|shared)\./.test(op),
            `${task.TASK_ID} binds "${op}", which names no known domain`
          ).toBe(true);
        }
        expect(
          /^TC-P1-28-(APT|REC|XD)-\d{3}$/.test(task.CANONICAL_TEST_ID),
          `${task.TASK_ID} test id "${task.CANONICAL_TEST_ID}" is not in the P1-28 catalogues`
        ).toBe(true);
      } else {
        expect(ops, `${task.TASK_ID} is non-Frontend and must bind no operation`).toEqual([]);
        expect(task.CANONICAL_TEST_ID).toBe('N/A — the plan binds none');
      }
    }
  });
});

describe('every task accounts for every evidence field', () => {
  it('leaves no field silently blank', () => {
    /*
     * A blank cell reads as "nobody looked" and as "nothing to look at" at the
     * same time, and P1-27 was bitten by both readings. `N/A` is allowed;
     * `N/A` without a reason is not.
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

  it('meets the day-one anti-vacuity floor on the contract-binding fields', () => {
    /*
     * The whole point of authoring the register beside the contract archaeology
     * is that the binding fields are FULL on day one — real routes, schemas and
     * permission codes, or an `N/A` that says why. A row whose binding field
     * reads `NOT YET ASSESSED` has not been bound, and a floor of thirty
     * characters refuses a token where a fact belongs. The screen-evidence
     * fields (loading, empty, RTL, …) legitimately default until a screen
     * exists; the binding fields do not.
     */
    const BOUND_ON_DAY_ONE = [
      'BACKEND_READ_CONTRACTS',
      'BACKEND_WRITE_CONTRACTS',
      'REQUEST_SCHEMA',
      'RESPONSE_SCHEMA',
      'REQUIRED_PERMISSIONS',
      'OWNER_REQUIREMENT_MAPPING',
      'PROTECTED_REPROOF',
    ] as const;
    const vacuous: string[] = [];
    for (const task of matrix.tasks) {
      for (const field of BOUND_ON_DAY_ONE) {
        const text = String(task[field] ?? '');
        if (text.includes('NOT YET ASSESSED')) {
          vacuous.push(`${task.TASK_ID}.${field} was never bound`);
        } else if (text.trim().length < 30) {
          vacuous.push(
            `${task.TASK_ID}.${field} is ${text.trim().length} chars — a token, not a fact`
          );
        }
      }
    }
    expect(vacuous).toEqual([]);
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
    ).toBe(35);
  });

  it('carries a derived reproof token on every row, and counts each kind even at zero', () => {
    for (const task of matrix.tasks) {
      expect(
        REPROOF_STATUSES,
        `${task.TASK_ID} reproof token "${task.PROTECTED_REPROOF_STATUS}"`
      ).toContain(task.PROTECTED_REPROOF_STATUS);
    }
    for (const token of REPROOF_STATUSES as readonly string[]) {
      expect(
        matrix.protectedReproof[token],
        `the ${token} count is absent — an absent count reads as "none" and as "nobody counted"`
      ).toBe(matrix.tasks.filter((t) => t.PROTECTED_REPROOF_STATUS === token).length);
    }
  });

  it('does not let an unassessed task read as PASS', () => {
    /*
     * The default for a task nobody has assessed is PARTIAL, not PASS. That is
     * the whole difference between "35 tasks exist" and "35 tasks are
     * delivered", and conflating them is what P1-27 paid five rounds for.
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
