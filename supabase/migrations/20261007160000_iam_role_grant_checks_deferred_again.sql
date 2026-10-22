-- ============================================================================
-- P1-32-PRE-OD-RGF — restore the two deferred role-grant checks after the
-- 20261007140000 backfill.
-- Owner module: iam
--
-- Rollback classification: ROLLBACK-SAFE. Two constraint triggers re-created
--   exactly as 20260718092000 and 20260727090000 wrote them. No column, table,
--   function, grant or policy. Forward-only.
--
-- Why this file exists
--   This migration and 20261007135000 exist ONLY so that the merged migration
--   20261007140000_quo_discount_role_grant_provenance.sql applies on a database
--   whose iam.role_grants already holds rows, while that merged file stays
--   byte-identical. A merged migration is immutable, so the fix is two forward
--   migrations around it rather than an edit of it.
--
-- Purpose
--   20261007135000 made tg_role_grants_require_scope and
--   tg_role_grants_delegation_authority INITIALLY IMMEDIATE so the
--   20261007140000 backfill left no pending trigger events. This puts them back
--   to DEFERRABLE INITIALLY DEFERRED, so a grant and its scopes written in
--   separate statements are again checked together at commit. The schema
--   afterwards is the schema 20261007150000 produced on a database where
--   20261007135000 never ran.
--
-- Dependencies
--   20261007135000.
-- ============================================================================

DROP TRIGGER tg_role_grants_require_scope ON iam.role_grants;
CREATE CONSTRAINT TRIGGER tg_role_grants_require_scope
  AFTER INSERT OR UPDATE ON iam.role_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_scoped_grant_has_scope();

DROP TRIGGER tg_role_grants_delegation_authority ON iam.role_grants;
CREATE CONSTRAINT TRIGGER tg_role_grants_delegation_authority
  AFTER INSERT OR UPDATE ON iam.role_grants
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_grant_delegation_within_authority();
