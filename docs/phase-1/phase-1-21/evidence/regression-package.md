# P1-21-QA-005 — Regression Package

**Task:** `P1-21-QA-005`
**Phase:** P1-21 — Inventory Backend

The suites P1-21 adds, what each one is for, and — for the cases that exist because
something was actually wrong — what breaks if the protection is removed.

## Suites

| Suite                                          | Kind     | Tests | What it protects                                                        |
| ---------------------------------------------- | -------- | ----- | ----------------------------------------------------------------------- |
| `tests/unit/p1-21-inventory-domain.test.ts`    | unit     | 23    | Vocabulary transcription, the movement/reference matrix, exact quantity |
| `tests/backend/p1-21-inventory-reads.test.ts`  | backend  | 26    | Item search, availability, movement history, reconciliation             |
| `tests/backend/p1-21-inventory-stock.test.ts`  | backend  | 33    | Reservation, release, issue, return, damage                             |
| `tests/backend/p1-21-inventory-intake.test.ts` | backend  | 36    | Opening batches, customer-supplied custody, external purchases          |
| `tests/db/p1-21-inventory-integrity.test.ts`   | database | 14    | Real concurrency, negative stock, business-reference matrix             |

`tests/backend/p1-21-helpers.ts` carries the fixtures. It is not a suite and asserts
nothing on its own.

## Mutation checks — remove the protection, and these fail

Each entry names a specific line of protection and the test that stops being green
without it. These are the assertions that make the suite a regression package rather
than a coverage number.

| Remove this                                              | These fail                                                                 |
| -------------------------------------------------------- | -------------------------------------------------------------------------- |
| The issue ordering (consume before post) in `issuePart`  | "issues against a reservation covering ALL available stock"                |
| `assertWorkOrderAcceptsParts`                            | "refuses an issue to a DRAFT work order"                                   |
| `assertReservationMatchesIssue`                          | "refuses a reservation belonging to a different item"                      |
| The issue-vs-reservation quantity ceiling                | "refuses an issue larger than the reservation holds"                       |
| `assertQuarantineDestination`                            | "refuses a destination that is not a quarantine location"                  |
| The branch check on damage locations                     | the cross-branch damage refusal                                            |
| `authorizeScope` in `readAvailability`                   | "refuses a scoped caller the branch it holds no inventory permission in"   |
| `authorizeScope` in `release`                            | "refuses release from a branch the caller is not scoped to"                |
| The pre-call idempotency-key lookup in `reserve`         | "replays an idempotency key instead of reserving twice" (`replayed` false) |
| The same-key/different-quantity conflict                 | "refuses the same key with a different quantity"                           |
| The `wasActive` guard around release audit/outbox        | "is a safe no-op on a duplicate release" (counts become 2)                 |
| `appendAudit` in `listMovements`                         | "returns the opening movements newest-first and audits the read"           |
| `appendAudit` in any mutation                            | that operation's `audit` assertion, and the coverage gate's derived floor  |
| `publishEvent` in `reserve` / `release` / `issue`        | the matching `outbox` assertion                                            |
| The empty-batch refusal                                  | "refuses approving an EMPTY batch"                                         |
| Taking `countedBy` from the request context              | "refuses a caller-supplied countedBy" — and maker-checker becomes evadable |
| Taking line scope from the batch rather than the request | "refuses a line whose location is in a different branch from the batch"    |
| `escapeLikeTerm` in `listItems`                          | "escapes LIKE metacharacters instead of treating them as wildcards"        |
| `parseQuantity`'s error mapping                          | "refuses a malformed, zero, and floating-point quantity" (500 not 4xx)     |
| Any entry from `MOVEMENT_REFERENCE_MATRIX`               | both matrix tests, unit and database                                       |

Four of these — the issue ordering, the work-order lifecycle, the reservation
coherence check, and the quantity ceiling — are not defensive programming. They close
behaviour that was **reproduced failing** against a live database before any code was
written (`P1-21-D-01`…`D-03` in
`../wave-1-contract-archaeology.md`).

## Things the database proves and the application cannot

Kept in `tests/db/` deliberately: a mock cannot have a race, and a refusal that comes
from application code proves nothing about a caller who bypasses it.

- Ten simultaneous connections reserve one unit; exactly one commits.
- A **raw** `UPDATE` on `inv.stock_balances` that would go negative is refused —
  `app_runtime` holds `UPDATE`, so the refusal is demonstrably the CHECK constraint.
- All 43 illegal `(type, reference_kind, direction)` triples are refused with a
  well-formed row, a real item, and a real location.
- A forged source, a replayed source, and a second movement on the same
  `(kind, id, direction)` are each refused separately.
- `app_runtime` holds `SELECT, INSERT` and nothing else on `inv.stock_movements`.
- `customer_owned = false` and `is_procurement = true` are both unrepresentable.

## Predecessor suites this phase must not disturb

P1-21 adds no migration and changes no earlier module, so every predecessor suite
must remain at its baseline count: unit **903**, database **1610**, backend **1264**
at `bb9cc881`. The final local CI and the clean room both report the new totals
alongside those baselines, so a regression in an earlier phase is visible as a
number rather than inferred from a green tick.
