/**
 * Tests for the gate that decides whether anything merges.
 *
 * `ci-gate` is the one place where "everything passed" is computed, so it is the
 * one place where being wrong is silent. Every hostile case the initiative names
 * is asserted here, and each is written so that DELETING the corresponding
 * branch in evaluate-ci-gate.mjs makes exactly one assertion fail.
 *
 * The interesting cases are not the failures — those are easy. They are:
 *
 *   - a skip that IS acceptable, because change detection said the job was not
 *     required (accepting it is what makes the pipeline cost-conscious);
 *   - a skip that is NOT acceptable, because change detection required it;
 *   - a job that vanished from `needs` because someone renamed it;
 *   - a job that appeared in `needs` that the gate does not govern.
 *
 * The last two are what break a job-name-shaped required-check list, which is
 * exactly what this gate replaces.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evaluate,
  DECLARED_JOBS,
  toMarkdown,
  acceptableResults,
  STATE,
} from '../../scripts/ci/evaluate-ci-gate.mjs';

type JobResult = 'success' | 'failure' | 'cancelled' | 'skipped';

/** A `needs` context in which every declared job succeeded. */
function allSucceeded(
  overrides: Record<string, JobResult> = {}
): Record<string, { result: string }> {
  const needs: Record<string, { result: string }> = {};
  for (const job of DECLARED_JOBS as Array<{ id: string }>) {
    needs[job.id] = { result: overrides[job.id] ?? 'success' };
  }
  return needs;
}

/** A classification in which every conditional job was required. */
function classificationRequiringEverything() {
  const jobs: Record<string, { required: boolean; reason: string }> = {};
  for (const job of DECLARED_JOBS as Array<{ id: string }>) {
    jobs[job.id] = { required: true, reason: 'touched: appSource' };
  }
  return {
    files: ['apps/api/src/modules/inventory/x.ts'],
    categories: ['appSource'],
    documentationOnly: false,
    jobs,
  };
}

/** A classification in which the heavy jobs were legitimately not required. */
function documentationOnlyClassification() {
  const jobs: Record<string, { required: boolean; reason: string }> = {};
  for (const job of DECLARED_JOBS as Array<{ id: string; alwaysRequired: boolean }>) {
    jobs[job.id] = job.alwaysRequired
      ? { required: true, reason: 'always required' }
      : { required: false, reason: 'no change in appSource, database, docker' };
  }
  return { files: ['docs/x.md'], categories: ['docs'], documentationOnly: true, jobs };
}

describe('ci-gate', () => {
  it('returns Go when every declared job succeeded', () => {
    const result = evaluate(allSucceeded(), classificationRequiringEverything(), {});
    expect(result.decision).toBe('Go');
    expect(result.failures).toEqual([]);
    expect(result.jobs).toHaveLength((DECLARED_JOBS as unknown[]).length);
  });

  // --- the hostile mutations named in the initiative -----------------------
  const failingJobs = [
    'static-quality',
    'unit-tests-coverage',
    'application-build',
    'database-migration-replay',
    'database-security',
    'integration-tests',
    'dependency-security',
    'code-security',
    'container-security',
    'secret-scan',
    'hosted-clean-room',
  ] as const;

  for (const job of failingJobs) {
    it(`returns No-Go when ${job} fails`, () => {
      const result = evaluate(
        allSucceeded({ [job]: 'failure' }),
        classificationRequiringEverything(),
        {}
      );
      expect(result.decision).toBe('No-Go');
      expect(result.failures.join('\n')).toContain(job);
    });
  }

  it('returns No-Go when a required job is cancelled', () => {
    const result = evaluate(
      allSucceeded({ 'integration-tests': 'cancelled' }),
      classificationRequiringEverything(),
      {}
    );
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(/cancelled/i);
  });

  it('returns No-Go when a job reports a result nobody anticipated', () => {
    const needs = allSucceeded();
    needs['database-security'] = { result: 'neutral' };
    const result = evaluate(needs, classificationRequiringEverything(), {});
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(/ambiguous/i);
  });

  // --- skips: the whole point of change detection --------------------------
  it('accepts a skip that change detection recorded as not required', () => {
    const needs = allSucceeded({
      'application-build': 'skipped',
      'database-migration-replay': 'skipped',
      'database-security': 'skipped',
      'integration-tests': 'skipped',
      'code-security': 'skipped',
      'container-security': 'skipped',
    });
    const result = evaluate(needs, documentationOnlyClassification(), {});
    expect(result.decision).toBe('Go');
    expect(result.notes.length).toBe(6);
    expect(result.notes.join('\n')).toContain('no change in');
  });

  it('returns No-Go when a job was skipped although change detection required it', () => {
    const result = evaluate(
      allSucceeded({ 'database-security': 'skipped' }),
      classificationRequiringEverything(),
      {}
    );
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(/skipped although change detection required it/);
  });

  it('refuses a skip of an unconditionally required job even when the classification permits it', () => {
    // A classification that has been tampered with to excuse the clean room.
    const classification = documentationOnlyClassification();
    classification.jobs['hosted-clean-room'] = { required: false, reason: 'fabricated excuse' };
    const result = evaluate(allSucceeded({ 'hosted-clean-room': 'skipped' }), classification, {});
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(/unconditionally required/);
  });

  it('refuses a skip when no classification exists at all', () => {
    const result = evaluate(allSucceeded({ 'container-security': 'skipped' }), null, {});
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(
      /no classification|change detection produced no classification/i
    );
  });

  it('refuses a skip when change detection made no decision about that job', () => {
    const classification = documentationOnlyClassification();
    delete classification.jobs['container-security'];
    const result = evaluate(allSucceeded({ 'container-security': 'skipped' }), classification, {});
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(/no entry for it/);
  });

  // --- the failure that breaks a job-name-shaped required-check list -------
  it('returns No-Go when a governed job is absent from needs (renamed or removed)', () => {
    const needs = allSucceeded();
    delete needs['secret-scan'];
    const result = evaluate(needs, classificationRequiringEverything(), {});
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(/declared in the gate but absent from `needs`/);
  });

  it('returns No-Go when a job ran that the gate does not govern (newly added)', () => {
    const needs = { ...allSucceeded(), 'brand-new-job': { result: 'success' } };
    const result = evaluate(needs, classificationRequiringEverything(), {});
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(/the gate does not govern it/);
  });

  // --- exact-SHA agreement -------------------------------------------------
  it('returns No-Go when the tested SHA differs from the SHA under review', () => {
    const result = evaluate(allSucceeded(), classificationRequiringEverything(), {
      expectedSha: 'a'.repeat(40),
      actualSha: 'b'.repeat(40),
    });
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(/exact-SHA disagreement/);
  });

  it('accepts matching SHAs', () => {
    const sha = 'c'.repeat(40);
    const result = evaluate(allSucceeded(), classificationRequiringEverything(), {
      expectedSha: sha,
      actualSha: sha,
    });
    expect(result.decision).toBe('Go');
  });

  // --- the summary is evidence, so it must carry the numbers ---------------
  it('renders every job, the decision and the supplied evidence', () => {
    const markdown = toMarkdown(
      evaluate(allSucceeded(), classificationRequiringEverything(), { actualSha: 'd'.repeat(40) }),
      classificationRequiringEverything(),
      {
        'coverage-gate': { totals: { lines: { measured: 91.06 }, branches: { measured: 93.62 } } },
        'test-totals-unit': { total: 926, passed: 926, failed: 0 },
        'migration-replay': { migrations: 119, schemaHash: 'a677eb05', tablesBefore: 0 },
        'image-metadata': { digest: 'sha256:abc', sizeHuman: '210 MiB', uid: 1001 },
      }
    );
    expect(markdown).toContain('**Go**');
    expect(markdown).toContain('91.06%');
    expect(markdown).toContain('926');
    expect(markdown).toContain('119');
    expect(markdown).toContain('a677eb05');
    for (const job of DECLARED_JOBS as Array<{ id: string }>) {
      expect(markdown).toContain(job.id);
    }
  });

  it('names the failing job in the summary so the reason is not only in a log', () => {
    const markdown = toMarkdown(
      evaluate(
        allSucceeded({ 'database-security': 'failure' }),
        classificationRequiringEverything(),
        {}
      ),
      classificationRequiringEverything(),
      {}
    );
    expect(markdown).toContain('**No-Go**');
    expect(markdown).toContain('database-security');
  });

  // --- the gate must govern exactly the PR jobs ----------------------------
  it('governs exactly the jobs pr-ci.yml declares, read from the workflow itself', () => {
    // Asserting against a hardcoded list cannot see the one drift direction the
    // gate is blind to: a job ADDED to pr-ci.yml and omitted from
    // `ci-gate.needs:`. Nothing at runtime would notice, because the gate only
    // reasons about what `needs` hands it. So this reads the YAML.
    const workflow = readFileSync(join(__dirname, '../../.github/workflows/pr-ci.yml'), 'utf8');

    // Top-level job ids: two-space indentation directly under `jobs:`.
    const jobsBlock = workflow.slice(workflow.indexOf('\njobs:'));
    const declaredInYaml = [...jobsBlock.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);

    // The `needs:` list of the ci-gate job.
    const gateNeedsBlock = /^ {2}ci-gate:$[\s\S]*?^ {4}needs:$\n((?:^ {6}- .+$\n)+)/m.exec(
      workflow
    );
    expect(gateNeedsBlock, 'ci-gate must declare an explicit needs list').not.toBeNull();
    const gateNeeds = [...(gateNeedsBlock?.[1] ?? '').matchAll(/^ {6}- (.+)$/gm)]
      .map((m) => m[1]?.trim())
      .filter((id): id is string => Boolean(id));
    expect(gateNeeds.length, 'ci-gate needs at least one job').toBeGreaterThan(0);

    const governed = (DECLARED_JOBS as Array<{ id: string }>).map((j) => j.id).sort();
    const inYaml = declaredInYaml.filter((id) => id !== 'ci-gate').sort();

    // All three lists must agree. Any one of them drifting is a hole:
    //   YAML ⊄ needs      → a job runs that ci-gate never waits for
    //   needs ⊄ DECLARED  → the gate is blind to a job it depends on
    //   DECLARED ⊄ YAML   → the gate expects a job that no longer exists
    expect(inYaml, 'pr-ci.yml jobs vs ci-gate needs').toEqual([...gateNeeds].sort());
    expect(governed, 'DECLARED_JOBS vs pr-ci.yml jobs').toEqual(inYaml);

    expect(governed).toEqual([
      'application-build',
      // The AUTHENTICATED browser tier. Its absence from this list is what let
      // both gates report Go while the repository's only end-to-end
      // tenant-isolation proof was red.
      'authenticated-browser',
      'change-detection',
      'code-security',
      'container-security',
      'database-migration-replay',
      'database-security',
      'dependency-security',
      'hosted-clean-room',
      'integration-tests',
      'secret-scan',
      'static-quality',
      'unit-tests-coverage',
      // Added by P1-25. ALWAYS required: before it, hosted CI invoked zero web
      // commands, so the web application's own lint had never run.
      'web-quality',
    ]);
    expect(governed, 'the authenticated browser tier is not governed').toContain(
      'authenticated-browser'
    );
    const unconditional = (DECLARED_JOBS as Array<{ id: string; alwaysRequired: boolean }>)
      .filter((j) => j.alwaysRequired)
      .map((j) => j.id);
    expect(unconditional).toContain('hosted-clean-room');
    expect(unconditional).toContain('secret-scan');
    expect(unconditional).toContain('change-detection');
    expect(unconditional).toContain('authenticated-browser');
  });

  it('the PROTECTED gate depends on every governed job it can, read from the workflow', () => {
    /*
     * The other half of the reconciliation above, and it had no test at all —
     * which is how `authenticated-browser` came to run in this workflow for a
     * whole phase while `protected-gate` did not wait for it.
     *
     * `change-detection` is the one exception and it is a real one: it exists
     * only on the pull-request workflow, and `protected-classification.mjs`
     * records it as satisfied by construction because a protected run performs
     * no change detection and permits no skip.
     */
    const workflow = readFileSync(
      join(__dirname, '../../.github/workflows/protected-develop-verification.yml'),
      'utf8'
    );
    const jobsBlock = workflow.slice(workflow.indexOf('\njobs:'));
    const declaredInYaml = [...jobsBlock.matchAll(/^ {2}([a-z][a-z0-9-]*):$/gm)].map((m) => m[1]);

    const needsBlock = /^ {2}protected-gate:$[\s\S]*?^ {4}needs:$\n((?:^ {6}- .+$\n)+)/m.exec(
      workflow
    );
    expect(needsBlock, 'protected-gate must declare an explicit needs list').not.toBeNull();
    const gateNeeds = [...(needsBlock?.[1] ?? '').matchAll(/^ {6}- (.+)$/gm)]
      .map((m) => m[1]?.trim())
      .filter((id): id is string => Boolean(id));

    const inYaml = declaredInYaml.filter((id) => id !== 'protected-gate').sort();
    expect(inYaml, 'protected-develop-verification.yml jobs vs protected-gate needs').toEqual(
      [...gateNeeds].sort()
    );

    const governed = (DECLARED_JOBS as Array<{ id: string }>)
      .map((j) => j.id)
      .filter((id) => id !== 'change-detection')
      .sort();
    expect(governed, 'DECLARED_JOBS vs the protected workflow').toEqual(inYaml);
    expect(
      gateNeeds,
      'protected-gate does not wait for the authenticated browser tier, so it can report Go ' +
        'while that check is red — the exact hole this job was moved under a gate to close'
    ).toContain('authenticated-browser');
  });
});

/**
 * The security-gated job: three states, and only one of them is a pass.
 *
 * `authenticated-browser` stands a full Supabase stack, a production API and a
 * real operator account up on the runner, so a FORK pull request is deliberately
 * refused it. That refusal is the one circumstance in which a job the gate calls
 * unconditionally required may be absent — and it is recognised only when the
 * caller SAYS SO. Everything else about a missing result is a failure.
 *
 * These four cases are the mutation proofs for that arrangement, written as
 * tests rather than as a one-off experiment so they keep proving it.
 */
describe('the authenticated browser tier is gate authority', () => {
  const JOB = 'authenticated-browser';
  const stateOf = (result: ReturnType<typeof evaluate>, id: string) =>
    (result.jobs as Array<{ id: string; state?: string }>).find((j) => j.id === id)?.state;

  it('A — a failing authenticated-browser cannot produce a Go', () => {
    const result = evaluate(
      allSucceeded({ [JOB]: 'failure' }),
      classificationRequiringEverything(),
      {},
      { trustedContext: true }
    );
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toContain(JOB);
    expect(stateOf(result, JOB)).toBe(STATE.FAILED);
  });

  it('C — a required-but-skipped run fails closed in a trusted context', () => {
    const result = evaluate(
      allSucceeded({ [JOB]: 'skipped' }),
      classificationRequiringEverything(),
      {},
      { trustedContext: true }
    );
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(/skipped although this run IS a trusted context/);
    expect(stateOf(result, JOB)).toBe(STATE.FAILED);
  });

  it('C — a skip with NO eligibility statement also fails closed', () => {
    /*
     * The dangerous middle. An `if:` that failed to resolve, an unset variable,
     * a caller that simply forgot — all of them produce "no statement", and the
     * tempting reading of "no statement" is the permissive one. It is the
     * failing one here: silence is not a security refusal.
     */
    const result = evaluate(
      allSucceeded({ [JOB]: 'skipped' }),
      classificationRequiringEverything(),
      {},
      {}
    );
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(/no\s+`?--trusted-context`?\s+statement/);
    expect(stateOf(result, JOB)).toBe(STATE.FAILED);
  });

  it('D — an untrusted fork is NOT_ELIGIBLE_FOR_SECURITY_REASON, not a silent pass', () => {
    const result = evaluate(
      allSucceeded({ [JOB]: 'skipped' }),
      classificationRequiringEverything(),
      {},
      { trustedContext: false }
    );
    expect(result.decision).toBe('Go');
    expect(stateOf(result, JOB)).toBe(STATE.NOT_ELIGIBLE);
    // The state is PUBLISHED, not merely computed: a reader of a Go must be able
    // to tell "this was proved" from "this run was not allowed to prove it".
    expect(result.notes.join('\n')).toContain(STATE.NOT_ELIGIBLE);
    expect(result.notes.join('\n')).toMatch(/UNPROVEN/);
    expect(result.trustedContext).toBe(false);
    expect(result.securityGated).toEqual([
      { id: JOB, requires: expect.any(String), state: STATE.NOT_ELIGIBLE },
    ]);
  });

  it('the security excuse is not available to any other job', () => {
    /*
     * The way this arrangement would rot: `--trusted-context false` becoming a
     * blanket amnesty. It applies to the jobs that DECLARE an eligibility and to
     * nothing else, so an untrusted fork still cannot skip the clean room.
     */
    const result = evaluate(
      allSucceeded({ 'hosted-clean-room': 'skipped' }),
      classificationRequiringEverything(),
      {},
      { trustedContext: false }
    );
    expect(result.decision).toBe('No-Go');
    expect(result.failures.join('\n')).toMatch(/unconditionally required/);
  });

  it('an eligible run still has to actually pass', () => {
    const result = evaluate(
      allSucceeded(),
      classificationRequiringEverything(),
      {},
      { trustedContext: false }
    );
    expect(result.decision).toBe('Go');
    expect(stateOf(result, JOB)).toBe(STATE.PASSED);
  });

  it('`skipped` is not an acceptable RESULT for a required or security-gated job', () => {
    /*
     * The replaced constant, and why it was replaced. `ACCEPTABLE_RESULTS` was a
     * module-level `Set(['success', 'skipped'])` — exported, imported by nothing,
     * read by nothing, and stating a policy that was never the policy for an
     * unconditionally required job. It is derived per job now, and it is
     * consulted, which is the difference between a rule and a comment.
     */
    const declared = DECLARED_JOBS as Array<{
      id: string;
      alwaysRequired: boolean;
      securityEligibility?: string;
    }>;
    for (const job of declared) {
      const acceptable = acceptableResults(job);
      expect(acceptable.has('success'), `${job.id} cannot pass at all`).toBe(true);
      expect(
        acceptable.has('skipped'),
        `${job.id} may be skipped, which contradicts its own declaration`
      ).toBe(!job.alwaysRequired && !job.securityEligibility);
    }
  });

  it('the summary says WHICH state, so a Go is readable', () => {
    const markdown = toMarkdown(
      evaluate(
        allSucceeded({ [JOB]: 'skipped' }),
        classificationRequiringEverything(),
        { actualSha: 'e'.repeat(40) },
        { trustedContext: false }
      ),
      classificationRequiringEverything(),
      {}
    );
    expect(markdown).toContain('### Security-gated assurance');
    expect(markdown).toContain(STATE.NOT_ELIGIBLE);
    expect(markdown).toContain('Trusted context: `false`');
  });
});
