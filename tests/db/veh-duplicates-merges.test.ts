/**
 * Phase 1-7 Duplicate candidates (P1-07-DB-017) and Vehicle merges (P1-07-DB-018).
 *
 * Duplicate candidates prove canonical ordering, score bounds, one-open-per-pair,
 * cross-tenant rejection, and the positive-schema match_basis (approved keys/
 * categories, no raw values, no nested/case-variant sensitive keys, no downgrade).
 * Merges prove the atomic source->merged primitive, survivor validity/lock,
 * self/cycle/double/deleted-survivor rejection, survivor resolution, post-merge
 * VIN reuse, append-only records, safe summaries, and the same-source race.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  readonlyPool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  setContext,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
} from './helpers';

const V1 = 'f0000000-0000-4000-8000-0000000f7001';
const V2 = 'f0000000-0000-4000-8000-0000000f7002';
const V3 = 'f0000000-0000-4000-8000-0000000f7003';
const V4 = 'f0000000-0000-4000-8000-0000000f7004';
const RC_SRC = 'f0000000-0000-4000-8000-0000000f7005';
const RC_S2 = 'f0000000-0000-4000-8000-0000000f7006';
const RC_S3 = 'f0000000-0000-4000-8000-0000000f7007';
const VB = 'f0000000-0000-4000-8000-0000000f700b';
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const ctxB = { tenantId: TENANT_B, userId: USER_B };

let admin: Pool;
let runtime: Pool;
let readonly: Pool;

beforeAll(async () => {
  admin = adminPool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  runtime = runtimePool();
  readonly = readonlyPool();
  await admin.query(
    `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by) VALUES
       ($1,$9,'DUPVIN0001','ice','active',$11),
       ($2,$9,'DUPVIN0002','ice','active',$11),
       ($3,$9,'DUPVIN0003','ice','active',$11),
       ($4,$9,'DUPVIN0004','ice','active',$11),
       ($5,$9,'DUPVINRC01','ice','active',$11),
       ($6,$9,'DUPVINRC02','ice','active',$11),
       ($7,$9,'DUPVINRC03','ice','active',$11),
       ($8,$10,'DUPVINB001','ice','active',$12)`,
    [V1, V2, V3, V4, RC_SRC, RC_S2, RC_S3, VB, TENANT_A, TENANT_B, USER_A, USER_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
  await readonly.end();
});

const insDup = (
  a: string,
  b: string,
  score: number,
  basis: string,
  opts: { status?: string; tenant?: string } = {}
) =>
  `INSERT INTO veh.duplicate_candidates (tenant_id, vehicle_id_a, vehicle_id_b, match_score, match_basis, status, created_by)
   VALUES ('${opts.tenant ?? TENANT_A}','${a}','${b}',${score},'${basis}'::jsonb,'${opts.status ?? 'open'}','${USER_A}')
   RETURNING id`;

describe('veh.duplicate_candidates — pair + score', () => {
  it('accepts a canonical pair with a valid basis', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const r = await c.query(
        insDup(
          V1,
          V2,
          0.9,
          '[{"basis":"vin_collision","classification":"restricted","weight":0.9}]'
        )
      );
      expect(r.rows).toHaveLength(1);
    });
  });

  it('rejects a reversed pair and a self-pair', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insDup(V2, V1, 0.5, '[{"basis":"other"}]')), '23514');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(insDup(V1, V1, 0.5, '[{"basis":"other"}]')), '23514');
    });
  });

  it('rejects out-of-range scores', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(c.query(insDup(V1, V2, 1.5, '[{"basis":"other"}]')), '23514');
    });
  });

  it('rejects a cross-tenant pair', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await expectSqlState(c.query(insDup(V1, VB, 0.5, '[{"basis":"other"}]')), '23503');
    });
  });
});

describe('veh.duplicate_candidates — positive-schema match_basis', () => {
  const bad: Array<[string, string]> = [
    ['empty array', '[]'],
    ['unknown key', '[{"basis":"vin_collision","foo":1}]'],
    ['unknown basis category', '[{"basis":"license_scan"}]'],
    ['nested sensitive key', '[{"basis":"other","evidence":{"vin":"1HGCM"}}]'],
    ['case-variant nested key', '[{"basis":"other","evidence":{"VIN":"1HGCM"}}]'],
    ['case-variant top key', '[{"Basis":"vin_collision"}]'],
    ['classification downgrade', '[{"basis":"vin_collision","classification":"public"}]'],
    ['non-object element', '["vin_collision"]'],
    ['non-numeric weight', '[{"basis":"other","weight":"high"}]'],
  ];
  for (const [name, basis] of bad) {
    it(`rejects ${name}`, async () => {
      await withRolledBackTx(runtime, ctxA, async (c) => {
        await expectSqlState(c.query(insDup(V1, V2, 0.5, basis)), '23514');
      });
    });
  }

  it('accepts a rich but safe basis (categories, counts, hashes)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const basis =
        '[{"basis":"identifier_collision","classification":"restricted","evidence":{"match_type":"exact","count":2}},' +
        '{"basis":"make_model_year_similarity","classification":"internal","weight":0.4}]';
      expect((await c.query(insDup(V1, V2, 0.7, basis))).rows).toHaveLength(1);
    });
  });
});

describe('veh.duplicate_candidates — lifecycle + isolation', () => {
  it('allows one open per pair, reopened after dismissal', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const id = (await c.query(insDup(V1, V2, 0.9, '[{"basis":"other"}]'))).rows[0].id;
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insDup(V1, V2, 0.8, '[{"basis":"other"}]')), '23505');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await c.query(`UPDATE veh.duplicate_candidates SET status='dismissed' WHERE id=$1`, [id]);
      expect((await c.query(insDup(V1, V2, 0.8, '[{"basis":"other"}]'))).rows).toHaveLength(1);
    });
  });

  it('isolates tenants and blocks app_readonly writes', async () => {
    await withRolledBackTx(runtime, ctxB, async (c) => {
      expect(
        (await c.query(`SELECT count(*)::int AS n FROM veh.duplicate_candidates`)).rows[0].n
      ).toBe(0);
    });
    await withRolledBackTx(readonly, ctxA, async (c) => {
      await expectSqlState(c.query(insDup(V1, V2, 0.5, '[{"basis":"other"}]')), '42501');
    });
  });
});

const insMerge = (
  src: string,
  surv: string,
  opts: { summary?: string; tenant?: string; approval?: string } = {}
) =>
  `INSERT INTO veh.vehicle_merges (tenant_id, source_vehicle_id, survivor_vehicle_id, approval_ref, merge_summary)
   VALUES ('${opts.tenant ?? TENANT_A}','${src}','${surv}','${opts.approval ?? 'APPROVAL-1'}','${
     opts.summary ?? '{}'
   }'::jsonb)
   RETURNING id`;

const lifecycleOf = (c: { query: Pool['query'] }, id: string) =>
  c
    .query(`SELECT lifecycle_status, merged_into_id FROM veh.vehicles WHERE id=$1`, [id])
    .then((r) => r.rows[0]);

describe('veh.vehicle_merges — atomic primitive', () => {
  it('transitions the source to merged and redirects it', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insMerge(V1, V2));
      const src = await lifecycleOf(c, V1);
      expect(src.lifecycle_status).toBe('merged');
      expect(src.merged_into_id).toBe(V2);
      // survivor resolves through the redirect
      const surv = (await c.query(`SELECT veh.resolve_vehicle_survivor($1) AS s`, [V1])).rows[0].s;
      expect(surv).toBe(V2);
    });
  });

  it('rejects self, cross-tenant, and deleted/merged survivors', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insMerge(V1, V1)), '23514'); // self
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expectSqlState(c.query(insMerge(V1, VB)), '23503'); // cross-tenant
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await c.query(`UPDATE veh.vehicles SET deleted_at=now(), deleted_by=$1 WHERE id=$2`, [
        USER_A,
        V3,
      ]);
      await expectSqlState(c.query(insMerge(V1, V3)), '23514'); // deleted survivor
    });
  });

  it('rejects a cycle (survivor already merged)', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insMerge(V1, V2)); // V1 -> V2
      await expectSqlState(c.query(insMerge(V2, V1)), '23514'); // V2 -> merged V1
    });
  });

  it('rejects a double merge of the same source', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insMerge(V1, V2));
      await expectSqlState(c.query(insMerge(V1, V3)), '23505', '23514');
    });
  });

  it('resolves a multi-hop survivor chain', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insMerge(V1, V2)); // V1 -> V2
      await c.query(insMerge(V2, V3)); // V2 -> V3
      const surv = (await c.query(`SELECT veh.resolve_vehicle_survivor($1) AS s`, [V1])).rows[0].s;
      expect(surv).toBe(V3);
    });
  });

  it('frees the merged source VIN for a new active Vehicle', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(insMerge(V1, V2)); // V1 (DUPVIN0001) now merged/excluded
      const NEW = 'f0000000-0000-4000-8000-0000000f7099';
      const r = await c.query(
        `INSERT INTO veh.vehicles (id, tenant_id, vin_raw, powertrain_category, lifecycle_status, created_by)
         VALUES ($1,$2,'DUPVIN0001','ice','active',$3) RETURNING id`,
        [NEW, TENANT_A, USER_A]
      );
      expect(r.rows).toHaveLength(1);
    });
  });

  it('rejects an unsafe merge summary and denies mutation of the record', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query('SAVEPOINT s1');
      await expectSqlState(
        c.query(insMerge(V1, V2, { summary: '{"vin":"1HGCM82633A004352"}' })),
        '23514'
      );
      await c.query('ROLLBACK TO SAVEPOINT s1');
      const id = (await c.query(insMerge(V1, V2))).rows[0].id;
      await c.query('SAVEPOINT s2');
      await expectSqlState(
        c.query(`UPDATE veh.vehicle_merges SET approval_ref='x' WHERE id=$1`, [id]),
        '42501'
      );
      await c.query('ROLLBACK TO SAVEPOINT s2');
      await expectSqlState(c.query(`DELETE FROM veh.vehicle_merges WHERE id=$1`, [id]), '42501');
    });
  });

  it('leaves no partial state when the merge is rejected', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      await c.query(`UPDATE veh.vehicles SET deleted_at=now(), deleted_by=$1 WHERE id=$2`, [
        USER_A,
        V4,
      ]);
      await c.query('SAVEPOINT s1');
      await expectSqlState(c.query(insMerge(V1, V4)), '23514');
      await c.query('ROLLBACK TO SAVEPOINT s1');
      expect((await lifecycleOf(c, V1)).lifecycle_status).toBe('active'); // unchanged
    });
  });
});

describe('veh.vehicle_merges — concurrency (same source)', () => {
  it('lets only one same-source merge win', async () => {
    const c1 = await runtime.connect();
    const c2 = await runtime.connect();
    try {
      await c1.query('BEGIN');
      await setContext(c1, ctxA);
      await c2.query('BEGIN');
      await setContext(c2, ctxA);
      await c1.query(insMerge(RC_SRC, RC_S2)); // inserts + locks source key/row
      const p2 = c2.query(insMerge(RC_SRC, RC_S3)); // blocks on the unique source key
      await c1.query('COMMIT');
      await expectSqlState(p2, '23505', '40001', '40P01');
      await c2.query('ROLLBACK');
      // exactly one committed merge record for the source
      const n = (
        await admin.query(
          `SELECT count(*)::int AS n FROM veh.vehicle_merges WHERE source_vehicle_id=$1`,
          [RC_SRC]
        )
      ).rows[0].n;
      expect(n).toBe(1);
    } finally {
      c1.release();
      c2.release();
      await admin.query(`DELETE FROM veh.vehicle_merges WHERE source_vehicle_id=$1`, [RC_SRC]);
    }
  });
});
