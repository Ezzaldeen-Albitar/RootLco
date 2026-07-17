# Rehearsal Evidence — Defective Migration Must Fail the Pipeline

**Task:** P1-02-DO-001 · **Date:** 2026-07-16 · **Executed by:** Eng. Ezzaldeen Al-Bitar
(owner-authorized self-review — see the
[Solo Developer Review Policy](../../governance/solo-developer-review-policy.md))

## What was rehearsed

The migration pipeline (`scripts/db/apply-migrations.mjs`, the same runner CI executes)
must **fail** when a deliberately defective migration is introduced. The defective file
was created locally, exercised against a scratch database, and deleted. **It was never
committed** — this document is the only artefact.

## Procedure and observed results (verbatim)

1. A scratch database `rehearsal` was created on the local Supabase PostgreSQL 17.6.
2. A deliberately defective migration `0004_broken_rehearsal.sql` was written:

   ```sql
   ALTER TABLE shared.this_table_does_not_exist ADD COLUMN boom int;
   ```

3. The runner was executed against the scratch database:

   ```
   Applying 0001_extensions.sql ... OK
   Applying 0002_base_schemas.sql ... OK
   Applying 0003_number_sequences.sql ... OK
   Applying 0004_broken_rehearsal.sql ... FAILED
   Migration 0004_broken_rehearsal.sql failed: relation "shared.this_table_does_not_exist" does not exist
   RUNNER_EXIT=1
   ```

   The pipeline **fails with exit code 1**. Because each migration applies in its own
   transaction, migrations 0001–0003 remained fully applied (all 5 module schemas
   present) and the defective 0004 left **no partial state** behind.

4. The defective file was deleted, and the runner was executed again against the same
   (now populated) scratch database, exercising the clean-database guard:

   ```
   Refusing to run: module schemas already exist (org, iam, shared, crm, veh).
   This runner only targets a clean database.
   GUARD_EXIT=1
   ```

5. The scratch database was dropped. `git status` confirms the defective migration never
   entered version control; `supabase/migrations/` contains exactly
   `0001_extensions.sql`, `0002_base_schemas.sql`, `0003_number_sequences.sql`.

## What this proves — and what it does not

- **Proven:** a defective migration cannot pass the migration step; failure is loud,
  attributed to the exact file, and leaves prior migrations intact and the broken one
  rolled back. The runner cannot be pointed at a database that already holds state.
- **Not claimed:** this rehearsal ran locally. The identical steps run in the CI
  `Database migrations and RLS tests` job; a GitHub Actions run demonstrating it there
  is part of the pull-request evidence, not this document.
