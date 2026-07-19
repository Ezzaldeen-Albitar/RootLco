# Phase 1-6 — Traceability Matrix

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-6 — CRM and Business Partner Database ·
**Branch:** `feature/p1-06-crm-business-partner-database` · **Date:** 2026-07-19

Every Phase 1-6 requirement ID is mapped to the migration that implements it,
the primary database object(s), the test that proves it, and its status. All
rows are **Done** and committed on the feature branch. Object counts are drawn
from live introspection (see the [object inventory](./crm-object-inventory.md)).

## Database schema (DB-001 … DB-019)

| Req    | Requirement                   | Migration | Object(s)                                                               | Test                                 | Status  |
| ------ | ----------------------------- | --------- | ----------------------------------------------------------------------- | ------------------------------------ | ------- |
| DB-001 | Business-partner party master | `…090000` | `crm.business_partners`                                                 | `crm-business-partners.test.ts`      | ✅ Done |
| DB-002 | Individual profile            | `…092000` | `crm.individual_profiles`                                               | `crm-profiles.test.ts`               | ✅ Done |
| DB-003 | Company profile               | `…092000` | `crm.company_profiles`, `crm.partner_sensitive_attributes`              | `crm-profiles.test.ts`               | ✅ Done |
| DB-004 | Partner identifiers (+ tax)   | `…091000` | `crm.partner_identifiers`                                               | `crm-partner-identifiers.test.ts`    | ✅ Done |
| DB-005 | Dated partner roles           | `…093000` | `crm.partner_roles` (GiST EXCLUDE)                                      | `crm-partner-roles.test.ts`          | ✅ Done |
| DB-006 | Partner status history        | `…094000` | `crm.partner_status_history` (append-only)                              | `crm-partner-status-history.test.ts` | ✅ Done |
| DB-007 | Segments & assignments        | `…095000` | `crm.customer_segments`, `crm.partner_segment_assignments`              | `crm-segments.test.ts`               | ✅ Done |
| DB-008 | Customer restrictions         | `…096000` | `crm.customer_restrictions`                                             | `crm-customer-restrictions.test.ts`  | ✅ Done |
| DB-009 | Contact points                | `…097000` | `crm.contact_points`                                                    | `crm-contacts-addresses.test.ts`     | ✅ Done |
| DB-010 | Addresses                     | `…097000` | `crm.addresses`                                                         | `crm-contacts-addresses.test.ts`     | ✅ Done |
| DB-011 | Communication preferences     | `…098000` | `crm.communication_preferences`                                         | `crm-preferences-consent.test.ts`    | ✅ Done |
| DB-012 | Consent history               | `…098000` | `crm.consent_history` (append-only)                                     | `crm-preferences-consent.test.ts`    | ✅ Done |
| DB-013 | Customer alerts               | `…099000` | `crm.customer_alerts`                                                   | `crm-alerts-credit.test.ts`          | ✅ Done |
| DB-014 | Credit profile                | `…099000` | `crm.customer_credit_profiles`                                          | `crm-alerts-credit.test.ts`          | ✅ Done |
| DB-015 | Block history + coherence     | `…100000` | `crm.customer_block_history`, `guard_partner_block_coherence`           | `crm-block-history.test.ts`          | ✅ Done |
| DB-016 | Duplicate candidates          | `…101000` | `crm.duplicate_candidates`                                              | `crm-duplicates-merges.test.ts`      | ✅ Done |
| DB-017 | Partner merges                | `…101000` | `crm.partner_merges`, `resolve_partner_survivor`, `stamp_partner_merge` | `crm-duplicates-merges.test.ts`      | ✅ Done |
| DB-018 | Communication log             | `…102000` | `crm.communication_log`                                                 | `crm-communication-timeline.test.ts` | ✅ Done |
| DB-019 | Timeline events               | `…102000` | `crm.timeline_events`, `emit_timeline_event`                            | `crm-communication-timeline.test.ts` | ✅ Done |

## Cross-cutting DB, QA, security, DevOps (DB-020 … DO-001)

| Req     | Requirement                                | Where                                                   | Test / Evidence                                                                                                                                                                                                      | Status  |
| ------- | ------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| DB-020  | Concurrency-safe display numbers           | `…090000`                                               | `crm-display-number.test.ts`                                                                                                                                                                                         | ✅ Done |
| DB-021  | Search normalization + projection contract | `…103000`                                               | `crm-search-normalization.test.ts`                                                                                                                                                                                   | ✅ Done |
| DB-022  | Index / EXPLAIN review                     | all                                                     | [migration classification](../../database/phase-1-6-migration-classification.md) index posture; [object inventory](./crm-object-inventory.md) (68 indexes). Verdict: no hot-path FK unsupported; no new index needed | ✅ Done |
| DB-023  | RLS / grants / sensitive-access review     | all                                                     | [RLS matrix](./crm-rls-policy-matrix.md), [grant matrix](./crm-grant-matrix.md): 21/21 FORCE RLS, 58 policies, roles NOBYPASSRLS, 0 SECURITY DEFINER                                                                 | ✅ Done |
| DB-024  | Config-only seeds (no PII)                 | —                                                       | No CRM seed; `no-fake-data.test.ts` asserts all `crm` tables empty                                                                                                                                                   | ✅ Done |
| DB-025  | Migration + pipeline rehearsal             | CI + clean-room                                         | CI `database` job (apply → validate-seed-state → validate-crm-classification → test:db); Wave 7 clean-room (idempotent from empty)                                                                                   | ✅ Done |
| QA-006  | Two-tenant isolation suite                 | `crm-isolation.test.ts`                                 | Covers all 21 CRM tables; auto-fails if a new CRM table lacks coverage                                                                                                                                               | ✅ Done |
| QA-007  | Concurrency suite                          | `crm-concurrency.test.ts`, `crm-display-number.test.ts` | Single-winner races (23505 / 23P01 / 23514 / 40P01 / 55P03); 5-run stability                                                                                                                                         | ✅ Done |
| QA-008  | Pipeline rehearsal (with DB-025)           | CI + clean-room                                         | as DB-025                                                                                                                                                                                                            | ✅ Done |
| SEC-001 | Personal-data classification registry      | `docs/database/crm-personal-data-classification.json`   | `scripts/check-crm-classification.mjs`; 298 cols / 7 restricted / 11 searchable                                                                                                                                      | ✅ Done |
| SEC-002 | RLS matrix                                 | [RLS matrix](./crm-rls-policy-matrix.md)                | Adversarial 4-lens self-review: 0 RLS defects; hardening `…104000`                                                                                                                                                   | ✅ Done |
| SEC-003 | Consent integrity                          | `…098000`, `…104000`                                    | Append-only consent; `guard_consent_insert`; deterministic `current_consent` (seq)                                                                                                                                   | ✅ Done |
| SEC-004 | Abuse-case review                          | [abuse-case record](./crm-abuse-case-record.md)         | 3 mediums fixed (`…104000`), 1 accepted; `crm-security-hardening.test.ts`                                                                                                                                            | ✅ Done |
| DO-001  | Classification lint in CI                  | `.github/workflows/ci.yml`                              | `validate:crm-classification` step in the `database` job                                                                                                                                                             | ✅ Done |

## Forward hand-off

The structural surface Phase 1-7 depends on is captured, and asserted by a test,
in the [P1-07 structural contract](./p1-07-structural-contract.md). The
application-layer write-path invariants deliberately deferred from this database
phase (identifier-type correctness, transition orchestration, forensic audit
trail) are recorded in the [target data model](./crm-target-data-model-phase-1-35.md)
and the [completion report](./phase-1-6-completion-report.md) known-limitations
section.
