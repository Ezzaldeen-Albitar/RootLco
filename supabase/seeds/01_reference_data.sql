-- =============================================================================
-- RootLco — Class 1 platform reference seeds (P1-03-DB-013/019)
-- Seed standard: docs/database/seed-standard.md §3.1. Idempotent (natural-key
-- conflict targets), deterministic, environment-aware: this file runs on every
-- `supabase db reset` (local/CI). It contains ONLY tenant-neutral,
-- jurisdiction-neutral platform reference data.
--
-- HONESTY NOTE (OIR-04 — OPEN): no owner-approved PRODUCTION currency subset
-- exists. The three currencies below are exactly the seed standard's own
-- illustrated testing subset; the production reference seed is classified
-- PENDING in docs/phase-1/phase-1-3/organization-schema-design.md. NO tax
-- rule, NO jurisdiction default, NO application default currency is seeded —
-- ever — by this file.
--
-- created_by is the documented platform-system actor placeholder (seed
-- standard §3.1); it is not a real user and grants nothing.
-- =============================================================================

INSERT INTO shared.currencies (code, name, minor_unit, created_by)
VALUES
  ('JOD', 'Jordanian Dinar',      3, '00000000-0000-4000-8000-000000000001'),
  ('USD', 'United States Dollar', 2, '00000000-0000-4000-8000-000000000001'),
  ('EUR', 'Euro',                 2, '00000000-0000-4000-8000-000000000001')
ON CONFLICT (code) DO NOTHING;

INSERT INTO shared.timezones (zone_name, created_by)
VALUES
  ('UTC',        '00000000-0000-4000-8000-000000000001'),
  ('Asia/Amman', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (zone_name) DO NOTHING;

-- Arabic (RTL) and English (LTR) are the phase-required minimum.
INSERT INTO shared.languages (locale_code, name, direction, created_by)
VALUES
  ('ar', 'Arabic',  'rtl', '00000000-0000-4000-8000-000000000001'),
  ('en', 'English', 'ltr', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (locale_code) DO NOTHING;

DO $$
BEGIN
  RAISE NOTICE '[RootLco] reference seeds applied (idempotent): % currencies, % timezones, % languages',
    (SELECT count(*) FROM shared.currencies),
    (SELECT count(*) FROM shared.timezones),
    (SELECT count(*) FROM shared.languages);
END $$;
