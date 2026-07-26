/**
 * P1-19 module-foundation guards (P1-19-BE-001).
 *
 * These are structural assertions about the four modules Wave 3 establishes. They
 * are deliberately the kind of test that fails when a LATER wave takes a shortcut:
 * reaching into another module's tables, mirroring the transition graph in
 * TypeScript, or minting a vocabulary the database does not have.
 *
 * They read files rather than exercising behaviour, because behaviour is Waves
 * 4–8 and the point of this file is that the boundary holds before any of it is
 * written.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EVENT_CATALOG } from '@/server/events/envelope';
import { ERROR_CODES } from '@/server/errors/catalog';
import {
  CLOSURE_BLOCKERS,
  CLOSURE_BLOCKER_REGISTRY,
  DEFERRED_CLOSURE_BLOCKERS,
  WORK_ORDER_KINDS,
  PARTS_FORWARD_STATES,
  ADDITIONAL_WORK_STATES,
  FULFILLMENT_STATES,
} from '@/modules/work-order';
import {
  CERTIFICATION_STATUSES,
  LABOR_SOURCES,
  certificationIsValidOn,
  intervalCovers,
  intervalsOverlap,
  skillLevelSatisfies,
} from '@/modules/technician';
import { FINDING_SEVERITIES, RESPONSE_TYPES, severityAtLeast } from '@/modules/diagnostics';
import { QC_CHECK_RESULTS, QC_OVERALL_RESULTS } from '@/modules/quality';

const ROOT = process.cwd();
const MODULES = ['work-order', 'technician', 'diagnostics', 'quality'] as const;

/** Every `.ts` file under a module, recursively. */
function moduleFiles(moduleName: string): string[] {
  const base = join(ROOT, 'src', 'modules', moduleName);
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.ts')) out.push(full);
    }
  };
  walk(base);
  return out;
}

/** Which schemas a module is allowed to name in SQL. */
const OWNED_SCHEMAS: Readonly<Record<string, readonly string[]>> = {
  'work-order': ['wo'],
  technician: ['tech'],
  diagnostics: ['dia'],
  quality: ['qms'],
};

/** Schemas owned by a P1-19 sibling — reaching into one is the violation. */
const SIBLING_SCHEMAS = ['wo', 'tech', 'dia', 'qms'] as const;

describe('P1-19 module foundation', () => {
  it('gives each of the four modules the standard layout and a single public surface', () => {
    for (const moduleName of MODULES) {
      const files = moduleFiles(moduleName).map((f) => f.replace(/\\/g, '/'));
      expect(files.some((f) => f.endsWith(`/modules/${moduleName}/index.ts`))).toBe(true);
      expect(files.some((f) => f.includes(`/modules/${moduleName}/domain/`))).toBe(true);
      expect(files.some((f) => f.includes(`/modules/${moduleName}/data/`))).toBe(true);
      expect(files.some((f) => f.includes(`/modules/${moduleName}/application/`))).toBe(true);
    }
  });

  it('lets no module write SQL against a sibling P1-19 schema', () => {
    for (const moduleName of MODULES) {
      const owned = OWNED_SCHEMAS[moduleName] ?? [];
      const foreign = SIBLING_SCHEMAS.filter((schema) => !owned.includes(schema));
      for (const file of moduleFiles(moduleName)) {
        const source = readFileSync(file, 'utf8');
        // Strip block and line comments so prose naming another schema — which the
        // headers do deliberately, to explain why they do NOT read it — cannot
        // trip the guard. Only real SQL identifiers count.
        const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        for (const schema of foreign) {
          expect(
            new RegExp(`(FROM|JOIN|INTO|UPDATE)\\s+${schema}\\.`, 'i').test(code),
            `${file} reaches into ${schema}. — use the owning module's public surface`
          ).toBe(false);
        }
      }
    }
  });

  it('keeps the domain layer free of database access', () => {
    for (const moduleName of MODULES) {
      for (const file of moduleFiles(moduleName)) {
        if (!file.replace(/\\/g, '/').includes('/domain/')) continue;
        const source = readFileSync(file, 'utf8');
        expect(source).not.toContain('@/server/db/');
        expect(source).not.toMatch(/\bSELECT\b|\bINSERT\b|\bUPDATE\b/);
      }
    }
  });

  it('does not mirror the work-order or job transition graph in TypeScript', () => {
    // The graph is rows in wo.work_order_transitions / wo.job_transitions and a
    // tenant may shadow the platform edges. A literal here would refuse legitimate
    // tenant edges and drift the moment an edge is added or deactivated.
    for (const file of moduleFiles('work-order')) {
      if (!file.replace(/\\/g, '/').includes('/domain/')) continue;
      const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      for (const state of ['in_progress', 'qc_pending', 'ready_to_close', 'awaiting_parts']) {
        expect(source, `${file} appears to mirror the transition graph`).not.toContain(
          `'${state}'`
        );
      }
    }
  });

  it('registers the six closure blockers and no invented seventh', () => {
    expect(CLOSURE_BLOCKERS).toEqual(['B1', 'B2', 'B3', 'B4', 'B5', 'B6']);
    expect(CLOSURE_BLOCKER_REGISTRY).toHaveLength(6);
    expect(CLOSURE_BLOCKER_REGISTRY.map((b) => b.code)).toEqual([...CLOSURE_BLOCKERS]);
    for (const blocker of CLOSURE_BLOCKER_REGISTRY) {
      expect(blocker.enforcedBy).toBe('wo.guard_work_order_closure');
      expect(blocker.message.length).toBeGreaterThan(0);
    }
    // The two conditions the phase brief asked for that the protected guard does
    // not contain are recorded as deferred, not silently implemented as passing.
    expect(DEFERRED_CLOSURE_BLOCKERS.owner).toBe('P1-21');
    expect([...DEFERRED_CLOSURE_BLOCKERS.conditions]).toEqual([
      'active-reservation',
      'open-part-issue',
    ]);
  });

  it('carries only vocabularies the protected CHECK constraints actually allow', () => {
    // Each of these was wrong in the phase brief and was corrected from
    // pg_constraint. Pinning them here means a future edit back to the brief's
    // vocabulary fails rather than reaching PostgreSQL as a 23514.
    expect([...WORK_ORDER_KINDS]).toEqual(['ordinary', 'rework']);
    expect([...PARTS_FORWARD_STATES]).toEqual(['none', 'requested', 'reserved_elsewhere']);
    expect([...ADDITIONAL_WORK_STATES]).toEqual(['pending', 'approved', 'rejected', 'withdrawn']);
    expect([...FULFILLMENT_STATES]).toEqual(['unfulfilled', 'fulfilled', 'waived']);
    expect([...QC_CHECK_RESULTS]).toEqual(['pass', 'fail', 'na']);
    expect([...QC_OVERALL_RESULTS]).toEqual(['pending', 'passed', 'failed']);
    expect([...CERTIFICATION_STATUSES]).toEqual(['active', 'expired', 'revoked']);
    expect([...RESPONSE_TYPES]).toEqual(['numeric', 'text', 'boolean', 'select']);
    expect([...FINDING_SEVERITIES]).toEqual(['info', 'low', 'medium', 'high', 'critical']);
    expect([...LABOR_SOURCES]).toEqual(['manual', 'timer', 'correction']);
  });

  it('registers the P1-19 error codes and reuses ERR-TRN-001 for graph refusals', () => {
    for (const code of ['ERR-WO-001', 'ERR-TECH-001', 'ERR-DIA-001', 'ERR-QMS-001']) {
      expect(ERROR_CODES).toContain(code);
    }
    // ERR-TRN-001 predates P1-19 and already means "transition not permitted from
    // the current state". A per-module duplicate of it would give one fact two
    // codes, so the catalog service must use the existing one.
    expect(ERROR_CODES).toContain('ERR-TRN-001');
    const service = readFileSync(
      join(ROOT, 'src/modules/work-order/application/work-order-catalog-service.ts'),
      'utf8'
    );
    expect(service).toContain("'ERR-TRN-001'");
  });

  it('reserves the P1-19 events with three-letter codes and no version suffix', () => {
    const p19 = EVENT_CATALOG.filter((entry) => ['wo', 'tech', 'dia', 'qms'].includes(entry.owner));
    expect(p19.length).toBe(11);
    for (const entry of p19) {
      // The repository's code format is exactly three letters, which is why the
      // phase brief's EVT-WO-001 and EVT-TECH-001 could not be used verbatim.
      expect(entry.code).toMatch(/^EVT-(WOR|TEC|DIA|QMS)-\d{3}$/);
      // Version lives in schemaVersion, not in the wire name. Every one of the
      // twenty pre-existing entries is unsuffixed and these match.
      expect(entry.eventType).not.toMatch(/\.v\d+$/);
      expect(entry.schemaVersion).toBe(1);
      // Reserved is not implemented. Each wave sets its own when it publishes.
      expect(entry.implementedIn).toBeNull();
    }
  });

  it('decides certification expiry inclusively on the boundary day', () => {
    const expires = new Date('2026-07-26T00:00:00Z');
    const dayOf = new Date('2026-07-26T18:00:00Z');
    const dayAfter = new Date('2026-07-27T00:30:00Z');
    const dayBefore = new Date('2026-07-25T23:00:00Z');
    // Valid ON the expiry day: a technician certified until the 26th is certified
    // on the 26th. Exclusive comparison here would refuse real, valid work.
    expect(certificationIsValidOn(expires, 'active', dayOf)).toBe(true);
    expect(certificationIsValidOn(expires, 'active', dayBefore)).toBe(true);
    expect(certificationIsValidOn(expires, 'active', dayAfter)).toBe(false);
    // No expiry means it does not expire, but revocation always wins.
    expect(certificationIsValidOn(null, 'active', dayAfter)).toBe(true);
    expect(certificationIsValidOn(null, 'revoked', dayBefore)).toBe(false);
    expect(certificationIsValidOn(expires, 'revoked', dayBefore)).toBe(false);
  });

  it('treats availability as half-open and skill level as inclusive', () => {
    const from = new Date('2026-07-26T08:00:00Z');
    const to = new Date('2026-07-26T12:00:00Z');
    expect(intervalCovers(from, to, from, to)).toBe(true);
    expect(intervalCovers(from, to, from, new Date('2026-07-26T12:00:01Z'))).toBe(false);
    // Touching intervals do not overlap: [08,12) and [12,16) are disjoint.
    expect(intervalsOverlap(from, to, to, new Date('2026-07-26T16:00:00Z'))).toBe(false);
    expect(intervalsOverlap(from, to, new Date('2026-07-26T11:59:59Z'), to)).toBe(true);
    // Holding exactly the required rank qualifies.
    expect(skillLevelSatisfies(3, 3)).toBe(true);
    expect(skillLevelSatisfies(4, 3)).toBe(true);
    expect(skillLevelSatisfies(2, 3)).toBe(false);
  });

  it('orders finding severity from info to critical', () => {
    expect(severityAtLeast('critical', 'info')).toBe(true);
    expect(severityAtLeast('medium', 'medium')).toBe(true);
    expect(severityAtLeast('low', 'high')).toBe(false);
  });
});
