import { describe, expect, it } from 'vitest';
import {
  CLASSIFICATIONS,
  DAY_ONE_NOT_YET_WIRED,
  mutationCallSites,
  normaliseRoutePath,
  normaliseSourcePaths,
  run,
  stripComments,
} from '../../scripts/ci/check-p1-28-write-reachability.mjs';

/**
 * The P1-28 write-reachability gate (SEC-004), mutation-tested.
 *
 * ## Why a gate needs its own tests
 *
 * The gate exists because ten canonical P1-27 writes shipped fully registered
 * and no screen could invoke them (INT-113), while every automated tier was
 * green. A gate that asserted the same thing wrongly would be that defect one
 * level up. Every synthetic case below MUTATES an input and asserts the gate
 * goes red; a gate that cannot be made to fail is not a gate.
 *
 * ## Why every fixture id and route below is deliberately fictional
 *
 * `scripts/p1-24-operation-register.mjs` builds each operation's `tests`
 * evidence list by searching test files for its identifier, so a real id here
 * would be credited as coverage for an operation this suite never exercises.
 * The P1-27 twin of this file learned that the hard way — see its docblock.
 * The fictional ids keep the `apt.` / `rec.` prefixes the gate filters on, so
 * they are still derived as canonical writes, while matching nothing real.
 * The live-tree cases below reference the real allow-list only through the
 * exported values, never as literals.
 */

/** A production file that really does call the booking write, in the real shape. */
const BOOKING_CALLER = `
'use server';
export async function bookSyntheticAction(previous, form) {
  const result = await client.send('POST', '/api/v1/synthetic-appointments', parsed.data);
}
`;

/** The CRM-style helper shape: method literal before the path. */
const APPROVE_CALLER = `
'use server';
export async function approveSyntheticAction(id, previous, form) {
  return write(
    previous,
    () => ({ ok: true, body: {} }),
    'POST',
    \`/api/v1/synthetic-receptions/\${encodeURIComponent(id)}/approve\`,
    'k'
  );
}
`;

const register = {
  operations: [
    {
      id: 'apt.synthetic-book',
      method: 'POST',
      route: '/api/v1/synthetic-appointments',
    },
    {
      id: 'rec.synthetic-approve',
      method: 'POST',
      route: '/api/v1/synthetic-receptions/{receptionId}/approve',
    },
    {
      id: 'rec.synthetic-seal',
      method: 'POST',
      route: '/api/v1/synthetic-receptions/{receptionId}/seal',
    },
    {
      id: 'rec.synthetic-erase',
      method: 'POST',
      route: '/api/v1/synthetic-receptions/{receptionId}/erase',
    },
    // A GET on the SAME path as the approve write. Present so the suite proves
    // the gate does not treat a read as evidence for its write.
    {
      id: 'rec.synthetic-approve-read',
      method: 'GET',
      route: '/api/v1/synthetic-receptions/{receptionId}/approve',
    },
  ],
};

const manifest = {
  operations: {
    'apt.synthetic-book': { classification: 'REACHABLE' },
    'rec.synthetic-approve': { classification: 'REACHABLE' },
    'rec.synthetic-seal': {
      classification: 'NOT_YET_WIRED',
      reason: 'the synthetic sealing screen has not landed',
    },
    'rec.synthetic-erase': {
      classification: 'DELIBERATELY_ABSENT',
      decisionRef: 'SYN-OD-001',
      reason: 'a synthetic open decision',
    },
  },
};

/** The synthetic day-one high-water mark: only the seal write may be parked. */
const highWater = ['rec.synthetic-seal'];

const sources: readonly (readonly [string, string])[] = [
  ['apps/web/src/features/synthetic-appointments/booking-actions.ts', BOOKING_CALLER],
  ['apps/web/src/features/synthetic-receptions/approve-actions.ts', APPROVE_CALLER],
];

/** Runs the gate over synthetic inputs, with optional per-case overrides. */
function judge(over: Record<string, unknown> = {}) {
  return run({ register, manifest, sources, highWater, ...over }) as {
    violations: string[];
    counts: Record<string, number>;
    results: { id: string; classification: string; callSite?: string }[];
  };
}

/** One manifest with a single entry replaced (or added). */
function withEntry(id: string, entry: unknown) {
  return { operations: { ...manifest.operations, [id]: entry } };
}

describe('the gate is green on the CURRENT tree', () => {
  // The one live case: no injection, the real register, the real manifest, the
  // real apps/web/src walk and the frozen day-one list. Green today because
  // every canonical apt/rec write is legitimately allow-listed — and this case
  // is what turns red the day a wave lands a call site without shrinking the
  // allow-list, or a new write is registered without being classified.
  const live = run() as {
    violations: string[];
    counts: Record<string, number>;
    results: { id: string; classification: string }[];
    canonical: { id: string }[];
    scanned: number;
    sites: number;
  };

  it('holds zero violations', () => {
    expect(live.violations).toEqual([]);
  });

  it('derives the canonical writes from the register rather than a hand list', () => {
    // 12 per the canonical plan §4 plus the two R5 terminal closes. Pinned so
    // a register regression (the derivation returning nothing) cannot pass as
    // "nothing to check".
    expect(live.canonical.length).toBe(14);
    expect(live.scanned).toBeGreaterThan(0);
    // The crm/veh call sites prove the scanner works even while the apt/rec
    // wired count is legitimately zero.
    expect(live.sites).toBeGreaterThan(0);
  });

  it('keeps every live allow-list entry inside the frozen day-one list', () => {
    // Computed against the exports, never written as literals — see the file
    // docblock for why no real operation id may appear in this file.
    const parked = live.results
      .filter((r) => r.classification === 'NOT_YET_WIRED')
      .map((r) => r.id);
    const escaped = parked.filter((id) => !DAY_ONE_NOT_YET_WIRED.includes(id));
    expect(escaped, 'an allow-list entry outside the day-one high-water mark').toEqual([]);
    expect(parked.length).toBeLessThanOrEqual(DAY_ONE_NOT_YET_WIRED.length);
  });
});

describe('the frozen day-one list itself', () => {
  it('is frozen, canonical in shape, and free of duplicates', () => {
    expect(Object.isFrozen(DAY_ONE_NOT_YET_WIRED)).toBe(true);
    expect(DAY_ONE_NOT_YET_WIRED.length).toBe(14);
    expect(new Set(DAY_ONE_NOT_YET_WIRED).size).toBe(DAY_ONE_NOT_YET_WIRED.length);
    for (const id of DAY_ONE_NOT_YET_WIRED) {
      expect(id).toMatch(/^(apt|rec)\./);
    }
  });

  it('names only writes the register actually derives as canonical', () => {
    // A typo'd day-one id fails loudly on its own — the REAL operation it
    // meant to name is UNWIRED. What fails quietly is dead weight: an id no
    // register operation matches inflates what the phase may park without
    // ever being exercised. Every id must be canonical.
    const live = run() as { canonical: { id: string }[] };
    const canonicalIds = new Set(live.canonical.map((op) => op.id));
    const dead = DAY_ONE_NOT_YET_WIRED.filter((id) => !canonicalIds.has(id));
    expect(dead, 'a day-one entry no register operation matches').toEqual([]);
  });
});

describe('the gate is green on a correct synthetic tree', () => {
  it('classifies every canonical write with no violation', () => {
    const report = judge();
    expect(report.violations).toEqual([]);
    expect(report.counts.REACHABLE).toBe(2);
    expect(report.counts.NOT_YET_WIRED).toBe(1);
    expect(report.counts.DELIBERATELY_ABSENT).toBe(1);
  });

  it('does not classify GET operations at all', () => {
    const report = judge();
    expect(report.results.map((r) => r.id)).not.toContain('rec.synthetic-approve-read');
  });

  it('records the file that makes each REACHABLE operation reachable', () => {
    const book = judge().results.find((r) => r.id === 'apt.synthetic-book');
    expect(book?.callSite).toBe('apps/web/src/features/synthetic-appointments/booking-actions.ts');
  });
});

describe('a fabricated unreached write fails the gate', () => {
  it('fails an operation the manifest does not mention as UNWIRED — INT-113 recurring', () => {
    const report = judge({
      manifest: withEntry('rec.synthetic-approve', undefined),
    });
    expect(report.violations.join('\n')).toContain('UNWIRED: rec.synthetic-approve');
    expect(report.violations.join('\n')).toContain('INT-113');
  });

  it('fails a REACHABLE claim whose call site was deleted', () => {
    const report = judge({
      sources: sources.filter(
        ([p]) => p !== 'apps/web/src/features/synthetic-receptions/approve-actions.ts'
      ),
    });
    expect(report.violations.join('\n')).toContain('rec.synthetic-approve');
    expect(report.violations.join('\n')).toContain('no production call site');
  });
});

describe('the ratchet refuses allow-list growth', () => {
  it('fails a NOT_YET_WIRED entry whose id is not on the day-one list', () => {
    // The wave that "temporarily" parks a wired operation, or classifies a
    // newly registered write as not-yet-wired. Both are the loosening this
    // gate exists to refuse.
    const report = judge({
      manifest: withEntry('rec.synthetic-erase', {
        classification: 'NOT_YET_WIRED',
        reason: 'trying to grow the allow-list',
      }),
    });
    expect(report.violations.join('\n')).toContain('rec.synthetic-erase');
    expect(report.violations.join('\n')).toContain('the ratchet only shrinks');
  });

  it('fails an allow-listed operation that IS called — the flip that shrinks the list', () => {
    const report = judge({
      sources: [
        ...sources,
        [
          'apps/web/src/features/synthetic-receptions/seal-actions.ts',
          `const r = await client.send('POST', \`/api/v1/synthetic-receptions/\${encodeURIComponent(id)}/seal\`, b);`,
        ] as const,
      ],
    });
    expect(report.violations.join('\n')).toContain('rec.synthetic-seal');
    expect(report.violations.join('\n')).toContain('IS called from');
    expect(report.violations.join('\n')).toContain('shrink the allow-list');
  });

  it('accepts the list shrinking: a wired operation leaves with no test edit', () => {
    // The ratchet must tighten silently. Flipping the seal write to REACHABLE
    // (with its call site landed) leaves the day-one list untouched and green.
    const report = judge({
      manifest: withEntry('rec.synthetic-seal', { classification: 'REACHABLE' }),
      sources: [
        ...sources,
        [
          'apps/web/src/features/synthetic-receptions/seal-actions.ts',
          `const r = await client.send('POST', \`/api/v1/synthetic-receptions/\${encodeURIComponent(id)}/seal\`, b);`,
        ] as const,
      ],
    });
    expect(report.violations).toEqual([]);
    expect(report.counts.NOT_YET_WIRED ?? 0).toBe(0);
  });
});

describe('an allow-list entry must explain itself', () => {
  it('fails a NOT_YET_WIRED entry with no reason', () => {
    const report = judge({
      manifest: withEntry('rec.synthetic-seal', { classification: 'NOT_YET_WIRED' }),
    });
    expect(report.violations.join('\n')).toContain('no reason');
  });

  it('fails a NOT_YET_WIRED entry whose reason is only whitespace', () => {
    const report = judge({
      manifest: withEntry('rec.synthetic-seal', {
        classification: 'NOT_YET_WIRED',
        reason: '   ',
      }),
    });
    expect(report.violations.join('\n')).toContain('no reason');
  });

  it('fails a DELIBERATELY_ABSENT entry with no decisionRef', () => {
    const report = judge({
      manifest: withEntry('rec.synthetic-erase', { classification: 'DELIBERATELY_ABSENT' }),
    });
    expect(report.violations.join('\n')).toContain('no decisionRef');
  });

  it('fails a DELIBERATELY_ABSENT operation that IS called', () => {
    const report = judge({
      sources: [
        ...sources,
        [
          'apps/web/src/features/synthetic-receptions/erase-actions.ts',
          `const r = await client.send('POST', \`/api/v1/synthetic-receptions/\${encodeURIComponent(id)}/erase\`, b);`,
        ] as const,
      ],
    });
    expect(report.violations.join('\n')).toContain('rec.synthetic-erase');
    expect(report.violations.join('\n')).toContain('the classification and the code disagree');
  });
});

describe('malformed input is a violation, never a skip', () => {
  it('fails a malformed classification', () => {
    const report = judge({
      manifest: withEntry('rec.synthetic-seal', { classification: 'PROBABLY' }),
    });
    expect(report.violations.join('\n')).toContain('malformed classification');
  });

  it('fails when the manifest classifies something that is not canonical', () => {
    const report = judge({
      manifest: withEntry('wo.synthetic-not-canonical', { classification: 'REACHABLE' }),
    });
    expect(report.violations.join('\n')).toContain('not a canonical P1-28 write');
  });
});

describe('anti-vacuity — a check that examines nothing passes everything', () => {
  it('fails when zero files are scanned', () => {
    const report = judge({ sources: [] });
    expect(report.violations.join('\n')).toContain('no files were scanned');
  });

  it('fails when zero operations are derived', () => {
    const report = judge({ register: { operations: [] } });
    expect(report.violations.join('\n')).toContain('no canonical operations were derived');
  });

  it('fails when no mutation call site exists anywhere', () => {
    const report = judge({
      sources: [['apps/web/src/features/synthetic-receptions/api.ts', 'export const x = 1;']],
    });
    expect(report.violations.join('\n')).toContain('no mutation call site was found');
  });
});

describe('what does NOT count as a call site', () => {
  it('ignores the generated idempotency manifest', () => {
    const report = judge({
      sources: [
        ...sources.filter(
          ([p]) => p !== 'apps/web/src/features/synthetic-appointments/booking-actions.ts'
        ),
        [
          'apps/web/src/lib/api/idempotent-operations.ts',
          `export const OPS = [['POST', '/api/v1/synthetic-appointments']];`,
        ] as const,
      ],
    });
    expect(report.violations.join('\n')).toContain('apt.synthetic-book');
  });

  it('ignores a path that appears only in a comment', () => {
    const report = judge({
      sources: [
        ...sources.filter(
          ([p]) => p !== 'apps/web/src/features/synthetic-appointments/booking-actions.ts'
        ),
        [
          'apps/web/src/features/synthetic-appointments/notes.ts',
          `// await client.send('POST', '/api/v1/synthetic-appointments', body);\nexport const x = 1;`,
        ] as const,
      ],
    });
    expect(report.violations.join('\n')).toContain('apt.synthetic-book');
  });

  it('ignores a READ on the same path as a write', () => {
    const report = judge({
      sources: [
        ...sources.filter(
          ([p]) => p !== 'apps/web/src/features/synthetic-receptions/approve-actions.ts'
        ),
        [
          'apps/web/src/features/synthetic-receptions/approve-actions.ts',
          `const r = await client.get(\`/api/v1/synthetic-receptions/\${encodeURIComponent(id)}/approve\`);`,
        ] as const,
      ],
    });
    expect(report.violations.join('\n')).toContain('rec.synthetic-approve');
  });
});

describe('the helpers this gate is built on', () => {
  it('strips comments without destroying a URL in a string', () => {
    const stripped = stripComments(`const u = 'https://example.test/keep'; // gone`);
    expect(stripped).toContain('/keep');
    expect(stripped).not.toContain('gone');
  });

  it('normalises a source template and a register route to the same shape', () => {
    expect(
      normaliseSourcePaths('`/api/v1/synthetic-receptions/${encodeURIComponent(id)}/approve`')
    ).toContain('/api/v1/synthetic-receptions/:p/approve');
    expect(normaliseRoutePath('/api/v1/synthetic-receptions/{receptionId}/approve')).toBe(
      '/api/v1/synthetic-receptions/:p/approve'
    );
  });

  it('does NOT collapse ordinary brace blocks in source', () => {
    // The P1-27 bug this mechanic inherited a fix for: folding `{…}` across a
    // whole file erases closures and the method markers behind them.
    const source = normaliseSourcePaths('function f() { return { ok: true }; }');
    expect(source).toContain('{ ok: true }');
    expect(mutationCallSites(APPROVE_CALLER)).toHaveLength(1);
  });

  it('publishes exactly the three classifications the phase admits', () => {
    expect([...CLASSIFICATIONS]).toEqual(['REACHABLE', 'NOT_YET_WIRED', 'DELIBERATELY_ABSENT']);
  });
});
