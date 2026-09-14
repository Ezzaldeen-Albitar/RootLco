/**
 * The red-proof for `check-p1-31-version-sourcing.mjs` (P1-31, QA-004).
 *
 * A gate that passes over the tree as it stands is not evidence that it would
 * refuse a tree that had drifted. So its teeth are proved here: synthetic
 * modules are APPENDED to the real web sources, one defect class at a time, and
 * the gate is required to go red on every one. Appending rather than replacing
 * is deliberate — the real adapters stay in the corpus, so a fixture adds
 * exactly one reason to fail and the assertion cannot be satisfied by the
 * collapse of everything else.
 *
 * The judgement is the P1-28 gate's and is pinned there. What this file proves
 * is that THIS gate wires it to P1-31's own scope — it binds a send to an
 * operation by the path it resolves, it sees a version carried as an interface
 * FIELD, it refuses a retry that quotes the version the first attempt was
 * refused for, and it holds the pending declaration to its stated lifecycle.
 *
 * Operation ids are ASSEMBLED rather than written as literals. The P1-24
 * operation register credits any test file whose raw text contains an operation
 * id as a test OF that operation — comments included — so a literal id here
 * would make this file appear as evidence for an operation it never exercises.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  EXPECTED_IN_SCOPE,
  P1_31_GUARDED_OPERATIONS,
  PENDING_CONSUMERS,
  repositorySources,
  run,
} from '../../scripts/ci/check-p1-31-version-sourcing.mjs';
import { REGISTER } from '../../scripts/ci/check-command-coverage.mjs';
import { P1_31_OPERATION_IDS } from '../../scripts/ci/check-p1-31-access.mjs';

const ROOT = process.cwd();
const GATE = join(ROOT, 'scripts', 'ci', 'check-p1-31-version-sourcing.mjs');
const COMMAND = ['validate', 'p1-31-version-sourcing'].join(':');

/** `wty` + `warranty-policy-rename` -> the id, without ever spelling it out. */
const id = (domain: string, tail: string): string => [domain, tail].join('.');

type Source = readonly [string, string];

const REAL: Source[] = repositorySources() as unknown as Source[];

/** The real corpus plus the planted modules, in the shape `run` expects. */
function withFixtures(...planted: Source[]): { violations: string[] } {
  return run({ sources: [...REAL, ...planted] }) as { violations: string[] };
}

/** An adapter module that sends one warranty plan rename with a positional version. */
const POSITIONAL_ADAPTER: Source = [
  'apps/web/src/features/probe/positional-api.ts',
  `'use server';
function probePolicyPath(policyId: string): string {
  return \`/api/v1/warranty-policies/\${encodeURIComponent(policyId)}\`;
}
export async function probeRenamePlan(policyId: string, body: unknown, ifMatch: number) {
  const client = await authorizedClient();
  return client.send('PATCH', probePolicyPath(policyId), body, { ifMatch });
}
`,
];

/** A caller that hands the adapter a version the server stated, and re-reads after. */
const GOOD_CALLER: Source = [
  'apps/web/src/features/probe/GoodCaller.tsx',
  `export function ProbeGood({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  const submit = async () => {
    await probeRenamePlan(plan.id, { name: 'x' }, plan.recordVersion);
    onDone();
  };
  return submit;
}
`,
];

describe('the scope is P1-31’s own, and the contract is what checks it', () => {
  it('names eleven version-guarded operations, each of which the contract guards', () => {
    expect(P1_31_GUARDED_OPERATIONS.length).toBe(EXPECTED_IN_SCOPE);
    expect(new Set(P1_31_GUARDED_OPERATIONS).size).toBe(EXPECTED_IN_SCOPE);

    const document = JSON.parse(
      readFileSync(join(ROOT, 'docs', 'api', 'openapi.v1.json'), 'utf8')
    ) as {
      paths: Record<string, Record<string, { operationId?: string; parameters?: unknown[] }>>;
    };
    const guarded = new Set<string>();
    for (const methods of Object.values(document.paths)) {
      for (const operation of Object.values(methods)) {
        const refs = (operation.parameters ?? []).map(
          (parameter) => (parameter as { $ref?: string }).$ref
        );
        if (operation.operationId && refs.includes('#/components/parameters/IfMatch')) {
          guarded.add(operation.operationId);
        }
      }
    }
    // Non-vacuity first: the contract really does guard a large surface, and the
    // eleven are an intersection of it rather than a list nobody checked.
    expect(guarded.size).toBeGreaterThan(EXPECTED_IN_SCOPE);
    for (const operation of P1_31_GUARDED_OPERATIONS) {
      expect(guarded, `${operation} is guarded by the published contract`).toContain(operation);
    }
  });

  it('declares the seven with no consumer, and claims nothing outside the scope', () => {
    const pending = Object.keys(PENDING_CONSUMERS);
    expect(pending.length).toBe(7);
    for (const operation of pending) {
      expect(P1_31_GUARDED_OPERATIONS, `${operation} is in scope`).toContain(operation);
      const reason = (PENDING_CONSUMERS as Record<string, string | undefined>)[operation] ?? '';
      expect(reason.startsWith('PENDING: '), `${operation} states a reason`).toBe(true);
    }
    // The four that are compared are exactly the ones not declared away, and
    // there is at least one — a scope entirely declared pending compares nothing.
    const compared = P1_31_GUARDED_OPERATIONS.filter((operation) => !pending.includes(operation));
    expect(compared.length).toBe(4);
    expect(compared).toContain(id('sal', 'delivery-complete'));
    expect(compared).toContain(id('wty', 'warranty-policy-rename'));
    expect(compared).toContain(id('wty', 'warranty-policy-status-set'));
    expect(compared).toContain(id('wty', 'warranty-coverage-status-set'));
  });

  it('is NOT scoped by the access gate’s allow-list, and the overlap is PINNED', () => {
    // The two lists answer different questions, so the interesting fact is the
    // SIZE of their overlap, and it is pinned rather than narrated: the access
    // list carried three of the eleven when this gate was written and four after
    // the DO-001 pass claimed `sal.delivery-complete`. Scoping a version gate by
    // it would exclude the other seven — the writes no screen reaches yet, which
    // are the ones most likely to be got wrong. A change to either list that moves
    // this intersection has to come back and say so here.
    const overlap = P1_31_GUARDED_OPERATIONS.filter((operation) =>
      (P1_31_OPERATION_IDS as readonly string[]).includes(operation)
    );
    expect([...overlap].sort()).toEqual(
      [
        id('sal', 'delivery-complete'),
        id('wty', 'warranty-coverage-status-set'),
        id('wty', 'warranty-policy-rename'),
        id('wty', 'warranty-policy-status-set'),
      ].sort()
    );
    expect(P1_31_GUARDED_OPERATIONS.length - overlap.length).toBe(7);
  });
});

describe('the tree as it stands passes, and the run is not vacuous', () => {
  it('reports what it examined, verbatim, and exits clean', () => {
    const out = execFileSync(process.execPath, [GATE], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    expect(out).toContain(
      'P1-31 version sourcing: 11 guarded operation(s) in scope of 75 the contract guards, ' +
        '4 with a consumer, 7 pending one, 5 in-scope send(s), 4 adapter call site(s), ' +
        '23 versioned send(s) outside the subject.'
    );
    expect(out).toContain(
      'OK: every version-guarded P1-31 command sources its If-Match from a read or a command ' +
        'response, and renews it after a conflict.'
    );
  });

  it('binds the structural completion adapter to its operation and its caller', () => {
    // The whole reason this gate is not the P1-28 one: the completion carries its
    // version as an interface FIELD, so the P1-28 adapter walk — which looks for
    // `ifMatch` in the parameter LIST — never sees it.
    const report = run() as {
      sites: { operation: string; entry: string; kind?: string }[];
      adapters: { entry: { kind: string }; callers: number }[];
    };
    const completion = report.sites.filter(
      (site) => site.operation === id('sal', 'delivery-complete')
    );
    expect(completion.length).toBe(2);
    expect(completion.map((site) => site.entry).sort()).toEqual(['internal', 'structural']);
    // The retry quotes a version the SERVER stated, which is the rule below.
    expect(completion.some((site) => site.kind === 'response')).toBe(true);
    expect(report.adapters.some((one) => one.entry.kind === 'structural')).toBe(true);
    for (const adapter of report.adapters) expect(adapter.callers).toBeGreaterThan(0);
  });
});

describe('the defect classes turn this gate red', () => {
  it('a version LITERAL at the call site', () => {
    const { violations } = withFixtures(POSITIONAL_ADAPTER, [
      'apps/web/src/features/probe/LiteralCaller.tsx',
      `export function ProbeLiteral({ onDone }: { onDone: () => void }) {
  const submit = async () => {
    await probeRenamePlan('a', { name: 'x' }, 3);
    onDone();
  };
  return submit;
}
`,
    ]);
    expect(violations.join('\n')).toMatch(/computes a version/);
    expect(violations.join('\n')).toMatch(/LiteralCaller/);
  });

  it('a STALE variable the component holds and reuses after a conflict', () => {
    const { violations } = withFixtures(POSITIONAL_ADAPTER, [
      'apps/web/src/features/probe/CachedCaller.tsx',
      `export function ProbeCached({ plan, onDone }: { plan: Plan; onDone: () => void }) {
  const [version, setVersion] = useState(plan.recordVersion);
  const submit = async () => {
    const state = await probeRenamePlan(plan.id, { name: 'x' }, version);
    setVersion(version);
    onDone();
  };
  return submit;
}
`,
    ]);
    expect(violations.join('\n')).toMatch(/a value this component holds in its own state/);
  });

  it('a retry that quotes the version the first attempt was refused for', () => {
    const { violations } = withFixtures(
      [
        'apps/web/src/features/probe/retry-api.ts',
        `'use server';
export interface ProbeRetryInput {
  readonly deliveryId: string;
  readonly ifMatch: number;
}
export async function probeRetryRelease(input: ProbeRetryInput) {
  const client = await authorizedClient();
  const first = await client.send(
    'POST',
    \`/api/v1/deliveries/\${encodeURIComponent(input.deliveryId)}/completion\`,
    {},
    { ifMatch: input.ifMatch }
  );
  if (first.ok) return first;
  return client.send(
    'POST',
    \`/api/v1/deliveries/\${encodeURIComponent(input.deliveryId)}/completion\`,
    {},
    { ifMatch: input.ifMatch }
  );
}
`,
      ],
      [
        'apps/web/src/features/probe/RetryCaller.tsx',
        `export function ProbeRetry({ view, onDone }: { view: View; onDone: () => void }) {
  const submit = async () => {
    await probeRetryRelease({ deliveryId: view.id, ifMatch: view.recordVersion });
    onDone();
  };
  return submit;
}
`,
      ]
    );
    expect(violations.join('\n')).toMatch(/A retry after a conflict must quote a version/);
  });

  it('a STRUCTURAL adapter whose caller invents the number', () => {
    const { violations } = withFixtures(
      [
        'apps/web/src/features/probe/structural-api.ts',
        `'use server';
export interface ProbeReleaseInput {
  readonly deliveryId: string;
  readonly ifMatch: number;
}
export async function probeRelease(input: ProbeReleaseInput) {
  const client = await authorizedClient();
  return client.send(
    'POST',
    \`/api/v1/deliveries/\${encodeURIComponent(input.deliveryId)}/completion\`,
    {},
    { ifMatch: input.ifMatch }
  );
}
`,
      ],
      [
        'apps/web/src/features/probe/StructuralCaller.tsx',
        `export function ProbeStructural({ view, onDone }: { view: View; onDone: () => void }) {
  const submit = async () => {
    await probeRelease({ deliveryId: view.id, ifMatch: view.recordVersion + 1 });
    onDone();
  };
  return submit;
}
`,
      ]
    );
    expect(violations.join('\n')).toMatch(/computes a version/);
    expect(violations.join('\n')).toMatch(/StructuralCaller/);
  });

  it('a component that commands and never hands the outcome onward', () => {
    const { violations } = withFixtures(POSITIONAL_ADAPTER, [
      'apps/web/src/features/probe/SilentCaller.tsx',
      `export function ProbeSilent({ plan }: { plan: Plan }) {
  const submit = async () => {
    await probeRenamePlan(plan.id, { name: 'x' }, plan.recordVersion);
  };
  return submit;
}
`,
    ]);
    expect(violations.join('\n')).toMatch(/never hands the outcome onward/);
  });

  it('two adapters of one name that disagree about the version position', () => {
    /*
     * The homonym collapse, proved rather than assumed away.
     *
     * Both files export `probeRelease`. One takes the version as its third
     * argument, the other as a field of its first. A map keyed by the bare name
     * keeps whichever was walked first, so the other adapter's callers would be
     * judged against a signature they do not call — and its own "no consumer"
     * check would be answered by the first adapter's callers. Keyed by file and
     * name, both survive, the disagreement is visible, and no caller of either is
     * attributed.
     */
    const { violations } = withFixtures(
      [
        'apps/web/src/features/probe/homonym-one-api.ts',
        `'use server';
export async function probeRelease(deliveryId: string, body: unknown, ifMatch: number) {
  const client = await authorizedClient();
  return client.send(
    'POST',
    \`/api/v1/deliveries/\${encodeURIComponent(deliveryId)}/completion\`,
    body,
    { ifMatch }
  );
}
`,
      ],
      [
        'apps/web/src/features/probe/homonym-two-api.ts',
        `'use server';
export interface ProbeTwoInput {
  readonly deliveryId: string;
  readonly ifMatch: number;
}
export async function probeRelease(input: ProbeTwoInput) {
  const client = await authorizedClient();
  return client.send(
    'POST',
    \`/api/v1/deliveries/\${encodeURIComponent(input.deliveryId)}/completion\`,
    {},
    { ifMatch: input.ifMatch }
  );
}
`,
      ]
    );
    const text = violations.join('\n');
    expect(text).toMatch(/both export a guarded adapter named probeRelease/);
    expect(text).toMatch(/homonym-one-api\.ts/);
    expect(text).toMatch(/homonym-two-api\.ts/);
  });

  it('a PENDING entry goes stale the moment a consumer sends the write', () => {
    const { violations } = withFixtures(
      [
        'apps/web/src/features/probe/configuration-api.ts',
        `'use server';
export async function probeUpdateConfiguration(
  configurationId: string,
  body: unknown,
  ifMatch: number
) {
  const client = await authorizedClient();
  return client.send(
    'PATCH',
    \`/api/v1/report-configurations/\${encodeURIComponent(configurationId)}\`,
    body,
    { ifMatch }
  );
}
`,
      ],
      [
        'apps/web/src/features/probe/ConfigurationCaller.tsx',
        `export function ProbeConfiguration({ record, onDone }: { record: Row; onDone: () => void }) {
  const submit = async () => {
    await probeUpdateConfiguration(record.id, { title: 'x' }, record.recordVersion);
    onDone();
  };
  return submit;
}
`,
      ]
    );
    expect(violations.join('\n')).toMatch(/PENDING_CONSUMERS entry is STALE/);
    expect(violations.join('\n')).toContain(id('rpt', 'report-configuration-update'));
  });

  it('an in-scope operation neither consumed nor declared is a violation, not a silence', () => {
    const pending = { ...PENDING_CONSUMERS } as Record<string, string>;
    delete pending[id('org', 'employee-status-set')];
    const { violations } = run({ sources: REAL, pending }) as { violations: string[] };
    expect(violations.join('\n')).toMatch(/Being unreachable must be a declared state/);
    expect(violations.join('\n')).toContain(id('org', 'employee-status-set'));
  });
});

describe('the send-to-operation binding fails closed, and only where it could matter', () => {
  it('refuses a versioned send it cannot attribute under an in-scope resource root', () => {
    const { violations } = withFixtures([
      'apps/web/src/features/probe/opaque-api.ts',
      `'use server';
export async function probeOpaque(deliveryId: string, tail: string, ifMatch: number) {
  const client = await authorizedClient();
  return client.send('POST', \`/api/v1/deliveries/\${deliveryId}/\${tail}\`, {}, { ifMatch });
}
`,
    ]);
    expect(violations.join('\n')).toMatch(/a version-guarded request is sent to a path this gate/);
    expect(violations.join('\n')).toMatch(/opaque-api\.ts/);
  });

  it('leaves an unattributable send alone when its resource root cannot be one of the eleven', () => {
    // The proof rather than an allow-list: no operation in scope is addressed
    // under this root, so the send cannot be one of them and this gate says so by
    // adding no violation at all. An allow-list would have to be maintained; a
    // proof cannot go stale.
    const { violations } = withFixtures([
      'apps/web/src/features/probe/foreign-api.ts',
      `'use server';
export async function probeForeign(visitId: string, tail: string, ifMatch: number) {
  const client = await authorizedClient();
  return client.send('POST', \`/api/v1/receptions/\${visitId}/\${tail}\`, {}, { ifMatch });
}
`,
    ]);
    expect(violations).toEqual([]);
  });

  it('accepts a correct positional adapter and caller, so the cases above are not noise', () => {
    const { violations } = withFixtures(POSITIONAL_ADAPTER, GOOD_CALLER);
    expect(violations).toEqual([]);
  });

  it('refuses a version option outside the transport’s options argument', () => {
    // The index-three read is a fact about `lib/api/client.ts`, and these two
    // refusals are what make it safe rather than merely conventional. A version
    // in the BODY is the dangerous direction: the request looks guarded, carries
    // no header, and would be invisible to a gate that only looked at argument 4.
    const { violations } = withFixtures([
      'apps/web/src/features/probe/misplaced-api.ts',
      `'use server';
export async function probeMisplaced(deliveryId: string, ifMatch: number) {
  const client = await authorizedClient();
  return client.send(
    'POST',
    \`/api/v1/deliveries/\${encodeURIComponent(deliveryId)}/completion\`,
    { ifMatch }
  );
}
`,
    ]);
    expect(violations.join('\n')).toMatch(/carries a version spelled `ifMatch` at argument 3/);
    expect(violations.join('\n')).toMatch(/unguarded on the wire/);
  });

  it('refuses a version in the body under a name the transport never reads', () => {
    // The widened vocabulary, and the reason for it: a version that has ended up
    // where nothing reads it is a mistake, and a mistake need not use the right
    // word for itself. Only the REFUSAL is widened — the options position is
    // still judged on `ifMatch` alone.
    const { violations } = withFixtures([
      'apps/web/src/features/probe/misspelled-api.ts',
      `'use server';
export async function probeMisspelled(deliveryId: string, recordVersion: number) {
  const client = await authorizedClient();
  return client.send(
    'POST',
    \`/api/v1/deliveries/\${encodeURIComponent(deliveryId)}/completion\`,
    { recordVersion }
  );
}
`,
    ]);
    expect(violations.join('\n')).toMatch(
      /carries a version spelled `recordVersion` at argument 3/
    );
  });

  it('refuses a version in the options object under a name the transport never reads', () => {
    const { violations } = withFixtures([
      'apps/web/src/features/probe/misnamed-option-api.ts',
      `'use server';
export async function probeMisnamedOption(deliveryId: string, recordVersion: number) {
  const client = await authorizedClient();
  return client.send(
    'POST',
    \`/api/v1/deliveries/\${encodeURIComponent(deliveryId)}/completion\`,
    {},
    { recordVersion }
  );
}
`,
    ]);
    expect(violations.join('\n')).toMatch(
      /carries a version spelled `recordVersion` in its options object/
    );
    expect(violations.join('\n')).toMatch(/sends no If-Match at all/);
  });

  it('refuses a send with more arguments than the transport takes', () => {
    const { violations } = withFixtures([
      'apps/web/src/features/probe/arity-api.ts',
      `'use server';
export async function probeArity(deliveryId: string, ifMatch: number) {
  const client = await authorizedClient();
  return client.send(
    'POST',
    \`/api/v1/deliveries/\${encodeURIComponent(deliveryId)}/completion\`,
    {},
    {},
    { ifMatch }
  );
}
`,
    ]);
    expect(violations.join('\n')).toMatch(/is called with 5 arguments/);
  });

  it('refuses two functions of one name in one module', () => {
    // The sending adapter is resolved by NAME within its file, so a shadowing
    // helper makes "which parameter list" unanswerable — and the answer decides
    // where the version enters and which caller argument is judged.
    const { violations } = withFixtures([
      'apps/web/src/features/probe/shadowed-api.ts',
      `'use server';
export async function probeShadowed(deliveryId: string, ifMatch: number) {
  const client = await authorizedClient();
  return client.send(
    'POST',
    \`/api/v1/deliveries/\${encodeURIComponent(deliveryId)}/completion\`,
    {},
    { ifMatch }
  );
}
function outer() {
  const probeShadowed = (input: { readonly ifMatch: number }) => input.ifMatch;
  return probeShadowed;
}
`,
    ]);
    expect(violations.join('\n')).toMatch(/functions in this module are named probeShadowed/);
  });
});

describe('the anti-vacuity guards are proved, one negative case each', () => {
  /*
   * A checker that examines nothing passes everything, so the gate carries five
   * clauses that refuse an empty sweep. Each is a claim about a state this
   * repository is not in, which is exactly the kind of claim that rots unproved:
   * the guards were written, the tree was green, and nothing established that any
   * of them would ever fire. One synthetic input per guard, each asserting the
   * guard's own words.
   */
  const only = (...sources: Source[]) => run({ sources }) as { violations: string[] };

  it('no files were scanned', () => {
    expect(only().violations.join('\n')).toMatch(/no files were scanned/);
  });

  it('the send walk examined nothing', () => {
    const { violations } = only([
      'apps/web/src/features/probe/quiet.ts',
      'export const NOTHING = 1;\n',
    ]);
    expect(violations.join('\n')).toMatch(
      /no version-carrying request was found anywhere in apps\/web\/src/
    );
  });

  it('a module the parser refuses is reported, not skipped', () => {
    const { violations } = only([
      'apps/web/src/features/probe/broken.ts',
      'export async function broken( {\n  return client.send(\n',
    ]);
    expect(violations.join('\n')).toMatch(/this gate could not parse the module/);
  });

  it('no in-scope send, and nothing compared, are two clauses one input reaches', () => {
    /*
     * Both are asserted from one fixture because they are co-reachable BY
     * CONSTRUCTION: `consumed` gains an entry for every in-scope send, so it can
     * only be empty when the in-scope set is. Splitting them into two cases would
     * imply an independence the code does not have, and saying so here is cheaper
     * than a reader rediscovering it.
     */
    const { violations } = only([
      'apps/web/src/features/probe/elsewhere-api.ts',
      `'use server';
export async function probeElsewhere(visitId: string, ifMatch: number) {
  const client = await authorizedClient();
  return client.send('POST', \`/api/v1/receptions/\${visitId}/approve\`, {}, { ifMatch });
}
`,
    ]);
    expect(violations.join('\n')).toMatch(/no in-scope version-guarded send was found/);
    expect(violations.join('\n')).toMatch(/every operation in scope is declared pending/);
  });

  it('an adapter that demands a version from its callers and has none', () => {
    const { violations } = withFixtures(POSITIONAL_ADAPTER);
    expect(violations.join('\n')).toMatch(/demands a version from its callers and has none/);
    expect(violations.join('\n')).toMatch(/positional-api\.ts/);
  });

  it('the RED branch is proved by executing it, not by reading `run`', () => {
    /*
     * Every case above calls `run` and reads the violations it returns, which
     * proves the rules and says nothing about `main`: the exit code, the stream
     * the messages land on, and the branch that chooses between them. A gate
     * whose refusals are all observed through its own API is a gate nobody has
     * watched fail.
     *
     * So the CLI is spawned over a directory holding no source. It walks nothing,
     * the first anti-vacuity clause fires, and the process is required to exit
     * non-zero with the clause's own words in what it wrote.
     */
    const empty = mkdtempSync(join(tmpdir(), 'p131-version-sourcing-empty-'));
    const result = spawnSync(process.execPath, [GATE, '--web-root', empty], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    rmSync(empty, { recursive: true, force: true });
    expect(result.status).toBe(1);
    const out = `${result.stdout}${result.stderr}`;
    expect(out).toMatch(/no files were scanned/);
    expect(out).toMatch(/violation\(s\)/);
    // …and the clean branch is not what ran: the OK line belongs to a green tree.
    expect(out).not.toMatch(/OK: every version-guarded P1-31 command/);
  });
});

describe('the gate is registered where a gate has to be', () => {
  it('exists, is an npm script, and rides in the aggregate CI actually runs', () => {
    expect(existsSync(GATE)).toBe(true);
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(manifest.scripts[COMMAND]).toBe('node scripts/ci/check-p1-31-version-sourcing.mjs');
    expect(manifest.scripts['verify:policies']).toContain(`npm run ${COMMAND}`);
  });

  it('is classified in the command register as a required gate', () => {
    const entry = (REGISTER as { name: string; owner: string; tier: string; why: string }[]).find(
      (one) => one.name === COMMAND
    );
    expect(entry, `${COMMAND} is registered`).toBeDefined();
    expect(entry?.tier).toBe('required');
    expect(entry?.why.length).toBeGreaterThan(0);
  });
});
