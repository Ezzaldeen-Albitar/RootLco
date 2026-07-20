-- ============================================================================
-- Phase: 1-8 — Appointment and Vehicle Reception Database
-- Migration: the Appointment master
-- Tasks: P1-08-DB-001 (master), P1-08-DB-005 (conflict support), DB-014 (display #)
-- Owner module: apt
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once appointments exist. Forward-only — no down script.
--
-- Purpose
--   apt.appointments is the branch-scoped appointment master: expected intake
--   demand for a specific Vehicle and requesting partner within a branch. It
--   carries a requested window and (once confirmed) a confirmed window; only
--   CONFIRMED (or checked_in) appointments reserve constrained capacity, and a
--   single Vehicle may not hold two overlapping confirmed appointments. The
--   lifecycle status machine and its transitions are guarded here; cancellation
--   and no-show are integrated on the master (set-once) and evidenced by the
--   append-only status history (added in a later migration). No work order is
--   created; check-in hands the Vehicle to the reception module (Phase 1-8 rec).
--
-- Dependencies
--   org.branches (tenant_id,company_id,id) — branch scope; veh.vehicles
--   (tenant_id,id); crm.business_partners (tenant_id,id); apt.appointment_types /
--   apt.source_channels / apt.cancellation_reasons; iam.current_tenant_id /
--   allowed_company_ids / allowed_branch_ids; shared.touch_row_metadata;
--   org.guard_immutable_columns; shared.next_display_number (runtime only);
--   btree_gist (uuid equality in the confirmed-overlap EXCLUDE).
--
-- Details
--   Branch scope follows the org.warehouses precedent: (tenant_id, company_id,
--   branch_id) with a composite FK to org.branches, so the branch belongs to the
--   company+tenant by FK (not RLS alone). Vehicle and requester are same-tenant
--   composite FKs. confirmed_range is a STORED generated tstzrange used by the
--   branch calendar index and the same-Vehicle confirmed-overlap EXCLUDE.
--   display_number is allocated at runtime via shared.next_display_number
--   ('appointment', company_id, branch_id); the sequence row is provisioned
--   admin-side at onboarding, never seeded. Gaps are expected (a rolled-back
--   transaction consumes a number) — display numbers are human references.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant + company + branch scoped (allowed_*_ids());
--     scope columns immutable; catalog refs fail-closed to platform-or-same-tenant.
--   * app roles NOBYPASSRLS; no DELETE grant (soft delete only).
--
-- Objects created
--   Tables:    apt.appointments
--   Functions: apt.guard_appointment_catalog_refs(), apt.guard_appointment_transition()
--   Triggers:  tg_appointments_catalog_refs, tg_appointments_transition,
--              tg_appointments_immutable, tg_appointments_touch_metadata
--   Policies:  sel_appointments_scope, ins_appointments_scope, upd_appointments_scope
--   Indexes:   uq_appointments_scope_id, uq_appointments_tenant_id,
--              uq_appointments_active_display_number, ix_appointments_vehicle,
--              ix_appointments_requester, ix_appointments_type, ix_appointments_source,
--              ix_appointments_cancel_reason, ix_appointments_confirmed,
--              ix_appointments_status, ex_appointments_vehicle_confirmed
-- ============================================================================

CREATE TABLE apt.appointments (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  company_id           uuid        NOT NULL,
  branch_id            uuid        NOT NULL,
  vehicle_id           uuid        NOT NULL,
  requester_partner_id uuid        NOT NULL,
  appointment_type_id  uuid        NOT NULL,
  source_channel_id    uuid        NULL,
  requested_from       timestamptz NOT NULL,
  requested_to         timestamptz NOT NULL,
  confirmed_from       timestamptz NULL,
  confirmed_to         timestamptz NULL,
  confirmed_range      tstzrange   GENERATED ALWAYS AS (
    CASE WHEN confirmed_from IS NOT NULL AND confirmed_to IS NOT NULL
      THEN tstzrange(confirmed_from, confirmed_to, '[)') END
  ) STORED,
  lifecycle_status     text        NOT NULL DEFAULT 'requested',
  cancellation_reason_id uuid      NULL,
  cancelled_at         timestamptz NULL,
  cancelled_by         uuid        NULL,
  no_show_recorded_at  timestamptz NULL,
  no_show_recorded_by  uuid        NULL,
  display_number       text        NULL,
  record_version       integer     NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,
  updated_at           timestamptz NULL,
  updated_by           uuid        NULL,
  deleted_at           timestamptz NULL,
  deleted_by           uuid        NULL,

  CONSTRAINT pk_appointments PRIMARY KEY (id),
  CONSTRAINT uq_appointments_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT uq_appointments_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_appointments_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_requester
    FOREIGN KEY (tenant_id, requester_partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_type
    FOREIGN KEY (appointment_type_id) REFERENCES apt.appointment_types (id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_source
    FOREIGN KEY (source_channel_id) REFERENCES apt.source_channels (id) ON DELETE RESTRICT,
  CONSTRAINT fk_appointments_cancel_reason
    FOREIGN KEY (cancellation_reason_id) REFERENCES apt.cancellation_reasons (id) ON DELETE RESTRICT,
  CONSTRAINT ck_appointments_status CHECK (lifecycle_status IN (
    'requested', 'pending_confirmation', 'confirmed', 'checked_in', 'cancelled', 'no_show')),
  CONSTRAINT ck_appointments_requested_window CHECK (requested_to > requested_from),
  CONSTRAINT ck_appointments_confirmed_pair CHECK ((confirmed_from IS NULL) = (confirmed_to IS NULL)),
  CONSTRAINT ck_appointments_confirmed_window
    CHECK (confirmed_from IS NULL OR confirmed_to > confirmed_from),
  -- A confirmed / checked-in appointment must carry a confirmed window.
  CONSTRAINT ck_appointments_confirmed_required
    CHECK (lifecycle_status NOT IN ('confirmed', 'checked_in') OR confirmed_from IS NOT NULL),
  -- Cancellation is coherent: reason + timestamp iff cancelled.
  CONSTRAINT ck_appointments_cancel_coherent CHECK (
    (lifecycle_status = 'cancelled')
      = (cancellation_reason_id IS NOT NULL AND cancelled_at IS NOT NULL)
  ),
  -- No-show is coherent: timestamp iff no_show.
  CONSTRAINT ck_appointments_no_show_coherent
    CHECK ((lifecycle_status = 'no_show') = (no_show_recorded_at IS NOT NULL)),
  CONSTRAINT ck_appointments_display_number_not_blank
    CHECK (display_number IS NULL OR btrim(display_number) <> ''),
  -- A single Vehicle may not hold two overlapping CONFIRMED/checked-in appointments.
  CONSTRAINT ex_appointments_vehicle_confirmed EXCLUDE USING gist (
    tenant_id WITH =, vehicle_id WITH =, confirmed_range WITH &&
  ) WHERE (
    confirmed_range IS NOT NULL AND lifecycle_status IN ('confirmed', 'checked_in')
    AND deleted_at IS NULL
  )
);

COMMENT ON TABLE apt.appointments IS
  'Phase 1-8 branch-scoped appointment master (P1-08-DB-001). Expected intake demand for a Vehicle + requesting partner in a branch. Only confirmed/checked_in reserve capacity; a Vehicle cannot hold two overlapping confirmed appointments. Lifecycle transitions guarded; cancellation/no-show integrated (set-once) + append-only status history. No work order; check-in hands off to reception.';
COMMENT ON COLUMN apt.appointments.confirmed_range IS
  'Generated (STORED) tstzrange [confirmed_from, confirmed_to) when both are set; basis for the branch calendar index and the same-Vehicle confirmed-overlap EXCLUDE. Never set directly.';
COMMENT ON COLUMN apt.appointments.display_number IS
  'Tenant/branch human reference, allocated at runtime via shared.next_display_number(''appointment'', company_id, branch_id). Sequence row provisioned admin-side at onboarding, never seeded.';

-- Candidate key uq_appointments_scope_id (tenant,company,branch,id) covers the
-- branch FK (leading {tenant,company,branch}) and the tenant FK ({tenant}); it is
-- also the composite parent key appointment children FK against.
-- Active display-number uniqueness (per tenant).
CREATE UNIQUE INDEX uq_appointments_active_display_number
  ON apt.appointments (tenant_id, display_number)
  WHERE display_number IS NOT NULL AND deleted_at IS NULL;
-- Non-partial FK-covering indexes (P1-03-DB-017).
CREATE INDEX ix_appointments_vehicle ON apt.appointments (tenant_id, vehicle_id);
CREATE INDEX ix_appointments_requester ON apt.appointments (tenant_id, requester_partner_id);
CREATE INDEX ix_appointments_type ON apt.appointments (appointment_type_id);
CREATE INDEX ix_appointments_source ON apt.appointments (source_channel_id);
CREATE INDEX ix_appointments_cancel_reason ON apt.appointments (cancellation_reason_id);
-- Branch calendar (confirmed conflict) + status lookups.
CREATE INDEX ix_appointments_confirmed
  ON apt.appointments USING gist (tenant_id, company_id, branch_id, confirmed_range)
  WHERE confirmed_range IS NOT NULL;
CREATE INDEX ix_appointments_status
  ON apt.appointments (tenant_id, company_id, branch_id, lifecycle_status);

-- ----------------------------------------------------------------------------
-- Catalog-reference guard: type/source/cancellation_reason must be visible
-- (platform or same-tenant). SECURITY INVOKER so RLS hides cross-tenant catalog
-- rows (a hidden row is NOT FOUND -> reject; a plain FK to the catalog id cannot
-- express platform-or-same-tenant).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apt.guard_appointment_catalog_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM apt.appointment_types WHERE id = NEW.appointment_type_id) THEN
    RAISE EXCEPTION 'appointment_type % is not visible to this tenant', NEW.appointment_type_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.source_channel_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM apt.source_channels WHERE id = NEW.source_channel_id) THEN
    RAISE EXCEPTION 'source_channel % is not visible to this tenant', NEW.source_channel_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF NEW.cancellation_reason_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM apt.cancellation_reasons WHERE id = NEW.cancellation_reason_id) THEN
    RAISE EXCEPTION 'cancellation_reason % is not visible to this tenant', NEW.cancellation_reason_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION apt.guard_appointment_catalog_refs() IS
  'BEFORE INSERT/UPDATE guard on apt.appointments: appointment_type/source_channel/cancellation_reason must be platform-or-same-tenant visible (fail-closed under RLS).';
REVOKE EXECUTE ON FUNCTION apt.guard_appointment_catalog_refs() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- Lifecycle transition guard (state machine). One actual change is validated
-- against the approved matrix; no-show only from confirmed, check-in only from
-- confirmed, cancellation from requested/pending/confirmed, terminal states are
-- frozen. Emitting the append-only history row is a later migration.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apt.guard_appointment_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.lifecycle_status = OLD.lifecycle_status THEN
    RETURN NEW;
  END IF;
  IF NOT (
    (OLD.lifecycle_status = 'requested'
       AND NEW.lifecycle_status IN ('pending_confirmation', 'confirmed', 'cancelled'))
    OR (OLD.lifecycle_status = 'pending_confirmation'
       AND NEW.lifecycle_status IN ('confirmed', 'cancelled'))
    OR (OLD.lifecycle_status = 'confirmed'
       AND NEW.lifecycle_status IN ('checked_in', 'cancelled', 'no_show'))
  ) THEN
    RAISE EXCEPTION 'invalid appointment transition % -> %', OLD.lifecycle_status, NEW.lifecycle_status
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION apt.guard_appointment_transition() IS
  'BEFORE UPDATE OF lifecycle_status on apt.appointments: enforces the approved transition matrix (no-show/check-in only from confirmed; cancel from requested/pending/confirmed; cancelled/no_show/checked_in terminal).';
REVOKE EXECUTE ON FUNCTION apt.guard_appointment_transition() FROM PUBLIC;

CREATE TRIGGER tg_appointments_catalog_refs
  BEFORE INSERT OR UPDATE OF appointment_type_id, source_channel_id, cancellation_reason_id
  ON apt.appointments
  FOR EACH ROW EXECUTE FUNCTION apt.guard_appointment_catalog_refs();
CREATE TRIGGER tg_appointments_transition
  BEFORE UPDATE OF lifecycle_status ON apt.appointments
  FOR EACH ROW EXECUTE FUNCTION apt.guard_appointment_transition();
CREATE TRIGGER tg_appointments_immutable
  BEFORE UPDATE ON apt.appointments
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'vehicle_id', 'requester_partner_id',
    'appointment_type_id', 'source_channel_id', 'requested_from', 'requested_to',
    'created_at', 'created_by');
CREATE TRIGGER tg_appointments_touch_metadata
  BEFORE UPDATE ON apt.appointments
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE apt.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE apt.appointments FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_appointments_scope ON apt.appointments
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY ins_appointments_scope ON apt.appointments
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  );
CREATE POLICY upd_appointments_scope ON apt.appointments
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON apt.appointments TO app_runtime;
GRANT SELECT ON apt.appointments TO app_readonly;
