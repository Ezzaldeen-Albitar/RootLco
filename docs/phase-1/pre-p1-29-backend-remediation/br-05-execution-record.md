# BR-05 — execution record

Work-Order Customer and Vehicle Context Projection. Closes `BE-3`, `DEP-B3`,
finding `INS-10` (**CRITICAL**, P1-27 `INT-036`) and Owner requirement 2.

|                      |                                                                                                    |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| Contract             | [br-05-work-order-customer-context-projection.md](br-05-work-order-customer-context-projection.md) |
| Branch               | `remediation/p1-29-backend-work-order-customer-context`                                            |
| Depends on           | **nothing**                                                                                        |
| Migrations           | **zero**                                                                                           |
| New permission codes | **zero**                                                                                           |
| New operations       | **zero** — two existing reads return more                                                          |

---

## 1. What this slice is for

A work order did not expose its customer. `WorkOrderDetail.workOrder` was
`{id, companyId, branchId, receptionVisitId, vehicleId, kind, state,
partsForwardState, displayNumber, openedAt, recordVersion}` — ids and a
lifecycle, and nothing that answers a service advisor's first question: **whose
car is this**. The board had no customer column and no customer filter.

**No customer column exists in any of the 44 `wo`/`dia`/`tech`/`qms` tables**, and
none was added. The relationship was already modelled, on the other side of a
module boundary:

```
wo.work_orders.reception_visit_id → rec.reception_visits
                                  → rec.reception_party_roles → crm.business_partners
```

## 2. A read projection, and why the alternatives fail

**Option B — a `wo.work_orders.customer_id` column — was rejected**, and the
argument is not aesthetic. It needs a migration, a backfill with no honest
source, and it becomes a second source of truth that disagrees with
`rec.reception_party_roles` the moment a role is corrected.

That failure mode has a **shipped precedent in the very table it would have been
added to**: `wo.work_orders.parts_forward_state` is CHECK-constrained, projected
by reads, and written by **nothing** (`INS-16`) — permanently `'none'`. A stale
`customer_id` would be strictly worse, because an inert value is merely useless
while a wrong customer is a wrong answer.

**Option C — resolving client-side — is forbidden by `DEP-B3`** and would need
`rec.reception.read` **and** `apt.appointment.read` on top of `wo.work_order.read`,
cost two or three round trips per row (so it could never feed a board column), and
would not exist for walk-ins at all.

The projection is resolved through a **reception port**, on the
`OpenInventoryCommitments` precedent — an inventory-owned type embedded in a
work-order response, resolved by inventory. `PartyContextRepository` lives in
`reception` because `rec` and `crm` are reception's tables to answer for.

## 3. Dating is the mechanism, not good behaviour

`rec.reception_party_roles` carries `valid_from`/`valid_to`, and
`tg_reception_party_roles_immutable` guards `partner_id`, `relationship_role` and
`valid_from`. **A correction cannot mutate a row; it can only write a new one and
date the old one out.** So:

- a query reading `valid_to IS NULL` returns **today's** answer;
- a query reading as at a fixed instant returns **that instant's** answer.

Only the second satisfies `BE-3`. **P8 is the test that tells the two designs
apart**, and it is asserted in both directions — a correction landing after an
order was opened must not move it, and a correction landing before must be what a
new order reports. One direction alone would pass against a projection that
always returned the oldest row and never moved at all.

## 4. The reference instant, and a deliberate reading of the contract

The contract says the reference instant is _the visit's_. **This slice uses the
work order's `opened_at`**, and the difference is worth stating rather than
glossing.

A party role recorded a few minutes into intake carries a `valid_from` **after**
the visit row was created. Reading as at `rec.reception_visits.created_at` would
therefore evaluate `valid_from <= created_at` as false and report `customer: null`
for a visit that plainly has a customer.

`opened_at` is:

- **server-derived** — never client-supplied, which is the property the contract
  actually requires (a client `asOf` would be an oracle and a way to read a role
  out of its window; `.strict()` refuses one, asserted by S5);
- **fixed for the life of the work order**, so a closed order's answer never moves;
- **at or after the roles were assigned**, because the work order is created by
  converting the visit;
- the instant at which _that work order's_ customer was the current one — which is
  the question being asked.

## 5. What the response says, and what it deliberately does not

`customer` is `{partnerId, displayName, relationshipRole, hasAdditionalParties}`
or **null**, and the null case is real: `rec.reception_party_roles` requires at
least one `service_requester` before _activation_, as a deferred contract, so a
visit can legitimately exist without one (N3).

- **`relationshipRole` is always present.** `vehicle_owner` is a different
  question and may be a different party — that is why the table carries a
  seven-value taxonomy — so a name rendered without the role would be a claim the
  data does not support.
- **The seven values are not `veh.vehicle_relationships`' seven.** Only `payer`
  and `service_requester` overlap (`C-04`). The projection reads
  `rec.reception_party_roles` only; `grep` confirms the work-order module contains
  no `vehicle_relationships` read.
- **`hasAdditionalParties`** exists because `uq_reception_party_roles_active` is
  unique on (visit, partner, role) and therefore permits two _different_ partners
  in one role. The query returns the earliest `valid_from` deterministically and
  flags the rest, rather than handing back an arbitrary one of two.
- **`displayName` is the only `crm.business_partners` column projected.** No
  address, no contact point, no tax id, no other vehicle, no other visit. S4
  asserts the customer block's key set in **both directions**, because
  NFR-PRV-001 forbids projecting a restricted identifier and a field-by-field
  check cannot catch an addition.
- **`veh.vehicles.workshop_status` is absent.** Nothing in `wo`/`dia`/`tech`/`qms`
  maintains it (`INS-39`), so publishing it would render a field this domain never
  updates beside a lifecycle it does.

## 6. The filter, and the paging defect it had to avoid

`customerId` matches a partner in **any** role on the work order's visit — wider
than the role reported, deliberately: a customer search wants every car that
customer is connected to, and a payer or an authorized receiver is such a
connection.

It is a **selector, not an authorization claim**. It narrows a result set the
caller is already entitled to, so a partner from another tenant matches nothing
and the answer is **200 with an empty page** — not 404, not 403 (S1).
Empty-page-not-404 closes the oracle: a caller cannot distinguish "this customer
has no work orders here" from "this customer is not in your tenant".

**It is applied in SQL, before the keyset window.** Post-filtering a fetched page
produces short pages and a `hasMore` that lies — the P1-28 round-two defect
exactly — so S6 pages the filtered set at `limit=1` with non-matching orders
interleaved, asserts every page with `hasMore` is full, and reconciles the union.
`EXISTS` rather than a join, because a partner may hold several roles on one visit
and a join would return the work order once per role.

## 7. Both context reads are batched

Two statements per page, whatever its size. A per-row lookup would make the board
an N+1 — which is the specific defect option C was rejected for, and it would be
absurd to rebuild it on the server. P4 renders a page with a customer block for
every row in **one** call.

## 8. Permission model

**Nothing minted, nothing widened.** Both operations still resolve under
`wo.work_order.read` alone, and **P3 asserts it with `READER`** — a principal
holding that single code and nothing else.

**Is it an over-read?** No, and the argument belongs in the record because it will
be asked. The projection exposes _the customer of this work order_ — a fact about
the work order, to a caller already entitled to read the work order. It does not
expose the customer record: no address, no contact details, no other vehicles, no
other visits. A caller wanting those still needs `crm.*`. `iam.sensitive.view` is
not involved because no restricted sidecar is touched; if a future requirement
adds a phone number here, that changes, and it must then be a separate adapter
behind its own check (`T-04`) rather than a widened projection.

## 9. The thing to say plainly

**A closed work order reports the customer who brought the car _then_, not the
vehicle's current owner.** That is the correct behaviour, it is what makes
work-order history transactional and independent, and **it will look like a bug to
someone who expects otherwise.** Correcting a party role does not redact it from
closed work orders — a former service requester stays visible on the history they
were part of.

## 10. Four fixture defects the first run surfaced

Each is a real fact about the schema, and each is recorded because the failure
looked like a defect somewhere else:

1. **`ck_reception_party_roles_window` is `valid_to > valid_from`.** A fixture
   closing a row "an hour ago" on a visit created seconds earlier is refused
   outright. The cut instant is now derived from the row being superseded.
2. **`COMPANY_A1`/`BRANCH_A1` come from `./helpers`, not `./p1-19-helpers`.**
   Importing them from the wrong module made every list query
   `companyId=undefined` — a 422 that read as a validation defect in the route.
3. **A tenant-B work order needs `COMPANY_B1`/`BRANCH_B1`**;
   `fk_walk_in_references_branch` says so.
4. **The over-read scan was body-wide and flagged `displayNumber`**, which is the
   _work order's_ own number and merely shares a name with
   `crm.business_partners.display_number`. Scoped to the customer block, which is
   what the claim is about.

## 11. Evidence

| tier                                       | result                                                                            |
| ------------------------------------------ | --------------------------------------------------------------------------------- |
| BR-05 suite                                | **15 / 15**                                                                       |
| Typecheck (api + root)                     | exit 0                                                                            |
| Format (root **and** `apps/api` workspace) | clean                                                                             |
| Module boundaries                          | OK — and `reception` does not import `work-order`, so the new edge is not a cycle |
| `verify:contracts`                         | green; operations **325** and paths **263**, both unchanged                       |

Definition-of-Done greps, run rather than asserted:

- no `customer_id` column added to any `wo` table — `git diff` over `supabase/`
  returns nothing;
- no `vehicle_relationships` read anywhere in `apps/api/src/modules/work-order`;
- no file under `apps/web` changed by this slice.

## 12. Deliberately out of scope

Named because the contract names them: `displayNumber` search and a `vehicleId`
filter (both `INS-02`, a different feature — bundling them would put two changes
behind one review), a `customer` block on `JobView` (a job inherits its work
order's customer, and duplicating it invites the two to diverge in a client
cache), and resolving `actor_id` to a name in history (no directory contract
exists — `admin.contractGap.noDirectory`).
