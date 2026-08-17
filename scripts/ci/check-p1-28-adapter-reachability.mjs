#!/usr/bin/env node
/**
 * P1-28 adapter reachability — the PENDING_FRONTEND_ADAPTER lifecycle.
 *
 * ## Two authorities, kept apart on purpose
 *
 * **Authority A — CONTRACT PUBLICATION.** Every published `apt.*`/`rec.*`
 * operation must have its exact row in the web contract mirror. There is NO
 * pending state here and no exception list: a Backend branch that publishes a
 * read publishes its mirror row in the SAME change, or this gate is red. The
 * authority is absolute because a mirror row states what the backend offers, and
 * the backend already offers it.
 *
 * **Authority B — PRODUCT REACHABILITY.** An operation is reachable only when the
 * whole chain exists:
 *
 *     published operation -> production adapter -> production consumer
 *
 * A published operation with no adapter is a capability no screen can invoke. An
 * adapter with no production consumer is worse: it looks wired and is not, which
 * is how three adapters shipped in this phase with a definition line and nothing
 * else while the sweep stayed green, because the TEST corpus called them. A drive
 * is not a consumer.
 *
 * ## Where each authority is enforced, and why it is split
 *
 * Authority B's *derivation* is not here. It lives in
 * `apps/web/tests/p1-28-qa.test.ts`, which is the only place that can honestly
 * compute it: it mocks the transport, invokes every real adapter body, and reads
 * back the path that was actually requested, resolving it through
 * `resolveOperation`. Reachability is therefore measured by RUNNING the adapters,
 * never by scanning source for path strings.
 *
 * That distinction is load-bearing. A first draft of this gate did scan for path
 * literals and reported fifteen of twenty-three GETs unreachable — including
 * `rec.reception-detail`, which a real screen consumes — because adapters build
 * sub-resource paths by concatenation (`visitPath(id, '/party-roles')`). Had it
 * shipped, every one of those would have needed a PENDING entry, and each entry
 * would have been false. A gate that manufactures the debt it exists to police is
 * worse than no gate.
 *
 * So: QA-001 derives which of the three states each operation is in. THIS file
 * enforces that a claimed PENDING_FRONTEND_ADAPTER is legitimate, which is a
 * question about the registry, the mirror, the matrix, the verdicts, the
 * ownership profiles and the branch list — all of which it can read exactly.
 *
 * ## The three states
 *
 *   REACHABLE                  adapter and production consumer both exist
 *   PENDING_FRONTEND_ADAPTER   transitional debt, fail-closed (below)
 *   DELIBERATELY_ABSENT        a recorded decision that no screen will call it
 *
 * The easy way to make a Backend branch green would have been to weaken QA-001 to
 * "only inspect operations that already have an adapter". That is refused: it
 * creates a permanent blind spot in which a published operation stays unreachable
 * forever and no gate ever says so. Being unreachable must be a DECLARED AND
 * JUSTIFIED STATE, never a silence.
 *
 * ## PENDING_FRONTEND_ADAPTER is fail-closed
 *
 * The state exists because ownership is split deliberately. A Backend remediation
 * runs under a profile that forbids handwritten `web`, so it MUST publish the
 * operation and its mirror row and CANNOT write the adapter that the mirror row
 * then obliges. Widening the profile would let Frontend ride inside a Backend
 * change, reviewed by nobody. So the transition is named instead.
 *
 * An entry is legal only when ALL SEVEN hold — any one missing is an error, and
 * the entry is refused rather than downgraded to a warning:
 *
 *   1. the operation exists in the published registry
 *   2. the operation is mirrored in the web contract
 *   3. the operation was introduced by the current Backend remediation
 *   4. a canonical Frontend task is named, and really binds this operation
 *   5. that canonical task is still open — its FINAL_VERDICT is not PASS
 *   6. the ownership profile that blocks the adapter is named, exists, and
 *      really does forbid the handwritten `web` bucket
 *   7. the exact Frontend integration branch is identified and really exists
 *
 * Plus two that keep it TRANSITIONAL rather than permanent, enforced by QA-001
 * where reachability is measured: the adapter must not already exist, and the
 * consumer must not already exist. The moment the Frontend branch supplies
 * either, the entry is stale and the suite is red until it is deleted.
 *
 * DELIBERATELY_ABSENT is the opposite case with the opposite rule: NO canonical
 * task may bind it. PENDING requires that one DOES and is still open. The two can
 * never apply to the same operation, which is asserted rather than assumed.
 *
 * ## Why condition 5 is also the 35/35 block
 *
 * `validate:p1-28-matrix` is a byte-identity check: it re-renders the matrix from
 * `canonical-plan.md` plus `task-matrix-verdicts.json` and compares. It validates
 * no verdict semantics at all. So the only way to claim "35 PASS / 0 PARTIAL" is
 * to write PASS into the verdicts file — and condition 5 refuses exactly that
 * while the task still owes an adapter. The phase cannot report itself complete
 * while any pending remains, and that is enforced at the one place the claim is
 * actually made rather than at a total nobody computes.
 *
 * Exit codes: 0 clean · 1 violations · 2 IO error.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { REPOSITORY_ROOT } from '../lib/repository-paths.mjs';

const ROOT = REPOSITORY_ROOT;
const REGISTER = join(ROOT, 'docs', 'phase-1', 'phase-1-24', 'evidence', 'operation-register.json');
const MANIFEST = join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'adapter-reachability.json');
const VERDICTS = join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'task-matrix-verdicts.json');
const MATRIX = join(ROOT, 'docs', 'phase-1', 'phase-1-28', 'task-matrix.json');
const PROFILES = join(ROOT, '.github', 'ci-baselines', 'phase-ownership-profiles.json');
const WEB_SRC = join(ROOT, 'apps', 'web', 'src');

export const CLASSIFICATIONS = Object.freeze([
  'REACHABLE',
  'PENDING_FRONTEND_ADAPTER',
  'DELIBERATELY_ABSENT',
]);

/** The two web contract mirrors that Authority A checks against. */
export const MIRROR_FILES = Object.freeze([
  join('features', 'receptions', 'receptions-contract.ts'),
  join('features', 'appointments', 'appointments-contract.ts'),
]);

function fail(message) {
  console.error(`::error::${message}`);
  process.exit(2);
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`Cannot read ${what} (${relative(ROOT, path).split(sep).join('/')}): ${error.message}`);
  }
}

/** Does any canonical task bind this operation? Qualifiers after the id are dropped. */
export function boundByCanonicalTask(matrix, id) {
  for (const task of matrix.tasks ?? []) {
    for (const binding of task.CANONICAL_BACKEND_OPERATIONS ?? []) {
      if (
        String(binding)
          .split(/[\s(,]/)[0]
          .replace(/[(),]/g, '') === id
      )
        return true;
    }
  }
  return false;
}

/**
 * The profile must EXIST and must not allow `web`.
 *
 * A name nobody has heard of is refused rather than assumed restrictive: the
 * claim "ownership stopped me" is only meaningful when the thing that stopped you
 * is real and really stops you.
 */
export function profileBlocksWeb(profiles, name, allowedBuckets) {
  const known = (profiles.rules ?? []).some((rule) => rule.profile === name);
  if (!known) return { ok: false, why: `no rule in phase-ownership-profiles.json names it` };
  const allowed = allowedBuckets?.[name];
  if (!allowed) return { ok: false, why: `check-phase-ownership.mjs defines no such profile` };
  if (allowed.includes('web'))
    return { ok: false, why: `it ALLOWS the handwritten \`web\` bucket` };
  return { ok: true, why: '' };
}

/** The `allowed` bucket list of every profile, read from the gate that owns them. */
export function allowedBucketsFromGate(source) {
  const buckets = {};
  const pattern = /'([a-z0-9-]+)':\s*\{[\s\S]*?allowed:\s*\[([\s\S]*?)\]/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    buckets[match[1]] = [...match[2].matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]);
  }
  return buckets;
}

export function run(injected = {}) {
  const problems = [];
  const problem = (message) => problems.push(message);

  const register = injected.register ?? readJson(REGISTER, 'the operation register');
  const manifest = injected.manifest ?? readJson(MANIFEST, 'the adapter-reachability manifest');
  const verdicts = injected.verdicts ?? readJson(VERDICTS, 'the task-matrix verdicts');
  const matrix = injected.matrix ?? readJson(MATRIX, 'the task matrix');
  const profiles = injected.profiles ?? readJson(PROFILES, 'the phase-ownership profiles');
  const allowedBuckets =
    injected.allowedBuckets ??
    allowedBucketsFromGate(
      readFileSync(join(ROOT, 'scripts', 'ci', 'check-phase-ownership.mjs'), 'utf8')
    );

  const branchExists =
    injected.branchExists ??
    ((ref) => {
      for (const candidate of [ref, `origin/${ref}`, `refs/heads/${ref}`]) {
        try {
          execFileSync('git', ['-C', ROOT, 'rev-parse', '--verify', '--quiet', candidate], {
            stdio: 'pipe',
          });
          return true;
        } catch {
          /* try the next spelling */
        }
      }
      return false;
    });

  /**
   * Was the operation absent from the register at the base this branch targets?
   * `null` means UNKNOWN — a base this checkout cannot read must never be able to
   * bless an entry, so unknown is refused rather than treated as "yes".
   */
  const introducedHere =
    injected.introducedHere ??
    ((id, base) => {
      try {
        const previous = JSON.parse(
          execFileSync(
            'git',
            [
              '-C',
              ROOT,
              'show',
              `${base}:docs/phase-1/phase-1-24/evidence/operation-register.json`,
            ],
            { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
          )
        );
        return !(previous.operations ?? []).some((op) => op.id === id);
      } catch {
        return null;
      }
    });

  const published = (register.operations ?? [])
    .filter((op) => /^(apt|rec)\./.test(op.id))
    .sort((a, b) => a.id.localeCompare(b.id));

  if (published.length === 0) {
    problem(
      'ANTI_VACUITY: the register publishes no apt/rec operation at all, so every judgement ' +
        'below would be vacuously true. That is a broken input, not a clean run.'
    );
    return { problems, states: new Map(), published: [] };
  }

  // --- Authority A: contract publication, exact and without exception ----------

  const mirrored = new Set(
    injected.mirrored ??
      MIRROR_FILES.flatMap((relativePath) => {
        const file = join(WEB_SRC, relativePath);
        if (!existsSync(file)) return [];
        const source = readFileSync(file, 'utf8');
        return [...source.matchAll(/^\s*operationId:\s*'([^']+)'/gm)].map((m) => m[1]);
      })
  );

  for (const op of published) {
    if (!mirrored.has(op.id)) {
      problem(
        `CONTRACT_MIRROR_MISSING: ${op.id} is published and has no web contract mirror row. ` +
          'Publication and mirroring travel together — there is no pending state for this.'
      );
    }
  }

  // --- Authority B: the legitimacy of every declared non-REACHABLE state -------

  const declared = manifest.operations ?? {};
  const states = new Map();

  for (const [id, entry] of Object.entries(declared)) {
    const classification = entry?.classification;

    if (!CLASSIFICATIONS.includes(classification)) {
      problem(
        `UNKNOWN_CLASSIFICATION: ${id} is declared \`${classification}\`, which is not one of ` +
          `${CLASSIFICATIONS.join(', ')}. An unrecognised state is not a softer state.`
      );
      continue;
    }
    states.set(id, classification);

    // (1) published — a state for an operation that does not exist proves nothing
    // and pads the list.
    const operation = published.find((op) => op.id === id);
    if (!operation) {
      problem(
        `DECLARES_A_GHOST: ${id} is classified \`${classification}\` and is not a published ` +
          'apt/rec operation.'
      );
      continue;
    }

    if (classification === 'REACHABLE') {
      problem(
        `REDUNDANT_DECLARATION: ${id} is declared REACHABLE. REACHABLE is DERIVED by QA-001 from ` +
          'running the adapters, never asserted here — declaring it would let this file vouch ' +
          'for a chain it cannot see.'
      );
      continue;
    }

    if (classification === 'DELIBERATELY_ABSENT') {
      if (boundByCanonicalTask(matrix, id)) {
        problem(
          `DELIBERATELY_ABSENT_BUT_BOUND: ${id} is bound by a canonical task, so it is not ` +
            'deliberately absent — it is unfinished, which is a different state with a ' +
            'different justification.'
        );
      }
      continue;
    }

    // --- PENDING_FRONTEND_ADAPTER -------------------------------------------

    const where = `PENDING_FRONTEND_ADAPTER ${id}`;

    // (2) mirrored
    if (!mirrored.has(id)) {
      problem(`${where}: the operation is not mirrored. Mirror it in the same change.`);
    }

    // (3) introduced by THIS Backend remediation
    const base = entry.introducedAgainstBase;
    if (typeof base !== 'string' || base.length === 0) {
      problem(`${where}: names no \`introducedAgainstBase\`, so "new here" cannot be checked.`);
    } else {
      const isNew = introducedHere(id, base);
      if (isNew === null) {
        problem(
          `${where}: the register at \`${base}\` cannot be read, so whether this operation is new ` +
            'here is UNKNOWN. Unknown is refused — a missing base must not bless an entry.'
        );
      } else if (isNew === false) {
        problem(
          `${where}: the operation already existed at \`${base}\`. This state is for a read the ` +
            'current Backend remediation INTRODUCES, never a way to retire an existing one.'
        );
      }
    }

    // (4) a canonical Frontend task, named and really binding this operation
    const task = entry.canonicalTask;
    if (typeof task !== 'string' || !/^P1-28-[A-Z]+-\d+$/.test(task)) {
      problem(`${where}: names no canonical Frontend task in the \`P1-28-XX-000\` form.`);
    } else {
      const short = task.replace(/^P1-28-/, '');
      if (!Object.prototype.hasOwnProperty.call(verdicts, short)) {
        problem(
          `${where}: names canonical task ${task}, which the matrix verdicts do not contain. A ` +
            'pending adapter owed by a task that does not exist is owed by nobody.'
        );
      } else if (verdicts[short]?.FINAL_VERDICT === 'PASS') {
        // (5) still open — and the 35/35 block, see the docblock.
        problem(
          `${where}: its canonical task ${task} is recorded PASS. A task cannot be complete while ` +
            'the operation it owns is still waiting for the adapter that would complete it.'
        );
      }
      if (!boundByCanonicalTask(matrix, id)) {
        problem(
          `${where}: no canonical task binds ${id} in the task matrix. A pending adapter must be ` +
            'owed by somebody; an unowed one is DELIBERATELY_ABSENT or a mistake.'
        );
      }
    }

    // (6) ownership really blocks the adapter here
    const profile = entry.blockedByOwnershipProfile;
    if (typeof profile !== 'string' || profile.length === 0) {
      problem(`${where}: names no ownership profile, so "I was not allowed to" is unchecked.`);
    } else {
      const verdict = profileBlocksWeb(profiles, profile, allowedBuckets);
      if (!verdict.ok) {
        problem(
          `${where}: ownership profile \`${profile}\` does not block handwritten \`web\` — ` +
            `${verdict.why}. Nothing prevented the adapter from being written on this branch.`
        );
      }
    }

    // (7) the Frontend integration branch is identified and exists
    const branch = entry.frontendBranch;
    if (typeof branch !== 'string' || branch.length === 0) {
      problem(`${where}: identifies no Frontend integration branch.`);
    } else if (!branchExists(branch)) {
      problem(
        `${where}: names Frontend branch \`${branch}\`, which this repository does not contain.`
      );
    }

    if (typeof entry.reason !== 'string' || entry.reason.trim().length < 40) {
      problem(`${where}: carries no real justification. A placeholder string is not a reason.`);
    }
  }

  return { problems, states, published };
}

function main() {
  const { problems, states, published } = run();
  const tally = {};
  for (const state of states.values()) tally[state] = (tally[state] ?? 0) + 1;
  for (const message of problems) console.error(`::error::${message}`);
  console.log(
    `P1-28 adapter reachability: ${published.length} published apt/rec operation(s); ` +
      `${states.size} declared — ` +
      (Object.keys(tally).length === 0
        ? 'none'
        : Object.entries(tally)
            .sort()
            .map(([k, v]) => `${k}=${v}`)
            .join(' · '))
  );
  console.log(`  ${problems.length} problem(s).`);
  return problems.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
export { main };
