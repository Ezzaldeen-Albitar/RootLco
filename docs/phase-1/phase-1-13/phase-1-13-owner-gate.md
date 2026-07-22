# Phase 1-13 Owner Gate — Backend Foundation Gate

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-13 — Backend Architecture and Shared Application Foundation ·
**Date opened:** 2026-07-21 · **Date decided:** 2026-07-21 ·
**Approval owner:** RootLco founders (Product Owner), with technical sign-off by the Architect and
Security lead (canonical plan, field 35) ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## Decision: Go — P1-13 Backend Foundation Gate Passed

Recorded on 2026-07-21 against the protected history described in §2, after both pull requests were
merged into `develop` by the repository owner and the complete implementation was revalidated from
the merged state. Section 8 preserves the original Pending record byte-verbatim; this decision does
not rewrite it, and the gate was genuinely open until the evidence below existed.

The decision is qualified in one respect, stated here rather than buried: the adversarial review in
§5 closed with **zero unresolved Critical and zero unresolved High findings**, and four Medium
findings that are **latent in P1-13 and become live in P1-14**. They are listed with their
dispositions, and two of them (ADV-01, ADV-04) should be closed before P1-14 builds business
endpoints on this foundation.

> **Navigation.** Every Phase 1-13 artefact is indexed in [`README.md`](./README.md).
> Work completed _after_ this decision — the ADV-01 and ADV-04 remediation and the documentation
> corrections — is recorded in
> [`phase-1-13-post-gate-correction-register.md`](./phase-1-13-post-gate-correction-register.md).
> That record does not amend this decision.

## 1. What this gate governs

Phase 1-14 may not begin until the API Conventions, error catalog, event catalog, OpenAPI
foundation, authorization-coverage check, and the transaction/idempotency test suites are
approved and demonstrably green in hosted CI (canonical plan, field 33 — Backend Foundation Gate).

## 2. Protected history

| Item                                            | Value                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Feature pull request                            | **#49** — `[P1-13] Build the backend architecture and shared application foundation`        |
| Final feature SHA                               | `cf8561523ca081e6c5025ba283ac1ff44fbbb5ac`                                                  |
| Feature merge commit                            | `6c3f0de132ecabc014b050a3f4d55ea0a228fb08` (parents `ecbbfe8` + `cf85615`, merge commit)    |
| Feature merge time                              | 2026-07-21 13:42:27 +0300, merged by the repository owner via the GitHub web flow           |
| Hosted CI on `cf85615`                          | 4/4 required checks green (workflow `CI` run **#119**, 5m 58s)                              |
| Remediation pull request                        | **#51** — `[P1-13] Enable tenant-safe backend runtime persistence`                          |
| Final remediation SHA                           | `af240f06dcbd31b260d476a762ae314494bfa063`                                                  |
| Remediation merge commit                        | `e615a0212fda0b028316206bf9f331dd86120890` (parents `6c3f0de` + `af240f0`, merge commit)    |
| Remediation merge time                          | 2026-07-21 15:22:46 +0300, merged by the repository owner via the GitHub web flow           |
| Hosted CI on `af240f0`                          | 4/4 required checks green (run #122, 4m 40s)                                                |
| `origin/develop` when this decision was written | `e615a0212fda0b028316206bf9f331dd86120890`                                                  |
| Protected `origin/main`                         | `728920cabfc6662074356a2480180cc8e899ead5` — not modified by this phase                     |
| Release 2 baseline tag                          | `release-2-database-baseline` → `ecbbfe8a419b8cd4794f66ba24d0a2341d015601`, still contained |

Both merge commits carry two parents and a `Merge pull request #N` subject, and each merge tree is
byte-identical to the tree of the branch it merged — so neither merge introduced a change that had
not been reviewed. At the time this decision was written, `develop`'s first-parent history since the
Release 2 tag consisted of exactly those two merge commits: nothing was pushed directly to a
protected branch.

### 2.1 Completed after this decision was written

This document is the content of commit `fecb880`, so it could not name the pull request that carried
it, the run that validated it, or the merge that landed it. Those values are recorded here rather
than left to be reconstructed:

| Item                                  | Value                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Gate pull request                     | **#52** — `docs(P1-13): record backend foundation gate as Go`                            |
| Final gate SHA                        | `fecb88081f4d9a27e104f58682eb00225e180b93`                                               |
| Hosted CI on `fecb880`                | 4/4 required checks green (workflow `CI` run **#125**, 3m 45s)                           |
| Gate merge commit                     | `6b9c90412b3b2e1690be5894c6385ab67ad45682` (parents `e615a02` + `fecb880`, merge commit) |
| Gate merge time                       | 2026-07-21 17:09:53 +0300, merged by the repository owner via the GitHub web flow        |
| `origin/develop` after the gate merge | `6b9c90412b3b2e1690be5894c6385ab67ad45682`                                               |

With that merge, `develop`'s first-parent history since the Release 2 tag is exactly **three** merge
commits — `6c3f0de`, `e615a02`, `6b9c904` — and gate condition 13 below, recorded as pending the
owner's merge, is satisfied. The decision itself is unchanged; only facts that postdate it are added.

## 3. Gate conditions

| #   | Condition                                                                                                                                                            | Status                                                                                       |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Module boundaries, layering, and controlled data access implemented and enforced in CI                                                                               | **Met, with a recorded gap** — enforced for alias imports; see ADV-01 in §5                  |
| 2   | Reference endpoint demonstrates validation, authorization, context, transaction, idempotency, logging, correlation, error model, and OpenAPI registration end to end | **Met** — `tests/backend/api-ping.test.ts`                                                   |
| 3   | Transaction wrapper proves all-or-nothing commit across state, history, audit, and outbox                                                                            | **Met** — `tests/backend/transaction.test.ts`, `tests/db/p1-13-runtime-capabilities.test.ts` |
| 4   | Outbox processor delivers at-least-once with consumer idempotency and dead-letter alerting                                                                           | **Met** — `tests/backend/outbox-worker.test.ts`                                              |
| 5   | API Conventions, error catalog, event catalog, OpenAPI foundation, and backend test foundation published                                                             | **Met** — `docs/standards/`, `docs/api/openapi.v1.json`, `docs/testing/`                     |
| 6   | Unguarded-operation and spoofed-scope checks fail closed in CI                                                                                                       | **Met** — `validate:authorization-coverage`, `tests/backend/context-spoofing.test.ts`        |
| 7   | Zero unresolved Critical findings                                                                                                                                    | **Met** — 0                                                                                  |
| 8   | Zero unresolved High findings without an approved exception                                                                                                          | **Met** — 0; both Highs found in this phase were fixed (§6)                                  |
| 9   | Local validation green with recorded exit codes                                                                                                                      | **Met** — [`evidence/gate-validation.md`](./evidence/gate-validation.md)                     |
| 10  | Clean-room validation green from a clean checkout                                                                                                                    | **Met** — fresh clone + `npm ci` + empty database, §4                                        |
| 11  | All required hosted CI checks green on the exact final feature SHA                                                                                                   | **Met** — and on the remediation SHA (§2)                                                    |
| 12  | Feature pull request merged into `develop` by the repository owner                                                                                                   | **Met** — PR #49 and PR #51, both merged by the owner                                        |
| 13  | Gate record committed into protected history                                                                                                                         | **Pending the owner's merge of this gate pull request**                                      |
| 14  | No database schema or migration change introduced by this phase                                                                                                      | **Amended, deliberately** — see §7                                                           |
| 15  | No P1-14 or later work started                                                                                                                                       | **Met** — no P1-14 branch, commit, pull request, or endpoint exists                          |

Condition 14 is the one that changed, and it changed by the governed route: the phase raised a
change request instead of quietly patching a migration, the request was classified a gate blocker
on executable evidence, and the remediation shipped as its own reviewed pull request. Section 7
records the disposition.

## 4. Validation from the merged state

Full detail, with every exit code: [`evidence/gate-validation.md`](./evidence/gate-validation.md).

| Suite / check                                                        | Result                        |
| -------------------------------------------------------------------- | ----------------------------- |
| `test:db` (migrations, RLS, isolation, concurrency, constraints)     | **120 files / 1184 tests**, 0 |
| `test:backend` (foundation integration on the deployed runtime role) | **8 files / 61 tests**, 0     |
| `test` (unit)                                                        | **22 files / 272 tests**, 0   |
| lint · typecheck · format · style                                    | 0 · 0 · 0 · 0                 |
| module boundaries · authorization coverage · OpenAPI                 | 0 · 0 · 0                     |
| tracked secrets · browser secrets · scope exclusions · no-fake-data  | 0 · 0 · 0 · 0                 |
| canonical documents                                                  | 0                             |
| Next.js production build · `docker compose config`                   | 0 · 0                         |
| Docker image build — `runner` target · `dev` target                  | 0 · 0                         |

**Clean room.** A fresh `git clone` at `e615a02` into an isolated directory, `npm ci` only, and a
brand-new empty database (`p1_13_cleanroom`) built by applying all 114 migrations with the CI
runner, then the declared seeds applied twice. Every suite and guard above re-run there: all 0.
Post-run the isolated database held **zero** rows in every business and foundation table, **zero**
leftover test roles or policies, and the tenant-neutral structural reference rows only (3
currencies, 2 languages, 2 timezones, 43 permissions, 5 retention classes). The database was then
dropped.

**Catalogue, measured on both the rebuilt local database and the clean room — identical:**
114 migrations · **242** tables · **596** policies · **210** functions · 539 triggers ·
**0** `SECURITY DEFINER` routines · **0** tables with RLS enabled but not FORCED.

## 5. Adversarial review

A fresh refute-focused review of the merged feature work _and_ the database remediation, across
cross-module bypass, handler-to-database bypass, permission and audit metadata, scope spoofing,
runtime-role escalation, audit exposure and mutation, classification handling, idempotency abuse,
producer/worker separation, outbox claiming and poison events, caching, rate limiting, problem-detail
leakage, pagination, shutdown, secrets, migration immutability, and RLS recursion. Full record:
[`phase-1-13-adversarial-review.md`](./phase-1-13-adversarial-review.md).

**Zero unresolved Critical. Zero unresolved High.**

| ID     | Severity        | Finding                                                                                                                                      | Disposition                                                                                     |
| ------ | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| ADV-01 | Medium          | The layering gate matches alias imports only; a relative `../../../server/db/...` import passes                                              | **Accepted for P1-13, close before P1-14.** Confirmed by execution                              |
| ADV-02 | — (refuted)     | Suspected O(chain-length) cost per audit append from the writer-scoped read predicate                                                        | **Refuted by measurement** — no scaling; see §5.1                                               |
| ADV-03 | Medium          | A direct INSERT into `iam.audit_records` can create a permanently unlinked, readable record, and can wedge the chain                         | **Accepted risk**, recorded; requires arbitrary SQL as `app_runtime`                            |
| ADV-04 | Medium          | An idempotency replay is not bound to the principal that created the key                                                                     | **Accepted for P1-13, close before P1-14** — latent until an idempotent business command exists |
| ADV-05 | Medium (latent) | `peerAddress` is never supplied by a production caller, so an IP-keyed policy would be one global bucket                                     | **Accepted**, latent — no operation uses IP keying today                                        |
| ADV-06 | Low             | `assertCacheable()` has no call site; `cacheCategory` is an unvalidated `string`                                                             | **Accepted**, convention not control                                                            |
| ADV-07 | Low             | `noteDenial` has no call site, so no security event is emitted at runtime yet; three source comments are stale                               | **Accepted**, recorded; the capability is proven, the wiring is P1-14                           |
| ADV-08 | Low             | Coverage gate does not scan Server Actions, `route.tsx`, or routes outside `/api/v1`, and does not require a route to call `handleOperation` | **Accepted**, close with ADV-01                                                                 |
| ADV-09 | Low             | `AUDIT_CLASSIFICATIONS` is enforced by TypeScript only, not validated at runtime                                                             | **Accepted**; no path found by which a raw value leaves the process                             |
| ADV-10 | Low             | Event-catalog `owner` is documented as enforced but is not; envelope company/branch not checked against narrowing                            | **Accepted**, latent — P1-13 publishes no domain events                                         |

Five informational observations (I1–I5) are recorded in the full review.

### 5.1 One suspected finding, measured and refuted

The review flagged that `sel_audit_records_unlinked` adds a `NOT EXISTS` subplan to the read
`iam.audit_canonical` performs on every append, and that on an empty table the planner chose a
hashed subplan — suggesting every audit append might scan the tenant's whole chain.

Measured rather than argued. On a seeded tenant with **20,000 chain links**, the planner uses a
correlated index probe on `uq_audit_integrity_links_record`, and 50 real `iam.audit_append` calls
through the deployed runtime login took **28.5 ms** — against **35.7 ms** for the same 50 appends on
an **empty** chain. Per-append cost does not grow with chain length; the hashed shape was an
artefact of an unanalysed empty table. Recorded so the concern is not re-raised without the numbers.

## 6. Findings fixed during this phase

| ID          | Severity | Finding                                                                                                     | Evidence                                                                  |
| ----------- | -------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| P1-13-F-001 | High     | `SET LOCAL statement_timeout = $1` — `SET` cannot take a bind parameter, so every transaction threw `42601` | Fixed with `set_config(..., true)`; reproduced on PG17 first              |
| P1-13-F-005 | High     | Audit details stored a field name with NULL before/after values and a silently downgraded classification    | Fixed via `toDetailEnvelope()`; regression test reads values back         |
| P1-13-F-004 | Medium   | `AuditDetail` offered `'confidential'` (rejected by the CHECK) and omitted `'secret'`                       | Fixed via `AUDIT_CLASSIFICATIONS`, reconciled against the live constraint |
| P1-13-F-002 | Low      | `viaTrustedProxy` provenance flag imprecise                                                                 | Accepted with reason                                                      |
| P1-13-F-003 | Low      | `parseIfMatch` strips quotes leniently                                                                      | Accepted with reason                                                      |

F-004 and F-005 are worth naming in a gate record for one reason: both were latent in code that had
already passed review and green CI, and both stayed invisible because the tests counted audit rows
instead of reading them. They surfaced the moment the capability became real.

## 7. DBCR-P1-13-001 — final disposition: **RESOLVED**

Resolved on executable evidence, not on the presence of a migration.

The change request recorded that `app_runtime` held SELECT only across `shared` and `iam`, so audit
append, outbox publication, idempotency storage, and security-event recording were unavailable and
the foundation failed closed. Re-measured on the merged feature baseline as the deployed non-owner
identity, with a resolved tenant context and no `BYPASSRLS`, all four returned SQLSTATE `42501`.
That made it a **gate blocker**, and it was remediated on its own branch and merged as PR #51.

Migration `20260725090000_iam_shared_runtime_write_capabilities.sql` (the 114th, and the only file
added under `supabase/` — no earlier migration was modified, verified against the Release 2 tag)
grants six table privileges, four function privileges, and eleven RLS policies, every policy
`tenant_id = iam.current_tenant_id()`.

Verified on the merged protected state: `app_runtime` holds **exactly six INSERTs** in `shared` and
`iam` and **no** UPDATE, DELETE, TRUNCATE, REFERENCES, or TRIGGER there; `app_readonly` holds no
non-SELECT privilege anywhere; `app_worker` keeps its three queue tables and no request-path
privilege; no application role holds DELETE anywhere; no application role has `BYPASSRLS`,
superuser, LOGIN, or ownership of any relation; no application role has USAGE on `extensions`; there
is no unconditional write policy for `app_runtime`; and the `SECURITY DEFINER` count across all
seventeen module schemas is **0**.

Two design decisions differ from the request as drafted, both because executing it showed the cost:
a tenant-wide writer SELECT on the audit tables would have repealed the `iam.audit.view` read gate,
so `iam.audit_append` now derives its sequence from the chain and the writer reads only a record
that has no chain link yet; and `GRANT USAGE ON SCHEMA extensions` was rejected in favour of
`pg_catalog.sha256`, which is byte-identical and needs no grant.

**Accepted residual (Low):** `sel_audit_integrity_links_chain` lets a tenant read its own chain
links — a counter, an opaque record id, and two SHA-256 digests, with no action, actor, entity, or
field value. It cannot be narrower without an infinite-recursion error in PostgreSQL.

## 8. Historical record — the gate as it stood before this decision

Preserved byte-verbatim from the Pending version of this document. Nothing below has been edited,
and it is retained precisely so the record cannot be read as though the gate were always Go.

> ## Decision: **Pending**
>
> The gate is open. No decision has been recorded, and no result below is claimed in advance of
> evidence. The decision field is filled by the approval owner, never by the implementer, and never
> before the conditions in §2 are all satisfied and evidenced.
>
> ## 1. What this gate governs
>
> Phase 1-14 may not begin until the API Conventions, error catalog, event catalog, OpenAPI
> foundation, authorization-coverage check, and the transaction/idempotency test suites are
> approved and demonstrably green in hosted CI (canonical plan, field 33 — Backend Foundation Gate).
>
> ## 2. Gate conditions
>
> | #   | Condition                                                                                                                                                            | Status at time of writing                  |
> | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
> | 1   | Module boundaries, layering, and controlled data access implemented and enforced in CI                                                                               | To be evidenced                            |
> | 2   | Reference endpoint demonstrates validation, authorization, context, transaction, idempotency, logging, correlation, error model, and OpenAPI registration end to end | To be evidenced                            |
> | 3   | Transaction wrapper proves all-or-nothing commit across state, history, audit, and outbox                                                                            | To be evidenced                            |
> | 4   | Outbox processor delivers at-least-once with consumer idempotency and dead-letter alerting                                                                           | To be evidenced                            |
> | 5   | API Conventions, error catalog, event catalog, OpenAPI foundation, and backend test foundation published                                                             | To be evidenced                            |
> | 6   | Unguarded-operation and spoofed-scope checks fail closed in CI                                                                                                       | To be evidenced                            |
> | 7   | Zero unresolved Critical findings                                                                                                                                    | To be evidenced                            |
> | 8   | Zero unresolved High findings without an approved exception                                                                                                          | To be evidenced                            |
> | 9   | Local validation green with recorded exit codes                                                                                                                      | To be evidenced                            |
> | 10  | Clean-room validation green from a clean checkout                                                                                                                    | To be evidenced                            |
> | 11  | All required hosted CI checks green on the exact final feature SHA                                                                                                   | To be evidenced                            |
> | 12  | Feature pull request merged into `develop` by the repository owner                                                                                                   | Not started — the implementer never merges |
> | 13  | Gate record committed into protected history                                                                                                                         | Not started                                |
> | 14  | No database schema or migration change introduced by this phase                                                                                                      | To be evidenced                            |
> | 15  | No P1-14 or later work started                                                                                                                                       | To be evidenced                            |
>
> ## 3. Known open items carried into the gate
>
> - **DBCR-P1-13-001** (open, not implemented) — the `app_runtime` archetype has no write
>   privilege on `shared` or `iam`, so audit append, outbox publication, idempotency storage, and
>   security-event recording are unavailable to the request path. The foundation fails closed. The
>   change request carries executed evidence and an additive proposed remediation; implementing it
>   is **not** P1-13 work. See
>   [`DBCR-P1-13-001`](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md).
> - **P1-OD-027 (NFR-SCL)** — unresolved. Every numeric limit in this phase (pool sizes, batch
>   sizes, rate limits, TTLs, backoff bounds) is a **proposed validation baseline**, not an approved
>   production target. No production capacity, throughput, latency, failover, replica, CDN, or
>   load-balancer behaviour is claimed.
> - **Authentication provider** — P1-13 defines the session-claims contract and resolves scope from
>   the database; it does not implement login. The default authenticator fails closed
>   (`ERR-IAM-002`). Authentication is Phase 1-14 and its approved provider decision.
> - **Error-monitoring platform** — a capture port with a recording transport is implemented. No
>   DSN, project, or hosted monitoring platform is provisioned (ADR-012), and none is claimed.
>
> ## 4. Evidence index
>
> Filled as evidence is produced. Nothing is listed here before it exists.
>
> | Area                                                   | Evidence                                                                                          |
> | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
> | Preconditions                                          | [`phase-1-13-precondition-report.md`](./phase-1-13-precondition-report.md)                        |
> | Phase plan (35 fields + cross-cutting synchronization) | [`phase-1-13-plan.md`](./phase-1-13-plan.md)                                                      |
> | Traceability                                           | [`phase-1-13-traceability.md`](./phase-1-13-traceability.md)                                      |
> | Security and abuse review                              | [`phase-1-13-security-note.md`](./phase-1-13-security-note.md)                                    |
> | Open decisions                                         | [`phase-1-13-open-decisions.md`](./phase-1-13-open-decisions.md)                                  |
> | Database change request                                | [`DBCR-P1-13-001`](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md) |
> | Validation evidence (local, clean-room, hosted CI)     | [`evidence/`](./evidence/)                                                                        |
>
> ## 5. Governance statement
>
> Eng. Ezzaldeen Al-Bitar is the sole technical decision maker, implementer, reviewer, QA reviewer,
> security reviewer, and repository administrator. Nothing reached protected `develop` outside the
> approved pull-request and hosted-CI flow. The work was reviewed under the Standing Technical
> Authorization and Solo Developer Review policies. No gate condition may be waived silently: every
> residual, pending decision, and stated scope boundary is recorded above with its disposition.
>
> ## Status
>
> **PENDING.** No decision recorded.

## 9. Open decisions carried forward

- **P1-OD-027 (NFR-SCL)** — still unresolved. Every numeric limit in this phase remains a proposed
  validation baseline, not an approved production target. No production capacity, throughput,
  latency, failover, replica, CDN, or load-balancer behaviour is claimed anywhere in this record.
- **Authentication provider** — P1-14 and its approved provider decision. The default authenticator
  fails closed with `ERR-IAM-002`.
- **Error-monitoring platform, metrics backend, distributed cache, distributed rate-limit store,
  replica topology, message broker** — all ports with in-memory or recording transports; no hosted
  platform is provisioned (ADR-012) and none is claimed.
- **OIR-01 product name** and **P1-OD-041 release grouping** — unchanged.

## 10. Residual risks

- The four Medium findings in §5, of which ADV-01 and ADV-04 should be closed before P1-14 builds on
  this foundation.
- The accepted Low residual on `iam.audit_integrity_links` visibility (§7).
- ADV-03: an actor with arbitrary SQL execution as `app_runtime` can damage the audit chain. The
  chain remains tamper-evident — `iam.audit_verify_chain` reports it — and further appends fail
  closed rather than extending a chain known to be broken.
- All evidence is from the Local environment. No other environment exists (ADR-012), no penetration
  test was performed, and no production behaviour is claimed.

## 11. Database baseline relationship

The Release 2 baseline tag `release-2-database-baseline` → `ecbbfe8` remains valid and contained in
`origin/develop`, and describes the frozen 113-migration baseline exactly as it did at P1-12 closure;
the P1-12 evidence pack is untouched and remains accurate as a description of that tag. This phase
adds one forward migration on top of it, taking the live schema to 114 migrations and 596 policies.
The tag is not moved and is not re-cut.

## 12. Governance statement

Eng. Ezzaldeen Al-Bitar is the sole technical decision maker, implementer, reviewer, QA reviewer,
security reviewer, and repository administrator. Nothing reached protected `develop` outside the
approved pull-request and hosted-CI flow. The work was reviewed under the Standing Technical
Authorization and Solo Developer Review policies. This is not an independent third-party review and
is never represented as one. No gate condition was waived silently: every residual, pending
decision, and stated scope boundary is recorded above with its disposition.

Phase 1-14 has not been started: no branch, commit, pull request, endpoint, or migration for it
exists. The open `develop → main` promotion pull request (#50) is the repository owner's and was
inspected read-only; this gate record neither modifies nor merges it, and does not promote `develop`
to `main`.

## Status

**GO — P1-13 Backend Foundation Gate passed**, subject to the owner merging this gate record into
protected history.
