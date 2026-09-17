#!/usr/bin/env node
/**
 * Completes an EXISTING platform operator's authority (P1-32-PRE-020).
 *
 * The product has no write path to `iam.platform_grants`, and that stays true:
 * no operation writes it, no policy admits an application role to it. The
 * first operator is established by `genesis-platform-operator.mjs`. This script
 * exists for the case genesis does not cover cleanly — an operator established
 * BEFORE a platform authority code existed, who therefore lacks the new codes
 * while every other fact about them is correct. Adding the Platform Owner
 * Console's six codes is exactly that case.
 *
 * What one run does, in ONE transaction:
 *
 *   1. finds the operator by address, and refuses unless that account is
 *      `active`, not deleted, and ALREADY holds at least one unrevoked platform
 *      grant. The last condition is the load-bearing one: it makes this script
 *      structurally incapable of minting a new operator. Establishing a first
 *      holder of platform authority is genesis's act, with genesis's one-time
 *      refusal, and this script must never become a second door to it;
 *   2. inserts a grant for each code in `PLATFORM_AUTHORITY_CODES` the account
 *      does not already hold, with `granted_by` the catalogue's own actor
 *      (never the account itself — `ck_platform_grants_no_self_grant`);
 *   3. appends `platform.operator.authority_granted` in the operator's home
 *      tenant, naming the codes before and after — identifiers only.
 *
 * Properties, enforced rather than described:
 *
 *   - owner-controlled: `--confirm <email>` must repeat GRANT_OPERATOR_EMAIL,
 *     and ROOTLCO_ENV must be one of the two named gates;
 *   - idempotent: an operator who already holds every code is a no-op (exit 0)
 *     that writes nothing, not even an audit record;
 *   - fail-closed: any refusal rolls everything back and exits non-zero;
 *   - `--dry-run` performs every write and then rolls back, so the evidence
 *     reports exactly what a real run would have done;
 *   - evidence without secrets: identifiers, timestamps and the database host.
 *
 * Inputs:
 *
 *   ROOTLCO_ENV              'local-acceptance' | 'production-genesis'
 *   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD   the privileged connection
 *   GRANT_OPERATOR_EMAIL     the operator's address
 *   GRANT_EVIDENCE_PATH      where to write the evidence JSON
 *                            (default .tmp/platform-authority-grant-<ts>.json)
 *
 *   node scripts/platform/grant-platform-authority.mjs --confirm <email> [--dry-run]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { PLATFORM_AUTHORITY_CODES } from './genesis-platform-operator.mjs';

const ALLOWED_ENVIRONMENTS = new Set(['local-acceptance', 'production-genesis']);
/** The catalogue seed's own actor: the only uuid that predates every account. */
const GRANT_ACTOR = '00000000-0000-4000-8000-000000000001';

class GrantRefused extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 2) {
  throw new GrantRefused(message, exitCode);
}

function parseArgs(argv) {
  const parsed = { confirm: undefined, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--confirm') {
      parsed.confirm = argv[++index];
      if (!parsed.confirm) fail('--confirm requires the operator address');
    } else fail(`Unknown argument: ${arg}`);
  }
  if (!parsed.confirm) fail('Missing required --confirm <operator-email>');
  return parsed;
}

/** Reads what the run needs. The password stays in this object and is never logged. */
export function readGrantInput(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const environment = env.ROOTLCO_ENV;
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    fail("Fail closed: ROOTLCO_ENV must be exactly 'local-acceptance' or 'production-genesis'");
  }
  const email = (env.GRANT_OPERATOR_EMAIL ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('GRANT_OPERATOR_EMAIL is not an address');
  if (args.confirm.trim().toLowerCase() !== email) {
    fail('--confirm must exactly match GRANT_OPERATOR_EMAIL');
  }
  return {
    environment,
    dryRun: args.dryRun,
    db: {
      host: env.DB_HOST ?? '127.0.0.1',
      port: Number(env.DB_PORT ?? 54322),
      database: env.DB_NAME ?? 'postgres',
      user: env.DB_USER ?? 'postgres',
      password: env.DB_PASSWORD ?? 'postgres',
    },
    operator: { email },
    evidencePath: env.GRANT_EVIDENCE_PATH ?? '',
  };
}

/**
 * Runs the completion on an open client. Exported so a proof can drive it
 * against a real database without spawning a process.
 */
export async function runGrant(client, input) {
  await client.query('BEGIN');
  try {
    const accounts = await client.query(
      `SELECT a.id, a.tenant_id, a.status
         FROM iam.user_accounts a
        WHERE lower(a.email) = $1 AND a.deleted_at IS NULL`,
      [input.operator.email]
    );
    // An address may exist in several tenants as an ordinary user. The operator
    // is the one account among them that already holds platform authority.
    const holders = [];
    for (const account of accounts.rows) {
      const held = await client.query(
        `SELECT DISTINCT permission_code FROM iam.platform_grants
          WHERE account_id = $1 AND revoked_at IS NULL`,
        [account.id]
      );
      if (held.rowCount > 0) {
        holders.push({ ...account, held: held.rows.map((r) => r.permission_code).sort() });
      }
    }
    if (holders.length === 0) {
      fail(
        'Refused: no account with that address holds any platform authority. Establishing a first operator is genesis-platform-operator.mjs, not this script',
        4
      );
    }
    if (holders.length > 1) {
      fail(
        'Refused: more than one account with that address holds platform authority; repair by hand on a privileged connection',
        4
      );
    }
    const operator = holders[0];
    if (operator.status !== 'active') {
      fail(`Refused: the operator account ${operator.id} is ${operator.status}, not active`, 4);
    }

    const missing = PLATFORM_AUTHORITY_CODES.filter((code) => !operator.held.includes(code));
    if (missing.length === 0) {
      await client.query('ROLLBACK');
      return {
        outcome: 'already-complete',
        operatorAccountId: operator.id,
        homeTenantId: operator.tenant_id,
        grants: operator.held,
        grantedCodes: [],
      };
    }

    await client.query("SELECT set_config('app.user_id', $1, true)", [operator.id]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [operator.tenant_id]);
    for (const code of missing) {
      await client.query(
        `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
         VALUES ($1, $2, $3, $3)`,
        [operator.id, code, GRANT_ACTOR]
      );
    }
    const after = [...new Set([...operator.held, ...missing])].sort();
    const audit = await client.query(
      `SELECT iam.audit_append(
          p_tenant => $1, p_actor => $2, p_actor_kind => 'system',
          p_action => 'platform.operator.authority_granted', p_entity_type => 'iam.user_account',
          p_entity_id => $2, p_details => $3::jsonb
       ) AS id`,
      [
        operator.tenant_id,
        operator.id,
        JSON.stringify([
          {
            field: 'platform_grants',
            old: operator.held.join(','),
            new: after.join(','),
            class: 'public',
          },
          { field: 'granted_codes', old: null, new: missing.join(','), class: 'public' },
          { field: 'environment', old: null, new: input.environment, class: 'public' },
        ]),
      ]
    );

    const result = {
      outcome: input.dryRun ? 'dry-run' : 'granted',
      operatorAccountId: operator.id,
      homeTenantId: operator.tenant_id,
      grants: after,
      grantedCodes: missing,
      auditRecordId: audit.rows[0].id,
    };
    await client.query(input.dryRun ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is being discarded anyway.
    }
    throw error;
  }
}

function writeEvidence(input, result) {
  const path =
    input.evidencePath !== ''
      ? resolve(input.evidencePath)
      : resolve(
          `.tmp/platform-authority-grant-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        );
  mkdirSync(dirname(path), { recursive: true });
  const evidence = {
    what: 'platform operator authority completion (P1-32-PRE-020)',
    at: new Date().toISOString(),
    environment: input.environment,
    database: {
      host: input.db.host,
      port: input.db.port,
      name: input.db.database,
      user: input.db.user,
    },
    operator: { email: input.operator.email },
    result,
    secrets: 'none — no password, key or token is recorded here',
  };
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return path;
}

async function main() {
  const input = readGrantInput();
  const client = new pg.Client(input.db);
  await client.connect();
  let result;
  try {
    result = await runGrant(client, input);
  } finally {
    await client.end();
  }
  const path = writeEvidence(input, result);
  console.log(`Platform authority grant: ${result.outcome}`);
  console.log(`  operator account  ${result.operatorAccountId}`);
  console.log(`  home tenant       ${result.homeTenantId}`);
  console.log(`  grants            ${result.grants.join(', ')}`);
  console.log(
    `  newly granted     ${result.grantedCodes.length === 0 ? '(none)' : result.grantedCodes.join(', ')}`
  );
  if (result.auditRecordId) console.log(`  audit record      ${result.auditRecordId}`);
  console.log(`  evidence          ${path}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Platform authority grant refused: ${error.message}`);
    process.exit(error instanceof GrantRefused ? error.exitCode : 1);
  });
}
