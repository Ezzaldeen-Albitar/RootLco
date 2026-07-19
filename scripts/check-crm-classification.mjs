#!/usr/bin/env node
/**
 * P1-06-SEC-001 / P1-06-DO-001 — CRM personal-data classification guard.
 *
 * Single canonical implementation, run identically locally
 * (`npm run validate:crm-classification`) and in the CI "Database migrations and
 * RLS tests" job (which already applies every migration and has `pg`). It
 * introspects the live `crm` schema and reconciles it against the committed
 * registry `docs/database/crm-personal-data-classification.json`. It FAILS when:
 *   - a crm column has no classification entry (a new unclassified column blocks
 *     the review gate);
 *   - a registry entry refers to a column that no longer exists;
 *   - a classification value is outside the approved taxonomy;
 *   - a column is marked both `restricted` and `searchable` (restricted data must
 *     never be projected into unrestricted search metadata) without this guard
 *     failing loudly.
 *
 * Connection uses the same env contract as the DB test harness; defaults are the
 * public Supabase local values (never a real secret).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = join(HERE, '..', 'docs', 'database', 'crm-personal-data-classification.json');

const cfg = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 54322),
  database: process.env.DB_NAME ?? 'postgres',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
};

function fail(msg, items) {
  console.error(`✖ CRM classification guard FAILED: ${msg}`);
  for (const it of items ?? []) console.error(`    - ${it}`);
  process.exit(1);
}

const doc = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const allowed = new Set(doc.allowedClassifications);
const registry = doc.columns;

const client = new pg.Client(cfg);
await client.connect();
let dbColumns;
try {
  const { rows } = await client.query(
    `SELECT table_name || '.' || column_name AS col
       FROM information_schema.columns
      WHERE table_schema = 'crm'
      ORDER BY 1`
  );
  dbColumns = rows.map((r) => r.col);
} finally {
  await client.end();
}

const dbSet = new Set(dbColumns);
const regSet = new Set(Object.keys(registry));

const missing = dbColumns.filter((c) => !regSet.has(c));
if (missing.length) {
  fail(`${missing.length} crm column(s) have no classification entry`, missing);
}

const stale = [...regSet].filter((c) => !dbSet.has(c));
if (stale.length) {
  fail(`${stale.length} registry entr(y/ies) reference a non-existent column`, stale);
}

const badClass = [];
const restrictedSearchable = [];
for (const [col, meta] of Object.entries(registry)) {
  if (!meta || !allowed.has(meta.classification)) {
    badClass.push(`${col} -> ${meta && meta.classification}`);
  }
  if (meta && meta.classification === 'restricted' && meta.searchable === true) {
    restrictedSearchable.push(col);
  }
}
if (badClass.length) fail(`invalid classification value(s)`, badClass);
if (restrictedSearchable.length) {
  fail(
    `restricted column(s) marked searchable (would leak restricted data to search)`,
    restrictedSearchable
  );
}

const restricted = Object.values(registry).filter((m) => m.classification === 'restricted').length;
console.log(
  `✔ CRM classification guard OK: ${dbColumns.length} crm columns all classified ` +
    `(${restricted} restricted); registry and live schema reconcile.`
);
