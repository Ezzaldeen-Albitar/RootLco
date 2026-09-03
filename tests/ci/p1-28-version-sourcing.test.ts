import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseModule } from '../../scripts/lib/typescript-source.mjs';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import {
  RENEWAL_NAMES,
  adapterRootsFromRepository,
  declaresUseServer,
  argumentsAt,
  boundNames,
  cachedNames,
  callsTo,
  classifyVersionExpression,
  declarations,
  guardedAdaptersIn,
  guardedOperations,
  parameterNames,
  renewsAfter,
  run,
  stripComments,
} from '../../scripts/ci/check-p1-28-version-sourcing.mjs';

/**
 * The P1-28 record-version sourcing gate (QA-004), mutation-tested.
 *
 * ## Why a gate needs its own tests
 *
 * This gate says a sentence nothing else in the repository can check: a
 * version-guarded command takes its `recordVersion` from a READ or from the
 * immediately prior command response. If it said that wrongly it would be the
 * defect one level up — a green check certifying a discipline nobody is keeping.
 * So every synthetic case below MUTATES an input and asserts the gate goes red;
 * a gate that cannot be made to fail is not a gate.
 *
 * ## Why every fixture id and route below is deliberately fictional
 *
 * `scripts/p1-24-operation-register.mjs` builds each operation's `tests`
 * evidence list by searching test files for its identifier, so a real id here
 * would be credited as coverage for an operation this suite never exercises.
 * The fictional ids keep the `apt.` / `rec.` prefixes the gate filters on, so
 * they are still derived as guarded, while matching nothing real.
 */

const IF_MATCH = { $ref: '#/components/parameters/IfMatch' };

/** A published document with two guarded commands and one unguarded read. */
const document = {
  paths: {
    '/api/v1/synthetic-visits/{visitId}/lock': {
      post: { operationId: 'rec.synthetic-lock', parameters: [IF_MATCH] },
    },
    '/api/v1/synthetic-visits/{visitId}/unlock': {
      post: { operationId: 'rec.synthetic-unlock', parameters: [IF_MATCH] },
    },
    '/api/v1/synthetic-visits/{visitId}': {
      get: { operationId: 'rec.synthetic-detail', parameters: [] },
    },
    // A guarded operation in another namespace, to prove the filter is real.
    '/api/v1/other-things/{id}/seal': {
      post: { operationId: 'wo.synthetic-seal', parameters: [IF_MATCH] },
    },
  },
};

const ADAPTER_ROOT = 'apps/web/src/features/synthetic';

const ADAPTER = `
'use server';
export async function lockSyntheticVisit(visitId: string, ifMatch: number, attempt = 1) {
  return client.send('POST', visitPath(visitId, '/lock'), undefined, { ifMatch });
}
export async function unlockSyntheticVisit(visitId: string, ifMatch: number, attempt = 1) {
  return client.send('POST', visitPath(visitId, '/unlock'), undefined, { ifMatch });
}
`;

/**
 * The screen, in the shape the real tree uses: the version arrives as a prop
 * from the shell that owns the detail read, and the outcome is handed back to a
 * callback the shell supplied.
 */
const SCREEN = `
'use client';
import { lockSyntheticVisit, unlockSyntheticVisit } from '../lock-actions';

export function SyntheticLockPanel({ visitId, recordVersion, settle }) {
  const [state, setState] = useState(IDLE);
  const submit = () => {
    startTransition(async () => {
      const result = await lockSyntheticVisit(visitId, recordVersion, 1);
      setState(result);
      await settle(result);
    });
  };
  return submit;
}

export function SyntheticUnlockPanel({ visitId, recordVersion, refresh }) {
  const submit = () => {
    startTransition(async () => {
      const result = await unlockSyntheticVisit(visitId, recordVersion, 1);
      await refresh();
    });
  };
  return submit;
}
`;

const sources: readonly (readonly [string, string])[] = [
  [`${ADAPTER_ROOT}/lock-actions.ts`, ADAPTER],
  [`${ADAPTER_ROOT}/components/SyntheticLockPanel.tsx`, SCREEN],
];

interface Report {
  guarded: { id: string }[];
  expected: { id: string }[];
  withheld: { id: string; decisionRef: string }[];
  adapters: { name: string; required: boolean; used: boolean }[];
  /**
   * The subset of `adapters` this contract governs — every guarded adapter
   * except the ones declared in `OUT_OF_SUBJECT_ADAPTERS`. The count equality is
   * taken over this, not over the whole tree's versioned adapters, since P1-29
   * `W3` added the first ones outside apt/rec.
   */
  accountedFor: string[];
  sites: {
    file: string;
    adapter: string;
    argument: string;
    enclosing: string | null;
    ok: boolean;
    renews?: boolean;
  }[];
  violations: string[];
}

/**
 * Runs the gate over synthetic inputs, with optional per-case overrides.
 *
 * The manifest and the decision list are injected EMPTY, so a synthetic case
 * cannot borrow the real repository's recorded decisions: every synthetic
 * guarded operation is expected to carry an adapter, exactly as before the
 * exclusion mechanism existed.
 */
function judge(over: Record<string, unknown> = {}): Report {
  return run({
    document,
    sources,
    adapterRoots: [ADAPTER_ROOT],
    manifest: { operations: {} },
    decisions: [],
    ...over,
  }) as Report;
}

/** The synthetic tree with the screen replaced. */
function withScreen(screen: string) {
  return [sources[0], [`${ADAPTER_ROOT}/components/SyntheticLockPanel.tsx`, screen]] as const;
}

/** The synthetic tree with the adapter replaced. */
function withAdapter(adapter: string) {
  return [[`${ADAPTER_ROOT}/lock-actions.ts`, adapter], sources[1]] as const;
}

/* ------------------------------------------------------------------ *
 * The live tree
 * ------------------------------------------------------------------ */

describe('the gate is green on the CURRENT tree', () => {
  const live = run() as Report;

  it('holds zero violations', () => {
    expect(live.violations).toEqual([]);
  });

  it('derives the guarded operations from the published contract', () => {
    // Twenty-two guarded operations today. Seven of them are the OPERATOR
    // commands this gate was built for — three appointment lifecycle commands,
    // and on the reception side approve, convert and the two terminal exits.
    // The other fifteen are ADMINISTRATION. Fourteen arrived with PR #227's
    // intake-catalogue contract (every catalogue amend and retirement guards on
    // `recordVersion`); the fifteenth is the damage-map template lifecycle
    // command the reception evidence-contract remediation added (Owner decision
    // FE-012), which guards for exactly the same reason. This product reaches
    // none of them: there is no catalogue-administration screen, and who
    // administers those catalogues is an open Owner decision recorded in the
    // canonical plan §7.
    //
    // Both numbers are pinned, because each fails a different way. A guarded
    // count that collapsed would pass as "nothing to check"; a withheld count
    // that grew would be this gate's subject shrinking without anybody
    // deciding to.
    expect(live.guarded).toHaveLength(22);
    expect(live.withheld).toHaveLength(15);
    expect(live.expected).toHaveLength(7);
    for (const operation of live.guarded) expect(operation.id).toMatch(/^(apt|rec)\./);
  });

  it('excuses an operation only against a decision the plan §7 records', () => {
    // The exclusion is the loosening this gate would otherwise have no defence
    // against, so it is asserted rather than assumed: every withheld operation
    // names a reference, and the run resolved each one — an unresolvable
    // reference is a violation, and the live run holds none.
    expect(live.violations).toEqual([]);
    for (const entry of live.withheld) {
      expect(entry.id).toMatch(/^(apt|rec)\.catalogue-/);
      expect(entry.decisionRef.trim().length, `${entry.id} carries no decisionRef`).toBeGreaterThan(
        0
      );
    }
    // One decision, not fifteen: a per-operation reference would be a place to
    // hide a second, unreviewed excuse.
    expect(new Set(live.withheld.map((entry) => entry.decisionRef)).size).toBe(1);
  });

  it('finds one adapter per guarded operation, each demanding a required version', () => {
    // ACCOUNTED FOR, not every guarded adapter in the tree. The walk is the
    // whole of `apps/web/src` on purpose, and since P1-29 W3 and W4 that tree
    // also holds versioned adapters for `wo` and `tech` operations — real,
    // correct, and not this contract's subject. They are declared by name in
    // `OUT_OF_SUBJECT_ADAPTERS` and still held to every rule below; the seven
    // accounted for are the apt/rec adapters this contract is about.
    expect(live.accountedFor).toHaveLength(7);
    expect(live.adapters.length).toBeGreaterThanOrEqual(live.accountedFor.length);
    for (const adapter of live.adapters) {
      expect(adapter.required, `${adapter.name} declares an optional ifMatch`).toBe(true);
      expect(adapter.used, `${adapter.name} drops its ifMatch`).toBe(true);
    }
  });

  it('traces every guarded call site to a read or a command response', () => {
    expect(live.sites.length, 'no guarded call site was found').toBeGreaterThanOrEqual(7);
    for (const site of live.sites) {
      expect(site.ok, `${site.adapter} ← ${site.argument}`).toBe(true);
      expect(site.renews, `${site.adapter} never hands the outcome onward`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The synthetic tree
 * ------------------------------------------------------------------ */

describe('the gate is green on a correct synthetic tree', () => {
  it('classifies both call sites with no violation', () => {
    const report = judge();
    expect(report.violations).toEqual([]);
    expect(report.sites).toHaveLength(2);
    expect(report.sites.every((site) => site.ok && site.renews)).toBe(true);
  });

  it('derives only the apt/rec guarded operations, never another namespace', () => {
    expect(judge().guarded.map((operation) => operation.id)).toEqual([
      'rec.synthetic-lock',
      'rec.synthetic-unlock',
    ]);
  });
});

describe('an operation is excused only by a decision that resolves', () => {
  /*
   * The exclusion mechanism, mutation-tested from all three sides.
   *
   * PR #227 published fourteen version-guarded operations this product reaches
   * from nowhere, so the adapter-equality had to learn a legitimate absence.
   * That is the one place this gate can be loosened, so every case below
   * changes an INPUT and asserts the judgement moves with it: an excuse that
   * resolves shrinks the subject, an excuse that does not is refused and
   * reported, and an excuse that swallows the whole subject fails outright.
   */
  const withheldEntry = (decisionRef: string) => ({
    operations: { 'rec.synthetic-unlock': { classification: 'DELIBERATELY_ABSENT', decisionRef } },
  });

  it('shrinks the expected set when the reference resolves', () => {
    const report = judge({
      manifest: withheldEntry('SYN-OD-001'),
      decisions: ['SYN-OD-001'],
    });
    expect(report.guarded.map((operation) => operation.id)).toEqual([
      'rec.synthetic-lock',
      'rec.synthetic-unlock',
    ]);
    expect(report.expected.map((operation) => operation.id)).toEqual(['rec.synthetic-lock']);
    expect(report.withheld).toEqual([{ id: 'rec.synthetic-unlock', decisionRef: 'SYN-OD-001' }]);
    // And the shrink is OBSERVED rather than assumed: the tree still exports
    // two guarded adapters, so the equality now fails against one.
    expect(report.violations.join('\n')).toContain('1 this application must reach');
  });

  it('refuses a reference the plan §7 does not record, and says so', () => {
    const report = judge({
      manifest: withheldEntry('FAKE-DECISION-999'),
      decisions: ['SYN-OD-001'],
    });
    expect(report.violations.join('\n')).toContain('FAKE-DECISION-999');
    expect(report.violations.join('\n')).toContain('does not record as a decision');
    // Refused, not honoured: the operation is still expected to have one.
    expect(report.expected).toHaveLength(2);
    expect(report.withheld).toEqual([]);
  });

  it('refuses an excuse that swallows the whole subject', () => {
    const report = judge({
      manifest: {
        operations: {
          'rec.synthetic-lock': {
            classification: 'DELIBERATELY_ABSENT',
            decisionRef: 'SYN-OD-001',
          },
          'rec.synthetic-unlock': {
            classification: 'DELIBERATELY_ABSENT',
            decisionRef: 'SYN-OD-001',
          },
        },
      },
      decisions: ['SYN-OD-001'],
    });
    expect(report.violations.join('\n')).toContain('a gate whose subject is empty');
  });

  it('ignores a classification that is not DELIBERATELY_ABSENT', () => {
    // NOT_YET_WIRED is the allow-list, governed by a frozen ratchet elsewhere.
    // It excuses nothing here: an operation somebody intends to wire still
    // needs an adapter before it can be wired safely.
    const report = judge({
      manifest: {
        operations: {
          'rec.synthetic-unlock': { classification: 'NOT_YET_WIRED', reason: 'later' },
        },
      },
      decisions: ['SYN-OD-001'],
    });
    expect(report.expected).toHaveLength(2);
    expect(report.withheld).toEqual([]);
  });
});

describe('a computed version fails the gate', () => {
  it('refuses sent + 1 — approve applies one edge or two, so arithmetic is wrong either way', () => {
    const report = judge({
      sources: withScreen(
        SCREEN.replace('visitId, recordVersion, 1', 'visitId, recordVersion + 1, 1')
      ),
    });
    expect(report.violations.join('\n')).toContain('lockSyntheticVisit');
    expect(report.violations.join('\n')).toContain('computes a version');
  });

  it('refuses a bare number', () => {
    const report = judge({
      sources: withScreen(SCREEN.replace('visitId, recordVersion, 1', 'visitId, 1, 1')),
    });
    expect(report.violations.join('\n')).toContain('computes a version');
  });

  it('refuses arithmetic hidden one hop away, inside a const', () => {
    // The trace is what makes this findable: the call site reads clean and the
    // defect is in the declaration above it.
    const report = judge({
      sources: withScreen(
        SCREEN.replace(
          '  const submit = () => {',
          '  const guess = recordVersion + 1;\n  const submit = () => {'
        ).replace('visitId, recordVersion, 1', 'visitId, guess, 1')
      ),
    });
    expect(report.violations.join('\n')).toContain('computes a version');
  });

  it('refuses a version laundered through Number()', () => {
    const report = judge({
      sources: withScreen(
        SCREEN.replace('visitId, recordVersion, 1', 'visitId, Number(recordVersion), 1')
      ),
    });
    expect(report.violations.join('\n')).toContain('computes a version');
  });
});

describe('a cached or untraceable version fails the gate', () => {
  it('refuses a bare useState value — that is the cached guess itself', () => {
    const report = judge({
      sources: withScreen(
        SCREEN.replace(
          '  const [state, setState] = useState(IDLE);',
          '  const [state, setState] = useState(IDLE);\n  const [held, setHeld] = useState(recordVersion);'
        ).replace('visitId, recordVersion, 1', 'visitId, held, 1')
      ),
    });
    expect(report.violations.join('\n')).toContain('holds in its own state');
  });

  it('refuses an identifier bound by nothing the file declares or receives', () => {
    const report = judge({
      sources: withScreen(SCREEN.replace('visitId, recordVersion, 1', 'visitId, mystery, 1')),
    });
    expect(report.violations.join('\n')).toContain('bound by nothing');
    expect(report.violations.join('\n')).toContain('fails closed');
  });

  it('refuses a member access that is not a recordVersion', () => {
    const report = judge({
      sources: withScreen(SCREEN.replace('visitId, recordVersion, 1', 'visitId, state.attempt, 1')),
    });
    expect(report.violations.join('\n')).toContain('not a recordVersion the server stated');
  });

  it('ACCEPTS the read-or-latest-response conditional, which is the rule written out', () => {
    const report = judge({
      sources: withScreen(
        SCREEN.replace(
          '  const submit = () => {',
          '  const chosen = fresher ? changed.recordVersion : detail.recordVersion;\n  const submit = () => {'
        ).replace('visitId, recordVersion, 1', 'visitId, chosen, 1')
      ),
    });
    expect(report.violations).toEqual([]);
  });
});

describe('a component that never renews its version fails the gate', () => {
  it('refuses a panel that commands and keeps its own counsel', () => {
    const report = judge({
      sources: withScreen(SCREEN.replace('      await settle(result);\n', '')),
    });
    expect(report.violations.join('\n')).toContain('SyntheticLockPanel');
    expect(report.violations.join('\n')).toContain('never hands the outcome onward');
  });

  it('does NOT accept writing the answer into local state as renewal', () => {
    // `setState` is declared inside the component, so it is neither a callback
    // the shell supplied nor a re-read. Caching the answer is what the rule is
    // about, so it must not satisfy the rule.
    const report = judge({
      sources: withScreen(
        SCREEN.replace('      await settle(result);\n', '      setState(result);\n')
      ),
    });
    expect(report.violations.join('\n')).toContain('never hands the outcome onward');
  });

  it('accepts a refresh-family call with no callback prop at all', () => {
    const report = judge({
      sources: withScreen(
        SCREEN.replace(
          'export function SyntheticLockPanel({ visitId, recordVersion, settle })',
          'export function SyntheticLockPanel({ visitId, recordVersion })'
        ).replace('      await settle(result);', '      router.refresh();')
      ),
    });
    expect(report.violations).toEqual([]);
  });
});

describe('an adapter that weakens the guard fails the gate', () => {
  it('refuses an optional ifMatch', () => {
    const report = judge({
      sources: withAdapter(ADAPTER.replace('ifMatch: number', 'ifMatch?: number')),
    });
    expect(report.violations.join('\n')).toContain('optional or defaulted');
  });

  it('refuses a defaulted ifMatch — a version the application invented', () => {
    const report = judge({
      sources: withAdapter(ADAPTER.replace('ifMatch: number,', 'ifMatch: number = 1,')),
    });
    expect(report.violations.join('\n')).toContain('optional or defaulted');
  });

  it('refuses an adapter that takes a version and drops it', () => {
    const report = judge({
      sources: withAdapter(
        ADAPTER.replace(
          "return client.send('POST', visitPath(visitId, '/lock'), undefined, { ifMatch });",
          "return client.send('POST', visitPath(visitId, '/lock'), undefined, {});"
        )
      ),
    });
    expect(report.violations.join('\n')).toContain('never uses it');
  });

  it('refuses a contract that guards more operations than the tree has adapters for', () => {
    const report = judge({
      document: {
        paths: {
          ...document.paths,
          '/api/v1/synthetic-visits/{visitId}/freeze': {
            post: { operationId: 'rec.synthetic-freeze', parameters: [IF_MATCH] },
          },
        },
      },
    });
    expect(report.violations.join('\n')).toContain('guards 3 apt/rec operations');
  });
});

describe('anti-vacuity — a check that examines nothing passes everything', () => {
  it('fails when zero files are scanned', () => {
    expect(judge({ sources: [] }).violations.join('\n')).toContain('no files were scanned');
  });

  it('fails when the contract derives no guarded operation', () => {
    expect(judge({ document: { paths: {} } }).violations.join('\n')).toContain(
      'no version-guarded apt/rec operation was derived'
    );
  });

  it('fails when the adapter walk finds nothing', () => {
    // The adapter root moved and nothing noticed — the shape that turns a gate
    // into a file.
    const report = judge({ adapterRoots: ['apps/web/src/features/elsewhere'] });
    expect(report.violations.join('\n')).toContain('no guarded adapter was found');
  });

  it('fails when no call site exists anywhere', () => {
    const report = judge({ sources: [sources[0]] });
    expect(report.violations.join('\n')).toContain('no guarded call site was found');
  });

  it('does not treat a module without "use server" as an adapter module', () => {
    const report = judge({ sources: withAdapter(ADAPTER.replace("'use server';", '')) });
    expect(report.violations.join('\n')).toContain('no guarded adapter was found');
  });
});

/* ------------------------------------------------------------------ *
 * The helpers this gate is built on
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * The adapter roots are read off the repository, not remembered
 * ------------------------------------------------------------------ */

/**
 * The root set was two hand-written names, `appointments` and `receptions`.
 *
 * `features/attachments` — which holds the document adapters this phase's
 * entire evidence chain runs through — was not one of them, so the adapter walk
 * never opened that tree. The consequence is not a missed violation in the
 * ordinary sense: it is that `no guarded adapter was found`, the rule at the
 * bottom of the gate whose whole job is to refuse a sweep of nothing, answered
 * for the two trees somebody had remembered. The sweep was clean, non-empty and
 * blind to an entire feature at the same time.
 */
/**
 * The `'use server'` directive, read off COMMENT-STRIPPED source.
 *
 * The walk tested the RAW file, so a module written in this repository’s own
 * house style — a docblock, then the directive — did not look like a Server
 * Action module and was skipped whole. A guarded adapter inside such a file
 * could declare `ifMatch` defaulted, the exact defect this gate exists for, and
 * the gate reported zero violations over it.
 */
describe('a leading docblock does not hide a module from the adapter walk', () => {
  const DEFECTIVE = [
    '/**',
    ' * The house style everywhere else in this repository.',
    ' */',
    "'use server';",
    'export async function sealSyntheticDocument(documentId: string, ifMatch = 1) {',
    "  return client.send('POST', docPath(documentId, '/seal'), undefined, { ifMatch });",
    '}',
  ].join('\n');
  const FILE = 'apps/web/src/features/attachments/seal-actions.ts';

  it('sees the module and catches the defective adapter inside it', () => {
    const report = judge({
      sources: [...sources, [FILE, DEFECTIVE] as const],
      adapterRoots: adapterRootsFromRepository().map((one: string) => one.split('\\').join('/')),
    });
    expect(report.adapters.map((a) => a.name)).toContain('sealSyntheticDocument');
    expect(report.violations.join('\n')).toContain('declares ifMatch as optional or defaulted');
  });

  it('was BLIND to it while the directive was read off raw content', () => {
    // The old predicate, applied to the same source: the module never matched.
    expect(/^\\s*['\"]use server['\"]/.test(DEFECTIVE)).toBe(false);
    expect(declaresUseServer(DEFECTIVE)).toBe(true);
  });

  it('still refuses a directive that is only QUOTED in a comment', () => {
    const prose = [
      '/**',
      " * A `'use server'` file may only export async functions.",
      ' */',
      'export const NOT_A_SERVER_MODULE = 1;',
    ].join('\n');
    expect(declaresUseServer(prose)).toBe(false);
  });
});
describe('the adapter roots are DERIVED from the repository', () => {
  const derived = adapterRootsFromRepository().map((one: string) => one.split('\\').join('/'));

  it('reads every tree that is really there, attachments and lib included', () => {
    /*
     * COVERED, not listed. The roots are prefixes, so the assertion that matters
     * is that each tree falls inside one — which is what the gate actually asks.
     * Asserting membership of the list instead is how this case came to describe
     * one particular derivation rather than the property it exists to protect.
     */
    const covers = (path: string) => derived.some((root: string) => path.startsWith(root));
    // The original omission, asserted by name so it cannot silently return.
    expect(covers('apps/web/src/features/attachments')).toBe(true);
    // …and the pair that used to be the whole list, so this is a widening.
    expect(covers('apps/web/src/features/appointments')).toBe(true);
    expect(covers('apps/web/src/features/receptions')).toBe(true);

    /*
     * The SECOND omission, which the first derivation kept: it enumerated the
     * children of `features/`, which derives the feature roots rather than the
     * roots. Two real `'use server'` modules live under `apps/web/src/lib`, so
     * a defective guarded adapter written in either of them was never opened
     * while the anti-vacuity check reported a clean non-empty sweep.
     */
    expect(derived).toContain('apps/web/src/lib');
    expect(derived).toContain('apps/web/src');
    expect(covers('apps/web/src/lib/customers/directory.ts')).toBe(true);

    // Every derived root is a directory that exists — a derivation that
    // invented a path would scan nothing and still read as clean.
    for (const root of derived) {
      expect(statSync(join(REPOSITORY_ROOT, root)).isDirectory(), root).toBe(true);
    }

    // Anti-vacuity across MORE THAN ONE root: a derivation that collapsed to a
    // single tree would satisfy every assertion a one-root suite could make.
    expect(derived.length).toBeGreaterThan(3);
    expect(new Set(derived).size).toBe(derived.length);
  });

  it('matches the web source tree on disk exactly — no more, no fewer', () => {
    const onDisk = readdirSync(join(REPOSITORY_ROOT, 'apps/web/src'), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `apps/web/src/${entry.name}`)
      .concat('apps/web/src')
      .sort();
    expect([...derived].sort()).toEqual(onDisk);
  });

  it('catches a defective guarded adapter written under src/lib', () => {
    /*
     * R2-08 as a planted defect rather than as a list comparison. The adapter
     * takes `ifMatch` with a DEFAULT, which is the violation this gate exists
     * for: the backend answers 428 ERR-CON-002 without the header, so a
     * defaulted version is one the application invented.
     *
     * Under the features-only derivation this file was never opened and the
     * gate reported a clean, non-empty sweep. Two real `'use server'` modules
     * already live in that tree, so the blind spot was occupied.
     */
    const PLANTED_LIB = [
      "'use server';",
      'export async function sealSyntheticCustomer(customerId: string, ifMatch = 1) {',
      "  return client.send('POST', custPath(customerId, '/seal'), undefined, { ifMatch });",
      '}',
    ].join('\n');
    const LIB_FILE = 'apps/web/src/lib/customers/seal-actions.ts';

    const blind = judge({
      sources: [...sources, [LIB_FILE, PLANTED_LIB] as const],
      adapterRoots: [ADAPTER_ROOT],
    });
    // Not merely absent from the violations — absent from what the gate SAW.
    expect(
      blind.adapters.some((one) => one.name === 'sealSyntheticCustomer'),
      'the features-only derivation opened a tree it should not have'
    ).toBe(false);

    const seeing = judge({
      sources: [...sources, [LIB_FILE, PLANTED_LIB] as const],
      adapterRoots: [ADAPTER_ROOT, 'apps/web/src/lib'],
    });
    expect(seeing.violations.join('\n')).toContain('sealSyntheticCustomer');
    expect(seeing.violations.join('\n')).toContain('optional or defaulted');

    // …and the real derivation covers that tree, so the widening is not just a
    // parameter a case passed itself.
    expect(
      adapterRootsFromRepository()
        .map((one: string) => one.split('\\').join('/'))
        .some((root: string) => LIB_FILE.startsWith(root))
    ).toBe(true);
  });

  it('attributes a call to the function it is IN, not the one written beside it', () => {
    /*
     * R2-07, planted. The renewal question is asked of the scope that sent the
     * command, and the previous derivation took "the last `function` declared
     * before the call" with a region running to the NEXT declaration — so an
     * arrow-function component was invisible, its call was credited to whatever
     * sat above it, and the search for a renewal ran on past its closing brace
     * into an unrelated neighbour.
     *
     * Both components below are arrow constants, which the old scanner could
     * not see at all. `Renewing` hands its outcome to a callback and `Hoarding`
     * keeps it; `Hoarding` is written FIRST, so the forward scan from its call
     * would reach `Renewing`'s `settle(result)` and vouch for it.
     */
    const NEIGHBOURS = [
      "'use client';",
      "import { lockSyntheticVisit } from '../lock-actions';",
      'export const Hoarding = ({ visitId, recordVersion }) => {',
      '  const submit = async () => {',
      '    await lockSyntheticVisit(visitId, recordVersion, 1);',
      '  };',
      '  return submit;',
      '};',
      'export const Renewing = ({ visitId, recordVersion, settle }) => {',
      '  const submit = async () => {',
      '    const result = await lockSyntheticVisit(visitId, recordVersion, 1);',
      '    await settle(result);',
      '  };',
      '  return submit;',
      '};',
    ].join('\n');

    const NEIGHBOURS_FILE = `${ADAPTER_ROOT}/components/Neighbours.tsx`;
    const report = judge({ sources: [...sources, [NEIGHBOURS_FILE, NEIGHBOURS] as const] });

    const planted = report.sites.filter((site) => site.file === NEIGHBOURS_FILE);
    expect(planted, 'neither call in the planted file was seen at all').toHaveLength(2);

    /*
     * The scope reported is `submit` for both — the innermost named function,
     * which is where the command is sent and whose body bounds the search. The
     * two share a name, so they are read in source ORDER rather than by name:
     * `Hoarding` is written first.
     */
    expect(planted.map((site) => site.enclosing)).toEqual(['submit', 'submit']);
    expect(
      planted[0]?.renews,
      'the neighbour’s settle() vouched for a scope that renews nothing'
    ).toBe(false);
    expect(planted[1]?.renews, 'a scope that hands its outcome onward').toBe(true);
  });
  it('reports a `use server` module that falls outside every root', () => {
    /*
     * The class fix, not the instance. A root set is a claim about which trees
     * hold adapters, and this gate has now been given the wrong claim twice —
     * silently both times, because a narrower sweep is still a clean sweep. So
     * the claim is CHECKED: a module the filter excludes is a violation rather
     * than a file that quietly never opened.
     */
    const report = judge({
      sources: [
        ...sources,
        [
          'apps/web/src/elsewhere/actions.ts',
          ["'use server';", 'export async function f(ifMatch: number) { return ifMatch; }'].join(
            '\n'
          ),
        ] as const,
      ],
      adapterRoots: ['apps/web/src/features', 'apps/web/src/lib'],
    });
    expect(report.violations.join('\n')).toContain('apps/web/src/elsewhere/actions.ts');
    expect(report.violations.join('\n')).toContain('outside every derived adapter root');
  });
  /**
   * The defect, planted and measured against both root sets.
   *
   * The adapter takes `ifMatch` with a DEFAULT, which is the violation this
   * gate exists to catch: the backend answers 428 ERR-CON-002 without the
   * header, so a defaulted version is one the application invented. Planted
   * under `features/attachments` it is invisible to the old pair and caught by
   * the derivation — the same tree, the same file, two different answers.
   */
  const PLANTED = [
    "'use server';",
    'export async function sealSyntheticDocument(documentId: string, ifMatch = 1) {',
    "  return client.send('POST', docPath(documentId, '/seal'), undefined, { ifMatch });",
    '}',
  ].join('\n');
  const PLANTED_FILE = 'apps/web/src/features/attachments/seal-actions.ts';

  it('was BLIND to a defective adapter under attachments while the roots were a hand list', () => {
    const report = judge({
      sources: [...sources, [PLANTED_FILE, PLANTED] as const],
      adapterRoots: ['apps/web/src/features/appointments', 'apps/web/src/features/receptions'],
    });
    // Not merely absent from the violations — absent from what the gate SAW,
    // which is the stronger statement and the actual defect.
    expect(report.adapters.map((a) => a.name)).not.toContain('sealSyntheticDocument');
    expect(report.violations.join('\n')).not.toContain('sealSyntheticDocument');
  });

  it('SEES it once the roots are derived, and goes red', () => {
    const report = judge({
      sources: [...sources, [PLANTED_FILE, PLANTED] as const],
      adapterRoots: derived,
    });
    expect(report.adapters.map((a) => a.name)).toContain('sealSyntheticDocument');
    expect(report.violations.join('\n')).toContain('sealSyntheticDocument');
    expect(report.violations.join('\n')).toContain('declares ifMatch as optional or defaulted');
  });

  it('fails closed when the feature tree yields nothing', () => {
    // A derivation that returned an empty set would scan no file and satisfy
    // every rule below it — the failure mode it was written to end.
    const report = judge({ adapterRoots: [] });
    expect(report.violations.join('\n')).toContain('no guarded adapter was found');
  });
});

describe('the helpers this gate is built on', () => {
  it('strips comments without destroying a URL in a string', () => {
    const stripped = stripComments(`const u = 'https://example.test/keep'; // gone`);
    expect(stripped).toContain('/keep');
    expect(stripped).not.toContain('gone');
  });

  it('reads a guarded operation only when the IfMatch parameter is published', () => {
    expect(
      guardedOperations({
        paths: {
          '/a': { post: { operationId: 'rec.x', parameters: [IF_MATCH] } },
          '/b': { post: { operationId: 'rec.y', parameters: [] } },
          '/c': { post: { operationId: 'rec.z' } },
        },
      }).map((operation) => operation.id)
    ).toEqual(['rec.x']);
  });

  it('splits a parameter list on top-level commas only', () => {
    expect(argumentsAt('f({ a, b }: Props, second)', 1)).toEqual(['{ a, b }: Props', ' second']);
  });

  it('binds the names of a destructuring pattern and NOT of its annotation', () => {
    // Reading identifiers out of the annotation too would let a type name vouch
    // for a value that was never a parameter — the whole point of the
    // untraceable verdict.
    expect(boundNames('{ locale, recordVersion }: { readonly mystery: number }')).toEqual([
      'locale',
      'recordVersion',
    ]);
    expect(boundNames('ifMatch: number')).toEqual(['ifMatch']);
    expect(boundNames('   ')).toEqual([]);
  });

  it('reads the ifMatch POSITION off the signature rather than assuming it', () => {
    const found = guardedAdaptersIn(
      `'use server';\nexport async function odd(a, b, ifMatch: number) { return ifMatch; }`
    ) as { name: string; position: number; required: boolean; used: boolean }[];
    expect(found).toHaveLength(1);
    expect(found[0]).toEqual({
      name: 'odd',
      index: expect.any(Number),
      position: 2,
      required: true,
      used: true,
    });
  });

  it('bounds the USED region at the next function of ANY kind, not the next export', () => {
    /*
     * The two adapters this decides. `closeReceptionWithoutWork` and
     * `refuseReception` are one-line delegations to `closeVisit`, a module-local
     * helper that sits between `refuseReception` and the next EXPORTED function.
     * Bounded at the next export, each region swallowed the whole of
     * `closeVisit` — whose body mentions `ifMatch` — so `used` was true for both
     * whatever the delegation actually passed.
     *
     * Proved by mutation on the REAL module: drop the version from the
     * delegation, which is the shipped shape of "a guarded command sent with no
     * `If-Match` at all", and the gate must see it.
     */
    const receptionApi = readFileSync(
      join(REPOSITORY_ROOT, 'apps', 'web', 'src', 'features', 'receptions', 'api.ts'),
      'utf8'
    );
    type Adapter = { name: string; required: boolean; used: boolean };
    const shipped = guardedAdaptersIn(receptionApi) as Adapter[];
    expect(shipped.map((one) => one.name)).toContain('refuseReception');
    for (const adapter of shipped) expect(adapter.used, adapter.name).toBe(true);

    const mutated = receptionApi.replace(
      "return closeVisit(receptionId, '/refuse', ifMatch, input, attempt);",
      "return closeVisit(receptionId, '/refuse', 1, input, attempt);"
    );
    expect(mutated, 'the mutation was a no-op — the delegation was rewritten').not.toBe(
      receptionApi
    );
    const after = guardedAdaptersIn(mutated) as Adapter[];
    expect(after.find((one) => one.name === 'refuseReception')?.used).toBe(false);
    // And the neighbour is unaffected, so the region really is per-adapter.
    expect(after.find((one) => one.name === 'closeReceptionWithoutWork')?.used).toBe(true);

    /*
     * What the old boundary would have reported on that same mutation, measured
     * rather than asserted: everything from `refuseReception` to the next
     * EXPORTED function — or, since `P1-28-F9` deleted the unreachable
     * `conditionEvidenceKinds` that used to follow it, to the end of the module
     * — still mentions `ifMatch`, because the shared `closeVisit` helper sits
     * inside that span. The neighbour is not named here for that reason: the
     * claim is about the SPAN, and naming whatever happens to come next made
     * this case fail for a deletion it was never about.
     */
    const refuse = mutated.indexOf('export async function refuseReception');
    expect(refuse).toBeGreaterThan(-1);
    const following = mutated.slice(refuse + 'export async function refuseReception'.length);
    const next = following.search(/^export (?:async )?function /m);
    const span = next === -1 ? following : following.slice(0, next);
    expect(span, 'the span to the next export is empty — this measurement is vacuous').toContain(
      'closeVisit'
    );
    expect(/\bifMatch\b/.test(span)).toBe(true);
  });

  it('does not read a DECLARATION as a call to itself', () => {
    /*
     * The declaration matched the same `name(` shape as a call, and its
     * "argument" at the version position was the parameter `ifMatch: number` —
     * reported untraceable in every module that declares one. The text scan
     * needed a look-behind for the `function` keyword to avoid it; a
     * `CallExpression` is not a declaration, so nothing needs avoiding.
     */
    const text = 'export async function lockIt(a, ifMatch: number) {}\nlockIt(id, version);';
    const calls = callsTo(parseModule(text), new Set(['lockIt'])) as { args: string[] }[];
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[1]?.trim()).toBe('version');
  });

  it('is not fooled by an identifier that merely CONTAINS an adapter name', () => {
    /*
     * What a word-boundary regex over text gets right by luck and a parser
     * gets right by construction: a call to `lockItTwice` is a call to a
     * different function, and the string `lockIt(` inside a comment or a
     * template literal is not a call at all.
     */
    const text = [
      'function lockItTwice(a, b) { return b; }',
      'lockItTwice(id, version);',
      'const note = `lockIt(id, 3)`;',
      '// lockIt(id, 4);',
    ].join('\n');
    expect(callsTo(parseModule(text), new Set(['lockIt']))).toHaveLength(0);
  });
  it('takes the FIRST declaration of a name, so an inner shadow cannot vouch for an outer use', () => {
    const found = declarations('const v = detail.recordVersion;\nfunction f() { const v = 3; }');
    expect(found.get('v')).toBe('detail.recordVersion');
  });

  it('knows a hook-held value from a plain one', () => {
    const held = cachedNames('const [a, setA] = useState(1);\nconst b = props.recordVersion;');
    expect([...held]).toEqual(['a', 'setA']);
    expect(held.has('b')).toBe(false);
  });

  it('collects parameter names from declarations and from arrows', () => {
    const names = parameterNames('function f({ alpha }) {}\nconst g = (beta) => beta;');
    expect(names.has('alpha')).toBe(true);
    expect(names.has('beta')).toBe(true);
  });

  it('classifies each accepted and refused shape directly', () => {
    const context = {
      declarations: new Map([['chosen', 'a.recordVersion']]),
      cached: new Set(['held']),
      parameters: new Set(['recordVersion']),
    };
    expect(classifyVersionExpression('detail.recordVersion', context)).toEqual({
      ok: true,
      kind: 'response',
    });
    expect(classifyVersionExpression('recordVersion', context)).toEqual({
      ok: true,
      kind: 'supplied',
    });
    expect(classifyVersionExpression('chosen', context).ok).toBe(true);
    expect(classifyVersionExpression('held', context).ok).toBe(false);
    expect(classifyVersionExpression('recordVersion + 2', context).ok).toBe(false);
    expect(classifyVersionExpression('', context).ok).toBe(false);
    // `??` is nullish coalescing, not a conditional, and it is not a version.
    expect(classifyVersionExpression('recordVersion ?? nothing', context).ok).toBe(false);
  });

  it('refuses a trace that will not terminate', () => {
    const context = {
      declarations: new Map([
        ['a', 'b'],
        ['b', 'a'],
      ]),
      cached: new Set<string>(),
      parameters: new Set<string>(),
    };
    expect(classifyVersionExpression('a', context).ok).toBe(false);
  });

  it('accepts renewal through a bound callback or the refresh family, and nothing else', () => {
    const binds = new Set(['settle']);
    expect(renewsAfter('settle(result);', 0, 14, binds)).toBe(true);
    expect(renewsAfter('router.refresh();', 0, 17, new Set())).toBe(true);
    expect(renewsAfter('setState(result);', 0, 17, binds)).toBe(false);
    expect(RENEWAL_NAMES).toContain('refresh');
  });
});
