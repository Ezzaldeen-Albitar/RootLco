#!/usr/bin/env node
// ============================================================================
// P1-12 Wave 6 — Performance baseline on a GENERATED, NON-PERSONAL validation dataset.
//
// Generates a scaled, ephemeral, non-personal dataset (bulk partners + vehicles across two
// tenants), ANALYZEs, then measures the tenant-leading indexed lookup query families:
// median / p95 / p99 over N iterations plus the actual plan (index-scan vs seq-scan) from
// EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON). Records ACTUAL volumes — these are PROPOSED
// validation baselines, NOT production-capacity claims (P1-OD-027 / NFR-SCL unresolved).
// The generated rows are deleted at the end (ephemeral; never committed).
//
// Usage: node scripts/db/perf-baseline.mjs [--scale 20000] [--json out.json]
// ============================================================================
import { writeFileSync } from 'node:fs';
import pg from 'pg';

const cfg = {
  host: process.env.PGHOST ?? '127.0.0.1',
  port: Number(process.env.PGPORT ?? 54322),
  user: process.env.PGUSER ?? 'postgres',
  password: process.env.PGPASSWORD ?? 'postgres',
  database: process.env.PGDATABASE ?? 'postgres',
};
const TENANT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SYS = '00000000-0000-4000-8000-000000000001';
const scaleFlag = process.argv.indexOf('--scale');
const SCALE = scaleFlag !== -1 ? Number(process.argv[scaleFlag + 1]) : 20000;
const ITER = 25;

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const med = (arr) => pct(arr, 50);

async function timeQuery(c, sql, params) {
  const times = [];
  for (let i = 0; i < ITER; i++) {
    const t0 = process.hrtime.bigint();
    await c.query(sql, params);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return {
    median_ms: +med(times).toFixed(3),
    p95_ms: +pct(times, 95).toFixed(3),
    p99_ms: +pct(times, 99).toFixed(3),
  };
}

async function planOf(c, sql, params) {
  const { rows } = await c.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  const plan = rows[0]['QUERY PLAN'][0].Plan;
  const nodes = [];
  const walk = (p) => {
    nodes.push(p['Node Type'] + (p['Index Name'] ? `(${p['Index Name']})` : ''));
    (p.Plans || []).forEach(walk);
  };
  walk(plan);
  return {
    top_node: plan['Node Type'],
    index_used: nodes.some((n) => n.startsWith('Index')),
    uses_seq_scan: nodes.some((n) => n === 'Seq Scan'),
    nodes,
  };
}

async function main() {
  const c = new pg.Client(cfg);
  await c.connect();

  // Ensure the two validation tenants exist (reference data is seeded on reset).
  await c.query(
    `INSERT INTO org.tenants (id, tenant_code, display_name, status, default_locale, default_timezone, created_by)
     VALUES ($1,'perf_tenant_a','Perf Tenant A','active','en','UTC',$3),
            ($2,'perf_tenant_b','Perf Tenant B','active','en','UTC',$3)
     ON CONFLICT (id) DO NOTHING`,
    [TENANT_A, TENANT_B, SYS]
  );

  // Generate ephemeral non-personal rows: SCALE partners + vehicles for tenant A, half for B.
  console.log(
    `generating ${SCALE} partners + ${SCALE} vehicles (tenant A), ${Math.floor(SCALE / 2)} each (tenant B) ...`
  );
  const gen = async (tenant, count, offset) => {
    await c.query(
      `INSERT INTO crm.business_partners (tenant_id, party_type, display_name, created_by)
       SELECT $1, 'individual', 'perfgen_partner_'||g, $3 FROM generate_series($4::int, $4::int+$2::int-1) g`,
      [tenant, count, SYS, offset]
    );
    await c.query(
      `INSERT INTO veh.vehicles (tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
       SELECT $1, upper('PG'||lpad(g::text, 15, '0')), 'ice', 'active', $3 FROM generate_series($4::int, $4::int+$2::int-1) g`,
      [tenant, count, SYS, offset]
    );
  };
  await gen(TENANT_A, SCALE, 1);
  await gen(TENANT_B, Math.floor(SCALE / 2), SCALE + 1);
  await c.query(`ANALYZE crm.business_partners`);
  await c.query(`ANALYZE veh.vehicles`);

  const volumes = {
    partners: Number(
      (await c.query(`SELECT count(*)::int c FROM crm.business_partners`)).rows[0].c
    ),
    vehicles: Number((await c.query(`SELECT count(*)::int c FROM veh.vehicles`)).rows[0].c),
  };
  // Sample ids for point lookups (which must use the tenant-leading unique index).
  const pid = (
    await c.query(
      `SELECT id FROM crm.business_partners WHERE tenant_id=$1 ORDER BY id OFFSET 10000 LIMIT 1`,
      [TENANT_A]
    )
  ).rows[0].id;
  const vid = (
    await c.query(
      `SELECT id FROM veh.vehicles WHERE tenant_id=$1 ORDER BY id OFFSET 10000 LIMIT 1`,
      [TENANT_A]
    )
  ).rows[0].id;

  // Query families that target the ACTUAL tenant-leading indexes on the generated tables.
  const families = [
    {
      id: 'partner_point_lookup_tenant_id',
      sql: `SELECT display_name FROM crm.business_partners WHERE tenant_id=$1 AND id=$2`,
      params: [TENANT_A, pid],
    },
    {
      id: 'vehicle_point_lookup_tenant_id',
      sql: `SELECT vin_raw FROM veh.vehicles WHERE tenant_id=$1 AND id=$2`,
      params: [TENANT_A, vid],
    },
    {
      id: 'partner_scan_by_tenant_isolation',
      sql: `SELECT count(*) FROM crm.business_partners WHERE tenant_id=$1`,
      params: [TENANT_A],
    },
    {
      id: 'partner_outstanding_balance_fn',
      sql: `SELECT sal.partner_outstanding_balance($1::uuid)`,
      params: [pid],
      ctx: true,
    },
  ];

  const results = [];
  for (const f of families) {
    if (f.ctx) await c.query(`SELECT set_config('app.tenant_id',$1,false)`, [TENANT_A]);
    let plan = null,
      timing = null,
      note = null;
    try {
      plan = await planOf(c, f.sql, f.params);
      timing = await timeQuery(c, f.sql, f.params);
    } catch (e) {
      note = e.message;
    }
    if (f.ctx) await c.query(`SELECT set_config('app.tenant_id','',false)`);
    results.push({ family: f.id, ...timing, ...(plan || {}), note });
    console.log(
      `${f.id.padEnd(34)} median=${timing?.median_ms ?? '?'}ms p95=${timing?.p95_ms ?? '?'}ms p99=${timing?.p99_ms ?? '?'}ms index_used=${plan?.index_used ?? '?'} seq_scan=${plan?.uses_seq_scan ?? '?'}`
    );
  }

  // Clean up the ephemeral generated rows + the two validation tenants.
  await c.query(`DELETE FROM veh.vehicles WHERE vin_raw LIKE 'PG%' AND created_by=$1`, [SYS]);
  await c.query(`DELETE FROM crm.business_partners WHERE display_name LIKE 'perfgen_partner_%'`);
  await c.query(`DELETE FROM org.tenants WHERE id = ANY($1)`, [[TENANT_A, TENANT_B]]);
  await c.end();

  const report = {
    disclaimer:
      'PROPOSED validation baseline on a generated non-personal dataset — NOT a production-capacity claim (P1-OD-027 / NFR-SCL unresolved).',
    iterations: ITER,
    dataset_volumes: volumes,
    results,
  };
  console.log('\nvolumes:', JSON.stringify(volumes));
  const jsonFlag = process.argv.indexOf('--json');
  if (jsonFlag !== -1) {
    writeFileSync(process.argv[jsonFlag + 1], JSON.stringify(report, null, 2));
    console.log('wrote', process.argv[jsonFlag + 1]);
  }
}

main().catch((e) => {
  console.error('perf-baseline failed:', e.message);
  process.exit(1);
});
