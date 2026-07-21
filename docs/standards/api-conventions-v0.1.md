# API Conventions v0.1

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Binding standard — API contract version `0.1.0`, applies to every HTTP surface from Phase 1-13 onward ·
**Date:** 2026-07-21 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Standing Technical Authorization Policy](../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
owner-authorized technical self-review, never an independent third-party audit) ·
**Task IDs:** P1-13-BE-006, P1-13-BE-007, P1-13-BE-012, P1-13-BE-013, P1-13-BE-020, P1-13-BE-021 ·
**Related:** [Backend Architecture and Shared Foundation](./backend-architecture-and-shared-foundation.md) ·
[Error Catalog v0.1](./error-catalog-v0.1.md) ·
[Observability Standard](./observability-standard.md) ·
[Cache Eligibility and Invalidation](./cache-eligibility-and-invalidation.md) ·
[Rate-Limiting Standard](./rate-limiting-standard.md) ·
[Secure Coding Standard](../security/secure-coding-standard.md) ·
Generated contract: [`docs/api/openapi.v1.json`](../api/openapi.v1.json)

---

## 1. Scope and status

These conventions are binding on every HTTP surface in this repository. They are implemented in
`src/server/http/`, `src/server/db/pagination.ts`, `src/server/db/concurrency.ts`,
`src/server/errors/`, and `src/server/openapi/document.ts`.

Phase 1-13 delivers **one** endpoint — `GET /api/v1/meta/ping`, the reference exemplar. It carries
no business data: it reports the caller's own resolved scope and nothing else. Every rule below is
implemented in the shared pipeline that endpoint exercises, and applies to every endpoint later
phases add.

The API contract version (`API_CONTRACT_VERSION`, currently `0.1.0`) is bumped when the _contract_
changes, independently of the application version.

## 2. Versioning and the URL space

- All endpoints live under **`/api/v1`**. `scripts/check-openapi.mjs` fails the build on any path
  outside that prefix.
- The version is in the path, not in a header or a media type. A path version is visible in every
  log line, every proxy rule, and every bug report without needing to inspect request metadata.
- An unsupported version segment is `ERR-REQ-002` (404), not a 400: the resource genuinely is not
  served by this deployment.
- Paths are lower-case, hyphen-separated, and may carry `{braced}` parameters. The operation
  registry rejects anything else at import time.
- `servers` in the generated document is `/` — same origin. **No public base URL is provisioned**
  (ADR-012).

## 3. Boundary validation

Zod parses params, query, and body at the edge (`src/server/http/validation.ts`). Nothing unparsed
reaches an application service, so a service can state its input type and mean it.

| Input                         | Helper                                     | Failure             |
| ----------------------------- | ------------------------------------------ | ------------------- |
| JSON body, wrong content type | `parseJsonBody()`                          | `ERR-REQ-001` (400) |
| JSON body, unparseable        | `parseJsonBody()`                          | `ERR-REQ-001` (400) |
| JSON body, schema violation   | `parseJsonBody()` → `parseOrFail()`        | `ERR-VAL-001` (422) |
| Query string                  | `searchParamsToObject()` → `parseOrFail()` | `ERR-VAL-001` (422) |
| Route params                  | `parseOrFail()`                            | `ERR-VAL-001` (422) |

The distinction between `ERR-REQ-001` and `ERR-VAL-001` matters to a client: the second can be
fixed by changing a field, the first only by fixing the encoder.

**Validation errors return path plus a stable machine rule code, never the submitted value.**
`toViolations()` maps each Zod issue to `{ path, rule }`, where `rule` is Zod's stable issue code
(`invalid_type`, `too_small`, …). Validation errors are the most frequently logged and most
frequently displayed error class; echoing input is how a password typed into the wrong field ends
up in a log index and on a screen.

Shared scalar schemas live in `schemas` so that "what is a money value" has exactly one answer
across eleven backend phases.

## 4. Money

Money crosses the API as **a decimal string plus an ISO-4217 alphabetic code**, never a JSON
number.

```json
{ "amount": "1234.500", "currency": "JOD" }
```

| Field      | Contract                                      |
| ---------- | --------------------------------------------- |
| `amount`   | `^-?\d{1,15}(\.\d{1,6})?$` — a decimal string |
| `currency` | `^[A-Z]{3}$` — ISO-4217 alphabetic code       |

**Why never a JSON number.** A JSON number is parsed into an IEEE-754 double by essentially every
client. IEEE-754 cannot represent `0.1` exactly, so a value that is exact in the database becomes
approximate the moment it is parsed, and the error compounds across additions. The database stores
exact `numeric`; a string crosses the boundary losslessly and forces every consumer to choose a
decimal library deliberately rather than to discover the problem in a reconciliation. This is the
API-boundary form of secure-coding rule R5 (never floating-point money).

**Why the scale is not fixed in the schema.** Minor units differ by currency
(`shared.currencies.minor_unit`: USD 2, JOD 3). The boundary bounds the shape; the domain
validates the scale against the currency it is working in.

## 5. Pagination

Offset pagination is **not offered**. At page 500 it makes the database count 500 pages of rows it
will discard, and it silently skips or repeats rows when the underlying set changes between
requests. Cursor pagination costs one indexed seek regardless of depth and is stable under
concurrent inserts.

| Parameter | Contract                                          |
| --------- | ------------------------------------------------- |
| `limit`   | Positive integer. Default **50**, maximum **100** |
| `cursor`  | Opaque string, 1–512 characters                   |

A `limit` above the maximum is **clamped, not rejected**: a client asking for 1000 receives 100
and a `hasMore` flag, which is more useful than an error and equally bounded. A non-integer or
non-positive `limit` is `ERR-VAL-001`.

**Total order.** The sort key is always `(sortValue, id)`, with `id` as the tie-breaker, and every
page request declares an `OrderingContract` (a stable key plus a direction). Without the
tie-breaker, two rows sharing a timestamp can straddle a page edge and be shown twice or never.
`keysetFragment()` emits a row-value comparison — `(sort, id) < ($n, $n+1)` for descending — which
gives correct keyset semantics in one predicate and lets PostgreSQL use the composite index
directly. One extra row is fetched to detect `hasMore` without a second `COUNT`.

**The cursor is opaque but is not a security boundary.** It is base64url-encoded JSON — not
encrypted, not signed — and this is stated rather than implied. Its integrity is not what protects
data: every query it feeds still runs under the caller's context and RLS, so a forged cursor can
at worst produce a wrong page, never another tenant's rows. A cursor that does not decode, has the
wrong shape, or was issued for a different ordering contract is `ERR-PAG-001` (400); re-using a
cursor across orderings would otherwise silently produce a wrong page.

Response envelope (`PageEnvelope` in the generated document):

```json
{ "items": [], "nextCursor": null, "hasMore": false }
```

## 6. Idempotency

An operation declared `idempotent: true` in the registry **requires** an `Idempotency-Key` header.

| Rule                 | Contract                                                              |
| -------------------- | --------------------------------------------------------------------- |
| Header               | `Idempotency-Key`                                                     |
| Length               | 8–200 characters after trimming; anything else is `ERR-INT-002` (400) |
| Absent when required | `ERR-INT-002` (400)                                                   |
| Scope                | Unique per `(tenant_id, operation, idempotency_key)`                  |
| Fingerprint          | SHA-256 over `METHOD`, path, and the canonicalised body               |

The header is validated against the database contract **before** the request runs, so a key that
could never be stored fails immediately with a clear code rather than as a constraint violation
after the work is done.

Three cases:

| Case                              | Behaviour                                                                                                                                                                                                                                                             |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Replay, same fingerprint**      | The stored response document is returned without re-executing. The command already happened; running it again is the bug the header exists to prevent.                                                                                                                |
| **Replay, different fingerprint** | `ERR-INT-001` (409). The client reused a key by mistake, or an attacker is grafting a new command onto a trusted key. Executing either version would be wrong, so neither runs.                                                                                       |
| **Concurrent first use**          | The unique index decides. Both callers insert; one wins, the loser catches `23505`, and its transaction — which committed nothing — is retried once on a fresh transaction to read the winner's stored response. Exactly one execution, no advisory lock, no polling. |

The fingerprint is computed over a **canonical** JSON form (object keys sorted at every depth), so
key reuse is detected by content rather than by byte-identical formatting.

The reservation row is written **inside the caller's transaction**, so a key is durable if and only
if the command it guards committed.

> **Status today.** `shared.idempotency_keys` is not writable by the runtime role
> ([DBCR-P1-13-001](../database/change-requests/DBCR-P1-13-001-backend-runtime-write-grants.md)),
> so an idempotency-critical operation is **refused** rather than executed unguarded. The
> capability gate reports this precisely; it does not degrade silently.

## 7. Optimistic concurrency, `If-Match`, and `ETag`

Every versioned table in the Release 2 schema carries `record_version integer NOT NULL DEFAULT 1`.

| Element              | Contract                                                                         |
| -------------------- | -------------------------------------------------------------------------------- |
| Request header       | `If-Match`, accepting a bare integer or the quoted ETag form `"7"` (and `W/"7"`) |
| Absent when required | `ERR-CON-002` (428 Precondition Required)                                        |
| Malformed            | `ERR-CON-002` (428)                                                              |
| Version mismatch     | `ERR-CON-001` (409), retryable — re-read and retry                               |
| Response header      | `ETag: "<record_version>"` on any response that reports a record version         |

The guarded update is one statement:

```sql
UPDATE …
   SET …, record_version = record_version + 1
 WHERE id = $1 AND tenant_id = $2 AND record_version = $3
```

The predicate and the increment are in the same statement, so there is no read-modify-write
window: two concurrent updaters with the same expected version cannot both succeed, and the
version increments exactly once per successful update. Zero affected rows always means conflict —
**never "not found"**, because a stale version and an out-of-scope row are deliberately
indistinguishable; reporting "wrong version" only when the row exists would leak existence.

## 8. Errors

Every failure is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document with media
type `application/problem+json`, so a client writes one error path instead of eleven.

```json
{
  "type": "urn:rootlco:error:ERR-VAL-001",
  "title": "Request validation failed",
  "status": 422,
  "code": "ERR-VAL-001",
  "correlationId": "…",
  "violations": [{ "path": "body.limit", "rule": "invalid_type" }]
}
```

| Field                 | Present when           | Notes                                                             |
| --------------------- | ---------------------- | ----------------------------------------------------------------- |
| `type`                | Always                 | `urn:rootlco:error:<CODE>` — a stable URN, not a live URL         |
| `title`               | Always                 | From the catalog. Human-readable, may change; do not branch on it |
| `status`              | Always                 | Duplicated in the body per RFC 9457                               |
| `code`                | Always                 | **The field clients branch on**                                   |
| `correlationId`       | Always                 | Same value as the `x-correlation-id` response header              |
| `violations`          | Validation failures    | `{ path, rule }` only — never the submitted value                 |
| `retryAfterSeconds`   | Throttling             | Mirrored in the `Retry-After` header                              |
| `contract`            | Contract-only stubs    | Name of the not-yet-implemented service                           |
| `requiredPermissions` | Authorization failures | Documented API metadata; the _resource_ is never named            |

`type` is a URN rather than a URL because no documentation host is provisioned (ADR-012), and
publishing a URL that 404s is worse than publishing a stable identifier.

The document is assembled **only** from the catalog entry plus the failure's `safeDetails`. No
other field of the thrown error is readable by the renderer, which is what makes "no stack traces,
no SQL fragments, no internal identifiers" a structural property rather than a review promise. See
the [Error Catalog](./error-catalog-v0.1.md) for the full code list and the registration process.

## 9. Correlation

Every response — success or failure — carries **`x-correlation-id`**.

- A client may propose one via the same request header. It is accepted **only** if it is a
  syntactically valid UUID; anything else is discarded and replaced with a freshly generated ID,
  and the rejection is logged.
- An invalid proposal is **never echoed back**. Echoing unvalidated input is how log forging and
  header injection start.
- `x-causation-id` may also be supplied. Unlike the correlation ID there is no fallback: an absent
  or invalid causation ID is simply absent, because inventing a causal ancestor would be a lie in
  the event envelope.

Details in the [Observability Standard](./observability-standard.md).

## 10. Caching of API responses

Successful authenticated responses are sent with:

```http
Cache-Control: no-store, private
```

This is the default for authenticated API data and is applied by the pipeline, not by individual
handlers. Failure responses carry `Cache-Control: no-store`.

`no-store` prevents any cache from retaining the representation; `private` additionally forbids a
shared cache from treating it as reusable. Authenticated business data is scoped to a tenant, a
user, and a set of companies and branches — none of which appear in the URL — so any shared cache
keying on URL alone would be capable of serving one caller's data to another. The
[CDN readiness ADR](../adr/ADR-016-cdn-readiness.md) depends on this default holding.

Per-response caching for genuinely public, stale-tolerant assets is a separate decision made in
that ADR. Server-side caching of data is governed by the
[Cache Eligibility and Invalidation standard](./cache-eligibility-and-invalidation.md).

## 11. Response headers summary

| Header             | On                                         | Value                                  |
| ------------------ | ------------------------------------------ | -------------------------------------- |
| `Content-Type`     | Success                                    | `application/json`                     |
| `Content-Type`     | Failure                                    | `application/problem+json`             |
| `x-correlation-id` | Every response                             | UUID                                   |
| `Cache-Control`    | Success                                    | `no-store, private`                    |
| `Cache-Control`    | Failure                                    | `no-store`                             |
| `ETag`             | Responses reporting a record version       | `"<record_version>"`                   |
| `Retry-After`      | Throttled and other retry-bearing failures | Seconds, mirroring `retryAfterSeconds` |

## 12. The generated OpenAPI document

`docs/api/openapi.v1.json` is **generated from the operation registry**
(`src/server/openapi/document.ts`), never hand-written alongside it. A registered operation appears
automatically; an operation removed from the code disappears. Two gates protect it:

- `scripts/check-openapi.mjs` (`npm run validate:openapi`) — structural soundness: every `$ref`
  resolves, `operationId`s are unique, every operation declares `security` explicitly (`[]` for
  public, because an absent key would inherit a document default and that ambiguity is how an
  endpoint ships unauthenticated by accident), every operation declares
  `x-required-permissions`, every ≥ 400 response uses the shared problem component, and no path
  escapes `/api/v1`.
- `tests/openapi-contract.test.ts` — divergence: the committed document is compared against a fresh
  generation. A hand-edited document could be perfectly well-formed and still describe an endpoint
  that no longer exists, so neither gate replaces the other.

Machine-readable extensions carried per operation: `x-required-permissions`, `x-scope`,
`x-audit-class`, and — when declared — `x-feature-flag`, `x-rate-limit-policy`, `x-cache-category`.
They are the same declarations the runtime enforces, so a reviewer can diff intent against
behaviour.

The document's `info.title` uses the descriptive title. The product name is deliberately absent:
it is pending owner approval (ADR-011).

## 13. Review and governance

Nothing reached protected develop outside the approved pull-request and hosted-CI flow. The work
was reviewed under the Standing Technical Authorization and Solo Developer Review policies.

Owner: Eng. Ezzaldeen Al-Bitar. No independent third-party review, external audit, or separation of
duties exists or is claimed.
