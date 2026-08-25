#!/usr/bin/env node
/**
 * pg_net privilege-escalation verifier (PRE-P1-29 slice B1).
 *
 * ## What this exists to answer
 *
 * HackerOne report #3964706 was closed `Informative` by Supabase. Closed is not
 * the same as absent, and the response is the reason this file exists rather
 * than a reason it does not: Supabase acknowledged that `net` schema objects are
 * owned by `supabase_admin`, that the pg_net background worker executes as
 * `postgres`, and that a role outside `postgres` can acquire that execution
 * context through the mechanism. They are removing trigger-creation capability
 * as defence in depth. What they also said is that escalation is impractical
 * when the attacker owns no objects — because there is then nothing for the
 * privileged worker to call.
 *
 * That last clause is a statement about the ATTACKER'S database, not about
 * pg_net. It is therefore a claim RootLco has to measure for itself, in every
 * environment it ever runs in, rather than inherit. This verifier is that
 * measurement, mechanised so it can be re-run rather than remembered.
 *
 * ## The chain, and why no single link is the verdict
 *
 * Escalation through pg_net needs THREE things at once:
 *
 *   1. TRIGGER capability on a relation the privileged worker writes, and
 *   2. a persistent callable object whose body the attacker controls, and
 *   3. the worker actually reaching that object.
 *
 * (1) alone is a platform grant that has been present on every Supabase database
 * measured here: `net.http_request_queue` and `net._http_response` both carry
 * `arwdDxtm` for PUBLIC, and the `t` in that string is TRIGGER. A verifier that
 * failed on (1) would fail on a stock Supabase database forever, would fail
 * identically whether RootLco were hardened or wide open, and would therefore
 * carry no information at all. So (1) is reported as a defence-in-depth WARNING
 * and never as a blocker.
 *
 * (2) is the link RootLco actually controls, and it is the one worth measuring.
 * A role that cannot CREATE in any persistent schema, owns no persistent object,
 * and can replace no function has no way to put a body where the worker could
 * reach it. Attach a trigger to `net.http_request_queue` if you like — the only
 * functions it may name are ones somebody else wrote.
 *
 * The verifier's central distinction, printed in exactly these words:
 *
 *   CONTEXT TRANSITION PRESENT      — (1) holds; the platform behaviour exists
 *   PRACTICAL ESCALATION PATH       — (1) and (2) hold; the chain closes
 *
 * ## Why "attacker-controlled" is a narrow phrase here
 *
 * `pg_catalog.RI_FKey_check_ins` returns `trigger` and every role on earth may
 * execute it. It is not a primitive: its body is C, compiled into the server,
 * owned by the bootstrap superuser and replaceable by nobody. Counting it as
 * exposure would put a permanent, unfixable finding in every report and train
 * the reader to skip the section. Control means OWNERSHIP or REPLACEABILITY —
 * `CREATE OR REPLACE` requires ownership, `ALTER FUNCTION` requires ownership,
 * and creating a new one requires CREATE on some persistent schema. Those are
 * the three doors, and this file measures all three.
 *
 * ## Where it runs
 *
 * Against any RootLco database: the isolated B1 candidate, a future staging
 * project, a future production project. It reads catalogues only. It creates
 * nothing, drops nothing, and sends no HTTP request — proving a vulnerability by
 * exploiting it is not proof, it is an incident.
 *
 * Connection comes from DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD, or
 * from PG* / DATABASE_URL if those are what the environment sets. NOTHING about
 * the connection is ever printed — not the URL, not the user, not the host. The
 * report identifies the database by server version and `current_database()`,
 * which are facts about the target rather than credentials for it.
 *
 * ## Exit codes
 *
 *   0  PASS  — no practical escalation path (warnings may be present)
 *   1  BLOCK — a practical escalation path, or a standalone escalation primitive
 *   2        — the verifier could not complete (connection, permission, bug)
 *
 * `--json` writes the machine-readable record to stdout instead of the report.
 * `--role <name>` narrows the roles examined; repeatable. The default is every
 * role matching `app\_%`, which is RootLco's own naming for its runtime roles.
 */
import pg from 'pg';

/**
 * Roles whose membership is, by itself, the end of the argument. Membership in
 * any of these hands the member a path that does not need pg_net at all, so the
 * pg_net question stops being interesting the moment one shows up.
 *
 * `pg_write_server_files` and `pg_execute_server_program` are here for the same
 * reason as the superuser-adjacent Supabase roles: both are trivially
 * convertible into arbitrary code execution as the server account.
 */
const PRIVILEGED_ROLES = [
  'postgres',
  'supabase_admin',
  'supabase_auth_admin',
  'supabase_storage_admin',
  'supabase_replication_admin',
  'supabase_read_only_user',
  'supabase_etl_admin',
  'supabase_privileged_role',
  'pgbouncer',
  'rds_superuser',
  'pg_write_server_files',
  'pg_read_server_files',
  'pg_execute_server_program',
  'pg_signal_backend',
  'pg_write_all_data',
];

/**
 * Relations the pg_net background worker touches while running as `postgres`.
 * A trigger on one of these is the transition point the provider acknowledged.
 * Schema-qualified because a `net` schema somewhere else would be a different
 * object with the same name, and this file is not in the business of guessing.
 */
const WORKER_TOUCHED = [
  { schema: 'net', relation: 'http_request_queue' },
  { schema: 'net', relation: '_http_response' },
];

function parseArgs(argv) {
  const roles = [];
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--json') json = true;
    else if (argv[i] === '--role') {
      const value = argv[i + 1];
      if (!value) throw new Error('--role needs a role name');
      roles.push(value);
      i += 1;
    } else if (argv[i].startsWith('--role=')) roles.push(argv[i].slice('--role='.length));
    else throw new Error(`unrecognised argument: ${argv[i]}`);
  }
  return { roles, json };
}

/**
 * Built WITHOUT ever stringifying a password into anything that could be logged.
 * `DATABASE_URL` is passed to `pg` as `connectionString` and never touched by
 * this file again, so a credential inside it cannot leak through an error
 * message this file formats.
 */
function connectionConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.DB_HOST ?? process.env.PGHOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? process.env.PGPORT ?? 54322),
    database: process.env.DB_NAME ?? process.env.PGDATABASE ?? 'postgres',
    user: process.env.DB_USER ?? process.env.PGUSER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? process.env.PGPASSWORD ?? 'postgres',
  };
}

async function targetRoles(client, requested) {
  if (requested.length > 0) {
    const { rows } = await client.query(
      'SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY rolname',
      [requested]
    );
    const found = rows.map((r) => r.rolname);
    const missing = requested.filter((r) => !found.includes(r));
    if (missing.length > 0) {
      throw new Error(`role(s) not present in this database: ${missing.join(', ')}`);
    }
    return found;
  }
  const { rows } = await client.query(
    "SELECT rolname FROM pg_roles WHERE rolname LIKE 'app\\_%' ORDER BY rolname"
  );
  return rows.map((r) => r.rolname);
}

/** Role attributes — verifier inspection 1. */
async function roleAttributes(client, role) {
  const { rows } = await client.query(
    `SELECT rolcanlogin, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls
       FROM pg_roles WHERE rolname = $1`,
    [role]
  );
  return rows[0];
}

/**
 * Privileged memberships, TRANSITIVELY — verifier inspection 2.
 *
 * `pg_has_role(role, target, 'USAGE')` is the right question rather than a join
 * against `pg_auth_members`: a two-hop grant is exactly as effective as a direct
 * one, and a verifier that only reads the direct table can be defeated by an
 * intermediate role whose only purpose is to be that intermediate.
 *
 * Both 'USAGE' and 'MEMBER' are reported. A NOINHERIT membership grants no
 * privilege until `SET ROLE`, but `SET ROLE` is one statement away, so hiding it
 * would be reporting a distinction the attacker does not have to respect.
 */
async function privilegedMemberships(client, role) {
  const { rows } = await client.query(
    `SELECT r.rolname,
            pg_has_role($1, r.oid, 'USAGE')  AS inherited,
            pg_has_role($1, r.oid, 'MEMBER') AS settable
       FROM pg_roles r
      WHERE r.rolname = ANY($2::text[]) AND r.rolname <> $1
        AND (pg_has_role($1, r.oid, 'USAGE') OR pg_has_role($1, r.oid, 'MEMBER'))
      ORDER BY r.rolname`,
    [role, PRIVILEGED_ROLES]
  );
  return rows;
}

/**
 * Persistent object ownership — verifier inspection 3.
 *
 * `pg_temp_%` and `pg_toast_temp_%` are excluded deliberately, and that
 * exclusion is the whole reason temporary objects are not a finding: a temporary
 * schema belongs to one backend, is unreachable by name from another, and is
 * gone at disconnect. A background worker cannot resolve it, which is precisely
 * why an attacker cannot leave anything there for the worker to find.
 */
async function ownedObjects(client, role) {
  const { rows } = await client.query(
    `WITH temp_ns AS (
       SELECT oid FROM pg_namespace
        WHERE nspname LIKE 'pg\\_temp\\_%' OR nspname LIKE 'pg\\_toast\\_temp\\_%'
     )
     SELECT 'relation' AS kind, n.nspname || '.' || c.relname AS name
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relowner = $1::regrole AND c.relnamespace NOT IN (SELECT oid FROM temp_ns)
     UNION ALL
     SELECT 'schema', nspname FROM pg_namespace WHERE nspowner = $1::regrole
     UNION ALL
     SELECT CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END,
            n.nspname || '.' || p.proname
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proowner = $1::regrole AND p.pronamespace NOT IN (SELECT oid FROM temp_ns)
     UNION ALL
     SELECT 'type', n.nspname || '.' || t.typname
       FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typowner = $1::regrole AND t.typnamespace NOT IN (SELECT oid FROM temp_ns)
        AND t.typtype <> 'b'
     UNION ALL
     SELECT 'extension', extname FROM pg_extension WHERE extowner = $1::regrole
     UNION ALL
     SELECT 'foreign server', srvname FROM pg_foreign_server WHERE srvowner = $1::regrole
     UNION ALL
     SELECT 'fdw', fdwname FROM pg_foreign_data_wrapper WHERE fdwowner = $1::regrole
     ORDER BY 1, 2`,
    [role]
  );
  return rows;
}

/**
 * CREATE on persistent schemas, for the role AND for PUBLIC — inspection 4.
 *
 * `has_schema_privilege` already folds PUBLIC grants into the role's answer, so
 * a CREATE handed to PUBLIC shows up in the role column with no special case —
 * which is the correct unification, since a privilege reachable through PUBLIC
 * is exactly as usable as a privilege granted by name. PUBLIC is measured
 * separately as well, because which grant put it there changes the fix.
 */
async function schemaCreate(client, role) {
  const { rows } = await client.query(
    `SELECT n.nspname,
            has_schema_privilege($1, n.oid, 'CREATE') AS role_create,
            array_to_string(COALESCE(n.nspacl, acldefault('n', n.nspowner)), ',') ~ '(^|,)=[^/]*C'
              AS public_create
       FROM pg_namespace n
      WHERE n.nspname NOT LIKE 'pg\\_temp\\_%' AND n.nspname NOT LIKE 'pg\\_toast\\_temp\\_%'
      ORDER BY n.nspname`,
    [role]
  );
  return rows;
}

/** TRIGGER on the relations the privileged worker writes — inspection 5. */
async function triggerCapability(client, role) {
  const out = [];
  for (const target of WORKER_TOUCHED) {
    const { rows } = await client.query(
      `SELECT has_table_privilege($1, c.oid, 'TRIGGER') AS role_trigger,
              array_to_string(COALESCE(c.relacl, acldefault('r', c.relowner)), ',') ~ '(^|,)=[^/]*t'
                AS public_trigger,
              c.relowner::regrole::text AS owner
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $2 AND c.relname = $3`,
      [role, target.schema, target.relation]
    );
    if (rows.length === 0) {
      out.push({
        ...target,
        present: false,
        roleTrigger: false,
        publicTrigger: false,
        owner: null,
      });
    } else {
      out.push({
        ...target,
        present: true,
        roleTrigger: rows[0].role_trigger,
        publicTrigger: rows[0].public_trigger,
        owner: rows[0].owner,
      });
    }
  }
  return out;
}

/**
 * Callable control — inspection 6, and the link that decides the verdict.
 *
 * Four doors, measured as four facts:
 *
 *   creatable — persistent schemas where the role holds CREATE, so it may write
 *               a NEW function. One is enough.
 *   owned     — functions the role owns, which it may therefore
 *               `CREATE OR REPLACE` or `ALTER ... SET search_path` at will.
 *   viaMember — functions owned by a role this one is a member of. Ownership
 *               checks in PostgreSQL are membership checks, so a function owned
 *               by a group the role belongs to is a function the role can
 *               replace. Missing this is how a "zero owned objects" report can
 *               be true and meaningless at the same time.
 *   temporary — the FOURTH door, and the one every earlier analysis of this
 *               database missed. `has_database_privilege(role, db, 'TEMPORARY')`
 *               lets the role `CREATE FUNCTION pg_temp.f() RETURNS trigger` with
 *               a body it controls. pg_temp is not persistent, but it is not
 *               unreachable either: the catalogue rows (pg_proc) are
 *               cluster-shared, a stored trigger names its function by OID, and a
 *               DIFFERENT backend — measured, the live pg_net 0.20.3 worker —
 *               RESOLVES AND EXECUTES that temp function while the authoring
 *               session is held open. The worker fires ORIGIN row triggers (it
 *               does not run under session_replication_role=replica) as a
 *               SUPERUSER. So a temp callable, attached to a worker-touched
 *               relation via the TRIGGER door, is a body the worker runs. This
 *               door only reaches the worker THROUGH a trigger on a
 *               worker-touched relation, so — unlike the persistent doors — it is
 *               scored as a practical path only when the transition is also
 *               present, never as a standalone primitive.
 */
async function temporaryPrivilege(client, role) {
  const { rows } = await client.query(
    `SELECT has_database_privilege($1, current_database(), 'TEMPORARY') AS can_temp,
            array_to_string(COALESCE(d.datacl, acldefault('d', d.datdba)), ',') ~ '(^|,)=[^/]*T'
              AS public_temp
       FROM pg_database d WHERE d.datname = current_database()`,
    [role]
  );
  return { canTemp: rows[0].can_temp, publicTemp: rows[0].public_temp };
}

async function callableControl(client, role, schemas) {
  const creatable = schemas.filter((s) => s.role_create).map((s) => s.nspname);
  const { rows: owned } = await client.query(
    `SELECT n.nspname || '.' || p.proname AS name,
            p.prosecdef,
            p.prorettype = 'trigger'::regtype AS returns_trigger
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proowner = $1::regrole AND n.nspname NOT LIKE 'pg\\_temp\\_%'
      ORDER BY 1`,
    [role]
  );
  const { rows: viaMember } = await client.query(
    `SELECT n.nspname || '.' || p.proname AS name, p.proowner::regrole::text AS owner
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proowner <> $1::regrole
        AND pg_has_role($1, p.proowner, 'MEMBER')
        AND n.nspname NOT LIKE 'pg\\_temp\\_%'
      ORDER BY 1`,
    [role]
  );
  return { creatable, owned, viaMember };
}

/**
 * SECURITY DEFINER exposure, classified rather than counted — inspection 7.
 *
 * A SECURITY DEFINER function the role may EXECUTE is not automatically a
 * finding: `iam.has_permission` is one, and it exists so a policy can ask a
 * question the caller may not answer for itself. The finding is a SECURITY
 * DEFINER function whose BODY the role controls, because that is the shape that
 * runs attacker code as the definer. So each one is tagged `controlled` or not,
 * and only the controlled ones move the verdict.
 */
async function securityDefiners(client, role) {
  const { rows } = await client.query(
    `SELECT n.nspname || '.' || p.proname AS name,
            p.proowner::regrole::text AS owner,
            l.lanname AS language,
            COALESCE(array_to_string(p.proconfig, ' '), '(none)') AS config,
            pg_get_function_identity_arguments(p.oid) AS args,
            (p.proowner = $1::regrole OR pg_has_role($1, p.proowner, 'MEMBER')) AS controlled
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_language l ON l.oid = p.prolang
      WHERE p.prosecdef AND has_function_privilege($1, p.oid, 'EXECUTE')
        AND n.nspname NOT LIKE 'pg\\_temp\\_%'
      ORDER BY 1`,
    [role]
  );
  return rows;
}

/**
 * Every trigger-returning function the role may execute, with the provenance
 * that decides whether it matters — inspection 8. An `internal`/`c` function
 * belonging to `pg_catalog` or to an extension is compiled code nobody can
 * rewrite through SQL; a `plpgsql` function the role owns is the opposite.
 */
async function triggerFunctions(client, role) {
  const { rows } = await client.query(
    `SELECT n.nspname || '.' || p.proname AS name,
            p.proowner::regrole::text AS owner,
            l.lanname AS language,
            p.prosecdef AS security_definer,
            COALESCE((SELECT e.extname FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid
                       WHERE d.classid = 'pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
                       LIMIT 1), '') AS extension,
            (p.proowner = $1::regrole OR pg_has_role($1, p.proowner, 'MEMBER')) AS controlled
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
       JOIN pg_language l ON l.oid = p.prolang
      WHERE p.prorettype = 'trigger'::regtype AND has_function_privilege($1, p.oid, 'EXECUTE')
        AND n.nspname NOT LIKE 'pg\\_temp\\_%'
      ORDER BY 1`,
    [role]
  );
  return rows;
}

/** The pg_net surface itself: who may enqueue, and who may call the wrappers — inspection 9. */
async function pgNetGrants(client, role) {
  const { rows: functions } = await client.query(
    `SELECT n.nspname || '.' || p.proname AS name,
            has_function_privilege($1, p.oid, 'EXECUTE') AS executable
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'net'
      ORDER BY 1`,
    [role]
  );
  const { rows: relations } = await client.query(
    `SELECT c.relname,
            has_table_privilege($1, c.oid, 'SELECT') AS can_select,
            has_table_privilege($1, c.oid, 'INSERT') AS can_insert,
            has_table_privilege($1, c.oid, 'TRIGGER') AS can_trigger
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'net' AND c.relkind IN ('r', 'p')
      ORDER BY 1`,
    [role]
  );
  return { functions, relations };
}

/**
 * The decision. Ordered so the report reads as an argument rather than a list:
 * an escalation that does not need pg_net is stated first, because if one exists
 * the pg_net finding is a footnote.
 */
function adjudicate(finding) {
  const blockers = [];
  const warnings = [];
  const a = finding.attributes;

  if (a.rolsuper) blockers.push('SUPERUSER — every other check is moot');
  if (a.rolbypassrls)
    blockers.push('BYPASSRLS — tenant isolation is not enforced against this role');
  if (a.rolcreaterole)
    blockers.push('CREATEROLE — the role can grant itself membership in another role');
  if (a.rolreplication) blockers.push('REPLICATION — the role can stream the whole cluster');
  if (a.rolcreatedb) {
    warnings.push(
      'CREATEDB — not an escalation primitive here, but not intended for a runtime role'
    );
  }

  for (const m of finding.memberships) {
    blockers.push(
      `membership in ${m.rolname} (${m.inherited ? 'inherited' : 'via SET ROLE'}) — ` +
        'a path that does not need pg_net'
    );
  }

  const control = finding.callableControl;

  // The PERSISTENT doors — each a standalone primitive, because a persistent
  // callable body outlives the authoring session and could be reached by more
  // than just a pg_net trigger.
  const persistentReasons = [];
  if (control.creatable.length > 0) {
    persistentReasons.push(`CREATE on persistent schema(s): ${control.creatable.join(', ')}`);
  }
  if (control.owned.length > 0) {
    persistentReasons.push(
      `owns ${control.owned.length} persistent function(s) it may CREATE OR REPLACE`
    );
  }
  if (control.viaMember.length > 0) {
    persistentReasons.push(
      `may replace ${control.viaMember.length} function(s) owned by a role it is a member of`
    );
  }
  const hasPersistentControl = persistentReasons.length > 0;

  // The TEMP door — a callable body the role can author, but one the pg_net
  // worker reaches ONLY through a trigger on a worker-touched relation. Scored
  // as a practical path when the transition is present, and as a defence-in-depth
  // warning when it is not.
  const hasTempControl = finding.temporary.canTemp;
  const tempReason =
    `TEMPORARY on the database (${finding.temporary.publicTemp ? 'via PUBLIC' : 'granted to this role'})` +
    ' — may author a pg_temp trigger function the worker resolves by OID and runs as a superuser';

  for (const d of finding.securityDefiners.filter((x) => x.controlled)) {
    blockers.push(
      `SECURITY DEFINER function under this role's control: ${d.name} (owner ${d.owner})`
    );
  }

  const transition = finding.triggerCapability.filter((t) => t.present && t.roleTrigger);
  const hasTransition = transition.length > 0;
  const transitionNames = transition.map((t) => `${t.schema}.${t.relation}`).join(', ');

  if (hasPersistentControl && hasTransition) {
    blockers.push(
      `PRACTICAL ESCALATION PATH — ${persistentReasons.join('; ')}, combined with TRIGGER on ` +
        `${transitionNames}, which the pg_net worker writes as a privileged role. This role can place ` +
        'a body the worker will run.'
    );
  } else if (hasPersistentControl) {
    blockers.push(
      `persistent callable primitive present — ${persistentReasons.join('; ')}. No pg_net transition is ` +
        'reachable in this database today, but the primitive is the half RootLco owns and it must be zero.'
    );
  }

  if (hasTempControl && hasTransition) {
    blockers.push(
      `PRACTICAL ESCALATION PATH — ${tempReason}, combined with TRIGGER on ${transitionNames}. ` +
        'Measured end-to-end on the pg_net 0.20.3 worker: an app_% role authored pg_temp.evil(), attached ' +
        'it to net._http_response, and the worker executed it as supabase_admin (superuser) on the next ' +
        'response insert. The temp body is not persistent, but the authoring session controls how long it ' +
        'lives and the same session enqueues the request that drives the worker.'
    );
  } else if (hasTransition && !hasPersistentControl) {
    warnings.push(
      `CONTEXT TRANSITION PRESENT — TRIGGER on ${transitionNames} ` +
        `(${transition.every((t) => t.publicTrigger) ? 'granted to PUBLIC by the platform' : 'granted to this role'}). ` +
        'This role controls no persistent callable object AND cannot author a pg_temp one (no TEMPORARY), so a ' +
        'trigger it created could only name a function somebody else wrote. Defence in depth, tracked for the hosted gate.'
    );
  } else if (hasTempControl && !hasTransition) {
    warnings.push(
      `${tempReason}. NOT a practical path in this database today: no TRIGGER on a worker-touched relation is ` +
        'reachable, so there is no way to attach the temp body where the worker would run it. Tracked for the hosted gate.'
    );
  }

  const uncontrolledDefiners = finding.securityDefiners.filter((x) => !x.controlled).length;
  if (uncontrolledDefiners > 0) {
    warnings.push(
      `${uncontrolledDefiners} SECURITY DEFINER function(s) executable and NOT under this role's control — ` +
        'expected for policy helpers; every one is listed in the JSON record'
    );
  }

  const netCallable = finding.pgNet.functions.filter((f) => f.executable);
  if (netCallable.length > 0) {
    warnings.push(`${netCallable.length} net.* function(s) executable by this role`);
  }

  return { blockers, warnings, verdict: blockers.length === 0 ? 'PASS' : 'BLOCK' };
}

async function inspect(client, role) {
  const schemas = await schemaCreate(client, role);
  const finding = {
    role,
    attributes: await roleAttributes(client, role),
    memberships: await privilegedMemberships(client, role),
    ownedObjects: await ownedObjects(client, role),
    schemas,
    triggerCapability: await triggerCapability(client, role),
    temporary: await temporaryPrivilege(client, role),
    callableControl: await callableControl(client, role, schemas),
    securityDefiners: await securityDefiners(client, role),
    triggerFunctions: await triggerFunctions(client, role),
    pgNet: await pgNetGrants(client, role),
  };
  return { ...finding, ...adjudicate(finding) };
}

function report(target, findings) {
  const lines = [];
  lines.push('pg_net privilege-escalation verifier');
  lines.push(`  database        ${target.database}`);
  lines.push(`  server          ${target.version}`);
  lines.push(`  pg_net          ${target.pgNetVersion ?? 'NOT INSTALLED'}`);
  lines.push(
    `  net schema      ${target.netSchema ? `present, owned by ${target.netOwner}` : 'absent'}`
  );
  lines.push(`  roles examined  ${findings.map((f) => f.role).join(', ') || '(none)'}`);
  lines.push('');

  for (const f of findings) {
    const a = f.attributes;
    lines.push(`-- ${f.role} -- ${f.verdict}`);
    lines.push(
      `   attributes                   login=${a.rolcanlogin} super=${a.rolsuper} ` +
        `inherit=${a.rolinherit} createrole=${a.rolcreaterole} createdb=${a.rolcreatedb} ` +
        `replication=${a.rolreplication} bypassrls=${a.rolbypassrls}`
    );
    lines.push(`   privileged memberships       ${f.memberships.length}`);
    lines.push(`   persistent objects owned     ${f.ownedObjects.length}`);
    lines.push(
      `   CREATE on persistent schemas ${f.callableControl.creatable.length} of ${f.schemas.length}` +
        (f.callableControl.creatable.length > 0
          ? ` (${f.callableControl.creatable.join(', ')})`
          : '')
    );
    lines.push(
      '   PUBLIC CREATE schemas        ' +
        (f.schemas
          .filter((s) => s.public_create)
          .map((s) => s.nspname)
          .join(', ') || '0')
    );
    for (const t of f.triggerCapability) {
      lines.push(
        `   TRIGGER ${t.schema}.${t.relation}`.padEnd(34) +
          (!t.present
            ? 'relation absent'
            : `${t.roleTrigger}${t.publicTrigger ? ' (via PUBLIC)' : ''}`)
      );
    }
    lines.push(
      `   persistent callable control  owned=${f.callableControl.owned.length} ` +
        `replaceable-via-membership=${f.callableControl.viaMember.length}`
    );
    lines.push(
      `   TEMPORARY on database        ${f.temporary.canTemp}` +
        (f.temporary.canTemp
          ? f.temporary.publicTemp
            ? ' (via PUBLIC)'
            : ' (granted to role)'
          : '')
    );
    lines.push(
      `   SECURITY DEFINER executable  ${f.securityDefiners.length} ` +
        `(under this role's control: ${f.securityDefiners.filter((d) => d.controlled).length})`
    );
    lines.push(
      `   trigger-returning executable ${f.triggerFunctions.length} ` +
        `(under this role's control: ${f.triggerFunctions.filter((d) => d.controlled).length})`
    );
    for (const b of f.blockers) lines.push(`   BLOCK   ${b}`);
    for (const w of f.warnings) lines.push(`   WARN    ${w}`);
    lines.push('');
  }

  const blocked = findings.filter((f) => f.verdict === 'BLOCK');
  if (blocked.length > 0) {
    lines.push(
      `RESULT: BLOCK — ${blocked.length} role(s) with a practical escalation path or a standalone primitive.`
    );
  } else {
    lines.push(
      'RESULT: PASS — no practical privilege-escalation path through pg_net for any role examined.'
    );
    if (findings.some((f) => f.warnings.some((w) => w.startsWith('CONTEXT TRANSITION PRESENT')))) {
      lines.push(
        'The provider-acknowledged context transition IS present as a platform grant. It is not an ' +
          'escalation path here because no examined role controls a persistent callable object.'
      );
    }
  }
  return lines.join('\n');
}

async function main() {
  const { roles, json } = parseArgs(process.argv.slice(2));
  const client = new pg.Client(connectionConfig());
  await client.connect();
  try {
    const { rows: meta } = await client.query(
      `SELECT current_database() AS database,
              current_setting('server_version') AS version,
              (SELECT extversion FROM pg_extension WHERE extname = 'pg_net') AS pgnet,
              (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'net') AS net_owner`
    );
    const target = {
      database: meta[0].database,
      version: meta[0].version,
      pgNetVersion: meta[0].pgnet,
      netSchema: meta[0].net_owner !== null,
      netOwner: meta[0].net_owner,
    };
    const names = await targetRoles(client, roles);
    const findings = [];
    for (const role of names) findings.push(await inspect(client, role));

    process.stdout.write(
      json ? `${JSON.stringify({ target, findings }, null, 2)}\n` : `${report(target, findings)}\n`
    );
    process.exitCode = findings.some((f) => f.verdict === 'BLOCK') ? 1 : 0;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`pg_net verifier could not complete: ${error.message}\n`);
  process.exitCode = 2;
});
