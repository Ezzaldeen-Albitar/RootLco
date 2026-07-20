-- ============================================================================
-- Phase: 1-11 — Billing, Payment, Delivery, Warranty, and Reporting Database
-- Migration: reserve the sal, wty, and rpt module schemas
-- Tasks: P1-11 Wave 1 (schema foundation)
-- Owner module: sal, wty, rpt
--
-- Rollback classification: ROLLBACK-SAFE while unused (namespace only, no data);
--   roll-forward-only once financial tables exist. Forward-only — no down script.
--
-- Purpose
--   Phase 1-11 introduces three new module schemas under the modular-monolith rule
--   (docs/database/database-architecture.md §2 — "one database, one schema per
--   module; a schema is a module boundary"):
--     * `sal` — Sales / commercial-closing module (Figure 4.24): invoices and
--                immutable lines with restricted amount detail, per-tenant invoice
--                numbering, invoice status history, payment methods, receipts,
--                payment allocations, credit notes, receipt reversals, the immutable
--                `financial_event` foundation (the future accounting integration
--                point — explicitly NOT a general ledger), AND the delivery /
--                custody-closure slice (delivery records, checklists, authorized
--                receivers, signatures, delivery status history). Chapter 3 defines
--                no dedicated delivery (DLV) prefix; delivery is the commercial
--                closing of the reception custody chain (BR-REC-001) and is filed
--                under SAL, writing the custody-release row into rec.custody_history.
--     * `wty` — Warranty module (Figure 4.25): warranty policies, effective-dated
--                coverage, warranty records, record items, and warranty status
--                history. Full claim adjudication is deferred to Phase 1-22.
--     * `rpt` — Reporting-configuration module: report configurations, configuration
--                versions, and user-owned saved filters. No report datasets, KPI
--                formulas, or export backend (Phase 1-23).
--
-- Explicit boundary
--   NO general ledger in Phase 1: no journal, journal-line, chart-of-accounts,
--   accounting-period, or posting-rule table. `sal.financial_events` is an immutable
--   append-only source-fact integration boundary (Figure 4.29 direction), never a
--   journal — it carries no debit/credit/account columns. FR-FIN-* remain future
--   accounting integration.
--
-- Dependencies
--   0002 (module-schema convention, role foundation: app_runtime/app_readonly);
--   Phase 1-3 (number_sequences, currency/tax), Phase 1-4 (idempotency, approval
--   limits), Phase 1-5 (documents), Phase 1-6 (payer/receiver partners), Phase 1-8
--   (reception custody chain), Phase 1-9 (billable work orders), Phase 1-10
--   (quotation amounts, stock issues, tax classes) — all merged in origin/develop.
--
-- Security implications
--   * USAGE granted to app_runtime + app_readonly (mirrors 0002 and Phases 1-8..1-10).
--     app_worker is not granted (no P1-11 worker path — the constrained infrastructure
--     worker never touches finance/delivery/warranty/reporting).
--   * No CREATE on these schemas is granted to any application role; only the
--     migration/owner role creates objects (modular-monolith rule §2.1).
--   * No P1-22/P1-23 backend, P1-30/P1-31 frontend, or general-ledger table is created.
--
-- Objects created
--   Schemas: sal, wty, rpt
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS sal; -- Sales/commercial-closing module (P1-11): billing, payment, delivery, financial events.
CREATE SCHEMA IF NOT EXISTS wty; -- Warranty module (P1-11): policies, effective-dated coverage, records.
CREATE SCHEMA IF NOT EXISTS rpt; -- Reporting-configuration module (P1-11): report configs + user-owned saved filters.

COMMENT ON SCHEMA sal IS
  'Sales and commercial-closing module (Phase 1-11). Owns invoices and immutable lines (with restricted amount detail gated by sal.finance.view), per-tenant invoice/receipt numbering via shared.number_sequences, invoice status history, payment methods, receipts, payment allocations, credit notes, receipt reversals, the immutable append-only sal.financial_events foundation (future accounting integration point — NOT a general ledger; no journal/account/debit-credit columns), and the delivery/custody-closure slice (delivery records, checklist template + results, authorized receivers, signatures, delivery status history) that terminates the reception custody chain (BR-REC-001) by writing the release row into rec.custody_history. Database-only; no backend (P1-22) or frontend (P1-30/1-31).';
COMMENT ON SCHEMA wty IS
  'Warranty module (Phase 1-11, Figure 4.25). Owns warranty policies, effective-dated coverage (eligibility evaluated at the service/delivery date — BR-WTY-001), warranty records issued against delivered work with covered items and odometer/duration limits, and append-only warranty status history. Full warranty claim adjudication is deferred to Phase 1-22 (P1-OD-024).';
COMMENT ON SCHEMA rpt IS
  'Reporting-configuration module (Phase 1-11). Owns versioned report configurations (published versions immutable, scope + parameter schema + export-permission code) and user-owned saved filters (visible only to the owning user by RLS; saved-filter scope cannot exceed the report scope). No report datasets, KPI formulas, or export implementation (Phase 1-23).';

GRANT USAGE ON SCHEMA sal, wty, rpt TO app_runtime, app_readonly;
