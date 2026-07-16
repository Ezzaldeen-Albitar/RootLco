-- =============================================================================
-- RootLco — local seed data
-- Applied by `supabase db reset` after all migrations (config.toml [db.seed]).
--
-- INTENTIONALLY EMPTY AT PHASE 1-1.
--
-- Phase 1-1 is Source-of-Truth Validation and Development Readiness. It
-- establishes the migration and seed MECHANISM only. There is no business
-- schema yet, so there is nothing to seed.
--
-- The business schema begins at Phase 1-2, which is blocked until the RootLco
-- owners record a Go or Conditional Go on the Phase 1-1 gate.
-- =============================================================================
--
-- RULES THAT GOVERN THIS FILE WHEN IT IS EVENTUALLY POPULATED
--
-- 1. NO TENANT IS HARD-CODED. Not here, not anywhere.
--
--    Benzene Vehicle Services (بنزين لخدمات المركبات) is the first customer,
--    the first subscribed tenant, and the first pilot. It is NOT the software
--    owner and NOT the platform owner. It is onboarded exactly like any other
--    tenant would be: through configuration and operator-entered data.
--
--    A `benzene` row committed to this file would make the product
--    unsellable to the second customer. Do not add one. See ADR-008, ADR-009.
--
-- 2. NO ZOOM OBJECTS. Zoom Vehicle Inspection and Evaluation Services is
--    outside Phase 1 (out-of-scope register P1-OOS-026). No tables, no seeds,
--    no columns, no enum values. See ADR-010.
--
-- 3. NO REAL DATA AND NO PRODUCTION DATA. This file is local-only. It must
--    never contain customer records, personal data, real vehicle identifiers,
--    passwords, keys, or anything copied from a live system.
--
-- 4. SEED IS NOT MIGRATION. Structure belongs in supabase/migrations/.
--    This file only inserts rows. If you are writing DDL here, it is in the
--    wrong file.
--
-- 5. IDEMPOTENT. `db reset` re-runs this from scratch, but write inserts so
--    that re-running is safe (ON CONFLICT DO NOTHING) rather than assuming an
--    empty table.
-- =============================================================================

-- No statements at Phase 1-1. This file must remain a no-op until the Phase 1-2
-- schema exists and the owners have approved the Phase 1-1 gate.

-- Proves the seed pipeline actually executes, without creating any object,
-- writing any row, or asserting anything about business data.
DO $$
BEGIN
  RAISE NOTICE '[RootLco] seed.sql executed: Phase 1-1 baseline, no business data by design.';
END
$$;
