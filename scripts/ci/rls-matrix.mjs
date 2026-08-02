#!/usr/bin/env node
/**
 * RLS and privilege matrix (CSA-09, initiative §15).
 *
 * The database suite already asserts isolation behaviour in depth. What it does
 * NOT produce is an inspectable artifact answering, for every protected table:
 * is RLS enabled, is it FORCED, which runtime role holds which privilege, and is
 * there a policy for each granted action.
 *
 * Two levels:
 *   --level critical  every table in the security-critical schemas. Runs on each PR.
 *   --level full      every application table in every application schema. Nightly.
 *
 * Both produce the same shape, so the nightly artifact is comparable with the PR
 * artifact rather than being a different document.
 *
 * The matrix is CATALOG-derived, which is exactly its value: it cannot be
 * satisfied by a passing test, only by the database actually being configured
 * that way. Behavioural denial evidence remains the job of `tests/db/**`.
 *
 * Every cell that is deliberately not asserted carries a `skipReason`. A cell
 * with neither a verdict nor a reason fails the run — silence is not a result.
 *
 * Usage:
 *   node scripts/ci/rls-matrix.mjs --level critical --json out.json --markdown out.md
 * Env: DB_HOST DB_PORT DB_NAME DB_USER DB_PASSWORD (same convention as tests/db/helpers.ts)
 * Exit codes: 0 pass · 1 matrix failure · 2 connection/IO error.
 */
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

/** Application schemas, split by how much scrutiny each gets on a pull request. */
export const CRITICAL_SCHEMAS = ['iam', 'org', 'inv', 'wo', 'crm', 'sal', 'quo'];
export const ADDITIONAL_SCHEMAS = [
  'veh',
  'apt',
  'rec',
  'tech',
  'dia',
  'qms',
  'svc',
  'wty',
  'rpt',
  'shared',
];

/**
 * Schemas that exist but hold no application data, with the reason. Anything in
 * the database that is in NEITHER this list nor the two above is a finding: a
 * schema nobody classified is a schema nobody checked.
 */
export const NON_APPLICATION_SCHEMAS = {
  extensions:
    'PostgreSQL extension objects (pgcrypto and friends). No tenant data, no RLS surface.',
  supabase_migrations: 'the migration ledger, written by the migration runner.',
  public: 'empty by convention in this schema design; every module owns a named schema.',
  graphql: 'Supabase-managed, absent from a bare postgres container.',
  graphql_public: 'Supabase-managed, absent from a bare postgres container.',
  realtime: 'Supabase-managed, absent from a bare postgres container.',
  storage: 'Supabase-managed, absent from a bare postgres container.',
  vault: 'Supabase-managed, absent from a bare postgres container.',
  auth: 'Supabase-managed, absent from a bare postgres container.',
  net: 'Supabase-managed, absent from a bare postgres container.',
  pgbouncer: 'Supabase-managed, absent from a bare postgres container.',
  cron: 'Supabase-managed, absent from a bare postgres container.',
  supabase_functions:
    'Supabase-managed, absent from a bare postgres container. Two tables, `hooks` and ' +
    '`migrations`, both owned by the Edge Functions runtime. No RootLco migration creates ' +
    'anything here.',
  _realtime:
    'Supabase-managed, absent from a bare postgres container. It carries a table named ' +
    '`tenants` and a column named `tenant_external_id`, and NEITHER means a RootLco tenant — ' +
    "they are the Realtime service's own registry of Supabase PROJECTS. Verified against the " +
    'local stack: one row, `realtime-dev`, which is the project itself. Reading that name as ' +
    'application multi-tenancy would be the obvious mistake here, so it is written down rather ' +
    'than left to the next reader. No RootLco migration creates anything in this schema.',
};

/** Runtime roles the application actually connects as. */
export const RUNTIME_ROLES = [
  { role: 'app_runtime', expectation: 'read and write within scope', mayWrite: true },
  { role: 'app_readonly', expectation: 'SELECT only', mayWrite: false },
  { role: 'app_worker', expectation: 'narrow asynchronous write surface', mayWrite: true },
];

export const ACTIONS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'];

/**
 * Tables exempt from the FORCE RLS requirement, with the reason. Structural
 * reference data owned by the migration role and readable by everyone is not a
 * tenant-scoped resource, so forcing RLS on it would be theatre.
 */
// DELIBERATELY EMPTY. The three tables previously listed here were all wrong in
// one direction or the other: `shared.currencies` and `shared.timezones` both
// DO force row-level security, so the exemption was never consulted, and
// `shared.countries` does not exist at all. An exemption nobody has needed and
// nobody has re-checked is exactly the kind of rationale that gets waved
// through the day it starts to matter.
//
// Every application table currently forces RLS. If a genuine exemption is ever
// needed, add it here with the reason and the reviewer — and the matrix will
// then be asserting something real rather than carrying dead weight.
export const FORCE_RLS_EXEMPT = {};

async function query(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows;
}

/**
 * Reconciles the declared schema lists against what the database actually holds.
 *
 * Two failures, both of which make the matrix a weaker claim than it looks:
 *
 *   unclassified — a schema exists that no list mentions. It is never checked,
 *                  and nobody noticed. A future phase adding a schema hits this.
 *   phantom      — a schema is declared and does not exist. The matrix reports
 *                  it as covered while checking nothing, which is the same
 *                  vacuity as a coverage floor over an empty set.
 */
export async function reconcileSchemas(client) {
  const present = (
    await query(
      client,
      `SELECT nspname FROM pg_namespace
        WHERE nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'
        ORDER BY 1`
    )
  ).map((r) => r.nspname);

  const declared = new Set([...CRITICAL_SCHEMAS, ...ADDITIONAL_SCHEMAS]);
  const known = new Set([...declared, ...Object.keys(NON_APPLICATION_SCHEMAS)]);

  const failures = [];
  for (const schema of present) {
    if (!known.has(schema)) {
      failures.push(
        `schema \`${schema}\` exists in the database but appears in no list in scripts/ci/rls-matrix.mjs. ` +
          'It is therefore never checked. Add it to CRITICAL_SCHEMAS or ADDITIONAL_SCHEMAS, or record why it ' +
          'holds no application data in NON_APPLICATION_SCHEMAS.'
      );
    }
  }
  const phantom = [...declared].filter((s) => !present.includes(s));
  for (const schema of phantom) {
    failures.push(
      `schema \`${schema}\` is declared as an application schema but does not exist. ` +
        'The matrix would report it as covered while checking nothing.'
    );
  }

  return { present, failures, phantom };
}

export async function buildMatrix(client, schemas, options = {}) {
  // `granted-no-policy` is a real smell but its correct severity depends on how
  // the schema grants privileges. It is BLOCKING by default; the flag exists so
  // the policy can be set from measured evidence rather than from a guess, and
  // any downgrade is a visible change in the workflow file.
  const noPolicyIsAdvisory = options.noPolicyIsAdvisory === true;
  const advisories = [];
  const tables = await query(
    client,
    `SELECT c.relname AS table_name,
            n.nspname AS schema_name,
            c.relrowsecurity  AS rls_enabled,
            c.relforcerowsecurity AS rls_forced,
            (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p')
        AND n.nspname = ANY($1)
      ORDER BY n.nspname, c.relname`,
    [schemas]
  );

  const policies = await query(
    client,
    `SELECT n.nspname AS schema_name,
            c.relname AS table_name,
            p.polname AS policy_name,
            CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                          WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                          ELSE 'ALL' END AS command
       FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1)`,
    [schemas]
  );

  const policyIndex = new Map();
  for (const p of policies) {
    const key = `${p.schema_name}.${p.table_name}`;
    if (!policyIndex.has(key)) policyIndex.set(key, []);
    policyIndex.get(key).push(p);
  }

  const cells = [];
  const failures = [];

  for (const table of tables) {
    const qualified = `${table.schema_name}.${table.table_name}`;
    const tablePolicies = policyIndex.get(qualified) ?? [];

    // ---- table-level invariants ----------------------------------------
    if (!table.rls_enabled) {
      failures.push(
        `\`${qualified}\` has ROW LEVEL SECURITY disabled. Every application table must enable it.`
      );
    }
    if (!table.rls_forced && !FORCE_RLS_EXEMPT[qualified]) {
      failures.push(
        `\`${qualified}\` does not FORCE row level security, so the table owner bypasses every policy.`
      );
    }

    for (const { role, mayWrite } of RUNTIME_ROLES) {
      for (const action of ACTIONS) {
        const [{ granted }] = await query(
          client,
          `SELECT has_table_privilege($1, $2, $3) AS granted`,
          [role, qualified, action]
        );
        const covering = tablePolicies.filter((p) => p.command === action || p.command === 'ALL');

        let verdict;
        // Every cell carries a `skipReason`, and this one is always null: the
        // branch below is exhaustive, so no cell here is ever left unasserted.
        // It stays in the record because the schema is shared with cells that
        // ARE skipped, and a field that appears only sometimes is worse to read
        // than one that is explicitly null.
        const skipReason = null;

        if (!granted) {
          verdict = 'denied-by-grant';
        } else if (!table.rls_enabled) {
          verdict = 'UNGUARDED';
          failures.push(
            `\`${role}\` holds ${action} on \`${qualified}\` and the table has no RLS.`
          );
        } else if (covering.length === 0) {
          verdict = 'granted-no-policy';
          const message =
            `\`${role}\` holds ${action} on \`${qualified}\` but no policy covers ${action}. ` +
            'With RLS enabled and no matching policy the action is denied — which means the GRANT is a lie ' +
            'about intent. Either remove the grant or add the policy.';
          (noPolicyIsAdvisory ? advisories : failures).push(message);
        } else {
          verdict = 'granted-with-policy';
        }

        if (!mayWrite && action !== 'SELECT' && granted) {
          failures.push(`read-only role \`${role}\` holds ${action} on \`${qualified}\`.`);
        }

        // The "no verdict computed" guard that used to sit here could never
        // fire — the branch above ends in a plain `else`, so `verdict` is
        // assigned on every path. A safety net that cannot catch anything is
        // worse than none: it reads as though an unhandled combination is
        // covered. If that final `else` is ever narrowed to an `else if`, this
        // is where the missing case would need handling again.

        cells.push({
          schema: table.schema_name,
          table: table.table_name,
          qualified,
          role,
          action,
          granted,
          rlsEnabled: table.rls_enabled,
          rlsForced: table.rls_forced,
          policiesCovering: covering.map((p) => p.policy_name),
          verdict,
          skipReason,
        });
      }
    }
  }

  // ---- SECURITY DEFINER surface ------------------------------------------
  const secdef = await query(
    client,
    `SELECT n.nspname AS schema_name, p.proname AS function_name
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.prosecdef AND n.nspname = ANY($1)
      ORDER BY 1, 2`,
    [schemas]
  );
  for (const fn of secdef) {
    failures.push(
      `\`${fn.schema_name}.${fn.function_name}\` is SECURITY DEFINER, which runs with the owner's rights and bypasses RLS.`
    );
  }

  // ---- no runtime role may bypass RLS or be a superuser -------------------
  const dangerous = await query(
    client,
    `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles
      WHERE rolname = ANY($1) AND (rolsuper OR rolbypassrls)`,
    [RUNTIME_ROLES.map((r) => r.role)]
  );
  for (const role of dangerous) {
    failures.push(
      `runtime role \`${role.rolname}\` has ${role.rolsuper ? 'SUPERUSER' : 'BYPASSRLS'} — it can read every tenant.`
    );
  }

  return {
    ok: failures.length === 0,
    schemas,
    tableCount: tables.length,
    cellCount: cells.length,
    securityDefinerFunctions: secdef.length,
    failures,
    advisories,
    cells,
  };
}

export function summarise(matrix) {
  const byVerdict = {};
  for (const cell of matrix.cells) byVerdict[cell.verdict] = (byVerdict[cell.verdict] ?? 0) + 1;
  const unforced = [...new Set(matrix.cells.filter((c) => !c.rlsForced).map((c) => c.qualified))];
  const disabled = [...new Set(matrix.cells.filter((c) => !c.rlsEnabled).map((c) => c.qualified))];
  return { byVerdict, unforced, disabled };
}

export function toMarkdown(matrix, level) {
  const s = summarise(matrix);
  const lines = [`### RLS matrix (${level})`, ''];
  lines.push('| Measure | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Schemas | ${matrix.schemas.join(', ')} |`);
  lines.push(`| Tables | ${matrix.tableCount} |`);
  lines.push(`| Cells (role × table × action) | ${matrix.cellCount} |`);
  lines.push(`| RLS disabled | ${s.disabled.length} |`);
  lines.push(`| RLS not forced | ${s.unforced.length} |`);
  lines.push(`| SECURITY DEFINER functions | ${matrix.securityDefinerFunctions} |`);
  lines.push('');
  lines.push('| Verdict | Cells |');
  lines.push('| --- | --- |');
  for (const [verdict, count] of Object.entries(s.byVerdict).sort((a, b) => b[1] - a[1])) {
    lines.push(`| \`${verdict}\` | ${count} |`);
  }
  lines.push('');
  if (s.unforced.length) {
    lines.push('<details><summary>Tables without FORCE RLS</summary>');
    lines.push('');
    for (const t of s.unforced) {
      lines.push(
        `- \`${t}\`${FORCE_RLS_EXEMPT[t] ? ` — exempt: ${FORCE_RLS_EXEMPT[t]}` : ' — **not exempt**'}`
      );
    }
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  if (matrix.advisories?.length) {
    lines.push(
      `<details><summary>Advisories (${matrix.advisories.length}, non-blocking at this level)</summary>`
    );
    lines.push('');
    for (const a of matrix.advisories.slice(0, 60)) lines.push(`- ⚠️ ${a}`);
    if (matrix.advisories.length > 60)
      lines.push(`- …and ${matrix.advisories.length - 60} more (see the JSON artifact)`);
    lines.push('');
    lines.push('</details>');
    lines.push('');
  }
  if (matrix.failures.length) {
    lines.push('**Matrix failures**');
    lines.push('');
    for (const f of matrix.failures.slice(0, 60)) lines.push(`- ❌ ${f}`);
    if (matrix.failures.length > 60)
      lines.push(`- …and ${matrix.failures.length - 60} more (see the JSON artifact)`);
  } else {
    lines.push('**RLS matrix: pass**');
  }
  return lines.join('\n');
}

async function main(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const level = arg('--level') ?? 'critical';
  const schemas =
    level === 'full' ? [...CRITICAL_SCHEMAS, ...ADDITIONAL_SCHEMAS] : CRITICAL_SCHEMAS;

  const client = new pg.Client({
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 54322),
    database: process.env.DB_NAME ?? 'postgres',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  });

  try {
    await client.connect();
  } catch (error) {
    console.error(`cannot connect to the database: ${error.message}`);
    process.exit(2);
  }

  let matrix;
  try {
    // Reconcile FIRST: a matrix built over an incomplete or phantom schema list
    // is a weaker claim than it appears, whatever the cells say.
    const reconciliation = await reconcileSchemas(client);
    matrix = await buildMatrix(client, schemas, {
      noPolicyIsAdvisory: argv.includes('--no-policy-advisory'),
    });
    matrix.failures.unshift(...reconciliation.failures);
    matrix.ok = matrix.failures.length === 0;
    matrix.schemasPresent = reconciliation.present;
  } catch (error) {
    console.error(`matrix generation failed: ${error.message}`);
    await client.end();
    process.exit(2);
  }
  await client.end();

  if (matrix.tableCount === 0) {
    console.error(
      `no tables found in ${schemas.join(', ')} — the matrix would report "clean" over an empty set. ` +
        'Were the migrations applied?'
    );
    process.exit(2);
  }

  const md = toMarkdown(matrix, level);
  const mdOut = arg('--markdown');
  if (mdOut) writeFileSync(mdOut, `${md}\n`);
  const jsonOut = arg('--json');
  if (jsonOut) writeFileSync(jsonOut, `${JSON.stringify({ level, ...matrix }, null, 2)}\n`);
  console.log(md);
  process.exit(matrix.ok ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
