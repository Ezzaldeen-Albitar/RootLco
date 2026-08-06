# Parts and Procurement Flow

**Status:** Planning — not implemented · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Recorded:** 2026-08-06 · **Phase authority:** P1-27 Owner-acceptance remediation

---

## 0. Read this before anything else

### 0.1 This document is planning and traceability only

**Nothing described in this document is implemented by Phase 1-27.** P1-27 is a
CRM and Vehicle Frontend phase. It builds no parts screen, no store screen, no
issue form, no supplier form, no procurement journey and no parts report. There
is no workshop-facing parts capability that a user of this product can open,
click or complete today.

Three distinct things are recorded below and they must not be read as one thing:

| what is recorded                                                                  | status                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **The intended workshop procedure** — how parts ought to be handled and traced.   | A **proposal**. Not agreed, not built, not scheduled. It binds nobody until an Owner decision and a named phase adopt it.                                                                                     |
| **Backend contracts that exist in the repository.**                               | A **statement about the repository**, verified by reading the files named in §17. That a route file exists is not a statement that any workshop capability is available to a member of staff.                 |
| **Contracts that do not exist.**                                                  | Recorded as numbered **integration findings** in §15, with the owning phase and the action required. A gap named here is a gap; no wording in this document should be read as working around one.             |

A future phase that builds any part of this must re-derive the contracts from
the repository at that time. This document is a plan and a traceability
statement, not a specification a developer may implement from without checking.

### 0.2 What this document is for

The Product Owner asked for one rule to be written down and defended: **every
part associated with a vehicle or a work order must be traceable.** This
document sets out what "traceable" would have to mean field by field, states
which of those fields the platform can already hold, and names — precisely and
without softening — the ones it cannot.

### 0.3 Audience

Workshop managers, store keepers, service advisers, and the Product Owner. It is
written for people who run a workshop, not for people who write software. Where
a technical name is unavoidable it is given once, in code font, so that a later
phase can find the exact thing being referred to.

---

## 1. Vocabulary

These are the words this document uses, each tied to the thing in the platform
that would hold it. Using them loosely is how untraceable parts get created, so
they are fixed here.

| term                     | meaning in this document                                                                                                                                             | where it would live                                                             |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Item**                 | A part, material, consumable, fluid or kit that the business has put in its own catalogue and given a stock-keeping code (SKU).                                       | `inv.item_master`                                                                |
| **Stock location**       | A physical place inside one branch that holds stock. Three kinds only: **warehouse**, **storage**, **quarantine**.                                                    | `inv.stock_locations`, `ck_stock_locations_type`                                 |
| **Quarantine**           | A location that holds damaged stock. Stock sitting there is deliberately not available to sell or fit.                                                                | `location_type = 'quarantine'`                                                   |
| **Balance**              | How much of one item sits in one location: on hand, reserved, and available.                                                                                         | `inv.stock_balances`                                                             |
| **Movement**             | One line in the permanent record of stock going in or out. Never edited, never deleted.                                                                              | `inv.stock_movements`                                                            |
| **Reservation**          | A promise that a quantity is being held. It moves nothing; it lowers what is available.                                                                              | `inv.stock_reservations`                                                         |
| **Issue**                | Stock leaving the store for a specific work order. This is the moment a part becomes work done on a vehicle.                                                          | `inv.part_issues`                                                                |
| **Return**               | Part of an issue coming back to the store. Addressed by the issue it reverses.                                                                                       | `inv.part_returns`                                                               |
| **Required part**        | A statement that a job **needs** a part. Demand only. Holds nothing and takes nothing.                                                                                | `wo.required_parts`                                                              |
| **Customer-supplied part** | The customer's own property, held in custody. Never the company's stock and never valued as such.                                                                   | `inv.customer_supplied_parts`                                                    |
| **External purchase part** | A part obtained from outside, recorded as a reference against a work order. Not a purchase order and not a goods receipt.                                           | `inv.external_purchase_parts`                                                    |
| **Opening batch**        | A counted list of what the workshop already holds on the day it starts using the system. The only way stock appears from nothing.                                     | `inv.opening_inventory_batches`                                                  |

**"Procurement" is not used loosely here.** The platform's own schema comment
records `inv.external_purchase_parts` as an ad-hoc work-order-linked external
purchase reference **only**, and states in the same sentence that it is not a
purchase-order, purchase-request, goods-receipt or bidding workflow. A database
rule, `ck_external_purchase_parts_not_procurement CHECK (is_procurement =
false)`, refuses to let it become one. Wherever this document says
"procurement", it means a capability that does not exist and would have to be
designed, decided and built.

---

## 2. The four kinds of part, and why they must never be merged

A workshop handles parts that arrive by four different routes. Their ownership,
their money and their evidence are different, so a single "parts" list that
mixed them would be wrong in a way no report could later unpick.

| kind                             | who owns it              | does it change stock?                     | what proves it happened                                            |
| -------------------------------- | ------------------------ | ----------------------------------------- | ------------------------------------------------------------------- |
| **1. Internal stock**            | The company              | **Yes** — a movement is recorded          | A movement line, an issue record, and the balance it moved          |
| **2. External purchase part**    | The company, once bought | **No** — records no movement and no balance change | An external-purchase reference against a work order        |
| **3. Customer-supplied part**    | The **customer**         | **No**, and cannot                        | A custody record against a work order                               |
| **4. Required part (demand)**    | Nobody yet               | **No**                                    | A demand line on the work order                                     |

The separation is not a convention that discipline maintains. It is built into
the database:

- `ck_customer_supplied_parts_owned CHECK (customer_owned)` means a
  customer-supplied part **cannot** be recorded as company-owned. The column
  cannot be false.
- There is no `customer_supplied` value in the list of legal movement reference
  kinds, so no stock movement could cite a customer's part even by mistake.
- `inv.item_master`'s own comment records that customer-supplied parts are not
  catalogue rows.
- `ck_external_purchase_parts_not_procurement` fixes `is_procurement` at false.

The consequence to hold on to: **a customer's alternator can never appear in the
company's on-hand balance or its valuation.** That is the ownership error the
shape exists to prevent, and it is prevented structurally rather than by
training.

---

## 3. The hard rule

> **A technician must never type an untracked free-text part as though it came
> from inventory.**
>
> A part that leaves the store is named by its catalogue item, not by its
> description. Free-text part descriptions exist in exactly one place: **inside
> the approved external-request flow**, where the part demonstrably did not come
> from the store.

### 3.1 Why the rule exists

If a part can be issued by typing its name, four things stop being true at once,
and none of them can be recovered afterwards:

| what breaks                    | consequence in the workshop                                                                                                     |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **The balance**                | On-hand quantity no longer matches what is on the shelf. Nobody can tell whether the shortfall is theft, breakage or bad typing. |
| **The vehicle history**        | "Brake disc" typed three different ways is three different parts to any report, so the same vehicle's history cannot be totalled. |
| **The cost of the job**        | An untracked part has no cost attached, so the job's true cost is understated by exactly the amount nobody recorded.             |
| **The warranty position**      | A part with no catalogue identity cannot be traced to a supplier, a batch or a warranty claim.                                   |

### 3.2 How the rule is expressed in the contracts that exist

This is the one place where the intended rule and the repository already agree,
and the agreement is worth stating precisely.

| operation (exists in the repository)          | how a part is named                                                          | free text?                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `POST /stock-issues`                          | `itemId` — a catalogue identifier. Required.                                 | **None.** The request body is closed; there is no description field.  |
| `POST /stock-reservations`                    | `itemId` — required.                                                          | **None.**                                                             |
| `POST /stock-returns`                         | `partIssueId` — the issue being reversed.                                     | **None.** Item and location are read from the issue.                  |
| `POST /damaged-stock`                         | `itemId` — required.                                                          | Reason is free text and required; the **part** is not.                |
| `POST /opening-inventory-batches/{batchId}/lines` | `itemId` — required.                                                     | **None.**                                                             |
| `POST /external-purchase-parts`               | `description` — free text, required. `itemRef` — optional.                   | **Yes, by design.** This is the approved external route.              |
| `POST /customer-supplied-parts`               | `description` — free text, required. `itemRef` — optional.                   | **Yes.** The part is the customer's; it is not catalogue stock.       |
| `POST /work-orders/{workOrderId}/required-parts` | `description` — free text, required. `itemRef` — optional.                | **Yes, but it is demand.** See §3.3.                                  |

The service behind the stock operations refuses an item that is archived or not
stock-tracked, and refuses an item that does not exist, before any movement is
attempted. Those refusals are in
`apps/api/src/modules/inventory/application/inventory-stock-service.ts`.

### 3.3 The one place the rule needs care

`POST /work-orders/{workOrderId}/required-parts` accepts a free-text
description. That is correct and must not be changed: recording that a job
**needs** two brake discs is not the same act as taking two discs off the shelf,
and a service adviser must be able to write down a need before anyone has
decided which catalogue item satisfies it.

The route's own documentation states the boundary plainly: it reserves nothing
and issues nothing, and no stock row is read or written by it.

**The risk a future screen must not create** is a parts screen that shows
required parts and issued parts in one list with no visible difference between
them. A required part is a wish; an issue is a fact about stock. A screen that
blurs the two teaches staff that typing a part name is how parts get taken —
which is the exact behaviour this rule forbids. Any future design must show the
two states as visibly different things, and must never offer "issue this" as a
one-click action that silently invents a catalogue item.

---

## 4. Internal stock: what traceability would require

### 4.1 The trust root

The record that everything else is checked against is the **movement ledger**,
`inv.stock_movements`. Three properties make it the trust root rather than
merely a log:

| property                     | how it is held                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **It cannot be edited.**     | The application database role is granted `SELECT` and `INSERT` on the table and nothing else. There is no update path and no delete path to write.                       |
| **It cannot be forged.**     | `inv.guard_stock_movement_provenance` checks every movement against the business record it claims to come from — the same item, the same location, the same quantity.    |
| **Balances must agree with it.** | `inv.guard_stock_balance_coherence` refuses any balance write where on-hand does not equal the sum of the ledger, or reserved does not equal the sum of live reservations. |

A correction is therefore a **new movement**, never an edit. This is the
property that makes a parts history worth reading years later, and it is the
reason §15 treats the absence of a correction route as a finding rather than a
minor gap.

### 4.2 The only legal movements

Five movement types and five reference kinds exist, and only seven combinations
of type, reference and direction are legal. The list is transcribed from the
database constraints in
`apps/api/src/modules/inventory/domain/inventory.ts`.

| movement type  | reference kind | direction | what it means in the workshop                                          |
| -------------- | -------------- | --------- | ----------------------------------------------------------------------- |
| `opening`      | `opening_line` | in        | Stock counted on day one and approved into the system                  |
| `issue`        | `part_issue`   | out       | A part leaves the store for a work order                               |
| `return`       | `part_return`  | in        | Part of that issue comes back                                          |
| `damage`       | `damage`       | out       | Damaged stock leaves a sellable location                               |
| `damage`       | `damage`       | in        | The same damaged stock arrives in quarantine                           |
| `adjustment`   | `adjustment`   | in        | A correction that increases stock                                      |
| `adjustment`   | `adjustment`   | out       | A correction that decreases stock                                      |

Damage legitimately produces **two** ledger lines because it is a move, not a
loss: the units still exist, they have simply stopped being available.

### 4.3 The traceability field map

This is the Owner's list, field by field. "Held today" describes the repository;
"Reachable by a user" describes what any person could actually see, which is a
different and much shorter answer.

| the Owner asked for | what would hold it                                                       | held today?                                       | reachable by a user? |
| ------------------- | ------------------------------------------------------------------------- | -------------------------------------------------- | -------------------- |
| **Part**            | `inv.part_issues.item_id` → `inv.item_master` (SKU, name, type, unit)    | Yes                                                | No screen exists     |
| **Quantity**        | `inv.part_issues.quantity`, `numeric(12,3)`                              | Yes, to three decimal places                       | No screen exists     |
| **Warehouse**       | `inv.part_issues.location_id` → `inv.stock_locations` (code, name, type) | Yes                                                | No screen exists     |
| **Issue transaction** | `inv.part_issues.id`, and the movement that cites it                   | Yes                                                | No screen exists     |
| **Issued by**       | `inv.part_issues.created_by`, and `inv.stock_movements.actor_id`         | Yes. Taken from the authenticated caller, never from the request | No screen exists |
| **Issued to**       | `inv.part_issues.work_order_id` (required), and the job through it       | Yes, as the work order                             | No screen exists     |
| **Work order**      | `inv.part_issues.work_order_id`, foreign-keyed to `wo.work_orders`       | Yes, and it cannot be null                         | No screen exists     |
| **Vehicle**         | `wo.work_orders.vehicle_id` — **not held in inventory at all**           | **Indirectly.** See §4.5                           | No screen exists     |
| **Cost**            | `inv.item_cost_details.standard_cost`; external cost held separately     | Yes, but **no route reads either**. See PROC-11    | **No**               |
| **Return / reversal** | `inv.part_returns`, addressed by the issue                             | Return: yes. Reversal of an issue made in error: **no**. See PROC-19 | No screen exists |
| **Time**            | `inv.stock_movements.occurred_at`, and `seq`                             | Yes, but it is the moment of **recording**. See below | No screen exists  |

**One caution about "time".** `occurred_at` is stamped by the database at the
moment the movement is written, and no operation offers a field in which to
supply it. So the ledger answers "when was this recorded", not "when did the
part physically leave the shelf". The two are the same only when the store keeper
records the issue as it happens. Nothing in the platform can backdate a movement
— which is the right protection against a falsified history, and at the same time
means a part issued on Friday and recorded on Monday is timed as Monday. Whether
that difference matters enough to capture a separate physical time is an Owner
decision that has not been taken.

### 4.4 Quantities and money are exact, and stay strings

This is a rule about correctness, not about programming taste, and it applies to
every future screen and every future report.

- Stock quantities are `numeric(12, 3)` — three decimal places, which is the
  place fluids and materials are counted in. Ordinary computer decimal
  arithmetic cannot represent 0.001 exactly, so a quantity is carried as an
  exact **text** value end to end and never converted to a floating-point
  number. The platform's quantity type deliberately offers no conversion to a
  number at all, so that the lossy path cannot become the convenient one.
- Money is the same: an amount is a decimal **string** accompanied by an ISO-4217
  currency code. An external part's cost is `numeric(18, 4)` with a required
  currency; an amount without a currency is not a cost.
- No exchange rate is invented anywhere. Costs recorded in different currencies
  are stored as given and are never summed.

Any future report that adds up quantities or money must preserve this. A
spreadsheet export that turns a quantity into a number has already lost the
property the ledger exists to guarantee.

### 4.5 Vehicle attribution runs through the work order

There is no vehicle column anywhere in the inventory schema. The chain is:

```
part issue → work order → vehicle
```

`wo.work_orders.vehicle_id` is required, is foreign-keyed to `veh.vehicles`, and
is in the work order's immutable column list, so it cannot be changed after the
work order is created. That makes the chain sound. It also means that **a
parts-by-vehicle view requires a join that no published operation performs**,
and that the movement ledger cannot be filtered by vehicle. Recorded as PROC-15.

### 4.6 Lists are pages, and there is no total

The platform's rule for a list is a **keyset page**: `{ items, nextCursor,
hasMore }`. There is **no `total`** field on any list, and none can be added
without a second, expensive counting query per page. The three inventory list
reads — `GET /items`, `GET /stock-availability` and `GET /stock-movements` —
follow the rule.

The workshop consequence is concrete and should be designed for rather than
worked around: a future parts screen cannot say "247 movements". It can show a
page, and it can offer "show more" while `hasMore` is true. A design that
promises a count promises something the platform does not produce.

**Two parts-related reads do not follow the rule, and a future screen must not
assume they do.**

- `GET /work-orders/{workOrderId}/required-parts` returns a bare `{ items }` with
  no cursor and no page limit, so a work order carrying a very long demand list
  returns all of it in one response. Recorded as PROC-21.
- `GET /inventory-reconciliations` is not a list at all. It is a report: it
  returns the balance cells it examined together with `cellsChecked` and
  `incoherentCells`. Those two numbers count **what this call examined**; neither
  is a total of anything the business holds, and neither may be presented as one.

---

## 5. Reserving stock

> **Sections 5 to 11 describe backend operations, not workshop capabilities.**
> Each names an operation that exists in the repository and states the rules it
> enforces. **None of them is reachable by a member of staff.** There is no
> screen, no form and no journey for reserving, issuing, returning, damaging,
> counting, taking custody of or externally buying a part, and P1-27 builds none.
> Read every table below as "this is what a future screen would have to work
> with", never as "this is what the workshop can do".

A reservation moves nothing. It reduces what is **available** so that the part a
job needs is still there when the technician reaches for it.

| point                        | detail                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operation                    | `POST /stock-reservations` — `inv.stock-reservation-create`                                                                                                                                                                  |
| Permission                   | `inv.stock.operate`                                                                                                                                                                                                          |
| Scope                        | Branch. The stock location's own company and branch are resolved and re-checked inside the transaction.                                                                                                                       |
| States                       | `active`, `released`, `consumed`, `expired`. Anything other than `active` is final and cannot change again.                                                                                                                   |
| The last-unit race           | Settled in the database under a row lock, so two people asking for the same final unit produce exactly one winner and one refusal — never two half-reservations.                                                              |
| Quarantine                   | Refused. A quarantine location cannot be reserved from, so damaged stock cannot be promised to a customer's vehicle.                                                                                                          |
| Repeat requests              | An `Idempotency-Key` is required. Repeating the same request returns the original reservation and answers 200 rather than 201, so a client that retries after a dropped connection can tell it did not reserve the stock twice. |
| Releasing                    | `POST /stock-reservations/{reservationId}/release`, same permission. Releasing an already-released reservation is harmless and changes nothing. Note that this operation is **not** declared idempotent, unlike the other writes. |

**One behaviour a future design must show honestly.** When damage is recorded
against stock that is fully reserved, the database frees whole reservations —
never part of one — until the loss fits. The service refuses the
disproportionate case outright: recording a small quantity as damaged will be
rejected if it would release reservations totalling more than the damage, with a
message telling the operator to release the affected reservations deliberately
first. A screen must surface that refusal as the meaningful business event it
is, not as a generic error.

---

## 6. Issuing a part

This is the moment company stock becomes work done on a vehicle, and it carries
more rules than any other step.

| point         | detail                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation     | `POST /stock-issues` — `inv.stock-issue-create`                                                                                                                     |
| Permission    | `inv.stock.operate`                                                                                                                                                 |
| Scope         | Branch                                                                                                                                                              |
| Required      | `workOrderId`, `itemId`, `locationId`, `quantity`                                                                                                                   |
| Optional      | `reservationId`, `requiredPartRef`                                                                                                                                  |
| Idempotency   | Required                                                                                                                                                            |

Checks the service makes before any stock moves:

1. **The work order must be able to take parts.** A work order that is closed,
   finished, or not yet allowing work is refused. The work order row is locked
   first, so a state change cannot slip in between the check and the issue.
2. **The work order and the stock must be in the same branch.** A work order in
   one branch may not consume another branch's stock.
3. **The reservation, if named, must match.** Same item, same location, same
   work order, and still active. A reservation belonging to a different item is
   refused rather than silently consumed.
4. **The issue may not exceed the reservation it consumes.** Otherwise a
   reservation would be a suggestion rather than a guarantee.
5. **The location must be sellable.** Quarantine is refused, so a damaged part
   cannot be fitted to a customer's vehicle.
6. **The item must be active and stock-tracked.**

The `requiredPartRef` field lets an issue point back at the demand line it
satisfies. That link is **not enforced by the database** — there is no foreign
key on it (PROC-14), so the pointer can be recorded but not relied upon.

---

## 7. Returning a part

| point       | detail                                                                                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operation   | `POST /stock-returns` — `inv.stock-return-create`                                                                                                          |
| Permission  | `inv.stock.operate`                                                                                                                                        |
| Required    | `partIssueId`, `quantity`. `reason` is optional.                                                                                                           |

**The return is addressed by the issue it reverses, and that is the whole
design.** There is no field in which to name a different work order, a different
item or a different location, because all three are read off the original issue.
Returning another work order's part is therefore not merely refused — it cannot
be expressed.

The ceiling — total returns may never exceed what was issued — is enforced three
times: once in the application for a readable message, once inside the
protected database function under a row lock so two simultaneous returns cannot
each claim the last unit, and once again by a trigger on the return record
itself. The trigger is the guarantee; the other two are courtesy.

---

## 8. Damaged stock

| point         | detail                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation     | `POST /damaged-stock` — `inv.damaged-stock-create`                                                                                                 |
| Permission    | `inv.stock.operate`                                                                                                                                |
| Required      | `itemId`, `fromLocationId`, `quarantineLocationId`, `quantity`, `reason`                                                                           |
| Dispositions  | `quarantined` (default), `scrapped`, `returned_to_supplier`                                                                                        |

Damage is recorded as a **move**, not as a flag. Two ledger lines are written:
out of the sellable location, in to quarantine. Damaged units therefore stop
being available because they are somewhere else, not because a later query
remembered to filter them out.

The destination is checked to be a genuine quarantine location. Moving a
"damaged" unit to another sellable location would satisfy the database's own
minimal rule that the two locations differ, and would leave the unit available —
which is precisely the inflation the design exists to prevent.

A reason is required. A damage record with no stated reason is an unexplained
stock loss.

`returned_to_supplier` is an available disposition, but no operation records the
return to the supplier, and `inv.damaged_stock` names no supplier (PROC-17).

---

## 9. Opening balances: the only way stock appears from nothing

| point       | detail                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Open a batch | `POST /opening-inventory-batches` — permission `inv.stock.operate`                                                                       |
| Add a line   | `POST /opening-inventory-batches/{batchId}/lines` — permission `inv.stock.operate`                                                        |
| Approve      | `POST /opening-inventory-batches/{batchId}/approval` — permission **`inv.adjustment.approve`**                                           |
| States       | `draft`, `approved`. An approved batch is frozen.                                                                                        |

Two controls matter to a business reader:

**The counter cannot be chosen.** Whoever opens the batch is recorded as the
person who counted it, taken from their login. The request cannot name someone
else — the field is refused if sent. Without this, one person could open a batch
"counted by" a colleague and then approve it themselves, satisfying the
separation rule on paper while defeating it in fact.

**The approver must be a different person**, enforced by the database, and
approval is what posts the movements. An empty batch cannot be approved:
approving nothing would record an approval that attests to no count, which is
worse than an error because it looks like evidence.

---

## 10. Customer-supplied parts

| point       | detail                                                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Operation   | `POST /customer-supplied-parts` — `inv.customer-supplied-part-create`                                                                |
| Permission  | **`inv.custody.manage`** — deliberately not `inv.stock.operate`                                                                      |
| Required    | `workOrderId`, `description`, `quantity`                                                                                             |
| Custody     | `received` (default), `in_use`, `returned`, `consumed`                                                                               |

Custody of somebody else's property is a different authority from operating the
company's stock, so it is a different permission. The response states
`customerOwned: true` and `affectsStock: false` explicitly rather than leaving
them to be inferred — a client that had to infer "this did not become company
stock" from the absence of a movement would eventually infer it wrongly.

A closed or finished work order takes no new custody records: attaching a part
to a completed job would change the record of what was done.

Custody state can be set once, at creation. There is no operation to move a part
from `received` to `returned`, so the moment a customer's part goes back to them
cannot be recorded (PROC-16).

---

## 11. External parts: the request, the approval, the arrival

This is the section the Owner's brief is most specific about, and it is the
section where the gap between what is asked for and what the platform can hold
is widest. It is stated plainly rather than narrowed.

### 11.1 What the single existing operation holds

| point       | detail                                                                                                                                                    |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operation   | `POST /external-purchase-parts` — `inv.external-purchase-part-create`                                                                                     |
| Permission  | `inv.external_purchase.record`                                                                                                                            |
| Scope       | Branch. Audit class **financial**, because a cost the tenant will be charged is involved even though no stock changes.                                     |
| Required    | `workOrderId`, `description`, `quantity`, and **one of** `supplierPartnerId` or `supplierName`                                                             |
| Optional    | `status`, `itemRef`, `evidenceRef`, `unitCost` (`{ amount: decimal string, currency: ISO-4217 }`)                                                          |
| Statuses    | `recorded` (default), `linked`, `cancelled`                                                                                                               |

Two behaviours are worth a workshop reader's attention:

- **Recording an external purchase is not a goods receipt.** It creates no
  purchase order, runs no approval chain, posts no movement and changes no
  balance. A part bought this way that physically arrives becomes company stock
  only through an opening batch or a stock adjustment — both of which need
  `inv.adjustment.approve` and a second person. Letting a purchase record raise
  stock directly would be an unapproved way to mint stock.
- **Cost is restricted at the database level.** The unit cost is written to a
  separate restricted record whose every access rule requires `inv.cost.view`.
  A caller without that permission is refused outright rather than having the
  cost silently dropped, and the cost is never echoed back: the response says
  only whether a cost was recorded, not what it was.

### 11.2 The Owner's external-part fields, field by field

| the Owner asked for       | what the platform can hold today                                                        | verdict           | finding  |
| ------------------------- | ---------------------------------------------------------------------------------------- | ----------------- | -------- |
| **Requested part**        | `description` (free text, required) plus optional `itemRef`                             | Held              | —        |
| **Supplier where approved** | `supplierPartnerId` **or** `supplierName`; one is required                             | Held, but unconstrained — see PROC-05 | PROC-05 |
| **Requested by**          | `created_by`, taken from the authenticated caller                                        | Held              | —        |
| **Approval**              | Nothing. No approver field, no approval route, no permission covering it                | **Missing**       | PROC-01  |
| **Expected date**         | Nothing. No such column exists                                                           | **Missing**       | PROC-02  |
| **Received state**        | Only `recorded`/`linked`/`cancelled`, set once at creation. No `received`, no update route | **Missing**     | PROC-03  |
| **Cost**                  | `unitCost` amount plus ISO currency, restricted by `inv.cost.view`                       | Held, unreadable  | PROC-11  |
| **Vehicle / work order**  | `workOrderId` required and foreign-keyed; vehicle through the work order                 | Held              | PROC-15  |
| **Attachment**            | `evidenceRef` is an unconstrained identifier with no link to the document store          | **Not a real link** | PROC-07 |
| **External invoice / reference** | Nothing. No supplier invoice number, order number or receipt reference            | **Missing**       | PROC-06  |
| Reading any of it back    | No list operation and no detail operation exist                                          | **Missing**       | PROC-04  |

### 11.3 What a workshop would therefore have to do today

Nothing in the platform, because no screen exists. The record above is what a
future phase would find if it started building one. Four of the ten fields the
Owner named have nowhere to go, and a recorded external purchase cannot be read
back at all — so even the fields that are held would be invisible.

**This section must not be worked around.** A future design that adds an
approval by writing "approved by" into the free-text description, or an expected
date into the description, would produce exactly the untraceable record §3
forbids — the same failure as a free-typed stock part, one step further along.

---

## 12. The closure interlock

The one place where parts already govern the rest of the workshop.

A work order cannot be **closed** while stock is still committed to it. Before a
closing transition is allowed, and inside the same locked transaction, the
platform counts two things against that work order:

| counted                | meaning                                                                    |
| ---------------------- | --------------------------------------------------------------------------- |
| Active reservations    | Stock still being held for this job                                        |
| Open issues            | Parts issued to this job where the returned quantity is still less than the issued quantity |

If either is above zero, closure is refused with a message naming both numbers
and telling the operator to release or return them first.
`GET /work-orders/{workOrderId}/closure-eligibility` reports the same two counts
in advance, so an operator learns the position before attempting to close rather
than one refusal at a time.

Two details a future screen must reproduce faithfully:

- **Cancelling is exempt.** Abandoning work is not certifying it complete, and
  stock outstanding on an abandoned job is a different problem that this
  interlock deliberately does not solve.
- **Eligibility is advisory.** The number is read at one moment; the enforcement
  happens inside the transaction that changes the state. A screen must never
  present eligibility as a promise that closing will succeed.

---

## 13. Who is allowed to do what

Eleven permission codes govern parts. Every one is quoted from
`supabase/seeds/04_iam_permission_catalog.sql`. There is no wildcard permission
and no administrator code — authorisation is always by permission, never by job
title.

| code                          | risk   | catalogue description                             | used by an operation today?                          |
| ----------------------------- | ------ | ------------------------------------------------- | ----------------------------------------------------- |
| `inv.item.read`               | low    | Search and read the item catalog                  | Yes — `GET /items`                                    |
| `inv.item.manage`             | medium | Manage item master, categories, UoM               | **No route uses it** (PROC-08)                        |
| `inv.stock.read`              | low    | Read stock balances and movements                 | Yes — availability and the ledger                     |
| `inv.stock.operate`           | medium | Post movements, reserve, issue, return            | Yes — seven operations                                |
| `inv.adjustment.approve`      | high   | Approve stock adjustments/opening batches         | Yes — opening-batch approval only (PROC-10)           |
| `inv.cost.view`               | high   | View item/purchase/adjustment cost                | **No route uses it**, though the database enforces it (PROC-11) |
| `inv.custody.manage`          | medium | Record custody of customer-supplied parts         | Yes — customer-supplied parts                         |
| `inv.external_purchase.record` | medium | Record ad-hoc external purchase references       | Yes — external purchase parts                         |
| `inv.audit.read`              | high   | Read inventory reconciliation evidence            | Yes — reconciliation                                  |
| `wo.work_order.line.manage`   | medium | Record service lines and required-part demand     | Yes — recording a required part                       |
| `wo.work_order.read`          | low    | Read work orders, their jobs and their history     | Yes — the required-part list and closure eligibility  |

The seven operations behind `inv.stock.operate` are: reserving stock, releasing a
reservation, issuing a part, returning a part, recording damage, opening a
counting batch, and adding a line to one. Approving that batch is deliberately
not among them — see below.

Two observations for the Owner.

**Recording demand and taking stock are different authorities.** A service
adviser holding `wo.work_order.line.manage` can write down that a job needs a
part. Taking it off the shelf needs `inv.stock.operate`, which is a different
grant. That separation is what makes §3 enforceable rather than aspirational.

**Approving is separated from operating.** Opening balances are posted by
`inv.adjustment.approve`, held by someone other than the person who counted.

### 13.1 Scope

Every parts operation is **branch**-scoped except `GET /items`, which is
**tenant**-scoped because the item catalogue has no branch of its own — an item
is catalogue reference data for the whole tenant, while the stock of that item
is a branch question answered by `GET /stock-availability`.

Both `GET /stock-availability` and `GET /stock-movements` require the company
and branch to be named. They are not conveniences: naming the pair is what makes
the branch check evaluate against the branch actually being read. Omitting them
was found to leak one branch's stock to a caller who merely had some grant in
another, and the parameters were made mandatory as a result.

---

## 14. What the platform records when a part moves

Three separate trails are written, in the same single commit as the business
record. There is no publish-after-commit step, because that is precisely the
window in which a crash loses the evidence.

| trail                | what it is for                                                       | entries relevant to parts                                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The movement ledger** | The permanent record of stock in and out                          | One line per movement; two for damage                                                                                                                                                       |
| **The audit trail**  | Who did what, when                                                    | `inv.stock.reserved`, `inv.stock.reservation_released`, `inv.part.issued`, `inv.part.returned`, `inv.stock.damaged`, `inv.opening_batch.created`, `inv.opening_batch.approved`, `inv.customer_supplied_part.recorded`, `inv.external_purchase.recorded` |
| **The event stream** | Telling other parts of the system                                     | `stock.reserved`, `stock.reservation.released`, `stock.movement.posted`                                                                                                                     |

Two points of substance:

- **Reading the ledger is itself audited.** `GET /stock-movements` records an
  audit entry naming the filter used and the number of rows returned — never the
  rows themselves, because copying stock levels into the audit table would
  duplicate the very data the audit protects. A bulk read of what a branch holds
  is exactly the reconnaissance an audit trail exists to catch.
- **A no-op writes nothing.** Releasing an already-released reservation records
  no audit entry and publishes no event, because the trail must not claim a
  state change that never happened.

`GET /inventory-reconciliations` re-derives stored balances from the ledger and
reports where the two disagree. Because the coherence guard should make
disagreement structurally impossible, a non-zero count is evidence that the
guard was bypassed — a security finding, not routine drift. It is therefore
reported and never silently repaired: repairing it would destroy the only
evidence that it happened.

**One limit a future report must state honestly.** The operation requires a
company and a branch, and it examines at most one page of balance cells per
call — the same page ceiling every other read uses. So a single call is evidence
about the cells it looked at in one branch, not a clean bill of health for the
business. `cellsChecked` says how many cells this call examined. A report that
presented one call as "inventory reconciled" would be asserting far more than the
operation performed.

---

## 15. Integration findings

These are numbered in a `PROC-` series so they cannot be confused with the
`P1-27-INT-###` findings already allocated in
`docs/phase-1/phase-1-27/canonical-plan.md`. **None of these numbers is
registered in any phase register.** Recording them here is a request for an
Owner decision on which to adopt, not an assertion that any is scheduled.

"Owning Backend phase" names the phase that would own the change if the Owner
adopts the finding. Where a domain does not exist at all, that is written as
such rather than guessed at.

| finding     | what is missing                                                                                                                                                                                                                       | owning Backend phase                             | owning Frontend phase                     | required action                                                                                                                                    |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PROC-01** | No approval on an external part request. `inv.external_purchase_parts` has no approver, no approved-at and no decision column; no route records an approval; no permission code covers approving one.                                  | Not allocated — no procurement phase exists      | Not allocated                              | Owner decides whether an external part needs approval, and at what value. Then a Backend phase adds the columns, the route and the permission code. |
| **PROC-02** | No expected date. `inv.external_purchase_parts` has no expected-arrival column.                                                                                                                                                       | Not allocated                                    | Not allocated                              | Owner decides whether an expected date is required. A Backend phase adds the column and exposes it.                                                |
| **PROC-03** | No received state. `ck_external_purchase_parts_status` admits only `recorded`, `linked`, `cancelled`, and only `POST` exists — so status cannot be changed after creation. Arrival cannot be recorded.                                 | Not allocated                                    | Not allocated                              | Owner decides the arrival vocabulary. A Backend phase widens the constraint and adds an update operation.                                          |
| **PROC-04** | No read of an external purchase. `POST /external-purchase-parts` is the only operation; there is no list and no detail read. A recorded external purchase cannot be retrieved.                                                          | P1-21 (owner of the inventory surface)           | Not allocated                              | Add a list and a detail read with a read permission, then a screen may exist.                                                                       |
| **PROC-05** | Supplier identity is unconstrained. `supplier_partner_id` has **no foreign key** in any migration, and `supplier_name` is free text. Separately, `crm.partner_roles.role_type` admits `supplier`, but no CRM route writes that table.  | P1-21 (the key) and P1-16 (supplier as a partner) | Not allocated                              | Owner decides whether suppliers are business partners. If so, P1-16 exposes partner-role management and P1-21 adds the foreign key.                 |
| **PROC-06** | No supplier invoice or external reference. Nothing on `inv.external_purchase_parts` holds an invoice number, order number or receipt reference.                                                                                        | Not allocated                                    | Not allocated                              | Owner decides what external reference must be captured. A Backend phase adds it.                                                                    |
| **PROC-07** | `evidence_ref` is not a document link. The column carries no foreign key on `inv.external_purchase_parts`, `inv.customer_supplied_parts` or `inv.damaged_stock`. Reachability of a document is defined by a live `shared.document_links` row; nothing connects the two. | P1-15 (documents) with P1-21          | Not allocated                              | Decide whether parts evidence uses document links. **`P1-OD-025` binds this** — see §16.                                                            |
| **PROC-08** | No item catalogue management. `inv.item.manage` is seeded but no route uses it; no operation creates or edits an item, a category or a unit of measure.                                                                                | P1-21                                            | Not allocated                              | Add catalogue management operations. Until then no part can be catalogued through the product.                                                      |
| **PROC-09** | No stock-location management. No operation creates or edits `inv.stock_locations`, and no permission code covers it — yet every stock operation names a location.                                                                      | P1-21                                            | Not allocated                              | Add location management operations and a permission code.                                                                                           |
| **PROC-10** | No stock-adjustment surface. `inv.stock_adjustments`, `inv.stock_adjustment_details` and the approval function have no route. The documented route out of quarantine is an approved adjustment, and that route does not exist.        | P1-21                                            | Not allocated                              | Add adjustment create and approve operations under `inv.adjustment.approve`.                                                                        |
| **PROC-11** | Cost cannot be read. No operation reads `inv.item_cost_details` or `inv.external_purchase_part_details`; `inv.cost.view` is seeded and enforced by the database but used by no route. A part's cost is unreachable.                    | P1-21                                            | Not allocated                              | Add a cost read gated on `inv.cost.view`. Owner confirms who may see cost.                                                                          |
| **PROC-12** | No read for issues, returns, reservations, damage, custody or opening batches. The inventory reads are the item catalogue, availability, the movement ledger and reconciliation; the only other parts read anywhere is the work order's required-part list. Not one operation record can be retrieved. | P1-21                       | Not allocated                              | Add the reads a parts screen would need before any parts screen is scheduled.                                                                       |
| **PROC-13** | The work-order filter on the ledger is partial. `GET /stock-movements?workOrderId=` matches only `part_issue` and `part_return` movements; `opening`, `damage` and `adjustment` movements can never be attributed to a work order by it. | P1-21                                           | Not allocated                              | Decide whether damage and adjustment should be attributable to a job, then widen or document the filter.                                            |
| **PROC-14** | `inv.part_issues.required_part_ref` has no foreign key, so an issue's claim to satisfy a particular demand line is recorded but not enforced.                                                                                          | P1-21 with P1-19                                 | Not allocated                              | Add the foreign key, or state in the contract that the pointer is advisory.                                                                          |
| **PROC-15** | No vehicle attribution inside inventory. There is no vehicle column in any `inv` table and no vehicle filter on the ledger; the only path is a join through the work order that no operation performs.                                 | P1-21 with P1-17                                 | Not allocated                              | Add a parts-by-vehicle read, or accept that parts history is reachable only per work order.                                                          |
| **PROC-16** | No custody transition. `custody_state` admits four values but only creation exists, so returning a customer's part to them cannot be recorded.                                                                                         | P1-21                                            | Not allocated                              | Add a custody transition operation and decide who may perform it.                                                                                    |
| **PROC-17** | No supplier-return path for damaged stock. `returned_to_supplier` is a valid disposition, but no supplier is named on `inv.damaged_stock`, the disposition is set once, and no operation records the return.                            | P1-21                                            | Not allocated                              | Decide whether supplier returns are in scope. If so, a Backend phase adds the supplier reference and the operation.                                 |
| **PROC-18** | No procurement domain exists. There is no purchase order, purchase request, goods receipt, supplier price list or bidding table in any schema, and the schema explicitly declines to become one.                                       | No phase — the domain does not exist              | No phase                                   | Owner decides whether procurement is in scope for this product at all. See §16.3.                                                                    |
| **PROC-19** | No correction path for an issue recorded in error. The ledger cannot be edited, returns require the parts physically to come back, and the adjustment route that would express a correction has no operation (PROC-10).                | P1-21                                            | Not allocated                              | Deliver PROC-10, and decide who may approve a correction.                                                                                            |
| **PROC-20** | No reorder point, minimum stock level, maximum level or supplier lead time exists anywhere in the schema. Nothing can tell a store keeper that a part is running out.                                                                  | Not allocated                                    | Not allocated                              | Owner decides whether stock replenishment is in scope. It is a design decision before it is a build.                                                 |
| **PROC-21** | `GET /work-orders/{workOrderId}/required-parts` returns a bare `{ items }` with no cursor and no page limit, so it does not follow the platform's keyset-page rule and a long demand list is returned whole. See §4.6.                | P1-19                                            | Not allocated                              | Convert the response to `{ items, nextCursor, hasMore }` before any screen consumes it.                                                              |

**Twenty-one findings.** Nine of them — PROC-04, PROC-08, PROC-09, PROC-10,
PROC-11, PROC-12, PROC-15, PROC-16 and PROC-19 — are missing operations over
tables, columns and database functions that already exist: the work is to publish
a route and gate it, not to design anything new. The other twelve need a schema
change, a whole missing domain, or an Owner decision first. The shape of the
whole list is that the parts domain can record what happens and can prove it
happened, and can show almost none of it back.

---

## 16. Open decisions and boundaries

### 16.1 `P1-OD-017` — duplicate and merge rules · **OPEN**

Not directly a parts decision, but it binds any future parts screen that shows a
supplier or a customer as a business partner: while the duplicate and merge
rules are open, no merge action of any shape may be offered. If PROC-05 is
adopted and suppliers become business partners, they inherit that constraint —
two records for the same supplier could not be merged until the decision is
taken.

### 16.2 `P1-OD-025` — document and media policy · **OPEN**

This binds **PROC-07 directly.** Parts evidence — a photograph of a damaged
part, a supplier's delivery note, an external invoice — is media, and the media
policy is undecided. Accepted file types, size limits and storage are all open.

Two facts that the decision must be taken against, not around:

- Upload is **authorisation-only**. The platform issues an authorisation and the
  file itself goes to a storage provider; no operation accepts a file body.
- There is no document list or search. A document is reachable only through a
  live link from a business record, or by knowing its identifier.

No parts screen may offer an upload while `P1-OD-025` is open.

### 16.3 Buying a procurement system or a parts-data service is the Owner's decision

Two possibilities will come up as soon as PROC-18 or PROC-20 is discussed:
buying a procurement or purchase-order system, and subscribing to a commercial
parts-catalogue or parts-pricing data service.

**Both are commercial decisions reserved to the Product Owner.** This document
recommends neither and endorses no vendor. What it can properly recommend is an
**evaluation** — a written comparison of what each option would cover against
the findings in §15, what it would cost, what it would lock the business into,
and what would have to be built anyway. An evaluation is technical work; a
purchase is not, and nothing in this document should be read as authorising one.

No vendor price, subscription fee or licence cost appears anywhere in this
document. Every such figure is **not established**.

---

## 17. Numbers that are not established

Stated explicitly so that no future reader mistakes silence for zero.

| number                                                | status              | what would establish it                                                                             |
| ----------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------- |
| Expected turnaround for an externally bought part     | **Not established** | An Owner decision on whether an expected date is captured (PROC-02), then real data once it is       |
| Supplier lead times                                   | **Not established** | No column holds one (PROC-20). A supplier agreement and a place to record it                          |
| Reorder points and minimum stock levels               | **Not established** | An Owner decision that replenishment is in scope, then a Backend phase                                |
| Value threshold above which an external part needs approval | **Not established** | An Owner decision (PROC-01). No approval limit for parts exists in the platform today            |
| Cost of any parts-data or procurement service         | **Not established** | An evaluation, per §16.3. Never a figure invented here                                                |
| How many parts a typical work order consumes          | **Not established** | Real operating data. No business data exists in this platform, by standing policy                     |
| How long parts records must be retained               | **Not established** | A retention decision. Retention classes exist in the platform; no parts retention class is decided    |

---

## 18. Source register

Every claim above was read from these files on branch
`remediation/p1-27-owner-acceptance-ux`. Paths are relative to the repository
root.

| area                          | files read                                                                                                                                                                                                                                                                                        |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inventory vocabulary and rules | `apps/api/src/modules/inventory/domain/inventory.ts`                                                                                                                                                                                                                                             |
| Inventory behaviour           | `apps/api/src/modules/inventory/application/inventory-stock-service.ts`, `.../inventory-intake-service.ts`, `.../inventory-read-service.ts`                                                                                                                                                        |
| Inventory data access         | `apps/api/src/modules/inventory/data/inventory-repository.ts`                                                                                                                                                                                                                                     |
| Inventory operations          | `apps/api/src/app/api/v1/items/route.ts`, `.../stock-availability/route.ts`, `.../stock-movements/route.ts`, `.../stock-reservations/route.ts`, `.../stock-reservations/[reservationId]/release/route.ts`, `.../stock-issues/route.ts`, `.../stock-returns/route.ts`, `.../damaged-stock/route.ts`, `.../customer-supplied-parts/route.ts`, `.../external-purchase-parts/route.ts`, `.../opening-inventory-batches/route.ts`, `.../opening-inventory-batches/[batchId]/lines/route.ts`, `.../opening-inventory-batches/[batchId]/approval/route.ts`, `.../inventory-reconciliations/route.ts` |
| Work-order interlock          | `apps/api/src/modules/work-order/application/work-order-service.ts`, `apps/api/src/app/api/v1/work-orders/[workOrderId]/required-parts/route.ts` (both the `POST` and the `GET`), `apps/api/src/app/api/v1/work-orders/[workOrderId]/closure-eligibility/route.ts`                                  |
| Page shape                    | `apps/api/src/server/db/pagination.ts`                                                                                                                                                                                                                                                            |
| Document links                | `apps/api/src/app/api/v1/attachments/documents/[documentId]/links/route.ts`                                                                                                                                                                                                                       |
| Schema                        | `supabase/migrations/20260723093000_inv_reference.sql`, `20260723094000_inv_ledger.sql`, `20260723095000_inv_operations.sql`, `20260722095000_wo_work_orders.sql`, `20260722100000_wo_services_parts_approvals.sql`, `20260723097000_wo_forward_fks.sql`, `20260718102000_shared_document_links.sql`, `20260719093000_crm_partner_roles.sql` |
| Permissions                   | `supabase/seeds/04_iam_permission_catalog.sql`                                                                                                                                                                                                                                                    |
| Prior contract archaeology    | `docs/phase-1/phase-1-21/wave-1-contract-archaeology.md` (referenced by the code above; the defects it records are cited by their identifiers `P1-21-D-01`, `D-02`, `D-03`)                                                                                                                        |

Counts stated in this document — fourteen published inventory operations, of
which seven are gated on `inv.stock.operate`; eleven parts-related permission
codes; seven legal movement combinations; and twenty-one integration findings —
were derived by reading the files above. No count in this document is estimated.
