import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
import { forgetRememberedBranch } from './support/branch-switch';

/**
 * Technician administration on the shared Material wrappers
 * (`P1-32-PRE-OD-ADM2B`), in English and in Arabic.
 *
 * The roster: it reads the branch the header names and nothing before one is
 * named; each row names its person, and says in words when the session may not
 * be told the name rather than printing a reference; the one published filter
 * travels as the route's `isActive`; adding a technician picks a person by
 * name, is refused on its own field when nobody is chosen, is sent once for two
 * presses, and says a refusal beside its buttons.
 *
 * The profile: every holding is named; the issue and expiry are days, and the
 * windows are on the branch's clock; each version-guarded change carries the
 * version the read published as `If-Match`; a stale one closes its form and
 * offers "Load the latest version"; a refusal stays in the form; the skill
 * picker is drawn from `tech.skill-list` and says so when that list cannot be
 * read; recording a new certification is not offered, and the sentence says
 * why; the certificate number is offered only with `iam.sensitive.view`; and no
 * write control is drawn without `tech.technician.manage`.
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

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A field by the start of its label (a required label carries a decorative mark). */
const field = (scope: HTMLElement, label: string) =>
  within(scope).getByLabelText(new RegExp(`^${escape(label)}`));

const send = vi.fn();
const get = vi.fn();
const push = vi.fn();
vi.mock('@/lib/api/server-client', () => ({ authorizedClient: async () => ({ send, get }) }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { TechnicianRosterScreen } =
  await import('@/features/technicians/components/TechnicianRosterScreen');
const { TechnicianProfileScreen } =
  await import('@/features/technicians/components/TechnicianProfileScreen');

const BRANCH = TEST_BRANCH;
/**
 * A second branch, so the header has a real choice: with one branch the working
 * context names it on arrival, and "nothing is read until a branch is named"
 * could not be shown.
 */
const SECOND = {
  ...TEST_BRANCH,
  id: '22222222-2222-4222-8222-222222222299',
  code: 'SECOND',
  name: 'Second workshop',
};
const TARGET = `companyId=${BRANCH.companyId}&branchId=${BRANCH.id}`;
const PROFILE_ID = '60000000-0000-4000-8000-000000000001';
const USER_ID = '50000000-0000-4000-8000-000000000001';
const SKILL_ID = '70000000-0000-4000-8000-000000000001';
const SKILL_TWO_ID = '70000000-0000-4000-8000-000000000002';
const LEVEL_ONE_ID = '71000000-0000-4000-8000-000000000001';
const LEVEL_TWO_ID = '71000000-0000-4000-8000-000000000002';
const CERT_ID = '72000000-0000-4000-8000-000000000001';
const WINDOW_ID = '73000000-0000-4000-8000-000000000001';
const WORK_ORDER_ID = '74000000-0000-4000-8000-000000000001';

const ENTRY = {
  id: PROFILE_ID,
  userId: USER_ID,
  companyId: BRANCH.companyId,
  branchId: BRANCH.id,
  trade: 'Mechanic',
  employmentRef: 'HR-12',
  isActive: true,
  recordVersion: 3,
  displayName: 'Fixture Technician',
};

const DETAIL = {
  profile: ENTRY,
  skills: [
    {
      skillId: SKILL_ID,
      skillCode: 'engine',
      skillName: 'Engine systems',
      skillLevelId: LEVEL_ONE_ID,
      skillLevelName: 'Level one',
      rank: 10,
    },
  ],
  certifications: [
    {
      certificationId: CERT_ID,
      certificationCode: 'ac_handling',
      certificationName: 'Air conditioning handling',
      issuedOnDay: '2026-05-04',
      expiresOn: '2027-05-04',
      certStatus: 'active',
      isSafetyCritical: false,
      recordVersion: 2,
    },
  ],
  availability: [
    {
      id: WINDOW_ID,
      // 06:00 UTC is 09:00 on the branch's clock (Asia/Riyadh, +03:00).
      availableFrom: '2026-11-02T06:00:00.000Z',
      availableTo: '2026-11-02T14:00:00.000Z',
      availabilityKind: 'unavailable',
      reason: 'Training',
      recordVersion: 4,
    },
  ],
};

const QUEUE = {
  technicianProfileId: PROFILE_ID,
  items: [
    {
      assignmentId: '75000000-0000-4000-8000-000000000001',
      jobId: '76000000-0000-4000-8000-000000000001',
      workOrderId: WORK_ORDER_ID,
      assignmentRole: 'primary',
      validFrom: '2026-11-01T07:00:00.000Z',
      jobTitle: 'Replace front pads',
      jobState: 'in_progress',
      workOrderState: 'in_progress',
      displayNumber: 'WO-0042',
    },
  ],
};

const CATALOGUE = {
  skills: [
    { id: SKILL_ID, code: 'engine', name: 'Engine systems', discipline: null },
    { id: SKILL_TWO_ID, code: 'brakes', name: 'Brake systems', discipline: 'Chassis' },
  ],
  skillLevels: [
    { id: LEVEL_TWO_ID, code: 'level_two', name: 'Level two', rank: 20 },
    { id: LEVEL_ONE_ID, code: 'level_one', name: 'Level one', rank: 10 },
  ],
};

const ok = (data: unknown, status = 200) => ({ ok: true, status, data, correlationId: 'c' });
const page = (items: readonly unknown[]) => ok({ items, nextCursor: null, hasMore: false });
const refused = {
  ok: false,
  kind: 'forbidden',
  status: 403,
  problem: { code: 'ERR-IAM-001' },
  correlationId: 'corr-denied',
};
const stale = {
  ok: false,
  kind: 'conflict',
  status: 409,
  problem: { code: 'ERR-CON-001' },
  correlationId: 'corr-stale',
};
const missing = {
  ok: false,
  kind: 'not-found',
  status: 404,
  problem: { code: 'ERR-RES-001' },
  correlationId: 'corr-missing',
};
const violation = (path: string, rule: string) => ({
  ok: false,
  kind: 'validation',
  status: 422,
  problem: { code: 'ERR-VAL-001', violations: [{ path, rule }] },
  correlationId: 'corr-invalid',
});

/** Answers every read the profile makes, with the overrides a case needs. */
function serveProfile(
  overrides: {
    readonly detail?: unknown;
    readonly queue?: unknown;
    readonly catalogue?: unknown;
  } = {}
) {
  get.mockImplementation(async (path: string) => {
    if (path === '/api/v1/technician-skills') return overrides.catalogue ?? ok(CATALOGUE);
    if (path === `/api/v1/technicians/${PROFILE_ID}/queue`) return overrides.queue ?? ok(QUEUE);
    if (path === `/api/v1/technicians/${PROFILE_ID}`) return overrides.detail ?? ok(DETAIL);
    return missing;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  get.mockReset();
  send.mockReset();
  window.localStorage.clear();
  __resetNotificationsForTests();
});
afterEach(forgetRememberedBranch);

function mount(ui: ReactElement, locale: 'en' | 'ar' = 'en') {
  const tree = (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {inBranch(
        <>
          <BranchSwitch to={BRANCH.id} label="first" />
          <BranchSwitch to="all" label="everywhere" />
          {ui}
        </>,
        { locale, snapshot: branchSnapshot([BRANCH, SECOND]) }
      )}
    </UiFoundationProvider>
  );
  return locale === 'en' ? renderLtr(tree) : renderRtl(tree);
}

function roster(
  locale: 'en' | 'ar' = 'en',
  { canManage = true, canReadUsers = true } = {}
): ReactElement {
  return (
    <TechnicianRosterScreen
      messages={locale === 'en' ? en : ar}
      locale={locale}
      canManage={canManage}
      canReadUsers={canReadUsers}
    />
  );
}

function profile(
  locale: 'en' | 'ar' = 'en',
  { canManage = true, canRecordSensitive = false } = {}
): ReactElement {
  return (
    <TechnicianProfileScreen
      messages={locale === 'en' ? en : ar}
      locale={locale}
      technicianProfileId={PROFILE_ID}
      canManage={canManage}
      canRecordSensitive={canRecordSensitive}
    />
  );
}

describe.each(['en', 'ar'] as const)('the technician roster (%s)', (locale) => {
  const T = words(locale);

  it('reads the named branch and names each technician', async () => {
    get.mockResolvedValue(page([ENTRY]));
    const u = userEvent.setup();
    mount(roster(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByText('Fixture Technician', { selector: 'bdi' })).toBeVisible();
    expect(get).toHaveBeenCalledWith(`/api/v1/technicians?${TARGET}&limit=25`);
    expect(screen.getByRole('columnheader', { name: T('technicians.roster.name') })).toBeVisible();
    expect(
      screen.getByRole('gridcell', { name: T('technicians.roster.state.active') })
    ).toBeVisible();
    // The way into the profile names the person it opens.
    const open = screen.getByRole('link', {
      name: `${T('technicians.roster.open')} Fixture Technician`,
    });
    expect(open).toHaveAttribute('href', `/${locale}/technicians/${PROFILE_ID}`);
    // No reference is printed for the person.
    expect(screen.queryByText(USER_ID)).toBeNull();
    if (locale === 'ar') expect(document.documentElement.dir).toBe('rtl');
  });

  it('says in words that a name is not shown, and prints no reference in its place', async () => {
    get.mockResolvedValue(page([{ ...ENTRY, displayName: null }]));
    const u = userEvent.setup();
    mount(roster(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(
      await screen.findByRole('gridcell', { name: T('technicians.roster.nameWithheld') })
    ).toBeVisible();
    expect(screen.queryByText(USER_ID)).toBeNull();
    expect(
      screen.getByRole('link', {
        name: `${T('technicians.roster.open')} ${T('technicians.roster.nameWithheld')}`,
      })
    ).toBeVisible();
  });

  it('says an empty roster invites the first technician, and a refusal is never an empty roster', async () => {
    get.mockResolvedValueOnce(page([]));
    const u = userEvent.setup();
    const { unmount } = mount(roster(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByText(T('technicians.roster.emptyTitle'))).toBeVisible();
    expect(screen.getByText(T('technicians.roster.emptyBody'))).toBeVisible();
    unmount();
    forgetRememberedBranch();

    get.mockResolvedValue(refused);
    mount(roster(locale), locale);
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByText(T('state.denied.title'))).toBeVisible();
    expect(screen.queryByText(T('technicians.roster.emptyTitle'))).toBeNull();
  });
});

describe('the technician roster', () => {
  it('reads nothing until one branch is named, and nothing under "All my branches"', async () => {
    get.mockResolvedValue(page([ENTRY]));
    const u = userEvent.setup();
    mount(roster());
    expect(await screen.findByTestId('technician-roster-blocked')).toBeVisible();
    await u.click(screen.getByRole('button', { name: 'everywhere' }));
    expect(await screen.findByTestId('technician-roster-blocked')).toBeVisible();
    expect(get).not.toHaveBeenCalled();
  });

  it('sends the one published filter as isActive', async () => {
    get.mockResolvedValue(page([ENTRY]));
    const u = userEvent.setup();
    mount(roster());
    await u.click(screen.getByRole('button', { name: 'first' }));
    await screen.findByText('Fixture Technician', { selector: 'bdi' });
    await u.selectOptions(
      field(screen.getByTestId('technician-roster-toolbar'), EN('technicians.roster.filter.state')),
      'inactive'
    );
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith(`/api/v1/technicians?${TARGET}&isActive=false&limit=25`)
    );
  });

  it('offers no Add without the manage permission', async () => {
    get.mockResolvedValue(page([ENTRY]));
    const u = userEvent.setup();
    mount(roster('en', { canManage: false }));
    await u.click(screen.getByRole('button', { name: 'first' }));
    await screen.findByText('Fixture Technician', { selector: 'bdi' });
    expect(screen.queryByRole('button', { name: EN('technicians.roster.add') })).toBeNull();
    // Nor the sentence about the user list: that explains a withheld action,
    // and without the manage code there is no action to withhold.
    expect(screen.queryByText(EN('technicians.roster.addNeedsUserList'))).toBeNull();
  });

  it('refuses an add with nobody chosen on the person field, and sends nothing', async () => {
    get.mockResolvedValue(page([]));
    const u = userEvent.setup();
    mount(roster());
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(await screen.findByRole('button', { name: EN('technicians.roster.add') }));
    const dialog = screen.getByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: EN('technicians.roster.addSubmit') }));
    expect(await within(dialog).findByText(EN('technicians.roster.personRequired'))).toBeVisible();
    expect(send).not.toHaveBeenCalled();
  });

  it('adds the person chosen by name, once for two presses, and reads the roster again', async () => {
    get.mockImplementation(async (path: string) =>
      path.startsWith('/api/v1/iam/users')
        ? page([
            {
              id: USER_ID,
              email: 'fixture.technician@example.test',
              displayName: 'Fixture Technician',
              status: 'active',
              mfaRequired: false,
              createdAt: '2026-09-01T00:00:00.000Z',
              recordVersion: 1,
            },
          ])
        : page([])
    );
    let answer: (value: unknown) => void = () => undefined;
    send.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const u = userEvent.setup();
    mount(roster());
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(await screen.findByRole('button', { name: EN('technicians.roster.add') }));
    const dialog = screen.getByRole('dialog');
    await u.type(field(dialog, EN('technicians.roster.person')), 'Fixture{Enter}');
    await u.click(
      await screen.findByRole('option', {
        name: 'Fixture Technician — fixture.technician@example.test',
      })
    );
    await u.type(field(dialog, EN('technicians.roster.trade')), 'Mechanic');
    const submit = within(dialog).getByRole('button', { name: EN('technicians.roster.addSubmit') });
    await act(async () => {
      submit.click();
      submit.click();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('POST', '/api/v1/technicians', {
      userId: USER_ID,
      companyId: BRANCH.companyId,
      branchId: BRANCH.id,
      trade: 'Mechanic',
    });
    const before = get.mock.calls.filter(([path]) =>
      String(path).startsWith('/api/v1/technicians?')
    ).length;
    await act(async () => answer(ok(ENTRY, 201)));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(
        get.mock.calls.filter(([path]) => String(path).startsWith('/api/v1/technicians?')).length
      ).toBeGreaterThan(before)
    );
  });

  it('says why an add was refused, beside its buttons, and keeps the form', async () => {
    get.mockImplementation(async (path: string) =>
      path.startsWith('/api/v1/iam/users')
        ? page([
            {
              id: USER_ID,
              email: 'fixture.technician@example.test',
              displayName: 'Fixture Technician',
              status: 'active',
              mfaRequired: false,
              createdAt: '2026-09-01T00:00:00.000Z',
              recordVersion: 1,
            },
          ])
        : page([])
    );
    send.mockResolvedValue(violation('body.userId', 'duplicate-active-profile'));
    const u = userEvent.setup();
    mount(roster());
    await u.click(screen.getByRole('button', { name: 'first' }));
    await u.click(await screen.findByRole('button', { name: EN('technicians.roster.add') }));
    const dialog = screen.getByRole('dialog');
    await u.type(field(dialog, EN('technicians.roster.person')), 'Fixture{Enter}');
    await u.click(
      await screen.findByRole('option', {
        name: 'Fixture Technician — fixture.technician@example.test',
      })
    );
    await u.click(within(dialog).getByRole('button', { name: EN('technicians.roster.addSubmit') }));
    expect(
      await within(dialog).findByText(EN('form.violation.duplicate-active-profile'))
    ).toBeVisible();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('withholds the add action without the user read, and says why', async () => {
    // The person picker searches only with `iam.user.read`; a dialog opened
    // without it could never pick anyone, so the action is not offered.
    get.mockResolvedValue(page([]));
    const u = userEvent.setup();
    mount(roster('en', { canReadUsers: false }));
    await u.click(screen.getByRole('button', { name: 'first' }));
    expect(await screen.findByText(EN('technicians.roster.addNeedsUserList'))).toBeVisible();
    expect(screen.queryByRole('button', { name: EN('technicians.roster.add') })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    // The empty roster does not invite an add the operator cannot make.
    expect(await screen.findByText(EN('technicians.roster.emptyBodyReadOnly'))).toBeVisible();
    expect(screen.queryByText(EN('technicians.roster.emptyBody'))).toBeNull();
  });
});

describe.each(['en', 'ar'] as const)('a technician profile (%s)', (locale) => {
  const T = words(locale);

  it('names the person, every holding and the work assigned, with no reference printed', async () => {
    serveProfile();
    mount(profile(locale), locale);
    expect(
      await screen.findByRole('heading', { name: 'Fixture Technician', level: 2 })
    ).toBeVisible();
    expect(screen.getByText('Main workshop')).toBeVisible();
    expect(screen.getByText('Engine systems')).toBeVisible();
    expect(screen.getByText('Level one')).toBeVisible();
    expect(screen.getByText('Air conditioning handling')).toBeVisible();
    expect(screen.getByText(T('technicians.availability.branchClock'))).toBeVisible();
    expect(await screen.findByText('Replace front pads')).toBeVisible();
    expect(screen.getByText('WO-0042')).toBeVisible();
    for (const reference of [USER_ID, SKILL_ID, CERT_ID, WINDOW_ID, PROFILE_ID]) {
      expect(screen.queryByText(new RegExp(reference))).toBeNull();
    }
    if (locale === 'ar') expect(document.documentElement.dir).toBe('rtl');
  });

  it('says, before a move or a retirement, that skills, certifications and availability are not carried over', async () => {
    // BR-03's transfer path is retire-then-re-add; the holdings stay with the
    // retired profile. Both places that lead an operator onto that path say so.
    const notCarried = locale === 'en' ? /not carried over/ : /لا تُنقل/;
    for (const key of [
      'technicians.profile.editDescription',
      'technicians.profile.confirmRetireBody',
    ]) {
      expect(T(key), key).toMatch(notCarried);
    }
    serveProfile();
    const u = userEvent.setup();
    mount(profile(locale), locale);
    await u.click(await screen.findByRole('button', { name: T('technicians.profile.edit') }));
    expect(
      within(screen.getByRole('dialog')).getByText(T('technicians.profile.editDescription'))
    ).toBeVisible();
    await u.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: T('admin.cancel') })
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await u.click(screen.getByRole('button', { name: T('technicians.profile.retire') }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      T('technicians.profile.confirmRetireBody')
    );
  });

  it('says a withheld name in words', async () => {
    serveProfile({ detail: ok({ ...DETAIL, profile: { ...ENTRY, displayName: null } }) });
    mount(profile(locale), locale);
    expect(
      await screen.findByRole('heading', { name: T('technicians.roster.nameWithheld'), level: 2 })
    ).toBeVisible();
  });
});

describe('a technician profile', () => {
  it('shows a window on the branch clock', async () => {
    serveProfile();
    mount(profile());
    const windows = await screen.findByTestId('technician-availability');
    // 06:00 and 14:00 UTC are 09:00 and 17:00 in Riyadh (en-GB writes a 24-hour clock).
    expect(windows).toHaveTextContent(/09:00/);
    expect(windows).toHaveTextContent(/17:00/);
    expect(windows).not.toHaveTextContent(/06:00/);
    expect(windows).toHaveTextContent('Training');
  });

  it('says not-found and reads nothing else of it', async () => {
    serveProfile({ detail: missing });
    mount(profile());
    expect(await screen.findByTestId('technician-profile-failure')).toBeVisible();
    expect(screen.queryByTestId('technician-profile')).toBeNull();
  });

  it('draws no write control without the manage permission, and does not read the skill list', async () => {
    serveProfile();
    mount(profile('en', { canManage: false }));
    await screen.findByRole('heading', { name: 'Fixture Technician', level: 2 });
    for (const key of [
      'technicians.profile.edit',
      'technicians.profile.deactivate',
      'technicians.profile.retire',
      'technicians.skills.add',
      'technicians.availability.add',
    ]) {
      expect(screen.queryByRole('button', { name: EN(key) })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /Remove skill|Withdraw|Change/ })).toBeNull();
    expect(get).not.toHaveBeenCalledWith('/api/v1/technician-skills');
  });

  it('saves the details with the version the read published, and reads the profile again', async () => {
    serveProfile();
    send.mockResolvedValue(ok({ ...ENTRY, trade: 'Electrician', recordVersion: 4 }));
    const u = userEvent.setup();
    mount(profile());
    await u.click(await screen.findByRole('button', { name: EN('technicians.profile.edit') }));
    const dialog = screen.getByRole('dialog');
    const trade = field(dialog, EN('technicians.roster.trade'));
    await u.clear(trade);
    await u.type(trade, 'Electrician');
    await u.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/technicians/${PROFILE_ID}`,
      { trade: 'Electrician' },
      { ifMatch: 3 }
    );
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() =>
      expect(
        get.mock.calls.filter(([path]) => path === `/api/v1/technicians/${PROFILE_ID}`).length
      ).toBe(2)
    );
  });

  it('refuses a save with nothing changed, and sends nothing', async () => {
    serveProfile();
    const u = userEvent.setup();
    mount(profile());
    await u.click(await screen.findByRole('button', { name: EN('technicians.profile.edit') }));
    const dialog = screen.getByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    expect(await within(dialog).findByText(EN('form.violation.empty_update'))).toBeVisible();
    expect(send).not.toHaveBeenCalled();
  });

  it('says a stale save beside the profile, with the way to the latest', async () => {
    serveProfile();
    send.mockResolvedValue(stale);
    const u = userEvent.setup();
    mount(profile());
    await u.click(await screen.findByRole('button', { name: EN('technicians.profile.edit') }));
    const dialog = screen.getByRole('dialog');
    await u.type(field(dialog, EN('technicians.roster.trade')), ' lead');
    await u.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    const latest = await screen.findByRole('button', { name: EN('form.loadLatest') });
    expect(screen.queryByRole('dialog')).toBeNull();
    await u.click(latest);
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: EN('form.loadLatest') })).toBeNull()
    );
    expect(
      get.mock.calls.filter(([path]) => path === `/api/v1/technicians/${PROFILE_ID}`).length
    ).toBe(2);
  });

  it('keeps a refused save in its form and says why', async () => {
    serveProfile();
    send.mockResolvedValue(refused);
    const u = userEvent.setup();
    mount(profile());
    await u.click(await screen.findByRole('button', { name: EN('technicians.profile.edit') }));
    const dialog = screen.getByRole('dialog');
    await u.type(field(dialog, EN('technicians.roster.trade')), ' lead');
    await u.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    expect(await within(dialog).findByRole('alert')).toBeVisible();
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('makes the technician inactive with If-Match, sent once for two presses', async () => {
    serveProfile();
    send.mockReturnValue(new Promise(() => undefined));
    const u = userEvent.setup();
    mount(profile());
    await u.click(
      await screen.findByRole('button', { name: EN('technicians.profile.deactivate') })
    );
    const question = screen.getByRole('alertdialog');
    expect(within(question).getByText(/Fixture Technician/)).toBeVisible();
    const confirm = within(question).getByRole('button', {
      name: EN('technicians.profile.deactivate'),
    });
    await act(async () => {
      confirm.click();
      confirm.click();
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/technicians/${PROFILE_ID}`,
      { isActive: false },
      { ifMatch: 3 }
    );
  });

  it('takes the technician off the roster and returns to it', async () => {
    serveProfile();
    send.mockResolvedValue(ok({ ...ENTRY, recordVersion: 4 }));
    const u = userEvent.setup();
    mount(profile());
    await u.click(await screen.findByRole('button', { name: EN('technicians.profile.retire') }));
    await u.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN('technicians.profile.retire'),
      })
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/en/technicians'));
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/technicians/${PROFILE_ID}`,
      { retire: true },
      { ifMatch: 3 }
    );
  });

  it('gives a skill chosen from the skill list, at a level, and offers no skill already held', async () => {
    serveProfile();
    send.mockResolvedValue(ok({ id: 'x', skillId: SKILL_TWO_ID, skillLevelId: LEVEL_TWO_ID }));
    const u = userEvent.setup();
    mount(profile());
    await u.click(await screen.findByRole('button', { name: EN('technicians.skills.add') }));
    const dialog = screen.getByRole('dialog');
    const skill = field(dialog, EN('technicians.skills.skill'));
    expect(within(skill).queryByRole('option', { name: 'Engine systems' })).toBeNull();
    await u.selectOptions(skill, SKILL_TWO_ID);
    await u.selectOptions(field(dialog, EN('technicians.skills.level')), LEVEL_TWO_ID);
    await u.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'PUT',
      `/api/v1/technicians/${PROFILE_ID}/skills/${SKILL_TWO_ID}`,
      { skillLevelId: LEVEL_TWO_ID }
    );
  });

  it('refuses a skill with no level on its own field', async () => {
    serveProfile();
    const u = userEvent.setup();
    mount(profile());
    await u.click(await screen.findByRole('button', { name: EN('technicians.skills.add') }));
    const dialog = screen.getByRole('dialog');
    await u.selectOptions(field(dialog, EN('technicians.skills.skill')), SKILL_TWO_ID);
    await u.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    expect(await within(dialog).findByText(EN('technicians.skills.levelRequired'))).toBeVisible();
    expect(send).not.toHaveBeenCalled();
  });

  it('says so when the skill list cannot be read, and offers no way to add one', async () => {
    serveProfile({ catalogue: refused });
    mount(profile());
    expect(await screen.findByTestId('technician-skills-catalogue-failed')).toHaveTextContent(
      EN('technicians.skills.catalogueUnavailable')
    );
    expect(screen.queryByRole('button', { name: EN('technicians.skills.add') })).toBeNull();
  });

  it('removes a skill after the question', async () => {
    serveProfile();
    send.mockResolvedValue(ok({ withdrawn: true }));
    const u = userEvent.setup();
    mount(profile());
    await u.click(
      await screen.findByRole('button', {
        name: `${EN('technicians.skills.withdraw')}: Engine systems`,
      })
    );
    await u.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN('technicians.skills.withdraw'),
      })
    );
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        'DELETE',
        `/api/v1/technicians/${PROFILE_ID}/skills/${SKILL_ID}`
      )
    );
  });

  it('changes a certification with its own version, and refuses a save with nothing changed', async () => {
    serveProfile();
    send.mockResolvedValue(ok({ certificationId: CERT_ID, certStatus: 'revoked' }));
    const u = userEvent.setup();
    mount(profile());
    await u.click(
      await screen.findByRole('button', {
        name: `${EN('technicians.certifications.change')}: Air conditioning handling`,
      })
    );
    const dialog = screen.getByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    expect(
      await within(dialog).findByText(EN('technicians.certifications.unchanged'))
    ).toBeVisible();
    expect(send).not.toHaveBeenCalled();

    await u.selectOptions(field(dialog, EN('technicians.certifications.state')), 'revoked');
    await u.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send).toHaveBeenCalledWith(
      'PATCH',
      `/api/v1/technicians/${PROFILE_ID}/certifications/${CERT_ID}`,
      { certStatus: 'revoked' },
      { ifMatch: 2 }
    );
  });

  it('says why a new certification cannot be recorded, and draws no control for it', async () => {
    serveProfile();
    mount(profile());
    expect(await screen.findByTestId('technician-certifications-no-record')).toHaveTextContent(
      EN('technicians.certifications.recordUnavailable')
    );
    expect(screen.queryByRole('button', { name: /record a certification/i })).toBeNull();
  });

  it('offers the certificate number only with the sensitive view', async () => {
    serveProfile();
    const { unmount } = mount(profile('en', { canRecordSensitive: false }));
    await screen.findByText('Air conditioning handling');
    expect(
      screen.queryByRole('button', {
        name: `${EN('technicians.certifications.recordNumber')}: Air conditioning handling`,
      })
    ).toBeNull();
    unmount();

    send.mockResolvedValue(ok({ id: 'd', certificateNumber: 'kept', recordVersion: 1 }));
    const u = userEvent.setup();
    mount(profile('en', { canRecordSensitive: true }));
    await u.click(
      await screen.findByRole('button', {
        name: `${EN('technicians.certifications.recordNumber')}: Air conditioning handling`,
      })
    );
    const dialog = screen.getByRole('dialog');
    await u.type(field(dialog, EN('technicians.certifications.number')), 'AC-2026-118');
    await u.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        'PUT',
        `/api/v1/technicians/${PROFILE_ID}/certifications/${CERT_ID}/detail`,
        { certificateNumber: 'AC-2026-118' }
      )
    );
    // The number is never drawn back on the page.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByText('AC-2026-118')).toBeNull();
  });

  it('withdraws a window with its own version as If-Match', async () => {
    serveProfile();
    send.mockResolvedValue(ok({ withdrawn: true }));
    const u = userEvent.setup();
    mount(profile());
    const windows = await screen.findByTestId('technician-availability');
    await u.click(within(windows).getByRole('button', { name: /^Withdraw: / }));
    await u.click(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN('technicians.availability.withdraw'),
      })
    );
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        'DELETE',
        `/api/v1/technicians/${PROFILE_ID}/availability/${WINDOW_ID}`,
        undefined,
        { ifMatch: 4 }
      )
    );
  });

  it('refuses a window with nothing entered on each field, and sends nothing', async () => {
    serveProfile();
    const u = userEvent.setup();
    mount(profile());
    await u.click(await screen.findByRole('button', { name: EN('technicians.availability.add') }));
    const dialog = screen.getByRole('dialog');
    await u.click(within(dialog).getByRole('button', { name: EN('admin.save') }));
    expect(
      (await within(dialog).findAllByText(EN('field.required'))).length
    ).toBeGreaterThanOrEqual(3);
    expect(send).not.toHaveBeenCalled();
  });

  it('offers no window where the branch clock is not known', async () => {
    serveProfile({
      detail: ok({
        ...DETAIL,
        profile: { ...ENTRY, branchId: '29999999-9999-4999-8999-999999999999' },
      }),
    });
    mount(profile());
    expect(await screen.findByTestId('technician-availability-no-clock')).toBeVisible();
    expect(screen.queryByRole('button', { name: EN('technicians.availability.add') })).toBeNull();
    expect(screen.getByText(EN('technicians.profile.branchNotListed'))).toBeVisible();
    // No time is read off this device's clock in place of the branch's: the
    // window is named by its kind and reason, its times are not drawn, the
    // sentence says why, and it is not offered for withdrawal.
    const windows = screen.getByTestId('technician-availability');
    expect(windows).toHaveTextContent('Training');
    expect(windows).not.toHaveTextContent(/\d{1,2}:\d{2}/);
    expect(screen.getByTestId('technician-availability-clock')).toHaveTextContent(
      EN('technicians.availability.timesHidden')
    );
    expect(
      screen.queryByRole('button', {
        name: new RegExp(`^${escape(EN('technicians.availability.withdraw'))}`),
      })
    ).toBeNull();
  });
});
