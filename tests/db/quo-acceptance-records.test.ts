/**
 * P1-32-PRE-OD-FD11 — quo.acceptance_records, the auditable record of an accepted
 * quotation revision (ADR-023 D11), at the database.
 *
 * What the migration promises and these cases hold it to: RLS enabled and forced
 * with exactly a SELECT and an INSERT policy; SELECT+INSERT for app_runtime and
 * nothing that changes or removes a row; the recorder and the time stamped from
 * the session whatever the statement says; a record only for the accepted current
 * revision of its quotation, at most one per revision, naming no customer but the
 * payer; the contact and reference shapes; every UPDATE refused; and a tenant that
 * cannot see, nor write into, another tenant's records.
 */
import type { Client } from 'pg';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  COMPANY_A1,
  BRANCH_A1,
  TENANT_A,
  TENANT_B,
  USER_A,
  USER_B,
} from './helpers';
import { seedP109Base, makeAuthorizedVisit, newWorkOrder } from './p1-09-helpers';
import {
  seedService,
  seedQuotation,
  draftRevision,
  addServiceItem,
  expectFail,
  OTHER_ACTOR,
} from './p1-10-helpers';

const admin = adminPool();
const runtime = runtimePool();
const ctxA = { tenantId: TENANT_A, userId: USER_A };
const PAYER = '0d110000-0000-4000-8000-0000000000a1';
const NOT_THE_PAYER = '0d110000-0000-4000-8000-0000000000a2';

type Q = { query: Client['query'] };

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

/** An issued one-line revision of a quotation naming PAYER, inside the open transaction. */
async function issuedRevision(
  c: Q,
  tag: string
): Promise<{ quotation: string; revision: string; item: string }> {
  const visit = await makeAuthorizedVisit(c);
  const wo = await newWorkOrder(c, visit);
  const { service } = await seedService(c, tag);
  const quotation = await seedQuotation(c, wo, tag);
  await c.query(`UPDATE quo.quotations SET payer_partner_ref = $2 WHERE id = $1`, [
    quotation,
    PAYER,
  ]);
  const revision = await draftRevision(c, quotation, 1);
  const item = await addServiceItem(c, revision, service, 1, 100, 1);
  await c.query(`SELECT quo.issue_revision($1)`, [revision]);
  return { quotation, revision, item };
}

/** Approves the line and moves the quotation to accepted, as the decision roll-up does. */
async function accept(c: Q, ids: { quotation: string; item: string }): Promise<void> {
  await c.query(`SELECT quo.record_item_decision($1,'approved','phone')`, [ids.item]);
  await c.query(`UPDATE quo.quotations SET status = 'accepted' WHERE id = $1`, [ids.quotation]);
}

const insertRecord = `INSERT INTO quo.acceptance_records
   (tenant_id, company_id, branch_id, quotation_id, quotation_revision_id, customer_partner_id,
    contact_name, contact_phone, channel, evidence_kind, reference_note, recorded_by, created_by,
    accepted_at)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'phone',$9,$10,$11,$11,$12)
 RETURNING id, recorded_by, created_by, accepted_at, now() AS tx_now`;

const recordParams = (
  ids: { quotation: string; revision: string },
  over: {
    customer?: string | null;
    name?: string | null;
    phone?: string | null;
    kind?: string | null;
    note?: string | null;
    recorder?: string;
    acceptedAt?: string;
  } = {}
) => [
  TENANT_A,
  COMPANY_A1,
  BRANCH_A1,
  ids.quotation,
  ids.revision,
  over.customer === undefined ? PAYER : over.customer,
  over.name === undefined ? 'Sami Nasser' : over.name,
  over.phone === undefined ? '+962791234567' : over.phone,
  over.kind === undefined ? 'verbal' : over.kind,
  over.note === undefined ? 'Call ref 42' : over.note,
  over.recorder ?? USER_A,
  over.acceptedAt ?? '2001-01-01T00:00:00Z',
];

describe('quo.acceptance_records — the shape of the table', () => {
  it('has RLS enabled and forced, with exactly a SELECT and an INSERT policy', async () => {
    const rls = (
      await admin.query(
        `SELECT relrowsecurity, relforcerowsecurity FROM pg_class
          WHERE oid = 'quo.acceptance_records'::regclass`
      )
    ).rows[0];
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const policies = (
      await admin.query(
        `SELECT polname, polcmd FROM pg_policy
          WHERE polrelid = 'quo.acceptance_records'::regclass ORDER BY polname`
      )
    ).rows;
    expect(policies).toEqual([
      { polname: 'ins_acceptance_records_scope', polcmd: 'a' },
      { polname: 'sel_acceptance_records_scope', polcmd: 'r' },
    ]);
  });

  it('grants app_runtime SELECT and INSERT only, app_readonly SELECT only, and nobody UPDATE or DELETE', async () => {
    const grants = (
      await admin.query(
        `SELECT grantee, privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'quo' AND table_name = 'acceptance_records'
            AND grantee IN ('app_runtime', 'app_readonly', 'app_worker')
          ORDER BY grantee, privilege_type`
      )
    ).rows;
    expect(grants).toEqual([
      { grantee: 'app_readonly', privilege_type: 'SELECT' },
      { grantee: 'app_runtime', privilege_type: 'INSERT' },
      { grantee: 'app_runtime', privilege_type: 'SELECT' },
    ]);
  });
});

describe('quo.acceptance_records — what a record may say', () => {
  it('stamps the recorder and the time from the session, whatever the statement says', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const ids = await issuedRevision(c, 'fd11a');
      await accept(c, ids);
      // A forged recorder and a back-dated time are overwritten by the guard, and the
      // INSERT policy then holds the row to the session's own user.
      const row = (await c.query(insertRecord, recordParams(ids, { recorder: OTHER_ACTOR })))
        .rows[0];
      expect(row.recorded_by).toBe(USER_A);
      expect(row.created_by).toBe(USER_A);
      expect((row.accepted_at as Date).toISOString()).toBe((row.tx_now as Date).toISOString());
    });
  });

  it('refuses a record for a revision that is not accepted', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const ids = await issuedRevision(c, 'fd11b');
      // Issued, not decided: no acceptance to record.
      await expectFail(c, '23514', insertRecord, recordParams(ids));
      // Every line approved but the quotation not moved to accepted: still refused.
      await c.query(`SELECT quo.record_item_decision($1,'approved','phone')`, [ids.item]);
      await expectFail(c, '23514', insertRecord, recordParams(ids));
    });
  });

  it('keeps one record per revision', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const ids = await issuedRevision(c, 'fd11c');
      await accept(c, ids);
      await c.query(insertRecord, recordParams(ids));
      await expectFail(c, '23505', insertRecord, recordParams(ids));
    });
  });

  it('names no customer but the payer, and may name none', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const ids = await issuedRevision(c, 'fd11d');
      await accept(c, ids);
      await expectFail(c, '23514', insertRecord, recordParams(ids, { customer: NOT_THE_PAYER }));
      const row = (await c.query(insertRecord, recordParams(ids, { customer: null }))).rows[0];
      expect(row.id).toBeTruthy();
    });
  });

  it('holds the contact and the reference to their shapes, and keeps empty as empty', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const ids = await issuedRevision(c, 'fd11e');
      await accept(c, ids);
      for (const bad of [
        { name: '' },
        { name: ' padded ' },
        { name: 'x'.repeat(201) },
        { phone: '07 9123' },
        { phone: '12' },
        { phone: '+' + '1'.repeat(21) },
        { kind: null, note: 'a note with no evidence' },
        { note: '   ' },
        { kind: 'document' },
      ]) {
        await expectFail(c, '23514', insertRecord, recordParams(ids, bad));
      }
      const row = (
        await c.query(
          insertRecord,
          recordParams(ids, { name: null, phone: null, kind: null, note: null })
        )
      ).rows[0];
      const stored = (
        await c.query(
          `SELECT contact_name, contact_phone, evidence_kind, reference_note,
                  evidence_document_version_id
             FROM quo.acceptance_records WHERE id = $1`,
          [row.id]
        )
      ).rows[0];
      expect(stored).toEqual({
        contact_name: null,
        contact_phone: null,
        evidence_kind: null,
        reference_note: null,
        evidence_document_version_id: null,
      });
    });
  });

  it('refuses every change to a record — the runtime has no grant and the guard refuses even the owner', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const ids = await issuedRevision(c, 'fd11f');
      await accept(c, ids);
      const row = (await c.query(insertRecord, recordParams(ids))).rows[0];
      await expectFail(
        c,
        '42501',
        `UPDATE quo.acceptance_records SET contact_name = 'X' WHERE id = $1`,
        [row.id]
      );
      await expectFail(c, '42501', `DELETE FROM quo.acceptance_records WHERE id = $1`, [row.id]);
    });
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_A]);
      await client.query(`SELECT set_config('app.user_id', $1, true)`, [USER_A]);
      const ids = await issuedRevision(client, 'fd11g');
      await accept(client, ids);
      const row = (await client.query(insertRecord, recordParams(ids))).rows[0];
      await expectFail(
        client,
        '23514',
        `UPDATE quo.acceptance_records SET reference_note = 'rewritten' WHERE id = $1`,
        [row.id]
      );
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});

describe('quo.acceptance_records — tenant isolation', () => {
  it('another tenant neither sees a record nor writes one into this tenant', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const ids = await issuedRevision(c, 'fd11h');
      await accept(c, ids);
      const row = (await c.query(insertRecord, recordParams(ids))).rows[0];
      const own = await c.query(`SELECT id FROM quo.acceptance_records WHERE id = $1`, [row.id]);
      expect(own.rows.length).toBe(1);

      // The same transaction, now acting as tenant B.
      await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_B]);
      await c.query(`SELECT set_config('app.user_id', $1, true)`, [USER_B]);
      const seen = await c.query(`SELECT id FROM quo.acceptance_records`);
      expect(seen.rows.filter((r) => r.id === row.id)).toEqual([]);
      const counted = await c.query(
        `SELECT count(*)::int AS n FROM quo.acceptance_records WHERE tenant_id = $1`,
        [TENANT_A]
      );
      expect(counted.rows[0]?.n).toBe(0);
      // Writing a row that names tenant A from tenant B's session is refused.
      await expectFail(c, ['42501', '23514', '23503'], insertRecord, [
        ...recordParams(ids).slice(0, 10),
        USER_B,
        '2001-01-01T00:00:00Z',
      ]);
    });
  });
});
