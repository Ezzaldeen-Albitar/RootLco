# Phase 1-15 — Shared Services Backend

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-23 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).
**No document in this folder is an independent third-party audit.**

> **Authority.** Phase scope and sequencing are governed by the canonical documents recorded in
> [canonical-documents.md](../../governance/canonical-documents.md), which live outside this
> repository by owner decision.

---

## Status

**The owner gate is [Pending](phase-1-15-owner-gate.md), and stays Pending until the approval owner
records a decision against evidence on the exact merged SHA.** Nothing in this folder is a gate
decision, and no document here claims the phase has passed.

The phase follows the governance path established by P1-13 and P1-14: a read-only reality inspection
first, then any blocking database gap raised as a controlled change request and delivered in its own
pull request, then feature work on top of the proven boundary.

| Step                                                                       | State                                                                                                                                              |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wave 0 reality and contract inventory                                      | **Complete** — [initial audit](phase-1-15-initial-audit.md)                                                                                        |
| Binding conflicts between planning text and frozen contracts resolved      | **Complete** — [implementation decisions](phase-1-15-implementation-decisions.md)                                                                  |
| DBCR-P1-15-001 raised, classified, and delivered as a separate migration   | **Complete** — [remediation record](phase-1-15-database-remediation-record.md), [migration classification](phase-1-15-migration-classification.md) |
| Protected merge of the remediation re-verified before feature work resumed | **Complete** — [remediation verification](phase-1-15-remediation-verification.md)                                                                  |
| Shared-services module implemented on the P1-5 / P1-13 / P1-14 contracts   | **In feature execution** — [architecture](phase-1-15-architecture.md)                                                                              |
| Owner gate                                                                 | **Pending** — no decision recorded                                                                                                                 |

## What this phase delivers

A single `shared-services` module ([architecture](phase-1-15-architecture.md)) holding the
cross-cutting backend capability that every later module composes rather than reinvents. Each item
below is implemented against an already-frozen database or foundation contract, not beside one.

| Capability                | Shape as delivered                                                                                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display-number allocation | An **in-process transactional service** taking the caller's open handle, so the counter advance and the business write commit or roll back together. Allocation is restricted to a reviewed sequence registry |
| Status transitions        | A registered-in-code transition graph driving **module-owned** history tables under a version guard, with audit and outbox event in the same transaction                                                      |
| Attachment lifecycle      | The frozen P1-13 `FileService`, implemented: metadata creation, upload authorization, version registration, linking and unlinking, version rejection, and download authorization for accepted versions        |
| Storage and signed URLs   | A provider **port** with a deterministic local adapter; server-built keys, bounded expiry, method and content binding                                                                                         |
| Notifications             | The frozen P1-13 `NotificationService`, implemented enqueue-first, plus a worker-archetype dispatcher that cannot be reached from a request                                                                   |
| Message templates         | Tenant-scoped templates with an immutable approved form, deterministic rendering, and an administrator preview                                                                                                |
| Normalization             | VIN, phone, email, and search normalizers that **mirror the frozen SQL exactly** and report validity separately from the value                                                                                |
| Query primitives          | Contract-declared filtering and sorting with bound parameters only, and a cursor bound to the filter set, sort, and tenant                                                                                    |
| Export authorization      | An audited allow-list decision over resources, fields, filters, and row estimate                                                                                                                              |
| Health                    | Versioned liveness and readiness projections at new paths, with `/api/health` left untouched                                                                                                                  |

## What this phase deliberately does not deliver

Named here so no reader infers a capability from the presence of a port, an interface, or a table.

| Not delivered                                                                                   | Why                                                                                                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Malware scanning, and therefore document **acceptance**                                         | **No scanner is configured and none is claimed.** The database accepts a version only with a `clean` scan row, and no application role may write `shared.file_scan_results`. Acceptance is an explicit follow-on |
| A production object store                                                                       | None is provisioned. A port plus a local adapter that signs against a reserved `.invalid` host; the default setting is `unconfigured` and refuses to sign                                                        |
| A production message-delivery provider                                                          | None is provisioned. A port plus an in-process adapter that delivers nothing; the default refuses to deliver                                                                                                     |
| Export **file generation**                                                                      | P1-15 authorizes and audits the decision; the response says `generated: false`. A generator needs an object store, a retention decision, and a delivery channel — none of which exists                           |
| Document renaming, re-classification, or archival                                               | The request runtime holds **no UPDATE grant at all** on `shared.documents`. Only creation and the pre-acceptance version lifecycle are within reach                                                              |
| A generic writable workflow store                                                               | `shared.status_history` and `shared.status_evidence` remain unwritable by every application role, deliberately. Each aggregate drives its own scope-bound, coherence-guarded history                             |
| SMS and WhatsApp delivery                                                                       | The database CHECK constraints allow `email` and `in_app` only. The frozen interface type is wider; the request is refused with a stable code rather than a constraint violation                                 |
| Signed upload tokens or signed cursors                                                          | Both are unsigned and documented as carrying convenience, never authority; every field is re-derived and re-checked server-side. Signing needs key management across instances, which is not provisioned         |
| Monitoring, alerting, SLOs, throughput, failover, CDN, replication, sharding, or load balancing | **None is provisioned.** Metrics are emitted as keys in the existing foundation object; no collector, dashboard, scheduler, supervisor, or alert route exists                                                    |
| Fake, demo, or sample business data                                                             | Prohibited by standing policy. Reference data is structural only; test data is ephemeral                                                                                                                         |

## Documents in this folder

The **State** column is honest about what exists today: `Present` means the file is committed;
`In this package` means it is part of this same documentation deliverable and its link resolves once
the package lands.

### Phase governance and closure

| Document                                                                     | Purpose                                                                                                                               | State           |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| [Owner gate](phase-1-15-owner-gate.md)                                       | The gate record, opened at the start of the phase in **Pending**, with the conditions a decision must be evidenced against            | Present         |
| [Initial audit and contract inventory](phase-1-15-initial-audit.md)          | Wave 0 read-only reality inspection: protected starting state and the executable contracts this phase must compose                    | Present         |
| [Binding implementation decisions](phase-1-15-implementation-decisions.md)   | Every conflict between the planning text and a frozen contract, resolved in favour of the contract, with the evidence that settled it | Present         |
| [Database remediation record](phase-1-15-database-remediation-record.md)     | DBCR-P1-15-001 as delivered: capability decisions per table, finding P1-15-R-001, and the withheld relations                          | Present         |
| [Migration classification](phase-1-15-migration-classification.md)           | Class, rollback posture, and object inventory of the one migration this phase adds                                                    | Present         |
| [Protected remediation verification](phase-1-15-remediation-verification.md) | Verification that the remediation merged correctly and that the capability boundary holds on protected `develop`                      | Present         |
| [Change log](change-log.md)                                                  | What changed in this phase, in delivery order, with the reason for each change                                                        | In this package |
| [Open decisions](open-decisions.md)                                          | Decisions this phase opens, carries, or closes — including the ones deliberately left open                                            | In this package |
| [Risk register](risk-register.md)                                            | Residual risks with their owners and the compensating controls actually in place                                                      | In this package |
| [Deliverable manifest](deliverable-manifest.md)                              | The complete inventory of what this phase ships, file by file                                                                         | In this package |

### Architecture and capability records

| Document                                                  | Purpose                                                                                                                                                                                             | State           |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| [Module architecture](phase-1-15-architecture.md)         | The public surface, the four sub-layers, composition and the frozen P1-13 seams, boundary rules B1–B12, the request/worker archetype split, and the architectural deviations from the planning text | Present         |
| [Number allocation service](number-allocation-service.md) | Why allocation is transactional and in-process, the sequence registry, and what gaplessness does and does not guarantee                                                                             | In this package |
| [Audit and event contract](audit-and-event-contract.md)   | Which audit actions and registered events this phase adds, their classifications, and why identity is never a parameter                                                                             | In this package |
| [Status transition engine](status-transition-engine.md)   | The fixed step order, the module-owned history rule, and what a caller structurally cannot do                                                                                                       | In this package |
| [Attachment lifecycle](attachment-lifecycle.md)           | The states reachable in this phase, the upload token's non-authority, and why acceptance is unavailable                                                                                             | In this package |
| [Storage and signed URLs](storage-and-signed-urls.md)     | The storage port, the key convention, the local adapter's signature, and the URL properties that are actually verified                                                                              | In this package |
| [Notification architecture](notification-architecture.md) | Enqueue-first, the content-digest contract, the dispatch lifecycle, and the recorded residual risk                                                                                                  | In this package |
| [Template policy](template-policy.md)                     | The rendering engine's deliberate omissions, escaping per channel, and the platform-versus-tenant template boundary                                                                                 | In this package |
| [Normalization contract](normalization-contract.md)       | The SQL mirrors, the edge cases preserved on purpose, and the limitations recorded rather than fixed                                                                                                | In this package |
| [Query primitives](query-primitives.md)                   | Contract-declared filtering and sorting, the bounds, and why the cursor is not a security boundary                                                                                                  | In this package |
| [Export authorization](export-authorization.md)           | The resource and field allow-lists, the sensitive-field rule, and the authorization-versus-generation split                                                                                         | In this package |
| [Health endpoints](health-endpoints.md)                   | Liveness that touches nothing, readiness that reports a verdict and never a topology, and why `/api/health` is unchanged                                                                            | In this package |

### Operations, security, and evidence

| Document                                                            | Purpose                                                                                                                                    | State           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------- |
| [Observability and runbooks](observability-and-runbooks.md)         | The metrics and log fields this phase emits, the redaction hazards it works with, and the operator procedures — for capability that exists | In this package |
| [Performance and query evidence](performance-and-query-evidence.md) | Measured query behaviour and index usage, with the measurement conditions stated                                                           | In this package |
| [Security review](security-review.md)                               | Findings raised against this implementation with their dispositions, the reviewed attack surface, and residual risks                       | In this package |
| [API catalogue](api-catalog.md)                                     | Every registered P1-15 operation with its method, path, permissions, scope, and audit class                                                | In this package |
| [Test catalogue](test-catalog.md)                                   | The suites this phase adds and what each one proves                                                                                        | In this package |
| [Traceability matrix](traceability-matrix.md)                       | Requirement to implementation to test, in both directions                                                                                  | In this package |
| [Evidence index](evidence-index.md)                                 | Commands run, exit codes, and where each artefact lives                                                                                    | In this package |

## Related records outside this folder

| Document                                                                                                      | Why it matters here                                                                                     |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [DBCR-P1-15-001](../../database/change-requests/DBCR-P1-15-001-shared-services-runtime-write-capabilities.md) | The blocking capability gap, the approved additive remediation, and the relations deliberately withheld |
| [DBCR-P1-15-001 capability matrix](../../database/change-requests/DBCR-P1-15-001-capability-matrix.md)        | The per-table actor decision the remediation was designed from                                          |
| [Backend architecture and shared foundation](../../standards/backend-architecture-and-shared-foundation.md)   | The P1-13 conventions this phase composes rather than reinvents                                         |
| [Number sequence and display number standard](../../database/number-sequence-standard.md)                     | The rule binding allocation to the consuming transaction                                                |
| [Storage key convention](../../database/storage-key-convention.md)                                            | The key shape and the values a key may never carry                                                      |
| [P1-14 phase index](../phase-1-14/README.md)                                                                  | The phase this one builds on, and the governance pattern it repeats                                     |
| [P1-13 post-gate correction register](../phase-1-13/phase-1-13-post-gate-correction-register.md)              | ADV-01, the reason every boundary rule judges a canonical path rather than raw import text              |
| [ADR-001 — modular monolith](../../adr/ADR-001-modular-monolith-architecture.md)                              | Why the module has exactly one legal import path                                                        |
| [ADR-012 — local-first environment](../../adr/ADR-012-local-first-environment-with-controlled-promotion.md)   | Why the storage and message providers remain open decisions with `unconfigured` defaults                |
