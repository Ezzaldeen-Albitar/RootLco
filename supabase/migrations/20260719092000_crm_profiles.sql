-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: individual/company profiles and gated sensitive attributes
-- Tasks: P1-06-DB-002, P1-06-DB-003, P1-06-SEC-001
-- Owner module: crm
--
-- Purpose
--   Create the 1:1 profile detail for a business partner:
--     * crm.individual_profiles  — for party_type 'individual'
--     * crm.company_profiles      — for party_type 'organization'
--   plus crm.partner_sensitive_attributes — the row-gated store for restricted
--   scalar attributes (date_of_birth today), reusing the iam.sensitive.view
--   primitive so a plain SELECT never exposes a restricted value.
--
--   Profile/type exclusivity is DECLARATIVE (no trigger): each profile pins a
--   constant party_type column and references business_partners'
--   (tenant_id, id, party_type) discriminator candidate key, so an individual
--   profile can attach only to an individual partner (and party_type is
--   immutable on the partner). Restricted identifier pointers (national_id_ref,
--   registration_ref, tax_ref) are same-partner composite FKs into
--   crm.partner_identifiers — the profile holds only a uuid, never a raw value.
--
--   Deliberately NOT here: the shared.search_metadata projection of normalized
--   names (P1-06-DB-021 backend/admin write-path). The generated *_normalized
--   columns give in-table case-folded matching; richer search normalization is
--   the projection's job.
--
-- Dependencies
--   crm.business_partners, crm.partner_identifiers, shared.languages,
--   org.tenants; shared.touch_row_metadata / org.guard_immutable_columns;
--   iam.current_tenant_id / iam.has_permission.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once profile rows exist.
--
-- Security implications
--   * Profiles carry personal data classified 'internal' (names/locale); no raw
--     restricted value lives here — only same-partner uuid pointers.
--   * partner_sensitive_attributes is a WRITABLE classification-bearing table
--     hardened per the Wave 1 C1 finding: classification is pinned 'restricted'
--     by CHECK and immutable; the SELECT and UPDATE policies both gate on
--     iam.has_permission('iam.sensitive.view'); attribute_type<->value coupling
--     is enforced.
--   * ENABLE + FORCE RLS on all three; no DELETE grant (soft delete only).
--
-- Objects created
--   Tables:    crm.individual_profiles, crm.company_profiles,
--              crm.partner_sensitive_attributes
--   Triggers:  tg_individual_profiles_touch_metadata, tg_individual_profiles_immutable,
--              tg_company_profiles_touch_metadata, tg_company_profiles_immutable,
--              tg_partner_sensitive_attributes_touch_metadata,
--              tg_partner_sensitive_attributes_immutable
--   Policies:  sel/ins/upd for each of the three tables
-- ============================================================================

-- ---------------------------------------------------------------------------
-- crm.individual_profiles (1:1 with individual partners)
-- ---------------------------------------------------------------------------
CREATE TABLE crm.individual_profiles (
  id                     uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id              uuid        NOT NULL,
  partner_id             uuid        NOT NULL,
  -- Pinned discriminator: forces the partner to be 'individual'.
  party_type             text        NOT NULL DEFAULT 'individual',
  given_name             text        NOT NULL,
  family_name            text        NOT NULL,
  given_name_normalized  text        GENERATED ALWAYS AS (lower(btrim(given_name))) STORED,
  family_name_normalized text        GENERATED ALWAYS AS (lower(btrim(family_name))) STORED,
  -- Same-partner pointer to the canonical national_id identifier row (gated there).
  national_id_ref        uuid        NULL,
  preferred_locale       text        NULL,
  record_version         integer     NOT NULL DEFAULT 1,
  created_at             timestamptz NOT NULL DEFAULT now(),
  created_by             uuid        NOT NULL,
  updated_at             timestamptz NULL,
  updated_by             uuid        NULL,

  CONSTRAINT pk_individual_profiles PRIMARY KEY (id),
  CONSTRAINT uq_individual_profiles_partner UNIQUE (tenant_id, partner_id),
  CONSTRAINT fk_individual_profiles_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_individual_profiles_partner_type
    FOREIGN KEY (tenant_id, partner_id, party_type)
    REFERENCES crm.business_partners (tenant_id, id, party_type) ON DELETE RESTRICT,
  CONSTRAINT fk_individual_profiles_national_id
    FOREIGN KEY (tenant_id, partner_id, national_id_ref)
    REFERENCES crm.partner_identifiers (tenant_id, partner_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_individual_profiles_locale
    FOREIGN KEY (preferred_locale) REFERENCES shared.languages (locale_code) ON DELETE RESTRICT,
  CONSTRAINT ck_individual_profiles_party_type CHECK (party_type = 'individual'),
  CONSTRAINT ck_individual_profiles_given_not_blank CHECK (btrim(given_name) <> ''),
  CONSTRAINT ck_individual_profiles_family_not_blank CHECK (btrim(family_name) <> '')
);

COMMENT ON TABLE crm.individual_profiles IS
  'Phase 1-6 individual partner profile (P1-06-DB-002). 1:1 with an individual partner via the party_type discriminator FK. national_id_ref points at the partner''s gated national_id identifier row; date of birth lives in crm.partner_sensitive_attributes.';

CREATE INDEX ix_individual_profiles_national_id
  ON crm.individual_profiles (tenant_id, partner_id, national_id_ref)
  WHERE national_id_ref IS NOT NULL;

CREATE TRIGGER tg_individual_profiles_touch_metadata
  BEFORE UPDATE ON crm.individual_profiles
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_individual_profiles_immutable
  BEFORE UPDATE ON crm.individual_profiles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'party_type', 'created_at', 'created_by');

ALTER TABLE crm.individual_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.individual_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_individual_profiles_tenant ON crm.individual_profiles
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_individual_profiles_tenant ON crm.individual_profiles
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_individual_profiles_tenant ON crm.individual_profiles
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.individual_profiles TO app_runtime;
GRANT SELECT ON crm.individual_profiles TO app_readonly;

-- ---------------------------------------------------------------------------
-- crm.company_profiles (1:1 with organization partners)
-- ---------------------------------------------------------------------------
CREATE TABLE crm.company_profiles (
  id                    uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid        NOT NULL,
  partner_id            uuid        NOT NULL,
  party_type            text        NOT NULL DEFAULT 'organization',
  legal_name            text        NOT NULL,
  trade_name            text        NULL,
  legal_name_normalized text        GENERATED ALWAYS AS (lower(btrim(legal_name))) STORED,
  trade_name_normalized text        GENERATED ALWAYS AS (lower(btrim(trade_name))) STORED,
  registration_ref      uuid        NULL,
  tax_ref               uuid        NULL,
  record_version        integer     NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid        NOT NULL,
  updated_at            timestamptz NULL,
  updated_by            uuid        NULL,

  CONSTRAINT pk_company_profiles PRIMARY KEY (id),
  CONSTRAINT uq_company_profiles_partner UNIQUE (tenant_id, partner_id),
  CONSTRAINT fk_company_profiles_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_company_profiles_partner_type
    FOREIGN KEY (tenant_id, partner_id, party_type)
    REFERENCES crm.business_partners (tenant_id, id, party_type) ON DELETE RESTRICT,
  CONSTRAINT fk_company_profiles_registration
    FOREIGN KEY (tenant_id, partner_id, registration_ref)
    REFERENCES crm.partner_identifiers (tenant_id, partner_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_company_profiles_tax
    FOREIGN KEY (tenant_id, partner_id, tax_ref)
    REFERENCES crm.partner_identifiers (tenant_id, partner_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_company_profiles_party_type CHECK (party_type = 'organization'),
  CONSTRAINT ck_company_profiles_legal_not_blank CHECK (btrim(legal_name) <> ''),
  CONSTRAINT ck_company_profiles_trade_not_blank CHECK (trade_name IS NULL OR btrim(trade_name) <> '')
);

COMMENT ON TABLE crm.company_profiles IS
  'Phase 1-6 organization partner profile (P1-06-DB-003). 1:1 with an organization partner. registration_ref/tax_ref point at the partner''s gated restricted identifier rows.';

CREATE INDEX ix_company_profiles_registration
  ON crm.company_profiles (tenant_id, partner_id, registration_ref)
  WHERE registration_ref IS NOT NULL;
CREATE INDEX ix_company_profiles_tax
  ON crm.company_profiles (tenant_id, partner_id, tax_ref)
  WHERE tax_ref IS NOT NULL;

CREATE TRIGGER tg_company_profiles_touch_metadata
  BEFORE UPDATE ON crm.company_profiles
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_company_profiles_immutable
  BEFORE UPDATE ON crm.company_profiles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'party_type', 'created_at', 'created_by');

ALTER TABLE crm.company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.company_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_company_profiles_tenant ON crm.company_profiles
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_company_profiles_tenant ON crm.company_profiles
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_company_profiles_tenant ON crm.company_profiles
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.company_profiles TO app_runtime;
GRANT SELECT ON crm.company_profiles TO app_readonly;

-- ---------------------------------------------------------------------------
-- crm.partner_sensitive_attributes (row-gated restricted scalar attributes)
-- ---------------------------------------------------------------------------
CREATE TABLE crm.partner_sensitive_attributes (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  partner_id     uuid        NOT NULL,
  attribute_type text        NOT NULL,
  value_date     date        NULL,
  value_text     text        NULL,
  classification text        NOT NULL DEFAULT 'restricted',
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid        NULL,

  CONSTRAINT pk_partner_sensitive_attributes PRIMARY KEY (id),
  CONSTRAINT fk_partner_sensitive_attributes_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_partner_sensitive_attributes_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_partner_sensitive_attributes_type
    CHECK (attribute_type IN ('date_of_birth')),
  -- Always restricted (immutable below), so the row is always sensitive-gated.
  CONSTRAINT ck_partner_sensitive_attributes_classification
    CHECK (classification = 'restricted'),
  -- Value coupling: date_of_birth carries a value_date and no value_text.
  CONSTRAINT ck_partner_sensitive_attributes_value CHECK (
    (attribute_type = 'date_of_birth' AND value_date IS NOT NULL AND value_text IS NULL)
  )
);

COMMENT ON TABLE crm.partner_sensitive_attributes IS
  'Phase 1-6 restricted partner scalar attributes (P1-06-SEC-001), e.g. date_of_birth. Always classification=restricted; row-gated by iam.has_permission(''iam.sensitive.view'') so a plain SELECT never exposes the value.';

-- One live value per (partner, attribute_type).
CREATE UNIQUE INDEX uq_partner_sensitive_attributes_active
  ON crm.partner_sensitive_attributes (tenant_id, partner_id, attribute_type)
  WHERE deleted_at IS NULL;

CREATE TRIGGER tg_partner_sensitive_attributes_touch_metadata
  BEFORE UPDATE ON crm.partner_sensitive_attributes
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_partner_sensitive_attributes_immutable
  BEFORE UPDATE ON crm.partner_sensitive_attributes
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'attribute_type', 'classification', 'created_at', 'created_by');

ALTER TABLE crm.partner_sensitive_attributes ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.partner_sensitive_attributes FORCE ROW LEVEL SECURITY;
-- Every row is restricted; the whole table requires iam.sensitive.view to read.
CREATE POLICY sel_partner_sensitive_attributes_tenant ON crm.partner_sensitive_attributes
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.sensitive.view'));
CREATE POLICY ins_partner_sensitive_attributes_tenant ON crm.partner_sensitive_attributes
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.sensitive.view'));
CREATE POLICY upd_partner_sensitive_attributes_tenant ON crm.partner_sensitive_attributes
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.sensitive.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.sensitive.view'));
GRANT SELECT, INSERT, UPDATE ON crm.partner_sensitive_attributes TO app_runtime;
GRANT SELECT ON crm.partner_sensitive_attributes TO app_readonly;
