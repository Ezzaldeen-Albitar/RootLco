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
 *                     `shared` joined that set in PRE-P1-29 Wave B slice B1:
 *                     app_platform holds SELECT and INSERT on
 *                     shared.idempotency_keys and INSERT on
 *                     shared.number_sequences, so part of the control plane's
 *                     live privilege graph sat in a schema that only the
 *                     nightly run — which happens after the merge — inspected.
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
 * A cell is "covered" only by a policy that applies to THAT CELL'S ROLE. That
 * sounds obvious and was not true here until PRE-P1-29 Wave B slice B1: the
 * policy lookup keyed on table and command alone, so any role granted a
 * privilege on a table that carried some other role's policy was recorded as
 * `granted-with-policy` and passed. See the comment above the policy query.
 *
 * A cell is "granted" if the role holds the privilege on the TABLE **or on any
 * COLUMN of it**. Same slice, same kind of blind spot: has_table_privilege is
 * false for a column-level grant, so every column-scoped privilege in the
 * database was being reported as denied.
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
export const CRITICAL_SCHEMAS = ['iam', 'org', 'shared', 'inv', 'wo', 'crm', 'sal', 'quo'];
export const ADDITIONAL_SCHEMAS = ['veh', 'apt', 'rec', 'tech', 'dia', 'qms', 'svc', 'wty', 'rpt'];

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
  net:
    'Supabase-managed (pg_net), absent from a bare postgres container — but NOT ' +
    'harmless, and the previous one-line dismissal said more than it knew. It ' +
    'grants ALL privileges to PUBLIC on two RLS-DISABLED tables and a sequence, ' +
    'so every role in the database — app_readonly included, which this file ' +
    'declares SELECT-only — can INSERT into net.http_request_queue and make the ' +
    'database issue an arbitrary outbound HTTP request, then read the response ' +
    'body back from net._http_response. PostgreSQL has no per-role revoke of a ' +
    'PUBLIC grant, so no application-role change can scope it away; it is ' +
    'recorded as a platform-configuration dependency in the PRE-P1-29 Wave B B1 ' +
    'NO-GO register rather than left described as nothing.',
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
  /*
   * PRE-P1-29 Wave B slice B1. The privilege-graph migration names THIS gate as
   * the standing control for the over-grant direction, and until the role was
   * listed here that claim was false: RUNTIME_ROLES is the only population this
   * matrix iterates and the only one the superuser/BYPASSRLS check covers, so a
   * later GRANT to app_platform — or the role acquiring BYPASSRLS — would not
   * have failed CI. A control named in a migration and implemented nowhere is
   * the defect class this initiative has spent three rounds removing.
   */
  { role: 'app_platform', expectation: 'control-plane only; no business-table reach', mayWrite: true },
];

/*
 * All EIGHT table privileges, not the four that read like the interesting ones.
 *
 * TRUNCATE is the omission that mattered: row-level security does not apply to
 * TRUNCATE AT ALL, so a TRUNCATE grant is an unconditional "delete every row of
 * every tenant" that no policy can qualify — and the gate never asked for it.
 * REFERENCES lets a role attach a foreign key and learn of rows it cannot read;
 * TRIGGER lets it attach a function that executes with the rights of whoever
 * writes the table, which on a vendor table written by a superuser worker is the
 * whole ballgame. MAINTAIN exists from PostgreSQL 17.
 *
 * Column-capable privileges are SELECT, INSERT, UPDATE and REFERENCES; the rest
 * are table-level only, which the column probe below accounts for.
 */
export const ACTIONS = [
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'TRUNCATE',
  'REFERENCES',
  'TRIGGER',
  'MAINTAIN',
];

/** The subset PostgreSQL will accept in has_any_column_privilege. */
const COLUMN_CAPABLE = new Set(['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']);

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
            c.relkind::text AS relkind,
            c.relrowsecurity  AS rls_enabled,
            c.relforcerowsecurity AS rls_forced,
            coalesce('security_invoker=true' = ANY (c.reloptions), false) AS security_invoker,
            (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      -- Views and materialized views too. Every RootLco table is owned by
      -- postgres, which is BYPASSRLS, and a view that is not security_invoker
      -- runs with its owner's rights — so one granted view over a business table
      -- is a complete, permanent RLS bypass this gate could not report.
      WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
        AND n.nspname = ANY($1)
      ORDER BY n.nspname, c.relname`,
    [schemas]
  );

  /*
   * `applies_to` is the half this query was missing, and its absence made the
   * whole over-grant direction of the matrix unenforceable.
   *
   * A policy is not a property of a table, it is a property of a table AND a set
   * of roles. Selecting only the command meant a cell was judged "covered" by
   * any policy for that action on that table, no matter whose. So granting one
   * role a privilege on a table policied for a DIFFERENT role produced
   * `granted-with-policy` and passed — which is precisely the escalation the
   * matrix exists to catch. Proved by mutation: GRANT SELECT ON
   * crm.business_partners TO app_platform, a role with no policy on that table
   * and no USAGE on that schema, and this gate exited 0.
   *
   * Membership is resolved with pg_has_role rather than by comparing names, so
   * a policy naming a group role still covers a member of it, and polroles =
   * '{0}' (PUBLIC) covers everyone.
   */
  const policies = await query(
    client,
    `SELECT n.nspname AS schema_name,
            c.relname AS table_name,
            p.polname AS policy_name,
            CASE p.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                          WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE'
                          ELSE 'ALL' END AS command,
            ARRAY(
              SELECT rr FROM unnest($2::text[]) AS rr
               WHERE p.polroles = '{0}'::oid[]
                  OR EXISTS (SELECT 1 FROM unnest(p.polroles) AS o
                              WHERE pg_has_role(rr, o, 'MEMBER'))
            ) AS applies_to
       FROM pg_policy p
       JOIN pg_class c ON c.oid = p.polrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = ANY($1)`,
    [schemas, RUNTIME_ROLES.map((r) => r.role)]
  );

  const policyIndex = new Map();
  for (const p of policies) {
    const key = `${p.schema_name}.${p.table_name}`;
    if (!policyIndex.has(key)) policyIndex.set(key, []);
    policyIndex.get(key).push(p);
  }

  const cells = [];
  const failures = [];
  // Observations that are not failures on their own but change how a later
  // grant must be read. Surfaced in the artifact, not in the exit code.
  const matrixNotes = [];

  for (const table of tables) {
    const qualified = `${table.schema_name}.${table.table_name}`;
    const tablePolicies = policyIndex.get(qualified) ?? [];

    /*
     * A VIEW is judged on a different property, because it cannot carry RLS at
     * all — asserting "enable row level security" against one is a category
     * error that would fail every legitimate view forever.
     *
     * What matters for a view is whose rights it runs with. Every RootLco table
     * is owned by postgres, which is BYPASSRLS, so a view that is NOT
     * security_invoker executes with the owner's rights and is a complete,
     * standing bypass of the policies on the tables underneath it. One granted
     * to a runtime role is the finding; the grant check below does the rest.
     */
    const isView = table.relkind === 'v' || table.relkind === 'm' || table.relkind === 'f';

    if (isView) {
      if (!table.security_invoker) {
        // Not yet a failure on its own — an ungranted view reaches nobody. It
        // becomes one the moment a runtime role holds anything on it, which the
        // per-cell UNGUARDED branch below reports.
        matrixNotes.push(
          `\`${qualified}\` is a ${table.relkind === 'm' ? 'materialized view' : 'view'} without security_invoker, so it runs with its owner's rights.`
        );
      }
    } else {
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
    }

    for (const { role, mayWrite } of RUNTIME_ROLES) {
      for (const action of ACTIONS) {
        /*
         * BOTH forms, because has_table_privilege answers FALSE for a
         * column-level grant and this gate was therefore blind to the entire
         * column-grant class. That is not a hypothetical shape in this schema:
         * app_platform's only UPDATE is GRANT UPDATE (status) ON org.tenants and
         * its identity read is GRANT SELECT (id, tenant_id, status, deleted_at)
         * ON iam.user_accounts, and app_runtime holds column-scoped UPDATE on
         * iam.user_accounts too. Every one of them was recorded as
         * denied-by-grant. A GRANT SELECT (col) ON a business table would have
         * passed this gate untouched.
         */
        // DELETE has no column-level form in PostgreSQL — has_any_column_privilege
        // rejects it outright — so the column probe is asked only where columns
        // can carry a privilege at all.
        const columnCapable = COLUMN_CAPABLE.has(action);
        const [{ granted_table: grantedTable, granted_column: grantedColumn }] = await query(
          client,
          columnCapable
            ? `SELECT has_table_privilege($1, $2, $3) AS granted_table,
                      has_any_column_privilege($1, $2, $3) AS granted_column`
            : `SELECT has_table_privilege($1, $2, $3) AS granted_table, false AS granted_column`,
          [role, qualified, action]
        );
        const granted = grantedTable || grantedColumn;
        const covering = tablePolicies.filter(
          (p) =>
            (p.command === action || p.command === 'ALL') &&
            (p.applies_to ?? []).includes(role)
        );

        let verdict;
        // Every cell carries a `skipReason`, and this one is always null: the
        // branch below is exhaustive, so no cell here is ever left unasserted.
        // It stays in the record because the schema is shared with cells that
        // ARE skipped, and a field that appears only sometimes is worse to read
        // than one that is explicitly null.
        const skipReason = null;

        if (!granted) {
          verdict = 'denied-by-grant';
        } else if (isView) {
          verdict = 'UNGUARDED';
          failures.push(
            table.security_invoker
              ? `\`${role}\` holds ${action} on the view \`${qualified}\`. Views are not part of the sanctioned surface: grant on the underlying table instead, where a policy can apply.`
              : `\`${role}\` holds ${action} on \`${qualified}\`, a view WITHOUT security_invoker. It executes with its owner's rights, and every RootLco relation is owned by a BYPASSRLS role — so this is a standing bypass of every policy beneath it.`
          );
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
          // Recorded separately so the artifact shows WHICH form the grant took;
          // a column-scoped privilege reads very differently from a table one.
          grantedVia: granted ? (grantedTable ? 'table' : 'column') : null,
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

  // ---- no runtime role may INHERIT another role's privileges ---------------
  //
  // This is the hole underneath all the others. has_table_privilege resolves
  // privileges reached through MEMBERSHIP, so a runtime role granted another
  // one would read as "granted" on everything that role can touch — and the
  // policy-applicability test above, which resolves membership with
  // pg_has_role for exactly the right reason, would then report each of those
  // cells as covered by the OTHER role's policy. Every cell would land on a
  // passing verdict and the run would exit 0.
  //
  // No amount of per-cell checking can see that, because per-cell is where it
  // hides. It has to be asserted about the roles themselves.
  const memberships = await query(
    client,
    `SELECT r.rolname AS member, g.rolname AS granted
       FROM pg_auth_members m
       JOIN pg_roles r ON r.oid = m.member
       JOIN pg_roles g ON g.oid = m.roleid
      WHERE r.rolname = ANY($1)
      ORDER BY 1, 2`,
    [RUNTIME_ROLES.map((r) => r.role)]
  );
  for (const row of memberships) {
    failures.push(
      `runtime role \`${row.member}\` is a member of \`${row.granted}\` — it inherits every privilege that role holds, and every privilege check in this matrix resolves inherited privileges.`
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
    notes: matrixNotes,
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
  if ((matrix.notes ?? []).length > 0) {
    // Observations that are not failures but change how a later grant reads — a
    // non-invoker view awaiting a grant, say. Rendered here so the inline
    // "surfaced in the artifact" note beside matrixNotes is true of the markdown
    // a reviewer actually reads, not only of the JSON.
    lines.push('### Notes');
    lines.push('');
    for (const note of matrix.notes) lines.push(`- ${note}`);
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
