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
  P1_22_PREFIXES,
  P1_23_PREFIXES,
  EVIDENCE_KEY_IDEMPOTENCY,
  derivedRequirements,
  evaluateCoverage,
  isDerivedId,
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

  it('does not corrupt a template literal containing //, and still strips after it', () => {
    // Templates are the fourth context the lexer tracks, and every P1-18 suite
    // builds request URLs with one: `new Request(\`${R}/${id}/refusals\`)`. Treating
    // the backtick as ordinary text would end the string at the wrong place and
    // strip live code.
    const out = stripComments(`const u = \`http://h/api/${ID}\`; // ${ID}`);
    expect(out).toContain(`\`http://h/api/${ID}\``);
    expect(out.split('//').length).toBe(2); // only the URL's own `//` survives
  });

  it('does not end a string early at an escaped quote', () => {
    // Escape handling is what keeps the four contexts from leaking into each
    // other: mishandling `\\'` would close the string at the apostrophe and read
    // the rest of the line as code, so a real trailing comment would survive.
    const out = stripComments(`const s = 'it\\'s here'; // ${ID}`);
    expect(out).toContain("'it\\'s here'");
    expect(out).not.toContain(ID);
  });

  it('reports the earlier-phase debt rather than claiming the strict rule applies', () => {
    // The ratchet is P1-18-only on purpose, and the source says why. If this
    // assertion ever fails, the note has been removed and the bounded debt is no
    // longer named anywhere.
    //
    // The figure itself used to be asserted as a literal here — `/39 of them/`,
    // which pinned a number that was simply wrong (41, across four namespaces,
    // not 39 across three) and so guaranteed the docstring stayed wrong. The
    // count is now MEASURED in `pins the size and shape of the pre-P1-18 strict-rule
    // debt` below; this assertion only requires the docstring to state the
    // measured figure and to name all four namespaces.
    const gate = readFileSync(join(ROOT, 'scripts/check-operation-test-coverage.mjs'), 'utf8');
    expect(gate).toContain('P1-18-R-02');
    expect(gate).toMatch(/fails 41 of them/);
    for (const ns of ['`veh` 20', '`crm` 18', '`iam` 2', '`meta` 1']) {
      expect(gate).toContain(ns);
    }
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

  it('derives ONLY idempotency for an iam operation — every other P1-14 obligation stays declared', () => {
    // `idempotent: true` is a promise to the caller and creates its obligation in
    // every namespace (CSA-22): ten P1-14 operations declared it while `derived`
    // came back empty, so nothing ever exercised a replay. Everything else about
    // P1-14's evidence model is unchanged — note `versionGuarded` below derives
    // nothing here, where it would derive `stale-version` in a derived namespace.
    expect(
      derivedRequirements({ id: 'iam.demo-op', idempotent: true, versionGuarded: true })
    ).toEqual(['idempotency']);
  });

  it('derives nothing at all for an iam operation that promises no idempotency', () => {
    expect(
      derivedRequirements({
        id: 'iam.demo-op',
        versionGuarded: true,
        auditClass: 'privileged',
        scope: 'branch',
        path: '/demo/{thingId}',
      })
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

// ===========================================================================
// P1-22 (`sal.` / `wty.`): both derived hooks, each provably load-bearing
// ===========================================================================

/**
 * The P1-22 archaeology (SB7) measured this gate against the phase it was about
 * to gate and found it blind in TWO independent places:
 *
 *   1. `DERIVED_PREFIXES` did not list `sal.`/`wty.`, so `derivedRequirements()`
 *      returned `[]` for a `wty.` read — no route, no service, no authorization,
 *      no isolation — and the required floor became whatever the manifest chose
 *      to volunteer. That is the P1-20 defect verbatim.
 *   2. the `parseProvidedFlags` alternation did not accept `sal|wty`, so every
 *      declaration a P1-22 test could write parsed to NOTHING.
 *
 * The two failures compound in OPPOSITE directions, which is why "extend one and
 * the gate is half-fixed" is false. With only hook 1 blind, evidence is provided
 * but not required, and deleting the assertions keeps the gate green. With only
 * hook 2 blind, evidence is required but unprovidable, and no honest suite can
 * pass. Both, and the phase is silently ungated.
 *
 * These suites are the contract for both hooks. Each is mutation-detectable on
 * its own: remove `P1_22_PREFIXES` from `DERIVED_PREFIXES` and the derived-floor
 * assertions fail; remove `sal|wty` from the alternation and the declaration
 * assertions fail. Neither removal can hide behind the other.
 */
describe('operation coverage gate — P1-22 hook 1: the derived floor', () => {
  /** A branch-scoped, audited, idempotent billing mutation with a path parameter. */
  const salMutation = {
    id: 'sal.invoice-issue',
    module: 'billing',
    method: 'POST',
    path: '/invoices/{invoiceId}/issuance',
    scope: 'branch',
    auditClass: 'financial',
    public: false,
    idempotent: true,
    versionGuarded: false,
    surface: 'public-api',
    source: 'src/app/api/v1/invoices/[invoiceId]/issuance/route.ts',
  };
  /** A branch-scoped billing read: no audit, no replay, still a full floor. */
  const salRead = {
    ...salMutation,
    id: 'sal.invoice-read',
    method: 'GET',
    path: '/invoices/{invoiceId}',
    auditClass: 'none',
    idempotent: false,
    source: 'src/app/api/v1/invoices/[invoiceId]/route.ts',
  };
  const wtyMutation = {
    ...salMutation,
    id: 'wty.warranty-generate',
    module: 'warranty',
    path: '/deliveries/{deliveryId}/warranties',
    auditClass: 'standard',
    source: 'src/app/api/v1/deliveries/[deliveryId]/warranties/route.ts',
  };
  const wtyRead = {
    ...salRead,
    id: 'wty.warranty-read',
    module: 'warranty',
    path: '/warranties/{warrantyId}',
    source: 'src/app/api/v1/warranties/[warrantyId]/route.ts',
  };

  it('recognises both P1-22 namespaces as derived-evidence namespaces', () => {
    expect(P1_22_PREFIXES).toEqual(['sal.', 'wty.']);
    expect(isDerivedId('sal.invoice-issue')).toBe(true);
    expect(isDerivedId('wty.warranty-generate')).toBe(true);
  });

  it('did NOT silently accept a neighbouring namespace that registered nothing', () => {
    // Phase 1-11 froze `rpt` alongside `sal`/`wty`, and through P1-22 no `rpt.`
    // operation existed. Listing a prefix with nothing behind it reports a
    // vacuous 0/0 phase block that reads like passing coverage, so `rpt.` was
    // deliberately absent — it is NOT part of the P1-22 prefix set, and this
    // assertion is what keeps that true.
    expect(P1_22_PREFIXES).not.toContain('rpt.');

    // P1-23 registers the first `rpt.` operations, so the prefix is derived
    // FROM THAT PHASE — see the P1-23 suites below. The rule the original
    // assertion encoded ("no prefix without operations behind it") is intact;
    // what changed is that operations now exist.
    expect(isDerivedId('rpt.report-read')).toBe(true);
  });

  it('a sal.* READ derives its full mandatory floor, never an empty list', () => {
    const derived = derivedRequirements(salRead);
    expect(derived).not.toEqual([]);
    expect([...derived].sort()).toEqual([
      'authorization',
      'cross-tenant',
      'isolation',
      'route',
      'service',
      'success',
    ]);
  });

  it('a sal.* MUTATION additionally derives audit and replay evidence', () => {
    const derived = derivedRequirements(salMutation);
    expect([...derived].sort()).toEqual([
      'audit',
      'authorization',
      'cross-tenant',
      'idempotency',
      'isolation',
      'route',
      'service',
      'success',
    ]);
  });

  it('a wty.* READ derives its full mandatory floor, never an empty list', () => {
    const derived = derivedRequirements(wtyRead);
    expect(derived).not.toEqual([]);
    expect([...derived].sort()).toEqual([
      'authorization',
      'cross-tenant',
      'isolation',
      'route',
      'service',
      'success',
    ]);
  });

  it('a wty.* MUTATION additionally derives audit and replay evidence', () => {
    const derived = derivedRequirements(wtyMutation);
    expect(derived).toContain('audit');
    expect(derived).toContain('idempotency');
    expect([...derived].sort()).toEqual([
      'audit',
      'authorization',
      'cross-tenant',
      'idempotency',
      'isolation',
      'route',
      'service',
      'success',
    ]);
  });

  it('an idempotent billing/payment operation derives replay evidence', () => {
    // The obligation is created by the flag, not by the manifest: a payment that
    // promises the caller a safe retry owes the proof. CSA-22 is what the absence
    // of this rule looked like — ten operations declared it and nothing replayed.
    const payment = { ...salMutation, id: 'sal.payment-record', path: '/payments' };
    expect(derivedRequirements(payment)).toContain('idempotency');
    expect(derivedRequirements({ ...payment, idempotent: false })).not.toContain('idempotency');
  });

  it('a branch-scoped operation derives isolation evidence, and a tenant-scoped one does not', () => {
    expect(derivedRequirements(salRead)).toContain('isolation');
    expect(derivedRequirements({ ...salRead, scope: 'company' })).toContain('isolation');
    expect(derivedRequirements({ ...salRead, scope: 'tenant' })).not.toContain('isolation');
  });

  it('a version-guarded P1-22 operation derives concurrency (stale-version) evidence', () => {
    expect(derivedRequirements({ ...salMutation, versionGuarded: true })).toContain(
      'stale-version'
    );
  });
});

describe('operation coverage gate — P1-22 hook 2: declarations are readable', () => {
  const block = [
    '/**',
    ' * COVERAGE-EVIDENCE (P1-22):',
    ' *   sal.invoice-issue: route service authorization success audit outbox isolation',
    ' *   wty.warranty-generate: route service authorization success audit isolation',
    ' */',
  ].join('\n');

  it('parses a sal.* declaration', () => {
    const flags = parseProvidedFlags(block).get('sal.invoice-issue');
    expect(flags).toBeDefined();
    expect([...(flags ?? [])].sort()).toEqual([
      'audit',
      'authorization',
      'isolation',
      'outbox',
      'route',
      'service',
      'success',
    ]);
  });

  it('parses a wty.* declaration', () => {
    const flags = parseProvidedFlags(block).get('wty.warranty-generate');
    expect(flags).toBeDefined();
    expect([...(flags ?? [])].sort()).toEqual([
      'audit',
      'authorization',
      'isolation',
      'route',
      'service',
      'success',
    ]);
  });

  it('still refuses a namespace that is not registered in the alternation', () => {
    // The alternation is explicit rather than a wildcard precisely so a typo is a
    // missing flag (which fails) instead of a silently accepted new namespace.
    const typo = block.replace('sal.invoice-issue', 'sale.invoice-issue');
    expect(parseProvidedFlags(typo).has('sale.invoice-issue')).toBe(false);
  });
});

describe('operation coverage gate — P1-22 end to end: deleting evidence FAILS', () => {
  const FILE = 'tests/backend/p1-22-demo.test.ts';
  const OP = {
    id: 'sal.invoice-issue',
    module: 'billing',
    method: 'POST',
    path: '/invoices/{invoiceId}/issuance',
    scope: 'branch',
    auditClass: 'financial',
    public: false,
    idempotent: true,
    versionGuarded: false,
    surface: 'public-api',
    source: 'src/app/api/v1/invoices/[invoiceId]/issuance/route.ts',
  };

  /**
   * A synthetic suite. The operation id is referenced in a `describe` title —
   * i.e. in executable code — because P1-22 is governed by the strict comment
   * ratchet and a prose mention would not count.
   *
   * The leading `/**` matters and was earned. Written without it, the header is
   * not a comment at all: `stripComments` is a lexical scanner, so with no opener
   * it treats those lines as code, the id "appears in executable code" for free,
   * and the ratchet this suite claims to exercise is never engaged. The
   * declaration still parses (that path is line-based, so it never noticed), which
   * is what made the omission invisible — three of these cases passed for a reason
   * that had nothing to do with what they assert.
   */
  const fileWith = (flags: readonly string[]): string => `/**
 * COVERAGE-EVIDENCE (P1-22):
 *   sal.invoice-issue: ${flags.join(' ')}
 */
describe('sal.invoice-issue', () => { it('issues once', () => {}); });
`;

  const FULL = [
    'route',
    'service',
    'authorization',
    'success',
    'cross-tenant',
    'isolation',
    'audit',
    'idempotency',
  ];

  const run = (flags: readonly string[], operation: Record<string, unknown> = OP) =>
    evaluateCoverage({
      registered: new Map([[OP.id, operation]]),
      manifest: { [OP.id]: { files: [FILE], required: ['outbox'] } },
      readFile: (p: string) => (p === FILE ? fileWith(flags) : null),
    });

  it('PASSES with the complete derived floor plus the declared outbox obligation', () => {
    expect(run([...FULL, 'outbox']).failures).toEqual([]);
  });

  it('reports the operation in the P1-22 phase block at operation depth', () => {
    const { counts } = run([...FULL, 'outbox']);
    expect(counts.p1_22).toEqual({
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

  // Each kind is deleted individually: a floor that fails only when everything
  // is missing at once is not a floor.
  for (const kind of [
    'route',
    'service',
    'authorization',
    'success',
    'cross-tenant',
    'isolation',
    'audit',
    'idempotency',
    'outbox',
  ]) {
    it(`FAILS when ${kind} evidence is deleted`, () => {
      const remaining = [...FULL, 'outbox'].filter((f) => f !== kind);
      const { failures } = run(remaining);
      expect(failures.length).toBeGreaterThan(0);
      expect(failures.some((f: string) => f.includes(kind))).toBe(true);
    });
  }

  it('FAILS as metadata-only when neither route nor service is declared', () => {
    // Vacuous unless `sal.` is in the structural opt-in list: without it
    // `metadataOnly` is computed as false for every row and the phase would
    // report `metadata-only 0` because nothing was measured.
    const { failures, counts } = run(['authorization', 'success']);
    expect(failures.some((f: string) => f.includes('metadata-only'))).toBe(true);
    expect(counts.p1_22.metadataOnly).toBe(1);
  });

  it('FAILS as unit-only when the only evidence is a pure-unit suite', () => {
    const unitFile = 'tests/foundation/p1-22-demo.test.ts';
    const { failures, counts } = evaluateCoverage({
      registered: new Map([[OP.id, OP]]),
      manifest: { [OP.id]: { files: [unitFile], required: [] } },
      readFile: (p: string) => (p === unitFile ? fileWith(FULL) : null),
    });
    expect(failures.some((f: string) => f.includes('unit-only'))).toBe(true);
    expect(counts.p1_22.unitOnly).toBe(1);
  });

  it('FAILS under the strict ratchet when the id appears only in prose', () => {
    // P1-22 is opted into the P1-18 comment ratchet, so an "Operations exercised
    // here" header cannot stand in for a test.
    const prose = `/**
 * Operations exercised here: sal.invoice-issue
 *
 * COVERAGE-EVIDENCE (P1-22):
 *   sal.invoice-issue: ${[...FULL, 'outbox'].join(' ')}
 */
describe('something else entirely', () => {});
`;
    const { failures } = evaluateCoverage({
      registered: new Map([[OP.id, OP]]),
      manifest: { [OP.id]: { files: [FILE], required: [] } },
      readFile: (p: string) => (p === FILE ? prose : null),
    });
    expect(failures.some((f: string) => f.includes('does not reference'))).toBe(true);
  });

  it('FAILS when a P1-22 operation is registered outside a route file with no reason', () => {
    const { failures } = run([...FULL, 'outbox'], { ...OP, surface: 'internal' });
    expect(failures.some((f: string) => f.includes('internalReason'))).toBe(true);
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

    // 21 from P1-15 plus the 3 P1-23 reads that share the `shared.` namespace.
    // The counter selects by prefix, so it cannot separate the phases; what it
    // still proves exactly is that every operation in the namespace is at
    // operation depth, with none pending, unit-only or metadata-only.
    expect(counts.p1_15.registered).toBe(24);
    expect(counts.p1_15.publicApi).toBe(24);
    expect(counts.p1_15.operationDepth).toBe(24);
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

  it('pins the size and shape of the pre-P1-18 strict-rule debt', () => {
    // The ratchet's own docstring quantifies what applying the strict rule to
    // every namespace would cost, and `P1-18-R-02` repeats the figure. A number
    // written in prose drifts: an earlier revision said "39 across P1-16, P1-17
    // and IAM", which was wrong in both the count and the namespace list — it
    // omitted `meta` entirely. Measuring it here means the claim is computed
    // from the shipped MANIFEST and the shipped lexer rather than remembered.
    //
    // This does NOT weaken the strict rule; it only measures the debt the rule
    // is deliberately not applied to yet. P1-18 stays strict either way.
    const failing: string[] = [];
    for (const [id, entry] of Object.entries(MANIFEST) as [string, { files?: string[] }][]) {
      if (id.startsWith('apt.') || id.startsWith('rec.')) continue;
      const files = entry.files ?? [];
      let referenced = files.length > 0;
      for (const file of files) {
        const abs = join(ROOT, file);
        if (!existsSync(abs) || !stripComments(readFileSync(abs, 'utf8')).includes(id)) {
          referenced = false;
          break;
        }
      }
      if (!referenced) failing.push(id);
    }

    const byNamespace = new Map<string, number>();
    for (const id of failing) {
      const ns = id.split('.')[0] ?? '';
      byNamespace.set(ns, (byNamespace.get(ns) ?? 0) + 1);
    }

    expect(failing).toHaveLength(41);
    expect([...byNamespace.keys()].sort()).toEqual(['crm', 'iam', 'meta', 'veh']);
    expect(Object.fromEntries([...byNamespace].sort())).toEqual({
      crm: 18,
      iam: 2,
      meta: 1,
      veh: 20,
    });
  });
});

/**
 * P1-23 — Documents, Notifications and Reporting Backend.
 *
 * P1-23 is the first phase to span a namespace it does NOT introduce and one it
 * does. Its document, file, template and notification operations live in
 * `shared.`, derived since P1-14; its reporting operations live in `rpt.`,
 * which Phase 1-11 froze as a schema and against which no phase had registered
 * an operation until now.
 *
 * That asymmetry is the trap these suites exist for. `shared.` needs no new
 * hook, and adding one would double-count it. `rpt.` needs BOTH hooks — the
 * derived-prefix list and the `parseProvidedFlags` alternation — for the reason
 * P1-20 and P1-22 each paid for once: with only hook 1 blind, evidence is
 * provided but never required, so deleting every assertion keeps the gate
 * green; with only hook 2 blind, evidence is required but no declaration can
 * express it, so no honest suite can pass. Each suite below fails on its own
 * mutation, so neither removal can hide behind the other.
 */
describe('operation coverage gate — P1-23 hook 1: the derived floor', () => {
  /** A branch-scoped, audited, idempotent export mutation. */
  const rptExport = {
    id: 'rpt.export-request',
    module: 'reporting',
    method: 'POST',
    path: '/reports/{reportCode}/exports',
    scope: 'branch',
    auditClass: 'standard',
    public: false,
    idempotent: true,
    versionGuarded: false,
    surface: 'public-api',
    source: 'src/app/api/v1/reports/[reportCode]/exports/route.ts',
  };
  /** A branch-scoped report read: no audit, no replay, still a full floor. */
  const rptRead = {
    ...rptExport,
    id: 'rpt.report-read',
    method: 'GET',
    path: '/reports/{reportCode}',
    auditClass: 'none',
    idempotent: false,
    source: 'src/app/api/v1/reports/[reportCode]/route.ts',
  };
  /** A shared-namespace document read — derived since P1-14, re-asserted here. */
  const docRead = {
    ...rptRead,
    id: 'shared.document-read',
    module: 'shared-services',
    path: '/attachments/documents/{documentId}',
    source: 'src/app/api/v1/attachments/documents/[documentId]/route.ts',
  };
  /** A shared-namespace in-app notification read. */
  const notificationRead = {
    ...docRead,
    id: 'shared.notification-list',
    path: '/notifications',
    source: 'src/app/api/v1/notifications/route.ts',
  };
  /** A shared-namespace notification mutation. */
  const notificationMutation = {
    ...rptExport,
    id: 'shared.notification-retry-request',
    module: 'shared-services',
    path: '/notifications/{notificationId}/retry-requests',
    source: 'src/app/api/v1/notifications/[notificationId]/retry-requests/route.ts',
  };
  /** A shared-namespace document mutation. */
  const documentMutation = {
    ...rptExport,
    id: 'shared.document-retention-evaluate',
    module: 'shared-services',
    path: '/attachments/documents/retention-evaluations',
    source: 'src/app/api/v1/attachments/documents/retention-evaluations/route.ts',
  };

  it('recognises the P1-23 reporting namespace as a derived-evidence namespace', () => {
    expect(P1_23_PREFIXES).toEqual(['rpt.']);
    expect(isDerivedId('rpt.report-read')).toBe(true);
    expect(isDerivedId('rpt.export-request')).toBe(true);
  });

  it('reuses `shared.` rather than re-declaring it, so the namespace is not double-counted', () => {
    expect(isDerivedId('shared.document-read')).toBe(true);
    expect(P1_23_PREFIXES).not.toContain('shared.');
  });

  it.each([
    ['report read', rptRead],
    ['export mutation', rptExport],
    ['document read', docRead],
    ['document mutation', documentMutation],
    ['notification read', notificationRead],
    ['notification mutation', notificationMutation],
  ])('a P1-23 %s derives a non-empty mandatory floor', (_label, operation) => {
    const derived = derivedRequirements(operation);
    // The whole point: never `[]`. An empty floor credits an operation at depth
    // on evidence that was never required.
    expect(derived).not.toEqual([]);
    expect(derived).toContain('route');
    expect(derived).toContain('service');
    expect(derived).toContain('authorization');
  });

  it('derives replay evidence for an idempotent P1-23 mutation and not for a read', () => {
    expect(derivedRequirements(rptExport)).toContain(EVIDENCE_KEY_IDEMPOTENCY);
    expect(derivedRequirements(rptRead)).not.toContain(EVIDENCE_KEY_IDEMPOTENCY);
  });

  it('derives audit evidence for an audited P1-23 mutation and not for an unaudited read', () => {
    expect(derivedRequirements(rptExport)).toContain('audit');
    expect(derivedRequirements(rptRead)).not.toContain('audit');
  });

  it('derives isolation evidence for every branch-scoped P1-23 operation', () => {
    for (const operation of [rptRead, rptExport, docRead, notificationRead]) {
      expect(derivedRequirements(operation)).toContain('isolation');
    }
  });
});

describe('operation coverage gate — P1-23 hook 2: declarations are parseable', () => {
  const block = (line: string) => ['/**', ' * COVERAGE-EVIDENCE', ` * ${line}`, ' */'].join('\n');

  it.each(['rpt.report-read', 'rpt.export-request'])(
    'parses an `rpt.` declaration for %s',
    (id) => {
      const parsed = parseProvidedFlags(block(`${id}: route service authorization`));
      // Before `rpt` joined the alternation this parsed to NOTHING, so no
      // declaration a test could write could satisfy any obligation.
      expect(parsed.size).toBe(1);
      expect([...parsed.keys()][0]).toBe(id);
    }
  );

  it('still parses the `shared.` declarations P1-23 also relies on', () => {
    const parsed = parseProvidedFlags(block('shared.document-read: route service authorization'));
    expect(parsed.size).toBe(1);
    expect([...parsed.keys()][0]).toBe('shared.document-read');
  });

  it('does not accept an unregistered namespace', () => {
    // The alternation is an allowlist, not a wildcard: a namespace nobody has
    // opted in must not silently start parsing.
    expect(parseProvidedFlags(block('bogus.thing-read: route service')).size).toBe(0);
  });
});
