/**
 * Negative fixture for the operation-to-test coverage gate.
 *
 * The gate's whole purpose is to FAIL when operation evidence is incomplete. A
 * gate that cannot be shown to fail is indistinguishable from one that always
 * passes, so this suite drives the pure `evaluateCoverage()` with synthetic
 * inputs and proves each failure mode is detected — and, as a control, that a
 * complete declaration passes.
 *
 * P1-15 added a second half. For the `shared.` namespace the obligations are
 * DERIVED from the operation's own `defineOperation({...})` registration rather
 * than declared in the manifest, so there are two things to prove:
 *
 *   1. `derivedRequirements()` produces the right floor for each registration
 *      shape — idempotent implies idempotency, versionGuarded implies
 *      stale-version, an audit class implies audit, a `{param}` implies
 *      cross-tenant, branch scope implies isolation, public flips
 *      authorization to unauthenticated;
 *   2. the evaluator FAILS when a file omits any one of them, and when the
 *      evidence is metadata-only, unit-only, unreferenced, or pending.
 *
 * It also runs the gate against the REAL manifest and real repository files, so
 * a future edit that drops a required flag or de-references an operation fails
 * here as well as in CI.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  MANIFEST,
  derivedRequirements,
  evaluateCoverage,
  parseProvidedFlags,
  stripCoverageBlock,
  stripComments,
  scanRegisteredOperations,
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

/**
 * The P1-18 ratchet, tested directly.
 *
 * `stripComments` is what makes "prose is not a test" true, and it shipped
 * untested — so a silent revert, or the `//` gap it originally had, broke nothing.
 * These cases are the contract: every comment form is removed, and no string,
 * template, regex or URL is corrupted in the process (over-stripping would cause
 * false FAILURES, which is its own kind of wrong).
 */
describe('operation coverage gate — the P1-18 comment ratchet', () => {
  const ID = 'rec.reception-signature';

  it('rejects an operation id that appears only in a line comment', () => {
    expect(stripComments(`// ${ID}\nconst x = 1;`)).not.toContain(ID);
  });

  it('rejects an operation id that appears only in a block comment', () => {
    expect(stripComments(`/* ${ID} */\nconst x = 1;`)).not.toContain(ID);
  });

  it('rejects an operation id that appears only in JSDoc', () => {
    expect(stripComments(`/**\n * ${ID}\n */\nconst x = 1;`)).not.toContain(ID);
  });

  it('rejects an operation id that appears only in the prose coverage header', () => {
    // The exact shape every P1-18 suite carries: the "Operations exercised here"
    // line and the COVERAGE-EVIDENCE block live in the SAME JSDoc, which is how
    // the original line-based strip let the header survive.
    const header = `/**\n * Operations exercised here: ${ID}.\n *\n * COVERAGE-EVIDENCE:\n *   ${ID}: route service success\n */\nconst x = 1;`;
    expect(stripComments(header)).not.toContain(ID);
  });

  it('accepts an operation id used in a describe title', () => {
    expect(stripComments(`describe('${ID}', () => {});`)).toContain(ID);
  });

  it('accepts an operation id used in an it title', () => {
    expect(stripComments(`it('drives ${ID} end to end', () => {});`)).toContain(ID);
  });

  it('does not corrupt a URL containing //', () => {
    const src = "const R = 'http://localhost/api/v1/receptions';";
    expect(stripComments(src)).toBe(src);
  });

  it('does not corrupt a regex literal containing //, and still strips after it', () => {
    const out = stripComments(`const re = /a\\/\\/b/; // ${ID}`);
    expect(out).toContain('/a\\/\\/b/');
    expect(out).not.toContain(ID);
  });

  it('treats a lone slash as division rather than a regex', () => {
    const out = stripComments(`const z = a / b; // ${ID}\nconst w = 2;`);
    expect(out).toContain('const z = a / b;');
    expect(out).toContain('const w = 2;');
    expect(out).not.toContain(ID);
  });

  it('keeps an id that is genuinely inside a string literal', () => {
    // A string is executable code: `authAs('…')`, a path, a describe title built
    // from a constant. Only comments are prose.
    expect(stripComments(`const s = "x // ${ID}";`)).toContain(ID);
  });

  it('reports the earlier-phase debt rather than claiming the strict rule applies', () => {
    // The ratchet is P1-18-only on purpose, and the source says why. If this
    // assertion ever fails, the note has been removed and the bounded debt is no
    // longer named anywhere.
    const gate = readFileSync(join(ROOT, 'scripts/check-operation-test-coverage.mjs'), 'utf8');
    expect(gate).toContain('P1-18-R-02');
    expect(gate).toMatch(/39 of them|39 operations/);
  });
});

describe('operation coverage gate — P1-14 evidence model, unchanged', () => {
  const registered = new Set(['iam.demo-op']);
  const manifest = {
    'iam.demo-op': { file: 'demo.test.ts', required: ['success', 'denial', 'audit'] },
  };
  const read = (text: string) => (p: string) => (p === 'demo.test.ts' ? text : null);

  it('passes when the operation is invoked and all required flags are declared', () => {
    const { failures } = evaluateCoverage({ registered, manifest, readFile: read(complete) });
    expect(failures).toEqual([]);
  });

  it('still accepts the single-file `file:` manifest spelling', () => {
    const { matrix } = evaluateCoverage({ registered, manifest, readFile: read(complete) });
    expect(matrix.map((m: { files: readonly string[] }) => m.files)).toEqual([['demo.test.ts']]);
  });

  it('derives NOTHING for an iam operation — P1-14 obligations stay declared', () => {
    expect(
      derivedRequirements({ id: 'iam.demo-op', idempotent: true, versionGuarded: true })
    ).toEqual([]);
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

  it('FAILS when the manifest names no test file at all', () => {
    const { failures } = evaluateCoverage({
      registered,
      manifest: { 'iam.demo-op': { required: [] } },
      readFile: read(complete),
    });
    expect(failures.some((f: string) => f.includes('names no test file'))).toBe(true);
  });

  it('FAILS when a manifest entry carries the removed `pending` state', () => {
    const { failures } = evaluateCoverage({
      registered,
      manifest: {
        'iam.demo-op': { file: 'demo.test.ts', required: [], pending: true },
      },
      readFile: read(complete),
    });
    expect(failures.some((f: string) => f.includes('not a permitted state'))).toBe(true);
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

// ===========================================================================
// P1-15: obligations derived from the registration
// ===========================================================================

/** A plain, non-public, tenant-scoped POST with no parameter and no audit. */
const plainOperation = {
  id: 'shared.demo-op',
  module: 'shared-services',
  method: 'POST',
  path: '/demo-things',
  scope: 'tenant',
  auditClass: 'none',
  public: false,
  idempotent: false,
  versionGuarded: false,
  surface: 'public-api',
  source: 'src/app/api/v1/demo-things/route.ts',
};

describe('derivedRequirements — the floor a registration creates', () => {
  it('every shared operation owes route, service and success', () => {
    expect(derivedRequirements(plainOperation)).toEqual(
      expect.arrayContaining(['route', 'service', 'success'])
    );
  });

  it('an authenticated operation owes authorization; a public one owes unauthenticated', () => {
    expect(derivedRequirements(plainOperation)).toContain('authorization');
    expect(derivedRequirements(plainOperation)).not.toContain('unauthenticated');

    const probe = { ...plainOperation, public: true };
    expect(derivedRequirements(probe)).toContain('unauthenticated');
    expect(derivedRequirements(probe)).not.toContain('authorization');
  });

  it('a caller-supplied identifier in the path owes cross-tenant', () => {
    expect(derivedRequirements(plainOperation)).not.toContain('cross-tenant');
    expect(derivedRequirements({ ...plainOperation, path: '/demo-things/{thingId}' })).toContain(
      'cross-tenant'
    );
  });

  it('idempotent owes idempotency, versionGuarded owes stale-version', () => {
    expect(derivedRequirements({ ...plainOperation, idempotent: true })).toContain('idempotency');
    expect(derivedRequirements({ ...plainOperation, versionGuarded: true })).toContain(
      'stale-version'
    );
  });

  it('an audit class other than none owes audit', () => {
    expect(derivedRequirements(plainOperation)).not.toContain('audit');
    expect(derivedRequirements({ ...plainOperation, auditClass: 'privileged' })).toContain('audit');
  });

  it('company or branch scope owes isolation', () => {
    expect(derivedRequirements(plainOperation)).not.toContain('isolation');
    expect(derivedRequirements({ ...plainOperation, scope: 'branch' })).toContain('isolation');
    expect(derivedRequirements({ ...plainOperation, scope: 'company' })).toContain('isolation');
  });
});

describe('operation coverage gate — P1-15 derived obligations FAIL when unmet', () => {
  const FILE = 'p1-15-demo.test.ts';

  /** Builds a file whose COVERAGE-EVIDENCE declares exactly `flags`. */
  const fileWith = (flags: readonly string[]): string => `
 * Operations exercised here: shared.demo-op
 *
 * COVERAGE-EVIDENCE (...):
 *   shared.demo-op: ${flags.join(' ')}
 */
describe('shared.demo-op', () => { it('invokes shared.demo-op', () => {}); });
`;

  const run = (
    operation: Record<string, unknown>,
    flags: readonly string[],
    entry: Record<string, unknown> = {}
  ) =>
    evaluateCoverage({
      registered: new Map([['shared.demo-op', operation]]),
      manifest: { 'shared.demo-op': { files: [FILE], required: [], ...entry } },
      readFile: (p: string) => (p === FILE ? fileWith(flags) : null),
    });

  const FULL = ['route', 'service', 'authorization', 'success'];

  it('PASSES with the complete derived floor', () => {
    expect(run(plainOperation, FULL).failures).toEqual([]);
  });

  it('reports the operation at operation depth once the floor is met', () => {
    const { counts } = run(plainOperation, FULL);
    expect(counts.p1_15).toEqual({
      registered: 1,
      publicApi: 1,
      operationDepth: 1,
      invocationOnly: 0,
      pending: 0,
      unitOnly: 0,
      unreferenced: 0,
      metadataOnly: 0,
    });
  });

  it('FAILS when route evidence is missing', () => {
    const { failures, counts } = run(plainOperation, ['service', 'authorization', 'success']);
    expect(failures.some((f: string) => f.includes('route'))).toBe(true);
    expect(counts.p1_15.operationDepth).toBe(0);
  });

  it('FAILS when service evidence is missing', () => {
    const { failures } = run(plainOperation, ['route', 'authorization', 'success']);
    expect(failures.some((f: string) => f.includes('service'))).toBe(true);
  });

  it('FAILS when authorization evidence is missing', () => {
    const { failures } = run(plainOperation, ['route', 'service', 'success']);
    expect(failures.some((f: string) => f.includes('authorization'))).toBe(true);
  });

  it('FAILS when a public operation has no unauthenticated evidence', () => {
    const { failures } = run({ ...plainOperation, public: true }, FULL);
    expect(failures.some((f: string) => f.includes('unauthenticated'))).toBe(true);
  });

  it('FAILS when a parameterised path has no cross-tenant evidence', () => {
    const { failures } = run({ ...plainOperation, path: '/demo-things/{thingId}' }, FULL);
    expect(failures.some((f: string) => f.includes('cross-tenant'))).toBe(true);
  });

  it('FAILS when an idempotent command has no idempotency evidence', () => {
    const { failures } = run({ ...plainOperation, idempotent: true }, FULL);
    expect(failures.some((f: string) => f.includes('idempotency'))).toBe(true);
  });

  it('FAILS when a version-guarded command has no stale-version evidence', () => {
    const { failures } = run({ ...plainOperation, versionGuarded: true }, FULL);
    expect(failures.some((f: string) => f.includes('stale-version'))).toBe(true);
  });

  it('FAILS when an audited command has no audit evidence', () => {
    const { failures } = run({ ...plainOperation, auditClass: 'privileged' }, FULL);
    expect(failures.some((f: string) => f.includes('audit'))).toBe(true);
  });

  it('FAILS when a branch-scoped operation has no isolation evidence', () => {
    const { failures } = run({ ...plainOperation, scope: 'branch' }, FULL);
    expect(failures.some((f: string) => f.includes('isolation'))).toBe(true);
  });

  it('FAILS when a manifest-declared obligation such as outbox is unmet', () => {
    const { failures } = run(plainOperation, FULL, { required: ['outbox'] });
    expect(failures.some((f: string) => f.includes('outbox'))).toBe(true);
  });

  it('FAILS as metadata-only when neither route nor service is declared', () => {
    const { failures, counts } = run(plainOperation, ['authorization', 'success']);
    expect(failures.some((f: string) => f.includes('metadata-only'))).toBe(true);
    expect(counts.p1_15.metadataOnly).toBe(1);
  });

  it('FAILS as unit-only when every named file is a pure-unit suite', () => {
    const unitFile = 'tests/foundation/p1-15-demo.test.ts';
    const { failures, counts } = evaluateCoverage({
      registered: new Map([['shared.demo-op', plainOperation]]),
      manifest: { 'shared.demo-op': { files: [unitFile], required: [] } },
      readFile: (p: string) => (p === unitFile ? fileWith(FULL) : null),
    });
    expect(failures.some((f: string) => f.includes('unit-only'))).toBe(true);
    expect(counts.p1_15.unitOnly).toBe(1);
  });

  it('FAILS as unreferenced when ONE of several named files never invokes it', () => {
    const other = 'p1-15-other.test.ts';
    const { failures, counts } = evaluateCoverage({
      registered: new Map([['shared.demo-op', plainOperation]]),
      manifest: { 'shared.demo-op': { files: [FILE, other], required: [] } },
      readFile: (p: string) =>
        p === FILE ? fileWith(FULL) : p === other ? 'describe("unrelated", () => {});' : null,
    });
    expect(failures.some((f: string) => f.includes('does not reference'))).toBe(true);
    expect(counts.p1_15.unreferenced).toBe(1);
  });

  it('FAILS when a shared operation is registered outside a route file with no stated reason', () => {
    const { failures } = run({ ...plainOperation, surface: 'internal' }, FULL);
    expect(failures.some((f: string) => f.includes('internalReason'))).toBe(true);
  });

  it('accepts a formally reclassified internal registration that states its reason', () => {
    const { failures } = run({ ...plainOperation, surface: 'internal' }, FULL, {
      internalReason: 'Infrastructure-only registration; not exposed as a public API.',
    });
    expect(failures).toEqual([]);
  });

  it('unions flags across files rather than requiring one file to carry everything', () => {
    const second = 'p1-15-second.test.ts';
    const { failures } = evaluateCoverage({
      registered: new Map([['shared.demo-op', plainOperation]]),
      manifest: { 'shared.demo-op': { files: [FILE, second], required: [] } },
      readFile: (p: string) =>
        p === FILE
          ? fileWith(['route', 'authorization'])
          : p === second
            ? fileWith(['service', 'success'])
            : null,
    });
    expect(failures).toEqual([]);
  });
});

describe('operation coverage gate — real registry and real files', () => {
  it('every registered operation passes the strict gate', () => {
    const registered = scanRegisteredOperations(ROOT);
    const readFile = (rel: string) => {
      const abs = join(ROOT, rel);
      return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    };
    const { failures } = evaluateCoverage({ registered, manifest: MANIFEST, readFile });
    expect(failures).toEqual([]);
  });

  it('every P1-15 operation is at operation depth, with nothing pending or unit-only', () => {
    const registered = scanRegisteredOperations(ROOT);
    const readFile = (rel: string) => {
      const abs = join(ROOT, rel);
      return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    };
    const { counts } = evaluateCoverage({ registered, manifest: MANIFEST, readFile });

    expect(counts.p1_15.registered).toBe(21);
    expect(counts.p1_15.publicApi).toBe(21);
    expect(counts.p1_15.operationDepth).toBe(21);
    expect(counts.p1_15.invocationOnly).toBe(0);
    expect(counts.p1_15.pending).toBe(0);
    expect(counts.p1_15.unitOnly).toBe(0);
    expect(counts.p1_15.unreferenced).toBe(0);
    expect(counts.p1_15.metadataOnly).toBe(0);
  });

  it('classifies every registered operation as public API surface, so none is hidden', () => {
    const registered = scanRegisteredOperations(ROOT);
    const readFile = (rel: string) => {
      const abs = join(ROOT, rel);
      return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    };
    const { counts, matrix } = evaluateCoverage({ registered, manifest: MANIFEST, readFile });

    expect(counts.internal).toBe(0);
    expect(counts.publicApi).toBe(counts.registered);
    // And every P1-15 row names a real method and path, so the inventory in
    // docs/phase-1/phase-1-15/operation-inventory.md can be checked against it.
    for (const row of matrix.filter((m: { id: string }) => m.id.startsWith('shared.'))) {
      expect(row.method).toMatch(/^(GET|POST|PUT|PATCH|DELETE)$/);
      expect(row.path).toMatch(/^\//);
    }
  });
});
