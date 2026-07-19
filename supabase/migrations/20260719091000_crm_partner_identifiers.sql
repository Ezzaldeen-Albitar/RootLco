-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: partner identifiers (normalized, typed, per-permission gated)
-- Tasks: P1-06-DB-004
-- Owner module: crm
--
-- Purpose
--   Create crm.partner_identifiers — normalized, typed identifiers for a
--   business partner (phone, email, national_id, registration, other) with
--   tenant-scoped per-type uniqueness among live rows. This is the ONLY place
--   raw restricted identifier VALUES (national_id, registration) live; they are
--   gated per-permission at the row level via iam.has_permission('iam.sensitive.view').
--   Profile _ref pointers (later migrations) reference this table's same-partner
--   candidate key so a profile can only point at its own partner's identifier.
--
--   Deliberately NOT here: any duplicate-scoring engine (Phase 1-16), and any
--   backend that catches the tenant-scoped-uniqueness 23505 and routes it to the
--   duplicate-candidate flow (Phase 1-16 — see the SEC-004 residual note below).
--
-- Dependencies
--   crm.business_partners (20260719090000); org.tenants; iam.current_tenant_id /
--   iam.has_permission; shared.touch_row_metadata / org.guard_immutable_columns.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once identifier rows exist.
--
-- Security implications
--   * WRITABLE classification table — hardened against the two bypasses a
--     SELECT-only precedent (shared.notes) never faced:
--       (a) MISLABEL-ON-INSERT: ck_partner_identifiers_type_classification forces
--           national_id/registration => 'restricted' and phone/email => 'internal',
--           so a restricted value cannot be inserted as 'internal'.
--       (b) DOWNGRADE-ON-UPDATE: identifier_type AND classification are immutable
--           (guard_immutable_columns), and the UPDATE policy USING carries the
--           sensitive gate, so an unprivileged session cannot touch (or downgrade,
--           or soft-delete) a restricted row at all.
--   * Restricted rows are invisible to a session lacking 'iam.sensitive.view'
--     (row-level SELECT gate on the classification column).
--   * ENABLE + FORCE RLS; no DELETE grant (soft delete only).
--   * SEC-004 residual: the tenant-scoped partial-unique index enforces beneath
--     RLS, so a raw INSERT of an existing national_id yields 23505 — a
--     restricted-existence oracle. The backend (Phase 1-16) MUST catch 23505 and
--     return a generic "possible duplicate, routed to review" WITHOUT echoing
--     the constraint DETAIL, and route restricted-identifier dedup through a
--     path that holds 'iam.sensitive.view'.
--
-- Objects created
--   Tables:    crm.partner_identifiers
--   Triggers:  tg_partner_identifiers_touch_metadata, tg_partner_identifiers_immutable
--   Policies:  sel_partner_identifiers_tenant, ins_partner_identifiers_tenant,
--              upd_partner_identifiers_tenant
--   Indexes:   uq_partner_identifiers_value_active, uq_partner_identifiers_primary_active
-- ============================================================================

CREATE TABLE crm.partner_identifiers (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  partner_id       uuid        NOT NULL,
  identifier_type  text        NOT NULL,
  -- Deterministic normalized form used for uniqueness and matching.
  normalized_value text        NOT NULL,
  -- Optional display/raw form. Restricted-type raw values are gated with the row.
  raw_value        text        NULL,
  classification   text        NOT NULL DEFAULT 'internal',
  is_primary       boolean     NOT NULL DEFAULT false,
  verified_at      timestamptz NULL,
  record_version   integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid        NULL,
  deleted_at       timestamptz NULL,
  deleted_by       uuid        NULL,

  CONSTRAINT pk_partner_identifiers PRIMARY KEY (id),
  CONSTRAINT uq_partner_identifiers_tenant_id UNIQUE (tenant_id, id),
  -- Same-partner candidate key: profile _ref FKs bind (tenant_id, partner_id, id)
  -- so a profile pointer can only reference its OWN partner's identifier.
  CONSTRAINT uq_partner_identifiers_tenant_partner_id UNIQUE (tenant_id, partner_id, id),
  CONSTRAINT fk_partner_identifiers_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_partner_identifiers_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,

  CONSTRAINT ck_partner_identifiers_type
    CHECK (identifier_type IN ('phone', 'email', 'national_id', 'registration', 'other')),
  CONSTRAINT ck_partner_identifiers_classification
    CHECK (classification IN ('internal', 'restricted')),
  -- Coupling: sensitive identifier types are always restricted; contact types
  -- are always internal; 'other' may be either. Blocks mislabel-on-insert.
  CONSTRAINT ck_partner_identifiers_type_classification CHECK (
    (identifier_type IN ('national_id', 'registration') AND classification = 'restricted')
    OR (identifier_type IN ('phone', 'email') AND classification = 'internal')
    OR (identifier_type = 'other')
  ),
  CONSTRAINT ck_partner_identifiers_normalized_not_blank
    CHECK (btrim(normalized_value) <> '' AND char_length(normalized_value) <= 512),
  CONSTRAINT ck_partner_identifiers_raw_len
    CHECK (raw_value IS NULL OR char_length(raw_value) <= 512)
);

COMMENT ON TABLE crm.partner_identifiers IS
  'Phase 1-6 normalized typed partner identifiers (P1-06-DB-004). The only store of raw restricted identifier values (national_id/registration); those rows are row-level gated by iam.has_permission(''iam.sensitive.view'').';

-- Tenant-scoped per-type uniqueness among live rows; a value frees on soft delete.
CREATE UNIQUE INDEX uq_partner_identifiers_value_active
  ON crm.partner_identifiers (tenant_id, identifier_type, normalized_value)
  WHERE deleted_at IS NULL;

-- At most one live primary per (partner, type).
CREATE UNIQUE INDEX uq_partner_identifiers_primary_active
  ON crm.partner_identifiers (tenant_id, partner_id, identifier_type)
  WHERE is_primary AND deleted_at IS NULL;

CREATE TRIGGER tg_partner_identifiers_touch_metadata
  BEFORE UPDATE ON crm.partner_identifiers
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_partner_identifiers_immutable
  BEFORE UPDATE ON crm.partner_identifiers
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'identifier_type', 'classification', 'created_at', 'created_by');

ALTER TABLE crm.partner_identifiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.partner_identifiers FORCE ROW LEVEL SECURITY;

-- Restricted rows require the sensitive-view permission (row-level gate).
CREATE POLICY sel_partner_identifiers_tenant ON crm.partner_identifiers
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (classification = 'internal' OR iam.has_permission('iam.sensitive.view'))
  );

CREATE POLICY ins_partner_identifiers_tenant ON crm.partner_identifiers
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());

-- The sensitive gate is in USING so an unprivileged session cannot update,
-- downgrade, or soft-delete a restricted row.
CREATE POLICY upd_partner_identifiers_tenant ON crm.partner_identifiers
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND (classification = 'internal' OR iam.has_permission('iam.sensitive.view'))
  )
  WITH CHECK (tenant_id = iam.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON crm.partner_identifiers TO app_runtime;
GRANT SELECT ON crm.partner_identifiers TO app_readonly;
