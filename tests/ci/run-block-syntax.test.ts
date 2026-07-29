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
import { checkBlock, neutraliseExpressions } from '../../scripts/ci/check-run-block-syntax.mjs';

const APOSTROPHE = String.fromCharCode(39);

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
