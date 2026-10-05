# ADR-023: Sales and Finance Policy Decisions D1–D17

## Status

Accepted by owner instruction — for the seventeen sales and finance policy decisions D1–D17 below,
approved by the Owner on 2026-09-30 with the binding clarifications recorded under each decision.
They are **approved product policy for how this platform behaves**. They are not legal, tax,
accounting-standard or regulatory advice, and nothing in this record claims that the platform, or
any tenant using it, complies with any law, tax regime, accounting standard or certification.

Proposed — for the implementation particulars of D1 and D7 introduced by the pull request that adds
this record (the forward migration `20260930100000_sal_minor_unit_rounding.sql`, the derived
settlement read and its screens). They are reviewed in that pull request and carry no authority
beyond that review.

Proposed — for the implementation particulars of D3, D9 and D12 introduced by pull request
P1-32-PRE-OD-FD2A (the forward migration `20260930110000_sal_credit_note_decisions.sql`, the
`sal.credit-note-withdraw` and `sal.credit-note-reject` operations, the credit request audited with
a return, the business-refusal record, and the credit-note screen). They are reviewed in that pull
request and carry no authority beyond that review.

Proposed — for the implementation particulars of D13 introduced by pull request
P1-32-PRE-OD-FD2C (the forward migration `20261001090000_sal_credit_approval_limits.sql`, the minted
permission `sal.credit.approve`, the `credit_note` approval-limit type, the anti-splitting rule
recorded under D13, the credit-note screen and the approval-limit form). They are reviewed in that
pull request and carry no authority beyond that review.

Proposed — for the implementation particulars of D14 introduced by pull request
P1-32-PRE-OD-FD14 (the forward migration `20261002100000_sal_third_party_allocations.sql`, the minted
permission `sal.payment.third_party`, the fixed relationship vocabulary insurer / employer / other,
the optional third-party statement on `sal.payment-allocate`, the audit action
`sal.payment.third_party_allocated`, the payer-versus-customer reads and the allocate form). They are
reviewed in that pull request and carry no authority beyond that review.

Accepted by owner instruction — for the D12 extension recorded under D12 below, approved by the
Owner on 2026-10-03: permission refusals on the four financial approval decisions are persisted in
the security trail. Proposed — for its implementation particulars (the `authorization.denied`
event, its closed detail and the explicit list of four operations), introduced by pull request
P1-32-PRE-OD-FD12X and reviewed in that pull request.

Proposed — for the implementation particulars of D11 introduced by pull request
P1-32-PRE-OD-FD11 (the forward migration `20261005090000_quo_acceptance_records.sql`, the
append-only acceptance record written by the decision that completes an acceptance, the typed
contact name and telephone number on the two existing decision operations, the record on the
decisions read and the quotation detail). No permission code or audit action is added. They are
reviewed in that pull request and carry no authority beyond that review.

Proposed — for the implementation particulars of D6 introduced by pull request
P1-32-PRE-OD-FD6 (the forward migration `20261005100000_quo_part_line_snapshots.sql`, part lines
on the two existing quotation writes priced at the item selling price, the part snapshot, the
`quo.guard_quotation_part_line` guard, the part and unit on the quotation and invoice reads, and the
part line in the quotation builder). No permission code or audit action is added. They are reviewed
in that pull request and carry no authority beyond that review.

Open — for how each of D2, D5, D8, D10 and D15–D17 is implemented (D4's particulars,
P1-32-PRE-OD-FD4, are Proposed and reviewed in that pull request). Each is planned for a later pull
request named in the mapping table; until merged, the "existing" behaviour is what the platform does.

## Context

A read-only contract review of the sales and finance modules on 2026-09-30 (the finance evidence
folder of the Owner directive of 2026-09-29, with an independent critique) found eighteen gaps and
nine further defects. Pull request #486 corrected the ones that needed no business decision
(M-01, M-07, M-09, GAP-04, GAP-05, GAP-09, GAP-13, GAP-15, GAP-17; migration
`20260930090000_sal_finance_controls.sql`). The rest needed the Owner's policy. The Owner answered
seventeen questions on 2026-09-30 and attached clarifications that bind the implementation.

The platform's money model at that point, which every decision below builds on:

- every amount is PostgreSQL `numeric(18,4)`, carried end to end as an exact decimal string, and
  never a binary floating-point number;
- a receipt, an allocation and a credit note must fit the currency's minor unit
  (`shared.currencies.minor_unit`: JOD 3, USD 2), enforced by `assertMinorUnitScale`
  (`apps/api/src/server/http/validation.ts:42`);
- the open receivable is derived on every read by `sal.invoice_open_receivable` and stored nowhere;
- credit notes and receipt reversals are dual-controlled, maker different from approver, in the
  database (`20260930090000_sal_finance_controls.sql`).

## Decision

Each decision is stated with the Owner's clarification in substance. "Must" is the Owner's word.

### D1 — Money and rounding

Money is held as exact decimal or integer minor units, never as binary floating point. A monetary
line amount is rounded **half-up, per line**, to the currency's minor unit (JOD three decimals) at
the point it is computed; document totals reconcile to the sum of the rounded lines. Monetary
amounts are distinguished from quantities, percentage rates and unit-price calculation precision:
the currency scale is not applied to every field. The snapshots of issued documents are preserved.

### D2 — Credit ceiling, customer credit and refunds

Credits on an invoice may not exceed the eligible invoiced amount less the effective credits already
given, enforced safely under concurrency. A credit above what is still outstanding becomes a
customer credit or refund obligation; nothing is refunded automatically. Approving a refund and
paying it out are separate acts, the approval needs a second approver, and duplicate or excess
refunds are refused.

### D3 — Withdrawing and rejecting a pending credit request

The requester may withdraw their own pending request. Only an authorized other person may reject
one, and a rejection carries a reason. Transitions are enforced by the server. An approved document
is never silently edited or deleted.

### D4 — Receipt reversal

A full, traceable reversal is requested by an authorized payment recorder and approved by a
different authorized person. The credit-note permission alone never grants the power to reverse a
payment. Scope and amount are checked; allocations and balances are reversed atomically; the
original receipt is retained; a replacement receipt is linked to it. A bookkeeping reversal is not
a cash refund.

### D5 and D15 — What may be invoiced, and tracking it

Approved items and quantities are invoiceable; rejected, cancelled and unapproved ones are not.
Invoiced quantities and amounts are tracked against accepted revisions and their source lines, so
approved quantities not yet billed can be billed later without billing anything twice, across
superseding revisions. "One invoice per revision" is not the only safeguard. Idempotency and
concurrency protection live in the backend and the database.

### D6 — Parts on quotations

Parts are explicit quotation lines at authorized sales prices, never at inventory cost. Each line
snapshots quantity, unit, price, discount and tax treatment; a later catalogue price never changes
it silently. Invoicing never duplicates an inventory movement.

Implementation particulars (P1-32-PRE-OD-FD6, Proposed). Which authorised source prices a part is a
planner decision of 2026-10-05 within D6, not an Owner pricing policy: the only source that can price
an ITEM today is the item selling price (`inv.item_sale_prices` through
`inv.resolve_item_sale_price`: the branch row, else the company row, else the tenant-wide row; no
dates, no customer class), the source counter sales use. A price list cannot price an item
(`svc.price_rules.service_id` is NOT NULL with a foreign key to `svc.services`), so price lists are
not extended to items and no precedence between sources is decided; the pure step
`resolveAuthorisedPartPrice` refuses, rather than chooses, if two sources ever disagree. An item
with no selling price for the branch is refused on the line, never priced at zero and never at cost.
The tax treatment is the counter sale's exactly — the price's tax class at its effective rate, and
no class means a zero rate. **Tax remains blocked on the accounting questionnaire**: no rate or class
is invented, and the open question about a price with no tax class (README question 11, CC-OD-48)
applies equally to part lines. The D5/D15 boundary holds: a work-order invoice copies the accepted
revision's part lines and posts no stock (their stock left as part issues); it is not linked to part
issues, and an unquoted part issue is not billed.

### D7 — Credit status

An invoice's credit status is derived from its effective approved credits, reversed credits
excluded: zero is "no credit", above zero and below the eligible total is "partly credited", equal
to it is "credited". The credit status is distinct from the payment status and from the refund
status.

### D8 — No self-exemption from discount approval

Changing one's own threshold, role limit or price list never exempts one's own quotation from
approval. Provenance and snapshots are kept. There is no sole-administrator exception.

### D9 — Returns and credit are separate events

Receiving a return needs the inventory-return permission, not the credit-approval permission.
Receiving the goods and granting a financial credit are separate events; the credit request and its
link to the return are audited. A return never approves a credit or a refund by itself, and no
return produces a duplicate stock or financial effect.

### D10 — Printable documents

Quotations and credit notes are printable. A receipt identifies the invoices it is allocated to. An
invoice print shows discounts, payments, credits and the balance due, with the immutable issued
facts kept apart from the settlement position, which is shown "as of" a stated time. Prints are in
English and Arabic, right to left where needed, paginated, at the right precision, and behind print
permissions.

### D11 — Recording a customer's acceptance

Acceptance is an auditable record of the exact revision, the customer or contact, the channel, the
time, the employee who recorded it, and the evidence or reference. Recording a telephone call is
not mandatory, no evidence is ever invented, and the record is not a qualified electronic signature.

### D12 — Recording refused business actions

Refusals by business rule — self-approval, limit violations — are recorded through the existing
audit and security-event mechanism and survive the rejected transaction. No secret, no unnecessary
personal data and no duplicate logging.

#### D12 extension (approved by the Owner 2026-10-03)

A server-side refusal for want of a PERMISSION on a financial approval action — approving or
rejecting a credit note, approving or rejecting a receipt reversal, including a direct API call —
is persisted in the security trail as well. The record carries the actor, the trusted tenant and
branch, the attempted action, the missing permission codes and where the refusal was decided, the
time and the correlation id; it carries no detail of a document the actor cannot access, no secret
and no unneeded personal data. It survives the rollback of the refused command; a failure to record
can never permit the action; each refused attempt is recorded once; existing retention and access
rules apply (reading it needs `iam.audit.view` in the tenant).

It is kept DISTINCT from the business-rule refusals above: a permission refusal is an
`authorization.denied` event, a business-rule refusal (self-approval, the D13 limits, state rules)
stays a `business-rule.refused` event, and one attempt is never recorded as both. The
`authorization.denied` record is limited to the four operations named here. Elsewhere a refusal for
want of a permission is persisted only where an earlier decision already records it as a business
rule, and it stays `business-rule.refused`: the receipt-reversal request
(`receipt_reversal_request_permission_missing`), a permission token the database guard raises on a
receipt-reversal withdrawal, the discount decision (`discount_approval_permission_missing`) and the
third-party allocation (`third_party_permission_missing`). Every other permission refusal in the
platform remains a server log line.

Before this extension part of such refusals was already persisted, in the other class. Since FD2C
(credit notes) and FD4 (receipt reversals), a refusal by the deferred scope check or by the database
guard for want of the deciding code on approving a credit note, or on approving or rejecting a
receipt reversal, was recorded as `business-rule.refused` with the rule
`credit_approval_permission_missing`, `receipt_reversal_approve_permission_missing` or
`receipt_reversal_reject_permission_missing`. Those earlier rows stay in that class and are not
rewritten, so an attempt made before the extension is read there. Only the refusals at the route's
permission gate, the refusals for want of `sal.finance.view` alone, and the permission refusals of a
credit-note rejection were server log lines and were not persisted; no record exists for such an
attempt made before the extension was deployed, and none is claimed.

### D13 — Credit-approval limits

The existing approval-limit mechanism is reused with explicit credit-approval permissions and
limits, never inherited from discount amounts, with currency, tenant and branch scope, separation of
duties, and protection against splitting a credit or approving concurrently to bypass a limit.

**Recorded rules (implementation of P1-32-PRE-OD-FD2C).**

- **Permission.** Approving and rejecting a credit note need `sal.credit.approve` in the note's
  company and branch; requesting a note and withdrawing one's own keep `sal.credit.manage`.
  Rejecting needs no limit, because a rejection credits nothing.
- **Limit.** An approval needs an `iam.approval_limits` row of the type `credit_note`, separate
  from every discount type, in the note's currency. It is resolved by the discount rule: the
  approver's own limit before a role's, a role whose active grant reaches the note's company, in
  force today, and never a limit the approver created. A subject holds at most one credit-note
  limit per currency at a time. Limits are company-scoped, as every approval limit is; the branch
  is enforced through the permission.
- **Anti-splitting.** The limit covers the invoice, not the note: it must be at least the sum of
  every credit note on the same invoice in the state `approved`, plus the note being approved.
  Pending, rejected and withdrawn notes are not counted; a credit note has no reversal, so every
  approved note stands. One large credit split into several small notes therefore cannot pass a
  low limit, and a note approved by somebody else counts against the next approver's limit.
- **Concurrency.** The decision takes the invoice row lock — the lock the credit ceiling of #486
  already takes, in the same order (note, then invoice) — before it reads the approved total, so
  two approvals of two notes on one invoice cannot each pass the limit on a total that omits the
  other.
- **Money.** A new approval limit of any type fits its currency's minor unit, and a credit-note limit
  is above zero (the D1 carry-over).
- **Where it is enforced.** In the database (`sal.guard_credit_note_decision`,
  `iam.guard_approval_limit_money`, the approval-limit exclusion constraints), whoever writes the
  row, and mirrored in the service so each refusal is named: `credit_approval_permission_missing`,
  `credit_no_approval_limit`, `credit_limit_self_created`, `credit_limit_currency_mismatch`,
  `credit_limit_exceeded`. Each refused attempt is recorded once through the D12 refusal record.

### D14 — Payments from someone other than the invoice customer

Allocating a payment to an unrelated customer's invoice is refused by default. Payments from an
insurer or employer are accepted only through explicit, authorized, audited third-party handling:
the payer is distinct from the invoice customer, and the relationship, authorization and reason are
recorded. No ownership changes and no credit is transferred silently. Scope and currency are
enforced.

How it is implemented (P1-32-PRE-OD-FD14), in substance:

- **Refused by default.** A receipt applied to an invoice whose customer
  (`sal.invoices.payer_partner_id`) is not the receipt's payer is refused
  (`allocation_payer_mismatch`), and the refused attempt is recorded once through the D12 refusal
  record.
- **Explicit third-party handling.** The allocation is accepted only as a third-party allocation
  naming the relationship — a fixed vocabulary held in code and in a CHECK: insurer, employer or
  other; 'other' must say in the reason what the payer is to the customer — an authorisation
  reference (not blank, at most 100 characters) and a reason (not blank, at most 2000 characters).
- **Authorised.** Only a holder of the minted code `sal.payment.third_party` in the receipt's company
  and branch may make one; `sal.payment.allocate` alone is not enough. The authorising user is
  stamped from the session and never taken from a request or a raw statement.
- **Audited.** A third-party allocation writes `sal.payment.third_party_allocated` beside the
  allocation's own audit record, in the same transaction: who paid, whose invoice it is, the
  relationship, the authorisation and the reason.
- **Nothing changes hands.** The invoice stays its customer's, the receipt stays its payer's, and what
  is left unallocated on the receipt stays the payer's; no credit moves between them. The receipt,
  the invoice's settlement and the invoice-and-payment report say who paid for whom.
- **Where it is enforced.** In the database, for every new allocation whoever writes it (the BEFORE
  INSERT trigger `sal.guard_allocation_payer`, which also holds a raw insert to the receipt's and the
  invoice's currency), and mirrored in the service so each refusal is named. Existing allocations are
  not re-checked or rewritten; the migration reports, read-only, how many cross payers.
- **Not covered.** Split billing to an insurer, a separate insurer receivable and any accounting
  treatment of third-party receivables (the accounting questionnaire); refunds of a third party's
  overpayment (D2); limits on third-party allocations (D14 sets none, and none is invented).

### D16 — End-of-period reporting

End-of-period reporting is defined and tested. Later payments, credits, reversals or backdated
entries never silently change a historical report. The as-of calculation and the preserved
snapshot are documented, and restatements are distinguished. No new accounting subsystem is built.

### D17 — What a quotation user may see

A user authorized for quotations sees sales prices and quotation totals; that an invoice total can be
inferred from them is accepted and documented. That user does not see invoice records, payment
history, balances, costs, margins or finance reports, enforced in both the API and the interface.

### Mapping: decision → today → what is missing → tests → pull request

Paths are relative to the repository root; `mig:` is `supabase/migrations/`.

| Decision | Existing behaviour (before this record's pull request)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Missing implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Pull request                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ |
| D1       | Line tax and totals rounded to four decimals (`mig:20260723096000_quo_quotations.sql:216-217`, `mig:20260917093000_sal_counter_sales.sql:434-437`); prices, discounts and thresholds accepted at four decimals for every currency                                                                                                                                                                                                                                                                                                                 | Implemented here: `mig:20260930100000_sal_minor_unit_rounding.sql` (per-line half-up rounding to the minor unit; totals as sums of rounded lines; the two CHECKs replaced by `tg_quotation_items_money`); minor-unit refusal of fixed discounts and amount thresholds; a price rule and an item selling price are unit prices and keep their scale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `tests/db/sal-minor-unit-rounding.test.ts`, `tests/backend/od-finance-rounding.test.ts`, `tests/unit/od-finance-rounding.test.ts`, web field-error cases                                                                                                                                                                                                                                                                                                           | This pull request                                |
| D2       | Credit ceiling is the open receivable (`mig:20260930090000_sal_finance_controls.sql:181-184`); no refund instrument                                                                                                                                                                                                                                                                                                                                                                                                                               | Ceiling = eligible invoiced − effective credits; refund obligation with separate dual-controlled approval and payout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Planned                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Planned (D2)                                     |
| D3       | Schema admits `rejected` (`mig:20260930090000_sal_finance_controls.sql:109-111`); only the approval route exists. Discount requests: a rejection already requires a reason (`apps/api/src/modules/quotation/application/discount-approval-service.ts:429`), the requester may decide their own request neither way (`apps/api/src/modules/pricing/application/discount-authorization-service.ts:453`), and a pending request is superseded only by revising the quotation (`apps/api/src/modules/quotation/application/quotation-service.ts:556`) | Delivered for credit notes by pull request P1-32-PRE-OD-FD2A: `mig:20260930110000_sal_credit_note_decisions.sql` (`withdrawn` state; `sal.guard_credit_note_decision` at :99 holds requester-only withdrawal, rejection by a different holder of `sal.credit.manage` in the note scope with a reason — `sal.credit.approve` since P1-32-PRE-OD-FD2C (D13) — and terminal decisions; `sal.withdraw_credit_note` :240, `sal.reject_credit_note` :269); `sal.credit-note-withdraw` (`sal.credit.manage`) and `sal.credit-note-reject` (`sal.credit.manage` + `sal.finance.view`), version-guarded and idempotent, audited as `sal.credit_note.withdrawn` and `sal.credit_note.rejected`; Withdraw and Reject on the credit-note screen. Discount requests: a separate withdraw operation is planned (not a small symmetric change: the request is bound to a quotation revision and is withdrawn today by revising the quotation)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `tests/db/sal-credit-note-decisions.test.ts`, `tests/db/inv-counter-sales-and-returns.test.ts`, `tests/backend/od-finance-credit-decisions.test.ts`, `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/billing-api.test.ts`                                                                                                                                                                                                                                  | P1-32-PRE-OD-FD2A (discount withdrawal: Planned) |
| D4       | Approval primitive only (`mig:20260930090000_sal_finance_controls.sql:193-220`); no request route                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Delivered by pull request P1-32-PRE-OD-FD4: `mig:20261002090000_sal_receipt_reversal_requests.sql` (`sal.request_receipt_reversal` and the BEFORE INSERT guard `sal.guard_receipt_reversal_request`: a FULL reversal, amount and currency bound to the receipt, reason required, requester stamped and holding `sal.payment.record` in the receipt's company and branch, refused for a reversed receipt or one with a pending or approved reversal; `sal.stamp_dual_control_maker` births every reversal pending and undecided, closing the #489 residual; one LIVE reversal per receipt (`uq_receipt_reversals_receipt_live`); `sal.guard_allocation_receipt_open`: a pending reversal freezes the receipt for new allocations; `sal.guard_receipt_reversal_decision`: approval and rejection by a different holder of `sal.reversal.approve` in the receipt scope, which no credit-note code satisfies, rejection with a reason, withdrawal by the requester only, decided rows terminal, deciders and dates stamped; `sal.approve_receipt_reversal` re-issued receipt-first, reversing the receipt, keeping every allocation recorded and writing one `receipt_reversed` event, with `tg_receipt_reversals_applied` refusing an approval that did not reverse its receipt; `sal.receipts.replaces_receipt_id` with `sal.guard_receipt_replacement`: one replacement per approved-reversed receipt, same branch, frozen); five operations `sal.receipt-reversal-request`, `-approve`, `-reject`, `-withdraw` and `sal.receipt-replacement-record`, audited, with named refusals recorded through D12; the receipt panel offers each step only to whom it belongs and closes allocation while a reversal waits. UPGRADE (no silent permission change): `sal.reversal.approve` was already seeded, so no seed run is owed; the standard tenant administrator bundle carries it from now (96 codes); an organisation provisioned earlier cannot approve or reject a receipt reversal until an administrator who holds the code grants it, and the operator backfill adds it only for `odqa_alpha` and `odqa_beta`, preserving a customised role (CC-OD-53). Not a refund (D2); historical reports are not restated (D16 open) | `tests/db/sal-receipt-reversal-requests.test.ts`, `tests/backend/od-finance-receipt-reversal.test.ts`, `tests/unit/od-finance-receipt-reversal.test.ts`, `tests/backend/p1-31-provisioning-bundle.test.ts`, `tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts`, `apps/web/tests/payments-print-and-reversal.dom.test.tsx`, `apps/web/tests/payments-api.test.ts`                                                                                   | P1-32-PRE-OD-FD4                                 |
| D5, D15  | One live invoice per work order (`mig:20260917093000_sal_counter_sales.sql:72-73`); a revision with any undecided or rejected item is not billable                                                                                                                                                                                                                                                                                                                                                                                                | Per-source-line invoiced quantity tracking across revisions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Planned                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Planned (D5 + D15 + D6 + D11)                    |
| D6       | Quotation lines are services only (`apps/api/src/modules/quotation/application/quotation-service.ts:1295`)                                                                                                                                                                                                                                                                                                                                                                                                                                        | Delivered by pull request P1-32-PRE-OD-FD6: `mig:20261005100000_quo_part_line_snapshots.sql` (six nullable snapshot columns on `quo.quotation_items` — the `inv.item_sale_prices` row, the item’s stock code and name, its unit code and name, the tax class — and `quo.guard_quotation_part_line`, BEFORE INSERT OR UPDATE: a part line only at exactly what `inv.resolve_item_sale_price` answers for its branch, with that class’s effective rate (zero for none), the item’s current words and unit and a required part of its own work order; the snapshot, unit price, rate and currency frozen); `quo.quotation-create` and `quo.quotation-revision-create` take `kind: part` with `itemId` (and an optional `sourceRequiredPartRef`), priced through `@/modules/inventory` (`catalog.quotablePart`) and `@/modules/pricing` (`prices.taxRateFor`), never at cost, refusing an item with no price (`no_authorised_sale_price`), archived (`item_archived`) or outside the catalogue (`item_not_found`) on the line; the discount goes through the existing approval rule; quantities follow the inventory quantity rules; `MoneyLine` and the invoice line gain `item` and `unit` (the invoice line reads the unit through `source_quotation_item_id`); `issuePostsStock` keeps a work-order invoice from posting stock; the builder offers a part line to holders of `inv.item.read` in English and Arabic. No permission code, audit action or route is added. Only one source can price an item today; precedence between sources is not decided (CC-OD-47). Tax remains blocked on the accounting questionnaire, and CC-OD-48 applies equally to part lines. Not linked to part issues; unquoted part issues are not billed (D5/D15)                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `tests/db/quo-part-line-snapshots.test.ts`, `tests/backend/od-quotation-part-lines.test.ts`, `tests/unit/od-quotation-part-lines.test.ts`, `apps/web/tests/quotation-part-lines.dom.test.tsx`, `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/quotations-api.test.ts`                                                                                                                                                                                     | P1-32-PRE-OD-FD6                                 |
| D7       | No read derives a credit position; a fully credited invoice read "Settled"; `inv.lock_return_source` accepts only `issued` invoices (`mig:20260917094000_inv_sales_returns.sql:257`), so no terminal `credited` status is set                                                                                                                                                                                                                                                                                                                     | Implemented here: `SettlementView` on `sal.invoice-outstanding-read` (`creditStatus`, `paymentStatus`, `refundStatus`), `creditStatus` on the invoice-and-payment report, invoice screen and print in English and Arabic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `tests/backend/od-finance-rounding.test.ts`, `tests/backend/p1-31-report-engine-invoice-payment.test.ts`, `tests/unit/od-finance-rounding.test.ts`, `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/reports.dom.test.tsx`                                                                                                                                                                                                                                  | This pull request                                |
| D8       | Policy pinned per quotation; an approver's own limit never counts (`mig:20260925090000_quo_discount_approvals.sql:252-282, 451-453`)                                                                                                                                                                                                                                                                                                                                                                                                              | Own threshold, role-limit and price-list changes never exempt the changer's own quotation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Planned                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Planned (D8 + D17)                               |
| D9       | A return raises a pending credit note (`mig:20260930090000_sal_finance_controls.sql:326-371`) without its own audit record                                                                                                                                                                                                                                                                                                                                                                                                                        | Delivered by pull request P1-32-PRE-OD-FD2A. Receiving a return stays gated by `inv.stock.operate` + `sal.finance.view` (`apps/api/src/app/api/v1/sales-returns/route.ts:139`), never `sal.credit.manage`; the credit request is audited as `sal.credit_note.requested` naming the return, in the return’s transaction (`apps/api/src/modules/inventory/application/inventory-sales-return-service.ts:292`); a retried return is answered before the remaining quantity is re-read, so it moves no second stock; a withdrawn note no longer counts in the cumulative return credit (`mig:20260930110000_sal_credit_note_decisions.sql:408`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `tests/backend/od-finance-credit-decisions.test.ts`, `tests/db/inv-counter-sales-and-returns.test.ts`, `tests/unit/od-finance-controls.test.ts`                                                                                                                                                                                                                                                                                                                    | P1-32-PRE-OD-FD2A                                |
| D10      | Invoice and receipt prints only (`apps/web/src/features/billing/components/InvoiceDocument.tsx`); this pull request adds the credit and payment status to the invoice print                                                                                                                                                                                                                                                                                                                                                                       | Delivered for the invoice print by pull request P1-32-PRE-OD-FQB: the issued facts (each job line's discount from the matched quotation revision, the before-discount and discount totals, net, tax, gross) are printed apart from a "Payments and credits as of" section (amount paid, amount credited, balance due, payment and credit position) headed with the moment `sal.invoice-outstanding-read` was read (`asOf`, the database clock) on the branch clock, on the counter-sale and the work-order print, only for a reader holding `sal.finance.view`. Still planned: quotation and credit-note prints; receipt allocations by invoice number                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/inventory-counter-sales.dom.test.tsx`, `tests/backend/od-finance-credit-decisions.test.ts`; the rest Planned                                                                                                                                                                                                                                                                                               | P1-32-PRE-OD-FQB; the rest Planned (D10 + D16)   |
| D11      | Decision channel recorded, evidence optional (`apps/api/src/modules/quotation/application/quotation-decision-service.ts:78`)                                                                                                                                                                                                                                                                                                                                                                                                                      | Delivered by pull request P1-32-PRE-OD-FD11: `mig:20261005090000_quo_acceptance_records.sql` (`quo.acceptance_records`, one append-only record per accepted revision, written by the decision that completes the acceptance in its transaction: the payer when the employee said the payer decided, a typed contact name and telephone number (the CRM model holds contact channels, not contact persons), the channel, the evidence kind, reference note and document version given, and the recorder and time stamped by `quo.guard_acceptance_record` from the session; SELECT and INSERT only, every UPDATE refused). Shown on the quotation detail as an acceptance record, never a signature; a revision accepted before records existed says it has none and is not backfilled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `tests/db/quo-acceptance-records.test.ts`, `tests/backend/od-quotation-acceptance-record.test.ts`, `tests/unit/od-quotation-acceptance-contact.test.ts`, `apps/web/tests/quotation-acceptance-record.dom.test.tsx`                                                                                                                                                                                                                                                 | P1-32-PRE-OD-FD11                                |
| D12      | Audit is written inside the command transaction; `recordSecurityEvent` exists for authorization denials (`apps/api/src/server/audit/security-events.ts:45`)                                                                                                                                                                                                                                                                                                                                                                                       | Delivered by pull request P1-32-PRE-OD-FD2A: a service marks a refusal by business rule (`apps/api/src/server/audit/business-refusals.ts`) and the route pipeline writes ONE `business-rule.refused` security event after the command rolls back (`apps/api/src/server/http/route-handler.ts:636`), naming operation, entity, rule and outcome only. Recorded: credit-note approve, reject and withdraw refusals (self-approval, self-rejection, wrong requester, decided note, over the open amount); discount decisions (`discount-approval-service.ts:493`: own request, missing permission, no or own-created or other-currency limit, over the limit); over-allocation (`payment-service.ts:716`, `:752`). D13 marks its limit refusals the same way                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `tests/backend/od-finance-credit-decisions.test.ts`, `tests/backend/p1-20-quotation.test.ts`, `tests/unit/od-finance-refusal-records.test.ts`                                                                                                                                                                                                                                                                                                                      | P1-32-PRE-OD-FD2A                                |
| D12 ext. | Route-gate refusals on the four decisions and every credit-note rejection refusal: log line only; a scope or guard refusal for want of the deciding code on the other three: `business-rule.refused`; a refusal for want of `sal.finance.view` alone: log line only                                                                                                                                                                                                                                                                               |
| D13      | Approval limits exist for discounts only; any holder of the credit permission approves any amount                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Delivered by pull request P1-32-PRE-OD-FD2C: `mig:20261001090000_sal_credit_approval_limits.sql` (`sal.guard_credit_note_decision` re-issued: an approval needs `sal.credit.approve` in the note scope and a `credit_note` limit in the note currency, not created by the approver, covering every approved credit on the invoice including this note, read under the invoice row lock; a rejection needs `sal.credit.approve`; `iam.guard_approval_limit_money`: a new limit fits the minor unit and a credit-note limit is above zero; the exclusion constraints key a credit-note limit by currency); the minted code `sal.credit.approve` (seed, standard tenant administrator bundle, selective QA backfill); `sal.credit-note-approve` and `sal.credit-note-reject` declare it; named refusals recorded through D12 (`apps/api/src/modules/billing/application/invoice-service.ts`); Approve and Reject offered only to holders; the limit type chosen by name on the approval-limit form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `tests/db/sal-credit-approval-limits.test.ts`, `tests/backend/od-finance-credit-limits.test.ts`, `tests/backend/p1-31-provisioning-bundle.test.ts`, `tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts`, `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/user-access.dom.test.tsx`                                                                                                                                                          | P1-32-PRE-OD-FD2C                                |
| D14      | `sal.allocate_receipt` compares no payer (`mig:20260930090000_sal_finance_controls.sql:240-293`)                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Delivered by pull request P1-32-PRE-OD-FD14: `mig:20261002100000_sal_third_party_allocations.sql` (`sal.guard_allocation_payer`, BEFORE INSERT on `sal.payment_allocations`: an allocation whose receipt payer is not the invoice customer is refused (`allocation_payer_mismatch`) unless it is a third-party allocation carrying a relationship from the fixed vocabulary insurer, employer, other, an authorisation reference and a reason, made by a holder of `sal.payment.third_party` in the receipt scope, with the authorising user stamped from the session; a same-payer allocation carries no third-party detail; a raw insert is held to the receipt and invoice currency; `sal.allocate_receipt` re-created with three trailing arguments and the replay comparison widened to them; existing allocations reported, never rewritten); the minted code `sal.payment.third_party` (seed, standard tenant administrator bundle, selective QA backfill), consulted and not declared by `sal.payment-allocate`, which takes an optional `thirdParty` block; refusals named and recorded through D12; the audit action `sal.payment.third_party_allocated`; the receipt detail, the invoice settlement and the invoice-and-payment report show who paid for whom; the allocate form explains another customer's invoice, offers the third-party payment only to holders and blocks everyone else. UPGRADE (no silent permission change): an allocation across customers that technically worked before is now refused unless it is an authorised third-party allocation; seed 04 is re-run on an existing database first; the bundle carries the code from now (97 codes); an organisation provisioned earlier cannot make a third-party allocation until an administrator who holds the code grants it, and the operator backfill adds it only for `odqa_alpha` and `odqa_beta`, preserving a customised role (CC-OD-54). Not split billing, not an insurer receivable, not a refund (D2); no limit                                                                                                                                                                                                                 | `tests/db/sal-third-party-allocations.test.ts`, `tests/backend/od-finance-third-party.test.ts`, `tests/unit/od-finance-third-party.test.ts`, `tests/backend/p1-31-provisioning-bundle.test.ts`, `tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts`, `tests/backend/p1-31-report-engine-invoice-payment.test.ts`, `apps/web/tests/payments-third-party.dom.test.tsx`, `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/payments-api.test.ts` | P1-32-PRE-OD-FD14                                |
| D16      | The invoice-and-payment report computes the open receivable at run time (`apps/api/src/modules/reporting/domain/report-datasets.ts:467`)                                                                                                                                                                                                                                                                                                                                                                                                          | As-of calculation, preserved period snapshot, restatement marking                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Planned                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Planned (D10 + D16)                              |
| D17      | Quotation amounts readable with the quotation read permission (finance review M-08)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Documented inference; API and interface keep invoice, payment, balance, cost, margin and report data behind the finance permission                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Planned                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Planned (D8 + D17)                               |

## Alternatives Considered

- **A per-note credit limit (D13).** Rejected: a low limit could then be passed by splitting one
  credit into several notes. The limit covers the cumulative approved credit on the invoice.
- **A table of its own for credit limits, or inheriting the discount limit (D13).** Rejected by the
  Owner's clarification: the approval-limit mechanism is reused, with an explicit `credit_note` type
  that no discount limit satisfies.
- **One credit-note limit per subject whatever the currency (D13).** Rejected: a company that
  credits in two currencies needs a limit in each, and comparing amounts across currencies would be
  a silent conversion. The exclusion constraints key a credit-note limit by currency; every other
  type keeps the key it had.

- **Setting a terminal `credited` invoice status inside `sal.approve_credit_note` (D7).** Rejected:
  `credited` is terminal in the invoice freeze, and `inv.lock_return_source` refuses a non-`issued`
  invoice, so returns against a fully credited invoice would start failing. The credit status is
  derived instead, and `sal.invoices.status` stays `issued`.
- **Rounding only document totals, or rounding at four decimals everywhere (D1).** Rejected by the
  Owner's clarification: rounding is per line, at the currency's minor unit, and totals are sums of
  rounded lines.
- **Applying the currency scale to unit prices, quantities and rates (D1).** Rejected by the same
  clarification: a quantity stays `numeric(12,3)`, a rate `numeric(9,6)`, and a unit price keeps its
  calculation precision; only monetary amounts take the currency's scale. A price rule's amount and
  an item selling price are unit prices, so they are accepted at the column's four decimals, and
  the money a line makes of them is rounded on the line.
- **Recomputing stored rows in the migration (D1).** Rejected: an issued document keeps its
  snapshot, and a draft carrying a sub-minor-unit residue is refused at issue (and counted by the
  migration's read-only notice) rather than silently rewritten.

## Consequences

- D13 changes who may approve a credit note. In an organisation provisioned from now on, the first
  administrator holds `sal.credit.approve`, but approves nothing until somebody else sets it a
  credit-note limit; it can delegate the code to a finance approver it chooses. In an organisation
  provisioned earlier, nobody can approve a credit note until an administrator who holds the code
  grants it and a credit-note limit is set; the operator backfill adds the code only for the
  previously authorised QA organisations (`--tenant odqa_alpha --tenant odqa_beta`), preserving a
  customised administrator role, and every other existing organisation is left unchanged. This is a
  behaviour change by design of D13, not a regression.
- A note whose approval would take the invoice's approved credit past the approver's limit waits for
  an approver with a larger limit, or is rejected; splitting it does not help.

- D14 changes what an allocation may do. A receipt applied to another customer's invoice — which the
  platform accepted silently before — is now refused unless it is an explicit third-party allocation
  by a holder of `sal.payment.third_party`. In an organisation provisioned from now on the first
  administrator holds the code and can delegate it; in an organisation provisioned earlier nobody can
  make a third-party allocation until an administrator who holds the code grants it (the operator
  backfill covers only `odqa_alpha` and `odqa_beta`, preserving a customised role). Allocations
  already booked across payers are left as they are. This is a behaviour change by design of D14,
  not a regression.
- A third-party payment leaves both parties' positions apart: the invoice is paid down, its customer
  keeps it, and anything left on the receipt stays the payer's. The receipt detail, the invoice's
  settlement (`thirdPartyPayments`) and the invoice-and-payment report (`thirdPartyAllocatedAmount`)
  gain additive fields.

- A JOD line of 12.345 at 16% is quoted at 1.975 tax and 14.320 gross, and a receipt of exactly
  14.320 settles the invoice; the delivery module's financial blocker then reads nothing outstanding.
- A fixed discount or an amount threshold finer than the currency's minor unit is refused on its
  own field with the rule `minor_unit_scale`. A price rule's amount and an item selling price are
  unit prices and keep their four decimals.
- The rounding applies to documents written from now on. An invoice issued earlier with a
  four-decimal gross keeps it, and a residue below the minor unit on it can still be cleared only
  by a full return; a receipt or a manual credit note is held to the minor unit.
- The outstanding read gains a `settlement` block; the invoice-and-payment report gains a
  `creditStatus` column. Both are additive.
- The rounding rule is enforced by the database (`tg_quotation_items_money`,
  `shared.round_to_minor_unit`), so an application that forgot it could not write a line the rule
  forbids.

## Security Impact

D13 (P1-32-PRE-OD-FD2C) mints one permission code, `sal.credit.approve`, and moves the approval and
the rejection of a credit note onto it. No grant, policy or table changes: the new trigger function
is `SECURITY INVOKER` with `EXECUTE` revoked from PUBLIC, the decision guard is re-issued under its
own identity, and the two approval-limit exclusion constraints are re-created under their own names.
The runtime login still cannot write an approver, a decision date or a limit's creator or amount.
The refusal record names operation, entity, rule and outcome only — no amount, limit or name.

D14 (P1-32-PRE-OD-FD14) mints one permission code, `sal.payment.third_party`, consulted by
`sal.payment-allocate` for a third-party allocation and checked by the database trigger for every
one. No policy, table or grant on a relation changes: the new trigger function is `SECURITY INVOKER`
with `EXECUTE` revoked from PUBLIC, and `sal.allocate_receipt` is re-created with `EXECUTE` for
`app_runtime` only. The runtime login cannot write the authorising user, cannot attach third-party
detail to the payer's own invoice, and cannot book an allocation to another customer's invoice
without the code. The refusal record names operation, entity, rule and outcome only.

The D1 particulars:

No permission, policy, grant on a table or tenancy rule changes. The two helper functions are
`SECURITY INVOKER`, with `EXECUTE` revoked from PUBLIC and granted to `app_runtime` only. The
settlement read sits behind the existing `sal.finance.view` gate of `sal.invoice-outstanding-read`,
and its amounts are read under the same row-level security as the open receivable.

## Operational Impact

The migration writes no row. Applying it to an existing database is a separate, rehearsed step
(backup, rehearsal on a restored copy, forward migration). Its read-only notice reports any draft
quotation line still carrying a sub-minor-unit residue; such a draft is re-priced by a revision.

The D13 migration (`20261001090000_sal_credit_approval_limits.sql`) writes no row either; the new
code reaches an existing database through the idempotent permission seed. Granting it to an existing
organisation's standard administrator is the operator backfill
(`scripts/platform/backfill-tenant-administrator-bundle.mjs`), run with a dry run first and only for
the named QA organisations; credit-note limits are then set by each organisation's administrator on
the approval-limit screen. Both are separate, rehearsed operator steps and are not performed by the
pull request.

The D4 particulars (P1-32-PRE-OD-FD4): the migration `20261002090000_sal_receipt_reversal_requests.sql`
writes no row. It adds three nullable columns to `sal.receipt_reversals` and one to `sal.receipts`,
narrows the receipt-reversal uniqueness to the live states, adds five `SECURITY INVOKER` trigger
functions and three primitives with `EXECUTE` for `app_runtime` only, re-creates
`sal.record_receipt` with one more argument and grants `UPDATE (decision_reason)` on
`sal.receipt_reversals` to the runtime login; no policy or table is added. No permission code is
minted: `sal.reversal.approve` has been seeded since Phase 1-11. Granting it to an existing
organisation's standard administrator is the same operator backfill, dry run first, only for the
named QA organisations; it is not performed by the pull request.

The D6 particulars (P1-32-PRE-OD-FD6): the migration `20261005100000_quo_part_line_snapshots.sql`
writes no row and backfills nothing. It adds six nullable columns, two foreign keys with their
indexes and one `SECURITY INVOKER` trigger function behind one trigger to `quo.quotation_items`; no
policy, grant, table or permission code is added. Every existing line is a service line and is left
as it was. Applying it to an existing database is a separate, rehearsed step (backup, rehearsal on a
restored copy, forward migration) and is not performed by the pull request.

The D14 particulars (P1-32-PRE-OD-FD14): the migration `20261002100000_sal_third_party_allocations.sql`
writes no row. It adds four nullable columns and two CHECKs to `sal.payment_allocations`, one
`SECURITY INVOKER` trigger function and its trigger, and re-creates `sal.allocate_receipt` with three
more arguments; a read-only notice reports how many existing allocations cross payers. The minted
code reaches an existing database through the idempotent permission seed (`04_iam_permission_catalog.sql`),
which is run BEFORE the operator backfill grants it to the named QA organisations' standard
administrator, dry run first. Both are separate, rehearsed operator steps and are not performed by the
pull request.

## Related Phase 1 Task and Requirement IDs

Owner directive of 2026-09-16 (SaaS operation before daily use); finance contract review of
2026-09-30 (GAP-01 to GAP-18, M-01 to M-09); P1-32 preparatory work; pull request #486; ADR-022.

Identifiers prefixed `P1-` are defined in the canonical Word documents, which live outside this
repository by owner decision — see
[../governance/canonical-documents.md](../governance/canonical-documents.md).

## Decision Owner

The Owner — the seventeen policy decisions and their clarifications, approved on 2026-09-30.
Eng. Ezzaldeen Al-Bitar (technical and IT owner) — the implementation particulars, reviewed in the
pull request that adds this record under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md); that is
owner-authorized technical self-review and is never an independent third-party audit.

## Date

2026-09-30
