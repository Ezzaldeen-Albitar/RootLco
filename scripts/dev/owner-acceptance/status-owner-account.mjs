#!/usr/bin/env node
/**
 * Reports whether the local Owner-acceptance account can actually be used.
 *
 * The distinction this script exists for: rows can be present and correct and
 * the account still unusable, because usability depends on the API's own
 * authentication pipeline agreeing with them. So it reads the database AND —
 * when the API is reachable — signs in for real and asks
 * `GET /api/v1/auth/session` what the caller may do.
 *
 * A bootstrap that reported success while every screen 403s is the failure this
 * prevents, and the only way to prevent it is to make the round trip.
 *
 * Prints no password and no token. Local only.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import {
  OWNER_PERMISSIONS,
  GuardFailure,
  IDS,
  NAMES,
  assertLocalTarget,
  reconstructPassword,
} from './context.mjs';
import { API_ORIGIN } from '../dev-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const HANDOFF = join(REPO_ROOT, '.local', 'owner-acceptance-account.json');
// Both a configured base URL and a string this script prints back to the Owner
// ("API at ${API} is not reachable — start it with: npm run dev:all"). It
// defaulted to the loopback literal, so the address the Owner was shown here
// disagreed with the one `dev:all` had just printed (`P1-26-F-062`).
const API = process.env.ROOTLCO_API_BASE_URL ?? API_ORIGIN;

const mark = (ok) => (ok ? 'yes' : 'NO');
let failures = 0;

function report(label, ok, detail) {
  if (!ok) failures += 1;
  console.log(`  ${label.padEnd(30)} ${mark(ok).padEnd(4)} ${detail ?? ''}`.trimEnd());
}

async function main() {
  const target = assertLocalTarget();
  console.log('Local Owner-acceptance status');
  console.log(`  environment                    local-acceptance`);
  console.log(`  database                       ${target.host}:${target.port}/${target.database}`);
  console.log('');

  const client = new pg.Client(target);
  await client.connect();
  const email = NAMES.ownerEmail;

  try {
    const row = await client.query(
      `SELECT
         (SELECT count(*)::int FROM org.tenants WHERE id = $1)                      AS tenant_a,
         (SELECT count(*)::int FROM org.tenants WHERE id = $2)                      AS tenant_b,
         (SELECT count(*)::int FROM org.legal_companies WHERE id = $3)              AS company_a,
         (SELECT count(*)::int FROM org.branches WHERE id = $4)                     AS branch_a,
         (SELECT count(*)::int FROM iam.roles WHERE id = $5)                        AS role_a,
         (SELECT count(*)::int FROM iam.role_permissions WHERE role_id = $5)        AS perms,
         (SELECT count(*)::int FROM iam.user_accounts WHERE id = $6)                AS account,
         (SELECT count(*)::int FROM iam.role_grants
            WHERE user_id = $6 AND status = 'active')                               AS grants,
         (SELECT status FROM iam.user_accounts WHERE id = $6)                       AS account_status,
         (SELECT count(*)::int FROM org.company_settings WHERE tenant_id = $1)      AS settings,
         (SELECT count(*)::int FROM iam.user_accounts WHERE tenant_id = $1)         AS users_a,
         (SELECT count(*)::int FROM iam.user_accounts WHERE tenant_id = $2)         AS users_b`,
      [IDS.tenantA, IDS.tenantB, IDS.companyA, IDS.branchA, IDS.adminRoleA, IDS.ownerUser]
    );
    const r = row.rows[0];

    report('tenant A exists', r.tenant_a === 1, NAMES.tenantNameA);
    report('tenant B exists', r.tenant_b === 1, NAMES.tenantNameB);
    report('company exists', r.company_a === 1, NAMES.companyNameA);
    report('branch exists', r.branch_a === 1, NAMES.branchNameA);
    report('administrator role exists', r.role_a === 1, NAMES.adminRoleName);
    report(
      'role permission count',
      r.perms === OWNER_PERMISSIONS.length,
      `${r.perms} of ${OWNER_PERMISSIONS.length}`
    );
    report('owner account exists', r.account === 1, email);
    report('owner account active', r.account_status === 'active', String(r.account_status));
    report('role grant active', r.grants >= 1, `${r.grants} grant(s)`);
    report('company settings present', r.settings > 0, `${r.settings} row(s)`);
    report('tenant A users', r.users_a >= 4, `${r.users_a}`);
    report('tenant B users', r.users_b >= 1, `${r.users_b}`);
  } finally {
    await client.end();
  }

  console.log('');
  console.log('  no password is printed by this script');
  console.log('  no bearer token is printed by this script');
  console.log('');

  // --- the part that proves the account is usable, not merely present --------
  // Read and handle absence, rather than `existsSync` then read: the two-call
  // form is a time-of-check/time-of-use race (`js/file-system-race`) and this
  // file holds a credential.
  let raw = null;
  try {
    raw = readFileSync(HANDOFF, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (raw === null) {
    report('live sign-in', false, 'no .local handoff file — run npm run acceptance:create-owner');
    finish();
    return;
  }
  const handoff = JSON.parse(raw);

  // Nothing read from that file is forwarded verbatim.
  //
  // `js/file-access-to-http` is right that a file read reaching an outbound
  // request deserves a constraint, and "the file is local" is precisely the
  // assumption not to grant: whatever can write it would otherwise choose what
  // this process transmits. The tenant and the address come from the fixture
  // constants and the file's copies are only compared against them, and the
  // password is rebuilt out of the known alphabet, which refuses anything this
  // tooling could not have generated.
  const agrees = handoff.tenantId === IDS.tenantA && handoff.login?.email === NAMES.ownerEmail;
  report(
    'handoff matches fixtures',
    agrees,
    agrees ? 'tenant and address as provisioned' : 're-run npm run acceptance:create-owner'
  );

  let password;
  try {
    password = reconstructPassword(handoff.login?.password);
  } catch (error) {
    report('stored password shape', false, error.message);
    finish();
    return;
  }
  report('stored password shape', true, 'rebuilt from the acceptance alphabet');

  let ready;
  try {
    ready = await fetch(`${API}/api/v1/health/ready`, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.log(`  API at ${API} is not reachable — start it with: npm run dev:all`);
    console.log('  live sign-in NOT ATTEMPTED, so this run does not prove the account is usable.');
    finish();
    return;
  }
  report('API readiness', ready.ok, `${ready.status} ${API}/api/v1/health/ready`);

  const login = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: IDS.tenantA,
      email: NAMES.ownerEmail,
      password,
    }),
  });
  const loginBody = await login.json().catch(() => null);
  report('live sign-in', login.ok, `${login.status}`);
  if (!login.ok) {
    console.log(`    ${JSON.stringify(loginBody)}`);
    finish();
    return;
  }

  const token = loginBody?.accessToken ?? loginBody?.session?.accessToken;
  report('bearer token issued', Boolean(token), token ? '(not printed)' : 'absent');
  if (!token) {
    finish();
    return;
  }

  const session = await fetch(`${API}/api/v1/auth/session`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const sessionBody = await session.json().catch(() => null);
  report('session read', session.ok, `${session.status}`);

  const granted = new Set(sessionBody?.permissions ?? []);
  const missing = OWNER_PERMISSIONS.filter((code) => !granted.has(code));
  report(
    'resolved permissions',
    missing.length === 0,
    missing.length === 0 ? `${granted.size} code(s)` : `missing ${missing.join(', ')}`
  );

  finish();
}

function finish() {
  console.log('');
  if (failures === 0) {
    console.log('  Owner acceptance account: READY');
    return;
  }
  console.log(`  Owner acceptance account: NOT READY — ${failures} check(s) failed`);
  process.exitCode = 1;
}

main().catch((error) => {
  if (error instanceof GuardFailure) {
    console.error(`\n${error.message}\n`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
