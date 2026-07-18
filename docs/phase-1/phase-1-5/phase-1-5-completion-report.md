# Phase 1-5 Completion Report

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Phase:** 1-5 — Shared Services Database ·
**Date:** 2026-07-18 · **Branch:** `feature/p1-05-shared-services-database`
(base `69e0da1`; final source commit `83f0f70`) ·
**Author:** Eng. Ezzaldeen Al-Bitar, under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)

## 1. What Phase 1-5 set out to do

Build the shared-services PostgreSQL foundation every later domain reuses —
secure document metadata with versioning and scan-gated acceptance, retention
and legal hold, governed message templates, outbound-message persistence, the
transactional event outbox, processed-event and durable-error records,
versioned settings and localization, search projections, and tags, notes, and
comments — **without** building any notification rendering, provider
integration, worker process, publisher/polling loop, or Phase 1-6 domain
object.

## 2. Stage A — protected-history preconditions

Before any implementation, the Phase 1-4 gate-record commit `c1c3fa4` was
proven contained in `origin/develop` (PR #20, merge `69e0da1`), and the
Phase 1-4 gate document's "13 migrations" figure was reconciled to the true
count of **20** as a forward documentation correction — no migration file was
altered. Both facts are recorded in [initial-audit.md §0](./initial-audit.md).

## 3. What was delivered

**Twelve timestamped migrations** (`20260718100000`–`111000`, Increments A–L)
plus the Increment M structural seed (`supabase/seeds/05_shared_reference.sql`).
Increments A–D (`100000`–`103000`) and the no-fake-data policy were merged into
`develop` mid-phase via **PR #24** (merge `ee3b1de`); Increments E–L
(`104000`–`111000`) and M are on the phase branch awaiting its pull request.
The repository now holds **32 migrations total**. Per the live catalog at
`83f0f70`: **22 tables, 22 functions, 51 triggers, 22 RLS policies, and 92
indexes** belong to Phase 1-5, each pinned by the exact allow-lists in
`tests/db/foundation.test.ts`.

| Increment | Migration / artifact             | Delivered                                                                                                                                                 |
| --------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A         | `20260718100000`                 | Dual-scope document categories (platform default / tenant override) + document metadata foundation                                                        |
| B         | `20260718101000`                 | Immutable document versions and file scan results; acceptance requires a clean scan                                                                       |
| C         | `20260718102000`                 | Generic document links with composite tenant FKs and the link-derived access contract                                                                     |
| D         | `20260718103000`                 | Retention classes, legal holds, `document_deletion_eligibility`, and audited `archive_document` (audit failure rolls the action back)                     |
| E         | `20260718104000`                 | Governed message templates + one-way template-version approval lifecycle; **no wording seeded**                                                           |
| F         | `20260718105000`                 | Outbound messages and append-only delivery attempts — **hash-only content** (32-byte rendered-content digest; destinations as user ref or 32-byte digest) |
| G         | `20260718106000`                 | Transactional event outbox + the constrained `app_worker` archetype and atomic claim/complete/fail functions                                              |
| H         | `20260718107000`                 | Append-only processed-event claims and sanitized durable error records (recursive context sanitizer)                                                      |
| I         | `20260718108000`                 | Append-only versioned system settings (`resolve_setting`) and the localization key/text foundation (`missing_translations`)                               |
| J         | `20260718109000`                 | Tenant-scoped search projections with a trigram index and the sensitive-read gate                                                                         |
| K         | `20260718110000`                 | Tags, soft-delete-aware entity assignments, editable notes, guarded comment threads                                                                       |
| L         | `20260718111000`                 | Hardening + forward corrections to merged A/B objects (see §6), exact grant/RLS posture assertions supported by `tests/db/shared-hardening.test.ts`       |
| M         | seed `05` + provisioning package | Five retention classes only (structure-as-data); pilot provisioning converted to a manual gated package (see §4)                                          |

Conventions carried unchanged from Phases 1-2..1-4: RLS **enabled and forced**
everywhere, SELECT-only runtime grants on business tables, composite
`(tenant_id, id)` child FKs, `SECURITY INVOKER` + empty `search_path` on every
routine, immutability and lifecycle guards as triggers, and reuse of
`iam.audit_append`, `shared.status_history`, and `shared.idempotency_keys`
rather than duplication.

## 4. The no-fake-data policy and the seed conversion

Mid-phase, the permanent
[no-fake-data standard](../../database/no-fake-data-standard.md) was adopted
(owner decision) and enforced by `npm run validate:no-fake-data` plus
`tests/db/no-fake-data.test.ts`: a clean database has **empty business
tables** — no invented tenants, templates, wording, or operational content.
Consequences executed in this phase:

- **Seeds 02 and 03 were deleted** (the pilot-provisioning seed and the local
  test-tenant seed). The pilot tenant is now provisioned only by a **manual,
  gated, controlled package**:
  `supabase/packages/pilot-provisioning.package.json`, executed by
  `scripts/db/provision-organization.mjs` under
  [pilot-provisioning-runbook.md](../../database/pilot-provisioning-runbook.md).
  Nothing about the pilot tenant is auto-seeded.
- **Seed 04 was converted to structural permissions only** (forward correction
  to Phase 1-4; its six baseline roles are now proven against a
  cascade-deleted ephemeral tenant in `tests/db/iam-seeds.test.ts`).
- **Seed 05 (Increment M) seeds exactly five tenant-neutral retention
  classes** — `operational`, `evidence-audit`, `personal-data`, `temporary`,
  `immutable-financial-history` — because Increment D's eligibility function
  is inert without them. Every retention period is NULL except
  `temporary = 0`; no period is invented.
- `npm run validate:seed-state` applies the declared seeds **twice** and
  asserts the clean business state; the CI database job runs it **before**
  `test:db`.
- Test fixtures use `fx_`-prefixed / synthetic identifiers by convention; no
  demo or fake business data exists anywhere in the tree.

## 5. The worker archetype (supersedes initial-audit §2)

The initial audit planned "no new database role in Phase 1-5". Implementation
superseded that with a **reviewed, tightly constrained alternative**: migration
`20260718106000` creates `app_worker` — a **NOLOGIN**, non-owner role with no
BYPASSRLS and no DDL — whose entire surface is:

- **Three tables:** `shared.event_outbox` (SELECT/INSERT/UPDATE),
  `shared.processed_events` (SELECT/INSERT — append-only),
  `shared.error_records` (SELECT/INSERT/UPDATE). No DELETE anywhere.
- **Four functions:** `shared.claim_outbox_events`,
  `shared.complete_outbox_event`, `shared.fail_outbox_event`, and
  `iam.current_user_id()`.
- Its `wkr_*` policies are deliberately **all-tenant** (infrastructure
  dispatch cannot depend on a user tenant session); `app_runtime` and
  `app_readonly` hold **nothing** on the three worker tables.

Claim integrity is atomic (`FOR UPDATE SKIP LOCKED`): parallel claimants
receive disjoint sets, wrong-claimant complete/fail raises, stale leases are
reclaimed with attempt accounting, and published/dead-letter rows are never
reclaimable — all proven in `tests/db/shared-event-outbox.test.ts`. The exact
grant surface is asserted table-by-table and function-by-function in
`tests/db/shared-hardening.test.ts`. No login credential exists for the role;
attaching a real worker process remains Phase 1-13 backend scope.

## 6. Forward corrections applied by this phase

Merged migrations are immutable (enforced by a CI check), so corrections are
fix-forward:

1. **Migration L** binds a document's branch to its company (composite FK; a
   same-tenant branch of a different company is now a violation), closes both
   direct terminal-state INSERT paths (a row cannot be born `archived`, a
   version cannot be born `accepted`), and adds the exact non-partial child
   indexes FK enforcement needs. Documents/versions were policy-guaranteed
   empty, so the change validates trivially.
2. **Seed 04 conversion** (§4) — a forward correction recorded in the
   Phase 1-4 document set.
3. **Migration-count reconciliation** (§2) — a forward correction to the
   Phase 1-4 owner gate.

## 7. CI

The database job applies all 32 migrations from empty, runs
`validate:seed-state`, then the full `test:db` suite; the secrets job runs the
scope, browser-secret, and no-fake-data guards. Three in-phase CI failures
were fixed on the branch: prettier formatting of the opening docs
(`e9003d9`), the no-fake-data guard scanning its own implementation
(`3d110f2`), and an unused test import (`67511b8`).

## 8. Tests

The database suite totals **488 tests in 36 files** (311 in 23 files at Phase
1-4 close): **177 new Phase 1-5 tests** across twelve `shared-*` suites plus
`no-fake-data.test.ts` and `provisioning-package.test.ts`, with the Phase
1-2..1-4 suites preserved and the provisioning/seed suites reworked for the
package model. Isolation assertions run as the non-owner runtime login.
**Clean-room result (2026-07-18):** on a fresh apply of all 32 migrations from
empty, followed by `validate:seed-state` (declared seeds applied twice) and
then the full suite in the CI order, **488/488 passed** — the run surfaced and
fixed one real defect (the retention suite's fixtures silently no-opped once
seed 05 pre-populated the retention classes; it now forces its own test
periods with `ON CONFLICT DO UPDATE`, robust to seed presence). **This report
does not claim a GitHub Actions run it did not observe:** the hosted CI result
on the final commit is **owner-verifiable** on the pushed branch and is
claimed only by the owner gate once the pull-request run reports.

## 9. Adversarial review (self-review ledger, 2026-07-18)

Fourteen attack vectors were worked end-to-end. **Zero unresolved Critical or
High findings.**

**Refuted (8)** — each with a live denial test:

| Vector                                  | Anchor                                                                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Tenant escape on any shared table       | `shared-*` isolation tests, e.g. `shared-tags-notes-comments.test.ts :: "isolates tenant A and B rows on all four tables"` |
| RLS bypass / SECURITY DEFINER abuse     | `shared-hardening.test.ts :: "keeps every module routine SECURITY INVOKER with an explicit empty search_path"`             |
| Outbox double-claim race                | `shared-event-outbox.test.ts :: "two parallel worker connections claim disjoint sets whose union is all N rows"`           |
| Immutable-version mutation              | `shared-document-versions.test.ts :: "an accepted version is terminal and immutable"`                                      |
| Duplicate idempotency (consumer replay) | `shared-processed-errors.test.ts :: "allows exactly one of two concurrent atomic claimants to receive a row"`              |
| Cross-tenant comments/tags              | `shared-tags-notes-comments.test.ts :: "rejects cross-tenant tag assignment with 23503"` (and cross-tenant parent)         |
| Fake-data leakage into a clean database | `no-fake-data.test.ts` + `validate:seed-state`                                                                             |
| Phase 1-6 scope creep                   | `shared-hardening.test.ts :: "has exactly the five module schemas and no Phase 1-6 crm/veh tables"`                        |

**Fixed (3):**

1. **Company/branch mismatch** on documents — fixed in Migration L
   (`shared-hardening.test.ts :: "rejects a same-tenant branch that belongs to a different company"`).
2. **Terminal-state INSERT bypass of retention/legal-hold guards** — fixed in
   Migration L (direct `archived` document and direct `accepted` version
   INSERTs both rejected).
3. **Unsafe error metadata** — Increment H's sanitizer patterns were
   unanchored/too loose; corrected to recursive, anchored screening
   (`shared-processed-errors.test.ts :: "rejects embedded JWT-shaped substrings recursively but accepts a benign eyJ marker"`).

**Accepted (3), documented residual risk:**

1. **MEDIUM** — `event_outbox.payload` and delivery-attempt detail JSON have
   **no sanitizer trigger**; keeping secrets out of them is an explicit
   producer/worker responsibility (backend phases). The error-record store,
   by contrast, is trigger-sanitized.
2. **LOW (deliberate)** — the `wkr_*` policies are all-tenant; probe-verified
   as confined to exactly three tables and four functions
   (`shared-hardening.test.ts` privilege-surface tests).
3. **LOW** — `document_links.linked_by` is a plain `uuid` (predates the
   attribution-FK rule); revisited when the rule is applied retroactively.

## 10. Honest limits and open items

1. **The pull request for Increments E–M has NOT been opened.** No GitHub
   Actions run is claimed for `83f0f70`; CI there is owner-verifiable, not
   observed by this environment.
2. **The Phase 1-5 owner gate is Pending** —
   [phase-1-5-owner-gate.md](./phase-1-5-owner-gate.md).
3. **Phase 1-6 has not been started.** No crm/veh object exists (tested).
4. **No notification rendering, no provider integration, no worker process,
   and no outbox publisher exist.** The database stores hash-only content and
   claim primitives; dispatch is Phase 1-13 backend scope.
5. **Consent enforcement is not claimed** — only `purpose`, suppression
   fields, and a nullable `consent_ref` placeholder exist; the consent source
   arrives with later phases.
6. Generic `entity_type`/`entity_id` rows (links, tags, notes, comments,
   search) cannot carry domain FKs yet; the residual is bounded to
   within-tenant dangling references (initial audit R-P1-05-01).
7. **Solo review** throughout; independent security review remains open.

## 11. Scope confirmations

No fake or demo data (guarded in CI). No pilot-tenant business data seeded —
provisioning is a manual gated package only, and no file in this document set
names the pilot tenant. No credential/token column. No SECURITY DEFINER. No
DELETE grant to any application role. No Phase 1-6 table. No backend, API,
frontend, worker process, or provider integration.

## 12. Recommendation

Open the pull request for the branch. Under the Standing Technical
Authorization Policy the Phase 1-5 gate closes automatically on proven facts —
green mandatory CI on the final PR plus the merge into `develop` — recorded in
[phase-1-5-owner-gate.md](./phase-1-5-owner-gate.md). This report confers no
approval by itself.
