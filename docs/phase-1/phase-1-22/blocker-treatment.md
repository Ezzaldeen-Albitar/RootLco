# P1-22 — treatment of the ten surviving blocker gaps

**Source:** `contract-archaeology.md` §0. Ten blocker-severity gaps survived
independent refutation — each was attacked by a separate agent instructed to
disprove it, and each attempt is recorded with the searches it performed.

Every one of the ten is classified below into exactly one treatment. None is left
undocumented, and none is closed by asserting that it is not a problem.

The six permitted treatments are: **application composition**, **controlled
configuration error**, **runbook/provisioning requirement**, **phase limitation**,
**future-scope deferral**, and **protected-contract mitigation**.

## The ten

| ID   | Gap                                                                                       | Treatment                                                                 | Where it is discharged                                                                                        |
| ---- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| SB1  | Credit-note ↔ invoice and reversal ↔ receipt currency equality is enforced by **nothing** | **Protected-contract mitigation** + application composition               | `assertCurrencyMatches` in `src/modules/billing/domain/billing.ts`; abuse-case test; `P1-22-L-02`             |
| SB2  | No warranty-claim table exists in any schema                                              | **Future-scope deferral**                                                 | `P1-22-L-01`; no claim route, method, type or field exists                                                    |
| SB3  | No invoice/receipt number sequence is seeded, and `app_runtime` cannot create one         | **Controlled configuration error** + **runbook/provisioning requirement** | `P0002` → `ERR-RES-001` naming `(company, branch, sequence_code)`; `number-sequence-runbook.md`; `P1-22-L-03` |
| SB4  | No refund, partial reversal, multi-invoice credit, progress billing or ledger posting     | **Phase limitation**                                                      | `P1-22-L-05`; matches the phase's own stated exclusions                                                       |
| SB5  | No warranty-claim permission exists                                                       | **Future-scope deferral**                                                 | Same as SB2. `wty` has exactly two permissions: `wty.policy.manage`, `wty.warranty.issue`                     |
| SB6  | No warranty-claim event type or audit action exists                                       | **Future-scope deferral**                                                 | Same as SB2. No claim name is even _reserved_ in `EVENT_CATALOG`                                              |
| SB7  | The operation coverage gate has **no `sal`/`wty` hook**, in two independent places        | **Application composition** — the gate itself was repaired first          | Commit `a22c666`; four hooks extended, each mutation-tested separately                                        |
| SB8  | `wty` contains **zero monetary columns of any kind**                                      | **Future-scope deferral**                                                 | Same as SB2. A claim's reimbursement has nowhere to be stored                                                 |
| SB9  | `'claimed_against'` exists in two CHECK vocabularies with nothing behind it               | **Future-scope deferral** + protected-contract mitigation                 | Vocabulary transcribed **complete**; `assertWritableStatus` refuses to write it                               |
| SB10 | A delivery signature can be **bound but never downloaded**                                | **Phase limitation**                                                      | `P1-22-L-04`; no signature-retrieval endpoint is shipped                                                      |

## Why five of the ten are one finding, and why that is not a way of avoiding five

SB2, SB5, SB6, SB8 and SB9 are the same absence measured through five different
lenses: no table, no permission, no event or audit action, no monetary column, and
one orphaned status literal. Counting them once would have hidden the fact that the
absence is **total** — it is not that a claim table is missing and everything else
is ready, it is that nothing anywhere in 119 migrations supports a claim.

That totality is what makes the deferral honest rather than convenient. If four of
the five had been present, "defer it" would have meant leaving a half-built
subsystem. Because all five are absent, building any of them would require
migration 120, which this phase forbids.

**The one thing this deferral is not.** It is not a claim that P1-11 was wrong to
anticipate adjudication. P1-11's forward contract assigns "full warranty claim
adjudication (P1-OD-024)" to P1-22 in five separate documents. The P1-22 mandate
says `warranty generation`. Both are real instructions and they disagree; the
disagreement is resolved in favour of the phase scope, and it is recorded as a
conflict rather than as an omission. Had the mandate required adjudication, this
would have been a §28.1 stopping condition — a mandatory requirement needing
migration 120. It does not, so it is not.

## The two that produce runtime behaviour rather than a document

**SB3** is the only gap that a correctly-implemented backend can still fail on in
production, so it gets both a code path and an operator procedure. The code path
refuses to guess: `shared.next_display_number` raises `no_data_found` (`P0002`) when
no sequence row exists for the scope, `app_runtime` holds no `INSERT` grant and no
`INSERT` policy on `shared.number_sequences`, and the backend therefore **cannot**
self-heal. What it must not do is substitute a timestamp, a UUID, or a
`COALESCE`-style default — any of those would put a number on a legal document that
the sequence does not know about. See `number-sequence-runbook.md`.

**SB1** is the only gap where the application is the sole enforcement of a rule the
handoff prose claims the database keeps. P1-11's precision contract states currency
coherence "is enforced (M-fin-4)". Measured against the DDL it is not: five
triggers fire on `sal.credit_notes` and none reads `sal.invoices.currency_code`, and
`sal.approve_credit_note` compares the amount but never the currency. A JOD credit
note against a USD invoice is accepted, approved, and subtracted from the USD gross
by `sal.invoice_open_receivable`, which has no currency predicate either.

The mitigation is application-level and is deliberately paired with an **abuse-case
test that proves the database still accepts the mismatch**. That test exists so the
residual stays visible: a reader who sees only the passing application test could
conclude the hole was closed, and it was not. Recorded as `P1-22-L-02` and as a
protected-contract change-control candidate — the fix is a migration, and no
migration is authorised in this phase.

## Change-control candidates this phase raises and does not act on

Each would need a migration, so each is recorded for a future DBCR rather than
implemented:

| Candidate | What it would add                                                                                                          |
| --------- | -------------------------------------------------------------------------------------------------------------------------- |
| CC-1      | A trigger on `sal.credit_notes` comparing `currency_code` to the parent invoice's (SB1)                                    |
| CC-2      | A trigger on `sal.receipt_reversals` comparing `currency_code` to the original receipt's (SB1)                             |
| CC-3      | A currency-partitioned replacement for `sal.partner_outstanding_balance`, or its removal (P1-22-L-06)                      |
| CC-4      | A bound on `Σ sal.payment_allocations` per receipt and per invoice, so the primitive is not the only defence of BR-SAL-002 |
| CC-5      | An `INSERT` path for `shared.number_sequences` usable by an operator tool rather than by hand (SB3)                        |
| CC-6      | A policy-status check inside `wty.issue_warranty`, which today reads only the coverage status                              |
| CC-7      | A tax-class / tax-rate administration operation, so `org.tax_classes` can be populated at all (`P1-22-L-08`)               |
| CC-8      | A permission predicate on `shared.event_outbox`'s SELECT policy, so payload discipline is not the only control             |

CC-4 deserves a note. `app_runtime` holds raw `INSERT` on `sal.payment_allocations`
and no constraint, trigger or exclusion bounds the sum — over-allocation is
prevented **only inside `sal.allocate_receipt`**. P1-22 makes routing through the
primitive an invariant enforced at the repository layer, and a test asserts the
repository contains no `INSERT INTO sal.payment_allocations`. That is a real
defence of this phase's code and it is **not** a defence of the table: any future
module with the same grant could bypass it. The database-level bound is the only
durable fix.

---

## Found during implementation, not during archaeology

The nine lenses were read-only. Three of the phase's most consequential findings could
only appear once code existed, and all three are recorded here because a findings document
that stopped at the archaeology would understate what the phase actually learned.

### High 1 — the blind zero

`sal.invoice_open_receivable` is `SECURITY INVOKER` and **all three of its inputs are
gated by `sal.finance.view`** (`sel_invoice_amounts_gated`, `sel_receipts_gated` /
`sel_payment_allocations_gated`, `sel_credit_notes_gated`). A caller without that
permission gets no error: the rows are invisible, so the function computes
`round(COALESCE(NULL,0) − 0 − 0, 4)` and returns **`0`**, which is byte-identical to a
fully settled invoice.

Composed into the delivery gate — the one gate with no database backstop — that waves
through an operator who may see invoices but not money. Reproduced in
`tests/db/p1-22-protected-residuals.test.ts` as a fifth residual: `100.0000` with the
permission and `0.0000` without, same invoice, same transaction.

**Treatment: application composition.** `balanceIsTrustworthy()` distinguishes invisible
from absent, structurally: an issued invoice ALWAYS has an amounts row, because
`guard_invoice_totals_reconcile` raises at COMMIT for a non-draft invoice without one — so
a NULL can only mean "you cannot see it". Both routes that read a balance additionally
require the permission.

### High 2 — `sal.delivery.view` was declared by no operation

It gates SELECT on `sal.authorized_receivers` and `sal.delivery_signatures`, and
`sal.complete_delivery` — `SECURITY INVOKER` — reads both. A caller holding exactly what
`sal.delivery-complete` declared made those `EXISTS` checks see zero rows, so the primitive
raised `check_violation` reporting "no authorized receiver" for a delivery whose receiver
was verified and whose signature was on file. **Vehicle delivery was unreachable.**

**Treatment: application composition.** Four operations now declare it. Caught by the task
gate's "is every seeded permission declared by some operation?" reconciliation — a check
that looks like paperwork and was the only thing in the repository that would have noticed.

### High 3 — `versionGuarded: true` declared and never enforced

Three routes declared it, so `handleOperation` demanded an `If-Match` header and handed the
parsed value to the handler — and all three discarded it. Reproduced as `If-Match: 99`
against `record_version` 1: 200, issued, number allocated.

`sal.delivery-complete` had it in the more instructive shape: its service check **existed
and was inert**, because the field is optional and the route never supplied it. A guard can
be present, correct, and dead.

**Treatment: application composition.** All three compare against the row they have just
locked `FOR UPDATE`, after the lock and before any state logic.

**Why it was caught:** two suite authors reproduced it independently, left the cases FAILING
with `DEFECT` comments, and refused to declare `stale-version`. The coverage gate then named
exactly two missing flags. Had either declared the flag to make the gate green, the defect
would have shipped behind a passing gate.

### Two limitations the archaeology could not have predicted

| ID         | Limitation                                                   | Why it cannot close in P1-22                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1-22-L-07 | The invoice **warranty payer split is always customer-100%** | No protected configuration determines a warranty contribution at invoice time. `wty.warranty_records` are generated **from** a committed delivery, i.e. after invoicing; there is no coverage reference on a work order, job, service line or quotation item, and no claim table. A non-zero share could only come from client input — which would let a caller reduce what a customer owes by asserting it. |

`ck_invoice_line_amounts_payer_split` is satisfied exactly and by construction
(`customer = gross − warranty`, computed in SQL), so the constraint is honoured; the
warranty side is simply always `0.0000`. The consequence is recorded rather than hidden:
**`sal.issue_invoice` emits no `warranty_split_recorded` financial event today**, and
`NO_WARRANTY_SHARE` in `invoice-service.ts` is the single place that changes when a
coverage source exists.

### `P1-22-L-08` — every invoice this API can produce is untaxed

| ID         | Limitation                                | Why it cannot close in P1-22                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-22-L-08 | **The reachable tax rate is always zero** | `quo.quotation_items.captured_tax_rate` is `NOT NULL DEFAULT 0`. Its only writer is P1-20's quotation service, which copies `resolvePrice`, which returns `Decimal.zero(TAX_RATE)` whenever `svc.price_rules.tax_class_id` is `null`. That column can only reference `org.tax_classes` — **0 rows**, no seed, and no writer anywhere in `src/` — so the FK makes any non-null value unsettable and the null branch is the only reachable one. |

This is recorded because an earlier revision of this phase **asserted the opposite**, in a
route docstring and in the coverage note for `sal.invoice-preview`: _"a missing tax
configuration is a controlled configuration error — never a silent zero, which would
under-bill by exactly the tax and look like a correct answer"_. That refusal is real
(`price-resolution-service.ts`), but it fires only for a **half**-configured rule — a named
tax class with no effective rate. The wholly unconfigured case, which is the only case that
exists, returns zero and says nothing.

P1-22's own behaviour is correct and unchanged: it bills the captured rate exactly and
invents nothing. Inventing a jurisdiction default here is precisely what §9 forbids. What
belonged to this phase was not claiming the gap was closed, and both statements have been
replaced with the fact. The mechanism is upstream — P1-11's default, P1-20's resolver, and
the absent org-configuration surface — so closing it needs a tax-class admin operation,
which is a new phase's scope and is raised as `CC-7`.

### One mutation that cannot be killed, and why that is a finding rather than a gap

`M-22-06` originally deleted the call to `assertDeliveryDelivered` and the warranty suite
still passed. That is not a weak test — the mutation is **unobservable**.
`ck_delivery_records_delivered_shape` is
`(status = 'delivered') = (delivered_at IS NOT NULL AND final_odometer_reading_id IS NOT NULL)`,
so for any real row `status <> 'delivered'` implies `delivered_at IS NULL`, and the very
next guard in the same method refuses a null `deliveredAt` with the **same**
`ERR-TRN-001`. The two conditions are equivalent on real data and produce an identical HTTP
response; `problemFor` never emits a message, so nothing over the API surface can tell
which fired.

The mutation was therefore retargeted at the property that IS pinnable — that the
comparison is the right way round — and inverting it fails 10 tests.
