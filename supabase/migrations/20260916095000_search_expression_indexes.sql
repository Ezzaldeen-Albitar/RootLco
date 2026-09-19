-- ============================================================================
-- Phase: 1-32 — Owner directive: friendly search
-- Migration: expression indexes for the widened search surface
-- Tasks: P1-32-PRE-051
-- Owner module: shared
--
-- Rollback classification: ROLLBACK-SAFE. Indexes only — no table, column,
--   policy, grant or row is touched, and dropping them loses no data (only the
--   access path). Forward-only per the migration standard; no down script.
--
-- Purpose
--   The search operations widened in this slice match on values that are
--   computed, not stored: a folded display name, the tail of a normalized phone
--   number, a substring of a normalized plate or VIN, a folded catalogue name.
--   None of those is served by an existing index, so every one of them would be
--   a sequential scan over the tenant's rows.
--
--   pg_trgm is already installed (0001_extensions.sql, schema `extensions`), so
--   a CONTAINS match is genuinely indexable here: a GIN trigram index answers
--   `LIKE '%fragment%'` directly. That is why the widened surface can offer a
--   contains match at all — without pg_trgm the honest answer would have been a
--   prefix-only match, and the operations would have been written differently.
--
--   The one match that trigram cannot serve is a phone SUFFIX, because a
--   customer quotes the last digits of their number and the stored value may or
--   may not carry a country code. That is served by a btree on a FIXED-WIDTH
--   suffix key — `right(normalized_value, 7)` — which prunes to a handful of
--   rows; the exact suffix comparison then runs over that handful. Seven is the
--   shortest suffix the application accepts, so the key is always fully
--   determined by the caller's fragment.
--
-- Cost, stated rather than assumed
--   A GIN trigram index is larger than a btree and makes a write slower; these
--   six are on read-heavy tables whose write rate is one row per business event,
--   so the trade is the right way round. A trigram index cannot answer a
--   fragment shorter than three characters, and the application therefore
--   requires at least two characters and accepts that a two-character fragment
--   falls back to a filtered scan bounded by the page limit.
--
-- Dependencies
--   The functions redefined in 20260916094000_shared_text_folding.sql;
--   the `extensions` schema holding pg_trgm.
--
-- Security implications
--   * No policy, grant or RLS setting changes. An index is not a visibility
--     decision: every query that uses one still runs under the same RLS policy
--     and the same explicit tenant predicate.
--   * Every indexed expression is IMMUTABLE and SECURITY INVOKER and reads no
--     table, so none can leak a value through the index.
--
-- Objects created
--   Indexes: ix_business_partners_name_folded_trgm, ix_contact_points_phone_tail,
--            ix_vehicles_vin_trgm, ix_plate_history_normalized_trgm,
--            ix_makes_name_folded_trgm, ix_models_name_folded_trgm,
--            ix_work_orders_display_number_trgm
-- ============================================================================

-- Customer display name, contains. `crm.normalize_name` is the same expression
-- the query uses on the column side, so the index and the predicate can never
-- diverge. Partial on the tombstone because a soft-deleted partner is never a
-- search hit.
CREATE INDEX ix_business_partners_name_folded_trgm
  ON crm.business_partners
  USING gin (crm.normalize_name(display_name) extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Phone tail. Tenant-leading so the scan is pruned to one tenant before the
-- suffix key is consulted, which keeps the index useful on a shared table.
CREATE INDEX ix_contact_points_phone_tail
  ON crm.contact_points (tenant_id, right(normalized_value, 7))
  WHERE deleted_at IS NULL;

-- VIN contains. Exact VIN lookup is already served by uq_vehicles_active_vin;
-- this one exists for the free-text arm, where a caller types the last digits of
-- a VIN off a windscreen.
CREATE INDEX ix_vehicles_vin_trgm
  ON veh.vehicles
  USING gin (vin_normalized extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Plate contains, over EVERY historical row rather than the active one. The
-- widened plate search deliberately matches a past plate, so the index must
-- cover the closed intervals too; plate_history has no tombstone column.
CREATE INDEX ix_plate_history_normalized_trgm
  ON veh.plate_history
  USING gin (plate_normalized extensions.gin_trgm_ops);

-- Make and model names, folded. These are small catalogue tables, but they are
-- joined on every free-text vehicle search, so an unindexed folded contains here
-- would be paid once per search row.
CREATE INDEX ix_makes_name_folded_trgm
  ON veh.makes
  USING gin (shared.fold_search_text(name) extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

CREATE INDEX ix_models_name_folded_trgm
  ON veh.models
  USING gin (shared.fold_search_text(name) extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

-- Work-order number, contains. The exact match is already served by
-- uq_work_orders_active_display_number; this serves the free-text arm, where an
-- operator types the tail of a number read off a job card.
CREATE INDEX ix_work_orders_display_number_trgm
  ON wo.work_orders
  USING gin (display_number extensions.gin_trgm_ops)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX crm.ix_business_partners_name_folded_trgm IS
  'P1-32 friendly search: GIN trigram over crm.normalize_name(display_name) so a folded contains match is indexable.';
COMMENT ON INDEX crm.ix_contact_points_phone_tail IS
  'P1-32 friendly search: fixed-width seven-digit suffix key so a caller quoting the tail of a phone number is answered by an index rather than a scan.';
COMMENT ON INDEX veh.ix_vehicles_vin_trgm IS
  'P1-32 friendly search: GIN trigram over vin_normalized for the free-text contains arm. Exact VIN lookup still uses uq_vehicles_active_vin.';
COMMENT ON INDEX veh.ix_plate_history_normalized_trgm IS
  'P1-32 friendly search: GIN trigram over plate_normalized across EVERY interval, because plate search now matches historical plates.';
COMMENT ON INDEX veh.ix_makes_name_folded_trgm IS
  'P1-32 friendly search: GIN trigram over the folded make name.';
COMMENT ON INDEX veh.ix_models_name_folded_trgm IS
  'P1-32 friendly search: GIN trigram over the folded model name.';
COMMENT ON INDEX wo.ix_work_orders_display_number_trgm IS
  'P1-32 friendly search: GIN trigram over the work-order number for the free-text contains arm.';
