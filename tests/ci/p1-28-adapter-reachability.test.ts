/**
 * The PENDING_FRONTEND_ADAPTER lifecycle, proved by making it fail.
 *
 * A gate that only ever runs against a repository it passes is indistinguishable
 * from a gate that returns zero. Each mutation below takes a world the gate
 * accepts, breaks exactly one thing, and asserts the gate goes red for that
 * reason AND NO OTHER — the NUMBER of refusals is pinned alongside the message,
 * because a mutation that trips a second condition proves neither of them
 * individually and a proof that only greps the joined output cannot tell the
 * difference. Case 5 is the one that pins two, and says why.
 *
 * ## Why the world under mutation is now SYNTHETIC
 *
 * These proofs used to mutate the live `adapter-reachability.json`, aimed at
 * whichever entry was still pending — `rec.receiving-employee-list` first, then
 * the signature read after FE-007 integrated. That worked only while the phase
 * still owed an adapter. The Owner decision resolved, reception capture shipped,
 * and the manifest emptied to `{}` — no published apt/rec operation is waiting on
 * a Frontend adapter any more. The mutations were left editing an entry that did
 * not exist, and the suite went red saying so — the anti-vacuity rule doing its
 * job on this file rather than on the gate.
 *
 * Deleting them was never available. They are the entire reason the lifecycle can
 * be trusted, and the Owner adjudication that created this gate requires them. So
 * the world is BUILT here instead: `fixture()` constructs a register, a mirror
 * list, a task matrix, a verdict set and a manifest carrying one LEGITIMATE
 * PENDING_FRONTEND_ADAPTER entry beside one DELIBERATELY_ABSENT one, and every
 * case drives the gate's `run(injected)` seam — the seam it exports for exactly
 * this — against it. The ownership profiles are the one input left real, because
 * condition 6 is a claim about this repository and a made-up profile could not
 * carry it. The gate itself is imported and never re-implemented, so the proofs
 * move with it; only the world they judge belongs to this file.
 *
 * The consequence, stated plainly rather than left to be discovered: these
 * refusals can no longer go vacuous when the lifecycle empties, because the entry
 * they break is one this file owns. What they can no longer say is anything about
 * the shipped tree — so the shipped tree is asserted first and separately, and
 * what it asserts is the requirement the empty manifest satisfies: ZERO pending
 * adapters.
 *
 * ## Every operation id below is fictional, deliberately
 *
 * `scripts/p1-24-operation-register.mjs` builds each operation's `tests` evidence
 * list by searching `tests/**` for its identifier, so a real id here would be
 * credited as coverage for an operation these proofs never exercise — this suite
 * judges the MANIFEST, not the operation. The previous revision named two real
 * reads and the register duly listed this file against both. The `apt.`/`rec.`
 * prefixes are kept because the gate filters on them; nothing else about the ids
 * is real. The live cases reach real ids only by deriving them from the
 * repository at run time, never as literals. `tests/ci/p1-28-write-reachability.test.ts`
 * states the same rule for the write half, and learned it the same way.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLASSIFICATIONS,
  allowedBucketsFromGate,
  boundByCanonicalTask,
  profileBlocksWeb,
  run,
} from '../../scripts/ci/check-p1-28-adapter-reachability.mjs';

const repo = (...parts: readonly string[]): string =>
  fileURLToPath(new URL(`../../${parts.join('/')}`, import.meta.url));

const json = <T>(...parts: readonly string[]): T =>
  JSON.parse(readFileSync(repo(...parts), 'utf8')) as T;

const MANIFEST_PATH = ['docs', 'phase-1', 'phase-1-28', 'adapter-reachability.json'] as const;
const REGISTER_PATH = [
  'docs',
  'phase-1',
  'phase-1-24',
  'evidence',
  'operation-register.json',
] as const;

interface Entry {
  classification?: string | undefined;
  canonicalTask?: string | undefined;
  introducedAgainstBase?: string | undefined;
  blockedByOwnershipProfile?: string | undefined;
  frontendBranch?: string | undefined;
  reason?: string | undefined;
}

interface Manifest {
  operations: Record<string, Entry>;
}

interface Matrix {
  tasks: { TASK_ID: string; FINAL_VERDICT: string; CANONICAL_BACKEND_OPERATIONS: string[] }[];
}

/**
 * Every input the gate's `run(injected)` seam accepts: six documents and the
 * three stand-ins for the questions it would otherwise put to git and to the
 * two web contract files. Naming them all is deliberate — an injected world
 * missing one of these keys is a world in which the gate quietly reads the
 * repository instead, and a proof that half-reads the real tree is the exact
 * failure this file was rewritten to escape.
 */
interface World {
  register: { operations: { id: string; method: string; route: string }[] };
  manifest: Manifest;
  verdicts: Record<string, { FINAL_VERDICT: string }>;
  matrix: Matrix;
  profiles: unknown;
  allowedBuckets: Record<string, readonly string[]>;
  mirrored: string[];
  branchExists: (ref: string) => boolean;
  introducedHere: (id: string, base: string) => boolean | null;
}

// ---------------------------------------------------------------------------
// The synthetic world
// ---------------------------------------------------------------------------

/** The read the fixture's Backend remediation introduces and cannot wire. */
const PENDING_OPERATION = 'rec.synthetic-pending-read';
/** A read that already existed at the base — case 2 turns it into a refusal. */
const SHIPPED_OPERATION = 'rec.synthetic-shipped-read';
/** A read no canonical task binds, so DELIBERATELY_ABSENT is the honest state. */
const ABSENT_OPERATION = 'apt.synthetic-absent-read';
/** Published nowhere. A state declared for it is a ghost. */
const GHOST_OPERATION = 'rec.synthetic-unpublished-read';

/** The task that owes the adapter. Still PARTIAL, which cases 8, 9 and 10 need. */
const PENDING_TASK = 'FE-901';
const PENDING_TASK_ID = `P1-28-${PENDING_TASK}`;
/** A task that has closed, and binds the already-shipped read. */
const SHIPPED_TASK = 'FE-902';

/**
 * The two profile names are REAL, and that is the point of them.
 *
 * Condition 6 is a claim about this repository — that a profile exists which
 * really forbids the handwritten `web` bucket, and that the entry names it. A
 * fixture profile could only ever prove that `profileBlocksWeb` reads its own
 * argument, so the fixture names profiles the repository really defines and the
 * helper cases at the foot of this file pin both directions of the fact.
 */
const BLOCKING_PROFILE = 'p1-18-read-surface';
const PERMISSIVE_PROFILE = 'p1-27-frontend';

/** The Frontend integration branch the fixture's `branchExists` says exists. */
const FRONTEND_BRANCH = 'feature/p1-28-owner-decisions-frontend';

/** The immutable commit the fixture's pending read is claimed to be new against. */
const PINNED_BASE = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
/** A second full sha, of a commit the fixture's stand-in checkout cannot read. */
const UNREADABLE_BASE = 'fedcba9876543210fedcba9876543210fedcba98';

/**
 * The register as it stood at `PINNED_BASE` — the whole of what the gate's real
 * `introducedHere` recovers from `git show <base>:…/operation-register.json`.
 *
 * The pending read is deliberately absent from it, which is what makes the
 * fixture's entry legitimate; the shipped read is present, which is what case 2
 * turns into a refusal.
 */
const REGISTER_AT_BASE: readonly string[] = [SHIPPED_OPERATION, ABSENT_OPERATION];

/**
 * Read once: the gate reads these two files and never writes them, and parsing
 * `check-phase-ownership.mjs` on each of two dozen cases would buy nothing.
 */
const PROFILES = json<{ rules: readonly { profile: string }[] }>(
  '.github',
  'ci-baselines',
  'phase-ownership-profiles.json'
);
const ALLOWED_BUCKETS = allowedBucketsFromGate(
  readFileSync(repo('scripts', 'ci', 'check-phase-ownership.mjs'), 'utf8')
) as Record<string, readonly string[]>;

/** A pending entry with all seven conditions satisfied — the fixture's baseline. */
function pendingEntry(): Entry {
  return {
    classification: 'PENDING_FRONTEND_ADAPTER',
    canonicalTask: PENDING_TASK_ID,
    introducedAgainstBase: PINNED_BASE,
    blockedByOwnershipProfile: BLOCKING_PROFILE,
    frontendBranch: FRONTEND_BRANCH,
    reason:
      'Introduced by a Backend remediation whose ownership profile forbids the handwritten ' +
      '`web` bucket, so the adapter and the screen that consumes it land together on the ' +
      'Frontend integration branch rather than riding inside a Backend change.',
  };
}

/**
 * A world the gate accepts, built rather than read.
 *
 * Faithful to the real inputs in the ways the gate can see: a register carrying
 * one row outside the `apt`/`rec` prefixes so `published` is a filtered subset
 * rather than the whole file, a matrix binding written with the same trailing
 * qualifier the generated matrix really uses (`… [kind complaint]`) so
 * `boundByCanonicalTask` has to split the id out here as it does there, and both
 * declarable non-REACHABLE states present so the baseline exercises each rather
 * than only the pending branch.
 */
function fixture(): World {
  return {
    register: {
      operations: [
        {
          id: PENDING_OPERATION,
          method: 'GET',
          route: '/api/v1/synthetic-receptions/{visitId}/pending-read',
        },
        {
          id: SHIPPED_OPERATION,
          method: 'GET',
          route: '/api/v1/synthetic-receptions/{visitId}/shipped-read',
        },
        {
          id: ABSENT_OPERATION,
          method: 'GET',
          route: '/api/v1/synthetic-appointments/{appointmentId}/absent-read',
        },
        { id: 'crm.synthetic-partner-read', method: 'GET', route: '/api/v1/synthetic-partners' },
      ],
    },
    manifest: {
      operations: {
        [PENDING_OPERATION]: pendingEntry(),
        [ABSENT_OPERATION]: {
          classification: 'DELIBERATELY_ABSENT',
          reason:
            'No canonical P1-28 task binds this read, and the decision that no screen will ' +
            'call it is recorded rather than left as a silence.',
        },
      },
    },
    verdicts: {
      [PENDING_TASK]: { FINAL_VERDICT: 'PARTIAL' },
      [SHIPPED_TASK]: { FINAL_VERDICT: 'PASS' },
    },
    matrix: {
      tasks: [
        {
          TASK_ID: PENDING_TASK,
          FINAL_VERDICT: 'PARTIAL',
          CANONICAL_BACKEND_OPERATIONS: [`${PENDING_OPERATION} [kind synthetic]`],
        },
        {
          TASK_ID: SHIPPED_TASK,
          FINAL_VERDICT: 'PASS',
          CANONICAL_BACKEND_OPERATIONS: [SHIPPED_OPERATION],
        },
      ],
    },
    profiles: PROFILES,
    allowedBuckets: ALLOWED_BUCKETS,
    // The mirror rows the gate would otherwise read out of the two web contract
    // files. Every published operation is mirrored, which is the state Authority
    // A demands; case 5 removes one.
    mirrored: [PENDING_OPERATION, SHIPPED_OPERATION, ABSENT_OPERATION],
    // Deterministic stand-ins for the two questions the gate would otherwise ask
    // git. The proofs stay hermetic and fast; the real answers are exercised by
    // the gate running for real in `verify:policies`, and by the live cases at
    // the head of this file.
    branchExists: (ref: string) => ref === FRONTEND_BRANCH,
    introducedHere: (id: string, base: string) =>
      base === PINNED_BASE ? !REGISTER_AT_BASE.includes(id) : null,
  };
}

/** The fixture with the pending entry changed by one field. */
function withEntry(patch: Entry): World {
  const world = fixture();
  world.manifest.operations[PENDING_OPERATION] = { ...pendingEntry(), ...patch };
  return world;
}

/** The fixture with one extra declaration alongside the legitimate pending entry. */
function withExtra(id: string, patch: Entry): World {
  const world = fixture();
  world.manifest.operations[id] = { ...pendingEntry(), ...patch };
  return world;
}

const problemsOf = (injected: World): readonly string[] =>
  (run(injected) as { problems: readonly string[] }).problems;

/**
 * Asserts the gate refused ONCE, for the named reason.
 *
 * The count carries as much of the proof as the message does. A mutation that
 * happens to trip a second condition proves neither, and the failure text of a
 * `.toMatch` over the joined output would look identical either way.
 */
function expectOnly(injected: World, pattern: RegExp, hint?: string): void {
  const problems = problemsOf(injected);
  expect(problems, hint ?? `expected exactly one refusal matching ${pattern.source}`).toHaveLength(
    1
  );
  expect(problems[0]).toMatch(pattern);
}

// ---------------------------------------------------------------------------
// The shipped tree
// ---------------------------------------------------------------------------

describe('P1-28 adapter reachability — the shipped tree, where the lifecycle is empty', () => {
  it('runs clean against the real repository, having judged the whole published surface', () => {
    /*
     * `run()` with nothing injected is the gate exactly as `verify:policies`
     * invokes it: the real register, the real manifest, the real matrix and
     * verdicts, the real profiles, and the mirror rows read out of the two web
     * contract files. It is the only case here that touches the repository's own
     * answers, and it is deliberately first — everything below judges a world
     * this file made up, and that is only worth reading once the real one is
     * known to be green.
     *
     * The surface is re-derived from the register rather than pinned to a
     * number: what matters is that the gate saw every published apt/rec
     * operation, not that there are currently seventy-one of them, and a Backend
     * branch that publishes the seventy-second must not have to edit this file.
     */
    const { problems, published } = run() as {
      problems: readonly string[];
      published: readonly { id: string }[];
    };
    const register = json<{ operations: readonly { id: string }[] }>(...REGISTER_PATH);
    const surface = register.operations.filter((op) => /^(apt|rec)\./.test(op.id));

    expect(problems).toEqual([]);
    expect(surface.length).toBeGreaterThan(0);
    expect(published.map((op) => op.id)).toEqual(surface.map((op) => op.id).sort());
  });

  it('declares ZERO pending adapters, which is the P1-28 zero-pending requirement', () => {
    /*
     * This is an assertion, not an observation. PENDING_FRONTEND_ADAPTER is a
     * transitional state and the phase cannot report itself complete while one
     * stands — that is what cases 8, 9 and 10 enforce at the place the claim is
     * actually made. The manifest reaching `{}` is therefore the requirement
     * being met rather than a gap: no published apt/rec read is waiting on a
     * Frontend adapter, so there is nothing owed in public.
     *
     * What it does NOT say, and what would be an easy thing to read into it, is
     * that every published operation is REACHABLE. That derivation belongs to
     * `apps/web/tests/p1-28-qa.test.ts`, which measures reach by running the
     * adapters, and it holds its own records for the administration surface and
     * for the reads this phase consumes with nothing. An empty file here means
     * one thing exactly: no adapter is owed.
     *
     * The second expectation is the stronger one and is a COUNT: the manifest
     * declares nothing at all today, DELIBERATELY_ABSENT included. A recorded
     * decision that some future read will never be called is legitimate and
     * would move that number — deliberately, in the change that records it.
     */
    const manifest = json<Manifest>(...MANIFEST_PATH);
    const pending = Object.entries(manifest.operations)
      .filter(([, entry]) => entry.classification === 'PENDING_FRONTEND_ADAPTER')
      .map(([id]) => id);

    expect(pending).toEqual([]);
    expect(Object.keys(manifest.operations)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The fixture, before anything is broken
// ---------------------------------------------------------------------------

describe('P1-28 adapter reachability — the fixture is a world the gate accepts', () => {
  it('is green unmutated, so every refusal below is the mutation and not the baseline', () => {
    expect(problemsOf(fixture())).toEqual([]);
  });

  it('really is judging something: the pending entry exists and is the one under test', () => {
    /*
     * The case the empty manifest took down, rebuilt against the entry this file
     * owns. It is not ceremony: every `withEntry` mutation below edits
     * `manifest.operations[PENDING_OPERATION]`, and each would pass for the
     * wrong reason if that key were absent — an entry that is not there cannot
     * be broken, and `withEntry` would silently be creating one instead of
     * changing one, which is precisely how the live-manifest version of this
     * suite went from proving the lifecycle to proving nothing.
     */
    const { operations } = fixture().manifest;
    expect(Object.keys(operations)).toContain(PENDING_OPERATION);
    expect(operations[PENDING_OPERATION]?.classification).toBe('PENDING_FRONTEND_ADAPTER');
    expect(CLASSIFICATIONS).toContain('PENDING_FRONTEND_ADAPTER');
    // And the second declarable state is exercised too, so the baseline is not
    // green merely because it never reached the DELIBERATELY_ABSENT branch.
    expect(operations[ABSENT_OPERATION]?.classification).toBe('DELIBERATELY_ABSENT');
  });
});

describe('P1-28 adapter reachability — the gate can be made to fail', () => {
  it('1. refuses a fake operation marked pending', () => {
    expectOnly(withExtra(GHOST_OPERATION, {}), /DECLARES_A_GHOST/);
  });

  it('2. refuses moving an already-shipped operation from reachable to pending', () => {
    /*
     * `introducedHere` answers from the register as it stood at the pinned base,
     * where this read already existed — which is exactly the fact that makes the
     * refusal correct rather than incidental. The base is a pinned sha, so the
     * refusal names the commit and not a branch.
     */
    expectOnly(withExtra(SHIPPED_OPERATION, {}), /already existed at `[0-9a-f]{40}`/);
  });

  it('3. refuses pending with no canonical Frontend task', () => {
    expectOnly(withEntry({ canonicalTask: undefined }), /names no canonical Frontend task/);
  });

  it('4. refuses pending that names a nonexistent task', () => {
    expectOnly(withEntry({ canonicalTask: 'P1-28-FE-999' }), /the matrix verdicts do not contain/);
  });

  it('5. refuses pending for an operation that is not mirrored', () => {
    const world = fixture();
    world.mirrored = world.mirrored.filter((id) => id !== PENDING_OPERATION);
    const problems = problemsOf(world);

    // Two authorities refuse the same mutation, which is why the count is two
    // rather than one. Authority A is absolute — publication and mirroring
    // travel together and there is no pending state for it — so deleting the
    // entry would not make the mirror row optional; condition 2 then refuses the
    // same fact again, on the entry's own account.
    expect(problems).toHaveLength(2);
    expect(problems.join('\n')).toMatch(/CONTRACT_MIRROR_MISSING/);
    expect(problems.join('\n')).toMatch(/not mirrored/);
  });

  it('6. refuses a pending entry whose adapter now exists — asserted where reach is measured', () => {
    /*
     * The staleness guard cannot live in this file: reachability is measured by
     * RUNNING the adapters against a mocked transport, which only the web suite
     * does. There is no pending entry in the shipped tree for it to catch today,
     * and that is the lifecycle having completed rather than the guard having
     * gone away — so what is pinned here is that it is still WIRED TO THIS
     * MANIFEST, which is what makes the next entry fail-closed the moment its
     * adapter lands.
     */
    const suite = readFileSync(repo('apps', 'web', 'tests', 'p1-28-qa.test.ts'), 'utf8');
    expect(suite).toContain('adapter-reachability.json');
    expect(suite).toContain('PENDING_ADAPTERS');
    expect(suite).toMatch(/reachedPending/);
    expect(suite).toMatch(/still declared PENDING_FRONTEND_ADAPTER/);
  });

  it('7. refuses a pending entry whose production consumer now exists', () => {
    /*
     * Same authority, one link further along the chain. QA-001 counts an
     * operation reached only when a real adapter body issued the request, so a
     * consumer that drives the adapter makes it reached and trips case 6's
     * assertion. The chain published -> adapter -> consumer is therefore closed
     * by the same guard; what this case pins is that `reached` is derived from
     * an actual request and not from a table.
     */
    const suite = readFileSync(repo('apps', 'web', 'tests', 'p1-28-qa.test.ts'), 'utf8');
    expect(suite).toMatch(/resolveOperation\(method, path\)/);
    expect(suite).toMatch(/reached\.add\(operation\.operationId\)/);
  });

  it('8. refuses the owning task being marked PASS while its operation is pending', () => {
    const world = fixture();
    world.verdicts[PENDING_TASK] = { FINAL_VERDICT: 'PASS' };
    expectOnly(world, new RegExp(`canonical task ${PENDING_TASK_ID} is recorded PASS`));
  });

  it('9. refuses a 35/35 claim while any pending adapter remains', () => {
    /*
     * There is no separate total to guard. `validate:p1-28-matrix` re-renders the
     * matrix from the canonical plan and the verdicts and compares bytes; it
     * validates no verdict semantics. So a full pass can only be claimed by
     * writing PASS into every verdict — and case 8 refuses precisely that for
     * the task that owes an adapter. Proved by doing it: flip EVERY task in the
     * fixture to PASS and the gate still refuses, once, for the owing task.
     *
     * The thirty-five is the live number and stays pinned to the live files, so
     * the claim this case refuses is a claim somebody could really make about
     * this phase rather than about the fixture's two tasks.
     */
    const world = fixture();
    expect(world.verdicts[PENDING_TASK]?.FINAL_VERDICT).toBe('PARTIAL');
    for (const key of Object.keys(world.verdicts)) world.verdicts[key] = { FINAL_VERDICT: 'PASS' };
    expectOnly(world, new RegExp(`canonical task ${PENDING_TASK_ID} is recorded PASS`));

    const liveVerdicts = json<Record<string, { FINAL_VERDICT?: string }>>(
      'docs',
      'phase-1',
      'phase-1-28',
      'task-matrix-verdicts.json'
    );
    const liveMatrix = json<Matrix>('docs', 'phase-1', 'phase-1-28', 'task-matrix.json');
    expect(Object.keys(liveVerdicts)).toHaveLength(35);
    expect(liveMatrix.tasks).toHaveLength(35);
  });

  it('10. refuses closure while pending remains, because closure needs the task closed', () => {
    /*
     * P1-28 has no lifecycle engine of its own — the only closure decision engine
     * in the tree is hard-wired to phase-1-27. So closure for this phase is
     * gated where it is actually expressed: a phase cannot be closed while a
     * canonical task is PARTIAL, and case 8 makes PARTIAL unavoidable while the
     * entry stands. Both halves are asserted rather than assumed — the owing
     * task really is PARTIAL in a world the gate accepts, and the entry that
     * keeps it there really is accepted.
     */
    const world = fixture();
    expect(world.matrix.tasks.some((task) => task.FINAL_VERDICT === 'PARTIAL')).toBe(true);
    expect(world.verdicts[PENDING_TASK]?.FINAL_VERDICT).toBe('PARTIAL');
    expect(problemsOf(world)).toEqual([]);
  });

  it('11. refuses pending whose ownership profile does not actually forbid web', () => {
    // A real profile that really allows `web`: nothing prevented the adapter.
    expectOnly(
      withEntry({ blockedByOwnershipProfile: PERMISSIVE_PROFILE }),
      /does not block handwritten `web`/
    );
    // And a name nobody has heard of, refused rather than assumed restrictive.
    expectOnly(
      withEntry({ blockedByOwnershipProfile: 'no-such-profile' }),
      /does not block handwritten `web`/
    );
    expectOnly(withEntry({ blockedByOwnershipProfile: undefined }), /names no ownership profile/);
  });

  it('12. refuses a Frontend branch this repository does not contain', () => {
    expectOnly(
      withEntry({ frontendBranch: 'feature/never-created' }),
      /which this repository does not contain/
    );
    expectOnly(
      withEntry({ frontendBranch: undefined }),
      /identifies no Frontend integration branch/
    );
  });

  it('13a. refuses a MOVING base, which answers differently after the merge', () => {
    /*
     * The defect this case exists for actually happened. The entry named
     * `origin/develop`: true on the pull request, and FALSE the moment the merge
     * landed, because develop then contained the operation. The gate refused its
     * own entry on protected develop and took the reproof down with it.
     *
     * So the SHAPE is refused, not the one instance — a full sha is the only kind
     * of base whose answer cannot drift out from under the claim.
     */
    for (const moving of ['origin/develop', 'develop', 'HEAD~1', '592cfe6e']) {
      expectOnly(
        withEntry({ introducedAgainstBase: moving }),
        /not a full 40-character commit sha/,
        `${moving} must be refused as a base`
      );
    }
    expectOnly(withEntry({ introducedAgainstBase: undefined }), /names no `introducedAgainstBase`/);
    // And the fixture's own base really is pinned, so the guard is not vacuous.
    expect(pendingEntry().introducedAgainstBase).toMatch(/^[0-9a-f]{40}$/);
  });

  it('13. refuses an unknown base, rather than letting a missing one bless the entry', () => {
    /*
     * A well-formed sha that this checkout cannot resolve: the fixture's
     * `introducedHere` answers `null` for any base but the pinned one, exactly as
     * the real implementation answers `null` when `git show <base>:register`
     * throws. Unknown must be refused, because a base nobody can read would
     * otherwise bless every entry that named one.
     */
    expectOnly(
      withEntry({ introducedAgainstBase: UNREADABLE_BASE }),
      /UNKNOWN. Unknown is refused/
    );
  });

  it('14. refuses a placeholder justification, and an unrecognised state', () => {
    expectOnly(withEntry({ reason: 'because' }), /carries no real justification/);
    expectOnly(withEntry({ reason: undefined }), /carries no real justification/);
    expectOnly(withEntry({ classification: 'PENDING' }), /UNKNOWN_CLASSIFICATION/);
  });

  it('15. refuses declaring REACHABLE here, which only QA-001 may derive', () => {
    expectOnly(withEntry({ classification: 'REACHABLE' }), /REDUNDANT_DECLARATION/);
  });

  it('16. keeps the two non-REACHABLE states mutually exclusive', () => {
    // DELIBERATELY_ABSENT means no canonical task binds it, and the pending
    // operation IS bound by one — so the same entry re-labelled must be refused,
    // or an unfinished operation could be parked as a recorded decision.
    expectOnly(
      withEntry({ classification: 'DELIBERATELY_ABSENT' }),
      /DELIBERATELY_ABSENT_BUT_BOUND/
    );
  });

  it('17. is not vacuous: an empty register is a broken input, not a clean run', () => {
    const world = fixture();
    world.register = { operations: [] };
    expectOnly(world, /ANTI_VACUITY/);
  });
});

describe('P1-28 adapter reachability — the helpers mean what the gate assumes', () => {
  it('binds an operation to its canonical task in the GENERATED matrix, not merely in prose', () => {
    /*
     * The fixture's matrix is two rows this file wrote, so on its own it proves
     * only that `boundByCanonicalTask` reads its argument. The real matrix is
     * generated, carries trailing qualifiers on some of its bindings
     * (`rec.… [kind complaint]`) and is where the gate actually asks the
     * question — so both a plain and a qualified binding are derived from it at
     * run time rather than named as literals, which would credit this suite with
     * coverage of real operations it never exercises. The presence of at least
     * one of each is asserted, so neither half can quietly stop being tested.
     */
    const live = json<Matrix>('docs', 'phase-1', 'phase-1-28', 'task-matrix.json');
    const bindings = live.tasks.flatMap((task) => task.CANONICAL_BACKEND_OPERATIONS ?? []);
    const qualified = bindings.filter((binding) => /[\s(,]/.test(binding));
    expect(bindings.length).toBeGreaterThan(0);
    expect(qualified.length).toBeGreaterThan(0);
    for (const binding of [bindings[0], qualified[0]]) {
      const id = String(binding)
        .split(/[\s(,]/)[0]
        ?.replace(/[(),]/g, '');
      expect(boundByCanonicalTask(live as Parameters<typeof boundByCanonicalTask>[0], id)).toBe(
        true
      );
    }
    expect(
      boundByCanonicalTask(live as Parameters<typeof boundByCanonicalTask>[0], GHOST_OPERATION)
    ).toBe(false);

    // The fixture asks the same question of the same helper, qualifier included.
    const world = fixture();
    const matrix = world.matrix as Parameters<typeof boundByCanonicalTask>[0];
    expect(boundByCanonicalTask(matrix, PENDING_OPERATION)).toBe(true);
    expect(boundByCanonicalTask(matrix, ABSENT_OPERATION)).toBe(false);
  });

  it('reads the ownership buckets out of the gate that enforces them', () => {
    // The two profiles the fixture names, checked against the two files that
    // define them — this is what stops case 11 from being a claim about nothing.
    expect(ALLOWED_BUCKETS[BLOCKING_PROFILE]).toBeDefined();
    expect(ALLOWED_BUCKETS[BLOCKING_PROFILE]).not.toContain('web');
    expect(ALLOWED_BUCKETS[PERMISSIVE_PROFILE]).toContain('web');
    const profiles = PROFILES as Parameters<typeof profileBlocksWeb>[0];
    expect(profileBlocksWeb(profiles, BLOCKING_PROFILE, ALLOWED_BUCKETS).ok).toBe(true);
    expect(profileBlocksWeb(profiles, PERMISSIVE_PROFILE, ALLOWED_BUCKETS).ok).toBe(false);
    expect(profileBlocksWeb(profiles, 'no-such-profile', ALLOWED_BUCKETS).ok).toBe(false);
  });
});
