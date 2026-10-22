import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { startTransition, useState, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  TEST_BRANCH,
  TEST_COMPANY,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';
import { useUnsavedWork } from '@/features/working-context/WorkingContextProvider';
import type {
  BranchView,
  CapacityView,
  CompanyView,
  ReferenceValues,
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
const { TenantForm } = await import('@/features/administration/organization/components/TenantForm');

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

/**
 * What org.reference-values-read would answer, supplied by the test (P1-32-PRE-OD-REF).
 * EUR is deliberately NOT among the enabled codes the structure is rendered with.
 */
const REFERENCES: ReferenceValues = {
  currencies: [
    { code: 'JOD', name: 'Jordanian Dinar', minorUnit: 3 },
    { code: 'USD', name: 'US Dollar', minorUnit: 2 },
    { code: 'EUR', name: 'Euro', minorUnit: 2 },
  ],
  timezones: [{ zoneName: 'Asia/Amman' }, { zoneName: 'UTC' }],
  languages: [
    { localeCode: 'ar', name: 'Arabic', direction: 'rtl' },
    { localeCode: 'en', name: 'English', direction: 'ltr' },
    { localeCode: 'fr', name: 'French', direction: 'ltr' },
  ],
};

function optionValues(control: HTMLElement): (string | null)[] {
  return within(control)
    .getAllByRole('option')
    .map((option) => option.getAttribute('value'));
}

function renderStructure(over: Record<string, unknown> = {}) {
  return renderLtr(
    <OrganizationStructure
      locale="en"
      messages={en}
      capacity={capacity()}
      companies={ok([COMPANY])}
      branches={ok([BRANCH])}
      currencyChoices={['JOD', 'USD']}
      timezoneChoices={['Asia/Amman']}
      referenceValues={null}
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
    renderStructure({ currencyChoices: [], referenceValues: REFERENCES });

    await user.click(screen.getByRole('button', { name: EN('organization.company.add') }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Code/), 'Bad Code');
    await user.type(within(dialog).getByLabelText(/^Legal name/), 'Second Company');
    await user.selectOptions(within(dialog).getByLabelText(/^Base currency/), 'JOD');
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
    await user.selectOptions(within(dialog).getByLabelText(/^Time zone/), 'Asia/Amman');
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
    await user.selectOptions(within(dialog).getByLabelText(/^Time zone/), 'Asia/Amman');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    expect(
      await within(dialog).findByText(
        'Your subscription allows 2 branches and 2 are in use. Ask the platform owner to raise the limit.'
      )
    ).toBeVisible();
  });
});

describe('the currency and time zone are chosen, never typed', () => {
  it('offers the enabled codes when there are any, even beside the reference list', async () => {
    const user = userEvent.setup();
    renderStructure({ referenceValues: REFERENCES });
    await user.click(screen.getByRole('button', { name: EN('organization.company.add') }));
    const currency = within(screen.getByRole('dialog')).getByLabelText(/^Base currency/);
    expect(currency.tagName).toBe('SELECT');
    expect(optionValues(currency)).toEqual(['', 'JOD', 'USD']);
    expect(
      within(screen.getByRole('dialog')).getByText(EN('organization.company.baseCurrencyHint'))
    ).toBeVisible();
  });

  it('offers the platform currencies when none is enabled, with no text box', async () => {
    const user = userEvent.setup();
    renderStructure({ currencyChoices: [], referenceValues: REFERENCES });
    await user.click(screen.getByRole('button', { name: EN('organization.company.add') }));
    const dialog = screen.getByRole('dialog');
    const currency = within(dialog).getByLabelText(/^Base currency/);
    expect(currency.tagName).toBe('SELECT');
    // Ordered by the name the reader sees: Euro, Jordanian Dinar, US Dollar.
    expect(optionValues(currency)).toEqual(['', 'EUR', 'JOD', 'USD']);
    expect(within(dialog).getByText(EN('organization.company.currencyHint'))).toBeVisible();
  });

  it('stays a select with nothing to choose when neither source has a currency', async () => {
    const user = userEvent.setup();
    renderStructure({ currencyChoices: [], referenceValues: null });
    await user.click(screen.getByRole('button', { name: EN('organization.company.add') }));
    const dialog = screen.getByRole('dialog');
    const currency = within(dialog).getByLabelText(/^Base currency/);
    expect(currency.tagName).toBe('SELECT');
    expect(optionValues(currency)).toEqual(['']);
    // The empty choice is explained, so the operator is not left guessing.
    expect(within(dialog).getByText(EN('organization.company.currencyUnavailable'))).toBeVisible();
    expect(within(dialog).queryByText(EN('organization.company.currencyHint'))).toBeNull();
  });

  it('offers the platform time zones for a branch, and the zones in use without them', async () => {
    const user = userEvent.setup();
    renderStructure({ referenceValues: REFERENCES, timezoneChoices: ['Asia/Amman'] });
    await user.click(screen.getByRole('button', { name: EN('organization.branch.add') }));
    const zone = within(screen.getByRole('dialog')).getByLabelText(/^Time zone/);
    expect(zone.tagName).toBe('SELECT');
    expect(optionValues(zone)).toEqual(['', 'Asia/Amman', 'UTC']);
    expect(document.querySelector('datalist')).toBeNull();
  });

  it('falls back to the zones already in use when the list was not read', async () => {
    const user = userEvent.setup();
    renderStructure({ referenceValues: null, timezoneChoices: ['Asia/Amman'] });
    await user.click(screen.getByRole('button', { name: EN('organization.branch.add') }));
    const zone = within(screen.getByRole('dialog')).getByLabelText(/^Time zone/);
    expect(zone.tagName).toBe('SELECT');
    expect(optionValues(zone)).toEqual(['', 'Asia/Amman']);
  });

  it('falls back to the zones already in use when the list holds no active zone', async () => {
    const user = userEvent.setup();
    renderStructure({
      referenceValues: { ...REFERENCES, timezones: [] },
      timezoneChoices: ['Asia/Amman'],
    });
    await user.click(screen.getByRole('button', { name: EN('organization.branch.add') }));
    const dialog = screen.getByRole('dialog');
    expect(optionValues(within(dialog).getByLabelText(/^Time zone/))).toEqual(['', 'Asia/Amman']);
    expect(within(dialog).getByText(EN('organization.branch.timezoneHint'))).toBeVisible();
  });

  it('says a branch cannot be added yet when neither source has a time zone', async () => {
    const user = userEvent.setup();
    renderStructure({ referenceValues: { ...REFERENCES, timezones: [] }, timezoneChoices: [] });
    await user.click(screen.getByRole('button', { name: EN('organization.branch.add') }));
    const dialog = screen.getByRole('dialog');
    const zone = within(dialog).getByLabelText(/^Time zone/);
    expect(zone.tagName).toBe('SELECT');
    expect(optionValues(zone)).toEqual(['']);
    expect(within(dialog).getByText(EN('organization.branch.timezoneUnavailable'))).toBeVisible();
    expect(within(dialog).queryByText(EN('organization.branch.timezoneHint'))).toBeNull();
  });
});

describe('the tenant form offers its language and time zone as selects', () => {
  const TENANT = {
    id: '30000000-0000-4000-8000-000000000003',
    tenantCode: 'tenant_one',
    displayName: 'Tenant One',
    status: 'active',
    defaultLocale: 'en',
    defaultTimezone: 'UTC',
    recordVersion: 3,
  };

  it('offers the platform languages the interface can be shown in, and the platform zones', () => {
    renderLtr(
      <TenantForm locale="en" messages={en} canWrite tenant={TENANT} referenceValues={REFERENCES} />
    );
    const language = screen.getByLabelText(new RegExp(`^${EN('organization.defaultLocale')}`));
    const zone = screen.getByLabelText(new RegExp(`^${EN('organization.defaultTimezone')}`));
    expect(language.tagName).toBe('SELECT');
    expect(zone.tagName).toBe('SELECT');
    expect(optionValues(language)).toEqual(['ar', 'en']);
    expect(optionValues(zone)).toEqual(['Asia/Amman', 'UTC']);
    // The saved values are selected, so an untouched form submits them.
    expect((language as HTMLSelectElement).value).toBe('en');
    expect((zone as HTMLSelectElement).value).toBe('UTC');
  });

  it('falls back to the interface languages and the zones in use, keeping the saved one', () => {
    renderLtr(
      <TenantForm
        locale="en"
        messages={en}
        canWrite
        tenant={TENANT}
        referenceValues={null}
        timezoneChoices={['Asia/Amman']}
      />
    );
    expect(
      optionValues(screen.getByLabelText(new RegExp(`^${EN('organization.defaultLocale')}`)))
    ).toEqual(['ar', 'en']);
    expect(
      optionValues(screen.getByLabelText(new RegExp(`^${EN('organization.defaultTimezone')}`)))
    ).toEqual(['UTC', 'Asia/Amman']);
  });

  it('keeps a saved value the list does not hold as the selected choice', () => {
    renderLtr(
      <TenantForm
        locale="en"
        messages={en}
        canWrite
        tenant={{ ...TENANT, defaultTimezone: 'Europe/London' }}
        referenceValues={REFERENCES}
      />
    );
    const zone = screen.getByLabelText(new RegExp(`^${EN('organization.defaultTimezone')}`));
    expect(optionValues(zone)).toEqual(['Europe/London', 'Asia/Amman', 'UTC']);
    expect((zone as HTMLSelectElement).value).toBe('Europe/London');
  });

  it('offers only the saved zone when neither the list nor the zones in use are given', () => {
    // The Languages screen passes no zones in use; without the list the saved
    // zone is still offered and selected, so an untouched form submits it.
    renderLtr(
      <TenantForm locale="en" messages={en} canWrite tenant={TENANT} referenceValues={null} />
    );
    const zone = screen.getByLabelText(new RegExp(`^${EN('organization.defaultTimezone')}`));
    expect(optionValues(zone)).toEqual(['UTC']);
    expect((zone as HTMLSelectElement).value).toBe('UTC');
  });

  it('falls back to the zones in use when the list holds no active zone', () => {
    renderLtr(
      <TenantForm
        locale="en"
        messages={en}
        canWrite
        tenant={TENANT}
        referenceValues={{ ...REFERENCES, timezones: [] }}
        timezoneChoices={['Asia/Amman']}
      />
    );
    const zone = screen.getByLabelText(new RegExp(`^${EN('organization.defaultTimezone')}`));
    expect(optionValues(zone)).toEqual(['UTC', 'Asia/Amman']);
    expect((zone as HTMLSelectElement).value).toBe('UTC');
  });
});

/*
 * P1-32-PRE-OD-QAF, browser QA of PR #474.
 *
 * D-1: the Add company currency read `EUR`, `JOD`, `USD` in both languages. A
 * reference select now reads as a NAME in the reader's language and still sends
 * the code. Item B: the reference values are read on the server, so a failed
 * read is a prop here; the field must say so, offer Try again (a page refresh),
 * and refuse the submission on its own field instead of looking finished.
 */
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (scope: HTMLElement, text: string) =>
  within(scope).getByLabelText(new RegExp(`^${escapeRegExp(text)}`));
const READERS = [
  { locale: 'en' as const, messages: en, M: EN, paint: renderLtr },
  { locale: 'ar' as const, messages: ar, M: AR, paint: renderRtl },
];

describe.each(READERS)('$locale: the reference selects', ({ locale, messages, M, paint }) => {
  function paintStructure(over: Record<string, unknown> = {}) {
    return paint(
      <OrganizationStructure
        locale={locale}
        messages={messages}
        capacity={capacity()}
        companies={ok([COMPANY])}
        branches={ok([BRANCH])}
        currencyChoices={[]}
        timezoneChoices={['Asia/Amman']}
        referenceValues={REFERENCES}
        canManageCompanies
        canManageBranches
        canChangeBranchStatus
        {...over}
      />
    );
  }

  async function openDialog(key: 'organization.company.add' | 'organization.branch.add') {
    await userEvent.setup().click(screen.getByRole('button', { name: M(key) }));
    return screen.getByRole('dialog');
  }

  it('reads a currency as its name with its code beside it, and sends the code', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: {}, correlationId: 'corr-d1' });
    const user = userEvent.setup();
    paintStructure();
    const dialog = await openDialog('organization.company.add');
    const currency = labelled(dialog, M('organization.company.baseCurrency'));
    const named = within(currency).getAllByRole('option').slice(1);
    expect(named.map((option) => option.getAttribute('value')).sort()).toEqual([
      'EUR',
      'JOD',
      'USD',
    ]);
    for (const option of named) {
      // Never the bare code: the name comes first and the code is its hint.
      expect(option.textContent).not.toBe(option.getAttribute('value'));
      expect(option.textContent).toMatch(new RegExp(`\\(${option.getAttribute('value')}\\)$`));
    }
    const jod = within(currency).getByRole('option', { name: /\(JOD\)$/ });
    if (locale === 'en') expect(jod).toHaveTextContent('Jordanian Dinar (JOD)');
    else expect(jod.textContent).toMatch(/[؀-ۿ]/);
    // The select follows the page direction, so the Arabic placeholder reads right.
    expect(currency).not.toHaveAttribute('dir', 'ltr');

    await user.type(labelled(dialog, M('organization.structure.code')), 'second_company');
    await user.type(labelled(dialog, M('organization.company.legalName')), 'Second Company');
    await user.selectOptions(currency, jod);
    await user.click(within(dialog).getByRole('button', { name: M('admin.create') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[2]).toMatchObject({ baseCurrency: 'JOD' });
  });

  it('reads a time zone as its name with its identifier beside it', async () => {
    paintStructure();
    const dialog = await openDialog('organization.branch.add');
    const zone = labelled(dialog, M('organization.branch.timezone'));
    const amman = within(zone).getByRole('option', { name: /\(Asia\/Amman\)$/ });
    expect(amman).toHaveValue('Asia/Amman');
    expect(amman.textContent).not.toBe('Asia/Amman');
    expect(zone).not.toHaveAttribute('dir', 'ltr');
  });

  it('says a currency list that could not be loaded, retries, and refuses to send on the field', async () => {
    const user = userEvent.setup();
    paintStructure({ referenceValues: null, referenceUnavailable: true });
    const dialog = await openDialog('organization.company.add');
    const currency = labelled(dialog, M('organization.company.baseCurrency'));
    expect(optionValues(currency)).toEqual(['']);
    expect(within(dialog).getByText(M('form.referenceList.unavailable'))).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: M('form.retry') }));
    expect(refresh).toHaveBeenCalledTimes(1);

    const code = labelled(dialog, M('organization.structure.code'));
    await user.type(code, 'second_company');
    await user.type(labelled(dialog, M('organization.company.legalName')), 'Second Company');
    await user.click(within(dialog).getByRole('button', { name: M('admin.create') }));

    expect(await within(dialog).findByText(M('form.referenceList.blocked'))).toBeVisible();
    expect(currency).toHaveAttribute('aria-invalid', 'true');
    expect(currency).toHaveFocus();
    expect(code).toHaveValue('second_company');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a branch whose zone list could not be loaded at all', async () => {
    const user = userEvent.setup();
    paintStructure({ referenceValues: null, referenceUnavailable: true, timezoneChoices: [] });
    const dialog = await openDialog('organization.branch.add');
    expect(within(dialog).getByText(M('form.referenceList.unavailable'))).toBeVisible();
    await user.selectOptions(labelled(dialog, M('organization.branch.company')), COMPANY.id);
    await user.type(labelled(dialog, M('organization.structure.code')), 'second_branch');
    await user.type(labelled(dialog, M('organization.branch.name')), 'Second Branch');
    await user.click(within(dialog).getByRole('button', { name: M('admin.create') }));

    const zone = labelled(dialog, M('organization.branch.timezone'));
    expect(await within(dialog).findByText(M('form.referenceList.blocked'))).toBeVisible();
    expect(zone).toHaveAttribute('aria-invalid', 'true');
    expect(zone).toHaveFocus();
    expect(send).not.toHaveBeenCalled();
  });

  it('offers the zones in use from a failed read as a partial list, with Try again, and still sends', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: {}, correlationId: 'corr-partial' });
    const user = userEvent.setup();
    paintStructure({ referenceValues: null, referenceUnavailable: true });
    const dialog = await openDialog('organization.branch.add');
    expect(within(dialog).getByText(M('form.referenceList.partial'))).toBeVisible();
    expect(within(dialog).getByRole('button', { name: M('form.retry') })).toBeVisible();
    await user.selectOptions(labelled(dialog, M('organization.branch.company')), COMPANY.id);
    await user.type(labelled(dialog, M('organization.structure.code')), 'second_branch');
    await user.type(labelled(dialog, M('organization.branch.name')), 'Second Branch');
    await user.selectOptions(labelled(dialog, M('organization.branch.timezone')), 'Asia/Amman');
    await user.click(within(dialog).getByRole('button', { name: M('admin.create') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  });

  it('offers no Try again when the list was simply not read for this session', async () => {
    paintStructure({ referenceValues: null, referenceUnavailable: false });
    const dialog = await openDialog('organization.branch.add');
    expect(within(dialog).queryByRole('button', { name: M('form.retry') })).toBeNull();
    expect(within(dialog).queryByText(M('form.referenceList.partial'))).toBeNull();
  });

  it('names the language and zone in the tenant form, and marks a failed list as partial', async () => {
    const user = userEvent.setup();
    paint(
      <TenantForm
        locale={locale}
        messages={messages}
        canWrite
        tenant={{
          id: '30000000-0000-4000-8000-000000000003',
          tenantCode: 'tenant_one',
          displayName: 'Tenant One',
          status: 'active',
          defaultLocale: 'en',
          defaultTimezone: 'Asia/Amman',
          recordVersion: 3,
        }}
        referenceValues={null}
        referenceUnavailable
      />
    );
    const language = screen.getByLabelText(
      new RegExp(`^${escapeRegExp(M('organization.defaultLocale'))}`)
    );
    const zone = screen.getByLabelText(
      new RegExp(`^${escapeRegExp(M('organization.defaultTimezone'))}`)
    );
    expect(within(language).getByRole('option', { name: M('locale.en') })).toHaveValue('en');
    expect(within(zone).getByRole('option', { name: /\(Asia\/Amman\)$/ })).toHaveValue(
      'Asia/Amman'
    );
    expect(screen.getAllByText(M('form.referenceList.partial'))).toHaveLength(2);
    const retries = screen.getAllByRole('button', { name: M('form.retry') });
    expect(retries).toHaveLength(2);
    await user.click(retries[0] as HTMLElement);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('names the language and zone in the read-only facts', () => {
    paint(
      <TenantForm
        locale={locale}
        messages={messages}
        canWrite={false}
        tenant={{
          id: '30000000-0000-4000-8000-000000000003',
          tenantCode: 'tenant_one',
          displayName: 'Tenant One',
          status: 'active',
          defaultLocale: 'en',
          defaultTimezone: 'Asia/Amman',
          recordVersion: 3,
        }}
        referenceValues={REFERENCES}
      />
    );
    expect(screen.getByText(M('locale.en'))).toBeVisible();
    expect(screen.queryByText('en', { exact: true })).toBeNull();
    expect(screen.getByText(/\(Asia\/Amman\)$/)).toBeVisible();
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

describe('a key typed with spaces around it', () => {
  it('is checked by its rule and sent trimmed', async () => {
    get.mockResolvedValue({ ok: true, status: 200, data: { items: [] }, correlationId: 'corr-1' });
    send.mockResolvedValue({ ok: true, status: 201, data: {}, correlationId: 'corr-trim' });
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <SettingsEditor
          messages={en}
          scope="company"
          canWrite
          keyPrefix=""
          valueRules={{
            'currency.enabled_codes': {
              rule: 'currency-codes',
              hintKey: 'currencies.field.enabledHint',
            },
          }}
          knownCodes={['JOD', 'USD']}
        />,
        { locale: 'en' }
      )
    );

    const key = await screen.findByLabelText(new RegExp(`^${EN('organization.setting.key')}`));
    await user.type(key, '  currency.enabled_codes  ');
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${EN('organization.setting.type')}`)),
      'json'
    );
    const value = screen.getByLabelText(new RegExp(`^${EN('organization.setting.value')}`));
    // The rule's sentence is under the box for the trimmed key.
    expect(screen.getByText(EN('currencies.field.enabledHint'))).toBeVisible();

    await user.click(value);
    await user.paste('["GBP"]');
    await user.click(screen.getByRole('button', { name: EN('admin.save') }));
    expect(await screen.findByText(EN('currencies.error.notHeld'))).toBeVisible();
    expect(send).not.toHaveBeenCalled();

    await user.clear(value);
    await user.click(value);
    await user.paste('["JOD"]');
    await user.click(screen.getByRole('button', { name: EN('admin.save') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', expect.any(String), {
      settingKey: 'currency.enabled_codes',
      settingValue: ['JOD'],
      valueType: 'json',
      isSensitive: false,
    });
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
    // The list's own sentence: this route draws no branch control, so nothing
    // here may send the operator to the header (PR #467 review).
    expect(screen.getByTestId('directory-empty')).toHaveTextContent(en['workingContext.noCompany']);
    // No company picker — the other selects on this form belong to the setting
    // being written, not to the scope.
    expect(screen.queryByLabelText(new RegExp(en['admin.scope.company']))).toBeNull();
  });
});

/**
 * Company settings are read only where the server said the read would answer
 * (route review of PR #476, item 4).
 *
 * A counter clerk holds `org.company.read` through a branch grant, so the
 * session's codes let the Organisation page show the company settings panel, and
 * `iam.company-settings-read` refused the read on every load. The working context
 * now names the companies whose settings the caller may read; the editor reads
 * only those.
 */
describe('company settings are read only where the working context allows it', () => {
  const COMPANY_SETTINGS_PATH = `/api/v1/org/companies/${TEST_COMPANY.id}/settings`;
  const settingsReads = () =>
    get.mock.calls.filter(([path]) => String(path).includes('/settings')).map(([path]) => path);

  it('makes no company-settings read for a branch-scoped reader and shows no error', async () => {
    get.mockResolvedValue({ ok: true, status: 200, data: { items: [] }, correlationId: 'corr-1' });
    renderLtr(
      inBranch(<SettingsEditor messages={en} scope="company" canWrite={false} keyPrefix="" />, {
        snapshot: { ...branchSnapshot([TEST_BRANCH]), companySettingsReadableIds: [] },
      })
    );

    expect(await screen.findByTestId('company-settings-not-readable')).toHaveTextContent(
      EN('organization.settings.companyNotReadable')
    );
    // Give any effect the chance to fire before asserting nothing was sent.
    await waitFor(() => expect(settingsReads()).toEqual([]));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(EN('state.denied.description'))).toBeNull();
    expect(screen.queryByText(EN('state.error.description'))).toBeNull();
  });

  it('says it in Arabic, right to left', async () => {
    renderRtl(
      inBranch(<SettingsEditor messages={ar} scope="company" canWrite={false} keyPrefix="" />, {
        locale: 'ar',
        snapshot: { ...branchSnapshot([TEST_BRANCH]), companySettingsReadableIds: [] },
      })
    );
    const note = await screen.findByTestId('company-settings-not-readable');
    expect(note).toHaveTextContent(AR('organization.settings.companyNotReadable'));
    expect(AR('organization.settings.companyNotReadable')).toMatch(/[؀-ۿ]/);
    expect(settingsReads()).toEqual([]);
  });

  it('still reads and shows the settings for a company-scoped administrator', async () => {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        items: [
          {
            settingKey: 'org.working_hours.start',
            valueType: 'string',
            isSensitive: false,
            version: 1,
            effectiveFrom: '2026-01-01T00:00:00.000Z',
            settingValue: '08:00',
          },
        ],
      },
      correlationId: 'corr-1',
    });
    renderLtr(
      inBranch(<SettingsEditor messages={en} scope="company" canWrite={false} keyPrefix="" />, {
        snapshot: {
          ...branchSnapshot([TEST_BRANCH]),
          companySettingsReadableIds: [TEST_COMPANY.id],
        },
      })
    );

    expect(await screen.findByText('org.working_hours.start')).toBeVisible();
    expect(settingsReads()).toEqual([COMPANY_SETTINGS_PATH]);
    expect(screen.queryByTestId('company-settings-not-readable')).toBeNull();
  });
});

describe('the tenant form places a reference the platform does not hold on its field', () => {
  it('shows the refusal under Default time zone and marks only that control', async () => {
    send.mockResolvedValue({
      ok: false,
      kind: 'validation',
      status: 422,
      problem: {
        type: 'urn:rootlco:error:ERR-VAL-001',
        title: 'Validation failed',
        status: 422,
        code: 'ERR-VAL-001',
        correlationId: 'corr-tenant',
        violations: [{ path: 'body.defaultTimezone', rule: 'unknown_reference' }],
      },
      correlationId: 'corr-tenant',
    });
    const user = userEvent.setup();
    renderLtr(
      <TenantForm
        locale="en"
        messages={en}
        canWrite
        tenant={{
          id: '30000000-0000-4000-8000-000000000003',
          tenantCode: 'tenant_one',
          displayName: 'Tenant One',
          status: 'active',
          defaultLocale: 'en',
          defaultTimezone: 'UTC',
          recordVersion: 3,
        }}
        referenceValues={REFERENCES}
      />
    );

    const zone = screen.getByLabelText(new RegExp(`^${EN('organization.defaultTimezone')}`));
    await user.selectOptions(zone, 'Asia/Amman');
    await user.click(screen.getByRole('button', { name: EN('admin.save') }));

    expect(await screen.findByText(EN('form.violation.unknown_reference'))).toBeVisible();
    expect(
      screen.getByLabelText(new RegExp(`^${EN('organization.defaultTimezone')}`))
    ).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByLabelText(new RegExp(`^${EN('organization.defaultLocale')}`))
    ).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByText(EN('organization.error.unknownReference'))).toBeNull();
  });
});

/*
 * Owner decision of 2026-09-27: the standard tenant administrator edits its own
 * organisation's settings. The server decides who may (`org.settings.manage`
 * on `iam.tenant-settings-update`); the form's part is to offer the controls
 * only to a holder, keep the read-only facts and their notice for everyone else,
 * and behave like every other form in the product — refusal on the field with
 * the cursor on it, typed values kept, unsaved work guarded and discardable, a
 * save said in words and followed by a re-read. DEF-R4: the status is words.
 */
const WORKSPACE = {
  id: '30000000-0000-4000-8000-000000000003',
  tenantCode: 'tenant_one',
  displayName: 'Tenant One',
  status: 'active',
  defaultLocale: 'en',
  defaultTimezone: 'UTC',
  recordVersion: 3,
};

/** Reads the shell's unsaved-work registry the way the branch selector does. */
function UnsavedProbe() {
  const work = useUnsavedWork();
  const [answer, setAnswer] = useState('unknown');
  return (
    <>
      <button type="button" onClick={() => setAnswer(String(work.any()))}>
        probe unsaved
      </button>
      <button type="button" onClick={() => work.discard()}>
        probe discard
      </button>
      <output data-testid="unsaved-answer">{answer}</output>
    </>
  );
}

describe.each(READERS)(
  '$locale: the workspace form follows org.settings.manage',
  ({ locale, messages, M, paint }) => {
    const control = (key: string) => screen.getByLabelText(new RegExp(`^${escapeRegExp(M(key))}`));

    it('offers the three controls to a holder, with no read-only notice', () => {
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite
          tenant={WORKSPACE}
          referenceValues={REFERENCES}
        />
      );
      expect(control('organization.displayName')).toHaveValue('Tenant One');
      expect(control('organization.defaultLocale').tagName).toBe('SELECT');
      expect(control('organization.defaultTimezone').tagName).toBe('SELECT');
      expect(screen.getByRole('button', { name: M('admin.save') })).toBeEnabled();
      expect(screen.queryByText(M('admin.readOnly'))).toBeNull();
    });

    it('shows facts and the read-only notice to anyone else, with no control at all', () => {
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite={false}
          tenant={WORKSPACE}
          referenceValues={REFERENCES}
        />
      );
      expect(screen.getByText(M('admin.readOnly'))).toBeVisible();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(screen.queryByRole('button', { name: M('admin.save') })).toBeNull();
      expect(screen.getByText('Tenant One')).toBeVisible();
    });

    it.each([true, false])('says the status in words, never as stored (form: %s)', (canWrite) => {
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite={canWrite}
          tenant={WORKSPACE}
          referenceValues={REFERENCES}
        />
      );
      expect(screen.getByText(M('organization.tenantStatus.active'))).toBeVisible();
      expect(screen.queryByText('active', { exact: true })).toBeNull();
    });

    it('says a status it does not recognise as unknown rather than printing it', () => {
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite={false}
          tenant={{ ...WORKSPACE, status: 'mystery_state' }}
          referenceValues={REFERENCES}
        />
      );
      expect(screen.getByText(M('organization.tenantStatus.unknown'))).toBeVisible();
      expect(screen.queryByText('mystery_state')).toBeNull();
    });

    it('saves the language and time zone with the version it was shown, says so and re-reads', async () => {
      send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'corr-save' });
      const user = userEvent.setup();
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite
          tenant={WORKSPACE}
          referenceValues={REFERENCES}
        />
      );
      await user.selectOptions(control('organization.defaultLocale'), 'ar');
      await user.selectOptions(control('organization.defaultTimezone'), 'Asia/Amman');
      await user.click(screen.getByRole('button', { name: M('admin.save') }));

      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith(
        'PATCH',
        '/api/v1/org/tenant',
        { displayName: 'Tenant One', defaultLocale: 'ar', defaultTimezone: 'Asia/Amman' },
        { ifMatch: 3 }
      );
      expect(await screen.findByText(M('admin.saved'))).toBeVisible();
      expect(refresh).toHaveBeenCalledTimes(1);
      // What was saved stays on screen, and is no longer unsaved work.
      expect(control('organization.defaultLocale')).toHaveValue('ar');
      expect(control('organization.defaultTimezone')).toHaveValue('Asia/Amman');
      expect(screen.queryByRole('button', { name: M('organization.discardChanges') })).toBeNull();
    });

    it('puts the saved values back with Discard changes, which appears only once something changed', async () => {
      const user = userEvent.setup();
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite
          tenant={WORKSPACE}
          referenceValues={REFERENCES}
        />
      );
      expect(screen.queryByRole('button', { name: M('organization.discardChanges') })).toBeNull();
      await user.clear(control('organization.displayName'));
      await user.type(control('organization.displayName'), 'Renamed');
      await user.selectOptions(control('organization.defaultTimezone'), 'Asia/Amman');
      await user.click(screen.getByRole('button', { name: M('organization.discardChanges') }));

      expect(control('organization.displayName')).toHaveValue('Tenant One');
      expect(control('organization.defaultTimezone')).toHaveValue('UTC');
      expect(screen.queryByRole('button', { name: M('organization.discardChanges') })).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it('declares unsaved work to the shell, and a discard from the shell puts the saved values back', async () => {
      const user = userEvent.setup();
      paint(
        inBranch(
          <>
            <TenantForm
              locale={locale}
              messages={messages}
              canWrite
              tenant={WORKSPACE}
              referenceValues={REFERENCES}
            />
            <UnsavedProbe />
          </>,
          { locale }
        )
      );
      await user.click(screen.getByRole('button', { name: 'probe unsaved' }));
      expect(screen.getByTestId('unsaved-answer')).toHaveTextContent('false');

      await user.selectOptions(control('organization.defaultLocale'), 'ar');
      await user.click(screen.getByRole('button', { name: 'probe unsaved' }));
      expect(screen.getByTestId('unsaved-answer')).toHaveTextContent('true');

      await user.click(screen.getByRole('button', { name: 'probe discard' }));
      await waitFor(() => expect(control('organization.defaultLocale')).toHaveValue('en'));
      await user.click(screen.getByRole('button', { name: 'probe unsaved' }));
      expect(screen.getByTestId('unsaved-answer')).toHaveTextContent('false');
    });

    /*
     * DEF-S2a (settings QA at d17e7df1): a blank or whitespace-only display name
     * was read as "not sent", so the zone beside it was saved, the form said
     * "Saved." and the server kept the old name while the field stayed blank.
     */
    it.each([
      { name: 'an empty', typed: '' },
      { name: 'a whitespace-only', typed: '   ' },
    ])('refuses $name display name on its field and saves nothing', async ({ typed }) => {
      const user = userEvent.setup();
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite
          tenant={WORKSPACE}
          referenceValues={REFERENCES}
        />
      );
      const name = control('organization.displayName');
      await user.clear(name);
      if (typed.length > 0) await user.type(name, typed);
      await user.selectOptions(control('organization.defaultTimezone'), 'Asia/Amman');
      await user.click(screen.getByRole('button', { name: M('admin.save') }));

      expect(await screen.findByText(M('field.required'))).toBeVisible();
      expect(name).toHaveAttribute('aria-invalid', 'true');
      expect(name).toHaveAccessibleDescription(new RegExp(escapeRegExp(M('field.required'))));
      await waitFor(() => expect(name).toHaveFocus());
      // Nothing was sent, nothing was said to be saved, and the other choice stays.
      expect(send).not.toHaveBeenCalled();
      expect(refresh).not.toHaveBeenCalled();
      expect(screen.queryByText(M('admin.saved'))).toBeNull();
      expect(control('organization.defaultTimezone')).toHaveValue('Asia/Amman');
      expect(name).toHaveValue(typed);
      // Still unsaved work, so it can still be put back.
      expect(screen.getByRole('button', { name: M('organization.discardChanges') })).toBeVisible();

      await user.type(name, 'Renamed');
      expect(screen.queryByText(M('field.required'))).toBeNull();
      expect(name).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('moves the cursor to a refused field, keeps what was typed, and clears the complaint on correction', async () => {
      send.mockResolvedValue({
        ok: false,
        kind: 'validation',
        status: 422,
        problem: {
          type: 'urn:rootlco:error:ERR-VAL-001',
          title: 'Validation failed',
          status: 422,
          code: 'ERR-VAL-001',
          correlationId: 'corr-tenant',
          violations: [{ path: 'body.defaultTimezone', rule: 'unknown_reference' }],
        },
        correlationId: 'corr-tenant',
      });
      const user = userEvent.setup();
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite
          tenant={WORKSPACE}
          referenceValues={REFERENCES}
        />
      );
      await user.clear(control('organization.displayName'));
      await user.type(control('organization.displayName'), 'Renamed');
      await user.selectOptions(control('organization.defaultTimezone'), 'Asia/Amman');
      await user.click(screen.getByRole('button', { name: M('admin.save') }));

      expect(await screen.findByText(M('form.violation.unknown_reference'))).toBeVisible();
      const zone = control('organization.defaultTimezone');
      expect(zone).toHaveAttribute('aria-invalid', 'true');
      await waitFor(() => expect(zone).toHaveFocus());
      // Nothing typed was lost to the refusal.
      expect(control('organization.displayName')).toHaveValue('Renamed');
      expect(zone).toHaveValue('Asia/Amman');
      expect(refresh).not.toHaveBeenCalled();

      await user.selectOptions(zone, 'UTC');
      expect(screen.queryByText(M('form.violation.unknown_reference'))).toBeNull();
      expect(control('organization.defaultTimezone')).not.toHaveAttribute('aria-invalid', 'true');
    });

    /*
     * FIX ROUND 1 of PR #475. A save refused for a reason that names no field
     * (a lost-update 412, a server fault) left React to reset the form once the
     * action settled; a controlled native select then fell back to its first
     * option — the SAVED value — while the draft still held the operator's
     * choice, so the screen lied and a second Save sent the saved values.
     */
    const SAVED_FIRST: ReferenceValues = {
      ...REFERENCES,
      timezones: [{ zoneName: 'UTC' }, { zoneName: 'Asia/Amman' }],
      languages: [
        { localeCode: 'en', name: 'English', direction: 'ltr' },
        { localeCode: 'ar', name: 'Arabic', direction: 'rtl' },
      ],
    };
    it.each([
      {
        name: 'a 412 lost-update refusal',
        failure: {
          ok: false,
          kind: 'conflict',
          status: 412,
          problem: {
            type: 'about:blank',
            title: 'Precondition failed',
            status: 412,
            code: 'ERR-CON-002',
            correlationId: 'corr-412',
          },
          correlationId: 'corr-412',
        },
      },
      {
        name: 'a 500 server fault',
        failure: {
          ok: false,
          kind: 'server',
          status: 500,
          problem: {
            type: 'about:blank',
            title: 'Internal error',
            status: 500,
            code: 'ERR-SYS-001',
            correlationId: 'corr-500',
          },
          correlationId: 'corr-500',
        },
      },
    ])('keeps every typed value after $name, and a second Save sends them', async ({ failure }) => {
      send.mockResolvedValue(failure);
      const user = userEvent.setup();
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite
          tenant={WORKSPACE}
          referenceValues={SAVED_FIRST}
        />
      );
      // The saved values are each select's FIRST option, which is where a
      // reset native select lands; any other order would hide the defect.
      expect(optionValues(control('organization.defaultLocale'))[0]).toBe('en');
      expect(optionValues(control('organization.defaultTimezone'))[0]).toBe('UTC');
      await user.clear(control('organization.displayName'));
      await user.type(control('organization.displayName'), 'Renamed');
      await user.selectOptions(control('organization.defaultLocale'), 'ar');
      await user.selectOptions(control('organization.defaultTimezone'), 'Asia/Amman');
      await user.click(screen.getByRole('button', { name: M('admin.save') }));

      expect(await screen.findByRole('alert')).toBeVisible();
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(control('organization.displayName')).toHaveValue('Renamed');
      expect(control('organization.defaultLocale')).toHaveValue('ar');
      expect(control('organization.defaultTimezone')).toHaveValue('Asia/Amman');
      expect(refresh).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: M('admin.save') }));
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      expect(send).toHaveBeenLastCalledWith(
        'PATCH',
        '/api/v1/org/tenant',
        { displayName: 'Renamed', defaultLocale: 'ar', defaultTimezone: 'Asia/Amman' },
        { ifMatch: 3 }
      );
    });

    it('holds Save disabled while a save is in flight, so it cannot be sent twice', async () => {
      let settle: (value: unknown) => void = () => undefined;
      send.mockReturnValue(
        new Promise((resolve) => {
          settle = resolve;
        })
      );
      const user = userEvent.setup();
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite
          tenant={WORKSPACE}
          referenceValues={REFERENCES}
        />
      );
      await user.selectOptions(control('organization.defaultLocale'), 'ar');
      await user.click(screen.getByRole('button', { name: M('admin.save') }));

      const pending = await screen.findByRole('button', { name: M('admin.saving') });
      expect(pending).toBeDisabled();
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      settle({ ok: true, status: 200, data: {}, correlationId: 'corr-save' });
      expect(await screen.findByText(M('admin.saved'))).toBeVisible();
      expect(screen.getByRole('button', { name: M('admin.save') })).toBeEnabled();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('withdraws every complaint when Discard changes puts the saved values back', async () => {
      send.mockResolvedValue({
        ok: false,
        kind: 'validation',
        status: 422,
        problem: {
          type: 'urn:rootlco:error:ERR-VAL-001',
          title: 'Validation failed',
          status: 422,
          code: 'ERR-VAL-001',
          correlationId: 'corr-tenant',
          violations: [{ path: 'body.displayName', rule: 'unknown_reference' }],
        },
        correlationId: 'corr-tenant',
      });
      const user = userEvent.setup();
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite
          tenant={WORKSPACE}
          referenceValues={REFERENCES}
        />
      );
      await user.clear(control('organization.displayName'));
      await user.type(control('organization.displayName'), 'Renamed');
      await user.click(screen.getByRole('button', { name: M('admin.save') }));
      expect(await screen.findByText(M('form.violation.unknown_reference'))).toBeVisible();
      expect(control('organization.displayName')).toHaveAttribute('aria-invalid', 'true');

      await user.click(screen.getByRole('button', { name: M('organization.discardChanges') }));

      expect(control('organization.displayName')).toHaveValue('Tenant One');
      expect(control('organization.displayName')).not.toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByText(M('form.violation.unknown_reference'))).toBeNull();
    });

    it('withdraws every complaint when the shell discards the unsaved work', async () => {
      send.mockResolvedValue({
        ok: false,
        kind: 'validation',
        status: 422,
        problem: {
          type: 'urn:rootlco:error:ERR-VAL-001',
          title: 'Validation failed',
          status: 422,
          code: 'ERR-VAL-001',
          correlationId: 'corr-tenant',
          violations: [{ path: 'body.defaultTimezone', rule: 'unknown_reference' }],
        },
        correlationId: 'corr-tenant',
      });
      const user = userEvent.setup();
      paint(
        inBranch(
          <>
            <TenantForm
              locale={locale}
              messages={messages}
              canWrite
              tenant={WORKSPACE}
              referenceValues={REFERENCES}
            />
            <UnsavedProbe />
          </>,
          { locale }
        )
      );
      await user.selectOptions(control('organization.defaultTimezone'), 'Asia/Amman');
      await user.click(screen.getByRole('button', { name: M('admin.save') }));
      expect(await screen.findByText(M('form.violation.unknown_reference'))).toBeVisible();

      await user.click(screen.getByRole('button', { name: 'probe discard' }));

      await waitFor(() => expect(control('organization.defaultTimezone')).toHaveValue('UTC'));
      expect(control('organization.defaultTimezone')).not.toHaveAttribute('aria-invalid', 'true');
      expect(screen.queryByText(M('form.violation.unknown_reference'))).toBeNull();
    });
  }
);

/*
 * P1-32-PRE-OD-ADM1 — the Organisation screen on Material UI, and the company
 * and branch edit journey (`org.company-update`, `org.branch-update`), which no
 * screen called before: a company or a branch could be added and switched on or
 * off, but never renamed.
 *
 * The properties under test, in English and in Arabic:
 *
 *   - Edit is offered only with the code its operation declares;
 *   - an edit sends the version the list published for the row as `If-Match`,
 *     and only the fields the operator changed; a cleared city is removed;
 *   - a refusal is said on its field with the cursor there, and nothing typed is
 *     lost; a field the server refuses is marked the same way;
 *   - someone else's change first is a conflict: the typed values stay, Save
 *     waits for "Load the latest version", and the latest values then come back
 *     with the new version;
 *   - a row without a published version asks for the latest one and sends
 *     nothing;
 *   - typed work asks before Escape, Close or Cancel throws it away, and is
 *     declared to the shell; focus goes into the dialog and back to the button
 *     that opened it;
 *   - two presses inside ONE act send once — for an edit, an addition, a status
 *     change, the workspace form and a setting;
 *   - a list read that did not answer is the shared state, with Try again only
 *     where it can help; a branch's place and time zone are names, not codes;
 *   - a setting's kind is said in words, and a typed setting is unsaved work.
 */
const COMPANY_V: CompanyView = { ...COMPANY, recordVersion: 4 };
const BRANCH_V: BranchView = { ...BRANCH, recordVersion: 7 };

/*
 * A refresh that resolves LATER, the way the App Router delivers one: the
 * refresh starts an async transition that waits on the server's answer, and
 * the new props are rendered only once it arrives — after a timer, outside the
 * refresh call. React holds every transition entangled with a pending async
 * action, so the dialog's own transition stays pending until that render is
 * in: the props are committed while `refreshing` is still true, and the
 * pending state ends on the render after.
 */
function slowLoad() {
  let deliver: () => void = () => undefined;
  const until = new Promise<void>((resolve) => {
    deliver = resolve;
  });
  return { until, deliver: () => deliver() };
}
const afterTimer = (ms = 25) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const conflictFailure = {
  ok: false,
  kind: 'conflict',
  status: 409,
  problem: {
    type: 'urn:rootlco:error:ERR-CON-001',
    title: 'Record version conflict',
    status: 409,
    code: 'ERR-CON-001',
    correlationId: 'corr-conflict',
  },
  correlationId: 'corr-conflict',
};

describe.each(READERS)(
  '$locale: editing a company and a branch (ADM-1)',
  ({ locale, messages, M, paint }) => {
    function structure(over: Record<string, unknown> = {}) {
      return (
        <OrganizationStructure
          locale={locale}
          messages={messages}
          capacity={capacity()}
          companies={ok([COMPANY_V])}
          branches={ok([BRANCH_V])}
          currencyChoices={['JOD']}
          timezoneChoices={['Asia/Amman']}
          referenceValues={REFERENCES}
          canManageCompanies
          canManageBranches
          canChangeBranchStatus
          {...over}
        />
      );
    }
    const editButton = (name: string) =>
      screen.getByRole('button', { name: `${M('admin.edit')}: ${name}` });
    const field = (scope: HTMLElement, key: string) => labelled(scope, M(key));

    it('offers Edit only with the code its operation declares', () => {
      paint(structure({ canManageCompanies: false }));
      expect(
        screen.queryByRole('button', { name: `${M('admin.edit')}: ${COMPANY.legalName}` })
      ).toBeNull();
      expect(editButton(BRANCH.name)).toBeVisible();
    });

    it('offers no branch Edit without org.branch.manage, keeping the status control', () => {
      paint(structure({ canManageBranches: false }));
      expect(
        screen.queryByRole('button', { name: `${M('admin.edit')}: ${BRANCH.name}` })
      ).toBeNull();
      expect(editButton(COMPANY.legalName)).toBeVisible();
      expect(
        screen.getByRole('button', {
          name: `${M('organization.structure.deactivate')}: ${BRANCH.name}`,
        })
      ).toBeVisible();
    });

    it('renames a company with the version the list published, says so and re-reads', async () => {
      send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'corr-edit' });
      const user = userEvent.setup();
      paint(structure());
      const opener = editButton(COMPANY.legalName);
      await user.click(opener);
      const dialog = screen.getByRole('dialog', { name: M('organization.company.edit') });
      const name = field(dialog, 'organization.company.legalName');
      // The cursor is inside the dialog, on the field to change.
      expect(name).toHaveFocus();
      expect(name).toHaveValue(COMPANY.legalName);

      await user.clear(name);
      await user.type(name, 'Main Company Group');
      await user.click(within(dialog).getByRole('button', { name: M('admin.save') }));

      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith(
        'PATCH',
        `/api/v1/org/companies/${COMPANY.id}`,
        { legalName: 'Main Company Group' },
        { ifMatch: 4 }
      );
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(refresh).toHaveBeenCalledTimes(1);
      // Focus is back on the control that opened the dialog.
      await waitFor(() => expect(opener).toHaveFocus());
    });

    it('sends only the branch fields that changed, and removes a cleared city', async () => {
      send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'corr-branch' });
      const user = userEvent.setup();
      paint(structure());
      await user.click(editButton(BRANCH.name));
      const dialog = screen.getByRole('dialog', { name: M('organization.branch.edit') });
      expect(field(dialog, 'organization.branch.name')).toHaveValue(BRANCH.name);
      expect(field(dialog, 'organization.branch.timezone')).toHaveValue('Asia/Amman');

      await user.clear(field(dialog, 'organization.branch.name'));
      await user.type(field(dialog, 'organization.branch.name'), 'First Branch East');
      await user.clear(field(dialog, 'organization.branch.city'));
      await user.selectOptions(field(dialog, 'organization.branch.timezone'), 'UTC');
      await user.click(within(dialog).getByRole('button', { name: M('admin.save') }));

      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith(
        'PATCH',
        `/api/v1/org/branches/${BRANCH.id}`,
        { name: 'First Branch East', timezoneName: 'UTC', city: null },
        { ifMatch: 7 }
      );
    });

    it('refuses a blank legal name on its field, with the cursor there, and sends nothing', async () => {
      const user = userEvent.setup();
      paint(structure());
      await user.click(editButton(COMPANY.legalName));
      const dialog = screen.getByRole('dialog');
      const name = field(dialog, 'organization.company.legalName');
      await user.clear(name);
      await user.type(name, '   ');
      await user.click(within(dialog).getByRole('button', { name: M('admin.save') }));

      expect(await within(dialog).findByText(M('field.required'))).toBeVisible();
      expect(name).toHaveAttribute('aria-invalid', 'true');
      await waitFor(() => expect(name).toHaveFocus());
      expect(name).toHaveValue('   ');
      expect(send).not.toHaveBeenCalled();
    });

    it('says when nothing has been changed, and sends nothing', async () => {
      const user = userEvent.setup();
      paint(structure());
      await user.click(editButton(COMPANY.legalName));
      const dialog = screen.getByRole('dialog');
      await user.click(within(dialog).getByRole('button', { name: M('admin.save') }));
      expect(await within(dialog).findByText(M('organization.edit.unchanged'))).toBeVisible();
      expect(send).not.toHaveBeenCalled();
    });

    it('puts a time zone the platform does not hold on the time zone field', async () => {
      send.mockResolvedValue({
        ok: false,
        kind: 'validation',
        status: 422,
        problem: {
          type: 'urn:rootlco:error:ERR-VAL-001',
          title: 'Validation failed',
          status: 422,
          code: 'ERR-VAL-001',
          correlationId: 'corr-zone',
          violations: [{ path: 'body.timezoneName', rule: 'unknown_reference' }],
        },
        correlationId: 'corr-zone',
      });
      const user = userEvent.setup();
      paint(structure());
      await user.click(editButton(BRANCH.name));
      const dialog = screen.getByRole('dialog');
      const zone = field(dialog, 'organization.branch.timezone');
      await user.selectOptions(zone, 'UTC');
      await user.click(within(dialog).getByRole('button', { name: M('admin.save') }));

      expect(await within(dialog).findByText(M('form.violation.unknown_reference'))).toBeVisible();
      expect(zone).toHaveAttribute('aria-invalid', 'true');
      await waitFor(() => expect(zone).toHaveFocus());
      expect(zone).toHaveValue('UTC');
      expect(field(dialog, 'organization.branch.name')).not.toHaveAttribute('aria-invalid', 'true');
    });

    it('says a conflict, keeps the typed name, and holds Save until the latest version is loaded', async () => {
      send.mockResolvedValueOnce(conflictFailure);
      const user = userEvent.setup();
      const view = paint(structure());
      await user.click(editButton(COMPANY.legalName));
      const dialog = screen.getByRole('dialog');
      const name = field(dialog, 'organization.company.legalName');
      await user.clear(name);
      await user.type(name, 'Main Company Group');
      await user.click(within(dialog).getByRole('button', { name: M('admin.save') }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(M('state.conflict.title'));
      expect(name).toHaveValue('Main Company Group');
      expect(within(dialog).getByRole('button', { name: M('admin.save') })).toBeDisabled();
      expect(refresh).not.toHaveBeenCalled();

      // The re-read brings the record as someone else left it, at its new
      // version — inside the refresh, as the router delivers it, so the load
      // the operator asked for is the one that brings it.
      refresh.mockImplementationOnce(() => {
        view.rerender(
          structure({
            companies: ok([{ ...COMPANY_V, legalName: 'Main Holding', recordVersion: 5 }]),
          })
        );
      });
      await user.click(within(dialog).getByRole('button', { name: M('form.loadLatest') }));
      expect(refresh).toHaveBeenCalledTimes(1);
      const reread = field(screen.getByRole('dialog'), 'organization.company.legalName');
      await waitFor(() => expect(reread).toHaveValue('Main Holding'));
      expect(screen.getByText(M('organization.edit.latestLoaded'))).toBeVisible();
      const save = within(screen.getByRole('dialog')).getByRole('button', {
        name: M('admin.save'),
      });
      expect(save).toBeEnabled();

      send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'corr-again' });
      await user.clear(reread);
      await user.type(reread, 'Main Company Group');
      await user.click(save);
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      expect(send).toHaveBeenLastCalledWith(
        'PATCH',
        `/api/v1/org/companies/${COMPANY.id}`,
        { legalName: 'Main Company Group' },
        { ifMatch: 5 }
      );
    });

    it('keeps typed branch edits when Try again renders a newer version, and lets the save conflict', async () => {
      send.mockResolvedValueOnce(conflictFailure);
      const user = userEvent.setup();
      const partial = { referenceValues: null, referenceUnavailable: true };
      const view = paint(structure(partial));
      await user.click(editButton(BRANCH.name));
      const dialog = screen.getByRole('dialog', { name: M('organization.branch.edit') });
      const city = field(dialog, 'organization.branch.city');
      await user.type(city, ' North');

      // The time-zone list's Try again renders the page again, and someone else
      // has meanwhile saved the branch: a newer version with another city.
      await user.click(within(dialog).getByRole('button', { name: M('form.retry') }));
      expect(refresh).toHaveBeenCalledTimes(1);
      await act(async () => {
        view.rerender(
          structure({
            ...partial,
            branches: ok([{ ...BRANCH_V, city: 'Irbid', recordVersion: 8 }]),
          })
        );
      });

      // The typed draft is still what the operator typed; nothing was replaced.
      expect(field(screen.getByRole('dialog'), 'organization.branch.city')).toHaveValue(
        'Amman North'
      );
      expect(screen.queryByText(M('organization.edit.latestLoaded'))).toBeNull();

      // Saving sends the version the draft was based on, so it is refused as
      // the ordinary conflict rather than written over the newer record.
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: M('admin.save') })
      );
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith(
        'PATCH',
        `/api/v1/org/branches/${BRANCH.id}`,
        { city: 'Amman North' },
        { ifMatch: 7 }
      );
      expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
        M('state.conflict.title')
      );
      expect(field(screen.getByRole('dialog'), 'organization.branch.city')).toHaveValue(
        'Amman North'
      );

      // Only "Load the latest version" puts the saved values in front of them.
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: M('form.loadLatest') })
      );
      expect(refresh).toHaveBeenCalledTimes(2);
      await waitFor(() =>
        expect(field(screen.getByRole('dialog'), 'organization.branch.city')).toHaveValue('Irbid')
      );
      expect(screen.getByText(M('organization.edit.latestLoaded'))).toBeVisible();
    });

    it('asks for the latest version when the list published none, and sends nothing', async () => {
      const user = userEvent.setup();
      paint(structure({ companies: ok([COMPANY]) }));
      await user.click(editButton(COMPANY.legalName));
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText(M('organization.edit.versionUnknown'))).toBeVisible();
      expect(within(dialog).getByRole('button', { name: M('admin.save') })).toBeDisabled();
      await user.click(within(dialog).getByRole('button', { name: M('form.loadLatest') }));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
    });

    /*
     * ADM-1 review follow-up (ADM-5): a "Load the latest version" lasts one
     * load. When it brings back the same version, or none, the request ends with
     * it, so a later Try again that renders a newer version cannot replace the
     * draft the operator typed.
     */
    const partialLists = { referenceValues: null, referenceUnavailable: true };
    const cityIn = () => field(screen.getByRole('dialog'), 'organization.branch.city');

    it('keeps the typed draft when the latest load brings the same version, and after a later Try again', async () => {
      send.mockResolvedValueOnce(conflictFailure);
      const user = userEvent.setup();
      const view = paint(structure(partialLists));
      await user.click(editButton(BRANCH.name));
      const dialog = screen.getByRole('dialog', { name: M('organization.branch.edit') });
      await user.type(field(dialog, 'organization.branch.city'), ' North');
      await user.click(within(dialog).getByRole('button', { name: M('admin.save') }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(M('state.conflict.title'));

      // The latest load answers with the version the draft was based on.
      refresh.mockImplementationOnce(() => {
        view.rerender(structure({ ...partialLists, branches: ok([{ ...BRANCH_V }]) }));
      });
      await user.click(within(dialog).getByRole('button', { name: M('form.loadLatest') }));
      expect(refresh).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(
          within(screen.getByRole('dialog')).queryByRole('button', { name: M('form.loadLatest') })
        ).toBeNull()
      );
      expect(cityIn()).toHaveValue('Amman North');
      expect(screen.queryByText(M('organization.edit.latestLoaded'))).toBeNull();

      // A later Try again renders someone else's newer version: nothing is replaced.
      refresh.mockImplementationOnce(() => {
        view.rerender(
          structure({
            ...partialLists,
            branches: ok([{ ...BRANCH_V, city: 'Irbid', recordVersion: 8 }]),
          })
        );
      });
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: M('form.retry') })
      );
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(cityIn()).toHaveValue('Amman North');
      expect(screen.queryByText(M('organization.edit.latestLoaded'))).toBeNull();
    });

    it('keeps the typed draft when the latest load brings no version, and after a later Try again', async () => {
      const user = userEvent.setup();
      const view = paint(structure({ ...partialLists, branches: ok([BRANCH]) }));
      await user.click(editButton(BRANCH.name));
      const dialog = screen.getByRole('dialog', { name: M('organization.branch.edit') });
      await user.type(field(dialog, 'organization.branch.city'), ' North');

      // The latest load answers, and the list still publishes no version.
      refresh.mockImplementationOnce(() => {
        view.rerender(structure({ ...partialLists, branches: ok([{ ...BRANCH }]) }));
      });
      await user.click(within(dialog).getByRole('button', { name: M('form.loadLatest') }));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(cityIn()).toHaveValue('Amman North');
      expect(
        within(screen.getByRole('dialog')).getByText(M('organization.edit.versionUnknown'))
      ).toBeVisible();

      // A later Try again renders a versioned, newer record: nothing is replaced.
      refresh.mockImplementationOnce(() => {
        view.rerender(
          structure({
            ...partialLists,
            branches: ok([{ ...BRANCH_V, city: 'Irbid', recordVersion: 8 }]),
          })
        );
      });
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: M('form.retry') })
      );
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(cityIn()).toHaveValue('Amman North');
      expect(screen.queryByText(M('organization.edit.latestLoaded'))).toBeNull();
      expect(send).not.toHaveBeenCalled();
    });

    it('puts the saved values back when the latest load brings a newer version', async () => {
      send.mockResolvedValueOnce(conflictFailure);
      const user = userEvent.setup();
      const view = paint(structure(partialLists));
      await user.click(editButton(BRANCH.name));
      const dialog = screen.getByRole('dialog', { name: M('organization.branch.edit') });
      await user.type(field(dialog, 'organization.branch.city'), ' North');
      await user.click(within(dialog).getByRole('button', { name: M('admin.save') }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(M('state.conflict.title'));

      refresh.mockImplementationOnce(() => {
        view.rerender(
          structure({
            ...partialLists,
            branches: ok([{ ...BRANCH_V, city: 'Irbid', recordVersion: 8 }]),
          })
        );
      });
      await user.click(within(dialog).getByRole('button', { name: M('form.loadLatest') }));
      expect(refresh).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(cityIn()).toHaveValue('Irbid'));
      expect(screen.getByText(M('organization.edit.latestLoaded'))).toBeVisible();
      expect(
        within(screen.getByRole('dialog')).getByRole('button', { name: M('admin.save') })
      ).toBeEnabled();
    });

    /*
     * The same three loads, with the refresh resolving LATER: the props it
     * brings are committed after a timer, outside the click, while the load is
     * still pending. And the one ordering the guard does not handle in a single
     * load — the pending state ending before the props arrive — pinned as what
     * it actually does.
     */
    async function conflictedBranchEdit() {
      send.mockResolvedValueOnce(conflictFailure);
      const user = userEvent.setup();
      await user.click(editButton(BRANCH.name));
      const dialog = screen.getByRole('dialog', { name: M('organization.branch.edit') });
      await user.type(field(dialog, 'organization.branch.city'), ' North');
      await user.click(within(dialog).getByRole('button', { name: M('admin.save') }));
      expect(await within(dialog).findByRole('alert')).toHaveTextContent(M('state.conflict.title'));
      return user;
    }
    const loadButton = () =>
      within(screen.getByRole('dialog')).queryByRole('button', { name: M('form.loadLatest') });
    const saveButton = () =>
      within(screen.getByRole('dialog')).getByRole('button', { name: M('admin.save') });

    it('puts the saved values back when a later-resolving load brings a newer version', async () => {
      const view = paint(structure(partialLists));
      const user = await conflictedBranchEdit();

      const load = slowLoad();
      refresh.mockImplementationOnce(() => {
        startTransition(async () => {
          await load.until;
          view.rerender(
            structure({
              ...partialLists,
              branches: ok([{ ...BRANCH_V, city: 'Irbid', recordVersion: 8 }]),
            })
          );
        });
      });
      await user.click(loadButton() as HTMLElement);
      expect(refresh).toHaveBeenCalledTimes(1);

      // Still loading: the typed draft is in front of the operator, Save is held
      // and the button says it is busy.
      expect(cityIn()).toHaveValue('Amman North');
      expect(loadButton()).toBeDisabled();
      expect(loadButton()).toHaveAttribute('aria-busy', 'true');
      expect(saveButton()).toBeDisabled();
      expect(screen.queryByText(M('organization.edit.latestLoaded'))).toBeNull();

      await act(async () => {
        await afterTimer();
        load.deliver();
        await load.until;
      });
      await waitFor(() => expect(cityIn()).toHaveValue('Irbid'));
      expect(screen.getByText(M('organization.edit.latestLoaded'))).toBeVisible();
      expect(saveButton()).toBeEnabled();
    });

    it('ends the request and keeps the draft when a later-resolving load brings the same version', async () => {
      const view = paint(structure(partialLists));
      const user = await conflictedBranchEdit();

      const load = slowLoad();
      refresh.mockImplementationOnce(() => {
        startTransition(async () => {
          await load.until;
          view.rerender(structure({ ...partialLists, branches: ok([{ ...BRANCH_V }]) }));
        });
      });
      await user.click(loadButton() as HTMLElement);
      expect(loadButton()).toHaveAttribute('aria-busy', 'true');

      await act(async () => {
        await afterTimer();
        load.deliver();
        await load.until;
      });
      await waitFor(() => expect(loadButton()).toBeNull());
      expect(cityIn()).toHaveValue('Amman North');
      // Nothing claims the latest was loaded; the refusal the save met still stands.
      expect(screen.queryByText(M('organization.edit.latestLoaded'))).toBeNull();
      expect(within(screen.getByRole('dialog')).getByRole('alert')).toHaveTextContent(
        M('state.conflict.title')
      );

      // The request is over: a later Try again that renders a newer version
      // replaces nothing.
      refresh.mockImplementationOnce(() => {
        view.rerender(
          structure({
            ...partialLists,
            branches: ok([{ ...BRANCH_V, city: 'Irbid', recordVersion: 8 }]),
          })
        );
      });
      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: M('form.retry') })
      );
      expect(refresh).toHaveBeenCalledTimes(2);
      expect(cityIn()).toHaveValue('Amman North');
      expect(screen.queryByText(M('organization.edit.latestLoaded'))).toBeNull();
    });

    it('waits for what the load brings when a newer version was already on the page', async () => {
      const view = paint(structure(partialLists));
      const user = await conflictedBranchEdit();

      // An unrelated render (a list's Try again) has already put version 8 on
      // the page; the draft is kept, as it must be.
      await act(async () => {
        view.rerender(
          structure({
            ...partialLists,
            branches: ok([{ ...BRANCH_V, city: 'Irbid', recordVersion: 8 }]),
          })
        );
      });
      expect(cityIn()).toHaveValue('Amman North');

      // The load the operator then asks for brings version 9. The click's own
      // render must not end the request on version 8 and drop what follows.
      const load = slowLoad();
      refresh.mockImplementationOnce(() => {
        startTransition(async () => {
          await load.until;
          view.rerender(
            structure({
              ...partialLists,
              branches: ok([{ ...BRANCH_V, city: 'Zarqa', recordVersion: 9 }]),
            })
          );
        });
      });
      await user.click(loadButton() as HTMLElement);
      expect(cityIn()).toHaveValue('Amman North');
      expect(screen.queryByText(M('organization.edit.latestLoaded'))).toBeNull();

      await act(async () => {
        await afterTimer();
        load.deliver();
        await load.until;
      });
      await waitFor(() => expect(cityIn()).toHaveValue('Zarqa'));
      expect(screen.getByText(M('organization.edit.latestLoaded'))).toBeVisible();

      send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'corr-nine' });
      await user.type(cityIn(), ' East');
      await user.click(saveButton());
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      expect(send).toHaveBeenLastCalledWith(
        'PATCH',
        `/api/v1/org/branches/${BRANCH.id}`,
        { city: 'Zarqa East' },
        { ifMatch: 9 }
      );
    });

    it('needs a second load when the pending state ends before the newer props arrive', async () => {
      const view = paint(structure(partialLists));
      const user = await conflictedBranchEdit();

      // The refresh call returns with nothing rendered, so the load ends as
      // "nothing newer"; the newer props are only rendered after a timer.
      await user.click(loadButton() as HTMLElement);
      expect(refresh).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(loadButton()).toBeNull());
      await act(async () => {
        await afterTimer();
      });
      view.rerender(
        structure({
          ...partialLists,
          branches: ok([{ ...BRANCH_V, city: 'Irbid', recordVersion: 8 }]),
        })
      );

      // What actually happens: the late props are treated as any other render.
      // The draft is kept and nothing claims the latest was loaded.
      expect(cityIn()).toHaveValue('Amman North');
      expect(screen.queryByText(M('organization.edit.latestLoaded'))).toBeNull();

      // A save is refused as the ordinary conflict, with the draft's version.
      send.mockResolvedValueOnce(conflictFailure);
      await user.click(saveButton());
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      expect(send).toHaveBeenLastCalledWith(
        'PATCH',
        `/api/v1/org/branches/${BRANCH.id}`,
        { city: 'Amman North' },
        { ifMatch: 7 }
      );
      expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(
        M('state.conflict.title')
      );

      // A second "Load the latest version" is what brings the newer values.
      await user.click(loadButton() as HTMLElement);
      expect(refresh).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(cityIn()).toHaveValue('Irbid'));
      expect(screen.getByText(M('organization.edit.latestLoaded'))).toBeVisible();
    });

    it('asks before Escape or Cancel throws typed work away, and keeps it on Cancel', async () => {
      const user = userEvent.setup();
      paint(structure());
      const opener = editButton(BRANCH.name);
      await user.click(opener);
      const dialog = screen.getByRole('dialog');
      await user.type(field(dialog, 'organization.branch.city'), ' North');

      await user.keyboard('{Escape}');
      const question = await screen.findByRole('alertdialog', { name: M('form.unsavedTitle') });
      await user.click(within(question).getByRole('button', { name: M('overlay.cancel') }));
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(field(screen.getByRole('dialog'), 'organization.branch.city')).toHaveValue(
        'Amman North'
      );

      await user.click(
        within(screen.getByRole('dialog')).getByRole('button', { name: M('admin.cancel') })
      );
      const again = await screen.findByRole('alertdialog', { name: M('form.unsavedTitle') });
      await user.click(within(again).getByRole('button', { name: M('form.discard') }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(send).not.toHaveBeenCalled();
      await waitFor(() => expect(opener).toHaveFocus());
    });

    it('closes at once on Escape with nothing typed', async () => {
      const user = userEvent.setup();
      paint(structure());
      await user.click(editButton(COMPANY.legalName));
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    it('declares typed work to the shell, whose discard closes the dialog', async () => {
      const user = userEvent.setup();
      paint(
        inBranch(
          <>
            {structure()}
            <UnsavedProbe />
          </>,
          { locale }
        )
      );
      await user.click(editButton(COMPANY.legalName));
      await user.type(field(screen.getByRole('dialog'), 'organization.company.legalName'), ' Ltd');
      fireEvent.click(screen.getByRole('button', { name: 'probe unsaved', hidden: true }));
      expect(screen.getByTestId('unsaved-answer')).toHaveTextContent('true');
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: 'probe discard', hidden: true }));
      });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(send).not.toHaveBeenCalled();
    });

    it('sends an edit once when Save is pressed twice in one act', async () => {
      let settle: (value: unknown) => void = () => undefined;
      send.mockReturnValue(
        new Promise((resolve) => {
          settle = resolve;
        })
      );
      const user = userEvent.setup();
      paint(structure());
      await user.click(editButton(COMPANY.legalName));
      const dialog = screen.getByRole('dialog');
      await user.type(field(dialog, 'organization.company.legalName'), ' Ltd');
      const save = within(dialog).getByRole('button', { name: M('admin.save') });
      await act(async () => {
        fireEvent.click(save);
        fireEvent.click(save);
      });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      settle({ ok: true, status: 200, data: {}, correlationId: 'corr-once' });
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('adds a company once when Create is pressed twice in one act', async () => {
      let settle: (value: unknown) => void = () => undefined;
      send.mockReturnValue(
        new Promise((resolve) => {
          settle = resolve;
        })
      );
      const user = userEvent.setup();
      paint(structure());
      await user.click(screen.getByRole('button', { name: M('organization.company.add') }));
      const dialog = screen.getByRole('dialog');
      await user.type(field(dialog, 'organization.structure.code'), 'second_company');
      await user.type(field(dialog, 'organization.company.legalName'), 'Second Company');
      await user.selectOptions(field(dialog, 'organization.company.baseCurrency'), 'JOD');
      const create = within(dialog).getByRole('button', { name: M('admin.create') });
      await act(async () => {
        fireEvent.click(create);
        fireEvent.click(create);
      });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      settle({ ok: true, status: 201, data: {}, correlationId: 'corr-add' });
      expect(await within(dialog).findByText(M('organization.company.created'))).toBeVisible();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('changes a status once when the confirmation is pressed twice in one act', async () => {
      let settle: (value: unknown) => void = () => undefined;
      send.mockReturnValue(
        new Promise((resolve) => {
          settle = resolve;
        })
      );
      const user = userEvent.setup();
      paint(structure());
      await user.click(
        screen.getByRole('button', {
          name: `${M('organization.structure.deactivate')}: ${COMPANY.legalName}`,
        })
      );
      const question = screen.getByRole('alertdialog');
      await user.type(labelled(question, M('admin.reason')), 'Merged into the group');
      const confirm = within(question).getByRole('button', {
        name: M('organization.structure.deactivate'),
      });
      await act(async () => {
        fireEvent.click(confirm);
        fireEvent.click(confirm);
      });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      settle({ ok: true, status: 200, data: {}, correlationId: 'corr-status' });
      await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('draws a list that could not be read as the shared state, with Try again', async () => {
      const user = userEvent.setup();
      paint(
        structure({
          companies: { status: 'unavailable', correlationId: 'corr-down' },
          branches: { status: 'denied', correlationId: 'corr-refused' },
        })
      );
      expect(screen.getByText(M('state.unavailable.title'))).toBeVisible();
      expect(screen.getByText('corr-down')).toBeVisible();
      expect(screen.getByText(M('state.denied.title'))).toBeVisible();
      // One retry: the outage's. A refusal is not offered one.
      const retries = screen.getAllByRole('button', { name: M('state.retry') });
      expect(retries).toHaveLength(1);
      await user.click(retries[0] as HTMLElement);
      expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('names a branch’s country and time zone instead of printing their codes', () => {
      paint(structure());
      const row = screen.getByRole('row', { name: new RegExp(escapeRegExp(BRANCH.name)) });
      expect(within(row).getByText(/\(Asia\/Amman\)$/)).toBeVisible();
      const place = within(row).getByText(new RegExp(`^${BRANCH.city as string}, `));
      expect(place.textContent).not.toMatch(/, JO$/);
      if (locale === 'en') expect(place).toHaveTextContent('Amman, Jordan');
    });

    it('keeps every control in the reading direction, and names the dialog by its title', async () => {
      const user = userEvent.setup();
      paint(structure());
      await user.click(editButton(BRANCH.name));
      const dialog = screen.getByRole('dialog', { name: M('organization.branch.edit') });
      expect(dialog).toHaveAccessibleDescription(M('organization.branch.editDescription'));
      expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(field(dialog, 'organization.branch.country')).toHaveAttribute('dir', 'ltr');
    });
  }
);

describe.each(READERS)(
  '$locale: the workspace form and the settings editor send once (ADM-1)',
  ({ locale, messages, M, paint }) => {
    it('saves the workspace once when Save is pressed twice in one act', async () => {
      let settle: (value: unknown) => void = () => undefined;
      send.mockReturnValue(
        new Promise((resolve) => {
          settle = resolve;
        })
      );
      const user = userEvent.setup();
      paint(
        <TenantForm
          locale={locale}
          messages={messages}
          canWrite
          tenant={WORKSPACE}
          referenceValues={REFERENCES}
        />
      );
      await user.selectOptions(
        screen.getByLabelText(new RegExp(`^${escapeRegExp(M('organization.defaultLocale'))}`)),
        'ar'
      );
      const save = screen.getByRole('button', { name: M('admin.save') });
      await act(async () => {
        fireEvent.click(save);
        fireEvent.click(save);
      });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      settle({ ok: true, status: 200, data: {}, correlationId: 'corr-tenant-once' });
      expect(await screen.findByText(M('admin.saved'))).toBeVisible();
      expect(send).toHaveBeenCalledTimes(1);
    });

    function renderSettings() {
      get.mockResolvedValue({ ok: true, status: 200, data: { items: [] }, correlationId: 'c-1' });
      return paint(
        inBranch(
          <>
            <SettingsEditor messages={messages} scope="company" canWrite keyPrefix="" />
            <UnsavedProbe />
          </>,
          { locale }
        )
      );
    }

    it('says each kind of value in words, never as the stored type name', async () => {
      renderSettings();
      const kind = await screen.findByLabelText(
        new RegExp(`^${escapeRegExp(M('organization.setting.type'))}`)
      );
      const labels = within(kind)
        .getAllByRole('option')
        .map((option) => option.textContent);
      expect(labels).toEqual([
        M('organization.setting.kind.string'),
        M('organization.setting.kind.number'),
        M('organization.setting.kind.boolean'),
        M('organization.setting.kind.json'),
      ]);
      expect(labels).not.toContain('boolean');
      expect(labels).not.toContain('json');
    });

    it('declares a typed value as unsaved work, and a shell discard empties it', async () => {
      const user = userEvent.setup();
      renderSettings();
      const value = await screen.findByLabelText(
        new RegExp(`^${escapeRegExp(M('organization.setting.value'))}`)
      );
      await user.click(screen.getByRole('button', { name: 'probe unsaved' }));
      expect(screen.getByTestId('unsaved-answer')).toHaveTextContent('false');
      await user.type(value, '08:00');
      await user.click(screen.getByRole('button', { name: 'probe unsaved' }));
      expect(screen.getByTestId('unsaved-answer')).toHaveTextContent('true');
      await user.click(screen.getByRole('button', { name: 'probe discard' }));
      await waitFor(() => expect(value).toHaveValue(''));
      expect(send).not.toHaveBeenCalled();
    });

    it('writes a setting once when Save is pressed twice in one act', async () => {
      let settle: (value: unknown) => void = () => undefined;
      send.mockReturnValue(
        new Promise((resolve) => {
          settle = resolve;
        })
      );
      const user = userEvent.setup();
      renderSettings();
      await user.type(
        screen.getByLabelText(new RegExp(`^${escapeRegExp(M('organization.setting.key'))}`)),
        'org.working_hours.start'
      );
      await user.type(
        await screen.findByLabelText(
          new RegExp(`^${escapeRegExp(M('organization.setting.value'))}`)
        ),
        '08:00'
      );
      const save = screen.getByRole('button', { name: M('admin.save') });
      await act(async () => {
        fireEvent.click(save);
        fireEvent.click(save);
      });
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      settle({ ok: true, status: 200, data: {}, correlationId: 'corr-setting' });
      expect(await screen.findByText(M('admin.saved'))).toBeVisible();
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('takes a saved key other than the first suggestion as the new start, not as unsaved work', async () => {
      get.mockResolvedValue({ ok: true, status: 200, data: { items: [] }, correlationId: 'c-1' });
      send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'corr-padding' });
      const user = userEvent.setup();
      paint(
        inBranch(
          <>
            <SettingsEditor
              messages={messages}
              scope="company"
              canWrite
              keyPrefix="numbering."
              suggestions={[
                {
                  key: 'numbering.invoice.prefix',
                  labelKey: 'numbering.field.prefix',
                  valueType: 'string',
                },
                {
                  key: 'numbering.invoice.padding',
                  labelKey: 'numbering.field.padding',
                  valueType: 'number',
                },
              ]}
            />
            <UnsavedProbe />
          </>,
          { locale }
        )
      );
      const key = screen.getByLabelText(
        new RegExp(`^${escapeRegExp(M('organization.setting.key'))}`)
      );
      await user.selectOptions(key, 'numbering.invoice.padding');
      const value = await screen.findByLabelText(
        new RegExp(`^${escapeRegExp(M('organization.setting.value'))}`)
      );
      await user.type(value, '4');
      await user.click(screen.getByRole('button', { name: M('admin.save') }));
      expect(await screen.findByText(M('admin.saved'))).toBeVisible();
      expect(send).toHaveBeenCalledTimes(1);
      expect(value).toHaveValue('');
      expect(key).toHaveValue('numbering.invoice.padding');

      // A page change or a branch change has nothing to ask about.
      await user.click(screen.getByRole('button', { name: 'probe unsaved' }));
      expect(screen.getByTestId('unsaved-answer')).toHaveTextContent('false');
    });

    it('announces a second unreachable save afresh, numbered after the first', async () => {
      send.mockRejectedValue(new Error('the network went away'));
      const user = userEvent.setup();
      renderSettings();
      await user.type(
        screen.getByLabelText(new RegExp(`^${escapeRegExp(M('organization.setting.key'))}`)),
        'org.working_hours.start'
      );
      await user.type(
        await screen.findByLabelText(
          new RegExp(`^${escapeRegExp(M('organization.setting.value'))}`)
        ),
        '08:00'
      );
      const save = screen.getByRole('button', { name: M('admin.save') });
      await user.click(save);
      const first = await screen.findByRole('alert');
      expect(first).toHaveTextContent(M('state.unavailable.message'));

      await user.click(save);
      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      // A new attempt is a new announcement node, not the first one kept.
      await waitFor(() => expect(first).not.toBeInTheDocument());
      expect(screen.getByRole('alert')).toHaveTextContent(M('state.unavailable.message'));
    });

    it('draws a settings read that did not answer as the shared state, and retries it', async () => {
      get.mockResolvedValueOnce({
        ok: false,
        kind: 'unavailable',
        status: 503,
        correlationId: 'corr-settings-down',
      });
      get.mockResolvedValue({ ok: true, status: 200, data: { items: [] }, correlationId: 'c-2' });
      const user = userEvent.setup();
      paint(
        inBranch(<SettingsEditor messages={messages} scope="company" canWrite keyPrefix="" />, {
          locale,
        })
      );
      expect(await screen.findByText(M('state.unavailable.title'))).toBeVisible();
      await user.click(screen.getByRole('button', { name: M('state.retry') }));
      expect(await screen.findByText(M('state.empty.title'))).toBeVisible();
      expect(get).toHaveBeenCalledTimes(2);
    });
  }
);

// --- the settings screens (P1-32-PRE-OD-ADM5) ---------------------------------------

/**
 * Numbering rules, taxes, currencies and system settings on Material UI
 * (P1-32-PRE-OD-ADM5), rendered through their route pages.
 *
 * The properties under test, in English and in Arabic:
 *
 *   - Currencies shows the platform's currency list exactly as
 *     `org.reference-values-read` answered it — the codes in its order, the
 *     names in the page's language and the decimal places — and only for a
 *     holder of `org.tenant.read`; a read that did not answer is the shared
 *     state, and an empty list says so;
 *   - the enabled codes are written through the company settings write, and a
 *     malformed, repeated or unheld code is refused beside the value before
 *     anything is sent; someone else's write first is said as a conflict and the
 *     typed value stays;
 *   - numbering rules and taxes show the settings the settings reads hold under
 *     their keys, name what is not available and why (the decision it waits
 *     on), and offer no form, even to a holder of `org.settings.manage`;
 *   - system settings says platform settings are unreachable and keeps the
 *     company and branch editors it serves;
 *   - a page the operator may read nothing of is refused as a whole, and no read
 *     is made.
 *
 * The session is supplied by the test; no other case in this file reads it.
 */
let SESSION_PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: SESSION_PERMISSIONS, email: 'reviewer@test.local' }),
}));
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<ReactElement>;
const CurrenciesPage = (await import('@/app/[locale]/(dashboard)/administration/currencies/page'))
  .default as unknown as RoutePage;
const NumberingRulesPage = (
  await import('@/app/[locale]/(dashboard)/administration/numbering-rules/page')
).default as unknown as RoutePage;
const TaxesPage = (await import('@/app/[locale]/(dashboard)/administration/taxes/page'))
  .default as unknown as RoutePage;
const SystemSettingsPage = (
  await import('@/app/[locale]/(dashboard)/administration/system-settings/page')
).default as unknown as RoutePage;
const AdministrationHub = (await import('@/app/[locale]/(dashboard)/administration/page'))
  .default as unknown as RoutePage;

const READ_TENANT = 'org.tenant.read';
const READ_COMPANY = 'org.company.read';
const READ_BRANCH = 'org.branch.read';
const MANAGE_SETTINGS = 'org.settings.manage';

const REFERENCES_PATH = '/api/v1/org/reference-values';
const COMPANY_SETTINGS = `/api/v1/org/companies/${TEST_COMPANY.id}/settings`;
const BRANCH_SETTINGS = `/api/v1/org/branches/${TEST_BRANCH.id}/settings`;

/** What `org.reference-values-read` answers in these cases, in its code order. */
const CURRENCIES = [
  { code: 'EUR', name: 'Euro', minorUnit: 2 },
  { code: 'JOD', name: 'Jordanian Dinar', minorUnit: 3 },
  { code: 'USD', name: 'US Dollar', minorUnit: 2 },
];

const setting = (settingKey: string, settingValue: unknown, version = 1) => ({
  settingKey,
  settingValue,
  valueType: typeof settingValue === 'string' ? 'string' : 'json',
  isSensitive: false,
  version,
  effectiveFrom: '2026-10-01T00:00:00.000Z',
});

const okRead = (data: unknown) => ({ ok: true, status: 200, data, correlationId: 'corr-read' });

let referenceAnswer: unknown;
let companyItems: unknown[];
let branchItems: unknown[];

describe.each(READERS)('$locale: the settings screens (ADM-5)', ({ locale, M, paint }) => {
  beforeEach(() => {
    SESSION_PERMISSIONS = [];
    referenceAnswer = okRead({ currencies: CURRENCIES, timezones: [], languages: [] });
    companyItems = [];
    branchItems = [];
    get.mockImplementation(async (path: string) => {
      if (path === REFERENCES_PATH) return referenceAnswer;
      if (path === COMPANY_SETTINGS) return okRead({ items: companyItems });
      if (path === BRANCH_SETTINGS) return okRead({ items: branchItems });
      throw new Error(`unexpected read ${path}`);
    });
  });

  async function open(route: RoutePage) {
    const ui = await route({ params: Promise.resolve({ locale }) });
    return paint(inBranch(ui, { locale }));
  }
  const notice = () => screen.getByTestId('contract-gap');
  const valueBox = () =>
    screen.getByLabelText(new RegExp(`^${escapeRegExp(M('organization.setting.value'))}`));

  describe('the administration hub offers each settings screen on the codes it reads with', () => {
    const hubLinks = () =>
      screen.queryAllByRole('link').map((link) => link.getAttribute('href') ?? '');
    const at = (path: string) => `/${locale}/administration/${path}`;

    it('shows Numbering rules, Taxes, Currencies and System settings to a reader without settings management', async () => {
      SESSION_PERMISSIONS = [READ_TENANT, READ_COMPANY];
      await open(AdministrationHub);
      expect(hubLinks()).toEqual(
        expect.arrayContaining([at('numbering-rules'), at('taxes'), at('currencies')])
      );
      expect(hubLinks()).toContain(at('system-settings'));
    });

    it('shows Numbering rules and Taxes to a reader of branches alone, and not Currencies', async () => {
      SESSION_PERMISSIONS = [READ_BRANCH];
      await open(AdministrationHub);
      expect(hubLinks()).toEqual(expect.arrayContaining([at('numbering-rules'), at('taxes')]));
      expect(hubLinks()).not.toContain(at('currencies'));
    });

    it('shows none of the four to a settings manager who may read none of them', async () => {
      SESSION_PERMISSIONS = [MANAGE_SETTINGS];
      await open(AdministrationHub);
      expect(hubLinks()).not.toContain(at('numbering-rules'));
      expect(hubLinks()).not.toContain(at('taxes'));
      expect(hubLinks()).not.toContain(at('currencies'));
      expect(hubLinks()).not.toContain(at('system-settings'));
    });
  });

  describe('currencies', () => {
    it('lists exactly the currencies the read published, named in the page language', async () => {
      SESSION_PERMISSIONS = [READ_TENANT, READ_COMPANY];
      await open(CurrenciesPage);

      const table = screen.getByRole('table', { name: M('currencies.catalogue.title') });
      const rows = within(table).getAllByTestId('currency-row');
      expect(rows.map((row) => within(row).getAllByRole('cell')[0]?.textContent)).toEqual([
        'EUR',
        'JOD',
        'USD',
      ]);
      const names = new Intl.DisplayNames([locale], { type: 'currency' });
      rows.forEach((row, index) => {
        const [, name, places] = within(row).getAllByRole('cell');
        const currency = CURRENCIES[index] as (typeof CURRENCIES)[number];
        expect(name).toHaveTextContent(names.of(currency.code) as string);
        expect(places).toHaveTextContent(String(currency.minorUnit));
      });
      if (locale === 'ar') {
        // The reader's language, not the register's English name.
        expect(rows[0]).not.toHaveTextContent('Euro');
        expect(within(rows[0] as HTMLElement).getAllByRole('cell')[1]?.textContent).toMatch(
          /[؀-ۿ]/
        );
      }
      expect(get).toHaveBeenCalledWith(REFERENCES_PATH);
    });

    it('says what is not held or chosen here', async () => {
      SESSION_PERMISSIONS = [READ_TENANT, READ_COMPANY];
      await open(CurrenciesPage);
      expect(notice()).toHaveTextContent(M('admin.contractGap.settingsBacked'));
      expect(notice()).toHaveTextContent(M('currencies.noRates'));
      expect(notice()).toHaveTextContent(M('currencies.noBase'));
    });

    it('makes no catalogue read without the code it declares, and keeps the company settings', async () => {
      SESSION_PERMISSIONS = [READ_COMPANY];
      await open(CurrenciesPage);
      expect(screen.queryByRole('table', { name: M('currencies.catalogue.title') })).toBeNull();
      expect(get).not.toHaveBeenCalledWith(REFERENCES_PATH);
      expect(screen.getByText(M('organization.settings.company'))).toBeVisible();
      await waitFor(() => expect(get).toHaveBeenCalledWith(COMPANY_SETTINGS));
    });

    it('shows the catalogue alone to a reader of the workspace who may not read company settings', async () => {
      SESSION_PERMISSIONS = [READ_TENANT];
      await open(CurrenciesPage);
      expect(screen.getByRole('table', { name: M('currencies.catalogue.title') })).toBeVisible();
      expect(screen.queryByText(M('organization.settings.company'))).toBeNull();
    });

    it('refuses the page when nothing on it may be read, and reads nothing', async () => {
      SESSION_PERMISSIONS = [];
      await open(CurrenciesPage);
      expect(screen.getByTestId('settings-screen-refused')).toHaveTextContent(
        M('state.denied.title')
      );
      expect(get).not.toHaveBeenCalled();
    });

    it('draws a catalogue read that did not answer as the shared state, with Try again', async () => {
      SESSION_PERMISSIONS = [READ_TENANT, READ_COMPANY];
      referenceAnswer = {
        ok: false,
        kind: 'unavailable',
        status: 503,
        correlationId: 'corr-ref-down',
      };
      await open(CurrenciesPage);
      const failure = screen.getByTestId('currency-catalogue-failure');
      expect(failure).toHaveTextContent(M('state.unavailable.title'));
      expect(failure).toHaveTextContent('corr-ref-down');
      expect(within(failure).getByRole('button', { name: M('state.retry') })).toBeVisible();
    });

    it('says so when the platform lists no currency', async () => {
      SESSION_PERMISSIONS = [READ_TENANT, READ_COMPANY];
      referenceAnswer = okRead({ currencies: [], timezones: [], languages: [] });
      await open(CurrenciesPage);
      expect(screen.getByTestId('currency-catalogue-empty')).toHaveTextContent(
        M('currencies.catalogue.empty.title')
      );
    });

    it('writes the enabled codes through the company settings write', async () => {
      SESSION_PERMISSIONS = [READ_TENANT, READ_COMPANY, MANAGE_SETTINGS];
      send.mockResolvedValue({ ok: true, status: 201, data: {}, correlationId: 'corr-write' });
      const user = userEvent.setup();
      await open(CurrenciesPage);
      await user.click(valueBox());
      await user.paste('["EUR","JOD"]');
      await user.click(screen.getByRole('button', { name: M('admin.save') }));
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith('POST', COMPANY_SETTINGS, {
        settingKey: 'currency.enabled_codes',
        settingValue: ['EUR', 'JOD'],
        valueType: 'json',
        isSensitive: false,
      });
    });

    it.each([
      ['a code the platform does not hold', '["GBP"]', 'currencies.error.notHeld'],
      ['a repeated code', '["EUR","EUR"]', 'currencies.error.duplicate'],
      ['a code that is not three capitals', '["eur"]', 'currencies.error.code'],
      ['a value that is not a list', '"EUR"', 'currencies.error.list'],
    ])('refuses %s beside the value and sends nothing', async (_case, typed, errorKey) => {
      SESSION_PERMISSIONS = [READ_TENANT, READ_COMPANY, MANAGE_SETTINGS];
      const user = userEvent.setup();
      await open(CurrenciesPage);
      await user.click(valueBox());
      await user.paste(typed);
      await user.click(screen.getByRole('button', { name: M('admin.save') }));
      expect(await screen.findByText(M(errorKey))).toBeVisible();
      expect(valueBox()).toHaveAttribute('aria-invalid', 'true');
      expect(valueBox()).toHaveValue(typed);
      expect(send).not.toHaveBeenCalled();
    });

    it('says a conflict when someone else wrote first, and keeps the typed value', async () => {
      SESSION_PERMISSIONS = [READ_TENANT, READ_COMPANY, MANAGE_SETTINGS];
      send.mockResolvedValue(conflictFailure);
      const user = userEvent.setup();
      await open(CurrenciesPage);
      await user.click(valueBox());
      await user.paste('["USD"]');
      await user.click(screen.getByRole('button', { name: M('admin.save') }));
      expect(await screen.findByRole('alert')).toHaveTextContent(M('state.conflict.title'));
      expect(valueBox()).toHaveValue('["USD"]');
      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  describe.each([
    {
      name: 'numbering rules',
      route: () => NumberingRulesPage,
      gapKey: 'numbering.gap.formats',
      decision: 'DOC01',
      stored: 'numbering.invoice.prefix',
    },
    {
      name: 'taxes',
      route: () => TaxesPage,
      gapKey: 'taxes.gap.catalogue',
      decision: 'ACC01',
      stored: 'tax.code',
    },
  ])('$name', ({ route, gapKey, decision, stored }) => {
    it('names what is not available and that it waits on a decision, without the internal id', async () => {
      SESSION_PERMISSIONS = [READ_COMPANY, READ_BRANCH, MANAGE_SETTINGS];
      await open(route());
      expect(notice()).toHaveTextContent(M(gapKey));
      // The decision's id is a record for the team, kept in code comments and
      // the capability records; the operator reads that a decision is pending.
      expect(M(gapKey)).not.toContain(decision);
      expect(notice()).not.toHaveTextContent(decision);
      expect(notice()).toHaveTextContent(M('admin.contractGap.settingsShownOnly'));
      expect(notice()).not.toHaveTextContent(M('admin.contractGap.settingsBacked'));
    });

    it('shows the stored settings of the company and the branch under its keys only, and offers no form', async () => {
      SESSION_PERMISSIONS = [READ_COMPANY, READ_BRANCH, MANAGE_SETTINGS];
      companyItems = [setting(stored, 'RC'), setting('org.working_hours.start', '08:00')];
      branchItems = [setting(stored, 'BR', 2)];
      await open(route());

      const tables = await screen.findAllByRole('table', { name: M('organization.settings') });
      expect(tables).toHaveLength(2);
      const [companyTable, branchTable] = tables as [HTMLElement, HTMLElement];
      expect(within(companyTable).getByText(stored)).toBeVisible();
      expect(within(companyTable).getByText('RC')).toBeVisible();
      expect(within(companyTable).queryByText('org.working_hours.start')).toBeNull();
      expect(within(branchTable).getByText('BR')).toBeVisible();
      expect(get).toHaveBeenCalledWith(COMPANY_SETTINGS);
      expect(get).toHaveBeenCalledWith(BRANCH_SETTINGS);

      // Even a holder of org.settings.manage is offered nothing to change here.
      expect(screen.queryByRole('button', { name: M('admin.save') })).toBeNull();
      expect(screen.getAllByTestId('settings-read-only')).toHaveLength(2);
      for (const line of screen.getAllByTestId('settings-read-only')) {
        expect(line).toHaveTextContent(M('admin.contractGap.notChangedHere'));
      }
    });

    it('shows only the branch settings to a reader of branches alone', async () => {
      SESSION_PERMISSIONS = [READ_BRANCH];
      await open(route());
      expect(screen.getByText(M('organization.settings.branch'))).toBeVisible();
      expect(screen.queryByText(M('organization.settings.company'))).toBeNull();
      await waitFor(() => expect(get).toHaveBeenCalledWith(BRANCH_SETTINGS));
      expect(get).not.toHaveBeenCalledWith(COMPANY_SETTINGS);
    });

    it('refuses the page without a company or branch read, and reads nothing', async () => {
      SESSION_PERMISSIONS = [READ_TENANT, MANAGE_SETTINGS];
      await open(route());
      expect(screen.getByTestId('settings-screen-refused')).toHaveTextContent(
        M('state.denied.title')
      );
      expect(get).not.toHaveBeenCalled();
    });
  });

  describe('system settings', () => {
    it('says platform settings are unreachable and keeps the company and branch editors', async () => {
      SESSION_PERMISSIONS = [READ_COMPANY, READ_BRANCH, MANAGE_SETTINGS];
      await open(SystemSettingsPage);
      expect(notice()).toHaveTextContent(M('systemSettings.noPlatformScope'));
      expect(screen.getByText(M('organization.settings.company'))).toBeVisible();
      expect(screen.getByText(M('organization.settings.branch'))).toBeVisible();
      expect(screen.getAllByRole('button', { name: M('admin.save') })).toHaveLength(2);
    });

    it.each([
      ['a code the platform does not hold', '["GBP"]', 'currencies.error.notHeld'],
      ['a repeated code', '["EUR","EUR"]', 'currencies.error.duplicate'],
    ])(
      'refuses %s in the enabled codes typed into the general editor, and sends nothing',
      async (_case, typed, errorKey) => {
        SESSION_PERMISSIONS = [READ_TENANT, READ_COMPANY, MANAGE_SETTINGS];
        const user = userEvent.setup();
        await open(SystemSettingsPage);
        await user.type(
          screen.getByLabelText(new RegExp(`^${escapeRegExp(M('organization.setting.key'))}`)),
          ' currency.enabled_codes '
        );
        await user.selectOptions(
          screen.getByLabelText(new RegExp(`^${escapeRegExp(M('organization.setting.type'))}`)),
          'json'
        );
        // The hint is the rule's own sentence, looked up by the same trimmed key.
        expect(valueBox()).toHaveAccessibleDescription(
          expect.stringContaining(M('currencies.field.enabledHint'))
        );
        await user.click(valueBox());
        await user.paste(typed);
        await user.click(screen.getByRole('button', { name: M('admin.save') }));
        expect(await screen.findByText(M(errorKey))).toBeVisible();
        expect(valueBox()).toHaveAttribute('aria-invalid', 'true');
        expect(send).not.toHaveBeenCalled();
        expect(get).toHaveBeenCalledWith(REFERENCES_PATH);
      }
    );

    it('reads no currency list for an operator who may not write', async () => {
      SESSION_PERMISSIONS = [READ_TENANT, READ_COMPANY];
      await open(SystemSettingsPage);
      await waitFor(() => expect(get).toHaveBeenCalledWith(COMPANY_SETTINGS));
      expect(get).not.toHaveBeenCalledWith(REFERENCES_PATH);
    });

    it('refuses the page without a company or branch read, and reads nothing', async () => {
      SESSION_PERMISSIONS = [READ_TENANT];
      await open(SystemSettingsPage);
      expect(screen.getByTestId('settings-screen-refused')).toHaveTextContent(
        M('state.denied.title')
      );
      expect(get).not.toHaveBeenCalled();
    });
  });
});
