import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE AUTHENTICATED BROWSER TIER, AND EXACTLY HOW FAR ITS REPAYMENT GOES.
 *
 * ## The finding this file was written for
 *
 * `apps/web/playwright.config.ts` gates `tests/e2e/authenticated/**` behind
 * `ROOTLCO_E2E_AUTH === '1'`, and the five anonymous projects carry `testIgnore`
 * for that directory. For the whole of P1-27 no workflow set that variable, so
 * `isolation.spec.ts` — the repository's only end-to-end tenant-isolation proof
 * — and `accessibility.spec.ts` — its only route-level accessibility proof — had
 * never executed on a hosted runner, while the browser check reported green and
 * the phase records counted browser coverage.
 *
 * ## What changed, and why the first version of this file was wrong about it
 *
 * This file used to assert that NO workflow sets the variable, and explained
 * that the tier "needs three things a hosted runner is not given". That
 * explanation was false. A hosted runner has Docker; the Supabase CLI is a
 * devDependency of this repository; `scripts/dev/owner-acceptance/context.mjs`
 * guards on an opt-in value, a loopback database and a loopback identity
 * provider, all three of which a runner can satisfy. The tier was unrun because
 * nobody had wired it, not because it could not be wired.
 *
 * It is wired now — `.github/workflows/protected-develop-verification.yml`, job
 * `authenticated-browser` — and the cases below are inverted accordingly: the
 * wiring itself is now the thing that must not disappear.
 *
 * ## What is still owed, and is therefore still asserted
 *
 * The job runs on protected pushes, NOT on the pull-request gate, and it is not
 * in `protected-gate`'s `needs` — so a gate can be green while it is red. That
 * is a real remaining hole, so the declaration stays and every field of it is
 * held here. When the job is finally governed by the gate, the case at the end
 * of this file requires the declaration to be deleted in the same commit: a
 * debt must not outlive its repayment.
 */

const ROOT = process.cwd();
const E2E = join(ROOT, 'apps', 'web', 'tests', 'e2e');
const DECLARATION = join(ROOT, '.github', 'ci-baselines', 'unrun-test-tiers.json');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const CONFIG = join(ROOT, 'apps', 'web', 'playwright.config.ts');

/** The one workflow allowed to run the tier, and the job inside it. */
const RUNNER_WORKFLOW = 'protected-develop-verification.yml';
const RUNNER_JOB = 'authenticated-browser';

interface Unrun {
  readonly id: string;
  readonly path: string;
  readonly whatItProves: string;
  readonly whatIsUnprovenWithoutIt: string;
  readonly whyThePullRequestGateDoesNotRunIt: string;
  readonly executedBy: string;
  readonly remainingDebt: string;
  readonly compensatingControl: string;
  readonly owner: string;
  readonly reviewBy: string;
}

const declaration = JSON.parse(readFileSync(DECLARATION, 'utf8')) as {
  unrun: Unrun[];
  notYetObservedOnARunner?: string;
  howToClose?: string;
};

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

const workflowNames = readdirSync(WORKFLOWS).filter((n) => /\.ya?ml$/.test(n));
const workflowSources = new Map(
  workflowNames.map((name) => [name, readFileSync(join(WORKFLOWS, name), 'utf8')] as const)
);
const workflowSource = [...workflowSources.values()].join('\n');

/**
 * One workflow with every comment line removed.
 *
 * A scanner that reads prose as code has been this repository's recurring
 * mistake, and this file walked straight into it once already: the step added to
 * ANNOUNCE that nothing sets `ROOTLCO_E2E_AUTH` mentions the name in its own
 * explanatory comment, and the first version of the case below read that as CI
 * setting the variable. The comment is the record of the decision; deleting it
 * to satisfy a check would be the wrong repair.
 *
 * Comment lines go; then a set is `NAME:` or `NAME=`, which prose is not.
 */
function code(source: string): string {
  return source
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');
}

const workflowCode = code(workflowSource);
const setsVariableIn = (source: string, name: string) =>
  new RegExp(`${name}\\s*[:=]`).test(code(source));
const setsVariable = (name: string) => new RegExp(`${name}\\s*[:=]`).test(workflowCode);

/** The body of one top-level job, from its key to the next two-space key. */
function jobBody(source: string, job: string): string | null {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => new RegExp(`^ {2}${job}:\\s*$`).test(line));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}[a-z][a-z0-9-]*:\s*$/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

describe('the facts, established from the files that decide them', () => {
  it('finds spec files on both sides of the gate', () => {
    // Anti-vacuity first: every case below reasons about these two lists.
    expect(authSpecs.length, 'no authenticated specs were found').toBeGreaterThan(3);
    expect(anonymousSpecs.length, 'no anonymous specs were found').toBeGreaterThan(0);
  });

  it('the Playwright config still gates the authenticated tier behind the variable', () => {
    const config = readFileSync(CONFIG, 'utf8');
    expect(config).toContain("process.env.ROOTLCO_E2E_AUTH === '1'");
    expect(
      config,
      'the anonymous projects no longer exclude the authenticated directory'
    ).toContain('testIgnore: AUTH_DIR');
  });

  it('judges an ASSIGNMENT, not a mention — the scanner-reads-prose trap', () => {
    // Pinned so a repair cannot regress into "delete the sentence". A variable
    // CI really does set is seen; one named only in prose is not.
    expect(setsVariable('NEXT_TELEMETRY_DISABLED')).toBe(true);
    expect(
      setsVariableIn('# ROOTLCO_MADE_UP_NAME: 1', 'ROOTLCO_MADE_UP_NAME'),
      'a commented-out assignment must not read as an assignment'
    ).toBe(false);
  });

  it('the anonymous tier IS invoked, so the gap was always a gap and not the whole tier', () => {
    expect(workflowSource).toContain('npm run test:web-e2e');
  });
});

describe('the tier is wired, and the wiring is what must not disappear', () => {
  const runner = workflowSources.get(RUNNER_WORKFLOW) as string;

  it('the workflow that runs it exists and declares the job', () => {
    expect(runner, `${RUNNER_WORKFLOW} is missing`).toBeTruthy();
    expect(
      jobBody(runner, RUNNER_JOB),
      `${RUNNER_WORKFLOW} declares no ${RUNNER_JOB} job`
    ).toBeTruthy();
  });

  it('that job SETS the variable and INVOKES the authenticated projects', () => {
    const body = jobBody(runner, RUNNER_JOB) as string;
    expect(
      setsVariableIn(body, 'ROOTLCO_E2E_AUTH'),
      `${RUNNER_JOB} no longer sets ROOTLCO_E2E_AUTH, so the tier it claims to run is skipped`
    ).toBe(true);
    expect(code(body), `${RUNNER_JOB} no longer invokes the authenticated projects`).toContain(
      'npm run test:web-e2e-authenticated'
    );
  });

  it('it stands the real stack up rather than faking a session', () => {
    const body = code(jobBody(runner, RUNNER_JOB) as string);
    // Each of these is a precondition the tier genuinely has. A job that
    // dropped any one of them would still "run" and would prove nothing.
    for (const required of [
      'supabase start',
      'npm run acceptance:create-owner',
      'npm run build:web',
      'npm run build:api',
      '/api/v1/health/ready',
    ]) {
      expect(body, `${RUNNER_JOB} no longer performs: ${required}`).toContain(required);
    }
  });

  it('it fails when the tier collects nothing — a green run that ran nothing', () => {
    const body = code(jobBody(runner, RUNNER_JOB) as string);
    /*
     * The single most important assertion in this file. Wiring a tier that
     * silently collects zero specs is strictly worse than declaring it unrun,
     * because the declaration at least told the truth.
     */
    expect(body, 'the job does not read the Playwright report').toContain('playwright-report.json');
    expect(body, 'the job does not fail on a zero-test run').toMatch(/total === 0/);
    expect(body, 'the job does not derive what ran from the spec directory').toContain(
      'authenticated'
    );
  });

  it('NO OTHER workflow runs the tier, and the pull-request gate in particular does not', () => {
    /*
     * The inversion, in its new direction. `pr-ci.yml` and every reusable
     * workflow it calls must stay clear of the tier: a forty-minute Docker stack
     * on the merge gate is a different decision from this one and must be taken
     * deliberately, not inherited by a stray copy-paste.
     */
    for (const [name, source] of workflowSources) {
      if (name === RUNNER_WORKFLOW) continue;
      expect(
        setsVariableIn(source, 'ROOTLCO_E2E_AUTH'),
        `${name} now sets ROOTLCO_E2E_AUTH; only ${RUNNER_WORKFLOW} may`
      ).toBe(false);
      expect(
        code(source).includes('test:web-e2e-authenticated'),
        `${name} now invokes the authenticated tier; only ${RUNNER_WORKFLOW} may`
      ).toBe(false);
    }
  });

  it('the explanation survives in prose even though it is no longer a finding', () => {
    // The comment that says WHY the variable exists and what it gates is the
    // record of the decision. It must remain readable in the workflows.
    expect(
      workflowSource.includes('ROOTLCO_E2E_AUTH'),
      'the workflows no longer explain the gated tier at all'
    ).toBe(true);
  });
});

describe('every spec is either covered by a gate or declared — never neither', () => {
  const declared = new Set(declaration.unrun.map((row) => row.path));

  it('declares every authenticated spec while no gate governs the job that runs them', () => {
    const missing = authSpecs.filter((path) => !declared.has(path));
    expect(
      missing,
      'these browser specs are outside every gate and are declared nowhere:\n  ' +
        `${missing.join('\n  ')}\nAdd them to .github/ci-baselines/unrun-test-tiers.json, or put the job under a gate.`
    ).toEqual([]);
  });

  it('declares NOTHING that the pull-request gate actually runs', () => {
    /*
     * The original inversion guard, unchanged in purpose: a declaration that
     * could name an executed spec would be a way to mark any inconvenient tier
     * as "expected not to run" and have a gate agree.
     */
    const stray = declaration.unrun.filter((row) => !row.path.includes('/authenticated/'));
    expect(
      stray.map((r) => r.path),
      'the declaration names a spec outside the gated directory; that spec does run on a pull request'
    ).toEqual([]);
    for (const path of anonymousSpecs) {
      expect(
        declared.has(path),
        `${path} runs on the pull-request gate and is declared unrun`
      ).toBe(false);
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
  it('gives every entry all of its required statements and an owner', () => {
    const gaps: string[] = [];
    for (const row of declaration.unrun) {
      for (const field of [
        'id',
        'path',
        'whatItProves',
        'whatIsUnprovenWithoutIt',
        'whyThePullRequestGateDoesNotRunIt',
        'executedBy',
        'remainingDebt',
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

  it('names an executing job that really exists, in a workflow that really exists', () => {
    /*
     * The field that turns this file from a debt register into a pointer at
     * evidence. If it named a job nobody wired, the declaration would read as a
     * repayment while nothing had been repaid — which is the exact failure the
     * previous version of this file committed in prose.
     */
    for (const row of declaration.unrun) {
      expect(row.executedBy, `${row.id} must name the workflow that runs it`).toContain(
        RUNNER_WORKFLOW
      );
      expect(row.executedBy, `${row.id} must name the job that runs it`).toContain(RUNNER_JOB);
    }
    const runner = workflowSources.get(RUNNER_WORKFLOW) as string;
    expect(jobBody(runner, RUNNER_JOB), 'the named job does not exist').toBeTruthy();
  });

  it('says out loud that the job has not yet been observed on a runner', () => {
    // Wiring a job is not the same as having watched it pass, and claiming the
    // second on the strength of the first is how this phase got here.
    expect(
      declaration.notYetObservedOnARunner,
      'the declaration no longer states the observation status of the job it points at'
    ).toBeTruthy();
    expect(String(declaration.notYetObservedOnARunner).length).toBeGreaterThan(80);
  });

  it('records how the remaining debt is repaid, naming what has to change', () => {
    expect(String(declaration.howToClose)).toContain('evaluate-ci-gate.mjs');
    expect(String(declaration.howToClose)).toContain('pull-request-body.md');
    for (const row of declaration.unrun) {
      expect(row.remainingDebt, `${row.id} does not say what is still owed`).toMatch(
        /protected-gate|needs/i
      );
    }
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
        `${row.id} passed its review date (${row.reviewBy}); govern the job or re-argue the entry`
      ).toBeGreaterThan(now);
    }
  });

  it('uses ids that are unique, so an entry cannot be silently duplicated or lost', () => {
    const ids = declaration.unrun.map((r) => r.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
    expect(new Set(declaration.unrun.map((r) => r.path)).size).toBe(declaration.unrun.length);
  });
});

describe('the debt must not outlive its repayment', () => {
  const runner = workflowSources.get(RUNNER_WORKFLOW) as string;
  const gate = jobBody(runner, 'protected-gate') ?? '';
  const governed = new RegExp(`^\\s*-\\s+${RUNNER_JOB}\\s*$`, 'm').test(gate);

  it('the declaration is deleted in the same commit that puts the job under a gate', () => {
    /*
     * The forward direction, so this file cannot become a permanent excuse. On
     * the day `authenticated-browser` joins `protected-gate`'s `needs`, a gate
     * governs the result and there is nothing left to declare — this case fails
     * until the entries go.
     */
    if (governed) {
      expect(
        declaration.unrun.filter((row) => row.path.includes('/authenticated/')).map((r) => r.path),
        `${RUNNER_JOB} is now in protected-gate needs, so the unrun declaration must be deleted`
      ).toEqual([]);
    } else {
      expect(
        declaration.unrun.length,
        'nothing is declared and no gate governs the job'
      ).toBeGreaterThan(0);
    }
  });

  it('states the gate blindness rather than leaving a reader to discover it', () => {
    if (governed) return;
    const body = jobBody(runner, RUNNER_JOB) as string;
    expect(
      body + workflowSource.slice(0, workflowSource.indexOf(RUNNER_JOB)),
      'nothing in the workflow says that protected-gate does not govern this job'
    ).toContain('protected-gate');
  });
});

describe('the gap is LOUD, not merely recorded', () => {
  /*
   * A committed JSON file nobody reads is exactly the failure being fixed. The
   * surfaces that carry it are asserted here.
   */
  const nodeQuality = readFileSync(join(WORKFLOWS, '_reusable-node-quality.yml'), 'utf8');

  it('the hosted web job reads the declaration and annotates every entry', () => {
    expect(nodeQuality, 'the hosted job does not read the declaration').toContain(
      '.github/ci-baselines/unrun-test-tiers.json'
    );
    expect(nodeQuality, 'the entries produce no warning annotation').toContain('::warning file=');
  });

  it('the web job names the job that DOES run the tier, so the gap is not read as an absence', () => {
    expect(nodeQuality, 'the summary no longer points at the executing job').toContain(
      'row.executedBy'
    );
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
