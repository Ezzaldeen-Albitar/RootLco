# Execution checkpoint

Updated after every meaningful step. Deliberately contains **no SHA of the commit
that carries it** — a document that transcribes its own commit's identity is
false the moment it is committed. Exact SHAs belong in the gate record, which is
created after the merge.

---

## Cycle 1 — Wave 0: baseline and audit

**Verified the protected baseline.** `origin/develop` =
`0f8268ef80a51441625cfe93d037e7c0804f40fa`, `origin/main` =
`491c4e0882763b5d5864737e63b4e31ca708a6b5`, working tree clean, no P1-22 path in
the tree (the single `p1-22` filename hit is a pre-existing P1-11 contract
document). Branch created from the exact verified SHA.

**Public-repository security preflight.** Repository is public. Full history —
438 commits — and the entire working tree scanned for credential shapes. **No
real credential exists in this repository, past or present.** Every match is a
documented placeholder, a redaction-test fixture, a documentation example of a
detector's own shape, or a throwaway service-container value. Three
historical-only matches were traced to their commits and confirmed synthetic; the
files no longer contain them.

**GitHub-native security features are all disabled** — Secret scanning, Push
protection, Dependabot alerts, Dependabot security updates, Code scanning.
Carried forward as P1-21-A-01. These are settings, not content; no pull request
can change them.

**Found a real supply-chain issue.** `npm audit --omit=dev` reported **3 HIGH
findings covering 13 advisories in the production path**: `next@16.2.10` (two
SSRF, unauthenticated Server Function disclosure, proxy bypass, two cache
confusion, two DoS, image DoS), `postcss@8.4.31` (three), `sharp@0.34.5`
(libvips). No workflow had ever run an audit.

**Audit written** — `current-state-audit.md`, 21 findings, capability matrix,
measured baselines.

---

## Cycle 2 — remediating what the audit found

**Production dependencies to zero.** `next` 16.2.10 → 16.2.12, plus `overrides`
for `postcss ^8.5.24` and `sharp ^0.35.3` — necessary because Next pins `postcss`
at exactly 8.4.31 and npm's only suggested remedy was downgrading Next to 9.3.3.

**A rejected fix, recorded.** An override to `brace-expansion ^5.0.8` (the only
patched release for GHSA-mh99-v99m-4gvg) broke eslint with
`TypeError: expand is not a function` — v5 changed its export shape and
`minimatch` needs the v2 API. Reverted. Verified, not assumed. There is no
patched release in any older major line, so the advisory is dev-only, itemised,
and expires 2026-10-31.

Verified after the bump: lint 0, typecheck 0, unit 926/43 — unchanged.

---

## Cycle 3 — Waves 1 and 2: the pipeline

Twenty gate scripts under `scripts/ci/`, seven reusable workflows, one composite
action, `pr-ci.yml` with 13 jobs, `protected-develop-verification.yml`.

**Three findings the new checks produced immediately, all fixed:**

| Finding                                                                              | Fix                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Three vacuous `expect(true).toBe(true)` assertions used as "did not throw" markers   | Replaced with assertions on the rows the statements were supposed to write. The `module-boundaries` one now asserts the escape hatch is taken for the one reason it is allowed, so it cannot swallow an unrelated failure |
| `LOG_LEVEL` read by `src/server/observability/logger.ts`, absent from `.env.example` | Documented                                                                                                                                                                                                                |
| `/api/health` sits outside `/api/v1`, which the contract forbids                     | Recorded as a justified exception with the reason; **any new** unversioned route is now a finding                                                                                                                         |

**One finding recorded, not fixed:** 10 IAM operations declare `idempotent: true`
with no replay evidence, including `iam.grant-issue` and
`iam.role-permission-add`. Whether the code honours the promise is a P1-14
question that a CI initiative cannot settle — writing the tests blind would
either pass vacuously or turn into unscoped remediation. Itemised by name with
owners and a 2026-10-31 expiry. Any new unproven promise fails immediately.

**One finding recorded, deliberately not hidden:** `src/shared/errors/app-error.ts`
is dead code with 0 % coverage and zero references repo-wide. Left in the
coverage include set — excluding it would raise the number by hiding code.

**Two false positives in my own checks, corrected:** the migration filename rule
did not know about the three `0001_`-style bootstrap migrations, and the
developer-data scanner could not tell a status-history trigger body from a data
seed. Both fixed by teaching the checker the repository's actual conventions
rather than by adding exclusions.

Local verification: lint 0, typecheck 0, format 0, unit **1024**/46, test honesty
clean, workflow security clean, route parity clean, env contract clean,
idempotency clean, migration static clean, security:all clean, `actionlint` 0
errors across 12 workflow files.

---

## Cycle 4 — Waves 3, 4, 5

Nightly assurance (10 jobs), release verification with build-once/SBOM/provenance,
inert staging and production deployment foundations, Dependabot for npm, docker
and github-actions, every action pinned to a commit SHA, and the seventeen
documents under `docs/engineering/ci-automation/`.

---

## Cycle 5 — Wave 6: hostile review

Three independent read-only reviewers produced **27 findings**. Full record:
[`evidence/adversarial-review.md`](evidence/adversarial-review.md).

**The most important one made the whole pipeline inoperable.** Every job's first
step was `uses: ./.github/actions/setup-project` — a LOCAL action — with no
prior checkout. `uses: ./…` resolves from the workspace, which is empty when a
job starts, so all 21 call sites would have failed with _"Can't find
action.yml"_. Fail-closed, so never a bypass; but it means nothing here had ever
executed, and the rollout plan's "expected first-run failures" table had not
anticipated it.

Six further High findings, each a green result that was not earned: an
unrecognised `task` input skipping every step and reporting success; a falsy
`needs` entry producing Go; a new advisory absorbed by an existing transitive
waiver; an `npm audit` error object reading as zero advisories; a worktree
secret scan running where its target directory did not exist; and a nightly
mutation gate that was structurally guaranteed to be red every night.

Nineteen Medium findings, including three that the reviewers proved my own tests
would not catch — one of which was a test that had **enshrined** the bug it was
supposed to guard (`src/app/api/**` classified as frontend, so a route handler
skipped the RLS matrix).

Every Critical, High and Medium finding was reproduced and closed. One
structural finding is documented rather than fixed: on a `pull_request` the
workflow, the composite action, the gate scripts and the baselines all come from
the PR head, so a change that weakens a gate and deletes the check that would
catch it passes. That is inherent to the trigger.

### Hostile mutations

**Twenty-one gate-result mutations unit-proved** against the real evaluator, plus
a control proving a gate that always said No-Go would not pass them.

**Seven repository mutations actually applied**, detected, and restored
byte-identically: a swallowed exit status, a run block that does not fail fast, a
hand-edited OpenAPI document, a runner retry, parallel database suites, an
unpinned action, and a removed route import. `git status --porcelain` empty after
each.

Full record: [`evidence/hostile-mutation-results.md`](evidence/hostile-mutation-results.md).

Local verification after remediation: format 0, lint 0, typecheck 0, style 0,
**unit 1034/47**, encoding 0, canonical docs 0, security:all 0, module
boundaries 0, authorization coverage 0, operation coverage 0, OpenAPI 0, test
honesty 0, workflow security 0 (now including the composite action), route
parity 0, environment contract 0, idempotency evidence 0, migration static 0,
mutation anchors verified, `actionlint` 0 errors across 13 workflow files.

---

## Cycle 6 — supply-chain disposition

**Production dependency advisories: Resolved through compatible patch upgrades.**
**brace-expansion advisory: Open — upstream-blocked development-tooling
exception with no proven production or runtime reachability.**

The incompatible override is absent and stays absent. The compatible production
patches stay: `next` 16.2.12, `postcss ^8.5.24`, `sharp ^0.35.3`.
`npm audit --omit=dev` reports **0 vulnerabilities**.

**A finding that changed the analysis.** The lockfile resolves
`brace-expansion` THREE times, and one is already patched: `minimatch@10.2.5`
requires `^5.0.5`, so `node_modules/brace-expansion` is **5.0.8**. npm's `nodes`
list names only the other two — 1.1.16 under `minimatch@3`, 2.1.3 under glob's
`minimatch@9`. The earlier override forced _all_ of them to 5.x, which is
precisely why ESLint broke.

Reachability is now **derived, not claimed** — 70 root-to-target walks all
beginning on a devDependencies edge; `npm ls --omit=dev` returns `(empty)`; no
import anywhere in `src/` or `scripts/`; every glob pattern from committed
configuration; and absence from the built image asserted by enumerating the real
image filesystem on a hosted runner. Full record:
[`evidence/brace-expansion-reachability-proof.md`](evidence/brace-expansion-reachability-proof.md).

The exception is exact — one advisory, one package, one range, one
dependency-path fingerprint, one expiry — and ten gate rules enforce it, each
with a mutation test. Deleting a _rule_ makes its test fail; verified on two of
them.

Local battery: 24 checks, all pass. Unit tier **1063**.

---

## Cycle 7 — Wave 7: blocked at the time (superseded by Cycle 8)

The branch `feature/platform-comprehensive-ci-automation` is pushed. **The pull
request cannot be opened from this session.**

Opening a pull request is a REST or web operation and requires an authenticated
GitHub session. Pushing works because the remote is SSH. Neither available
browser surface is signed in to GitHub, the Chrome extension is not connected,
`gh` is not installed, and no `GH_TOKEN`/`GITHUB_TOKEN` is configured. Obtaining
one would mean handling a credential, which is not something to do.

This is stopping condition §49.7 in substance: the protected merge path is
unavailable.

**Everything that does not depend on it is complete.** The remaining steps and
what the owner needs to do are in [`rollout-plan.md`](rollout-plan.md).

### Not yet proven, and honestly so

Nothing in this change has executed on a GitHub-hosted runner. Local verification
covered lint, types, formatting, the 1024-test unit tier, every dependency-free
gate script, `actionlint` over all twelve workflows, and the mutation battery.

It did **not** cover: the database tier, the backend tier, the container build
and scan, CodeQL, the clean room, or any workflow actually executing. Those
require the hosted runners, which is where the first run will find whatever the
first run finds. `rollout-plan.md` lists the failures that are genuinely
expected, so that a red first run is read as information rather than as a
surprise.

---

## Cycle 8 — Wave 7 unblocked: the pipeline meets a real runner

The owner opened **PR #89**, which cleared the block above. Five hosted runs so
far. The prediction in Cycle 7 held in the worst way: the first two could not
execute at all, and **not one of the genuinely expected failures happened first.**

| Run | Head SHA  | `pr-ci`                                              |
| --- | --------- | ---------------------------------------------------- |
| 1   | `8740531` | `startup_failure`, zero jobs — AR-28                 |
| 2   | `67014fc` | every job failed in `Set up the project` — AR-29     |
| 3   | `2654f23` | ran: 7 green, 6 real gate failures — AR-30…AR-33     |
| 4   | `9088013` | 11 of 13 green; container only — AR-34, AR-35, AR-36 |
| 5   | `ca4c594` | **14/14 green, `ci-gate` Go**                        |

**AR-28** — a caller's `permissions:` are the ceiling for _every_ job in the
reusable workflow it calls, including ones an `if:` would skip; GitHub validates
that statically before conditions are evaluated. Three adversarial reviewers,
`actionlint` and this repository's own workflow linter all passed it. Now
WFS-011.

**AR-29** — the fix for AR-01 bootstrapped a **non-cone** sparse checkout, which
`git sparse-checkout disable` does not undo, so every job ran against a one-file
workspace. Now WFS-012.

Both were defects in the _remediation_ for an earlier finding. The pattern is
worth stating plainly: a workflow that has never executed is not evidence of
anything, and neither is a fix that has never executed.

### A constraint that shaped the diagnosis

**GitHub requires a signed-in session to read Actions logs, even on a public
repository.** The API returns 403 without admin, the web log route 404s, and the
job page offers only "Sign in to view logs". Only the check-run _annotations_ are
public, and they carry the failing step and an exit code, not the message.

So every cause was **reproduced locally** rather than inferred: the two-checkout
sequence replayed with git, the eleven repository gates re-run in a clean clone,
`hadolint` run against the same image, and the full migration sequence executed
against a throwaway PostgreSQL 17 container.

### What run 3 found, and how each was closed

| ID    | Finding                                                                                                | Closed by                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| AR-30 | `validate:canonical-docs` can never pass on a runner — the documents are external by policy            | a `--record-only` CI mode that verifies the record and still fails on a present-but-changed document |
| AR-31 | the replay counted `supabase_migrations.schema_migrations`, which this repository's runner never wrote | the runner now maintains the ledger, inside each migration's own transaction                         |
| AR-32 | hadolint DL3018 ×4, unpinned `apk add`                                                                 | per-line suppressions with the reason recorded; a new unpinned `apk add` is still reported           |
| AR-33 | dependency review blocked on the Dependency graph being disabled (P1-21-A-01)                          | probe first; report the setting for what it is; any unexpected status still fails                    |

None was closed by weakening a gate. AR-31 in particular was closed by making
the claim true rather than by deleting the check.

### Verified locally before pushing

- migrations 119/119 applied; ledger records 119; **schema hash `a677eb05…`
  unchanged** — measured before and after the ledger was introduced
- seeds applied twice, idempotent, every business table empty
- **database tier 1624 tests green** in the exact order `ci.yml` uses, because
  `apply-migrations.mjs` is shared with the legacy workflow
- unit tier 1070 green; the whole static battery and `actionlint` clean
- `hadolint` clean, and still firing on a newly added unpinned `apk add`
- the composite's sparse-checkout teardown exercised in all four workspace states

Legacy `ci.yml` has passed **4/4 on every one of the three commits**, which is
the independent signal that the supply-chain remediation itself is sound: those
four jobs use none of the new reusable workflows.
