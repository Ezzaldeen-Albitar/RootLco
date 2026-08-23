# P1-29 branch governance and the future PR graph

**Design only. No script is modified by this planning slice, and none may be.**

## The problem, stated exactly

P1-29 contains **Backend prerequisite work** (`apps/api`, `supabase/migrations`, `supabase/seeds`,
`scripts/ci`) **and Frontend work** (`apps/web`). No single ownership profile permits both:
`p1-27-frontend` forbids `apiSource`, `apiConfig`, `migrations` and `supabase`;
`p1-28-backend-owner-qa` permits `apiSource` and `migrations` but forbids `web`.

`unmappedPolicy` is `FAIL`, so a branch matching no rule is refused outright — _"Refusing to judge
it against another phase's declaration, which is how every branch came to be measured against
p1-26-frontend."_ And the gate's positional default is literally `p1-26-frontend`, so a **local**
run without an explicit argument reports a verdict against the wrong declaration.

## The precedent to follow

Two precedents exist and they agree: **split the branches, do not widen a profile.**

- **P1-28** mapped four of its five prefixes to `p1-27-frontend` and carved out
  `remediation/p1-28-owner-qa-backend` to `p1-28-backend-owner-qa`, listed **before** the general
  `remediation/p1-28-` rule because the first matching prefix wins.
- **PRE-P1-29** went further and defined three profiles up front — `pre-p1-29-backend`,
  `pre-p1-29-web` and `pre-p1-29-initiative` — precisely so that neither lane could touch the
  other's half of the product. Its integration lane deliberately uses a **full branch name rather
  than a prefix**, because a shorter prefix would swallow both lane branches and hand each of them
  the other half of the product.

**Recommendation: P1-29 follows the PRE-P1-29 three-profile model rather than the P1-28 two-branch
carve-out** — because P1-29's Backend half is a _planned prerequisite slice_ rather than an
unforeseen remediation, and because a mixed phase with a large web surface needs an initiative lane
that can carry evidence and records touching both halves.

## Proposed future branch naming — a proposal, not a change

| branch                                                                               | profile it would need                                                                                           | carries                                |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `feature/p1-29-backend-…`                                                            | a P1-29 Backend profile allowing `apiSource`, `migrations`, `dbSeeds`, `docs`, `tooling`, `tests`, `rootConfig` | Slice A0 — `BE-1`…`BE-5`               |
| `feature/p1-29-web-…`                                                                | a P1-29 Web profile allowing `web`, `webContract`, `docs`, `tooling`, `tests`, `rootConfig`                     | Slices A…H                             |
| `feature/p1-29-work-order-diagnostics-technician-frontend` (full name, not a prefix) | a P1-29 initiative profile                                                                                      | integration, evidence, closure records |

Declared **in the first commit that opens each branch**, longest prefix first, and always invoked
with the profile named explicitly.

## The future PR graph

**Not one giant P1-29 pull request.** The recommended sequence, each arrow a merge to protected
`develop`:

```
  PRE-P1-29 remaining slices  ──►  develop      (B2 … B7, B9, then waves C … I)
             │
             ▼
  P1-29 A0 Backend prerequisites ──►  develop   (BE-5, BE-2, BE-1, BE-3, BE-4)
             │
             ▼
  P1-29 frontend slices ──►  develop            (A, B, C, D, E, F, G — several PRs)
             │
             ▼
  P1-29 acceptance + remediation ──►  develop   (H)
             │
             ▼
  gate record  ──►  develop  ──►  promotion to main
```

Per-PR specification is in the table at the end of this document. Each row names the branch, the
ownership profile, the scope, the dependencies, the tests and the merge gate.

---

## The evidence

### branchPrefix rule list — 24 rules, complete

**EXISTS AND LOAD-BEARING.**

TOTAL = 24. In file order (first match wins), prefix → profile, with the stated `why`: 1 `p1-27/` → p1-27-frontend — "the P1-27 Frontend working branches — apps/web, docs, tooling, tests and root config only" 2 `feature/p1-27-` → p1-27-frontend — "the P1-27 Frontend integration branch" 3 `remediation/p1-27-partner-identity` → p1-27-backend-partner-identity — "the P1-27-INT-025 Backend remediation, split out of the Frontend branch precisely so a Backend gate would see it. Listed BEFORE the general `remediation/p1-27-` rule below, because the first matching prefix wins and this one is longer" 4 `remediation/p1-27-` → p1-27-frontend — "P1-27 remediation branches are Frontend unless they declare otherwise above" 5 `docs/p1-27-` → p1-27-frontend — "a P1-27 documentation branch changes docs, which the Frontend profile permits, and must not change API source or the database any more than the phase itself may" 6 `tooling/no-fake-data-` → repository-tooling — "the no-fake-data guard belongs to no phase — it runs on every branch in four workflows — so it is declared under `repository-tooling` … Borrowing a phase profile would have declared nothing" 7 `feature/p1-26-` → p1-26-frontend — "the P1-26 Frontend branch" 8 `remediation/p1-15-` → p1-15-evidence-foundation — "the P1-OD-025 shared private/versioned evidence remediation is Backend and Database work … It gets its own profile rather than borrowing a phase's, because borrowing declares nothing and no existing profile permits exactly this surface" 9 `remediation/p1-18-` → p1-18-read-surface — "P1-18 Backend read-surface remediation branches — the P1-28 unblocking reads and close commands" 10 `remediation/p1-16-` → p1-18-read-surface — "P1-16 Backend read-surface remediation branches — the customer-vehicle read (P1-27-INT-012, the [MISSING R4] dependency of P1-28-FE-008), judged under the same Backend read-surface profile as its P1-18 siblings" 11 `feature/p1-28-` → p1-27-frontend 12 `p1-28/` → p1-27-frontend 13 `closure/p1-27-` → p1-27-frontend — "the P1-27 closure branch records the Owner acceptance — docs plus the guard files the closure was designed to lift, all inside the Frontend profile, exactly as closure/p1-26- declared for its phase" 14 `closure/p1-26-` → p1-26-frontend — "the P1-26 closure branch carries the same Frontend declaration" 15 `remediation/p1-28-owner-qa-backend` → p1-28-backend-owner-qa 16 `remediation/p1-28-` → p1-27-frontend 17 `fix/p1-28-` → p1-27-frontend — "P1-28 seal remediations cut from develop after PR #226 merged. They change the evidence machinery under scripts/ci and tests/ci and the phase records under docs, which is the same surface the P1-28 integration branch owns." 18 `chore/promotion-readiness` → repository-tooling — "A repository-wide GATE change owned by no phase: the ownership gate learning that a promotion is not a phase change, and the coverage floor learning that a promotion is not an edit." 19 `chore/ci-base-ref-resolvable` → repository-tooling — "the legacy workflow fetching the phase base branch so the evidence seal keeps the --not <base> term in its successor range." 20 `chore/absorb-merged-successors` → repository-tooling — "the evidence seal reading a develop-to-main promotion as the branch it promotes, rather than declining its merge ref …" 21 `chore/pre-p1-29-` → repository-tooling — "PRE-P1-29 governance and tooling branches: the ownership profiles themselves, the gates that read them, and the tests that prove those gates can still fail. Owned by no lane of the initiative." 22 `feature/pre-p1-29-backend-` → pre-p1-29-backend 23 `feature/pre-p1-29-web-` → pre-p1-29-web 24 `feature/pre-p1-29-multi-tenant-administration-rbac-workflow` → pre-p1-29-initiative Profile distribution across the 24: p1-27-frontend 9, repository-tooling 5, p1-26-frontend 2, p1-18-read-surface 2, and one each for p1-27-backend-partner-identity, p1-15-evidence-foundation, p1-28-backend-owner-qa, pre-p1-29-backend, pre-p1-29-web, pre-p1-29-initiative. NO rule matches any `p1-29`, `feature/p1-29-`, or `planning/` prefix.

_Evidence:_ `.github/ci-baselines/phase-ownership-profiles.json:6-127`; verified by `node -e "require('./.github/ci-baselines/phase-ownership-profiles.json').rules.length"` → `rules: 24`

### BUCKET vocabulary — 12 buckets, read from the classifier tests

**EXISTS AND LOAD-BEARING.**

Ordered, FIRST match wins (`classify()` at :705-708). Path patterns as written, not inferred from names: 1 `webGenerated` (:44-46) — the single literal path `apps/web/src/lib/api/idempotent-operations.ts`. Generator output; a bucket of its own so a Backend profile can allow it without opening the handwritten web tree. 2 `webContract` (:94-101) — six LITERAL paths, deliberately not a pattern: `apps/web/src/features/receptions/receptions-contract.ts`, `apps/web/tests/receptions-contract.test.ts`, `apps/web/src/features/appointments/appointments-contract.ts`, `apps/web/tests/appointments-contract.test.ts`, `apps/web/tests/p1-28-qa.test.ts`, `apps/web/tests/p1-28-security.test.ts`. Membership rule stated at :69-73: "the file is one half of a `toEqual(published)` pair". 3 `web` (:103) — `p.startsWith('apps/web/')` 4 `apiSource` (:104) — `p.startsWith('apps/api/src/')` 5 `apiConfig` (:105) — `p.startsWith('apps/api/')` (everything in the API workspace that is not `src/`) 6 `migrations` (:106) — `p.startsWith('supabase/migrations/')` 7 `dbSeeds` (:114) — `p.startsWith('supabase/seeds/')`. Split out because `supabase/seeds/04_iam_permission_catalog.sql` "IS the canonical permission catalogue — 112 rows, the only shipping insert into `iam.permissions`, and zero migrations write to that table" (:107-113). 8 `supabase` (:115) — `p.startsWith('supabase/')` (the residue: `config.toml`, `seed.sql`, the local harness) 9 `docs` (:116) — `p.startsWith('docs/')` OR `/^[A-Z]+\.md$/.test(p)` (so `README.md` is docs, not rootConfig, because this rule precedes rootConfig) 10 `tooling` (:117) — `p.startsWith('scripts/')` OR `p.startsWith('.github/')` 11 `tests` (:118) — `p.startsWith('tests/')` 12 `rootConfig` (:120-126) — `!p.includes('/')` OR `p.startsWith('.vscode/')` OR `p === 'Dockerfile'` OR `p === 'docker-compose.yml'` Fallback: anything matching none returns `'unclassified'` (:707), and `evaluate()` pushes a failure `unclassified changed file: <path> — decide where it belongs` (:807-809). An unclassified file is always a refusal.

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:37-127` (`export const CLASSIFIERS`); `node -e` over the exported array → `buckets: 12`

### PROFILES — all 12, with allowed and forbidden bucket lists

**EXISTS AND LOAD-BEARING.**

`allowed` DECIDES; `forbidden` is prose only (:129-144: "So `allowed` is the declaration and `forbidden` is the prose"). A bucket in neither list is still refused, with a generated reason (:817-819). • p1-26-frontend — allowed [web, webContract, docs, tooling, tests, rootConfig]; forbidden-with-prose {apiSource, apiConfig, migrations, supabase}; silently refused {webGenerated, dbSeeds} • p1-27-frontend — identical lists to p1-26-frontend (declared separately: "a phase that borrows another phase's profile is not declaring anything", :159-162) • p1-18-read-surface — allowed [apiSource, apiConfig, docs, tooling, tests, rootConfig, migrations, dbSeeds, supabase, webGenerated, webContract]; forbidden {web} • p1-15-evidence-foundation — same allowed set as p1-18-read-surface; forbidden {web} • p1-27-backend-partner-identity — allowed [apiSource, apiConfig, docs, tooling, tests, rootConfig]; forbidden {web, webContract, migrations, supabase}; silent {webGenerated, dbSeeds} • p1-28-backend-owner-qa — allowed [apiSource, migrations, docs, tooling, tests, rootConfig]; forbidden {web, webContract, webGenerated, apiConfig, supabase}; silent {dbSeeds} • repository-tooling — allowed [tooling, tests, docs, rootConfig]; forbidden {web, webGenerated, webContract, apiSource, apiConfig, migrations, supabase}; silent {dbSeeds} • api-boundary — allowed [apiSource, apiConfig, docs, tooling, tests, rootConfig, web, webContract]; forbidden {migrations, supabase}; silent {webGenerated, dbSeeds} • pre-p1-29-initiative — allowed [apiSource, migrations, dbSeeds, web, webGenerated, webContract, docs, tooling, tests, rootConfig]; forbidden {apiConfig, supabase} • pre-p1-29-backend — allowed [apiSource, migrations, dbSeeds, webGenerated, webContract, docs, tooling, tests, rootConfig]; forbidden {web, apiConfig, supabase} • pre-p1-29-web — allowed [web, webContract, docs, tooling, tests, rootConfig]; forbidden {apiSource, apiConfig, webGenerated, migrations, dbSeeds, supabase} • backend-login-contract — allowed [apiSource, apiConfig, docs, tooling, tests, rootConfig]; forbidden {web, webContract, migrations, supabase}; silent {webGenerated, dbSeeds} Note: NO profile allows every bucket. `supabase` (the harness) is allowed by only p1-18-read-surface and p1-15-evidence-foundation; `apiConfig` by only those two plus p1-27-backend-partner-identity, api-boundary and backend-login-contract — all three PRE-P1-29 profiles forbid it.

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:145-468`; enumerated programmatically via the exported `PROFILES`

### Two profiles are defined but reachable from no committed rule

**EXISTS BUT NOT USED.**

`api-boundary` and `backend-login-contract` are historic (the pre-P1-26 API boundary remediation and the P1-26 login-identity remediation). Their prefixes were removed from the map but the profiles remain. They are selectable only by hand: `PHASE_OWNERSHIP_PROFILE=api-boundary npm run validate:phase-ownership`. The test at `tests/ci/phase-ownership.test.ts:1015-1032` proves the map → profile direction only (every rule resolves to a defined profile); nothing proves the reverse, so an orphan profile is not a gate failure.

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:328` (`api-boundary`) and `:451` (`backend-login-contract`); neither name appears in `.github/ci-baselines/phase-ownership-profiles.json` (`node -e` profile histogram over the 24 rules lists 10 profile names, not 12)

### Profile resolution — the positional argv default

**EXISTS AND LOAD-BEARING.**

Precedence is argument → environment → literal default. The default profile is the string `p1-26-frontend` and the default base is `origin/develop`. The docblock at :901-925 is explicit that this fallback "governs only a HAND run with no argument and no environment … in CI nothing is defaulted, and an unmapped branch is refused", and that the fallback was kept only so `npm run validate:phase-ownership` still works for a developer debugging the gate. `package.json:120` defines `validate:phase-ownership` as `node scripts/ci/check-phase-ownership.mjs` with NO argument, so a bare local run of that script judges the branch against `p1-26-frontend` — which forbids `apiSource`, `apiConfig`, `migrations` and `supabase`.

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:926-927`: `const profileName = process.argv[2] ?? process.env.PHASE_OWNERSHIP_PROFILE ?? 'p1-26-frontend';` / `const base = process.argv[3] ?? process.env.PHASE_OWNERSHIP_BASE ?? 'origin/develop';`

### Profile resolution — the environment variables

**EXISTS AND LOAD-BEARING.**

Two distinct env surfaces. The GATE proper reads `PHASE_OWNERSHIP_PROFILE` and `PHASE_OWNERSHIP_BASE`. `--resolve-context` reads `HEAD_BRANCH`, `BASE_REF`, `OWNERSHIP_EVENT_NAME ?? GITHUB_EVENT_NAME`, `OWNERSHIP_REF_NAME ?? GITHUB_REF_NAME` and WRITES the first pair out as a sourceable env file. Register rationale for `PHASE_OWNERSHIP_PROFILE` at `scripts/ci/check-command-coverage.mjs:508-511`: "Takes a profile and a base ref, so it cannot run from the repository-wide aggregate: the profile is a property of the BRANCH, not of the repository."

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:926-927` (`PHASE_OWNERSHIP_PROFILE`, `PHASE_OWNERSHIP_BASE`); `:847-851` (`OWNERSHIP_EVENT_NAME`/`GITHUB_EVENT_NAME`, `OWNERSHIP_REF_NAME`/`GITHUB_REF_NAME`, `HEAD_BRANCH`, `BASE_REF`)

### Profile resolution — `--resolve-context`, the five-outcome decision

**EXISTS AND LOAD-BEARING.**

Checked before argv[2] is read as a profile name (:899). Outcomes: • head+base both present, head is `develop`/`main` → `declared-skip` (a PROMOTION; :607-621) — "DECLARED SKIP — nothing was checked, and this run is not evidence that it was." • head+base both present, ordinary head → `check`, base `origin/<baseRef>` (:623) • exactly one of head/base present → `refuse` — "this is a wiring defect in the calling workflow" (:629-634) • event is `pull_request`/`pull_request_target` with neither ref → `refuse` (:636-643) • empty event name → `refuse` (:645-650); empty ref name → `refuse` (:652-657) • push/dispatch on a protected ref (`develop`, `main`, frozen at :494) → `declared-skip` (:659-672) • push/dispatch on an ordinary ref → `check` against `DEFAULT_BASE = 'origin/develop'` (:506, :676) Outputs: `--env-out <file>` writes `OWNERSHIP_ACTION`/`OWNERSHIP_PROFILE`/`OWNERSHIP_BASE`, POSIX single-quoted (:686-699); `--json <file>` writes the record incl. `checked:false`; the verdict is appended to `GITHUB_STEP_SUMMARY` (:881-887). `refuse` exits 1 (:889-892). Every value is validated against `SAFE_VALUE = /^[A-Za-z0-9._/-]+$/` (:515).

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:577-677` (`decideOwnershipRun`), CLI at `:833-894`

### unmappedPolicy — FAIL, and it fires

**EXISTS AND LOAD-BEARING.**

The JSON states it verbatim: "FAIL. A branch that matches no rule is refused, and the message says to add a rule. The alternative — a permissive default — is how `check-phase-ownership.mjs` came to judge every branch against `p1-26-frontend`, including Backend branches the profile cannot pass. Declaring what a branch is allowed to change is a one-line diff and is the whole point of the gate." The refusal text I measured: "branch `feature/p1-29-diagnostics` declares no changed-file ownership profile. Add a rule to .github/ci-baselines/phase-ownership-profiles.json saying which parts of the repository this branch is allowed to change. Refusing to judge it against another phase's declaration…". An EMPTY rules array is also refused (:533-538) — "An empty map is a broken map, not a permissive one."

_Evidence:_ `.github/ci-baselines/phase-ownership-profiles.json:5`; implemented at `scripts/ci/check-phase-ownership.mjs:545-552`. Live run: `OWNERSHIP_EVENT_NAME=push OWNERSHIP_REF_NAME=feature/p1-29-diagnostics node scripts/ci/check-phase-ownership.mjs --resolve-context` → `changed-file ownership: REFUSE … EXIT=1`

### The CI workflow that invokes the gate — exactly one

**EXISTS AND LOAD-BEARING.**

Invocation quoted verbatim (`_reusable-node-quality.yml:338-359`): `yaml - name: Changed-file ownership if: inputs.task == 'static-quality' env: HEAD_BRANCH: ${{ inputs.head-branch }} BASE_REF: ${{ inputs.base-ref }} OWNERSHIP_EVENT_NAME: ${{ github.event_name }} OWNERSHIP_REF_NAME: ${{ github.ref_name }} run: | set -euo pipefail node scripts/ci/check-phase-ownership.mjs --resolve-context \ --env-out ownership-context.env \ --json phase-ownership-context.json . ./ownership-context.env if [ "${OWNERSHIP_ACTION}" = "check" ]; then PHASE_OWNERSHIP_PROFILE="${OWNERSHIP_PROFILE}" \ PHASE_OWNERSHIP_BASE="${OWNERSHIP_BASE}" \ npm run validate:phase-ownership fi ` `phase-ownership-context.json` is uploaded in the evidence artefact (`:859`). The step's history is recorded in the workflow itself at `:304-337`: "`validate:phase-ownership` existed, was correct, and was invoked by NO CI job: a grep of `.github/` for `phase-ownership` returned nothing and never had." (P1-27-DO-003.)

_Evidence:_ `.github/workflows/_reusable-node-quality.yml:338-359`; `grep -rn "phase-ownership" .github/` returns hits in only this workflow, `pr-ci.yml` (a comment at :162-165) and the baseline JSON

### pr-ci.yml — the pull-request caller

**EXISTS AND LOAD-BEARING.**

`yaml static-quality: name: static-quality needs: change-detection uses: ./.github/workflows/_reusable-node-quality.yml with: task: static-quality ref: ${{ needs.change-detection.outputs.head-sha }} base-ref: ${{ github.event.pull_request.base.ref }} head-branch: ${{ github.event.pull_request.head.ref }} ` with the comment "A branch that matches no rule is refused rather than judged against another phase's declaration (P1-27-DO-003)." `pr-ci.yml` triggers on `pull_request: branches: [develop, main]` and `workflow_dispatch` (`:28-31`). `tests/ci/phase-ownership.test.ts:1107` ("every pull-request caller of static-quality passes both refs") holds this wiring.

_Evidence:_ `.github/workflows/pr-ci.yml:154-166`

### protected-develop-verification.yml — the caller that deliberately passes neither ref

**EXISTS AND LOAD-BEARING.**

`yaml static-quality: name: static-quality uses: ./.github/workflows/_reusable-node-quality.yml with: task: static-quality artifact-retention-days: 30 ` No `head-branch`, no `base-ref`. On a push to `develop` or `main` this resolves to the protected-branch DECLARED SKIP, not a check — "a protected branch is the union of every phase that has landed, so no profile could describe it and there is no base to diff against" (`check-phase-ownership.mjs:665-670`). Consequence for a P1-29 plan: the ownership gate is answered ONLY on the pull request, never on the protected push.

_Evidence:_ `.github/workflows/protected-develop-verification.yml:78-83`

### P1-28 precedent for a MIXED phase — five prefixes, four Frontend and one Backend

**EXISTS AND LOAD-BEARING.**

1 `feature/p1-28-` → **p1-27-frontend** — "the P1-28 Frontend integration branch — the same Frontend surface rules as P1-27: apps/web, docs, tooling, tests and root config only" 2 `p1-28/` → **p1-27-frontend** — "the P1-28 Frontend working branches, same declaration as the integration branch" 3 `remediation/p1-28-owner-qa-backend` → **p1-28-backend-owner-qa** 4 `remediation/p1-28-` → **p1-27-frontend** — "P1-28 remediation branches are Frontend unless they declare otherwise above — the same rule `remediation/p1-27-` states for its phase, and the same Frontend surface the P1-28 integration branch owns: apps/web, docs, tooling, tests and root config only" 5 `fix/p1-28-` → **p1-27-frontend** — "P1-28 seal remediations cut from develop after PR #226 merged. They change the evidence machinery under scripts/ci and tests/ci and the phase records under docs, which is the same surface the P1-28 integration branch owns." Note that P1-28 declared NO profile of its own for the Frontend half: it reused `p1-27-frontend` by name. Only the Backend exception got a new profile.

_Evidence:_ `.github/ci-baselines/phase-ownership-profiles.json:57-91` (rules 11, 12, 15, 16, 17)

### Why the longer P1-28 prefix is listed first — the `why` quoted in full

**EXISTS AND LOAD-BEARING.**

Rule 15's `why`, verbatim: "the DBCR-P1-28-001 Backend remediation Owner QA forced — the damage-map revision made mandatory in the database instead of trusted from a compliant Frontend, and the read field that lets Reception tell `never published` from `published and retired`. **Listed BEFORE the general `remediation/p1-28-` rule below, because the first matching prefix wins and this one is longer.** Its own profile rather than `p1-18-read-surface`, which would also have permitted the diff: that profile describes new GET routes and close commands, and this branch publishes no operation, so borrowing it would have declared nothing". The file's own `howItIsUsed` (`:4`) states the mechanism: "resolves the head branch against `rules` in order … The FIRST matching prefix wins, so a longer prefix must be listed before a shorter one." The identical reasoning appears at rule 3 (`remediation/p1-27-partner-identity`, `:20`): "Listed BEFORE the general `remediation/p1-27-` rule below, because the first matching prefix wins and this one is longer". The implementation is `Array.prototype.find` over the rules in file order — there is no longest-prefix sort, so ordering is the ONLY protection.

_Evidence:_ `.github/ci-baselines/phase-ownership-profiles.json:80`; the ordering semantics at `:4` and `scripts/ci/check-phase-ownership.mjs:539-544` (`rules.find(... branch.startsWith(r.branchPrefix))`)

### PRE-P1-29 precedent — a three-way split, plus a fourth governance rule

**EXISTS AND LOAD-BEARING.**

Prefixes: • `chore/pre-p1-29-` → **repository-tooling** — "PRE-P1-29 governance and tooling branches: the ownership profiles themselves, the gates that read them, and the tests that prove those gates can still fail. Owned by no lane of the initiative." (This is the prefix PR #259 used, the commit this worktree sits on.) • `feature/pre-p1-29-backend-` → **pre-p1-29-backend** — "The Backend lane of PRE-P1-29. Listed BEFORE the initiative branch so a lane branch is judged by its lane rather than by the wider integration profile — first match wins, and the narrower rule must be reachable." • `feature/pre-p1-29-web-` → **pre-p1-29-web** — "The Web lane of PRE-P1-29, for the same reason and in the same order as the Backend lane above." • `feature/pre-p1-29-multi-tenant-administration-rbac-workflow` → **pre-p1-29-initiative** — "The PRE-P1-29 initiative integration branch. **The FULL branch name and not a shorter prefix, deliberately**: a prefix such as feature/pre-p1-29- would also swallow both lane branches above and grant each of them the other half of the product, which is the hole the lanes exist to close." The design rationale for three profiles is stated at `check-phase-ownership.mjs:345-371`: "THREE profiles rather than one, because a single profile spanning everything forbids nothing and therefore declares nothing. The lanes below keep each pull request answerable to one review boundary — a Backend change cannot carry the screens that consume it, and a Web change cannot carry the contract it renders. The initiative profile exists for the long-lived integration branch that receives both."

_Evidence:_ `.github/ci-baselines/phase-ownership-profiles.json:107-126`; profile block `scripts/ci/check-phase-ownership.mjs:345-450`

### pre-p1-29-backend — allowed and forbidden buckets

**EXISTS AND LOAD-BEARING.**

allowed: [apiSource, migrations, dbSeeds, webGenerated, webContract, docs, tooling, tests, rootConfig]. forbidden: web — "the PRE-P1-29 Backend lane is Backend-only — the screens are a separate change under pre-p1-29-web"; apiConfig — "PRE-P1-29 must not change API workspace configuration"; supabase — "PRE-P1-29 must not change the database HARNESS — the permission catalogue it does need is supabase/seeds, which travels under its own dbSeeds bucket". The `web` refusal carries the precedent explicitly (:414-419): "Forbidden ON PURPOSE, on the `p1-18-read-surface` precedent: a Backend lane that also permitted the handwritten Frontend would let both halves of an administration contract land in one unreviewed commit. The generated manifest travels under `webGenerated`, and a published `rec.*`/`apt.*` operation may correct its mirror row under `webContract` — neither opens a screen, a route or an adapter."

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:398-428`

### pre-p1-29-web — allowed and forbidden buckets

**EXISTS AND LOAD-BEARING.**

allowed: [web, webContract, docs, tooling, tests, rootConfig] — the same six as `p1-27-frontend`. forbidden: apiSource — "route it through the Backend lane, so no screen ships against a contract nobody reviewed"; apiConfig; webGenerated — "the idempotent-operations manifest is GENERATED from the Backend register — a screen that hand-edits it desynchronises the two, and the register is not on this side of the lane"; migrations — "a screen must not carry a migration — a permission the UI offers is seeded by the Backend lane that publishes the operation behind it"; dbSeeds — "a screen must not seed a permission — the code a role editor offers is seeded by the Backend lane that publishes the operation it guards"; supabase. This is the only profile in the file that names all six of its refusals explicitly, leaving nothing to silent refusal.

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:429-450`

### pre-p1-29-initiative — allowed and forbidden buckets

**EXISTS AND LOAD-BEARING.**

allowed: [apiSource, migrations, dbSeeds, web, webGenerated, webContract, docs, tooling, tests, rootConfig] — the union of both lanes. forbidden: apiConfig — "a dependency or compiler change is its own review, not a rider on an administration feature"; supabase — "must not change the database HARNESS — config.toml and the local bootstrap. The permission catalogue it does need is supabase/seeds, which travels under its own dbSeeds bucket, and the Owner acceptance fixtures live under scripts/dev/owner-acceptance". It refuses exactly two of the twelve buckets. Its stated purpose is the long-lived integration branch that RECEIVES both lanes — not a working branch.

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:372-397`

### What the three-way split implies for a mixed phase like P1-29

**EXISTS AND LOAD-BEARING.**

Three facts the repository already committed to, which a P1-29 branch plan inherits: 1. A single profile that spans the product is a non-declaration — "a single profile spanning everything forbids nothing and therefore declares nothing". The initiative profile exists ONLY for the integration branch, never for a working branch. 2. Lane branches must be listed BEFORE the integration branch, and the integration branch must be pinned by its FULL name, or the wide profile swallows the narrow ones — the file says so in rule 24's own `why`. 3. Neither lane can carry the other half: `pre-p1-29-backend` forbids `web`, `pre-p1-29-web` forbids `apiSource`/`migrations`/`dbSeeds`. Both permit `webContract` and only the Backend lane permits `webGenerated`. The frozen P1-29 preparation set draws the same conclusion independently at `blocker-register.md:220`: "**separate Backend and Frontend branches with separate profiles, the longer prefix declared first** — not one permissive mixed profile. Declare both rules **in the first commit that opens a P1-29 branch**". It also records that this was "Deliberately **not** done on this planning branch: a preparation slice may not change CI behaviour."

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:345-371` and `:125` of the profiles JSON; corroborated by the frozen prep set at `C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco-worktrees/p1-29-prep/docs/phase-1/phase-1-29/blocker-register.md:220` (`INS-49`)

### The `planning/` prefix is refused today — the frozen prep branch says so about itself

**MISSING.**

The prep set records the refusal openly: "One gate is deliberately not satisfied. `check-phase-ownership` **refuses** this branch: no rule in `.github/ci-baselines/phase-ownership-profiles.json` matches a `planning/` prefix, and `unmappedPolicy` is `FAIL`. Adding that rule is a CI-behaviour change, which a preparation slice may not make. The change surface itself passes — judged against a Frontend profile it is 14 changed files and 0 violations." Recorded as `INS-49`. This worktree's own checked-out branch is `planning/pre-p1-29-remaining-waves-and-p1-29-a0` (`git rev-parse --abbrev-ref HEAD`), which is likewise unmapped.

_Evidence:_ No `planning/` rule in `.github/ci-baselines/phase-ownership-profiles.json` (24 rules enumerated above); `C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco-worktrees/p1-29-prep/docs/phase-1/phase-1-29/README.md:111-117`

### Structural invariants any NEW profile or rule must satisfy

**EXISTS AND LOAD-BEARING.**

Three tests bind a P1-29 branch/profile addition: 1. `:1015-1032` — "every profile the map can select is one the ownership gate defines": for each committed rule, `decideOwnershipRun({headBranch: prefix+'sample', ...})` must return `action: 'check'` AND the resolved profile must be a key of `PROFILES`. A rule naming a profile that does not exist fails here, not at runtime. 2. `:682-695` — every profile must name `webContract` in `allowed` or in `forbidden`: "`${name} neither allows nor forbids webContract`". A new profile that ignores the bucket fails the suite. (The same test's comment notes the general rule is NOT enforced for other buckets — silence about `dbSeeds` or `webGenerated` is permitted and currently used by six profiles.) 3. `:717-718` — `webContract` must sort before `web` in `CLASSIFIERS`. Also `:1107` and `:1135` — every pull-request caller of `static-quality` must pass both refs, and of `web-quality` must pass `base-ref`.

_Evidence:_ `tests/ci/phase-ownership.test.ts:682-695` and `:1015-1032`; `:717-718`

### Obligation — the command register (`validate:command-coverage`)

**EXISTS AND LOAD-BEARING.**

Four proofs (`:22-32`): every script in every workspace appears in `REGISTER`; every register entry names a script that still exists; every `required` command is reachable from `verify:workspaces` by following `npm run` edges; every `required` and `ci-only` command is invoked by at least one hosted workflow. Tier vocabulary is closed to five words (`TIERS`, `:82-88`) — an unrecognised tier is silently "not a gate", which is why the list is enforced. Practical consequence for a P1-29 branch: **any new npm script forces a register entry in the same commit**, and if it is `required` it must additionally be wired into an aggregate AND a hosted workflow before CI can go green.

_Evidence:_ `scripts/ci/check-command-coverage.mjs:22-34, 82-94, 96+`; `package.json` `verify:policies` includes `validate:command-coverage`

### Obligation — the local run ledger (`validate:p1-27-closing-values`)

**EXISTS AND LOAD-BEARING.**

The ledger is the only authority for an executed-test total, and it EXPIRES rather than ages. Three failure modes, all `RUN_RECORD_STALE`: (a) the record names no 40-char commit; (b) the repository cannot resolve that commit; (c) `executableChangesSince(<commit>)` is non-empty — "the `<tier>` run was taken at <sha> and N executable path(s) have changed since". A fourth, `RUN_RECORD_FILE_COUNT_DISAGREES`, compares the recorded file count against a walk of the tree. Today both tiers sit at `fa35e3ee` with zero executable drift, so develop is green. **The first executable change on a P1-29 branch turns this red**, and the only repair is `node scripts/ci/check-p1-27-closing-values.mjs --record unit` and `--record web` run locally on a clean tree — which requires actually running both suites. The gate runs inside `verify:policies`, so it runs on every branch, not just P1-27's.

_Evidence:_ `scripts/ci/check-p1-27-closing-values.mjs:104` (`RUN_LEDGER_PATH`), `:871-931` (`judgeRunLedger`), `:1417-1418` (`--record`); live run on develop → `0 problem(s)` exit 0; `node -e` over `docs/phase-1/phase-1-27/evidence/local-run-ledger.json` → `unit {at: fa35e3ee…, files: 105}`, `web {at: fa35e3ee…, files: 102}`; `executableChangesSince('fa35e3ee…')` at HEAD → `count 0`

### Obligation — derived doc-count markers (`validate:p1-27-doc-counts`)

**EXISTS AND LOAD-BEARING.**

Fourteen counts are derived from the filesystem and reconciled against `<!-- derived: files <key> = <n> -->` markers in the P1-27 phase documents and `docs/product`. Keys include `scripts/ci` (.mjs), `tests/ci` (.test.ts/.tsx), `tests/db`, `tests/db:all`, `tests/backend`, `tests/backend:all`, `apps/web/tests`, `apps/web/scripts`, `supabase/migrations` (.sql), `apps/web/src/features/crm`, `apps/web/src/features/vehicles`, plus three gate-internal counts. Current committed values match the tree: `scripts/ci = 54`, `tests/ci = 53`, `supabase/migrations = 124`, `apps/web/tests = 102` (verified: `ls scripts/ci/*.mjs | wc -l` → 54, `ls tests/ci/*.test.ts | wc -l` → 53). A P1-29 branch adding one migration, one CI script or one web test must move the corresponding marker in the SAME commit.

_Evidence:_ `scripts/ci/check-p1-27-doc-counts.mjs:424-451` (`deriveCounts`); markers at `docs/phase-1/phase-1-27/deliverable-manifest.md:974-986`, and further copies in `open-decisions.md:1204`, `owner-acceptance-fail-remediation.md:197`, `risk-register.md:580-582`

### Obligation — the documented CI inventory (`tests/ci/documented-counts.test.ts`)

**EXISTS AND LOAD-BEARING.**

Six phrases must appear verbatim in `pull-request-body.md`, derived at test time from the filesystem: `**10 reusable workflows**`, `**7 top-level workflows**`, `**1 composite action**`, `**54 scripts in \`scripts/ci\`**`, `**14 baselines**`, `**25 documents**`. All six verified live (`ls .github/workflows`→ 17 files = 10`_reusable-_`+ 7 top-level;`ls .github/ci-baselines/_.json | wc -l`→ 14;`find docs/engineering/ci-automation -name '*.md' | wc -l`→ 25). A seventh phrase governs pr-ci:`**14 governed jobs plus \`ci-gate\` = 15**` (`:86-88`), derived from the YAML's own top-level job keys. Consequence: adding ONE file to `scripts/ci`, `.github/ci-baselines`, `.github/workflows`or`docs/engineering/ci-automation`reddens this test until the prose is corrected in the same commit — and adding a`scripts/ci`file also moves the`derived: files scripts/ci` marker above, so it is two documents, not one.

_Evidence:_ `tests/ci/documented-counts.test.ts:60-96`; the record it reads is `docs/engineering/ci-automation/pull-request-body.md:62-64, 88`

### Obligation — `minTests` floors per tier

**EXISTS AND LOAD-BEARING.**

"Only `minTests` is enforced — summarise-vitest.mjs fails a tier that runs fewer. `measured` is provenance." `howToRaise`: "Raise a floor in the same commit that adds the tests. Lowering one is also a reviewable diff — state why in the commit message." Note the known trap recorded in the frozen prep set (`test-and-acceptance-plan.md:267`): skipped tests count toward a tier total, so a `minTests` floor can be satisfied by skips. Also note the `web` tier's `measurementProvenance` (`:34`) states its 2581 figure is LOCAL and "weaker than a hosted figure", replaced by "the next HOSTED `Web quality / web-quality` run of this branch".

_Evidence:_ `.github/ci-baselines/test-count-baseline.json`; `node -e` over it → unit 1050, database 1550, backend 1300, web 2500; `enforcementNote`

### Obligation — the coverage ratchet, critical floors and touched-file floor

**EXISTS AND LOAD-BEARING.**

Three rules in order of strictness: (1) GLOBAL RATCHET — no metric may fall below the recorded baseline by more than `tolerancePercentagePoints`; (2) CRITICAL FLOORS — named modules must hold an absolute minimum; (3) TOUCHED-FILE FLOOR — "a production file changed by this pull request must not be materially uncovered. A large global number cannot buy a new untested file." The touched-file floor depends on `base-ref` reaching `web-quality`; `pr-ci.yml:175-181` documents that its earlier absence made the 60% floor "govern nothing while every job stays green". A P1-29 branch adding new production files under `apps/web` or `apps/api` pays the touched-file floor per file, not on average.

_Evidence:_ `scripts/ci/coverage-gate.mjs:9-22`; baselines `.github/ci-baselines/coverage-baseline.unit.json`, `coverage-baseline.web.json`, `coverage-baseline.backend.json`; `.github/workflows/pr-ci.yml:175-190`

### Obligation — the P1-28 seal is ARCHIVED, so a new branch owes it no re-freeze

**EXISTS AND LOAD-BEARING.**

Archival is computed from five facts, never declared (`phase-seal-lifecycle.md:54-60`): A verdict is exactly `OWNER ACCEPTANCE: PASS`; B candidate commit exists; C it still names the recorded tree; D `git merge-base --is-ancestor <sha> main`; E closure record reports CLOSED. I confirmed D independently: `git merge-base --is-ancestor e8a4200d… origin/main` → true. What archival stops (`§5`): the live-tree-equals-candidate rule across `apps/**` and `supabase/**`, and the requirement that later executable commits be named as successors. **This is the single largest thing a P1-29 branch does NOT owe.** What it does not stop (`§6`): the 19-document digest manifest, the task matrix, tier figures and unclosed-task set stay judged — so editing anything under `docs/phase-1/phase-1-28/` still requires regenerating the manifest (`npm run evidence:p1-28`) in the same commit.

_Evidence:_ `node scripts/ci/build-p1-28-evidence-manifest.mjs --check` on this checkout → `::notice::P1-28 is ARCHIVED — accepted, and the accepted candidate e8a4200d is contained in \`main\` (25705d84). The historical package is judged; the current product tree is not held to it.`…`EXIT=0`. Lifecycle spec: `docs/governance/phase-seal-lifecycle.md:48-95`

### Obligation — adding a CI job costs a three-list reconciliation

**EXISTS AND LOAD-BEARING.**

`tests/ci/ci-gate.test.ts` reconciles three lists — the YAML top-level job keys, the gate job's `needs`, and `DECLARED_JOBS` — so "a job cannot run unwatched and the gate cannot declare a job that does not exist" (`pr-ci.yml:346-349`). `evaluate-ci-gate.mjs:153-165` fails both directions: a declared job absent from `needs`, and a present job the gate does not declare. Six of the fourteen are `alwaysRequired: true` (change-detection, static-quality, unit-tests-coverage, web-quality, dependency-security, secret-scan) plus hosted-clean-room and authenticated-browser; the rest are conditional on change classification. `authenticated-browser` has the single recognised excuse, `securityEligibility: same-repository head`, recorded as `NOT_ELIGIBLE_FOR_SECURITY_REASON` and never rounded up to a pass.

_Evidence:_ `scripts/ci/evaluate-ci-gate.mjs:66-101` (`DECLARED_JOBS`) and `:149-165`; `.github/workflows/pr-ci.yml:341-364` (`ci-gate.needs`); `.github/workflows/protected-develop-verification.yml:204-211`

### Merge model — ADR-006, the branching decision

**EXISTS AND LOAD-BEARING.**

Two permanent branches, never deleted. Every unit of work is a short-lived branch cut from `develop` with a type prefix, deleted after merge (`:43`). "All pull requests target `develop`. No pull request targets `main` except a deliberate release promotion of `develop` into `main`." (`:45`). "`main` never receives direct implementation commits." (`:47`). One authorised exception: root commit `a6e0af4` (`:49`). The 2026-07-16 status update (`:7-15`) records that branch rules ARE applied in the GitHub UI and that required approving reviews are temporarily **0** under the Solo Developer Review Policy, while "pull requests, required CI checks, conversation resolution, force-push blocking, and branch-deletion blocking remain mandatory". The 2026-07-17 update (`:115-122`) makes the author's merge of a routine phase PR into `develop` with CI green the recorded technical approval event; promotion to `main` remains a joint founder decision. §51 ("Enforcement status … not applied") is superseded by the 2026-07-16 header update and by the ruleset records below — the ADR body was never rewritten.

_Evidence:_ `docs/adr/ADR-006-git-branching-and-protected-main.md:41-51, 115-122`

### Merge model — the applied rulesets: merge-commit only, required checks, zero bypass

**AMBIGUOUS IN DOCS.**

MERGE-COMMIT RULE. `develop`'s ruleset (`19896821`) permits `merge` ONLY — "Allowed merge methods | `merge`, `squash`, `rebase` | **`merge` only**" (`gate-record.md:150`), restated at `phase-1-23/promotion-record.md:29` and `phase-1-24/promotion-record.md:129` ("`merge` — the only method the ruleset permits"). `main`'s ruleset (`19896793`) still permits `["merge","squash","rebase"]`, so a promotion passes `merge` EXPLICITLY rather than relying on the ruleset (`pre-p1-22-main-promotion/main-promotion.md:32-39`, `phase-1-23/promotion-record.md:30-31`). Rationale (`branch-ruleset.md:39`): "ADR-006; squash or rebase would rewrite the reviewed SHA and break tree-identity verification." REQUIRED CHECKS — this is where the record is inconsistent, see ambiguities. `gate-record.md:151` records develop at **5** contexts: the four legacy `ci.yml` job names (`Lint, types, tests, build`, `Docker build validation`, `Database migrations and RLS tests`, `Secret and sensitive-file scan`) **plus `ci-gate`**. `main`'s four are the same legacy names, with `ci-gate` running but not required (`main-promotion.md:43-52`). `phase-1-28/evidence/closure-evidence.md:666` calls `ci-gate` "**the single required check**". OTHER SETTINGS (`gate-record.md:147-155`): pull request required yes; strict (up-to-date) **false** on develop, retained; deletion blocked; force push blocked; **bypass actors: none → none**. `post-p1-22-main-promotion/README.md:188-191`: "Both `develop` and `main` carry `deletion`, `non_fast_forward` and `pull_request` rules, so force pushes, branch deletion and direct pushes are structurally blocked." No merge queue (`branch-ruleset.md:41`). `protected-gate` is **not** a required check — "it runs _after_ the merge. It is the run a gate record cites" (`branch-ruleset.md:43-45`).

_Evidence:_ `docs/engineering/ci-automation/gate-record.md:142-165` (ruleset migration table); `docs/engineering/ci-automation/branch-ruleset.md:23-45`; `docs/engineering/releases/pre-p1-22-main-promotion/main-promotion.md:28-55`; `docs/engineering/releases/post-p1-22-main-promotion/README.md:186-191`; `docs/phase-1/phase-1-28/evidence/closure-evidence.md:666`

### Promotion source is enforced in code, not by the ruleset

**EXISTS AND LOAD-BEARING.**

"The branch ruleset cannot express it either: GitHub rulesets constrain the TARGET ref, not the source of a pull request. So the rule is asserted here, in the one place that sees both refs." `PROMOTION_SOURCE = 'develop'`, `PROMOTION_TARGET = 'main'`, both hard-coded deliberately: "A configurable source branch would let the policy be relaxed by editing a value rather than by amending the ADR." Only PRs whose base is `main` are constrained; everything targeting `develop` is unaffected. It fails CLOSED on an unresolvable event. "An emergency exception is deliberately NOT implemented." Because it runs in `change-detection`, which is in `ci-gate.needs`, the refusal propagates to the single gate before any expensive job starts (`pr-ci.yml:85-86`).

_Evidence:_ `scripts/ci/check-promotion-source.mjs:11-46, 61-96`; invoked at `.github/workflows/pr-ci.yml:87-93` inside `change-detection`

### The gate's own anti-vacuity rules — an empty diff and a sync merge

**EXISTS AND LOAD-BEARING.**

Relevant to a P1-29 promotion/sync plan. An empty changed-file list is a FAILURE ("a broken comparison rather than a clean result") unless the merge base and HEAD name the same tree object, in which case `counts.unchanged = 1` and the branch passes. The case that forced it (`:780-785`): "a SYNC MERGE — protected `main` merged into `develop` so a promotion can satisfy its up-to-date rule. Such a merge changes zero files by construction, and changing zero files is precisely what makes it safe. Refusing it as a broken comparison would have required inventing a file change to satisfy a gate." A `null` answer from Git is treated as not-established and fails closed. The diff itself is `git diff --name-only -M --diff-filter=ACMRD <base>...HEAD` (`:931-938`) — merge-base to head, and rename-aware.

_Evidence:_ `scripts/ci/check-phase-ownership.mjs:730-739` (`emptyDiffAgreesWithTrees`), `:767-802`

---

## Unknowns — what could not be settled, and what would settle it

- The LIVE GitHub ruleset state for `develop` (`19896821`) and `main` (`19896793`): the current `required_status_checks` context list, `strict` flag, `allowed_merge_methods`, and `bypass_actors`. Nothing in the repository is authoritative for these — they are platform settings. SETTLED BY: `gh api repos/Ezzaldeen-Albitar/RootLco/rulesets` and `gh api repos/Ezzaldeen-Albitar/RootLco/rulesets/19896821` with an authenticated token (memory records `gh` is installed off-PATH and a token is obtainable via `git credential fill` → `GH_TOKEN`). Until that is run, treat `gate-record.md:147-155` as the last recorded applied state and the P1-28 closure claim as unverified.
- Whether the four legacy `ci.yml` contexts are still required on either branch, i.e. whether rollout step 10's first half was executed. SETTLED BY: the same ruleset query. Also relevant: `.github/workflows/ci.yml` still exists, so step 10's second half certainly was not.
- Which branch prefixes a P1-29 branch plan should actually claim. No `p1-29`, `feature/p1-29-` or `planning/` rule exists. The P1-28 shape suggests `feature/p1-29-` + `p1-29/` for the Frontend integration and working branches plus a longer, earlier Backend prefix; the PRE-P1-29 shape suggests two named lanes plus a full-name-pinned integration branch. This is a DECISION, not a fact the repository holds. SETTLED BY: an owner/architecture decision recorded before the first P1-29 commit — the profiles file's own `unmappedPolicy` says "Declaring what a branch is allowed to change is a one-line diff", and `INS-49` says to declare it in the first commit that opens the branch.
- Whether P1-29 will need the `apiConfig` bucket (`apps/api/package.json`, `apps/api/tsconfig.json`). All three PRE-P1-29 profiles forbid it, and `p1-28-backend-owner-qa` forbids it; only `p1-18-read-surface`, `p1-15-evidence-foundation`, `p1-27-backend-partner-identity`, `api-boundary` and `backend-login-contract` permit it. If a P1-29 Backend slice adds a runtime dependency, a new profile must claim it or the change must be split. SETTLED BY: reading the P1-29 Backend slice designs in the frozen prep set (`implementation-slices.md`, `backend-prerequisite-gate.md`) for any new npm dependency.
- Whether P1-29 will need the `supabase` (harness) bucket. Only two profiles permit it, and every PRE-P1-29 profile refuses it on the stated ground that permissions are seeded by MIGRATIONS and Owner-acceptance fixtures live under `scripts/dev/owner-acceptance/` (tooling). SETTLED BY: checking whether any P1-29 slice needs `supabase/config.toml` or `supabase/seed.sql`.
- The exact cost of the run-ledger re-record on a P1-29 branch. `local-run-ledger.json` currently pins `unit` at 105 files and `web` at 102 files, both at `fa35e3ee`, with zero executable drift at develop. The number of tests each tier must then report, and whether the new totals clear the `minTests` floors (unit 1050, web 2500), cannot be known before the branch exists. SETTLED BY: running `node scripts/ci/check-p1-27-closing-values.mjs --record unit` and `--record web` on a clean tree after the branch's first executable commit — note this WRITES to the ledger, so it was not done here.
- Whether the P1-29 Frontend half can reuse `p1-27-frontend` by name (the P1-28 precedent, four of five prefixes) or needs its own profile. The file's own repeated reasoning cuts both ways: `:159-162` says "a phase that borrows another phase's profile is not declaring anything", yet P1-28 borrowed it anyway for four prefixes and the rules say so explicitly ("the same Frontend surface rules as P1-27"). SETTLED BY: an explicit decision recorded in the rule's `why` field, which is where every other such decision in this file lives.

---

## Ambiguities recorded from this lane

Recorded, not resolved. The full set is in [ambiguity-register.md](ambiguity-register.md).

- REQUIRED-CHECK COUNT ON `develop` — the repository says two different things and neither is dated as superseding the other. `docs/engineering/ci-automation/gate-record.md:151` records the post-migration state as **5** required contexts (the four legacy `ci.yml` job names PLUS `ci-gate`) and `:157` says "The four legacy checks were **kept, not replaced**. Removing them is rollout step 10 and belongs in its own reviewable pull request." `docs/phase-1/phase-1-28/evidence/closure-evidence.md:666` (later, 2026-08) labels `ci-gate` "**the single required check**", and `docs/phase-1/phase-1-28/eviden
- `main`'s STRICT (up-to-date) SETTING is stated nowhere in the repository. `gate-record.md:152` records `develop` as `strict: false` — "`false` — retained". No document on this head states `main`'s value. `branch-ruleset.md:36` states the TARGET-state intent "Require branches up to date | yes for `develop`", which contradicts the applied `false` recorded in the gate record. Both cannot describe the same moment; the gate record is the applied state and `branch-ruleset.md` is the design page.
- THE MODULE DOCBLOCK COUNTS ELEVEN BUCKETS AND THE CODE HAS TWELVE. `scripts/ci/check-phase-ownership.mjs:136-138` reasons about "adding a TWELFTH bucket [that] would have widened every profile in the file at once" — a sentence written when eleven existed. `dbSeeds` was added afterwards (`:107-114`), making twelve, and the very hole the sentence describes is now live for `dbSeeds`: six of the twelve profiles name it in neither list and refuse it only through the generated fallback message at `:817-819`. Behaviourally sound (allowed decides), but the prose no longer counts the buckets it is reas
- THE FROZEN P1-29 PREP SET CONTRADICTS THE TREE ON ONE POINT. `C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco-worktrees/p1-29-prep/docs/phase-1/phase-1-29/test-and-acceptance-plan.md:274` lists as a trap: "`validate:phase-ownership` defaults to the **wrong** profile, and is invoked by no CI job". The first half is true (`check-phase-ownership.mjs:926`). The second half is FALSE at develop `c081a019`: `_reusable-node-quality.yml:338-359` invokes it, and `check-command-coverage.mjs` registers it `ci-only`, a tier that FAILS if no hosted workflow invokes it. The same prep set's own `blocker
- BRANCH-NAME SPELLING FOR THE PRE-P1-29 INTEGRATION BRANCH. Rule 24 pins the full literal `feature/pre-p1-29-multi-tenant-administration-rbac-workflow` (with `administration`), while the documentation directory on this head is `docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow` (with `admin`). Since the rule is a full-name pin rather than a prefix, a branch spelled `…-admin-…` would match NO rule and be refused. Which spelling the branch actually carries is not determinable from this checkout — no such remote branch exists here (`git branch -a`).
- "21 required checks" vs "the single required check". `docs/phase-1/phase-1-27/adversarial-round-five.md:377` and `evidence/change-log.md:882` say "21 required checks completed, 0 failed"; `phase-1-28/evidence/closure-evidence.md:664-686` enumerates 21 check-RUNS on a head while calling one of them the single required check. These are two different senses of "required" — check-runs observed on the commit versus contexts the ruleset requires — and the documents do not distinguish them consistently.

---

## The per-PR specification

**Not one giant P1-29 pull request.** Each row is one pull request into protected `develop`.
Merge-commit only, on every protected branch.

### PRE-P1-29 remaining

| #   | branch                                                        | profile                | scope                                                                                                      | depends on                                                                                                | tests                                                                                               | merge gate                     |
| --- | ------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------ |
| 1   | `feature/pre-p1-29-backend-b2-company-status`                 | `pre-p1-29-backend`    | `org.company_status_history`, `org.change_company_status`, grants, policies                                | B1 landed and unblocked                                                                                   | db tier + the three mutation proofs in [next-slice-b2-preparation.md](next-slice-b2-preparation.md) | `ci-gate`                      |
| 2   | `feature/pre-p1-29-backend-b3-platform-context`               | `pre-p1-29-backend`    | the two request-context shapes                                                                             | B1                                                                                                        | backend tier                                                                                        | `ci-gate`                      |
| 3   | `feature/pre-p1-29-backend-b4-org-read`                       | `pre-p1-29-backend`    | organisation read contract; **creates the `app_platform` SELECT privilege B5 needs**                       | B1, B3                                                                                                    | backend + db                                                                                        | `ci-gate`                      |
| 4   | `feature/pre-p1-29-backend-b5-lifecycle`                      | `pre-p1-29-backend`    | lifecycle contract                                                                                         | **B4**                                                                                                    | backend + db                                                                                        | `ci-gate`                      |
| 5   | `feature/pre-p1-29-backend-b6-provisioning`                   | `pre-p1-29-backend`    | the sanctioned path to `org.provision_organization`                                                        | B3                                                                                                        | backend + db                                                                                        | `ci-gate`                      |
| 6   | `feature/pre-p1-29-backend-b7-bootstrap`                      | `pre-p1-29-backend`    | first-Owner bootstrap — **the highest-risk slice**                                                         | B3, B5, B6                                                                                                | backend + db + the bootstrap-window proofs                                                          | `ci-gate`                      |
| 7   | `feature/pre-p1-29-backend-b9-proofs`                         | `pre-p1-29-backend`    | published contract and security proofs                                                                     | B1…B7                                                                                                     | all tiers                                                                                           | `ci-gate`                      |
| 8   | `feature/pre-p1-29-backend-wave-c-…`                          | `pre-p1-29-backend`    | company, branch, department administration; the reach-scoped named lists; Company-Owner target containment | B2, B7; **and the GAP-08 ordering question, `AMB-05`**                                                    | backend + db                                                                                        | `ci-gate`                      |
| 9   | `feature/pre-p1-29-backend-wave-d-…`                          | `pre-p1-29-backend`    | identity, membership, tenant resolution                                                                    | **transitional dual model** — see [data-migration-classification.md](data-migration-classification.md) §2 | all tiers                                                                                           | `ci-gate`                      |
| 10  | `feature/pre-p1-29-backend-wave-e-…`                          | `pre-p1-29-backend`    | the per-operation tenant-scope adjudication                                                                | none technically; **the 167/170 discrepancy must be settled first**                                       | backend + the adjudication record                                                                   | `ci-gate`                      |
| 11  | `feature/pre-p1-29-web-wave-f-…`                              | `pre-p1-29-web`        | Superadmin web                                                                                             | B4, B5, B6, B7; **and `AMB-34` — whether F is in scope at all**                                           | web + e2e                                                                                           | `ci-gate`                      |
| 12  | `feature/pre-p1-29-web-wave-g-…`                              | `pre-p1-29-web`        | company administration web                                                                                 | Wave C                                                                                                    | web + e2e                                                                                           | `ci-gate`                      |
| 13  | `feature/pre-p1-29-web-wave-h-…`                              | `pre-p1-29-web`        | workflow UI                                                                                                | Waves C, D, E                                                                                             | web + e2e                                                                                           | `ci-gate`                      |
| 14  | `feature/pre-p1-29-multi-tenant-administration-rbac-workflow` | `pre-p1-29-initiative` | integration, Wave I evidence, closure record                                                               | all of the above                                                                                          | full `verify:workspaces`                                                                            | `ci-gate` + written Owner Pass |

### P1-29

| #   | branch                                                     | profile          | scope                                                                | depends on         | tests                                | merge gate                     |
| --- | ---------------------------------------------------------- | ---------------- | -------------------------------------------------------------------- | ------------------ | ------------------------------------ | ------------------------------ |
| 15  | `feature/p1-29-backend-a0-parity-gate`                     | P1-29 Backend    | `BE-5`                                                               | none               | red-proof                            | `ci-gate`                      |
| 16  | `feature/p1-29-backend-a0-technician`                      | P1-29 Backend    | `BE-9` then `BE-2`                                                   | 15                 | backend + db + the T-A0-04 negatives | `ci-gate`                      |
| 17  | `feature/p1-29-backend-a0-catalogues`                      | P1-29 Backend    | `BE-1`                                                               | 15                 | the tenant-override test             | `ci-gate`                      |
| 18  | `feature/p1-29-backend-a0-customer`                        | P1-29 Backend    | `BE-3`                                                               | 15                 | T-A0-07                              | `ci-gate`                      |
| 19  | `feature/p1-29-backend-a0-queues`                          | P1-29 Backend    | `BE-10`                                                              | 15                 | T-A0-03                              | `ci-gate`                      |
| 20  | `feature/p1-29-backend-a0-templates`                       | P1-29 Backend    | `BE-4`                                                               | 15                 | T-A0-08                              | `ci-gate`                      |
| 21  | `feature/p1-29-web-slice-a-contracts`                      | P1-29 Web        | contract mirror, permissions module, adapters, the phase's own gates | 15–20 as they land | web + the new gates red-proved       | `ci-gate`                      |
| 22  | `feature/p1-29-web-slice-b-queue`                          | P1-29 Web        | P-01, P-02                                                           | 21, 18             | web + e2e                            | `ci-gate`                      |
| 23  | `feature/p1-29-web-slice-c-detail`                         | P1-29 Web        | P-03, P-04                                                           | 21, 17, 18         | web + e2e                            | `ci-gate`                      |
| 24  | `feature/p1-29-web-slice-d-technician`                     | P1-29 Web        | P-05, P-06                                                           | 21, 16, 17         | web + e2e                            | `ci-gate`                      |
| 25  | `feature/p1-29-web-slice-e-diagnostics`                    | P1-29 Web        | P-07, P-08                                                           | 21, **20**         | web + e2e                            | `ci-gate`                      |
| 26  | `feature/p1-29-web-slice-f-integration`                    | P1-29 Web        | P-10                                                                 | 21                 | web + e2e                            | `ci-gate`                      |
| 27  | `feature/p1-29-web-slice-g-history`                        | P1-29 Web        | P-09, concurrency, exceptions                                        | 21                 | web + e2e                            | `ci-gate`                      |
| 28  | `feature/p1-29-work-order-diagnostics-technician-frontend` | P1-29 initiative | acceptance, remediation, evidence, closure record                    | all                | full `verify:workspaces`             | `ci-gate` + written Owner Pass |
| 29  | `chore/release-promote-…`                                  | _(promotion)_    | promotion of `develop` to `main`                                     | 28                 | protected reproof                    | `protected-gate`               |

**Twenty-nine pull requests.** That is the honest count for two initiatives, and it is the reason
"one big P1-29 PR" is not on the table.

---

## What can run in parallel — and what only looks parallel

A pair may run in parallel only when **all four** hold: the contracts both consume are stable;
the permissions both need are stable; they share no migration; and neither depends on the other's
state machine.

| these may run in parallel                                  | why it is safe                                                                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| PRs 15, 17, 18, 19 (`BE-5`, `BE-1`, `BE-3`, `BE-10`)       | four independent read/CI surfaces; **no migration in any of them**; no shared service file                                              |
| PRs 22, 26, 27 (queue, integration, history) once 21 lands | three disjoint screen sets over contracts that already exist; no shared state machine                                                   |
| PR 11 (Wave F web) alongside PRs 8–10 (Waves C–E backend)  | different lanes, different ownership profiles, structurally unable to touch each other's files — **provided `AMB-34` is settled first** |
| the negative-test suites of any two A0 items               | tests only                                                                                                                              |

| these look parallel and are not                 | why                                                                                                                                                           |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BE-2` and `BE-9`                               | `BE-9` is a hard prerequisite. Shipping `BE-2` first delivers a resolution contract with nothing to resolve                                                   |
| B4 and B5                                       | B4 creates the privilege B5's policy depends on. The design says so explicitly                                                                                |
| Slice C and Slice D (detail and technician)     | both consume `BE-1`'s catalogue shape; if it changes, both change                                                                                             |
| any two migrations in the same wave             | migration filenames are an ordered series; two branches adding one will collide, and the forbidden-prefix gate is a filename series, not an ordinal           |
| Wave C and Wave E                               | `gap-register.md` states GAP-08 must precede the structure surface. `scope.md` orders them the other way. **Until `AMB-05` is settled, treat them as serial** |
| any P1-29 web slice and its own A0 prerequisite | the sequencing invariant. A screen built against a contract that does not exist is the defect this whole plan exists to prevent                               |

**The general rule:** parallelism is bought with stable contracts. Every pair above that is safe is
safe _because_ the contract it consumes already exists on `develop`. Nothing in this plan is
parallel because it was convenient.
