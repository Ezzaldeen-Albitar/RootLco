-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: generic document links and the link-derived access contract
-- Tasks: P1-05-DB-005, P1-05-SEC-001, P1-05-QA-002
-- Owner module: shared
--
-- Purpose
--   document_links ties a document to a business entity (entity_type/entity_id)
--   without a real cross-domain FK (the domains do not exist yet). It establishes
--   the LINK-DERIVED ACCESS CONTRACT: a document is reachable through a live link
--   to an entity a principal may see — never by merely knowing a document_id or
--   storage_key. shared.document_ids_for_entity() is the RLS-scoped resolution
--   primitive that later domain policies compose; it returns nothing across
--   tenants and nothing for soft-deleted links.
--
-- Dependencies
--   Increment A shared.documents (composite candidate key (tenant_id, id)),
--   Phase 1-3 org.tenants, iam context readers, shared.touch_row_metadata,
--   org.guard_immutable_columns.
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only);
--   roll-forward-only once links exist. Recorded in
--   docs/database/phase-1-5-migration-classification.md.
--
-- Security implications
--   * entity_type is a constrained `schema.table` token (generic link; no real
--     FK is possible). Residual risk (a link to a non-existent/foreign entity id)
--     is documented in docs/security/document-access-and-file-security.md and
--     mitigated by per-domain validation + an orphan-review procedure (Increment N).
--   * Composite (tenant_id, document_id) FK makes a cross-tenant link impossible.
--   * The resolution primitive is SECURITY INVOKER: it runs under the caller's
--     RLS, so it can never leak another tenant's links, and a soft-deleted link
--     yields no access.
--   * Runtime holds SELECT + EXECUTE(resolver) only; creating/soft-deleting links
--     is a backend/domain operation (no write grant).
--
-- Objects created
--   Tables:    shared.document_links
--   Functions: shared.document_ids_for_entity(text, uuid)
--   Triggers:  tg_document_links_touch_metadata, tg_document_links_immutable
--   Policies:  sel_document_links_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. shared.document_links (P1-05-DB-005) — generic, tenant-scoped links.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.document_links (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  document_id    uuid        NOT NULL,
  entity_type    text        NOT NULL,
  entity_id      uuid        NOT NULL,
  link_purpose   text        NOT NULL,
  linked_by      uuid        NOT NULL,
  linked_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_document_links PRIMARY KEY (id),
  CONSTRAINT fk_document_links_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_document_links_document
    FOREIGN KEY (tenant_id, document_id) REFERENCES shared.documents (tenant_id, id) ON DELETE RESTRICT,
  -- generic entity reference: a `schema.table` token; no real FK is possible yet.
  CONSTRAINT ck_document_links_entity_type_format
    CHECK (entity_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT ck_document_links_purpose_format
    CHECK (link_purpose ~ '^[a-z][a-z0-9_]{1,62}$')
);

COMMENT ON TABLE shared.document_links IS
  'Generic tenant-scoped links from a document to a business entity (P1-05-DB-005). No real cross-domain FK exists yet, so entity_type is a constrained schema.table token and entity_id is validated per-domain by later phases. Establishes the link-derived access contract: reachability flows through a LIVE link, never from knowing a document_id/storage_key. Runtime SELECT + resolver EXECUTE only.';
COMMENT ON COLUMN shared.document_links.entity_type IS
  'schema.table token identifying the linked domain (e.g. crm.customer). Not FK-checked (domain absent); per-domain validation + orphan review are documented residual controls.';

-- One ACTIVE link per (document, entity, purpose); soft-deleted rows do not count.
CREATE UNIQUE INDEX uq_document_links_active
  ON shared.document_links (tenant_id, document_id, entity_type, entity_id, link_purpose)
  WHERE deleted_at IS NULL;
-- Entity-first lookup for the resolution primitive.
CREATE INDEX ix_document_links_entity
  ON shared.document_links (tenant_id, entity_type, entity_id)
  WHERE deleted_at IS NULL;

CREATE TRIGGER tg_document_links_touch_metadata
  BEFORE UPDATE ON shared.document_links
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_document_links_immutable
  BEFORE UPDATE ON shared.document_links
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'document_id', 'entity_type', 'entity_id', 'link_purpose',
    'linked_by', 'linked_at', 'created_at', 'created_by');

-- ----------------------------------------------------------------------------
-- 2. Link-derived access resolution primitive (P1-05-SEC-001, QA-002).
--    SECURITY INVOKER: runs under the caller's RLS, so cross-tenant links and
--    soft-deleted links are invisible. Later domain policies compose this with
--    "may the principal see entity X?" to authorize a document.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.document_ids_for_entity(p_entity_type text, p_entity_id uuid)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT document_id
  FROM shared.document_links
  WHERE entity_type = p_entity_type
    AND entity_id = p_entity_id
    AND deleted_at IS NULL;
$$;

COMMENT ON FUNCTION shared.document_ids_for_entity(text, uuid) IS
  'Link-derived access primitive (P1-05-QA-002): document ids linked to a given entity within the caller''s tenant (RLS-scoped, soft-deleted links excluded). The building block later domain policies compose to authorize a document — never document_id/storage_key possession.';

REVOKE EXECUTE ON FUNCTION shared.document_ids_for_entity(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared.document_ids_for_entity(text, uuid) TO app_runtime, app_readonly;

-- ----------------------------------------------------------------------------
-- 3. Row-Level Security — enabled AND forced; default deny; tenant isolation.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.document_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.document_links FORCE  ROW LEVEL SECURITY;

CREATE POLICY sel_document_links_tenant ON shared.document_links
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

-- ----------------------------------------------------------------------------
-- 4. Grants — SELECT only. Creating/soft-deleting links is a backend operation.
-- ----------------------------------------------------------------------------
GRANT SELECT ON shared.document_links TO app_runtime, app_readonly;
-- Deliberately ABSENT: INSERT/UPDATE/DELETE for both roles.
