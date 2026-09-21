import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { globSync } from 'tinyglobby';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * What the Platform Owner Console actually puts on the wire (P1-32-PRE-063).
 *
 * ## Why this file exists
 *
 * `platform-console.dom.test.tsx` replaces every action in
 * `@/features/platform/actions` with a stand-in, so it proves which control an
 * operator sees and which action a click calls — and says nothing at all about
 * the request that action builds. The same is true of the reads: the screens
 * are handed their rows. So the whole translation from an operator's input to a
 * platform operation was asserted nowhere.
 *
 * It is asserted here, with only the HTTP client replaced. The properties this
 * file protects:
 *
 *   - provisioning nests the four parts under the names the operation publishes,
 *     drops a blank optional field rather than sending an empty value, and sends
 *     a subscription or an activation only when one was asked for;
 *   - a refusal about `body.branch.code` lands on the BRANCH control, not on the
 *     company or the organisation, which share the leaf name `code`;
 *   - money crosses as the decimal STRING it was typed as, and an amount of zero
 *     never reaches the server;
 *   - a plan carries a price and a currency together or neither, an edit is
 *     guarded by the version the operator was looking at, and a cleared price,
 *     currency, term or end date is sent as a cleared value rather than omitted;
 *   - every write that names a record refuses an identifier that is not one,
 *     before it reaches the client;
 *   - a read names its subject in the path, sends a search term only once there
 *     is one, and refuses a malformed identifier without asking the server.
 *
 * The client stand-in doubles as the load-bearing assertion for the accepted
 * cases: a request that never reached `send` did not validate successfully,
 * however cheerful the returned state looks.
 *
 * Every value below is a value invented for this file.
 */

const send = vi.fn();
const get = vi.fn();
const client = { send, get };
const authorizedClient = vi.fn(async () => client as unknown);

vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: () => authorizedClient(),
}));

const actions = await import('@/features/platform/actions');
const reads = await import('@/features/platform/api');
const tableReads = await import('@/features/platform/table-reads');

const TENANT = '11111111-1111-4111-8111-111111111111';
const SUBSCRIPTION = '22222222-2222-4222-8222-222222222222';
const PLAN_ID = '33333333-3333-4333-8333-333333333333';
const CHARGE = '44444444-4444-4444-8444-444444444444';
const NOT_AN_ID = 'organisation-one';

type Body = Record<string, unknown>;

const okResult = (data: unknown = {}) => ({ ok: true, data, correlationId: 'corr-1' });

const violationFailure = (violations: ReadonlyArray<{ path: string; rule: string }>) => ({
  ok: false as const,
  kind: 'validation' as const,
  status: 422,
  problem: { violations },
  correlationId: 'corr-2',
});

beforeEach(() => {
  send.mockReset();
  get.mockReset();
  authorizedClient.mockReset();
  authorizedClient.mockResolvedValue(client as unknown);
  send.mockResolvedValue(okResult());
  get.mockResolvedValue(okResult({ items: [], nextCursor: null, hasMore: false }));
});

/** The arguments of the single request the action sent. */
function sent(): { method: string; path: string; body: Body; options: Body } {
  expect(send, 'no request was sent').toHaveBeenCalledTimes(1);
  const call = send.mock.calls[0] as unknown[];
  return {
    method: String(call[0]),
    path: String(call[1]),
    body: (call[2] ?? {}) as Body,
    options: (call[3] ?? {}) as Body,
  };
}

const PROVISION_FIELDS: Record<string, string> = {
  tenantCode: 'northern_workshops',
  tenantName: 'Northern Workshops',
  tenantLocale: 'en',
  tenantTimezone: 'Asia/Amman',
  companyCode: 'nw_main',
  companyLegalName: 'Northern Workshops Company',
  companyCurrency: 'jod',
  companyRegistration: '',
  companyTaxRegistration: '',
  branchCode: 'nw_central',
  branchName: 'Central branch',
  branchCity: '',
  branchCountry: 'jo',
  branchTimezone: 'Asia/Amman',
  ownerEmail: 'operations@northern-workshops.example',
  ownerDisplayName: 'Northern Workshops operations',
  planCode: '',
  subscriptionStart: '',
};

function provisionForm(overrides: Record<string, string> = {}): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries({ ...PROVISION_FIELDS, ...overrides })) {
    data.append(key, value);
  }
  return data;
}

const IDLE = { status: 'idle' } as const;

describe('provisioning builds the document the operation publishes', () => {
  it('nests the four parts, upper-cases the currency and the country, and drops a blank optional', async () => {
    const state = await actions.provisionOrganizationAction(IDLE as never, provisionForm());
    expect(state.status).toBe('success');
    const { method, path, body } = sent();
    expect(method).toBe('POST');
    expect(path).toBe('/api/v1/platform/organizations');
    expect(body.tenant).toEqual({
      code: 'northern_workshops',
      display_name: 'Northern Workshops',
      locale: 'en',
      timezone: 'Asia/Amman',
    });
    expect(body.company).toEqual({
      code: 'nw_main',
      legal_name: 'Northern Workshops Company',
      base_currency: 'JOD',
      registration_number: undefined,
      tax_registration_number: undefined,
    });
    expect(body.branch).toEqual({
      code: 'nw_central',
      name: 'Central branch',
      city: undefined,
      country_code: 'JO',
      timezone: 'Asia/Amman',
    });
    expect(body.owner).toEqual({
      email: 'operations@northern-workshops.example',
      displayName: 'Northern Workshops operations',
    });
    // Neither was asked for, so neither is sent — an absent subscription is not
    // an empty one, and an absent activation is not `activate: false`.
    expect('subscription' in body).toBe(false);
    expect('activate' in body).toBe(false);
  });

  it('sends a subscription and an activation only when they were asked for', async () => {
    const state = await actions.provisionOrganizationAction(
      IDLE as never,
      provisionForm({ planCode: 'standard_annual', subscriptionStart: '2026-10-01' })
    );
    expect(state.status).toBe('success');
    const { body } = sent();
    expect(body.subscription).toEqual({
      plan_code: 'standard_annual',
      effective_from: '2026-10-01',
    });
    expect('activate' in body).toBe(false);

    send.mockClear();
    await actions.provisionOrganizationAction(
      IDLE as never,
      provisionForm({ planCode: 'standard_annual', activate: 'on' })
    );
    expect(sent().body.activate).toBe(true);
  });

  it('refuses a start date with no plan, on the plan control', async () => {
    const state = await actions.provisionOrganizationAction(
      IDLE as never,
      provisionForm({ subscriptionStart: '2026-10-01' })
    );
    expect(state.status).toBe('invalid');
    expect(state.fieldErrors?.planCode).toBe('platform.error.required');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a currency that is not three letters, and never reaches the server', async () => {
    const state = await actions.provisionOrganizationAction(
      IDLE as never,
      provisionForm({ companyCurrency: 'jordan' })
    );
    expect(state.status).toBe('invalid');
    expect(state.fieldErrors?.companyCurrency).toBe('platform.error.currency');
    expect(send).not.toHaveBeenCalled();
  });

  it('places a refusal about a nested `code` on the control that owns it', async () => {
    // The wire document holds three fields called `code`. The leaf alone cannot
    // say which control refused, so a mapping that dropped to the leaf would put
    // the branch's refusal on the organisation's field.
    send.mockResolvedValue(
      violationFailure([
        { path: 'body.branch.code', rule: 'invalid_format' },
        { path: 'body.owner.email', rule: 'required' },
      ])
    );
    const state = await actions.provisionOrganizationAction(IDLE as never, provisionForm());
    expect(state.status).toBe('invalid');
    expect(state.fieldErrors?.branchCode).toBe('form.violation.invalid_format');
    expect(state.fieldErrors?.ownerEmail).toBe('form.violation.required');
    expect(state.fieldErrors?.tenantCode).toBeUndefined();
    expect(state.fieldErrors?.companyCode).toBeUndefined();
  });

  it('says an organisation with that code already exists, rather than repeating the server', async () => {
    send.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      problem: null,
      correlationId: 'corr-3',
    });
    const state = await actions.provisionOrganizationAction(IDLE as never, provisionForm());
    expect(state.status).toBe('conflict');
    expect(state.messageKey).toBe('platform.provision.conflict');
  });

  /*
   * A conflict the service DID explain.
   *
   * The fixed sentence above is right only when the refusal says nothing but
   * "this conflicts". The bootstrap service also refuses for reasons it names,
   * and every one of them was being replaced by that sentence on the way to the
   * screen — the operator was told an organisation like this already exists when
   * the real objection was about one field.
   *
   * `duplicate_code` stands in for the family of refusals about a code the
   * organisation document carries; it is used because the catalogue carries a
   * sentence for it TODAY, which is exactly what makes a token "known" here.
   * The refusal about the owner's address below is no longer a stand-in: the
   * bootstrap service publishes that token, and its sentence is in both
   * catalogues, so the case drives the real pair. Nothing here or in the
   * alignment gate is widened in advance to receive a token that has neither.
   */
  it('lets a reason the refusal named beat the fixed sentence', async () => {
    send.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      problem: { violations: [{ path: 'body.tenant.code', rule: 'duplicate_code' }] },
      correlationId: 'corr-3',
    });
    const state = await actions.provisionOrganizationAction(IDLE as never, provisionForm());
    expect(state.status).toBe('conflict');
    expect(state.messageKey).toBe('form.violation.duplicate_code');
    expect(state.fieldErrors?.tenantCode).toBe('form.violation.duplicate_code');
  });

  it('puts a refusal about the owner address beside the owner address', async () => {
    // The real pair the bootstrap service publishes: `body.email` rather than
    // `body.owner.email`, because the service names the address on its own when
    // it is the address it objects to, and that path had no control — so the
    // sentence was filed where no control could render it. The token is
    // deliberately one word for four readings of an address, which is why the
    // sentence it resolves to only tells the operator to use a different one.
    send.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      problem: {
        violations: [{ path: 'body.email', rule: 'platform_address_not_available' }],
      },
      correlationId: 'corr-3',
    });
    const state = await actions.provisionOrganizationAction(IDLE as never, provisionForm());
    expect(state.fieldErrors?.ownerEmail).toBe('form.violation.platform_address_not_available');
    expect(state.messageKey).toBe('form.violation.platform_address_not_available');
  });

  it('keeps the fixed sentence for a reason the catalogue cannot say', async () => {
    // A token with no sentence must NOT downgrade the banner to the generic
    // violation wording: "this value was not accepted" says less than the
    // sentence about an organisation that already exists.
    send.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      problem: { violations: [{ path: 'body.tenant.code', rule: 'a_token_with_no_sentence' }] },
      correlationId: 'corr-3',
    });
    const state = await actions.provisionOrganizationAction(IDLE as never, provisionForm());
    expect(state.messageKey).toBe('platform.provision.conflict');
    expect(state.fieldErrors?.tenantCode).toBe('form.violation.invalid');
  });

  it('carries the new organisation back so the screen can open it', async () => {
    send.mockResolvedValue(okResult({ tenantId: TENANT }));
    const state = await actions.provisionOrganizationAction(IDLE as never, provisionForm());
    expect(state.status).toBe('success');
    expect(state.tenantId).toBe(TENANT);
  });
});

describe('lifecycle and subscription writes name their subject and their act', () => {
  it('sends the new state with the reason it was given', async () => {
    const state = await actions.changeOrganizationStatusAction(
      TENANT,
      'suspended',
      'Payment overdue past the agreed term'
    );
    expect(state.status).toBe('success');
    const { method, path, body } = sent();
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/platform/organizations/${TENANT}/status`);
    expect(body).toEqual({ to: 'suspended', reason: 'Payment overdue past the agreed term' });
  });

  it('refuses a blank reason and an identifier that is not one', async () => {
    const blank = await actions.changeOrganizationStatusAction(TENANT, 'closed', '   ');
    expect(blank.status).toBe('invalid');
    expect(blank.fieldErrors?.reason).toBe('overlay.reasonRequired');

    const unknown = await actions.changeOrganizationStatusAction(NOT_AN_ID, 'closed', 'Closed');
    expect(unknown.status).toBe('invalid');
    expect(unknown.messageKey).toBe('state.notFound.message');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the act as `kind` and the term as a whole number of months', async () => {
    const state = await actions.assignSubscriptionAction(TENANT, {
      planCode: 'standard_annual',
      effectiveFrom: '2026-10-01',
      termMonths: 24,
      kind: 'upgraded',
      reason: 'Moving to the wider plan',
    });
    expect(state.status).toBe('success');
    const { path, body } = sent();
    expect(path).toBe(`/api/v1/platform/organizations/${TENANT}/subscriptions`);
    expect(body).toEqual({
      planCode: 'standard_annual',
      effectiveFrom: '2026-10-01',
      termMonths: 24,
      kind: 'upgraded',
      reason: 'Moving to the wider plan',
    });
  });

  it('refuses a part-month term, a malformed date and an act it does not publish', async () => {
    const fractional = await actions.assignSubscriptionAction(TENANT, {
      planCode: 'standard_annual',
      effectiveFrom: '2026-10-01',
      termMonths: 12.5,
      kind: 'assigned',
      reason: 'Start of the agreement',
    });
    expect(fractional.fieldErrors?.termMonths).toBe('platform.error.term');

    const date = await actions.assignSubscriptionAction(TENANT, {
      planCode: 'standard_annual',
      effectiveFrom: '01/10/2026',
      kind: 'assigned',
      reason: 'Start of the agreement',
    });
    expect(date.fieldErrors?.effectiveFrom).toBe('platform.error.date');

    const kind = await actions.assignSubscriptionAction(TENANT, {
      planCode: 'standard_annual',
      effectiveFrom: '2026-10-01',
      kind: 'paused' as never,
      reason: 'Start of the agreement',
    });
    expect(kind.status).toBe('invalid');
    expect(send).not.toHaveBeenCalled();
  });

  it('cancels under the subscription it was given, and refuses one that is not an identifier', async () => {
    const state = await actions.cancelSubscriptionAction(TENANT, SUBSCRIPTION, {
      effectiveTo: '2026-12-31',
      reason: 'The organisation is not renewing',
    });
    expect(state.status).toBe('success');
    expect(sent().path).toBe(
      `/api/v1/platform/organizations/${TENANT}/subscriptions/${SUBSCRIPTION}/cancellation`
    );

    send.mockClear();
    const unknown = await actions.cancelSubscriptionAction(TENANT, NOT_AN_ID, {
      effectiveTo: '2026-12-31',
      reason: 'The organisation is not renewing',
    });
    expect(unknown.messageKey).toBe('state.notFound.message');
    expect(send).not.toHaveBeenCalled();
  });
});

/*
 * The four growth acts (P1-32-PRE-151). `platform-organization-growth.dom.test.tsx`
 * replaces this whole module, so it proves which dialog calls which action and
 * nothing about the document that action builds. These cases hold the other half:
 * the path each act addresses, the mode the two administrator acts share one
 * operation by, and the optional fields that are dropped rather than sent empty.
 */
describe('growing a live organisation addresses the organisation it names', () => {
  it('adds a company under the organisation, dropping a registration that was left blank', async () => {
    const state = await actions.addCompanyAction(TENANT, {
      code: 'nw_second',
      legalName: 'Northern Workshops Second Company',
      baseCurrency: 'JOD',
    });
    expect(state.status).toBe('success');
    const { method, path, body } = sent();
    expect(method).toBe('POST');
    expect(path).toBe(`/api/v1/platform/organizations/${TENANT}/companies`);
    expect(body).toEqual({
      code: 'nw_second',
      legalName: 'Northern Workshops Second Company',
      baseCurrency: 'JOD',
    });
  });

  it('carries a registration and a tax registration when they were given', async () => {
    await actions.addCompanyAction(TENANT, {
      code: 'nw_third',
      legalName: 'Northern Workshops Third Company',
      baseCurrency: 'JOD',
      registrationNumber: 'REG-3',
      taxRegistrationNumber: 'TAX-3',
    });
    expect(sent().body).toEqual({
      code: 'nw_third',
      legalName: 'Northern Workshops Third Company',
      baseCurrency: 'JOD',
      registrationNumber: 'REG-3',
      taxRegistrationNumber: 'TAX-3',
    });
  });

  it('refuses a company code the catalogue cannot hold and an organisation that is not one', async () => {
    const code = await actions.addCompanyAction(TENANT, {
      code: 'Second Company',
      legalName: 'Northern Workshops Second Company',
      baseCurrency: 'JOD',
    });
    expect(code.status).toBe('invalid');
    expect(code.fieldErrors?.code).toBe('platform.error.required');

    const unknown = await actions.addCompanyAction(NOT_AN_ID, {
      code: 'nw_second',
      legalName: 'Northern Workshops Second Company',
      baseCurrency: 'JOD',
    });
    expect(unknown.messageKey).toBe('state.notFound.message');
    expect(send).not.toHaveBeenCalled();
  });

  it('opens a branch under the company it names, dropping a blank city', async () => {
    const state = await actions.addBranchAction(TENANT, {
      companyId: SUBSCRIPTION,
      code: 'nw_north',
      name: 'Northern branch',
      timezone: 'Asia/Amman',
      countryCode: 'JO',
    });
    expect(state.status).toBe('success');
    const { path, body } = sent();
    expect(path).toBe(`/api/v1/platform/organizations/${TENANT}/branches`);
    expect(body).toEqual({
      companyId: SUBSCRIPTION,
      code: 'nw_north',
      name: 'Northern branch',
      timezone: 'Asia/Amman',
      countryCode: 'JO',
    });
  });

  it('refuses a parent company that is not an identifier, without asking the server', async () => {
    const parent = await actions.addBranchAction(TENANT, {
      companyId: NOT_AN_ID,
      code: 'nw_north',
      name: 'Northern branch',
      timezone: 'Asia/Amman',
    });
    expect(parent.status).toBe('invalid');
    expect(parent.fieldErrors?.companyId).toBe('platform.error.required');

    const unknown = await actions.addBranchAction(NOT_AN_ID, {
      companyId: SUBSCRIPTION,
      code: 'nw_north',
      name: 'Northern branch',
      timezone: 'Asia/Amman',
    });
    expect(unknown.messageKey).toBe('state.notFound.message');
    expect(send).not.toHaveBeenCalled();
  });

  it('invites a first administrator as the `invite` mode of the one operation', async () => {
    const state = await actions.inviteAdministratorAction(TENANT, {
      email: 'operations@northern-workshops.example',
      displayName: 'Northern Workshops operations',
    });
    expect(state.status).toBe('success');
    const { path, body } = sent();
    expect(path).toBe(`/api/v1/platform/organizations/${TENANT}/administrators`);
    expect(body).toEqual({
      mode: 'invite',
      email: 'operations@northern-workshops.example',
      displayName: 'Northern Workshops operations',
    });
  });

  it('sends a further administrator only with the reason that was given for it', async () => {
    const state = await actions.inviteAdministratorAction(TENANT, {
      email: 'second@northern-workshops.example',
      displayName: 'Northern Workshops second operator',
      additionalAdministrator: true,
      reason: 'The first administrator is on leave for the quarter',
    });
    expect(state.status).toBe('success');
    expect(sent().body).toEqual({
      mode: 'invite',
      email: 'second@northern-workshops.example',
      displayName: 'Northern Workshops second operator',
      additionalAdministrator: true,
      reason: 'The first administrator is on leave for the quarter',
    });
  });

  it('refuses the flag without a reason, and a reason without the flag', async () => {
    const flagOnly = await actions.inviteAdministratorAction(TENANT, {
      email: 'second@northern-workshops.example',
      displayName: 'Northern Workshops second operator',
      additionalAdministrator: true,
    });
    expect(flagOnly.fieldErrors?.reason).toBe('overlay.reasonRequired');

    const reasonOnly = await actions.inviteAdministratorAction(TENANT, {
      email: 'second@northern-workshops.example',
      displayName: 'Northern Workshops second operator',
      reason: 'The first administrator is on leave for the quarter',
    });
    expect(reasonOnly.fieldErrors?.reason).toBe('overlay.reasonRequired');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses an invitation with no name and an organisation that is not one', async () => {
    const name = await actions.inviteAdministratorAction(TENANT, {
      email: 'operations@northern-workshops.example',
      displayName: '   ',
    });
    expect(name.fieldErrors?.displayName).toBe('platform.error.required');

    const unknown = await actions.inviteAdministratorAction(NOT_AN_ID, {
      email: 'operations@northern-workshops.example',
      displayName: 'Northern Workshops operations',
    });
    expect(unknown.messageKey).toBe('state.notFound.message');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the link again as the `resend` mode, carrying the address and nothing else', async () => {
    const state = await actions.resendAdministratorInvitationAction(
      TENANT,
      '  operations@northern-workshops.example  '
    );
    expect(state.status).toBe('success');
    const { path, body } = sent();
    expect(path).toBe(`/api/v1/platform/organizations/${TENANT}/administrators`);
    expect(body).toEqual({
      mode: 'resend',
      email: 'operations@northern-workshops.example',
    });
  });

  it('refuses a resend to an address that is not one, and to an organisation that is not one', async () => {
    const address = await actions.resendAdministratorInvitationAction(TENANT, 'a');
    expect(address.status).toBe('invalid');
    expect(address.fieldErrors?.email).toBe('platform.error.email');

    const unknown = await actions.resendAdministratorInvitationAction(
      NOT_AN_ID,
      'operations@northern-workshops.example'
    );
    expect(unknown.messageKey).toBe('state.notFound.message');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('recorded money crosses the boundary as the string it was typed as', () => {
  it('sends a charge amount unchanged, with its currency and its due date', async () => {
    const state = await actions.recordChargeAction(TENANT, {
      amount: '1250.5000',
      currencyCode: 'JOD',
      dueOn: '2026-10-15',
      description: 'Annual subscription',
    });
    expect(state.status).toBe('success');
    const { path, body } = sent();
    expect(path).toBe(`/api/v1/platform/organizations/${TENANT}/charges`);
    expect(body.amount).toBe('1250.5000');
    expect(typeof body.amount).toBe('string');
    expect(body.currencyCode).toBe('JOD');
    expect(body.dueOn).toBe('2026-10-15');
  });

  it('refuses an amount of zero, an amount that is not a decimal, and more than four decimal places', async () => {
    for (const amount of ['0', '0.00', '12,50', '1.00000']) {
      send.mockClear();
      const state = await actions.recordChargeAction(TENANT, {
        amount,
        currencyCode: 'JOD',
        dueOn: '2026-10-15',
        description: 'Annual subscription',
      });
      expect(state.fieldErrors?.amount, amount).toBe('platform.error.amount');
      expect(send, amount).not.toHaveBeenCalled();
    }
  });

  it('records a receipt against the charge it settles', async () => {
    const state = await actions.recordReceiptAction(TENANT, {
      chargeId: CHARGE,
      amount: '600.0000',
      receivedOn: '2026-10-20',
      method: 'Bank transfer',
      reference: 'TRF-4471',
    });
    expect(state.status).toBe('success');
    const { path, body } = sent();
    expect(path).toBe(`/api/v1/platform/organizations/${TENANT}/receipts`);
    expect(body.chargeId).toBe(CHARGE);
    expect(body.amount).toBe('600.0000');
    expect(body.reference).toBe('TRF-4471');
  });

  /*
   * `mismatch` — `platform/application/billing-service.ts:228`, against
   * `body.currencyCode`.
   *
   * The receipt dialog offers no currency control: the currency is the charge's
   * and travels with the request. So a field error keyed `currencyCode` named
   * nothing on screen and rendered nowhere, and the operator got the general
   * banner over a refusal that states an exact, correctable reason. It is the
   * whole request as far as that dialog is concerned, so it is raised to the
   * banner the dialog already draws.
   */
  it('raises a currency refusal into the banner, because that dialog has no currency control', async () => {
    send.mockResolvedValue(violationFailure([{ path: 'body.currencyCode', rule: 'mismatch' }]));
    const state = await actions.recordReceiptAction(TENANT, {
      chargeId: CHARGE,
      amount: '600.0000',
      receivedOn: '2026-10-20',
      method: 'Bank transfer',
    });
    expect(state.status).toBe('invalid');
    expect(state.messageKey).toBe('form.violation.mismatch');
    expect(state.fieldErrors?.currencyCode).toBe('form.violation.mismatch');
  });

  it('leaves the banner alone when the refusal carries no sentence of its own', async () => {
    // The direction that matters: `form.violation.invalid` says LESS than the
    // banner already does, so promoting it would replace a sentence with a
    // vaguer one.
    send.mockResolvedValue(
      violationFailure([{ path: 'body.currencyCode', rule: 'a_token_with_no_sentence' }])
    );
    const state = await actions.recordReceiptAction(TENANT, {
      chargeId: CHARGE,
      amount: '600.0000',
      receivedOn: '2026-10-20',
      method: 'Bank transfer',
    });
    expect(state.fieldErrors?.currencyCode).toBe('form.violation.invalid');
    expect(state.messageKey).not.toBe('form.violation.invalid');
  });

  it('refuses a receipt that names no charge', async () => {
    const state = await actions.recordReceiptAction(TENANT, {
      chargeId: NOT_AN_ID,
      amount: '600.0000',
      receivedOn: '2026-10-20',
      method: 'Bank transfer',
    });
    expect(state.fieldErrors?.chargeId).toBe('platform.error.required');
    expect(send).not.toHaveBeenCalled();
  });

  it('voids a charge under its own path, with a reason', async () => {
    const state = await actions.voidChargeAction(TENANT, CHARGE, 'Raised against the wrong term');
    expect(state.status).toBe('success');
    const { path, body } = sent();
    expect(path).toBe(`/api/v1/platform/organizations/${TENANT}/charges/${CHARGE}/void`);
    expect(body).toEqual({ reason: 'Raised against the wrong term' });

    send.mockClear();
    const blank = await actions.voidChargeAction(TENANT, CHARGE, '');
    expect(blank.fieldErrors?.reason).toBe('overlay.reasonRequired');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('a plan carries its price and its currency together, and an edit carries its version', () => {
  const plan = {
    planCode: 'standard_annual',
    displayName: 'Standard, yearly',
    listPrice: '4800.0000',
    currencyCode: 'JOD',
    termMonths: 12,
    capacityLimits: { companies: 2, branches: 5, users: undefined },
    entitlementDocument: { workshop_operations: true, delivery_handover: false },
    status: 'active' as const,
    effectiveFrom: '2026-10-01',
  };

  it('creates a plan with the price as a decimal string and the term as whole months', async () => {
    const state = await actions.createPlanAction(plan);
    expect(state.status).toBe('success');
    const { method, path, body } = sent();
    expect(method).toBe('POST');
    expect(path).toBe('/api/v1/platform/plans');
    expect(body.listPrice).toBe('4800.0000');
    expect(body.currencyCode).toBe('JOD');
    expect(body.termMonths).toBe(12);
    // A blank limit is no limit at all, and is not sent as a zero.
    expect(body.capacityLimits).toEqual({ companies: 2, branches: 5, users: undefined });
    expect(body.entitlementDocument).toEqual({
      workshop_operations: true,
      delivery_handover: false,
    });
  });

  it('refuses a price with no currency, and a currency with no price', async () => {
    const priceOnly = await actions.createPlanAction({ ...plan, currencyCode: undefined });
    expect(priceOnly.fieldErrors?.currencyCode).toBe('platform.error.priceCurrency');

    const currencyOnly = await actions.createPlanAction({ ...plan, listPrice: undefined });
    expect(currencyOnly.fieldErrors?.currencyCode).toBe('platform.error.priceCurrency');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a plan code that is not one the catalogue can hold', async () => {
    const state = await actions.createPlanAction({ ...plan, planCode: 'Standard Annual' });
    expect(state.fieldErrors?.planCode).toBe('platform.error.planCode');
    expect(send).not.toHaveBeenCalled();
  });

  it('guards an edit by the version the operator was looking at, and never sends the frozen fields', async () => {
    const state = await actions.updatePlanAction(PLAN_ID, 4, plan);
    expect(state.status).toBe('success');
    const { method, path, body, options } = sent();
    expect(method).toBe('PATCH');
    expect(path).toBe(`/api/v1/platform/plans/${PLAN_ID}`);
    expect(options).toEqual({ ifMatch: 4 });
    // The code and the start date are frozen once a version exists.
    expect('planCode' in body).toBe(false);
    expect('effectiveFrom' in body).toBe(false);
  });

  it('sends a cleared price, currency, term and end date as cleared rather than omitting them', async () => {
    const state = await actions.updatePlanAction(PLAN_ID, 4, {
      ...plan,
      listPrice: undefined,
      currencyCode: undefined,
      termMonths: undefined,
      effectiveTo: undefined,
    });
    expect(state.status).toBe('success');
    const { body } = sent();
    // Omitted, a cleared field would silently keep its old value.
    expect(body.listPrice).toBeNull();
    expect(body.currencyCode).toBeNull();
    expect(body.termMonths).toBeNull();
    expect(body.effectiveTo).toBeNull();
  });

  it('refuses an edit that names no plan or no version', async () => {
    expect((await actions.updatePlanAction(NOT_AN_ID, 4, plan)).messageKey).toBe(
      'state.notFound.message'
    );
    expect((await actions.updatePlanAction(PLAN_ID, 0, plan)).messageKey).toBe(
      'state.notFound.message'
    );
    expect((await actions.updatePlanAction(PLAN_ID, 1.5, plan)).messageKey).toBe(
      'state.notFound.message'
    );
    expect(send).not.toHaveBeenCalled();
  });
});

describe('every write stops at an ended session before it asks the server', () => {
  it('reports the session rather than a refusal', async () => {
    authorizedClient.mockResolvedValue(null as unknown);
    const state = await actions.changeOrganizationStatusAction(TENANT, 'active', 'Reinstated');
    expect(state.status).toBe('expired');
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the console reads name their subject and carry only what was asked', () => {
  const tableRequest = (
    overrides: Partial<{ search: string; filters: ReadonlyArray<{ key: string; value: string }> }>
  ) => ({ page: 1, pageSize: 25, sort: null, filters: [], search: '', ...overrides }) as never;
  const request = tableRequest({});

  it('sends the search term and the status only once they have a value', async () => {
    await tableReads.listOrganizations(request, null);
    const first = String(get.mock.calls[0]?.[0]);
    expect(first).toContain('/api/v1/platform/organizations');
    expect(first).not.toContain('q=');
    expect(first).not.toContain('status=');
    expect(first).toContain('limit=25');

    get.mockClear();
    await tableReads.listOrganizations(
      tableRequest({
        search: '  northern  ',
        filters: [{ key: 'status', value: 'suspended' }],
      }),
      'cursor-2'
    );
    const second = String(get.mock.calls[0]?.[0]);
    expect(second).toContain('q=northern');
    expect(second).toContain('status=suspended');
    expect(second).toContain('cursor=cursor-2');
  });

  it('turns a page of rows into the shape the table reads, and a refusal into a denial', async () => {
    get.mockResolvedValue(okResult({ items: [{ id: TENANT }], nextCursor: 'c2', hasMore: true }));
    const page = await tableReads.listOrganizations(request, null);
    expect(page.status).toBe('ok');
    expect(page.rows).toHaveLength(1);
    expect(page.nextCursor).toBe('c2');
    expect(page.hasMore).toBe(true);

    get.mockResolvedValue({ ok: false, kind: 'forbidden', correlationId: 'corr-4' });
    const denied = await tableReads.listOrganizations(request, null);
    expect(denied.status).toBe('denied');
    expect(denied.rows).toEqual([]);
  });

  it('refuses an organisation identifier that is not one, without asking the server', async () => {
    expect((await reads.readOrganization(NOT_AN_ID)).status).toBe('not-found');
    expect((await reads.listCharges(NOT_AN_ID)).status).toBe('not-found');
    expect(get).not.toHaveBeenCalled();
  });

  it('reads the detail, the plans, the charges and the statistics by their own paths', async () => {
    get.mockResolvedValue(okResult({}));
    await reads.readOrganization(TENANT);
    await reads.listPlans();
    await reads.listCharges(TENANT);
    await reads.readStatistics();
    const paths = get.mock.calls.map((call) => String(call[0]));
    expect(paths[0]).toBe(`/api/v1/platform/organizations/${TENANT}`);
    expect(paths[1]).toBe('/api/v1/platform/plans');
    expect(paths[2]).toBe(`/api/v1/platform/organizations/${TENANT}/charges?limit=100`);
    expect(paths[3]).toBe('/api/v1/platform/statistics');
  });

  /*
   * P1-32-PRE-OD-CONSOLE-006. The charge read asked for one page and never for
   * the next, so `platform.charge-list` was paging into nothing. The status and
   * the cursor are sent only when the operator asked for them, so an operator
   * who asked for neither still gets the plain first page.
   */
  it('sends the charge status and the cursor only when they were asked for', async () => {
    get.mockResolvedValue(okResult({ items: [], nextCursor: null, hasMore: false }));
    await reads.listCharges(TENANT, { status: 'open', cursor: 'cursor-2' });
    expect(String(get.mock.calls[0]?.[0])).toBe(
      `/api/v1/platform/organizations/${TENANT}/charges?limit=100&status=open&cursor=cursor-2`
    );

    get.mockClear();
    await reads.listCharges(TENANT, {});
    expect(String(get.mock.calls[0]?.[0])).toBe(
      `/api/v1/platform/organizations/${TENANT}/charges?limit=100`
    );
  });

  it('drops an organisation filter that is not an identifier rather than sending it', async () => {
    await tableReads.searchPlatformAudit(
      { from: '2026-08-18', to: '2026-09-17', action: '', organizationId: NOT_AN_ID },
      request,
      null
    );
    const path = String(get.mock.calls[0]?.[0]);
    expect(path).toContain('from=2026-08-18');
    expect(path).toContain('to=2026-09-17');
    expect(path).not.toContain('targetTenantId');
    expect(path).not.toContain('action=');

    get.mockClear();
    await tableReads.searchPlatformAudit(
      {
        from: '2026-08-18',
        to: '2026-09-17',
        action: 'platform.organization.suspended',
        organizationId: TENANT,
      },
      request,
      null
    );
    const filtered = String(get.mock.calls[0]?.[0]);
    expect(filtered).toContain(`targetTenantId=${TENANT}`);
    expect(filtered).toContain('action=platform.organization.suspended');
  });

  it('answers an ended session as an ended session, not as an empty page', async () => {
    authorizedClient.mockResolvedValue(null as unknown);
    const page = await tableReads.listOrganizations(request, null);
    expect(page.status).toBe('expired');
    expect(page.rows).toEqual([]);
    expect(await reads.listOrganizationChoices()).toEqual([]);
    expect((await reads.readStatistics()).status).toBe('expired');
    expect(get).not.toHaveBeenCalled();
  });
});

/*
 * The reads module is server-only: it carries no Server Action directive, so
 * nothing in it is a browser-callable endpoint, and no module that ships to the
 * browser may reach it. A client module reaches it directly or through any
 * chain of plain modules; a Server Action module ends the chain, because the
 * browser receives only a reference to it, never its imports.
 */
const WEB_SRC = join(__dirname, '..', 'src');
const READS_MODULE = resolve(WEB_SRC, 'features', 'platform', 'api.ts');
const SESSION_MODULE = resolve(WEB_SRC, 'features', 'platform', 'api', 'session.ts');
const ACTIONS_MODULE = resolve(WEB_SRC, 'features', 'platform', 'actions.ts');
const TABLE_READS_MODULE = resolve(WEB_SRC, 'features', 'platform', 'table-reads.ts');

/**
 * The directive a module opens with, if any.
 *
 * The block-comment branch spells its body as "not a star, or a star that does
 * not close the comment" rather than as a lazy any-character run. The lazy form
 * lets one iteration of the outer repetition swallow a comment terminator that
 * another iteration could equally have matched, so a source that opens a block
 * comment and then repeats close-open pairs costs exponential backtracking
 * (`js/redos`). This spelling gives every character exactly one branch, which
 * makes the match linear and the language it accepts is unchanged.
 */
function directiveOf(source: string): string | null {
  const match =
    /^(?:\s|\/\/[^\n]*\n|\/\*(?:[^*]|\*(?!\/))*\*\/)*['"](use (?:client|server))['"]/.exec(source);
  return match ? (match[1] ?? null) : null;
}

/** A project-local specifier as a file on disk, or null for a package. */
function resolveLocal(fromFile: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith('@/')) base = resolve(WEB_SRC, specifier.slice(2));
  else if (specifier.startsWith('.')) base = resolve(dirname(fromFile), specifier);
  else return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  return candidates.find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate)) ?? null;
}

function localImportsOf(file: string, source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const target = resolveLocal(file, match[1] ?? '');
    if (target) out.push(target);
  }
  return out;
}

describe('the console reads stay on the server', () => {
  it('declares no Server Action directive on the reads module', () => {
    expect(directiveOf(readFileSync(READS_MODULE, 'utf8'))).toBeNull();
  });

  it('is reachable from no client module', () => {
    const files = globSync(['**/*.ts', '**/*.tsx'], { cwd: WEB_SRC, absolute: true }).map((file) =>
      resolve(file)
    );
    const clientFiles = files.filter(
      (file) => directiveOf(readFileSync(file, 'utf8')) === 'use client'
    );
    expect(clientFiles.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const start of clientFiles) {
      const seen = new Set<string>([start]);
      const queue = [start];
      while (queue.length > 0) {
        const file = queue.shift() as string;
        const source = readFileSync(file, 'utf8');
        if (file !== start && directiveOf(source) === 'use server') continue;
        for (const target of localImportsOf(file, source)) {
          if (target === READS_MODULE) offenders.push(start);
          if (!seen.has(target)) {
            seen.add(target);
            queue.push(target);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('would notice a client module that imports it', () => {
    const probe = resolve(WEB_SRC, 'features', 'platform', 'components', 'Probe.tsx');
    expect(localImportsOf(probe, "import { readStatistics } from '../api';")).toContain(
      READS_MODULE
    );
    expect(
      localImportsOf(probe, "import { readStatistics } from '@/features/platform/api';")
    ).toContain(READS_MODULE);
  });
});

/*
 * The decided exception (P1-32-PRE-068): the organisation list and the activity
 * search are driven by a client data table after render, so they are Server
 * Actions, in `table-reads.ts` and nowhere else. It is the established pattern
 * for an interactive paged table, a search term may not travel in the address,
 * and the backend operation is the authority boundary. No OTHER platform read
 * may be a Server Action, and the writes module holds writes only.
 *
 * A Server Action module performs a platform read when it imports a server-only
 * platform read module, or when it names a platform path and issues a GET.
 */
const ALLOWED_TABLE_READS = ['listOrganizations', 'searchPlatformAudit'];

/*
 * A Server Action that consults a platform read without handing its result to
 * the browser. Sign-in reads the platform session only to choose where to send
 * the user next; what it returns is a destination, not console data. Any new
 * entry here is a reviewed decision, not a way to make the case below pass.
 */
const CONSULTS_WITHOUT_EXPORTING = [
  resolve(WEB_SRC, 'features', 'authentication', 'actions', 'login.ts') + '#loginAction',
];

function exportedNamesOf(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(
    /\bexport\s+(?:async\s+)?(?:function\*?|const|let|var)\s+([A-Za-z_$][\w$]*)/g
  )) {
    names.push(match[1] ?? '');
  }
  for (const match of source.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    for (const part of (match[1] ?? '').split(',')) {
      const trimmed = part.trim();
      if (trimmed.length === 0 || trimmed.startsWith('type ')) continue;
      names.push(trimmed.split(/\s+as\s+/).pop() ?? trimmed);
    }
  }
  return names;
}

function performsPlatformRead(file: string, source: string): boolean {
  const imports = localImportsOf(file, source);
  if (imports.includes(READS_MODULE) || imports.includes(SESSION_MODULE)) return true;
  // A typed GET, or a GET whose path is written in place. `FormData.get('x')` is neither.
  return (
    source.includes('/api/v1/platform') &&
    /\.get\s*<[^>]*>\s*\(|\.get\s*\(\s*['"`]\/api\/v1\/platform/.test(source)
  );
}

function platformReadsExportedFromServerActions(): string[] {
  const out: string[] = [];
  for (const file of globSync(['**/*.ts', '**/*.tsx'], { cwd: WEB_SRC, absolute: true })) {
    const path = resolve(file);
    const source = readFileSync(path, 'utf8');
    if (directiveOf(source) !== 'use server' || !performsPlatformRead(path, source)) continue;
    for (const name of exportedNamesOf(source)) out.push(`${path}#${name}`);
  }
  return out.sort();
}

describe('only the two table reads are platform reads a browser can call', () => {
  it('exports exactly the organisation list and the activity search from a Server Action module', () => {
    expect(platformReadsExportedFromServerActions()).toEqual(
      [
        ...ALLOWED_TABLE_READS.map((name) => `${TABLE_READS_MODULE}#${name}`),
        ...CONSULTS_WITHOUT_EXPORTING,
      ].sort()
    );
  });

  it('keeps the table reads module a Server Action module with those two exports only', () => {
    const source = readFileSync(TABLE_READS_MODULE, 'utf8');
    expect(directiveOf(source)).toBe('use server');
    expect(exportedNamesOf(source).sort()).toEqual([...ALLOWED_TABLE_READS].sort());
    expect(Object.keys(tableReads).sort()).toEqual([...ALLOWED_TABLE_READS].sort());
  });

  it('keeps the writes module to writes: no read, and every export is an action', () => {
    const source = readFileSync(ACTIONS_MODULE, 'utf8');
    expect(performsPlatformRead(ACTIONS_MODULE, source)).toBe(false);
    const names = exportedNamesOf(source);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !name.endsWith('Action'))).toEqual([]);
    expect(Object.keys(actions).filter((name) => !name.endsWith('Action'))).toEqual([]);
  });

  it('would notice another platform read exported from a Server Action module', () => {
    const probe = resolve(WEB_SRC, 'features', 'platform', 'probe-actions.ts');
    const viaModule = [
      "'use server';",
      "import { readPage } from './api';",
      'export async function listPlans() {}',
    ].join('\n');
    expect(directiveOf(viaModule)).toBe('use server');
    expect(performsPlatformRead(probe, viaModule)).toBe(true);
    expect(exportedNamesOf(viaModule)).toEqual(['listPlans']);

    const viaClient = [
      "'use server';",
      "export const readStatistics = async () => client.get<Stats>('/api/v1/platform/statistics');",
    ].join('\n');
    expect(performsPlatformRead(probe, viaClient)).toBe(true);
    expect(exportedNamesOf(viaClient)).toEqual(['readStatistics']);

    const write = [
      "'use server';",
      "export async function voidAction() { return client.send('POST', '/api/v1/platform/x'); }",
    ].join('\n');
    expect(performsPlatformRead(probe, write)).toBe(false);

    const formRead = [
      "'use server';",
      "const PATH = '/api/v1/platform/plans';",
      "export async function createAction(form: FormData) { return form.get('name'); }",
    ].join('\n');
    expect(performsPlatformRead(probe, formRead)).toBe(false);
  });
});
