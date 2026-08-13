import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { REPOSITORY_ROOT } from '../../scripts/lib/repository-paths.mjs';
import {
  RENEWAL_NAMES,
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
  adapters: { name: string; required: boolean; used: boolean }[];
  sites: { adapter: string; argument: string; ok: boolean; renews?: boolean }[];
  violations: string[];
}

/** Runs the gate over synthetic inputs, with optional per-case overrides. */
function judge(over: Record<string, unknown> = {}): Report {
  return run({
    document,
    sources,
    adapterRoots: [ADAPTER_ROOT],
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
    // Seven: three appointment lifecycle commands, and on the reception side
    // approve, convert and the two terminal exits. Pinned, because a derivation
    // that returned nothing would pass as "nothing to check".
    expect(live.guarded).toHaveLength(7);
    for (const operation of live.guarded) expect(operation.id).toMatch(/^(apt|rec)\./);
  });

  it('finds one adapter per guarded operation, each demanding a required version', () => {
    expect(live.adapters).toHaveLength(7);
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
     * rather than asserted: the next EXPORTED function after `refuseReception`
     * is `conditionEvidenceKinds`, and everything between them — including
     * `closeVisit` — mentions `ifMatch`.
     */
    const nextExport = mutated.indexOf('export async function conditionEvidenceKinds');
    const refuse = mutated.indexOf('export async function refuseReception');
    expect(nextExport).toBeGreaterThan(refuse);
    expect(/\bifMatch\b/.test(mutated.slice(refuse, nextExport))).toBe(true);
  });

  it('does not read a DECLARATION as a call to itself', () => {
    // The declaration matches the same `name(` shape as a call, and its
    // "argument" at the version position is the parameter `ifMatch: number` —
    // which would be reported untraceable in every module that declares one.
    const text = 'export async function lockIt(a, ifMatch: number) {}\nlockIt(id, version);';
    const calls = callsTo(text, new Set(['lockIt'])) as { args: string[] }[];
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args[1]?.trim()).toBe('version');
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
