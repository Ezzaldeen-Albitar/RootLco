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
  workOrderModule,
} from '@/modules/work-order';
import {
  CERTIFICATION_STATUSES,
  LABOR_SOURCES,
  certificationIsValidOn,
  coveredByUnion,
  intervalsOverlap,
  skillLevelSatisfies,
  technicianModule,
} from '@/modules/technician';
import {
  FINDING_SEVERITIES,
  RESPONSE_TYPES,
  diagnosticsModule,
  severityAtLeast,
} from '@/modules/diagnostics';
import { QC_CHECK_RESULTS, QC_OVERALL_RESULTS, qualityModule } from '@/modules/quality';

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

/**
 * Cross-schema reads that are permitted, each with the reason.
 *
 * An allow-list is only honest if it is short, justified and asserted — an
 * unexplained exception is indistinguishable from a violation nobody noticed. Both
 * entries below exist because `wo.guard_work_order_closure` itself joins across
 * these schemas: B2 asks whether a labor session on one of this order's jobs is
 * still open, and B4 whether a `requires_diagnostic` job has a completed report.
 * Re-asking those two questions through `technician` and `diagnostics` would mean
 * inventing two public methods that exist only to answer a closure predicate, and
 * the predicate would then live in three places instead of one.
 *
 * These are read-only closure predicates, never that domain's behaviour. Any
 * OTHER cross-schema reference — and any write at all — still fails.
 */
const PERMITTED_CROSS_SCHEMA: readonly {
  readonly module: string;
  readonly file: string;
  readonly schema: string;
  readonly why: string;
}[] = [
  {
    module: 'work-order',
    file: 'work-order-repository.ts',
    schema: 'tech',
    why: 'closure blocker B2 — an open labor session on one of this order’s jobs',
  },
  {
    module: 'work-order',
    file: 'work-order-repository.ts',
    schema: 'dia',
    why: 'closure blocker B4 — a requires_diagnostic job with no completed report',
  },
];

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
          // Match the qualified NAME itself, not a keyword that happens to precede
          // it. An earlier version matched `(FROM|JOIN|INTO|UPDATE)\s+<schema>\.`
          // and was blind to a schema-qualified FUNCTION call —
          // `SELECT qms.attempt_reopen($1, $2)`, which is exactly the reopen path
          // Wave 8 needs — and equally to `USING`, `ONLY`, `LATERAL`, quoted
          // identifiers and template interpolation. Matching `schema.` directly
          // closes all of those at once.
          const permitted = PERMITTED_CROSS_SCHEMA.some(
            (entry) =>
              entry.module === moduleName &&
              file.replace(/\\/g, '/').endsWith(`/${entry.file}`) &&
              entry.schema === schema
          );
          if (permitted) continue;
          expect(
            new RegExp(String.raw`(^|[^\w."'])"?${schema}"?\s*\.\s*\w`, 'i').test(code),
            `${file} references ${schema}. — use the owning module's public surface`
          ).toBe(false);
        }
      }
    }
  });

  it('permits only the two documented cross-schema closure reads, and only as reads', () => {
    // The allow-list must stay small and must never cover a write. If a later wave
    // needs a third exception, this assertion makes adding it a visible decision
    // rather than a quiet one.
    expect(PERMITTED_CROSS_SCHEMA).toHaveLength(2);
    for (const entry of PERMITTED_CROSS_SCHEMA) {
      expect(entry.why.length).toBeGreaterThan(20);
      const file = join(ROOT, 'src', 'modules', entry.module, 'data', entry.file);
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      // The exception must still be USED. A stale entry would silently widen the
      // guard for a file that no longer needs it.
      const ref = new RegExp(String.raw`(^|[^\w."'])${entry.schema}\s*\.\s*\w`, 'i');
      expect(
        ref.test(code),
        `${entry.file} no longer reads ${entry.schema}. — remove the exception`
      ).toBe(true);
      // Read-only. No write verb may precede the foreign schema anywhere in the file.
      const write = new RegExp(
        String.raw`(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO)\s+"?${entry.schema}"?\s*\.`,
        'i'
      );
      expect(write.test(code), `${entry.file} WRITES to ${entry.schema}. — never permitted`).toBe(
        false
      );
    }
  });

  it('keeps the domain layer free of database access', () => {
    for (const moduleName of MODULES) {
      for (const file of moduleFiles(moduleName)) {
        if (!file.replace(/\\/g, '/').includes('/domain/')) continue;
        // Comments are stripped, as in the guard above. An earlier version did not,
        // so a domain doc comment containing the word "SELECT" would have failed the
        // build — the inverse of its sibling twenty lines up, and the sort of
        // inconsistency that gets a guard weakened rather than fixed.
        const code = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        // Any db import shape, not only the trailing-slash form: `@/server/db` with
        // no slash and relative paths both evaded the earlier `toContain` check.
        expect(code, `${file} imports database access into the domain layer`).not.toMatch(
          /from\s+['"](@\/server\/db|[./]+\/(server\/)?db)/
        );
        // Case-insensitive, and covering the statements the earlier version missed.
        expect(code, `${file} contains SQL`).not.toMatch(
          /\b(SELECT|INSERT|UPDATE|DELETE|MERGE|CALL)\s/i
        );
      }
    }
  });

  it('does not mirror the work-order or job transition graph in TypeScript', () => {
    // The graph is rows in wo.work_order_transitions / wo.job_transitions and a
    // tenant may shadow the platform edges. A literal here would refuse legitimate
    // tenant edges and drift the moment an edge is added or deactivated.
    //
    // Scans EVERY layer of EVERY P1-19 module, not just work-order/domain: a mirror
    // is at least as likely in a service, and `job.state-changed` makes technician a
    // natural home for a job-graph copy. Covers the full seeded vocabulary rather
    // than four sampled states, and both quoting styles plus the bare object-key
    // form — `{ in_progress: { qc_pending: true } }` is the most idiomatic way a
    // mirror would actually be written, and quote-only matching missed it.
    // Only states that are UNAMBIGUOUS markers of the wo/job graph. `draft`,
    // `in_progress`, `completed` and `cancelled` are deliberately excluded: they are
    // equally members of `REPORT_STATUSES` and `TEMPLATE_VERSION_STATUSES`, which
    // `diagnostics` legitimately owns because they ARE CHECK constraints there. A
    // guard that flagged those would be telling a module not to declare its own
    // vocabulary, and the only way to keep it green would be to weaken it.
    const states = [
      'open',
      'awaiting_parts',
      'awaiting_customer',
      'qc_pending',
      'ready_to_close',
      'planned',
      'assigned',
      'paused',
    ];
    for (const moduleName of MODULES) {
      for (const file of moduleFiles(moduleName)) {
        const code = readFileSync(file, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        for (const state of states) {
          // The object-key form is `(?<![\w.-])` rather than `\b`, and that
          // distinction is load-bearing in both directions. `\b` matched
          // `` `job.assigned:${id}` `` — an EVENT KEY, whose `job.assigned` is the
          // catalog's own wire name and has nothing to do with the job graph — so the
          // guard flagged the one place that reads the catalog correctly. Excluding a
          // preceding `.`/`-`/word character keeps a bare `assigned:` object key
          // (which IS how a mirror gets written) failing, while a dotted event or
          // permission name passes. The quoted-literal alternative is untouched, so
          // `'assigned'` on its own still trips.
          expect(
            new RegExp(String.raw`(['"\`]${state}['"\`]|(?<![\w.-])${state}\s*:)`).test(code),
            `${file} names the graph state "${state}" — read the catalog, do not mirror it`
          ).toBe(false);
        }
      }
    }
  });

  it('constructs every module composition root without throwing', () => {
    // The four factories are otherwise never invoked anywhere in src/ or tests/, so
    // a mis-wired `composeModule` would ship undetected until Wave 4 imported one.
    for (const factory of [workOrderModule, technicianModule, diagnosticsModule, qualityModule]) {
      const services = factory();
      expect(Object.keys(services).length).toBeGreaterThan(0);
      // composeModule memoises; the same instance must come back.
      expect(factory()).toBe(services);
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
      // Reserved is not implemented, and the reverse holds too: an entry claims a
      // phase ONLY once a wave publishes it. Wave 4 publishes
      // `work-order.state-changed` and `work-order.closed`; Wave 5 publishes
      // `job.state-changed`, `job.assigned` and `labor.session-changed`; Wave 6
      // publishes `additional-work.requested` and `customer-approval.recorded`.
      // Everything else in this phase's allocation is still a reserved name, and a
      // name that started claiming an implementation without a producer is a
      // documentation defect this assertion exists to catch.
      const published = [
        'work-order.state-changed',
        'work-order.closed',
        'job.state-changed',
        'job.assigned',
        'labor.session-changed',
        'additional-work.requested',
        'customer-approval.recorded',
      ];
      if (published.includes(entry.eventType)) {
        expect(entry.implementedIn).toBe('P1-19');
      } else {
        expect(entry.implementedIn).toBeNull();
      }
    }
  });

  it('decides certification expiry inclusively, from a calendar date not an instant', () => {
    // A DATE column arrives as 'YYYY-MM-DD'. The earlier signature took the
    // driver's Date and read it with getUTC*, which is wrong east of Greenwich:
    // postgres-date builds LOCAL midnight, so at UTC+3 '2026-07-26' became
    // 2026-07-25T21:00Z and getUTCDate() returned 25. This fixture is the string
    // the repository now selects with to_char, so the test exercises the real shape.
    const expires = '2026-07-26';
    expect(certificationIsValidOn(expires, 'active', new Date('2026-07-26T18:00:00Z'))).toBe(true);
    expect(certificationIsValidOn(expires, 'active', new Date('2026-07-26T00:00:00Z'))).toBe(true);
    expect(certificationIsValidOn(expires, 'active', new Date('2026-07-25T23:00:00Z'))).toBe(true);
    expect(certificationIsValidOn(expires, 'active', new Date('2026-07-27T00:30:00Z'))).toBe(false);
    // No expiry means it does not expire.
    expect(certificationIsValidOn(null, 'active', new Date('2027-01-01T00:00:00Z'))).toBe(true);
    // A non-active status disqualifies in BOTH branches. An earlier version checked
    // it only when expiresOn was null, so a row marked 'expired' with a future date
    // passed as valid.
    expect(certificationIsValidOn(null, 'revoked', new Date('2026-01-01T00:00:00Z'))).toBe(false);
    expect(certificationIsValidOn(null, 'expired', new Date('2026-01-01T00:00:00Z'))).toBe(false);
    expect(certificationIsValidOn('2027-01-01', 'revoked', new Date('2026-01-01T00:00:00Z'))).toBe(
      false
    );
    expect(certificationIsValidOn('2027-01-01', 'expired', new Date('2026-01-01T00:00:00Z'))).toBe(
      false
    );
  });

  it('covers a job window with the UNION of availability rows, not a single row', () => {
    // ex_technician_availability_overlap excludes on tstzrange with &&, and
    // half-open [08,12) and [12,17) do not overlap — a split shift is two legal
    // rows. Asking whether any ONE spans 09:00-13:00 answers no for a technician
    // available for every minute of it.
    const shift = [
      { from: new Date('2026-07-26T08:00:00Z'), to: new Date('2026-07-26T12:00:00Z') },
      { from: new Date('2026-07-26T12:00:00Z'), to: new Date('2026-07-26T17:00:00Z') },
    ];
    expect(
      coveredByUnion(shift, new Date('2026-07-26T09:00:00Z'), new Date('2026-07-26T13:00:00Z'))
    ).toBe(true);
    expect(
      coveredByUnion(shift, new Date('2026-07-26T08:00:00Z'), new Date('2026-07-26T17:00:00Z'))
    ).toBe(true);
    // A real gap is not covered.
    const gapped = [
      { from: new Date('2026-07-26T08:00:00Z'), to: new Date('2026-07-26T11:00:00Z') },
      { from: new Date('2026-07-26T12:00:00Z'), to: new Date('2026-07-26T17:00:00Z') },
    ];
    expect(
      coveredByUnion(gapped, new Date('2026-07-26T09:00:00Z'), new Date('2026-07-26T13:00:00Z'))
    ).toBe(false);
    expect(
      coveredByUnion([], new Date('2026-07-26T09:00:00Z'), new Date('2026-07-26T13:00:00Z'))
    ).toBe(false);
    // Unsorted input must not change the verdict.
    expect(
      coveredByUnion(
        [shift[1]!, shift[0]!],
        new Date('2026-07-26T09:00:00Z'),
        new Date('2026-07-26T13:00:00Z')
      )
    ).toBe(true);
  });

  it('treats overlap as half-open and skill level as inclusive', () => {
    const from = new Date('2026-07-26T08:00:00Z');
    const to = new Date('2026-07-26T12:00:00Z');
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
