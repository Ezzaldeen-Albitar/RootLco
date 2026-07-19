#!/usr/bin/env node
/**
 * P1-07-SEC-003 / P1-07-DO-001 — Vehicle personal-data classification guard.
 *
 * Single canonical implementation, run identically locally
 * (`npm run validate:veh-classification`) and in the CI "Database migrations and
 * RLS tests" job (which already applies every migration and has `pg`). It
 * introspects the live `veh` schema and reconciles it against the committed
 * registry `docs/database/veh-personal-data-classification.json`. It FAILS when:
 *   - a veh column has no classification entry (a new unclassified column blocks
 *     the review gate);
 *   - a registry entry refers to a column that no longer exists (stale);
 *   - a classification value is outside the approved taxonomy;
 *   - a column is marked both `restricted` and `searchable` (restricted data must
 *     never be projected into unrestricted search metadata);
 *   - the registry `dataType` disagrees with the live column type (schema drift).
 *
 * Connection uses the same env contract as the DB test harness; defaults are the
 * public Supabase local values (never a real secret).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const REGISTRY = join(HERE, '..', 'docs', 'database', 'veh-personal-data-classification.json');

const cfg = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 54322),
  database: process.env.DB_NAME ?? 'postgres',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
};

function fail(msg, items) {
  console.error(`✖ VEH classification guard FAILED: ${msg}`);
  for (const it of items ?? []) console.error(`    - ${it}`);
  process.exit(1);
}

const doc = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const allowed = new Set(doc.allowedClassifications);
const registry = doc.columns;

const client = new pg.Client(cfg);
await client.connect();
let dbRows;
try {
  const { rows } = await client.query(
    `SELECT table_name || '.' || column_name AS col, data_type
       FROM information_schema.columns
      WHERE table_schema = 'veh'
      ORDER BY 1`
  );
  dbRows = rows;
} finally {
  await client.end();
}

const dbTypes = new Map(dbRows.map((r) => [r.col, r.data_type]));
const dbSet = new Set(dbTypes.keys());
const regSet = new Set(Object.keys(registry));

const missing = [...dbSet].filter((c) => !regSet.has(c));
if (missing.length) {
  fail(`${missing.length} veh column(s) have no classification entry`, missing);
}

const stale = [...regSet].filter((c) => !dbSet.has(c));
if (stale.length) {
  fail(`${stale.length} registry entr(y/ies) reference a non-existent column`, stale);
}

const badClass = [];
const restrictedSearchable = [];
const typeDrift = [];
for (const [col, meta] of Object.entries(registry)) {
  if (!meta || !allowed.has(meta.classification)) {
    badClass.push(`${col} -> ${meta && meta.classification}`);
  }
  if (meta && meta.classification === 'restricted' && meta.searchable === true) {
    restrictedSearchable.push(col);
  }
  if (meta && meta.dataType && meta.dataType !== dbTypes.get(col)) {
    typeDrift.push(`${col}: registry ${meta.dataType} != live ${dbTypes.get(col)}`);
  }
}
if (badClass.length) fail(`invalid classification value(s)`, badClass);
if (restrictedSearchable.length) {
  fail(
    `restricted column(s) marked searchable (would leak restricted data to search)`,
    restrictedSearchable
  );
}
if (typeDrift.length) fail(`registry/live data-type drift`, typeDrift);

const restricted = Object.values(registry).filter((m) => m.classification === 'restricted').length;
const searchable = Object.values(registry).filter((m) => m.searchable === true).length;
console.log(
  `✔ VEH classification guard OK: ${dbSet.size} veh columns all classified ` +
    `(${restricted} restricted, ${searchable} searchable); registry and live schema reconcile.`
);
