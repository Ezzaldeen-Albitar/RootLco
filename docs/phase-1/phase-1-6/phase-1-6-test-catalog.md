# Phase 1-6 — CRM Test Catalog

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-6 — CRM and Business Partner Database ·
**Branch:** `feature/p1-06-crm-business-partner-database`

All Phase 1-6 database tests run against a real PostgreSQL 17 instance with every
migration applied from empty. Evidence of RLS and privilege behaviour is always
gathered through the `app_runtime` role (`NOBYPASSRLS`), never the provisioning
superuser. Negative cases assert the exact SQLSTATE. Test data is ephemeral —
created inside the test and removed by `cleanFixtures`/rollback — in keeping with
the [no-fake-data policy](../../database/no-fake-data-standard.md).

## Summary

- **20** CRM test files · **160** CRM test cases (all passing).
- Plus the shared guards that also cover CRM: `foundation.test.ts` (exact
  object inventory of tables/functions/triggers/policies) and
  `no-fake-data.test.ts` (every `crm` base table empty after cleanup).
- The authoritative pass/fail signal is the CI **Database migrations and RLS
  tests** job, which runs the complete `test:db` suite (56 DB test files).

## CRM test files

| Test file                                                                                    | Cases | What it proves                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [`crm-business-partners.test.ts`](../../../tests/db/crm-business-partners.test.ts)           |    15 | Party master: tenant-unique display number, party_type discriminator, lifecycle guards, FORCE-RLS isolation, merge freeze.                                                                                                                       |
| [`crm-partner-identifiers.test.ts`](../../../tests/db/crm-partner-identifiers.test.ts)       |    14 | Identifier uniqueness (partial index), restricted classification, sensitive-view gate on raw/normalized values, and the restricted-INSERT permission gate.                                                                                       |
| [`crm-profiles.test.ts`](../../../tests/db/crm-profiles.test.ts)                             |    11 | Individual/company profile exclusivity via the `(tenant_id, id, party_type)` discriminator; gated date of birth.                                                                                                                                 |
| [`crm-partner-roles.test.ts`](../../../tests/db/crm-partner-roles.test.ts)                   |    13 | Dated roles; `btree_gist` EXCLUDE forbids overlapping same-role intervals; `valid_from NOT NULL`.                                                                                                                                                |
| [`crm-partner-status-history.test.ts`](../../../tests/db/crm-partner-status-history.test.ts) |     7 | Append-only status history (UPDATE/DELETE → 42501); server-stamped actor/time; no-op transition guard.                                                                                                                                           |
| [`crm-segments.test.ts`](../../../tests/db/crm-segments.test.ts)                             |     8 | Tenant-defined segments and dated assignments; single open assignment per partner/segment.                                                                                                                                                       |
| [`crm-customer-restrictions.test.ts`](../../../tests/db/crm-customer-restrictions.test.ts)   |     7 | Restriction records, scope, and referential integrity with block history.                                                                                                                                                                        |
| [`crm-contacts-addresses.test.ts`](../../../tests/db/crm-contacts-addresses.test.ts)         |     6 | Contact points and addresses; one active primary per channel/type (partial unique index).                                                                                                                                                        |
| [`crm-preferences-consent.test.ts`](../../../tests/db/crm-preferences-consent.test.ts)       |     7 | Communication preferences; append-only consent ledger; deterministic `current_consent`.                                                                                                                                                          |
| [`crm-alerts-credit.test.ts`](../../../tests/db/crm-alerts-credit.test.ts)                   |     7 | Operational alerts and per-partner credit profile; currency FK.                                                                                                                                                                                  |
| [`crm-block-history.test.ts`](../../../tests/db/crm-block-history.test.ts)                   |     6 | Append-only block/unblock ledger backing lifecycle coherence; monotonic `seq` ordering.                                                                                                                                                          |
| [`crm-duplicates-merges.test.ts`](../../../tests/db/crm-duplicates-merges.test.ts)           |     8 | One open duplicate candidate per pair; immutable merge records; counts-only `merge_summary`.                                                                                                                                                     |
| [`crm-communication-timeline.test.ts`](../../../tests/db/crm-communication-timeline.test.ts) |     7 | Communication log; append-only timeline written through `emit_timeline_event`; direct-insert attribution is server-stamped (not forgeable).                                                                                                      |
| [`crm-search-normalization.test.ts`](../../../tests/db/crm-search-normalization.test.ts)     |     9 | `normalize_name/email/phone` determinism and Arabic-safety; restricted data never projected.                                                                                                                                                     |
| [`crm-display-number.test.ts`](../../../tests/db/crm-display-number.test.ts)                 |     4 | Concurrency-safe, gapless-per-tenant partner display numbers under contention.                                                                                                                                                                   |
| [`crm-isolation.test.ts`](../../../tests/db/crm-isolation.test.ts)                           |     7 | **QA-006** — two-tenant isolation across all 21 CRM tables (reads AND cross-tenant UPDATE/DELETE/INSERT), plus no-context default-deny; auto-fails if a new CRM table lacks coverage.                                                            |
| [`crm-concurrency.test.ts`](../../../tests/db/crm-concurrency.test.ts)                       |     5 | **QA-007** — single-winner races: identifier/candidate/primary-contact (23505), role overlap (23P01/40P01/55P03), same-source merge (23514/40P01/55P03).                                                                                         |
| [`crm-security-hardening.test.ts`](../../../tests/db/crm-security-hardening.test.ts)         |     7 | **SEC-002/003/004** — cannot create a partner already blocked/merged; jsonb raw-value keys rejected at any depth; same-effective-time consent resolves deterministically by `seq`.                                                               |
| [`crm-role-grants.test.ts`](../../../tests/db/crm-role-grants.test.ts)                       |     4 | **DB-023** — `app_readonly` is read-only + tenant-scoped (all writes 42501); `app_worker` has no crm access at all (even SELECT 42501).                                                                                                          |
| [`crm-structural-contract.test.ts`](../../../tests/db/crm-structural-contract.test.ts)       |     8 | **P1-07 hand-off** — pins the stable surface the next phase binds to: party-master columns, profile keys, sensitive-gate wiring, resolver/normalizer/writer functions, FORCE RLS, NOBYPASSRLS roles, no SECURITY DEFINER, no app-role ownership. |

## Cross-cutting guards (shared files that also gate CRM)

| Test file                                                        | Role for CRM                                                                                                                                                                                    |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`foundation.test.ts`](../../../tests/db/foundation.test.ts)     | Asserts the **exact** live inventory — any unexpected table, function, trigger, or policy fails the build. The 21 CRM tables, 13 functions, and their triggers/policies are in the allow-lists. |
| [`no-fake-data.test.ts`](../../../tests/db/no-fake-data.test.ts) | Discovers every `org/iam/shared/crm` base table and asserts zero business rows after cleanup. A new CRM table joins the empty-set invariant automatically.                                      |

## Determinism and concurrency

The concurrency suite runs genuinely parallel transactions on independent
`app_runtime` connections and asserts exactly one committer per contended
invariant; the loser SQLSTATE may legitimately vary (a GiST EXCLUDE race can
surface as `23P01`, `40P01`, or `55P03`), but never two winners. The suite was
verified stable across five consecutive runs. Same-transaction ordering is made
deterministic by the monotonic `seq` IDENTITY column on the block and consent
history tables (see the [audit & timeline matrix](./crm-audit-and-timeline-matrix.md)).
