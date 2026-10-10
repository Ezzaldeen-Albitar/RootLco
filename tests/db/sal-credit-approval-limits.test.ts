/**
 * P1-32-PRE-OD-FD2C — the credit-approval permission and credit-note approval limits
 * (ADR-023, D13) of migration `20261001090000_sal_credit_approval_limits.sql`, the
 * database half.
 *
 * Every case is written so it FAILS when the control it names is removed:
 *
 *  - Approving a credit note needs `sal.credit.approve` in the note's company and
 *    branch (`credit_approval_permission_missing`), and a `credit_note` approval
 *    limit that counts: in the note's currency (`credit_limit_currency_mismatch`),
 *    not one the approver created (`credit_limit_self_created`), never a discount
 *    limit (`credit_no_approval_limit`), covering every approved credit on the
 *    invoice including this note (`credit_limit_exceeded`, the anti-splitting rule).
 *  - Two approvals of two notes on one invoice serialise on the invoice row lock, so
 *    at most the limit-covered total is approved.
 *  - Rejecting needs `sal.credit.approve` and no limit; withdrawing is unchanged.
 *  - A new approval limit fits its currency's minor unit, and a credit-note limit is
 *    above zero; a subject holds one credit-note limit per currency at a time, and
 *    the discount key is unchanged.
 *  - The runtime login cannot forge the approver of a note, nor the creator or the
 *    amount of a limit.
 *
 * Every rule lives in the trigger `sal.guard_credit_note_decision`, so each is proved
 * through the primitive AND through a raw UPDATE on the `app_runtime` login, inside
 * rolled-back transactions. The actors are committed in `beforeAll` and removed with
 * the tenant in `afterAll`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Client } from 'pg';
import {
  adminPool,
  runtimePool,
  ensureTestLogins,
  ensureOrgFixtures,
  cleanFixtures,
  setContext,
  withRolledBackTx,
  USER_A,
  USER_B,
  TENANT_A,
  TENANT_B,
  COMPANY_A1,
} from './helpers';
import {
  seedP111Base,
  ctxA,
  expectFail,
  seedInvoiceWithLine,
  issueInvoice,
  seedCreditNote,
  cleanP111Committed,
  P11,
} from './p1-11-helpers';

type Q = { query: Client['query'] };

const admin = adminPool();
const runtime = runtimePool();

/** Deterministic D13 fixture UUIDs (d13 family), tenant A. */
const D13 = {
  BRANCH_ELSEWHERE: 'd13b0000-0000-4000-8000-0000000000b2',
  ROLE_APPROVER: 'd13a0000-0000-4000-8000-0000000000f1',
  ROLE_MANAGE_ONLY: 'd13a0000-0000-4000-8000-0000000000f2',
  ROLE_LIMIT_ADMIN: 'd13a0000-0000-4000-8000-0000000000f3',
  /** B: holds the permission; a USD 50.00 credit-note limit set by C (P11.APPROVER_USER). */
  APPROVER: 'd13a0000-0000-4000-8000-0000000000a1',
  /** Holds sal.credit.manage and a credit-note limit, but NOT sal.credit.approve. */
  MANAGE_ONLY: 'd13a0000-0000-4000-8000-0000000000a2',
  /** Holds the permission and no limit at all. */
  NO_LIMIT: 'd13a0000-0000-4000-8000-0000000000a3',
  /** Holds the permission and only a DISCOUNT limit. */
  DISCOUNT_ONLY: 'd13a0000-0000-4000-8000-0000000000a4',
  /** Holds the permission and a credit-note limit in JOD only. */
  OTHER_CURRENCY: 'd13a0000-0000-4000-8000-0000000000a5',
  /** Holds the permission and a credit-note limit it set itself. */
  SELF_CREATED: 'd13a0000-0000-4000-8000-0000000000a6',
  /** Holds the permission in ANOTHER branch only, with a credit-note limit. */
  ELSEWHERE: 'd13a0000-0000-4000-8000-0000000000a7',
  /** Holds iam.approval.manage, for the limit-creator forgery case. */
  LIMIT_ADMIN: 'd13a0000-0000-4000-8000-0000000000a8',
  GRANT_ELSEWHERE: 'd13a0000-0000-4000-8000-0000000000e7',
};

const APPROVER_LIMIT = '50.00';

const ctx = (userId: string) => ({ tenantId: TENANT_A, userId });

const scalar = async (c: Q, sql: string, params: unknown[] = []): Promise<string | null> => {
  const value = ((await c.query(sql, params)).rows[0] as Record<string, unknown>).v;
  return value === null || value === undefined ? null : String(value);
};

const stateOf = (c: Q, note: string) =>
  scalar(c, `SELECT approval_state AS v FROM sal.credit_notes WHERE id = $1`, [note]);

const setUser = (c: Q, userId: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [userId]);

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

/** Expects a refusal whose message starts with the D13 token. */
async function expectToken(
  c: Q,
  code: string,
  token: string,
  sql: string,
  params: unknown[] = []
): Promise<void> {
  const error = await refusal(c, sql, params);
  expect(error.code).toBe(code);
  expect(error.message?.startsWith(`${token}:`)).toBe(true);
}

/** An issued USD invoice of 100, raised by USER_A, with pending notes of the given amounts. */
async function invoiceWithNotes(
  c: Q,
  tag: string,
  amounts: readonly string[]
): Promise<{ invoice: string; notes: string[] }> {
  await setUser(c, USER_A);
  const { invoice } = await seedInvoiceWithLine(c, tag, { net: 100, tax: 0 });
  await issueInvoice(c, invoice);
  const notes: string[] = [];
  for (const amount of amounts) notes.push(await seedCreditNote(c, invoice, amount));
  return { invoice, notes };
}

async function seedUser(id: string, tag: string): Promise<void> {
  await admin.query(
    `INSERT INTO iam.user_accounts (id, tenant_id, identity_provider, provider_subject, email, display_name, status, created_by)
     VALUES ($1,$2,'fixture',$3,$4,$5,'active',$6) ON CONFLICT (id) DO NOTHING`,
    [id, TENANT_A, `d13-${tag}`, `d13-${tag}@fixture.test`, `D13 ${tag}`, USER_A]
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

async function seedLimit(
  userId: string,
  limitType: string,
  amount: string,
  currency: string,
  setBy: string
): Promise<void> {
  await admin.query(
    `INSERT INTO iam.approval_limits
       (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
     SELECT $1,$2,$3,$4,$5::numeric,$6,'2020-01-01'::date,$7
      WHERE NOT EXISTS (
        SELECT 1 FROM iam.approval_limits
         WHERE tenant_id = $1 AND company_id = $2 AND user_id = $3
           AND limit_type = $4 AND currency_code = $6)`,
    [TENANT_A, COMPANY_A1, userId, limitType, amount, currency, setBy]
  );
}

const DECIDING = ['sal.finance.view', 'sal.credit.manage', 'sal.credit.approve'];

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);

  await admin.query(
    `INSERT INTO org.branches (id, tenant_id, company_id, branch_code, name, timezone_name, created_by)
     VALUES ($1,$2,$3,'d13_elsewhere','D13 elsewhere','UTC',$4) ON CONFLICT (id) DO NOTHING`,
    [D13.BRANCH_ELSEWHERE, TENANT_A, COMPANY_A1, USER_A]
  );
  await seedRole(D13.ROLE_APPROVER, 'd13_approver', DECIDING);
  await seedRole(D13.ROLE_MANAGE_ONLY, 'd13_manage_only', [
    'sal.finance.view',
    'sal.credit.manage',
  ]);
  await seedRole(D13.ROLE_LIMIT_ADMIN, 'd13_limit_admin', ['iam.approval.manage']);

  for (const [id, tag] of [
    [D13.APPROVER, 'approver'],
    [D13.MANAGE_ONLY, 'manage-only'],
    [D13.NO_LIMIT, 'no-limit'],
    [D13.DISCOUNT_ONLY, 'discount-only'],
    [D13.OTHER_CURRENCY, 'other-currency'],
    [D13.SELF_CREATED, 'self-created'],
    [D13.ELSEWHERE, 'elsewhere'],
    [D13.LIMIT_ADMIN, 'limit-admin'],
  ] as const) {
    await seedUser(id, tag);
  }
  for (const id of [
    D13.APPROVER,
    D13.NO_LIMIT,
    D13.DISCOUNT_ONLY,
    D13.OTHER_CURRENCY,
    D13.SELF_CREATED,
  ]) {
    await grantUnrestricted(id, D13.ROLE_APPROVER);
  }
  await grantUnrestricted(D13.MANAGE_ONLY, D13.ROLE_MANAGE_ONLY);
  await grantUnrestricted(D13.LIMIT_ADMIN, D13.ROLE_LIMIT_ADMIN);
  // ELSEWHERE holds the deciding codes in the other branch only.
  const c = await admin.connect();
  try {
    await c.query('BEGIN');
    await c.query(
      `INSERT INTO iam.role_grants (id, tenant_id, user_id, role_id, scope_mode, status, granted_by, created_by)
       VALUES ($1,$2,$3,$4,'scoped','active',$5,$5) ON CONFLICT (id) DO NOTHING`,
      [D13.GRANT_ELSEWHERE, TENANT_A, D13.ELSEWHERE, D13.ROLE_APPROVER, USER_A]
    );
    await c.query(
      `INSERT INTO iam.grant_scopes (tenant_id, grant_id, scope_type, company_id, branch_id, created_by)
       SELECT $1,$2,'branch',$3,$4,$5
        WHERE NOT EXISTS (SELECT 1 FROM iam.grant_scopes WHERE tenant_id = $1 AND grant_id = $2)`,
      [TENANT_A, D13.GRANT_ELSEWHERE, COMPANY_A1, D13.BRANCH_ELSEWHERE, USER_A]
    );
    await c.query('COMMIT');
  } catch (error) {
    await c.query('ROLLBACK');
    throw error;
  } finally {
    c.release();
  }

  // C (P11.APPROVER_USER) sets B's limit: the one that counts.
  await seedLimit(D13.APPROVER, 'credit_note', APPROVER_LIMIT, 'USD', P11.APPROVER_USER);
  await seedLimit(D13.MANAGE_ONLY, 'credit_note', '1000.00', 'USD', P11.APPROVER_USER);
  await seedLimit(D13.DISCOUNT_ONLY, 'discount', '1000.00', 'USD', P11.APPROVER_USER);
  await seedLimit(D13.OTHER_CURRENCY, 'credit_note', '1000.000', 'JOD', P11.APPROVER_USER);
  await seedLimit(D13.SELF_CREATED, 'credit_note', '1000.00', 'USD', D13.SELF_CREATED);
  await seedLimit(D13.ELSEWHERE, 'credit_note', '1000.00', 'USD', P11.APPROVER_USER);
});

afterAll(async () => {
  await cleanP111Committed(admin);
  await cleanFixtures(admin);
  await admin.end();
  await runtime.end();
});

describe('D13 — an approval within a limit somebody else set', () => {
  it('approves a note the limit covers, through the primitive and through a raw UPDATE', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice, notes } = await invoiceWithNotes(c, 'd13_within', ['30.00', '20.00']);
      await setUser(c, D13.APPROVER);
      await c.query(`SELECT sal.approve_credit_note($1)`, [notes[0]]);
      expect(await stateOf(c, notes[0]!)).toBe('approved');
      expect(
        await scalar(c, `SELECT approved_by::text AS v FROM sal.credit_notes WHERE id = $1`, [
          notes[0],
        ])
      ).toBe(D13.APPROVER);
      // 30 + 20 = 50, exactly the limit: covered.
      await c.query(`UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = $1`, [
        notes[1],
      ]);
      expect(await stateOf(c, notes[1]!)).toBe('approved');
      expect(await scalar(c, `SELECT sal.invoice_open_receivable($1)::text AS v`, [invoice])).toBe(
        '50.0000'
      );
    });
  });

  it('refuses the requester approving their own note, whatever limit they hold', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_self', ['10.00']);
      // USER_A holds the permission and a large limit set by somebody else.
      await expectFail(c, '23514', `SELECT sal.approve_credit_note($1)`, [notes[0]]);
      expect(await stateOf(c, notes[0]!)).toBe('pending');
    });
  });
});

describe('D13 — the refusals, each named by the guard', () => {
  it('refuses an approver without sal.credit.approve, whatever limit they hold', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_noperm', ['10.00']);
      await setUser(c, D13.MANAGE_ONLY);
      await expectToken(
        c,
        '42501',
        'credit_approval_permission_missing',
        `SELECT sal.approve_credit_note($1)`,
        [notes[0]]
      );
      await expectToken(
        c,
        '42501',
        'credit_approval_permission_missing',
        `UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = $1`,
        [notes[0]]
      );
      expect(await stateOf(c, notes[0]!)).toBe('pending');
    });
  });

  it('refuses an approver who holds the permission in ANOTHER branch only', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_elsewhere', ['10.00']);
      await setUser(c, D13.ELSEWHERE);
      await expectToken(
        c,
        '42501',
        'credit_approval_permission_missing',
        `UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = $1`,
        [notes[0]]
      );
      expect(await stateOf(c, notes[0]!)).toBe('pending');
    });
  });

  it('refuses an approver with the permission and no credit-note limit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_nolimit', ['10.00']);
      await setUser(c, D13.NO_LIMIT);
      await expectToken(
        c,
        '23514',
        'credit_no_approval_limit',
        `SELECT sal.approve_credit_note($1)`,
        [notes[0]]
      );
      expect(await stateOf(c, notes[0]!)).toBe('pending');
    });
  });

  it('refuses an approver whose only limit is a DISCOUNT limit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_discount', ['10.00']);
      await setUser(c, D13.DISCOUNT_ONLY);
      await expectToken(
        c,
        '23514',
        'credit_no_approval_limit',
        `UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = $1`,
        [notes[0]]
      );
      expect(await stateOf(c, notes[0]!)).toBe('pending');
    });
  });

  it('refuses an approver whose credit-note limit is in another currency', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_currency', ['10.00']);
      await setUser(c, D13.OTHER_CURRENCY);
      await expectToken(
        c,
        '23514',
        'credit_limit_currency_mismatch',
        `SELECT sal.approve_credit_note($1)`,
        [notes[0]]
      );
      expect(await stateOf(c, notes[0]!)).toBe('pending');
    });
  });

  it('refuses an approver whose only credit-note limit is one they set themselves', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_selfset', ['10.00']);
      await setUser(c, D13.SELF_CREATED);
      await expectToken(
        c,
        '23514',
        'credit_limit_self_created',
        `SELECT sal.approve_credit_note($1)`,
        [notes[0]]
      );
      expect(await stateOf(c, notes[0]!)).toBe('pending');
    });
  });

  it('refuses a note larger than the limit', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_over', ['50.01']);
      await setUser(c, D13.APPROVER);
      await expectToken(c, '23514', 'credit_limit_exceeded', `SELECT sal.approve_credit_note($1)`, [
        notes[0],
      ]);
      await expectToken(
        c,
        '23514',
        'credit_limit_exceeded',
        `UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = $1`,
        [notes[0]]
      );
      expect(await stateOf(c, notes[0]!)).toBe('pending');
    });
  });
});

describe('D13 — anti-splitting: the limit covers the invoice, not the note', () => {
  it('refuses the second of two notes each under the limit whose total exceeds it', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_split', ['30.00', '30.00']);
      await setUser(c, D13.APPROVER);
      await c.query(`SELECT sal.approve_credit_note($1)`, [notes[0]]);
      await expectToken(c, '23514', 'credit_limit_exceeded', `SELECT sal.approve_credit_note($1)`, [
        notes[1],
      ]);
      expect(await stateOf(c, notes[1]!)).toBe('pending');
    });
  });

  it('counts a credit another approver already approved on the same invoice', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_split_other', ['40.00', '20.00']);
      // C, with a large limit, approves the first.
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_credit_note($1)`, [notes[0]]);
      await setUser(c, D13.APPROVER);
      await expectToken(c, '23514', 'credit_limit_exceeded', `SELECT sal.approve_credit_note($1)`, [
        notes[1],
      ]);
    });
  });

  it('does not count pending, rejected or withdrawn notes', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_split_declined', [
        '40.00',
        '40.00',
        '40.00',
        '45.00',
      ]);
      await c.query(`SELECT sal.withdraw_credit_note($1)`, [notes[0]]);
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.reject_credit_note($1, 'duplicate')`, [notes[1]]);
      // notes[2] stays pending; 45 alone is under 50.
      await setUser(c, D13.APPROVER);
      await c.query(`SELECT sal.approve_credit_note($1)`, [notes[3]]);
      expect(await stateOf(c, notes[3]!)).toBe('approved');
    });
  });
});

/** Approves through the primitive. */
const viaPrimitive = async (c: Q, note: string): Promise<void> => {
  await c.query(`SELECT sal.approve_credit_note($1)`, [note]);
};

/**
 * Approves through a raw UPDATE, adding the financial event the deferred completeness
 * check requires at commit — everything the primitive does except taking the invoice
 * lock itself, so only the decision guard can serialise it.
 */
const viaRawUpdate = async (c: Q, note: string): Promise<void> => {
  await c.query(`UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = $1`, [note]);
  await c.query(
    `INSERT INTO sal.financial_events
       (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code,
        amount, actor_id, correlation_id, created_by)
     SELECT cn.tenant_id, cn.company_id, cn.branch_id, 'credit_note_issued', 'credit_note', cn.id,
            cn.currency_code, cn.amount, iam.current_user_id(), NULL, iam.current_user_id()
       FROM sal.credit_notes cn WHERE cn.id = $1`,
    [note]
  );
};

describe('D13 — concurrent approvals serialise on the invoice', () => {
  // Through the primitive, which already holds the invoice lock for the credit ceiling,
  // and through a raw UPDATE, where only the decision guard takes it.
  it.each([
    ['the primitive', 'd13_cc_fn', viaPrimitive],
    ['a raw UPDATE', 'd13_cc_raw', viaRawUpdate],
  ] as const)(
    'approves at most the limit-covered total when two notes are approved at once, through %s',
    async (_how, tag, approveWith) => {
      // Committed: the two approvals run on two connections and must see each other.
      const setup = await runtime.connect();
      let notes: string[] = [];
      try {
        await setup.query('BEGIN');
        await setContext(setup, ctxA);
        notes = (await invoiceWithNotes(setup, tag, ['30.00', '30.00'])).notes;
        await setup.query('COMMIT');
      } catch (error) {
        await setup.query('ROLLBACK');
        throw error;
      } finally {
        setup.release();
      }

      const first = await runtime.connect();
      const second = await runtime.connect();
      try {
        await first.query('BEGIN');
        await setContext(first, ctx(D13.APPROVER));
        await second.query('BEGIN');
        await setContext(second, ctx(D13.APPROVER));
        const secondPid = (await second.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
          .rows[0]!.pid;

        await approveWith(first, notes[0]!);
        const racing = approveWith(second, notes[1]!)
          .then(() => null)
          .catch((error: { code?: string; message?: string }) => error);

        // The second approval is WAITING on the invoice row the first holds.
        let waited = false;
        for (let attempt = 0; attempt < 50 && !waited; attempt += 1) {
          const lock = await admin.query<{ waiting: boolean }>(
            `SELECT wait_event_type = 'Lock' AS waiting FROM pg_stat_activity WHERE pid = $1`,
            [secondPid]
          );
          waited = lock.rows[0]?.waiting === true;
          if (!waited) await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(waited).toBe(true);

        await first.query('COMMIT');
        const outcome = await racing;
        expect(outcome?.code).toBe('23514');
        expect(outcome?.message?.startsWith('credit_limit_exceeded:')).toBe(true);
        await second.query('ROLLBACK');

        const states = await admin.query<{ approval_state: string }>(
          `SELECT approval_state FROM sal.credit_notes WHERE id = ANY($1::uuid[]) ORDER BY approval_state`,
          [notes]
        );
        expect(states.rows.map((row) => row.approval_state)).toEqual(['approved', 'pending']);
      } finally {
        // Never hand an open transaction back to the pool, whatever failed above.
        await first.query('ROLLBACK').catch(() => undefined);
        await second.query('ROLLBACK').catch(() => undefined);
        first.release();
        second.release();
      }
    }
  );
});

describe('D13 — rejecting needs the permission and no limit; withdrawing is unchanged', () => {
  it('refuses a rejection by a holder of sal.credit.manage without sal.credit.approve', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_reject_noperm', ['10.00']);
      await setUser(c, D13.MANAGE_ONLY);
      await expectToken(
        c,
        '42501',
        'credit_note_reject_permission_missing',
        `SELECT sal.reject_credit_note($1, 'not ours')`,
        [notes[0]]
      );
      expect(await stateOf(c, notes[0]!)).toBe('pending');
    });
  });

  it('lets a holder of sal.credit.approve with no limit reject', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_reject_nolimit', ['99.00']);
      await setUser(c, D13.NO_LIMIT);
      await c.query(`SELECT sal.reject_credit_note($1, 'raised against the wrong invoice')`, [
        notes[0],
      ]);
      expect(await stateOf(c, notes[0]!)).toBe('rejected');
    });
  });

  it('still lets the requester withdraw, and nobody else', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_withdraw', ['10.00', '10.00']);
      await setUser(c, D13.APPROVER);
      await expectToken(
        c,
        '23514',
        'credit_note_withdraw_not_requester',
        `SELECT sal.withdraw_credit_note($1)`,
        [notes[0]]
      );
      await setUser(c, USER_A);
      await c.query(`SELECT sal.withdraw_credit_note($1)`, [notes[0]]);
      expect(await stateOf(c, notes[0]!)).toBe('withdrawn');
    });
  });
});

describe('D13 — isolation', () => {
  it('refuses another tenant: the note is not found in its scope and no raw UPDATE reaches it', async () => {
    // A COMMITTED note, so the other tenant's connection could see it if RLS let it.
    const setup = await runtime.connect();
    let committed = '';
    try {
      await setup.query('BEGIN');
      await setContext(setup, ctxA);
      committed = (await invoiceWithNotes(setup, 'd13_tenant_c', ['10.00'])).notes[0]!;
      await setup.query('COMMIT');
    } catch (error) {
      await setup.query('ROLLBACK');
      throw error;
    } finally {
      setup.release();
    }
    await withRolledBackTx(runtime, { tenantId: TENANT_B, userId: USER_B }, async (c) => {
      await expectFail(c, 'P0002', `SELECT sal.approve_credit_note($1)`, [committed]);
      const updated = await c.query(
        `UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = $1`,
        [committed]
      );
      expect(updated.rowCount).toBe(0);
    });
    const state = await admin.query<{ approval_state: string }>(
      `SELECT approval_state FROM sal.credit_notes WHERE id = $1`,
      [committed]
    );
    expect(state.rows[0]?.approval_state).toBe('pending');
  });
});

describe('D13 — what the runtime login cannot forge', () => {
  it('cannot name the approver of a note: the column is not granted and the trigger stamps it', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { notes } = await invoiceWithNotes(c, 'd13_forge_note', ['10.00']);
      await setUser(c, D13.APPROVER);
      await expectFail(
        c,
        '42501',
        `UPDATE sal.credit_notes SET approval_state = 'approved', approved_by = $2 WHERE id = $1`,
        [notes[0], P11.APPROVER_USER]
      );
      await c.query(`UPDATE sal.credit_notes SET approval_state = 'approved' WHERE id = $1`, [
        notes[0],
      ]);
      expect(
        await scalar(c, `SELECT approved_by::text AS v FROM sal.credit_notes WHERE id = $1`, [
          notes[0],
        ])
      ).toBe(D13.APPROVER);
    });
  });

  it('cannot set a limit in somebody else name, nor rewrite a limit amount', async () => {
    await withRolledBackTx(runtime, ctx(D13.LIMIT_ADMIN), async (c) => {
      await expectToken(
        c,
        '23514',
        'approval_limit_creator_mismatch',
        `INSERT INTO iam.approval_limits
           (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
         VALUES ($1,$2,$3,'credit_note',100,'USD','2020-01-01',$4)`,
        [TENANT_A, COMPANY_A1, D13.NO_LIMIT, P11.APPROVER_USER]
      );
      const inserted = await c.query<{ id: string; created_by: string }>(
        `INSERT INTO iam.approval_limits
           (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from)
         VALUES ($1,$2,$3,'credit_note',100,'USD','2020-01-01') RETURNING id, created_by`,
        [TENANT_A, COMPANY_A1, D13.NO_LIMIT]
      );
      expect(inserted.rows[0]?.created_by).toBe(D13.LIMIT_ADMIN);
      await expectFail(c, '42501', `UPDATE iam.approval_limits SET amount = 999999 WHERE id = $1`, [
        inserted.rows[0]?.id,
      ]);
    });
  });
});

describe('D13 — a limit is money in its own currency, one credit-note limit per currency', () => {
  const insertLimit = (c: Q, userId: string, limitType: string, amount: string, currency: string) =>
    c.query(
      `INSERT INTO iam.approval_limits
         (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
       VALUES ($1,$2,$3,$4,$5::numeric,$6,'2021-01-01',$7)`,
      [TENANT_A, COMPANY_A1, userId, limitType, amount, currency, USER_A]
    );

  it('refuses an amount finer than the minor unit, for every type', async () => {
    await withRolledBackTx(admin, ctx(USER_A), async (c) => {
      for (const [type, amount, currency] of [
        ['credit_note', '10.005', 'USD'],
        ['credit_note', '10.0005', 'JOD'],
        ['discount', '10.005', 'USD'],
      ] as const) {
        const error = await refusal(
          c,
          `INSERT INTO iam.approval_limits
             (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
           VALUES ($1,$2,$3,$4,$5::numeric,$6,'2021-01-01',$7)`,
          [TENANT_A, COMPANY_A1, D13.NO_LIMIT, type, amount, currency, USER_A]
        );
        expect(error.code).toBe('23514');
        expect(error.message?.startsWith('approval_limit_minor_unit:')).toBe(true);
      }
      // Trailing zeros are not significant, and JOD carries three decimals.
      await insertLimit(c, D13.NO_LIMIT, 'credit_note', '10.0050', 'JOD');
    });
  });

  it('refuses a credit-note limit of zero, and keeps a discount limit of zero', async () => {
    await withRolledBackTx(admin, ctx(USER_A), async (c) => {
      await expectToken(
        c,
        '23514',
        'approval_limit_not_positive',
        `INSERT INTO iam.approval_limits
           (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
         VALUES ($1,$2,$3,'credit_note',0,'USD','2021-01-01',$4)`,
        [TENANT_A, COMPANY_A1, D13.NO_LIMIT, USER_A]
      );
      await insertLimit(c, D13.NO_LIMIT, 'discount', '0', 'USD');
    });
  });

  it('admits one credit-note limit per currency, and keeps one discount limit per subject', async () => {
    await withRolledBackTx(admin, ctx(USER_A), async (c) => {
      await insertLimit(c, D13.NO_LIMIT, 'credit_note', '10.00', 'USD');
      await insertLimit(c, D13.NO_LIMIT, 'credit_note', '10.000', 'JOD');
      await expectFail(
        c,
        '23P01',
        `INSERT INTO iam.approval_limits
           (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
         VALUES ($1,$2,$3,'credit_note',20,'USD','2022-01-01',$4)`,
        [TENANT_A, COMPANY_A1, D13.NO_LIMIT, USER_A]
      );
      await insertLimit(c, D13.NO_LIMIT, 'discount', '10.00', 'USD');
      await expectFail(
        c,
        '23P01',
        `INSERT INTO iam.approval_limits
           (tenant_id, company_id, user_id, limit_type, amount, currency_code, effective_from, created_by)
         VALUES ($1,$2,$3,'discount',20,'JOD','2022-01-01',$4)`,
        [TENANT_A, COMPANY_A1, D13.NO_LIMIT, USER_A]
      );
    });
  });
});
