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
  globalIgnores(['.next/**', 'node_modules/**', 'coverage/**', 'next-env.d.ts']),
]);
