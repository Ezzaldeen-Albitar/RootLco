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

## Next action

**Finish the topology normalization first** — move the root backend into `apps/api/` as `@rootlco/api`, repoint the 723 path references, update the Dockerfile and workflows, regenerate the path-pinned evidence, and re-run the full backend baseline. Only then **Wave 1 — dashboard shell**: locale-aware `(dashboard)` route group, responsive shell,
header, breadcrumbs, page-title and page-actions regions, landmarks, skip link, tablet
behaviour. Then Wave 2, the configuration-driven sidebar.

Exact next command:

```bash
cd "C:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco-worktrees/p1-25"
git status --short --branch     # expect clean on feature/p1-25-…
```
