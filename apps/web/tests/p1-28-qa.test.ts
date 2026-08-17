import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLISHED_OPERATIONS } from '@/lib/api/idempotent-operations';
import { resolveOperation, requiresIdempotencyKey } from '@/lib/api/operation-contract';
import { STATUS_BY_KIND } from '@/lib/api/read-operation';

/**
 * `P1-28-QA-001` … `P1-28-QA-004`.
 *
 * ## The one thing this file is for
 *
 * Every P1-28 `.dom` suite mocks its adapter module wholesale, so it exercises
 * the SCREEN and structurally cannot exercise the adapter. Every P1-28 unit
 * suite exercises a pure module — the contract tables, the wizard rules, the
 * closure graph. **Nothing was executing the thirty-eight adapters this phase
 * ships.** That is the P1-27 Wave 5 finding recurring one phase later: mutating
 * an adapter left twenty DOM tests green, because every reference to it in the
 * whole suite was a `vi.fn()` that replaces the thing under test.
 *
 * So this file drives all twenty-three reads and all fourteen writes through all
 * eleven transport kinds, through the four refusal branches the contract names
 * (428 / 409 / 422 / 403), and through the three replay shapes — and it asserts
 * the paths they actually produce against the published contract, in both
 * directions.
 *
 * ## Nothing here is a hand list
 *
 * The adapter set comes from the filesystem (`exportedP1_28Adapters`), the
 * operation set comes from the generated manifest, the component set comes from
 * the two feature trees, and the step set comes from the wizard registry. A hand
 * list is exactly what let six P1-27 components ship untested under a green
 * coverage claim, and what let nine P1-27 write adapters ship with nothing
 * executing them.
 */

/* ------------------------------------------------------------------ *
 * The mocked transport
 * ------------------------------------------------------------------ */

const get = vi.fn();
const send = vi.fn();
const client = { get, send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

/*
 * Imported after `vi.mock`, which is hoisted, so the adapters these modules pull
 * in resolve the mocked client. The table is shared rather than inlined for the
 * reason its own docblock gives.
 */
const {
  DRIVES,
  NOT_DRIVEN,
  READ_DRIVES,
  WRITE_DRIVES,
  TARGET,
  VERSION,
  VISIT,
  adapterModules,
  adapterNamesIn,
  exportedP1_28Adapters,
  stripComments,
} = await import('./support/p1-28-drives');

const { CHECK_IN_STEPS } = await import('@/features/receptions/check-in/steps');
const { APPOINTMENT_OPERATIONS } = await import('@/features/appointments/appointments-contract');
const { RECEPTION_OPERATIONS } = await import('@/features/receptions/receptions-contract');
const { conflictKindOf, nextVersionAfter } = await import('@/features/receptions/check-in/closure');
const { EVIDENCE_ROW_FIELDS } = await import('@/features/receptions/check-in/evidence');

/** An `ok` page every read adapter accepts, whatever its row shape. */
const OK_PAGE = {
  ok: true,
  status: 200,
  data: { items: [], nextCursor: null, hasMore: false },
  correlationId: 'corr-read',
} as const;

/** An `ok` command answer with a body every write adapter accepts. */
const OK_COMMAND = { ok: true, status: 200, data: {}, correlationId: 'corr-write' } as const;

beforeEach(() => {
  get.mockReset();
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
  get.mockResolvedValue(OK_PAGE);
  send.mockResolvedValue(OK_COMMAND);
});

/** The channel mock a drive uses. */
function channelOf(drive: { readonly channel: 'get' | 'send' }) {
  return drive.channel === 'get' ? get : send;
}

/* ------------------------------------------------------------------ *
 * Corpus helpers
 * ------------------------------------------------------------------ */

/** The two feature trees this phase owns, plus the shared customer→vehicle read. */
const FEATURE_ROOTS = [
  join(process.cwd(), 'src', 'features', 'appointments'),
  join(process.cwd(), 'src', 'features', 'receptions'),
];

/**
 * Every component name the two P1-28 trees export.
 *
 * Walked, never listed. `export const Foo = (…) => …` counts only when an arrow
 * appears in the declaration head, so a value export such as `PRIMARY_BUTTON` is
 * not counted as a component nobody rendered.
 */
function p1TwentyEightComponents(): readonly string[] {
  const names = new Set<string>();

  const collect = (file: string) => {
    const source = readFileSync(file, 'utf8');
    for (const m of source.matchAll(/^export function ([A-Z]\w+)/gm)) {
      if (m[1]) names.add(m[1]);
    }
    for (const m of source.matchAll(/^export const ([A-Z]\w+)\b/gm)) {
      const head = source
        .slice(m.index ?? 0)
        .split('\n')
        .slice(0, 8)
        .join('\n');
      if (m[1] && head.includes('=>')) names.add(m[1]);
    }
  };

  const walk = (dir: string) => {
    if (!statSync(dir).isDirectory()) {
      collect(dir);
      return;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.tsx')) continue;
      collect(full);
    }
  };
  for (const root of FEATURE_ROOTS) walk(root);
  return [...names].sort();
}

/**
 * Every test source in this workspace, comments stripped, THIS FILE EXCLUDED.
 *
 * Both exclusions are load-bearing, and both were live holes in P1-27:
 *
 * - **Comments.** Every docblock in these files names the components it is
 *   about, so prose satisfied the sweep. Six components whose names appeared in
 *   one file's docblock — as the list of things that shipped UNTESTED — were
 *   counted as tested by those very words.
 * - **This file.** It is the meter, not a consumer. A name mentioned here can
 *   never be evidence that the name is exercised somewhere else.
 */
function testSources(): string {
  const dir = join(process.cwd(), 'tests');
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name) && entry.name !== 'p1-28-qa.test.ts') {
        out.push(stripComments(readFileSync(full, 'utf8')));
      }
    }
  };
  walk(dir);
  return out.join('\n');
}

/** Every published operation in the two namespaces this phase consumes. */
function publishedAptRec(): readonly string[] {
  return PUBLISHED_OPERATIONS.filter((op) => /^(apt|rec)\./.test(op.operationId))
    .map((op) => op.operationId)
    .sort();
}

const REPO = join(process.cwd(), '..', '..');

function repoJson<T>(...segments: string[]): T {
  return JSON.parse(readFileSync(join(REPO, ...segments), 'utf8')) as T;
}

const OPENAPI = repoJson<{
  readonly paths: Record<
    string,
    Record<string, { readonly 'x-required-permissions'?: readonly string[] }>
  >;
}>('docs', 'api', 'openapi.v1.json');

/**
 * The intake-catalogue ADMINISTRATION surface, derived from the permission the
 * BACKEND registers — never a list kept here.
 *
 * PR #227 published 28 operations that administer the seven intake catalogues,
 * and this application reaches none of them ON PURPOSE. There is no
 * catalogue-administration screen: no canonical P1-28 task binds one, and who
 * administers the catalogues and through which surface is `P1-28-OD-001`
 * (`docs/phase-1/phase-1-28/canonical-plan.md` §7). Writing an adapter for
 * them would be exactly what Wave A learned not to do — an adapter nobody
 * consumes is not reach, it is INT-113 with a call site.
 *
 * The boundary is the `*.catalogue.manage` permission, which is how the backend
 * itself draws it: the seed records the seven catalogues as ONE administrative
 * surface behind one code per schema. So the partition cannot be widened by
 * editing this file — only by a backend that puts an operator operation behind
 * an administration code, which would fail the access gate first.
 */
function administrativeAptRec(): readonly string[] {
  const ids: string[] = [];
  for (const operation of PUBLISHED_OPERATIONS) {
    if (!/^(apt|rec)\./.test(operation.operationId)) continue;
    const document =
      OPENAPI.paths[`/api/v1${operation.template}`]?.[operation.method.toLowerCase()];
    const permissions = document?.['x-required-permissions'] ?? [];
    if (permissions.some((code) => /\.catalogue\.manage$/.test(code))) {
      ids.push(operation.operationId);
    }
  }
  return ids.sort();
}

/**
 * Published OPERATOR reads this product deliberately does not consume, each
 * with the reason it is not consumed (`P1-28-F9`).
 *
 * ## Why this list exists at all
 *
 * The sweep below asserts that every published operator operation is reached by
 * an adapter, and that is the right default: an unreached operation is usually
 * a screen somebody forgot. But three adapters shipped in this phase with ZERO
 * production consumers — a definition line and nothing else in `apps/web/src` —
 * and the sweep was green over all three, because the drive corpus called them.
 * A drive is not a consumer. So "reached" meant "reached by a test", which is
 * the `INT-113` shape read backwards.
 *
 * The two operations below were deleted rather than given a screen no canonical
 * task binds. That makes them genuinely unreached, and the honest record of that
 * is a checked exception, not a green sweep.
 *
 * ## Why it cannot become a parking place
 *
 * Every entry is corroborated OUTSIDE this file, by the same rule that justifies
 * the exclusion: the operation must be bound by NO canonical task in the
 * generated 35-task matrix. Bind it in `canonical-plan.md` §5 and the exclusion
 * becomes illegal in the same commit. Each entry must also still be published,
 * must be a READ (an unconsumed WRITE belongs in the SEC-004 manifest against a
 * recorded decision, never here), and must really be unreached.
 */
const UNCONSUMED_READS: ReadonlyMap<string, string> = new Map([
  [
    'rec.reception-history',
    "the visit's status and custody ledger. No canonical task binds it — the only " +
      '*-history binding in the matrix is veh.vehicle-odometer-history, on FE-013 — and the ' +
      'adapter that called it had no production consumer, so it was deleted on the ' +
      'crm/customers/identity-api.ts precedent (P1-27-QA-002).',
  ],
  [
    'rec.catalogue-visit-reason-list',
    'no canonical task binds it AND no apt/rec write takes a visit reason: ' +
      "rec.reception-create's strict body is company, branch, vehicle, receiving employee, " +
      'service requester, origin, odometer reading, fuel level and state of charge. There is ' +
      'no field for a reason to fill, so this read is not unwired but unwirable in this release.',
  ],
]);

/**
 * Operations a Backend remediation published whose adapter it was not allowed to
 * write — the third state, read from the canonical declaration rather than
 * restated here, so this file and `check-p1-28-adapter-reachability.mjs` cannot
 * drift into disagreeing about what is owed.
 *
 * That gate enforces WHETHER an entry is legitimate: published, mirrored, new on
 * this branch, owed by a canonical task that is still open, blocked by a named
 * ownership profile that really forbids `web`, and pointed at a Frontend branch
 * that really exists. This file enforces the other half, the one only it can see
 * — that the operation really is still unreached.
 */
const PENDING_ADAPTERS: ReadonlySet<string> = new Set(
  Object.entries(
    repoJson<{
      readonly operations?: Readonly<Record<string, { readonly classification?: string }>>;
    }>('docs', 'phase-1', 'phase-1-28', 'adapter-reachability.json').operations ?? {}
  )
    .filter(([, entry]) => entry.classification === 'PENDING_FRONTEND_ADAPTER')
    .map(([id]) => id)
);

/** Every operation id any canonical task binds, qualifiers dropped. */
function canonicallyBoundOperations(): ReadonlySet<string> {
  const matrix = repoJson<{
    readonly tasks: readonly { readonly CANONICAL_BACKEND_OPERATIONS?: readonly string[] }[];
  }>('docs', 'phase-1', 'phase-1-28', 'task-matrix.json');
  const ids = new Set<string>();
  for (const task of matrix.tasks) {
    for (const binding of task.CANONICAL_BACKEND_OPERATIONS ?? []) {
      ids.add(binding.replace(/\s*\[[^\]]*\]\s*$/, '').trim());
    }
  }
  return ids;
}

/* ================================================================== *
 * QA-001 — the contract mirror, and the coverage it claims
 * ================================================================== */

describe('P1-28-QA-001 — every adapter is executed, and this file proves it', () => {
  it('drives every adapter the P1-28 server modules export, by NAME', () => {
    /*
     * An EQUALITY per name, not a count. A count alone cannot fail when one
     * adapter is added while another is driven — the two balance — and it is
     * blind to the adapter that was never added to the table, which is the
     * failure that actually happened in P1-27 (`listVehicleDocuments` stayed
     * untested while its suite asserted "not a sample of them").
     */
    const driven = DRIVES.map((drive) => drive.name);
    const exported = exportedP1_28Adapters();

    expect(exported.length, 'no adapters were discovered — the walk is broken').toBeGreaterThan(30);
    expect(new Set(driven).size, 'the drive table names an adapter twice').toBe(driven.length);

    const missing = exported.filter((name) => !driven.includes(name) && !NOT_DRIVEN.has(name));
    expect(missing, `these adapters are executed by nothing:\n  ${missing.join('\n  ')}`).toEqual(
      []
    );

    const invented = driven.filter((name) => !exported.includes(name));
    expect(invented, 'the table drives something the tree does not export').toEqual([]);
  });

  it('lets no exclusion name an adapter that no longer exists', () => {
    // Otherwise the exclusion list becomes a place to park a name, and the
    // sweep above narrows itself without anybody deciding to.
    const exported = exportedP1_28Adapters();
    for (const [name, reason] of NOT_DRIVEN) {
      expect(exported, `${name} is excluded but no longer exported`).toContain(name);
      expect(reason.trim().length, `${name} is excluded with no reason`).toBeGreaterThan(20);
    }
  });

  it('discovers the adapter modules by SHAPE, and reads a declaration form the tree lacks', () => {
    // The walk selects `'use server'` modules. A filename convention would have
    // missed `lib/customers/vehicles.ts`, which is in no feature tree and is not
    // named `-api`, and which the intake vehicle picker depends on.
    const modules = adapterModules().map((file) => file.replace(/\\/g, '/'));
    expect(modules.some((file) => file.endsWith('/lib/customers/vehicles.ts'))).toBe(true);
    expect(modules.every((file) => /use server/.test(readFileSync(file, 'utf8')))).toBe(true);

    // The scanner is held against a form the tree does not contain TODAY, so
    // the blind spot is closed before it is fallen into rather than after.
    expect(adapterNamesIn('export const listLater = async (id) => id;')).toEqual(['listLater']);
    // And a docblock naming an adapter is not a declaration of one.
    expect(adapterNamesIn('/** export async function listGhost() {} */')).toEqual([]);
  });

  it('issues exactly one request per drive, on the channel it declares', async () => {
    for (const drive of DRIVES) {
      get.mockClear();
      send.mockClear();
      await drive.call();
      const channel = channelOf(drive);
      const other = drive.channel === 'get' ? send : get;
      // Without this, an adapter that returned a hard-coded empty answer would
      // pass every mapping case below without ever calling anything.
      expect(channel, `${drive.name} issued no request`).toHaveBeenCalledTimes(1);
      expect(other, `${drive.name} used the wrong channel`).not.toHaveBeenCalled();
    }
  });

  it('reaches every published apt.* and rec.* operation, and invents none', async () => {
    /*
     * The claim in BOTH directions, at the layer that actually calls:
     *
     *   - an operation the contract publishes that NO adapter reaches fails
     *     here — the contract-mirror suites cannot see this, because a table row
     *     is a statement about a contract and not about a call;
     *   - a path an adapter builds that the contract does NOT publish fails too,
     *     which is the shape that produced `P1-27-INT-113` from the other side.
     *
     * Derived from the generated manifest, never from a list in this file.
     */
    const reached = new Set<string>();
    const unpublished: string[] = [];

    for (const drive of DRIVES) {
      const channel = channelOf(drive);
      channel.mockClear();
      await drive.call();
      const call = channel.mock.calls[0] as unknown[] | undefined;
      expect(call, `${drive.name} issued no request`).toBeDefined();

      const method = drive.channel === 'get' ? 'GET' : String(call?.[0] ?? '');
      const path = String(drive.channel === 'get' ? (call?.[0] ?? '') : (call?.[1] ?? ''));
      const operation = resolveOperation(method, path);
      if (operation === null) {
        unpublished.push(`${drive.name} → ${method} ${path}`);
        continue;
      }
      reached.add(operation.operationId);
    }

    expect(
      unpublished,
      `these adapters call a path the contract does not publish:\n  ${unpublished.join('\n  ')}`
    ).toEqual([]);

    const published = publishedAptRec();
    const administrative = new Set(administrativeAptRec());
    const operator = published.filter(
      (id) => !administrative.has(id) && !UNCONSUMED_READS.has(id) && !PENDING_ADAPTERS.has(id)
    );

    const unreached = operator.filter((id) => !reached.has(id));
    expect(
      unreached,
      `these published operations are reached by no adapter:\n  ${unreached.join('\n  ')}`
    ).toEqual([]);

    /*
     * The declared-unconsumed reads, from the other side and on the same terms
     * as the administration surface: excluded above, asserted UNREACHED here.
     * If an adapter ever calls one, whoever wired it must delete the entry in
     * the same change rather than leave a screen the record says does not
     * exist.
     */
    const reachedUnconsumed = [...reached].filter((id) => UNCONSUMED_READS.has(id)).sort();
    expect(
      reachedUnconsumed,
      'an adapter reaches an operation this phase records as consumed by nothing; ' +
        'wire it against a canonical task and drop the exclusion, or do not wire it'
    ).toEqual([]);

    /*
     * The administration surface, from the other side. It is EXCLUDED above
     * and asserted UNREACHED here, so the exclusion cannot quietly become a
     * place to park an operation somebody did wire: if an adapter ever calls
     * one of these, this case fails and whoever wired it must answer
     * `P1-28-OD-001` and flip the SEC-004 manifest in the same change.
     */
    const reachedAdministrative = [...reached].filter((id) => administrative.has(id)).sort();
    expect(
      reachedAdministrative,
      'an adapter reaches the catalogue-administration surface, which this product withholds ' +
        'pending P1-28-OD-001; wire it deliberately or not at all'
    ).toEqual([]);

    /*
     * The pending-adapter surface, on exactly the same terms — and this is the
     * staleness guard that keeps PENDING_FRONTEND_ADAPTER transitional.
     *
     * A pending entry says a Backend remediation published a read whose adapter
     * its ownership profile forbade it to write. That claim is false the instant
     * an adapter exists, so an entry that outlives its adapter fails HERE, in the
     * one place that can tell: reachability is measured by running the adapters
     * against a mocked transport, never by scanning source for path strings.
     *
     * When the Frontend branch wires the picker, this case goes red until the
     * entry is deleted — which is the whole point. The debt cannot be paid
     * silently, and it cannot be left behind either.
     */
    const reachedPending = [...reached].filter((id) => PENDING_ADAPTERS.has(id)).sort();
    expect(
      reachedPending,
      'an adapter reaches an operation still declared PENDING_FRONTEND_ADAPTER; delete the entry ' +
        'from docs/phase-1/phase-1-28/adapter-reachability.json in the same change that wired it'
    ).toEqual([]);

    /*
     * Exhaustive derivation. Every published apt/rec operation is in EXACTLY one
     * of the four buckets — reached, administrative, deliberately absent, pending
     * — and nothing is in two. Without this the three exclusion lists could
     * disagree, or an operation could fall between them and be judged by nobody,
     * which is the silence this whole apparatus exists to prevent.
     */
    for (const id of published) {
      const states = [
        reached.has(id) && 'REACHABLE',
        administrative.has(id) && 'ADMINISTRATIVE',
        UNCONSUMED_READS.has(id) && 'DELIBERATELY_ABSENT',
        PENDING_ADAPTERS.has(id) && 'PENDING_FRONTEND_ADAPTER',
      ].filter(Boolean);
      expect(states, `${id} is in ${states.length} states, not exactly one`).toHaveLength(1);
    }

    // Anti-vacuity for every derivation. An empty published set would make the
    // filter above trivially satisfied; an administration set that swallowed
    // the operator surface would do the same, one layer down; and a pending list
    // that grew to cover the surface would hide an unwired product behind debt.
    expect(published.length).toBeGreaterThan(25);
    expect(administrative.size).toBe(28);
    expect(operator.length).toBeGreaterThan(25);
    expect(PENDING_ADAPTERS.size).toBeLessThan(3);
  });

  it('lets no unconsumed-read exclusion rest on this file’s own judgement', () => {
    /*
     * Excluding an operation from a completeness sweep is the move that hides an
     * INT-113, so each exclusion is corroborated by a fact this file does not
     * own: the canonical plan binds it to no task. Bind it in §5 and the
     * generated matrix carries it, and this case fails.
     */
    const published = new Set(publishedAptRec());
    const bound = canonicallyBoundOperations();
    const reads = new Set(
      PUBLISHED_OPERATIONS.filter((op) => op.method === 'GET').map((op) => op.operationId)
    );

    expect(UNCONSUMED_READS.size, 'the corroboration below would be vacuous').toBeGreaterThan(0);
    expect(
      bound.size,
      'the matrix binds no operation — this corroboration is vacuous'
    ).toBeGreaterThan(10);

    for (const [id, reason] of UNCONSUMED_READS) {
      expect(published.has(id), `${id} is excluded and the contract publishes no such id`).toBe(
        true
      );
      expect(reads.has(id), `${id} is excluded as a read and is not a GET`).toBe(true);
      expect(bound.has(id), `${id} is excluded as unbound and a canonical task binds it`).toBe(
        false
      );
      expect(reason.trim().length, `${id} is excluded with no reason`).toBeGreaterThan(40);
    }
  });

  it('records the withheld administration surface as a DECISION, not as an omission', () => {
    /*
     * The corroboration that makes the exclusion above trustworthy. Excluding
     * 28 operations from a completeness sweep is exactly the move that hides an
     * INT-113, so the exclusion is not allowed to rest on this file's own
     * judgement: every WRITE among them must be classified
     * `DELIBERATELY_ABSENT` in the SEC-004 manifest, against a `decisionRef`
     * that the canonical plan §7 records as a decision heading.
     *
     * `scripts/ci/check-p1-28-write-reachability.mjs` is the authority and
     * resolves the reference itself; this case is the web tier refusing to take
     * the exclusion on trust while that gate runs elsewhere.
     */
    const manifest = repoJson<{
      operations: Record<string, { classification: string; decisionRef?: string }>;
    }>('docs', 'phase-1', 'phase-1-28', 'write-reachability.json');
    const plan = readFileSync(
      join(REPO, 'docs', 'phase-1', 'phase-1-28', 'canonical-plan.md'),
      'utf8'
    );
    const section = /^##\s*7\.\s[\s\S]*?(?=^##\s(?!#))/m.exec(plan)?.[0] ?? '';
    expect(
      section.length,
      'the canonical plan has no section 7 to resolve against'
    ).toBeGreaterThan(0);

    const writes = administrativeAptRec().filter((id) => {
      const operation = PUBLISHED_OPERATIONS.find((op) => op.operationId === id);
      return operation !== undefined && operation.method !== 'GET';
    });
    expect(writes.length, 'the administration surface publishes no write').toBe(21);

    for (const id of writes) {
      const entry = manifest.operations[id];
      expect(entry, `${id} is unclassified in the SEC-004 manifest`).toBeDefined();
      expect(entry?.classification, id).toBe('DELIBERATELY_ABSENT');
      const reference = entry?.decisionRef ?? '';
      expect(reference.length, `${id} carries no decisionRef`).toBeGreaterThan(0);
      expect(
        new RegExp(`^###\\s+\`${reference}\``, 'm').test(section),
        `${id} names "${reference}", which the canonical plan §7 does not record as a decision`
      ).toBe(true);
    }
  });

  it('gives every operation an adapter reaches a contract-module row', async () => {
    // The join the two contract suites cannot make alone: each holds its own
    // table against the manifest, and neither asks whether the operation the
    // application actually calls is the one a table mirrors.
    const mirrored = new Set<string>([
      ...APPOINTMENT_OPERATIONS.map((row) => row.operationId),
      ...RECEPTION_OPERATIONS.map((row) => row.operationId),
    ]);

    const missing: string[] = [];
    for (const drive of DRIVES) {
      const channel = channelOf(drive);
      channel.mockClear();
      await drive.call();
      const call = channel.mock.calls[0] as unknown[] | undefined;
      const method = drive.channel === 'get' ? 'GET' : String(call?.[0] ?? '');
      const path = String(drive.channel === 'get' ? (call?.[0] ?? '') : (call?.[1] ?? ''));
      const id = resolveOperation(method, path)?.operationId ?? '';
      if (/^(apt|rec)\./.test(id) && !mirrored.has(id)) missing.push(`${drive.name} → ${id}`);
    }
    expect(missing, 'an operation this app calls that no contract row mirrors').toEqual([]);
    expect(mirrored.size).toBeGreaterThan(25);
  });

  it('leaves no component of the two feature trees NAMED BY NO TEST', () => {
    /*
     * DERIVED from the filesystem. A filename assertion — "these fifteen suites
     * exist" — can only fail when a file is renamed, never when a component is
     * untested, and that is exactly how six P1-27 components shipped with zero
     * component coverage under a green QA-001.
     *
     * ## What this proves, and what it does not
     *
     * It proves NAMING, not rendering, and it used to be titled as though it
     * proved rendering. The check is a word-boundary search for each component's
     * identifier across the comment-stripped suite sources: a component named in
     * an import that a `.dom` suite never mounts satisfies it, and so does one
     * named only in an `expect(...).toBeNull()`. That is a real gap and it is
     * stated rather than papered over.
     *
     * It is still worth having, because the failure it DOES catch is the one
     * that happened: a component added to a feature tree that no suite mentions
     * at all. Rendering is proved where it is proved — by the `.dom` suites, one
     * component at a time, against real props.
     */
    const components = p1TwentyEightComponents();
    expect(components.length, 'no components were discovered — the walk is broken').toBeGreaterThan(
      25
    );

    const suite = testSources();
    const unnamed = components.filter((name) => !new RegExp(`\\b${name}\\b`).test(suite));
    expect(unnamed, `these components are named by no test:\n  ${unnamed.join('\n  ')}`).toEqual(
      []
    );
  });

  it('cannot be satisfied by a component named only in prose', () => {
    // The positive control for the sweep above. If the stripper ever stopped
    // removing comments, this fails rather than the sweep silently widening.
    const sample = [
      '/** RenderedNowhereScreen is deliberately named in this docblock. */',
      "// AlsoNowhereScreen in a line comment, and a URL that must survive: 'https://example.test/keep'",
      "const path = '/receptions';",
    ].join('\n');
    const stripped = stripComments(sample);
    expect(stripped).not.toContain('RenderedNowhereScreen');
    expect(stripped).not.toContain('AlsoNowhereScreen');
    expect(stripped).toContain("'/receptions'");
  });

  it('excludes itself from the corpus it measures', () => {
    // A meter that counts its own prose measures nothing. `p1TwentyEightComponents` is
    // declared in this file and named nowhere else.
    expect(testSources()).not.toContain('p1TwentyEightComponents');
  });

  it('covers every wizard step, derived from the registry rather than named', () => {
    // Thirteen steps today. The set comes from `CHECK_IN_STEPS`, so a step
    // appended by a later wave arrives in this claim the day it is registered.
    const suite = testSources();
    const uncovered = CHECK_IN_STEPS.filter(
      (step) => !new RegExp(`\\b${step.Component.name}\\b`).test(suite)
    ).map((step) => `${step.id} (${step.Component.name})`);
    expect(
      uncovered,
      `these wizard steps are rendered by no test:\n  ${uncovered.join('\n  ')}`
    ).toEqual([]);
    expect(CHECK_IN_STEPS.length).toBeGreaterThan(10);
  });

  it('covers every route page the two trees publish', () => {
    /*
     * A page is a screen an operator can arrive at by URL, and its permission
     * gate is the only thing between them and the data. Derived from the router
     * directory so a page added without a suite fails here.
     */
    const dashboard = join(process.cwd(), 'src', 'app', '[locale]', '(dashboard)');
    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name === 'page.tsx') pages.push(full.replace(/\\/g, '/'));
      }
    };
    for (const tree of ['appointments', 'receptions']) walk(join(dashboard, tree));

    expect(pages.length, 'no P1-28 pages were discovered').toBeGreaterThan(5);

    const suite = testSources();
    const uncovered = pages.filter((file) => {
      // The route suites import a page by its module path, so the path fragment
      // below `(dashboard)/` is what a citation looks like.
      const fragment = file.slice(file.indexOf('(dashboard)/') + '(dashboard)/'.length);
      const withoutFile = fragment.slice(0, fragment.lastIndexOf('/page.tsx'));
      return !suite.includes(withoutFile);
    });
    expect(
      uncovered,
      `these route pages are imported by no test:\n${uncovered.join('\n')}`
    ).toEqual([]);
  });
});

/* ================================================================== *
 * QA-002 — every operation through every refusal, and the three replays
 * ================================================================== */

describe('P1-28-QA-002 — every adapter through every transport kind', () => {
  const KINDS = Object.keys(STATUS_BY_KIND);

  it('covers all eleven transport kinds', () => {
    expect(KINDS).toHaveLength(11);
  });

  it('maps every kind from every READ to the state an operator should see', async () => {
    for (const drive of READ_DRIVES) {
      for (const kind of KINDS) {
        get.mockReset();
        get.mockResolvedValue({ ok: false, kind, status: null, correlationId: 'corr-1' });
        const result = (await drive.call()) as { status: string };
        expect(result.status, `${drive.name} on ${kind}`).toBe(
          STATUS_BY_KIND[kind as keyof typeof STATUS_BY_KIND]
        );
      }
    }
  });

  it('maps every kind from every WRITE to an action state, and never to success', async () => {
    // The write mapping is a DIFFERENT table from the read mapping — a 409 is
    // `error` for a read and `conflict` for a write — so asserting one proves
    // nothing about the other. What both must never do is report failure as
    // success.
    const EXPECTED: Record<string, string> = {
      unauthenticated: 'expired',
      forbidden: 'denied',
      'not-found': 'error',
      conflict: 'conflict',
      validation: 'invalid',
      'rate-limited': 'throttled',
      server: 'error',
      unavailable: 'unavailable',
      timeout: 'unavailable',
      cancelled: 'error',
      network: 'unavailable',
    };
    for (const drive of WRITE_DRIVES) {
      for (const kind of KINDS) {
        send.mockReset();
        send.mockResolvedValue({
          ok: false,
          kind,
          status: null,
          problem: null,
          correlationId: 'corr-1',
        });
        const result = (await drive.call()) as { status: string };
        expect(result.status, `${drive.name} on ${kind}`).toBe(EXPECTED[kind]);
        expect(result.status, `${drive.name} on ${kind}`).not.toBe('success');
      }
    }
  });

  it('carries the correlation reference out of every failure', async () => {
    for (const drive of DRIVES) {
      const channel = channelOf(drive);
      channel.mockReset();
      channel.mockResolvedValue({
        ok: false,
        kind: 'server',
        status: 500,
        problem: null,
        correlationId: 'corr-xyz',
      });
      const result = (await drive.call()) as { correlationId: string | null };
      expect(result.correlationId, drive.name).toBe('corr-xyz');
    }
  });

  it('reports an expired session without issuing a request', async () => {
    for (const drive of DRIVES) {
      get.mockClear();
      send.mockClear();
      authorizedClient.mockResolvedValueOnce(null as unknown);
      const result = (await drive.call()) as { status: string };
      expect(result.status, drive.name).toBe('expired');
      // A request with no session cannot succeed. Sending it spends a
      // rate-limit slot to be told what was already known.
      expect(get, drive.name).not.toHaveBeenCalled();
      expect(send, drive.name).not.toHaveBeenCalled();
    }
  });
});

describe('P1-28-QA-002 — the four refusal branches the contract names', () => {
  /** A problem+json body the platform really sends. */
  function problem(status: number, code: string, violations?: unknown) {
    return {
      ok: false as const,
      kind:
        status === 403
          ? ('forbidden' as const)
          : status === 409
            ? ('conflict' as const)
            : ('validation' as const),
      status,
      problem: { code, correlationId: 'corr-p', ...(violations ? { violations } : {}) },
      correlationId: 'corr-p',
    };
  }

  it('403 — every write reports a denial, and no write reports it as invalid input', async () => {
    for (const drive of WRITE_DRIVES) {
      send.mockReset();
      send.mockResolvedValue(problem(403, 'ERR-AUT-002'));
      const result = (await drive.call()) as { status: string; messageKey?: string };
      expect(result.status, drive.name).toBe('denied');
      // WF-27: a complaint or contents write passes the application's
      // permission check and is refused by the DATABASE without
      // `iam.sensitive.view`. The operator opened a form they were allowed to
      // open — the honest report is "refused", not "you typed something wrong".
      expect(result.messageKey, drive.name).toBe('state.denied.title');
    }
  });

  it('403 — every read renders a denial, never an empty list', async () => {
    // A 403 rendered as empty reads to an operator as "there is nothing here"
    // when the truth is "you may not see it".
    for (const drive of READ_DRIVES) {
      get.mockReset();
      get.mockResolvedValue(problem(403, 'ERR-AUT-002'));
      const result = (await drive.call()) as { status: string; rows?: unknown[] };
      expect(result.status, drive.name).toBe('denied');
      expect(result.rows ?? [], drive.name).toEqual([]);
    }
  });

  it('409 ERR-CON-001 is STALE, and every other 409 is BLOCKED', async () => {
    /*
     * The two 409s mean opposite things and the cure is opposite:
     *
     *   - `ERR-CON-001` — the version moved under this screen. Re-reading cures
     *     it, and the operator retries with the version the read returns.
     *   - anything else, `ERR-TRN-001` above all — the STATE refuses the
     *     command. Re-reading does not cure it, and a screen inviting a retry
     *     invites the same refusal.
     */
    for (const drive of WRITE_DRIVES) {
      send.mockReset();
      send.mockResolvedValue(problem(409, 'ERR-CON-001'));
      const stale = (await drive.call()) as { status: string; messageKey?: string };
      expect(stale.status, drive.name).toBe('conflict');
      expect(stale.messageKey, drive.name).toBe('state.conflict.title');
      expect(conflictKindOf(stale.messageKey)).toBe('stale');

      for (const code of ['ERR-TRN-001', 'ERR-RES-002']) {
        send.mockReset();
        send.mockResolvedValue(problem(409, code));
        const blocked = (await drive.call()) as { status: string; messageKey?: string };
        expect(blocked.status, `${drive.name} on ${code}`).toBe('conflict');
        expect(blocked.messageKey, `${drive.name} on ${code}`).toBe('state.conflict.blocked.title');
        expect(conflictKindOf(blocked.messageKey)).toBe('blocked');
      }
    }
  });

  it('422 marks the control the violation names, as a KEY and never as server prose', async () => {
    for (const drive of WRITE_DRIVES) {
      send.mockReset();
      send.mockResolvedValue(
        problem(422, 'ERR-VAL-001', [
          { path: 'body.vehicleId', rule: 'unknown_reference' },
          // A violation about the whole request names no control. Dropping it
          // would leave a form refusing with no reason given.
          { path: 'body', rule: 'incoherent_reference' },
        ])
      );
      const result = (await drive.call()) as {
        status: string;
        fieldErrors?: Record<string, string>;
        messageKey?: string;
      };
      expect(result.status, drive.name).toBe('invalid');
      expect(result.fieldErrors?.vehicleId, drive.name).toBeTruthy();
      expect(result.fieldErrors?.vehicleId, drive.name).toMatch(/^form\.violation\./);
      expect(result.messageKey, drive.name).toMatch(/^form\./);
    }
  });

  it('428 cannot be produced: every guarded adapter takes the version as a REQUIRED argument', async () => {
    /*
     * The backend answers 428 `ERR-CON-002` when a version-guarded command
     * arrives without `If-Match`. At this layer that is not a runtime branch to
     * map, it is a shape to make unreachable: `ifMatch` is a required positional
     * parameter of every guarded adapter, so the header is present on every
     * request the application can construct.
     *
     * Asserted against the request the adapter really issued, because the type
     * signature alone is a compile-time claim and this file is about what runs.
     */
    const guarded = WRITE_DRIVES.filter((drive) => drive.versionGuarded);
    expect(guarded.length, 'no guarded writes were discovered').toBe(7);

    for (const drive of guarded) {
      send.mockReset();
      send.mockResolvedValue(OK_COMMAND);
      await drive.call();
      const options = send.mock.calls[0]?.[3] as { ifMatch?: unknown } | undefined;
      expect(options?.ifMatch, `${drive.name} sent no If-Match`).toBe(VERSION);
    }
  });

  it('428 arriving anyway is never reported as success', async () => {
    // The failing-closed half. `kindFor` has no 428 branch, so it lands in
    // `server` — which is right for a condition no operator can act on and
    // which a client defect produced — but what must hold is that it is not
    // absorbed as an outcome the screen would render as done.
    for (const drive of WRITE_DRIVES.filter((one) => one.versionGuarded)) {
      send.mockReset();
      send.mockResolvedValue({
        ok: false,
        kind: 'server',
        status: 428,
        problem: { code: 'ERR-CON-002', correlationId: 'corr-428' },
        correlationId: 'corr-428',
      });
      const result = (await drive.call()) as { status: string };
      expect(result.status, drive.name).toBe('error');
      expect(result.status, drive.name).not.toBe('success');
    }
  });
});

/**
 * `P1-28-QA-002` — the three replay shapes.
 *
 * Create replays to a SUCCESS, approve re-runs to a CONFLICT, convert replays to
 * a SUCCESS carrying `alreadyConverted`. Two successes and one refusal, and each
 * of the three cases below asserts its own observed outcome against the response
 * the transport really returned — which is where the "these are genuinely three
 * shapes" control lives.
 *
 * A fourth case used to state that control separately, as
 * `expect(new Set(['success', 'conflict', 'success']).size).toBe(2)` over a
 * literal declared on the line above it. It read as a control and was not one:
 * no product value, no test value and no fixture reached it, so no change to
 * this repository could ever have made it fail. It is deleted rather than
 * repaired, because the thing it claimed to guard is already guarded three times
 * below, by assertions that CAN fail.
 */
describe('P1-28-QA-002 — the three replay shapes', () => {
  it('create replay: 200 with no ETag is SUCCESS, and the stored body travels', async () => {
    /*
     * Shape one. An idempotent replay of ANY command returns 200 — even create,
     * whose first answer was 201 — with the stored body and **no ETag**
     * (`route-handler.ts:369-401`). An adapter that required a 201, or that read
     * a version out of a header, would report a successful replay as a failure
     * and the operator would create a second visit for the same vehicle.
     */
    const stored = {
      receptionVisitId: VISIT,
      displayNumber: 'R-0001',
      receptionStatus: 'opened',
      origin: 'walk_in',
      recordVersion: 1,
    };
    send.mockReset();
    send.mockResolvedValue({ ok: true, status: 200, data: stored, correlationId: 'corr-replay' });

    const create = WRITE_DRIVES.find((drive) => drive.name === 'createReception');
    const result = (await create?.call()) as { status: string; created?: typeof stored };
    expect(result.status).toBe('success');
    expect(result.created).toEqual(stored);

    // And the same adapter reports the FIRST answer, a 201, identically — the
    // status code is not what it reads.
    send.mockReset();
    send.mockResolvedValue({ ok: true, status: 201, data: stored, correlationId: 'corr-first' });
    const first = (await create?.call()) as { status: string; created?: typeof stored };
    expect(first.status).toBe('success');
    expect(first.created).toEqual(stored);
  });

  it('approve re-run: 409 ERR-TRN-001 is a refusal re-reading does NOT cure', async () => {
    // Shape two. Re-running approve on an already-authorized visit with a NEW
    // key is refused by the STATE, not absorbed as idempotent success. The
    // screen must not offer "reload and try again", which is why the conflict
    // is classified `blocked` rather than `stale`.
    send.mockReset();
    send.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      problem: { code: 'ERR-TRN-001', correlationId: 'corr-trn' },
      correlationId: 'corr-trn',
    });
    const approve = WRITE_DRIVES.find((drive) => drive.name === 'approveReception');
    const result = (await approve?.call()) as { status: string; messageKey?: string };
    expect(result.status).toBe('conflict');
    expect(conflictKindOf(result.messageKey)).toBe('blocked');
    expect(result.messageKey).not.toBe('state.conflict.title');
  });

  it('convert re-run: 200 with alreadyConverted true is SUCCESS, and names the work order', async () => {
    /*
     * Shape three, and the one most easily rendered as a failure. The platform
     * is saying "that already happened, here is the work order"; a screen that
     * treated it as an error would send an operator hunting for a work order the
     * answer just named.
     */
    const replay = {
      receptionVisitId: VISIT,
      workOrderId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      displayNumber: 'WO-0001',
      state: 'opened',
      alreadyConverted: true,
    };
    send.mockReset();
    send.mockResolvedValue({ ok: true, status: 200, data: replay, correlationId: 'corr-conv' });

    const convert = WRITE_DRIVES.find((drive) => drive.name === 'convertReceptionToWorkOrder');
    const result = (await convert?.call()) as { status: string; converted?: typeof replay };
    expect(result.status).toBe('success');
    expect(result.converted?.alreadyConverted).toBe(true);
    expect(result.converted?.workOrderId).toBe(replay.workOrderId);
    // The response carries NO ETag, so nothing may be derived from one.
    expect(Object.keys(replay)).not.toContain('recordVersion');
  });
});

describe('P1-28-QA-002 — approve answers with the version, and it can be sent + 2', () => {
  it('reports the RESPONSE version, whether one edge was applied or two', async () => {
    /*
     * From `inspecting` approve walks one edge; from `opened` it walks TWO in one
     * transaction (`opened → inspecting → authorized`), so the answer is
     * `sent + 2`. `sent + 1` is wrong half the time and `sent + 2` the other
     * half; only the response is right both times.
     */
    const approve = WRITE_DRIVES.find((drive) => drive.name === 'approveReception');

    send.mockReset();
    send.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        receptionVisitId: VISIT,
        receptionStatus: 'authorized',
        recordVersion: VERSION + 2,
        appliedTransitions: ['inspecting', 'authorized'],
      },
      correlationId: 'corr-approve',
    });
    const twoEdges = (await approve?.call()) as {
      status: string;
      approved?: { recordVersion: number; appliedTransitions: readonly string[] };
    };
    expect(twoEdges.status).toBe('success');
    expect(twoEdges.approved?.recordVersion).toBe(VERSION + 2);
    expect(twoEdges.approved?.appliedTransitions).toHaveLength(2);
    expect(nextVersionAfter(VERSION, twoEdges.approved?.recordVersion ?? 0)).toBe(VERSION + 2);

    send.mockReset();
    send.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        receptionVisitId: VISIT,
        receptionStatus: 'authorized',
        recordVersion: VERSION + 1,
        appliedTransitions: ['authorized'],
      },
      correlationId: 'corr-approve',
    });
    const oneEdge = (await approve?.call()) as { approved?: { recordVersion: number } };
    expect(oneEdge.approved?.recordVersion).toBe(VERSION + 1);
    expect(nextVersionAfter(VERSION, oneEdge.approved?.recordVersion ?? 0)).toBe(VERSION + 1);

    // The load-bearing half: the two answers DIFFER, so a screen that computed
    // either constant would be wrong for the other.
    expect(VERSION + 2).not.toBe(VERSION + 1);
  });

  it('sends the version it was handed, never one it worked out', async () => {
    const approve = WRITE_DRIVES.find((drive) => drive.name === 'approveReception');
    send.mockReset();
    send.mockResolvedValue(OK_COMMAND);
    await approve?.call();
    expect(send.mock.calls[0]?.[3]).toEqual({ ifMatch: VERSION });
  });
});

/* ================================================================== *
 * QA-003 — tenant, company and branch isolation
 * ================================================================== */

describe('P1-28-QA-003 — scope is resolved by the server, and asserted by nobody', () => {
  /**
   * Which operations may legitimately carry `companyId` and `branchId`, DERIVED.
   *
   * The pair is not always a scope assertion, and treating it as one would break
   * four working screens. Two different sentences share the words:
   *
   *   - "I am in branch Y" — a claim about the CALLER. Never sent; the server
   *     resolves scope from the session and `query()` throws on the names.
   *   - "book on branch Y's calendar" / "show me branch Y's board" — a claim
   *     about the RESOURCE, which the route's own `.strict()` schema demands and
   *     authorizes against exactly that pair (`P1-18-A-01`).
   *
   * The second sentence is possible only where the request names no record the
   * server could resolve a branch FROM: a collection read (`/appointments`,
   * `/receptions`) and a create, whose record does not exist yet. Every other
   * apt/rec operation carries `{appointmentId}` or `{receptionId}` in its path
   * and resolves the branch itself, so the pair would be a caller's claim there
   * and nothing else.
   *
   * So the rule is read off the published contract — `x-scope: 'branch'` and a
   * template with no path parameter — rather than written down as a list of
   * operations somebody would have to keep true.
   */
  const document = JSON.parse(
    readFileSync(join(process.cwd(), '..', '..', 'docs', 'api', 'openapi.v1.json'), 'utf8')
  ) as {
    paths: Record<string, Record<string, { operationId?: string; 'x-scope'?: string }>>;
  };

  const BRANCH_ADDRESSED = new Set<string>();
  for (const methods of Object.values(document.paths)) {
    for (const operation of Object.values(methods)) {
      const id = operation.operationId;
      if (typeof id !== 'string' || operation['x-scope'] !== 'branch') continue;
      const published = PUBLISHED_OPERATIONS.find((one) => one.operationId === id);
      if (published && !published.template.includes('{')) BRANCH_ADDRESSED.add(id);
    }
  }

  /** The operation one drive's request denotes, from the request it issued. */
  async function operationOf(drive: (typeof DRIVES)[number]) {
    const channel = channelOf(drive);
    channel.mockClear();
    await drive.call();
    const call = channel.mock.calls[0] as unknown[] | undefined;
    expect(call, `${drive.name} issued no request`).toBeDefined();
    const method = drive.channel === 'get' ? 'GET' : String(call?.[0] ?? '');
    const path = String(drive.channel === 'get' ? (call?.[0] ?? '') : (call?.[1] ?? ''));
    return { id: resolveOperation(method, path)?.operationId ?? '', call: JSON.stringify(call) };
  }

  it('derived a real rule, and in this phase it names exactly five operations', () => {
    // Anti-vacuity first: a set that had become everything, or nothing, would
    // make the sweep below meaningless. The rule is platform-wide by
    // construction — it holds for every collection read and every create — so
    // the narrow claim is made where this phase can make it.
    expect(BRANCH_ADDRESSED.size).toBeGreaterThan(0);
    expect(BRANCH_ADDRESSED.size).toBeLessThan(PUBLISHED_OPERATIONS.length / 4);
    expect([...BRANCH_ADDRESSED].filter((id) => /^(apt|rec)\./.test(id)).sort()).toEqual([
      'apt.appointment-create',
      'apt.appointment-list',
      // The FE-007 picker is branch-addressed for the same reason the two
      // collection reads are: which employees may accept custody depends on the
      // branch, so the branch is a resource selector carried as the
      // authorization target, not a filter the client applies afterwards.
      // ('receiving' sorts before 'reception': 'i' precedes 'p'.)
      'rec.receiving-employee-list',
      'rec.reception-create',
      'rec.reception-list',
    ]);
    // A detail read, an approval and an evidence append all name a record the
    // server resolves the branch FROM, so none of them may carry the pair.
    for (const id of [
      'apt.appointment-detail',
      'apt.appointment-cancel',
      'rec.reception-detail',
      'rec.reception-approve',
      'rec.reception-condition-evidence',
    ]) {
      expect(BRANCH_ADDRESSED.has(id), id).toBe(false);
    }
  });

  it('lets no request carry a scope its operation may not be addressed by', async () => {
    for (const drive of DRIVES) {
      const { id, call } = await operationOf(drive);
      const carries = /compan(y|ies)Id|branchId/i.test(call);
      if (!carries) continue;
      expect(
        BRANCH_ADDRESSED.has(id),
        `${drive.name} sends the branch pair to ${id}, which resolves its own branch`
      ).toBe(true);
    }
  });

  it('pins WHICH requests carry the pair, so the exemption cannot widen quietly', async () => {
    const carrying: string[] = [];
    for (const drive of DRIVES) {
      const { call } = await operationOf(drive);
      if (/compan(y|ies)Id|branchId/i.test(call)) carrying.push(drive.name);
    }
    expect(carrying.sort()).toEqual([
      'createAppointment',
      'createReception',
      'listAppointments',
      'listConfirmedAppointments',
      'listReceptions',
    ]);
  });

  it('never sends a tenant, on any request at all', async () => {
    // Tenant above all: no operation anywhere in the platform accepts a
    // client-supplied tenant, and the branch-addressing exemption does not
    // extend to one.
    for (const drive of DRIVES) {
      const channel = channelOf(drive);
      channel.mockClear();
      await drive.call();
      // The positive control FIRST. `?? ''` would let "no request at all" pass
      // as "no tenant", and an adapter that stopped calling the client would
      // satisfy the sweep perfectly.
      expect(channel, `${drive.name} issued no request`).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(channel.mock.calls[0]), drive.name).not.toMatch(/tenant/i);
    }
  });

  it('sends the branch pair as the TARGET, and the target is the one it was handed', async () => {
    for (const name of ['listAppointments', 'listReceptions', 'listConfirmedAppointments']) {
      const drive = DRIVES.find((one) => one.name === name);
      expect(drive, `${name} is not in the drive table`).toBeDefined();
      get.mockClear();
      await drive?.call();
      const path = String(get.mock.calls[0]?.[0] ?? '');
      expect(path, name).toContain(`companyId=${TARGET.companyId}`);
      expect(path, name).toContain(`branchId=${TARGET.branchId}`);
      // And nothing else about the caller travels with it.
      expect(path, name).not.toMatch(/tenant/i);
    }
  });

  it('the exemption is enforced at the ONE door, not trusted to every call site', async () => {
    // `query()` refuses the scope names outright rather than dropping them:
    // dropping would let a caller believe it had asserted a scope that never
    // left the process.
    const { query, branchTargetQuery } = await import('@/lib/api/read-operation');
    for (const key of ['tenantId', 'companyId', 'branchId', 'tenant_id']) {
      expect(() => query({ [key]: 'x' }), key).toThrow(/must not be sent from the client/);
    }
    // And the branch-target door refuses the pair among ordinary filters, so a
    // caller cannot smuggle a second copy past the parameter that is the door.
    expect(() => branchTargetQuery(TARGET, { branchId: 'other' })).toThrow(
      /must arrive through the BranchTarget parameter/
    );
    // A blank half is refused rather than serialised as the string "undefined".
    expect(() => branchTargetQuery({ companyId: '', branchId: 'b' })).toThrow(/mandatory/);
  });

  it('no screen in either tree can resolve or widen its own scope', () => {
    /*
     * The structural half. A component that read the session could choose which
     * branch to ask about — which is a screen widening its own scope, whatever
     * the server then decides. Every P1-28 screen receives the target from its
     * ROUTE, which resolves it from the session once; the sweep below is over
     * the two feature trees, where a session read would be that defect.
     */
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name)) continue;
        const source = stripComments(readFileSync(full, 'utf8'));
        if (/features\/authentication\/api\/session/.test(source)) {
          offenders.push(full.replace(/\\/g, '/'));
        }
      }
    };
    for (const root of FEATURE_ROOTS) walk(root);
    expect(
      offenders,
      `these feature files read the session directly:\n${offenders.join('\n')}`
    ).toEqual([]);

    // Anti-vacuity: the ROUTES really do read it, so the sweep is looking for
    // something that exists rather than for a string nothing in the repository
    // contains.
    const routes = join(process.cwd(), 'src', 'app', '[locale]', '(dashboard)', 'receptions');
    const readers: string[] = [];
    const walkRoutes = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walkRoutes(full);
        else if (/\.tsx?$/.test(entry.name)) {
          if (/features\/authentication\/api\/session/.test(readFileSync(full, 'utf8'))) {
            readers.push(full);
          }
        }
      }
    };
    walkRoutes(routes);
    expect(readers.length, 'no route reads the session — the sweep proves nothing').toBeGreaterThan(
      0
    );
  });

  it('a cross-tenant read renders the SAME refusal a missing record does', async () => {
    /*
     * `ERR-RES-001` at 404 deliberately hides cross-tenant existence: telling
     * one tenant that another tenant's visit exists is the disclosure the code
     * exists to prevent. So this layer must invent no distinction the API does
     * not make — a "not yours" state rendered differently from "not there" would
     * reconstruct the oracle the backend closed.
     */
    const notFound = {
      ok: false as const,
      kind: 'not-found' as const,
      status: 404,
      problem: { code: 'ERR-RES-001', correlationId: 'corr-404' },
      correlationId: 'corr-404',
    };
    for (const drive of READ_DRIVES) {
      get.mockReset();
      get.mockResolvedValue(notFound);
      const foreign = (await drive.call()) as { status: string };
      get.mockReset();
      get.mockResolvedValue({ ...notFound, problem: null });
      const missing = (await drive.call()) as { status: string };
      expect(foreign.status, drive.name).toBe(missing.status);
    }
  });

  it('encodes every path parameter, so an identifier cannot escape its segment', async () => {
    const { readReception } = await import('@/features/receptions/api');
    get.mockReset();
    get.mockResolvedValue(OK_PAGE);
    await readReception('rv-1/../../admin');
    const path = String(get.mock.calls[0]?.[0] ?? '');
    expect(path).toContain('rv-1%2F..%2F..%2Fadmin');
    expect(path).not.toContain('/../');
  });
});

/* ================================================================== *
 * QA-004 — concurrency, idempotency and record-version sourcing
 * ================================================================== */

describe('P1-28-QA-004 — idempotency is read off the contract, never off the verb', () => {
  it('requires a key on every write this phase performs', async () => {
    const seen: string[] = [];
    for (const drive of WRITE_DRIVES) {
      send.mockClear();
      await drive.call();
      const method = String(send.mock.calls[0]?.[0] ?? '');
      const path = String(send.mock.calls[0]?.[1] ?? '');
      expect(requiresIdempotencyKey(method, path), `${drive.name} → ${method} ${path}`).toBe(true);
      seen.push(drive.name);
    }
    expect(seen.length, 'no writes were driven').toBe(14);
  });

  it('requires no key on any read, so a GET never answers 400 before authorization', async () => {
    for (const drive of READ_DRIVES) {
      get.mockClear();
      await drive.call();
      const path = String(get.mock.calls[0]?.[0] ?? '');
      expect(requiresIdempotencyKey('GET', path), `${drive.name} → GET ${path}`).toBe(false);
    }
  });

  it('sets no Idempotency-Key of its own — the contract-derived client owns it', async () => {
    // An adapter that generated its own key would turn every deliberate replay
    // into a second logical attempt, which is exactly what the backend's
    // idempotency exists to prevent.
    for (const drive of WRITE_DRIVES) {
      send.mockClear();
      await drive.call();
      const options = send.mock.calls[0]?.[3] as Record<string, unknown> | undefined;
      expect(options?.idempotencyKey, drive.name).toBeUndefined();
    }
  });
});

describe('P1-28-QA-004 — where the record version comes from', () => {
  it('sends If-Match on every guarded write and on no unguarded one', async () => {
    /*
     * The other half of the 428 case above, and the reason it matters that the
     * unguarded writes send NOTHING: seven `rec.*` writes are not version
     * guarded, and the routes do not read `expectedVersion` either, so a header
     * sent to one is parsed and discarded. Sending it anyway would read as
     * protection that is not there.
     */
    for (const drive of WRITE_DRIVES) {
      send.mockClear();
      await drive.call();
      const options = send.mock.calls[0]?.[3] as { ifMatch?: unknown } | undefined;
      if (drive.versionGuarded) {
        expect(options?.ifMatch, `${drive.name} sent no If-Match`).toBe(VERSION);
      } else {
        expect(options?.ifMatch, `${drive.name} sent an If-Match nothing reads`).toBeUndefined();
      }
    }
  });

  it('sends the version verbatim — no adapter adds, subtracts or defaults one', async () => {
    /*
     * Driven with three different versions rather than one, because a single
     * fixture cannot tell "passed through" from "returned a constant". The
     * value that goes out must equal the value handed in, exactly.
     */
    const { approveReception, convertReceptionToWorkOrder, refuseReception } =
      await import('@/features/receptions/api');
    const { rescheduleAppointment, cancelAppointment, recordAppointmentNoShow } =
      await import('@/features/appointments/api');
    const APPOINTMENT = '22222222-2222-4222-8222-222222222222';

    for (const version of [1, 3, 41]) {
      const calls: (() => Promise<unknown>)[] = [
        () => approveReception(VISIT, version),
        () => convertReceptionToWorkOrder(VISIT, version),
        () => refuseReception(VISIT, version, { reason: 'No safe lift is available.' }),
        () =>
          rescheduleAppointment(APPOINTMENT, version, {
            confirmedFrom: '2026-09-01T09:00:00Z',
            confirmedTo: '2026-09-01T10:00:00Z',
          }),
        () =>
          cancelAppointment(APPOINTMENT, version, {
            cancellationReasonId: '99999999-9999-4999-8999-999999999999',
          }),
        () => recordAppointmentNoShow(APPOINTMENT, version),
      ];
      for (const call of calls) {
        send.mockClear();
        await call();
        expect(send.mock.calls[0]?.[3]).toEqual({ ifMatch: version });
      }
    }
  });

  it('never derives the next version by arithmetic', () => {
    // `nextVersionAfter` exists to say, in ONE place, that the RESPONSE is the
    // authority. Driven with a shape nobody predicts, so a version of it that
    // had quietly become `sent + n` fails here.
    expect(nextVersionAfter(7, 8)).toBe(8);
    expect(nextVersionAfter(7, 9)).toBe(9);
    expect(nextVersionAfter(4, 4)).toBe(4);
    expect(nextVersionAfter(4, 41)).toBe(41);
  });

  it('the sourcing discipline is enforced by a GATE, not only by these cases', async () => {
    /*
     * A test can only judge the call sites it happens to drive. The defect this
     * task is about — a guarded command sent with a version that came from stale
     * state — lives in the SCREENS, and a screen that computed one would still
     * satisfy every adapter case above.
     *
     * `scripts/ci/check-p1-28-version-sourcing.mjs` is the mechanical half: it
     * walks `apps/web/src`, finds every call to a version-guarded adapter, and
     * traces the `If-Match` argument back to a read-supplied parameter or a
     * server-stated `recordVersion` — failing on arithmetic, on a numeric
     * literal, on an untraceable leaf, on a version reused by a second guarded
     * command, and on a component that never hands the outcome onward to be
     * re-read. `tests/ci/p1-28-version-sourcing.test.ts` mutation-proves it.
     *
     * This case asserts the gate is WIRED, because a gate no command runs is a
     * file, not a check — `validate:phase-ownership` was invoked by no CI job
     * for an entire phase.
     */
    const fs = await import('node:fs');
    const root = join(process.cwd(), '..', '..');
    const packageJson = JSON.parse(fs.readFileSync(join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts['validate:p1-28-version-sourcing']).toContain(
      'check-p1-28-version-sourcing.mjs'
    );
    expect(packageJson.scripts['verify:policies']).toContain('validate:p1-28-version-sourcing');
    expect(fs.existsSync(join(root, 'scripts', 'ci', 'check-p1-28-version-sourcing.mjs'))).toBe(
      true
    );
  });
});

/* ------------------------------------------------------------------ *
 * F8 — no P1-28 surface renders a bare identifier where a name belongs
 * ------------------------------------------------------------------ */

/**
 * The plan's §7 rule, made mechanical: **the UI shows names, never UUIDs.**
 *
 * This phase applied it to `receivingEmployeeId` twice and then shipped
 * `inspectorId` inside a `<code>` element under the label "Inspector", beside a
 * note saying no name could be resolved for it — while the complaint arm one
 * panel away joined a display name. A rule applied by hand, twice, and missed
 * once is a rule that needs a check.
 *
 * The check is deliberately narrow: it is about identifiers naming a PERSON, not
 * about every identifier. An odometer reading id or a correlation reference is a
 * record reference and belongs on screen exactly as it arrived. So the sweep
 * matches names a person is behind, and asserts two things about them — that the
 * evidence table never types one as a raw identifier, and that no component
 * renders one inside the monospaced element this product uses for tokens.
 */
const PERSON_ID = new RegExp(
  '\\b\\w*(inspector|employee|user|actor|technician|partner|customer|requester|reporter|' +
    'signer|witness|approver|owner|driver|staff)\\w*Id\\b',
  'i'
);

/** Every `.tsx` under the two feature trees, with its comments stripped. */
function p1_28ComponentSources(): readonly { readonly file: string; readonly body: string }[] {
  const out: { file: string; body: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.name.endsWith('.tsx')) continue;
      out.push({ file: full, body: stripComments(readFileSync(full, 'utf8')) });
    }
  };
  for (const root of FEATURE_ROOTS) walk(root);
  return out;
}

/**
 * Every `<code>…</code>` body in a source, as text.
 *
 * `<code>` is this product's one element for "a token, rendered exactly as it
 * arrived" — the evidence read-back, the correlation reference and the visit's
 * odometer reference all use it — which makes it the precise place a person's
 * identifier must never appear.
 */
function codeBodies(body: string): readonly string[] {
  return [...body.matchAll(/<code\b[^>]*>([\s\S]*?)<\/code>/g)].map((match) => match[1] ?? '');
}

describe('F8 — a person is shown by name, never by identifier', () => {
  it('is not vacuous: the sweep can see the elements it judges', () => {
    // If the walk found no components, or none of them rendered a `<code>` at
    // all, every assertion below would pass while measuring nothing.
    const sources = p1_28ComponentSources();
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.filter((source) => codeBodies(source.body).length > 0).length).toBeGreaterThan(
      0
    );
  });

  it('is not vacuous: the pattern recognises the field it was written for', () => {
    // The exact value that shipped, and a value that must NOT be caught.
    expect(PERSON_ID.test('inspectorId')).toBe(true);
    expect(PERSON_ID.test('receivingEmployeeId')).toBe(true);
    expect(PERSON_ID.test('reportedByPartnerId')).toBe(true);
    expect(PERSON_ID.test('odometerReadingId')).toBe(false);
    expect(PERSON_ID.test('correlationId')).toBe(false);
    expect(PERSON_ID.test('evidenceDocumentId')).toBe(false);
  });

  it('types no person-bearing evidence field as a raw identifier', () => {
    const offenders: string[] = [];
    for (const [kind, fields] of Object.entries(EVIDENCE_ROW_FIELDS)) {
      for (const field of fields) {
        if (!PERSON_ID.test(field.field)) continue;
        if (field.kind === 'identifier') offenders.push(`${kind}.${field.field}`);
      }
    }
    expect(offenders, 'a person rendered as a token rather than resolved to a name').toEqual([]);
  });

  it('has at least one person field, so the rule above is about something', () => {
    const people = Object.values(EVIDENCE_ROW_FIELDS)
      .flat()
      .filter((field) => field.kind === 'person');
    expect(people.length).toBeGreaterThan(0);
    // And every one of them names an account, which is what makes it resolvable.
    for (const field of people) expect(field.field, field.labelKey).toMatch(PERSON_ID);
  });

  it('renders no person identifier inside a monospaced token element', () => {
    const offenders: string[] = [];
    for (const { file, body } of p1_28ComponentSources()) {
      for (const inner of codeBodies(body)) {
        if (PERSON_ID.test(inner)) offenders.push(`${file}: ${inner.trim().slice(0, 60)}`);
      }
    }
    expect(offenders, 'a person identifier rendered where a name belongs').toEqual([]);
  });
});
