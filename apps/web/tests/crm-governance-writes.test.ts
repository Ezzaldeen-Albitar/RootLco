import { describe, expect, it } from 'vitest';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import {
  RECORDABLE_CONSENT_STATUSES,
  RESTRICTION_TYPES,
  ALERT_SEVERITIES,
  ALERT_TYPES,
  MIN_REASON,
  WRITE_PERMISSIONS,
  optionalText,
  validateAlert,
  validateConsent,
  validateRestriction,
  validateTag,
  validateText,
} from '@/features/crm/customers/governance-contract';

/**
 * The six customer component writes (`FE-009`…`FE-014`).
 *
 * The headline claim is the one `P1-27-INT-003` exists for: every one of these
 * six operations is registered `idempotent: true`, **one of them is a PUT**, and
 * the client must send a key for all six. Before that fix the key came from the
 * HTTP method, so the PUT answered `400 ERR-INT-002` before authorization on
 * every attempt while the five POSTs beside it worked.
 */

const CUSTOMER = '/api/v1/customers/2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f';

const WRITES = [
  { method: 'POST', path: `${CUSTOMER}/notes`, id: 'crm.note-add' },
  { method: 'POST', path: `${CUSTOMER}/alerts`, id: 'crm.alert-raise' },
  { method: 'POST', path: `${CUSTOMER}/tags`, id: 'crm.tag-assign' },
  { method: 'POST', path: `${CUSTOMER}/restrictions`, id: 'crm.restriction-impose' },
  { method: 'POST', path: `${CUSTOMER}/consents`, id: 'crm.consent-record' },
  { method: 'PUT', path: `${CUSTOMER}/preferences`, id: 'crm.preference-set' },
] as const;

describe('the contract-derived idempotency authority covers all six writes', () => {
  it.each(WRITES)('resolves $method $path to $id', ({ method, path, id }) => {
    // Not "an operation was found" — THE operation. A resolver that matched the
    // parameter segment before the literal one would return a different id here
    // and still look like it worked.
    expect(resolveOperation(method, path)?.operationId).toBe(id);
  });

  it.each(WRITES)('requires a key for $method $path', ({ method, path }) => {
    expect(requiresIdempotencyKey(method, path)).toBe(true);
  });

  it('requires a key for the PUT, which is the whole point of P1-27-INT-003', () => {
    // Pinned separately and named, because this single assertion is the one that
    // would have caught the original defect. Deriving from the method makes it
    // false; deriving from the contract makes it true.
    expect(requiresIdempotencyKey('PUT', `${CUSTOMER}/preferences`)).toBe(true);
  });

  it('does not require a key on the reads at the same paths', () => {
    // Same paths, different method. If the resolver keyed on path alone, every
    // one of these would demand a key on a GET.
    for (const { path } of WRITES) {
      expect(requiresIdempotencyKey('GET', path)).toBe(false);
    }
  });
});

describe('the six writes need six different permissions', () => {
  it('does not collapse them to one blanket write capability', () => {
    // A single `crm.customer.write` would be simpler and wrong: a role that may
    // add a note very often may not impose a restriction.
    const distinct = new Set(Object.values(WRITE_PERMISSIONS));
    expect(distinct.size).toBeGreaterThan(1);
    expect(WRITE_PERMISSIONS.note).not.toBe(WRITE_PERMISSIONS.restriction);
    expect(WRITE_PERMISSIONS.preference).not.toBe(WRITE_PERMISSIONS.consent);
  });

  it('names each permission exactly as the route registers it', () => {
    expect(WRITE_PERMISSIONS).toEqual({
      preference: 'crm.customer.profile.write',
      consent: 'crm.customer.consent.write',
      note: 'crm.customer.note.write',
      alert: 'crm.customer.governance.manage',
      tag: 'crm.customer.governance.manage',
      restriction: 'crm.customer.restriction.manage',
    });
  });
});

describe('consent offers only the statuses a client may record', () => {
  it('excludes expired', () => {
    // `expired` is reachable in the data and is a SYSTEM transition. Offering it
    // would let an operator retire a consent by declaring it expired, with none
    // of the evidence a real expiry carries.
    expect(RECORDABLE_CONSENT_STATUSES).toEqual(['granted', 'withdrawn']);
    expect(RECORDABLE_CONSENT_STATUSES as readonly string[]).not.toContain('expired');
  });

  it('rejects expired if a form supplies it anyway', () => {
    const errors = validateConsent({
      consentKind: 'marketing',
      channel: 'email',
      purpose: 'marketing',
      status: 'expired',
    });
    expect(errors.status).toBe('required');
  });
});

describe('length is measured on the trimmed value', () => {
  it('rejects a field of spaces as empty, not as long', () => {
    // The backend carries `btrim(...) <> ''` CHECK constraints, so whitespace is
    // empty there however long it looks here. Measuring untrimmed would let ten
    // spaces through as a ten-character restriction reason.
    expect(validateText('          ', { min: 10, max: 500, required: true })).toBe('required');
  });

  it('rejects a reason shorter than the route allows', () => {
    expect(validateRestriction({ restrictionType: 'no_credit', reason: 'no' }).reason).toBe(
      'tooShort'
    );
  });

  it('accepts a reason at exactly the minimum', () => {
    const reason = 'x'.repeat(MIN_REASON);
    expect(validateRestriction({ restrictionType: 'no_credit', reason }).reason).toBeUndefined();
  });

  it('turns an empty optional field into undefined, never an empty string', () => {
    // `.strict()` schemas type these `.min(1).optional()`. Sending `''` is a 422
    // the operator cannot act on; omitting the key is the supported request.
    expect(optionalText('   ')).toBeUndefined();
    expect(optionalText(' FLEET ')).toBe('FLEET');
  });
});

describe('vocabularies match the CHECK constraints, not a guess', () => {
  it('offers exactly the alert types and severities the constraint admits', () => {
    expect([...ALERT_TYPES]).toEqual(['operational', 'financial', 'safety', 'other']);
    expect([...ALERT_SEVERITIES]).toEqual(['info', 'warning', 'critical']);
  });

  it('offers exactly the restriction types the constraint admits', () => {
    expect([...RESTRICTION_TYPES]).toEqual([
      'no_credit',
      'prepay_only',
      'no_service',
      'contact_restriction',
      'other',
    ]);
  });

  it('rejects a value outside the vocabulary', () => {
    // The first draft of these screens invented `credit_hold` and `payment`.
    expect(validateAlert({ alertType: 'payment', severity: 'info', message: 'x' }).alertType).toBe(
      'required'
    );
    expect(
      validateRestriction({ restrictionType: 'credit_hold', reason: 'x'.repeat(20) })
        .restrictionType
    ).toBe('required');
  });
});

describe('tags', () => {
  it('requires a segment code of at least two characters', () => {
    expect(validateTag({ segmentCode: 'F' }).segmentCode).toBe('tooShort');
    expect(validateTag({ segmentCode: 'FLEET' }).segmentCode).toBeUndefined();
  });

  it('treats the display name as optional', () => {
    expect(validateTag({ segmentCode: 'FLEET', name: '' }).name).toBeUndefined();
  });
});
