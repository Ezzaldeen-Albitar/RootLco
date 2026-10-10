/**
 * P1-32-PRE-OD-FD2A — the database-free half of recording refusals by business
 * rule (ADR-023, D12): the seam a service marks a refusal with, and the one line
 * that is written for it.
 *
 * The end-to-end half — the record surviving the rollback, one row per refused
 * attempt, none for a success — is `tests/backend/od-finance-credit-decisions.test.ts`.
 * These cases pin what that half cannot see cheaply: that the mark never changes
 * the failure, that the detail carries nothing but four closed identifiers, and
 * that a part which could carry caller text is refused rather than written.
 *
 * Each assertion is written so it fails if the protection it names is removed.
 */
import { describe, expect, it } from 'vitest';
import type { QueryResultRow } from 'pg';
import {
  BUSINESS_REFUSAL_EVENT,
  businessRefusalDetail,
  businessRefusalOf,
  recordBusinessRefusal,
  withBusinessRefusal,
} from '@api/server/audit/business-refusals';
import { AppFailure } from '@api/server/errors/app-failure';
import { __resetCapabilitiesForTests } from '@api/server/db/capabilities';
import type { DbHandle } from '@api/server/db/transaction';
import type { RequestContext } from '@api/server/context/request-context';
import { InvoiceService } from '@api/modules/billing/application/invoice-service';
import type { BillingRepository } from '@api/modules/billing/data/billing-repository';

const NOTE = '0f000000-0000-4000-8000-00000000c0de';
const TENANT = '0f000000-0000-4000-8000-00000000a001';
const ACTOR = '0f000000-0000-4000-8000-00000000a002';

/** A handle that answers the capability probes and records every statement. */
function fakeHandle(): { db: DbHandle; statements: { text: string; values: unknown[] }[] } {
  const statements: { text: string; values: unknown[] }[] = [];
  const context = {
    module: 'billing',
    operation: 'sal.credit-note-approve',
    correlationId: '0f000000-0000-4000-8000-00000000c001',
    principal: { tenantId: TENANT, userId: ACTOR },
  } as unknown as RequestContext;
  const db = {
    context,
    depth: 0,
    async query<R extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []) {
      statements.push({ text, values });
      if (text.includes('current_user AS role')) {
        return { rows: [{ role: 'app_runtime', bypassrls: false }] as unknown as R[] };
      }
      if (text.includes(' AS ok')) return { rows: [{ ok: true }] as unknown as R[] };
      return { rows: [] as R[] };
    },
  } as unknown as DbHandle;
  return { db, statements };
}

describe('D12 — marking a refusal never changes it', () => {
  it('returns the same failure, unchanged, and carries the refusal beside it', () => {
    const failure = new AppFailure('ERR-TRN-001', {
      message: 'self approval',
      safeDetails: {
        violations: [{ path: 'path.creditNoteId', rule: 'credit_note_self_approval' }],
      },
    });
    const marked = withBusinessRefusal(failure, {
      entityType: 'sal.credit_note',
      entityId: NOTE,
      rule: 'credit_note_self_approval',
    });
    expect(marked).toBe(failure);
    expect(marked.code).toBe('ERR-TRN-001');
    expect(marked.safeDetails).toEqual({
      violations: [{ path: 'path.creditNoteId', rule: 'credit_note_self_approval' }],
    });
    expect(businessRefusalOf(marked)).toEqual({
      entityType: 'sal.credit_note',
      entityId: NOTE,
      rule: 'credit_note_self_approval',
    });
  });

  it('reads no refusal from an unmarked failure or from anything that is not an object', () => {
    expect(businessRefusalOf(new AppFailure('ERR-TRN-001'))).toBeUndefined();
    expect(businessRefusalOf('credit_note_self_approval')).toBeUndefined();
    expect(businessRefusalOf(null)).toBeUndefined();
  });
});

describe('D12 — the record carries four closed identifiers and nothing else', () => {
  it('writes operation, entity, rule and outcome as fixed keys', () => {
    expect(
      businessRefusalDetail({
        operationId: 'sal.credit-note-approve',
        entityType: 'sal.credit_note',
        entityId: NOTE.toUpperCase(),
        rule: 'credit_note_self_approval',
      })
    ).toBe(
      `operation=sal.credit-note-approve entity=sal.credit_note/${NOTE} ` +
        'rule=credit_note_self_approval outcome=refused'
    );
  });

  it('refuses to write a part that could carry caller text', () => {
    const base = {
      operationId: 'sal.credit-note-approve',
      entityType: 'sal.credit_note',
      entityId: NOTE,
      rule: 'credit_note_self_approval',
    };
    for (const hostile of [
      { ...base, entityId: 'not-a-uuid' },
      { ...base, entityId: `${NOTE} rule=forged` },
      { ...base, rule: 'Refund of 12.500 to a named person' },
      { ...base, rule: 'credit_note_self_approval outcome=approved' },
      { ...base, entityType: 'sal.credit_note name=someone' },
      { ...base, operationId: '' },
    ]) {
      expect(businessRefusalDetail(hostile), JSON.stringify(hostile)).toBeNull();
    }
  });

  it('writes one security event of its own type, with the session tenant and actor', async () => {
    __resetCapabilitiesForTests();
    const { db, statements } = fakeHandle();
    const outcome = await recordBusinessRefusal(db, {
      operationId: 'sal.credit-note-approve',
      entityType: 'sal.credit_note',
      entityId: NOTE,
      rule: 'credit_note_self_approval',
    });
    expect(outcome).toEqual({ logged: true, persisted: true });
    const inserts = statements.filter((s) => s.text.includes('INSERT INTO iam.security_events'));
    expect(inserts).toHaveLength(1);
    const [tenant, eventType, severity, actor, detail] = inserts[0]?.values ?? [];
    expect({ tenant, eventType, severity, actor }).toEqual({
      tenant: TENANT,
      eventType: BUSINESS_REFUSAL_EVENT,
      severity: 'warning',
      actor: ACTOR,
    });
    expect(detail).toBe(
      `operation=sal.credit-note-approve entity=sal.credit_note/${NOTE} ` +
        'rule=credit_note_self_approval outcome=refused'
    );
  });

  it('writes nothing at all for a refusal whose parts do not fit', async () => {
    __resetCapabilitiesForTests();
    const { db, statements } = fakeHandle();
    const outcome = await recordBusinessRefusal(db, {
      operationId: 'sal.credit-note-approve',
      entityType: 'sal.credit_note',
      entityId: 'free text',
      rule: 'credit_note_self_approval',
    });
    expect(outcome).toBeNull();
    expect(statements).toEqual([]);
  });
});

/**
 * Finance checkpoint DF-3. A credit-note REQUEST above what remains creditable
 * was refused with 409 and left no record; only the approval's ceiling refusal
 * was marked. The request has no note yet, so the mark names the invoice.
 */
describe('D12 — a credit-note request above what remains creditable is marked (DF-3)', () => {
  const INVOICE = '0f000000-0000-4000-8000-00000000b111';
  const invoiceRow = (status: string) => ({
    id: INVOICE,
    companyId: '0f000000-0000-4000-8000-00000000b001',
    branchId: '0f000000-0000-4000-8000-00000000b002',
    workOrderId: null,
    saleKind: 'counter_sale',
    quotationRevisionId: null,
    payerPartnerId: '0f000000-0000-4000-8000-00000000b003',
    currencyCode: 'JOD',
    status,
    invoiceNumber: status === 'issued' ? 'INV-000001' : null,
    issuedAt: null,
    idempotencyKey: null,
    recordVersion: 2,
    money: { netTotal: '49.3800', taxTotal: '0.0000', grossTotal: '49.3800' },
  });
  const serviceFor = (status: string) =>
    new InvoiceService({
      findInvoiceForUpdate: async () => invoiceRow(status),
      minorUnitForCurrency: async () => 3,
      // ADR-023 D2: the request is bounded by what the invoice can still be credited.
      creditCeiling: async () => ({ creditable: '49.3800', owed: '49.3800' }),
    } as unknown as BillingRepository);
  const refusalOf = async (status: string, amount: string): Promise<unknown> => {
    const { db } = fakeHandle();
    try {
      await serviceFor(status).requestCreditNote(
        db,
        { invoiceId: INVOICE, amount, reason: 'checkpoint probe' },
        async () => undefined
      );
    } catch (error) {
      return error;
    }
    throw new Error('the request was not refused');
  };

  it('marks the over-credit refusal with the invoice and the rule, and leaves the failure as it was', async () => {
    const error = await refusalOf('issued', '49.381');
    expect(error).toBeInstanceOf(AppFailure);
    expect((error as AppFailure).code).toBe('ERR-TRN-001');
    expect(businessRefusalOf(error)).toEqual({
      entityType: 'sal.invoice',
      entityId: INVOICE,
      rule: 'credit_note_exceeds_creditable',
    });
  });

  it('does not mark a refusal that is not the ceiling', async () => {
    // A draft has nothing to credit: refused, but not by the business rule D12 records.
    const error = await refusalOf('draft', '1.000');
    expect(error).toBeInstanceOf(AppFailure);
    expect(businessRefusalOf(error)).toBeUndefined();
  });
});
