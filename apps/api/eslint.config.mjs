/**
 * The API application's ESLint entry point.
 *
 * It COMPOSES the repository's canonical policy rather than restating it. A
 * second copy of the rules would drift, and the drift would be silent: the
 * modular-monolith boundary rules (ADR-001) only fail when someone violates
 * them, so a copy that quietly lost a rule would look exactly like a clean tree.
 *
 * The canonical config scopes its boundary rules with `files: ['src/**']`.
 * Flat-config `files` patterns resolve against the directory of the config file
 * ESLint was launched with — this one — so the same patterns now mean
 * `apps/api/src/**`. That is the whole reason this file exists as a composition
 * and not as a re-export from the root: running the ROOT config against this
 * tree would resolve `src/**` at the repository root, match nothing, and report
 * a clean run over an unchecked application. The first migration attempt failed
 * the other way — no config here at all, so `next/typescript` never loaded and
 * 2,863 errors appeared from rules that were never meant to run bare.
 */
import { defineConfig, globalIgnores } from 'eslint/config';
import rootPolicy from '../../eslint.config.mjs';

export default defineConfig([
  ...rootPolicy,
  {
    /**
     * Browser globals are not available to this workspace.
     *
     * This lives in ESLint rather than in `scripts/ci/check-api-backend-only.mjs`
     * on purpose. That gate reasons about FILES; deciding whether the identifier
     * `document` is the DOM or a local variable needs SCOPE, and only a parser
     * has that. This workspace really does contain `const document = …` (an
     * attachment record) and `input.window.from` (a job-assignment time window),
     * and a text search cannot tell those from the real globals — the first
     * draft of the gate flagged four such lines, every one of them correct code.
     * ESLint can tell: a declared local shadows the global and is not reported.
     *
     * `window` is deliberately absent from this list. Its one legitimate use in
     * a Backend is the server-only guard `typeof window !== 'undefined'`, which
     * `src/config/env.ts` and `src/server/config/backend-config.ts` use to
     * REFUSE to run in a browser. Restricting it would put a disable comment on
     * the very pattern that enforces the boundary. Real DOM work cannot happen
     * through `window` alone anyway: it needs `document`, restricted here, or a
     * React client module, which the file-level gate rejects.
     */
    files: ['src/**/*.{ts,tsx,mts,cts}'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'document', message: 'The API renders no DOM. Frontend code belongs in apps/web.' },
        {
          name: 'navigator',
          message: 'The API has no browser. Frontend code belongs in apps/web.',
        },
        {
          name: 'localStorage',
          message: 'The API has no browser storage. Frontend code belongs in apps/web.',
        },
        {
          name: 'sessionStorage',
          message: 'The API has no browser storage. Frontend code belongs in apps/web.',
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts']),
]);
