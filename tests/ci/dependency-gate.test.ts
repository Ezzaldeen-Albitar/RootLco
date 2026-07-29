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

/** The committed exception, deep-cloned so a mutation cannot leak between tests. */
function committedExceptions(): Record<string, unknown> {
  return JSON.parse(readFileSync(BASELINE, 'utf8'));
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
    exceptions: committedExceptions(),
    licences: [],
    installedPackages: new Set(),
    today: new Date('2026-07-28'),
    proofs: { 'brace-expansion': reachabilityProof() },
    ...options,
  });
}

describe('dependency gate — the committed configuration', () => {
  it('passes with the real exception, the real advisory and the real proof', () => {
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

describe('dependency gate — mutations, each must fail', () => {
  it('MUTATION 1 — remove the exception', () => {
    const result = run({ exceptions: { developmentAdvisories: [] } });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/unwaived high advisory/);
  });

  it('MUTATION 2 — broaden the exception version range', () => {
    const exceptions = committedExceptions() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    exceptions.developmentAdvisories[0]!.affectedRange = '<=99.0.0';
    const result = run({ exceptions });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/records affected range .*but npm reports/);
  });

  it('MUTATION 3 — omit the dependency path', () => {
    const exceptions = committedExceptions() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    delete exceptions.developmentAdvisories[0]!.dependencyNodes;
    const result = run({ exceptions });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/records no `dependencyNodes`/);
  });

  it('MUTATION 3b — change the dependency path', () => {
    const exceptions = committedExceptions() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    exceptions.developmentAdvisories[0]!.dependencyNodes = ['node_modules/somewhere/else'];
    const result = run({ exceptions });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/dependency path changed/);
  });

  it('MUTATION 4 — mark it production-safe without evidence', () => {
    const exceptions = committedExceptions() as {
      developmentAdvisories: Array<Record<string, unknown>>;
    };
    delete exceptions.developmentAdvisories[0]!.productionReachableEvidence;
    const result = run({ exceptions });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/records no evidence/);
  });

  it('MUTATION 4b — claim the container does not reach it, with no image evidence', () => {
    const exceptions = committedExceptions() as {
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
      const exceptions = committedExceptions() as {
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
      const exceptions = committedExceptions() as {
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
    const exceptions = committedExceptions() as {
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
      const exceptions = committedExceptions() as {
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
      const exceptions = committedExceptions() as {
        developmentAdvisories: Array<Record<string, unknown>>;
      };
      exceptions.developmentAdvisories[0]![field] = [];
      const result = run({ exceptions });
      expect(result.ok, `emptying ${field} must fail the gate`).toBe(false);
    }
  });

  it('MUTATION 16 — the exception is retargeted at a different package', () => {
    const exceptions = committedExceptions() as {
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
    const exceptions = committedExceptions() as {
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
    const entry = (
      committedExceptions() as { developmentAdvisories: Array<Record<string, string>> }
    ).developmentAdvisories[0]!;
    const review = new Date(entry.reviewBy!).getTime();
    const expiry = new Date(entry.expiresOn!).getTime();
    expect(Number.isNaN(review)).toBe(false);
    expect(Number.isNaN(expiry)).toBe(false);
    expect(expiry).toBeGreaterThan(review);
  });

  it('states the attempted remediation and why it failed, so nobody retries it blindly', () => {
    const entry = (
      committedExceptions() as { developmentAdvisories: Array<Record<string, string>> }
    ).developmentAdvisories[0]!;
    expect(entry.attemptedRemediation).toMatch(/override/i);
    expect(entry.attemptedRemediationResult).toMatch(/ESLint broken|expand is not a function/i);
  });
});
