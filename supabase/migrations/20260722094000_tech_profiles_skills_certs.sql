-- ============================================================================
-- Phase: 1-9 — Work Order, Diagnostics, and Technician Database
-- Migration: technician operational profiles, skills, certifications, availability
-- Tasks: P1-09-DB-013 (profiles), DB-014 (tech skills), DB-015 (tech certs),
--        DB-016 (cert credential detail — restricted), DB-017 (availability)
-- Owner module: tech
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   populated. Forward-only — no down script.
--
-- Purpose
--   The technician OPERATIONAL profile references the iam identity anchor
--   (iam.user_accounts) and stores only operational data: home branch, trade,
--   active flag. It DOES NOT duplicate salary, government IDs, personal contact,
--   medical, or payroll data (design §7). Skills/levels and certifications are
--   operational (`internal`) so eligibility and expiry queries work without the
--   sensitive-view permission; a certificate NUMBER is restricted and lives in a
--   1:1 gated detail table (design F11). Availability windows cannot overlap for
--   one technician (a person is in one place at a time), enforced race-safe by a
--   gist EXCLUDE.
--
-- Dependencies
--   org.branches; iam.user_accounts (tenant,id); tech.skills / skill_levels /
--   certifications; iam.current_tenant_id / allowed_company_ids / allowed_branch_ids;
--   iam.has_permission; shared.touch_row_metadata; org.guard_immutable_columns.
--   Requires btree_gist (0001) for the availability EXCLUDE.
--
-- Objects created
--   Tables:   tech.technician_profiles, tech.technician_skills,
--             tech.technician_certifications, tech.technician_certification_details,
--             tech.technician_availability
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. tech.technician_profiles — operational identity (references iam, never copies HR).
-- ----------------------------------------------------------------------------
CREATE TABLE tech.technician_profiles (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  user_id        uuid    NOT NULL,
  trade          text    NULL,
  is_active      boolean NOT NULL DEFAULT true,
  employment_ref text    NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_technician_profiles PRIMARY KEY (id),
  CONSTRAINT uq_technician_profiles_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_technician_profiles_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_technician_profiles_user
    FOREIGN KEY (tenant_id, user_id) REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_technician_profiles_trade_not_blank CHECK (trade IS NULL OR btrim(trade) <> ''),
  CONSTRAINT ck_technician_profiles_employment_ref_not_blank CHECK (employment_ref IS NULL OR btrim(employment_ref) <> '')
);
COMMENT ON TABLE tech.technician_profiles IS
  'Phase 1-9 technician operational profile (P1-09-DB-013). References iam.user_accounts (the identity anchor); stores home branch, trade, active flag. NEVER duplicates salary/government-id/contact/medical/payroll data. employment_ref is an opaque non-PII operational link.';
-- One active operational profile per user per tenant.
CREATE UNIQUE INDEX uq_technician_profiles_active_user
  ON tech.technician_profiles (tenant_id, user_id) WHERE deleted_at IS NULL;
-- Non-partial FK-covering indexes.
CREATE INDEX ix_technician_profiles_user ON tech.technician_profiles (tenant_id, user_id);
CREATE INDEX ix_technician_profiles_branch ON tech.technician_profiles (tenant_id, company_id, branch_id);
CREATE TRIGGER tg_technician_profiles_touch_metadata BEFORE UPDATE ON tech.technician_profiles
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_technician_profiles_immutable BEFORE UPDATE ON tech.technician_profiles
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'user_id', 'created_at', 'created_by');
ALTER TABLE tech.technician_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech.technician_profiles FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_technician_profiles_scope ON tech.technician_profiles FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_technician_profiles_scope ON tech.technician_profiles FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_technician_profiles_scope ON tech.technician_profiles FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tech.technician_profiles TO app_runtime;
GRANT SELECT ON tech.technician_profiles TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. tech.technician_skills — a technician's skill at a proficiency level.
-- ----------------------------------------------------------------------------
CREATE TABLE tech.technician_skills (
  id                    uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid    NOT NULL,
  company_id            uuid    NOT NULL,
  branch_id             uuid    NOT NULL,
  technician_profile_id uuid    NOT NULL,
  skill_id              uuid    NOT NULL,
  skill_level_id        uuid    NOT NULL,
  record_version        integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid    NOT NULL,
  updated_at            timestamptz NULL,
  updated_by            uuid    NULL,
  deleted_at            timestamptz NULL,
  deleted_by            uuid    NULL,

  CONSTRAINT pk_technician_skills PRIMARY KEY (id),
  CONSTRAINT uq_technician_skills_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_technician_skills_profile
    FOREIGN KEY (tenant_id, company_id, branch_id, technician_profile_id)
    REFERENCES tech.technician_profiles (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_technician_skills_skill FOREIGN KEY (skill_id) REFERENCES tech.skills (id) ON DELETE RESTRICT,
  CONSTRAINT fk_technician_skills_level FOREIGN KEY (skill_level_id) REFERENCES tech.skill_levels (id) ON DELETE RESTRICT
);
COMMENT ON TABLE tech.technician_skills IS
  'Phase 1-9 technician skill assignment (P1-09-DB-014): a profile holds a skill at a proficiency level. Operational (internal).';
CREATE UNIQUE INDEX uq_technician_skills_profile_skill
  ON tech.technician_skills (tenant_id, company_id, branch_id, technician_profile_id, skill_id)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_technician_skills_profile
  ON tech.technician_skills (tenant_id, company_id, branch_id, technician_profile_id);
CREATE INDEX ix_technician_skills_skill ON tech.technician_skills (skill_id);
CREATE INDEX ix_technician_skills_level ON tech.technician_skills (skill_level_id);
CREATE TRIGGER tg_technician_skills_touch_metadata BEFORE UPDATE ON tech.technician_skills
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_technician_skills_immutable BEFORE UPDATE ON tech.technician_skills
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'technician_profile_id', 'skill_id', 'created_at', 'created_by');
ALTER TABLE tech.technician_skills ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech.technician_skills FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_technician_skills_scope ON tech.technician_skills FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_technician_skills_scope ON tech.technician_skills FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_technician_skills_scope ON tech.technician_skills FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tech.technician_skills TO app_runtime;
GRANT SELECT ON tech.technician_skills TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. tech.technician_certifications — operational certificate record (internal).
-- ----------------------------------------------------------------------------
CREATE TABLE tech.technician_certifications (
  id                    uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid    NOT NULL,
  company_id            uuid    NOT NULL,
  branch_id             uuid    NOT NULL,
  technician_profile_id uuid    NOT NULL,
  certification_id      uuid    NOT NULL,
  issued_on             date    NOT NULL,
  expires_on            date    NULL,
  cert_status           text    NOT NULL DEFAULT 'active',
  record_version        integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid    NOT NULL,
  updated_at            timestamptz NULL,
  updated_by            uuid    NULL,
  deleted_at            timestamptz NULL,
  deleted_by            uuid    NULL,

  CONSTRAINT pk_technician_certifications PRIMARY KEY (id),
  CONSTRAINT uq_technician_certifications_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_technician_certifications_profile
    FOREIGN KEY (tenant_id, company_id, branch_id, technician_profile_id)
    REFERENCES tech.technician_profiles (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_technician_certifications_cert FOREIGN KEY (certification_id) REFERENCES tech.certifications (id) ON DELETE RESTRICT,
  CONSTRAINT ck_technician_certifications_status CHECK (cert_status IN ('active', 'expired', 'revoked')),
  CONSTRAINT ck_technician_certifications_expiry CHECK (expires_on IS NULL OR expires_on >= issued_on)
);
COMMENT ON TABLE tech.technician_certifications IS
  'Phase 1-9 technician certificate record (P1-09-DB-015): which certification a technician holds, issue/expiry, status. Operational (internal) so eligibility/expiry queries need no sensitive permission. The certificate NUMBER is restricted (tech.technician_certification_details).';
CREATE UNIQUE INDEX uq_technician_certifications_active
  ON tech.technician_certifications (tenant_id, company_id, branch_id, technician_profile_id, certification_id)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_technician_certifications_profile
  ON tech.technician_certifications (tenant_id, company_id, branch_id, technician_profile_id);
CREATE INDEX ix_technician_certifications_cert ON tech.technician_certifications (certification_id);
CREATE INDEX ix_technician_certifications_expiry
  ON tech.technician_certifications (tenant_id, expires_on) WHERE deleted_at IS NULL AND expires_on IS NOT NULL;
CREATE TRIGGER tg_technician_certifications_touch_metadata BEFORE UPDATE ON tech.technician_certifications
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_technician_certifications_immutable BEFORE UPDATE ON tech.technician_certifications
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'technician_profile_id', 'certification_id', 'issued_on', 'created_at', 'created_by');
ALTER TABLE tech.technician_certifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech.technician_certifications FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_technician_certifications_scope ON tech.technician_certifications FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_technician_certifications_scope ON tech.technician_certifications FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_technician_certifications_scope ON tech.technician_certifications FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tech.technician_certifications TO app_runtime;
GRANT SELECT ON tech.technician_certifications TO app_readonly;

-- ----------------------------------------------------------------------------
-- 4. tech.technician_certification_details — RESTRICTED 1:1 credential number.
-- ----------------------------------------------------------------------------
CREATE TABLE tech.technician_certification_details (
  id                          uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id                   uuid    NOT NULL,
  company_id                  uuid    NOT NULL,
  branch_id                   uuid    NOT NULL,
  technician_certification_id uuid    NOT NULL,
  certificate_number          text    NOT NULL,
  classification              text    NOT NULL DEFAULT 'restricted',
  record_version              integer NOT NULL DEFAULT 1,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  created_by                  uuid    NOT NULL,
  updated_at                  timestamptz NULL,
  updated_by                  uuid    NULL,
  deleted_at                  timestamptz NULL,
  deleted_by                  uuid    NULL,

  CONSTRAINT pk_technician_certification_details PRIMARY KEY (id),
  CONSTRAINT fk_technician_certification_details_cert
    FOREIGN KEY (tenant_id, company_id, branch_id, technician_certification_id)
    REFERENCES tech.technician_certifications (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_technician_certification_details_classification CHECK (classification = 'restricted'),
  CONSTRAINT ck_technician_certification_details_number_not_blank CHECK (btrim(certificate_number) <> '')
);
COMMENT ON TABLE tech.technician_certification_details IS
  'Phase 1-9 RESTRICTED credential number (P1-09-DB-016). 1:1 with tech.technician_certifications; whole table gated by iam.has_permission(''iam.sensitive.view''). classification immutable.';
CREATE UNIQUE INDEX uq_technician_certification_details_cert
  ON tech.technician_certification_details (tenant_id, company_id, branch_id, technician_certification_id)
  WHERE deleted_at IS NULL;
CREATE INDEX ix_technician_certification_details_cert
  ON tech.technician_certification_details (tenant_id, company_id, branch_id, technician_certification_id);
CREATE TRIGGER tg_technician_certification_details_immutable BEFORE UPDATE ON tech.technician_certification_details
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'technician_certification_id', 'classification', 'created_at', 'created_by');
CREATE TRIGGER tg_technician_certification_details_touch_metadata BEFORE UPDATE ON tech.technician_certification_details
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
ALTER TABLE tech.technician_certification_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech.technician_certification_details FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_technician_certification_details_gated ON tech.technician_certification_details FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view'));
CREATE POLICY ins_technician_certification_details_gated ON tech.technician_certification_details FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view'));
CREATE POLICY upd_technician_certification_details_gated ON tech.technician_certification_details FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids()))
    AND iam.has_permission('iam.sensitive.view'))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND iam.has_permission('iam.sensitive.view'));
GRANT SELECT, INSERT, UPDATE ON tech.technician_certification_details TO app_runtime;
GRANT SELECT ON tech.technician_certification_details TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. tech.technician_availability — non-overlapping availability windows.
-- ----------------------------------------------------------------------------
CREATE TABLE tech.technician_availability (
  id                    uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id             uuid    NOT NULL,
  company_id            uuid    NOT NULL,
  branch_id             uuid    NOT NULL,
  technician_profile_id uuid    NOT NULL,
  available_from        timestamptz NOT NULL,
  available_to          timestamptz NOT NULL,
  availability_kind     text    NOT NULL DEFAULT 'available',
  reason                text    NULL,
  record_version        integer NOT NULL DEFAULT 1,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid    NOT NULL,
  updated_at            timestamptz NULL,
  updated_by            uuid    NULL,
  deleted_at            timestamptz NULL,
  deleted_by            uuid    NULL,

  CONSTRAINT pk_technician_availability PRIMARY KEY (id),
  CONSTRAINT uq_technician_availability_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_technician_availability_profile
    FOREIGN KEY (tenant_id, company_id, branch_id, technician_profile_id)
    REFERENCES tech.technician_profiles (tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_technician_availability_kind CHECK (availability_kind IN ('available', 'unavailable')),
  CONSTRAINT ck_technician_availability_window CHECK (available_to > available_from),
  CONSTRAINT ck_technician_availability_reason_not_blank CHECK (reason IS NULL OR btrim(reason) <> ''),
  -- A technician cannot have two overlapping availability windows (one place at a time).
  CONSTRAINT ex_technician_availability_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    technician_profile_id WITH =,
    tstzrange(available_from, available_to) WITH &&
  ) WHERE (deleted_at IS NULL)
);
COMMENT ON TABLE tech.technician_availability IS
  'Phase 1-9 technician availability windows (P1-09-DB-017). Non-overlapping per technician via a gist EXCLUDE (race-safe, 23P01). available_to > available_from.';
-- Non-partial FK-covering index (the gist EXCLUDE is partial and does not cover the FK).
CREATE INDEX ix_technician_availability_profile
  ON tech.technician_availability (tenant_id, company_id, branch_id, technician_profile_id);
CREATE INDEX ix_technician_availability_window
  ON tech.technician_availability (tenant_id, technician_profile_id, available_from) WHERE deleted_at IS NULL;
CREATE TRIGGER tg_technician_availability_touch_metadata BEFORE UPDATE ON tech.technician_availability
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_technician_availability_immutable BEFORE UPDATE ON tech.technician_availability
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'technician_profile_id', 'created_at', 'created_by');
ALTER TABLE tech.technician_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE tech.technician_availability FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_technician_availability_scope ON tech.technician_availability FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_technician_availability_scope ON tech.technician_availability FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_technician_availability_scope ON tech.technician_availability FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON tech.technician_availability TO app_runtime;
GRANT SELECT ON tech.technician_availability TO app_readonly;
