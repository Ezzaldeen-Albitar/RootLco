#!/usr/bin/env node
// ============================================================================
// P1-12 — Authoritative live schema inventory + deterministic schema hash.
//
// Read-only introspection of every RootLco business/module schema from the live
// Postgres catalog. Emits (a) a stable JSON inventory (sorted, deterministic),
// (b) per-schema and total object counts, and (c) a sha256 "schema hash" over the
// canonicalized structural inventory. Used by the Wave 2 structural reviews, the
// Wave 8 baseline manifest, and baseline-drift detection.
//
// Usage:
//   node scripts/db/schema-inventory.mjs                 # prints summary
//   node scripts/db/schema-inventory.mjs --json out.json # also writes full JSON
//   node scripts/db/schema-inventory.mjs --hash-only     # prints only the schema hash
//
// Connection: PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE env or the local default
// (127.0.0.1:54322 postgres/postgres/postgres). Never writes to the database.
// ============================================================================
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const MODULE_SCHEMAS = [
  'org',
  'iam',
  'shared',
  'crm',
  'veh',
  'apt',
  'rec',
  'wo',
  'tech',
  'dia',
  'qms',
  'svc',
  'quo',
  'inv',
  'sal',
  'wty',
  'rpt',
];

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 54322),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};

const sortKeys = (v) => {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.keys(v)
      .sort()
      .reduce((o, k) => ((o[k] = sortKeys(v[k])), o), {});
  }
  return v;
};

export { MODULE_SCHEMAS };

/** Deterministic sha256 over the structural inventory (seed/data-independent). */
export function computeSchemaHash(inventory) {
  return createHash('sha256')
    .update(JSON.stringify(sortKeys(inventory)))
    .digest('hex');
}

/**
 * Collects the full structural inventory for the module schemas from an already-connected
 * pg client. Reusable by the CLI and by the phase-upgrade-matrix harness (disposable DBs).
 */
export async function collectInventory(client, S = MODULE_SCHEMAS) {
  const rows = async (sql, params = [S]) => (await client.query(sql, params)).rows;

  // Tables + columns (types, defaults, generated, nullability).
  const columns = await rows(
    `SELECT c.table_schema AS schema, c.table_name AS table, c.column_name AS column,
            c.data_type, c.numeric_precision, c.numeric_scale, c.is_nullable,
            c.column_default, c.is_generated, c.identity_generation
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema=c.table_schema AND t.table_name=c.table_name AND t.table_type='BASE TABLE'
      WHERE c.table_schema = ANY($1)
      ORDER BY 1,2, c.ordinal_position`
  );

  // Constraints (pk/uk/fk/check) + exclusion, with definitions.
  const constraints = await rows(
    `SELECT n.nspname AS schema, rel.relname AS table, con.conname AS name,
            CASE con.contype WHEN 'p' THEN 'primary_key' WHEN 'u' THEN 'unique'
                 WHEN 'f' THEN 'foreign_key' WHEN 'c' THEN 'check'
                 WHEN 'x' THEN 'exclusion' ELSE con.contype::text END AS type,
            con.convalidated AS validated,
            CASE WHEN con.contype='f' THEN con.confdeltype ELSE NULL END AS on_delete,
            pg_get_constraintdef(con.oid) AS definition
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid=con.conrelid
       JOIN pg_namespace n ON n.oid=rel.relnamespace
      WHERE n.nspname = ANY($1)
      ORDER BY 1,2,3`
  );

  // Indexes (definitions).
  const indexes = await rows(
    `SELECT schemaname AS schema, tablename AS table, indexname AS name, indexdef AS definition
       FROM pg_indexes WHERE schemaname = ANY($1) ORDER BY 1,2,3`
  );

  // Functions (security mode, volatility, search_path config).
  const functions = await rows(
    `SELECT n.nspname AS schema, p.proname AS name,
            pg_get_function_identity_arguments(p.oid) AS args,
            p.prosecdef AS security_definer,
            CASE p.provolatile WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable' ELSE 'volatile' END AS volatility,
            l.lanname AS language, p.proconfig AS config
       FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       JOIN pg_language l ON l.oid=p.prolang
      WHERE n.nspname = ANY($1) ORDER BY 1,2,3`
  );

  // Triggers.
  const triggers = await rows(
    `SELECT n.nspname AS schema, c.relname AS table, t.tgname AS name,
            pg_get_triggerdef(t.oid) AS definition
       FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname = ANY($1) AND NOT t.tgisinternal ORDER BY 1,2,3`
  );

  // RLS status + policies.
  const rls = await rows(
    `SELECT n.nspname AS schema, c.relname AS table, c.relrowsecurity AS rls_enabled,
            c.relforcerowsecurity AS rls_forced
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind='r' ORDER BY 1,2`
  );
  const policies = await rows(
    `SELECT n.nspname AS schema, c.relname AS table, p.polname AS name,
            CASE p.polcmd WHEN 'r' THEN 'select' WHEN 'a' THEN 'insert' WHEN 'w' THEN 'update'
                 WHEN 'd' THEN 'delete' ELSE 'all' END AS command,
            pg_get_expr(p.polqual, p.polrelid) AS using_expr,
            pg_get_expr(p.polwithcheck, p.polrelid) AS check_expr
       FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname = ANY($1) ORDER BY 1,2,3`
  );

  // Grants (table-level) to the app roles.
  const grants = await rows(
    `SELECT table_schema AS schema, table_name AS table, grantee, privilege_type AS privilege
       FROM information_schema.role_table_grants
      WHERE table_schema = ANY($1) AND grantee LIKE 'app\\_%'
      ORDER BY 1,2,3,4`
  );

  // Views + owners.
  const views = await rows(
    `SELECT schemaname AS schema, viewname AS name FROM pg_views WHERE schemaname = ANY($1) ORDER BY 1,2`
  );
  const owners = await rows(
    `SELECT n.nspname AS schema, c.relname AS object, pg_get_userbyid(c.relowner) AS owner, c.relkind AS kind
       FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname = ANY($1) AND c.relkind IN ('r','v') ORDER BY 1,2`
  );

  const inventory = sortKeys({
    module_schemas: S,
    columns,
    constraints,
    indexes,
    functions,
    triggers,
    rls,
    policies,
    grants,
    views,
    owners,
  });

  // Per-schema + total counts.
  const bySchema = {};
  for (const s of S)
    bySchema[s] = {
      tables: new Set(columns.filter((r) => r.schema === s).map((r) => r.table)).size,
      columns: columns.filter((r) => r.schema === s).length,
      functions: functions.filter((r) => r.schema === s).length,
      triggers: triggers.filter((r) => r.schema === s).length,
      policies: policies.filter((r) => r.schema === s).length,
      indexes: indexes.filter((r) => r.schema === s).length,
    };
  const totals = {
    schemas: S.length,
    tables: new Set(columns.map((r) => `${r.schema}.${r.table}`)).size,
    columns: columns.length,
    functions: functions.length,
    triggers: triggers.length,
    policies: policies.length,
    indexes: indexes.length,
    constraints: constraints.length,
    views: views.length,
    security_definer: functions.filter((r) => r.security_definer).length,
    rls_tables_not_forced: rls.filter((r) => !r.rls_forced).length,
  };

  const schema_hash = computeSchemaHash(inventory);
  return { inventory, bySchema, totals, schema_hash };
}

async function main() {
  const client = new pg.Client(cfg);
  await client.connect();
  let result;
  try {
    result = await collectInventory(client);
  } finally {
    await client.end();
  }
  const { totals, bySchema, schema_hash, inventory } = result;
  const jsonFlag = process.argv.indexOf('--json');
  if (process.argv.includes('--hash-only')) {
    console.log(schema_hash);
  } else {
    console.log('=== P1-12 live schema inventory ===');
    console.log('totals:', JSON.stringify(totals));
    console.log(
      'per-schema tables:',
      MODULE_SCHEMAS.map((s) => `${s}:${bySchema[s].tables}`).join(' ')
    );
    console.log('schema_hash(sha256):', schema_hash);
  }
  if (jsonFlag !== -1) {
    const out = process.argv[jsonFlag + 1];
    writeFileSync(
      out,
      JSON.stringify(
        { generated_from: 'live-catalog', totals, bySchema, schema_hash, inventory },
        null,
        2
      )
    );
    if (!process.argv.includes('--hash-only')) console.log('wrote', out);
  }
}

// Run as CLI only when invoked directly (not when imported).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error('schema-inventory failed:', e.message);
    process.exit(1);
  });
}
