-- =============================================================================
-- RootLco — Phase 1-9 platform diagnostic-type vocabulary (structural reference)
-- P1-09-DB-020 seed obligation, completed on the Owner's decision of 2026-09-03
-- (P1-29 W9 residual W9-R4). Seed standard: docs/database/seed-standard.md §3.1.
--
-- WHY THIS IS STRUCTURAL, NOT BUSINESS DATA
--   dia.inspection_templates.diagnostic_type_id is NOT NULL: a template exists
--   only against a diagnostic type, a report only against a template. The
--   catalogue shipped dual-scope with ZERO rows — no seed, no migration and no
--   runtime operation ever wrote a platform row — so no template, report,
--   completion or review could exist for any real organization (measured on
--   protected develop eb8c8763 during the P1-29 W9 acceptance: a freshly
--   provisioned organization answered dia.diagnostic-type-list with 0 items).
--   The Phase 1 plan required the diagnostic types among the P1-09 seeds. These
--   ten rows are tenant-NEUTRAL generic categories: no tenant id, no customer,
--   vehicle, report, finding, measurement or template — exactly the "technically
--   mandatory generic definitions" the no-fake-data policy permits.
--
-- RULES: platform scope only (tenant_id NULL); idempotent (ON CONFLICT DO NOTHING
--   against the partial platform-code unique index uq_diagnostic_types_platform_code,
--   so a replay changes nothing); the codes are stable identifiers in the
--   catalogue's own format (ck_diagnostic_types_code_format) and are never
--   rewritten — a display-name change is a reviewed update of `name`, and a
--   historical report keeps its type through the row's id; status 'active' is
--   the catalogue's canonical usable state (ck_diagnostic_types_status).
--   A tenant's own row of the same code lives under uq_diagnostic_types_tenant_code
--   and is never touched; the read path (dia.diagnostic-type-list) returns the
--   tenant row in place of the platform row of the same code, and that stands.
--   NO business data; no tenant hard-coding. Not a diagnostic type: OBD — a
--   diagnostic method / data source, recorded in the report's DTC and evidence
--   structures.
--
-- Platform actor for seeds (the reserved system UUID; not a real user).
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
