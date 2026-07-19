# Phase 1-6 — CRM Audit, History & Timeline Matrix

**Company:** RootLco — Root Link Company
**Product:** [PRODUCT NAME — Pending Final Approval]
**Phase:** 1-6 — CRM and Business Partner Database
**Branch:** `feature/p1-06-crm-business-partner-database` (base `develop` @ `cd475d3`)
**Owner gate status:** Pending — the feature PR is not yet open or merged.
**Review model:** owner-authorized technical/security self-review under the [Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md). Not an independent review.

This document explains how Phase 1-6 records attributable history and builds the customer-facing timeline, and states plainly what is deferred. It is a companion to the generated matrices — [object inventory](./crm-object-inventory.md), [RLS policy matrix](./crm-rls-policy-matrix.md), [grant matrix](./crm-grant-matrix.md), [classification matrix](./crm-classification-matrix.md), and [data dictionary](./crm-data-dictionary.md) — and cross-references them rather than restating their tables. Structural context is in the [Phase 1-6 CRM ERD](../../database/erd/phase-1-6-crm.mmd).

Sources: the append-only and hardening migrations `20260719094000_crm_partner_status_history.sql`, `20260719098000_crm_preferences_consent.sql`, `20260719100000_crm_block_history.sql`, `20260719102000_crm_communication_timeline.sql`, and `20260719104000_crm_security_hardening.sql`, all under `../../../supabase/migrations/`.

---

## 1. The append-only pattern

Four CRM tables are **append-only** — rows may be created and read, never edited or removed:

- `crm.partner_status_history` — lifecycle and commercial status transitions (DB-006).
- `crm.customer_block_history` — block/unblock decisions (DB-015).
- `crm.consent_history` — privacy and marketing consent by channel and purpose (DB-012).
- `crm.timeline_events` — the chronological customer-facing read source (DB-019).

### How append-only is enforced

The invariant is enforced by **grant shape**, not by a mutable "soft-delete" flag. On each of these tables the app roles receive only:

- `GRANT SELECT, INSERT` to `app_runtime`, and
- `GRANT SELECT` to `app_readonly`.

No `UPDATE` or `DELETE` privilege is granted, and no `upd_*`/`del_*` RLS policy exists. Because every CRM table also runs `ENABLE` + `FORCE ROW LEVEL SECURITY` and the app roles are all `NOBYPASSRLS`, an attempted `UPDATE` or `DELETE` against any of these tables fails at the privilege layer with **SQLSTATE `42501`** (`insufficient_privilege`). There is no code path — trigger, function, or policy — that re-opens mutation.

The tables that back the timeline emit path (`customer_alerts`, `partner_merges`) and the paired `communication_log` are covered separately in the grant matrix; only `timeline_events` itself is append-only among the communication tables.

### Server-stamping — attribution cannot be forged

An append-only row is only trustworthy if the caller cannot forge who acted or when. Every write is server-stamped by a `BEFORE INSERT` trigger, so caller-supplied actor and time values are overwritten:

- **Status history** reuses the shared primitive `shared.stamp_status_history()` (trigger `tg_partner_status_history_stamp`). It sets `actor_id := iam.current_user_id()` — raising if the session has no actor — and `occurred_at := now()`. The same primitive stamps `customer_block_history` (trigger `tg_customer_block_history_stamp`). A `CHECK (from_state IS DISTINCT FROM to_state)` on status history also rejects no-op transitions that would otherwise write false history, and `reason` is mandatory and non-blank.
- **Consent history** uses `crm.guard_consent_insert()` (trigger `tg_consent_history_stamp`). It sets `recorded_by := iam.current_user_id()` (raising if NULL), sets `created_at := now()`, defaults a NULL `effective_at` to `now()`, and **rejects a future `effective_at`** so a post-dated grant cannot pre-empt a current withdrawal.
- **Timeline events** are never written by application code directly in normal operation. The only sanctioned writer is `crm.emit_timeline_event()`, fired as an `AFTER INSERT` trigger on the six source tables (`partner_status_history`, `consent_history`, `customer_block_history`, `customer_alerts`, `partner_merges`, `communication_log`). It runs in the same transaction as the source change, so a rolled-back source row removes its timeline row, and it constructs the `title` from status/type/channel tokens only — carrying **no restricted PII**.
- **Merge records** in `crm.partner_merges` are server-stamped by `stamp_partner_merge` (per the [object inventory](./crm-object-inventory.md)), and the merge itself is gated by `crm.guard_business_partner_merge()`, which rejects creating a partner already `merged` and rejects mutating a merged (read-only) partner.

Honest limitation, recorded in the timeline migration header: because Phase 1-6 ships **zero `SECURITY DEFINER` functions**, `app_runtime` must hold `INSERT` on `timeline_events` for the `INVOKER` emit triggers to write. Writes therefore cannot be _technically_ restricted to trigger-only. The emit triggers are the intended and only path, and the `title` construction plus the append-only grant shape constrain what such a write could contain. Trigger-only enforcement is a Phase 1-16 write-path concern.

---

## 2. Append-only / history matrix

| Table                        | Append-only?                                      | Writer / stamp mechanism                                                                                       | Monotonic `seq`?                                                             | What it records                                                                                                                                                        |
| ---------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crm.partner_status_history` | Yes (SELECT+INSERT only; UPDATE/DELETE → `42501`) | `BEFORE INSERT` `shared.stamp_status_history()` stamps `actor_id`, `occurred_at`                               | No (ordered by `occurred_at DESC, id DESC`)                                  | Lifecycle (`prospect/active/inactive/blocked/merged`) and commercial (`normal/watch/hold`) status transitions, with mandatory reason                                   |
| `crm.customer_block_history` | Yes (SELECT+INSERT only; UPDATE/DELETE → `42501`) | `BEFORE INSERT` `shared.stamp_status_history()` stamps `actor_id`, `occurred_at`                               | **Yes** — `seq bigint GENERATED ALWAYS AS IDENTITY` (added in SEC hardening) | `blocked`/`unblocked` decisions with mandatory reason, optional same-partner restriction and approval reference                                                        |
| `crm.consent_history`        | Yes (SELECT+INSERT only; UPDATE/DELETE → `42501`) | `BEFORE INSERT` `crm.guard_consent_insert()` stamps `recorded_by`, `created_at`; rejects future `effective_at` | **Yes** — `seq bigint GENERATED ALWAYS AS IDENTITY` (added in SEC hardening) | Privacy/marketing consent (`granted/withdrawn/expired`) by channel and purpose; resolved by `crm.current_consent()`                                                    |
| `crm.timeline_events`        | Yes (SELECT+INSERT only; UPDATE/DELETE → `42501`) | `AFTER INSERT` `crm.emit_timeline_event()` on 6 source tables — the only sanctioned writer                     | No (ordered by `occurred_at DESC`)                                           | PII-safe chronological events (`lifecycle_changed`, `commercial_changed`, `consent_changed`, `blocked`, `unblocked`, `alert_raised`, `merged`, `communication_logged`) |

See the [grant matrix](./crm-grant-matrix.md) for the full per-role privilege listing and the [RLS policy matrix](./crm-rls-policy-matrix.md) for the tenant-scoped `sel_*`/`ins_*` policies on these tables.

---

## 3. Deterministic ordering

History resolution repeatedly needs to answer "what is the latest row?" — the block-coherence guard asks for the latest block action, and `crm.current_consent()` asks for the effective consent status. This must be **deterministic**, including for rows written in the same transaction.

The subtlety: `occurred_at` and `created_at` default to `now()`, which in PostgreSQL is the **transaction start time** — it is _constant for every row inserted within one transaction_. So when two related events are written in the same transaction (for example a `blocked` immediately followed by an `unblocked`, or two consents with the same `effective_at`), a timestamp ordering alone cannot separate them, and the earlier tie-break on the random `gen_random_uuid()` primary key gave a _non-deterministic_ order (Finding 5 in the [evidence ledger](#4-relationship-to-the-forensic-audit-trail)).

The SEC hardening migration (`45fda2d`) fixes this by adding a monotonic `seq bigint GENERATED ALWAYS AS IDENTITY` column to the two order-sensitive history tables — `crm.customer_block_history` and `crm.consent_history` — and switching resolution to order by `seq`:

- **Block-coherence guard** (`crm.guard_partner_block_coherence()`): the latest block action is now selected with `ORDER BY seq DESC LIMIT 1` (previously `occurred_at DESC, id DESC`). Because `seq` is assigned in strict insertion order, the guard sees the true last decision even when block and unblock land in one transaction.
- **Current consent** (`crm.current_consent()`): resolution is now `ORDER BY effective_at DESC, seq DESC` (previously `effective_at DESC, created_at DESC, id DESC`). Among rows sharing the greatest `effective_at` at or before `now()`, the highest `seq` — i.e. the last inserted — wins. Consent status resolution is therefore **total-ordered** and reproducible.

`seq` gives a total order _within_ a transaction that `now()` cannot, and a stable, insertion-faithful order _across_ transactions. It is an internal ordering key, not a public sequence guarantee.

---

## 4. Relationship to the forensic audit trail

Phase 1-6 draws a deliberate line between two different kinds of record:

- **The DB-layer attributable record** — the append-only history and timeline tables described above. These are server-stamped, tenant-scoped, and immutable by grant shape. They are the authoritative, in-database answer to "what changed, when, and by whom" for CRM partner state within the reach of the app roles.
- **The forensic audit trail** — `iam.audit_append`. This is **explicitly deferred to Phase 1-16** and is _not_ wired into the CRM write paths in this phase. Critically, the app roles (`app_runtime`, `app_readonly`, `app_worker`) hold **no grant** on `iam.audit_append`. The status-history migration header states this plainly: the runtime role "deliberately holds no audit grant," and forensic `iam.audit_append` integration is Phase-1-16 backend work.

This is an honest scoping decision, not an oversight. The consequence: for Phase 1-6, the attributable change record _is_ the history/timeline tables — nothing more is claimed. A tamper-evident, cross-module forensic trail (append-only at the `iam` layer, independent of the CRM tables and their app-role grants) is out of scope here and lands with the Phase 1-16 backend write paths, alongside the related deferrals noted elsewhere in this package (trigger-only timeline writes; identifier-type correctness on profile `_ref` FKs).

### Security findings touching this area (from the evidence ledger)

The append-only and ordering design was hardened forward after the Wave 5 adversarial review; the relevant fixes are captured in `20260719104000_crm_security_hardening.sql` (`45fda2d`) and regression-tested in `crm-security-hardening.test.ts`:

1. **Block-coherence INSERT bypass** — a partner could be inserted already `blocked` with no history row. **Fixed**: the guard now runs `BEFORE INSERT OR UPDATE` and forbids an initial `blocked` state.
2. **Merge INSERT bypass** — a partner could be inserted already `merged`. **Fixed**: creating a partner with `merged_into_id` set is rejected.
3. **Same-transaction ordering nondeterminism** — `occurred_at`/`created_at = now()` is constant per transaction and the uuid tie-break was random. **Fixed** via the monotonic `seq` on block and consent history (Section 3).

(Findings 3 and 4 concern the defensive jsonb raw-value scan and the accepted profile `_ref` residual, and are recorded in the security evidence register rather than here.)

---

_Confidential — Commercial Product and Pilot Planning. Authored under owner-authorized self-review; the Phase 1-6 owner gate is Pending._
