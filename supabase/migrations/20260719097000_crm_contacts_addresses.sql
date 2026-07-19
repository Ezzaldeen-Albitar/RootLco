-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: partner contact points and addresses
-- Tasks: P1-06-DB-009, P1-06-DB-010
-- Owner module: crm
--
-- Purpose
--   crm.contact_points — typed contact channels (phone/mobile/email/other) with
--   a deterministically normalized value and at most one active primary per
--   (partner, channel). crm.addresses — typed addresses (billing/service/
--   registered/other) with at most one active primary per (partner, type).
--   Both carry personal data classified 'internal' (tenant-readable; the
--   restricted identifiers live in crm.partner_identifiers).
--
--   country_code is a 2-letter code validated by format only — no reference
--   FK, because the country reference domain is not built (OIR-04 open). A
--   future reference-data phase may add the FK.
--
-- Dependencies
--   crm.business_partners; org.tenants; shared.touch_row_metadata /
--   org.guard_immutable_columns; iam.current_tenant_id.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   rows exist.
--
-- Security implications
--   * ENABLE + FORCE RLS; tenant-scoped policies; no DELETE grant (soft delete).
--   * contact_points exposes a same-partner candidate key (tenant_id, partner_id,
--     id) so consent history can reference a contact point of the SAME partner.
--   * One-active-primary invariant is a partial unique index (concurrency-safe),
--     not a trigger.
--
-- Objects created
--   Tables:    crm.contact_points, crm.addresses
--   Triggers:  tg_contact_points_touch_metadata, tg_contact_points_immutable,
--              tg_addresses_touch_metadata, tg_addresses_immutable
--   Policies:  sel/ins/upd for both tables
--   Indexes:   uq_contact_points_primary_active, ix_contact_points_normalized,
--              uq_addresses_primary_active, ix_addresses_partner
-- ============================================================================

CREATE TABLE crm.contact_points (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  partner_id       uuid        NOT NULL,
  channel          text        NOT NULL,
  normalized_value text        NOT NULL,
  raw_value        text        NULL,
  label            text        NULL,
  is_primary       boolean     NOT NULL DEFAULT false,
  verified_at      timestamptz NULL,
  status           text        NOT NULL DEFAULT 'active',
  record_version   integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid        NULL,
  deleted_at       timestamptz NULL,
  deleted_by       uuid        NULL,

  CONSTRAINT pk_contact_points PRIMARY KEY (id),
  CONSTRAINT uq_contact_points_tenant_partner_id UNIQUE (tenant_id, partner_id, id),
  CONSTRAINT fk_contact_points_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_contact_points_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_contact_points_channel CHECK (channel IN ('phone', 'mobile', 'email', 'other')),
  CONSTRAINT ck_contact_points_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_contact_points_normalized_not_blank
    CHECK (btrim(normalized_value) <> '' AND char_length(normalized_value) <= 512)
);

COMMENT ON TABLE crm.contact_points IS
  'Phase 1-6 partner contact channels (P1-06-DB-009). Personal data classified internal; one active primary per (partner, channel).';

CREATE UNIQUE INDEX uq_contact_points_primary_active
  ON crm.contact_points (tenant_id, partner_id, channel)
  WHERE is_primary AND deleted_at IS NULL;
CREATE INDEX ix_contact_points_normalized
  ON crm.contact_points (tenant_id, channel, normalized_value)
  WHERE deleted_at IS NULL;

CREATE TRIGGER tg_contact_points_touch_metadata
  BEFORE UPDATE ON crm.contact_points
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_contact_points_immutable
  BEFORE UPDATE ON crm.contact_points
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'channel', 'created_at', 'created_by');

ALTER TABLE crm.contact_points ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.contact_points FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_contact_points_tenant ON crm.contact_points
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_contact_points_tenant ON crm.contact_points
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_contact_points_tenant ON crm.contact_points
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.contact_points TO app_runtime;
GRANT SELECT ON crm.contact_points TO app_readonly;

-- ---------------------------------------------------------------------------
CREATE TABLE crm.addresses (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  partner_id     uuid        NOT NULL,
  address_type   text        NOT NULL,
  line1          text        NOT NULL,
  line2          text        NULL,
  line3          text        NULL,
  city           text        NULL,
  region         text        NULL,
  postal_code    text        NULL,
  country_code   text        NULL,
  is_primary     boolean     NOT NULL DEFAULT false,
  status         text        NOT NULL DEFAULT 'active',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_addresses PRIMARY KEY (id),
  CONSTRAINT fk_addresses_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_addresses_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_addresses_type CHECK (address_type IN ('billing', 'service', 'registered', 'other')),
  CONSTRAINT ck_addresses_status CHECK (status IN ('active', 'inactive')),
  CONSTRAINT ck_addresses_line1_not_blank CHECK (btrim(line1) <> ''),
  -- ISO-3166-1 alpha-2 format only; no reference FK while OIR-04 is open.
  CONSTRAINT ck_addresses_country_format CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$')
);

COMMENT ON TABLE crm.addresses IS
  'Phase 1-6 partner addresses (P1-06-DB-010). Personal data classified internal; one active primary per (partner, type). country_code format-only (OIR-04).';

CREATE UNIQUE INDEX uq_addresses_primary_active
  ON crm.addresses (tenant_id, partner_id, address_type)
  WHERE is_primary AND deleted_at IS NULL;
CREATE INDEX ix_addresses_partner ON crm.addresses (tenant_id, partner_id);

CREATE TRIGGER tg_addresses_touch_metadata
  BEFORE UPDATE ON crm.addresses
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_addresses_immutable
  BEFORE UPDATE ON crm.addresses
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'address_type', 'created_at', 'created_by');

ALTER TABLE crm.addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.addresses FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_addresses_tenant ON crm.addresses
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_addresses_tenant ON crm.addresses
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_addresses_tenant ON crm.addresses
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.addresses TO app_runtime;
GRANT SELECT ON crm.addresses TO app_readonly;
