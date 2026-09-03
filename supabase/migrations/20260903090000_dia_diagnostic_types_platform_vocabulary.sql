-- =============================================================================
-- RootLco — Phase 1-9 diagnostic-type vocabulary: the platform default rows
-- (P1-09-DB-020 seed obligation, completed; Owner decision of 2026-09-03,
--  P1-29 W9 residual W9-R4)
--
-- Rollback classification: NON-DESTRUCTIVE — rows only; additive; replay-safe.
--   Reverse by soft-deleting the ten platform rows (deleted_at) — never by
--   DELETE, because dia.inspection_templates and dia.diagnostic_reports
--   reference them (ON DELETE RESTRICT) and report history must keep its
--   diagnostic type.
--
-- WHY THIS MIGRATION EXISTS
--   dia.diagnostic_types (20260722093000) shipped as a dual-scope catalogue
--   with ZERO rows: no seed file, no migration and no runtime operation ever
--   wrote a platform row, and dia.template-create requires a diagnostic type.
--   Measured on protected develop eb8c8763 (P1-29 W9 acceptance, 2026-09-03):
--   a freshly provisioned organization answered dia.diagnostic-type-list with
--   0 items, so no template, report, completion or review could exist for any
--   real workshop. The Phase 1 plan required the diagnostic types among the
--   P1-09 seeds; this is the corrective completion of that obligation.
--
-- WHAT IT WRITES — Class 1 platform reference data (docs/database/seed-standard.md §3.1)
--   Ten tenant-neutral, jurisdiction-neutral PLATFORM rows (scope = 'platform',
--   tenant_id NULL), status 'active' — the catalogue's canonical usable state
--   (ck_diagnostic_types_status: active | inactive). The codes are stable
--   identifiers in the catalogue's own format (ck_diagnostic_types_code_format:
--   ^[a-z][a-z0-9_]{1,62}$); a future display-name change goes through a
--   reviewed update of `name`, never through a new code, so a historical
--   report keeps its type through the row's id.
--
--   Deliberately NOT a diagnostic type: OBD. It is a diagnostic method / data
--   source, not a business category; OBD/DTC data lives in the report's DTC
--   and evidence structures (dia.diagnostic_reports, 20260722102000).
--
-- WHY A MIGRATION AND NOT A DECLARED SEED FILE
--   Class 1 vocabularies conventionally live in supabase/seeds/*.sql, which
--   run on `supabase db reset` (local and CI). The Owner chose a forward
--   migration for this vocabulary so that every environment that replays the
--   migration series — including one that never runs the declared seeds —
--   carries it. The insertion is the seeds' own idempotent form (natural-key
--   conflict target on the partial unique index), so replaying this file, or
--   applying a declared seed with the same rows later, changes nothing.
--
-- TENANT ROWS ARE UNTOUCHED
--   The conflict target is uq_diagnostic_types_platform_code (scope =
--   'platform' AND deleted_at IS NULL). A tenant's own row with the same code
--   (uq_diagnostic_types_tenant_code) is a different row under a different
--   index; this migration cannot see, overwrite or shadow it. The read path
--   (dia.diagnostic-type-list) already returns a tenant row in place of the
--   platform row of the same code, and that behaviour is preserved.
--
-- created_by is the documented platform-system actor placeholder
-- (seed-standard §3.1); it is not a real user and grants nothing.
-- No tenant, customer, vehicle, report, finding or measurement is inserted.
-- =============================================================================

INSERT INTO dia.diagnostic_types (scope, tenant_id, code, name, status, created_by)
VALUES
  ('platform', NULL, 'general_diagnostic',        'General Diagnostic',              'active', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'engine_powertrain',         'Engine & Powertrain',             'active', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'transmission_drivetrain',   'Transmission & Drivetrain',       'active', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'electrical_electronic',     'Electrical & Electronic Systems', 'active', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'brakes',                    'Brakes',                          'active', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'steering_suspension',       'Steering & Suspension',           'active', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'hvac_climate',              'HVAC / Climate Control',          'active', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'battery_starting_charging', 'Battery / Starting / Charging',   'active', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'hybrid_ev_high_voltage',    'Hybrid & EV High-Voltage Systems','active', '00000000-0000-4000-8000-000000000001'),
  ('platform', NULL, 'safety_restraint',          'Safety / Restraint Systems',      'active', '00000000-0000-4000-8000-000000000001')
ON CONFLICT (code) WHERE scope = 'platform' AND deleted_at IS NULL DO NOTHING;
