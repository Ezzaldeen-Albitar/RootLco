#!/usr/bin/env node
/**
 * Shell-syntax check for every multi-line `run:` block (AR-48).
 *
 * A workflow can be valid YAML, pass `actionlint`, pass every rule in
 * `check-workflow-security.mjs`, and still contain a `run:` block that is not
 * valid shell. Nothing local executed it, so the first thing that noticed was a
 * hosted runner reporting `exit code 126` — a status that names nothing.
 *
 * The defect that prompted this: a JavaScript comment inside `node -e '…'`
 * containing the word `Trivy's`. The apostrophe closed the single-quoted SHELL
 * string, and the remainder was parsed as shell words. The step was a security
 * gate, so its failure was indistinguishable from a real finding until someone
 * read the annotation.
 *
 * `WFS-014` catches that specific shape by pattern. This catches the GENERAL
 * case — any unbalanced quote, unterminated heredoc, `fi` without `if`, stray
 * `done` — by handing the block to `bash -n`, which parses without executing.
 *
 * GitHub expressions are substituted before the shell ever sees them, so
 * `${{ … }}` is replaced with a placeholder first. (Measured: bash tolerates the
 * raw form too, but the substitution keeps the check honest about what actually
 * runs.)
 *
 * Usage: node scripts/ci/check-run-block-syntax.mjs [--dir .github/workflows]
 * Exit codes: 0 clean · 1 a block is not valid shell · 2 the check could not run.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extractRunBlocks } from './check-workflow-security.mjs';

const DEFAULT_DIRS = ['.github/workflows', '.github/actions/setup-project'];

/** Replaces GitHub expressions, which are interpolated before the shell runs. */
export function neutraliseExpressions(body) {
  return body.replace(/\$\{\{[^}]*\}\}/g, 'GHEXPR');
}

export function checkBlock(body, bash = 'bash') {
  const file = join(tmpdir(), `rootlco-run-block-${process.pid}.sh`);
  writeFileSync(file, neutraliseExpressions(body));
  const result = spawnSync(bash, ['-n', file], { encoding: 'utf8' });
  if (result.error) return { ok: false, unavailable: true, message: result.error.message };
  return {
    ok: result.status === 0,
    unavailable: false,
    message: String(result.stderr ?? '')
      .split('\n')
      .filter(Boolean)
      .slice(0, 2)
      .join(' | '),
  };
}

function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const dirs = dirIndex === -1 ? DEFAULT_DIRS : [args[dirIndex + 1]];

  // A check that cannot run must not report success — the rule this whole
  // pipeline is built on. If `bash` is absent, that is a broken environment,
  // not a clean result.
  const probe = spawnSync('bash', ['-c', 'exit 0'], { encoding: 'utf8' });
  if (probe.error) {
    console.error(
      `::error::bash is not available, so no run block was checked (${probe.error.message}).`
    );
    process.exit(2);
  }

  let checked = 0;
  const failures = [];
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((n) => n.endsWith('.yml') || n.endsWith('.yaml'))) {
      const path = join(dir, file);
      const lines = readFileSync(path, 'utf8').split(/\r?\n/);
      for (const block of extractRunBlocks(lines)) {
        if (!block.multiline) continue;
        checked += 1;
        const verdict = checkBlock(block.body);
        if (!verdict.ok) failures.push({ path, line: block.start, message: verdict.message });
      }
    }
  }

  // Silence over an empty set is the failure mode this repository keeps
  // finding, so refuse to report clean without having examined anything.
  if (checked === 0) {
    console.error(
      '::error::No multi-line `run:` block was found. That is not a clean result, it is a check that did not run.'
    );
    process.exit(2);
  }

  for (const f of failures) {
    console.error(
      `::error file=${f.path},line=${f.line}::run block is not valid shell — ${f.message}`
    );
  }
  console.log(
    `Shell syntax: ${checked} multi-line run block(s) checked, ${failures.length} invalid.`
  );
  process.exit(failures.length === 0 ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
