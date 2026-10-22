/**
 * P1-32-PRE-OD-FD14 — the database-free half of the payer rule of ADR-023 D14:
 * what `sal.payment-allocate` decides before it ever calls the primitive, the
 * statement's rules, and the request schema.
 *
 * The end-to-end half — the trigger, the primitive, the audit records, the
 * security events — is `tests/backend/od-finance-third-party.test.ts` and
 * `tests/db/sal-third-party-allocations.test.ts`. These cases pin what those
 * cannot see cheaply: that another customer's invoice is refused and marked for the
 * record exactly once WITHOUT reaching the primitive; that the authority is asked
 * in the RECEIPT's company and branch; that a statement on the payer's own invoice
 * is refused on its field; that every field breaking a rule is named at once and
 * none of those is recorded as a refusal by rule. Each assertion fails if the
 * protection it names is removed.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppFailure } from '@api/server/errors/app-failure';
import { businessRefusalOf } from '@api/server/audit/business-refusals';
import type { DbHandle } from '@api/server/db/transaction';
import { PaymentService } from '@api/modules/payments/application/payment-service';
import {
  THIRD_PARTY_PERMISSION,
  THIRD_PARTY_RELATIONSHIPS,
  THIRD_PARTY_RULES,
  thirdPartyViolations,
} from '@api/modules/payments/domain/payments';
import type { PaymentsRepository } from '@api/modules/payments/data/payments-repository';
import { AllocateBody } from '@api/app/api/v1/payments/[paymentId]/allocations/route';

const TENANT = '0f140000-0000-4000-8000-00000000a001';
const USER = '0f140000-0000-4000-8000-00000000a002';
const RECEIPT = '0f140000-0000-4000-8000-00000000b001';
const INVOICE = '0f140000-0000-4000-8000-00000000b002';
const COMPANY = '0f140000-0000-4000-8000-00000000d001';
const BRANCH = '0f140000-0000-4000-8000-00000000d002';
const PAYER = '0f140000-0000-4000-8000-00000000f001';
const CUSTOMER = '0f140000-0000-4000-8000-00000000f002';

/** The invoice the billing port answers with; its customer is set per case. */
let invoicePayer = CUSTOMER;

vi.mock('@api/modules/billing', () => ({
  billingModule: () => ({
    read: {
      readInvoice: vi.fn(async () => ({
        invoice: {
          id: INVOICE,
          companyId: COMPANY,
          branchId: BRANCH,
          status: 'issued',
          currency: 'USD',
          payerPartnerId: invoicePayer,
        },
      })),
      readOutstanding: vi.fn(async () => ({
        invoiceId: INVOICE,
        status: 'issued',
        outstanding: { amount: '100.0000', currency: 'USD', minorUnit: 2 },
      })),
    },
  }),
}));

/** A handle whose permission query answers `holds` for the third-party code. */
function handle(holds: boolean): DbHandle & { readonly query: ReturnType<typeof vi.fn> } {
  return {
    context: {
      module: 'payments',
      operation: 'sal.payment-allocate',
      correlationId: '0f140000-0000-4000-8000-00000000e001',
      principal: { tenantId: TENANT, userId: USER },
    },
    depth: 0,
    query: vi.fn(async (sql: string) =>
      sql.includes('iam.has_permission_in_scope') ? { rows: [{ allowed: holds }] } : { rows: [] }
    ),
  } as unknown as DbHandle & { readonly query: ReturnType<typeof vi.fn> };
}

function repository() {
  return {
    findReceiptForUpdate: vi.fn(async () => ({
      id: RECEIPT,
      companyId: COMPANY,
      branchId: BRANCH,
      receiptNumber: '000014',
      paymentMethodId: '0f140000-0000-4000-8000-00000000c001',
      payerPartnerId: PAYER,
      currencyCode: 'USD',
      amount: '100.0000',
      receivedAt: new Date('2026-10-02T08:00:00Z'),
      evidenceDocumentVersionId: null,
      status: 'recorded',
      idempotencyKey: null,
      deletedAt: null,
      recordVersion: 1,
      replacesReceiptId: null,
    })),
    findAllocationByIdempotencyKey: vi.fn(async () => null),
    findCurrentReversal: vi.fn(async () => null),
    minorUnitForCurrency: vi.fn(async () => 2),
    receiptUnallocated: vi.fn(async () => ({ unallocated: '100.0000', currencyCode: 'USD' })),
    allocateReceipt: vi.fn(async () => ({ id: '0f140000-0000-4000-8000-0000000000aa' })),
  };
}

async function failureOf(run: () => Promise<unknown>): Promise<AppFailure> {
  try {
    await run();
  } catch (error) {
    if (error instanceof AppFailure) return error;
    throw error;
  }
  throw new Error('expected a refusal but the command succeeded');
}

const allowed = vi.fn(async () => undefined);

const INSURER = {
  relationship: 'insurer',
  authorisationReference: 'CLM-7',
  reason: 'Covered by the policy',
};

function allocate(
  repo: ReturnType<typeof repository>,
  db: DbHandle,
  thirdParty?: { relationship: string; authorisationReference: string; reason: string }
) {
  return new PaymentService(repo as unknown as PaymentsRepository).allocatePayment(
    db,
    {
      receiptId: RECEIPT,
      invoiceId: INVOICE,
      amount: '20.00',
      currencyCode: 'USD',
      ...(thirdParty === undefined ? {} : { thirdParty }),
    },
    allowed
  );
}

describe('D14 — another customer’s invoice, before the primitive', () => {
  it('refuses an allocation without a statement on the invoice, marked once, and never calls the primitive', async () => {
    invoicePayer = CUSTOMER;
    const repo = repository();
    const failure = await failureOf(() => allocate(repo, handle(true)));
    expect(failure.code).toBe('ERR-TRN-001');
    expect(failure.safeDetails.violations).toEqual([
      { path: 'body.invoiceId', rule: THIRD_PARTY_RULES.payerMismatch },
    ]);
    expect(businessRefusalOf(failure)).toEqual({
      entityType: 'sal.receipt',
      entityId: RECEIPT,
      rule: THIRD_PARTY_RULES.payerMismatch,
    });
    expect(repo.allocateReceipt).not.toHaveBeenCalled();
  });

  it('asks for the third-party code in the RECEIPT’s company and branch, and refuses a caller without it, marked once', async () => {
    invoicePayer = CUSTOMER;
    const repo = repository();
    const db = handle(false);
    const failure = await failureOf(() => allocate(repo, db, INSURER));
    expect(failure.code).toBe('ERR-IAM-001');
    expect(businessRefusalOf(failure)?.rule).toBe(THIRD_PARTY_RULES.permissionMissing);
    const asked = db.query.mock.calls.find(([sql]) =>
      String(sql).includes('iam.has_permission_in_scope')
    );
    expect(asked?.[1]).toEqual([THIRD_PARTY_PERMISSION, COMPANY, BRANCH]);
    expect(repo.allocateReceipt).not.toHaveBeenCalled();
  });

  it('names every broken field at once, records none of them as a refusal by rule, and books nothing', async () => {
    invoicePayer = CUSTOMER;
    const repo = repository();
    const failure = await failureOf(() =>
      allocate(repo, handle(true), {
        relationship: 'cousin',
        authorisationReference: ' ',
        reason: '',
      })
    );
    expect(failure.code).toBe('ERR-VAL-001');
    expect(failure.safeDetails.violations).toEqual([
      { path: 'body.thirdParty.relationship', rule: THIRD_PARTY_RULES.relationshipInvalid },
      { path: 'body.thirdParty.authorisationReference', rule: THIRD_PARTY_RULES.referenceRequired },
      { path: 'body.thirdParty.reason', rule: THIRD_PARTY_RULES.reasonRequired },
    ]);
    expect(businessRefusalOf(failure)).toBeUndefined();
    expect(repo.allocateReceipt).not.toHaveBeenCalled();
  });

  it('passes the trimmed statement to the primitive for a holder of the code', async () => {
    invoicePayer = CUSTOMER;
    const repo = repository();
    // The command goes on past the primitive; only the call into it is measured.
    await allocate(repo, handle(true), {
      relationship: 'employer',
      authorisationReference: '  PO-1  ',
      reason: '  The employer pays  ',
    }).catch(() => undefined);
    expect(repo.allocateReceipt).toHaveBeenCalledTimes(1);
    expect(repo.allocateReceipt.mock.calls[0]?.at(-1)).toEqual({
      relationship: 'employer',
      authorisationReference: 'PO-1',
      reason: 'The employer pays',
    });
  });
});

describe('D14 — the payer’s own invoice', () => {
  it('refuses a statement on it, on the statement, and never asks for the code', async () => {
    invoicePayer = PAYER;
    const repo = repository();
    const db = handle(true);
    const failure = await failureOf(() => allocate(repo, db, INSURER));
    expect(failure.code).toBe('ERR-VAL-001');
    expect(failure.safeDetails.violations).toEqual([
      { path: 'body.thirdParty', rule: THIRD_PARTY_RULES.samePayer },
    ]);
    expect(
      db.query.mock.calls.some(([sql]) => String(sql).includes('iam.has_permission_in_scope'))
    ).toBe(false);
    expect(repo.allocateReceipt).not.toHaveBeenCalled();
  });

  it('books an ordinary allocation with no statement and no third-party argument', async () => {
    invoicePayer = PAYER;
    const repo = repository();
    await allocate(repo, handle(false)).catch(() => undefined);
    expect(repo.allocateReceipt).toHaveBeenCalledTimes(1);
    expect(repo.allocateReceipt.mock.calls[0]?.at(-1)).toBeNull();
  });
});

describe('D14 — the statement’s rules', () => {
  it('fixes the relationship vocabulary at three', () => {
    expect([...THIRD_PARTY_RELATIONSHIPS]).toEqual(['insurer', 'employer', 'other']);
  });

  it('accepts a complete statement for each relationship', () => {
    for (const relationship of THIRD_PARTY_RELATIONSHIPS) {
      expect(thirdPartyViolations({ ...INSURER, relationship })).toEqual([]);
    }
  });

  it('names an unexplained other apart from a blank reason', () => {
    expect(thirdPartyViolations({ ...INSURER, relationship: 'other', reason: '  ' })).toEqual([
      { field: 'reason', rule: THIRD_PARTY_RULES.otherUnexplained },
    ]);
    expect(thirdPartyViolations({ ...INSURER, reason: '  ' })).toEqual([
      { field: 'reason', rule: THIRD_PARTY_RULES.reasonRequired },
    ]);
  });

  it('counts characters as the database does, and bounds the reference and the reason', () => {
    // 100 astral characters are 200 UTF-16 units and still 100 characters.
    expect(
      thirdPartyViolations({ ...INSURER, authorisationReference: '\u{1F600}'.repeat(100) })
    ).toEqual([]);
    expect(thirdPartyViolations({ ...INSURER, authorisationReference: 'R'.repeat(101) })).toEqual([
      { field: 'authorisationReference', rule: THIRD_PARTY_RULES.referenceRequired },
    ]);
    expect(thirdPartyViolations({ ...INSURER, reason: 'Y'.repeat(2001) })).toEqual([
      { field: 'reason', rule: THIRD_PARTY_RULES.reasonRequired },
    ]);
  });
});

describe('D14 — the request schema', () => {
  it('keeps the statement optional and closed', () => {
    const base = { invoiceId: INVOICE, amount: '10.00', currency: 'USD' };
    expect(AllocateBody.safeParse(base).success).toBe(true);
    expect(AllocateBody.safeParse({ ...base, thirdParty: INSURER }).success).toBe(true);
    expect(
      AllocateBody.safeParse({ ...base, thirdParty: { ...INSURER, authorisedBy: USER } }).success
    ).toBe(false);
    expect(
      AllocateBody.safeParse({ ...base, thirdParty: { relationship: 'insurer' } }).success
    ).toBe(false);
  });
});
