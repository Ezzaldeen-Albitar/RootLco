import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE AUTHENTICATED BROWSER TIER HAS NEVER RUN IN CI.
 *
 * ## The finding, established from the two files that decide it
 *
 * `apps/web/playwright.config.ts` gates `tests/e2e/authenticated/**` behind
 * `ROOTLCO_E2E_AUTH === '1'`, and the five anonymous projects carry `testIgnore`
 * for that directory. `.github/workflows/_reusable-node-quality.yml` runs
 * `npm run test:web-e2e` and sets no such variable — a grep of `.github/` for
 * `ROOTLCO_E2E_AUTH` returns nothing and never has.
 *
 * So `isolation.spec.ts`, the repository's only end-to-end tenant-isolation
 * proof, and `accessibility.spec.ts`, its only route-level accessibility proof,
 * have never executed on a hosted runner — while the browser check reported
 * green and the phase records counted browser coverage.
 *
 * ## Why the fix is a declaration rather than a wiring
 *
 * The tier needs three things a hosted runner is not given: a live Supabase
 * GoTrue, a live API, and a real account with a real password. The hosted clean
 * room runs a bare `postgres:17-alpine` service container and sets
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` to a placeholder — there is no authentication
 * server to sign in to. Wiring it means standing up Supabase and bootstrapping
 * an acceptance account inside CI, which is a change that has to be proved on a
 * runner rather than asserted here.
 *
 * What is NOT acceptable is leaving it unrun and unsaid. So the gap is declared
 * in `.github/ci-baselines/unrun-test-tiers.json`, the hosted job renders it as
 * warning annotations and a job-summary table, the Playwright config prints it
 * at the point of the run — and this file makes all of that fail closed.
 *
 * Every case here is written so that the honest states pass and the two
 * dishonest ones fail: a spec that is neither executed nor declared, and a
 * declaration covering a spec that CI does in fact run.
 */

const ROOT = process.cwd();
const E2E = join(ROOT, 'apps', 'web', 'tests', 'e2e');
const DECLARATION = join(ROOT, '.github', 'ci-baselines', 'unrun-test-tiers.json');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const CONFIG = join(ROOT, 'apps', 'web', 'playwright.config.ts');

interface Unrun {
  readonly id: string;
  readonly path: string;
  readonly whatItProves: string;
  readonly whatIsUnprovenWithoutIt: string;
  readonly whyItCannotRunHosted: string;
  readonly compensatingControl: string;
  readonly owner: string;
  readonly reviewBy: string;
}

const declaration = JSON.parse(readFileSync(DECLARATION, 'utf8')) as { unrun: Unrun[] };

/** Every `*.spec.ts` under the e2e tree, repository-relative with `/` separators. */
function specs(dir: string, prefix: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) out.push(...specs(join(dir, entry.name), `${prefix}/${entry.name}`));
    else if (entry.name.endsWith('.spec.ts')) out.push(`${prefix}/${entry.name}`);
  }
  return out.sort();
}

const allSpecs = specs(E2E, 'apps/web/tests/e2e');
const authSpecs = allSpecs.filter((p) => p.includes('/authenticated/'));
const anonymousSpecs = allSpecs.filter((p) => !p.includes('/authenticated/'));

const workflowSource = readdirSync(WORKFLOWS)
  .filter((n) => /\.ya?ml$/.test(n))
  .map((n) => readFileSync(join(WORKFLOWS, n), 'utf8'))
  .join('\n');

/**
 * The workflows with every comment line removed.
 *
 * A scanner that reads prose as code has been this repository's recurring
 * mistake, and this file walked straight into it: the step added to ANNOUNCE
 * that nothing sets `ROOTLCO_E2E_AUTH` mentions the name in its own explanatory
 * comment, and the first version of the case below read that as CI setting the
 * variable. The comment is the record of the decision; deleting it to satisfy a
 * check would be the wrong repair.
 *
 * Comment lines go; then a set is `NAME:` or `NAME=`, which prose is not.
 */
const workflowCode = workflowSource
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

const setsVariable = (name: string) => new RegExp(`${name}\\s*[:=]`).test(workflowCode);

describe('the facts, established from the files that decide them', () => {
  it('finds spec files on both sides of the gate', () => {
    // Anti-vacuity first: every case below reasons about these two lists.
    expect(authSpecs.length, 'no authenticated specs were found').toBeGreaterThan(3);
    expect(anonymousSpecs.length, 'no anonymous specs were found').toBeGreaterThan(0);
  });

  it('the Playwright config gates the authenticated tier behind an environment variable', () => {
    const config = readFileSync(CONFIG, 'utf8');
    expect(config).toContain("process.env.ROOTLCO_E2E_AUTH === '1'");
    expect(
      config,
      'the anonymous projects no longer exclude the authenticated directory'
    ).toContain('testIgnore: AUTH_DIR');
  });

  it('NO workflow sets that variable — this is the finding, not an assumption', () => {
    /*
     * Asserted rather than assumed. If a future change wires the tier in, this
     * case fails and forces the declaration to be deleted in the same commit —
     * which is the correct direction: a debt must not outlive its repayment.
     */
    expect(
      setsVariable('ROOTLCO_E2E_AUTH'),
      'a workflow now sets ROOTLCO_E2E_AUTH — wire the tier and delete the unrun declaration'
    ).toBe(false);
    expect(
      workflowCode.includes('test:web-e2e-authenticated'),
      'a workflow now invokes the authenticated tier — delete the unrun declaration'
    ).toBe(false);
  });

  it('judges an ASSIGNMENT, not a mention — the scanner-reads-prose trap', () => {
    /*
     * The case above failed on its own explanation the first time it ran: the
     * step added to announce that nothing sets `ROOTLCO_E2E_AUTH` names the
     * variable in a comment. This pins the discriminator so the repair cannot
     * regress into "delete the sentence".
     */
    expect(setsVariable('ROOTLCO_E2E_AUTH')).toBe(false);
    expect(
      workflowSource.includes('ROOTLCO_E2E_AUTH'),
      'the workflows no longer explain why the tier is off'
    ).toBe(true);
    // And the discriminator is not vacuous: a variable CI really does set is
    // seen, and one only mentioned in prose is not.
    expect(setsVariable('NEXT_TELEMETRY_DISABLED')).toBe(true);
  });

  it('the anonymous tier IS invoked, so the gap is a gap and not the whole tier', () => {
    expect(workflowSource).toContain('npm run test:web-e2e');
  });
});

describe('every spec is either executed by CI or declared unrun — never neither', () => {
  const declared = new Set(declaration.unrun.map((row) => row.path));

  it('declares every authenticated spec', () => {
    const missing = authSpecs.filter((path) => !declared.has(path));
    expect(
      missing,
      'these browser specs run in no hosted job and are declared nowhere:\n  ' +
        `${missing.join('\n  ')}\nAdd them to .github/ci-baselines/unrun-test-tiers.json, or wire the tier.`
    ).toEqual([]);
  });

  it('declares NOTHING that CI actually runs', () => {
    /*
     * The inversion guard, and the reason this file is not merely a rubber
     * stamp. A declaration that could name an executed spec would be a way to
     * mark any inconvenient tier as "expected not to run" and have a gate agree.
     */
    const stray = declaration.unrun.filter((row) => !row.path.includes('/authenticated/'));
    expect(
      stray.map((r) => r.path),
      'the declaration names a spec outside the gated directory; that spec does run'
    ).toEqual([]);
    for (const path of anonymousSpecs) {
      expect(declared.has(path), `${path} runs in CI and is declared unrun`).toBe(false);
    }
  });

  it('names no spec that no longer exists', () => {
    // The register-rot direction: a declaration must not go on excusing a file
    // somebody deleted.
    const ghosts = declaration.unrun.filter((row) => !existsSync(join(ROOT, row.path)));
    expect(
      ghosts.map((r) => r.path),
      'a declared spec is absent from the tree'
    ).toEqual([]);
  });
});

describe('a declaration states a debt, not a dispensation', () => {
  it('gives every entry all five required statements and an owner', () => {
    const gaps: string[] = [];
    for (const row of declaration.unrun) {
      for (const field of [
        'id',
        'path',
        'whatItProves',
        'whatIsUnprovenWithoutIt',
        'whyItCannotRunHosted',
        'compensatingControl',
        'owner',
        'reviewBy',
      ] as const) {
        const value = row[field];
        if (typeof value !== 'string' || value.trim().length < 3) {
          gaps.push(`${row.id ?? row.path}.${field} is blank or trivial`);
        }
      }
      // A reason has to be a reason. "N/A" and one-word entries are how an
      // exception register turns into a list of paths.
      if (
        typeof row.whatIsUnprovenWithoutIt === 'string' &&
        row.whatIsUnprovenWithoutIt.length < 40
      ) {
        gaps.push(`${row.id} does not say what is unproven in enough words to be checkable`);
      }
    }
    expect(gaps).toEqual([]);
  });

  it('has not passed its own review date', () => {
    // A standing exemption with no expiry is a permanent one. When this fires,
    // somebody looks at the arrangement again — which is the point.
    const now = Date.now();
    for (const row of declaration.unrun) {
      const when = new Date(row.reviewBy);
      expect(Number.isNaN(when.getTime()), `${row.id} reviewBy is not a date`).toBe(false);
      expect(
        when.getTime(),
        `${row.id} passed its review date (${row.reviewBy}); wire the tier or re-argue the entry`
      ).toBeGreaterThan(now);
    }
  });

  it('uses ids that are unique, so an entry cannot be silently duplicated or lost', () => {
    const ids = declaration.unrun.map((r) => r.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(new Set(declaration.unrun.map((r) => r.path)).size).toBe(declaration.unrun.length);
  });
});

describe('the gap is LOUD, not merely recorded', () => {
  /*
   * A committed JSON file nobody reads is exactly the failure being fixed. Three
   * separate surfaces must carry it, and each is asserted here.
   */
  const nodeQuality = readFileSync(join(WORKFLOWS, '_reusable-node-quality.yml'), 'utf8');

  it('the hosted web job reads the declaration and annotates every entry', () => {
    expect(nodeQuality, 'the hosted job does not read the declaration').toContain(
      '.github/ci-baselines/unrun-test-tiers.json'
    );
    expect(nodeQuality, 'the entries produce no warning annotation').toContain('::warning file=');
  });

  it('the hosted web job renders it into the summary a reviewer reads', () => {
    expect(nodeQuality).toContain('unrun-tiers.md');
    const summaryLoop = nodeQuality
      .split('\n')
      .find((line) => line.includes('for file in') && line.includes('tests-web.md'));
    expect(summaryLoop, 'no job-summary loop was found').toBeTruthy();
    expect(summaryLoop, 'the unrun-tier table is written and never shown').toContain(
      'unrun-tiers.md'
    );
  });

  it('the Playwright config says it at the point of the run', () => {
    const config = readFileSync(CONFIG, 'utf8');
    expect(config, 'a local or CI run prints nothing about the tier it is skipping').toContain(
      'AUTHENTICATED browser tier is not running'
    );
    expect(config).toContain('unrun-test-tiers.json');
  });

  it('names the two specs the finding is about, so they cannot be quietly dropped', () => {
    const declared = declaration.unrun.map((r) => r.path);
    expect(declared).toContain('apps/web/tests/e2e/authenticated/isolation.spec.ts');
    expect(declared).toContain('apps/web/tests/e2e/authenticated/accessibility.spec.ts');
    const isolation = declaration.unrun.find((r) => r.path.endsWith('isolation.spec.ts'));
    expect(isolation?.whatIsUnprovenWithoutIt).toMatch(/tenant isolation/i);
  });
});
