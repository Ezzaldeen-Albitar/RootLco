# Phase 1-15 — Query Primitives: bounded filtering, sorting, and query-bound cursors

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning ·
**Release group:** Release 3 — Backend Foundation ·
**Phase:** P1-15 — Shared Services Backend ·
**Date:** 2026-07-23 ·
**Prepared by:** Eng. Ezzaldeen Al-Bitar — owner-authorized technical self-review under the
[Standing Technical Authorization Policy](../../governance/standing-technical-authorization-policy.md)
and the [Solo Developer Review Policy](../../governance/solo-developer-review-policy.md).
**This is never represented as an independent third-party audit. The Phase 1-15 owner gate is
[Pending](phase-1-15-owner-gate.md).**

**Implementation:**
[`src/modules/shared-services/domain/query-primitives.ts`](../../../src/modules/shared-services/domain/query-primitives.ts) ·
**Foundation it extends:**
[`src/server/db/pagination.ts`](../../../src/server/db/pagination.ts) ·
**Evidence:**
[`tests/foundation/p1-15-query-primitives.test.ts`](../../../tests/foundation/p1-15-query-primitives.test.ts) ·
**Related:**
[Backend architecture and shared foundation](../../standards/backend-architecture-and-shared-foundation.md)

---

## 1. The shape this module makes unavailable

Every list endpoint eventually grows a filter parameter, and the shortest route from there to an
incident is one line:

```ts
`WHERE ${field} ${operator} '${value}'`;
```

The defence is not a rule in a review checklist — it is that the helper a route calls **cannot build
that string**. An operation declares a _contract_, and the builder emits SQL from the contract alone.
Caller input reaches the database only as a bound parameter, and never as identifier text.

## 2. The contract model

A `QueryContract` is a code-side declaration with four parts:

| Part          | Purpose                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `key`         | Stable ordering-contract prefix, for example `shared.documents`               |
| `filterable`  | The fields that may be filtered, each with its column, type, and operator set |
| `sortable`    | The fields that may be sorted — a **separate** list, not derived from filters |
| `defaultSort` | Applied when the caller names no sort                                         |
| `idColumn`    | The unique tie-breaker that makes the ordering total                          |

Each `FilterableField` carries a caller-visible `name`, a `column` expression, a declared `type`, the
`operators` it accepts, and an optional `sensitive` flag.

**The `name` never reaches SQL.** It is matched against the contract; on a match the _column
constant written in code_ is what is emitted, and on a miss the request is refused. The unrecognised
name is not quoted, not escaped, and not echoed back — it is simply never interpolated. The evidence
fixture gives every field a `name` that differs from its `column` on purpose, so "the caller-visible
name never reaches SQL" is falsifiable rather than a coincidence of naming.

Filterable and sortable are deliberately two lists. Sorting by a column is its own read oracle:
ordering a result set by a value you may not read still leaks its ordering. A field can therefore be
filterable without being sortable, and the evidence suite pins exactly that case.

## 3. Operators are declared per field, not globally

The operator set is `eq`, `neq`, `lt`, `lte`, `gt`, `gte`, `in`, `prefix`, and a field accepts only
the ones it lists. `prefix` on a UUID column is refused, so a caller cannot convert an indexed
equality into a scan by changing one query parameter. That is an availability control as much as a
security one: the contract author decides which access paths exist, and the decision is visible in
one place.

Values are validated against the field's declared type **before** binding:

| Type        | Accepted                                                               | Refusal rule               |
| ----------- | ---------------------------------------------------------------------- | -------------------------- |
| `uuid`      | RFC-shaped UUID string; lower-cased **as data**, never as spliced text | `invalid_uuid`             |
| `text`      | String no longer than `MAX_FILTER_TEXT_LENGTH`                         | `invalid_type`, `too_long` |
| `timestamp` | ISO-8601 date, optionally with time, fractional seconds, and offset    | `invalid_timestamp`        |
| `integer`   | A JavaScript integer — `1.5` is refused, not truncated                 | `invalid_integer`          |
| `boolean`   | A real boolean — the string `'true'` is refused                        | `invalid_boolean`          |

An `in` list is bound as a **single array parameter** with an explicit cast to the field's array
type (`uuid[]`, `bigint[]`, `timestamptz[]`, `boolean[]`, `text[]`). The consequence is worth stating
because it is the whole point: changing the length of an `in` list changes the _data_, never the SQL
text. A query with two values and a query with fifty produce byte-identical statements.

## 4. Everything is bounded

| Bound                            | Value | What an unbounded version would be                     |
| -------------------------------- | ----- | ------------------------------------------------------ |
| `MAX_FILTERS`                    | 8     | Arbitrary predicate stacking; planner time as a weapon |
| `MAX_IN_VALUES`                  | 50    | A denial-of-service with extra steps                   |
| `MAX_FILTER_TEXT_LENGTH`         | 200   | Unbounded comparison work per row                      |
| `DEFAULT_PAGE_SIZE` (foundation) | 50    | —                                                      |
| `MAX_PAGE_SIZE` (foundation)     | 100   | Deep pages fetched in one request                      |

The filter-count bound is checked **before any field is examined**, and reported at the path
`query.filter` rather than at a position: it protects the builder itself, not an individual filter.
An empty `in` list is refused rather than emitting a predicate that matches nothing — a query that
silently returns zero rows is harder to diagnose than one that says why.

Page size is _clamped_ rather than refused (a client asking for 1000 receives 100 and `hasMore`),
because there is no ambiguity about intent and an error would be less useful than a bounded answer.
Filter bounds are _refused_, because there is no correct smaller answer to substitute.

## 5. Two operators that do not exist

**There is no regex operator.** A caller-supplied pattern cannot be made safe against catastrophic
backtracking without either a regex engine with a step budget or an analysis pass over the pattern —
neither exists here, and both are the kind of control that is either complete or worthless. `prefix`
covers the legitimate "starts with" case at a bounded cost.

**There is no raw JSON path.** A path expression is an identifier in disguise: it names a location
the contract did not offer, inside a column the contract may not have exposed. Offering one would
re-introduce exactly the property the contract exists to remove.

Both absences are design decisions with names, not oversights. If either is ever needed, it arrives
as a declared, per-field capability in the contract — not as an escape hatch.

## 6. `prefix` cannot become a wildcard scan

A `prefix` filter emits:

```sql
AND <column> LIKE $n ESCAPE '\'
```

and binds `escapeLikePrefix(value) + '%'`. `escapeLikePrefix()` backslash-escapes `\`, `%` and `_`,
so `'100%'` binds as `'100\%%'` and `'fx_code'` binds as `'fx\_code%'`. The **only** unescaped
wildcard in the bound value is the trailing anchor the builder itself appends.

Without the escape, a caller submitting `%` would turn a prefix lookup into a full scan, and a caller
submitting `_` would obtain single-character wildcards for free. The evidence suite asserts this
positively (every metacharacter escaped) and with a negative control (the same assertion fails on an
unescaped value), so the check cannot pass vacuously.

The `ESCAPE '\'` clause is also the single quoted literal the builder is permitted to emit anywhere.
The suite asserts that property directly against the emitted SQL text: any other single-quoted
literal appearing in a predicate is a failure, which is what turns "we do not interpolate" from a
claim into a test.

## 7. Sensitive fields are refused, never silently dropped

A field marked `sensitive` requires `iam.sensitive.view` to be _filtered on_, resolved by the caller
and passed in as `mayReadSensitive` so the builder stays a pure function testable both ways without a
database.

Filtering is a read oracle. `?taxIdentifier.prefix=1` … `?taxIdentifier.prefix=9` reads a restricted
value one character at a time from nothing but the shape of the result set, so the permission gate
belongs on the _filter_, not only on the projected output.

When the permission is absent the filter is **refused as a validation failure**, not dropped.
Dropping it would return a wider result set than the caller asked for while looking as though the
filter had worked — a silent widening is worse than an error. The refusal is also **uniform**: a
sensitive field refuses identically whether or not the requested operator would have been valid, so
the error cannot be used to enumerate the contract.

## 8. Refusals disclose the rule, never the payload

Every refusal is `ERR-VAL-001` (HTTP 422) carrying exactly one violation of the form
`{ path, rule }` — no third key. The submitted value appears in neither `safeDetails` nor the
developer message, because filter values are business data and the developer message reaches logs.
The rejected _field name_ is not echoed either: it is never interpolated, not even into an error
string.

Positional paths (`query.filter.2`) report which filter failed, so a client with eight filters can
fix the right one without the server describing what was in it.

## 9. The cursor is bound to the query — and is still not a security boundary

The foundation's cursor is unsigned base64url JSON, and
[`src/server/db/pagination.ts`](../../../src/server/db/pagination.ts) says so plainly. P1-15 does not
change that. What it adds is _binding_: `boundOrderingContract()` computes

```
sha256([contract.key, sort.canonical, filterCanonical, tenantId].join(' ')) → first 16 hex characters
```

and issues the ordering key `"<contract.key>#<fingerprint>"`. `decodeCursor()` already refuses a
cursor whose `k` does not match the contract it is presented under, so a cursor issued for one query
now **fails closed** in another instead of quietly producing a page from the wrong position.

The canonical filter form is _sorted_ before hashing, so re-ordering the filters in a query string
does not invalidate a cursor the caller is already paging with — the fingerprint tracks the filter
_set_, not the parameter order.

### What the fingerprint is not

**It is a fingerprint, not a signature, and it is not claimed to be one.** Tampering is "detected"
only in the sense that a modified cursor stops matching the contract key; anyone who can recompute
SHA-256 can forge a matching one. The evidence suite asserts this limitation as a passing test rather
than hiding it: a payload edit that changes only the position fields `v` and `i`, leaving `k` intact,
**is accepted**, and there is a test named for that acceptance. The day someone claims the cursor is
tamper-proof, that test contradicts them.

That is acceptable because the cursor **decides nothing about authorization**. Every page still runs
under RLS, on the caller's own connection, with the caller's own request context and an explicit
tenant predicate. The worst a forged cursor achieves is a page of the caller's own rows starting
somewhere unexpected.

The 16-hex truncation is a **collision budget, not a security parameter**. Two different filter sets
colliding would let a cursor be reused across them, which produces a wrong page and nothing worse.

### Why signing is an open decision, not a half-built feature

A signed cursor needs a signing key, and a key needs somewhere to live, a rotation procedure, and
agreement across every instance that might serve the next page. **No key management is provisioned in
this phase** — there is no secret store, no rotation schedule, and no multi-instance deployment to
agree with. Shipping HMAC over a hard-coded or per-process key would produce something that _looks_
like integrity, breaks the moment a second instance exists, and invites exactly the claim
("the cursor is signed") that the deployment cannot support.

So it is recorded as an open decision with its precondition named, and the unsigned behaviour is
documented and tested. That is the honest state: a bounded, query-bound, **non-security** cursor.

## 10. Living beside the foundation without importing it

`OrderingContract` is declared in this module rather than imported from `@/server/db/pagination`,
because boundary rule **B5** forbids a module's `domain` layer from importing `server/db`. The rule
is right — a domain function that reaches into the data layer stops being testable without one — and
the type is two fields.

TypeScript's structural typing makes the two identical, so the value passes unchanged into
`pageRequest()` and `keysetFragment()`. The equivalence is pinned by a compile-time assignment in the
evidence suite; Vitest does not typecheck, so `npm run typecheck` is what enforces it. The same test
also passes a real bound contract through the foundation helpers and asserts the emitted
`ORDER BY`/`LIMIT`, which is the runtime half of the same claim, and confirms that the filter
builder's `nextParamIndex` hands off to the keyset fragment as one continuous parameter sequence.

## 11. What the evidence proves, and what it does not

[`tests/foundation/p1-15-query-primitives.test.ts`](../../../tests/foundation/p1-15-query-primitives.test.ts)
asserts against the **emitted SQL text**, not against the helper's return code. That distinction is
the reason the suite is worth having: a builder that starts interpolating passes every "does it
filter correctly?" test ever written, and fails these.

It proves: exactly one placeholder per bound value with consecutive numbering; no caller string and
no caller-visible field name in the predicate; every bound enforced at and one past its limit; stable
non-echoing refusals; LIKE escaping with a negative control; sensitive-field refusal including
uniformity; and cursor binding across filters, sort, and tenant with `ERR-PAG-001` failing closed.

It does not touch a database, a clock, or a network, and it makes no claim about query performance,
index selection, or behaviour under concurrency. Those belong to the database tier.
