#!/usr/bin/env node
// ============================================================================
// P1-12 Wave 1.2 — Phase-boundary upgrade matrix.
//
// For every phase boundary P1-2 … P1-11, reconstruct a clean database state that
// contains ONLY the migrations through that phase cutoff (a disposable database in
// the local cluster — roles are guarded IF NOT EXISTS, so cluster-global roles are
// shared safely), validate the boundary state, then apply the REMAINING migration
// chain through P1-11 plus the current seeds, and prove the upgraded schema is
// STRUCTURALLY IDENTICAL to the canonical full-rebuild schema (same sha256 schema
// hash). Records duration + outcome per boundary. Read-only w.r.t. the main DB;
// only creates/drops its own `p1_12_upgrade_probe` database.
//
// Usage: node scripts/db/phase-upgrade-matrix.mjs [--json out.json]
// Env: PGHOST/PGPORT/PGUSER/PGPASSWORD (defaults 127.0.0.1:54322 postgres/postgres).
// ============================================================================
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { collectInventory, computeSchemaHash } from './schema-inventory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MIG_DIR = join(ROOT, 'supabase', 'migrations');
const PROBE_DB = 'p1_12_upgrade_probe';

// Phase → last migration index (0-based, inclusive), computed from the migration
// Phase headers (see docs/phase-1/phase-1-12/phase-1-12-gate-plan.md).
//
// Phase 12 introduced no migration — it validated and froze the Release 2
// baseline — so index 112 is both the phase-11 and the Release 2 boundary.
// Phase 13 adds exactly one: the DBCR-P1-13-001 remediation at index 113.
const CUTOFFS = {
  2: 1,
  3: 10,
  4: 19,
  5: 31,
  6: 48,
  7: 64,
  8: 81,
  9: 97,
  10: 105,
  11: 112,
  13: 113,
};

const SEEDS = [
  'seed.sql',
  'seeds/01_reference_data.sql',
  'seeds/04_iam_permission_catalog.sql',
  'seeds/05_shared_reference.sql',
  'seeds/06_wo_job_state_graph.sql',
  'seeds/07_inv_units_of_measure.sql',
  'seeds/08_sal_payment_methods.sql',
];

const base = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 54322),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
};

const migrations = readdirSync(MIG_DIR)
  .filter((f) => f.endsWith('.sql'))
  .sort((a, b) => a.localeCompare(b));

async function applyFiles(client, files, dir) {
  for (const f of files) {
    const sql = readFileSync(join(dir, f), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw new Error(`${f}: ${e.message}`);
    }
  }
}

async function dropProbe(admin) {
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()`,
    [PROBE_DB]
  );
  await admin.query(`DROP DATABASE IF EXISTS ${PROBE_DB}`);
}

async function main() {
  // 113 was the frozen Release 2 baseline; 114 adds the DBCR-P1-13-001
  // remediation. Anything else means a migration arrived unrecorded.
  if (migrations.length !== 114)
    console.warn(`WARN: expected 114 migrations, found ${migrations.length}`);

  // Canonical full-rebuild hash (from the main DB — already the reference).
  const mainClient = new pg.Client({ ...base, database: process.env.PGDATABASE ?? 'postgres' });
  await mainClient.connect();
  const canonical = computeSchemaHash((await collectInventory(mainClient)).inventory);
  await mainClient.end();

  const admin = new pg.Client({ ...base, database: 'postgres' });
  await admin.connect();

  const results = [];
  for (const phase of Object.keys(CUTOFFS)
    .map(Number)
    .sort((a, b) => a - b)) {
    const cut = CUTOFFS[phase];
    await dropProbe(admin);
    await admin.query(`CREATE DATABASE ${PROBE_DB}`);
    const db = new pg.Client({ ...base, database: PROBE_DB });
    await db.connect();
    let outcome = 'ok',
      boundary = {},
      upgradeMs = 0,
      finalHash = null,
      err = null;
    try {
      // 1. Apply migrations through the phase cutoff (the frozen boundary state).
      const t0 = process.hrtime.bigint();
      await applyFiles(db, migrations.slice(0, cut + 1), MIG_DIR);
      // 2. Validate the boundary state (object inventory at the cutoff).
      const bInv = await collectInventory(db);
      boundary = {
        tables: bInv.totals.tables,
        functions: bInv.totals.functions,
        schemas_with_objects: Object.entries(bInv.bySchema)
          .filter(([, v]) => v.tables > 0)
          .map(([k]) => k),
      };
      // 3. Apply the remaining migration chain through P1-11.
      const t1 = process.hrtime.bigint();
      await applyFiles(db, migrations.slice(cut + 1), MIG_DIR);
      // 4. Apply the current seeds (upgrade brings seed state current).
      await applyFiles(db, SEEDS, join(ROOT, 'supabase'));
      const t2 = process.hrtime.bigint();
      upgradeMs = Number((t2 - t1) / 1000000n);
      // 5. Prove structural equivalence to the canonical full rebuild.
      finalHash = computeSchemaHash((await collectInventory(db)).inventory);
      if (finalHash !== canonical) outcome = 'HASH_MISMATCH';
      boundary.boundary_apply_ms = Number((t1 - t0) / 1000000n);
    } catch (e) {
      outcome = 'FAILED';
      err = e.message;
    } finally {
      await db.end();
      await dropProbe(admin);
    }
    const rec = {
      phase: `P1-${phase}`,
      cutoff_file: migrations[cut],
      boundary,
      upgrade_ms: upgradeMs,
      final_schema_hash: finalHash,
      matches_canonical: finalHash === canonical,
      outcome,
      error: err,
    };
    results.push(rec);
    console.log(
      `P1-${String(phase).padEnd(2)} cutoff=${migrations[cut].slice(0, 14)} boundary_tables=${boundary.tables ?? '?'} upgrade=${upgradeMs}ms hash_match=${rec.matches_canonical} ${outcome}${err ? ' :: ' + err : ''}`
    );
  }
  await admin.end();

  const allPass = results.every((r) => r.outcome === 'ok' && r.matches_canonical);
  console.log(`\ncanonical_hash=${canonical}`);
  console.log(
    `UPGRADE MATRIX: ${results.length} boundaries, ${allPass ? 'ALL PASS' : 'FAILURES PRESENT'}`
  );

  const jsonFlag = process.argv.indexOf('--json');
  if (jsonFlag !== -1) {
    writeFileSync(
      process.argv[jsonFlag + 1],
      JSON.stringify({ canonical_hash: canonical, all_pass: allPass, results }, null, 2)
    );
    console.log('wrote', process.argv[jsonFlag + 1]);
  }
  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  console.error('upgrade-matrix failed:', e.message);
  process.exit(1);
});
