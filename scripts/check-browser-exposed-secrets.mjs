#!/usr/bin/env node
/**
 * check-browser-exposed-secrets.mjs
 *
 * Fails if any tracked file names a Supabase service-role key with the
 * NEXT_PUBLIC_ prefix.
 *
 * WHY THIS MATTERS
 * Next.js inlines every NEXT_PUBLIC_-prefixed variable into the browser bundle.
 * The service-role key bypasses Row-Level Security entirely. Giving it that
 * prefix would publish a credential that can read and write every tenant's data
 * to anyone who opens the site. This is the single most dangerous naming mistake
 * available in this stack, which is why it has a dedicated, always-on check.
 *
 * WHY THE NAME IS BUILT FROM PARTS
 * The previous implementation grepped tracked files for the literal name. The
 * workflow that ran the grep is itself a tracked file containing that literal,
 * so the scan matched its own source and failed every run -- a false positive
 * that told us nothing about the repository. Assembling the name at runtime
 * means this scanner's source never contains it, so the scanner can scan itself
 * and the whole repository stays in scope. No file is excluded.
 *
 * OUTPUT SAFETY
 * Only `path:line` is ever printed. The matching line's content is never echoed,
 * because the value beside such a variable name is, by definition, a credential.
 *
 * This file is intentionally dependency-free (node: builtins only), so CI can run
 * it with `npm run security:browser-secrets` without an `npm ci` step.
 *
 * Exit codes: 0 = clean, 1 = violation found, 2 = could not run.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * The prohibited variable name, assembled at runtime.
 * Keep these fragments split. Joining them into one literal anywhere in this
 * repository would reintroduce the self-match bug this scanner exists to avoid.
 */
export function forbiddenName() {
  const prefix = 'NEXT_PUBLIC_' + 'SUPABASE_';
  const suffix = 'SERVICE_' + 'ROLE';
  return prefix + suffix;
}

/** Tracked files only, via git. NUL-delimited so paths with spaces survive. */
export function listTrackedFiles(cwd = process.cwd()) {
  const res = spawnSync('git', ['ls-files', '-z'], {
    cwd,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error || res.status !== 0) {
    const why = res.error ? res.error.message : `git exited ${res.status}`;
    throw new Error(`Could not list tracked files: ${why}`);
  }
  return res.stdout
    .toString('utf8')
    .split('\0')
    .filter((p) => p.length > 0);
}

/** Heuristic: a NUL byte in the head of the buffer means binary. */
function isBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

/**
 * @returns {Array<{file: string, line: number}>} violations, never any content.
 */
export function findViolations(files, cwd = process.cwd()) {
  const needle = forbiddenName();
  const violations = [];

  for (const file of files) {
    let buf;
    try {
      // path.resolve, not a file:// URL: git emits POSIX-style relative paths and
      // resolve() handles them correctly on Windows drive letters too.
      buf = readFileSync(resolve(cwd, file));
    } catch {
      // Tracked but absent from the working tree (e.g. a sparse checkout, or a
      // staged deletion). Nothing to read, nothing to leak.
      continue;
    }
    if (isBinary(buf)) continue;

    const text = buf.toString('utf8');
    if (!text.includes(needle)) continue; // fast path: most files

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(needle)) violations.push({ file, line: i + 1 });
    }
  }
  return violations;
}

function main() {
  const cwd = process.cwd();
  let files;
  try {
    files = listTrackedFiles(cwd);
  } catch (err) {
    console.error(`::error::${err.message}`);
    process.exit(2);
  }

  const violations = findViolations(files, cwd);

  if (violations.length > 0) {
    console.error(
      '::error::A service-role key must never use the NEXT_PUBLIC_ prefix. It bypasses ' +
        'Row-Level Security and would be inlined into the browser bundle. ' +
        'If a real key was committed: ROTATE IT FIRST, then purge history. ' +
        'Do not paste the value into an issue, a pull request, or a log.'
    );
    // Location only. Never the line content.
    for (const v of violations) console.error(`${v.file}:${v.line}`);
    process.exit(1);
  }

  console.log(`OK: no browser-exposed service-role variable found (${files.length} tracked files)`);
  process.exit(0);
}

// Only run when executed directly, so tests can import the pure helpers.
// pathToFileURL, not string concatenation: on Windows `file://C:/...` and
// `file:///C:/...` are not equal, so a hand-built URL never matches.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
