/**
 * Mutation tests for the generated-artefact gate.
 *
 * The defect this gate was written for is `P1-25-F-025`: `.gitignore` carried
 * the DIRECTORY `playwright-report/` but not the FILE `playwright-report.json`,
 * a `git add -A` swept the file in, and the clean room then failed on the shape
 * of its own regenerated output. So the ignore-rule checks are pinned as
 * carefully as the tracked-file checks.
 */
import { describe, expect, it } from 'vitest';
import { evaluate, REQUIRED_IGNORES } from '../../scripts/ci/check-generated-artifacts.mjs';

function healthyFiles(): string[] {
  return [
    'package.json',
    'package-lock.json',
    '.gitignore',
    'apps/api/package.json',
    'apps/api/src/app/api/health/route.ts',
    'apps/web/package.json',
    'apps/web/src/app/layout.tsx',
  ];
}

/** A .gitignore satisfying every required rule, in its idiomatic spelling. */
function healthyIgnore(): string {
  return [
    '# comment lines are ignored by the check',
    'node_modules/',
    '.next/',
    '*.tsbuildinfo',
    '/apps/web/test-results/',
    '/apps/web/playwright-report/',
    '/apps/web/playwright-report.json',
    '/apps/web/vitest-web.json',
  ].join('\n');
}

describe('generated-artefact gate — healthy tree', () => {
  it('passes a clean tree and counts what it examined', () => {
    const { failures, counts } = evaluate(healthyFiles(), healthyIgnore());
    expect(failures).toEqual([]);
    expect(counts['tracked files']).toBeGreaterThan(0);
    expect(counts['lockfiles']).toBe(1);
    expect(counts['ignore rules present']).toBe(REQUIRED_IGNORES.length);
  });

  it('accepts the trailing-slash directory spelling, which is the better one', () => {
    const { failures } = evaluate(healthyFiles(), healthyIgnore());
    expect(failures.filter((f) => f.includes('node_modules'))).toEqual([]);
    expect(failures.filter((f) => f.includes('.next'))).toEqual([]);
  });
});

describe('generated-artefact gate — mutations it must catch', () => {
  it.each([
    ['node_modules', 'apps/web/node_modules/react/index.js'],
    ['.next', 'apps/api/.next/server/app/route.js'],
    ['coverage', 'coverage/unit/coverage-summary.json'],
    ['test-results', 'apps/web/test-results/foo/trace.zip'],
    ['playwright-report dir', 'apps/web/playwright-report/index.html'],
  ])('fails when a tracked file sits under %s', (_label, path) => {
    const { failures } = evaluate([...healthyFiles(), path], healthyIgnore());
    expect(failures.some((f) => f.includes(path))).toBe(true);
  });

  it.each([
    ['tsbuildinfo', 'apps/api/tsconfig.tsbuildinfo'],
    ['playwright report file', 'apps/web/playwright-report.json'],
    ['vitest report file', 'apps/web/vitest-web.json'],
  ])('fails when a generated %s file is tracked', (_label, path) => {
    const { failures } = evaluate([...healthyFiles(), path], healthyIgnore());
    expect(failures.some((f) => f.includes(path))).toBe(true);
  });

  it('fails on a nested lockfile', () => {
    const { failures } = evaluate(
      [...healthyFiles(), 'apps/web/package-lock.json'],
      healthyIgnore()
    );
    expect(failures.some((f) => f.includes('nested lockfile'))).toBe(true);
  });

  it('fails when the root lockfile is absent', () => {
    const files = healthyFiles().filter((f) => f !== 'package-lock.json');
    const { failures } = evaluate(files, healthyIgnore());
    expect(failures.some((f) => f.includes('root package-lock.json is not tracked'))).toBe(true);
  });

  it('fails when a required ignore rule is deleted', () => {
    const weakened = healthyIgnore()
      .split('\n')
      .filter((l) => l !== '/apps/web/playwright-report.json')
      .join('\n');
    const { failures } = evaluate(healthyFiles(), weakened);
    expect(failures.some((f) => f.includes('playwright report FILE'))).toBe(true);
  });

  it('does NOT accept a directory rule as covering the file of the same stem', () => {
    // This is P1-25-F-025 exactly: `playwright-report/` present, the JSON file
    // committed anyway. A gate that accepted the directory form here would have
    // reported the repository clean on the day the defect landed.
    const directoryOnly = healthyIgnore()
      .split('\n')
      .filter((l) => l !== '/apps/web/playwright-report.json')
      .join('\n');
    expect(directoryOnly).toContain('/apps/web/playwright-report/');
    const { failures } = evaluate(healthyFiles(), directoryOnly);
    expect(failures.some((f) => f.includes('playwright report FILE'))).toBe(true);
  });

  it('fails when .gitignore is missing entirely', () => {
    const { failures } = evaluate(healthyFiles(), null);
    expect(failures.some((f) => f.includes('.gitignore is missing'))).toBe(true);
  });

  it('fails on an empty tracked-file list rather than passing vacuously', () => {
    const { failures } = evaluate([], healthyIgnore());
    expect(failures.some((f) => f.includes('examined nothing'))).toBe(true);
  });
});
