import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { TEST_BRANCH, branchSnapshot, inBranch, renderLtr, renderRtl } from './render';
import type {
  BranchView,
  CapacityView,
  CompanyView,
} from '@/features/administration/organization/types';

/**
 * Companies, branches and the subscription allowance on the Organization screen
 * (P1-32 preparation, organisation administration).
 *
 * The properties under test:
 *
 *   - Add company and Add branch reach their operations with the body the route
 *     schema names, and a success is said in words;
 *   - a malformed entry is refused beside its field before any request is made;
 *   - `ERR-CAP-001` is shown as the ceiling, the numbers and the remedy;
 *   - a full allowance keeps its button and explains itself beside it;
 *   - each control is absent without the permission its operation declares;
 *   - a branch status change reads the branch's CURRENT version first and sends
 *     it as `If-Match`, never a remembered or guessed one;
 *   - the allowance panel says "unlimited" for a plan with no ceiling and warns
 *     at ninety percent.
 */

/** A catalogue message by key; a missing key fails the lookup loudly. */
const EN = (key: string): string => {
  const value = (en as Record<string, string>)[key];
  if (value === undefined) throw new Error(`${key} is not in the English catalogue`);
  return value;
};
const AR = (key: string): string => {
  const value = (ar as Record<string, string>)[key];
  if (value === undefined) throw new Error(`${key} is not in the Arabic catalogue`);
  return value;
};

const send = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api/server-client', () => ({ authorizedClient: async () => ({ send, get }) }));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { OrganizationStructure } =
  await import('@/features/administration/organization/components/OrganizationStructure');
const { CapacityPanel } =
  await import('@/features/administration/organization/components/CapacityPanel');
const { SettingsEditor } =
  await import('@/features/administration/organization/components/SettingsEditor');

const COMPANY: CompanyView = {
  id: '10000000-0000-4000-8000-000000000001',
  companyCode: 'main_company',
  legalName: 'Main Company',
  status: 'active',
};

const BRANCH: BranchView = {
  id: '20000000-0000-4000-8000-000000000002',
  companyId: COMPANY.id,
  branchCode: 'first_branch',
  name: 'First Branch',
  city: 'Amman',
  countryCode: 'JO',
  timezoneName: 'Asia/Amman',
  status: 'active',
};

function capacity(
  over: Partial<
    Record<'companies' | 'branches' | 'users', { used: number; limit: number | null }>
  > = {}
): CapacityView {
  return {
    capacity: {
      companies: { used: 1, limit: 5 },
      branches: { used: 1, limit: 5 },
      users: { used: 1, limit: null },
      ...over,
    },
    subscription: {
      planCode: 'standard',
      displayName: 'Standard',
      status: 'active',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
      effectiveTo: null,
    },
  };
}

const ok = <T,>(data: T) => ({ status: 'ok' as const, data, correlationId: 'corr-1' });

function renderStructure(over: Record<string, unknown> = {}) {
  return renderLtr(
    <OrganizationStructure
      messages={en}
      capacity={capacity()}
      companies={ok([COMPANY])}
      branches={ok([BRANCH])}
      currencyChoices={['JOD', 'USD']}
      timezoneChoices={['Asia/Amman']}
      canManageCompanies
      canManageBranches
      canChangeBranchStatus
      {...over}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Add company', () => {
  it('sends the fields the route names and says the company was added', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: {}, correlationId: 'corr-2' });
    const user = userEvent.setup();
    renderStructure();

    await user.click(screen.getByRole('button', { name: EN('organization.company.add') }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Code/), 'second_company');
    await user.type(within(dialog).getByLabelText(/^Legal name/), 'Second Company');
    await user.selectOptions(within(dialog).getByLabelText(/^Base currency/), 'JOD');
    await user.type(within(dialog).getByLabelText(/^Tax registration number/), 'T-1');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/org/companies', {
      code: 'second_company',
      legalName: 'Second Company',
      baseCurrency: 'JOD',
      taxRegistrationNumber: 'T-1',
    });
    expect(await within(dialog).findByText(EN('organization.company.created'))).toBeVisible();
  });

  it('refuses a malformed code beside the field and sends nothing', async () => {
    const user = userEvent.setup();
    renderStructure({ currencyChoices: [] });

    await user.click(screen.getByRole('button', { name: EN('organization.company.add') }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Code/), 'Bad Code');
    await user.type(within(dialog).getByLabelText(/^Legal name/), 'Second Company');
    await user.type(within(dialog).getByLabelText(/^Base currency/), 'jod');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    expect(
      (await within(dialog).findAllByText(EN('organization.structure.codeHint'))).length
    ).toBeGreaterThan(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('explains a spent company allowance with the numbers and the remedy', async () => {
    send.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      problem: { code: 'ERR-CAP-001', capacity: { kind: 'companies', limit: 2, used: 2 } },
      correlationId: 'corr-cap',
    });
    const user = userEvent.setup();
    renderStructure();

    await user.click(screen.getByRole('button', { name: EN('organization.company.add') }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Code/), 'third_company');
    await user.type(within(dialog).getByLabelText(/^Legal name/), 'Third Company');
    await user.selectOptions(within(dialog).getByLabelText(/^Base currency/), 'USD');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    expect(
      await within(dialog).findByText(
        'Your subscription allows 2 companies and 2 are in use. Ask the platform owner to raise the limit.'
      )
    ).toBeVisible();
  });
});

describe('Add branch', () => {
  it('sends the company, code, name, place and time zone', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: {}, correlationId: 'corr-3' });
    const user = userEvent.setup();
    renderStructure();

    await user.click(screen.getByRole('button', { name: EN('organization.branch.add') }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Company/), COMPANY.id);
    await user.type(within(dialog).getByLabelText(/^Code/), 'second_branch');
    await user.type(within(dialog).getByLabelText(/^Branch name/), 'Second Branch');
    await user.type(within(dialog).getByLabelText(/^City/), 'Irbid');
    await user.type(within(dialog).getByLabelText(/^Country/), 'jo');
    await user.type(within(dialog).getByLabelText(/^Time zone/), 'Asia/Amman');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/org/branches', {
      companyId: COMPANY.id,
      code: 'second_branch',
      name: 'Second Branch',
      timezone: 'Asia/Amman',
      city: 'Irbid',
      countryCode: 'JO',
    });
    expect(await within(dialog).findByText(EN('organization.branch.created'))).toBeVisible();
  });

  it('shows the branch ceiling message when the server refuses for capacity', async () => {
    send.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      problem: { code: 'ERR-CAP-001', capacity: { kind: 'branches', limit: 2, used: 2 } },
      correlationId: 'corr-cap',
    });
    const user = userEvent.setup();
    renderStructure();

    await user.click(screen.getByRole('button', { name: EN('organization.branch.add') }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Company/), COMPANY.id);
    await user.type(within(dialog).getByLabelText(/^Code/), 'third_branch');
    await user.type(within(dialog).getByLabelText(/^Branch name/), 'Third Branch');
    await user.type(within(dialog).getByLabelText(/^Time zone/), 'Asia/Amman');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    expect(
      await within(dialog).findByText(
        'Your subscription allows 2 branches and 2 are in use. Ask the platform owner to raise the limit.'
      )
    ).toBeVisible();
  });
});

describe('a full allowance', () => {
  it('keeps the Add button and explains the ceiling beside it', () => {
    renderStructure({
      capacity: capacity({ branches: { used: 3, limit: 3 }, companies: { used: 1, limit: 4 } }),
    });
    expect(screen.getByRole('button', { name: EN('organization.branch.add') })).toBeEnabled();
    expect(
      screen.getByText(
        'Your subscription allows 3 branches and 3 are in use. Ask the platform owner to raise the limit.'
      )
    ).toBeVisible();
    expect(screen.queryByText(/allows 4 companies/)).toBeNull();
  });
});

describe('controls follow the permission their operation declares', () => {
  it('hides every write control from a reader', () => {
    renderStructure({
      canManageCompanies: false,
      canManageBranches: false,
      canChangeBranchStatus: false,
    });
    expect(screen.queryByRole('button', { name: EN('organization.company.add') })).toBeNull();
    expect(screen.queryByRole('button', { name: EN('organization.branch.add') })).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: new RegExp(EN('organization.structure.deactivate')),
      })
    ).toBeNull();
    // The data itself is still shown.
    expect(screen.getAllByText('Main Company').length).toBeGreaterThan(0);
    expect(screen.getByText('First Branch')).toBeVisible();
  });

  it('shows the branch status control only with its own permission', () => {
    renderStructure({ canManageCompanies: false, canManageBranches: false });
    expect(
      screen.getByRole('button', {
        name: `${EN('organization.structure.deactivate')}: First Branch`,
      })
    ).toBeVisible();
    expect(
      screen.queryByRole('button', {
        name: `${EN('organization.structure.deactivate')}: Main Company`,
      })
    ).toBeNull();
  });
});

describe('status changes', () => {
  it('deactivates a company with the written reason', async () => {
    send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'corr-4' });
    const user = userEvent.setup();
    renderStructure();

    await user.click(
      screen.getByRole('button', {
        name: `${EN('organization.structure.deactivate')}: Main Company`,
      })
    );
    const dialog = screen.getByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Merged into the group');
    await user.click(
      within(dialog).getByRole('button', { name: EN('organization.structure.deactivate') })
    );

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', `/api/v1/org/companies/${COMPANY.id}/status`, {
      status: 'inactive',
      reason: 'Merged into the group',
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('reads the branch version at confirmation and sends it as If-Match', async () => {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { current: 'active', recordVersion: 7 },
      correlationId: 'corr-5',
    });
    send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'corr-6' });
    const user = userEvent.setup();
    renderStructure();

    await user.click(
      screen.getByRole('button', {
        name: `${EN('organization.structure.deactivate')}: First Branch`,
      })
    );
    const dialog = screen.getByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Closed for renovation');
    await user.click(
      within(dialog).getByRole('button', { name: EN('organization.structure.deactivate') })
    );

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(get).toHaveBeenCalledWith(`/api/v1/organization/branches/${BRANCH.id}/status`);
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/organization/branches/${BRANCH.id}/status`,
      { to: 'inactive', reason: 'Closed for renovation' },
      { ifMatch: 7 }
    );
  });

  it('shows the capacity sentence when reactivating a branch would exceed the allowance', async () => {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { current: 'inactive', recordVersion: 3 },
      correlationId: 'corr-7',
    });
    send.mockResolvedValue({
      ok: false,
      kind: 'conflict',
      status: 409,
      problem: { code: 'ERR-CAP-001', capacity: { kind: 'branches', limit: 1, used: 1 } },
      correlationId: 'corr-8',
    });
    const user = userEvent.setup();
    renderStructure({ branches: ok([{ ...BRANCH, status: 'inactive' }]) });

    await user.click(
      screen.getByRole('button', { name: `${EN('organization.structure.activate')}: First Branch` })
    );
    const dialog = screen.getByRole('alertdialog');
    await user.type(within(dialog).getByLabelText(/^Reason/), 'Reopened');
    await user.click(
      within(dialog).getByRole('button', { name: EN('organization.structure.activate') })
    );

    expect(
      await within(dialog).findByText(
        'Your subscription allows 1 branches and 1 are in use. Ask the platform owner to raise the limit.'
      )
    ).toBeVisible();
  });
});

describe('the subscription and capacity panel', () => {
  it('shows the plan, usage against each limit, and unlimited where there is none', () => {
    renderLtr(<CapacityPanel capacity={capacity()} messages={en} locale="en" />);
    expect(screen.getByText('Standard')).toBeVisible();
    expect(screen.getAllByText('1 of 5 in use')).toHaveLength(2);
    expect(screen.getByText(EN('organization.capacity.unlimited'))).toBeVisible();
    expect(screen.getByText(EN('organization.capacity.noEndDate'))).toBeVisible();
    expect(screen.getAllByRole('progressbar')).toHaveLength(2);
  });

  it('warns at ninety percent and says when the limit is reached', () => {
    renderLtr(
      <CapacityPanel
        capacity={capacity({ companies: { used: 9, limit: 10 }, branches: { used: 4, limit: 4 } })}
        messages={en}
        locale="en"
      />
    );
    expect(screen.getByText(EN('organization.capacity.nearlyFull'))).toBeVisible();
    expect(screen.getByText(EN('organization.capacity.full'))).toBeVisible();
  });

  it('reads in Arabic, right to left', () => {
    renderRtl(<CapacityPanel capacity={capacity()} messages={ar} locale="ar" />);
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR('organization.capacity.unlimited'))).toBeVisible();
  });
});

/**
 * The settings editor's own refusals, which nothing on the screen rendered.
 *
 * `type_mismatch` — `iam/application/organization-settings-service.ts:337`,
 * published against `body.settingValue` when `org.validate_setting_value()`
 * refuses the text against the kind the stored setting declares. It reached a
 * field error keyed `settingValue`, and the value box had no error slot at all,
 * so the operator was refused with nothing beside the only control they could
 * change — and the same was true of this screen's own "that is not a number"
 * check, which was written and then rendered nowhere.
 */
describe('a setting value the platform will not store', () => {
  const refusal = (path: string, rule: string) => ({
    ok: false as const,
    kind: 'validation' as const,
    status: 422,
    problem: {
      type: 'urn:rootlco:error:ERR-VAL-001',
      title: 'Validation failed',
      status: 422,
      code: 'ERR-VAL-001',
      correlationId: 'corr-refusal',
      violations: [{ path, rule }],
    },
    correlationId: 'corr-refusal',
  });

  const renderSettings = (messages: typeof en, locale: 'en' | 'ar') => {
    get.mockResolvedValue({ ok: true, status: 200, data: { items: [] }, correlationId: 'corr-1' });
    const paint = locale === 'en' ? renderLtr : renderRtl;
    return paint(
      inBranch(
        <SettingsEditor
          messages={messages}
          scope="company"
          canWrite
          keyPrefix=""
          suggestions={[
            {
              key: 'org.working_hours.start',
              labelKey: 'organization.setting.key',
              valueType: 'string',
            },
          ]}
        />,
        { locale }
      )
    );
  };

  it('puts the sentence beside the value box and keeps what was typed', async () => {
    send.mockResolvedValue(refusal('body.settingValue', 'type_mismatch'));
    const user = userEvent.setup();
    renderSettings(en, 'en');

    const value = await screen.findByLabelText(new RegExp(`^${EN('organization.setting.value')}`));
    await user.type(value, 'half past seven');
    await user.click(screen.getByRole('button', { name: EN('admin.save') }));

    expect(await screen.findByText(EN('form.violation.type_mismatch'))).toBeVisible();
    expect(value).toHaveAttribute('aria-invalid', 'true');
    // The typed text survives the refusal: a cleared box would make the operator
    // retype something they were never told was wrong in its own right.
    expect(value).toHaveValue('half past seven');
  });

  it('says what is wrong without sending the reader to the hint under the box', async () => {
    // The hint under the value box describes how a value is STORED — exactly as
    // entered — not which forms this setting will take. A refusal that points at
    // it leaves the reader nowhere to look, so the sentence has to stand on its
    // own.
    send.mockResolvedValue(refusal('body.settingValue', 'type_mismatch'));
    const user = userEvent.setup();
    renderSettings(en, 'en');

    const value = await screen.findByLabelText(new RegExp(`^${EN('organization.setting.value')}`));
    await user.type(value, 'half past seven');
    await user.click(screen.getByRole('button', { name: EN('admin.save') }));

    const sentence = EN('form.violation.type_mismatch');
    expect(await screen.findByText(sentence)).toBeVisible();
    expect(sentence, 'the refusal defers to a hint instead of saying what is wrong').not.toMatch(
      /hint/i
    );
    expect(EN('organization.setting.valueHint')).toMatch(/stored/i);
  });

  it('says it in Arabic when the screen is Arabic', async () => {
    send.mockResolvedValue(refusal('body.settingValue', 'type_mismatch'));
    const user = userEvent.setup();
    renderSettings(ar, 'ar');

    const value = await screen.findByLabelText(new RegExp(`^${AR('organization.setting.value')}`));
    await user.type(value, 'سبعة والنصف');
    await user.click(screen.getByRole('button', { name: AR('admin.save') }));

    const arabic = AR('form.violation.type_mismatch');
    expect(await screen.findByText(arabic)).toBeVisible();
    expect(arabic).toMatch(/[؀-ۿ]/);
    expect(arabic).not.toBe(EN('form.violation.type_mismatch'));
  });
});

describe('the settings editor when there is nothing to choose', () => {
  it('SAYS SO rather than rendering a labelled area with no control', () => {
    /*
     * The notice was written for a BRANCH state, and `ready` makes it silent —
     * correctly, when the question is which branch. This editor asks which
     * COMPANY, and a caller whose own list came back empty got nothing at all:
     * a heading, a blank space, and no sentence. That reads as a broken screen
     * rather than as an empty list, so the caller names what is missing.
     */
    get.mockResolvedValue({ ok: true, status: 200, data: { items: [] }, correlationId: 'corr-1' });
    renderLtr(
      inBranch(
        <SettingsEditor messages={en} scope="company" canWrite keyPrefix="" suggestions={[]} />,
        { snapshot: { ...branchSnapshot([TEST_BRANCH]), companies: [] } }
      )
    );
    expect(screen.getByTestId('requires-concrete-branch')).toHaveTextContent(
      en['workingContext.noCompany']
    );
    // No company picker — the other selects on this form belong to the setting
    // being written, not to the scope.
    expect(screen.queryByLabelText(new RegExp(en['admin.scope.company']))).toBeNull();
  });
});
