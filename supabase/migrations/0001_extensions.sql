-- ============================================================================
-- Migration 0001 — PostgreSQL extensions (P1-02-DB-017)
-- Phase 1-2: Database Architecture and Engineering Standards.
--
-- Registers the approved platform extensions. The evaluation, purpose, owner,
-- approval status, and removal implications for each extension are recorded in
-- docs/database/postgresql-extension-register.md. Nothing here is claimed to be
-- required where PostgreSQL provides the feature natively; see the honest notes
-- inline.
--
-- Forward-only. Rollback classification: roll-forward-only (dropping an
-- extension that objects depend on is destructive; see the migration standard).
-- ============================================================================

-- Supabase places extensions in a dedicated `extensions` schema. The plain
-- PostgreSQL container used by CI does not have that schema, so create it
-- explicitly to keep the migration replayable on both. Owner: migration role.
CREATE SCHEMA IF NOT EXISTS extensions;

-- ----------------------------------------------------------------------------
-- pgcrypto — cryptographic primitives (digest, hmac, gen_random_bytes).
--
-- HONEST NOTE: gen_random_uuid() is NATIVE in PostgreSQL 13+ and does NOT
-- require pgcrypto. The UUID standard (docs/database/database-naming-standard.md
-- and the UUID standard section of the architecture document) relies on the
-- native function only. pgcrypto is registered for the approved near-term uses:
-- request-fingerprint hashing in the idempotency pattern (digest/hmac) and
-- random token material generation (gen_random_bytes).
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- btree_gist — btree operator classes for GiST indexes. Required for EXCLUDE
-- constraints that combine equality columns (tenant_id, resource id) with
-- range overlap (&&) — the approved template for non-overlapping intervals
-- (P1-02-DB-011). PostgreSQL provides no native way to express such EXCLUDE
-- constraints without it.
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- citext — case-insensitive text type for natural keys compared
-- case-insensitively (emails, codes). The data-type standard
-- (P1-02-DB-009) approves `extensions.citext` OR a normalized shadow column;
-- the type must always be referenced schema-qualified.
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- pg_trgm — trigram matching for future fuzzy search indexes. Registered and
-- installed now so the platform's extension surface is fixed early; no index
-- uses it in Phase 1-2 (search indexes belong to the phases that own the
-- searched tables, and must respect tenant isolation — see the index standard).
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;

-- ----------------------------------------------------------------------------
-- Make extension-owned operators, types, and operator classes resolvable
-- without schema-qualifying every operator (operator-class references in
-- EXCLUDE constraints resolve through search_path). This sets the DATABASE
-- default; it does not touch role-level or session overrides. Applied
-- dynamically because the database name differs between environments.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET search_path TO "$user", public, extensions',
    current_database()
  );
END;
$$;
