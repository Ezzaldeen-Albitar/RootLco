-- ============================================================================
-- Phase: 1-18 remediation executed during P1-28 — reception evidence contracts
-- Owner decisions: FE-012 (versioned damage-map template, exact-version binding
--   to the visit), FE-018 (a signature binds an exact ACCEPTED document version;
--   replacement is new evidence, never an overwrite), FE-019 (refusal supporting
--   media is OPTIONAL by default and mandatory only where tenant/branch/refusal
--   -type policy says so).
-- Owner module: rec
--
-- Rollback classification: ROLLBACK-SAFE while unused (structure only, no data);
--   roll-forward-only once rows exist. Forward-only — no down script.
--
-- Dependencies
--   REQUIRES the shared reception-evidence foundation migration, which adds
--   shared.document_categories.business_link_purpose and registers the seven
--   reception_* categories referenced below. This migration cannot replay
--   without it; the foundation lands first, deliberately.
--   Also: rec.reception_visits / rec.signatures / rec.refusals / rec.damage_maps
--   (Phase 1-8), shared.documents / document_versions / document_links /
--   document_categories (Phase 1-5), org.branches, org.guard_immutable_columns,
--   iam.current_tenant_id / current_user_id / has_permission_in_scope /
--   allowed_company_ids / allowed_branch_ids.
--
-- What this migration deliberately does NOT do
--   It does not redefine rec.guard_signature_version(). That Phase 1-8 function
--   is already attached to tg_signatures_version and is the authority on "the
--   bound version belongs to the bound document". Replacing its body would have
--   silently narrowed a frozen contract for every existing caller — the FE-018
--   rules arrive as a SEPARATE function and a SEPARATE trigger, so the older
--   guarantee keeps its own owner.
--
-- Objects created
--   Tables:    rec.capture_policy_rules, rec.damage_map_templates,
--              rec.damage_map_template_versions, rec.reception_evidence_bindings,
--              rec.capture_requirement_overrides, rec.signature_events
--   Columns:   rec.signatures.replaces_signature_id,
--              rec.refusals.evidence_document_version_id,
--              rec.damage_maps.damage_map_template_version_id
--   Functions: rec.guard_reception_evidence_binding(),
--              rec.guard_damage_map_template_version(),
--              rec.guard_damage_map_template_binding(),
--              rec.guard_signature_evidence(), rec.guard_signature_event(),
--              rec.guard_refusal_evidence_version()
--   Triggers:  tg_reception_evidence_binding_guard,
--              tg_damage_map_template_version_guard,
--              tg_damage_maps_template_binding, tg_damage_maps_template_immutable,
--              tg_signatures_evidence_guard, tg_signature_event_guard,
--              tg_refusal_evidence_version
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. rec.capture_policy_rules — what a branch REQUIRES at intake.
--
--    FE-019: supporting media for a refusal is optional by default. "Default"
--    is the ABSENCE of a row here, not a row saying zero, so a tenant that
--    configures nothing is never blocked. A row raises the floor for one
--    (branch, requirement, refusal type) triple; retiring it lowers it again.
-- ----------------------------------------------------------------------------
CREATE TABLE rec.capture_policy_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES org.tenants(id) ON DELETE RESTRICT,
  company_id uuid NULL,
  branch_id uuid NULL,
  requirement_code text NOT NULL,
  refusal_type text NULL,
  min_count integer NOT NULL,
  device_captured_at_required boolean NOT NULL DEFAULT true,
  witness_required boolean NOT NULL DEFAULT false,
  effective_at timestamptz NOT NULL DEFAULT now(),
  retired_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CONSTRAINT fk_capture_policy_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_capture_policy_scope CHECK (
    (company_id IS NULL AND branch_id IS NULL) OR
    (company_id IS NOT NULL AND branch_id IS NOT NULL)
  ),
  CONSTRAINT ck_capture_policy_requirement CHECK (requirement_code IN (
    'exterior','dashboard_odometer','ev_soc','warning_lamp','vin','damage',
    'refusal_supporting_evidence'
  )),
  CONSTRAINT ck_capture_policy_refusal_type CHECK (
    (requirement_code <> 'refusal_supporting_evidence'
      AND refusal_type IS NULL AND witness_required = false)
    OR (requirement_code = 'refusal_supporting_evidence' AND
      (refusal_type IS NULL OR refusal_type IN (
        'inspection_item','signature','intake_step','authorization','other')))
  ),
  CONSTRAINT ck_capture_policy_count CHECK (min_count BETWEEN 0 AND 20),
  CONSTRAINT ck_capture_policy_retirement CHECK (retired_at IS NULL OR retired_at >= effective_at)
);

COMMENT ON TABLE rec.capture_policy_rules IS
  'Per-tenant/branch intake capture floor. The absence of a row is the default, and the default for refusal supporting media is OPTIONAL (Owner decision FE-019). Append-then-retire: a live rule is superseded by retiring it and inserting its replacement, so what was required at the time of a visit stays readable.';

-- One LIVE rule per key. Four partial indexes rather than one, because the key
-- differs by whether the rule is branch-scoped and whether it names a refusal
-- type; a single index over nullable columns would let two live rules coexist.
CREATE UNIQUE INDEX uq_capture_policy_tenant_live
  ON rec.capture_policy_rules(tenant_id, requirement_code)
  WHERE branch_id IS NULL AND refusal_type IS NULL AND retired_at IS NULL;
CREATE UNIQUE INDEX uq_capture_policy_branch_live
  ON rec.capture_policy_rules(tenant_id, branch_id, requirement_code)
  WHERE branch_id IS NOT NULL AND refusal_type IS NULL AND retired_at IS NULL;
CREATE UNIQUE INDEX uq_capture_policy_tenant_refusal_live
  ON rec.capture_policy_rules(tenant_id, requirement_code, refusal_type)
  WHERE branch_id IS NULL AND refusal_type IS NOT NULL AND retired_at IS NULL;
CREATE UNIQUE INDEX uq_capture_policy_branch_refusal_live
  ON rec.capture_policy_rules(tenant_id, branch_id, requirement_code, refusal_type)
  WHERE branch_id IS NOT NULL AND refusal_type IS NOT NULL AND retired_at IS NULL;
CREATE INDEX ix_capture_policy_resolution
  ON rec.capture_policy_rules(tenant_id, branch_id, requirement_code, effective_at DESC);

-- ----------------------------------------------------------------------------
-- 2. rec.damage_map_templates + rec.damage_map_template_versions (FE-012).
--
--    The template SLOT is the stable identity an operator manages; the VERSION
--    is the frozen geometry a visit is bound to. Retiring the slot removes it
--    from the pickers for NEW visits and changes nothing already recorded.
-- ----------------------------------------------------------------------------
CREATE TABLE rec.damage_map_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES org.tenants(id) ON DELETE RESTRICT,
  company_id uuid NULL,
  branch_id uuid NULL,
  map_type text NOT NULL,
  perspective text NULL,
  status text NOT NULL DEFAULT 'active',
  record_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_at timestamptz NULL,
  updated_by uuid NULL,
  CONSTRAINT uq_damage_map_templates_scope UNIQUE (tenant_id, id),
  CONSTRAINT fk_damage_map_templates_branch FOREIGN KEY (tenant_id, company_id, branch_id)
    REFERENCES org.branches(tenant_id, company_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_damage_map_templates_scope CHECK (
    (company_id IS NULL AND branch_id IS NULL) OR
    (company_id IS NOT NULL AND branch_id IS NOT NULL)
  ),
  CONSTRAINT ck_damage_map_templates_type CHECK (map_type IN ('exterior','interior','undercarriage','other')),
  CONSTRAINT ck_damage_map_templates_perspective CHECK (perspective IS NULL OR btrim(perspective) <> ''),
  CONSTRAINT ck_damage_map_templates_status CHECK (status IN ('active','retired'))
);

COMMENT ON TABLE rec.damage_map_templates IS
  'Managed damage-map template slot (Owner decision FE-012). Administering templates is NOT a receptionist function: every write costs rec.catalogue.manage, which capture permissions never imply. Retiring a slot withdraws it from NEW visits and never alters a visit already bound to one of its versions.';

CREATE TABLE rec.damage_map_template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  template_id uuid NOT NULL,
  version_number integer NOT NULL,
  document_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  retired_at timestamptz NULL,
  retired_by uuid NULL,
  CONSTRAINT uq_damage_map_template_version UNIQUE (tenant_id, template_id, version_number),
  CONSTRAINT uq_damage_map_template_version_id UNIQUE (tenant_id, id),
  CONSTRAINT fk_damage_map_template_version_template FOREIGN KEY (tenant_id, template_id)
    REFERENCES rec.damage_map_templates(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_damage_map_template_version_document FOREIGN KEY (tenant_id, document_id)
    REFERENCES shared.documents(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_damage_map_template_version_file FOREIGN KEY (tenant_id, document_version_id)
    REFERENCES shared.document_versions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_damage_map_template_version_number CHECK (version_number >= 1),
  CONSTRAINT ck_damage_map_template_version_status CHECK (status IN ('active','retired')),
  CONSTRAINT ck_damage_map_template_version_retired CHECK (
    (status = 'active' AND retired_at IS NULL AND retired_by IS NULL) OR
    (status = 'retired' AND retired_at IS NOT NULL AND retired_by IS NOT NULL)
  )
);

COMMENT ON TABLE rec.damage_map_template_versions IS
  'Immutable published revision of a damage-map template, bound to an accepted document version. At most one revision per slot is active; retired revisions stay readable forever because visits are bound to them.';

CREATE UNIQUE INDEX uq_damage_map_template_one_active
  ON rec.damage_map_template_versions(tenant_id, template_id) WHERE status = 'active';

-- ----------------------------------------------------------------------------
-- 3. rec.reception_evidence_bindings — the capture requirement a document
--    version satisfies for one visit.
-- ----------------------------------------------------------------------------
CREATE TABLE rec.reception_evidence_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  reception_visit_id uuid NOT NULL,
  requirement_code text NOT NULL,
  document_id uuid NOT NULL,
  document_version_id uuid NOT NULL,
  device_captured_at timestamptz NULL,
  quality_status text NOT NULL DEFAULT 'readable',
  finalized_at timestamptz NULL,
  finalized_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CONSTRAINT uq_reception_evidence_binding_scope UNIQUE (tenant_id, company_id, branch_id, id),
  CONSTRAINT fk_reception_evidence_binding_visit FOREIGN KEY
    (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits(tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_reception_evidence_binding_document FOREIGN KEY (tenant_id, document_id)
    REFERENCES shared.documents(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_reception_evidence_binding_version FOREIGN KEY (tenant_id, document_version_id)
    REFERENCES shared.document_versions(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_reception_evidence_binding_requirement CHECK (requirement_code IN (
    'exterior','dashboard_odometer','ev_soc','warning_lamp','vin','damage'
  )),
  CONSTRAINT ck_reception_evidence_binding_quality CHECK (
    quality_status IN ('readable','unreadable') AND
    (requirement_code = 'vin' OR quality_status = 'readable')
  ),
  CONSTRAINT ck_reception_evidence_binding_finalized CHECK (
    (finalized_at IS NULL AND finalized_by IS NULL) OR
    (finalized_at IS NOT NULL AND finalized_by IS NOT NULL)
  )
);

COMMENT ON TABLE rec.reception_evidence_bindings IS
  'Binds one capture requirement of a reception visit to an exact immutable document version. Finalizing is a separate act and needs an accepted version, so a scan still in flight can be recorded but never counted.';

CREATE INDEX ix_reception_evidence_binding_visit
  ON rec.reception_evidence_bindings(tenant_id, company_id, branch_id, reception_visit_id, requirement_code);
-- The same version may satisfy a requirement once. Without this, one upload
-- counted twice would satisfy a min_count of two on its own.
CREATE UNIQUE INDEX uq_reception_evidence_binding_version
  ON rec.reception_evidence_bindings(tenant_id, reception_visit_id, requirement_code, document_version_id);

-- ----------------------------------------------------------------------------
-- 4. rec.capture_requirement_overrides — an attributable decision NOT to capture.
-- ----------------------------------------------------------------------------
CREATE TABLE rec.capture_requirement_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  reception_visit_id uuid NOT NULL,
  requirement_code text NOT NULL,
  reason text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CONSTRAINT fk_capture_requirement_override_visit FOREIGN KEY
    (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits(tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_capture_requirement_override_requirement CHECK (requirement_code IN (
    'exterior','dashboard_odometer','ev_soc','warning_lamp','vin','damage'
  )),
  CONSTRAINT ck_capture_requirement_override_reason CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000)
);

COMMENT ON TABLE rec.capture_requirement_overrides IS
  'Append-only record that a named actor waived one capture requirement on one visit, with a reason and a time. Costs rec.reception.evidence.override, which capture authority does not imply: waiving the proof must be a different decision from taking it.';

CREATE INDEX ix_capture_requirement_override_visit
  ON rec.capture_requirement_overrides(tenant_id, company_id, branch_id, reception_visit_id, requirement_code);
-- A requirement is waived once per visit. A second attempt is a duplicate, not
-- a second waiver, and would otherwise let one visit accumulate contradictory
-- reasons for the same gap.
CREATE UNIQUE INDEX uq_capture_requirement_override_once
  ON rec.capture_requirement_overrides(tenant_id, reception_visit_id, requirement_code);

-- ----------------------------------------------------------------------------
-- 5. rec.signatures — replacement chain (FE-018).
--
--    rec.signatures holds SELECT + INSERT only, so historical evidence cannot be
--    edited or withdrawn. A correction is therefore a NEW row that names the one
--    it supersedes; the superseded row stays exactly as it was recorded.
-- ----------------------------------------------------------------------------
ALTER TABLE rec.signatures
  ADD COLUMN replaces_signature_id uuid NULL,
  ADD CONSTRAINT uq_signatures_tenant_id UNIQUE (tenant_id, id),
  ADD CONSTRAINT fk_signatures_replaces FOREIGN KEY (tenant_id, replaces_signature_id)
    REFERENCES rec.signatures(tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_signatures_replaces_not_self CHECK (
    replaces_signature_id IS NULL OR replaces_signature_id <> id
  );

COMMENT ON COLUMN rec.signatures.replaces_signature_id IS
  'The signature this one supersedes. Replacement is new evidence: the prior row is never updated, never deleted, and stays readable with its own document version.';

-- A signature is superseded at most once, so a read can name its successor
-- without ambiguity. Two rows claiming to replace one predecessor would make
-- "which signature is current" unanswerable.
CREATE UNIQUE INDEX uq_signatures_replaces
  ON rec.signatures(tenant_id, replaces_signature_id) WHERE replaces_signature_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. rec.signature_events — finalization and repudiation, append-only.
-- ----------------------------------------------------------------------------
CREATE TABLE rec.signature_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  company_id uuid NOT NULL,
  branch_id uuid NOT NULL,
  reception_visit_id uuid NOT NULL,
  signature_id uuid NOT NULL,
  event_type text NOT NULL,
  reason text NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  CONSTRAINT fk_signature_event_visit FOREIGN KEY
    (tenant_id, company_id, branch_id, reception_visit_id)
    REFERENCES rec.reception_visits(tenant_id, company_id, branch_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_signature_event_signature FOREIGN KEY (tenant_id, signature_id)
    REFERENCES rec.signatures(tenant_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_signature_event_type CHECK (event_type IN ('finalized','repudiated')),
  CONSTRAINT ck_signature_event_reason CHECK (
    (event_type = 'finalized' AND reason IS NULL) OR
    (event_type = 'repudiated' AND char_length(btrim(reason)) BETWEEN 1 AND 1000)
  )
);

COMMENT ON TABLE rec.signature_events IS
  'Append-only lifecycle of one signature: finalized once, repudiated at most once. Finalization is what makes a signature count, and it is refused while the bound document version is anything other than accepted (Owner decision FE-018).';

CREATE UNIQUE INDEX uq_signature_event_finalized
  ON rec.signature_events(tenant_id, signature_id) WHERE event_type = 'finalized';
CREATE UNIQUE INDEX uq_signature_event_repudiated
  ON rec.signature_events(tenant_id, signature_id) WHERE event_type = 'repudiated';
CREATE INDEX ix_signature_event_visit
  ON rec.signature_events(tenant_id, company_id, branch_id, reception_visit_id);

-- ----------------------------------------------------------------------------
-- 7. rec.refusals — exact-version supporting media (FE-019).
--
--    The pair constraint is ONE-DIRECTIONAL on purpose. Requiring a version
--    whenever a document is named would have broken the shipped refusal
--    operation, whose contract accepts a document alone; a version without its
--    document, on the other hand, is incoherent in every case.
-- ----------------------------------------------------------------------------
ALTER TABLE rec.refusals
  ADD COLUMN evidence_document_version_id uuid NULL,
  ADD CONSTRAINT fk_refusals_evidence_version FOREIGN KEY (tenant_id, evidence_document_version_id)
    REFERENCES shared.document_versions(tenant_id, id) ON DELETE RESTRICT,
  ADD CONSTRAINT ck_refusals_evidence_pair CHECK (
    evidence_document_version_id IS NULL OR evidence_document_id IS NOT NULL
  );

COMMENT ON COLUMN rec.refusals.evidence_document_version_id IS
  'The exact immutable version of the supporting media. Optional by default; required, and required to be accepted, only where a live rec.capture_policy_rules row raises the floor.';

CREATE INDEX ix_refusals_evidence_version ON rec.refusals(tenant_id, evidence_document_version_id);

-- ----------------------------------------------------------------------------
-- 8. rec.damage_maps — bind a visit's map to the exact template VERSION (FE-012).
--
--    Phase 1-8 bound a map to a document and its exact version, but the template
--    itself was whatever document the caller named: there was no managed slot,
--    no revision history, and nothing to make a revised template unavailable for
--    new visits while staying readable for old ones. That binding is this column.
--    Nullable, because maps recorded before this contract existed keep working.
-- ----------------------------------------------------------------------------
ALTER TABLE rec.damage_maps
  ADD COLUMN damage_map_template_version_id uuid NULL,
  ADD CONSTRAINT fk_damage_maps_template_version
    FOREIGN KEY (tenant_id, damage_map_template_version_id)
    REFERENCES rec.damage_map_template_versions(tenant_id, id) ON DELETE RESTRICT;

COMMENT ON COLUMN rec.damage_maps.damage_map_template_version_id IS
  'The managed template revision this map was drawn on. Immutable once written, so a later revision of the template never moves a historical visit onto geometry it was not recorded against.';

CREATE INDEX ix_damage_maps_template_version
  ON rec.damage_maps(tenant_id, damage_map_template_version_id);

-- ============================================================================
-- Guards. Every function below is attached to a trigger in the same section and
-- has EXECUTE revoked from PUBLIC: a guard nobody calls is a rule nobody keeps.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Evidence binding: category, business link, version state.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_reception_evidence_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_doc uuid; v_status text; v_category text; v_expected text; v_link_purpose text;
BEGIN
  v_expected := CASE NEW.requirement_code
    WHEN 'exterior' THEN 'reception_exterior'
    WHEN 'dashboard_odometer' THEN 'reception_dashboard'
    WHEN 'ev_soc' THEN 'reception_dashboard'
    WHEN 'warning_lamp' THEN 'reception_dashboard'
    WHEN 'vin' THEN 'reception_vin'
    WHEN 'damage' THEN 'reception_damage'
    ELSE NULL
  END;
  IF v_expected IS NULL THEN
    RAISE EXCEPTION 'unknown capture requirement %', NEW.requirement_code
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT v.document_id, v.status, c.category_code, c.business_link_purpose
    INTO v_doc, v_status, v_category, v_link_purpose
    FROM shared.document_versions v
    JOIN shared.documents d ON d.tenant_id = v.tenant_id AND d.id = v.document_id
    JOIN shared.document_categories c ON c.id = d.category_id
   WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.document_version_id
     AND d.id = NEW.document_id AND d.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'evidence document/version is not visible'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_doc <> NEW.document_id OR v_category <> v_expected THEN
    RAISE EXCEPTION 'evidence category/version does not match requirement'
      USING ERRCODE = 'check_violation';
  END IF;
  -- shared.document_versions.status is one of pending, accepted, quarantined,
  -- rejected. Only the first two can ever become evidence; a version that was
  -- rejected or quarantined is refused here and can never be recovered by a
  -- later finalize, because that path only ever narrows this set further.
  IF v_status NOT IN ('pending','accepted') THEN
    RAISE EXCEPTION 'evidence version is not usable' USING ERRCODE = 'check_violation';
  END IF;
  IF v_link_purpose IS NULL OR NOT EXISTS (
    SELECT 1 FROM shared.document_links l
     WHERE l.tenant_id = NEW.tenant_id AND l.document_id = NEW.document_id
       AND l.entity_type = 'rec.reception_visits' AND l.entity_id = NEW.reception_visit_id
       AND l.link_purpose = v_link_purpose AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'evidence document is not linked to this reception'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.finalized_at IS NOT NULL AND v_status <> 'accepted' THEN
    RAISE EXCEPTION 'only an accepted evidence version may be finalized'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION rec.guard_reception_evidence_binding() IS
  'BEFORE INSERT / UPDATE OF finalized_at,finalized_by on rec.reception_evidence_bindings: the version must belong to the document, sit in the category the requirement expects, be linked to this visit at the category business link purpose, and be neither rejected nor quarantined. Finalizing additionally requires acceptance.';
REVOKE EXECUTE ON FUNCTION rec.guard_reception_evidence_binding() FROM PUBLIC;
CREATE TRIGGER tg_reception_evidence_binding_guard
  BEFORE INSERT OR UPDATE OF finalized_at, finalized_by ON rec.reception_evidence_bindings
  FOR EACH ROW EXECUTE FUNCTION rec.guard_reception_evidence_binding();

-- ----------------------------------------------------------------------------
-- Damage-map template revision: an accepted template document, linked to its slot.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_damage_map_template_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_doc uuid; v_status text; v_category text; v_link_purpose text; v_template_status text;
BEGIN
  SELECT t.status INTO v_template_status FROM rec.damage_map_templates t
   WHERE t.tenant_id = NEW.tenant_id AND t.id = NEW.template_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'damage-map template is not visible' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_template_status <> 'active' THEN
    RAISE EXCEPTION 'a retired damage-map template cannot publish a new revision'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT v.document_id, v.status, c.category_code, c.business_link_purpose
    INTO v_doc, v_status, v_category, v_link_purpose
    FROM shared.document_versions v
    JOIN shared.documents d ON d.tenant_id = v.tenant_id AND d.id = v.document_id
    JOIN shared.document_categories c ON c.id = d.category_id
   WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.document_version_id
     AND d.id = NEW.document_id AND d.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template document/version is not visible'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_doc <> NEW.document_id OR v_status <> 'accepted'
     OR v_category <> 'reception_damage_map_template' THEN
    RAISE EXCEPTION 'template requires an accepted reception_damage_map_template version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_link_purpose IS NULL OR NOT EXISTS (
    SELECT 1 FROM shared.document_links l
     WHERE l.tenant_id = NEW.tenant_id AND l.document_id = NEW.document_id
       AND l.entity_type = 'rec.damage_map_templates' AND l.entity_id = NEW.template_id
       AND l.link_purpose = v_link_purpose AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'template document is not linked to its template slot'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION rec.guard_damage_map_template_version() IS
  'BEFORE INSERT on rec.damage_map_template_versions: an active slot, an accepted reception_damage_map_template version belonging to its document, and a live link from that document to the slot.';
REVOKE EXECUTE ON FUNCTION rec.guard_damage_map_template_version() FROM PUBLIC;
CREATE TRIGGER tg_damage_map_template_version_guard
  BEFORE INSERT ON rec.damage_map_template_versions
  FOR EACH ROW EXECUTE FUNCTION rec.guard_damage_map_template_version();

-- ----------------------------------------------------------------------------
-- Visit-to-template binding: only a LIVE revision of a LIVE slot, and the map
-- must carry exactly that revision's document and version.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_damage_map_template_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_doc uuid; v_version uuid; v_version_status text;
        v_template_status text; v_map_type text; v_perspective text;
BEGIN
  IF NEW.damage_map_template_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT tv.document_id, tv.document_version_id, tv.status, t.status, t.map_type, t.perspective
    INTO v_doc, v_version, v_version_status, v_template_status, v_map_type, v_perspective
    FROM rec.damage_map_template_versions tv
    JOIN rec.damage_map_templates t ON t.tenant_id = tv.tenant_id AND t.id = tv.template_id
   WHERE tv.tenant_id = NEW.tenant_id AND tv.id = NEW.damage_map_template_version_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'damage-map template version is not visible'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  -- A retired slot or a superseded revision stays readable for every visit
  -- already bound to it and is refused for a NEW one. That is the whole of the
  -- FE-012 rule, and it lives here rather than in a read filter, because a read
  -- filter cannot stop a write.
  IF v_template_status <> 'active' OR v_version_status <> 'active' THEN
    RAISE EXCEPTION 'a retired damage-map template revision cannot be bound to a new visit'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_doc <> NEW.document_id OR v_version <> NEW.document_version_id THEN
    RAISE EXCEPTION 'the damage map does not carry its template revision document version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_map_type <> NEW.map_type OR v_perspective IS DISTINCT FROM NEW.perspective THEN
    RAISE EXCEPTION 'the damage map does not match its template type and perspective'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION rec.guard_damage_map_template_binding() IS
  'BEFORE INSERT on rec.damage_maps: when a managed template revision is named it must be the ACTIVE revision of an ACTIVE slot, and the map must carry that revision own document and version. Historical maps keep the revision they were recorded against.';
REVOKE EXECUTE ON FUNCTION rec.guard_damage_map_template_binding() FROM PUBLIC;
CREATE TRIGGER tg_damage_maps_template_binding
  BEFORE INSERT ON rec.damage_maps
  FOR EACH ROW EXECUTE FUNCTION rec.guard_damage_map_template_binding();
-- Its own trigger rather than an argument added to tg_damage_maps_immutable:
-- recreating a frozen Phase 1-8 trigger to widen its list would rewrite a rule
-- this migration does not own.
CREATE TRIGGER tg_damage_maps_template_immutable
  BEFORE UPDATE ON rec.damage_maps
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns('damage_map_template_version_id');

-- ----------------------------------------------------------------------------
-- Signature evidence (FE-018), as an ADDITIVE guard.
--
-- rec.guard_signature_version (Phase 1-8) still owns "the version belongs to the
-- document" and is untouched. This one adds what FE-018 requires and nothing
-- that would retire a shipped capture path: a rejected or quarantined version is
-- never bindable; a document already governed as reception_signature must be
-- linked to the visit it signs; and a replacement must belong to the same visit
-- as the signature it supersedes.
--
-- The category and the link are ALSO required, unconditionally, at finalization
-- — see rec.guard_signature_event. Insert-time strictness stops at what the
-- shipped contract can already satisfy, because narrowing it here would refuse
-- signatures that Phase 1-8 accepts, while finalization is new and can be strict
-- without withdrawing anything. A signature that cannot finalize never counts.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_signature_evidence()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_status text; v_category text; v_link_purpose text; v_prior_visit uuid;
BEGIN
  SELECT v.status, c.category_code, c.business_link_purpose
    INTO v_status, v_category, v_link_purpose
    FROM shared.document_versions v
    JOIN shared.documents d ON d.tenant_id = v.tenant_id AND d.id = v.document_id
    JOIN shared.document_categories c ON c.id = d.category_id
   WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.signature_document_version_id
     AND d.id = NEW.signature_document_id AND d.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'signature document/version is not visible'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_status NOT IN ('pending','accepted') THEN
    RAISE EXCEPTION 'a rejected or quarantined version cannot be signed'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_category = 'reception_signature' THEN
    IF v_link_purpose IS NULL OR NOT EXISTS (
      SELECT 1 FROM shared.document_links l
       WHERE l.tenant_id = NEW.tenant_id AND l.document_id = NEW.signature_document_id
         AND l.entity_type = 'rec.reception_visits' AND l.entity_id = NEW.reception_visit_id
         AND l.link_purpose = v_link_purpose AND l.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'signature document is not linked to this reception'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  IF NEW.replaces_signature_id IS NOT NULL THEN
    SELECT s.reception_visit_id INTO v_prior_visit FROM rec.signatures s
     WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.replaces_signature_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'the superseded signature is not visible'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    IF v_prior_visit IS DISTINCT FROM NEW.reception_visit_id THEN
      RAISE EXCEPTION 'replacement signature belongs to another reception'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION rec.guard_signature_evidence() IS
  'BEFORE INSERT on rec.signatures: refuses a rejected or quarantined version, requires a reception_signature document to be linked to the visit it signs, and keeps a replacement on the same visit as the signature it supersedes. Additive to rec.guard_signature_version, which is unchanged.';
REVOKE EXECUTE ON FUNCTION rec.guard_signature_evidence() FROM PUBLIC;
CREATE TRIGGER tg_signatures_evidence_guard
  BEFORE INSERT ON rec.signatures
  FOR EACH ROW EXECUTE FUNCTION rec.guard_signature_evidence();

-- ----------------------------------------------------------------------------
-- Signature lifecycle. Finalization is where FE-018 is enforced in full.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_signature_event()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_visit uuid; v_doc uuid; v_version uuid; v_status text;
        v_category text; v_link_purpose text;
BEGIN
  SELECT s.reception_visit_id, s.signature_document_id, s.signature_document_version_id
    INTO v_visit, v_doc, v_version
    FROM rec.signatures s
   WHERE s.tenant_id = NEW.tenant_id AND s.id = NEW.signature_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'signature is not visible' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_visit IS DISTINCT FROM NEW.reception_visit_id THEN
    RAISE EXCEPTION 'signature event does not match reception' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.event_type = 'finalized' THEN
    SELECT v.status, c.category_code, c.business_link_purpose
      INTO v_status, v_category, v_link_purpose
      FROM shared.document_versions v
      JOIN shared.documents d ON d.tenant_id = v.tenant_id AND d.id = v.document_id
      JOIN shared.document_categories c ON c.id = d.category_id
     WHERE v.tenant_id = NEW.tenant_id AND v.id = v_version AND d.id = v_doc
       AND d.deleted_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'signature document/version is not visible'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    -- Pending is the state a version sits in while it is stored and scanned.
    -- Finalizing one would be recording that a party signed something the
    -- platform has not yet accepted.
    IF v_status <> 'accepted' THEN
      RAISE EXCEPTION 'signature version is not accepted' USING ERRCODE = 'check_violation';
    END IF;
    IF v_category <> 'reception_signature' THEN
      RAISE EXCEPTION 'a finalized signature must bind a reception_signature version'
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_link_purpose IS NULL OR NOT EXISTS (
      SELECT 1 FROM shared.document_links l
       WHERE l.tenant_id = NEW.tenant_id AND l.document_id = v_doc
         AND l.entity_type = 'rec.reception_visits' AND l.entity_id = NEW.reception_visit_id
         AND l.link_purpose = v_link_purpose AND l.deleted_at IS NULL
    ) THEN
      RAISE EXCEPTION 'signature document is not linked to this reception'
        USING ERRCODE = 'check_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM rec.signature_events e
       WHERE e.tenant_id = NEW.tenant_id AND e.signature_id = NEW.signature_id
         AND e.event_type = 'repudiated'
    ) THEN
      RAISE EXCEPTION 'a repudiated signature cannot be finalized' USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM rec.signature_events e
       WHERE e.tenant_id = NEW.tenant_id AND e.signature_id = NEW.signature_id
         AND e.event_type = 'finalized'
    ) THEN
      RAISE EXCEPTION 'only a finalized signature may be repudiated'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION rec.guard_signature_event() IS
  'BEFORE INSERT on rec.signature_events: an event names its own signature and visit; finalization requires an ACCEPTED reception_signature version linked to that visit and refuses a repudiated signature; repudiation requires a finalized one.';
REVOKE EXECUTE ON FUNCTION rec.guard_signature_event() FROM PUBLIC;
CREATE TRIGGER tg_signature_event_guard BEFORE INSERT ON rec.signature_events
  FOR EACH ROW EXECUTE FUNCTION rec.guard_signature_event();

-- ----------------------------------------------------------------------------
-- Refusal supporting media (FE-019).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_refusal_evidence_version()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_doc uuid; v_status text; v_category text; v_link_purpose text;
        v_required integer; v_witness_required boolean;
BEGIN
  -- Most specific live rule wins: branch over tenant, typed over untyped, then
  -- most recently effective.
  SELECT p.min_count, p.witness_required INTO v_required, v_witness_required
    FROM rec.capture_policy_rules p
   WHERE p.tenant_id = NEW.tenant_id AND p.requirement_code = 'refusal_supporting_evidence'
     AND p.retired_at IS NULL AND (p.branch_id = NEW.branch_id OR p.branch_id IS NULL)
     AND (p.refusal_type = NEW.refusal_type OR p.refusal_type IS NULL)
   ORDER BY (p.branch_id IS NOT NULL) DESC, (p.refusal_type IS NOT NULL) DESC,
            p.effective_at DESC
   LIMIT 1;
  -- No rule is the DEFAULT, and the default is optional. This COALESCE is the
  -- whole of "not globally media-dependent".
  v_required := COALESCE(v_required, 0);
  v_witness_required := COALESCE(v_witness_required, false);

  IF v_witness_required AND NEW.witness_employee_id IS NULL THEN
    RAISE EXCEPTION 'a witness is required for this refusal type' USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.evidence_document_version_id IS NULL THEN
    IF v_required > 0 THEN
      RAISE EXCEPTION 'accepted refusal supporting evidence is required'
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;

  SELECT v.document_id, v.status, c.category_code, c.business_link_purpose
    INTO v_doc, v_status, v_category, v_link_purpose
    FROM shared.document_versions v
    JOIN shared.documents d ON d.tenant_id = v.tenant_id AND d.id = v.document_id
    JOIN shared.document_categories c ON c.id = d.category_id
   WHERE v.tenant_id = NEW.tenant_id AND v.id = NEW.evidence_document_version_id
     AND d.id = NEW.evidence_document_id AND d.deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'refusal evidence document/version is not visible'
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF v_doc <> NEW.evidence_document_id OR v_category <> 'reception_refusal_evidence'
     OR v_status NOT IN ('pending','accepted') THEN
    RAISE EXCEPTION 'refusal evidence requires a usable reception_refusal_evidence version'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_link_purpose IS NULL OR NOT EXISTS (
    SELECT 1 FROM shared.document_links l
     WHERE l.tenant_id = NEW.tenant_id AND l.document_id = NEW.evidence_document_id
       AND l.entity_type = 'rec.reception_visits' AND l.entity_id = NEW.reception_visit_id
       AND l.link_purpose = v_link_purpose AND l.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'refusal evidence is not linked to this reception'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_required > 0 AND v_status <> 'accepted' THEN
    RAISE EXCEPTION 'required refusal supporting evidence is not accepted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION rec.guard_refusal_evidence_version() IS
  'BEFORE INSERT on rec.refusals: supporting media is optional unless a live rec.capture_policy_rules row requires it for this branch and refusal type; when supplied by exact version it must be a reception_refusal_evidence version linked to this visit and never rejected or quarantined.';
REVOKE EXECUTE ON FUNCTION rec.guard_refusal_evidence_version() FROM PUBLIC;
CREATE TRIGGER tg_refusal_evidence_version BEFORE INSERT ON rec.refusals
  FOR EACH ROW EXECUTE FUNCTION rec.guard_refusal_evidence_version();

-- ============================================================================
-- RLS and least-privilege runtime capabilities.
--
-- Template and policy administration costs rec.catalogue.manage. Capture costs
-- rec.reception.evidence.manage. Waiving a capture costs
-- rec.reception.evidence.override. Signature lifecycle costs
-- rec.reception.signature.manage. None implies another, and all four are granted
-- to no role by default.
-- ============================================================================
ALTER TABLE rec.capture_policy_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.capture_policy_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_capture_policy_rules ON rec.capture_policy_rules FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_capture_policy_rules ON rec.capture_policy_rules FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND created_by = iam.current_user_id()
    AND iam.has_permission_in_scope('rec.catalogue.manage', company_id, branch_id));
CREATE POLICY upd_capture_policy_rules ON rec.capture_policy_rules FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND retired_at IS NULL
    AND iam.has_permission_in_scope('rec.catalogue.manage', company_id, branch_id))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON rec.capture_policy_rules TO app_runtime;
-- Retirement is the ONLY mutation. A retired rule can never be revived, because
-- the USING clause above only ever sees live ones.
GRANT UPDATE(retired_at) ON rec.capture_policy_rules TO app_runtime;
GRANT SELECT ON rec.capture_policy_rules TO app_readonly;

ALTER TABLE rec.damage_map_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.damage_map_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_damage_map_templates ON rec.damage_map_templates FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_damage_map_templates ON rec.damage_map_templates FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND created_by = iam.current_user_id()
    AND iam.has_permission_in_scope('rec.catalogue.manage', company_id, branch_id));
CREATE POLICY upd_damage_map_templates ON rec.damage_map_templates FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id()
    AND iam.has_permission_in_scope('rec.catalogue.manage', company_id, branch_id))
  WITH CHECK (tenant_id = iam.current_tenant_id());
GRANT SELECT, INSERT ON rec.damage_map_templates TO app_runtime;
GRANT UPDATE(status, record_version, updated_at, updated_by) ON rec.damage_map_templates TO app_runtime;
GRANT SELECT ON rec.damage_map_templates TO app_readonly;

ALTER TABLE rec.damage_map_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.damage_map_template_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_damage_map_template_versions ON rec.damage_map_template_versions
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id());
CREATE POLICY ins_damage_map_template_versions ON rec.damage_map_template_versions
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND created_by = iam.current_user_id()
    AND EXISTS (SELECT 1 FROM rec.damage_map_templates t
      WHERE t.tenant_id = damage_map_template_versions.tenant_id
        AND t.id = damage_map_template_versions.template_id
        AND iam.has_permission_in_scope('rec.catalogue.manage', t.company_id, t.branch_id)));
CREATE POLICY upd_damage_map_template_versions ON rec.damage_map_template_versions
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND status = 'active' AND EXISTS (
    SELECT 1 FROM rec.damage_map_templates t
     WHERE t.tenant_id = damage_map_template_versions.tenant_id
       AND t.id = damage_map_template_versions.template_id
       AND iam.has_permission_in_scope('rec.catalogue.manage', t.company_id, t.branch_id)))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND status = 'retired');
GRANT SELECT, INSERT ON rec.damage_map_template_versions TO app_runtime;
GRANT UPDATE(status, retired_at, retired_by) ON rec.damage_map_template_versions TO app_runtime;
GRANT SELECT ON rec.damage_map_template_versions TO app_readonly;

ALTER TABLE rec.reception_evidence_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.reception_evidence_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_reception_evidence_bindings ON rec.reception_evidence_bindings
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_reception_evidence_bindings ON rec.reception_evidence_bindings
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND created_by = iam.current_user_id()
    AND iam.has_permission_in_scope('rec.reception.evidence.manage', company_id, branch_id));
CREATE POLICY upd_reception_evidence_bindings ON rec.reception_evidence_bindings
  FOR UPDATE TO app_runtime
  USING (tenant_id = iam.current_tenant_id() AND finalized_at IS NULL
    AND iam.has_permission_in_scope('rec.reception.evidence.manage', company_id, branch_id))
  WITH CHECK (tenant_id = iam.current_tenant_id() AND finalized_at IS NOT NULL
    AND finalized_by = iam.current_user_id());
GRANT SELECT, INSERT ON rec.reception_evidence_bindings TO app_runtime;
GRANT UPDATE(finalized_at, finalized_by) ON rec.reception_evidence_bindings TO app_runtime;
GRANT SELECT ON rec.reception_evidence_bindings TO app_readonly;

ALTER TABLE rec.capture_requirement_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.capture_requirement_overrides FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_capture_requirement_overrides ON rec.capture_requirement_overrides
  FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_capture_requirement_overrides ON rec.capture_requirement_overrides
  FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND created_by = iam.current_user_id()
    AND iam.has_permission_in_scope('rec.reception.evidence.override', company_id, branch_id));
GRANT SELECT, INSERT ON rec.capture_requirement_overrides TO app_runtime;
GRANT SELECT ON rec.capture_requirement_overrides TO app_readonly;

ALTER TABLE rec.signature_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec.signature_events FORCE ROW LEVEL SECURITY;
CREATE POLICY sel_signature_events ON rec.signature_events FOR SELECT TO app_runtime, app_readonly
  USING (tenant_id = iam.current_tenant_id()
    AND (iam.allowed_company_ids() IS NULL OR company_id = ANY (iam.allowed_company_ids()))
    AND (iam.allowed_branch_ids() IS NULL OR branch_id = ANY (iam.allowed_branch_ids())));
CREATE POLICY ins_signature_events ON rec.signature_events FOR INSERT TO app_runtime
  WITH CHECK (tenant_id = iam.current_tenant_id() AND created_by = iam.current_user_id()
    AND iam.has_permission_in_scope('rec.reception.signature.manage', company_id, branch_id));
GRANT SELECT, INSERT ON rec.signature_events TO app_runtime;
GRANT SELECT ON rec.signature_events TO app_readonly;

-- No column grant is added for rec.signatures.replaces_signature_id,
-- rec.refusals.evidence_document_version_id or
-- rec.damage_maps.damage_map_template_version_id: all three tables already carry
-- a TABLE-level INSERT grant to app_runtime, which covers every column including
-- one added later. A column grant here would read as a narrowing that does not
-- exist.

-- ---------------------------------------------------------------------------
-- Covering indexes for the six foreign keys that had none.
--
-- Derived from the rebuilt database, not from reading this file: for every FK on
-- the six tables above, the FK's columns were compared against each index's
-- LEADING columns. Seven were already served -- the two visit bindings, the
-- template/version pair, the signature-event pair and the two tenant-only keys,
-- each covered by a unique constraint whose leading columns match. Six were not.
--
-- An index that merely mentions the columns does not serve the key: a lookup on
-- (tenant_id, document_id) cannot use an index led by
-- (tenant_id, company_id, branch_id, reception_visit_id). That is why "there are
-- already six CREATE INDEX statements in this migration" was not an answer to
-- the question, and why the check that found these compared column ORDER rather
-- than counting index statements.
--
-- Each matters at delete/update time on the PARENT: without them PostgreSQL
-- sequentially scans the child to enforce the constraint, and the document
-- tables these reference are exactly the ones P1-15 made append-heavy.
CREATE INDEX ix_capture_policy_rules_branch
  ON rec.capture_policy_rules (tenant_id, company_id, branch_id);

CREATE INDEX ix_damage_map_templates_branch
  ON rec.damage_map_templates (tenant_id, company_id, branch_id);

CREATE INDEX ix_damage_map_template_versions_document
  ON rec.damage_map_template_versions (tenant_id, document_id);

CREATE INDEX ix_damage_map_template_versions_file
  ON rec.damage_map_template_versions (tenant_id, document_version_id);

CREATE INDEX ix_reception_evidence_bindings_document
  ON rec.reception_evidence_bindings (tenant_id, document_id);

CREATE INDEX ix_reception_evidence_bindings_version
  ON rec.reception_evidence_bindings (tenant_id, document_version_id);

-- Two more, found by the repository's OWN gate (P1-03-DB-017) after the six
-- above, and both are cases a hand-rolled check waves through:
--
--  * fk_signature_event_signature is "covered" by uq_signature_event_finalized,
--    whose leading columns match exactly -- but that index is PARTIAL, so it
--    serves only the rows its predicate admits and cannot enforce the key. An
--    index that matches on column order and still does not cover is precisely
--    why the count of CREATE INDEX statements is never the answer.
--
--  * fk_signatures_replaces sits on rec.signatures, an EXISTING table this
--    migration adds a column to. A sweep scoped to "the six new tables" cannot
--    see it, which is how it survived the first pass.
CREATE INDEX ix_signature_events_signature
  ON rec.signature_events (tenant_id, signature_id);

CREATE INDEX ix_signatures_replaces
  ON rec.signatures (tenant_id, replaces_signature_id);
