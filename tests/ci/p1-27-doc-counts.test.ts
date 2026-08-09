import { describe, it, expect } from 'vitest';
import {
  caseCount,
  checkDocument,
  deriveCounts,
  evaluate,
} from '../../scripts/ci/check-p1-27-doc-counts.mjs';

/**
 * The gate that makes a documented count derivable rather than remembered.
 *
 * Round five found thirteen stale numbers in the phase records — `E-03` to
 * `E-12`, `G-07`, `G-08` — and they are one defect wearing thirteen faces: a
 * count written by hand that nothing recomputes. Correcting thirteen numbers
 * produces thirteen numbers that will be wrong again.
 *
 * These cases prove the gate bites, and that its honesty about `it.each` is real
 * rather than a sentence in a docblock.
 */

describe('counts are derived from the tree', () => {
  interface Derived {
    counts: Record<string, number>;
    cases: Record<string, number>;
    lines: Record<string, number>;
  }
  const derived = deriveCounts() as unknown as Derived;
  const files = (key: string): number => {
    const n = derived.counts[key];
    expect(n, `${key} is not derived at all`).toBeTypeOf('number');
    return n as number;
  };

  it('derives real, non-trivial counts', () => {
    // Without this the comparisons below could pass over an empty table, which
    // is the failure mode every absence sweep in this phase hit at least once.
    for (const key of ['scripts/ci', 'tests/ci', 'apps/web/tests', 'supabase/migrations']) {
      expect(files(key), `${key} derived as ${files(key)}`).toBeGreaterThan(3);
    }
    expect(Object.keys(derived.lines).length, 'no phase document was measured').toBeGreaterThan(20);
    expect(Object.keys(derived.cases).length, 'no test file was counted').toBeGreaterThan(40);
  });

  it('refuses a stated count that disagrees with the tree', () => {
    const wrong = `<!-- derived: files tests/ci = ${files('tests/ci') + 1} -->`;
    const problems = checkDocument('x.md', wrong, derived);
    expect(problems.length, 'a wrong count passed').toBe(1);
    expect(problems[0]).toContain('the tree holds');
  });

  it('accepts a stated count that matches', () => {
    const right = `<!-- derived: files tests/ci = ${files('tests/ci')} -->`;
    expect(checkDocument('x.md', right, derived)).toEqual([]);
  });

  it('refuses a claim about something it cannot derive, rather than passing it', () => {
    /*
     * The dangerous direction. A gate that ignored an unknown name would let a
     * document opt a number in, spell the name wrong, and be silently unchecked —
     * which is indistinguishable from being checked.
     */
    const problems = checkDocument('x.md', '<!-- derived: files tests/nowhere = 3 -->', derived);
    expect(problems.length).toBe(1);
    expect(problems[0]).toContain('cannot derive');
  });
});

describe('the case count is honest about what it cannot see', () => {
  it('counts plain cases', () => {
    expect(caseCount("it('a', () => {});\nit('b', () => {});\n")).toBe(2);
    expect(caseCount("test('a', () => {});")).toBe(1);
  });

  it('does not count a case that is only mentioned in a comment', () => {
    // The seventh instance of prose-read-as-code in this phase was a gate that
    // did exactly this. Comments are stripped first.
    expect(caseCount("// it('not a real case', () => {});\nit('real', () => {});\n")).toBe(1);
    expect(caseCount("/**\n * it('documented', …)\n */\nit('real', () => {});\n")).toBe(1);
  });

  it('EXCLUDES a file using `it.each` rather than reporting a wrong number', () => {
    /*
     * `it.each` expands at runtime into one case per table row, and a static
     * count cannot know how many. Returning a number here would be wrong for
     * exactly the files that most need care — `crm-customer-search.test.ts` runs
     * 41 cases from 26 literal call sites.
     *
     * `null` removes the file from the checked set. A count that is right for
     * most files and quietly wrong for a few is worse than one that says which
     * files it covers.
     */
    expect(caseCount("it.each([[1],[2]])('x', () => {});\nit('y', () => {});\n")).toBeNull();
    expect(caseCount("test.each(rows)('x', () => {});")).toBeNull();
  });

  it('does not mistake a method call for a case', () => {
    // `.it(` and `unit(` are not cases. A boundary that matched them would
    // inflate every count in the repository.
    expect(caseCount('const n = suite.it(1);\nconst m = unit(2);\n')).toBe(0);
  });
});

describe('the live repository agrees with its own documents', () => {
  it('has no disagreement between a stated count and the tree', () => {
    const result = evaluate();
    expect(result.problems, 'a phase document states a count the tree contradicts').toEqual([]);
  });

  it('actually owns some claims, so the case above is not vacuous', () => {
    const result = evaluate();
    expect(result.claims, 'no document opts any count into the gate').toBeGreaterThan(5);
    expect(result.documents, 'no phase document was scanned').toBeGreaterThan(20);
  });
});
