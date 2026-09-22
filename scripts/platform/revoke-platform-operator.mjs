#!/usr/bin/env node
/**
 * Takes platform authority AWAY from an operator (P1-32-PRE-OD-UX).
 *
 * ## The gap this closes
 *
 * Three scripts could hand platform authority out — `genesis-platform-operator.mjs`
 * establishes the first holder, `add-platform-operator.mjs` mints a second, and
 * `grant-platform-authority.mjs` completes one who already holds a grant — and
 * nothing could take it back. `iam.platform_grants` carries `revoked_at` and
 * `revoked_by`, every resolver reads `revoked_at IS NULL`, and no code path
 * anywhere set either column: removing an operator meant editing the record by
 * hand on a privileged connection, outside every documented procedure.
 *
 * This is the supported way, and it is deliberately a SIBLING script rather than
 * a flag on the addition: revocation has refusals of its own that the addition
 * does not have, and its own database proof. It is the same KIND of act as the
 * other three — an operator act on a privileged connection, outside the product.
 * No route is added and no application role is admitted to `iam.platform_grants`.
 *
 * ## What it revokes: the whole of one operator's authority
 *
 * A run takes EVERY unrevoked platform grant the named account holds, not a
 * subset. There is no `--codes` flag here, and its absence is a decision: the
 * console's base entitlement `platform.organization.read` is what
 * `GET /platform/session` declares, so an operator left holding any set without
 * it is refused at the session read and bounced out of the console anyway. A
 * partial revocation would therefore either be a no-op on the base code or would
 * manufacture exactly the unusable grant set the three granting scripts refuse to
 * create. Narrowing an operator's authority is done by revoking them and adding
 * them again with the narrower set.
 *
 * ## Nothing is ever deleted
 *
 * Grants are UPDATEd to carry `revoked_at` and `revoked_by`; sessions are
 * UPDATEd to carry `revoked_at` and a reason. No row is removed by this script,
 * in any table, in any mode. The account itself is left exactly as it is —
 * `active`, in the home tenant, with its history — because an account and the
 * authority it holds are different facts and this script only touches the second.
 *
 * ## Why every run must PROVE a revoker
 *
 *   1. the revoker signs in at the identity provider with their own password —
 *      read from a no-echo prompt, or from `REVOKE_OPERATOR_GRANTOR_PASSWORD`,
 *      never from the command line and never logged;
 *   2. the provider identity that sign-in returns is resolved to an account in
 *      the operators' HOME TENANT that is `active` and holds at least one
 *      unrevoked platform grant.
 *
 * A caller with no credential is refused at (1). An organisation's own
 * administrator is refused at (2) twice over: their account is not in the home
 * tenant and it holds no platform grant.
 *
 * ## The two refusals this script exists for
 *
 * **The first owner is not revocable by this path.** Genesis records its act as
 * an `iam.audit_records` row with action `platform.operator.genesis` naming the
 * account it established — that record is how the first owner is identified, and
 * it is the only marker there is, because nothing on `iam.platform_grants`
 * distinguishes a genesis grant from a granted one (`genesis-platform-operator.mjs`
 * and `grant-platform-authority.mjs` both attribute `granted_by` to the same
 * catalogue actor). When the marker is ABSENT — an environment whose audit
 * history does not reach back that far — the fallback is structural: the account
 * holding the EARLIEST unrevoked platform grant on the platform is treated as the
 * first owner and refused. The fallback can refuse an account that is not
 * actually the first owner; it can never admit one that is, which is the
 * direction a lock-out rule has to fail in.
 *
 * **The last operator is not revocable at all.** A run that would leave no
 * account holding any unrevoked platform grant is refused before it writes.
 * Nothing in this repository can recover from that state: genesis refuses once a
 * grant exists for another account, the grant script cannot mint an operator, and
 * the addition script cannot prove a grantor when none exists.
 *
 * Both are checked in this script before anything is written, and asserted AGAIN
 * inside the same transaction by SQL that reads the rows just written rather than
 * the variables that wrote them.
 *
 * ## Sessions, stated as they are
 *
 * The same transaction revokes every unrevoked row this account holds in
 * `iam.user_sessions`, with a reason. Context resolution refuses a bearer whose
 * session row is revoked (`apps/api/src/server/context/resolve-context.ts`), so
 * every request from a session that existed before the run is refused from the
 * commit onwards.
 *
 * The identity provider is NOT reached, and that is a limitation rather than a
 * choice: `apps/api/src/modules/iam/provider/supabase-provider.ts` records that
 * GoTrue 2.x has no endpoint that ends every session of a user id — its
 * `revokeAllSessions(subject)` is deliberately a no-op that says so — and
 * `signOutEverywhere` needs the target's OWN access token, which an operator
 * revoking somebody else does not have. So an access token already issued to the
 * revoked operator keeps verifying at the provider until its own expiry
 * (residual W9-R1). It buys the holder nothing here: `iam.has_platform_authority`
 * requires an unrevoked grant, so every platform permission answers false and
 * every console request is denied `ERR-IAM-001` from the commit onwards,
 * whichever token is presented.
 *
 * ## What one run writes, in ONE transaction
 *
 *   1. `revoked_at` and `revoked_by` on every unrevoked grant of that account;
 *   2. `revoked_at` and `revoke_reason` on every unrevoked session of it;
 *   3. `platform.operator.authority_revoked` in the home tenant, naming the
 *      revoker, the account and the codes — identifiers only.
 *
 * `--dry-run` writes NOTHING: the transaction is rolled back, so no revocation,
 * no session change, no audit record and no evidence file survives it. Unlike the
 * addition, a dry run here has no provider effect at all — the only provider call
 * this script makes is the revoker's own sign-in.
 *
 * Inputs (environment; the command line carries only the confirmation and the
 * flags, so no address and no secret ever reaches a process listing):
 *
 *   ROOTLCO_ENV                       'local-acceptance' | 'production-genesis'
 *   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD   the privileged connection
 *   REVOKE_OPERATOR_EMAIL             the operator being revoked
 *   REVOKE_OPERATOR_REASON            why, recorded on every session and in the
 *                                     audit record
 *   REVOKE_OPERATOR_GRANTOR_EMAIL     the acting operator's address
 *   REVOKE_OPERATOR_GRANTOR_PASSWORD  optional, TRANSIENT: the acting operator's
 *                                     own password. Supply it for a
 *                                     non-interactive run only, export it for the
 *                                     single command and unset it immediately;
 *                                     with no terminal attached and no value, the
 *                                     run is refused. It is never written to
 *                                     evidence, never logged, and never passed as
 *                                     an argument.
 *   REVOKE_OPERATOR_IDENTITY_PROVIDER provider name (default 'supabase')
 *   REVOKE_OPERATOR_HOME_TENANT_CODE  default 'platform_operators'
 *   NEXT_PUBLIC_SUPABASE_URL          the identity provider
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY     used for the revoker's sign-in
 *   REVOKE_OPERATOR_EVIDENCE_PATH     where to write the evidence JSON
 *                                     (default .tmp/platform-operator-revoked-<ts>.json)
 *
 *   node scripts/platform/revoke-platform-operator.mjs --confirm <operator-email> [--dry-run]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import pg from 'pg';

const ALLOWED_ENVIRONMENTS = new Set(['local-acceptance', 'production-genesis']);

/**
 * The audit action genesis writes, and the only marker that names the first
 * owner. Spelled once here and read from `iam.audit_records` below.
 */
export const GENESIS_AUDIT_ACTION = 'platform.operator.genesis';

class RevokeRefused extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 2) {
  throw new RevokeRefused(message, exitCode);
}

/**
 * The refusal a would-be REVOKER earns, or `null` when they may revoke.
 *
 * A pure function of what the database answered, so
 * `tests/ci/platform-grant-base-entitlement.test.ts` can hand it candidates no
 * run would produce — absent, suspended, in an organisation, holding nothing —
 * and prove each is refused rather than assuming it.
 *
 * @param {{accountId: string, email: string, status: string, tenantCode: string, held: readonly string[]} | null | undefined} candidate
 * @param {string} homeTenantCode The operators' home tenant.
 * @returns {string | null}
 */
export function revokerRefusal(candidate, homeTenantCode) {
  if (!candidate) {
    return (
      'Refused: no revoker was proved. Taking platform authority away is an act performed BY an ' +
      'operator who holds it: the address must sign in at the identity provider, and that identity ' +
      'must resolve to an account in the operators home tenant'
    );
  }
  if (candidate.tenantCode !== homeTenantCode) {
    return (
      `Refused: the revoker account ${candidate.accountId} lives in "${candidate.tenantCode}", not ` +
      `in the operators home tenant "${homeTenantCode}". An organisation's own administrator holds ` +
      'no platform authority and cannot take any away'
    );
  }
  if (candidate.status !== 'active') {
    return `Refused: the revoker account ${candidate.accountId} is ${candidate.status}, not active`;
  }
  if (!Array.isArray(candidate.held) || candidate.held.length === 0) {
    return (
      `Refused: the revoker account ${candidate.accountId} holds no unrevoked platform grant, so ` +
      'it holds no authority over anybody elses'
    );
  }
  return null;
}

/**
 * The refusal the named TARGET earns for what it is, or `null`.
 *
 * Separate from the two rules below, which are about what revoking it would
 * COST: this one is only about whether the address names a platform operator at
 * all. An address nobody holds, an address in some organisation, and an operator
 * whose authority is already revoked are each a different message, because each
 * is a different mistake.
 *
 * @param {{accountId: string, status: string, tenantCode: string, held: readonly string[]} | null | undefined} target
 * @param {string} homeTenantCode
 * @returns {string | null}
 */
export function targetRefusal(target, homeTenantCode) {
  if (!target) {
    return (
      'Refused: no account holds that address. This script revokes an EXISTING platform operator ' +
      'and creates nothing'
    );
  }
  if (target.tenantCode !== homeTenantCode) {
    return (
      `Refused: the account ${target.accountId} lives in "${target.tenantCode}", not in the ` +
      `operators home tenant "${homeTenantCode}". It is an organisation's own user and holds no ` +
      'platform authority to revoke'
    );
  }
  if (!Array.isArray(target.held) || target.held.length === 0) {
    return (
      `Refused: the account ${target.accountId} holds no unrevoked platform grant. There is ` +
      'nothing to revoke, and this script does not delete an account'
    );
  }
  return null;
}

/**
 * The refusal the FIRST OWNER earns, or `null` when the target is not one.
 *
 * `genesisMarked` is the presence of the `platform.operator.genesis` audit record
 * naming this account — the marker genesis itself writes. `earliestHolder` is the
 * structural fallback, true when this account holds the earliest unrevoked
 * platform grant on the platform; it is consulted ONLY when the marker is absent,
 * so an environment that still carries its genesis record is judged by that
 * record rather than by an ordering that a later repair could disturb.
 *
 * @param {{accountId: string, genesisMarked: boolean, earliestHolder: boolean}} target
 * @returns {string | null}
 */
export function firstOwnerRefusal(target) {
  if (target?.genesisMarked === true) {
    return (
      `Refused: the account ${target.accountId} is the platform's first owner — the account named ` +
      `by the ${GENESIS_AUDIT_ACTION} record. The root of trust is not revocable through this ` +
      'script, in any environment'
    );
  }
  if (target?.earliestHolder === true) {
    return (
      `Refused: no ${GENESIS_AUDIT_ACTION} record exists on this platform, so the first owner is ` +
      `identified structurally, and the account ${target.accountId} holds the earliest unrevoked ` +
      'platform grant. That account is treated as the first owner and is not revocable through ' +
      'this script'
    );
  }
  return null;
}

/**
 * The refusal a run earns for emptying the platform, or `null`.
 *
 * `remainingHolders` is every account that would still hold an unrevoked platform
 * grant AFTER this run — the target excluded. Zero is the lock-out this rule
 * exists for, and it is unrecoverable: no script in this repository can establish
 * an operator once a grant has ever existed for a different account.
 *
 * @param {readonly string[] | undefined} remainingHolders
 * @returns {string | null}
 */
export function lastOperatorRefusal(remainingHolders) {
  const remaining = remainingHolders ?? [];
  if (remaining.length === 0) {
    return (
      'Refused: that account is the last holder of platform authority, and revoking it would leave ' +
      'the platform with no operator at all. Nothing in this repository recovers from that state: ' +
      'genesis refuses once a grant exists for another account, grant-platform-authority.mjs ' +
      'cannot mint an operator, and add-platform-operator.mjs cannot prove a grantor when none ' +
      'exists. Add another operator first'
    );
  }
  return null;
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

/** Reads what the run needs. Secrets stay in this object and are never logged. */
export function readRevokeOperatorInput(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const environment = env.ROOTLCO_ENV;
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    fail("Fail closed: ROOTLCO_ENV must be exactly 'local-acceptance' or 'production-genesis'");
  }
  const email = (env.REVOKE_OPERATOR_EMAIL ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('REVOKE_OPERATOR_EMAIL is not an address');
  if (args.confirm.trim().toLowerCase() !== email) {
    fail('--confirm must exactly match REVOKE_OPERATOR_EMAIL');
  }
  // Non-blank because `ck_user_sessions_revoke_reason` requires one on every
  // session this run ends, and because a revocation with no stated reason is a
  // record nobody can act on later.
  const reason = (env.REVOKE_OPERATOR_REASON ?? '').trim();
  if (reason === '') fail('REVOKE_OPERATOR_REASON is required');
  if (reason.length > 500) fail('REVOKE_OPERATOR_REASON is longer than 500 characters');
  const revokerEmail = (env.REVOKE_OPERATOR_GRANTOR_EMAIL ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(revokerEmail)) {
    fail('REVOKE_OPERATOR_GRANTOR_EMAIL is not an address');
  }
  const provider = (env.REVOKE_OPERATOR_IDENTITY_PROVIDER ?? 'supabase').trim();
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(provider)) {
    fail('REVOKE_OPERATOR_IDENTITY_PROVIDER is malformed');
  }
  const homeTenantCode = (env.REVOKE_OPERATOR_HOME_TENANT_CODE ?? 'platform_operators').trim();
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(homeTenantCode)) {
    fail('REVOKE_OPERATOR_HOME_TENANT_CODE is malformed');
  }
  return {
    environment,
    dryRun: args.dryRun,
    reason,
    db: {
      host: env.DB_HOST ?? '127.0.0.1',
      port: Number(env.DB_PORT ?? 54322),
      database: env.DB_NAME ?? 'postgres',
      user: env.DB_USER ?? 'postgres',
      password: env.DB_PASSWORD ?? 'postgres',
    },
    operator: { email, provider },
    revoker: { email: revokerEmail, password: env.REVOKE_OPERATOR_GRANTOR_PASSWORD ?? '' },
    supabase: {
      url: (env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim(),
      anonKey: (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim(),
    },
    homeTenantCode,
    evidencePath: env.REVOKE_OPERATOR_EVIDENCE_PATH ?? '',
  };
}

/**
 * Reads the revoker's password from the terminal without echoing it.
 *
 * Refuses rather than reading a blind line when there is no terminal: a run piped
 * from a file would otherwise consume whatever arrived on stdin and call it a
 * password.
 */
async function promptRevokerPassword(email) {
  if (!process.stdin.isTTY) {
    fail(
      'Refused: no terminal is attached, so the revoker password cannot be prompted for. Export ' +
        'REVOKE_OPERATOR_GRANTOR_PASSWORD for this single command and unset it immediately ' +
        'afterwards',
      3
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    process.stdout.write(`Password for ${email} (not echoed): `);
    const muted = (_chunk, _encoding, callback) => {
      if (typeof callback === 'function') callback();
      return true;
    };
    const original = rl.output.write.bind(rl.output);
    rl.output.write = muted;
    const answer = await new Promise((done) => rl.question('', done));
    rl.output.write = original;
    process.stdout.write('\n');
    return answer;
  } finally {
    rl.close();
  }
}

/**
 * Proves the revoker at the identity provider and returns the subject that
 * sign-in belongs to. The password is sent once, in a request body, and never
 * reaches a log, an argument list or the evidence file.
 */
export async function proveRevokerIdentity(input, password) {
  if (input.supabase.url === '' || input.supabase.anonKey === '') {
    fail(
      'Refused: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required — the ' +
        'revoker proves their identity by signing in, and this run cannot reach the provider',
      3
    );
  }
  if (password === '') fail('Refused: the revoker supplied no password', 3);
  const response = await fetch(`${input.supabase.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: input.supabase.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: input.revoker.email, password }),
  });
  if (!response.ok) {
    fail(`Refused: the identity provider did not accept the revoker (${response.status})`, 3);
  }
  const body = await response.json();
  const subject = body?.user?.id;
  if (!subject) fail('Refused: the identity provider returned no subject for the revoker', 3);
  return String(subject);
}

/**
 * The one undeleted account a predicate names, with the platform codes it holds,
 * or `null` when the predicate names none or more than one.
 *
 * `where` is a fixed fragment supplied by this module only — never by input —
 * and every value it compares travels as a bound parameter.
 */
async function readAccount(client, where, values) {
  const found = await client.query(
    `SELECT a.id, a.email, a.status, a.tenant_id, t.tenant_code
       FROM iam.user_accounts a
       JOIN org.tenants t ON t.id = a.tenant_id
      WHERE ${where} AND a.deleted_at IS NULL`,
    values
  );
  if (found.rowCount !== 1) return null;
  const row = found.rows[0];
  const held = await client.query(
    `SELECT DISTINCT permission_code FROM iam.platform_grants
      WHERE account_id = $1 AND revoked_at IS NULL`,
    [row.id]
  );
  return {
    accountId: row.id,
    email: String(row.email).toLowerCase(),
    status: row.status,
    tenantId: row.tenant_id,
    tenantCode: row.tenant_code,
    held: held.rows.map((r) => r.permission_code).sort(),
  };
}

/**
 * Runs the revocation on an open client. Exported so the proof suite can drive it
 * against a real database without spawning a process or a provider.
 *
 * `provenSubject` is the provider subject the REVOKER's sign-in returned; the
 * revoker is resolved from it inside the transaction, so the authority check
 * reads the database rather than trusting an argument.
 */
export async function runRevokeOperator(client, input, provenSubject) {
  const homeTenantCode = input.homeTenantCode ?? 'platform_operators';
  await client.query('BEGIN');
  try {
    // 1. The revoker, from the identity their sign-in proved.
    const candidate = await readAccount(
      client,
      'a.identity_provider = $1 AND a.provider_subject = $2',
      [input.operator.provider, provenSubject ?? '']
    );
    const revokerProblem = revokerRefusal(candidate, homeTenantCode);
    if (revokerProblem) fail(revokerProblem, 4);
    const acting = candidate;

    // 2. The target, by address.
    const target = await readAccount(client, 'lower(a.email) = $1', [input.operator.email]);
    const targetProblem = targetRefusal(target, homeTenantCode);
    if (targetProblem) fail(targetProblem, 4);

    // 3. The first owner: the genesis marker, or the structural fallback.
    const marker = await client.query(
      `SELECT EXISTS (
         SELECT 1 FROM iam.audit_records WHERE action = $1 AND entity_id = $2
       ) AS marked,
       EXISTS (SELECT 1 FROM iam.audit_records WHERE action = $1) AS any_marker`,
      [GENESIS_AUDIT_ACTION, target.accountId]
    );
    const earliest = await client.query(
      `SELECT g.account_id
         FROM iam.platform_grants g
         JOIN iam.user_accounts a ON a.id = g.account_id
        WHERE g.revoked_at IS NULL AND a.deleted_at IS NULL
        ORDER BY g.granted_at, g.id
        LIMIT 1`
    );
    const ownerProblem = firstOwnerRefusal({
      accountId: target.accountId,
      genesisMarked: marker.rows[0].marked === true,
      // Consulted only when NO genesis record exists anywhere on this platform:
      // with one present, the marker above is the answer and an ordering cannot
      // overrule it.
      earliestHolder:
        marker.rows[0].any_marker !== true && earliest.rows[0]?.account_id === target.accountId,
    });
    if (ownerProblem) fail(ownerProblem, 4);

    // 4. The lock-out rule: who would be left.
    const remaining = await client.query(
      `SELECT DISTINCT g.account_id
         FROM iam.platform_grants g
         JOIN iam.user_accounts a ON a.id = g.account_id
        WHERE g.revoked_at IS NULL AND a.deleted_at IS NULL AND a.status = 'active'
          AND g.account_id <> $1`,
      [target.accountId]
    );
    const lockOut = lastOperatorRefusal(remaining.rows.map((row) => row.account_id));
    if (lockOut) fail(lockOut, 4);

    await client.query("SELECT set_config('app.user_id', $1, true)", [acting.accountId]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [acting.tenantId]);

    // 5. The grants. UPDATE, never DELETE: the revoked history stays addressable,
    //    and `uq_platform_grants_active` is partial on `revoked_at IS NULL`, so a
    //    revoked pair can be granted again later.
    const revoked = await client.query(
      `UPDATE iam.platform_grants
          SET revoked_at = now(), revoked_by = $2,
              updated_at = now(), updated_by = $2,
              record_version = record_version + 1
        WHERE account_id = $1 AND revoked_at IS NULL
        RETURNING permission_code`,
      [target.accountId, acting.accountId]
    );
    const revokedCodes = revoked.rows.map((row) => row.permission_code).sort();

    // 6. The sessions. `updated_by` is stamped by tg_user_sessions_touch_metadata
    //    from the session context set above, so it is not written here.
    const sessions = await client.query(
      `UPDATE iam.user_sessions
          SET revoked_at = now(), revoke_reason = $2
        WHERE user_id = $1 AND revoked_at IS NULL
        RETURNING id`,
      [target.accountId, input.reason]
    );

    // 7. The same rules, asserted by SQL over the rows just written rather than
    //    over the variables that wrote them. A refusal here rolls everything
    //    back, so a drift between the checks above and the rows below can never
    //    commit.
    const verified = await client.query(
      `SELECT
         (SELECT count(*) FROM iam.platform_grants
           WHERE account_id = $1 AND revoked_at IS NULL)::int AS still_held,
         (SELECT count(*) FROM iam.platform_grants
           WHERE account_id = $1 AND revoked_at IS NOT NULL AND revoked_by <> $2)::int AS misattributed,
         (SELECT count(DISTINCT g.account_id) FROM iam.platform_grants g
            JOIN iam.user_accounts a ON a.id = g.account_id
           WHERE g.revoked_at IS NULL AND a.deleted_at IS NULL AND a.status = 'active')::int AS holders,
         (SELECT count(*) FROM iam.user_accounts WHERE id = $1)::int AS account_kept,
         (SELECT count(*) FROM iam.user_sessions
           WHERE user_id = $1 AND revoked_at IS NULL)::int AS live_sessions`,
      [target.accountId, acting.accountId]
    );
    const check = verified.rows[0];
    if (check.still_held !== 0) {
      fail(
        `Refused in-transaction: ${check.still_held} platform grants of that account are still unrevoked`,
        4
      );
    }
    if (check.misattributed > 0) {
      fail(
        'Refused in-transaction: a revoked grant of that account is attributed to someone other than the revoker',
        4
      );
    }
    if (check.holders === 0) {
      fail('Refused in-transaction: this run would leave the platform with no operator', 4);
    }
    if (check.account_kept !== 1) {
      fail('Refused in-transaction: the revoked account row no longer exists', 4);
    }
    if (check.live_sessions !== 0) {
      fail('Refused in-transaction: that account still holds a live session', 4);
    }

    // 8. The audit record, in the home tenant, identifiers only.
    const audit = await client.query(
      `SELECT iam.audit_append(
          p_tenant => $1, p_actor => $2, p_actor_kind => 'system',
          p_action => 'platform.operator.authority_revoked', p_entity_type => 'iam.user_account',
          p_entity_id => $3, p_details => $4::jsonb
       ) AS id`,
      [
        acting.tenantId,
        acting.accountId,
        target.accountId,
        JSON.stringify([
          { field: 'platform_grants', old: revokedCodes.join(','), new: null, class: 'public' },
          { field: 'revoked_by', old: null, new: acting.accountId, class: 'internal' },
          { field: 'home_tenant_id', old: null, new: acting.tenantId, class: 'internal' },
          {
            field: 'sessions_ended',
            old: null,
            new: String(sessions.rowCount ?? 0),
            class: 'internal',
          },
          { field: 'reason', old: null, new: input.reason, class: 'internal' },
          { field: 'identity_provider', old: null, new: input.operator.provider, class: 'public' },
          { field: 'environment', old: null, new: input.environment, class: 'public' },
        ]),
      ]
    );

    const result = {
      outcome: input.dryRun ? 'dry-run' : 'revoked',
      operatorAccountId: target.accountId,
      homeTenantId: acting.tenantId,
      revokerAccountId: acting.accountId,
      revokedGrants: revokedCodes,
      sessionsEnded: sessions.rowCount ?? 0,
      remainingOperators: check.holders,
      auditRecordId: audit.rows[0].id,
    };
    if (input.dryRun) {
      await client.query('ROLLBACK');
      return result;
    }
    await client.query('COMMIT');
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
          `.tmp/platform-operator-revoked-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        );
  mkdirSync(dirname(path), { recursive: true });
  const evidence = {
    what: 'platform authority revoked from an operator (P1-32-PRE-OD-UX)',
    at: new Date().toISOString(),
    environment: input.environment,
    database: {
      host: input.db.host,
      port: input.db.port,
      name: input.db.database,
      user: input.db.user,
    },
    operator: { email: input.operator.email, identityProvider: input.operator.provider },
    revoker: { email: input.revoker.email },
    reason: input.reason,
    providerSessions:
      'not ended — GoTrue 2.x has no endpoint that ends every session of a user id, so an already ' +
      'issued access token keeps verifying until it expires. It grants no platform authority: ' +
      'iam.has_platform_authority requires an unrevoked grant',
    result,
    secrets: 'none — no password, key or token is recorded here',
  };
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return path;
}

async function main() {
  const input = readRevokeOperatorInput();
  const password =
    input.revoker.password !== ''
      ? input.revoker.password
      : await promptRevokerPassword(input.revoker.email);
  const provenSubject = await proveRevokerIdentity(input, password);

  const client = new pg.Client(input.db);
  await client.connect();
  let result;
  try {
    result = await runRevokeOperator(client, input, provenSubject);
  } finally {
    await client.end();
  }

  if (input.dryRun) {
    console.log('Platform authority revocation: dry run, nothing written');
    console.log(`  operator account  ${result.operatorAccountId}`);
    console.log(`  revoker account   ${result.revokerAccountId}`);
    console.log(`  would revoke      ${result.revokedGrants.join(', ')}`);
    console.log(`  would end         ${result.sessionsEnded} session(s)`);
    console.log(`  operators left    ${result.remainingOperators}`);
    return;
  }
  const path = writeEvidence(input, result);
  console.log(`Platform authority revocation: ${result.outcome}`);
  console.log(`  operator account  ${result.operatorAccountId}`);
  console.log(`  revoked by        ${result.revokerAccountId}`);
  console.log(`  home tenant       ${result.homeTenantId}`);
  console.log(`  grants revoked    ${result.revokedGrants.join(', ')}`);
  console.log(`  sessions ended    ${result.sessionsEnded}`);
  console.log(`  operators left    ${result.remainingOperators}`);
  console.log(`  audit record      ${result.auditRecordId}`);
  console.log(`  provider sessions not ended — see the evidence file`);
  console.log(`  evidence          ${path}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Platform authority revocation refused: ${error.message}`);
    process.exit(error instanceof RevokeRefused ? error.exitCode : 1);
  });
}
