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
| OpenAPI       | **141 paths / 169 operations** (baseline was 140/168)              | counted from `docs/api/openapi.v1.json`                                                                                                                                                      |
| Migrations    | **119**, no 120                                                    | `supabase/migrations`                                                                                                                                                                        |
| Permissions   | **96** (was 93; +3 read codes)                                     | `SELECT count(*) FROM iam.permissions`                                                                                                                                                       |
| Event catalog | **39** entries (was 31; +8 svc/quo)                                | `EVENT_CATALOG` in `src/server/events/envelope.ts`                                                                                                                                           |
| Schema hash   | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c` | P1-19 baseline, to be re-proven in clean room                                                                                                                                                |

## Wave status

| Wave | Scope                                                               | Status                                                                            |
| ---- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 0    | Protected baseline + recovery                                       | **Done**                                                                          |
| 1    | Contract archaeology                                                | **Done** — `evidence/wave-1-contract-archaeology.md`                              |
| 2    | Module foundation                                                   | **Done** — 3 modules, catalogs, audit actions, services                           |
| 3    | Service catalog, availability, labour time (BE-001…003)             | **Read surface done** — GET /services published + 21 tests; mutations outstanding |
| 4    | Price lists, selection, tax, discount, decimal (BE-004/005/006/014) | Not started                                                                       |
| 5    | Quotation create/revise/issue/expire (BE-007/010/011)               | Not started                                                                       |
| 6    | Decisions and evidence (BE-008/009/012)                             | Not started                                                                       |
| 7    | Additional-work integration (BE-013)                                | Not started                                                                       |
| 8    | SEC/QA/DO/DOC                                                       | Not started                                                                       |

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

## Known defects / review findings

None open. No adversarial review has run yet.

## Current PR / CI

None yet — branch is local only, not pushed.

## Exact next action

Wave 3 remainder, then Waves 4-8. Concretely, in order:

1. **Pricing write services + routes** — ,
   , publication via
   , and a resolved-price read gated on
   . The repository already has the reads; the writes are new.
2. **Quotation routes** — , ,
   ,
   ,
   ,
   . Services already exist.
3. **BE-013 additional-work link** — fill
   through a new work-order module
   method; the 14 proofs listed in the instruction.
4. **Per route, all four in the same commit**: manifest entry in
   Operation-to-test coverage (STRICT): 169 registered operation(s)
   public API surface: 169 · internal: 0
   with required evidence: 154 · invocation-only (read/catalogue): 15
   [OK ] apt.appointment-cancel tests/backend/p1-18-appointment-lifecycle.test.ts + tests/backend/p1-18-scope-containment.test.ts
   [OK ] apt.appointment-create tests/backend/p1-18-appointment-lifecycle.test.ts
   [OK ] apt.appointment-no-show tests/backend/p1-18-appointment-lifecycle.test.ts + tests/backend/p1-18-scope-containment.test.ts
   [OK ] apt.appointment-reschedule tests/backend/p1-18-appointment-lifecycle.test.ts + tests/backend/p1-18-scope-containment.test.ts
   [OK ] crm.address-add tests/backend/p1-16-customer-profile.test.ts
   [OK ] crm.alert-raise tests/backend/p1-16-customer-governance.test.ts
   [OK ] crm.company-create tests/backend/p1-16-customer-creation.test.ts
   [OK ] crm.consent-record tests/backend/p1-16-customer-profile.test.ts
   [OK ] crm.contact-add tests/backend/p1-16-customer-profile.test.ts
   [OK ] crm.customer-history tests/backend/p1-16-customer-identity.test.ts
   [OK ] crm.customer-merge tests/backend/p1-16-customer-identity.test.ts
   [OK ] crm.customer-search tests/backend/p1-16-customer-search.test.ts
   [OK ] crm.customer-status-set tests/backend/p1-16-customer-governance.test.ts
   [OK ] crm.customer-timeline tests/backend/p1-16-customer-identity.test.ts
   [OK ] crm.duplicate-review tests/backend/p1-16-customer-identity.test.ts
   [OK ] crm.duplicate-scan tests/backend/p1-16-customer-identity.test.ts
   [OK ] crm.individual-create tests/backend/p1-16-customer-creation.test.ts
   [OK ] crm.note-add tests/backend/p1-16-customer-governance.test.ts
   [OK ] crm.preference-set tests/backend/p1-16-customer-profile.test.ts
   [OK ] crm.restriction-impose tests/backend/p1-16-customer-governance.test.ts
   [OK ] crm.tag-assign tests/backend/p1-16-customer-governance.test.ts
   [OK ] crm.vehicle-link tests/backend/p1-16-customer-identity.test.ts
   [OK ] dia.diagnostic-complete tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-create tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-detail tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-dtc-record tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-evidence-record tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-finding-record tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-history tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-item-result tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-list tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-measurement-record tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-recommendation-record tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-review tests/backend/p1-19-diagnostics.test.ts
   [OK ] dia.diagnostic-transition tests/backend/p1-19-diagnostics.test.ts
   [OK ] iam.approval-limit-create tests/backend/iam-access-administration.test.ts
   [OK ] iam.approval-limit-end tests/backend/iam-admin-writes.test.ts
   [OK ] iam.approval-limit-list tests/backend/iam-operations.test.ts
   [OK ] iam.audit-event-detail tests/backend/iam-operations.test.ts
   [OK ] iam.audit-event-list tests/backend/iam-operations.test.ts
   [OK ] iam.auth-login tests/backend/iam-auth-provider.test.ts
   [OK ] iam.auth-logout tests/backend/iam-auth-provider.test.ts
   [OK ] iam.auth-password-reset tests/backend/iam-auth-provider.test.ts
   [OK ] iam.auth-password-reset-completion tests/backend/iam-auth-provider.test.ts
   [OK ] iam.auth-session tests/backend/iam-auth-provider.test.ts
   [OK ] iam.branch-settings-read tests/backend/iam-operations.test.ts
   [OK ] iam.branch-settings-write tests/backend/iam-admin-writes.test.ts
   [OK ] iam.company-settings-read tests/backend/iam-operations.test.ts
   [OK ] iam.company-settings-write tests/backend/iam-admin-writes.test.ts
   [OK ] iam.grant-issue tests/backend/iam-access-administration.test.ts
   [OK ] iam.grant-revoke tests/backend/iam-access-administration.test.ts
   [OK ] iam.grant-scope-add tests/backend/iam-access-administration.test.ts
   [OK ] iam.grant-scope-list tests/backend/iam-operations.test.ts
   [OK ] iam.grant-scope-remove tests/backend/iam-access-administration.test.ts
   [OK ] iam.invitation-activate tests/backend/iam-auth-provider.test.ts
   [OK ] iam.invitation-cancel tests/backend/iam-auth-provider.test.ts
   [OK ] iam.invitation-create tests/backend/iam-auth-provider.test.ts
   [OK ] iam.permission-list tests/backend/iam-operations.test.ts
   [OK ] iam.role-create tests/backend/iam-operations.test.ts
   [OK ] iam.role-list tests/backend/iam-operations.test.ts
   [OK ] iam.role-permission-add tests/backend/iam-admin-writes.test.ts
   [OK ] iam.role-permission-list tests/backend/iam-operations.test.ts
   [OK ] iam.role-permission-remove tests/backend/iam-admin-writes.test.ts
   [OK ] iam.role-permission-update tests/backend/iam-admin-writes.test.ts
   [OK ] iam.role-update tests/backend/iam-admin-writes.test.ts
   [OK ] iam.tenant-settings-read tests/backend/iam-operations.test.ts
   [OK ] iam.tenant-settings-update tests/backend/iam-admin-writes.test.ts
   [OK ] iam.user-detail tests/backend/iam-operations.test.ts
   [OK ] iam.user-list tests/backend/iam-operations.test.ts
   [OK ] iam.user-session-list tests/backend/iam-operations.test.ts
   [OK ] iam.user-session-revoke-all tests/backend/iam-admin-writes.test.ts
   [OK ] iam.user-status-change tests/backend/iam-admin-writes.test.ts
   [OK ] iam.user-update tests/backend/iam-admin-writes.test.ts
   [OK ] meta.ping tests/backend/api-ping.test.ts
   [OK ] qms.qc-check-result tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.qc-record-detail tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.qc-record-finalize tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.qc-record-list tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.qc-record-open tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.reopen-attempt tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.reopen-attempt-list tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.rework-cost-read tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.rework-cost-record tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.rework-create tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.rework-detail tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.rework-list tests/backend/p1-19-quality-rework.test.ts
   [OK ] qms.rework-sign-off tests/backend/p1-19-quality-rework.test.ts
   [OK ] rec.reception-approve tests/backend/p1-18-reception-approval.test.ts + tests/backend/p1-18-scope-containment.test.ts
   [OK ] rec.reception-authorization tests/backend/p1-18-reception-parties.test.ts + tests/backend/p1-18-scope-containment.test.ts
   [OK ] rec.reception-condition-evidence tests/backend/p1-18-reception-evidence.test.ts + tests/backend/p1-18-scope-containment.test.ts
   [OK ] rec.reception-convert-to-work-order tests/backend/p1-18-reception-conversion.test.ts + tests/backend/p1-18-scope-containment.test.ts
   [OK ] rec.reception-create tests/backend/p1-18-reception-create.test.ts
   [OK ] rec.reception-party-role tests/backend/p1-18-reception-parties.test.ts + tests/backend/p1-18-scope-containment.test.ts
   [OK ] rec.reception-refusal tests/backend/p1-18-reception-evidence.test.ts + tests/backend/p1-18-scope-containment.test.ts
   [OK ] rec.reception-signature tests/backend/p1-18-reception-evidence.test.ts + tests/backend/p1-18-scope-containment.test.ts
   [OK ] shared.attachment-download-authorize tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
   [OK ] shared.attachment-link-create tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
   [OK ] shared.attachment-link-withdraw tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
   [OK ] shared.attachment-upload-authorize tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
   [OK ] shared.attachment-version-register tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
   [OK ] shared.attachment-version-reject tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
   [OK ] shared.branch-status-change tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] shared.branch-status-read tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] shared.export-authorize tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] shared.export-catalogue tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] shared.health-live tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-dispatch-and-health.test.ts
   [OK ] shared.health-ready tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-dispatch-and-health.test.ts
   [OK ] shared.notification-enqueue tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-attachments-notifications.test.ts
   [OK ] shared.template-activation-set tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] shared.template-create tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] shared.template-update tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] shared.template-version-approve tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] shared.template-version-create tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] shared.template-version-preview tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] shared.template-version-retire tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] shared.template-version-revise tests/backend/p1-15-operation-routes.test.ts + tests/backend/p1-15-templates-transitions-export.test.ts
   [OK ] svc.service-list tests/backend/p1-20-service-catalog.test.ts
   [OK ] tech.labor-session-correct tests/backend/p1-19-labor-sessions.test.ts
   [OK ] tech.labor-session-list tests/backend/p1-19-labor-sessions.test.ts
   [OK ] tech.labor-session-start tests/backend/p1-19-labor-sessions.test.ts
   [OK ] tech.labor-session-stop tests/backend/p1-19-labor-sessions.test.ts
   [OK ] tech.technician-available tests/backend/p1-19-job-assignments.test.ts
   [OK ] tech.technician-queue tests/backend/p1-19-job-assignments.test.ts
   [OK ] veh.vehicle-authorized-party-add tests/backend/p1-17-vehicle-relations.test.ts
   [OK ] veh.vehicle-authorized-party-retire tests/backend/p1-17-vehicle-relations.test.ts
   [OK ] veh.vehicle-create tests/backend/p1-17-vehicle-create-update.test.ts
   [OK ] veh.vehicle-document-list tests/backend/p1-17-vehicle-history.test.ts
   [OK ] veh.vehicle-duplicate-review tests/backend/p1-17-vehicle-duplicates.test.ts
   [OK ] veh.vehicle-duplicate-scan tests/backend/p1-17-vehicle-duplicates.test.ts
   [OK ] veh.vehicle-ev-profile-read tests/backend/p1-17-vehicle-lifecycle.test.ts
   [OK ] veh.vehicle-ev-profile-set tests/backend/p1-17-vehicle-lifecycle.test.ts
   [OK ] veh.vehicle-history tests/backend/p1-17-vehicle-history.test.ts
   [OK ] veh.vehicle-merge tests/backend/p1-17-vehicle-merge.test.ts
   [OK ] veh.vehicle-odometer-history tests/backend/p1-17-vehicle-odometer.test.ts
   [OK ] veh.vehicle-odometer-record tests/backend/p1-17-vehicle-odometer.test.ts
   [OK ] veh.vehicle-ownership-history tests/backend/p1-17-vehicle-registration.test.ts
   [OK ] veh.vehicle-ownership-transfer tests/backend/p1-17-vehicle-registration.test.ts
   [OK ] veh.vehicle-plate-assign tests/backend/p1-17-vehicle-registration.test.ts
   [OK ] veh.vehicle-plate-history tests/backend/p1-17-vehicle-registration.test.ts
   [OK ] veh.vehicle-relationship-list tests/backend/p1-17-vehicle-relations.test.ts
   [OK ] veh.vehicle-search tests/backend/p1-17-vehicle-search.test.ts
   [OK ] veh.vehicle-status-change tests/backend/p1-17-vehicle-lifecycle.test.ts
   [OK ] veh.vehicle-update tests/backend/p1-17-vehicle-create-update.test.ts
   [OK ] wo.additional-work-approval tests/backend/p1-19-customer-approvals.test.ts
   [OK ] wo.additional-work-approval-read tests/backend/p1-19-customer-approvals.test.ts
   [OK ] wo.additional-work-detail-read tests/backend/p1-19-additional-work.test.ts
   [OK ] wo.additional-work-detail-record tests/backend/p1-19-additional-work.test.ts
   [OK ] wo.additional-work-fulfillment tests/backend/p1-19-additional-work.test.ts
   [OK ] wo.additional-work-list tests/backend/p1-19-additional-work.test.ts
   [OK ] wo.additional-work-request tests/backend/p1-19-additional-work.test.ts
   [OK ] wo.additional-work-withdraw tests/backend/p1-19-additional-work.test.ts
   [OK ] wo.job-assignment-create tests/backend/p1-19-job-assignments.test.ts
   [OK ] wo.job-assignment-end tests/backend/p1-19-job-assignments.test.ts
   [OK ] wo.job-assignment-list tests/backend/p1-19-job-assignments.test.ts
   [OK ] wo.job-create tests/backend/p1-19-work-order-jobs.test.ts
   [OK ] wo.job-history tests/backend/p1-19-job-lifecycle.test.ts
   [OK ] wo.job-reassignment tests/backend/p1-19-job-assignments.test.ts
   [OK ] wo.job-transition tests/backend/p1-19-job-lifecycle.test.ts + tests/backend/p1-19-customer-approvals.test.ts
   [OK ] wo.job-update tests/backend/p1-19-work-order-jobs.test.ts
   [OK ] wo.required-part-list tests/backend/p1-19-work-order-lines.test.ts
   [OK ] wo.required-part-record tests/backend/p1-19-work-order-lines.test.ts
   [OK ] wo.service-line-list tests/backend/p1-19-work-order-lines.test.ts
   [OK ] wo.service-line-record tests/backend/p1-19-work-order-lines.test.ts
   [OK ] wo.work-order-closure tests/backend/p1-19-work-order-core.test.ts
   [OK ] wo.work-order-closure-eligibility tests/backend/p1-19-work-order-core.test.ts
   [OK ] wo.work-order-detail tests/backend/p1-19-work-order-reads.test.ts
   [OK ] wo.work-order-history tests/backend/p1-19-work-order-reads.test.ts
   [OK ] wo.work-order-list tests/backend/p1-19-work-order-reads.test.ts
   [OK ] wo.work-order-transition tests/backend/p1-19-work-order-core.test.ts

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

OK: every registered operation is invoked in a referencing test and provides its required evidence.
Matrix written to docs/phase-1/phase-1-14|15/evidence/operation-test-matrix.json, a block in a
backend test, an import line in , then
[1m[46m RUN [49m[22m [36mv3.2.7 [39m[90mC:/Users/Ezzaldeen/OneDrive/Desktop/1millions/RootLco[39m. 5. **P1-20 inventory script** modelled on ,
wired into and . 6. Waves 5-8, hostile audit, reviews, full reproof, clean room, then the two
protected merges.

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
