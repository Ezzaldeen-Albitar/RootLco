-- ============================================================================
-- Phase: 1-7 — Vehicle Database
-- Migration: vehicle relationships + relationship evidence
-- Tasks: P1-07-DB-012 (relationships), P1-07-DB-013 (evidence)
-- Owner module: veh
--
-- Purpose
--   veh.vehicle_relationships records effective-dated party-to-Vehicle roles
--   (owner/user/driver/fleet_operator/payer/authorized_person/service_requester)
--   — a Vehicle-centric vocabulary independent of the CRM party-centric role
--   taxonomy (they are mapped in docs, never conflated). The Vehicle master is
--   untouched by relationship changes. authorized_person rows carry a validated,
--   versioned authorization_scope JSON; the DB grants NO application privilege by
--   itself (Phase 1-17 enforces authorization). veh.relationship_evidence is an
--   append-only record linking a relationship to a shared document (no payload
--   copied into veh). Mutable-temporal; scope/grant immutable (change = new
--   interval); no DELETE.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once relationships exist. Forward-only — no down script.
--
-- Dependencies
--   veh.vehicles (20260720092000); crm.business_partners; shared.documents;
--   veh.guard_temporal_close; org.tenants; btree_gist; iam.current_tenant_id;
--   shared.touch_row_metadata; org.guard_immutable_columns; shared.stamp_status_history.
--
-- Details
--   authorization_scope contract: a JSON object with a numeric schema_version and
--   an allowed_actions array drawn ONLY from the approved taxonomy, no duplicates.
--   Scope is allowed ONLY on authorized_person rows and requires granted_by.
--   Expiry derives from the relationship interval (valid_to). Evidence deletion /
--   retention is governed by the shared.document_links contract (backend/P1-17);
--   relationship_evidence is the immutable attach record.
--
-- Security implications
--   * ENABLE + FORCE RLS on both; relationships no DELETE; evidence append-only.
--   * scope, granted_by, role, partner, valid_from immutable. Cross-tenant partner
--     and document impossible (composite FKs). Evidence document same-tenant.
--
-- Objects created
--   Tables:    veh.vehicle_relationships, veh.relationship_evidence
--   Functions: veh.valid_authorization_scope(jsonb), veh.relationships_at(uuid,date)
--   Triggers:  tg_vehicle_relationships_touch_metadata/_immutable/_close,
--              tg_relationship_evidence_stamp
--   Policies:  sel_/ins_/upd_vehicle_relationships_tenant,
--              sel_/ins_relationship_evidence_tenant
--   Indexes:   ix_vehicle_relationships_vehicle/_partner,
--              ex_vehicle_relationships_no_overlap,
--              ix_relationship_evidence_relationship/_document
-- ============================================================================

-- Authorization-scope validator (pure): object with numeric schema_version and an
-- allowed_actions array of approved, non-duplicated action tokens. NULL is valid.
CREATE OR REPLACE FUNCTION veh.valid_authorization_scope(p jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT p IS NULL OR (
    jsonb_typeof(p) = 'object'
    AND jsonb_typeof(p -> 'schema_version') = 'number'
    AND jsonb_typeof(p -> 'allowed_actions') = 'array'
    AND NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(p -> 'allowed_actions') AS e
       WHERE jsonb_typeof(e) <> 'string'
         OR (e #>> '{}') NOT IN (
           'approve_quotation', 'approve_additional_work', 'receive_vehicle',
           'receive_reports', 'receive_invoices', 'communicate_about_service'
         )
    )
    AND (
      SELECT count(*) = count(DISTINCT e #>> '{}')
        FROM jsonb_array_elements(p -> 'allowed_actions') AS e
    )
  );
$$;
COMMENT ON FUNCTION veh.valid_authorization_scope(jsonb) IS
  'Phase 1-7 authorized-person scope validator (P1-07-DB-012): object with numeric schema_version and an allowed_actions array of approved, non-duplicated tokens. NULL is valid. Grants no privilege — Phase 1-17 enforces authorization.';
REVOKE EXECUTE ON FUNCTION veh.valid_authorization_scope(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.valid_authorization_scope(jsonb) TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 1. veh.vehicle_relationships
-- ----------------------------------------------------------------------------
CREATE TABLE veh.vehicle_relationships (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  vehicle_id          uuid        NOT NULL,
  partner_id          uuid        NOT NULL,
  relationship_role   text        NOT NULL,
  valid_from          date        NOT NULL,
  valid_to            date        NULL,
  authorization_scope jsonb       NULL,
  granted_by          uuid        NULL,
  record_version      integer     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid        NULL,

  CONSTRAINT pk_vehicle_relationships PRIMARY KEY (id),
  CONSTRAINT uq_vehicle_relationships_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_vehicle_relationships_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_relationships_vehicle
    FOREIGN KEY (tenant_id, vehicle_id)
    REFERENCES veh.vehicles (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_vehicle_relationships_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_vehicle_relationships_role CHECK (relationship_role IN (
    'owner', 'user', 'driver', 'fleet_operator', 'payer', 'authorized_person', 'service_requester'
  )),
  CONSTRAINT ck_vehicle_relationships_valid_range CHECK (valid_to IS NULL OR valid_to > valid_from),
  -- Scope only on authorized_person, and requires an attributed grantor.
  CONSTRAINT ck_vehicle_relationships_scope_role
    CHECK (authorization_scope IS NULL OR relationship_role = 'authorized_person'),
  CONSTRAINT ck_vehicle_relationships_scope_granted
    CHECK (authorization_scope IS NULL OR granted_by IS NOT NULL),
  CONSTRAINT ck_vehicle_relationships_scope_valid
    CHECK (veh.valid_authorization_scope(authorization_scope)),
  -- Same role for the same partner on the same Vehicle may not overlap in time.
  CONSTRAINT ex_vehicle_relationships_no_overlap EXCLUDE USING gist (
    tenant_id WITH =, vehicle_id WITH =, partner_id WITH =, relationship_role WITH =,
    daterange(valid_from, valid_to, '[)') WITH &&
  )
);
COMMENT ON TABLE veh.vehicle_relationships IS
  'Phase 1-7 mutable-temporal party-to-Vehicle roles (P1-07-DB-012, Fig 4.13). Vehicle-centric vocabulary, independent of the CRM role taxonomy. authorized_person rows carry a validated versioned authorization_scope (no DB privilege granted). Same role/partner/Vehicle non-overlap; scope/grant immutable; no DELETE.';

CREATE INDEX ix_vehicle_relationships_vehicle
  ON veh.vehicle_relationships (tenant_id, vehicle_id, valid_from);
CREATE INDEX ix_vehicle_relationships_partner
  ON veh.vehicle_relationships (tenant_id, partner_id);

CREATE TRIGGER tg_vehicle_relationships_touch_metadata
  BEFORE UPDATE ON veh.vehicle_relationships
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_vehicle_relationships_immutable
  BEFORE UPDATE ON veh.vehicle_relationships
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'vehicle_id', 'partner_id', 'relationship_role', 'valid_from',
    'authorization_scope', 'granted_by', 'created_at', 'created_by');
CREATE TRIGGER tg_vehicle_relationships_close
  BEFORE UPDATE ON veh.vehicle_relationships
  FOR EACH ROW EXECUTE FUNCTION veh.guard_temporal_close();

CREATE OR REPLACE FUNCTION veh.relationships_at(p_vehicle_id uuid, p_at date)
RETURNS TABLE (id uuid, partner_id uuid, relationship_role text)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT id, partner_id, relationship_role
    FROM veh.vehicle_relationships
   WHERE vehicle_id = p_vehicle_id
     AND valid_from <= p_at
     AND (valid_to IS NULL OR valid_to > p_at)
   ORDER BY relationship_role;
$$;
REVOKE EXECUTE ON FUNCTION veh.relationships_at(uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION veh.relationships_at(uuid, date) TO app_runtime, app_readonly;

ALTER TABLE veh.vehicle_relationships ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.vehicle_relationships FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_vehicle_relationships_tenant ON veh.vehicle_relationships
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_vehicle_relationships_tenant ON veh.vehicle_relationships
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_vehicle_relationships_tenant ON veh.vehicle_relationships
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON veh.vehicle_relationships TO app_runtime;
GRANT SELECT ON veh.vehicle_relationships TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. veh.relationship_evidence (append-only)
-- ----------------------------------------------------------------------------
CREATE TABLE veh.relationship_evidence (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  relationship_id uuid        NOT NULL,
  document_id     uuid        NULL,
  evidence_kind   text        NOT NULL,
  note            text        NULL,
  correlation_id  uuid        NULL,
  actor_id        uuid        NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  seq             bigint      GENERATED ALWAYS AS IDENTITY,

  CONSTRAINT pk_relationship_evidence PRIMARY KEY (id),
  CONSTRAINT fk_relationship_evidence_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_relationship_evidence_relationship
    FOREIGN KEY (tenant_id, relationship_id)
    REFERENCES veh.vehicle_relationships (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_relationship_evidence_document
    FOREIGN KEY (tenant_id, document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_relationship_evidence_kind_not_blank CHECK (btrim(evidence_kind) <> ''),
  CONSTRAINT ck_relationship_evidence_note_not_blank CHECK (note IS NULL OR btrim(note) <> '')
);
COMMENT ON TABLE veh.relationship_evidence IS
  'Phase 1-7 append-only relationship evidence (P1-07-DB-013). Links a relationship to a same-tenant shared.documents record (no payload copied into veh). Server-stamped; document reachability is revoked via the shared.document_links contract (backend/P1-17).';

CREATE INDEX ix_relationship_evidence_relationship
  ON veh.relationship_evidence (tenant_id, relationship_id, occurred_at DESC, seq DESC);
CREATE INDEX ix_relationship_evidence_document
  ON veh.relationship_evidence (tenant_id, document_id);

CREATE TRIGGER tg_relationship_evidence_stamp
  BEFORE INSERT ON veh.relationship_evidence
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_status_history();

ALTER TABLE veh.relationship_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE veh.relationship_evidence FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_relationship_evidence_tenant ON veh.relationship_evidence
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_relationship_evidence_tenant ON veh.relationship_evidence
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON veh.relationship_evidence TO app_runtime;
GRANT SELECT ON veh.relationship_evidence TO app_readonly;
