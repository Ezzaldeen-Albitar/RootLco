-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: VIN and plate normalization utilities (domain-owned, pure)
-- Tasks: P1-07-DB-002 (VIN normalization contract), P1-07-DB-010 (plate normalization)
-- Owner module: veh
--
-- Purpose
--   Create the deterministic, side-effect-free normalization functions the
--   vehicle domain uses for tenant-scoped uniqueness and search projection:
--     * veh.normalize_vin(text)   — canonical VIN form
--     * veh.normalize_plate(text) — canonical plate form
--   These are the ONLY authority for "normalized" values; the vehicle master's
--   generated vin_normalized column and the plate_history normalized column are
--   both computed from these. Normalization is domain-owned (there is no shared
--   normalizer); this mirrors the crm.normalize_* posture (Phase 1-6).
--
--   VIN rule (BR-VEH-001): uppercase and strip separators/whitespace only.
--   Alphanumerics are PRESERVED — including the ambiguous characters I, O and Q
--   — so the function never silently "corrects" a VIN. Format/checksum
--   VALIDATION (which legitimately rejects I/O/Q in a 17-char VIN) is a distinct
--   concern handled by veh.vin_verifications, not by normalization. This keeps
--   short/legacy chassis identifiers representable too.
--
--   This migration creates NO tables and stores NO data.
--
-- Dependencies
--   None beyond the veh schema (reserved empty in 0002_base_schemas.sql) and the
--   app_runtime / app_readonly roles.
--
-- Rollback classification: ROLLBACK-SAFE (functions only, no data, nothing
--   depends on them yet). Forward-only per the migration standard — no down script.
--
-- Security implications
--   * Both functions are IMMUTABLE, SECURITY INVOKER, search_path = '', and never
--     read a table or raise on input, so they cannot leak data through an
--     exception channel and are safe in generated columns and indexes.
--   * EXECUTE revoked from PUBLIC; granted only to app_runtime and app_readonly.
--
-- Objects created
--   Functions: veh.normalize_vin(text), veh.normalize_plate(text)
-- ============================================================================

-- VIN normalization: uppercase, keep only [A-Z0-9] (drops spaces, hyphens and
-- any other separator), preserve I/O/Q, NULL on blank/empty. VINs are Latin per
-- ISO 3779, so restricting to [A-Z0-9] removes only separators, never content.
CREATE OR REPLACE FUNCTION veh.normalize_vin(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(
    regexp_replace(upper(btrim(COALESCE(p_value, ''))), '[^A-Z0-9]', '', 'g'),
    ''
  );
$$;

COMMENT ON FUNCTION veh.normalize_vin(text) IS
  'Phase 1-7 VIN normalization (P1-07-DB-002, BR-VEH-001): uppercase + strip non-[A-Z0-9] separators; preserves I/O/Q (no silent correction); NULL on blank. IMMUTABLE, used in vehicles.vin_normalized generated column.';

-- Plate normalization: uppercase, strip whitespace and common separators only,
-- preserving all other characters (jurisdiction plates may be non-Latin, e.g.
-- Arabic). No jurisdiction-specific format engine. NULL on blank.
CREATE OR REPLACE FUNCTION veh.normalize_plate(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT NULLIF(
    upper(regexp_replace(btrim(COALESCE(p_value, '')), '[[:space:]._\-]', '', 'g')),
    ''
  );
$$;

COMMENT ON FUNCTION veh.normalize_plate(text) IS
  'Phase 1-7 plate normalization (P1-07-DB-010): uppercase + strip whitespace/._- separators; preserves other (incl. non-Latin) characters; NULL on blank. IMMUTABLE.';

REVOKE EXECUTE ON FUNCTION veh.normalize_vin(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION veh.normalize_plate(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.normalize_vin(text) TO app_runtime, app_readonly;
GRANT EXECUTE ON FUNCTION veh.normalize_plate(text) TO app_runtime, app_readonly;
