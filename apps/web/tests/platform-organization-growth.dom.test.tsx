import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
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

/**
 * The choices platform.reference-values-read would answer, supplied by the test
 * so the dialogs can be held to offering exactly these.
 */
const references = {
  currencies: [
    { code: 'JOD', name: 'Jordanian Dinar', minorUnit: 3 },
    { code: 'USD', name: 'US Dollar', minorUnit: 2 },
    { code: 'EUR', name: 'Euro', minorUnit: 2 },
  ],
  timezones: [{ zoneName: 'Asia/Amman' }, { zoneName: 'UTC' }],
  languages: [
    { localeCode: 'ar', name: 'Arabic', direction: 'rtl' },
    { localeCode: 'en', name: 'English', direction: 'ltr' },
  ],
};

function renderDetail(
  overrides: Partial<typeof detail> = {},
  capabilities: Partial<typeof NONE> = {},
  referenceValues: typeof references | null = references
) {
  return renderLtr(
    <OrganizationDetailScreen
      locale="en"
      messages={messages}
      organization={{ ...detail, ...overrides }}
      plans={[plan]}
      referenceValues={referenceValues}
      charges={null}
      capabilities={{ ...NONE, ...capabilities }}
      today="2026-09-17"
    />
  );
}

/**
 * Under the Material foundation, as the locale layout mounts it: the grids' and
 * the dialogs' own texts come from the catalogue through it.
 */
function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

function optionValues(control: HTMLElement): (string | null)[] {
  return within(control)
    .getAllByRole('option')
    .map((option) => option.getAttribute('value'));
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
  it('sends exactly what was entered, with the currency chosen from the list it was given', async () => {
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
    const currency = within(dialog).getByLabelText(
      new RegExp(`^${L('platform.provision.baseCurrency')}`)
    );
    expect(currency.tagName).toBe('SELECT');
    expect(optionValues(currency)).toEqual(['', 'JOD', 'USD', 'EUR']);
    await userEvent.selectOptions(currency, 'JOD');
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(addCompanyAction).toHaveBeenCalledTimes(1));
    const [tenantId, input] = addCompanyAction.mock.calls[0] as [string, Record<string, unknown>];
    expect(tenantId).toBe(TENANT);
    expect(input).toEqual({
      code: 'test_second',
      legalName: 'Test Second Company',
      baseCurrency: 'JOD',
      registrationNumber: '',
      taxRegistrationNumber: '',
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe('adding a branch', () => {
  it('names the company it belongs to and sends the time zone chosen from the list', async () => {
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
    const zone = within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.timeZone')}`));
    expect(zone.tagName).toBe('SELECT');
    expect(optionValues(zone)).toEqual(['', 'Asia/Amman', 'UTC']);
    await userEvent.selectOptions(zone, 'Asia/Amman');
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(addBranchAction).toHaveBeenCalledTimes(1));
    const [tenantId, input] = addBranchAction.mock.calls[0] as [string, Record<string, unknown>];
    expect(tenantId).toBe(TENANT);
    expect(input).toEqual({
      companyId: COMPANY,
      code: 'test_north',
      name: 'Test North Branch',
      timezone: 'Asia/Amman',
      city: '',
      countryCode: '',
    });
  });
});

/*
 * P1-32-PRE-OD-QAF. D-1: a currency and a zone read as names in the reader's
 * language, with the code beside them, and the code is still what is sent.
 * Item B: the list is read on the server, so a failed read arrives as `null`;
 * each select says so on itself, offers Try again (a page refresh) and refuses
 * the submission on its field, with the cursor on it. In both languages.
 */
describe.each([
  ['en', renderLtr, EN, messages],
  ['ar', renderRtl, AR, arabicMessages],
] as const)(
  '%s: the currency and time-zone choices',
  (locale, paint, catalogue, catalogueMessages) => {
    const M = (key: string): string => catalogue[key] ?? `missing message ${key}`;
    const labelled = (scope: HTMLElement, key: string) =>
      within(scope).getByLabelText(new RegExp(`^${M(key)}`));
    function paintDetail(referenceValues: typeof references | null) {
      return paint(
        <OrganizationDetailScreen
          locale={locale}
          messages={catalogueMessages}
          organization={detail}
          plans={[plan]}
          referenceValues={referenceValues}
          charges={null}
          capabilities={{ ...NONE, canManageOrganization: true }}
          today="2026-09-17"
        />
      );
    }

    it('read as names with the code beside them, and send the code', async () => {
      addCompanyAction.mockResolvedValue(done('platform.growth.companyDone'));
      paintDetail(references);
      await userEvent.click(screen.getByTestId('platform-add-company'));
      const companyDialog = await screen.findByRole('dialog');
      const currency = labelled(companyDialog, 'platform.provision.baseCurrency');
      const jod = within(currency).getByRole('option', { name: /\(JOD\)$/ });
      expect(jod).toHaveValue('JOD');
      expect(jod.textContent).not.toBe('JOD');
      if (locale === 'ar') expect(jod.textContent).toMatch(/[؀-ۿ]/);
      expect(currency).not.toHaveAttribute('dir', 'ltr');
      await userEvent.click(
        within(companyDialog).getByRole('button', { name: M('overlay.cancel') })
      );

      await userEvent.click(screen.getByTestId('platform-add-branch'));
      const branchDialog = await screen.findByRole('dialog');
      const zone = labelled(branchDialog, 'platform.provision.timeZone');
      const amman = within(zone).getByRole('option', { name: /\(Asia\/Amman\)$/ });
      expect(amman).toHaveValue('Asia/Amman');
      expect(amman.textContent).not.toBe('Asia/Amman');
      expect(within(branchDialog).queryByRole('button', { name: M('form.retry') })).toBeNull();
    });

    it('say a list that could not be loaded on the field, retry, and refuse to send', async () => {
      paintDetail(null);
      await userEvent.click(screen.getByTestId('platform-add-company'));
      const companyDialog = await screen.findByRole('dialog');
      const currency = labelled(companyDialog, 'platform.provision.baseCurrency');
      expect(currency.tagName).toBe('SELECT');
      expect(currency).not.toBeDisabled();
      expect(
        within(companyDialog).getByText(M('platform.provision.referenceUnavailable'))
      ).toBeInTheDocument();
      await userEvent.click(within(companyDialog).getByRole('button', { name: M('form.retry') }));
      expect(refresh).toHaveBeenCalledTimes(1);
      await userEvent.type(labelled(companyDialog, 'platform.provision.code'), 'test_south');
      await userEvent.click(
        within(companyDialog).getByRole('button', { name: M('platform.save') })
      );
      expect(await within(companyDialog).findByText(M('form.referenceList.blocked'))).toBeVisible();
      expect(currency).toHaveAttribute('aria-invalid', 'true');
      expect(currency).toHaveFocus();
      expect(labelled(companyDialog, 'platform.provision.code')).toHaveValue('test_south');
      expect(addCompanyAction).not.toHaveBeenCalled();
      await userEvent.click(
        within(companyDialog).getByRole('button', { name: M('overlay.cancel') })
      );

      await userEvent.click(screen.getByTestId('platform-add-branch'));
      const branchDialog = await screen.findByRole('dialog');
      const zone = labelled(branchDialog, 'platform.provision.timeZone');
      expect(
        within(branchDialog).getByText(M('platform.provision.referenceUnavailable'))
      ).toBeInTheDocument();
      await userEvent.click(within(branchDialog).getByRole('button', { name: M('platform.save') }));
      expect(await within(branchDialog).findByText(M('form.referenceList.blocked'))).toBeVisible();
      expect(zone).toHaveAttribute('aria-invalid', 'true');
      expect(zone).toHaveFocus();
      expect(addBranchAction).not.toHaveBeenCalled();
      // Nothing falls back to free text.
      expect(within(branchDialog).queryByRole('textbox', { name: /time zone/i })).toBeNull();
    });
  }
);

/*
 * P1-32-PRE-OD-WP06B. The growth panel and its four dialogs on Material UI, in
 * both languages, under the Material foundation as the locale layout mounts it:
 * the four acts named in the page's language, and each dialog sending exactly
 * the document it sent before — the whole of it, key for key.
 */
describe.each([
  ['en', renderLtr, EN, messages],
  ['ar', renderRtl, AR, arabicMessages],
] as const)('%s: the growth dialogs on Material UI', (locale, paint, catalogue, words) => {
  const M = (key: string): string => catalogue[key] ?? `missing message ${key}`;
  const labelled = (scope: HTMLElement, key: string) =>
    within(scope).getByLabelText(new RegExp(`^${M(key)}`));
  function paintDetail(overrides: Partial<typeof detail> = {}) {
    return paint(
      withMui(
        <OrganizationDetailScreen
          locale={locale}
          messages={words}
          organization={{ ...detail, ...overrides }}
          plans={[plan]}
          referenceValues={references}
          charges={null}
          capabilities={{ ...NONE, canManageOrganization: true }}
          today="2026-09-17"
        />,
        locale
      )
    );
  }

  it('names the four acts in the language of the page, and waits for a company before a branch', () => {
    const { unmount } = paintDetail();
    const section = screen
      .getByRole('heading', { name: M('platform.growth.title') })
      .closest('section') as HTMLElement;
    for (const [testId, key] of [
      ['platform-add-company', 'platform.growth.addCompany'],
      ['platform-add-branch', 'platform.growth.addBranch'],
      ['platform-invite-administrator', 'platform.growth.inviteAdministrator'],
      ['platform-resend-invitation', 'platform.growth.resend'],
    ] as const) {
      const button = within(section).getByTestId(testId);
      expect(button, testId).toHaveTextContent(M(key));
      expect(button, testId).toBeEnabled();
    }
    expect(section).toHaveTextContent(M('platform.growth.inviteHint'));
    unmount();

    paintDetail({ companies: [] });
    expect(screen.getByTestId('platform-add-branch')).toBeDisabled();
    expect(screen.getByText(M('platform.growth.noCompanies'))).toBeInTheDocument();
  });

  it('adds a company and a branch with the same documents as before', async () => {
    addCompanyAction.mockResolvedValue(done('platform.growth.companyDone'));
    addBranchAction.mockResolvedValue(done('platform.growth.branchDone'));
    paintDetail();
    await userEvent.click(screen.getByTestId('platform-add-company'));
    const company = await screen.findByRole('dialog');
    expect(within(company).getByRole('heading')).toHaveTextContent(
      M('platform.growth.addCompanyTitle')
    );
    await userEvent.type(labelled(company, 'platform.provision.code'), 'test_second');
    await userEvent.type(labelled(company, 'platform.provision.legalName'), 'Test Second Company');
    await userEvent.selectOptions(labelled(company, 'platform.provision.baseCurrency'), 'USD');
    await userEvent.type(labelled(company, 'platform.provision.registration'), 'TEST-REG-1');
    await userEvent.type(labelled(company, 'platform.provision.taxRegistration'), 'TEST-TAX-1');
    await userEvent.click(within(company).getByRole('button', { name: M('platform.save') }));
    await waitFor(() => expect(addCompanyAction).toHaveBeenCalledTimes(1));
    expect(addCompanyAction.mock.calls[0]).toEqual([
      TENANT,
      {
        code: 'test_second',
        legalName: 'Test Second Company',
        baseCurrency: 'USD',
        registrationNumber: 'TEST-REG-1',
        taxRegistrationNumber: 'TEST-TAX-1',
      },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByTestId('platform-add-branch'));
    const branch = await screen.findByRole('dialog');
    // The one active company is chosen already, named by its legal name.
    const owner = labelled(branch, 'platform.growth.company');
    expect(owner).toHaveValue(COMPANY);
    expect(within(owner).getByRole('option', { name: 'Test Company' })).toHaveValue(COMPANY);
    await userEvent.type(labelled(branch, 'platform.provision.code'), 'test_north');
    await userEvent.type(labelled(branch, 'platform.provision.name'), 'Test North Branch');
    await userEvent.selectOptions(labelled(branch, 'platform.provision.timeZone'), 'UTC');
    await userEvent.type(labelled(branch, 'platform.provision.city'), 'Test City');
    await userEvent.type(labelled(branch, 'platform.provision.country'), 'jo');
    await userEvent.click(within(branch).getByRole('button', { name: M('platform.save') }));
    await waitFor(() => expect(addBranchAction).toHaveBeenCalledTimes(1));
    expect(addBranchAction.mock.calls[0]).toEqual([
      TENANT,
      {
        companyId: COMPANY,
        code: 'test_north',
        name: 'Test North Branch',
        timezone: 'UTC',
        city: 'Test City',
        countryCode: 'JO',
      },
    ]);
  });

  it('invites a second administrator under a reason, and resends a link, as before', async () => {
    inviteAdministratorAction.mockResolvedValue(done('platform.growth.inviteDone'));
    resendAdministratorInvitationAction.mockResolvedValue(done('platform.growth.resendDone'));
    paintDetail();
    await userEvent.click(screen.getByTestId('platform-invite-administrator'));
    const invite = await screen.findByRole('dialog');
    expect(within(invite).queryByLabelText(new RegExp(`^${M('platform.reason')}`))).toBeNull();
    await userEvent.type(labelled(invite, 'platform.provision.email'), 'test.deputy@example.test');
    await userEvent.type(labelled(invite, 'platform.provision.displayName'), 'Test Deputy');
    await userEvent.click(
      within(invite).getByLabelText(new RegExp(M('platform.growth.additional')))
    );
    await userEvent.type(labelled(invite, 'platform.reason'), 'The owner asked for a deputy');
    await userEvent.click(within(invite).getByRole('button', { name: M('platform.save') }));
    await waitFor(() => expect(inviteAdministratorAction).toHaveBeenCalledTimes(1));
    expect(inviteAdministratorAction.mock.calls[0]).toEqual([
      TENANT,
      {
        email: 'test.deputy@example.test',
        displayName: 'Test Deputy',
        additionalAdministrator: true,
        reason: 'The owner asked for a deputy',
      },
    ]);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    await userEvent.click(screen.getByTestId('platform-resend-invitation'));
    const resend = await screen.findByRole('dialog');
    expect(within(resend).getByRole('heading')).toHaveTextContent(M('platform.growth.resendTitle'));
    await userEvent.type(
      labelled(resend, 'platform.provision.email'),
      'test.administrator@example.test'
    );
    await userEvent.click(within(resend).getByRole('button', { name: M('platform.save') }));
    await waitFor(() => expect(resendAdministratorInvitationAction).toHaveBeenCalledTimes(1));
    expect(resendAdministratorInvitationAction.mock.calls[0]).toEqual([
      TENANT,
      'test.administrator@example.test',
    ]);
  });

  it('keeps what was typed and says the server refusal on its own field', async () => {
    addCompanyAction.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { code: 'platform.error.required' },
      attempt: 1,
    });
    paintDetail();
    await userEvent.click(screen.getByTestId('platform-add-company'));
    const company = await screen.findByRole('dialog');
    await userEvent.type(labelled(company, 'platform.provision.legalName'), 'Test Second Company');
    await userEvent.selectOptions(labelled(company, 'platform.provision.baseCurrency'), 'JOD');
    await userEvent.click(within(company).getByRole('button', { name: M('platform.save') }));
    await waitFor(() => expect(addCompanyAction).toHaveBeenCalledTimes(1));
    const code = labelled(company, 'platform.provision.code');
    await waitFor(() => expect(code).toHaveFocus());
    expect(code).toHaveAttribute('aria-invalid', 'true');
    expect(within(company).getByText(M('platform.error.required'))).toBeVisible();
    expect(labelled(company, 'platform.provision.legalName')).toHaveValue('Test Second Company');
    await userEvent.type(code, 'test_second');
    expect(code).not.toHaveAttribute('aria-invalid', 'true');
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

  /**
   * Owner directive, user-facing errors. An organisation that already has an
   * active administrator refuses a second one unless it is asked for
   * explicitly, with a reason — and the console showed the generic 'this
   * record cannot take that change' for it, which names neither the reason nor
   * the cure. The service files the rule under the flag that cures it, and the
   * flag now renders it: the sentence is beside the control the operator has
   * to tick.
   *
   * The mocked state is the one the wire produces — the rule arrives under
   * `body.additionalAdministrator`, so it is a field error and the banner keeps
   * the generic sentence.
   */
  it('says beside the flag why a second administrator was refused', async () => {
    inviteAdministratorAction.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      fieldErrors: { additionalAdministrator: 'form.violation.platform_administrator_exists' },
      correlationId: 'corr-second-administrator',
      attempt: 1,
    });
    renderDetail({}, { canManageOrganization: true });
    await userEvent.click(screen.getByTestId('platform-invite-administrator'));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.email')}`)),
      'test.deputy@example.test'
    );
    await userEvent.type(
      within(dialog).getByLabelText(new RegExp(`^${L('platform.provision.displayName')}`)),
      'Test Deputy'
    );
    await userEvent.click(within(dialog).getByRole('button', { name: L('platform.save') }));

    await waitFor(() => expect(inviteAdministratorAction).toHaveBeenCalledTimes(1));
    const flag = within(dialog).getByLabelText(new RegExp(L('platform.growth.additional')));
    const said = await within(dialog).findByText(L('form.violation.platform_administrator_exists'));
    expect(said).toBeVisible();
    // Beside the flag, and reachable from it: a sentence the control does not
    // point at is a sentence a screen reader never announces with the control.
    expect(flag.getAttribute('aria-describedby') ?? '').toContain(said.id);
    expect(flag).toHaveAttribute('aria-invalid', 'true');
    // The rule name itself never reaches the screen; only its sentence does.
    expect(dialog.textContent).not.toContain('platform_administrator_exists');
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
