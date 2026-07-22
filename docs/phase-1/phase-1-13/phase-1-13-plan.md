# Phase 1-13 — Backend Architecture and Shared Application Foundation

**Company:** RootLco — Root Link Company · **Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation · **Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md)).

> **Authority.** The canonical definition of this phase is Phase 1-13, fields 1–35, of
> `RootLco_Phase_1_Development_Plan_recovered_v01.docx`, which lives outside this repository and
> wins on any disagreement (see [canonical documents](../../governance/canonical-documents.md)).
> This file is the repository-side working record of that definition, with the binding 35-field
> structure preserved. Section 36 records the additional approved cross-cutting principles.

---

## 1. Phase ID

P1-13. Member of the Backend Development Group (Release 3 — Backend Foundation; grouping approval
pending **P1-OD-041**).

## 2. Phase title

Backend Architecture and Shared Application Foundation.

## 3. Purpose

Establish the binding backend engineering foundation: modular-monolith module boundaries,
application- and domain-service layering, controlled data access, Route Handler standards, API
versioning, request validation, the response and error model, correlation IDs, structured logging,
the transaction wrapper, the idempotency service, the authorization middleware,
tenant/company/branch context resolution, feature-flag evaluation, the domain-event publisher with
outbox processor, and the foundation-level file and notification service interfaces. Every
subsequent backend phase (1-14 … 1-24) composes this foundation instead of inventing its own
conventions.

## 4. Business value

A single shared foundation prevents divergent security, transaction, and error behaviour across
eleven backend phases. It converts the gated database security model (RLS, context functions,
audit) into an enforced application-layer contract, protects the multi-tenant commercial promise
(RSK-03), makes financially significant operations idempotent before the first financial endpoint
exists (FR-INT-002, RSK-04), and produces the contract artefacts the frontend phases depend on.

## 5. Scope

Module-boundary implementation with lint- and script-enforced import rules; application/domain
service layering; the repository layer that always executes inside a scoped session with the
Phase 1-4 context variables set; Route Handler standard with Zod validation, `/api/v1`, opaque
cursor pagination (default 50, maximum 100), money as decimal string plus currency code,
`Idempotency-Key` on critical commands, `If-Match`/`record_version` on versioned mutations; RFC
9457 problem documents with stable `ERR-` codes; the transaction wrapper (business state + status
history + audit + outbox in one commit); idempotency over `shared.idempotency_keys`; authorization
over `iam.has_permission` / `iam.has_permission_in_scope`; entitlement over
`org.resolve_feature_enabled`; the domain-event publisher writing `shared.event_outbox` in the
producer transaction and the outbox processor worker; contract-only file and notification service
interfaces; API conventions, error catalog, event catalog, OpenAPI foundation, and the backend
test foundation.

## 6. Out-of-scope

Any business endpoint or domain workflow (Phases 1-14 … 1-23); frontend work (Phase 1-25 onward);
**schema or migration changes** — the schema was gated in P1-12 and defects flow back only via a
change request; full document upload/download and notification dispatch (Phases 1-15 / 1-23);
external integrations and partner marketplace; Zoom Vehicle Inspection and Evaluation Services;
general ledger, procurement, payment gateways, subscription billing; production infrastructure,
load balancers, CDN provisioning, database replicas, sharding; an external message broker.

## 7. Preconditions

Verified in [`phase-1-13-precondition-report.md`](./phase-1-13-precondition-report.md): the P1-12
release gate passed and its closure commit is contained in protected `origin/develop`; the
baseline tag resolves to that commit; the Chapter 4 architecture is confirmed in the Architecture
Decision Register; the Phase 1-2 CI pipeline is operational; **OIR-01 (product name) remains
open** and no product name is hard-coded.

## 8. Dependencies

Depends on: P1-12 exit gate; Phase 1-2 standards; Phase 1-4 context and permission functions;
Phase 1-5 outbox and idempotency tables. Enables: Phases 1-14 … 1-24, and through the OpenAPI
foundation, Phases 1-25 … 1-32.

## 9. Inputs

Chapter 4 methodology and architecture (module boundaries, API conventions, event envelope,
observability); Chapter 3 requirements (FR-INT-001/002, FR-TEN-002/003, FR-IAM-002, FR-AUD-001,
FR-PLT-004; NFR-SEC, NFR-PER, NFR-MNT; BR-INT-001/002, BR-IAM-001, BR-TEN-001); the Phase 1-2
database architecture document; the Phase 1-4/1-5 data dictionaries; the P1-12 gate evidence and
its [backend database contract index](../phase-1-12/evidence/backend-database-contract-index.md).

## 10. Stakeholders

RootLco founders (Product Owner); Architect; Backend engineers; Security lead; QA lead; DevOps
lead. No Benzene involvement is required in this phase.

## 11. Responsible role

Architect (accountable); Senior backend engineer (foundation packages); Security lead
(authorization middleware and context resolution review). Under the Solo Developer Review Policy
these roles are held by Eng. Ezzaldeen Al-Bitar; role names describe responsibilities, not
separate people.

## 12. Database work

**No schema work.** The schema was delivered and gated in Phases 1-2 … 1-12. One defect was found
in the grant surface and raised as a change request rather than patched inside the feature work —
see [`DBCR-P1-13-001`](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md).
It was then implemented on its own branch by
`20260725090000_iam_shared_runtime_write_capabilities.sql`, the 114th migration and the only one
this phase adds. It changes grants, RLS policies, and two function bodies; it creates no table,
column, constraint, index, sequence, or role, and no existing migration file was edited or
removed.

## 13. Backend work

| Task         | Description                                          | Implementation                                                                                          | Status                                                                                    |
| ------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| P1-13-BE-001 | Module-boundary structure with enforced import rules | `src/modules/`, `eslint.config.mjs`, `scripts/check-module-boundaries.mjs` (rules B1–B7)                | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-002 | Layered-service standard and composition             | `src/server/layering.ts`, `src/modules/meta/**`                                                         | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-003 | Controlled data-access layer with scoped sessions    | `src/server/db/transaction.ts`, `repository.ts`, `pool.ts`                                              | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-004 | Tenant/company/branch context resolution             | `src/server/context/**`                                                                                 | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-005 | Authorization middleware                             | `src/server/auth/authorization.ts`, `operation-registry.ts`                                             | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-006 | Request-validation standard                          | `src/server/http/validation.ts`                                                                         | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-007 | Response format and error model                      | `src/server/errors/**`                                                                                  | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-008 | Correlation-ID propagation                           | `src/server/observability/correlation.ts`                                                               | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-009 | Structured logging (Pino) with scrubbing             | `src/server/observability/logger.ts`, `redaction.ts`                                                    | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-010 | Error-monitoring integration                         | `src/server/observability/monitoring.ts` — **port with a recording transport; no platform provisioned** | Implemented as a port — see §36.1                                                         |
| P1-13-BE-011 | Transaction wrapper                                  | `src/server/db/transaction.ts`                                                                          | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-012 | Idempotency service                                  | `src/server/http/idempotency.ts`                                                                        | Implemented — runtime grant delivered by DBCR-P1-13-001; still gated, still fails closed  |
| P1-13-BE-013 | Optimistic concurrency                               | `src/server/db/concurrency.ts`                                                                          | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-014 | Feature-flag evaluation                              | `src/server/auth/entitlement.ts`                                                                        | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-015 | Domain-event publisher                               | `src/server/events/**`                                                                                  | Implemented — runtime INSERT delivered by DBCR-P1-13-001; still gated, still fails closed |
| P1-13-BE-016 | Outbox processor worker                              | `src/server/worker/**`                                                                                  | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-017 | Consumer idempotency helper                          | `src/server/worker/consumer-registry.ts`                                                                | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-018 | File-service interface (contract only)               | `src/server/contracts/file-service.ts`                                                                  | Implemented as contract + stub                                                            |
| P1-13-BE-019 | Notification-service interface (contract only)       | `src/server/contracts/notification-service.ts`                                                          | Implemented as contract + stub                                                            |
| P1-13-BE-020 | OpenAPI foundation                                   | `src/server/openapi/document.ts`, `docs/api/openapi.v1.json`, `scripts/check-openapi.mjs`               | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-021 | Reference endpoint `GET /api/v1/meta/ping`           | `src/app/api/v1/meta/ping/route.ts`                                                                     | Implemented — evidenced at the P1-13 gate                                                 |
| P1-13-BE-022 | Backend test foundation                              | `vitest.config.backend.ts`, `tests/backend/**`, `tests/foundation/**`                                   | Implemented — evidenced at the P1-13 gate                                                 |

## 14. Frontend work

**Not applicable.** Backend precedes frontend; the frontend foundation is Phase 1-25 and consumes
the OpenAPI foundation produced here.

## 15. Security work

| Task          | Description                                                                                                                                   | Implementation                                                                  | Status                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| P1-13-SEC-001 | Authorization-coverage tooling; an unguarded operation fails the build                                                                        | `scripts/check-authorization-coverage.mjs`, `defineOperation()` runtime refusal | Implemented — evidenced at the P1-13 gate                                                |
| P1-13-SEC-002 | Context integrity: no client scope reaches `set_config`; immutable context; repository refuses without context; runtime role has no BYPASSRLS | `src/server/context/**`, `src/server/db/repository.ts`, `capabilities.ts`       | Implemented — evidenced at the P1-13 gate                                                |
| P1-13-SEC-003 | Rate-limiting foundation                                                                                                                      | `src/server/http/rate-limit.ts`, `trusted-proxy.ts`                             | Implemented — limits are proposed baselines                                              |
| P1-13-SEC-004 | Audit-emission helpers bound to the transaction wrapper                                                                                       | `src/server/audit/audit.ts`                                                     | Implemented — runtime grant delivered by DBCR-P1-13-001; still gated, still fails closed |
| P1-13-SEC-005 | Abuse-risk review of the foundation                                                                                                           | [`phase-1-13-security-note.md`](./phase-1-13-security-note.md)                  | Complete — evidenced at the P1-13 gate                                                   |
| P1-13-SEC-006 | Backend secrets handling; secret scanning extended to backend packages                                                                        | `npm run security:all` over the whole tracked tree                              | Implemented — evidenced at the P1-13 gate                                                |

## 16. QA work

| Task         | Description                                                                        | Status                      |
| ------------ | ---------------------------------------------------------------------------------- | --------------------------- |
| P1-13-QA-001 | Unit tests: validation, error mapping, context, flag evaluation, envelope building | Evidenced at the P1-13 gate |
| P1-13-QA-002 | Integration tests for the transaction wrapper, including failure injection         | Evidenced at the P1-13 gate |
| P1-13-QA-003 | Idempotency and concurrency tests                                                  | Evidenced at the P1-13 gate |
| P1-13-QA-004 | Authorization and RLS tests through the full stack                                 | Evidenced at the P1-13 gate |
| P1-13-QA-005 | Outbox processor tests                                                             | Evidenced at the P1-13 gate |
| P1-13-QA-006 | Error-path and OpenAPI contract tests                                              | Evidenced at the P1-13 gate |

## 17. DevOps work

| Task         | Description                                                                                                          | Status                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-13-DO-001 | CI extended with module-boundary, authorization-coverage, OpenAPI and backend-test stages, blocking merge on failure | Implemented in `.github/workflows/ci.yml`                                                                                                               |
| P1-13-DO-002 | Outbox worker runtime with health and observability                                                                  | Implemented as `OutboxWorker` + `queueHealth` + readiness signals. **No scheduler, alert routing, or dashboard is provisioned** (ADR-012) — see §36.1   |
| P1-13-DO-003 | Structured logs and error monitoring wired into an environment observability stack                                   | **Not delivered.** No environment beyond Local exists; the ports are in place and the wiring is deployment work. Recorded honestly rather than claimed. |

## 18. Documentation work

| Task          | Description                                              | Status                                                                    |
| ------------- | -------------------------------------------------------- | ------------------------------------------------------------------------- |
| P1-13-DOC-001 | API Conventions v0.1                                     | `docs/standards/api-conventions-v0.1.md`                                  |
| P1-13-DOC-002 | Error catalog and event catalog as controlled registries | `docs/standards/error-catalog-v0.1.md`, `event-catalog-v0.1.md`           |
| P1-13-DOC-003 | OpenAPI foundation and backend testing conventions       | `docs/api/openapi.v1.json`, `docs/testing/backend-testing-conventions.md` |

## 19. Data migration work

**Not applicable.** No legacy data is touched.

## 20. User stories

- **P1-13-US-001** — As a backend engineer, I want a reference endpoint and copyable foundation
  services so every business endpoint inherits validation, authorization, transactions, and errors
  without reinvention. _Acceptance:_ the exemplar passes all foundation suites and is referenced by
  the conventions document.
- **P1-13-US-002** — As the security lead, I want every operation provably behind server-side
  authorization and a scoped database context, so a forgotten check is a build failure.
  _Acceptance:_ the unguarded-operation check and the spoofed-scope test both fail closed.
- **P1-13-US-003** — As a frontend engineer, I want a stable OpenAPI foundation with a uniform
  error model. _Acceptance:_ the document is published and validated in CI, and the
  problem-document shape is under change control.

## 21. Technical stories

- **P1-13-TS-001** — Business state, status history, audit, and outbox in one transaction, so no
  observer sees a state change without its evidence and event. _Acceptance:_ failure injection
  proves all-or-nothing.
- **P1-13-TS-002** — At-least-once delivery with consumer idempotency. _Acceptance:_ re-delivery
  produces no duplicate effect; the dead-letter path is alertable.
- **P1-13-TS-003** — Module boundaries enforced by tooling. _Acceptance:_ a cross-module internal
  import fails CI.

## 22. Business rules

- **BR-INT-001** — an event is published only after the source transaction commits (outbox).
- **BR-INT-002** — a consumer records the event identifier before applying a non-idempotent effect.
- **BR-IAM-001** — deny takes precedence over allow.
- **BR-TEN-001** — entitlements are evaluated from the version effective at command time.
- **NEW (requires sync to Chapter 3 via change request)** — "Every backend operation must declare
  its required permission codes and audit action class at registration time." Implemented by
  `defineOperation()` and the authorization-coverage gate.

## 23. APIs

No business API operations. Delivered surface: `GET /api/v1/meta/ping` (authenticated,
permission-guarded, no business data); the OpenAPI foundation with shared components; and the
internal contracts `withTransaction`, `withIdempotency`, `requirePermissions`,
`resolveRequestContext`, `publishEvent`, `FileService`, `NotificationService`.

## 24. Events

**No domain events are published in this phase.** Delivered: the envelope builder, the
transactional publisher, the processor worker, and the event catalog v0.1 seeded with reserved
names (`EVT-IAM-001`, `EVT-CRM-001`, `EVT-VEH-001`, `EVT-APT-001`, `EVT-REC-001`, `EVT-DOC-001`,
`EVT-NTF-001`) for Phases 1-14 … 1-23.

## 25. Error cases

`ERR-IAM-001` authorization denied; `ERR-IAM-002` authentication required; `ERR-TEN-001` feature
not entitled; plus the registered foundation classes: validation failure, malformed request,
invalid cursor, idempotency-key required/conflict, record-version required/conflict, throttled,
not-implemented stub, and the unhandled-fault fallback. The full registry is
`src/server/errors/catalog.ts`, published as
[`error-catalog-v0.1.md`](../../standards/error-catalog-v0.1.md).

## 26. Audit requirements

Every privileged, approval-bearing, financial, export, and security-relevant operation registered
on this foundation emits exactly one `iam.audit_records` entry via `iam.audit_append` inside the
business transaction, with the correlation ID. Authorization denials and rate-limit breaches are
security-event candidates. **Both grants are in place since DBCR-P1-13-001**: `app_runtime` holds
EXECUTE on `iam.audit_append` and its three helpers, INSERT on the three audit tables, and INSERT
on `iam.security_events`. Reading either surface still requires the `iam.audit.view` permission —
the write grant is not a read grant. The behaviour where a capability is absent is unchanged: audit
emission fails closed and the operation is refused, while security-event persistence degrades to
structured logging without failing the request.

## 27. Acceptance criteria

As field 27 of the canonical plan, evidenced against
[`phase-1-13-owner-gate.md`](./phase-1-13-owner-gate.md) §3 (“Gate conditions”).
The pointer previously read “§2”, which was correct against the Pending version of that document;
in the Go version §2 is “Protected history” and the conditions moved to §3.

## 28. Test cases

Existing: TC-INT-001, TC-CON-001, TC-IAM-001, TC-RLS-001, TC-AUD-001, TC-TEN-001,
TC-NFR-SEC-001. New: TC-P1-13-001 (module-boundary enforcement), TC-P1-13-002 (context resolution
and spoofing), TC-P1-13-003 (authorization coverage), TC-P1-13-004 (validation and error model),
TC-P1-13-005 (logging/correlation/monitoring trace), TC-P1-13-006 (transaction all-or-nothing),
TC-P1-13-007 (OpenAPI conformance), TC-P1-13-008 (test-foundation self-check), TC-P1-13-009
(rate-limit and abuse cases).

## 29. Risks

RSK-02 (architecture unsuitability) — mitigated by building strictly on the approved architecture
and gating at this phase's exit. RSK-03 (tenant isolation) — server-resolved context,
repository-enforced `set_config`, full-stack RLS tests. RSK-04 (financial integrity) — idempotency
and the transaction wrapper exist before any financial endpoint. RSK-44 (a later phase calls the
database outside the controlled layer) — boundary rules B4/B5 plus the authorization-coverage
gate. RSK-52 (outbox growth) — queue-depth and oldest-age metrics; performance baselines deferred.

## 30. Deliverables

Backend foundation packages; the reference endpoint; API Conventions v0.1; error catalog v0.1;
event catalog v0.1; OpenAPI foundation v0.1; the backend test foundation; CI stages; observability
ports; the phase security note; and **DBCR-P1-13-001** with its implementing migration
`20260725090000_iam_shared_runtime_write_capabilities.sql`.

## 31. Definition of Ready

Satisfied — see the precondition report.

## 32. Definition of Done

Every task in fields 13 and 15–18 completed with its acceptance condition evidenced; all listed
test cases green in CI; conventions, catalogs, and the OpenAPI foundation registered; no
cross-cutting concern left that would force Phases 1-14 … 1-23 to invent a convention. **All tasks
remain unclaimed until evidenced — no completion is claimed in advance.**

## 33. Exit gate

Backend Foundation Gate — see [`phase-1-13-owner-gate.md`](./phase-1-13-owner-gate.md).

## 34. Documentation files to update

This phase directory; `docs/standards/`; `docs/adr/`; `docs/api/`; `docs/testing/`;
`docs/database/change-requests/`. The canonical Word documents are updated administratively
post-merge under the synchronization policy — a pending synchronization blocks nothing.

## 35. Approval owner

RootLco founders (Product Owner), with technical sign-off by the Architect and Security lead.

---

## 36. Synchronization — additional approved cross-cutting principles

Recorded here rather than by rewriting the canonical fields above.

### 36.1 What is a port, not a platform

Three items are delivered as **contracts with a development/test transport**, because no
environment beyond Local exists (ADR-012) and provisioning one is not this phase's scope. Each is
labelled as such wherever it appears:

| Item             | Delivered                                                           | Not delivered                                       |
| ---------------- | ------------------------------------------------------------------- | --------------------------------------------------- |
| Error monitoring | Capture boundary, sanitisation, correlation, recording transport    | A hosted monitoring platform, DSN, or alert routing |
| Metrics          | Instrument vocabulary, in-memory recorder, gauges and histograms    | An exporter or a metrics backend                    |
| Worker runtime   | Loop, bounded batches and concurrency, graceful shutdown, readiness | A scheduler, a process supervisor, or a dashboard   |

### 36.2 Principles implemented in this phase

Observability (correlation lifecycle, structured logging, redaction, metrics vocabulary, health
and readiness, trace-context readiness); scalability (stateless handlers, bounded pools/batches/
concurrency, full-jitter backoff, graceful shutdown, explicit timeouts); caching (contract, key
factory, eligibility matrix, stampede protection, invalidation ownership); rate limiting
(multi-dimensional keys, trusted-proxy resolution, distributed-store contract, deterministic
clock); indexing governance (mandatory tenant predicates, deterministic cursor ordering, bounded
pages, parameterised values); queue processing (transactional outbox, at-least-once, consumer
idempotency, dead-letter, replay). Each has a standard under `docs/standards/`.

### 36.3 Principles deliberately deferred, with an ADR

Load-balancer provisioning (ADR-015), CDN provisioning (ADR-016), read replicas (ADR-017),
sharding (ADR-018), and consistent hashing (a section of ADR-014). The consistency model itself is
recorded per subsystem in ADR-014 rather than as a single CAP label for the platform.
