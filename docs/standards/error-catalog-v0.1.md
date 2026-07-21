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

| Code            | Title                       | HTTP | Owner         | Retryable | Class    | Description                                                                                                                                                         |
| --------------- | --------------------------- | ---- | ------------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ERR-REQ-001** | Malformed request           | 400  | request       | No        | client   | The request could not be read: unparseable body, unsupported content type, or a header that violates its contract.                                                  |
| **ERR-REQ-002** | Unsupported API version     | 404  | request       | No        | client   | The requested API version segment is not served by this deployment.                                                                                                 |
| **ERR-VAL-001** | Request validation failed   | 422  | validation    | No        | client   | Boundary validation rejected the request. Field-level violations are returned with stable Zod issue codes and paths; submitted values are never echoed.             |
| **ERR-PAG-001** | Invalid pagination cursor   | 400  | validation    | No        | client   | The opaque cursor is malformed, truncated, or was issued for a different ordering contract.                                                                         |
| **ERR-IAM-001** | Not permitted               | 403  | authorization | No        | security | Server-side authorization denied the operation (BR-IAM-001, deny precedence). Uniform denial: the response never reveals whether the target resource exists.        |
| **ERR-IAM-002** | Authentication required     | 401  | authorization | No        | security | No authenticated principal could be resolved for the request.                                                                                                       |
| **ERR-TEN-001** | Feature not enabled         | 403  | entitlement   | No        | security | The resolved tenant is not entitled to the feature required by this operation, evaluated against the entitlement effective at command time (BR-TEN-001).            |
| **ERR-CTX-001** | Request context unavailable | 500  | context       | No        | server   | A controlled data-access call was attempted without a resolved request context. An internal invariant violation: it fails closed and is never surfaced with detail. |
| **ERR-RES-001** | Resource not found          | 404  | resource      | No        | client   | The addressed resource does not exist within the resolved scope. Indistinguishable from "exists but out of scope" by design.                                        |
| **ERR-INT-001** | Idempotency key conflict    | 409  | idempotency   | No        | conflict | The idempotency key was already used for a request with a different fingerprint. Re-using a key with different content is always rejected (FR-INT-002).             |
| **ERR-INT-002** | Idempotency key required    | 400  | idempotency   | No        | client   | The operation is declared idempotency-critical and the `Idempotency-Key` header was absent or violated its format contract.                                         |
| **ERR-CON-001** | Record version conflict     | 409  | concurrency   | **Yes**   | conflict | Optimistic concurrency rejected the write: the supplied record version is not the current one. Re-read and retry.                                                   |
| **ERR-CON-002** | Record version required     | 428  | concurrency   | No        | client   | The operation is declared version-guarded and the `If-Match` header was absent or malformed.                                                                        |
| **ERR-RTE-001** | Too many requests           | 429  | throttling    | **Yes**   | throttle | A configured rate limit was exceeded. The response carries `Retry-After`; abuse-relevant breaches are security-event candidates.                                    |
| **ERR-STB-001** | Not implemented             | 501  | stub          | No        | client   | A contract-only foundation service (file, notification) was invoked. The interface is frozen in P1-13; behaviour lands in the phase that owns it.                   |
| **ERR-SYS-001** | Unexpected error            | 500  | platform      | **Yes**   | server   | Fallback for an unclassified fault. The caller receives the correlation ID and nothing else; the cause is logged and sent to error monitoring.                      |

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
