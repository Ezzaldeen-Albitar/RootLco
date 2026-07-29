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

CC-4 deserves a note. `app_runtime` holds raw `INSERT` on `sal.payment_allocations`
and no constraint, trigger or exclusion bounds the sum — over-allocation is
prevented **only inside `sal.allocate_receipt`**. P1-22 makes routing through the
primitive an invariant enforced at the repository layer, and a test asserts the
repository contains no `INSERT INTO sal.payment_allocations`. That is a real
defence of this phase's code and it is **not** a defence of the table: any future
module with the same grant could bypass it. The database-level bound is the only
durable fix.
