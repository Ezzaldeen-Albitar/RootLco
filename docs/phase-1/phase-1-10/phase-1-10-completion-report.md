# Phase 1-10 — Completion Report

**Phase ID:** P1-10 · **Scope:** Service Catalog + Pricing (`svc`), Quotation +
Approvals (`quo`), Inventory + Stock (`inv`) database foundation.

## Summary

Phase 1-10 implements the database layer for the commercial and stock domain that sits
on top of the Phase 1-9 work order: a service catalog with effective-dated versions
and deterministic pricing, customer quotations whose issued revisions capture their
commercial amounts, and an inventory ledger whose balances derive from an immutable,
provenance-guarded movement stream. It follows the modular-monolith rule (one schema
per module) from ADR-001: `svc`, `quo`, and `inv` are three new module boundaries.
All business tables ship empty; the only seed is the tenant-neutral platform
unit-of-measure catalog (structural reference). Every correctness invariant is enforced
in the database (constraints, triggers, RLS, coherence/provenance guards) rather than
deferred to a backend — and **without any `SECURITY DEFINER`**.

## Object counts (live catalog)

| Object         | Count                                                                               |
| -------------- | ----------------------------------------------------------------------------------- |
| Tables         | 35 (11 `svc` + 6 `quo` + 18 `inv`)                                                  |
| Functions      | 39 (all `SECURITY INVOKER`, `search_path=''`, `REVOKE PUBLIC`)                      |
| Triggers       | 85                                                                                  |
| Policies       | 101                                                                                 |
| Indexes        | 160                                                                                 |
| Columns        | 582 (3 restricted, 0 restricted-searchable)                                         |
| Migrations     | 8 (`20260723090000` … `20260723097000`)                                             |
| P1-10 DB tests | see [phase-1-10-test-catalog.md](phase-1-10-test-catalog.md) (planned P1-10 suites) |

## Key invariants proven

- **Movement trust root (BR-INV-002).** `inv.stock_movements` is append-only with a
  `GENERATED signed_qty`, a single-use `UNIQUE(reference_kind, reference_id,
direction)`, and a per-kind provenance guard that binds every movement to a
  legitimate, quantity-matched, correctly-stated source. A raw-inserted movement that
  bypasses the functions is rejected — enforcement is in the constraints, not a
  privileged role.
- **Balance coherence (BR-INV-001).** `on_hand = Σ signed_qty`, `reserved = Σ active
reservations`, `available = on_hand − reserved` generated and `>= 0`; a forged or
  incoherent balance write fails `23514`.
- **Atomic reservation (FR-INV-002).** Single-winner last-unit race on the balance-row
  `FOR UPDATE` lock; status-only activeness; lifetime idempotency returns the existing
  reservation on replay.
- **Deterministic pricing (FR-SVC-003).** `svc.resolve_price` resolves one book (via
  `price_list_assignments`) → one effective published version → one rule, by a strict
  bit-weighted specificity total order; `NULLS NOT DISTINCT` uniques prevent ambiguity.
- **Issued-quote immutability (FR-SVC-004, FR-QUO-001).** Issued
  `quo.quotation_revisions` and their items are frozen and **capture** unit price,
  discount, tax, and line total; a later price change never alters them; a deferred
  constraint trigger reconciles the captured totals.
- **Item-granular approvals (FR-QUO-002, BR-QUO-001/002).** Append-only
  `quo.approval_decisions` bound to the exact revision+item by a single composite FK,
  one per revision-item; a new revision resets approvals automatically.
- **Maker ≠ approver.** Opening-batch and stock-adjustment approvals require a
  distinct approver; movements post only after approval.
- **Financial precision.** Money `NUMERIC(18,4)`, quantity `NUMERIC(12,3)`, tax
  `NUMERIC(9,6)`; zero float columns; currency via `shared.currencies` FK.
- **Restricted cost.** Three 1:1 cost tables gated by `iam.has_permission('inv.cost.view')`.
- **No fabricated data.** Every business table empty after a clean migration; only the
  platform UoM catalog seeded (structural, tenant-neutral, idempotent).

## Security findings

The nine-lens adversarial self-review raised 38 findings (2 Critical, 14 High, 20
Medium, 2 Low), all resolved by binding amendment before the migrations were finalized
(see [phase-1-10-review-response.md](phase-1-10-review-response.md)). Two Medium
performance/operational residuals are documented and deferred to P1-21 (coherence-guard
re-sum cost; reservation-expiry scheduler). At implementation, **zero unresolved
Critical or High** remain.

## Review model and gate status

Owner-authorized technical, QA, security, and adversarial self-review by
Eng. Ezzaldeen Al-Bitar under the Solo Developer Review Policy and the Standing
Technical Authorization Policy — **not** an independent third-party review. The owner
gate is **Decision: Pending** — the feature pull request is not yet merged, so final
hosted-CI and merge/containment evidence is not yet recorded (see
[phase-1-10-owner-gate.md](phase-1-10-owner-gate.md)).

## Out of scope (by design)

No invoice/billing (P1-11), no backend/API (P1-20), no inventory backend (P1-21), no
UI (P1-30), no procurement (PO/PR/goods-receipt/bidding), no P1-35 migration execution,
and no real or fabricated business data. See
[p1-11-structural-contract.md](p1-11-structural-contract.md),
[p1-20-backend-contract.md](p1-20-backend-contract.md),
[p1-21-inventory-backend-contract.md](p1-21-inventory-backend-contract.md),
[p1-30-frontend-contract.md](p1-30-frontend-contract.md), and
[procurement-exclusion-note.md](procurement-exclusion-note.md).
