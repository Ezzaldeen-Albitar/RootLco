#!/usr/bin/env node
/**
 * Hostile mutation matrix for the CodeQL remediation.
 *
 * A test that passes proves the code does something. Only a test that FAILS
 * when the guarantee is broken proves it pins that guarantee. Each entry below
 * breaks exactly one property in exactly one place, runs the suite that is
 * supposed to notice, and asserts a non-zero exit. A mutation that survives is
 * a test that proves nothing.
 *
 * This is deliberately NOT wired into the pipeline: it edits tracked source in
 * place, and a CI job that does that is a job that can leave a broken tree
 * behind. It is a pre-merge instrument, run by hand, and it restores every file
 * in a `finally` — including when the verification command throws.
 *
 * The matrix caught a survivor on its first run: `safeText` had no assertion
 * that could distinguish backslash-first escaping from pipe-first, so the
 * high-severity `js/incomplete-sanitization` fix was unpinned. That is the
 * whole argument for running it.
 *
 * Usage: node scripts/ci/hostile-mutations.mjs
 * Exit codes: 0 every mutation caught · 1 something survived.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

const VALIDATION = 'npx vitest run tests/foundation/validation.test.ts';
const SECRETS = 'npx vitest run tests/foundation/idempotency-secret-material.test.ts';
const POLICY = 'npx vitest run tests/ci/codeql-policy.test.ts';

/**
 * Every `verify` command is a literal from this frozen table. Nothing here is
 * built from an argument, an environment variable or a file — the only inputs
 * this script has are the ones written below.
 */
const MUTATIONS = Object.freeze([
  // ---- src/server/http/validation.ts — the prototype fix -------------------
  {
    id: 'M-01',
    target: 'src/server/http/validation.ts',
    claim: 'the accumulator has a null prototype, so Zod cannot read an inherited field',
    from: 'const out = Object.create(null) as Record<string, string | string[]>;',
    to: 'const out = {} as Record<string, string | string[]>;',
    verify: VALIDATION,
  },
  {
    id: 'M-02',
    target: 'src/server/http/validation.ts',
    claim: 'a __proto__ parameter is not copied, so the anomaly cannot travel into a copy',
    from: "    if (key === '__proto__') continue;",
    to: '',
    verify: VALIDATION,
  },
  {
    id: 'M-03',
    target: 'src/server/http/validation.ts',
    claim: 'the comparison is exact — a case-folded one would match nothing',
    from: "    if (key === '__proto__') continue;",
    to: "    if (key === '__PROTO__') continue;",
    verify: VALIDATION,
  },
  {
    id: 'M-04',
    target: 'src/server/http/validation.ts',
    claim: 'the function is TOTAL: eight routes call it outside the error boundary',
    from: "    if (key === '__proto__') continue;",
    to: "    if (key === '__proto__') throw new AppFailure('ERR-VAL-001', { message: 'x' });",
    verify: VALIDATION,
  },
  {
    id: 'M-05',
    target: 'src/server/http/validation.ts',
    claim: 'a repeated parameter still arrives as an array',
    from: "    out[key] = values.length > 1 ? values : (values[0] ?? '');",
    to: "    out[key] = values[0] ?? '';",
    verify: VALIDATION,
  },

  // ---- src/server/http/idempotency.ts — secret material --------------------
  {
    id: 'M-06',
    target: 'src/server/http/idempotency.ts',
    claim: 'the body is screened BEFORE it reaches createHash',
    from: "  assertNoSecretMaterial(input.body, 'body');",
    to: '',
    verify: SECRETS,
  },
  {
    id: 'M-07',
    target: 'src/server/http/idempotency.ts',
    claim: 'route params are screened too, not only the body',
    from: "  assertNoSecretMaterial(input.params ?? {}, 'params');",
    to: '',
    verify: SECRETS,
  },
  {
    id: 'M-08',
    target: 'src/server/http/idempotency.ts',
    claim: 'the word list actually contains `password`',
    from: "  'password',\n  'passwd',",
    to: "  'passwd',",
    verify: SECRETS,
  },
  {
    id: 'M-09',
    target: 'src/server/http/idempotency.ts',
    claim: 'camelCase is split, so `newPassword` is seen — the gap the guard tests caught',
    from: "    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')",
    to: '',
    verify: SECRETS,
  },
  {
    id: 'M-10',
    target: 'src/server/http/idempotency.ts',
    claim: 'nesting is walked, so a secret one level down is still seen',
    from: '  if (depth > 32 || value === null || typeof value !== ',
    to: '  if (depth > 0 || value === null || typeof value !== ',
    verify: SECRETS,
  },

  // ---- scripts/ci/codeql-policy.mjs — the SARIF gate -----------------------
  {
    id: 'M-11',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'a dismissal matches on rule AND path, never on rule alone',
    from: '  return entry.ruleId === finding.ruleId && entry.path === finding.path;',
    to: '  return entry.ruleId === finding.ruleId;',
    verify: POLICY,
  },
  {
    id: 'M-12',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'the high band starts at 7.0 — raising it is how sensitivity gets lowered quietly',
    from: "  if (score >= 7.0) return { level: 'high', score };",
    to: "  if (score >= 8.5) return { level: 'high', score };",
    verify: POLICY,
  },
  {
    id: 'M-13',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'a language whose SARIF is absent is reported, not assumed clean',
    from: '  const missingLanguages = expectedLanguages.filter((language) => {',
    to: '  const missingLanguages = [].filter((language) => {',
    verify: POLICY,
  },
  {
    id: 'M-14',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'a pack matches a hyphen-segment filename (javascript-typescript → javascript.sarif)',
    from: "    const candidates = [language, ...language.split('-')];",
    to: '    const candidates = [language];',
    verify: POLICY,
  },
  {
    id: 'M-15',
    target: 'scripts/ci/codeql-policy.mjs',
    claim: 'the ceiling is enforced, so a new finding cannot arrive unnoticed',
    from: "  if (typeof ceiling === 'number' && open.length > ceiling) {",
    to: "  if (typeof ceiling === 'number' && false) {",
    verify: POLICY,
  },

  // ---- scripts/ci/check-commit-checks.mjs — the AR-52 instrument -----------
  {
    id: 'M-16',
    target: 'scripts/ci/check-commit-checks.mjs',
    claim: 'the backslash is escaped BEFORE the pipe',
    from: "    .replace(/\\\\/g, '\\\\\\\\')\n    .replace(/\\|/g, '\\\\|')",
    to: "    .replace(/\\|/g, '\\\\|')",
    verify: POLICY,
  },
  {
    id: 'M-17',
    target: 'scripts/ci/check-commit-checks.mjs',
    claim: 'a `failure` conclusion is not acceptable',
    from: "export const ACCEPTABLE = Object.freeze(['success', 'skipped', 'neutral']);",
    to: "export const ACCEPTABLE = Object.freeze(['success', 'skipped', 'neutral', 'failure']);",
    verify: POLICY,
  },
  {
    id: 'M-18',
    target: 'scripts/ci/check-commit-checks.mjs',
    claim: 'a check still running is not counted as passed',
    from: "    if (check.status !== 'completed') {",
    to: '    if (false) {',
    verify: POLICY,
  },
]);

const results = [];

for (const mutation of MUTATIONS) {
  const original = readFileSync(mutation.target, 'utf8');

  // A mutation whose target string has drifted is not a passing mutation — it
  // is a mutation that never ran, which is the CSA-06 shape.
  if (!original.includes(mutation.from)) {
    results.push({
      ...mutation,
      outcome: 'target string not found — the matrix has drifted',
      caught: false,
    });
    console.log(`${mutation.id}  NOT FOUND  ${mutation.target}`);
    continue;
  }

  const mutated = original.replace(mutation.from, mutation.to);
  let caught = false;
  let outcome = '';
  try {
    writeFileSync(mutation.target, mutated);
    try {
      execSync(mutation.verify, { stdio: 'pipe', encoding: 'utf8' });
      outcome = 'the suite PASSED against mutated source';
    } catch (error) {
      caught = true;
      const text = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      const failed = text.match(/Tests\s+\S*\s*(\d+) failed/);
      outcome = failed
        ? `${failed[1]} test(s) failed`
        : /error TS\d+|Transform failed|SyntaxError/.test(text)
          ? 'rejected at compile time'
          : 'non-zero exit';
    }
  } finally {
    // Always, including on a throw above. A harness that leaves a mutated file
    // behind is worse than no harness.
    writeFileSync(mutation.target, original);
  }

  results.push({ ...mutation, outcome, caught });
  console.log(
    `${mutation.id}  ${caught ? 'CAUGHT  ' : 'SURVIVED'}  ${mutation.claim} — ${outcome}`
  );
}

const survivors = results.filter((result) => !result.caught);
console.log(`\n${results.length - survivors.length}/${results.length} mutations caught.`);
for (const survivor of survivors) {
  console.log(`SURVIVOR ${survivor.id}  ${survivor.target}  ${survivor.claim}`);
}
process.exitCode = survivors.length === 0 ? 0 : 1;
