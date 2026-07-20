#!/usr/bin/env node
/**
 * P1-10-SEC — Service Catalog / Pricing / Quotation / Inventory personal-and-
 * financial-data classification guard.
 *
 * Single canonical implementation, run identically locally
 * (`npm run validate:svc-quo-inv-classification`) and in the CI "Database
 * migrations and RLS tests" job. It introspects the live `svc`, `quo`, and `inv`
 * schemas and reconciles them against
 * docs/database/svc-quo-inv-personal-data-classification.json. It FAILS when:
 *   - a column has no classification entry (new unclassified column);
 *   - a registry entry references a column that no longer exists (stale);
 *   - a classification value is outside the approved taxonomy;
 *   - a registry key is duplicated (raw-text scan);
 *   - a column is marked both `restricted` and `searchable` (restricted financial
 *     data must never be projected into unrestricted search metadata);
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
// SVC_CLASSIFICATION_REGISTRY is a TEST-ONLY override so the guard's failure modes
// can be exercised against controlled negative fixtures. CI and local validation
// always use the committed default path.
const REGISTRY =
  process.env.SVC_CLASSIFICATION_REGISTRY ??
  join(HERE, '..', 'docs', 'database', 'svc-quo-inv-personal-data-classification.json');

const cfg = {
  host: process.env.DB_HOST ?? '127.0.0.1',
  port: Number(process.env.DB_PORT ?? 54322),
  database: process.env.DB_NAME ?? 'postgres',
  user: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
};

function fail(msg, items) {
  console.error(`✖ SVC/QUO/INV classification guard FAILED: ${msg}`);
  for (const it of items ?? []) console.error(`    - ${it}`);
  process.exit(1);
}

const raw = readFileSync(REGISTRY, 'utf8');
const doc = JSON.parse(raw);
const allowed = new Set(doc.allowedClassifications);
const registry = doc.columns;

// Duplicate-key detection (JSON.parse silently keeps the last of a duplicate key).
const dupCounts = new Map();
for (const m of raw.matchAll(/"([a-z_]+\.[a-z_]+\.[a-z_]+)"\s*:/g)) {
  dupCounts.set(m[1], (dupCounts.get(m[1]) ?? 0) + 1);
}
const dups = [...dupCounts.entries()].filter(([, n]) => n > 1).map(([k, n]) => `${k} (${n}x)`);
if (dups.length) fail(`duplicate registry entr(y/ies)`, dups);

const client = new pg.Client(cfg);
await client.connect();
let dbRows;
try {
  const { rows } = await client.query(
    `SELECT table_schema || '.' || table_name || '.' || column_name AS col, data_type
       FROM information_schema.columns
      WHERE table_schema IN ('svc', 'quo', 'inv')
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
  fail(`${missing.length} svc/quo/inv column(s) have no classification entry`, missing);
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
    `restricted column(s) marked searchable (would leak restricted financial data to search)`,
    restrictedSearchable
  );
}
if (typeDrift.length) fail(`registry/live data-type drift`, typeDrift);

const restricted = Object.values(registry).filter((m) => m.classification === 'restricted').length;
const searchable = Object.values(registry).filter((m) => m.searchable === true).length;
console.log(
  `✔ SVC/QUO/INV classification guard OK: ${dbSet.size} columns all classified ` +
    `(${restricted} restricted, ${searchable} searchable); registry and live schema reconcile.`
);
