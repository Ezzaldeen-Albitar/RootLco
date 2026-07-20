# P1-12 Backend Database Contract Index — Release 2

**Company:** RootLco — Root Link Company · **Release:** Release 2 — Core Business Database ·
**Phase:** P1-12 · **Base:** protected `origin/develop` = `5cd16da` ·
**Schema hash:** `d3b1e7e40a141152f8aff04cf582c02cffa43f8709adad936450c8019d3e4cdb`.

**Governance / self-review note.** This index is a **documentation deliverable** of an
owner-authorized **self-review** by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review
Policy and Standing Technical Authorization Policy — **not** an independent third-party audit.
It **documents** the database primitives and contracts that the P1-13+ backend group will build
on. **No backend, API, controller, repository, or business logic is implemented in P1-12** — the
scope boundary is verified (no backend/API/frontend created; `main` untouched).

## Purpose

The Release 2 database is the frozen substrate under Release 3+ backend work. This index points
each downstream backend area to the schema surface and the guaranteed primitives it depends on,
plus the already-authored contract documents that specify the intended backend behavior. Nothing
here is executable code; it is the contract map.

## Contract surface by domain

### Identity, context & authorization (`iam`, 17 tables)

- **Context & permission functions** — `iam` context/permission functions
  (migration `20260718097000_iam_context_and_permission_functions.sql`) are the entry point for
  establishing tenant/branch/role context; all 585 RLS policies resolve against them. Backend
  session setup builds on these.
- **Append-only audit primitives** — `iam.audit_append` (per-tenant SHA-256 chain) and
  `iam.audit_verify_chain` (tamper / gap / concurrent-fork detection). `iam.audit_records` is
  `SELECT`-only for app roles; no runtime DELETE grant.
- **Guarantee:** every module function is `SECURITY INVOKER` + `search_path=''` + REVOKE PUBLIC;
  0 `SECURITY DEFINER`.

### Financial source-fact primitives (`sal`, 19 tables)

- **Immutable source-fact boundary** — `sal` financial events are the immutable provenance record
  (`invoice_issued`, `receipt_recorded`, `payment_allocated`, one each per reconciled flow). This
  is the **source-fact boundary**: there is **no general ledger / journal / journal-line /
  chart-of-accounts / accounting-period / posting-rule** — that is a deliberate boundary, not a gap.
- **Primitives backend consumes:** invoice issue (idempotent), receipt recording, payment
  allocation, outstanding-balance derivation (open receivable = issued − allocated).
- **Contracts:** `phase-1-11-financial-event-provenance-contract.md`,
  `phase-1-11-financial-event-catalogue.md`, `phase-1-11-invoice-issue-idempotency-contract.md`,
  `phase-1-11-invoice-identity-contract.md`, `phase-1-11-invoice-numbering-contract.md`,
  `phase-1-11-receipt-contract.md`, `phase-1-11-receipt-reversal-contract.md`,
  `phase-1-11-outstanding-balance-derivation-contract.md`,
  `phase-1-11-financial-precision-currency-contract.md`,
  `phase-1-11-no-general-ledger-boundary.md`, `phase-1-11-p1-22-backend-contract.md`.

### Custody & reception (`rec`, 23 tables)

- **Atomic custody primitives** — `rec.accept_check_in` (atomic reception + custody accept),
  `rec.authorization_custody`, and `rec.custody_history` (custody released exactly once, verified
  in the integrated E2E). Backend delivery/hand-back builds on custody release.
- **Contracts:** `phase-1-11-custody-closure-contract.md`,
  `phase-1-11-delivery-eligibility-contract.md`, `phase-1-11-delivery-checklist-contract.md`,
  `phase-1-11-delivery-signature-evidence-contract.md`,
  `phase-1-11-authorized-receiver-contract.md`.

### Warranty (`wty`, 5 tables)

- **Primitive:** `wty.issue_warranty` + the coherence guard `tg_warranty_records_coherence`
  (requires a `delivered` delivery matching `vehicle_id` / `work_order_id`).
- **Contracts:** `phase-1-11-warranty-record-contract.md`,
  `phase-1-11-warranty-eligibility-contract.md`,
  `phase-1-11-warranty-policy-version-contract.md`. Carries residual **M-wty-2b** (see waiver register).

### Reporting & export (`rpt`, 3 tables)

- **Export-permission contract** — the backend export-permission gate is **documented, not
  implemented** (`export-permission-contract.md`); reporting reads must resolve export permission
  before emitting personal data.
- **Contracts:** `phase-1-11-reporting-configuration-contract.md`,
  `phase-1-11-saved-filter-ownership-contract.md`,
  `phase-1-11-p1-23-reporting-backend-contract.md`,
  `phase-1-11-p1-30-31-frontend-data-contract.md`.

### Shared cross-domain primitives (`shared`, 29 tables)

Reused by every domain; backend must not re-implement:

- `shared.next_display_number` — gap-tolerant per-scope human-facing numbering.
- `shared.idempotency_keys` — request idempotency for issue/receipt/allocation flows.
- `shared.status_history` (+ `shared.status_evidence`) — canonical state-transition ledger.
- `shared.document_versions` — versioned document/evidence storage.
- `veh.odometer_readings` — canonical odometer source (warranty / service reference).

## Integration gate contract

`phase-1-11-p1-12-integration-gate-contract.md` specifies the forward-FK bindings validated in
the P1-12 integrated E2E (`svc → inv → veh → rec → wo → quo → sal → delivery → wty`), including
the `quo → sal` forward FK (invoice bound to a quotation revision). All bindings verified passing.

## Boundary statement (verified)

P1-12 documents these contracts; it implements **none** of them. No backend/API/controller/
repository/business-logic, no frontend, no general ledger, no payment gateway, no
subscription billing, no procurement were created. `origin/main` (`286d482`) is untouched by this
task.

## Status

**COMPLETE (documented, not implemented).** The downstream backend contract surface for P1-13+ is
indexed against the frozen Release 2 schema. Implementation is out of P1-12 scope by design.
