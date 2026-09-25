import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLOR, LAYOUT_PX, SPACE_PX } from '@/styles/tokens/generated/tokens';

// Imported at RUNTIME: this workspace sets `allowJs: false`, so a static
// `../scripts/*.mjs` specifier is TS2307 (see `api-boundary-gate.test.ts`).
const { OUTPUT_PATH, declarationsOf, numberOf, render } = (await import(
  pathToFileURL(join(process.cwd(), 'scripts', 'generate-design-tokens.mjs')).href
)) as {
  readonly OUTPUT_PATH: string;
  readonly declarationsOf: (css: string, selector: string) => Map<string, string>;
  readonly numberOf: (name: string, value: string, unit: string) => number;
  readonly render: () => Promise<string>;
};

/**
 * The generated token module cannot drift from the Sass maps (ADR-022).
 *
 * `src/styles/tokens/generated/tokens.ts` exists so the Material theme can read
 * a handful of design values as numbers without anybody copying them by hand.
 * A copy that nobody regenerates is exactly the second source of truth ADR-020
 * forbids, so the comparison runs in the test tier: the committed file must be
 * byte-identical to what the generator produces from the Sass maps today.
 */

describe('the generated design tokens', () => {
  it('are in step with the Sass token maps', async () => {
    const expected = await render();
    expect(readFileSync(OUTPUT_PATH, 'utf8')).toBe(expected);
  });

  it('carry the approved anchors and the measures the theme reads', () => {
    expect(COLOR['--color-primary']).toBe('#1f6b52');
    expect(COLOR['--color-sidebar-background']).toBe('#0f2742');
    expect(SPACE_PX['2']).toBe(8);
    expect(LAYOUT_PX['table-row-height']).toBe(48);
  });
});

describe('the generator refuses what it cannot read', () => {
  it('fails on a declaration it does not recognise rather than skipping it', () => {
    expect(() => declarationsOf(':root {\n  --a: 1px;\n  color: red;\n}\n', ':root')).toThrow(
      /unreadable declaration/
    );
  });

  it('fails when the block it needs was not emitted', () => {
    expect(() => declarationsOf('.x {\n  --a: 1px;\n}\n', ':root')).toThrow(/no ":root" block/);
  });

  it('fails on a value in the wrong unit rather than guessing', () => {
    expect(numberOf('space-1', '4px', 'px')).toBe(4);
    expect(() => numberOf('space-1', '0.25rem', 'px')).toThrow(/expected a number in px/);
    expect(() => numberOf('duration-fast', '0.12s', 'ms')).toThrow(/in ms/);
  });
});
