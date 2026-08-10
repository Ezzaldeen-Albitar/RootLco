import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * THE AUTHENTICATED BROWSER TIER, AND THE STATE ITS REPAYMENT HAS REACHED.
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
 * ## Two repairs, and this file has now seen both
 *
 * FIRST the tier was WIRED — a hosted job stood the stack up and ran it. This
 * file was inverted then: the wiring became the thing that must not disappear.
 *
 * SECOND, and this is the change these cases are written against, the tier
 * became GOVERNED. The wiring was not enough and this file said so in prose: the
 * job was in no gate's `needs`, so `protected-gate` could report **Go** while
 * this check was red, and `pr-ci.yml` did not run the tier at all. The job body
 * now lives in `_reusable-authenticated-browser.yml`, both workflows call it,
 * and `authenticated-browser` is in the `needs` of both `ci-gate` and
 * `protected-gate`. The debt entries in
 * `.github/ci-baselines/unrun-test-tiers.json` are therefore gone, which is what
 * the last describe in this file has always required of the day this happened.
 *
 * ## What is NOT claimed
 *
 * That the tier has been observed to pass. It has not — its only hosted
 * execution failed on a readiness race in the acceptance bootstrap before it
 * collected a single test. Governing a check that has never gone green is the
 * correct order of operations, and `hostedObservation` in the declaration says
 * so in the same words. Nothing here reads "the job is governed" as "the job
 * works".
 *
 * ## The fork boundary, which arrived with the governance
 *
 * The tier stands a full Supabase stack, a production API and a real operator
 * account up on the runner. A fork pull request must not receive that, so
 * `pr-ci.yml` gates the job on the head being a branch of this repository — and
 * the gate is TOLD, so an ineligible skip is recorded as
 * `NOT_ELIGIBLE_FOR_SECURITY_REASON` rather than inferred from a missing result.
 * Both halves are asserted below, because either alone is a hole: the condition
 * without the statement is a silent pass, and the statement without the
 * condition is a fork running privileged code.
 */

const ROOT = process.cwd();
const E2E = join(ROOT, 'apps', 'web', 'tests', 'e2e');
const DECLARATION = join(ROOT, '.github', 'ci-baselines', 'unrun-test-tiers.json');
const WORKFLOWS = join(ROOT, '.github', 'workflows');
const CONFIG = join(ROOT, 'apps', 'web', 'playwright.config.ts');

/** The one workflow that holds the tier's body, and the job inside it. */
const RUNNER_WORKFLOW = '_reusable-authenticated-browser.yml';
const RUNNER_JOB = 'authenticated-browser';

/** The workflows allowed to CALL it, and the gate job each one must hang it off. */
const CALLERS: readonly { workflow: string; gate: string }[] = [
  { workflow: 'pr-ci.yml', gate: 'ci-gate' },
  { workflow: 'protected-develop-verification.yml', gate: 'protected-gate' },
];

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

interface Governed {
  readonly since: string;
  readonly executedBy: string;
  readonly governedBy: string;
  readonly forkPolicy: string;
  readonly specs: readonly string[];
}

const declaration = JSON.parse(readFileSync(DECLARATION, 'utf8')) as {
  unrun: Unrun[];
  governed?: Governed;
  hostedObservation?: string;
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

/** True when `gate`'s `needs:` list in `source` contains `job`. */
function gateNeeds(source: string, gate: string, job: string): boolean {
  const body = jobBody(source, gate);
  if (body === null) return false;
  return new RegExp(`^\\s*-\\s+${job}\\s*$`, 'm').test(code(body));
}

/** The single fact every case below branches on: is the job under a gate? */
const governed = CALLERS.every(({ workflow, gate }) =>
  gateNeeds(workflowSources.get(workflow) ?? '', gate, RUNNER_JOB)
);

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

  it('NO OTHER workflow runs the tier — the callers delegate, they do not copy', () => {
    /*
     * The inversion, in its third direction. The body exists ONCE. A second copy
     * of forty lines of Docker orchestration is how two copies drift apart, and
     * the two callers must reach the tier by `uses:` rather than by paste.
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

  it('every caller reaches it by `uses:`, and both callers exist', () => {
    for (const { workflow } of CALLERS) {
      const source = workflowSources.get(workflow);
      expect(source, `${workflow} is missing`).toBeTruthy();
      const body = jobBody(source as string, RUNNER_JOB);
      expect(body, `${workflow} declares no ${RUNNER_JOB} job`).toBeTruthy();
      expect(code(body as string), `${workflow} does not call ${RUNNER_WORKFLOW}`).toContain(
        `uses: ./.github/workflows/${RUNNER_WORKFLOW}`
      );
    }
  });

  it('is reachable BEFORE a merge, and pinned to a commit when it is', () => {
    /*
     * The ordering finding. A tier that only ran on a protected push could
     * produce evidence only AFTER the merge, so a phase would have had to
     * merge work in order to learn whether the work was sound.
     *
     * There are two pre-merge paths now — the pull-request gate itself, and a
     * dispatch of any branch — and each is asserted where it lives. The
     * comparison that makes a dispatch quotable lives in the reusable workflow,
     * because that is where the commit is finally known.
     */
    const protectedWorkflow = workflowSources.get('protected-develop-verification.yml') as string;
    const trigger = protectedWorkflow.slice(0, protectedWorkflow.indexOf('concurrency:'));
    expect(trigger, 'the pre-merge dispatch trigger is gone').toContain('workflow_dispatch:');
    expect(trigger, 'the dispatch no longer takes the candidate commit').toContain(
      'candidate-sha:'
    );

    const caller = jobBody(protectedWorkflow, RUNNER_JOB) as string;
    expect(caller, 'the caller no longer forwards the requested commit').toContain(
      'inputs.candidate-sha'
    );

    const body = jobBody(workflowSources.get(RUNNER_WORKFLOW) as string, RUNNER_JOB) as string;
    expect(body, 'the job no longer reads the requested commit').toContain('inputs.expected-sha');
    /*
     * The comparison is against the commit the CHECKOUT resolved, not against
     * `github.sha`. That is not cosmetic: on a `pull_request` event `github.sha`
     * is the MERGE ref — a commit in no branch — so the previous form was sound
     * for a dispatch and would have been false for every pull request, which is
     * exactly the event the job was about to be added to.
     */
    expect(body, 'the job no longer reads the commit it actually checked out').toContain(
      'steps.setup.outputs.sha'
    );
    /*
     * ONE LINE, not the whole body. An earlier version of this assertion used
     * `.*` under the `s` flag, so the two names and the `!=` were allowed to
     * come from three different steps — and they did. Deleting the comparison
     * entirely left that assertion passing.
     */
    expect(
      code(body),
      'the job no longer compares the requested commit against the resolved one on a single line, so a moved ref would be reported as the commit that was asked for'
    ).toMatch(/REQUESTED_SHA[^\n]*!=[^\n]*RESOLVED_SHA|RESOLVED_SHA[^\n]*!=[^\n]*REQUESTED_SHA/);
  });

  it('keeps the protected-push path as the post-merge reproof', () => {
    // The pre-merge run is additional evidence, never a replacement. A gate
    // record quotes the protected run, so losing this trigger while gaining
    // the dispatch would trade one hole for another.
    const protectedWorkflow = workflowSources.get('protected-develop-verification.yml') as string;
    const trigger = protectedWorkflow.slice(0, protectedWorkflow.indexOf('concurrency:'));
    expect(trigger, 'the protected push trigger is gone').toMatch(/push:/);
    expect(trigger, 'the protected branches are no longer named').toMatch(
      /branches:\s*\[develop,\s*main\]/
    );
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

describe('a gate WAITS for the result — the whole point of the second repair', () => {
  it('both gates list the job in `needs`', () => {
    for (const { workflow, gate } of CALLERS) {
      expect(
        gateNeeds(workflowSources.get(workflow) ?? '', gate, RUNNER_JOB),
        `${gate} in ${workflow} does not depend on ${RUNNER_JOB}, so it can report Go while the ` +
          "repository's only end-to-end tenant-isolation proof is red"
      ).toBe(true);
    }
    expect(governed, 'the derived governance flag disagrees with the assertions above').toBe(true);
  });

  it('the gate evaluator declares it, and declares it unconditionally required', async () => {
    const { DECLARED_JOBS } = (await import('../../scripts/ci/evaluate-ci-gate.mjs')) as {
      DECLARED_JOBS: Array<{ id: string; alwaysRequired: boolean; securityEligibility?: string }>;
    };
    const row = DECLARED_JOBS.find((j) => j.id === RUNNER_JOB);
    expect(row, `${RUNNER_JOB} is not in DECLARED_JOBS, so the gate is blind to it`).toBeDefined();
    expect(row?.alwaysRequired, `${RUNNER_JOB} must never be skippable on a technicality`).toBe(
      true
    );
    expect(
      row?.securityEligibility,
      `${RUNNER_JOB} must declare the one condition under which it may be absent`
    ).toBeTruthy();
  });
});

describe('a fork gets no privileged execution, and the gate is TOLD rather than left to guess', () => {
  const pr = workflowSources.get('pr-ci.yml') as string;

  it('the pull-request job runs only for a same-repository head', () => {
    const body = code(jobBody(pr, RUNNER_JOB) as string);
    expect(
      body,
      'the authenticated-browser job on the pull-request gate carries no trust condition, so a ' +
        'fork pull request would stand a privileged Supabase stack and a real account up'
    ).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('the gate is given the SAME condition, so it cannot disagree with the workflow', () => {
    const gate = code(jobBody(pr, 'ci-gate') as string);
    expect(gate, 'ci-gate is not told whether this run was eligible').toContain(
      '--trusted-context'
    );
    expect(
      gate,
      'ci-gate derives eligibility from something other than the condition that decides the job'
    ).toContain('github.event.pull_request.head.repo.full_name == github.repository');
  });

  it('the protected gate states the eligibility positively rather than omitting it', () => {
    /*
     * An omitted statement fails a skip closed, which is correct — but on a
     * protected push there is no untrusted path at all, so leaving it unstated
     * would mean the gate could only ever fail on a skip and never explain why.
     * The workflow says `true` because that is a fact about the event.
     */
    const protectedWorkflow = workflowSources.get('protected-develop-verification.yml') as string;
    const gate = code(jobBody(protectedWorkflow, 'protected-gate') as string);
    expect(gate, 'protected-gate makes no eligibility statement').toMatch(
      /--trusted-context\s+true/
    );
  });

  it('there is nothing for a fork to be given — the tier reads no repository secret', () => {
    /*
     * The `if:` is the boundary that matters, but it is not the only thing worth
     * asserting: a job that consumed a repository secret would make the boundary
     * load-bearing in a way a single expression should never be. This tier is
     * self-contained — every credential it uses is issued by the Supabase stack
     * it starts and dies with the runner — so the fork refusal is about denying
     * privileged EXECUTION, not about protecting a value.
     *
     * `secrets: inherit` on either caller would be the regression, and it would
     * be invisible: the job would keep working and a fork would keep skipping.
     */
    const runner = workflowSources.get(RUNNER_WORKFLOW) as string;
    expect(
      code(runner),
      `${RUNNER_WORKFLOW} now reads a repository secret; this tier must stay self-contained`
    ).not.toMatch(/secrets\./);
    expect(code(runner), `${RUNNER_WORKFLOW} now declares a secrets input`).not.toMatch(
      /^\s{4,}secrets:\s*$/m
    );
    for (const { workflow } of CALLERS) {
      const body = code(jobBody(workflowSources.get(workflow) as string, RUNNER_JOB) as string);
      expect(body, `${workflow} passes secrets into the tier`).not.toMatch(/secrets:/);
    }
  });

  it('the three states are named where the decision is made', async () => {
    const { STATE } = (await import('../../scripts/ci/evaluate-ci-gate.mjs')) as {
      STATE: Record<string, string>;
    };
    expect(Object.values(STATE)).toContain('REQUIRED_AND_PASSED');
    expect(Object.values(STATE)).toContain('REQUIRED_AND_FAILED');
    expect(Object.values(STATE)).toContain('NOT_ELIGIBLE_FOR_SECURITY_REASON');
  });
});

describe('every spec is either covered by a gate or declared — never neither', () => {
  const declared = new Set(declaration.unrun.map((row) => row.path));

  it('covers every authenticated spec, by a gate if governed and by a declaration if not', () => {
    if (governed) {
      const listed = new Set(declaration.governed?.specs ?? []);
      const missing = authSpecs.filter((path) => !listed.has(path));
      expect(
        missing,
        'these browser specs are executed by no named governed spec list and declared nowhere:\n  ' +
          `${missing.join('\n  ')}`
      ).toEqual([]);
      const ghosts = (declaration.governed?.specs ?? []).filter(
        (path) => !authSpecs.includes(path)
      );
      expect(ghosts, 'the governed list names a spec that does not exist').toEqual([]);
      return;
    }
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
     * repayment while nothing had been repaid.
     *
     * It applies to whichever block is populated: the debt entries while there
     * are any, and the `governed` block once there are not.
     */
    for (const row of declaration.unrun) {
      expect(row.executedBy, `${row.id} must name the workflow that runs it`).toContain(
        RUNNER_WORKFLOW
      );
      expect(row.executedBy, `${row.id} must name the job that runs it`).toContain(RUNNER_JOB);
    }
    if (governed) {
      const g = declaration.governed;
      expect(g, 'the job is governed and the declaration records nothing about it').toBeDefined();
      expect(g?.executedBy, 'the governed block names no workflow').toContain(RUNNER_WORKFLOW);
      expect(g?.executedBy, 'the governed block names no job').toContain(RUNNER_JOB);
      for (const { gate } of CALLERS) {
        expect(g?.governedBy, `the governed block does not name ${gate}`).toContain(gate);
      }
      expect(
        g?.forkPolicy,
        'the governed block does not state what a fork pull request receives'
      ).toMatch(/fork/i);
    }
    const runner = workflowSources.get(RUNNER_WORKFLOW) as string;
    expect(jobBody(runner, RUNNER_JOB), 'the named job does not exist').toBeTruthy();
  });

  it('states the observation status, and cites a run rather than asserting one', () => {
    /*
     * Wiring a job is not the same as having watched it run, and GOVERNING one
     * is not either. Claiming an observation on the strength of a `needs:` line
     * is the same defect the previous version of this file committed in prose.
     *
     * The field must carry a checkable citation: a run id and a full commit, so
     * a reader can open the run instead of taking the sentence on trust.
     */
    const observation = String(declaration.hostedObservation ?? '');
    expect(observation, 'the declaration no longer states the observation status').toBeTruthy();
    expect(observation.length).toBeGreaterThan(80);
    expect(observation, 'the observation cites no run id').toMatch(/\b\d{9,}\b/);
    expect(observation, 'the observation cites no full commit sha').toMatch(/\b[0-9a-f]{40}\b/);
  });

  it('records how the debt was, or is to be, repaid — naming what has to change', () => {
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
  it('the declaration is deleted in the same commit that puts the job under a gate', () => {
    /*
     * The forward direction, so this file cannot become a permanent excuse. On
     * the day `authenticated-browser` joined both gates' `needs`, a gate governs
     * the result and there is nothing left to declare — this case fails until
     * the entries go, and fails again if anybody puts one back.
     */
    if (governed) {
      expect(
        declaration.unrun.filter((row) => row.path.includes('/authenticated/')).map((r) => r.path),
        `${RUNNER_JOB} is in both gates' needs, so the unrun declaration must be deleted`
      ).toEqual([]);
    } else {
      expect(
        declaration.unrun.length,
        'nothing is declared and no gate governs the job'
      ).toBeGreaterThan(0);
    }
  });

  it('states the gate blindness INSIDE the job, while there is any to state', () => {
    if (governed) return;
    /*
     * This used to accept the sentence anywhere in `body` OR in everything
     * preceding the first mention of the job name across every joined workflow.
     * That prefix was not a place — it moved. The requirement was always that
     * the reader of the job sees it, so the assertion is the job body alone.
     */
    const runner = workflowSources.get(RUNNER_WORKFLOW) as string;
    const body = jobBody(runner, RUNNER_JOB) as string;
    expect(body, 'the job block itself does not say that no gate governs it').toContain(
      'protected-gate'
    );
  });
});

describe('the gap is LOUD, not merely recorded', () => {
  /*
   * A committed JSON file nobody reads is exactly the failure being fixed. The
   * surfaces that carry it are asserted here. The tier is governed now, so what
   * the web job renders is the repayment rather than the debt — but it must
   * still RENDER, because "the anonymous tier is not the whole browser tier" is
   * a fact a reader of a green web job still needs.
   */
  const nodeQuality = readFileSync(join(WORKFLOWS, '_reusable-node-quality.yml'), 'utf8');

  it('the hosted web job reads the declaration', () => {
    expect(nodeQuality, 'the hosted job does not read the declaration').toContain(
      '.github/ci-baselines/unrun-test-tiers.json'
    );
  });

  it('it can still annotate a re-declared entry', () => {
    // The warning path must survive the repayment. If a tier is ever declared
    // unrun again, the annotation is how a reviewer learns without opening JSON.
    expect(nodeQuality, 'the entries would produce no warning annotation').toContain(
      '::warning file='
    );
  });

  it('it names the job that DOES run the tier, so the gap is not read as an absence', () => {
    expect(nodeQuality, 'the summary no longer points at the executing job').toMatch(
      /row\.executedBy|governed\.executedBy/
    );
  });

  it('it renders the file it writes into the summary a reviewer reads', () => {
    expect(nodeQuality).toContain('unrun-tiers.md');
    const summaryLoop = nodeQuality
      .split('\n')
      .find((line) => line.includes('for file in') && line.includes('tests-web.md'));
    expect(summaryLoop, 'no job-summary loop was found').toBeTruthy();
    expect(summaryLoop, 'the unrun-tier table is written and never shown').toContain(
      'unrun-tiers.md'
    );
  });

  it('reads the observation field that actually exists', () => {
    /*
     * It interpolated `doc.notYetObservedOnARunner` after that field had been
     * renamed to `hostedObservation`, so the job summary rendered the literal
     * word `undefined` where the observation status belongs — a stale reference
     * that no gate could see because a summary is prose.
     */
    expect(nodeQuality, 'the summary reads a field the declaration does not have').not.toContain(
      'notYetObservedOnARunner'
    );
    expect(nodeQuality, 'the summary no longer renders the observation status').toContain(
      'doc.hostedObservation'
    );
    expect(
      declaration.hostedObservation,
      'the declaration does not carry the field the summary reads'
    ).toBeTruthy();
  });

  it('the Playwright config says it at the point of the run', () => {
    const config = readFileSync(CONFIG, 'utf8');
    expect(config, 'a local or CI run prints nothing about the tier it is skipping').toContain(
      'AUTHENTICATED browser tier is not running'
    );
    expect(config).toContain('unrun-test-tiers.json');
  });

  it('names the two specs the finding is about, so they cannot be quietly dropped', () => {
    const named = governed
      ? (declaration.governed?.specs ?? [])
      : declaration.unrun.map((r) => r.path);
    expect(named).toContain('apps/web/tests/e2e/authenticated/isolation.spec.ts');
    expect(named).toContain('apps/web/tests/e2e/authenticated/accessibility.spec.ts');
    if (!governed) {
      const isolation = declaration.unrun.find((r) => r.path.endsWith('isolation.spec.ts'));
      expect(isolation?.whatIsUnprovenWithoutIt).toMatch(/tenant isolation/i);
    }
  });
});
