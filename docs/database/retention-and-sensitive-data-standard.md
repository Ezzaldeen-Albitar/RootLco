# Retention and Sensitive-Data Standard

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding standard — Phase 1-2 deliverable ·
**Date:** 2026-07-16 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
technical self-review, not an independent review) ·
**Task IDs:** P1-02-DB-016 / P1-02-SEC-004 ·
**Related:** [Database Architecture](./database-architecture.md) ·
[RLS Standard](./rls-standard.md) ·
[Role and Grant Standard](./role-and-grant-standard.md) ·
[Data Dictionary](./data-dictionary.md) ·
[Number Sequence Standard](./number-sequence-standard.md) ·
[ADR-008 — Configuration-Driven Tenant Onboarding](../adr/ADR-008-configuration-driven-tenant-onboarding.md) ·
[ADR-012 — Local-First Environment](../adr/ADR-012-local-first-environment-with-controlled-promotion.md)

---

## 1. Purpose and scope

This standard defines **how long data lives, who decides that, and how it dies** —
and, independently, **how sensitive each piece of data is and how it must be handled**.

Phase 1-2 creates no business-domain tables. This document is therefore a
**binding rulebook for the phases that will create them** (Phase 1-3 onward), plus
the honest record of what already exists: one platform table
(`shared.number_sequences`, migration `0003`), whose columns are already
classified in the [Data Dictionary](./data-dictionary.md) under the rules below.

Two orthogonal labels are assigned to **every column** at design time:

| Label                 | Question it answers                      | Values                                                                                 |
| --------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------- |
| **Retention class**   | How long must this live?                 | operational · evidence-audit · personal-data · temporary · immutable-financial-history |
| **Sensitivity class** | Who may see it, and where may it travel? | public · internal · restricted · secret                                                |

Both labels are **mandatory fields in the data dictionary**. A migration that
creates a column without a recorded classification fails review — there is no
"classify it later".

---

## 2. Retention classes

### 2.1 Class definitions

| Class                           | Definition                                                                                           | Examples (Phase 1-3+ — none of these tables exist yet)                                                                  | Default disposition                                                                                                                                                                                                                                                        |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **operational**                 | Current working data the business actively reads and edits. Value decays once superseded.            | Customer records, vehicle records, appointments, open work orders, configuration rows such as `shared.number_sequences` | Soft delete (`deleted_at`) on business request; purge only via the controlled deletion job once the configured retention has elapsed                                                                                                                                       |
| **evidence-audit**              | Records whose purpose is to prove what happened: who did what, when, from what state to what state.  | Status-history tables, security/audit event trails, migration evidence, approval records                                | Append-only (INSERT + SELECT grants only, per the base metadata standard); never updated; purged only by the controlled job after the configured audit period, never on business request                                                                                   |
| **personal-data**               | Data identifying or relating to a natural person.                                                    | Customer names, phone numbers, email addresses, national identifiers, staff user profiles                               | Retained per the configured privacy rules of the governing jurisdiction; erased or irreversibly anonymised by the controlled job; erasure requests are themselves audited events                                                                                           |
| **temporary**                   | Short-lived technical rows with an explicit expiry that carries no business meaning after it passes. | Idempotency keys (`expires_at`), expired verification tokens, ephemeral import staging rows                             | Eligible for automatic purge as soon as expiry passes; still deleted only by the controlled job, never by ad-hoc SQL                                                                                                                                                       |
| **immutable-financial-history** | Financial and other controlled documents once issued: the record of a commercial fact.               | Issued invoices, payments, credit notes, issued quotation/work-order documents and their allocated display numbers      | **Never hard-deleted within retention.** Voiding is a new state transition, not a deletion; display-number gaps caused by voiding are tolerated and never renumbered (see the [Number Sequence Standard](./number-sequence-standard.md)); longest retention of all classes |

### 2.2 Rules

1. Every table must declare exactly one **primary** retention class in the data
   dictionary; individual columns may carry a stricter class (a customer table is
   _operational_ overall while its name/phone columns are _personal-data_).
2. A row may only move to a **longer-lived** class by design change, never by
   runtime data manipulation.
3. Controlled business records (anything a customer, auditor, or dispute could
   later depend on) are **never hard-deleted** in the operational path. The base
   metadata standard applies: `deleted_at timestamptz NULL` (+ `deleted_by uuid`)
   marks soft deletion; `archived_at`/`archived_by` marks archival. Hard removal
   happens **only** through the controlled deletion job of §5.
4. _evidence-audit_ and _immutable-financial-history_ tables receive **INSERT and
   SELECT grants only** for runtime roles — no UPDATE, no DELETE. This is already
   the practised pattern: migration `0003` grants `app_runtime` no INSERT or
   DELETE on `shared.number_sequences` at all, and the test suite proves the
   append-only status-history fixture denies UPDATE/DELETE to the runtime role
   (SQLSTATE `42501`).

---

## 3. Retention periods are configuration, never code

Retention **durations are jurisdiction-dependent commercial and legal facts**,
not engineering facts. Therefore:

1. **No retention period may ever be hard-coded** — not in SQL, not in
   application code, not in a CHECK constraint, not in a seed file. This
   explicitly includes Jordanian rules: the platform bakes in **no**
   jurisdiction's assumptions, Jordan included.
2. Retention periods are **configured per tenant, and where required per
   company**, through configuration tables that arrive in later phases alongside
   the `org.*` structure (Phase 1-3+). Tenant onboarding enters these values as
   configuration (ADR-008); the first pilot tenant, Benzene Vehicle Services, is
   configured like any other tenant — nothing about it is hard-coded and it owns
   nothing in the platform.
3. Until those configuration tables exist, **no automated disposition runs at
   all**. That is acceptable in Phase 1-2 because no business data exists yet;
   it is recorded here as the honest current state, not as an oversight.

**Illustration only — a Phase 1-3+ shape, not an existing object:**

```sql
-- ILLUSTRATIVE (Phase 1-3+). Shows the intended shape of configured retention.
-- org.retention_policies does NOT exist in Phase 1-2.
CREATE TABLE org.retention_policies (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,             -- FK to org.tenants (exists by then)
  company_id       uuid        NULL,                 -- optional narrowing
  retention_class  text        NOT NULL,             -- one of the five classes, CHECK-constrained
  jurisdiction_code text       NOT NULL,             -- configured, e.g. ISO 3166-1 alpha-2
  retention_period interval    NOT NULL,             -- the configured duration — never a literal in code
  legal_basis      text        NOT NULL,             -- documented reason for the period
  -- base metadata columns (created_at/by, updated_at/by, record_version) per standard
  CONSTRAINT pk_retention_policies PRIMARY KEY (id),
  CONSTRAINT uq_retention_policies_scope
    UNIQUE NULLS NOT DISTINCT (tenant_id, company_id, retention_class, jurisdiction_code)
);
```

---

## 4. Legal hold

A **legal hold blocks deletion absolutely**, regardless of retention
eligibility. The pattern is binding on the phase that implements disposition:

1. A hold is a **record**, not a flag on the data itself: it names its scope
   (whole tenant, a retention class, a specific table, or specific records), the
   reason, who placed it (`placed_by`), when (`placed_at timestamptz`), and —
   only when lifted — `released_at`/`released_by`.
2. Hold records are themselves **evidence-audit** class: append-only; a release
   is recorded on the hold row by an authorised administrative action, and the
   hold's own history is never erased.
3. The deletion job (§5) must check for active holds (`released_at IS NULL`
   covering the candidate's scope) **as a mandatory eligibility gate**. A record
   under any matching hold is skipped and the skip is logged with the hold's id.
4. Placing and releasing holds is an administrative action outside the runtime
   role's grants — the same posture migration `0003` practises for sequence
   provisioning (no runtime INSERT/DELETE path).

---

## 5. Deletion: eligibility and the controlled job

### 5.1 Eligibility — all three gates must pass

A record may be physically deleted only when **all** of the following hold:

| Gate                      | Check                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Retention elapsed**     | The configured retention period (§3) for the record's retention class, tenant/company scope, and governing jurisdiction has fully elapsed, measured from the class-appropriate anchor (e.g. `deleted_at` for soft-deleted operational rows, document finalisation for financial history, `expires_at` for temporary rows)                                                                      |
| **No legal hold**         | No active hold record (§4) covers the record's scope                                                                                                                                                                                                                                                                                                                                           |
| **Referential integrity** | No live row still references the candidate. The FK standard makes this structurally safe: child FKs use `ON DELETE RESTRICT` by default, so a dangling delete is **impossible** — the database refuses it (SQLSTATE `23503`). The test suite has verified RESTRICT blocking parent deletion. The job must treat a RESTRICT rejection as "not eligible yet", never as an error to force through |

### 5.2 The controlled deletion job

All physical deletion runs through **one controlled, scheduled, audited job**.
Its binding properties:

1. **No ad-hoc SQL deletion — ever.** No engineer, including the owner, deletes
   business rows by hand in any environment holding real data. (Per ADR-012 no
   Development/Staging/Production environment exists yet and production data is
   prohibited locally and in CI — so today this rule has no live surface; it
   binds from the first environment that holds real data.)
2. The job runs under a **dedicated role** provisioned for disposition, holding
   DELETE only on the tables it services. `app_runtime` and `app_readonly` never
   receive that grant — consistent with migration `0002`'s default-deny grant
   posture and migration `0003`, where the runtime role cannot DELETE at all.
3. The job is **scheduled**, not manually triggered in the normal case; a manual
   run is an administrative action that is itself logged.
4. Every run writes an **audit trail (evidence-audit class): what** was deleted
   (table, ids, count), **why** (which retention policy and anchor made it
   eligible), **when**, under which role, and which candidates were **skipped**
   and why (active hold, RESTRICT rejection, retention not elapsed).
5. The job deletes in bounded batches inside transactions, and re-verifies all
   three §5.1 gates inside the deleting transaction (eligibility computed
   yesterday is not eligibility now).
6. For _personal-data_ class, the configured disposition may be irreversible
   **anonymisation** instead of row deletion where the row skeleton must survive
   for referential or financial-history reasons; the anonymisation is logged
   identically.

The job itself is **not built in Phase 1-2** — it belongs to the phase that
first creates data with an elapsing retention period. This standard fixes its
contract now so no earlier phase designs a table the job cannot service.

---

## 6. Sensitivity classes and handling rules

### 6.1 Classes

| Class          | Definition                                                                                              | Examples                                                                                                                                                   | Handling rules (binding)                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **public**     | Safe if seen by anyone, including outside the tenant.                                                   | Issued display numbers (they are public-facing by design — see the [Number Sequence Standard](./number-sequence-standard.md)), published price-list labels | No masking required. Still served under RLS — "public sensitivity" never means "cross-tenant visible"                                                                                                                              |
| **internal**   | Ordinary tenant business data. The default class when nothing stricter applies.                         | Work-order descriptions, appointment times, sequence configuration such as `shared.number_sequences`                                                       | Visible only within the owning tenant under RLS; exported outside the platform only through approved export features; may appear in logs as identifiers/values where operationally needed                                          |
| **restricted** | Data whose exposure harms a person or the business: personal data, commercial terms, financial amounts. | Customer names/phones/emails, salaries, negotiated discounts, invoice amounts                                                                              | Masked by default in broad UI listings and exports where full value is not required; export requires a documented, audited approval path; **must not be written to logs** — see §6.2; access paths are per-need, not per-curiosity |
| **secret**     | Credential and key material.                                                                            | Passwords, API keys, tokens, connection strings, webhook signing secrets                                                                                   | **Never stored in business tables — see §7.** Never logged, never exported, never echoed to a client. Handled only by the platform secret mechanism                                                                                |

Two standing rules from the wider standards apply across all classes:

- **UUIDs are not authorization tokens and not public display numbers.**
  Knowledge of an `id` never grants access (RLS decides access); customers see
  display numbers, not UUIDs. A UUID in a log line is a correlation aid, nothing
  more.
- Sensitivity classing never substitutes for RLS: even _public_-class columns
  live in tenant-isolated tables. Search indexes likewise must never enable
  cross-tenant search (they operate under RLS regardless — index standard).

### 6.2 Logging restrictions

The application logger ([`src/lib/logging/logger.ts`](../../src/lib/logging/logger.ts))
already applies **key-name redaction at every nesting level**: context values
whose key contains fragments such as `key`, `secret`, `token`, `password`,
`authorization`, `cookie`, `session`, `credential`, `connectionstring`,
`database_url`, or `dsn` are replaced with `[REDACTED]` before emission
(P1-01-SEC-005).

Be honest about what that mechanism is: a **backstop against accidental secret
leakage by key name**, not a classifier. It cannot recognise a restricted
business value (a customer phone number, an invoice amount) passed under an
innocuous key. Therefore the binding rules are:

1. _secret_-class values must never reach the logger at all; redaction is the
   safety net, not the mechanism.
2. _restricted_-class values must not be passed into log context. Log the row's
   UUID and the operation, not the value.
3. _internal_-class values may be logged where operationally needed;
   _public_-class values freely.

### 6.3 Export and masking

- Export of _restricted_ data requires a purpose-documented, audited approval;
  bulk export tooling must apply the column's masking expectation by default and
  unmask only on that approved path.
- No export mechanism may bypass RLS. The measured role facts make the risk
  concrete: `service_role` carries BYPASSRLS (which is exactly why it must never
  reach a browser), and nothing executed as the local `postgres` role (BYPASSRLS)
  constitutes RLS evidence — see the [Role and Grant Standard](./role-and-grant-standard.md).

---

## 7. No plaintext secrets in business tables

**No secret — password, API key, token, signing key, connection string — is
ever stored in plaintext in any business table**, in any phase, for any reason,
including "temporarily".

- Secrets belong in the **platform secret store**. Which store that is remains an
  **open item**: no secret store has been approved yet. Until one is approved,
  the rule is simply that no table design may create a column intended to hold a
  secret value. This gap is recorded plainly rather than papered over.
- Where the database must **verify** or **fingerprint** secret-adjacent material
  (idempotency request fingerprints, token digests), it stores a **digest, never
  the material**: `pgcrypto` (installed by migration `0001` into the
  `extensions` schema) is registered precisely for `digest`/`hmac`/
  `gen_random_bytes` — and, honestly noted, **not** for UUID generation, which is
  native in PostgreSQL 13+.
- Any column whose name would trip the logger's redaction patterns (§6.2) is a
  design smell in a business table and must be justified or removed at review.

---

## 8. Classification is a design-time act, recorded in the data dictionary

1. Retention class and sensitivity class are assigned **when the column is
   designed**, by the migration author, and recorded in the
   [Data Dictionary](./data-dictionary.md) in the same change that creates the
   column. **Classification** and **Retention class** are mandatory dictionary
   fields; a dictionary entry missing either is incomplete and blocks the
   migration at review.
2. Reclassification is a reviewed design change with a dictionary update — never
   a silent edit.
3. **Current state:** the Phase 1-2 dictionary already classifies every column of
   `shared.number_sequences` — the only application table in existence. The
   table holds tenant sequence configuration and allocation state: no personal
   data, no financial amounts, no secrets. Its columns are _operational_ /
   _internal_, with the actor-attribution columns (`created_by`, `updated_by`)
   carrying user UUIDs that are identifiers, not personal data payloads (the
   user profiles they will eventually reference arrive with IAM in Phase 1-4;
   as recorded in migration `0003`, `tenant_id`/`company_id`/`branch_id` also
   have no foreign keys yet — `org.*` does not exist until Phase 1-3, when the
   FKs are added).

---

## 9. Phase 1-2 position — what exists, what is deferred

| Item                                                        | State on 2026-07-16                                                                                                                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Classification scheme (this standard)                       | Defined and binding                                                                                                                                                                 |
| Data-dictionary classification of `shared.number_sequences` | Done — see [Data Dictionary](./data-dictionary.md)                                                                                                                                  |
| Logger key-name redaction                                   | Implemented (`src/lib/logging/logger.ts`), understood as a backstop only                                                                                                            |
| Append-only / no-runtime-DELETE posture                     | Practised (migration `0003` grants; verified by the 62-test suite passing on 2026-07-16, including the append-only fixture denying runtime UPDATE/DELETE and RESTRICT FK behaviour) |
| Retention configuration tables                              | **Deferred to Phase 1-3+** — no period is configured or hard-coded anywhere today                                                                                                   |
| Legal-hold tables                                           | **Deferred** — pattern fixed here, implementation with the disposition phase                                                                                                        |
| Controlled deletion job                                     | **Deferred** — contract fixed in §5.2; no business data exists to dispose of                                                                                                        |
| Platform secret store                                       | **Open item — not yet approved.** Interim rule: no secret columns in any table                                                                                                      |

Nothing in this standard creates a business-domain table, defines anything for
Zoom Vehicle Inspection and Evaluation Services (outside Phase 1),
or hard-codes anything for Benzene Vehicle Services (configuration-only pilot
tenant, per ADR-008/ADR-009).
