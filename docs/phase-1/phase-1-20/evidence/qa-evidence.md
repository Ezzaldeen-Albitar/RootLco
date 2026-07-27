# P1-20 QA evidence

Covers **P1-20-QA-001** (unit and component coverage), **P1-20-QA-002** (API/contract
and error-path coverage), **P1-20-QA-003** (tenant/company/branch isolation),
**P1-20-QA-004** (concurrency and idempotency) and **P1-20-QA-005** (regression and
evidence packaging).

## Suites added by this phase

| File                                               | Tests | Covers                                                              |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------- |
| `tests/unit/p1-20-decimal.test.ts`                 | 32    | exact decimal and money boundaries (QA-001)                         |
| `tests/unit/p1-20-discount-authorization.test.ts`  | 24    | discount thresholds, ceilings, maker≠approver (QA-001)              |
| `tests/backend/p1-20-service-catalog.test.ts`      | 21    | catalog read, isolation, filters, paging (QA-002, QA-003)           |
| `tests/backend/p1-20-pricing.test.ts`              | 35    | price-list lifecycle, publication race, resolution (QA-002, QA-004) |
| `tests/backend/p1-20-quotation.test.ts`            | 38    | quotation lifecycle, decisions, evidence (QA-002, QA-004)           |
| `tests/backend/p1-20-additional-work-link.test.ts` | 11    | BE-013 integration (QA-002, QA-005)                                 |

**161 tests** across the phase: 56 unit, 105 backend.

## P1-20-QA-001 — exact decimal boundaries

The decimal suite tests what the type is actually responsible for — refusing what the
columns would refuse, comparing exactly, and serializing deterministically. It does
not test "does arithmetic work", because the arithmetic is PostgreSQL's.

Covered: zero · minimum positive at each scale (`0.0001`, `0.001`, `0.000001`,
`0.01`) · maximum `numeric(18,4)` (`99999999999999.9999`) · one digit over precision ·
excess scale · negatives where forbidden · percentage bound `0..100` · tax-rate
fraction `[0,1]` · exponential notation refused (`1e3`, `1E3`, `1e-3`, `1.5e2`) ·
`NaN`, `Infinity`, empty, `+1`, `.5`, `1.`, `0x10`, `01` · a JSON **number** refused ·
comparison across scales · large-value comparison · fixed-width serialization ·
`toJSON` emitting a string.

### No floating-point drift

Eight values IEEE-754 cannot hold are pinned to their exact round-trip: `0.1`, `0.2`,
`0.3`, `1.005`, `2.675`, `4.345`, `1234567890.1234`, `99999999999999.9999`. One case
is deliberately sharper — two 17-significant-digit values whose `Number()` forms are
**equal** are asserted to remain distinct as `Decimal`s. If the type is ever
"simplified" to route through `number`, that test fails rather than a customer's
total.

### No currency conversion path

Asserted by absence: `convert`, `to`, `in`, `exchange`, `add`, `multiply` and `plus`
are all `undefined` on a `Money`. Silent FX is unexpressible rather than discouraged.

## P1-20-QA-002 — API, contract and error paths

Every operation has route, Zod schemas, canonical response, RFC 9457 problem details,
a named permission, a scope target where applicable, OpenAPI registration and
operation-depth evidence. The parity arithmetic is external:
`check-authorization-coverage.mjs` counts registered operations and
`check-openapi.mjs` counts published ones, and the two must be equal — which is what
catches the vacuous pass where a route is missing from both the document and the
contract test.

**OpenAPI: 152 paths / 181 operations** (baseline 140 / 168).

Error paths asserted: 401 unauthenticated · 403 missing permission · 403 cross-branch ·
404 not visible · 409 conflict (duplicate code, duplicate rule signature, stale
version, superseded revision, conflicting decision) · 422 validation (unknown field,
malformed currency, over-scale amount, exponential notation, JSON number, bad cursor,
oversized page, timezone-carrying date, non-uuid) · 428 missing `If-Match` ·
`ERR-INT-002` missing `Idempotency-Key`.

Problem documents carry `type`, `title`, `status`, `code` and `correlationId` and
**never** the internal message — a deliberate no-leak decision. Two of this phase's
tests originally asserted on `message` and were corrected to assert the `code`; the
operator-facing distinction between "no price configured" and "no effective tax rate"
lives in the logs.

## P1-20-QA-003 — tenant, company and branch isolation

| Case                                                       | Test                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Cross-tenant catalog invisible both directions             | service catalog: "never shows a tenant-B caller tenant A's services, and vice versa" |
| Cross-tenant price list invisible                          | pricing: "never shows a tenant-B list to tenant A"                                   |
| Cross-tenant price resolution refused, amount never echoed | pricing: "never resolves a tenant-A price for a tenant-B caller"                     |
| Cross-tenant quotation refused                             | quotation: "never lets a tenant-B caller quote a tenant-A work order"                |
| Cross-tenant quotation detail discloses no amount          | quotation: "403 without quo.quotation.read, and 404-shaped for another tenant"       |
| Cross-branch catalog filter refused                        | service catalog: "refuses a branch filter for a branch the caller has no grant in"   |
| Cross-branch price resolution refused                      | pricing: "refuses a branch the caller holds no price permission in"                  |
| Cross-branch quotation detail refused                      | quotation: "refuses a caller scoped to another branch"                               |
| **Permission-blind grant union does not widen access**     | both the service-catalog and pricing `SVC_PERMISSION_ELSEWHERE` cases                |
| Availability asymmetry makes the filter meaningful         | `SERVICE_A` is available in A1 only, `SERVICE_A_ALT` in A2 only                      |

## P1-20-QA-004 — concurrency and idempotency

| Scenario                                      | Outcome asserted                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Concurrent price-list publication             | exactly one 200, exactly one outbox event                                                                          |
| Duplicate publication of a published version  | refused; still one event                                                                                           |
| Forward-only succession                       | an `effectiveFrom` at or before the open published version is refused; a later one closes the prior `effective_to` |
| Duplicate rule signature                      | mapped 409, not a 500; a different priority is accepted                                                            |
| Concurrent revision creation                  | distinct revision numbers, or exactly one winner on the same `If-Match`                                            |
| Duplicate quotation issue                     | refused; exactly one `quotation.revision-issued` event                                                             |
| Supersession                                  | exactly one `issued` revision remains; the prior becomes `superseded`                                              |
| Duplicate item decision (same)                | settles idempotently; exactly one stored decision row                                                              |
| Conflicting item decision (opposite)          | refused — the first decision is final                                                                              |
| Revision-wide decide meeting an opposite line | aborts wholly; the other line stays undecided                                                                      |
| Stale `If-Match`                              | `ERR-CON-001` on price-list version create, revision create, issue                                                 |
| Missing `If-Match`                            | `ERR-CON-002`                                                                                                      |
| Missing `Idempotency-Key`                     | `ERR-INT-002`                                                                                                      |

### Transaction completeness and rollback

- **Issue with zero items**: refused, and the revision remains `draft` with **no**
  audit record and **no** outbox row. Proven by deleting the items and re-issuing.
- **Additional-work link refusal**: every invalid reference leaves **no**
  `wo.customer_approvals` row at all — asserted by count, not by inspection. The
  reference must be set at INSERT because `tg_customer_approvals_immutable` freezes
  the column, so validation before the write is the only correct ordering.
- **Audit and outbox are written inside the business transaction**, beside the state
  change, and event keys are chosen so a retry collides rather than double-publishing:
  `price-list.published:<versionId>`, `quotation.revision-issued:<revisionId>`,
  `quotation.item-decided:<decisionId>`, `quotation.accepted:<revisionId>`.

## P1-20-QA-005 — regression and evidence packaging

- **P1-19 regression**: `tests/backend/p1-19-additional-work.test.ts` passes 39/39
  after the `DecideInput` extension, so the BE-013 change is additive.
- **Generated evidence**: `endpoint-inventory.md` and `task-traceability.md` are
  produced by `scripts/p1-20-endpoint-inventory.mjs` and cannot disagree with the
  code, because the code is their only input.
- **The traceability gate is not self-satisfying.** Its first version counted its own
  generated document as an anchor, so all 27 identifiers "resolved" the moment the
  file was written. Both generated documents and the script itself are now excluded
  from the search, which is why the gate failed honestly with 12 unanchored
  identifiers until this evidence existed.

## Known test-environment note

Two tests in `tests/foundation/operation-coverage-gate.test.ts` time out on a **cold**
filesystem cache in the OneDrive-backed working tree; warm, they pass in under a
second, and hosted CI is unaffected. This is an environment characteristic, not a
defect, and it is not "fixed" by raising a timeout in the committed suite.
