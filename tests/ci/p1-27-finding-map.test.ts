import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MATRIX } from '../../scripts/ci/build-p1-27-task-matrix.mjs';

/**
 * Every round-five finding bears on a named canonical task, or on a named
 * cross-cutting concern.
 *
 * ## Why
 *
 * A finding that maps to nothing disappears — quietly, and exactly when the
 * register is summarised. This phase already lost nine canonical tasks by
 * counting a table plus a remainder nobody listed; the same arithmetic applied
 * to findings loses findings.
 *
 * So the map must be TOTAL in both directions: every id in the register appears
 * here exactly once, and every task id named here exists in the canonical
 * matrix. Neither side may drift.
 *
 * ## The escape hatch, and its lock
 *
 * `FOUNDATION` is real: `A42-01` is about the task universe itself and belongs
 * to no single task. But "cross-cutting" is also the easiest way to make an
 * inconvenient defect stop being anybody's problem, so a finding classified
 * `REAL_P1_27_DEFECT` may not hide there, and every `FOUNDATION` entry must name
 * the concern that owns it.
 */

const ROOT = join(__dirname, '../..');
const PHASE = join(ROOT, 'docs', 'phase-1', 'phase-1-27');

interface Entry {
  readonly TASK_IDS: string[];
  readonly CLASSIFICATION: string;
  readonly WHY: string;
  readonly OWNING_CONCERN?: string;
}

const map = JSON.parse(readFileSync(join(PHASE, 'finding-task-map.json'), 'utf8')) as {
  classifications: string[];
  findings: Record<string, Entry>;
};

const register = readFileSync(join(PHASE, 'adversarial-round-five.md'), 'utf8');

/** The register's ids, read from the same row shape its own reconciliation uses. */
const registerIds = [
  ...register.matchAll(
    /^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|\s*(FIXED|OPEN|PARTIAL|REFUTED)\s*\|/gm
  ),
].map((m) => (m[1] ?? '').trim());

const matrixIds = (
  JSON.parse(readFileSync(join(ROOT, MATRIX), 'utf8')) as { tasks: { TASK_ID: string }[] }
).tasks.map((t) => t.TASK_ID);

describe('the finding map is total in both directions', () => {
  it('reads real ids from both sides, so nothing below is vacuous', () => {
    expect(registerIds.length, 'no register rows matched').toBeGreaterThan(50);
    expect(matrixIds.length, 'the matrix holds no tasks').toBe(42);
  });

  it('maps every register finding exactly once', () => {
    const mapped = Object.keys(map.findings);
    const unmapped = registerIds.filter((id) => !mapped.includes(id));
    const stray = mapped.filter((id) => !registerIds.includes(id));
    // Named, not counted. "3 unmapped" sends a reader looking; the ids are what
    // they act on.
    expect(
      unmapped,
      'a register finding maps to nothing and would vanish from any summary'
    ).toEqual([]);
    expect(stray, 'the map names a finding the register does not carry').toEqual([]);
    expect(mapped.length).toBe(registerIds.length);
  });

  it('names only canonical task ids, or the FOUNDATION bucket', () => {
    const unknown: string[] = [];
    for (const [id, entry] of Object.entries(map.findings)) {
      expect(entry.TASK_IDS.length, `${id} names no task`).toBeGreaterThan(0);
      for (const task of entry.TASK_IDS) {
        if (task !== 'FOUNDATION' && !matrixIds.includes(task)) unknown.push(`${id} -> ${task}`);
      }
    }
    expect(unknown, 'a finding points at a task id that does not exist').toEqual([]);
  });

  it('gives every finding a classification from the vocabulary and a reason', () => {
    for (const [id, entry] of Object.entries(map.findings)) {
      expect(map.classifications, `${id} classification "${entry.CLASSIFICATION}"`).toContain(
        entry.CLASSIFICATION
      );
      expect(entry.WHY.length, `${id} carries no reason`).toBeGreaterThan(40);
    }
  });

  it('refuses FOUNDATION as a hiding place for a real product defect', () => {
    const hidden = Object.entries(map.findings)
      .filter(
        ([, e]) => e.CLASSIFICATION === 'REAL_P1_27_DEFECT' && e.TASK_IDS.includes('FOUNDATION')
      )
      .map(([id]) => id);
    expect(hidden, 'a real defect is classified as cross-cutting and belongs to nobody').toEqual(
      []
    );

    for (const [id, entry] of Object.entries(map.findings)) {
      if (entry.TASK_IDS.includes('FOUNDATION')) {
        expect(
          entry.OWNING_CONCERN,
          `${id} is FOUNDATION and names no owning concern`
        ).toBeTruthy();
      }
    }
  });

  it('leaves no canonical task carrying findings it cannot see', () => {
    /*
     * The reverse projection: for each task, the findings that name it. This is
     * what `task-matrix.json`'s `ROUND5_FINDING_IDS` must agree with, and it is
     * how a task's verdict inherits the state of its findings rather than being
     * asserted independently of them.
     */
    const byTask = new Map<string, string[]>();
    for (const [id, entry] of Object.entries(map.findings)) {
      for (const task of entry.TASK_IDS) {
        byTask.set(task, [...(byTask.get(task) ?? []), id]);
      }
    }
    // Every product defect must reach at least one Frontend task; a REAL_P1_27_DEFECT
    // that touches only documentation tasks has been mis-filed.
    for (const [id, entry] of Object.entries(map.findings)) {
      if (entry.CLASSIFICATION !== 'REAL_P1_27_DEFECT') continue;
      const touchesWork = entry.TASK_IDS.some((t) => /^(FE|SEC|QA|DO)-/.test(t));
      expect(touchesWork, `${id} is a real defect filed only against documentation`).toBe(true);
    }
    expect(byTask.size, 'the map projects onto no task at all').toBeGreaterThan(5);
  });
});
