#!/usr/bin/env node
/**
 * Red proofs for the pg_net escalation verifier (PRE-P1-29 slice B1).
 *
 * ## Why this file exists at all
 *
 * `pgnet-escalation-verifier.mjs` returns PASS on the RootLco database. A green
 * security check is worth exactly as much as the evidence that it can go red,
 * and no more: a verifier with an inverted condition, a typo in a role name or a
 * query that silently returns zero rows also returns PASS, on every database,
 * forever. So each decision branch is provoked here on purpose and asserted to
 * fire, and the run FAILS if a mutation the verifier is supposed to catch slips
 * past it.
 *
 * Seven proofs:
 *
 *   RED-1   CREATE on a persistent schema          -> BLOCK
 *   RED-2   ownership of a persistent trigger fn   -> BLOCK  (with CREATE
 *                                                    revoked first, so the two
 *                                                    doors are proven apart)
 *   RED-3   membership in a privileged role        -> BLOCK
 *   RED-3b  the same membership TWO HOPS away      -> BLOCK
 *   RED-4   TRIGGER and nothing else               -> PASS with the
 *                                                    defence-in-depth warning,
 *                                                    and the warning DISAPPEARS
 *                                                    when the grant does
 *   RED-5   a pg_temp object and nothing else      -> PASS, no persistent path
 *   RED-6   a controlled SECURITY DEFINER function -> BLOCK
 *
 * RED-4 is the one that matters most and the easiest to get wrong. The refined
 * threat model says PUBLIC TRIGGER is a platform grant and not by itself an
 * escalation path, so the verifier must NOT fail on it — but a verifier that
 * ignores it entirely is equally wrong, because that grant is exactly what a
 * hosted re-verification has to re-measure. So RED-4 asserts BOTH directions:
 * the warning is present while the grant is, and gone when it is not. Only the
 * second direction proves the warning is a measurement rather than a constant.
 *
 * ## What is mutated, and what is deliberately not
 *
 * The subject of RED-1, RED-2, RED-3, RED-3b and RED-6 is a DISPOSABLE role this
 * script creates and drops, given the same attribute profile as B1's runtime
 * roles. RootLco's real `app_platform` is never granted anything, never made an
 * owner and never given a membership — it is measured before and after and
 * asserted unchanged. A red proof that mutated the very role whose safety is the
 * subject of the report would be arguing with itself.
 *
 * RED-4 is the exception, because `net.http_request_queue` is a single shared
 * object and the grant under test is on that object. It needs a connection as
 * the relation's OWNER: `postgres` is not superuser on a Supabase database and
 * is not a member of `supabase_admin`, so a REVOKE issued as `postgres` is a
 * no-op that emits a warning and changes nothing — which would look exactly like
 * a passing proof while proving nothing at all. That trap is why the owner
 * connection is REQUIRED rather than optional: without it RED-4's second
 * direction is recorded as NOT PROVEN and the run fails.
 *
 * ## The safety rail
 *
 * This script GRANTS PRIVILEGES AND CREATES OBJECTS. It refuses to start unless
 * `PGNET_RED_PROOF_TARGET` is set to the literal string `disposable` — a
 * deliberate speed bump, so nobody points it at a shared or hosted database by
 * reflex. Every mutation is undone in a `finally`, and the script re-runs the
 * verifier one last time to prove the database is back at its baseline verdict
 * before reporting success. It never sends an HTTP request and never creates a
 * trigger on a `net` relation: the question is whether the PRIMITIVE exists, and
 * that is a question about privileges, answered by reading privileges.
 *
 * ## Configuration
 *
 *   PGNET_RED_PROOF_TARGET=disposable        required, exactly this string
 *   DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD   the admin connection
 *   PGNET_RED_PROOF_OWNER_USER               role owning net.* (supabase_admin)
 *   PGNET_RED_PROOF_OWNER_PASSWORD           its password; falls back to DB_PASSWORD
 *
 * Exit 0 = every proof behaved as specified and the baseline was restored.
 * Exit 1 = a proof did not fire, a proof could not be run, or restoration failed.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const VERIFIER = resolve(HERE, 'pgnet-escalation-verifier.mjs');

/** The disposable stand-in. Never one of RootLco's own roles. */
const SUBJECT = 'pgnet_red_proof_role';
const TEST_SCHEMA = 'pgnet_red_proof';
const TEST_GROUP = 'pgnet_red_proof_group';
/** Measured before and after, and asserted untouched. */
const REAL_ROLE = process.env.PGNET_RED_PROOF_WITNESS ?? 'app_platform';

function connectionConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 54322),
    database: process.env.DB_NAME ?? 'postgres',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? 'postgres',
  };
}

function ownerConfig() {
  const user = process.env.PGNET_RED_PROOF_OWNER_USER;
  if (!user) return null;
  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 54322),
    database: process.env.DB_NAME ?? 'postgres',
    user,
    password: process.env.PGNET_RED_PROOF_OWNER_PASSWORD ?? process.env.DB_PASSWORD ?? 'postgres',
  };
}

/**
 * Runs the verifier as a CHILD PROCESS rather than importing it. The exit code
 * is half of the contract this file is testing, and an in-process import would
 * exercise the functions while leaving the code path a CI job actually depends
 * on untested.
 */
function runVerifier(role) {
  const result = spawnSync(process.execPath, [VERIFIER, '--role', role, '--json'], {
    encoding: 'utf8',
    env: process.env,
  });
  if (result.status === 2) throw new Error(`verifier could not complete: ${result.stderr.trim()}`);
  const finding = JSON.parse(result.stdout).findings[0];
  return {
    exitCode: result.status,
    verdict: finding.verdict,
    blockers: finding.blockers,
    warnings: finding.warnings,
  };
}

const failures = [];

function expect(label, condition, detail) {
  if (condition) {
    process.stdout.write(`  PASS  ${label}\n`);
  } else {
    process.stdout.write(`  FAIL  ${label} — ${detail}\n`);
    failures.push(`${label}: ${detail}`);
  }
}

function blockedBecause(run, fragment) {
  return run.blockers.some((b) => b.includes(fragment));
}

async function main() {
  if (process.env.PGNET_RED_PROOF_TARGET !== 'disposable') {
    process.stderr.write(
      'Refusing to run: these proofs GRANT privileges and CREATE objects.\n' +
        'Set PGNET_RED_PROOF_TARGET=disposable and point DB_* at a database you can throw away.\n'
    );
    process.exitCode = 1;
    return;
  }

  const client = new pg.Client(connectionConfig());
  await client.connect();

  /*
   * A SECOND connection, as the role that owns `net.*` — on Supabase,
   * `supabase_admin`. Two proofs need it and neither can fake it:
   *
   *   RED-3/3b  `pg_write_server_files` is a RESERVED membership. Only a
   *             superuser may grant it, and `postgres` is NOT superuser on a
   *             Supabase database. Issued on the ordinary connection the GRANT
   *             ERRORS, which at least fails loudly.
   *   RED-4     a REVOKE issued by a non-owner is a NO-OP that emits a warning
   *             and changes nothing — which looks exactly like a passing proof
   *             while proving nothing at all. That is the trap this connection
   *             exists to avoid, and it is why the second direction is recorded
   *             NOT PROVEN rather than skipped when the connection is absent.
   */
  const superuser = ownerConfig() === null ? null : new pg.Client(ownerConfig());
  if (superuser !== null) await superuser.connect();

  /*
   * The connecting role, by NAME.
   *
   * `GRANT <role> TO CURRENT_USER` segfaults the backend on the Supabase
   * PostgreSQL image measured here (supautils role-grant hook, signal 11,
   * reproducible); naming the grantee explicitly does not. That is a provider
   * defect and no business of RootLco to fix, but a harness that trips it
   * cannot produce evidence, so the grantee is always named.
   */
  const { rows: whoami } = await client.query(
    'SELECT current_user AS name, quote_ident(current_user) AS ident'
  );
  const ME = whoami[0].ident;

  // The witness: RootLco's real runtime role, measured before anything happens.
  const witnessBefore = runVerifier(REAL_ROLE);
  process.stdout.write(
    `witness ${REAL_ROLE}: ${witnessBefore.verdict}, ${witnessBefore.warnings.length} warning(s)\n`
  );
  if (witnessBefore.verdict !== 'PASS') {
    process.stderr.write(
      `${REAL_ROLE} is already BLOCK — the red proofs cannot isolate their own effect.\n`
    );
    await client.end();
    process.exitCode = 1;
    return;
  }

  try {
    // The disposable subject, given B1's own attribute profile so the baseline
    // it starts from is the baseline the report is about.
    await client.query(
      `CREATE ROLE ${SUBJECT} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT`
    );
    await client.query(`GRANT ${SUBJECT} TO ${ME}`);

    const baseline = runVerifier(SUBJECT);
    process.stdout.write(
      `baseline ${SUBJECT}: ${baseline.verdict} (exit ${baseline.exitCode})\n\n`
    );
    expect(
      'the disposable subject starts at PASS',
      baseline.verdict === 'PASS',
      `got ${baseline.verdict}`
    );
    const baselineWarnings = baseline.warnings.length;

    // RED-1 — CREATE on a persistent schema. The first door: the role can write
    // a NEW function into a schema the worker can resolve by name.
    process.stdout.write('RED-1  CREATE on a persistent schema\n');
    await client.query(`CREATE SCHEMA ${TEST_SCHEMA}`);
    await client.query(`GRANT CREATE, USAGE ON SCHEMA ${TEST_SCHEMA} TO ${SUBJECT}`);
    {
      const run = runVerifier(SUBJECT);
      expect('verdict is BLOCK', run.verdict === 'BLOCK', `got ${run.verdict}`);
      expect('exit code is 1', run.exitCode === 1, `got ${run.exitCode}`);
      expect(
        'the blocker names the schema',
        blockedBecause(run, TEST_SCHEMA),
        JSON.stringify(run.blockers)
      );
      expect(
        'it is reported as a CLOSED CHAIN, not a bare primitive',
        blockedBecause(run, 'PRACTICAL ESCALATION PATH'),
        'TRIGGER is present in this database, so the chain closes and the message must say so'
      );
    }
    await client.query(`REVOKE CREATE ON SCHEMA ${TEST_SCHEMA} FROM ${SUBJECT}`);
    expect('restored', runVerifier(SUBJECT).verdict === 'PASS', 'verdict did not return to PASS');

    // RED-2 — ownership WITHOUT create. The second door, proven independently:
    // CREATE is revoked above, so the only thing the role holds is a function it
    // owns — and owning it is enough to CREATE OR REPLACE the body.
    process.stdout.write(
      '\nRED-2  ownership of a persistent trigger function (CREATE already revoked)\n'
    );
    // PostgreSQL requires a function's NEW owner to hold CREATE on the
    // containing schema, so the grant comes back for exactly the two statements
    // that need it and is gone again before anything is measured. RED-2 has to
    // find ownership and nothing else, or it is not proving a second door.
    await client.query(`GRANT CREATE ON SCHEMA ${TEST_SCHEMA} TO ${SUBJECT}`);
    await client.query(
      `CREATE FUNCTION ${TEST_SCHEMA}.red_proof_trigger() RETURNS trigger
         LANGUAGE plpgsql AS $fn$ BEGIN RETURN NEW; END $fn$`
    );
    await client.query(`ALTER FUNCTION ${TEST_SCHEMA}.red_proof_trigger() OWNER TO ${SUBJECT}`);
    await client.query(`REVOKE CREATE ON SCHEMA ${TEST_SCHEMA} FROM ${SUBJECT}`);
    {
      const run = runVerifier(SUBJECT);
      expect('verdict is BLOCK', run.verdict === 'BLOCK', `got ${run.verdict}`);
      expect(
        'the blocker names replaceable ownership',
        blockedBecause(run, 'CREATE OR REPLACE'),
        JSON.stringify(run.blockers)
      );
      expect(
        'CREATE is NOT among the reasons',
        !blockedBecause(run, 'CREATE on persistent schema'),
        'CREATE was revoked, so citing it would mean the two doors are not measured separately'
      );
    }
    await client.query(`ALTER FUNCTION ${TEST_SCHEMA}.red_proof_trigger() OWNER TO ${ME}`);
    expect('restored', runVerifier(SUBJECT).verdict === 'PASS', 'verdict did not return to PASS');

    // RED-6 — a SECURITY DEFINER function whose body the role controls. Here
    // rather than last because it reuses the same disposable schema.
    process.stdout.write("\nRED-6  a SECURITY DEFINER function under the role's control\n");
    await client.query(`GRANT CREATE, USAGE ON SCHEMA ${TEST_SCHEMA} TO ${SUBJECT}`);
    await client.query(
      `CREATE FUNCTION ${TEST_SCHEMA}.red_proof_definer() RETURNS text
         LANGUAGE sql SECURITY DEFINER AS $fn$ SELECT current_user::text $fn$`
    );
    await client.query(`ALTER FUNCTION ${TEST_SCHEMA}.red_proof_definer() OWNER TO ${SUBJECT}`);
    // CREATE goes again immediately: the finding under test is the SECURITY
    // DEFINER function, and leaving CREATE in place would let RED-1's blocker
    // fire instead and make this proof pass for the wrong reason.
    await client.query(`REVOKE CREATE ON SCHEMA ${TEST_SCHEMA} FROM ${SUBJECT}`);
    {
      const run = runVerifier(SUBJECT);
      expect('verdict is BLOCK', run.verdict === 'BLOCK', `got ${run.verdict}`);
      expect(
        'the blocker names the SECURITY DEFINER function',
        blockedBecause(run, 'red_proof_definer'),
        JSON.stringify(run.blockers)
      );
      expect(
        'CREATE is NOT among the reasons',
        !blockedBecause(run, 'CREATE on persistent schema'),
        'CREATE was revoked, so this proof must stand on the SECURITY DEFINER finding alone'
      );
    }
    await client.query(`DROP FUNCTION ${TEST_SCHEMA}.red_proof_definer()`);
    expect('restored', runVerifier(SUBJECT).verdict === 'PASS', 'verdict did not return to PASS');

    // RED-3 — a privileged membership. The path that does not need pg_net.
    process.stdout.write('\nRED-3  membership in a privileged role\n');
    if (superuser === null) {
      expect(
        'membership in a privileged role is caught',
        false,
        'NOT PROVEN — PGNET_RED_PROOF_OWNER_USER was not supplied, and pg_write_server_files is a ' +
          'reserved membership only a superuser may grant'
      );
    } else {
      await superuser.query(`GRANT pg_write_server_files TO ${SUBJECT}`);
      {
        const run = runVerifier(SUBJECT);
        expect('verdict is BLOCK', run.verdict === 'BLOCK', `got ${run.verdict}`);
        expect(
          'the blocker names the membership',
          blockedBecause(run, 'pg_write_server_files'),
          JSON.stringify(run.blockers)
        );
        expect(
          'and says pg_net is not needed for it',
          blockedBecause(run, 'does not need pg_net'),
          'an escalation that bypasses pg_net must be reported as such, not folded into the pg_net finding'
        );
      }
      await superuser.query(`REVOKE pg_write_server_files FROM ${SUBJECT}`);
      expect('restored', runVerifier(SUBJECT).verdict === 'PASS', 'verdict did not return to PASS');
    }

    // RED-3b — the same membership two hops away, which a verifier reading
    // pg_auth_members directly would miss. Not on the Owner's list; it is here
    // because a transitive query is the kind of thing that looks right and is
    // not, and one extra grant settles it either way.
    process.stdout.write('\nRED-3b transitive membership through an intermediate group\n');
    if (superuser === null) {
      expect(
        'the two-hop membership is seen',
        false,
        'NOT PROVEN — no superuser connection supplied'
      );
    } else {
      await client.query(`CREATE ROLE ${TEST_GROUP} NOLOGIN`);
      await superuser.query(`GRANT pg_write_server_files TO ${TEST_GROUP}`);
      await client.query(`GRANT ${TEST_GROUP} TO ${SUBJECT}`);
      {
        const run = runVerifier(SUBJECT);
        expect('verdict is BLOCK', run.verdict === 'BLOCK', `got ${run.verdict}`);
        expect(
          'the two-hop membership is seen',
          blockedBecause(run, 'pg_write_server_files'),
          JSON.stringify(run.blockers)
        );
      }
      await client.query(`REVOKE ${TEST_GROUP} FROM ${SUBJECT}`);
      await superuser.query(`REVOKE pg_write_server_files FROM ${TEST_GROUP}`);
      await client.query(`DROP ROLE ${TEST_GROUP}`);
      expect('restored', runVerifier(SUBJECT).verdict === 'PASS', 'verdict did not return to PASS');
    }

    // RED-5 — a temporary object and nothing else. The proof that excluding
    // pg_temp from the ownership query is a decision rather than an oversight:
    // the object exists, the verdict does not move, and a SECOND session cannot
    // even name it. The pg_net worker runs in a different backend, so what it
    // cannot name it cannot call.
    process.stdout.write('\nRED-5  a pg_temp object and nothing else\n');
    {
      const temp = new pg.Client(connectionConfig());
      await temp.connect();
      await temp.query('CREATE TEMP TABLE red_proof_temp(id int)');
      await temp.query(
        `CREATE FUNCTION pg_temp.red_proof_temp_fn() RETURNS trigger
           LANGUAGE plpgsql AS $fn$ BEGIN RETURN NEW; END $fn$`
      );
      const { rows: ns } = await temp.query(
        `SELECT n.nspname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE c.relname = 'red_proof_temp'`
      );
      const tempSchema = ns[0]?.nspname ?? '(none)';
      process.stdout.write(`        temporary namespace in the holder session: ${tempSchema}\n`);

      const other = new pg.Client(connectionConfig());
      await other.connect();
      const { rows: visible } = await other.query(
        'SELECT to_regclass($1) IS NOT NULL AS resolvable',
        [`${tempSchema}.red_proof_temp`]
      );
      await other.end();

      const run = runVerifier(SUBJECT);
      expect('verdict stays PASS', run.verdict === 'PASS', `got ${run.verdict}`);
      expect(
        'no persistent-primitive blocker was raised',
        run.blockers.length === 0,
        JSON.stringify(run.blockers)
      );
      expect(
        'a second session cannot resolve the temporary object by name',
        visible[0].resolvable === false,
        'the temp namespace was resolvable from another backend, which would break the argument'
      );

      await temp.end();
      const { rows: after } = await client.query(
        'SELECT to_regclass($1) IS NOT NULL AS resolvable',
        [`${tempSchema}.red_proof_temp`]
      );
      expect(
        'and the namespace is empty once the holder disconnects',
        after[0].resolvable === false,
        'the temporary object outlived its session'
      );
    }

    // RED-4 — TRIGGER and nothing else: the branch that must NOT fail, and whose
    // warning must not be decorative. Both directions asserted.
    process.stdout.write('\nRED-4  TRIGGER alone is a warning, and the warning tracks the grant\n');
    {
      const withGrant = runVerifier(SUBJECT);
      expect('verdict is PASS', withGrant.verdict === 'PASS', `got ${withGrant.verdict}`);
      expect('exit code is 0', withGrant.exitCode === 0, `got ${withGrant.exitCode}`);
      expect(
        'the defence-in-depth warning is present',
        withGrant.warnings.some((w) => w.startsWith('CONTEXT TRANSITION PRESENT')),
        JSON.stringify(withGrant.warnings)
      );
      expect(
        'and it is NOT phrased as an escalation path',
        !withGrant.warnings.some((w) => w.includes('PRACTICAL ESCALATION PATH')),
        'the two states must stay distinguishable in the text a reader sees'
      );
    }

    if (superuser === null) {
      expect(
        'the warning disappears when the grant does',
        false,
        'NOT PROVEN — PGNET_RED_PROOF_OWNER_USER was not supplied, and a REVOKE issued by a ' +
          'non-owner is a no-op that would look identical to a passing proof'
      );
    } else {
      try {
        await superuser.query('REVOKE TRIGGER ON net.http_request_queue FROM PUBLIC');
        await superuser.query('REVOKE TRIGGER ON net._http_response FROM PUBLIC');
        const { rows: acl } = await superuser.query(
          `SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'net' AND c.relname IN ('http_request_queue', '_http_response')
              AND array_to_string(COALESCE(c.relacl, acldefault('r', c.relowner)), ',') ~ '(^|,)=[^/]*t'`
        );
        expect(
          'the REVOKE actually took effect (a non-owner REVOKE is a silent no-op)',
          Number(acl[0].n) === 0,
          `${acl[0].n} of 2 relations still grant TRIGGER to PUBLIC`
        );

        const withoutGrant = runVerifier(SUBJECT);
        expect(
          'still PASS with the grant removed',
          withoutGrant.verdict === 'PASS',
          `got ${withoutGrant.verdict}`
        );
        expect(
          'and the warning is GONE — it tracked the grant, it was not hard-coded',
          !withoutGrant.warnings.some((w) => w.startsWith('CONTEXT TRANSITION PRESENT')),
          JSON.stringify(withoutGrant.warnings)
        );
      } finally {
        await superuser.query('GRANT TRIGGER ON net.http_request_queue TO PUBLIC').catch(() => {});
        await superuser.query('GRANT TRIGGER ON net._http_response TO PUBLIC').catch(() => {});
      }
    }
  } finally {
    // Restoration, unconditionally. A red proof that leaves a grant behind has
    // turned a test into a vulnerability.
    await client.query(`DROP SCHEMA IF EXISTS ${TEST_SCHEMA} CASCADE`).catch(() => {});
    await client.query(`DROP ROLE IF EXISTS ${TEST_GROUP}`).catch(() => {});
    await client.query(`DROP ROLE IF EXISTS ${SUBJECT}`).catch(() => {});
    await client.end();
    if (superuser !== null) await superuser.end();
  }

  process.stdout.write('\nRESTORATION\n');
  const witnessAfter = runVerifier(REAL_ROLE);
  expect(
    `${REAL_ROLE} is untouched: same verdict`,
    witnessAfter.verdict === witnessBefore.verdict,
    `was ${witnessBefore.verdict}, now ${witnessAfter.verdict}`
  );
  expect(
    `${REAL_ROLE} is untouched: same warning set`,
    JSON.stringify(witnessAfter.warnings) === JSON.stringify(witnessBefore.warnings),
    'the warning set moved, so something the proofs mutated was not put back'
  );

  if (failures.length > 0) {
    process.stdout.write(`\nRED PROOFS: ${failures.length} FAILED\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(
      '\nRED PROOFS: every branch fired as specified, and the baseline was restored.\n'
    );
  }
}

main().catch((error) => {
  process.stderr.write(`red proofs could not complete: ${error.message}\n`);
  process.exitCode = 1;
});
