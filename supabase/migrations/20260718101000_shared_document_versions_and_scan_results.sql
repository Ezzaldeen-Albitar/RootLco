-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: versioned document file metadata and file scan results
-- Tasks: P1-05-DB-003, P1-05-DB-004
-- Owner module: shared
--
-- Purpose
--   document_versions is the append-only, per-version METADATA of a document's
--   file (storage key, content type, size, SHA-256, uploader) — NO bytes. A
--   version becomes 'accepted' only after an applicable CLEAN scan and with no
--   infected scan on record; acceptance/quarantine/rejection are one-way and the
--   accepted content is immutable (replacement is a NEW version, never an edit).
--   file_scan_results is the append-only history of scan verdicts per version.
--
-- Dependencies
--   Increment A shared.documents (composite candidate key (tenant_id, id)),
--   Phase 1-3 org.tenants, iam context readers, org.guard_immutable_columns.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only);
--   roll-forward-only once versions/scans exist. Recorded in
--   docs/database/phase-1-5-migration-classification.md.
--
-- Security implications
--   * storage_key is opaque METADATA, never an authorization token: knowing a
--     document_id / version_id / storage_key / sha256 grants no access (access is
--     tenant RLS now, link-derived in Increment C).
--   * The accept gate (shared.guard_document_version_transition) is a controlled
--     trigger, not a CHECK subquery: 'accepted' requires a clean scan and forbids
--     any infected scan; terminal states are immutable.
--   * sha256 stored as 32-byte bytea (repo hash convention). size_bytes > 0.
--   * Runtime holds SELECT only on both tables. Uploading and scanning are
--     backend/worker operations (worker-role handoff, Phase 1-13); no write grant.
--
-- Objects created
--   Tables:    shared.document_versions, shared.file_scan_results
--   Functions: shared.guard_document_version_transition()
--   Triggers:  tg_document_versions_guard_transition, tg_document_versions_immutable
--   Policies:  sel_document_versions_tenant, sel_file_scan_results_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shared.document_versions (P1-05-DB-003) — append-only version metadata.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.document_versions (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  document_id    uuid        NOT NULL,
  version_number integer     NOT NULL,
  storage_key    text        NOT NULL,
  content_type   text        NOT NULL,
  size_bytes     bigint      NOT NULL,
  sha256         bytea       NOT NULL,
  uploaded_by    uuid        NOT NULL,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  status         text        NOT NULL DEFAULT 'pending',
  accepted_at    timestamptz NULL,
  quarantined_at timestamptz NULL,
  rejected_at    timestamptz NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,

  CONSTRAINT pk_document_versions PRIMARY KEY (id),
  CONSTRAINT uq_document_versions_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_document_versions_number UNIQUE (tenant_id, document_id, version_number),
  CONSTRAINT fk_document_versions_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_document_versions_document
    FOREIGN KEY (tenant_id, document_id) REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_document_versions_number_positive CHECK (version_number >= 1),
  CONSTRAINT ck_document_versions_size_positive CHECK (size_bytes > 0),
  CONSTRAINT ck_document_versions_sha256_len CHECK (octet_length(sha256) = 32),
  -- storage_key is an opaque, structured handle: no whitespace, no '@', bounded.
  -- (charset regex + explicit length; a {m,n} bound above 255 is not portable.)
  CONSTRAINT ck_document_versions_storage_key_format
    CHECK (
      storage_key ~ '^[A-Za-z0-9][A-Za-z0-9._/=-]*$'
      AND char_length(storage_key) BETWEEN 8 AND 512
    ),
  CONSTRAINT ck_document_versions_content_type_format
    CHECK (content_type ~ '^[a-z0-9]+/[a-z0-9][a-z0-9.+-]*$'),
  CONSTRAINT ck_document_versions_status
    CHECK (status IN ('pending', 'accepted', 'quarantined', 'rejected')),
  -- terminal timestamps are set only for their own status (by the transition guard).
  CONSTRAINT ck_document_versions_accepted_at CHECK (accepted_at IS NULL OR status = 'accepted'),
  CONSTRAINT ck_document_versions_quarantined_at
    CHECK (quarantined_at IS NULL OR status = 'quarantined'),
  CONSTRAINT ck_document_versions_rejected_at CHECK (rejected_at IS NULL OR status = 'rejected')
);

COMMENT ON TABLE shared.document_versions IS
  'Append-only per-version file METADATA (P1-05-DB-003) — no bytes. version_number is unique per document. A version starts pending and transitions once to accepted (requires a clean scan, no infected scan), quarantined, or rejected via shared.guard_document_version_transition; terminal rows are immutable. Runtime SELECT-only.';
COMMENT ON COLUMN shared.document_versions.storage_key IS
  'Opaque, structured object-store handle (metadata only). NOT an authorization token: possessing it grants no access. Must carry no email, phone, VIN, name, or registration number (storage-key convention, Increment N).';
COMMENT ON COLUMN shared.document_versions.sha256 IS
  'SHA-256 of the file content, 32-byte bytea. Integrity value, not an access token.';

-- ----------------------------------------------------------------------------
-- 2. shared.file_scan_results (P1-05-DB-004) — append-only scan verdict history.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.file_scan_results (
  id           uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  version_id   uuid        NOT NULL,
  scan_status  text        NOT NULL,
  scanner_code text        NOT NULL,
  threat_name  text        NULL,
  details      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  scanned_at   timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid        NOT NULL,

  CONSTRAINT pk_file_scan_results PRIMARY KEY (id),
  CONSTRAINT fk_file_scan_results_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_file_scan_results_version
    FOREIGN KEY (tenant_id, version_id)
    REFERENCES shared.document_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_file_scan_results_status
    CHECK (scan_status IN ('pending', 'clean', 'infected', 'error')),
  CONSTRAINT ck_file_scan_results_scanner_format
    CHECK (scanner_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  -- a threat name is meaningful only for an infected verdict.
  CONSTRAINT ck_file_scan_results_threat_only_infected
    CHECK (threat_name IS NULL OR scan_status = 'infected'),
  CONSTRAINT ck_file_scan_results_details_object CHECK (jsonb_typeof(details) = 'object')
);

COMMENT ON TABLE shared.file_scan_results IS
  'Append-only scan verdict history per document version (P1-05-DB-004): pending|clean|infected|error, provider-neutral scanner_code. An infected verdict blocks acceptance and supports quarantine. details is sanitized JSON — no secrets, no unmasked restricted values. Runtime SELECT-only; scanning is a worker operation (Phase 1-13).';

CREATE INDEX ix_file_scan_results_version ON shared.file_scan_results (tenant_id, version_id);

-- ----------------------------------------------------------------------------
-- 3. Version transition guard (P1-05-SEC, §6-C): controlled one-way lifecycle.
--    A CHECK cannot query file_scan_results, so the clean-scan gate lives here.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.guard_document_version_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  -- Terminal states are immutable: only a pending version may transition.
  IF OLD.status <> 'pending' THEN
    RAISE EXCEPTION 'document version % is % and cannot change', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW; -- no-op update on a pending version
  END IF;

  IF NEW.status = 'accepted' THEN
    IF EXISTS (
      SELECT 1 FROM shared.file_scan_results
      WHERE tenant_id = NEW.tenant_id AND version_id = NEW.id AND scan_status = 'infected'
    ) THEN
      RAISE EXCEPTION 'cannot accept version %: an infected scan exists', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM shared.file_scan_results
      WHERE tenant_id = NEW.tenant_id AND version_id = NEW.id AND scan_status = 'clean'
    ) THEN
      RAISE EXCEPTION 'cannot accept version %: no clean scan on record', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
    NEW.accepted_at := now();
  ELSIF NEW.status = 'quarantined' THEN
    NEW.quarantined_at := now();
  ELSIF NEW.status = 'rejected' THEN
    NEW.rejected_at := now();
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_document_version_transition() IS
  'BEFORE UPDATE guard on shared.document_versions: enforces the one-way lifecycle. Only a pending version transitions; acceptance requires a clean scan and forbids any infected scan; terminal states are immutable. Stamps the matching *_at timestamp.';

REVOKE EXECUTE ON FUNCTION shared.guard_document_version_transition() FROM PUBLIC;

CREATE TRIGGER tg_document_versions_guard_transition
  BEFORE UPDATE ON shared.document_versions
  FOR EACH ROW EXECUTE FUNCTION shared.guard_document_version_transition();
CREATE TRIGGER tg_document_versions_immutable
  BEFORE UPDATE ON shared.document_versions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'document_id', 'version_number', 'storage_key', 'content_type',
    'size_bytes', 'sha256', 'uploaded_by', 'uploaded_at', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 4. Row-Level Security — enabled AND forced; default deny; tenant isolation.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.document_versions FORCE  ROW LEVEL SECURITY;
ALTER TABLE shared.file_scan_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.file_scan_results FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_document_versions_tenant ON shared.document_versions
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_file_scan_results_tenant ON shared.file_scan_results
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 5. Grants — SELECT only. Upload/scan writes are backend/worker operations.
-- ----------------------------------------------------------------------------
GRANT SELECT ON shared.document_versions TO app_runtime, app_readonly;
GRANT SELECT ON shared.file_scan_results TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles on both tables.
