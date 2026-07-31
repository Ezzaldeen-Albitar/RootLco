/**
 * Dependency-gate rules, and a mutation for every one of them.
 *
 * The gate's whole job is to say "this advisory is waived" only when the waiver
 * still describes reality. A waiver that survives its own cause — the package
 * moved into production, the dependency path changed, a compatible fix landed,
 * the expiry passed — is worse than no waiver, because it reads as a decision
 * somebody made about the risk that exists now.
 *
 * Every test below is a MUTATION: it takes the real, passing configuration and
 * changes exactly one thing, then asserts the gate goes red. A rule with no
 * mutation test is a rule nobody has proved fires.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate, assertUsableAudit } from '../../scripts/ci/dependency-policy.mjs';

const BASELINE = join(__dirname, '../../.github/ci-baselines/dependency-exceptions.json');

/**
 * A SYNTHETIC exception, in the exact shape the gate demands.
 *
 * This used to be the committed one, deep-cloned. That worked only while the
 * repository actually held a waiver — and on 2026-08-01 the last one was removed,
 * because a compatible patch landed and the entry's own `removalCondition` fired.
 * Every mutation below then had nothing to mutate, and eleven rules that had been
 * proved to fire silently stopped being proved at all.
 *
 * Which is backwards. An empty exception list is the state this gate exists to make
 * reachable, so it must be the state in which the rules are MOST testable, not least.
 * The fixture is therefore synthetic and self-contained: it matches
 * `braceExpansionAudit()` and `reachabilityProof()` below, which were always
 * synthetic, so the three agree by construction and none of them depends on what the
 * repository happens to be carrying today.
 *
 * The committed file is still read — by `describe('the committed configuration')`,
 * which asserts what it really contains rather than assuming it contains something.
 */
function syntheticException(): Record<string, unknown> {
  return {
    developmentAdvisories: [
      {
        id: 'GHSA-mh99-v99m-4gvg',
        advisorySource: 1124334,
        advisoryUrl: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
        title:
          'brace-expansion: DoS via unbounded expansion length causing an out-of-memory process crash',
        package: 'brace-expansion',
        severity: 'high',
        affectedRange: '<=5.0.7',
        patchedVersion: '5.0.8',
        installedAffectedVersions: ['1.1.16', '2.1.3'],
        dependencyNodes: [
          'node_modules/glob/node_modules/brace-expansion',
          'node_modules/minimatch/node_modules/brace-expansion',
        ],
        attemptedRemediation:
          'package.json overrides forcing brace-expansion to ^5.0.8 across the tree.',
        attemptedRemediationResult:
          'ESLint broken. npm run lint failed with TypeError: expand is not a function at ' +
          'Minimatch.braceExpand. Verified by execution, not inferred.',
        environment: 'development tooling only',
        productionReachable: false,
        productionReachableEvidence:
          '`npm ls brace-expansion --omit=dev --all` returns `(empty)`. The production dependency tree contains no brace-expansion, no minimatch and no eslint. Every one … (trimmed for the fixture)',
        finalContainerReachable: false,
        finalContainerReachableEvidence:
          'READ THIS AS REACHABILITY, NOT ABSENCE. See `finalContainerCodePresent`: the code IS in the image, vendored inside the `node` binary itself. What is asserted … (trimmed for the fixture)',
        finalContainerCodePresent: true,
        finalContainerCodePresentEvidence:
          "brace-expansion's CODE IS PRESENT in the final container and cannot be removed. Node.js bundles its internal JavaScript tooling into the executable: the … (trimmed for the fixture)",
        runtimeImportEvidence:
          'No file under src/ or scripts/ imports brace-expansion, minimatch or glob, directly or transitively. Verified by scripts/ci/dependency-path-proof.mjs on every run.',
        exploitability:
          'Not reachable based on current evidence. The vulnerability is a denial of service triggered by an attacker-supplied brace expression. Reaching it requires an … (trimmed for the fixture)',
        attackerControlledPatterns: false,
        attackerControlledPatternsEvidence:
          'The glob and brace patterns evaluated in this repository come from eslint.config.mjs, the three vitest configs and package.json script arguments — all … (trimmed for the fixture)',
        reasonUpgradeCannotBeApplied:
          'The parent ESLint and minimatch chain requires the older brace-expansion API. minimatch@3.1.5 requires ^1.1.7 and minimatch@9.0.9 requires ^2.0.2; … (trimmed for the fixture)',
        compensatingControls: [
          'No attacker-controlled brace or glob expressions: every pattern evaluated comes from committed configuration.',
          'Repository-controlled patterns only: GitHub Actions passes no event-supplied value into a glob.',
          'No production inclusion: absent from the production dependency tree, proven by `npm ls --omit=dev`.',
          'Not reachable from the running application: `require("brace-expansion")` fails with MODULE_NOT_FOUND in the built image and the name is not a Node builtin, so … (trimmed for the fixture)',
          'Dependency monitoring: Dependabot watches npm weekly; the dependency-security job re-derives the full path proof on every pull request and every protected push.',
          'The gate fails automatically if the package ever becomes production-reachable, if the dependency path changes, or if a compatible patched version becomes installable.',
        ],
        owner: 'platform-owner',
        createdOn: '2026-07-28',
        reviewBy: '2026-09-30',
        expiresOn: '2026-10-31',
        removalCondition:
          'The parent dependency chain supports a patched compatible brace-expansion version — that is, eslint and @vitest/coverage-v8 resolve a minimatch that accepts … (trimmed for the fixture)',
        evidenceLinks: [
          'docs/engineering/ci-automation/evidence/brace-expansion-reachability-proof.md',
          'docs/engineering/ci-automation/security-model.md',
          'scripts/ci/dependency-path-proof.mjs',
          'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
          'Dockerfile',
          '.github/workflows/_reusable-container.yml',
        ],
        approvalStatus: 'approved',
        approvedBy: 'platform-owner',
        approvedOn: '2026-07-29',
        approvalNote:
          'APPROVED by the platform owner on 2026-07-29 as a narrow, temporary, upstream-blocked development-tooling exception. The approval is recorded with its stated … (trimmed for the fixture)',
      },
    ],
  };
}

/** The real advisory shape npm produces for GHSA-mh99-v99m-4gvg. */
function braceExpansionAudit(overrides: Record<string, unknown> = {}) {
  return {
    metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 1, critical: 0, total: 1 } },
    vulnerabilities: {
      'brace-expansion': {
        name: 'brace-expansion',
        severity: 'high',
        isDirect: false,
        range: '<=5.0.7',
        nodes: [
          'node_modules/glob/node_modules/brace-expansion',
          'node_modules/minimatch/node_modules/brace-expansion',
        ],
        fixAvailable: { name: 'eslint', version: '10.8.0', isSemVerMajor: true },
        via: [
          {
            source: 1124334,
            name: 'brace-expansion',
            title: 'brace-expansion: DoS via unbounded expansion length',
            url: 'https://github.com/advisories/GHSA-mh99-v99m-4gvg',
            severity: 'high',
            range: '<=5.0.7',
          },
        ],
        ...overrides,
      },
    },
  };
}

const CLEAN_PRODUCTION = {
  metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
  vulnerabilities: {},
};

/** The mechanically derived proof, in its real passing shape. */
function reachabilityProof(overrides: Record<string, unknown> = {}) {
  return {
    package: 'brace-expansion',
    productionReachable: false,
    inProductionInstall: false,
    packageDirInRunnerImage: false,
    directImports: [],
    instances: [
      { path: 'node_modules/brace-expansion', version: '5.0.8', devOnly: true },
      { path: 'node_modules/glob/node_modules/brace-expansion', version: '2.1.3', devOnly: true },
      {
        path: 'node_modules/minimatch/node_modules/brace-expansion',
        version: '1.1.16',
        devOnly: true,
      },
    ],
    ...overrides,
  };
}

function run(options: Record<string, unknown> = {}) {
  return evaluate({
    prodAudit: CLEAN_PRODUCTION,
    devAudit: braceExpansionAudit(),
    exceptions: syntheticException(),
    licences: [],
    installedPackages: new Set(),
    today: new Date('2026-07-28'),
    proofs: { 'brace-expansion': reachabilityProof() },
    ...options,
  });
}

describe('dependency gate — the synthetic exception is a WORKING one', () => {
  it('passes with a complete exception, its advisory and its proof', () => {
    // The control. Without it, every mutation below could be failing for a reason
    // that has nothing to do with the thing it mutated.
    const result = run();
    expect(result.failures, result.failures.join('\n')).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.development.waived).toBeGreaterThan(0);
  });

  it('reports production separately and at zero', () => {
    const result = run();
    expect(result.production.blocking).toBe(0);
  });
});

describe('dependency gate — the committed configuration', () => {
  const committed = JSON.parse(readFileSync(BASELINE, 'utf8')) as {
    developmentAdvisories: Array<Record<string, unknown>>;
    removedAdvisories?: Array<Record<string, unknown>>;
  };

  it('currently waives nothing', () => {
    // Asserted rather than assumed. If a waiver is ever added back this fails, and
    // the next test is what checks it is well formed — so neither state is silent.
    expect(committed.developmentAdvisories).toEqual([]);
  });

  it('every committed exception, if any, carries the fields the gate requires', () => {
    for (const entry of committed.developmentAdvisories) {
      for (const field of [
        'id',
        'package',
        'severity',
        'affectedRange',
        'dependencyNodes',
        'owner',
        'expiresOn',
        'approvalStatus',
        'approvedBy',
        'approvedOn',
      ]) {
        expect(entry[field], `${String(entry.id)} is missing ${field}`).toBeTruthy();
      }
    }
  });

  it('a removed exception keeps its history rather than vanishing', () => {
    // The waiver removed on 2026-08-01 is retained under `removedAdvisories`. A
    // deleted waiver leaves no record that a risk was ever accepted, or why it
    // stopped being one.
    for (const entry of committed.removedAdvisories ?? []) {
      expect(entry.removedOn).toBeTruthy();
      expect(entry.removedBecause).toBeTruthy();
      expect(entry.remediation).toBeTruthy();
    }
  });
});

describe('dependency gate — mutations, each must fail', () => {
  it('MUTATION 1 — remove the exception', () => {
    const result = run({ exceptions: { developmentAdvisories: [] } });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/unwaived high advisory/);
  });

  it('MUTATION 2 — broaden the exception version range', () => {
    const exceptions = syntheticException() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    exceptions.developmentAdvisories[0]!.affectedRange = '<=99.0.0';
    const result = run({ exceptions });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/records affected range .*but npm reports/);
  });

  it('MUTATION 3 — omit the dependency path', () => {
    const exceptions = syntheticException() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    delete exceptions.developmentAdvisories[0]!.dependencyNodes;
    const result = run({ exceptions });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/records no `dependencyNodes`/);
  });

  it('MUTATION 3b — change the dependency path', () => {
    const exceptions = syntheticException() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    exceptions.developmentAdvisories[0]!.dependencyNodes = ['node_modules/somewhere/else'];
    const result = run({ exceptions });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/dependency path changed/);
  });

  it('MUTATION 4 — mark it production-safe without evidence', () => {
    const exceptions = syntheticException() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    delete exceptions.developmentAdvisories[0]!.productionReachableEvidence;
    const result = run({ exceptions });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/records no evidence/);
  });

  it('MUTATION 4b — claim the container does not reach it, with no image evidence', () => {
    const exceptions = syntheticException() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    delete exceptions.developmentAdvisories[0]!.finalContainerReachableEvidence;
    const result = run({ exceptions });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/finalContainerReachable/);
  });

  it('MUTATION 4c — an UNAPPROVED exception must not waive anything', () => {
    // Until this rule existed, `approvalStatus` was documentation: an entry
    // marked `pending-owner-approval` suppressed advisories exactly as an
    // approved one did, so the owner's decision changed nothing. A risk
    // acceptance the machine ignores is not a control.
    for (const status of ['pending-owner-approval', 'rejected', undefined]) {
      const exceptions = syntheticException() as {
        developmentAdvisories: Array<Record<string, unknown>>;
      };
      if (status === undefined) delete exceptions.developmentAdvisories[0]!.approvalStatus;
      else exceptions.developmentAdvisories[0]!.approvalStatus = status;
      const result = run({ exceptions });
      expect(result.ok).toBe(false);
      expect(result.failures.join('\n')).toMatch(/approved/);
    }
  });

  it('MUTATION 4d — an approval nobody signed or dated is not an approval', () => {
    for (const mutate of [
      (e: Record<string, unknown>) => delete e.approvedBy,
      (e: Record<string, unknown>) => {
        e.approvedOn = 'soon';
      },
      (e: Record<string, unknown>) => delete e.approvedOn,
    ]) {
      const exceptions = syntheticException() as {
        developmentAdvisories: Array<Record<string, unknown>>;
      };
      mutate(exceptions.developmentAdvisories[0]!);
      const result = run({ exceptions });
      expect(result.ok).toBe(false);
      expect(result.failures.join('\n')).toMatch(/approvedBy|approvedOn|reviewed or revoked/);
    }
  });

  it('MUTATION 5 — expire the exception', () => {
    // The committed entry expires 2026-10-31. Evaluate a day later.
    const result = run({ today: new Date('2026-11-01') });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/EXPIRED/);
  });

  it('MUTATION 5b — passing the review date warns but does not yet block', () => {
    // Review 2026-09-30, expiry 2026-10-31. Between them: a warning, not a wall.
    const result = run({ today: new Date('2026-10-01') });
    expect(result.ok).toBe(true);
    expect(result.warnings.join('\n')).toMatch(/passed its review date/);
  });

  it('MUTATION 6 — add an unwaived High advisory', () => {
    const devAudit = braceExpansionAudit();
    (devAudit.vulnerabilities as Record<string, unknown>)['some-other-lib'] = {
      name: 'some-other-lib',
      severity: 'high',
      isDirect: false,
      range: '<2.0.0',
      nodes: ['node_modules/some-other-lib'],
      fixAvailable: false,
      via: [
        {
          source: 999999,
          name: 'some-other-lib',
          title: 'unrelated remote code execution',
          url: 'https://github.com/advisories/GHSA-zzzz-zzzz-zzzz',
          severity: 'high',
          range: '<2.0.0',
        },
      ],
    };
    const result = run({ devAudit });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/some-other-lib/);
  });

  it('MUTATION 7 — npm audit returns an error object', () => {
    const problem = assertUsableAudit({ error: { code: 'ENETUNREACH' } }, 'production');
    expect(problem).toMatch(/ENETUNREACH/);
    expect(problem).toMatch(/did not run/);
    // And the other malformed shapes, each of which would otherwise read as zero.
    expect(assertUsableAudit({}, 'x')).toBeTruthy();
    expect(assertUsableAudit({ vulnerabilities: {} }, 'x')).toBeTruthy();
    expect(assertUsableAudit(null, 'x')).toBeTruthy();
    expect(assertUsableAudit(CLEAN_PRODUCTION, 'x')).toBeNull();
  });

  it('MUTATION 8 — brace-expansion becomes production-reachable', () => {
    const result = run({
      proofs: { 'brace-expansion': reachabilityProof({ productionReachable: true }) },
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/IS production-reachable/);
  });

  it('MUTATION 8b — the runner image resolves it as an installed package', () => {
    const result = run({
      proofs: { 'brace-expansion': reachabilityProof({ packageDirInRunnerImage: true }) },
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/resolvable as an installed package/);
  });

  it('MUTATION 8c — application source imports it directly', () => {
    const result = run({
      proofs: {
        'brace-expansion': reachabilityProof({ directImports: ['src/server/glob-thing.ts'] }),
      },
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/imports .* directly/);
  });

  it('MUTATION 8d — a production advisory is never waived, whatever the exception says', () => {
    const result = run({ prodAudit: braceExpansionAudit() });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/never waived/);
  });

  it('MUTATION 9 — a compatible patched version becomes available while the exception remains', () => {
    const devAudit = braceExpansionAudit({
      fixAvailable: { name: 'eslint', version: '9.40.0', isSemVerMajor: false },
    });
    const result = run({ devAudit });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/COMPATIBLE fix is now available/);
  });

  it('MUTATION 9b — npm reports a plain non-breaking fix', () => {
    const result = run({ devAudit: braceExpansionAudit({ fixAvailable: true }) });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/without a breaking change/);
  });

  it('MUTATION 10 — the advisory becomes a DIRECT dependency', () => {
    const result = run({ devAudit: braceExpansionAudit({ isDirect: true }) });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/now a DIRECT dependency/);
  });

  it('MUTATION 11 — the exception matches nothing', () => {
    // The advisory is gone; the entry remains. Previously a warning, now a
    // failure: an exception that outlives its cause makes the list look more
    // permissive than it is.
    const result = run({ devAudit: CLEAN_PRODUCTION });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/matched no current advisory/);
  });

  it('MUTATION 12 — the reachability proof is withheld', () => {
    const result = run({ proofs: {} });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/requires a dependency-path proof/);
  });

  it('MUTATION 13 — the exception drops its owner', () => {
    const exceptions = syntheticException() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    delete exceptions.developmentAdvisories[0]!.owner;
    const result = run({ exceptions });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/owner/);
  });

  it('MUTATION 14 — the exception drops a required evidence field', () => {
    for (const field of [
      'patchedVersion',
      'exploitability',
      'reasonUpgradeCannotBeApplied',
      'attemptedRemediation',
      'attemptedRemediationResult',
      'removalCondition',
    ]) {
      const exceptions = syntheticException() as {
        developmentAdvisories: Array<Record<string, unknown>>;
      };
      delete exceptions.developmentAdvisories[0]![field];
      const result = run({ exceptions });
      expect(result.ok, `dropping ${field} must fail the gate`).toBe(false);
      expect(result.failures.join('\n'), field).toMatch(new RegExp(field));
    }
  });

  it('MUTATION 15 — the exception drops its compensating controls or evidence links', () => {
    for (const field of ['compensatingControls', 'evidenceLinks']) {
      const exceptions = syntheticException() as {
        developmentAdvisories: Array<Record<string, unknown>>;
      };
      exceptions.developmentAdvisories[0]![field] = [];
      const result = run({ exceptions });
      expect(result.ok, `emptying ${field} must fail the gate`).toBe(false);
    }
  });

  it('MUTATION 16 — the exception is retargeted at a different package', () => {
    const exceptions = syntheticException() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    exceptions.developmentAdvisories[0]!.package = 'lodash';
    const result = run({ exceptions });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/is recorded for package/);
  });
});

describe('the committed exception is exact, not broad', () => {
  it('waives one advisory, one package, one range, one dependency-path fingerprint', () => {
    const exceptions = syntheticException() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    expect(exceptions.developmentAdvisories).toHaveLength(1);
    const entry = exceptions.developmentAdvisories[0]!;
    expect(entry.id).toBe('GHSA-mh99-v99m-4gvg');
    expect(entry.package).toBe('brace-expansion');
    expect(entry.affectedRange).toBe('<=5.0.7');
    expect(entry.patchedVersion).toBe('5.0.8');
    expect(entry.dependencyNodes).toHaveLength(2);
    expect(entry.productionReachable).toBe(false);
    expect(entry.finalContainerReachable).toBe(false);
    // No wildcard, no severity-wide waiver, no package-wide waiver.
    expect(JSON.stringify(entry)).not.toContain('"*"');
  });

  it('records both a review date and a later hard expiry', () => {
    const entry = (syntheticException() as { developmentAdvisories: Array<Record<string, string>> })
      .developmentAdvisories[0]!;
    const review = new Date(entry.reviewBy!).getTime();
    const expiry = new Date(entry.expiresOn!).getTime();
    expect(Number.isNaN(review)).toBe(false);
    expect(Number.isNaN(expiry)).toBe(false);
    expect(expiry).toBeGreaterThan(review);
  });

  it('states the attempted remediation and why it failed, so nobody retries it blindly', () => {
    const entry = (syntheticException() as { developmentAdvisories: Array<Record<string, string>> })
      .developmentAdvisories[0]!;
    expect(entry.attemptedRemediation).toMatch(/override/i);
    expect(entry.attemptedRemediationResult).toMatch(/ESLint broken|expand is not a function/i);
  });
});
