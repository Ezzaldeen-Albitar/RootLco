import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  CAPACITY_KINDS,
  capacityDetailOf,
  failureMessageKey,
  failureMessageValues,
  refusalMessageKey,
  type ApiFailure,
} from '@/lib/api/client';
import { fromFailure } from '@/lib/forms/action-result';
import { formatMessage, getMessages, translateWithValues } from '@/i18n/get-messages';

/**
 * A capacity refusal names its ceiling (P1-32 preparation, organisation
 * administration).
 *
 * `ERR-CAP-001` and `ERR-CAP-002` are both 409s. Before this change every 409
 * other than `ERR-CON-001` read "this record cannot take that change", which is
 * true and useless: the administrator could not learn that the subscription
 * allowance was spent, how large it is, or who can raise it. The problem
 * document carries `capacity {kind, limit, used}`, so the message can say all
 * three — and the invitation form, which mapped every 409 to "an account already
 * exists", must not blame the address for a spent seat allowance.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

function conflict(code: string, extra: Record<string, unknown> = {}): ApiFailure {
  return {
    ok: false,
    kind: 'conflict',
    status: 409,
    problem: { code, ...extra },
    correlationId: 'corr-cap',
  };
}

describe('the capacity refusal message', () => {
  it('names each ceiling in words, with its limit and usage, in both languages', () => {
    for (const kind of CAPACITY_KINDS) {
      const failure = conflict('ERR-CAP-001', { capacity: { kind, limit: 2, used: 2 } });
      const key = refusalMessageKey(failure);
      expect(key).toBe(`capacity.reached.${kind}`);
      expect(EN[key], `${key} missing in en`).toContain('{limit}');
      expect(AR[key], `${key} missing in ar`).toContain('{used}');
      expect(failureMessageValues(failure)).toEqual({ limit: '2', used: '2' });
    }
  });

  it('renders the sentence the plan asked for', () => {
    const failure = conflict('ERR-CAP-001', { capacity: { kind: 'branches', limit: 2, used: 2 } });
    expect(
      translateWithValues(
        getMessages('en'),
        refusalMessageKey(failure),
        failureMessageValues(failure)
      )
    ).toBe(
      'Your subscription allows 2 branches and 2 are in use. Ask the platform owner to raise the limit.'
    );
  });

  it('still explains the refusal when the detail is missing, malformed or of an unknown kind', () => {
    const cases: readonly Record<string, unknown>[] = [
      {},
      { capacity: { kind: 'vehicles', limit: 1, used: 1 } },
      { capacity: { kind: 'users', limit: '1', used: 1 } },
      { capacity: null },
    ];
    for (const extra of cases) {
      const failure = conflict('ERR-CAP-001', extra);
      expect(refusalMessageKey(failure)).toBe('capacity.reached.unknown');
      expect(failureMessageValues(failure)).toBeUndefined();
      expect(capacityDetailOf(failure)).toBeNull();
    }
    expect(EN['capacity.reached.unknown']).not.toContain('{');
  });

  it('says the organisation is not active for ERR-CAP-002', () => {
    const failure = conflict('ERR-CAP-002');
    expect(refusalMessageKey(failure)).toBe('capacity.organisationInactive');
    expect(EN['capacity.organisationInactive']).toMatch(/^This organisation is not active/);
    expect(failureMessageValues(failure)).toBeUndefined();
  });

  it('leaves every other mapping exactly as it was', () => {
    // `failureMessageKey` itself is untouched: the capacity sentences are added
    // only on the refusal path that reaches a form.
    expect(failureMessageKey(conflict('ERR-CAP-001'))).toBe('state.conflict.blocked.title');
    expect(failureMessageKey(conflict('ERR-CAP-002'))).toBe('state.conflict.blocked.title');
    expect(refusalMessageKey(conflict('ERR-CON-001'))).toBe('state.conflict.title');
    expect(refusalMessageKey(conflict('ERR-RES-002'))).toBe('state.conflict.blocked.title');
    expect(
      refusalMessageKey({
        ok: false,
        kind: 'forbidden',
        status: 403,
        problem: { code: 'ERR-CAP-001' },
        correlationId: null,
      })
    ).toBe('state.denied.title');
    // Capacity detail on a code that is not the capacity code is ignored.
    expect(
      failureMessageValues(
        conflict('ERR-RES-002', { capacity: { kind: 'users', limit: 1, used: 1 } })
      )
    ).toBeUndefined();
  });
});

describe('fromFailure carries the values only with the message they belong to', () => {
  const failure = conflict('ERR-CAP-001', { capacity: { kind: 'companies', limit: 3, used: 3 } });

  it('attaches the values to the failure key', () => {
    const state = fromFailure(failure, 4);
    expect(state).toMatchObject({
      status: 'conflict',
      messageKey: 'capacity.reached.companies',
      messageValues: { limit: '3', used: '3' },
      correlationId: 'corr-cap',
      attempt: 4,
    });
  });

  it('never hands the values to an override sentence', () => {
    const state = fromFailure(failure, 1, 'state.denied.title');
    expect(state.messageKey).toBe('state.denied.title');
    expect(state.messageValues).toBeUndefined();
  });
});

describe('formatMessage', () => {
  it('fills known placeholders and leaves an unknown one visible', () => {
    expect(formatMessage('{used} of {limit}', { used: '1', limit: '5' })).toBe('1 of 5');
    expect(formatMessage('{used} of {limit}', { used: '1' })).toBe('1 of {limit}');
    expect(formatMessage('no values', undefined)).toBe('no values');
  });
});

// --- the invitation form ------------------------------------------------------

const send = vi.fn();
vi.mock('@/lib/api/server-client', () => ({ authorizedClient: async () => ({ send }) }));

const { inviteUserAction } = await import('@/features/administration/users/actions');

function inviteForm(): FormData {
  const form = new FormData();
  form.set('email', 'new.person@example.test');
  form.set('displayName', 'New Person');
  return form;
}

describe('the invitation form surfaces a spent seat allowance', () => {
  beforeEach(() => send.mockReset());

  it('names the user-seat ceiling instead of blaming the address', async () => {
    send.mockResolvedValue(
      conflict('ERR-CAP-001', { capacity: { kind: 'users', limit: 5, used: 5 } })
    );
    const state = await inviteUserAction({ status: 'idle' }, inviteForm());
    expect(state.messageKey).toBe('capacity.reached.users');
    expect(state.messageValues).toEqual({ limit: '5', used: '5' });
    expect(state.messageKey).not.toBe('users.invite.duplicate');
  });

  it('says the organisation is not active for ERR-CAP-002', async () => {
    send.mockResolvedValue(conflict('ERR-CAP-002'));
    const state = await inviteUserAction({ status: 'idle' }, inviteForm());
    expect(state.messageKey).toBe('capacity.organisationInactive');
  });

  it('keeps the duplicate-address sentence for a duplicate address', async () => {
    send.mockResolvedValue(conflict('ERR-RES-002'));
    const state = await inviteUserAction({ status: 'idle' }, inviteForm());
    expect(state.messageKey).toBe('users.invite.duplicate');
  });
});
