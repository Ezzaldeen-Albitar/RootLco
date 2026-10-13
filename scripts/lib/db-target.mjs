/**
 * The one place a repository script or test helper decides WHICH PostgreSQL
 * server it is about to touch.
 *
 * ## Why this exists
 *
 * On 2026-10-06 two runs of `scripts/db/phase-upgrade-matrix.mjs` reached the
 * acceptance database on 127.0.0.1:54322. Nobody asked for that database: the
 * operator had set `DB_PORT` to a disposable one, but the script read only
 * `PGPORT`, found it unset, and fell back to 54322. Twenty-odd scripts and test
 * helpers carried the same `?? 54322` fallback, each a separate copy of the same
 * silent default. A default port is a target nobody chose.
 *
 * ## The rule
 *
 *   1. The port is EXPLICIT. `PGPORT`, `DB_PORT` or a command-line port must
 *      name it. None of them => refused.
 *   2. Every source that is set must AGREE. `PGPORT=55441 DB_PORT=54322` is two
 *      targets, and choosing one of them is guessing => refused. The same holds
 *      for `PGHOST` and `DB_HOST` when both are set.
 *   3. Outside GitHub Actions, a loopback target on 54322 — the Supabase local
 *      stack, which on this project's machines holds the Owner's acceptance
 *      data — is refused unless `ROOTLCO_ACCEPTANCE_DB=authorised-forward-apply`
 *      is set. That variable is set only by the operator carrying out the
 *      established backup -> rehearsal -> forward-apply procedure for the
 *      acceptance database (docs/database/migration-standard.md section 16). It is not a
 *      convenience switch for running a suite.
 *   4. Inside GitHub Actions (`GITHUB_ACTIONS=true`) 54322 is the ephemeral
 *      service container every database job starts, so rules 1 and 2 apply and
 *      rule 3 does not. The workflows already set `DB_PORT` explicitly.
 *
 * The guarded operator scripts under `scripts/platform/` (other than the
 * read-only entitlement inventory), `scripts/db/provision-organization.mjs` and
 * `scripts/dev/owner-acceptance/context.mjs` keep their own `ROOTLCO_ENV`
 * guards and are the documented exceptions; `tests/ci/db-target-contract.test.ts`
 * names them and proves each still carries that guard.
 *
 * Nothing here opens a connection. It returns a host and a port, or it throws.
 */

/** The port the Supabase local stack publishes its database on. */
export const ACCEPTANCE_DATABASE_PORT = 54322;

/** The variable that authorises a local run against {@link ACCEPTANCE_DATABASE_PORT}. */
export const ACCEPTANCE_AUTHORISATION_VARIABLE = 'ROOTLCO_ACCEPTANCE_DB';

/** The only value that authorises it. */
export const ACCEPTANCE_AUTHORISATION_VALUE = 'authorised-forward-apply';

/** Hosts that name this machine. */
export const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

const DEFAULT_HOST = '127.0.0.1';

export class DatabaseTargetRefused extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'DatabaseTargetRefused';
  }
}

/**
 * @param {unknown} value
 * @returns {string | undefined} the trimmed value, or undefined when unset or blank
 */
function present(value) {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text === '' ? undefined : text;
}

/**
 * @param {string} name
 * @param {string} raw
 */
function parsePort(name, raw) {
  if (!/^\d{1,5}$/.test(raw)) {
    throw new DatabaseTargetRefused(`${name}='${raw}' is not a TCP port number.`);
  }
  const port = Number.parseInt(raw, 10);
  if (port < 1 || port > 65535) {
    throw new DatabaseTargetRefused(`${name}='${raw}' is outside the TCP port range.`);
  }
  return port;
}

/**
 * Resolves the database host and port, or throws {@link DatabaseTargetRefused}.
 *
 * @param {{
 *   env?: Record<string, string | undefined>,
 *   host?: string | undefined,
 *   port?: string | number | undefined,
 *   consumer?: string,
 * }} [options]
 *   `host` / `port` are a command-line choice, when the consumer takes one; they
 *   are one more source that must agree with the environment, never an override.
 * @returns {{ host: string, port: number, acceptance: boolean }}
 *   `acceptance` is true when the target is the loopback acceptance port.
 */
export function resolveDatabaseTarget(options = {}) {
  const env = options.env ?? process.env;
  const consumer = options.consumer ?? 'this command';
  const refuse = (/** @type {string} */ reason) =>
    new DatabaseTargetRefused(
      `${consumer} refused to choose a database: ${reason} ` +
        'See docs/database/migration-standard.md section 16.'
    );

  /** @type {Array<[string, string]>} */
  const portSources = [
    ['PGPORT', present(env.PGPORT)],
    ['DB_PORT', present(env.DB_PORT)],
    ['the --db-port argument', present(options.port)],
  ].filter((entry) => entry[1] !== undefined);

  if (portSources.length === 0) {
    throw refuse(
      'no database port was given. Set DB_PORT (and PGPORT, if you set it, to the same value) ' +
        'to a disposable test database such as 127.0.0.1:55441. There is no default port.'
    );
  }

  let port;
  try {
    const parsed = portSources.map(
      ([name, raw]) => /** @type {const} */ ([name, parsePort(name, raw)])
    );
    const distinct = new Set(parsed.map(([, value]) => value));
    if (distinct.size > 1) {
      throw new DatabaseTargetRefused(
        `the port sources disagree (${parsed.map(([name, value]) => `${name}=${value}`).join(', ')}). ` +
          'Two ports are two databases; set them to the same value or unset one.'
      );
    }
    port = parsed[0][1];
  } catch (error) {
    if (error instanceof DatabaseTargetRefused) throw refuse(error.message);
    throw error;
  }

  /** @type {Array<[string, string]>} */
  const hostSources = [
    ['PGHOST', present(env.PGHOST)],
    ['DB_HOST', present(env.DB_HOST)],
    ['the --db-host argument', present(options.host)],
  ].filter((entry) => entry[1] !== undefined);
  const hosts = new Set(hostSources.map(([, value]) => value.toLowerCase()));
  if (hosts.size > 1) {
    throw refuse(
      `the host sources disagree (${hostSources.map(([name, value]) => `${name}=${value}`).join(', ')}). ` +
        'Set them to the same value or unset one.'
    );
  }
  const host = hostSources.length > 0 ? hostSources[0][1] : DEFAULT_HOST;

  const acceptance = port === ACCEPTANCE_DATABASE_PORT && LOOPBACK_HOSTS.has(host.toLowerCase());
  const inGitHubActions = env.GITHUB_ACTIONS === 'true';
  const authorised = env[ACCEPTANCE_AUTHORISATION_VARIABLE] === ACCEPTANCE_AUTHORISATION_VALUE;
  if (acceptance && !inGitHubActions && !authorised) {
    throw refuse(
      `${host}:${port} is the local acceptance database, and no authorisation was given. ` +
        'Point DB_PORT/PGPORT at a disposable database instead. ' +
        `${ACCEPTANCE_AUTHORISATION_VARIABLE}=${ACCEPTANCE_AUTHORISATION_VALUE} is set only by the ` +
        'backup -> rehearsal -> forward-apply procedure for the acceptance database.'
    );
  }

  return { host, port, acceptance };
}

/**
 * {@link resolveDatabaseTarget} for a command-line entry point: prints the
 * refusal and exits non-zero instead of throwing a stack trace at the operator.
 *
 * @param {Parameters<typeof resolveDatabaseTarget>[0]} [options]
 * @returns {{ host: string, port: number, acceptance: boolean }}
 */
export function resolveDatabaseTargetOrExit(options = {}) {
  try {
    return resolveDatabaseTarget(options);
  } catch (error) {
    if (error instanceof DatabaseTargetRefused) {
      console.error(`::error::${error.message}`);
      process.exit(2);
    }
    throw error;
  }
}
