#!/usr/bin/env node
/**
 * The first platform operator — the platform's root of trust (P1-29 W9, Owner
 * decision 1 of 2026-09-02; PRE-P1-29 Wave B design §5.3).
 *
 * The product has no write path to `iam.platform_grants`: no operation writes
 * it, no policy admits an application role to it, and the gate in
 * scripts/ci keeps it that way. The first holder of platform authority is
 * therefore established by an operator act on a privileged connection — this
 * script — and by nothing else. It is deployment infrastructure, not an
 * application route, and it must never become one.
 *
 * What one run establishes, in ONE transaction:
 *
 *   1. a home tenant reserved for platform operators (`org.provision_organization`,
 *      then activated) — operator accounts live in a tenant that holds no
 *      business data (§5.4);
 *   2. the operator's account in it, `active`, with its status-history row;
 *   3. the three platform grants: `platform.organization.provision`,
 *      `platform.organization.lifecycle`, `platform.organization.read`;
 *   4. an audit record in the home tenant, `platform.operator.genesis`, naming
 *      the account and the grants — identifiers only;
 *   5. optionally, the `app_platform` LOGIN role the application's
 *      PLATFORM_DATABASE_URL must use, created with the password from the
 *      environment if it does not already exist.
 *
 * Properties, each one enforced rather than described:
 *
 *   - owner-controlled: refuses unless `--confirm <email>` repeats the operator
 *     address, and unless the environment is one of the two named gates;
 *   - one-time: refuses when ANY active platform grant already exists for a
 *     different account (G2);
 *   - idempotent: a second run for the SAME address that already holds every
 *     grant is a no-op that reports the existing identifiers (exit 0);
 *   - fail-closed: every write is in one transaction; any refusal rolls all of
 *     them back, and the script exits non-zero;
 *   - no wildcard, no bypass left behind: it writes rows, not privileges. It
 *     creates no policy, grants nothing to app_runtime, and the only role it
 *     may create is a LOGIN member of `app_platform` — the archetype whose
 *     privileges the migrations define (G5);
 *   - not reachable by an application role: it needs INSERT on
 *     iam.platform_grants, which no application role holds (G3);
 *   - evidence without secrets: the JSON it writes carries identifiers,
 *     timestamps and the database host — never a password, key or token.
 *
 * Inputs (environment; nothing is read from the command line but the
 * confirmation and the flags):
 *
 *   ROOTLCO_ENV                     'local-acceptance' | 'production-genesis'
 *   DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD   the privileged connection
 *   GENESIS_OPERATOR_EMAIL          the operator's address
 *   GENESIS_OPERATOR_DISPLAY_NAME   the operator's display name
 *   GENESIS_IDENTITY_PROVIDER       provider name (default 'supabase')
 *   GENESIS_PROVIDER_SUBJECT        the identity's subject (`sub`) when it
 *                                   already exists at the provider; OR
 *   NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY   to invite the
 *                                   identity through the provider's admin
 *                                   API (the key is used, never printed)
 *   GENESIS_HOME_TENANT_CODE        default 'platform_operators'
 *   GENESIS_PLATFORM_LOGIN_ROLE + GENESIS_PLATFORM_LOGIN_PASSWORD   optional:
 *                                   create the app_platform LOGIN if absent
 *   GENESIS_EVIDENCE_PATH           where to write the evidence JSON
 *                                   (default .tmp/platform-genesis-<ts>.json)
 *
 *   node scripts/platform/genesis-platform-operator.mjs --confirm <email> [--dry-run]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const ALLOWED_ENVIRONMENTS = new Set(['local-acceptance', 'production-genesis']);
const PLATFORM_CODES = Object.freeze([
  'platform.organization.provision',
  'platform.organization.lifecycle',
  'platform.organization.read',
]);
/** The catalogue seed's own actor: the only uuid that predates every account. */
const GENESIS_ACTOR = '00000000-0000-4000-8000-000000000001';

class GenesisRefused extends Error {
  constructor(message, exitCode = 2) {
    super(message);
    this.exitCode = exitCode;
  }
}

function fail(message, exitCode = 2) {
  throw new GenesisRefused(message, exitCode);
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
export function readGenesisInput(env = process.env, argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const environment = env.ROOTLCO_ENV;
  if (!ALLOWED_ENVIRONMENTS.has(environment)) {
    fail("Fail closed: ROOTLCO_ENV must be exactly 'local-acceptance' or 'production-genesis'");
  }
  const email = (env.GENESIS_OPERATOR_EMAIL ?? '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('GENESIS_OPERATOR_EMAIL is not an address');
  if (args.confirm.trim().toLowerCase() !== email) {
    fail('--confirm must exactly match GENESIS_OPERATOR_EMAIL');
  }
  const displayName = (env.GENESIS_OPERATOR_DISPLAY_NAME ?? '').trim();
  if (displayName === '') fail('GENESIS_OPERATOR_DISPLAY_NAME is required');
  const provider = (env.GENESIS_IDENTITY_PROVIDER ?? 'supabase').trim();
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(provider)) fail('GENESIS_IDENTITY_PROVIDER is malformed');
  const homeTenantCode = (env.GENESIS_HOME_TENANT_CODE ?? 'platform_operators').trim();
  if (!/^[a-z][a-z0-9_]{1,62}$/.test(homeTenantCode)) fail('GENESIS_HOME_TENANT_CODE is malformed');
  const subject = (env.GENESIS_PROVIDER_SUBJECT ?? '').trim();
  const supabaseUrl = (env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
  const serviceRoleKey = (env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (subject === '' && (supabaseUrl === '' || serviceRoleKey === '')) {
    fail(
      'Provide GENESIS_PROVIDER_SUBJECT (an identity that already exists at the provider) or NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY so the identity can be invited'
    );
  }
  const loginRole = (env.GENESIS_PLATFORM_LOGIN_ROLE ?? '').trim();
  const loginPassword = env.GENESIS_PLATFORM_LOGIN_PASSWORD ?? '';
  if (loginRole !== '' && !/^[a-z][a-z0-9_]{1,62}$/.test(loginRole)) {
    fail('GENESIS_PLATFORM_LOGIN_ROLE is malformed');
  }
  if (loginRole !== '' && loginPassword.length < 16) {
    fail('GENESIS_PLATFORM_LOGIN_PASSWORD must be at least 16 characters');
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
    operator: { email, displayName, provider, subject },
    supabase: { url: supabaseUrl, serviceRoleKey },
    homeTenantCode,
    login: loginRole === '' ? null : { role: loginRole, password: loginPassword },
    evidencePath: env.GENESIS_EVIDENCE_PATH ?? '',
  };
}

/** Invites the identity through the provider's admin surface; returns its subject. Never logs the key. */
async function establishProviderIdentity(input) {
  if (input.operator.subject !== '') return { subject: input.operator.subject, created: false };
  const headers = {
    apikey: input.supabase.serviceRoleKey,
    Authorization: `Bearer ${input.supabase.serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
  const lookup = await fetch(`${input.supabase.url}/auth/v1/admin/users?page=1&per_page=1000`, {
    headers,
  });
  if (!lookup.ok) fail(`The identity provider refused the admin lookup (${lookup.status})`, 3);
  const listed = await lookup.json();
  const users = Array.isArray(listed?.users) ? listed.users : [];
  const existing = users.find((u) => String(u.email ?? '').toLowerCase() === input.operator.email);
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
 * Runs the genesis on an open client. Exported so the proof suite can drive it
 * against the real database without spawning a process; `main` below is the
 * only other caller.
 */
export async function runGenesis(client, input, identity) {
  const state = {};
  await client.query('BEGIN');
  try {
    // G2 — one-time. Any active platform grant held by a different account
    // means an operator exists; this script does not add a second one.
    const holders = await client.query(
      `SELECT DISTINCT a.id, a.email
         FROM iam.platform_grants g
         JOIN iam.user_accounts a ON a.id = g.account_id
        WHERE g.revoked_at IS NULL AND a.deleted_at IS NULL`
    );
    const other = holders.rows.find((r) => String(r.email).toLowerCase() !== input.operator.email);
    if (other) {
      fail(
        `Refused: a platform operator already exists (account ${other.id}); genesis is one-time`,
        4
      );
    }
    const self = holders.rows.find((r) => String(r.email).toLowerCase() === input.operator.email);
    if (self) {
      const codes = await client.query(
        `SELECT permission_code FROM iam.platform_grants WHERE account_id = $1 AND revoked_at IS NULL`,
        [self.id]
      );
      const held = new Set(codes.rows.map((r) => r.permission_code));
      const missing = PLATFORM_CODES.filter((c) => !held.has(c));
      if (missing.length === 0) {
        const home = await client.query('SELECT tenant_id FROM iam.user_accounts WHERE id = $1', [
          self.id,
        ]);
        await client.query('ROLLBACK');
        return {
          outcome: 'already-established',
          operatorAccountId: self.id,
          homeTenantId: home.rows[0]?.tenant_id ?? null,
          grants: [...held].sort(),
        };
      }
      fail(
        `Refused: the operator account ${self.id} exists but lacks ${missing.join(', ')}; repair by hand on a privileged connection`,
        4
      );
    }

    const operatorAccountId = randomUUID();
    await client.query("SELECT set_config('app.user_id', $1, true)", [operatorAccountId]);

    // 1. The home tenant. Created through the sanctioned function with the
    //    operator's own (not yet existing) account id as the actor — created_by
    //    carries no foreign key precisely so the first tenant can exist before
    //    its first account — then activated: an inactive home tenant would
    //    refuse the operator's own session.
    const provisioned = await client.query(
      'SELECT org.provision_organization($1::jsonb, $2) AS result',
      [
        JSON.stringify({
          actor_id: operatorAccountId,
          tenant: {
            code: input.homeTenantCode,
            display_name: 'Platform operators',
            locale: 'en',
            timezone: 'UTC',
          },
          company: {
            code: input.homeTenantCode,
            legal_name: 'Platform operators (no business data)',
            base_currency: 'USD',
          },
          branch: { code: 'platform', name: 'Platform', timezone: 'UTC' },
        }),
        `platform-genesis:${input.operator.email}`,
      ]
    );
    const homeTenantId = provisioned.rows[0].result.tenant_id;
    state.homeTenantId = homeTenantId;
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [homeTenantId]);

    // 2. The operator's account, active, with its first status row.
    await client.query(
      `INSERT INTO iam.user_accounts
         (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, 'active', $7)`,
      [
        operatorAccountId,
        homeTenantId,
        input.operator.provider,
        identity.subject,
        input.operator.email,
        input.operator.displayName,
        GENESIS_ACTOR,
      ]
    );
    await client.query(
      `INSERT INTO iam.user_status_history (tenant_id, user_id, from_state, to_state, reason, actor_id)
       VALUES ($1, $2, NULL, 'active', 'platform operator genesis', $3)`,
      [homeTenantId, operatorAccountId, GENESIS_ACTOR]
    );

    // 3. The three grants. granted_by is the genesis actor, never the account
    //    itself: ck_platform_grants_no_self_grant.
    for (const code of PLATFORM_CODES) {
      await client.query(
        `INSERT INTO iam.platform_grants (account_id, permission_code, granted_by, created_by)
         VALUES ($1, $2, $3, $3)`,
        [operatorAccountId, code, GENESIS_ACTOR]
      );
    }

    // The home tenant is activated only now, with the operator on record.
    await client.query('SELECT org.change_tenant_status($1::uuid, $2, $3, $4::uuid, NULL)', [
      homeTenantId,
      'active',
      'platform operators home tenant activated at genesis',
      operatorAccountId,
    ]);

    // 4. The audit record, in the home tenant, identifiers only.
    const audit = await client.query(
      `SELECT iam.audit_append(
          p_tenant => $1, p_actor => $2, p_actor_kind => 'system',
          p_action => 'platform.operator.genesis', p_entity_type => 'iam.user_account',
          p_entity_id => $2, p_details => $3::jsonb
       ) AS id`,
      [
        homeTenantId,
        operatorAccountId,
        JSON.stringify([
          { field: 'email', old: null, new: input.operator.email, class: 'restricted' },
          { field: 'identity_provider', old: null, new: input.operator.provider, class: 'public' },
          { field: 'platform_grants', old: null, new: PLATFORM_CODES.join(','), class: 'public' },
          { field: 'home_tenant_id', old: null, new: homeTenantId, class: 'internal' },
          { field: 'environment', old: null, new: input.environment, class: 'public' },
        ]),
      ]
    );

    // 5. The app_platform LOGIN, only if asked and only if absent. The
    //    password travels as a bound parameter of a DO block, never in a
    //    logged statement; the role is a member of app_platform and nothing else.
    let loginCreated = false;
    if (input.login) {
      const exists = await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [
        input.login.role,
      ]);
      if (exists.rowCount === 0) {
        await client
          .query(
            `SELECT format('CREATE ROLE %I LOGIN PASSWORD %L IN ROLE app_platform', $1::text, $2::text) AS ddl`,
            [input.login.role, input.login.password]
          )
          .then((r) => client.query(r.rows[0].ddl));
        loginCreated = true;
      }
    }

    if (input.dryRun) {
      await client.query('ROLLBACK');
      return {
        outcome: 'dry-run',
        operatorAccountId,
        homeTenantId,
        grants: [...PLATFORM_CODES],
        auditRecordId: audit.rows[0].id,
        loginCreated,
      };
    }
    await client.query('COMMIT');
    return {
      outcome: 'established',
      operatorAccountId,
      homeTenantId,
      grants: [...PLATFORM_CODES],
      auditRecordId: audit.rows[0].id,
      loginCreated,
    };
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
      : resolve(`.tmp/platform-genesis-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  mkdirSync(dirname(path), { recursive: true });
  const evidence = {
    what: 'platform operator genesis (P1-29 W9)',
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
      // The provider subject is recorded on the account row, not here: the
      // evidence file carries nothing that came back from the provider's API.
      identityCreatedByThisRun: identity.created === true,
    },
    result,
    secrets: 'none — no password, key or token is recorded here',
  };
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return path;
}

/**
 * Binds the provider identity to the operator's home tenant, the way the
 * application's own invitation does (`app_metadata.tenant_id`, service role
 * only). A lookup key for the login's tenant resolution, never authorization
 * truth (ADR-019 rule 3): without it the operator must name the home tenant on
 * every sign-in. Done after the transaction committed, so a rolled-back genesis
 * leaves no binding behind; repeated on an already-established operator so a
 * run that once lacked the service key can be completed later.
 */
async function bindIdentityToHomeTenant(input, subject, homeTenantId) {
  if (input.supabase.url === '' || input.supabase.serviceRoleKey === '') return false;
  const headers = {
    apikey: input.supabase.serviceRoleKey,
    Authorization: `Bearer ${input.supabase.serviceRoleKey}`,
    'Content-Type': 'application/json',
  };
  const bound = await fetch(`${input.supabase.url}/auth/v1/admin/users/${subject}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ app_metadata: { tenant_id: homeTenantId } }),
  });
  if (!bound.ok) fail(`The identity provider refused the tenant binding (${bound.status})`, 3);
  return true;
}

async function main() {
  const input = readGenesisInput();
  const identity = await establishProviderIdentity(input);
  const client = new pg.Client(input.db);
  await client.connect();
  let result;
  try {
    result = await runGenesis(client, input, identity);
  } finally {
    await client.end();
  }
  if (result.outcome !== 'dry-run' && result.homeTenantId) {
    result.identityBoundToHomeTenant = await bindIdentityToHomeTenant(
      input,
      identity.subject,
      result.homeTenantId
    );
  }
  const path = writeEvidence(input, identity, result);
  console.log(`Platform operator genesis: ${result.outcome}`);
  console.log(`  operator account  ${result.operatorAccountId}`);
  console.log(`  home tenant       ${result.homeTenantId}`);
  console.log(`  grants            ${result.grants.join(', ')}`);
  if (result.auditRecordId) console.log(`  audit record      ${result.auditRecordId}`);
  if (input.login)
    console.log(
      `  app_platform login ${input.login.role} ${result.loginCreated ? 'created' : 'already present'}`
    );
  console.log(`  evidence          ${path}`);
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`Platform operator genesis refused: ${error.message}`);
    process.exit(error instanceof GenesisRefused ? error.exitCode : 1);
  });
}
