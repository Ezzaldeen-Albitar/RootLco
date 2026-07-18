# Phase 1-5 — Notification Data Contract

**Company:** RootLco · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential · **Phase:** 1-5 · **Date:** 2026-07-18 ·
**Author:** Eng. Ezzaldeen Al-Bitar

## 1. Scope

The database contract for governed message templates and outbound-message
evidence — `shared.message_templates`, `shared.template_versions`,
`shared.outbound_messages`, `shared.delivery_attempts` — created by migrations
`20260718104000_shared_message_templates.sql` and
`20260718105000_shared_outbound_messages.sql`. This phase stores template
identity, governed content, integrity digests, and lifecycle state.
**No rendering engine, no delivery provider, no dispatch worker, and no
notification backend exist**; Phase 1-6 is not started, and nothing below
claims otherwise.

## 2. Entity map

```
shared.message_templates (platform | tenant scope)
  ├─ shared.template_versions (draft → approved → retired, content_hash SHA-256)
  └─ active_version_id — composite FK (id, active_version_id)
                         ⇒ template_versions (template_id, id)
shared.outbound_messages (hash-only envelope, digest-or-user recipient)
  └─ shared.delivery_attempts (append-only, started → terminal)
```

## 3. Template identity and version lifecycle

- **Dual scope.** A `platform` template (`tenant_id` NULL) is a shared default;
  a `tenant` template is that tenant's override. Identity
  `(template_code, channel, locale_code)` is unique per scope via two partial
  unique indexes; `channel ∈ email|in_app`,
  `purpose ∈ transactional|marketing|system`, and `locale_code` must exist in
  `shared.languages`.
- **One-way version lifecycle.** A version is INSERTed only as an unstamped
  `draft`. `draft→approved` requires `approved_by` (tenant-bound composite user
  FK) and server-stamps `approved_at`; `approved→retired` server-stamps
  `retired_at` and is rejected while any template references the version as
  active. Every other transition raises `check_violation`.
- **Immutable governed content.** Once a version leaves `draft`, its
  `tenant_id`, `template_id`, `version_number`, `subject`, `body`, and
  `content_hash` are frozen by the lifecycle guard. `content_hash` is exactly
  32 bytes (SHA-256 of the governed content).
- **Scope mirroring.** A version's nullable `tenant_id` must be
  `IS NOT DISTINCT FROM` its template's `tenant_id`, including NULL for
  platform templates (`guard_template_version_scope`).
- **Concurrency.** Activation locks the version row `FOR UPDATE` first;
  retirement takes the same row lock and is rejected while active, so
  activation and retirement serialize on one lock order. A concurrent
  double-approval of the same draft has exactly one winner
  (exercised in `tests/db/shared-message-templates.test.ts`).

## 4. Active-version structural FK

- A template is INSERTed with `active_version_id` NULL — there is no
  create-with-active shortcut.
- The composite FK `(id, active_version_id)` referencing
  `shared.template_versions (template_id, id)` makes cross-template activation
  a foreign-key violation: a template structurally cannot activate another
  template's version. This is schema shape, not procedure.
- The activation guard additionally locks the selected version and accepts
  `approved` versions only; activating a `draft` or `retired` version raises.

## 5. Outbound envelope — hash-only content, digest-or-user recipient

- **Hash-only content.** `shared.outbound_messages` never stores rendered
  content. `body_sha256` is an exactly-32-byte SHA-256 integrity digest;
  rendering and transient content belong to a later backend dispatch phase.
- **Digest-or-user recipient.** No plaintext destination column exists. A
  message identifies its recipient by `recipient_digest` (exactly 32-byte
  SHA-256 of an external destination), by `recipient_user_id` (tenant-bound
  composite FK to `iam.user_accounts`), or both — and at least one is
  mandatory (`ck_outbound_messages_recipient_present`). Cross-tenant recipient
  attribution is an FK violation.
- **Organizational scope.** `company_id`/`branch_id` use the composite
  `(tenant_id, company_id)` and `(tenant_id, company_id, branch_id)` FKs; a
  branch without its company is a CHECK violation.
- **Template reference.** An optional `template_version_id` is locked
  `FOR SHARE` at INSERT and must be `approved` and either platform-scoped or
  owned by the message's tenant.
- **Immutable envelope.** Tenant, scope, template, channel, purpose, recipient
  identifiers, `body_sha256`, `dedupe_key`, and `consent_ref` are frozen after
  INSERT; only the guarded lifecycle fields change.

## 6. Delivery lifecycle and attempt evidence

- **Guarded message lifecycle.** Rows start as unstamped `pending` with
  `retry_count` 0. The only permitted transitions are
  `pending→queued|cancelled`, `queued→sending|cancelled`, `sending→sent|failed`,
  `sent→delivered|failed`, and `failed→queued|cancelled`. Transition timestamps
  are server-stamped; a forged or historical stamp on UPDATE raises. A
  transition to `failed` requires `failure_class`; the `failed→queued` retry
  server-increments `retry_count` and clears failure state.
- **Attempts are started-terminal evidence.** `shared.delivery_attempts` is
  append-only evidence: no UPDATE or DELETE grant or policy exists for any
  application role, and runtime/readonly hold SELECT only — recording an
  attempt is a backend/platform operation.
  `attempt_number ≥ 1` and is unique per `(tenant_id, message_id)`. Status is
  `started|accepted|delivered|errored` with completion pairing: `started` ⇔
  `completed_at` NULL, every terminal status ⇔ `completed_at` NOT NULL. An
  `errored` attempt requires a non-blank sanitized `error_summary`, and
  `error_summary` is permitted only on `errored` attempts. `details` must be a
  JSON object — see
  [event-payload-security-rules.md](event-payload-security-rules.md) for the
  honest limits of that surface.

## 7. Dedupe contract

`dedupe_key` is a caller-supplied, non-blank, immutable idempotency identity.
`UNIQUE (tenant_id, dedupe_key)` referees concurrent duplicate creation at the
database: two producers submitting the same tenant-scoped key get exactly one
row and one `23505`. Synthetic example key: `fx_welcome_fx_user_0001` — the
key's format and semantics belong to the caller; the database enforces only
tenant-scoped uniqueness.

## 8. Purpose and consent — support, not enforcement

Both templates and messages carry
`purpose ∈ transactional|marketing|system`, and a message may carry an opaque
non-blank `consent_ref`. That is the entire consent surface of this phase: the
schema **records** purpose and **can carry** a consent reference so a later
phase can enforce consent, but **no consent registry, validation, or gate
exists, and no consent enforcement is claimed**.

## 9. Tenancy, RLS, and grants

All four tables are ENABLE + FORCE RLS. `app_runtime`/`app_readonly` hold
SELECT only: platform-plus-own-tenant for templates, NULL-tenant-plus-own for
versions, own-tenant for messages and attempts. Neither role has any write
grant or write policy on any of the four tables — creating, approving,
activating, retiring, sending, and recording attempts are platform/backend
operations of a later phase.

## 10. Explicit non-goals (deferred, not hidden)

Template rendering, variable substitution, provider integrations, dispatch
workers, delivery webhooks, notification preferences, and consent enforcement
are not implemented and not claimed. The database stores and access-controls
the shapes above; nothing sends a message today.

## 11. Evidence

`tests/db/shared-message-templates.test.ts` (21 tests) exercises dual-scope
identity, the structural active-version FK, draft-only INSERT, the one-way
lifecycle with server stamps, content immutability, single-winner concurrent
approval, and tenant visibility. `tests/db/shared-outbound-messages.test.ts`
(17 tests) exercises the recipient digest-or-user rule, cross-tenant recipient
rejection, branch-requires-company, tenant-scoped dedupe, approved-template
gating, the full server-stamped lifecycle including retry accounting and
forged-stamp rejection, and append-only attempt evidence. The suite runs via
`npm run test:db`; CI runs `validate:seed-state` before it, and the CI result
on the final SHA is owner-verifiable (the closeout PR is not opened and the
owner gate is Pending).
