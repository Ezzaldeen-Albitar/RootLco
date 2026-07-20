# Phase 1-11 — Issue / Receipt / Reversal Idempotency Contract

**Requirement:** BR-SAL-001 (issue/receipt/reversal require an Idempotency-Key), NFR-AVL-002,
P1-11-DB-010, TC-P1-11-002. Owner-authorized technical self-review by Eng. Ezzaldeen Al-Bitar
under the Solo Developer Review Policy and the Standing Technical Authorization Policy — not
an independent third-party review.

## DB-level business keys complement the Phase 1-4 store

The Phase 1-4 `shared.idempotency_keys` store handles request-level replay at the API. P1-11
adds the **data-layer** unique business constraints that make a replay safe even if it
reaches the database:

| Command               | Table                   | Constraint                                                     |
| --------------------- | ----------------------- | -------------------------------------------------------------- |
| Issue an invoice      | `sal.invoices`          | `uq_invoices_idempotency (tenant_id, idempotency_key)` partial |
| Record a receipt      | `sal.receipts`          | `uq_receipts_idempotency` partial                              |
| Request a credit note | `sal.credit_notes`      | `uq_credit_notes_idempotency` partial                          |
| Reverse a receipt     | `sal.receipt_reversals` | `uq_receipt_reversals_idempotency` partial                     |
| Complete a delivery   | `sal.delivery_records`  | `uq_delivery_records_idempotency` partial                      |
| Issue a warranty      | `wty.warranty_records`  | `uq_warranty_records_idempotency` partial                      |

Each is `UNIQUE(tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL`. The
single-use financial-event key (`uq_financial_events_source`) adds a second layer so a
replayed command cannot emit a second event.

## In-lock short-circuit (M-fin-3)

Every primitive resolves idempotency by an **in-lock pre-check that returns the original row
before** allocating a number or emitting an event. A replayed issue/receipt/reversal
therefore produces **zero duplicate rows and zero duplicate events** — the primitive returns
the original result rather than raising a raw `23505` to the caller. A genuine second
distinct command (different key) proceeds normally.

## Guarantee

For any command carrying an Idempotency-Key, at most one invoice/receipt/credit/reversal/
delivery/warranty row and at most one matching `financial_events` row exist, regardless of
retries or concurrency.

**Tests:** `sal-idempotency` (TC-P1-11-002).
