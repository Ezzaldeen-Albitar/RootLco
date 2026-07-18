-- ============================================================================
-- Phase: 1-5 — Shared Services Database
-- Migration: tenant tags, entity assignments, notes, and threaded comments
-- Tasks: P1-05-DB-017, P1-05-DB-018, P1-05-QA-007
-- Owner module: shared
--
-- Purpose
--   Provide tenant-owned tagging and generic entity annotations, including
--   soft-deletable tag assignments, editable notes, and guarded comment
--   threads whose parents always belong to the same tenant and entity.
--
-- Dependencies
--   Phase 1-3 organization scope, Phase 1-4 iam.user_accounts and permission
--   context, shared.touch_row_metadata(), and org.guard_immutable_columns().
--
-- Rollback classification: ROLLBACK-SAFE while all four tables are empty;
--   roll-forward-only once populated because tags, assignments, annotations,
--   and comment threads become user-authored operational records.
--
-- Security implications
--   * Tags are TENANT-ONLY. There is no approved platform tag catalogue; adding
--     platform tags would widen the reviewed nullable-tenant exception surface
--     without a governed source of platform vocabulary.
--   * Every table ENABLEs and FORCEs RLS and is SELECT-only for runtime and
--     readonly roles. All writes remain backend/platform operations.
--   * Notes/comments gate restricted and secret rows on iam.sensitive.view.
--     Note and comment bodies are classified restricted in the data dictionary.
--   * Author and assigner attribution is tenant-bound by composite foreign keys.
--
-- Objects created
--   Tables:    shared.tags, shared.entity_tags, shared.notes, shared.comments
--   Functions: shared.stamp_content_edit(), shared.guard_comment_parent()
--   Triggers:  tg_comments_guard_parent, tg_comments_immutable,
--              tg_comments_stamp_content_edit, tg_comments_touch_metadata,
--              tg_entity_tags_immutable, tg_entity_tags_touch_metadata,
--              tg_notes_immutable, tg_notes_stamp_content_edit,
--              tg_notes_touch_metadata, tg_tags_immutable,
--              tg_tags_touch_metadata
--   Policies:  sel_comments_tenant, sel_entity_tags_tenant, sel_notes_tenant,
--              sel_tags_tenant
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Tenant-owned tag vocabulary. Platform tags are deliberately unsupported.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.tags (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  tag_code       text        NOT NULL,
  name           text        NOT NULL,
  color          text        NULL,
  status         text        NOT NULL DEFAULT 'active',
  deleted_at     timestamptz NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_tags PRIMARY KEY (id),
  CONSTRAINT uq_tags_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_tags_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT ck_tags_code_format CHECK (tag_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_tags_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_tags_color CHECK (color IS NULL OR color ~ '^#[0-9a-f]{6}$'),
  CONSTRAINT ck_tags_status CHECK (status IN ('active', 'disabled'))
);

COMMENT ON TABLE shared.tags IS
  'Tenant-only tag vocabulary (P1-05-DB-017). No platform tags exist because no approved platform catalogue exists; avoiding platform scope also avoids widening nullable-tenant exceptions. Active tag_code is unique per tenant and may be reused only after soft deletion. Runtime/readonly SELECT-only.';

CREATE UNIQUE INDEX uq_tags_tenant_code_active
  ON shared.tags (tenant_id, tag_code)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 2. Soft-deletable generic entity/tag assignments.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.entity_tags (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  tag_id         uuid        NOT NULL,
  entity_type    text        NOT NULL,
  entity_id      uuid        NOT NULL,
  assigned_by    uuid        NOT NULL,
  assigned_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at     timestamptz NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_entity_tags PRIMARY KEY (id),
  CONSTRAINT fk_entity_tags_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_entity_tags_tag
    FOREIGN KEY (tenant_id, tag_id)
    REFERENCES shared.tags (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_entity_tags_assigner
    FOREIGN KEY (tenant_id, assigned_by)
    REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_entity_tags_entity_type_format
    CHECK (entity_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$')
);

COMMENT ON TABLE shared.entity_tags IS
  'Tenant-bound, soft-deletable generic entity/tag assignments (P1-05-DB-017). A live assignment is unique per tag and entity; re-tagging is possible after soft deletion. entity_type is a constrained schema.table token, and later domains own entity existence validation. assigned_by is tenant-bound. Runtime/readonly SELECT-only.';

CREATE INDEX ix_entity_tags_tag
  ON shared.entity_tags (tenant_id, tag_id);
CREATE INDEX ix_entity_tags_assigner
  ON shared.entity_tags (tenant_id, assigned_by);
CREATE INDEX ix_entity_tags_entity
  ON shared.entity_tags (tenant_id, entity_type, entity_id);
CREATE UNIQUE INDEX uq_entity_tags_active
  ON shared.entity_tags (tenant_id, tag_id, entity_type, entity_id)
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 3. Editable generic entity notes.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.notes (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid        NOT NULL,
  company_id     uuid        NULL,
  branch_id      uuid        NULL,
  entity_type    text        NOT NULL,
  entity_id      uuid        NOT NULL,
  author_id      uuid        NOT NULL,
  body           text        NOT NULL,
  classification text        NOT NULL DEFAULT 'internal',
  visibility     text        NOT NULL DEFAULT 'internal',
  edited_at      timestamptz NULL,
  deleted_at     timestamptz NULL,
  record_version integer     NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid        NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid        NULL,

  CONSTRAINT pk_notes PRIMARY KEY (id),
  CONSTRAINT fk_notes_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_notes_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_notes_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_notes_author
    FOREIGN KEY (tenant_id, author_id)
    REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_notes_branch_requires_company
    CHECK (branch_id IS NULL OR company_id IS NOT NULL),
  CONSTRAINT ck_notes_entity_type_format
    CHECK (entity_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT ck_notes_body_not_blank CHECK (btrim(body) <> ''),
  CONSTRAINT ck_notes_classification
    CHECK (classification IN ('public', 'internal', 'restricted', 'secret')),
  CONSTRAINT ck_notes_visibility CHECK (visibility IN ('internal', 'customer_visible'))
);

COMMENT ON TABLE shared.notes IS
  'Tenant-scoped generic entity notes (P1-05-DB-018). Body is editable and server-stamps edited_at whenever content changes. Author attribution is tenant-bound. Public/internal rows are tenant-readable; restricted/secret rows additionally require iam.sensitive.view. Body is restricted data. Runtime/readonly SELECT-only.';
COMMENT ON COLUMN shared.notes.body IS
  'User-authored note content. Data-dictionary classification: restricted. A body change server-stamps edited_at.';

CREATE INDEX ix_notes_company
  ON shared.notes (tenant_id, company_id);
CREATE INDEX ix_notes_branch
  ON shared.notes (tenant_id, company_id, branch_id);
CREATE INDEX ix_notes_author
  ON shared.notes (tenant_id, author_id);
CREATE INDEX ix_notes_entity
  ON shared.notes (tenant_id, entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- 4. Editable threaded comments.
-- ----------------------------------------------------------------------------
CREATE TABLE shared.comments (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  tenant_id         uuid        NOT NULL,
  company_id        uuid        NULL,
  branch_id         uuid        NULL,
  entity_type       text        NOT NULL,
  entity_id         uuid        NOT NULL,
  parent_comment_id uuid        NULL,
  author_id         uuid        NOT NULL,
  body              text        NOT NULL,
  classification    text        NOT NULL DEFAULT 'internal',
  status            text        NOT NULL DEFAULT 'active',
  edited_at         timestamptz NULL,
  deleted_at        timestamptz NULL,
  record_version    integer     NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_at        timestamptz NULL,
  updated_by        uuid        NULL,

  CONSTRAINT pk_comments PRIMARY KEY (id),
  CONSTRAINT uq_comments_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_comments_tenant
    FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_comments_company
    FOREIGN KEY (tenant_id, company_id)
    REFERENCES org.legal_companies (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_comments_branch
    FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_comments_parent
    FOREIGN KEY (tenant_id, parent_comment_id)
    REFERENCES shared.comments (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_comments_author
    FOREIGN KEY (tenant_id, author_id)
    REFERENCES iam.user_accounts (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_comments_branch_requires_company
    CHECK (branch_id IS NULL OR company_id IS NOT NULL),
  CONSTRAINT ck_comments_entity_type_format
    CHECK (entity_type ~ '^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'),
  CONSTRAINT ck_comments_body_not_blank CHECK (btrim(body) <> ''),
  CONSTRAINT ck_comments_classification
    CHECK (classification IN ('public', 'internal', 'restricted', 'secret')),
  CONSTRAINT ck_comments_status CHECK (status IN ('active', 'hidden'))
);

COMMENT ON TABLE shared.comments IS
  'Tenant-scoped threaded entity comments (P1-05-DB-018). A comment starts active and unstamped; parent rows must be live and belong to the same tenant and generic entity. Body edits server-stamp edited_at. Public/internal rows are tenant-readable; restricted/secret rows additionally require iam.sensitive.view. Body is restricted data. Runtime/readonly SELECT-only.';
COMMENT ON COLUMN shared.comments.body IS
  'User-authored comment content. Data-dictionary classification: restricted. A body change server-stamps edited_at.';

CREATE INDEX ix_comments_company
  ON shared.comments (tenant_id, company_id);
CREATE INDEX ix_comments_branch
  ON shared.comments (tenant_id, company_id, branch_id);
CREATE INDEX ix_comments_parent
  ON shared.comments (tenant_id, parent_comment_id);
CREATE INDEX ix_comments_author
  ON shared.comments (tenant_id, author_id);
CREATE INDEX ix_comments_entity
  ON shared.comments (tenant_id, entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- 5. Shared content-edit stamper and guarded comment-parent integrity.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION shared.stamp_content_edit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.stamp_content_edit() IS
  'Shared BEFORE UPDATE trigger for shared.notes and shared.comments. A body change server-stamps edited_at; non-content updates leave edited_at unchanged.';

REVOKE EXECUTE ON FUNCTION shared.stamp_content_edit() FROM PUBLIC;

CREATE OR REPLACE FUNCTION shared.guard_comment_parent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_parent_entity_type text;
  v_parent_entity_id   uuid;
  v_parent_deleted_at  timestamptz;
BEGIN
  IF TG_OP = 'INSERT'
     AND (NEW.status <> 'active' OR NEW.edited_at IS NOT NULL) THEN
    RAISE EXCEPTION 'comment must start active with edited_at NULL'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.parent_comment_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Tenant is part of the lookup so a cross-tenant parent is indistinguishable
  -- from a missing parent and receives foreign_key_violation, matching the
  -- composite self-FK contract without disclosing another tenant's row.
  SELECT entity_type, entity_id, deleted_at
    INTO v_parent_entity_type, v_parent_entity_id, v_parent_deleted_at
  FROM shared.comments
  WHERE tenant_id = NEW.tenant_id
    AND id = NEW.parent_comment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'comment parent % does not exist in tenant', NEW.parent_comment_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF v_parent_entity_type IS DISTINCT FROM NEW.entity_type
     OR v_parent_entity_id IS DISTINCT FROM NEW.entity_id THEN
    RAISE EXCEPTION 'comment parent must belong to the same entity'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_parent_deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'comment parent must not be soft-deleted'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION shared.guard_comment_parent() IS
  'BEFORE INSERT/parent update guard for shared.comments. INSERT starts active and unstamped. A parent must exist in the same tenant, belong to the same entity, and remain live; missing/cross-tenant parents raise foreign_key_violation while cross-entity/deleted parents raise check_violation.';

REVOKE EXECUTE ON FUNCTION shared.guard_comment_parent() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 6. Metadata, immutability, edit-stamp, and parent triggers.
-- ----------------------------------------------------------------------------
CREATE TRIGGER tg_tags_immutable
  BEFORE UPDATE ON shared.tags
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'tag_code', 'created_at', 'created_by');
CREATE TRIGGER tg_tags_touch_metadata
  BEFORE UPDATE ON shared.tags
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_entity_tags_immutable
  BEFORE UPDATE ON shared.entity_tags
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'id', 'tenant_id', 'tag_id', 'entity_type', 'entity_id', 'assigned_by',
    'assigned_at', 'created_at', 'created_by');
CREATE TRIGGER tg_entity_tags_touch_metadata
  BEFORE UPDATE ON shared.entity_tags
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_notes_immutable
  BEFORE UPDATE ON shared.notes
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'entity_type', 'entity_id',
    'author_id', 'created_at', 'created_by');
CREATE TRIGGER tg_notes_stamp_content_edit
  BEFORE UPDATE ON shared.notes
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_content_edit();
CREATE TRIGGER tg_notes_touch_metadata
  BEFORE UPDATE ON shared.notes
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

CREATE TRIGGER tg_comments_guard_parent
  BEFORE INSERT OR UPDATE OF parent_comment_id ON shared.comments
  FOR EACH ROW EXECUTE FUNCTION shared.guard_comment_parent();
CREATE TRIGGER tg_comments_immutable
  BEFORE UPDATE ON shared.comments
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'tenant_id', 'company_id', 'branch_id', 'entity_type', 'entity_id',
    'author_id', 'parent_comment_id', 'created_at', 'created_by');
CREATE TRIGGER tg_comments_stamp_content_edit
  BEFORE UPDATE ON shared.comments
  FOR EACH ROW EXECUTE FUNCTION shared.stamp_content_edit();
CREATE TRIGGER tg_comments_touch_metadata
  BEFORE UPDATE ON shared.comments
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

-- ----------------------------------------------------------------------------
-- 7. Row-Level Security — enabled AND forced; SELECT-only visibility.
-- ----------------------------------------------------------------------------
ALTER TABLE shared.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.tags FORCE ROW LEVEL SECURITY;
ALTER TABLE shared.entity_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.entity_tags FORCE ROW LEVEL SECURITY;
ALTER TABLE shared.notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.notes FORCE ROW LEVEL SECURITY;
ALTER TABLE shared.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.comments FORCE ROW LEVEL SECURITY;

CREATE POLICY sel_tags_tenant ON shared.tags
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_entity_tags_tenant ON shared.entity_tags
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());

CREATE POLICY sel_notes_tenant ON shared.notes
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (
      classification IN ('public', 'internal')
      OR iam.has_permission('iam.sensitive.view')
    )
  );

CREATE POLICY sel_comments_tenant ON shared.comments
  FOR SELECT TO app_runtime, app_readonly
  USING (
    tenant_id = iam.current_tenant_id()
    AND (
      classification IN ('public', 'internal')
      OR iam.has_permission('iam.sensitive.view')
    )
  );

GRANT SELECT ON shared.tags TO app_runtime, app_readonly;
GRANT SELECT ON shared.entity_tags TO app_runtime, app_readonly;
GRANT SELECT ON shared.notes TO app_runtime, app_readonly;
GRANT SELECT ON shared.comments TO app_runtime, app_readonly;

-- Deliberately ABSENT: INSERT/UPDATE/DELETE grants and policies for all four
-- tables. Backend services own tag and annotation mutations.
