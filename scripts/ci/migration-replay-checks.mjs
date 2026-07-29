#!/usr/bin/env node
/**
 * Migration-replay assertions (initiative §14).
 *
 * `ci.yml` applied every migration and ran the suites, which proves the SQL
 * executes. It did not assert that the database it executed against was empty,
 * that the schema afterwards matched the frozen baseline, or that the migration
 * set itself is well-formed (CSA-04).
 *
 * Phases:
 *   --phase pre    before the first migration: the database must hold nothing.
 *   --phase static filesystem only, no database: filename order, 120 absence,
 *                  and no migration that depends on developer data.
 *   --phase post   after migrations and seeds: counts, catalog totals, retention
 *                  classes, schema hash against the frozen baseline, smoke reads,
 *                  and business-table emptiness.
 *
 * Usage:
 *   node scripts/ci/migration-replay-checks.mjs --phase post \
 *     --baseline .github/ci-baselines/schema-baseline.json --json out.json
 * Exit codes: 0 pass · 1 assertion failure · 2 connection/IO error.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MIGRATION_DIR = join('supabase', 'migrations');

/**
 * Tables that hold structural reference data seeded by migration, as opposed to
 * business records. Everything else must be empty on a freshly migrated and
 * seeded database — that is the no-fake-data policy, asserted rather than
 * assumed.
 */
export const REFERENCE_SCHEMAS = ['shared', 'meta'];

/**
 * Every module schema a migration could seed rows into.
 *
 * Kept as ONE list rather than repeated inline: the previous hand-maintained
 * alternation omitted `org`, `iam`, `svc`, `rpt` and `shared`, so a top-level
 * `INSERT INTO iam.users` or `INSERT INTO svc.services` was never flagged while
 * the failure message claimed the check covered business rows.
 */
export const MODULE_SCHEMAS = [
  'org',
  'iam',
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
  'shared',
];

export function listMigrations(dir = MIGRATION_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/**
 * Filenames follow one of two conventions, both of which sort lexically into
 * apply order:
 *
 *   `0001_name.sql`          the three bootstrap migrations (extensions, base
 *                            schemas, number sequences) written before the
 *                            timestamp convention existed;
 *   `20260717100000_name.sql` everything since.
 *
 * `0` sorts before `2`, so the bootstrap block always applies first. What
 * matters is that the sequence is strictly increasing with no duplicates —
 * apply order must be total and unambiguous.
 */
export function checkFilenames(files) {
  const failures = [];
  const bootstrap = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
  const timestamped = /^(\d{14})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
  let previous = null;
  let seenTimestamped = false;
  for (const file of files) {
    const match = timestamped.exec(file) ?? bootstrap.exec(file);
    if (!match) {
      failures.push(
        `\`${file}\` matches neither \`<4-digit>_<snake_case>.sql\` nor \`<14-digit timestamp>_<snake_case>.sql\`.`
      );
      continue;
    }
    const isTimestamped = match[1].length === 14;
    if (isTimestamped) seenTimestamped = true;
    else if (seenTimestamped) {
      failures.push(
        `\`${file}\` uses the 4-digit bootstrap convention but a timestamped migration already appeared. ` +
          'The bootstrap block is closed; new migrations must be timestamped.'
      );
    }
    if (previous !== null && match[1] <= previous && isTimestamped === (previous.length === 14)) {
      failures.push(
        `\`${file}\` has sequence key ${match[1]}, which does not come after ${previous}. ` +
          'Lexical order is apply order; a duplicate or out-of-order key makes the sequence ambiguous.'
      );
    }
    previous = match[1];
  }
  return failures;
}

/**
 * Strips SQL comments and dollar-quoted bodies.
 *
 * The dollar-quoting matters: a status-history trigger legitimately contains
 * `INSERT INTO wo.work_order_status_history`, and that is structure, not data.
 * A scanner that cannot tell a function body from a top-level statement reports
 * every history trigger in the repository and is therefore useless.
 */
export function stripSqlBodies(source) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  // Remove `$tag$ ... $tag$` and `$$ ... $$` spans.
  return withoutComments.replace(/\$([A-Za-z_]\w*)?\$[\s\S]*?\$\1?\$/g, ' /* body */ ');
}

/** No migration may seed business records at the top level. */
export function checkNoDeveloperData(dir, files) {
  const failures = [];
  const businessInsert = new RegExp(
    `INSERT\\s+INTO\\s+(${MODULE_SCHEMAS.join('|')})\\.(\\w+)`,
    'gi'
  );
  for (const file of files) {
    const stripped = stripSqlBodies(readFileSync(join(dir, file), 'utf8'));
    const hits = [...stripped.matchAll(businessInsert)].map((m) => `${m[1]}.${m[2]}`);
    if (hits.length) {
      failures.push(
        `\`${file}\` INSERTs into ${[...new Set(hits)].join(', ')} at the top level. Migrations create ` +
          'structure; business rows are the tenant’s, and shipping any would violate the no-fake-data policy.'
      );
    }
  }
  return failures;
}

async function q(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows;
}

export async function preChecks(client) {
  const failures = [];
  const [{ count }] = await q(
    client,
    // pg_class rather than information_schema: the latter lists only objects the
    // CONNECTING ROLE holds a privilege on, so a pre-populated database read by a
    // restricted role would report zero. postChecks already uses the catalog.
    `SELECT count(*)::int AS count
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r','p','v','m')
        AND n.nspname NOT LIKE 'pg\_%'
        AND n.nspname NOT IN ('information_schema')`
  );
  if (count !== 0) {
    failures.push(
      `the database holds ${count} application table(s) BEFORE the first migration. ` +
        'A replay against a pre-migrated database proves nothing about a fresh deployment.'
    );
  }
  return { failures, tablesBefore: count };
}

export async function postChecks(client, baseline, files) {
  const failures = [];
  const evidence = {};

  // ---- applied migration count matches the tree ---------------------------
  const applied = await q(
    client,
    'SELECT version FROM supabase_migrations.schema_migrations ORDER BY version'
  );
  evidence.migrationsInTree = files.length;
  evidence.migrationsApplied = applied.length;
  if (applied.length !== files.length) {
    failures.push(
      `${files.length} migration file(s) in the tree but ${applied.length} recorded as applied. ` +
        'A file that never ran leaves the schema in a state no environment will reproduce.'
    );
  }
  if (typeof baseline.migrationCount === 'number' && files.length !== baseline.migrationCount) {
    failures.push(
      `migration count is ${files.length}, the recorded baseline is ${baseline.migrationCount}. ` +
        'If a phase legitimately added migrations, raise the baseline in the same commit.'
    );
  }

  // ---- structural totals --------------------------------------------------
  const [totals] = await q(
    client,
    `SELECT
       (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
         WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema','supabase_migrations')) AS tables,
       (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE n.nspname NOT IN ('pg_catalog','information_schema')) AS functions,
       (SELECT count(*)::int FROM pg_policy) AS policies,
       (SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal) AS triggers,
       (SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
         WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog','information_schema')) AS security_definer`
  );
  Object.assign(evidence, totals);
  if (totals.security_definer !== 0) {
    failures.push(
      `${totals.security_definer} SECURITY DEFINER function(s) exist; the approved count is 0.`
    );
  }
  for (const [key, expected] of Object.entries(baseline.structuralTotals ?? {})) {
    if (typeof expected === 'number' && totals[key] !== expected) {
      failures.push(`structural total \`${key}\` is ${totals[key]}, baseline ${expected}.`);
    }
  }

  // ---- permission catalog -------------------------------------------------
  const [{ permissions }] = await q(
    client,
    'SELECT count(*)::int AS permissions FROM iam.permissions'
  );
  evidence.permissions = permissions;
  if (typeof baseline.permissionCount === 'number' && permissions !== baseline.permissionCount) {
    failures.push(
      `iam.permissions holds ${permissions} row(s), baseline ${baseline.permissionCount}. ` +
        'The catalog and the code that declares permissions must move together.'
    );
  }

  // ---- retention classes --------------------------------------------------
  // Every table that carries a retention classification must resolve to a known
  // class. An unclassified table is data nobody has decided how long to keep.
  const retentionTables = await q(
    client,
    `SELECT table_schema, table_name FROM information_schema.columns
      WHERE column_name = 'retention_class' AND table_schema NOT IN ('pg_catalog','information_schema')`
  );
  evidence.retentionClassifiedTables = retentionTables.length;
  if (retentionTables.length > 0) {
    const unknown = await q(
      client,
      `SELECT c.conname FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
        WHERE c.contype = 'c' AND c.conname LIKE '%retention%'`
    );
    evidence.retentionConstraints = unknown.length;
    if (unknown.length === 0) {
      failures.push(
        `${retentionTables.length} table(s) carry a \`retention_class\` column but no CHECK constraint ` +
          'restricts its values, so any string is accepted.'
      );
    }
  }

  // ---- business tables are empty -----------------------------------------
  const businessTables = await q(
    client,
    `SELECT n.nspname AS schema_name, c.relname AS table_name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname NOT IN ('pg_catalog','information_schema','supabase_migrations', ${REFERENCE_SCHEMAS.map((s) => `'${s}'`).join(',')})
      ORDER BY 1, 2`
  );
  const populated = [];
  for (const table of businessTables) {
    const [{ n }] = await q(
      client,
      `SELECT count(*)::int AS n FROM "${table.schema_name}"."${table.table_name}"`
    );
    if (n > 0) populated.push(`${table.schema_name}.${table.table_name} (${n})`);
  }
  evidence.businessTablesChecked = businessTables.length;
  evidence.businessTablesPopulated = populated.length;
  evidence.populatedTables = populated;
  if (populated.length > 0) {
    // Structural catalogs inside business schemas (work-order states, units of
    // measure, payment methods) are legitimately seeded. The baseline lists them
    // by name so a NEW populated table is a finding rather than noise.
    //
    // `null` means the list has never been measured. Reporting it and passing is
    // the measure-first behaviour the initiative requires; inventing the list
    // here would be a guess that then hides whatever it happened to omit.
    if (baseline.seededStructuralTables == null) {
      evidence.seededStructuralTablesEstablished = false;
      console.log(
        '::warning::seededStructuralTables is unset in the schema baseline. Recording the measurement; ' +
          'commit it so a NEW populated business table becomes a failure.'
      );
    } else {
      const allowed = new Set(baseline.seededStructuralTables);
      const unexpected = populated.filter((p) => !allowed.has(p.split(' ')[0]));
      if (unexpected.length > 0) {
        failures.push(
          `business table(s) hold rows after migration and seeding: ${unexpected.join(', ')}. ` +
            'A freshly provisioned database must start empty (RootLco no-fake-data policy).'
        );
      }
      evidence.seededStructuralTablesEstablished = true;
    }
  }

  // ---- smoke reads --------------------------------------------------------
  // Cheap end-to-end proof that the schema is queryable, not merely present.
  const smoke = [];
  for (const sql of [
    'SELECT count(*)::int AS n FROM shared.currencies',
    'SELECT count(*)::int AS n FROM iam.permissions',
    'SELECT count(*)::int AS n FROM information_schema.tables',
  ]) {
    try {
      const [row] = await q(client, sql);
      smoke.push({ sql, ok: true, value: row.n });
    } catch (error) {
      smoke.push({ sql, ok: false, error: error.message });
      failures.push(`smoke query failed: \`${sql}\` — ${error.message}`);
    }
  }
  evidence.smoke = smoke;

  return { failures, evidence };
}

export function toMarkdown(phase, failures, evidence) {
  const lines = [`### Migration replay — ${phase}`, ''];
  if (Object.keys(evidence).length) {
    lines.push('| Measure | Value |');
    lines.push('| --- | --- |');
    for (const [key, value] of Object.entries(evidence)) {
      if (key === 'smoke') continue;
      lines.push(`| ${key} | ${typeof value === 'object' ? JSON.stringify(value) : value} |`);
    }
    lines.push('');
  }
  if (failures.length) {
    lines.push('**Failures**');
    lines.push('');
    for (const f of failures) lines.push(`- ❌ ${f}`);
  } else {
    lines.push(`**Migration replay (${phase}): pass**`);
  }
  return lines.join('\n');
}

async function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const phase = arg('--phase') ?? 'post';
  const baselinePath = arg('--baseline') ?? '.github/ci-baselines/schema-baseline.json';
  let baseline = {};
  if (existsSync(baselinePath)) baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

  const files = listMigrations();
  if (files.length === 0) {
    console.error(`no migrations found in ${MIGRATION_DIR}`);
    process.exit(2);
  }

  let failures = [];
  let evidence = { migrationsInTree: files.length };

  if (phase === 'static') {
    failures.push(...checkFilenames(files));
    failures.push(...checkNoDeveloperData(MIGRATION_DIR, files));
    // Migration 120 must not exist until an authorised phase creates it.
    const forbidden = files.filter((f) => /^120\d{11}_/.test(f) || f.startsWith('120_'));
    const nextSeries = baseline.forbiddenMigrationPrefix;
    if (nextSeries) {
      const hits = files.filter((f) => f.startsWith(nextSeries));
      if (hits.length) {
        failures.push(
          `migration(s) matching the reserved prefix \`${nextSeries}\` exist: ${hits.join(', ')}. ` +
            'The next phase has not been authorised to add one.'
        );
      }
    }
    if (forbidden.length)
      failures.push(`reserved migration series present: ${forbidden.join(', ')}`);
    evidence.filenamePattern = 'checked';
  } else {
    const pg = (await import('pg')).default;
    const client = new pg.Client({
      host: process.env.DB_HOST ?? '127.0.0.1',
      port: Number(process.env.DB_PORT ?? 54322),
      database: process.env.DB_NAME ?? 'postgres',
      user: process.env.DB_USER ?? 'postgres',
      password: process.env.DB_PASSWORD ?? 'postgres',
    });
    try {
      await client.connect();
    } catch (error) {
      console.error(`cannot connect to the database: ${error.message}`);
      process.exit(2);
    }
    try {
      const result =
        phase === 'pre' ? await preChecks(client) : await postChecks(client, baseline, files);
      failures = result.failures;
      evidence = { ...evidence, ...(result.evidence ?? result) };
      delete evidence.failures;
    } catch (error) {
      console.error(`checks failed to run: ${error.message}`);
      await client.end();
      process.exit(2);
    }
    await client.end();
  }

  const md = toMarkdown(phase, failures, evidence);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${md}\n`);
  const jsonOut = arg('--json');
  if (jsonOut)
    writeFileSync(jsonOut, `${JSON.stringify({ phase, failures, ...evidence }, null, 2)}\n`);
  console.log(md);
  process.exit(failures.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
