#!/usr/bin/env node
/**
 * Proves the acceptance reset actually removed everything.
 *
 * ## Why an exit code was not enough
 *
 * `acceptance:reset-owner` exiting zero means every statement it chose to run
 * succeeded. It does not mean the right statements were chosen. The reset that
 * skipped `iam.audit_events` — a table that does not exist — exited zero and
 * printed a tidy list of removals while the audit trail stayed where it was.
 *
 * So this asks the database, not the script. It re-runs the same catalogue
 * discovery the reset used and asserts every counter is zero. Sharing the
 * discovery is the point: a verifier looking somewhere else than the reset
 * cleaned would be checking its own opinion of where fixtures live, and the two
 * would drift apart silently.
 *
 * ## A zero that means nothing
 *
 * A scan that matches no tables reports every counter as zero, which is exactly
 * what a clean database reports. That is the `AR-45` shape this repository has
 * been burned by before: a check that enumerated nothing read as a check that
 * found nothing.
 *
 * So the scan is itself asserted — the table count must be plausible, and the
 * named catalogues must exist — and the run fails if it is not, rather than
 * reporting a comforting row of zeroes.
 *
 * Local only. Prints no password and no token.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { GuardFailure, IDS, NAMES, assertLocalTarget, goTrue, readSupabase } from './context.mjs';
import {
  MINIMUM_PLAUSIBLE_SCOPED_TABLES,
  businessRowSweep,
  surveyAcceptanceRows,
} from './discovery.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..', '..');
const HANDOFF = join(REPO_ROOT, '.local', 'owner-acceptance-account.json');
const BROWSER_STATE = join(REPO_ROOT, '.local', 'e2e');

const TENANTS = [IDS.tenantA, IDS.tenantB, IDS.tenantC];
const EMAILS = [
  NAMES.ownerEmail,
  NAMES.readerEmail,
  NAMES.invitedEmail,
  NAMES.lockedEmail,
  NAMES.tenantBEmail,
  NAMES.configuredEmail,
];

/**
 * The counters reported by name, each bound to a table that must exist.
 *
 * Naming them individually rather than only reporting a grand total is
 * deliberate: a single "0 remaining" hides which of fifteen things was checked,
 * and the reset's historical failure was precisely one category surviving while
 * the rest were removed.
 */
const NAMED_COUNTERS = [
  ['APPLICATION_USER_COUNT', 'iam.user_accounts', 'tenant_id'],
  ['ACCEPTANCE_TENANT_COUNT', 'org.tenants', 'id'],
  ['ACCEPTANCE_COMPANY_COUNT', 'org.legal_companies', 'tenant_id'],
  ['ACCEPTANCE_BRANCH_COUNT', 'org.branches', 'tenant_id'],
  ['ACCEPTANCE_ROLE_COUNT', 'iam.roles', 'tenant_id'],
  ['ACCEPTANCE_ROLE_GRANT_COUNT', 'iam.role_grants', 'tenant_id'],
  ['ACCEPTANCE_GRANT_SCOPE_COUNT', 'iam.grant_scopes', 'tenant_id'],
  ['ACCEPTANCE_PERMISSION_ASSIGNMENT_COUNT', 'iam.role_permissions', 'tenant_id'],
  ['ACCEPTANCE_APPROVAL_LIMIT_COUNT', 'iam.approval_limits', 'tenant_id'],
  ['ACCEPTANCE_SESSION_COUNT', 'iam.user_sessions', 'tenant_id'],
  ['ACCEPTANCE_LOGIN_AUDIT_COUNT', 'iam.login_audit', 'tenant_id'],
  ['ACCEPTANCE_AUDIT_COUNT', 'iam.audit_records', 'tenant_id'],
  ['ACCEPTANCE_AUDIT_DETAIL_COUNT', 'iam.audit_record_details', 'tenant_id'],
  ['ACCEPTANCE_AUDIT_LINK_COUNT', 'iam.audit_integrity_links', 'tenant_id'],
  ['ACCEPTANCE_SETTING_COUNT', 'org.company_settings', 'tenant_id'],
];

let failures = 0;
const report = (label, ok, detail) => {
  if (!ok) failures += 1;
  console.log(`  ${label.padEnd(42)} ${(ok ? 'ok' : 'FAIL').padEnd(5)} ${detail ?? ''}`.trimEnd());
};

async function main() {
  const target = assertLocalTarget();
  console.log('Acceptance reset verification');
  console.log(`  database ${target.host}:${target.port}/${target.database}`);
  console.log('');

  const client = new pg.Client(target);
  await client.connect();

  try {
    const survey = await surveyAcceptanceRows(client, TENANTS);

    // ---- the scan must be believable before any zero it reports is ---------
    console.log('  --- the scan itself ---');
    report(
      'SCANNED_TENANT_SCOPED_TABLES',
      survey.scannedTables >= MINIMUM_PLAUSIBLE_SCOPED_TABLES,
      `${survey.scannedTables} (floor ${MINIMUM_PLAUSIBLE_SCOPED_TABLES})`
    );

    for (const [, table] of NAMED_COUNTERS) {
      const [schema, name] = table.split('.');
      const { rows } = await client.query(`SELECT to_regclass($1) IS NOT NULL AS present`, [
        `"${schema}"."${name}"`,
      ]);
      if (!rows[0].present) {
        report(`CATALOGUE_PRESENT ${table}`, false, 'table absent — a zero here would be a lie');
      }
    }

    console.log('');
    console.log('  --- counters ---');
    for (const [label, table, column] of NAMED_COUNTERS) {
      const [schema, name] = table.split('.');
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM "${schema}"."${name}" WHERE ${column} = ANY($1::uuid[])`,
        [TENANTS]
      );
      report(label, rows[0].n === 0, `${rows[0].n}  ${table}`);
    }

    console.log('');
    console.log('  --- anything the named counters did not name ---');
    report(
      'UNNAMED_REMAINING_ROWS',
      survey.total === 0,
      survey.total === 0 ? 'none' : survey.populated.map((p) => `${p.table}=${p.rows}`).join(', ')
    );
    report('RESET_REMAINDER_COUNT', survey.total === 0, String(survey.total));

    // ---- the Database tier's own definition of clean ----------------------
    //
    // Removing the acceptance rows is necessary and not sufficient. The
    // no-fake-data test counts EVERY row in every business table, not
    // tenant-scoped ones, so the database can be free of acceptance fixtures and
    // still fail it because some other run left something behind. Checking only
    // what this reset deleted would let that through and blame the tier.
    console.log('');
    console.log('  --- the Database tier will see a clean database ---');
    const sweep = await businessRowSweep(client);
    report('BUSINESS_TABLES_SCANNED', sweep.scanned > 200, String(sweep.scanned));
    report(
      'DATABASE_BUSINESS_ROWS',
      sweep.nonEmpty.length === 0,
      sweep.nonEmpty.length === 0
        ? '0 — matches what tests/db/no-fake-data.test.ts asserts'
        : sweep.nonEmpty.map((r) => `${r.table}=${r.rows}`).join(', ')
    );
  } finally {
    await client.end();
  }

  // ---- identities -----------------------------------------------------------
  console.log('');
  console.log('  --- identities and local files ---');
  const supabase = readSupabase(REPO_ROOT);
  const listed = await goTrue(supabase, 'GET', '/admin/users?page=1&per_page=200');
  if (!listed.ok || !Array.isArray(listed.body?.users)) {
    report(
      'AUTH_USER_COUNT',
      false,
      'GoTrue listing unavailable — cannot prove identities are gone'
    );
  } else {
    const remaining = listed.body.users.filter((u) =>
      EMAILS.some((e) => e.toLowerCase() === String(u.email).toLowerCase())
    );
    report(
      'AUTH_USER_COUNT',
      remaining.length === 0,
      remaining.length === 0 ? '0' : remaining.map((u) => u.email).join(', ')
    );
  }

  report('LOCAL_HANDOFF_FILE_PRESENT', !existsSync(HANDOFF), existsSync(HANDOFF) ? '1' : '0');
  report(
    'LOCAL_BROWSER_STATE_PRESENT',
    !existsSync(BROWSER_STATE),
    existsSync(BROWSER_STATE) ? '1' : '0'
  );

  console.log('');
  if (failures === 0) {
    console.log('  Acceptance fixtures: FULLY REMOVED — the Database tier may run.');
    return;
  }
  console.log(`  Acceptance fixtures: NOT FULLY REMOVED — ${failures} check(s) failed.`);
  console.log('  Do NOT run the Database/RLS gate in this state; its clean-database');
  console.log('  invariant tests would fail for a reason that is not a defect.');
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
