import { EventEmitter } from 'node:events';
import type { ReactElement } from 'react';
import { screen, within } from '@testing-library/react';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Popover from '@mui/material/Popover';
import { useTheme, type Theme } from '@mui/material/styles';
import { DesktopDatePicker } from '@mui/x-date-pickers/DesktopDatePicker';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MuiFoundationSection } from '@/components/gallery/MuiFoundationSection';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { LAYER_ORDER } from '@/components/ui-foundation/theme';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';
import { BOTH_DIRECTIONS, renderLtr, renderRtl } from './render';
import {
  filterMuiLayerSheetErrors,
  isMuiLayerSheetError,
  type JsdomError,
  type JsdomVirtualConsole,
} from './support/jsdom-layer-filter';

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

/**
 * Portals in Arabic (ADR-022 section 7).
 *
 * Dialogs, menus, popovers and the picker popup mount on `<body>`, outside the
 * tree that rendered them. They must still be right-to-left: `dir` inherited
 * from `<html>` (nothing on the way sets its own), the theme's direction
 * inside the portal, and their styles written by the right-to-left cache
 * (`muirtl`), whose plugin mirrors Material's physical properties.
 *
 * jsdom performs no layout, so the popover's computed position is a browser
 * check; what is asserted here is every input to it that jsdom can see.
 */
describe('portals in the right-to-left document', () => {
  function DirectionProbe({ label }: { readonly label: string }) {
    return <span data-testid={`probe-${label}`} data-direction={useTheme().direction} />;
  }

  function mountAr(ui: ReactElement) {
    return renderRtl(
      <UiFoundationProvider locale="ar" text={muiTextOf(getMessages('ar'))}>
        {ui}
      </UiFoundationProvider>
    );
  }

  function expectRightToLeftPortal(node: HTMLElement, container: HTMLElement, label: string) {
    // Mounted outside the component tree, on <body>.
    expect(container.contains(node), `${label} rendered inline, not in a portal`).toBe(false);
    expect(document.body.contains(node)).toBe(true);
    // No element between it and <html> overrides the direction.
    const owner = node.closest('[dir]');
    expect(owner, `${label}: an element on the way sets its own dir`).toBe(
      document.documentElement
    );
    expect(document.documentElement.dir).toBe('rtl');
    // The theme inside the portal is right-to-left.
    expect(within(node).getByTestId(`probe-${label}`).dataset.direction).toBe('rtl');
    // Its classes come from the right-to-left cache, never the left-to-right one.
    const classes = [...node.querySelectorAll<HTMLElement>('[class]'), node]
      .flatMap((element) => [...element.classList])
      .filter((name) => /^mui(?:rtl)?-/.test(name));
    expect(classes.length, `${label} carries no Emotion class`).toBeGreaterThan(0);
    for (const name of classes) expect(name, label).toMatch(/^muirtl-/);
  }

  /** Every Emotion sheet was written by the right-to-left cache (muirtl, muirtl-global). */
  function expectOnlyRightToLeftCache() {
    const keys = [...document.head.querySelectorAll<HTMLStyleElement>('style[data-emotion]')].map(
      (style) => (style.dataset.emotion ?? '').split(' ')[0] ?? ''
    );
    expect(keys.length, 'no Emotion sheet was written').toBeGreaterThan(0);
    for (const key of keys) expect(key).toMatch(/^muirtl(?:-global)?$/);
  }

  it('mounts a dialog on body, right-to-left', () => {
    const { container } = mountAr(
      <Dialog open aria-label="dialog">
        <DirectionProbe label="dialog" />
      </Dialog>
    );
    expectRightToLeftPortal(screen.getByRole('dialog'), container, 'dialog');
    expectOnlyRightToLeftCache();
  });

  it('mounts a menu on body, right-to-left', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const { container } = mountAr(
      <Menu open anchorEl={anchor}>
        <MenuItem>
          <DirectionProbe label="menu" />
        </MenuItem>
      </Menu>
    );
    const menu = screen.getByRole('menu').closest<HTMLElement>('.MuiPopover-root');
    expect(menu).not.toBeNull();
    expectRightToLeftPortal(menu as HTMLElement, container, 'menu');
    expectOnlyRightToLeftCache();
    anchor.remove();
  });

  it('mounts a popover on body, right-to-left', () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    const { container } = mountAr(
      <Popover open anchorEl={anchor}>
        <DirectionProbe label="popover" />
      </Popover>
    );
    const root = screen.getByTestId('probe-popover').closest<HTMLElement>('.MuiPopover-root');
    expect(root).not.toBeNull();
    expectRightToLeftPortal(root as HTMLElement, container, 'popover');
    expectOnlyRightToLeftCache();
    anchor.remove();
  });

  it('opens the date picker popup on body, right-to-left, with its styles mirrored', () => {
    const { container } = mountAr(
      <DesktopDatePicker
        open
        label="date"
        slotProps={{ toolbar: { hidden: false } }}
        slots={{ toolbar: () => <DirectionProbe label="picker" /> }}
      />
    );
    const popup = screen.getByRole('dialog');
    expectRightToLeftPortal(popup, container, 'picker');
    expectOnlyRightToLeftCache();
    // Material pads the calendar header 24px on its physical LEFT and 12px on
    // its right; the right-to-left cache mirrors both, so the wide side is the
    // start (right) edge in Arabic.
    const css = emotionCss('muirtl');
    const header = /MuiPickersCalendarHeader-root\{[^}]*padding[^}]*\}/.exec(css)?.[0] ?? '';
    expect(header, 'the calendar header wrote no padding rule').not.toBe('');
    expect(header).toMatch(/padding-right:24px;padding-left:12px/);
    expect(header).not.toMatch(/padding-left:24px/);
  });
});

/**
 * The DOM tier drops ONE jsdom report — Material's layered sheets — and
 * nothing else (`tests/support/jsdom-layer-filter.ts`).
 */
describe('the jsdom CSS report filter', () => {
  function cssError(detail: string, message = 'Could not parse CSS stylesheet'): JsdomError {
    return Object.assign(new Error(message), { type: 'css parsing', detail });
  }

  function filtered() {
    const emitter = new EventEmitter();
    const forwarded: JsdomError[] = [];
    emitter.on('jsdomError', (error: JsdomError) => forwarded.push(error));
    filterMuiLayerSheetErrors(emitter as unknown as JsdomVirtualConsole);
    return { emit: (error: JsdomError) => emitter.emit('jsdomError', error), forwarded };
  }

  it('drops the report for a Material layer sheet', () => {
    const { emit, forwarded } = filtered();
    emit(cssError('@layer mui{@layer components{.muirtl-1-MuiButton-root{color:red;}}}'));
    emit(cssError('@layer mui{:root{--mui-spacing:var(--space-2);}}'));
    expect(forwarded).toEqual([]);
  });

  it('still reports every other CSS parse error, and every other jsdom error', () => {
    const { emit, forwarded } = filtered();
    const reported = [
      // A broken product stylesheet.
      cssError('.a { color: red; } }}} @media {'),
      // A layer that is not Material's.
      cssError('@layer rootlco-reset{html{color:red;}}'),
      cssError('@layer muiish{.a{color:red;}}'),
      // Material's layer, but not at the start of the sheet.
      cssError('.a{color:red;}@layer mui{.b{color:red;}}'),
      // The same text under another message or another error type.
      cssError('@layer mui{.a{color:red;}}', 'Some other failure'),
      Object.assign(new Error('Could not parse CSS stylesheet'), {
        type: 'unhandled exception',
        detail: '@layer mui{.a{color:red;}}',
      }),
    ];
    for (const error of reported) emit(error);
    expect(forwarded).toEqual(reported);
  });

  it('classifies the reports a real jsdom raises', async () => {
    // A separate jsdom, so a deliberately broken sheet is not printed by this
    // tier's own console. `jsdom` ships no types; the runtime specifier keeps
    // TS7016 out of typecheck:web.
    const specifier = 'jsdom';
    const { JSDOM, VirtualConsole } = (await import(specifier)) as {
      JSDOM: new (html: string, options: { virtualConsole: unknown }) => { window: Window };
      VirtualConsole: new () => JsdomVirtualConsole;
    };
    const virtualConsole = new VirtualConsole();
    const forwarded: JsdomError[] = [];
    virtualConsole.on('jsdomError', (error) => forwarded.push(error));
    filterMuiLayerSheetErrors(virtualConsole);
    const { window } = new JSDOM('<!doctype html><html><head></head></html>', { virtualConsole });
    const sheet = (text: string) => {
      const style = window.document.createElement('style');
      style.textContent = text;
      window.document.head.appendChild(style);
    };

    sheet('@layer mui{@layer components{.muirtl-1-MuiButton-root{color:red;}}}');
    expect(forwarded).toEqual([]);

    sheet('.a { color: red; } }}} @media {');
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]?.type).toBe('css parsing');
    expect(isMuiLayerSheetError(forwarded[0] as JsdomError)).toBe(false);
  });
});
