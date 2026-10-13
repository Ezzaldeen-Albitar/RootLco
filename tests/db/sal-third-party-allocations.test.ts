/**
 * P1-32-PRE-OD-FD14 — the payer rule of ADR-023 D14, the database half
 * (migration `20261002100000_sal_third_party_allocations.sql`).
 *
 * Every case is written so it FAILS when the control it names is removed:
 *
 *  - SAME PAYER: an allocation of a receipt to its payer's own invoice is
 *    unchanged and carries no third-party detail; a raw INSERT cannot attach one
 *    (`third_party_same_payer`) nor forge the authorising user.
 *  - REFUSED BY DEFAULT: a receipt applied to another customer's invoice is
 *    refused, through the primitive and through a raw INSERT on the runtime login
 *    (`allocation_payer_mismatch`).
 *  - THIRD PARTY: with a relationship, an authorisation reference and a reason,
 *    by a holder of `sal.payment.third_party` in the receipt's company and branch,
 *    it is booked; the authorising user is the session's, whatever the statement
 *    says; the receipt keeps its payer, the invoice its customer, and what is left
 *    on the receipt stays the payer's.
 *  - AUTHORITY: `sal.payment.allocate` alone, and the code held in another branch,
 *    are refused (`third_party_permission_missing`).
 *  - FIELDS: each rule of the statement is refused by its own token.
 *  - CURRENCY and SCOPE: an allocation in another currency is refused for a raw
 *    INSERT too (`allocation_currency_mismatch`); another tenant sees nothing.
 *  - REPLAY: a repeated key answers the same allocation, and refuses a key reused
 *    with different third-party detail.
 *  - SHAPE: the guard runs on INSERT only (existing rows are never re-checked), the
 *    primitive's grant is the runtime's alone, and the code is a catalogue row.
 *
 * Runtime cases run on the `app_runtime` login inside rolled-back transactions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  withRolledBackTx,
  USER_A,
  USER_B,
  TENANT_A,
  TENANT_B,
  COMPANY_A1,
  BRANCH_A1,
} from './helpers';
import {
  seedP111Base,
  ctxA,
  seedInvoiceWithLine,
  issueInvoice,
  seedReceipt,
  seedPartner,
  allocateReceipt,
  cleanP111Committed,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();

/** Deterministic D14 fixture UUIDs, tenant A. */
const D14 = {
  BRANCH_ELSEWHERE: 'd14b0000-0000-4000-8000-0000000000b2',
  ROLE_THIRD_PARTY: 'd14a0000-0000-4000-8000-0000000000f1',
  ROLE_ALLOCATE: 'd14a0000-0000-4000-8000-0000000000f2',
  ROLE_THIRD_PARTY_ONLY: 'd14a0000-0000-4000-8000-0000000000f3',
  /** Holds sal.finance.view, sal.payment.allocate and sal.payment.third_party, unrestricted. */
  THIRD_PARTY: 'd14a0000-0000-4000-8000-0000000000a1',
  /**
   * Holds sal.finance.view and sal.payment.allocate unrestricted, and
   * sal.payment.third_party in ANOTHER branch only.
   */
  ELSEWHERE: 'd14a0000-0000-4000-8000-0000000000a2',
  GRANT_ELSEWHERE: 'd14a0000-0000-4000-8000-0000000000e2',
};

const scalar = async (c: Q, sql: string, params: unknown[] = []): Promise<string | null> => {
  const value = ((await c.query(sql, params)).rows[0] as Record<string, unknown>).v;
  return value === null || value === undefined ? null : String(value);
};

/** The error a statement raises, captured inside a savepoint. */
async function refusal(
  c: Q,
  sql: string,
  params: unknown[] = []
): Promise<{ code?: string; message?: string }> {
  await c.query('SAVEPOINT sp_refusal');
  try {
    await c.query(sql, params);
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT sp_refusal');
    return e as { code?: string; message?: string };
  }
  await c.query('ROLLBACK TO SAVEPOINT sp_refusal');
  throw new Error(`expected a refusal but the statement succeeded: ${sql}`);
}

/** Expects a refusal with this SQLSTATE whose message starts with the token. */
async function expectToken(
  c: Q,
  code: string,
  token: string,
  sql: string,
  params: unknown[] = []
): Promise<void> {
  const error = await refusal(c, sql, params);
  expect(error.code, token).toBe(code);
  expect(error.message?.startsWith(`${token}:`), error.message).toBe(true);
}

const INSURER = ['insurer', 'CLM-2026-0001', 'Covered by the policy holder insurer'] as const;

/** `sal.allocate_receipt` with the three third-party arguments. */
const ALLOCATE_THIRD_PARTY = `SELECT sal.allocate_receipt($1, $2, $3, NULL, $4, $5, $6, $7) AS id`;

/** A raw allocation INSERT, with its financial event so the deferred completeness check holds. */
const RAW_INSERT = `INSERT INTO sal.payment_allocations
   (tenant_id, company_id, branch_id, receipt_id, invoice_id, currency_code, amount, allocated_by,
    third_party_relationship, third_party_authorisation_reference, third_party_reason,
    third_party_authorised_by, created_by)
 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$8) RETURNING id`;

/**
 * An issued invoice of 100 billed to a customer of its own, and a receipt of 100
 * paid by somebody else (`P9.SR`).
 */
async function crossedPair(
  c: Q,
  tag: string,
  currency = 'USD'
): Promise<{ receipt: string; invoice: string; customer: string }> {
  const customer = await seedPartner(c, `${tag}_customer`, 'D14 Customer');
  const { invoice } = await seedInvoiceWithLine(c, tag, { net: 100, tax: 0, payer: customer });
  await issueInvoice(c, invoice);
  const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR, currency });
  return { receipt, invoice, customer };
}

const setUser = (c: Q, userId: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [userId]);

async function seedUser(id: string, tag: string): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'fixture',$3,$4,$5,'active',$6) ON CONFLICT (id) DO NOTHING`,
    [id, TENANT_A, `d14-${tag}`, `d14-${tag}@fixture.test`, `D14 ${tag}`, USER_A]
  );
}

async function seedRole(id: string, code: string, permissions: readonly string[]): Promise<void> {
  await admin.query(
    `INSERT INTO iam.roles (id, tenant_id, role_code, name, created_by)
     VALUES ($1,$2,$3,$3,$4) ON CONFLICT (id) DO NOTHING`,
    [id, TENANT_A, code, USER_A]
  );
  await admin.query(
    `INSERT INTO iam.role_permissions (tenant_id, role_id, permission_id, effect, created_by)
     SELECT $1, $2, p.id, 'allow', $3 FROM iam.permissions p
      WHERE p.permission_code = ANY($4) ON CONFLICT DO NOTHING`,
    [TENANT_A, id, USER_A, permissions]
  );
}

async function grantUnrestricted(userId: string, roleId: string): Promise<void> {
  await admin.query(
    `INSERT INTO iam.role_grants (tenant_id, user_id, role_id, granted_by, created_by)
     VALUES ($1,$2,$3,$4,$4) ON CONFLICT DO NOTHING`,
    [TENANT_A, userId, roleId, USER_A]
  );
}

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);

  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'d14_elsewhere','D14 elsewhere','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [D14.BRANCH_ELSEWHERE, TENANT_A, COMPANY_A1, USER_A]
  );
  await seedRole(D14.ROLE_THIRD_PARTY, 'd14_third_party', [
    'sal.finance.view',
    'sal.payment.allocate',
    'sal.payment.third_party',
  ]);
  await seedRole(D14.ROLE_ALLOCATE, 'd14_allocate', ['sal.finance.view', 'sal.payment.allocate']);
  await seedRole(D14.ROLE_THIRD_PARTY_ONLY, 'd14_third_party_only', ['sal.payment.third_party']);
  await seedUser(D14.THIRD_PARTY, 'third-party');
  await seedUser(D14.ELSEWHERE, 'elsewhere');
  await grantUnrestricted(D14.THIRD_PARTY, D14.ROLE_THIRD_PARTY);
  await grantUnrestricted(D14.ELSEWHERE, D14.ROLE_ALLOCATE);
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped','active',$5,$5) ON CONFLICT (id) DO NOTHING`,
      [D14.GRANT_ELSEWHERE, TENANT_A, D14.ELSEWHERE, D14.ROLE_THIRD_PARTY_ONLY, USER_A]
    );
    await c.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       SELECT $1,$2,'branch',$3,$4,$5
        WHERE NOT EXISTS (SELECT 1 FROM iam.grant_scopes WHERE tenant_id = $1 AND grant_id = $2)`,
      [TENANT_A, D14.GRANT_ELSEWHERE, COMPANY_A1, D14.BRANCH_ELSEWHERE, USER_A]
    );
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }
});

afterAll(async () => {
  await cleanP111Committed(admin);
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('D14 — the same payer is unchanged', () => {
  it('books an allocation to the payer’s own invoice with no third-party detail', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'd14_same', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
      const allocation = await allocateReceipt(c, receipt, invoice, 40);
      const row = (
        await c.query(
          `SELECT third_party_relationship, third_party_authorisation_reference,
                  third_party_reason, third_party_authorised_by
             FROM sal.payment_allocations WHERE id = $1`,
          [allocation]
        )
      ).rows[0];
      expect(row).toEqual({
        third_party_relationship: null,
        third_party_authorisation_reference: null,
        third_party_reason: null,
        third_party_authorised_by: null,
      });
      expect(await scalar(c, `SELECT sal.invoice_open_receivable($1)::text AS v`, [invoice])).toBe(
        '60.0000'
      );
    });
  });

  it('refuses third-party detail on a same-payer allocation, and never keeps a forged authoriser', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'd14_same_forge', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
      await expectToken(c, '23514', 'third_party_same_payer', ALLOCATE_THIRD_PARTY, [
        receipt,
        invoice,
        10,
        null,
        ...INSURER,
      ]);
      // A raw INSERT naming somebody else as the authoriser keeps no authoriser.
      const allocation = (
        await c.query<{ id: string }>(RAW_INSERT, [
          TENANT_A,
          COMPANY_A1,
          BRANCH_A1,
          receipt,
          invoice,
          'USD',
          10,
          USER_A,
          null,
          null,
          null,
          USER_B,
        ])
      ).rows[0]!.id;
      expect(
        await scalar(
          c,
          `SELECT third_party_authorised_by AS v FROM sal.payment_allocations WHERE id = $1`,
          [allocation]
        )
      ).toBeNull();
    });
  });
});

describe('D14 — another customer’s invoice is refused by default', () => {
  it('refuses the primitive and a raw INSERT, and books nothing', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { receipt, invoice } = await crossedPair(c, 'd14_default');
      await expectToken(
        c,
        '23514',
        'allocation_payer_mismatch',
        `SELECT sal.allocate_receipt($1, $2, 10)`,
        [receipt, invoice]
      );
      await expectToken(c, '23514', 'allocation_payer_mismatch', RAW_INSERT, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        receipt,
        invoice,
        'USD',
        10,
        USER_A,
        null,
        null,
        null,
        null,
      ]);
      expect(
        await scalar(
          c,
          `SELECT count(*)::int AS v FROM sal.payment_allocations WHERE receipt_id = $1`,
          [receipt]
        )
      ).toBe('0');
      expect(await scalar(c, `SELECT sal.receipt_unallocated($1)::text AS v`, [receipt])).toBe(
        '100.0000'
      );
    });
  });
});

describe('D14 — an explicit, authorised third-party allocation', () => {
  it('books it for a holder of sal.payment.third_party, stamps the authoriser, and moves nothing between the parties', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { receipt, invoice, customer } = await crossedPair(c, 'd14_book');
      await setUser(c, D14.THIRD_PARTY);
      const allocation = (
        await c.query<{ id: string }>(ALLOCATE_THIRD_PARTY, [
          receipt,
          invoice,
          60,
          'd14-key-book',
          ...INSURER,
        ])
      ).rows[0]!.id;
      const row = (
        await c.query(
          `SELECT third_party_relationship AS relationship,
                  third_party_authorisation_reference AS reference,
                  third_party_reason AS reason, third_party_authorised_by AS authorised_by,
                  allocated_by
             FROM sal.payment_allocations WHERE id = $1`,
          [allocation]
        )
      ).rows[0];
      expect(row).toEqual({
        relationship: 'insurer',
        reference: 'CLM-2026-0001',
        reason: 'Covered by the policy holder insurer',
        authorised_by: D14.THIRD_PARTY,
        allocated_by: D14.THIRD_PARTY,
      });
      // The receipt is still the payer's and the invoice still the customer's.
      expect(
        await scalar(c, `SELECT payer_partner_id::text AS v FROM sal.receipts WHERE id = $1`, [
          receipt,
        ])
      ).toBe(P9.SR);
      expect(
        await scalar(c, `SELECT payer_partner_id::text AS v FROM sal.invoices WHERE id = $1`, [
          invoice,
        ])
      ).toBe(customer);
      // The remainder stays on the payer's receipt; the invoice is paid down.
      expect(await scalar(c, `SELECT sal.receipt_unallocated($1)::text AS v`, [receipt])).toBe(
        '40.0000'
      );
      expect(await scalar(c, `SELECT sal.invoice_open_receivable($1)::text AS v`, [invoice])).toBe(
        '40.0000'
      );
      // One payment_allocated event, as for every allocation.
      expect(
        await scalar(
          c,
          `SELECT count(*)::int AS v FROM sal.financial_events
            WHERE source_type = 'payment_allocation' AND source_id = $1`,
          [allocation]
        )
      ).toBe('1');
    });
  });

  it('stamps the session as the authoriser over a forged one on a raw INSERT', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { receipt, invoice } = await crossedPair(c, 'd14_forge');
      await setUser(c, D14.THIRD_PARTY);
      const allocation = (
        await c.query<{ id: string }>(RAW_INSERT, [
          TENANT_A,
          COMPANY_A1,
          BRANCH_A1,
          receipt,
          invoice,
          'USD',
          10,
          D14.THIRD_PARTY,
          ...INSURER,
          USER_B,
        ])
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO sal.financial_events
           (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, created_by)
         VALUES ($1,$2,$3,'payment_allocated','payment_allocation',$4,'USD',10,$5,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, allocation, D14.THIRD_PARTY]
      );
      expect(
        await scalar(
          c,
          `SELECT third_party_authorised_by::text AS v FROM sal.payment_allocations WHERE id = $1`,
          [allocation]
        )
      ).toBe(D14.THIRD_PARTY);
    });
  });

  it('refuses sal.payment.allocate alone, and the code held in another branch only', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { receipt, invoice } = await crossedPair(c, 'd14_noauth');
      // USER_A records and allocates, and does not hold sal.payment.third_party.
      await expectToken(c, '42501', 'third_party_permission_missing', ALLOCATE_THIRD_PARTY, [
        receipt,
        invoice,
        10,
        null,
        ...INSURER,
      ]);
      await expectToken(c, '42501', 'third_party_permission_missing', RAW_INSERT, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        receipt,
        invoice,
        'USD',
        10,
        USER_A,
        ...INSURER,
        null,
      ]);
    });
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // The receipt and invoice are created as USER_A, then the session becomes the
      // allocator whose third-party grant names another branch.
      const { receipt, invoice } = await crossedPair(c, 'd14_elsewhere');
      await setUser(c, D14.ELSEWHERE);
      await expectToken(c, '42501', 'third_party_permission_missing', ALLOCATE_THIRD_PARTY, [
        receipt,
        invoice,
        10,
        null,
        ...INSURER,
      ]);
    });
  });

  it('refuses each rule of the statement by its own token', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { receipt, invoice } = await crossedPair(c, 'd14_fields');
      await setUser(c, D14.THIRD_PARTY);
      const cases: ReadonlyArray<readonly [string, string, string, string]> = [
        ['partner', 'CLM-1', 'A reason', 'third_party_relationship_invalid'],
        ['insurer', '   ', 'A reason', 'third_party_authorisation_reference_required'],
        ['insurer', 'X'.repeat(101), 'A reason', 'third_party_authorisation_reference_required'],
        ['employer', 'PO-77', '  ', 'third_party_reason_required'],
        ['employer', 'PO-77', 'Y'.repeat(2001), 'third_party_reason_required'],
        ['other', 'REF-9', '   ', 'third_party_other_unexplained'],
      ];
      for (const [relationship, reference, reason, token] of cases) {
        await expectToken(c, '23514', token, ALLOCATE_THIRD_PARTY, [
          receipt,
          invoice,
          10,
          null,
          relationship,
          reference,
          reason,
        ]);
      }
      // 'other' with the relationship explained is accepted.
      const allocation = (
        await c.query<{ id: string }>(ALLOCATE_THIRD_PARTY, [
          receipt,
          invoice,
          10,
          null,
          'other',
          'LETTER-3',
          'The customer’s father settles this account by letter',
        ])
      ).rows[0]!.id;
      expect(allocation).toMatch(/^[0-9a-f-]{36}$/);
    });
  });
});

describe('D14 — currency, scope and replay', () => {
  it('refuses a raw INSERT in another currency than the receipt’s and the invoice’s', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'd14_ccy', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });
      await expectToken(c, '23514', 'allocation_currency_mismatch', RAW_INSERT, [
        TENANT_A,
        COMPANY_A1,
        BRANCH_A1,
        receipt,
        invoice,
        'JOD',
        10,
        USER_A,
        null,
        null,
        null,
        null,
      ]);
    });
  });

  it('shows another tenant neither the receipt nor a way to allocate it', async () => {
    let receipt = '';
    let invoice = '';
    await withRolledBackTx(runtime, ctxA, async (c) => {
      ({ receipt, invoice } = await crossedPair(c, 'd14_tenant'));
      await c.query(`SELECT set_config('app.tenant_id',$1,true)`, [TENANT_B]);
      const error = await refusal(c, ALLOCATE_THIRD_PARTY, [
        receipt,
        invoice,
        10,
        null,
        ...INSURER,
      ]);
      expect(error.code).toBe('P0002');
    });
  });

  it('answers a repeated key with the same allocation, and refuses it with different detail', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { receipt, invoice } = await crossedPair(c, 'd14_replay');
      await setUser(c, D14.THIRD_PARTY);
      const first = (
        await c.query<{ id: string }>(ALLOCATE_THIRD_PARTY, [
          receipt,
          invoice,
          100,
          'd14-key-replay',
          ...INSURER,
        ])
      ).rows[0]!.id;
      // The whole receipt was applied: the retry is answered, not refused as over-allocation.
      const again = (
        await c.query<{ id: string }>(ALLOCATE_THIRD_PARTY, [
          receipt,
          invoice,
          100,
          'd14-key-replay',
          ...INSURER,
        ])
      ).rows[0]!.id;
      expect(again).toBe(first);
      const error = await refusal(c, ALLOCATE_THIRD_PARTY, [
        receipt,
        invoice,
        100,
        'd14-key-replay',
        'insurer',
        'CLM-2026-0001',
        'A different reason',
      ]);
      expect(error.code).toBe('23514');
      expect(error.message).toContain('idempotency key already booked a different allocation');
    });
  });
});

describe('D14 — shape', () => {
  it('guards INSERT only, so allocations booked before the rule are never re-checked', async () => {
    const { rows } = await admin.query<{ events: string }>(
      `SELECT CASE WHEN (t.tgtype & 4) <> 0 THEN 'insert' ELSE '' END ||
              CASE WHEN (t.tgtype & 16) <> 0 THEN '+update' ELSE '' END ||
              CASE WHEN (t.tgtype & 8) <> 0 THEN '+delete' ELSE '' END AS events
         FROM pg_trigger t
        WHERE t.tgrelid = 'sal.payment_allocations'::regclass
          AND t.tgname = 'tg_payment_allocations_payer'`
    );
    expect(rows).toEqual([{ events: 'insert' }]);
    // And the table stays append-only: nothing can rewrite an existing row.
    const grants = await admin.query<{ u: boolean; d: boolean }>(
      `SELECT has_table_privilege('app_runtime', 'sal.payment_allocations', 'UPDATE') AS u,
              has_table_privilege('app_runtime', 'sal.payment_allocations', 'DELETE') AS d`
    );
    expect(grants.rows[0]).toEqual({ u: false, d: false });
  });

  it('grants the eight-argument primitive to the runtime alone and drops the five-argument one', async () => {
    const { rows } = await admin.query<{ signature: string; runtime: boolean; public: boolean }>(
      `SELECT p.oid::regprocedure::text AS signature,
              has_function_privilege('app_runtime', p.oid, 'EXECUTE') AS runtime,
              EXISTS (SELECT 1 FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
                       WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS public
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'sal' AND p.proname = 'allocate_receipt'`
    );
    expect(rows).toEqual([
      {
        signature: 'sal.allocate_receipt(uuid,uuid,numeric,uuid,text,text,text,text)',
        runtime: true,
        public: false,
      },
    ]);
  });

  it('carries sal.payment.third_party in the permission catalogue at high risk', async () => {
    const { rows } = await admin.query<{ risk_level: string; domain: string }>(
      `SELECT risk_level, domain FROM iam.permissions WHERE permission_code = 'sal.payment.third_party'`
    );
    expect(rows).toEqual([{ risk_level: 'high', domain: 'sal' }]);
  });
});
