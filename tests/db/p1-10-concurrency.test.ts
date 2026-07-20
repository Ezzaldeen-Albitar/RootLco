/**
 * Phase 1-10 — Concurrency: single-winner invariants under real parallel connections.
 * Reservation last-unit race is repeated 5 isolated times.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  runtimeClient,
  setContext,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withCommittedTx,
  TENANT_A,
  USER_A,
} from './helpers';
import { seedP109Base, makeAuthorizedVisit, newWorkOrder } from './p1-09-helpers';
import {
  seedItem,
  seedLocations,
  seedStock,
  seedService,
  seedQuotation,
  draftRevision,
  addServiceItem,
  seedVehicle,
} from './p1-10-helpers';

const admin = adminPool();
const runtime = runtimePool();
const ctxA = { tenantId: TENANT_A, userId: USER_A };

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP109Base(admin);
});
afterAll(async () => {
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

/** Runs `sql` in its own transaction on a fresh connection; returns 'ok' or the SQLSTATE. */
async function race(sql: string, params: unknown[]): Promise<string> {
  const c = runtimeClient();
  await c.connect();
  try {
    await c.query('BEGIN');
    await setContext(c, ctxA);
    await c.query(sql, params);
    await c.query('COMMIT');
    return 'ok';
  } catch (e) {
    try {
      await c.query('ROLLBACK');
    } catch {
      /* ignore */
    }
    return (e as { code?: string }).code ?? 'error';
  } finally {
    await c.end();
  }
}

describe('p1-10 concurrency (single-winner)', () => {
  it('reserves the last unit exactly once (x5)', async () => {
    for (let rep = 0; rep < 5; rep++) {
      const { item, loc } = await withCommittedTx(runtime, ctxA, async (c) => {
        const i = await seedItem(c, `con${rep}`);
        const l = await seedLocations(c, `con${rep}`);
        await seedStock(c, i.item, l.warehouse, 1, `con${rep}`);
        return { item: i.item, loc: l.warehouse };
      });
      const [a, b] = await Promise.all([
        race(`SELECT inv.reserve_stock($1,$2,1)`, [item, loc]),
        race(`SELECT inv.reserve_stock($1,$2,1)`, [item, loc]),
      ]);
      const results = [a, b];
      expect(results.filter((r) => r === 'ok').length, `rep ${rep}: exactly one winner`).toBe(1);
      expect(results.filter((r) => r === '23514').length, `rep ${rep}: loser is 23514`).toBe(1);
    }
  });

  it('issues at most one revision under a concurrent double-issue', async () => {
    const { r1, r2 } = await withCommittedTx(runtime, ctxA, async (c) => {
      const veh = await seedVehicle(c, 'concq');
      const visit = await makeAuthorizedVisit(c, veh);
      const wo = await newWorkOrder(c, visit, { vehicle: veh });
      const { service } = await seedService(c, 'concq');
      const q = await seedQuotation(c, wo, 'concq');
      const a = await draftRevision(c, q, 1);
      await addServiceItem(c, a, service, 1, 100, 1);
      const b = await draftRevision(c, q, 2);
      await addServiceItem(c, b, service, 1, 120, 1);
      return { r1: a, r2: b };
    });
    // both draft revisions of the same quotation try to become 'issued' at once
    const [x, y] = await Promise.all([
      race(`SELECT quo.issue_revision($1)`, [r1]),
      race(`SELECT quo.issue_revision($1)`, [r2]),
    ]);
    const results = [x, y];
    // the parent-row lock serializes them; at most one issued survives, the other
    // either serializes cleanly (both ok, first superseded) or loses the single-issued race.
    const issued = Number(
      (
        await admin.query(
          `SELECT count(*)::int n FROM quo.quotation_revisions
           WHERE quotation_id = (SELECT quotation_id FROM quo.quotation_revisions WHERE id=$1) AND status='issued'`,
          [r1]
        )
      ).rows[0].n
    );
    expect(issued).toBe(1);
    expect(results.filter((r) => r === 'ok').length).toBeGreaterThanOrEqual(1);
  });

  it('serializes concurrent returns against the issued quantity (no return beyond issue)', async () => {
    const issue = await withCommittedTx(runtime, ctxA, async (c) => {
      const veh = await seedVehicle(c, 'conr');
      const visit = await makeAuthorizedVisit(c, veh);
      const wo = await newWorkOrder(c, visit, { vehicle: veh });
      const i = await seedItem(c, 'conr');
      const l = await seedLocations(c, 'conr');
      await seedStock(c, i.item, l.warehouse, 10, 'conr');
      const res = (await c.query(`SELECT inv.reserve_stock($1,$2,5) AS id`, [i.item, l.warehouse]))
        .rows[0].id;
      return (
        await c.query(`SELECT inv.issue_part($1,$2,$3,5,$4) AS id`, [wo, i.item, l.warehouse, res])
      ).rows[0].id;
    });
    // two concurrent returns of 3 each (total 6) against a 5-unit issue: one must fail
    const [a, b] = await Promise.all([
      race(`SELECT inv.return_part($1,3)`, [issue]),
      race(`SELECT inv.return_part($1,3)`, [issue]),
    ]);
    const results = [a, b];
    expect(
      results.filter((r) => r === '23514').length,
      'one return exceeds the issue'
    ).toBeGreaterThanOrEqual(1);
  });
});
