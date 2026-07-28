// ============================================================================
// RootLco — CI migration runner (P1-02-DO-001).
//
// Applies every file in supabase/migrations/ to a CLEAN PostgreSQL database,
// in deterministic filename order, one transaction per migration.
//
// This mirrors what `supabase db reset` does locally, against the plain
// postgres service container used by CI (same PostgreSQL major version).
// It is NOT a replacement for the Supabase CLI in local development — see
// docs/database/migration-standard.md for the environment matrix.
//
// Safety: refuses to run if any module schema already exists, so it can never
// be pointed at a database that holds state. CI always provides a fresh one.
//
// Connection comes from DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD
// (defaults match the Supabase local stack; CI sets its own). No production
// credential is read, and none may ever be introduced here.
// ============================================================================
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'supabase',
  'migrations'
);
const MODULE_SCHEMAS = [
  'org',
  'iam',
  'shared',
  'crm',
  'veh',
  'apt',
  'rec',
  'wo',
  'dia',
  'tech',
  'qms',
  'svc',
  'quo',
  'inv',
  'sal',
  'wty',
  'rpt',
];
const NAME_RULE = /^(\d{4}|\d{14})_[a-z0-9_]+\.sql$/;

// The ledger Supabase itself maintains. This runner used not to write it, which
// meant the resulting database could not say which migrations produced it — and
// the CI check that asked (`SELECT count(*) FROM supabase_migrations.schema_migrations`)
// failed with "relation does not exist" on every hosted run.
//
// Safe to create here precisely because this runner refuses to touch a database
// that already holds module schemas: it only ever sees a clean one, so it can
// never disagree with a ledger the Supabase CLI is managing.
const LEDGER_SCHEMA = 'supabase_migrations';
const LEDGER_TABLE = `${LEDGER_SCHEMA}.schema_migrations`;

/** The version is the numeric prefix, which is what the Supabase CLI records. */
export function versionOf(filename) {
  const m = /^(\d{4}|\d{14})_/.exec(filename);
  if (!m) throw new Error(`Cannot derive a migration version from ${filename}`);
  return m[1];
}

export function listMigrations(dir = MIGRATIONS_DIR) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));
  for (const file of files) {
    if (!NAME_RULE.test(file)) {
      throw new Error(`Migration filename violates the naming standard (${NAME_RULE}): ${file}`);
    }
  }
  return files;
}

async function main() {
  const client = new pg.Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 54322),
    database: process.env.DB_NAME ?? 'postgres',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  });
  await client.connect();
  try {
    const { rows } = await client.query(
      `SELECT nspname FROM pg_namespace WHERE nspname = ANY($1)`,
      [MODULE_SCHEMAS]
    );
    if (rows.length > 0) {
      throw new Error(
        `Refusing to run: module schemas already exist (${rows
          .map((r) => r.nspname)
          .join(', ')}). This runner only targets a clean database.`
      );
    }

    const files = listMigrations();
    if (files.length === 0) throw new Error('No migrations found.');

    await client.query(`CREATE SCHEMA IF NOT EXISTS ${LEDGER_SCHEMA}`);
    await client.query(
      `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (
         version text PRIMARY KEY,
         name    text,
         applied_at timestamptz NOT NULL DEFAULT now()
       )`
    );

    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`Applying ${file} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        // Recorded INSIDE the migration's own transaction, so a rollback takes
        // the ledger row with it. A ledger written afterwards could claim a
        // migration that did not survive.
        await client.query(`INSERT INTO ${LEDGER_TABLE} (version, name) VALUES ($1, $2)`, [
          versionOf(file),
          file,
        ]);
        await client.query('COMMIT');
        console.log('OK');
      } catch (err) {
        await client.query('ROLLBACK');
        console.log('FAILED');
        console.error(`Migration ${file} failed: ${err.message}`);
        process.exitCode = 1;
        return;
      }
    }
    console.log(`All ${files.length} migrations applied cleanly.`);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
