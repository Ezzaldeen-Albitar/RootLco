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
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
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

/**
 * Candidate shells, in order. `bash` first: on a Linux runner it is the shell
 * the workflow will actually use, and nothing should displace it.
 *
 * On Windows `bash` resolves to `C:\Windows\System32\bash.exe`, which is the
 * **WSL launcher**, not a shell. With no distro installed it runs, exits 1, and
 * prints `execvpe(/bin/bash) failed` to stderr — so `spawnSync` reports no
 * `error`, and every block gets judged unparseable shell. The check does not go
 * quiet, it goes uniformly red, which is a different way of telling you nothing
 * (P1-26-F-061).
 */
const SHELL_CANDIDATES = [
  'bash',
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
];

/** True when this shell can parse a trivial script — not merely start. */
export function shellWorks(bash) {
  const probe = spawnSync(bash, ['-c', 'exit 0'], { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
}

/**
 * The first candidate that actually runs, or null.
 *
 * Resolved once: 126 blocks must not each pay for the probe, and must not
 * silently disagree with each other about which shell they used.
 */
let resolved;
export function resolveShell() {
  if (resolved === undefined) resolved = SHELL_CANDIDATES.find((c) => shellWorks(c)) ?? null;
  return resolved;
}

export function checkBlock(body, bash = resolveShell()) {
  if (!bash) {
    return {
      ok: false,
      unavailable: true,
      message: 'no working bash was found, so nothing was parsed',
    };
  }
  // A fresh 0700 directory per call, rather than a predictable
  // `${tmpdir}/rootlco-run-block-${pid}.sh`. The old name was guessable, so on a
  // shared machine another process could pre-create it as a symlink and have
  // this function write through it; and because the path was the same for every
  // block, two concurrent callers would have overwritten each other's script
  // and checked the wrong text. Removed afterwards so 126 blocks do not leave
  // 126 directories behind.
  const dir = mkdtempSync(join(tmpdir(), 'rootlco-run-block-'));
  const file = join(dir, 'block.sh');
  try {
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const dirs = dirIndex === -1 ? DEFAULT_DIRS : [args[dirIndex + 1]];

  // A check that cannot run must not report success — the rule this whole
  // pipeline is built on. If `bash` is absent, that is a broken environment,
  // not a clean result.
  //
  // Absent is not the only way to be unusable. This probe used to test only
  // `probe.error`, which is set when the executable cannot be STARTED; a shell
  // that starts and then cannot run anything sailed past it and turned every
  // block red instead (P1-26-F-061). `resolveShell` requires a trivial script to
  // actually exit 0.
  const shell = resolveShell();
  if (!shell) {
    console.error(
      '::error::no working bash was found, so no run block was checked. ' +
        'On Windows, `bash` on PATH is the WSL launcher and needs an installed distribution; ' +
        'Git Bash is used instead when present.'
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
