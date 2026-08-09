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

  it('names the two partials, because they are the phase-level ones', () => {
    // `DO-002` and `QA-004` are the tasks the round reclassified. If either is
    // ever closed, its row moves to FIXED and this stays honest by derivation.
    const partial = rows.filter((r) => r.status === 'PARTIAL').map((r) => r.id);
    expect(partial.length, 'the register records no partial').toBeGreaterThan(0);
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
