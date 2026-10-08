# Owner decision pack — 2026-10-08

Prepared 2026-10-08 under task id P1-32-PRE-OD-DPK, from a read-only review of `develop` at
`f36fe2d8`. It sets out, for each open Owner decision named by the completion plan of 2026-10-08
(outside the repository), the exact question, what the product does today, worked examples, the
options, the planner's recommendation, what would change for existing data and permissions, and the
cases that would prove an answer was delivered.

**Nothing in this pack is decided.**

Every recommendation here is the planner's proposal, not an Owner decision. Each item stays open
until the Owner answers it, and the answer is then recorded against the item's canonical id (the
open questions in [`README.md`](README.md), the rows of [`change-control.md`](change-control.md),
ADR-023 or ADR-024), not in this pack. Until then, each item's "Until the Owner answers" paragraph
states what holds, and work that does not depend on an answer continues meanwhile.

Each section starts in plain language: the question, today's behaviour, examples, options, the
recommendation and the interim treatment. The technical detail for the development team (file and
line references, data and permission transitions, acceptance cases, evidence and gaps) follows under
"Detail for the development team". File and line references are as read at `f36fe2d8` and move as
files change. Nothing was executed to prepare this pack: no test was run and no database was
queried. Where a figure would need a query, the section says so.

How to answer: name the label and the option chosen (or state a different rule). Several items
depend on each other: FIN01-b follows FIN01; PERM01, RPT01, RPT02, RPT03 and ODO01 share one
backfill mechanism, which adds every missing administrator permission at once; PRINT01-a to
PRINT01-c share the notice question of question 9.

## Index

| #   | Label                                                                             | The question in one line                                                                              | Recorded as                                                                                       |
| --- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | [FIN01](#fin01-the-same-service-sold-again-on-a-second-quotation)                 | Is a service sold again on a second quotation new work, or work already billed?                       | VL-P132-003; ADR-023 D5 and D15                                                                   |
| 2   | [FIN01-b](#fin01-b-two-quotations-with-approved-work-on-one-work-order)           | When two quotations both hold approved, unbilled work, which one does an invoice bill?                | ADR-023 D5 and D15, open point "several quotations on one work order"; coupled to VL-P132-003     |
| 3   | [FIN01-c](#fin01-c-a-quantity-or-price-lowered-after-it-was-invoiced)             | What happens to an amount already billed when a later revision lowers or rejects it?                  | ADR-023 D5 and D15, open points "credit notes do not release quantity" and "a re-priced line"     |
| 4   | [FIN02 part 1](#fin02-part-1-who-may-approve-a-discount-vl-p132-001)              | Should three ways a requester can influence who approves stop counting for their own request?         | VL-P132-001; ADR-023 D8, open point "who may approve"                                             |
| 5   | [FIN02 part 2](#fin02-part-2-an-approvers-own-changes-vl-p132-002)                | Should an approver's change to their own limit block them for everyone's requests, or only their own? | VL-P132-002; ADR-023 D8, open point on an approver's own changes                                  |
| 6   | [FIN03](#fin03-cancelling-an-approved-refund-that-is-not-yet-paid-out)            | May an approved refund request that will not be paid be cancelled, and by whom?                       | Question 24; ADR-023 D2 part 2 (nearest: open point (e)); ledger rows VL-P132-012 and VL-P132-013 |
| 7   | [FIN04](#fin04-who-may-record-a-refund-payout)                                    | Must the person who records a refund payout be someone other than the approver?                       | Question 25; ADR-023 D2 part 2; ledger row VL-P132-013                                            |
| 8   | [PRINT01-a](#print01-a-a-print-permission-for-each-document)                      | Should printing a document need its own permission, or stay with the right to read it?                | VL-P132-005; question 9 (print part); CC-OD-50 item 3; ADR-023 D10                                |
| 9   | [PRINT01-b](#print01-b-quotation-amounts-on-paper)                                | Should a printed quotation show the prices and totals its reader already sees on screen?              | ADR-023 D17 and D10; question 9; VL-P132-005                                                      |
| 10  | [PRINT01-c](#print01-c-invoice-details-for-a-user-without-finance-visibility)     | May someone who manages invoices, but may not see amounts, still see and print the invoice header?    | ADR-023 D17 open point; question 9; CC-OD-50 item 2                                               |
| 11  | [PRINT01-d](#print01-d-payer-and-customer-wording-on-prints)                      | Which words should invoice and receipt prints use for the customer and for whoever paid?              | ADR-023 D14; CC-OD-54                                                                             |
| 12  | [DOC01](#doc01-credit-note-numbering)                                             | Should credit notes get their own document number, as invoices do?                                    | Question 26; ADR-023 D10; legal fields with ACC01 (questions 10 to 12)                            |
| 13  | [PERM01](#perm01-giving-new-rights-to-existing-organisations)                     | Should new approval and print rights reach every existing organisation, named ones, or none?          | Questions 8, 9 and 22 (and 27 by the same pattern); CC-OD-50, CC-OD-53, CC-OD-54, CC-OD-58        |
| 14  | [CAT01](#cat01-renaming-and-moving-item-categories)                               | May an organisation rename an item category and move it under another one?                            | Question 23                                                                                       |
| 15  | [CAT01-NAME](#cat01-name-category-names-among-siblings-and-second-language-names) | Must category names be unique under the same parent, and does a category have one name or two?        | Question 23, options (b) and (c)                                                                  |
| 16  | [CAT01-TREE](#cat01-tree-the-rules-a-category-move-follows)                       | What rules govern a category move, and how are refusals and history recorded?                         | Question 23, option (c); ADR-023 D12                                                              |
| 17  | [PLAN01](#plan01-the-plan-chosen-when-an-organisation-is-provisioned)             | What should the plan picked on the "Provision organization" form actually do?                         | CC-OD-24; related CC-OD-49; ADR-024; depends on LIC01                                             |
| 18  | [RPT01](#rpt01-who-may-export-a-report-as-csv-vl-p132-008)                        | Now that CSV report export exists, who should hold the right to use it?                               | VL-P132-008; Owner decision CC-04 of 2026-09-08                                                   |
| 19  | [RPT02](#rpt02-a-separate-permission-for-saving-report-snapshots-vl-p132-010)     | Should saving a report snapshot have its own permission?                                              | VL-P132-010; ADR-023 D16                                                                          |
| 20  | [RPT03](#rpt03-report-configuration-in-organisations-provisioned-earlier)         | Which older organisations should receive the "configure reports" permission?                          | Question 27; VL-P132-010; related to questions 8 and 22                                           |
| 21  | [ODO01](#odo01-who-may-record-odometer-readings-vl-p132-009)                      | Who should be able to record odometer readings, and how do existing organisations receive it?         | VL-P132-009                                                                                       |
| 22  | [AUTH01](#auth01-signing-other-devices-out-after-a-password-change)               | After a password change or revocation, must other devices lose access at once?                        | CC-OD-31 (its behaviour half); the W9-R1 residual in CC-OD-29                                     |

## FIN01: the same service sold again on a second quotation

**Canonical ids:** VL-P132-003 (docs/product/owner-directive-2026-09-16/capability-status.md:394);
ADR-023 D5/D15 'Open policy point: the same service approved again'
(docs/adr/ADR-023-sales-and-finance-policy-decisions.md:313-393); README FIN01 row
(docs/product/owner-directive-2026-09-16/README.md:566); recorded as open by #523 (merge 290217da),
implemented by #513 (P1-32-PRE-OD-FD5); FRX2 = PR #540 (open on 2026-10-08, wording only)

### In plain words

A work order can have more than one approved quotation. When a later quotation sells a service or
part that an earlier quotation already sold and invoiced, the system today treats it as the same
work already billed and does not bill it again. That is safe, because it can never bill twice, but
genuine extra work of the same service on a second quotation is then never billed. The question is
how the system should tell "the same work again" from "new, additional work".

The planner recommends keeping today's safe default and adding an explicit, approved "additional
work" mark on a quotation line, which lets that one line be billed on its own.

**Who is affected (new, existing and QA organisations).** Options 1 and 2 change no permission for
new, existing or QA organisations. Option 3 needs one new approval permission, named by the Owner,
and the same choice PERM01 asks about for giving it to existing organisations.

### The exact question

When a second, separately approved quotation on the same work order sells a service or part (same
item_kind + service_id/item_ref) that an earlier quotation already invoiced, is that line new
billable work, or the same entitlement already billed? Pick the pool key: (1) work order + lineage,
as today; (2) quotation + lineage; or (3) work order + lineage by default, with an approved
'additional work' marker that gives a line its own pool.

### Examples

- (1) Same entitlement, new revision. Q1 R1 = service S qty 2 approved, plus part P undecided (keeps
  Q1 active). Invoice I1 bills S 2 and is issued. Q1 R2 = S qty 2, P; S approved. TODAY: S line
  approved 2, invoiced 2 (absorbed), remaining 0, fully_invoiced. If P is still undecided, create
  returns 409 ERR-CON-001 invoice_nothing_to_bill. CORRECT, no double bill. UNDER RECOMMENDED RULE:
  identical (R2 S carries R1 S's entitlement).
- (2) Increase. As in (1), but R2 S qty 3 approved. TODAY: remaining 1, billable. I2 bills qty 1 at
  (R2 line net - R1 billed net), with the discount reported as 0. If R2's total for S is below what
  was billed, the line reads repriced_below_invoiced and is not billed. Reachable only while Q1 is
  still active: if Q1 was accepted as a whole, revise returns ERR-TRN-001. UNDER RECOMMENDED RULE:
  same, with approved_quantity on the entitlement raised from 2 to 3 and consumed 2.
- (3) Genuinely additional work, separate quotation. Q1 R1 = S qty 1, accepted, invoiced and issued.
  Q2 = S qty 1 + part P qty 2, all approved. TODAY: Q2's S line reads approved 1.000, invoiced 1.000,
  remaining 0.000, fully_invoiced. I2 bills only P 2.000. Afterwards approvedWorkToInvoice=false,
  the delivery blocker is released, and preview/create return 409 ERR-CON-001 (no rule token). Q2's
  S is never billed. If Q2 S were qty 3, only 2 would bill, as a difference of totals. Pinned by
  tests/backend/od-invoice-approved-quantities.test.ts:846-891 and seen in runtime QA D5-5 (approved 0.250,
  already invoiced 1.000). UNDER OPTION 2 or 3: Q2 S becomes its own entitlement (approved 1,
  consumed 0), so I2 bills S 1 + P 2.
- (3b) Same work quoted twice by mistake. Q2 copies Q1's S qty 1. TODAY: not billed
  (fully_invoiced). UNDER OPTION 2: billed twice unless staff cancel Q2. UNDER OPTION 3: not billed
  unless Q2's S line carries an approved additional-work marker.
- (5) Rejected addition. Q1 R2 adds S2 and the customer rejects it. TODAY: Q1 rolls up to 'rejected'
  and R2 is still a source (is_source accepts 'issued' or 'rejected', :159-160). The approved lines
  bill; S2 reads 'rejected' and is never billed; Q1 can no longer be revised (ERR-TRN-001). If the
  addition is a separate Q2 with every line rejected, Q2 has approvedCount 0, does not compete, and
  Q1 bills normally. UNDER RECOMMENDED RULE: unchanged; a rejected line creates no entitlement and
  no consumption.
- (6) Race. Two POST /api/v1/invoices for one work order, different idempotency keys. TODAY: both
  pass the draft pre-check. The first header insert takes the wo.work_orders row lock and the second
  waits. After the first commits, the second hits uq_invoices_work_order_draft (23505), which
  returns 409 ERR-CON-001 rule invoice_draft_open (invoice-service.ts:700-708). If the first was
  already issued, the second reads remaining 0 and gets invoice_nothing_to_bill. A competing line
  write after the lock gets invoice_quantity_exceeds_approved or invoice_line_not_billable. With the
  same key, the response is replayed:true, or ERR-INT-001 if the requests overlap in flight. Pinned
  by tests/db/sal-invoiced-quotation-quantities.test.ts:861-892, 891-945. UNDER RECOMMENDED RULE:
  same lock, with consumption checked per entitlement under it.

### Options

- 1\. Keep pooling by work order (ADR-023:363-380). No code change. Legitimate extra work of an
  already-invoiced service on a second quotation stays unbilled, except a quantity above what was
  invoiced, billed as a difference of totals. The revision route (case 2) exists only while the
  first quotation is still active.
- 2\. Pool per quotation + lineage (ADR-023:381-386). A forward migration changes the pool key of
  sal.billable_quotation_lines, which the guards also use. Case 3 bills in full; case 3b bills twice
  unless the duplicate quotation is cancelled. The test at
  tests/backend/od-invoice-approved-quantities.test.ts:846 is reversed. Needs the FIN01-b decision
  as well.
- 3\. Work-order pooling by default, plus an explicit approved 'additional work' marker per
  quotation line that pools the line on its own (ADR-023:387-393). Needs a forward migration (the
  marker, who approved it and when), a permission code and an audit action the Owner names, an
  English/Arabic UI, and DB and backend cases. Lines written before the release carry no marker and
  keep pooling. A possible existing anchor (not decided): wo.additional_work_requests with states
  pending/approved/rejected/withdrawn, and wo.customer_approvals.quotation_revision_ref (no FK),
  with permissions wo.additional_work.request and wo.additional_work.approve
  (supabase/seeds/04_iam_permission_catalog.sql:300-301).

### The planner's recommendation (not a decision)

RECOMMENDATION ONLY, NOT A DECISION: option 3, implemented as a stable entitlement identity rather
than lineage inference. Proposal, none of which exists today: each quotation line names an
entitlement; an entitlement has work_order_id, item_kind, service_id/item_ref, approved_quantity
(the approved quantity of its line on the current source revision), and billed consumption =
SUM(sal.invoice_lines.quantity) of live, non-void invoices whose source line maps to it. A new
revision line carries its predecessor's entitlement, explicitly or by the same unique-lineage rule
used today, which covers cases 1 and 2. A line on another quotation of the same work order with the
same lineage maps to the existing entitlement unless it carries an approved additional-work marker,
which gives it a new entitlement. That covers 3 versus 3b. The model can support this:
sal.invoice_lines.source_quotation_item_id already names every billed source line,
quo.quotation_items carries item_kind/service_id/item_ref, and an unused nullable link column exists
(quo.quotation_items.source_service_line_ref; wo.work_order_service_lines is a per-work-order
planned-service row). Keep the work-order row lock and the guards, judging per entitlement. Do not
treat per-quotation counting alone as protection against duplicate billing.

### Until the Owner answers

Keep the conservative pooling by work order in force (it can never bill more). Keep VL-P132-003 in
'Blocked by missing access or an unanswered business decision'. FRX2 (PR #540) only explains the
refusal and must not be presented as resolving pooling. Workaround for genuinely extra work: revise
the first quotation while it is still active, or a quantity above what was invoiced on a second
quotation (billed as a difference of totals). Once the first quotation is accepted, rejected,
expired or cancelled, nothing bills extra work of an already-invoiced service.

### Detail for the development team

#### What happens today, with evidence

sal.billable_quotation_lines
(supabase/migrations/20261006090000_sal_invoiced_quotation_quantities.sql:139-259) pools billed
quantity by WORK ORDER + lineage = (item_kind, COALESCE(service_id, item_ref, item id)) (:169, :187,
:210-218). For each line: remaining = captured_quantity - billed on this line - 'carried' (billed on
any other line of the same lineage under any revision of any quotation of the work order). Status
order: not_current \> not_approved \> rejected \> lineage_ambiguous \> fully_invoiced \>
repriced_below_invoiced \> billable (:226-236). void_before_issue invoices release their quantity;
issued and credited invoices keep it (:193). POST /api/v1/invoices (sal.invoice-create; permissions
sal.invoice.manage + sal.finance.view; body has only workOrderId, payerPartnerId and idempotencyKey,
with no lines or quantities: apps/api/src/app/api/v1/invoices/route.ts:140,153,159) bills every
'billable' line at its remaining quantity and amount (billing-read-service.ts:960-988). Nothing
remaining returns 409 ERR-CON-001 with rule invoice_nothing_to_bill (invoice-service.ts:948-956).
Source choice (resolveCommercialSource, billing-read-service.ts:878-924): only quotations with
billableCount\>0 compete; if none has any, every quotation with an approved line competes, and 2 or
more gives 409 ERR-CON-001 with NO rule token. Database guards re-judge every line after taking the
wo.work_orders row lock FOR NO KEY UPDATE (:283-286, :365-378) and raise the tokens
invoice_line_not_billable, invoice_quantity_exceeds_approved and invoice_amount_exceeds_approved,
mapped to 409 ERR-CON-001 with that rule (invoice-service.ts:729-740). Revising a quotation
(quo.quotation.manage) types the lines afresh with no pointer to the predecessor line. Revision is
allowed only while the quotation is draft or active (quotation-service.ts:1233-1238).
rollUpDecisions moves the quotation to 'accepted' once all lines are approved and to 'rejected' once
any line is rejected (domain/quotation.ts:160-169).

#### Data transition

Proposed mapping, needing Owner confirmation on point (c). (a) Within one quotation: lines across
its revisions sharing (item_kind, service_id|item_ref), with exactly one such line per revision, map
to one entitlement. This is exactly today's lineage, so no billable amount changes. (b) Revisions
holding more than one line of the same lineage (today's lineage_ambiguous cases) go unmapped and are
listed for manual mapping, never guessed. (c) A second quotation's line that is absorbed today
(fully_invoiced via another quotation's invoice) either maps to the first quotation's entitlement
(frozen, still unbilled) or opens as additional work. Default if undecided: map to the first
entitlement, so no historical line becomes newly billable. (d) Invoices with quotation_revision_id
NULL (uq_invoices_work_order_unsourced) are not followed today and stay outside the mapping. (e)
Credited invoices keep their consumption, as today. Row counts for (b)-(d) need a database query
(not executed).

#### Permission transition

Today: create needs sal.invoice.manage + sal.finance.view; preview is sal.invoice-preview
(apps/api/src/app/api/v1/work-orders/[workOrderId]/invoice-preview/route.ts:69); revise needs
quo.quotation.manage; line decisions are recorded per revision. Option 1 needs no change. Option 2
needs no new permission. Option 3 needs one Owner-named permission code plus a catalogued audit
action for approving the marker. Whether the existing wo.additional_work.approve covers it is an
Owner choice; it is not assumed here. Amounts stay behind sal.finance.view; quantities and statuses
stay visible without it.

#### Affected code

supabase/migrations/20261006090000_sal_invoiced_quotation_quantities.sql:139-259 (pool key),
:335-403, :408-457 (guards), :122-129 (indexes);
apps/api/src/modules/billing/application/billing-read-service.ts:878-924, :960-988;
apps/api/src/modules/billing/application/invoice-service.ts:690-740, :909-957;
apps/api/src/modules/billing/domain/billing.ts:522-566 (status and refusal vocabularies);
apps/api/src/modules/billing/data/billing-repository.ts:698-800;
apps/api/src/modules/quotation/application/quotation-service.ts:558, :679, :1233;
apps/api/src/app/api/v1/quotations/[quotationId]/revisions/route.ts:81, :160;
apps/web/src/features/billing/billing-contract.ts and i18n en/ar (statuses); new forward migration
(immutable migrations).

#### Acceptance cases

- A1: R1 S2 approved and invoiced; R2 S2 approved → preview S fully_invoiced, invoiced 2, remaining
  0; create 409 invoice_nothing_to_bill; live invoice count unchanged.
- A2: R1 S2 invoiced; R2 S3 approved → I2 bills exactly 1 at R2 total minus billed net; R2 S1.5
  cheaper below billed → repriced_below_invoiced, not billed.
- A3 (option 2/3): Q1 S1 invoiced; Q2 S1 approved with marker approved by holder of the named
  permission → I2 bills S1; audit row written; without marker → fully_invoiced, not billed.
- A3b: Q2 copies Q1's S without marker → never billable; marker requested by a user lacking the
  permission → 403 and no change.
- A4: decrease case per FIN01-c.
- A5: rejected line never billable; whole-rejected Q2 does not compete; rejected roll-up revision
  still bills its approved lines.
- A6: two concurrent creates → exactly one draft; loser 409 invoice_draft_open; concurrent line
  writes for the same remaining quantity → exactly one commits, other 409
  invoice_quantity_exceeds_approved/invoice_line_not_billable; same idempotency key → replayed:true.
- A7: migration mapping report lists every unmapped (ambiguous) line; no historical invoice's
  consumption changes; preview of every existing work order before/after differs only where the
  Owner's (c) choice says.
- A8: both locales show available-to-bill quantity and the refusal reason (FRX2 covers wording
  only).

#### Evidence and gaps

ADR-023:235-311 (implementation and open points), :313-393 (open point, three options),
tests/unit/od-invoice-approved-quantities.test.ts:523-534 pins option-1 text;
tests/backend/od-invoice-approved-quantities.test.ts:767-892 (two quotations),
tests/db/sal-invoiced-quotation-quantities.test.ts:587-700 (later revision, increase, repriced,
lineage_ambiguous), :702-727 (void releases, credit keeps), :861-945 (races);
capability-status.md:394 (VL-P132-003 row, #523, CP-20261008-2 observation O2: 409 with generic
title, no on-screen explanation), :502; DBCR
docs/database/change-requests/DBCR-P1-32-PRE-OD-FD5-001-sal-invoiced-quotation-quantities.md:145
(section 4). No later migration redefines sal.billable_quotation_lines (grep of
supabase/migrations). Not executed: no test or DB query was run for this pack.

## FIN01-b: two quotations with approved work on one work order

**Canonical ids:** ADR-023 D5/D15 open point 'Several quotations on one work order (Owner decision
needed)' (docs/adr/ADR-023-sales-and-finance-policy-decisions.md:295-302); coupled to VL-P132-003

### In plain words

When two quotations on the same work order both have approved work that is not yet invoiced, the
system today refuses to create an invoice until one quotation is cancelled, and the refusal carries
no reason the screen can explain.

The planner recommends letting the user choose which quotation to invoice if FIN01 adopts option 2
or 3; otherwise keeping the refusal but giving it a named reason that the screen can explain.

**Who is affected (new, existing and QA organisations).** No change for new, existing or QA
organisations under any option.

### The exact question

When two or more quotations on one work order both hold approved work, which one(s) does an invoice
bill? And may a further invoice bill another quotation's approved work after the first quotation is
fully invoiced?

### Examples

- Q1 S1 accepted as a whole and not invoiced; Q2 P2 + P1, with only the first line approved. TODAY:
  preview 409 ERR-CON-001, create 409, 0 live invoices, delivery blocked
  (tests/backend/od-invoice-approved-quantities.test.ts:775-801).
- Q1 S1 invoiced and issued; Q2 P2 approved, P1 undecided. TODAY: Q2 is the sole source and I2 bills
  P 2.000; 2 live invoices (:803-835).

### Options

- 1\. Keep today's behaviour: refuse until a quotation is cancelled, and bill sequentially once one
  is exhausted.
- 2\. Bill all quotations with approved remaining work on one invoice (multi-source invoice).
  sal.invoices.quotation_revision_id is a single, frozen column, so this needs a schema change.
- 3\. The user chooses which quotation to invoice. This needs a quotationId in the create body,
  which the body does not have today.

### The planner's recommendation (not a decision)

RECOMMENDATION ONLY: option 3 if FIN01 picks option 2 or 3; otherwise option 1, with a rule token
(for example invoice_source_ambiguous) added so the refusal can be explained. That token does not
exist today and its name is a proposal.

### Until the Owner answers

Keep the refusal. Staff cancel the superfluous quotation or override the delivery blocker. FRX2
explains it in the UI.

### Detail for the development team

#### What happens today, with evidence

resolveCommercialSource (apps/api/src/modules/billing/application/billing-read-service.ts:878-903)
filters to quotations with billableCount\>0. With 2 or more of them, preview and create both return
409 ERR-CON-001 ('has N quotations with approved lines … ambiguous'), with no violations[] rule. The
delivery blocker stays on (approvedWorkToInvoice true, receivable null) until a quotation is
cancelled or the blocker is overridden. Once one quotation has nothing left, the other is billed on
a further invoice (one draft at a time). If none has anything left but 2 or more have approved
lines, the answer is again 409 with no rule, which is what CP-20261008-2 O2 hit.

#### Data transition

Options 1 and 3 need none: historical invoices each name one revision. Option 2 needs a new
invoice-to-revision link table and a rule for which revision existing rows map to (each maps to its
own quotation_revision_id).

#### Permission transition

None for options 1 and 3: create stays sal.invoice.manage + sal.finance.view. Option 2 needs none,
but changes the audit payload.

#### Affected code

apps/api/src/modules/billing/application/billing-read-service.ts:878-924;
apps/api/src/app/api/v1/invoices/route.ts:140;
apps/api/src/modules/billing/data/billing-repository.ts:698-753; supabase migration 20261006090000
:268-330 (single frozen revision per invoice).

#### Acceptance cases

- Two quotations both with remaining approved work: the agreed answer (refusal with a rule token, or
  the chosen quotation is billed); the delivery blocker behaves as decided.
- After Q1 is exhausted, Q2's remaining approved work bills on I2; one draft per work order still
  holds.
- Two quotations with nothing left: a 409 carrying a rule token explained in English and Arabic.

#### Evidence and gaps

ADR-023:295-302; billing-read-service.ts:856-873 docblock;
tests/backend/od-invoice-approved-quantities.test.ts:767-835; capability-status.md:394 (O2).

## FIN01-c: a quantity or price lowered after it was invoiced

**Canonical ids:** ADR-023 D5/D15 open points 'Credit notes do not release quantity' and 'A
re-priced line' (docs/adr/ADR-023-sales-and-finance-policy-decisions.md:284-292)

### In plain words

If a later approved revision lowers a quantity or price below what was already invoiced, or rejects
a line that was invoiced, nothing happens today: the extra amount billed stays, and nobody is
prompted. An approved credit note never makes the quantity billable again.

The planner recommends showing such over-billed lines clearly and requiring a credit note before
delivery or closing. A credit note would still not free the quantity to be billed again.

**Who is affected (new, existing and QA organisations).** No change for new, existing or QA
organisations; credit notes keep their existing approval flow.

### The exact question

When a later approved revision lowers a quantity or price below what is already invoiced, or a
previously invoiced line is rejected on the new revision, what happens to the excess already billed?
Must a credit note be raised, and does an approved credit note make the credited quantity billable
again?

### Examples

- Q1 R1: S qty 4 approved, P undecided; I1 bills S 4 and is issued. R2: S qty 3 approved. TODAY: S
  reads approved 3, invoiced 4, remaining 0, fully_invoiced; 1 unit stays over-billed and no credit
  is created or flagged.
- Same, with R2 S qty 5 at a lower unit price so the R2 total is below I1's net. TODAY:
  repriced_below_invoiced, not billed.
- Same, but R2 rejects S. TODAY: S reads rejected, invoiced 0 shown; I1's 4 units stand; Q1 rolls up
  to rejected and can no longer be revised.

### Options

- 1\. Keep today's behaviour: no automatic action, and staff raise a credit note manually through
  the existing credit-note flow. Credits never release quantity.
- 2\. Flag over-billed entitlements (approved less than consumed) on the work order and in the
  invoice preview, and require a credit note before delivery or close. A credit releases nothing.
- 3\. As 2, but an approved credit note releases the credited quantity back to the entitlement, so
  it can be billed again.

### The planner's recommendation (not a decision)

RECOMMENDATION ONLY: option 2. It fits the entitlement model in FIN01 (consumption greater than
approved is computable) and never bills more. Option 3 reverses the current 'credit keeps quantity'
rule and needs explicit Owner approval.

### Until the Owner answers

Keep the current rule (never bill more; credits keep quantity). Record over-billed cases as a known
limitation.

### Detail for the development team

#### What happens today, with evidence

A decrease is judged by sal.billable_quotation_lines (:231): qty - billed \<= 0 gives
fully_invoiced. The line then reports invoiced greater than approved, and nothing prompts or forces
a credit. A raised quantity whose new total is below the billed amount gives
repriced_below_invoiced, which is not billed and creates no credit (:232-234). A line rejected on
the new revision reads 'rejected' with invoiced quantity shown as 0, because 'absorbs' requires
approval (:237, :247), so the earlier bill is no longer visible on that revision's view. Credited
invoices keep their consumption; only void_before_issue releases it (:193). An invoice always bills
everything remaining, so the user cannot choose a smaller quantity; 'partial invoicing' only arises
from lines approved at different times.

#### Data transition

None for options 1 and 2: over-billed positions are derived from existing invoice lines and the
current revision. Option 3 needs credit-note lines linked to their invoice lines, and a rule for
historical credits (default: they keep consumption).

#### Permission transition

None new for options 1 and 2. Credit notes keep their existing approval flow (not re-examined here).

#### Affected code

supabase/migrations/20261006090000_sal_invoiced_quotation_quantities.sql:185-258;
apps/api/src/modules/billing/domain/billing.ts:505-530; the billing-read-service preview; the
delivery financial blocker (apps/api/src/modules/delivery/application/delivery-service.ts, not read
for this pack).

#### Acceptance cases

- Decrease 4 to 3 after 4 invoiced: the line shows invoiced 4 against approved 3 and an over-billed
  indicator; nothing further is billable; delivery behaves as decided.
- Reprice below billed: repriced_below_invoiced is shown with an explanation in English and Arabic.
- A credit note for 1 unit is approved: consumption stays 4 (options 1 and 2) or drops to 3 (option 3);
  a new invoice never bills more than the approved quantity minus consumption.

#### Evidence and gaps

ADR-023:284-294; tests/db/sal-invoiced-quotation-quantities.test.ts:665-680 (repriced), :702-727
(void releases, credit keeps). No backend or DB test covers a pure quantity decrease below what was
invoiced (searched test names in tests/db/sal-invoiced-quotation-quantities.test.ts; not exhaustive
across tests/backend).

## FIN02 part 1: who may approve a discount (VL-P132-001)

**Canonical ids:** VL-P132-001; ADR-023 D8 open point 'Who may approve'
(docs/adr/ADR-023-sales-and-finance-policy-decisions.md:539-569); DBCR-P1-32-PRE-OD-FD8-001 section
12 matrix rows :381-383; capability-status.md:505; route-checklist.md:4398; README.md:567 (FIN02)

### In plain words

A rule already says that a person who asks for a discount approval cannot make their own request
easier to approve by changing their own threshold, role limit or price list. There are three other
ways a requester could influence who approves: giving the approver the approval permission through a
role grant, changing a role's permissions so that the approver gains it, or unlocking the approver's
locked account. Today all three still count. The question is asked separately for each of the three.

The planner recommends leaving all three as they are, because the rule's words do not name them and
a second person still has to decide. If the Owner wants to close one, the role-grant route is the
cheapest, because the records it needs already exist.

**Who is affected (new, existing and QA organisations).** No permission is added, renamed or revoked
under any option, for new, existing or QA organisations. Only the effect of a requester's own act on
their own requests changes.

### The exact question

D8 (ADR-023:434-435) says: 'Changing one's own threshold, role limit or price list never exempts
one's own quotation from approval. Provenance and snapshots are kept. There is no sole-administrator
exception.' Does that rule also cover who may approve? There are three cases. (1) The requester
issues a role grant or adds a grant scope that gives the approver the approval permission. (2) The
requester adds a role-permission mapping that allows that permission, changes a mapping to allow it,
or removes a denial of it. (3) The requester reactivates the approver's locked account. For each of
these three routes separately, please choose: leave it as it is, or stop the requester's act from
counting for the requester's own request.

### Examples

- Path 13, a grant bringing the approval permission (POST /iam/grants, permission iam.grant.manage;
  or POST /iam/grants/{grantId}/scopes). Requester R holds quo.quotation.manage, iam.grant.manage
  and svc.price.manage. R raises a discount on R's own quotation, and the request records
  required_permission_code = svc.price.manage. Approver A has an approval limit that an
  administrator set, but no role carrying svc.price.manage, so A's decision is refused today with
  discount_approval_permission_missing. R issues A a grant for a role that maps svc.price.manage
  (allowed: R holds it, and A is not R). A then approves R's request. The grant gives A no role
  LIMIT for R's request (row 5 is closed), but it does give A the permission (row 13 is open), so
  the approval goes through on the limit the administrator set.
- Path 14, a role-permission mapping (POST/PATCH/DELETE
  /iam/roles/{roleId}/permissions[/{mappingId}], permission iam.role.manage). A holds custom role X,
  which has no svc.price.manage mapping, or which maps it as 'deny'. R adds 'allow svc.price.manage'
  to X (assertDelegable requires R to hold svc.price.manage), or changes the deny to allow, or
  deletes the deny mapping (no delegation check, and the deleted row leaves no record of who removed
  it). A then approves R's discount on a limit somebody else set. System roles cannot be changed
  this way.
- Path 15, account reactivation (POST /iam/users/{userId}/status, permissions iam.user.manage +
  iam.session.view_all). A's account is locked, and a locked account holds no permission. R unlocks
  A, and the action is audited as iam.user.unlocked. A then approves R's pending request on A's
  existing limits. The account row records only updated_by, and its status history exists only in
  the audit trail.

### Options

- Option A — Leave all three as they are. D8's words name a threshold, a role limit and a price
  list, and do not name the approval permission or account status. Record the ruling in ADR-023, and
  VL-P132-001 closes with no code change. A different person still has to decide, and the requester
  can never decide their own request (ck_discount_approvals_separation).
- Option B — Restrict, with a rule set per route. Route 1: the approval permission counts for
  request Q only through a grant that Q's requester did not grant, issue or change
  (role_grants.issued_by / granted_by / grant_changed_by), and, when the grant is scoped, only
  through a scope the requester did not add (grant_scopes.added_by). This uses columns that already
  exist, so no new provenance is needed, and it applies to new and existing grants alike. Route 2: a
  mapping counts only if the requester did not add it or change it to allow. This needs from-session
  added_by/changed_by columns on iam.role_permissions, plus a mapping history, because a removed
  deny leaves no row. Route 3: an approver whose account the requester last reactivated cannot
  approve that requester's requests. This needs an append-only status-change record. Each route can
  be chosen or rejected independently (ADR-023:569).
- Option C — Restrict as in B, plus a transition for existing data. Existing grants already carry
  issued_by (copied from created_by) and grant_changed_by (copied from updated_by) since 20261007140000.
  Existing role_permissions rows and existing account status changes have no from-session author.
  The Owner chooses one of two treatments for them: (i) treat them as made by nobody, so they count,
  which is the more permissive choice; or (ii) seed them from created_by/updated_by or from the
  audit trail (iam.role.permission_added/_changed, iam.user.unlocked) as the 'closest evidence, not
  verified attribution', which is the approach already used for the grant columns (DBCR :335-338).

### The planner's recommendation (not a decision)

This is a recommendation, not a decision. Because D8's text names only a threshold, a role limit and
a price list, the reading consistent with it is Option A: leave the three paths as they are and
record the ruling. Under that reading the separation of duties still holds, since a second person
decides and R cannot decide R's own request. If the Owner nevertheless wants to close the 'R
recruits A' route, the cheapest stricter option is Option B for route 1 only, because the provenance
columns it needs already exist. Routes 2 and 3 each need new schema (mapping authorship and history,
and an account status history) and a transition choice (Option C).

### Until the Owner answers

Until the Owner rules, the three paths stay unrestricted (Option A behaviour), as recorded in the
DBCR matrix rows :381-383 and ADR-023:539-569. They are listed as 'Owner decision needed, not
decided' and are not reported as closed.

### Detail for the development team

#### What happens today, with evidence

The DBCR section 12 bounded path matrix (DBCR :368-384) has 15 rows. 12 are CLOSED, each with its
migration and a named regression test: (1) threshold version recorded by the requester
(20261007090000); (2) a limit created by the requester or the approver (20261007090000); (3) a
limit's dates ended, reopened or extended (20261007100000 + 20261007110000, window_changed_by); (4)
a role limit's value (20261007090000); (5) a role grant bringing a role's LIMIT, if issued or
changed by the requester or the approver (20261007140000, issued_by and grant_changed_by); (6) a
company scope added by the requester or the approver (20261007140000, added_by); (7) a price rule's
amount (…090000/…100000/…120000); (8) an item selling price's amount (same three); (9) an item
selling price withdrawn or restored (20261007140000, availability_changed_by); (10) a price-list
version published (20261007090000, published_by); (11) a price-list assignment (20261007130000);
(12) a threshold version dated so that it is not in force today (20261007150000). 3 are UNRESOLVED
POLICY (rows :381-383). The matrix lists no row as unreachable, and ADR-023:494 says 'None is left
as a residual'. How the 3 open paths behave today: the decision route quo.discount-approval-decide
(POST /discount-approvals/{approvalId}/decision) is gated only by quo.quotation.read. The service
and the DB guard then check the permission the request recorded,
quo.discount_approvals.required_permission_code, which defaults to 'svc.price.manage' when the
policy names none (20260925090000:468,533). The DB guard checks it through
iam.has_permission_in_scope (20261007140000:425). That function counts every active grant, scope and
mapping of an active account, no matter who made them. The approver also needs a discount limit that
still counts under rows 2-6. Limits on the IAM routes today: a self-grant, self-scope or self status
change is refused (assertNotSelf, ERR-IAM-001). Granting a role, and adding or changing a mapping to
'allow', require the actor to hold the permission themselves (assertDelegable). Removing a mapping
has no delegation check. Mappings on system roles are refused (assertNotSystemRole). Provenance
stored today: role_grants.issued_by/grant_changed_by and grant_scopes.added_by exist (since 20261007140000)
but are not read for the permission check. role_permissions keeps no from-session author, and a
deleted mapping leaves no row. The user account row keeps only updated_by. Audit entries
iam.role.permission_added/_changed/_removed and iam.user.unlocked are written, but no guard reads
them.

#### Data transition

Option A: none. Option B, route 1: no schema change. It reads
iam.role_grants.issued_by/granted_by/grant_changed_by and iam.grant_scopes.added_by, which already
exist and were backfilled from created_by/updated_by in 20261007140000. That backfill is attribution
taken from the last writer, not verified attribution. Route 2: new forward migration adding
from-session authorship to iam.role_permissions and an append-only mapping history; existing
mappings need a backfill choice (Option C i/ii). Route 3: new append-only account status history;
existing accounts have only updated_by, so a backfill choice is needed (Option C). None of the
options rewrites existing approvals or quotations.

#### Permission transition

No permission code is added or renamed under any option. The approval permission stays the recorded
required_permission_code (default svc.price.manage), and the decision gate stays quo.quotation.read.
Under B or C, holders of iam.grant.manage, iam.role.manage and iam.user.manage keep those rights.
Only the effect of their act on their OWN pending or future discount requests changes, and another
person's requests are unaffected. Existing role grants and mappings are not revoked.

#### Affected code

supabase/migrations/20261007140000_quo_discount_role_grant_provenance.sql:425
(quo.guard_discount_approval permission check via iam.has_permission_in_scope);
supabase/migrations/20260925090000_quo_discount_approvals.sql:468,533 (required_permission_code,
default svc.price.manage);
apps/api/src/app/api/v1/discount-approvals/[approvalId]/decision/route.ts:50-70 (gate
quo.quotation.read); apps/api/src/modules/quotation/application/discount-approval-service.ts:276,334
(discount_approval_permission_missing);
apps/api/src/modules/iam/application/access-administration-service.ts:244-364 (mapping
add/change/remove; remove has no delegation check), :379-415 (issueGrant + assertDelegable), :545
(addScope); apps/api/src/modules/iam/application/user-administration-service.ts:200-271
(changeStatus, iam.user.unlocked audit);
apps/api/src/modules/iam/domain/delegation-policy.ts:110,167 (assertNotSelf, assertDelegable); IAM
routes apps/api/src/app/api/v1/iam/grants/route.ts:54-56,
iam/grants/[grantId]/scopes/route.ts:46-48, iam/roles/[roleId]/permissions/route.ts:49-51,
iam/roles/[roleId]/permissions/[mappingId]/route.ts:31-48, iam/users/[userId]/status/route.ts:50-52.

#### Acceptance cases

- Under any option, the existing 12 closed-row regression cases in
  tests/db/quo-discount-self-exemption.test.ts and tests/backend/od-discount-self-exemption.test.ts
  stay green.
- A (leave): R issues A a grant for a role mapping svc.price.manage. A, holding an administrator-set
  limit that covers the discount, approves R's request (200, quo.discount_approval.approved).
  Without the grant, A is refused with discount_approval_permission_missing.
- B route 1: same set-up. A's decision on R's request is refused with
  discount_approval_permission_missing at the service and at quo.guard_discount_approval. The same
  grant issued by administrator C lets A approve. A's decision on another person P's request
  succeeds with R's grant.
- B route 1 (scope): R adds the company scope to C's grant to A. A is refused for R's request and
  allowed for P's request.
- B route 2: R adds 'allow svc.price.manage' to custom role X held by A, or changes deny to allow,
  or deletes the deny. A is refused for R's request and allowed for P's. The same mapping made by C
  lets A approve R's request.
- B route 3: R unlocks A (POST /iam/users/{A}/status). A is refused for R's pending request and
  allowed for P's. If C unlocks A, A may approve R's request.
- Any option: R can never decide R's own request (discount_approver_must_differ /
  ck_discount_approvals_separation), and no sole-administrator exception exists.

#### Evidence and gaps

ADR-023 D8 text is at docs/adr/ADR-023-sales-and-finance-policy-decisions.md:432-435. The cited
':236-239' is the D5/D15 section, not D8. Bounded matrix count '12 closed, 3 outside' is at
ADR-023:483-494. The 15-row matrix is at
docs/database/change-requests/DBCR-P1-32-PRE-OD-FD8-001-quo-discount-self-exemption-and-withdrawal.md:358-384,
with the round-5 summary at :323-333 and the open points at :424-430. VL ledger entry:
docs/product/owner-directive-2026-09-16/capability-status.md:505. Route checklist:
docs/product/owner-directive-2026-09-16/route-checklist.md:4398. Tests:
tests/backend/od-discount-self-exemption.test.ts (case 'an approver given a role by the requester
cannot approve…'); tests/db/quo-discount-self-exemption.test.ts is cited by the DBCR but was not
opened here. No test exercises the 3 unresolved paths, verified only by the absence of a matrix
citation. Not verified: whether iam.role_permissions has created_by/updated_by columns (schema not
read).

## FIN02 part 2: an approver's own changes (VL-P132-002)

**Canonical ids:** VL-P132-002; ADR-023 D8 open point at
docs/adr/ADR-023-sales-and-finance-policy-decisions.md:571-585; DBCR section 13 :427-430;
route-checklist.md:4399

### In plain words

Today, if an approver moves the dates of their own approval limit, or changes their own role grant,
the system stops counting all of that approver's limits in that company, for everyone's requests and
permanently. Even a fresh limit set by another administrator does not restore it. That is stricter
than the written rule, which speaks of "one's own quotation".

The planner recommends narrowing the rule to the approver's own quotations (option B), or also
refusing the change at the moment it is made (option C). Keeping today's stricter reading (option A)
should be an explicit Owner choice.

**Who is affected (new, existing and QA organisations).** No permission code changes for new,
existing or QA organisations. Under option C, people who manage approval limits can no longer end or
move their own limit.

### The exact question

D8 speaks of 'one's own quotation'. Today two rules go further. If approver A moved the dates of one
of A's own discount limits in a company, or issued or changed A's own role grant or added a scope to
it, then NONE of A's limits counts there for ANYBODY's request, and a fresh limit set by another
administrator does not restore it. Should this stricter reading stay, should it be narrowed to A's
own quotations, or should the act be refused up front at the route instead?

### Examples

- Approver A holds a person limit of 500 that administrator C created. A ends that limit early
  through the limit-ending route (endApprovalLimit), which does not refuse A's own window change.
  From then on, none of A's limits in that company counts for any request: A is refused with
  discount_no_approval_limit even on colleague P's quotation, including after C creates a fresh
  limit for A. (Matrix row 3 db case: 'refuses an approver who reopened their own expired limit, for
  anybody's request'.)

### Options

- Option A — Keep the stricter reading: A's own change excludes A's limits for every request,
  permanently.
- Option B — Narrow it to D8's words: A's own change excludes A's limits only for A's own
  quotations, and other people's requests follow A's limits as they stand.
- Option C — Keep B's counting, and also refuse the act at the route: A may not end or move the
  dates of A's own limit (consistent with assertApprovalLimitNotForSelf), and a fresh limit or grant
  set by another administrator counts again.

### The planner's recommendation (not a decision)

This is a recommendation, not a decision. The reading closest to D8's exact text ('one's own
quotation') is Option B, or Option C if the Owner also wants the act stopped at the source. Option A
is stricter than the text and should be adopted only if the Owner chooses it explicitly.

### Until the Owner answers

The stricter reading (Option A) stands until the Owner rules (ADR-023:583-585). It is recorded as
'not implemented as a ruling'.

### Detail for the development team

#### What happens today, with evidence

The stricter reading is in force (fix rounds 2 and 5; migrations 20261007100000/20261007110000
window_changed_by and 20261007140000 grant_changed_by/added_by). The route already refuses a
self-grant, a self-scope and a self-set approval limit (assertNotSelf,
assertApprovalLimitNotForSelf, assertApprovalLimitNotForHeldRole in
apps/api/src/modules/iam/domain/delegation-policy.ts:110-157). It does not refuse an approver ending
their own limit's window up front (endApprovalLimit, access-administration-service.ts:762). So the
stricter rule is only reached by a change made around those refusals.

#### Data transition

Option A: none. Options B and C: no new columns, because window_changed_by, grant_changed_by and
added_by already exist. The guard function and callerApprovalCeiling change through a forward
migration and an application change. Existing histories are read as they are (the backfill from
updated_by is not verified attribution).

#### Permission transition

No permission code changes. iam.approval.manage holders lose only the ability to end or move their
OWN limit window under Option C.

#### Affected code

quo.guard_discount_approval (latest body in
supabase/migrations/20261007140000_quo_discount_role_grant_provenance.sql); callerApprovalCeiling in
apps/api/src/modules/quotation (location not opened);
apps/api/src/modules/iam/application/access-administration-service.ts:762 (endApprovalLimit);
apps/api/src/modules/iam/domain/delegation-policy.ts:127-157.

#### Acceptance cases

- A (keep): A reopens A's own expired limit; A is refused for P's request and for R's request; a
  fresh limit by C does not restore it.
- B: same set-up; A is refused only for A's own quotation and approves P's request within the limit.
- C: POST to end or move A's own limit window is refused with ERR-IAM-001; the same act by C
  succeeds, and A's limits count for others' requests.

#### Evidence and gaps

ADR-023:571-585; DBCR :427-430; route-checklist.md:4399; DBCR matrix rows 3 and 5 (:372, :374) cite
the regression cases.

## FIN03: cancelling an approved refund that is not yet paid out

**Canonical ids:** FIN03 = README Q24 (docs/product/owner-directive-2026-09-16/README.md:473-490,
cross-ref :568); capability-status.md:652; nearest existing: ADR-023 D2 part 2 open point (e)
(docs/adr/ADR-023-sales-and-finance-policy-decisions.md:206). Note: open point (e) is about
cancelling an OBLIGATION, not a request; request cancellation is not yet listed as an ADR-023 open
point.

### In plain words

A refund request goes from requested, to approved, to paid out. Only one request per refund
obligation can be open at a time, and once a request is approved nothing can undo it except
recording its payout. So if an approved refund will never be paid (the wrong payment method was
chosen, or it was approved by mistake), the rest of the customer's refund is stuck: no new request
can be made.

The planner recommends that a person holding the refund approval permission, other than the
requester, may cancel an approved request that has not been paid out, giving a reason; a new request
can then be made. Payouts already recorded stay. The research also found that question 24 should say
"not yet paid out" rather than "not fully paid out", because a request is always paid out once, in
full.

**Who is affected (new, existing and QA organisations).** No new permission. Cancelling would use
the refund approval permission (`sal.refund.approve`): new organisations receive it with the
administrator role; existing organisations only as question 22 and PERM01 decide; the two named QA
organisations already hold it through the recorded backfill (CC-OD-58).

### The exact question

May an approved refund request whose payout has not been recorded be cancelled, so that its
obligation can take a new request? If so, who may cancel it, and on what conditions?

### Examples

- Reproducible restatement of 'approved 10, paid 4, rest abandoned'. Today a single request cannot
  be paid 4 of 10 (refund_executed always carries the request amount, migration :886/:674). The
  nearest reproducible case: obligation 30.00. Request A 10.00 is approved and paid out (obligation
  open, paidOut 10.00, stillOwed 20.00). Request B 20.00 is approved and then abandoned. Every new
  request on the obligation is refused with refund_request_live_exists, and the obligation stays
  open with stillOwed 20.00 indefinitely.
- Approved, wrong method: request approved with method M1 (e.g. cash). The customer must be paid by
  bank transfer M2. A payout with M2 is refused with refund_payout_method_mismatch (migration
  :877-878; service :692-699). The method cannot be changed, because the facts are frozen
  (refund_request_frozen :362). A request with M2 is refused with refund_request_live_exists. Today
  the only way forward is recording a payout by M1, which did not happen.
- Approver leaves: the approval stays valid. The payout guard checks only the recorder's
  sal.payment.record (:405) and never re-checks the approver. Revoking the approver's
  sal.refund.approve or disabling their user does not affect the approved request. Nobody can undo
  the approval, and it still blocks new requests until someone records a payout.
- Observed side fact (verified at :397-433): the payout guard does not re-check that the method is
  still active. A method deactivated after approval can still be recorded as the payout method.

### Options

- (a) No cancellation (today). An approved, unpaid request is resolved only by recording its payout.
- (b) A holder of sal.refund.approve in the request's company and branch, other than the requester,
  cancels an approved, unpaid request with a reason. The obligation's stillOwed is unchanged,
  because cancelled requests never count toward the executed sum, and a new request may follow.
  Payouts already recorded on earlier requests stay.
- (c) The requester asks for cancellation, and a second holder of sal.refund.approve approves it.
  This is a two-step flow with a pending-cancellation sub-state.
- Variant for the Owner to rule on within (b): whether the original approver may cancel their own
  approval, or only a different sal.refund.approve holder may. The README wording does not exclude
  the approver.

### The planner's recommendation (not a decision)

Planner proposal, not a decision: option (b). A holder of sal.refund.approve other than the
requester may cancel an approved request whose payout is not yet recorded, and must give a reason.
This releases the obligation for a new request. Payouts recorded on other requests stay. Partial
payback stays as it works today: several sequential requests, each paid once in full. The wording
'not fully paid out' in README Q24 :478 should read 'not yet paid out', because a single request has
no partial payout in the current code.

### Until the Owner answers

Today's behaviour stays (README :489-490): an approved request whose payout is not recorded blocks
every new request on its obligation (refund_request_live_exists). There is no supported undo. The
only exit is recording the payout by the approved method.

### Detail for the development team

#### What happens today, with evidence

Table sal.refund_requests (supabase/migrations/20261008140000_sal_refund_requests.sql:99). Stored
approval_state is one of pending, approved, rejected or withdrawn (CHECK :148-149). The read state
adds 'executed' when executed_at is set (apps/api/src/modules/billing/domain/billing.ts:433;
refund-service.ts:997). Transitions: pending-\>approved (sal.refund.approve, approver must differ
from requester, :453-461, service :441-494); pending-\>rejected (sal.refund.approve, not the
requester, reason required, :468-478); pending-\>withdrawn (requester only, :485-487);
approved-\>executed (payout, once, :397-433, primitive sal.execute_refund_request :855-894).
Approved, rejected and withdrawn are terminal: the guard raises refund_decision_frozen (:385-390).
Facts are frozen: refund_request_frozen (:362). BLOCKING: the partial unique index
uq_refund_requests_obligation_live (:203-205), WHERE approval_state='pending' OR
(approval_state='approved' AND executed_at IS NULL), plus the insert guard (:285-287) and the
service (refund-service.ts:323-330) refuse any new request with refund_request_live_exists while an
approved request is unpaid. No path today leaves approved-and-unpaid except the payout. PARTIAL
PAYOUTS: one request is paid out exactly once and for its WHOLE amount. The refund_executed event
amount is v_rr.amount (:886) and the provenance guard binds the event amount to the source amount
(:674). There is no partial payout of a single request. Paying an obligation back in parts means
several sequential requests: a new request may be at most the obligation amount less the executed
sum (:315-317). The obligation becomes settled when the executed sum reaches its amount (:887-892).
The backend test covers obligation 30.00 paid as 10.00 then 20.00
(tests/backend/od-finance-refund-requests.test.ts:802-842). WHO RECORDS: any holder of
sal.payment.record in the branch (:405-406; domain billing.ts:451-454). No check against the
requester or approver. The web shows the payout form to anyone with mayRequest on an approved
request (apps/web/src/features/billing/components/RefundsPanel.tsx:557-559).

#### Data transition

Needs a forward migration; migrations are immutable. (1) Widen ck_refund_requests_approval_state
(:148-149) to add 'cancelled'. (2) Recording who cancelled and why. Either add new columns
cancelled_by uuid, cancelled_at timestamptz and cancellation_reason text (≤2000, non-blank), or
widen ck :151 (approved_by must be null unless approved), ck :153 (decided_by only for
rejected/withdrawn) and ck :161 (decision_reason only for rejected). New columns keep
approved_by/approved_at intact as history, so a cancelled request still shows who approved it. Add a
CHECK that a cancelled request has executed_at IS NULL and cancelled_by \<\> requested_by. (3) In
sal.guard_refund_request_update, add a branch before the refund_decision_frozen test (:385-390) that
admits approved-\>cancelled only when executed_at IS NULL, the actor holds sal.refund.approve in
scope and the actor is not the requester. The database stamps cancelled_by and cancelled_at. (4) Add
a new primitive sal.cancel_refund_request that locks the obligation first, then the request, in the
same order as :864-865. (5) Extend the GRANT UPDATE column list (:557) with any new columns. (6) No
change to uq_refund_requests_obligation_live (:205), the remainder sums (:315, :425, :887-890) or
the provenance guard (:653-666): all of them already exclude any state other than approved+executed,
so the remainder is released automatically. (7) No obligation state change. The obligation stays
open, and 'cancelled' on the obligation stays unreachable (open point (e)). (8) No financial event,
because nothing is paid. Add a read state 'cancelled' in REFUND_REQUEST_APPROVAL_STATES and
REFUND_REQUEST_STATES (billing.ts:411, :423). D7 refundStatus derivation (billing.ts:397-403) is
unaffected beyond 'approved' falling back to owed/partly_refunded. The migration rewrites no stored
rows.

#### Permission transition

No new permission code. Cancelling reuses sal.refund.approve (minted in this change, carried by the
tenant-administrator bundle, apps/api/src/modules/iam/domain/bootstrap-roles.ts:809). The README Q22
/ CC-OD-58 backfill question already governs who holds it in older organisations. Any organisation
without a holder cannot cancel, as it cannot approve today.

#### Affected code

supabase/migrations/20261008140000_sal_refund_requests.sql:148-172, :203-205, :357-500, :557,
:855-894 (forward migration needed); apps/api/src/modules/billing/application/refund-service.ts (new
cancelRefund with the lockRequest pattern :887-910 and refuseDecisionFailure :918-947);
apps/api/src/modules/billing/domain/billing.ts:411-485 (states, REFUND_RULES new tokens, e.g.
refund_self_cancellation and refund_cancel_already_executed);
apps/api/src/modules/billing/data/refund-repository.ts; new route
apps/api/src/app/api/v1/refund-requests/[requestId]/cancellation/route.ts (siblings: approval,
rejection, withdrawal, execution) with defineOperation;
apps/api/src/server/auth/audit-actions.ts:1968-1996 (new sal.refund_request.cancelled);
apps/web/src/features/billing/components/RefundsPanel.tsx:532-565 and RefundsScreen.tsx;
apps/web/src/features/billing/api.ts; apps/web/src/lib/api/idempotent-operations.ts; i18n en.json
and ar.json; tests/db/sal-refund-requests.test.ts, tests/backend/od-finance-refund-requests.test.ts,
tests/unit/od-finance-refund-requests.test.ts; ADR-023 (new open-point/decision text by an ADR
change, per README :487-488); unit-tier operation-count pins and OpenAPI regeneration.

#### Acceptance cases

- A cancellation by a sal.refund.approve holder who is not the requester, with a reason, on an
  approved request with executed_at NULL succeeds. approval_state becomes 'cancelled', cancelled_by
  and cancelled_at are stamped by the database, approved_by/approved_at are preserved, one audit
  sal.refund_request.cancelled is written, and no refund_executed event is written.
- After the cancellation, a new request on the same obligation for up to stillOwed succeeds, i.e.
  refund_request_live_exists no longer fires. Obligation 30.00, A 10.00 paid, B 20.00 cancelled: a
  new request of 20.00 is accepted and one of 20.01 is refused with refund_exceeds_obligation.
- The requester cancelling is refused with a named rule (proposed refund_self_cancellation) through
  both the service and a raw UPDATE. It is recorded once as a D12 refusal.
- A caller without sal.refund.approve in the request's branch is refused as authorization.denied
  (database-decided permission refusal); the same applies when the code is held only in another
  branch.
- Cancelling a pending, rejected, withdrawn, already-cancelled or executed request is refused
  (refund_decision_frozen / refund_already_executed). Repeating a cancel on an already-cancelled
  request answers replayed:true with no second audit, matching the approve/reject/withdraw
  idempotency.
- A blank reason or one over 2000 characters is refused as a field error.
- A stale If-Match is refused with ERR-CON-001.
- Concurrency, payout vs cancel: two sessions act on one approved request at the same time. Both
  lock the obligation and then the request, so exactly one succeeds. If the payout wins, the cancel
  is refused with refund_already_executed. If the cancel wins, the payout is refused with
  refund_not_approved. Never both, never a refund_executed event on a cancelled request, and the
  obligation is never settled from a cancelled request.
- Concurrency, cancel vs new request: a new request raced against the cancellation is either refused
  with refund_request_live_exists (before commit) or accepted after it, never two live requests
  (uq_refund_requests_obligation_live).
- A raw UPDATE to cancelled on an executed request is refused by the guard for every role.
- RLS: a cancelled request is visible only with sal.finance.view in its own tenant.
- Web: the cancel action is shown on an approved request only to a mayDecide user who is not the
  requester. The list and panel show a 'cancelled' state in English and Arabic.

#### Evidence and gaps

supabase/migrations/20261008140000_sal_refund_requests.sql:39-42, :52-56, :148-172, :203-205,
:285-287, :315-317, :362, :385-390, :397-433, :855-894;
apps/api/src/modules/billing/application/refund-service.ts:323-330, :634-699;
apps/api/src/modules/billing/domain/billing.ts:433-485;
apps/web/src/features/billing/components/RefundsPanel.tsx:557-565;
tests/backend/od-finance-refund-requests.test.ts:754-853; tests/db/sal-refund-requests.test.ts:387,
:741; docs/adr/ADR-023-sales-and-finance-policy-decisions.md:168-208;
docs/product/owner-directive-2026-09-16/README.md:473-490. GAP: the planner's 'approved 10, paid 4'
example is not reproducible in the current code; use the 30 = 10 paid + 20 abandoned restatement.

## FIN04: who may record a refund payout

**Canonical ids:** FIN04 = README Q25 (docs/product/owner-directive-2026-09-16/README.md:492-504,
cross-ref :569); capability-status.md:653 (cites CS:425); ADR-023 D2 part 2
(docs/adr/ADR-023-sales-and-finance-policy-decisions.md:178-181).

### In plain words

Today the approver of a refund must be a different person from the requester, but anyone who may
record payments may record the payout, including the person who approved it. One administrator can
therefore approve someone else's refund and then record paying it out.

The planner recommends that the person recording the payout must differ from the approver. A
two-person organisation still works, because the requester may record the payout.

**Who is affected (new, existing and QA organisations).** No permission code or grant changes for
new, existing or QA organisations. An organisation where one administrator both approves and pays
out would need a second person who may record payments (a third under option (c)).

### The exact question

Must the person who records a refund payout be someone other than the approver, other than both the
requester and the approver, or is today's rule enough (only the approval needs a second person)?

### Examples

- Two people, X (sal.payment.record) and Y (tenant administrator with both codes). X requests 10.00
  and Y approves it. Today either X or Y may record the payout. Under (b) only X may; Y is refused.
  Under (c) neither may, so a third holder of sal.payment.record is needed.
- Single administrator plus one cashier. The cashier requests, the administrator approves, and the
  cashier records the payout. This is allowed under (a) and (b) and refused under (c).
- Approver leaves after approving. Under (a) and (b), any remaining sal.payment.record holder other
  than the approver can still record the payout. A departed approver cannot act anyway.

### Options

- (a) No restriction beyond today's rule (approver \<\> requester).
- (b) The payout recorder must differ from the approver (executed_by \<\> approved_by).
- (c) The payout recorder must differ from both the requester and the approver. A refund then needs
  three distinct people per branch.

### The planner's recommendation (not a decision)

Planner proposal, not a decision: option (b), recorder \<\> approver. It keeps a two-person
organisation workable, because the requester may record the payout. It also stops one person from
both authorising and recording the same money.

### Until the Owner answers

Today's rule stays (README :503-504). The approver must differ from the requester, and any
sal.payment.record holder in the branch, including the requester or the approver, may record the
payout.

### Detail for the development team

#### What happens today, with evidence

The payout is recorded by any holder of sal.payment.record in the request's company and branch. This
is checked in the database guard
(supabase/migrations/20261008140000_sal_refund_requests.sql:405-406) and declared through
REFUND_PERMISSIONS.execute = 'sal.payment.record'
(apps/api/src/modules/billing/domain/billing.ts:451-454). Neither the guard (:397-433), the
primitive (:855-894) nor the service
(apps/api/src/modules/billing/application/refund-service.ts:634-786) compares executed_by with
requested_by or approved_by. The only separation enforced is approver \<\> requester: CHECK at :157,
guard refund_self_approval at :453-455, service at :460-467. The backend tests have the requester
record the payout: the fixture requests as SAL_FULL
(tests/backend/od-finance-refund-requests.test.ts:315-323), approves as SAL_APPROVER (:336) and
executes as SAL_FULL (:763-772, :822-823). The web offers the payout form to anyone with
sal.payment.record on an approved request
(apps/web/src/features/billing/components/RefundsPanel.tsx:557-559), without checking who approved.
The tenant-administrator bundle carries both sal.payment.record and sal.refund.approve
(apps/api/src/modules/iam/domain/bootstrap-roles.ts:802, :809), so one administrator can today
approve someone else's request and then record its payout.

#### Data transition

Needs a forward migration, with no data rewrite and no new column. In
sal.guard_refund_request_update's payout branch (:397-433), add a check that the actor (v_actor)
differs from OLD.approved_by, raising a new token (proposed refund_self_payout, check_violation).
Optionally add a table CHECK executed_by IS NULL OR executed_by \<\> approved_by (and, for (c), also
\<\> requested_by). Before adding the CHECK, it must be validated against existing rows. Whether
stored rows already violate it is unknown, so a NOT VALID-then-validate approach or a pre-check
query is needed (see gaps). Also add a pre-check in RefundService.executeRefund before the
repository call, plus a REFUND_RULES token, so the refusal is named and recorded once under D12. The
primitive sal.execute_refund_request (:855-894) can rely on the guard.

#### Permission transition

No new permission code and no grant changes. sal.payment.record keeps the payout. Under (b) or (c)
the new rule only removes the ability of a specific person on a specific request. Organisations
where one administrator approves and then pays out would need a second sal.payment.record holder.
Under (c), a third one is needed.

#### Affected code

supabase/migrations/20261008140000_sal_refund_requests.sql:397-433 (forward migration re-issuing
sal.guard_refund_request_update); apps/api/src/modules/billing/application/refund-service.ts:684-746
(new pre-check and token translation in the catch at :731-744);
apps/api/src/modules/billing/domain/billing.ts:470-485 (new REFUND_RULES token);
apps/web/src/features/billing/components/RefundsPanel.tsx:557-565 (hide the PayoutForm, or show a
'waits for another recorder' note, when currentUserId equals decidedBy, which carries approved_by
per refund-service.ts:1006; for (c) also when it equals requestedBy); i18n en.json and ar.json;
tests/db/sal-refund-requests.test.ts:572-790;
tests/backend/od-finance-refund-requests.test.ts:715-853 (fixtures must keep the recorder distinct
from SAL_APPROVER; under (c) the SAL_FULL-requests-and-executes pattern at :315-336 and :763-823
would break); tests/unit/od-finance-refund-requests.test.ts; ADR-023 D2 text and the D2-3 acceptance
cases.

#### Acceptance cases

- (b) The approver who holds sal.payment.record records the payout of the request they approved. It
  is refused with the new token (e.g. refund_self_payout) through both the service and a raw UPDATE
  / sal.execute_refund_request. It is recorded once as a D12 refusal; no refund_executed event is
  written, executed_at stays NULL, and the request stays approved.
- (b) The requester records the payout of their own request, which another person approved. It
  succeeds with one refund_executed event and one sal.refund_request.executed audit, and the
  obligation's paidOut and stillOwed move by the request amount.
- (b) A third sal.payment.record holder records the payout. It succeeds.
- (c only) The requester recording the payout is refused with a named token.
- A replay under the same execution idempotency key by the original recorder still answers
  replayed:true (refund-service.ts:665-671) and is not refused by the new rule.
- Concurrency: the approver and an eligible recorder submit payouts on one request at the same time.
  Exactly one refund_executed event results, and the approver's attempt is refused either by the new
  rule or by refund_already_executed.
- Web: the approver is not offered the payout form on a request they approved and sees an
  explanatory note in English and Arabic. Other sal.payment.record holders are offered it.
- Existing rule unchanged: the requester approving their own request is still refused with
  refund_self_approval.

#### Evidence and gaps

supabase/migrations/20261008140000_sal_refund_requests.sql:52-56, :157, :397-433, :453-461,
:855-894; apps/api/src/modules/billing/application/refund-service.ts:460-467, :634-786, :1006;
apps/api/src/modules/billing/domain/billing.ts:451-485;
apps/api/src/modules/iam/domain/bootstrap-roles.ts:802, :809;
apps/web/src/features/billing/components/RefundsPanel.tsx:557-565;
tests/backend/od-finance-refund-requests.test.ts:315-339, :754-842;
docs/adr/ADR-023-sales-and-finance-policy-decisions.md:178-181;
docs/product/owner-directive-2026-09-16/README.md:492-504. GAPS: whether any stored row today has
executed_by = approved_by needs a database query, which was not run. capability-status.md:425 was
not read in full (the line is too long).

## PRINT01-a: a print permission for each document

**Canonical ids:** VL-P132-005; README Q9 (print part); CC-OD-50 item 3; ADR-023 D10

### In plain words

Today anyone who can see a document on screen can also print it; there is no separate print
permission. The rule "nobody prints what they cannot read on screen" is recorded as a planner
decision, not yet as Owner policy.

The planner recommends no print permissions for now: printing happens in the browser without a
server call, so a print permission would add no real control, and taking printing away from existing
users would trigger the question 9 transition.

**Who is affected (new, existing and QA organisations).** Option (a): no change for anyone. Options
(b) and (c): new organisations receive the new codes with the administrator role; users in existing
organisations lose printing until the code is granted (the question 9 notice question applies); QA
organisations receive it by the same backfill.

### The exact question

Should each printable document get its own print permission code, or should a print stay behind the
read gate of the screen it is printed from (today's behaviour)?

### Examples

- A cashier holding only sal.finance.view can print any receipt in the branch, with its amount and
  the invoices it is allocated to (payments.print.\* keys, en.json:3820-3841).
- A user holding only quo.quotation.read can print a quotation, including unit prices, line totals
  and the grand total (QuotationPrint.tsx:350-353, 457-471).

### Options

- (a) No print codes. Print stays exactly as wide as read, and capability-status.md:398 is recorded
  as Owner policy.
- (b) One print code per document type (for example invoice, receipt, quotation, credit note,
  delivery sheet, acknowledgement, label), minted in supabase/seeds/04_iam_permission_catalog.sql.
  Each print requires the read gate AND the print code. This needs a backend print or audit
  operation if the server is to enforce it, because a print today makes no server call of its own.
- (c) One shared code for printing financial documents (invoice, counter sale, receipt, credit
  note), with non-financial prints left on their read gates.

### The planner's recommendation (not a decision)

Planner recommendation, not a decision: (a) for now. A print code enforced only in the browser adds
no server control while print is client-side window.print() with no print operation, and minting
codes triggers the Q9 transition. Revisit (b) if the Owner wants prints audited or limited
separately.

### Until the Owner answers

Print stays behind the screen's read gate (capability-status.md:398); no code is minted.

### Detail for the development team

#### What happens today, with evidence

There are no print codes, no print routes and no PDF. Every print is HTML printed with
window.print(), built from the reads its screen already makes. Gates today: invoice print needs
sal.invoice.manage (page gate, apps/web/src/app/[locale]/(dashboard)/invoices/page.tsx:21), and its
amounts appear only with sal.finance.view. Counter-sale print needs sal.invoice.manage and
sal.finance.view (inventory/counter-sales/page.tsx:18-19). Receipt print needs sal.finance.view
(payments/page.tsx:18). Quotation print needs quo.quotation.read (QuotationPrint.tsx:45-50).
Credit-note print needs sal.credit.manage and sal.finance.view (CreditNotePrint.tsx:27-33). Delivery
handover sheet needs sal.delivery.view; its release-checks part also needs sal.finance.view, and no
delivery read carries an amount (delivery-contract.ts:93). Reception acknowledgement needs
rec.reception.read (acknowledgement/page.tsx:30). Labels need inv.item.read and carry no price
(en.json:2256). The planner rule 'nobody prints what they cannot read on screen' is recorded in
capability-status.md:398 as a planner decision, not an Owner policy.

#### Data transition

(a) none. (b)/(c): new rows in seed 04 (seed 04 must run before any backfill, as with CC-OD-54/58);
new codes added to the administrator bundle in apps/api/src/modules/iam/domain/bootstrap-roles.ts.
No table migration unless a print-audit operation is added.

#### Permission transition

Under (b)/(c), every existing organisation's users lose print on upgrade until the code is granted:
a visibility reduction (CC-OD-50 item 3). Backfill pattern of CC-OD-53/CC-OD-58:
scripts/platform/backfill-tenant-administrator-bundle.mjs with --tenant (repeatable) or --all, --dry-run
first, --confirm \<operator-email\>, skips and reports a customised administrator role (script
:79-158). Non-administrator roles that read today would need explicit grants by each organisation.
Q9 asks whether organisations are told in advance with a list of affected roles, or a waiting period
applies.

#### Affected code

apps/web/src/features/billing/components/{InvoiceScreen.tsx:1560,2190-2330,InvoiceDocument.tsx,CreditNotePrint.tsx};
apps/web/src/features/payments/components/PaymentsScreen.tsx:1406,1975;
apps/web/src/features/quotations/components/QuotationPrint.tsx;
apps/web/src/features/delivery/components/DeliveryDocumentPanel.tsx;
apps/web/src/components/print/PrintToolbar.tsx;
apps/web/src/features/inventory/components/LabelsScreen.tsx;
supabase/seeds/04_iam_permission_catalog.sql; apps/api/src/modules/iam/domain/bootstrap-roles.ts

#### Acceptance cases

- (a) For each of the 8 documents, a user without the read gate gets the permission-denied state and
  no print control; a user with the read gate can print.
- (b) A user with the read gate but without the print code sees the screen and no Print button, and
  any server print operation returns 403; adding the code enables it.
- (b) Backfill dry run on a named organisation lists the codes to be added; the applied run is
  audited; a customised administrator role is reported and left unchanged.

#### Evidence and gaps

capability-status.md:398; CreditNotePrint.tsx:29-31; QuotationPrint.tsx:47-50; change-control.md:111
(CC-OD-50 item 3); README.md:383-386 (Q9); ADR-023 :602-608 (D10 'behind print permissions')

## PRINT01-b: quotation amounts on paper

**Canonical ids:** ADR-023 D17 and D10; README Q9; VL-P132-005

### In plain words

A printed quotation today shows the same prices and totals that its reader already sees on screen.

The planner recommends keeping paper the same as the screen. A copy without prices can be added
later as a layout choice, with no change to permissions.

**Who is affected (new, existing and QA organisations).** Options (a) and (c): no change for anyone.
Option (b): every existing quotation reader loses printed totals until granted a new code, with the
same backfill and notice questions as PRINT01-a.

### The exact question

Should a printed quotation hide amounts from some readers, or print the prices and totals the reader
already sees on screen?

### Examples

- A role holding only quo.quotation.read prints an approved quotation with its grand total; that
  total equals what the invoice will bill (D5, ADR-023 :736-738).

### Options

- (a) Paper matches screen: prices and totals print for every quo.quotation.read holder (today).
- (b) Totals print only for holders of a new code, while lines and quantities print for everyone.
  This needs a new code and the Q9 transition.
- (c) An optional 'no prices' copy any reader may choose (customer-facing work list), with no
  permission change.

### The planner's recommendation (not a decision)

Planner recommendation: (a). D17 already allows on-screen totals, so hiding them on paper protects
nothing. (c) can be added later as a layout option without a permission transition.

### Until the Owner answers

Today's behaviour: the paper matches the screen.

### Detail for the development team

#### What happens today, with evidence

D17 lets a quotation user see sales prices and quotation totals, accepting that the invoice total
can be inferred (ADR-023 :732-745). The quotation print shows unit price, discount, tax, line total,
subtotal, discount total, tax total and grand total to any quo.quotation.read holder
(QuotationPrint.tsx:317-353, 447-471). A draft revision prints no total (QuotationPrint.tsx:63-64).
It prints nothing from finance (QuotationPrint.tsx:52-57, held by
apps/web/tests/quotation-print.dom.test.tsx).

#### Data transition

None for (a) or (c). (b): a new code in seed 04 plus the bootstrap bundle.

#### Permission transition

(b) only: every existing quotation reader loses printed totals until granted. Same backfill pattern
and Q9 notice question as PRINT01-a.

#### Affected code

apps/web/src/features/quotations/components/QuotationPrint.tsx;
apps/web/src/app/[locale]/(dashboard)/quotations/[quotationId]/page.tsx:27-28;
apps/web/tests/quotation-print.dom.test.tsx

#### Acceptance cases

- A quo.quotation.read-only user prints an issued revision: the totals match the screen, and no
  invoice, payment, balance, cost or margin key appears.
- A draft revision prints with the draft note and no total.
- Under (b), a user without the new code gets a copy with no amounts, and its lines and quantities
  intact.

#### Evidence and gaps

ADR-023 :730-749; QuotationPrint.tsx:45-64

## PRINT01-c: invoice details for a user without finance visibility

**Canonical ids:** ADR-023 D17 open point (:745-749); README Q9; CC-OD-50 item 2

### In plain words

A user who may manage invoices but does not hold the finance-visibility permission sees an invoice's
number, status, dates and quantities, with every amount shown as "not available", and can print that
copy. The question is whether the D17 rule ("does not see invoice records") means such a user should
not see the invoice at all.

The planner recommends keeping today's behaviour: it is the shape intended for front-desk use, and
nobody's access changes.

**Who is affected (new, existing and QA organisations).** No grants under any option. Options (b)
and (c) reduce what existing organisations' roles can see; the affected roles would be listed per
organisation first, and question 9 answered.

### The exact question

Does D17's 'does not see invoice records' cover a user who holds sal.invoice.manage but not
sal.finance.view? Today that user sees invoice metadata on screen and on paper, with every amount
withheld.

### Examples

- A role holding sal.invoice.manage and wo.work_order.read, without sal.finance.view, opens
  /invoices?workOrderId=... and prints a copy showing the invoice number, status, dates and line
  quantities, with every amount 'not available'.

### Options

- (a) Keep: metadata without amounts is not an 'invoice record' under D17.
- (b) Narrow: without sal.finance.view, the invoice detail and print are refused (403). This is a
  visibility reduction (Q9).
- (c) Keep the screen, but withhold the print for users without sal.finance.view.

### The planner's recommendation (not a decision)

Planner recommendation: (a). It keeps the reception or front-desk shape the header was designed for
(billing-repository.ts:222-224), and changes no access.

### Until the Owner answers

Unchanged behaviour (ADR-023 :748-749).

### Detail for the development team

#### What happens today, with evidence

The invoice page gate is sal.invoice.manage (invoices/page.tsx:21). Without sal.finance.view, the
server returns the header with money = null, because RLS policy sel_invoice_amounts_gated hides
sal.invoice_amounts (apps/api/src/modules/billing/data/billing-repository.ts:215-224). The screen
shows header, status, number, dates, line types and quantities, and says 'not available' for every
amount (InvoiceScreen.tsx:87-92). The print panel (InvoiceScreen.tsx:1560) is offered regardless,
and InvoiceDocument prints 'unavailable' for null money (InvoiceDocument.tsx:398-421). No settlement
section is printed, because the balance is read only with sal.finance.view
(InvoiceDocument.tsx:90-93). Credit notes are hidden from this user entirely: the whole row is gated
by sal.finance.view (billing-repository.ts:560).

#### Data transition

None for any option. (b) changes the server read rule; (c) is web-only.

#### Permission transition

(b)/(c) reduce visibility for every existing organisation's roles holding sal.invoice.manage without
sal.finance.view. Before shipping, list the affected roles per organisation, and answer Q9 (advance
notice or waiting period). No grants.

#### Affected code

apps/api/src/modules/billing/data/billing-repository.ts:215-260;
apps/web/src/features/billing/components/InvoiceScreen.tsx:87-158,1560;
apps/web/src/features/billing/components/InvoiceDocument.tsx;
apps/web/src/app/[locale]/(dashboard)/invoices/page.tsx

#### Acceptance cases

- (a) A user with sal.invoice.manage and without sal.finance.view sees no figure on screen or paper,
  and every amount cell says 'not available', never zero.
- (b) The same user gets 403 on the invoice detail read, and that refusal is recorded.
- A quotation-only user still gets 403 on every invoice, receipt and credit-note read (the existing
  D17 matrix of ten requests, CP-20261008-2).

#### Evidence and gaps

ADR-023 :745-749; billing-repository.ts:215-224; InvoiceScreen.tsx:87-92

## PRINT01-d: payer and customer wording on prints

**Canonical ids:** ADR-023 D14; CC-OD-54; plan D14 'printed wording conditional'

### In plain words

The invoice print calls the invoice's party "Paying customer". When an insurer or another third
party pays that invoice, the wording is confusing, even though the settlement section already says
who paid for whom.

The planner recommends calling the invoice's party "Customer" or "Bill to" on the invoice, keeping
"Payer" on the receipt, and keeping the "Paid by ... for ..." sentence. The exact legal wording
waits for the accounting questionnaire.

**Who is affected (new, existing and QA organisations).** No change for new, existing or QA
organisations; wording only.

### The exact question

Which words should invoice and receipt prints use for the party billed and the party who paid, now
that a receipt can pay another customer's invoice as a third party?

### Examples

- An insurer's receipt is allocated to a customer's invoice as a third-party allocation. The invoice
  print still calls the customer 'Paying customer', while its settlement says 'Paid by \<insurer\>
  (insurer) for \<customer\>'.

### Options

- (a) Keep today's wording.
- (b) Label the invoice's party 'Customer' or 'Bill to' on the invoice print, and keep 'Payer' on
  the receipt and 'Paid by ... for ...' in the settlement.
- (c) Show both on the invoice print: 'Bill to \<customer\>', plus a 'Paid by' line whenever any
  third-party allocation exists.

### The planner's recommendation (not a decision)

Planner recommendation: (b). It is wording only (en/ar message keys), and removes 'Paying customer'
on an invoice that a third party paid. Exact legal wording waits on the accounting questionnaire
(ACC01).

### Until the Owner answers

Current wording stays. It is truthful about the stored payer_partner_id, but ambiguous when a third
party pays.

### Detail for the development team

#### What happens today, with evidence

The invoice's party is stored as sal.invoices.payer_partner_id (ADR-023 :700). The invoice print
labels that party 'Paying customer' / 'العميل الدافع' (en.json:3373, ar.json:3373;
InvoiceDocument.tsx:278-284). The receipt print labels its party 'Payer' / 'الدافع' (en.json:3831,
ar.json:3831). Third-party payments print inside the invoice's settlement section as 'Paid by
{payer} ({relationship}) for {customer}', with the authorisation reference (en.json:3409;
InvoiceDocument.tsx:82-84, 513-525). The receipt has the same sentence (en.json:3935). A name that
cannot be resolved prints 'Not shown here', never a reference.

#### Data transition

None. Message keys in apps/web/src/i18n/messages/{en,ar}.json only.

#### Permission transition

None.

#### Affected code

apps/web/src/i18n/messages/en.json:3262,3373,3409,3831,3935 and ar.json same keys;
apps/web/src/features/billing/components/InvoiceDocument.tsx:278-284,513-525;
apps/web/src/features/payments/components/PaymentsScreen.tsx (print section);
apps/web/tests/payments-print-and-reversal.dom.test.tsx

#### Acceptance cases

- An invoice with no third-party allocation prints the customer under the chosen label in both
  languages.
- An invoice with an insurer allocation prints the customer label plus 'Paid by \<insurer\>
  (insurer) for \<customer\>' and the authorisation reference, in English and in Arabic (RTL).
- A receipt print names the payer, and its third-party allocation names the customer whose invoice
  it paid.
- A user without crm.customer.read sees 'Not shown here' and never an id.

#### Evidence and gaps

ADR-023 :689-722; en.json:3373,3409,3831,3935; InvoiceDocument.tsx:69-84

## DOC01: credit-note numbering

**Canonical ids:** README Q26; ADR-023 D10; ACC01 (Q10-12) for legal fields

### In plain words

Credit notes have no number of their own. Their print shows a reference made from the invoice number
and the time the credit note was requested, so two credit notes on the same invoice differ only by
that time.

The planner recommends giving credit notes their own number per company and branch, assigned when
the credit note is approved, as invoice numbers are assigned on issue. Legal and tax fields wait for
the accounting questionnaire. Whether past credit notes keep their composed reference or are
numbered afterwards is an Owner choice.

**Who is affected (new, existing and QA organisations).** No permission change for new, existing or
QA organisations; approval stays with the existing credit approval permission and its limit.

### The exact question

Should credit notes get their own document number, assigned on approval from a sequence per company
and branch, the way invoices get theirs on issue?

### Examples

- An approved credit note against invoice INV-... prints the reference 'Credit note for invoice
  \<number\>, requested \<time\>'. Two notes against the same invoice differ only by request time.

### Options

- (a) Keep the composed reference.
- (b) A new 'credit_note' sequence, branch-scoped, assigned inside sal.approve_credit_note
  (idempotent, like issue_invoice). This needs: a forward migration adding the number column and the
  allocation, a SEQUENCE_DEFINITIONS entry, provisioning for every existing (company, branch)
  because next_display_number has no fallback, and a decision on whether already-approved notes stay
  unnumbered or are numbered by backfill.
- (c) As (b), but numbered at request time instead of at approval (this numbers notes that are later
  rejected).

### The planner's recommendation (not a decision)

Planner recommendation (README Q26): (b) for numbering. Legal and tax fields wait on the accounting
questionnaire (ACC01). Historical approved notes keep the composed reference and are not renumbered.
That last point is an Owner choice, not a decision.

### Until the Owner answers

Composed reference; no numbering policy is invented (README :518).

### Detail for the development team

#### What happens today, with evidence

sal.credit_notes (created supabase/migrations/20260724092000_sal_payments.sql:272) has no number
column; no credit_note_number exists in any migration. The print shows a composed reference: 'Credit
note for invoice {invoice}, requested {requested}', or 'Credit note requested {requested}' when no
invoice number exists (en.json:505-507; CreditNotePrint.tsx:193-205). It also states that 'Credit
notes do not have a number of their own yet' (en.json:502). How invoices are numbered:
sal.issue_invoice reads sal.invoice_numbering_configs (default sequence code 'invoice') and calls
shared.next_display_number(seq, company_id, branch_id)
(migrations/20260724093000_sal_financial_events.sql:218-223). Branch-scoped sequences ('invoice',
'quotation', 'receipt') are registered in
apps/api/src/modules/shared-services/domain/sequence-registry.ts:103-128 and provisioned per
(tenant, company, branch) by number-sequence-bootstrap-service.ts. The latest approval path is
sal.approve_credit_note in migrations/20261008121000_sal_refund_obligations.sql:503.

#### Data transition

(b): forward migration (number column, nullable for history; allocation in approve_credit_note); new
sequence row per existing company and branch through the number-sequence bootstrap (the P1-30 #321
pattern); numbering-rules admin screen (administration/numbering-rules) lists the new type. Existing
approved notes are either left unnumbered (print falls back to the composed reference) or backfilled
in approval order, which is an Owner choice.

#### Permission transition

None; approval stays sal.credit.approve with its limit (D13).

#### Affected code

supabase/migrations (new forward file; sal.approve_credit_note latest at
20261008121000_sal_refund_obligations.sql:503);
apps/api/src/modules/shared-services/domain/sequence-registry.ts:81-158;
apps/api/src/modules/shared-services/application/number-sequence-bootstrap-service.ts;
apps/api/src/modules/billing/data/billing-repository.ts:560;
apps/web/src/features/billing/components/CreditNotePrint.tsx:35-41,193-243; en/ar.json:502-507;
apps/web/tests/credit-note-print.dom.test.tsx

#### Acceptance cases

- Approving a credit note assigns the next number of its company and branch exactly once;
  re-approval replays without allocating a new number.
- Two branches number independently; a rejected note gets no number.
- An organisation with no 'credit_note' sequence row refuses approval with a named error, or is
  provisioned first; the bootstrap reports the row missing.
- The print shows the number when present and the composed reference for unnumbered history, in
  English and Arabic (PC-1, PC-2).

#### Evidence and gaps

README.md:506-518; CreditNotePrint.tsx:35-41; 20260724093000_sal_financial_events.sql:218-223;
sequence-registry.ts:103-128

## PERM01: giving new rights to existing organisations

**Canonical ids:** README Q8, Q9, Q22 (and Q27 as the same pattern); CC-OD-50 items 1-3 and 7;
CC-OD-53; CC-OD-54; CC-OD-58

### In plain words

New rights, such as approving credit notes, approving refunds, and any future print right, are given
automatically only to organisations created after the right was added. Older organisations, apart
from the two named QA organisations, do not have them until someone grants them, and an
administrator cannot grant a right they do not hold.

The planner recommends granting to named organisations on request, after a dry run, and answering
questions 8, 22 and 27 together. Before any right is taken away, the affected roles are listed per
organisation. No blanket grants and no silent removals.

**Who is affected (new, existing and QA organisations).** New organisations already receive the
codes. Existing organisations: as the Owner answers. QA organisations: the two named QA
organisations are already backfilled.

### The exact question

For codes added after an organisation was provisioned (sal.credit.approve with its limit for D13,
sal.refund.approve for D2 part 2, and any print code for D10), should the administrator-bundle
backfill cover every existing organisation, or only named ones with the change stated to them?

### Examples

- An organisation provisioned before D2 part 2 cannot approve or reject a refund request after
  upgrade: its administrator lacks sal.refund.approve.
- An organisation provisioned before D13 cannot approve a credit note until sal.credit.approve is
  granted and a limit is set (credit_no_approval_limit).

### Options

- (a) Named organisations on request: dry run, then an audited --tenant backfill, with customised
  roles skipped and reported (today's pattern).
- (b) Every existing organisation: --all, with customised roles still skipped and reported.
- (c) None: each organisation's administrator grants the codes themselves, with the change stated to
  them in advance.

### The planner's recommendation (not a decision)

Planner recommendation: (a), answered once for Q8, Q22 and Q27 together, and applied to any future
print code (Q9). For Q9's notice question, list the affected roles per organisation before any
reduction ships. No blanket grants and no silent removals (plan section 16, PERM01).

### Until the Owner answers

Only odqa_alpha and odqa_beta are backfilled. Every other existing organisation keeps today's roles
until an answer.

### Detail for the development team

#### What happens today, with evidence

The administrator bundle in apps/api/src/modules/iam/domain/bootstrap-roles.ts:792-813 now includes
sal.credit.approve, sal.refund.approve, sal.reversal.approve and sal.payment.third_party (the
catalogue is in seed 04, for example 04_iam_permission_catalog.sql:112,127). Only new organisations
get them automatically. The recorded transitions (change-control.md rows CC-OD-53/54/58, :114-119)
backfill only odqa_alpha and odqa_beta: dry run first, after seed 04, preserving a customised
administrator role. Every other organisation is left unchanged until its administrator grants the
code. D13 additionally needs an approval limit set before a credit note can be approved (ADR-023
:246-253).

#### Data transition

No schema change. Seed 04 must already hold the code. The operator runs
scripts/platform/backfill-tenant-administrator-bundle.mjs --confirm \<operator-email\> (--tenant
\<uuid|code\> ... | --all) [--dry-run]. D13 also needs each organisation's credit approval limit,
which the Owner or organisation sets; none is invented.

#### Permission transition

Adds codes only to non-customised administrator roles of the chosen organisations. Customised roles
are reported, not changed. Other roles are unchanged.

#### Affected code

scripts/platform/backfill-tenant-administrator-bundle.mjs:79-158,303;
apps/api/src/modules/iam/domain/bootstrap-roles.ts:755-813;
supabase/seeds/04_iam_permission_catalog.sql;
docs/product/owner-directive-2026-09-16/change-control.md:111-119

#### Acceptance cases

- The dry run on the chosen organisations lists the codes to add per administrator role and writes
  nothing.
- The applied run adds exactly those codes, writes audit, and a re-run adds nothing (idempotent).
- A customised administrator role is skipped and reported as 'customised'.
- After the backfill, an administrator can approve a refund request raised by someone else, and is
  still refused self-approval (refund_self_approval). Credit-note approval still needs a limit.

#### Evidence and gaps

README.md:379-386,442-445,520-536; change-control.md:36-59,111-119; bootstrap-roles.ts:792-813

## CAT01: renaming and moving item categories

**Canonical ids:** CAT01; docs/product/owner-directive-2026-09-16/README.md Q23 (:452-471);
completion plan section 8 'Required category tree delivery' and section 16 row CAT01

### In plain words

Today an organisation can create item categories and see them in a flat list, but cannot rename a
category or move it under another one. The only remedy is a new category, and the items stay on the
old one.

The planner recommends allowing both rename and move under the existing "manage items" permission.
Each change is checked against the latest version of the category, made in one step, and recorded in
the audit trail; nothing is deleted and no items are moved. Items, vehicle fluid specifications and
material requirements point to the category itself, not to its name, so a rename or a move changes
none of them.

**Who is affected (new, existing and QA organisations).** No change for new, existing or QA
organisations if the existing "manage items" permission governs. A new permission would need a
catalogue entry and no automatic grant to existing organisations.

### The exact question

May an organisation rename an item category and move it under another parent (or to the top level),
and if so, which permission governs it?

### Examples

- Today: a tenant creates 'oils' then 'engine_oils' with parentCategoryId = oils; there is no API
  call that can change 'Engine oils' to 'Engine oil' or move it under a later 'lubricants' category -
  the only remedy is a new category with a new code, and items stay on the old one because no item
  re-file operation is in scope.
- All references are by id, never by name or path: inv.item_master.item_category_id (NOT NULL,
  :213/:234), inv.vehicle_fluid_specifications.item_category_id (nullable, 20260917096000:55/:75,
  exact-equality match :247), inv.material_requirements.item_category_id (nullable,
  20260917097000:103/:139, exact-equality family match :263-279, :608). No code walks the hierarchy,
  so a rename or move changes no item, specification or material-requirement match.

### Options

- (a) Read-only tree only; categories still created as today; no rename or move.
- (b) Rename only (name and optionally description); code and parent unchanged.
- (c) Rename and move as two separate operations, each If-Match guarded, one transaction, one audit
  event; no deletion, no retire, no item reassignment.
- (c') As (c) but a single PATCH /item-categories/{categoryId} carrying name and/or parentCategoryId
  (one operation id, one audit action with changed fields).

### The planner's recommendation (not a decision)

Recommendation only, not a decision: (c). Proposed contract: inv.item-category-rename - PATCH
/item-categories/{categoryId}, body {name, description?} strict; inv.item-category-move - POST
/item-categories/{categoryId}/move, body {parentCategoryId: uuid|null} strict (null = top level).
Both: versionGuarded: true (If-Match = the category's recordVersion; mismatch 409/412 per the
existing parseIfMatch pipeline, route-handler.ts:430), scope 'tenant', auditClass 'privileged',
permissions ['inv.item.manage'] plus the same tenant-wide check create uses (route.ts:112), response
200 with the category view and new recordVersion. No new permission code - the code is already
described as 'Manage item master, categories, UoM' (route.ts:71). New audit actions to catalogue in
apps/api/src/server/auth/audit-actions.ts beside :1527: inv.item_category.renamed (details: old/new
name) and inv.item_category.moved (details: old/new parent id, code). Whether a separate code (e.g.
a narrower category-structure code) is wanted is the Owner's call; none exists today.

### Until the Owner answers

Per README Q23: the category tree is delivered read-only and labelled read-only; categories are
still created as today; read-only navigation is not counted as completion of category management.

### Detail for the development team

#### What happens today, with evidence

Only two operations exist, both in apps/api/src/app/api/v1/item-categories/route.ts:
inv.item-category-list (GET /item-categories, inv.item.read, :49-62) and inv.item-category-create
(POST /item-categories, inv.item.manage, idempotent, auditAction inv.item_category.created, :64-79).
Create additionally requires inv.item.manage held tenant-wide (callerHoldsPermissionTenantWide,
:112-118, refusal ERR-IAM-001). There is no rename, move, retire, status-change or delete operation.
The table inv.item_categories (supabase/migrations/20260723093000_inv_reference.sql:165-205) already
has record_version (auto-incremented by shared.touch_row_metadata, 0002_base_schemas.sql:196), an
UPDATE grant and UPDATE RLS policy for app_runtime, an immutable-columns trigger covering tenant_id,
code, created_at, created_by (:197-198) - so name and parent_category_id are already updatable at
the database level - and the cycle guard trigger fires on UPDATE as well as INSERT (:193-194). Web:
apps/web/src/features/inventory/components/SetupScreen.tsx shows categories as a flat list with a
Parent column (:205-230); no tree exists.

#### Data transition

None for existing rows: ids, codes and every item / fluid-specification / material-requirement link
are preserved; record_version starts advancing from current values. No backfill. A migration is
needed only if the Owner picks a sibling-name uniqueness rule or a history table (see the CAT01-NAME
and CAT01-TREE decisions).

#### Permission transition

None if inv.item.manage governs (no bundle, role or grant change; holders who can create can
rename/move). If the Owner wants a new code, it needs a catalogue entry, bundle placement decisions
and no automatic grant to existing tenants (README forbids silently broadening).

#### Affected code

apps/api/src/app/api/v1/item-categories/route.ts (new [categoryId]/route.ts and
[categoryId]/move/route.ts);
apps/api/src/modules/inventory/application/inventory-catalog-service.ts:257-309 (createCategory
pattern to mirror); apps/api/src/modules/inventory/data/inventory-repository.ts:2799-2838
(readItemCategory / insertItemCategory; needs an update-with-version method);
apps/api/src/server/auth/audit-actions.ts:1526-1532;
apps/web/src/features/inventory/components/SetupScreen.tsx, apps/web/src/features/inventory/api.ts,
apps/web/src/lib/contracts/inventory-contract.ts, apps/web/src/lib/api/idempotent-operations.ts,
i18n en.json/ar.json :2903-2918; generated OpenAPI and endpoint inventories plus the unit-tier
operation pins.

#### Acceptance cases

- Service: rename with correct If-Match returns 200 and recordVersion+1; stale If-Match is refused
  and the row is unchanged; missing If-Match is refused.
- Service: caller with inv.item.manage granted only in one branch is refused (ERR-IAM-001), as
  create is today; caller with only inv.item.read is refused.
- Service: move to parentCategoryId = own id refused; move under a descendant refused; move to an
  unknown or other-tenant id refused as unknown_category (not 23503); move to null makes it a root.
- Service: exactly one audit row inv.item_category.renamed / .moved per success, none on refusal;
  items under the category keep item_category_id and inv.item-search by categoryId returns the same
  items after the change.
- DB (tests/db): direct UPDATE setting parent to self raises check_violation; UPDATE creating a
  2-node and a 3-node cycle raises check_violation; UPDATE of code is refused by
  org.guard_immutable_columns; cross-tenant parent fails fk_item_categories_parent. No behavioural
  test of the cycle guard exists today (tests/db/foundation.test.ts:407 only lists the function).
- UI: tree shows roots/children, expand/collapse, breadcrumb; rename and move controls hidden for
  users without tenant-wide inv.item.manage and the tree labelled read-only; the move picker
  excludes the node itself and its descendants; a 409 on stale version shows a reload message in en
  and ar, RTL correct.

#### Evidence and gaps

apps/api/src/app/api/v1/item-categories/route.ts:49-131;
supabase/migrations/20260723093000_inv_reference.sql:33-55,165-205,213,234;
supabase/migrations/0002_base_schemas.sql:187-199;
apps/api/src/modules/inventory/application/inventory-catalog-service.ts:257-309;
apps/api/src/server/auth/audit-actions.ts:1526-1532;
docs/product/owner-directive-2026-09-16/README.md:452-471; 40+ routes already use versionGuarded:
true (e.g. apps/api/src/app/api/v1/warranty-policies/[policyId]/route.ts).

## CAT01-NAME: category names among siblings, and second-language names

**Canonical ids:** CAT01; README Q23 option (b)/(c) 'unique among its siblings ... under the
existing English and Arabic naming rules'

### In plain words

Two categories under the same parent may today have exactly the same name; only their codes differ.
A category has a single name, typed as the organisation wants it; there are no separate English and
Arabic names.

The planner recommends refusing two identical names under the same parent, enforced by the database,
and keeping a single name. Before that rule is added, existing data must be checked for such
duplicates; if any exist, the Owner chooses between renaming them first and a weaker check in the
application only.

**Who is affected (new, existing and QA organisations).** No change for new, existing or QA
organisations.

### The exact question

Must a category's name be unique among its siblings (same parent, same tenant), and is a category
name one free-text value or a pair of English and Arabic names?

### Examples

- Today both 'Filters' under 'Engine' and 'Filters' under 'Cabin' are allowed (distinct parents) -
  and so are two 'Filters' directly under 'Engine' (same parent), which a tree cannot tell apart
  except by code.
- Completion plan section 8 requires the tree to cover 'identical display names in distinct
  branches', which every option below keeps legal.

### Options

- (N1) No name rule: names free; the tree disambiguates by code.
- (N2) Sibling uniqueness enforced in the service only (case-insensitive, trimmed); a concurrent
  race can still produce a duplicate.
- (N3) Sibling uniqueness enforced by a new partial unique index, e.g. (tenant_id,
  COALESCE(parent_category_id, zero-uuid), lower(btrim(name))) WHERE deleted_at IS NULL, checked on
  create, rename and move; refusal token duplicate_sibling_name (ERR-CON-001).
- (L1) One name as today (single free text, any script).
- (L2) Add an optional second-language name column (forward migration), shown by locale with
  fallback.

### The planner's recommendation (not a decision)

Recommendation only: N3 with L1. N3 needs a pre-migration check that no tenant already has duplicate
sibling names (the index creation would fail otherwise); if any exist, the Owner must choose
rename-first or service-only (N2). L2 would be new policy not given by the Owner and is not
recommended without an explicit instruction.

### Until the Owner answers

Names stay free; the read-only tree shows code beside name so identical names are distinguishable.

### Detail for the development team

#### What happens today, with evidence

Only the code is unique: uq_item_categories_code (tenant_id, code) WHERE deleted_at IS NULL
(20260723093000:191). Name has only ck_item_categories_name_not_blank (:186) and the API's 1..MAX_NAME
length (route.ts:43). Two siblings may today carry the identical name. There is one name column, no
Arabic/English pair: no name_ar / name_en / localized-name column exists anywhere in
supabase/migrations. The 'existing English and Arabic naming rules' cited in README Q23(b) are not
found as a stored rule; UI labels are translated through apps/web/src/i18n/messages/{en,ar}.json,
but tenant-entered category names are shown as typed.

#### Data transition

N3: forward migration adds the index; must first count existing duplicates per (tenant, parent,
lower(name)) - requires a database query, not run here. L2: nullable column, no backfill
(no-fake-data rule forbids inventing translations).

#### Permission transition

None.

#### Affected code

New forward migration under supabase/migrations (N3/L2); inventory-catalog-service.ts createCategory
(:278-297, map the new unique violation to duplicate_sibling_name and keep duplicate_code distinct);
the rename and move services; the web create/rename forms.

#### Acceptance cases

- Create, rename and move each refuse a case/whitespace-variant duplicate under the same parent with
  duplicate_sibling_name; the same name under a different parent succeeds.
- Moving a category into a parent that already has a child of that name is refused and nothing
  changes.
- Duplicate code still yields duplicate_code, not duplicate_sibling_name.
- DB: direct INSERT/UPDATE producing a sibling duplicate raises unique_violation (N3 only).

#### Evidence and gaps

supabase/migrations/20260723093000_inv_reference.sql:185-191;
apps/api/src/app/api/v1/item-categories/route.ts:40-47;
apps/api/src/modules/inventory/application/inventory-catalog-service.ts:286-296; grep for
name_ar|name_en|localized_name in supabase/migrations returned nothing;
docs/product/owner-directive-2026-09-16/README.md:458-459.

## CAT01-TREE: the rules a category move follows

**Canonical ids:** CAT01; README Q23 option (c) 'inactive categories and the descendants that move
with their parent are treated by a stated rule'; ADR-023 D12

### In plain words

When a category moves, its sub-categories move with it. Several smaller rules need a choice: whether
a category may be moved under an inactive one, whether there is a depth limit, whether refused moves
are recorded as business-rule refusals, and whether a separate history of names and parents is kept.

The planner recommends refusing a move under an inactive category (as creating one already does),
moving the whole sub-tree, keeping the existing database depth cap of 64 levels, recording no new
kind of refusal, and treating the audit trail as the history. None of these needs a database change.
Whether the tree should also show a labelled place for items whose category is unavailable is the
Owner's call.

**Who is affected (new, existing and QA organisations).** No change for new, existing or QA
organisations.

### The exact question

Which structural rules govern a move (inactive source/target, descendants, depth), should refused
rename/move attempts be recorded as business-rule refusals, and is a history of past names/parents
kept beyond the audit trail?

### Examples

- Move 'engine_oils' (with child 'synthetic') under 'synthetic' -\> cycle, refused by the trigger
  and should be refused first by the service as category_cycle.
- Two users concurrently move A under B and B under A: the advisory lock serialises them and the
  second fails the cycle check; moving to top level (parent null) skips the lock, which is safe
  because a root cannot form a cycle.
- A soft-deleted category (deleted_at set) is hidden by listItemCategories
  (inventory-repository.ts:2786) yet an item could still reference it, since the FK ignores
  deleted_at - such an item would vanish from the tree; no operation produces this today.

### Options

- Inactive: (I1) refuse moving under an inactive parent (as create does) and allow moving an
  inactive node; (I2) also refuse moving an inactive node; (I3) allow both.
- Descendants: (S1) the whole subtree moves with the node (implicit today); no item is touched.
- Depth: (P1) keep the existing 64-level database cap only; (P2) add a smaller product limit (number
  to be set by the Owner) checked in the service.
- Refusal recording: (R1) refusals stay ERR-VAL-001/ERR-CON-001 responses and server log lines, as
  create today; (R2) record them as business-rule.refused with tokens such as category_self_parent,
  category_cycle, unknown_category, inactive_category, duplicate_sibling_name,
  category_version_conflict (requires extending D12 beyond sales/finance).
- History: (H1) audit rows only (old/new values in details); (H2) a new inv.item_category_history
  table.

### The planner's recommendation (not a decision)

Recommendation only: I1, S1, P1, R1, H1 - each matches an existing rule (create's inactive-parent
refusal, the existing trigger, the existing audit trail) and none needs a migration. Uncategorised
items: impossible by schema (item_category_id NOT NULL with a RESTRICT FK, and no category delete or
retire operation exists), so the tree needs no 'Uncategorised' bucket; it should instead show each
category's item count and, defensively, list any item whose category is not in the visible set
(inactive or soft-deleted) under a labelled 'unavailable category' node rather than dropping it.
Whether that defensive node is wanted is the Owner's call.

### Until the Owner answers

Read-only tree; no move, so none of these rules is exercised; the existing trigger remains the only
structural guard.

### Detail for the development team

#### What happens today, with evidence

DB trigger inv.guard_item_category_no_cycle (20260723093000:33-54) refuses self-parent and cycles
(check_violation), serialises per tenant with pg_advisory_xact_lock (:41) only when the new parent
is non-null, and caps the ancestor walk at 64 levels (:48-50). It does not check parent status. Same
tenant is enforced by the composite FK fk_item_categories_parent (:184) and RLS (:201-203). The
service refuses an inactive or invisible parent on create (inventory-catalog-service.ts:261-276,
tokens unknown_category, inactive_category, ERR-VAL-001). No operation sets status = inactive or
deleted_at, so via the API every category is active today; inactive rows could exist only by direct
database write. A descendant moves implicitly with its parent (children reference the parent's id).
D12 recording (business-rule.refused via withBusinessRefusal,
apps/api/src/server/audit/business-refusals.ts:93; route-handler.ts:667) is used today by
sales/finance services; ADR-023 D12 (:616-653) is a sales-and-finance ADR and no inventory category
refusal is recorded. There is no category history table; the only trail is iam audit rows.

#### Data transition

None for R1/H1/P1/I1. R2 needs no table (iam.security_events exists) but extends ADR-023 D12 scope.
H2 needs a forward migration with RLS and an isolation test.

#### Permission transition

None.

#### Affected code

supabase/migrations/20260723093000_inv_reference.sql:33-54 (trigger, unchanged under P1);
inventory-catalog-service.ts:261-276 (reuse the parent checks for move, add self/descendant
pre-check with a recursive read); apps/api/src/server/audit/business-refusals.ts (only under R2);
docs/adr/ADR-023 D12 (only under R2); apps/web tree component (new) in
apps/web/src/features/inventory.

#### Acceptance cases

- Move under an inactive parent refused with inactive_category; under I1, moving an inactive node to
  an active parent succeeds and its status is unchanged.
- Moving a node with three levels of descendants keeps every descendant's parent_category_id and
  record_version unchanged and only the moved node's version advances.
- Move that would exceed the chosen depth limit is refused (P2) or reaches the trigger's 'hierarchy
  too deep' check_violation at 64 (P1).
- Concurrent opposite moves: exactly one succeeds, the other is refused, no cycle exists afterwards
  (tests/db).
- Tree with an item whose category is soft-deleted or inactive (DB-seeded in tests only) still shows
  the item under the defensive node; empty tenant shows an empty state; wide and deep trees render
  with keyboard and RTL.

#### Evidence and gaps

supabase/migrations/20260723093000_inv_reference.sql:33-54,184,191-203,213,234;
apps/api/src/modules/inventory/application/inventory-catalog-service.ts:261-276;
apps/api/src/modules/inventory/data/inventory-repository.ts:2784-2808;
apps/api/src/server/audit/business-refusals.ts:48-93;
docs/adr/ADR-023-sales-and-finance-policy-decisions.md:616-653; tests/db/foundation.test.ts:407
(guard listed, no behavioural cycle test found in tests/).

## PLAN01: the plan chosen when an organisation is provisioned

**Canonical ids:** CC-OD-24; related CC-OD-49; ADR-024 (Proposed/Open); FC-01..FC-08; depends on
LIC01

### In plain words

When the platform operator creates a new organisation and picks a plan on the form, the plan is
saved as a draft that nothing reads. The organisation then shows "no subscription" and its usage
shows "Unlimited". A plan only takes effect when it is given afterwards through "Assign
subscription".

The planner recommends making the chosen plan the organisation's first active subscription at
provisioning, with the same rules "Assign subscription" applies. Which modules a plan unlocks waits
for LIC01. Existing draft rows are not changed until the Owner decides what happens to them.

**Who is affected (new, existing and QA organisations).** No tenant permission changes for new,
existing or QA organisations. Under option (a) the Owner chooses whether a platform operator also
needs the subscription-management permission to give a plan at provisioning.

### The exact question

When an operator picks a plan on the Platform 'Provision organization' form, what should that do to
the new organisation: (a) make it the organisation's first subscription, active straight away and
with the same rules as 'Assign subscription', but with no module or feature limits until LIC01 is
decided; (b) do (a) and also apply the plan's module/feature entitlements, which waits for LIC01 and
ADR-024; or (c) remove or disable the plan field on the form until LIC01, so a plan can only be
given afterwards through 'Assign subscription'?

### Examples

- Provision with planCode=standard_annual (the code the web test uses): the web sends no status, the
  function writes one org.tenant_subscriptions row with status='draft' and effective_to NULL, and
  activePlanCode on GET /platform/organizations reads null
- Then use POST /platform/organizations/{tenantId}/subscriptions (platform.subscription-assign, kind
  'assigned'): it inserts status='active' with effective_to set from termMonths, writes a
  tenant_subscription_events row, checks capacity, and the plan becomes visible. The earlier draft
  row is left untouched
- An API caller (not the web form) can send subscription.status='active'. The function accepts it
  with no term, no event, and no org.plan_capacity_shortfall check. This is a bypass of the assign
  rules that options (a) and (c) should close
- Provision with a code that has no active version covering the start date: ERR-VAL-001 with nothing
  created, because the whole transaction rolls back

### Options

- (a) Save the plan as the first active subscription when the organisation is provisioned. In the
  same transaction, run the assignment rules of SubscriptionService.assign
  (subscription-service.ts:239-338): kind 'assigned', term from plan.termMonths or one the form
  supplies, capacity shortfall check, an events row, and audit org.tenant_subscription.changed. Stop
  passing a caller's status into the function. Show the plan and its term on the success screen and
  the detail page. Entitlements stay as they are until LIC01
- (b) Option (a), plus the plan's entitlement_document decides which modules the organisation gets.
  This needs LIC01 / ADR-024 FC-01 (registered flags, package contents), which the Owner has not
  decided
- (c) Remove or disable the plan field and subscriptionStart on the form until LIC01. Refuse
  body.subscription on platform.organization-provision, or drop it from the contract. The only way
  to give a plan is SubscriptionPanel 'Assign' (kind 'assigned') after provisioning

### The planner's recommendation (not a decision)

Recommendation only, not a decision: (a). It reuses a path that already exists and is tested
(platform.subscription-assign rules, the events trail and the capacity check). It fixes the inert
draft row and closes the raw-status bypass, and it does not have to wait for LIC01, because the
plans have no entitlements yet (all 7 empty). (b) cannot be built until LIC01 is decided. (c) is the
fallback if the Owner wants no commercial act at provisioning.

### Until the Owner answers

Until the Owner decides, treat CC-OD-24 as open and do not accept WP06 provisioning. The form must
not be presented as giving a plan. Operators give a plan with SubscriptionPanel 'Assign
subscription' after provisioning. Do not change existing draft rows.

### Detail for the development team

#### What happens today, with evidence

The selector is not ignored. It saves a row, but that row is a draft that nothing reads. Path:
apps/web/src/features/platform/components/ProvisionOrganizationScreen.tsx:365-378 shows active plans
as `planCode`. apps/web/src/features/platform/actions.ts:303-309 sends `subscription: { plan_code,
effective_from }` and never sends `status`.
apps/api/src/app/api/v1/platform/organizations/route.ts:141-148 accepts `status` as any string of up
to 32 characters (optional) and passes it on unchanged (route.ts:229-233). The database function
org.provision_organization (supabase/migrations/20260717107000_org_provisioning.sql:145-169) finds
the active plan version and inserts into org.tenant_subscriptions with status
COALESCE(status,'draft') (line 163), no effective_to (so no term), no org.tenant_subscription_events
row, and no capacity check. Every reader filters on s.status='active':
platform-repository.ts:237-240 (organisation list activePlanCode) and
subscription-repository.ts:188-191, 430-432 and 488-490 (live subscription / lock / usage). So the
organisation detail page says 'no subscription' and usage says 'Unlimited' (measured as CC-OD-24 at
1a90f356 and not re-measured since). The only things the selector does today: an unknown code is
refused with ERR-VAL-001 at body.subscription.plan_code (organization-service.ts:647-656), and a
draft row is left behind. Plan entitlements have no effect either way:
org.subscription_plans.entitlement_document holds booleans keyed to org.feature_flags (migration
20260717102000_org_subscriptions.sql:104-201), no flags are registered, all 7 plans are empty, and
only operation.featureFlag reads a flag (route-handler.ts:469 to server/auth/entitlement.ts:67).
That last point is CC-OD-49.

#### Data transition

No migration is needed for (a) or (c) if the provisioning service writes the subscription after
org.provision_organization by calling the subscription repository in the same transaction and stops
sending body.subscription to the function. If the function itself has to change, that means a new
forward migration, because merged migrations cannot be edited. Existing data: some organisations may
have draft rows written by provisioning. Those are not counted here: the 62 tenants and how many
have a subscription row need a read-only DB query. The Owner must decide whether to (i) leave them
as history, (ii) mark them cancelled, or (iii) turn them into active ones. (iii) would put
organisations under capacity limits they have never been held to. Nothing is deleted under any
option.

#### Permission transition

Today provisioning needs platform.organization.provision (route.ts:182) and assigning needs
platform.subscription.manage (subscriptions/route.ts:66). Under (a) the Owner must choose: either a
plan given at provisioning also needs platform.subscription.manage (checked before the first write,
the same way requireLifecycleAuthority does for activate at organization-service.ts:662-673), or
platform.organization.provision is enough on its own. No tenant-side permission changes. Under (c),
no change.

#### Affected code

apps/web/src/features/platform/components/ProvisionOrganizationScreen.tsx:365-378;
apps/web/src/features/platform/actions.ts:156-161,193-194,270-277,303-309;
apps/api/src/app/api/v1/platform/organizations/route.ts:141-148,174-186,229-233;
apps/api/src/modules/platform/application/organization-service.ts:319-335,626-660;
apps/api/src/modules/platform/application/subscription-service.ts:239-338;
apps/api/src/modules/platform/data/subscription-repository.ts:576-622;
supabase/migrations/20260717107000_org_provisioning.sql:145-169;
apps/web/src/features/platform/components/SubscriptionPanel.tsx:85-107,228-357; tests
apps/web/tests/platform-console-writes.test.ts:157-187, tests/db/org-provisioning.test.ts,
tests/backend/p1-32-platform-console.test.ts

#### Acceptance cases

- (a) Provision with an active plan: the detail page shows that plan as the live subscription, the
  term end equals effective_from plus the plan term, and usage limits equal capacity_limits instead
  of 'Unlimited'
- (a) Exactly one org.tenant_subscriptions row, status='active', plus one
  org.tenant_subscription_events row of kind 'assigned' and an audit record
  org.tenant_subscription.changed. No row with status='draft' is written
- (a) Retry with the same Idempotency-Key and the same body: the stored response is replayed
  (shared.idempotency_keys, operation 'org_provisioning'), and no second subscription or event row
  is written
- (a) Same key, different planCode: refused, because the fingerprint differs; nothing is written
- (a) A plan with no active version covering the start date, or a plan with no term and none
  supplied: ERR-VAL-001 or ERR-RES-001, and no tenant is created (full rollback)
- (a)/(c) body.subscription.status='active' sent by the caller is refused at the boundary or
  ignored, and is never stored
- (c) The form shows no plan field, and a provisioning POST that carries `subscription` is refused
  with ERR-VAL-001
- (b) only: an operation behind a flag that the plan does not include answers the not-entitled
  refusal for that organisation

#### Evidence and gaps

change-control.md:85 (CC-OD-24 measured 1a90f356, Owner decision required), change-control.md:110
(CC-OD-49), capability-status.md:242-243,
docs/platform/module-entitlement-inventory-2026-10-04.md:174,229 (7 plans empty, no flags),
ADR-024:3-11 (Proposed/Open), README.md:563 and 577 (PLAN01/LIC01 mapping), completion-plan section
14 line 140 and register line 194. By code reading: org_provisioning.sql:163 defaults to 'draft';
actions.ts:305-308 sends no status; platform-repository.ts:240 and subscription-repository.ts:191
filter on status='active'. Not checked: the current number of draft subscription rows in the shared
DB (needs a read-only query) and whether the RLS insert policy on org.tenant_subscriptions in
20260831093000_iam_platform_privilege_graph.sql allows a provision-only holder to insert (not read
line by line).

## RPT01: who may export a report as CSV (VL-P132-008)

**Canonical ids:** VL-P132-008; P1-31 CC-04 (Owner decision 2026-09-08); completion-plan line 204

### In plain words

The CSV report export exists, but no organisation can use it. The export right is withheld from
administrators by the Owner decision CC-04 of 2026-09-08, because the same right also opens wider
bulk exports of documents, messages and branch data. CC-04 said it could be revisited once the
export contract existed, and it now does.

The planner recommends a narrower right that covers only report export, or giving the existing right
to named organisations after a dry run. If the right goes to existing organisations, note that the
backfill adds every missing administrator right at once, not just this one.

**Who is affected (new, existing and QA organisations).** New organisations: the code would be added
to the administrator role. Existing organisations: only by a named dry run and then a backfill,
which adds every other missing administrator code as well. QA organisations: by the same backfill
run.

### The exact question

Now that the CSV report export route exists, should rpt.export (or a narrower export code) be held
by tenant administrators, and should existing organisations receive it?

### Examples

- Signed-in QA at 3cf622c3 and 428d8eba did not run the export rows (D16-AS5, en/ar):
  capability-status.md:350-351
- REG checks at d5ce97b7 found rpt.export on no role of odqa_alpha (capability-status.md:402)
- A freshly provisioned administrator gets ERR-IAM-001 from shared.export-catalogue
  (bootstrap-roles.ts:228-230)

### Options

- (a) Keep it withheld (CC-04 stands); export stays unusable
- (b) Carry rpt.export in TENANT_ADMINISTRATOR_ROLE for new organisations; existing organisations
  only through a backfill decision
- (c) Mint a narrower code (e.g. report-export only, separate from the shared.export-\* switch) and
  re-point rpt.report-export to it; this needs a seed and catalogue change plus a bundle decision
- (d) Like (b) or (c), but existing organisations only by a dry run and then a backfill of named
  organisations

### The planner's recommendation (not a decision)

Recommendation only, not a decision: (c) or (d). CC-04 states it is revisitable once the export
contract exists, and that has now happened. The reach objection is about the shared.export-\*
resources, not the report CSV, so a separate code answers the objection without reopening it. If the
Owner prefers (b), pair it with named-organisation backfill and no --all.

### Until the Owner answers

CC-04 is in force. Export is refused for every tenant and the export QA rows are recorded as not
run.

### Detail for the development team

#### What happens today, with evidence

TENANT_ADMINISTRATOR_ROLE (the only tenant bundle besides first_owner, which carries 3 iam codes)
deliberately omits rpt.export (bootstrap-roles.ts:208-231, 820-826). Four operations need it:
rpt.report-export POST /reports/{reportCode}:export ['rpt.export','rpt.report.read']
(apps/api/src/app/api/v1/reports/[reportCode]/route.ts:103), shared.export-catalogue
(exports/resources/route.ts:26), shared.export-authorize (exports/authorizations/route.ts:54).
ins_role_permissions_delegable only lets an administrator map a code it already holds, so no tenant
account can hold or be given it; the CSV export is unusable everywhere. The CC-04 reason is reach:
rpt.export is the platform-wide P1-15 export switch, and the bundle already holds
shared.document.read, org.branch.read and iam.sensitive.view, so carrying it would allow bulk export
of documents, outbound messages and branch data including sensitive fields.

#### Data transition

No data is migrated. Under (c), one catalogue seed row is added to
supabase/seeds/04_iam_permission_catalog.sql and the operation's permissions change, which moves the
OpenAPI document and the operation register. No schema migration was identified (this is not
verified).

#### Permission transition

New organisations: the code is added to TENANT_ADMINISTRATOR_ROLE.permissionCodes and written once
at provisioning. Existing organisations: only through
scripts/platform/backfill-tenant-administrator-bundle.mjs --confirm \<operator\> --tenant
\<uuid|code\> [--dry-run], which is additive, idempotent, needs a platform.organization.provision
grant, skips customised roles, and audits platform.tenant_administrator_bundle.backfilled. WARNING:
the script inserts the WHOLE difference between the bundle and the codes already mapped (lines
63-65), and it has no per-code flag (parseArgs lines 299-322). A named organisation therefore gets
every other missing code too, such as rpt.report.configure and sal.reversal.approve. QA: the
odqa_alpha administrator gets it by the same backfill run, or by a role built by an administrator
who now holds it.

#### Affected code

apps/api/src/modules/iam/domain/bootstrap-roles.ts:208-231,820-826,645-860;
apps/api/src/app/api/v1/reports/[reportCode]/route.ts:103;
apps/api/src/app/api/v1/exports/resources/route.ts:26;
apps/api/src/app/api/v1/exports/authorizations/route.ts:54;
scripts/platform/backfill-tenant-administrator-bundle.mjs;
tests/backend/p1-31-provisioning-bundle.test.ts (pins the exclusion);
tests/backend/od-report-snapshots.test.ts (pins the refusal)

#### Acceptance cases

- A new organisation's administrator exports the invoice and payment report CSV with the as-of
  moment in the file and in its audit record (en, ar)
- Under (c): the same administrator is still refused shared.export-catalogue and
  shared.export-authorize
- An existing named organisation: the dry run lists the codes it would add; the real run adds them
  and writes one audit record; a second run reports unchanged
- A customised administrator role is reported as customised and gains nothing
- An account without the code gets no export action in the web UI and a 403 from the API

#### Evidence and gaps

docs/product/owner-directive-2026-09-16/capability-status.md:402; bootstrap-roles.ts:208-231;
README.md:573; completion-plan line 204

## RPT02: a separate permission for saving report snapshots (VL-P132-010)

**Canonical ids:** VL-P132-010; ADR-023 D16; DBCR-P1-32-PRE-OD-FD16C-001 §8; #532 (8fe31a69);
completion-plan line 205

### In plain words

Saving a report snapshot today needs the "configure reports" permission, which also lets that person
edit and publish report definitions. A clerk who saves month-end snapshots must therefore also be
able to change what reports mean.

The planner recommends a dedicated permission for saving snapshots, held by the administrator role,
so an administrator can hand out saving without handing out report editing and publishing.

**Who is affected (new, existing and QA organisations).** New organisations: the administrator role
would gain the new code. Existing organisations: by a named dry run and then a backfill (which adds
every missing administrator code). QA organisations: by the same backfill. Under option (a) nothing
moves.

### The exact question

Should saving a report snapshot (original or restatement) get its own permission code, or stay gated
on rpt.report.configure?

### Examples

- CP-20261008-1 QA at 428d8eba saved snapshots under the interim gate, and save was withheld without
  rpt.report.configure (capability-status.md:351)
- DBCR-P1-32-PRE-OD-FD16C-001.md:142 lists the dedicated code as 'Not in this change'

### Options

- (a) Keep rpt.report.configure as the permanent save gate
- (b) Mint a dedicated code (e.g. rpt.report.snapshot.create) held by the administrator bundle, so
  an administrator can delegate saving without delegating definition editing and publishing
- (c) Like (b), but also decide whether a restatement needs a different code from an original

### The planner's recommendation (not a decision)

Recommendation only: (b). Saving a frozen snapshot is a separate duty from changing what the report
means. The current coupling means a reporting clerk who saves month-end snapshots must also be able
to publish report versions.

### Until the Owner answers

Save stays gated on rpt.report.configure (#532), which grants nothing new to anyone.

### Detail for the development team

#### What happens today, with evidence

Since #532, rpt.report-snapshot-create declares ['rpt.report.configure','rpt.report.read'] plus the
dataset codes (apps/api/src/app/api/v1/reports/[reportCode]/snapshots/route.ts:21-25,96;
supabase/migrations/20261008110000_rpt_report_snapshot_save_gate.sql). #530 had gated it on
rpt.export, which no tenant held. rpt.report.configure also gates the seven report-definition
operations: create, rename, status, version and publish (report-configurations/\*\*/route.ts), and
those also require the grant to be tenant-wide (callerHoldsPermissionTenantWide). So anyone allowed
to save a snapshot can also edit and publish report definitions.

#### Data transition

(b) needs a seed catalogue row, a policy migration that re-expresses the rpt.report_snapshots insert
gate (a forward migration; 20261008110000 is immutable), and a re-pointed operation. Existing
snapshot rows are untouched (the table is append-only).

#### Permission transition

New organisations: the bundle gains the new code. Existing organisations: the backfill script, on
named organisations after a dry run (the same whole-difference caveat as RPT01). Organisations whose
administrators lack rpt.report.configure are RPT03. QA: odqa_alpha via backfill. If (a) is chosen,
nothing moves.

#### Affected code

apps/api/src/app/api/v1/reports/[reportCode]/snapshots/route.ts:96;
supabase/migrations/20261008110000_rpt_report_snapshot_save_gate.sql;
apps/api/src/modules/iam/domain/bootstrap-roles.ts:848-858; apps/web reports feature (save/restate
actions hidden by permission: apps/web/tests/reports.dom.test.tsx);
tests/db/rpt-report-snapshots.test.ts; tests/backend/od-report-snapshots.test.ts

#### Acceptance cases

- A role holding only the new code, rpt.report.read and the dataset codes can save an original and a
  restatement with a reason, but cannot create or publish a report configuration (403)
- A role holding rpt.report.configure but not the new code cannot save (403, and the action is
  hidden)
- Restatement without a reason is still refused with its D12 record
- Existing snapshots stay readable and unchanged after the migration

#### Evidence and gaps

capability-status.md:400,404; DBCR-P1-32-PRE-OD-FD16C-001-rpt-report-snapshot-save-gate.md:140-143;
completion-plan line 205

## RPT03: report configuration in organisations provisioned earlier

**Canonical ids:** README Q27; VL-P132-010; related to README Q8 and Q22; pattern CC-OD-53/CC-OD-58;
completion-plan line 206

### In plain words

Organisations created before 2026-09-09 may have administrators without the "configure reports"
permission. They cannot configure or publish reports (so their report list stays empty), cannot save
snapshots, and cannot grant themselves the permission.

The planner recommends named organisations on request, after a dry run, answered together with
questions 8 and 22, because the backfill adds every missing administrator permission at once, not
just this one.

**Who is affected (new, existing and QA organisations).** New organisations already hold the code.
Existing organisations: by an Owner-named list. QA organisations: the acceptance organisation is
named explicitly in the same run.

### The exact question

Which organisations provisioned before 2026-09-09 should have rpt.report.configure added to their
administrator role?

### Examples

- The backfill script's dry run against a named tenant would list rpt.report.configure among the
  missing codes. It has not been run, so the actual per-organisation lists are unknown

### Options

- (a) Named organisations on request: dry run, then an audited backfill with --tenant, keeping
  customised roles (README recommendation)
- (b) Every existing organisation (--all, which reports every organisation it acted on)
- (c) None

### The planner's recommendation (not a decision)

Recommendation only: (a). Answer it together with Q8 and Q22, because the script cannot add only
this code: it adds every missing bundle code.

### Until the Owner answers

No grant. Affected organisations cannot configure reports or save snapshots.

### Detail for the development team

#### What happens today, with evidence

The bundle has carried rpt.report.configure since P1-31 P-11 on 2026-09-09
(bootstrap-roles.ts:183-206, 849-858). It is written once at provisioning
(bootstrap-roles.ts:196-201), so older organisations keep their original set. Without the code they
cannot configure or publish a report, and since both published report reads filter on
status='published', their report catalogue stays empty (bootstrap-roles.ts:190-194). Since #532 they
also cannot save a snapshot. Measured on 2026-09-08: 24 administrator roles held 44 to 67 codes
against a bundle of 74 at the time (backfill script lines 16-18).

#### Data transition

None to schema. Inserts rows into iam.role_permissions (effect allow) on the tenant_administrator
role only, plus one audit row per changed organisation and an evidence JSON (default
.tmp/tenant-administrator-backfill-\<ts\>.json).

#### Permission transition

New organisations already hold the code. Existing organisations: by Owner-named list, via
backfill-tenant-administrator-bundle.mjs with ROOTLCO_ENV=local-acceptance or
production-maintenance, --confirm \<operator-email\>, --tenant ..., --dry-run first. Roles marked
customised (created-inside-organisation, deny:, beyond-bundle:, tenant-edit:) are skipped whole. QA:
the acceptance organisation is named explicitly in the same run.

#### Affected code

scripts/platform/backfill-tenant-administrator-bundle.mjs:1-159,299-322;
apps/api/src/modules/iam/domain/bootstrap-roles.ts:183-206;
tests/backend/p1-31-tenant-administrator-bundle-backfill.test.ts

#### Acceptance cases

- The dry run on a named older organisation lists the codes it would add, writes nothing and appends
  no audit record
- The real run adds them; the administrator can then create and publish a report configuration and
  save a snapshot
- Re-running reports unchanged
- A customised role is reported as customised and is not changed
- An organisation not named is not touched

#### Evidence and gaps

docs/product/owner-directive-2026-09-16/README.md:520-535; capability-status.md:404; completion-plan
line 206

## ODO01: who may record odometer readings (VL-P132-009)

**Canonical ids:** VL-P132-009; completion-plan line 207

### In plain words

No account in any organisation can record an odometer reading today, at reception check-in or on the
vehicle profile, because the permission is in no built-in role and so nobody can hold it or pass it
on.

The planner recommends adding it to the organisation administrator role, so administrators can
record readings and give the permission to their own reception or advisor roles. Existing
organisations would receive it by a named dry run and then a backfill, not all at once. Which staff
roles organisations are expected to give it to is the Owner's guidance to give.

**Who is affected (new, existing and QA organisations).** New organisations: the administrator role
gains the code. Existing organisations: by a named dry run and then a backfill (which adds every
missing administrator code). QA organisations: the QA administrator by backfill, then a reception
role the organisation builds.

### The exact question

Who should be able to record odometer readings, and should existing organisations be given that
ability?

### Examples

- CP-20261007-3 and CP-20261008-1 QA: reception arrival readings not run (2 rows each), because no
  account holds the code (capability-status.md:350-351, 403)

### Options

- (a) Carry it in TENANT_ADMINISTRATOR_ROLE so the administrator can record readings and delegate
  them to tenant-built reception or advisor roles
- (b) Like (a), and have the Owner name which persona roles the tenant is expected to give it to
  (reception staff, service advisor, technician). This guidance is for tenants; no bootstrap
  reception role exists
- (c) Make reception intake readings also accepted under rec.reception.manage. This is a code change
  to the route and three web gates, and it widens what that code means
- (d) Keep it unassigned (readings stay unreachable)

### The planner's recommendation (not a decision)

Recommendation only: (a), with the persona question in (b) left to the Owner. The plan says not to
grant it silently to everyone, so existing organisations should go through named dry-run backfill,
not --all.

### Until the Owner answers

Unreachable for every tenant. The QA arrival-readings rows are recorded as not run.

### Detail for the development team

#### What happens today, with evidence

veh.vehicle-odometer-record POST /vehicles/{vehicleId}/odometer-readings declares
['veh.vehicle.odometer.record']
(apps/api/src/app/api/v1/vehicles/[vehicleId]/odometer-readings/route.ts:59-66). The code is in the
catalogue (docs/database/permission-catalog-reference.md:205, medium risk) but in neither bootstrap
role. TENANT_ADMINISTRATOR_ROLE holds veh.vehicle.read, veh.vehicle.manage and the rec.reception.\*
codes (bootstrap-roles.ts:724-738) but not this one, so no account can hold it or delegate it. The
web UI gates the vehicle profile 'Record odometer reading' control and the reception check-in
arrival readings step on this code alone. It is not implied by veh.vehicle.manage or
rec.reception.manage (ReadingsStep.tsx:63; vehicles/[vehicleId]/page.tsx:156;
check-in/[receptionId]/page.tsx:36). The only bootstrap roles are first_owner and
tenant_administrator; receptionist, service-advisor and similar roles are tenant-built
(bootstrap-roles.ts:113-116). The local owner-acceptance harness gives it to its administrator
persona (scripts/dev/owner-acceptance/context.mjs:202) and deliberately withholds it from the reader
persona (:411).

#### Data transition

None. Readings are new rows in the vehicle odometer table when recorded. No historical rows are
created.

#### Permission transition

New organisations: the bundle gains veh.vehicle.odometer.record. Existing organisations: named
dry-run then backfill (the whole-difference caveat applies). Tenant reception roles: the tenant's
administrator maps the code through the role editor after holding it. QA: odqa_alpha administrator
via backfill, then a tenant-built reception role.

#### Affected code

apps/api/src/modules/iam/domain/bootstrap-roles.ts:724-738;
apps/api/src/app/api/v1/vehicles/[vehicleId]/odometer-readings/route.ts:59-66;
apps/web/src/features/crm/permissions.ts:45;
apps/web/src/features/receptions/components/steps/ReadingsStep.tsx:63;
apps/web/src/features/vehicles/components/VehicleHistorySections.tsx:433;
apps/web/tests/write-permission-gating.dom.test.tsx:274;
tests/backend/p1-17-vehicle-odometer.test.ts

#### Acceptance cases

- A new organisation's administrator records an arrival reading in the check-in wizard (en, ar), and
  it appears newest-first on the vehicle profile
- The administrator builds a reception role holding the code; a user with that role records a
  reading; a user without it sees the form withdrawn with its reason
- A reading lower than the last one, or a correction, behaves per the existing capture_method
  correction rule
- Cross-tenant vehicleId is refused

#### Evidence and gaps

capability-status.md:403; bootstrap-roles.ts:724-738; completion-plan line 207

## AUTH01: signing other devices out after a password change

**Canonical ids:** CC-OD-31 (behaviour half open); W9-R1 residual in CC-OD-29; completion-plan line
211

### In plain words

After a platform operator changes their password, another device that is already signed in keeps
working until its access token expires: up to one hour at the current local setting. For
organisation users, locking an account or revoking sessions already takes effect on the next
request.

The planner recommends deciding first the longest acceptable window (immediately, or a stated number
of minutes). If it must be immediate, the gap should be closed on the server, where a revocation
check already exists for organisation users. The Owner should also say whether platform-console
sessions follow the same rule as organisation sessions.

**Who is affected (new, existing and QA organisations).** No organisation permission codes change
for new, existing or QA organisations. Option (c) changes database grants for the platform role
only.

### The exact question

After a password change, a platform-operator revocation or a deactivation, must every other device
lose access at once, or is it acceptable for access to continue until the access token expires?

### Examples

- CC-OD-31 measured a second browser still reaching the console at +0, +15 and +30 s after a
  password change (change-control.md:92)

### Options

- (a) Accept the current behaviour: other devices keep access until the access token expires (up to
  1 h at the current local setting), with the wording already corrected (#425, #427)
- (b) Shorten jwt_expiry (a provider setting per environment), which narrows the window without
  closing it
- (c) Close the gap server-side: give the platform password change a way to set
  iam.user_sessions.revoked_at (new grants and policy, or a second connection; a schema and
  architecture decision per authentication-service.ts:165-173), and make sure the console path
  checks session state
- (d) (b) and (c) together

### The planner's recommendation (not a decision)

Recommendation only: decide the required maximum window first (immediate, or N minutes). If
immediate, the answer is (c), because a request-path revocation mechanism already exists. The Owner
must also say whether platform-console sessions must meet the same rule as tenant sessions.

### Until the Owner answers

Wording is honest (#425, #427). The behaviour gap is documented in user manual Part 1 §1.6.2 and
Part 2A §2A.14; this is not scheduled.

### Detail for the development team

#### What happens today, with evidence

Access tokens are provider JWTs: jwt_expiry = 3600 seconds on the local stack
(supabase/config.toml:213), refresh-token rotation is on (:219), and the [auth.sessions] timebox and
inactivity settings are commented out (:492-496). The API verifies the signature and exp
(token-verifier.ts:174-175). On the tenant request path, resolve-context.ts:22-31 also reads
iam.user_sessions on every request and refuses a session that is revoked, hard-expired or idle; the
idle timeout is SESSION_IDLE_TIMEOUT_MINUTES, default 30 (backend-config.ts:155). The following
paths make revocation immediate: logout (authentication-service.ts:536, 551); account status leaving
active (user-administration-service.ts:224-235); admin revoke-all on /iam/users/{userId}/sessions,
which needs iam.user.manage and iam.session.view_all (route.ts:73-76, 113); and the
revoke-platform-operator script (audit-actions.ts:2339). The gap: the platform password change
(authentication-service.ts:148-183, 781-783) only calls the provider's global sign-out, which
revokes refresh tokens. It cannot reach iam.user_sessions, because app_platform has no grant on that
table (20260831093000_iam_platform_privilege_graph.sql). So another device keeps working until exp,
and the API answers otherSessions:'sessions-kept-until-expiry'. The product publishes no refresh
route (:161-163). W9-R1: GoTrue 2.x has no 'end all sessions of a user id' endpoint, so a revoked
operator's token still verifies at the provider until expiry, but it confers no platform authority
(CC-OD-29).

#### Data transition

None for (a) or (b). (c) needs a migration granting app_platform a narrowly scoped update on
iam.user_sessions, or an equivalent, and has no data backfill.

#### Permission transition

No tenant permission codes change. (c) changes database grants for the app_platform role only.

#### Affected code

supabase/config.toml:213-222,492-496;
apps/api/src/modules/iam/application/authentication-service.ts:148-183,502-560,760-790;
apps/api/src/server/context/resolve-context.ts:22-31,160-290;
apps/api/src/modules/iam/application/user-administration-service.ts:224-235,286-326;
apps/api/src/modules/iam/provider/supabase-provider.ts:269-310;
apps/api/src/app/api/v1/iam/users/[userId]/sessions/route.ts:60-113

#### Acceptance cases

- Two browsers are signed in as one platform operator; after a password change in browser A, browser
  B's next API call is refused within the Owner's chosen window (measured at +0, +15 and +30 s as in
  CC-OD-31)
- A tenant user moved to locked is refused on the next request (already true; a regression check)
- A revoked platform operator holds no platform authority immediately (already true), and their
  session ends within the window
- After the change, the password-change response reports the real outcome, never a revocation that
  did not happen

#### Evidence and gaps

docs/product/owner-directive-2026-09-16/change-control.md:90,92;
docs/phase-1/phase-1-29/w9-owner-bootstrap.md:149; docs/platform/platform-owner-provisioning.md:287;
completion-plan line 211. GAP: I did not read the code to confirm whether the platform-console
request path consults iam.user_sessions; the CC-OD-31 measurement suggests it does not. The
production jwt_expiry is not in the repo.
