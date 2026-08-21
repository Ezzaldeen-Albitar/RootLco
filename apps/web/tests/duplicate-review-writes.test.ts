import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

/**
 * The validation the duplicate DISMISSALS actually run (`P1-27-FE-016`,
 * `P1-27-FE-028`).
 *
 * ## What this replaces
 *
 * Both duplicate contracts exported a `validateReviewReason` that mirrored the
 * Zod `.min(MIN_REVIEW_REASON, 'field.tooShort')` in their own adapter, and
 * neither had a single production caller. Nine test assertions across two files
 * exercised those mirrors and were credited as the coverage for the one decision
 * these tasks are permitted to ship while `P1-OD-017` is open.
 *
 * That is `P1-27-FE-013` again, in the two files its sweep did not reach. The
 * customer contract even says, three lines above the mirror, that "a validator
 * with no call site is one edit away from a form, so it is removed rather than
 * left in place" — and then declared one.
 *
 * ## Why the dismissal matters
 *
 * Merge is absent under `P1-OD-017`, so dismissal is the ONLY decision either
 * queue can record. If its validation is unproven, nothing about either review
 * screen's write is proven.
 */

const send = vi.fn();
const client = { send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const crm = await import('@/features/crm/customers/identity-api');
const vehicles = await import('@/features/vehicles/duplicates-api');
const { MIN_MERGE_REASON } = await import('@/features/crm/customers/identity-contract');
const { MIN_REVIEW_REASON } = await import('@/features/vehicles/duplicates-contract');

const CANDIDATE = 'c1e2d3f4-0000-4000-8000-000000000001';
const IDLE = { status: 'idle' } as const;

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.append(k, v);
  return data;
}

beforeEach(() => {
  send.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
  send.mockResolvedValue({ ok: true, data: {}, correlationId: 'corr-1' });
});

/** The two dismissal writes, driven identically because they are the same shape. */
const REVIEWS = [
  {
    name: 'crm.duplicate-review',
    action: (values: Record<string, string>) =>
      crm.reviewDuplicateAction(CANDIDATE, IDLE as never, form(values)),
    min: MIN_MERGE_REASON,
  },
  {
    name: 'veh.vehicle-duplicate-review',
    action: (values: Record<string, string>) =>
      vehicles.reviewVehicleDuplicateAction(CANDIDATE, IDLE as never, form(values)),
    min: MIN_REVIEW_REASON,
  },
] as const;

describe('a dismissal reason is measured on the trimmed value', () => {
  it.each(REVIEWS)('$name rejects a reason of spaces as empty', async ({ action, min }) => {
    const state = await action({ decision: 'dismissed', reason: ' '.repeat(min + 5) });
    // A write that reached the client was ACCEPTED, so the absence of a field
    // error alone would not prove a rejection.
    expect(send).not.toHaveBeenCalled();
    expect(state.fieldErrors?.reason).toBeTruthy();
  });

  it.each(REVIEWS)('$name rejects a reason below the floor', async ({ action }) => {
    const state = await action({ decision: 'dismissed', reason: 'no' });
    expect(send).not.toHaveBeenCalled();
    expect(state.fieldErrors?.reason).toBe('field.tooShort');
  });

  it.each(REVIEWS)('$name accepts one at exactly the floor, trimmed', async ({ action, min }) => {
    const reason = 'x'.repeat(min);
    await action({ decision: 'dismissed', reason: `  ${reason}  ` });
    expect(send).toHaveBeenCalledTimes(1);
    const body = send.mock.calls[0]?.[2] as Record<string, unknown>;
    expect(body.reason).toBe(reason);
  });
});

describe('only a decision the contract admits is sent', () => {
  it.each(REVIEWS)('$name refuses an unknown decision', async ({ action, min }) => {
    const state = await action({ decision: 'obliterate', reason: 'x'.repeat(min) });
    expect(send).not.toHaveBeenCalled();
    expect(state.fieldErrors?.decision).toBeTruthy();
  });

  it.each(REVIEWS)('$name refuses "merged", which P1-OD-017 withholds', async ({ action, min }) => {
    // The affordance is absent from the screen; the ADAPTER must refuse it too,
    // or the absence is only a matter of which button was rendered.
    const state = await action({ decision: 'merged', reason: 'x'.repeat(min) });
    expect(send).not.toHaveBeenCalled();
    expect(state.fieldErrors?.decision).toBeTruthy();
  });
});

describe('every field error a dismissal produces is translatable', () => {
  it.each(REVIEWS)('$name returns keys both catalogues resolve', async ({ action }) => {
    const state = await action({ decision: '', reason: '' });
    const errors = state.fieldErrors ?? {};
    expect(Object.keys(errors).length, 'the case produced no errors to check').toBeGreaterThan(0);
    for (const message of Object.values(errors)) {
      expect(message in (en as Record<string, string>), `${message} missing from en`).toBe(true);
      expect(message in (ar as Record<string, string>), `${message} missing from ar`).toBe(true);
    }
  });
});

describe('the mirrors are gone', () => {
  it('neither contract exports a validator nothing calls', async () => {
    const crmContract = (await import('@/features/crm/customers/identity-contract')) as Record<
      string,
      unknown
    >;
    const vehContract = (await import('@/features/vehicles/duplicates-contract')) as Record<
      string,
      unknown
    >;
    expect(crmContract.validateReviewReason, 'the CRM mirror is back').toBeUndefined();
    expect(vehContract.validateReviewReason, 'the vehicle mirror is back').toBeUndefined();
  });

  it('the bounds they mirrored are still exported, because the schemas use them', () => {
    expect(typeof MIN_MERGE_REASON).toBe('number');
    expect(typeof MIN_REVIEW_REASON).toBe('number');
  });
});

describe('this file is not vacuous', () => {
  it('drives writes that really reach the client', async () => {
    await REVIEWS[0].action({ decision: 'dismissed', reason: 'x'.repeat(MIN_MERGE_REASON) });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toBe('POST');
    expect(String(send.mock.calls[0]?.[1])).toContain(CANDIDATE);
  });
});
