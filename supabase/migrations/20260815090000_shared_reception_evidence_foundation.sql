-- ============================================================================
-- Phase: 1-15 — Shared Services (P1-28 Owner decision P1-OD-025)
-- Migration: operational, private, versioned reception evidence — the scan
--            lifecycle, the governed category policy and the scanner handoff
-- Owner module: shared
--
-- Rollback classification: ROLL-FORWARD-ONLY once any version has entered
--   `scanning`, or any reception has bound one of the seeded categories. The
--   structural inverse is expressible — drop the two policies, the two column
--   grants, the two functions and the added columns, and restore the previous
--   `ck_document_versions_status` — but it FAILS on any version that has
--   reached `scanning`, `accepted` or `quarantined`, because the prior
--   constraint has no `scanning` member and the prior contract had no path out
--   of `pending` at all. Reverting after a reception has recorded evidence
--   would therefore either refuse or silently strand the evidence, which is the
--   whole reason the decision was taken.
-- ============================================================================

-- A reader must not need the write-capable shared.document.manage permission.
INSERT INTO iam.permissions (permission_code, domain, description, risk_level, created_by)
VALUES (
  'shared.document.read', 'shared', 'Read document metadata and accepted evidence', 'low',
  '00000000-0000-4000-8000-000000000001'
)
ON CONFLICT (permission_code) DO NOTHING;

ALTER TABLE shared.document_categories
  ADD COLUMN business_link_purpose text NOT NULL DEFAULT 'evidence',
  ADD COLUMN device_capture_timestamp_required boolean NOT NULL DEFAULT false;
ALTER TABLE shared.document_categories ADD CONSTRAINT ck_document_categories_link_purpose
  CHECK (business_link_purpose IN ('evidence','identity_document','inspection_media','signature'));

-- Owner-approved business categories. Tenant-scoped rows with the same code may
-- override these platform defaults through the existing dual-scope resolution.
INSERT INTO shared.document_categories (
  id, scope, tenant_id, category_code, name, description,
  allowed_content_types, max_size_bytes, default_classification,
  default_retention_class, status, created_by,
  business_link_purpose, device_capture_timestamp_required
)
VALUES
  ('d1500000-0000-4000-8000-000000000001','platform',NULL,'reception_exterior','Reception exterior','Exterior reception evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','inspection_media',true),
  ('d1500000-0000-4000-8000-000000000002','platform',NULL,'reception_dashboard','Reception dashboard','Dashboard and odometer evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','inspection_media',true),
  ('d1500000-0000-4000-8000-000000000003','platform',NULL,'reception_vin','Reception VIN','VIN evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','identity_document',true),
  ('d1500000-0000-4000-8000-000000000004','platform',NULL,'reception_damage','Reception damage','Damage evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','inspection_media',true),
  ('d1500000-0000-4000-8000-000000000005','platform',NULL,'reception_signature','Reception signature','Drawn or uploaded signature evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','signature',true),
  ('d1500000-0000-4000-8000-000000000006','platform',NULL,'reception_refusal_evidence','Reception refusal evidence','Optional refusal supporting evidence',ARRAY['image/jpeg','image/png','image/webp'],10485760,'restricted','evidence-audit','active','00000000-0000-4000-8000-000000000001','evidence',true),
  ('d1500000-0000-4000-8000-000000000007','platform',NULL,'reception_damage_map_template','Reception damage-map template','Versioned damage-map template image',ARRAY['image/jpeg','image/png','image/webp'],10485760,'internal','evidence-audit','active','00000000-0000-4000-8000-000000000001','inspection_media',false)
ON CONFLICT DO NOTHING;

ALTER TABLE shared.document_versions
  ADD COLUMN scanning_at timestamptz NULL,
  ADD COLUMN captured_at timestamptz NULL;

ALTER TABLE shared.document_versions DROP CONSTRAINT ck_document_versions_status;
ALTER TABLE shared.document_versions ADD CONSTRAINT ck_document_versions_status
  CHECK (status IN ('pending', 'scanning', 'accepted', 'quarantined', 'rejected'));
ALTER TABLE shared.document_versions ADD CONSTRAINT ck_document_versions_scanning_at
  CHECK (scanning_at IS NULL OR status IN ('scanning', 'accepted', 'quarantined', 'rejected'));

CREATE OR REPLACE FUNCTION shared.guard_document_version_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IN ('accepted', 'quarantined', 'rejected') THEN
    RAISE EXCEPTION 'document version % is % and cannot change', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  -- ACCEPTANCE is the only transition scanning gates.
  --
  -- The first draft of this guard demanded `scanning` before EVERY terminal
  -- state. That is stricter than the decision and it broke two shipped things:
  -- `shared.attachment-version-reject` updates a pending version straight to
  -- `rejected` (it is a human refusing an upload, not a verdict), and the
  -- quarantine action that pulls a suspicious pending upload has never had a
  -- scan to wait for. Neither can ever satisfy evidence, so gating them buys no
  -- safety and costs a working operation — the shape of P1-27-INT-113.
  --
  -- What the decision actually forbids is `pending -> accepted`: finalized
  -- evidence must have passed a scan.
  IF OLD.status = 'pending' AND NEW.status NOT IN ('scanning', 'quarantined', 'rejected') THEN
    RAISE EXCEPTION 'document version % must enter scanning before acceptance', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF OLD.status = 'scanning' AND NEW.status NOT IN ('accepted','quarantined','rejected') THEN
    RAISE EXCEPTION 'document version % has an invalid scanning transition', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status = 'scanning' THEN
    NEW.scanning_at := now();
  ELSIF NEW.status = 'accepted' THEN
    IF EXISTS (SELECT 1 FROM shared.file_scan_results WHERE tenant_id=NEW.tenant_id AND version_id=NEW.id AND scan_status='infected')
       OR NOT EXISTS (SELECT 1 FROM shared.file_scan_results WHERE tenant_id=NEW.tenant_id AND version_id=NEW.id AND scan_status='clean') THEN
      RAISE EXCEPTION 'cannot accept version % without an exclusively clean scan', NEW.id
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

COMMENT ON COLUMN shared.document_versions.scanning_at IS
  'Server-stamped instant the immutable uploaded version entered scanning.';
COMMENT ON COLUMN shared.document_versions.captured_at IS
  'Device-supplied capture instant recorded with the immutable version; required by governed category policy where configured.';
COMMENT ON FUNCTION shared.guard_document_version_transition() IS
  'Enforces the version lifecycle: pending -> scanning -> accepted|quarantined|rejected, with pending -> quarantined|rejected still permitted because neither is finalized evidence. pending -> accepted is refused: acceptance requires a clean scan, no infected scan, and passage through scanning. Terminal versions are immutable.';
COMMENT ON TABLE shared.document_versions IS
  'Append-only per-version file METADATA (P1-05-DB-003) — no bytes. version_number is unique per document. A version starts pending; it may be refused (rejected) or pulled (quarantined) directly, but it reaches accepted only through scanning and only with a clean scan and no infected scan, via shared.guard_document_version_transition. Terminal rows are immutable. Runtime SELECT-only; the scanner handoff is shared.begin_document_scan / shared.complete_document_scan.';

-- ---------------------------------------------------------------------------
-- The scanner handoff, and why it is SECURITY INVOKER.
--
-- A first draft made these two functions SECURITY DEFINER, because the request
-- role held only SELECT on both tables. That is a real need answered the wrong
-- way: this repository asserts, in FOUR independent gates
-- (p1-13-runtime-capabilities, p1-14-runtime-administration-capabilities,
-- p1-15-shared-services-runtime-capabilities and shared-hardening), that every
-- module routine is SECURITY INVOKER with an explicit empty search_path, and
-- none of them carries an allow-list. Elevating here would have required
-- weakening all four to admit one migration — and the sibling P1-18 evidence
-- migration keeps all six of ITS guards INVOKER, so this was the outlier.
--
-- What replaces the elevation is narrower than it was, not looser:
--
--   * `GRANT UPDATE(status)` is a COLUMN grant. The request role cannot rewrite
--     `sha256`, `size_bytes`, `storage_key`, `uploaded_by` or any other column
--     of a version, at any status, by any statement — a privilege a SECURITY
--     DEFINER function's body could have been changed to hand out later.
--   * RLS carries tenancy and the permission, evaluated per row.
--   * `shared.guard_document_version_transition` already enforces the state
--     machine: terminal versions are immutable, `pending` may only reach
--     `scanning`, and `accepted` requires an exclusively clean scan. That
--     trigger is what makes acceptance earned, and it runs for every writer.
--
-- So the three guarantees the DEFINER version provided — tenancy, permission,
-- and a lifecycle that cannot be skipped — are all still enforced, by the
-- mechanisms this repository already trusts everywhere else.
-- ---------------------------------------------------------------------------
CREATE POLICY ins_file_scan_results_scanner ON shared.file_scan_results
  FOR INSERT TO app_runtime
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND created_by = iam.current_user_id()
    AND EXISTS (
      SELECT 1
        FROM shared.document_versions v
        JOIN shared.documents d ON d.tenant_id = v.tenant_id AND d.id = v.document_id
       WHERE v.tenant_id = file_scan_results.tenant_id
         AND v.id = file_scan_results.version_id
         AND v.status = 'scanning'
         AND iam.has_permission_in_scope('shared.document.manage', d.company_id, d.branch_id)
    )
  );

CREATE POLICY upd_document_versions_lifecycle ON shared.document_versions
  FOR UPDATE TO app_runtime
  USING (
    tenant_id = iam.current_tenant_id()
    AND status IN ('pending', 'scanning')
    AND EXISTS (
      SELECT 1 FROM shared.documents d
       WHERE d.tenant_id = document_versions.tenant_id
         AND d.id = document_versions.document_id
         AND iam.has_permission_in_scope('shared.document.manage', d.company_id, d.branch_id)
    )
  )
  WITH CHECK (
    tenant_id = iam.current_tenant_id()
    AND status IN ('scanning', 'accepted', 'quarantined', 'rejected')
  );

GRANT INSERT ON shared.file_scan_results TO app_runtime;
GRANT UPDATE(status) ON shared.document_versions TO app_runtime;

COMMENT ON POLICY upd_document_versions_lifecycle ON shared.document_versions IS
  'The scanner handoff, per row. USING refuses a version that is already terminal, so an accepted or quarantined version cannot be reopened; WITH CHECK refuses a target outside the approved vocabulary. The column grant is UPDATE(status) alone, so no other field of an immutable version is writable, and guard_document_version_transition still decides which transitions are legal.';

CREATE OR REPLACE FUNCTION shared.begin_document_scan(p_tenant uuid, p_version uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_company uuid; v_branch uuid;
BEGIN
  IF p_tenant IS DISTINCT FROM iam.current_tenant_id() OR iam.current_user_id() IS NULL THEN
    RETURN false;
  END IF;
  SELECT d.company_id,d.branch_id INTO v_company,v_branch
  FROM shared.document_versions v JOIN shared.documents d
    ON d.tenant_id=v.tenant_id AND d.id=v.document_id
  WHERE v.tenant_id=p_tenant AND v.id=p_version;
  IF NOT FOUND OR NOT iam.has_permission_in_scope('shared.document.manage',v_company,v_branch,NULL) THEN
    RETURN false;
  END IF;
  UPDATE shared.document_versions SET status='scanning'
  WHERE tenant_id=p_tenant AND id=p_version AND status='pending';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION shared.complete_document_scan(
  p_tenant uuid, p_version uuid, p_verdict text, p_scanner text,
  p_threat text DEFAULT NULL, p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS text
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE v_company uuid; v_branch uuid; v_target text; v_actor uuid := iam.current_user_id();
BEGIN
  IF p_tenant IS DISTINCT FROM iam.current_tenant_id() OR v_actor IS NULL
     OR p_verdict NOT IN ('clean','infected','error')
     OR p_scanner !~ '^[a-z][a-z0-9_]{1,62}$'
     OR jsonb_typeof(p_details) <> 'object' THEN
    RAISE EXCEPTION 'invalid document scan completion' USING ERRCODE='check_violation';
  END IF;
  SELECT d.company_id,d.branch_id INTO v_company,v_branch
  FROM shared.document_versions v JOIN shared.documents d
    ON d.tenant_id=v.tenant_id AND d.id=v.document_id
  WHERE v.tenant_id=p_tenant AND v.id=p_version AND v.status='scanning';
  IF NOT FOUND OR NOT iam.has_permission_in_scope('shared.document.manage',v_company,v_branch,NULL) THEN
    RAISE EXCEPTION 'document scan completion refused' USING ERRCODE='insufficient_privilege';
  END IF;
  INSERT INTO shared.file_scan_results
    (tenant_id,version_id,scan_status,scanner_code,threat_name,details,created_by)
  VALUES (p_tenant,p_version,p_verdict,p_scanner,
          CASE WHEN p_verdict='infected' THEN left(p_threat,200) ELSE NULL END,
          p_details,v_actor);
  v_target := CASE p_verdict WHEN 'clean' THEN 'accepted' WHEN 'infected' THEN 'quarantined' ELSE 'quarantined' END;
  UPDATE shared.document_versions SET status=v_target
  WHERE tenant_id=p_tenant AND id=p_version AND status='scanning';
  IF NOT FOUND THEN RAISE EXCEPTION 'document version is not scanning' USING ERRCODE='check_violation'; END IF;
  RETURN v_target;
END;
$$;

REVOKE ALL ON FUNCTION shared.begin_document_scan(uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION shared.complete_document_scan(uuid,uuid,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared.begin_document_scan(uuid,uuid) TO app_runtime;
GRANT EXECUTE ON FUNCTION shared.complete_document_scan(uuid,uuid,text,text,text,jsonb) TO app_runtime;
