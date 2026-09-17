import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import type { AccessGrant, RoleOption, UserRow } from '@/features/administration/users/api';
import type { BranchView, CompanyView } from '@/features/administration/organization/types';
import { NAVIGATION } from '@/config/navigation';
import { visibleNavigation } from '@/lib/permissions';

/**
 * A user's roles and where each applies (P1-32 preparation).
 *
 * The properties under test: "whole organisation" sends NO places, which the
 * backend reads as organisation-wide; selected branches send one branch place
 * each; the sentence under the choice distinguishes one branch from several; a
 * narrower choice with nothing selected is refused rather than widened; a place
 * is added and removed through its own operations; the only place of a role
 * cannot be removed; a role is taken away with a written reason and the version
 * the screen displayed; every grant control is absent without `iam.grant.manage`;
 * and the new navigation entries follow their read permissions.
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

const { UserAccessScreen } =
  await import('@/features/administration/users/components/UserAccessScreen');

const USER: UserRow = {
  id: '60000000-0000-4000-8000-000000000006',
  email: 'supervisor@example.test',
  displayName: 'Workshop Supervisor',
  status: 'active',
  mfaRequired: false,
  createdAt: '2026-09-01T00:00:00.000Z',
  recordVersion: 1,
};
const COMPANY: CompanyView = {
  id: '10000000-0000-4000-8000-000000000001',
  companyCode: 'main_company',
  legalName: 'Main Company',
  status: 'active',
};
const branch = (id: string, name: string): BranchView => ({
  id,
  companyId: COMPANY.id,
  branchCode: name.toLowerCase().replace(/ /g, '_'),
  name,
  city: null,
  countryCode: null,
  timezoneName: 'Asia/Amman',
  status: 'active',
});
const NORTH = branch('20000000-0000-4000-8000-000000000011', 'North Branch');
const SOUTH = branch('20000000-0000-4000-8000-000000000012', 'South Branch');
const ROLE: RoleOption = {
  id: '70000000-0000-4000-8000-000000000007',
  roleCode: 'supervisor',
  name: 'Supervisor',
  isSystem: false,
};
const GRANT: AccessGrant = {
  id: '80000000-0000-4000-8000-000000000008',
  roleId: ROLE.id,
  scopeMode: 'scoped',
  status: 'active',
  validFrom: '2026-09-01T00:00:00.000Z',
  validTo: null,
  recordVersion: 4,
  scopes: [
    {
      id: '90000000-0000-4000-8000-000000000009',
      grantId: '80000000-0000-4000-8000-000000000008',
      scopeType: 'branch',
      companyId: COMPANY.id,
      branchId: NORTH.id,
      departmentId: null,
    },
  ],
};

function renderAccess(over: Record<string, unknown> = {}) {
  return renderLtr(
    <UserAccessScreen
      locale="en"
      messages={en}
      user={USER}
      grants={[GRANT]}
      roles={[ROLE]}
      companies={[COMPANY]}
      branches={[NORTH, SOUTH]}
      departmentNames={{}}
      canManageGrants
      canReadRoles
      canReadDepartments={false}
      {...over}
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('granting a role', () => {
  it('sends no places for the whole organisation', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    const user = userEvent.setup();
    renderAccess({ grants: [] });

    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), ROLE.id);
    expect(within(dialog).getByText(EN('users.access.scope.summaryOrganisation'))).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.grant') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/iam/grants', {
      userId: USER.id,
      roleId: ROLE.id,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('explains one branch against several, and sends one place per branch', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    const user = userEvent.setup();
    renderAccess({ grants: [] });

    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), ROLE.id);
    await user.click(within(dialog).getByRole('radio', { name: /^Selected branches/ }));

    await user.click(within(dialog).getByLabelText(/^North Branch/));
    expect(within(dialog).getByText(EN('users.access.scope.summaryOneBranch'))).toBeVisible();
    await user.click(within(dialog).getByLabelText(/^South Branch/));
    expect(
      within(dialog).getByText(
        'The role will apply in each of the 2 selected branches, and nowhere else.'
      )
    ).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: EN('users.access.grant') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/iam/grants', {
      userId: USER.id,
      roleId: ROLE.id,
      scopes: [
        { scopeType: 'branch', companyId: COMPANY.id, branchId: NORTH.id },
        { scopeType: 'branch', companyId: COMPANY.id, branchId: SOUTH.id },
      ],
    });
  });

  it('refuses a narrower choice with nothing selected rather than widening it', async () => {
    const user = userEvent.setup();
    renderAccess({ grants: [] });

    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), ROLE.id);
    await user.click(within(dialog).getByRole('radio', { name: /^Selected companies/ }));
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.grant') }));

    expect(await within(dialog).findByText(EN('users.access.scope.pickOne'))).toBeVisible();
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a grant with no role chosen', async () => {
    const user = userEvent.setup();
    renderAccess({ grants: [] });

    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.grant') }));

    expect(
      (await within(dialog).findAllByText(EN('users.access.roleRequired'))).length
    ).toBeGreaterThan(0);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('the places a role applies in', () => {
  it('names the place and says the role applies in one place only', () => {
    renderAccess();
    expect(screen.getByText('Supervisor')).toBeVisible();
    expect(screen.getByText(EN('users.access.appliesInOne'))).toBeVisible();
    expect(screen.getByText('Branch: North Branch')).toBeVisible();
  });

  it('does not offer to remove the only place, and says why', () => {
    renderAccess();
    expect(screen.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(screen.getByText(EN('users.access.lastScope'))).toBeVisible();
  });

  it('adds a place through the scope operation', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: { id: 'y' }, correlationId: 'c' });
    const user = userEvent.setup();
    renderAccess();

    await user.click(screen.getByRole('button', { name: EN('users.access.addScope') }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByLabelText(/^South Branch/));
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.addScope') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', `/api/v1/iam/grants/${GRANT.id}/scopes`, {
      scopeType: 'branch',
      companyId: COMPANY.id,
      branchId: SOUTH.id,
    });
  });

  it('removes one of several places through the scope operation', async () => {
    send.mockResolvedValue({
      ok: true,
      status: 200,
      data: { status: 'removed' },
      correlationId: 'c',
    });
    const second = {
      id: '90000000-0000-4000-8000-000000000010',
      grantId: GRANT.id,
      scopeType: 'branch' as const,
      companyId: COMPANY.id,
      branchId: SOUTH.id,
      departmentId: null,
    };
    const user = userEvent.setup();
    renderAccess({ grants: [{ ...GRANT, scopes: [...(GRANT.scopes ?? []), second] }] });

    expect(screen.getByText(EN('users.access.appliesInSeveral'))).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Remove: Branch: South Branch' }));
    const dialog = screen.getByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.removeScope') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'DELETE',
      `/api/v1/iam/grants/${GRANT.id}/scopes/${second.id}`,
      undefined,
      {}
    );
  });

  it('shows an organisation-wide role as the whole organisation', () => {
    renderAccess({ grants: [{ ...GRANT, scopeMode: 'unrestricted', scopes: [] }] });
    expect(screen.getByText(EN('users.access.scope.summaryOrganisation'))).toBeVisible();
    expect(screen.queryByRole('button', { name: EN('users.access.addScope') })).toBeNull();
  });
});

describe('taking a role away', () => {
  it('sends the written reason and the grant version as If-Match', async () => {
    send.mockResolvedValue({
      ok: true,
      status: 200,
      data: { status: 'revoked' },
      correlationId: 'c',
    });
    const user = userEvent.setup();
    renderAccess();

    await user.click(
      screen.getByRole('button', { name: `${EN('users.access.revoke')}: Supervisor` })
    );
    const dialog = screen.getByRole('alertdialog');
    await user.type(within(dialog).getByRole('textbox'), 'Moved to another workshop');
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.revoke') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'DELETE',
      `/api/v1/iam/grants/${GRANT.id}`,
      { reason: 'Moved to another workshop' },
      { ifMatch: 4 }
    );
  });

  it('refuses to send without a reason', async () => {
    const user = userEvent.setup();
    renderAccess();

    await user.click(
      screen.getByRole('button', { name: `${EN('users.access.revoke')}: Supervisor` })
    );
    const dialog = screen.getByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: EN('users.access.revoke') });
    expect(confirm).toBeDisabled();

    await user.click(within(dialog).getByRole('textbox'));
    await user.tab();
    expect(within(dialog).getByText(EN('overlay.reasonRequired'))).toBeVisible();

    await user.click(confirm);
    expect(send).not.toHaveBeenCalled();
  });

  it('is offered for an organisation-wide role too, and names its limits', () => {
    renderAccess({ grants: [{ ...GRANT, scopeMode: 'unrestricted', scopes: [] }] });
    expect(
      screen.getByRole('button', { name: `${EN('users.access.revoke')}: Supervisor` })
    ).toBeVisible();
    expect(screen.getByText(EN('users.access.revokeLimits'))).toBeVisible();
  });
});

describe('permissions', () => {
  it('offers no grant control without the grant permission', () => {
    renderAccess({ canManageGrants: false });
    expect(screen.queryByRole('button', { name: EN('users.access.grant') })).toBeNull();
    expect(screen.queryByRole('button', { name: EN('users.access.addScope') })).toBeNull();
    expect(
      screen.queryByRole('button', { name: `${EN('users.access.revoke')}: Supervisor` })
    ).toBeNull();
    expect(screen.getByText('Branch: North Branch')).toBeVisible();
  });

  it('shows Departments and Employees in the navigation only with their read codes', () => {
    const keys = (permissions: readonly string[]) =>
      visibleNavigation(NAVIGATION, { permissions })
        .flatMap((group) => group.items)
        .flatMap((item) => [item.key, ...(item.children ?? []).map((child) => child.key)]);

    const reader = keys(['iam.user.read', 'org.department.read', 'org.employee.read']);
    expect(reader).toContain('administration.departments');
    expect(reader).toContain('administration.employees');

    const without = keys(['iam.user.read']);
    expect(without).not.toContain('administration.departments');
    expect(without).not.toContain('administration.employees');
  });
});

describe('language and direction', () => {
  it('explains single branch, several branches and the whole organisation in Arabic', () => {
    renderRtl(
      <UserAccessScreen
        locale="ar"
        messages={ar}
        user={USER}
        grants={[GRANT]}
        roles={[ROLE]}
        companies={[COMPANY]}
        branches={[NORTH, SOUTH]}
        departmentNames={{}}
        canManageGrants
        canReadRoles
        canReadDepartments={false}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByText(AR('users.access.explainOneBranch'))).toBeVisible();
    expect(screen.getByText(AR('users.access.explainSeveralBranches'))).toBeVisible();
    expect(screen.getByText(AR('users.access.explainOrganisation'))).toBeVisible();
  });
});
