/**
 * Phase 1-22 — the protected residuals the application must compensate for.
 *
 * This suite is deliberately shaped the opposite way round from every other DB
 * suite in the repository. Those prove the protected schema DEFENDS an invariant.
 * These prove it DOES NOT — that five specific gaps the P1-11 handoff prose
 * describes as enforced, or does not mention at all, are measured against the
 * deployed DDL and enforced by nothing.
 *
 * ## Why a passing test that asserts a hole exists is worth having
 *
 * P1-22 compensates for each of these in application code. An application test
 * alone would show the mitigation working and would say nothing about whether the
 * mitigation is still NEEDED — so a later reader could reasonably conclude the
 * database had been fixed and drop the guard. These cases pin the residual
 * itself. If a future migration closes one of them, the corresponding case here
 * FAILS, which is the correct and useful signal: it says "the application guard is
 * now redundant, go and simplify it", and it says so loudly rather than leaving
 * dead defensive code in place for years.
 *
 * Every case below runs on the `app_runtime` login, inside a rolled-back
 * transaction, with the fixture tenant's real permissions. Nothing here executes
 * as an owner, because owner behaviour is never evidence about RLS or about what
 * the application role can do.
 *
 * The five residuals, and where each is compensated:
 *
 *   1. SB1  — a credit note in one currency is accepted against an invoice in
 *             another, approved, and subtracted from the gross.
 *             Compensated by `assertCurrencyMatches` (billing domain). P1-22-L-02.
 *   2. BR-SAL-002 — a raw INSERT into `sal.payment_allocations` is unbounded, so
 *             `Σ allocations` may exceed both the receipt and the invoice.
 *             Compensated by routing every allocation through
 *             `sal.allocate_receipt`. Change-control candidate CC-4.
 *   3. SB3  — no sequence row exists for an unprovisioned scope and `app_runtime`
 *             cannot create one, so invoice issue is unrecoverable from the
 *             application side. Compensated by a controlled configuration error
 *             plus an operator runbook. P1-22-L-03.
 *   4. P1-22-L-06 — `sal.partner_outstanding_balance` sums across currencies and
 *             returns one unlabelled scalar. Compensated by NOT exposing it.
 *   5. **The blind zero** — `sal.invoice_open_receivable` returns `0`, with no
 *             error, to a caller who cannot see its inputs. Not in the archaeology:
 *             found while implementing, and the most consequential of the five,
 *             because `0` is byte-identical to a settled invoice and the delivery
 *             gate that consumes it has no database backstop. Compensated by
 *             `balanceIsTrustworthy()` and by requiring `sal.finance.view` on both
 *             routes that read a balance.
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
  TENANT_A,
  COMPANY_A1,
  BRANCH_A1,
  USER_A,
} from './helpers';
import {
  seedP111Base,
  ctxA,
  expectFail,
  seedInvoiceWithLine,
  issueInvoice,
  seedReceipt,
  seedDraftInvoice,
  addInvoiceLine,
  makeWorkOrder,
  seedPartner,
  P11,
} from './p1-11-helpers';
import { P9 } from './p1-09-helpers';

const admin = adminPool();
const runtime = runtimePool();

const setUser = (c: { query: Client['query'] }, userId: string) =>
  c.query(`SELECT set_config('app.user_id',$1,true)`, [userId]);

beforeAll(async () => {
  await ensureTestLogins(admin);
  await ensureOrgFixtures(admin);
  await seedP111Base(admin);
});

afterAll(async () => {
  await cleanFixtures(admin);
  await runtime.end();
  await admin.end();
});

describe('P1-22 residual 1 (SB1) — credit-note currency equality is enforced by nothing', () => {
  it('accepts, approves, and subtracts a JOD credit note from a USD invoice', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // A USD invoice, issued, gross 100.0000 and nothing paid against it. USD is
      // the fixture default; the mismatch below is introduced on the credit note.
      const { invoice } = await seedInvoiceWithLine(c, 'sb1', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);

      const openBefore = (
        await c.query<{ o: string }>(`SELECT sal.invoice_open_receivable($1)::text AS o`, [invoice])
      ).rows[0]!.o;
      expect(openBefore).toBe('100.0000');

      // A credit note in a DIFFERENT currency. Nothing refuses it: five triggers
      // fire on sal.credit_notes and not one of them reads
      // sal.invoices.currency_code.
      const credit = (
        await c.query<{ id: string }>(
          `INSERT INTO sal.credit_notes
             (tenant_id, company_id, branch_id, invoice_id, currency_code, amount, reason, requested_by, created_by)
           VALUES ($1,$2,$3,$4,'JOD',40,'residual proof',$5,$5) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, invoice, USER_A]
        )
      ).rows[0]!.id;

      // It is stored with the mismatched currency intact.
      expect(
        (
          await c.query<{ cc: string }>(
            `SELECT currency_code AS cc FROM sal.credit_notes WHERE id=$1`,
            [credit]
          )
        ).rows[0]!.cc
      ).toBe('JOD');

      // And it APPROVES. sal.approve_credit_note compares the amount against the
      // open receivable and never compares the currency, so a different approver
      // completes dual control and the note becomes real.
      await setUser(c, P11.APPROVER_USER);
      await c.query(`SELECT sal.approve_credit_note($1)`, [credit]);
      await setUser(c, USER_A);

      expect(
        (
          await c.query<{ s: string }>(
            `SELECT approval_state AS s FROM sal.credit_notes WHERE id=$1`,
            [credit]
          )
        ).rows[0]!.s
      ).toBe('approved');

      // The consequence, which is the actual finding: 40 JOD has been subtracted
      // from a USD gross as though the two were the same unit. There is no
      // currency predicate anywhere in sal.invoice_open_receivable.
      const openAfter = (
        await c.query<{ o: string }>(`SELECT sal.invoice_open_receivable($1)::text AS o`, [invoice])
      ).rows[0]!.o;
      expect(openAfter).toBe('60.0000');
    });
  });

  it('accepts a reversal whose currency differs from its receipt', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const receipt = await seedReceipt(c, { amount: 75, payer: P9.SR, currency: 'USD' });

      // Same absence on the reversal side. The row is stored; only its approval is
      // bounded, and only by amount.
      const reversal = (
        await c.query<{ id: string }>(
          `INSERT INTO sal.receipt_reversals
             (tenant_id, company_id, branch_id, original_receipt_id, currency_code, amount, reason, requested_by, created_by)
           VALUES ($1,$2,$3,$4,'JOD',75,'residual proof',$5,$5) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, receipt, USER_A]
        )
      ).rows[0]!.id;

      const row = (
        await c.query<{ cc: string; st: string }>(
          `SELECT currency_code AS cc, approval_state AS st FROM sal.receipt_reversals WHERE id=$1`,
          [reversal]
        )
      ).rows[0]!;
      expect(row.cc).toBe('JOD');
      expect(row.st).toBe('pending');
    });
  });
});

describe('P1-22 residual 2 (BR-SAL-002) — only the primitive bounds the allocation sum', () => {
  it('accepts a raw allocation that exceeds BOTH the receipt and the invoice', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'brsal2', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      const receipt = await seedReceipt(c, { amount: 100, payer: P9.SR });

      // The primitive refuses this — sal-payments.test.ts already proves that.
      await expectFail(c, '23514', `SELECT sal.allocate_receipt($1,$2,500)`, [receipt, invoice]);

      // The table does not. app_runtime holds raw INSERT, and no constraint,
      // trigger or exclusion bounds the sum, so the same 500 lands.
      //
      // The financial event has to be written too, because
      // tg_payment_allocations_event_completeness is DEFERRED to COMMIT and would
      // otherwise refuse the row for a reason unrelated to the bound — and
      // sal.guard_financial_event_provenance binds the event's amount to the
      // allocation, so the event proves the 500 was accepted rather than masking it.
      const allocation = (
        await c.query<{ id: string }>(
          `INSERT INTO sal.payment_allocations
             (tenant_id, company_id, branch_id, receipt_id, invoice_id, currency_code, amount, allocated_by, created_by)
           VALUES ($1,$2,$3,$4,$5,'USD',500,$6,$6) RETURNING id`,
          [TENANT_A, COMPANY_A1, BRANCH_A1, receipt, invoice, USER_A]
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO sal.financial_events
           (tenant_id, company_id, branch_id, event_type, source_type, source_id, currency_code, amount, actor_id, created_by)
         VALUES ($1,$2,$3,'payment_allocated','payment_allocation',$4,'USD',500,$5,$5)`,
        [TENANT_A, COMPANY_A1, BRANCH_A1, allocation, USER_A]
      );

      expect(
        (
          await c.query<{ a: string }>(
            `SELECT amount::text AS a FROM sal.payment_allocations WHERE id=$1`,
            [allocation]
          )
        ).rows[0]!.a
      ).toBe('500.0000');

      // The derivations now report impossible values, which is what an unbounded
      // sum actually costs: a receipt of 100 with 400 more allocated than exists,
      // and an invoice whose open receivable has gone negative.
      const unallocated = (
        await c.query<{ u: string }>(`SELECT sal.receipt_unallocated($1)::text AS u`, [receipt])
      ).rows[0]!.u;
      expect(unallocated).toBe('-400.0000');

      const open = (
        await c.query<{ o: string }>(`SELECT sal.invoice_open_receivable($1)::text AS o`, [invoice])
      ).rows[0]!.o;
      expect(open).toBe('-400.0000');
    });
  });

  it('still holds the INSERT grant that makes the bypass possible', async () => {
    // The structural half of the same finding. If this grant is ever revoked the
    // case above stops being reachable, and the application-layer prohibition
    // becomes belt-and-braces rather than the only defence.
    const { rows } = await admin.query<{ priv: string }>(
      `SELECT privilege_type AS priv
         FROM information_schema.role_table_grants
        WHERE grantee = 'app_runtime'
          AND table_schema = 'sal'
          AND table_name = 'payment_allocations'
        ORDER BY privilege_type`
    );
    expect(rows.map((r) => r.priv)).toEqual(['INSERT', 'SELECT']);
  });
});

describe('P1-22 residual 3 (SB3) — numbering cannot be repaired from the application', () => {
  it('raises no_data_found for a scope with no sequence row', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // A branch the fixture never provisioned. USER_A holds an UNSCOPED grant, so
      // iam.allowed_branch_ids() is NULL and the function's scope check is skipped
      // — the failure is therefore the missing row and not an authorization
      // refusal, which is the distinction the error mapping depends on.
      await expectFail(c, 'P0002', `SELECT * FROM shared.next_display_number('invoice',$1,$2)`, [
        COMPANY_A1,
        '00000000-0000-4000-8000-0000000000ff',
      ]);
    });
  });

  it('refuses app_runtime the INSERT that would repair it', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      // 42501 rather than a policy refusal: the grant itself is absent, so this is
      // not something an RLS policy change could enable either.
      await expectFail(
        c,
        '42501',
        `INSERT INTO shared.number_sequences
           (tenant_id, company_id, branch_id, sequence_code, prefix_template, pad_width, created_by)
         VALUES ($1,$2,$3,'invoice','INV-',6,$4)`,
        [TENANT_A, COMPANY_A1, '00000000-0000-4000-8000-0000000000ff', USER_A]
      );
    });
  });

  it('consumes no number when the issue fails', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const readNext = async (): Promise<string> =>
        (
          await c.query<{ n: string }>(
            `SELECT next_value::text AS n FROM shared.number_sequences
              WHERE tenant_id=$1 AND sequence_code='invoice'
                AND company_id IS NOT DISTINCT FROM $2 AND branch_id IS NOT DISTINCT FROM $3`,
            [TENANT_A, COMPANY_A1, BRANCH_A1]
          )
        ).rows[0]!.n;

      const before = await readNext();

      // An invoice with no lines. sal.issue_invoice aggregates its lines, finds
      // zero, and raises BEFORE it reaches the allocator.
      const { wo } = await makeWorkOrder(c, 'sb3nolines');
      const payer = await seedPartner(c, 'sb3nolines');
      const invoice = await seedDraftInvoice(c, { wo, payer });
      await expectFail(c, '23514', `SELECT sal.issue_invoice($1)`, [invoice]);

      // The counter has not moved, and the invoice carries no number. This is the
      // one guarantee the platform genuinely makes about gaplessness: the
      // allocation and the business write share a transaction, so a failed issue
      // takes the counter advance with it.
      expect(await readNext()).toBe(before);
      const row = (
        await c.query<{ st: string; num: string | null }>(
          `SELECT status AS st, invoice_number AS num FROM sal.invoices WHERE id=$1`,
          [invoice]
        )
      ).rows[0]!;
      expect(row.st).toBe('draft');
      expect(row.num).toBeNull();
    });
  });
});

describe('P1-22 residual 5 — the open receivable returns 0, not an error, when it cannot see', () => {
  /**
   * The most consequential residual of the five, and the reason it is here rather
   * than only in the application suite.
   *
   * `sal.invoice_open_receivable` is `SECURITY INVOKER`, and **all three of its
   * inputs are gated by `iam.has_permission('sal.finance.view')`** —
   * `sel_invoice_amounts_gated`, `sel_receipts_gated` /
   * `sel_payment_allocations_gated`, and `sel_credit_notes_gated`. A caller without
   * that permission does not get an error: the rows are simply invisible, so the
   * function computes `round(COALESCE(NULL, 0) − 0 − 0, 4)` and returns **0**.
   *
   * `0` is byte-identical to a fully settled invoice.
   *
   * Compose a delivery gate out of that and a delivery operator who may see invoices
   * but not money is waved through as though every invoice were paid — and
   * `sal.complete_delivery` checks no balance itself, so nothing downstream would
   * notice. That is the worst available failure mode for a handover gate: not a
   * refusal, not an error, but a confident wrong answer in the permissive direction.
   *
   * The application detects it structurally rather than by guessing: an ISSUED
   * invoice ALWAYS has an `sal.invoice_amounts` row, because
   * `sal.guard_invoice_totals_reconcile` is a DEFERRED constraint trigger that raises
   * at COMMIT for a non-draft invoice without one. So a NULL amounts row behind an
   * issued invoice cannot mean "no amounts exist" — it can only mean "you cannot see
   * them", and that distinction is what `balanceIsTrustworthy()` keys on. The billing
   * port then answers `hasOutstanding: true, balanceVisible: false` instead of a
   * false zero, and the delivery composition treats it as a blocker.
   *
   * Both P1-22 routes that consume the balance additionally require
   * `sal.finance.view`, so an authorized caller should never reach this path. It is
   * handled anyway, because a permission list is a declaration and this is a
   * behaviour.
   */
  it('returns 0 for an issued, wholly unpaid invoice when the caller lacks sal.finance.view', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'blindzero', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);

      // With the permission: the real figure.
      expect(
        (
          await c.query<{ o: string }>(`SELECT sal.invoice_open_receivable($1)::text AS o`, [
            invoice,
          ])
        ).rows[0]!.o
      ).toBe('100.0000');

      // The SAME invoice, the same transaction, a different actor — one who is an
      // active tenant-A user with no `sal.finance.view` grant.
      await setUser(c, P11.NOPERM_USER);

      // Not an error. Not null. Zero.
      expect(
        (
          await c.query<{ o: string }>(`SELECT sal.invoice_open_receivable($1)::text AS o`, [
            invoice,
          ])
        ).rows[0]!.o
      ).toBe('0.0000');

      // And the mechanism, asserted directly so the case above cannot be
      // misread as the function having a bug: the amounts row is INVISIBLE, while
      // the invoice header remains visible. That asymmetry is the whole finding —
      // `sal.invoices` is scope-gated only, `sal.invoice_amounts` is permission-gated.
      expect(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM sal.invoice_amounts WHERE invoice_id = $1`,
            [invoice]
          )
        ).rows[0]!.n
      ).toBe('0');
      expect(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM sal.invoices WHERE id = $1`,
            [invoice]
          )
        ).rows[0]!.n
      ).toBe('1');

      await setUser(c, USER_A);
    });
  });

  it('keeps the amounts row provably present, so an invisible zero cannot be an absent one', async () => {
    // The other half of `balanceIsTrustworthy`'s premise. If an issued invoice could
    // legitimately have no amounts row, a NULL would be ambiguous and the detection
    // would be a guess. `sal.guard_invoice_totals_reconcile` is what forbids it.
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const { invoice } = await seedInvoiceWithLine(c, 'amountsrow', { net: 100, tax: 0 });
      await issueInvoice(c, invoice);
      expect(
        (
          await c.query<{ n: string }>(
            `SELECT count(*)::text AS n FROM sal.invoice_amounts
              WHERE invoice_id = $1 AND deleted_at IS NULL`,
            [invoice]
          )
        ).rows[0]!.n
      ).toBe('1');
    });
  });
});

describe('P1-22 residual 4 (P1-22-L-06) — partner_outstanding_balance mixes currencies', () => {
  it('sums a USD and a JOD invoice into one unlabelled scalar', async () => {
    await withRolledBackTx(runtime, ctxA, async (c) => {
      const payer = await seedPartner(c, 'mixccy');

      const { invoice: usd } = await seedInvoiceWithLine(c, 'mixccy-usd', {
        net: 100,
        tax: 0,
        payer,
      });
      await issueInvoice(c, usd);

      // The JOD invoice is built by hand because `seedInvoiceWithLine` has no
      // currency parameter — it always uses the USD default. The line currency has
      // to match the header's or `sal.guard_invoice_line_frozen` refuses the line,
      // which is the one currency equality this schema DOES enforce.
      const { wo } = await makeWorkOrder(c, 'mixccy-jod');
      const jod = await seedDraftInvoice(c, { wo, payer, currency: 'JOD' });
      await addInvoiceLine(c, jod, { lineNumber: 1, net: 50, tax: 0, currency: 'JOD' });
      await issueInvoice(c, jod);

      // 100 USD + 50 JOD = "150.0000", in no currency at all. The function loops a
      // partner's issued invoices with no currency filter and returns a bare
      // numeric, so there is no shape in which this answer could be labelled.
      //
      // This is why P1-22 exposes no partner-balance operation: the aggregate is
      // not merely unlabelled at the API boundary, it is unlabellable at source.
      const total = (
        await c.query<{ t: string }>(`SELECT sal.partner_outstanding_balance($1)::text AS t`, [
          payer,
        ])
      ).rows[0]!.t;
      expect(total).toBe('150.0000');
    });
  });
});

describe('P1-22 residual 6 — the outbox policy is strictly weaker than the ledger it describes', () => {
  /**
   * This is the reason `receipt.recorded` and `payment.allocated` carry no amount.
   *
   * It is a residual rather than a defect: nothing in `sal` or `shared` prevents a
   * producer from putting restricted money in a payload, so the only control is the
   * application's discipline about what it writes. If a future migration adds a
   * permission predicate to the outbox's SELECT policy, this case fails and says so.
   */
  it('gates sal.receipts on sal.finance.view and shared.event_outbox on nothing but tenancy', async () => {
    const policies = await admin.query<{ tablename: string; qual: string }>(
      `SELECT tablename, coalesce(qual,'') AS qual
         FROM pg_policies
        WHERE schemaname IN ('sal','shared')
          AND tablename IN ('receipts','payment_allocations','event_outbox')
          AND cmd = 'SELECT'
        ORDER BY tablename, policyname`
    );

    const qualFor = (table: string): string => {
      const row = policies.rows.find((r) => r.tablename === table);
      if (row === undefined) throw new Error(`no SELECT policy on ${table}`);
      return row.qual;
    };

    // Both ledger tables carry the permission AND both scope predicates.
    for (const table of ['receipts', 'payment_allocations']) {
      const qual = qualFor(table);
      expect(qual, `${table} must require sal.finance.view`).toContain('sal.finance.view');
      expect(qual, `${table} must be company-scoped`).toContain('allowed_company_ids');
      expect(qual, `${table} must be branch-scoped`).toContain('allowed_branch_ids');
    }

    // The outbox carries neither. Asserted as an absence, which is the whole point: a
    // payload is readable by every principal in the tenant regardless of permission.
    const outbox = qualFor('event_outbox');
    expect(outbox).toContain('current_tenant_id');
    expect(outbox).not.toContain('has_permission');
    expect(outbox).not.toContain('allowed_company_ids');
    expect(outbox).not.toContain('allowed_branch_ids');

    // And `app_runtime` really can read the payload column, so the policy is the only
    // control standing between a consumer and whatever a producer wrote.
    const grant = await admin.query<{ n: string }>(
      `SELECT count(*)::text AS n
         FROM information_schema.column_privileges
        WHERE table_schema = 'shared' AND table_name = 'event_outbox'
          AND column_name = 'payload' AND grantee = 'app_runtime'
          AND privilege_type = 'SELECT'`
    );
    expect(grant.rows[0]!.n).toBe('1');
  });

  it('cannot compute receipt_unallocated without sal.finance.view, which is why it is not published', async () => {
    // `sal.receipt_unallocated` is SECURITY INVOKER, so it answers from the caller's own
    // visibility. Publishing its value in an outbox payload handed a derived financial
    // position to readers who cannot derive it — a strictly larger disclosure than the
    // stored amount, and the one field of the four that had no other source.
    const secdef = await admin.query<{ prosecdef: boolean }>(
      `SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'sal' AND p.proname = 'receipt_unallocated'`
    );
    expect(secdef.rows[0]!.prosecdef).toBe(false);
  });
});
