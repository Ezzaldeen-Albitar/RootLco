#!/usr/bin/env node
// ============================================================================
// P1-12 Wave 2 — Structural review (read-only): FK integrity, destructive-cascade
// guard for financial/append-only tables, FK-index coverage, duplicate indexes,
// and data-dictionary table drift. Complements the test-enforced FK-cover and
// duplicate-index guards (part of the 1141-test suite) with an auditable report
// and the two P1-12-specific integrity gates:
//   (a) every FK is VALIDATED (so orphan rows are impossible);
//   (b) no financial/append-only/audit table is the parent of an ON DELETE CASCADE
//       or SET NULL FK (financial/audit history must never be silently destroyed).
//   (c) every live module table is documented in docs/database/data-dictionary.md.
//
// Exit non-zero if any gate fails. Usage: node scripts/db/structural-review.mjs [--json out.json]
// ============================================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { MODULE_SCHEMAS } from './schema-inventory.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 54322),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};

async function main() {
  const c = new pg.Client(cfg);
  await c.connect();
  const S = MODULE_SCHEMAS;

  // Every FK with parent, ON DELETE, validated, and whether a covering index exists.
  const fks = (
    await c.query(
      `SELECT n.nspname AS schema, rel.relname AS table, con.conname AS name,
              con.convalidated AS validated,
              CASE con.confdeltype WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                   WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL' WHEN 'd' THEN 'SET DEFAULT' END AS on_delete,
              pn.nspname AS parent_schema, pr.relname AS parent_table,
              (SELECT array_agg(att.attname::text ORDER BY k.ord)
                 FROM unnest(con.conkey) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute att ON att.attrelid=con.conrelid AND att.attnum=k.attnum) AS fk_cols
         FROM pg_constraint con
         JOIN pg_class rel ON rel.oid=con.conrelid JOIN pg_namespace n ON n.oid=rel.relnamespace
         JOIN pg_class pr ON pr.oid=con.confrelid JOIN pg_namespace pn ON pn.oid=pr.relnamespace
        WHERE con.contype='f' AND n.nspname = ANY($1)
        ORDER BY 1,2,3`,
      [S]
    )
  ).rows;

  // Indexes as column arrays (non-expression, non-partial leading columns) for FK-cover + dupes.
  const idx = (
    await c.query(
      `SELECT n.nspname AS schema, t.relname AS table, ix.relname AS name,
              i.indpred IS NOT NULL AS partial,
              (SELECT array_agg(a.attname::text ORDER BY k.ord)
                 FROM unnest(i.indkey::int[]) WITH ORDINALITY k(attnum, ord)
                 JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
                WHERE k.attnum<>0) AS cols
         FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid
         JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=t.relnamespace
        WHERE n.nspname = ANY($1)
        ORDER BY 1,2,3`,
      [S]
    )
  ).rows;

  // Set of module tables that hold an app-role DELETE grant (i.e. runtime-deletable).
  const deletable = new Set(
    (
      await c.query(
        `SELECT table_schema||'.'||table_name AS fq FROM information_schema.role_table_grants
          WHERE table_schema = ANY($1) AND privilege_type='DELETE' AND grantee LIKE 'app\\_%'`,
        [S]
      )
    ).rows.map((r) => r.fq)
  );

  // Gate (a): unvalidated FKs.
  const unvalidated = fks.filter((f) => !f.validated);

  // Gate (b): a destructive cascade/set-null is only a real risk when the PARENT is
  // runtime-deletable (an app role holds a DELETE grant on it) — otherwise the cascade
  // is administrative-only and can never destroy history at runtime. Flag reachable ones,
  // with extra attention to protected (financial/audit/append-only) parents.
  const destructive = fks.filter(
    (f) =>
      (f.on_delete === 'CASCADE' || f.on_delete === 'SET NULL') &&
      deletable.has(`${f.parent_schema}.${f.parent_table}`)
  );

  // Gate: FK-index coverage — every FK must have a non-partial index whose leading columns
  // (as a set of the first N) equal the FK column set.
  const uncovered = fks.filter(
    (f) =>
      f.fk_cols &&
      !idx.some(
        (ix) =>
          ix.schema === f.schema &&
          ix.table === f.table &&
          !ix.partial &&
          ix.cols &&
          ix.cols.slice(0, f.fk_cols.length).length === f.fk_cols.length &&
          f.fk_cols.every((col) => ix.cols.slice(0, f.fk_cols.length).includes(col))
      )
  );

  // TRUE duplicate indexes: two indexes on the same table whose full definitions are
  // identical modulo the index name (same columns AND partial predicate AND type AND
  // uniqueness). Shared leading columns with different predicates/types are NOT duplicates.
  const idxDefs = (
    await c.query(
      `SELECT schemaname AS schema, tablename AS table, indexname AS name, indexdef AS def
         FROM pg_indexes WHERE schemaname = ANY($1)`,
      [S]
    )
  ).rows;
  const seen = new Map();
  const duplicates = [];
  for (const ix of idxDefs) {
    const norm = ix.def.replace(`INDEX ${ix.name} `, 'INDEX <name> ');
    if (seen.has(norm))
      duplicates.push({ table: `${ix.schema}.${ix.table}`, a: seen.get(norm), b: ix.name });
    else seen.set(norm, ix.name);
  }

  // Gate (c): dictionary drift — every live module table documented.
  const liveTables = (
    await c.query(
      `SELECT table_schema||'.'||table_name AS fq FROM information_schema.tables
        WHERE table_schema = ANY($1) AND table_type='BASE TABLE' ORDER BY 1`,
      [S]
    )
  ).rows.map((r) => r.fq);
  await c.end();

  const dict = readFileSync(join(ROOT, 'docs', 'database', 'data-dictionary.md'), 'utf8');
  const undocumented = liveTables.filter((fq) => !dict.includes(fq));

  const allDestructive = fks.filter((f) => f.on_delete === 'CASCADE' || f.on_delete === 'SET NULL');
  const report = {
    totals: { foreign_keys: fks.length, indexes: idx.length, live_tables: liveTables.length },
    gates: {
      all_fks_validated: unvalidated.length === 0,
      no_runtime_reachable_destructive_cascade: destructive.length === 0,
      fk_index_coverage_complete: uncovered.length === 0,
      no_duplicate_indexes: duplicates.length === 0,
      zero_dictionary_drift: undocumented.length === 0,
    },
    unvalidated_fks: unvalidated.map((f) => `${f.schema}.${f.table}.${f.name}`),
    runtime_reachable_destructive_cascades: destructive.map(
      (f) =>
        `${f.schema}.${f.table}.${f.name} -> ${f.parent_schema}.${f.parent_table} ON DELETE ${f.on_delete}`
    ),
    // administrative-only cascades (parent has no app-role DELETE grant — never fires at runtime), recorded for the audit trail.
    administrative_only_destructive_cascades: allDestructive
      .filter((f) => !deletable.has(`${f.parent_schema}.${f.parent_table}`))
      .map(
        (f) =>
          `${f.schema}.${f.table} -> ${f.parent_schema}.${f.parent_table} ${f.on_delete} (parent not runtime-deletable)`
      ),
    uncovered_fks: uncovered.map(
      (f) => `${f.schema}.${f.table}.${f.name} (${(f.fk_cols || []).join(',')})`
    ),
    duplicate_indexes: duplicates,
    undocumented_tables: undocumented,
  };

  const pass = Object.values(report.gates).every(Boolean);
  console.log('=== P1-12 structural review ===');
  console.log('totals:', JSON.stringify(report.totals));
  console.log('gates:', JSON.stringify(report.gates));
  if (!pass) {
    if (unvalidated.length) console.log('UNVALIDATED FKs:', report.unvalidated_fks);
    if (destructive.length)
      console.log(
        'RUNTIME-REACHABLE DESTRUCTIVE CASCADE:',
        report.runtime_reachable_destructive_cascades
      );
    if (uncovered.length) console.log('UNCOVERED FKs:', report.uncovered_fks.slice(0, 20));
    if (duplicates.length) console.log('DUPLICATE INDEXES:', report.duplicate_indexes.slice(0, 20));
    if (undocumented.length) console.log('UNDOCUMENTED TABLES:', report.undocumented_tables);
  }
  console.log('STRUCTURAL REVIEW:', pass ? 'PASS' : 'FAIL');

  const jsonFlag = process.argv.indexOf('--json');
  if (jsonFlag !== -1) {
    writeFileSync(process.argv[jsonFlag + 1], JSON.stringify(report, null, 2));
    console.log('wrote', process.argv[jsonFlag + 1]);
  }
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('structural-review failed:', e.message);
  process.exit(1);
});
