# Phase 1-16 — CRM Backend

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

**The owner gate is [Pending](phase-1-16-owner-gate.md), and stays Pending until the approval owner
records a decision against evidence on the exact merged SHA.** Nothing in this folder is a gate
decision, and no document here claims the phase has passed.

This phase builds the **application backend for the CRM (customer) domain** on top of the CRM
database delivered by Phase 1-6 and consumed unchanged, and on the request/authorization/audit/outbox
foundation delivered by Phases 1-13, 1-14, and 1-15. It adds **no migration**: migrations 1–118 are
consumed as they stand on protected `develop`. If a mandatory CRM operation cannot be performed under
the real runtime role because of a database gap, that gap is raised as a controlled change request and
delivered in its own remediation pull request — never as a convenience migration inside this feature.

| Step                                                                             | State                                                                                  |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Wave 0 reality, contract, schema, and runtime-capability inventory               | **Complete** — one blocker found (notes), delivered as DBCR-P1-16-001 / PR #66         |
| Remaining-capability database feasibility audit                                  | **Complete — no further blockers**; every capability lands on a runtime-writable table |
| CRM application module implemented on the P1-6 / P1-13 / P1-14 / P1-15 contracts | **Complete** — 18 operations, 18 at operation depth, all weak coverage categories zero |
| Owner gate                                                                       | **Pending** — no decision recorded                                                     |

### Delivered operations

All 18 are registered, guarded, represented in `docs/api/openapi.v1.json`, and carry
operation-depth backend evidence executed against a real database on the least-privilege
`app_runtime` role.

| Operation                 | Route                                   | Permission                        |
| ------------------------- | --------------------------------------- | --------------------------------- |
| `crm.customer-search`     | `GET /customers`                        | `crm.customer.read`               |
| `crm.individual-create`   | `POST /customers/individuals`           | `crm.customer.create`             |
| `crm.company-create`      | `POST /customers/companies`             | `crm.customer.create`             |
| `crm.contact-add`         | `POST /customers/{id}/contacts`         | `crm.customer.profile.write`      |
| `crm.address-add`         | `POST /customers/{id}/addresses`        | `crm.customer.profile.write`      |
| `crm.preference-set`      | `PUT /customers/{id}/preferences`       | `crm.customer.profile.write`      |
| `crm.consent-record`      | `POST /customers/{id}/consents`         | `crm.customer.consent.write`      |
| `crm.note-add`            | `POST /customers/{id}/notes`            | `crm.customer.note.write`         |
| `crm.alert-raise`         | `POST /customers/{id}/alerts`           | `crm.customer.governance.manage`  |
| `crm.tag-assign`          | `POST /customers/{id}/tags`             | `crm.customer.governance.manage`  |
| `crm.customer-status-set` | `PUT /customers/{id}/status`            | `crm.customer.governance.manage`  |
| `crm.restriction-impose`  | `POST /customers/{id}/restrictions`     | `crm.customer.restriction.manage` |
| `crm.duplicate-scan`      | `POST /customers/{id}/duplicate-scans`  | `crm.customer.duplicate.review`   |
| `crm.duplicate-review`    | `POST /customer-duplicates/{id}/review` | `crm.customer.duplicate.review`   |
| `crm.customer-merge`      | `POST /customers/{id}/merge`            | `crm.customer.merge`              |
| `crm.customer-history`    | `GET /customers/{id}/history`           | `crm.customer.read`               |
| `crm.customer-timeline`   | `GET /customers/{id}/timeline`          | `crm.customer.read`               |
| `crm.vehicle-link`        | `POST /customers/{id}/vehicles`         | `crm.customer.vehicle.manage`     |

### Route-shape decision — approved

The plan text writes the duplicate review and merge routes with a colon verb
(`{candidateId}:review`, `{customerId}:merge`). They are delivered as `/review` and `/merge`
sub-resources instead. **This is the approved canonical HTTP mapping for Phase 1-16** — a technical
decision under the standing technical authorization, made for two independent reasons:

1. The phase's own route convention rules out colon-verb paths in favour of noun/sub-resource
   shapes, and every other operation in this phase follows that convention.
2. A path segment containing `:` cannot be a directory name on Windows, where this repository is
   developed. The colon form is therefore **unbuildable here** (Next.js filesystem routing), not
   merely discouraged, and it is equally incompatible with the OpenAPI tooling and the
   operation-registration architecture.

Operation identifiers, permissions, request and response contracts, audit and event behaviour,
requirement traceability, and semantics are exactly as specified — only the separator differs, and
the operation IDs (`crm.duplicate-review`, `crm.customer-merge`) are stable and independent of path
syntax. No colon-form alias or catch-all compatibility route is added: no external consumer or
automated contract requires one. **No user decision remains open on this point.**

## What this phase delivers

A single `crm` application module composing the frozen CRM database and the shared backend foundation
into governed customer-domain operations. Each capability is built against an already-frozen contract,
not beside one.

| Capability                         | Shape as delivered                                                                                          |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Customer search                    | Bounded, privacy-safe, cursor-paginated query over an allow-listed field set, sensitive identifiers gated   |
| Individual customer creation       | Transactional create with in-transaction number allocation, duplicate pre-check, idempotency, audit, outbox |
| Company customer creation          | Transactional create for legal entities with approved identifiers only and candidate-key enforcement        |
| Contacts / addresses / preferences | Scoped, normalized, versioned records with soft retirement where the schema requires it                     |
| Consents                           | Append-only, high-integrity privacy records; withdrawal never erases prior evidence                         |
| Notes / alerts / tags              | Governed operational records with allow-listed types and lifecycle separation                               |
| Customer statuses                  | A CRM-owned, guarded status-transition history under a version guard, with audit and outbox                 |
| Restrictions                       | Privileged, evidenced, append-only records enforced by the CRM operations they constrain                    |
| Duplicate scoring                  | Deterministic, explainable, versioned weighted scoring over already-normalized data — no ML, no black box   |
| Duplicate review                   | A controlled, replay-safe disposition workflow with append-only review history                              |
| Customer merge                     | Conservative record-and-redirect merge preserving provenance, rolling back atomically, never row-rewriting  |
| Customer history / timeline        | Read-only projections composing immutable sources — never a second source of truth                          |
| Customer–vehicle relationships     | Tenant-safe links to the frozen vehicle contract with lifecycle and overlap rules                           |

## What this phase deliberately does not deliver

Named here so no reader infers a capability from the presence of a port, an interface, or a table.

| Not delivered                                                       | Why                                                                                      |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Any database migration                                              | The CRM schema is frozen at migration 118. Gaps are raised as DBCRs, not added here      |
| A frontend                                                          | P1-16 is backend only                                                                    |
| Legacy Benzene data migration                                       | Out of scope; Benzene is a configurable pilot tenant, never a hard-coded identifier      |
| Machine-learning or external identity matching                      | Duplicate scoring is deterministic and explainable only                                  |
| Dependency-vulnerability or malware scanning                        | **No such control is implemented and none is claimed**                                   |
| Production monitoring, SLOs, throughput, failover, CDN, replication | **None is provisioned.** Observability is emitted as low-cardinality keys only           |
| Fake, demo, or sample business data                                 | Prohibited by standing policy. Reference data is structural only; test data is ephemeral |

## Documents in this folder

The **State** column is honest about what exists today: `Present` means the file is committed;
`Planned` means it is part of this same phase deliverable and lands during feature execution.

### Phase governance and closure

| Document                                                                    | Purpose                                                                                             | State   |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------- |
| [Owner gate](phase-1-16-owner-gate.md)                                      | The gate record, opened in **Pending**, with the conditions a decision must be evidenced against    | Present |
| [Initial audit and contract inventory](phase-1-16-initial-audit.md)         | Wave 0 read-only reality inspection: protected starting state and the contracts this phase composes | Planned |
| [Implementation decisions](phase-1-16-implementation-decisions.md)          | Every conflict between the planning text and a frozen contract, resolved in favour of the contract  | Planned |
| [Database / runtime capability audit](database-runtime-capability-audit.md) | Per-table runtime-role capability the CRM operations actually have, proven under the runtime role   | Planned |
| [Change log](change-log.md)                                                 | What changed in this phase, in delivery order, with the reason for each change                      | Planned |
| [Open decisions](open-decisions.md)                                         | Decisions this phase opens, carries, or closes                                                      | Planned |
| [Risk register](risk-register.md)                                           | Residual risks with their owners and the compensating controls actually in place                    | Planned |
| [Deliverable manifest](deliverable-manifest.md)                             | The complete inventory of what this phase ships, file by file                                       | Planned |

### Capability contracts

| Document                                                                            | Purpose                                                         | State   |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------- |
| [Module architecture](phase-1-16-architecture.md)                                   | The public surface, sub-layers, composition, and boundary rules | Planned |
| [Customer search contract](customer-search-contract.md)                             | Field allow-list, pagination, sensitive-view gating             | Planned |
| [Individual and company creation contracts](creation-contract.md)                   | Required fields, number allocation, duplicate handling          | Planned |
| [Contact / address / preference contracts](profile-contract.md)                     | Scope, normalization, versioning, retirement                    | Planned |
| [Consent contract](consent-contract.md)                                             | Append-only privacy record, purposes, withdrawal semantics      | Planned |
| [Notes / alerts / tags contract](engagement-contract.md)                            | Allow-listed types, lifecycle, governance                       | Planned |
| [Status transition contract](status-transition-contract.md)                         | State vocabulary, transition matrix, CRM-owned history          | Planned |
| [Restrictions contract](restrictions-contract.md)                                   | Types, evidence, enforcement by CRM operations                  | Planned |
| [Duplicate scoring standard](duplicate-scoring-standard.md)                         | Signals, weights, rule version, explainability                  | Planned |
| [Duplicate review standard](duplicate-review-standard.md)                           | Dispositions, replay-safety, review history                     | Planned |
| [Customer merge contract](customer-merge-contract.md)                               | Winner/loser rules, conflict handling, provenance, rollback     | Planned |
| [History and timeline standard](history-and-timeline-standard.md)                   | Source composition, ordering, redaction                         | Planned |
| [Customer–vehicle relationship contract](customer-vehicle-relationship-contract.md) | Types, periods, overlap, tenant safety                          | Planned |

### Operations, security, and evidence

| Document                                                            | Purpose                                                                     | State   |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------- |
| [API catalogue](api-catalog.md)                                     | Every registered P1-16 operation with method, path, permissions, scope      | Planned |
| [Audit and event contract](audit-and-event-contract.md)             | The CRM audit actions and events this phase adds, with classifications      | Planned |
| [Error catalogue](error-catalog.md)                                 | CRM-specific problem codes added by this phase                              | Planned |
| [Observability and runbooks](observability-and-runbooks.md)         | The low-cardinality metrics and log fields emitted, and operator procedures | Planned |
| [Performance and query evidence](performance-and-query-evidence.md) | Measured query behaviour and index usage on generated non-personal data     | Planned |
| [Security review](security-review.md)                               | Findings raised against this implementation with their dispositions         | Planned |
| [Test catalogue](test-catalog.md)                                   | The suites this phase adds and what each one proves                         | Planned |
| [Operation-to-test evidence](operation-to-test-evidence.md)         | Per-operation acceptance evidence for every new operation                   | Planned |
| [Traceability matrix](traceability-matrix.md)                       | Requirement to implementation to test, in both directions                   | Planned |
| [Evidence index](evidence-index.md)                                 | Commands run, exit codes, and where each artefact lives                     | Planned |
| [Clean-room validation](clean-room-validation.md)                   | The full isolated-clean-room sequence, every command and exit code          | Planned |

## Related records outside this folder

| Document                                                                                                    | Why it matters here                                             |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| [P1-15 phase index](../phase-1-15/README.md)                                                                | The shared-services foundation this phase composes              |
| [P1-6 phase index](../phase-1-6/README.md)                                                                  | The CRM database contract this phase consumes unchanged         |
| [Backend architecture and shared foundation](../../standards/backend-architecture-and-shared-foundation.md) | The P1-13 conventions this phase composes rather than reinvents |
| [ADR-001 — modular monolith](../../adr/ADR-001-modular-monolith-architecture.md)                            | Why the module has exactly one legal import path                |
