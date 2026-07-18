# Phase 1-5 — Retention and Legal-Hold Design

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-5 · **Date:** 2026-07-18 ·
**Author:** Eng. Ezzaldeen Al-Bitar

## 1. Scope

Increment D (migration `20260718103000`) implements — for documents — the
disposition contract fixed by the Phase 1-2
[Retention and Sensitive-Data Standard](../../database/retention-and-sensitive-data-standard.md):
`shared.retention_classes` (platform class definitions),
`shared.legal_holds` (auditable per-document holds),
`shared.document_deletion_eligibility` (the deterministic three-gate answer),
and `shared.archive_document` (the only controlled transition to `archived`).
Seed `05_shared_reference.sql` (Increment M) supplies the five reference rows;
Increment L (`20260718111000`) closes the INSERT bypass around the audited
path. Evidence: `tests/db/shared-retention.test.ts` (14 tests) and
`tests/db/shared-hardening.test.ts`.

## 2. Entities

- **`shared.retention_classes`** — platform reference (no tenant column, a
  registered exception): `class_code` locked by CHECK to the five classes,
  `min_retention_days` (NULL = indefinite), `allows_deletion`. `class_code` is
  immutable (`23514`, proven) and the table is readable by every app role.
- **`shared.legal_holds`** — one **active** hold per document (partial unique
  index, second active hold fails `23505`, proven), `released_at`/`released_by`
  must be set together (CHECK, proven), core columns immutable, composite
  `(tenant_id, document_id)` FK so a cross-tenant hold is impossible. Runtime
  reads within-tenant only and cannot place or release holds (`42501`, proven)
  — holds are a governed backend operation.

## 3. The three gates

`shared.document_deletion_eligibility(tenant, document)` returns a single
reason code; disposition requires `eligible`. Gate order is fixed and the
legal-hold gate is evaluated **first**:

| Gate                                       | Check                                                                        | Blocking codes                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 1 — No legal hold                          | `documents.legal_hold` flag **or** an active `legal_holds` row               | `legal_hold`                                                                             |
| 2 — No active links                        | Any `document_links` row with `deleted_at IS NULL`                           | `active_links`                                                                           |
| 3 — Retention elapsed on a deletable class | Class exists, `allows_deletion`, a finite period, and the period has elapsed | `class_undefined` · `class_no_delete` · `retention_indefinite` · `retention_not_elapsed` |

Additional codes: `not_found` (also what another tenant sees — no existence
leak, proven) and `already_archived` (proven via a repeated archival).
`legal_hold` (both representations), `active_links`, `class_no_delete`,
`retention_not_elapsed`, and `eligible` are each proven by a dedicated test in
`shared-retention.test.ts`; `class_undefined` and `retention_indefinite` are
code-path outcomes of the same function without a dedicated test, and are
recorded here as such. The elapsed/un-elapsed outcomes are exercised with
**test-fixture class rows** that define finite periods, since the seed
deliberately configures none (§6).

## 4. The hold always wins

Both hold representations block absolutely: the `legal_hold` flag on the
document and an active hold record each return `legal_hold` before any other
gate is consulted (both proven). `shared.archive_document` re-runs eligibility
inside itself, so a held document can never be archived — the refusal is proven
(`23514`) against a held document.

## 5. Audited archival — atomic, with a proven audit-failure abort

`shared.archive_document(tenant, document, actor, reason, actor_kind)` is the
**only** route to `archived`:

1. Raises unless eligibility is exactly `eligible`.
2. Sets `status='archived'`, stamps `archived_at`.
3. **Final step, same transaction:** writes one `iam.audit_append` record
   (action `shared.document.archive`). There is no second audit system.

Proven in `shared-retention.test.ts`: an eligible document archives with
exactly one audit record in the same transaction; a second call fails
`already_archived`; and — the abort proof — a call with an invalid
`actor_kind` makes the audit write fail, after which the document is **still
`pending`** and **zero** audit records exist: the archival rolled back with the
failed audit. Runtime cannot execute the function at all (`42501`, proven);
there is no EXECUTE grant.

Increment L completes the containment: a document cannot be **inserted**
directly in `archived` state (initial-state guard, `23514`, proven in
`shared-hardening.test.ts`). This closed the INSERT bypass found by the
adversarial review (2026-07-18); the review closed with zero unresolved
Critical/High findings.

## 6. Five reference rows — periods pending owner configuration

Seed `05` inserts exactly the five platform classes and nothing else. Per the
Phase 1-2 standard, retention **durations are jurisdiction-dependent facts that
are never hard-coded**, so no period is invented:

| `class_code`                  | `min_retention_days`               | `allows_deletion`           |
| ----------------------------- | ---------------------------------- | --------------------------- |
| `operational`                 | NULL — pending owner configuration | true                        |
| `evidence-audit`              | NULL — pending owner configuration | true                        |
| `personal-data`               | NULL — pending owner configuration | true                        |
| `temporary`                   | 0 (explicit expiry)                | true                        |
| `immutable-financial-history` | NULL                               | **false** — never deletable |

Until the owner configures periods, gate 3 answers `retention_indefinite` for
the three owner-pending classes and `class_no_delete` for
`immutable-financial-history` — the safe default is **not eligible**. The one
deliberate exception is `temporary` (explicit expiry, 0 days), which can reach
`eligible` as soon as gates 1–2 pass. Seed state is re-validated in CI:
`validate:seed-state` runs before `test:db` (`.github/workflows/ci.yml`).

## 7. No physical deletion in this phase

`archive_document` changes **metadata state only**. No function, job, or grant
in Phase 1-5 deletes file bytes or hard-deletes rows: runtime/readonly hold no
DELETE anywhere on these tables, and the controlled deletion job of the
Phase 1-2 standard (§5) remains deferred to the phase that first needs it. This
is recorded as the honest current state, not an oversight.

## 8. Honest boundaries

Retention periods are unconfigured (owner decision pending); no disposition job
runs; placing/releasing holds and archiving are backend operations with no
runtime path; physical deletion of bytes is later backend/infra scope. CI on
the final SHA is owner-verifiable; the Phase 1-5 PR is not opened and the owner
gate is Pending.
