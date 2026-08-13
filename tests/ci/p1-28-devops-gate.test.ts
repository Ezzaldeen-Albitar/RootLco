import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGGREGATE,
  REGISTER,
  edgesOf,
  key,
  readScripts,
  readWorkflowInvocations,
  reachableFrom,
} from '../../scripts/ci/check-command-coverage.mjs';
import { DECLARED_JOBS } from '../../scripts/ci/evaluate-ci-gate.mjs';
import {
  ADOPTED_ROOTS,
  MODULE_DISPOSITION,
  PLAN_ROOTS,
  SCAN_ROOTS,
} from '../../scripts/ci/check-p1-27-frontend.mjs';

/**
 * `P1-28-DO-001` — the phase's gates are invoked by a job that runs and is
 * required, and the metadata they depend on moves with them.
 *
 * ## The two failures this exists to make impossible
 *
 * 1. **A gate invoked by no CI job.** `validate:phase-ownership` was correct,
 *    tested, and run by nothing; the command register recorded that in a PROSE
 *    comment, so two documents agreed a rule was unenforced and called it a
 *    finding (`P1-27-DO-003`).
 * 2. **A gate whose failure CI was structurally unable to see.** `web-quality`
 *    ran `format:check:web` before the step that wrote the evidence artefact,
 *    so a red gate produced a job the summariser could not report on.
 *
 * The two P1-28 gates — `validate:p1-28-matrix` and
 * `validate:p1-28-write-reachability` — were reachable ONLY through
 * `verify:workspaces`, which one job runs. That satisfied
 * `check-command-coverage.mjs` and is genuinely enforcement, but it is not the
 * shape P1-27's gates have: `validate:p1-27-frontend` and
 * `validate:p1-27-reachability` are named by a fast always-required job as
 * well. The trace below is asserted end to end rather than described, and it
 * ends at the required-check list rather than at "a workflow mentions it".
 *
 * ## What "required" means here, and where it is written down
 *
 * `docs/engineering/ci-automation/branch-ruleset.md` declares ONE required
 * check, `ci-gate`. A job is therefore required exactly when `ci-gate` waits
 * for it (`needs:`) and `evaluate-ci-gate.mjs` refuses to excuse its absence
 * (`alwaysRequired`). Both halves are read from their own files here — a job in
 * `needs:` that `DECLARED_JOBS` does not govern runs unwatched, and a
 * `DECLARED_JOBS` entry no workflow declares is a gate over nothing.
 */

const REPO = join(__dirname, '..', '..');
const WORKFLOWS = join(REPO, '.github', 'workflows');
const NODE_QUALITY = readFileSync(join(WORKFLOWS, '_reusable-node-quality.yml'), 'utf8');
const PR_CI = readFileSync(join(WORKFLOWS, 'pr-ci.yml'), 'utf8');
const CLEAN_ROOM = readFileSync(join(WORKFLOWS, '_reusable-clean-room.yml'), 'utf8');
const RULESET = readFileSync(
  join(REPO, 'docs', 'engineering', 'ci-automation', 'branch-ruleset.md'),
  'utf8'
);
const P1_28_PLAN = 'docs/phase-1/phase-1-28/canonical-plan.md';

const ROOT = 'root';

/** The two commands this task is accountable for. */
const P1_28_GATES = ['validate:p1-28-matrix', 'validate:p1-28-write-reachability'] as const;

/**
 * The reusable-workflow task each gate is named under, read from the file.
 *
 * A `run:` block belongs to the step above it, and every step in
 * `_reusable-node-quality.yml` is guarded by `if: inputs.task == '…'`. So the
 * task that will execute a command is the NEAREST such guard above the line
 * that names it. Returning `null` rather than a default is deliberate: a
 * command sitting in an unguarded block would otherwise be reported as running
 * under whichever task happened to be checked last.
 */
function taskGuarding(workflow: string, command: string): string | null {
  const lines = workflow.split('\n');
  const at = lines.findIndex((line) => line.trim() === `npm run ${command}`);
  if (at === -1) return null;
  for (let i = at; i >= 0; i -= 1) {
    const match = /if:\s*inputs\.task\s*==\s*'([a-z-]+)'/.exec(lines[i] as string);
    if (match) return match[1] as string;
  }
  return null;
}

/** The job ids `pr-ci.yml` passes a given `task:` input to. */
function jobsDispatching(task: string): string[] {
  const out: string[] = [];
  const lines = PR_CI.split('\n');
  lines.forEach((line, index) => {
    if (line.trim() !== `task: ${task}`) return;
    for (let i = index; i >= 0; i -= 1) {
      const match = /^ {2}([a-z][a-z0-9-]*):\s*$/.exec(lines[i] as string);
      if (match) {
        out.push(match[1] as string);
        return;
      }
    }
  });
  return out;
}

/** The job ids in `ci-gate`'s own `needs:` list. */
function ciGateNeeds(): string[] {
  const start = PR_CI.indexOf('\n  ci-gate:\n');
  expect(start, 'pr-ci.yml declares no ci-gate job').toBeGreaterThan(0);
  const block = PR_CI.slice(start);
  const needsAt = block.indexOf('\n    needs:\n');
  expect(needsAt, 'ci-gate declares no needs list').toBeGreaterThan(0);
  const out: string[] = [];
  for (const line of block
    .slice(needsAt + 1)
    .split('\n')
    .slice(1)) {
    const match = /^ {6}- ([a-z][a-z0-9-]*)$/.exec(line);
    if (!match) break;
    out.push(match[1] as string);
  }
  return out;
}

describe('both P1-28 gates are registered as gates, not as reports', () => {
  it('registers each one `required`, so BOTH halves of coverage are enforced', () => {
    /*
     * `informational` is how `validate:phase-ownership` spent two phases
     * unenforced, and `evaluate()` skips any tier it does not recognise — so
     * the tier is read off the register rather than assumed from the name.
     */
    for (const name of P1_28_GATES) {
      const entry = REGISTER.find((e: { name: string }) => e.name === name);
      expect(entry, `${name} is not in the command register`).toBeDefined();
      expect(entry?.tier, `${name} is registered \`${entry?.tier}\``).toBe('required');
      expect(entry?.why.length, `${name} is registered with no reason`).toBeGreaterThan(30);
    }
  });

  it('reaches each one from the aggregate a developer runs before a commit', () => {
    const scripts = readScripts();
    const reachable = reachableFrom(scripts, key(ROOT, AGGREGATE));
    for (const name of P1_28_GATES) {
      expect(reachable.has(key(ROOT, name)), `npm run ${AGGREGATE} does not reach ${name}`).toBe(
        true
      );
    }
  });
});

describe('a hosted job names each gate DIRECTLY, not only through an aggregate', () => {
  it('finds both in the workflows themselves, derived rather than asserted', () => {
    const invoked = readWorkflowInvocations();
    for (const name of P1_28_GATES) {
      expect(
        invoked.has(key(ROOT, name)),
        `no hosted workflow names ${name} — this is exactly the P1-27-DO-003 finding`
      ).toBe(true);
    }
  });

  it('places each one inside a task block that a pull-request job dispatches', () => {
    /*
     * A step in `_reusable-node-quality.yml` runs only when its `if:` matches
     * the caller's `task` input. A command added under a task nothing dispatches
     * is present in the file, absent from every run, and indistinguishable from
     * the first kind by grep.
     */
    const expected: Record<string, string> = {
      'validate:p1-28-matrix': 'static-quality',
      'validate:p1-28-write-reachability': 'web-quality',
    };
    for (const name of P1_28_GATES) {
      const task = taskGuarding(NODE_QUALITY, name);
      expect(task, `${name} sits in no \`inputs.task\` block`).toBe(expected[name]);
      expect(jobsDispatching(task as string), `no pr-ci.yml job passes task: ${task}`).toContain(
        task
      );
    }
  });

  it('is falsifiable — deleting the line makes the derivation say so', () => {
    // The anti-vacuity half. Without it every case above passes against a
    // parser that finds nothing and a matcher that requires nothing.
    for (const name of P1_28_GATES) {
      const mutated = NODE_QUALITY.split('\n')
        .filter((line) => line.trim() !== `npm run ${name}`)
        .join('\n');
      expect(taskGuarding(mutated, name), `${name} survived its own deletion`).toBeNull();
      expect(edgesOf(mutated, ROOT)).not.toContain(key(ROOT, name));
      // And the real file does carry the edge, so the comparison is not two
      // empty sets agreeing.
      expect(edgesOf(NODE_QUALITY, ROOT)).toContain(key(ROOT, name));
    }
  });
});

describe('the jobs that run them are required, traced to the required-check list', () => {
  const needs = ciGateNeeds();

  it('names exactly one required check, and reads that from the ruleset document', () => {
    expect(RULESET).toContain('**One required check: `ci-gate`.**');
    expect(PR_CI).toContain('\n  ci-gate:\n');
  });

  it('makes `ci-gate` wait for every job that runs a P1-28 gate', () => {
    for (const job of ['static-quality', 'web-quality', 'hosted-clean-room']) {
      expect(needs, `ci-gate does not wait for ${job}`).toContain(job);
    }
  });

  it('refuses to excuse a skip of any of them', () => {
    /*
     * `needs:` alone is not requirement. A conditional job may legitimately be
     * skipped, and `acceptableResults()` accepts `skipped` for one. Only
     * `alwaysRequired` makes an absent result a failure — which is the
     * difference between a watched job and a required one.
     */
    const governed = new Map(
      (DECLARED_JOBS as { id: string; alwaysRequired?: boolean }[]).map((job) => [job.id, job])
    );
    for (const job of ['static-quality', 'web-quality', 'hosted-clean-room']) {
      expect(governed.has(job), `${job} is in no DECLARED_JOBS entry`).toBe(true);
      expect(governed.get(job)?.alwaysRequired, `${job} may be skipped`).toBe(true);
      expect(needs, `${job} is governed but nothing waits for it`).toContain(job);
    }
  });

  it('keeps the clean-room aggregate as the second, independent path', () => {
    /*
     * The named steps above are the fast path. The clean room runs the whole
     * aggregate from a fresh clone at the exact head, and that path must not be
     * lost while the fast one exists — a single-path gate is a gate one edit
     * away from silence.
     */
    expect(CLEAN_ROOM).toContain(`npm run ${AGGREGATE}`);
    const scripts = readScripts();
    const viaAggregate = reachableFrom(scripts, key(ROOT, AGGREGATE));
    for (const name of P1_28_GATES) {
      expect(viaAggregate.has(key(ROOT, name)), `the clean room misses ${name}`).toBe(true);
    }
  });
});

describe('gate metadata moves in the same change as the file that changes it', () => {
  /**
   * The DO-001 co-maintenance obligation, from `canonical-plan.md` §5.3:
   * `MODULE_DISPOSITION` entries, re-derived doc-count markers and `SCAN_ROOTS`
   * decisions land in the SAME pull request as the first file that changes
   * them.
   *
   * It had already been broken once. P1-28's plan §9 names three trees; the
   * gate adopted one of them and its docblock described the adoption as
   * complete, so `features/appointments` — the booking, calendar and detail
   * screens — was scanned by no rule at all, including the two that enforce the
   * open `P1-OD-025` media disposition.
   */
  const posix = (path: string) => path.split(/[\\/]/).join('/');
  const plan = readFileSync(join(REPO, P1_28_PLAN), 'utf8');
  const declaredInPlan = [...plan.matchAll(/`(apps\/web\/src\/[^`]*?)\/\*\*`/g)]
    .map((m) => m[1] as string)
    .filter((path, index, all) => all.indexOf(path) === index)
    .sort();

  it('reads the P1-28 plan at all, so nothing below passes over an empty list', () => {
    expect(plan.length).toBeGreaterThan(2000);
    expect(declaredInPlan.length, 'the P1-28 plan declares no Frontend tree').toBe(3);
  });

  it('adopts every P1-28 tree the plan declares and that no plan root already holds', () => {
    const planRoots = PLAN_ROOTS.map(posix);
    const adopted = (ADOPTED_ROOTS as readonly { root: string; authority: string }[])
      .filter((entry) => entry.authority === P1_28_PLAN)
      .map((entry) => posix(entry.root))
      .sort();
    const owed = declaredInPlan.filter((tree) => !planRoots.includes(tree)).sort();
    expect(adopted, 'a tree the P1-28 plan declares is scanned by nothing').toEqual(owed);
    for (const tree of declaredInPlan) {
      expect(SCAN_ROOTS.map(posix), `${tree} is in no scan root`).toContain(tree);
    }
  });

  it('decides every module the adopted trees newly import', () => {
    /*
     * The equality itself is enforced by the gate on every run
     * (`evaluateModuleDispositions`). What this adds is the direction that
     * matters for co-maintenance: the modules the ADOPTED trees pull in must
     * already be decided, so widening a scan root and deciding its imports
     * cannot be split across two changes.
     */
    const decided = Object.keys(MODULE_DISPOSITION);
    for (const value of Object.values(MODULE_DISPOSITION)) {
      expect(['in-surface', 'platform-transport']).toContain(value);
    }
    // Named individually: `components/overlays` is the entry the appointment
    // adoption required, and it is the confirmation dialog an operator reads
    // immediately before a cancellation or a no-show write.
    expect(decided, 'the appointment tree imports an undecided module').toContain(
      'apps/web/src/components/overlays'
    );
    expect(MODULE_DISPOSITION['apps/web/src/components/overlays']).toBe('in-surface');
  });
});
