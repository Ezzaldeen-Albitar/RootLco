/**
 * The PENDING_FRONTEND_ADAPTER lifecycle, proved by making it fail.
 *
 * A gate that only ever runs against a repository it passes is indistinguishable
 * from a gate that returns zero. Each case below takes the CURRENT, passing world
 * and breaks exactly one thing, then asserts the gate goes red for that reason
 * and no other. The mutation is always a fixture — nothing on disk is touched —
 * because a proof that edits the repository to prove a point can lose the edit.
 *
 * The eleven negatives the Owner adjudication requires are cases 1-11; case 12 is
 * the forward-looking one, that removing an adapter after integration makes
 * reachability red again. Reachability itself is measured in
 * `apps/web/tests/p1-28-qa.test.ts`, which runs the adapters; the staleness half
 * of case 6/7 is asserted there, and case 12 here proves the shape of it.
 *
 * ## The entry under test moves as the lifecycle empties
 *
 * It was `rec.receiving-employee-list` / FE-007, and the FE-007 integration
 * DELETED that entry — which is the lifecycle working, and which took eleven
 * cases red with it because they mutated an entry that no longer existed. That
 * is the anti-vacuity case doing its job on this file rather than on the gate:
 * a suite pointed at a pending entry must fail loudly when the entry is wired,
 * not quietly test nothing. `OPERATION` and `TASK` below are the two knobs, and
 * they move to whichever entry is still pending until none is.
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

interface Entry {
  classification?: string | undefined;
  canonicalTask?: string | undefined;
  introducedAgainstBase?: string | undefined;
  blockedByOwnershipProfile?: string | undefined;
  frontendBranch?: string | undefined;
  reason?: string | undefined;
}

/**
 * The pending entry every mutation below is applied to.
 *
 * FE-018 owns it and is still PARTIAL, which cases 8 and 9 depend on: they
 * assert the gate refuses a PASS while the task still owes an adapter, and a
 * task that had already closed would make both vacuous.
 */
const OPERATION = 'rec.reception-signature-list';
const TASK = 'FE-018';

/** The real inputs, so a mutation is one edit away from the shipped truth. */
function world(): Record<string, unknown> {
  const register = json<{ operations: readonly { id: string }[] }>(
    'docs',
    'phase-1',
    'phase-1-24',
    'evidence',
    'operation-register.json'
  );
  const manifest = json<{ operations: Record<string, Entry> }>(
    'docs',
    'phase-1',
    'phase-1-28',
    'adapter-reachability.json'
  );
  const verdicts = json<Record<string, { FINAL_VERDICT?: string }>>(
    'docs',
    'phase-1',
    'phase-1-28',
    'task-matrix-verdicts.json'
  );
  const matrix = json<{ tasks: readonly Record<string, unknown>[] }>(
    'docs',
    'phase-1',
    'phase-1-28',
    'task-matrix.json'
  );
  const profiles = json<{ rules: readonly { profile: string }[] }>(
    '.github',
    'ci-baselines',
    'phase-ownership-profiles.json'
  );
  const allowedBuckets = allowedBucketsFromGate(
    readFileSync(repo('scripts', 'ci', 'check-phase-ownership.mjs'), 'utf8')
  );
  const mirrored = (register.operations ?? [])
    .filter((op) => /^(apt|rec)\./.test(op.id))
    .map((op) => op.id);

  return {
    register,
    manifest,
    verdicts,
    matrix,
    profiles,
    allowedBuckets,
    mirrored,
    // Deterministic stand-ins for the two repository questions the gate would
    // otherwise ask git. The proofs stay hermetic; the real answers are exercised
    // by the gate running for real in `verify:policies`.
    branchExists: (ref: string) => ref === 'feature/p1-28-owner-decisions-frontend',
    // Every DECLARED pending operation is new against the pinned base; anything
    // else is not, which is what case 2 relies on to refuse a re-labelled shipped
    // operation.
    introducedHere: (id: string) => Object.keys(manifest.operations).includes(id),
  };
}

/** The world with the pending entry mutated by one field. */
function withEntry(patch: Entry | null): Record<string, unknown> {
  const base = world();
  const manifest = structuredClone(base.manifest) as { operations: Record<string, Entry> };
  if (patch === null) delete manifest.operations[OPERATION];
  else manifest.operations[OPERATION] = { ...manifest.operations[OPERATION], ...patch };
  return { ...base, manifest };
}

const problemsOf = (injected: Record<string, unknown>): readonly string[] =>
  (run(injected) as { problems: readonly string[] }).problems;

describe('P1-28 adapter reachability — the gate passes on the shipped world', () => {
  it('is green right now, so every refusal below is the mutation and not the baseline', () => {
    expect(problemsOf(world())).toEqual([]);
  });

  it('really is judging something: the pending entry exists and is the one under test', () => {
    const manifest = world().manifest as { operations: Record<string, Entry> };
    expect(Object.keys(manifest.operations)).toContain(OPERATION);
    expect(manifest.operations[OPERATION]?.classification).toBe('PENDING_FRONTEND_ADAPTER');
    expect(CLASSIFICATIONS).toContain('PENDING_FRONTEND_ADAPTER');
  });
});

describe('P1-28 adapter reachability — the gate can be made to fail', () => {
  it('1. refuses a fake operation marked pending', () => {
    const base = world();
    const manifest = structuredClone(base.manifest) as { operations: Record<string, Entry> };
    manifest.operations['rec.not-a-real-operation'] = {
      ...manifest.operations[OPERATION],
      classification: 'PENDING_FRONTEND_ADAPTER',
    };
    expect(problemsOf({ ...base, manifest }).join('\n')).toMatch(/DECLARES_A_GHOST/);
  });

  it('2. refuses moving an already-shipped operation from reachable to pending', () => {
    const base = world();
    const manifest = structuredClone(base.manifest) as { operations: Record<string, Entry> };
    manifest.operations['rec.reception-create'] = {
      ...manifest.operations[OPERATION],
      classification: 'PENDING_FRONTEND_ADAPTER',
    };
    // `introducedHere` answers false for anything but the new read, which is
    // exactly the fact that makes this refusal correct rather than incidental.
    // The base is a pinned sha, so the refusal names the commit, not a branch.
    expect(problemsOf({ ...base, manifest }).join('\n')).toMatch(
      /already existed at `[0-9a-f]{40}`/
    );
  });

  it('3. refuses pending with no canonical Frontend task', () => {
    expect(problemsOf(withEntry({ canonicalTask: undefined })).join('\n')).toMatch(
      /names no canonical Frontend task/
    );
  });

  it('4. refuses pending that names a nonexistent task', () => {
    expect(problemsOf(withEntry({ canonicalTask: 'P1-28-FE-999' })).join('\n')).toMatch(
      /the matrix verdicts do not contain/
    );
  });

  it('5. refuses pending for an operation that is not mirrored', () => {
    const base = world();
    const mirrored = (base.mirrored as readonly string[]).filter((id) => id !== OPERATION);
    expect(problemsOf({ ...base, mirrored }).join('\n')).toMatch(/CONTRACT_MIRROR_MISSING/);
    // Authority A is absolute: the same mutation is refused for its own reason,
    // not merely as a consequence of the pending entry.
    expect(problemsOf({ ...base, mirrored }).join('\n')).toMatch(/not mirrored/);
  });

  it('6. refuses a pending entry whose adapter now exists — asserted where reach is measured', () => {
    /*
     * The staleness guard cannot live in this file: reachability is measured by
     * RUNNING the adapters against a mocked transport, which only the web suite
     * does. What is proved here is that the guard exists and is wired to this
     * manifest, so a pending entry cannot outlive its adapter unnoticed.
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
    const base = world();
    const verdicts = structuredClone(base.verdicts) as Record<string, { FINAL_VERDICT?: string }>;
    verdicts[TASK] = { ...(verdicts[TASK] ?? {}), FINAL_VERDICT: 'PASS' };
    expect(problemsOf({ ...base, verdicts }).join('\n')).toMatch(
      new RegExp(`canonical task P1-28-${TASK} is recorded PASS`)
    );
  });

  it('9. refuses a 35/35 claim while any pending adapter remains', () => {
    /*
     * There is no separate total to guard. `validate:p1-28-matrix` re-renders the
     * matrix from the canonical plan and the verdicts and compares bytes; it
     * validates no verdict semantics. So "35 PASS / 0 PARTIAL" can only be
     * claimed by writing PASS into every verdict — and case 8 refuses precisely
     * that for the one task that owes an adapter. Proved by doing it: flip every
     * task to PASS and the gate still refuses.
     */
    const base = world();
    const verdicts = structuredClone(base.verdicts) as Record<string, { FINAL_VERDICT?: string }>;
    for (const key of Object.keys(verdicts))
      verdicts[key] = { ...(verdicts[key] ?? {}), FINAL_VERDICT: 'PASS' };
    expect(problemsOf({ ...base, verdicts }).join('\n')).toMatch(
      new RegExp(`canonical task P1-28-${TASK} is recorded PASS`)
    );
    // And the shipped world really does still carry a PARTIAL, so the claim this
    // case refuses is a claim somebody could otherwise have made.
    const shipped = world().verdicts as Record<string, { FINAL_VERDICT?: string }>;
    expect(shipped[TASK]?.FINAL_VERDICT).toBe('PARTIAL');
  });

  it('10. refuses closure while pending remains, because closure needs the task closed', () => {
    /*
     * P1-28 has no lifecycle engine of its own — the only closure decision engine
     * in the tree is hard-wired to phase-1-27. So closure for this phase is
     * gated where it is actually expressed: a phase cannot be closed while a
     * canonical task is PARTIAL, and case 8 makes PARTIAL unavoidable while the
     * entry stands. Both halves are asserted rather than assumed.
     */
    const matrix = world().matrix as { tasks: readonly { FINAL_VERDICT?: string }[] };
    expect(matrix.tasks.some((task) => task.FINAL_VERDICT === 'PARTIAL')).toBe(true);
    expect(problemsOf(withEntry({}))).toEqual([]);
  });

  it('11. refuses pending whose ownership profile does not actually forbid web', () => {
    const permissive = problemsOf(withEntry({ blockedByOwnershipProfile: 'p1-27-frontend' })).join(
      '\n'
    );
    expect(permissive).toMatch(/does not block handwritten `web`/);
    const invented = problemsOf(withEntry({ blockedByOwnershipProfile: 'no-such-profile' })).join(
      '\n'
    );
    expect(invented).toMatch(/does not block handwritten `web`/);
  });

  it('12. refuses a Frontend branch this repository does not contain', () => {
    expect(problemsOf(withEntry({ frontendBranch: 'feature/never-created' })).join('\n')).toMatch(
      /which this repository does not contain/
    );
    expect(problemsOf(withEntry({ frontendBranch: undefined })).join('\n')).toMatch(
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
      expect(
        problemsOf(withEntry({ introducedAgainstBase: moving })).join('\n'),
        `${moving} must be refused as a base`
      ).toMatch(/not a full 40-character commit sha/);
    }
    // And the shipped entry really is pinned, so the guard above is not vacuous.
    const manifest = world().manifest as { operations: Record<string, Entry> };
    expect(manifest.operations[OPERATION]?.introducedAgainstBase).toMatch(/^[0-9a-f]{40}$/);
  });

  it('13. refuses an unknown base, rather than letting a missing one bless the entry', () => {
    const base = world();
    expect(
      problemsOf({ ...base, ...withEntry({}), introducedHere: () => null }).join('\n')
    ).toMatch(/UNKNOWN. Unknown is refused/);
  });

  it('14. refuses a placeholder justification, and an unrecognised state', () => {
    expect(problemsOf(withEntry({ reason: 'because' })).join('\n')).toMatch(
      /carries no real justification/
    );
    expect(problemsOf(withEntry({ classification: 'PENDING' })).join('\n')).toMatch(
      /UNKNOWN_CLASSIFICATION/
    );
  });

  it('15. refuses declaring REACHABLE here, which only QA-001 may derive', () => {
    expect(problemsOf(withEntry({ classification: 'REACHABLE' })).join('\n')).toMatch(
      /REDUNDANT_DECLARATION/
    );
  });

  it('16. keeps the two non-REACHABLE states mutually exclusive', () => {
    // DELIBERATELY_ABSENT means no canonical task binds it. This operation is now
    // bound by a canonical task, so the same entry re-labelled must be refused —
    // an unfinished operation could be parked as a decision.
    expect(problemsOf(withEntry({ classification: 'DELIBERATELY_ABSENT' })).join('\n')).toMatch(
      /DELIBERATELY_ABSENT_BUT_BOUND/
    );
  });

  it('17. is not vacuous: an empty register is a broken input, not a clean run', () => {
    expect(problemsOf({ ...world(), register: { operations: [] } }).join('\n')).toMatch(
      /ANTI_VACUITY/
    );
  });
});

describe('P1-28 adapter reachability — the helpers mean what the gate assumes', () => {
  it('binds the operation to its canonical task in the generated matrix, not merely in prose', () => {
    const matrix = world().matrix as Parameters<typeof boundByCanonicalTask>[0];
    expect(boundByCanonicalTask(matrix, OPERATION)).toBe(true);
    expect(boundByCanonicalTask(matrix, 'rec.not-a-real-operation')).toBe(false);
  });

  it('reads the ownership buckets out of the gate that enforces them', () => {
    const buckets = world().allowedBuckets as Record<string, readonly string[]>;
    expect(buckets['p1-18-read-surface']).toBeDefined();
    expect(buckets['p1-18-read-surface']).not.toContain('web');
    expect(buckets['p1-27-frontend']).toContain('web');
    const profiles = world().profiles as Parameters<typeof profileBlocksWeb>[0];
    expect(profileBlocksWeb(profiles, 'p1-18-read-surface', buckets).ok).toBe(true);
    expect(profileBlocksWeb(profiles, 'p1-27-frontend', buckets).ok).toBe(false);
  });
});
