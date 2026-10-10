import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationHost } from '@/components/notifications/NotificationHost';
import { __resetNotificationsForTests } from '@/components/notifications/notification-store';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  BranchSwitch,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';
import { discardAndSwitch, forgetRememberedBranch, stayOnBranch } from './support/branch-switch';
import type { BranchView, CompanyView } from '@/features/administration/organization/types';

/**
 * Departments and the employee register on the shared Material wrappers
 * (ADR-022, `P1-32-PRE-OD-ADM2`), in English and in Arabic.
 *
 * The properties under test: each register reads the branch the header names
 * and nothing else, and names both halves of it; a switch to "All my branches"
 * closes the register rather than leaving it writing to the previous branch;
 * every field of a create form is unsaved work; a malformed entry is refused on
 * its own field, takes the cursor and keeps what was typed; a create is sent
 * once even when pressed twice before the button is disabled; renaming, retiring
 * and deactivating carry the row's version as `If-Match`, and a stale one is a
 * conflict with "Load the latest version"; every write control is absent
 * without the manage permission; the read states are distinct; the employee
 * register is the operational grid over the server's cursor; the detail view
 * reads `org.employee-detail`, names everything, offers no edit, and moves focus
 * in and back; and all of it reads in Arabic, right to left.
 */

type Catalogue = Readonly<Record<string, string>>;
const CATALOGUES: Readonly<Record<'en' | 'ar', Catalogue>> = {
  en: en as Catalogue,
  ar: ar as Catalogue,
};

/** A catalogue message by key; a missing key fails the lookup loudly. */
function words(locale: 'en' | 'ar') {
  return (key: string): string => {
    const value = CATALOGUES[locale][key];
    if (value === undefined) throw new Error(`${key} is not in the ${locale} catalogue`);
    return value;
  };
}
const EN = words('en');
const AR = words('ar');

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A field by the start of its label (a required label carries a decorative mark). */
const field = (scope: HTMLElement, label: string) =>
  within(scope).getByLabelText(new RegExp(`^${escape(label)}`));

type User = ReturnType<typeof userEvent.setup>;

/*
 * The switches stand in for the header. A Material dialog hides the rest of the
 * page from assistive technology while it is open (`aria-hidden`), so they are
 * found among hidden elements: a change of branch can still arrive while a form
 * is open — from another tab, or a held change taken — and that is the case
 * these stand in for. Otherwise the shared helpers' own steps.
 */
async function switchExpectingQuestion(
  user: User,
  label: string,
  text: Catalogue = CATALOGUES.en
): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: label, hidden: true }));
  const dialog = await screen.findByRole('alertdialog');
  expect(within(dialog).getByText(text['workingContext.discard.title'] as string)).toBeVisible();
  return dialog;
}

async function switchWithoutQuestion(user: User, label: string): Promise<void> {
  await user.click(screen.getByRole('button', { name: label, hidden: true }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
}

const send = vi.fn();
const get = vi.fn();
vi.mock('@/lib/api/server-client', () => ({ authorizedClient: async () => ({ send, get }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { DepartmentsScreen } =
  await import('@/features/administration/departments/components/DepartmentsScreen');
const { EmployeesScreen } =
  await import('@/features/administration/employees/components/EmployeesScreen');

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
  city: null,
  countryCode: null,
  timezoneName: 'Asia/Amman',
  status: 'active',
};
const SECOND: BranchView = {
  ...BRANCH,
  id: '20000000-0000-4000-8000-000000000009',
  branchCode: 'second_branch',
  name: 'Second Branch',
};
const DEPARTMENT = {
  id: '30000000-0000-4000-8000-000000000003',
  companyId: COMPANY.id,
  branchId: BRANCH.id,
  departmentCode: 'service',
  name: 'Service',
  status: 'active',
  recordVersion: 4,
};
const EMPLOYEE = {
  id: '40000000-0000-4000-8000-000000000004',
  companyId: COMPANY.id,
  branchId: BRANCH.id,
  displayName: 'Handover Clerk',
  userAccountId: null,
  employmentRef: null,
  status: 'active',
  recordVersion: 2,
};
const ACCOUNT = {
  id: '50000000-0000-4000-8000-000000000005',
  displayName: 'Signed In Person',
  email: 'signed.in@example.test',
};
/** An account linked to an employee that the picker's list does not hold. */
const UNLISTED_ACCOUNT_ID = '50000000-0000-4000-8000-000000000006';

const one = { status: 'ok' as const, data: [BRANCH], correlationId: 'corr-b' };
const both = { status: 'ok' as const, data: [BRANCH, SECOND], correlationId: 'corr-b' };
const TARGET = `companyId=${COMPANY.id}&branchId=${BRANCH.id}`;
const SECOND_TARGET = `companyId=${COMPANY.id}&branchId=${SECOND.id}`;

const snapshot = branchSnapshot([
  { ...TEST_BRANCH, id: BRANCH.id, companyId: COMPANY.id, name: BRANCH.name },
  { ...TEST_BRANCH, id: SECOND.id, companyId: COMPANY.id, name: SECOND.name },
]);

const ok = (data: unknown) => ({ ok: true, status: 200, data, correlationId: 'c' });
const departments = (items: readonly unknown[]) => ok({ items });
const employeePage = (items: readonly unknown[], hasMore = false) =>
  ok({ items, nextCursor: hasMore ? 'next-1' : null, hasMore });
const refused = {
  ok: false,
  kind: 'forbidden',
  status: 403,
  problem: { code: 'ERR-AUTH-003' },
  correlationId: 'corr-denied',
};
const outage = {
  ok: false,
  kind: 'unavailable',
  status: 503,
  problem: { code: 'ERR-SYS-001' },
  correlationId: 'corr-down',
};
const stale = {
  ok: false,
  kind: 'conflict',
  status: 409,
  problem: { code: 'ERR-CON-001' },
  correlationId: 'corr-stale',
};

beforeEach(() => {
  vi.clearAllMocks();
  get.mockReset();
  send.mockReset();
  // The working branch is remembered in browser storage; every case starts afresh.
  window.localStorage.clear();
  __resetNotificationsForTests();
});
afterEach(forgetRememberedBranch);

/**
 * The screen under the Material foundation and a working context, with bare
 * switches standing in for the header: one per branch and "All my branches".
 */
function mount(
  ui: ReactElement,
  locale: 'en' | 'ar' = 'en',
  { notifications = false }: { readonly notifications?: boolean } = {}
) {
  const tree = (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {/* The notification host, as the locale layout mounts it, where a case reads a toast. */}
      {notifications ? <NotificationHost messages={getMessages(locale)} /> : null}
      {inBranch(
        <>
          <BranchSwitch to={BRANCH.id} label="first" />
          <BranchSwitch to={SECOND.id} label="second" />
          <BranchSwitch to="all" label="everywhere" />
          {ui}
        </>,
        { locale, snapshot }
      )}
    </UiFoundationProvider>
  );
  return locale === 'en' ? renderLtr(tree) : renderRtl(tree);
}

function departmentsScreen(locale: 'en' | 'ar' = 'en', canManage = true) {
  return (
    <DepartmentsScreen
      messages={locale === 'en' ? en : ar}
      locale={locale}
      branches={both}
      companies={[COMPANY]}
      canManage={canManage}
    />
  );
}

function employeesScreen(
  locale: 'en' | 'ar' = 'en',
  {
    canManage = true,
    loginAccounts = [ACCOUNT],
    canReadUsers = true,
  }: {
    readonly canManage?: boolean;
    readonly loginAccounts?: readonly (typeof ACCOUNT)[];
    readonly canReadUsers?: boolean;
  } = {}
) {
  return (
    <EmployeesScreen
      messages={locale === 'en' ? en : ar}
      locale={locale}
      branches={both}
      companies={[COMPANY]}
      loginAccounts={loginAccounts}
      canManage={canManage}
      canReadUsers={canReadUsers}
    />
  );
}

/** Waits for a department row, named in the list. */
async function department(name: string) {
  expect(await screen.findByText(name, { selector: 'bdi' })).toBeVisible();
}

describe.each(['en', 'ar'] as const)('Departments (%s)', (locale) => {
  const T = words(locale);
  const user = () => userEvent.setup();

  it('reads nothing until a branch is named, then reads that branch', async () => {
    get.mockResolvedValue(departments([DEPARTMENT]));
    const u = user();
    mount(departmentsScreen(locale), locale);
    expect(screen.getByText(T('departments.chooseBranch'))).toBeVisible();
    expect(get).not.toHaveBeenCalled();

    await u.click(screen.getByRole('button', { name: 'first' }));
    await department('Service');
    expect(get).toHaveBeenCalledWith(`/api/v1/org/departments?${TARGET}`);
    expect(screen.getByTestId('departments-branch')).toHaveTextContent(BRANCH.name);
    expect(screen.getByRole('columnheader', { name: T('departments.name') })).toBeVisible();
    expect(screen.getByText(T('organization.structure.status.active'))).toBeVisible();
    if (locale === 'ar') expect(document.documentElement.dir).toBe('rtl');
  });

  it('says so when the branch has no departments', async () => {
    get.mockResolvedValue(departments([]));
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByText(T('departments.emptyTitle'))).toBeVisible();
    expect(screen.getByText(T('departments.emptyBody'))).toBeVisible();
  });

  it('shows a refusal in place of the list, never an empty branch', async () => {
    get.mockResolvedValue(refused);
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByText(T('state.denied.title'))).toBeVisible();
    expect(screen.queryByText(T('departments.emptyTitle'))).toBeNull();
    expect(screen.queryByRole('button', { name: T('state.retry') })).toBeNull();
  });

  it('says an outage with a retry that reads the branch again', async () => {
    get.mockResolvedValueOnce(outage).mockResolvedValue(departments([DEPARTMENT]));
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByText(T('state.unavailable.title'))).toBeVisible();
    await u.click(screen.getByRole('button', { name: T('state.retry') }));
    await department('Service');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('says it is loading while the list is out', async () => {
    get.mockReturnValue(new Promise(() => undefined));
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByTestId('departments-loading')).toBeVisible();
  });

  it('creates a department in the named branch, closes the form and reads the list again', async () => {
    get.mockResolvedValue(departments([]));
    send.mockResolvedValue({ ok: true, status: 201, data: {}, correlationId: 'c2' });
    const u = user();
    mount(departmentsScreen(locale), locale, { notifications: true });
    await u.click(screen.getByRole('button', { name: 'first' }));

    const add = await screen.findByRole('button', { name: T('departments.add') });
    await u.click(add);
    const dialog = screen.getByRole('dialog', { name: T('departments.add') });
    // The cursor is in the first field when the form opens.
    expect(field(dialog, T('departments.name'))).toHaveFocus();
    await u.type(field(dialog, T('departments.name')), 'Parts desk');
    await u.type(field(dialog, T('organization.structure.code')), 'parts_desk');
    await u.click(within(dialog).getByRole('button', { name: T('admin.create') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/org/departments', {
      companyId: COMPANY.id,
      branchId: BRANCH.id,
      departmentCode: 'parts_desk',
      name: 'Parts desk',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The success sentence is said, now in the notification rather than the form.
    expect(await screen.findByText(T('departments.created'))).toBeVisible();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('refuses a malformed code on its own field, moves the cursor there, keeps what was typed and lets go once edited', async () => {
    get.mockResolvedValue(departments([]));
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(await screen.findByRole('button', { name: T('departments.add') }));
    const dialog = screen.getByRole('dialog');
    await u.type(field(dialog, T('departments.name')), 'Parts desk');
    await u.type(field(dialog, T('organization.structure.code')), '9 bad');
    await u.click(within(dialog).getByRole('button', { name: T('admin.create') }));

    const code = field(dialog, T('organization.structure.code'));
    expect(code).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(code).toHaveFocus());
    expect(code).toHaveValue('9 bad');
    expect(field(dialog, T('departments.name'))).toHaveValue('Parts desk');
    expect(field(dialog, T('departments.name'))).not.toHaveAttribute('aria-invalid');
    expect(send).not.toHaveBeenCalled();

    await u.type(code, 'x');
    expect(code).not.toHaveAttribute('aria-invalid');
  });

  it('marks both empty fields as required and sends nothing', async () => {
    get.mockResolvedValue(departments([]));
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(await screen.findByRole('button', { name: T('departments.add') }));
    const dialog = screen.getByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: T('admin.create') }));
    expect(within(dialog).getAllByText(T('field.required'))).toHaveLength(2);
    await waitFor(() => expect(field(dialog, T('departments.name'))).toHaveFocus());
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one create when the button is pressed twice before it is disabled', async () => {
    get.mockResolvedValue(departments([]));
    send.mockReturnValue(new Promise(() => undefined));
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(await screen.findByRole('button', { name: T('departments.add') }));
    const dialog = screen.getByRole('dialog');
    await u.type(field(dialog, T('departments.name')), 'Parts desk');
    await u.type(field(dialog, T('organization.structure.code')), 'parts_desk');
    const create = within(dialog).getByRole('button', { name: T('admin.create') });
    await act(async () => {
      create.click();
      create.click();
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('says a refused create in the form and keeps every field', async () => {
    get.mockResolvedValue(departments([]));
    send.mockResolvedValue(stale);
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(await screen.findByRole('button', { name: T('departments.add') }));
    const dialog = screen.getByRole('dialog');
    await u.type(field(dialog, T('departments.name')), 'Parts desk');
    await u.type(field(dialog, T('organization.structure.code')), 'parts_desk');
    await u.click(within(dialog).getByRole('button', { name: T('admin.create') }));

    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(field(dialog, T('departments.name'))).toHaveValue('Parts desk');
    expect(field(dialog, T('organization.structure.code'))).toHaveValue('parts_desk');
    expect(within(dialog).getByRole('button', { name: T('admin.create') })).toBeEnabled();
  });

  it('returns the cursor to Add when the form is cancelled', async () => {
    get.mockResolvedValue(departments([]));
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    const add = await screen.findByRole('button', { name: T('departments.add') });
    await u.click(add);
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: T('admin.cancel') })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(add).toHaveFocus());
  });

  it('renames with the row version as If-Match, and a stale version offers the latest', async () => {
    get.mockResolvedValue(departments([DEPARTMENT]));
    send.mockResolvedValueOnce(stale);
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(
      await screen.findByRole('button', { name: `${T('departments.rename')}: Service` })
    );
    const dialog = screen.getByRole('dialog');
    const name = field(dialog, T('departments.name'));
    await u.clear(name);
    await u.type(name, 'Service and repair');
    await u.click(within(dialog).getByRole('button', { name: T('admin.save') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/org/departments/${DEPARTMENT.id}`,
      { name: 'Service and repair' },
      { ifMatch: 4 }
    );
    expect(await within(dialog).findByRole('alert')).toBeVisible();

    get.mockResolvedValue(departments([{ ...DEPARTMENT, name: 'Service bay', recordVersion: 5 }]));
    await u.click(within(dialog).getByRole('button', { name: T('form.loadLatest') }));
    await waitFor(() => expect(field(dialog, T('departments.name'))).toHaveValue('Service bay'));
    send.mockResolvedValueOnce({ ok: true, status: 200, data: {}, correlationId: 'c5' });
    await u.type(field(dialog, T('departments.name')), ' east');
    await u.click(within(dialog).getByRole('button', { name: T('admin.save') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send).toHaveBeenLastCalledWith(
      'PATCH',
      `/api/v1/org/departments/${DEPARTMENT.id}`,
      { name: 'Service bay east' },
      { ifMatch: 5 }
    );
  });

  it('retires with the row version as If-Match, sent once for two presses', async () => {
    get.mockResolvedValue(departments([DEPARTMENT]));
    send.mockReturnValue(new Promise(() => undefined));
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(
      await screen.findByRole('button', { name: `${T('departments.retire')}: Service` })
    );
    const question = screen.getByRole('alertdialog');
    const confirm = within(question).getByRole('button', { name: T('departments.retire') });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/org/departments/${DEPARTMENT.id}`,
      { status: 'inactive' },
      { ifMatch: 4 }
    );
  });

  it('says a stale retirement beside the list and reads the latest on request', async () => {
    get.mockResolvedValue(departments([DEPARTMENT]));
    send.mockResolvedValue(stale);
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(
      await screen.findByRole('button', { name: `${T('departments.retire')}: Service` })
    );
    await u.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: T('departments.retire'),
      })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    const load = await screen.findByRole('button', { name: T('form.loadLatest') });
    const calls = get.mock.calls.length;
    await u.click(load);
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: T('form.loadLatest') })).toBeNull()
    );
  });

  it('renames once when Save is pressed twice before it is disabled', async () => {
    get.mockResolvedValue(departments([DEPARTMENT]));
    send.mockReturnValue(new Promise(() => undefined));
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(
      await screen.findByRole('button', { name: `${T('departments.rename')}: Service` })
    );
    const dialog = screen.getByRole('dialog');
    await u.type(field(dialog, T('departments.name')), ' desk');
    const save = within(dialog).getByRole('button', { name: T('admin.save') });
    await act(async () => {
      save.click();
      save.click();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/org/departments/${DEPARTMENT.id}`,
      { name: 'Service desk' },
      { ifMatch: 4 }
    );
  });

  it('reinstates with the row version as If-Match, sent once for two presses', async () => {
    get.mockResolvedValue(departments([{ ...DEPARTMENT, status: 'inactive' }]));
    send.mockReturnValue(new Promise(() => undefined));
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(
      await screen.findByRole('button', { name: `${T('departments.reinstate')}: Service` })
    );
    const question = screen.getByRole('alertdialog');
    const confirm = within(question).getByRole('button', { name: T('departments.reinstate') });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/org/departments/${DEPARTMENT.id}`,
      { status: 'active' },
      { ifMatch: 4 }
    );
  });

  /*
   * `org.department-list` stops at 500 rows and says nothing of more. A list of
   * exactly that length may have been cut short, so the register says only the
   * first ones are shown; a shorter list says nothing of the kind.
   */
  it('says only the first 500 are shown when the list comes back at its 500-row limit', async () => {
    const full = Array.from({ length: 500 }, (_, index) => ({
      ...DEPARTMENT,
      id: `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
      departmentCode: `dept_${index}`,
      name: `Department ${index}`,
    }));
    get.mockResolvedValueOnce(departments(full.slice(0, 499))).mockResolvedValue(departments(full));
    const u = user();
    mount(departmentsScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await department('Department 498');
    expect(screen.queryByTestId('departments-capped')).toBeNull();

    await u.click(screen.getByRole('button', { name: 'second' }));
    await department('Department 499');
    expect(screen.getByTestId('departments-capped')).toHaveTextContent(
      T('departments.listCapped').replace('{count}', '500')
    );
  });

  it('offers no write control without the manage permission', async () => {
    get.mockResolvedValue(departments([DEPARTMENT]));
    const u = user();
    mount(departmentsScreen(locale, false), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await department('Service');
    expect(screen.queryByRole('button', { name: T('departments.add') })).toBeNull();
    expect(
      screen.queryByRole('button', { name: `${T('departments.rename')}: Service` })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: `${T('departments.retire')}: Service` })
    ).toBeNull();
  });
});

describe.each(['en', 'ar'] as const)('Employees (%s)', (locale) => {
  const T = words(locale);
  const user = () => userEvent.setup();

  /** Answers the register, the detail and the account reads by path. */
  function serve({
    list = employeePage([EMPLOYEE]),
    detail = ok(EMPLOYEE) as unknown,
  }: { readonly list?: unknown; readonly detail?: unknown } = {}) {
    get.mockImplementation(async (path: string) => {
      if (path.startsWith('/api/v1/org/employees?')) return list;
      if (path.startsWith('/api/v1/org/employees/')) return detail;
      if (path === `/api/v1/iam/users/${UNLISTED_ACCOUNT_ID}`) {
        return ok({ displayName: 'Former Cashier' });
      }
      throw new Error(`unexpected read ${path}`);
    });
  }

  it('lists the branch register in the grid and pages on the server cursor', async () => {
    const second = {
      ...EMPLOYEE,
      id: '40000000-0000-4000-8000-000000000009',
      displayName: 'Second Clerk',
    };
    get
      .mockResolvedValueOnce(employeePage([EMPLOYEE], true))
      .mockResolvedValueOnce(employeePage([second]));
    const u = user();
    mount(employeesScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));

    expect(await screen.findByText('Handover Clerk', { selector: 'bdi' })).toBeVisible();
    expect(get).toHaveBeenCalledWith(`/api/v1/org/employees?${TARGET}&limit=50`);
    expect(screen.getByText(T('employees.noLogin'))).toBeVisible();
    expect(
      screen.getByRole('grid', { name: `${T('employees.title')} — ${BRANCH.name}` })
    ).toBeVisible();
    await u.click(screen.getByRole('button', { name: T('table.nextPage') }));
    expect(await screen.findByText('Second Clerk', { selector: 'bdi' })).toBeVisible();
    expect(get).toHaveBeenLastCalledWith(`/api/v1/org/employees?${TARGET}&limit=50&cursor=next-1`);
  });

  it('says so when the branch has no employees', async () => {
    serve({ list: employeePage([]) });
    const u = user();
    mount(employeesScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByText(T('employees.emptyTitle'))).toBeVisible();
  });

  it('shows a refusal in place of the register, never an empty branch', async () => {
    serve({ list: refused });
    const u = user();
    mount(employeesScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByText(T('state.denied.title'))).toBeVisible();
    expect(screen.queryByText(T('employees.emptyTitle'))).toBeNull();
  });

  it('names a linked account by name, including one the picker does not hold', async () => {
    serve({
      list: employeePage([
        { ...EMPLOYEE, userAccountId: ACCOUNT.id },
        {
          ...EMPLOYEE,
          id: '40000000-0000-4000-8000-000000000010',
          displayName: 'Night Clerk',
          userAccountId: UNLISTED_ACCOUNT_ID,
        },
      ]),
    });
    const u = user();
    mount(employeesScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByText(ACCOUNT.displayName, { selector: 'bdi' })).toBeVisible();
    expect(await screen.findByText('Former Cashier', { selector: 'bdi' })).toBeVisible();
    expect(screen.queryByText(UNLISTED_ACCOUNT_ID)).toBeNull();
  });

  it('adds an employee linked to a login account, closes the form and reads the register again', async () => {
    serve({ list: employeePage([]) });
    send.mockResolvedValue({ ok: true, status: 201, data: {}, correlationId: 'c2' });
    const u = user();
    mount(employeesScreen(locale), locale, { notifications: true });
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(await screen.findByRole('button', { name: T('employees.add') }));
    const dialog = screen.getByRole('dialog', { name: T('employees.add') });
    expect(field(dialog, T('employees.displayName'))).toHaveFocus();
    await u.type(field(dialog, T('employees.displayName')), 'New Clerk');
    await u.selectOptions(field(dialog, T('employees.loginAccount')), ACCOUNT.id);
    await u.type(field(dialog, T('employees.employmentRef')), 'HR-77');
    await u.click(within(dialog).getByRole('button', { name: T('admin.create') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/org/employees', {
      companyId: COMPANY.id,
      branchId: BRANCH.id,
      displayName: 'New Clerk',
      userAccountId: ACCOUNT.id,
      employmentRef: 'HR-77',
    });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The success sentence is said, now in the notification rather than the form.
    expect(await screen.findByText(T('employees.created'))).toBeVisible();
    await waitFor(() =>
      expect(
        get.mock.calls.filter(([path]) => String(path).startsWith('/api/v1/org/employees?'))
      ).toHaveLength(2)
    );
  });

  it('refuses an empty name on its own field, keeps the reference typed, and sends nothing', async () => {
    serve({ list: employeePage([]) });
    const u = user();
    mount(employeesScreen(locale, { loginAccounts: [] }), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(await screen.findByRole('button', { name: T('employees.add') }));
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).queryByLabelText(new RegExp(`^${escape(T('employees.loginAccount'))}`))
    ).toBeNull();
    const reference = field(dialog, T('employees.employmentRef'));
    // The reference box holds no more than the column does.
    expect(reference).toHaveAttribute('maxlength', '64');
    await u.type(reference, 'HR-12');
    await u.click(within(dialog).getByRole('button', { name: T('admin.create') }));

    const name = field(dialog, T('employees.displayName'));
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(reference).not.toHaveAttribute('aria-invalid');
    expect(within(dialog).getByText(T('field.required'))).toBeVisible();
    await waitFor(() => expect(name).toHaveFocus());
    expect(reference).toHaveValue('HR-12');
    expect(send).not.toHaveBeenCalled();

    await u.type(name, 'N');
    expect(name).not.toHaveAttribute('aria-invalid');
  });

  it('sends one create when the button is pressed twice before it is disabled', async () => {
    serve({ list: employeePage([]) });
    send.mockReturnValue(new Promise(() => undefined));
    const u = user();
    mount(employeesScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(await screen.findByRole('button', { name: T('employees.add') }));
    const dialog = screen.getByRole('dialog');
    await u.type(field(dialog, T('employees.displayName')), 'New Clerk');
    const create = within(dialog).getByRole('button', { name: T('admin.create') });
    await act(async () => {
      create.click();
      create.click();
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('returns the cursor to Add employee when the form is cancelled', async () => {
    serve({ list: employeePage([]) });
    const u = user();
    mount(employeesScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    const add = await screen.findByRole('button', { name: T('employees.add') });
    await u.click(add);
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: T('admin.cancel') })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(add).toHaveFocus());
  });

  it('reactivates with the row version as If-Match, sent once for two presses', async () => {
    serve({ list: employeePage([{ ...EMPLOYEE, status: 'inactive' }]) });
    send.mockReturnValue(new Promise(() => undefined));
    const u = user();
    mount(employeesScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(
      await screen.findByRole('button', { name: `${T('employees.reactivate')} Handover Clerk` })
    );
    const question = screen.getByRole('alertdialog');
    const confirm = within(question).getByRole('button', { name: T('employees.reactivate') });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/org/employees/${EMPLOYEE.id}/status`,
      { status: 'active' },
      { ifMatch: 2 }
    );
  });

  it('deactivates with the row version as If-Match, sent once for two presses', async () => {
    serve();
    send.mockReturnValue(new Promise(() => undefined));
    const u = user();
    mount(employeesScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(
      await screen.findByRole('button', { name: `${T('employees.deactivate')} Handover Clerk` })
    );
    const question = screen.getByRole('alertdialog');
    expect(within(question).getByText(/Handover Clerk/)).toBeVisible();
    const confirm = within(question).getByRole('button', { name: T('employees.deactivate') });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/org/employees/${EMPLOYEE.id}/status`,
      { status: 'inactive' },
      { ifMatch: 2 }
    );
  });

  it('says a stale status change beside the register with the way to the latest', async () => {
    serve();
    send.mockResolvedValue(stale);
    const u = user();
    mount(employeesScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(
      await screen.findByRole('button', { name: `${T('employees.deactivate')} Handover Clerk` })
    );
    await u.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: T('employees.deactivate'),
      })
    );
    expect(await screen.findByRole('button', { name: T('form.loadLatest') })).toBeVisible();
  });

  it('offers the details and no write control without the manage permission', async () => {
    serve();
    const u = user();
    mount(employeesScreen(locale, { canManage: false, loginAccounts: [] }), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByText('Handover Clerk', { selector: 'bdi' })).toBeVisible();
    expect(
      screen.getByRole('button', { name: `${T('employees.details')} Handover Clerk` })
    ).toBeEnabled();
    expect(screen.queryByRole('button', { name: T('employees.add') })).toBeNull();
    expect(
      screen.queryByRole('button', { name: `${T('employees.deactivate')} Handover Clerk` })
    ).toBeNull();
  });

  it('opens the details from the employee read, names everything, offers no edit, and returns the cursor', async () => {
    serve({
      detail: ok({ ...EMPLOYEE, userAccountId: ACCOUNT.id, employmentRef: 'HR-12' }),
    });
    const u = user();
    mount(employeesScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    const open = await screen.findByRole('button', {
      name: `${T('employees.details')} Handover Clerk`,
    });
    await u.click(open);

    const drawer = await screen.findByRole('dialog', { name: 'Handover Clerk' });
    expect(get).toHaveBeenCalledWith(`/api/v1/org/employees/${EMPLOYEE.id}`);
    await waitFor(() => expect(within(drawer).getByText('HR-12')).toBeVisible());
    expect(within(drawer).getByText(BRANCH.name)).toBeVisible();
    expect(within(drawer).getByText(COMPANY.legalName)).toBeVisible();
    expect(within(drawer).getByText(ACCOUNT.displayName)).toBeVisible();
    expect(within(drawer).queryByText(ACCOUNT.id)).toBeNull();
    expect(within(drawer).getByText(T('employees.detail.noEdit'))).toBeVisible();
    // No edit control: the platform publishes no operation that would change these.
    expect(within(drawer).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(drawer).getAllByRole('button')).toHaveLength(1);
    // The cursor goes into the drawer, and back to what opened it on Escape.
    await waitFor(() =>
      expect(within(drawer).getByRole('button', { name: T('admin.close') })).toHaveFocus()
    );
    await u.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(open).toHaveFocus());
  });

  it('says a detail read that failed, with a retry', async () => {
    serve({ detail: outage });
    const u = user();
    mount(employeesScreen(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(
      await screen.findByRole('button', { name: `${T('employees.details')} Handover Clerk` })
    );
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText(T('state.unavailable.title'))).toBeVisible();
    serve({ detail: ok(EMPLOYEE) });
    await u.click(within(drawer).getByRole('button', { name: T('state.retry') }));
    expect(await within(drawer).findByText(T('employees.detail.noReference'))).toBeVisible();
  });
});

describe.each(['en', 'ar'] as const)(
  'a branch switch and the unsaved forms (%s, route sweep B3, ADM2)',
  (locale) => {
    const T = words(locale);
    const text = CATALOGUES[locale];

    it('departments: a typed name alone makes the switch ask, and "stay" keeps it', async () => {
      get.mockResolvedValue(departments([]));
      const u = userEvent.setup();
      mount(departmentsScreen(locale), locale);
      await u.click(screen.getByRole('button', { name: 'first' }));
      await u.click(await screen.findByRole('button', { name: T('departments.add') }));
      await u.type(field(screen.getByRole('dialog'), T('departments.name')), 'Parts desk');

      const question = await switchExpectingQuestion(u, 'second', text);
      await stayOnBranch(u, question, text);
      expect(field(screen.getByRole('dialog'), T('departments.name'))).toHaveValue('Parts desk');
      expect(get).toHaveBeenLastCalledWith(`/api/v1/org/departments?${TARGET}`);

      await discardAndSwitch(u, await switchExpectingQuestion(u, 'second', text), text);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith(`/api/v1/org/departments?${SECOND_TARGET}`)
      );
    });

    it('departments: a typed code alone makes the switch ask', async () => {
      get.mockResolvedValue(departments([]));
      const u = userEvent.setup();
      mount(departmentsScreen(locale), locale);
      await u.click(screen.getByRole('button', { name: 'first' }));
      await u.click(await screen.findByRole('button', { name: T('departments.add') }));
      await u.type(
        field(screen.getByRole('dialog'), T('organization.structure.code')),
        'parts_desk'
      );
      await stayOnBranch(u, await switchExpectingQuestion(u, 'second', text), text);
      expect(field(screen.getByRole('dialog'), T('organization.structure.code'))).toHaveValue(
        'parts_desk'
      );
    });

    it('departments: a confirmed discard towards "all my branches" closes the form, empties it and closes the register', async () => {
      get.mockResolvedValue(departments([]));
      const u = userEvent.setup();
      mount(departmentsScreen(locale), locale);
      await u.click(screen.getByRole('button', { name: 'first' }));
      await u.click(await screen.findByRole('button', { name: T('departments.add') }));
      await u.type(field(screen.getByRole('dialog'), T('departments.name')), 'Parts desk');

      await discardAndSwitch(u, await switchExpectingQuestion(u, 'everywhere', text), text);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      // Nothing is left addressed to the previous branch: no list, no Add.
      expect(screen.getByText(T('departments.chooseBranch'))).toBeVisible();
      expect(screen.queryByRole('button', { name: T('departments.add') })).toBeNull();

      // Back in the branch, the form opens empty: nothing typed survived the discard.
      await u.click(screen.getByRole('button', { name: 'first' }));
      await u.click(await screen.findByRole('button', { name: T('departments.add') }));
      expect(field(screen.getByRole('dialog'), T('departments.name'))).toHaveValue('');
    });

    it('departments: an untouched form is closed by "all my branches" without a question', async () => {
      get.mockResolvedValue(departments([]));
      const u = userEvent.setup();
      mount(departmentsScreen(locale), locale);
      await u.click(screen.getByRole('button', { name: 'first' }));
      await u.click(await screen.findByRole('button', { name: T('departments.add') }));
      expect(screen.getByRole('dialog')).toBeVisible();

      await switchWithoutQuestion(u, 'everywhere');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.queryByRole('button', { name: T('departments.add') })).toBeNull();
    });

    // Restored from develop, where the first ADM2 head had dropped it: a switch to another branch.
    it('departments: an untouched dialog is closed by the switch without a question', async () => {
      get.mockResolvedValue(departments([]));
      const u = userEvent.setup();
      mount(departmentsScreen(locale), locale);
      await u.click(screen.getByRole('button', { name: 'first' }));
      await u.click(await screen.findByRole('button', { name: T('departments.add') }));
      expect(screen.getByRole('dialog')).toBeVisible();

      await switchWithoutQuestion(u, 'second');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('departments: an edited name in the rename form makes the switch ask, and a confirmed discard closes it', async () => {
      get.mockResolvedValue(departments([DEPARTMENT]));
      const u = userEvent.setup();
      mount(departmentsScreen(locale), locale);
      await u.click(screen.getByRole('button', { name: 'first' }));
      await u.click(
        await screen.findByRole('button', { name: `${T('departments.rename')}: Service` })
      );
      await u.type(field(screen.getByRole('dialog'), T('departments.name')), ' desk');

      await stayOnBranch(u, await switchExpectingQuestion(u, 'everywhere', text), text);
      expect(field(screen.getByRole('dialog'), T('departments.name'))).toHaveValue('Service desk');
      await discardAndSwitch(u, await switchExpectingQuestion(u, 'everywhere', text), text);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    // Restored from develop, where the first ADM2 head had dropped it: a typed name, "stay", a discard.
    it('employees: a typed new employee makes the switch ask, and "stay" keeps it', async () => {
      get.mockResolvedValue(employeePage([]));
      const u = userEvent.setup();
      mount(employeesScreen(locale), locale);
      await u.click(screen.getByRole('button', { name: 'first' }));
      await u.click(await screen.findByRole('button', { name: T('employees.add') }));
      await u.type(field(screen.getByRole('dialog'), T('employees.displayName')), 'New Clerk');

      const question = await switchExpectingQuestion(u, 'second', text);
      await stayOnBranch(u, question, text);
      expect(field(screen.getByRole('dialog'), T('employees.displayName'))).toHaveValue(
        'New Clerk'
      );

      await discardAndSwitch(u, await switchExpectingQuestion(u, 'second', text), text);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('employees: a chosen login account alone makes the switch ask', async () => {
      get.mockResolvedValue(employeePage([]));
      const u = userEvent.setup();
      mount(employeesScreen(locale), locale);
      await u.click(screen.getByRole('button', { name: 'first' }));
      await u.click(await screen.findByRole('button', { name: T('employees.add') }));
      await u.selectOptions(
        field(screen.getByRole('dialog'), T('employees.loginAccount')),
        ACCOUNT.id
      );
      await stayOnBranch(u, await switchExpectingQuestion(u, 'second', text), text);
      expect(field(screen.getByRole('dialog'), T('employees.loginAccount'))).toHaveValue(
        ACCOUNT.id
      );
    });

    it('employees: a typed reference alone makes the switch ask, and a discard towards "all my branches" closes the register', async () => {
      get.mockResolvedValue(employeePage([]));
      const u = userEvent.setup();
      mount(employeesScreen(locale), locale);
      await u.click(screen.getByRole('button', { name: 'first' }));
      await u.click(await screen.findByRole('button', { name: T('employees.add') }));
      await u.type(field(screen.getByRole('dialog'), T('employees.employmentRef')), 'HR-1');

      await discardAndSwitch(u, await switchExpectingQuestion(u, 'everywhere', text), text);
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(screen.getByText(T('employees.chooseBranch'))).toBeVisible();
      expect(screen.queryByRole('button', { name: T('employees.add') })).toBeNull();
    });

    it('employees: an untouched form is closed by a switch without a question, and the register follows', async () => {
      get.mockResolvedValue(employeePage([]));
      const u = userEvent.setup();
      mount(employeesScreen(locale), locale);
      await u.click(screen.getByRole('button', { name: 'first' }));
      await u.click(await screen.findByRole('button', { name: T('employees.add') }));
      await switchWithoutQuestion(u, 'second');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() =>
        expect(get).toHaveBeenLastCalledWith(`/api/v1/org/employees?${SECOND_TARGET}&limit=50`)
      );
      expect(screen.getByTestId('employees-branch')).toHaveTextContent(SECOND.name);
    });
  }
);

describe('the registers open on the working branch (route sweep B3)', () => {
  it('employees: reads the working branch on arrival, with no branch to choose first', async () => {
    get.mockResolvedValue(employeePage([EMPLOYEE]));
    renderLtr(
      <UiFoundationProvider locale="en" text={muiTextOf(getMessages('en'))}>
        {inBranch(
          <EmployeesScreen
            messages={en}
            branches={one}
            companies={[COMPANY]}
            loginAccounts={[ACCOUNT]}
            canManage
          />,
          {
            snapshot: branchSnapshot([
              { ...TEST_BRANCH, id: BRANCH.id, companyId: COMPANY.id, name: BRANCH.name },
            ]),
          }
        )}
      </UiFoundationProvider>
    );
    expect(await screen.findByText('Handover Clerk', { selector: 'bdi' })).toBeVisible();
    expect(screen.queryByText(EN('employees.chooseBranch'))).toBeNull();
    expect(screen.getByTestId('employees-branch')).toHaveTextContent(BRANCH.name);
    // Stated, not asked: no branch picker of the register's own (PR #467 review).
    expect(within(screen.getByTestId('employees-branch')).queryAllByRole('combobox')).toHaveLength(
      0
    );
    expect(get.mock.calls[0]?.[0]).toContain(TARGET);
  });

  it('departments: states the working branch, offers no chooser of its own, and follows a switch', async () => {
    get.mockResolvedValue(departments([DEPARTMENT]));
    const u = userEvent.setup();
    mount(departmentsScreen('ar'), 'ar');
    await u.click(screen.getByRole('button', { name: 'first' }));
    await department('Service');
    expect(screen.getByRole('columnheader', { name: AR('departments.name') })).toBeVisible();
    expect(screen.getByTestId('departments-branch')).toHaveTextContent(BRANCH.name);
    expect(
      within(screen.getByTestId('departments-branch')).queryAllByRole('combobox')
    ).toHaveLength(0);

    await u.click(screen.getByRole('button', { name: 'second' }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(`/api/v1/org/departments?${SECOND_TARGET}`)
    );
    expect(screen.getByTestId('departments-branch')).toHaveTextContent(SECOND.name);
  });
});
