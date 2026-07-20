# Phase 1-10 — Price Precedence Contract

**Requirement:** FR-SVC-003 (deterministic pricing precedence). The resolver is a
**total order** — never row-order dependent — and **at most one rule resolves**.

## Resolution path (single book — H11)

`svc.resolve_price(p_service_id, p_company_id, p_branch_id, p_customer_class,
p_as_of)` (`STABLE SECURITY INVOKER`, `search_path=''`, granted to `app_runtime,
app_readonly`) resolves in three deterministic steps:

1. **Assignment → one book.** Among the effective active `svc.price_list_assignments`
   whose optional `company_id`/`branch_id`/`customer_class` match the context, pick
   the single most specific (`LIMIT 1`), so resolution never arbitrates across price
   lists (review-response H11). If none matches, no price resolves.
2. **Book → effective published version.** The assigned list's `svc.price_list_versions`
   row that is `published`, not deleted, and whose `[effective_from, effective_to)`
   interval contains `p_as_of` (latest `effective_from`).
3. **Version → one rule.** Among that version's `svc.price_rules` for the service that
   match the context, pick the single most specific.

Returns `(price_rule_id, amount, currency_code, tax_class_id)`; `currency_code` is the
book's currency (rules inherit it — H12).

## Strict total order

Specificity is a **bit-weighted** score: `branch (4) > company (2) > customer-class
(1)`, summed from the non-null narrowing columns. Ties break by `priority DESC`, then
by `id` — a total order that cannot depend on physical row order.

## Structural anti-ambiguity

Ambiguity is structurally prevented, not merely resolved by ordering: a partial unique
index forbids two rules in the same version with an identical `(price_list_version_id,
service_id, company_id, branch_id, customer_class, priority)` signature, using `NULLS
NOT DISTINCT` so tenant-wide (all-NULL narrowing) rules are also de-duplicated
(review-response H2/H11). The assignment table carries the analogous `NULLS NOT
DISTINCT` signature unique over active rows.

## Issued-quote stability (FR-SVC-004)

A later price change never alters an issued quotation: `quo.quotation_items` **capture**
`captured_unit_price`, `captured_discount`, `captured_tax_rate`, and
`captured_line_total`, so re-reading an issued revision reproduces its captured
amounts by construction. See
[phase-1-10-published-version-immutability-contract.md](phase-1-10-published-version-immutability-contract.md).

**Tests:** see the `svc` pricing suite in
[phase-1-10-test-catalog.md](phase-1-10-test-catalog.md).
