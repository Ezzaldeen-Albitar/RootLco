/**
 * Catalogue discovery for the acceptance-fixture lifecycle.
 *
 * ## Why this exists — `P1-26-F-056`
 *
 * The reset used to carry a hand-written list of seventeen tables. That list was
 * wrong once already, in the way hand-written lists are wrong: it named
 * `iam.audit_events`, a table that does not exist, so the step was skipped and a
 * reset that reported success left the Owner's entire audit trail behind.
 *
 * The list cannot be trusted at this scale. This database has **294 base tables,
 * 232 of them tenant-scoped**, and thirty carry a foreign key to `org.tenants`.
 * A person maintaining seventeen names by hand against that is not doing
 * verification, they are sampling.
 *
 * So nothing is hand-written. The catalogue is asked which tables are
 * tenant-scoped, which of those actually hold acceptance rows, and how they
 * depend on each other — and only then is a single destructive transaction
 * built from the answer.
 *
 * ## Why discovery happens BEFORE the transaction
 *
 * The previous design ran each delete inside a `SAVEPOINT` so that a statement
 * against a missing table could be rolled back without poisoning the rest. That
 * works, but it treats "this table might not exist" as a runtime surprise to be
 * absorbed — and absorbing it is exactly how the `audit_events` mistake stayed
 * invisible.
 *
 * Here every statement is generated from a table that was just read. There is no
 * expected failure left, so the transaction needs no savepoints and any error is
 * a real one: it aborts and rolls back, which is the correct answer to a genuine
 * surprise. PostgreSQL's `25P02` — every statement after a failure rejected —
 * stops being a hazard to design around when nothing is expected to fail.
 */

/** The schemas the platform owns. Supabase's own schemas are never touched. */
export const OWNED_SCHEMAS = Object.freeze([
  'apt',
  'crm',
  'dia',
  'iam',
  'inv',
  'net',
  'org',
  'qms',
  'quo',
  'rec',
  'rpt',
  'sal',
  'shared',
  'svc',
  'tech',
  'veh',
  'wo',
  'wty',
]);

/**
 * Every base table in an owned schema that carries a `tenant_id` column.
 *
 * @param {import('pg').Client} client
 * @returns {Promise<{schema: string, table: string}[]>}
 */
export async function tenantScopedTables(client) {
  const { rows } = await client.query(
    `SELECT c.table_schema AS schema, c.table_name AS table
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.column_name = 'tenant_id'
        AND t.table_type = 'BASE TABLE'
        AND c.table_schema = ANY($1::text[])
      ORDER BY 1, 2`,
    [OWNED_SCHEMAS]
  );
  return rows;
}

/**
 * Foreign-key edges between tables, as `child -> parent`.
 *
 * Self-references are dropped: a row referencing its own table does not
 * constrain the order two different tables are emptied in.
 *
 * @param {import('pg').Client} client
 * @returns {Promise<{child: string, parent: string}[]>}
 */
export async function foreignKeyEdges(client) {
  const { rows } = await client.query(
    `SELECT ns.nspname  || '.' || cl.relname  AS child,
            fns.nspname || '.' || fcl.relname AS parent
       FROM pg_constraint con
       JOIN pg_class     cl  ON cl.oid  = con.conrelid
       JOIN pg_namespace ns  ON ns.oid  = cl.relnamespace
       JOIN pg_class     fcl ON fcl.oid = con.confrelid
       JOIN pg_namespace fns ON fns.oid = fcl.relnamespace
      WHERE con.contype = 'f'
        AND ns.nspname  = ANY($1::text[])
        AND fns.nspname = ANY($1::text[])`,
    [OWNED_SCHEMAS]
  );
  return rows.filter((r) => r.child !== r.parent);
}

/**
 * Orders tables so that every child is emptied before its parent.
 *
 * Ninety-two of this schema's foreign keys are `ON DELETE RESTRICT`, which is
 * what makes a wrong order safe: the database refuses rather than cascading. It
 * is also what makes the order mandatory, because a refusal is a failed reset.
 *
 * A cycle is reported rather than guessed at. Deleting round a cycle needs a
 * deferred constraint or a different strategy, and silently picking an order
 * would be the same class of mistake as the hand-written list.
 *
 * @param {string[]} tables fully qualified `schema.table`
 * @param {{child: string, parent: string}[]} edges
 * @returns {{ordered: string[], cycle: string[] | null}}
 */
export function childrenFirst(tables, edges) {
  const present = new Set(tables);
  /** @type {Map<string, Set<string>>} parent -> children that must go first */
  const blockedBy = new Map(tables.map((t) => [t, new Set()]));
  for (const { child, parent } of edges) {
    if (!present.has(child) || !present.has(parent)) continue;
    blockedBy.get(parent)?.add(child);
  }

  const ordered = [];
  const done = new Set();
  // Deterministic: the same input always yields the same order, so a reset is
  // reproducible and its log can be diffed between runs.
  const remaining = [...tables].sort();

  for (let guard = 0; guard <= tables.length && ordered.length < tables.length; guard += 1) {
    let progressed = false;
    for (const table of remaining) {
      if (done.has(table)) continue;
      const blockers = blockedBy.get(table) ?? new Set();
      if ([...blockers].every((b) => done.has(b))) {
        ordered.push(table);
        done.add(table);
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  if (ordered.length !== tables.length) {
    return { ordered, cycle: tables.filter((t) => !done.has(t)).sort() };
  }
  return { ordered, cycle: null };
}

/**
 * Counts acceptance rows per tenant-scoped table, keeping only the nonzero ones.
 *
 * The count is the reason the reset can be built without savepoints: a table
 * that answered a `SELECT count(*)` a moment ago exists and is readable, so the
 * `DELETE` that follows has no legitimate reason to fail.
 *
 * @param {import('pg').Client} client
 * @param {{schema: string, table: string}[]} tables
 * @param {string[]} tenantIds
 * @returns {Promise<{table: string, rows: number}[]>}
 */
export async function acceptanceRowCounts(client, tables, tenantIds) {
  const counts = [];
  for (const { schema, table } of tables) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM "${schema}"."${table}" WHERE tenant_id = ANY($1::uuid[])`,
      [tenantIds]
    );
    if (rows[0].n > 0) counts.push({ table: `${schema}.${table}`, rows: rows[0].n });
  }
  return counts;
}

/**
 * The whole picture, in one call, for both the reset and its verifier.
 *
 * They share this deliberately. A verifier that looked somewhere else than the
 * reset cleaned would not be checking the reset — it would be checking its own
 * separate opinion of where fixtures live, and the two would drift.
 *
 * `scannedTables` is returned so a caller can fail on an implausible scan. A
 * catalogue query that suddenly matches nothing reports every counter as zero,
 * which reads exactly like a clean database and is in fact a broken scan.
 *
 * @param {import('pg').Client} client
 * @param {string[]} tenantIds
 */
export async function surveyAcceptanceRows(client, tenantIds) {
  const scoped = await tenantScopedTables(client);
  const populated = await acceptanceRowCounts(client, scoped, tenantIds);
  const edges = await foreignKeyEdges(client);
  const { ordered, cycle } = childrenFirst(
    populated.map((p) => p.table),
    edges
  );
  const total = populated.reduce((sum, p) => sum + p.rows, 0);
  return { scannedTables: scoped.length, populated, ordered, cycle, total };
}

/**
 * The tables `tests/db/no-fake-data.test.ts` permits to hold rows.
 *
 * That test is the runtime enforcement of the permanent no-fake-data policy, and
 * it does not count tenant-scoped rows — it counts **every row in every base
 * table** across the seventeen platform schemas, minus this allow-list. Anything
 * else present at all is a failure.
 *
 * Which means removing the acceptance rows is necessary and not sufficient: the
 * database can be free of acceptance fixtures and still fail that test because
 * some other run left something behind. `verify-reset` therefore checks this
 * sweep too, so that "clean" means what the Database tier means by it.
 *
 * `tests/ci/acceptance-discovery.test.ts` asserts this list is identical to the
 * test's own. Two copies of a list that must agree, with nothing checking they
 * do, is how they stop agreeing.
 */
export const STRUCTURAL_REFERENCE = Object.freeze([
  'shared.currencies',
  'shared.timezones',
  'shared.languages',
  'iam.permissions',
  'shared.retention_classes',
  'wo.work_order_states',
  'wo.work_order_transitions',
  'wo.job_states',
  'wo.job_transitions',
  'inv.units_of_measure',
  'sal.payment_methods',
]);

/** The schemas that test sweeps. Wider than the tenant-scoped scan by design. */
export const BUSINESS_SCHEMAS = Object.freeze([
  'org',
  'iam',
  'shared',
  'crm',
  'veh',
  'apt',
  'rec',
  'wo',
  'dia',
  'tech',
  'qms',
  'svc',
  'quo',
  'inv',
  'sal',
  'wty',
  'rpt',
]);

/**
 * Every business table that holds any row at all — the Database tier's own
 * definition of a dirty database.
 *
 * @param {import('pg').Client} client
 * @returns {Promise<{scanned: number, nonEmpty: {table: string, rows: number}[]}>}
 */
export async function businessRowSweep(client) {
  const allow = new Set(STRUCTURAL_REFERENCE);
  const { rows: catalogue } = await client.query(
    `SELECT table_schema AS schema, table_name AS table
       FROM information_schema.tables
      WHERE table_type = 'BASE TABLE'
        AND table_schema = ANY($1::text[])
      ORDER BY 1, 2`,
    [BUSINESS_SCHEMAS]
  );
  const nonEmpty = [];
  for (const { schema, table } of catalogue) {
    const fq = `${schema}.${table}`;
    if (allow.has(fq)) continue;
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${schema}"."${table}"`);
    if (rows[0].n > 0) nonEmpty.push({ table: fq, rows: rows[0].n });
  }
  return { scanned: catalogue.length, nonEmpty };
}

/**
 * The smallest number of tenant-scoped tables this schema can plausibly have.
 *
 * If the scan returns fewer, the scan is broken and every "zero" it reports is
 * meaningless. Measured at 232 on the P1-26 schema; the floor is set well below
 * that so ordinary growth never trips it, and a catastrophic mis-scan always
 * does.
 */
export const MINIMUM_PLAUSIBLE_SCOPED_TABLES = 100;
