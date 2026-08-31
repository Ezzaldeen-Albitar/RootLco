-- ============================================================================
-- PRE-P1-29 Wave B — M1: the platform authority archetype and its relation.
--
-- Rollback classification: DESTRUCTIVE-AFTER-FIRST-GRANT. The role, the table,
-- the resolver and every index here are droppable and lossless until the first
-- `iam.platform_grants` row exists. Afterwards those rows are the only record of
-- who holds control-plane authority; nothing else in the tree carries it.
--
-- ## Apply order — this file is FIRST, and the order is security-significant
--
-- Wave B's normative migration order is M1 -> M4 -> M3 -> M2 (design §15), and
-- filename lexical order IS apply order (`migration-replay-checks.mjs`
-- `checkFilenames`: "Lexical order is apply order"). The four Wave-B files are
-- therefore timestamped so that lexical sort reproduces that sequence:
--
--   20260831090000  M1  this file        role, relation, resolver
--   20260831091000  M4  transition guard  the backstop, before the privilege it bounds
--   20260831092000  M3  history emission  the guards, before the INSERT grant
--   20260831093000  M2  privilege graph   LAST — every grant and policy
--
-- Naming them _m1.._m4 would have produced apply order M1 -> M2 -> M3 -> M4,
-- putting the whole privilege graph ahead of both guards and opening the two
-- windows §15 names: "a window where the graph is unenforced" and "a database
-- where forged attribution is possible".
--
-- ## What this file creates, and why each piece is here
--
-- `app_platform` is a fourth database archetype. It is NOT a widening of
-- `app_runtime`: policies OR, so attaching a platform predicate to `app_runtime`
-- would make the control-plane path reachable from every ordinary tenant
-- session. Containment has to be written, not inherited (design §2).
--
-- `iam.platform_grants` records that one canonical account holds one platform
-- permission. It carries NO tenant column, by design — platform authority is not
-- a tenant's to hold — which is why M1 also adds it to the no-tenant-column
-- exception set in `tests/db/org-security.test.ts`, not to the nullable set.
--
-- ## The foreign key is on the CODE, and that settles a contradiction
--
-- Design §5.1 gives the authority reference as "Foreign key to `iam.permissions`,
-- restricted by a check to codes beginning `platform.`", and the FROZEN slice-02
-- contract states it as `permission_code -> iam.permissions(permission_code)`.
-- A prefix CHECK is only expressible on the code column, so both agree: the
-- reference is the code, and `uq_permissions_code` is the target it needs.
--
-- Design §6.8.1 assumed instead a SURROGATE reference, and on that assumption
-- concluded the resolver must read a third table (`iam.permissions`) to turn a
-- text code into a surrogate before matching. Under the frozen shape that read
-- does not exist: the resolver matches `permission_code` directly. So §6.8.1's
-- compensating grant and policy extension on `iam.permissions` are NOT shipped —
-- they would buy nothing, and an unused grant is authority handed out for no
-- reason. §5.2's "false when the code is unknown" still holds, by the foreign
-- key: a grant cannot exist for a code that does not, and a probe for an unknown
-- code matches no grant and answers false.
--
-- ## The two plain indexes are not redundant with the partial unique one
--
-- The FK-coverage gate at `tests/db/org-security.test.ts` excludes partial
-- indexes (`indpred IS NULL`), so the partial unique index below covers neither
-- foreign key. Both plain indexes exist to satisfy it, and each is a real access
-- path: revocation looks up by account, and the catalogue join by code.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The role archetype. Cluster-wide, so creation is guarded to keep the
--    migration replayable — the same shape 0002_base_schemas.sql uses.
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
  'PRE-P1-29 Wave B control-plane archetype. NOLOGIN: assumed by a separate environment-provisioned login role that holds membership of app_platform AND of no other app_* archetype, on its own connection pool (design §6.8.3). Never granted to a tenant request path — policies OR, so widening app_runtime would make the control plane reachable from every tenant session.';

-- All three schemas the sanctioned paths touch. `shared` is not optional and
-- was measured, not assumed: org.provision_organization writes
-- shared.number_sequences and shared.idempotency_keys, so without USAGE the
-- function aborts at COMPILATION with "permission denied for schema shared"
-- before a single statement runs — a failure no policy or table grant can
-- repair, because schema USAGE gates reaching the object at all.
GRANT USAGE ON SCHEMA iam, org, shared TO app_platform;

-- ----------------------------------------------------------------------------
-- 2. iam.platform_grants — the sole source of platform authority.
-- ----------------------------------------------------------------------------
CREATE TABLE iam.platform_grants (
  id              uuid        NOT NULL DEFAULT gen_random_uuid(),
  account_id      uuid        NOT NULL,
  permission_code text        NOT NULL,
  granted_by      uuid        NOT NULL,
  granted_at      timestamptz NOT NULL DEFAULT now(),
  revoked_by      uuid        NULL,
  revoked_at      timestamptz NULL,
  record_version  integer     NOT NULL DEFAULT 1,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        NOT NULL,
  updated_at      timestamptz NULL,
  updated_by      uuid        NULL,

  CONSTRAINT pk_platform_grants PRIMARY KEY (id),
  CONSTRAINT fk_platform_grants_account
    FOREIGN KEY (account_id) REFERENCES iam.user_accounts (id) ON DELETE RESTRICT,
  CONSTRAINT fk_platform_grants_permission
    FOREIGN KEY (permission_code) REFERENCES iam.permissions (permission_code) ON DELETE RESTRICT,
  CONSTRAINT ck_platform_grants_platform_prefix
    CHECK (permission_code LIKE 'platform.%'),
  CONSTRAINT ck_platform_grants_revocation_consistency
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  CONSTRAINT ck_platform_grants_revoked_after_granted
    CHECK (revoked_at IS NULL OR revoked_at >= granted_at),
  CONSTRAINT ck_platform_grants_no_self_grant
    CHECK (granted_by IS DISTINCT FROM account_id)
);

COMMENT ON TABLE iam.platform_grants IS
  'Records that one canonical account holds one platform permission. Carries NO tenant column by design: platform authority is not a tenant''s to hold, and iam.has_platform_authority never consults a tenant. Append-and-revoke only — no application role holds INSERT, UPDATE or DELETE; grants are an out-of-band operator act with their own record (design §5.3).';

-- Unique on (account, permission) among rows not revoked: one live grant per
-- pair, while the revoked history stays addressable.
CREATE UNIQUE INDEX uq_platform_grants_active
  ON iam.platform_grants (account_id, permission_code)
  WHERE revoked_at IS NULL;

-- One plain index per foreign key. The partial unique index above covers
-- neither, because the FK-coverage gate excludes partial indexes.
CREATE INDEX ix_platform_grants_account ON iam.platform_grants (account_id);
CREATE INDEX ix_platform_grants_permission_code ON iam.platform_grants (permission_code);

-- ----------------------------------------------------------------------------
-- 3. Row-level security: enabled AND forced, default deny.
-- ----------------------------------------------------------------------------
ALTER TABLE iam.platform_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE iam.platform_grants FORCE  ROW LEVEL SECURITY;

-- The acting principal's own active rows, and nothing else. This is the read
-- iam.has_platform_authority performs as app_platform; a SECURITY INVOKER
-- resolver called from inside a policy is evaluated as the writing role, so
-- without both halves it would raise 42501 at executor start rather than
-- answering false (blocker B2).
CREATE POLICY sel_platform_grants_own ON iam.platform_grants
  FOR SELECT TO app_platform
  USING (account_id = iam.current_user_id() AND revoked_at IS NULL);

-- ----------------------------------------------------------------------------
-- 4. Immutability. Reuses the generic guard already attached to ten iam tables;
--    no new function is introduced.
-- ----------------------------------------------------------------------------
CREATE TRIGGER tg_platform_grants_immutable
  BEFORE UPDATE ON iam.platform_grants
  FOR EACH ROW EXECUTE FUNCTION org.guard_immutable_columns(
    'account_id', 'permission_code', 'granted_by', 'granted_at', 'created_at', 'created_by'
  );

-- ----------------------------------------------------------------------------
-- 5. The resolver. SECURITY INVOKER, empty search path, mirroring
--    iam.has_permission's structure and failure behaviour: false when the acting
--    principal is absent, false when the account is not active, false when the
--    code is unknown, false when no active grant matches. It reads TWO tables —
--    iam.platform_grants and iam.user_accounts — and never consults a tenant.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION iam.has_platform_authority(p_code text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM iam.platform_grants g
      JOIN iam.user_accounts a
        ON a.id = g.account_id
     WHERE g.account_id = iam.current_user_id()
       AND g.permission_code = p_code
       AND g.revoked_at IS NULL
       AND a.status = 'active'
       AND a.deleted_at IS NULL
  );
$$;

COMMENT ON FUNCTION iam.has_platform_authority(text) IS
  'True when the acting principal holds an active platform grant for p_code and their account is active. SECURITY INVOKER with an empty search path, so it runs with the caller''s own privileges and RLS — which is why M2 grants app_platform SELECT on both tables it reads and why each carries a policy admitting that role. Consults no tenant: platform authority is not tenant-scoped.';

REVOKE EXECUTE ON FUNCTION iam.has_platform_authority(text) FROM PUBLIC;

-- ============================================================================
-- Exact rollback (lossless while iam.platform_grants is empty):
--
--   DROP FUNCTION iam.has_platform_authority(text);
--   DROP TRIGGER tg_platform_grants_immutable ON iam.platform_grants;
--   DROP TABLE iam.platform_grants;
--   REVOKE USAGE ON SCHEMA iam, org, shared FROM app_platform;
--   DROP ROLE app_platform;
-- ============================================================================
