# P1-20 QA evidence

Covers **P1-20-QA-001** (unit and component coverage), **P1-20-QA-002** (API/contract
and error-path coverage), **P1-20-QA-003** (tenant/company/branch isolation),
**P1-20-QA-004** (concurrency and idempotency) and **P1-20-QA-005** (regression and
evidence packaging).

## Suites added by this phase

| File                                               | Tests | Covers                                                                         |
| -------------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| `tests/unit/p1-20-decimal.test.ts`                 | 34    | exact decimal and money boundaries (QA-001)                                    |
| `tests/unit/p1-20-discount-authorization.test.ts`  | 26    | discount thresholds, ceilings, maker≠approver (QA-001)                         |
| `tests/backend/p1-20-service-catalog.test.ts`      | 54    | catalog read and MUTATION, isolation, filters, paging, replay (QA-002, QA-003) |
| `tests/backend/p1-20-pricing.test.ts`              | 51    | price-list lifecycle, publication race, resolution, replay (QA-002, QA-004)    |
| `tests/backend/p1-20-quotation.test.ts`            | 67    | quotation lifecycle, decisions, evidence, expiry, replay (QA-002, QA-004)      |
| `tests/backend/p1-20-additional-work-link.test.ts` | 12    | BE-013 integration and port installation (QA-002, QA-005)                      |

**244 tests** across the phase: 60 unit, 184 backend.

Every figure above was MEASURED by running that one file, not estimated. The previous
table carried 32/24/21/45/56 and a 190 total, which had drifted by 54 tests across two
waves — the phase has already shipped one wrong estimated count, and a suite table that
is not re-measured is the same failure in a different row.

The backend count rose by 29 during Wave 9. That was not padding: the
operation-coverage gate's derived floor did not apply to `svc.`/`quo.` at all until
`P1_20_PREFIXES` was added to `DERIVED_PREFIXES`, and once it did it demanded eight
evidences that did not exist. An independent audit then found that 20 already-declared
flags across 11 operations were not backed by an assertion that could fail on the
defect they named — chiefly because every `isolation` case used a principal that did
not hold the operation's own permission, so its 403 was a missing permission and a
scope-blind implementation passed unchanged.

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

| Case                                                          | Test                                                                                 |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Cross-tenant catalog invisible both directions                | service catalog: "never shows a tenant-B caller tenant A's services, and vice versa" |
| Cross-tenant price list invisible                             | pricing: "never shows a tenant-B list to tenant A"                                   |
| Cross-tenant price resolution refused, amount never echoed    | pricing: "never resolves a tenant-A price for a tenant-B caller"                     |
| Cross-tenant quotation refused                                | quotation: "never lets a tenant-B caller quote a tenant-A work order"                |
| Cross-tenant quotation detail discloses no amount             | quotation: "403 without quo.quotation.read, and 404-shaped for another tenant"       |
| Cross-tenant price-list version / rule / publication          | pricing: the three `svc pricing writes` floor cases                                  |
| Cross-tenant revision create / issue / item / revision decide | quotation: the four `quo writes` floor cases                                         |
| Cross-branch catalog filter refused                           | service catalog: "refuses a branch filter for a branch the caller has no grant in"   |
| Cross-branch price resolution refused                         | pricing: "refuses a branch the caller holds no price permission in"                  |
| Cross-branch price RULE refused                               | pricing: "svc.price-rule-record refuses … and another branch"                        |
| Cross-branch quotation detail refused                         | quotation: "refuses a caller scoped to another branch"                               |
| Cross-branch quotation create / revise / issue / decide       | quotation: the four `quo writes` floor cases                                         |
| **Permission-blind grant union does not widen access**        | the service-catalog `SVC_PERMISSION_ELSEWHERE` case                                  |
| Availability asymmetry makes the filter meaningful            | `SERVICE_A` is available in A1 only, `SERVICE_A_ALT` in A2 only                      |
| Role-derived approval ceiling does not cross a company        | pricing: `callerApprovalCeiling respects grant scope` (both halves)                  |

### Why the isolation principals changed in Wave 9

Every cross-branch case above now uses a principal that holds the operation's own
permission **in full**, scoped to branch A2, with a widening grant putting A1 into its
`iam.allowed_branch_ids()` union. Both halves matter: without the permission the 403 is
a missing permission and proves nothing about scope, and without the widening grant the
target row is invisible to RLS and the request fails whether the check consults scope or
not. With both, a scope-blind `iam.has_permission` would **allow** the request — so the
refusal can only be the scoped check (P1-18-A-01).

The principals used before Wave 9 — `SVC_SCOPED_A2` and `SVC_PERMISSION_ELSEWHERE` —
hold `svc.service.read` alone. They remain in the catalog cases, where that IS the
declared permission, and are kept alongside the new cases as the permission-refusal
half.

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
| **Raced quotation issue** (`Promise.all`)     | exactly one 200 and one 4xx; exactly one `issued` revision; exactly one outbox row                                 |
| **Raced opposite item decisions**             | exactly one 201 and one 4xx; exactly one row in `quo.approval_decisions`                                           |
| Stale `If-Match`                              | `ERR-CON-001` on price-list version create, **publication**, revision create and **issue**                         |
| Missing `If-Match`                            | `ERR-CON-002`                                                                                                      |
| Missing `Idempotency-Key`                     | `ERR-INT-002` on every idempotent P1-20 write                                                                      |
| **Same-key REPLAY**                           | one execution, on all **13** idempotent P1-20 writes — see below                                                   |

The two raced cases were added in Wave 9, driven with `Promise.all` against one row.
The suite previously credited `concurrency` to sequential "a second attempt is refused"
cases, which prove idempotency and say nothing about a race; and it credited
`stale-version` to tests that only proved the `If-Match` header was **required**, never
that a wrong value is refused.

### The `idempotency` flag now means a replay, not a missing header

Until this wave every P1-20 write minted a fresh `crypto.randomUUID()` key on every
call, so the `idempotency` evidence flag on thirteen operations rested entirely on a
missing-header `ERR-INT-002`. That proves the header is **mandatory** and nothing more:
a route could demand the key, ignore it completely, and pass every one of those cases.
The gate's own definition of the category is "a replay produces one row, not two".

Each of the thirteen now has a same-key replay case sending the byte-identical request
twice and asserting both halves — the second response equals the first, and the write
happened once, counted in SQL through the admin pool rather than read back from the
response that is itself under suspicion:

| Operation                        | The witness that a second EXECUTION would have moved                               |
| -------------------------------- | ---------------------------------------------------------------------------------- |
| `svc.service-create`             | `svc.services` rows for the code = 1 (`uq_services_code` would 409)                |
| `svc.service-update`             | one `record_version` bump; `svc.service.updated` = 2 (create + one update)         |
| `svc.service-version-publish`    | `service.published:<versionId>` = 1; version no longer draft                       |
| `svc.branch-availability-set`    | `svc.branch_availability.changed` = 1 — the upsert leaves one row either way       |
| `svc.price-list-create`          | `svc.price_lists` rows for the code = 1 (`uq_price_lists_code` would 409)          |
| `svc.price-list-version-create`  | `svc.price_list_versions` for the list = 1, on a now-stale `If-Match`              |
| `svc.price-rule-record`          | `svc.price_rules` for the version = 1 (`uq_price_rules_signature` would 409)       |
| `svc.price-list-version-publish` | `price-list.published:<versionId>` = 1 (`requireDraftVersion` would refuse)        |
| `quo.quotation-create`           | `quo.quotations` for the work order = 1, and one consumed quotation number         |
| `quo.quotation-revision-create`  | revisions for the quotation = 2, on a now-stale `If-Match`                         |
| `quo.quotation-issue`            | `quotation.revision-issued:<revisionId>` = 1                                       |
| `quo.quotation-item-decide`      | `quo.quotation_item.decided` audit = 1 — `settleExisting` returns before the audit |
| `quo.quotation-revision-decide`  | `quo.quotation_revision.decided` = 1 — `appendAudit` after the loop is unguarded   |

Two facts hold across all thirteen and are asserted rather than worked around:

- **A replay answers 200, never the 201 the first attempt answered.**
  `route-handler.ts` stores `value.body` alone, so the replay is rebuilt as `{ body }`
  with no status. Platform behaviour since P1-15, recorded as `P1-20-A-10`.
- **`If-Match` is not part of the request fingerprint**, and the replay short-circuits
  before the handler reads `expectedVersion`. So the four version-guarded commands are
  retried with the SAME header the first attempt already made stale, and answer the
  stored response instead of `ERR-CON-001` — which is the point: a client retrying a
  command whose response it never saw must not be told its own success was a conflict.

### Transaction completeness and rollback

Two of the three rollback claims here were **pre-check refusals** before Wave 9 —
they were thrown before any write, so "nothing was written" was trivially true of a
command that never wrote. Both are now proved by forcing a failure _after_ writes:

- **Issue, failing at the LAST statement**: the outbox key the issue is about to
  publish is pre-taken for the tenant, so `publishEvent` raises after
  `quo.issue_revision` has moved the revision to `issued`, repointed
  `current_revision_id`, moved the quotation to `active` and frozen all four totals,
  and after the audit record. Afterwards the revision is `draft`, the quotation is
  `draft`, `current_revision_id` is NULL and the audit record is absent.
- **Revision-wide decision, failing MID-LOOP**: line two is approved individually
  first, which leaves the revision decidable, so a revision-wide _rejection_ writes
  line one's rejection and only then hits the opposite-decision conflict on line two.
  Afterwards exactly the one pre-existing approval survives and no outcome event
  exists.
- **Issue with zero items**: refused, and the revision remains `draft` with **no**
  audit record and **no** outbox row. Retained under its own name as the pre-check it
  is, not as rollback evidence.
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
  after the `DecideInput` extension, so the BE-013 change is additive. The whole
  backend suite is green at the remediation head.
- **A P1-19 time bomb was fixed as a regression, not as feature work.**
  `p1-19-labor-sessions.test.ts` pinned a correction window to an absolute
  `2026-07-26` while `tech.guard_labor_session` refuses a start before
  `job_created - interval '1 day'` — so it passed the day P1-19 was written and failed
  every day after. Reproduced at the P1-19 gate SHA `0d86a19` in a separate worktree
  **before** changing anything, which is what establishes it was not a P1-20
  regression, then fixed with a relative `correctionWindow()`.
- **One P1-19 behaviour genuinely changed and it is not a regression:** citing a
  quotation revision on an additional-work approval now requires
  `quo.quotation.read`. A P1-19 caller approving _without_ a quotation is unaffected
  (the check runs only when a revision is cited), which is why the requirement is not
  declared on the operation — `permissions` is a conjunction.
- **Generated evidence**: `endpoint-inventory.md` and `task-traceability.md` are
  produced by `scripts/p1-20-endpoint-inventory.mjs` and cannot disagree with the
  code, because the code is their only input.
- **The traceability gate is not self-satisfying, and it took three passes to get
  there.** Its first version counted its own generated document as an anchor, so all
  27 identifiers "resolved" the moment the file was written. Excluding the two
  generated documents was still not enough: `task-register.md` is hand-written
  evidence that prints all 27 identifiers in its tables, so five of them resolved to
  that file and nothing else — deleting every P1-20 source and test file would still
  have reported 27/27.

  The rule is now structural rather than a blacklist. `docs/` is not searched at all,
  so an identifier must appear in code, a test or a gate script. The gate script
  itself IS searched — it is the CI quality gate and the traceability generator, which
  is real work for three of the tasks — but its `TASKS` declaration is blanked out
  first, because a gate whose input satisfies its own assertion asserts nothing. A
  task whose deliverable genuinely is a document names an explicit file instead, so
  `P1-20-DOC-002` must appear in `change-log.md` and nowhere else counts; forcing a
  code anchor there would only teach the next author to paste an identifier into a
  comment, which is the failure being prevented, dressed as compliance.

  It then failed honestly with 12 unanchored identifiers until the corresponding work
  existed.

- **The gate cannot silently miss an operation.** `parseOperations` keys on
  `export const <NAME>_OPERATION`, a convention the compiler does not enforce, so the
  number of `defineOperation(` call sites is counted independently and a mismatch
  fails the gate rather than quietly undercounting the surface.

## Two suites must never run against one database at the same time

The DB-backed suites all call `cleanBackendFixtures` in `beforeAll`, which truncates the
tenant fixture set and rebuilds it. That is correct for a suite running alone and fatal for
two running together: each one deletes the other's roles, grants and approval limits
mid-flight, and the failures surface far from the cause — a foreign-key error on
`rec.reception_visits`, a `403` where a fixture principal should hold every permission, or
an `fk_approval_limits_role` violation on a role that existed a second earlier.

This was learned the expensive way during this phase, by running the full battery in the
background while running individual suites in the foreground. The resulting figures were
meaningless and were discarded rather than recorded. Every count in this document comes
from a serial run with nothing else touching the database.

The same rule applies to the clean room, and to any reviewer or agent asked to "verify the
counts by running the suites" — that instruction and a concurrent battery cannot both be
honoured.

A related hazard, now closed: a test that plants a row through the admin pool and removes
it in a trailing statement leaks that row whenever an assertion above it fails, and the
leaked row then aborts the NEXT run's cascade. The create-atomicity test plants a colliding
`quo.quotations` row and removes it in a `finally`, which is the only form that survives its
own failure.

## Known test-environment note

Two tests in `tests/foundation/operation-coverage-gate.test.ts` time out on a **cold**
filesystem cache in the OneDrive-backed working tree; warm, they pass in under a
second, and hosted CI is unaffected. This is an environment characteristic, not a
defect, and it is not "fixed" by raising a timeout in the committed suite.
