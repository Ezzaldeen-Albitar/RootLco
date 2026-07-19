/**
 * Phase 1-6 CRM — concurrency / single-winner semantics (P1-06-QA-007).
 *
 * Drives genuinely concurrent conflicting operations through separate runtime
 * connections and asserts exactly one winner with a deterministic database error
 * for the losers: normalized-identifier uniqueness, one open duplicate candidate
 * per pair, one active primary contact per (partner, channel), role-interval
 * overlap, and concurrent merge of the same source. (Display-number concurrency
 * is covered by crm-display-number.test.ts.)
 *
 * Test-reference: TC-CON-001.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  TENANT_A,
  USER_A,
} from './helpers';

const P1 = 'a71c0000-0000-4000-8000-000000000001';
const P2 = 'a71c0000-0000-4000-8000-000000000002';
const P3 = 'a71c0000-0000-4000-8000-000000000003';

let admin: Pool;
let runtime: Pool;

// Runs each op on its own connection+transaction concurrently; returns per-op
// outcome ('ok' on commit, else the SQLSTATE). Between runs, callers reset state.
async function race(ops: Array<(c: PoolClient) => Promise<unknown>>): Promise<string[]> {
  const pairs = await Promise.all(ops.map(async (op) => ({ op, c: await runtime.connect() })));
  try {
    return await Promise.all(
      pairs.map(async ({ op, c }) => {
        await c.query('BEGIN');
        await c.query(`SET statement_timeout = '8s'`);
        await c.query(`SET lock_timeout = '6s'`);
        await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
        await c.query(`SELECT set_config('app.user_id', $1, true)`, [USER_A]);
        try {
          await op(c);
          await c.query('COMMIT');
          return 'ok';
        } catch (e) {
          await c.query('ROLLBACK').catch(() => undefined);
          return (e as { code?: string }).code ?? 'ERR';
        }
      })
    );
  } finally {
    pairs.forEach(({ c }) => c.release());
  }
}

function expectOneWinner(outcomes: string[], loserCodes: string[]) {
  const wins = outcomes.filter((o) => o === 'ok').length;
  expect(wins, `exactly one winner; got ${JSON.stringify(outcomes)}`).toBe(1);
  for (const o of outcomes) {
    if (o !== 'ok') expect(loserCodes, `loser code ${o}`).toContain(o);
  }
}

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool(10);
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1, $4, 'individual', 'C1', $5), ($2, $4, 'individual', 'C2', $5), ($3, $4, 'individual', 'C3', $5)`,
    [P1, P2, P3, TENANT_A, USER_A]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('single-winner concurrency (P1-06-QA-007)', () => {
  it('concurrent identical normalized identifiers -> one winner, others 23505', async () => {
    const insert = (c: PoolClient) =>
      c.query(
        `INSERT INTO crm.partner_identifiers (tenant_id, partner_id, identifier_type, normalized_value, classification, created_by)
         VALUES ($1, $2, 'email', 'race@x.test', 'internal', $3)`,
        [TENANT_A, P1, USER_A]
      );
    const out = await race([insert, insert, insert]);
    expectOneWinner(out, ['23505']);
    await admin.query(`DELETE FROM crm.partner_identifiers WHERE partner_id = $1`, [P1]);
  });

  it('concurrent open duplicate candidates for the same pair -> one winner, others 23505', async () => {
    const insert = (c: PoolClient) =>
      c.query(
        `INSERT INTO crm.duplicate_candidates (tenant_id, partner_id_a, partner_id_b, match_score, created_by)
         VALUES ($1, $2, $3, 0.9, $4)`,
        [TENANT_A, P1, P2, USER_A]
      );
    const out = await race([insert, insert, insert]);
    expectOneWinner(out, ['23505']);
    await admin.query(`DELETE FROM crm.duplicate_candidates WHERE partner_id_a = $1`, [P1]);
  });

  it('concurrent primary contacts for the same partner/channel -> one winner, others 23505', async () => {
    let n = 0;
    const insert = (c: PoolClient) => {
      const v = `p${n++}@x.test`;
      return c.query(
        `INSERT INTO crm.contact_points (tenant_id, partner_id, channel, normalized_value, is_primary, created_by)
         VALUES ($1, $2, 'email', $3, true, $4)`,
        [TENANT_A, P1, v, USER_A]
      );
    };
    const out = await race([insert, insert, insert]);
    expectOneWinner(out, ['23505']);
    await admin.query(`DELETE FROM crm.contact_points WHERE partner_id = $1`, [P1]);
  });

  it('concurrent overlapping same-role intervals -> one winner, the other excluded/deadlocked', async () => {
    const insert = (c: PoolClient) =>
      c.query(
        `INSERT INTO crm.partner_roles (tenant_id, partner_id, role_type, valid_from, valid_to, created_by)
         VALUES ($1, $2, 'customer', DATE '2026-01-01', DATE '2026-12-01', $3)`,
        [TENANT_A, P1, USER_A]
      );
    const out = await race([insert, insert]);
    // Two concurrent inserts into the GiST EXCLUDE constraint resolve as a clean
    // exclusion violation (23P01) or, if they lock the index in opposite orders,
    // a detected deadlock (40P01) / lock timeout (55P03). All three uphold the
    // invariant: exactly one interval commits, never two overlapping ones.
    expectOneWinner(out, ['23P01', '40P01', '55P03']);
    await admin.query(`DELETE FROM crm.partner_roles WHERE partner_id = $1`, [P1]);
  });

  it('concurrent merge of the same source -> one winner, the other is rejected (frozen or deadlock)', async () => {
    // P3 -> P1 and P3 -> P2 concurrently: the source P3 can be merged only once.
    const mergeInto = (surv: string) => (c: PoolClient) =>
      c.query(
        `UPDATE crm.business_partners SET lifecycle_status = 'merged', merged_into_id = $2 WHERE id = $1`,
        [P3, surv]
      );
    const out = await race([mergeInto(P1), mergeInto(P2)]);
    // one commits; the loser is frozen (23514) or aborts on deadlock (40P01)/lock timeout (55P03).
    expectOneWinner(out, ['23514', '40P01', '55P03']);
    // reset P3 to live via admin (merged rows are frozen for the runtime role; admin bypasses)
    await admin.query(
      `UPDATE crm.business_partners SET lifecycle_status = 'active', merged_into_id = NULL WHERE id = $1`,
      [P3]
    ).catch(() => undefined);
  });
});
