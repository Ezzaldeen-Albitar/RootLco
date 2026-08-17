import { describe, expect, it } from 'vitest';
import {
  CLASSIFICATIONS,
  DAY_ONE_NOT_YET_WIRED,
  literalUnionParameters,
  mutationCallSites,
  normaliseRoutePath,
  normaliseSourcePaths,
  pathHelpers,
  recordedDecisions,
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

/**
 * The screen that consumes both adapters.
 *
 * Without it neither adapter is reachable, which is the point: Wave A landed
 * the whole reception adapter surface before its screens, so "a module sends
 * the write" and "somebody can invoke it" came apart in the live tree. Every
 * fixture that expects REACHABLE has to name its consumer, exactly as the real
 * tree does.
 */
const SCREEN = `
'use client';
import { bookSyntheticAction } from '../booking-actions';
import { approveSyntheticAction } from '../../synthetic-receptions/approve-actions';
export function SyntheticDeskScreen() {
  return [bookSyntheticAction, approveSyntheticAction];
}
`;

/**
 * The helper shape the reception adapters really use: one template over the
 * API prefix, an opaque interpolation for the identifier and a tail the call
 * site supplies. The READ through the same helper must stay invisible.
 */
const HELPER_CALLER = `
'use server';
function synthPath(receptionId: string, tail = ''): string {
  return \`/api/v1/synthetic-receptions/\${encodeURIComponent(receptionId)}\${tail}\`;
}
export async function sealSyntheticVisit(receptionId, input) {
  return client.send('POST', synthPath(receptionId, '/seal'), input);
}
export async function readSyntheticVisit(receptionId) {
  return client.get(synthPath(receptionId));
}
`;

/** The screen that reaches the helper-built write. */
const SEAL_SCREEN = `
'use client';
import { sealSyntheticVisit } from '../seal-actions';
export function SyntheticSealScreen() {
  return sealSyntheticVisit;
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

/**
 * The synthetic §7 — the decisions a `decisionRef` may resolve against.
 *
 * Injected for the same reason the register and the high-water mark are: the
 * gate reads the REAL canonical plan in production, and a suite that let a
 * synthetic manifest borrow the real plan's decisions would be asserting
 * against a document it does not control.
 */
const decisions = ['SYN-OD-001'];

const sources: readonly (readonly [string, string])[] = [
  ['apps/web/src/features/synthetic-appointments/booking-actions.ts', BOOKING_CALLER],
  ['apps/web/src/features/synthetic-receptions/approve-actions.ts', APPROVE_CALLER],
  ['apps/web/src/features/synthetic-appointments/components/SyntheticDeskScreen.tsx', SCREEN],
];

/** Runs the gate over synthetic inputs, with optional per-case overrides. */
function judge(over: Record<string, unknown> = {}) {
  return run({ register, manifest, sources, highWater, decisions, ...over }) as {
    violations: string[];
    counts: Record<string, number>;
    results: { id: string; classification: string; callSite?: string; decisionRef?: string }[];
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
    results: { id: string; classification: string; decisionRef?: string }[];
    canonical: { id: string }[];
    decisions: string[];
    scanned: number;
    sites: number;
  };

  it('holds zero violations', () => {
    expect(live.violations).toEqual([]);
  });

  it('derives the canonical writes from the register rather than a hand list', () => {
    // 12 per the canonical plan §4, plus the two R5 terminal closes, plus the
    // 21 intake-catalogue management writes PR #227 registered, plus the eight
    // the reception evidence-contract remediation registered (Owner decisions
    // FE-012, FE-018, FE-019): the evidence binding and its finalization, the
    // capture override, the signature lifecycle event, three damage-map template
    // management writes and the capture-policy set. Pinned so a register
    // regression (the derivation returning nothing, or a whole family of writes
    // vanishing) cannot pass as "nothing to check".
    expect(live.canonical.length).toBe(43);
    expect(live.scanned).toBeGreaterThan(0);
    // Consumed mutation call sites across the WHOLE of apps/web/src, apt/rec
    // and otherwise. It is a floor rather than a pin because it is an
    // anti-vacuity condition, not a measurement of this phase: on the day this
    // branch opened the apt/rec wired count was legitimately zero and the
    // crm/veh sites were the only evidence that the scanner could see a real
    // mutation at all. The frontend waves have landed since and the floor is
    // now cleared many times over, which is exactly why it stays a floor —
    // pinning it would make every unrelated wave edit this line.
    expect(live.sites).toBeGreaterThan(0);
  });

  it('keeps every live allow-list entry inside the frozen day-one list, now empty', () => {
    // Computed against the exports, never written as literals — see the file
    // docblock for why no real operation id may appear in this file.
    //
    // THE RATCHET HAS REACHED ITS TERMINUS, and that is what the last two
    // assertions record. The day-one list froze fourteen ids and the allow-list
    // has been shrinking towards zero ever since; the last id to leave was the
    // signature write, which the capture chain wired. An empty allow-list is
    // the legal end state of a list that may only shrink — it is not the gate
    // going quiet. Nothing about the ratchet is relaxed by it: the frozen
    // fourteen stay frozen (the section below holds them), so the day a wave
    // parks anything at all, that id is either outside the high-water mark and
    // the first assertion fails, or inside it and the count assertion fails.
    // Either way the diff has to say so out loud.
    //
    // The containment assertion itself is now vacuously satisfied over an empty
    // set, which is why the falsifiability lives where it can be exercised: the
    // synthetic cases under "the ratchet refuses allow-list growth" mutate a
    // manifest into each of the two failures above and prove the gate goes red.
    const parked = live.results
      .filter((r) => r.classification === 'NOT_YET_WIRED')
      .map((r) => r.id);
    const escaped = parked.filter((id) => !DAY_ONE_NOT_YET_WIRED.includes(id));
    expect(escaped, 'an allow-list entry outside the day-one high-water mark').toEqual([]);
    expect(parked.length).toBeLessThanOrEqual(DAY_ONE_NOT_YET_WIRED.length);
    expect(parked, 'the allow-list has drained; the ratchet only shrinks').toEqual([]);
    // Through the gate's own tally as well as through its results, because a
    // count that disagreed with the rows it counted would be a gate defect no
    // assertion over `results` alone could see.
    expect(live.counts.NOT_YET_WIRED ?? 0).toBe(0);
  });

  it('pins the live DELIBERATELY_ABSENT count at exactly 25', () => {
    // WHAT THIS NUMBER MEANS, now that it has moved DOWN as well as up.
    //
    // The pin exists because DELIBERATELY_ABSENT is the sideways exit from the
    // allow-list: the ratchet does not constrain it, so reclassifying an
    // operation into it is the one manifest-only edit that could otherwise
    // slide past review. The pin forces the same diff to move this number,
    // which puts the claimed decision in front of a reviewer.
    //
    // It moved from 0 to 21 once, deliberately, and those 21 are still here:
    // the intake-catalogue management writes PR #227 registered — create,
    // update and status-set across the seven catalogues. They are absent from
    // apps/web because the 35-task register is the OPERATOR surface and no
    // canonical P1-28 task binds a catalogue-administration screen; who
    // administers those catalogues, and through which surface, is an Owner
    // decision nobody has taken. It is recorded in the canonical plan §7, and
    // the case below proves the gate resolves the reference against that
    // section rather than accepting any non-empty string.
    //
    // It moved to 29 for the eight writes the reception evidence-contract
    // remediation registered, and it has now come back to 25 because four of
    // those eight LEFT. Those four are the capture chain — binding an evidence
    // version to a capture requirement, finalizing that binding, overriding a
    // requirement, and recording a signature lifecycle event. Their old
    // justification was that each needs a COMPLETED document chain and that no
    // application role could complete one: no category existed, no storage
    // provider was configured, and no version could leave `pending`. That
    // argument is spent in all three parts, and the module that enumerated the
    // three blockers no longer holds them. The reception evidence-capture
    // action and its signature twin now authorize, PUT the object server-side,
    // register the version, read it back and complete the scan, so a version
    // can reach `accepted` in the same request: the binding has a version to
    // bind, the finalization has an accepted one to count, the signature event
    // has a subject because a signature can be recorded, and the override is
    // the exception beside a control that works rather than the only way
    // through. Acceptance is a possibility and not a promise — an unreadable
    // store still leaves the version `pending` and the capture reports `bound`
    // — which is why finalization is attempted rather than assumed, and why
    // each of the four operations is genuinely called either way.
    //
    // The DIRECTION is enforced by the gate rather than by this pin, which is
    // what makes the move down as hard to fake as the moves up were: the gate
    // fails a REACHABLE claim with no production call site that something
    // outside its own module CONSUMES, and fails a DELIBERATELY_ABSENT
    // operation that IS called. The four could only leave because real call
    // sites, reached by real steps, exist — a manifest edit alone would have
    // been refused from both sides.
    //
    // So the number now reads: 25 writes whose absence is a recorded decision,
    // and every one of them is now the SAME decision. The twenty-one intake
    // catalogues, the three damage-map template management writes and the
    // capture-policy set are all reception configuration administered through a
    // surface no canonical task in this phase binds. Nothing else may join them
    // without moving this line again.
    expect(live.counts.DELIBERATELY_ABSENT ?? 0).toBe(25);
  });

  it('resolves every live DELIBERATELY_ABSENT reference against the plan §7', () => {
    // Derived rather than written as a literal: the assertion is that the
    // manifest's references and the plan's decisions are the SAME set members,
    // not that a particular identifier was typed here.
    const referenced = live.results
      .filter((r) => r.classification === 'DELIBERATELY_ABSENT')
      .map((r) => r.decisionRef);
    expect(referenced).toHaveLength(25);
    expect(live.decisions.length).toBeGreaterThan(0);
    const unresolved = referenced.filter((ref) => !ref || !live.decisions.includes(ref));
    expect(unresolved, 'a decisionRef naming no decision recorded in the plan §7').toEqual([]);
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

  it('fails a DELIBERATELY_ABSENT entry with no reason', () => {
    // The decision says why the surface is withheld; the reason says which
    // operation this is and what it would have administered. A resolvable
    // reference alone would let twenty-one entries share one sentence and say
    // nothing about any of them individually.
    const report = judge({
      manifest: withEntry('rec.synthetic-erase', {
        classification: 'DELIBERATELY_ABSENT',
        decisionRef: 'SYN-OD-001',
      }),
    });
    expect(report.violations.join('\n')).toContain('no reason');
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

describe('a decisionRef must name a decision that exists', () => {
  /*
   * The refutation this section closes.
   *
   * `DELIBERATELY_ABSENT` is the one classification the ratchet does not
   * constrain, so it is the exit an author under pressure reaches for. The
   * gate used to check only that the reference was a non-empty string, and an
   * adversarial refuter walked a fabricated `decisionRef: 'FAKE-DECISION-999'`
   * straight through — which makes the whole route worthless, because a
   * made-up reference reads exactly like an approved one. The gate now
   * RESOLVES the reference against the decisions recorded in the canonical
   * plan §7, and the first case below is that refutation, kept as a fixture.
   */
  it('fails a decisionRef that names no recorded decision', () => {
    const report = judge({
      manifest: withEntry('rec.synthetic-erase', {
        classification: 'DELIBERATELY_ABSENT',
        decisionRef: 'FAKE-DECISION-999',
        reason: 'a fabricated reference, in the shape the refuter used',
      }),
    });
    expect(report.violations.join('\n')).toContain('rec.synthetic-erase');
    expect(report.violations.join('\n')).toContain('FAKE-DECISION-999');
    expect(report.violations.join('\n')).toContain('names no decision recorded');
  });

  it('names what it DID find, so the failure is actionable', () => {
    const report = judge({
      manifest: withEntry('rec.synthetic-erase', {
        classification: 'DELIBERATELY_ABSENT',
        decisionRef: 'SYN-OD-002',
        reason: 'one digit away from the recorded decision',
      }),
    });
    expect(report.violations.join('\n')).toContain('SYN-OD-001');
  });

  it('refuses everything when the plan records no decision at all', () => {
    // An empty §7 is not a licence. The classification survives only as long
    // as the document behind it does.
    const report = judge({ decisions: [] });
    expect(report.violations.join('\n')).toContain('rec.synthetic-erase');
    expect(report.violations.join('\n')).toContain('(none)');
  });

  it('reads §7 headings by shape, and stops at the next top-level section', () => {
    const PLAN = [
      '## 6. Scope boundary',
      '',
      '### `SYN-OD-900` — a decision recorded in the WRONG section',
      '',
      '## 7. Open decisions',
      '',
      '### `SYN-OD-001` — a decision · **OPEN**',
      '',
      'Body text mentioning `SYN-OD-777` in prose, which is not a heading.',
      '',
      '### A decision identified only by its topic · **OPEN**',
      '',
      '### `SYN-OD-002` — another decision',
      '',
      '## 8. Owner acceptance',
      '',
      '### `SYN-OD-901` — after the section closed',
    ].join('\n');

    // Only the two backticked ids INSIDE §7. The topic-only heading carries no
    // identifier, so nothing can reference it and the gate invents none; the
    // ids in §6 and §8 are outside the section; the prose mention is not a
    // heading.
    expect(recordedDecisions(PLAN)).toEqual(['SYN-OD-001', 'SYN-OD-002']);
  });

  it('refuses a backticked heading that is not an identifier', () => {
    // A `###` heading may legitimately open with a backticked file or field
    // name. Requiring at least two dash-separated capitalised segments keeps
    // those from passing themselves off as decisions.
    const PLAN = [
      '## 7. Open decisions',
      '',
      '### `canonical-plan.md` — a file, not a decision',
      '',
      '### `receivingEmployeeId` — a field, not a decision',
      '',
      '### `SYN-OD-001` — a decision',
    ].join('\n');
    expect(recordedDecisions(PLAN)).toEqual(['SYN-OD-001']);
  });

  it('returns null — not an empty list — when the section is absent', () => {
    // The distinction is the whole anti-vacuity argument: "no §7" means the
    // check cannot run (the production path exits 2), while "an empty §7"
    // means no decision exists and every reference must fail. Collapsing the
    // two would make a document refactor look like a clean run.
    expect(recordedDecisions('## 6. Scope boundary\n\n## 8. Owner acceptance\n')).toBeNull();
    expect(recordedDecisions('## 7. Open decisions\n\nNo decisions yet.\n')).toEqual([]);
  });

  it('resolves the decisions the REAL canonical plan records', () => {
    // The live half. Without it the resolver could be reading a shape this
    // repository's plan does not use, and every synthetic case above would
    // still pass.
    const live = run() as { decisions: string[] };
    expect(live.decisions.length).toBeGreaterThan(0);
    for (const id of live.decisions) expect(id).toMatch(/^[A-Z][A-Z0-9]*(-[A-Z0-9]+)+$/);
    expect(live.decisions).not.toContain('FAKE-DECISION-999');
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

  it('refuses to let a READ borrow a nearby write-method literal', () => {
    // The refuter's window-borrowing scenario, kept as the regression fixture.
    // The first matcher accepted any write-method literal within a
    // 2000-character look-behind, so a `client.get(...)` READ placed after a
    // genuine write in the same file was credited with that write's method and
    // reported as a mutation site — the live tree carried exactly this shape
    // (a VIN-uniqueness probe read forty lines below a PATCH). Only a method
    // literal standing as the argument IMMEDIATELY before the path counts.
    const BORROWED_READ = `
export async function recordSyntheticThing(previous, form) {
  const w = await client.send('POST', '/api/v1/synthetic-other-things', parsed.data);
  return w;
}
export async function probeSyntheticSeal(id) {
  const r = await client.get(\`/api/v1/synthetic-receptions/\${encodeURIComponent(id)}/seal\`);
  return r;
}
`;
    // The unit half: the genuine write is the ONLY site; the read's path,
    // although the 'POST' literal sits well inside the old window, is not one.
    expect(mutationCallSites(BORROWED_READ)).toEqual([
      {
        method: 'POST',
        path: '/api/v1/synthetic-other-things',
        owner: 'recordSyntheticThing',
      },
    ]);

    // The whole-judgement half: the allow-listed seal write must NOT be
    // reported as called on the borrowed read's evidence. Under the old
    // matcher this fixture produced the "IS called from" violation; under the
    // adjacency rule the tree stays green.
    const report = judge({
      sources: [
        ...sources,
        ['apps/web/src/features/synthetic-receptions/probe.ts', BORROWED_READ] as const,
      ],
    });
    expect(report.violations).toEqual([]);
  });
});

describe('a path built by a helper is still a call site', () => {
  /*
   * The defect this section closes. Two reception writes were wired by their
   * screen and still sat allow-listed, because the adapter builds the path with
   * a `visitPath(id, tail)` helper and the scanner only ever read inline
   * literals. An allow-list entry whose reason blames the gate is the gate
   * declining to answer its own question.
   *
   * Their real identifiers are deliberately absent — see the file docblock: the
   * register credits a test file to every operation it NAMES, so writing them
   * here would report this suite as coverage for operations it never exercises.
   */
  it('resolves a helper call to the path it builds, and ignores the READ through it', () => {
    expect(mutationCallSites(HELPER_CALLER)).toEqual([
      {
        method: 'POST',
        path: '/api/v1/synthetic-receptions/:p/seal',
        owner: 'sealSyntheticVisit',
      },
    ]);
  });

  it('reads the helper by shape — parameters, defaults and opaque interpolations', () => {
    const helper = pathHelpers(HELPER_CALLER).get('synthPath');
    expect(helper).toBeDefined();
    expect(helper.params.map((p: { name: string }) => p.name)).toEqual(['receptionId', 'tail']);
    // The tail's default is what makes `synthPath(id)` a bare visit path
    // rather than a path with an unknown segment glued to its end.
    expect(helper.params[1].default).toBe('');
    // `${encodeURIComponent(receptionId)}` names no parameter, so it is a
    // value, not a slot — which is what makes the resolved path comparable to
    // the register's `{receptionId}`.
    expect(helper.segments.map((s: { kind: string }) => s.kind)).toEqual([
      'literal',
      'opaque',
      'literal',
      'slot',
      'literal',
    ]);
  });

  it('refuses to vouch for a path the call site does not spell out', () => {
    // An UNTYPED variable tail builds an unknown segment. The gate must not
    // guess which terminal command it is: the tail is glued straight onto the
    // identifier, so the resolved `:p:p` matches no registered route and every
    // operation it could have been stays unreached.
    const VARIABLE_TAIL = `
function synthPath(receptionId, tail = '') {
  return \`/api/v1/synthetic-receptions/\${encodeURIComponent(receptionId)}\${tail}\`;
}
export async function closeSyntheticVisit(receptionId, tail) {
  return client.send('POST', synthPath(receptionId, tail), {});
}
`;
    expect(mutationCallSites(VARIABLE_TAIL)).toEqual([
      {
        method: 'POST',
        path: '/api/v1/synthetic-receptions/:p:p',
        owner: 'closeSyntheticVisit',
      },
    ]);
    expect(normaliseRoutePath('/api/v1/synthetic-receptions/{receptionId}/seal')).not.toBe(
      '/api/v1/synthetic-receptions/:p:p'
    );
  });

  /*
   * The Waves F/G extension, and the reason it is an extension rather than a
   * loosening.
   *
   * The real reception adapter forwards a tail typed
   * `'/close-without-work' | '/refuse'` through `visitPath`, so the two terminal
   * exits were wired by their screen while this gate could see neither path.
   * The type has already enumerated what the call can be, and a value outside
   * the union is a compile error — so expanding it reports exactly the paths the
   * code can build, and never one it cannot. The untyped case above is what
   * proves the two are distinguished.
   */
  it('enumerates a tail typed as a union of string literals', () => {
    const TYPED_TAIL = `
function synthPath(receptionId: string, tail = ''): string {
  return \`/api/v1/synthetic-receptions/\${encodeURIComponent(receptionId)}\${tail}\`;
}
export async function endSyntheticVisit(
  receptionId: string,
  tail: '/seal' | '/void',
  input: unknown
) {
  return client.send('POST', synthPath(receptionId, tail), input);
}
`;
    expect(mutationCallSites(TYPED_TAIL)).toEqual([
      {
        method: 'POST',
        path: '/api/v1/synthetic-receptions/:p/seal',
        owner: 'endSyntheticVisit',
      },
      {
        method: 'POST',
        path: '/api/v1/synthetic-receptions/:p/void',
        owner: 'endSyntheticVisit',
      },
    ]);
  });

  it('reads a literal union by SHAPE, and treats every other annotation as unknown', () => {
    expect([...literalUnionParameters(["tail: '/seal' | '/void'"]).entries()]).toEqual([
      ['tail', ['/seal', '/void']],
    ]);
    // Everything a union of string literals is NOT stays opaque, which is the
    // failing-closed half of the rule.
    for (const parameter of [
      'tail: string',
      'tail: Tail',
      "tail: '/seal' | string",
      "tail: '/seal'",
      'tail',
      'receptionId: string',
      'tail: `/seal` | `/void`',
    ]) {
      expect(literalUnionParameters([parameter]).size, parameter).toBe(0);
    }
  });

  it('still collapses a typed union that reaches a DIFFERENT function’s parameter', () => {
    // The union is read off the function that ENCLOSES the call. A same-named
    // parameter on an unrelated function must not vouch for this one.
    const ELSEWHERE = `
function synthPath(receptionId: string, tail = ''): string {
  return \`/api/v1/synthetic-receptions/\${encodeURIComponent(receptionId)}\${tail}\`;
}
export function unrelated(tail: '/seal' | '/void') {
  return tail;
}
export async function endSyntheticVisit(receptionId: string, tail: string) {
  return client.send('POST', synthPath(receptionId, tail), {});
}
`;
    expect(mutationCallSites(ELSEWHERE)).toEqual([
      {
        method: 'POST',
        path: '/api/v1/synthetic-receptions/:p:p',
        owner: 'endSyntheticVisit',
      },
    ]);
  });

  it('flips an allow-listed write once its helper-built call site is consumed', () => {
    const report = judge({
      manifest: withEntry('rec.synthetic-seal', { classification: 'REACHABLE' }),
      sources: [
        ...sources,
        ['apps/web/src/features/synthetic-receptions/seal-actions.ts', HELPER_CALLER] as const,
        [
          'apps/web/src/features/synthetic-receptions/components/SyntheticSealScreen.tsx',
          SEAL_SCREEN,
        ] as const,
      ],
    });
    expect(report.violations).toEqual([]);
    const seal = report.results.find((r) => r.id === 'rec.synthetic-seal');
    expect(seal?.callSite).toBe('apps/web/src/features/synthetic-receptions/seal-actions.ts');
  });
});

describe('an adapter nobody consumes is not reachability', () => {
  /*
   * The falsifiability proof, in the shape this phase actually produced: Wave A
   * landed every reception adapter before the screens, so a write can have a
   * real `client.send('POST', …)` call site and still be invocable by nobody.
   * If teaching the gate the helper had stopped at "a path was found", five
   * screenless writes would have flipped to REACHABLE and the allow-list would
   * have emptied itself — INT-113 certified by the gate built to catch it.
   */
  const UNCONSUMED = [
    'apps/web/src/features/synthetic-receptions/seal-actions.ts',
    HELPER_CALLER,
  ] as const;

  it('fails a REACHABLE claim backed only by the adapter that declares it', () => {
    const report = judge({
      manifest: withEntry('rec.synthetic-seal', { classification: 'REACHABLE' }),
      sources: [...sources, UNCONSUMED],
    });
    expect(report.violations.join('\n')).toContain('rec.synthetic-seal');
    expect(report.violations.join('\n')).toContain('no production call site');
  });

  it('leaves the same write honestly allow-listed, with no violation', () => {
    const report = judge({ sources: [...sources, UNCONSUMED] });
    expect(report.violations).toEqual([]);
    expect(report.results.find((r) => r.id === 'rec.synthetic-seal')?.classification).toBe(
      'NOT_YET_WIRED'
    );
  });

  it('does not accept a docblock naming the adapter as consumption', () => {
    // A sentence about a function is not a call to it. This repository's
    // docblocks name adapters constantly, so an unstripped scan would have made
    // every write reachable by prose — the scanner-reads-prose defect this
    // phase has now shipped seven times.
    const report = judge({
      manifest: withEntry('rec.synthetic-seal', { classification: 'REACHABLE' }),
      sources: [
        ...sources,
        UNCONSUMED,
        [
          'apps/web/src/features/synthetic-receptions/notes.ts',
          '/** sealSyntheticVisit will be reached by the sealing screen. */\nexport const x = 1;',
        ] as const,
      ],
    });
    expect(report.violations.join('\n')).toContain('no production call site');
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
