# PostgreSQL Extension Register

**Company:** RootLco — Root Link Company ·
**Product:** [PRODUCT NAME — Pending Final Approval] ·
**Classification:** Confidential — Commercial Product and Pilot Planning

**Status:** Approved (owner-recorded) ·
**Date:** 2026-07-16 ·
**Owner:** Eng. Ezzaldeen Al-Bitar (under the
[Solo Developer Review Policy](../governance/solo-developer-review-policy.md) —
technical self-review, not an independent review) ·
**Task:** P1-02-DB-017 ·
**Branch:** `feature/p1-02-database-engineering-foundation` ·
**Related:** [Database Architecture](./database-architecture.md) ·
[RLS Standard](./rls-standard.md) ·
[Role and Grant Standard](./role-and-grant-standard.md) ·
[Number Sequence Standard](./number-sequence-standard.md) ·
[Naming Standard](./database-naming-standard.md) ·
[Phase 1-2 Initial Audit](../phase-1/phase-1-2/initial-audit.md)

---

## 1. Purpose and scope

This is the controlled register of every PostgreSQL extension enabled on the
platform database. An extension **must not** be enabled unless it has an entry
here, and this register **must not** list an extension that is not installed by
a version-controlled migration. The two artefacts are kept in lockstep: today,
migration `supabase/migrations/0001_extensions.sql` is the single installer and
this document is its single justification record.

Measured facts behind every entry (2026-07-16, real system):

- Server: **PostgreSQL 17.6** on the local Supabase stack (Supabase CLI 2.109.1
  pinned in `package-lock.json`; database port 54322).
- All four extensions are installed by migration 0001 into the dedicated schema
  **`extensions`** (created by the migration itself with
  `CREATE SCHEMA IF NOT EXISTS extensions;` so the same file replays on the
  plain `postgres:17` CI container, which lacks Supabase's pre-created schema).
- Availability on both providers is **proven, not assumed**: the CI job
  "Database migrations and RLS tests" (`.github/workflows/ci.yml`) applies
  migration 0001 to a clean `postgres:17-alpine` service container via
  `scripts/db/apply-migrations.mjs` on every run. All four extensions ship in
  standard PostgreSQL contrib as well as in the Supabase image.

Installed versions, as measured on the local stack:

| Extension    | Version | Schema       | Installed by | Approval                             |
| ------------ | ------- | ------------ | ------------ | ------------------------------------ |
| `pgcrypto`   | 1.3     | `extensions` | 0001         | Approved 2026-07-16 (owner-recorded) |
| `btree_gist` | 1.7     | `extensions` | 0001         | Approved 2026-07-16 (owner-recorded) |
| `citext`     | 1.6     | `extensions` | 0001         | Approved 2026-07-16 (owner-recorded) |
| `pg_trgm`    | 1.6     | `extensions` | 0001         | Approved 2026-07-16 (owner-recorded) |

The version numbers above are the defaults bundled with PostgreSQL 17.6 as
reported by the local stack. CI proves the extensions _install_ on
`postgres:17-alpine`; it does not assert identical minor extension versions
there, and no claim beyond installability is made for that container.

## 2. Binding rules

1. **No extension may be enabled outside a migration.** Not via the Supabase
   dashboard, not by ad-hoc `CREATE EXTENSION` in a session, not in CI setup
   scripts, not in seeds. The migration is the only installer, so every
   environment that replays the migration set (local
   `npm run supabase:reset`, the CI clean-database apply) converges on the same
   extension surface. Violating this rule silently forks environments.
2. **Every extension installs `WITH SCHEMA extensions`**, never into `public`.
   Migration 0002 revokes `CREATE` on `public` from `PUBLIC`; extension objects
   must not repopulate it.
3. **A new extension requires an entry in this register before its migration
   merges** (process in section 8). The entry must contain an honest necessity
   statement — if PostgreSQL provides the capability natively, the extension is
   not "required" and the entry must say so.
4. **Extension usage must be schema-qualified where the object is a type or a
   named function** (e.g. `extensions.citext`, `extensions.hmac(...)`).
   Operators and operator classes resolve through the database `search_path`
   set by migration 0001 (section 7); hardened functions with
   `SET search_path = ''` must schema-qualify everything.
5. **Removal is a gate-reviewed change, never routine rollback.** All entries
   are classified roll-forward-only once any object depends on them;
   `DROP EXTENSION ... CASCADE` is destructive (it drops dependent columns,
   constraints, and indexes) and must never be issued ad hoc.
6. **Calling an extension function from a `SECURITY INVOKER` routine is a
   privilege decision, not a syntax detail.** The reference resolves under the
   _caller's_ rights, so every role expected to execute that routine needs
   `USAGE ON SCHEMA extensions` — which also exposes whatever else the installed
   extensions granted to `PUBLIC` in that schema. Prefer a core `pg_catalog`
   equivalent where one exists; where none does, the migration must state which
   roles need the schema USAGE and what else that opens (see §3).

## 3. `pgcrypto` 1.3 — cryptographic primitives

| Field                   | Entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                 | `hmac()` for keyed request-fingerprint hashing in the idempotency pattern; `gen_random_bytes()` for random token material. **`digest()` is no longer used** — see the necessity row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Necessity (honest)      | **Not needed for UUID generation.** `gen_random_uuid()` is native in PostgreSQL 13+ and the platform's UUID keys (e.g. `shared.number_sequences.id` in migration 0003) use the native function only. **Nor is it needed for plain SHA-256:** `iam.audit_hash` called `extensions.digest(..., 'sha256')` from Phase 1-4 until migration `20260725090000` (DBCR-P1-13-001) replaced it with core `pg_catalog.sha256(bytea)`, which is IMMUTABLE, byte-identical for this input, and executable by every role with no grant at all. That removed the last reference to a pgcrypto function in the migration set, so **no database object depends on pgcrypto today** (verified by inspection of `supabase/migrations/`, 2026-07-21). The extension stays installed and registered for the approved uses above; if neither materialises, its removal is the register-then-migrate process of §8, not an ad-hoc drop.                                                    |
| Provider availability   | PostgreSQL contrib and Supabase image; CI proves 0001 applies on `postgres:17-alpine`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Portability impact      | Low. Contrib module present in every mainstream PostgreSQL distribution. Because no persistent object depends on it in Phase 1-2, dump/restore currently has no pgcrypto ordering concern; that changes the moment a fingerprint column default or check references it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Security considerations | Cryptographic _primitives_, not a secret store. HMAC keys and generated token material are secret-class data and must never be persisted in plaintext in business tables (sensitive-data classes: public / internal / restricted / secret). UUIDs remain neither authorization tokens nor public display numbers regardless of how they are generated; knowledge of an ID never grants access. **Reaching a pgcrypto function costs `USAGE ON SCHEMA extensions` for whichever role executes the call chain** — under `SECURITY INVOKER` that is the caller, not the function owner. Measured during DBCR-P1-13-001: pgcrypto also installs `extensions.pg_stat_statements` and `extensions.pg_stat_statements_info` with `SELECT` to `PUBLIC`, and a `PUBLIC` grant cannot be revoked for one role, so granting that schema USAGE to an application role hands it a cluster-wide statement view as well. No application role holds it, and no migration grants it. |
| Owner / approval        | Eng. Ezzaldeen Al-Bitar · Approved 2026-07-16, owner-recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Rollback / removal      | No dependent objects today, so a drop would technically succeed — but removal still requires a register update and gate review. Once idempotency fingerprints reference it, roll-forward-only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

Illustration of the approved use (**example — no such call site exists today**;
the idempotency shape was proven in Phase 1-2 only against a disposable test
fixture, and `shared.idempotency_keys` stores `request_fingerprint` as `text`
computed outside the database):

```sql
-- EXAMPLE ONLY: keyed request fingerprint for idempotent write endpoints.
SELECT encode(extensions.hmac(v_canonical_request, v_key, 'sha256'), 'hex');
```

Where a **plain, unkeyed** digest is wanted, prefer core `pg_catalog.sha256` (or
`md5`, `sha224/384/512`): it needs no extension, no schema USAGE, and therefore
no privilege decision. `iam.audit_hash` is the practised example.

## 4. `btree_gist` 1.7 — btree operator classes for GiST

| Field                   | Entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                 | Lets a single GiST index/EXCLUDE constraint combine equality columns (`tenant_id WITH =`, `resource_id WITH =`) with range overlap (`during WITH &&`).                                                                                                                                                                                                                                                                                                                                                                                             |
| Necessity (honest)      | **Required.** PostgreSQL has no native way to express the approved non-overlap EXCLUDE template (P1-02-DB-011) without it. This is the only extension of the four with no native alternative for its purpose.                                                                                                                                                                                                                                                                                                                                      |
| Provider availability   | PostgreSQL contrib and Supabase image; CI proves 0001 applies on `postgres:17-alpine`.                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Portability impact      | Low-to-moderate: once EXCLUDE constraints reference its operator classes, any restore target must have btree_gist installed _before_ the constrained tables are created. Migration ordering (0001 first) guarantees this on replay.                                                                                                                                                                                                                                                                                                                |
| Security considerations | Adds operator classes only — no functions callable by runtime roles, no new privilege surface. One design obligation: exclusion constraints are enforced across **all** rows of a table, independent of RLS visibility, so every tenant-owned EXCLUDE template must include `tenant_id WITH =` so that rows of different tenants never constrain each other. This behaviour is test-proven: the 68-test suite (all passing 2026-07-16 via `npm run test:db`) shows overlap rejected within a tenant (SQLSTATE `23P01`) and allowed across tenants. |
| Owner / approval        | Eng. Ezzaldeen Al-Bitar · Approved 2026-07-16, owner-recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Rollback / removal      | Roll-forward-only. `DROP EXTENSION btree_gist CASCADE` would drop every dependent EXCLUDE constraint, silently removing overlap protection — prohibited outside a gate-reviewed migration.                                                                                                                                                                                                                                                                                                                                                         |

The approved template the extension exists for (**Phase 1-3+ example — no such
table exists in Phase 1-2**; the pattern was proven against a disposable
fixture in schema `p1_02_test`):

```sql
-- EXAMPLE (Phase 1-3+): no double-booking of a resource within a tenant.
ALTER TABLE veh.resource_bookings
  ADD CONSTRAINT ex_resource_bookings_no_overlap
  EXCLUDE USING gist (
    tenant_id   WITH =,
    resource_id WITH =,
    during      WITH &&
  );
```

## 5. `citext` 1.6 — case-insensitive text type

| Field                   | Entry                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                 | Case-insensitive comparison for natural keys compared case-insensitively (emails, human-entered codes).                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Necessity (honest)      | **Optional convenience.** The data-type standard (P1-02-DB-009) approves two equivalent mechanisms: `extensions.citext`, or a normalized shadow column (e.g. `email_normalized text` maintained as `lower(email)` with the unique index on the shadow column). Both are approved; neither is mandatory over the other. Where citext is used, the type **must** be referenced schema-qualified as `extensions.citext`. No Phase 1-2 table uses it (migration 0003's `sequence_code` is plain `text` constrained by a lowercase CHECK). |
| Provider availability   | PostgreSQL contrib and Supabase image; CI proves 0001 applies on `postgres:17-alpine`.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Portability impact      | Moderate where adopted: citext columns embed the type in table definitions, so dumps, restores, and any future engine migration need the extension (or a rewrite to the shadow-column mechanism) first. This is precisely why the shadow-column alternative stays approved.                                                                                                                                                                                                                                                           |
| Security considerations | Minimal direct surface. Case-insensitive uniqueness on identity-like keys (emails) reduces duplicate-account and spoofing-by-case mistakes; the comparison semantics must be understood when such a column participates in a unique or RLS-relevant predicate.                                                                                                                                                                                                                                                                        |
| Owner / approval        | Eng. Ezzaldeen Al-Bitar · Approved 2026-07-16, owner-recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Rollback / removal      | No dependent objects today. Once any column is declared `extensions.citext`, roll-forward-only: `DROP EXTENSION citext CASCADE` drops the dependent columns and their data.                                                                                                                                                                                                                                                                                                                                                           |

```sql
-- EXAMPLE (Phase 1-4+): case-insensitive natural key. This table does not exist.
CREATE TABLE iam.users (
  -- ...
  email extensions.citext NOT NULL,
  CONSTRAINT uq_users_tenant_id_email UNIQUE (tenant_id, email)
);
```

## 6. `pg_trgm` 1.6 — trigram matching

| Field                   | Entry                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                 | Trigram similarity and `LIKE`/`ILIKE` acceleration for future fuzzy search (customer names, vehicle plates and similar operator-facing lookups in later phases).                                                                                                                                                                                                                    |
| Necessity (honest)      | **Not needed in Phase 1-2. No index uses it today.** It is installed now deliberately, so the platform's extension surface is fixed early and later phases add indexes, not extensions. Registering an unused extension is a conscious trade-off recorded here rather than hidden.                                                                                                  |
| Provider availability   | PostgreSQL contrib and Supabase image; CI proves 0001 applies on `postgres:17-alpine`.                                                                                                                                                                                                                                                                                              |
| Portability impact      | Low while unused. Once GIN/GiST trigram indexes exist, restore targets need the extension before index creation — handled by migration ordering.                                                                                                                                                                                                                                    |
| Security considerations | Search indexes must never become a cross-tenant search channel. Trigram indexes on tenant-owned tables live under RLS like every other access path, and the index standard requires tenant-leading composite indexes by default with written justification for exceptions. A future trigram index does not weaken isolation, but its migration must state the query path it serves. |
| Owner / approval        | Eng. Ezzaldeen Al-Bitar · Approved 2026-07-16, owner-recorded.                                                                                                                                                                                                                                                                                                                      |
| Rollback / removal      | No dependent objects today; removal would still be a register + gate-review change. After the first trigram index ships, roll-forward-only.                                                                                                                                                                                                                                         |

## 7. The `search_path` decision (migration 0001)

Migration 0001 sets the **database-level default** search path:

```sql
ALTER DATABASE <current database> SET search_path TO "$user", public, extensions;
```

(applied dynamically via `format(..., current_database())` because the database
name differs between the local stack and CI).

Rationale, exactly as the migration records it:

- Extension-owned **operators, types, and operator classes** become resolvable
  without qualifying every operator. In particular, operator-class references
  inside EXCLUDE constraint definitions resolve through `search_path`; without
  `extensions` on the path, the btree_gist template in section 4 would fail to
  parse.
- It is a **database default only** — role-level and session-level overrides
  are untouched, and hardened functions (`iam.*` context readers,
  `shared.touch_row_metadata()`, `shared.next_display_number()`) still run with
  `SET search_path = ''` and schema-qualify everything, so the database default
  is a resolution convenience, never a security dependency.
- `public` remains on the path but is hardened separately: migration 0002
  revokes `CREATE ON SCHEMA public FROM PUBLIC`, so the path entry cannot be
  exploited by unprivileged object creation in `public`.

## 8. Process for registering a new extension

A new extension goes through all four steps, in order. Skipping any step makes
the change non-compliant.

| Step           | Action                                                                                                                                                                                                                                                                                                                                    | Output                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1. Evaluate    | State the concrete need; check for a **native PostgreSQL alternative** first (the pgcrypto/UUID lesson: do not register an extension for a capability the server already has); confirm availability in both the Supabase image and the `postgres:17` contrib set; assess security surface, RLS interaction, and portability/removal cost. | Written evaluation                                                                                                                  |
| 2. Record      | Add a full entry to this register (purpose, honest necessity, availability, portability, security, owner, approval status, rollback classification) **before** the migration merges.                                                                                                                                                      | Register entry, owner-approved under the Solo Developer Review Policy                                                               |
| 3. Migrate     | A version-controlled migration performs `CREATE EXTENSION IF NOT EXISTS <name> WITH SCHEMA extensions;` — following the migration naming rule `^(\d{4}                                                                                                                                                                                    | \d{14})_[a-z0-9_]+\.sql$` and honouring the CI migration-immutability check (existing files are never edited; a new file is added). | Migration file |
| 4. Gate review | CI must prove the migration applies to a clean `postgres:17-alpine` database and the full test suite passes; the change is reviewed at the phase gate. If the extension does not exist in the plain container, the CI/Supabase divergence must be recorded here as an accepted gap **before** merge — silent divergence is prohibited.    | Green CI + gate record                                                                                                              |

The same process, in reverse emphasis, governs **removal**: register entry
updated first, dedicated migration second, gate review third — and only when no
object depends on the extension or the destruction of dependents is explicitly
accepted and evidenced.

## 9. Honest gaps and environment notes

- **CI is plain PostgreSQL 17, not the Supabase stack.** The CI container
  proves extension installability and runs the 68-test suite, but
  Supabase-managed roles differ there (in `postgres:17`, `postgres` _is_ a
  superuser; in the Supabase stack it is not, but carries `BYPASSRLS`). This is
  documented and accepted — see the
  [Role and Grant Standard](./role-and-grant-standard.md). Nothing executed as
  `postgres` in either environment is ever presented as RLS evidence.
- **None of the four extensions has a persistent dependent database object in
  Phase 1-2** (pgcrypto, citext, and pg_trgm are entirely unused so far;
  btree_gist availability is exercised only by the disposable fixture-based
  EXCLUDE tests, which drop their objects). This is stated plainly rather than
  implied away: the register fixes the surface early; persistent usage arrives
  with the phases that own the consuming tables.
- **Dependency status as of migration `20260725090000`** (2026-07-21, by
  inspection of `supabase/migrations/`): btree_gist, citext, and pg_trgm now have
  persistent dependents — EXCLUDE constraints across the org/veh/svc/wty modules,
  `iam.user_accounts.email` typed `extensions.citext`, and the trigram GIN
  indexes on `shared.search_metadata` and `inv.item_master` respectively; all
  three are roll-forward-only from here. **pgcrypto has none**: its last
  reference, `extensions.digest` inside `iam.audit_hash`, was replaced by core
  `pg_catalog.sha256` under DBCR-P1-13-001 so that the `SECURITY INVOKER` audit
  call chain needs no `USAGE ON SCHEMA extensions` (§3). The extension remains
  installed and registered; that is a deliberate, recorded state, not an
  oversight.
- **No Development/Staging/Production environment exists** (ADR-012). The only
  databases are the local stack and the CI container, each with separate
  non-production credentials; production data is prohibited in both.
