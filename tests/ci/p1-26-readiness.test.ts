/**
 * Mutation tests for the P1-26 readiness reporter.
 *
 * The reporter answers "may P1-26 begin?" from the TREE rather than from prose,
 * because a document asserting a brand was approved proves nothing — and a
 * dependency status recorded once decays into a stale yes that nobody
 * re-checks. These tests pin that each item flips only when the real condition
 * changes.
 */
import { describe, expect, it } from 'vitest';
import { evaluate, gateRecordFor } from '../../scripts/ci/check-p1-26-readiness.mjs';

/** A tree where every readiness condition is met. */
function readyFiles(): string[] {
  return [
    'docs/phase-1/phase-1-14/phase-1-14-owner-gate.md',
    'docs/phase-1/phase-1-15/phase-1-15-owner-gate.md',
    'docs/phase-1/phase-1-24/gate-record.md',
    'docs/phase-1/phase-1-25/gate-record.md',
    'apps/web/src/config/brand.ts',
    'apps/web/public/brand/logo.svg',
    ...Array.from(
      { length: 119 },
      (_, i) => `supabase/migrations/${String(i).padStart(4, '0')}_x.sql`
    ),
  ];
}

const approvedBrand = (p: string): string | null =>
  p === 'apps/web/src/config/brand.ts'
    ? "systemName: 'Approved Name',\n  isProvisional: false,"
    : '';

const provisionalBrand = (p: string): string | null =>
  p === 'apps/web/src/config/brand.ts'
    ? "systemName: '[SYSTEM NAME]',\n  isProvisional: true,"
    : '';

describe('gateRecordFor', () => {
  it('accepts all three filename conventions this repository actually uses', () => {
    // 1-1…1-20 use the owner-gate form, 1-21…1-24 use gate-record.md, and the
    // governance template prescribes a third nobody adopted. Picking one
    // silently would report a missing record for a phase that has one.
    expect(gateRecordFor('1-24', ['docs/phase-1/phase-1-24/gate-record.md'])).toBeTruthy();
    expect(
      gateRecordFor('1-14', ['docs/phase-1/phase-1-14/phase-1-14-owner-gate.md'])
    ).toBeTruthy();
    expect(gateRecordFor('1-25', ['docs/phase-1/phase-1-25/phase-1-25-gate.md'])).toBeTruthy();
    expect(gateRecordFor('1-25', [])).toBeNull();
  });
});

describe('a fully ready tree', () => {
  it('reports READY when every condition is met', () => {
    const { ready, items } = evaluate(readyFiles(), approvedBrand, '');
    expect(ready).toBe(true);
    expect(items.every((i) => i.ready)).toBe(true);
  });
});

describe('each unmet condition blocks on its own', () => {
  it('blocks while the P1-25 gate record is absent', () => {
    const files = readyFiles().filter((f) => f !== 'docs/phase-1/phase-1-25/gate-record.md');
    const { ready, items } = evaluate(files, approvedBrand, '');
    expect(ready).toBe(false);
    expect(items.find((i) => i.id === 'P1-25 gate record')?.ready).toBe(false);
  });

  it('blocks while the product name is a placeholder — OIR-01', () => {
    const { ready, items } = evaluate(readyFiles(), provisionalBrand, '');
    expect(ready).toBe(false);
    expect(items.find((i) => i.id === 'OIR-01 product name')?.ready).toBe(false);
  });

  it('blocks while the brand is provisional — OIR-06', () => {
    const read = (p: string): string | null =>
      p === 'apps/web/src/config/brand.ts'
        ? "systemName: 'Approved Name',\n  isProvisional: true,"
        : '';
    const { items } = evaluate(readyFiles(), read, '');
    expect(items.find((i) => i.id === 'OIR-06 visual identity')?.ready).toBe(false);
  });

  it('blocks while no logo asset exists', () => {
    const files = readyFiles().filter((f) => !f.includes('public/brand/logo'));
    const { items } = evaluate(files, approvedBrand, '');
    expect(items.find((i) => i.id === 'approved logo asset')?.ready).toBe(false);
  });

  it('blocks when a P1-26 branch already exists', () => {
    // Creating the branch early is the thing the dependency boundary exists to
    // prevent, so the reporter must notice it rather than assume discipline.
    const { ready, items } = evaluate(
      readyFiles(),
      approvedBrand,
      '  remotes/origin/feature/p1-26-authentication-administration-frontend'
    );
    expect(ready).toBe(false);
    expect(items.find((i) => i.id === 'no premature P1-26 branch')?.ready).toBe(false);
  });

  it('blocks when the migration baseline moved', () => {
    const files = [...readyFiles(), 'supabase/migrations/0120_unauthorised.sql'];
    const { items } = evaluate(files, approvedBrand, '');
    expect(items.find((i) => i.id === 'migration baseline')?.ready).toBe(false);
  });

  it('treats an unreadable brand config as not approved, never as approved', () => {
    // Failing open here would report READY because a file could not be read.
    const { items } = evaluate(readyFiles(), () => null, '');
    expect(items.find((i) => i.id === 'OIR-06 visual identity')?.ready).toBe(false);
  });
});

describe("today's real state", () => {
  it('is NOT ready, and every unmet item is an Owner input', () => {
    // The four unmet items are the P1-25 gate record, OIR-01, OIR-06 and the
    // logo — none of which engineering can supply.
    const files = readyFiles()
      .filter((f) => f !== 'docs/phase-1/phase-1-25/gate-record.md')
      .filter((f) => !f.includes('public/brand/logo'));
    const { ready, items } = evaluate(files, provisionalBrand, '');
    expect(ready).toBe(false);
    const blocked = items.filter((i) => !i.ready).map((i) => i.id);
    expect(blocked).toEqual([
      'P1-25 gate record',
      'OIR-01 product name',
      'OIR-06 visual identity',
      'approved logo asset',
    ]);
  });
});
