# P1-22 operation inventory

**Phase:** P1-22 — Billing, Payment, Delivery, and Warranty Backend
**Derived from:** `contract-archaeology.md` (240 findings, 124 gaps, 10 blockers) and the
18 backend tasks — **not** from the seven illustrative routes in the phase plan.

Twenty operations across four modules. Every row is reconciled against the frozen
Phase 1-11 DDL: the permission strings are the ten `sal.*` and two `wty.*` codes
that exist in `supabase/seeds/04_iam_permission_catalog.sql` and nothing else, and
every mutation that has a protected primitive goes through it rather than around
it.

## Why twenty and not seven

§6 names sixteen capabilities that must exist. Fifteen map one-to-one onto an
operation below; credit-note foundation needs two (request and dual-control
approval, because `sal.guard_dual_control_approval` requires a different approver
and a single endpoint could not satisfy it). Four more exist because the sixteen
are unreachable without them:

| Added                          | Why it is not decorative                                                                                                                                                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sal.delivery-create`          | Eligibility, receiver, checklist and signature are all subresources of a delivery record. Without a way to create one, six operations are unreachable.                                       |
| `sal.payment-method-list`      | `sal.record_receipt` takes a `payment_method_id`. Without a way to discover the three seeded platform methods, payment recording cannot be called at all.                                    |
| `sal.invoice-outstanding-read` | §6 requires outstanding balance as its own capability, and it must never be folded into the invoice detail body — the amount tables are gated by `sal.finance.view` while the header is not. |
| `sal.credit-note-approve`      | See above — dual control is structural, not stylistic.                                                                                                                                       |

Deliberately **absent**, each for a recorded reason:

- **No warranty-claim operation of any shape.** `P1-22-L-01`. There is no claim
  table in 119 migrations; the whole trace of a claim is the string
  `'claimed_against'` in two CHECK vocabularies. No route is named or shaped as if
  a claim were persistable.
- **No signature retrieval.** `P1-22-L-04`. `shared.document_versions` can only be
  downloaded in `'accepted'` state and no application path can produce acceptance,
  so a retrieval endpoint would fail with `ERR-DOC-001` on every call. Shipping an
  endpoint that always fails is worse than not shipping it.
- **No receipt reversal.** `P1-22-L-05`. `sal.receipt_reversals` is
  full-receipt-only and terminal; partial reversal and refund are structurally
  absent and out of scope. `sal.approve_receipt_reversal` is left unexposed.
- **No partner outstanding balance.** `P1-22-L-06`.
  `sal.partner_outstanding_balance` loops a partner's issued invoices with **no
  currency filter** and returns one unlabelled scalar. Exposing it would publish
  exactly the unlabelled cross-currency aggregate §4 forbids.
- **No invoice line mutation after issue.** Structurally impossible:
  `sal.guard_invoice_line_frozen` refuses any write whose parent is not `draft`.

## The twenty

Scope is `branch` everywhere except `sal.payment-method-list`, because
`sal.payment_methods` has no `company_id` or `branch_id` column at all — the
platform rows are tenant-visible reference data. Every other table in `sal` and
`wty` that these operations touch carries all three scope columns, and its RLS
policy narrows by `iam.allowed_company_ids()` and `iam.allowed_branch_ids()`.

### billing — `sal.` (8)

| #   | operationId                    | method | path                                         | permission                               | scope  | idem | vg  | auditClass / auditAction                | event                |
| --- | ------------------------------ | ------ | -------------------------------------------- | ---------------------------------------- | ------ | ---- | --- | --------------------------------------- | -------------------- |
| 1   | `sal.invoice-preview`          | GET    | `/work-orders/{workOrderId}/invoice-preview` | `sal.invoice.manage`, `sal.finance.view` | branch |      |     | none                                    |                      |
| 2   | `sal.invoice-create`           | POST   | `/invoices`                                  | `sal.invoice.manage`, `sal.finance.view` | branch | ✔    |     | financial / `sal.invoice.created`       | `invoice.created`    |
| 3   | `sal.invoice-issue`            | POST   | `/invoices/{invoiceId}/issuance`             | `sal.invoice.issue`, `sal.finance.view`  | branch | ✔    | ✔   | financial / `sal.invoice.issued`        | `invoice.issued`     |
| 4   | `sal.invoice-detail`           | GET    | `/invoices/{invoiceId}`                      | `sal.invoice.manage`                     | branch |      |     | none                                    |                      |
| 5   | `sal.invoice-outstanding-read` | GET    | `/invoices/{invoiceId}/outstanding`          | `sal.finance.view`                       | branch |      |     | none                                    |                      |
| 6   | `sal.invoice-cancel`           | POST   | `/invoices/{invoiceId}/cancellation`         | `sal.invoice.manage`                     | branch | ✔    | ✔   | financial / `sal.invoice.voided`        | `invoice.voided`     |
| 7   | `sal.credit-note-create`       | POST   | `/invoices/{invoiceId}/credit-notes`         | `sal.credit.manage`, `sal.finance.view`  | branch | ✔    |     | financial / `sal.credit_note.requested` |                      |
| 8   | `sal.credit-note-approve`      | POST   | `/credit-notes/{creditNoteId}/approval`      | `sal.credit.manage`, `sal.finance.view`  | branch | ✔    |     | approval / `sal.credit_note.approved`   | `credit-note.issued` |

`sal.invoice-detail` deliberately does **not** require `sal.finance.view`: §3 of the
archaeology recorded that a caller lacking it must receive an invoice header
_without money_, not a 403 on the whole resource. The money sub-object is omitted
when the amount rows are invisible, which is what the RLS policy already does.

### payments — `sal.` (4)

| #   | operationId               | method | path                                | permission                                 | scope  | idem | vg  | auditClass / auditAction            | event               |
| --- | ------------------------- | ------ | ----------------------------------- | ------------------------------------------ | ------ | ---- | --- | ----------------------------------- | ------------------- |
| 9   | `sal.payment-record`      | POST   | `/payments`                         | `sal.payment.record`, `sal.finance.view`   | branch | ✔    |     | financial / `sal.receipt.recorded`  | `receipt.recorded`  |
| 10  | `sal.payment-allocate`    | POST   | `/payments/{paymentId}/allocations` | `sal.payment.allocate`, `sal.finance.view` | branch | ✔    |     | financial / `sal.payment.allocated` | `payment.allocated` |
| 11  | `sal.receipt-detail`      | GET    | `/payments/{paymentId}`             | `sal.finance.view`                         | branch |      |     | none                                |                     |
| 12  | `sal.payment-method-list` | GET    | `/payment-methods`                  | `sal.payment.record`                       | tenant |      |     | none                                |                     |

`sal.receipt-detail` requires `sal.finance.view` where `sal.invoice-detail` does
not, and the asymmetry is the schema's: `sal.receipts` is gated **whole-row** by
that permission on SELECT, so a caller without it sees zero receipts rather than a
redacted one. There is no honest "receipt without amounts" projection to build.

### delivery — `sal.` (6)

| #   | operationId                     | method | path                                           | permission                                  | scope  | idem | vg  | auditClass / auditAction                       | event               |
| --- | ------------------------------- | ------ | ---------------------------------------------- | ------------------------------------------- | ------ | ---- | --- | ---------------------------------------------- | ------------------- |
| 13  | `sal.delivery-create`           | POST   | `/deliveries`                                  | `sal.delivery.manage`                       | branch | ✔    |     | privileged / `sal.delivery.created`            |                     |
| 14  | `sal.delivery-eligibility-read` | GET    | `/deliveries/{deliveryId}/eligibility`         | `sal.delivery.manage`, `sal.finance.view`   | branch |      |     | none                                           |                     |
| 15  | `sal.delivery-receiver-verify`  | POST   | `/deliveries/{deliveryId}/authorized-receiver` | `sal.delivery.manage`                       | branch | ✔    |     | privileged / `sal.delivery.receiver_verified`  |                     |
| 16  | `sal.delivery-checklist-record` | POST   | `/deliveries/{deliveryId}/checklist-results`   | `sal.delivery.manage`                       | branch | ✔    |     | privileged / `sal.delivery.checklist_recorded` |                     |
| 17  | `sal.delivery-signature-attach` | POST   | `/deliveries/{deliveryId}/signatures`          | `sal.delivery.manage`                       | branch | ✔    |     | privileged / `sal.delivery.signature_recorded` |                     |
| 18  | `sal.delivery-complete`         | POST   | `/deliveries/{deliveryId}/completion`          | `sal.delivery.complete`, `sal.finance.view` | branch | ✔    | ✔   | privileged / `sal.delivery.completed`          | `vehicle.delivered` |

`sal.delivery-eligibility-read` and `sal.delivery-complete` both require
`sal.finance.view` **in addition** to their delivery authority, and that is not
belt-and-braces: the financial blocker is composed from
`sal.invoice_open_receivable`, whose inputs live behind that permission. A caller
who could complete a delivery without it would be waved through the balance check
by an RLS-invisible zero — the blocker would read "nothing outstanding" because it
could not see the invoice, which is the most dangerous possible failure mode for
this operation. Requiring the permission makes the check honest rather than
vacuous.

### warranty — `wty.` (2)

| #   | operationId             | method | path                                  | permission           | scope  | idem | vg  | auditClass / auditAction           | event             |
| --- | ----------------------- | ------ | ------------------------------------- | -------------------- | ------ | ---- | --- | ---------------------------------- | ----------------- |
| 19  | `wty.warranty-generate` | POST   | `/deliveries/{deliveryId}/warranties` | `wty.warranty.issue` | branch | ✔    |     | privileged / `wty.warranty.issued` | `warranty.issued` |
| 20  | `wty.warranty-detail`   | GET    | `/warranties/{warrantyId}`            | `wty.warranty.issue` | branch |      |     | none                               |                   |

`wty.warranty-detail` reuses `wty.warranty.issue` because the permission catalogue
contains no `wty.warranty.read`. Inventing one would need a seed change outside
this phase's authority, and borrowing `wty.policy.manage` would be worse — it
grants coverage administration to a caller who only needs to read a record.

## Protected primitives each operation routes through

No operation reimplements a protected function, and three of them exist only to
call one safely.

| Operation                 | Primitive                                          | What the application adds                                                                                                                         |
| ------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sal.invoice-issue`       | `sal.issue_invoice(uuid, uuid)`                    | `P0002` → controlled configuration error naming `(company, branch, sequence_code)`; provisioning pre-check                                        |
| `sal.payment-record`      | `sal.record_receipt(...)`                          | currency/method validation; exact amount at the boundary                                                                                          |
| `sal.payment-allocate`    | `sal.allocate_receipt(uuid, uuid, numeric, uuid)`  | **never a raw INSERT** — over-allocation is prevented only inside this function while `app_runtime` holds raw INSERT on `sal.payment_allocations` |
| `sal.credit-note-approve` | `sal.approve_credit_note(uuid, uuid)`              | currency equality against the parent invoice, which the DDL does not enforce (SB1)                                                                |
| `sal.delivery-complete`   | `sal.complete_delivery(uuid, numeric, text, uuid)` | the **financial blocker**, which the primitive does not check at all                                                                              |
| `wty.warranty-generate`   | `wty.issue_warranty(uuid, uuid, uuid, text)`       | delivery-committed precondition; policy resolution                                                                                                |

## Currency coherence — what the application must enforce because nothing else does

SB1, reproduced against the live DDL. Each row is an application invariant with a
test, and an abuse-case test proves the database still accepts the mismatch, so
the residual stays visible rather than being assumed closed.

| Invariant                                  | Enforced by the DB?                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| credit note currency = invoice currency    | **No.** Five triggers on `sal.credit_notes`, none reads `sal.invoices.currency_code`; `sal.approve_credit_note` compares amount but never currency.                                               |
| allocation currency = receipt = invoice    | Only inside `sal.allocate_receipt` — which is why every allocation must go through it.                                                                                                            |
| invoice line currency = header currency    | Yes — `sal.guard_invoice_line_frozen`. The one place coherence is real.                                                                                                                           |
| outstanding balance never mixes currencies | **No.** `sal.invoice_open_receivable` has no currency predicate; it is single-invoice so the header currency labels it. `sal.partner_outstanding_balance` does mix, and is therefore not exposed. |

Every money value crosses the API as `{ amount: string, currency: string }` via
`moneyView` from `@/modules/pricing`. No aggregate is ever returned without its
currency beside it.

## Arithmetic

Sums are computed by **PostgreSQL in `numeric`**, never in TypeScript. That is not
caution, it is the repository's own recorded decision: `Money` in
`@/modules/pricing` deliberately has no `add` or `multiply` because "the
authoritative sums and products are computed by PostgreSQL in `numeric`, and
offering them here would create a second, weaker engine that could disagree with
the CHECK constraints." P1-22 keeps that single engine — including for the
invoice preview, which is a read-only `SELECT` whose arithmetic is the same
`round(… , 4)` shape `ck_invoice_amounts_gross` enforces and `sal.issue_invoice`
later applies.

`Decimal` and `Money` are used for what they are for: parsing and validating
client input against `numeric(18,4)`, comparing without materialising a double,
and serializing deterministically. Two validators, not one, per §2 of the
archaeology: `parseNonNegative` for invoice/line/event amounts (**a zero-total
issued invoice is legal**) and `parsePositive` for receipts, allocations, credit
notes and reversals.

## Evidence obligations, derived not declared

With both coverage-gate hooks repaired (commit `a22c666`), every row above derives
its own floor from its registration: `route`, `service`, `success`,
`authorization`, plus `cross-tenant` for a path parameter, `isolation` for branch
scope, `audit` for a non-`none` class, `idempotency` for `idempotent: true`, and
`stale-version` for `versionGuarded: true`. The manifest can only add to that —
`outbox` and `denial` are declared on top. Nothing here can be weakened by editing
the manifest, which was the whole point of repairing the gate before writing this
inventory.
