# Phase 1-11 — Invoice Numbering Contract (P1-OD-042)

**Requirement:** P1-11-DB-003, P1-11-TS-001, RSK-45; open decision **P1-OD-042** (gapless
vs gapped, jurisdiction-dependent P1-OD-007). Owner-authorized technical self-review by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing Technical
Authorization Policy — not an independent third-party review.

## Configuration, not invented policy

`sal.invoice_numbering_configs` is a per-(tenant, company) config row: `mode` CHECK IN
`('gapless','gapped')`, `sequence_code` (`^[a-z][a-z0-9_]{1,62}$`), `status` CHECK IN
`('active','inactive')`, with `uq_invoice_numbering_configs_active` (partial unique
`WHERE status='active'`) — **one active config per company**. The default mode is a
configuration choice, not a schema decision (P1-OD-042 remains open); `mode` documents the
legal posture and both modes use the same allocator.

## Rollback-safe allocator (proven, not assumed)

`sal.issue_invoice` resolves the active config's `sequence_code` (M-fin-2) and allocates the
number by reusing `shared.next_display_number(sequence_code, company, branch)`, which does
`SELECT … FOR UPDATE` on the `shared.number_sequences` row and increments **in the caller's
transaction**. Therefore:

- **Concurrent issues serialize** on the sequence row — a strict sequence, no duplicates.
- **An aborted issue consumes no number** — the increment rolls back with the transaction
  (gapless + rollback-safe). This is proven by **transaction-level tests**
  (`sal-numbering`, `p1-11-rollback`), not assumed.

Number-sequence rows for the `invoice`/`receipt` codes are provisioned at onboarding (not
seeded). Merged migrations are not edited; if the shared allocator ever proved unsafe, a
phase-local issue function using the same sequence rows would be added — the test evidence
decides.

## Number appears only at issue (H-fin-5)

`sal.invoices.invoice_number` is NULL until issue; `ck_invoices_number_iff_issued` enforces
`((invoice_number IS NULL) AND (issued_at IS NULL)) = (status IN ('draft',
'void_before_issue'))` — a number cannot be injected onto a draft to bypass the allocator.
`uq_invoices_number UNIQUE(tenant_id, company_id, branch_id, invoice_number) WHERE
invoice_number IS NOT NULL` guarantees per-scope uniqueness. Receipts follow the same pattern
via `sal.receipts.receipt_number` (`uq_receipts_number`).

**Tests:** `sal-numbering`, `p1-11-rollback`.
