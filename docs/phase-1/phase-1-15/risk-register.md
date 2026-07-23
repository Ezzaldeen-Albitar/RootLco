# Phase 1-15 — Risk Register

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. What this register is, and what it is not

This is the list of things that are **still true after** the phase's work — the residuals, not the
defects. A defect found and fixed during the phase belongs in
[the database remediation record](phase-1-15-database-remediation-record.md); a decision the phase
declined to make belongs in [the open decisions record](open-decisions.md). What is left here is the
set of conditions a reader would be misled by if they assumed the opposite.

Two honesty rules govern every row:

1. **Likelihood and impact are judgements, not measurements.** There is no production environment, no
   telemetry, and no incident history to calibrate against, so both columns record an
   owner-authorized engineering judgement and nothing more. They are useful for ordering the register;
   they are not evidence.
2. **"What is NOT in place" is the load-bearing column.** Every row states the compensating control
   _and_ the thing that control does not do. A register that lists only mitigations reads as
   reassurance, which is the failure mode it exists to prevent.

The P1-15 owner gate is **Pending**. Nothing in this register asserts, implies, or anticipates a Go
decision, and none of these residuals is claimed to be closed by the phase.

## 2. Residual risks

| Ref  | Residual risk                                                        | Likelihood | Impact | What IS in place                                                                                                                                                                                                                                                                                     | What is NOT in place                                                                                                                                                    |
| ---- | -------------------------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | No malware scanner exists, so document **acceptance is unavailable** | Certain    | High   | The acceptance path is structurally closed, not merely unused; rejection and pre-acceptance lifecycle work; a download of a non-accepted version is refused with `ERR-DOC-001`                                                                                                                       | Any scanner, any byte inspection, any content-type verification against the stored object, and any writer for scan verdicts                                             |
| R-02 | No production object store is provisioned                            | Certain    | High   | A provider **port** with an `unconfigured` default that refuses to sign, and a deterministic local adapter that signs against a `.invalid` host                                                                                                                                                      | A provisioned bucket, a retention or lifecycle policy, an encryption-at-rest position, replication, or any hosted storage account                                       |
| R-03 | No production message-delivery provider is provisioned               | Certain    | High   | A delivery **port** with an `unconfigured` default that refuses, a deterministic in-process adapter, and an enqueue path that succeeds independently of delivery                                                                                                                                     | Any email/SMS/push account, any sending domain or reputation, any delivery receipt, any real recipient reaching                                                         |
| R-04 | Rendered notification content is **transient**                       | Likely     | Medium | Rendering happens once at enqueue from an approved immutable version; the SHA-256 digest is stored; the dispatcher re-derives the digest and refuses a mismatch                                                                                                                                      | Any durable store for rendered content; cross-process reproduction after the enqueueing process ends                                                                    |
| R-05 | The upload token is **unsigned**                                     | Certain    | Low    | Every claim inside the token is re-validated server-side at registration: document re-loaded under RLS, storage key re-derived, content type re-checked, size and expiry re-checked                                                                                                                  | A signature, a MAC, a key, or any key-management mechanism. The token is not, and is not treated as, a security boundary                                                |
| R-06 | The pagination cursor is **unsigned**                                | Certain    | Low    | The cursor's contract key carries a fingerprint of filter set, sort, and tenant, so a cursor fails closed when reused in a different query; every page still runs under RLS                                                                                                                          | A signature. The fingerprint is recomputable by anyone; tampering is _detected only_ as a mismatch, never cryptographically                                             |
| R-07 | No monitoring backend is provisioned                                 | Certain    | Medium | A fixed metric vocabulary, an in-memory bounded recorder, structured logs with enforced redaction, and an exporter seam composition can fill                                                                                                                                                         | Any exporter, dashboard, alert, retention, on-call route, SLO, or error-monitoring platform. Nothing is watching                                                        |
| R-08 | Search normalization does **not** detect confusables                 | Possible   | Medium | NFKC, combining-mark stripping, control/bidi removal, locale-neutral lower-casing, whitespace collapse, and a hard length bound — applied identically on both index and query sides                                                                                                                  | Any homoglyph or mixed-script confusable collapsing. Cyrillic `а` and Latin `a` remain different values                                                                 |
| R-09 | Arabic-Indic digits normalize to `NULL` (frozen phone contract)      | Likely     | Medium | The TypeScript mirror reproduces the frozen SQL exactly, so application and database always agree; a value that normalizes to nothing is reported implausible rather than stored                                                                                                                     | Any Arabic-Indic digit folding. Changing it is a database change with its own change request, not an application fix                                                    |
| R-10 | Export produces **no file**, so CSV neutralisation is unfulfilled    | Certain    | Medium | Authorization is enforced and audited; risky free-text fields are enumerated per resource; `isFormulaRiskyCell()` is the single shared definition of "risky"                                                                                                                                         | Any writer, any file, any neutralisation actually applied. The obligation is transferred downstream and is currently unfulfilled                                        |
| R-11 | `validate:seed-state` fails when run **after** `test:db`             | Certain    | Low    | A **Phase 1-5** suite, `tests/db/shared-retention.test.ts`, overwrites three retention periods for its eligibility tests and does not restore them. `.github/workflows/ci.yml` runs the seed assertion at line 236, before `test:db` at line 284, so hosted CI always measures an untouched database | Any restoration in that suite. P1-15 does not fix it: editing another phase's test to make its own run look cleaner is exactly what the review policy exists to prevent |
| R-12 | `validate:canonical-docs` can pass in no checkout                    | Certain    | Low    | The check compares recorded hashes of two Word documents held at `../` paths **outside** the repository. It is an owner-side integrity control over the canonical originals, and it is **not** a required hosted-CI job                                                                              | Any in-repository copy of those documents, and any way for a clean room or a CI runner to satisfy the check                                                             |

## 3. Why each residual is what it is

### R-01 — No malware scanner, so acceptance is closed

`shared.guard_document_version_transition` moves a version to `accepted` only when a `clean` row
exists in `shared.file_scan_results`, and
[DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md)
deliberately withheld write capability on that table from **every** application role. That withholding
is the reason acceptance is unavailable, and it is also the reason no code path can fabricate a
verdict. The register records this as a residual rather than a defect because the two facts are the
same fact: the platform cannot accept a document _because_ it cannot pretend to have scanned one.

What follows practically: uploads can be authorized, versions registered as `pending`, links created,
versions rejected — and downloads refused. `ERR-DOC-001` exists specifically so that refusal reads as
"this version's state does not permit it" rather than "not found", which would be misleading when the
caller can already see the version.

Declaring a content type at upload is a **request**, not a fact about the bytes. Nothing reads the
bytes. Verifying that a stored object matches its declared type is the same missing component as the
scanner.

### R-02 / R-03 — Ports, not providers

Both are ports whose default adapter is `unconfigured` and whose default behaviour is to refuse:
storage surfaces `ERR-SYS-001` naming the setting for the operator, delivery raises a provider error
classified as an outage. The local adapters exist so the retry, timeout, outage, and dead-letter paths
are exercised by real code rather than described in prose — the storage adapter signs against a
`.invalid` host precisely so a URL it issues can be asserted in a test and can never resolve in the
world.

Reading these as "storage works" or "notifications are delivered" would be wrong in both directions:
nothing is provisioned, and the honest default refuses rather than silently selecting something.
Selection is an owner decision — see [open decisions](open-decisions.md) OD-01 and OD-02.

### R-04 — Transient rendered content

`app_worker` holds no privilege on `shared.template_versions`, and `outbound_messages` stores a digest
rather than a body. Together those mean the dispatcher **cannot** re-render, by design: the row proves
a message was requested and carries its lifecycle and integrity digest, and the content travels
in-process from enqueue to dispatch.

The residual is precise. If the process holding the rendered content ends before dispatch, that
content is gone and no other process can reproduce it. The message row survives; the body does not.
Cross-process redelivery of content is **not implemented and not claimed**. Whether to introduce a
durable transient store — and accept that it becomes a second place message content lives — is
recorded as OD-06.

### R-05 / R-06 — Two unsigned values, and why that is acceptable

Both are recorded together because they share one root cause and one justification.

**Root cause.** Signing either would require a key shared across every instance, which requires key
management, which is not provisioned. Half-building it — a hard-coded key, a per-process key, a key
in the repository — would be worse than not building it, because it would _look_ like a boundary.

**Justification.** Neither value carries authority.

- The upload token carries what the client was told to upload. At registration the server re-loads the
  document under RLS (a forged id for another tenant resolves to nothing), **re-derives** the storage
  key from the environment, session tenant, and token ids and requires equality (a caller cannot name
  a key), re-checks the content type against the category allow-list, re-checks size against both the
  category ceiling and the platform ceiling, and re-checks the expiry. Forging the token achieves
  nothing that these checks do not independently refuse.
- The cursor decides nothing about authorization. Every page runs under RLS and the caller's own
  context. The fingerprint over `(contract key, sort, filter set, tenant)` makes a cursor fail closed
  when presented to a different query; it is truncated to 16 hex characters, which is a **collision
  budget, not a security one** — a collision produces a wrong page and nothing worse. A caller who
  recomputes the fingerprint can forge a cursor, and the worst outcome is a page of their own rows
  starting somewhere else.

This acceptance would stop being valid the moment either value carried a decision — a permission, a
scope, a tenant that is not re-derived. Neither does, and that property is what the acceptance rests
on.

### R-07 — No monitoring backend

Metrics are a port with a fixed instrument vocabulary and an in-memory, bounded default recorder; logs
go through the foundation logger with case-insensitive substring redaction of secret-like keys. The
P1-15 instruments were added as keys in the existing `METRICS` object rather than through a second
framework, and their labels are catalogue metadata only — a sequence code, an aggregate name, a
channel, a result word — never an identifier, because an identifier would both explode cardinality and
turn a metrics store into an enumeration oracle for data it has no isolation for.

None of that is monitoring. No exporter is configured, no dashboard exists, no alert fires, nothing is
retained, and no one is paged. A reader must not infer observability from the presence of instruments.

### R-08 — No confusable detection

Search normalization is the one genuinely new primitive in the phase — VIN, phone, and email all
mirror frozen SQL. It is deliberately lossy (diacritics and combining marks are stripped so `مُحَمَّد`
and `محمد` converge), which is why callers always persist the display value separately.

What it does not do is collapse visually confusable characters across scripts. Two records whose names
differ only by a Cyrillic-versus-Latin `a` remain distinct values and will not match each other. The
consequence is a **matching** consequence — a duplicate that is not detected, a search that does not
find — not an authorization one, since normalization never participates in an access decision. No
confusable detection is implemented and none is claimed.

### R-09 — Arabic-Indic digits and the frozen phone contract

`crm.normalize_phone` counts only ASCII `[0-9]` as a digit. A wholly Arabic-Indic number therefore
normalizes to `NULL`, and a lone `+` normalizes to `'+'` rather than `NULL`. Both behaviours are
reproduced exactly by the TypeScript mirror.

That choice is deliberate and is the safer of the two available choices. Generated columns and lookup
keys in protected schema are derived from the frozen function; a mirror that "fixed" the behaviour
would produce keys that disagree with stored data while looking correct — a silent failure rather than
a visible one. The mirror reports implausibility alongside the normalized value and never repairs it,
so a caller can surface the problem to a user. Changing the underlying behaviour is a database change
with its own change request, not something an application phase may do unilaterally.

The user-visible residual is real: a customer who enters their number in Arabic-Indic numerals gets
nothing stored, and the interface must tell them so rather than accepting silently.

### R-10 — Export authorizes, and generates nothing

P1-15 answers _may this caller export this resource, with these fields, under these filters, at this
size?_, records the answer in the audit trail, and returns `generated: false` in the response so no
consumer can mistake an authorization for a download. Generation is deliberately elsewhere: a
generator needs an object store to write to (R-02), a retention decision for the artefact, and a
delivery channel — none of which exists.

A value beginning `=`, `+`, `-`, `@`, tab, or CR is executed as a formula by common spreadsheet
software. Because P1-15 writes no file, it cannot neutralise one. What it does instead is make the
obligation explicit and single-sourced: `isFormulaRiskyCell()` is the one definition of "risky", and
each authorization returns the registered free-text fields that will need neutralising. **This is an
unfulfilled downstream obligation, not a control.** If a generator ships without calling it, the risk
lands in full.

### R-11 — a Phase 1-5 suite leaves reference rows changed

`tests/db/shared-retention.test.ts` deliberately overwrites `min_retention_days` and
`allows_deletion` for three retention classes, so its eligibility-function tests have known finite,
indefinite and no-delete periods. Its own comment says so. It does not restore them.

The consequence is narrow and entirely local: on a freshly rebuilt database `validate:seed-state`
passes; after `npm run test:db` it fails with _"Retention classes do not match the five governed
values"_. Hosted CI is unaffected, and not by luck — `.github/workflows/ci.yml` runs
`db:apply-migrations` (line 233) → `validate:seed-state` (line 236) → the classification checks →
`test:db` (line 284), so the seed assertion always measures a database no suite has touched.

**P1-15 does not fix this.** Changing another phase's test to restore state is a change to that
phase's evidence, and making that change inside a feature pull request — to make this phase's own
run look cleaner — is precisely the kind of quiet edit the review policy exists to prevent. It is
recorded as a known local-run ordering constraint: run `validate:seed-state` before `test:db`, or
after a reset. It is a **test-isolation defect in Phase 1-5's suite**, Low, and it belongs to whoever
next opens that phase's tests.

### R-12 — an owner-side check that no checkout can satisfy

`npm run validate:canonical-docs` compares recorded hashes of
`RootLco_Phase_1_Development_Plan_recovered_v01.docx` and
`RootLco_Master_Project_Documentation.docx`, expected at `../` and `../documentation/` respectively —
**outside the repository root**. No clone, worktree, or CI runner can satisfy it, and a clean room
least of all.

It is not a required hosted-CI job and is not part of `.github/workflows/ci.yml`. It is an
owner-side integrity control over the canonical Word originals, which live on the owner's machine by
design. It is recorded here, and reported as `unavailable` rather than omitted from validation
records, so nobody later reads its absence from a green list as a pass.

## 4. Carried forward from earlier phases, unchanged

These are not P1-15 residuals; they are open items the phase inherited, restated so the register is
complete rather than flattering. Each is recorded in the
[P1-15 owner gate](phase-1-15-owner-gate.md) §4.

| Ref                       | Item                                                                        | State                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-OD-027 (NFR-SCL)       | Production capacity, throughput, latency, and scale targets                 | Unresolved. Every numeric limit added by this phase is a **proposed validation baseline**, never a measured production target                   |
| R-1                       | Reversible IP / user-agent pseudonymisation                                 | Disclosed limitation, unchanged by this phase                                                                                                   |
| R-3                       | Dependency-vulnerability scanning                                           | No control implemented, none claimed                                                                                                            |
| R-5                       | Database-suite intermittency                                                | Low, **undiagnosed, not resolved**. A green run does not close it                                                                               |
| `AUTH-SESSION-TRANSPORT`  | Session transport decision                                                  | Carried from P1-14, unresolved                                                                                                                  |
| `IAM-SELF-ONBOARDING`     | Self-onboarding position                                                    | Carried from P1-14, unresolved                                                                                                                  |
| `IAM-BASELINE-PERMISSION` | Baseline permission set                                                     | Carried from P1-14, unresolved                                                                                                                  |
| Withheld shared relations | `shared.status_history`, `shared.status_evidence`, `shared.search_metadata` | Deliberately unwritable by every application role. The transition engine drives module-owned histories instead; no search projection is written |

## 5. What this register deliberately does not say

To be explicit about the claims a reader might expect and will not find:

- **No production readiness claim.** No environment beyond Local exists.
- **No SLO, throughput, latency, availability, or capacity claim.** Nothing was measured.
- **No failover, replication, sharding, CDN, load-balancing, or broker-availability claim.** None is
  provisioned; the corresponding ADRs record readiness reasoning, not provisioning.
- **No malware-scanning claim**, in any form, including "basic" or "partial" scanning.
- **No production object store or message provider claim.** Both are ports with `unconfigured`
  defaults.
- **No independent review, QA, or third-party audit claim.** Every review in this phase is
  owner-authorized technical self-review.

## 6. Status

The owner gate for this phase is **Pending**, and this register is an input to that decision rather
than a product of it. Nothing here has been accepted, waived, or closed by anyone; each row remains
open until the approval owner records a disposition against it.
