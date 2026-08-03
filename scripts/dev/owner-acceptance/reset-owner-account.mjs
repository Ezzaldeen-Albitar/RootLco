#!/usr/bin/env node
/**
 * Removes the local Owner-acceptance environment, and nothing else.
 *
 * Every delete is keyed on the deterministic identifiers in `context.mjs`. It
 * never truncates, never deletes by pattern, and never touches a row it did not
 * create. If the identifiers changed, this removes nothing rather than guessing
 * — a reset that deletes more than it made is worse than one that fails.
 *
 * Order is the reverse of creation because every foreign key here is
 * `ON DELETE RESTRICT`: the database will refuse a wrong order rather than
 * cascade, which is the behaviour that makes this safe to run.
 *
 * Local only.
 */
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { GuardFailure, IDS, NAMES, assertLocalTarget, goTrue, readSupabase } from './context.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const HANDOFF = join(REPO_ROOT, '.local', 'owner-acceptance-account.json');

const TENANTS = [IDS.tenantA, IDS.tenantB];
const EMAILS = [
  NAMES.ownerEmail,
  NAMES.readerEmail,
  NAMES.invitedEmail,
  NAMES.lockedEmail,
  NAMES.tenantBEmail,
];

async function main() {
  const target = assertLocalTarget();
  const supabase = readSupabase(REPO_ROOT);

  console.log('Local Owner-acceptance reset');
  console.log(`  database : ${target.host}:${target.port}/${target.database}`);
  console.log('');

  const client = new pg.Client(target);
  await client.connect();

  try {
    await client.query('BEGIN');

    // Children first. Each statement names the tenants explicitly; none of them
    // can reach a row outside the two synthetic workspaces.
    const steps = [
      ['grant scopes', `DELETE FROM iam.grant_scopes WHERE tenant_id = ANY($1::uuid[])`],
      ['role grants', `DELETE FROM iam.role_grants WHERE tenant_id = ANY($1::uuid[])`],
      ['role permissions', `DELETE FROM iam.role_permissions WHERE tenant_id = ANY($1::uuid[])`],
      ['user sessions', `DELETE FROM iam.user_sessions WHERE tenant_id = ANY($1::uuid[])`],
      ['audit events', `DELETE FROM iam.audit_events WHERE tenant_id = ANY($1::uuid[])`],
      ['approval limits', `DELETE FROM iam.approval_limits WHERE tenant_id = ANY($1::uuid[])`],
      ['user accounts', `DELETE FROM iam.user_accounts WHERE tenant_id = ANY($1::uuid[])`],
      ['roles', `DELETE FROM iam.roles WHERE tenant_id = ANY($1::uuid[])`],
      ['branch settings', `DELETE FROM org.branch_settings WHERE tenant_id = ANY($1::uuid[])`],
      ['company settings', `DELETE FROM org.company_settings WHERE tenant_id = ANY($1::uuid[])`],
      ['branches', `DELETE FROM org.branches WHERE tenant_id = ANY($1::uuid[])`],
      ['companies', `DELETE FROM org.legal_companies WHERE tenant_id = ANY($1::uuid[])`],
      [
        'tenant status history',
        `DELETE FROM org.tenant_status_history WHERE tenant_id = ANY($1::uuid[])`,
      ],
      ['tenants', `DELETE FROM org.tenants WHERE id = ANY($1::uuid[])`],
    ];

    for (const [label, sql] of steps) {
      try {
        const result = await client.query(sql, [TENANTS]);
        console.log(`  removed ${String(result.rowCount).padStart(4)}  ${label}`);
      } catch (error) {
        // A table that does not exist in this schema version is reported, not
        // swallowed: the reset must never claim to have cleaned something it
        // could not reach.
        if (error.code === '42P01') {
          console.log(`  skipped        ${label} (no such table in this schema)`);
          continue;
        }
        throw error;
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }

  // The identities, which live outside the application database.
  const listed = await goTrue(supabase, 'GET', '/admin/users?page=1&per_page=200');
  if (listed.ok && Array.isArray(listed.body?.users)) {
    for (const user of listed.body.users) {
      if (!EMAILS.some((e) => e.toLowerCase() === String(user.email).toLowerCase())) continue;
      const removed = await goTrue(supabase, 'DELETE', `/admin/users/${user.id}`);
      console.log(`  removed identity ${user.email} ${removed.ok ? '' : `(${removed.status})`}`);
    }
  } else {
    console.log('  identity listing unavailable — GoTrue identities were NOT removed');
  }

  if (existsSync(HANDOFF)) {
    rmSync(HANDOFF);
    console.log('  removed .local/owner-acceptance-account.json');
  }

  console.log('');
  console.log('  Reset complete. Recreate with: npm run acceptance:create-owner');
}

main().catch((error) => {
  if (error instanceof GuardFailure) {
    console.error(`\n${error.message}\n`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
