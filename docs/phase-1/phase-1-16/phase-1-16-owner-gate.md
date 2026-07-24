# Phase 1-16 Gate — CRM Backend

**Phase:** 1-16 — CRM Backend · **Gate package:** post-merge gate record ·
**Review model:** the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)
under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md).
**This is not an independent third-party review and is never represented as one.**
**Date opened:** 2026-07-23 · **Date decided:** 2026-07-24 (Asia/Amman).

---

## Decision: **Go — P1-16 CRM Backend Gate Passed**

This decision is recorded from the **protected post-merge state** — `origin/develop` at
`4576db2fee308b4a2e2a78a0bbf9b30a03c6a9b6`, the merge of Remediation PR #68 — after the complete
feature-plus-remediation chain (PR #66, PR #67, PR #68) reached protected history through owner
pull-request merges and was independently re-verified on the exact merged SHA. **No condition below
was closed on a feature branch; each was evidenced on protected `develop`.** `origin/main` remains
`8ca1da257fc89585f2bb45459e435ec124b8a5a7`, untouched.

The gate was **genuinely open** until this evidence existed. It shipped in **Pending** with the
feature delivery and stayed Pending across the post-merge remediation. Its complete original Pending
text is preserved **byte-verbatim** in [§8](#8-preserved-pending-record-byte-verbatim); this record
adds the decision and its evidence and does not rewrite the record it was made against.

## 1. What this gate governs

Phase 1-17 may not begin until the CRM application backend — customer search, individual/company
creation, contacts/addresses/preferences, consents, notes/alerts/tags, guarded customer statuses,
restrictions, deterministic duplicate scoring, replay-safe duplicate review, provenance-preserving
customer merge, read-only history/timeline projections, and tenant-safe customer–vehicle links — is
implemented, evidenced at operation depth on the least-privilege runtime role, green in hosted CI on
the exact merged SHA, and clean-room reproducible. That condition is now met.

## 2. Protected history

The whole of P1-16 reached protected `develop` through three owner-merged pull requests and nothing
else. Every merge is an owner pull-request merge; no direct push entered protected history.
`origin/main` was not touched by any of them.

| PR      | Title                                                                     | Reviewed head SHA | Merge commit | Merged (Asia/Amman) | Method       | Tree equivalence (merge tree == reviewed-head tree)       | Hosted CI       |
| ------- | ------------------------------------------------------------------------- | ----------------- | ------------ | ------------------- | ------------ | --------------------------------------------------------- | --------------- |
| **#66** | [P1-16] DBCR-P1-16-001 — `shared.notes` runtime write capability          | `a43f1a5`         | `a09f40c`    | 2026-07-23 23:55    | Merge commit | verified contained                                        | CI #164 Success |
| **#67** | [P1-16] Implement CRM backend                                             | `dd68990`         | `0035f67`    | 2026-07-24 11:25    | Merge commit | develop-then tree `b095d46` == `dd68990` tree             | CI #168 Success |
| **#68** | [P1-16] Fix duplicate-candidate re-score crash and back idempotency proof | `ddb93dd`         | `4576db2`    | 2026-07-24 13:48    | Merge commit | develop-now tree `dd1cccbd` == `ddb93dd` (byte-identical) | CI #171 Success |

Containment on current `origin/develop` (`4576db2`): `a09f40c`, `dd68990`, `0035f67`, and `ddb93dd`
are all ancestors. `4576db2` has parents `0035f67` + `ddb93dd`; its tree (`dd1cccbd…`) is
byte-identical to the reviewed remediation head `ddb93dd` (0-file diff). `0035f67` (the feature
merge) has parents `a09f40c` + `dd68990` and a tree byte-identical to the reviewed feature head
`dd68990`. `origin/main` remains `8ca1da2`.

### 2.1 Why a remediation followed the feature merge

Recorded plainly because it is the point of the record.

1. **PR #66** landed the one database gap Wave 0 found — the `app_runtime` role could not write
   `shared.notes`, which `crm.note-add` requires — as its own migration (the **119th**, DBCR-P1-16-001),
   _before_ the feature. The CRM database is otherwise consumed exactly as P1-6 froze it.
2. **PR #67** merged the feature and made this Pending gate protected.
3. The post-merge gate review reproduced one **High** correctness defect: `upsertCandidate` re-scored
   an existing open `crm.duplicate_candidates` row with `UPDATE … SET match_score, match_basis`, and
   `match_score`/`match_basis` are **immutable by schema** (`tg_duplicate_candidates_immutable` →
   `org.guard_immutable_columns`). When a re-scan recomputed a different score the guard raised
   `check_violation`, which `scanForDuplicates` did not handle, so the whole scan returned 500 and
   rolled back. It was fixed in **PR #68** (no migration): a candidate's score is frozen at detection,
   so `upsertCandidate` now returns any existing candidate — in **any** status — untouched and never
   issues the immutable-column UPDATE. The same PR backed five idempotency-evidence declarations with
   genuine same-key replay assertions.

## 3. Verification evidence on the exact merged SHA (`4576db2`)

Re-run from protected `develop`, not a feature branch.

### 3.1 Hosted CI (post-merge, push event on `develop`)

CI **#171** (run `30087467175`), SHA `4576db2`, **Status Success**, 4m 34s. All four required jobs
green: Lint/types/tests/build (2m 11s), Docker build validation (4m 29s), Database migrations and RLS
tests (4m 00s), Secret and sensitive-file scan (10s). This is a genuine post-merge push run, not a
PR-head substitute.

### 3.2 Local exact-SHA battery (protected `develop`, checked out at `4576db2`)

| Gate                                                                                                                | Result                       |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| format:check · lint · typecheck                                                                                     | green                        |
| module-boundaries · authorization-coverage · openapi · encoding · crm-classification · canonical-docs · style:check | green                        |
| security:all (tracked-secrets, browser-secrets, scope-exclusions, no-fake-data)                                     | green                        |
| Unit suite (`test`)                                                                                                 | **733 passed** (38 files)    |
| Database suite (`test:db`)                                                                                          | **1547 passed** (132 files)  |
| Backend suite (`test:backend`)                                                                                      | **455 passed** (21 files)    |
| Build (`next build`) · `docker compose config`                                                                      | green · valid                |
| Operation-coverage generator drift (regen → format → regen → tree)                                                  | no drift; working tree clean |

### 3.3 Operation-to-test coverage (STRICT gate)

| P1-16 metric      | Value  |
| ----------------- | ------ |
| Registered public | **18** |
| Operation-depth   | **18** |
| Invocation-only   | 0      |
| Pending           | 0      |
| Unit-only         | 0      |
| Unreferenced      | 0      |
| Metadata-only     | 0      |

All 18 CRM operations are invoked in a referencing backend test that provides their required evidence,
executed against a real database on the least-privilege `app_runtime` role.

### 3.4 High-fix reproof and idempotency evidence

- **Re-score regression** (`p1-16-customer-identity.test.ts`): scan a pair, strengthen its evidence
  (shared contact so a recompute would score higher), re-scan → asserts **200 (not 500)**, exactly one
  candidate, frozen score unchanged. This test fails on the pre-fix implementation.
- **Immutable guard intact, not weakened:** the clean-room confirms
  `tg_duplicate_candidates_immutable` is present on `crm.duplicate_candidates` (and, by the same
  convention, `veh.duplicate_candidates`). The fix stops the application from issuing the illegal
  UPDATE; the database guard still stands.
- **Five same-key idempotency replays** now assert a replayed stored success with the same id and
  exactly one row / history entry / merge: `crm.duplicate-scan`, `crm.duplicate-review`,
  `crm.customer-status-set`, `crm.restriction-impose`, `crm.customer-merge`. The merge replay proves it
  returns the stored `mergeId` rather than re-running the destructive operation.

### 3.5 Fresh PostgreSQL 17 clean room (from empty, exact SHA)

Empty database → all migrations applied → seeds → validators → full suites, on Supabase-local
PostgreSQL 17.

| Check                                                                        | Result                                                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Migrations applied from empty                                                | **119** (max version `20260730090000`); **no migration 120**                                      |
| Seed idempotency (`validate:seed-state` twice + manual re-apply of 7 files)  | idempotent; every business table empty                                                            |
| `validate:no-fake-data` (1008 tracked files) · `validate:crm-classification` | green · 298 CRM columns classified (7 restricted), registry reconciles                            |
| Catalog (`schema-inventory`)                                                 | 17 schemas · **242 tables** · 212 functions · 631 policies · 541 triggers · 999 indexes · 0 views |
| `security_definer` in module schemas · `rls_tables_not_forced`               | **0** · **0**                                                                                     |
| `app_runtime` / `app_readonly` / `app_worker`                                | none is superuser, BYPASSRLS, or LOGIN                                                            |
| CRM `DELETE` grants to any application role                                  | **0**                                                                                             |
| `app_readonly` non-SELECT CRM grants · `app_worker` CRM write grants         | **0** · **none**                                                                                  |
| `iam.permissions`                                                            | **55**                                                                                            |
| `crm.business_partners` / `crm.duplicate_candidates` / `shared.notes` rows   | 0 / 0 / 0                                                                                         |
| Deterministic schema hash                                                    | `a677eb05fac193536cb53735f189e03a65d182d2d9bab56351ff9953d8ab6c2c`                                |

## 4. Findings disposition

Independent read-only review across four dimensions (correctness, security, QA, architecture); each
raised finding adversarially verified by a separate skeptic instructed to refute it.

| Severity | Count | Disposition                                                                                                |
| -------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| Critical | 0     | —                                                                                                          |
| High     | 0     | The one High of this phase (duplicate re-score crash) was fixed in PR #68 and re-proven here.              |
| Medium   | 0     | —                                                                                                          |
| Low      | 1     | **Accepted with rationale** (P1-16-R-01, below). Real, pre-existing, no data-integrity or security impact. |

**P1-16-R-01 (Low, accepted).** `scanForDuplicates` returns every above-threshold pair in the scan
response's `candidates` array, and `ScanResult.candidates` carries no `status` field. Because the
candidate id is exposed only through the scan response (there is no candidate GET/list endpoint), a
pair whose stored candidate is already `dismissed` reappears on every subsequent scan, indistinguishable
from a fresh open candidate. The persistent row is correct: it stays `dismissed`, no second open row is
inserted, the immutable columns are untouched, and a re-dismiss attempt returns a clean `422`
(`ERR-RES-002`). Verified as **real but not a defect**: zero data-integrity/security/crash impact;
merge takes `sourceId`/`survivorId` directly (never a candidate id), so candidate status gates nothing;
this behavior is **pre-existing from the feature (PR #67) and was not introduced or worsened by the
remediation** (both pre- and post-fix `upsertCandidate` return the existing candidate, and the service's
push logic was untouched). It is an arguably-intended "current above-threshold snapshot" response shape.
Accepted as a low-severity residual; a future iteration may add a `status` field to the scan response or
exclude non-open pairs. It does not block this gate and is recorded here rather than hidden.

## 5. Explicit exclusions (stated so nothing is inferred)

- **Phase 1-17 has not been started.** No P1-17 branch, file, or reference exists.
- **`origin/main` was not modified** and remains `8ca1da2`. No promotion of `develop` to `main` occurred.
- No production deployment occurred. No production monitoring, SLOs, failover, CDN, or replication is provisioned.
- No legacy Benzene data migration occurred; Benzene remains a configurable pilot tenant, never a hard-coded identifier.
- No Zoom work occurred.
- The product name remains **[PRODUCT NAME — Pending Final Approval]**.
- Duplicate scoring is deterministic and explainable only — no machine learning, biometric, or external identity matching.
- No dependency-vulnerability scanning, malware scanning, production message/storage provider, or independent third-party audit exists or is claimed.

## 6. Gate conditions — verified against evidence on the merged SHA

| #   | Condition                                                                                              | Status                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 1   | All mandatory CI checks green on the merged SHA                                                        | **Met** — CI #171 on `4576db2`, 4/4 required jobs Success                                     |
| 2   | No unresolved Critical security finding                                                                | **Met** — 0 Critical                                                                          |
| 3   | No unresolved High finding without an approved, time-bounded exception                                 | **Met** — 0 High open; the phase's one High fixed in PR #68                                   |
| 4   | Every Medium security finding fixed or formally accepted with bounded rationale                        | **Met** — 0 Medium                                                                            |
| 5   | Documented technical self-review completed by Eng. Ezzaldeen Al-Bitar                                  | **Met** — §3–§4 and the independent four-dimension review                                     |
| 6   | Every registered public P1-16 operation has genuine operation-depth evidence                           | **Met** — 18/18 at operation depth                                                            |
| 7   | P1-16 pending / invocation-only / unit-only / unreferenced / metadata-only counts = 0                  | **Met** — all five are 0                                                                      |
| 8   | Customer search bounded and privacy-safe; sensitive identifiers gated                                  | **Met** — `p1-16-customer-search` operation-depth evidence                                    |
| 9   | Individual and company creation transactional with in-transaction number allocation                    | **Met** — `p1-16-customer-creation` evidence                                                  |
| 10  | Consent history preserved append-only; withdrawal never erases prior evidence                          | **Met** — `p1-16-customer-profile` evidence                                                   |
| 11  | Customer statuses use CRM-owned guarded history                                                        | **Met** — `p1-16-customer-governance` evidence                                                |
| 12  | Restrictions enforced by affected CRM operations and auditable                                         | **Met** — governance evidence + same-key replay                                               |
| 13  | Duplicate scoring deterministic, explainable, and versioned                                            | **Met** — `p1-16-customer-identity` evidence                                                  |
| 14  | Customer merge preserves provenance and rolls back atomically; no physical delete                      | **Met** — merge success + replay evidence; 0 CRM DELETE grants                                |
| 15  | History and timeline are read-only projections, not a second source of truth                           | **Met** — identity/timeline evidence                                                          |
| 16  | The CRM database is consumed unchanged (no P1-16 feature migration), or any gap merged as a DBCR first | **Met** — feature/remediation add no migration; the one gap landed as DBCR-P1-16-001 / PR #66 |
| 17  | Genuine isolated clean-room validation complete on the exact final SHA                                 | **Met** — §3.5, fresh PostgreSQL 17 from empty                                                |
| 18  | Pull request merged into `develop` by Eng. Ezzaldeen Al-Bitar                                          | **Met** — PR #67 (feature) and PR #68 (remediation) merged                                    |

## 7. Decision record

- **Decision:** **Go — P1-16 CRM Backend Gate Passed**
- **Technical authority:** Eng. Ezzaldeen Al-Bitar (Standing Technical Authorization; owner-authorized technical self-review — never an independent third-party audit)
- **Decision evidence:** protected `origin/develop` = `4576db2`; `origin/main` = `8ca1da2` (untouched); CI #171 green (4/4) on `4576db2`; Unit 733 / Database 1547 / Backend 455; P1-16 coverage 18/18 with all weak categories 0; fresh PostgreSQL 17 clean room green (119 migrations, no 120, seeds idempotent, 242 tables / 212 functions / 631 policies / 541 triggers, 0 SECURITY DEFINER, 55 permissions, empty business tables); 0 Critical/High/Medium findings, 1 Low accepted (P1-16-R-01).
- **Date:** 2026-07-24 (Asia/Amman)

Dependent work (Phase 1-17) may begin only after this gate-record pull request is merged into
protected `develop` and that protected merge is separately verified.

## 8. Preserved Pending record (byte-verbatim)

The complete text of this gate as it shipped in **Pending**, preserved unaltered. The decision above
was made against this record; it is not rewritten here.

```markdown
# Phase 1-16 Gate — CRM Backend

**Phase:** 1-16 — CRM Backend · **Gate package:** in feature execution ·
**Review model:** the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)
under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md).
**This is not an independent third-party review and is never represented as one.**

---

## Decision: **Pending**

This record is opened in **Pending** at the start of the phase and **stays Pending** throughout
feature work. It is never filled from intention — only from the verified merge and check results on
the exact merged SHA, recorded in a **separate gate-record pull request** after protected post-merge
verification. Feature work does not convert this gate.

## Protected starting state

| Anchor           | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| `origin/develop` | `6bc402f766a9202504ba54904e5a8b2a4ba7d825` (P1-15 gate merge, PR #64) |
| `origin/main`    | `8ca1da257fc89585f2bb45459e435ec124b8a5a7` (untouched)                |
| P1-15 gate       | **Go — P1-15 Shared Services Backend Gate Passed**                    |
| Migrations       | 118 (consumed unchanged; P1-16 adds none)                             |
| Feature branch   | `feature/p1-16-crm-backend` (from `origin/develop`)                   |

## What this phase submits

The `feature/p1-16-crm-backend` branch: a `src/modules/crm` application module composing the frozen
CRM database (migrations 1–118, delivered by P1-6) and the shared backend foundation (P1-13/14/15)
into governed customer-domain operations, with executable tests, catalog registrations, OpenAPI,
strict operation-depth coverage evidence, security review, observability, documentation, and clean-room
validation. **No migration is added by this phase.**

## What is weighed (stated plainly)

- The CRM database is consumed exactly as it stands on protected `develop`; any gap that blocks a
  mandatory operation under the real runtime role is raised as a DBCR and delivered in its own
  remediation PR, not inside this feature.
- Duplicate scoring is deterministic and explainable only. No machine learning, biometric, or external
  identity-matching control exists or is claimed.
- No dependency-vulnerability scanning, malware scanning, production monitoring, production message or
  storage provider, or independent review exists or is claimed.
- Business tables remain empty after a clean migration; all test data is ephemeral.

## Gate conditions (Standing Technical Authorization §2, plus phase-specific obligations)

| #   | Condition                                                                                      | Status  |
| --- | ---------------------------------------------------------------------------------------------- | ------- |
| 1   | All mandatory CI checks green on the feature pull request (exact final SHA)                    | Pending |
| 2   | No unresolved Critical security finding                                                        | Pending |
| 3   | No unresolved High finding without an approved, time-bounded exception                         | Pending |
| 4   | Every Medium security finding fixed or formally accepted with bounded rationale                | Pending |
| 5   | Documented technical self-review completed by Eng. Ezzaldeen Al-Bitar                          | Pending |
| 6   | Every registered public P1-16 operation has genuine operation-depth evidence                   | Pending |
| 7   | P1-16 pending / invocation-only / unit-only / unreferenced / metadata-only counts = 0          | Pending |
| 8   | Customer search bounded and privacy-safe; sensitive identifiers gated                          | Pending |
| 9   | Individual and company creation transactional with in-transaction number allocation            | Pending |
| 10  | Consent history preserved append-only; withdrawal never erases prior evidence                  | Pending |
| 11  | Customer statuses use CRM-owned guarded history                                                | Pending |
| 12  | Restrictions enforced by affected CRM operations and auditable                                 | Pending |
| 13  | Duplicate scoring deterministic, explainable, and versioned                                    | Pending |
| 14  | Customer merge preserves provenance and rolls back atomically; no physical delete              | Pending |
| 15  | History and timeline are read-only projections, not a second source of truth                   | Pending |
| 16  | The CRM database is consumed unchanged (no P1-16 migration), or any gap merged as a DBCR first | Pending |
| 17  | Genuine isolated clean-room validation complete on the exact final SHA                         | Pending |
| 18  | Pull request merged into `develop` by Eng. Ezzaldeen Al-Bitar                                  | Pending |

## Decision record (completed automatically upon verification of all conditions)

- **Decision:** Pending
- **Technical authority:** Eng. Ezzaldeen Al-Bitar
- **Decision evidence:** _(recorded from the verified merge and CI results on the exact merged SHA in a
  separate gate-record pull request)_
- **Date:** _(pending)_

_Until every condition above is verified against evidence on the merged SHA, this section reads
**Pending**._

## Governance statement

Eng. Ezzaldeen Al-Bitar is the sole technical decision maker, implementer, reviewer, QA reviewer,
security reviewer, and repository administrator. Nothing reaches protected `develop` outside the
approved pull-request and hosted-CI flow. The work is reviewed under the Standing Technical
Authorization and Solo Developer Review policies. **This is not an independent third-party review and
is never represented as one.**
```

## Governance statement

Eng. Ezzaldeen Al-Bitar is the sole technical decision maker, implementer, reviewer, QA reviewer,
security reviewer, and repository administrator. Nothing reaches protected `develop` outside the
approved pull-request and hosted-CI flow. The work is reviewed under the Standing Technical
Authorization and Solo Developer Review policies. **This is not an independent third-party review and
is never represented as one.**
