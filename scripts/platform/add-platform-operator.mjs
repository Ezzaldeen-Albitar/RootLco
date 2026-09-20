#!/usr/bin/env node
/**
 * Adds a SECOND (third, fourth …) platform operator — the gap between the two
 * sibling scripts (P1-32-PRE-OD-OPERATOR).
 *
 * ## The gap this closes
 *
 * `genesis-platform-operator.mjs` establishes the FIRST holder of platform
 * authority and refuses once any other account holds an unrevoked grant; that
 * one-time refusal is the whole point of it and stays exactly as it is.
 * `grant-platform-authority.mjs` completes an operator who ALREADY holds a
 * grant, and refuses an account holding none; that refusal is what makes it
 * structurally incapable of minting an operator. Between them there was no
 * supported way to add a second operator at all.
 *
 * This is that way, and it is deliberately the same KIND of act as the other
 * two: an operator act on a privileged database connection, outside the
 * product. No route is added, no application role is admitted to
 * `iam.platform_grants`, and a gate under `scripts/ci` keeps the writers of
 * that table enumerated.
 *
 * ## Why it is safe to have a second door at all
 *
 * Because it is not an unauthenticated one. Every run must PROVE a grantor:
 *
 *   1. the grantor signs in at the identity provider with their own password —
 *      read from a no-echo prompt, or from `ADD_OPERATOR_GRANTOR_PASSWORD`,
 *      never from the command line and never logged;
 *   2. the provider identity that sign-in returns is resolved to an account in
 *      the operators' HOME TENANT that is `active` and holds at least one
 *      unrevoked platform grant.
 *
 * A caller with no credential is refused at (1). A tenant administrator — of
 * any organisation, however privileged inside it — is refused at (2) twice
 * over: their account is not in the home tenant and it holds no platform
 * grant. There is no bootstrap path: with no operator in existence, no grantor
 * can be proved, and establishing the first one remains genesis's act.
 *
 * ## The grant rules, enforced twice
 *
 * Checked in this script before anything is written, and asserted AGAIN inside
 * the same transaction by SQL that reads the rows just written rather than the
 * variables that wrote them:
 *
 *   - the requested set contains `platform.organization.read`, the console's
 *     base entitlement (`platformGrantSetRefusal`, shared with both siblings),
 *     and names only codes the catalogue ships for platform authority
 *     (`requestedGrantSetRefusal`);
 *   - the requested set is a SUBSET of the grantor's own unrevoked codes — an
 *     operator cannot hand out authority they do not hold;
 *   - the grantor is not the grantee (refused here, before
 *     `ck_platform_grants_no_self_grant` would);
 *   - `granted_by` is the grantor's own account id, so the trail names a person
 *     rather than the catalogue actor;
 *   - the new account is created with ZERO tenant roles.
 *
 * ## What one run writes, in ONE transaction
 *
 *   1. the new operator's account in the home tenant, `active`, with its
 *      status-history row and no role grant of any kind;
 *   2. one `iam.platform_grants` row per requested code, `granted_by` the
 *      grantor;
 *   3. `platform.operator.authority_granted` in the home tenant, naming the
 *      grantor, the grantee and the codes — identifiers only.
 *
 * `--dry-run` prints the plan and writes nothing.
 *
 * ## Identity handling
 *
 *   - the lower-cased address is serialized with the SAME advisory lock the
 *     application's invitation path takes
 *     (`apps/api/src/modules/iam/data/identity-repository.ts`,
 *     `lockInvitationAddress`), so this script and a concurrent invitation of
 *     the same address cannot both read "no identity" and be handed the same
 *     subject;
 *   - an account with that address already in the home tenant is refused, with
 *     a message pointing at `grant-platform-authority.mjs`;
 *   - an account with that address in ANY other tenant is refused: a tenant
 *     user does not become an operator through this path;
 *   - a provider identity that exists with no account anywhere is REUSED;
 *   - otherwise the identity is invited the way genesis invites one, and bound
 *     to the home tenant through `app_metadata`.
 *
 * ## Partial failure
 *
 * If the transaction fails after this run created a provider identity, exactly
 * that identity — by the id this run was handed, never by address and never a
 * pre-existing one — is deleted, and the compensation is reported. If the
 * compensation itself fails, the identity id and the manual remedy are printed.
 *
 * ## Not in this script
 *
 * Revocation. Taking authority away has its own refusals (the last holder of
 * the base code, the last operator, a revoked grant's audit class) and its own
 * database proof; it is not folded in here as a flag.
 *
 * Inputs (environment; the command line carries only the confirmation and the
 * flags, so no address and no secret ever reaches a process listing):
 *
 *   ROOTLCO_ENV                     'local-acceptance' | 'production-genesis'
 *   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD   the privileged connection
 *   ADD_OPERATOR_EMAIL              the NEW operator's address
 *   ADD_OPERATOR_DISPLAY_NAME       the new operator's display name
 *   ADD_OPERATOR_GRANTOR_EMAIL      the acting operator's address
 *   ADD_OPERATOR_GRANTOR_PASSWORD   optional, TRANSIENT: the grantor's own
 *                                   password. Supply it for a non-interactive
 *                                   run only, export it for the single command
 *                                   and unset it immediately; with no terminal
 *                                   attached and no value, the run is refused.
 *                                   It is never written to evidence, never
 *                                   logged, and never passed as an argument.
 *   ADD_OPERATOR_IDENTITY_PROVIDER  provider name (default 'supabase')
 *   ADD_OPERATOR_HOME_TENANT_CODE   default 'platform_operators'
 *   NEXT_PUBLIC_SUPABASE_URL        the identity provider
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY   used for the grantor's sign-in
 *   SUPABASE_SERVICE_ROLE_KEY       used to look up, invite, bind and (on
 *                                   compensation) delete the grantee identity
 *   ADD_OPERATOR_EVIDENCE_PATH      where to write the evidence JSON
 *                                   (default .tmp/platform-operator-added-<ts>.json)
 *
 *   node scripts/platform/add-platform-operator.mjs --confirm <new-operator-email> \
 *        [--codes a,b,...] [--dry-run]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import pg from 'pg';
import {
  PLATFORM_BASE_AUTHORITY_CODE,
  platformGrantSetRefusal,
} from './genesis-platform-operator.mjs';
import { requestedGrantSetRefusal } from './grant-platform-authority.mjs';

const ALLOWED_ENVIRONMENTS = new Set(['local-acceptance', 'production-genesis']);

/**
 * The advisory lock the application's invitation path takes, replicated
 * verbatim.
 *
 * `apps/api` is TypeScript behind module boundaries that scripts may not
 * import, so the statement is copied rather than called — and because a copy
 * drifts, `tests/ci/platform-grant-base-entitlement.test.ts` reads both files
 * and fails when the two spellings differ. The key must be identical or the two
 * paths take DIFFERENT locks and serialize nothing.
 */
export const INVITATION_ADDRESS_LOCK_SQL = `SELECT pg_catalog.pg_advisory_xact_lock(
                pg_catalog.hashtextextended('iam.invitation.address:' || pg_catalog.lower($1::text), 0))`;

class AddOperatorRefused extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 2) {
  throw new AddOperatorRefused(message, exitCode);
}

/**
 * The refusal a would-be GRANTOR earns, or `null` when they may grant.
 *
 * A pure function of what the database answered, so
 * `tests/ci/platform-grant-base-entitlement.test.ts` can hand it candidates no
 * run would produce — absent, suspended, in a tenant, holding nothing — and
 * prove each is refused rather than assuming it.
 *
 * @param {{accountId: string, email: string, status: string, tenantCode: string, held: readonly string[]} | null | undefined} candidate
 * @param {string} homeTenantCode The operators' home tenant.
 * @returns {string | null}
 */
export function grantorRefusal(candidate, homeTenantCode) {
  if (!candidate) {
    return (
      'Refused: no grantor was proved. This script grants authority ON BEHALF OF an operator who ' +
      'already holds it: the address must sign in at the identity provider, and that identity must ' +
      'resolve to an account in the operators home tenant. Establishing a FIRST operator is ' +
      'genesis-platform-operator.mjs, not this script'
    );
  }
  if (candidate.tenantCode !== homeTenantCode) {
    return (
      `Refused: the grantor account ${candidate.accountId} lives in "${candidate.tenantCode}", not ` +
      `in the operators home tenant "${homeTenantCode}". An organisation's own administrator holds ` +
      'no platform authority and cannot grant any'
    );
  }
  if (candidate.status !== 'active') {
    return `Refused: the grantor account ${candidate.accountId} is ${candidate.status}, not active`;
  }
  if (!Array.isArray(candidate.held) || candidate.held.length === 0) {
    return (
      `Refused: the grantor account ${candidate.accountId} holds no unrevoked platform grant, so ` +
      'there is no authority for it to pass on'
    );
  }
  return null;
}

/**
 * The refusal a requested set earns given what the grantor HOLDS, or `null`.
 *
 * Layered on `requestedGrantSetRefusal` — which already applies the base
 * entitlement and the catalogue's own list — with the one rule this path adds:
 * nobody hands out authority they do not have.
 *
 * @param {readonly string[] | undefined} requested
 * @param {readonly string[]} grantorHeld
 * @returns {string | null}
 */
export function overGrantRefusal(requested, grantorHeld) {
  // The base-entitlement rule, consulted DIRECTLY rather than only through the
  // stricter function below. Every code path that writes `iam.platform_grants`
  // calls this one function before it writes, and the gate in
  // `tests/ci/platform-grant-base-entitlement.test.ts` reads each writer to
  // prove the call is there rather than taking a docblock's word for it.
  const base = platformGrantSetRefusal(requested);
  if (base) return base;
  const shared = requestedGrantSetRefusal(requested);
  if (shared) return shared;
  const held = new Set(grantorHeld ?? []);
  const beyond = [...new Set(requested)].filter((code) => !held.has(code)).sort();
  if (beyond.length > 0) {
    return (
      `Refused: the grantor does not hold ${beyond.join(', ')}, so this run would grant authority ` +
      'the grantor does not have. A platform operator may pass on a subset of their own codes and ' +
      'nothing more'
    );
  }
  return null;
}

/**
 * The refusal a grantor/grantee pair earns when they are the same person.
 *
 * Refused here rather than left to `ck_platform_grants_no_self_grant`, so the
 * message names the act instead of a constraint. A run that reaches the check
 * constraint has already opened a transaction and written an account.
 *
 * @param {string} grantorEmail
 * @param {string} granteeEmail
 * @returns {string | null}
 */
export function selfGrantRefusal(grantorEmail, granteeEmail) {
  if ((grantorEmail ?? '').trim().toLowerCase() === (granteeEmail ?? '').trim().toLowerCase()) {
    return (
      'Refused: the grantor and the new operator are the same address. Adding codes to your own ' +
      'account is grant-platform-authority.mjs; this script adds a DIFFERENT operator'
    );
  }
  return null;
}

/**
 * The refusal the new operator's ADDRESS earns, or `null` when it is free.
 *
 * @param {readonly {accountId: string, tenantCode: string}[]} existing Every
 *   undeleted account holding that address, in every tenant.
 * @param {string} homeTenantCode
 * @returns {string | null}
 */
export function granteeAddressRefusal(existing, homeTenantCode) {
  const rows = existing ?? [];
  const atHome = rows.find((row) => row.tenantCode === homeTenantCode);
  if (atHome) {
    return (
      `Refused: an account with that address already exists in the operators home tenant ` +
      `(${atHome.accountId}). Adding codes to an existing operator is ` +
      'grant-platform-authority.mjs; this script creates a new one'
    );
  }
  const elsewhere = rows[0];
  if (elsewhere) {
    return (
      `Refused: that address already belongs to an account in "${elsewhere.tenantCode}" ` +
      `(${elsewhere.accountId}). An organisation's own user does not become a platform operator ` +
      'through this path; use an address that belongs to no organisation'
    );
  }
  return null;
}

function parseArgs(argv) {
  const parsed = { confirm: undefined, dryRun: false, codes: undefined };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') parsed.dryRun = true;
    else if (arg === '--confirm') {
      parsed.confirm = argv[++index];
      if (!parsed.confirm) fail('--confirm requires the new operator address');
    } else if (arg === '--codes') {
      const list = argv[++index];
      if (!list) fail('--codes requires a comma-separated list of platform authority codes');
      parsed.codes = list
        .split(',')
        .map((code) => code.trim())
        .filter((code) => code.length > 0);
    } else fail(`Unknown argument: ${arg}`);
  }
  if (!parsed.confirm) fail('Missing required --confirm <new-operator-email>');
  return parsed;
}

/** Reads what the run needs. Secrets stay in this object and are never logged. */
export function readAddOperatorInput(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const environment = env.ROOTLCO_ENV;
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    fail("Fail closed: ROOTLCO_ENV must be exactly 'local-acceptance' or 'production-genesis'");
  }
  const email = (env.ADD_OPERATOR_EMAIL ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('ADD_OPERATOR_EMAIL is not an address');
  if (args.confirm.trim().toLowerCase() !== email) {
    fail('--confirm must exactly match ADD_OPERATOR_EMAIL');
  }
  const displayName = (env.ADD_OPERATOR_DISPLAY_NAME ?? '').trim();
  if (displayName === '') fail('ADD_OPERATOR_DISPLAY_NAME is required');
  const grantorEmail = (env.ADD_OPERATOR_GRANTOR_EMAIL ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(grantorEmail)) {
    fail('ADD_OPERATOR_GRANTOR_EMAIL is not an address');
  }
  const selfRefusal = selfGrantRefusal(grantorEmail, email);
  if (selfRefusal) fail(selfRefusal, 4);
  const provider = (env.ADD_OPERATOR_IDENTITY_PROVIDER ?? 'supabase').trim();
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(provider)) fail('ADD_OPERATOR_IDENTITY_PROVIDER is malformed');
  const homeTenantCode = (env.ADD_OPERATOR_HOME_TENANT_CODE ?? 'platform_operators').trim();
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(homeTenantCode)) {
    fail('ADD_OPERATOR_HOME_TENANT_CODE is malformed');
  }
  // `undefined` means "the grantor's own full set", resolved from the database
  // once the grantor is proved. An explicitly named set is refused here.
  if (args.codes !== undefined) {
    const refusal = requestedGrantSetRefusal(args.codes);
    if (refusal) fail(refusal, 4);
  }
  return {
    environment,
    dryRun: args.dryRun,
    codes: args.codes === undefined ? undefined : [...new Set(args.codes)].sort(),
    db: {
      host: env.DB_HOST ?? '127.0.0.1',
      port: Number(env.DB_PORT ?? 54322),
      database: env.DB_NAME ?? 'postgres',
      user: env.DB_USER ?? 'postgres',
      password: env.DB_PASSWORD ?? 'postgres',
    },
    operator: { email, displayName, provider },
    grantor: { email: grantorEmail, password: env.ADD_OPERATOR_GRANTOR_PASSWORD ?? '' },
    supabase: {
      url: (env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim(),
      anonKey: (env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '').trim(),
      serviceRoleKey: (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim(),
    },
    homeTenantCode,
    evidencePath: env.ADD_OPERATOR_EVIDENCE_PATH ?? '',
  };
}

/**
 * Reads the grantor's password from the terminal without echoing it.
 *
 * Refuses rather than reading a blind line when there is no terminal: a run
 * piped from a file would otherwise consume whatever arrived on stdin and call
 * it a password.
 */
async function promptGrantorPassword(email) {
  if (!process.stdin.isTTY) {
    fail(
      'Refused: no terminal is attached, so the grantor password cannot be prompted for. Export ' +
        'ADD_OPERATOR_GRANTOR_PASSWORD for this single command and unset it immediately afterwards',
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
 * Proves the grantor at the identity provider and returns the subject that
 * sign-in belongs to. The password is sent once, in a request body, and never
 * reaches a log, an argument list or the evidence file.
 */
export async function proveGrantorIdentity(input, password) {
  if (input.supabase.url === '' || input.supabase.anonKey === '') {
    fail(
      'Refused: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required — the ' +
        'grantor proves their identity by signing in, and this run cannot reach the provider',
      3
    );
  }
  if (password === '') fail('Refused: the grantor supplied no password', 3);
  const response = await fetch(`${input.supabase.url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: input.supabase.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: input.grantor.email, password }),
  });
  if (!response.ok) {
    fail(`Refused: the identity provider did not accept the grantor (${response.status})`, 3);
  }
  const body = await response.json();
  const subject = body?.user?.id;
  if (!subject) fail('Refused: the identity provider returned no subject for the grantor', 3);
  return String(subject);
}

const serviceHeaders = (input) => ({
  apikey: input.supabase.serviceRoleKey,
  Authorization: `Bearer ${input.supabase.serviceRoleKey}`,
  'Content-Type': 'application/json',
});

/**
 * Finds or invites the NEW operator's provider identity. Returns the subject
 * and whether THIS run created it — the second half is what the compensation
 * below is allowed to delete. Never logs the key.
 */
export async function establishGranteeIdentity(input) {
  if (input.supabase.url === '' || input.supabase.serviceRoleKey === '') {
    fail(
      'Refused: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to establish ' +
        "the new operator's identity",
      3
    );
  }
  const headers = serviceHeaders(input);
  const lookup = await fetch(`${input.supabase.url}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers,
  });
  if (!lookup.ok) fail(`The identity provider refused the admin lookup (${lookup.status})`, 3);
  const listed = await lookup.json();
  const users = Array.isArray(listed?.users) ? listed.users : [];
  const existing = users.find((u) => String(u.email ?? '').toLowerCase() === input.operator.email);
  // An identity with no account anywhere is REUSED: the transaction below
  // refuses the address if any account already claims it, so reaching this
  // point with an existing identity means exactly that case.
  if (existing) return { subject: String(existing.id), created: false };
  const invite = await fetch(`${input.supabase.url}/auth/v1/invite`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email: input.operator.email }),
  });
  if (!invite.ok) fail(`The identity provider refused the invitation (${invite.status})`, 3);
  const created = await invite.json();
  if (!created?.id) fail('The identity provider returned no subject for the invitation', 3);
  return { subject: String(created.id), created: true };
}

/**
 * Binds the grantee identity to the home tenant, the way genesis does: a lookup
 * key for the sign-in's tenant resolution, never authorization truth
 * (ADR-019 rule 3).
 */
async function bindIdentityToHomeTenant(input, subject, homeTenantId) {
  const bound = await fetch(`${input.supabase.url}/auth/v1/admin/users/${subject}`, {
    method: 'PUT',
    headers: serviceHeaders(input),
    body: JSON.stringify({ app_metadata: { tenant_id: homeTenantId } }),
  });
  if (!bound.ok) fail(`The identity provider refused the tenant binding (${bound.status})`, 3);
  return true;
}

/**
 * Removes EXACTLY the identity this run created, by the id this run was handed.
 * Never by address, so a pre-existing identity that happens to share one cannot
 * be destroyed by a failed run.
 */
export async function compensateCreatedIdentity(input, subject) {
  const response = await fetch(`${input.supabase.url}/auth/v1/admin/users/${subject}`, {
    method: 'DELETE',
    headers: serviceHeaders(input),
  });
  if (!response.ok) {
    throw new Error(`the identity provider refused the deletion (${response.status})`);
  }
}

/**
 * Runs the addition on an open client. Exported so the proof suite can drive it
 * against a real database without spawning a process or a provider.
 *
 * `provenSubject` is the provider subject the GRANTOR's sign-in returned; the
 * grantor is resolved from it inside the transaction, so the authority check
 * reads the database rather than trusting an argument.
 */
export async function runAddOperator(client, input, identity, provenSubject) {
  const homeTenantCode = input.homeTenantCode ?? 'platform_operators';
  await client.query('BEGIN');
  try {
    // Before the first read of the address, and held to COMMIT or ROLLBACK:
    // a concurrent invitation of the same address must see this run's outcome,
    // never its middle.
    await client.query(INVITATION_ADDRESS_LOCK_SQL, [input.operator.email]);

    // 1. The grantor, from the identity their sign-in proved.
    const found = await client.query(
      `SELECT a.id, a.email, a.status, a.tenant_id, t.tenant_code
         FROM iam.user_accounts a
         JOIN org.tenants t ON t.id = a.tenant_id
        WHERE a.identity_provider = $1 AND a.provider_subject = $2 AND a.deleted_at IS NULL`,
      [input.operator.provider, provenSubject ?? '']
    );
    let candidate = null;
    if (found.rowCount === 1) {
      const row = found.rows[0];
      const held = await client.query(
        `SELECT DISTINCT permission_code FROM iam.platform_grants
          WHERE account_id = $1 AND revoked_at IS NULL`,
        [row.id]
      );
      candidate = {
        accountId: row.id,
        email: String(row.email).toLowerCase(),
        status: row.status,
        tenantId: row.tenant_id,
        tenantCode: row.tenant_code,
        held: held.rows.map((r) => r.permission_code).sort(),
      };
    }
    const grantorProblem = grantorRefusal(candidate, homeTenantCode);
    if (grantorProblem) fail(grantorProblem, 4);
    const grantor = candidate;

    // 2. The grantor is not the grantee — before an account exists to collide
    //    with the self-grant check constraint.
    const selfProblem = selfGrantRefusal(grantor.email, input.operator.email);
    if (selfProblem) fail(selfProblem, 4);

    // 3. The requested set: named on the command line, or the grantor's own.
    const requested = [...new Set(input.codes ?? grantor.held)].sort();
    const setProblem = overGrantRefusal(requested, grantor.held);
    if (setProblem) fail(setProblem, 4);

    // 4. The address, across every tenant.
    const claimed = await client.query(
      `SELECT a.id, t.tenant_code
         FROM iam.user_accounts a
         JOIN org.tenants t ON t.id = a.tenant_id
        WHERE lower(a.email) = $1 AND a.deleted_at IS NULL`,
      [input.operator.email]
    );
    const addressProblem = granteeAddressRefusal(
      claimed.rows.map((row) => ({ accountId: row.id, tenantCode: row.tenant_code })),
      homeTenantCode
    );
    if (addressProblem) fail(addressProblem, 4);

    const operatorAccountId = randomUUID();
    await client.query("SELECT set_config('app.user_id', $1, true)", [grantor.accountId]);
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [grantor.tenantId]);

    // 5. The account, in the home tenant, active, with NO role grant.
    await client.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
      [
        operatorAccountId,
        grantor.tenantId,
        input.operator.provider,
        identity.subject,
        input.operator.email,
        input.operator.displayName,
        grantor.accountId,
      ]
    );
    await client.query(
      `INSERT INTO iam.user_status_history (tenant_id, user_id, from_state, to_state, reason, actor_id)
       VALUES ($1, $2, NULL, 'active', 'platform operator added by an existing operator', $3)`,
      [grantor.tenantId, operatorAccountId, grantor.accountId]
    );

    // 6. The grants, attributed to the grantor rather than to the catalogue
    //    actor: this act has a person behind it and the trail says so.
    for (const code of requested) {
      await client.query(
        `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
         VALUES ($1, $2, $3, $3)`,
        [operatorAccountId, code, grantor.accountId]
      );
    }

    // 7. The same rules, asserted by SQL over the rows just written rather than
    //    over the variables that wrote them. A refusal here rolls everything
    //    back, so a drift between the checks above and the rows below can never
    //    commit.
    const verified = await client.query(
      `WITH grantee AS (
         SELECT permission_code FROM iam.platform_grants
          WHERE account_id = $1 AND revoked_at IS NULL
       ), granter AS (
         SELECT permission_code FROM iam.platform_grants
          WHERE account_id = $2 AND revoked_at IS NULL
       )
       SELECT
         (SELECT count(*) FROM grantee)::int AS granted,
         (SELECT count(*) FROM grantee
           WHERE permission_code NOT IN (SELECT permission_code FROM granter))::int AS beyond_grantor,
         (SELECT count(*) FROM grantee WHERE permission_code = $3)::int AS base_held,
         (SELECT count(*) FROM iam.platform_grants
           WHERE account_id = $1 AND granted_by <> $2)::int AS misattributed,
         (SELECT count(*) FROM iam.role_grants WHERE user_id = $1)::int AS tenant_roles,
         (SELECT count(*) FROM iam.user_accounts
           WHERE id = $1 AND tenant_id = $4 AND status = 'active')::int AS seated`,
      [operatorAccountId, grantor.accountId, PLATFORM_BASE_AUTHORITY_CODE, grantor.tenantId]
    );
    const check = verified.rows[0];
    if (check.granted !== requested.length) {
      fail(
        `Refused in-transaction: ${check.granted} grants were written, ${requested.length} were requested`,
        4
      );
    }
    if (check.beyond_grantor > 0) {
      fail(
        `Refused in-transaction: ${check.beyond_grantor} of the written grants are not held by the grantor`,
        4
      );
    }
    if (check.base_held !== 1) {
      fail(
        `Refused in-transaction: the written grant set does not carry ${PLATFORM_BASE_AUTHORITY_CODE}`,
        4
      );
    }
    if (check.misattributed > 0) {
      fail(
        'Refused in-transaction: a written grant is attributed to someone other than the grantor',
        4
      );
    }
    if (check.tenant_roles > 0) {
      fail('Refused in-transaction: the new operator account holds a tenant role', 4);
    }
    if (check.seated !== 1) {
      fail('Refused in-transaction: the new operator account is not active in the home tenant', 4);
    }

    // 8. The audit record, in the home tenant, identifiers only.
    const audit = await client.query(
      `SELECT iam.audit_append(
          p_tenant => $1, p_actor => $2, p_actor_kind => 'system',
          p_action => 'platform.operator.authority_granted', p_entity_type => 'iam.user_account',
          p_entity_id => $3, p_details => $4::jsonb
       ) AS id`,
      [
        grantor.tenantId,
        grantor.accountId,
        operatorAccountId,
        JSON.stringify([
          { field: 'platform_grants', old: null, new: requested.join(','), class: 'public' },
          { field: 'granted_by', old: null, new: grantor.accountId, class: 'internal' },
          { field: 'home_tenant_id', old: null, new: grantor.tenantId, class: 'internal' },
          { field: 'identity_provider', old: null, new: input.operator.provider, class: 'public' },
          { field: 'environment', old: null, new: input.environment, class: 'public' },
        ]),
      ]
    );

    const result = {
      outcome: input.dryRun ? 'dry-run' : 'added',
      operatorAccountId,
      homeTenantId: grantor.tenantId,
      grantorAccountId: grantor.accountId,
      grants: requested,
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

function writeEvidence(input, identity, result) {
  const path =
    input.evidencePath !== ''
      ? resolve(input.evidencePath)
      : resolve(
          `.tmp/platform-operator-added-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
        );
  mkdirSync(dirname(path), { recursive: true });
  const evidence = {
    what: 'an additional platform operator (P1-32-PRE-OD-OPERATOR)',
    at: new Date().toISOString(),
    environment: input.environment,
    database: {
      host: input.db.host,
      port: input.db.port,
      name: input.db.database,
      user: input.db.user,
    },
    operator: {
      email: input.operator.email,
      displayName: input.operator.displayName,
      identityProvider: input.operator.provider,
      identityCreatedByThisRun: identity.created === true,
    },
    grantor: { email: input.grantor.email },
    result,
    secrets: 'none — no password, key or token is recorded here',
  };
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return path;
}

async function main() {
  const input = readAddOperatorInput();
  const password =
    input.grantor.password !== ''
      ? input.grantor.password
      : await promptGrantorPassword(input.grantor.email);
  const provenSubject = await proveGrantorIdentity(input, password);
  const identity = await establishGranteeIdentity(input);

  const client = new pg.Client(input.db);
  await client.connect();
  let result;
  try {
    result = await runAddOperator(client, input, identity, provenSubject);
  } catch (error) {
    // Compensation: exactly the identity THIS run created, by its id.
    if (identity.created) {
      try {
        await compensateCreatedIdentity(input, identity.subject);
        console.error(
          `  the provider identity this run created (${identity.subject}) was deleted again`
        );
      } catch (compensation) {
        console.error(
          `  MANUAL REMEDY REQUIRED: this run created the provider identity ${identity.subject} ` +
            `and could not delete it (${compensation.message}). Delete exactly that identity at the ` +
            'identity provider by its id; no account row was written, so nothing else is orphaned'
        );
      }
    }
    throw error;
  } finally {
    await client.end();
  }

  if (input.dryRun) {
    console.log('Platform operator addition: dry run, nothing written');
    console.log(`  new operator      ${input.operator.email}`);
    console.log(`  grantor account   ${result.grantorAccountId}`);
    console.log(`  home tenant       ${result.homeTenantId}`);
    console.log(`  would grant       ${result.grants.join(', ')}`);
    if (identity.created) {
      console.log(`  provider identity ${identity.subject} was invited by this run and is kept`);
    }
    return;
  }
  const bound = await bindIdentityToHomeTenant(input, identity.subject, result.homeTenantId);
  const path = writeEvidence(input, identity, result);
  console.log(`Platform operator addition: ${result.outcome}`);
  console.log(`  operator account  ${result.operatorAccountId}`);
  console.log(`  granted by        ${result.grantorAccountId}`);
  console.log(`  home tenant       ${result.homeTenantId}`);
  console.log(`  grants            ${result.grants.join(', ')}`);
  console.log(`  audit record      ${result.auditRecordId}`);
  console.log(`  identity bound    ${bound}`);
  console.log(`  evidence          ${path}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Platform operator addition refused: ${error.message}`);
    process.exit(error instanceof AddOperatorRefused ? error.exitCode : 1);
  });
}
