# Phase 1-13 — Traceability Matrix

**Phase:** P1-13 — Backend Architecture and Shared Application Foundation ·
**Date:** 2026-07-21 · **Owner:** Eng. Ezzaldeen Al-Bitar (owner-authorized technical self-review).

Every requirement, business rule, and test case mapped to the artefact that implements it and the
evidence that demonstrates it. **A row is only marked PASS when a named test or a recorded command
output exists.** Rows whose evidence is a runtime behaviour blocked by
[`DBCR-P1-13-001`](../../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)
say so explicitly rather than claiming a result that was not observed.

---

## 1. Functional requirements

| Ref        | Requirement                                                                            | Implementation                                                              | Evidence                                                                                               | Status                                                          |
| ---------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| FR-IAM-002 | Server-side scope resolution; client-supplied scope never trusted                      | `src/server/context/resolve-context.ts` (`resolveScopeFor`, `narrowScope`)  | `tests/backend/context-spoofing.test.ts`                                                               | See §5                                                          |
| FR-AUD-001 | Privileged/approval/financial/export/security operations emit exactly one audit record | `src/server/audit/audit.ts`, `defineOperation({ auditClass, auditAction })` | `tests/backend/transaction.test.ts`; registry refusal in `tests/foundation/operation-registry.test.ts` | See §5 · runtime write blocked by DBCR-P1-13-001 (fails closed) |
| FR-INT-001 | Domain events published through the transactional outbox                               | `src/server/events/publisher.ts`, `envelope.ts`                             | `tests/backend/transaction.test.ts`, `tests/backend/outbox-worker.test.ts`                             | See §5 · runtime write blocked by DBCR-P1-13-001                |
| FR-INT-002 | Idempotent critical commands                                                           | `src/server/http/idempotency.ts`                                            | `tests/backend/idempotency.test.ts`                                                                    | See §5 · runtime write blocked by DBCR-P1-13-001                |
| FR-TEN-002 | Feature entitlement per tenant                                                         | `src/server/auth/entitlement.ts`                                            | `tests/backend/authorization.test.ts`                                                                  | See §5                                                          |
| FR-PLT-004 | Platform health posture                                                                | `src/server/health/readiness.ts`, `GET /api/v1/meta/ping`                   | `tests/backend/api-ping.test.ts`                                                                       | See §5                                                          |

## 2. Business rules

| Ref        | Rule                                                                      | Implementation                                                                                      | Evidence                                                                              | Status |
| ---------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ |
| BR-INT-001 | An event exists only if its source transaction committed                  | One transaction for state + history + audit + outbox (`withTransaction`)                            | Failure-injection test in `tests/backend/transaction.test.ts`                         | See §5 |
| BR-INT-002 | A consumer records the event id before a non-idempotent effect            | `runConsumer` writes `shared.processed_events` in the same transaction as the effect                | `tests/backend/outbox-worker.test.ts`                                                 | See §5 |
| BR-IAM-001 | Deny takes precedence over allow                                          | Evaluated in `iam.has_permission` / `iam.has_permission_in_scope`; not re-implemented in TypeScript | `tests/backend/authorization.test.ts`                                                 | See §5 |
| BR-TEN-001 | Entitlement evaluated at command time                                     | `requireFeature(db, flag, at)` defaults `at` to `context.startedAt`                                 | `tests/backend/authorization.test.ts`                                                 | See §5 |
| NEW        | Every operation declares permission codes and audit class at registration | `defineOperation()` refusal + `scripts/check-authorization-coverage.mjs`                            | `tests/foundation/operation-registry.test.ts`; CI step "Authorization coverage check" | See §5 |

## 3. Non-functional requirements

| Ref                       | Requirement                             | Position in P1-13                                                                                                                                                                                             |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-SEC (isolation)       | Tenant isolation through the full stack | Server-resolved context, transaction-local `set_config`, RLS default-deny, repository context guard. Evidenced by the backend suite.                                                                          |
| NFR-SEC (authorization)   | No unguarded operation                  | Registry refusal + CI coverage gate.                                                                                                                                                                          |
| NFR-SEC (secrets)         | No secret in code, logs, or spec        | Two-layer redaction; `npm run security:all` over the tracked tree.                                                                                                                                            |
| NFR-MNT (maintainability) | One shared convention set               | Module boundaries B1–B7, layering, error catalog, OpenAPI generated from the registry.                                                                                                                        |
| **NFR-SCL**               | Scale and capacity targets              | **UNRESOLVED — P1-OD-027.** Every limit is a proposed validation baseline. No production capacity, throughput, latency, failover, replica, CDN, or load-balancer behaviour is claimed anywhere in this phase. |
| NFR-PER                   | Performance targets                     | **Not measured in this phase.** No performance baseline is asserted; the phase delivers no business endpoint to measure.                                                                                      |

## 4. Test cases

| Test case               | Covers                                                    | Location                                                                                            |
| ----------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| TC-P1-13-001            | Module-boundary enforcement; a deliberate violation fails | `tests/foundation/module-boundaries.test.ts` + CI step                                              |
| TC-P1-13-002            | Context resolution and scope spoofing                     | `tests/backend/context-and-rls.test.ts`, `context-spoofing.test.ts`                                 |
| TC-P1-13-003            | Authorization coverage                                    | `tests/foundation/operation-registry.test.ts` + `scripts/check-authorization-coverage.mjs`          |
| TC-P1-13-004            | Validation and error-model conformance                    | `tests/foundation/validation.test.ts`, `error-model.test.ts`                                        |
| TC-P1-13-005            | Logging, correlation, monitoring trace                    | `tests/foundation/correlation.test.ts`, `logger.test.ts`, `monitoring.test.ts`, `redaction.test.ts` |
| TC-P1-13-006            | Transaction all-or-nothing                                | `tests/backend/transaction.test.ts`                                                                 |
| TC-P1-13-007            | OpenAPI contract conformance                              | `tests/openapi-contract.test.ts` + `scripts/check-openapi.mjs`                                      |
| TC-P1-13-008            | Test-foundation self-check                                | `vitest.config.backend.ts` + `tests/backend/helpers.ts`                                             |
| TC-P1-13-009            | Rate-limit and abuse cases                                | `tests/foundation/rate-limit.test.ts`, `trusted-proxy.test.ts`                                      |
| TC-IAM-001 / TC-RLS-001 | Authorization and isolation through the stack             | `tests/backend/authorization.test.ts`, `context-and-rls.test.ts`                                    |
| TC-INT-001 / TC-CON-001 | Idempotency, outbox, concurrency                          | `tests/backend/idempotency.test.ts`, `outbox-worker.test.ts`                                        |
| TC-AUD-001              | Audit emission                                            | `tests/backend/transaction.test.ts`                                                                 |
| TC-TEN-001              | Entitlement                                               | `tests/backend/authorization.test.ts`                                                               |

## 5. Status reporting rule

Statuses in the tables above are filled from the **final recorded run** on the exact feature SHA
that hosted CI validated, and from no earlier run. Until that run exists, a row reads
"See §5" rather than PASS. This is deliberate: a matrix that claims PASS before the run is a
matrix nobody can trust afterwards.

## 6. Deliberate coverage gaps, stated

| Area                                            | Why there is no evidence, and what would produce it                                                                                                                                                                                                                    |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Production observability pipeline               | No environment beyond Local (ADR-012). Evidence requires a provisioned platform, which is deployment work.                                                                                                                                                             |
| Load balancer, CDN, replica, sharding behaviour | Not provisioned and not claimed. ADR-015 … ADR-018 record the requirements a future implementation must satisfy.                                                                                                                                                       |
| Performance and capacity                        | P1-OD-027 unresolved; the phase delivers no business endpoint whose performance would be meaningful.                                                                                                                                                                   |
| Audit/outbox/idempotency **runtime** writes     | Blocked by DBCR-P1-13-001. Application behaviour is exercised against a test-only rehearsal role carrying the proposed grant set, and the gap itself is asserted against the real `app_runtime` archetype. Both facts are reported; neither is presented as the other. |
