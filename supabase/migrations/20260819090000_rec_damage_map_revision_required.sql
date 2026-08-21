-- ============================================================================
-- DBCR-P1-28-001 — a damage map must NAME the revision it was drawn on.
--
-- Rollback classification: ROLL-FORWARD-ONLY. Forward-only — no down script.
--   The guard replacement alone would be reversible, but the backfill is not:
--   it writes `damage_map_template_version_id` on historical rows, and reverting
--   would mean deciding which of those values had been NULL before — a fact this
--   migration does not preserve because the column it fills is the only place it
--   was ever recorded. A correction goes forward as a new migration.
--
-- Owner QA, 2026-08-19, against the running production build.
--
-- ## The defect
--
-- `rec.guard_damage_map_template_binding()` opened with:
--
--     IF NEW.damage_map_template_version_id IS NULL THEN RETURN NEW; END IF;
--
-- So every rule the guard states — an ACTIVE slot, a LIVE revision, the map
-- carrying exactly that revision's document and version, the same map type and
-- perspective — applied only to a caller that VOLUNTEERED the revision id. The
-- shipped web client did not, and nothing else did either: seven of the nine
-- damage maps in the acceptance database carry NULL.
--
-- Measured against the running API before this migration, on a NEW visit
-- binding a RETIRED template's document/version pair:
--
--     without `damageMapTemplateVersionId`  ->  HTTP 201   (admitted)
--     with    `damageMapTemplateVersionId`  ->  HTTP 422   (refused)
--
-- The Frontend chooser filtered retired slots out, so the product APPEARED to
-- honour FE-012. That is a hidden control rather than an enforced rule, and it
-- is worth nothing against a caller that does not use the chooser.
--
-- ## Why a guard and not `NOT NULL`
--
-- The requirement is an invariant on NEW damage maps; `NOT NULL` is an invariant
-- on ROWS. A database holding a historical map whose revision cannot be derived
-- would fail to migrate, and the honest answer to an underivable row is to leave
-- it readable and say so — never to invent a revision for it.
--
-- `CHECK (... IS NOT NULL) NOT VALID` was considered and rejected for a narrower
-- reason: a NOT VALID check is still evaluated on UPDATE, so later maintenance
-- of a legacy NULL row — a soft delete, a metadata touch — would be refused by
-- it. `rec.damage_maps` grants UPDATE to `app_runtime` and carries
-- `tg_damage_maps_touch_metadata`, so that is a live path, not a hypothetical.
--
-- BEFORE INSERT is exactly the surface the requirement names, and it is the one
-- place a refusal can also say why.
--
-- ## What the backfill does, and what it refuses to do
--
-- `rec.damage_map_template_versions` holds (document_id, document_version_id)
-- per revision, so a map naming a document pair identifies its revision whenever
-- exactly ONE revision of that tenant carries the same pair. Where that holds
-- the value is derived and written. Where two or more revisions share the pair,
-- or none does, the row is LEFT NULL: it stays readable, keeps its marks, and is
-- not given a revision somebody guessed.
--
-- The NOTICE reports both populations, so a replay on any database says out loud
-- how many rows it could not settle rather than leaving a reader to assume there
-- were none.
--
-- Measured on the acceptance database before this file was written: 9 maps, 7
-- NULL, and all 7 resolve to exactly one candidate revision. The migration
-- re-measures rather than trusting that.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Backfill — only where the revision is UNAMBIGUOUS.
--
-- `tg_damage_maps_template_immutable` fires BEFORE UPDATE on exactly this column
-- and `org.guard_immutable_columns` raises on ANY distinct change, NULL -> uuid
-- included. Verified by running the statement below unguarded, which fails with
-- `column damage_map_template_version_id is immutable`.
--
-- So the trigger is stood down for the backfill and restored immediately after,
-- rather than weakened: the column must stay immutable once it holds a value,
-- and that rule is unchanged by this migration. DDL is transactional here, so a
-- failure anywhere below rolls the DISABLE back with everything else — the
-- trigger cannot be left off by a half-applied migration.
-- ----------------------------------------------------------------------------
ALTER TABLE rec.damage_maps DISABLE TRIGGER tg_damage_maps_template_immutable;

DO $$
DECLARE
  v_before integer;
  v_filled integer;
  v_left   integer;
BEGIN
  SELECT count(*) INTO v_before
    FROM rec.damage_maps
   WHERE damage_map_template_version_id IS NULL;

  WITH resolvable AS (
    SELECT m.id AS map_id,
           (SELECT tv.id
              FROM rec.damage_map_template_versions tv
             WHERE tv.tenant_id = m.tenant_id
               AND tv.document_id = m.document_id
               AND tv.document_version_id = m.document_version_id) AS revision_id
      FROM rec.damage_maps m
     WHERE m.damage_map_template_version_id IS NULL
       -- Exactly one candidate. Asserted here rather than discovered by the
       -- scalar sub-select above raising on two, so "ambiguous" is a population
       -- this migration COUNTS instead of an error it dies on.
       AND (SELECT count(*)
              FROM rec.damage_map_template_versions tv
             WHERE tv.tenant_id = m.tenant_id
               AND tv.document_id = m.document_id
               AND tv.document_version_id = m.document_version_id) = 1
  )
  UPDATE rec.damage_maps m
     SET damage_map_template_version_id = r.revision_id
    FROM resolvable r
   WHERE m.id = r.map_id;

  GET DIAGNOSTICS v_filled = ROW_COUNT;

  SELECT count(*) INTO v_left
    FROM rec.damage_maps
   WHERE damage_map_template_version_id IS NULL;

  RAISE NOTICE 'DBCR-P1-28-001 backfill: % maps named no revision, % derived unambiguously, % left NULL (historical and unresolvable — readable, never invented).',
    v_before, v_filled, v_left;
END $$;

ALTER TABLE rec.damage_maps ENABLE TRIGGER tg_damage_maps_template_immutable;

-- ----------------------------------------------------------------------------
-- 2. The guard — a NEW map must name its revision.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rec.guard_damage_map_template_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE v_doc uuid; v_version uuid; v_version_status text;
        v_template_status text; v_map_type text; v_perspective text;
BEGIN
  -- DBCR-P1-28-001. This was `RETURN NEW`, which made every rule below optional
  -- for any caller that omitted the column — which was all of them. A map that
  -- cannot say which revision it was drawn on is not a weaker binding, it is an
  -- unbound one: nothing downstream can resolve the diagram it used, and the
  -- retirement rule has nothing to test.
  IF NEW.damage_map_template_version_id IS NULL THEN
    RAISE EXCEPTION 'a damage map must name the template revision it was drawn on'
      USING ERRCODE = 'not_null_violation';
  END IF;

  SELECT tv.document_id, tv.document_version_id, tv.status, t.status, t.map_type, t.perspective
    INTO v_doc, v_version, v_version_status, v_template_status, v_map_type, v_perspective
    FROM rec.damage_map_template_versions tv
    JOIN rec.damage_map_templates t ON t.tenant_id = tv.tenant_id AND t.id = tv.template_id
   WHERE tv.tenant_id = NEW.tenant_id AND tv.id = NEW.damage_map_template_version_id;
  -- Tenant-scoped by `tv.tenant_id = NEW.tenant_id`, so ANOTHER tenant's
  -- revision is not merely refused — it is not visible, and the refusal
  -- discloses nothing about whether that id exists elsewhere.
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
  'BEFORE INSERT on rec.damage_maps: the revision is MANDATORY (DBCR-P1-28-001), belongs to this tenant, is a live revision of an active slot, and carries exactly the map''s document, version, map type and perspective. Historical rows written before the revision was mandatory keep NULL and stay readable; the rule is on NEW maps, which is why it is a guard rather than a column constraint.';

REVOKE EXECUTE ON FUNCTION rec.guard_damage_map_template_binding() FROM PUBLIC;
