# Phase 1-11 — No-General-Ledger Boundary

**Requirement:** plan §6 out-of-scope, acceptance criterion 6, FR-FIN-001…005 (future
accounting integration), §17-10. Owner-authorized technical self-review by Eng. Ezzaldeen
Al-Bitar under the Solo Developer Review Policy and the Standing Technical Authorization Policy
— not an independent third-party review.

## The boundary

Phase 1-11 creates **no general ledger**. There is **no** journal, journal-line,
chart-of-accounts, accounting-period, or posting-rule table in `sal`/`wty`/`rpt`. The FIN
domain (FR-FIN-001…005, UC-FIN-001/002) is future accounting integration.

## `financial_events` is a source-fact boundary, not a journal

`sal.financial_events` is an **immutable source-fact integration boundary** (Figure 4.29
direction only), never a journal. Its columns are `event_type` / `source_type` / `source_id` /
`amount` / `currency_code` / `occurred_at` (+ scope, actor, correlation, `seq`). It carries
**no `debit`, `credit`, or `account` column** — introspection confirms the live table has none.
A future accounting module or external system posts from these complete, immutable, provenance-
guarded source facts; the posting rules and accounts live in that future module, not here.

## What is in scope (the reliable foundation)

- Exactly one immutable event per financial command (issue, receipt, allocation, credit,
  reversal, warranty split) — completeness enforced by constraint (H-fin-3).
- Provenance-guarded amounts bound to authorized source rows.
- Append-only, single-use, `seq`-ordered facts that a downstream ledger can consume without
  re-deriving.

## What is deferred

Online-payment-gateway settlement (FR-SAL-005, CON-04), tenant subscription billing (CON-05),
warranty-provider electronic exchange (FR-WTY-005), and the entire FIN general-ledger domain.
`docs/phase-1/10-phase-1-traceability-matrix.md` records this boundary and the delivery-prefix
mapping (delivery filed under REC/SAL, no `dlv` schema).

A `p1-11-security` assertion checks that no general-ledger table exists in the P1-11 surface.
