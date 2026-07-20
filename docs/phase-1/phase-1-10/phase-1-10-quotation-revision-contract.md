# Phase 1-10 — Quotation Revision Contract

**Requirement:** FR-QUO-001 (immutable numbered revisions). Every control is
structural.

## Numbered, monotonic revisions

`quo.quotation_revisions(quotation_id, revision_number, status, currency_code,
captured_*)`: `revision_number > 0` and `UNIQUE(tenant_id, company_id, branch_id,
quotation_id, revision_number)`. Status is `draft` → `issued` →
`superseded`/`rejected`/`expired`.

## Single issued revision (H3)

`UNIQUE(tenant_id, quotation_id) WHERE status='issued' AND deleted_at IS NULL` — at
most one issued revision per quotation. A direct status UPDATE cannot create two
issued revisions. `quo.issue_revision` (`SECURITY INVOKER`), under the parent
`quo.quotations` `FOR UPDATE` lock:

1. verifies the revision is `draft`;
2. recomputes `captured_subtotal/discount/tax/grand_total` from the items and forbids
   issuing a **zero-item** revision (H4);
3. supersedes the prior issued revision first (keeping the single-issued unique
   satisfied);
4. sets the revision `issued` with the recomputed totals and stamps `issued_at`;
5. repoints `quo.quotations.current_revision_id` and sets the quotation `active`.

## Freeze once issued (H13)

`quo.quotation_items` are frozen against INSERT/UPDATE/DELETE while the parent
revision is not `draft` (`quo.guard_quotation_item`). The revision's captured totals
satisfy CHECK `captured_grand_total = captured_subtotal - captured_discount_total +
captured_tax_total`. A `DEFERRABLE INITIALLY DEFERRED` constraint trigger
(`quo.guard_revision_totals`) re-asserts at commit that an issued revision's captured
totals equal the sum over its items (H4) — a per-line round-then-sum identity.

## Currency coherence (H12)

`quo.guard_quotation_item` rejects an item whose `currency_code` differs from the
revision currency; the revision and its parent quotation share a currency (immutable
`currency_code` on both). See
[phase-1-10-money-precision-currency-contract.md](phase-1-10-money-precision-currency-contract.md).

## Automatic invalidation (BR-QUO-002)

Because approvals reference a specific revision (see
[phase-1-10-item-approval-contract.md](phase-1-10-item-approval-contract.md)), a new
revision begins with **no** approvals — nothing carries forward. A revised amount
therefore automatically invalidates any prior approval for the affected item; no
carry-forward path exists.

**Tests:** see the `quo` quotation suite in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
