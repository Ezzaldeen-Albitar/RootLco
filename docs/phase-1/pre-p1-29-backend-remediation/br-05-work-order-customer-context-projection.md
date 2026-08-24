# BR-05 — Work-Order Customer and Vehicle Context Projection

|                      |                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------ |
| Closes               | `BE-3` · `DEP-B3` · finding `INS-10` (**CRITICAL**, P1-27 `INT-036`) · Owner requirement 2 |
| Depends on           | **nothing**                                                                                |
| Database change      | **none**                                                                                   |
| New permission codes | **none**                                                                                   |
| Complexity           | **S–M**                                                                                    |

---

## 1. Problem statement

A work order does not expose its customer. The service advisor's first question — _whose car is
this_ — has no answer on the work-order surface, and the board has no customer column and no
customer filter.

`WorkOrderDetail.workOrder` is
`{id, companyId, branchId, receptionVisitId, vehicleId, kind, state, partsForwardState,
displayNumber, openedAt, recordVersion}`. **No customer column exists in any of the 44
`wo`/`dia`/`tech`/`qms` tables.**

## 2. Existing repository evidence

### The chain that exists

```
wo.work_orders.reception_visit_id  ──►  rec.reception_visits
                                           │
                                           ▼
                                    rec.reception_party_roles  ──►  crm.business_partners
```

| link                      | evidence                                                                                                                                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| work order → visit        | `fk_work_orders_reception_visit FOREIGN KEY (tenant_id, company_id, branch_id, reception_visit_id) REFERENCES rec.reception_visits (…) ON DELETE RESTRICT` — `20260722096000…:62-64`; `reception_visit_id` is **NOT NULL** (`:42`), so every work order has exactly one visit |
| work order → vehicle      | `fk_work_orders_vehicle (tenant_id, vehicle_id) → veh.vehicles` — `:65-66`; also NOT NULL                                                                                                                                                                                     |
| visit → party             | `fk_reception_party_roles_visit` and `fk_reception_party_roles_partner (tenant_id, partner_id) → crm.business_partners (tenant_id, id)` — `20260721098000…:65-70`                                                                                                             |
| the role vocabulary       | `ck_reception_party_roles_role CHECK (relationship_role IN ('service_requester','vehicle_owner','vehicle_user','payer','billing_party','approving_party','authorized_receiver'))` — `:71-73`                                                                                  |
| **the relation is dated** | `valid_from`, `valid_to`; `uq_reception_party_roles_active … WHERE valid_to IS NULL AND deleted_at IS NULL` — `:84-86`                                                                                                                                                        |
| **and immutable**         | `tg_reception_party_roles_immutable` guards `partner_id`, `relationship_role`, `valid_from` — `:92-96`                                                                                                                                                                        |
| the table says so itself  | _"dated (valid_to) not mutated, so history is preserved"_ — the `COMMENT`                                                                                                                                                                                                     |
| origin is exclusive       | `ck_reception_visits_one_origin CHECK ((appointment_id IS NULL) <> (walk_in_id IS NULL))` — `20260721097000…:98-99`                                                                                                                                                           |

### What is absent

- No read exposes the chain **from the work-order side**.
- `GET /work-orders` accepts no `customerId` filter — the strict query is
  `companyId*`, `branchId*`, `state?`, `kind?`, `openedFrom?`, `openedTo?`, `cursor?`, `limit?`
  (`INS-02`).
- `apps/web` consumes exactly one work-order read today:
  `features/receptions/work-order-api.ts`, 23 lines.

### Two facts the preparation stated as outcomes without naming the mechanism

**Dating is the mechanism, not good behaviour.** A correction to a party role writes a _new_ row and
dates the old one out; `partner_id` and `relationship_role` cannot be mutated. So a projection
reading `WHERE valid_to IS NULL` returns _today's_ answer and a projection reading as-at the visit
returns _the visit's_ answer. Only the second satisfies `BE-3`'s acceptance criterion. See
[C-03](repository-corrections.md#c-03--the-customer-of-the-visit-is-guaranteed-by-dating-not-by-good-behaviour).

**There are two role vocabularies, not one.** `rec.reception_party_roles` has seven values;
`veh.vehicle_relationships` has a _different_ seven (`owner`, `user`, `driver`, `fleet_operator`,
`payer`, `authorized_person`, `service_requester`) — only `payer` and `service_requester` overlap.
See [C-04](repository-corrections.md#c-04--there-are-two-party-role-vocabularies-and-they-are-not-the-same-seven).

## 3. Gap

| gap                                                                                          | class             |
| -------------------------------------------------------------------------------------------- | ----------------- |
| the work-order read exposes no customer                                                      | **Contract**      |
| the board cannot show or filter by customer                                                  | **Contract**      |
| no read names _which_ party role it is reporting                                             | **Domain model**  |
| a client-side chain needs two extra permissions and does not exist for walk-ins              | **Authorization** |
| no test proves that a later ownership change leaves a closed work order's customer unaltered | **Test**          |

**Not a gap:** the data, the joins, the dating, the referential integrity, or the immutability.
This slice writes no SQL.

## 4. Proposed architecture

**A dated read projection inside the work-order read. No column, no denormalisation.**

### 4.1 The three options, and why B and C fail

| option                                                                                             | cost                                                                                                                                                                                                   | verdict      |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| **A — read projection** (resolve the party through the reception chain inside the work-order read) | one join path in one service; no schema change; correct for walk-ins and appointments alike; cannot drift from reception because it **is** reception's data                                            | **selected** |
| **B — `wo.work_orders.customer_id` column**                                                        | a migration, a backfill with no honest source, and a second source of truth that disagrees with `rec.reception_party_roles` the moment a role is corrected                                             | **rejected** |
| **C — client-side chain**                                                                          | two or three extra round trips per work order, so it cannot feed a board column; needs `rec.reception.read` **and** `apt.appointment.read` on top of `wo.work_order.read`; does not exist for walk-ins | **rejected** |

**Option B has a shipped precedent for its failure mode, in this very table.**
`wo.work_orders.parts_forward_state` is `CHECK ('none','requested','reserved_elsewhere')` with
default `'none'`, and a full grep finds only its definition, its `COMMENT` and read-side
projections — **nothing writes it** (`INS-16`). It is always `'none'`. A denormalised
`customer_id` is the same shape of promise, and it would be worse: a stale customer is a wrong
answer, where a stale `parts_forward_state` is merely an inert one.

**`DEP-B3`'s disposition forbids C explicitly:** _"Do not resolve a customer client-side."_

### 4.2 The projection is dated to the visit, and says which role it reports

```
customer := the rec.reception_party_roles row for this work order's reception_visit_id
            WHERE relationship_role = 'service_requester'
              AND deleted_at IS NULL
              AND valid_from <= <the visit's reference instant>
              AND (valid_to IS NULL OR valid_to > <the visit's reference instant>)
```

Three decisions inside that:

- **`service_requester` is the reported role.** It is the party who brought the car and asked for
  the work — the answer to "whose car is this" _for this visit_. `vehicle_owner` is a different
  question and may be a different party; the table's taxonomy exists precisely because they are not
  the same. The projection **names the role it reports** so no consumer can assume otherwise.
- **The response carries the role, not just the party.** `{partnerId, displayName, relationshipRole}`
  — a consumer that renders the name without the role is making a claim the data does not support.
- **The reference instant is the visit's, not `now()`.** This is what delivers `BE-3`'s acceptance
  criterion. A closed work order's customer is fixed because the row that was current at the visit
  is still there, dated out rather than overwritten.

**If more than one `service_requester` is current** — possible, since
`uq_reception_party_roles_active` is unique on `(visit, partner, role)` and therefore permits two
partners in the same role — the projection returns the **earliest `valid_from`**, deterministically,
and sets `hasAdditionalParties: true`. It must never return an arbitrary one of two.

### 4.3 A sanctioned port, not a raw join

The work-order service reads across the `rec`/`crm` boundary through a module port, following the
`commercialApproval` precedent, not by writing `rec`/`crm` SQL inside the work-order repository.
This is the same discipline that keeps `OpenInventoryCommitments` — an inventory-owned type
embedded in a work-order response — honest.

### 4.4 The vehicle half is a smaller version of the same thing

`vehicle_id` is already on the work order and already NOT NULL. What is missing is a _projection_:
the board shows a UUID today. Add `{vehicleId, registrationPlate?, makeModel?}` from `veh.vehicles`
through the same port style.

**`veh.vehicles.workshop_status` must not be projected.** A scan of every non-catalogue function
body matches only three `veh` triggers — nothing in `wo`/`dia`/`tech`/`qms` maintains it
(`INS-39`). Projecting it would display a field this domain never updates.

## 5. Database impact

**None.** No migration, column, index, function, policy or grant.

**Rollback:** remove the block from the projection. No data consequence, no ordering constraint —
which is exactly the property option B would have destroyed.

## 6. API impact

Two changed operations, one new query parameter. **No new routes.**

### 1 · `wo.work-order-detail` — extended

`GET /work-orders/{workOrderId}` · `wo.work_order.read` · unchanged permission, scope, guards.

`WorkOrderDetail` gains:

```
customer: {
  partnerId: string,
  displayName: string,
  relationshipRole: 'service_requester',
  hasAdditionalParties: boolean
} | null

vehicle: {
  vehicleId: string,
  registrationPlate: string | null,
  makeModel: string | null
}
```

`customer` is **nullable**, and the null case is real: `rec.reception_party_roles` requires
`>= 1 service_requester` before _activation_ as a deferred contract, so a visit can legitimately
exist without one. The frontend must render the absence, not crash on it.

### 2 · `wo.work-order-list` — extended

`GET /work-orders` · `wo.work_order.read` · gains **one** query parameter and **one** response
field.

| addition | detail                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| query    | `customerId?: uuid` — filters to work orders whose visit names that partner in **any** role, not only `service_requester`. A user searching for a customer wants every car they are connected to. |
| response | `WorkOrderSummary` gains the same `customer` block                                                                                                                                                |

`.strict()` is preserved: the parameter must be declared, or it is a 422 rather than a silent
no-op.

**Paging correctness is the risk here.** The filter must be applied **in the query**, never after
the page is fetched. Filtering a fetched page client-side or service-side produces short pages and
a `hasMore` that lies — the P1-28 round-two defect exactly.

### 3 · Not added, deliberately

| requested                                 | why not                                                                                               |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `displayNumber` search                    | a different feature (`INS-02`); adding it here bundles two changes behind one review                  |
| `vehicleId` filter                        | same                                                                                                  |
| a `customer` block on `JobView`           | a job inherits its work order's customer; duplicating it invites the two to diverge in a client cache |
| resolving `actor_id` to a name in history | out of scope, no directory contract exists (`admin.contractGap.noDirectory`)                          |

### Error cases

| condition                                      | status                                                        | code          |
| ---------------------------------------------- | ------------------------------------------------------------- | ------------- |
| `customerId` not a uuid                        | 422                                                           | `ERR-VAL-001` |
| `customerId` names a partner in another tenant | **200, empty page** — not 404. A 404 would confirm existence. |
| work order not found or out of scope           | 404                                                           | `ERR-RES-001` |

## 7. Permission model

**Mint nothing. Require nothing new.**

**The whole point is that this resolves under `wo.work_order.read` alone.** Requiring
`rec.reception.read` and `apt.appointment.read` in addition is precisely what makes the client-side
chain unacceptable, and reproducing that requirement server-side would deliver none of the benefit.

**Is that an over-read?** No, and the argument is worth recording because it will be asked. The
projection exposes _the customer of this work order_ — a fact about the work order, to a caller
already entitled to read the work order. It does **not** expose the customer record: no address, no
contact details, no other vehicles, no other visits. A caller wanting those still needs
`crm.*`. The boundary is "the party of this visit at the role named", and nothing wider.

| actor                                     | sees the customer block                                                                                                                |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| service advisor with `wo.work_order.read` | yes — this is the requirement                                                                                                          |
| workshop manager                          | yes                                                                                                                                    |
| technician with work-order read           | yes; the vehicle and customer are the context of their job                                                                             |
| a caller without `wo.work_order.read`     | no work order at all                                                                                                                   |
| cross-tenant                              | RLS on `rec.reception_party_roles` and `crm.business_partners` refuses; the projection returns null rather than another tenant's party |

**`iam.sensitive.view` is not involved.** No restricted sidecar is touched. If a future requirement
adds a phone number to this block, that changes — and it must then be a separate adapter behind its
own check (`T-04`), never a widened projection.

## 8. Security requirements

| abuse case                         | required behaviour                                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **over-read**                      | the projection reports the party of _that visit_ at the role it names, never the customer record wholesale                                                                                                       |
| **cross-tenant**                   | the join carries `tenant_id` at every hop; `fk_reception_party_roles_partner` is `(tenant_id, partner_id)`, so a cross-tenant partner does not exist                                                             |
| **cross-branch**                   | the visit is reached through the work order's own composite key, so a cross-branch visit is structurally unreachable                                                                                             |
| **IDOR via `customerId`**          | the filter is a _selector_, not an authorization claim — it narrows a result set the caller is already entitled to. A `customerId` from another tenant yields an empty page, not an error                        |
| **enumeration through the filter** | empty-page-not-404 closes the oracle: a caller cannot distinguish "this customer has no work orders here" from "this customer is not in your tenant"                                                             |
| **stale-data disclosure**          | dating means a _former_ service requester remains visible on historical work orders. That is correct and intended, and it must be stated: correcting a party role does **not** redact it from closed work orders |
| **privilege escalation**           | none — no new code, no widened code                                                                                                                                                                              |
| **race**                           | none — read-only                                                                                                                                                                                                 |
| **paging leak**                    | the filter is applied in SQL; a page must never be post-filtered                                                                                                                                                 |

## 9. Validation

| concern                   | rule                                                                                                                                                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ids                       | `customerId`: `schemas.uuid.optional()`                                                                                                                                                                                     |
| enums                     | `relationshipRole` in the **response** is a closed vocabulary of seven; the mirror declares it as such                                                                                                                      |
| **vocabulary separation** | the projection reads `rec.reception_party_roles` only. It must never fall back to `veh.vehicle_relationships`, whose seven values are different — a response mixing them publishes incomparable values under one field name |
| relationship validation   | the party must belong to **this work order's** reception visit; the visit is resolved from the work order, never from the request                                                                                           |
| foreign ownership         | as above                                                                                                                                                                                                                    |
| timestamps                | the reference instant is server-derived from the visit; **no client-supplied as-at parameter** — it would be an oracle and a way to read a party role out of its window                                                     |
| empty / partial           | `customer: null` is a valid response, not an error                                                                                                                                                                          |
| unknown parameter         | `.strict()` preserved on the list query                                                                                                                                                                                     |

Export the `Query` schema.

## 10. Error contract

**No new error codes.**

| condition                           | HTTP | code          | frontend behaviour                                                    |
| ----------------------------------- | ---- | ------------- | --------------------------------------------------------------------- |
| malformed `customerId`              | 422  | `ERR-VAL-001` | field error, key not prose                                            |
| unknown query parameter             | 422  | `ERR-VAL-001` | client defect                                                         |
| work order out of scope             | 404  | `ERR-RES-001` | existence not disclosed                                               |
| cross-tenant `customerId`           | 200  | —             | empty result; **not** an error                                        |
| no `service_requester` on the visit | 200  | —             | `customer: null`; the UI renders "no customer recorded on this visit" |
| not permitted                       | 403  | `ERR-IAM-001` | denial + correlation id                                               |

## 11. Audit and history behaviour

`auditClass: none` — both operations are reads and this slice adds no write.

**The permanent RootLco requirements, and how this slice sits inside them:**

| requirement                                                                           | effect                                                                                                                                                                   |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **a customer may relate to multiple vehicles**                                        | preserved — the projection reports per visit, and `customerId` on the list returns every work order the partner is connected to, across vehicles                         |
| **a vehicle may hold customer relationships**                                         | untouched — `veh.vehicle_relationships` is a separate, differently-vocabularied relation this slice does not read                                                        |
| **work-order creation starts from a valid customer + vehicle/reception relationship** | unchanged; reception conversion remains the only ordinary insert path                                                                                                    |
| **customer history aggregates across vehicles and visits**                            | this slice makes the work-order half _readable_ for the first time; it does not build the aggregate view, which is not P1-29's                                           |
| **vehicle history is complete**                                                       | untouched                                                                                                                                                                |
| **work-order history is transactional and independent**                               | **preserved precisely because option B was rejected.** A denormalised `customer_id` updated on ownership change would have rewritten history; a dated projection cannot. |

**The one thing to say plainly in the acceptance evidence:** a closed work order shows the customer
who brought the car _then_, not the vehicle's current owner. That is the correct behaviour and it
will look like a bug to someone who expects otherwise.

## 12. Tests

### Positive

| #   | case                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------- |
| P1  | an **appointment-originated** work order resolves its customer                                             |
| P2  | a **walk-in-originated** work order resolves its customer — the case the client-side chain could not serve |
| P3  | the caller holds **only** `wo.work_order.read` and both succeed                                            |
| P4  | the board renders a customer column for a page of work orders in **one** call                              |
| P5  | `customerId` filters the list; the result matches an independently computed set                            |
| P6  | the vehicle block resolves plate and make/model                                                            |
| P7  | `relationshipRole` is present on every non-null customer block                                             |

### Negative

| #   | case                                             | expected              |
| --- | ------------------------------------------------ | --------------------- |
| N1  | no auth                                          | 401                   |
| N2  | no `wo.work_order.read`                          | 403                   |
| N3  | a visit with no `service_requester`              | 200, `customer: null` |
| N4  | malformed `customerId`                           | 422                   |
| N5  | unknown query parameter                          | 422                   |
| N6  | work order in an unheld branch                   | 404                   |
| N7  | `workshopStatus` appears nowhere in the response | asserted on the type  |

### Security

| #   | case                                                                                                                                     | expected                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| S1  | **cross-tenant `customerId`**                                                                                                            | 200, empty page — not 404, not 403                    |
| S2  | **cross-tenant projection**: a work order in tenant A never yields a tenant-B partner                                                    | restricted user                                       |
| S3  | **cross-branch**: the visit reached is always the work order's own                                                                       | structural; assert no cross-branch visit is reachable |
| S4  | **over-read**: the response contains no address, phone, email, tax id or other `crm.business_partners` field beyond `displayName`        | asserted on the type **and** on a live response       |
| S5  | **no client as-at**: sending an `asOf` parameter is refused                                                                              | 422                                                   |
| S6  | **paging**: with `customerId` set and a result set spanning three pages, the union of pages equals the filtered set and no page is short | the P1-28 round-two defect, tested directly           |

### The decisive test

| #      | case                                                                                                                                                                                                                                                                         |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P8** | **ownership change does not rewrite history.** Open a work order with partner X as `service_requester`. Close it. Date X's role out and add partner Y. Re-read the closed work order: it still reports **X**. Re-read an open work order on a later visit: it reports **Y**. |

This is the test that distinguishes option A from option B, and the one that would have failed
silently under a denormalised column.

### Regression — must remain green

- `wo.work-order-list` and `wo.work-order-detail` — existing fields unchanged, existing filters unchanged.
- `apps/web/src/features/receptions/work-order-contract.ts` — a hand-transcribed, self-declared **subset** of `wo.work-order-detail`. It omits fields deliberately, so a naive equality gate goes red on legitimate code. It must not be broken by adding fields, and `BR-08`'s parity design must treat it as the live proof that deliberate omission needs a declared vocabulary.
- Any test asserting an exact key set on `WorkOrderSummary` or `WorkOrderDetail` — review each change rather than auto-applying.
- `check-authorization-coverage` / `check-openapi`: **unchanged** — no new operations.

## 13. Definition of Done

- [ ] **Zero** migrations. `grep` confirms no `customer_id` column was added to any `wo` table.
- [ ] **Zero** permission codes added; both operations resolve under `wo.work_order.read` alone, asserted by P3.
- [ ] `WorkOrderDetail.customer` and `WorkOrderSummary.customer` are nullable and carry `relationshipRole`.
- [ ] The projection reads `rec.reception_party_roles` only — `grep` confirms no `veh.vehicle_relationships` read in the work-order module.
- [ ] The read is **dated to the visit**, and P8 proves it.
- [ ] P2 passes — walk-in origin resolves.
- [ ] P4 passes in one call — the board does not fan out.
- [ ] S4 passes — no `crm` field beyond `displayName`.
- [ ] S6 passes — the filter is applied in SQL and paging is complete.
- [ ] `workshopStatus` is absent from every response shape in this slice.
- [ ] Multiple current `service_requester` rows yield a deterministic result plus `hasAdditionalParties: true`, never an arbitrary pick.
- [ ] The acceptance evidence states plainly that a closed work order reports the customer of that visit, not the vehicle's current owner.
- [ ] No file under `apps/web` is changed by this slice.
- [ ] No unresolved Critical or High finding open against this slice.
