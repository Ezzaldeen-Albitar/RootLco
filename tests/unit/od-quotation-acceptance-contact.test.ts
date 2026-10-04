/**
 * P1-32-PRE-OD-FD11 — the contact an acceptance record keeps (ADR-023 D11), without
 * a database.
 *
 * The domain rule: a typed name is trimmed and refused when blank or too long; a
 * telephone number is normalised the way every other number in the platform is
 * (Arabic-Indic digits folded, a leading + kept, other characters dropped) and
 * refused outside 3 to 20 digits; nothing is filled in when nothing was given; and a
 * contact on a rejection, or on an approval of one line that does not complete the
 * acceptance, is refused rather than silently lost. The two decision
 * routes accept exactly these two optional fields beside their existing body and
 * refuse anything else, because their schemas are strict.
 */
import { describe, expect, it } from 'vitest';
import { normalizePhoneDigits } from '@api/shared/text/normalization';
import {
  AcceptanceContactError,
  MAX_CONTACT_NAME,
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
