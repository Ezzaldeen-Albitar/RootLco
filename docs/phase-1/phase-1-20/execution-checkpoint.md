# P1-20 execution checkpoint

> Single source of truth for resuming P1-20. Update it before any long operation
> and after every wave.

## Continuous Execution Policy

- A coherent pushed checkpoint is **not** a stopping point.
- An intermediate status report is **not** required.
- Context that still has execution capacity must be used to continue implementation.
- Do **not** stop to tell the user that several sessions may be required.
- Do **not** estimate how many sessions remain.
- Continue automatically through all remaining P1-20 work.
- Persist findings and progress in repository evidence files.
- Keep user-facing output silent or minimal during execution.
- Stop only for a genuine external blocker or final official phase closure.

This policy supersedes any earlier wording in this file that encouraged an
intermediate handoff.

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

| Metric        | Value                                                              | How                                                                                                                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit          | **899** (was 843)                                                  | `npm run test` — 42 files, all passed, exit 0 at the remediation head. Two tests in `operation-coverage-gate.test.ts` time out on a COLD filesystem cache in this OneDrive-backed tree; green warm and in CI.                                                |
| Database      | **1610**                                                           | `npm run test:db` — 136 files, all passed, exit 0                                                                                                                                                                                                            |
| Backend       | **1211** (was 1077)                                                | `npm run test:backend` — 56 files, all passed, exit 0, 399s. Measured at the remediation head; the commit message for `0096560` says 1219, which was an estimate written before the suite finished and is wrong. The measured figure is the one that counts. |
| OpenAPI       | **152 paths / 181 operations** (baseline was 140/168)              | counted from `docs/api/openapi.v1.json`                                                                                                                                                                                                                      |
| Migrations    | **119**, no 120                                                    | `supabase/migrations`                                                                                                                                                                                                                                        |
| Permissions   | **96** (was 93; +3 read codes) · audit actions **127** (was 110)   | `SELECT count(*) FROM iam.permissions`                                                                                                                                                                                                                       |
| Event catalog | **39** entries (was 31; +8 svc/quo)                                | `EVENT_CATALOG` in `src/server/events/envelope.ts`                                                                                                                                                                                                           |
| Schema hash   | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` | P1-19 baseline, to be re-proven in clean room                                                                                                                                                                                                                |

## Wave status

| Wave | Scope                                                               | Status                                                           |
| ---- | ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 0    | Protected baseline + recovery                                       | **Done**                                                         |
| 1    | Contract archaeology                                                | **Done** — `evidence/wave-1-contract-archaeology.md`             |
| 2    | Module foundation                                                   | **Done** — 3 modules, catalogs, audit actions, services          |
| 3    | Service catalog, availability, labour time (BE-001…003)             | **Done** — GET /services, 21 tests                               |
| 4    | Price lists, selection, tax, discount, decimal (BE-004/005/006/014) | **Done** — 5 operations, 35 tests                                |
| 5    | Quotation create/revise/issue/expire (BE-007/010/011)               | **Done** — 4 operations, part of 38 tests                        |
| 6    | Decisions and evidence (BE-008/009/012)                             | **Done** — 2 operations, part of 38 tests                        |
| 7    | Additional-work integration (BE-013)                                | **Done** — 11 tests, CommercialApprovalReader port               |
| 8    | SEC/QA/DO/DOC                                                       | **Done** — inventory gate + 6 evidence documents, 27/27 anchored |
| 9    | Adversarial review + remediation                                    | **Done** — 5 Highs, 9 Mediums, 7 Lows closed; see below          |

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

Six more were recorded as the phase progressed; `evidence/open-decisions.md` is the
authoritative list and now carries **nine**: A-03 (`decided_by` is the recording staff
user), A-04 (three catalog audit actions have no producer yet), A-05 (expiry has no
scheduler), A-06 (no alert routing destination is provisioned), A-07 (the price-ambiguity
guard is structurally unreachable and mirrors protected SQL), A-08 (price-list reads are
bounded rather than paged) and A-09 (three pre-existing module cycles that no gate
refuses). All nine are Low, all nine are open, and none is a defect being reclassified.

## Commits on the feature branch

| SHA       | What                                                                                                     |
| --------- | -------------------------------------------------------------------------------------------------------- |
| `84618ea` | Wave 0–1 evidence + `Decimal`/`Money` + `service-catalog` module (domain, repository, service, surface)  |
| `e269d52` | `pricing` module — `PriceResolutionService`, `DiscountAuthorizationService`, `iam.callerApprovalCeiling` |
| `0b838e1` | `quotation` domain + repository (money computed in SQL, verified against the live CHECKs)                |
| `69d749e` | permissions 93 → 96; `EVENT_CATALOG` 31 → 39                                                             |
| `49bf130` | checkpoint                                                                                               |
| `45e1eeb` | quotation application services — create / revise / issue / expire, decisions, evidence                   |
| `e6bba08` | `GET /api/v1/services` + 15 audit actions + coverage/OpenAPI wiring; 21/21 backend tests                 |

**Pushed.** `origin/feature/p1-20-service-catalog-pricing-quotation-backend` =
`e6bba082341526803a28467d3677331c9e0a31ed`.
**Draft PR [#84](https://github.com/Ezzaldeen-Albitar/RootLco/pull/84)** targets
`develop`, title `feat(p1-20): implement service catalog pricing and quotation
backend`, marked DO-NOT-MERGE in its body.

Verified green at `e6bba08`: `format:check`, `lint`, `tsc --noEmit`,
`validate:module-boundaries`, `validate:authorization-coverage`,
`validate:operation-coverage`, `validate:openapi` (141/169),
`validate:seed-state` (exit 0), `security:all`, 110 unit + gate tests,
21/21 `p1-20-service-catalog` backend tests.

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

## Wave 9 — adversarial review and remediation (this session)

Four independent read-only reviewers ran against the pushed branch. Three returned
confirmed findings; every one below was reproduced before it was fixed, and each fix
carries a test that fails without it.

### Highs closed

| #   | Finding                                                                                                                                                                                                                                                                                                                                                 | Fix                                                                                                                                                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | **The operation-coverage gate had no derived floor for `svc.`/`quo.`** The commit extended the visible hook (`parseProvidedFlags` accepts `svc\|quo`) but not `DERIVED_PREFIXES`, so `derivedRequirements()` returned `[]` for all 13 operations: `route`, `service`, `success` and `authorization` were _provided but not required_ for every one.     | `P1_20_PREFIXES` added to `DERIVED_PREFIXES`, the strict comment-stripping set, the `isDerived` set, `counts.p1_20`, a console block and a phase-1-20 matrix. The floor then demanded 8 missing evidences, all since written.     |
| H2  | **`expireLapsed` force-expired an ACCEPTED quotation.** A revision stays `issued` after every line is approved — only a rejection moves it — so candidate selection on revision status alone also selected accepted quotations, and expiry moved them `accepted` → `expired` with an audit record claiming the previous status was `active`.            | Parent-state test in the candidate query **and** re-checked under the lock. Test: `NEVER expires a quotation the customer already accepted`.                                                                                      |
| H3  | **The commercial-approval port could be uninstalled in a process serving the approval endpoint.** Nothing in `src/` imported `@/modules/quotation`, so whether the port existed depended on request order; a cold start receiving the approval route first answered `ERR-SYS-001`.                                                                      | Side-effect `import '@/modules/quotation'` in the approval route, a gate rule pairing the two, and a fresh-module-registry test. Mutation-verified: removing the import fails both.                                               |
| H4  | **20 declared coverage flags across 11 operations were not proven.** Chiefly: every `isolation` case used a principal that did not hold the operation's own permission, so the 403 was a missing permission and a scope-blind implementation passed; `cross-tenant` on quotation-create used a principal missing one of two declared permissions; three | New principals `SVC_PRICE_SCOPED_A2`, `SVC_QUO_SCOPED_A2`, `SVC_TENANT_B_FULL`, each holding the operation's permission in full, plus widening grants so the target row is READABLE and only the scoped check can refuse. Then 14 |
|     | `rollback` claims were pre-check refusals that wrote nothing; two `concurrency` claims were sequential awaits; `authorization` was unproven on four write operations; `outbox`, `success` and `denial` were each unproven somewhere.                                                                                                                    | new cases: genuine races (`Promise.all`), genuine rollbacks (pre-taken outbox key; a mid-loop conflict after a write), real 401/403 pairs, real 404/422 denials, and the missing outbox assertion.                                |
| H5  | **`lineBase` returned the exact scale-7 product**, which `Decimal.parse(_, MONEY)` refuses. `100.0000 × 2.000 = 200.0000000` — the ordinary case — became a `DecimalError` and an HTTP 500 inside the discount check. Introduced by this phase's own earlier totals-reconciliation fix.                                                                 | Return the scale-4 form, which the exactness check proves equal to the exact product. Caught by the backend suite, not by unit tests: the value is computed by PostgreSQL.                                                        |

### Mediums closed

- **`svc.discount.authorized` and `quo.additional_work.quotation_linked` had no
  producer.** Both were declared in the controlled catalog and emitted by nothing, so
  the catalog documented behaviour that did not exist. The discount record is now
  written once per revision that needed elevated authority, carrying the policy that
  applied (or `unconfigured`, i.e. threshold zero), the permission required, the
  document-level discount total and the ceiling checked. The link record is written
  whenever `quotation_revision_ref` is filled — a column frozen at INSERT, which
  previously left no audit trace at all. The catalog's `entityType` for the discount
  action was corrected from `svc.discount_rules` (no such row need exist) to
  `quo.quotation_revision`.
- **The link was validated without a lock.** `standingOf` now takes
  `{ lock: true }`, implemented as parent-then-revision in the module's documented
  lock order, so a concurrent issue or rejection cannot change the standing between
  the check and the INSERT into a frozen column.
- **`quo.quotation.read` was not required to cite a revision.**
  `wo.additional_work.approve` alone let a caller learn a revision's existence, scope,
  revision status, expiry and acceptance outcome from the refusal messages. An earlier
  wording here and in `security-review.md` also claimed the total and the currency; a
  review checked all seven refusals and neither is rendered into any message on this path,
  so the claim was inflated and has been narrowed to what the messages actually say.
  Checked inside
  `assertLinkableQuotationRevision` rather than declared on the operation, because
  `permissions` is a conjunction and every P1-19 caller approving _without_ a
  quotation would otherwise need a commercial permission.
- **The link refusal disclosed a foreign work-order id**, and the checks ran in the
  wrong order — scope is now decided first, so a caller with no grant in the
  revision's scope learns nothing about the work order it belongs to.
- **Expiry read the Node clock.** `serverNow()` is read once per sweep, and because
  `now()` is transaction-scoped it is the same clock the candidate query used.
  `commercialApproval` had the same defect and the same fix.
- **`DecimalError`/`CurrencyMismatchError` reached callers as HTTP 500.** An approval
  limit denominated in another currency is ordinary configuration; it is now an
  `ERR-IAM-001` naming both currencies, with the mismatch retained as the `cause`. An
  unparseable amount threshold fails closed, matching the percentage case.
- **A role-derived approval ceiling ignored grant scope.** `iam.approval_limits` rows
  are per `(role, company)` and the role subquery filtered on tenant and user only, so
  an actor inherited a role's ceiling in every company that role had a limit in —
  including companies their grant of it never covered. Now gated on
  `scope_mode = 'unrestricted'` OR a `grant_scopes` row naming the company, which
  `ck_grant_scopes_shape` guarantees is populated for all three scope types.
  Demonstrating it needed two companies in one tenant, so the fixtures seed
  `COMPANY_A2`.
- **The gate could miss a declaration silently.** `parseOperations` keys on a naming
  convention the compiler does not enforce; the number of `defineOperation(` call
  sites is now counted independently and a mismatch fails the gate.
- **The task-anchor search was vacuous.** `docs/` is no longer searched at all, this
  script's own `TASKS` literal is blanked before it is scanned, and a documentation
  task must name itself in the specific artifact it delivers rather than in whichever
  evidence file tabulates all 27 identifiers.

### Lows closed

- `quotation.accepted`/`quotation.rejected` no longer carry `grandTotal`: an
  acceptance is a state change, the totals are `restricted`, and an outbox payload has
  different retention and no per-consumer authorization.
- Four comments claiming the approval ceiling is read "through `@/modules/iam`'s
  public surface" corrected — it is `callerApprovalCeiling` in the foundation, and
  `authorization.ts` records why routing it through the iam module was rejected.
- `commercial-approval.ts` no longer claims that mutual module imports are "the shape
  this repository avoids": three such pairs pre-date this phase and no gate refuses
  them. Recorded as an open finding instead.
- `PermissionProbe` is documented as supplied by the application service, not the
  route (a route-supplied probe would be a B11 violation).
- The service-catalog suite header no longer reasons from `scope: 'branch'`; the route
  declares `tenant` and explains why.
- The `wo.additional-work-approval` COVERAGE-EVIDENCE block in the P1-20 link suite
  was a copy of P1-19's full flag list; trimmed to the four flags that file proves.
- `'needs svc.price.publish, not merely svc.price.manage'` retitled — `SVC_READER`
  holds neither. The split is now proved with `SVC_NO_CEILING`, which holds
  `svc.price.manage` and not `svc.price.publish`.

### Open, carried into the gate

- **P1-20-A-09 — three module cycles pre-date this phase and no gate refuses them.**
  `work-order` ↔ `diagnostics`, ↔ `quality`, ↔ `technician`, all present at
  `0d86a19`; `check-module-boundaries.mjs` has no cycle rule, so
  `validate:module-boundaries` reports OK. P1-20 introduced none — the port is the
  correct pattern — and adding a B13 rule now would fail the build on pre-existing
  debt belonging to another phase's remediation.
- **P1-20-A-07 — `countTiedPriceRules` mirrors ~45 lines of `svc.resolve_price`
  precedence SQL for a condition `uq_price_rules_signature` makes unreachable**, with
  no test comparing the two. Retained deliberately: it defends a correctness property
  that rests on that index continuing to exist. The structural guarantee is asserted
  directly instead of pretending the branch has a positive test.
- **P1-20-A-05 — `expireLapsed` is not wired to a scheduler.** No production
  scheduling infrastructure is provisioned; the method is the repository-supported
  contract a scheduler will call, and it is now exercised directly by three tests.

## Current PR / CI

PR #84 to `develop`, **Draft**. The remediation above is not yet pushed, so the
hosted run on the current head predates it.

## Exact next action

1. Push the remediation commit; confirm the hosted run targets the exact pushed head.
2. Full local reproof at the final SHA: unit, DB, backend, build, every gate.
3. Exact-SHA clean-room reproof from an empty PostgreSQL 17 (container `p120cr`,
   port 15432): 119 migrations, no 120, `schema_hash a677eb05…` unchanged, seeds
   idempotent, business tables empty.
4. Finalise the PR body, remove Draft, verify CI on the exact head, merge to
   protected `develop`, verify the merge parents/tree and its push CI.
5. Protected-develop reproof, then the documentation-only gate-record branch
   `gate/p1-20-service-catalog-pricing-quotation-backend` and its PR.
6. Record the Go decision. Do **not** promote `develop` to `main` (ADR-006 reserves
   that for the founders). Do **not** start P1-21.

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
- A route citing a quotation revision must side-effect `import '@/modules/quotation'`;
  the P1-20 inventory gate enforces the pairing.
- `Decimal.parse(_, MONEY)` refuses a scale-7 string: `unit * qty` is scale 7 by
  construction, so pass the `round(...,4)` form once exactness has been proved.
- Audit details live in `iam.audit_record_details` (one row per field, with its own
  classification), not in a jsonb column on `iam.audit_records`.
- NEVER run two DB-backed suites at once: each `beforeAll` truncates the shared tenant
  fixtures, so they delete each other's roles and grants and the failures point anywhere
  but the cause. Run the battery serially, with nothing else touching the database.
- A test that plants a row via the admin pool must remove it in a `finally`; a trailing
  delete leaks on assertion failure and the leak aborts the next run's cascade.
- A new coverage flag is worthless unless a principal holds the operation's own
  permission: otherwise the 403 is a missing permission and a scope-blind
  implementation passes.

## Appendix — operation-coverage gate output (all phases)

Regenerated by `node scripts/check-operation-test-coverage.mjs` at the remediation
head. The previous paste predated Wave 9 and listed only `svc.service-list` for this
phase, which would have read as 1-of-13 coverage.

```
Operation-to-test coverage (STRICT): 181 registered operation(s)
  public API surface: 181 · internal: 0
  with required evidence: 166 · invocation-only (read/catalogue): 15
  [OK ] apt.appointment-cancel               tests/backend/p1-18-appointment-lifecycle.test.ts + tests/backend/p1-18-scope-containment.test.ts
  [OK ] apt.appointment-create               tests/backend/p1-18-appointment-lifecycle.test.ts
  [OK ] apt.appointment-no-show              tests/backend/p1-18-appointment-lifecycle.test.ts + tests/backend/p1-18-scope-containment.test.ts
  [OK ] apt.appointment-reschedule           tests/backend/p1-18-appointment-lifecycle.test.ts + tests/backend/p1-18-scope-containment.test.ts
  [OK ] crm.address-add                      tests/backend/p1-16-customer-profile.test.ts
  [OK ] crm.alert-raise                      tests/backend/p1-16-customer-governance.test.ts
  [OK ] crm.company-create                   tests/backend/p1-16-customer-creation.test.ts
  [OK ] crm.consent-record                   tests/backend/p1-16-customer-profile.test.ts
  [OK ] crm.contact-add                      tests/backend/p1-16-customer-profile.test.ts
  [OK ] crm.customer-history                 tests/backend/p1-16-customer-identity.test.ts
  [OK ] crm.customer-merge                   tests/backend/p1-16-customer-identity.test.ts
  [OK ] crm.customer-search                  tests/backend/p1-16-customer-search.test.ts
  [OK ] crm.customer-status-set              tests/backend/p1-16-customer-governance.test.ts
  [OK ] crm.customer-timeline                tests/backend/p1-16-customer-identity.test.ts
  [OK ] crm.duplicate-review                 tests/backend/p1-16-customer-identity.test.ts
  [OK ] crm.duplicate-scan                   tests/backend/p1-16-customer-identity.test.ts
  [OK ] crm.individual-create                tests/backend/p1-16-customer-creation.test.ts
  [OK ] crm.note-add                         tests/backend/p1-16-customer-governance.test.ts
  [OK ] crm.preference-set                   tests/backend/p1-16-customer-profile.test.ts
  [OK ] crm.restriction-impose               tests/backend/p1-16-customer-governance.test.ts
  [OK ] crm.tag-assign                       tests/backend/p1-16-customer-governance.test.ts
  [OK ] crm.vehicle-link                     tests/backend/p1-16-customer-identity.test.ts
  [OK ] dia.diagnostic-complete              tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-create                tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-detail                tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-dtc-record            tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-evidence-record       tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-finding-record        tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-history               tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-item-result           tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-list                  tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-measurement-record    tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-recommendation-record tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-review                tests/backend/p1-19-diagnostics.test.ts
  [OK ] dia.diagnostic-transition            tests/backend/p1-19-diagnostics.test.ts
  [OK ] iam.approval-limit-create            tests/backend/iam-access-administration.test.ts
  [OK ] iam.approval-limit-end               tests/backend/iam-admin-writes.test.ts
  [OK ] iam.approval-limit-list              tests/backend/iam-operations.test.ts
  [OK ] iam.audit-event-detail               tests/backend/iam-operations.test.ts
  [OK ] iam.audit-event-list                 tests/backend/iam-operations.test.ts
  [OK ] iam.auth-login                       tests/backend/iam-auth-provider.test.ts
  [OK ] iam.auth-logout                      tests/backend/iam-auth-provider.test.ts
  [OK ] iam.auth-password-reset              tests/backend/iam-auth-provider.test.ts
  [OK ] iam.auth-password-reset-completion   tests/backend/iam-auth-provider.test.ts
  [OK ] iam.auth-session                     tests/backend/iam-auth-provider.test.ts
  [OK ] iam.branch-settings-read             tests/backend/iam-operations.test.ts
  [OK ] iam.branch-settings-write            tests/backend/iam-admin-writes.test.ts
  [OK ] iam.company-settings-read            tests/backend/iam-operations.test.ts
  [OK ] iam.company-settings-write           tests/backend/iam-admin-writes.test.ts
  [OK ] iam.grant-issue                      tests/backend/iam-access-administration.test.ts
  [OK ] iam.grant-revoke                     tests/backend/iam-access-administration.test.ts
  [OK ] iam.grant-scope-add                  tests/backend/iam-access-administration.test.ts
  [OK ] iam.grant-scope-list                 tests/backend/iam-operations.test.ts
  [OK ] iam.grant-scope-remove               tests/backend/iam-access-administration.test.ts
  [OK ] iam.invitation-activate              tests/backend/iam-auth-provider.test.ts
  [OK ] iam.invitation-cancel                tests/backend/iam-auth-provider.test.ts
  [OK ] iam.invitation-create                tests/backend/iam-auth-provider.test.ts
  [OK ] iam.permission-list                  tests/backend/iam-operations.test.ts
  [OK ] iam.role-create                      tests/backend/iam-operations.test.ts
  [OK ] iam.role-list                        tests/backend/iam-operations.test.ts
  [OK ] iam.role-permission-add              tests/backend/iam-admin-writes.test.ts
  [OK ] iam.role-permission-list             tests/backend/iam-operations.test.ts
  [OK ] iam.role-permission-remove           tests/backend/iam-admin-writes.test.ts
  [OK ] iam.role-permission-update           tests/backend/iam-admin-writes.test.ts
  [OK ] iam.role-update                      tests/backend/iam-admin-writes.test.ts
  [OK ] iam.tenant-settings-read             tests/backend/iam-operations.test.ts
  [OK ] iam.tenant-settings-update           tests/backend/iam-admin-writes.test.ts
  [OK ] iam.user-detail                      tests/backend/iam-operations.test.ts
  [OK ] iam.user-list                        tests/backend/iam-operations.test.ts
  [OK ] iam.user-session-list                tests/backend/iam-operations.test.ts
  [OK ] iam.user-session-revoke-all          tests/backend/iam-admin-writes.test.ts
  [OK ] iam.user-status-change               tests/backend/iam-admin-writes.test.ts
  [OK ] iam.user-update                      tests/backend/iam-admin-writes.test.ts
  [OK ] meta.ping                            tests/backend/api-ping.test.ts
  [OK ] qms.qc-check-result                  tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.qc-record-detail                 tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.qc-record-finalize               tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.qc-record-list                   tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.qc-record-open                   tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.reopen-attempt                   tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.reopen-attempt-list              tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.rework-cost-read                 tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.rework-cost-record               tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.rework-create                    tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.rework-detail                    tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.rework-list                      tests/backend/p1-19-quality-rework.test.ts
  [OK ] qms.rework-sign-off                  tests/backend/p1-19-quality-rework.test.ts
  [OK ] quo.quotation-create                 tests/backend/p1-20-quotation.test.ts
  [OK ] quo.quotation-detail                 tests/backend/p1-20-quotation.test.ts
  [OK ] quo.quotation-issue                  tests/backend/p1-20-quotation.test.ts
  [OK ] quo.quotation-item-decide            tests/backend/p1-20-quotation.test.ts
  [OK ] quo.quotation-revision-create        tests/backend/p1-20-quotation.test.ts
  [OK ] quo.quotation-revision-decide        tests/backend/p1-20-quotation.test.ts
  [OK ] rec.reception-approve                tests/backend/p1-18-reception-approval.test.ts + tests/backend/p1-18-scope-containment.test.ts
  [OK ] rec.reception-authorization          tests/backend/p1-18-reception-parties.test.ts + tests/backend/p1-18-scope-containment.test.ts
  [OK ] rec.reception-condition-evidence     tests/backend/p1-18-reception-evidence.test.ts + tests/backend/p1-18-scope-containment.test.ts
  [OK ] rec.reception-convert-to-work-order  tests/backend/p1-18-reception-conversion.test.ts + tests/backend/p1-18-scope-containment.test.ts
  [OK ] rec.reception-create                 tests/backend/p1-18-reception-create.test.ts
  [OK ] rec.reception-party-role             tests/backend/p1-18-reception-parties.test.ts + tests/backend/p1-18-scope-containment.test.ts
  [OK ] rec.reception-refusal                tests/backend/p1-18-reception-evidence.test.ts + tests/backend/p1-18-scope-containment.test.ts
  [OK ] rec.reception-signature              tests/backend/p1-18-reception-evidence.test.ts + tests/backend/p1-18-scope-containment.test.ts
  [OK ] shared.attachment-download-authorize tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
  [OK ] shared.attachment-link-create        tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
  [OK ] shared.attachment-link-withdraw      tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
  [OK ] shared.attachment-upload-authorize   tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
  [OK ] shared.attachment-version-register   tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
  [OK ] shared.attachment-version-reject     tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
  [OK ] shared.branch-status-change          tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] shared.branch-status-read            tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] shared.export-authorize              tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] shared.export-catalogue              tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] shared.health-live                   tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-dispatch-and-health.test.ts
  [OK ] shared.health-ready                  tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-dispatch-and-health.test.ts
  [OK ] shared.notification-enqueue          tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
  [OK ] shared.template-activation-set       tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] shared.template-create               tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] shared.template-update               tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] shared.template-version-approve      tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] shared.template-version-create       tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] shared.template-version-preview      tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] shared.template-version-retire       tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] shared.template-version-revise       tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
  [OK ] svc.price-list-create                tests/backend/p1-20-pricing.test.ts
  [OK ] svc.price-list-list                  tests/backend/p1-20-pricing.test.ts
  [OK ] svc.price-list-version-create        tests/backend/p1-20-pricing.test.ts
  [OK ] svc.price-list-version-publish       tests/backend/p1-20-pricing.test.ts
  [OK ] svc.price-resolve                    tests/backend/p1-20-pricing.test.ts
  [OK ] svc.price-rule-record                tests/backend/p1-20-pricing.test.ts
  [OK ] svc.service-list                     tests/backend/p1-20-service-catalog.test.ts
  [OK ] tech.labor-session-correct           tests/backend/p1-19-labor-sessions.test.ts
  [OK ] tech.labor-session-list              tests/backend/p1-19-labor-sessions.test.ts
  [OK ] tech.labor-session-start             tests/backend/p1-19-labor-sessions.test.ts
  [OK ] tech.labor-session-stop              tests/backend/p1-19-labor-sessions.test.ts
  [OK ] tech.technician-available            tests/backend/p1-19-job-assignments.test.ts
  [OK ] tech.technician-queue                tests/backend/p1-19-job-assignments.test.ts
  [OK ] veh.vehicle-authorized-party-add     tests/backend/p1-17-vehicle-relations.test.ts
  [OK ] veh.vehicle-authorized-party-retire  tests/backend/p1-17-vehicle-relations.test.ts
  [OK ] veh.vehicle-create                   tests/backend/p1-17-vehicle-create-update.test.ts
  [OK ] veh.vehicle-document-list            tests/backend/p1-17-vehicle-history.test.ts
  [OK ] veh.vehicle-duplicate-review         tests/backend/p1-17-vehicle-duplicates.test.ts
  [OK ] veh.vehicle-duplicate-scan           tests/backend/p1-17-vehicle-duplicates.test.ts
  [OK ] veh.vehicle-ev-profile-read          tests/backend/p1-17-vehicle-lifecycle.test.ts
  [OK ] veh.vehicle-ev-profile-set           tests/backend/p1-17-vehicle-lifecycle.test.ts
  [OK ] veh.vehicle-history                  tests/backend/p1-17-vehicle-history.test.ts
  [OK ] veh.vehicle-merge                    tests/backend/p1-17-vehicle-merge.test.ts
  [OK ] veh.vehicle-odometer-history         tests/backend/p1-17-vehicle-odometer.test.ts
  [OK ] veh.vehicle-odometer-record          tests/backend/p1-17-vehicle-odometer.test.ts
  [OK ] veh.vehicle-ownership-history        tests/backend/p1-17-vehicle-registration.test.ts
  [OK ] veh.vehicle-ownership-transfer       tests/backend/p1-17-vehicle-registration.test.ts
  [OK ] veh.vehicle-plate-assign             tests/backend/p1-17-vehicle-registration.test.ts
  [OK ] veh.vehicle-plate-history            tests/backend/p1-17-vehicle-registration.test.ts
  [OK ] veh.vehicle-relationship-list        tests/backend/p1-17-vehicle-relations.test.ts
  [OK ] veh.vehicle-search                   tests/backend/p1-17-vehicle-search.test.ts
  [OK ] veh.vehicle-status-change            tests/backend/p1-17-vehicle-lifecycle.test.ts
  [OK ] veh.vehicle-update                   tests/backend/p1-17-vehicle-create-update.test.ts
  [OK ] wo.additional-work-approval          tests/backend/p1-19-customer-approvals.test.ts
  [OK ] wo.additional-work-approval-read     tests/backend/p1-19-customer-approvals.test.ts
  [OK ] wo.additional-work-detail-read       tests/backend/p1-19-additional-work.test.ts
  [OK ] wo.additional-work-detail-record     tests/backend/p1-19-additional-work.test.ts
  [OK ] wo.additional-work-fulfillment       tests/backend/p1-19-additional-work.test.ts
  [OK ] wo.additional-work-list              tests/backend/p1-19-additional-work.test.ts
  [OK ] wo.additional-work-request           tests/backend/p1-19-additional-work.test.ts
  [OK ] wo.additional-work-withdraw          tests/backend/p1-19-additional-work.test.ts
  [OK ] wo.job-assignment-create             tests/backend/p1-19-job-assignments.test.ts
  [OK ] wo.job-assignment-end                tests/backend/p1-19-job-assignments.test.ts
  [OK ] wo.job-assignment-list               tests/backend/p1-19-job-assignments.test.ts
  [OK ] wo.job-create                        tests/backend/p1-19-work-order-jobs.test.ts
  [OK ] wo.job-history                       tests/backend/p1-19-job-lifecycle.test.ts
  [OK ] wo.job-reassignment                  tests/backend/p1-19-job-assignments.test.ts
  [OK ] wo.job-transition                    tests/backend/p1-19-job-lifecycle.test.ts + tests/backend/p1-19-customer-approvals.test.ts
  [OK ] wo.job-update                        tests/backend/p1-19-work-order-jobs.test.ts
  [OK ] wo.required-part-list                tests/backend/p1-19-work-order-lines.test.ts
  [OK ] wo.required-part-record              tests/backend/p1-19-work-order-lines.test.ts
  [OK ] wo.service-line-list                 tests/backend/p1-19-work-order-lines.test.ts
  [OK ] wo.service-line-record               tests/backend/p1-19-work-order-lines.test.ts
  [OK ] wo.work-order-closure                tests/backend/p1-19-work-order-core.test.ts
  [OK ] wo.work-order-closure-eligibility    tests/backend/p1-19-work-order-core.test.ts
  [OK ] wo.work-order-detail                 tests/backend/p1-19-work-order-reads.test.ts
  [OK ] wo.work-order-history                tests/backend/p1-19-work-order-reads.test.ts
  [OK ] wo.work-order-list                   tests/backend/p1-19-work-order-reads.test.ts
  [OK ] wo.work-order-transition             tests/backend/p1-19-work-order-core.test.ts

P1-15 registered public operations: 21
P1-15 operation-depth: 21
P1-15 invocation-only: 0
P1-15 pending: 0
P1-15 unit-only: 0
P1-15 unreferenced: 0
P1-15 metadata-only: 0

P1-16 registered public operations: 18
P1-16 operation-depth: 18
P1-16 invocation-only: 0
P1-16 pending: 0
P1-16 unit-only: 0
P1-16 unreferenced: 0
P1-16 metadata-only: 0

P1-17 registered public operations: 20
P1-17 operation-depth: 20
P1-17 invocation-only: 0
P1-17 pending: 0
P1-17 unit-only: 0
P1-17 unreferenced: 0
P1-17 metadata-only: 0

P1-18 registered public operations: 12
P1-18 operation-depth: 12
P1-18 invocation-only: 0
P1-18 pending: 0
P1-18 unit-only: 0
P1-18 unreferenced: 0
P1-18 metadata-only: 0

P1-19 registered public operations: 58
P1-19 operation-depth: 58
P1-19 invocation-only: 0
P1-19 pending: 0
P1-19 unit-only: 0
P1-19 unreferenced: 0
P1-19 metadata-only: 0

P1-20 registered public operations: 13
P1-20 operation-depth: 13
P1-20 invocation-only: 0
P1-20 pending: 0
P1-20 unit-only: 0
P1-20 unreferenced: 0
P1-20 metadata-only: 0

OK: every registered operation is invoked in a referencing test and provides its required evidence.
Matrix written to docs/phase-1/phase-1-14|15/evidence/operation-test-matrix.json
```
