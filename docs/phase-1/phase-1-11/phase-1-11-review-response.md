# Phase 1-11 — Adversarial Design Review Response Ledger

**Phase ID:** P1-11 · **Gate:** [phase-1-11-design.md](phase-1-11-design.md) ·
**Review model:** owner-authorized technical, QA, security, and adversarial self-review
by Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing
Technical Authorization Policy — **not** an independent third-party review.

A round-1 adversarial design gate (ten read-only lenses against the live catalog and the
merged P1-2…P1-10 migrations) surfaced ten findings, all resolved in
[phase-1-11-design.md](phase-1-11-design.md) §17. A **round-2** gate — two independent
reviewers (financial; delivery/warranty/reporting) — then surfaced **1 Critical, 8 High,
12 Medium, 4 Low** against the round-1 design (§19). All are adopted as **binding
amendments** and are implemented in the seven P1-11 migrations. The general-ledger
boundary was confirmed clean. **Every Critical is Fixed; every High is Fixed or Accepted
with rationale; every Medium is Fixed; every Low is Fixed or Accepted with rationale. Zero
unresolved Critical or High remain.**

## Critical

**[C1] Concurrent double custody release.** `rec.guard_custody_transition` read the last
state unlocked, with no released-uniqueness — two concurrent completions could each write
a `released` custody row. **Resolution (Fixed):** an additive-forward migration adds
`uq_custody_history_released` (partial unique on `rec.custody_history(reception_visit_id)
WHERE to_state='released'`) — a hard exactly-once backstop (2nd release → `23505`); plus
the one-live-delivery-per-WO partial unique `uq_delivery_records_work_order_active`; plus
`sal.complete_delivery` locks its own `sal.delivery_records` row `FOR UPDATE` and
re-checks status (idempotent). Same additive-forward pattern as P1-10's `wo` forward FKs.

## High

- **[H-fin-1] Reversal has no derivation hook (silently loses receivable).** **Fixed:**
  full-receipt reversal only (partial reversal out of scope, documented); `receipts.status
→ 'reversed'`; the outstanding-balance derivation **excludes allocations of reversed
  receipts**; `CHECK receipt_reversals.amount = original receipt amount` (enforced in
  `reverse_receipt`/approval under the receipt lock). Allocations stay append-only.
- **[H-fin-2] Write-skew: credit/reversal past gross → open receivable < 0.** **Fixed:**
  one global lock order (receipts by id → invoices by id); `sal.approve_credit_note` and
  every open-receivable consumer take `SELECT … FOR UPDATE` on the invoice row before
  deriving and inserting; credit ≤ derived open under the lock.
- **[H-fin-3] Missing-event: no control forces the event to exist.** **Fixed:** five
  `DEFERRABLE INITIALLY DEFERRED` constraint triggers (`tg_*_event_completeness` on
  invoices/receipts/payment_allocations/credit_notes/receipt_reversals) make completeness
  a commit-time constraint — the matching `sal.financial_events` row must exist in the
  same transaction, else the commit fails.
- **[H-fin-4] Mutable receipt amount tamper.** **Fixed:** `sal.guard_receipt_freeze` —
  once the `receipt_recorded` event exists or `status ≠ 'recorded'`,
  `amount`/`currency_code`/`payment_method_id`/`payer_partner_id`/`received_at` are
  immutable; corrections via reversal only.
- **[H-fin-5] Draft `invoice_number` injection bypasses the allocator.** **Fixed:**
  `CHECK ck_invoices_number_iff_issued` — `((invoice_number IS NULL) AND (issued_at IS
NULL)) = (status IN ('draft','void_before_issue'))` — a number only appears at the
  atomic draft→issued transition through `sal.issue_invoice`.
- **[H-fin-6] Dual-control actors client-supplied → self-approval.** **Fixed:**
  `sal.stamp_dual_control_maker` server-stamps `requested_by := iam.current_user_id()` at
  creation; `sal.guard_dual_control_approval` server-stamps `approved_by :=
iam.current_user_id()` at approval; both immutable, plus `CHECK approved_by <>
requested_by` on `credit_notes` and `receipt_reversals`.
- **[H-dlv-1] Delivery gates bypassable (custody release not gated to the pipeline).**
  **Accepted residual (reclassified to accepted residual during implementation):** the
  delivery gates — verified authorized receiver, mandatory checklist, signature, and
  coherent final odometer — are enforced inside `sal.complete_delivery`, the sanctioned
  delivery path (proven by tests). A rec-forward `BEFORE INSERT` guard on
  `rec.custody_history` requiring a delivered `sal.delivery_records` row was prototyped but
  **removed** (`rec.guard_custody_release_requires_delivery` /
  `tg_custody_history_delivery_gate` no longer exist): it broke the merged,
  independently-valid Phase 1-8 custody state machine (which legitimately releases custody
  without a commercial delivery) and inverted the module dependency (`rec` must not depend
  on `sal`). A raw custody-release INSERT produces no delivery record, warranty, or
  invoice, so it cannot fabricate a completed commercial delivery; it only closes custody,
  which the merged custody chain already governs (accepted → in_workshop → released,
  **exactly once** via the additive `uq_custody_history_released`). **Residual risk:** a
  privileged rec-domain actor could close custody outside the delivery pipeline (an audited
  rec operation), which does not bypass any billing/warranty control. Accepted.
- **[H-priv-1] Base financial amounts are not column-hidden under the single `app_runtime`
  role.** RLS hides rows, not columns. **Fixed:** amounts moved to restricted 1:1 detail
  tables gated by `sal.finance.view` — `sal.invoice_amounts` (net/tax/gross) and
  `sal.invoice_line_amounts` (unit_price/net/tax/gross/customer_pay/warranty_pay); base
  `invoices`/`invoice_lines` rows stay branch-scoped (structural only). The pure-finance
  tables (`receipts`, `payment_allocations`, `credit_notes`, `receipt_reversals`,
  `financial_events`) carry `AND iam.has_permission('sal.finance.view')` in their SELECT
  policy (whole-row financial gating).

## Medium (all Fixed)

- **[M-fin-1] Invoice `status` stores lifecycle only** `{draft,issued,credited,
void_before_issue}`; paid/partially_paid are **derived**, never stored (avoids a 'paid'
  contradicting a reversal-restored balance). Live CHECK `ck_invoices_status` confirms.
- **[M-fin-2] Numbering config.** `sal.issue_invoice` resolves `sequence_code` from the
  active `sal.invoice_numbering_configs` row; single rollback-safe allocator path
  (`shared.next_display_number`); `mode` (`gapless`/`gapped`) documents the legal posture.
- **[M-fin-3] Idempotency short-circuit.** Each primitive resolves idempotency by an
  in-lock pre-check that returns the original row **before** allocating a number or
  emitting an event.
- **[M-fin-4] Currency coherence.** `credit_note.currency = invoice.currency` and
  `receipt_reversal.currency = receipt.currency` (CHECK + composite FK); allocation
  currency matches both sides.
- **[M-fin-5] Cross-branch prevention.** Composite scoped FKs force
  receipt/invoice/allocation to share `(tenant, company, branch)`.
- **[M-dlv-1] Delivery coherence.** `sal.guard_delivery_coherence` enforces
  `delivery.vehicle_id = wo.vehicle_id AND delivery.reception_visit_id =
wo.reception_visit_id`.
- **[M-dlv-2] Authorized-receiver validation.** `sal.guard_authorized_receiver` validates
  the receiver time-aware against an active `rec.reception_party_roles` role for **this**
  visit (or a valid CRM authorized-person for the vehicle at `delivered_at`).
- **[M-wty-1] No overlapping warranty.** Gist `EXCLUDE` (`ex_warranty_records_no_overlap`)
  prevents overlapping live records per vehicle+coverage.
- **[M-wty-2] Warranty binds the delivery.** `odometer_at_issue` binds
  `delivery.final_odometer_reading_id`; `start_date` binds `delivery.delivered_at`.
- **[M-wty-3 / L-fin-2] Warranty split event.** `warranty_split_recorded` source = issued
  invoice, amount = Σ line `warranty_pay_amount`, emitted by `issue_invoice` when > 0,
  single-use per invoice.
- **[M-rpt-1] Saved-filter ownership.** `saved_filters` owner RLS pins `owner_user_id =
iam.current_user_id()` in USING **and** WITH CHECK on every command and forbids
  re-owning (`guard_saved_filter_scope` + immutable `owner_user_id`);
  `report_configurations`/`_versions` are tenant-scoped with explicit RLS.
- **[M-rpt-2] Scope ceiling.** Coarse `scope_level` is DB-enforced
  (`saved_filter.scope_level ≤ report scope_level`); the fine-grained jsonb subset is
  documented app-tier (P1-23).

## Low (all Fixed / Accepted)

- **[L-fin-1] Fixed.** Header reconciliation is never skipped for an issued invoice with
  `gross_total <> 0` (no sum=0 teardown heuristic on financial rows).
- **[L-fin-3] Fixed.** `issue_invoice` recompute and the deferred totals trigger use the
  identical round-then-sum convention (`round(net+tax, 4)`).
- **[L-dlv-1] Fixed.** The mandatory-checklist aggregate is evaluated inside the
  completion lock and checklist results freeze once delivered.
- **[L-dlv-2] Accepted.** Signature-blob ↔ hash verification is a storage-tier concern;
  the DB anchors the immutable `shared.document_versions.sha256`.

## Accepted Medium residuals (documented, deferred)

- Outstanding-balance derivation is `O(n)` per query — incremental caching deferred to the
  P1-22 backend.
- Delivery eligible-state set and numbering default mode remain configuration / open
  contracts (P1-OD-023 / P1-OD-042).
- Full warranty claim adjudication is deferred to P1-22 (P1-OD-024).

## Final red-team (PART S)

A final adversarial red-team pass after the round-2 gate probed raw single-statement SQL
that bypasses the sanctioned functions. It surfaced **3 High (one borderline Critical), 1
Medium, 1 Low**, **all resolved additively** (two new guard functions —
`sal.guard_invoice_amount_frozen`, `wty.guard_warranty_record_coherence` — plus two new
triggers; the rest folded into existing guards). This is a **new** subsection distinct
from the §17/§19 findings.

- **[HIGH-1] (borderline Critical) Raw `UPDATE sal.receipts SET status='reversed'`** could
  unwind a payment with no reversal record, no maker≠approver dual control, and no
  `receipt_reversed` financial event (the open-receivable derivation drops reversed-receipt
  allocations, so a paid invoice silently re-opens). **Fixed:** (a) `sal.guard_receipt_freeze`
  now permits a receipt to reach `reversed` **only** when an **approved**
  `sal.receipt_reversals` row exists for it (i.e. only via `sal.approve_receipt_reversal`);
  (b) `sal.approve_receipt_reversal` reordered to approve the reversal **before** flipping
  the receipt.
- **[HIGH-2] Issued invoice header totals mutable post-issue.**
  `sal.invoice_amounts.net_total`/`tax_total`/`gross_total` were uncovered by the generic
  immutable guard and the reconcile trigger fires only on line-amount DML, letting a finance
  user move the derived open receivable and desync from the frozen lines and the
  `invoice_issued` event. **Fixed:** new `sal.guard_invoice_amount_frozen` + trigger
  `tg_invoice_amounts_frozen` freeze the totals once the parent invoice leaves draft
  (`issue_invoice` writes them while still draft, so it is unaffected).
- **[HIGH-3] Raw INSERT of a born-`issued` invoice** bypassed the gapless
  `shared.next_display_number` allocator **and** the `invoice_issued` completeness event.
  **Fixed:** `sal.guard_invoice_freeze` now also fires **BEFORE INSERT** and requires a new
  invoice to be born `status='draft'` (number/issued status appear only at the draft→issued
  transition inside `sal.issue_invoice`). No new object.
- **[MED / M-wty-2] Raw INSERT into `wty.warranty_records` unbounded** (delivery binding
  lived only inside `wty.issue_warranty`). **Fixed structurally:** new
  `wty.guard_warranty_record_coherence` + trigger `tg_warranty_records_coherence` (BEFORE
  INSERT) require the referenced delivery to be `status='delivered'` with matching
  `vehicle_id`/`work_order_id`. **Accepted residual [M-wty-2b]:** the finer
  `odometer_at_issue`/`start_date` **value** binding stays enforced only inside
  `wty.issue_warranty` — claim adjudication is out of P1-11 scope, and binding exact values
  at the constraint layer would replicate the issue derivation and fix warranty policy the
  phase deliberately leaves open (parallel to the accepted H-dlv-1 residual).
- **[LOW / L-fin-4] Line-amount denormalized `invoice_id` could differ from its parent
  line's `invoice_id`.** **Fixed:** folded a coherence check into the existing
  `sal.guard_invoice_line_amount_frozen` (raises `23503` if the line does not belong to the
  claimed invoice). No new object.

Every Critical/High is Fixed; the Medium is Fixed structurally with M-wty-2b an accepted
documented residual; the Low is Fixed. **Zero unresolved Critical or High remain.**

## Outcome

Zero unresolved Critical or High. The gate is passed.
