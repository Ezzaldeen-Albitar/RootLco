import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';
import { filterMuiLayerSheetErrors, type JsdomVirtualConsole } from './support/jsdom-layer-filter';

/**
 * DOM tier setup.
 *
 * `cleanup` after every test, or a component from one case is still mounted
 * during the next and a `getByRole` finds two of everything — which usually
 * surfaces as a confusing "multiple elements" failure in an unrelated test.
 */
expect.extend(axeMatchers);

afterEach(() => {
  cleanup();
});

/**
 * jsdom implements neither of these, and both are used by the shell.
 *
 * Stubbing them here rather than in each test means a component that starts
 * using `matchMedia` does not fail in a file that never mentions it.
 */
if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }),
  });
}

if (!window.CSS?.escape) {
  Object.defineProperty(window, 'CSS', {
    writable: true,
    value: { ...(window.CSS ?? {}), escape: (value: string) => value.replace(/([^\w-])/g, '\\$1') },
  });
}

/**
 * jsdom has no `ResizeObserver`, and the MUI X data grid, charts and pickers
 * (ADR-022) construct one on mount to measure their container. Without a stub
 * every such component throws before it renders a row.
 *
 * The stub observes nothing: jsdom performs no layout, so there is no size to
 * report. A test that needs a measured size is a browser test, not a jsdom one.
 * Installed only when absent, so a jsdom that gains the API is not overridden.
 */
if (typeof window.ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(window, 'ResizeObserver', { writable: true, value: ResizeObserverStub });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    writable: true,
    value: ResizeObserverStub,
  });
}

/**
 * jsdom's CSS parser predates cascade layers, so every Material UI stylesheet
 * Emotion writes inside `@layer mui{…}` (ADR-022) is reported as a parse
 * failure. Exactly that report is dropped — see `support/jsdom-layer-filter.ts`
 * for the three conditions; every other jsdom error reaches the listeners that
 * were already registered, unchanged.
 */
{
  const virtualConsole = (globalThis as { jsdom?: { virtualConsole?: JsdomVirtualConsole } }).jsdom
    ?.virtualConsole;
  if (virtualConsole) filterMuiLayerSheetErrors(virtualConsole);
}
