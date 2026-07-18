-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: tenant-scoped outbound messages and delivery-attempt persistence
-- Tasks: P1-05-DB-009, P1-05-DB-010, P1-05-SEC-004, P1-05-QA-003
-- Owner module: shared
--
-- Purpose
--   outbound_messages stores an immutable delivery envelope with only the
--   rendered-content integrity digest and its guarded delivery lifecycle.
--   delivery_attempts stores append-only,
--   provider-neutral attempt evidence. Recipient destinations are never stored
--   in plaintext: a message identifies an in-product user, a 32-byte digest of
--   an external destination, or both.
--
-- Dependencies
--   Phase 1-3 org.tenants / org.legal_companies / org.branches, Phase 1-4
--   iam.user_accounts and context readers, Increment E shared.template_versions,
--   shared.touch_row_metadata, and org.guard_immutable_columns.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only);
--   roll-forward-only once messages or delivery attempts exist because they are
--   operational/evidence records. Recorded in
--   docs/database/phase-1-5-migration-classification.md.
--
-- Security implications
--   * Both tenant-owned tables carry tenant_id NOT NULL and use ENABLE + FORCE
--     RLS. Runtime and readonly roles have SELECT only for their current tenant.
--   * No plaintext recipient address is stored. recipient_digest, when present,
--     is exactly one SHA-256 digest; recipient_user_id is tenant-bound by a
--     composite FK. At least one recipient identifier is mandatory.
--   * Company and branch scope is structural. A branch requires a company and
--     the three-column FK proves that branch belongs to that tenant+company.
--   * A referenced template version is locked FOR SHARE on INSERT and must be
--     approved and either platform-scoped or owned by the message tenant.
--   * One trigger function enforces both the pending initial state and the exact
--     delivery transition graph, server-stamping lifecycle timestamps. Retry is
--     possible only through failed→queued and increments retry_count.
--   * Attempt lifecycle is started→terminal with completion pairing.
--   * delivery_attempts is append-only to application roles: no UPDATE/DELETE
--     grant or policy exists. Provider error detail is intentionally summarized.
--
-- Objects created
--   Tables:    shared.outbound_messages, shared.delivery_attempts
--   Functions: shared.guard_outbound_message_scope(),
--              shared.guard_outbound_message_lifecycle()
--   Triggers:  tg_outbound_messages_guard_scope,
--              tg_outbound_messages_guard_lifecycle,
--              tg_outbound_messages_immutable,
--              tg_outbound_messages_touch_metadata
--   Policies:  sel_outbound_messages_tenant, sel_delivery_attempts_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shared.outbound_messages (P1-05-DB-009) — delivery envelope and content digest.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.outbound_messages (
  id                  uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL,
  company_id          uuid        NULL,
  branch_id           uuid        NULL,
  template_version_id uuid        NULL,
  channel             text        NOT NULL,
  purpose             text        NOT NULL,
  recipient_digest    bytea       NULL,
  recipient_user_id   uuid        NULL,
  body_sha256         bytea       NOT NULL,
  dedupe_key          text        NOT NULL,
  consent_ref         text        NULL,
  status              text        NOT NULL DEFAULT 'pending',
  retry_count         integer     NOT NULL DEFAULT 0,
  failure_class       text        NULL,
  queued_at           timestamptz NULL,
  sending_at          timestamptz NULL,
  sent_at             timestamptz NULL,
  delivered_at        timestamptz NULL,
  failed_at           timestamptz NULL,
  cancelled_at        timestamptz NULL,
  record_version      integer     NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid        NULL,

  CONSTRAINT pk_outbound_messages PRIMARY KEY (id),
  CONSTRAINT uq_outbound_messages_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_outbound_messages_dedupe UNIQUE (tenant_id, dedupe_key),
  CONSTRAINT fk_outbound_messages_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_outbound_messages_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_outbound_messages_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_outbound_messages_template_version
    FOREIGN KEY (template_version_id)
    REFERENCES shared.template_versions (id) ON DELETE RESTRICT,
  CONSTRAINT fk_outbound_messages_recipient_user
    FOREIGN KEY (tenant_id, recipient_user_id)
    REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_outbound_messages_branch_requires_company
    CHECK (branch_id IS NULL OR company_id IS NOT NULL),
  CONSTRAINT ck_outbound_messages_channel
    CHECK (channel IN ('email', 'in_app')),
  CONSTRAINT ck_outbound_messages_purpose
    CHECK (purpose IN ('transactional', 'marketing', 'system')),
  CONSTRAINT ck_outbound_messages_recipient_digest_length
    CHECK (recipient_digest IS NULL OR octet_length(recipient_digest) = 32),
  CONSTRAINT ck_outbound_messages_recipient_present
    CHECK (recipient_digest IS NOT NULL OR recipient_user_id IS NOT NULL),
  CONSTRAINT ck_outbound_messages_body_hash_length CHECK (octet_length(body_sha256) = 32),
  CONSTRAINT ck_outbound_messages_dedupe_not_blank CHECK (btrim(dedupe_key) <> ''),
  CONSTRAINT ck_outbound_messages_consent_ref_not_blank
    CHECK (consent_ref IS NULL OR btrim(consent_ref) <> ''),
  CONSTRAINT ck_outbound_messages_status CHECK (
    status IN ('pending', 'queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled')
  ),
  CONSTRAINT ck_outbound_messages_retry_count CHECK (retry_count >= 0),
  CONSTRAINT ck_outbound_messages_failure_class_not_blank
    CHECK (failure_class IS NULL OR btrim(failure_class) <> ''),
  -- Explicit IS NOT NULL keeps this conditional CHECK from accepting UNKNOWN.
  CONSTRAINT ck_outbound_messages_failure_class_state CHECK (
    failure_class IS NULL
    OR (status IS NOT NULL AND status IN ('failed', 'cancelled'))
  ),
  CONSTRAINT ck_outbound_messages_queued_at_state CHECK (
    queued_at IS NULL
    OR (
      status IS NOT NULL
      AND status IN ('queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled')
    )
  ),
  CONSTRAINT ck_outbound_messages_sending_at_state CHECK (
    sending_at IS NULL
    OR (
      status IS NOT NULL
      AND status IN ('sending', 'sent', 'delivered', 'failed', 'cancelled')
    )
  ),
  CONSTRAINT ck_outbound_messages_sent_at_state CHECK (
    sent_at IS NULL
    OR (status IS NOT NULL AND status IN ('sent', 'delivered', 'failed', 'cancelled'))
  ),
  CONSTRAINT ck_outbound_messages_delivered_at_state CHECK (
    delivered_at IS NULL OR (status IS NOT NULL AND status = 'delivered')
  ),
  CONSTRAINT ck_outbound_messages_failed_at_state CHECK (
    failed_at IS NULL OR (status IS NOT NULL AND status IN ('failed', 'cancelled'))
  ),
  CONSTRAINT ck_outbound_messages_cancelled_at_state CHECK (
    cancelled_at IS NULL OR (status IS NOT NULL AND status = 'cancelled')
  )
);

COMMENT ON TABLE shared.outbound_messages IS
  'Tenant-owned outbound-message envelope (P1-05-DB-009, P1-05-SEC-004). Rendered content is not persisted here; body_sha256 is its integrity digest. Recipient identity is a tenant-bound user and/or a 32-byte destination digest; plaintext destinations are forbidden by design. Optional template versions must be approved and platform-or-same-tenant. Lifecycle starts pending and follows the guarded pending→queued→sending→sent→delivered graph, with explicit failure/cancellation paths. Runtime SELECT-only.';
COMMENT ON COLUMN shared.outbound_messages.recipient_digest IS
  'Optional 32-byte SHA-256 digest of an external destination. The raw email/address is not persisted.';
COMMENT ON COLUMN shared.outbound_messages.recipient_user_id IS
  'Optional in-product recipient. Composite tenant/user FK prevents cross-tenant attribution.';
COMMENT ON COLUMN shared.outbound_messages.body_sha256 IS
  'Exactly 32-byte SHA-256 integrity digest of rendered content that is not persisted here; rendering and transient content belong to the backend dispatch phase.';
COMMENT ON COLUMN shared.outbound_messages.dedupe_key IS
  'Caller-supplied tenant-scoped idempotency identity. UNIQUE (tenant_id, dedupe_key) referees concurrent duplicate creation.';
COMMENT ON COLUMN shared.outbound_messages.consent_ref IS
  'Optional opaque reference for later consent integration. This database phase records purpose but does not claim consent enforcement.';

-- Every FK has a non-partial leading-column cover. The two UNIQUE constraints
-- cover the tenant FK and expose (tenant_id,id) to delivery_attempts.
CREATE INDEX ix_outbound_messages_company
  ON shared.outbound_messages (tenant_id, company_id);
CREATE INDEX ix_outbound_messages_branch
  ON shared.outbound_messages (tenant_id, company_id, branch_id);
CREATE INDEX ix_outbound_messages_template_version
  ON shared.outbound_messages (template_version_id);
CREATE INDEX ix_outbound_messages_recipient_user
  ON shared.outbound_messages (tenant_id, recipient_user_id);
CREATE INDEX ix_outbound_messages_tenant_status
  ON shared.outbound_messages (tenant_id, status);

-- ----------------------------------------------------------------------------
-- 2. shared.delivery_attempts (P1-05-DB-010) — append-only attempt evidence.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.delivery_attempts (
  id                   uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id            uuid        NOT NULL,
  message_id           uuid        NOT NULL,
  attempt_number       integer     NOT NULL,
  provider_code        text        NOT NULL,
  provider_message_ref text        NULL,
  status               text        NOT NULL,
  response_code        text        NULL,
  error_summary        text        NULL,
  details              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  attempted_at         timestamptz NOT NULL DEFAULT now(),
  completed_at         timestamptz NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid        NOT NULL,

  CONSTRAINT pk_delivery_attempts PRIMARY KEY (id),
  CONSTRAINT uq_delivery_attempts_message_number
    UNIQUE (tenant_id, message_id, attempt_number),
  CONSTRAINT fk_delivery_attempts_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_delivery_attempts_message
    FOREIGN KEY (tenant_id, message_id)
    REFERENCES shared.outbound_messages (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_delivery_attempts_number_positive CHECK (attempt_number >= 1),
  CONSTRAINT ck_delivery_attempts_provider_format
    CHECK (provider_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_delivery_attempts_provider_ref_not_blank
    CHECK (provider_message_ref IS NULL OR btrim(provider_message_ref) <> ''),
  CONSTRAINT ck_delivery_attempts_status
    CHECK (status IN ('started', 'accepted', 'delivered', 'errored')),
  CONSTRAINT ck_delivery_attempts_response_code_not_blank
    CHECK (response_code IS NULL OR btrim(response_code) <> ''),
  CONSTRAINT ck_delivery_attempts_error_summary CHECK (
    status <> 'errored'
    OR (error_summary IS NOT NULL AND btrim(error_summary) <> '')
  ),
  CONSTRAINT ck_delivery_attempts_error_only_errored
    CHECK (error_summary IS NULL OR (status IS NOT NULL AND status = 'errored')),
  CONSTRAINT ck_delivery_attempts_details_object CHECK (jsonb_typeof(details) = 'object'),
  CONSTRAINT ck_delivery_attempts_completion CHECK (
    (status = 'started' AND completed_at IS NULL)
    OR (status <> 'started' AND completed_at IS NOT NULL)
  )
);

COMMENT ON TABLE shared.delivery_attempts IS
  'Append-only provider-neutral outbound delivery-attempt evidence (P1-05-DB-010, P1-05-QA-003). attempt_number is unique per message. An errored attempt requires a non-blank sanitized error_summary. Runtime/readonly SELECT only; no UPDATE or DELETE grant/policy exists.';
COMMENT ON COLUMN shared.delivery_attempts.provider_message_ref IS
  'Opaque provider-side message identifier, classified internal; never an authorization token.';
COMMENT ON COLUMN shared.delivery_attempts.error_summary IS
  'Sanitized, non-secret summary required for errored attempts; raw provider payloads and stack traces are forbidden.';

-- The non-partial UNIQUE index covers both the tenant FK (leading tenant_id)
-- and the composite message FK (leading tenant_id,message_id).
CREATE INDEX ix_delivery_attempts_tenant_attempted
  ON shared.delivery_attempts (tenant_id, attempted_at);

-- ----------------------------------------------------------------------------
-- 3. Guard functions. Functions precede all triggers that invoke them.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.guard_outbound_message_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_template_tenant uuid;
  v_template_status text;
BEGIN
  IF NEW.template_version_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id, status
    INTO v_template_tenant, v_template_status
  FROM shared.template_versions
  WHERE id = NEW.template_version_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'template version % does not exist', NEW.template_version_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_template_tenant IS NOT NULL AND v_template_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'template version % is not compatible with tenant %',
      NEW.template_version_id, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_template_status <> 'approved' THEN
    RAISE EXCEPTION 'template version % is not approved', NEW.template_version_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_outbound_message_scope() IS
  'BEFORE INSERT guard for shared.outbound_messages. A referenced template-version row is locked FOR SHARE and must be approved and either platform-scoped or owned by the message tenant.';

REVOKE EXECUTE ON FUNCTION shared.guard_outbound_message_scope() FROM PUBLIC;

CREATE OR REPLACE FUNCTION shared.guard_outbound_message_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending'
       OR NEW.retry_count <> 0
       OR NEW.failure_class IS NOT NULL
       OR NEW.queued_at IS NOT NULL
       OR NEW.sending_at IS NOT NULL
       OR NEW.sent_at IS NOT NULL
       OR NEW.delivered_at IS NOT NULL
       OR NEW.failed_at IS NOT NULL
       OR NEW.cancelled_at IS NOT NULL THEN
      RAISE EXCEPTION 'outbound message must start as unstamped pending with retry_count zero'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = OLD.status THEN
    IF NEW.retry_count IS DISTINCT FROM OLD.retry_count
       OR NEW.failure_class IS DISTINCT FROM OLD.failure_class
       OR NEW.queued_at IS DISTINCT FROM OLD.queued_at
       OR NEW.sending_at IS DISTINCT FROM OLD.sending_at
       OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
       OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at
       OR NEW.failed_at IS DISTINCT FROM OLD.failed_at
       OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
      RAISE EXCEPTION 'outbound lifecycle fields may change only with a status transition'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- Lifecycle timestamps are server-owned on every transition. Reject a
  -- caller that tries to forge either the target stamp or historical stamps;
  -- the valid branch below performs the only permitted changes.
  IF NEW.queued_at IS DISTINCT FROM OLD.queued_at
     OR NEW.sending_at IS DISTINCT FROM OLD.sending_at
     OR NEW.sent_at IS DISTINCT FROM OLD.sent_at
     OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at
     OR NEW.failed_at IS DISTINCT FROM OLD.failed_at
     OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
    RAISE EXCEPTION 'outbound lifecycle timestamps are server-controlled'
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.status = 'pending' AND NEW.status = 'queued' THEN
    NEW.queued_at := now();
  ELSIF OLD.status = 'pending' AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
  ELSIF OLD.status = 'queued' AND NEW.status = 'sending' THEN
    NEW.sending_at := now();
  ELSIF OLD.status = 'queued' AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
  ELSIF OLD.status = 'sending' AND NEW.status = 'sent' THEN
    NEW.sent_at := now();
  ELSIF OLD.status = 'sending' AND NEW.status = 'failed' THEN
    IF NEW.failure_class IS NULL OR btrim(NEW.failure_class) = '' THEN
      RAISE EXCEPTION 'transition to failed requires failure_class'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.failed_at := now();
  ELSIF OLD.status = 'sent' AND NEW.status = 'delivered' THEN
    NEW.delivered_at := now();
  ELSIF OLD.status = 'sent' AND NEW.status = 'failed' THEN
    IF NEW.failure_class IS NULL OR btrim(NEW.failure_class) = '' THEN
      RAISE EXCEPTION 'transition to failed requires failure_class'
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.failed_at := now();
  ELSIF OLD.status = 'failed' AND NEW.status = 'queued' THEN
    NEW.retry_count := OLD.retry_count + 1;
    NEW.failure_class := NULL;
    NEW.queued_at := now();
    NEW.sending_at := NULL;
    NEW.sent_at := NULL;
    NEW.delivered_at := NULL;
    NEW.failed_at := NULL;
    NEW.cancelled_at := NULL;
  ELSIF OLD.status = 'failed' AND NEW.status = 'cancelled' THEN
    NEW.cancelled_at := now();
  ELSE
    RAISE EXCEPTION 'invalid outbound message transition: % to %', OLD.status, NEW.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- retry_count is server-controlled; every transition except retry preserves it.
  IF NOT (OLD.status = 'failed' AND NEW.status = 'queued')
     AND NEW.retry_count IS DISTINCT FROM OLD.retry_count THEN
    RAISE EXCEPTION 'retry_count changes only on failed to queued'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_outbound_message_lifecycle() IS
  'Combined BEFORE INSERT/UPDATE lifecycle guard. INSERT requires an unstamped pending row with retry_count zero. UPDATE permits pending→queued|cancelled, queued→sending|cancelled, sending→sent|failed, sent→delivered|failed, and failed→queued|cancelled. failed→queued server-increments retry_count and clears failure state; transition timestamps are server-stamped.';

REVOKE EXECUTE ON FUNCTION shared.guard_outbound_message_lifecycle() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 4. Triggers — all functions above are already defined.
-- ----------------------------------------------------------------------------
CREATE TRIGGER tg_outbound_messages_guard_scope
  BEFORE INSERT ON shared.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION shared.guard_outbound_message_scope();
CREATE TRIGGER tg_outbound_messages_guard_lifecycle
  BEFORE INSERT OR UPDATE ON shared.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION shared.guard_outbound_message_lifecycle();
CREATE TRIGGER tg_outbound_messages_immutable
  BEFORE UPDATE ON shared.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'template_version_id', 'channel',
    'purpose', 'recipient_digest', 'recipient_user_id', 'body_sha256', 'dedupe_key',
    'consent_ref', 'created_at', 'created_by');
CREATE TRIGGER tg_outbound_messages_touch_metadata
  BEFORE UPDATE ON shared.outbound_messages
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

-- ----------------------------------------------------------------------------
-- 5. Row-Level Security — enabled AND forced; SELECT-only tenant visibility.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.outbound_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.outbound_messages FORCE  ROW LEVEL SECURITY;
ALTER TABLE shared.delivery_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.delivery_attempts FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_outbound_messages_tenant ON shared.outbound_messages
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_delivery_attempts_tenant ON shared.delivery_attempts
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 6. Grants — explicit, minimal. All writes remain backend/platform operations.
-- ----------------------------------------------------------------------------
GRANT SELECT ON shared.outbound_messages TO app_runtime, app_readonly;
GRANT SELECT ON shared.delivery_attempts TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles on both tables.
