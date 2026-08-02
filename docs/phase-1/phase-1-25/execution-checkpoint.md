# P1-25 — execution checkpoint

Durable recovery record for **Phase 1-25 — Frontend Architecture and Design-System
Foundation**. Updated after every implementation wave. If context is lost, resume from
here plus `git status`, `git log`, the GitHub PR state and the Actions state — not from
memory.

**P1-25 is NOT closed.** The technical foundation is partially built; the final logo,
colour palette and Product Owner fidelity approval remain pending.

---

## Baseline (verified live, not recalled)

|                           |                                                     |
| ------------------------- | --------------------------------------------------- |
| `P1_25_BASE_SHA`          | `cef7fdf296ac65e7f789231b06c718f0a7f2cf2a`          |
| `P1_25_BASE_TREE`         | `fb7a511a08f2720ed6fa41a3272fbeb8346817e0`          |
| Feature branch            | `feature/p1-25-frontend-architecture-design-system` |
| Protected `main` at start | `f085d82001a43de51725707426d5c10eb134c004`          |
| Migrations at start       | 119, no 120                                         |
| Starting condition        | **A — clean and ready to start P1-25**              |

## Local execution location (machine-specific — see the note below)

> This section names one developer's absolute paths so a session can resume. **No other
> document in this repository may depend on these paths**, and the frontend architecture
> record deliberately does not: the canonical architecture is `web/` relative to the
> repository root, wherever that root happens to live.

|                            |                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------- |
| Owner checkout             | `C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco` — on `develop`            |
| **Visible P1-25 worktree** | `C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco-worktrees/p1-25`           |
| Open in VS Code            | `code -n "C:\Users\Ezzaldeen\OneDrive\Desktop\1millions\RootLco-worktrees\p1-25"` |

**All P1-25 implementation happens in the visible worktree.** It was relocated there on
2026-08-01 from `…/AppData/Local/Temp/claude/p23`, a temporary path the owner could not
open and which is subject to automatic cleanup. The relocation preserved the exact HEAD
(`fc5ff674`) and tree (`abba613e`); the temporary worktree was detached first, then
removed without force after proving it held no unique work.

Opening the **owner `develop` checkout** will NOT show `web/` — the work is unmerged, and
that is correct, not missing.

### One practical caveat worth knowing

The visible worktree sits inside OneDrive, matching the owner's existing checkout. Git
ignores `web/node_modules`, but **OneDrive does not** — 600 packages will sync unless the
folder is excluded. Excluding `RootLco-worktrees/**/node_modules` from OneDrive sync is
recommended; nothing in the repository depends on it either way.

## Commits

| SHA       | Wave | Contents                                                                                                                                       |
| --------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `564e4ca` | 0–1  | ADR-020; `web/` spine; Sass tokens → CSS custom properties; Tailwind wired to them; brand abstraction; ar/en + RTL boot; token and brand gates |
| `fc5ff67` | 1    | dependency-security extended to the `web/` lockfile; 3 HIGH advisories found and remediated                                                    |

## Architecture decided so far

- **ADR-020** discharges ADR-002's Open styling decision, which required _"a superseding
  or companion ADR before frontend implementation begins"_. Sass owns every design value;
  Tailwind holds only `var(--…)` references; shadcn primitives will be vendored, not
  installed.
- **Topology: `web/` is an INDEPENDENT package** with its own `package.json` and
  `package-lock.json`. Not npm workspaces. Owner-approved. The root/backend package,
  lockfile, `Dockerfile` and every existing gate are untouched.
- Because a second lockfile is a second dependency surface, the existing
  `dependency-security` job was extended to install and audit `web/` under the **same
  zero-waiver policy**. That extension is not optional bookkeeping: it found 3 HIGH
  advisories on its first run.

## Completed tasks

| Task            | Subject                                             | State        |
| --------------- | --------------------------------------------------- | ------------ |
| `P1-25-FE-001`  | `web/` application boundary and App Router scaffold | **Complete** |
| `P1-25-FE-002`  | Sass token architecture + CSS custom-property emit  | **Complete** |
| `P1-25-FE-003`  | Tailwind wired to Sass-owned tokens (no own values) | **Complete** |
| `P1-25-FE-004`  | Centralised brand configuration + `BrandMark`       | **Complete** |
| `P1-25-FE-005`  | Locale routing, `lang`/`dir` boot, ar/en catalogues | **Complete** |
| `P1-25-SEC-001` | Raw design-value enforcement gate                   | **Complete** |
| `P1-25-SEC-002` | Brand-isolation enforcement gate                    | **Complete** |
| `P1-25-SEC-003` | Frontend dependency tree audited to zero            | **Complete** |
| `P1-25-DO-001`  | Dependency-security gate extended to `web/`         | **Complete** |
| `P1-25-QA-001`  | Brand-replacement proof (behavioural)               | **Complete** |

**10 of 35.** Everything else is pending and is listed below rather than implied.

## Pending tasks

`P1-25-FE-006`…`FE-018` — dashboard shell, modular sidebar, component gallery, data-table
system, form framework and controls, overlays, shared states, formatting, typed API
client, accessibility, print, motion catalogue.
`P1-25-SEC-004`…`SEC-005` — CSP configuration, session-expiry UX.
`P1-25-QA-002`…`QA-006` — component harness, a11y checks, i18n completeness, Playwright
E2E, browser-review evidence.
`P1-25-DO-002`…`DO-003` — frontend CI job wiring into the aggregate gate, preview/observability.
`P1-25-DOC-001`…`DOC-003` — architecture record, design-system reference, security standard.

## Verification at `fc5ff67`, re-run from the visible worktree

| Check                                    | Result                                                           |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `npm ci --prefix web`                    | 600 packages, clean install from the committed lockfile          |
| `npm run typecheck --prefix web`         | clean (TypeScript strict, `noUncheckedIndexedAccess`)            |
| `npm run build --prefix web`             | green — `/ar` and `/en` both prerender                           |
| `node scripts/check-design-tokens.mjs`   | 33 files, **0** raw values outside the token layer               |
| `node scripts/check-brand-isolation.mjs` | 33 files, **0** violations                                       |
| `npm run test --prefix web`              | **6/6**, including the brand-replacement proof                   |
| `npm audit --prefix web`                 | **0** advisories at every severity                               |
| `npm audit` (root/backend)               | **0** advisories — unchanged                                     |
| Root/backend files changed               | **0** — `package.json`, `package-lock.json`, `src/`, `supabase/` |

Measured in the built CSS: **34 colour, 13 space, 7 radius, 5 duration, 11 layout**
custom properties emitted by Sass, and Tailwind utilities compile to
`background-color:var(--color-surface)` rather than to a literal.

## Findings

| ID            | Severity | Found by                     | State                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------- | -------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-25-F-001` | Low      | the token gate, first run    | **Fixed** — three hard-coded `#ffffff` in the print stylesheet; fixed by adding a `paper` token rather than exempting print                                                                                                                                                                                                                                                               |
| `P1-25-F-002` | Medium   | the brand gate, first run    | **Fixed** — the locale layout and proof page imported `@/config/brand` directly, breaking the single-consumer rule the replacement promise depends on                                                                                                                                                                                                                                     |
| `P1-25-F-003` | **High** | the extended dependency gate | **Fixed** — 3 HIGH advisories in the `web/` production tree (postcss path traversal / arbitrary file read, CVSS 7.5; sharp libvips CVEs) reachable via `next@16.2.12`. npm proposed `next@9.3.3`, a seven-major downgrade. Remedied by mirroring the root's own `postcss`/`sharp`/`fast-uri` overrides; the direct `postcss` devDependency was raised to `^8.5.24` to resolve `EOVERRIDE` |

All three were found by gates written in this phase, against code written in this phase.

## Brand state

- System name: `[SYSTEM NAME]` placeholder. **RootLco is the company, never the product**
  (ADR-011) — the brand gate rejects it in any component.
- Logo: wordmark placeholder, no asset. `logoMode: 'asset'` with a missing asset degrades
  to the wordmark rather than a broken image.
- Palette: **provisional**, OIR-06 still open.
- Files requiring owner input: `web/src/config/brand.ts`,
  `web/src/styles/tokens/_colors.scss`, `web/src/styles/themes/_provisional.scss`, and
  approved assets under `web/public/brand/`. **Four locations, no components** — proven by
  `web/tests/brand-replacement.test.ts`, which performs a real swap and asserts zero
  component or route files change, then restores.

## Not done, and not claimed

No dashboard shell, sidebar, data table, forms, overlays, gallery, Playwright harness,
accessibility automation, frontend CI job, or browser verification. No feature PR. Nothing
merged. No P1-26 work of any kind. No migration; 119 unchanged.

## Topology normalization — IN PROGRESS

The owner corrected the target architecture: `apps/api` and `apps/web` as sibling
applications under ONE npm workspace and ONE root lockfile. The independent `web/`
package was an early architecture discovery, resolved before any downstream UI work — not
a failure, and deliberately caught before the dashboard shell was built on top of it.

**Done in this wave:**

| Change                                                                      | State |
| --------------------------------------------------------------------------- | ----- |
| `web/` → `apps/web/` via `git mv` (history preserved, 50 files as renames)  | done  |
| Package renamed `@rootlco/web`                                              | done  |
| Nested `web/package-lock.json` deleted                                      | done  |
| Root declares `workspaces: ["apps/*"]`                                      | done  |
| ONE root lockfile regenerated (12,230 lines, 0 nested locks)                | done  |
| Security overrides (postcss/sharp/fast-uri) hoisted to root authority only  | done  |
| Dockerfile copies `apps/web/package.json` so workspace `npm ci` succeeds    | done  |
| Root tsconfig excludes `apps` so the workspaces cannot typecheck each other | done  |

**Two defects found by verification, not by review:**

- **`P1-25-F-004`** — after adding `workspaces`, the ROOT `tsc` began compiling
  `apps/web/**` and resolving `@/` to the backend `src/`, producing TS2307 on files that
  build cleanly in their own workspace. Fixed by excluding `apps` from the root tsconfig.
- **`P1-25-F-005`** — the brand-swap proof asserted `web/…` paths and ran `git diff` one
  directory above the package. Both corrected for the `apps/` topology; still 6/6.

**Verified after the move:** API (root) typecheck OK · web typecheck OK · web build green
with `/ar` and `/en` · token gate 33/0 · brand gate 33/0 · web tests 6/6 · workspace-wide
audit 0 advisories at every severity · 119 migrations unchanged · run-block syntax 130/0.

**NOT yet done — the backend half.** `src/`, `public/`, `next.config.ts` and the vitest
configs are still at the repository root; `apps/api/` does not exist yet. Measured cost of
that move: **24 scripts hard-coding `src/`/`tests/` paths, 723 literal path occurrences,
62 root npm scripts, 36 distinct `npm run` calls across workflows, 32 tests resolving from
the repository root**, plus the multi-stage Dockerfile and every path-pinned P1-19…P1-24
evidence artifact already merged to `main`. It is a repository-wide change that needs its
own dedicated run and a full clean-room re-verification of the 4,689-test backend baseline.

## `apps/api` migration — ATTEMPTED, REVERTED, DIAGNOSED

The backend move was attempted in full and **reverted to `e251f569` because it could not
be finished green in one run**. Nothing broken was committed; the visible worktree is
clean and at the last green pushed commit. The mechanical work is cheap to redo — the
value below is the diagnosis, which turns the next attempt from exploration into execution.

### What was done and proven to work

| Step                                                                                                                 | Result                                      |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `git mv src apps/api/src` (449 files), `public`, `next.config.ts`                                                    | clean renames, **196 API routes preserved** |
| `apps/api/package.json` as `@rootlco/api` with the 8 runtime deps                                                    | created                                     |
| `apps/api/tsconfig.json` with `@/*` → `./src/*`                                                                      | created                                     |
| Root tsconfig scoped to `tests/` + `scripts/`, `@/*` → `apps/api/src/*`, excludes `apps`                             | done                                        |
| Root package split: coordinator, application deps moved out, `pg`/`zod` kept as explicit test deps                   | done                                        |
| Root scripts preserved by name and delegated (`dev`, `build`, `start`, `lint`) + `:api`/`:web` variants — 76 scripts | done                                        |
| Single root lockfile with **both** workspaces, 0 nested locks                                                        | done                                        |
| **API typecheck, WEB typecheck, ROOT typecheck all clean**                                                           | verified                                    |
| **`build:api` and `build:web` both compiled successfully**                                                           | verified                                    |

So the boundary itself is sound: the two applications compile independently and the
workspace resolves.

### The five failures that must be fixed for it to be green

1. **Path double-prefixing.** `p1-24-operation-register` resolved
   `apps/api/apps/api/src/app/api`. A blanket `'src/' → 'apps/api/src/'` replacement
   compounds in scripts that already resolve relative to the application root. **The fix is
   the centralised `scripts/lib/repository-paths.mjs` helper the brief asks for** —
   `API_SRC_ROOT` exported once — not another sweep of literals.
2. **ESLint: 2,863 errors.** `eslint.config.mjs` is at the repository root, so
   `apps/api` linted with no config. Needs `apps/api/eslint.config.mjs` (extending the
   root) before `lint:api` means anything.
3. **`validate:operation-coverage`** — its expected-path constant still requires
   `src/app/api/**/route.ts`; every operation now reports "registered outside".
4. **`validate:authorization-coverage`** — reported `0 registered operations, 0 route
files` and could not read the audit-action catalog. Same root cause as (1) and (3).
5. **19 unit tests across 12 files**, plus `format:check` on the newly generated JSON.
   Ordinary fallout once (1)–(4) are correct.

### Not yet attempted

Dockerfile workspace-scoped install and API-only image proof, CI workflow path updates,
CodeQL configuration, container-security re-proof, the backend/DB/RLS baseline
(1301 / 1752 / 1636), dependency-equivalence comparison, and the runtime smoke test on
separate ports.

### Recommended order for the next run

Build `scripts/lib/repository-paths.mjs` **first**, repoint the scripts through it rather
than through literals, add `apps/api/eslint.config.mjs`, then move the tree, then fix the
two coverage gates, then Docker and CI, then run the full baseline.

## Wave A1 — path authority — **COMPLETE** (`d3f8e11`)

The prerequisite the reverted attempt lacked. `scripts/lib/repository-paths.mjs` is now the
only place that derives the repository root or spells `apps/api` / `apps/web`.

**Root cause it closes.** Three validators located the repository three different ways —
`p1-24-operation-register.mjs` from `import.meta.url/..`, and both
`check-authorization-coverage.mjs` and `check-operation-test-coverage.mjs` from
`process.cwd()`. Each was defensible alone; together the root had three definitions that
agreed only by accident of invocation directory. Rewriting literals across 21 scripts then
joined a base already carrying the prefix with a segment that now also carried it, giving
`apps/api/apps/api/src/app/api`.

**Design.** The root is derived from the MODULE's location, never from `process.cwd()` —
cwd is a property of the caller, not of the repository, and CI changes directory routinely.
`assertLayout()` refuses to return a directory that does not exist, so a missing tree can
never be reported as "0 files found". `toRepositoryPath()` emits repository-relative POSIX
paths so generated evidence cannot embed an absolute path.

**Exports:** `REPOSITORY_ROOT`, `fromRoot`, `APPS_ROOT`, `API_ROOT`, `API_SRC_ROOT`,
`API_APP_ROOT`, `API_ROUTES_ROOT`, `API_PUBLIC_ROOT`, `WEB_ROOT`, `WEB_SRC_ROOT`,
`TESTS_ROOT`, `SCRIPTS_ROOT`, `SUPABASE_ROOT`, `DOCS_ROOT`, `GITHUB_ROOT`.

**Tests: 6/6**, written before the move because the helper is what makes the move safe.
The decisive one spawns real subprocesses from three different working directories and
asserts identical resolution — a unit assertion cannot catch a cwd dependency, because the
runner has one cwd. Another pins the exact double-prefix defect that caused the revert.

**Unit tier after this wave: 1307/1307 across 59 files** (1301 baseline + 6). Root
typecheck clean, encoding clean, format clean. No file moved; root `src/` untouched, 196
API routes unchanged.

> A known flake, already recorded: `tests/foundation/operation-coverage-gate.test.ts` needs
> ~5–6 s against a 5 s budget and intermittently times out when all 59 files run
> concurrently on a loaded machine. It passes in isolation and on a quiet run. Do not widen
> the budget to hide it.

## Remaining waves for `apps/api` — A2…A15

**A2+A3+A4+A5 — ONE commit (finding P1-25-F-006).** Normalize validators onto the helper, `p1-24-operation-register`,
`check-operation-test-coverage`, `check-authorization-coverage`, route inventory, OpenAPI
discovery, coverage globs. Each needs a test proving it finds all 196 routes and 226
operations and does not double-prefix.

**A3 — API workspace tooling.** `apps/api/package.json` (`@rootlco/api`, the 8 runtime
deps at existing versions), `apps/api/tsconfig.json` (`@/*` → `./src/*`), and
**`apps/api/eslint.config.mjs` composing the root config** — its absence caused the 2,863
lint errors last time.

**A4 — the move.** `git mv src apps/api/src`, `public`, `next.config.ts`. Proven to work:
449 files as renames, 196 routes preserved, both apps compiled.

**A5 — resolvers.** Root vitest `@` → `apps/api/src`, coverage globs, the 19 test
failures by root cause.

**A6–A15** — formatting/generated artefacts, command compatibility matrix, pre-Docker
verification, Dockerfile workspace install with an API-only image, CI + CodeQL paths, clean
`npm ci`, full baseline (1752 backend / 1636 DB-RLS), runtime smoke on separate ports,
dependency-equivalence proof, documentation.

## Wave A2 — attempted, and why it has no standalone green commit

**Finding `P1-25-F-006`.** The planned commit sequence cannot be followed as written.

Normalizing the validators onto `apps/api` and asserting the post-move shape in
`repository-paths.test.ts` cannot both be green while the backend is still at the
repository root. A transitional fallback makes the validators pass but the tests fail —
correctly, because those tests exist precisely so a leftover fallback cannot survive
unnoticed. Weakening them to obtain a green intermediate would remove the only thing that
detects a stale dual-layout mode.

**Therefore A2, A3, A4 and A5 must land as ONE commit.** Validators, API tooling, the
`git mv`, and the resolver/test repairs are a single atomic unit. This was proven by
executing A2 in full: all four validators (p1-24-register, authorization-coverage,
operation-coverage, openapi) went green through the path authority, and the three original
path tests went red against the transitional fallback. Reverted rather than committed.

Also confirmed during A2: the three-way root derivation is genuinely removable —
`process.cwd()` disappears from all three validators once they import the authority. One
insertion bug is worth remembering: appending an import after "the last import line"
places it INSIDE a multi-line import block. Insert after the closing brace.

## Wave A2b — workspace formatting ownership — **COMPLETE**

Two real defects from the `apps/web` move, invisible until now because the root formatter
was checking files it does not own:

- **`P1-25-F-007`** — root prettier formatted `apps/web/**` with the ROOT config while the
  web workspace formats the same files with its own. Once root stopped checking `apps/`,
  six web files and two root files (ADR-020, `tsconfig.json`) reported as unformatted. All
  were committed earlier and had never been checked by the formatter that owns them.
- **`P1-25-F-008`** — the coordinator had no per-workspace entry points, so `typecheck:web`
  did not exist and reported as a failure that looked like a code defect.

Root `.prettierignore` excludes `apps/`; `format:check:all` runs root plus each workspace.
Added `dev:web`, `build:web`, `lint:web`, `typecheck:web`, `test:web`, `validate:web-tokens`,
`validate:web-brand`, and `verify:workspaces` as the single aggregate that fails if either
application fails. Historical root command names keep their current meaning.

**Verified:** `verify:workspaces` green · unit 1307/1307 across 59 files · web 6/6 · token
gate 33/0 · brand gate 33/0 · all four path-authority validators green.

## Waves A2–A5 — the API workspace move — **COMPLETE**, one atomic commit

`apps/api` and `apps/web` are now real sibling applications under one npm workspace with
one root lockfile. 451 tracked files moved as renames; 196 route files, 226 operations and
195 OpenAPI paths preserved exactly.

**Why one commit (finding `P1-25-F-006`, now resolved).** Validators pointed at
`apps/api` and tests asserting the post-move shape cannot both be green while the backend
sits at the repository root. A transitional fallback makes the validators pass and makes
the tests fail — correctly, because those tests exist so a leftover fallback cannot survive
unnoticed. So A2, A3, A4 and A5 landed together, and no dual-layout mode was ever committed.

### What the move actually consisted of

- **Path authority extended** with the repository-RELATIVE forms — `API_PATH`,
  `API_SRC_PATH`, `API_ROUTES_PATH`, `API_ROUTES_V1_PATH`, `WEB_PATH`, `WEB_SRC_PATH`,
  `apiSrcPath()` — each DERIVED from the absolute constants rather than written out again,
  so the two forms cannot drift. A gate classifying a git-changed path needs the relative
  form, and `'apps/api/src'` hand-written in twenty scripts is the same defect as an
  absolute path derived twenty ways.
- **24 executables normalized.** `process.cwd()` removed from
  `check-authorization-coverage`, `check-operation-test-coverage`, `check-module-boundaries`,
  `check-openapi`, `check-env-contract`, `check-idempotency-evidence`,
  `check-route-registry-parity`, `coverage-gate` and `hostile-mutations`.
- **Where a script carried a TABLE of application paths**, the table was left alone and its
  BASE moved to the application root. Those literals were always application-relative, and
  rewriting ~180 of them by hand is exactly the operation that produced
  `apps/api/apps/api` the first time.
- **`apps/api/package.json`** (`@rootlco/api`), **`tsconfig.json`** extending the root
  policy and overriding only `paths`/`include`/`exclude`, **`eslint.config.mjs`**
  COMPOSING the root policy, and a **`.prettierignore` with no `.prettierrc`** so prettier
  resolves upward and the moved files keep the exact rules they were written under.
- **Alias strategy.** Root resolver: `@api/*` is the canonical spelling, `@/*` kept
  pointing at the same API source because rewriting it across 131 test files would be a
  131-file diff inside a migration whose whole value is that it is a rename. `apps/web`
  has its own resolver where `@/` means web source. One alias, one meaning, per resolver.
- **Command ownership.** `dev`/`build`/`start`/`style:*` at the root now delegate to
  `@rootlco/api`, so every existing caller keeps its meaning. `typecheck`/`lint`/`test`
  stay repository-level. `:api` and `:web` variants added for both.

### Findings closed by this commit

- **`P1-25-F-006`** — resolved by landing A2–A5 atomically, with no permanent fallback.
- **`P1-25-F-007`**, **`P1-25-F-008`** — remain resolved.

### Findings opened by this commit

- **`P1-25-F-009` — `security:scope-exclusions` had been RED since `apps/web` landed.**
  Two hits outside the allow-list (`apps/web/src/i18n/config.ts`,
  `apps/web/src/styles/base/_reset.scss`) — both legitimate, neither listed. Nothing caught
  it because `security:all` was in no aggregate. Allow-list extended; `security:all` added
  to `verify:workspaces`.
- **`P1-25-F-010` — `lint:web` had NEVER successfully run.** `apps/web/eslint.config.mjs`
  went through `FlatCompat` and the eslintrc-era names `next/core-web-vitals` /
  `next/typescript`; under eslint-config-next 16 those are no longer valid eslintrc
  shareable configs, and the compatibility layer crashed inside its own error FORMATTER
  ("Converting circular structure to JSON") while trying to say so. Rewritten to import the
  flat configs directly. `lint:web` added to the aggregate.
- **`P1-25-F-011` — a suppression that suppressed nothing.** `BrandMark.tsx` carried
  `eslint-disable-next-line @next/next/no-img-element` with the reason WRAPPED onto the
  following line, so "next line" was the comment and the rule fired anyway. Directive moved
  directly above the element.
- **`P1-25-F-012` — the brand-swap proof could not run on a dirty tree.** It asked
  `git diff --name-only` what differed from HEAD, which cannot distinguish an edit the
  test made from an unrelated edit already present. Replaced with a content snapshot taken
  BEFORE the mutation: same claim, tree-state independent, and non-vacuity is now asserted
  (watch list must be non-empty, swap must really have applied). Mutation-tested — flipping
  the comparison makes it fail and name the file.
- **`P1-25-F-013` — the operation-coverage-gate flake had a cause, not just bad luck.**
  Its three "real registry" tests each re-scanned the same 430 files inside the same 5 s
  budget. Collapsed to one shared scan. No assertion changed and no budget was widened;
  three consecutive full-tier runs are green.

### Deliberately NOT done, and still red or unproven

- **Dockerfile, hosted CI, CodeQL paths, container security, runtime smoke, full backend
  and database/RLS tiers, dependency equivalence.** Out of scope for this execution by
  instruction. The Dockerfile still copies `/app/.next` and `/app/public` from a root-built
  application and has NOT been updated for the workspace layout.
- **`apps/web` `style:check` is RED — 99 stylelint errors, 50 auto-fixable.** Another gate
  that had never been run. Left for the web waves and deliberately NOT added to the
  aggregate, so it cannot be mistaken for green.
- **Duplicate dependency declarations.** `apps/api` declares the runtime it imports; the
  root still declares the same versions for the repository-level test tiers. Removing the
  root copies is a separate, verified step — an unverified removal breaks `npm test` in a
  way no static check catches.
- **`validate:canonical-docs` fails in this worktree** and is not a defect: the canonical
  DOCX live beside the MAIN checkout, so `<repo-root>/../` resolves correctly there and not
  from `RootLco-worktrees/p1-25`. Environmental, unchanged by this commit.
- **Root `lint` prints "Pages directory cannot be found".** True and harmless — there is no
  Next application at the repository root any more. Silencing it would mean either lying
  about `rootDir` or disabling the rule for `apps/api` too, since that config composes this
  one. Left visible.

### Verified before commit

```text
Structure    apps/api + apps/web · root src//public//next.config.ts absent · 0 nested lockfiles
Move         451 renames · 196 route files before and after · inventory diff 0 · 0 tracked symlinks
Static       root/API/web typecheck · root+API lint · API style · format x3 · encoding · run-block
Builds       API production build (199 manifest routes, standalone emitted) · web build, /ar + /en
Validators   module-boundaries 430 files · authorization-coverage · operation-coverage 226/226
             openapi 195 paths / 226 operations · p1-24 register · exact-money · p1-19..23 inventories
Tests        unit/component 1313/1313 across 59 files (1307 + 6 new) · web 6/6 · 0 skipped
Web          token gate 33/0 · brand gate 33/0 · brand-swap 6/6 · audit clean
Install      npm ci from clean · 0 vulnerabilities in root, API and web trees
Database     119 migrations · no 120 · supabase diff 0 · historical migration diff 0
```

## Stage 1.1–1.2 — Stylelint and command coverage — **COMPLETE**

### Web Stylelint: 99 errors → 0 errors, 0 warnings

Classified before fixing. None of it was cosmetic:

- **34 × `scss/no-global-function-names`** — `map-get()` is deprecated in Dart Sass
  and slated for removal. Fixed at source with an explicit `@use 'sass:map'`.
- **33 × modern colour notation** — legacy `rgba(r, g, b, a)` → `rgb(r g b / p%)`.
- **9 × `scss/dollar-variable-empty-line-before`** — the standard preset forbids a blank
  line between consecutive `$` declarations, which makes multi-line token maps unreadable.
  Narrowed the rule's `except` list instead of deleting the blank lines, and documented it.
- **15 × `scss/comment-no-empty`** — the repository's prose-comment style uses a bare `//`
  as a separator inside a comment block. Root `.stylelintrc.json` had already decided this
  and set the rule to `null`; the web copy had not. Aligned, not invented.
- **5 × `value-keyword-case`** — proper-noun font families. Quoted them, which is both what
  the linter wants and what the CSS spec prefers.
- **1 × `property-no-vendor-prefix`** — `-webkit-text-size-adjust`, the only form iOS
  Safari implements. Declared the unprefixed property too and scoped the disable to that
  single line with the reason on it.
- **1 × `declaration-no-important`** — genuinely new, because the rule had never been
  enabled here. A printed invoice that leaks a "Delete" button is a correctness failure, so
  the `!important` stays with a documented disable rather than losing a specificity race
  that is only discoverable on paper.

### **`P1-25-F-014` — a rule that was skipped, not passing**

`apps/web/.stylelintrc.json` declared the ADR-013 direction guard as
`declaration-property-value-disallowed-list` with `[{}]` as the value list. That is not a
valid option shape, so Stylelint emitted `Invalid Option:` and **skipped the rule** — while
the command still ran and still printed other findings.

Two things were wrong at once: the option shape, and the rule itself. Banning physical
_properties_ needs `property-disallowed-list`; `declaration-property-value-disallowed-list`
bans _values_. The root config had both, correctly. The web config was a half-copy of it.

So the single most important rule in this repository's styling standard — logical properties
so Arabic RTL and English LTR both work — had **never once been enforced**, and a skipped
rule is indistinguishable from a clean one in the output.

Fixed both, and added `apps/web/tests/stylelint-policy.test.ts`: 28 cases that run the real
configuration against deliberate violations and assert each is CAUGHT, plus the inverse
cases so the guard cannot pass by rejecting everything, plus a case asserting the config
reports **no invalid option** at all.

### **`P1-25-F-015` — hosted CI invoked zero web commands**

Not "the web checks were skipped on some paths". `lint:web`, `typecheck:web`,
`style:check:web`, `test:web`, `build:web`, `format:check:web`, `validate:web-tokens` and
`validate:web-brand` appeared in **no workflow at all**.

`scripts/ci/check-command-coverage.mjs` is the answer, and it is a gate rather than a
document. It reads every workspace manifest and every workflow, follows `npm run` edges
transitively — including across `--workspace` boundaries — and fails when a **required**
command is not reachable from `verify:workspaces` **or** is invoked by no workflow. Every
script must be classified (`required` · `informational` · `interactive` · `environment`),
and every register entry must name a script that still exists, so the register can neither
omit a new command nor rot into a description of a repository that no longer exists.

First run: **29/59 in CI, 39/59 locally**. Now **64/64 and 64/64**.

Closing it required real work in both places:

- Root gained `verify:policies`, `verify:repository`, `verify:api`, `verify:web`,
  `verify:contracts`, `verify:inventories` and `verify:classifications`, composed by
  `verify:workspaces`. Twenty validators had lived only in CI and had never been part of
  what a developer runs before pushing.
- `_reusable-node-quality.yml` gained a fourth task, **`web-quality`** — formatting, types,
  lint, Sass, the token and brand gates, the component tier, the production build, and a
  scan of the built client bundle for inlined credentials.
- `web-quality` is wired into `pr-ci.yml`, `protected-develop-verification.yml`, both gate
  `needs` lists, and `DECLARED_JOBS` as **`alwaysRequired: true`**. Not conditional on a
  frontend change: the failure being closed is not "we missed an edit", it is that the
  application's linter had never run, and a job that is skippable on a technicality rots
  the same way.
- The hosted clean room now runs `npm run verify:workspaces` — a fresh clone passing
  exactly what a developer runs, which is the only honest form of that claim.

**A trap worth recording:** collapsing the clean room's enumerated validator list into the
aggregate broke `P1-22-DO-001`, which pins the literal string `npm run
validate:p1-22-inventory` in that file as its DevOps evidence. The enumeration is therefore
kept deliberately, and deliberately redundant — those anchors are how a closed phase proves
its gate still runs, and folding them away would delete the evidence while leaving the
claim. Only the expensive step, the production build, was de-duplicated.

Two pinned counts moved with the work: `scripts/ci` 28 → 29, and `pr-ci.yml` 12 governed
jobs → 13 (14 declared, 15 checks).

**Verified:** `verify:workspaces` exit 0 · unit 1330/1330 across 60 files · web 34/34 ·
Stylelint 0/0 · token gate 33/0 · brand gate 33/0 · command coverage 64/64 both dimensions.

## Stage 1 — workspace normalization — **CLOSED**

Full evidence: [workspace-normalization-evidence.md](workspace-normalization-evidence.md).

| Proof                  | Result                                                                                                                              |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Web Stylelint          | 99 errors → **0 errors, 0 warnings**                                                                                                |
| Command coverage       | **64/64** locally, **64/64** in hosted CI (was 39/59 and 29/59)                                                                     |
| Docker                 | image builds, container starts, HEALTHCHECK `healthy`, uid 1001, no package manager, no web source, 36 runtime packages             |
| Backend tier           | **1752/1752** across 75 files — identical to the pre-move value                                                                     |
| Database / RLS tier    | **1636/1636** across 138 files — identical to the pre-move value                                                                    |
| Schema hash            | `a677eb05…` — identical to the recorded baseline                                                                                    |
| RLS matrix             | 113 tables, 1356 cells, pass · RLS disabled 0 · not forced 0 · SECURITY DEFINER 0                                                   |
| `BYPASSRLS`            | `app_runtime`, `app_readonly`, `app_worker` — all false, none superuser                                                             |
| Dependency equivalence | 0 upgrades, 0 downgrades, 0 added, 0 removed, 0 unexplained drift                                                                   |
| Audits                 | 0 vulnerabilities in root, API and web · 0 waivers                                                                                  |
| Runtime smoke          | API container serves `/api/v1/**` guarded; web serves `/en` LTR and `/ar` RTL with no secrets in client output and no cross-imports |
| Migrations             | 119 · no 120 · historical diff 0 · `supabase/` diff 0                                                                               |

### Findings from Stage 1

- **`P1-25-F-014` (High)** — the `apps/web` Stylelint RTL guard was declared with an
  invalid option shape, so Stylelint **skipped** it while the command still exited zero. The
  most important rule in the styling standard had never once been enforced. Fixed, and
  `apps/web/tests/stylelint-policy.test.ts` now proves each rule fires.
- **`P1-25-F-015` (High)** — hosted CI invoked **zero** web commands. Closed by
  `scripts/ci/check-command-coverage.mjs`, the `web-quality` CI job, and the clean room
  now running the aggregate itself.
- **`P1-25-F-016` (Medium)** — the Dockerfile never copied `apps/api/package.json`, so
  `npm ci` would have failed outright against the workspace lockfile. It was broken, not
  merely stale.
- **`P1-25-F-017` (Low)** — the RLS matrix could not classify `_realtime` or
  `supabase_functions`. Both are Supabase-managed and absent from the CI postgres
  container. Classified with evidence: `_realtime.tenants` is the Realtime service's own
  registry of Supabase _projects_ (one row, `realtime-dev`), **not** RootLco tenant data —
  written down because misreading that table name is the obvious mistake.

### Deliberately deferred, and why

- **CodeQL full-tree figures.** CodeQL has no path filter, so both workspaces were always in
  scope; only the repository's own SARIF policy needed its prefixes moved, which is done and
  tested. A CodeQL _pull-request_ run is diff-informed and cannot establish the repository
  ceiling, so Critical/High/Medium are read from the protected-branch push after merge.
- **Container image-size ratchet.** The recorded baseline is an uncompressed Linux figure
  from a hosted runner; this was a local Windows build with different platform binaries.
  Comparing them would put a false measurement in the record. The hosted
  `container-security` job owns that ratchet.

## Stage 2, 3, 5 and 8 — shell, sidebar, data table, shared states — **COMPLETE**

Commits `bd67e6d` (shell, sidebar, states) and `8f5075a5` (data table).

### Stage 2 — dashboard shell

`app/[locale]/(dashboard)/` with `layout`, `page`, `loading`, `error` and
`not-found`. The group is parenthesised so it adds no URL segment — an operator's
URL names what they are looking at, not the layout wrapping it.

`AppShell` provides the sidebar region, header, main landmark, optional secondary panel,
tablet drawer and collapse. `PageHeader` provides breadcrumbs, the single `h1`, a
description and a page-actions slot.

Decisions worth not re-deriving:

- `#main` carries `tabIndex={-1}`. Without it the skip link scrolls to main but leaves
  focus in the document, so the next Tab returns to the navigation the user just skipped.
- The drawer moves focus in on open and **back to its trigger** on close.
- The collapse preference is read through `useSyncExternalStore`
  (`src/lib/use-persisted-flag.ts`), **not** `useState` + `useEffect`. `localStorage`
  cannot be read during render, and the effect shape renders twice and visibly
  un-collapses the sidebar for one frame on every load. `react-hooks/set-state-in-effect`
  flagged it and the rule was right.
- `app/[locale]/page.tsx` was **removed**: the overview replaces the spine proof page and
  both resolved to `/[locale]`, which Next.js refuses.

### Stage 3 — configuration-driven sidebar

`src/config/navigation.ts`: 15 module definitions in 5 groups, each with a stable key,
translation key, icon, route, required permission, status and scope.

**Only `overview` and `gallery` are `status: 'available'`.** Everything else is
`'planned'` and renders as visibly unavailable rather than as a link that 404s — an
operator who clicks a module and lands on a missing page learns the navigation lies.

`src/lib/permissions.ts` is usability-only and enforces two properties mechanically:
**unknown means denied** (a capability set that failed to load yields an EMPTY sidebar, not
a complete one), and **no role shortcuts** — no `isAdmin`, no tenant/company/branch read
from client state, only explicit permission codes matched exactly.

### Stage 5 — server-driven data table

`src/components/data-table/`: `table-state.ts` (the contract) and `DataTable.tsx`.

Nothing in the module sorts, filters or paginates an array. The URL rule is the
security-relevant part and is enforced by **two independent rules**: a filter serialises
only if its key is registered **and** its value is one the definition declares, plus a
refused-key list for names like `vin`, `phone`, `plate`, `amount`, `sessionId`.
`search` is inside the prohibition deliberately — it is the likeliest place for a
customer's name to reach a proxy log — so it lives in memory and is never written or
restored.

A denied table renders **instead of** the rows, never over them.

### Stage 8 — shared states

Loading, skeleton, empty, no-results, error, permission-denied, not-found,
backend-unavailable, conflict, session-expired. None renders a stack trace, SQL, an
internal path or anything revealing whether a record the actor may not see exists. The
error boundary shows `error.digest`, never `error.message`.

### Stage 9 — i18n, partial

Complete: both catalogues (87 keys), locale config, `lang`/`dir` applied server-side so
there is no direction flash, and `tests/i18n.test.ts` proving key parity, no empty
messages, no untranslated English left in the Arabic file, and namespaced keys.

Not yet: the locale-switch control, and locale-safe date/time/number/money formatting.

### Stage 9 remainder, and Stages 4, 6, 7, 10–20 — **COMPLETE**

The locale switcher ships as a server-rendered pair of links, not a client control: a
`<select>` that navigates on change is invisible to a keyboard user who is only
arrowing through options, and it needs JavaScript to do the one thing it exists for.
Locale-aware date, time, number and money formatting is in `src/lib/format.ts`, and
money never passes through it as a number — see below.

**Stage 4 — component gallery** at `/[locale]/gallery`. Every primitive, every state,
every overlay, both directions. It is the surface the browser review and the print check
run against, and it is **off unless `ROOTLCO_ENABLE_GALLERY` is set** — an internal
proof surface is not a production route.

**Stage 6 — form framework.** Field, label, description, error, fieldset, required
marker, and the submit lifecycle. Errors are announced, not merely coloured; the first
invalid field receives focus on a failed submit; the form is disabled during flight and
the button says so.

Money is the part worth not re-deriving. `src/lib/money.ts` treats a monetary amount as
a **canonical decimal string** end to end and never converts it to a JavaScript number.
The database column is `numeric(18,4)` — 14 integer digits and 4 decimals, 18
significant digits in total, which is more than an IEEE-754 double carries. Parsing
`"1234567890123.4567"` into a double and back does not return the same value, and an
invoice that changes when it is displayed is a defect regardless of how small the change
is. `compareMoney` walks digits. The single call to `globalThis.Number` in the whole
money path is isolated in `displayNumber`, which formats the integer and fraction parts
**separately** so no full amount is ever a double.

**Stage 7 — overlays.** Dialog, drawer, tabs, toast region, and three confirmation kinds:
plain, destructive, and required-reason. In a destructive confirmation **Cancel** takes
initial focus, not the destructive action — a reflexive Enter should not delete anything.
The required-reason dialog resets its text **during render** against a `wasOpen` flag
rather than in an effect; resetting in an effect renders the previous invocation's reason
for one frame, which is the kind of defect that only shows up on a slow machine
(`P1-25-F-021`).

**Stage 10 — typed API client.** `src/lib/api/client.ts`. `get` retries at most twice
and only for `unavailable`, `network` and `timeout`. **`send` is never retried**,
for any status, ever: the client cannot know whether a POST that timed out was applied,
and the backend's idempotency keys are the mechanism for safe replay — a blind client
retry is how a customer gets billed twice. Every request carries `x-correlation-id`.

The import boundary is enforced mechanically by `apps/web/scripts/check-api-boundary.mjs`
across five rules — no raw `fetch` outside `src/lib/api`, no web import of API source,
no Supabase import in the web tree, no `server-only` module reached from a client
component, no `dangerouslySetInnerHTML`. **37 files, 0 violations.**

**Stages 11–15** — accessibility automation, print foundation, frontend security,
Playwright, and the complete frontend CI wiring. **Stages 16–20** — browser-led review,
performance baseline, adversarial review, this documentation package, and the clean-room
proof.

## Findings 018–025 — the second half

`P1-25-F-001` … `P1-25-F-017` are recorded above. These eight came from the browser
review, the adversarial pass and hosted CI.

- **`P1-25-F-018` (Medium)** — the gallery was **prerendered**. `galleryEnabled()` was
  evaluated at build time, so the `notFound()` decision was baked into a static page and
  the environment variable had no effect at runtime. Setting the flag on a running server
  did nothing. Fixed with `export const dynamic = 'force-dynamic'`. A feature flag that
  is read once at build time is not a feature flag.
- **`P1-25-F-019` (Low)** — the flag was named `NEXT_PUBLIC_ENABLE_GALLERY`. Next
  **inlines** every `NEXT_PUBLIC_*` value into the client bundle at build time, so the
  name promised a server-side switch while shipping a client-side constant. Renamed to
  `ROOTLCO_ENABLE_GALLERY`, which is server-only by construction.
- **`P1-25-F-020` (Medium)** — the API client could not tell a **timeout** from a
  **caller cancellation**. Both arrive as an `AbortError` `DOMException`, so a
  cancelled request was reported to the user as a backend timeout, and — worse — a
  cancellation was eligible for the retry path that only timeouts should reach. Fixed with
  an explicit `timedOutHere` flag set by our own timer plus a `TimeoutError` check.
- **`P1-25-F-021` (Low)** — the required-reason dialog reset its text in an effect. See
  Stage 7 above.
- **`P1-25-F-022` (High)** — **the CSP broke every page.** The policy shipped
  `script-src 'self'` with no nonce, which blocks Next's own inline bootstrap, so the
  application rendered blank. The browser smoke caught it only because it asserts an empty
  console; a screenshot would have shown a white page and the build would have taken the
  blame.

  The fix is a per-request nonce in `middleware.ts`, **not** `'unsafe-inline'`. The
  cost is stated rather than hidden: a nonce is per-request, so the locale routes are
  rendered per request instead of prerendered. Static delivery is traded for a policy that
  actually holds — the right trade, because every operational screen from P1-26 onward is
  authenticated and dynamic anyway, and a prerendered page with a disabled CSP is fast and
  unprotected.

  `'strict-dynamic'` was tried and removed on the same evidence. It disables host-based
  allowlisting, so `'self'` stops applying and every `<script src>` chunk needs its own
  nonce — which Next does not do; it nonces inline scripts only. The result was a page
  whose bootstrap ran and whose chunks were all blocked.

- **`P1-25-F-023` (Medium)** — six classification validators were added to
  `static-quality`, a job with **no database**, and to the local aggregate. Both passed
  on the developer machine because a Supabase stack happened to be running. This is the
  exact "green because of the environment" trap this repository keeps finding, and it is
  why the command register now carries an `environment` tier: a command that needs
  PostgreSQL is not a static check, and calling it one moves the failure to whoever has a
  clean machine. They run in the database-bearing job, which applies every migration
  first.
- **`P1-25-F-024` (Low)** — the web test report was never written. The reporter flags
  were forwarded through **two** `npm run` layers, and the second `--` boundary dropped
  them, so vitest ran on its default reporter and the summariser correctly refused to treat
  a missing report as success. Replaced with explicit `test:ci` / `test:web-ci`
  scripts: the flags now live where the command lives. (A bare `--outputFile` is also
  ambiguous with multiple reporters and must be `--outputFile.json=`.)
- **`P1-25-F-025` (Low)** — `apps/web/playwright-report.json` had been **committed**.
  `.gitignore` carried `playwright-report/` for the directory but not the JSON file, so
  a `git add -A` after a local browser run swept it in. The clean room then regenerated
  it and correctly refused: _"A step modified a tracked file."_ A run report embeds
  absolute developer paths and per-run timings, so a committed one guarantees a diff on
  every subsequent run. The check was right and the artefact was wrong.

### What these eight have in common

Six of the eight were invisible to a local run and to code review. `F-018` and
`F-019` needed a **running server with the flag set**; `F-022` needed a **real
browser**; `F-023` needed a machine **without** a database; `F-024` and `F-025`
needed the **hosted** runner. That is the whole argument for the browser review and the
clean room being gates rather than optional extras.

## Final local verification

Run at the candidate head, in the visible worktree, with no services started by hand
beyond the Supabase stack the database tier requires.

```text
verify:workspaces          exit 0
Unit / component           1330 / 1330   60 files
Web (vitest, 2 projects)    231 / 231    11 files
Browser (Playwright)         81 / 81      5 projects, live nonce CSP, clean console
Backend tier               1752 / 1752
Database / RLS tier        1636 / 1636
Stylelint                     0 errors, 0 warnings
Design-token gate            59 files / 0 raw values
Brand isolation              59 files / 0 violations
API import boundary          37 files / 0 violations
Command coverage             61 / 61 registered-and-invoked, both dimensions
Migrations                  119, no 120, schema hash unchanged
Dependency audit              0 vulnerabilities, 0 waivers
```

The five Playwright projects are desktop-en 1440×900, desktop-ar 1440×900, laptop-en
1280×800, tablet-ar 1024×768, and a reduced-motion project. They run at `workers: 1`
and `retries: 0` — five projects sharing one server produced 11 flaky results at higher
concurrency, and a retry would have hidden that rather than fixed it.

## Command coverage — the gate that makes a hidden check impossible

`scripts/ci/check-command-coverage.mjs` holds a register of every npm script in the
repository and tests **two** things: that each script is registered with a tier and a
stated reason, and that every `required` script is actually **reachable from a workflow
invocation**. It walks `npm run` edges transitively, so a command buried three
aggregates deep still counts as invoked — and a command that no workflow can reach fails
the build.

This exists because of `P1-25-F-015`: hosted CI was invoking **zero** web commands while
every one of them passed locally. The register currently holds **119** commands, **61**
of them `required`, and reports **61 / 61** on both dimensions. The other tiers are
`informational`, `interactive` (a watcher or a dev server, which CI must not run) and
`environment` (needs a database or Docker — `P1-25-F-023`).

A check that exists and is correct has still never proven anything until something makes
it run. This is that something.

## Status

P1-25's **technical** foundation is complete and verified. What remains is not technical:

- the final logo,
- the final colour palette,
- Product Owner fidelity sign-off.

The provisional brand is active and is **declared as provisional in the product itself**,
not only in documentation. `tests/brand-replacement.test.ts` proves the swap is a
configuration change: replacing the brand touches the brand module and the token file, and
**no component file at all**.

**P1-26 has not started.** No P1-26 branch, no `docs/phase-1/phase-1-26/`, no business
module, no Migration 120.
