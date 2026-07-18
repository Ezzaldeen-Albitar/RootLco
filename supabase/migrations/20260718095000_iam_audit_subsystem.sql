-- ============================================================================
-- Phase: 1-4 — Identity, Authorization, Security, and Audit Database
-- Migration: append-only audit subsystem with a per-tenant SHA-256 hash chain
-- Tasks: P1-04-DB-014, P1-04-DB-015, P1-04-DB-016, P1-04-DB-017, P1-04-DB-022
-- Owner module: iam
--
-- Purpose
--   A tamper-evident audit trail: each audit event (record + field-level
--   details) is linked into a per-tenant SHA-256 chain, so any later alteration
--   or deletion of a committed record is detectable. Security events are a
--   separate, payload-free log.
--
-- Dependencies
--   Phase 1-3 org.tenants, pgcrypto (extensions.digest), 0002.
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   audit rows exist (they are evidence). Recorded in
--   docs/database/phase-1-4-migration-classification.md.
--
-- Security implications
--   * Append-only. No application role holds ANY grant on these tables (like
--     shared.idempotency_keys); RLS is enabled AND forced with no policy in this
--     increment — Increment I adds the permission-gated read path. Runtime can
--     neither read, insert, update, nor delete audit rows here.
--   * iam.audit_append() is the sole writer. It serializes per tenant with
--     pg_advisory_xact_lock so concurrent transactions cannot fork a chain:
--     seq and prev_hash are assigned under the lock, held to COMMIT.
--   * The hash chain is the integrity control, not a trigger — it detects
--     tampering even by a privileged DB user (who could otherwise edit rows).
--     iam.audit_verify_chain() recomputes every link and reports the first
--     altered record or seq gap.
--   * Restricted/secret field values are stored MASKED (iam.audit_mask) — the
--     raw value never lands in audit_record_details.
--   * NO external anchoring is claimed. Database RLS does NOT log every SELECT;
--     audit-read access logging is a Phase-1-14 backend responsibility.
--   * iam.audit_append is SECURITY INVOKER and granted to NO application role;
--     platform/admin writes it now, and Phase-1-14 service roles will be granted
--     it (or a reviewed definer wrapper) then. No SECURITY DEFINER is introduced.
--
-- Objects created
--   Tables:    iam.audit_records, iam.audit_record_details,
--              iam.audit_integrity_links, iam.security_events
--   Functions: iam.audit_mask(), iam.audit_canonical(), iam.audit_hash(),
--              iam.audit_append(), iam.audit_verify_chain()
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. iam.audit_records — the append-only event header (P1-04-DB-014).
-- ----------------------------------------------------------------------------
CREATE TABLE iam.audit_records (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  seq            bigint      NOT NULL,
  actor_id       uuid        NULL,
  actor_kind     text        NOT NULL,
  action         text        NOT NULL,
  entity_type    text        NOT NULL,
  entity_id      uuid        NULL,
  company_id     uuid        NULL,
  branch_id      uuid        NULL,
  correlation_id uuid        NULL,
  request_ref    text        NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_audit_records PRIMARY KEY (id),
  CONSTRAINT uq_audit_records_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_audit_records_tenant_seq UNIQUE (tenant_id, seq),
  CONSTRAINT fk_audit_records_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_audit_records_actor_kind CHECK (actor_kind IN ('user', 'system', 'service')),
  CONSTRAINT ck_audit_records_seq_positive CHECK (seq >= 1),
  CONSTRAINT ck_audit_records_action_not_blank CHECK (btrim(action) <> ''),
  CONSTRAINT ck_audit_records_entity_type_not_blank CHECK (btrim(entity_type) <> '')
);

COMMENT ON TABLE iam.audit_records IS
  'Append-only audit event header (P1-04-DB-014). One per audited action; seq is a per-tenant monotonic sequence assigned by iam.audit_append under an advisory lock. No application grant/policy in this phase (platform-only).';

CREATE INDEX ix_audit_records_timeline ON iam.audit_records (tenant_id, occurred_at);

-- ----------------------------------------------------------------------------
-- 2. iam.audit_record_details — masked field-level changes (P1-04-DB-015).
-- ----------------------------------------------------------------------------
CREATE TABLE iam.audit_record_details (
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  audit_record_id  uuid NOT NULL,
  field_name       text NOT NULL,
  old_value_masked text NULL,
  new_value_masked text NULL,
  value_classification text NOT NULL,

  CONSTRAINT pk_audit_record_details PRIMARY KEY (id),
  CONSTRAINT fk_audit_record_details_record
    FOREIGN KEY (tenant_id, audit_record_id) REFERENCES iam.audit_records (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT ck_audit_record_details_class
    CHECK (value_classification IN ('public', 'internal', 'restricted', 'secret')),
  CONSTRAINT ck_audit_record_details_field_not_blank CHECK (btrim(field_name) <> '')
);

COMMENT ON TABLE iam.audit_record_details IS
  'Field-level changes for an audit record (P1-04-DB-015). Restricted/secret values are stored MASKED by iam.audit_append — the raw value is never persisted here.';

CREATE INDEX ix_audit_record_details_record ON iam.audit_record_details (tenant_id, audit_record_id);

-- ----------------------------------------------------------------------------
-- 3. iam.audit_integrity_links — the SHA-256 chain (P1-04-DB-016).
-- ----------------------------------------------------------------------------
CREATE TABLE iam.audit_integrity_links (
  id              uuid   NOT NULL DEFAULT gen_random_uuid(),
  tenant_id       uuid   NOT NULL,
  audit_record_id uuid   NOT NULL,
  seq             bigint NOT NULL,
  prev_hash       bytea  NOT NULL,
  record_hash     bytea  NOT NULL,

  CONSTRAINT pk_audit_integrity_links PRIMARY KEY (id),
  CONSTRAINT uq_audit_integrity_links_record UNIQUE (audit_record_id),
  CONSTRAINT uq_audit_integrity_links_tenant_seq UNIQUE (tenant_id, seq),
  CONSTRAINT fk_audit_integrity_links_record
    FOREIGN KEY (tenant_id, audit_record_id) REFERENCES iam.audit_records (tenant_id, id) ON DELETE CASCADE,
  CONSTRAINT ck_audit_integrity_links_hash_len
    CHECK (octet_length(prev_hash) = 32 AND octet_length(record_hash) = 32)
);

COMMENT ON TABLE iam.audit_integrity_links IS
  'Per-tenant SHA-256 hash chain (P1-04-DB-016). record_hash = sha256(prev_hash || canonical(record)); genesis prev_hash is 32 zero bytes. A gap in seq or an altered record breaks the chain, detected by iam.audit_verify_chain.';

CREATE INDEX ix_audit_integrity_links_record ON iam.audit_integrity_links (tenant_id, audit_record_id);

-- ----------------------------------------------------------------------------
-- 4. iam.security_events — payload-free security log (P1-04-DB-017).
-- ----------------------------------------------------------------------------
CREATE TABLE iam.security_events (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NULL,
  event_type     text        NOT NULL,
  severity       text        NOT NULL DEFAULT 'info',
  actor_id       uuid        NULL,
  detail         text        NULL,
  correlation_id uuid        NULL,
  occurred_at    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT pk_security_events PRIMARY KEY (id),
  CONSTRAINT fk_security_events_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_security_events_severity CHECK (severity IN ('info', 'warning', 'critical')),
  CONSTRAINT ck_security_events_type_not_blank CHECK (btrim(event_type) <> '')
);

COMMENT ON TABLE iam.security_events IS
  'Security event log (P1-04-DB-017). tenant_id nullable for platform-level events. detail is a short descriptor — NO sensitive payload (no credential, token, or raw restricted value). Append-only, platform-only.';

CREATE INDEX ix_security_events_timeline ON iam.security_events (tenant_id, occurred_at);

-- ----------------------------------------------------------------------------
-- 5. Masking, canonical serialization, hashing.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.audit_mask(p_value text, p_classification text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_value IS NULL THEN NULL
    WHEN p_classification IN ('restricted', 'secret') THEN '***'
    ELSE p_value
  END;
$$;

COMMENT ON FUNCTION iam.audit_mask(text, text) IS
  'Masks a value for the audit trail: restricted/secret classifications collapse to a fixed marker so the raw value is never stored; public/internal are kept.';

CREATE OR REPLACE FUNCTION iam.audit_canonical(p_audit_record_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'tenant', ar.tenant_id,
    'seq', ar.seq,
    'actor', ar.actor_id,
    'actor_kind', ar.actor_kind,
    'action', ar.action,
    'entity_type', ar.entity_type,
    'entity_id', ar.entity_id,
    'company', ar.company_id,
    'branch', ar.branch_id,
    'correlation', ar.correlation_id,
    'request_ref', ar.request_ref,
    'occurred_at', to_char(ar.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'details', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'field', d.field_name,
                 'old', d.old_value_masked,
                 'new', d.new_value_masked,
                 'class', d.value_classification
               ) ORDER BY d.field_name, d.id)
      FROM iam.audit_record_details d WHERE d.audit_record_id = ar.id
    ), '[]'::jsonb)
  )::text
  FROM iam.audit_records ar WHERE ar.id = p_audit_record_id;
$$;

COMMENT ON FUNCTION iam.audit_canonical(uuid) IS
  'Deterministic canonical JSON text for an audit record and its (field-ordered) details. jsonb sorts keys, so the text is stable for identical logical content — the input to the chain hash.';

CREATE OR REPLACE FUNCTION iam.audit_hash(p_prev bytea, p_canonical text)
RETURNS bytea
LANGUAGE sql
IMMUTABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT extensions.digest(p_prev || convert_to(p_canonical, 'UTF8'), 'sha256');
$$;

COMMENT ON FUNCTION iam.audit_hash(bytea, text) IS
  'record_hash = SHA-256(prev_hash || UTF8(canonical)). 32-byte output.';

REVOKE EXECUTE ON FUNCTION iam.audit_mask(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION iam.audit_canonical(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION iam.audit_hash(bytea, text) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 6. iam.audit_append — the sole writer (P1-04-DB-022).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.audit_append(
  p_tenant       uuid,
  p_actor        uuid,
  p_actor_kind   text,
  p_action       text,
  p_entity_type  text,
  p_entity_id    uuid    DEFAULT NULL,
  p_company      uuid    DEFAULT NULL,
  p_branch       uuid    DEFAULT NULL,
  p_correlation  uuid    DEFAULT NULL,
  p_request_ref  text    DEFAULT NULL,
  p_details      jsonb   DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_seq       bigint;
  v_id        uuid;
  v_prev      bytea;
  v_hash      bytea;
  v_canonical text;
  v_detail    jsonb;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'audit_append requires a tenant' USING ERRCODE = 'check_violation';
  END IF;

  -- Serialize this tenant's chain: seq + prev_hash are assigned under the lock,
  -- which is held to COMMIT — concurrent appends cannot fork the chain.
  PERFORM pg_advisory_xact_lock(hashtext('iam.audit:' || p_tenant::text));

  SELECT COALESCE(max(seq), 0) + 1 INTO v_seq FROM iam.audit_records WHERE tenant_id = p_tenant;
  v_id := gen_random_uuid();

  INSERT INTO iam.audit_records
    (id, tenant_id, seq, actor_id, actor_kind, action, entity_type, entity_id,
     company_id, branch_id, correlation_id, request_ref, occurred_at)
  VALUES
    (v_id, p_tenant, v_seq, p_actor, p_actor_kind, p_action, p_entity_type, p_entity_id,
     p_company, p_branch, p_correlation, p_request_ref, now());

  FOR v_detail IN SELECT * FROM jsonb_array_elements(COALESCE(p_details, '[]'::jsonb)) LOOP
    INSERT INTO iam.audit_record_details
      (tenant_id, audit_record_id, field_name, old_value_masked, new_value_masked, value_classification)
    VALUES
      (p_tenant, v_id, v_detail ->> 'field',
       iam.audit_mask(v_detail ->> 'old', COALESCE(v_detail ->> 'class', 'internal')),
       iam.audit_mask(v_detail ->> 'new', COALESCE(v_detail ->> 'class', 'internal')),
       COALESCE(v_detail ->> 'class', 'internal'));
  END LOOP;

  SELECT record_hash INTO v_prev
    FROM iam.audit_integrity_links WHERE tenant_id = p_tenant ORDER BY seq DESC LIMIT 1;
  IF v_prev IS NULL THEN
    v_prev := decode(repeat('00', 32), 'hex'); -- genesis: 32 zero bytes
  END IF;

  v_canonical := iam.audit_canonical(v_id);
  v_hash := iam.audit_hash(v_prev, v_canonical);

  INSERT INTO iam.audit_integrity_links (tenant_id, audit_record_id, seq, prev_hash, record_hash)
  VALUES (p_tenant, v_id, v_seq, v_prev, v_hash);

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION iam.audit_append(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, jsonb) IS
  'Sole audit writer (P1-04-DB-022): under a per-tenant advisory lock, assigns the next seq, inserts the record + masked details + chain link in ONE transaction. A failure of any step aborts the caller''s transaction (nothing persists). SECURITY INVOKER; granted to no application role.';

REVOKE EXECUTE ON FUNCTION
  iam.audit_append(uuid, uuid, text, text, text, uuid, uuid, uuid, uuid, text, jsonb) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 7. iam.audit_verify_chain — recompute and detect tampering/gaps.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.audit_verify_chain(p_tenant uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_expected_seq  bigint := 1;
  v_expected_prev bytea := decode(repeat('00', 32), 'hex');
  v_link          record;
  v_recomputed    bytea;
BEGIN
  FOR v_link IN
    SELECT l.seq, l.prev_hash, l.record_hash, l.audit_record_id
    FROM iam.audit_integrity_links l WHERE l.tenant_id = p_tenant ORDER BY l.seq
  LOOP
    IF v_link.seq <> v_expected_seq THEN
      RETURN jsonb_build_object('ok', false, 'first_bad_seq', v_expected_seq, 'reason', 'gap');
    END IF;
    IF v_link.prev_hash <> v_expected_prev THEN
      RETURN jsonb_build_object('ok', false, 'first_bad_seq', v_link.seq, 'reason', 'broken_prev');
    END IF;
    v_recomputed := iam.audit_hash(v_link.prev_hash, iam.audit_canonical(v_link.audit_record_id));
    IF v_recomputed <> v_link.record_hash THEN
      RETURN jsonb_build_object('ok', false, 'first_bad_seq', v_link.seq, 'reason', 'hash_mismatch');
    END IF;
    v_expected_prev := v_link.record_hash;
    v_expected_seq := v_expected_seq + 1;
  END LOOP;

  -- Every record must be linked: a forged record inserted without a chain link
  -- (fabrication, not alteration) shows up as more records than links.
  IF (SELECT count(*) FROM iam.audit_records WHERE tenant_id = p_tenant) <> (v_expected_seq - 1) THEN
    RETURN jsonb_build_object('ok', false, 'first_bad_seq', v_expected_seq - 1, 'reason', 'orphan_record');
  END IF;

  RETURN jsonb_build_object('ok', true, 'verified_through', v_expected_seq - 1);
END;
$$;

COMMENT ON FUNCTION iam.audit_verify_chain(uuid) IS
  'Walks a tenant''s chain in seq order, recomputing each record_hash and checking prev-hash continuity and seq contiguity. Returns {ok:true, verified_through} or {ok:false, first_bad_seq, reason: gap|broken_prev|hash_mismatch}. No external anchoring is claimed.';

REVOKE EXECUTE ON FUNCTION iam.audit_verify_chain(uuid) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 8. Row-Level Security — enabled AND forced; NO policy, NO grant (platform).
-- ----------------------------------------------------------------------------
ALTER TABLE iam.audit_records         ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.audit_records         FORCE  ROW LEVEL SECURITY;
ALTER TABLE iam.audit_record_details  ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.audit_record_details  FORCE  ROW LEVEL SECURITY;
ALTER TABLE iam.audit_integrity_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.audit_integrity_links FORCE  ROW LEVEL SECURITY;
ALTER TABLE iam.security_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.security_events        FORCE  ROW LEVEL SECURITY;
-- No policies and no grants in this increment: audit tables are platform-only.
-- Increment I adds the permission-gated audit-view read path.
