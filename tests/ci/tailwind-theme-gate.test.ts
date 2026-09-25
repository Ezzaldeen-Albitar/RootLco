import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// Plain ESM JavaScript, like every other gate in this repository.
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

  it('does not read a CSS keyword in a Material style object as a utility (ADR-022)', () => {
    // `border-box` and `text-top` are values a style object writes. The
    // scanner PARSES the file and skips style objects (`sx`, `style`,
    // `createTheme()`, a same-file const an `sx` names); no exclusion list
    // was widened to make this pass.
    const known = new Set(['primary']);
    for (const source of [
      "export const A = () => <div sx={{ boxSizing: 'border-box', verticalAlign: 'text-top' }} />;",
      "export const A = () => <div style={{ boxSizing: 'border-box', verticalAlign: 'text-bottom' }} />;",
      "const cardSx = { boxSizing: 'border-box' } as const;\nexport const A = () => <div sx={cardSx} />;",
      "export const t = createTheme({ components: { MuiCard: { styleOverrides: { root: { boxSizing: 'border-box' } } } } });",
    ]) {
      expect(inspect('x.tsx', source, known), source).toEqual([]);
    }
  });

  it('still reports the same words in a class position', () => {
    // Negative controls: the words the style objects write are NOT exempt as
    // classes, wherever a class list is written.
    const known = new Set(['primary']);
    const utilities = (source: string) =>
      (inspect('x.tsx', source, known) as { utility: string }[]).map((f) => f.utility);
    expect(utilities('<p className="text-top" />')).toEqual(['text-top']);
    expect(utilities('<p className="border-box" />')).toEqual(['border-box']);
    expect(utilities("export const c = cn('text-bottom', { 'border-box': true });")).toEqual([
      'text-bottom',
      'border-box',
    ]);
    // A class list held in a constant is still read, wherever it is used.
    expect(
      utilities(
        "const TONE = { quiet: 'text-top' };\nexport const P = () => <p className={TONE.quiet} />;"
      )
    ).toEqual(['text-top']);
    // A class map that shares its name with an sx const in ANOTHER scope is
    // still a class map: style objects resolve by scope, not by name alone.
    expect(
      utilities(
        "export function P() { const tone = { quiet: 'text-top' }; return <p className={tone.quiet} />; }\nexport function Q() { const tone = { boxSizing: 'border-box' }; return <div sx={tone} />; }"
      )
    ).toEqual(['text-top']);
    // A class position inside a style object is read again.
    expect(
      utilities(
        "export const t = createTheme({ components: { MuiButton: { defaultProps: { className: 'border-box' } } } });"
      )
    ).toEqual(['border-box']);
  });

  it('refuses a file it cannot parse rather than skipping it', () => {
    const findings = inspect('x.tsx', '<p className="bg-brand-primary" ', new Set(['primary']));
    expect(findings).toHaveLength(1);
  });

  it('does not read a comment or a route template as a class', () => {
    // Both were reported on this gate's first run. A text scanner cannot tell
    // code from a sentence about code unless it is made to.
    const prose = inspect('x.tsx', '// reads left-to-right in Arabic too\n', new Set([]));
    const route = inspect(
      'x.ts',
      "export const r = { template: '/receptions/{id}/convert-to-work-order' };",
      new Set([])
    );
    expect(prose).toEqual([]);
    expect(route).toEqual([]);
  });
});
