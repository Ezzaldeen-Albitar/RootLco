# Phase 1-6 Migration Classification

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-6 · **Date:** 2026-07-19 · **Owner:** crm module
(Eng. Ezzaldeen Al-Bitar)

Naming: 14-digit `supabase migration new` timestamps (migration standard §3).
Phase 1-6 uses the `20260719<hhmmss>` band (`090000..106000`); application
order = filename order. The repository holds **49 migrations total**; **17** of
them are Phase 1-6 CRM migrations, listed below.

**Classified before merge.** Every Phase 1-6 migration header declares its
Purpose, Tasks, Dependencies, and a Rollback classification at authoring time.
All seventeen live on `feature/p1-06-crm-business-partner-database` and are **not
yet merged** — the pull request is not open at the time of writing. Because none
has entered protected history, there is no fix-forward-vs-edit constraint within
the branch; the final merged set is what CI validates on the feature PR's exact
SHA.

## Classification legend

- **schema** — creates tables, columns, constraints, keys.
- **security** — RLS enable/force, policies, grants, revokes, role posture.
- **function** — functions and triggers (write-time invariants, resolvers, normalizers).
- **index** — performance/uniqueness indexes (including partial and GiST EXCLUDE).
- **reference** — tenant-neutral structural reference rows. _(Phase 1-6 has **none** — CRM ships zero reference and zero business rows; see [no-fake-data](../phase-1/phase-1-6/phase-1-6-evidence-register.md).)_

Every CRM migration is a composite of **schema + security + function + index**
(each table is created, force-RLS'd with per-command policies, granted to the
app roles, indexed, and — where it carries an invariant — given trigger
functions) in a single file. The dominant class is noted per row.

## Migration table

| Migration                                       | Tasks                       | Dominant class           | Forward behaviour                                                                                                                                                                                                                                                                                                | Rollback class                                                       | Evidence                                                               |
| ----------------------------------------------- | --------------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `20260719090000_crm_business_partners.sql`      | DB-001                      | schema+security+function | Party master `business_partners`; tenant-unique display number; party_type discriminator; block/merge lifecycle guards; FORCE RLS + per-command policies                                                                                                                                                         | rollback-safe while empty → roll-forward-only once partners exist    | `crm-business-partners.test.ts` (15), `crm-display-number.test.ts` (4) |
| `20260719091000_crm_partner_identifiers.sql`    | DB-004                      | schema+security          | `partner_identifiers`; restricted raw/normalized values under the sensitive-view gate; partial unique index per (tenant, type, normalized)                                                                                                                                                                       | rollback-safe while empty → roll-forward-only once identifiers exist | `crm-partner-identifiers.test.ts` (13)                                 |
| `20260719092000_crm_profiles.sql`               | DB-002, DB-003              | schema+security          | `individual_profiles`, `company_profiles`, `partner_sensitive_attributes`; profile exclusivity via `(tenant_id, id, party_type)`; gated DOB                                                                                                                                                                      | rollback-safe while empty → roll-forward-only once profiles exist    | `crm-profiles.test.ts` (11)                                            |
| `20260719093000_crm_partner_roles.sql`          | DB-005                      | schema+index             | `partner_roles`; `btree_gist` EXCLUDE forbids overlapping same-role intervals; `valid_from NOT NULL`                                                                                                                                                                                                             | rollback-safe while empty → roll-forward-only once roles exist       | `crm-partner-roles.test.ts` (13)                                       |
| `20260719094000_crm_partner_status_history.sql` | DB-006                      | schema+function          | Append-only `partner_status_history`; INSERT+SELECT grants only; shared status-stamp trigger; no-op transition guard                                                                                                                                                                                             | rollback-safe while empty → roll-forward-only once history exists    | `crm-partner-status-history.test.ts` (7)                               |
| `20260719095000_crm_segments.sql`               | DB-007                      | schema+security          | `customer_segments`, `partner_segment_assignments`; single open assignment; composite tenant/partner/segment FKs                                                                                                                                                                                                 | rollback-safe while empty → roll-forward-only once populated         | `crm-segments.test.ts` (8)                                             |
| `20260719096000_crm_customer_restrictions.sql`  | DB-008                      | schema+security          | `customer_restrictions`; scope + reason; referenced by block history                                                                                                                                                                                                                                             | rollback-safe while empty → roll-forward-only once populated         | `crm-customer-restrictions.test.ts` (7)                                |
| `20260719097000_crm_contacts_addresses.sql`     | DB-009, DB-010              | schema+index             | `contact_points`, `addresses`; one active primary per channel/type (partial unique indexes)                                                                                                                                                                                                                      | rollback-safe while empty → roll-forward-only once populated         | `crm-contacts-addresses.test.ts` (6)                                   |
| `20260719098000_crm_preferences_consent.sql`    | DB-011, DB-012              | schema+function          | `communication_preferences`; append-only `consent_history`; `guard_consent_insert`; deterministic `current_consent`                                                                                                                                                                                              | rollback-safe while empty → roll-forward-only once consent exists    | `crm-preferences-consent.test.ts` (7)                                  |
| `20260719099000_crm_alerts_credit.sql`          | DB-013, DB-014              | schema+security          | `customer_alerts`; `customer_credit_profiles`; currency FK; one profile per partner                                                                                                                                                                                                                              | rollback-safe while empty → roll-forward-only once populated         | `crm-alerts-credit.test.ts` (7)                                        |
| `20260719100000_crm_block_history.sql`          | DB-015                      | schema+function          | Append-only `customer_block_history` backing lifecycle coherence; block-coherence guard requires a matching history row                                                                                                                                                                                          | rollback-safe while empty → roll-forward-only once history exists    | `crm-block-history.test.ts` (6)                                        |
| `20260719101000_crm_duplicates_merges.sql`      | DB-016, DB-017              | schema+function          | `duplicate_candidates` (one open per pair); immutable `partner_merges`; counts-only `merge_summary`; survivor validation                                                                                                                                                                                         | rollback-safe while empty → roll-forward-only once populated         | `crm-duplicates-merges.test.ts` (8)                                    |
| `20260719102000_crm_communication_timeline.sql` | DB-018, DB-019              | schema+function          | `communication_log`; append-only `timeline_events` written only through `emit_timeline_event`                                                                                                                                                                                                                    | rollback-safe while empty → roll-forward-only once populated         | `crm-communication-timeline.test.ts` (6)                               |
| `20260719103000_crm_search_normalization.sql`   | DB-021                      | function                 | `normalize_name/email/phone` (IMMUTABLE, Arabic-safe); search projection contract; restricted data never projected                                                                                                                                                                                               | **rollback-safe** (functions only; no data)                          | `crm-search-normalization.test.ts` (9)                                 |
| `20260719104000_crm_security_hardening.sql`     | SEC-002, SEC-004            | function+schema          | Forward hardening: monotonic `seq` on block/consent history; INSERT-path block/merge guards; whole-document case-insensitive jsonb raw-value scan; deterministic `current_consent`                                                                                                                               | roll-forward-only once history rows exist; rollback-safe while empty | `crm-security-hardening.test.ts` (7)                                   |
| `20260719105000_crm_review_hardening.sql`       | SEC-004, DB-016/017, DB-019 | security+function        | Wave 7 review hardening: gate restricted-identifier INSERT on the sensitive permission; `UNIQUE (tenant_id, source_partner_id)` on `partner_merges`; reject merge into a soft-deleted survivor; monotonic `seq` on `partner_status_history` + `timeline_events`; BEFORE-INSERT server-stamp on `timeline_events` | roll-forward-only once rows exist; rollback-safe while empty         | `crm-partner-identifiers.test.ts` (14), `crm-role-grants.test.ts` (4)  |
| `20260719106000_crm_fk_index_coverage.sql`      | DB-022                      | index                    | Foreign-key index coverage to conform to the enforced repo standard P1-03-DB-017: 11 new FK-support indexes + 4 profile/redirect indexes made non-partial, so every crm FK has a non-partial leading-column index                                                                                                | **fully rollback-safe** (index-only)                                 | `org-security.test.ts` FK-coverage + no-duplicate-index tests          |

**No reference/seed migrations.** Phase 1-6 introduces no reference-configuration
seed. CRM business tables start empty and remain empty after clean migration;
the [`no-fake-data.test.ts`](../../tests/db/no-fake-data.test.ts) guard scans the
`crm` schema and asserts zero rows. This satisfies DB-024 by construction.

**Index posture (DB-022).** 79 indexes exist across the 21 tables (primary keys,
composite tenant candidate keys, partial unique indexes for single-primary and
single-open-assignment invariants, the GiST EXCLUDE for role intervals, and
FK-support/lookup indexes). The repo-wide standard **P1-03-DB-017** — enforced by
`org-security.test.ts` — requires **every** module-schema FK to have a
non-partial index whose leading columns cover it. The initial Wave-5 DB-022
review had accepted several low-cardinality reference FKs without a dedicated
index; migration `20260719106000` reconciles Phase 1-6 to the enforced standard
by adding 11 covering indexes and making 4 profile/redirect FK indexes
non-partial, so **every** crm FK is now index-covered and no exact-duplicate
index exists. Full listing: the
[object inventory](../phase-1/phase-1-6/crm-object-inventory.md).
