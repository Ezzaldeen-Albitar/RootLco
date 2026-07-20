-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: reserve the wo, dia, tech, and qms module schemas
-- Tasks: P1-09 Wave 1 (schema foundation)
-- Owner module: wo, dia, tech, qms
--
-- Rollback classification: ROLLBACK-SAFE while unused (namespace only, no data);
--   roll-forward-only once tables exist. Forward-only — no down script.
--
-- Purpose
--   Phase 1-9 introduces four new module schemas under the modular-monolith rule
--   (docs/database/database-architecture.md §2 — "one database, one schema per
--   module; a schema is a module boundary"):
--     * `wo`   — Work Order module (the repair job of record: configurable state
--                graph, jobs, assignments, service/part lines, additional work,
--                customer approvals).
--     * `tech` — Technician module (operational identity: skills, certifications,
--                availability, labor sessions — reused by, not owned by, a WO).
--     * `dia`  — Diagnostics module (inspection/diagnostic templates, versioned
--                reports, findings, measurements, DTCs — an independent record).
--     * `qms`  — Quality module (quality control, closure gates, reopen
--                prohibition, rework — an independent control layer over the WO).
--   Each is a distinct lifecycle owner, so each is its own schema (the same rule
--   by which Phase 1-8 split apt/rec). 0002 created only org/iam/shared/crm/veh;
--   this migration adds these four as a controlled schema addition. It creates NO
--   tables — those arrive in later Phase 1-9 migrations.
--
-- Dependencies
--   0002 (module-schema convention, role foundation: app_runtime/app_readonly).
--
-- Security implications
--   * USAGE granted to app_runtime + app_readonly (mirrors 0002 and Phase 1-8 for
--     the other module schemas); app_worker is not granted (no P1-09 worker path).
--   * No CREATE on these schemas is granted to any application role; only the
--     migration/owner role creates objects (modular-monolith rule §2.1).
--
-- Objects created
--   Schemas: wo, dia, tech, qms
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS wo;   -- Work Order module (P1-09). Business tables in later P1-09 migrations.
CREATE SCHEMA IF NOT EXISTS tech; -- Technician module (P1-09). Operational identity, skills, labor.
CREATE SCHEMA IF NOT EXISTS dia;  -- Diagnostics module (P1-09). Templates, versioned reports, findings.
CREATE SCHEMA IF NOT EXISTS qms;  -- Quality module (P1-09). QC, closure gates, reopen prohibition, rework.

COMMENT ON SCHEMA wo IS
  'Work Order module (Phase 1-9). Owns the configurable work-order and job state graphs, the work-order master (originating from a Phase 1-8 reception visit), jobs, assignments, service/labor lines, required parts, additional-work requests, and customer approvals. Database-only; no backend (P1-19) or frontend (P1-29). Creates no quotation/item table (P1-10).';
COMMENT ON SCHEMA tech IS
  'Technician module (Phase 1-9). Owns technician operational profiles (referencing the iam identity anchor, never duplicating HR/payroll data), skills, skill levels, certifications, availability, and labor sessions. Restricted credential numbers live in a 1:1 gated table.';
COMMENT ON SCHEMA dia IS
  'Diagnostics module (Phase 1-9). Owns inspection/diagnostic templates and immutable versions, diagnostic reports (pinning an exact template version), findings, measurements, DTC records, evidence (binding an exact document version), recommendations, reviews, and report status history.';
COMMENT ON SCHEMA qms IS
  'Quality module (Phase 1-9). Owns quality-control records and results, the work-order closure gate, the reopen-attempt ledger (BR-WO-002: closed work orders never reopen), rework links with independent sign-off (BR-QMS-001), and QC status history.';

GRANT USAGE ON SCHEMA wo, dia, tech, qms TO app_runtime, app_readonly;
