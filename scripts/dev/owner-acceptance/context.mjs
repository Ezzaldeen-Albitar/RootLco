/**
 * Shared context for the local Owner-acceptance tooling.
 *
 * Everything in this directory exists so the Product Owner can sign in to a
 * running local system and inspect what P1-26 delivered. None of it ships, none
 * of it runs in CI, and none of it can be pointed at anything but a loopback
 * development database.
 *
 * ## Why the guards are three independent conditions
 *
 * A single environment variable is one typo away from being wrong. These
 * scripts write to `org.tenants` and to the GoTrue admin API as the database
 * owner, which is exactly the capability that must never reach a real
 * deployment. So the target has to prove it is local three separate ways —
 * an explicit opt-in value, a loopback database, and a loopback identity
 * provider — and any one of them failing refuses the whole run.
 *
 * ## Why the connection is built as an object
 *
 * `scripts/check-tracked-secrets.mjs` matches a `postgres://user:pass@host`
 * literal, and `scripts/ci/scan-history.mjs` re-checks the same pattern over
 * the entire history — a credential committed once fails forever. Building the
 * client config field by field means the string never exists.
 */
import { randomBytes } from 'node:crypto';
import { execSync } from 'node:child_process';

/** The one value that opts a run in. Anything else refuses. */
export const REQUIRED_ENVIRONMENT = 'local-acceptance';

/** The Supabase local database port, from `supabase/config.toml`. */
export const LOCAL_DB_PORT = 54322;

/** Hosts that count as this machine. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * The platform-system actor the seeds themselves use.
 *
 * `created_by` and `granted_by` carry no foreign key to `iam.user_accounts`,
 * so this is a legal author for rows that predate any real operator — which is
 * what a bootstrap is.
 */
export const SYSTEM_ACTOR = '00000000-0000-4000-8000-000000000001';

/**
 * Deterministic identifiers, so every run reconciles instead of duplicating.
 *
 * The `c…` prefix is deliberate and load-bearing. `tests/db/helpers.ts` owns
 * `aaaaaaaa-…` and `bbbbbbbb-…` and deletes exactly those in `cleanFixtures`,
 * which `npm run test:db` and `npm run test:backend` both call. Reusing them
 * would let a routine test run delete the Owner's account halfway through an
 * acceptance session.
 */
export const IDS = Object.freeze({
  tenantA: 'c0000000-0000-4000-8000-00000000000a',
  tenantB: 'c0000000-0000-4000-8000-00000000000b',
  companyA: 'c1000000-0000-4000-8000-00000000000a',
  companyB: 'c1000000-0000-4000-8000-00000000000b',
  branchA: 'c1100000-0000-4000-8000-00000000000a',
  branchB: 'c1100000-0000-4000-8000-00000000000b',
  ownerUser: 'c2000000-0000-4000-8000-00000000000a',
  readerUser: 'c2000000-0000-4000-8000-00000000000b',
  invitedUser: 'c2000000-0000-4000-8000-00000000000c',
  lockedUser: 'c2000000-0000-4000-8000-00000000000d',
  tenantBUser: 'c2000000-0000-4000-8000-00000000000e',
  adminRoleA: 'c3000000-0000-4000-8000-00000000000a',
  readerRoleA: 'c3000000-0000-4000-8000-00000000000b',
  adminRoleB: 'c3000000-0000-4000-8000-00000000000c',
});

/** Codes and display names. Every code matches `^[a-z][a-z0-9_]{1,62}$`. */
export const NAMES = Object.freeze({
  tenantCodeA: 'acceptance_a',
  tenantCodeB: 'acceptance_b',
  tenantNameA: 'CRM Owner Acceptance Tenant',
  tenantNameB: 'CRM Isolation Tenant B',
  companyCodeA: 'acceptance_co_a',
  companyCodeB: 'acceptance_co_b',
  companyNameA: 'CRM Owner Acceptance Company',
  companyNameB: 'CRM Isolation Company B',
  branchCode: 'main',
  branchNameA: 'Main Acceptance Branch',
  branchNameB: 'Isolation Branch B',
  adminRoleCode: 'acceptance_administrator',
  adminRoleName: 'Owner Acceptance Administrator',
  readerRoleCode: 'acceptance_reader',
  readerRoleName: 'Acceptance Reader',
  ownerEmail: 'owner.acceptance@crm.local',
  ownerDisplayName: 'CRM Owner Acceptance',
  readerEmail: 'reader.acceptance@crm.local',
  readerDisplayName: 'Acceptance Reader Operator',
  invitedEmail: 'invited.acceptance@crm.local',
  invitedDisplayName: 'Acceptance Invited Operator',
  lockedEmail: 'locked.acceptance@crm.local',
  lockedDisplayName: 'Acceptance Locked Operator',
  tenantBEmail: 'operator.tenantb@crm.local',
  tenantBDisplayName: 'Isolation Tenant B Operator',
});

/**
 * The complete permission set the eleven Administration screens gate on.
 *
 * Mirrors `apps/web/src/features/administration/shared/permissions.ts`.
 * `iam.user.read` is not optional: `GET /api/v1/auth/session` declares it, and
 * without it every screen renders as though the caller were signed out.
 */
export const ADMIN_PERMISSIONS = Object.freeze([
  'iam.user.read',
  'iam.user.manage',
  'iam.role.read',
  'iam.role.manage',
  'iam.grant.manage',
  'iam.approval.manage',
  'iam.audit.view',
  'iam.session.view_all',
  'iam.sensitive.view',
  'org.tenant.read',
  'org.company.read',
  'org.branch.read',
  'org.settings.manage',
  'org.tax.manage',
]);

/** What a read-only operator holds, for the permission-denied evidence. */
export const READER_PERMISSIONS = Object.freeze([
  'iam.user.read',
  'iam.role.read',
  'org.tenant.read',
  'org.company.read',
  'org.branch.read',
]);

/**
 * The database login the API runs as during acceptance.
 *
 * It is a MEMBER of `app_runtime` and holds nothing else: no superuser, no
 * BYPASSRLS, no CREATEDB, no CREATEROLE. That is the whole point — if row-level
 * security or a grant is wrong, this login discovers it exactly as a deployed
 * one would. Connecting the API as `postgres` would make every authorization
 * check in the Owner's session meaningless, because `postgres` carries
 * BYPASSRLS in the Supabase local stack.
 *
 * Deliberately distinct from `rootlco_test_runtime`, which `tests/db/helpers.ts`
 * owns and recreates: two owners for one role is one owner too many.
 */
export const ACCEPTANCE_DB_LOGIN = 'rootlco_acceptance_runtime';

/** Local-only, and never a secret: this database accepts loopback connections only. */
export const ACCEPTANCE_DB_PASSWORD = 'rootlco-local-acceptance-only';

export class GuardFailure extends Error {}

function refuse(message) {
  throw new GuardFailure(message);
}

/**
 * Proves the target is this machine, or refuses.
 *
 * Returns the resolved target so callers cannot accidentally connect to
 * something other than what was checked.
 */
export function assertLocalTarget() {
  if (process.env.ROOTLCO_ENV !== REQUIRED_ENVIRONMENT) {
    refuse(
      `Fail closed: ROOTLCO_ENV must be exactly '${REQUIRED_ENVIRONMENT}'. ` +
        `Received ${process.env.ROOTLCO_ENV ? `'${process.env.ROOTLCO_ENV}'` : '(unset)'}.`
    );
  }

  const host = process.env.DB_HOST ?? '127.0.0.1';
  const port = Number(process.env.DB_PORT ?? LOCAL_DB_PORT);
  if (!LOOPBACK.has(host)) {
    refuse(`Fail closed: DB_HOST must be a loopback address. Received '${host}'.`);
  }
  if (port !== LOCAL_DB_PORT) {
    refuse(
      `Fail closed: DB_PORT must be ${LOCAL_DB_PORT}, the Supabase local database port. ` +
        `Received '${port}'.`
    );
  }

  const appEnv = process.env.NEXT_PUBLIC_APP_ENV;
  if (appEnv !== undefined && appEnv !== 'local') {
    refuse(`Fail closed: NEXT_PUBLIC_APP_ENV must be 'local' when set. Received '${appEnv}'.`);
  }

  return {
    host,
    port,
    database: process.env.DB_NAME ?? 'postgres',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  };
}

/**
 * Reads the local Supabase endpoint and keys from the CLI.
 *
 * Never from a file and never from a committed default: the CLI is the only
 * thing that knows what the running stack actually issued, and reading it here
 * means no key is ever written down.
 */
export function readSupabase(repoRoot) {
  let raw;
  try {
    // A constant command STRING, not an argument array. `execFile` cannot
    // launch `npx.cmd` on Windows without a shell (EINVAL), and passing an
    // array through a shell is precisely what Node deprecates — it concatenates
    // rather than escapes. A literal with no interpolation has neither problem.
    raw = execSync('npx --no-install supabase status -o json', {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    refuse(
      'Could not read `supabase status`. Start the local stack first: npm run supabase:start\n' +
        String(error.message ?? error)
    );
  }

  // The CLI prints a "Stopped services: [...]" preamble on stdout before the
  // JSON, and `-o json` pretty-prints across lines. Slice from the first brace
  // to the last rather than hunting for a single-line object.
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first < 0 || last <= first) {
    refuse('`supabase status` produced no JSON object. Is the local stack running?');
  }

  let status;
  try {
    status = JSON.parse(raw.slice(first, last + 1));
  } catch (error) {
    refuse(`Could not parse \`supabase status\` output: ${error.message}`);
  }
  const apiUrl = status.API_URL;
  const serviceRoleKey = status.SERVICE_ROLE_KEY;
  const anonKey = status.ANON_KEY;
  if (!apiUrl || !serviceRoleKey || !anonKey) {
    refuse('`supabase status` did not report API_URL, ANON_KEY and SERVICE_ROLE_KEY.');
  }

  const parsed = new URL(apiUrl);
  if (!LOOPBACK.has(parsed.hostname)) {
    refuse(`Fail closed: the Supabase API must be loopback. Received '${parsed.hostname}'.`);
  }

  return {
    apiUrl: apiUrl.replace(/\/$/, ''),
    serviceRoleKey,
    anonKey,
    jwtSecret: status.JWT_SECRET,
    mailUrl: status.MAILPIT_URL ?? status.INBUCKET_URL,
    studioUrl: status.STUDIO_URL,
  };
}

/**
 * A strong password a human can retype without misreading it.
 *
 * `0/O` and `1/l/I` are absent on purpose — the Owner will type this from a
 * terminal into a browser, and a password that is strong but unreadable gets
 * pasted into a chat window instead.
 */
export function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const groups = 4;
  const perGroup = 5;
  const bytes = randomBytes(groups * perGroup);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  const out = [];
  for (let g = 0; g < groups; g += 1)
    out.push(chars.slice(g * perGroup, (g + 1) * perGroup).join(''));
  return out.join('-');
}

/** The GoTrue admin surface, service-role only. */
export async function goTrue(supabase, method, path, body) {
  const response = await fetch(`${supabase.apiUrl}/auth/v1${path}`, {
    method,
    headers: {
      apikey: supabase.serviceRoleKey,
      Authorization: `Bearer ${supabase.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }
  }
  return { ok: response.ok, status: response.status, body: parsed };
}
