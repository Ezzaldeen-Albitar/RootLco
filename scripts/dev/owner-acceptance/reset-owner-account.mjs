#!/usr/bin/env node
/**
 * Removes the local Owner-acceptance environment, and nothing else.
 *
 * Every delete is keyed on the two deterministic tenant identifiers in
 * `context.mjs`. It never truncates, never deletes by pattern, and never touches
 * a row outside those two synthetic workspaces. If the identifiers changed it
 * removes nothing rather than guessing — a reset that deletes more than it made
 * is worse than one that fails.
 *
 * ## What changed, and why — `P1-26-F-056`
 *
 * This used to hold a hand-written list of seventeen tables, each delete wrapped
 * in its own `SAVEPOINT` so a statement against a missing table could be rolled
 * back without poisoning the transaction.
 *
 * Two things were wrong with that. The list had already been wrong once — it
 * named `iam.audit_events`, which does not exist, so the step was skipped and a
 * reset that reported success left the entire audit trail behind. And the
 * savepoints made that survivable, which is to say invisible.
 *
 * Now the catalogue is asked first, outside any transaction: which tables are
 * tenant-scoped, which of them actually hold acceptance rows, and in what order
 * their foreign keys allow them to be emptied. The destructive transaction is
 * generated from that answer, so every statement targets a table that was read
 * seconds earlier and nothing is expected to fail. No savepoints, no catch-and-
 * continue, and any error genuinely is one — it rolls the whole thing back.
 *
 * Local only.
 */
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { GuardFailure, IDS, NAMES, assertLocalTarget, goTrue, readSupabase } from './context.mjs';
import { MINIMUM_PLAUSIBLE_SCOPED_TABLES, surveyAcceptanceRows } from './discovery.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const HANDOFF = join(REPO_ROOT, '.local', 'owner-acceptance-account.json');
const BROWSER_STATE = join(REPO_ROOT, '.local', 'e2e');

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
    // ---- discovery, outside the transaction --------------------------------
    const survey = await surveyAcceptanceRows(client, TENANTS);

    if (survey.scannedTables < MINIMUM_PLAUSIBLE_SCOPED_TABLES) {
      throw new GuardFailure(
        `Fail closed: the catalogue scan found only ${survey.scannedTables} tenant-scoped ` +
          `table(s), fewer than the ${MINIMUM_PLAUSIBLE_SCOPED_TABLES} this schema must have. ` +
          'A scan that matches almost nothing reports a clean database whether or not it is ' +
          'one, so this refuses rather than deleting from a set it cannot trust.'
      );
    }

    if (survey.cycle) {
      throw new GuardFailure(
        `Fail closed: foreign keys form a cycle across ${survey.cycle.join(', ')}. ` +
          'Emptying them needs a deferred constraint or a deliberate strategy; picking an ' +
          'order here would be a guess.'
      );
    }

    console.log(`  scanned ${survey.scannedTables} tenant-scoped table(s)`);
    console.log(`  ${survey.populated.length} hold acceptance rows (${survey.total} in total)`);
    console.log('');

    // ---- one transaction, nothing expected to fail -------------------------
    await client.query('BEGIN');

    let removed = 0;
    for (const table of survey.ordered) {
      const [schema, name] = table.split('.');
      const result = await client.query(
        `DELETE FROM "${schema}"."${name}" WHERE tenant_id = ANY($1::uuid[])`,
        [TENANTS]
      );
      removed += result.rowCount;
      console.log(`  removed ${String(result.rowCount).padStart(4)}  ${table}`);
    }

    // `org.tenants` is keyed by `id`, not `tenant_id`, so it is not in the
    // tenant-scoped scan and must go last — every table above references it.
    const tenants = await client.query(`DELETE FROM org.tenants WHERE id = ANY($1::uuid[])`, [
      TENANTS,
    ]);
    removed += tenants.rowCount;
    console.log(`  removed ${String(tenants.rowCount).padStart(4)}  org.tenants`);

    await client.query('COMMIT');
    console.log('');
    console.log(`  ${removed} row(s) removed in one transaction`);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }

  // The identities, which live outside the application database.
  const listed = await goTrue(supabase, 'GET', '/admin/users?page=1&per_page=200');
  if (listed.ok && Array.isArray(listed.body?.users)) {
    for (const user of listed.body.users) {
      if (!EMAILS.some((e) => e.toLowerCase() === String(user.email).toLowerCase())) continue;
      const gone = await goTrue(supabase, 'DELETE', `/admin/users/${user.id}`);
      console.log(`  removed identity ${user.email} ${gone.ok ? '' : `(${gone.status})`}`);
    }
  } else {
    console.log('  identity listing unavailable — GoTrue identities were NOT removed');
  }

  if (existsSync(HANDOFF)) {
    rmSync(HANDOFF);
    console.log('  removed .local/owner-acceptance-account.json');
  }

  // The browser storage state carries a live session cookie for the account
  // being deleted. Leaving it behind means the next authenticated run starts
  // with a credential for a user that no longer exists, and fails somewhere far
  // from the cause.
  if (existsSync(BROWSER_STATE)) {
    rmSync(BROWSER_STATE, { recursive: true, force: true });
    console.log('  removed .local/e2e (browser session state)');
  }

  console.log('');
  console.log('  Reset complete. Prove it with: npm run acceptance:verify-reset');
}

main().catch((error) => {
  if (error instanceof GuardFailure) {
    console.error(`\n${error.message}\n`);
    process.exit(2);
  }
  console.error(error);
  process.exit(1);
});
