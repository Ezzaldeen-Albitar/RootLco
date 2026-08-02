/**
 * Mutation tests for the web topology gate.
 *
 * Each test constructs the violation the gate exists to catch and proves the
 * gate FAILS on it. A gate proven only on the happy path has never been proven
 * at all — this repository has paid for that lesson more than once (a Stylelint
 * rule silently skipped for weeks, a documented path check that matched
 * nothing).
 */
import { describe, expect, it } from 'vitest';
import { evaluate } from '../../scripts/ci/check-web-topology.mjs';

/** A minimal healthy tracked-file list satisfying every requirement. */
function healthyFiles(): string[] {
  return [
    'apps/web/src/app/layout.tsx',
    'apps/web/src/app/[locale]/layout.tsx',
    'apps/web/src/proxy.ts',
    'apps/web/src/components/shell/AppShell.tsx',
    'apps/web/src/config/brand.ts',
    'apps/web/src/i18n/en.ts',
    'apps/web/src/lib/api/client.ts',
    'apps/web/src/styles/tokens/_colors.scss',
    'apps/web/src/styles/themes/_provisional.scss',
    'apps/web/public/brand/.gitkeep',
    'apps/web/tests/security.test.ts',
    'apps/web/tests/e2e/foundation.spec.ts',
    'apps/web/next.config.ts',
    'apps/web/package.json',
    'apps/web/tsconfig.json',
  ];
}

/** A reader giving brand.ts its authority and everything else empty. */
const healthyRead = (p: string): string | null =>
  p === 'apps/web/src/config/brand.ts' ? 'export const brand = {};' : '';

describe('web topology gate — healthy tree', () => {
  it('passes a canonical tree and counts every expectation', () => {
    const { failures, counts } = evaluate(healthyFiles(), healthyRead);
    expect(failures).toEqual([]);
    // Anti-vacuity: the required-path expectations matched real files.
    expect(counts['apps/web/src/app/']).toBeGreaterThan(0);
    expect(counts['apps/web/tests/e2e/']).toBeGreaterThan(0);
    expect(counts['brand authority']).toBe(1);
  });
});

describe('web topology gate — mutations it must catch', () => {
  it('fails when a root-level App Router file reappears', () => {
    const { failures } = evaluate([...healthyFiles(), 'apps/web/app/page.tsx'], healthyRead);
    expect(failures.some((f) => f.includes('apps/web/app/'))).toBe(true);
  });

  it('fails when a nested lockfile is created', () => {
    const { failures } = evaluate([...healthyFiles(), 'apps/web/package-lock.json'], healthyRead);
    expect(failures.some((f) => f.includes('package-lock.json'))).toBe(true);
  });

  it('fails when a second brand authority is created', () => {
    const files = [...healthyFiles(), 'apps/web/src/features/branding/brand-copy.ts'];
    const read = (p: string): string | null =>
      p === 'apps/web/src/config/brand.ts' || p === 'apps/web/src/features/branding/brand-copy.ts'
        ? 'export const brand = {};'
        : '';
    const { failures } = evaluate(files, read);
    expect(failures.some((f) => f.includes('exactly 1 brand authority'))).toBe(true);
  });

  it('fails when a required path matches zero files (a vacuous topology)', () => {
    // Remove the entire router — the "wrong prefix" failure mode: whatever the
    // check points at, if nothing matches it must fail rather than pass.
    const files = healthyFiles().filter((f) => !f.startsWith('apps/web/src/app/'));
    const { failures } = evaluate(files, healthyRead);
    expect(failures.some((f) => f.includes('no tracked file: apps/web/src/app/'))).toBe(true);
  });

  it('fails when a generated Playwright report is tracked', () => {
    const { failures } = evaluate(
      [...healthyFiles(), 'apps/web/playwright-report/index.html'],
      healthyRead
    );
    expect(failures.some((f) => f.includes('playwright-report'))).toBe(true);
  });

  it('fails when a deprecated middleware file coexists with proxy.ts', () => {
    const { failures } = evaluate([...healthyFiles(), 'apps/web/src/middleware.ts'], healthyRead);
    expect(failures.some((f) => f.includes('middleware.ts'))).toBe(true);
  });

  it('fails when web runtime source imports API server source', () => {
    const files = [...healthyFiles(), 'apps/web/src/lib/bad.ts'];
    const read = (p: string): string | null => {
      if (p === 'apps/web/src/config/brand.ts') return 'export const brand = {};';
      if (p === 'apps/web/src/lib/bad.ts') return "import { db } from '@rootlco/api/src/db';";
      return '';
    };
    const { failures } = evaluate(files, read);
    expect(failures.some((f) => f.includes('api-source-import'))).toBe(true);
  });

  it('fails when web runtime source imports a Supabase client', () => {
    const files = [...healthyFiles(), 'apps/web/src/lib/worse.ts'];
    const read = (p: string): string | null => {
      if (p === 'apps/web/src/config/brand.ts') return 'export const brand = {};';
      if (p === 'apps/web/src/lib/worse.ts')
        return "import { createClient } from '@supabase/supabase-js';";
      return '';
    };
    const { failures } = evaluate(files, read);
    expect(failures.some((f) => f.includes('supabase-import'))).toBe(true);
  });

  it('does not flag tests or specs for content rules', () => {
    const files = [...healthyFiles(), 'apps/web/src/lib/api/client.test.ts'];
    const read = (p: string): string | null => {
      if (p === 'apps/web/src/config/brand.ts') return 'export const brand = {};';
      if (p.endsWith('.test.ts')) return "import '@supabase/supabase-js';"; // a fixture string in a test
      return '';
    };
    const { failures } = evaluate(files, read);
    expect(failures.filter((f) => f.includes('supabase-import'))).toEqual([]);
  });
});
