# Error Catalog v0.1

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding standard — the registry of stable `ERR-` codes for every API surface from Phase 1-13 onward ·
**Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Task IDs:** P1-13-BE-007 ·
**Related:** [API Conventions v0.1](./api-conventions-v0.1.md) ·
[Backend Architecture and Shared Foundation](./backend-architecture-and-shared-foundation.md) ·
[Observability Standard](./observability-standard.md) ·
[Secure Coding Standard](../security/secure-coding-standard.md) ·
Implementation: [`src/server/errors/catalog.ts`](../../src/server/errors/catalog.ts),
[`src/server/errors/problem.ts`](../../src/server/errors/problem.ts),
[`src/server/errors/app-failure.ts`](../../src/server/errors/app-failure.ts)

---

## 1. The two rules that make this a registry rather than a list

**1. A code exists in `src/server/errors/catalog.ts` or it does not exist.** `ERROR_CODES` is a
`const` tuple and `ErrorCode` is its union, so a string that is not a registered code is a
compile-time error. `problemFor()` accepts only an `ErrorCode` and reads its definition from the
frozen registry, so an ad-hoc string cannot reach a response. Adding a code is a reviewable change
to one file, never a literal buried in a handler.

**2. `safeDetails` is the contract, not a suggestion.** `AppFailure` splits developer-facing
detail from caller-facing detail: `message` and `cause` go to logs and error monitoring only, and
`safeDetails` is the only structure a caller can see. `problemFor()` reads nothing else. No stack
trace, SQL fragment, internal identifier, or upstream driver message can be forwarded, because the
renderer has no access to them.

`retryable` is advisory — for clients and for failure classification — and never changes
authorization or transaction behaviour.

## 2. The catalog

Sixteen codes are registered. This table is the whole of `DEFINITIONS`.

| Code             | Title                                            | HTTP | Owner         | Retryable | Class    | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------- | ------------------------------------------------ | ---- | ------------- | --------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ERR-REQ-001**  | Malformed request                                | 400  | request       | No        | client   | The request could not be read: unparseable body, unsupported content type, or a header that violates its contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **ERR-REQ-002**  | Unsupported API version                          | 404  | request       | No        | client   | The requested API version segment is not served by this deployment.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **ERR-VAL-001**  | Request validation failed                        | 422  | validation    | No        | client   | Boundary validation rejected the request. Field-level violations are returned with stable Zod issue codes and paths; submitted values are never echoed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **ERR-PAG-001**  | Invalid pagination cursor                        | 400  | validation    | No        | client   | The opaque cursor is malformed, truncated, or was issued for a different ordering contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **ERR-IAM-001**  | Not permitted                                    | 403  | authorization | No        | security | Server-side authorization denied the operation (BR-IAM-001, deny precedence). Uniform denial: the response never reveals whether the target resource exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **ERR-IAM-002**  | Authentication required                          | 401  | authorization | No        | security | No authenticated principal could be resolved for the request.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **ERR-TEN-001**  | Feature not enabled                              | 403  | entitlement   | No        | security | The resolved tenant is not entitled to the feature required by this operation, evaluated against the entitlement effective at command time (BR-TEN-001).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **ERR-CTX-001**  | Request context unavailable                      | 500  | context       | No        | server   | A controlled data-access call was attempted without a resolved request context. An internal invariant violation: it fails closed and is never surfaced with detail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **ERR-RES-001**  | Resource not found                               | 404  | resource      | No        | client   | The addressed resource does not exist within the resolved scope. Indistinguishable from "exists but out of scope" by design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **ERR-INT-001**  | Idempotency key conflict                         | 409  | idempotency   | No        | conflict | The idempotency key was already used for a request with a different fingerprint. Re-using a key with different content is always rejected (FR-INT-002).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **ERR-INT-002**  | Idempotency key required                         | 400  | idempotency   | No        | client   | The operation is declared idempotency-critical and the `Idempotency-Key` header was absent or violated its format contract.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **ERR-INT-003**  | Idempotent request carries secret material       | 400  | idempotency   | No        | client   | The request is for an idempotency-critical operation and its body or route parameters carry a field whose name marks it as secret material. The idempotency fingerprint is a persisted SHA-256, so it is refused before anything is hashed (CWE-916). Client-classed deliberately: the fingerprint covers the raw pre-validation body, so any caller can put such a field there.                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **ERR-CON-001**  | Record version conflict                          | 409  | concurrency   | **Yes**   | conflict | Optimistic concurrency rejected the write: the supplied record version is not the current one. Re-read and retry.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **ERR-CON-002**  | Record version required                          | 428  | concurrency   | No        | client   | The operation is declared version-guarded and the `If-Match` header was absent or malformed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **ERR-RTE-001**  | Too many requests                                | 429  | throttling    | **Yes**   | throttle | A configured rate limit was exceeded. The response carries `Retry-After`; abuse-relevant breaches are security-event candidates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **ERR-STB-001**  | Not implemented                                  | 501  | stub          | No        | client   | A contract-only foundation service (file, notification) was invoked. The interface is frozen in P1-13; behaviour lands in the phase that owns it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **ERR-SYS-001**  | Unexpected error                                 | 500  | platform      | **Yes**   | server   | Fallback for an unclassified fault. The caller receives the correlation ID and nothing else; the cause is logged and sent to error monitoring.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **ERR-RES-002**  | Resource already exists                          | 409  | resource      | No        | conflict | The command would create a resource that already exists within the resolved scope. Used where the duplicate is safe to acknowledge — an invitation for an address already invited, a role code already taken. Never used on an authentication path, where acknowledging existence would be an enumeration oracle.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **ERR-DEP-001**  | Upstream dependency unavailable                  | 503  | platform      | Yes       | server   | A required external dependency — the authentication provider (P1-14), the object-storage provider, or the message-delivery provider (P1-15) — was unreachable, timed out, or returned a fault. The request performed no work and may be retried. The dependency is never named to the caller.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **ERR-DOC-001**  | Document version not available                   | 409  | attachment    | No        | conflict | The addressed document version exists and is visible to the caller, but its state does not permit the requested action — most often a download of a version that has not been accepted. Distinct from ERR-RES-001 on purpose: the caller already knows the version exists (they can see it), so reporting "not found" would be misleading rather than protective. No P1-15 path can move a version to accepted, because acceptance requires a clean scan record and no scanner exists (DBCR-P1-15-001 §withholdings).                                                                                                                                                                                                                                                                                          |
| **ERR-NTF-001**  | Recipient consent not granted                    | 409  | notification  | No        | conflict | The consent evaluation supplied with the queue request reported that the recipient has not granted consent for this channel, so nothing was enqueued. Neither an authorization failure (the caller may send) nor a validation failure (the request was well-formed): the request conflicts with the recipient’s recorded consent state, which only the recipient can change.                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **ERR-EXP-001**  | Export exceeds the permitted size                | 422  | export        | No        | client   | The requested export would return more rows than EXPORT_MAX_ROWS permits. A distinct code so a client can narrow its filters rather than retrying the same request; it is not a throttle and waiting does not help.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **ERR-TRN-001**  | Transition not permitted from the current state  | 409  | transition    | No        | conflict | The requested target state is registered for this aggregate, but the aggregate is not in a state the transition may start from — including the case where it is already in the target state. Distinct from ERR-CON-001, which means the caller held a stale record version: re-reading and retrying fixes a version conflict and cannot fix this one.                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **ERR-WO-001**   | Work order cannot be closed yet                  | 409  | transition    | No        | conflict | Closure was refused by wo.guard_work_order_closure (blockers B1..B6): a non-terminal job, a running labor session, an unresolved required additional-work request, a missing completed diagnostic, failed or missing mandatory quality control, or safety-critical rework without independent sign-off. Deliberately NOT ERR-TRN-001: the ready_to_close→closed edge exists in the graph and the aggregate is in a legal starting state, so this is not a graph refusal. The caller must clear a condition, not re-read a version or pick a different target.                                                                                                                                                                                                                                                  |
| **ERR-WO-002**   | Additional work awaits a customer decision       | 409  | transition    | No        | conflict | A job may not enter a state whose wo.job_states.labor_allowed is true while a REQUIRED additional-work request originating from it is still pending — work the customer has not yet authorised must not be started or resumed. Distinct from ERR-WO-001, which is the B1..B6 closure gate on the whole work order: this refuses one job movement, and only for requests naming that job as their origin. Deliberately NOT ERR-TRN-001, because the edge exists in the graph and the job is in a legal starting state; what blocks it is a sibling row. Pausing is never refused, so the job can wait in a state where labour is not allowed while the customer is asked. Approved-but-unfulfilled does NOT refuse execution: that is authorised work waiting to be done, and gating it would make it undoable. |
| **ERR-TECH-001** | Technician is not eligible for this assignment   | 422  | validation    | No        | client   | The named technician does not satisfy the job’s eligibility requirements: a missing or insufficient skill level, a missing or expired certification, no covering availability interval, an inactive profile, or an out-of-scope company/branch. A client error rather than a conflict because the request named the wrong technician; the same request will keep failing until a different technician is chosen or the underlying eligibility record changes.                                                                                                                                                                                                                                                                                                                                                  |
| **ERR-DIA-001**  | Diagnostic report has unresolved mandatory items | 409  | transition    | No        | conflict | Completion was refused because at least one mandatory item of the pinned template version has neither a recorded result nor a documented not-applicable reason. A conflict rather than a validation failure: the completion request itself is well-formed, and what blocks it is the accumulated state of the report.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **ERR-QMS-001**  | Quality or rework precondition not satisfied     | 409  | transition    | No        | conflict | Covers the QMS refusals that are not closure blockers: an attempt to reopen a closed work order (BR-WO-002 — recorded as a rejected attempt in qms.reopen_attempts and never mutating the order), and a rework resolution lacking the independent sign-off BR-QMS-001 requires for safety-critical work. Distinct from ERR-WO-001, which is specifically the B1..B6 closure gate.                                                                                                                                                                                                                                                                                                                                                                                                                              |

### 2.1 Field vocabularies

**`owner`** — the area that owns the code, for catalog navigation and ownership review:
`request`, `validation`, `authorization`, `entitlement`, `context`, `resource`, `idempotency`,
`concurrency`, `throttling`, `stub`, `platform`.

**`class`** — drives logging, audit, and security-event emission:

| Class      | Meaning                                                 | Handling                                                                                                           |
| ---------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `client`   | The caller sent something this deployment cannot accept | Logged at warn with the code; not sent to error monitoring                                                         |
| `security` | An authorization, authentication, or entitlement denial | **Security-event candidate.** Logged at warn with `result: 'denied'` and counted                                   |
| `conflict` | The request lost a race or contradicted stored state    | Logged at warn; the caller is expected to re-read                                                                  |
| `throttle` | A rate-limit policy was exceeded                        | Logged with `result: 'throttled'`; `Retry-After` is emitted; abuse-relevant policies are security-event candidates |
| `server`   | The platform failed                                     | Logged; sent to error monitoring when the status is ≥ 500                                                          |

**`retryable`** — may the _same_ request succeed later without modification? Only `ERR-CON-001`
(re-read the version and retry), `ERR-RTE-001` (wait out the window), and `ERR-SYS-001` (the fault
may be transient) are marked retryable.

### 2.2 Codes that deliberately reveal nothing

Four entries encode a disclosure decision, not merely a status:

- **`ERR-IAM-001`** is uniform. It never states whether the target resource exists. It _does_
  carry `requiredPermissions`, because permission codes are documented API metadata and telling a
  caller which permission they lack is a usability win with no information gain for an attacker.
  The resource is never named.
- **`ERR-RES-001`** and a resource that exists but is out of scope are the same answer, by design.
- **`ERR-CON-001`** is returned for both a stale version and an out-of-scope row: distinguishing
  them would leak existence.
- **`ERR-TEN-001`** does not name the flag. Flag codes are internal product shape and probing them
  is a documented abuse case (P1-13-SEC-005). The flag code is logged for operators, never
  returned.

### 2.3 `ERR-STB-001` is honest, not decorative

`ERR-STB-001` is returned by the contract-only `FileService` and `NotificationService` stubs. They
reject rather than returning an empty success: a "successful" no-op upload registration would let a
caller believe a document exists, which is a worse failure than a clear 501. The `contract` field
in the problem document names the service.

## 3. What a caller receives

Assembled by `problemFor()` from the catalog entry plus `safeDetails` — nothing else:

| Problem field         | Source                                            |
| --------------------- | ------------------------------------------------- |
| `type`                | `urn:rootlco:error:` + the code                   |
| `title`               | Catalog `title`                                   |
| `status`              | Catalog `status`                                  |
| `code`                | Catalog `code`                                    |
| `correlationId`       | The request's correlation ID                      |
| `violations`          | `safeDetails.violations` (validation only)        |
| `retryAfterSeconds`   | `safeDetails.retryAfterSeconds` (throttling only) |
| `contract`            | `safeDetails.contract` (stubs only)               |
| `requiredPermissions` | `safeDetails.requiredPermissions` (authorization) |

The catalog `description` column is **engineering documentation only**. It is never returned to a
caller.

## 4. Classifying an unknown throw

`toAppFailure()` converts anything that is not already an `AppFailure` into `ERR-SYS-001`, keeping
the original as `cause` for logging. An unclassified fault therefore never reaches a caller with
its own message — a driver error, a third-party exception, or a thrown non-Error value all become
the same opaque 500 plus a correlation ID.

## 5. Registration process

Adding a code is a change to `src/server/errors/catalog.ts` and to this document, in the same pull
request.

1. **Confirm no existing code fits.** Codes are for classes of failure, not for individual call
   sites. If two situations produce the same status, the same client action, and the same
   disclosure decision, they are one code.
2. **Choose the area prefix** — `REQ`, `VAL`, `PAG`, `IAM`, `TEN`, `CTX`, `RES`, `INT`, `CON`,
   `RTE`, `STB`, `SYS` — and take the next free sequence number in that prefix.
3. **Add the literal to `ERROR_CODES`.** The union is the compile-time gate; nothing works until
   the code is in the tuple.
4. **Add the definition to `DEFINITIONS`**, filling every field: `code`, `title`, `status`,
   `owner`, `retryable`, `class`, `description`.
5. **Decide the disclosure question explicitly.** Write down what the code reveals about existence,
   scope, and configuration. If the answer is "more than the request already established", change
   the code rather than the answer.
6. **Extend `SafeDetails` only if the code needs a new caller-visible field**, and extend
   `ProblemDocument` and the OpenAPI `ProblemDocument` schema in the same change. A field that is
   not in `SafeDetails` cannot be returned.
7. **Add the row to the table in §2** of this document.
8. **Run the gate:** `npm run validate:openapi` (the `code` enum in the generated document is
   derived from `allErrorDefinitions()`, so a missing catalog entry surfaces as a contract
   divergence) and `npm run gate:p1-13`.

### 5.1 Immutability rules

- **A code is never reused and never renumbered.** Clients and log queries branch on it.
- **A code's `status` and `class` are part of the contract.** Changing either is a contract change
  and requires an API contract version bump.
- **`title` is human-readable and may be improved.** Clients must branch on `code`, never on
  `title`; that is stated in the generated OpenAPI description of the field.
- **Retiring a code** means removing it from `ERROR_CODES` when nothing can return it, and marking
  the row in this document as retired with the date and the replacement. The number is not made
  available again.

### 5.2 The rule that makes the catalog enforceable

**An uncataloged code cannot be returned.** There is no code path from an arbitrary string to a
response body:

- `AppFailure`'s constructor takes an `ErrorCode`, not a `string`, and immediately resolves the
  definition — an unregistered code throws.
- `problemFor()` calls `errorDefinition()`, which throws for an unregistered code by design rather
  than falling back to a generic shape.
- `allErrorDefinitions()` feeds the `code` enum in the OpenAPI document, so the published contract
  and the registry cannot disagree without failing `npm run validate:openapi`.

A handler that wants to return "something like a 409" must register a code. That is the intended
friction.

## 6. Review and governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

Owner: Eng. Ezzaldeen Al-Bitar. No independent third-party review, external audit, or separation of
duties exists or is claimed.
