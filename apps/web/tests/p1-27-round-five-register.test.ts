import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The round-five register is the current finding authority, so it is held to the
 * standard it exists to enforce.
 *
 * ## Why this file exists
 *
 * The first revision of `adversarial-round-five.md` claimed "26 findings remain
 * open" in prose, and its rows supported no single number. It carried three
 * tables of different shapes, so any derivation read one of them and reported
 * full coverage of a subset; it used the id `F-02` twice, in two sections, for
 * two unrelated findings; and it wrote `E-02…`, a range.
 *
 * Each of those is a defect this phase has already named. "A range is not
 * searchable" has now been learned four times. A register that cannot be
 * mechanically read is a list of opinions.
 *
 * So: one table, one row per finding, and these assertions.
 */

const REPO = join(process.cwd(), '..', '..');
const REGISTER = join(REPO, 'docs', 'phase-1', 'phase-1-27', 'adversarial-round-five.md');

const STATUSES = ['FIXED', 'OPEN', 'PARTIAL', 'REFUTED'] as const;
const AREAS = ['PRODUCT', 'TEST/GATE', 'DOCUMENTATION', 'EVIDENCE', 'CANONICAL'] as const;
const SEVERITIES = ['HIGH', 'MEDIUM', 'LOW'] as const;

interface Row {
  readonly id: string;
  readonly area: string;
  readonly severity: string;
  readonly status: string;
  readonly finding: string;
}

const source = readFileSync(REGISTER, 'utf8');

/** `| \`id\` | area | severity | status | finding |` — the one row shape. */
const rows: Row[] = [
  ...source.matchAll(/^\|\s*`([^`]+)`\s*\|([^|]*)\|([^|]*)\|([^|]*)\|(.*)\|\s*$/gm),
]
  .map((m) => ({
    id: (m[1] ?? '').trim(),
    area: (m[2] ?? '').trim(),
    severity: (m[3] ?? '').trim(),
    status: (m[4] ?? '').trim(),
    finding: (m[5] ?? '').trim(),
  }))
  .filter((r) => (STATUSES as readonly string[]).includes(r.status));

/** The declared totals block, which the rows must support. */
function declared(name: string): number {
  const match = new RegExp(`${name}\\s*=\\s*(\\d+)`).exec(source);
  expect(match, `the register declares no ${name}`).not.toBeNull();
  return Number(match?.[1]);
}

/**
 * The CLASS table — the orthogonal disposition, parsed INDEPENDENTLY here.
 *
 * A status says what happened to a finding; a class says how it is dispositioned
 * (ACTIONABLE must close before the phase freezes, SEALED is judged against the
 * closing candidate, DISPOSITIONED is settled by a numbered decision). Ten totals
 * are declared. Five were checked here; the other five — the ones the phase
 * actually closes on — were checked by `scripts/ci/check-p1-27-doc-counts.mjs`
 * and by nothing else. A mutation that moved `ROUND5_ACTIONABLE_OPEN` failed that
 * script while this suite stayed green, which is a single-tier check on the
 * numbers that decide the freeze.
 *
 * Deliberately parsed here rather than imported from that script: importing the
 * derivation under test would make this a second call to one implementation, not
 * a second opinion. Two independent readings of the same table is the point — it
 * is how `B-05` and `B-01` were found to be checking a private copy instead of
 * the production predicate.
 *
 * Three columns, so this cannot match the five-column register row above.
 */
const CLASSES = ['ACTIONABLE', 'SEALED', 'DISPOSITIONED'] as const;

const classRows: { id: string; klass: string }[] = [
  ...source.matchAll(/^\|\s*`([^`]+)`\s*\|\s*([A-Z]+)\s*\|([^|]*)\|\s*$/gm),
]
  .map((m) => ({ id: (m[1] ?? '').trim(), klass: (m[2] ?? '').trim() }))
  .filter((r) => (CLASSES as readonly string[]).includes(r.klass));

/** The status of a finding id, from the register table. */
const statusOf = (id: string): string | undefined => rows.find((r) => r.id === id)?.status;

const classCount = (klass: string, status: string): number =>
  classRows.filter((c) => c.klass === klass && statusOf(c.id) === status).length;

describe('the round-five register can be read mechanically', () => {
  it('finds the rows at all, so nothing below is vacuous', () => {
    expect(rows.length, 'no register row matched the canonical shape').toBeGreaterThan(50);
  });

  it('gives every finding a unique, searchable id', () => {
    const seen = new Map<string, number>();
    for (const row of rows) seen.set(row.id, (seen.get(row.id) ?? 0) + 1);
    const duplicated = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(duplicated, 'an id is used for two findings; each must be searchable to one').toEqual(
      []
    );
  });

  it('uses no range shorthand in the id column', () => {
    /*
     * `MAN-01`…`MAN-04` meant `MAN-02` and `MAN-03` were unresolvable, and the
     * register claimed to close findings it could not show. Fourth occurrence.
     */
    const ranged = rows.filter((r) => /[…]|\.\.\.|\bthrough\b|--/.test(r.id)).map((r) => r.id);
    expect(ranged, 'a range is not searchable — enumerate every id').toEqual([]);
  });

  it('gives every finding a status from the vocabulary, and never UNKNOWN', () => {
    for (const row of rows) {
      expect(STATUSES as readonly string[], `${row.id} has status "${row.status}"`).toContain(
        row.status
      );
      expect(AREAS as readonly string[], `${row.id} has area "${row.area}"`).toContain(row.area);
      expect(SEVERITIES as readonly string[], `${row.id} severity "${row.severity}"`).toContain(
        row.severity
      );
      expect(row.finding.length, `${row.id} states no finding`).toBeGreaterThan(30);
    }
    expect(source.includes('| UNKNOWN'), 'UNKNOWN is not a status').toBe(false);
  });

  it('declares totals its own rows support', () => {
    const count = (status: string) => rows.filter((r) => r.status === status).length;
    expect(declared('ROUND5_TOTAL'), 'the declared total disagrees with the rows').toBe(
      rows.length
    );
    expect(declared('ROUND5_FIXED')).toBe(count('FIXED'));
    expect(declared('ROUND5_OPEN')).toBe(count('OPEN'));
    expect(declared('ROUND5_PARTIAL')).toBe(count('PARTIAL'));
    expect(declared('ROUND5_REFUTED')).toBe(count('REFUTED'));
    // And the parts must sum to the whole, or a status has been added to the
    // table without being added to the block.
    expect(
      count('FIXED') + count('OPEN') + count('PARTIAL') + count('REFUTED'),
      'the statuses do not account for every row'
    ).toBe(rows.length);
  });

  it('declares the CLASS totals its own class rows support', () => {
    // Anti-vacuity first: a loop over an empty class table would satisfy every
    // comparison below by declaring 0 = 0.
    expect(classRows.length, 'no class row matched the canonical shape').toBeGreaterThan(15);
    for (const row of classRows) {
      expect(statusOf(row.id), `${row.id} has a class but no register row`).toBeTypeOf('string');
    }

    expect(
      declared('ROUND5_ACTIONABLE_OPEN'),
      'the declared actionable-open count disagrees with the class rows'
    ).toBe(classCount('ACTIONABLE', 'OPEN'));
    expect(declared('ROUND5_ACTIONABLE_PARTIAL')).toBe(classCount('ACTIONABLE', 'PARTIAL'));
    expect(declared('ROUND5_SEALED_OPEN')).toBe(classCount('SEALED', 'OPEN'));
    expect(declared('ROUND5_DISPOSITIONED_PARTIAL')).toBe(classCount('DISPOSITIONED', 'PARTIAL'));
    expect(
      declared('ROUND5_CLOSURE_BLOCKERS'),
      'a closure blocker is an actionable finding that is not closed'
    ).toBe(classCount('ACTIONABLE', 'OPEN') + classCount('ACTIONABLE', 'PARTIAL'));
  });

  it('refuses to call a SEALED finding closed before QA-005 has executed', () => {
    /*
     * A sealed finding is judged against the closing candidate. Marking one
     * FIXED while QA-005 is still PARTIAL claims a measurement of a head that
     * does not exist yet — the single most likely way this register goes wrong
     * on the last day, and the reason the class column exists at all.
     */
    const matrix = JSON.parse(
      readFileSync(join(REPO, 'docs', 'phase-1', 'phase-1-27', 'task-matrix.json'), 'utf8')
    ) as { tasks?: { TASK_ID?: string; FINAL_VERDICT?: string }[] };
    const tasks = matrix.tasks ?? [];
    expect(tasks.length, 'the matrix holds no tasks — this case would be vacuous').toBeGreaterThan(
      40
    );
    const qa005 = tasks.find((t) => t.TASK_ID === 'QA-005');
    expect(qa005, 'the matrix has no QA-005 row to read the seal against').toBeDefined();

    const sealed = classRows.filter((c) => c.klass === 'SEALED');
    expect(sealed.length, 'no finding is sealed — this case would be vacuous').toBeGreaterThan(5);

    // QA-005 seals the phase against the closing candidate. While it is still
    // PARTIAL that candidate has not been measured, so nothing judged against it
    // can honestly be closed.
    if (qa005?.FINAL_VERDICT !== 'PARTIAL') return;
    const wronglyClosed = sealed.filter((c) => statusOf(c.id) === 'FIXED').map((c) => c.id);
    expect(wronglyClosed, 'a SEALED finding is marked FIXED while QA-005 is still PARTIAL').toEqual(
      []
    );
  });

  it('keeps every partial a canonical-task finding, however many there are', () => {
    /*
     * The count is NOT floored, and that is the correction.
     *
     * This case required `PARTIAL >= 1` unconditionally, which was true while the
     * round had partials and became a contradiction at closure:
     * `check-p1-27-doc-counts.mjs` requires `PARTIAL = 0` once `QA-005` has
     * executed, and QA-005 is the LAST task to close. Two committed gates then
     * demanded opposite things and no state satisfied both — the register could
     * not reach its own terminal condition. Reproduced in both directions before
     * this was touched.
     *
     * What the case is actually about survives: a PARTIAL is only ever a
     * canonical-task finding. Zero partials is a legitimate end state; a partial
     * that is not CANONICAL never is.
     */
    const partial = rows.filter((r) => r.status === 'PARTIAL').map((r) => r.id);
    for (const id of partial) {
      const row = rows.find((r) => r.id === id);
      expect(row?.area, `${id} is PARTIAL but not a canonical-task finding`).toBe('CANONICAL');
    }
  });

  it('records every product defect as closed, because they are operator-visible', () => {
    const product = rows.filter((r) => r.area === 'PRODUCT');
    expect(product.length, 'the register lists no product defect').toBeGreaterThan(0);
    const unclosed = product.filter((r) => r.status !== 'FIXED').map((r) => r.id);
    expect(unclosed, 'an operator-visible defect is not closed').toEqual([]);
  });
});
