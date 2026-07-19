-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: deterministic search-normalization functions
-- Tasks: P1-06-DB-021
-- Owner module: crm
--
-- Purpose
--   Deterministic, tenant-agnostic normalization functions used to project
--   partner search terms into shared.search_metadata. They are pure and
--   IMMUTABLE so the same rules are reusable by the Phase-1-15/1-16 backend and
--   testable in isolation. Runtime roles CANNOT write shared.search_metadata
--   (it is SELECT-only for app roles), so the projection itself is a documented
--   backend/admin write-path (INSERT ... ON CONFLICT ON CONSTRAINT
--   uq_search_metadata_identity) using entity_type='crm.business_partner' and
--   field_code in (display_name, given_name, family_name, legal_name,
--   trade_name, phone, email) with classification='internal'. Restricted fields
--   (national/registration/tax identifiers, date_of_birth, addresses, consent
--   evidence, credit/risk data) are NEVER projected.
--
-- Country semantics: phone normalization keeps digits plus an optional leading
-- '+' only. No country-code inference (OIR-04 open); documented as a limitation.
--
-- Dependencies: none beyond the crm schema and pg_catalog string functions.
--
-- Rollback classification: ROLLBACK-SAFE (pure functions, no state).
--
-- Security implications
--   * SECURITY INVOKER, empty search_path, IMMUTABLE, REVOKE EXECUTE FROM PUBLIC,
--     EXECUTE granted to app_runtime + app_readonly. The functions never read a
--     table and never raise with input values, so they cannot leak restricted
--     data through an exception.
--
-- Objects created
--   Functions: crm.normalize_name(text), crm.normalize_email(text),
--              crm.normalize_phone(text)
-- ============================================================================

-- Case-folded, whitespace-collapsed name. lower() is Unicode-aware; Arabic text
-- is unaffected (no transliteration). Returns NULL for blank input.
CREATE OR REPLACE FUNCTION crm.normalize_name(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT nullif(btrim(regexp_replace(lower(coalesce(p, '')), '\s+', ' ', 'g')), '');
$$;

-- Email normalized by safe rules only: trim + lowercase. No dot/plus stripping
-- (which would over-normalize distinct addresses).
CREATE OR REPLACE FUNCTION crm.normalize_email(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT nullif(btrim(lower(coalesce(p, ''))), '');
$$;

-- Phone normalized to digits with an optional single leading '+'. No country
-- code is inferred (OIR-04). Returns NULL when no digits are present.
CREATE OR REPLACE FUNCTION crm.normalize_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT nullif(
    (CASE WHEN btrim(coalesce(p, '')) LIKE '+%' THEN '+' ELSE '' END)
      || regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'),
    '');
$$;

REVOKE EXECUTE ON FUNCTION crm.normalize_name(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crm.normalize_email(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION crm.normalize_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.normalize_name(text) TO app_runtime, app_readonly;
GRANT EXECUTE ON FUNCTION crm.normalize_email(text) TO app_runtime, app_readonly;
GRANT EXECUTE ON FUNCTION crm.normalize_phone(text) TO app_runtime, app_readonly;
