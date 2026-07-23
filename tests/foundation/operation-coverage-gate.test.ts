/**
 * Negative fixture for the operation-to-test coverage gate (P1-14 remediation).
 *
 * The gate's whole purpose is to FAIL when operation evidence is incomplete. A
 * gate that cannot be shown to fail is indistinguishable from one that always
 * passes, so this suite drives the pure `evaluateCoverage()` with synthetic
 * inputs and proves each failure mode is detected — and, as a control, that a
 * complete declaration passes.
 *
 * It also runs the gate against the REAL manifest and real repository files, so a
 * future edit that drops a required flag or de-references an operation fails here
 * as well as in CI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  MANIFEST,
  evaluateCoverage,
  parseProvidedFlags,
  stripCoverageBlock,
  scanRegisteredOperationIds,
} from '../../scripts/check-operation-test-coverage.mjs';

const ROOT = process.cwd();
const complete = `
 * Operations exercised here: iam.demo-op
 *
 * COVERAGE-EVIDENCE (...):
 *   iam.demo-op: success denial audit
 */
describe('iam.demo-op', () => { it('invokes iam.demo-op', () => {}); });
`;

describe('operation coverage gate — negative fixture', () => {
  const registered = new Set(['iam.demo-op']);
  const manifest = {
    'iam.demo-op': { file: 'demo.test.ts', required: ['success', 'denial', 'audit'] },
  };
  const read = (text: string) => (p: string) => (p === 'demo.test.ts' ? text : null);

  it('passes when the operation is invoked and all required flags are declared', () => {
    const { failures } = evaluateCoverage({ registered, manifest, readFile: read(complete) });
    expect(failures).toEqual([]);
  });

  // P1-15 widened the declaration parser from `iam|meta` to `iam|meta|shared`.
  // The two cases below pin BOTH halves of that change: a `shared.` declaration
  // must now be read, and a namespace nobody registered must still be invisible —
  // otherwise a typo like `share.foo` would silently declare nothing and the
  // operation would fail for a reason that looks like a missing test.
  it('reads a shared. declaration (the P1-15 namespace)', () => {
    const sharedComplete = `
 * Operations exercised here: shared.demo-op
 *
 * COVERAGE-EVIDENCE (...):
 *   shared.demo-op: success denial audit outbox
 */
describe('shared.demo-op', () => { it('invokes shared.demo-op', () => {}); });
`;
    const { failures } = evaluateCoverage({
      registered: new Set(['shared.demo-op']),
      manifest: {
        'shared.demo-op': {
          file: 'demo.test.ts',
          required: ['success', 'denial', 'audit', 'outbox'],
        },
      },
      readFile: read(sharedComplete),
    });
    expect(failures).toEqual([]);
  });

  it('does NOT read a declaration in an unregistered namespace', () => {
    const wrongNamespace = complete.replace(/iam\.demo-op:/, 'share.demo-op:');
    const provided = parseProvidedFlags(wrongNamespace);
    expect(provided.has('share.demo-op')).toBe(false);
    expect(provided.has('iam.demo-op')).toBe(false);
  });

  it('FAILS when a required evidence flag is missing', () => {
    const missingAudit = complete.replace('success denial audit', 'success denial');
    const { failures } = evaluateCoverage({ registered, manifest, readFile: read(missingAudit) });
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f: string) => f.includes('audit'))).toBe(true);
  });

  it('FAILS when the operation id appears only in its COVERAGE-EVIDENCE block (declared, never invoked)', () => {
    const declaredOnly = `
 * COVERAGE-EVIDENCE (...):
 *   iam.demo-op: success denial audit
 */
describe('some other unrelated operation', () => {});
`;
    const { failures } = evaluateCoverage({ registered, manifest, readFile: read(declaredOnly) });
    expect(failures.some((f: string) => f.includes('does not reference'))).toBe(true);
  });

  it('FAILS when the test file does not exist / cannot be read', () => {
    const { failures } = evaluateCoverage({ registered, manifest, readFile: () => null });
    expect(failures.some((f: string) => f.includes('does not reference'))).toBe(true);
  });

  it('FAILS when a registered operation is absent from the manifest', () => {
    const { failures } = evaluateCoverage({
      registered: new Set(['iam.demo-op', 'iam.unmapped-op']),
      manifest,
      readFile: read(complete),
    });
    expect(failures.some((f: string) => f.includes('missing from the coverage manifest'))).toBe(
      true
    );
  });

  it('FAILS when the manifest names an operation that is not registered (stale)', () => {
    const stale = { ...manifest, 'iam.ghost-op': { file: 'demo.test.ts', required: [] } };
    const { failures } = evaluateCoverage({
      registered,
      manifest: stale,
      readFile: read(complete),
    });
    expect(failures.some((f: string) => f.includes('not registered'))).toBe(true);
  });

  it('stripCoverageBlock removes the declaration but keeps the rest of the file', () => {
    const stripped = stripCoverageBlock(complete);
    expect(stripped).toContain("describe('iam.demo-op'");
    // The flag list only ever appears inside the COVERAGE-EVIDENCE block.
    expect(stripped).not.toContain('success denial audit');
  });

  it('parseProvidedFlags reads exactly the declared flags', () => {
    const flags = parseProvidedFlags(complete).get('iam.demo-op');
    expect([...flags].sort()).toEqual(['audit', 'denial', 'success']);
  });
});

describe('operation coverage gate — real manifest', () => {
  it('every registered operation passes the strict gate against the real files', () => {
    const registered = scanRegisteredOperationIds(ROOT);
    const readFile = (rel: string) => {
      const abs = join(ROOT, rel);
      return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    };
    const { failures } = evaluateCoverage({ registered, manifest: MANIFEST, readFile });
    expect(failures).toEqual([]);
  });
});
