-- ============================================================================
-- Phase: 1-6 — CRM and Business Partner Database
-- Migration: communication log and append-only partner timeline
-- Tasks: P1-06-DB-018, P1-06-DB-019
-- Owner module: crm
--
-- Purpose
--   crm.communication_log — unified inbound/outbound communication records,
--   optionally linked to a shared outbound message (same-tenant). crm.timeline_events
--   — the append-only, customer-facing chronological read source. Timeline rows
--   are written in the SAME transaction as their source change by AFTER INSERT
--   triggers on the status/consent/block/alert/merge/communication tables, so a
--   rolled-back source change removes its timeline row. Timeline titles carry no
--   restricted PII (built from status/type/channel tokens only). Timeline is a
--   customer-facing chronology; forensic audit (Phase 1-16) is a separate record.
--
-- Dependencies
--   crm.business_partners, crm.partner_status_history, crm.consent_history,
--   crm.customer_block_history, crm.customer_alerts, crm.partner_merges,
--   shared.outbound_messages; iam.current_tenant_id / iam.current_user_id.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once rows exist.
--
-- Security implications
--   * timeline_events is append-only (SELECT/INSERT only -> 42501); titles are
--     PII-safe by construction. communication_log stores no secret payload.
--   * Same-tenant composite FK to shared.outbound_messages.
--   * ENABLE + FORCE RLS; tenant-scoped. Runtime holds INSERT on timeline_events
--     so the INVOKER emit triggers can write; with no SECURITY DEFINER available,
--     writes cannot be restricted to trigger-only (honest limit — the emit
--     triggers are the intended path and titles are constrained).
--
-- Objects created
--   Tables:    crm.communication_log, crm.timeline_events
--   Functions: crm.emit_timeline_event()
--   Triggers:  tg_communication_log_touch_metadata, tg_communication_log_immutable,
--              tg_*_timeline (6 AFTER INSERT emit triggers)
--   Policies:  sel/ins/upd for communication_log; sel/ins for timeline_events
--   Indexes:   ix_communication_log_partner_time, ix_communication_log_outbound,
--              ix_timeline_events_partner_time
-- ============================================================================

CREATE TABLE crm.communication_log (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  partner_id          uuid        NOT NULL,
  direction           text        NOT NULL,
  channel             text        NOT NULL,
  subject             text        NULL,
  summary             text        NULL,
  outbound_message_id uuid        NULL,
  related_entity_type text        NULL,
  related_entity_id   uuid        NULL,
  logged_by           uuid        NOT NULL,
  occurred_at         timestamptz NOT NULL DEFAULT now(),
  record_version      integer     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid        NULL,

  CONSTRAINT pk_communication_log PRIMARY KEY (id),
  CONSTRAINT fk_communication_log_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_communication_log_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_communication_log_outbound_message
    FOREIGN KEY (tenant_id, outbound_message_id)
    REFERENCES shared.outbound_messages (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_communication_log_direction CHECK (direction IN ('inbound', 'outbound')),
  CONSTRAINT ck_communication_log_channel CHECK (channel IN ('phone', 'mobile', 'email', 'other')),
  CONSTRAINT ck_communication_log_related_type_format
    CHECK (related_entity_type IS NULL OR related_entity_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

COMMENT ON TABLE crm.communication_log IS
  'Phase 1-6 partner communication log (P1-06-DB-018). Personal data internal; optional same-tenant outbound-message link; no secret payload.';

CREATE INDEX ix_communication_log_partner_time
  ON crm.communication_log (tenant_id, partner_id, occurred_at DESC);
CREATE INDEX ix_communication_log_outbound
  ON crm.communication_log (tenant_id, outbound_message_id)
  WHERE outbound_message_id IS NOT NULL;

CREATE TRIGGER tg_communication_log_touch_metadata
  BEFORE UPDATE ON crm.communication_log
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_communication_log_immutable
  BEFORE UPDATE ON crm.communication_log
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'partner_id', 'direction', 'channel', 'outbound_message_id',
    'logged_by', 'occurred_at', 'created_at', 'created_by');

ALTER TABLE crm.communication_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.communication_log FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_communication_log_tenant ON crm.communication_log
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_communication_log_tenant ON crm.communication_log
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_communication_log_tenant ON crm.communication_log
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON crm.communication_log TO app_runtime;
GRANT SELECT ON crm.communication_log TO app_readonly;

-- ---------------------------------------------------------------------------
CREATE TABLE crm.timeline_events (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  partner_id     uuid        NOT NULL,
  event_type     text        NOT NULL,
  event_ref_type text        NULL,
  event_ref_id   uuid        NULL,
  title          text        NOT NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_id       uuid        NULL,
  correlation_id uuid        NULL,

  CONSTRAINT pk_timeline_events PRIMARY KEY (id),
  CONSTRAINT fk_timeline_events_partner
    FOREIGN KEY (tenant_id, partner_id)
    REFERENCES crm.business_partners (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_timeline_events_type CHECK (event_type IN (
    'lifecycle_changed', 'commercial_changed', 'consent_changed', 'blocked',
    'unblocked', 'alert_raised', 'merged', 'communication_logged')),
  CONSTRAINT ck_timeline_events_title_not_blank
    CHECK (btrim(title) <> '' AND char_length(title) <= 200)
);

COMMENT ON TABLE crm.timeline_events IS
  'Phase 1-6 append-only partner timeline (P1-06-DB-019). Written same-tx as source changes by emit triggers; titles carry no restricted PII. Distinct from forensic audit.';

CREATE INDEX ix_timeline_events_partner_time
  ON crm.timeline_events (tenant_id, partner_id, occurred_at DESC);

ALTER TABLE crm.timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm.timeline_events FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_timeline_events_tenant ON crm.timeline_events
  FOR SELECT TO app_runtime, app_readonly USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_timeline_events_tenant ON crm.timeline_events
  FOR INSERT TO app_runtime WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON crm.timeline_events TO app_runtime;
GRANT SELECT ON crm.timeline_events TO app_readonly;

-- Same-tx emit: one PII-safe timeline row per source change.
CREATE OR REPLACE FUNCTION crm.emit_timeline_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_partner uuid;
  v_type    text;
  v_title   text;
  v_ref     text := 'crm.' || TG_TABLE_NAME;
  v_corr    uuid := NULL;
BEGIN
  IF TG_TABLE_NAME = 'partner_status_history' THEN
    v_partner := NEW.partner_id; v_corr := NEW.correlation_id;
    v_type := CASE NEW.status_kind WHEN 'lifecycle' THEN 'lifecycle_changed' ELSE 'commercial_changed' END;
    v_title := NEW.status_kind || ': ' || coalesce(NEW.from_state, '(new)') || ' -> ' || NEW.to_state;
  ELSIF TG_TABLE_NAME = 'consent_history' THEN
    v_partner := NEW.partner_id; v_corr := NEW.correlation_id; v_type := 'consent_changed';
    v_title := NEW.consent_kind || ' ' || NEW.status || ' (' || NEW.channel || '/' || NEW.purpose || ')';
  ELSIF TG_TABLE_NAME = 'customer_block_history' THEN
    v_partner := NEW.partner_id; v_corr := NEW.correlation_id; v_type := NEW.action;
    v_title := initcap(NEW.action);
  ELSIF TG_TABLE_NAME = 'customer_alerts' THEN
    v_partner := NEW.partner_id; v_type := 'alert_raised';
    v_title := NEW.alert_type || ' alert (' || NEW.severity || ')';
  ELSIF TG_TABLE_NAME = 'partner_merges' THEN
    v_partner := NEW.source_partner_id; v_corr := NEW.correlation_id; v_type := 'merged';
    v_title := 'Merged into survivor';
  ELSIF TG_TABLE_NAME = 'communication_log' THEN
    v_partner := NEW.partner_id; v_type := 'communication_logged';
    v_title := NEW.direction || ' ' || NEW.channel;
  ELSE
    RETURN NULL;
  END IF;

  INSERT INTO crm.timeline_events
    (tenant_id, partner_id, event_type, event_ref_type, event_ref_id, title, occurred_at, actor_id, correlation_id)
  VALUES
    (NEW.tenant_id, v_partner, v_type, v_ref, NEW.id, left(v_title, 200), now(), iam.current_user_id(), v_corr);
  RETURN NULL;
END;
$$;
REVOKE EXECUTE ON FUNCTION crm.emit_timeline_event() FROM PUBLIC;

CREATE TRIGGER tg_partner_status_history_timeline
  AFTER INSERT ON crm.partner_status_history
  FOR EACH ROW EXECUTE FUNCTION crm.emit_timeline_event();
CREATE TRIGGER tg_consent_history_timeline
  AFTER INSERT ON crm.consent_history
  FOR EACH ROW EXECUTE FUNCTION crm.emit_timeline_event();
CREATE TRIGGER tg_customer_block_history_timeline
  AFTER INSERT ON crm.customer_block_history
  FOR EACH ROW EXECUTE FUNCTION crm.emit_timeline_event();
CREATE TRIGGER tg_customer_alerts_timeline
  AFTER INSERT ON crm.customer_alerts
  FOR EACH ROW EXECUTE FUNCTION crm.emit_timeline_event();
CREATE TRIGGER tg_partner_merges_timeline
  AFTER INSERT ON crm.partner_merges
  FOR EACH ROW EXECUTE FUNCTION crm.emit_timeline_event();
CREATE TRIGGER tg_communication_log_timeline
  AFTER INSERT ON crm.communication_log
  FOR EACH ROW EXECUTE FUNCTION crm.emit_timeline_event();
