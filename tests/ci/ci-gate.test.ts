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
import { evaluate, DECLARED_JOBS, toMarkdown } from '../../scripts/ci/evaluate-ci-gate.mjs';

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
    files: ['src/modules/inventory/x.ts'],
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
  it('governs the twelve jobs pr-ci.yml declares, and the clean room is unconditional', () => {
    const ids = (DECLARED_JOBS as Array<{ id: string; alwaysRequired: boolean }>).map((j) => j.id);
    expect(ids).toEqual([
      'change-detection',
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
    ]);
    const unconditional = (DECLARED_JOBS as Array<{ id: string; alwaysRequired: boolean }>)
      .filter((j) => j.alwaysRequired)
      .map((j) => j.id);
    expect(unconditional).toContain('hosted-clean-room');
    expect(unconditional).toContain('secret-scan');
    expect(unconditional).toContain('change-detection');
  });
});
