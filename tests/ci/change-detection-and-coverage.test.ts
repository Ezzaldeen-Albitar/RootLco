/**
 * Tests for the two gates that decide what runs and what is good enough.
 *
 * Change detection decides which heavy jobs may be skipped; the coverage
 * ratchet decides whether a change is allowed to make the codebase less tested.
 * A bug in either is invisible — the pipeline stays green and simply stops
 * checking things.
 */
import { describe, it, expect } from 'vitest';
import {
  classify,
  classifyPath,
  parseFileList,
  ALWAYS_REQUIRED,
} from '../../scripts/ci/classify-changes.mjs';
import { evaluate as evaluateCoverage, pct } from '../../scripts/ci/coverage-gate.mjs';

describe('change classification', () => {
  it('classifies each area of the repository to the category that governs it', () => {
    expect(classifyPath('.github/workflows/pr-ci.yml')).toBe('workflows');
    expect(classifyPath('package-lock.json')).toBe('dependencies');
    expect(classifyPath('Dockerfile')).toBe('docker');
    expect(classifyPath('docker-compose.yml')).toBe('docker');
    expect(classifyPath('supabase/migrations/0001_extensions.sql')).toBe('database');
    expect(classifyPath('scripts/db/apply-migrations.mjs')).toBe('database');
    expect(classifyPath('docs/api/openapi.v1.json')).toBe('openapi');
    expect(classifyPath('tests/backend/x.test.ts')).toBe('tests');
    expect(classifyPath('scripts/ci/classify-changes.mjs')).toBe('ciScripts');
    // `src/app/api/**` is the HTTP surface of the BACKEND, not a page. Classing
    // it as `frontend` meant an authorization-bearing route handler skipped
    // `database-security` — the job that runs the RLS matrix.
    expect(classifyPath('src/app/api/v1/x/route.ts')).toBe('backend');
    expect(classifyPath('src/app/page.tsx')).toBe('frontend');
    expect(classifyPath('src/modules/inventory/x.ts')).toBe('backend');
    expect(classifyPath('src/lib/logging/logger.ts')).toBe('appSource');
    expect(classifyPath('docs/engineering/ci-automation/README.md')).toBe('docs');
    expect(classifyPath('LICENSE')).toBe('other');
  });

  it('normalises Windows separators, because the diff may be produced on either platform', () => {
    expect(parseFileList('src\\modules\\inventory\\x.ts\r\n')).toEqual([
      'src/modules/inventory/x.ts',
    ]);
  });

  it('marks a change documentation-only only when EVERY file is documentation', () => {
    expect(classify(['docs/a.md', 'README.md']).documentationOnly).toBe(true);
    expect(classify(['docs/a.md', 'src/x.ts']).documentationOnly).toBe(false);
  });

  it('does NOT treat an empty change set as documentation-only', () => {
    // An empty diff is anomalous. Treating it as "nothing changed, skip
    // everything" would turn a broken base-ref resolution into a free pass.
    const result = classify([]);
    expect(result.documentationOnly).toBe(false);
    for (const decision of Object.values(result.jobs) as Array<{
      required: boolean;
      reason: string;
    }>) {
      expect(decision.required).toBe(true);
    }
    expect(JSON.stringify(result.jobs)).toContain('cannot prove a skip is safe');
  });

  it('skips the heavy jobs for a documentation-only change, and records why', () => {
    const result = classify(['docs/engineering/ci-automation/README.md']);
    const skipped = Object.entries(
      result.jobs as Record<string, { required: boolean; reason: string }>
    )
      .filter(([, d]) => !d.required)
      .map(([id]) => id);
    expect(skipped.sort()).toEqual([
      'application-build',
      'code-security',
      'container-security',
      'database-migration-replay',
      'database-security',
      'integration-tests',
    ]);
    for (const id of skipped) {
      expect(result.jobs[id]?.reason).toMatch(/^no change in /);
    }
  });

  it('never skips the unconditional jobs, whatever changed', () => {
    for (const files of [['docs/a.md'], ['src/x.ts'], ['Dockerfile'], []]) {
      const result = classify(files);
      for (const job of ALWAYS_REQUIRED as string[]) {
        expect(result.jobs[job]?.required).toBe(true);
      }
    }
  });

  it('requires the database jobs when a migration changes', () => {
    const result = classify(['supabase/migrations/20260801000000_x.sql']);
    expect(result.jobs['database-migration-replay']?.required).toBe(true);
    expect(result.jobs['database-security']?.required).toBe(true);
    expect(result.jobs['integration-tests']?.required).toBe(true);
  });

  it('requires the container job when the Dockerfile or a dependency changes', () => {
    expect(classify(['Dockerfile']).jobs['container-security']?.required).toBe(true);
    expect(classify(['package-lock.json']).jobs['container-security']?.required).toBe(true);
  });

  it('requires the security jobs when an API route handler changes', () => {
    // Without this, deleting `frontend`/`backend` from the CONDITIONAL_JOBS
    // trigger lists would skip every heavy job for a route-only change and no
    // test would notice.
    const result = classify(['src/app/api/v1/inventory/items/route.ts']);
    for (const job of [
      'database-security',
      'integration-tests',
      'code-security',
      'application-build',
      'container-security',
    ]) {
      expect(result.jobs[job]?.required, job).toBe(true);
    }
  });

  it('requires everything when an unclassified path is touched', () => {
    // A path matching no rule is a path nobody classified. Skipping on that
    // basis would let a new root-level middleware.ts or config file disable six
    // jobs, including CodeQL.
    const result = classify(['middleware.ts']);
    expect(result.categories).toContain('other');
    for (const decision of Object.values(result.jobs) as Array<{
      required: boolean;
      reason: string;
    }>) {
      expect(decision.required).toBe(true);
    }
    expect(JSON.stringify(result.jobs)).toContain('unclassified path touched');
  });

  it('requires everything when a workflow changes, because the pipeline is what changed', () => {
    const result = classify(['.github/workflows/pr-ci.yml']);
    for (const decision of Object.values(result.jobs) as Array<{ required: boolean }>) {
      expect(decision.required).toBe(true);
    }
  });
});

describe('coverage ratchet', () => {
  const summary = (linePct: number, extra: Record<string, unknown> = {}) => ({
    total: {
      lines: { total: 1000, covered: linePct * 10, pct: linePct },
      statements: { total: 1000, covered: linePct * 10, pct: linePct },
      functions: { total: 100, covered: 90, pct: 90 },
      branches: { total: 100, covered: 95, pct: 95 },
    },
    ...extra,
  });

  const baseline = {
    tolerancePercentagePoints: 0.5,
    global: { lines: 91.06, statements: 91.06, functions: 90, branches: 95 },
    criticalModules: [],
    touchedFileMinimum: 0,
  };

  it('treats "nothing to cover" as fully covered rather than as NaN', () => {
    expect(pct({ total: 0, covered: 0 })).toBe(100);
    expect(pct(undefined)).toBeNull();
  });

  it('passes when coverage holds', () => {
    expect(evaluateCoverage(summary(91.06), baseline).ok).toBe(true);
  });

  it('passes within the stated tolerance, because v8 attribution shifts between Node patches', () => {
    expect(evaluateCoverage(summary(90.7), baseline).ok).toBe(true);
  });

  it('fails when coverage drops beyond the tolerance', () => {
    const result = evaluateCoverage(summary(88.0), baseline);
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/global lines coverage fell from 91.06% to 88%/);
  });

  it('passes and merely warns when no baseline has been recorded yet', () => {
    const result = evaluateCoverage(summary(42), { ...baseline, global: {} });
    expect(result.ok).toBe(true);
    expect(result.warnings.join('\n')).toMatch(/no baseline recorded/);
  });

  it('fails a coverage summary that has no totals at all', () => {
    // A missing report must never read as "nothing regressed".
    expect(evaluateCoverage({}, baseline).ok).toBe(false);
  });

  it('enforces a critical-module floor independently of the global number', () => {
    const withModule = summary(99, {
      'src/server/errors/map.ts': { lines: { total: 100, covered: 40, pct: 40 } },
    });
    const result = evaluateCoverage(withModule, {
      ...baseline,
      global: { lines: 99, statements: 99, functions: 90, branches: 95 },
      criticalModules: [
        { id: 'error-mapping', pathPrefix: 'src/server/errors', metric: 'lines', minimum: 95 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/critical module `error-mapping`/);
  });

  it('REFUSES a critical-module floor whose path matches nothing', () => {
    // A floor over an empty set passes whatever happens to that module, which is
    // worse than no floor because it looks like protection.
    const result = evaluateCoverage(summary(91.06), {
      ...baseline,
      criticalModules: [
        { id: 'ghost', pathPrefix: 'src/does-not-exist', metric: 'lines', minimum: 90 },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(/vacuous/);
  });

  it('fails a touched production file that arrives materially uncovered', () => {
    const withFile = summary(91.06, {
      'src/modules/inventory/new.ts': { lines: { total: 100, covered: 5, pct: 5 } },
    });
    const result = evaluateCoverage(withFile, { ...baseline, touchedFileMinimum: 60 }, [
      'src/modules/inventory/new.ts',
    ]);
    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toMatch(
      /was changed by this pull request and is at 5% line coverage/
    );
  });

  it('ignores an uncovered file the pull request did not touch', () => {
    const withFile = summary(91.06, {
      'src/modules/inventory/old.ts': { lines: { total: 100, covered: 5, pct: 5 } },
    });
    const result = evaluateCoverage(withFile, { ...baseline, touchedFileMinimum: 60 }, [
      'src/other.ts',
    ]);
    expect(result.ok).toBe(true);
  });

  it('honours an exempt prefix for touched files', () => {
    const withFile = summary(91.06, {
      'src/app/page.tsx': { lines: { total: 100, covered: 0, pct: 0 } },
    });
    const result = evaluateCoverage(
      withFile,
      { ...baseline, touchedFileMinimum: 60, touchedFileExemptPrefixes: ['src/app/'] },
      ['src/app/page.tsx']
    );
    expect(result.ok).toBe(true);
  });
});
