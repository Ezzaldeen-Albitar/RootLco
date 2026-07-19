-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: communication preferences and append-only consent history
-- Tasks: P1-06-DB-011, P1-06-DB-012, P1-06-SEC-003
-- Owner module: crm
--
-- Purpose
--   crm.communication_preferences — a partner's per-(channel, purpose) delivery
--   preference. A PREFERENCE IS NOT CONSENT: it never creates or overrides a
--   consent record.
--   crm.consent_history — the append-only, server-attributed record of privacy
--   and marketing consent by channel and purpose. Current consent is resolved
--   deterministically by crm.current_consent(...). A future-dated grant cannot
--   defeat a current withdrawal: effective_at in the future is rejected, and the
--   resolver only considers rows effective at or before now().
--
-- Dependencies
--   crm.business_partners, crm.contact_points, shared.documents, shared.languages;
--   org.tenants; shared.touch_row_metadata / org.guard_immutable_columns;
--   iam.current_tenant_id / iam.current_user_id.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   rows exist.
--
-- Security implications
--   * consent_history is append-only (GRANT SELECT, INSERT only -> 42501 on
--     UPDATE/DELETE); recorded_by/created_at are server-stamped and future
--     effective_at is rejected (Wave 1 C2/C3). Preference and consent are
--     strictly separate.
--   * ENABLE + FORCE RLS on both; tenant-scoped. Consent evidence is a nullable
--     same-tenant FK to shared.documents (not inline PII).
--
-- Objects created
--   Tables:    crm.communication_preferences, crm.consent_history
--   Functions: crm.guard_consent_insert(), crm.current_consent(uuid,text,text,text)
--   Triggers:  tg_communication_preferences_touch_metadata,
--              tg_communication_preferences_immutable, tg_consent_history_stamp
--   Policies:  sel/ins/upd for preferences; sel/ins for consent_history
--   Indexes:   ix_consent_history_resolve
-- ============================================================================

CREATE TABLE crm.communication_preferences (
  id               uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL,
  partner_id       uuid        NOT NULL,
  channel          text        NOT NULL,
  purpose          text        NOT NULL,
  preferred        boolean     NOT NULL,
  preferred_locale text        NULL,
  quiet_hours_note text        NULL,
  record_version   integer     NOT NULL DEFAULT 1,
  created_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid        NOT NULL,
  updated_at       timestamptz NULL,
  updated_by       uuid        NULL,

  CONSTRAINT pk_communication_preferences PRIMARY KEY (id),
  CONSTRAINT uq_communication_preferences_dims UNIQUE (tenant_id, partner_id, channel, purpose),
  CONSTRAINT fk_communication_preferences_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_communication_preferences_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_communication_preferences_locale
    FOREIGN KEY (preferred_locale) REFERENCES shared.languages (locale_code) ON DELETE RESTRICT,
  CONSTRAINT ck_communication_preferences_channel
    CHECK (channel IN ('phone', 'mobile', 'email', 'other')),
  CONSTRAINT ck_communication_preferences_purpose
    CHECK (purpose IN ('transactional', 'marketing', 'reminder'))
);

COMMENT ON TABLE crm.communication_preferences IS
  'Phase 1-6 partner delivery preferences (P1-06-DB-011). A preference is NOT consent; it never grants consent.';

CREATE TRIGGER tg_communication_preferences_touch_metadata
  BEFORE UPDATE ON crm.communication_preferences
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_communication_preferences_immutable
  BEFORE UPDATE ON crm.communication_preferences
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'channel', 'purpose', 'created_at', 'created_by');

ALTER TABLE crm.communication_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.communication_preferences FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_communication_preferences_tenant ON crm.communication_preferences
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_communication_preferences_tenant ON crm.communication_preferences
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_communication_preferences_tenant ON crm.communication_preferences
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.communication_preferences TO app_runtime;
GRANT SELECT ON crm.communication_preferences TO app_readonly;

-- ---------------------------------------------------------------------------
CREATE TABLE crm.consent_history (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  partner_id           uuid        NOT NULL,
  consent_kind         text        NOT NULL,
  contact_point_id     uuid        NULL,
  channel              text        NOT NULL,
  purpose              text        NOT NULL,
  status               text        NOT NULL,
  source               text        NULL,
  evidence_document_id uuid        NULL,
  effective_at         timestamptz NOT NULL,
  recorded_by          uuid        NOT NULL,
  correlation_id       uuid        NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_consent_history PRIMARY KEY (id),
  CONSTRAINT fk_consent_history_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_consent_history_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  -- Same-partner contact point (nullable, MATCH SIMPLE).
  CONSTRAINT fk_consent_history_contact_point
    FOREIGN KEY (tenant_id, partner_id, contact_point_id)
    REFERENCES crm.contact_points (tenant_id, partner_id, id) ON DELETE RESTRICT,
  -- Same-tenant evidence document (nullable, MATCH SIMPLE).
  CONSTRAINT fk_consent_history_evidence
    FOREIGN KEY (tenant_id, evidence_document_id)
    REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_consent_history_kind CHECK (consent_kind IN ('privacy', 'marketing')),
  CONSTRAINT ck_consent_history_channel CHECK (channel IN ('phone', 'mobile', 'email', 'other')),
  CONSTRAINT ck_consent_history_purpose CHECK (purpose IN ('transactional', 'marketing', 'reminder')),
  CONSTRAINT ck_consent_history_status CHECK (status IN ('granted', 'withdrawn', 'expired'))
);

COMMENT ON TABLE crm.consent_history IS
  'Phase 1-6 append-only consent history (P1-06-DB-012, FR-CRM-004, BR-CRM-002). Server-attributed; future effective_at rejected; current state via crm.current_consent().';

CREATE INDEX ix_consent_history_resolve
  ON crm.consent_history (tenant_id, partner_id, consent_kind, channel, purpose, effective_at DESC);

-- Server-stamp recorded_by/created_at; reject a future effective_at (a future
-- grant must not be able to defeat a current withdrawal — Wave 1 C3).
CREATE OR REPLACE FUNCTION crm.guard_consent_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  NEW.recorded_by := iam.current_user_id();
  IF NEW.recorded_by IS NULL THEN
    RAISE EXCEPTION 'consent history requires an actor in the session context'
      USING ERRCODE = 'check_violation';
  END IF;
  NEW.created_at := now();
  IF NEW.effective_at IS NULL THEN
    NEW.effective_at := now();
  END IF;
  IF NEW.effective_at > now() THEN
    RAISE EXCEPTION 'consent effective_at cannot be in the future'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION crm.guard_consent_insert() FROM PUBLIC;

CREATE TRIGGER tg_consent_history_stamp
  BEFORE INSERT ON crm.consent_history
  FOR EACH ROW EXECUTE FUNCTION crm.guard_consent_insert();

-- Deterministic current-consent resolution: latest row effective at or before
-- now(), with a total tie-break. SECURITY INVOKER -> RLS-scoped.
CREATE OR REPLACE FUNCTION crm.current_consent(
  p_partner_id uuid, p_consent_kind text, p_channel text, p_purpose text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT status
    FROM crm.consent_history
   WHERE partner_id = p_partner_id
     AND consent_kind = p_consent_kind
     AND channel = p_channel
     AND purpose = p_purpose
     AND effective_at <= now()
   ORDER BY effective_at DESC, created_at DESC, id DESC
   LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION crm.current_consent(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION crm.current_consent(uuid, text, text, text) TO app_runtime, app_readonly;

ALTER TABLE crm.consent_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.consent_history FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_consent_history_tenant ON crm.consent_history
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_consent_history_tenant ON crm.consent_history
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON crm.consent_history TO app_runtime;
GRANT SELECT ON crm.consent_history TO app_readonly;
