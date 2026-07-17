-- ============================================================================
-- Phase: 1-3 — Tenant, Company, Branch, and Organizational Database
-- Migration: platform reference tables (currencies, timezones, languages)
-- Tasks: P1-03-DB-013, P1-03-DB-019
-- Owner module: shared (cross-module platform primitives)
--
-- Purpose
--   Platform-managed, tenant-neutral reference data that the organizational
--   model references: ISO currency codes, approved IANA time-zone names, and
--   approved locales with their writing direction. These are Class 1 reference
--   data under docs/database/seed-standard.md §3.1: true for EVERY tenant,
--   owned by the platform, and carrying no tenant identifier by definition.
--
-- Dependency
--   Requires 0002 (schemas `shared`, roles app_runtime/app_readonly,
--   shared.touch_row_metadata). Depends on no other Phase 1-3 migration and
--   must run first: org.legal_companies.base_currency_code and
--   org.branches.timezone_name reference these tables.
--
-- Rollback classification: ROLLBACK-SAFE while no organizational row
--   references a reference value. Once org.legal_companies /org.branches rows
--   exist, these tables become load-bearing and the classification degrades to
--   roll-forward-only (dropping them would orphan real configuration).
--   Recorded in docs/database/phase-1-3-migration-classification.md.
--
-- Security implications
--   * Runtime roles are READ-ONLY on all three tables: SELECT grant + SELECT
--     policy only. No INSERT/UPDATE/DELETE grant and no write policy exists —
--     two independent layers deny writes, so a tenant runtime session cannot
--     mutate platform reference data (abuse case: platform-table modification
--     by tenant runtime roles).
--   * RLS is ENABLED and FORCED on all three. They hold no tenant data, so the
--     read policy is deliberately unrestricted-but-read-only rather than
--     tenant-pivoted; forcing RLS keeps the "every module-schema table has RLS
--     enabled and forced" invariant true without carving out an exemption.
--   * No jurisdiction policy is encoded. No tax rule, no default currency, and
--     no country default exists here (OIR-04 remains OPEN).
--
-- Objects created
--   Tables:    shared.currencies, shared.timezones, shared.languages
--   Functions: shared.validate_timezone_name()
--   Triggers:  tg_currencies_touch_metadata, tg_timezones_touch_metadata,
--              tg_languages_touch_metadata, tg_timezones_validate_zone_name
--   Policies:  sel_currencies_all, sel_timezones_all, sel_languages_all
--
-- PRIMARY KEY NOTE — a documented, owner-instructed exception.
--   The naming standard §5 states that the primary key of every table is
--   `id uuid`. These three tables instead use their stable natural code as the
--   primary key, because:
--     (a) the phase instruction §10 requires "ISO currency code primary key";
--     (b) it names the company column `base_currency_code` — a `_code`
--         reference, not a `_id` reference;
--     (c) the seed standard §3.1 already illustrates shared.currencies with
--         `ON CONFLICT (code)` and requires stable natural keys so idempotent
--         conflict targets exist.
--   The exception is limited to platform reference tables and is recorded in
--   docs/database/database-naming-standard.md §5 rather than left as a silent
--   contradiction between two binding documents.
--
-- PLATFORM SYSTEM ACTOR
--   created_by is NOT NULL under the base metadata standard, but no IAM
--   principal exists until Phase 1-4. Reference rows are therefore attributed
--   to the documented platform-system actor placeholder
--   '00000000-0000-4000-8000-000000000001' (seed standard §3.1). It is not a
--   real user and grants nothing.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Currencies — ISO 4217 (P1-03-DB-013)
--    Lifecycle class: reference (no soft delete; a withdrawn currency is
--    marked inactive, never removed, because historical rows may reference it).
-- ----------------------------------------------------------------------------
CREATE TABLE shared.currencies (
  code           text        NOT NULL,
  name           text        NOT NULL,
  minor_unit     smallint    NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_currencies PRIMARY KEY (code),
  -- ISO 4217 alphabetic code: exactly three uppercase letters.
  CONSTRAINT ck_currencies_code_format CHECK (code ~ '^[A-Z]{3}$'),
  CONSTRAINT ck_currencies_name_not_blank CHECK (btrim(name) <> ''),
  -- ISO 4217 exponents observed in practice run 0..4 (e.g. JOD/KWD = 3).
  CONSTRAINT ck_currencies_minor_unit_range CHECK (minor_unit BETWEEN 0 AND 4),
  CONSTRAINT ck_currencies_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE shared.currencies IS
  'Platform reference data: ISO 4217 currency codes (P1-03-DB-013). Class 1 reference data — tenant-neutral and jurisdiction-neutral by definition, so it carries NO tenant_id. Runtime roles are read-only. No default/application currency exists: a company states its own base_currency_code. OIR-04 (approved production currency subset) remains OPEN — see docs/phase-1/phase-1-3/initial-audit.md §8.';
COMMENT ON COLUMN shared.currencies.code IS
  'ISO 4217 alphabetic code, uppercase. Primary key by documented exception to the id-uuid rule (see the migration header and naming standard §5): reference data needs a stable natural conflict target for idempotent seeding.';
COMMENT ON COLUMN shared.currencies.minor_unit IS
  'ISO 4217 exponent: number of decimal places (e.g. USD 2, JOD 3, JPY 0). Used by later phases to format and round monetary amounts. Money itself is NEVER float — see the architecture standard.';
COMMENT ON COLUMN shared.currencies.status IS
  'active | inactive. A withdrawn currency is marked inactive, never deleted: historical organizational rows may still reference it.';

-- ----------------------------------------------------------------------------
-- 2. Time zones — approved IANA zone names (P1-03-DB-013)
--    The IANA database (shipped with PostgreSQL, readable via
--    pg_timezone_names) is the source of truth. This table is an APPROVAL
--    LIST over it, not a re-implementation of it: deliberately NO hand-written
--    UTC-offset column exists, because offsets change with DST and political
--    decisions and a hand-maintained offset would silently rot.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.timezones (
  zone_name      text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_timezones PRIMARY KEY (zone_name),
  -- Shape check only. Existence against the IANA database is enforced by
  -- tg_timezones_validate_zone_name below, because a CHECK constraint may not
  -- query a catalog view.
  CONSTRAINT ck_timezones_zone_name_format CHECK (zone_name ~ '^[A-Za-z][A-Za-z0-9+_/-]{1,63}$'),
  CONSTRAINT ck_timezones_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE shared.timezones IS
  'Platform reference data: approved IANA time-zone names (P1-03-DB-013). Class 1 reference data — no tenant_id. An APPROVAL LIST over the IANA database that PostgreSQL already ships (pg_timezone_names), validated against it by trigger. Deliberately holds NO UTC-offset column: offsets change with DST and by political decision, so a hand-written offset table would be a rotting duplicate source of truth.';
COMMENT ON COLUMN shared.timezones.zone_name IS
  'IANA zone name (e.g. UTC, Asia/Amman). Primary key by the documented reference-table exception. Existence is validated against pg_timezone_names by tg_timezones_validate_zone_name.';

-- Existence validation against the IANA database shipped with PostgreSQL.
-- A CHECK cannot reference a catalog view, so this is a trigger.
CREATE OR REPLACE FUNCTION shared.validate_timezone_name()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name = NEW.zone_name
  ) THEN
    RAISE EXCEPTION 'timezones: % is not a time-zone name known to this PostgreSQL installation (IANA database)', NEW.zone_name
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.validate_timezone_name() IS
  'BEFORE INSERT/UPDATE trigger on shared.timezones: rejects any zone_name absent from pg_timezone_names. Keeps the IANA database the single source of truth (P1-03-DB-013).';

-- Trigger functions are invoked by triggers, never by callers: strip the
-- PostgreSQL PUBLIC EXECUTE default so no role can call it directly.
REVOKE EXECUTE ON FUNCTION shared.validate_timezone_name() FROM PUBLIC;

CREATE TRIGGER tg_timezones_validate_zone_name
  BEFORE INSERT OR UPDATE ON shared.timezones
  FOR EACH ROW
  EXECUTE FUNCTION shared.validate_timezone_name();

-- ----------------------------------------------------------------------------
-- 3. Languages — approved locales and writing direction (P1-03-DB-013)
-- ----------------------------------------------------------------------------
CREATE TABLE shared.languages (
  locale_code    text        NOT NULL,
  name           text        NOT NULL,
  direction      text        NOT NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_languages PRIMARY KEY (locale_code),
  -- BCP 47 subset actually needed: language, or language-REGION.
  CONSTRAINT ck_languages_locale_code_format CHECK (locale_code ~ '^[a-z]{2}(-[A-Z]{2})?$'),
  CONSTRAINT ck_languages_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_languages_direction CHECK (direction IN ('ltr', 'rtl')),
  CONSTRAINT ck_languages_status CHECK (status IN ('active', 'inactive'))
);

COMMENT ON TABLE shared.languages IS
  'Platform reference data: approved locales and their writing direction (P1-03-DB-013). Class 1 reference data — no tenant_id. Direction is constrained to ltr|rtl and drives the direction-safe styling rules (ADR-013): the product is Arabic-first and must render RTL correctly. No default application locale exists; a tenant states its own default_locale.';
COMMENT ON COLUMN shared.languages.direction IS
  'ltr | rtl. Consumed by the frontend phases (1-25 onward) via CSS logical properties; no frontend implementation exists yet.';

-- ----------------------------------------------------------------------------
-- 4. Row metadata triggers (base metadata standard, migration 0002).
-- ----------------------------------------------------------------------------
CREATE TRIGGER tg_currencies_touch_metadata
  BEFORE UPDATE ON shared.currencies
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_timezones_touch_metadata
  BEFORE UPDATE ON shared.timezones
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_languages_touch_metadata
  BEFORE UPDATE ON shared.languages
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

-- ----------------------------------------------------------------------------
-- 5. Row-Level Security: ENABLED and FORCED on all three.
--
--    These tables hold no tenant data, so the read policy is not tenant-pivoted.
--    RLS is still enabled AND forced so that the platform invariant "every table
--    in a module schema has RLS enabled and forced" holds without an exemption —
--    an exemption is a hole that the next table quietly falls through.
--
--    Reference data is readable by every application role. It is writable by
--    NONE: there is no INSERT/UPDATE/DELETE policy and no such grant, so writes
--    are denied twice over. Reference rows are maintained by controlled seeds
--    and migrations executed by the migration role, not at runtime.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.currencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.currencies FORCE ROW LEVEL SECURITY;
ALTER TABLE shared.timezones  ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.timezones  FORCE ROW LEVEL SECURITY;
ALTER TABLE shared.languages  ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.languages  FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_currencies_all ON shared.currencies
  FOR SELECT TO app_runtime, app_readonly
  USING (true);

CREATE POLICY sel_timezones_all ON shared.timezones
  FOR SELECT TO app_runtime, app_readonly
  USING (true);

CREATE POLICY sel_languages_all ON shared.languages
  FOR SELECT TO app_runtime, app_readonly
  USING (true);

COMMENT ON POLICY sel_currencies_all ON shared.currencies IS
  'Reference data is readable by every application role. Deliberately not tenant-pivoted: the table holds no tenant data. No write policy exists — writes are denied by the absence of both a policy and a grant.';

-- ----------------------------------------------------------------------------
-- 6. Grants — SELECT only, explicit, per object. No write path exists.
-- ----------------------------------------------------------------------------
GRANT SELECT ON shared.currencies TO app_runtime, app_readonly;
GRANT SELECT ON shared.timezones  TO app_runtime, app_readonly;
GRANT SELECT ON shared.languages  TO app_runtime, app_readonly;

-- Deliberately ABSENT: INSERT/UPDATE/DELETE on any reference table for any
-- application role. Reference data changes are controlled changes.
