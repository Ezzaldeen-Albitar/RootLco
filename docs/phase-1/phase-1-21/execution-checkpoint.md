# P1-21 — Inventory Backend — Execution Checkpoint

A living recovery record. Updated after every coherent local commit. **A checkpoint is
not a stopping point.**

## Verified base

| Fact                       | Value                                                                    |
| -------------------------- | ------------------------------------------------------------------------ |
| Verified base SHA          | `bb9cc8813661a4a2e97bf0eff8a8d9c148742ed2` (P1-20 waiver merge)          |
| `origin/main` at start     | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched                   |
| Current branch             | `feature/p1-21-inventory-backend`                                        |
| Current HEAD               | see the wave table below                                                 |
| P1-20 containment verified | `e746253`, `db7ef97`, `21c5e13`, `66b84a2`, `99ebdc4` all CONTAINED      |
| P1-20 decision             | `Go — P1-20 Service Catalog, Pricing, and Quotation Backend Gate Passed` |
| Remote push occurred       | **NO** — nothing pushed; no PR                                           |
| Execution policy           | Temporary Local CI Primary Mode (owner-established, begins P1-21)        |

## Baseline totals (measured at the base SHA, before any P1-21 change)

| Suite / gate                     | Result at base                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Unit (`npm run test`)            | **903 passed / 42 files**                                                                               |
| Database (`npm run test:db`)     | **1610 passed / 136 files**                                                                             |
| Backend (`npm run test:backend`) | **1264 passed / 56 files**                                                                              |
| OpenAPI                          | 155 paths / **185 operations**, every operation guarded                                                 |
| Migrations                       | **119** applied cleanly, no migration 120                                                               |
| Seeds                            | 7 declared files applied **twice**, every business table empty                                          |
| Permissions                      | **96**                                                                                                  |
| Encoding                         | 1265 tracked text files, 0 BOM / 0 U+FFFD / 0 mojibake                                                  |
| Schema hash                      | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                                      |
| Schema totals                    | 242 tables (`inv` 18), 212 functions, 541 triggers, 631 policies, 999 indexes, 0 SECDEF, 0 unforced RLS |
| Classification guards            | 6/6 pass (crm 298, veh 320, apt/rec 454, wo/tech/dia/qms 657, svc/quo/inv 582, sal/wty/rpt 427)         |

Baseline jobs: `quality` **ALL_GREEN**, `secrets` **ALL_GREEN**, `database` **ALL_GREEN**.

## Local-CI command matrix (extracted from `.github/workflows/ci.yml` at the base)

The workflow defines **four** jobs and 36 repository-controlled steps. Local
equivalents run the identical `npm` scripts. Required exit code is `0` for every step.

| #   | Job      | Step                                     | Command                                                   |
| --- | -------- | ---------------------------------------- | --------------------------------------------------------- |
| 01  | quality  | Install dependencies (locked)            | `npm ci`                                                  |
| 02  | quality  | Lint                                     | `npm run lint`                                            |
| 03  | quality  | Module boundary and layering check       | `npm run validate:module-boundaries`                      |
| 04  | quality  | Authorization coverage check             | `npm run validate:authorization-coverage`                 |
| 05  | quality  | Operation-to-test coverage check         | `npm run validate:operation-coverage`                     |
| 06  | quality  | P1-19 endpoint inventory                 | `npm run validate:p1-19-inventory`                        |
| 07  | quality  | P1-20 endpoint inventory                 | `npm run validate:p1-20-inventory`                        |
| 08  | quality  | OpenAPI validation                       | `npm run validate:openapi`                                |
| 09  | quality  | Type check                               | `npm run typecheck`                                       |
| 10  | quality  | Format check                             | `npm run format:check`                                    |
| 11  | quality  | Style lint (SCSS)                        | `npm run style:check`                                     |
| 12  | quality  | Encoding hygiene                         | `npm run validate:encoding`                               |
| 13  | quality  | Unit tests                               | `npm run test`                                            |
| 14  | quality  | Production build                         | `npm run build`                                           |
| 15  | docker   | Validate compose file                    | `docker compose config --quiet`                           |
| 16  | docker   | Build dev stage                          | `docker build --target dev`                               |
| 17  | docker   | Build production runner stage            | `docker build --target runner`                            |
| 18  | docker   | Assert non-root runtime                  | `docker run --entrypoint sh … 'id -u'` ≠ 0                |
| 19  | database | Install dependencies (locked)            | `npm ci`                                                  |
| 20  | database | Migration immutability (PR-only)         | `git diff --diff-filter=MDR … supabase/migrations/` empty |
| 21  | database | Apply all migrations to a clean database | `npm run db:apply-migrations`                             |
| 22  | database | Apply declared seeds twice               | `npm run validate:seed-state`                             |
| 23  | database | CRM classification                       | `npm run validate:crm-classification`                     |
| 24  | database | Vehicle classification                   | `npm run validate:veh-classification`                     |
| 25  | database | Appointment/Reception classification     | `npm run validate:aptrec-classification`                  |
| 26  | database | WO/Tech/Dia/QMS classification           | `npm run validate:wo-tech-dia-qms-classification`         |
| 27  | database | SVC/QUO/INV classification               | `npm run validate:svc-quo-inv-classification`             |
| 28  | database | SAL/WTY/RPT classification               | `npm run validate:sal-wty-rpt-classification`             |
| 29  | database | Database suite                           | `npm run test:db`                                         |
| 30  | database | Backend foundation suite                 | `npm run test:backend`                                    |
| 31  | secrets  | Tracked environment-file guard           | `git ls-files --error-unmatch .env …` must fail           |
| 32  | secrets  | Tracked key material                     | no tracked `*.pem/key/p12/pfx`                            |
| 33  | secrets  | Scope-exclusion guard                    | `node scripts/check-scope-exclusions.mjs`                 |
| 34  | secrets  | Tracked credential patterns              | `npm run security:tracked-secrets`                        |
| 35  | secrets  | Browser service-role guard               | `npm run security:browser-secrets`                        |
| 36  | secrets  | No fake/demo business data               | `npm run validate:no-fake-data`                           |

Workflow environment reproduced locally: `NEXT_TELEMETRY_DISABLED=1`,
`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY=ci-placeholder-anon-key-not-a-secret`,
`NEXT_PUBLIC_APP_ENV=local`, and `DB_*` pointing at an isolated PostgreSQL 17.10
container. Database-backed suites run **serially**; no two suites ever share a
database concurrently.

Stated local deviations (recorded, not hidden): Node 24.16.0 locally vs Node 22 in the
workflow; no GitHub Actions layer cache for the Docker stage; the workflow's
migration-immutability step is `pull_request`-only and is reproduced as an explicit
diff check.

## Waves

| Wave | Content                                                            | Status   | Commit              |
| ---- | ------------------------------------------------------------------ | -------- | ------------------- |
| 0    | Baseline verification + local-CI command matrix                    | **DONE** | `docs` commit below |
| 1    | Protected inventory contract archaeology                           | **DONE** | `docs` commit below |
| 2    | Inventory module foundation                                        | pending  | —                   |
| 3    | Item search, opening balances, availability                        | pending  | —                   |
| 4    | Reservations + concurrency protection                              | pending  | —                   |
| 5    | Issue / return / damage / customer-supplied / external purchase    | pending  | —                   |
| 6    | Movement history, negative stock, audit, business-reference matrix | pending  | —                   |

## Discovered contracts (full detail in `wave-1-contract-archaeology.md`)

- Quantity is `numeric(12,3)` everywhere; cost is `numeric(18,4)`; every quantity
  CHECK is `> 0`, so **zero is never a legal quantity**.
- Stock is **stored** in `inv.stock_balances` and coherence-guarded against the
  movement ledger; `available_qty` is `GENERATED` as `on_hand − reserved`.
- Negative stock is enforced by three CHECK constraints on `inv.stock_balances`, not
  by application arithmetic.
- `inv.lock_stock_balance(...)` `FOR UPDATE` is the single serialization point per cell.
- Legal business references are exactly `opening_line`, `part_issue`, `part_return`,
  `damage`, `adjustment`. There is no `transfer`, `customer_supplied`, or
  `external_purchase` movement kind.
- Customer-supplied parts and external-purchase parts generate **no movement and no
  balance change** by protected contract.
- `inv.stock_movements` is granted SELECT + INSERT only — corrections are new
  movements, never edits.

## Schema reconciliations

No new migration is required. Every write P1-21 performs uses an existing
`app_runtime` grant or an existing `SECURITY INVOKER` function. **No DBCR raised.**

## Confirmed findings carried into implementation

| ID           | Severity | Finding                                                                                                                                                                                                                                                                                           |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `P1-21-D-01` | High     | `inv.issue_part` posts the `out` movement before consuming the reservation, so issuing against a reservation covering all available stock fails `ck_stock_balances_available` (`23514`). Reproduced on a live database. Backend orchestrates the granted primitives in the correct order instead. |
| `P1-21-D-02` | High     | `inv.issue_part` reads `wo.work_orders.state` and never checks it; a `draft` work order accepts an issue. No trigger enforces it either. Backend owns the issuable-lifecycle rule.                                                                                                                |
| `P1-21-D-03` | High     | `inv.issue_part` accepts a reservation belonging to a different item/location/work order and consumes it. Backend validates reservation coherence before use.                                                                                                                                     |
| `P1-21-D-04` | Low      | The reservation-expiry scheduler and the `parts_forward_state` closure blockers are assigned to P1-21 by earlier phases but sit outside the canonical 15-task scope, and the database closure guard would need an unauthorized migration. Carried forward explicitly.                             |

## Local-CI / clean-room status

| Proof                         | Status                                                                  |
| ----------------------------- | ----------------------------------------------------------------------- |
| Baseline local CI at base SHA | **PASSED** (quality / secrets / database all green)                     |
| Final exact-SHA local CI      | not yet run — awaits the final feature SHA                              |
| Fresh exact-SHA clean room    | not yet run — awaits the final feature SHA                              |
| Hosted GitHub Actions         | unavailable (university-account billing lock); never claimed as passing |

## Exact next action

Wave 2 — create the `inventory` module skeleton (domain vocabulary, exact quantity
value object, repository, services, public surface) under
`src/modules/inventory/`, following the `service-catalog` / `work-order` module
conventions, then commit and continue to Wave 3.
