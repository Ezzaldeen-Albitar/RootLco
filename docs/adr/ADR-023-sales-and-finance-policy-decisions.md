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

Proposed — for the implementation particulars of D5 and D15 introduced by pull request
P1-32-PRE-OD-FD5 (the forward migration `20261006090000_sal_invoiced_quotation_quantities.sql`, the
read `sal.billable_quotation_lines`, the three invoice source guards under the work order row lock,
the one-draft and one-unsourced-invoice indexes that replace `uq_invoices_work_order_active`,
several live invoices per work order, the preview's approved, invoiced and remaining quantities and
not-billed reasons, the work-order invoice list and the unbilled-work delivery blocker). No
permission code, audit action or route is added. They are reviewed in that pull request and carry no
authority beyond that review. Open — by Owner instruction of 2026-10-06, whether what is already
invoiced is pooled across every quotation of a work order: the delivered pooling is a conservative
rule in force pending the Owner's answer, not an Owner approval (D5 and D15, "Open policy point: the
same service approved again").

Proposed — for the implementation particulars of D8 and of D3 for discount requests introduced by
pull request P1-32-PRE-OD-FD8 (the forward migration
`20261007090000_quo_discount_self_exemption_and_withdrawal.sql`, the stored provenance of thresholds,
price rules, price-list publications and item selling prices and its snapshot on quotation lines,
the rule that any discount needs another person when its requester set what it relies on, the
approval limit that never counts when the requester set it, the `quo.discount-approval-withdraw`
operation, the audit action `quo.discount_approval.withdrawn`, and the withdrawal and the reasons on
the quotation screen). No permission code is added. They are reviewed in that pull request and carry
no authority beyond that review.

Open — for how each of D2, D10, D16 and D17 is implemented (D4's particulars,
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

Discount requests (P1-32-PRE-OD-FD8, Proposed). The requester withdraws their own PENDING discount
request through `quo.discount-approval-withdraw` (`quo.quotation.manage`, the code that wrote the
revision; If-Match is the request's version; idempotent, and a retry finds it withdrawn and says
so). Nobody else may (`discount_withdraw_not_requester`), a decided request cannot be
(`discount_approval_already_decided`), nor a replaced one (`discount_approval_superseded`); each
refusal is recorded once through the D12 business-refusal record. `quo.guard_discount_approval` holds
the same rules for every writer and stamps `withdrawn_by` and `withdrawn_at`. A withdrawn request is
terminal: it is never approved, rejected or superseded, its revision is never issued and keeps its
lines, and revising the quotation asks again or drops the discount. Rejection by another authorised
person with a reason is unchanged (P1-32-PRE-OD-DISC-01).

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

Implementation particulars (P1-32-PRE-OD-FD5, Proposed):

- **What is billable.** A quotation line is billable when the customer approved it on the CURRENT
  revision of a live quotation of the work order — issued, or rejected by the roll-up because
  another line was refused. Undecided and refused lines are never billed, and are shown with why. A
  revision need no longer be accepted as a whole: its approved lines are billable on their own.
- **The source line across revisions.** A quotation line carries no pointer to the line it replaced
  (revisions are typed afresh), so the identity that survives a superseding revision is what is
  sold: the line kind with its service, or with its catalogue item — its lineage. Nothing is stored
  or backfilled; existing rows are followed by the columns they already have. A line naming neither
  (not writable through the API) is its own lineage.
- **What is invoiced, and how much remains.** The invoice lines themselves are the record, by
  invoice line: each names its source quotation line, its quantity and (behind `sal.finance.view`)
  its net and tax. `sal.billable_quotation_lines` derives, per line of a revision, the approved,
  invoiced and remaining quantity and the remaining net, tax and discount, pooling what live
  invoices of the work order hold for the same lineage under any revision. A later revision that
  raises an approved quantity leaves only the increase billable, at the approved line's total less
  what was already invoiced (its discount is not restated); a superseded revision is never a source
  again. An invoice voided before issue releases what it held; an issued or credited invoice keeps
  it.
- **Held by the database.** `sal.guard_invoice_line_source` and
  `sal.guard_invoice_line_amount_source` refuse any line of an invoice that names a revision unless
  it names a billable line of that revision, of its kind, within the remaining quantity and amount;
  both judge after taking the work order row lock (`FOR NO KEY UPDATE`), so two creators racing for
  the same quantity cannot both succeed. `uq_invoices_work_order_active` is replaced by
  `uq_invoices_work_order_draft` (one draft per work order — a concurrent second create is refused
  by the index), `uq_invoices_work_order_unsourced` (the old one-live-invoice rule, kept for
  invoices that name no revision) and `sal.guard_invoice_work_order_source` (the two kinds never
  coexist; the revision is frozen). A second live invoice is therefore possible only for approved
  quantity no live invoice holds. Idempotency stays the existing key and `uq_invoices_idempotency`.
- **In the backend and on screen.** `sal.invoice-create` bills exactly the remaining approved
  quantities and answers 409 with `invoice_draft_open`, `invoice_nothing_to_bill` or the guard's
  rule; `sal.invoice-preview` lists what it would bill with the approved and already invoiced
  quantities, every other line with why, and the revision as quoted; `sal.work-order-invoice-read`
  lists every live invoice and says whether approved work remains; the delivery financial blocker
  judges every live invoice and treats unbilled approved work as outstanding (overridable, as an
  absent invoice is). Credit-note eligibility, payment allocation and the invoice-and-payment report
  are per invoice and were already correct with several invoices.

Open points (each choice is the one that can never bill more than the Owner allowed):

- **Credit notes do not release quantity.** The Owner text does not say whether an approved credit
  note makes the credited work billable again; it does not, so a credited line is never re-billed.
- **Approved lines of an expired or superseded revision are not billed.** A revision that lapsed or
  was replaced before being billed is not a source; its approved work is billed only through the
  current revision.
- **A re-priced line.** When a later revision prices a partly invoiced line so that its approved
  total is below what was invoiced, nothing more is billed (`repriced_below_invoiced`); whether
  that calls for a credit note is not decided here. The remaining part of a raised line is billed at
  the difference of totals, not pro rata, so no rounding policy is invented.
- **Two approved lines of one lineage** after part of it was invoiced under an earlier revision are
  refused (`lineage_ambiguous`) rather than one being guessed; the quotation must be revised.
- **Several quotations on one work order (Owner decision needed).** Only a quotation with approved
  work still to bill competes as the source. When two do, the work order is refused (409) until one
  is cancelled, and the delivery blocker stays on unless overridden. This refuses more than base
  did: base billed the one quotation the customer accepted as a whole and ignored another with only
  some lines approved. Under D5 both are approved work, and which one wins is not chosen here. Once
  one quotation's approved work is all invoiced, it no longer competes, so another quotation's
  approved lines are billed on a further invoice, which base (one live invoice per work order)
  never did; this too needs Owner confirmation.
- **What is already invoiced is pooled by work order, not by quotation (open policy point, not an
  Owner approval).** The lineage pool covers every quotation of the work order. An approved line of
  a second quotation selling a service or part that a first quotation already invoiced counts that
  quantity as already invoiced: up to it, the line is shown under "Already invoiced", is not billed,
  and does not hold the delivery blocker. Once the second quotation's other approved lines are
  invoiced, approved work to invoice turns false; when it has no other approved line, the preview
  answers a conflict (409), not "nothing to bill". Scoping the pool to one quotation's revisions
  would bill that line, at the risk of billing work quoted twice; pooling by work order never bills
  more. The next subsection records the point in full.

#### Open policy point: the same service approved again

**Status.** Open. By Owner instruction of 2026-10-06, reading "already invoiced" across the whole
work order is an open policy point, **not an Owner approval**. The pooling described below is the
conservative rule the platform applies until the Owner answers; it is not accepted policy, and
nothing in this record presents it as accepted. The verification ledger carries it as VL-P132-003
(`docs/product/owner-directive-2026-09-16/capability-status.md`, state "Blocked by missing access or
an unanswered business decision").

**What the delivered behaviour distinguishes, and what it does not.** The platform knows a line's
lineage (its kind with its service or catalogue item) and the quotation and revision it belongs to.
It has no record that says "this is additional work". So:

- **(a) A repeated revision of the same approved entitlement** — superseding revisions of ONE
  quotation. What an earlier revision invoiced counts against the same lineage in the current
  revision, so re-approving the same quantity in a new revision bills nothing again, and a
  superseded revision is never a source. This is what D15 asks for.
- **(b1) Additional approved quantity within one quotation** — a later accepted revision of the
  same quotation that raises a quantity. Only the increase is billable, at the approved line's total
  less what was already invoiced. This is distinguished correctly.
- **(b2) Genuinely additional work on a second quotation** — a second quotation of the same work
  order that approves the same service (or part) again. Under the conservative pooling rule what
  the first quotation invoiced counts against it: up to that quantity the line is shown as already
  invoiced and is **not billable**; only an approved quantity above it is billed, as the difference
  of totals. The platform
  cannot tell this case from the same work quoted twice by mistake, so it treats both alike. **This
  can block legitimate additional billing**: work the customer approved and the workshop did is
  neither invoiced nor counted as outstanding at delivery.

**Evidence.**

- `tests/backend/od-invoice-approved-quantities.test.ts`, case "a second quotation selling a
  service the first already invoiced: that line counts as invoiced, the rest is billed", pins the
  pooled answer: the second quotation's service line reads approved 1.000, invoiced 1.000, remaining
  0.000, `fully_invoiced`; only its part line is billed; afterwards no approved work remains and the
  preview is a conflict. In the same file, "bills only the increase of an approved quantity; the
  superseded revision is never billed again" pins case (b1).
- Signed-in browser QA at the records revision `789d4f59be32dc450d05df33ffbdbf77668680db` of
  checkpoint CP-20261006-2, rows D5-5 en and ar of
  `orchestration/evidence/owner-directive-2026-10-05-d5-d8-checkpoint/RESULT-MATRIX.md` (outside
  repository; runs `q-60-preview-wo3-en-d55.json` and `q-60-preview-wo3-ar-d55.json`, screenshot
  `q-60-wo3-en-d55-preview.png`). On an existing work order whose first quotation's invoice billed
  the service at 1.000, a second, accepted quotation approving the same service at 0.250 showed that
  line as not billable with "Everything approved on this line is already invoiced." (Arabic: "كل ما
  اعتُمد في هذا السطر مُفوتَر بالفعل."), the "Already invoiced" column reading 1.000 against an
  approved 0.250, and offered only the part line. The rows record the conservative rule's behaviour
  as a limitation pending the Owner; they are not an Owner approval.

**The Owner's possible answers, and what each means.**

1. **Keep pooling by work order.** Nothing is ever billed twice across quotations. Legitimate
   additional work using a service already invoiced on the work order cannot be billed from a second
   quotation, except for an approved quantity above what was invoiced, billed as the difference of
   totals. The other route, a new revision of the first quotation that raises the quantity and
   bills the increase (case b1), is available only while the first quotation is still open: some
   line is undecided and none is rejected. `QuotationService.revise` calls `assertQuotationOpen`
   (`apps/api/src/modules/quotation/application/quotation-service.ts`), which refuses with
   ERR-TRN-001 any quotation that is not `draft` or `active`, and `rollUpDecisions`
   (`apps/api/src/modules/quotation/domain/quotation.ts`) moves a quotation to `accepted` as soon
   as every line is approved and to `rejected` as soon as any line is rejected. Once the first
   quotation has been accepted as a whole, rejected, expired or cancelled, it cannot be revised,
   and nothing in today's platform bills extra work of a service already invoiced on the work order
   except an approved quantity above what was invoiced on the second quotation. The backend case for
   (b1) works because its first revision is only partly approved, which keeps the quotation
   `active`; the D5-5 scenario's first quotation was approved as a whole, so this route is closed
   there. A second quotation's line that is already covered stays
   unbilled and does not hold the delivery blocker. No code change; the conservative rule becomes
   the recorded decision.
2. **Pool per quotation lineage** (quotation, kind and service or item). A second quotation's
   approved line is billed in full; revisions of one quotation keep the D15 protection. The same work
   quoted twice by mistake is billed twice unless someone cancels the duplicate quotation. Needs a
   forward migration changing the pool key of `sal.billable_quotation_lines`, by which the invoice
   source guards also judge, a reversal of the backend case above, and a decision on the separate open point of
   two quotations competing on one work order.
3. **An explicit "additional work" marker with approval.** Pooling by work order stays the default;
   a quotation line marked as additional work, with the marker approved by an authorised person, is
   pooled on its own and billed in full. Duplicate quoting stays protected and genuine additional
   work is billable, at the cost of one more step for staff. Needs a forward migration (the marker,
   who approved it and when), a rule for who may approve it (a permission code and an audit action
   the Owner names), screen changes in English and Arabic, and database and backend cases. Lines
   written before the release carry no marker and keep the pooling.

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

Follow-up particulars (P1-32-PRE-OD-FD6F, Proposed). When the item's selling price or its tax rate
changes between the service reading it and writing the line, the guard's refusal is answered as a
refusal of that line's item (`part_price_changed`, `422`), and nothing is written: the line is never
written at a price or rate that no longer applies, and saving again quotes the price that applies
then. This adds no pricing rule; it is the conservative reading of D6 (a part is quoted at the
authorised sales price, never another). The invoice preview names a part line by the part and its
unit from the line's own snapshot.

### D7 — Credit status

An invoice's credit status is derived from its effective approved credits, reversed credits
excluded: zero is "no credit", above zero and below the eligible total is "partly credited", equal
to it is "credited". The credit status is distinct from the payment status and from the refund
status.

### D8 — No self-exemption from discount approval

Changing one's own threshold, role limit or price list never exempts one's own quotation from
approval. Provenance and snapshots are kept. There is no sole-administrator exception.

Implementation particulars (P1-32-PRE-OD-FD8, Proposed):

- **Provenance, stored on the row from the session.** Who recorded a threshold version
  (`svc.pricing_approval_policies.set_by`), who last changed what a price rule prices
  (`svc.price_rules.price_changed_by`), who published a price-list version
  (`svc.price_list_versions.published_by`) and who last changed an item selling price
  (`inv.item_sale_prices.price_changed_by`), each with its time, stamped by the database from the
  signed-in person and never taken from the writer. A price rule and an item selling price also record
  who set the amount itself (`amount_set_by`), which a later change to anything else (priority, tax
  class, narrowing, status) does not move. An approval limit's `created_by` was already stamped from
  the session and its amount never changes, but its end date (`effective_to`) can be changed, and
  everyone who ever changed it is kept in `window_changed_by`, appended from the session and never
  removed (the last writer, `updated_by`, is not enough: a later save would hide an earlier change).
  Columns, not a history table: the rule needs who put a value in force; earlier values are in the
  audit trail. A price-list assignment records who made it (`assigned_by`) and everyone who ever
  changed what it selects afterwards (`assignment_changed_by`), from the session.
- **Snapshots.** A quotation line copies, when it is written, who had set the amount of, who had last
  changed and who had published the price it was priced from, and the price-list assignment that
  selected its list with who had made and who had changed it; a later change to the source does not
  move it. A
  quotation's pinned threshold version is an immutable row, so the pin is its snapshot. A request
  records why another person must approve (`requester_set_policy`, `requester_set_price`), and an
  approval records the limit it relied on.
- **The rule.** When the requester of a revision (its writer) recorded the threshold version the
  quotation is held to, any discount on it needs approval by somebody else, whatever the threshold
  says. When the writer set a price one of its lines was priced at — its amount, its publication, or
  the price-list assignment that selected its list — or ever changed any price-list assignment, the
  revision needs approval by somebody else whatever its discount, zero included: the price itself can carry the discount, so
  lowering one's own price from 100 to 10 and quoting at 10 gives away what a discount of 90 would.
  Such a request records a discount of zero and why (`requester_set_price`). Both hold at the
  application when the revision is written and at the database when it is issued. Another person's
  quotation follows the threshold and prices as set.
- **Limits.** An approver's limit never counts when the approver or the requester created it, for the
  approver or for a role the approver holds. A changed end date is a changed limit: when the requester
  ever changed the dates of any discount limit of the approver in the company — reopening or extending
  one, or ending one so that another applies — none of the approver's limits counts for that request;
  and when the approver ever changed the dates of one of their own discount limits there (on
  themselves or on a role they hold), none of their limits counts for any request, as for a limit
  they created. A later save by anyone does not clear either. Giving a person a role is changing that
  person's role limit: a role's limit counts toward the approver's ceiling only through a grant that
  neither the requester granted, issued or ever changed (reopening or extending it) nor the approver
  issued or changed themselves, and — when the grant is scoped — through a company scope neither of
  them created or added. Who issued a grant, who changed it and who added a scope are recorded from
  the session (fix round 5).
- **No sole-administrator exception.** The requester never decides their own request, so a second
  authorised person is required, as for D4.
- **Bounded path matrix.** DBCR-P1-32-PRE-OD-FD8-001 section 12 lists every way the requester (or
  the approver, for their own approval) can change what the evaluation relies on. Twelve fall within
  D8's words and are closed, each with its migration and regression test: the threshold version; a
  threshold version dated not to be in force today, which retired the version in force without
  taking its place (fix round 6: the database now holds every request-path writer to a version
  effective from the day it is recorded with no end date, as the application already writes it); a
  limit the requester created; a limit's dates; a role limit's value; a role grant and a grant scope
  bringing a role's limit; a price rule's amount; an item selling price's amount and its withdrawal
  or restoration; a price-list publication; and a price-list assignment. Three fall outside them and
  are an unanswered Owner question, not restricted by this change: the approval permission brought
  by a role grant, the approval permission brought by a role-permission mapping, and reactivating the
  approver's account ("Who may approve" below). None is left as a residual.

Open points. For the paths within D8's words — a threshold, a role limit or a price list — each
choice below is the one that never grants more than the Owner allowed (fix round 3 corrected one that
did not, a self-set price quoted with no discount; fix round 4 another, a price-list assignment the
requester made; and fix round 5 two more, a role grant or grant scope the requester made and a
selling price the requester withdrew). That statement does not cover the paths outside those words:
they are listed below as an Owner decision needed, with what happens today, and this change does not
restrict them.

- **Reading chosen.** D8 allows evaluating under the version in force before the person's change. A
  price changed in place keeps no earlier value and an earlier version may be the same person's, so
  that cannot always be reconstructed; an independent approver is required instead, which never
  grants more.
- **A self-set price with no discount (strict reading; the Owner may rule otherwise).** Leaving a
  quotation with no discount alone at a price its writer set was a self-exemption: the writer lowers
  the price themselves and quotes with no discount, and the customer gets what needed another
  person's approval before the change, approved by nobody — a sole administrator included. The
  price in force before the change is not kept, so it cannot be measured against; another person's
  approval is required instead, whatever the discount. If the Owner rules that a price one sets
  oneself, quoted with no discount, needs no second person, that ruling is recorded here; until then
  this reading stands.
- **A price-list assignment is a price-list change (strict reading; the Owner may rule otherwise).**
  D8 names the price list. Pointing one's own branch (or company, or customer class) at another list,
  more specifically or at a higher priority, changes which price applies as surely as changing the
  price, so the person who made the assignment that selected a line's list, or changed it, is treated
  as having set that price; so is anyone who ever changed any assignment of the tenant (ending or
  re-prioritising a competing one changes which list applies without being the one that won). No
  route changes an assignment today, so that last clause is wider than the change and reaches only
  direct writers. If the Owner rules that an assignment is not a price-list change, that ruling is
  recorded here; until then this reading stands.
- **A role grant is a role-limit change (strict reading; the Owner may rule otherwise).** D8 names
  the role limit. Granting the approver a role brings that role's limit to them as surely as raising
  it, so a grant the requester issued (whoever it names as granting it), reopened or extended, or a
  company scope the requester added, does not bring the role's limit to the approver for the
  requester's request; it still does for anybody else's. A grant or scope the approver made or
  changed for themselves does not count for any request, as a limit they created does not. If the
  Owner rules that granting a role is not a role-limit change, that ruling is recorded here; until then
  this reading stands.
- **A withdrawn selling price is a price change (strict reading; the Owner may rule otherwise).**
  Deactivating or deleting the branch's selling price hands the line to a cheaper company or
  tenant-wide price somebody else set. A person who ever withdrew or restored any selling price of an
  item is treated as having set the price of every line priced from that item's selling prices, which
  is wider than the change and never grants more. A price rule cannot be withdrawn this way: its
  version is frozen once published.
- **Who may approve (Owner decision needed; not decided).** D8 names a threshold, a role limit and a
  price list. Three acts of the requester change who may approve the request instead, and none of
  them is restricted by this change:
  1. a role grant (or a scope on one) that the requester issues to the approver, through
     `POST /iam/grants` or `POST /iam/grants/{grantId}/scopes`, bringing a role that carries the
     approval permission the request records;
  2. a role-permission mapping on a role the approver holds — adding that permission, changing a
     mapping to allow it, or removing a denial of it — through `/iam/roles/{roleId}/permissions`;
  3. reactivating the approver's locked account through `POST /iam/users/{userId}/status`; a locked
     account holds no permission.

  Today the database guard and the application check the approval permission when the decision is
  made, through `iam.has_permission_in_scope`, which counts every active grant, scope and mapping of an
  active account, whoever made them. So the requester's act can turn a refusal for the missing
  permission into an approval of their own request, provided the approver also holds a discount limit
  that counts for it (one neither of them created or moved, and not one brought only by a grant the
  requester issued or changed). The grant in route 1
  brings no role limit for the requester's request; it does bring the permission. A different person
  still decides, and the requester never decides their own request.

  The question for the Owner is whether D8 reaches who may approve as well as the threshold, the
  limit and the price. If the Owner rules that it does not, the current behaviour stands, the ruling
  is recorded here, and nothing else changes. If the Owner rules that it does, a further forward
  migration and application change follow: the approval permission counts only through a grant the
  requester neither granted, issued nor changed and a scope they did not add (the provenance has been
  recorded since migration 20261007140000); a mapping records from the session who added or changed
  it, and a removed denial needs a history of mappings first, because a removed row leaves nothing to
  read; and an account's status changes need an append-only record of who made them, because the
  account keeps only its last writer. The consequence of that answer is that an approver whose
  permission or account the requester gave or restored cannot approve that requester's request, and
  someone else must. The Owner may also rule on each of the three routes separately.

- **An approver's own changes (Owner decision needed; not decided).** D8's text speaks of "one's own
  quotation". Two rules go further and exclude an approver's limit for anybody's request, not only
  the approver's own: an approver who moved the dates of one of their own discount limits in a company
  (fix round 2), and an approver who issued or changed their own role grant, or added a scope to it
  (fix round 5), has no limit that counts there while that limit, grant or scope is theirs, and a new
  limit set by somebody else does not restore it. This is not a new commercial rule: `develop` already
  refuses a self-grant and a self-scope at the route and setting one's own approval limit
  (`access-administration-service.ts`, `assertNotSelf` and
  `assertApprovalLimitNotForSelf`), so these rules reach only a change made
  around those refusals; but the limit-ending route does not refuse an approver's own window change up
  front, as limit creation does. Whether D8 reaches an approver's own changes for other people's
  requests — refusing them at the route, or letting a fresh limit or grant set by another
  administrator count — is the Owner's choice. It is unresolved and not implemented as a ruling; until
  the Owner rules, the stricter reading stands, which never grants more (verification ledger
  VL-P132-002).
- **Before this change.** Provenance of existing rows is their last recorded writer, not a verified
  attribution, and who set an existing amount is taken from it; who published an existing price-list
  version was not recorded; who made an existing price-list assignment is taken from its creator and
  who changed it from its last writer; lines written earlier carry no snapshot; who moved an existing limit's
  dates is taken from its last writer, so earlier changes of the same limit are not known; who issued
  an existing grant is taken from its creator, who changed it from its last writer, who added an
  existing scope from its creator, and who withdrew an existing selling price from its last writer
  and deleter. A legacy draft whose writer set what it relies on cannot be issued until revised.

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

| Decision | Existing behaviour (before this record's pull request)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Missing implementation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Tests                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Pull request                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1       | Line tax and totals rounded to four decimals (`mig:20260723096000_quo_quotations.sql:216-217`, `mig:20260917093000_sal_counter_sales.sql:434-437`); prices, discounts and thresholds accepted at four decimals for every currency                                                                                                                                                                                                                                                                                                                 | Implemented here: `mig:20260930100000_sal_minor_unit_rounding.sql` (per-line half-up rounding to the minor unit; totals as sums of rounded lines; the two CHECKs replaced by `tg_quotation_items_money`); minor-unit refusal of fixed discounts and amount thresholds; a price rule and an item selling price are unit prices and keep their scale                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `tests/db/sal-minor-unit-rounding.test.ts`, `tests/backend/od-finance-rounding.test.ts`, `tests/unit/od-finance-rounding.test.ts`, web field-error cases                                                                                                                                                                                                                                                                                                           | This pull request                                                                                                                                                              |
| D2       | Credit ceiling is the open receivable (`mig:20260930090000_sal_finance_controls.sql:181-184`); no refund instrument                                                                                                                                                                                                                                                                                                                                                                                                                               | Ceiling = eligible invoiced − effective credits; refund obligation with separate dual-controlled approval and payout                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Planned                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Planned (D2)                                                                                                                                                                   |
| D3       | Schema admits `rejected` (`mig:20260930090000_sal_finance_controls.sql:109-111`); only the approval route exists. Discount requests: a rejection already requires a reason (`apps/api/src/modules/quotation/application/discount-approval-service.ts:429`), the requester may decide their own request neither way (`apps/api/src/modules/pricing/application/discount-authorization-service.ts:453`), and a pending request is superseded only by revising the quotation (`apps/api/src/modules/quotation/application/quotation-service.ts:556`) | Delivered for credit notes by pull request P1-32-PRE-OD-FD2A: `mig:20260930110000_sal_credit_note_decisions.sql` (`withdrawn` state; `sal.guard_credit_note_decision` at :99 holds requester-only withdrawal, rejection by a different holder of `sal.credit.manage` in the note scope with a reason — `sal.credit.approve` since P1-32-PRE-OD-FD2C (D13) — and terminal decisions; `sal.withdraw_credit_note` :240, `sal.reject_credit_note` :269); `sal.credit-note-withdraw` (`sal.credit.manage`) and `sal.credit-note-reject` (`sal.credit.manage` + `sal.finance.view`), version-guarded and idempotent, audited as `sal.credit_note.withdrawn` and `sal.credit_note.rejected`; Withdraw and Reject on the credit-note screen. Discount requests: delivered by pull request P1-32-PRE-OD-FD8 — `mig:20261007090000_quo_discount_self_exemption_and_withdrawal.sql` (`withdrawn` state; `quo.guard_discount_approval` holds requester-only withdrawal of a pending request and makes it terminal); `quo.discount-approval-withdraw` (`quo.quotation.manage`), version-guarded and idempotent, audited as `quo.discount_approval.withdrawn`; Withdraw request on the quotation screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `tests/db/sal-credit-note-decisions.test.ts`, `tests/db/inv-counter-sales-and-returns.test.ts`, `tests/backend/od-finance-credit-decisions.test.ts`, `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/billing-api.test.ts`, `tests/db/quo-discount-self-exemption.test.ts`, `tests/backend/od-discount-self-exemption.test.ts`, `apps/web/tests/quotation-detail.dom.test.tsx`                                                                              | P1-32-PRE-OD-FD2A, P1-32-PRE-OD-FD8 (discount withdrawal)                                                                                                                      |
| D4       | Approval primitive only (`mig:20260930090000_sal_finance_controls.sql:193-220`); no request route                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Delivered by pull request P1-32-PRE-OD-FD4: `mig:20261002090000_sal_receipt_reversal_requests.sql` (`sal.request_receipt_reversal` and the BEFORE INSERT guard `sal.guard_receipt_reversal_request`: a FULL reversal, amount and currency bound to the receipt, reason required, requester stamped and holding `sal.payment.record` in the receipt's company and branch, refused for a reversed receipt or one with a pending or approved reversal; `sal.stamp_dual_control_maker` births every reversal pending and undecided, closing the #489 residual; one LIVE reversal per receipt (`uq_receipt_reversals_receipt_live`); `sal.guard_allocation_receipt_open`: a pending reversal freezes the receipt for new allocations; `sal.guard_receipt_reversal_decision`: approval and rejection by a different holder of `sal.reversal.approve` in the receipt scope, which no credit-note code satisfies, rejection with a reason, withdrawal by the requester only, decided rows terminal, deciders and dates stamped; `sal.approve_receipt_reversal` re-issued receipt-first, reversing the receipt, keeping every allocation recorded and writing one `receipt_reversed` event, with `tg_receipt_reversals_applied` refusing an approval that did not reverse its receipt; `sal.receipts.replaces_receipt_id` with `sal.guard_receipt_replacement`: one replacement per approved-reversed receipt, same branch, frozen); five operations `sal.receipt-reversal-request`, `-approve`, `-reject`, `-withdraw` and `sal.receipt-replacement-record`, audited, with named refusals recorded through D12; the receipt panel offers each step only to whom it belongs and closes allocation while a reversal waits. UPGRADE (no silent permission change): `sal.reversal.approve` was already seeded, so no seed run is owed; the standard tenant administrator bundle carries it from now (96 codes); an organisation provisioned earlier cannot approve or reject a receipt reversal until an administrator who holds the code grants it, and the operator backfill adds it only for `odqa_alpha` and `odqa_beta`, preserving a customised role (CC-OD-53). Not a refund (D2); historical reports are not restated (D16 open)                                                                                                                                                                                                                                    | `tests/db/sal-receipt-reversal-requests.test.ts`, `tests/backend/od-finance-receipt-reversal.test.ts`, `tests/unit/od-finance-receipt-reversal.test.ts`, `tests/backend/p1-31-provisioning-bundle.test.ts`, `tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts`, `apps/web/tests/payments-print-and-reversal.dom.test.tsx`, `apps/web/tests/payments-api.test.ts`                                                                                   | P1-32-PRE-OD-FD4                                                                                                                                                               |
| D5, D15  | One live invoice per work order (`mig:20260917093000_sal_counter_sales.sql:72-73`); a revision with any undecided or rejected item is not billable                                                                                                                                                                                                                                                                                                                                                                                                | Delivered by pull request P1-32-PRE-OD-FD5: `mig:20261006090000_sal_invoiced_quotation_quantities.sql` (`sal.billable_quotation_lines` — per line of a revision the decision, the approved, invoiced and remaining quantity and the remaining net, tax and discount, pooled per work order and lineage (kind with its service or item) across revisions; `sal.guard_invoice_work_order_source`, `sal.guard_invoice_line_source` and `sal.guard_invoice_line_amount_source` under the work order row lock; `uq_invoices_work_order_active` replaced by `uq_invoices_work_order_draft`, `uq_invoices_work_order_unsourced` and the guards); `sal.invoice-create` bills only the remaining approved quantities (409 `invoice_draft_open`, `invoice_nothing_to_bill`, or the guard rule); several live invoices per work order; `sal.invoice-preview` adds approved, invoiced and remaining quantities, the revision lines with why they are not billed and the revision totals; `sal.work-order-invoice-read` adds `invoices`, `invoicesTruncated` and `approvedWorkToInvoice`; the delivery blocker judges every live invoice and unbilled approved work; the invoice screen lists the invoices, shows approved, already invoiced and to invoice per line and the not-billed reasons in English and Arabic, and offers what remains. No permission code, audit action or route is added. Open points kept: credit notes do not release quantity; approved lines of an expired or superseded revision are not billed; a re-priced line below what was invoiced and two approved lines of one lineage are refused, not guessed; two quotations with approved work still to bill are refused, more than base refused (Owner decision needed); what is already invoiced is pooled by work order, so a second quotation's line of a service or part a first quotation invoiced is not billed again (open policy point VL-P132-003, not an Owner approval)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `tests/db/sal-invoiced-quotation-quantities.test.ts`, `tests/backend/od-invoice-approved-quantities.test.ts`, `tests/unit/od-invoice-approved-quantities.test.ts`, `apps/web/tests/invoice-approved-quantities.dom.test.tsx`, `apps/web/tests/invoices.dom.test.tsx`                                                                                                                                                                                               | P1-32-PRE-OD-FD5                                                                                                                                                               |
| D6       | Quotation lines are services only (`apps/api/src/modules/quotation/application/quotation-service.ts:1295`)                                                                                                                                                                                                                                                                                                                                                                                                                                        | Delivered by pull request P1-32-PRE-OD-FD6: `mig:20261005100000_quo_part_line_snapshots.sql` (six nullable snapshot columns on `quo.quotation_items` — the `inv.item_sale_prices` row, the item’s stock code and name, its unit code and name, the tax class — and `quo.guard_quotation_part_line`, BEFORE INSERT OR UPDATE: a part line only at exactly what `inv.resolve_item_sale_price` answers for its branch, with that class’s effective rate (zero for none), the item’s current words and unit and a required part of its own work order; the snapshot, unit price, rate and currency frozen); `quo.quotation-create` and `quo.quotation-revision-create` take `kind: part` with `itemId` (and an optional `sourceRequiredPartRef`), priced through `@/modules/inventory` (`catalog.quotablePart`) and `@/modules/pricing` (`prices.taxRateFor`), never at cost, refusing an item with no price (`no_authorised_sale_price`), archived (`item_archived`) or outside the catalogue (`item_not_found`) on the line; the discount goes through the existing approval rule; quantities follow the inventory quantity rules; `MoneyLine` and the invoice line gain `item` and `unit` (the invoice line reads the unit through `source_quotation_item_id`); `issuePostsStock` keeps a work-order invoice from posting stock; the builder offers a part line to holders of `inv.item.read` in English and Arabic. No permission code, audit action or route is added. Only one source can price an item today; precedence between sources is not decided (CC-OD-47). Tax remains blocked on the accounting questionnaire, and CC-OD-48 applies equally to part lines. Not linked to part issues; unquoted part issues are not billed (D5/D15). Follow-up P1-32-PRE-OD-FD6F: a selling price or tax rate that changes between the price read and the line write is refused on the line's item (`part_price_changed`, 422, nothing written) instead of a server fault; the invoice preview names a part line by the part and its unit. Open points kept: the API does not require `inv.item.read` for a part line (as a service line does not require `svc.service.read`); `sal.invoice_lines.tax_class_id` stays NULL for work-order part lines while tax is blocked on the accounting questionnaire                                                                                                                                                           | `tests/db/quo-part-line-snapshots.test.ts`, `tests/backend/od-quotation-part-lines.test.ts`, `tests/unit/od-quotation-part-lines.test.ts`, `apps/web/tests/quotation-part-lines.dom.test.tsx`, `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/quotations-api.test.ts` (all extended by P1-32-PRE-OD-FD6F)                                                                                                                                                 | P1-32-PRE-OD-FD6, P1-32-PRE-OD-FD6F                                                                                                                                            |
| D7       | No read derives a credit position; a fully credited invoice read "Settled"; `inv.lock_return_source` accepts only `issued` invoices (`mig:20260917094000_inv_sales_returns.sql:257`), so no terminal `credited` status is set                                                                                                                                                                                                                                                                                                                     | Implemented here: `SettlementView` on `sal.invoice-outstanding-read` (`creditStatus`, `paymentStatus`, `refundStatus`), `creditStatus` on the invoice-and-payment report, invoice screen and print in English and Arabic                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `tests/backend/od-finance-rounding.test.ts`, `tests/backend/p1-31-report-engine-invoice-payment.test.ts`, `tests/unit/od-finance-rounding.test.ts`, `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/reports.dom.test.tsx`                                                                                                                                                                                                                                  | This pull request                                                                                                                                                              |
| D8       | Policy pinned per quotation; an approver's own limit never counts (`mig:20260925090000_quo_discount_approvals.sql:252-282, 451-453`)                                                                                                                                                                                                                                                                                                                                                                                                              | Delivered by pull request P1-32-PRE-OD-FD8: `mig:20261007090000_quo_discount_self_exemption_and_withdrawal.sql` (provenance stamped from the session on threshold versions, price rules, price-list publications and item selling prices; its snapshot on quotation lines; `quo.revision_self_change_basis`; `quo.revision_discount_needs_approval` and `quo.guard_discount_approval` re-issued so any discount needs another person when its requester set the threshold version or a price, and a limit the requester set never counts); the request names why; no sole-administrator exception                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `tests/db/quo-discount-self-exemption.test.ts`, `tests/backend/od-discount-self-exemption.test.ts`, `tests/db/quo-quotations.test.ts`, `apps/web/tests/quotation-detail.dom.test.tsx`                                                                                                                                                                                                                                                                              | P1-32-PRE-OD-FD8 (D17: Planned)                                                                                                                                                |
| D9       | A return raises a pending credit note (`mig:20260930090000_sal_finance_controls.sql:326-371`) without its own audit record                                                                                                                                                                                                                                                                                                                                                                                                                        | Delivered by pull request P1-32-PRE-OD-FD2A. Receiving a return stays gated by `inv.stock.operate` + `sal.finance.view` (`apps/api/src/app/api/v1/sales-returns/route.ts:139`), never `sal.credit.manage`; the credit request is audited as `sal.credit_note.requested` naming the return, in the return’s transaction (`apps/api/src/modules/inventory/application/inventory-sales-return-service.ts:292`); a retried return is answered before the remaining quantity is re-read, so it moves no second stock; a withdrawn note no longer counts in the cumulative return credit (`mig:20260930110000_sal_credit_note_decisions.sql:408`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `tests/backend/od-finance-credit-decisions.test.ts`, `tests/db/inv-counter-sales-and-returns.test.ts`, `tests/unit/od-finance-controls.test.ts`                                                                                                                                                                                                                                                                                                                    | P1-32-PRE-OD-FD2A                                                                                                                                                              |
| D10      | Invoice and receipt prints only (`apps/web/src/features/billing/components/InvoiceDocument.tsx`); this pull request adds the credit and payment status to the invoice print                                                                                                                                                                                                                                                                                                                                                                       | Delivered for the invoice print by pull request P1-32-PRE-OD-FQB: the issued facts (each job line's discount from the matched quotation revision, the before-discount and discount totals, net, tax, gross) are printed apart from a "Payments and credits as of" section (amount paid, amount credited, balance due, payment and credit position) headed with the moment `sal.invoice-outstanding-read` was read (`asOf`, the database clock) on the branch clock, on the counter-sale and the work-order print, only for a reader holding `sal.finance.view`. Delivered for the receipt print by pull request P1-32-PRE-OD-FQC (#497, `225f9e41`): each allocation names its invoice by number (`apps/web/src/features/payments/components/ReceiptDocument.tsx:202-212`). Delivered for the quotation and credit-note prints by pull request P1-32-PRE-OD-FD10: the quotation print (the current or a chosen revision; number, revision, issue and validity dates, branch, the job's number, customer and vehicle by name, each service and part line with its unit, quantity, unit price, discount, tax and line total and the totals as issued, the discount-approval state, and the D11 acceptance record headed as a record, not a signature) carries no invoice, payment, balance, cost or margin (D17) (`apps/web/src/features/quotations/components/QuotationPrint.tsx`); the credit-note print names the invoice it credits by number, the customer, the amount, the reason, the state with the requester's and decider's names and dates, and the source return (`apps/web/src/features/billing/components/CreditNotePrint.tsx`). Both are English and Arabic, right to left in Arabic, paginated by the shared print frame, and written at the currency's minor unit. Not delivered: the legal tax-invoice fields and credit-note document numbering, both deferred to the accounting questionnaire (a credit note has no number column, so its print carries a reference composed from the invoice number and the request time, and no numbering policy is set); and dedicated print permissions, pending Owner question Q9 (`docs/product/owner-directive-2026-09-16/README.md`, question 9; CC-OD-50). Until Q9 is answered each print is gated by the same read permissions as its page (`quo.quotation.read` for quotations; `sal.credit.manage` and `sal.finance.view` for credit notes), so nobody can print what they cannot read on screen | `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/inventory-counter-sales.dom.test.tsx`, `tests/backend/od-finance-credit-decisions.test.ts`, `apps/web/tests/payments-print-and-reversal.dom.test.tsx` (receipt allocations), `apps/web/tests/quotation-print.dom.test.tsx`, `apps/web/tests/credit-note-print.dom.test.tsx` (quotation and credit-note prints)                                                                                             | P1-32-PRE-OD-FQB; P1-32-PRE-OD-FQC (#497) for receipt allocations; P1-32-PRE-OD-FD10 for quotation and credit-note prints; legal fields and print permissions open (D10 + D16) |
| D11      | Decision channel recorded, evidence optional (`apps/api/src/modules/quotation/application/quotation-decision-service.ts:78`)                                                                                                                                                                                                                                                                                                                                                                                                                      | Delivered by pull request P1-32-PRE-OD-FD11: `mig:20261005090000_quo_acceptance_records.sql` (`quo.acceptance_records`, one append-only record per accepted revision, written by the decision that completes the acceptance in its transaction: the payer when the employee said the payer decided, a typed contact name and telephone number (the CRM model holds contact channels, not contact persons), the channel, the evidence kind, reference note and document version given, and the recorder and time stamped by `quo.guard_acceptance_record` from the session; SELECT and INSERT only, every UPDATE refused). Shown on the quotation detail as an acceptance record, never a signature; a revision accepted before records existed says it has none and is not backfilled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `tests/db/quo-acceptance-records.test.ts`, `tests/backend/od-quotation-acceptance-record.test.ts`, `tests/unit/od-quotation-acceptance-contact.test.ts`, `apps/web/tests/quotation-acceptance-record.dom.test.tsx`                                                                                                                                                                                                                                                 | P1-32-PRE-OD-FD11                                                                                                                                                              |
| D12      | Audit is written inside the command transaction; `recordSecurityEvent` exists for authorization denials (`apps/api/src/server/audit/security-events.ts:45`)                                                                                                                                                                                                                                                                                                                                                                                       | Delivered by pull request P1-32-PRE-OD-FD2A: a service marks a refusal by business rule (`apps/api/src/server/audit/business-refusals.ts`) and the route pipeline writes ONE `business-rule.refused` security event after the command rolls back (`apps/api/src/server/http/route-handler.ts:636`), naming operation, entity, rule and outcome only. Recorded: credit-note approve, reject and withdraw refusals (self-approval, self-rejection, wrong requester, decided note, over the open amount); discount decisions (`discount-approval-service.ts:493`: own request, missing permission, no or own-created or other-currency limit, over the limit); over-allocation (`payment-service.ts:716`, `:752`). D13 marks its limit refusals the same way                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `tests/backend/od-finance-credit-decisions.test.ts`, `tests/backend/p1-20-quotation.test.ts`, `tests/unit/od-finance-refusal-records.test.ts`                                                                                                                                                                                                                                                                                                                      | P1-32-PRE-OD-FD2A                                                                                                                                                              |
| D12 ext. | Route-gate refusals on the four decisions and every credit-note rejection refusal: log line only; a scope or guard refusal for want of the deciding code on the other three: `business-rule.refused`; a refusal for want of `sal.finance.view` alone: log line only                                                                                                                                                                                                                                                                               |
| D13      | Approval limits exist for discounts only; any holder of the credit permission approves any amount                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Delivered by pull request P1-32-PRE-OD-FD2C: `mig:20261001090000_sal_credit_approval_limits.sql` (`sal.guard_credit_note_decision` re-issued: an approval needs `sal.credit.approve` in the note scope and a `credit_note` limit in the note currency, not created by the approver, covering every approved credit on the invoice including this note, read under the invoice row lock; a rejection needs `sal.credit.approve`; `iam.guard_approval_limit_money`: a new limit fits the minor unit and a credit-note limit is above zero; the exclusion constraints key a credit-note limit by currency); the minted code `sal.credit.approve` (seed, standard tenant administrator bundle, selective QA backfill); `sal.credit-note-approve` and `sal.credit-note-reject` declare it; named refusals recorded through D12 (`apps/api/src/modules/billing/application/invoice-service.ts`); Approve and Reject offered only to holders; the limit type chosen by name on the approval-limit form                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `tests/db/sal-credit-approval-limits.test.ts`, `tests/backend/od-finance-credit-limits.test.ts`, `tests/backend/p1-31-provisioning-bundle.test.ts`, `tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts`, `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/user-access.dom.test.tsx`                                                                                                                                                          | P1-32-PRE-OD-FD2C                                                                                                                                                              |
| D14      | `sal.allocate_receipt` compares no payer (`mig:20260930090000_sal_finance_controls.sql:240-293`)                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Delivered by pull request P1-32-PRE-OD-FD14: `mig:20261002100000_sal_third_party_allocations.sql` (`sal.guard_allocation_payer`, BEFORE INSERT on `sal.payment_allocations`: an allocation whose receipt payer is not the invoice customer is refused (`allocation_payer_mismatch`) unless it is a third-party allocation carrying a relationship from the fixed vocabulary insurer, employer, other, an authorisation reference and a reason, made by a holder of `sal.payment.third_party` in the receipt scope, with the authorising user stamped from the session; a same-payer allocation carries no third-party detail; a raw insert is held to the receipt and invoice currency; `sal.allocate_receipt` re-created with three trailing arguments and the replay comparison widened to them; existing allocations reported, never rewritten); the minted code `sal.payment.third_party` (seed, standard tenant administrator bundle, selective QA backfill), consulted and not declared by `sal.payment-allocate`, which takes an optional `thirdParty` block; refusals named and recorded through D12; the audit action `sal.payment.third_party_allocated`; the receipt detail, the invoice settlement and the invoice-and-payment report show who paid for whom; the allocate form explains another customer's invoice, offers the third-party payment only to holders and blocks everyone else. UPGRADE (no silent permission change): an allocation across customers that technically worked before is now refused unless it is an authorised third-party allocation; seed 04 is re-run on an existing database first; the bundle carries the code from now (97 codes); an organisation provisioned earlier cannot make a third-party allocation until an administrator who holds the code grants it, and the operator backfill adds it only for `odqa_alpha` and `odqa_beta`, preserving a customised role (CC-OD-54). Not split billing, not an insurer receivable, not a refund (D2); no limit                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `tests/db/sal-third-party-allocations.test.ts`, `tests/backend/od-finance-third-party.test.ts`, `tests/unit/od-finance-third-party.test.ts`, `tests/backend/p1-31-provisioning-bundle.test.ts`, `tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts`, `tests/backend/p1-31-report-engine-invoice-payment.test.ts`, `apps/web/tests/payments-third-party.dom.test.tsx`, `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/payments-api.test.ts` | P1-32-PRE-OD-FD14                                                                                                                                                              |
| D16      | The invoice-and-payment report computes the open receivable at run time (`apps/api/src/modules/reporting/domain/report-datasets.ts:467`)                                                                                                                                                                                                                                                                                                                                                                                                          | As-of calculation, preserved period snapshot, restatement marking                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Planned                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Planned (D10 + D16)                                                                                                                                                            |
| D17      | Quotation amounts readable with the quotation read permission (finance review M-08)                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Documented inference; API and interface keep invoice, payment, balance, cost, margin and report data behind the finance permission                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Planned                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Planned (D8 + D17)                                                                                                                                                             |

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
