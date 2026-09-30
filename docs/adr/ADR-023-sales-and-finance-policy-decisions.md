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

Open — for how each of D2–D6 and D8–D17 is implemented. Each is planned for a later pull request
named in the mapping table; until that pull request is merged, the behaviour the table records as
"existing" is what the platform does.

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

### D13 — Credit-approval limits

The existing approval-limit mechanism is reused with explicit credit-approval permissions and
limits, never inherited from discount amounts, with currency, tenant and branch scope, separation of
duties, and protection against splitting a credit or approving concurrently to bypass a limit.

### D14 — Payments from someone other than the invoice customer

Allocating a payment to an unrelated customer's invoice is refused by default. Payments from an
insurer or employer are accepted only through explicit, authorized, audited third-party handling:
the payer is distinct from the invoice customer, and the relationship, authorization and reason are
recorded. No ownership changes and no credit is transferred silently. Scope and currency are
enforced.

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

| Decision | Existing behaviour (before this record's pull request)                                                                                                                                                                            | Missing implementation                                                                                                                                                                                                                                                                                                                             | Tests                                                                                                                                                                                                                             | Pull request                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| D1       | Line tax and totals rounded to four decimals (`mig:20260723096000_quo_quotations.sql:216-217`, `mig:20260917093000_sal_counter_sales.sql:434-437`); prices, discounts and thresholds accepted at four decimals for every currency | Implemented here: `mig:20260930100000_sal_minor_unit_rounding.sql` (per-line half-up rounding to the minor unit; totals as sums of rounded lines; the two CHECKs replaced by `tg_quotation_items_money`); minor-unit refusal of fixed discounts and amount thresholds; a price rule and an item selling price are unit prices and keep their scale | `tests/db/sal-minor-unit-rounding.test.ts`, `tests/backend/od-finance-rounding.test.ts`, `tests/unit/od-finance-rounding.test.ts`, web field-error cases                                                                          | This pull request             |
| D2       | Credit ceiling is the open receivable (`mig:20260930090000_sal_finance_controls.sql:181-184`); no refund instrument                                                                                                               | Ceiling = eligible invoiced − effective credits; refund obligation with separate dual-controlled approval and payout                                                                                                                                                                                                                               | Planned                                                                                                                                                                                                                           | Planned (D2)                  |
| D3       | Schema admits `rejected` (`mig:20260930090000_sal_finance_controls.sql:109-111`); only the approval route exists                                                                                                                  | Withdraw-own and reject-with-reason operations; audit actions                                                                                                                                                                                                                                                                                      | Planned                                                                                                                                                                                                                           | Planned (D3 + D9 + D12 + D13) |
| D4       | Approval primitive only (`mig:20260930090000_sal_finance_controls.sql:193-220`); no request route                                                                                                                                 | Request and approve operations with separate permissions; replacement-receipt link                                                                                                                                                                                                                                                                 | Planned                                                                                                                                                                                                                           | Planned (D4 + D14)            |
| D5, D15  | One live invoice per work order (`mig:20260917093000_sal_counter_sales.sql:72-73`); a revision with any undecided or rejected item is not billable                                                                                | Per-source-line invoiced quantity tracking across revisions                                                                                                                                                                                                                                                                                        | Planned                                                                                                                                                                                                                           | Planned (D5 + D15 + D6 + D11) |
| D6       | Quotation lines are services only (`apps/api/src/modules/quotation/application/quotation-service.ts:1295`)                                                                                                                        | Part lines at authorized sales prices with snapshots                                                                                                                                                                                                                                                                                               | Planned                                                                                                                                                                                                                           | Planned (D5 + D15 + D6 + D11) |
| D7       | No read derives a credit position; a fully credited invoice read "Settled"; `inv.lock_return_source` accepts only `issued` invoices (`mig:20260917094000_inv_sales_returns.sql:257`), so no terminal `credited` status is set     | Implemented here: `SettlementView` on `sal.invoice-outstanding-read` (`creditStatus`, `paymentStatus`, `refundStatus`), `creditStatus` on the invoice-and-payment report, invoice screen and print in English and Arabic                                                                                                                           | `tests/backend/od-finance-rounding.test.ts`, `tests/backend/p1-31-report-engine-invoice-payment.test.ts`, `tests/unit/od-finance-rounding.test.ts`, `apps/web/tests/invoices.dom.test.tsx`, `apps/web/tests/reports.dom.test.tsx` | This pull request             |
| D8       | Policy pinned per quotation; an approver's own limit never counts (`mig:20260925090000_quo_discount_approvals.sql:252-282, 451-453`)                                                                                              | Own threshold, role-limit and price-list changes never exempt the changer's own quotation                                                                                                                                                                                                                                                          | Planned                                                                                                                                                                                                                           | Planned (D8 + D17)            |
| D9       | A return raises a pending credit note (`mig:20260930090000_sal_finance_controls.sql:326-371`) without its own audit record                                                                                                        | Credit-request audit on return; separation of stock receipt and credit                                                                                                                                                                                                                                                                             | Planned                                                                                                                                                                                                                           | Planned (D3 + D9 + D12 + D13) |
| D10      | Invoice and receipt prints only (`apps/web/src/features/billing/components/InvoiceDocument.tsx`); this pull request adds the credit and payment status to the invoice print                                                       | Quotation and credit-note prints; receipt allocations by invoice number; "as of" settlement block                                                                                                                                                                                                                                                  | Planned                                                                                                                                                                                                                           | Planned (D10 + D16)           |
| D11      | Decision channel recorded, evidence optional (`apps/api/src/modules/quotation/application/quotation-decision-service.ts:72`)                                                                                                      | Recording employee, contact and reference on every acceptance                                                                                                                                                                                                                                                                                      | Planned                                                                                                                                                                                                                           | Planned (D5 + D15 + D6 + D11) |
| D12      | Audit is written inside the command transaction; `recordSecurityEvent` exists for authorization denials (`apps/api/src/server/audit/security-events.ts:45`)                                                                       | Business-rule refusals recorded as security events that survive the rollback                                                                                                                                                                                                                                                                       | Planned                                                                                                                                                                                                                           | Planned (D3 + D9 + D12 + D13) |
| D13      | Approval limits exist for discounts only; any holder of the credit permission approves any amount                                                                                                                                 | Credit-approval permissions and limits, split and concurrency protection; approval-limit amounts checked against the minor unit                                                                                                                                                                                                                    | Planned                                                                                                                                                                                                                           | Planned (D3 + D9 + D12 + D13) |
| D14      | `sal.allocate_receipt` compares no payer (`mig:20260930090000_sal_finance_controls.sql:240-293`)                                                                                                                                  | Payer check; explicit third-party payer handling                                                                                                                                                                                                                                                                                                   | Planned                                                                                                                                                                                                                           | Planned (D4 + D14)            |
| D16      | The invoice-and-payment report computes the open receivable at run time (`apps/api/src/modules/reporting/domain/report-datasets.ts:467`)                                                                                          | As-of calculation, preserved period snapshot, restatement marking                                                                                                                                                                                                                                                                                  | Planned                                                                                                                                                                                                                           | Planned (D10 + D16)           |
| D17      | Quotation amounts readable with the quotation read permission (finance review M-08)                                                                                                                                               | Documented inference; API and interface keep invoice, payment, balance, cost, margin and report data behind the finance permission                                                                                                                                                                                                                 | Planned                                                                                                                                                                                                                           | Planned (D8 + D17)            |

## Alternatives Considered

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

No permission, policy, grant on a table or tenancy rule changes. The two helper functions are
`SECURITY INVOKER`, with `EXECUTE` revoked from PUBLIC and granted to `app_runtime` only. The
settlement read sits behind the existing `sal.finance.view` gate of `sal.invoice-outstanding-read`,
and its amounts are read under the same row-level security as the open receivable.

## Operational Impact

The migration writes no row. Applying it to an existing database is a separate, rehearsed step
(backup, rehearsal on a restored copy, forward migration). Its read-only notice reports any draft
quotation line still carrying a sub-minor-unit residue; such a draft is re-priced by a revision.

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
