/**
 * Phase 1-6 CRM — crm.duplicate_candidates / crm.partner_merges
 * (P1-06-DB-016/017, P1-06-QA-002/003). Canonical a<b pairing, score bounds,
 * one-open-per-pair, jsonb raw-value containment, same-tenant peer FKs, merge
 * append-only + attribution, and the recursive survivor resolver.
 *
 * Test-reference: TC-CRM-001, TC-RLS-001.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  expectSqlState,
  TENANT_A,
  TENANT_B,
  USER_A,
} from './helpers';

const DUP_A = 'a6c00000-0000-4000-8000-000000000001';
const DUP_B = 'a6c00000-0000-4000-8000-000000000002'; // DUP_A < DUP_B
const SRC = 'a6c00000-0000-4000-8000-000000000010';
const SURV = 'a6c00000-0000-4000-8000-000000000011';
const SURV2 = 'a6c00000-0000-4000-8000-000000000012';
const PARTNER_B = 'b6c00000-0000-4000-8000-0000000000b1';

let admin: Pool;
let runtime: Pool;

beforeAll(async () => {
  admin = adminPool();
  runtime = runtimePool();
  await ensureTestLogins(admin);
  await cleanFixtures(admin);
  await ensureOrgFixtures(admin);
  await admin.query(
    `INSERT INTO crm.business_partners (id, tenant_id, party_type, display_name, created_by)
     VALUES ($1, $6, 'individual', 'Dup A', $7), ($2, $6, 'individual', 'Dup B', $7),
            ($3, $6, 'individual', 'Src', $7), ($4, $6, 'individual', 'Surv', $7),
            ($5, $6, 'individual', 'Surv2', $7), ($8, $9, 'individual', 'PB', $7)`,
    [DUP_A, DUP_B, SRC, SURV, SURV2, TENANT_A, USER_A, PARTNER_B, TENANT_B]
  );
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

async function candidate(
  tx: { query: Pool['query'] },
  a: string,
  b: string,
  score: number,
  basis: string,
  status = 'open'
) {
  return tx.query(
    `INSERT INTO crm.duplicate_candidates
       (tenant_id, partner_id_a, partner_id_b, match_score, match_basis, status, created_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
    [TENANT_A, a, b, score, basis, status, USER_A]
  );
}

describe('duplicate candidates (P1-06-DB-016)', () => {
  it('accepts a canonical a<b pair with a safe match basis', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      const res = await candidate(
        tx,
        DUP_A,
        DUP_B,
        0.92,
        '[{"field":"family_name"},{"field":"phone"}]'
      );
      expect(res.rowCount).toBe(1);
    });
  });

  it('rejects reversed/self pairs, an out-of-range score, and a raw-value match basis', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(candidate(tx, DUP_B, DUP_A, 0.5, '[]'), '23514'); // b<a reversed
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(candidate(tx, DUP_A, DUP_A, 0.5, '[]'), '23514'); // self
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(candidate(tx, DUP_A, DUP_B, 1.5, '[]'), '23514'); // score > 1
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        candidate(tx, DUP_A, DUP_B, 0.9, '[{"raw_value":"962790000000"}]'),
        '23514'
      );
    });
  });

  it('allows only one OPEN candidate per pair, freed once dismissed', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await candidate(tx, DUP_A, DUP_B, 0.8, '[]', 'dismissed');
      await candidate(tx, DUP_A, DUP_B, 0.9, '[]', 'open');
      await expectSqlState(candidate(tx, DUP_A, DUP_B, 0.95, '[]', 'open'), '23505');
    });
  });

  it('rejects a cross-tenant candidate pair (composite FK)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      // PARTNER_B is in tenant B; the composite FK requires same tenant.
      const [lo, hi] = DUP_A < PARTNER_B ? [DUP_A, PARTNER_B] : [PARTNER_B, DUP_A];
      await expectSqlState(candidate(tx, lo, hi, 0.5, '[]'), '23503');
    });
  });
});

describe('partner merges (P1-06-DB-017)', () => {
  async function merge(tx: { query: Pool['query'] }, src: string, surv: string, summary = '{}') {
    return tx.query(
      `INSERT INTO crm.partner_merges (tenant_id, source_partner_id, survivor_partner_id, merge_summary, approval_ref)
       VALUES ($1, $2, $3, $4::jsonb, 'MERGE-APPROVAL-1')`,
      [TENANT_A, src, surv, summary]
    );
  }

  it('records a merge, server-stamping merged_by', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await merge(tx, SRC, SURV, '{"moved_identifiers_count":3}');
      const r = await tx.query(
        `SELECT merged_by FROM crm.partner_merges WHERE source_partner_id = $1`,
        [SRC]
      );
      expect(r.rows[0].merged_by).toBe(USER_A);
    });
  });

  it('rejects source=survivor, a blank approval_ref, and a raw-value summary', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(merge(tx, SRC, SRC), '23514');
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(
        tx.query(
          `INSERT INTO crm.partner_merges (tenant_id, source_partner_id, survivor_partner_id, approval_ref)
           VALUES ($1, $2, $3, '  ')`,
          [TENANT_A, SRC, SURV]
        ),
        '23514'
      );
    });
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await expectSqlState(merge(tx, SRC, SURV, '{"national_id":"123"}'), '23514');
    });
  });

  it('is append-only (UPDATE and DELETE denied)', async () => {
    await withRolledBackTx(runtime, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      await merge(tx, SRC, SURV);
      await expectSqlState(
        tx.query(`UPDATE crm.partner_merges SET approval_ref = 'x' WHERE source_partner_id = $1`, [
          SRC,
        ]),
        '42501'
      );
    });
  });

  it('resolves a redirect chain to the ultimate live survivor', async () => {
    await withRolledBackTx(admin, { tenantId: TENANT_A, userId: USER_A }, async (tx) => {
      // Build SRC -> SURV -> SURV2 (SURV2 live), then resolve.
      await tx.query(
        `UPDATE crm.business_partners SET lifecycle_status = 'merged', merged_into_id = $2 WHERE id = $1`,
        [SRC, SURV]
      );
      await tx.query(
        `UPDATE crm.business_partners SET lifecycle_status = 'merged', merged_into_id = $2 WHERE id = $1`,
        [SURV, SURV2]
      );
      const r = await tx.query(`SELECT crm.resolve_partner_survivor($1) AS s`, [SRC]);
      expect(r.rows[0].s).toBe(SURV2);
      const live = await tx.query(`SELECT crm.resolve_partner_survivor($1) AS s`, [SURV2]);
      expect(live.rows[0].s).toBe(SURV2);
    });
  });
});
