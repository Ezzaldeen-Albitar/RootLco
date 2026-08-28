#!/usr/bin/env node
/**
 * Derives an approval witness for every template version that was already
 * `approved` before migration 20260828090000.
 *
 * ## Why this is a script and not part of the migration
 *
 * It WAS part of the migration, and `migration-replay-checks.mjs` refused it:
 *
 *   "INSERTs into shared.template_version_approvals at the top level. Migrations
 *    create structure; business rows are the tenant's."
 *
 * The rule is absolute and correct — a census of every shipped migration finds
 * zero top-level business INSERTs, and the one existing backfill precedent
 * (the damage-map revision) is an UPDATE of rows that already exist. The same
 * statement inside a `DO $$ … $$` block would have slipped past the scanner,
 * because it strips dollar-quoted bodies so history triggers do not trip it; that
 * would be hiding from a guard rather than satisfying it.
 *
 * ## What it derives, and what it refuses to invent
 *
 * One witness per already-approved version, and nothing else. `approved_by` is the
 * version's own recorded approver where the lifecycle captured one, and its creator
 * where it did not — both are real actors already on the row. No template is
 * fabricated, no lifecycle state is mutated, and a version that is not `approved`
 * is not touched.
 *
 * Idempotent: `ON CONFLICT (template_version_id) DO NOTHING`, so running it twice
 * changes nothing the second time. Safe to run before or after any deployment.
 *
 * ## Until it runs
 *
 * A version approved before the migration has no witness, so a publisher treats it
 * as not usable and sends nothing. That is a visible no-notification state rather
 * than a corruption, and it does not affect any version approved afterwards —
 * `approveVersion` writes the witness in the same transaction as the approval.
 *
 * Every current environment holds zero authored templates, so the set is empty
 * today; this exists to be correct for a database that is not.
 *
 * Usage:  node scripts/db/backfill-template-approval-witnesses.mjs [--dry-run]
 */
import { Client } from 'pg';

const DRY_RUN = process.argv.includes('--dry-run');

function connection() {
  return new Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 54322),
    database: process.env.DB_NAME ?? 'postgres',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  });
}

const PENDING = `
  SELECT v.id, v.tenant_id, v.owner_tenant_id
    FROM shared.template_versions AS v
    LEFT JOIN shared.template_version_approvals AS a
      ON a.template_version_id = v.id
   WHERE v.status = 'approved' AND a.id IS NULL
   ORDER BY v.id`;

const INSERT = `
  INSERT INTO shared.template_version_approvals
    (tenant_id, owner_tenant_id, template_version_id, approved_at, approved_by)
  SELECT v.tenant_id,
         v.owner_tenant_id,
         v.id,
         COALESCE(v.approved_at, v.created_at),
         COALESCE(v.approved_by, v.created_by)
    FROM shared.template_versions AS v
    LEFT JOIN shared.template_version_approvals AS a
      ON a.template_version_id = v.id
   WHERE v.status = 'approved' AND a.id IS NULL
  ON CONFLICT (template_version_id) DO NOTHING`;

async function main() {
  const db = connection();
  await db.connect();
  try {
    const pending = await db.query(PENDING);
    if (pending.rowCount === 0) {
      console.log('No approved template version is missing a witness. Nothing to do.');
      return;
    }
    console.log(`${pending.rowCount} approved version(s) without a witness:`);
    for (const row of pending.rows) {
      const scope = row.tenant_id === null ? 'platform' : `tenant ${row.tenant_id}`;
      console.log(`  ${row.id}  (${scope})`);
    }
    if (DRY_RUN) {
      console.log('--dry-run: nothing written.');
      return;
    }
    // One transaction: either every derivable witness exists afterwards or none
    // of them do, so a partial run cannot leave half the catalogue provable.
    await db.query('BEGIN');
    const written = await db.query(INSERT);
    await db.query('COMMIT');
    console.log(`Wrote ${written.rowCount} witness row(s).`);
  } catch (error) {
    try {
      await db.query('ROLLBACK');
    } catch {
      /* the connection may already be unusable; the original error is the one to report */
    }
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(`backfill failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
