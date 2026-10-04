/**
 * P1-32-PRE-OD-FD11 — the contact an acceptance record keeps (ADR-023 D11), without
 * a database.
 *
 * The domain rule: a typed name is trimmed and refused when blank or too long; a
 * telephone number is normalised the way every other number in the platform is
 * (Arabic-Indic digits folded, a leading + kept, other characters dropped) and
 * refused outside 3 to 20 digits; nothing is filled in when nothing was given; and a
 * contact on a rejection, or on an approval of one line that does not complete the
 * acceptance, is refused rather than silently lost; and so is a contact sent with a
 * decision already recorded (a line another call decided meanwhile, or a
 * whole-revision call that finds every line decided), which writes no record. The two decision
 * routes accept exactly these two optional fields beside their existing body and
 * refuse anything else, because their schemas are strict.
 */
import { describe, expect, it, vi } from 'vitest';
import { normalizePhoneDigits } from '@api/shared/text/normalization';
import { AppFailure } from '@api/server/errors/app-failure';
import type { DbHandle } from '@api/server/db/transaction';
import { QuotationDecisionService } from '@api/modules/quotation/application/quotation-decision-service';
import {
  AcceptanceContactError,
  MAX_CONTACT_NAME,
  assertContactNotOnReplay,
  assertContactReachesRecord,
  lineDecisionCompletesAcceptance,
  normalizeAcceptanceContact,
} from '@api/modules/quotation/domain/quotation';
import { Body as RevisionDecideBody } from '@api/app/api/v1/quotation-revisions/[revisionId]/decisions/route';
import { Body as ItemDecideBody } from '@api/app/api/v1/quotation-items/[quotationItemId]/decisions/route';

const contact = (input: { contactName?: string; contactPhone?: string }, decision = 'approved') =>
  normalizeAcceptanceContact(decision, input, normalizePhoneDigits);

function refusal(run: () => unknown): { field: string; rule: string } {
  try {
    run();
  } catch (cause) {
    if (cause instanceof AcceptanceContactError) return { field: cause.field, rule: cause.rule };
    throw cause;
  }
  throw new Error('expected a refusal');
}

describe('the acceptance contact', () => {
  it('keeps nothing when nothing was given', () => {
    expect(contact({})).toEqual({ contactName: null, contactPhone: null });
  });

  it('trims the name and normalises the telephone number, Arabic-Indic digits included', () => {
    expect(contact({ contactName: '  Sami Nasser ', contactPhone: '+٩٦٢ ٧٩-١٢٣ ٤٥٦٧' })).toEqual({
      contactName: 'Sami Nasser',
      contactPhone: '+962791234567',
    });
    expect(contact({ contactPhone: '(079) 123 4567' }).contactPhone).toBe('0791234567');
  });

  it('refuses a blank or over-long name', () => {
    expect(refusal(() => contact({ contactName: '   ' }))).toEqual({
      field: 'contactName',
      rule: 'blank',
    });
    expect(refusal(() => contact({ contactName: 'x'.repeat(MAX_CONTACT_NAME + 1) }))).toEqual({
      field: 'contactName',
      rule: 'too_big',
    });
    expect(contact({ contactName: 'x'.repeat(MAX_CONTACT_NAME) }).contactName).toHaveLength(
      MAX_CONTACT_NAME
    );
  });

  it.each(['call me', '12', '+', '1'.repeat(21), '+' + '1'.repeat(21)])(
    'refuses the telephone number %j',
    (phone) => {
      expect(refusal(() => contact({ contactPhone: phone }))).toEqual({
        field: 'contactPhone',
        rule: 'invalid_phone',
      });
    }
  );

  it('accepts 3 and 20 digits, the two ends of the stored shape', () => {
    expect(contact({ contactPhone: '123' }).contactPhone).toBe('123');
    expect(contact({ contactPhone: '+' + '9'.repeat(20) }).contactPhone).toBe('+' + '9'.repeat(20));
  });

  it('refuses an over-long typed number before normalising it', () => {
    expect(refusal(() => contact({ contactPhone: '1 '.repeat(25) }))).toEqual({
      field: 'contactPhone',
      rule: 'too_big',
    });
  });

  it('refuses a contact on a rejection, naming the box that carries it', () => {
    expect(refusal(() => contact({ contactName: 'Sami Nasser' }, 'rejected'))).toEqual({
      field: 'contactName',
      rule: 'acceptance_contact_on_rejection',
    });
    expect(refusal(() => contact({ contactPhone: '0791234567' }, 'rejected'))).toEqual({
      field: 'contactPhone',
      rule: 'acceptance_contact_on_rejection',
    });
    // A rejection with no contact is the ordinary case and is untouched.
    expect(contact({}, 'rejected')).toEqual({ contactName: null, contactPhone: null });
  });
});

describe('a contact only on the decision that completes the acceptance', () => {
  it('a line approval completes only when every other line is approved and none rejected', () => {
    expect(
      lineDecisionCompletesAcceptance('approved', {
        itemCount: 2,
        approvedCount: 1,
        rejectedCount: 0,
      })
    ).toBe(true);
    expect(
      lineDecisionCompletesAcceptance('approved', {
        itemCount: 1,
        approvedCount: 0,
        rejectedCount: 0,
      })
    ).toBe(true);
    // Another line still open.
    expect(
      lineDecisionCompletesAcceptance('approved', {
        itemCount: 3,
        approvedCount: 1,
        rejectedCount: 0,
      })
    ).toBe(false);
    expect(
      lineDecisionCompletesAcceptance('approved', {
        itemCount: 2,
        approvedCount: 0,
        rejectedCount: 0,
      })
    ).toBe(false);
    // A rejected line means no acceptance at all.
    expect(
      lineDecisionCompletesAcceptance('approved', {
        itemCount: 2,
        approvedCount: 0,
        rejectedCount: 1,
      })
    ).toBe(false);
    expect(
      lineDecisionCompletesAcceptance('rejected', {
        itemCount: 1,
        approvedCount: 0,
        rejectedCount: 0,
      })
    ).toBe(false);
    expect(
      lineDecisionCompletesAcceptance('approved', {
        itemCount: 0,
        approvedCount: 0,
        rejectedCount: 0,
      })
    ).toBe(false);
  });

  it('refuses a contact on an approval that does not complete, naming the box', () => {
    expect(
      refusal(() => assertContactReachesRecord({ contactName: 'First Caller' }, false))
    ).toEqual({ field: 'contactName', rule: 'acceptance_contact_not_completing' });
    expect(
      refusal(() => assertContactReachesRecord({ contactPhone: '0791234567' }, false))
    ).toEqual({ field: 'contactPhone', rule: 'acceptance_contact_not_completing' });
  });

  it('lets a completing contact through, and a decision with no contact either way', () => {
    expect(() => assertContactReachesRecord({ contactName: 'Sami Nasser' }, true)).not.toThrow();
    expect(() => assertContactReachesRecord({}, false)).not.toThrow();
  });
});

describe('a contact sent with a decision already recorded', () => {
  const TENANT = '0f000000-0000-4000-8000-0000000d1101';
  const USER = '0f000000-0000-4000-8000-0000000d1102';
  const COMPANY = '0f000000-0000-4000-8000-0000000d1103';
  const BRANCH = '0f000000-0000-4000-8000-0000000d1104';
  const QUOTATION = '0f000000-0000-4000-8000-0000000d1105';
  const REVISION = '0f000000-0000-4000-8000-0000000d1106';
  const LINE_1 = '0f000000-0000-4000-8000-0000000d1107';
  const LINE_2 = '0f000000-0000-4000-8000-0000000d1108';

  const db = {
    context: {
      module: 'quotation',
      operation: 'quo.item-decide',
      correlationId: '0f000000-0000-4000-8000-0000000d1109',
      principal: { tenantId: TENANT, userId: USER },
    },
    depth: 0,
    query: vi.fn(async () => ({ rows: [] })),
  } as unknown as DbHandle;

  const item = (id: string, lineNumber: number) => ({
    id,
    quotationRevisionId: REVISION,
    lineNumber,
    recordVersion: 1,
  });
  const approved = (id: string) => ({
    id: `${id.slice(0, -4)}aaaa`,
    quotationItemId: id,
    quotationRevisionId: REVISION,
    decision: 'approved',
    decisionChannel: 'phone',
    decidedAt: new Date('2026-10-04T08:00:00Z'),
    decidedBy: USER,
  });

  /** Both lines approved, and the quotation accepted, by earlier calls. */
  function repository() {
    const decided = new Map([
      [LINE_1, approved(LINE_1)],
      [LINE_2, approved(LINE_2)],
    ]);
    const revision = {
      id: REVISION,
      quotationId: QUOTATION,
      status: 'issued',
      revisionNumber: 1,
      expiresAt: null,
    };
    return {
      findItem: vi.fn(async (_db: DbHandle, id: string) => item(id, id === LINE_1 ? 1 : 2)),
      findRevision: vi.fn(async () => revision),
      lockRevision: vi.fn(async () => revision),
      lockQuotation: vi.fn(async () => ({
        id: QUOTATION,
        companyId: COMPANY,
        branchId: BRANCH,
        currentRevisionId: REVISION,
        payerPartnerRef: null,
        status: 'accepted',
        recordVersion: 4,
      })),
      serverNow: vi.fn(async () => new Date('2026-10-05T08:00:00Z')),
      listItems: vi.fn(async () => [item(LINE_1, 1), item(LINE_2, 2)]),
      findDecisionForItem: vi.fn(async (_db: DbHandle, id: string) => decided.get(id) ?? null),
      tallyDecisions: vi.fn(async () => ({ itemCount: 2, approvedCount: 2, rejectedCount: 0 })),
      recordItemDecision: vi.fn(),
      insertEvidence: vi.fn(),
      insertAcceptanceRecord: vi.fn(),
      updateQuotationStatus: vi.fn(),
      updateRevisionStatus: vi.fn(),
    };
  }

  async function failureOf(run: () => Promise<unknown>): Promise<AppFailure> {
    try {
      await run();
    } catch (cause) {
      if (cause instanceof AppFailure) return cause;
      throw cause;
    }
    throw new Error('expected a refusal');
  }

  const authorize = async (): Promise<void> => undefined;
  const contactBody = {
    decision: 'approved',
    channel: 'phone',
    contactName: 'Late Caller',
    contactPhone: '0791234567',
    presentedRevisionId: REVISION,
  };

  it('refuses it on a line another call decided meanwhile, writing nothing', async () => {
    const repo = repository();
    const service = new QuotationDecisionService(repo as never);
    const failure = await failureOf(() => service.decideItem(db, LINE_2, contactBody, authorize));
    expect(failure.code).toBe('ERR-VAL-001');
    expect(failure.safeDetails).toEqual({
      violations: [{ path: 'body.contactName', rule: 'acceptance_contact_already_recorded' }],
    });
    expect(repo.recordItemDecision).not.toHaveBeenCalled();
    expect(repo.insertAcceptanceRecord).not.toHaveBeenCalled();
  });

  it('refuses it on a whole-revision call that finds every line decided, writing nothing', async () => {
    const repo = repository();
    const service = new QuotationDecisionService(repo as never);
    const failure = await failureOf(() =>
      service.decideRevision(db, REVISION, { ...contactBody, contactName: undefined }, authorize)
    );
    expect(failure.code).toBe('ERR-VAL-001');
    expect(failure.safeDetails).toEqual({
      violations: [{ path: 'body.contactPhone', rule: 'acceptance_contact_already_recorded' }],
    });
    expect(repo.recordItemDecision).not.toHaveBeenCalled();
    expect(repo.insertAcceptanceRecord).not.toHaveBeenCalled();
  });

  it('still settles the same decision sent again with no contact', async () => {
    const repo = repository();
    const service = new QuotationDecisionService(repo as never);
    const settled = await service.decideItem(
      db,
      LINE_2,
      { decision: 'approved', channel: 'phone', presentedRevisionId: REVISION },
      authorize
    );
    expect(settled.decisionId).toBe(approved(LINE_2).id);
    expect(repo.recordItemDecision).not.toHaveBeenCalled();
  });

  it('names the box, and lets a call that writes a line through', () => {
    expect(refusal(() => assertContactNotOnReplay({ contactName: 'Late Caller' }, false))).toEqual({
      field: 'contactName',
      rule: 'acceptance_contact_already_recorded',
    });
    expect(() => assertContactNotOnReplay({ contactName: 'Sami Nasser' }, true)).not.toThrow();
    expect(() => assertContactNotOnReplay({}, false)).not.toThrow();
  });
});

describe('the decision routes accept the contact and nothing more', () => {
  const base = {
    decision: 'approved',
    channel: 'phone',
    presentedRevisionId: '44444444-4444-4444-8444-444444444444',
  };

  it.each([
    ['revision', RevisionDecideBody],
    ['item', ItemDecideBody],
  ] as const)(
    'the %s route takes contactName and contactPhone as optional strings',
    (_, schema) => {
      expect(schema.safeParse(base).success).toBe(true);
      expect(
        schema.safeParse({ ...base, contactName: 'Sami Nasser', contactPhone: '0791234567' })
          .success
      ).toBe(true);
      expect(schema.safeParse({ ...base, contactName: '' }).success).toBe(false);
      expect(
        schema.safeParse({ ...base, contactName: 'x'.repeat(MAX_CONTACT_NAME + 1) }).success
      ).toBe(false);
      expect(schema.safeParse({ ...base, contactPhone: 791234567 }).success).toBe(false);
      // Strict: a recorder or a time cannot be smuggled in beside them.
      expect(schema.safeParse({ ...base, recordedBy: 'someone' }).success).toBe(false);
      expect(schema.safeParse({ ...base, acceptedAt: '2026-10-01T00:00:00Z' }).success).toBe(false);
    }
  );
});
