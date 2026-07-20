#!/usr/bin/env node
// ============================================================================
// P1-12 Wave 8.4 — Reproducible Release 2 database baseline manifest + drift detection.
//
// Emits a deterministic manifest of everything that constitutes the Release 2 database
// baseline: the migration file list + per-file sha256, the seed file list + hashes, the
// live schema hash + object inventory, the classification-register hashes, and a single
// baseline fingerprint (sha256 over the manifest). Re-running on the same protected tree +
// DB reproduces the same fingerprint; any drift changes it. Read-only.
//
// Usage: node scripts/db/baseline-manifest.mjs [--json out.json]
// ============================================================================
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import pg from 'pg';
import { collectInventory, computeSchemaHash } from './schema-inventory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sha = (buf) => createHash('sha256').update(buf).digest('hex');
const fileSha = (p) => sha(readFileSync(p));

function hashDir(dir, files) {
  return files.sort().map((f) => ({ file: f, sha256: fileSha(join(dir, f)) }));
}

async function main() {
  // Migrations (ordered) + hashes.
  const migDir = join(ROOT, 'supabase', 'migrations');
  const migrations = hashDir(
    migDir,
    readdirSync(migDir).filter((f) => f.endsWith('.sql'))
  );
  // Seeds (configured order) + hashes.
  const seedFiles = [
    'seed.sql',
    'seeds/01_reference_data.sql',
    'seeds/04_iam_permission_catalog.sql',
    'seeds/05_shared_reference.sql',
    'seeds/06_wo_job_state_graph.sql',
    'seeds/07_inv_units_of_measure.sql',
    'seeds/08_sal_payment_methods.sql',
  ];
  const seeds = seedFiles.map((f) => ({ file: f, sha256: fileSha(join(ROOT, 'supabase', f)) }));
  // Classification registers + hashes (whichever exist).
  const classFiles = readdirSync(join(ROOT, 'docs', 'database')).filter(
    (f) => f.includes('classification') && f.endsWith('.json')
  );
  const classification = classFiles.map((f) => ({
    file: `docs/database/${f}`,
    sha256: fileSha(join(ROOT, 'docs', 'database', f)),
  }));
  // Key documentation hashes.
  const docHash = (rel) => (existsSync(join(ROOT, rel)) ? fileSha(join(ROOT, rel)) : null);

  // Live schema inventory + hash.
  const client = new pg.Client({
    host: process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.PGPORT ?? 54322),
    user: process.env.PGUSER ?? 'postgres',
    password: process.env.PGPASSWORD ?? 'postgres',
    database: process.env.PGDATABASE ?? 'postgres',
  });
  await client.connect();
  const inv = await collectInventory(client);
  await client.end();

  let sourceSha = 'unknown';
  try {
    sourceSha = execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim();
  } catch {
    /* detached/CI */
  }

  const manifest = {
    release: 'Release 2 — Core Business Database',
    phase: 'P1-12',
    source_sha: sourceSha,
    protected_base: 'origin/develop = 5cd16da (P1-11 gate merge #45)',
    postgres_major: 17,
    counts: {
      migrations: migrations.length,
      seeds: seeds.length,
      ...inv.totals,
    },
    schema_hash: computeSchemaHash(inv.inventory),
    migrations,
    seeds,
    classification,
    documentation: {
      data_dictionary: docHash('docs/database/data-dictionary.md'),
    },
    // Filled from the evidence pack — carried, not invented.
    open_decisions: [
      'P1-OD-007',
      'P1-OD-018..024',
      'P1-OD-027',
      'P1-OD-035',
      'P1-OD-036',
      'P1-OD-041',
      'P1-OD-042',
    ],
  };

  // Deterministic baseline fingerprint over the structural manifest (excludes source_sha,
  // which is metadata) so it reproduces across the feature + gate-record commits.
  const { source_sha, ...fingerprintable } = manifest;
  const baseline_fingerprint = sha(JSON.stringify(fingerprintable));
  manifest.baseline_fingerprint = baseline_fingerprint;

  console.log('=== P1-12 Release 2 baseline manifest ===');
  console.log(
    'migrations:',
    migrations.length,
    '| seeds:',
    seeds.length,
    '| schema_hash:',
    manifest.schema_hash
  );
  console.log('counts:', JSON.stringify(manifest.counts));
  console.log('baseline_fingerprint(sha256):', baseline_fingerprint);

  const jsonFlag = process.argv.indexOf('--json');
  if (jsonFlag !== -1) {
    writeFileSync(process.argv[jsonFlag + 1], JSON.stringify(manifest, null, 2));
    console.log('wrote', process.argv[jsonFlag + 1]);
  }
}

main().catch((e) => {
  console.error('baseline-manifest failed:', e.message);
  process.exit(1);
});
