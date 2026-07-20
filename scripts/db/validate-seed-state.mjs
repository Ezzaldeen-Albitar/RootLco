#!/usr/bin/env node
/** Apply declared seeds twice and prove structural-only, idempotent clean state. */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SUPABASE_DIR = resolve(REPOSITORY_ROOT, 'supabase');
const CONFIG_PATH = resolve(SUPABASE_DIR, 'config.toml');
// P1-07-DB-022 / P1-08: crm, veh, apt, rec are swept too — every business-domain
// table must be empty before and after both seed passes (no Vehicle/partner/
// appointment/reception data is EVER seeded).
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
];
const STRUCTURAL_REFERENCE = new Set([
  'shared.currencies',
  'shared.timezones',
  'shared.languages',
  'iam.permissions',
  'shared.retention_classes',
  // Phase 1-9 platform Work Order + Job state graph (structurally mandatory; the
  // transition guards enforce against these rows). Platform scope only.
  'wo.work_order_states',
  'wo.work_order_transitions',
  'wo.job_states',
  'wo.job_transitions',
]);
const PLATFORM_ACTOR = '00000000-0000-4000-8000-000000000001';
const EXPECTED_RETENTION = [
  {
    class_code: 'evidence-audit',
    description: 'Evidence and audit records whose retention is owner- and jurisdiction-defined.',
    min_retention_days: null,
    allows_deletion: true,
    created_by: PLATFORM_ACTOR,
  },
  {
    class_code: 'immutable-financial-history',
    description: 'Issued financial history that is never eligible for deletion.',
    min_retention_days: null,
    allows_deletion: false,
    created_by: PLATFORM_ACTOR,
  },
  {
    class_code: 'operational',
    description:
      'Current working data whose configured retention is owner- and jurisdiction-defined.',
    min_retention_days: null,
    allows_deletion: true,
    created_by: PLATFORM_ACTOR,
  },
  {
    class_code: 'personal-data',
    description: 'Personal data governed by configured privacy and jurisdiction obligations.',
    min_retention_days: null,
    allows_deletion: true,
    created_by: PLATFORM_ACTOR,
  },
  {
    class_code: 'temporary',
    description: 'Short-lived technical data eligible after its explicit expiry.',
    min_retention_days: 0,
    allows_deletion: true,
    created_by: PLATFORM_ACTOR,
  },
];

function declaredSeedPaths() {
  const config = readFileSync(CONFIG_PATH, 'utf8');
  const seedBlock = config.match(/\[db\.seed\]([\s\S]*?)(?=\r?\n\[|$)/);
  if (!seedBlock) throw new Error('supabase/config.toml has no [db.seed] block');
  const assignment = seedBlock[1].match(/sql_paths\s*=\s*\[([\s\S]*?)\]/);
  if (!assignment) throw new Error('[db.seed] has no sql_paths array');
  const paths = [...assignment[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  if (paths.length === 0) throw new Error('[db.seed].sql_paths declares no seed files');
  return paths.map((path) => ({ declared: path, absolute: resolve(SUPABASE_DIR, path) }));
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function baseTables(client) {
  const { rows } = await client.query(
    `SELECT table_schema, table_name
       FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema = ANY($1::text[])
      ORDER BY table_schema, table_name`,
    [MODULE_SCHEMAS]
  );
  return rows;
}

async function tableCounts(client, tables) {
  const counts = {};
  for (const table of tables) {
    const fq = `${table.table_schema}.${table.table_name}`;
    const sql = `SELECT count(*)::int AS count FROM ${quoteIdentifier(
      table.table_schema
    )}.${quoteIdentifier(table.table_name)}`;
    const { rows } = await client.query(sql);
    counts[fq] = rows[0].count;
  }
  return counts;
}

function assertBusinessEmpty(counts, stage) {
  const violations = Object.entries(counts)
    .filter(([table, count]) => !STRUCTURAL_REFERENCE.has(table) && count !== 0)
    .map(([table, count]) => `${table}=${count}`);
  if (violations.length > 0) {
    throw new Error(`Business tables are not empty ${stage}: ${violations.join(', ')}`);
  }
}

async function applySeedPass(client, seeds, pass) {
  for (const seed of seeds) {
    let sql;
    try {
      sql = readFileSync(seed.absolute, 'utf8');
    } catch (error) {
      throw new Error(`Cannot read declared seed ${seed.declared}: ${error.message}`);
    }
    process.stdout.write(`Pass ${pass}: ${seed.declared} ... `);
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('COMMIT');
      console.log('OK');
    } catch (error) {
      await client.query('ROLLBACK');
      console.log('FAILED');
      throw new Error(`Seed ${seed.declared} failed on pass ${pass}: ${error.message}`);
    }
  }
}

async function assertRetention(client) {
  const { rows } = await client.query(
    `SELECT class_code, description, min_retention_days, allows_deletion,
            created_by::text AS created_by
       FROM shared.retention_classes
      ORDER BY class_code`
  );
  if (JSON.stringify(rows) !== JSON.stringify(EXPECTED_RETENTION)) {
    throw new Error(
      `Retention classes do not match the five governed values.\nExpected: ${JSON.stringify(
        EXPECTED_RETENTION,
        null,
        2
      )}\nActual: ${JSON.stringify(rows, null, 2)}`
    );
  }
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
    const seeds = declaredSeedPaths();
    const tables = await baseTables(client);
    const cleanCounts = await tableCounts(client, tables);
    assertBusinessEmpty(cleanCounts, 'before seed execution');

    await applySeedPass(client, seeds, 1);
    const firstCounts = await tableCounts(client, tables);
    assertBusinessEmpty(firstCounts, 'after the first seed pass');
    await assertRetention(client);

    await applySeedPass(client, seeds, 2);
    const secondCounts = await tableCounts(client, tables);
    assertBusinessEmpty(secondCounts, 'after the second seed pass');
    await assertRetention(client);

    if (JSON.stringify(secondCounts) !== JSON.stringify(firstCounts)) {
      const changes = Object.keys(firstCounts)
        .filter((table) => firstCounts[table] !== secondCounts[table])
        .map((table) => `${table}: ${firstCounts[table]} -> ${secondCounts[table]}`);
      throw new Error(`Seed pass 2 changed table counts: ${changes.join(', ')}`);
    }
    console.log(
      `OK seed state: ${seeds.length} declared files applied twice; five exact retention classes; every business table empty; counts idempotent.`
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`FAIL seed state: ${error.message}`);
  process.exitCode = 1;
});
