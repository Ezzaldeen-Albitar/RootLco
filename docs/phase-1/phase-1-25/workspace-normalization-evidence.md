# P1-25 — Workspace normalization evidence

Measured against the feature branch `feature/p1-25-frontend-architecture-design-system`,
protected base `origin/develop` at `cef7fdf296ac65e7f789231b06c718f0a7f2cf2a`.

Every figure below was produced by running the command named beside it. Nothing here is
carried over from a previous phase or inferred from a manifest.

---

## 1. Topology

| Property                                         | Value                                        |
| ------------------------------------------------ | -------------------------------------------- |
| Root coordinator                                 | `rootlco-platform`, `workspaces: ["apps/*"]` |
| API workspace                                    | `@rootlco/api` at `apps/api`                 |
| Web workspace                                    | `@rootlco/web` at `apps/web`                 |
| Root `src/`, `web/`, `public/`, `next.config.ts` | absent                                       |
| Root lockfile                                    | 1                                            |
| Nested lockfiles                                 | 0                                            |
| API route files                                  | 196                                          |
| Tracked symlinks under `apps/`                   | 0                                            |
| Security overrides                               | root only (`postcss`, `sharp`, `fast-uri`)   |

The move itself landed as **451 Git renames** with a byte-identical file inventory
(`refactor(api): move backend application into workspace`).

---

## 2. Quality-gate coverage

`scripts/ci/check-command-coverage.mjs` reads every workspace manifest and every workflow,
follows `npm run` edges transitively — including across `--workspace` boundaries — and
fails when a **required** command is unreachable from `verify:workspaces` or invoked by no
workflow.

| Measurement                        | First run | Now    |
| ---------------------------------- | --------- | ------ |
| Required commands                  | 59        | 64     |
| Reachable from `verify:workspaces` | 39        | **64** |
| Invoked by hosted CI               | 29        | **64** |

The register classifies all 112 commands as `required`, `informational`, `interactive` or
`environment`. A new script cannot be added without a classification, and a register entry
that names a deleted script fails the gate.

---

## 3. Stylelint

| Measurement            | Before | After |
| ---------------------- | ------ | ----- |
| `apps/web` errors      | 99     | **0** |
| `apps/web` warnings    | —      | **0** |
| Rules silently skipped | 1      | **0** |

The skipped rule is finding `P1-25-F-014` and is recorded in the findings register.
`apps/web/tests/stylelint-policy.test.ts` (28 cases) now proves each rule fires.

---

## 4. Docker — API-only image

Built and run locally from this tree. `docker build --target runner`.

| Property                                   | Result                                                                                              |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Image builds                               | yes                                                                                                 |
| Production build source                    | `apps/api` (`npm run build` delegates to `@rootlco/api`)                                            |
| Entry point                                | `node apps/api/server.js`                                                                           |
| `/api/health`                              | 200                                                                                                 |
| `/api/v1/health/live`                      | 200 `{"status":"alive"}`                                                                            |
| `/api/v1/health/ready`                     | 503 `{"database.reachable": false}` — the correct answer with no database attached, not a crash     |
| `/api/v1/customers`                        | 401 — a real business route, reachable and still guarded                                            |
| Docker `HEALTHCHECK`                       | `healthy`                                                                                           |
| Runtime user                               | uid 1001, gid 1001, non-root                                                                        |
| `npm`/`npx`/`yarn`/`pnpm`/`corepack`/`apk` | none resolve                                                                                        |
| `/app/apps` contents                       | `api` only                                                                                          |
| Web source in the image                    | none                                                                                                |
| Frontend tooling in the image              | none — no `tailwindcss`, `playwright`, `jsdom`, `vitest`, `stylelint`, `eslint`, `@testing-library` |
| Runtime packages shipped                   | 36                                                                                                  |
| `dev` stage + `docker compose config`      | both build and validate                                                                             |

**Image size is deliberately not compared to the recorded baseline here.** That baseline
(`202909674` bytes) is an uncompressed figure from a GitHub-hosted Linux runner; this was a
local Windows build with different platform binaries. The two numbers are not comparable,
and recording the local figure as a ratchet comparison would put a false measurement in the
record. The hosted `container-security` job owns that ratchet.

---

## 5. Backend and database tiers, re-run after the move

Against the local Supabase stack, 119 migrations applied by `supabase db reset`.

| Tier             | Files | Tests    | Failed | Skipped |
| ---------------- | ----- | -------- | ------ | ------- |
| Unit / component | 60    | **1330** | 0      | 0       |
| Web component    | 2     | **34**   | 0      | 0       |
| Backend          | 75    | **1752** | 0      | 0       |
| Database / RLS   | 138   | **1636** | 0      | 0       |

Backend and database totals match their pre-move historical values exactly (1752, 1636).
The unit tier grew from 1307 to 1330 through tests added by this phase.

---

## 6. Database invariants

| Property                         | Value                                                                |
| -------------------------------- | -------------------------------------------------------------------- |
| Migrations                       | 119                                                                  |
| Migration 120                    | absent                                                               |
| Historical migration diff        | 0                                                                    |
| `supabase/` diff                 | 0                                                                    |
| Schema hash                      | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`   |
| Schema hash vs recorded baseline | identical                                                            |
| RLS matrix (critical)            | 113 tables, 1356 cells, **pass**                                     |
| RLS disabled                     | 0                                                                    |
| RLS not forced                   | 0                                                                    |
| `SECURITY DEFINER` functions     | 0                                                                    |
| `BYPASSRLS` on runtime roles     | `app_runtime`, `app_readonly`, `app_worker` — all `f`, all non-super |

### A schema-classification gap found here

The RLS matrix refused to report clean over two schemas it could not classify:
`_realtime` and `supabase_functions`. Both are created by the Supabase local stack and
absent from the bare postgres container CI uses, which is why they had never appeared.

They are now recorded in `NON_APPLICATION_SCHEMAS` **with the evidence**, not by assertion.
`_realtime` carries a table named `tenants` and a column named `tenant_external_id`, and
neither means a RootLco tenant — they are the Realtime service's own registry of Supabase
_projects_. Verified against the running stack: one row, `realtime-dev`, the project itself.
No RootLco migration creates anything in either schema. Reading that table name as
application multi-tenancy is the obvious mistake, so the reason says so in the file.

---

## 7. Dependency equivalence

Compared the API's production dependency graph before the move (root package at `d8d7896`)
against after (`@rootlco/api`), using both manifests and the resolved lockfile.

| Measurement                              | Result                                      |
| ---------------------------------------- | ------------------------------------------- |
| Direct production dependencies           | 8 before, 8 after, **all identical ranges** |
| Resolved production packages in lockfile | 114 before, 115 after                       |
| Unexpected upgrades                      | **0**                                       |
| Unexpected downgrades                    | **0**                                       |
| Added packages                           | **0**                                       |
| Removed packages                         | **0**                                       |
| Unexplained drift                        | **0**                                       |
| Missing API runtime dependencies         | **0**                                       |
| Web-only dependencies owned by the API   | **0**                                       |
| Web-only packages in the final image     | **0**                                       |
| Dependency vulnerabilities               | **0** in root, API and web trees            |
| Dependency waivers                       | **0**                                       |

The single 114 → 115 delta is `node_modules/@rootlco/api → apps/api`, a workspace **link**
rather than a downloaded package. That is the workspace registering itself, and it is the
whole of the difference.

`apps/api` declares the runtime it imports while the root still declares the same versions
for the repository-level test tiers. Removing the root copies is a separate, verified step:
an unverified removal breaks `npm test` in a way no static check catches.

---

## 8. Runtime smoke — the two applications, independently

| Application | Check                                | Result                                             |
| ----------- | ------------------------------------ | -------------------------------------------------- |
| API         | boots from `apps/api`                | yes, in the production container                   |
| API         | readiness                            | 503 with `database.reachable: false` when detached |
| API         | `/api/v1/**` unchanged               | yes — 401 on a guarded business route              |
| API         | cwd or missing-path errors           | none                                               |
| API         | dependency on web output             | none                                               |
| Web         | boots from `apps/web`                | yes, `next start -p 3210`                          |
| Web         | `/`                                  | 307 to the locale route                            |
| Web         | `/en`                                | 200, `<html lang="en" dir="ltr">`                  |
| Web         | `/ar`                                | 200, `<html lang="ar" dir="rtl">`                  |
| Web         | server-only secrets in client output | **0** occurrences                                  |
| Web         | imports of API or Supabase source    | **none**                                           |
| Web         | server-log errors or warnings        | none                                               |

---

## 9. CodeQL

CodeQL is configured with **no `config-file` and no `paths` filter**, so it analyses the
whole repository by default. Nothing excluded `src/` before the move and nothing excludes
`apps/**` now — the source did not leave CodeQL's view when it moved directories.

What DID need changing is the repository's own policy over the SARIF:
`scripts/ci/codeql-policy.mjs` classified application findings by the prefix `src/`, which
after the move matched nothing. `APPLICATION_PREFIXES` is now
`['apps/api/src/', 'apps/web/src/']`, and `tests/ci/codeql-policy.test.ts` asserts both that
the new prefixes are application paths **and that the pre-workspace spelling is not** — a
finding at a path that no longer exists must not keep application privilege by accident.

A CodeQL **pull-request** run is diff-informed and says so in its own output; it cannot
establish the repository ceiling. The full-tree result is produced by the protected-branch
push after merge, and that is where the Critical/High/Medium figures are read from.

---

## 10. Findings opened during Stage 1

| ID            | Severity | Summary                                                                                                                                                                                         |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-25-F-014` | High     | `apps/web` Stylelint declared the ADR-013 direction guard with an invalid option shape, so Stylelint **skipped** it while the command still exited zero. The rule had never once been enforced. |
| `P1-25-F-015` | High     | Hosted CI invoked **zero** web commands. Every `apps/web` gate was green only in the sense that nothing had ever run it.                                                                        |
| `P1-25-F-016` | Medium   | The Dockerfile did not copy `apps/api/package.json`, so `npm ci` would have failed outright against the workspace lockfile.                                                                     |
| `P1-25-F-017` | Low      | The RLS matrix could not classify `_realtime` and `supabase_functions`, which exist in a Supabase-managed environment but not in the CI postgres container.                                     |

`P1-25-F-011` (a suppression comment that suppressed nothing) and `P1-25-F-012` (a
brand-swap proof that could not run on a dirty tree) were opened and closed during the
preceding atomic move and are recorded in the execution checkpoint.
