-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: tenant-scoped search projection metadata
-- Tasks: P1-05-DB-016, P1-05-QA-006 (partial)
-- Owner module: shared
--
-- Purpose
--   search_metadata stores bounded, normalized search projections for generic
--   domain entities. Source entities remain authoritative; this table is only
--   a rebuildable lookup projection and later domains own normalization.
--
-- Dependencies
--   Phase 1-3 organization scope and shared.languages, Phase 1-4 tenant and
--   permission context, pg_trgm in extensions, shared.touch_row_metadata(),
--   and org.guard_immutable_columns().
--
-- Rollback classification: ROLLBACK-SAFE while search_metadata is empty;
--   roll-forward-only once populated because dropping it would remove active
--   search projections and require a coordinated source-domain rebuild.
--
-- Security implications
--   * The table ENABLEs and FORCEs RLS. Runtime and readonly roles receive
--     SELECT only; no application-role write policy or grant exists.
--   * Public/internal rows are tenant-readable. Restricted/secret rows also
--     require iam.sensitive.view through iam.has_permission().
--   * normalized_value is a bounded projection, not an authoritative copy of
--     source content. No source-domain authorization is inferred from a hit.
--
-- Objects created
--   Table:    shared.search_metadata
--   Triggers: tg_search_metadata_immutable,
--             tg_search_metadata_touch_metadata
--   Policy:   sel_search_metadata_tenant
-- ============================================================================

CREATE TABLE shared.search_metadata (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  company_id        uuid        NULL,
  branch_id         uuid        NULL,
  entity_type       text        NOT NULL,
  entity_id         uuid        NOT NULL,
  field_code        text        NOT NULL,
  locale_code       text        NULL,
  normalized_value  text        NOT NULL,
  classification    text        NOT NULL DEFAULT 'internal',
  source_updated_at timestamptz NOT NULL,
  record_version    integer     NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_at        timestamptz NULL,
  updated_by        uuid        NULL,

  CONSTRAINT pk_search_metadata PRIMARY KEY (id),
  CONSTRAINT uq_search_metadata_identity
    UNIQUE NULLS NOT DISTINCT (
      tenant_id, entity_type, entity_id, field_code, locale_code
    ),
  CONSTRAINT fk_search_metadata_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_search_metadata_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_search_metadata_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_search_metadata_locale
    FOREIGN KEY (locale_code) REFERENCES shared.languages (locale_code) ON DELETE RESTRICT,
  CONSTRAINT ck_search_metadata_branch_requires_company
    CHECK (branch_id IS NULL OR company_id IS NOT NULL),
  CONSTRAINT ck_search_metadata_entity_type_format
    CHECK (entity_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT ck_search_metadata_field_code_format
    CHECK (field_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_search_metadata_value
    CHECK (btrim(normalized_value) <> '' AND char_length(normalized_value) <= 2048),
  CONSTRAINT ck_search_metadata_classification
    CHECK (classification IN ('public', 'internal', 'restricted', 'secret'))
);

COMMENT ON TABLE shared.search_metadata IS
  'Tenant-scoped, rebuildable search projection (P1-05-DB-016). It is projection only: the source entity is authoritative, and later source domains own normalization and refresh behavior. Generic entity identity is constrained syntactically but not FK-bound. Public/internal rows are tenant-readable; restricted/secret rows additionally require iam.sensitive.view. Runtime/readonly SELECT-only.';
COMMENT ON COLUMN shared.search_metadata.normalized_value IS
  'Bounded normalized search projection (maximum 2048 characters), indexed with pg_trgm. It is not authoritative source content.';
COMMENT ON COLUMN shared.search_metadata.source_updated_at IS
  'Timestamp of the authoritative source state represented by this projection; used by projection refreshers to reject stale work.';

-- The identity UNIQUE is non-partial and leads on tenant_id, covering the
-- tenant FK. Every other FK receives an explicit non-partial leading cover.
CREATE INDEX ix_search_metadata_company
  ON shared.search_metadata (tenant_id, company_id);
CREATE INDEX ix_search_metadata_branch
  ON shared.search_metadata (tenant_id, company_id, branch_id);
CREATE INDEX ix_search_metadata_locale
  ON shared.search_metadata (locale_code);
CREATE INDEX ix_search_metadata_normalized_value_trgm
  ON shared.search_metadata USING gin (normalized_value extensions.gin_trgm_ops);

CREATE TRIGGER tg_search_metadata_immutable
  BEFORE UPDATE ON shared.search_metadata
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'entity_type', 'entity_id', 'field_code', 'created_at', 'created_by');
CREATE TRIGGER tg_search_metadata_touch_metadata
  BEFORE UPDATE ON shared.search_metadata
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

ALTER TABLE shared.search_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.search_metadata FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_search_metadata_tenant ON shared.search_metadata
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (
      classification IN ('public', 'internal')
      OR iam.has_permission('iam.sensitive.view')
    )
  );

GRANT SELECT ON shared.search_metadata TO app_runtime, app_readonly;

-- Deliberately ABSENT: INSERT/UPDATE/DELETE grants and policies for every
-- application role. Projection maintenance is a backend/platform operation.
