-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: customer segments and dated partner segment assignments
-- Tasks: P1-06-DB-007
-- Owner module: crm
--
-- Purpose
--   crm.customer_segments — tenant configuration (a named segment with a
--   soft-delete-aware unique code). crm.partner_segment_assignments — dated,
--   attributable assignments of a partner to a segment; two active assignments
--   of the same segment to the same partner may not overlap. No backend
--   segmentation/scoring logic (Phase 1-16).
--
-- Dependencies
--   crm.business_partners; org.tenants; btree_gist; shared.touch_row_metadata /
--   org.guard_immutable_columns; iam.current_tenant_id.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   segment/assignment rows exist.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant-scoped per-command policies; no DELETE grant.
--   * Same-tenant composite FKs (partner and segment). Assignments are ended by
--     setting valid_to, not deleted.
--
-- Objects created
--   Tables:    crm.customer_segments, crm.partner_segment_assignments
--   Triggers:  tg_customer_segments_touch_metadata, tg_customer_segments_immutable,
--              tg_partner_segment_assignments_touch_metadata,
--              tg_partner_segment_assignments_immutable
--   Policies:  sel/ins/upd for both tables
--   Indexes:   uq_customer_segments_code_active, ix_customer_segments_tenant,
--              ex_partner_segment_assignments_no_overlap, ix_partner_segment_assignments_lookup,
--              ix_partner_segment_assignments_segment
-- ============================================================================

CREATE TABLE crm.customer_segments (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  segment_code   text        NOT NULL,
  name           text        NOT NULL,
  criteria_note  text        NULL,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_customer_segments PRIMARY KEY (id),
  CONSTRAINT uq_customer_segments_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_customer_segments_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_customer_segments_code_format
    CHECK (segment_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_customer_segments_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_customer_segments_status CHECK (status IN ('active', 'disabled'))
);

COMMENT ON TABLE crm.customer_segments IS
  'Phase 1-6 tenant segment configuration (P1-06-DB-007). Code unique per tenant among live rows.';

CREATE UNIQUE INDEX uq_customer_segments_code_active
  ON crm.customer_segments (tenant_id, segment_code)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_customer_segments_tenant ON crm.customer_segments (tenant_id);

CREATE TRIGGER tg_customer_segments_touch_metadata
  BEFORE UPDATE ON crm.customer_segments
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_customer_segments_immutable
  BEFORE UPDATE ON crm.customer_segments
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'segment_code', 'created_at', 'created_by');

ALTER TABLE crm.customer_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.customer_segments FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_customer_segments_tenant ON crm.customer_segments
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_customer_segments_tenant ON crm.customer_segments
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_customer_segments_tenant ON crm.customer_segments
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.customer_segments TO app_runtime;
GRANT SELECT ON crm.customer_segments TO app_readonly;

-- ---------------------------------------------------------------------------
CREATE TABLE crm.partner_segment_assignments (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  partner_id     uuid        NOT NULL,
  segment_id     uuid        NOT NULL,
  assigned_by    uuid        NOT NULL,
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  valid_from     date        NOT NULL,
  valid_to       date        NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_partner_segment_assignments PRIMARY KEY (id),
  CONSTRAINT fk_partner_segment_assignments_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_partner_segment_assignments_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_partner_segment_assignments_segment
    FOREIGN KEY (tenant_id, segment_id)
    REFERENCES crm.customer_segments (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_partner_segment_assignments_valid_range
    CHECK (valid_to IS NULL OR valid_to > valid_from),
  -- No overlapping active assignments of the same segment to the same partner.
  CONSTRAINT ex_partner_segment_assignments_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    partner_id WITH =,
    segment_id WITH =,
    daterange(valid_from, valid_to, '[)') WITH &&
  )
);

COMMENT ON TABLE crm.partner_segment_assignments IS
  'Phase 1-6 dated partner->segment assignments (P1-06-DB-007). Same-tenant partner and segment; overlapping same-segment assignments are excluded.';

CREATE INDEX ix_partner_segment_assignments_lookup
  ON crm.partner_segment_assignments (tenant_id, partner_id, valid_from);
CREATE INDEX ix_partner_segment_assignments_segment
  ON crm.partner_segment_assignments (tenant_id, segment_id);

CREATE TRIGGER tg_partner_segment_assignments_touch_metadata
  BEFORE UPDATE ON crm.partner_segment_assignments
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_partner_segment_assignments_immutable
  BEFORE UPDATE ON crm.partner_segment_assignments
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'segment_id', 'valid_from', 'assigned_by', 'assigned_at',
    'created_at', 'created_by');

ALTER TABLE crm.partner_segment_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.partner_segment_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_partner_segment_assignments_tenant ON crm.partner_segment_assignments
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_partner_segment_assignments_tenant ON crm.partner_segment_assignments
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_partner_segment_assignments_tenant ON crm.partner_segment_assignments
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.partner_segment_assignments TO app_runtime;
GRANT SELECT ON crm.partner_segment_assignments TO app_readonly;
