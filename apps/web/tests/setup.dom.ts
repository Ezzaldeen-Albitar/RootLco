import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, expect, vi } from 'vitest';
import * as axeMatchers from 'vitest-axe/matchers';

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
