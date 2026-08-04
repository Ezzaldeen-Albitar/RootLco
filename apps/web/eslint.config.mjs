/**
 * The web application's ESLint entry point.
 *
 * It imports the Next.js flat configs DIRECTLY, the same way the repository's
 * canonical config does. The earlier form went through `FlatCompat` and the
 * eslintrc-era names `next/core-web-vitals` and `next/typescript`; under
 * eslint-config-next 16 those are no longer valid eslintrc shareable configs,
 * and the compatibility layer crashed inside its own error FORMATTER
 * ("Converting circular structure to JSON") while trying to report that. The
 * crash is why the real message was never visible.
 *
 * The failure had never been observed because `lint:web` was in no aggregate.
 * It is now — an application whose linter has never successfully run is not a
 * linted application.
 *
 * This config does NOT compose the repository root's, deliberately: the root
 * policy carries the modular-monolith boundary rules (ADR-001), which describe
 * the backend's module layering and mean nothing here.
 */
import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  ...nextVitals,
  ...nextTs,

  // `.next-dev/**` is where `next dev` builds, kept apart from `.next` so a
  // development build and a production build cannot overwrite each other (see
  // ROOTLCO_DIST_DIR). Omitting it linted ten thousand generated chunks — and
  // never in CI, which has no development build, so only a developer running
  // `npm run lint` after `npm run dev:all` ever saw it (P1-26-F-060).
  globalIgnores(['.next/**', '.next-dev/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts']),

  {
    rules: {
      // A brand value or a design value reaching a component is an architecture
      // failure, not a style preference. The dedicated scripts enforce the
      // colour and brand rules; this keeps the obvious unsafe escape hatch shut.
      'react/no-danger': 'error',
    },
  },
]);
