import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { inBranch, renderLtr, renderRtl } from './render';
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

/**
 * What `client.send` gives back when the API refuses a write it can name.
 *
 * Built as the client builds it — `ok: false`, the failure kind, and the
 * `{ path, rule }` pairs the service published — so the case below exercises the
 * real translation from a rule token to a sentence rather than a hand-written
 * field error. A fixture that supplied `fieldErrors` directly would pass with an
 * empty catalogue, which is the failure these cases exist to catch.
 */
function refusal(violations: readonly { readonly path: string; readonly rule: string }[]) {
  return {
    ok: false as const,
    kind: 'validation' as const,
    status: 422,
    problem: {
      type: 'urn:rootlco:error:ERR-VAL-001',
      title: 'Validation failed',
      status: 422,
      code: 'ERR-VAL-001',
      correlationId: 'corr-refusal',
      violations,
    },
    correlationId: 'corr-refusal',
  };
}

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

  /*
   * `role_archived` — `iam/application/access-administration-service.ts:390`,
   * published against `body.roleId`.
   *
   * A retired role is still in the picker until the page is re-read, so this is
   * an ordinary Tuesday rather than an edge: the service refuses, and what the
   * operator was told used to be "This value is not accepted here." The sentence
   * states the RULE — a retired role is given to nobody — and names neither the
   * role's own history nor who retired it.
   */
  it('says why a retired role cannot be given, beside the role control, and keeps the choice', async () => {
    send.mockResolvedValue(refusal([{ path: 'body.roleId', rule: 'role_archived' }]));
    const user = userEvent.setup();
    renderAccess({ grants: [] });

    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = screen.getByRole('dialog');
    const role = within(dialog).getByLabelText(/^Role/) as HTMLSelectElement;
    await user.selectOptions(role, ROLE.id);
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.grant') }));

    const sentence = await within(dialog).findByText(EN('form.violation.role_archived'));
    expect(sentence).toBeVisible();
    // Beside the control it is about, not only in the banner.
    expect(role).toHaveAttribute('aria-invalid', 'true');
    // And what was chosen is still chosen, so the correction is one click.
    expect(role.value).toBe(ROLE.id);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('says the same thing in Arabic, in Arabic script', async () => {
    send.mockResolvedValue(refusal([{ path: 'body.roleId', rule: 'role_archived' }]));
    const user = userEvent.setup();
    renderRtl(
      <UserAccessScreen
        locale="ar"
        messages={ar}
        user={USER}
        grants={[]}
        roles={[ROLE]}
        companies={[COMPANY]}
        branches={[NORTH, SOUTH]}
        departmentNames={{}}
        canManageGrants
        canReadRoles
        canReadDepartments={false}
      />
    );

    await user.click(screen.getByRole('button', { name: AR('users.access.grant') }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByRole('combobox'), ROLE.id);
    await user.click(within(dialog).getByRole('button', { name: AR('users.access.grant') }));

    const arabic = AR('form.violation.role_archived');
    expect(await within(dialog).findByText(arabic)).toBeVisible();
    expect(arabic).toMatch(/[؀-ۿ]/);
    expect(arabic).not.toBe(EN('form.violation.role_archived'));
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

/**
 * Two more administration screens whose refusals had nowhere to land.
 *
 * They are exercised HERE rather than in files of their own because this phase
 * moves no sealed file count: `apps/web/tests` may gain cases and may not gain
 * files. This suite is the administration DOM suite that already mocks the HTTP
 * client and the router the same way, and both screens below live under
 * `features/administration` beside the one above.
 */

const { UsersScreen } = await import('@/features/administration/users/components/UsersScreen');
const { ApprovalLimitsScreen } =
  await import('@/features/administration/access/components/ApprovalLimitsScreen');

/** An account still waiting to be activated, which is what makes Activate offered. */
const INVITED: UserRow = { ...USER, id: '60000000-0000-4000-8000-000000000016', status: 'invited' };

const page = (rows: readonly UserRow[]) => ({
  ok: true as const,
  status: 200,
  data: { items: rows, nextCursor: null },
  correlationId: 'corr-page',
});

describe('changing an account’s state', () => {
  /*
   * `identity_disabled` — `iam/application/invitation-service.ts:392`, published
   * against `path.userId`, so it names no control and belongs in the dialog's
   * one message slot.
   *
   * It used to be unreachable there for a second reason: activation replaced
   * EVERY refusal with "the invitation has not been accepted yet", which is a
   * different and wrong reason, and sent the operator to chase an acceptance
   * that had already happened. The sentence states only that the account is
   * switched off — nothing about how, where or by which sign-in arrangement.
   */
  it('says an account is switched off, rather than blaming the invitation', async () => {
    get.mockResolvedValue(page([INVITED]));
    send.mockResolvedValue(refusal([{ path: 'path.userId', rule: 'identity_disabled' }]));
    const user = userEvent.setup();
    renderLtr(<UsersScreen locale="en" messages={en} canManage canRevokeSessions roles={[ROLE]} />);

    await user.click(await screen.findByRole('button', { name: EN('users.action.activate') }));
    const dialog = await screen.findByRole('alertdialog');
    await user.type(within(dialog).getByRole('textbox'), 'Joining the workshop today');
    await user.click(within(dialog).getByRole('button', { name: EN('users.action.activate') }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent(EN('form.violation.identity_disabled'));
    expect(alert).not.toHaveTextContent(EN('users.notAccepted'));
  });

  /*
   * `control_characters` — `iam/domain/identity-policy.ts:120`, against
   * `body.reason`. A field refusal, and this dialog holds one control and one
   * message slot, so the sentence goes there rather than being dropped for the
   * general "that change was not saved".
   */
  it('says what is wrong with the written reason, and keeps what was typed', async () => {
    get.mockResolvedValue(page([USER]));
    send.mockResolvedValue(refusal([{ path: 'body.reason', rule: 'control_characters' }]));
    const user = userEvent.setup();
    renderLtr(<UsersScreen locale="en" messages={en} canManage canRevokeSessions roles={[ROLE]} />);

    await user.click(await screen.findByRole('button', { name: EN('users.action.lock') }));
    const dialog = await screen.findByRole('alertdialog');
    const reason = within(dialog).getByRole('textbox');
    await user.type(reason, 'Left the company');
    await user.click(within(dialog).getByRole('button', { name: EN('users.action.lock') }));

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      EN('form.violation.control_characters')
    );
    expect(reason).toHaveValue('Left the company');
  });
});

describe('an approval limit’s effective window', () => {
  /*
   * `not_after_start` — `iam/domain/credential-policy.ts:129`, against
   * `body.effectiveTo`, which IS a control on this dialog, so this case proves
   * the wiring that was already there now has a sentence to carry.
   */
  it('marks the end date and keeps every other entry as typed', async () => {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [], nextCursor: null },
      correlationId: 'corr-page',
    });
    send.mockResolvedValue(refusal([{ path: 'body.effectiveTo', rule: 'not_after_start' }]));
    const user = userEvent.setup();
    // The company is chosen BY NAME now, from the working context, so the test
    // states which companies this operator may act in rather than handing the
    // screen a bare reference.
    renderLtr(
      inBranch(
        <ApprovalLimitsScreen
          locale="en"
          messages={en}
          roles={[
            {
              id: ROLE.id,
              roleCode: ROLE.roleCode,
              name: ROLE.name,
              description: null,
              isSystem: false,
              recordVersion: 1,
            },
          ]}
          canManage
        />
      )
    );

    await user.click(await screen.findByRole('button', { name: EN('approvalLimits.create') }));
    const dialog = await screen.findByRole('dialog');
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${EN('approvalLimits.field.limitType')}`)),
      'discount'
    );
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${EN('approvalLimits.field.amount')}`)),
      '1500.0000'
    );
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${EN('approvalLimits.field.currency')}`)),
      'JOD'
    );
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${EN('approvalLimits.field.effectiveFrom')}`)),
      '2026-10-01'
    );
    await user.type(
      within(dialog).getByLabelText(new RegExp(`^${EN('approvalLimits.field.effectiveTo')}`)),
      '2026-09-01'
    );
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    expect(await within(dialog).findByText(EN('form.violation.not_after_start'))).toBeVisible();
    /*
     * Re-queried rather than reused. Every control in this dialog is keyed on
     * the attempt number so React's post-action form reset cannot strand it, so
     * the node held before the submit is detached and asserting on it would test
     * the previous render.
     */
    expect(
      within(dialog).getByLabelText(new RegExp(`^${EN('approvalLimits.field.effectiveTo')}`))
    ).toHaveAttribute('aria-invalid', 'true');
    expect(
      within(dialog).getByLabelText(new RegExp(`^${EN('approvalLimits.field.limitType')}`))
    ).toHaveValue('discount');
  });
});
