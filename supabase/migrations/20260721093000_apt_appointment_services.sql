-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: Appointment requested-services child
-- Tasks: P1-08-DB-002 (requested services)
-- Owner module: apt
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Purpose
--   apt.appointment_services records the service(s) a requester asks for when an
--   appointment is booked. Each row is a single requested-service descriptor
--   scoped to its parent appointment's branch. Because the governed service
--   catalog is a later phase (P1-10), a row carries EITHER a forward reference to
--   a future catalogued service (future_service_id — a placeholder uuid with NO
--   foreign key, because the target table does not yet exist) OR free-text the
--   requester provided (requested_service_text), and at least one descriptor must
--   be present. When P1-10 lands, future_service_id becomes a real FK to the
--   service catalog via a forward migration; existing free-text rows are retained.
--
--   This is NOT the service catalog and NOT a work order: it is intake demand only.
--
-- Dependencies
--   apt.appointments (tenant_id, company_id, branch_id, id) — the composite parent
--   candidate key; iam.current_tenant_id / allowed_company_ids / allowed_branch_ids;
--   shared.touch_row_metadata; org.guard_immutable_columns.
--
-- Details
--   Branch scope is inherited in full (tenant_id, company_id, branch_id) with a
--   composite FK to the appointment's scope candidate key, so a service row can
--   never point at an appointment in another branch/company/tenant (FK-enforced,
--   not RLS alone). Mutable child (correct a typo/quantity) with soft delete and
--   an immutable identity (scope + appointment + audit-birth). Duplicate ACTIVE
--   descriptors are rejected per appointment: one active row per requested text and
--   one active row per future_service_id.
--
--   P1-10 FORWARD CONTRACT: future_service_id is intentionally unconstrained by a
--   foreign key in this phase. Do not add a fake/placeholder catalog table to
--   satisfy it. P1-10 owns the service catalog and the FK.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant + company + branch scoped; scope + parent
--     immutable; no DELETE grant (soft delete only).
--   * requested_service_text is operational free text (classified internal), never
--     personal data — no restricted-payload separation required.
--
-- Objects created
--   Tables:    apt.appointment_services
--   Triggers:  tg_appointment_services_immutable, tg_appointment_services_touch_metadata
--   Policies:  sel_appointment_services_scope, ins_appointment_services_scope,
--              upd_appointment_services_scope
--   Indexes:   uq_appointment_services_scope_id, ix_appointment_services_appointment,
--              uq_appointment_services_active_text, uq_appointment_services_active_future
-- ============================================================================

CREATE TABLE apt.appointment_services (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL,
  company_id             uuid        NOT NULL,
  branch_id              uuid        NOT NULL,
  appointment_id         uuid        NOT NULL,
  -- P1-10 forward reference: placeholder uuid, deliberately NO FK (catalog is P1-10).
  future_service_id      uuid        NULL,
  requested_service_text text        NULL,
  quantity               integer     NULL,
  note                   text        NULL,
  record_version         integer     NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid        NOT NULL,
  updated_at             timestamptz NULL,
  updated_by             uuid        NULL,
  deleted_at             timestamptz NULL,
  deleted_by             uuid        NULL,

  CONSTRAINT pk_appointment_services PRIMARY KEY (id),
  CONSTRAINT uq_appointment_services_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_appointment_services_appointment
    FOREIGN KEY (tenant_id, company_id, branch_id, appointment_id)
    REFERENCES apt.appointments (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  -- At least one service descriptor (a future catalog reference OR requester text).
  CONSTRAINT ck_appointment_services_descriptor CHECK (
    future_service_id IS NOT NULL
    OR (requested_service_text IS NOT NULL AND btrim(requested_service_text) <> '')
  ),
  CONSTRAINT ck_appointment_services_text_not_blank
    CHECK (requested_service_text IS NULL OR btrim(requested_service_text) <> ''),
  CONSTRAINT ck_appointment_services_quantity CHECK (quantity IS NULL OR quantity > 0)
);

COMMENT ON TABLE apt.appointment_services IS
  'Phase 1-8 appointment requested-services child (P1-08-DB-002). Branch-scoped intake demand only (not the service catalog, not a work order). Each row carries a future catalog reference (future_service_id — placeholder uuid, NO FK until P1-10) OR requester free text; at least one required. Duplicate active descriptors rejected per appointment.';
COMMENT ON COLUMN apt.appointment_services.future_service_id IS
  'P1-10 forward contract: placeholder reference to a future governed service-catalog row. Intentionally has NO foreign key in Phase 1-8 (the catalog is P1-10). Do not add a fake catalog to satisfy it; P1-10 introduces the FK via forward migration.';

-- Non-partial FK-covering index for the composite parent FK (P1-03-DB-017): the
-- candidate key uq_appointment_services_scope_id leads with {tenant,company,branch}
-- only, so the appointment FK needs its own covering index.
CREATE INDEX ix_appointment_services_appointment
  ON apt.appointment_services (tenant_id, company_id, branch_id, appointment_id);
-- One active row per requested text / per future reference within an appointment.
CREATE UNIQUE INDEX uq_appointment_services_active_text
  ON apt.appointment_services (appointment_id, requested_service_text)
  WHERE requested_service_text IS NOT NULL AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_appointment_services_active_future
  ON apt.appointment_services (appointment_id, future_service_id)
  WHERE future_service_id IS NOT NULL AND deleted_at IS NULL;

CREATE TRIGGER tg_appointment_services_immutable
  BEFORE UPDATE ON apt.appointment_services
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'appointment_id', 'created_at', 'created_by');
CREATE TRIGGER tg_appointment_services_touch_metadata
  BEFORE UPDATE ON apt.appointment_services
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE apt.appointment_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE apt.appointment_services FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_appointment_services_scope ON apt.appointment_services
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_appointment_services_scope ON apt.appointment_services
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_appointment_services_scope ON apt.appointment_services
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON apt.appointment_services TO app_runtime;
GRANT SELECT ON apt.appointment_services TO app_readonly;
