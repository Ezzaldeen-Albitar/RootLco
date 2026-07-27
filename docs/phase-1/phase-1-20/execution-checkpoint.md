# P1-20 execution checkpoint

> Single source of truth for resuming P1-20. Update it before any long operation
> and after every wave.

## Protected baseline (Wave 0 — verified, not assumed)

| Key                             | Value                                                                                                                            |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `P1_19_VERIFIED_FINAL_GATE_SHA` | `0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0`                                                                                       |
| `P1_20_BASE_SHA`                | `0d86a198ad1d13aa0b3219a8f6ecafea3a699cf0`                                                                                       |
| P1-19 containment               | `d8278c7` (feature merge), `da0b8b2` (reviewed feature), `600ca9c` (reviewed gate) — **all three ancestors of `origin/develop`** |
| `origin/develop` parents        | `d8278c7` + `600ca9c` — the gate merge itself, unchanged since P1-19 closed                                                      |
| P1-19 gate decision             | `Go — P1-19 Work Order, Diagnostics, and Technician Backend Gate Passed` (verified in the file on `develop`)                     |
| `origin/main`                   | `491c4e0882763b5d5864737e63b4e31ca708a6b5` — untouched                                                                           |
| Authoritative branch            | `feature/p1-20-service-catalog-pricing-quotation-backend`, created at `0d86a19`                                                  |

### Recovery outcome — **Case A, no collision**

Searched local branches, remote branches, worktrees, and commit messages for
`p1-20`/`P1-20`. Found: **no** local branch, **no** remote branch, **no** PR, **no**
worktree, **no** `docs/phase-1/phase-1-20/`, **no** `src/modules` addition for
service/pricing/quotation, and a clean working tree. The single `git log` hit is
`e55fec9 [P1-10] …`, the _database_ phase, which is expected and unrelated.
No concurrent queue execution created P1-20 work. Canonical branch created fresh.

### Baseline measurements (recalculated, not inherited)

| Metric        | Value                                                              | How                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit          | **843**                                                            | `npm run test` — 841 passed + 2 cold-cache timeouts, both green on re-run (`592ms`/`717ms`) with a raised timeout. Environmental, not a baseline defect; hosted CI #245 was 4/4 on this SHA. |
| Database      | **1610**                                                           | `npm run test:db` — 136 files, all passed, exit 0                                                                                                                                            |
| Backend       | **1077**                                                           | `npm run test:backend` — 52 files, all passed, exit 0                                                                                                                                        |
| OpenAPI       | **140 paths / 168 operations**                                     | counted from `docs/api/openapi.v1.json`                                                                                                                                                      |
| Migrations    | **119**, no 120                                                    | `supabase/migrations`                                                                                                                                                                        |
| Permissions   | **93**                                                             | `SELECT count(*) FROM iam.permissions`                                                                                                                                                       |
| Event catalog | **31** entries                                                     | `EVENT_CATALOG` in `src/server/events/envelope.ts`                                                                                                                                           |
| Schema hash   | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` | P1-19 baseline, to be re-proven in clean room                                                                                                                                                |

## Wave status

| Wave | Scope                                                               | Status                                               |
| ---- | ------------------------------------------------------------------- | ---------------------------------------------------- |
| 0    | Protected baseline + recovery                                       | **Done**                                             |
| 1    | Contract archaeology                                                | **Done** — `evidence/wave-1-contract-archaeology.md` |
| 2    | Module foundation                                                   | **In progress**                                      |
| 3    | Service catalog, availability, labour time (BE-001…003)             | Not started                                          |
| 4    | Price lists, selection, tax, discount, decimal (BE-004/005/006/014) | Not started                                          |
| 5    | Quotation create/revise/issue/expire (BE-007/010/011)               | Not started                                          |
| 6    | Decisions and evidence (BE-008/009/012)                             | Not started                                          |
| 7    | Additional-work integration (BE-013)                                | Not started                                          |
| 8    | SEC/QA/DO/DOC                                                       | Not started                                          |

## Decisions fixed by the catalog (do not re-litigate)

1. **Financial policy is derived, not chosen.** `ck_quotation_items_tax_amount`
   and `ck_quotation_items_line_total` fix tax as **per line**, **discount before
   tax**, **tax exclusive**, **`round(…, 4)`** (PostgreSQL half-away-from-zero).
   Revision totals are pure sums, never re-rounded.
2. **PostgreSQL is the calculation engine.** Amounts are computed in SQL `numeric`
   in the same expression shape as the CHECKs. `Decimal`/`Money`
   (`src/modules/pricing/domain/`) parse, compare, and serialize only — no
   authoritative arithmetic, no `number`, no new dependency.
3. **Decisions are per ITEM.** `quo.record_item_decision` and
   `uq_approval_decisions_item` are item-keyed. Revision-level outcome is derived.
4. **Routes use sub-resource nouns, not `:action`** — the registry `PATH_PATTERN`
   cannot express a colon suffix.
5. **Event names carry no `.v1`** — shipped catalog uses `schemaVersion` instead.
6. **`quo.quotations.work_order_id` is NOT NULL** — no standalone quotations.
7. **No migration, no DBCR.** `app_runtime` already holds every needed grant.

## Accepted limitations (open, to be carried into the gate)

| Id           | Severity | Statement                                                                                                                                                                                                                                                          |
| ------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `P1-20-A-01` | Low      | `svc.branch_service_availability` has no effective-date columns; availability is a single current row per `(company, branch, service)`. The phase prose's "effective period" and "overlap constraints" do not exist in the protected schema and were not invented. |
| `P1-20-A-02` | Low      | `svc.standard_labor_times` hangs off `service_version_id` only. There is **no** branch override for labour time in the protected schema.                                                                                                                           |

## Known defects / review findings

None yet.

## Current PR / CI

None yet.

## Exact next action

Finish Wave 2: `service-catalog`, `pricing`, `quotation` module skeletons
(`domain`/`data`/`application`/`index.ts`), register new permission codes in
`supabase/seeds/04_iam_permission_catalog.sql`, add `svc`/`quo` entries to
`EVENT_CATALOG`, then run `validate:module-boundaries` + `typecheck`.
