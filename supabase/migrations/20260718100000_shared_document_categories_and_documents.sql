-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: document categories and document metadata foundation
-- Tasks: P1-05-DB-001, P1-05-DB-002
-- Owner module: shared
--
-- Purpose
--   The tenant-agnostic foundation for governed file METADATA. document_categories
--   defines the platform-default or tenant-override policy envelope (allowed
--   content types, size ceiling, default classification and retention) for a class
--   of document; documents holds the per-file governed record. NO file bytes are
--   stored here (that is later backend/object-storage scope) — this phase stores
--   metadata and governed state only.
--
-- Dependencies
--   Phase 1-3 org.tenants / org.legal_companies / org.branches (scope + composite
--   candidate keys), 0002 iam context readers, shared.touch_row_metadata,
--   org.guard_immutable_columns.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once documents exist (they are governed records referenced
--   by versions/links). Recorded in
--   docs/database/phase-1-5-migration-classification.md.
--
-- Security implications
--   * Both tables are tenant-isolated under FORCE RLS. document_categories is
--     dual-scope: platform rows (tenant_id NULL) are readable by every tenant
--     (shared policy envelope), tenant rows only by their tenant; a tenant can
--     never see or reference another tenant's category (guard trigger).
--   * A document's category must be a PLATFORM category or one owned by the SAME
--     tenant — enforced by shared.guard_document_category_scope, because a simple
--     FK cannot express "platform OR same-tenant".
--   * Runtime holds SELECT only. Creating categories/documents is a platform /
--     Phase-1-13 backend operation; there is no INSERT/UPDATE/DELETE grant.
--   * category_code / tenant scope / created_* are immutable once set.
--   * legal_hold defaults FALSE; retention/legal-hold ENFORCEMENT arrives in
--     Increment D (this migration only records the flag).
--
-- Objects created
--   Tables:    shared.document_categories, shared.documents
--   Functions: shared.guard_document_category_scope()
--   Triggers:  tg_document_categories_touch_metadata, tg_document_categories_immutable,
--              tg_documents_touch_metadata, tg_documents_immutable,
--              tg_documents_category_scope
--   Policies:  sel_document_categories_visible, sel_documents_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shared.document_categories (P1-05-DB-001) — dual-scope policy envelope.
--    tenant_id is NULL for a platform default and NOT NULL for a tenant override
--    (nullable-tenant exception, registered in tests/db/org-security.test.ts).
-- ----------------------------------------------------------------------------
CREATE TABLE shared.document_categories (
  id                      uuid        NOT NULL DEFAULT gen_random_uuid(),
  scope                   text        NOT NULL,
  tenant_id               uuid        NULL,
  category_code           text        NOT NULL,
  name                    text        NOT NULL,
  description             text        NULL,
  allowed_content_types   text[]      NOT NULL,
  max_size_bytes          bigint      NOT NULL,
  default_classification  text        NOT NULL,
  default_retention_class text        NOT NULL,
  status                  text        NOT NULL DEFAULT 'active',
  deleted_at              timestamptz NULL,
  record_version          integer     NOT NULL DEFAULT 1,
  created_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid        NOT NULL,
  updated_at             timestamptz NULL,
  updated_by             uuid        NULL,

  CONSTRAINT pk_document_categories PRIMARY KEY (id),
  CONSTRAINT fk_document_categories_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_document_categories_scope CHECK (scope IN ('platform', 'tenant')),
  CONSTRAINT ck_document_categories_scope_tenant CHECK (
    (scope = 'platform' AND tenant_id IS NULL)
    OR (scope = 'tenant' AND tenant_id IS NOT NULL)
  ),
  CONSTRAINT ck_document_categories_code_format
    CHECK (category_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_document_categories_name_not_blank CHECK (btrim(name) <> ''),
  -- At least one allowed content type, and no empty entry. Per-element MIME
  -- format is governed data validated against uploads by later backend phases
  -- (a subquery cannot appear in a CHECK); the DB guarantees presence + non-blank.
  CONSTRAINT ck_document_categories_content_types_present
    CHECK (cardinality(allowed_content_types) >= 1 AND NOT ('' = ANY (allowed_content_types))),
  CONSTRAINT ck_document_categories_max_size CHECK (max_size_bytes > 0),
  CONSTRAINT ck_document_categories_classification
    CHECK (default_classification IN ('public', 'internal', 'restricted', 'secret')),
  CONSTRAINT ck_document_categories_retention CHECK (
    default_retention_class IN (
      'operational', 'evidence-audit', 'personal-data', 'temporary',
      'immutable-financial-history'
    )
  ),
  CONSTRAINT ck_document_categories_status CHECK (status IN ('active', 'disabled'))
);

COMMENT ON TABLE shared.document_categories IS
  'Dual-scope document policy envelope (P1-05-DB-001). A platform row (tenant_id NULL) is a shared default readable by every tenant; a tenant row (tenant_id NOT NULL) is a tenant override. Defines allowed content types, size ceiling, and default classification/retention for a class of document. Category constraints are DATA — no upload implementation lives here. Runtime SELECT-only.';
COMMENT ON COLUMN shared.document_categories.allowed_content_types IS
  'Allow-list of MIME types this category accepts. Enforced against uploads by later backend phases; here it is governed data, not an upload path.';
COMMENT ON COLUMN shared.document_categories.max_size_bytes IS
  'Maximum accepted size for this category. A ceiling expressed as data; no byte is stored in the database.';

-- Platform category codes are unique platform-wide (among non-deleted rows);
-- tenant category codes are unique per tenant (among non-deleted rows).
CREATE UNIQUE INDEX uq_document_categories_platform_code
  ON shared.document_categories (category_code)
  WHERE scope = 'platform' AND deleted_at IS NULL;
CREATE UNIQUE INDEX uq_document_categories_tenant_code
  ON shared.document_categories (tenant_id, category_code)
  WHERE scope = 'tenant' AND deleted_at IS NULL;

CREATE TRIGGER tg_document_categories_touch_metadata
  BEFORE UPDATE ON shared.document_categories
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_document_categories_immutable
  BEFORE UPDATE ON shared.document_categories
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'scope', 'tenant_id', 'category_code', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 2. shared.documents (P1-05-DB-002) — per-file governed metadata record.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.documents (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NULL,
  branch_id      uuid        NULL,
  category_id    uuid        NOT NULL,
  title          text        NOT NULL,
  classification text        NOT NULL,
  retention_class text       NOT NULL,
  legal_hold     boolean     NOT NULL DEFAULT false,
  status         text        NOT NULL DEFAULT 'pending',
  archived_at    timestamptz NULL,
  deleted_at     timestamptz NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_documents PRIMARY KEY (id),
  CONSTRAINT uq_documents_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_documents_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_documents_company
    FOREIGN KEY (tenant_id, company_id) REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_documents_branch
    FOREIGN KEY (tenant_id, branch_id) REFERENCES org.branches (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_documents_category
    FOREIGN KEY (category_id) REFERENCES shared.document_categories (id) ON DELETE RESTRICT,
  CONSTRAINT ck_documents_title_not_blank CHECK (btrim(title) <> ''),
  CONSTRAINT ck_documents_classification
    CHECK (classification IN ('public', 'internal', 'restricted', 'secret')),
  CONSTRAINT ck_documents_retention CHECK (
    retention_class IN (
      'operational', 'evidence-audit', 'personal-data', 'temporary',
      'immutable-financial-history'
    )
  ),
  CONSTRAINT ck_documents_status
    CHECK (status IN ('pending', 'accepted', 'quarantined', 'archived'))
);

COMMENT ON TABLE shared.documents IS
  'Governed per-file METADATA (P1-05-DB-002). No file bytes: object storage is later backend scope. A document''s category is a platform category or one owned by the same tenant (shared.guard_document_category_scope). classification/retention_class default from the category at creation but are recorded per document. legal_hold defaults false; enforcement is Increment D. Runtime SELECT-only.';
COMMENT ON COLUMN shared.documents.legal_hold IS
  'When true, a legal hold blocks deletion absolutely (enforced by the retention routine, Increment D). Defaults false.';
COMMENT ON COLUMN shared.documents.status IS
  'pending | accepted | quarantined | archived. Version-level acceptance (clean-scan gate) is enforced on shared.document_versions in Increment B.';

CREATE INDEX ix_documents_category ON shared.documents (category_id);
CREATE INDEX ix_documents_company ON shared.documents (tenant_id, company_id);
CREATE INDEX ix_documents_branch ON shared.documents (tenant_id, branch_id);
CREATE INDEX ix_documents_tenant_status ON shared.documents (tenant_id, status);

CREATE TRIGGER tg_documents_touch_metadata
  BEFORE UPDATE ON shared.documents
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_documents_immutable
  BEFORE UPDATE ON shared.documents
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'category_id', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 3. Category-scope guard: a document may reference a PLATFORM category or one
--    owned by the SAME tenant — never another tenant's category. A simple FK
--    cannot express this, so a trigger enforces it (BR: link integrity).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.guard_document_category_scope()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_scope     text;
  v_cat_tenant uuid;
BEGIN
  SELECT scope, tenant_id INTO v_scope, v_cat_tenant
  FROM shared.document_categories WHERE id = NEW.category_id;

  IF v_scope IS NULL THEN
    RAISE EXCEPTION 'document category % does not exist', NEW.category_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_scope = 'tenant' AND v_cat_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'document category % belongs to another tenant', NEW.category_id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_document_category_scope() IS
  'BEFORE INSERT/UPDATE guard on shared.documents: the referenced category must be platform-scoped or owned by the document''s tenant. Rejects cross-tenant category references a plain FK cannot catch.';

REVOKE EXECUTE ON FUNCTION shared.guard_document_category_scope() FROM PUBLIC;

CREATE TRIGGER tg_documents_category_scope
  BEFORE INSERT OR UPDATE OF category_id, tenant_id ON shared.documents
  FOR EACH ROW EXECUTE FUNCTION shared.guard_document_category_scope();

-- ----------------------------------------------------------------------------
-- 4. Row-Level Security — enabled AND forced; default deny.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.document_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.document_categories FORCE  ROW LEVEL SECURITY;
ALTER TABLE shared.documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.documents           FORCE  ROW LEVEL SECURITY;

-- Platform categories are visible to every tenant (shared envelope); tenant
-- categories only within the owning tenant.
CREATE POLICY sel_document_categories_visible ON shared.document_categories
  FOR SELECT TO app_runtime, app_readonly
  USING (scope = 'platform' OR tenant_id = iam.current_tenant_id());

-- Documents are tenant-isolated. Restricted-document permission gating and the
-- link-derived access contract are layered on in Increment C/L; this baseline is
-- strict tenant isolation.
CREATE POLICY sel_documents_tenant ON shared.documents
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 5. Grants — explicit, minimal (SELECT only). Writes are platform/backend ops.
-- ----------------------------------------------------------------------------
GRANT SELECT ON shared.document_categories TO app_runtime, app_readonly;
GRANT SELECT ON shared.documents           TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles on both tables.
