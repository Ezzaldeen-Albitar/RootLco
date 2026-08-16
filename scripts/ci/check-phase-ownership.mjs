#!/usr/bin/env node
/**
 * Phase changed-file ownership gate.
 *
 * A phase declares which parts of the repository it is allowed to touch, and
 * this proves the branch honoured that declaration. It exists because the
 * expensive failure mode is not a broken build — it is a Backend or Database
 * change riding inside a Frontend phase, where nobody reviews it as Backend and
 * no Backend gate is triggered by it.
 *
 * ## Profiles
 *
 * `p1-26-frontend` is the one P1-26 will run under: a Frontend phase may change
 * `apps/web`, its own tests, its documentation and the repository tooling it
 * needs — and must change no API source, no Supabase, and no migration.
 *
 * `api-boundary` is the profile of the pre-P1-26 remediation itself, which is
 * the mirror image: it may change API and tooling, and must not change web
 * runtime source. Declaring it lets THIS branch run the gate against itself,
 * so the mechanism is proven by use before the phase that depends on it starts,
 * rather than being a check that has never once executed.
 *
 * ## Every changed file must classify
 *
 * An unclassified file is a failure, not a shrug. The point of the gate is that
 * somebody decided where each change belongs; a file nobody predicted is
 * exactly the one worth looking at.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Ordered classification rules. FIRST match wins, so the specific
 * `apps/api/src/app/api/**` case is stated before the general `apps/api/**`.
 */
export const CLASSIFIERS = [
  // Before 'web': the ONE file in apps/web a Backend branch may legitimately
  // carry — generator output kept in sync by the Backend's own register, and
  // validated by validate:generated-artifacts + validate:idempotent-operations.
  // A bucket of its own so a Backend profile can allow it without opening the
  // handwritten web tree (the hole every Backend profile exists to close).
  {
    bucket: 'webGenerated',
    test: (p) => p === 'apps/web/src/lib/api/idempotent-operations.ts',
  },
  { bucket: 'web', test: (p) => p.startsWith('apps/web/') },
  { bucket: 'apiSource', test: (p) => p.startsWith('apps/api/src/') },
  { bucket: 'apiConfig', test: (p) => p.startsWith('apps/api/') },
  { bucket: 'migrations', test: (p) => p.startsWith('supabase/migrations/') },
  { bucket: 'supabase', test: (p) => p.startsWith('supabase/') },
  { bucket: 'docs', test: (p) => p.startsWith('docs/') || /^[A-Z]+\.md$/.test(p) },
  { bucket: 'tooling', test: (p) => p.startsWith('scripts/') || p.startsWith('.github/') },
  { bucket: 'tests', test: (p) => p.startsWith('tests/') },
  {
    bucket: 'rootConfig',
    test: (p) =>
      !p.includes('/') ||
      p.startsWith('.vscode/') ||
      p === 'Dockerfile' ||
      p === 'docker-compose.yml',
  },
];

/** What each profile permits. Anything not listed is forbidden. */
export const PROFILES = {
  'p1-26-frontend': {
    why: 'P1-26 is a Frontend phase',
    allowed: ['web', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      apiSource:
        'a Frontend phase must not change API source — route it through a Backend remediation',
      apiConfig: 'a Frontend phase must not change API workspace configuration',
      migrations: 'a Frontend phase must not change a migration',
      supabase: 'a Frontend phase must not change the database',
    },
  },
  'p1-27-frontend': {
    why: 'P1-27 is a Frontend phase',
    // Identical rules to `p1-26-frontend`, declared under its own name because a
    // phase that borrows another phase's profile is not declaring anything. The
    // gate defaults to `p1-26-frontend` when no profile is given, which is how
    // P1-27 came to be measured against P1-26's declaration for its whole life.
    allowed: ['web', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      apiSource:
        'a Frontend phase must not change API source — route it through a Backend remediation',
      apiConfig: 'a Frontend phase must not change API workspace configuration',
      migrations: 'a Frontend phase must not change a migration',
      supabase: 'a Frontend phase must not change the database',
    },
  },
  'p1-18-read-surface': {
    why:
      'the P1-18 appointment/reception read-surface remediation (P1-28 gaps G-APT-READ, G-REC-READ, ' +
      'G-CAT-*, G-REC-CLOSE): new GET routes, close commands, permission seeds, new migrations and tests',
    allowed: [
      'apiSource',
      'apiConfig',
      'docs',
      'tooling',
      'tests',
      'rootConfig',
      'migrations',
      'supabase',
      'webGenerated',
    ],
    forbidden: {
      web:
        'Backend-only — the handwritten Frontend half is a separate change. The generated ' +
        'idempotent-operations.ts travels under its own webGenerated bucket, matching the P1-24 ' +
        'backend-merge precedent (#212/#213)',
    },
  },
  'p1-15-evidence-foundation': {
    why:
      'the P1-OD-025 shared private/versioned evidence remediation: an S3-compatible storage ' +
      'adapter, the scanner handoff, two evidence read operations, the category policy columns ' +
      'and the migration that carries them',
    allowed: [
      'apiSource',
      'apiConfig',
      'docs',
      'tooling',
      'tests',
      'rootConfig',
      'migrations',
      'supabase',
      // `apps/web/src/lib/api/idempotent-operations.ts`. A first draft of this
      // profile FORBADE it, reasoning that two new READ operations cannot move
      // an idempotency manifest. That reasoning was wrong about the file: it
      // publishes EVERY operation the contract carries, with its idempotency
      // and audit class as fields, so any new operation moves it. Allowing it
      // is the P1-18 read-surface and P1-24 backend-merge precedent (#212/#213)
      // — generator output the Backend's own register keeps in sync, validated
      // by `validate:generated-artifacts` and `validate:idempotent-operations`.
      'webGenerated',
    ],
    forbidden: {
      // Backend-only, for the reason every Backend profile gives: the reception
      // Frontend that will consume this evidence surface is a separate change,
      // reviewed as Frontend. `apiConfig` IS allowed here and is not allowed to
      // most Backend profiles — this change adds runtime dependencies to
      // `apps/api/package.json`, which is a Backend fact about a Backend
      // workspace, and hiding it in `rootConfig` would misdescribe it.
      web: 'the evidence foundation is Backend-only — the reception Frontend is a separate change',
    },
  },
  'p1-27-backend-partner-identity': {
    why: 'the P1-27-INT-025 partner-identity Backend remediation, split out of the Frontend branch',
    allowed: ['apiSource', 'apiConfig', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      // `web` forbidden on purpose, for the same reason `backend-login-contract`
      // forbids it: this change exists BECAUSE seven API source files were
      // riding inside a Frontend branch where no Backend gate saw them. A
      // profile that permitted both halves would reopen the hole it closes.
      web: 'the partner-identity remediation is Backend-only — the Frontend half is a separate change',
      migrations: 'the partner-identity remediation must not change a migration',
      supabase: 'the partner-identity remediation must not change the database',
    },
  },
  'repository-tooling': {
    why:
      'a repository-wide GATE and its suite, owned by no phase — the no-fake-data guard, the ' +
      'workflow that runs it, the tests that prove it can still fail, and the phase records its ' +
      'counts appear in',
    // `web` is forbidden for the same reason every Backend profile forbids it,
    // pointing the other way: a branch that may rewrite a gate must not also
    // carry product changes that the gate is what reviews. A profile borrowed
    // from a phase would declare nothing — this branch belongs to no phase, and
    // saying so is the whole content of the declaration.
    allowed: ['tooling', 'tests', 'docs', 'rootConfig'],
    forbidden: {
      web: 'a repository tooling change must not carry Frontend source — that is a phase change',
      webGenerated:
        'a repository tooling change must not regenerate the Frontend contract manifest',
      apiSource: 'a repository tooling change must not change API source',
      apiConfig: 'a repository tooling change must not change API workspace configuration',
      migrations: 'a repository tooling change must not change a migration',
      supabase: 'a repository tooling change must not change the database',
    },
  },
  'api-boundary': {
    why: 'the pre-P1-26 API file-boundary remediation',
    allowed: ['apiSource', 'apiConfig', 'docs', 'tooling', 'tests', 'rootConfig', 'web'],
    forbidden: {
      migrations: 'the boundary remediation must not change a migration',
      supabase: 'the boundary remediation must not change the database',
    },
  },
  'backend-login-contract': {
    why: 'the login-identity Backend remediation P1-26 is blocked on',
    allowed: ['apiSource', 'apiConfig', 'docs', 'tooling', 'tests', 'rootConfig'],
    forbidden: {
      // `web` is forbidden ON PURPOSE. A Backend profile that also permitted
      // Frontend would let the two halves of this contract change land in one
      // unreviewed commit — which is the same hole `p1-26-frontend` exists to
      // close, merely pointing the other way. The Frontend half is a separate
      // change under `p1-26-frontend`, against a Backend contract already merged.
      web: 'the login-contract remediation is Backend-only — the Frontend half is a separate change',
      migrations: 'the login-contract remediation must not change a migration',
      supabase: 'the login-contract remediation must not change the database',
    },
  },
};

/* ==========================================================================
 * Part two: WHICH ownership question this CI run can answer.
 *
 * Everything above decides whether a diff honoured a profile. This decides
 * whether the run has a diff and a profile to decide about — and what happens
 * when it does not.
 *
 * It lives in this file rather than beside it because the two halves are one
 * gate: a reader who finds the classification rules must also find the reason a
 * run can legitimately check nothing, or the second will be reinvented as an
 * `exit 0`. Which is exactly what happened — see `decideOwnershipRun()`.
 * ========================================================================== */

/** Where the branch → profile map lives. */
export const PROFILE_MAP_PATH = '.github/ci-baselines/phase-ownership-profiles.json';

/**
 * Branches on which the ownership question does not apply.
 *
 * Not configurable, for the reason `check-promotion-source.mjs` gives about the
 * same pair: `develop` and `main` are named in ADR-006 as permanent branches
 * with fixed meanings, and a configurable list would let the skip be widened by
 * editing a value rather than by amending the ADR.
 */
export const PROTECTED_BRANCHES = Object.freeze(['develop', 'main']);

/** Events that carry a pull request, and therefore must carry its refs. */
export const PULL_REQUEST_EVENTS = Object.freeze(['pull_request', 'pull_request_target']);

/**
 * The base a branch push is judged against.
 *
 * `static-quality` checks out at `fetch-depth: 0`, so `origin/develop` is
 * present. If it ever is not, `check-phase-ownership.mjs` exits 2 naming the
 * ref — a broken measurement, reported as one.
 */
export const DEFAULT_BASE = 'origin/develop';

/**
 * What may appear in a value the run block sources.
 *
 * A ref or profile name outside this set is not a real one, so refusing it costs
 * nothing and removes the whole class of question about what the shell would do
 * with it.
 */
const SAFE_VALUE = /^[A-Za-z0-9._/-]+$/;

const refuse = (reason) => ({
  action: 'refuse',
  checked: false,
  profile: null,
  base: null,
  reason,
});

/**
 * Resolve a branch against the committed profile map.
 *
 * @param {string} branch
 * @param {ReadonlyArray<{branchPrefix?: string, profile?: string}>} rules
 * @param {string} how  how this branch was arrived at, for the message
 */
function fromBranch(branch, base, rules, how) {
  if (!Array.isArray(rules) || rules.length === 0) {
    return refuse(
      `${PROFILE_MAP_PATH} declares no rules, so every branch would resolve to nothing. An empty ` +
        'map is a broken map, not a permissive one.'
    );
  }
  const rule = rules.find(
    (r) =>
      typeof r?.branchPrefix === 'string' &&
      r.branchPrefix !== '' &&
      branch.startsWith(r.branchPrefix)
  );
  if (!rule) {
    return refuse(
      `branch \`${branch}\` declares no changed-file ownership profile. Add a rule to ` +
        `${PROFILE_MAP_PATH} saying which parts of the repository this branch is allowed to ` +
        "change. Refusing to judge it against another phase's declaration, which is how every " +
        'branch came to be measured against p1-26-frontend.'
    );
  }
  if (typeof rule.profile !== 'string' || !SAFE_VALUE.test(rule.profile)) {
    return refuse(
      `the rule matching \`${branch}\` names profile \`${String(rule.profile)}\`, which is not a ` +
        'usable profile name.'
    );
  }
  if (!SAFE_VALUE.test(base)) {
    return refuse(`base ref \`${base}\` is not a usable ref name, so nothing will be diffed.`);
  }
  return {
    action: 'check',
    checked: true,
    profile: rule.profile,
    base,
    reason: `${how} -> ownership profile '${rule.profile}', judged against '${base}'`,
  };
}

/**
 * @param {{headBranch?: string, baseRef?: string, eventName?: string, refName?: string,
 *          rules?: ReadonlyArray<{branchPrefix?: string, profile?: string}>}} context
 * @returns {{action: 'check'|'declared-skip'|'refuse', checked: boolean,
 *            profile: string|null, base: string|null, reason: string}}
 */
export function decideOwnershipRun(context = {}) {
  const head = String(context.headBranch ?? '').trim();
  const baseRef = String(context.baseRef ?? '').trim();
  const event = String(context.eventName ?? '').trim();
  const ref = String(context.refName ?? '').trim();
  const rules = context.rules ?? [];

  if (head !== '' && baseRef !== '') {
    return fromBranch(head, `origin/${baseRef}`, rules, `pull-request head '${head}'`);
  }

  // Half a context is never a legitimate state: both inputs come from the same
  // event, so one without the other means the caller wired one of them wrong.
  // Treating it as "no pull request" is how a typo turns into a silent skip.
  if (head !== '' || baseRef !== '') {
    return refuse(
      `the caller supplied head-branch='${head}' and base-ref='${baseRef}' — exactly one of the ` +
        'two. Both come from the same event, so this is a wiring defect in the calling workflow.'
    );
  }

  if (PULL_REQUEST_EVENTS.includes(event)) {
    return refuse(
      `this is a '${event}' run, so a pull-request context exists, but the caller passed neither ` +
        'head-branch nor base-ref. The ownership gate would judge nothing and report success. ' +
        'Pass `head-branch: ${{ github.event.pull_request.head.ref }}` and `base-ref: ' +
        '${{ github.event.pull_request.base.ref }}` from the calling workflow.'
    );
  }

  if (event === '') {
    return refuse(
      'no event name was supplied, so this run cannot establish its own context. A check that ' +
        'cannot tell what it is running on must not report success.'
    );
  }

  if (ref === '') {
    return refuse(
      `a '${event}' run supplied no ref name: there is no pull request to read a profile from and ` +
        'no branch to resolve one from.'
    );
  }

  if (PROTECTED_BRANCHES.includes(ref)) {
    return {
      action: 'declared-skip',
      checked: false,
      profile: null,
      base: null,
      reason:
        `'${ref}' is a protected branch and this is a '${event}' run. Changed-file ownership is a ` +
        'property of ONE phase branch against its base; a protected branch is the union of every ' +
        'phase that has landed, so no profile could describe it and there is no base to diff ' +
        'against. Every commit here passed this gate on the pull request that merged it. ' +
        'DECLARED SKIP — nothing was checked, and this run is not evidence that it was.',
    };
  }

  // A push or dispatch on an ordinary branch. There is no pull request, but the
  // profile map is keyed on the branch, and the branch is right here.
  return fromBranch(ref, DEFAULT_BASE, rules, `'${event}' on branch '${ref}'`);
}

/**
 * A value the sourcing shell will read back exactly as written.
 *
 * POSIX single-quote escaping: close the quote, emit an escaped quote, reopen.
 * Values are validated before they reach here; this is the second of the two
 * independent defences.
 */
export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

/** The `KEY='value'` block the run block sources. */
export function envFileBody(verdict) {
  return (
    [
      `OWNERSHIP_ACTION=${shellQuote(verdict.action)}`,
      `OWNERSHIP_PROFILE=${shellQuote(verdict.profile ?? '')}`,
      `OWNERSHIP_BASE=${shellQuote(verdict.base ?? '')}`,
    ].join('\n') + '\n'
  );
}

/**
 * @param {string} path
 * @returns {string} bucket name, or 'unclassified'
 */
export function classify(path) {
  for (const rule of CLASSIFIERS) if (rule.test(path)) return rule.bucket;
  return 'unclassified';
}

/**
 * @param {readonly string[]} changed changed files vs the phase base
 * @param {string} profileName
 * @returns {{ failures: string[], counts: Record<string, number> }}
 */
export function evaluate(changed, profileName) {
  /** @type {string[]} */
  const failures = [];
  /** @type {Record<string, number>} */
  const counts = {};

  const profile = PROFILES[profileName];
  if (!profile) {
    return { failures: [`unknown ownership profile: ${profileName}`], counts };
  }

  for (const bucket of Object.keys(PROFILES[profileName].forbidden)) counts[bucket] = 0;
  for (const bucket of profile.allowed) counts[bucket] = 0;
  counts.unclassified = 0;
  counts.changed = changed.length;

  // Anti-vacuity. Every rule below iterates the changed set, so an empty set
  // passes every rule having judged nothing — indistinguishable from a diff
  // that silently produced no output because the base ref was wrong. A phase
  // branch under review always has changes; zero means the measurement failed,
  // not that the branch is clean.
  if (changed.length === 0) {
    failures.push(
      'no changed files were found against the base — a phase branch under review always has ' +
        'changes, so this is a broken comparison rather than a clean result'
    );
    return { failures, counts };
  }

  for (const path of changed) {
    const bucket = classify(path);
    counts[bucket] = (counts[bucket] ?? 0) + 1;
    if (bucket === 'unclassified') {
      failures.push(`unclassified changed file: ${path} — decide where it belongs`);
      continue;
    }
    const forbidden = profile.forbidden[bucket];
    if (forbidden) failures.push(`${bucket}: ${path} — ${forbidden}`);
  }

  return { failures, counts };
}

/**
 * `--resolve-context`: decide what this run may ask, and say so.
 *
 * A separate entry point on the same file rather than a separate file, because
 * the decision and the rules it selects belong to one gate. The workflow calls
 * this first, then calls the gate proper only on the `check` verdict.
 */
function resolveContextMain() {
  const arg = (name) => {
    const i = process.argv.indexOf(`--${name}`);
    return i === -1 ? undefined : process.argv[i + 1];
  };

  let rules;
  try {
    rules = JSON.parse(readFileSync(PROFILE_MAP_PATH, 'utf8')).rules ?? [];
  } catch (error) {
    console.error(`::error::could not read ${PROFILE_MAP_PATH}: ${String(error)}`);
    process.exit(2);
  }

  const event = process.env.OWNERSHIP_EVENT_NAME ?? process.env.GITHUB_EVENT_NAME ?? '';
  const ref = process.env.OWNERSHIP_REF_NAME ?? process.env.GITHUB_REF_NAME ?? '';
  const verdict = decideOwnershipRun({
    headBranch: process.env.HEAD_BRANCH,
    baseRef: process.env.BASE_REF,
    eventName: event,
    refName: ref,
    rules,
  });

  console.log(`changed-file ownership: ${verdict.action.toUpperCase()}`);
  console.log(`  ${verdict.reason}`);

  const envOut = arg('env-out');
  if (envOut) writeFileSync(envOut, envFileBody(verdict), 'utf8');

  // Written only when asked. A default path would drop an untracked file into
  // the repository root every time somebody ran this by hand.
  const jsonOut = arg('json');
  if (jsonOut) {
    const record = {
      action: verdict.action,
      checked: verdict.checked,
      profile: verdict.profile,
      base: verdict.base,
      reason: verdict.reason,
      event,
      ref,
    };
    writeFileSync(jsonOut, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  }

  // The declared skip is RECORDED, not merely printed: a skip nobody can find
  // afterwards is the silent success it replaced, one step removed.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### Changed-file ownership — ${verdict.action}\n\n${verdict.reason}\n\n`,
      'utf8'
    );
  }

  if (verdict.action === 'refuse') {
    console.error(`::error::${verdict.reason}`);
    process.exit(1);
  }
  if (verdict.action === 'declared-skip') console.log(`::notice::${verdict.reason}`);
}

function main() {
  // Checked before anything reads `process.argv[2]` as a profile name, which is
  // what a flag would otherwise be taken for.
  if (process.argv.includes('--resolve-context')) return resolveContextMain();

  /*
   * Profile selection: argument, then environment, then the default.
   *
   * `PHASE_OWNERSHIP_PROFILE` exists because the npm script that invokes this
   * gate — `validate:phase-ownership` — passes no argument, so every caller got
   * `p1-26-frontend` whatever branch they were on. That is not a nuisance: on a
   * BACKEND branch the default forbids `apiSource`, so the gate cannot pass at
   * all, and the two P1-27 profiles below were reachable from no script and no
   * workflow. A profile nothing can select is a declaration, not a gate — which
   * is this phase's own recurring defect, in its own tooling.
   *
   * The env var lets one CI job select the profile per branch without a script
   * per profile. That job now exists — `_reusable-node-quality.yml`, task
   * `static-quality`, step "Changed-file ownership" — and it always sets both
   * variables: `--resolve-context` above resolves the profile from
   * the pull-request head branch, or from the pushed ref when there is no pull
   * request, and refuses the run rather than defaulting when it can resolve
   * neither.
   *
   * The `p1-26-frontend` fallback below therefore governs only a HAND run with
   * no argument and no environment. It is kept because removing it would make
   * `npm run validate:phase-ownership` fail for the person debugging the gate,
   * and it is stated here so nobody reads it as the CI behaviour: in CI nothing
   * is defaulted, and an unmapped branch is refused.
   */
  const profileName = process.argv[2] ?? process.env.PHASE_OWNERSHIP_PROFILE ?? 'p1-26-frontend';
  const base = process.argv[3] ?? process.env.PHASE_OWNERSHIP_BASE ?? 'origin/develop';

  let changed = [];
  try {
    changed = execFileSync(
      'git',
      ['diff', '--name-only', '-M', '--diff-filter=ACMRD', `${base}...HEAD`],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
  } catch (error) {
    console.error(
      `could not diff against ${base}: ${error instanceof Error ? error.message : error}`
    );
    process.exit(2);
  }

  const { failures, counts } = evaluate(changed, profileName);
  const profile = PROFILES[profileName];

  console.log(
    `Phase ownership [${profileName}${profile ? ` — ${profile.why}` : ''}] vs ${base}: ` +
      `${counts.changed ?? 0} changed file(s), ${failures.length} violation(s).`
  );
  const shown = Object.entries(counts)
    .filter(([k, v]) => k !== 'changed' && v > 0)
    .map(([k, v]) => `${k}=${v}`)
    .join(' · ');
  if (shown) console.log(`  ${shown}`);

  if (failures.length > 0) {
    for (const f of failures) console.error(`  ${f}`);
    console.error(
      '\nA phase changes what it declared it would change. A Backend or Database ' +
        'change riding inside another phase is reviewed by nobody and gated by nothing.'
    );
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
