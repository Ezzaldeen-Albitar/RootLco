-- ============================================================================
-- P1-32-PRE-OD-RGF — let 20261007140000 backfill iam.role_grants on a database
-- that already holds grants.
-- Owner module: iam
--
-- Rollback classification: ROLLBACK-SAFE. Two constraint triggers re-created
--   under their own names, functions and events; only INITIALLY changes, and
--   20261007160000 changes it back. No column, table, function, grant or policy.
--   Forward-only.
--
-- Why this file exists
--   This migration and 20261007160000 exist ONLY so that the merged migration
--   20261007140000_quo_discount_role_grant_provenance.sql applies on a database
--   whose iam.role_grants already holds rows, while that merged file stays
--   byte-identical. A merged migration is immutable, so the fix is two forward
--   migrations around it rather than an edit of it.
--
-- Purpose
--   20261007140000 disables tg_role_grants_touch_metadata, backfills two new
--   columns of every iam.role_grants row, and enables the trigger again. The two
--   constraint triggers below were DEFERRABLE INITIALLY DEFERRED and fire on
--   every UPDATE, so the backfill queued one deferred event per row for each,
--   and PostgreSQL refuses ALTER TABLE ... ENABLE TRIGGER while a table has
--   pending trigger events ("cannot ALTER TABLE because it has pending trigger
--   events"). A database whose iam.role_grants is empty queues nothing, which is
--   why replay from empty did not show it. Made INITIALLY IMMEDIATE here, the
--   same checks run at the end of the backfill statement instead of at commit,
--   so nothing is pending when the trigger is enabled. 20261007140000 is not
--   changed.
--
-- Security implications
--   None weakened: both checks still run on every insert and update. Until
--   20261007160000 runs they run at the end of each statement, so a scoped grant
--   written before its scopes in one transaction is refused (fails closed).
--
-- Dependencies
--   20260718092000 (tg_role_grants_require_scope), 20260727090000
--   (tg_role_grants_delegation_authority).
-- ============================================================================

DROP TRIGGER tg_role_grants_require_scope ON iam.role_grants;
CREATE CONSTRAINT TRIGGER tg_role_grants_require_scope
  AFTER INSERT OR UPDATE ON iam.role_grants
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_scoped_grant_has_scope();

DROP TRIGGER tg_role_grants_delegation_authority ON iam.role_grants;
CREATE CONSTRAINT TRIGGER tg_role_grants_delegation_authority
  AFTER INSERT OR UPDATE ON iam.role_grants
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION iam.enforce_grant_delegation_within_authority();
