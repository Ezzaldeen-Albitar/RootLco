import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

/**
 * Two PROJECTS, because the two tiers need different environments and one
 * `environment` setting would force a compromise on both.
 *
 * - `logic` — money, table state, navigation, i18n, the API client, the
 *   Stylelint policy. No DOM, so these stay fast and cannot quietly start
 *   depending on one.
 * - `dom` — component and accessibility tests, which need a document.
 *
 * The split also stops a component test becoming the only thing exercising a
 * pure function: the logic tier runs with no DOM at all, so a helper that
 * secretly reaches for `window` fails there rather than passing everywhere.
 */
const alias = { '@': fileURLToPath(new URL('./src', import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'logic',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          exclude: ['tests/**/*.dom.test.ts', 'tests/**/*.dom.test.tsx'],
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: 'dom',
          environment: 'jsdom',
          include: ['tests/**/*.dom.test.tsx', 'tests/**/*.dom.test.ts'],
          setupFiles: ['./tests/setup.dom.ts'],
        },
      },
    ],
  },
});
