import { createElement, Fragment, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
// Next's own seam for "HTML to insert into <head> while streaming" — the hook
// `AppRouterCacheProvider` registers its style flush with. Provided by hand here
// so the server render can be inspected without a production build.
import { ServerInsertedHTMLContext } from 'next/dist/shared/lib/server-inserted-html.shared-runtime';
import { describe, expect, it } from 'vitest';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import type { Locale } from '@/i18n/config';
import { getMessages } from '@/i18n/get-messages';

/**
 * The ADR-022 layering spike, on the SERVER render.
 *
 * The first paint is what matters for a cascade-layer order: the browser fixes
 * a layer's position the first time it sees the layer's name. So what is
 * checked here is the HTML the server streams into `<head>` for a page using
 * the foundation — before any client code has run:
 *
 *   - the FIRST style block is the layer-order statement, naming
 *     `rootlco-reset` before Material's sub-layers (the application stylesheet
 *     declares `@layer rootlco-reset, mui;` too, so whichever arrives first the
 *     order is the same);
 *   - every Material rule is inside `@layer mui`;
 *   - the Arabic page is served from the right-to-left cache (`muirtl`), so a
 *     left-to-right stylesheet can never be streamed into an Arabic page.
 *
 * Node, not jsdom: this is `react-dom/server`, the renderer Next uses.
 */

function serverRender(locale: Locale): { head: string; body: string } {
  const flushes: (() => ReactNode)[] = [];
  const body = renderToString(
    createElement(
      ServerInsertedHTMLContext.Provider,
      { value: (callback: () => ReactNode) => flushes.push(callback) },
      createElement(UiFoundationProvider, {
        locale,
        text: muiTextOf(getMessages(locale)),
        children: createElement(
          Fragment,
          null,
          createElement(Button, { variant: 'contained' }, 'save'),
          createElement(TextField, { label: 'reference' })
        ),
      })
    )
  );
  const head = flushes
    .map((flush) => renderToString(createElement(Fragment, null, flush())))
    .join('');
  return { head, body };
}

function styleBlocks(head: string): { key: string; css: string }[] {
  return [...head.matchAll(/<style[^>]*data-emotion="([^"]+)"[^>]*>([\s\S]*?)<\/style>/g)].map(
    (match) => ({ key: String(match[1]), css: String(match[2]) })
  );
}

describe('the server-rendered head', () => {
  it.each<[Locale, string]>([
    ['en', 'mui'],
    ['ar', 'muirtl'],
  ])('opens with the layer order and keeps Material in its layer (%s)', (locale, key) => {
    const { head, body } = serverRender(locale);
    expect(body).toContain('save');

    const blocks = styleBlocks(head);
    expect(blocks.length, 'the server streamed no Material styles into <head>').toBeGreaterThan(1);

    // First: the order statement, as a global of this direction's cache.
    expect(blocks[0]?.key.startsWith(`${key}-global`)).toBe(true);
    // Stylis writes it without spaces.
    expect(blocks[0]?.css).toBe(
      '@layer rootlco-reset,mui.global,mui.components,mui.theme,mui.custom,mui.sx;'
    );

    // Every block after it is layered. Stylis leaves empty class rules behind
    // when it hoists a layer; they declare nothing and are removed first.
    let layered = 0;
    for (const block of blocks.slice(1)) {
      expect(block.key.split(' ')[0]?.replace(/-global$/, '')).toBe(key);
      const css = block.css.replace(/\.[\w-]+\{\}/g, '');
      if (css === '') continue;
      expect(css.startsWith('@layer mui{'), `unlayered CSS in ${block.key}`).toBe(true);
      layered += 1;
    }
    expect(
      layered,
      'no layered Material rule was streamed, so nothing was checked'
    ).toBeGreaterThan(0);
  });

  it('carries the palette as references to the product tokens', () => {
    const { head } = serverRender('en');
    expect(head).toContain('--mui-palette-primary-main:var(--color-primary)');
    expect(head).toContain('--mui-palette-background-paper:var(--color-surface)');
  });
});
