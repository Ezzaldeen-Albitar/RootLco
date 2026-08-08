import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';

/**
 * The validation the customer writes ACTUALLY run (`P1-27-FE-009`…`FE-014`,
 * `FE-007`, `FE-008`, and the coverage complaint recorded as `P1-27-FE-013`).
 *
 * ## What this replaces
 *
 * `governance-contract.ts` used to export `validateNote`, `validateAlert`,
 * `validateRestriction`, `validateTag`, `validatePreference` and
 * `validateConsent`, mirroring the route schemas — and no production code called
 * any of them. The suite that exercised them was credited as these tasks' test
 * coverage while asserting nothing about the shipped product: every one of those
 * assertions would have passed with the write features deleted.
 *
 * The mirrors are gone. This file tests the real thing.
 *
 * ## How
 *
 * The Zod schemas are module-private by construction — a `'use server'` module
 * may export only async functions — so they cannot be imported and asserted
 * directly. They CAN be driven: each action is called with real `FormData`, with
 * only the HTTP client mocked, and the returned `ActionState` carries the field
 * errors the form renders. That is the same boundary the operator meets.
 *
 * The client mock doubles as the load-bearing assertion for the good cases. A
 * request that never reached `send` did not validate successfully, however
 * cheerful the returned state looks, so the accepted cases assert on what was
 * actually sent rather than on the absence of errors.
 */

const send = vi.fn();
const client = { send };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const governance = await import('@/features/crm/customers/governance-actions');
const profile = await import('@/features/crm/customers/profile-actions');
const { MIN_REASON, MIN_SEGMENT_CODE } =
  await import('@/features/crm/customers/governance-contract');

const CUSTOMER = '2f1e0f6a-5c2d-4a5b-8f2c-1a2b3c4d5e6f';
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

/** The field errors a rejected write returns, or `{}` if it was not rejected. */
async function reject(
  action: (previous: never, data: FormData) => Promise<{ fieldErrors?: Record<string, string> }>,
  values: Record<string, string>
): Promise<Record<string, string>> {
  const state = await action(IDLE as never, form(values));
  // A write that reached the client was ACCEPTED. Asserting only on
  // `fieldErrors` would let a silently-successful write read as a rejection.
  expect(
    send,
    `expected ${JSON.stringify(values)} to be rejected before sending`
  ).not.toHaveBeenCalled();
  return state.fieldErrors ?? {};
}

/** The body a write actually sent, proving it validated rather than merely not failing. */
async function accept(
  action: (previous: never, data: FormData) => Promise<unknown>,
  values: Record<string, string>
): Promise<Record<string, unknown>> {
  await action(IDLE as never, form(values));
  expect(send, `expected ${JSON.stringify(values)} to be accepted`).toHaveBeenCalledTimes(1);
  return (send.mock.calls[0]?.[2] ?? {}) as Record<string, unknown>;
}

describe('a restriction reason is measured on the trimmed value', () => {
  it('rejects a field of spaces as empty rather than as long enough', async () => {
    // The backend carries `btrim(...) <> ''` CHECK constraints, so whitespace is
    // empty there however long it looks here. A schema measuring the untrimmed
    // string would let ten spaces through as a ten-character reason and be
    // refused by the database, with a 500-shaped error and no field to blame.
    const errors = await reject(governance.imposeRestrictionAction.bind(null, CUSTOMER) as never, {
      restrictionType: 'no_credit',
      reason: ' '.repeat(MIN_REASON + 5),
    });
    expect(errors.reason).toBeTruthy();
  });

  it('rejects a reason shorter than the route allows', async () => {
    const errors = await reject(governance.imposeRestrictionAction.bind(null, CUSTOMER) as never, {
      restrictionType: 'no_credit',
      reason: 'no',
    });
    expect(errors.reason).toBe('field.tooShort');
  });

  it('accepts a reason at exactly the minimum, and sends the trimmed value', async () => {
    const reason = 'x'.repeat(MIN_REASON);
    const body = await accept(governance.imposeRestrictionAction.bind(null, CUSTOMER) as never, {
      restrictionType: 'no_credit',
      reason: `  ${reason}  `,
    });
    expect(body.reason).toBe(reason);
  });
});

describe('an optional field is omitted, never sent blank', () => {
  it('drops an empty approval reference instead of sending an empty string', async () => {
    // The route types these `.min(1).optional()`. Sending `''` is a 422 the
    // operator cannot act on; omitting the key is the supported request.
    const body = await accept(governance.imposeRestrictionAction.bind(null, CUSTOMER) as never, {
      restrictionType: 'no_credit',
      reason: 'x'.repeat(MIN_REASON),
      approvalRef: '   ',
    });
    expect('approvalRef' in body).toBe(false);
  });

  it('sends a trimmed approval reference when one was given', async () => {
    const body = await accept(governance.imposeRestrictionAction.bind(null, CUSTOMER) as never, {
      restrictionType: 'no_credit',
      reason: 'x'.repeat(MIN_REASON),
      approvalRef: '  AR-42  ',
    });
    expect(body.approvalRef).toBe('AR-42');
  });
});

describe('tags', () => {
  it('requires a segment code of at least two characters', async () => {
    const errors = await reject(governance.assignTagAction.bind(null, CUSTOMER) as never, {
      segmentCode: 'F',
    });
    expect(errors.segmentCode).toBeTruthy();
    expect(MIN_SEGMENT_CODE).toBe(2);
  });

  it('accepts a two-character code and treats the display name as optional', async () => {
    const body = await accept(governance.assignTagAction.bind(null, CUSTOMER) as never, {
      segmentCode: 'FLEET',
      name: '',
    });
    expect(body.segmentCode).toBe('FLEET');
    expect('name' in body).toBe(false);
  });
});

describe('vocabularies are enforced by the write, not only listed by the contract', () => {
  it('refuses an alert type outside the CHECK constraint', async () => {
    // The first draft of these screens invented `payment` and `credit_hold`.
    const errors = await reject(governance.raiseAlertAction.bind(null, CUSTOMER) as never, {
      alertType: 'payment',
      severity: 'info',
      message: 'x',
    });
    expect(errors.alertType).toBeTruthy();
  });

  it('refuses a restriction type outside the CHECK constraint', async () => {
    const errors = await reject(governance.imposeRestrictionAction.bind(null, CUSTOMER) as never, {
      restrictionType: 'credit_hold',
      reason: 'x'.repeat(MIN_REASON),
    });
    expect(errors.restrictionType).toBeTruthy();
  });

  it('refuses a consent status a client may not record', async () => {
    // `expired` is reachable in the data and is a SYSTEM transition. Accepting it
    // would let an operator retire a consent by declaring it expired, with none
    // of the evidence a real expiry carries.
    const errors = await reject(governance.recordConsentAction.bind(null, CUSTOMER) as never, {
      consentKind: 'marketing',
      channel: 'email',
      purpose: 'marketing',
      status: 'expired',
    });
    expect(errors.status).toBeTruthy();
  });

  it('accepts the two statuses a client may record', async () => {
    for (const status of ['granted', 'withdrawn']) {
      send.mockClear();
      const body = await accept(governance.recordConsentAction.bind(null, CUSTOMER) as never, {
        consentKind: 'marketing',
        channel: 'email',
        purpose: 'marketing',
        status,
      });
      expect(body.status).toBe(status);
    }
  });
});

describe('a required free-text field is refused when empty', () => {
  it.each([
    ['addNoteAction', () => governance.addNoteAction.bind(null, CUSTOMER), { body: '   ' }, 'body'],
    [
      'raiseAlertAction',
      () => governance.raiseAlertAction.bind(null, CUSTOMER),
      { alertType: 'operational', severity: 'info', message: '  ' },
      'message',
    ],
    [
      'addContactAction',
      () => profile.addContactAction.bind(null, CUSTOMER),
      { channel: 'email', value: '  ' },
      'value',
    ],
    [
      'addAddressAction',
      () => profile.addAddressAction.bind(null, CUSTOMER),
      { addressType: 'billing', line1: '   ' },
      'line1',
    ],
  ])('%s refuses a blank %s', async (_name, build, values, field) => {
    const errors = await reject(build() as never, values as Record<string, string>);
    expect(errors[field as string]).toBe('field.required');
  });
});

describe('every field error a real write produces is translatable', () => {
  it('never returns a message that is not in both catalogues', async () => {
    /*
     * The point of `P1-27-FE-004`, asserted against the writes rather than
     * against the mapper. A key that resolves in neither catalogue renders as
     * itself — a dotted identifier under a form field — which is no better than
     * the English sentence it replaced, only stranger.
     */
    const cases: Array<[() => unknown, Record<string, string>]> = [
      [() => governance.addNoteAction.bind(null, CUSTOMER), { body: '' }],
      [
        () => governance.raiseAlertAction.bind(null, CUSTOMER),
        { alertType: 'nope', severity: 'nope', message: '' },
      ],
      [
        () => governance.imposeRestrictionAction.bind(null, CUSTOMER),
        { restrictionType: 'nope', reason: 'no' },
      ],
      [() => governance.assignTagAction.bind(null, CUSTOMER), { segmentCode: '' }],
      [
        () => governance.setPreferenceAction.bind(null, CUSTOMER),
        { channel: '', purpose: 'nope', preferredLocale: 'a' },
      ],
      [
        () => governance.recordConsentAction.bind(null, CUSTOMER),
        { consentKind: 'nope', channel: '', purpose: 'nope', status: 'nope' },
      ],
      [() => profile.addContactAction.bind(null, CUSTOMER), { channel: '', value: '' }],
      [() => profile.addAddressAction.bind(null, CUSTOMER), { addressType: '', line1: '' }],
    ];

    let asserted = 0;
    for (const [build, values] of cases) {
      send.mockClear();
      const errors = await reject(build() as never, values);
      // Each case must actually produce errors, or the loop proves nothing.
      expect(Object.keys(errors).length, JSON.stringify(values)).toBeGreaterThan(0);
      for (const message of Object.values(errors)) {
        expect(message in (en as Record<string, string>), `${message} missing from en`).toBe(true);
        expect(message in (ar as Record<string, string>), `${message} missing from ar`).toBe(true);
        asserted += 1;
      }
    }
    expect(asserted).toBeGreaterThan(8);
  });
});

describe('this file is not vacuous', () => {
  it('drives actions that really exist and really send', async () => {
    // If the actions were stubs, every `reject` above would pass by never
    // calling the client. One accepted write proves the path is live.
    const body = await accept(governance.addNoteAction.bind(null, CUSTOMER) as never, {
      body: 'Called about the invoice.',
    });
    expect(body.body).toBe('Called about the invoice.');
    expect(send.mock.calls[0]?.[0]).toBe('POST');
    expect(String(send.mock.calls[0]?.[1])).toContain(`/api/v1/customers/${CUSTOMER}/notes`);
  });

  it('no longer imports the mirrors it replaced', async () => {
    const contract = (await import('@/features/crm/customers/governance-contract')) as Record<
      string,
      unknown
    >;
    for (const gone of [
      'validateNote',
      'validateAlert',
      'validateRestriction',
      'validateTag',
      'validatePreference',
      'validateConsent',
      'validateText',
      'optionalText',
    ]) {
      expect(contract[gone], `${gone} is back`).toBeUndefined();
    }
  });
});
