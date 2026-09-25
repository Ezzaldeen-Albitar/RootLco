/**
 * The one jsdom report the DOM tier drops (ADR-022).
 *
 * jsdom's CSS parser predates cascade layers, so every stylesheet Emotion
 * writes for Material UI inside `@layer mui{…}` is reported as "Could not parse
 * CSS stylesheet" — once per style insertion, hundreds of lines per test file.
 * The styles are still WRITTEN (the foundation tests read them back from the
 * `<style>` elements); jsdom only declines to build a CSSOM from them, which it
 * would not use for layout anyway.
 *
 * The match is deliberately narrow — all three must hold:
 *   - the error is jsdom's `css parsing` type,
 *   - its message is exactly jsdom's "Could not parse CSS stylesheet", and
 *   - the stylesheet text BEGINS with the `mui` layer Emotion's cache writes
 *     (`@layer mui{`, `@layer mui.components{` …).
 *
 * Any other parse failure — a broken product stylesheet, a layer that is not
 * Material's, a `@layer` further down a sheet — and every other jsdom error is
 * handed to the listeners that were already registered, unchanged.
 * `tests/ui-foundation.dom.test.tsx` proves both halves.
 */

export interface JsdomError extends Error {
  readonly type?: string;
  readonly detail?: unknown;
}

type Listener = (error: JsdomError) => void;

export interface JsdomVirtualConsole {
  listeners(event: 'jsdomError'): readonly unknown[];
  removeAllListeners(event: 'jsdomError'): unknown;
  on(event: 'jsdomError', listener: Listener): unknown;
}

const JSDOM_CSS_MESSAGE = 'Could not parse CSS stylesheet';

/** `@layer mui{`, `@layer mui {`, `@layer mui.components{` — Emotion's Material sheets. */
const MUI_LAYER_SHEET = /^@layer mui(?:\.[a-z-]+)?\s*\{/;

export function isMuiLayerSheetError(error: JsdomError): boolean {
  return (
    error.type === 'css parsing' &&
    error.message === JSDOM_CSS_MESSAGE &&
    typeof error.detail === 'string' &&
    MUI_LAYER_SHEET.test(error.detail)
  );
}

/** Wraps the console's `jsdomError` listeners so only the Material layer report is dropped. */
export function filterMuiLayerSheetErrors(virtualConsole: JsdomVirtualConsole): void {
  const forward = virtualConsole.listeners('jsdomError') as Listener[];
  virtualConsole.removeAllListeners('jsdomError');
  virtualConsole.on('jsdomError', (error) => {
    if (isMuiLayerSheetError(error)) return;
    for (const listener of forward) listener(error);
  });
}
