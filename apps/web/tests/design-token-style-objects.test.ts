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

describe('style objects passed by reference', () => {
  it('follows sx={identifier} to a same-file const and reads it there', () => {
    expect(
      rulesOf(
        `const cardSx = { padding: '12px' } as const;\nexport const A = () => <div sx={cardSx} />;`
      )
    ).toEqual(['style-object-raw-length']);
    expect(
      rulesOf(
        `const styles = { card: { marginLeft: 1 } };\nexport const A = () => <div sx={styles.card} />;`
      )
    ).toEqual(['style-object-physical-property']);
    expect(
      rulesOf(
        `const base = { transition: 'opacity 200ms' };\nexport const A = ({ on }: { on: boolean }) => <div sx={on ? base : undefined} />;`
      )
    ).toEqual(['style-object-raw-duration']);
  });

  it('follows a spread inside a style object, and a same-file object named as a value', () => {
    expect(
      rulesOf(
        `const base = { fontSize: 13 };\nexport const A = () => <div sx={{ ...base, mt: 1 }} />;`
      )
    ).toEqual(['style-object-raw-length']);
    expect(
      rulesOf(
        `const RING = { outlineOffset: '2px' };\nconst t = createTheme({ components: { MuiButton: { styleOverrides: { root: { '&:focus': RING } } } } });`,
        'src/x.ts'
      )
    ).toEqual(['style-object-raw-length']);
  });

  it('refuses a reference it cannot follow rather than reporting clean over it', () => {
    const unresolved = [
      `import { cardSx } from './styles';\nexport const A = () => <div sx={cardSx} />;`,
      `export const A = ({ sx }: { sx: object }) => <div sx={sx} />;`,
      `const make = () => ({});\nexport const A = () => <div sx={make()} />;`,
      `import { base } from './styles';\nexport const A = () => <div sx={{ ...base, mt: 1 }} />;`,
      `import { base } from './styles';\nexport const A = () => <div sx={[base, { mt: 1 }]} />;`,
    ];
    for (const source of unresolved) {
      expect(rulesOf(source), source).toEqual(['style-object-unresolved']);
    }
  });

  it('lets a shared wrapper forward the sx its caller wrote', () => {
    const forward = `export const W = ({ sx }: { sx: object }) => <div sx={sx} />;`;
    expect(rulesOf(forward, 'src/components/data/OperationalGrid.tsx')).toEqual([]);
    expect(rulesOf(forward, 'src/components/data/OperationalGrid/Inner.tsx')).toEqual([]);
    expect(rulesOf(forward, 'src/components/ui-foundation/Wrapper.tsx')).toEqual([]);
    expect(rulesOf(forward, 'src/features/x/Wrapper.tsx')).toEqual(['style-object-unresolved']);
  });

  it('exempts only the exact wrapper file and directory, never a name-sharing sibling', () => {
    const forward = `export const W = ({ sx }: { sx: object }) => <div sx={sx} />;`;
    for (const sibling of [
      'src/components/data/OperationalGridAnything.tsx',
      'src/components/data/OperationalGrid.test.tsx',
      'src/components/data/OperationalGridX/index.tsx',
    ]) {
      expect(rulesOf(forward, sibling), sibling).toEqual(['style-object-unresolved']);
    }
  });

  it('does not treat a scalar token as an unresolved style object', () => {
    expect(
      rulesOf(
        `import { FONT_SIZE_PX } from '@/styles/tokens/generated/tokens';\nexport const A = () => <div sx={{ fontSize: FONT_SIZE_PX.body, color: 'var(--color-primary)' }} />;`
      )
    ).toEqual([]);
  });
});

describe('style-call arguments are followed like sx', () => {
  it('follows styled(X)(ref), styled(X)(fn), createTheme(ref), css(ref) and GlobalStyles styles', () => {
    const raw = [
      `const base = { padding: '12px' };\nconst B = styled('div')(base);`,
      `const base = () => ({ padding: '12px' });\nconst B = styled('div')(base);`,
      `const base = { padding: '12px' };\nconst B = styled('div')(({ theme }) => base);`,
      `const B = styled('div')(function () { return { padding: '12px' }; });`,
      `function make() { return { padding: '12px' }; }\nconst B = styled('div')(make);`,
      `const options = { spacing: '8px' };\nconst t = createTheme(options);`,
      `const on = true;\nconst t = createTheme(on ? { spacing: '8px' } : {});`,
      `const styles = { card: { root: { padding: '12px' } } };\nconst c = css(styles.card.root);`,
      `const parts = [{ padding: '12px' }];\nconst c = css(...parts);`,
      `const GLOBAL = { body: { margin: '8px' } };\nexport const G = () => <GlobalStyles styles={GLOBAL} />;`,
      `const base = { card: { padding: '12px' } };\nconst styles = { ...base };\nexport const A = () => <div sx={styles.card} />;`,
    ];
    for (const source of raw) {
      expect(rulesOf(source, 'src/x.tsx'), source).toEqual(['style-object-raw-length']);
    }
  });

  it('refuses an imported or otherwise unresolvable style-call argument', () => {
    const unresolved = [
      `import { options } from './options';\nconst t = createTheme(options);`,
      `import { base } from './base';\nconst B = styled('div')(base);`,
      `import { base } from './base';\nconst B = styled('div')(({ theme }) => base);`,
      `import { base } from './base';\nconst c = css(base);`,
      `import { GLOBAL } from './global';\nexport const G = () => <GlobalStyles styles={GLOBAL} />;`,
      `import { base } from './base';\nconst styles = { ...base, other: {} };\nexport const A = () => <div sx={styles.card} />;`,
    ];
    for (const source of unresolved) {
      expect(rulesOf(source, 'src/x.tsx'), source).toEqual(['style-object-unresolved']);
    }
  });

  it('exempts an unresolvable theme argument only on the allow-listed paths', () => {
    const source = `import { options } from './options';\nconst t = createTheme(options);`;
    expect(rulesOf(source, 'src/components/ui-foundation/theme.ts')).toEqual([]);
    expect(rulesOf(source, 'src/features/x/theme.ts')).toEqual(['style-object-unresolved']);
  });
});

describe('nested values inside style objects', () => {
  it('refuses an unresolvable object under a selector, at-rule or slot key', () => {
    const unresolved = [
      `import { HOVER } from './hover';\nexport const A = () => <div sx={{ '&:hover': HOVER }} />;`,
      `import { WIDE } from './wide';\nexport const A = () => <div sx={{ '@media (min-width: 0)': WIDE }} />;`,
      `import { styles } from './styles';\nexport const A = () => <div sx={{ '& .MuiChip-root': styles.chip }} />;`,
      `import { ROOT } from './root';\nconst t = createTheme({ components: { MuiButton: { styleOverrides: { root: ROOT } } } });`,
      // Read once as a scalar, then in a selector position: still followed strictly.
      `import { X } from './x';\nconst Y = X;\nexport const A = () => <div sx={{ fontSize: Y, '&:hover': Y }} />;`,
    ];
    for (const source of unresolved) {
      expect(rulesOf(source), source).toEqual(['style-object-unresolved']);
    }
  });

  it('reads a same-file const named as a property value as that value', () => {
    expect(rulesOf(`const W = 320;\nexport const A = () => <div sx={{ width: W }} />;`)).toEqual([
      'style-object-raw-length',
    ]);
    expect(
      rulesOf(`const PAD = '12px';\nexport const A = () => <div sx={{ padding: PAD }} />;`)
    ).toEqual(['style-object-raw-length']);
    expect(
      rulesOf(`const ALIGN = 'left';\nexport const A = () => <div sx={{ textAlign: ALIGN }} />;`)
    ).toEqual(['style-object-physical-property']);
    expect(
      rulesOf(
        `const HOVER = { padding: '12px' };\nexport const A = () => <div sx={{ '&:hover': HOVER }} />;`
      )
    ).toEqual(['style-object-raw-length']);
  });
});

describe('theme members inside style callbacks', () => {
  it('accepts a spread of a theme member as a token source', () => {
    const legal = [
      `export const A = () => <div sx={(theme) => ({ ...theme.typography.body2, mt: 1 })} />;`,
      `const B = styled('div')(({ theme }) => ({ ...theme.typography.body2, ...theme.mixins.toolbar }));`,
      `const B = styled('div')((props) => ({ ...props.theme.typography.body2 }));`,
      `const B = styled('div')(({ theme: { typography } }) => ({ ...typography.body2 }));`,
      `export const A = () => <div sx={(theme) => theme.mixins.toolbar} />;`,
      `export const A = () => <div sx={(theme) => ({ '&:hover': theme.mixins.toolbar })} />;`,
      `const t = createTheme({ components: { MuiButton: { styleOverrides: { root: ({ theme }) => ({ ...theme.typography.button }) } } } });`,
      `export const G = () => <GlobalStyles styles={(theme) => ({ body: { ...theme.typography.body1 } })} />;`,
    ];
    for (const source of legal) expect(rulesOf(source, 'src/x.tsx'), source).toEqual([]);
  });

  it('does not take every callback argument, or a theme outside a callback, as the theme', () => {
    const unresolved = [
      `const B = styled('div')(({ ownerState }) => ({ ...ownerState.style }));`,
      `const B = styled('div')((props) => ({ ...props.extra }));`,
      `import { theme } from './theme';\nexport const A = () => <div sx={{ ...theme.typography.body2 }} />;`,
    ];
    for (const source of unresolved) {
      expect(rulesOf(source, 'src/x.tsx'), source).toEqual(['style-object-unresolved']);
    }
  });
});

describe('references resolve by scope', () => {
  it('lets a parameter shadow an outer const', () => {
    expect(
      rulesOf(
        `const base = { padding: 'var(--space-3)' };\nexport const A = ({ base }: { base: object }) => <div sx={base} />;`
      )
    ).toEqual(['style-object-unresolved']);
  });

  it('reads the nearest const, not every const of the same name', () => {
    expect(
      rulesOf(
        `const base = { padding: 'var(--space-3)' };\nexport function A() { const base = { padding: '12px' }; return <div sx={base} />; }`
      )
    ).toEqual(['style-object-raw-length']);
    expect(
      rulesOf(
        `const base = { padding: '12px' };\nexport function A() { const base = { padding: 'var(--space-3)' }; return <div sx={base} />; }`
      )
    ).toEqual([]);
    expect(
      rulesOf(
        `export function A() { const s = { padding: '12px' }; return <p data-s={String(s)} />; }\nexport function B() { const s = { padding: 'var(--space-1)' }; return <div sx={s} />; }`
      )
    ).toEqual([]);
  });

  it('still resolves a module-scope const from inside a function', () => {
    expect(
      rulesOf(
        `const base = { padding: '12px' };\nexport function A() { return <div sx={base} />; }`
      )
    ).toEqual(['style-object-raw-length']);
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
