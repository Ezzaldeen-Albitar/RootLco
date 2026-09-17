import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { BranchView, CompanyView } from '@/features/administration/organization/types';

/**
 * Departments and the employee register (P1-32 preparation).
 *
 * The properties under test: nothing is read until a branch is chosen, and the
 * read names both halves of that branch; creating reaches the operation with the
 * route's own field names and a malformed entry is refused beside its field;
 * renaming, retiring and deactivating carry the row's version as `If-Match`;
 * every write control is absent without the manage permission; an empty branch
 * says so; and the screens read in Arabic, right to left.
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

const branches = { status: 'ok' as const, data: [BRANCH], correlationId: 'corr-b' };
const TARGET = `companyId=${COMPANY.id}&branchId=${BRANCH.id}`;

beforeEach(() => {
  vi.clearAllMocks();
});

async function chooseBranch(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/^Branch/), BRANCH.id);
}

describe('Departments', () => {
  function renderDepartments(canManage = true) {
    return renderLtr(
      <DepartmentsScreen
        messages={en}
        branches={branches}
        companies={[COMPANY]}
        canManage={canManage}
      />
    );
  }

  it('reads nothing until a branch is chosen, then reads that branch', async () => {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [DEPARTMENT] },
      correlationId: 'c',
    });
    const user = userEvent.setup();
    renderDepartments();

    expect(screen.getByText(EN('departments.chooseBranch'))).toBeVisible();
    expect(get).not.toHaveBeenCalled();
    await chooseBranch(user);

    expect(await screen.findByText('Service')).toBeVisible();
    expect(get).toHaveBeenCalledWith(`/api/v1/org/departments?${TARGET}`);
  });

  it('says so when the branch has no departments', async () => {
    get.mockResolvedValue({ ok: true, status: 200, data: { items: [] }, correlationId: 'c' });
    const user = userEvent.setup();
    renderDepartments();
    await chooseBranch(user);
    expect(await screen.findByText(EN('departments.emptyTitle'))).toBeVisible();
  });

  it('shows a denial in place of the list when the read is refused', async () => {
    get.mockResolvedValue({
      ok: false,
      kind: 'forbidden',
      status: 403,
      problem: { code: 'ERR-AUTH-003' },
      correlationId: 'corr-denied',
    });
    const user = userEvent.setup();
    renderDepartments();
    await chooseBranch(user);
    expect(await screen.findByText(EN('state.denied.title'))).toBeVisible();
  });

  it('creates a department in the chosen branch', async () => {
    get.mockResolvedValue({ ok: true, status: 200, data: { items: [] }, correlationId: 'c' });
    send.mockResolvedValue({ ok: true, status: 201, data: {}, correlationId: 'c2' });
    const user = userEvent.setup();
    renderDepartments();
    await chooseBranch(user);

    await user.click(await screen.findByRole('button', { name: EN('departments.add') }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Code/), 'parts_desk');
    await user.type(within(dialog).getByLabelText(/^Department name/), 'Parts desk');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/org/departments', {
      companyId: COMPANY.id,
      branchId: BRANCH.id,
      departmentCode: 'parts_desk',
      name: 'Parts desk',
    });
    expect(await within(dialog).findByText(EN('departments.created'))).toBeVisible();
  });

  it('refuses a malformed code beside the field and sends nothing', async () => {
    get.mockResolvedValue({ ok: true, status: 200, data: { items: [] }, correlationId: 'c' });
    const user = userEvent.setup();
    renderDepartments();
    await chooseBranch(user);

    await user.click(await screen.findByRole('button', { name: EN('departments.add') }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Code/), '9 bad');
    await user.type(within(dialog).getByLabelText(/^Department name/), 'Parts desk');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    expect(
      (await within(dialog).findAllByText(EN('organization.structure.codeHint'))).length
    ).toBeGreaterThan(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('renames with the row version as If-Match', async () => {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [DEPARTMENT] },
      correlationId: 'c',
    });
    send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'c3' });
    const user = userEvent.setup();
    renderDepartments();
    await chooseBranch(user);

    await user.click(
      await screen.findByRole('button', { name: `${EN('departments.rename')}: Service` })
    );
    const dialog = screen.getByRole('dialog');
    const field = within(dialog).getByLabelText(/^Department name/);
    await user.clear(field);
    await user.type(field, 'Service and repair');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.save') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/org/departments/${DEPARTMENT.id}`,
      { name: 'Service and repair' },
      { ifMatch: 4 }
    );
  });

  it('retires with the row version as If-Match', async () => {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [DEPARTMENT] },
      correlationId: 'c',
    });
    send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'c4' });
    const user = userEvent.setup();
    renderDepartments();
    await chooseBranch(user);

    await user.click(
      await screen.findByRole('button', { name: `${EN('departments.retire')}: Service` })
    );
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: EN('departments.retire') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/org/departments/${DEPARTMENT.id}`,
      { status: 'inactive' },
      { ifMatch: 4 }
    );
  });

  it('offers no write control without the manage permission', async () => {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [DEPARTMENT] },
      correlationId: 'c',
    });
    const user = userEvent.setup();
    renderDepartments(false);
    await chooseBranch(user);

    expect(await screen.findByText('Service')).toBeVisible();
    expect(screen.queryByRole('button', { name: EN('departments.add') })).toBeNull();
    expect(screen.queryByRole('button', { name: /Rename|Retire/ })).toBeNull();
  });

  it('reads in Arabic, right to left', () => {
    renderRtl(
      <DepartmentsScreen messages={ar} branches={branches} companies={[COMPANY]} canManage />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR('departments.chooseBranch'))).toBeVisible();
  });
});

describe('Employees', () => {
  function renderEmployees(canManage = true, loginAccounts = [ACCOUNT]) {
    return renderLtr(
      <EmployeesScreen
        messages={en}
        branches={branches}
        companies={[COMPANY]}
        loginAccounts={loginAccounts}
        canManage={canManage}
      />
    );
  }

  const page = (items: readonly unknown[], hasMore = false) => ({
    ok: true,
    status: 200,
    data: { items, nextCursor: hasMore ? 'next-1' : null, hasMore },
    correlationId: 'c',
  });

  it('lists the branch register and pages on request', async () => {
    get
      .mockResolvedValueOnce(page([EMPLOYEE], true))
      .mockResolvedValueOnce(
        page([
          { ...EMPLOYEE, id: '40000000-0000-4000-8000-000000000009', displayName: 'Second Clerk' },
        ])
      );
    const user = userEvent.setup();
    renderEmployees();
    await chooseBranch(user);

    expect(await screen.findByText('Handover Clerk')).toBeVisible();
    expect(get).toHaveBeenCalledWith(`/api/v1/org/employees?${TARGET}&limit=50`);
    await user.click(screen.getByRole('button', { name: EN('employees.showMore') }));
    expect(await screen.findByText('Second Clerk')).toBeVisible();
    expect(get).toHaveBeenLastCalledWith(`/api/v1/org/employees?${TARGET}&limit=50&cursor=next-1`);
    expect(screen.getByText('Handover Clerk')).toBeVisible();
  });

  it('adds an employee linked to a login account', async () => {
    get.mockResolvedValue(page([]));
    send.mockResolvedValue({ ok: true, status: 201, data: {}, correlationId: 'c2' });
    const user = userEvent.setup();
    renderEmployees();
    await chooseBranch(user);

    await user.click(await screen.findByRole('button', { name: EN('employees.add') }));
    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText(/^Name/), 'New Clerk');
    await user.selectOptions(within(dialog).getByLabelText(/^Login account/), ACCOUNT.id);
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/org/employees', {
      companyId: COMPANY.id,
      branchId: BRANCH.id,
      displayName: 'New Clerk',
      userAccountId: ACCOUNT.id,
    });
    expect(await within(dialog).findByText(EN('employees.created'))).toBeVisible();
  });

  it('refuses an empty name beside the field and sends nothing', async () => {
    get.mockResolvedValue(page([]));
    const user = userEvent.setup();
    renderEmployees(true, []);
    await chooseBranch(user);

    await user.click(await screen.findByRole('button', { name: EN('employees.add') }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).queryByLabelText(/^Login account/)).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    expect(await within(dialog).findByText(EN('field.required'))).toBeVisible();
    expect(send).not.toHaveBeenCalled();
  });

  it('deactivates with the row version as If-Match', async () => {
    get.mockResolvedValue(page([EMPLOYEE]));
    send.mockResolvedValue({ ok: true, status: 200, data: {}, correlationId: 'c3' });
    const user = userEvent.setup();
    renderEmployees();
    await chooseBranch(user);

    await user.click(
      await screen.findByRole('button', { name: `${EN('employees.deactivate')}: Handover Clerk` })
    );
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: EN('employees.deactivate') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/org/employees/${EMPLOYEE.id}/status`,
      { status: 'inactive' },
      { ifMatch: 2 }
    );
  });

  it('offers no write control without the manage permission', async () => {
    get.mockResolvedValue(page([EMPLOYEE]));
    const user = userEvent.setup();
    renderEmployees(false);
    await chooseBranch(user);

    expect(await screen.findByText('Handover Clerk')).toBeVisible();
    expect(screen.queryByRole('button', { name: EN('employees.add') })).toBeNull();
    expect(screen.queryByRole('button', { name: /Deactivate/ })).toBeNull();
  });
});
