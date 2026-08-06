import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM JavaScript, like every other gate in this repo.
import { inspect, selfTest, themeColours } from '../../apps/web/scripts/check-tailwind-theme.mjs';

/**
 * Every colour utility in the web source must resolve to a Tailwind theme entry.
 *
 * ## The failure this pins
 *
 * Found at Owner acceptance of P1-27, and it had been shipping for the whole
 * phase: `bg-brand-primary`, `text-on-brand`, `text-status-danger`,
 * `text-status-success`, `text-status-warning`, `text-link` and `bg-paper` were
 * used in fourteen components and registered in none.
 *
 * Tailwind does not warn about a class it does not recognise — it simply emits
 * no rule. So every primary button on the CRM and Vehicle screens rendered with
 * no fill, every error message was not red, every success message was not green,
 * and the printed document had no page colour. Fifty-one utilities.
 *
 * Nothing caught it. Not the type checker, not ESLint, not Stylelint, not the
 * design-token gate (the names are not raw values), not 767 unit tests, not the
 * anonymous browser tier, not the authenticated browser tier. A className
 * assertion passes whether or not the class means anything, which is precisely
 * why the interface can be blank while the suite is green.
 */

const ROOT = join(__dirname, '..', '..');
const WEB = join(ROOT, 'apps', 'web');
const CONFIG = readFileSync(join(WEB, 'tailwind.config.ts'), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (['node_modules', '.next', 'coverage'].includes(entry.name)) continue;
      walk(join(dir, entry.name), out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe('the web theme', () => {
  const known = themeColours(CONFIG) as Set<string>;

  it('registers a substantial palette, so the check below is not vacuous', () => {
    expect(known.size).toBeGreaterThan(40);
  });

  it('resolves every colour utility the source uses', () => {
    const files = walk(join(WEB, 'src'));
    expect(files.length).toBeGreaterThan(100);

    const findings = files.flatMap((file) =>
      inspect(file.slice(WEB.length + 1), readFileSync(file, 'utf8'), known)
    ) as { path: string; line: number; utility: string }[];

    expect(
      findings.map((f) => `${f.path}:${f.line} ${f.utility}`),
      'utilities that emit no CSS at all'
    ).toEqual([]);
  });

  it('keeps the names the invented ones were renamed to', () => {
    // If any of these left the theme, the rename would have moved the defect
    // rather than fixed it.
    for (const colour of [
      'primary',
      'primary-hover',
      'on-primary',
      'error',
      'success',
      'warning',
      'paper',
    ]) {
      expect(known, colour).toContain(colour);
    }
  });

  it('has no source file still using an invented name', () => {
    const invented =
      /\b(?:bg|text|border|ring|accent|fill|stroke)-(?:brand-primary|on-brand|status-(?:danger|success|warning))\b|\btext-link\b/;
    const offenders = walk(join(WEB, 'src'))
      .filter((file) => invented.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(WEB.length + 1));
    expect(offenders).toEqual([]);
  });
});

describe('the theme gate can still fail', () => {
  it('passes its own positive control', () => {
    expect(selfTest()).toBeNull();
  });

  it('reports an unresolvable utility', () => {
    const findings = inspect(
      'x.tsx',
      '<p className="bg-brand-primary" />',
      new Set(['primary'])
    ) as { utility: string }[];
    expect(findings.map((f) => f.utility)).toEqual(['bg-brand-primary']);
  });

  it('does not report a width utility or a font size', () => {
    const findings = inspect(
      'x.tsx',
      '<p className="border-b-2 border-t text-body text-caption" />',
      new Set(['primary'])
    );
    expect(findings).toEqual([]);
  });

  it('does not read a comment or a route template as a class', () => {
    // Both were reported on this gate's first run. A text scanner cannot tell
    // code from a sentence about code unless it is made to.
    const prose = inspect('x.tsx', '// reads left-to-right in Arabic too\n', new Set([]));
    const route = inspect(
      'x.ts',
      "  template: '/receptions/{id}/convert-to-work-order',",
      new Set([])
    );
    expect(prose).toEqual([]);
    expect(route).toEqual([]);
  });
});
