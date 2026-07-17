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
const MODULE_SCHEMAS = ['org', 'iam', 'shared', 'crm', 'veh'];
const NAME_RULE = /^(\d{4}|\d{14})_[a-z0-9_]+\.sql$/;

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

    for (const file of files) {
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      process.stdout.write(`Applying ${file} ... `);
      try {
        await client.query('BEGIN');
        await client.query(sql);
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
