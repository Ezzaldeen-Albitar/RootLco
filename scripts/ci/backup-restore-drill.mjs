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
 * rather than merely completing without error. So it proves four things:
 *
 *   1. the restored SCHEMA HASH equals the source's — structure survived;
 *   2. the restored ROW COUNTS equal the source's, table by table — data
 *      survived, including the structural reference catalogs;
 *   3. the restored DATABASE-LEVEL SETTINGS equal the source's — the dump
 *      carries none of them, so they are replayed from the catalogue and then
 *      proved, rather than assumed;
 *   4. application-shaped queries still answer on the restored database — it is
 *      usable, not merely present.
 *
 * PRODUCTION IS NEVER TOUCHED. There is no production connection in this
 * repository, no workflow holds one, and this script refuses every host that is
 * not a loopback address or the `postgres` service alias. The only database it
 * ever drops or creates is `rootlco_restore_probe`; the source is read only.
 *
 * Usage: node scripts/ci/backup-restore-drill.mjs [--json out.json] [--markdown out.md]
 * Exit codes: 0 restore verified · 1 divergence · 2 tooling error.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
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

/** The major of a `pg_dump --version` line such as `pg_dump (PostgreSQL) 17.11 (Ubuntu …)`. */
export function clientMajor(versionLine) {
  const match = /\(PostgreSQL\)\s+(\d+)/.exec(versionLine);
  if (!match) throw new Error(`cannot read a PostgreSQL major from "${versionLine}"`);
  return Number(match[1]);
}

/**
 * pg_dump aborts when the server is newer than itself ("aborting because of
 * server version mismatch"), and an archive written by a newer pg_dump is not
 * readable by an older pg_restore. Equal majors is therefore the only pairing
 * the drill accepts — and a mismatch is a TOOLING error, not a divergence.
 */
export function assertClientMatchesServer(client, server) {
  if (client !== server) {
    throw new Error(
      `client/server major mismatch: pg_dump is ${client}, the server is ${server}. ` +
        'Install a postgresql-client whose major equals the server major ' +
        '(supabase/config.toml `major_version`) before running the drill.'
    );
  }
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

/*
 * ---------------------------------------------------------------------------
 * Database-level settings.
 *
 * `supabase/migrations/0001_extensions.sql` runs
 * `ALTER DATABASE <current> SET search_path TO "$user", public, extensions`.
 * That is a row in `pg_db_role_setting`, which belongs to the CLUSTER, not to
 * the database's own contents — a compressed `pg_dump` taken WITHOUT `--create`
 * carries no such row, and the drill builds its restore target with a bare
 * `CREATE DATABASE`. So the restored database silently lacks the setting.
 *
 * Nothing in the restore fails. Existing objects are bound by identifier, so
 * they keep working, and the row counts match to the row. What changes is how
 * the catalogue RENDERS unqualified names — a `citext` check constraint on
 * `iam.user_accounts`, and the trigram operator classes on `inv.item_master`
 * and `shared.search_metadata` — which is exactly the difference the schema
 * hash reported. The restore was faithful; the RENDERER was reading a
 * different search path.
 *
 * The disaster-recovery consequence is real and larger than the hash: anything
 * executed AFTER such a restore that relies on an unqualified `extensions`
 * name — `citext`, `gin_trgm_ops` — resolves against the wrong path. A restore
 * is not on its own enough to rebuild a working database.
 *
 * The fix is to replay the settings from the CATALOGUE, since the dump does not
 * carry them, and then to assert that the target's set equals the source's. The
 * schema-hash equality assertion is left exactly as it was: with the search
 * paths equalised it once again measures structure rather than rendering.
 * ---------------------------------------------------------------------------
 */

/** Read against a database to get ITS OWN database-level settings, no interpolation. */
export const DATABASE_SETTINGS_QUERY = `SELECT unnest(s.setconfig)
   FROM pg_db_role_setting s
   JOIN pg_database d ON d.oid = s.setdatabase
  WHERE d.datname = current_database() AND s.setrole = 0`;

/**
 * A GUC name is a dotted run of unquoted identifiers and nothing else. The name
 * cannot be double-quoted as a whole in `ALTER DATABASE … SET`, so it is
 * checked against an ALLOW-LIST and refused when it does not match, rather than
 * escaped and hoped for.
 */
const SETTING_NAME = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;
const DATABASE_NAME = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/** Settings whose VALUE must never reach a job summary, a log or an artifact. */
const SECRET_SETTING = /secret|password|passwd|token|credential|private_?key|(?:^|[._])key$/i;

/** Values are SQL string literals; the only escape a literal needs is the doubled quote. */
export function quoteSqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/** `«redacted»` for a secret-shaped name, so the drill can report the SET without leaking it. */
export function redactSettingValue(name, value) {
  return SECRET_SETTING.test(name) ? '«redacted»' : String(value);
}

/** `name=value`, rendered for the summary with a secret-shaped value withheld. */
export function renderSetting({ name, value }) {
  return `${name}=${redactSettingValue(name, value)}`;
}

/**
 * Splits `pg_db_role_setting.setconfig` entries into `{ name, value }`, sorted
 * by name so the two sides compare as SETS rather than as arrays that happen to
 * be in catalogue order. A line with no `=` is refused rather than dropped: a
 * setting silently skipped is the loss this whole change exists to catch.
 */
export function parseDatabaseSettings(lines) {
  const settings = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const eq = line.indexOf('=');
    if (eq < 1) {
      throw new Error(
        `cannot read a database-level setting from "${line}": no \`name=value\` pair`
      );
    }
    settings.push({ name: line.slice(0, eq), value: line.slice(eq + 1) });
  }
  return settings.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * A value already in PostgreSQL's canonical LIST rendering: comma-separated
 * items, each a bare identifier or a double-quoted string with its inner quotes
 * doubled. `search_path`'s `"$user", public, extensions` is one.
 *
 * This matters because PostgreSQL re-canonicalises a list-valued setting
 * assigned from a single string literal: `SET search_path = '"$user", public,
 * extensions'` stores `"""$user"", public, extensions"` — one item whose text is
 * the whole list. The effective value is right, but the STORED value is not the
 * source's, and the assertion below compares stored values. So a canonical list
 * is replayed as a list (`SET … TO "$user", public, extensions`), which stores
 * back byte for byte.
 *
 * Splicing is safe because the pattern is an allow-list: no item can carry an
 * unescaped quote, so nothing can leave the token it is in.
 */
const SETTING_LIST_ITEM = '(?:[A-Za-z_][A-Za-z0-9_$]*|"(?:[^"]|"")*")';
const SETTING_LIST = new RegExp(`^${SETTING_LIST_ITEM}(?:, ${SETTING_LIST_ITEM})*$`);

export function isCanonicalSettingList(value) {
  const text = String(value);
  // A lone bare word goes through the LITERAL path instead: it round-trips
  // exactly either way, and `SET x TO default` would mean "reset", not "the
  // string default".
  if (!text.includes(',') && !text.includes('"')) return false;
  return SETTING_LIST.test(text);
}

/** One `ALTER DATABASE … SET …`, with the identifier, the list and the literal all checked. */
export function alterDatabaseSettingStatement(database, name, value) {
  if (!DATABASE_NAME.test(database)) {
    throw new Error(`refusing to build a statement against database name "${database}"`);
  }
  if (!SETTING_NAME.test(name)) {
    throw new Error(
      `refusing to replay a database-level setting whose name is not a plain dotted identifier: "${name}"`
    );
  }
  return isCanonicalSettingList(value)
    ? `ALTER DATABASE "${database}" SET ${name} TO ${value}`
    : `ALTER DATABASE "${database}" SET ${name} = ${quoteSqlLiteral(value)}`;
}

/**
 * A psql diagnostic for a failed replay, with the setting's own value scrubbed
 * out of it — psql echoes the statement it could not run, and the statement
 * carries the value.
 */
export function settingReplayError(name, value, stderr) {
  const text = String(stderr ?? '');
  const line = (text.split('\n').find((l) => l.includes('ERROR:')) ?? text).trim();
  const scrubbed = value ? line.split(String(value)).join('«redacted»') : line;
  return `${name}: ${scrubbed || 'psql reported no diagnostic'}`;
}

/**
 * The new assertion. Both arguments are the `{ name, value }` lists read from
 * each side's OWN `pg_db_role_setting` with `setrole = 0`, and the two must be
 * equal as sets — name for name and value for value.
 *
 * Read from the catalogue on both sides, deliberately. `current_setting` on the
 * restored database would have been the obvious alternative and is the WRONG
 * measurement: a ROLE-level setting (`setdatabase = 0`) outranks a
 * database-level one, so an effective read answers for the role that took it,
 * not for the database. The local Supabase image sets `search_path` on the
 * `postgres` role and would have made an effective comparison disagree with
 * itself. `pg_db_role_setting` is the level a dump does not carry, so it is the
 * level the drill asserts on.
 */
export function compareDatabaseSettings(source, restored) {
  const failures = [];
  const sourceNames = source.map((s) => s.name);
  const restoredNames = restored.map((s) => s.name);

  for (const name of sourceNames) {
    if (!restoredNames.includes(name)) {
      failures.push(
        `database-level setting \`${name}\` is set on the source and NOT on the restored database. ` +
          'A compressed dump carries no `pg_db_role_setting` row, so a restore that does not replay ' +
          'it rebuilds a database that resolves unqualified names differently from the one backed up.'
      );
    }
  }
  for (const name of restoredNames) {
    if (!sourceNames.includes(name)) {
      failures.push(
        `database-level setting \`${name}\` is set on the restored database and not on the source.`
      );
    }
  }

  for (const { name, value } of source) {
    const counterpart = restored.find((s) => s.name === name);
    if (!counterpart) continue; // already reported, once, above
    if (counterpart.value !== value) {
      failures.push(
        `database-level setting \`${name}\` differs after restore: ` +
          `source \`${redactSettingValue(name, value)}\`, restored \`${redactSettingValue(name, counterpart.value)}\`.`
      );
    }
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

  // ---- 0. tooling preflight ------------------------------------------------
  // Exit 2, not 1: a client that cannot read this server is not a divergence
  // between source and restore, and nothing below has run yet.
  try {
    const clientLine = execFileSync('pg_dump', ['--version'], { encoding: 'utf8' }).trim();
    const serverMajor = Number(
      psql('postgres', "SELECT current_setting('server_version_num')::int / 10000")
    );
    evidence.clientVersion = clientLine;
    evidence.restoreClientVersion = execFileSync('pg_restore', ['--version'], {
      encoding: 'utf8',
    }).trim();
    evidence.serverVersion = psql('postgres', 'SHOW server_version');
    assertClientMatchesServer(clientMajor(clientLine), serverMajor);
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

    // ---- 3a. replay the source's DATABASE-LEVEL settings ------------------
    // Read from the CATALOGUE, because the dump does not carry them. This runs
    // BEFORE pg_restore so the restore itself proceeds under the search path a
    // real recovery would have, rather than being corrected afterwards.
    const sourceSettings = parseDatabaseSettings(
      psql(SOURCE_DB, DATABASE_SETTINGS_QUERY).split('\n')
    );
    evidence.databaseSettingsReadFrom =
      'pg_db_role_setting on the source database — a compressed pg_dump taken without --create carries none';
    evidence.sourceDatabaseSettings = sourceSettings.map(renderSetting);
    for (const { name, value } of sourceSettings) {
      try {
        psql('postgres', alterDatabaseSettingStatement(RESTORE_DB, name, value));
      } catch (error) {
        failures.push(
          'a database-level setting could not be replayed onto the restore target — ' +
            settingReplayError(name, value, error.stderr ?? error.message)
        );
      }
    }

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

    // ---- 4a. the replayed settings must EQUAL the source's ---------------
    // The hash assertion above is unchanged and still catches structural loss.
    // This is the assertion that catches what the hash could only ever report
    // as a rendering difference: a database-level setting the dump did not
    // carry and the restore therefore did not have.
    const restoredSettings = parseDatabaseSettings(
      psql(RESTORE_DB, DATABASE_SETTINGS_QUERY).split('\n')
    );
    evidence.restoredDatabaseSettings = restoredSettings.map(renderSetting);
    failures.push(...compareDatabaseSettings(sourceSettings, restoredSettings));

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
    // The dump is the entire source database. On a hosted runner the disk is
    // discarded with the job; on a developer machine it would otherwise stay
    // in the temp directory, so it is removed here in every outcome.
    rmSync(workdir, { recursive: true, force: true });
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
  const renderSettingList = (list) =>
    list === undefined ? '—' : list.length ? list.map((s) => `\`${s}\``).join(', ') : '(none)';
  lines.push('**Database-level settings**');
  lines.push('');
  lines.push(
    'Read from `pg_db_role_setting` on the SOURCE and replayed onto the restore target with ' +
      '`ALTER DATABASE … SET`. A compressed `pg_dump` taken without `--create` carries none of ' +
      'them, so a restore that does not replay them rebuilds a database that resolves ' +
      'unqualified names differently — and a restore alone is therefore not enough to rebuild ' +
      'a working database. Values of secret-shaped settings are withheld.'
  );
  lines.push('');
  lines.push(`- source: ${renderSettingList(evidence.sourceDatabaseSettings)}`);
  lines.push(`- restored: ${renderSettingList(evidence.restoredDatabaseSettings)}`);
  lines.push('');
  lines.push(
    `Client: \`${evidence.clientVersion ?? '—'}\` · server: \`${evidence.serverVersion ?? '—'}\``
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
