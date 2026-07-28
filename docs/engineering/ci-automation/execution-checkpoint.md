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

**Twenty-one gate-result mutations unit-proved** against the real evaluator, plus
a control proving a gate that always said No-Go would not pass them.

**Seven repository mutations actually applied**, detected, and restored
byte-identically: a swallowed exit status, a run block that does not fail fast, a
hand-edited OpenAPI document, a runner retry, parallel database suites, an
unpinned action, and a removed route import. `git status --porcelain` empty after
each.

Full record: [`evidence/hostile-mutation-results.md`](evidence/hostile-mutation-results.md).

Independent adversarial reviewers were run over Actions security and injection,
gate correctness and test honesty, and database/container/supply-chain
assurance.

---

## Cycle 6 — Wave 7: BLOCKED

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
