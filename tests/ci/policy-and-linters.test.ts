/**
 * Tests for the linters and policies that decide whether a change is safe.
 *
 * Each of these was written because the audit found something the pipeline could
 * not see. The tests below assert the DETECTION, not the current state of the
 * repository — a linter that only passes because the repository happens to be
 * clean would keep passing after the repository stopped being clean.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  lintWorkflow,
  extractRunBlocks,
  isLocalReference,
} from '../../scripts/ci/check-workflow-security.mjs';
import {
  lintTestFile,
  lintVitestConfig,
  lintScript,
  stripComments,
} from '../../scripts/ci/check-test-honesty.mjs';
import { evaluate as evaluateContainer } from '../../scripts/ci/container-policy.mjs';
import {
  evaluate as evaluateDependencies,
  PROHIBITED_PACKAGES,
} from '../../scripts/ci/dependency-policy.mjs';
import {
  checkFilenames,
  checkNoDeveloperData,
  stripSqlBodies,
} from '../../scripts/ci/migration-replay-checks.mjs';
import {
  compare as compareRoutes,
  discoverImports,
} from '../../scripts/ci/check-route-registry-parity.mjs';
import { classify as classifySecret, isAllowed } from '../../scripts/ci/scan-history.mjs';

const rules = (findings: Array<{ rule: string }>) => findings.map((f) => f.rule);

const MINIMAL_WORKFLOW = `name: X
on: push
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - run: |
          set -euo pipefail
          echo hello
`;

describe('workflow security linter', () => {
  it('accepts a workflow that follows every rule', () => {
    expect(lintWorkflow('ok.yml', MINIMAL_WORKFLOW)).toEqual([]);
  });

  it('WFS-001 catches an action pinned to a mutable tag', () => {
    const source = MINIMAL_WORKFLOW.replace(
      'actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0',
      'actions/checkout@v4'
    );
    expect(rules(lintWorkflow('x.yml', source))).toContain('WFS-001');
  });

  it('WFS-002 catches a SHA pin with no version comment', () => {
    const source = MINIMAL_WORKFLOW.replace(' # v4.4.0', '');
    expect(rules(lintWorkflow('x.yml', source))).toContain('WFS-002');
  });

  it('does not demand a SHA pin for a workflow-local action', () => {
    expect(isLocalReference('./.github/actions/setup-project')).toBe(true);
    expect(isLocalReference('actions/checkout@v4')).toBe(false);
  });

  it('WFS-003 catches a workflow with no permissions block', () => {
    const source = MINIMAL_WORKFLOW.replace('permissions:\n  contents: read\n', '');
    expect(rules(lintWorkflow('x.yml', source))).toContain('WFS-003');
  });

  it('WFS-004 catches write scope granted at workflow level', () => {
    const source = MINIMAL_WORKFLOW.replace('  contents: read', '  contents: write');
    expect(rules(lintWorkflow('x.yml', source))).toContain('WFS-004');
  });

  it('WFS-005 catches pull_request_target, at critical severity', () => {
    const source = MINIMAL_WORKFLOW.replace('on: push', 'on:\n  pull_request_target:');
    const findings = lintWorkflow('x.yml', source);
    expect(rules(findings)).toContain('WFS-005');
    expect(findings.find((f: { rule: string }) => f.rule === 'WFS-005').severity).toBe('critical');
  });

  it('WFS-006 catches an attacker-controlled value interpolated into a shell block', () => {
    const source = MINIMAL_WORKFLOW.replace(
      '          echo hello',
      '          echo "${{ github.event.pull_request.title }}"'
    );
    const findings = lintWorkflow('x.yml', source);
    expect(rules(findings)).toContain('WFS-006');
    expect(findings.find((f: { rule: string }) => f.rule === 'WFS-006').severity).toBe('critical');
  });

  it('WFS-007 catches a multi-line run block that does not fail fast', () => {
    const source = MINIMAL_WORKFLOW.replace('          set -euo pipefail\n', '');
    expect(rules(lintWorkflow('x.yml', source))).toContain('WFS-007');
  });

  it('WFS-008 catches a swallowed exit status', () => {
    const source = MINIMAL_WORKFLOW.replace('          echo hello', '          npm test || true');
    expect(rules(lintWorkflow('x.yml', source))).toContain('WFS-008');
  });

  it('WFS-009 catches continue-on-error, and accepts a reasoned suppression above it', () => {
    // Realistic shape: `continue-on-error` is a key on a step, not a list item.
    const bad = MINIMAL_WORKFLOW.replace(
      '      - uses: actions/checkout',
      '      - continue-on-error: true\n        uses: actions/checkout'
    );
    expect(rules(lintWorkflow('x.yml', bad))).toContain('WFS-009');

    const suppressed = MINIMAL_WORKFLOW.replace(
      '      - uses: actions/checkout',
      '      # workflow-security-allow: WFS-009 -- reason recorded here\n      - continue-on-error: true\n        uses: actions/checkout'
    );
    expect(rules(lintWorkflow('x.yml', suppressed))).not.toContain('WFS-009');
  });

  it('WFS-010 catches a job with no timeout', () => {
    const source = MINIMAL_WORKFLOW.replace('    timeout-minutes: 5\n', '');
    expect(rules(lintWorkflow('x.yml', source))).toContain('WFS-010');
  });

  it('WFS-011 catches a reusable workflow with more than one job', () => {
    // The defect that made the first hosted run fail at STARTUP. A caller's
    // permissions are the ceiling for every job in the file it calls, including
    // ones an `if:` would skip — so a file holding a `security-events: write`
    // job cannot be called by anyone who does not grant it.
    const reusable = `name: R
on:
  workflow_call:
    inputs:
      task:
        required: true
        type: string
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: |
          set -euo pipefail
          echo a
  b:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      security-events: write
    steps:
      - run: |
          set -euo pipefail
          echo b
`;
    const findings = lintWorkflow('_reusable-x.yml', reusable);
    expect(rules(findings)).toContain('WFS-011');
    expect(findings.find((f: { rule: string }) => f.rule === 'WFS-011').severity).toBe('critical');

    // One job is fine, and a NON-reusable workflow may of course have many.
    const single = reusable.slice(0, reusable.indexOf('  b:'));
    expect(rules(lintWorkflow('_reusable-x.yml', single))).not.toContain('WFS-011');
    const notReusable = reusable.replace('on:\n  workflow_call:', 'on:\n  push:');
    expect(rules(lintWorkflow('pr-ci.yml', notReusable))).not.toContain('WFS-011');
  });

  it('WFS-012 catches a bootstrap sparse checkout that disables cone mode', () => {
    // The second hosted failure. `git sparse-checkout disable` — which is what
    // actions/checkout runs when given no sparse input — is a NO-OP against a
    // non-cone repository. The workspace stays at one file, and the error
    // surfaces three steps later as "Dependencies lock file is not found".
    const bootstrap = (coneLine: string) => `name: W
on:
  push:
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          sparse-checkout: .github/actions
${coneLine}          fetch-depth: 1
      - uses: ./.github/actions/setup-project
`;
    const findings = lintWorkflow(
      'pr-ci.yml',
      bootstrap('          sparse-checkout-cone-mode: false\n')
    );
    expect(rules(findings)).toContain('WFS-012');
    expect(findings.find((f: { rule: string }) => f.rule === 'WFS-012').severity).toBe('critical');

    // Cone mode — the default — is the fixed form and must stay silent.
    expect(rules(lintWorkflow('pr-ci.yml', bootstrap('')))).not.toContain('WFS-012');

    // Non-cone is legitimate for a checkout that is NOT the action bootstrap:
    // nothing later depends on that workspace being complete.
    const unrelated = `name: W
on:
  push:
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
        with:
          sparse-checkout: docs/**
          sparse-checkout-cone-mode: false
`;
    expect(rules(lintWorkflow('pr-ci.yml', unrelated))).not.toContain('WFS-012');
  });

  it('WFS-013 catches a Trivy scanner list that omits `vuln`', () => {
    // Dropping `vuln` disables vulnerability detection while leaving the report
    // looking healthy: package enumeration is done by the ARTIFACT ANALYZERS, so
    // `--scanners misconfig` alone still reports the same packages with zero
    // findings. Measured on node:22-alpine — `vuln,secret,misconfig` gives 216
    // packages / 14 findings; `misconfig` alone gives 216 packages / 0 findings,
    // a byte-identical document. Nothing downstream can tell the difference,
    // because the report carries no record of which scanners ran.
    const workflow = (scanners: string) => `name: C
on:
  push:
permissions:
  contents: read
jobs:
  c:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0
        with:
          image-ref: app:ci
          format: json
          scanners: ${scanners}
`;
    const findings = lintWorkflow('_reusable-container.yml', workflow('secret,misconfig'));
    expect(rules(findings)).toContain('WFS-013');
    expect(findings.find((f: { rule: string }) => f.rule === 'WFS-013').severity).toBe('critical');

    // The shipped form, and a quoted variant, must both stay silent.
    expect(rules(lintWorkflow('x.yml', workflow('vuln,secret,misconfig')))).not.toContain(
      'WFS-013'
    );
    expect(rules(lintWorkflow('x.yml', workflow("'vuln,secret'")))).not.toContain('WFS-013');

    // `scanners:` on some OTHER action is not Trivy's and must not be flagged.
    const other = `name: C
on:
  push:
permissions:
  contents: read
jobs:
  c:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: some/other-action@11d5960a326750d5838078e36cf38b85af677262 # v1.0.0
        with:
          scanners: secret
`;
    expect(rules(lintWorkflow('x.yml', other))).not.toContain('WFS-013');
  });

  it('WFS-014 catches an apostrophe inside a single-quoted inline script', () => {
    // This killed a hosted run. `node -e '…'` is a single-quoted SHELL string,
    // so an apostrophe in a JavaScript comment closes the quote and the step
    // dies with exit 126 — a status that names nothing. `actionlint` does not
    // see it, because the YAML is valid.
    const apostrophe = String.fromCharCode(39);
    const script = (comment: string) => `name: X
on: push
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: |
          set -euo pipefail
          node -e '
${comment}            const x = 1;
            console.log(x);
          '
`;
    const bad = script(`            // done by Trivy${apostrophe}s analyzers\n`);
    const findings = lintWorkflow('x.yml', bad);
    expect(rules(findings)).toContain('WFS-014');
    expect(findings.find((f: { rule: string }) => f.rule === 'WFS-014').severity).toBe('high');

    // The same script without the apostrophe is fine.
    expect(rules(lintWorkflow('x.yml', script('')))).not.toContain('WFS-014');

    // The block must CLOSE on `' "$args"`, or every later line is flagged. This
    // is the real shape used throughout the repository, and getting it wrong
    // made the rule fire on eight innocent lines the first time.
    const closesWithArgs = `name: X
on: push
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - run: |
          set -euo pipefail
          node -e '
            console.log(process.argv[1]);
          ' "\${VALUE}"
          echo "it${apostrophe}s fine out here"
`;
    expect(rules(lintWorkflow('x.yml', closesWithArgs))).not.toContain('WFS-014');
  });

  it('extracts a run block by indentation, not by guessing where it ends', () => {
    const blocks = extractRunBlocks(MINIMAL_WORKFLOW.split('\n'));
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.multiline).toBe(true);
    expect(blocks[0]?.body).toContain('echo hello');
  });
});

describe('test honesty', () => {
  /**
   * Every fixture below is ASSEMBLED AT RUNTIME rather than written as a
   * literal, and that is not a stylistic choice.
   *
   * This file tests a scanner that searches every tracked test file for `.only`,
   * undocumented `.skip`, and vacuous assertions. Written literally, those
   * fixtures would make the scanner match its own test suite and fail every run
   * — the identical trap `scripts/check-browser-exposed-secrets.mjs` was
   * rewritten in Node to escape, and the reason `shared-processed-errors.test.ts`
   * builds its AWS prefix with `String.fromCharCode`.
   *
   * The alternative — excluding this path from the scan — would leave a hole in
   * the one file most likely to contain the patterns. Assembling keeps the whole
   * repository in scope.
   */
  const ONLY = `.${'on'}${'ly'}`;
  const SKIP = `.${'sk'}${'ip'}`;
  const EXPECT = `exp${'ect'}`;
  const vacuous = (inner: string) => `${EXPECT}(${inner})`;

  const OK = `import { describe, it, expect } from 'vitest';
describe('x', () => {
  it('asserts something real', () => {
    ${EXPECT}(compute(2)).toBe(4);
  });
});
`;

  it('accepts an honest test file', () => {
    expect(lintTestFile('tests/x.test.ts', OK)).toEqual([]);
  });

  it('TH-001 catches .only', () => {
    expect(rules(lintTestFile('tests/x.test.ts', OK.replace('it(', `it${ONLY}(`)))).toContain(
      'TH-001'
    );
  });

  it('TH-002 catches an undocumented .skip, and accepts a documented one', () => {
    expect(rules(lintTestFile('tests/x.test.ts', OK.replace('it(', `it${SKIP}(`)))).toContain(
      'TH-002'
    );
    const documented = OK.replace(
      '  it(',
      `  // test-honesty-allow: TH-002 -- upstream driver bug, tracked in ISSUE-1\n  it${SKIP}(`
    );
    expect(rules(lintTestFile('tests/x.test.ts', documented))).not.toContain('TH-002');
  });

  it('TH-003 catches a test file with no test', () => {
    expect(rules(lintTestFile('tests/x.test.ts', 'const a = 1;\n'))).toContain('TH-003');
  });

  it('TH-004 catches a test file with tests but no assertion', () => {
    const noAssertion = `describe('x', () => { it('does nothing', () => { const a = 1; }); });`;
    expect(rules(lintTestFile('tests/x.test.ts', noAssertion))).toContain('TH-004');
  });

  it('TH-005 catches vacuous assertions in every shape the codebase used', () => {
    for (const assertion of [
      `${vacuous('true')}.toBe(true)`,
      `${vacuous('false')}.toBe(false)`,
      `${vacuous('1')}.toBe(1)`,
      `${vacuous("'a'")}.toBe('a')`,
      `${EXPECT}.assertions(0)`,
    ]) {
      const source = OK.replace(`${EXPECT}(compute(2)).toBe(4);`, `${assertion};`);
      expect(rules(lintTestFile('tests/x.test.ts', source)), assertion).toContain('TH-005');
    }
  });

  it('a comment cannot satisfy a structural requirement', () => {
    expect(stripComments(`// ${vacuous('true')}.toBe(true)\nconst a = 1;`)).not.toContain(EXPECT);
    const commentedOnly = `describe('x', () => { it('a', () => { /* ${EXPECT}(x).toBe(1) */ }); });`;
    expect(rules(lintTestFile('tests/x.test.ts', commentedOnly))).toContain('TH-004');
  });

  it('TH-008 catches an isolation claim made against an identifier that never existed', () => {
    const bogus = `import { randomUUID } from 'node:crypto';
describe('tenant isolation', () => {
  it('returns nothing for another tenant', async () => {
    const other = randomUUID();
    expect(await read(other)).toEqual([]);
  });
});`;
    expect(rules(lintTestFile('tests/db/tenant-isolation.test.ts', bogus))).toContain('TH-008');
  });

  it('TH-008 accepts an isolation test that creates a real row first', () => {
    const real = `import { randomUUID } from 'node:crypto';
describe('tenant isolation', () => {
  it('returns nothing for another tenant', async () => {
    const other = randomUUID();
    await client.query('INSERT INTO crm.partners (tenant_id) VALUES ($1)', [other]);
    expect(await read(other)).toEqual([]);
  });
});`;
    expect(rules(lintTestFile('tests/db/tenant-isolation.test.ts', real))).not.toContain('TH-008');
  });

  it('TH-006 catches a runner-level retry that would hide a deterministic failure', () => {
    expect(
      rules(lintVitestConfig('vitest.config.ts', 'export default { test: { retry: 2 } };'))
    ).toContain('TH-006');
    expect(
      rules(lintVitestConfig('vitest.config.ts', 'export default { test: { retry: 0 } };'))
    ).not.toContain('TH-006');
  });

  it('TH-007 requires database-bound projects to stay serial', () => {
    expect(
      rules(lintVitestConfig('vitest.config.db.ts', 'export default { test: {} };'))
    ).toContain('TH-007');
    expect(
      rules(
        lintVitestConfig(
          'vitest.config.db.ts',
          'export default { test: { fileParallelism: false } };'
        )
      )
    ).not.toContain('TH-007');
  });

  it('TH-009 catches a script that discards a failure', () => {
    expect(rules(lintScript('scripts/x.sh', 'npm test || true\n'))).toContain('TH-009');
    expect(rules(lintScript('scripts/x.sh', 'set +e\n'))).toContain('TH-009');
    expect(rules(lintScript('scripts/x.sh', 'npm test; exit 0\n'))).toContain('TH-009');
    expect(rules(lintScript('scripts/x.sh', 'set -euo pipefail\nnpm test\n'))).toEqual([]);
  });
});

describe('container policy', () => {
  const report = (vulns: unknown[], secrets: unknown[] = []) => ({
    Results: [
      { Target: 'rootlco/web:ci-runner (alpine)', Vulnerabilities: vulns, Secrets: secrets },
    ],
  });

  it('blocks a fixable HIGH', () => {
    const result = evaluateContainer(
      report([
        {
          VulnerabilityID: 'CVE-1',
          PkgName: 'p',
          InstalledVersion: '1',
          FixedVersion: '2',
          Severity: 'HIGH',
        },
      ]),
      ['CRITICAL', 'HIGH']
    );
    expect(result.ok).toBe(false);
    expect(result.counts.fixable).toBe(1);
  });

  it('reports but does not block an unfixable HIGH, because the action is a base-image change', () => {
    const result = evaluateContainer(
      report([{ VulnerabilityID: 'CVE-2', PkgName: 'p', InstalledVersion: '1', Severity: 'HIGH' }]),
      ['CRITICAL', 'HIGH']
    );
    expect(result.ok).toBe(true);
    expect(result.counts.unfixable).toBe(1);
  });

  it('ignores a severity below the blocking set', () => {
    const result = evaluateContainer(
      report([
        {
          VulnerabilityID: 'CVE-3',
          PkgName: 'p',
          InstalledVersion: '1',
          FixedVersion: '2',
          Severity: 'LOW',
        },
      ]),
      ['CRITICAL', 'HIGH']
    );
    expect(result.ok).toBe(true);
  });

  it('ALWAYS blocks a secret in a layer, whatever its severity or fixability', () => {
    const result = evaluateContainer(report([], [{ RuleID: 'aws-access-key', Severity: 'LOW' }]), [
      'CRITICAL',
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/aws-access-key/);
  });

  it('never carries the matched secret text into the result', () => {
    const result = evaluateContainer(
      report([], [{ RuleID: 'r', Match: 'SUPER_SECRET_VALUE', Severity: 'HIGH' }]),
      ['HIGH']
    );
    expect(JSON.stringify(result)).not.toContain('SUPER_SECRET_VALUE');
  });
});

describe('dependency policy', () => {
  const advisory = (name: string, ghsa: string) => ({
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    vulnerabilities: {
      [name]: {
        severity: 'high',
        // `isDirect: false` — a waiver granted for a transitive development
        // tool does not cover a direct dependency, and the gate says so.
        isDirect: false,
        range: '<1.0.0',
        nodes: [`node_modules/${name}`],
        fixAvailable: { name, version: '2.0.0', isSemVerMajor: true },
        via: [
          {
            source: 1,
            name,
            title: 't',
            url: `https://github.com/advisories/${ghsa}`,
            severity: 'high',
            range: '<1.0.0',
          },
        ],
      },
    },
  });

  /**
   * A COMPLETE exception, in the shape the gate now demands.
   *
   * The gate requires one advisory, one package, one affected range, one
   * dependency-path fingerprint, evidenced reachability, and every field a
   * reviewer would need. Building it here once keeps each test focused on the
   * single thing it is mutating.
   */
  const completeException = (overrides: Record<string, unknown> = {}) => ({
    id: 'GHSA-dddd-eeee-ffff',
    package: 'eslint',
    severity: 'high',
    affectedRange: '<1.0.0',
    patchedVersion: '2.0.0',
    dependencyNodes: ['node_modules/eslint'],
    environment: 'development tooling only',
    productionReachable: false,
    productionReachableEvidence: 'npm ls --omit=dev reports it absent',
    finalContainerReachable: false,
    finalContainerReachableEvidence: 'absent from the built image inventory',
    exploitability: 'not reachable based on current evidence',
    reasonUpgradeCannotBeApplied: 'no consumable fix',
    attemptedRemediation: 'override to the patched release',
    attemptedRemediationResult: 'broke the parent tool',
    compensatingControls: ['repository-controlled patterns only'],
    owner: 'platform-owner',
    createdOn: '2026-07-28',
    reviewBy: '2099-01-01',
    expiresOn: '2099-06-01',
    removalCondition: 'the parent chain accepts a patched version',
    evidenceLinks: ['docs/engineering/ci-automation/security-model.md'],
    // "Complete" now includes the risk having actually been ACCEPTED. An
    // exception suppresses a blocking advisory, so an unapproved one waives
    // nothing — approval is a control rather than a note, and this fixture has
    // to satisfy it like any real entry.
    approvalStatus: 'approved',
    approvedBy: 'platform-owner',
    approvedOn: '2026-07-28',
    ...overrides,
  });

  const proofs = {
    eslint: {
      package: 'eslint',
      productionReachable: false,
      inRunnerImage: false,
      directImports: [],
      instances: [{ path: 'node_modules/eslint', version: '0.9.0', devOnly: true }],
    },
  };

  it('never waives a production advisory, even with a matching exception', () => {
    const result = evaluateDependencies({
      prodAudit: advisory('next', 'GHSA-aaaa-bbbb-cccc'),
      devAudit: { vulnerabilities: {} },
      exceptions: {
        developmentAdvisories: [
          { id: 'GHSA-aaaa-bbbb-cccc', reason: 'r', owner: 'o', reviewBy: '2099-01-01' },
        ],
      },
      licences: [],
      installedPackages: new Set(),
      today: '2026-07-28',
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/never waived/);
  });

  it('waives a development advisory with an unexpired, complete, evidenced exception', () => {
    const result = evaluateDependencies({
      prodAudit: { vulnerabilities: {} },
      devAudit: advisory('eslint', 'GHSA-dddd-eeee-ffff'),
      exceptions: { developmentAdvisories: [completeException()] },
      licences: [],
      installedPackages: new Set(),
      today: '2026-07-28',
      proofs,
    });
    expect(result.failures, result.failures.join('\n')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.development.waived).toBe(1);
  });

  it('waives nothing until the risk has actually been ACCEPTED', () => {
    // Approval used to be documentation: an entry marked
    // `pending-owner-approval` suppressed advisories exactly as an approved one
    // did, so the owner's decision changed nothing at all.
    for (const status of ['pending-owner-approval', 'rejected', undefined]) {
      const result = evaluateDependencies({
        prodAudit: { vulnerabilities: {} },
        devAudit: advisory('eslint', 'GHSA-dddd-eeee-ffff'),
        exceptions: {
          developmentAdvisories: [completeException({ approvalStatus: status })],
        },
        licences: [],
        installedPackages: new Set(),
        today: '2026-07-28',
        proofs,
      });
      expect(result.ok).toBe(false);
      expect(result.failures.join('\n')).toMatch(/not `approved`/);
    }
  });

  it('rejects an approval that nobody signed or dated', () => {
    for (const overrides of [
      { approvedBy: undefined },
      { approvedOn: 'soon' },
      { approvedOn: undefined },
    ]) {
      const result = evaluateDependencies({
        prodAudit: { vulnerabilities: {} },
        devAudit: advisory('eslint', 'GHSA-dddd-eeee-ffff'),
        exceptions: { developmentAdvisories: [completeException(overrides)] },
        licences: [],
        installedPackages: new Set(),
        today: '2026-07-28',
        proofs,
      });
      expect(result.ok).toBe(false);
      expect(result.failures.join('\n')).toMatch(/reviewed or revoked/);
    }
  });

  it('fails an EXPIRED development exception', () => {
    const result = evaluateDependencies({
      prodAudit: { vulnerabilities: {} },
      devAudit: advisory('eslint', 'GHSA-dddd-eeee-ffff'),
      exceptions: {
        developmentAdvisories: [
          completeException({ reviewBy: '2020-01-01', expiresOn: '2020-06-01' }),
        ],
      },
      licences: [],
      installedPackages: new Set(),
      today: new Date('2026-07-28'),
      proofs,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/EXPIRED/);
  });

  it('fails an exception missing an owner', () => {
    const result = evaluateDependencies({
      prodAudit: { vulnerabilities: {} },
      devAudit: advisory('eslint', 'GHSA-dddd-eeee-ffff'),
      exceptions: { developmentAdvisories: [completeException({ owner: undefined })] },
      licences: [],
      installedPackages: new Set(),
      today: new Date('2026-07-28'),
      proofs,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/owner/);
  });

  it('fails an exception whose reachability claim has no proof behind it', () => {
    // The claim is complete and internally consistent; what is missing is the
    // mechanically derived evidence. An unproven safety claim is exactly what
    // this file exists to prevent.
    const result = evaluateDependencies({
      prodAudit: { vulnerabilities: {} },
      devAudit: advisory('eslint', 'GHSA-dddd-eeee-ffff'),
      exceptions: { developmentAdvisories: [completeException()] },
      licences: [],
      installedPackages: new Set(),
      today: new Date('2026-07-28'),
      proofs: {},
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/requires a dependency-path proof/);
  });

  it('FAILS on an exception that matches nothing, so the list cannot outlive the problem', () => {
    // Previously a warning. Now a failure: either the advisory was fixed and
    // the entry must go, or the dependency path changed and the entry no longer
    // describes reality. Both make the list look more permissive than it is.
    const result = evaluateDependencies({
      prodAudit: { vulnerabilities: {} },
      devAudit: { vulnerabilities: {} },
      exceptions: {
        developmentAdvisories: [completeException({ id: 'GHSA-gone', package: 'gone' })],
      },
      licences: [],
      installedPackages: new Set(),
      today: new Date('2026-07-28'),
      proofs,
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/matched no current advisory/);
  });

  it('refuses a prohibited package outright', () => {
    const result = evaluateDependencies({
      prodAudit: { vulnerabilities: {} },
      devAudit: { vulnerabilities: {} },
      exceptions: { developmentAdvisories: [] },
      licences: [],
      installedPackages: new Set(['event-stream']),
      today: new Date('2026-07-28'),
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/event-stream/);
    expect(
      (PROHIBITED_PACKAGES as Array<{ reason: string }>).every((p) => p.reason.length > 10)
    ).toBe(true);
  });

  it('refuses a copyleft licence incompatible with a proprietary product', () => {
    const result = evaluateDependencies({
      prodAudit: { vulnerabilities: {} },
      devAudit: { vulnerabilities: {} },
      exceptions: { developmentAdvisories: [] },
      licences: [{ name: 'some-lib', license: 'AGPL-3.0' }],
      installedPackages: new Set(),
      today: new Date('2026-07-28'),
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/AGPL-3.0/);
  });
});

describe('migration replay checks', () => {
  it('accepts both filename conventions in the repository', () => {
    expect(
      checkFilenames(['0001_extensions.sql', '0002_base.sql', '20260717100000_org.sql'])
    ).toEqual([]);
  });

  it('refuses a duplicate or out-of-order timestamp, because apply order is lexical', () => {
    expect(checkFilenames(['20260717100000_a.sql', '20260717100000_b.sql']).join('\n')).toMatch(
      /does not come after/
    );
    expect(checkFilenames(['20260718100000_a.sql', '20260717100000_b.sql']).join('\n')).toMatch(
      /does not come after/
    );
  });

  it('refuses a bootstrap-style name once the timestamped block has begun', () => {
    expect(checkFilenames(['20260717100000_a.sql', '0004_late.sql']).join('\n')).toMatch(
      /bootstrap block is closed/
    );
  });

  it('refuses a filename that matches no convention', () => {
    expect(checkFilenames(['add_thing.sql']).join('\n')).toMatch(/matches neither/);
  });

  it('strips dollar-quoted bodies so a history trigger is not mistaken for a data seed', () => {
    const trigger = `CREATE FUNCTION f() RETURNS trigger AS $$
BEGIN
  INSERT INTO wo.work_order_status_history (id) VALUES (1);
END;
$$;`;
    expect(stripSqlBodies(trigger)).not.toContain('INSERT INTO wo.');
  });

  it('still catches a genuine top-level business INSERT', (ctx) => {
    // Written to a throwaway directory so the REAL filesystem path is exercised
    // — the stripping logic and the file walk are separate ways to be wrong.
    const dir = mkdtempSync(join(tmpdir(), 'rootlco-migration-'));
    ctx.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, 'seed.sql'),
      "INSERT INTO crm.partners (id, name) VALUES (1, 'Demo Customer');\n"
    );
    expect(checkNoDeveloperData(dir, ['seed.sql']).join('\n')).toMatch(/crm\.partners/);
  });

  it('does not flag a history trigger written to disk', (ctx) => {
    const dir = mkdtempSync(join(tmpdir(), 'rootlco-migration-'));
    ctx.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    writeFileSync(
      join(dir, 'trigger.sql'),
      `CREATE FUNCTION f() RETURNS trigger AS $$\nBEGIN\n  INSERT INTO wo.work_order_status_history (id) VALUES (1);\nEND;\n$$;\n`
    );
    expect(checkNoDeveloperData(dir, ['trigger.sql'])).toEqual([]);
  });
});

describe('route ↔ registry parity', () => {
  it('finds a route module that no import registers', () => {
    const result = compareRoutes(
      ['@/app/api/v1/a/route', '@/app/api/v1/b/route'],
      ['@/app/api/v1/a/route'],
      []
    );
    expect(result.missingImports).toEqual(['@/app/api/v1/b/route']);
  });

  it('finds an import that resolves to no route module', () => {
    const result = compareRoutes(
      ['@/app/api/v1/a/route'],
      ['@/app/api/v1/a/route', '@/app/api/v1/gone/route'],
      []
    );
    expect(result.staleImports).toEqual(['@/app/api/v1/gone/route']);
  });

  it('flags an unversioned route with no recorded justification', () => {
    const result = compareRoutes(
      ['@/app/api/v1/a/route'],
      ['@/app/api/v1/a/route'],
      ['@/app/api/rogue/route']
    );
    expect(result.unexpectedUnversioned).toEqual(['@/app/api/rogue/route']);
  });

  it('accepts the documented unversioned health probe', () => {
    const result = compareRoutes(
      ['@/app/api/v1/a/route'],
      ['@/app/api/v1/a/route'],
      ['@/app/api/health/route']
    );
    expect(result.unexpectedUnversioned).toEqual([]);
  });

  it('reads only side-effect imports of route modules', () => {
    const source = `import '@/app/api/v1/a/route';
import { thing } from '@/lib/thing';
import '@/app/api/v1/b/route';`;
    expect(discoverImports(source)).toEqual(['@/app/api/v1/a/route', '@/app/api/v1/b/route']);
  });
});

describe('credential-shape scanner', () => {
  /**
   * Every fixture is assembled at runtime, for the same reason as the test
   * honesty fixtures above: `scripts/check-tracked-secrets.mjs` scans this file
   * too, and a literal credential-shaped string here would fail the repository's
   * own secret gate. The values are synthetic and worthless — but a scanner
   * cannot tell, which is exactly the property being tested.
   */
  const pgUrl = ['postgres:', '/', '/user:', 'hunter2', '@host/db'].join('');

  it('recognises each shape it claims to', () => {
    expect(classifySecret(`-----BEGIN RSA ${'PRIVATE'} KEY-----`)).toContain('private-key-header');
    expect(classifySecret(`AKIA${'A1B2C3D4E5F6G7H8'}`)).toContain('aws-access-key');
    expect(classifySecret(`gh${'p'}_${'a'.repeat(40)}`)).toContain('github-token');
    expect(classifySecret(pgUrl)).toContain('postgres-url-with-password');
    expect(classifySecret(`sb_${'secret'}_${'x'.repeat(30)}`)).toContain('supabase-secret-key');
  });

  it('does not fire on ordinary text', () => {
    expect(classifySecret('const greeting = "hello world";')).toEqual([]);
    expect(classifySecret('postgres://user@host/db')).toEqual([]);
  });

  it('allows a fixture only for the exact file AND pattern class recorded', () => {
    expect(isAllowed('tests/logger.test.ts', 'postgres-url-with-password')).toBe(true);
    // The same file must NOT be allowed to carry a different class of secret.
    expect(isAllowed('tests/logger.test.ts', 'aws-access-key')).toBe(false);
    // Nor may an unrelated file inherit the allowance.
    expect(isAllowed('src/server/db/pool.ts', 'postgres-url-with-password')).toBe(false);
  });
});
