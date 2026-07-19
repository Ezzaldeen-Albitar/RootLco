-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: reserve the apt and rec module schemas
-- Tasks: P1-08 Wave 2 (schema foundation)
-- Owner module: apt, rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (namespace only, no data);
--   roll-forward-only once tables exist. Forward-only — no down script.
--
-- Purpose
--   Phase 1-8 introduces two new module schemas under the modular-monolith rule
--   (docs/database/database-architecture.md §2 — "one database, one schema per
--   module; a schema is a module boundary"): `apt` owns the Appointment module
--   (expected-demand lifecycle) and `rec` owns the Vehicle Reception module (the
--   workshop custody boundary). They are distinct module boundaries: Reception
--   (Phase 1-9 consumer) references `rec` without owning Appointment internals,
--   and Phase 1-18 may orchestrate both while the database boundary holds. 0002
--   created only org/iam/shared/crm/veh and did not pre-reserve these; this
--   migration adds them as a controlled schema addition. This migration creates
--   NO tables — those arrive in later Phase 1-8 migrations.
--
-- Dependencies
--   0002 (module-schema convention, role foundation: app_runtime/app_readonly).
--
-- Security implications
--   * USAGE granted to app_runtime + app_readonly (mirrors 0002 for the other
--     module schemas); app_worker is not granted (no reception worker path yet).
--   * No CREATE on these schemas is granted to any application role; only the
--     migration/owner role creates objects (modular-monolith rule §2.1).
--
-- Objects created
--   Schemas: apt, rec
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS apt; -- Appointment module (P1-08). Business tables in later P1-08 migrations.
CREATE SCHEMA IF NOT EXISTS rec; -- Vehicle Reception module (P1-08). The workshop custody boundary.

COMMENT ON SCHEMA apt IS
  'Appointment module (Phase 1-8). Owns appointment intake, services, status history, cancellation/no-show, and confirmed-window conflict support. A schema is a module boundary (ADR-001).';
COMMENT ON SCHEMA rec IS
  'Vehicle Reception module (Phase 1-8). Owns walk-in origin, reception visit (custody boundary), party roles, complaints, inspection/damage evidence, signatures, refusals, authorization, custody + reception status history. Consumed by Phase 1-9 (work orders); no work-order table is created here.';

GRANT USAGE ON SCHEMA apt, rec TO app_runtime, app_readonly;
