-- ============================================================================
-- Migration: platform authority foundation (PRE-P1-29 Wave B, slice B1)
--
-- Rollback classification: ROLLBACK-SAFE. This file creates a role, a table, a
--   function, two triggers and one policy, and writes no data. The down script is
--   the exact inverse and destroys nothing:
--     DROP POLICY sel_platform_grants_self ON iam.platform_grants;
--     DROP FUNCTION iam.has_platform_authority(text);
--     DROP TABLE iam.platform_grants;
--     REVOKE USAGE ON SCHEMA org, iam, shared FROM app_platform;
--     DROP ROLE app_platform;
--   It becomes roll-forward-only the moment a platform grant is issued, because
--   dropping the table would then discard the record of who held control-plane
--   authority — which is exactly the history this relation exists to keep.
--
-- Specification: docs/phase-1/pre-p1-29-multi-tenant-admin-rbac-workflow/
--                wave-b-control-plane-design-v2.md, revision 4, sections 5 and 6.1.
--                Merged to protected develop as c081a019 (reviewed head 0bb6d882).
--
-- Why this exists
--   A freshly replayed database holds permissions, zero roles, zero grants and
--   no user account, so no actor exists who could create the first one. Wave B
--   introduces the control-plane principal that can, under constraints the
--   design fixes. This migration is its DATABASE FOUNDATION and nothing else:
--   an archetype role, one narrow assignment relation, and one resolver.
--
-- Why a fourth archetype (design section 2)
--   NOT because the existing administration policies would refuse a platform
--   write — they could not. Every policy in this repository is PERMISSIVE
--   (`AS RESTRICTIVE` appears zero times in the series) and permissive policies
--   combine with OR, so an added policy widens rather than refuses. The two real
--   reasons:
--     * containment must be WRITTEN, not inherited. Attaching a platform
--       predicate to app_runtime widens app_runtime itself, and every ordinary
--       tenant session runs as app_runtime;
--     * reuse would carry app_runtime's entire existing grant set, when the
--       control plane needs a handful of identity and organisation writes.
--   app_readonly and app_worker are disposed of on the same ground: each is an
--   identity whose whole value is its narrowness.
--
--   What IS true, and is why the platform path needs policies of its own
--   whatever role it runs as: every administration policy is predicated on
--   iam.has_permission (20260726090000:299-316, :370-385), which returns false
--   unless the acting principal holds an ACTIVE ACCOUNT IN THE CURRENT TENANT
--   (20260718097000:86-97) — which an operator creating that tenant's first
--   account cannot have.
--
-- Security implications
--   * app_platform is NOLOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE and
--     explicitly NOBYPASSRLS. It owns nothing. Every privilege it holds is an
--     explicit per-object grant, and they arrive in a LATER migration so this
--     file cannot be read as granting anything by itself.
--   * iam.platform_grants carries NO tenant column: platform authority is not a
--     tenant's to hold. It has RLS enabled AND forced, one SELECT policy, and no
--     INSERT/UPDATE/DELETE policy for any application role — establishing a
--     platform operator is an out-of-band act on a privileged connection, the
--     same shape tenant provisioning already has
--     (scripts/db/provision-organization.mjs).
--   * The authority reference is the permission CODE, not the surrogate id.
--     That is forced by the design's own prefix rule: a table CHECK cannot
--     subquery, so the code must be on the row for `platform.%` to be
--     checkable. It is a legal foreign-key target because
--     uq_permissions_code UNIQUE (permission_code) exists (20260718091000:61),
--     and it is why the resolver reads two tables rather than three.
--   * iam.has_platform_authority is SECURITY INVOKER with an empty search_path,
--     mirroring iam.has_permission. NO SECURITY DEFINER is introduced: the
--     replay gate hard-fails on a nonzero count (migration-replay-checks.mjs:221)
--     and nothing here needs one.
--   * iam.has_permission is NOT modified. A platform question and a tenant
--     question are answered by different functions, and neither can be made to
--     answer the other's.
--
-- Objects created
--   Roles:     app_platform
--   Tables:    iam.platform_grants
--   Functions: iam.has_platform_authority(text)
--   Policies:  sel_platform_grants_self
--   Triggers:  tg_platform_grants_touch_metadata, tg_platform_grants_immutable
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The archetype. Attributes only; no privilege is granted in this file.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_platform') THEN
    CREATE ROLE app_platform NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;
END;
$$;

COMMENT ON ROLE app_platform IS
  'Control-plane application role archetype (PRE-P1-29 Wave B). Non-owner, no BYPASSRLS, no DDL, no login. Holds ONLY the privileges its sanctioned control-plane paths require, each an explicit per-object grant. It is deliberately NOT a member of app_runtime: the delegation backstop iam.grant_delegation_within_authority exits early for a non-member (20260727090000:108-110), so membership would change that function''s behaviour, and the request path must never run as this role.';

GRANT USAGE ON SCHEMA org, iam, shared TO app_platform;

-- ----------------------------------------------------------------------------
-- 2. iam.platform_grants — identity to platform authority, and nothing else.
--
--    One row means: this canonical account holds this platform permission.
--    No tenant column. No role indirection — platform authority is small enough
--    that a role layer would be ceremony, and iam.roles is tenant-bound anyway.
-- ----------------------------------------------------------------------------
CREATE TABLE iam.platform_grants (
  id                uuid        NOT NULL DEFAULT gen_random_uuid(),
  user_account_id   uuid        NOT NULL,
  permission_code   text        NOT NULL,
  status            text        NOT NULL DEFAULT 'active',
  granted_at        timestamptz NOT NULL DEFAULT now(),
  granted_by        uuid        NOT NULL,
  revoked_at        timestamptz NULL,
  revoked_by        uuid        NULL,
  revoke_reason     text        NULL,
  record_version    integer     NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        NOT NULL,
  updated_at        timestamptz NULL,
  updated_by        uuid        NULL,

  CONSTRAINT pk_platform_grants PRIMARY KEY (id),

  -- The operator authenticates through the ordinary identity path; this
  -- relation records only what that identity may do OUTSIDE every tenant.
  CONSTRAINT fk_platform_grants_account
    FOREIGN KEY (user_account_id) REFERENCES iam.user_accounts (id) ON DELETE RESTRICT,

  -- The code, not the id: a table CHECK cannot subquery, so the prefix rule
  -- below is only expressible with the code text on this row.
  CONSTRAINT fk_platform_grants_permission
    FOREIGN KEY (permission_code) REFERENCES iam.permissions (permission_code) ON DELETE RESTRICT,

  CONSTRAINT ck_platform_grants_platform_code
    CHECK (permission_code LIKE 'platform.%'),
  CONSTRAINT ck_platform_grants_status
    CHECK (status IN ('active', 'revoked')),
  -- A revoked grant carries its revocation; an active one carries none. This is
  -- what makes `status` derivable rather than merely asserted.
  CONSTRAINT ck_platform_grants_revocation_coherent
    CHECK (
      (status = 'active'  AND revoked_at IS NULL AND revoked_by IS NULL)
      OR
      (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL)
    ),
  -- An account holds a given platform permission at most once while it is live.
  -- Revoked rows stay as history and do not block a later re-grant.
  CONSTRAINT uq_platform_grants_active
    UNIQUE NULLS NOT DISTINCT (user_account_id, permission_code, revoked_at)
);

COMMENT ON TABLE iam.platform_grants IS
  'Assignment of platform (control-plane) authority to a canonical identity (PRE-P1-29 Wave B, design section 5.1). Deliberately carries NO tenant_id: platform authority is not a tenant''s to hold. The permission vocabulary is the canonical catalogue — iam.permissions has no tenant column and its code format already admits a platform. prefix — so only the ASSIGNMENT is new. NO application role holds INSERT, UPDATE or DELETE here: establishing an operator is an out-of-band act on a privileged connection, which is what makes tenant-side escalation to platform authority structurally impossible rather than merely forbidden.';

COMMENT ON COLUMN iam.platform_grants.permission_code IS
  'The canonical permission code, referenced by code rather than by surrogate id so ck_platform_grants_platform_code can constrain the prefix — a table CHECK cannot subquery. Legal because uq_permissions_code makes the code unique.';
COMMENT ON COLUMN iam.platform_grants.status IS
  'active | revoked. A grant is revoked, never edited: the account and the permission are immutable after creation.';

CREATE INDEX ix_platform_grants_account_active
  ON iam.platform_grants (user_account_id, permission_code)
  WHERE status = 'active';

-- Every foreign key needs a supporting leading-column index (P1-03-DB-017), and
-- a PARTIAL index does not supply one. uq_platform_grants_active already leads
-- with user_account_id and covers fk_platform_grants_account; the catalogue
-- reference had nothing, so a RESTRICT check on an iam.permissions delete would
-- have sequential-scanned this table. Found by tests/db/org-security.test.ts
-- rather than by review, which is the same way the P1-18 remediation found six
-- of them.
CREATE INDEX ix_platform_grants_permission_code
  ON iam.platform_grants (permission_code);

CREATE TRIGGER tg_platform_grants_touch_metadata
  BEFORE UPDATE ON iam.platform_grants
  FOR EACH ROW EXECUTE FUNCTION shared.touch_row_metadata();

-- The account and the authority are fixed at creation. Revocation changes
-- status/revoked_at/revoked_by/revoke_reason and nothing else.
CREATE TRIGGER tg_platform_grants_immutable
  BEFORE UPDATE ON iam.platform_grants
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'user_account_id', 'permission_code', 'granted_at', 'granted_by', 'created_at', 'created_by');

ALTER TABLE iam.platform_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.platform_grants FORCE ROW LEVEL SECURITY;

-- The only policy on this table. A platform session may read the rows that
-- describe ITS OWN authority and no other operator's. There is deliberately no
-- INSERT, UPDATE or DELETE policy for any application role.
CREATE POLICY sel_platform_grants_self ON iam.platform_grants
  FOR SELECT TO app_platform
  USING (user_account_id = iam.current_user_id());

COMMENT ON POLICY sel_platform_grants_self ON iam.platform_grants IS
  'A control-plane session reads only its own authority rows. No enumeration of other operators, and no write path of any kind: platform authority is established out of band, so no tenant administrator and no control-plane operator can mint it through the product.';

-- ----------------------------------------------------------------------------
-- 3. iam.has_platform_authority — the resolver.
--
--    Mirrors iam.has_permission's structure and failure behaviour: false for an
--    absent principal, false for an inactive or deleted account, false when no
--    active grant matches. It consults NO tenant, which is the whole point —
--    iam.has_permission cannot answer a platform question because it requires an
--    active account IN THE CURRENT TENANT, and a platform operator creating that
--    tenant's first account has none.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.has_platform_authority(p_code text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user uuid;
BEGIN
  v_user := iam.current_user_id();
  IF v_user IS NULL THEN
    RETURN false; -- no acting principal → deny
  END IF;

  -- The account must exist, be active and not be soft-deleted. Read through the
  -- column-scoped grant and the self-row policy installed by the privilege
  -- migration; without them this raises rather than answering false, which is
  -- the intended loud failure.
  IF NOT EXISTS (
    SELECT 1 FROM iam.user_accounts
     WHERE id = v_user AND status = 'active' AND deleted_at IS NULL
  ) THEN
    RETURN false;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM iam.platform_grants g
     WHERE g.user_account_id = v_user
       AND g.permission_code = p_code
       AND g.status = 'active'
  );
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN false; -- malformed context value → deny, never error
END;
$$;

COMMENT ON FUNCTION iam.has_platform_authority(text) IS
  'True iff the current acting principal holds p_code as an ACTIVE platform grant and the account itself is active and not deleted (PRE-P1-29 Wave B, design section 5.2). Consults no tenant: platform authority exists outside every tenant, and iam.has_permission — which requires an active account in the CURRENT tenant — structurally cannot answer this question. SECURITY INVOKER; trusts only the server-set context. Absent principal, inactive account, unknown code and revoked grant all resolve to false.';

REVOKE EXECUTE ON FUNCTION iam.has_platform_authority(text) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 4. iam.holds_any_platform_authority — 'is this session a control-plane
--    operator at all?'
--
--    Some control-plane acts are not tied to one code. Appending the audit
--    record for an operation is the clear case: the operation itself is already
--    authority-gated, and the audit write should be permitted to any operator
--    rather than duplicating the operation's own code into the audit policy.
--
--    What it must NOT be is absent. Without it the audit policies could be
--    satisfied by tenant context alone, and a platform session holds whatever
--    tenant context it sets — so a connection with zero platform grants could
--    have named any tenant and appended a chain-valid record to it.
-- ----------------------------------------------------------------------------
-- plpgsql rather than sql, for one reason: the EXCEPTION block. Its sibling
-- iam.has_platform_authority carries one, and the foundation's stated rule is
-- "malformed context value -> deny, never error". This function had no such
-- block, so a session whose app.user_id is not a uuid got a raised 22P02 out of
-- every audit and replay policy while the sibling quietly answered false. Both
-- fail closed, but a refusal shaped like a crash is a different refusal, and
-- every test in this slice asserts 42501.
CREATE OR REPLACE FUNCTION iam.holds_any_platform_authority()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1
      FROM iam.platform_grants g
      JOIN iam.user_accounts u ON u.id = g.user_account_id
     WHERE g.user_account_id = iam.current_user_id()
       AND g.status = 'active'
       AND u.status = 'active'
       AND u.deleted_at IS NULL
  );
EXCEPTION
  WHEN invalid_text_representation THEN
    RETURN false;
END;
$$;

COMMENT ON FUNCTION iam.holds_any_platform_authority() IS
  'True iff the acting principal holds ANY active platform grant on an active, undeleted account. The coarse companion to iam.has_platform_authority(text), for control-plane acts that are not tied to one permission code — the audit write of an operation whose own code has already been checked. SECURITY INVOKER; consults no tenant.';

REVOKE EXECUTE ON FUNCTION iam.holds_any_platform_authority() FROM PUBLIC;
-- Granted to app_platform by the privilege-graph migration, deliberately not
-- here: this file establishes shape, the next file establishes reach.
