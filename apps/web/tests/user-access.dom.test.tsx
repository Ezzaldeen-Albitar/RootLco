import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import type { ReactElement } from 'react';
import { inBranch, renderLtr, renderRtl } from './render';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
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
let SESSION_PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: SESSION_PERMISSIONS, email: 'admin@test.local' }),
}));
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { PermissionsScreen } =
  await import('@/features/administration/access/components/PermissionsScreen');
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

/**
 * Under the Material UI foundation, as the locale layout mounts it (ADR-022,
 * `P1-32-PRE-OD-ADM3`): the users list and the user's access page are drawn by
 * the shared wrappers, which read the theme and the catalogue's grid texts.
 */
function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

function renderAccess(over: Record<string, unknown> = {}, locale: 'en' | 'ar' = 'en') {
  const ui = withMui(
    <UserAccessScreen
      locale={locale}
      messages={locale === 'en' ? en : ar}
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
    />,
    locale
  );
  return locale === 'en' ? renderLtr(ui) : renderRtl(ui);
}

/**
 * Types a calendar day into a Material date picker, part by part, whatever order
 * the language writes the parts in (P1-32-PRE-OD-ADM4: the approval-limit dates
 * are the shared `DateField` now). The group is found by its label.
 */
async function typeDay(
  user: ReturnType<typeof userEvent.setup>,
  scope: HTMLElement,
  label: string,
  day: string
): Promise<HTMLElement> {
  const [year, month, date] = day.split('-') as [string, string, string];
  const group = within(scope).getByRole('group', { name: new RegExp(`^${label}`) });
  const named = (key: string) =>
    new Set([(en as Record<string, string>)[key], (ar as Record<string, string>)[key]]);
  const years = named('mui.pickers.year');
  const months = named('mui.pickers.month');
  for (const part of within(group).getAllByRole('spinbutton')) {
    const name = part.getAttribute('aria-label') ?? '';
    const digits = years.has(name) ? year : months.has(name) ? month : date;
    await user.click(part);
    await user.keyboard(digits);
  }
  return group;
}

/**
 * The grant and add-place dialog, found by the title it is named by. A form is the
 * shared `FormDialog` — a `dialog`, not an alert — since `P1-32-PRE-OD-ADM4`.
 */
const scopeDialog = (title: string) => screen.getByRole('dialog', { name: title });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('granting a role', () => {
  it('sends no places for the whole organisation', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    const user = userEvent.setup();
    renderAccess({ grants: [] });

    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = scopeDialog(EN('users.access.grant'));
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), ROLE.id);
    expect(within(dialog).getByText(EN('users.access.scope.summaryOrganisation'))).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.grant') }));

    // The empty list means everywhere, so it is confirmed by name first and
    // nothing is sent until it is (P1-32-PRE-OD-ADM3).
    const confirm = await screen.findByRole('alertdialog', {
      name: EN('users.access.confirmOrganisation.title'),
    });
    expect(confirm).toHaveAccessibleDescription(
      EN('users.access.confirmOrganisation.body').replace('{role}', ROLE.name)
    );
    expect(send).not.toHaveBeenCalled();
    await user.click(
      within(confirm).getByRole('button', { name: EN('users.access.confirmOrganisation.confirm') })
    );

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/iam/grants', {
      userId: USER.id,
      roleId: ROLE.id,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('sends nothing for the whole organisation when the confirmation is cancelled, and keeps the choice', async () => {
    const user = userEvent.setup();
    renderAccess({ grants: [] });

    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = scopeDialog(EN('users.access.grant'));
    const role = within(dialog).getByLabelText(/^Role/) as HTMLSelectElement;
    await user.selectOptions(role, ROLE.id);
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.grant') }));
    const confirm = await screen.findByRole('alertdialog', {
      name: EN('users.access.confirmOrganisation.title'),
    });
    await user.click(within(confirm).getByRole('button', { name: EN('overlay.cancel') }));

    await waitFor(() =>
      expect(
        screen.queryByRole('alertdialog', { name: EN('users.access.confirmOrganisation.title') })
      ).toBeNull()
    );
    expect(send).not.toHaveBeenCalled();
    expect(role.value).toBe(ROLE.id);
    expect(within(dialog).getByRole('radio', { name: /^Whole organisation/ })).toBeChecked();
  });

  it('asks nothing more for a narrower choice: one branch is sent at once', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    const user = userEvent.setup();
    renderAccess({ grants: [] });

    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = scopeDialog(EN('users.access.grant'));
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), ROLE.id);
    await user.click(within(dialog).getByRole('radio', { name: /^Selected branches/ }));
    await user.click(within(dialog).getByLabelText(/^North Branch/));
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.grant') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(
      screen.queryByRole('alertdialog', { name: EN('users.access.confirmOrganisation.title') })
    ).toBeNull();
  });

  it('sends one grant when the confirmation is pressed twice inside one frame', async () => {
    let answer: (value: unknown) => void = () => undefined;
    send.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      })
    );
    const user = userEvent.setup();
    renderAccess({ grants: [] });

    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = scopeDialog(EN('users.access.grant'));
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), ROLE.id);
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.grant') }));
    const confirm = await screen.findByRole('alertdialog', {
      name: EN('users.access.confirmOrganisation.title'),
    });
    const press = within(confirm).getByRole('button', {
      name: EN('users.access.confirmOrganisation.confirm'),
    });
    act(() => {
      press.click();
      press.click();
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    answer({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('says the whole-organisation consequence in Arabic before anything is sent', async () => {
    const user = userEvent.setup();
    renderAccess({ grants: [] }, 'ar');

    await user.click(screen.getByRole('button', { name: AR('users.access.grant') }));
    const dialog = scopeDialog(AR('users.access.grant'));
    await user.selectOptions(within(dialog).getByRole('combobox'), ROLE.id);
    await user.click(within(dialog).getByRole('button', { name: AR('users.access.grant') }));

    const confirm = await screen.findByRole('alertdialog', {
      name: AR('users.access.confirmOrganisation.title'),
    });
    expect(AR('users.access.confirmOrganisation.title')).toMatch(/[؀-ۿ]/);
    expect(
      within(confirm).getByRole('button', { name: AR('users.access.confirmOrganisation.confirm') })
    ).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
    expect(send).not.toHaveBeenCalled();
  });

  it('explains one branch against several, and sends one place per branch', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    const user = userEvent.setup();
    renderAccess({ grants: [] });

    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = scopeDialog(EN('users.access.grant'));
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
    const dialog = scopeDialog(EN('users.access.grant'));
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
    const dialog = scopeDialog(EN('users.access.grant'));
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
    const dialog = scopeDialog(EN('users.access.grant'));
    const role = within(dialog).getByLabelText(/^Role/) as HTMLSelectElement;
    await user.selectOptions(role, ROLE.id);
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.grant') }));
    // Whole organisation is the default place, so the grant is confirmed first.
    await user.click(
      within(
        await screen.findByRole('alertdialog', {
          name: EN('users.access.confirmOrganisation.title'),
        })
      ).getByRole('button', { name: EN('users.access.confirmOrganisation.confirm') })
    );

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
    renderAccess({ grants: [] }, 'ar');

    await user.click(screen.getByRole('button', { name: AR('users.access.grant') }));
    const dialog = scopeDialog(AR('users.access.grant'));
    await user.selectOptions(within(dialog).getByRole('combobox'), ROLE.id);
    await user.click(within(dialog).getByRole('button', { name: AR('users.access.grant') }));
    await user.click(
      within(
        await screen.findByRole('alertdialog', {
          name: AR('users.access.confirmOrganisation.title'),
        })
      ).getByRole('button', { name: AR('users.access.confirmOrganisation.confirm') })
    );

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

    await user.click(
      screen.getByRole('button', { name: `${EN('users.access.addScope')}: Supervisor` })
    );
    const dialog = scopeDialog(`${EN('users.access.addScope')} — Supervisor`);
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
    expect(
      screen.queryByRole('button', { name: `${EN('users.access.addScope')}: Supervisor` })
    ).toBeNull();
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

    // Material's disabled button refuses the pointer outright (`pointer-events:
    // none`), so the press is dispatched directly: a click that reaches it still
    // sends nothing.
    fireEvent.click(confirm);
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
    expect(
      screen.queryByRole('button', { name: `${EN('users.access.addScope')}: Supervisor` })
    ).toBeNull();
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
    renderAccess({}, 'ar');
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
    renderLtr(
      withMui(<UsersScreen locale="en" messages={en} canManage canRevokeSessions roles={[ROLE]} />)
    );

    // A row action is named with the person it acts on (G9).
    await user.click(
      await screen.findByRole('button', {
        name: `${EN('users.action.activate')} ${INVITED.displayName}`,
      })
    );
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
    renderLtr(
      withMui(<UsersScreen locale="en" messages={en} canManage canRevokeSessions roles={[ROLE]} />)
    );

    await user.click(
      await screen.findByRole('button', { name: `${EN('users.action.lock')} ${USER.displayName}` })
    );
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
      withMui(
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
        ),
        'en'
      )
    );

    await user.click(await screen.findByRole('button', { name: EN('approvalLimits.create') }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(
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
    await typeDay(user, dialog, EN('approvalLimits.field.effectiveFrom'), '2026-10-01');
    await typeDay(user, dialog, EN('approvalLimits.field.effectiveTo'), '2026-09-01');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));

    expect(await within(dialog).findByText(EN('form.violation.not_after_start'))).toBeVisible();
    /*
     * Re-queried rather than reused. Every control in this dialog is keyed on
     * the attempt number so React's post-action form reset cannot strand it, so
     * the node held before the submit is detached and asserting on it would test
     * the previous render.
     */
    expect(
      within(dialog).getByRole('group', {
        name: new RegExp(`^${EN('approvalLimits.field.effectiveTo')}`),
      })
    ).toHaveAttribute('aria-invalid', 'true');
    expect(
      within(dialog).getByLabelText(new RegExp(`^${EN('approvalLimits.field.limitType')}`))
    ).toHaveValue('discount');
  });
});

/**
 * ADR-023 D13: a credit-note approval limit is its own type, chosen by name, never a
 * discount limit; it is above zero and fits the currency's smallest coin. The
 * client refuses a zero on the amount before sending; the server files a finer
 * amount on the same field.
 */
describe('a credit-note approval limit (ADR-023 D13)', () => {
  const roles = [
    {
      id: ROLE.id,
      roleCode: ROLE.roleCode,
      name: ROLE.name,
      description: null,
      isSystem: false,
      recordVersion: 1,
    },
  ];
  const emptyList = {
    ok: true,
    status: 200,
    data: { items: [], nextCursor: null },
    correlationId: 'corr-page',
  };

  async function openCreate(locale: 'en' | 'ar' = 'en') {
    const user = userEvent.setup();
    const render = locale === 'en' ? renderLtr : renderRtl;
    render(
      withMui(
        inBranch(
          <ApprovalLimitsScreen
            locale={locale}
            messages={locale === 'en' ? en : ar}
            roles={roles}
            canManage
          />,
          { locale }
        ),
        locale
      )
    );
    const text = locale === 'en' ? EN : AR;
    await user.click(await screen.findByRole('button', { name: text('approvalLimits.create') }));
    const dialog = await screen.findByRole('dialog');
    const field = (key: string) => within(dialog).getByLabelText(new RegExp(`^${text(key)}`));
    return { user, dialog, field, text };
  }

  it('offers exactly the discount and credit-note types, by name, and no default', async () => {
    get.mockResolvedValue(emptyList);
    const { field } = await openCreate();
    const type = field('approvalLimits.field.limitType') as HTMLSelectElement;
    expect(type).toHaveValue('');
    const offered = [...type.options].filter((o) => o.value !== '').map((o) => [o.value, o.text]);
    expect(offered).toEqual([
      ['discount', EN('approvalLimits.type.discount')],
      ['credit_note', EN('approvalLimits.type.credit_note')],
    ]);
  });

  it('refuses a zero credit-note limit on the amount, sends nothing, and keeps what was typed', async () => {
    get.mockResolvedValue(emptyList);
    const { user, dialog, field, text } = await openCreate();
    await user.selectOptions(field('approvalLimits.field.limitType'), 'credit_note');
    await user.type(field('approvalLimits.field.amount'), '0.000');
    await user.type(field('approvalLimits.field.currency'), 'JOD');
    await typeDay(user, dialog, text('approvalLimits.field.effectiveFrom'), '2026-10-01');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));
    expect(await within(dialog).findByText(EN('approvalLimits.error.positive'))).toBeVisible();
    expect(field('approvalLimits.field.amount')).toHaveAttribute('aria-invalid', 'true');
    expect(field('approvalLimits.field.amount')).toHaveValue('0.000');
    expect(field('approvalLimits.field.limitType')).toHaveValue('credit_note');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a credit-note limit as typed, and files the server refusal of a finer amount on the amount', async () => {
    get.mockResolvedValue(emptyList);
    send.mockResolvedValue(refusal([{ path: 'body.amount', rule: 'minor_unit_scale' }]));
    const { user, dialog, field, text } = await openCreate();
    await user.selectOptions(field('approvalLimits.field.limitType'), 'credit_note');
    await user.type(field('approvalLimits.field.amount'), '250.0005');
    await user.type(field('approvalLimits.field.currency'), 'JOD');
    await typeDay(user, dialog, text('approvalLimits.field.effectiveFrom'), '2026-10-01');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [, path, body] = send.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(path).toBe('/api/v1/iam/approval-limits');
    expect(body).toMatchObject({ limitType: 'credit_note', amount: '250.0005', currency: 'JOD' });
    expect(await within(dialog).findByText(EN('form.violation.minor_unit_scale'))).toBeVisible();
    expect(field('approvalLimits.field.amount')).toHaveAttribute('aria-invalid', 'true');
    expect(field('approvalLimits.field.amount')).toHaveValue('250.0005');
  });

  it('names a stored credit-note limit in words in the list', async () => {
    get.mockResolvedValue({
      ...emptyList,
      data: {
        items: [
          {
            id: 'limit-1',
            companyId: 'company-1',
            roleId: ROLE.id,
            userId: null,
            limitType: 'credit_note',
            amount: '500.000',
            currencyCode: 'JOD',
            effectiveFrom: '2026-10-01',
            effectiveTo: null,
            recordVersion: 1,
          },
        ],
        nextCursor: null,
      },
    });
    renderLtr(
      withMui(
        inBranch(<ApprovalLimitsScreen locale="en" messages={en} roles={roles} canManage />),
        'en'
      )
    );
    expect(await screen.findByText(EN('approvalLimits.type.credit_note'))).toBeVisible();
    expect(screen.queryByText('credit_note')).toBeNull();
  });

  /*
   * DF-B6. A person's limit read "Person: 0b3d8c05-…" and, in Arabic, the
   * provisioned role read "Tenant Administrator". The person is named through
   * the user directory; the role is named in the reader's language; neither
   * reference ever reaches the screen.
   */
  const PERSON_ID = '0b3d8c05-228a-406c-8c4c-b9df5b3f8458';
  const ADMIN_ROLE = {
    id: '70000000-0000-4000-8000-0000000000ad',
    roleCode: 'tenant_administrator',
    name: 'Tenant Administrator',
    description: null,
    isSystem: false,
    recordVersion: 1,
  };
  const limitRow = (over: Record<string, unknown>) => ({
    id: `limit-${String(over['userId'] ?? over['roleId'])}`,
    companyId: 'company-1',
    roleId: null,
    userId: null,
    limitType: 'credit_note',
    amount: '500.000',
    currencyCode: 'JOD',
    effectiveFrom: '2026-10-01',
    effectiveTo: null,
    recordVersion: 1,
    ...over,
  });
  /*
   * The list names the person and the role itself (`P1-32-PRE-OD-ADM4`, route
   * checklist prerequisite 9) — and only for a caller holding `iam.user.read`.
   * `named` is what the service answers that caller; without it the service
   * publishes `null`, never the reference, and the screen reads nothing more.
   */
  const namedList = (path: string, named = true) =>
    path.startsWith('/api/v1/iam/users')
      ? {
          ok: true,
          status: 200,
          data: { id: PERSON_ID, displayName: 'Someone Else' },
          correlationId: 'corr-user',
        }
      : {
          ...emptyList,
          data: {
            items: [
              limitRow({ userId: PERSON_ID, userDisplayName: named ? 'Rana Khoury' : null }),
              limitRow({ roleId: ADMIN_ROLE.id }),
            ],
            nextCursor: null,
          },
        };

  it('names the person behind a limit and never prints the account reference (DF-B6)', async () => {
    get.mockImplementation(async (path: string) => namedList(path));
    renderLtr(
      withMui(
        inBranch(
          <ApprovalLimitsScreen
            locale="en"
            messages={en}
            roles={[...roles, ADMIN_ROLE]}
            canManage
            canReadUsers
          />
        ),
        'en'
      )
    );
    expect(await screen.findByText('Rana Khoury')).toBeVisible();
    expect(screen.queryByText(PERSON_ID)).toBeNull();
    expect(document.body.textContent ?? '').not.toContain(PERSON_ID);
    // The provisioned name carries a platform word; it is said in plain words.
    expect(screen.getByText(EN('roles.standard.tenant_administrator'))).toBeVisible();
    expect(screen.queryByText('Tenant Administrator')).toBeNull();
  });

  it('says why a person is not named without the user read, still without the reference (DF-B6)', async () => {
    get.mockImplementation(async (path: string) => namedList(path, false));
    renderLtr(
      withMui(
        inBranch(<ApprovalLimitsScreen locale="en" messages={en} roles={roles} canManage />),
        'en'
      )
    );
    expect(await screen.findByText(EN('approvalLimits.person.denied'))).toBeVisible();
    expect(document.body.textContent ?? '').not.toContain(PERSON_ID);
    // A role this screen cannot see is said to be one, not shown as its reference.
    expect(screen.getByText(EN('approvalLimits.subject.roleUnknown'))).toBeVisible();
    expect(document.body.textContent ?? '').not.toContain(ADMIN_ROLE.id);
    expect(get.mock.calls.some(([path]) => String(path).includes('/iam/users/'))).toBe(false);
  });

  it('names the person and the provisioned role in Arabic (DF-B6)', async () => {
    get.mockImplementation(async (path: string) => namedList(path));
    renderRtl(
      withMui(
        inBranch(
          <ApprovalLimitsScreen
            locale="ar"
            messages={ar}
            roles={[...roles, ADMIN_ROLE]}
            canManage
            canReadUsers
          />,
          { locale: 'ar' }
        ),
        'ar'
      )
    );
    expect(await screen.findByText('Rana Khoury')).toBeVisible();
    expect(screen.getByText(AR('roles.standard.tenant_administrator'))).toBeVisible();
    expect(screen.queryByText('Tenant Administrator')).toBeNull();
    expect(document.body.textContent ?? '').not.toContain(PERSON_ID);
  });

  it('keeps a renamed standard role in the words the organisation chose (DF-B6)', async () => {
    get.mockImplementation(async (path: string) => namedList(path));
    renderRtl(
      withMui(
        inBranch(
          <ApprovalLimitsScreen
            locale="ar"
            messages={ar}
            roles={[...roles, { ...ADMIN_ROLE, name: 'Workshop Owner' }]}
            canManage
          />,
          { locale: 'ar' }
        ),
        'ar'
      )
    );
    expect(await screen.findByText('Workshop Owner')).toBeVisible();
    expect(screen.queryByText(AR('roles.standard.tenant_administrator'))).toBeNull();
  });

  it('labels the types and the zero refusal in Arabic', async () => {
    get.mockResolvedValue(emptyList);
    const { user, dialog, field, text } = await openCreate('ar');
    const type = field('approvalLimits.field.limitType') as HTMLSelectElement;
    expect([...type.options].map((o) => o.text)).toEqual(
      expect.arrayContaining([
        AR('approvalLimits.type.discount'),
        AR('approvalLimits.type.credit_note'),
      ])
    );
    await user.selectOptions(type, 'credit_note');
    await user.type(field('approvalLimits.field.amount'), '0');
    await user.type(field('approvalLimits.field.currency'), 'JOD');
    await typeDay(user, dialog, text('approvalLimits.field.effectiveFrom'), '2026-10-01');
    await user.click(within(dialog).getByRole('button', { name: AR('admin.create') }));
    const sentence = await within(dialog).findByText(AR('approvalLimits.error.positive'));
    expect(sentence.textContent ?? '').toMatch(/[\u0600-\u06ff]/);
    expect(send).not.toHaveBeenCalled();
  });
});

describe('an approval limit refused for separation of duties says why (QA rows 7.1c, 7.1d)', () => {
  /*
   * `iam/domain/delegation-policy.ts` refuses a limit for yourself and a limit
   * for a role you hold with 403 and a named rule. The screen used to answer
   * both with "You do not have permission for this", which is false — the
   * caller holds the approval permission — and sends them to ask for access
   * that would change nothing. Built as the client builds a 403, so the case
   * exercises the real rule-to-sentence translation.
   */
  const forbidden = (rule: string) => ({
    ok: false as const,
    kind: 'forbidden' as const,
    status: 403,
    problem: {
      type: 'urn:rootlco:error:ERR-IAM-001',
      title: 'Forbidden',
      status: 403,
      code: 'ERR-IAM-001',
      correlationId: 'corr-sod',
      violations: [{ path: 'body', rule }],
    },
    correlationId: 'corr-sod',
  });

  async function submitRefused(rule: string, locale: 'en' | 'ar', text: (key: string) => string) {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [], nextCursor: null },
      correlationId: 'corr-page',
    });
    send.mockResolvedValue(forbidden(rule));
    const user = userEvent.setup();
    const render = locale === 'en' ? renderLtr : renderRtl;
    render(
      withMui(
        inBranch(
          <ApprovalLimitsScreen
            locale={locale}
            messages={locale === 'en' ? en : ar}
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
        ),
        'en'
      )
    );
    await user.click(await screen.findByRole('button', { name: text('approvalLimits.create') }));
    const dialog = await screen.findByRole('dialog');
    const field = (key: string) => within(dialog).getByLabelText(new RegExp(`^${text(key)}`));
    await user.selectOptions(field('approvalLimits.field.limitType'), 'discount');
    await user.type(field('approvalLimits.field.amount'), '10.0000');
    await user.type(field('approvalLimits.field.currency'), 'JOD');
    await typeDay(user, dialog, text('approvalLimits.field.effectiveFrom'), '2026-10-01');
    await user.click(within(dialog).getByRole('button', { name: text('admin.create') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    return dialog;
  }

  it.each(['approval_limit_for_own_role', 'approval_limit_for_yourself'])(
    'states the %s reason, never a missing permission',
    async (rule) => {
      const dialog = await submitRefused(rule, 'en', EN);
      expect(await within(dialog).findByText(EN(`form.violation.${rule}`))).toBeVisible();
      expect(within(dialog).queryByText(EN('state.denied.message'))).toBeNull();
      expect(within(dialog).queryByText(new RegExp(EN('state.denied.title')))).toBeNull();
    }
  );

  it('says the same thing in Arabic, in Arabic script', async () => {
    const dialog = await submitRefused('approval_limit_for_own_role', 'ar', AR);
    const sentence = await within(dialog).findByText(
      AR('form.violation.approval_limit_for_own_role')
    );
    expect(sentence).toBeVisible();
    expect(sentence.textContent ?? '').toMatch(/[؀-ۿ]/);
    expect(AR('form.violation.approval_limit_for_yourself')).toMatch(/[؀-ۿ]/);
  });
});

describe('an approval limit’s person is found by name (route sweep B3)', () => {
  /*
   * The dialog took a pasted account reference for "Person". It now finds the
   * person through `iam.user-list` for a caller holding `iam.user.read`; a
   * caller without it keeps the labelled reference box, because creating a
   * limit does not need the user read.
   */
  const PERSON = {
    id: '80000000-0000-4000-8000-000000000008',
    email: 'rana@example.test',
    displayName: 'Rana Saleh',
    status: 'active',
    mfaRequired: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    recordVersion: 1,
  };
  const ROLE_ROW = {
    id: ROLE.id,
    roleCode: ROLE.roleCode,
    name: ROLE.name,
    description: null,
    isSystem: false,
    recordVersion: 1,
  };
  const label = (key: string) => new RegExp(`^${EN(key)}`);

  function answerReads() {
    get.mockImplementation(async (path: string) =>
      path.startsWith('/api/v1/iam/users')
        ? {
            ok: true,
            status: 200,
            data: { items: [PERSON], nextCursor: null, hasMore: false },
            correlationId: 'corr-users',
          }
        : { ok: true, status: 200, data: { items: [], nextCursor: null }, correlationId: 'c' }
    );
  }

  async function openAsPerson(canReadUsers: boolean) {
    const user = userEvent.setup();
    renderLtr(
      withMui(
        inBranch(
          <ApprovalLimitsScreen
            locale="en"
            messages={en}
            roles={[ROLE_ROW]}
            canManage
            canReadUsers={canReadUsers}
          />
        ),
        'en'
      )
    );
    await user.click(await screen.findByRole('button', { name: EN('approvalLimits.create') }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(
      within(dialog).getByLabelText(label('approvalLimits.field.subject')),
      'user'
    );
    return { user, dialog };
  }

  async function fillTheRest(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    await user.selectOptions(
      within(dialog).getByLabelText(label('approvalLimits.field.limitType')),
      'discount'
    );
    await user.type(
      within(dialog).getByLabelText(label('approvalLimits.field.amount')),
      '1500.0000'
    );
    await user.type(within(dialog).getByLabelText(label('approvalLimits.field.currency')), 'JOD');
    await typeDay(user, dialog, EN('approvalLimits.field.effectiveFrom'), '2026-10-01');
  }

  it('with the user read, finds the person by name and sends only their account', async () => {
    answerReads();
    send.mockResolvedValue({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    const { user, dialog } = await openAsPerson(true);
    expect(within(dialog).queryByTestId('approval-limit-person-reference')).toBeNull();
    await fillTheRest(user, dialog);

    // Nothing chosen: refused on the person, not on "Applies to", and nothing is sent.
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));
    expect(await within(dialog).findByText(EN('approvalLimits.error.person'))).toBeVisible();
    expect(send).not.toHaveBeenCalled();

    await user.type(
      within(dialog).getByLabelText(EN('approvalLimits.field.person')),
      'Rana{Enter}'
    );
    // The person is an OPTION of the combobox now (EntityPicker), in its listbox,
    // which Material draws in a popup on the page rather than inside the dialog.
    await user.click(await screen.findByRole('option', { name: /Rana Saleh/ }));
    expect(get.mock.calls.some(([path]) => String(path).includes('search=Rana'))).toBe(true);
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [, path, body] = send.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(path).toBe('/api/v1/iam/approval-limits');
    expect(body['userId']).toBe(PERSON.id);
    expect(body['roleId']).toBeNull();
  });

  it('without the user read, keeps the labelled reference box and offers no search', async () => {
    answerReads();
    const { dialog } = await openAsPerson(false);
    const box = within(within(dialog).getByTestId('approval-limit-person-reference')).getByRole(
      'textbox'
    );
    expect(box).toHaveAccessibleDescription(EN('approvalLimits.field.userIdHelp'));
    expect(within(dialog).queryByRole('searchbox')).toBeNull();
    expect(get.mock.calls.some(([path]) => String(path).startsWith('/api/v1/iam/users'))).toBe(
      false
    );
  });

  it('the approval-limits page offers the search only to a caller holding the user read', async () => {
    const ApprovalLimitsPage = (
      await import('@/app/[locale]/(dashboard)/administration/approval-limits/page')
    ).default as unknown as (args: {
      params: Promise<Record<string, string>>;
    }) => Promise<React.ReactNode>;
    answerReads();
    for (const [permissions, searchable] of [
      [['iam.approval.manage', 'iam.user.read'], true],
      [['iam.approval.manage'], false],
    ] as const) {
      SESSION_PERMISSIONS = permissions;
      const view = renderLtr(
        withMui(
          inBranch(
            (await ApprovalLimitsPage({ params: Promise.resolve({ locale: 'en' }) })) as never
          ),
          'en'
        )
      );
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: EN('approvalLimits.create') }));
      const dialog = await screen.findByRole('dialog');
      await user.selectOptions(
        within(dialog).getByLabelText(label('approvalLimits.field.subject')),
        'user'
      );
      expect(within(dialog).queryByTestId('approval-limit-person-picker') !== null).toBe(
        searchable
      );
      expect(within(dialog).queryByTestId('approval-limit-person-reference') !== null).toBe(
        !searchable
      );
      view.unmount();
    }
  });
});

describe('the permission catalogue says when it could not be read (route sweep B3)', () => {
  it('draws a refused catalogue as a refusal with its reference, never as a role with no permissions', async () => {
    get.mockResolvedValue({
      ok: false,
      kind: 'forbidden',
      status: 403,
      correlationId: 'corr-perm',
    });
    renderLtr(
      <PermissionsScreen
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
    );
    expect(await screen.findByText(EN('state.denied.title'))).toBeVisible();
    expect(screen.getByText('corr-perm')).toBeVisible();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * `/administration/users` and `/administration/users/[userId]` on Material UI
 * (ADR-022, `P1-32-PRE-OD-ADM3`).
 *
 * The list is the operational grid over the cursor-paged `iam.user-list`; the
 * account actions, the invitation, the account's own details (`iam.user-update`,
 * which had no caller before this slice) and the grant dialogs are the shared
 * Material wrappers. Every case renders under the Material foundation and, where
 * the case is about a form or a sentence, in both languages.
 * ---------------------------------------------------------------------------
 */

const { useUnsavedWork } = await import('@/features/working-context/WorkingContextProvider');

/** Reads the shell's unsaved-work registry the way the branch selector does. */
function UnsavedProbe() {
  const work = useUnsavedWork();
  return (
    <button
      type="button"
      onClick={(event) => {
        event.currentTarget.dataset['answer'] = String(work.any());
      }}
    >
      probe unsaved
    </button>
  );
}

/**
 * Asks the registry, without moving the cursor out of an open dialog: the probe
 * sits outside it, behind the dialog's backdrop, so it is pressed directly.
 */
async function unsavedNow(): Promise<string | undefined> {
  const probe = screen.getByRole('button', { name: 'probe unsaved', hidden: true });
  act(() => {
    fireEvent.click(probe);
  });
  return probe.dataset['answer'];
}

/** A sentence as a pattern: the shared error carries a shape (an icon) before its words. */
const said = (text: string) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const CATALOGUE = { en: EN, ar: AR } as const;
const LOCKED: UserRow = {
  ...USER,
  id: '60000000-0000-4000-8000-000000000018',
  displayName: 'Paused Clerk',
  email: 'paused@example.test',
  status: 'locked',
};
const ARCHIVED: UserRow = {
  ...USER,
  id: '60000000-0000-4000-8000-000000000017',
  displayName: 'Former Clerk',
  email: 'former@example.test',
  status: 'archived',
};

function mountUsers(locale: 'en' | 'ar' = 'en', over: Record<string, unknown> = {}) {
  const ui = withMui(
    inBranch(
      <>
        <UsersScreen
          locale={locale}
          messages={locale === 'en' ? en : ar}
          canManage
          canRevokeSessions
          roles={[ROLE]}
          {...over}
        />
        <UnsavedProbe />
      </>,
      { locale }
    ),
    locale
  );
  return locale === 'en' ? renderLtr(ui) : renderRtl(ui);
}

function mountAccess(locale: 'en' | 'ar' = 'en', over: Record<string, unknown> = {}) {
  const ui = accessTree(locale, over);
  return locale === 'en' ? renderLtr(ui) : renderRtl(ui);
}

/** The access page as `mountAccess` renders it, for a re-render with newer props. */
function accessTree(locale: 'en' | 'ar', over: Record<string, unknown> = {}): ReactElement {
  return withMui(
    inBranch(
      <>
        <UserAccessScreen
          locale={locale}
          messages={locale === 'en' ? en : ar}
          user={USER}
          grants={[GRANT]}
          roles={[ROLE]}
          companies={[COMPANY]}
          branches={[NORTH, SOUTH]}
          departmentNames={{}}
          canManageGrants
          canManageUser
          canReadRoles
          canReadDepartments={false}
          {...over}
        />
        <UnsavedProbe />
      </>,
      { locale }
    ),
    locale
  );
}

/** A write the API refused as a stale version — `ERR-CON-001`. */
const STALE = {
  ok: false as const,
  kind: 'conflict' as const,
  status: 409,
  problem: {
    type: 'urn:rootlco:error:ERR-CON-001',
    title: 'Conflict',
    status: 409,
    code: 'ERR-CON-001',
    correlationId: 'corr-stale',
  },
  correlationId: 'corr-stale',
};

/** An address that already has an account in this workspace — `ERR-RES-002`. */
const DUPLICATE = {
  ok: false as const,
  kind: 'conflict' as const,
  status: 409,
  problem: {
    type: 'urn:rootlco:error:ERR-RES-002',
    title: 'Conflict',
    status: 409,
    code: 'ERR-RES-002',
    correlationId: 'corr-duplicate',
  },
  correlationId: 'corr-duplicate',
};

/** A write whose answer is held until the case releases it. */
function heldSend() {
  let answer: (value: unknown) => void = () => undefined;
  send.mockReturnValue(
    new Promise((resolve) => {
      answer = resolve;
    })
  );
  return (value: unknown) => answer(value);
}

describe('the users list is the operational grid (P1-32-PRE-OD-ADM3)', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`names the grid and each row's actions with the person, and offers only legal changes (${locale})`, async () => {
      const C = CATALOGUE[locale];
      get.mockResolvedValue(page([USER, LOCKED, ARCHIVED]));
      mountUsers(locale);

      const grid = await screen.findByRole('grid', { name: C('users.title') });
      expect(
        await within(grid).findByRole('link', {
          name: `${C('users.action.access')} ${USER.displayName}`,
        })
      ).toBeInTheDocument();
      expect(document.documentElement.dir).toBe(locale === 'ar' ? 'rtl' : 'ltr');
      expect(
        within(grid).getByRole('columnheader', { name: C('users.column.status') })
      ).toBeInTheDocument();

      // Every row leads to the person's own page, named with the person.
      expect(
        within(grid).getByRole('link', { name: `${C('users.action.access')} ${USER.displayName}` })
      ).toHaveAttribute('href', `/${locale}/administration/users/${USER.id}`);
      // Active: suspension and archive. Locked: reactivation and archive.
      expect(
        within(grid).getByRole('button', { name: `${C('users.action.lock')} ${USER.displayName}` })
      ).toBeInTheDocument();
      expect(
        within(grid).getByRole('button', {
          name: `${C('users.action.unlock')} ${LOCKED.displayName}`,
        })
      ).toBeInTheDocument();
      expect(
        within(grid).queryByRole('button', {
          name: `${C('users.action.lock')} ${LOCKED.displayName}`,
        })
      ).toBeNull();
      // Archived is terminal: the way to the access page and nothing else.
      expect(
        within(grid).getByRole('link', {
          name: `${C('users.action.access')} ${ARCHIVED.displayName}`,
        })
      ).toBeInTheDocument();
      for (const kind of ['lock', 'unlock', 'archive', 'revokeSessions'] as const) {
        expect(
          within(grid).queryByRole('button', {
            name: `${C(`users.action.${kind}`)} ${ARCHIVED.displayName}`,
          })
        ).toBeNull();
      }
    });
  }

  it('sends the search term and the chosen status to the server, and neither to the address', async () => {
    get.mockResolvedValue(page([USER]));
    const user = userEvent.setup();
    mountUsers('en');
    await screen.findByRole('grid', { name: EN('users.title') });

    const toolbar = screen.getByTestId('users-toolbar');
    await user.type(
      within(toolbar).getByLabelText(new RegExp(`^${EN('users.searchLabel')}`)),
      'Work'
    );
    await waitFor(() =>
      expect(get.mock.calls.some(([path]) => String(path).includes('search=Work'))).toBe(true)
    );
    await user.selectOptions(
      within(toolbar).getByLabelText(new RegExp(`^${EN('users.filter.status')}`)),
      'locked'
    );
    await waitFor(() =>
      expect(get.mock.calls.some(([path]) => String(path).includes('status=locked'))).toBe(true)
    );
    expect(window.location.search).toBe('');
  });

  it('draws a refused read as a refusal, never as an empty list', async () => {
    get.mockResolvedValue({
      ok: false,
      kind: 'forbidden',
      status: 403,
      correlationId: 'corr-denied',
    });
    mountUsers('en');
    expect(await screen.findByText(EN('state.denied.title'))).toBeInTheDocument();
    expect(screen.queryByText(EN('state.empty.title'))).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('says nothing exists yet for a workspace with no accounts', async () => {
    get.mockResolvedValue(page([]));
    mountUsers('en');
    expect(await screen.findByText(EN('state.empty.title'))).toBeInTheDocument();
  });

  it('offers no account change and no invitation without the manage code', async () => {
    get.mockResolvedValue(page([USER, LOCKED]));
    mountUsers('en', { canManage: false });
    const grid = await screen.findByRole('grid', { name: EN('users.title') });
    await within(grid).findAllByText(USER.displayName);
    expect(
      within(grid).getByRole('link', { name: `${EN('users.action.access')} ${USER.displayName}` })
    ).toBeInTheDocument();
    expect(within(grid).queryAllByRole('button', { name: new RegExp(USER.displayName) })).toEqual(
      []
    );
    expect(screen.queryByRole('button', { name: EN('users.invite') })).toBeNull();
  });

  it('reactivates a locked account with a written reason, as today (VL-P132-001 stays open)', async () => {
    get.mockResolvedValue(page([LOCKED]));
    send.mockResolvedValue({
      ok: true,
      status: 200,
      data: { status: 'active' },
      correlationId: 'c',
    });
    const user = userEvent.setup();
    mountUsers('en');

    await user.click(
      await screen.findByRole('button', {
        name: `${EN('users.action.unlock')} ${LOCKED.displayName}`,
      })
    );
    const dialog = await screen.findByRole('alertdialog', { name: EN('users.confirm.unlock') });
    expect(dialog).toHaveAccessibleDescription(
      `${LOCKED.displayName} — ${EN('users.confirm.unlockBody')}`
    );
    await user.type(within(dialog).getByRole('textbox'), 'Back from leave');
    await user.click(within(dialog).getByRole('button', { name: EN('users.action.unlock') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'POST',
      `/api/v1/iam/users/${LOCKED.id}/status`,
      { status: 'active', reason: 'Back from leave' },
      {}
    );
  });

  it('sends one suspension when the confirmation is pressed twice inside one frame', async () => {
    get.mockResolvedValue(page([USER]));
    const release = heldSend();
    const user = userEvent.setup();
    mountUsers('en');

    await user.click(
      await screen.findByRole('button', { name: `${EN('users.action.lock')} ${USER.displayName}` })
    );
    const dialog = await screen.findByRole('alertdialog', { name: EN('users.confirm.lock') });
    await user.type(within(dialog).getByRole('textbox'), 'Suspended pending review');
    const press = within(dialog).getByRole('button', { name: EN('users.action.lock') });
    act(() => {
      press.click();
      press.click();
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    release({ ok: true, status: 200, data: { status: 'locked' }, correlationId: 'c' });
    await waitFor(() =>
      expect(screen.queryByRole('alertdialog', { name: EN('users.confirm.lock') })).toBeNull()
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('counts a typed reason as unsaved work while the confirmation is open', async () => {
    get.mockResolvedValue(page([USER]));
    const user = userEvent.setup();
    mountUsers('en');
    await user.click(
      await screen.findByRole('button', {
        name: `${EN('users.action.archive')} ${USER.displayName}`,
      })
    );
    const dialog = await screen.findByRole('alertdialog', { name: EN('users.confirm.archive') });
    expect(await unsavedNow()).toBe('false');
    await user.type(within(dialog).getByRole('textbox'), 'Left the company');
    expect(await unsavedNow()).toBe('true');
  });
});

describe('inviting a user (P1-32-PRE-OD-ADM3)', () => {
  async function openInvite(user: ReturnType<typeof userEvent.setup>, locale: 'en' | 'ar' = 'en') {
    const C = CATALOGUE[locale];
    get.mockResolvedValue(page([USER]));
    mountUsers(locale);
    await user.click(await screen.findByRole('button', { name: C('users.invite') }));
    return screen.findByRole('dialog', { name: C('users.invite.title') });
  }

  for (const locale of ['en', 'ar'] as const) {
    it(`refuses a missing address and name on their own boxes and sends nothing (${locale})`, async () => {
      const C = CATALOGUE[locale];
      const user = userEvent.setup();
      const dialog = await openInvite(user, locale);
      await user.click(within(dialog).getByRole('button', { name: C('users.invite.submit') }));

      const email = within(dialog).getByLabelText(new RegExp(`^${C('users.invite.email')}`));
      const name = within(dialog).getByLabelText(new RegExp(`^${C('users.invite.displayName')}`));
      await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'));
      expect(name).toHaveAttribute('aria-invalid', 'true');
      expect(email).toHaveAccessibleErrorMessage(said(C('field.required')));
      // The cursor goes to the first box to fix.
      await waitFor(() => expect(email).toHaveFocus());
      expect(send).not.toHaveBeenCalled();
    });
  }

  it('sends the address, the name, the two-factor requirement and the chosen roles', async () => {
    send.mockResolvedValue({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    const user = userEvent.setup();
    const dialog = await openInvite(user);
    await user.type(within(dialog).getByLabelText(/^Email address/), 'new.person@example.test');
    await user.type(within(dialog).getByLabelText(/^Display name/), 'New Person');
    await user.click(within(dialog).getByLabelText(EN('users.invite.mfaRequired')));
    await user.click(within(dialog).getByLabelText('Supervisor'));
    await user.click(within(dialog).getByRole('button', { name: EN('users.invite.submit') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/iam/invitations', {
      email: 'new.person@example.test',
      displayName: 'New Person',
      mfaRequired: true,
      roleIds: [ROLE.id],
    });
    expect(await within(dialog).findByText(EN('users.invite.done'))).toBeInTheDocument();
    expect(await unsavedNow()).toBe('false');
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`says a duplicate address on the address box and keeps every entry (${locale})`, async () => {
      const C = CATALOGUE[locale];
      send.mockResolvedValue(DUPLICATE);
      const user = userEvent.setup();
      const dialog = await openInvite(user, locale);
      const email = within(dialog).getByLabelText(new RegExp(`^${C('users.invite.email')}`));
      await user.type(email, 'supervisor@example.test');
      await user.type(
        within(dialog).getByLabelText(new RegExp(`^${C('users.invite.displayName')}`)),
        'Workshop Supervisor'
      );
      const mfa = within(dialog).getByLabelText(C('users.invite.mfaRequired'));
      await user.click(mfa);
      await user.click(within(dialog).getByRole('button', { name: C('users.invite.submit') }));

      await waitFor(() =>
        expect(email).toHaveAccessibleErrorMessage(said(C('users.invite.duplicate')))
      );
      expect(email).toHaveValue('supervisor@example.test');
      expect(mfa).toBeChecked();
      expect(await unsavedNow()).toBe('true');
    });
  }

  for (const locale of ['en', 'ar'] as const) {
    it(`sends the invitation on Enter in the address or the name box, once (${locale})`, async () => {
      const C = CATALOGUE[locale];
      const release = heldSend();
      const user = userEvent.setup();
      const dialog = await openInvite(user, locale);
      const email = within(dialog).getByLabelText(new RegExp(`^${C('users.invite.email')}`));
      const name = within(dialog).getByLabelText(new RegExp(`^${C('users.invite.displayName')}`));

      // Enter in the address box reaches the same send as the button: with the
      // name still empty, the refusal is said on the name box and nothing goes.
      await user.type(email, 'new.person@example.test{Enter}');
      await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
      expect(name).toHaveAccessibleErrorMessage(said(C('field.required')));
      expect(send).not.toHaveBeenCalled();

      // Enter in the name box sends it; a second Enter while the answer is
      // awaited sends nothing more.
      await user.type(name, 'New Person{Enter}');
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith(
        'POST',
        '/api/v1/iam/invitations',
        expect.objectContaining({
          email: 'new.person@example.test',
          displayName: 'New Person',
          mfaRequired: false,
        })
      );
      await user.keyboard('{Enter}');
      release({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
      expect(await within(dialog).findByText(C('users.invite.done'))).toBeInTheDocument();
      expect(send).toHaveBeenCalledTimes(1);
    });
  }

  it('sends one invitation when Send is pressed twice inside one frame', async () => {
    const release = heldSend();
    const user = userEvent.setup();
    const dialog = await openInvite(user);
    await user.type(within(dialog).getByLabelText(/^Email address/), 'new.person@example.test');
    await user.type(within(dialog).getByLabelText(/^Display name/), 'New Person');
    const press = within(dialog).getByRole('button', { name: EN('users.invite.submit') });
    act(() => {
      press.click();
      press.click();
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    release({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    expect(await within(dialog).findByText(EN('users.invite.done'))).toBeInTheDocument();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('counts every entry of the invitation as unsaved work', async () => {
    const user = userEvent.setup();
    const dialog = await openInvite(user);
    expect(await unsavedNow()).toBe('false');

    const email = within(dialog).getByLabelText(/^Email address/);
    await user.type(email, 'a');
    expect(await unsavedNow()).toBe('true');
    await user.clear(email);
    expect(await unsavedNow()).toBe('false');

    const name = within(dialog).getByLabelText(/^Display name/);
    await user.type(name, 'a');
    expect(await unsavedNow()).toBe('true');
    await user.clear(name);

    const mfa = within(dialog).getByLabelText(EN('users.invite.mfaRequired'));
    await user.click(mfa);
    expect(await unsavedNow()).toBe('true');
    await user.click(mfa);
    expect(await unsavedNow()).toBe('false');

    await user.click(within(dialog).getByLabelText('Supervisor'));
    expect(await unsavedNow()).toBe('true');
  });
});

describe('editing the account’s own details — iam.user-update (P1-32-PRE-OD-ADM3)', () => {
  const editButton = (C: (key: string) => string) =>
    screen.getByRole('button', { name: `${C('users.edit.open')}: ${USER.displayName}` });

  it('is offered only with the manage code', () => {
    mountAccess('en', { canManageUser: false });
    expect(
      screen.queryByRole('button', { name: `${EN('users.edit.open')}: ${USER.displayName}` })
    ).toBeNull();
    // The requirement is still said, as a sentence.
    expect(screen.getByText(EN('users.detail.mfaNotRequired'))).toBeInTheDocument();
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`sends only what changed, with the displayed version as If-Match (${locale})`, async () => {
      const C = CATALOGUE[locale];
      send.mockResolvedValue({ ok: true, status: 200, data: { ...USER }, correlationId: 'c' });
      const user = userEvent.setup();
      mountAccess(locale);
      await user.click(editButton(C));
      const dialog = await screen.findByRole('dialog', { name: C('users.edit.title') });
      const name = within(dialog).getByLabelText(new RegExp(`^${C('users.edit.displayName')}`));
      expect(name).toHaveValue(USER.displayName);
      await user.clear(name);
      await user.type(name, 'Senior Supervisor');
      await user.click(within(dialog).getByRole('button', { name: C('users.edit.save') }));

      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith(
        'PATCH',
        `/api/v1/iam/users/${USER.id}`,
        { displayName: 'Senior Supervisor' },
        { ifMatch: USER.recordVersion }
      );
      await waitFor(() => expect(refresh).toHaveBeenCalled());
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: C('users.edit.title') })).toBeNull()
      );
    });

    it(`refuses an empty name on its box and sends nothing (${locale})`, async () => {
      const C = CATALOGUE[locale];
      const user = userEvent.setup();
      mountAccess(locale);
      await user.click(editButton(C));
      const dialog = await screen.findByRole('dialog', { name: C('users.edit.title') });
      const name = within(dialog).getByLabelText(new RegExp(`^${C('users.edit.displayName')}`));
      await user.clear(name);
      await user.click(within(dialog).getByRole('button', { name: C('users.edit.save') }));
      await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
      expect(name).toHaveAccessibleErrorMessage(said(C('field.required')));
      expect(send).not.toHaveBeenCalled();
    });

    it(`keeps what was typed through a conflict and offers the latest version (${locale})`, async () => {
      const C = CATALOGUE[locale];
      send.mockResolvedValue(STALE);
      const user = userEvent.setup();
      const view = mountAccess(locale);
      await user.click(editButton(C));
      const dialog = await screen.findByRole('dialog', { name: C('users.edit.title') });
      const name = within(dialog).getByLabelText(new RegExp(`^${C('users.edit.displayName')}`));
      await user.clear(name);
      await user.type(name, 'Senior Supervisor');
      await user.click(within(dialog).getByRole('button', { name: C('users.edit.save') }));

      expect(await within(dialog).findByRole('alert')).toHaveTextContent(C('users.edit.conflict'));
      expect(name).toHaveValue('Senior Supervisor');
      expect(refresh).not.toHaveBeenCalled();
      expect(send).toHaveBeenLastCalledWith(
        'PATCH',
        `/api/v1/iam/users/${USER.id}`,
        { displayName: 'Senior Supervisor' },
        { ifMatch: USER.recordVersion }
      );

      await user.click(within(dialog).getByRole('button', { name: C('form.loadLatest') }));
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(name).toHaveValue(USER.displayName);

      // The page is read again: the newer details and version arrive, the clean
      // form follows them, and the next save is held against the NEW version.
      const NEWER: UserRow = {
        ...USER,
        displayName: 'Workshop Lead',
        recordVersion: USER.recordVersion + 1,
      };
      view.rerender(accessTree(locale, { user: NEWER }));
      const latest = within(
        screen.getByRole('dialog', { name: C('users.edit.title') })
      ).getByLabelText(new RegExp(`^${C('users.edit.displayName')}`));
      await waitFor(() => expect(latest).toHaveValue(NEWER.displayName));
      expect(within(dialog).queryByRole('alert')).toBeNull();

      send.mockResolvedValue({ ok: true, status: 200, data: { ...NEWER }, correlationId: 'c' });
      await user.clear(latest);
      await user.type(latest, 'Senior Supervisor');
      await user.click(within(dialog).getByRole('button', { name: C('users.edit.save') }));

      await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
      expect(send).toHaveBeenLastCalledWith(
        'PATCH',
        `/api/v1/iam/users/${USER.id}`,
        { displayName: 'Senior Supervisor' },
        { ifMatch: NEWER.recordVersion }
      );
      await waitFor(() =>
        expect(screen.queryByRole('dialog', { name: C('users.edit.title') })).toBeNull()
      );
    });
  }

  it('turns the two-factor requirement on alone, and sends only that', async () => {
    send.mockResolvedValue({ ok: true, status: 200, data: { ...USER }, correlationId: 'c' });
    const user = userEvent.setup();
    mountAccess('en');
    await user.click(editButton(EN));
    const dialog = await screen.findByRole('dialog', { name: EN('users.edit.title') });
    await user.click(within(dialog).getByLabelText(new RegExp(`^${EN('users.edit.mfaRequired')}`)));
    await user.click(within(dialog).getByRole('button', { name: EN('users.edit.save') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/iam/users/${USER.id}`,
      { mfaRequired: true },
      { ifMatch: USER.recordVersion }
    );
  });

  it('says nothing has changed, and sends nothing', async () => {
    const user = userEvent.setup();
    mountAccess('en');
    await user.click(editButton(EN));
    const dialog = await screen.findByRole('dialog', { name: EN('users.edit.title') });
    await user.click(within(dialog).getByRole('button', { name: EN('users.edit.save') }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(EN('users.edit.unchanged'));
    expect(send).not.toHaveBeenCalled();
  });

  it('sends one update when Save is pressed twice inside one frame', async () => {
    const release = heldSend();
    const user = userEvent.setup();
    mountAccess('en');
    await user.click(editButton(EN));
    const dialog = await screen.findByRole('dialog', { name: EN('users.edit.title') });
    await user.type(within(dialog).getByLabelText(/^Display name/), ' Lead');
    const press = within(dialog).getByRole('button', { name: EN('users.edit.save') });
    act(() => {
      press.click();
      press.click();
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    release({ ok: true, status: 200, data: { ...USER }, correlationId: 'c' });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('counts both entries as unsaved work, and returns the cursor to Edit when closed', async () => {
    const user = userEvent.setup();
    mountAccess('en');
    await user.click(editButton(EN));
    const dialog = await screen.findByRole('dialog', { name: EN('users.edit.title') });
    expect(await unsavedNow()).toBe('false');
    const name = within(dialog).getByLabelText(/^Display name/);
    await user.type(name, 'x');
    expect(await unsavedNow()).toBe('true');
    await user.type(name, '{Backspace}');
    expect(await unsavedNow()).toBe('false');
    const mfa = within(dialog).getByLabelText(new RegExp(`^${EN('users.edit.mfaRequired')}`));
    await user.click(mfa);
    expect(await unsavedNow()).toBe('true');

    await user.click(within(dialog).getByRole('button', { name: EN('overlay.cancel') }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: EN('users.edit.title') })).toBeNull()
    );
    await waitFor(() => expect(editButton(EN)).toHaveFocus());
  });
});

describe('a grant cannot reach across companies by what it sends (P1-32-PRE-OD-ADM3)', () => {
  it('sends a department place with the company and branch that own it', async () => {
    const DEPARTMENT = {
      id: 'a0000000-0000-4000-8000-00000000000a',
      companyId: COMPANY.id,
      branchId: NORTH.id,
      departmentCode: 'body_shop',
      name: 'Body shop',
      status: 'active',
      recordVersion: 1,
    };
    get.mockImplementation(async (path: string) =>
      String(path).startsWith('/api/v1/org/departments')
        ? { ok: true, status: 200, data: { items: [DEPARTMENT] }, correlationId: 'c' }
        : { ok: true, status: 200, data: { items: [], nextCursor: null }, correlationId: 'c' }
    );
    send.mockResolvedValue({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    const user = userEvent.setup();
    mountAccess('en', { grants: [], canReadDepartments: true });

    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = scopeDialog(EN('users.access.grant'));
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), ROLE.id);
    await user.click(within(dialog).getByRole('radio', { name: /^Selected departments/ }));
    await user.selectOptions(
      within(dialog).getByLabelText(new RegExp(`^${EN('admin.scope.branch')}`)),
      NORTH.id
    );
    await user.click(await within(dialog).findByLabelText('Body shop'));
    await user.click(within(dialog).getByRole('button', { name: EN('users.access.grant') }));

    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/iam/grants', {
      userId: USER.id,
      roleId: ROLE.id,
      scopes: [
        {
          scopeType: 'department',
          companyId: COMPANY.id,
          branchId: NORTH.id,
          departmentId: DEPARTMENT.id,
        },
      ],
    });
  });

  it('counts the role and where it applies as unsaved work', async () => {
    const user = userEvent.setup();
    mountAccess('en', { grants: [] });
    await user.click(screen.getByRole('button', { name: EN('users.access.grant') }));
    const dialog = scopeDialog(EN('users.access.grant'));
    expect(await unsavedNow()).toBe('false');
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), ROLE.id);
    expect(await unsavedNow()).toBe('true');
    await user.selectOptions(within(dialog).getByLabelText(/^Role/), '');
    expect(await unsavedNow()).toBe('false');
    await user.click(within(dialog).getByRole('radio', { name: /^Selected branches/ }));
    expect(await unsavedNow()).toBe('true');
    await user.click(within(dialog).getByRole('radio', { name: /^Whole organisation/ }));
    expect(await unsavedNow()).toBe('false');
    await user.click(within(dialog).getByRole('radio', { name: /^Selected branches/ }));
    await user.click(within(dialog).getByLabelText(/^North Branch/));
    expect(await unsavedNow()).toBe('true');
  });
});

/*
 * ---------------------------------------------------------------------------
 * `/administration/permissions` and `/administration/approval-limits` on
 * Material UI (`P1-32-PRE-OD-ADM4`).
 *
 * The permission screen changes an existing mapping between allow and deny
 * through `iam.role-permission-update` — which had no caller before this slice —
 * with the mapping's version as `If-Match`; the approval-limit list names the
 * person and the role from the list's own answer (route checklist prerequisite
 * 9) and says a withheld name in words; the service's refusal of a limit for
 * yourself is said as that refusal; and every write is one act.
 * ---------------------------------------------------------------------------
 */

const PERMISSION_ROLE = {
  id: ROLE.id,
  roleCode: ROLE.roleCode,
  name: ROLE.name,
  description: null,
  isSystem: false,
  recordVersion: 1,
};
const CATALOGUE_ITEMS = [
  {
    id: 'p-1',
    code: 'wo.work-order.read',
    domain: 'wo',
    riskLevel: 'low',
    description: 'See work orders',
  },
  {
    id: 'p-2',
    code: 'wo.work-order.manage',
    domain: 'wo',
    riskLevel: 'medium',
    description: 'Change work orders',
  },
];
const MAPPING = {
  id: '90000000-0000-4000-8000-0000000000a1',
  permissionCode: 'wo.work-order.read',
  effect: 'allow' as const,
  recordVersion: 3,
};

function answerPermissionReads(
  mappings: unknown = { ok: true, status: 200, data: { items: [MAPPING] }, correlationId: 'm' }
) {
  get.mockImplementation(async (path: string) =>
    path === '/api/v1/iam/permissions'
      ? { ok: true, status: 200, data: { items: CATALOGUE_ITEMS }, correlationId: 'p' }
      : mappings
  );
}

function mountPermissions(locale: 'en' | 'ar' = 'en') {
  const ui = withMui(
    inBranch(
      <PermissionsScreen
        messages={locale === 'en' ? en : ar}
        locale={locale}
        roles={[PERMISSION_ROLE]}
        canManage
      />,
      { locale }
    ),
    locale
  );
  return locale === 'en' ? renderLtr(ui) : renderRtl(ui);
}

describe('changing a permission mapping between allow and deny (iam.role-permission-update)', () => {
  for (const locale of ['en', 'ar'] as const) {
    it(`sends the other effect with the mapping version as If-Match, then reads again (${locale})`, async () => {
      const C = CATALOGUE[locale];
      answerPermissionReads();
      send.mockResolvedValue({
        ok: true,
        status: 200,
        data: { status: 'updated' },
        correlationId: 'c',
      });
      const user = userEvent.setup();
      mountPermissions(locale);
      const change = await screen.findByRole('button', {
        name: `${C('permissions.setDeny')}: wo.work-order.read`,
      });
      const readsBefore = get.mock.calls.length;
      await user.click(change);
      await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
      expect(send).toHaveBeenCalledWith(
        'PATCH',
        `/api/v1/iam/roles/${ROLE.id}/permissions/${MAPPING.id}`,
        { effect: 'deny' },
        { ifMatch: 3 }
      );
      await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(readsBefore));
      // An unmapped permission is offered a mapping, not a change.
      expect(
        screen.queryByRole('button', {
          name: `${C('permissions.setAllow')}: wo.work-order.manage`,
        })
      ).toBeNull();
      expect(
        await screen.findByRole('button', {
          name: `${C('permissions.effect.allow')}: wo.work-order.manage`,
        })
      ).toBeVisible();
    });
  }

  it('sends one change when it is pressed twice inside one frame', async () => {
    answerPermissionReads();
    const release = heldSend();
    mountPermissions();
    const change = await screen.findByRole('button', {
      name: `${EN('permissions.setDeny')}: wo.work-order.read`,
    });
    act(() => {
      change.click();
      change.click();
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    release({ ok: true, status: 200, data: { status: 'updated' }, correlationId: 'c' });
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(2));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('says a stale mapping is a conflict and loads the latest on request', async () => {
    answerPermissionReads();
    send.mockResolvedValue(STALE);
    const user = userEvent.setup();
    mountPermissions();
    await user.click(
      await screen.findByRole('button', {
        name: `${EN('permissions.setDeny')}: wo.work-order.read`,
      })
    );
    expect(await screen.findByText(EN('state.conflict.title'))).toBeVisible();
    const readsBefore = get.mock.calls.length;
    await user.click(screen.getByRole('button', { name: EN('form.loadLatest') }));
    await waitFor(() => expect(get.mock.calls.length).toBeGreaterThan(readsBefore));
  });

  it('draws a refused mapping read as a refusal, never as a role that holds nothing', async () => {
    answerPermissionReads({ ok: false, kind: 'forbidden', status: 403, correlationId: 'corr-map' });
    mountPermissions();
    expect(await screen.findByText(EN('state.denied.title'))).toBeVisible();
    expect(screen.getByText('corr-map')).toBeVisible();
    expect(screen.queryByText(EN('permissions.effect.unset'))).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: `${EN('permissions.effect.allow')}: wo.work-order.read`,
      })
    ).toBeNull();
  });
});

describe('approval limits name their subject from the list (route checklist prerequisite 9)', () => {
  const PERSON_ID = '0b3d8c05-228a-406c-8c4c-b9df5b3f8459';
  const OTHER_ROLE_ID = '70000000-0000-4000-8000-0000000000be';
  const row = (over: Record<string, unknown>) => ({
    id: `limit-${String(over['userId'] ?? over['roleId'])}`,
    companyId: 'company-1',
    roleId: null,
    userId: null,
    limitType: 'discount',
    amount: '250.0000',
    currencyCode: 'JOD',
    effectiveFrom: '2026-10-01',
    effectiveTo: null,
    recordVersion: 2,
    ...over,
  });
  const list = (items: readonly unknown[]) => ({
    ok: true,
    status: 200,
    data: { items, nextCursor: null },
    correlationId: 'corr-limits',
  });
  function mountLimits(locale: 'en' | 'ar', canReadUsers: boolean) {
    const ui = withMui(
      inBranch(
        <ApprovalLimitsScreen
          locale={locale}
          messages={locale === 'en' ? en : ar}
          roles={[PERMISSION_ROLE]}
          canManage
          canReadUsers={canReadUsers}
        />,
        { locale }
      ),
      locale
    );
    return locale === 'en' ? renderLtr(ui) : renderRtl(ui);
  }

  for (const locale of ['en', 'ar'] as const) {
    it(`shows the names the list publishes, and reads no person one by one (${locale})`, async () => {
      get.mockResolvedValue(
        list([
          row({ userId: PERSON_ID, userDisplayName: 'Huda Mansour', roleName: null }),
          row({ roleId: OTHER_ROLE_ID, roleName: 'Night shift', userDisplayName: null }),
        ])
      );
      mountLimits(locale, true);
      expect(await screen.findByText('Huda Mansour')).toBeVisible();
      // A role this screen does not hold the code of is named by the list.
      expect(screen.getByText('Night shift')).toBeVisible();
      expect(document.body.textContent ?? '').not.toContain(PERSON_ID);
      expect(document.body.textContent ?? '').not.toContain(OTHER_ROLE_ID);
      expect(get.mock.calls.some(([path]) => String(path).startsWith('/api/v1/iam/users'))).toBe(
        false
      );
    });

    it(`says a withheld name is not available, in words, never the reference (${locale})`, async () => {
      const C = CATALOGUE[locale];
      get.mockResolvedValue(
        list([row({ userId: PERSON_ID, userDisplayName: null, roleName: null })])
      );
      mountLimits(locale, true);
      const sentence = await screen.findByText(C('approvalLimits.person.notAvailable'));
      expect(sentence).toBeVisible();
      if (locale === 'ar') expect(sentence.textContent ?? '').toMatch(/[؀-ۿ]/);
      expect(document.body.textContent ?? '').not.toContain(PERSON_ID);
    });
  }

  it('without the user read, says the caller may not see who it is', async () => {
    get.mockResolvedValue(
      list([row({ userId: PERSON_ID, userDisplayName: null, roleName: null })])
    );
    mountLimits('en', false);
    expect(await screen.findByText(EN('approvalLimits.person.denied'))).toBeVisible();
    expect(document.body.textContent ?? '').not.toContain(PERSON_ID);
  });

  it('ends a limit with the day chosen and the version the list showed', async () => {
    get.mockResolvedValue(list([row({ roleId: ROLE.id })]));
    send.mockResolvedValue({ ok: true, status: 200, data: { id: 'x' }, correlationId: 'c' });
    const user = userEvent.setup();
    mountLimits('en', true);
    await user.click(
      await screen.findByRole('button', {
        name: `${EN('approvalLimits.end')} ${ROLE.name}, ${EN('approvalLimits.type.discount')}`,
      })
    );
    const dialog = await screen.findByRole('dialog', { name: EN('approvalLimits.end.title') });
    // Nothing chosen: refused on the day, and nothing is sent.
    await user.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    expect(await within(dialog).findByText(EN('approvalLimits.error.date'))).toBeVisible();
    expect(send).not.toHaveBeenCalled();
    await typeDay(user, dialog, EN('approvalLimits.field.effectiveTo'), '2026-12-31');
    await user.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        'PATCH',
        `/api/v1/iam/approval-limits/limit-${ROLE.id}`,
        { effectiveTo: '2026-12-31' },
        { ifMatch: 2 }
      )
    );
  });
});

describe('an approval limit for yourself is refused as that, and the form is one act', () => {
  const ownLimit = {
    ok: false as const,
    kind: 'forbidden' as const,
    status: 403,
    problem: {
      type: 'urn:rootlco:error:ERR-IAM-001',
      title: 'Forbidden',
      status: 403,
      code: 'ERR-IAM-001',
      correlationId: 'corr-self',
      violations: [{ path: 'body', rule: 'approval_limit_for_yourself' }],
    },
    correlationId: 'corr-self',
  };

  async function fill(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement) {
    const field = (key: string) => within(dialog).getByLabelText(new RegExp(`^${EN(key)}`));
    await user.selectOptions(field('approvalLimits.field.subject'), 'user');
    await user.type(field('approvalLimits.field.userId'), USER.id);
    await user.selectOptions(field('approvalLimits.field.limitType'), 'credit_note');
    await user.type(field('approvalLimits.field.amount'), '75.500');
    await user.type(field('approvalLimits.field.currency'), 'JOD');
    await typeDay(user, dialog, EN('approvalLimits.field.effectiveFrom'), '2026-10-01');
  }

  function mountCreate() {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items: [], nextCursor: null },
      correlationId: 'corr-page',
    });
    renderLtr(
      withMui(
        inBranch(
          <ApprovalLimitsScreen locale="en" messages={en} roles={[PERMISSION_ROLE]} canManage />
        ),
        'en'
      )
    );
  }

  it('says the service refused a limit for yourself, keeps every entry, and offers no way around it', async () => {
    send.mockResolvedValue(ownLimit);
    const user = userEvent.setup();
    mountCreate();
    await user.click(await screen.findByRole('button', { name: EN('approvalLimits.create') }));
    const dialog = await screen.findByRole('dialog', { name: EN('approvalLimits.create.title') });
    await fill(user, dialog);
    await user.click(within(dialog).getByRole('button', { name: EN('admin.create') }));
    expect(
      await within(dialog).findByText(EN('form.violation.approval_limit_for_yourself'))
    ).toBeVisible();
    expect(within(dialog).queryByText(EN('state.denied.message'))).toBeNull();
    expect(
      within(dialog).getByLabelText(new RegExp(`^${EN('approvalLimits.field.amount')}`))
    ).toHaveValue('75.500');
    // No control on the form exempts anyone from the rule.
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });

  it('sends one limit when Create is pressed twice inside one frame, with the amount as typed', async () => {
    const release = heldSend();
    const user = userEvent.setup();
    mountCreate();
    await user.click(await screen.findByRole('button', { name: EN('approvalLimits.create') }));
    const dialog = await screen.findByRole('dialog', { name: EN('approvalLimits.create.title') });
    await fill(user, dialog);
    const press = within(dialog).getByRole('button', { name: EN('admin.create') });
    act(() => {
      press.click();
      press.click();
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    const [, path, body] = send.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(path).toBe('/api/v1/iam/approval-limits');
    expect(body).toMatchObject({
      limitType: 'credit_note',
      amount: '75.500',
      currency: 'JOD',
      userId: USER.id,
      roleId: null,
      effectiveFrom: '2026-10-01',
    });
    release({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: EN('approvalLimits.create.title') })).toBeNull()
    );
    expect(send).toHaveBeenCalledTimes(1);
  });
});

/**
 * Every write held until the case answers it, one answer per write, in order —
 * so "while the write is in flight" is a real wait, not a synchronous mock.
 */
function answeredOneByOne() {
  const waiting: ((value: unknown) => void)[] = [];
  send.mockImplementation(
    () =>
      new Promise((resolve) => {
        waiting.push(resolve);
      })
  );
  return (value: unknown) => {
    const next = waiting.shift();
    if (next === undefined) throw new Error('no write is waiting for an answer');
    next(value);
  };
}

/**
 * Lets an answer reach the dialog's submit handler and run it to its end
 * WITHOUT letting React draw the outcome: only promise jobs run here, and the
 * render the answer schedules is a later task. A key or a press now lands in
 * the moment between the answer and the dialog closing.
 */
async function answerHandledNotYetDrawn(): Promise<void> {
  for (let job = 0; job < 50; job += 1) await Promise.resolve();
}

/** The service could not be reached: the ordinary refusal a retry is for. */
const OUTAGE = {
  ok: false as const,
  kind: 'unavailable' as const,
  status: 503,
  problem: { code: 'ERR-SYS-001' },
  correlationId: 'corr-down',
};

describe('the invitation is sent once between the answer and the outcome (P1-32-PRE-OD-ADM4 review)', () => {
  async function openFilled(user: ReturnType<typeof userEvent.setup>) {
    get.mockResolvedValue(page([USER]));
    mountUsers('en');
    await user.click(await screen.findByRole('button', { name: EN('users.invite') }));
    const dialog = await screen.findByRole('dialog', { name: EN('users.invite.title') });
    await user.type(within(dialog).getByLabelText(/^Email address/), 'new.person@example.test');
    const name = within(dialog).getByLabelText(/^Display name/);
    await user.type(name, 'New Person');
    const press = within(dialog).getByRole('button', { name: EN('users.invite.submit') });
    return { dialog, name, press };
  }

  it('sends no second invitation for Enter while pending, nor for Enter or a press right after the answer', async () => {
    const answer = answeredOneByOne();
    const user = userEvent.setup();
    const { dialog, name, press } = await openFilled(user);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await user.keyboard('{Enter}{Enter}{Enter}');
    expect(send).toHaveBeenCalledTimes(1);

    answer({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    await answerHandledNotYetDrawn();
    // The answer is in; the form is still on screen, not yet the sentence.
    expect(name).toBeInTheDocument();
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.click(press);

    expect(await within(dialog).findByText(EN('users.invite.done'))).toBeInTheDocument();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a refused invitation can be sent again, by a press and by Enter', async () => {
    const answer = answeredOneByOne();
    const user = userEvent.setup();
    const { dialog, press } = await openFilled(user);
    await user.click(press);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    answer(OUTAGE);
    await waitFor(() => expect(press).toBeEnabled());

    await user.click(press);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    answer(OUTAGE);
    await waitFor(() => expect(press).toBeEnabled());

    await user.click(within(dialog).getByLabelText(/^Display name/));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
    answer({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    expect(await within(dialog).findByText(EN('users.invite.done'))).toBeInTheDocument();
    expect(send).toHaveBeenCalledTimes(3);
  });
});

describe('an approval limit is sent once, and Enter in a date submits (P1-32-PRE-OD-ADM4 review)', () => {
  const LIMIT = {
    id: `limit-${ROLE.id}`,
    companyId: 'company-1',
    roleId: ROLE.id,
    userId: null,
    limitType: 'discount',
    amount: '250.0000',
    currencyCode: 'JOD',
    effectiveFrom: '2026-10-01',
    effectiveTo: null,
    recordVersion: 2,
  };
  function mountLimits(items: readonly unknown[]) {
    get.mockResolvedValue({
      ok: true,
      status: 200,
      data: { items, nextCursor: null },
      correlationId: 'corr-limits',
    });
    renderLtr(
      withMui(
        inBranch(
          <ApprovalLimitsScreen locale="en" messages={en} roles={[PERMISSION_ROLE]} canManage />
        ),
        'en'
      )
    );
  }
  const dayPart = (dialog: HTMLElement, label: string) =>
    within(within(dialog).getByRole('group', { name: new RegExp(`^${label}`) })).getAllByRole(
      'spinbutton'
    )[0] as HTMLElement;

  async function openCreate(user: ReturnType<typeof userEvent.setup>) {
    mountLimits([]);
    await user.click(await screen.findByRole('button', { name: EN('approvalLimits.create') }));
    const dialog = await screen.findByRole('dialog', { name: EN('approvalLimits.create.title') });
    const field = (key: string) => within(dialog).getByLabelText(new RegExp(`^${EN(key)}`));
    await user.selectOptions(field('approvalLimits.field.subject'), 'user');
    await user.type(field('approvalLimits.field.userId'), USER.id);
    await user.selectOptions(field('approvalLimits.field.limitType'), 'credit_note');
    await user.type(field('approvalLimits.field.amount'), '75.500');
    await user.type(field('approvalLimits.field.currency'), 'JOD');
    await typeDay(user, dialog, EN('approvalLimits.field.effectiveFrom'), '2026-10-01');
    const press = within(dialog).getByRole('button', { name: EN('admin.create') });
    return { dialog, press };
  }

  it('create: Enter in a date part sends it; Enter while pending and right after the answer send nothing more', async () => {
    const answer = answeredOneByOne();
    const user = userEvent.setup();
    const { dialog, press } = await openCreate(user);
    const part = dayPart(dialog, EN('approvalLimits.field.effectiveFrom'));
    await user.click(part);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0]?.[2]).toMatchObject({
      amount: '75.500',
      effectiveFrom: '2026-10-01',
    });
    await user.keyboard('{Enter}{Enter}');
    expect(send).toHaveBeenCalledTimes(1);

    answer({ ok: true, status: 201, data: { id: 'x' }, correlationId: 'c' });
    await answerHandledNotYetDrawn();
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(part, { key: 'Enter' });
    fireEvent.click(press);

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: EN('approvalLimits.create.title') })).toBeNull()
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('create: a refused limit can be sent again, by a press and by Enter', async () => {
    const answer = answeredOneByOne();
    const user = userEvent.setup();
    const { dialog, press } = await openCreate(user);
    await user.click(press);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    answer(OUTAGE);
    await waitFor(() => expect(press).toBeEnabled());

    await user.click(press);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    answer(OUTAGE);
    await waitFor(() => expect(press).toBeEnabled());

    await user.click(
      within(dialog).getByLabelText(new RegExp(`^${EN('approvalLimits.field.currency')}`))
    );
    await user.keyboard('{Enter}');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  });

  async function openEnd(user: ReturnType<typeof userEvent.setup>) {
    mountLimits([LIMIT]);
    await user.click(
      await screen.findByRole('button', {
        name: `${EN('approvalLimits.end')} ${PERMISSION_ROLE.name}, ${EN('approvalLimits.type.discount')}`,
      })
    );
    const dialog = await screen.findByRole('dialog', { name: EN('approvalLimits.end.title') });
    await typeDay(user, dialog, EN('approvalLimits.field.effectiveTo'), '2026-12-31');
    const press = within(dialog).getByRole('button', { name: EN('admin.save') });
    return { dialog, press };
  }

  it('end: Enter in its only field sends it, once, and the button says it is saving meanwhile', async () => {
    const answer = answeredOneByOne();
    const user = userEvent.setup();
    const { dialog, press } = await openEnd(user);
    const part = dayPart(dialog, EN('approvalLimits.field.effectiveTo'));
    await user.click(part);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/iam/approval-limits/${LIMIT.id}`,
      { effectiveTo: '2026-12-31' },
      { ifMatch: 2 }
    );
    // Pending is real: the write is still awaited, the button is disabled and
    // neither Enter nor a press sends a second end.
    expect(press).toBeDisabled();
    expect(press).toHaveTextContent(EN('admin.saving'));
    await user.keyboard('{Enter}{Enter}');
    fireEvent.click(press);
    expect(send).toHaveBeenCalledTimes(1);

    answer({ ok: true, status: 200, data: { id: LIMIT.id }, correlationId: 'c' });
    await answerHandledNotYetDrawn();
    expect(dialog).toBeInTheDocument();
    fireEvent.keyDown(part, { key: 'Enter' });
    fireEvent.click(press);

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: EN('approvalLimits.end.title') })).toBeNull()
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('end: a refused end can be sent again, by a press and by Enter', async () => {
    const answer = answeredOneByOne();
    const user = userEvent.setup();
    const { dialog, press } = await openEnd(user);
    await user.click(press);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    answer(OUTAGE);
    await waitFor(() => expect(press).toBeEnabled());

    await user.click(press);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    answer(OUTAGE);
    await waitFor(() => expect(press).toBeEnabled());

    await user.click(dayPart(dialog, EN('approvalLimits.field.effectiveTo')));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  });
});
