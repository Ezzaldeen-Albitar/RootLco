-- ============================================================================
-- Phase: 1-10 — Service Catalog, Pricing, Quotation, and Inventory Database
-- Migration: reserve the svc, quo, and inv module schemas
-- Tasks: P1-10 Wave 1 (schema foundation)
-- Owner module: svc, quo, inv
--
-- Rollback classification: ROLLBACK-SAFE while unused (namespace only, no data);
--   roll-forward-only once tables exist. Forward-only — no down script.
--
-- Purpose
--   Phase 1-10 introduces three new module schemas under the modular-monolith rule
--   (docs/database/database-architecture.md §2 — "one database, one schema per
--   module; a schema is a module boundary"):
--     * `svc` — Service Catalog and Pricing module (Figure 4.20): service
--                categories, definitions, effective-dated versions, standard labor
--                times, branch availability, price lists/versions/rules,
--                price-list assignments, discount rules, pricing-approval policies.
--     * `quo` — Quotation and Approvals module (Figure 4.21): quotation masters,
--                immutable numbered revisions, items, item-level approval decisions,
--                approval evidence, and quotation status history.
--     * `inv` — Inventory and Stock module (Figure 4.22): units of measure, item
--                categories, item master, stock locations, immutable stock
--                movements, derived balances, reservations, issues/returns, damaged
--                stock, customer-supplied parts, an external-purchase foundation,
--                opening inventory, and stock adjustments.
--   Each is a distinct lifecycle owner (Commercial Owner DEP-05 vs Inventory Owner
--   DEP-06), so each is its own schema (the same rule by which Phase 1-8 split
--   apt/rec and Phase 1-9 split wo/tech/dia/qms). Pricing lives in `svc` because
--   Figure 4.20 binds it to the service catalog; a standalone pricing schema would
--   collide with the out-of-scope procurement (PRC) domain. This migration creates
--   NO tables — those arrive in later Phase 1-10 migrations.
--
-- Dependencies
--   0002 (module-schema convention, role foundation: app_runtime/app_readonly);
--   Phase 1-9 (abd3362) — svc/quo forward-reference the wo work order.
--
-- Security implications
--   * USAGE granted to app_runtime + app_readonly (mirrors 0002 and Phase 1-8/1-9
--     for the other module schemas); app_worker is not granted (no P1-10 worker
--     path — the constrained infrastructure worker never touches commerce/stock).
--   * No CREATE on these schemas is granted to any application role; only the
--     migration/owner role creates objects (modular-monolith rule §2.1).
--   * No P1-11 invoice/billing, P1-20/P1-21 backend, P1-30 frontend, or procurement
--     table is created in this phase.
--
-- Objects created
--   Schemas: svc, quo, inv
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS svc; -- Service Catalog + Pricing module (P1-10). Business tables in later P1-10 migrations.
CREATE SCHEMA IF NOT EXISTS quo; -- Quotation + Approvals module (P1-10). Originates from a Phase 1-9 work order.
CREATE SCHEMA IF NOT EXISTS inv; -- Inventory + Stock module (P1-10). Immutable movement ledger + derived balances.

COMMENT ON SCHEMA svc IS
  'Service Catalog and Pricing module (Phase 1-10). Owns tenant-scoped service categories, stable service definitions, effective-dated service versions, standard labor times, branch availability, and the pricing layer (price lists, immutable published versions, deterministic-precedence price rules, price-list assignments, discount rules, pricing-approval policies). Reuses org.tax_classes/org.tax_rates for tax and iam.approval_limits for authority ceilings. Database-only; no backend (P1-20) or frontend (P1-30).';
COMMENT ON SCHEMA quo IS
  'Quotation and Approvals module (Phase 1-10). Owns quotation masters (originating from a Phase 1-9 work order), immutable numbered revisions with captured commercial amounts, quotation items, item-level append-only approval decisions, approval evidence, and quotation status history. Captures amounts so a later price change never alters an issued quotation. No invoice/billing table (P1-11).';
COMMENT ON SCHEMA inv IS
  'Inventory and Stock module (Phase 1-10). Owns units of measure, item categories, item master (with restricted cost detail), stock locations, an immutable append-only stock-movement ledger, movement-derived balances (coherence-guarded), atomic reservations, part issues/returns, damaged stock, an external-purchase foundation (non-procurement), opening inventory, and stock adjustments. Stock balance changes only through immutable movements (BR-INV-002). No procurement (PO/PR/goods-receipt) table.';

GRANT USAGE ON SCHEMA svc, quo, inv TO app_runtime, app_readonly;
