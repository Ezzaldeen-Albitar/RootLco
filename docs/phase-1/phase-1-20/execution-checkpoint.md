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

## Commits on the feature branch

| SHA       | What                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `84618ea` | Wave 0–1 evidence + `Decimal`/`Money` + `service-catalog` module (domain, repository, service, surface)  |
| `e269d52` | `pricing` module — `PriceResolutionService`, `DiscountAuthorizationService`, `iam.callerApprovalCeiling` |
| `0b838e1` | `quotation` domain + repository (money computed in SQL, verified against the live CHECKs)                |

Verified green at `e269d52`: `tsc --noEmit` exit 0, `eslint` 0 problems,
`format:check` clean, `validate:module-boundaries` OK (335 files),
56/56 new unit tests (32 decimal + 24 discount).

## Design decisions made during implementation

- **`iam` owns the approval ceiling.** `callerApprovalCeiling` was added to
  `AuthorizationRepository` + `AccessAdministrationService` and exposed as
  `iamModule().access.callerApprovalCeiling`. `pricing` depends on a narrow
  `ApprovalCeilingReader` port, so it cannot reach the rest of that surface.
  A direct read of `iam.approval_limits`/`iam.role_grants` from `pricing` was
  written first and removed — it breached ADR-001 rule 3.
- **`Decimal` exposes `scale` and `scaledUnits`** so the percentage-threshold
  comparison derives its scaling exponent instead of assuming `numeric(_,4)`.
- **BigInt values are constructed, not literal** — build targets ES2017.
- **`svc` is split by aggregate**: `service-catalog` owns services/categories/
  versions/labour/availability; `pricing` owns lists/versions/rules/assignments/
  discounts/policies **and** the `org.tax_*` reads.

## Two self-corrections worth not repeating

1. `assertPercentageRange` used `parseFloat` — the exact pattern the phase
   forbids for a financial value. Replaced with the exact comparator.
2. A zero-base guard in `exceedsThreshold` was **unreachable** (a non-zero
   discount on a zero base is already refused as exceeding the base). Removed
   rather than left as an untestable claim; the test now pins the ordering.

## Known defects / review findings

None open. No adversarial review has run yet.

## Current PR / CI

None yet — branch is local only, not pushed.

## Exact next action

Wave 2 remainder, in this order:

1. **`quotation` application services + `index.ts`.** Needed:
   `QuotationService` (create → revise → issue → expire, each locking
   `quo.quotations` FIRST), `QuotationDecisionService` (per-item decision,
   evidence, roll-up via `rollUpDecisions`), and an
   `AdditionalWorkLinkService` for BE-013. Composition root wires
   `serviceCatalogModule()`, `pricingModule()` and
   `sharedServicesModule()` (number sequence `quotation`, attachment policy
   already lists `quo.quotations`).
2. **Permission codes.** The catalog has `svc.service.manage`,
   `svc.price.manage`, `svc.price.publish`, `quo.quotation.manage`,
   `quo.decision.record` — it has **no read codes**. Add
   `svc.service.read`, `svc.price.read`, `quo.quotation.read` idempotently to
   `supabase/seeds/04_iam_permission_catalog.sql` (93 → 96), and re-run
   `npm run validate:seed-state`.
3. **Event catalog.** Add `svc`/`quo` entries to `EVENT_CATALOG`
   (`src/server/events/envelope.ts`, currently 31). Shipped convention is
   unsuffixed names + `schemaVersion: 1`, so:
   `service.published`, `price-list.published`, `quotation.created`,
   `quotation.revision-issued`, `quotation.item-decided`,
   `quotation.accepted`, `quotation.rejected`, `quotation.expired`.
4. **Audit actions.** Check `src/server/auth/audit-actions.ts` for the
   controlled catalog and add the P1-20 actions with their classes — note the
   `financial` audit class exists and is the right one for money-moving acts.
5. Then Wave 3 routes, starting with `GET /api/v1/services`.

### Traps already identified — do not rediscover

- The registry `PATH_PATTERN` rejects `:action` — use sub-resource nouns.
- `ScopeAuthorizer` is exported from `@/server/auth/authorization`, **not**
  from `route-handler`.
- Build targets **ES2017**: write `BigInt(0)`, never `0n`.
- `iam.role_grants` has **no** `deleted_at` — it uses
  `status='active'` + `valid_from`/`valid_to`.
- `numeric` must be selected with an explicit `::text` cast (the shipped
  convention) and must never be parsed into a `number`.
- Two unit tests in `tests/foundation/operation-coverage-gate.test.ts` time out
  on a **cold** filesystem cache in this OneDrive-backed tree. They are green
  warm and in CI; do not "fix" them.
