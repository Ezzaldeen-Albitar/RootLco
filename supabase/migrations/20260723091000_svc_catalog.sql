-- ============================================================================
-- Phase: 1-10 — Service Catalog, Pricing, Quotation, and Inventory Database
-- Migration: service catalog — categories, services, versions, labor, availability
-- Tasks: P1-10-DB (svc catalog); FR-SVC-001/002, BR-SVC-001
-- Owner module: svc
--
-- Rollback classification: ROLLBACK-SAFE while unused; roll-forward-only once
--   services are configured. Forward-only — no down script.
--
-- Purpose
--   The tenant-scoped service catalog and its version model (Figure 4.20):
--     * svc.service_categories — tenant taxonomy (self-referencing hierarchy with
--       a cycle guard serialized by a per-tenant advisory lock).
--     * svc.services — the STABLE service identity (FR-SVC-001): an immutable
--       tenant-unique service_code with an active/archived lifecycle. Identity
--       never changes across revisions.
--     * svc.service_versions — effective-dated versions (FR-SVC-002). Published
--       versions never overlap (gist EXCLUDE) and are frozen except a forward-only
--       effective_to close performed by svc.publish_service_version.
--     * svc.standard_labor_times — positive standard minutes per version (frozen
--       with the version).
--     * svc.branch_service_availability — where a service is offered (branch∈company
--       coherence; an archived service cannot be newly made available).
--
-- Design gate: docs/phase-1/phase-1-10/phase-1-10-design.md (+ review-response
--   amendments H1 succession, service lifecycle, hierarchy-cycle advisory lock,
--   INSERT/DELETE freeze of version children).
--
-- Dependencies
--   org.tenants, org.branches; iam.current_tenant_id; shared.touch_row_metadata;
--   org.guard_immutable_columns; extensions btree_gist (uuid = in gist EXCLUDE).
--
-- Security implications
--   Tenant/branch-scoped RLS (ENABLE + FORCE); app roles NOBYPASSRLS; no DELETE
--   grant (soft delete only). All functions SECURITY INVOKER, empty search_path,
--   REVOKE EXECUTE FROM PUBLIC.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Guard functions
-- ----------------------------------------------------------------------------

-- Cycle prevention for the category hierarchy, serialized per tenant so two
-- concurrent re-parents cannot each miss the other's uncommitted change.
CREATE OR REPLACE FUNCTION svc.guard_service_category_no_cycle()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_ancestor uuid; v_depth int := 0;
BEGIN
  IF NEW.parent_category_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.parent_category_id = NEW.id THEN
    RAISE EXCEPTION 'svc.service_categories: a category cannot be its own parent' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('svc.service_categories:' || NEW.tenant_id::text));
  v_ancestor := NEW.parent_category_id;
  WHILE v_ancestor IS NOT NULL LOOP
    v_depth := v_depth + 1;
    IF v_ancestor = NEW.id THEN
      RAISE EXCEPTION 'svc.service_categories: parent assignment creates a cycle' USING ERRCODE = 'check_violation';
    END IF;
    IF v_depth > 64 THEN
      RAISE EXCEPTION 'svc.service_categories: hierarchy too deep (possible cycle)' USING ERRCODE = 'check_violation';
    END IF;
    SELECT parent_category_id INTO v_ancestor
      FROM svc.service_categories WHERE tenant_id = NEW.tenant_id AND id = v_ancestor;
  END LOOP;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.guard_service_category_no_cycle() FROM PUBLIC;

-- Service lifecycle: archived is terminal; stamp archived_at.
CREATE OR REPLACE FUNCTION svc.guard_service_lifecycle()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.lifecycle_status = 'archived' AND NEW.lifecycle_status <> 'archived' THEN
    RAISE EXCEPTION 'svc.services: lifecycle is terminal once archived' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.lifecycle_status = 'archived' AND OLD.lifecycle_status <> 'archived' AND NEW.archived_at IS NULL THEN
    NEW.archived_at := now();
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.guard_service_lifecycle() FROM PUBLIC;

-- Freeze a published/archived service version: identity + effective_from + content
-- frozen; effective_to may only close forward (NULL->date); status published->archived.
CREATE OR REPLACE FUNCTION svc.guard_service_version_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF OLD.status IN ('published', 'archived') THEN
    IF NEW.effective_from IS DISTINCT FROM OLD.effective_from
       OR NEW.notes IS DISTINCT FROM OLD.notes THEN
      RAISE EXCEPTION 'svc.service_versions: a % version is frozen', OLD.status USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.effective_to IS NOT NULL AND NEW.effective_to IS DISTINCT FROM OLD.effective_to THEN
      RAISE EXCEPTION 'svc.service_versions: effective_to is already closed and cannot change' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'archived' AND NEW.status <> 'archived' THEN
      RAISE EXCEPTION 'svc.service_versions: archived is terminal' USING ERRCODE = 'check_violation';
    END IF;
    IF OLD.status = 'published' AND NEW.status NOT IN ('published', 'archived') THEN
      RAISE EXCEPTION 'svc.service_versions: a published version may only be archived' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.guard_service_version_freeze() FROM PUBLIC;

-- Freeze standard_labor_times against INSERT/UPDATE/DELETE once the parent version
-- is published/archived (row-level immutability guards cannot see INSERT/DELETE).
CREATE OR REPLACE FUNCTION svc.guard_labor_time_parent_frozen()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text; v_tenant uuid; v_version uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_tenant := OLD.tenant_id; v_version := OLD.service_version_id;
  ELSE v_tenant := NEW.tenant_id; v_version := NEW.service_version_id; END IF;
  SELECT status INTO v_status FROM svc.service_versions WHERE tenant_id = v_tenant AND id = v_version;
  IF FOUND AND v_status IN ('published', 'archived') THEN
    RAISE EXCEPTION 'svc.standard_labor_times: parent service version is % and frozen', v_status USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.guard_labor_time_parent_frozen() FROM PUBLIC;

-- An archived service cannot be newly made available at a branch.
CREATE OR REPLACE FUNCTION svc.guard_branch_availability_service_active()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_lifecycle text;
BEGIN
  SELECT lifecycle_status INTO v_lifecycle FROM svc.services WHERE tenant_id = NEW.tenant_id AND id = NEW.service_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'svc.branch_service_availability: service % not found in tenant', NEW.service_id USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_lifecycle = 'archived' AND coalesce(NEW.is_available, false) THEN
    RAISE EXCEPTION 'svc.branch_service_availability: service % is archived and cannot be made available', NEW.service_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.guard_branch_availability_service_active() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 1. svc.service_categories — tenant taxonomy (self-referencing hierarchy).
-- ----------------------------------------------------------------------------
CREATE TABLE svc.service_categories (
  id                 uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid    NOT NULL,
  parent_category_id uuid    NULL,
  code               text    NOT NULL,
  name               text    NOT NULL,
  description        text    NULL,
  sort_order         integer NULL,
  status             text    NOT NULL DEFAULT 'active',
  record_version     integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid    NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid    NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid    NULL,

  CONSTRAINT pk_service_categories PRIMARY KEY (id),
  CONSTRAINT uq_service_categories_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_service_categories_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_categories_parent FOREIGN KEY (tenant_id, parent_category_id)
    REFERENCES svc.service_categories (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_service_categories_code_format CHECK (code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_service_categories_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_service_categories_desc_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_service_categories_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE svc.service_categories IS
  'Phase 1-10 tenant service taxonomy. Self-referencing hierarchy with a per-tenant advisory-locked cycle guard. Configuration only — no business data seeded.';
CREATE UNIQUE INDEX uq_service_categories_code ON svc.service_categories (tenant_id, code) WHERE deleted_at IS NULL;
CREATE INDEX ix_service_categories_parent ON svc.service_categories (tenant_id, parent_category_id);
CREATE TRIGGER tg_service_categories_no_cycle BEFORE INSERT OR UPDATE ON svc.service_categories
  FOR EACH ROW EXECUTE FUNCTION svc.guard_service_category_no_cycle();
CREATE TRIGGER tg_service_categories_touch_metadata BEFORE UPDATE ON svc.service_categories
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_service_categories_immutable BEFORE UPDATE ON svc.service_categories
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'code', 'created_at', 'created_by');
ALTER TABLE svc.service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE svc.service_categories FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_service_categories_tenant ON svc.service_categories FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_service_categories_tenant ON svc.service_categories FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_service_categories_tenant ON svc.service_categories FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON svc.service_categories TO app_runtime;
GRANT SELECT ON svc.service_categories TO app_readonly;

-- ----------------------------------------------------------------------------
-- 2. svc.services — stable service identity (FR-SVC-001).
-- ----------------------------------------------------------------------------
CREATE TABLE svc.services (
  id                  uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id           uuid    NOT NULL,
  service_category_id uuid    NOT NULL,
  service_code        text    NOT NULL,
  name                text    NOT NULL,
  description         text    NULL,
  lifecycle_status    text    NOT NULL DEFAULT 'active',
  archived_at         timestamptz NULL,
  record_version      integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid    NOT NULL,
  updated_at          timestamptz NULL,
  updated_by          uuid    NULL,
  deleted_at          timestamptz NULL,
  deleted_by          uuid    NULL,

  CONSTRAINT pk_services PRIMARY KEY (id),
  CONSTRAINT uq_services_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_services_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_services_category FOREIGN KEY (tenant_id, service_category_id)
    REFERENCES svc.service_categories (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_services_code_format CHECK (service_code ~ '^[A-Za-z0-9][A-Za-z0-9_-]{1,62}$'),
  CONSTRAINT ck_services_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT ck_services_desc_not_blank CHECK (description IS NULL OR btrim(description) <> ''),
  CONSTRAINT ck_services_lifecycle CHECK (lifecycle_status IN ('active', 'archived')),
  CONSTRAINT ck_services_archived_at CHECK ((lifecycle_status = 'archived') = (archived_at IS NOT NULL))
);
COMMENT ON TABLE svc.services IS
  'Phase 1-10 stable service identity (FR-SVC-001). service_code is immutable; identity never changes across versions. lifecycle_status active|archived (archived terminal). Tenant-scoped.';
CREATE UNIQUE INDEX uq_services_code ON svc.services (tenant_id, service_code) WHERE deleted_at IS NULL;
CREATE INDEX ix_services_category ON svc.services (tenant_id, service_category_id);
CREATE TRIGGER tg_services_touch_metadata BEFORE UPDATE ON svc.services
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_services_lifecycle BEFORE UPDATE ON svc.services
  FOR EACH ROW EXECUTE FUNCTION svc.guard_service_lifecycle();
CREATE TRIGGER tg_services_immutable BEFORE UPDATE ON svc.services
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'service_code', 'created_at', 'created_by');
ALTER TABLE svc.services ENABLE ROW LEVEL SECURITY;
ALTER TABLE svc.services FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_services_tenant ON svc.services FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_services_tenant ON svc.services FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_services_tenant ON svc.services FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON svc.services TO app_runtime;
GRANT SELECT ON svc.services TO app_readonly;

-- ----------------------------------------------------------------------------
-- 3. svc.service_versions — effective-dated versions (FR-SVC-002, BR-SVC-001).
-- ----------------------------------------------------------------------------
CREATE TABLE svc.service_versions (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  service_id     uuid    NOT NULL,
  version_no     integer NOT NULL,
  effective_from date    NOT NULL,
  effective_to   date    NULL,
  status         text    NOT NULL DEFAULT 'draft',
  notes          text    NULL,
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_service_versions PRIMARY KEY (id),
  CONSTRAINT uq_service_versions_tenant_id UNIQUE (tenant_id, id),
  CONSTRAINT uq_service_versions_no UNIQUE (tenant_id, service_id, version_no),
  CONSTRAINT fk_service_versions_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_service_versions_service FOREIGN KEY (tenant_id, service_id)
    REFERENCES svc.services (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_service_versions_no CHECK (version_no > 0),
  CONSTRAINT ck_service_versions_range CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT ck_service_versions_status CHECK (status IN ('draft', 'published', 'archived')),
  CONSTRAINT ck_service_versions_notes_not_blank CHECK (notes IS NULL OR btrim(notes) <> ''),
  CONSTRAINT ex_service_versions_no_published_overlap EXCLUDE USING gist (
    tenant_id WITH =, service_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&
  ) WHERE (status = 'published' AND deleted_at IS NULL)
);
COMMENT ON TABLE svc.service_versions IS
  'Phase 1-10 effective-dated service versions (FR-SVC-002). Published versions never overlap (gist EXCLUDE) and are frozen except a forward-only effective_to close by svc.publish_service_version. Current version = the published version whose interval contains the as-of date.';
CREATE INDEX ix_service_versions_service ON svc.service_versions (tenant_id, service_id);
CREATE TRIGGER tg_service_versions_touch_metadata BEFORE UPDATE ON svc.service_versions
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_service_versions_freeze BEFORE UPDATE ON svc.service_versions
  FOR EACH ROW EXECUTE FUNCTION svc.guard_service_version_freeze();
CREATE TRIGGER tg_service_versions_immutable BEFORE UPDATE ON svc.service_versions
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'service_id', 'version_no', 'created_at', 'created_by');
ALTER TABLE svc.service_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE svc.service_versions FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_service_versions_tenant ON svc.service_versions FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_service_versions_tenant ON svc.service_versions FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_service_versions_tenant ON svc.service_versions FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON svc.service_versions TO app_runtime;
GRANT SELECT ON svc.service_versions TO app_readonly;

-- Atomic version succession (H1): close the prior open published version's
-- effective_to and publish the draft, under a per-service lock.
CREATE OR REPLACE FUNCTION svc.publish_service_version(p_service_id uuid, p_version_id uuid, p_effective_from date)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_tenant uuid := iam.current_tenant_id(); v_status text; v_prior uuid; v_prior_from date;
BEGIN
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'svc.publish_service_version requires a tenant context' USING ERRCODE = 'raise_exception'; END IF;
  PERFORM 1 FROM svc.services WHERE tenant_id = v_tenant AND id = p_service_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'service % not found in tenant', p_service_id USING ERRCODE = 'foreign_key_violation'; END IF;
  SELECT status INTO v_status FROM svc.service_versions WHERE tenant_id = v_tenant AND id = p_version_id AND service_id = p_service_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'version % not found for service %', p_version_id, p_service_id USING ERRCODE = 'foreign_key_violation'; END IF;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'only a draft version can be published (found %)', v_status USING ERRCODE = 'check_violation'; END IF;
  SELECT id, effective_from INTO v_prior, v_prior_from
    FROM svc.service_versions
    WHERE tenant_id = v_tenant AND service_id = p_service_id AND status = 'published' AND effective_to IS NULL AND deleted_at IS NULL
    FOR UPDATE;
  IF FOUND THEN
    IF p_effective_from <= v_prior_from THEN
      RAISE EXCEPTION 'new effective_from % must be after the current published version effective_from %', p_effective_from, v_prior_from USING ERRCODE = 'check_violation';
    END IF;
    UPDATE svc.service_versions SET effective_to = p_effective_from WHERE tenant_id = v_tenant AND id = v_prior;
  END IF;
  UPDATE svc.service_versions SET status = 'published', effective_from = p_effective_from WHERE tenant_id = v_tenant AND id = p_version_id;
END; $$;
REVOKE EXECUTE ON FUNCTION svc.publish_service_version(uuid, uuid, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION svc.publish_service_version(uuid, uuid, date) TO app_runtime;

-- ----------------------------------------------------------------------------
-- 4. svc.standard_labor_times — positive standard minutes per version.
-- ----------------------------------------------------------------------------
CREATE TABLE svc.standard_labor_times (
  id                 uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id          uuid    NOT NULL,
  service_version_id uuid    NOT NULL,
  labor_code         text    NULL,
  standard_minutes   numeric(10, 2) NOT NULL,
  skill_ref          uuid    NULL,
  status             text    NOT NULL DEFAULT 'active',
  record_version     integer NOT NULL DEFAULT 1,
  created_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid    NOT NULL,
  updated_at         timestamptz NULL,
  updated_by         uuid    NULL,
  deleted_at         timestamptz NULL,
  deleted_by         uuid    NULL,

  CONSTRAINT pk_standard_labor_times PRIMARY KEY (id),
  CONSTRAINT fk_standard_labor_times_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_standard_labor_times_version FOREIGN KEY (tenant_id, service_version_id)
    REFERENCES svc.service_versions (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_standard_labor_times_minutes CHECK (standard_minutes > 0),
  CONSTRAINT ck_standard_labor_times_code_format CHECK (labor_code IS NULL OR labor_code ~ '^[a-z][a-z0-9_]{1,62}$'),
  CONSTRAINT ck_standard_labor_times_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE svc.standard_labor_times IS
  'Phase 1-10 positive standard labor minutes per service version. Frozen (no INSERT/UPDATE/DELETE) once the parent version is published.';
CREATE UNIQUE INDEX uq_standard_labor_times_version_code ON svc.standard_labor_times (tenant_id, service_version_id, labor_code) NULLS NOT DISTINCT WHERE deleted_at IS NULL;
CREATE INDEX ix_standard_labor_times_version ON svc.standard_labor_times (tenant_id, service_version_id);
-- Fires on INSERT/UPDATE only: app_runtime holds no DELETE grant (soft-delete
-- only), so a frozen row cannot be removed by the runtime; the admin/owner cascade
-- (test teardown, migrations) must remain able to delete.
CREATE TRIGGER tg_standard_labor_times_parent_frozen BEFORE INSERT OR UPDATE ON svc.standard_labor_times
  FOR EACH ROW EXECUTE FUNCTION svc.guard_labor_time_parent_frozen();
CREATE TRIGGER tg_standard_labor_times_touch_metadata BEFORE UPDATE ON svc.standard_labor_times
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_standard_labor_times_immutable BEFORE UPDATE ON svc.standard_labor_times
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'service_version_id', 'created_at', 'created_by');
ALTER TABLE svc.standard_labor_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE svc.standard_labor_times FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_standard_labor_times_tenant ON svc.standard_labor_times FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_standard_labor_times_tenant ON svc.standard_labor_times FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id());
CREATE POLICY upd_standard_labor_times_tenant ON svc.standard_labor_times FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id())
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON svc.standard_labor_times TO app_runtime;
GRANT SELECT ON svc.standard_labor_times TO app_readonly;

-- ----------------------------------------------------------------------------
-- 5. svc.branch_service_availability — where a service is offered (branch-scoped).
-- ----------------------------------------------------------------------------
CREATE TABLE svc.branch_service_availability (
  id             uuid    NOT NULL DEFAULT gen_random_uuid(),
  tenant_id      uuid    NOT NULL,
  company_id     uuid    NOT NULL,
  branch_id      uuid    NOT NULL,
  service_id     uuid    NOT NULL,
  is_available   boolean NOT NULL DEFAULT true,
  status         text    NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid    NOT NULL,
  updated_at     timestamptz NULL,
  updated_by     uuid    NULL,
  deleted_at     timestamptz NULL,
  deleted_by     uuid    NULL,

  CONSTRAINT pk_branch_service_availability PRIMARY KEY (id),
  CONSTRAINT uq_branch_service_availability_scope_id UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_branch_service_availability_tenant FOREIGN KEY (tenant_id) REFERENCES org.tenants (id) ON DELETE RESTRICT,
  CONSTRAINT fk_branch_service_availability_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches (tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_branch_service_availability_service FOREIGN KEY (tenant_id, service_id)
    REFERENCES svc.services (tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_branch_service_availability_status CHECK (status IN ('active', 'inactive'))
);
COMMENT ON TABLE svc.branch_service_availability IS
  'Phase 1-10 branch-level service offering (branch∈company coherence via composite FK). An archived service cannot be newly made available.';
CREATE UNIQUE INDEX uq_branch_service_availability_service ON svc.branch_service_availability (tenant_id, company_id, branch_id, service_id) WHERE deleted_at IS NULL;
CREATE INDEX ix_branch_service_availability_branch ON svc.branch_service_availability (tenant_id, company_id, branch_id);
CREATE INDEX ix_branch_service_availability_service ON svc.branch_service_availability (tenant_id, service_id);
CREATE TRIGGER tg_branch_service_availability_service_active BEFORE INSERT OR UPDATE ON svc.branch_service_availability
  FOR EACH ROW EXECUTE FUNCTION svc.guard_branch_availability_service_active();
CREATE TRIGGER tg_branch_service_availability_touch_metadata BEFORE UPDATE ON svc.branch_service_availability
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();
CREATE TRIGGER tg_branch_service_availability_immutable BEFORE UPDATE ON svc.branch_service_availability
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('tenant_id', 'company_id', 'branch_id', 'service_id', 'created_at', 'created_by');
ALTER TABLE svc.branch_service_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE svc.branch_service_availability FORCE  ROW LEVEL SECURITY;
CREATE POLICY sel_branch_service_availability_scope ON svc.branch_service_availability FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_branch_service_availability_scope ON svc.branch_service_availability FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY upd_branch_service_availability_scope ON svc.branch_service_availability FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON svc.branch_service_availability TO app_runtime;
GRANT SELECT ON svc.branch_service_availability TO app_readonly;
