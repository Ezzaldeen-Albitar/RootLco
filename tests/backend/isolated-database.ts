/**
 * An isolated database for a suite whose setup is DESTRUCTIVE.
 *
 * The local backend tier runs every suite against ONE shared PostgreSQL — the
 * same database the Owner's acceptance environment lives in. A suite that
 * needs "a platform with no operator" as its precondition used to obtain it
 * with `DELETE FROM iam.platform_grants`, unqualified, which is not a fixture
 * cleanup: it revokes the real platform operator's authority, after which every
 * control-plane route on the acceptance stack answers 403 until the genesis is
 * re-run by hand. Measured on 2026-09-06, on the acceptance database, after one
 * full `test:backend` run.
 *
 * The rule this file implements: a suite that must destroy state does so in a
 * database it created for itself and drops afterwards, and touches nothing on
 * the shared one. The isolated database is built the way CI builds its
 * container — every migration replayed from empty through the same loop
 * `scripts/db/apply-migrations.mjs` uses, then the declared seeds in the order
 * `supabase/config.toml` declares them — so a proof taken inside it is a proof
 * about the committed migrations, not about one developer's database.
 *
 * Cluster-level objects (login roles, `app_*` archetypes) are shared by every
 * database on the server and are created idempotently by `ensureTestLogins`
 * against the default database; nothing here creates or drops a role.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool, type ClientConfig } from 'pg';
import { listMigrations, versionOf } from '../../scripts/db/apply-migrations.mjs';

const HOST = process.env.DB_HOST ?? '127.0.0.1';
const PORT = Number(process.env.DB_PORT ?? 54322);
const ADMIN_USER = process.env.DB_USER ?? 'postgres';
const ADMIN_PASSWORD = process.env.DB_PASSWORD ?? 'postgres';
/** The shared database the harness otherwise targets. */
export const SHARED_DATABASE = process.env.DB_NAME ?? 'postgres';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS_DIR = join(REPO_ROOT, 'supabase', 'migrations');
const CONFIG_PATH = join(REPO_ROOT, 'supabase', 'config.toml');

/** Every isolated database this helper creates carries this prefix, so a stale one is recognisable. */
export const ISOLATED_PREFIX = 'rootlco_test_isolated_';

/** `CREATE DATABASE` takes an identifier, so the name is constrained rather than quoted. */
const SAFE_NAME = /^[a-z][a-z0-9_]{0,62}$/;

function config(
  user: string,
  password: string,
  database: string,
  max: number
): ClientConfig & { max: number } {
  return { host: HOST, port: PORT, database, user, password, max };
}

/**
 * Errors a pool emitted with no query in flight — an idle client the server
 * terminated, typically. `pg-pool` re-emits those on the POOL, and a pool with
 * no `error` listener turns them into an uncaught exception that vitest
 * reports as an unhandled error AFTER every test has passed (exit 1, all
 * green). Every pool this module creates records them here instead, and a
 * suite asserts the list is empty when it tears down.
 */
const strays: Error[] = [];

export function strayPoolErrors(): readonly Error[] {
  return strays;
}

function recording(pool: Pool): Pool {
  pool.on('error', (error: Error) => {
    strays.push(error);
  });
  return pool;
}

/** A pool bound to an arbitrary database on the cluster, as the admin login. */
export function adminPoolFor(database: string, max = 5): Pool {
  return recording(new Pool(config(ADMIN_USER, ADMIN_PASSWORD, database, max)));
}

/** A pool bound to an arbitrary database on the cluster, as a harness login role. */
export function loginPoolFor(user: string, password: string, database: string, max = 5): Pool {
  return recording(new Pool(config(user, password, database, max)));
}

/**
 * The seed files `supabase db reset` applies, in its order, read from the one
 * place that order is declared. Parsed rather than hard-coded so a seed added
 * to `config.toml` reaches the isolated database without a second edit here.
 */
export function declaredSeedPaths(): string[] {
  const toml = readFileSync(CONFIG_PATH, 'utf8');
  const block = /sql_paths\s*=\s*\[([\s\S]*?)\]/.exec(toml);
  if (!block?.[1]) throw new Error('supabase/config.toml declares no [db.seed] sql_paths');
  return [...block[1].matchAll(/"([^"]+)"/g)].map((m) =>
    join(REPO_ROOT, 'supabase', m[1] as string)
  );
}

/**
 * Creates `name` from empty and replays every migration and every declared seed
 * into it. Refuses a name outside the harness prefix, so this can never be
 * pointed at the shared database by accident.
 */
export async function createIsolatedDatabase(cluster: Pool, name: string): Promise<void> {
  assertIsolatedName(name);
  await cluster.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await cluster.query(`CREATE DATABASE ${name}`);
  const db = adminPoolFor(name, 1);
  try {
    const client = await db.connect();
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS supabase_migrations');
      await client.query(
        `CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
           version text PRIMARY KEY,
           name text,
           applied_at timestamptz NOT NULL DEFAULT now()
         )`
      );
      for (const file of listMigrations(MIGRATIONS_DIR)) {
        const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ($1, $2)',
            [versionOf(file), file]
          );
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK');
          throw new Error(
            `isolated database ${name}: migration ${file} failed: ${String((error as Error).message)}`
          );
        }
      }
      for (const seed of declaredSeedPaths()) {
        await client.query(readFileSync(seed, 'utf8'));
      }
    } finally {
      client.release();
    }
  } finally {
    await db.end();
  }
}

/**
 * How long the drop waits for the database's sessions to close on their own
 * before it forces them. Pools ended by the caller close within milliseconds;
 * the ceiling exists only so a crashed run's leftovers cannot hang a suite.
 */
const SESSION_DRAIN_MS = 5_000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Sessions still open on `name`, other than the caller's own.
 */
async function openSessions(cluster: Pool, name: string): Promise<number> {
  const { rows } = await cluster.query<{ n: string }>(
    'SELECT count(*)::text AS n FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
    [name]
  );
  return Number(rows[0]?.n ?? '0');
}

/**
 * Drops an isolated database, AFTER its sessions have closed.
 *
 * `pool.end()` resolves before the server has closed a single socket:
 * `pg-pool`'s `_pulseQueue` calls `client.end()` on each idle client without
 * waiting and fires the end callback the moment its own client list is empty
 * (node_modules/pg-pool/index.js, `_pulseQueue` / `_remove`). A
 * `DROP DATABASE ... WITH (FORCE)` issued straight after therefore races the
 * clients' Terminate messages; when the drop wins, the server answers the
 * still-open socket with `57P01 terminating connection due to administrator
 * command`, the ending client emits it, and the pool re-emits it with nobody
 * listening. Locally the Terminate won every time; on the hosted runner the
 * drop did, once, and the backend tier exited 1 with every test green.
 *
 * So the drop first waits until `pg_stat_activity` shows no session on the
 * database. The FORCE stays for what the wait cannot reach — a crashed run's
 * leftovers that `dropStaleIsolatedDatabases` sweeps — behind the ceiling.
 */
export async function dropIsolatedDatabase(cluster: Pool, name: string): Promise<void> {
  assertIsolatedName(name);
  const deadline = Date.now() + SESSION_DRAIN_MS;
  while ((await openSessions(cluster, name)) > 0 && Date.now() < deadline) {
    await sleep(25);
  }
  await cluster.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
}

/**
 * Drops every isolated database a previous run left behind — a crashed process
 * cannot reach its own `afterAll`, and the next run should not inherit its
 * debris. Only names carrying the harness prefix are touched.
 */
export async function dropStaleIsolatedDatabases(cluster: Pool): Promise<string[]> {
  const { rows } = await cluster.query<{ datname: string }>(
    'SELECT datname FROM pg_database WHERE datname LIKE $1',
    [`${ISOLATED_PREFIX}%`]
  );
  for (const row of rows) await dropIsolatedDatabase(cluster, row.datname);
  return rows.map((r) => r.datname);
}

function assertIsolatedName(name: string): void {
  if (!SAFE_NAME.test(name) || !name.startsWith(ISOLATED_PREFIX)) {
    throw new Error(
      `refusing to create or drop "${name}": an isolated database must match ${SAFE_NAME} and start with ${ISOLATED_PREFIX}`
    );
  }
  if (name === SHARED_DATABASE) {
    throw new Error(`refusing to touch the shared database "${name}"`);
  }
}
