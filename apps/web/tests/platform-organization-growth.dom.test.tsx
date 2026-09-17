import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * Growing an organisation from the console (P1-32-PRE-151).
 *
 * The properties under test:
 *
 *   - the three acts appear only for an operator holding
 *     `platform.organization.manage`, and the branch action waits for a company
 *     to belong to;
 *   - each dialog sends exactly what was typed to exactly one action, with the
 *     optional fields omitted rather than sent empty;
 *   - a second administrator cannot be asked for without a reason, which is the
 *     rule the backend enforces and the form must not contradict;
 *   - a plan below current usage is refused with a per-kind account, and the
 *     acceptance is a deliberate act with its own reason — the dialog re-sends
 *     the SAME request plus the acceptance, never a different one;
 *   - usage ABOVE a ceiling is stated as such rather than as "near the limit",
 *     in both languages.
 *
 * Every business value below is a test value invented for this file.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;
/** A catalogued English message, typed as present: a missing key fails the lookup visibly. */
const L = (key: string): string => EN[key] ?? `missing message ${key}`;

const refresh = vi.fn();
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  usePathname: () => '/en/platform',
}));

const addCompanyAction = vi.fn();
const addBranchAction = vi.fn();
const inviteAdministratorAction = vi.fn();
const resendAdministratorInvitationAction = vi.fn();
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
  addCompanyAction: (...args: unknown[]) => addCompanyAction(...args),
  addBranchAction: (...args: unknown[]) => addBranchAction(...args),
  inviteAdministratorAction: (...args: unknown[]) => inviteAdministratorAction(...args),
  resendAdministratorInvitationAction: (...args: unknown[]) =>
    resendAdministratorInvitationAction(...args),
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

const { OrganizationDetailScreen } =
  await import('@/features/platform/components/OrganizationDetailScreen');
const { getMessages } = await import('@/i18n/get-messages');

const messages = getMessages('en');
const arabicMessages = getMessages('ar');
const TENANT = '11111111-1111-4111-8111-111111111111';
const COMPANY = '55555555-5555-4555-8555-555555555555';
const PLAN = '33333333-3333-4333-8333-333333333333';

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
  companies: [{ id: COMPANY, code: 'test_company', legalName: 'Test Company', status: 'active' }],
  branches: [
    { id: 'b1', companyId: COMPANY, code: 'test_branch', name: 'Test Branch', status: 'active' },
  ],
  userCountsByStatus: [{ status: 'active', count: 4 }],
  subscriptions: [],
  subscriptionEvents: [],
  statusHistory: [],
  capacity: {
    companies: { used: 1, limit: 2 },
    branches: { used: 1, limit: null },
    users: { used: 4, limit: 10 },
  },
};

const NONE = {
  canChangeLifecycle: false,
  canManageOrganization: false,
  canManageSubscription: false,
  canReadBilling: false,
  canManageBilling: false,
  canReadAudit: false,
};

const done = (key: string) => ({ status: 'success' as const, messageKey: key, attempt: 1 });

function renderDetail(
  overrides: Partial<typeof detail> = {},
  capabilities: Partial<typeof NONE> = {}
) {
  return renderLtr(
    <OrganizationDetailScreen
      locale="en"
      messages={messages}
      organization={{ ...detail, ...overrides }}
      plans={[plan]}
      charges={null}
      capabilities={{ ...NONE, ...capabilities }}
      today="2026-09-17"
    />
  );
}

beforeEach(() => {
  refresh.mockReset();
  addCompanyAction.mockReset();
  addBranchAction.mockReset();
  inviteAdministratorAction.mockReset();
  resendAdministratorInvitationAction.mockReset();
  assignSubscriptionAction.mockReset();
});

describe('the growth panel is offered only where the authority could satisfy it', () => {
  it('is absent without the organisation-management authority', () => {
    renderDetail();
    expect(screen.queryByTestId('platform-add-company')).toBeNull();
    expect(screen.queryByTestId('platform-invite-administrator')).toBeNull();
  });

  it('is absent for a closed organisation even with the authority', () => {
    renderDetail({ status: 'closed' }, { canManageOrganization: true });
    expect(screen.queryByTestId('platform-add-company')).toBeNull();
  });

  it('offers all four acts with the authority, and waits for a company before a branch', () => {
    renderDetail({}, { canManageOrganization: true });
    expect(screen.getByTestId('platform-add-company')).toBeEnabled();
    expect(screen.getByTestId('platform-add-branch')).toBeEnabled();
    expect(screen.getByTestId('platform-invite-administrator')).toBeEnabled();
    expect(screen.getByTestId('platform-resend-invitation')).toBeEnabled();

    renderDetail({ companies: [] }, { canManageOrganization: true });
    expect(screen.getAllByTestId('platform-add-branch').at(-1)).toBeDisabled();
  });
});

describe('adding a company', () => {
  it('sends exactly what was typed, with the currency in the shape the column takes', async () => {
    addCompanyAction.mockResolvedValue(done('platform.growth.companyDone'));
    renderDetail({}, { canManageOrganization: true });
    await userEvent.click(screen.getByTestId('platform-add-company'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.code')}`)),
      'test_second'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.legalName')}`)),
      'Test Second Company'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.baseCurrency')}`)),
      'sar'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(addCompanyAction).toHaveBeenCalledTimes(1));
    const [tenantId, input] = addCompanyAction.mock.calls[0] as [string, Record<string, unknown>];
    expect(tenantId).toBe(TENANT);
    expect(input).toEqual({
      code: 'test_second',
      legalName: 'Test Second Company',
      // Typed in lower case and sent as the three capitals the column takes.
      baseCurrency: 'SAR',
      registrationNumber: '',
      taxRegistrationNumber: '',
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('adding a branch', () => {
  it('names the company it belongs to and sends the time zone it was given', async () => {
    addBranchAction.mockResolvedValue(done('platform.growth.branchDone'));
    renderDetail({}, { canManageOrganization: true });
    await userEvent.click(screen.getByTestId('platform-add-branch'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.growth.company')}`)),
      COMPANY
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.code')}`)),
      'test_north'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.name')}`)),
      'Test North Branch'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.timeZone')}`)),
      'Asia/Riyadh'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(addBranchAction).toHaveBeenCalledTimes(1));
    const [tenantId, input] = addBranchAction.mock.calls[0] as [string, Record<string, unknown>];
    expect(tenantId).toBe(TENANT);
    expect(input).toEqual({
      companyId: COMPANY,
      code: 'test_north',
      name: 'Test North Branch',
      timezone: 'Asia/Riyadh',
      city: '',
      countryCode: '',
    });
  });
});

describe('inviting an administrator', () => {
  it('sends the address and the name, and asks for nothing else', async () => {
    inviteAdministratorAction.mockResolvedValue(done('platform.growth.inviteDone'));
    renderDetail({}, { canManageOrganization: true });
    await userEvent.click(screen.getByTestId('platform-invite-administrator'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.email')}`)),
      'test.administrator@example.test'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.displayName')}`)),
      'Test Administrator'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(inviteAdministratorAction).toHaveBeenCalledTimes(1));
    const [, input] = inviteAdministratorAction.mock.calls[0] as [string, Record<string, unknown>];
    expect(input).toEqual({
      email: 'test.administrator@example.test',
      displayName: 'Test Administrator',
    });
  });

  it('asks for a reason before a SECOND administrator, and sends both together', async () => {
    inviteAdministratorAction.mockResolvedValue(done('platform.growth.inviteDone'));
    renderDetail({}, { canManageOrganization: true });
    await userEvent.click(screen.getByTestId('platform-invite-administrator'));
    const dialog = await screen.findByRole('dialog');
    // The reason field does not exist until an additional administrator is asked
    // for: a form that collected it always would be asking for a justification
    // nobody owes.
    expect(within(dialog).queryByLabelText(new RegExp(`^${L('platform.reason')}`))).toBeNull();

    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.email')}`)),
      'test.deputy@example.test'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.displayName')}`)),
      'Test Deputy'
    );
    await userEvent.click(
      within(dialog).getByLabelText(new RegExp(L('platform.growth.additional')))
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.reason')}`)),
      'The owner asked for a deputy'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(inviteAdministratorAction).toHaveBeenCalledTimes(1));
    const [, input] = inviteAdministratorAction.mock.calls[0] as [string, Record<string, unknown>];
    expect(input).toEqual({
      email: 'test.deputy@example.test',
      displayName: 'Test Deputy',
      additionalAdministrator: true,
      reason: 'The owner asked for a deputy',
    });
  });

  it('sends the link again for an address, writing nothing else', async () => {
    resendAdministratorInvitationAction.mockResolvedValue(done('platform.growth.resendDone'));
    renderDetail({}, { canManageOrganization: true });
    await userEvent.click(screen.getByTestId('platform-resend-invitation'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.email')}`)),
      'test.administrator@example.test'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(resendAdministratorInvitationAction).toHaveBeenCalledTimes(1));
    expect(resendAdministratorInvitationAction.mock.calls[0]).toEqual([
      TENANT,
      'test.administrator@example.test',
    ]);
    expect(inviteAdministratorAction).not.toHaveBeenCalled();
  });
});

describe('a plan below current usage', () => {
  it('shows every kind that would be over its ceiling, and re-sends with the acceptance', async () => {
    assignSubscriptionAction
      .mockResolvedValueOnce({
        status: 'error',
        messageKey: 'capacity.planBelowUsage',
        attempt: 1,
        overCapacity: [
          { kind: 'companies', used: 2, newLimit: 1 },
          { kind: 'branches', used: 3, newLimit: 1 },
        ],
      })
      .mockResolvedValueOnce(done('platform.subscription.done'));

    renderDetail({}, { canManageSubscription: true });
    await userEvent.click(
      screen.getByRole('button', { name: L('platform.subscription.act.assigned') })
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
      'Moving to the smaller plan'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(assignSubscriptionAction).toHaveBeenCalledTimes(1));
    const panel = await screen.findByTestId('platform-over-capacity');
    // Both kinds, each with its own numbers. A screen that showed only the first
    // would send the operator round the loop again for the second.
    expect(within(panel).getByText(L('platform.capacity.companies'))).toBeInTheDocument();
    expect(within(panel).getByText(L('platform.capacity.branches'))).toBeInTheDocument();
    expect(panel.textContent).toContain('2 in use, 1 allowed');
    expect(panel.textContent).toContain('3 in use, 1 allowed');

    await userEvent.click(
      within(panel).getByLabelText(new RegExp(L('platform.overCapacity.accept')))
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.overCapacity.reason')}`)),
      'The customer will close a branch this month'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(assignSubscriptionAction).toHaveBeenCalledTimes(2));
    const [, first] = assignSubscriptionAction.mock.calls[0] as [string, Record<string, unknown>];
    const [, second] = assignSubscriptionAction.mock.calls[1] as [string, Record<string, unknown>];
    // The SAME request, plus the acceptance. A second attempt that quietly
    // changed the plan or the date would be assigning something nobody reviewed.
    expect(second).toEqual({
      ...first,
      acceptOverCapacity: true,
      overCapacityReason: 'The customer will close a branch this month',
    });
  });

  it('states usage above a ceiling as over the limit, in both languages', () => {
    const over = {
      ...detail,
      capacity: {
        companies: { used: 2, limit: 1 },
        branches: { used: 1, limit: null },
        users: { used: 4, limit: 10 },
      },
    };
    renderLtr(
      <OrganizationDetailScreen
        locale="en"
        messages={messages}
        organization={over}
        plans={null}
        charges={null}
        capabilities={NONE}
        today="2026-09-17"
      />
    );
    const companies = screen.getByTestId('platform-usage-companies');
    expect(companies.getAttribute('data-over')).toBe('true');
    expect(companies.textContent).toContain(EN['platform.usage.over']);
    // Not merely "near the limit": the two states mean different things and the
    // operator is told which one this is.
    expect(companies.textContent).not.toContain(EN['platform.usage.warning']);

    renderRtl(
      <OrganizationDetailScreen
        locale="ar"
        messages={arabicMessages}
        organization={over}
        plans={null}
        charges={null}
        capabilities={NONE}
        today="2026-09-17"
      />
    );
    const arabic = screen.getAllByTestId('platform-usage-companies').at(-1);
    expect(arabic?.textContent).toContain(AR['platform.usage.over']);
  });
});
