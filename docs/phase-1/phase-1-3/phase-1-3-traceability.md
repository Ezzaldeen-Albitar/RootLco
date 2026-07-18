# Phase 1-3 Traceability Register

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-3 · **Date:** 2026-07-17 · **Rule:** no task is Complete because a file
exists — every Complete row names executable evidence.

Migration files are abbreviated to their time component (`…100000` =
`supabase/migrations/20260717100000_org_reference_tables.sql`, etc.). Test
references are `file :: suite`.

| Task          | Delivered by                                                                     | Tests / evidence                                                                                                  | Status     |
| ------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------- |
| P1-03-DB-001  | …101000 `org.tenants`                                                            | org-tenants :: self-projection, integrity, denials                                                                | Complete   |
| P1-03-DB-002  | …101000 history + `change_tenant_status`                                         | org-tenants :: atomic transition, append-only                                                                     | Complete   |
| P1-03-DB-003  | …102000 `subscription_plans` + validation                                        | org-subscriptions :: validation, overlap, draft hiding                                                            | Complete   |
| P1-03-DB-004  | …102000 `tenant_subscriptions` + `current_subscription_plan_id`                  | org-subscriptions :: overlap, point-in-time, isolation                                                            | Complete   |
| P1-03-DB-005  | …103000 `legal_companies`                                                        | org-hierarchy :: CRUD, uniqueness, FK, immutability                                                               | Complete   |
| P1-03-DB-006  | …103000 `branches` (composite FK)                                                | org-hierarchy :: cross-tenant FK, codes, guards                                                                   | Complete   |
| P1-03-DB-007  | …103000 branch history + `change_branch_status`                                  | org-hierarchy :: atomic, reason, P0002, denials                                                                   | Complete   |
| P1-03-DB-008  | …104000 `departments`                                                            | org-structure :: scope, uniqueness, dead-parent                                                                   | Complete   |
| P1-03-DB-009  | …104000 `warehouses`                                                             | org-structure :: type CHECK, no-stock assertion, isolation                                                        | Complete   |
| P1-03-DB-010  | …104000 `storage_locations`                                                      | org-structure :: warehouse composite, archive guard                                                               | Complete   |
| P1-03-DB-011  | …104000 `cost_centers`                                                           | org-structure :: overlap 23P01, cross-company, isolation                                                          | Complete   |
| P1-03-DB-012  | …105000 settings tables + `validate_setting_value`                               | org-settings :: version model, typed validation, immutability                                                     | Complete   |
| P1-03-DB-013  | …100000 reference tables + IANA trigger                                          | verified probes + foundation allow-lists; ref-seed tests                                                          | Complete   |
| P1-03-DB-014  | …105000 tax classes/rates                                                        | org-settings :: numeric catalog, range, overlap, zero-seed                                                        | Complete   |
| P1-03-DB-015  | …102000 flags + …105000 overrides + `resolve_feature_enabled`                    | org-settings :: precedence ladder, overlap, P0002                                                                 | Complete   |
| P1-03-DB-016  | …106000 sequence FKs + code-governance register (design doc §4)                  | org-sequences :: 4 tests; Phase 1-2 suites unchanged                                                              | Complete   |
| P1-03-DB-017  | indexes across migrations + amendments                                           | org-security :: FK coverage, no duplicates                                                                        | Complete   |
| P1-03-DB-018  | RLS/policies in every migration                                                  | foundation :: forced-everywhere; per-suite isolation; [matrix](../../security/phase-1-3-org-rls-policy-matrix.md) | Complete   |
| P1-03-DB-019  | seeds/01 reference data                                                          | org-provisioning :: idempotence; OIR-04 kept open                                                                 | Complete   |
| P1-03-DB-020  | seeds/02 pilot + seeds/03 fictional                                              | org-provisioning :: footprints, zero-trace, mutual invisibility                                                   | Complete   |
| P1-03-DB-021  | [migration classification](../../database/phase-1-3-migration-classification.md) | rehearsals incl. real 106000 rollback                                                                             | Complete   |
| P1-03-DB-022  | …107000 idempotency + `provision_organization`                                   | org-provisioning :: atomicity, replay, conflict, injections                                                       | Complete   |
| P1-03-SEC-001 | default-deny RLS + FORCE everywhere                                              | foundation + every org suite as non-owner login                                                                   | Complete   |
| P1-03-SEC-002 | server-resolved context only; narrowing semantics                                | org suites (no-context = zero rows; ids never authorize)                                                          | Complete   |
| P1-03-SEC-003 | dictionary classification (live-catalog generated) + coverage assertion          | org-security :: dictionary coverage; [data-dictionary.md](../../database/data-dictionary.md)                      | Complete   |
| P1-03-SEC-004 | [abuse cases](../../security/phase-1-3-org-rls-policy-matrix.md) §2              | per-row test references                                                                                           | Complete   |
| P1-03-QA-001  | tenant isolation suites                                                          | org-tenants/hierarchy/structure/settings/provisioning                                                             | Complete   |
| P1-03-QA-002  | uniqueness + soft-delete reuse                                                   | org-hierarchy, org-structure                                                                                      | Complete   |
| P1-03-QA-003  | archive behaviour                                                                | org-structure :: archive frees code, dead parents reject, row preserved                                           | Complete   |
| P1-03-QA-004  | Phase 1-4 structural contract                                                    | org-security :: contracted constraint names + status vocabularies                                                 | Complete   |
| P1-03-QA-005  | subscription/feature suites                                                      | org-subscriptions, org-settings                                                                                   | Complete   |
| P1-03-QA-006  | seed + provisioning suites                                                       | org-provisioning                                                                                                  | Complete   |
| P1-03-QA-007  | migration apply/rollback + failure injection                                     | resets, classification rehearsals, injections                                                                     | Complete   |
| P1-03-DO-001  | CI: scope-exclusion guard step; database job exercises all of the above          | negative rehearsals R1–R4; **first GitHub run pending the PR — CI not claimed green**                             | Complete\* |
| P1-03-DOC-001 | data dictionary (21 tables, catalog-generated) + coverage test                   | org-security :: coverage                                                                                          | Complete   |
| P1-03-DOC-002 | [ERD source](../../database/erd/phase-1-3-organization.mmd) + design doc §7      | matches implementation; Figure 4.9 sync rides the DOCX window                                                     | Complete   |
| P1-03-DOC-003 | [provisioning runbook](./tenant-provisioning-runbook.md)                         | executed end-to-end; **self-validated** (no second engineer)                                                      | Complete   |

\* Complete as repository work; the remote CI run itself is the PR's to prove.

## Phase 1-5 forward correction (2026-07-18)

Historical P1-03 provisioning evidence remains valid for the generic function.
Increment M moved the controlled tenant payload out of automatic seeds into a
manual gated package and replaced seeded-tenant tests with ephemeral tenants.
