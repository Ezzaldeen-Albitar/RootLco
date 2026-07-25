# Phase 1-15 — Binding implementation decisions

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit.**

---

## 1. Why this record exists

Several P1-15 planning instructions conflict with contracts that are **already frozen** in protected
history. Each conflict is resolved here in favour of the protected contract, with the evidence that
settled it, so the resolution is reviewable rather than silent. Every fact below was verified
first-hand against the merged tree or the live database — not inferred from planning prose.

## 2. Conflicts resolved in favour of the protected contract

### 2.1 VIN normalization — the planned rules contradict the frozen function

`veh.normalize_vin(text)` is `IMMUTABLE`, `SET search_path = ''`, and reads verbatim:

```sql
SELECT NULLIF(regexp_replace(upper(btrim(COALESCE(p_value, ''))), '[^A-Z0-9]', '', 'g'), '')
```

Behaviour proven against the live database:

| Input                  | Output                                                |
| ---------------------- | ----------------------------------------------------- |
| `'  wp0zzz9 8s1k303 '` | `WP0ZZZ98S1K303`                                      |
| `'iooq1234567890abc'`  | `IOOQ1234567890ABC` — **`I`, `O`, `Q` are preserved** |

The planning text asks for invalid-character rejection, length semantics, and check-digit validation.
**The frozen function does none of those**, and `veh.vehicles` carries a _generated_ column derived
from it, so a stricter TypeScript mirror would disagree with stored data and with
[the VIN normalization contract](../phase-1-7/veh-vin-normalization-contract.md).

**Decision.** The P1-15 `normalizeVin()` mirrors the SQL exactly — trim, uppercase, strip non
`[A-Z0-9]`, empty becomes `null`, and `I`/`O`/`Q` are never rewritten. Validity is reported as a
**separate, non-mutating** result field so a caller can surface "this does not look like a 17-character
VIN" without the normalizer ever silently repairing input. Equivalence with the SQL is proven by a
differential test that runs both implementations over the same corpus.

### 2.2 Phone normalization — two frozen edge cases must be preserved

`crm.normalize_phone(text)` keeps a single leading `+` only when the trimmed input starts with `+`,
then appends every ASCII `[0-9]` digit found in the **untrimmed** input.

| Input                  | Output          | Note                                   |
| ---------------------- | --------------- | -------------------------------------- |
| `'+962 7 9012 3456'`   | `+962790123456` |                                        |
| `'+'`                  | `'+'`           | **not `NULL`** — a lone plus survives  |
| `'٠٧٩'` (Arabic-Indic) | `NULL`          | non-ASCII digits are stripped entirely |

**Decision.** The TypeScript mirror reproduces both edge cases exactly, including the lone `+`. The
Arabic-Indic behaviour is a **real limitation of the frozen contract**, recorded as such rather than
"fixed" in the mirror — changing it is a database change with its own change request. Ambiguous
national numbers without a region are rejected at the _service_ layer, which is new behaviour layered
on top of the frozen normalizer and does not alter it. **No default country is assumed.**

### 2.3 Email normalization

`crm.normalize_email(text)` is trim + lowercase only: `'  A.B+Tag@X.COM  '` → `a.b+tag@x.com`. Dots
and `+tags` are **preserved**. No P1-15 code may strip either.

### 2.4 The health endpoint already exists

`/api/health` exists at `src/app/api/health/route.ts`, is asserted by `tests/health.test.ts` to return
**exactly seven keys** (`commit`, `configured`, `environment`, `service`, `status`, `timestamp`,
`version`), and is the container healthcheck in `docker-compose.yml` (`curl -fsS .../api/health`,
where `-fsS` fails on any non-2xx).

**Decision.** `/api/health` is **not modified**. P1-15 adds its liveness and readiness endpoints at
**new** `/api/v1/health/...` paths, registered through `defineOperation()` so the authorization-coverage
checker reconciles them. The existing route keeps its shape and its 200 contract.

### 2.5 Audit actions and error codes must be extended, not invented at the call site

The controlled catalog holds **26** audit action codes and **none** are shared-service codes. An
operation's declared `auditClass` must equal the catalog entry's `class` or `defineOperation()` throws
at module load. The error catalog holds **18** codes.

**Decision.** Every audit action P1-15 records is added to `AUDIT_ACTIONS` first, with the correct
class and `entityType`. For errors, P1-15 **reuses** the existing codes wherever one fits —
`ERR-RES-001` (not found), `ERR-RES-002` (conflict/duplicate), `ERR-CON-001` (stale version),
`ERR-CON-002` (version guard required), `ERR-INT-002` (idempotency guard), `ERR-VAL-001` (validation),
`ERR-IAM-001/002` (authorization/authentication), `ERR-DEP-001` (dependency failure) — and registers a
new code only where no existing class of failure fits.

### 2.6 Number allocation stays an in-process transactional service

[The Number Sequence and Display Number Standard](../../database/number-sequence-standard.md) binds
allocation to _the same transaction as the business write that consumes the number_ (rule 5), and
`shared.next_display_number` takes **no tenant parameter** — the tenant comes only from
`iam.current_tenant_id()`.

**Decision.** The primary contract is an **in-process application service that accepts an existing
`DbHandle`**, so later modules allocate inside their own transaction. The planning label
`POST /api/v1/numbers:allocate` is **not implemented**: it is rejected by the operation registry's path
grammar (no colon), and a standalone endpoint would commit a number that no business row consumes,
producing a business-level gap while appearing to promise gaplessness. Committed allocations are
gapless; that guarantee is only claimed where it is true.

### 2.7 Status transitions compose module-owned histories

`shared.status_history` / `shared.status_evidence` remain **unwritable by every application role**
(DBCR-P1-15-001). The transition engine therefore drives each module's own scope-bound,
coherence-guarded history table. There is no generic writable workflow store and no client-defined
transition graph.

### 2.8 Document acceptance remains unavailable

No role may write `shared.file_scan_results`, and
`shared.guard_document_version_transition` accepts a version as `accepted` only with a `clean` scan row.
**No scanner exists in this phase and none is claimed.** P1-15 delivers metadata creation, upload
authorization, pre-acceptance version lifecycle, linking, rejection, and download authorization for
eligible states. Acceptance is an explicit follow-on.

## 3. Foundation rules P1-15 composes rather than replaces

- **Context is explicit-argument-only.** A service takes `db: DbHandle` and reads
  `db.context.principal.tenantId` / `.userId`, `db.context.correlationId`, `db.context.causationId`.
  There is no ambient context. `RequestContext` has **no** top-level `tenantId`/`userId` —
  `context.tenantId` is `undefined`.
- **Audit and events read identity from the handle.** `appendAudit` and the event envelope take no
  tenant/actor/correlation parameters; supplying them is impossible by type.
- **Every endpoint goes through `handleOperation`.** No second pipeline. Handlers validate, delegate,
  and return; they never import `server/db`, `server/events`, `server/audit`, or `server/worker`
  (boundary rule B4).
- **Repositories extend `Repository`** and issue SQL only through `this.run()/runOne()` with bound
  parameters, always carrying an explicit tenant predicate in addition to RLS.
- **Pagination extends `src/server/db/pagination.ts`** (`pageRequest`, `keysetFragment`, `buildPage`)
  with a total order of `(sortValue, id)`. The cursor is **not** a security boundary — it is unsigned
  base64url JSON, so no authorization decision may ever be carried in it.
- **Logging uses `@/server/observability/logger`** (boundary rule B7 fails the build otherwise), and
  metrics are added as keys in the existing `METRICS` object rather than through a new framework.

## 4. Redaction hazard, and how P1-15 avoids it

`src/server/observability/redaction.ts` matches secret key fragments as **case-insensitive
substrings**, including `key`, `auth`, `session`, `signature`, and `token`. Natural P1-15 field names
such as `storageKey`, `dedupeKey`, `idempotencyKey`, and `objectKey` would therefore be silently
replaced with `[REDACTED]` in structured logs.

**Decision.** This is treated as correct-by-default and worked _with_, not around: P1-15 never logs a
signed URL, object key, or dedupe key as a value, and log fields use names that describe the fact
rather than carry the secret (for example `hasStorageKey: true`, `attachmentRef` as an opaque id, or a
digest). No redaction rule is weakened to make a P1-15 log line more readable.
