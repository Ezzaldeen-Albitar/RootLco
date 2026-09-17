import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import { renderLtr, renderRtl } from './render';

/**
 * The Platform Owner Console screens (P1-32-PRE-069).
 *
 * The properties under test:
 *
 *   - the organisation list sends the search term as `q` only when submitted,
 *     and pages by the server's cursor;
 *   - the detail shows usage against the plan, says "unlimited" when there is no
 *     limit and warns from 90%, and offers each action only to an operator whose
 *     platform authority could satisfy it;
 *   - the subscription dialog sends the act as `kind` and the term as a whole
 *     number of months;
 *   - billing shows the server's outstanding figure and submits money as a
 *     canonical decimal STRING;
 *   - the overview labels the projected renewal value as an estimate, apart from
 *     the recorded amounts;
 *   - provisioning sends what was typed, offers a subscription only when the
 *     plan catalogue could be read, and offers activation only to an operator
 *     holding the lifecycle authority;
 *   - the plan catalogue sends a price as a decimal STRING, a term as whole
 *     months and a blank limit as no limit at all, and guards an edit by the
 *     version the operator was looking at;
 *   - the activity search opens on the window it was given and applies its
 *     criteria together.
 *
 * Every business value below is a test value invented for this file.
 */

const EN = en as Record<string, string>;
/** A catalogued English message, typed as present: a missing key fails the lookup visibly. */
const L = (key: string): string => EN[key] ?? `missing message ${key}`;

const apiGet = vi.fn();
vi.mock('@/lib/api/server-client', () => ({
  authorizedClient: async () => ({ get: apiGet }),
}));

const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/en/platform',
}));

const assignSubscriptionAction = vi.fn();
const cancelSubscriptionAction = vi.fn();
const recordChargeAction = vi.fn();
const recordReceiptAction = vi.fn();
const voidChargeAction = vi.fn();
const changeOrganizationStatusAction = vi.fn();
const provisionOrganizationAction = vi.fn();
const createPlanAction = vi.fn();
const updatePlanAction = vi.fn();
vi.mock('@/features/platform/actions', () => ({
  assignSubscriptionAction: (...args: unknown[]) => assignSubscriptionAction(...args),
  cancelSubscriptionAction: (...args: unknown[]) => cancelSubscriptionAction(...args),
  recordChargeAction: (...args: unknown[]) => recordChargeAction(...args),
  recordReceiptAction: (...args: unknown[]) => recordReceiptAction(...args),
  voidChargeAction: (...args: unknown[]) => voidChargeAction(...args),
  changeOrganizationStatusAction: (...args: unknown[]) => changeOrganizationStatusAction(...args),
  provisionOrganizationAction: (...args: unknown[]) => provisionOrganizationAction(...args),
  createPlanAction: (...args: unknown[]) => createPlanAction(...args),
  updatePlanAction: (...args: unknown[]) => updatePlanAction(...args),
}));

const { OrganizationsScreen } = await import('@/features/platform/components/OrganizationsScreen');
const { OrganizationDetailScreen } =
  await import('@/features/platform/components/OrganizationDetailScreen');
const { BillingPanel } = await import('@/features/platform/components/BillingPanel');
const { PlatformOverview } = await import('@/features/platform/components/PlatformOverview');
const { ProvisionOrganizationScreen } =
  await import('@/features/platform/components/ProvisionOrganizationScreen');
const { PlansScreen } = await import('@/features/platform/components/PlansScreen');
const { PlatformAuditScreen } = await import('@/features/platform/components/PlatformAuditScreen');
const { getMessages } = await import('@/i18n/get-messages');

const messages = getMessages('en');
const TENANT = '11111111-1111-4111-8111-111111111111';
const SUBSCRIPTION = '22222222-2222-4222-8222-222222222222';
const PLAN = '33333333-3333-4333-8333-333333333333';
const CHARGE = '44444444-4444-4444-8444-444444444444';

const row = {
  id: TENANT,
  tenantCode: 'test_org_one',
  displayName: 'Test Organisation One',
  status: 'active',
  defaultLocale: 'ar',
  defaultTimezone: 'Asia/Riyadh',
  createdAt: '2026-09-01T08:00:00.000Z',
  activePlanCode: 'test_plan',
  activePlanEffectiveTo: '2027-08-31',
  activeCompanyCount: 1,
  activeBranchCount: 2,
  activeUserCount: 3,
};

const subscription = {
  id: SUBSCRIPTION,
  planId: PLAN,
  planCode: 'test_plan',
  planName: 'Test Plan',
  status: 'active',
  effectiveFrom: '2026-09-01',
  effectiveTo: '2027-08-31',
  recordVersion: 1,
};

const plan = {
  id: PLAN,
  planCode: 'test_plan',
  name: 'Test Plan',
  displayName: 'Test Plan',
  description: null,
  status: 'active',
  listPrice: '1200.0000',
  currencyCode: 'SAR',
  termMonths: 12,
  entitlementDocument: {},
  capacityLimits: { companies: 1, users: 10 },
  effectiveFrom: '2026-01-01',
  effectiveTo: null,
  recordVersion: 1,
};

const detail = {
  id: TENANT,
  tenantCode: 'test_org_one',
  displayName: 'Test Organisation One',
  status: 'active',
  defaultLocale: 'ar',
  defaultTimezone: 'Asia/Riyadh',
  createdAt: '2026-09-01T08:00:00.000Z',
  companies: [{ id: 'c1', code: 'test_company', legalName: 'Test Company', status: 'active' }],
  branches: [
    { id: 'b1', companyId: 'c1', code: 'test_branch', name: 'Test Branch', status: 'active' },
  ],
  userCountsByStatus: [{ status: 'active', count: 9 }],
  subscriptions: [subscription],
  subscriptionEvents: [],
  statusHistory: [],
  capacity: {
    companies: { used: 1, limit: 1 },
    branches: { used: 2, limit: null },
    users: { used: 5, limit: 10 },
  },
};

const charge = {
  id: CHARGE,
  subscriptionId: SUBSCRIPTION,
  amount: '1200.0000',
  currencyCode: 'SAR',
  dueOn: '2026-09-15',
  description: 'Test annual charge',
  status: 'open',
  voidReason: null,
  outstanding: '700.0000',
  recordVersion: 1,
  recordedAt: '2026-09-01T08:00:00.000Z',
  receipts: [
    {
      id: 'r1',
      chargeId: CHARGE,
      amount: '500.0000',
      currencyCode: 'SAR',
      receivedOn: '2026-09-05',
      reference: null,
      method: 'Bank transfer',
      notes: null,
      recordedAt: '2026-09-05T08:00:00.000Z',
    },
  ],
};

const ALL = {
  canChangeLifecycle: true,
  canManageSubscription: true,
  canReadBilling: true,
  canManageBilling: true,
  canReadAudit: true,
};
const NONE = {
  canChangeLifecycle: false,
  canManageSubscription: false,
  canReadBilling: false,
  canManageBilling: false,
  canReadAudit: false,
};

beforeEach(() => {
  apiGet.mockReset();
  refresh.mockReset();
  push.mockReset();
  assignSubscriptionAction.mockReset();
  cancelSubscriptionAction.mockReset();
  recordChargeAction.mockReset();
  recordReceiptAction.mockReset();
  voidChargeAction.mockReset();
  changeOrganizationStatusAction.mockReset();
  provisionOrganizationAction.mockReset();
  createPlanAction.mockReset();
  updatePlanAction.mockReset();
});

describe('the organisation list', () => {
  it('sends the search term as q only when it is submitted', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [row], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderLtr(<OrganizationsScreen locale="en" messages={messages} canProvision={false} />);
    await screen.findByText('Test Organisation One');
    expect(String(apiGet.mock.calls[0]?.[0])).not.toContain('q=');

    const box = screen.getByRole('searchbox', {
      name: new RegExp(L('platform.organizations.search')),
    });
    await userEvent.type(box, 'garage');
    expect(apiGet).toHaveBeenCalledTimes(1);

    await userEvent.click(
      screen.getByRole('button', { name: L('platform.organizations.searchSubmit') })
    );
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const path = String(apiGet.mock.calls[1]?.[0]);
    expect(path.startsWith('/api/v1/platform/organizations?')).toBe(true);
    expect(new URLSearchParams(path.split('?')[1]).get('q')).toBe('garage');
    expect(screen.queryByRole('link', { name: L('platform.organizations.new') })).toBeNull();
  });

  it('pages by the cursor the server returned', async () => {
    apiGet
      .mockResolvedValueOnce({
        ok: true,
        data: { items: [row], nextCursor: 'cursor-two', hasMore: true },
        correlationId: 'c',
      })
      .mockResolvedValueOnce({
        ok: true,
        data: {
          items: [{ ...row, id: 'x2', displayName: 'Test Organisation Two' }],
          nextCursor: null,
          hasMore: false,
        },
        correlationId: 'c',
      });
    renderLtr(<OrganizationsScreen locale="en" messages={messages} canProvision />);
    await screen.findByText('Test Organisation One');
    expect(screen.getByRole('link', { name: L('platform.organizations.new') })).toHaveAttribute(
      'href',
      '/en/platform/organizations/new'
    );

    await userEvent.click(screen.getByRole('button', { name: L('table.nextPage') }));
    await screen.findByText('Test Organisation Two');
    const path = String(apiGet.mock.calls[1]?.[0]);
    expect(new URLSearchParams(path.split('?')[1]).get('cursor')).toBe('cursor-two');
  });
});

describe('the organisation detail', () => {
  it('shows usage against the plan, unlimited where there is no limit, and warns from 90%', () => {
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={[plan]}
        charges={null}
        capabilities={NONE}
        today="2026-09-16"
      />
    );
    const companies = screen.getByTestId('platform-usage-companies');
    expect(companies).toHaveAttribute('data-warning', 'true');
    expect(within(companies).getByText(L('platform.usage.warning'))).toBeInTheDocument();

    const branches = screen.getByTestId('platform-usage-branches');
    expect(branches).toHaveAttribute('data-warning', 'false');
    expect(
      within(branches).getByText(new RegExp(L('platform.usage.unlimited')))
    ).toBeInTheDocument();
    expect(within(branches).queryByRole('meter')).toBeNull();

    const users = screen.getByTestId('platform-usage-users');
    expect(users).toHaveAttribute('data-warning', 'false');
    expect(within(users).getByRole('meter')).toHaveAttribute('aria-valuenow', '5');
  });

  it('offers no action to an operator holding no write authority', () => {
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={null}
        charges={{
          status: 'ok',
          data: { items: [charge], nextCursor: null, hasMore: false },
          correlationId: null,
        }}
        capabilities={NONE}
        today="2026-09-16"
      />
    );
    for (const key of [
      'platform.lifecycle.suspend',
      'platform.lifecycle.close',
      'platform.subscription.act.renewed',
      'platform.subscription.act.cancel',
      'platform.billing.recordCharge',
      'platform.detail.viewAudit',
    ]) {
      expect(screen.queryByRole('button', { name: L(key) }), key).toBeNull();
    }
    expect(screen.queryByText(L('platform.billing.title'))).toBeNull();
  });

  it('offers each action to an operator holding its authority', () => {
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={[plan]}
        charges={{
          status: 'ok',
          data: { items: [charge], nextCursor: null, hasMore: false },
          correlationId: null,
        }}
        capabilities={ALL}
        today="2026-09-16"
      />
    );
    for (const key of [
      'platform.lifecycle.suspend',
      'platform.lifecycle.close',
      'platform.subscription.act.renewed',
      'platform.subscription.act.upgraded',
      'platform.subscription.act.downgraded',
      'platform.subscription.act.cancel',
      'platform.billing.recordCharge',
      'platform.billing.recordReceipt',
      'platform.billing.void',
    ]) {
      expect(screen.getByRole('button', { name: L(key) }), key).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: L('platform.lifecycle.reactivate') })).toBeNull();
    expect(screen.getByRole('link', { name: L('platform.detail.viewAudit') })).toHaveAttribute(
      'href',
      `/en/platform/audit?organization=${TENANT}`
    );
  });

  it('draws a refused billing read as a refusal, not as an organisation with no charges', async () => {
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={null}
        charges={{ status: 'denied', correlationId: 'corr-9' }}
        capabilities={{ ...NONE, canReadBilling: true }}
        today="2026-09-16"
      />
    );
    // The section is still there — the operator may read billing — and it says
    // the read was refused. "No charges" would be a false statement about the
    // organisation rather than about the read.
    expect(screen.getByText(L('platform.billing.title'))).toBeInTheDocument();
    expect(screen.getByText(L('state.denied.title') as string)).toBeInTheDocument();
    expect(screen.queryByTestId('platform-charge')).toBeNull();
  });

  it('lists the status history, with the first entry arriving from no earlier state', () => {
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={{
          ...detail,
          statusHistory: [
            {
              occurredAt: '2026-09-10T09:00:00.000Z',
              fromState: null,
              toState: 'active',
              reason: null,
            },
            {
              occurredAt: '2026-09-14T09:00:00.000Z',
              fromState: 'active',
              toState: 'suspended',
              reason: 'Payment overdue',
            },
          ],
        }}
        plans={null}
        charges={null}
        capabilities={NONE}
        today="2026-09-16"
      />
    );
    const history = screen.getByRole('table', { name: L('platform.detail.statusHistory') });
    expect(within(history).getByText('Payment overdue')).toBeInTheDocument();
    expect(within(history).getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(within(history).getAllByText(L('platform.status.suspended')).length).toBe(1);
  });

  it('shows the server refusal of a lifecycle change inside the dialog', async () => {
    changeOrganizationStatusAction.mockResolvedValue({
      status: 'denied',
      messageKey: 'state.denied.title',
      correlationId: 'corr-1',
      attempt: 1,
    });
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={null}
        charges={null}
        capabilities={{ ...NONE, canChangeLifecycle: true }}
        today="2026-09-16"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: L('platform.lifecycle.suspend') }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Test reason');
    await userEvent.click(
      within(dialog).getByRole('button', { name: L('platform.lifecycle.suspend') })
    );
    await waitFor(() =>
      expect(changeOrganizationStatusAction).toHaveBeenCalledWith(
        TENANT,
        'suspended',
        'Test reason'
      )
    );
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      L('state.denied.title') as string
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe('the subscription dialog', () => {
  it('sends the act as kind and the term as whole months', async () => {
    assignSubscriptionAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.subscription.done',
      attempt: 1,
    });
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={[plan]}
        charges={null}
        capabilities={{ ...NONE, canManageSubscription: true }}
        today="2026-09-16"
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: L('platform.subscription.act.upgraded') })
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.plan')}`)),
      'test_plan'
    );
    fireEvent.change(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.starts')}`)),
      {
        target: { value: '2026-10-01' },
      }
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.term')}$`)),
      '24'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.reason')}`)),
      'More branches'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(assignSubscriptionAction).toHaveBeenCalledTimes(1));
    const [tenantId, input] = assignSubscriptionAction.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(tenantId).toBe(TENANT);
    expect(input).toEqual({
      planCode: 'test_plan',
      effectiveFrom: '2026-10-01',
      termMonths: 24,
      kind: 'upgraded',
      reason: 'More branches',
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('accepts a free number of months', async () => {
    assignSubscriptionAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.subscription.done',
      attempt: 1,
    });
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={[plan]}
        charges={null}
        capabilities={{ ...NONE, canManageSubscription: true }}
        today="2026-09-16"
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: L('platform.subscription.act.renewed') })
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.starts')}`)),
      {
        target: { value: '2027-09-01' },
      }
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.term')}$`)),
      'other'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.termMonths')}`)),
      '18'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.reason')}`)),
      'Renewal'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));
    await waitFor(() => expect(assignSubscriptionAction).toHaveBeenCalledTimes(1));
    const input = assignSubscriptionAction.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(input).toMatchObject({ kind: 'renewed', termMonths: 18, planCode: 'test_plan' });
    expect(typeof input.termMonths).toBe('number');
  });

  it('cancels the subscription the operator was looking at, on the date and reason given', async () => {
    cancelSubscriptionAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.subscription.cancelled',
      attempt: 1,
    });
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={detail}
        plans={[plan]}
        charges={null}
        capabilities={{ ...NONE, canManageSubscription: true }}
        today="2026-09-16"
      />
    );
    await userEvent.click(
      screen.getByRole('button', { name: L('platform.subscription.act.cancel') })
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.ends')}`)),
      { target: { value: '2026-12-31' } }
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.reason')}`)),
      'Not renewing'
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: L('platform.subscription.act.cancel') })
    );

    await waitFor(() => expect(cancelSubscriptionAction).toHaveBeenCalledTimes(1));
    // The identifier comes from the subscription the panel was showing, never
    // from anything typed: there is no control here that could carry one.
    expect(cancelSubscriptionAction).toHaveBeenCalledWith(TENANT, SUBSCRIPTION, {
      effectiveTo: '2026-12-31',
      reason: 'Not renewing',
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('billing', () => {
  it('shows the server outstanding figure and submits a receipt as a decimal string', async () => {
    recordReceiptAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.billing.receiptDone',
      attempt: 1,
    });
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        subscriptions={[subscription]}
        canManage
        defaultCurrency="SAR"
      />
    );
    expect(screen.getByTestId('platform-outstanding')).toHaveTextContent('700.00 SAR');

    await userEvent.click(
      screen.getByRole('button', { name: L('platform.billing.recordReceipt') })
    );
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.amount')}`));
    await userEvent.type(amount, '150.5');
    fireEvent.blur(amount);
    expect(amount).toHaveValue('150.5000');
    fireEvent.change(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.receivedOn')}`)),
      {
        target: { value: '2026-09-16' },
      }
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.method')}`)),
      'Bank transfer'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(recordReceiptAction).toHaveBeenCalledTimes(1));
    const [tenantId, input] = recordReceiptAction.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(tenantId).toBe(TENANT);
    expect(input.amount).toBe('150.5000');
    expect(typeof input.amount).toBe('string');
    expect(input).toMatchObject({
      chargeId: CHARGE,
      currencyCode: 'SAR',
      receivedOn: '2026-09-16',
      method: 'Bank transfer',
    });
  });

  it('records a charge as a decimal string, in the currency typed, against the subscription chosen', async () => {
    recordChargeAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.billing.chargeDone',
      attempt: 1,
    });
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        subscriptions={[subscription]}
        canManage
        defaultCurrency="SAR"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: L('platform.billing.recordCharge') }));
    const dialog = await screen.findByRole('dialog');
    // The currency opens on the one the current plan is priced in, rather than
    // on nothing or on an invented default.
    expect(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.currency')}`))
    ).toHaveValue('SAR');
    const amount = within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.amount')}`));
    await userEvent.type(amount, '1200');
    fireEvent.blur(amount);
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.due')}`)), {
      target: { value: '2026-10-15' },
    });
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.description')}`)),
      'Annual subscription'
    );
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.subscription')}`)),
      SUBSCRIPTION
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(recordChargeAction).toHaveBeenCalledTimes(1));
    const [tenantId, input] = recordChargeAction.mock.calls[0] as [string, Record<string, unknown>];
    expect(tenantId).toBe(TENANT);
    expect(input.amount).toBe('1200.0000');
    expect(typeof input.amount).toBe('string');
    expect(input).toMatchObject({
      currencyCode: 'SAR',
      dueOn: '2026-10-15',
      description: 'Annual subscription',
      subscriptionId: SUBSCRIPTION,
    });
  });

  it('voids a charge under the reason given, and shows the server refusal in place', async () => {
    voidChargeAction.mockResolvedValue({
      status: 'denied',
      messageKey: 'state.denied.title',
      correlationId: 'corr-1',
      attempt: 1,
    });
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        subscriptions={[subscription]}
        canManage
        defaultCurrency="SAR"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: L('platform.billing.void') }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.type(within(dialog).getByRole('textbox'), 'Raised against the wrong term');
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.billing.void') }));

    await waitFor(() =>
      expect(voidChargeAction).toHaveBeenCalledWith(TENANT, CHARGE, 'Raised against the wrong term')
    );
    // A refusal keeps the dialog open and says so there, rather than closing as
    // though the charge had been voided.
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      L('state.denied.title') as string
    );
  });

  it('offers no write to a billing reader', () => {
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.queryByRole('button', { name: L('platform.billing.recordCharge') })).toBeNull();
    expect(screen.queryByRole('button', { name: L('platform.billing.void') })).toBeNull();
    expect(screen.getByText(/500\.00 SAR/)).toBeInTheDocument();
  });
});

describe('the overview', () => {
  const statistics = {
    generatedAt: '2026-09-16T09:00:00.000Z',
    asOf: '2026-09-16T09:00:00.000Z',
    tenantsByStatus: [
      { key: 'active', count: 4 },
      { key: 'suspended', count: 1 },
    ],
    activeCompanies: 5,
    activeBranches: 7,
    activeUserAccounts: 30,
    subscriptions: {
      active: 4,
      expiringWithin30Days: 1,
      expiringWithin60Days: 2,
      expiringWithin90Days: 3,
      expired: 0,
    },
    capacityAlerts: [
      {
        tenantId: TENANT,
        tenantCode: 'test_org_one',
        displayName: 'Test Organisation One',
        kind: 'users',
        used: 10,
        limit: 10,
        severity: 'at-limit',
      },
    ],
    revenueByCurrency: [
      {
        currencyCode: 'SAR',
        contracted: '4800.0000',
        received: '1200.0000',
        outstanding: '3600.0000',
        projectedRenewalValue: '6000.0000',
      },
    ],
    health: {
      readiness: 'ready',
      readinessChecks: [],
      outbox: { reachable: true, undelivered: 2, deadLettered: 0, oldestPendingAgeSeconds: 5 },
    },
  };

  it('labels the projected renewal value as an estimate, apart from recorded amounts', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
      />
    );
    const headers = screen.getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toEqual([
      L('platform.overview.currency'),
      L('platform.overview.contracted'),
      L('platform.overview.received'),
      L('platform.overview.outstanding'),
      L('platform.overview.projectedRenewal'),
    ]);
    expect(L('platform.overview.projectedRenewal')).toMatch(/estimate/i);
    expect(screen.getByText(L('platform.overview.projectionNote'))).toBeInTheDocument();
    expect(screen.getByTestId('platform-projection')).toHaveTextContent('6,000.00 SAR');
    expect(screen.getByText('3,600.00 SAR')).toBeInTheDocument();
  });

  it('shows the tiles, the freshness line, the alert link and service health', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
      />
    );
    expect(screen.getByTestId('platform-tile-active')).toHaveTextContent('4');
    expect(screen.getByTestId('platform-tile-suspended')).toHaveTextContent('1');
    expect(screen.getByTestId('platform-tile-expiring90')).toHaveTextContent('3');
    expect(screen.getByTestId('platform-freshness')).toHaveTextContent(
      L('platform.overview.generatedAt') as string
    );
    expect(screen.getByRole('link', { name: 'Test Organisation One' })).toHaveAttribute(
      'href',
      `/en/platform/organizations/${TENANT}`
    );
    expect(screen.getByTestId('platform-readiness')).toHaveTextContent(
      L('platform.readiness.ready') as string
    );
  });

  it('renders in Arabic, right to left', () => {
    const { container } = renderRtl(
      <PlatformOverview
        locale="ar"
        messages={getMessages('ar')}
        statistics={statistics}
        canReadOrganizations={false}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(container.textContent).toContain(
      getMessages('ar')['platform.overview.projectedRenewal']
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});

/** The fields of one section of the provisioning form, by its heading. */
function section(heading: string): HTMLElement {
  const element = screen.getByRole('heading', { name: heading }).closest('section');
  if (!element) throw new Error(`no section under the heading ${heading}`);
  return element as HTMLElement;
}

function fill(heading: string, label: string, value: string): void {
  fireEvent.change(within(section(heading)).getByLabelText(new RegExp(`^${label}`)), {
    target: { value },
  });
}

describe('provisioning an organisation', () => {
  const retired = { ...plan, id: 'retired-plan', planCode: 'test_plan_retired', status: 'retired' };

  function fillTheRequiredFields(): void {
    fill(L('platform.provision.organization'), L('platform.provision.code'), 'test_org_two');
    fill(
      L('platform.provision.organization'),
      L('platform.provision.name'),
      'Test Organisation Two'
    );
    fill(L('platform.provision.organization'), L('platform.provision.language'), 'ar');
    fill(L('platform.provision.organization'), L('platform.provision.timeZone'), 'Asia/Riyadh');
    fill(L('platform.provision.company'), L('platform.provision.code'), 'test_company_two');
    fill(L('platform.provision.company'), L('platform.provision.legalName'), 'Test Company Two');
    fill(L('platform.provision.company'), L('platform.provision.baseCurrency'), 'SAR');
    fill(L('platform.provision.branch'), L('platform.provision.code'), 'test_branch_two');
    fill(L('platform.provision.branch'), L('platform.provision.name'), 'Test Branch Two');
    fill(L('platform.provision.branch'), L('platform.provision.timeZone'), 'Asia/Riyadh');
    fill(
      L('platform.provision.administrator'),
      L('platform.provision.email'),
      'operator@test.invalid'
    );
    fill(
      L('platform.provision.administrator'),
      L('platform.provision.displayName'),
      'Test Operator'
    );
  }

  it('offers only a plan that is available, and sends what was typed', async () => {
    provisionOrganizationAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.provision.done',
      attempt: 1,
      tenantId: TENANT,
    });
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={[plan, retired]}
        canActivate
      />
    );

    const planSelect = within(section(L('platform.provision.subscription'))).getByLabelText(
      new RegExp(`^${L('platform.provision.plan')}`)
    );
    expect(
      within(planSelect)
        .getAllByRole('option')
        .map((option) => option.textContent)
    ).toEqual([L('platform.provision.noSubscription'), 'Test Plan']);

    fillTheRequiredFields();
    fill(L('platform.provision.subscription'), L('platform.provision.plan'), 'test_plan');
    fill(L('platform.provision.subscription'), L('platform.provision.startDate'), '2026-10-01');
    await userEvent.click(
      screen.getByRole('checkbox', { name: new RegExp(L('platform.provision.activate')) })
    );
    await userEvent.click(screen.getByRole('button', { name: L('platform.provision.submit') }));

    await waitFor(() => expect(provisionOrganizationAction).toHaveBeenCalledTimes(1));
    const form = provisionOrganizationAction.mock.calls[0]?.[1] as FormData;
    expect(form.get('tenantCode')).toBe('test_org_two');
    expect(form.get('tenantName')).toBe('Test Organisation Two');
    expect(form.get('tenantLocale')).toBe('ar');
    expect(form.get('companyCode')).toBe('test_company_two');
    expect(form.get('companyCurrency')).toBe('SAR');
    expect(form.get('branchName')).toBe('Test Branch Two');
    expect(form.get('ownerEmail')).toBe('operator@test.invalid');
    expect(form.get('planCode')).toBe('test_plan');
    expect(form.get('subscriptionStart')).toBe('2026-10-01');
    expect(form.get('activate')).toBe('on');
  });

  it('states that the administrator is emailed, and opens the organisation it created', async () => {
    provisionOrganizationAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.provision.done',
      attempt: 1,
      tenantId: TENANT,
    });
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={[plan]}
        canActivate={false}
      />
    );
    fillTheRequiredFields();
    await userEvent.click(screen.getByRole('button', { name: L('platform.provision.submit') }));

    expect(await screen.findByRole('status')).toHaveTextContent(L('platform.provision.done'));
    await waitFor(() => expect(push).toHaveBeenCalledWith(`/en/platform/organizations/${TENANT}`));
  });

  it('keeps what was typed and shows the server refusal against its own field', async () => {
    provisionOrganizationAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.invalid',
      attempt: 1,
      fieldErrors: { tenantCode: 'platform.error.planCode' },
    });
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={null}
        canActivate={false}
      />
    );
    fillTheRequiredFields();
    await userEvent.click(screen.getByRole('button', { name: L('platform.provision.submit') }));

    expect(
      await within(section(L('platform.provision.organization'))).findByRole('alert')
    ).toHaveTextContent(L('platform.error.planCode'));
    expect(
      within(section(L('platform.provision.organization'))).getByLabelText(
        new RegExp(`^${L('platform.provision.name')}`)
      )
    ).toHaveValue('Test Organisation Two');
  });

  it('offers no subscription when the plan catalogue could not be read, and no activation without the authority', () => {
    renderLtr(
      <ProvisionOrganizationScreen
        locale="en"
        messages={messages}
        plans={null}
        canActivate={false}
      />
    );
    expect(
      screen.queryByRole('heading', { name: L('platform.provision.subscription') })
    ).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByText(L('platform.provision.administratorHint'))).toBeInTheDocument();
  });
});

describe('the plan catalogue', () => {
  const unlimited = {
    ...plan,
    id: '55555555-5555-4555-8555-555555555555',
    planCode: 'test_plan_open',
    name: 'Test Plan Open',
    displayName: 'Test Plan Open',
    listPrice: null,
    currencyCode: null,
    termMonths: null,
    capacityLimits: {},
    status: 'draft',
  };

  it('shows the price, the term and an absent limit as unlimited', () => {
    renderLtr(<PlansScreen locale="en" messages={messages} plans={[plan, unlimited]} />);
    const rows = screen.getAllByTestId('platform-plan');
    expect(within(rows[0] as HTMLElement).getByText('1,200.00 SAR')).toBeInTheDocument();
    expect(within(rows[0] as HTMLElement).getByText(/12 months/)).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getByText(L('platform.plans.noPrice'))
    ).toBeInTheDocument();
    expect(
      within(rows[1] as HTMLElement).getAllByText(new RegExp(`${L('platform.usage.unlimited')}$`))
    ).toHaveLength(3);
  });

  it('sends a new plan with its price as a decimal string and a blank limit as no limit', async () => {
    createPlanAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.plans.created',
      attempt: 1,
    });
    renderLtr(<PlansScreen locale="en" messages={messages} plans={[plan]} />);
    await userEvent.click(screen.getByRole('button', { name: L('platform.plans.new') }));
    const dialog = await screen.findByRole('dialog');

    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.code')}`)),
      'test_plan_two'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.name')}`)),
      'Test Plan Two'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.currency')}`)),
      'sar'
    );
    const price = within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.price')}`));
    await userEvent.type(price, '2400');
    fireEvent.blur(price);
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.termMonths')}`)),
      '24'
    );
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.from')}`)), {
      target: { value: '2027-01-01' },
    });
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.capacity.companies')}`)),
      '5'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(createPlanAction).toHaveBeenCalledTimes(1));
    const input = createPlanAction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(input.listPrice).toBe('2400.0000');
    expect(typeof input.listPrice).toBe('string');
    expect(input).toMatchObject({
      planCode: 'test_plan_two',
      displayName: 'Test Plan Two',
      currencyCode: 'SAR',
      termMonths: 24,
      capacityLimits: { companies: 5 },
      status: 'draft',
      effectiveFrom: '2027-01-01',
    });
    expect(Object.keys(input.capacityLimits as object)).toEqual(['companies']);
    expect(typeof input.termMonths).toBe('number');
  });

  it('edits under the version the operator was looking at, and freezes the code', async () => {
    updatePlanAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.plans.updated',
      attempt: 1,
    });
    renderLtr(<PlansScreen locale="en" messages={messages} plans={[plan]} />);
    await userEvent.click(screen.getAllByRole('button', { name: L('platform.plans.edit') })[0]!);
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.code')}`))
    ).toHaveAttribute('readonly');

    const name = within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.name')}`));
    await userEvent.clear(name);
    await userEvent.type(name, 'Test Plan Renamed');
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(updatePlanAction).toHaveBeenCalledTimes(1));
    const [planId, version, input] = updatePlanAction.mock.calls[0] as [
      string,
      number,
      Record<string, unknown>,
    ];
    expect(planId).toBe(PLAN);
    expect(version).toBe(1);
    expect(input).toMatchObject({ planCode: 'test_plan', displayName: 'Test Plan Renamed' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('the activity search', () => {
  const event = {
    id: '66666666-6666-4666-8666-666666666666',
    action: 'org.tenant.provisioned',
    entityType: 'org.tenant',
    entityId: TENANT,
    actorId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    actorKind: 'user',
    correlationId: null,
    targetTenantId: TENANT,
    occurredAt: '2026-09-16T09:00:00.000Z',
  };

  function renderScreen() {
    renderLtr(
      <PlatformAuditScreen
        locale="en"
        messages={messages}
        initialFrom="2026-08-17"
        initialTo="2026-09-16"
        initialOrganizationId=""
        organizations={[row]}
      />
    );
  }

  it('opens on the window it was given and names the change and the organisation', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [event], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();

    expect(await screen.findByText(L('platform.audit.action.0'))).toBeInTheDocument();
    const first = new URLSearchParams(String(apiGet.mock.calls[0]?.[0]).split('?')[1]);
    expect(first.get('from')).toBe('2026-08-17T00:00:00.000Z');
    expect(first.get('to')).toBe('2026-09-16T23:59:59.999Z');
    expect(first.get('action')).toBeNull();
    expect(first.get('targetTenantId')).toBeNull();
    const table = screen.getByRole('table');
    expect(within(table).getByText('Test Organisation One')).toBeInTheDocument();
    expect(within(table).getByText(L('platform.audit.actor.user'))).toBeInTheDocument();
  });

  it('applies the criteria together, and only when they are asked for', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [event], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();
    await screen.findByText(L('platform.audit.action.0'));

    await userEvent.selectOptions(
      screen.getByLabelText(new RegExp(`^${L('platform.audit.column.action')}`)),
      'org.subscription_charge.recorded'
    );
    await userEvent.selectOptions(
      screen.getByLabelText(new RegExp(`^${L('platform.audit.column.organization')}`)),
      TENANT
    );
    fireEvent.change(screen.getByLabelText(new RegExp(`^${L('platform.audit.from')}`)), {
      target: { value: '2026-09-01' },
    });
    expect(apiGet).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: L('platform.audit.apply') }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const applied = new URLSearchParams(String(apiGet.mock.calls[1]?.[0]).split('?')[1]);
    expect(applied.get('from')).toBe('2026-09-01T00:00:00.000Z');
    expect(applied.get('action')).toBe('org.subscription_charge.recorded');
    expect(applied.get('targetTenantId')).toBe(TENANT);
  });
});
