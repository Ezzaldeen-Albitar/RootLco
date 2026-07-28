#!/usr/bin/env node
/**
 * Backup and restore drill (initiative §27).
 *
 * `scripts/db/backup-restore-drill.sh` exists and is real, but it is written
 * against the LOCAL Supabase Docker stack (`docker exec supabase_db_RootLco`,
 * `npx supabase db reset`) and cannot run on a hosted runner. This is the
 * hosted-runner equivalent, against an EPHEMERAL service container.
 *
 * The drill only means something if the restore is verified against the source
 * rather than merely completing without error. So it proves three things:
 *
 *   1. the restored SCHEMA HASH equals the source's — structure survived;
 *   2. the restored ROW COUNTS equal the source's, table by table — data
 *      survived, including the structural reference catalogs;
 *   3. application-shaped queries still answer on the restored database — it is
 *      usable, not merely present.
 *
 * PRODUCTION IS NEVER TOUCHED. There is no production connection in this
 * repository, no workflow holds one, and this script refuses to run against any
 * host it did not create the target database on.
 *
 * Usage: node scripts/ci/backup-restore-drill.mjs [--json out.json] [--markdown out.md]
 * Exit codes: 0 restore verified · 1 divergence · 2 tooling error.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdtempSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const HOST = process.env.DB_HOST ?? '127.0.0.1';
const PORT = process.env.DB_PORT ?? '54322';
const USER = process.env.DB_USER ?? 'postgres';
const SOURCE_DB = process.env.DB_NAME ?? 'postgres';
const RESTORE_DB = 'rootlco_restore_probe';

/** Refuses to operate anywhere that is not an ephemeral local container. */
export function assertEphemeralTarget(host) {
  const allowed = ['127.0.0.1', 'localhost', '::1', 'postgres'];
  if (!allowed.includes(host)) {
    throw new Error(
      `refusing to run a destructive drill against host "${host}". ` +
        'This drill drops and recreates a database and may only target an ephemeral local container.'
    );
  }
}

function psql(database, sql, extraArgs = []) {
  return execFileSync(
    'psql',
    ['-h', HOST, '-p', String(PORT), '-U', USER, '-d', database, '-tAc', sql, ...extraArgs],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  ).trim();
}

/** Row counts for every application table, as the control totals. */
export function tableCounts(database) {
  const rows = psql(
    database,
    `SELECT n.nspname || '.' || c.relname
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'r'
        AND n.nspname NOT IN ('pg_catalog','information_schema','supabase_migrations')
      ORDER BY 1`
  )
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const counts = {};
  for (const qualified of rows) {
    const [schema, table] = qualified.split('.');
    counts[qualified] = Number(psql(database, `SELECT count(*) FROM "${schema}"."${table}"`));
  }
  return counts;
}

export function compareCounts(source, restored) {
  const failures = [];
  const sourceKeys = Object.keys(source);
  const restoredKeys = Object.keys(restored);

  for (const table of sourceKeys) {
    if (!(table in restored)) {
      failures.push(`\`${table}\` exists in the source but not in the restored database.`);
      continue;
    }
    if (source[table] !== restored[table]) {
      failures.push(
        `\`${table}\` holds ${source[table]} row(s) in the source and ${restored[table]} after restore.`
      );
    }
  }
  for (const table of restoredKeys) {
    if (!(table in source))
      failures.push(`\`${table}\` appeared in the restored database and is not in the source.`);
  }
  return failures;
}

function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };

  const evidence = { host: HOST, sourceDatabase: SOURCE_DB, restoreDatabase: RESTORE_DB };
  const failures = [];

  try {
    assertEphemeralTarget(HOST);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(2);
  }

  const workdir = mkdtempSync(join(tmpdir(), 'rootlco-drill-'));
  const dumpPath = join(workdir, 'source.dump');

  try {
    // ---- 1. source control totals ---------------------------------------
    const sourceHash = execFileSync('node', ['scripts/db/schema-inventory.mjs', '--hash-only'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PGHOST: HOST,
        PGPORT: String(PORT),
        PGUSER: USER,
        PGDATABASE: SOURCE_DB,
      },
    })
      .trim()
      .split('\n')
      .pop();
    const sourceCounts = tableCounts(SOURCE_DB);
    evidence.sourceSchemaHash = sourceHash;
    evidence.sourceTables = Object.keys(sourceCounts).length;
    evidence.sourceRows = Object.values(sourceCounts).reduce((a, b) => a + b, 0);

    // ---- 2. dump ---------------------------------------------------------
    const t0 = Date.now();
    execFileSync(
      'pg_dump',
      ['-h', HOST, '-p', String(PORT), '-U', USER, '-d', SOURCE_DB, '-Fc', '-f', dumpPath],
      {
        stdio: 'pipe',
      }
    );
    evidence.dumpMs = Date.now() - t0;
    if (!existsSync(dumpPath) || statSync(dumpPath).size === 0) {
      failures.push('pg_dump produced an empty file. An empty backup is not a backup.');
    } else {
      evidence.dumpBytes = statSync(dumpPath).size;
    }

    // ---- 3. restore into a FRESH database --------------------------------
    psql('postgres', `DROP DATABASE IF EXISTS ${RESTORE_DB}`);
    psql('postgres', `CREATE DATABASE ${RESTORE_DB}`);
    const t1 = Date.now();
    // pg_restore reports non-fatal notices on stderr and exits non-zero for
    // them with --exit-on-error omitted, so the status is checked explicitly
    // rather than being allowed to abort or being discarded.
    try {
      execFileSync(
        'pg_restore',
        [
          '-h',
          HOST,
          '-p',
          String(PORT),
          '-U',
          USER,
          '-d',
          RESTORE_DB,
          '--no-owner',
          '--exit-on-error',
          dumpPath,
        ],
        { stdio: 'pipe' }
      );
    } catch (error) {
      failures.push(`pg_restore failed: ${String(error.stderr ?? error.message).slice(-1500)}`);
    }
    evidence.restoreMs = Date.now() - t1;

    // ---- 4. verify -------------------------------------------------------
    const restoredHash = execFileSync('node', ['scripts/db/schema-inventory.mjs', '--hash-only'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PGHOST: HOST,
        PGPORT: String(PORT),
        PGUSER: USER,
        PGDATABASE: RESTORE_DB,
      },
    })
      .trim()
      .split('\n')
      .pop();
    evidence.restoredSchemaHash = restoredHash;
    if (sourceHash !== restoredHash) {
      failures.push(
        `schema hash diverged: source \`${sourceHash}\`, restored \`${restoredHash}\`. ` +
          'The structure did not survive the round trip.'
      );
    }

    const restoredCounts = tableCounts(RESTORE_DB);
    evidence.restoredTables = Object.keys(restoredCounts).length;
    evidence.restoredRows = Object.values(restoredCounts).reduce((a, b) => a + b, 0);
    failures.push(...compareCounts(sourceCounts, restoredCounts));

    // ---- 5. the restored database must be usable, not merely present -----
    const smoke = [];
    for (const sql of [
      'SELECT count(*) FROM shared.currencies',
      'SELECT count(*) FROM iam.permissions',
      'SELECT count(*) FROM pg_policy',
      'SELECT count(*) FROM pg_class WHERE relrowsecurity',
    ]) {
      try {
        smoke.push({ sql, value: Number(psql(RESTORE_DB, sql)), ok: true });
      } catch (error) {
        smoke.push({ sql, ok: false, error: error.message });
        failures.push(`the restored database could not answer \`${sql}\`.`);
      }
    }
    evidence.smoke = smoke;
    const rlsTables = smoke.find((s) => s.sql.includes('relrowsecurity'))?.value ?? 0;
    if (rlsTables === 0) {
      failures.push(
        'no table has row-level security enabled after restore — the security posture did not survive.'
      );
    }
  } catch (error) {
    console.error(`::error::drill failed: ${error.message}`);
    failures.push(`drill aborted: ${error.message}`);
  } finally {
    try {
      psql('postgres', `DROP DATABASE IF EXISTS ${RESTORE_DB}`);
    } catch {
      // The container is discarded at the end of the job either way.
    }
  }

  const lines = ['### Backup and restore drill', ''];
  lines.push('| Measure | Source | Restored |');
  lines.push('| --- | --- | --- |');
  lines.push(
    `| Schema hash | \`${evidence.sourceSchemaHash ?? '—'}\` | \`${evidence.restoredSchemaHash ?? '—'}\` |`
  );
  lines.push(`| Tables | ${evidence.sourceTables ?? '—'} | ${evidence.restoredTables ?? '—'} |`);
  lines.push(`| Rows | ${evidence.sourceRows ?? '—'} | ${evidence.restoredRows ?? '—'} |`);
  lines.push('');
  lines.push(
    `Dump: ${evidence.dumpBytes ? `${(evidence.dumpBytes / 1024 / 1024).toFixed(1)} MiB` : '—'} ` +
      `in ${evidence.dumpMs ?? '—'} ms · restore in ${evidence.restoreMs ?? '—'} ms`
  );
  lines.push('');
  lines.push(
    '_Ephemeral service container only. No production system is reachable from this workflow, and the dump is never uploaded as an artifact._'
  );
  if (failures.length) {
    lines.push('');
    lines.push('**Drill failures**');
    lines.push('');
    for (const f of failures.slice(0, 40)) lines.push(`- ❌ ${f}`);
  } else {
    lines.push('');
    lines.push('**Restore verified against the source.**');
  }
  const md = lines.join('\n');

  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${md}\n`);
  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ ...evidence, failures }, null, 2)}\n`);
  console.log(md);
  process.exit(failures.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
