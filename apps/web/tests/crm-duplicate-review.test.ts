import { describe, expect, it } from 'vitest';
import { requiresIdempotencyKey, resolveOperation } from '@/lib/api/operation-contract';
import {
  DUPLICATE_DECISIONS,
  DUPLICATE_STATUSES,
  MAX_APPROVAL_REF,
  MIN_MERGE_REASON,
  TIMELINE_EVENT_TYPES,
  formatMatchScore,
  isActionable,
  pairMembers,
  validateMerge,
  validateReviewReason,
  type DuplicateCandidate,
} from '@/features/crm/customers/identity-contract';
import { CRM_PERMISSIONS } from '@/features/crm/permissions';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

/**
 * Customer timeline (`FE-015`) and duplicate/merge review (`FE-016`).
 *
 * The dangerous parts of this feature are not the table. They are:
 *   - a match score that is `numeric` and must never become a float,
 *   - a review endpoint that accepts ONE decision while the UI could imply two,
 *   - a merge whose direction is invertible and destroys the wrong customer,
 *   - two capabilities that must not be collapsed into one control.
 */

const CANDIDATE: DuplicateCandidate = {
  id: 'cand-1',
  partnerIdA: '11111111-1111-4111-8111-111111111111',
  displayNameA: 'Nadia Khoury',
  partnerIdB: '22222222-2222-4222-8222-222222222222',
  displayNameB: 'Nadia Khouri',
  matchScore: '0.875',
  matchBasis: { signals: [{ signal: 'name', weight: 0.6 }] },
  status: 'open',
  detectedAt: '2026-08-04T10:00:00.000Z',
  reviewedBy: null,
  reviewedAt: null,
};

describe('the match score is never parsed as a float', () => {
  /**
   * These values were CHOSEN by running the real implementation against a naive
   * `parseFloat(s)` + `Math.round(n * 100)` and keeping only the inputs where
   * the two disagree.
   *
   * That step was not optional. The first version of this block asserted
   * `0.875`, `0.5`, `1`, `0.005`, `0.004` and a 29-digit value — and a mutation
   * to the naive implementation **passed all of them**. Values that both
   * implementations agree on say nothing about why the string one exists.
   * `0.615` was in that first version labelled "the classic float case"; it is
   * not one, and both implementations return `62%`.
   */

  it('rounds a half-boundary the way decimal arithmetic does, not the way a float does', () => {
    // `0.145 * 100` is `14.499999999999998` in IEEE-754, so `Math.round` gives
    // 14. The exact decimal is 14.5, which rounds to 15. Reading the third
    // fractional digit as a CHARACTER gets this right; multiplying cannot.
    expect(formatMatchScore('0.145')).toBe('15%');
    expect(formatMatchScore('0.285')).toBe('29%');
    expect(formatMatchScore('0.575')).toBe('58%');
  });

  it('refuses trailing junk that parseFloat silently accepts', () => {
    // `parseFloat` stops at the first invalid character and returns what it
    // read, so all of these become a confident `50%`. A score is either a
    // decimal the database sent or it is not something to render as a number.
    expect(formatMatchScore('0.5abc')).toBeNull();
    expect(formatMatchScore('0.5; DROP TABLE x')).toBeNull();
    expect(formatMatchScore('0x10')).toBeNull();
  });

  it('refuses notations PostgreSQL numeric does not emit', () => {
    // `parseFloat` reads both of these happily. `numeric` renders `0.5`, never
    // `.5`, and never scientific notation in this range — so accepting them
    // would mean accepting a value that did not come from this column.
    expect(formatMatchScore('.5')).toBeNull();
    expect(formatMatchScore('1e-1')).toBeNull();
  });

  it('refuses an out-of-range score that a float rounds INTO range', () => {
    // `parseFloat('1.0000000000000000001')` is exactly `1`, so the naive
    // version reports a confident `100%` for a value that is not a valid 0..1
    // ratio at all. The string version can still see the final digit.
    expect(formatMatchScore('1.0000000000000000001')).toBeNull();
  });

  it('still renders the ordinary values correctly', () => {
    // Agreement with the naive version here is expected and fine — these are
    // the cases that carry no information about the implementation choice, and
    // they are asserted so a rewrite cannot break the common path.
    expect(formatMatchScore('0.875')).toBe('88%');
    expect(formatMatchScore('0.5')).toBe('50%');
    expect(formatMatchScore('1')).toBe('100%');
    expect(formatMatchScore('1.000')).toBe('100%');
    expect(formatMatchScore('  0.5  ')).toBe('50%');
  });

  it('carries a precision no float can hold', () => {
    expect(formatMatchScore('0.12345678901234567890123456789')).toBe('12%');
    expect(formatMatchScore('0.99999999999999999999')).toBe('100%');
  });

  it('returns null for a shape it does not understand, rather than guessing', () => {
    // A confident wrong number decides whether two real customers are combined.
    expect(formatMatchScore('')).toBeNull();
    expect(formatMatchScore('abc')).toBeNull();
    expect(formatMatchScore('2.5')).toBeNull();
    expect(formatMatchScore('-0.5')).toBeNull();
    expect(formatMatchScore('1.5')).toBeNull();
    expect(formatMatchScore('NaN')).toBeNull();
  });

  it('does not consume the exact value it was given', () => {
    // The formatter is not the only place the score exists. The caller still
    // holds the raw string and renders it when the format returns null.
    const exotic = '0.8750000000000000000001';
    expect(formatMatchScore(exotic)).toBe('88%');
    expect(exotic).toBe('0.8750000000000000000001');
  });
});

describe('review accepts exactly one decision', () => {
  it('offers dismissal and nothing else', () => {
    // `merged` is a STATUS a candidate reaches, not a decision this endpoint
    // accepts — that is `crm.customer-merge`, a different operation behind a
    // different permission. A second option here would send a value the strict
    // enum rejects and would imply the reviewer's capability covers merging.
    expect([...DUPLICATE_DECISIONS]).toEqual(['dismissed']);
  });

  it('does not confuse the decision vocabulary with the status vocabulary', () => {
    expect([...DUPLICATE_STATUSES]).toEqual(['open', 'dismissed', 'merged']);
    expect(DUPLICATE_STATUSES.length).toBeGreaterThan(DUPLICATE_DECISIONS.length);
    for (const decision of DUPLICATE_DECISIONS) {
      expect(DUPLICATE_STATUSES).toContain(decision);
    }
  });
});

describe('reviewing and merging are different capabilities', () => {
  it('uses two distinct permission codes', () => {
    // Dismissing a false pair is routine; combining two real customer records is
    // not. A UI that gated both on one code would hand every reviewer the
    // ability to destroy a record.
    expect(CRM_PERMISSIONS.duplicateReview).toBe('crm.customer.duplicate.review');
    expect(CRM_PERMISSIONS.merge).toBe('crm.customer.merge');
    expect(CRM_PERMISSIONS.duplicateReview).not.toBe(CRM_PERMISSIONS.merge);
  });

  it('routes them to two different operations', () => {
    const review = resolveOperation('POST', '/api/v1/customer-duplicates/cand-1/review');
    const merge = resolveOperation('POST', '/api/v1/customers/cust-1/merge');
    expect(review?.operationId).toBe('crm.duplicate-review');
    expect(merge?.operationId).toBe('crm.customer-merge');
  });

  it('requires an idempotency key on both', () => {
    // Both are `idempotent: true` and both are `auditClass: privileged`. A
    // retried merge that ran twice would be unrecoverable.
    expect(requiresIdempotencyKey('POST', '/api/v1/customer-duplicates/cand-1/review')).toBe(true);
    expect(requiresIdempotencyKey('POST', '/api/v1/customers/cust-1/merge')).toBe(true);
  });

  it('does not require one on the queue read', () => {
    // Proves the resolver discriminates rather than answering yes to everything.
    expect(requiresIdempotencyKey('GET', '/api/v1/customer-duplicates')).toBe(false);
  });
});

describe('the merge direction cannot be transposed', () => {
  it('exposes the pair as an ordered pair with no "duplicate" side', () => {
    const [a, b] = pairMembers(CANDIDATE);
    expect(a.id).toBe(CANDIDATE.partnerIdA);
    expect(b.id).toBe(CANDIDATE.partnerIdB);
    // A/B is the order the detector recorded and carries no meaning. Neither
    // member is labelled the original or the copy anywhere in the contract.
    expect(Object.keys(a)).toEqual(['id', 'name']);
  });

  it('requires a survivor', () => {
    expect(validateMerge({ approvalRef: 'AUTH-1' }).survivorId).toBe('field.required');
  });

  it('requires an approval reference, unlike a restriction', () => {
    // `crm.customer-merge` types `approvalRef` as `.min(1)` and NOT optional.
    // A merge redirects one real customer into another; the authorisation for it
    // is not optional.
    expect(validateMerge({ survivorId: CANDIDATE.partnerIdA }).approvalRef).toBe('field.required');
    expect(
      validateMerge({ survivorId: CANDIDATE.partnerIdA, approvalRef: '   ' }).approvalRef
    ).toBe('field.required');
  });

  it('rejects an over-long approval reference', () => {
    expect(
      validateMerge({
        survivorId: CANDIDATE.partnerIdA,
        approvalRef: 'x'.repeat(MAX_APPROVAL_REF + 1),
      }).approvalRef
    ).toBe('field.tooLong');
  });

  it('accepts a complete merge', () => {
    expect(validateMerge({ survivorId: CANDIDATE.partnerIdA, approvalRef: 'AUTH-1' })).toEqual({});
  });
});

describe('a settled candidate is not actionable', () => {
  it('treats only open candidates as decidable', () => {
    expect(isActionable(CANDIDATE)).toBe(true);
    expect(isActionable({ ...CANDIDATE, status: 'dismissed' })).toBe(false);
    expect(isActionable({ ...CANDIDATE, status: 'merged' })).toBe(false);
  });

  it('does not treat an unknown status as actionable', () => {
    // Fails closed. A status this build has not heard of must not unlock a
    // control that destroys a record.
    expect(isActionable({ ...CANDIDATE, status: 'under_appeal' })).toBe(false);
  });
});

describe('the dismissal reason is real, not paperwork', () => {
  it('requires at least ten characters', () => {
    expect(validateReviewReason('')).toBe('field.required');
    expect(validateReviewReason('   ')).toBe('field.required');
    expect(validateReviewReason('no')).toBe('field.tooShort');
    expect(validateReviewReason('x'.repeat(MIN_MERGE_REASON))).toBeNull();
  });

  it('measures the trimmed value', () => {
    // `btrim(reason) <> ''` on the backend. Ten spaces is not a ten-character
    // reason there, however long it looks here.
    expect(validateReviewReason(' '.repeat(20))).toBe('field.required');
  });
});

describe('every vocabulary has a label in both locales', () => {
  it('covers the timeline event types the CHECK constraint admits', () => {
    // `ck_timeline_events_type`. A missing key renders the raw key on screen.
    const missing = TIMELINE_EVENT_TYPES.filter(
      (v) => !(`crm.timelineEvent.${v}` in en) || !(`crm.timelineEvent.${v}` in ar)
    );
    expect(missing).toEqual([]);
  });

  it('covers the duplicate statuses', () => {
    const missing = DUPLICATE_STATUSES.filter(
      (v) => !(`crm.duplicateStatus.${v}` in en) || !(`crm.duplicateStatus.${v}` in ar)
    );
    expect(missing).toEqual([]);
  });

  it('has exactly the eight event types the constraint lists', () => {
    expect([...TIMELINE_EVENT_TYPES]).toEqual([
      'lifecycle_changed',
      'commercial_changed',
      'consent_changed',
      'blocked',
      'unblocked',
      'alert_raised',
      'merged',
      'communication_logged',
    ]);
  });
});
