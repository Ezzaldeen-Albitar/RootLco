import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
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
 *   - billing shows the server's outstanding figure, submits money as a
 *     canonical decimal STRING, and reaches the charges behind the page by the
 *     server's own cursor under the status filter the operation publishes;
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
 *   - account and security validates each password field before it asks the
 *     server, reveals each field on its own, states what the server reported
 *     about the operator's other devices, and tells the two server refusals
 *     apart on screen.
 *
 * Every business value below is a test value invented for this file.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;
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
  usePathname: () => mockPathname,
}));

/**
 * The address the route boundaries read their language from.
 *
 * A constant here would have made the three boundary files untestable in the
 * only respect they exist for: `loading.tsx`, `error.tsx` and `not-found.tsx`
 * are given no props by Next, so the locale can only come from the path
 * (P1-26-F-059, P1-26-F-071). Every case resets it to the English console
 * address in `beforeEach`.
 */
let mockPathname = '/en/platform';

const assignSubscriptionAction = vi.fn();
const cancelSubscriptionAction = vi.fn();
const recordChargeAction = vi.fn();
const recordReceiptAction = vi.fn();
const voidChargeAction = vi.fn();
const changeOrganizationStatusAction = vi.fn();
const provisionOrganizationAction = vi.fn();
const createPlanAction = vi.fn();
const updatePlanAction = vi.fn();
const changeOwnPasswordAction = vi.fn();
vi.mock('@/features/platform/actions', () => ({
  /*
   * P1-32-PRE-068. This module holds only the writes, and every one is stood in
   * for. The organisation list and the activity search live in
   * `features/platform/table-reads.ts`, which is not replaced: this suite drives
   * their real implementation through the replaced HTTP client above.
   */
  assignSubscriptionAction: (...args: unknown[]) => assignSubscriptionAction(...args),
  cancelSubscriptionAction: (...args: unknown[]) => cancelSubscriptionAction(...args),
  recordChargeAction: (...args: unknown[]) => recordChargeAction(...args),
  recordReceiptAction: (...args: unknown[]) => recordReceiptAction(...args),
  voidChargeAction: (...args: unknown[]) => voidChargeAction(...args),
  changeOrganizationStatusAction: (...args: unknown[]) => changeOrganizationStatusAction(...args),
  provisionOrganizationAction: (...args: unknown[]) => provisionOrganizationAction(...args),
  createPlanAction: (...args: unknown[]) => createPlanAction(...args),
  updatePlanAction: (...args: unknown[]) => updatePlanAction(...args),
  changeOwnPasswordAction: (...args: unknown[]) => changeOwnPasswordAction(...args),
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
const { AccountSecurityScreen } =
  await import('@/features/platform/components/AccountSecurityScreen');
const { getMessages } = await import('@/i18n/get-messages');

const messages = getMessages('en');
const TENANT = '11111111-1111-4111-8111-111111111111';
/** Two more organisations, for the expiry window cases on the overview. */
const OTHER_TENANT = '11111111-1111-4111-8111-111111111112';
const THIRD_TENANT = '11111111-1111-4111-8111-111111111113';
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
  canManageOrganization: true,
  canManageSubscription: true,
  canReadBilling: true,
  canManageBilling: true,
  canReadAudit: true,
};
const NONE = {
  canChangeLifecycle: false,
  canManageOrganization: false,
  canManageSubscription: false,
  canReadBilling: false,
  canManageBilling: false,
  canReadAudit: false,
};

beforeEach(() => {
  mockPathname = '/en/platform';
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
  changeOwnPasswordAction.mockReset();
  // The default answer for the account form: a change the server accepted and
  // whose other-device sign-out it reported. A case that needs another answer
  // replaces it before it renders.
  changeOwnPasswordAction.mockResolvedValue({
    status: 'success',
    messageKey: 'platform.account.done',
    attempt: 1,
  });
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

  /**
   * Owner directive, user-facing errors. A subscription change that names the
   * plan already in force is a real mistake with a real cure, and the console
   * reported it as the generic 'this record cannot take that change'. The
   * service now names the rule beside the plan control, and the dialog renders
   * the sentence it selects, which says what to do instead — record a renewal.
   *
   * The mocked state is the one the wire actually produces, and nothing more.
   * The service files the rule under `body.planCode`, so `violationKeysOf`
   * routes it to the plan control and the banner keeps the generic conflict
   * sentence; an earlier version of this case also set `messageKey` to the
   * specific key and so asserted a state the pipeline cannot build. The
   * assertion is therefore on the plan control's own error line, which is the
   * place an operator would actually read it.
   */
  it('states why a plan change was refused, in words the operator can act on', async () => {
    assignSubscriptionAction.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      fieldErrors: { planCode: 'form.violation.platform_change_needs_different_plan' },
      correlationId: 'corr-same-plan',
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
      { target: { value: '2026-10-01' } }
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.reason')}`)),
      'Wrong plan chosen'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(assignSubscriptionAction).toHaveBeenCalledTimes(1));
    const select = within(dialog).getByLabelText(new RegExp(`^${L('platform.subscription.plan')}`));
    const said = await within(dialog).findByText(
      L('form.violation.platform_change_needs_different_plan') as string
    );
    expect(said).toBeVisible();
    // Tied to the control, not merely present somewhere in the dialog: the
    // error line is what the select points at, so a screen reader reaches it
    // from the field.
    expect(select.getAttribute('aria-describedby') ?? '').toContain(said.id);
    expect(select).toHaveAttribute('aria-invalid', 'true');
    // The rule name itself never reaches the screen; only its sentence does.
    expect(dialog.textContent).not.toContain('platform_change_needs_different_plan');
    expect(refresh).not.toHaveBeenCalled();
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
        hasMore={false}
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
        hasMore={false}
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

  it('moves the cursor to a refused charge field and withdraws the complaint once it is edited (route sweep B3)', async () => {
    recordChargeAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { dueOn: 'platform.error.required' },
      attempt: 1,
    });
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore={false}
        subscriptions={[subscription]}
        canManage
        defaultCurrency="SAR"
      />
    );
    await userEvent.click(screen.getByRole('button', { name: L('platform.billing.recordCharge') }));
    const dialog = await screen.findByRole('dialog');
    const amount = within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.amount')}`));
    await userEvent.type(amount, '1200');
    fireEvent.blur(amount);
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));
    const due = within(dialog).getByLabelText(new RegExp(`^${L('platform.billing.due')}`));
    await waitFor(() => expect(due).toHaveFocus());
    expect(due).toHaveAttribute('aria-invalid', 'true');
    fireEvent.change(due, { target: { value: '2026-10-15' } });
    expect(due).not.toHaveAttribute('aria-invalid', 'true');
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
        hasMore={false}
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
        hasMore={false}
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.queryByRole('button', { name: L('platform.billing.recordCharge') })).toBeNull();
    expect(screen.queryByRole('button', { name: L('platform.billing.void') })).toBeNull();
    expect(screen.getByText(/500\.00 SAR/)).toBeInTheDocument();
  });

  /*
   * The commercial model is the Owner's decision D-OD-04: the Platform Owner
   * enters each charge and each payment, and no payment provider exists in this
   * repository. A panel headed "Billing" that offers "Record payment" is read as
   * the front of a system collecting money unless it says otherwise, so the
   * sentence is asserted for its content and not merely for its presence.
   */
  it('states that every charge and payment is entered by hand, and that nothing collects itself', () => {
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore={false}
        subscriptions={[]}
        canManage
        defaultCurrency="SAR"
      />
    );
    const note = screen.getByTestId('platform-billing-model');
    expect(note).toHaveTextContent(L('platform.billing.recordedNote'));
    expect(note.textContent ?? '').toMatch(/entered by the platform owner/i);
    expect(note.textContent ?? '').toMatch(/no subscription renews or charges itself/i);
  });

  it('says more charges exist behind the page when the server said so, and otherwise says nothing', () => {
    const { unmount } = renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore={false}
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.queryByTestId('platform-billing-more')).toBeNull();
    unmount();

    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    // The count is the rows actually drawn, so the sentence cannot claim to have
    // examined more than it did.
    expect(screen.getByTestId('platform-billing-more')).toHaveTextContent(
      'Charges shown on this page: 1.'
    );
  });

  /*
   * The sentence has to read correctly at EVERY count, in a catalogue with no
   * plural forms. "The first 1 charges are shown" was grammatical at two and
   * wrong at one, and a test pinning the wrong half would have made it
   * permanent — so both counts are read here, and in Arabic as well.
   */
  it('states the page count grammatically at one charge and at several, in both languages', () => {
    const second = { ...charge, id: '44444444-4444-4444-8444-444444444445' };
    const { unmount } = renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge, second]}
        hasMore
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.getByTestId('platform-billing-more')).toHaveTextContent(
      'Charges shown on this page: 2. More exist beyond them.'
    );
    unmount();

    renderRtl(
      <BillingPanel
        locale="ar"
        messages={getMessages('ar')}
        tenantId={TENANT}
        charges={[charge]}
        hasMore
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    // The digits are the locale's, so the words either side of the count are
    // what the sentence is recognised by.
    const arabic = screen.getByTestId('platform-billing-more').textContent ?? '';
    expect(arabic).toContain('الرسوم الظاهرة في هذه الصفحة');
    expect(arabic).toContain('توجد رسوم أخرى بعدها');
    expect(AR['platform.billing.morePages']).not.toBe(EN['platform.billing.morePages']);
    // The commercial sentence is new too, and an Arabic reader is the one most
    // likely to meet this console first.
    expect(screen.getByTestId('platform-billing-model')).toHaveTextContent(
      AR['platform.billing.recordedNote'] as string
    );
  });

  /*
   * P1-32-PRE-OD-CONSOLE-006. Saying that more charges exist was the whole of
   * the answer while there was no way to open them: the panel read one page and
   * offered no link to the next, so an organisation with more charges than a
   * page holds kept them out of reach. `platform.charge-list` pages by cursor
   * and filters by status, and these cases pin that the links carry the server's
   * own cursor and nothing invented.
   */
  it('offers the next page only with the cursor the server gave, and a way back to the first', () => {
    const { unmount } = renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore
        nextCursor="cursor-2"
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.getByTestId('platform-billing-next')).toHaveAttribute(
      'href',
      `/en/platform/organizations/${TENANT}?chargeCursor=cursor-2`
    );
    // The first page is where this reader already is, so nothing offers to
    // return to it.
    expect(screen.queryByTestId('platform-billing-first')).toBeNull();
    unmount();

    // A later page under a filter: back to the first page of the SAME filter,
    // and no next link at the end of the set even though a cursor came with it.
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore={false}
        nextCursor="cursor-3"
        status="open"
        paged
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.getByTestId('platform-billing-first')).toHaveAttribute(
      'href',
      `/en/platform/organizations/${TENANT}?chargeStatus=open`
    );
    expect(screen.queryByTestId('platform-billing-next')).toBeNull();
  });

  it('draws no pager at all on a single unfiltered page', () => {
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore={false}
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.queryByTestId('platform-billing-pager')).toBeNull();
  });

  it('asks for a chosen status from the first page, never with the previous set cursor', async () => {
    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[charge]}
        hasMore
        nextCursor="cursor-2"
        paged
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    const filter = screen.getByLabelText(new RegExp(`^${L('platform.billing.filterStatus')}`));
    // Every status the operation accepts is offered, and nothing else.
    expect([...(filter as HTMLSelectElement).options].map((option) => option.value)).toEqual([
      '',
      'open',
      'settled',
      'void',
    ]);

    await userEvent.selectOptions(filter, 'settled');
    expect(push).toHaveBeenCalledWith(`/en/platform/organizations/${TENANT}?chargeStatus=settled`);
    // A cursor belongs to the ordering of the set it came from, so choosing a
    // status starts again rather than carrying it.
    expect(String(push.mock.calls[0]?.[0])).not.toContain('chargeCursor');
  });

  it('says that no charge carries the chosen status, rather than that none was ever recorded', () => {
    const { unmount } = renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[]}
        hasMore={false}
        status="void"
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.getByText(L('platform.billing.noneWithStatus'))).toBeInTheDocument();
    expect(screen.queryByText(L('platform.billing.none'))).toBeNull();
    unmount();

    renderLtr(
      <BillingPanel
        locale="en"
        messages={messages}
        tenantId={TENANT}
        charges={[]}
        hasMore={false}
        subscriptions={[]}
        canManage={false}
        defaultCurrency=""
      />
    );
    expect(screen.getByText(L('platform.billing.none'))).toBeInTheDocument();
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
        organizations={null}
      />
    );
    const revenue = screen.getByRole('table', { name: L('platform.overview.revenue') as string });
    const headers = within(revenue)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
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
        organizations={null}
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

  it('draws an organisation past its ceiling as the most severe state, not the mildest', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={{
          ...statistics,
          capacityAlerts: [
            {
              tenantId: TENANT,
              tenantCode: 'test_org_one',
              displayName: 'Test Organisation One',
              kind: 'branches',
              used: 4,
              limit: 3,
              severity: 'over-limit',
            },
          ],
        }}
        canReadOrganizations={false}
        organizations={null}
      />
    );
    const line = screen.getByText(new RegExp(`${L('platform.capacity.overLimit')}$`));
    expect(line).toHaveTextContent('4 / 3');
    expect(line.textContent).not.toContain(L('platform.capacity.nearLimit'));
    const frame = line.closest('li');
    expect(frame?.className).toContain('bg-error-subtle');
    expect(frame?.className).not.toContain('bg-warning-subtle');
  });

  /*
   * The expiry TILES publish counts; these cases are about the organisations
   * behind them. A count an operator cannot act on is a number, not a warning,
   * so each organisation inside the window is named and linked to its detail —
   * and the three states of that read (not offered, failed, answered) are three
   * different sentences rather than one empty table.
   */
  const organizationRow = (over: Record<string, unknown> = {}) => ({
    id: TENANT,
    tenantCode: 'test_org_one',
    displayName: 'Test Organisation One',
    status: 'active',
    defaultLocale: 'en',
    defaultTimezone: 'Asia/Riyadh',
    createdAt: '2026-01-01T00:00:00.000Z',
    activePlanCode: 'test_plan_one',
    activePlanEffectiveTo: '2026-10-01T00:00:00.000Z',
    activeCompanyCount: 1,
    activeBranchCount: 2,
    activeUserCount: 9,
    ...over,
  });

  const organizationsRead = (rows: readonly unknown[], hasMore = false) =>
    ({
      status: 'ok',
      data: { items: rows, nextCursor: null, hasMore },
      correlationId: 'cid-organizations',
    }) as never;

  it('names each organisation whose subscription ends inside the window, and links to it', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
        organizations={organizationsRead([
          organizationRow(),
          organizationRow({
            id: OTHER_TENANT,
            displayName: 'Test Organisation Two',
            activePlanEffectiveTo: '2027-06-01T00:00:00.000Z',
          }),
          organizationRow({
            id: THIRD_TENANT,
            displayName: 'Test Organisation Three',
            activePlanEffectiveTo: '2026-09-01T00:00:00.000Z',
          }),
        ])}
      />
    );

    const table = screen.getByRole('table', {
      name: L('platform.overview.expiringOrganizations'),
    });
    const rows = within(table).getAllByRole('row').slice(1);
    // The one beyond ninety days is absent; the one already past is present and
    // says so rather than counting down into a negative number.
    expect(rows).toHaveLength(2);
    expect(rows[0]?.textContent).toContain('Test Organisation Three');
    expect(rows[0]?.textContent).toContain(L('platform.overview.alreadyEnded'));
    expect(rows[1]?.textContent).toContain('Test Organisation One');
    expect(within(table).queryByText('Test Organisation Two')).toBeNull();
    expect(within(table).getByRole('link', { name: 'Test Organisation One' })).toHaveAttribute(
      'href',
      `/en/platform/organizations/${TENANT}`
    );
  });

  it('states what it examined, and says when more organisations exist behind the page', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
        organizations={organizationsRead([organizationRow()], true)}
      />
    );
    expect(screen.getByText(/The first 1 organisations were examined/)).toHaveTextContent(
      L('platform.overview.expiringMore')
    );
  });

  it('says the organisations could not be read rather than showing none expiring', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
        organizations={{ status: 'unavailable', correlationId: 'cid-organizations' }}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(L('platform.overview.expiringUnavailable'));
    expect(screen.getByRole('alert')).toHaveTextContent('cid-organizations');
    expect(screen.queryByText(L('platform.overview.noExpiring'))).toBeNull();
  });

  it('says the list was never asked for when the operator holds no organisation code', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations={false}
        organizations={null}
      />
    );
    expect(screen.getByText(L('platform.overview.expiringNotOffered'))).toBeInTheDocument();
    expect(screen.queryByText(L('platform.overview.noExpiring'))).toBeNull();
  });

  it('reports an empty window as empty, once the page was actually read', () => {
    renderLtr(
      <PlatformOverview
        locale="en"
        messages={messages}
        statistics={statistics}
        canReadOrganizations
        organizations={organizationsRead([organizationRow({ activePlanEffectiveTo: null })])}
      />
    );
    expect(screen.getByText(L('platform.overview.noExpiring'))).toBeInTheDocument();
  });

  it('renders in Arabic, right to left', () => {
    const { container } = renderRtl(
      <PlatformOverview
        locale="ar"
        messages={getMessages('ar')}
        statistics={statistics}
        canReadOrganizations={false}
        organizations={null}
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

  /*
   * `plan_document` — `platform/application/subscription-service.ts:566`,
   * against `body`. It names no control because it cannot: the refusal is the
   * plan document as a whole, an entitlement naming a feature that is not one
   * the platform has or a limit outside the range its column admits. A
   * whole-request violation travels to the banner, which this dialog draws.
   */
  it('shows the whole-plan refusal in the dialog banner, with what was typed still there', async () => {
    createPlanAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.plan_document',
      correlationId: 'c-plan',
      attempt: 1,
    });
    renderLtr(<PlansScreen locale="en" messages={messages} plans={[plan]} />);
    await userEvent.click(screen.getByRole('button', { name: L('platform.plans.new') }));
    const dialog = await screen.findByRole('dialog');

    const code = within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.code')}`));
    await userEvent.type(code, 'test_plan_three');
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.name')}`)),
      'Test Plan Three'
    );
    fireEvent.change(within(dialog).getByLabelText(new RegExp(`^${L('platform.plans.from')}`)), {
      target: { value: '2027-01-01' },
    });
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    expect(await within(dialog).findByText(L('form.violation.plan_document'))).toBeVisible();
    expect(code).toHaveValue('test_plan_three');
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

  /*
   * The server caps the window at 92 days and refuses a wider one as a
   * validation failure. A refused read reaches the table as the undifferentiated
   * error state — "something went wrong" over a Retry that can only be refused
   * again — so the screen names the limit before it spends the request.
   */
  it('refuses a window wider than the server accepts, naming the limit, and asks for nothing', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [event], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();
    await screen.findByText(L('platform.audit.action.0'));

    fireEvent.change(screen.getByLabelText(new RegExp(`^${L('platform.audit.from')}`)), {
      target: { value: '2026-01-01' },
    });
    await userEvent.click(screen.getByRole('button', { name: L('platform.audit.apply') }));

    expect(await screen.findByText('Choose a range of 92 days or fewer.')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('refuses an end date before the start date, and withdraws the complaint on an edit', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [event], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();
    await screen.findByText(L('platform.audit.action.0'));

    fireEvent.change(screen.getByLabelText(new RegExp(`^${L('platform.audit.to')}`)), {
      target: { value: '2026-08-01' },
    });
    await userEvent.click(screen.getByRole('button', { name: L('platform.audit.apply') }));
    expect(await screen.findByText(L('platform.audit.error.range'))).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByLabelText(new RegExp(`^${L('platform.audit.to')}`)), {
      target: { value: '2026-09-15' },
    });
    await waitFor(() => expect(screen.queryByText(L('platform.audit.error.range'))).toBeNull());

    await userEvent.click(screen.getByRole('button', { name: L('platform.audit.apply') }));
    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const applied = new URLSearchParams(String(apiGet.mock.calls[1]?.[0]).split('?')[1]);
    expect(applied.get('to')).toBe('2026-09-15T23:59:59.999Z');
  });

  /*
   * The criteria are held outside the table request on purpose, so the table
   * cannot tell a narrowed search from an empty trail. Left to itself it said
   * "Nothing here yet" — a claim about every change ever made from this console
   * — on the evidence of one window that held none.
   */
  it('says no change matches the criteria, rather than that the record is empty', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();

    const empty = await screen.findByTestId('platform-audit-empty');
    expect(empty).toHaveTextContent(L('platform.audit.noMatches'));
    expect(screen.queryByText(L('state.empty.title'))).toBeNull();
    /*
     * ANNOUNCED, not merely printed. The rows disappear on a search that
     * matched nothing; a bare paragraph in their place leaves an operator who
     * cannot see the table with no announcement and no heading to land on, so
     * the sentence is carried by the shared state shell.
     */
    const announced = within(empty).getByRole('status');
    expect(within(announced).getByRole('heading')).toHaveTextContent(L('state.noResults.title'));
  });

  /*
   * Arabic, right to left, and by keyboard alone — the three things the English
   * mouse-driven cases above cannot show. Both refusals and the zero-row
   * sentence are the screen's own new words, so all three are read in Arabic.
   */
  it('refuses the window and states the empty result in Arabic, right to left', async () => {
    const arabic = getMessages('ar');
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderRtl(
      <PlatformAuditScreen
        locale="ar"
        messages={arabic}
        initialFrom="2026-08-17"
        initialTo="2026-09-16"
        initialOrganizationId=""
        organizations={[row]}
      />
    );

    expect(document.documentElement.dir).toBe('rtl');
    const empty = await screen.findByTestId('platform-audit-empty');
    expect(empty).toHaveTextContent(AR['platform.audit.noMatches'] as string);
    // Real Arabic, not an English string sitting in the Arabic catalogue.
    expect(AR['platform.audit.noMatches']).not.toBe(EN['platform.audit.noMatches']);

    fireEvent.change(screen.getByLabelText(new RegExp(`^${AR['platform.audit.from'] as string}`)), {
      target: { value: '2026-01-01' },
    });
    await userEvent.click(
      screen.getByRole('button', { name: AR['platform.audit.apply'] as string })
    );
    // The day count is formatted in the locale's own digits, so the sentence is
    // recognised by its words rather than by a hard-coded numeral.
    expect(await screen.findByText(/اختر مدة لا تتجاوز/)).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledTimes(1);
  });

  it('applies the criteria from the keyboard alone', async () => {
    apiGet.mockResolvedValue({
      ok: true,
      data: { items: [event], nextCursor: null, hasMore: false },
      correlationId: 'c',
    });
    renderScreen();
    await screen.findByText(L('platform.audit.action.0'));

    fireEvent.change(screen.getByLabelText(new RegExp(`^${L('platform.audit.from')}`)), {
      target: { value: '2026-09-01' },
    });
    const apply = screen.getByRole('button', { name: L('platform.audit.apply') });
    apply.focus();
    expect(apply).toHaveFocus();
    await userEvent.keyboard('{Enter}');

    await waitFor(() => expect(apiGet).toHaveBeenCalledTimes(2));
    const applied = new URLSearchParams(String(apiGet.mock.calls[1]?.[0]).split('?')[1]);
    expect(applied.get('from')).toBe('2026-09-01T00:00:00.000Z');
  });
});

// --- account and security ------------------------------------------------------
//
// Folded into this file rather than given its own, because the P1-27 evidence
// seal digests a stated count of web test FILES: a new file moves a sealed
// record, and these cases belong to the same console the rest of this file
// covers. Names are prefixed so nothing here can collide with the console
// fixtures above.

const ACCOUNT_SESSION = {
  userId: '22222222-2222-4222-8222-222222222222',
  homeTenantId: TENANT,
  platformPermissions: ['platform.organization.read', 'platform.statistics.read'],
} as const;

const ACCOUNT_CURRENT = 'the-current-password';
const ACCOUNT_NEXT = 'a-different-password';

function renderAccount(locale: 'en' | 'ar' = 'en') {
  const catalogue = getMessages(locale);
  const paint = locale === 'en' ? renderLtr : renderRtl;
  return paint(<AccountSecurityScreen messages={catalogue} session={ACCOUNT_SESSION} />);
}

/** The three password inputs, in the order the form declares them. */
function accountFields(): HTMLInputElement[] {
  return [
    document.querySelector<HTMLInputElement>('input[name="currentPassword"]'),
    document.querySelector<HTMLInputElement>('input[name="newPassword"]'),
    document.querySelector<HTMLInputElement>('input[name="confirmPassword"]'),
  ].map((element, index) => {
    if (!element) throw new Error(`password field ${index} is not rendered`);
    return element;
  });
}

async function fillAccount(values: readonly [string, string, string]) {
  const user = userEvent.setup();
  const inputs = accountFields();
  for (const [index, value] of values.entries()) {
    const input = inputs[index] as HTMLInputElement;
    await user.clear(input);
    await user.type(input, value);
  }
  return user;
}

describe('the account screen shows the identity the console session carries', () => {
  it('names the operator, its home organisation and every authority code it holds', () => {
    renderAccount();
    expect(screen.getByTestId('account-operator-id')).toHaveTextContent(ACCOUNT_SESSION.userId);
    expect(screen.getByTestId('account-home-tenant')).toHaveTextContent(
      ACCOUNT_SESSION.homeTenantId
    );
    for (const code of ACCOUNT_SESSION.platformPermissions) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
  });

  it('offers a change-password form with three fields and no address field', () => {
    renderAccount();
    expect(accountFields()).toHaveLength(3);
    expect(document.querySelector('input[name="email"]')).toBeNull();
    expect(screen.getByRole('button', { name: L('platform.account.submit') })).toBeEnabled();
  });
});

describe('the form validates before it asks the server', () => {
  it('refuses an empty form and sends nothing', async () => {
    const user = userEvent.setup();
    renderAccount();
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));
    // One complaint per field, and nothing asked of the server.
    await waitFor(() => expect(screen.getAllByText(L('platform.error.required'))).toHaveLength(3));
    expect(changeOwnPasswordAction).not.toHaveBeenCalled();
    for (const field of accountFields()) expect(field).toHaveAttribute('aria-invalid', 'true');
  });

  it('refuses a confirmation that does not match, and marks only that field', async () => {
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, 'something-else-entirely']);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await screen.findByText(L('platform.account.error.mismatch'));
    expect(changeOwnPasswordAction).not.toHaveBeenCalled();
    const [current, next, confirm] = accountFields();
    expect(confirm).toHaveAttribute('aria-invalid', 'true');
    expect(current).not.toHaveAttribute('aria-invalid');
    expect(next).not.toHaveAttribute('aria-invalid');
  });

  it('refuses a new password equal to the current one, and withdraws the complaint on an edit', async () => {
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_CURRENT, ACCOUNT_CURRENT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await screen.findByText(L('platform.account.error.unchanged'));
    expect(changeOwnPasswordAction).not.toHaveBeenCalled();

    await user.type(accountFields()[1] as HTMLInputElement, '-and-more');
    await waitFor(() =>
      expect(screen.queryByText(L('platform.account.error.unchanged'))).toBeNull()
    );
  });

  it('carries the three values, and only those three, to the one server function', async () => {
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await waitFor(() => expect(changeOwnPasswordAction).toHaveBeenCalledTimes(1));
    const [sent] = changeOwnPasswordAction.mock.calls[0] as [Record<string, unknown>];
    expect(Object.keys(sent).sort()).toEqual(['confirmPassword', 'currentPassword', 'newPassword']);
  });
});

describe('every password field can be revealed on its own', () => {
  it('starts hidden, reveals the field its toggle controls, and leaves the others hidden', async () => {
    const user = userEvent.setup();
    renderAccount();
    const [current, next, confirm] = accountFields();
    expect([current?.type, next?.type, confirm?.type]).toEqual([
      'password',
      'password',
      'password',
    ]);

    const toggles = screen.getAllByTestId('password-reveal-toggle');
    expect(toggles).toHaveLength(3);

    await user.click(toggles[1] as HTMLElement);
    expect(accountFields().map((field) => field.type)).toEqual(['password', 'text', 'password']);
    expect(toggles[1]).toHaveAttribute('aria-pressed', 'true');

    await user.click(toggles[1] as HTMLElement);
    expect(accountFields().map((field) => field.type)).toEqual([
      'password',
      'password',
      'password',
    ]);
  });

  it('is reachable from the keyboard', async () => {
    const user = userEvent.setup();
    renderAccount();
    const [current] = accountFields();
    current?.focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getAllByTestId('password-reveal-toggle')[0]);
  });
});

describe('a success states what happened, and clears the fields', () => {
  it('announces the change, says the other devices stay signed in, and empties the form', async () => {
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    const done = await screen.findByTestId('account-password-done');
    expect(done).toHaveTextContent(L('platform.account.doneTitle'));
    expect(done).toHaveTextContent(L('platform.account.done'));
    expect(accountFields().map((field) => field.value)).toEqual(['', '', '']);
  });

  /**
   * DEF-T-11. The sentence used to read "Other devices were signed out", and a
   * session signed in elsewhere answered 200 for the whole measured window
   * afterwards. Both success sentences, and the hint shown before the change,
   * are asserted here against the words rather than the key: a key can be
   * renamed while the claim survives, and the claim is what was wrong.
   */
  it('claims no sign-out in either success sentence, or in the hint beside the form', () => {
    for (const key of [
      'platform.account.done',
      'platform.account.doneSessionsKept',
      'platform.account.passwordHint',
    ] as const) {
      expect(L(key)).not.toMatch(/were signed out|are signed out|have been signed out/i);
    }
    // And both languages say what does happen instead.
    expect(L('platform.account.done')).toMatch(/stays signed in/i);
    expect(L('platform.account.passwordHint')).toMatch(/does not sign out/i);
    expect(AR['platform.account.done'] as string).toContain('يبقى');
    expect(AR['platform.account.passwordHint'] as string).toContain('يبقى');
  });

  it('says the other devices were NOT signed out when that is what the server reported', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'success',
      messageKey: 'platform.account.doneSessionsKept',
      attempt: 1,
    });
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    const done = await screen.findByTestId('account-password-done');
    expect(done).toHaveTextContent(L('platform.account.doneSessionsKept'));
    expect(done).not.toHaveTextContent(L('platform.account.done'));
  });
});

describe('the two refusals are distinct, and mark different fields', () => {
  it('marks the current password when the identity provider would not verify it', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'platform.account.error.currentPassword',
      fieldErrors: { currentPassword: 'platform.account.error.currentPassword' },
      correlationId: 'c-1',
      attempt: 1,
    });
    renderAccount();
    const user = await fillAccount(['not-the-current-one', ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    // Once in the banner and once against the field the operator must correct.
    await waitFor(() =>
      expect(
        screen.getAllByText(L('platform.account.error.currentPassword')).length
      ).toBeGreaterThan(0)
    );
    expect(screen.queryByTestId('account-password-done')).toBeNull();
    const [current, next] = accountFields();
    expect(current).toHaveAttribute('aria-invalid', 'true');
    expect(next).not.toHaveAttribute('aria-invalid');
  });

  it('marks the new password when the identity provider refused it, with a different sentence', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'platform.account.error.refused',
      fieldErrors: { newPassword: 'platform.account.error.refused' },
      correlationId: 'c-2',
      attempt: 1,
    });
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, 'short', 'short']);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await waitFor(() =>
      expect(screen.getAllByText(L('platform.account.error.refused')).length).toBeGreaterThan(0)
    );
    expect(L('platform.account.error.refused')).not.toBe(
      L('platform.account.error.currentPassword')
    );
    const [current, next] = accountFields();
    expect(next).toHaveAttribute('aria-invalid', 'true');
    expect(current).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByTestId('account-password-done')).toBeNull();
  });
});

describe('a ceiling the identity provider never sees', () => {
  /*
   * `too_long` — `iam/domain/credential-policy.ts:85`, against
   * `body.newPassword`. The API bounds a new password from ABOVE only, because
   * an unbounded secret is an unbounded input to the provider's hashing routine;
   * strength stays the provider's decision. The sentence says only that what was
   * entered is longer than allowed, which is true at every place the token is
   * published and tells nobody anything about the rule's limit.
   */
  it('marks the new password, says it is too long, and leaves the other fields alone', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.formError',
      fieldErrors: { newPassword: 'form.violation.too_long' },
      correlationId: 'c-3',
      attempt: 1,
    });
    renderAccount();
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: L('platform.account.submit') }));

    await waitFor(() =>
      expect(screen.getAllByText(L('form.violation.too_long')).length).toBeGreaterThan(0)
    );
    const [current, next] = accountFields();
    expect(next).toHaveAttribute('aria-invalid', 'true');
    expect(current).not.toHaveAttribute('aria-invalid');
    // Nothing the operator typed is thrown away by a refusal they can correct.
    expect(current?.value).toBe(ACCOUNT_CURRENT);
    expect(next?.value).toBe(ACCOUNT_NEXT);
  });

  it('says it in Arabic on an Arabic screen', async () => {
    changeOwnPasswordAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.formError',
      fieldErrors: { newPassword: 'form.violation.too_long' },
      correlationId: 'c-4',
      attempt: 1,
    });
    renderAccount('ar');
    const user = await fillAccount([ACCOUNT_CURRENT, ACCOUNT_NEXT, ACCOUNT_NEXT]);
    await user.click(screen.getByRole('button', { name: AR['platform.account.submit'] as string }));

    const arabic = AR['form.violation.too_long'] as string;
    await waitFor(() => expect(screen.getAllByText(arabic).length).toBeGreaterThan(0));
    expect(arabic).toMatch(/[؀-ۿ]/);
    expect(arabic).not.toBe(L('form.violation.too_long'));
  });
});

describe('Arabic', () => {
  it('renders the screen right to left with catalogued Arabic', async () => {
    renderAccount('ar');
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR['platform.account.passwordTitle'] as string)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: AR['platform.account.submit'] as string })
    ).toBeInTheDocument();
    // Real Arabic, not an English string sitting in the Arabic catalogue.
    expect(AR['platform.account.title']).not.toBe(EN['platform.account.title']);
    expect(AR['platform.account.title']).toMatch(/[؀-ۿ]/);
  });

  it('keeps the reveal control on every field in Arabic too', async () => {
    const user = userEvent.setup();
    renderAccount('ar');
    const toggles = screen.getAllByTestId('password-reveal-toggle');
    expect(toggles).toHaveLength(3);
    await user.click(toggles[0] as HTMLElement);
    expect(accountFields()[0]?.type).toBe('text');
  });
});

// --- the console route group's own boundaries ----------------------------------
//
// Every console page is a Server Component that awaits at least one
// control-plane read, and each of those reads is rated `expensive-read`. The
// group carried no `loading.tsx`, `error.tsx` or `not-found.tsx` at all, so a
// slow read looked like a console that had stopped responding and a render that
// threw took the shell, the navigation and the language down with it. These
// three files are the workspace group's, written for this group.

const PlatformLoading = (await import('@/app/[locale]/(platform)/loading')).default;
const PlatformError = (await import('@/app/[locale]/(platform)/error')).default;
const PlatformNotFound = (await import('@/app/[locale]/(platform)/not-found')).default;

describe('the console route group draws its own waiting, failure and not-found screens', () => {
  it('says it is loading, in the language of the address', () => {
    renderLtr(<PlatformLoading />);
    expect(screen.getByText(L('state.loading'))).toBeInTheDocument();
  });

  it('says the page could not be found', () => {
    renderLtr(<PlatformNotFound />);
    expect(screen.getByText(L('state.notFound.title'))).toBeInTheDocument();
  });

  it('shows the failure reference and retries, and publishes nothing from the error itself', async () => {
    const reset = vi.fn();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    const failure = Object.assign(new Error('connect ECONNREFUSED /var/secret/socket'), {
      digest: 'digest-9',
    });

    renderLtr(<PlatformError error={failure} reset={reset} />);

    expect(screen.getByText(L('state.error.title'))).toBeInTheDocument();
    expect(screen.getByText('digest-9')).toBeInTheDocument();
    // The message and the path inside it stay off the screen and out of the log
    // line: a Next.js error message routinely carries both.
    expect(document.body.textContent ?? '').not.toContain('ECONNREFUSED');
    for (const call of logged.mock.calls) {
      expect(String(call[0])).not.toContain('ECONNREFUSED');
    }

    await userEvent.click(screen.getByRole('button', { name: L('state.retry') }));
    expect(reset).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  /*
   * The three files exist BECAUSE the language has to come from the address:
   * Next gives a boundary no props, so reading the default locale instead would
   * announce an Arabic waiting state to an English reader, and an English
   * failure inside an Arabic document (P1-26-F-059, P1-26-F-071). An English
   * address is the only one the cases above ever visit, which is exactly the
   * half that cannot fail — so each boundary is visited in Arabic too.
   */
  it('speaks Arabic on an Arabic address, in all three boundaries', async () => {
    mockPathname = '/ar/platform';

    const loading = renderRtl(<PlatformLoading />);
    expect(document.documentElement.dir).toBe('rtl');
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent(AR['state.loading'] as string);
    expect(status).not.toHaveTextContent(L('state.loading'));
    loading.unmount();

    const missing = renderRtl(<PlatformNotFound />);
    expect(screen.getByText(AR['state.notFound.title'] as string)).toBeInTheDocument();
    missing.unmount();

    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderRtl(<PlatformError error={new Error('boom')} reset={vi.fn()} />);
    expect(screen.getByText(AR['state.error.title'] as string)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: AR['state.retry'] as string })).toBeInTheDocument();
    logged.mockRestore();
  });

  it('falls back to the default language when the address carries none', () => {
    // Not hypothetical: `usePathname` returns `/` during a transition, and what
    // happens then must be a decision rather than a crash.
    mockPathname = '/';
    renderRtl(<PlatformLoading />);
    expect(screen.getByRole('status')).toHaveTextContent(AR['state.loading'] as string);
  });

  it('lets the keyboard reach and press the retry control', async () => {
    const reset = vi.fn();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderLtr(<PlatformError error={new Error('boom')} reset={reset} />);

    const retry = screen.getByRole('button', { name: L('state.retry') });
    await userEvent.tab();
    expect(retry).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(reset).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });
});
