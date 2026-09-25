import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `validate:web-tokens` reads Material UI style objects (ADR-022).
 *
 * Before this, the gate matched hex colours on any line but was blind to raw
 * lengths and durations inside JavaScript style objects, and Stylelint — the
 * only enforcer of ADR-013's logical properties — never opens a `.tsx`. Every
 * case below is a sample the gate must REFUSE, beside the legal spelling it
 * must accept, so the rule is proven to fail rather than assumed to.
 */

interface Finding {
  readonly path: string;
  readonly line: number;
  readonly rule: string;
  readonly what: string;
}

const GATE = (await import(
  pathToFileURL(join(process.cwd(), 'scripts', 'check-design-tokens.mjs')).href
)) as {
  readonly inspectStyleObjects: (relPath: string, source: string) => Finding[];
};

const rulesOf = (source: string, path = 'src/components/thing.tsx') =>
  GATE.inspectStyleObjects(path, source).map((finding) => finding.rule);

describe('raw values inside style objects', () => {
  it('refuses a raw length or duration in an sx string', () => {
    expect(rulesOf(`export const A = () => <div sx={{ padding: '12px' }} />;`)).toEqual([
      'style-object-raw-length',
    ]);
    expect(rulesOf(`export const A = () => <div sx={{ transition: 'opacity 200ms' }} />;`)).toEqual(
      ['style-object-raw-duration']
    );
    expect(rulesOf(`export const A = () => <div sx={{ gap: '1.5rem' }} />;`)).toEqual([
      'style-object-raw-length',
    ]);
  });

  it('refuses a raw number where Material reads pixels or milliseconds', () => {
    expect(rulesOf(`export const A = () => <div sx={{ fontSize: 13 }} />;`)).toEqual([
      'style-object-raw-length',
    ]);
    expect(rulesOf(`export const A = () => <div sx={{ transitionDuration: 200 }} />;`)).toEqual([
      'style-object-raw-duration',
    ]);
    expect(rulesOf(`export const A = () => <div sx={{ width: 320 }} />;`)).toEqual([
      'style-object-raw-length',
    ]);
  });

  it('reads theme options, styleOverrides and styled() calls, not only sx', () => {
    expect(
      rulesOf(
        `const t = createTheme({ transitions: { duration: { standard: 300 } } });`,
        'src/x.ts'
      )
    ).toEqual(['style-object-raw-duration']);
    expect(
      rulesOf(
        `const t = { components: { MuiButton: { styleOverrides: { root: { borderRadius: '6px' } } } } };`,
        'src/x.ts'
      )
    ).toEqual(['style-object-raw-length']);
    expect(rulesOf(`const B = styled('div')({ minHeight: '44px' });`, 'src/x.ts')).toEqual([
      'style-object-raw-length',
    ]);
    expect(rulesOf('const B = styled.div`margin-block: 8px;`;', 'src/x.ts')).toEqual([
      'style-object-raw-length',
    ]);
  });

  it('accepts token references, spacing multiples, fractions and zero', () => {
    const legal = [
      `export const A = () => <div sx={{ padding: 'var(--space-3)', mt: 2, width: 0.5 }} />;`,
      `export const A = () => <div sx={{ borderRadius: 1, margin: 0, inset: '0px' }} />;`,
      `const t = createTheme({ spacing: 'var(--space-2)', shape: { borderRadius: RADIUS_PX.md } });`,
      `export const A = () => <div sx={{ outline: 'calc(var(--space-1) / 2) solid var(--color-focus-ring)' }} />;`,
    ];
    for (const source of legal) expect(rulesOf(source), source).toEqual([]);
  });

  it('does not read a string outside a style object, or a comment, as a style', () => {
    expect(rulesOf(`const timeoutLabel = 'waits 200ms'; // padding: '12px'`)).toEqual([]);
    expect(rulesOf(`export const A = () => <input placeholder="12px" />;`)).toEqual([]);
  });
});

describe('physical properties inside style objects (ADR-013)', () => {
  it('refuses physical properties, their Material shorthands and kebab spellings', () => {
    for (const property of [
      'marginLeft',
      'paddingRight',
      'ml',
      'pr',
      'left',
      'right',
      'borderLeft',
      'borderTopRightRadius',
    ]) {
      expect(
        rulesOf(`export const A = () => <div sx={{ ${property}: 1 }} />;`),
        property
      ).toContain('style-object-physical-property');
    }
    expect(rulesOf(`const B = styled('div')({ 'margin-left': 0 });`, 'src/x.ts')).toEqual([
      'style-object-physical-property',
    ]);
  });

  it('refuses a physical left/right VALUE on text-align, float and clear', () => {
    expect(rulesOf(`export const A = () => <div sx={{ textAlign: 'left' }} />;`)).toEqual([
      'style-object-physical-property',
    ]);
    expect(rulesOf(`export const A = () => <div sx={{ float: 'right' }} />;`)).toEqual([
      'style-object-physical-property',
    ]);
  });

  it('accepts the logical spellings', () => {
    expect(
      rulesOf(
        `export const A = () => <div sx={{ marginInlineStart: 1, paddingInlineEnd: 2, insetInlineStart: 0, textAlign: 'start', mx: 1, px: 2 }} />;`
      )
    ).toEqual([]);
  });
});

describe('the gate reads the real theme', () => {
  const themePath = join(process.cwd(), 'src', 'components', 'ui-foundation', 'theme.ts');
  const theme = readFileSync(themePath, 'utf8');
  const rel = 'src/components/ui-foundation/theme.ts';

  it('finds nothing in the committed theme', () => {
    expect(GATE.inspectStyleObjects(rel, theme)).toEqual([]);
  });

  it('would find a raw value planted in it, so the clean result is not blindness', () => {
    const planted = theme.replace("borderRadius: 'var(--radius-md)'", "borderRadius: '6px'");
    expect(planted).not.toBe(theme);
    expect(GATE.inspectStyleObjects(rel, planted).map((finding) => finding.rule)).toContain(
      'style-object-raw-length'
    );
  });

  it('refuses a file it cannot parse rather than skipping it', () => {
    expect(rulesOf('export const A = () => <div sx={{ padding: ', 'src/broken.tsx')).toEqual([
      'style-object-unparseable',
    ]);
  });

  it('leaves the token layer alone, where raw values belong', () => {
    expect(
      GATE.inspectStyleObjects(
        'src/styles/tokens/generated/tokens.ts',
        `const t = createTheme({ spacing: '8px' });`
      )
    ).toEqual([]);
  });
});
