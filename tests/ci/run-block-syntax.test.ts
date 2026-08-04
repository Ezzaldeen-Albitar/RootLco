/**
 * The general form of AR-48.
 *
 * A workflow can be valid YAML, pass `actionlint`, pass every rule in
 * `check-workflow-security.mjs`, and still contain a `run:` block that is not
 * valid shell. Nothing local executed one, so the first thing that noticed was a
 * hosted runner reporting `exit code 126` — a status that names nothing.
 *
 * These tests assert the DETECTION, not the current state of the repository. A
 * checker that only passes because the workflows happen to be well-formed would
 * keep passing after they stopped being.
 */
import { describe, it, expect } from 'vitest';
import {
  checkBlock,
  neutraliseExpressions,
  resolveShell,
  shellWorks,
} from '../../scripts/ci/check-run-block-syntax.mjs';

const APOSTROPHE = String.fromCharCode(39);

describe('the shell these checks depend on', () => {
  /**
   * P1-26-F-061. Every assertion below is worthless if `bash -n` cannot parse
   * anything, and on Windows that is the default state: `bash` on PATH is the
   * WSL launcher, which starts, fails to exec `/bin/bash`, and exits 1. The
   * three "this is valid shell" cases below then fail for a reason that has
   * nothing to do with shell syntax.
   */
  it('finds a bash that can actually parse a script', () => {
    const shell = resolveShell();
    expect(shell, 'no working bash was found — every check below would be meaningless').not.toBe(
      null
    );
    expect(shellWorks(shell)).toBe(true);
  });

  it('rejects a shell that starts but cannot run anything', () => {
    // The distinction the old probe missed: not "can it be spawned" but "can it
    // run a trivial script". A binary that exists and exits non-zero is not a
    // usable shell.
    expect(shellWorks('definitely-not-a-shell-rootlco')).toBe(false);
    expect(shellWorks(process.execPath)).toBe(false);
  });
});

describe('run-block shell syntax', () => {
  it('accepts an ordinary block', () => {
    const body = ['set -euo pipefail', 'for f in a b; do', '  echo "$f"', 'done'].join('\n');
    expect(checkBlock(body).ok).toBe(true);
  });

  it('catches the apostrophe that broke a hosted run', () => {
    // `node -e '…'` is a single-quoted SHELL string. An apostrophe in a
    // JavaScript comment closes it, and the rest is parsed as shell words.
    const body = [
      'set -euo pipefail',
      `node -e ${APOSTROPHE}`,
      `  // done by Trivy${APOSTROPHE}s analyzers`,
      '  console.log(1);',
      APOSTROPHE,
    ].join('\n');
    const verdict = checkBlock(body);
    expect(verdict.ok).toBe(false);
    expect(verdict.unavailable).toBe(false);
  });

  it('accepts the same block once the apostrophe is gone', () => {
    const body = [
      'set -euo pipefail',
      `node -e ${APOSTROPHE}`,
      '  // done by the Trivy analyzers',
      '  console.log(1);',
      APOSTROPHE,
    ].join('\n');
    expect(checkBlock(body).ok).toBe(true);
  });

  it('catches structural errors an apostrophe rule would miss', () => {
    expect(checkBlock('set -euo pipefail\nif [ 1 = 1 ]; then\n  echo x').ok).toBe(false);
    expect(checkBlock('set -euo pipefail\nfor f in a b; do\n  echo "$f"').ok).toBe(false);
    expect(checkBlock('set -euo pipefail\necho "unterminated').ok).toBe(false);
  });

  it('neutralises GitHub expressions, which never reach the shell verbatim', () => {
    expect(neutraliseExpressions('echo "${{ inputs.ref }}"')).toBe('echo "GHEXPR"');
    // A block whose only oddity is an expression must still be valid.
    expect(checkBlock('set -euo pipefail\necho "${{ steps.a.outputs.b }}"').ok).toBe(true);
  });
});
