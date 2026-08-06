# Pricing, Approval, Accounting, Payment and Delivery

**Status:** Planning — not implemented · **Owner:** Eng. Ezzaldeen Al-Bitar ·
**Recorded:** 2026-08-06 · **Phase authority:** P1-27 Owner-acceptance remediation

---

## 0. Planning and traceability only

**Nothing described in this document is implemented by Phase 1-27.**

P1-27 is the CRM and Vehicle Frontend phase. Its executable scope is `apps/web/**`
and it is forbidden from entering `apps/api/src/**` or `supabase/**`. No screen,
no form, no button and no report for pricing, approval, accounting, payment or
delivery is delivered by P1-27, and this document does not authorise one.

What this document is:

| It is                                                                                                            | It is not                                                          |
| ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| A written record of the commercial and handover process the workshop needs                                       | A specification of anything P1-27 builds                           |
| A statement of which server contracts already exist, read out of the repository                                  | A claim that a user interface exists for any of them               |
| A register of the gaps between the process and the contracts, so a later phase inherits them instead of finding them | A design, a wireframe, or an approved policy                       |
| A place where undecided commercial policy is named, never written around                                         | A decision. No decision reserved to the Product Owner is taken here |

Where this document says an operation, permission, table, column or status value
**exists**, that means it was read out of this repository on the branch
`remediation/p1-27-owner-acceptance-ux`. Where it says something **does not
exist**, that means a search of the same sources found nothing, and the absence
is recorded as a numbered integration finding in §13.

---

## 1. How to read this document

### 1.1 Where every contract in this document was read from

| Contract kind          | Source read                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------- |
| Operations and permissions | `apps/api/src/app/api/v1/**/route.ts` — the `defineOperation({...})` block     |
| Business rules         | `apps/api/src/modules/*/domain/*.ts`                                               |
| Process orchestration  | `apps/api/src/modules/*/application/*.ts`                                          |
| Database access        | `apps/api/src/modules/*/data/*.ts`                                                 |
| Permission catalogue   | `supabase/seeds/04_iam_permission_catalog.sql`                                     |
| Tables and constraints | `supabase/migrations/*.sql`                                                        |
| Prior phase contracts  | `docs/phase-1/phase-1-11/*`, `docs/phase-1/phase-1-20/*`                           |

### 1.2 Audience and register

Written for workshop managers, service advisers, accounts staff and the Product
Owner. Where a technical name is unavoidable — a permission code, an operation
path, a status value — it is given exactly, because an approximate name is worse
than none: a previous documentation wave invented a permission called
`veh.vehicle.create`, the catalogue check refused it, and the real code is
`veh.vehicle.manage`.

### 1.3 Owning phases named in this document

| Phase     | What it owns                                                          | Standing        |
| --------- | --------------------------------------------------------------------- | --------------- |
| **P1-10** | Service catalogue, pricing and quotation database                     | Closed          |
| **P1-11** | Billing, payment, delivery, warranty and reporting database           | Closed          |
| **P1-19** | Work Order, diagnostics and technician backend                        | Closed          |
| **P1-20** | Service catalogue, pricing and quotation backend                      | Closed          |
| **P1-21** | Inventory backend                                                     | Closed          |
| **P1-22** | Billing, payment, delivery and warranty backend                       | Closed          |
| **P1-29** | Work Order frontend                                                   | Not started     |
| **P1-30** | Service catalogue, pricing, quotation and inventory frontend          | Not started     |
| **P1-31** | Billing, payment, delivery and warranty frontend                      | Not started     |

P1-28 (appointment and reception frontend), P1-29, P1-30 and P1-31 are named in
closed phase records as the frontend counterparts of the backend phases above.
No task register, no scope statement and no start date for any of them is
established in this repository.

---

## 2. The money rule

**This is the single rule in this document that must never be relaxed.**

> Money is a **decimal string** together with an **ISO 4217 currency code**.
> It is never a JavaScript number, never a floating-point value, and never an
> amount without its currency.

The reason is not stylistic. Every money column in the accounting schema is
`numeric(18,4)`, and `numeric` holds values that IEEE-754 double-precision cannot
represent. A JSON number would lose money for some inputs, and the loss would be
silent and would not repeat reliably enough to be found by testing.

### 2.1 What the rule means in practice

| Rule                                                                                              | Where it is stated                                                                          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| An amount crosses the boundary as `{ amount: string, currency: string }`                          | `MoneyView` in `apps/api/src/modules/pricing/domain/money.ts`                                |
| `currency` is validated by shape: exactly three uppercase letters                                 | `assertCurrencyCode`, same file                                                             |
| Two amounts in different currencies cannot be compared; the comparison fails deterministically    | `Money.assertSameCurrency`, same file                                                       |
| There is no currency conversion method anywhere, so silent conversion is unexpressible            | Same file. Foreign exchange is out of Phase 1 scope                                         |
| `numeric` and `bigint` values arrive as **strings** and stay strings, end to end                  | Repository layer casts every money and quantity column with `::text`                        |
| The application performs no authoritative arithmetic. PostgreSQL is the only calculation engine   | `Money` deliberately exposes no `add` and no `multiply`                                     |
| A quantity is `numeric(12,3)`; a tax rate is `numeric(9,6)`; an odometer reading is `numeric(12,1)` | `apps/api/src/modules/pricing/domain/decimal.ts`, `.../delivery/domain/delivery.ts`         |
| An amount more precise than the currency's minor unit is refused, by string comparison only       | `assertMinorUnitScale` in `apps/api/src/server/http/validation.ts`                          |

The minor-unit rule earns its place with a concrete failure it prevents: a credit
note for `0.0001` in a currency with two minor units was accepted end to end, no
tenderable payment could settle a hundredth of a cent, the invoice's open balance
stayed permanently above zero, and that in turn held the vehicle's delivery
blocked for ever with an override as the only way out.

### 2.2 Lists never carry a total

Every list the server returns is a keyset page:

```
{ items: [...], nextCursor: "…" | null, hasMore: true | false }
```

**There is no `total`.** The page reads one extra row to decide `hasMore` rather
than running a second counting query. Any screen, report or statement of work
that promises the reader "247 invoices" is promising something the server does
not supply. This is recorded so that a future commercial screen does not design a
result count into a page header and then discover it cannot be filled.

### 2.3 Rounding

Rounding is fixed by the database and is not a decision anyone may revisit in an
application layer:

| Rule                                                                     | Constraint that fixes it                        |
| ------------------------------------------------------------------------ | ------------------------------------------------- |
| Discount applies to `unit price × quantity`, **before** tax              | `ck_quotation_items_tax_amount`                  |
| Tax = `round((unit price × quantity − discount) × tax rate, 4)`          | `ck_quotation_items_tax_amount`                  |
| Line total = `round(unit price × quantity − discount + tax, 4)`          | `ck_quotation_items_line_total`                  |
| Document totals are pure sums of the rounded lines — round, then sum     | `quo.issue_revision`                             |
| Invoice gross = `round(net + tax, 4)`, the same convention               | `ck_invoice_amounts_gross`, `sal.issue_invoice`  |

Amounts are stored and returned at the column's scale of four decimal places. No
rounding to a currency's minor unit is applied anywhere, because no protected
rule requires it and inventing one would be inventing a display and rounding
policy the Owner has not approved.

---

## 3. What a charge is made of

The brief for this document lists seven elements of a charge. Each is examined
below against what the platform actually holds.

### 3.1 Summary

| Element                     | Held where                                                                  | Reaches a customer bill today?                                                                             |
| --------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Labour items**            | `svc.services` priced by `svc.price_rules`; time in `tech.labor_sessions`   | **Yes**, as a priced service line. Recorded technician time prices nothing                                 |
| **Internal parts**          | `inv.item_master`, `inv.stock_issues`, `inv.part_issues`                    | **No.** No path exists from a stock issue to a quotation line or an invoice line (finding `PPD-01`)        |
| **External parts**          | `inv.external_purchase_parts`                                               | **No.** Same gap (finding `PPD-01`)                                                                        |
| **Customer-supplied parts** | `inv.customer_supplied_parts`                                               | Custody is recorded. They are not charged for, which is correct, and no handling fee can be charged either |
| **Other approved charges**  | `sal.invoice_lines.line_type = 'fee'` is a legal value                      | **No.** The value is legal in the schema and unreachable through any operation (finding `PPD-02`)          |
| **Discounts where authorised** | `quo.quotation_items.captured_discount`, authorised against two ceilings | **Yes**, per line, as an amount, on an authorised service line                                             |
| **Taxes when configured**   | `org.tax_classes`, `org.tax_rates` per company                              | **Yes**, when a rate is configured. Nothing is seeded, and no operation configures one (finding `PPD-03`)  |
| **Total payable**           | `sal.invoice_amounts.gross_total`, derived open balance                     | **Yes**, computed by the database from the captured lines                                                  |

### 3.2 Labour

Labour reaches a bill as a **service**. A quotation line names a service, and the
price resolution service answers one question deterministically: what does this
service cost at this branch, for this customer class, on this date, and what tax
applies to it?

Three refusals are built into that answer, and each of them protects a customer
or the workshop:

| Situation                                                    | What happens         | Why not the alternative                                                    |
| ------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------- |
| No price is configured for the service at that branch        | The request is refused | Defaulting to zero would put a free line on a customer quotation            |
| A price rule names a tax class that has no effective rate    | The request is refused | Treating it as 0% under-charges silently and cannot be recovered after issue |
| Two price rules tie on specificity and priority              | The request is refused | The tenant has not actually decided the price; a tie-break would be a coin flip |

A price rule with **no** tax class is genuinely untaxed at rate zero. That is a
configured decision, not a missing one, and the two cases are distinguished.

`svc.standard_labor_times` holds a standard time in minutes per service version.
No operation reads it, and no priced amount is derived from it. `tech.labor_sessions`
records what a technician actually spent. Nothing converts either into money.
Labour is billed at the configured price of the service, not at a rate per hour.

### 3.3 Parts — the most consequential gap in this document

A quotation line, as the create operation accepts it, carries `serviceId`
(required), `quantity`, an optional `discount`, an optional `description` and an
optional reference to a work-order service line. The quotation service then
writes every line with `item_kind = 'service'`, no item reference and no
required-part reference.

The database is wider than the operation. `quo.quotation_items.item_kind` admits
`service` **and** `part`, and the table carries an `item_ref` foreign key to
`inv.item_master` and a `source_required_part_ref`. Those columns exist and no
operation ever populates them.

An invoice's lines are derived entirely from the accepted quotation revision's
items. There is no field on the invoice request through which a caller could
supply a line, a price or a total — a body carrying one is refused rather than
ignored.

**The consequence, stated plainly:** parts issued from stock, parts bought in
from a supplier for a particular job, and any charge that is not a catalogued
service cannot appear on a customer's bill. This is recorded as `PPD-01` and it
is the item most likely to be mistaken for a user-interface problem when it is a
missing server contract.

### 3.4 Discounts

A discount is supplied per line as an **amount** in the line's currency. It is
authorised against two independent ceilings and both must pass:

| Gate                        | Where it comes from                     | Failure posture                                                    |
| --------------------------- | ---------------------------------------- | ------------------------------------------------------------------- |
| **Policy threshold**        | `svc.pricing_approval_policies`         | No policy configured means the threshold is **zero**, not unlimited |
| **The actor's own ceiling** | `iam.approval_limits`                   | No ceiling configured means **no authority**, not unlimited          |
| **Maker ≠ approver**        | `maker_approver_distinct`, default true | The person requesting a discount may not be the person authorising it |

Both defaults were chosen so that a missing configuration row can never widen
access. A permission says what kind of thing may be approved; a limit says how
much. Holding the permission does not raise the ceiling, and a large ceiling does
not grant the permission.

The ceiling is also checked at **document** level, not only per line. A per-line
check alone is defeated by splitting a discount across two hundred lines each
just under the limit.

`svc.discount_rules` — the table that would hold standing discount rules — has no
operation that creates, reads or applies one. Discounts today are per-line
amounts authorised at the moment of quoting.

### 3.5 Taxes — only when configured

The platform holds tax as configuration and seeds none of it:

| Fact                                                                     | Source                                                              |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| `org.tax_classes` is company-scoped; no tax model is shared across companies | `supabase/migrations/20260717105000_org_settings_tax_features.sql`  |
| `org.tax_rates` is effective-dated per class; rate is a fraction in `[0,1]` | Same file. `0.160000` means 16 per cent                            |
| Active rates for one class cannot overlap in time                        | Exclusion constraint over a date range                              |
| **Zero rows are seeded.** Every rate is tenant configuration            | The table comment says so explicitly                                |
| No country, region or statutory rate appears anywhere in the code        | P1-20 open-decision record                                          |

So "taxes only when configured" is exactly right, with one addition that matters:
`org.tax.manage` is a seeded permission that **no operation uses**. There is no
way to create a tax class or a tax rate through the platform. Until that changes,
a tenant's tax configuration is entered by someone with direct database access.
Recorded as `PPD-03`.

### 3.6 Total payable

The customer's total payable is the invoice's `gross_total`, less what has been
paid and less approved credit notes. It is **derived, never stored as an editable
figure**, and the derivation is:

```
open receivable = issued invoice gross
                − Σ allocations from receipts that are not reversed
                − Σ approved credit notes
```

A draft or voided invoice reports zero, because nothing has been claimed from the
customer yet.

Every line must also allocate its gross amount unambiguously between the customer
and warranty: `customer_pay_amount + warranty_pay_amount = gross_amount` is a
database constraint. **The warranty share written today is always zero**, and the
reason is honest rather than lazy: warranty records are generated *from* a
completed delivery, so they describe warranty the workshop grants, not coverage
that reduces this bill. There is no claim table, no coverage reference on a work
order, job, service line or quotation item, and no payer on a quotation item. A
non-zero warranty share could therefore only come from a caller asserting it,
which would let a caller reduce what a customer owes by saying so. Recorded as
`PPD-04`.

---

## 4. Currency

| Fact                                                                                          | Consequence for the workshop                                                    |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `shared.currencies` exists as platform reference data: code, name, minor unit, status         | The list of currency codes is real reference data, not invented per tenant       |
| It is tenant-neutral and jurisdiction-neutral, and carries no default                          | No "application currency" exists                                                  |
| A legal company states its own `base_currency_code`                                            | Each company decides                                                              |
| A price list's `currency_code` is immutable once set                                            | A tenant cannot re-denominate an existing price list                              |
| There is no exchange-rate table and no conversion path                                          | A job cannot be quoted in one currency and invoiced in another                     |
| A credit note in a different currency from its invoice is refused **only by the application**  | See finding `PPD-05` — no database constraint enforces this                      |
| **OIR-04 — the approved production currency subset — is OPEN**                                  | No jurisdiction, tax or currency default may be assumed. See §12                  |

---

## 5. The lifecycle, end to end

### 5.1 The stages

| #  | Stage                                   | Server contract that exists                                            | Status                                       |
| -- | --------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------- |
| 1  | Vehicle received, custody accepted      | `POST /receptions`                                                     | Exists. No read operation at all (§5.2)      |
| 2  | Reception approved                      | `POST /receptions/{receptionId}/approve`                               | Exists                                       |
| 3  | Work authorised — work order opened     | `POST /receptions/{receptionId}/convert-to-work-order`                 | Exists. The **only** way to create a work order |
| 4  | Estimate prepared                       | `POST /quotations`                                                     | Exists, services only                        |
| 5  | Estimate reviewed and issued            | `POST /quotations/{quotationId}/issue`                                 | Exists                                       |
| 6  | Customer decision recorded              | `POST /quotation-items/{quotationItemId}/decisions`                    | Exists, **per item**                         |
| 7  | Work performed, jobs transitioned       | `POST /jobs/{jobId}/transition`, labour sessions                       | Exists                                       |
| 8  | Additional work requested and decided   | `POST /work-orders/{workOrderId}/additional-work` and its approval     | Exists                                       |
| 9  | Final quality control                   | `POST /work-orders/{workOrderId}/quality-controls` and finalisation    | Exists                                       |
| 10 | Work order closed                       | `POST /work-orders/{workOrderId}/closure`                              | Exists, gated by six blockers                |
| 11 | Final amount previewed                  | `GET /work-orders/{workOrderId}/invoice-preview`                       | Exists, read-only and server-derived         |
| 12 | Routed to accounting — invoice raised   | `POST /invoices`                                                       | Exists                                       |
| 13 | Invoice issued and numbered             | `POST /invoices/{invoiceId}/issuance`                                  | Exists                                       |
| 14 | Payment received                        | `POST /payments`                                                       | Exists                                       |
| 15 | Payment applied to the invoice          | `POST /payments/{paymentId}/allocations`                               | Exists                                       |
| 16 | Handover prepared                       | `POST /deliveries` and its receiver, checklist and signature steps     | Exists                                       |
| 17 | Handover eligibility checked            | `GET /deliveries/{deliveryId}/eligibility`                             | Exists, eight blockers                       |
| 18 | Vehicle handed over, custody released   | `POST /deliveries/{deliveryId}/completion`                             | Exists                                       |
| 19 | Warranty issued                         | `POST /deliveries/{deliveryId}/warranties`                             | Exists                                       |
| 20 | Vehicle marked as no longer in the workshop | `PATCH /vehicles/{vehicleId}/status`                                | Exists, but is a **separate manual step** (§9.4) |

### 5.2 Reception and work authorisation

A work order cannot be created directly. There is **no `POST /work-orders`**. The
only path is converting an approved reception visit, and that conversion is gated
on `rec.reception.convert`, a high-risk permission. The seeded permission
`wo.work_order.create` is used by no operation at all.

Neither an appointment nor a reception visit can be **read** through the platform.
Twelve reception and appointment operations exist and none of them is a `GET`.
The permission catalogue records this as deliberate: no read code is registered
because no read operation exists, and an unused permission is configuration that
cannot be tested. The practical consequence for the commercial process is that a
service adviser cannot look up the visit a work order came from. Recorded as
`PPD-06`.

### 5.3 Estimate prepared

The client says **what** to quote and never **what it costs**. The request carries
a work order, services, quantities and an optional discount. It carries no unit
price, no tax rate, no tax amount, no line total and no document total, and a
request that includes one is refused rather than having the field silently
dropped.

| Property                                    | How it holds                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Every quotation belongs to a work order     | `quo.quotations.work_order_id` is `NOT NULL`. A standalone quotation is impossible          |
| Company and branch come from the work order | Nothing reads a branch from the request; a client-supplied branch would be a security bypass |
| The pricing date is the **server's** date   | A caller-supplied date would let it select a price from a period the tenant is not trading in |
| A revision is limited to 200 lines          | So one request cannot build an unbounded document                                            |

### 5.4 Review and issue

Issuing a revision turns it into an immutable commercial snapshot. After issue, no
item on it may be inserted, changed or deleted — the database refuses. This was
proven by republishing the price list at five times the amount after issue and
confirming the stored figures for that revision did not move.

Revision states are `draft`, `issued`, `superseded`, `rejected`, `expired`. A
draft may become anything; an issued revision may become only superseded, rejected
or expired; and those three are terminal.

A revision with no items cannot be issued.

**Expiry has no scheduler.** A method exists that expires lapsed revisions, it is
bounded and idempotent and uses the database clock, and nothing calls it
periodically. No production scheduling infrastructure is provisioned. A revision
with no expiry date never lapses, and no default validity period was invented.

### 5.5 Customer approval where required

The most important fact about approval in this platform:

> **A decision is recorded against an ITEM, not against a whole quotation.**

One decision per item, and the first decision on a line is final. The
quotation-level outcome is **derived** from the items and never stored as a second
source of truth:

| Item decisions                | Quotation outcome                                     |
| ----------------------------- | ------------------------------------------------------- |
| Any item rejected             | **Rejected.** A customer who refuses one line has not accepted the quotation as presented |
| Every item approved           | **Accepted**                                            |
| Anything else                 | Still awaiting decisions; the quotation stays active    |

A decision is `approved` or `rejected` — there is no `declined`. The channel is
one of `in_person`, `phone`, `portal`, `email`, `system`. Evidence is one of
`document`, `verbal`, `portal`, `email`, and evidence of kind `document`
must carry a document version while any other kind must not.

**Who the record says decided.** The recorded decider is the member of staff who
entered the decision, because the schema has no customer principal. The integrity
control is that a claimed deciding party must equal the quotation's payer. The
fact recorded is truthfully "staff member X recorded that the payer decided Y over
channel Z". It is not, and must never be presented as, a customer signature.

### 5.6 Additional work when the scope changes

| Step                     | Operation                                                     | Permission                                     |
| ------------------------ | -------------------------------------------------------------- | ------------------------------------------------ |
| Raise a request          | `POST /work-orders/{workOrderId}/additional-work`             | `wo.additional_work.request`                   |
| Record what was presented | `PUT /additional-work/{requestId}/detail`                     | `wo.additional_work.request` + `iam.sensitive.view` |
| Record the decision      | `POST /additional-work/{requestId}/approval`                  | `wo.additional_work.approve`                   |
| Record fulfilment        | `POST /additional-work/{requestId}/fulfillment`               | `wo.additional_work.request`                   |
| Withdraw the request     | `POST /additional-work/{requestId}/withdrawal`                | `wo.additional_work.request`                   |

Request states are `pending`, `approved`, `rejected`, `withdrawn`. Only `pending`
has any outward move; the other three are terminal. Fulfilment is `unfulfilled`,
`fulfilled` or `waived`, and `unfulfilled` is the one value the workshop cannot
choose — moving a request back to unfulfilled would undo a completion nobody
recorded.

Reading or writing the **detail** of an additional-work request requires
`iam.sensitive.view` in addition to the ordinary permission, because the detail
carries the money conversation.

An unresolved required additional-work request blocks work-order closure. It is
closure blocker `B3`.

### 5.7 Final amount prepared

`GET /work-orders/{workOrderId}/invoice-preview` answers "what would an invoice
for this work order contain?" It is read-only and entirely server-derived. It
returns, per line, the source quotation item, the line number, the line type, the
description, the service, the quantity, the unit price, the discount, the captured
tax rate, the net amount, the tax amount and the gross amount — every one of them
a fixed-scale decimal string. At document level it returns the subtotal, the
discount total, the tax total, the net total and the gross total.

Preparing the final amount also resolves **which** commercial record is the
source, and the rules are deliberately strict:

| Candidates on the work order | Result                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------- |
| No accepted quotation revision | Refused. Invoicing from an undecided quotation would manufacture a financial fact                        |
| Exactly one                  | That revision is the source                                                                              |
| More than one                | Refused as a conflict. Picking one silently would be an arbitrary choice between two prices the customer agreed to |

Acceptance is derived from the decision counts, not read from the quotation's own
cached status column, because no constraint ties that column to the decisions.

### 5.8 Routed to accounting

`POST /invoices` names a work order and, optionally, a payer partner where the
commercial arrangement differs from the vehicle's owner. It carries **no amount of
any kind**, because there is no field for one.

| Rule                                                                    | Effect                                                                     |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| An invoice is born `draft`; the database refuses any other status on creation | An invoice cannot be created already issued, bypassing numbering          |
| At most **one live invoice per work order**                            | Staged or progress billing is structurally impossible today                 |
| Creating an invoice requires `sal.invoice.manage` **and** `sal.finance.view` | Creation writes the amount rows, which are gated on the finance permission |
| A zero-total issued invoice is legal                                    | A fully covered job still needs a numbered document                         |
| A negative amount is legal nowhere                                     | A credit is a separate positive-amount record, never a negative line        |

Invoice statuses are exactly four: `draft`, `issued`, `credited`,
`void_before_issue`. The legal moves are `draft → issued`,
`draft → void_before_issue`, and `issued → credited`. There is no un-void, no
un-issue and no re-open. Once issued, an invoice's lines and amounts are frozen —
the only instruments afterwards are a credit note and a new invoice.

### 5.9 Issuance and numbering

The invoice number appears **only at issue**. A number cannot be placed on a draft
to bypass the allocator; the constraint binds the number and the issue timestamp
to the status.

| Property                             | How it holds                                                                                    |
| ------------------------------------ | ------------------------------------------------------------------------------------------------- |
| One active numbering configuration per company | A partial unique index on active rows                                                   |
| Concurrent issues serialise on the sequence row | A strict sequence with no duplicates                                                    |
| An aborted issue consumes no number  | The increment rolls back with the transaction. Proven by transaction-level tests, not assumed    |
| Number sequences are provisioned at onboarding | They are not seeded. An unprovisioned tenant is told which scope is missing, not retried  |

**`P1-OD-042` is OPEN**: whether invoice numbering must be gapless or may be
gapped is jurisdiction-dependent and undecided. The mechanism supports both, the
mode is a configuration column, and the column has **no behavioural effect
anywhere** — the allocator does not read it. Treating a configured `gapless` as a
promise the platform keeps would be a claim the database does not support. The
invoice number column's own comment calls business-level gaps "tolerated and never
renumbered". See §12.

### 5.10 Payment

| Fact                                                                                  | Consequence                                                                  |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Payment methods are exactly three: `cash`, `card_terminal`, `bank_transfer`           | **There is no online payment gateway and no settlement type**                 |
| No payment credential of any kind is stored, forwarded or logged                      | There is no column in which such a claim could be stored                      |
| A receipt records money received from a partner: company, branch, method, payer, currency, amount | The currency is required and never defaulted                        |
| A receipt amount must be strictly greater than zero                                   | A zero receipt is not a receipt                                               |
| A receipt is then **allocated** to one or more invoices, as a separate act            | Recording money and applying it are two different decisions                   |
| Receipt states: `recorded` → `partially_allocated` → `allocated`, plus `reversed`     | The status is set by the allocation routine as it re-sums                     |
| An allocation may not exceed the receipt's unallocated amount or the invoice's open amount | Both bounds are enforced inside the database routine, under a lock       |
| The three currencies — declared, receipt and invoice — must all match                 | A caller that believes it is allocating in the wrong currency is told so      |

Two cautions belong in the record:

- **Over-allocation is defended in exactly one place**, inside the allocation
  routine. There is no constraint and no trigger bounding the sum, and the runtime
  database role holds a raw insert grant on the allocation table. Every allocation
  must go through the routine; this is an invariant, not a preference. Recorded as
  `PPD-07`.
- **The three platform payment methods are visible to every tenant and can be
  cited by no receipt.** The foreign key resolves on tenant and method together,
  and a platform row's tenant is null, so recording a payment against one raises a
  foreign-key error that reads as "that method does not exist" about a method the
  operator can see in the list. Each tenant must be provisioned with its own
  method rows, and **no operation creates one**. Recorded as `PPD-08`.

### 5.11 Paid, partially paid, unpaid — the real contract

This is the point at which a documentation error would be easiest to make, so it
is stated exactly.

| Common expectation                          | What the platform actually does                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| The invoice has a status of `paid`          | **It does not.** The invoice row can hold only `draft`, `issued`, `credited`, `void_before_issue`                        |
| The invoice has a status of `partially_paid` | **It does not.** `partially_paid` and `paid` exist only in the *status history* vocabulary and are storable on the invoice row by no code |
| Payment state is a stored field             | It is **derived**, every time, from the open receivable calculation                                                       |
| A partial payment is a flag                 | It is an inference: the open balance is above zero and below the gross                                                     |

What the platform returns is `GET /invoices/{invoiceId}/outstanding`, giving the
invoice id, the invoice's own status, the outstanding amount **with its currency**,
and a settled flag. The settled flag is a decimal comparison against zero and never
a numeric coercion, because an invoice with `0.0001` outstanding must not report as
settled.

Two consequences a commercial screen must respect:

1. **Nothing writes a payment milestone into the status history.** The billing
   module writes only the four lifecycle values. So no historical record of "this
   invoice became partly paid on this date" exists anywhere. Recorded as `PPD-09`.
2. **A caller without `sal.finance.view` is denied, not told zero.** The
   calculation reads three permission-gated sources and is invoker-security, so a
   caller lacking that permission would compute `0 − 0 − 0` and receive a figure
   indistinguishable from a fully settled invoice, with no error and no signal.
   Refusing is the only safe answer, and this is the reason the delivery operation
   also demands `sal.finance.view`.

### 5.12 Credit notes

| Rule                                                                       | Where enforced                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| A credit note amount must be strictly positive                             | Database check                                                     |
| It may not exceed the invoice's remaining open amount                      | Checked in the application for a usable message, and again under the approval lock |
| Approval states are `pending`, `approved`, `rejected`                      | Database check                                                     |
| The person requesting may not be the person approving                      | Database constraint                                                |
| A non-blank reason is required                                             | Application rule; the column has no format or length check         |
| **The currency must match the invoice's**                                  | **Application only.** Five triggers fire on credit notes and not one reads the invoice's currency (`PPD-05`) |

There is no refund. There is no receipt-reversal operation, although the state and
the table exist and the permission `sal.reversal.approve` is seeded. Recorded as
`PPD-10`.

---

## 6. Final quality control and the closure gate

### 6.1 The statement that this whole section exists to make

> **A vehicle is not ready merely because a technician pressed Complete.**

A job reaching a terminal state is one fact among at least fourteen that stand
between a technician finishing and a customer driving away. Six of them are
checked at work-order closure and eight at handover, and they overlap only
partly. Neither set is a superset of the other.

### 6.2 Quality control

| Fact                                                              | Detail                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A quality-control record has an overall result                    | `pending`, `passed` or `failed`                                                     |
| Each individual check result is                                   | `pass`, `fail` or `na`                                                              |
| A finalised record is frozen                                      | A failed check is **never edited into a pass**                                      |
| The remedy for a failure is a **new record**                       | Attributable to whoever performed it. The failed record stays in the ledger          |
| A passing record supersedes an earlier failed one for the gate    | Which is what makes a re-check the correct remedy rather than an edit               |

### 6.3 Failed quality control creates tracked rework

Rework corrects the original by standing beside it, never by editing it. A rework
work order is a **second** work order on the same reception visit, with kind
`rework`, linked to the closed original. Creating it is one transaction: the order
and the link, or neither.

| Rule                                                        | Where enforced        |
| ----------------------------------------------------------- | ----------------------- |
| Safety-critical rework requires a named lead technician     | Database constraint    |
| Independent sign-off may not be the lead technician         | Database constraint    |
| The lead technician cannot be swapped afterwards            | Immutable-column guard |
| Non-safety-critical rework has no independence requirement  | So a single-technician branch is not blocked on routine corrections |

Rework cost is readable and writable only with `iam.sensitive.view` in addition to
the quality permission.

**A closed work order is never reopened.** An attempt is recorded — the attempt
table's only outcome value is `rejected`, so there is no success to record — and
the work order is not touched. The correct route is a linked rework work order.

### 6.4 The six closure blockers

Closure is refused by a database trigger that raises on the **first** blocker it
hits, which would mean one round trip per blocker. So a separate read-only
operation, `GET /work-orders/{workOrderId}/closure-eligibility`, re-evaluates all
six independently and reports every one that is unmet. It is a **reporter, never
an enforcer**: closure is still refused by the trigger, and no code path may close
a work order by asserting the report passed.

| Code | Blocker                                                                    | Maps to the brief's requirement                       |
| ---- | -------------------------------------------------------------------------- | ------------------------------------------------------- |
| `B1` | A job on this work order is not in a terminal state                        | Every assigned task completed or dispositioned        |
| `B2` | A labour session on this work order is still running                       | Every assigned task completed or dispositioned        |
| `B3` | A required additional-work request is still unresolved                     | Additional-work items resolved                        |
| `B4` | A job requiring diagnostics has no completed diagnostic report             | Diagnostic findings have outcomes                     |
| `B5` | Required quality control has not passed                                    | QA checklist completed; final QA passes               |
| `B6` | Safety-critical rework lacks independent sign-off                          | Failed QA creates tracked rework, signed off          |

`B5` is two separate facts with the same code: a failed record that no passing
record supersedes, and a mandatory check configured with no passing record ever.
They have different remedies and are reported separately by the quality module.

### 6.5 What closure does NOT check

**Parts are not a closure blocker.** The register has six entries and stops there.
Stock reservation and part issue were not represented in the schema at the time
the trigger was written, and adding a seventh blocker that always evaluates to
"clear" would have read, in the response and in every audit record, as a check
that ran and passed. The forward hook is a column on the work order whose
vocabulary is `none`, `requested`, `reserved_elsewhere` — with no `issued` value,
because issuing stock was not a fact that schema could record.

So a work order **can be closed with stock still reserved against it**. Parts are
caught later, at handover, by a blocker the application composes. That asymmetry is
recorded as `PPD-11` because it is exactly the kind of thing a workshop discovers
at the counter with a customer present.

---

## 7. Delivery preconditions

### 7.1 The eight blockers

Handover eligibility is composed as an explicit list of blocker codes, never as a
boolean, because a caller told only "not eligible" has to guess, and guessing
against a handover gate produces exactly the pressure to add an override that
should not exist.

| Blocker code                     | Meaning                                                             | Established from                                          |
| -------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `work_order_not_complete`        | The work order is not in a state that permits handover              | The work-order module                                     |
| `quality_control_not_passed`     | Quality control has not signed off, or signed off negatively        | The quality module — the same `B5`/`B6` conditions        |
| `financial_balance_outstanding`  | An invoice for this work order still has an open receivable         | The billing module                                        |
| `part_obligation_outstanding`    | Parts are still reserved, or issued and unreturned                  | The inventory module                                      |
| `checklist_incomplete`           | A mandatory checklist item has no passing or waived result          | The delivery checklist tables                             |
| `receiver_not_verified`          | No authorised receiver is recorded                                  | The authorised-receiver table                             |
| `signature_missing`              | No delivery signature is recorded                                   | The delivery-signature table                              |
| `delivery_state_invalid`         | The delivery record is in exception                                 | The delivery record                                       |

An already-delivered record is **not** reported as blocked: completion is
idempotent, and reporting a replay as a failure would be wrong.

Each blocker is reported with whether the underlying fact was actually
**established**. A blocker raised because a fact is unknown is operationally
different from one raised because the fact is known and bad: an operator seeing an
outstanding balance that could not be established must go and fix the platform,
not chase the customer for money.

### 7.2 What the database enforces and what only the application does

This distinction is the most consequential fact in the delivery process.

| Precondition                | Enforced by the database routine? |
| --------------------------- | ----------------------------------- |
| Authorised receiver exists  | **Yes**                            |
| Mandatory checklist passed or waived | **Yes**                    |
| At least one signature      | **Yes**                            |
| Work-order state            | **No**                             |
| Quality-control outcome     | **No**                             |
| Part obligations            | **No**                             |
| **Financial balance**       | **No**                             |

The financial blocker — the single most consequential gate on the whole operation
— has **no database enforcement whatsoever**. If the application's composition
were removed, the platform would hand over a vehicle against an unpaid issued
invoice and no constraint would object.

Eligibility is therefore recomposed **inside** the completion transaction, after
the delivery row is locked, so a concurrent credit note or part issue cannot open
a window between the decision and the handover. It is not read from the earlier
eligibility response, and it is not trusted from the request — there is no field
in which a caller could assert eligibility.

### 7.3 The override

Exactly **one** blocker may be overridden: `financial_balance_outstanding`. It
requires a written reason, the reason is recorded in the audit trail, and the
authority is `sal.delivery.complete` — the operation's own high-risk permission,
so it is not reachable by someone holding only `sal.delivery.manage`.

The other seven are not overridable, and the reason is honesty rather than
strictness: two of them are enforced inside the database routine, so an
"override" would be accepted by the application and then fail at the database
after an authorised override had already been written to the audit trail.
Advertising an override that cannot work is worse than not offering one.

There is deliberately no `overrideAll`, no `force` and no `skipChecks`.

### 7.4 The handover checklist

| Outcome  | Meaning                                                              |
| -------- | ---------------------------------------------------------------------- |
| `passed` | Satisfies a mandatory item                                           |
| `waived` | Satisfies a mandatory item, **and requires a waiver reason**         |
| `failed` | Does not satisfy; a failed mandatory item blocks handover            |

A waiver with no reason and a reason with no waiver are both refused — the
biconditional is a database constraint.

**No operation creates or maintains a checklist template.** Mandatory checklist
items gate every handover, and nothing in the platform defines them. Recorded as
`PPD-12`.

### 7.5 Receiver and signatures

| Rule                                                                             | Note                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Exactly one authorised receiver per delivery                                     | A different receiver is refused, never substituted                        |
| The receiver must hold a valid reception party role at the moment of verification | Checked by the database against the role's validity window               |
| A wrongly recorded receiver has **no correction path** in this phase             | Deliberate and visible, rather than closed by a change nobody could audit |
| Signer roles are `receiver`, `delivering_employee`, `witness`                    | A closed vocabulary                                                       |
| A signature recorded before the receiver is verified is stored but does not advance the handover | Calling a handover signed before anyone verified who is receiving the vehicle would skip the control |
| **No signature or identity content crosses the boundary**                        | Signatures and identity evidence are references to immutable document versions |

### 7.6 Completion — what actually happens

In one transaction, `POST /deliveries/{deliveryId}/completion`:

1. Re-checks the three database gates.
2. Captures the final odometer reading as a decimal string, validated against the
   odometer column's own scale of one decimal place — **not** against the money
   scale, because validating a reading against a money scale would accept
   `123.4567` and let the database silently discard three digits.
3. Sets the delivery to `delivered` with a timestamp and the reading.
4. Writes a custody release record against the reception visit.
5. Appends the delivery status history.

The odometer reading is checked against the vehicle's existing readings under the
vehicle row's lock, enforcing a forward-only series. It matters because a warranty
term may later be measured against it.

The operation requires an `If-Match` version header and refuses without one, so a
caller holding a stale view is told rather than having its request silently apply
to a record that has moved on.

---

## 8. Warranty

| Fact                                                                | Detail                                                            |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A warranty record is generated **from a committed delivery**        | `POST /deliveries/{deliveryId}/warranties`, `wty.warranty.issue`   |
| So warranty describes what the workshop grants after the work       | Not coverage that reduces the bill for that work                   |
| Terms are effective-dated coverage rows                             | **No default duration or odometer value is seeded**                |
| There is **no claim table**                                         | Claim adjudication is not built                                    |
| `wty.policy.manage` is seeded and used by no operation              | Warranty policies and coverage cannot be maintained (`PPD-13`)     |
| `GET /warranties/{warrantyId}` is gated on `wty.warranty.issue`     | There is no warranty read permission (`PPD-14`)                    |
| **`P1-OD-024` is OPEN** — warranty defaults and claim adjudication  | See §12                                                            |

---

## 9. Vehicle status at handover

### 9.1 What the brief asks for

"Vehicle status changed to delivered through the approved server operation."

### 9.2 What exists

A vehicle carries two independent status axes:

| Axis               | Values                                                              |
| ------------------ | --------------------------------------------------------------------- |
| Lifecycle status   | `draft`, `active`, `inactive`, `merged`, `scrapped`                  |
| Workshop status    | `none`, `in_workshop`, `awaiting_parts`, `ready_for_delivery`         |

The approved workshop transitions are:

| From                 | May become                                        |
| -------------------- | --------------------------------------------------- |
| `none`               | `in_workshop`                                      |
| `in_workshop`        | `awaiting_parts`, `ready_for_delivery`, `none`     |
| `awaiting_parts`     | `in_workshop`, `ready_for_delivery`, `none`        |
| `ready_for_delivery` | `in_workshop`, `none`                              |

### 9.3 The finding

**There is no `delivered` workshop status.** The vocabulary has four values and
that is not one of them.

Furthermore, the delivery completion routine **does not touch the vehicle row at
all**. It sets the delivery record to `delivered`, releases custody on the
reception visit, and captures an odometer reading against the vehicle — and it
leaves the vehicle's workshop status exactly where it was, which after a normal
job is `ready_for_delivery`.

The only operation that changes a vehicle's workshop status is
`PATCH /vehicles/{vehicleId}/status`, under `veh.vehicle.status.manage`. It is a
separate request, made by a different permission holder, with no coupling to the
handover whatsoever.

### 9.4 What this means for the process

| Statement                                                              | True? |
| ---------------------------------------------------------------------- | ------- |
| Handover is recorded through an approved server operation              | Yes    |
| Custody release is recorded through that same operation                | Yes    |
| The vehicle's own status moves to `delivered` as part of that operation | **No** |
| The vehicle's status can be moved to `delivered` at all                | **No** — no such value exists |
| A separate, manual, differently-permissioned step is required to take the vehicle out of `ready_for_delivery` | Yes |

Recorded as `PPD-15`. This is not a defect the frontend can fix; it needs either a
vocabulary decision or a coupling decision, and both are server work.

---

## 10. Permissions used across this surface

Every code below was read from `supabase/seeds/04_iam_permission_catalog.sql`.
Multiple permissions on one operation are **all required**.

| Code                          | Risk   | What it authorises                                        |
| ----------------------------- | ------ | ----------------------------------------------------------- |
| `svc.service.read`            | low    | Read the service catalogue and branch availability        |
| `svc.service.manage`          | medium | Manage the service catalogue and versions                 |
| `svc.price.read`              | medium | Read price lists, rules and resolved prices               |
| `svc.price.manage`            | high   | Manage price lists, rules, discounts                      |
| `svc.price.publish`           | high   | Publish immutable price-list versions                     |
| `quo.quotation.read`          | low    | Read quotations, revisions and decisions                  |
| `quo.quotation.manage`        | medium | Create and manage quotations and revisions                |
| `quo.decision.record`         | high   | Record quotation item approval decisions                  |
| `wo.work_order.read`          | low    | Read work orders, their jobs and their history            |
| `wo.work_order.transition`    | medium | Move a work order through its configured states           |
| `wo.work_order.close`         | high   | Close a work order once every closure condition is met    |
| `wo.additional_work.request`  | medium | Raise an additional-work request                          |
| `wo.additional_work.approve`  | high   | Record a customer decision on additional work             |
| `qms.quality_control.read`    | low    | Read quality-control records and rework links             |
| `qms.quality_control.record`  | medium | Record individual quality-control check results           |
| `qms.quality_control.finalize` | high  | Finalise a quality-control record as passed or failed     |
| `qms.rework.manage`           | high   | Create and resolve rework cases                           |
| `qms.rework.sign_off`         | high   | Independently sign off safety-critical rework             |
| `sal.invoice.manage`          | medium | Create and manage draft invoices                          |
| `sal.invoice.issue`           | high   | Issue invoices and allocate numbers                       |
| `sal.credit.manage`           | high   | Request and manage credit notes                           |
| `sal.payment.record`          | medium | Record receipts                                           |
| `sal.payment.allocate`        | medium | Allocate receipts to invoices                             |
| `sal.reversal.approve`        | high   | Approve receipt reversals — **used by no operation**      |
| `sal.finance.view`            | high   | View financial amounts on invoices, receipts and events   |
| `sal.delivery.manage`         | medium | Manage deliveries, receivers and signatures               |
| `sal.delivery.view`           | high   | View delivery signatures and receiver evidence            |
| `sal.delivery.complete`       | high   | Complete deliveries and close custody                     |
| `wty.warranty.issue`          | medium | Issue warranty records                                    |
| `wty.policy.manage`           | medium | Manage warranty policies — **used by no operation**       |
| `iam.sensitive.view`          | high   | View sensitive and restricted data — an **additional** gate |
| `org.tax.manage`              | high   | Manage tax classes and rates — **used by no operation**   |
| `inv.cost.view`               | high   | View item, purchase and adjustment cost — **used by no operation** |

### 10.1 Reads gated on a write permission

Six reads across the platform are gated on a write or issue code because no read
code exists. Three of them are on this surface, and a screen designer must know
that showing them requires granting a write authority:

| Read                                | Gated on                |
| ----------------------------------- | ------------------------- |
| `GET /invoices/{invoiceId}`         | `sal.invoice.manage`    |
| `GET /payment-methods`              | `sal.payment.record`    |
| `GET /warranties/{warrantyId}`      | `wty.warranty.issue`    |

### 10.2 `iam.sensitive.view` is an additive gate

Four operations require it **in addition** to their ordinary permission, and all
four concern money or cost:

- `GET` and `PUT /additional-work/{requestId}/detail`
- `GET` and `PUT /rework-links/{reworkLinkId}/cost`

Filtering a search on a field marked sensitive also requires it, because
filtering is treated as a read.

---

## 11. Operations referenced by this document

Paths are relative to `/api/v1`.

| Method | Path                                                           | Operation id                       | Permissions                                                 | Scope    |
| ------ | -------------------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------- | -------- |
| GET    | `/services`                                                    | `svc.service-list`                 | `svc.service.read`                                          | branch   |
| POST   | `/services`                                                    | `svc.service-create`               | `svc.service.manage`                                        | tenant   |
| PATCH  | `/services/{serviceId}`                                        | `svc.service-update`               | `svc.service.manage`                                        | tenant   |
| GET    | `/price-lists`                                                 | `svc.price-list-list`              | `svc.price.read`                                            | tenant   |
| POST   | `/price-lists`                                                 | `svc.price-list-create`            | `svc.price.manage`                                          | tenant   |
| POST   | `/price-lists/{priceListId}/versions`                          | `svc.price-list-version-create`    | `svc.price.manage`                                          | tenant   |
| POST   | `/price-lists/{priceListId}/versions/{versionId}/publication`  | `svc.price-list-version-publish`   | `svc.price.publish`                                         | tenant   |
| POST   | `/price-lists/{priceListId}/versions/{versionId}/rules`        | `svc.price-rule-record`            | `svc.price.manage`                                          | branch   |
| GET    | `/prices`                                                      | `svc.price-resolve`                | `svc.price.read`                                            | branch   |
| POST   | `/quotations`                                                  | `quo.quotation-create`             | `quo.quotation.manage` + `wo.work_order.read`               | branch   |
| GET    | `/quotations/{quotationId}`                                    | `quo.quotation-detail`             | `quo.quotation.read`                                        | branch   |
| POST   | `/quotations/{quotationId}/issue`                              | `quo.quotation-issue`              | `quo.quotation.manage`                                      | branch   |
| POST   | `/quotations/{quotationId}/revisions`                          | `quo.quotation-revision-create`    | `quo.quotation.manage`                                      | branch   |
| POST   | `/quotation-items/{quotationItemId}/decisions`                 | `quo.quotation-item-decide`        | `quo.decision.record`                                       | branch   |
| POST   | `/quotation-revisions/{revisionId}/decisions`                  | `quo.quotation-revision-decide`    | `quo.decision.record`                                       | branch   |
| GET    | `/work-orders/{workOrderId}/closure-eligibility`               | `wo.work-order-closure-eligibility` | `wo.work_order.read`                                       | branch   |
| POST   | `/work-orders/{workOrderId}/closure`                           | `wo.work-order-closure`            | `wo.work_order.transition` + `wo.work_order.close`          | branch   |
| POST   | `/work-orders/{workOrderId}/additional-work`                   | `wo.additional-work-request`       | `wo.additional_work.request`                                | branch   |
| POST   | `/additional-work/{requestId}/approval`                        | `wo.additional-work-approval`      | `wo.additional_work.approve`                                | branch   |
| GET    | `/work-orders/{workOrderId}/quality-controls`                  | `qms.qc-record-list`               | `qms.quality_control.read`                                  | branch   |
| POST   | `/quality-controls/{recordId}/finalization`                    | `qms.qc-record-finalize`           | `qms.quality_control.finalize`                              | branch   |
| POST   | `/work-orders/{workOrderId}/rework`                            | `qms.rework-create`                | `qms.rework.manage`                                         | branch   |
| POST   | `/rework-links/{reworkLinkId}/sign-off`                        | `qms.rework-sign-off`              | `qms.rework.sign_off`                                       | branch   |
| GET    | `/work-orders/{workOrderId}/invoice-preview`                   | `sal.invoice-preview`              | `sal.invoice.manage` + `sal.finance.view`                   | branch   |
| POST   | `/invoices`                                                    | `sal.invoice-create`               | `sal.invoice.manage` + `sal.finance.view`                   | branch   |
| GET    | `/invoices/{invoiceId}`                                        | `sal.invoice-detail`               | `sal.invoice.manage`                                        | branch   |
| POST   | `/invoices/{invoiceId}/issuance`                               | `sal.invoice-issue`                | `sal.invoice.issue` + `sal.finance.view`                    | branch   |
| POST   | `/invoices/{invoiceId}/cancellation`                           | `sal.invoice-cancel`               | `sal.invoice.manage`                                        | branch   |
| GET    | `/invoices/{invoiceId}/outstanding`                            | `sal.invoice-outstanding-read`     | `sal.finance.view`                                          | branch   |
| POST   | `/invoices/{invoiceId}/credit-notes`                           | `sal.credit-note-create`           | `sal.credit.manage` + `sal.finance.view`                    | branch   |
| POST   | `/credit-notes/{creditNoteId}/approval`                        | `sal.credit-note-approve`          | `sal.credit.manage` + `sal.finance.view`                    | branch   |
| GET    | `/payment-methods`                                             | `sal.payment-method-list`          | `sal.payment.record`                                        | tenant   |
| POST   | `/payments`                                                    | `sal.payment-record`               | `sal.payment.record` + `sal.finance.view`                   | branch   |
| GET    | `/payments/{paymentId}`                                        | `sal.receipt-detail`               | `sal.finance.view`                                          | branch   |
| POST   | `/payments/{paymentId}/allocations`                            | `sal.payment-allocate`             | `sal.payment.allocate` + `sal.finance.view`                 | branch   |
| POST   | `/deliveries`                                                  | `sal.delivery-create`              | `sal.delivery.manage`                                       | branch   |
| GET    | `/deliveries/{deliveryId}/eligibility`                         | `sal.delivery-eligibility-read`    | `sal.delivery.view` + `sal.finance.view`                    | branch   |
| POST   | `/deliveries/{deliveryId}/authorized-receiver`                 | `sal.delivery-receiver-verify`     | `sal.delivery.manage` + `sal.delivery.view`                 | branch   |
| POST   | `/deliveries/{deliveryId}/checklist-results`                   | `sal.delivery-checklist-record`    | `sal.delivery.manage`                                       | branch   |
| POST   | `/deliveries/{deliveryId}/signatures`                          | `sal.delivery-signature-attach`    | `sal.delivery.manage` + `sal.delivery.view`                 | branch   |
| POST   | `/deliveries/{deliveryId}/completion`                          | `sal.delivery-complete`            | `sal.delivery.complete` + `sal.delivery.view` + `sal.finance.view` | branch |
| POST   | `/deliveries/{deliveryId}/warranties`                          | `wty.warranty-generate`            | `wty.warranty.issue`                                        | branch   |
| GET    | `/warranties/{warrantyId}`                                     | `wty.warranty-detail`              | `wty.warranty.issue`                                        | branch   |
| POST   | `/receptions/{receptionId}/convert-to-work-order`              | `rec.reception-convert-to-work-order` | `rec.reception.convert`                                  | branch   |
| PATCH  | `/vehicles/{vehicleId}/status`                                 | `veh.vehicle-status-change`        | `veh.vehicle.status.manage`                                 | tenant   |

---

## 12. Undecided policy — named, never written around

Nothing in this document invents a financial policy. Where a policy question has
no approved answer, the decision that would settle it is named here.

| Decision      | Question                                                                    | Standing | What this document does instead                                                                                   | What would settle it                                          |
| ------------- | --------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **OIR-04**    | The approved production currency subset and jurisdiction posture            | OPEN     | No currency, tax rate or country is assumed anywhere. Currency reference data exists; nothing is defaulted        | A Product Owner decision recording the approved currencies    |
| **P1-OD-007** | Jurisdiction, currency and tax defaults                                     | Held as configuration | No jurisdiction figure is written into any table                                                     | A finance-controller structural review, still advisory-pending |
| **P1-OD-023** | Invoice, payment, numbering and delivery rules — including the eligible work-order state that permits a handover | Held as configuration | The eligible-state gate is a documented open contract, not invented state names. The mechanism supports whatever set is chosen | A Product Owner decision naming the eligible state set |
| **P1-OD-024** | Warranty defaults and claim adjudication                                    | OPEN / deferred | No warranty duration or odometer value is seeded. Claim adjudication is not built                          | A Product Owner decision on warranty terms and claims          |
| **P1-OD-042** | Gapless versus gapped invoice numbering                                     | **OPEN** | Both modes use the same allocator; the mode column has no behavioural effect and is not presented as a promise    | A Product Owner decision, jurisdiction-dependent               |
| **P1-OD-017** | Duplicate and merge rules for customers and vehicles                        | **OPEN** | No merge action is described anywhere. Where a duplicate payer or a duplicate vehicle would affect a bill, the process stops at review | A Product Owner decision on merge rules |
| **P1-OD-025** | Media and document upload policy                                            | **OPEN** | No accepted file type, size limit or storage arrangement is stated for a signed handover note, a receipt image or an approval document | A Product Owner decision on accepted types, limits and storage |

### 12.1 Where `P1-OD-017` binds this surface

An invoice names a payer partner. A delivery names an authorised receiver who
must hold a valid reception party role. If two customer records describe the same
person, the platform can carry an invoice against one and a receiving authority
against the other, and there is no approved rule for reconciling them. The
duplicate review contracts exist; the merge action does not, and must not be
described as if it did.

### 12.2 Where `P1-OD-025` binds this surface

Four places in this process reference a document version rather than storing
content: quotation approval evidence, additional-work approval evidence, delivery
signatures, and receiver identity evidence. In every case the platform stores a
**reference**, no signature or identity content crosses the boundary, and upload
is authorisation-only — the platform mints an authorisation and no operation
accepts a file body. Until `P1-OD-025` is decided, no accepted file type, size
limit, retention period or storage arrangement may be stated for any of them.

### 12.3 Policy questions with no protected answer and no open decision recorded

| Question                        | Standing                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Payment terms                   | **Not established.** No approved terms exist and no column holds them. Nothing is modelled                  |
| Quotation validity period       | **Not established.** The expiry field is optional and no default period was invented                        |
| Currency minor-unit rounding on a quotation | **Not established.** Minor units exist as reference data; no rule requires rounding to them      |
| Deposits and part payments before work | **Not established.** A receipt can be recorded and allocated at any time, but no deposit concept exists |
| Late payment charges            | **Not established.** No column, no operation, no policy                                                     |
| Progress or staged billing      | **Structurally impossible today** — at most one live invoice per work order                                 |

Establishing any of these requires a Product Owner decision, not an engineering
choice.

### 12.4 A commercial boundary

Should any part of this process ever be considered for a paid external data
provider — a tax-rate service, a parts-price feed, a payment processor — that is
a **commercial decision reserved to the Product Owner**. This document recommends
that such an option be *evaluated* if and when the need is demonstrated. It does
not recommend, price, or assume any purchase, and no vendor, plan or figure
appears anywhere in it.

---

## 13. Integration findings

Fifteen gaps between the process described above and the contracts that exist.
Identifiers are **document-local** (`PPD-nn`) and are deliberately not
`P1-27-INT-nnn`: that series is the P1-27 finding register and numbers 001 to 006
are already allocated. Registering these under a phase series is a later
governance step.

| finding    | what is missing                                                                                                                                                                                          | owning Backend phase | owning Frontend phase | required action                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **PPD-01** | **Parts cannot be charged.** The quotation create operation requires a service on every line and writes every line as kind `service` with no item reference, so no part — stock, external purchase, or otherwise — can reach a quotation or an invoice | P1-20                | P1-30                 | Decide whether parts are billable in Phase 1. If yes, extend the quotation line contract to accept a part reference and populate `item_kind = 'part'` |
| **PPD-02** | **`fee` invoice lines are unreachable.** The invoice line type vocabulary admits `fee`, and every invoice line derives from a quotation item whose kind is fixed at `service`, so no other approved charge can be billed | P1-20 / P1-22        | P1-30 / P1-31         | Decide whether ad-hoc charges are in scope, then either provide a source for a `fee` line or record the value as reserved                          |
| **PPD-03** | **Tax cannot be configured through the platform.** `org.tax.manage` is seeded and used by no operation; tax classes and rates have no create, read or update path                                        | P1-03 foundation     | Not established       | Build the tax configuration surface, or document that tax configuration is an onboarding activity performed with direct database access             |
| **PPD-04** | **No source of warranty coverage exists**, so every invoice line allocates its whole gross to the customer. There is no claim table and no coverage reference on a work order, job, service line or quotation item | P1-11 / P1-22        | P1-31                 | Settle `P1-OD-024`, then model coverage as a protected fact before any non-zero warranty share is written                                          |
| **PPD-05** | **A credit note in the wrong currency is refused only by the application.** No trigger or constraint compares a credit note's currency to its invoice's                                                  | P1-11                | —                     | Add a database constraint, or record the application check as the permanent single defence with a test that proves the database still accepts the mismatch |
| **PPD-06** | **No appointment or reception read exists.** Twelve operations, zero `GET`s, and no `rec.*.read` or `apt.*.read` permission code                                                                         | P1-18                | P1-28                 | Add the read contracts before any screen promises to show a visit                                                                                  |
| **PPD-07** | **Over-allocation is bounded only inside the allocation routine.** No constraint or trigger bounds the sum, and the runtime role holds a raw insert grant on the allocation table                        | P1-11                | —                     | Keep the routine as the only write path and keep the structural test that proves the repository contains no raw insert                             |
| **PPD-08** | **No tenant payment method can be created.** The three platform methods are visible to every tenant and citable by no receipt, and no operation creates a tenant-scoped method                           | P1-11 / P1-22        | P1-31                 | Provide a payment-method provisioning path, or document it as an onboarding activity and hide platform rows from the selection list                 |
| **PPD-09** | **No payment milestone is ever recorded in history.** `partially_paid` and `paid` exist in the history vocabulary and no code writes them                                                                | P1-22                | P1-31                 | Decide whether a payment milestone history is required; if it is, name the writer                                                                   |
| **PPD-10** | **No refund or receipt-reversal operation.** The state, the table and `sal.reversal.approve` all exist and nothing reaches them                                                                          | P1-22                | P1-31                 | Build the dual-control reversal operation, or record the permission as reserved                                                                    |
| **PPD-11** | **Part obligations do not block work-order closure**, although they block handover. A work order can close with stock still reserved against it                                                          | P1-19 / P1-21        | P1-29                 | Decide whether closure should carry a seventh blocker now that inventory can record the fact                                                        |
| **PPD-12** | **No delivery checklist template can be created or maintained.** Mandatory items gate every handover and nothing defines them                                                                            | P1-11 / P1-22        | P1-31                 | Provide a checklist template surface, or document it as an onboarding activity performed with direct database access                                |
| **PPD-13** | **No warranty policy or coverage can be maintained.** `wty.policy.manage` is seeded and used by no operation                                                                                             | P1-22                | P1-31                 | Build the policy surface after `P1-OD-024` is settled                                                                                              |
| **PPD-14** | **No list read for invoices, credit notes, payments, deliveries or warranties, and no quotation list.** Every read on this surface is by id; a customer's or a work order's commercial documents cannot be found | P1-20 / P1-22        | P1-30 / P1-31         | Add keyset list contracts. Note that they will return `{ items, nextCursor, hasMore }` with no total                                                |
| **PPD-15** | **A vehicle's status never becomes `delivered`.** The workshop-status vocabulary has no such value, and the handover operation does not touch the vehicle row. Only a separate, differently-permissioned request moves it | P1-17 / P1-22        | P1-27 (read) / P1-31 (handover) | Decide between adding a status value coupled to handover, or documenting the two-step process. Until then no screen may state that handover changes the vehicle's status |

### 13.1 Contracts looked for and not found

Recorded separately from the findings so the search is auditable.

| Looked for                                                             | Result                                                                        |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| A `total` on any list response                                         | Does not exist. Pages are `{ items, nextCursor, hasMore }`                     |
| `POST /work-orders`                                                    | Does not exist. Creation is reception conversion only                          |
| `GET /quotations` (list)                                               | Does not exist                                                                 |
| `GET /services/{serviceId}`, `GET /price-lists/{priceListId}`          | Neither exists                                                                 |
| Any read of a service's versions, or of a price-list version or rule   | None exists                                                                    |
| A `sal.invoice.read` or `wty.warranty.read` permission code            | Neither exists                                                                 |
| A receipt-reversal or refund operation                                 | None exists                                                                    |
| A `GET /deliveries/{deliveryId}`                                       | Does not exist; only the eligibility read                                      |
| A route managing `svc.discount_rules` or `svc.pricing_approval_policies` | Neither exists — discount policy is not configurable through the platform    |
| A route managing `svc.service_categories` or `svc.standard_labor_times` | Neither exists                                                                 |
| A route reading or writing item cost                                   | None. `inv.cost.view` is used by no operation                                  |
| A general ledger                                                       | Absent by design                                                               |
| An online payment gateway or settlement type                           | Absent by design, and structurally unrepresentable                             |
| A currency conversion path or exchange-rate table                      | Neither exists; conversion is unexpressible rather than discouraged            |
| A `delivered` value on any vehicle status axis                         | Does not exist                                                                 |

---

## 14. What this document does not establish

| Not established                                                                      | What would establish it                                                             |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| The number of screens, forms or reports this process needs                            | A task register in the owning Frontend phase                                        |
| Any service level, turnaround time or response time                                   | A Product Owner decision. None exists in this repository                             |
| Any price, rate, fee, discount percentage or tax rate                                 | Tenant configuration entered at onboarding. Nothing is seeded                        |
| The volume of invoices, payments or deliveries a branch handles                        | Real operating data. There is none, and none may be fabricated                       |
| Which Frontend phase owns the commercial surface in detail                            | A scope statement for P1-30 and P1-31. Only their existence is recorded              |
| Whether any of the fifteen findings is in Phase 1 scope                               | A Product Owner scope decision against the canonical Phase 1 plan                    |
| The eligible work-order state that permits a handover to be opened                    | `P1-OD-023`                                                                          |
| Whether parts are billable in Phase 1                                                 | A Product Owner decision, which finding `PPD-01` depends on entirely                 |

---

## 15. Provenance

Every operation, permission, table, column, status value and constraint named in
this document was read from the repository on branch
`remediation/p1-27-owner-acceptance-ux`. No count, total, service level or price
in this document is estimated. Where a figure is not known, the document says
"not established" and names what would establish it.

**This document plans and traces. It implements nothing.**
