# P1-31 — the delivery-readiness queue (Owner decision D-3)

What this slice published, why the contract is shaped the way it is, and what it deliberately
leaves open.

|                     |                                                                                                                                           |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Decision closed** | **D-3** of 2026-09-09 — the operational ready-for-delivery queue, separate from the delivery-record list                                  |
| **Lane**            | `p1-31-backend` — `remediation/p1-31-backend-delivery-readiness-seam`                                                                     |
| **Baseline**        | protected `develop` **07193258** (cut at **249c6428**); `main` **1262de74**, untouched                                                    |
| **Change control**  | **CC-24**, at section **39 provisional**, in [`change-control-2026-09-08.md`](./change-control-2026-09-08.md)                             |
| **Canonical tasks** | **none.** D-3 is an Owner decision taken during the phase; the screen it unblocks is **FE-001**                                           |
| **Records**         | this file. It is a sibling of the other seam records rather than a section of [`delivery-read-seam.md`](./delivery-read-seam.md) — see §9 |

---

## 1. The measured problem

`GET /api/v1/deliveries` lists delivery **records**. A delivery record exists because somebody has
already started a handover. So the set that route can return excludes, by construction, every work
order that is finished, quality-signed, paid and unencumbered but for which nobody has opened a
delivery yet — which is the moment the vehicle is most worth showing to a service advisor.

The Owner's D-3 decision names the missing set directly: the operational queue lists the work orders
that satisfy the authoritative **server** delivery-eligibility rules, **including eligible work
orders with no delivery record**, and it is separate from the delivery-record list published by
PR #358.

Three constraints came with it, and all three are honoured below: **no new work-order status**, **no
browser-side eligibility**, and **no broadening of finance permissions**.

## 2. What was published

| published                                                                       | minted  |
| ------------------------------------------------------------------------------- | ------- |
| 1 operation, 1 route module, 1 path, 1 application service, 1 work-order port   | nothing |
| register 397 → **398** operations, 309 → **310** paths, audit actions unchanged | nothing |

`GET /api/v1/delivery-readiness?companyId&branchId&cursor&limit` → `sal.delivery-readiness-list`,
`module: 'delivery'`, `scope: 'branch'`, `auditClass: 'none'`,
`rateLimitPolicy: 'expensive-read'`, `cacheCategory: 'never'`.

It is a **top-level resource** rather than `/deliveries/readiness`, on the `/damaged-stock` and
`/customer-duplicates` precedent: a static sibling of the dynamic `{deliveryId}` segment is a shape
this platform avoids, because a caller who sent `readiness` as an identifier would be answered by a
different route than the one it addressed.

Each row is a `DeliveryReadinessRowView`:

- `workOrder` — the work-order module's own `WorkOrderSummary`, so the queue and the work-order
  board spell a work order one way;
- `delivery` — this module's `DeliveryRecordView`, or `null`. `null` covers both "no delivery" and
  "the only delivery is in `exception`", because `uq_delivery_records_work_order_active` treats an
  exception as absent and permits a new delivery;
- `facts` — the four work-order-level eligibility facts, each with `established` and a `source`;
- `blockers` — the subset of those four that are blocking;
- `readyToStartDelivery` — the server's verdict.

The envelope is the ordinary keyset page, the same shape `wty.warranty-list` returns. Absence is a
**200 with an empty page**, never a 404.

## 3. Four facts, and why the other four are excluded

`BLOCKER_CODES` is a closed vocabulary of eight, and `DeliveryReadService.composeFor` composes all
eight for a delivery that exists. Four of them are keyed on a **delivery row's id**:

| excluded blocker         | why it cannot be asked here                                    |
| ------------------------ | -------------------------------------------------------------- |
| `delivery_state_invalid` | reads `sal.delivery_records.status` — there may be no such row |
| `checklist_incomplete`   | counted against `delivery_record_id`                           |
| `receiver_not_verified`  | `sal.authorized_receivers` is keyed on the delivery            |
| `signature_missing`      | `sal.delivery_signatures` is keyed on the delivery             |

For a work order with no delivery those four are not _clear_; they are **unaskable**. Reporting them
as satisfied would be a claim about rows nobody has looked at, and reporting them as blocking would
raise `receiver_not_verified` for every eligible work order in the branch — noise an operator cannot
act on. So this surface carries neither reading: the four are **absent** from the response, and the
suite asserts their absence textually rather than trusting the shape.

The four that remain take `workOrderId` and nothing else, and are the ones that can be established
before a handover begins:

| carried blocker                 | source                                                       |
| ------------------------------- | ------------------------------------------------------------ |
| `work_order_not_complete`       | `@/modules/work-order` — the row's state against the catalog |
| `quality_control_not_passed`    | `@/modules/quality` — `gate.evaluate` (B5a, B5b, B6)         |
| `financial_balance_outstanding` | `@/modules/billing` — `openReceivableForWorkOrder`           |
| `part_obligation_outstanding`   | `@/modules/inventory` — `reads.openCommitmentsFor`           |

They are read by `DeliveryReadService.composeWorkOrderFacts`, which calls **the same private readers
`composeFor` calls** and restates none of them. That is not tidiness: the financial fact is the one
gate on a handover with no database backstop at all — `sal.complete_delivery` checks no balance, no
work-order state and no quality outcome — so a second definition of it would be a second thing to
lose. The unbilled case in particular is mirrored exactly rather than re-derived: billing's `null`
and its `balanceVisible: false` both map to the blocker being **present** with `established: false`,
because "nothing was invoiced" is not settlement and an invisible zero is not a settled zero.

`readyToStartDelivery` is `true` when **all four facts are established and clear** and
`delivery === null || delivery.status !== 'delivered'`. That is the entire rule.

Its consequence is stated because it is easy to misread: a **handed-over** work order raises **no
blocker here** — `delivery_state_invalid` is delivery-bound and outside the four — and is still not
ready. `blockers` is empty and the verdict is `false`. A client that inferred readiness from an empty
blocker list would offer a vehicle that has already left, so the suite asserts that combination
directly.

**No new work-order status.** "Ready" is not a state anybody sets and nothing is written by this
path. It is composed on every read, so a row stops being ready the moment a part is reserved or an
invoice is raised, with nothing to keep in step and nothing to migrate.

**No browser-side eligibility.** The verdict, the codes and the provenance of every fact cross the
wire and a client renders them. There is no eligibility input on this path and no `ready` filter —
a caller able to ask for "only the ready ones" is a caller whose request has begun to influence what
ready means.

## 4. The permission decision

`sal.delivery.view`, `wo.work_order.read` **and** `sal.finance.view`. All three required.

The decisive code is `sal.finance.view`, and the authority for requiring it is the eligibility
route's own declaration —
`apps/api/src/app/api/v1/deliveries/[deliveryId]/eligibility/route.ts`, which declares
`['sal.delivery.view', 'sal.finance.view']` and records why in terms:

> Not belt-and-braces. The financial blocker is composed from `sal.invoice_open_receivable`, whose
> inputs live behind that permission. A caller without it would be waved through by an RLS-invisible
> zero … so the permission is required and the service **additionally** fails CLOSED on a fact it
> cannot establish.

The readiness queue composes that same fact through that same reader, so it declares that same code.
Dropping it and relying on the fail-closed default would put the weaker of two spellings of one rule
on the surface an operator actually works from.

`sal.delivery.view` gates the delivery record each row carries. `wo.work_order.read` is added
because every row **is** a work order and the candidate page is the work-order board's own query;
publishing a branch's work orders behind a delivery code alone would be a second, quieter way to
read that board.

Requiring three codes is a **narrowing** relative to any one of them, so the D-3 constraint holds
exactly: **no finance permission was broadened**, none was dropped, nothing was minted, no seed
changed and no catalogue row moved. All three are pre-existing codes already carried by the tenant
administrator bundle.

Scope is authorized **before any row is read**, on the `listWarranties` precedent: `scope: 'branch'`
is inert without a target, RLS narrows on the permission-blind `iam.allowed_branch_ids()` union
(P1-18-A-01), and authorizing first stops an empty page from reporting whether a branch has finished
work at all.

## 5. The candidate predicate, and the trap in it

`work_order_not_complete` clears when the work order's state has `is_closed = true`. So a "ready"
work order is a **closed** one — and `is_closed` is **also true for `cancelled`**. The platform state
graph sets `('cancelled', is_terminal, is_closed, is_cancellation) = (true, true, true)`, so a queue
built on `is_closed` alone would offer every abandoned job for handover.

The predicate is therefore **closed AND NOT a cancellation**, non-deleted, company- and
branch-scoped. Both flags are read from the **live** catalog rather than compared against a
hardcoded state name, because `wo.work_order_states` is a table tenants may shadow.

`wo.*` is private to the work-order module (ADR-001 rule 3) and `WorkOrderListFilter` carried a
single `state` code with no closed or terminal predicate, so the module gained one:

- `WorkOrderListFilter.states?: readonly string[]` — a resolved code SET, applied **in the query**
  before the keyset window, exactly as the BR-05 customer predicate is. An **empty** array matches
  nothing, deliberately: a tenant whose catalog resolves no closed non-cancellation state has no
  work order that can be handed over, and `undefined` would silently widen that to every state.
- `WorkOrderService.listClosedNonCancelled(db, { companyId, branchId }, page)` — resolves the codes
  from the catalog service and delegates to `list`, so the platform/tenant override precedence is
  resolved in exactly one place, the ordering contract stays
  `wo.work_orders:opened_at_desc`, and the rows come back as the same `WorkOrderSummary` the board
  returns. It performs **no authorization**: the caller names the scope and the readiness service
  authorizes it first.

Filtering after composition was not an option. A post-filtered page is a short page with a `hasMore`
that lies, which is the P1-28 round-two defect exactly.

## 6. The per-row cost, and the prerequisite it creates

None of the four fact sources has a batch variant. `qualityModule().gate.evaluate`,
`openReceivableForWorkOrder`, `reads.openCommitmentsFor` and `findLiveDeliveryForWorkOrder` each
answer for **one** work order, so a page of N costs on the order of **5N round trips** plus the
candidate page itself.

That is measured, not estimated away, and three things follow from it:

1. the page defaults to **20** and is capped at **50**, below the platform's 50/100;
2. the cap is enforced **at the boundary** — a `limit` above it is `ERR-VAL-001`, not a silent clamp,
   because `resolveLimit` returning fewer rows than were asked for is right for a cheap list and
   wrong for this one;
3. **batch fact ports in `quality`, `billing` and `inventory` are a named prerequisite** of any
   larger page. They are **not** built here: three modules' public surfaces are not this slice's to
   change, and inventing a batch port per module without a consumer contract is how a surface gets
   two readers that disagree.

The rows are composed one at a time rather than by fanning a whole page out at once: `db` is a single
connection, so a page-wide `Promise.all` would queue a hundred statements on it for no parallelism.

## 7. Money

**None crosses this route.** The financial fact is published as a blocker **code** and a provenance
string — whether money is owed, never how much. No amount, balance or currency appears in the
response in any spelling, and the suite walks every response asserting that no key named for money
carries a value of any type. Nothing on this path parses a `numeric` at all; the exact-decimal rule
has nothing to apply to.

## 8. What was proved, on real rows

`tests/backend/p1-31-delivery-readiness-seam.test.ts`. Every fixture is arranged **through shipped
routes**: a work order comes from reception's conversion, reaches `closed` through the four
transition edges and the closure command, its invoice is issued by `sal.issue_invoice` and settled
through the payment and allocation routes, and its delivery is opened and completed through the
delivery routes. Nothing is planted by UPDATE.

| id       | what was shown                                                                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **D3-1** | a closed, settled, unencumbered work order with **no delivery record** is returned with `readyToStartDelivery: true` and no blockers — the D-3 claim itself                                                   |
| **D3-2** | the same work order unsettled reports exactly `['financial_balance_outstanding']`, `established: true`, and differs from the settled one in that fact alone                                                   |
| **D3-3** | the four delivery-bound blocker codes appear **nowhere** in a response, asserted against the eight-member vocabulary so the exclusion is not vacuous                                                          |
| **D3-4** | a `cancelled` work order is excluded, with `is_closed` and `is_cancellation` both read off the real catalogue row first, so the trap is proved and not assumed                                                |
| **D3-5** | an `open` work order is excluded; every returned row is in `closed`                                                                                                                                           |
| **D3-6** | a work order with a live `ready` delivery appears with that delivery attached and is still ready to start; a **delivered** one raises no blocker and is **not** ready                                         |
| **D3-7** | permissions from four sides: the three-code reader is admitted, and one principal short of each of the three codes is refused `ERR-IAM-001`                                                                   |
| **D3-8** | tenancy and scope: another tenant is refused the named scope; a caller scoped to another branch with A1 inside its permission-blind RLS union is refused; no other branch's closed work order enters the page |
| **D3-9** | paging: the maximum accepted and one above it refused 422, two disjoint keyset pages, a malformed cursor and a cursor issued for another ordering contract both `ERR-PAG-001`                                 |

A caller without `sal.finance.view` is refused **at the operation**, so there is no softened or
nulled fact for such a principal and the suite deliberately does not invent one to test.

## 9. What this does not close, and other honest limits

- **FE-001 is not built.** This is the server contract the screen needs, and nothing more. No file
  under `apps/web/src` was edited except `lib/api/idempotent-operations.ts`, which a repository
  script regenerates and which every published operation moves.
- **The batch fact ports are not built** (§6). Until they exist the page ceiling stays at 50.
- **The DEFAULT page size is proved as a ceiling, not as a saturation point.** The fixture branch
  does not hold twenty-one closed work orders, so the suite asserts that an unbounded request
  returns no more than twenty; the **maximum** is proved behaviourally in both directions.
- **No schema change, no migration, no seed, no permission minted.** Every statement uses grants that
  already existed, and the one new SQL predicate is a parameter on an existing query.
- **No gate was weakened.** This is a read and it gates nothing. `sal.complete_delivery`,
  `composeFor` and `GET .../eligibility` are untouched, and the delivery-bound four are still
  enforced exactly where they were.
- **`check-p1-30-payload-parity.mjs` is not engaged and no `PENDING` entry was added.** That gate
  holds `WRITE_METHODS` to a mirror; a GET is out of its scope, so declaring a pending mirror would
  be a claim about a gate that does not look here.
- **This is a separate document rather than a section of `delivery-read-seam.md`.** That file records
  prerequisites P-2 … P-5 and ends at its own section 9; this is a different decision with its own
  operation, service, port and suite, and every other seam in this phase has its own record.
