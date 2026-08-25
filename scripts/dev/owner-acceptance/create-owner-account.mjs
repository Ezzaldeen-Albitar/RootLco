#!/usr/bin/env node
/**
 * Creates the local Owner-acceptance account and its three synthetic tenants.
 *
 * The Product Owner cannot accept a Frontend phase without signing in to it.
 * This builds the smallest real environment in which that is possible: one
 * workspace the Owner administers, a second workspace they have no membership
 * in, a third whose intake catalogues can be configured, and enough content that
 * every delivered screen has something to show.
 *
 * The third exists because P1-28 has two states to prove and only one database
 * to prove them in — see the Tenant C block below.
 *
 * ## What makes this a real account rather than a shortcut
 *
 * Every row goes through the platform's own tables, constraints and triggers.
 * The account holds ordinary application permissions granted through
 * `iam.role_grants`; it is not a database superuser, it does not carry
 * BYPASSRLS, it never sees a service-role key, and the browser receives nothing
 * but a session cookie. If authorization is wrong, this account discovers it
 * the same way a customer would — which is the entire point of asking the Owner
 * to click through it.
 *
 * ## Idempotent
 *
 * Re-running reconciles. Identifiers are deterministic, every write is
 * `ON CONFLICT DO NOTHING` or an explicit update, and the password is the one
 * thing that is regenerated — because a password that survives a re-run is a
 * password nobody can recover when it is lost.
 *
 * Local only. Refuses to run against anything but a loopback development
 * database. See `context.mjs` for the three guards.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { alignLocalJwtSigning, assertHs256 } from './align-local-jwt.mjs';
import {
  ACCEPTANCE_DB_LOGIN,
  ACCEPTANCE_DB_PASSWORD,
  // `ADMIN_PERMISSIONS` and `CRM_VEHICLE_PERMISSIONS` are NOT imported here.
  // `OWNER_PERMISSIONS` is their deduplicated union and is the only set this
  // script grants; importing the two halves as well left them unused, which
  // ESLint never saw (it does not lint `scripts/`) and CodeQL did — one `note`
  // finding, over a ceiling that is deliberately zero.
  OWNER_PERMISSIONS,
  GuardFailure,
  IDS,
  NAMES,
  READER_PERMISSIONS,
  SYSTEM_ACTOR,
  assertLocalTarget,
  generatePassword,
  goTrue,
  readSupabase,
} from './context.mjs';
import { API_ORIGIN, WEB_ORIGIN } from '../dev-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const HANDOFF = join(REPO_ROOT, '.local', 'owner-acceptance-account.json');

const log = (message) => console.log(message);

/**
 * Adds the three settings the API needs to authenticate anybody at all.
 *
 * `SUPABASE_SERVICE_ROLE_KEY`, `AUTH_JWT_SECRET` and `AUTH_JWT_ISSUER` are each
 * `.optional()` in the backend schema but jointly mandatory at login — absent,
 * the request fails with `ERR-SYS-001`, which reads as an outage rather than as
 * a missing setting. None of them is in `.env.example`, so a working local
 * account is impossible without this step and the failure it prevents looks
 * nothing like its cause.
 *
 * Writes only to `apps/api/.env.local`, which `.gitignore` excludes via
 * `.env.*`. Values already present are never overwritten: an operator who set
 * something deliberately keeps it.
 */
/**
 * Reads a file, or returns null when it is absent.
 *
 * `existsSync` followed by `readFileSync` is a time-of-check/time-of-use race
 * (`js/file-system-race`): the file can vanish, or be replaced by a symlink,
 * between the two calls. Attempting the read and handling `ENOENT` is one
 * syscall and has no window.
 */
function readIfPresent(path) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function ensureApiEnvironment(supabase, { databaseUrl }) {
  const path = join(REPO_ROOT, 'apps', 'api', '.env.local');
  const existing = readIfPresent(path) ?? '';
  const has = (name) => new RegExp(`^\\s*${name}\\s*=`, 'm').test(existing);

  const wanted = [
    ['SUPABASE_SERVICE_ROLE_KEY', supabase.serviceRoleKey],
    ['AUTH_JWT_SECRET', supabase.jwtSecret],
    ['AUTH_JWT_ISSUER', `${supabase.apiUrl}/auth/v1`],
    ['DATABASE_URL', databaseUrl],
  ].filter(([name, value]) => value && !has(name));

  if (wanted.length === 0) return [];

  const block =
    (existing.endsWith('\n') || existing === '' ? '' : '\n') +
    '\n# Added by the local Owner-acceptance bootstrap. Local development only.\n' +
    wanted.map(([name, value]) => `${name}=${value}`).join('\n') +
    '\n';
  writeFileSync(path, existing + block, 'utf8');
  return wanted.map(([name]) => name);
}

/**
 * Replaces a `DATABASE_URL` whose role cannot log in.
 *
 * The repository ships no application login role — `app_runtime` is `NOLOGIN`
 * by design, and `rootlco_test_runtime` is created by the test harness at test
 * time and does not exist on a freshly reset database. So a local `.env.local`
 * carried over from a test run points the API at a role that is simply not
 * there, and the only symptom is readiness answering 503 with
 * `database.reachable: false` — which reads as "the database is down".
 *
 * Only ever rewrites a line that is already broken. A working DATABASE_URL is
 * left exactly as the operator set it.
 */
function repairDatabaseUrl(usableRoles, databaseUrl) {
  const path = join(REPO_ROOT, 'apps', 'api', '.env.local');
  const existing = readIfPresent(path);
  if (existing === null) return null;
  const match = existing.match(/^\s*DATABASE_URL\s*=\s*(.+)$/m);
  if (!match) return null;

  const current = match[1].trim();
  const role = current.match(/^postgres(?:ql)?:\/\/([^:@/]+)[:@]/)?.[1];
  if (role && usableRoles.has(role)) return null;

  writeFileSync(path, existing.replace(match[0], `DATABASE_URL=${databaseUrl}`), 'utf8');
  return role ?? '(unparseable)';
}

/**
 * Creates or reconciles one GoTrue identity and returns its subject.
 *
 * GoTrue has no upsert. Listing by email and updating in place is what makes a
 * second run reconcile rather than fail on a duplicate.
 */
async function upsertIdentity(supabase, { email, password, tenantId, confirm }) {
  const found = await goTrue(supabase, 'GET', `/admin/users?page=1&per_page=200`);
  if (!found.ok) {
    throw new Error(`GoTrue user listing failed (${found.status}): ${JSON.stringify(found.body)}`);
  }
  const users = Array.isArray(found.body?.users) ? found.body.users : [];
  const existing = users.find((u) => String(u.email).toLowerCase() === email.toLowerCase());

  if (existing) {
    const updated = await goTrue(supabase, 'PUT', `/admin/users/${existing.id}`, {
      password,
      email_confirm: confirm,
      app_metadata: { tenant_id: tenantId },
    });
    if (!updated.ok) {
      throw new Error(
        `GoTrue update failed for ${email} (${updated.status}): ${JSON.stringify(updated.body)}`
      );
    }
    return existing.id;
  }

  const created = await goTrue(supabase, 'POST', '/admin/users', {
    email,
    password,
    email_confirm: confirm,
    app_metadata: { tenant_id: tenantId },
  });
  if (!created.ok || !created.body?.id) {
    throw new Error(
      `GoTrue create failed for ${email} (${created.status}): ${JSON.stringify(created.body)}`
    );
  }
  return created.body.id;
}

/**
 * Creates a tenant in its PROVISIONING window.
 *
 * PRE-P1-29 Wave B slice B1 made ACTIVE-with-no-recoverable-administrator an
 * unrepresentable state — on INSERT as well as UPDATE, and for every writer
 * including this one, which connects with row-level security bypassed. So the
 * tenant is created provisioning here and activated by activateTenants() below,
 * after the owner grants exist. Note that ON CONFLICT would not have rescued
 * the old form: PostgreSQL fires BEFORE ROW INSERT triggers before the arbiter
 * index is probed, so a re-run raised too.
 */
async function ensureTenant(client, { id, code, name, locale }) {
  await client.query(
    `INSERT INTO org.tenants
       (id, tenant_code, display_name, status, default_locale, default_timezone, created_by)
     VALUES ($1, $2, $3, 'provisioning', $4, 'Asia/Amman', $5)
     ON CONFLICT (id) DO NOTHING`,
    [id, code, name, locale, SYSTEM_ACTOR]
  );
}

/**
 * Takes every fixture tenant live, once its owner exists.
 *
 * Idempotent by the WHERE clause rather than by ON CONFLICT: the transition
 * guard refuses a no-op status change, so a re-run must present no rows rather
 * than the same row twice.
 */
async function activateTenants(client, tenantIds) {
  const { rows } = await client.query(
    `UPDATE org.tenants SET status = 'active'
      WHERE id = ANY($1::uuid[]) AND status = 'provisioning'
      RETURNING id, tenant_code`,
    [tenantIds]
  );
  for (const row of rows) log(`  activated ${row.tenant_code}`);
  const stuck = await client.query(
    `SELECT tenant_code, status FROM org.tenants
      WHERE id = ANY($1::uuid[]) AND status <> 'active'`,
    [tenantIds]
  );
  if (stuck.rows.length > 0) {
    throw new Error(
      'tenant(s) could not be activated — no recoverable administrator: ' +
        stuck.rows.map((r) => `${r.tenant_code}=${r.status}`).join(', ')
    );
  }
}

async function ensureCompany(client, { id, tenantId, code, name }) {
  await client.query(
    `INSERT INTO org.legal_companies
       (id, tenant_id, company_code, legal_name, base_currency_code, status, created_by)
     VALUES ($1, $2, $3, $4, 'JOD', 'active', $5)
     ON CONFLICT (id) DO NOTHING`,
    [id, tenantId, code, name, SYSTEM_ACTOR]
  );
}

async function ensureBranch(client, { id, tenantId, companyId, code, name }) {
  await client.query(
    `INSERT INTO org.branches
       (id, tenant_id, company_id, branch_code, name, timezone_name, status, created_by)
     VALUES ($1, $2, $3, $4, $5, 'Asia/Amman', 'active', $6)
     ON CONFLICT (id) DO NOTHING`,
    [id, tenantId, companyId, code, name, SYSTEM_ACTOR]
  );
}

async function ensureRole(client, { id, tenantId, code, name, description, permissions }) {
  await client.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, description, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO NOTHING`,
    [id, tenantId, code, name, description, SYSTEM_ACTOR]
  );

  // Resolved by code, never by a written-down permission id: the catalogue is
  // seeded platform data and its ids differ between databases.
  const mapped = await client.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1::uuid, $2::uuid, p.id, 'allow', $3::uuid
       FROM iam.permissions p
      WHERE p.permission_code = ANY($4::text[])
     ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING
     RETURNING 1`,
    [tenantId, id, SYSTEM_ACTOR, [...permissions]]
  );

  // A permission code that is not in the catalogue would silently map nothing
  // and the screen would be denied for a reason no log explains.
  const present = await client.query(
    `SELECT count(*)::int AS n FROM iam.permissions WHERE permission_code = ANY($1::text[])`,
    [[...permissions]]
  );
  if (present.rows[0].n !== permissions.length) {
    throw new Error(
      `Only ${present.rows[0].n} of ${permissions.length} permission codes exist in the ` +
        'catalogue. Run `npm run supabase:reset` so seed 04 is applied.'
    );
  }
  return mapped.rowCount;
}

async function ensureAccount(client, { id, tenantId, subject, email, displayName, status }) {
  await client.query(
    `INSERT INTO iam.user_accounts
       (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1, $2, 'supabase', $3, $4, $5, $6, $7)
     ON CONFLICT (id) DO UPDATE
        SET email = EXCLUDED.email,
            display_name = EXCLUDED.display_name,
            status = EXCLUDED.status`,
    [id, tenantId, subject, email, displayName, status, SYSTEM_ACTOR]
  );
}

/**
 * Grants a role, with its scope rows in the same transaction when scoped.
 *
 * `tg_role_grants_require_scope` is DEFERRABLE INITIALLY DEFERRED, so a scoped
 * active grant with no scope row fails at COMMIT rather than at INSERT — the
 * error names a trigger, not the missing row, which is why the two writes are
 * bound together here.
 *
 * `granted_by` is the platform actor and never the recipient:
 * `ck_role_grants_no_self_grant` forbids a user granting themselves a role.
 */
async function ensureGrant(client, { tenantId, userId, roleId, scope }) {
  await client.query('BEGIN');
  try {
    // `ON CONFLICT` cannot help here. The only unique key is `(tenant_id, id)`
    // and `id` is generated, so every insert is "new" and a second run would
    // silently accumulate a duplicate active grant — which reads as a
    // privilege-escalation smell in the audit trail and is simply wrong.
    const found = await client.query(
      `SELECT id FROM iam.role_grants
        WHERE tenant_id = $1 AND user_id = $2 AND role_id = $3 AND status = 'active'
        LIMIT 1`,
      [tenantId, userId, roleId]
    );

    let grantId = found.rows[0]?.id;
    if (!grantId) {
      const grant = await client.query(
        `INSERT INTO iam.role_grants
           (tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
         VALUES ($1, $2, $3, $4, 'active', $5, $5)
         RETURNING id`,
        [tenantId, userId, roleId, scope ? 'scoped' : 'unrestricted', SYSTEM_ACTOR]
      );
      grantId = grant.rows[0]?.id;
    }

    if (scope && grantId) {
      await client.query(
        `INSERT INTO iam.grant_scopes
           (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
         VALUES ($1, $2, 'branch', $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [tenantId, grantId, scope.companyId, scope.branchId, SYSTEM_ACTOR]
      );
    }
    await client.query('COMMIT');
    return grantId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * Company settings that make the settings-backed screens non-empty.
 *
 * Every value is labelled as an acceptance fixture in its own content where the
 * type allows it, so nothing here can be mistaken for a decided business
 * default. The five settings-backed screens are decision-neutral by design and
 * `P1-26-OD-001` — the key namespace — is still the Owner's to ratify.
 */
async function ensureCompanySettings(client, { tenantId, companyId, entries }) {
  for (const [key, value, type] of entries) {
    await client.query(
      `INSERT INTO org.company_settings
         (tenant_id, company_id, setting_key, setting_value, value_type, version, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5, 1, $6)
       ON CONFLICT (tenant_id, company_id, setting_key, version) DO NOTHING`,
      [tenantId, companyId, key, JSON.stringify(value), type, SYSTEM_ACTOR]
    );
  }
}

async function main() {
  const target = assertLocalTarget();
  const supabase = readSupabase(REPO_ROOT);

  log('Local Owner-acceptance bootstrap');
  log(`  database : ${target.user}@${target.host}:${target.port}/${target.database}`);
  log(`  identity : ${supabase.apiUrl}`);
  log('');

  const client = new pg.Client(target);
  await client.connect();

  const password = generatePassword();
  const summary = {};

  try {
    const catalogue = await client.query('SELECT count(*)::int AS n FROM iam.permissions');
    if (catalogue.rows[0].n === 0) {
      throw new Error(
        'iam.permissions is empty. Run `npm run supabase:reset` so the platform catalogue is seeded.'
      );
    }

    // --- the login the API itself runs as -----------------------------------
    // A member of `app_runtime` and nothing more. Identifiers are constants in
    // `context.mjs`, never interpolated from input, so there is no injection
    // surface in the DDL below.
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ACCEPTANCE_DB_LOGIN}') THEN
          CREATE ROLE ${ACCEPTANCE_DB_LOGIN} LOGIN PASSWORD '${ACCEPTANCE_DB_PASSWORD}'
            NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
        END IF;
      END;
      $$;
    `);
    await client.query(`GRANT app_runtime TO ${ACCEPTANCE_DB_LOGIN}`);

    const attributes = await client.query(
      `SELECT rolcanlogin, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = $1`,
      [ACCEPTANCE_DB_LOGIN]
    );
    const a = attributes.rows[0];
    if (!a?.rolcanlogin || a.rolsuper || a.rolbypassrls) {
      throw new Error(
        `${ACCEPTANCE_DB_LOGIN} must be able to log in and must hold neither SUPERUSER nor ` +
          'BYPASSRLS. An API running with either would make every authorization check in the ' +
          "Owner's session meaningless."
      );
    }
    log(`  api login ${ACCEPTANCE_DB_LOGIN} — member of app_runtime, no BYPASSRLS, no superuser`);

    const usable = await client.query(
      `SELECT rolname FROM pg_roles WHERE rolcanlogin AND NOT rolsuper`
    );
    const databaseUrl =
      `postgresql://${ACCEPTANCE_DB_LOGIN}:${ACCEPTANCE_DB_PASSWORD}` +
      `@${target.host}:${target.port}/${target.database}`;

    const replaced = repairDatabaseUrl(new Set(usable.rows.map((r) => r.rolname)), databaseUrl);
    if (replaced) {
      log(`  api env   DATABASE_URL pointed at '${replaced}', which cannot log in — repaired`);
    }
    const added = ensureApiEnvironment(supabase, { databaseUrl });
    if (added.length > 0) {
      log(`  api env   added ${added.join(', ')} to apps/api/.env.local (git-ignored)`);
    }
    if (replaced || added.length > 0) {
      log('            restart the API if it is running, or it still holds the old settings');
    }
    log('');

    // --- Tenant A: the workspace the Owner administers ----------------------
    await ensureTenant(client, {
      id: IDS.tenantA,
      code: NAMES.tenantCodeA,
      name: NAMES.tenantNameA,
      locale: 'en',
    });
    await ensureCompany(client, {
      id: IDS.companyA,
      tenantId: IDS.tenantA,
      code: NAMES.companyCodeA,
      name: NAMES.companyNameA,
    });
    await ensureBranch(client, {
      id: IDS.branchA,
      tenantId: IDS.tenantA,
      companyId: IDS.companyA,
      code: NAMES.branchCode,
      name: NAMES.branchNameA,
    });

    await ensureRole(client, {
      id: IDS.adminRoleA,
      tenantId: IDS.tenantA,
      code: NAMES.adminRoleCode,
      name: NAMES.adminRoleName,
      description:
        'Full approved administration, CRM and Vehicle capability for local Owner acceptance.',
      permissions: OWNER_PERMISSIONS,
    });
    await ensureRole(client, {
      id: IDS.readerRoleA,
      tenantId: IDS.tenantA,
      code: NAMES.readerRoleCode,
      name: NAMES.readerRoleName,
      description: 'Read-only capability, used to evidence permission-denied states.',
      permissions: READER_PERMISSIONS,
    });

    // --- Tenant B: the workspace the Owner must NOT be able to reach ---------
    await ensureTenant(client, {
      id: IDS.tenantB,
      code: NAMES.tenantCodeB,
      name: NAMES.tenantNameB,
      locale: 'en',
    });
    await ensureCompany(client, {
      id: IDS.companyB,
      tenantId: IDS.tenantB,
      code: NAMES.companyCodeB,
      name: NAMES.companyNameB,
    });
    await ensureBranch(client, {
      id: IDS.branchB,
      tenantId: IDS.tenantB,
      companyId: IDS.companyB,
      code: NAMES.branchCode,
      name: NAMES.branchNameB,
    });
    await ensureRole(client, {
      id: IDS.adminRoleB,
      tenantId: IDS.tenantB,
      code: NAMES.adminRoleCode,
      name: NAMES.adminRoleName,
      description: 'Isolation counterpart. No Tenant A principal holds this.',
      // Same capability set as Tenant A's role deliberately: the isolation
      // evidence must show that a Tenant A session is refused Tenant B data
      // because of the TENANT, not because the role happened to be weaker.
      permissions: OWNER_PERMISSIONS,
    });

    /* --- Tenant C: the workspace whose intake catalogues are CONFIGURED ------
     *
     * WHY A THIRD TENANT EXISTS, stated here because a reader will reasonably
     * ask whether Tenant A could not simply have been configured.
     *
     * It could not, and the reason is that BOTH states have to be provable in
     * the SAME run. The seven intake catalogues ship empty (`P1-28-OD-001`), and
     * four delivered capabilities — booking, cancelling, the fuel-level picker,
     * the warning-light picker — are inert until somebody fills them. Production
     * ships unconfigured, so the truthful "not configured" statement is a
     * deliverable in its own right and must keep being asserted. Configuring
     * Tenant A would delete that evidence: the browser tier would then only ever
     * see the configured world, and the honest-empty assertions would have to be
     * removed or made conditional on run order.
     *
     * So Tenant A stays exactly as it was — every unconfigured assertion still
     * runs against it — and Tenant C is what a tenant looks like AFTER an
     * administrator has configured it. Its catalogue rows are not created here:
     * they are written at run time through the published management contracts by
     * `acceptance-fixtures.mjs`, which needs the API to be running.
     *
     * It is deliberately NOT a second isolation counterpart. Tenant B is the
     * workspace the Owner must not reach and holds no business rows; making that
     * one configured would have entangled the isolation evidence with the
     * configuration evidence, and a failure in either would have read as the
     * other.
     */
    await ensureTenant(client, {
      id: IDS.tenantC,
      code: NAMES.tenantCodeC,
      name: NAMES.tenantNameC,
      locale: 'en',
    });
    await ensureCompany(client, {
      id: IDS.companyC,
      tenantId: IDS.tenantC,
      code: NAMES.companyCodeC,
      name: NAMES.companyNameC,
    });
    await ensureBranch(client, {
      id: IDS.branchC,
      tenantId: IDS.tenantC,
      companyId: IDS.companyC,
      code: NAMES.branchCode,
      name: NAMES.branchNameC,
    });
    await ensureRole(client, {
      id: IDS.adminRoleC,
      tenantId: IDS.tenantC,
      code: NAMES.adminRoleCode,
      name: NAMES.adminRoleName,
      description:
        'Full approved capability for the configured acceptance workspace, including the two ' +
        'intake-catalogue administration codes no seed grants to anybody.',
      permissions: OWNER_PERMISSIONS,
    });

    // --- identities ---------------------------------------------------------
    const people = [
      {
        key: 'owner',
        id: IDS.ownerUser,
        tenantId: IDS.tenantA,
        email: NAMES.ownerEmail,
        displayName: NAMES.ownerDisplayName,
        status: 'active',
        roleId: IDS.adminRoleA,
        signsIn: true,
      },
      {
        key: 'reader',
        id: IDS.readerUser,
        tenantId: IDS.tenantA,
        email: NAMES.readerEmail,
        displayName: NAMES.readerDisplayName,
        status: 'active',
        roleId: IDS.readerRoleA,
        signsIn: true,
        scope: { companyId: IDS.companyA, branchId: IDS.branchA },
      },
      {
        key: 'invited',
        id: IDS.invitedUser,
        tenantId: IDS.tenantA,
        email: NAMES.invitedEmail,
        displayName: NAMES.invitedDisplayName,
        status: 'invited',
        roleId: null,
        signsIn: false,
      },
      {
        key: 'locked',
        id: IDS.lockedUser,
        tenantId: IDS.tenantA,
        email: NAMES.lockedEmail,
        displayName: NAMES.lockedDisplayName,
        status: 'locked',
        roleId: null,
        signsIn: false,
      },
      {
        key: 'tenantB',
        id: IDS.tenantBUser,
        tenantId: IDS.tenantB,
        email: NAMES.tenantBEmail,
        displayName: NAMES.tenantBDisplayName,
        status: 'active',
        roleId: IDS.adminRoleB,
        signsIn: true,
      },
      {
        // The principal who administers the configured workspace. Unrestricted
        // within Tenant C and a member of nothing else, so a session it opens
        // can see the configured catalogues and cannot see Tenant A or B.
        key: 'configured',
        id: IDS.configuredUser,
        tenantId: IDS.tenantC,
        email: NAMES.configuredEmail,
        displayName: NAMES.configuredDisplayName,
        status: 'active',
        roleId: IDS.adminRoleC,
        signsIn: true,
      },
    ];

    for (const person of people) {
      const subject = await upsertIdentity(supabase, {
        email: person.email,
        password,
        tenantId: person.tenantId,
        confirm: true,
      });
      await ensureAccount(client, {
        id: person.id,
        tenantId: person.tenantId,
        subject,
        email: person.email,
        displayName: person.displayName,
        status: person.status,
      });
      if (person.roleId) {
        await ensureGrant(client, {
          tenantId: person.tenantId,
          userId: person.id,
          roleId: person.roleId,
          scope: person.scope,
        });
      }
      summary[person.key] = { email: person.email, subject, status: person.status };
      log(`  identity ${person.email.padEnd(34)} ${person.status}`);
    }

    // Every owner grant now exists, so the tenants can go live. This is the
    // point B1 moved activation to; before it, the tenants were inserted active
    // and the environment could be built with nobody able to administer it.
    await activateTenants(client, [IDS.tenantA, IDS.tenantB, IDS.tenantC]);

    // --- content, so every screen has something to show ---------------------
    await ensureCompanySettings(client, {
      tenantId: IDS.tenantA,
      companyId: IDS.companyA,
      entries: [
        ['numbering.invoice.prefix', 'ACC-INV-', 'string'],
        ['numbering.invoice.padding', 6, 'number'],
        ['numbering.invoice.start_at', 1, 'number'],
        ['numbering.invoice.reset_period', 'yearly', 'string'],
        ['tax.code', 'ACCEPTANCE_STANDARD', 'string'],
        ['tax.name', 'Acceptance fixture rate — not a production default', 'string'],
        // A rate is exact in the database. It is a decimal STRING end to end;
        // a JavaScript number would round it on the way through, invisibly.
        ['tax.rate_percent', '16.0000', 'string'],
        ['tax.active', true, 'boolean'],
        ['currency.enabled_codes', ['JOD', 'USD', 'EUR'], 'json'],
        ['acceptance.p1_26.checked', 'local acceptance fixture', 'string'],
      ],
    });

    const counts = await client.query(
      `SELECT
         (SELECT count(*)::int FROM org.tenants)                                        AS tenants,
         (SELECT count(*)::int FROM iam.user_accounts WHERE tenant_id = $1)             AS users_a,
         (SELECT count(*)::int FROM iam.roles WHERE tenant_id = $1)                     AS roles_a,
         (SELECT count(*)::int FROM iam.role_permissions WHERE role_id = $2)            AS perms_owner,
         (SELECT count(*)::int FROM org.company_settings WHERE tenant_id = $1)          AS settings_a,
         (SELECT count(*)::int FROM iam.user_accounts WHERE tenant_id = $3)             AS users_b,
         (SELECT count(*)::int FROM iam.user_accounts WHERE tenant_id = $4)             AS users_c`,
      [IDS.tenantA, IDS.adminRoleA, IDS.tenantB, IDS.tenantC]
    );
    const c = counts.rows[0];

    if (c.perms_owner !== OWNER_PERMISSIONS.length) {
      throw new Error(
        `The administrator role carries ${c.perms_owner} permissions, expected ` +
          `${OWNER_PERMISSIONS.length}. The dashboard would render as signed out.`
      );
    }

    // --- the identity provider must sign what the Backend can verify ---------
    const alignment = alignLocalJwtSigning({ project: 'RootLco', log });
    log(`  jwt signing ${alignment.changed ? 'realigned' : 'unchanged'} — ${alignment.reason}`);

    const algorithm = await assertHs256(supabase.apiUrl, supabase.anonKey, {
      email: NAMES.ownerEmail,
      password,
    });
    if (!algorithm.ok) {
      throw new Error(
        `The identity provider mints ${algorithm.algorithm ?? 'an unreadable token'} — ` +
          `${algorithm.detail}. See P1-26-F-045: the Backend verifier implements HMAC only and ` +
          'refuses asymmetric algorithms by design.'
      );
    }
    log(`  jwt algorithm ${algorithm.algorithm} — ${algorithm.detail}`);

    mkdirSync(dirname(HANDOFF), { recursive: true });
    writeFileSync(
      HANDOFF,
      JSON.stringify(
        {
          warning: 'LOCAL DEVELOPMENT ONLY — NOT A PRODUCTION ACCOUNT. Never commit this file.',
          createdAt: new Date().toISOString(),
          // Derived, never written by hand. These two lines carried the
          // loopback literal — so the handoff file the Owner opens to find the
          // address handed them the one origin that leaves every table loading
          // for ever, while the launcher printed `localhost` two commands
          // earlier (`P1-26-F-062`). The literals also duplicated the port
          // authority, so a port change here would have gone unnoticed.
          apiBaseUrl: API_ORIGIN,
          webBaseUrl: WEB_ORIGIN,
          loginUrl: `${WEB_ORIGIN}/en/login`,
          tenantId: IDS.tenantA,
          tenant: NAMES.tenantNameA,
          company: NAMES.companyNameA,
          branch: NAMES.branchNameA,
          role: NAMES.adminRoleName,
          permissionCount: OWNER_PERMISSIONS.length,
          login: { email: NAMES.ownerEmail, password },
          alsoProvisioned: {
            reader: { email: NAMES.readerEmail, password, note: 'read-only, branch-scoped' },
            tenantB: { email: NAMES.tenantBEmail, password, tenantId: IDS.tenantB },
            configured: {
              email: NAMES.configuredEmail,
              password,
              tenantId: IDS.tenantC,
              companyId: IDS.companyC,
              branchId: IDS.branchC,
              note:
                'the workspace whose intake catalogues can be configured. Its rows are written ' +
                'by npm run acceptance:provision-fixtures, which needs the API running.',
            },
          },
          resetCommand: 'npm run acceptance:reset-owner',
        },
        null,
        2
      ) + '\n',
      // Owner-readable only where the platform honours it. The directory is
      // git-ignored, but a credential sitting readable on disk is still a
      // credential sitting readable on disk.
      //
      // `P1-26-F-053`: on Windows, Node ignores this POSIX mode entirely. The
      // file inherits the directory ACL, which grants SYSTEM and the local
      // Administrators group in addition to the owner. That is narrower than
      // world-readable and wider than 0600, and the runbook says so rather than
      // letting the mode argument imply a guarantee this platform does not make.
      { encoding: 'utf8', mode: 0o600 }
    );

    log('');
    log(`  tenants           ${c.tenants}`);
    log(`  Tenant A users    ${c.users_a}`);
    log(`  Tenant A roles    ${c.roles_a}`);
    log(`  owner permissions ${c.perms_owner} of ${OWNER_PERMISSIONS.length}`);
    log(`  company settings  ${c.settings_a}`);
    log(`  Tenant B users    ${c.users_b}`);
    log(`  Tenant C users    ${c.users_c}  (configured workspace — catalogues filled separately)`);
    log('');
    // The password is NOT printed.
    //
    // `js/clear-text-logging` is right: stdout goes to terminal scrollback, to
    // any log the operator happens to be capturing, and to a CI transcript if
    // this is ever run somewhere it should not be. The credential is written to
    // one git-ignored file with the mode restricted, and the operator reads it
    // from there — one place to find it, and one place to delete it.
    log(`  credentials written to .local/owner-acceptance-account.json (git-ignored)`);
    log(`  tenant id  ${IDS.tenantA}`);
    log(`  email      ${NAMES.ownerEmail}`);
    log(`  password   (in that file — deliberately not printed to stdout)`);
    log('');
    log('  LOCAL DEVELOPMENT ONLY — NOT A PRODUCTION ACCOUNT');
    log('');
    log('  Verify against the running API with: npm run acceptance:status-owner');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  if (error instanceof GuardFailure) {
    console.error(`\n${error.message}\n`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
