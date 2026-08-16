/**
 * The committed baselines must be usable, not merely present.
 *
 * No test previously opened `.github/ci-baselines/`. Setting the unit
 * baseline's `global` to `{}` — or its tolerance to a non-numeric string —
 * silences the coverage ratchet completely, and every one of the 98 gate tests
 * still passed. A gate whose own configuration can be blanked without a test
 * noticing is a gate with an off switch nobody can see.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evaluate as evaluateCoverage } from '../../scripts/ci/coverage-gate.mjs';

const read = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, '../../.github/ci-baselines', name), 'utf8'));

/**
 * A figure inside a prose field, matched as a figure rather than as a substring.
 *
 * `QA005-05`: `toContain('214')` is satisfied by `2140` and by `1214`, so a note
 * that had drifted to a longer number went on passing. Refusing a digit or a
 * decimal point on either side is what makes the comparison two-sided.
 */
const exactly = (value: string | number): RegExp =>
  new RegExp(
    String.raw`(?<![\d.])${String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\d.])`
  );

describe('committed baselines', () => {
  it('the unit coverage baseline records real numbers and a sane tolerance', () => {
    const baseline = read('coverage-baseline.unit.json');
    expect(baseline.tolerancePercentagePoints).toBeTypeOf('number');
    expect(baseline.tolerancePercentagePoints).toBeGreaterThanOrEqual(0);
    expect(baseline.tolerancePercentagePoints).toBeLessThanOrEqual(2);
    for (const metric of ['lines', 'statements', 'functions', 'branches']) {
      expect(baseline.global[metric], metric).toBeTypeOf('number');
      expect(baseline.global[metric], metric).toBeGreaterThan(50);
    }
  });

  it('the committed unit baseline actually rejects a collapsed measurement', () => {
    // The strongest form of this test: run the real gate against the real
    // baseline. If someone blanks the document, this fails.
    const collapsed = {
      total: {
        lines: { total: 100, covered: 10, pct: 10 },
        statements: { total: 100, covered: 10, pct: 10 },
        functions: { total: 100, covered: 10, pct: 10 },
        branches: { total: 100, covered: 10, pct: 10 },
      },
    };
    const result = evaluateCoverage(collapsed, read('coverage-baseline.unit.json'));
    expect(result.ok, 'the committed baseline must reject a 10% measurement').toBe(false);
  });

  it('every critical-module rule names a real metric and expects real files', () => {
    const baseline = read('coverage-baseline.unit.json');
    expect(baseline.criticalModules.length).toBeGreaterThan(0);
    for (const rule of baseline.criticalModules) {
      expect(['lines', 'statements', 'functions', 'branches'], rule.id).toContain(
        rule.metric ?? 'lines'
      );
      expect(rule.minimum, rule.id).toBeTypeOf('number');
      expect(rule.minMatchedFiles, rule.id).toBeGreaterThan(0);
      expect(rule.why, rule.id).toBeTruthy();
    }
  });

  it('the backend baseline is established, and its ratchet is armed', () => {
    const baseline = read('coverage-baseline.backend.json');
    // This test previously asserted the OPPOSITE — that `establishedBy` was
    // null — because the tier had never been measured on a hosted runner and
    // measure-first was the honest state. Run 19 measured it, so the assertion
    // flips: from here on an empty `global` is a silenced ratchet, which is
    // exactly the case coverage-gate.mjs fails when `establishedBy` is set.
    expect(baseline.establishedBy).toBeTruthy();
    expect(baseline.establishedBy).toMatch(/run id \d+/);
    expect(baseline.establishmentNote).toBeTruthy();
    for (const metric of ['lines', 'statements', 'functions', 'branches']) {
      expect(baseline.global[metric], metric).toBeTypeOf('number');
      expect(baseline.global[metric], metric).toBeGreaterThan(50);
    }
  });

  it('the committed backend baseline actually rejects a collapsed measurement', () => {
    const collapsed = {
      total: {
        lines: { total: 100, covered: 10, pct: 10 },
        statements: { total: 100, covered: 10, pct: 10 },
        functions: { total: 100, covered: 10, pct: 10 },
        branches: { total: 100, covered: 10, pct: 10 },
      },
    };
    const result = evaluateCoverage(collapsed, read('coverage-baseline.backend.json'));
    expect(result.ok, 'the committed backend baseline must reject a 10% measurement').toBe(false);
  });

  it('every backend critical-module floor sits below its recorded measurement', () => {
    const baseline = read('coverage-baseline.backend.json');
    expect(baseline.criticalModules.length).toBeGreaterThan(0);
    for (const rule of baseline.criticalModules) {
      expect(rule.minimum, rule.id).toBeTypeOf('number');
      expect(rule.minMatchedFiles, rule.id).toBeGreaterThan(0);
      expect(rule.why, rule.id).toBeTruthy();
      // A floor recorded ABOVE what was measured is a gate that was red the
      // moment it was committed; a floor recorded AT the measurement leaves no
      // room for the rounding of an identical run.
      expect(rule.measuredAtEstablishment, rule.id).toBeTypeOf('number');
      expect(rule.minimum, rule.id).toBeLessThan(rule.measuredAtEstablishment);
    }
  });

  it('the build-size and container baselines carry a measurement and its provenance', () => {
    // Both were `null` until run 19. A number without provenance is a number
    // somebody could have typed, which is the thing measure-first exists to
    // prevent — so the run that produced it has to be nameable.
    const build = read('build-size-baseline.json');
    expect(build.standaloneBytes).toBeTypeOf('number');
    expect(build.standaloneBytes).toBeGreaterThan(0);
    expect(build.establishedBy).toMatch(/run id \d+/);
    expect(build.warnGrowthRatio).toBeLessThan(build.failGrowthRatio);

    const container = read('container-baseline.json');
    expect(container.imageSizeBytes).toBeTypeOf('number');
    expect(container.imageSizeBytes).toBeGreaterThan(0);
    expect(container.establishedBy).toMatch(/run id \d+/);
    // The size is uncompressed and the id is local, and both facts have to
    // survive in the file — a reader who assumes "digest" means a registry
    // manifest digest will otherwise compare it against one and be baffled.
    expect(container.imageSizeKind).toMatch(/UNCOMPRESSED/);
    expect(container.imageIdKind).toMatch(/PROVENANCE ONLY/);
    expect(container.imageId, 'must not be named `imageId` — it is not a pin').toBeUndefined();
  });

  it('the schema baseline enforces structural totals and the seeded-table allow-list', () => {
    const baseline = read('schema-baseline.json');
    for (const key of ['tables', 'functions', 'policies', 'triggers']) {
      expect(baseline.structuralTotals[key], key).toBeTypeOf('number');
      expect(baseline.structuralTotals[key], key).toBeGreaterThan(0);
    }
    expect(baseline.structuralTotals.security_definer).toBe(0);

    expect(Array.isArray(baseline.seededStructuralTables)).toBe(true);
    expect(baseline.seededStructuralTables.length).toBeGreaterThan(0);
    for (const table of baseline.seededStructuralTables) {
      // `schema.table`, bare — migration-replay-checks.mjs compares against
      // `p.split(' ')[0]`, so a row count smuggled into the string would never
      // match and the allow-list entry would silently protect nothing.
      expect(table, table).toMatch(/^[a-z_]+\.[a-z_]+$/);
    }

    // The two function counts disagree for a known reason. If someone
    // "reconciles" them by editing this file, the explanation must go with it.
    expect(baseline.functionCountDiscrepancyNote).toBeTruthy();
    // The RootLco-schema figure, which `npm run validate:schema-inventory`
    // reports and which a developer can reproduce locally. It moves in lockstep
    // with structuralTotals.functions — the gap between them is extension-owned
    // code and is constant — so pinning both is what makes the larger figure
    // derivable instead of guessed. 214 through DBCR-P1-18-001; 215 since
    // DBCR-P1-18-002 added rec.stamp_receiving_employee_identity, which lives in
    // one of the seventeen RootLco schemas and is therefore counted by both.
    expect(baseline.functionCountDiscrepancyNote).toMatch(exactly(215));
    expect(baseline.functionCountDiscrepancyNote).toMatch(
      exactly(baseline.structuralTotals.functions)
    );
  });

  it('every test-count floor sits at or below its recorded measurement', () => {
    const baseline = read('test-count-baseline.json');
    const tiers = Object.entries(baseline.tiers) as Array<
      [string, { minTests: number; measured: number }]
    >;
    expect(tiers.length).toBeGreaterThan(0);
    for (const [tier, entry] of tiers) {
      expect(entry.minTests, tier).toBeGreaterThan(0);
      expect(entry.minTests, tier).toBeLessThanOrEqual(entry.measured);
    }
  });

  it('every tier that CI summarises carries a floor, including web', () => {
    /*
     * `summarise-vitest.mjs` reads `tiers[label].minTests`. A label with no entry
     * does not fail — it prints a warning and runs the tier with the anti-shrink
     * guard switched off, which is indistinguishable from a green run to anyone
     * reading the check list.
     *
     * `web` was that tier for the whole of P1-27. It grew from 39 test files to
     * 65 while carrying no floor at all, and every hosted run said so in an
     * annotation nobody was required to read: "no minimum test count is recorded
     * for tier `web`, so a shrinking suite would not be detected."
     *
     * The labels are derived from the workflow that passes them, so a new tier
     * cannot be summarised without also being floored.
     */
    /*
     * EVERY workflow, not one. This case read `_reusable-node-quality.yml` alone
     * under the title "every tier that CI summarises carries a floor", while the
     * database tier is summarised from `_reusable-database-assurance.yml` and the
     * backend tier from `_reusable-integration-tests.yml`. It reported full
     * coverage of a subset — a new tier could be summarised from either of those
     * two files with no floor and nothing would notice.
     */
    const workflowDir = join(process.cwd(), '.github', 'workflows');
    const summarised: string[] = [];
    const scanned: string[] = [];
    for (const name of readdirSync(workflowDir).filter((n) => n.endsWith('.yml'))) {
      const source = readFileSync(join(workflowDir, name), 'utf8');
      if (!source.includes('summarise-vitest.mjs')) continue;
      scanned.push(name);
      for (const m of source.matchAll(/--label\s+(\w+)/g)) summarised.push(m[1] ?? '');
    }
    expect(summarised, 'no summarise-vitest invocation was found').not.toEqual([]);
    expect(summarised, 'the web tier must be summarised').toContain('web');
    // The three tiers below are summarised from files this case used to ignore;
    // finding them is what proves the widened scan is really wider.
    for (const label of ['unit', 'database', 'backend']) {
      expect(summarised, `${label} is summarised by no scanned workflow`).toContain(label);
    }
    expect(scanned.length, 'only one workflow invokes the summariser').toBeGreaterThanOrEqual(3);

    const tiers = read('test-count-baseline.json').tiers as Record<string, unknown>;
    const unfloored = summarised.filter((label) => tiers[label] === undefined);
    expect(
      unfloored,
      'a tier is summarised with no floor, so summarise-vitest only warns and a shrinking suite passes'
    ).toEqual([]);
  });

  it('gives each floor headroom that is meaningful in both directions', () => {
    /*
     * CORRECTED. The bounds used to be `headroom > 0` and `headroom < 10%`, under
     * a message claiming they stopped a floor "wide enough to swallow a deleted
     * test file". Neither implemented that:
     *
     *   - `> 0` admits `minTests = measured - 1`, which is the "transcript rather
     *     than a guard" the caveat forbids in the same breath.
     *   - `< 10%` of 1216 is 121 tests — three times the largest web test file —
     *     so the message described a property the bound did not enforce.
     *
     * The bounds are now stated as what they are. A floor is a guard when it can
     * absorb ordinary churn without moving and still detect a real loss, so
     * headroom is required to be a real slice of the tier rather than merely
     * non-zero, and to stay well under it. What the headroom then GUARANTEES is
     * "any net loss of more than `headroom` executed tests", which the web tier
     * now records verbatim rather than as a slogan about deleted files.
     */
    const tiers = Object.entries(
      read('test-count-baseline.json').tiers as Record<
        string,
        { minTests: number; measured: number }
      >
    );
    for (const [tier, entry] of tiers) {
      const headroom = entry.measured - entry.minTests;
      const ratio = headroom / entry.measured;
      expect(headroom, `${tier}: a floor equal to its measurement is a transcript`).toBeGreaterThan(
        0
      );
      expect(
        ratio,
        `${tier}: headroom of ${headroom} is a rounding error, not a guard — the next commit moves the floor`
      ).toBeGreaterThan(0.01);
      expect(
        ratio,
        `${tier}: headroom of ${headroom} is a large fraction of the tier; state what it guarantees before widening it`
      ).toBeLessThan(0.08);
    }
  });

  it('states what a headroom guarantees wherever it is not self-evident', () => {
    /*
     * The web entry claimed 36 tests of headroom meant "a whole deleted test file
     * still trips the floor". Two web files carry 36 cases, so it did not. The
     * claim was a slogan; the bound is `> headroom`. Any tier that describes its
     * headroom must describe it as a bound, and must not resurrect the slogan.
     */
    const tiers = read('test-count-baseline.json').tiers as Record<
      string,
      { note?: string; whatTheHeadroomGuarantees?: string }
    >;
    const web = tiers.web;
    expect(web?.whatTheHeadroomGuarantees, 'the web tier states no guarantee').toBeTruthy();
    expect(web?.whatTheHeadroomGuarantees).toMatch(/NET LOSS OF MORE THAN \d+ EXECUTED TESTS/);
    for (const [label, entry] of Object.entries(tiers)) {
      const text = `${entry.note ?? ''} ${entry.whatTheHeadroomGuarantees ?? ''}`;
      const asserted = text.replace(/previously claimed[\s\S]*?That is FALSE/i, '');
      expect(
        asserted.includes('a whole deleted test file still trips the floor'),
        `${label} restates the refuted slogan as if it were true`
      ).toBe(false);
    }
  });

  it('every exception carries an owner, a reason and an expiry that has not passed', () => {
    const now = Date.now();
    for (const [file, key] of [
      ['dependency-exceptions.json', 'developmentAdvisories'],
      ['idempotency-exceptions.json', 'operations'],
    ] as Array<[string, string]>) {
      const entries = read(file)[key];
      expect(Array.isArray(entries), file).toBe(true);
      for (const entry of entries) {
        expect(entry.id, file).toBeTruthy();
        expect(entry.owner, `${file}:${entry.id}`).toBeTruthy();
        // A dependency exception states WHY the upgrade cannot be applied; an
        // idempotency exception states a plain reason. Either is a reason.
        expect(
          entry.reason ?? entry.reasonUpgradeCannotBeApplied,
          `${file}:${entry.id} records no reason`
        ).toBeTruthy();
        // `expiresOn` is the hard deadline where one exists; `reviewBy` is the
        // deadline otherwise.
        const expiry = new Date(entry.expiresOn ?? entry.reviewBy);
        expect(Number.isNaN(expiry.getTime()), `${file}:${entry.id}`).toBe(false);
        // A committed exception that has already expired means the gate is
        // red and nobody looked. Catch it here rather than on a hosted runner.
        expect(expiry.getTime(), `${file}:${entry.id} has already expired`).toBeGreaterThan(now);
      }
    }
  });

  it('every mutation target is either faithful or declares itself anchor-only', () => {
    const manifest = read('mutation-targets.json');
    expect(manifest.targets.length).toBeGreaterThan(0);
    for (const target of manifest.targets) {
      expect(target.why, target.id).toBeTruthy();
      expect(target.file, target.id).toBeTruthy();
      if (target.anchorOnly) {
        // A weaker claim has to say why it is weaker.
        expect(target.anchorOnlyReason, target.id).toBeTruthy();
      } else {
        // A faithful mutation must change the CODE, not merely annotate it.
        // Stripping comments from the replacement and finding the original
        // back means the guard was never actually removed.
        expect(target.replace, target.id).not.toBe(target.find);
        expect(target.replace.replace(/\/\*[\s\S]*?\*\//g, '').trim(), target.id).not.toBe(
          target.find.trim()
        );
        // Any non-zero exit would otherwise read as "the guard is load-bearing",
        // including a compile error or a connection failure.
        expect(target.expectFailureMatching, target.id).toBeTruthy();
      }
    }
  });

  it('the schema baseline pins a real 64-character hash and the frozen migration count', () => {
    const baseline = read('schema-baseline.json');
    expect(baseline.schemaHash).toMatch(/^[0-9a-f]{64}$/);
    expect(baseline.migrationCount).toBeTypeOf('number');
    expect(baseline.migrationCount).toBeGreaterThan(0);
    expect(baseline.forbiddenMigrationPrefix).toBeTruthy();
  });
});
