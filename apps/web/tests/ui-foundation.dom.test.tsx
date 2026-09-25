import { screen } from '@testing-library/react';
import Button from '@mui/material/Button';
import { useTheme, type Theme } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MuiFoundationSection } from '@/components/gallery/MuiFoundationSection';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { LAYER_ORDER } from '@/components/ui-foundation/theme';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { BOTH_DIRECTIONS, renderLtr, renderRtl } from './render';

/**
 * The Material UI foundation (ADR-022), mounted the way the locale layout
 * mounts it, in both directions.
 *
 * These are the ADR's two spikes kept as tests rather than left as a claim:
 *
 *   1. A palette made only of `var(--…)` references renders Material, the
 *      data grid, the date picker, the bar chart and the tree view without the
 *      "unsupported colour" error Material raises when it has to PARSE a colour
 *      (it cannot parse a custom property). `nativeColor` is what avoids it.
 *   2. Material's styles land in the `mui` cascade layer, with the layer order
 *      the product's stylesheet declares, and the right-to-left cache flips
 *      Material's physical properties.
 *
 * jsdom performs no layout and does not cascade, so what is asserted is the
 * CSS Emotion WROTE — the layer wrapper, the order statement, the flipped
 * declaration — not a computed style. The computed result is a browser check.
 */

function mount(locale: Locale) {
  const messages = getMessages(locale);
  const renderIn = locale === 'ar' ? renderRtl : renderLtr;
  return renderIn(
    <UiFoundationProvider locale={locale} text={muiTextOf(messages)}>
      <MuiFoundationSection locale={locale} messages={messages} />
    </UiFoundationProvider>
  );
}

function emotionCss(key: string): string {
  return [...document.head.querySelectorAll<HTMLStyleElement>('style[data-emotion]')]
    .filter((style) => (style.dataset.emotion ?? '').split(' ')[0] === key)
    .map((style) => style.textContent ?? '')
    .join('\n');
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const style of document.head.querySelectorAll('style')) style.remove();
});

describe('the Material UI foundation', () => {
  it.each(BOTH_DIRECTIONS)(
    'renders every adopted component on a custom-property palette (%s)',
    (locale) => {
      const errors = vi.spyOn(console, 'error');
      mount(locale);

      expect(screen.getByTestId('mui-foundation')).toBeInTheDocument();
      expect(screen.getByRole('grid')).toBeInTheDocument();
      expect(screen.getByRole('tree')).toBeInTheDocument();
      expect(
        errors.mock.calls
          .map((call) => String(call[0]))
          .filter((message) => /unsupported|colou?r/i.test(message)),
        'Material reported an error while rendering on the token palette'
      ).toEqual([]);
    }
  );

  it('writes the palette as references to the Sass tokens, not as values', () => {
    const seen: { theme?: Theme } = {};
    function Probe() {
      seen.theme = useTheme();
      return null;
    }
    const messages = getMessages('en');
    renderLtr(
      <UiFoundationProvider locale="en" text={muiTextOf(messages)}>
        <Probe />
      </UiFoundationProvider>
    );
    const theme = seen.theme;
    if (!theme) throw new Error('the provider supplied no theme');
    expect(theme.palette.primary.main).toBe('var(--color-primary)');
    expect(theme.palette.background.paper).toBe('var(--color-surface)');
    expect(theme.palette.divider).toBe('var(--color-border)');
    expect(theme.typography.fontFamily).toBe('var(--font-family-sans)');
  });

  it('puts every Material style in the mui layer, under the declared order', () => {
    mount('en');

    const order = document.head.querySelector('style[data-mui-layer-order]');
    expect(order, 'the layer-order statement was not injected').not.toBeNull();
    // First in <head>, so it is declared before any layered rule arrives.
    expect(document.head.firstElementChild).toBe(order);
    expect(order?.textContent).toBe(
      '@layer rootlco-reset, mui.global, mui.components, mui.theme, mui.custom, mui.sx;'
    );
    expect(LAYER_ORDER).toBe('@layer rootlco-reset, mui;');

    const css = emotionCss('mui');
    expect(css.length).toBeGreaterThan(0);
    const rules = css.split(/(?=@layer mui\{)|\n/).filter((rule) => rule.trim() !== '');
    // Stylis leaves the class selector behind as an EMPTY rule when it hoists
    // the layer out of it (`.mui-abc{}`); it declares nothing, so it cannot
    // compete with anything and is not a finding.
    const unlayered = rules.filter(
      (rule) =>
        !rule.startsWith('@layer mui{') &&
        !rule.startsWith('@layer rootlco-reset') &&
        !/^[^{}]+\{\}$/.test(rule)
    );
    expect(unlayered, 'Material emitted CSS outside the mui layer').toEqual([]);
  });

  it('uses a separate right-to-left cache that flips Material’s physical properties', () => {
    mount('en');
    const ltr = emotionCss('mui');
    for (const style of document.head.querySelectorAll('style')) style.remove();

    mount('ar');
    const rtl = emotionCss('muirtl');

    expect(rtl.length, 'the Arabic page wrote no styles under the muirtl key').toBeGreaterThan(0);
    // Material's floating label is anchored with a PHYSICAL `left` and a
    // `transform-origin` of `top left`; the RTL plugin must mirror both.
    expect(ltr).toMatch(/transform-origin:top left/);
    expect(rtl).toMatch(/transform-origin:top right/);
    expect(rtl).not.toMatch(/transform-origin:top left/);
  });

  it('keeps the theme direction in step with the document', () => {
    const directions: string[] = [];
    function Probe() {
      directions.push(useTheme().direction);
      return <Button>probe</Button>;
    }
    for (const [locale, renderIn] of BOTH_DIRECTIONS) {
      const { unmount } = renderIn(
        <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
          <Probe />
        </UiFoundationProvider>
      );
      expect(document.documentElement.dir).toBe(directions.at(-1));
      unmount();
    }
    expect(new Set(directions)).toEqual(new Set(['ltr', 'rtl']));
  });
});
