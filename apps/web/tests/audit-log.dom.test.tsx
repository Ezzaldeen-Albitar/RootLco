import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { flattenNavigation } from '@/config/navigation';
import { ADMINISTRATION_PERMISSIONS } from '@/features/administration/shared/permissions';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import { CLIENT_READ_TIMEOUT_MS, clientReadTimeoutMs } from '@/lib/api/read-budget';
import { endOfDay, startOfDay } from '@/lib/branch-time';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';

/**
 * The audit log, rendered as a report (P1-31, `FE-015`, decision `D-6`).
 *
 * The properties under test: the screen opens on a window it was GIVEN rather
 * than one it computes, and that window is seven days wide; each criterion the
 * operator applies reaches the adapter under the name the backend's own
 * allow-list publishes, and reaches it only when it is applied; a malformed
 * actor identifier is refused before a request is made; clearing returns the
 * read to the unfiltered one; the criteria are named in Arabic as well as
 * English; the screen still states that no export exists and still offers none;
 * and the route page decides before it reads.
 *
 * Company/branch choices use authorized directory rows and the existing paired
 * resource-query contract. Direct Server Action calls recheck pair membership.
 *
 * Since `P1-32-PRE-OD-ADM6` the screen is on Material UI (the operational grid,
 * the form fields, the date pickers, the states and the drawer), so every render
 * goes under `UiFoundationProvider`, as the locale layout mounts it. The
 * properties added with it: people are named from the read and never by an
 * identifier, with a truthful sentence where a name is absent; times and the
 * window are on the working branch's clock, or UTC without one, and the clock is
 * named; the grid walks the server's cursor; a refused read is a refusal; and
 * the detail drawer reads one record and names its people.
 *
 * The administration hub, the audit log's parent route, is held here too: its
 * departments and employees entries, and that every entry is shown exactly on
 * the codes its page needs and hidden without them: any ONE of its navigation
 * entry's `permission` and `orPermissions` codes, and besides it EVERY code in
 * its `alsoRequires` and every further code the page refuses without.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);
const labelledAr = (key: string) => new RegExp(`^${escape(AR[key] as string)}`);

const listAuditEvents = vi.fn();
const readAuditEvent = vi.fn();
const readAuditScopeOptions = vi.fn();
const apiGet = vi.fn();
vi.mock('@/lib/api/server-client', () => ({ authorizedClient: async () => ({ get: apiGet }) }));
vi.mock('@/features/administration/audit/api', () => ({
  listAuditEvents: (...args: unknown[]) => listAuditEvents(...args),
  readAuditEvent: (...args: unknown[]) => readAuditEvent(...args),
  readAuditScopeOptions: (...args: unknown[]) => readAuditScopeOptions(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'reviewer@test.local' }),
}));

/** Under the Material foundation, as the locale layout mounts it. */
function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

const { AuditLogScreen } =
  await import('@/features/administration/audit/components/AuditLogScreen');
const { DEFAULT_WINDOW_DAYS, MAX_WINDOW_DAYS } =
  await import('@/features/administration/audit/types');
const { openingWindow, rangeProblem } = await import('@/features/administration/audit/range');
const { NAMED_AUDIT_ACTIONS, NAMED_AUDIT_ENTITIES, NAMED_AUDIT_REFERENCES } =
  await import('@/features/administration/audit/labels');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const AuditLogPage = (await import('@/app/[locale]/(dashboard)/administration/audit-log/page'))
  .default as unknown as RoutePage;
const AdministrationPage = (await import('@/app/[locale]/(dashboard)/administration/page'))
  .default as unknown as RoutePage;

const ACTOR_ID = '11111111-1111-4111-8111-111111111111';
const RECORD_ID = '22222222-2222-4222-8222-222222222222';

const row = {
  id: RECORD_ID,
  seq: '4096',
  actorId: ACTOR_ID,
  actorKind: 'user',
  action: 'iam.audit.viewed',
  entityType: 'iam.audit_record',
  entityId: null,
  companyId: null,
  branchId: null,
  correlationId: 'corr-9',
  requestRef: null,
  occurredAt: '2026-09-05T09:00:00.000Z',
  actorDisplayName: null as string | null,
  subjectDisplayName: null as string | null,
};

const okPage = (rows: readonly unknown[]) => ({
  status: 'ok' as const,
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr-9',
});

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  listAuditEvents.mockResolvedValue(okPage([row]));
  readAuditEvent.mockResolvedValue({ status: 'ok', record: row, correlationId: 'corr-9' });
  readAuditScopeOptions.mockResolvedValue({ status: 'unavailable', companies: [], branches: [] });
});

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    withMui(
      <AuditLogScreen
        locale="en"
        messages={en}
        initialFrom="2026-09-01"
        initialTo="2026-09-08"
        {...over}
      />
    )
  );
}

/** The criteria object of the most recent read — the fourth argument. */
function lastFilters(): Record<string, string> {
  const call = listAuditEvents.mock.calls.at(-1);
  expect(call, 'no read was made').toBeDefined();
  return (call as unknown[])[3] as Record<string, string>;
}

/** The window of the most recent read — the third argument. */
function lastRange(): { from: string; to: string } {
  const call = listAuditEvents.mock.calls.at(-1);
  expect(call, 'no read was made').toBeDefined();
  return (call as unknown[])[2] as { from: string; to: string };
}

function filterForm(): HTMLElement {
  return screen.getByRole('form', { name: EN['audit.filter.formLabel'] as string });
}

async function apply(user: ReturnType<typeof userEvent.setup>) {
  const before = listAuditEvents.mock.calls.length;
  await user.click(
    within(filterForm()).getByRole('button', { name: EN['audit.filter.apply'] as string })
  );
  await waitFor(() => expect(listAuditEvents.mock.calls.length).toBeGreaterThan(before));
}

describe('the window the screen opens on', () => {
  it('reads the window it was given, both ends, on first paint', async () => {
    renderScreen();
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    expect(lastRange().from).toBe('2026-09-01T00:00:00.000Z');
    expect(lastRange().to).toBe('2026-09-08T23:59:59.999Z');
  });

  it('applies no criterion until the operator asks for one', async () => {
    renderScreen();
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    expect(lastFilters()).toEqual({ action: '', entityType: '', actorId: '' });
  });
});

/**
 * The width rule, as the service applies it (`resolveRange`): the instants the
 * read sends may be at most 92 × 24 hours apart. America/New_York leaves summer
 * time on 2026-11-01 and enters it on 2026-03-08, so a window of whole days
 * there is an hour longer, or shorter, than its count of days.
 */
describe('the window is measured as the service measures it (P1-32-PRE-OD-ADM6)', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('takes 92 whole days and refuses 93 on a clock without daylight saving', () => {
    expect(MAX_WINDOW_DAYS).toBe(92);
    expect(rangeProblem({ from: '2026-01-01', to: '2026-04-02' }, 'UTC')).toBeNull();
    expect(rangeProblem({ from: '2026-01-01', to: '2026-04-03' }, 'UTC')).toBe(
      'audit.range.tooWide'
    );
    expect(rangeProblem({ from: '2026-01-01', to: '2026-04-02' }, 'Asia/Riyadh')).toBeNull();
  });

  it('refuses 92 calendar days that cross a fall back, because they are 92 days and an hour', () => {
    // 1 September to 1 December: 30 + 31 + 30 + 1 = 92 calendar days.
    expect(rangeProblem({ from: '2026-09-01', to: '2026-12-01' }, 'America/New_York')).toBe(
      'audit.range.tooWide'
    );
    // The same days on UTC, and one day fewer on the same clock, are in bounds.
    expect(rangeProblem({ from: '2026-09-01', to: '2026-12-01' }, 'UTC')).toBeNull();
    expect(rangeProblem({ from: '2026-09-02', to: '2026-12-01' }, 'America/New_York')).toBeNull();
  });

  it('takes 92 calendar days that cross a spring forward, and still refuses 93', () => {
    expect(rangeProblem({ from: '2026-01-01', to: '2026-04-02' }, 'America/New_York')).toBeNull();
    expect(rangeProblem({ from: '2026-01-01', to: '2026-04-03' }, 'America/New_York')).toBe(
      'audit.range.tooWide'
    );
  });

  it('agrees with the service on the instants the read sends', () => {
    // What the screen would send for the fall-back window, and the service's
    // own test against it: wider than 92 × 24 hours.
    const from = startOfDay('America/New_York', '2026-09-01');
    const to = endOfDay('America/New_York', '2026-12-01');
    expect(from.toISOString()).toBe('2026-09-01T04:00:00.000Z');
    expect(to.toISOString()).toBe('2026-12-02T04:59:59.999Z');
    expect(to.getTime() - from.getTime() - MAX_WINDOW_DAYS * DAY).toBe(60 * 60 * 1000 - 1);
  });

  it('says an unfinished day and a reversed pair before it measures anything', () => {
    expect(rangeProblem({ from: '2026-09-0', to: '2026-09-08' }, 'UTC')).toBe(
      'audit.range.incomplete'
    );
    expect(rangeProblem({ from: '2026-09-08', to: '2026-09-01' }, 'UTC')).toBe('audit.range.order');
    expect(rangeProblem({ from: '2026-09-08', to: '2026-09-08' }, 'America/New_York')).toBeNull();
  });

  it('opens on seven whole days, today the last of them', () => {
    expect(DEFAULT_WINDOW_DAYS).toBe(7);
    expect(openingWindow('UTC', new Date('2026-09-08T10:00:00.000Z'))).toEqual({
      from: '2026-09-02',
      to: '2026-09-08',
    });
    // Already the ninth in Riyadh.
    expect(openingWindow('Asia/Riyadh', new Date('2026-09-08T22:30:00.000Z'))).toEqual({
      from: '2026-09-03',
      to: '2026-09-09',
    });
  });

  it('says a window too wide for the service on the last day, and reads nothing for it', async () => {
    const user = userEvent.setup();
    const newYork = { ...TEST_BRANCH, timezone: 'America/New_York' };
    renderLtr(
      withMui(
        inBranch(
          <AuditLogScreen
            locale="en"
            messages={en}
            initialFrom="2026-09-01"
            initialTo="2026-09-08"
          />,
          { snapshot: branchSnapshot([newYork]) }
        )
      )
    );
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    const to = screen.getByRole('group', { name: labelled('audit.to') });
    await user.click(within(to).getAllByRole('spinbutton')[0] as HTMLElement);
    // Day, month, year: 1 December 2026, 92 calendar days after 1 September.
    await user.keyboard('01122026');
    expect(await screen.findByText(EN['audit.range.tooWide'] as string)).toBeVisible();
    expect(to).toHaveAttribute('aria-invalid', 'true');
    // Days typed on the way may be read; the refused window never is.
    const ends = listAuditEvents.mock.calls.map((call) => (call[2] as { to: string }).to);
    expect(ends).not.toContain('2026-12-02T04:59:59.999Z');
    expect(lastRange().from).toBe('2026-09-01T04:00:00.000Z');
  });
});

/** A read held in flight, released by the case. */
function pendingRead() {
  let release: (value: unknown) => void = () => undefined;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  return { pending, release: () => release(okPage([row])) };
}

describe('one read at a time from the filter form (P1-32-PRE-OD-ADM6)', () => {
  it('holds Apply while a read is in flight, and gives it back when the read settles', async () => {
    const first = pendingRead();
    listAuditEvents.mockReturnValueOnce(first.pending);
    renderScreen();
    const applyButton = within(filterForm()).getByRole('button', {
      name: EN['audit.filter.apply'] as string,
    });
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalledTimes(1));
    expect(applyButton).toBeDisabled();
    // Enter in a box does not submit around the held button either: a changed
    // criterion would otherwise be applied, and read, at once.
    fireEvent.change(within(filterForm()).getByLabelText(labelled('audit.filter.action')), {
      target: { value: 'iam.audit.viewed' },
    });
    fireEvent.submit(filterForm());
    expect(listAuditEvents).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.release();
    });
    await waitFor(() => expect(applyButton).toBeEnabled());
    expect(listAuditEvents).toHaveBeenCalledTimes(1);
  });
});

describe('each criterion reaches the adapter under the published name', () => {
  it('sends the action under `action`', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    await user.type(
      within(filterForm()).getByLabelText(labelled('audit.filter.action')),
      'iam.audit.viewed'
    );
    await apply(user);
    expect(lastFilters()).toEqual({
      action: 'iam.audit.viewed',
      entityType: '',
      actorId: '',
    });
  });

  it('sends the record type under `entityType`', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    await user.type(
      within(filterForm()).getByLabelText(labelled('audit.filter.entityType')),
      'iam.audit_record'
    );
    await apply(user);
    expect(lastFilters()).toEqual({
      action: '',
      entityType: 'iam.audit_record',
      actorId: '',
    });
  });

  it('sends the actor under `actorId`', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    await user.type(within(filterForm()).getByLabelText(labelled('audit.filter.actor')), ACTOR_ID);
    await apply(user);
    expect(lastFilters()).toEqual({ action: '', entityType: '', actorId: ACTOR_ID });
  });

  it('sends all three together, and keeps the window with them', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    const form = filterForm();
    await user.type(
      within(form).getByLabelText(labelled('audit.filter.action')),
      'iam.user.created'
    );
    await user.type(
      within(form).getByLabelText(labelled('audit.filter.entityType')),
      'iam.user_account'
    );
    await user.type(within(form).getByLabelText(labelled('audit.filter.actor')), ACTOR_ID);
    await apply(user);
    expect(lastFilters()).toEqual({
      action: 'iam.user.created',
      entityType: 'iam.user_account',
      actorId: ACTOR_ID,
    });
    expect(lastRange().from).toBe('2026-09-01T00:00:00.000Z');
    expect(lastRange().to).toBe('2026-09-08T23:59:59.999Z');
  });

  it('trims what was typed, so a stray space is not sent as part of the value', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    await user.type(
      within(filterForm()).getByLabelText(labelled('audit.filter.action')),
      '  iam.audit.viewed  '
    );
    await apply(user);
    expect(lastFilters().action).toBe('iam.audit.viewed');
  });
});

describe('a malformed actor identifier', () => {
  it('is refused before a request is made, and is named on the field', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    const before = listAuditEvents.mock.calls.length;
    await user.type(
      within(filterForm()).getByLabelText(labelled('audit.filter.actor')),
      'not-an-id'
    );
    await user.click(
      within(filterForm()).getByRole('button', { name: EN['audit.filter.apply'] as string })
    );
    expect(await screen.findByText(EN['audit.filter.idFormat'] as string)).toBeVisible();
    expect(listAuditEvents.mock.calls.length).toBe(before);
  });
});

describe('clearing the criteria', () => {
  it('returns the read to the unfiltered one and empties the boxes', async () => {
    const user = userEvent.setup();
    renderScreen();
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    await user.type(
      within(filterForm()).getByLabelText(labelled('audit.filter.action')),
      'iam.audit.viewed'
    );
    await apply(user);
    expect(lastFilters().action).toBe('iam.audit.viewed');

    const before = listAuditEvents.mock.calls.length;
    await user.click(
      within(filterForm()).getByRole('button', { name: EN['audit.filter.clear'] as string })
    );
    await waitFor(() => expect(listAuditEvents.mock.calls.length).toBeGreaterThan(before));
    expect(lastFilters()).toEqual({ action: '', entityType: '', actorId: '' });
    expect(
      (within(filterForm()).getByLabelText(labelled('audit.filter.action')) as HTMLInputElement)
        .value
    ).toBe('');
  });
});

describe('Arabic', () => {
  it('names every criterion and both buttons in Arabic', async () => {
    renderRtl(
      withMui(
        <AuditLogScreen
          locale="ar"
          messages={ar}
          initialFrom="2026-09-01"
          initialTo="2026-09-08"
        />,
        'ar'
      )
    );
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    const form = screen.getByRole('form', { name: AR['audit.filter.formLabel'] as string });
    expect(within(form).getByLabelText(labelledAr('audit.filter.action'))).toBeVisible();
    expect(within(form).getByLabelText(labelledAr('audit.filter.entityType'))).toBeVisible();
    expect(within(form).getByLabelText(labelledAr('audit.filter.actor'))).toBeVisible();
    expect(
      within(form).getByRole('button', { name: AR['audit.filter.apply'] as string })
    ).toBeVisible();
    expect(
      within(form).getByRole('button', { name: AR['audit.filter.clear'] as string })
    ).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('still states in Arabic that no export exists', async () => {
    renderRtl(
      withMui(
        <AuditLogScreen
          locale="ar"
          messages={ar}
          initialFrom="2026-09-01"
          initialTo="2026-09-08"
        />,
        'ar'
      )
    );
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    expect(screen.getByText(new RegExp(escape(AR['audit.noExport'] as string)))).toBeVisible();
  });
});

describe('no export', () => {
  it('states that none exists and offers no control that would produce one', async () => {
    renderScreen();
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    expect(screen.getByText(new RegExp(escape(EN['audit.noExport'] as string)))).toBeVisible();
    expect(screen.queryByRole('button', { name: /export|download|csv/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /export|download|csv/i })).toBeNull();
  });
});

describe('who: found by name for a caller holding the user read (route sweep B3)', () => {
  const PERSON = {
    id: ACTOR_ID,
    email: 'rana@example.test',
    displayName: 'Rana Saleh',
    status: 'locked',
    mfaRequired: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    recordVersion: 1,
  };
  function answerUsers() {
    apiGet.mockImplementation(async (path: string) =>
      path.startsWith('/api/v1/iam/users')
        ? {
            ok: true,
            status: 200,
            data: { items: [PERSON], nextCursor: null, hasMore: false },
            correlationId: 'corr-users',
          }
        : { ok: false, kind: 'not-found', status: 404, correlationId: 'x' }
    );
  }

  it('finds the person by name, says a locked account is locked, and applies it on submit', async () => {
    answerUsers();
    const user = userEvent.setup();
    renderScreen({ canReadUsers: true });
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    const form = filterForm();
    expect(within(form).queryByText(EN['audit.filter.identifierHelp'] as string)).toBeNull();
    await user.type(within(form).getByLabelText(EN['audit.filter.actor'] as string), 'Rana{Enter}');
    await user.click(
      // An option of the combobox (EntityPicker), drawn in its listbox popup.
      await screen.findByRole('option', {
        name: `Rana Saleh — rana@example.test (${EN['users.status.locked'] as string})`,
      })
    );
    // Chosen is not applied: the audited read runs on submit only.
    expect(lastFilters()).toEqual({ action: '', entityType: '', actorId: '' });
    await apply(user);
    expect(lastFilters()).toEqual({ action: '', entityType: '', actorId: ACTOR_ID });
    // The search went to the server and never into the address.
    expect(apiGet.mock.calls.some(([path]) => String(path).includes('search=Rana'))).toBe(true);

    await user.click(
      within(form).getByRole('button', { name: EN['audit.filter.clear'] as string })
    );
    await waitFor(() => expect(lastFilters()).toEqual({ action: '', entityType: '', actorId: '' }));
    expect(within(form).queryByTestId('audit-actor-picker-chosen')).toBeNull();
  });

  it('the route page offers the search with the user read, and the reference box without it', async () => {
    answerUsers();
    for (const [permissions, searchable] of [
      [['iam.audit.view', 'iam.user.read'], true],
      [['iam.audit.view'], false],
    ] as const) {
      PERMISSIONS = permissions;
      const view = renderLtr(
        withMui((await AuditLogPage({ params: Promise.resolve({ locale: 'en' }) })) as never)
      );
      await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
      expect(screen.queryByTestId('audit-actor-picker') !== null).toBe(searchable);
      expect(screen.queryByText(EN['audit.filter.identifierHelp'] as string) !== null).toBe(
        !searchable
      );
      view.unmount();
    }
  });
});

/** The props the route page hands `AuditLogScreen`, found in the tree it returns. */
function screenProps(tree: unknown): Record<string, unknown> | undefined {
  if (tree === null || typeof tree !== 'object') return undefined;
  if (Array.isArray(tree)) {
    for (const child of tree) {
      const found = screenProps(child);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const element = tree as { type?: unknown; props?: { children?: unknown } };
  if (element.type === AuditLogScreen) return element.props as Record<string, unknown>;
  return screenProps(element.props?.children);
}

describe('the /administration/audit-log route page decides before it reads', () => {
  it('refuses without the audit code, and issues no read', async () => {
    PERMISSIONS = [];
    renderLtr(
      withMui((await AuditLogPage({ params: Promise.resolve({ locale: 'en' }) })) as never)
    );
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listAuditEvents).not.toHaveBeenCalled();
    expect(readAuditScopeOptions).not.toHaveBeenCalled();
  });

  it('reads a seven-day window with the code held, computed on the server', async () => {
    // A fixed moment, so the case cannot straddle a midnight; only the clock is
    // faked, not the timers the render waits on.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-09-08T23:59:59.500Z'));
      PERMISSIONS = ['iam.audit.view'];
      const page = (await AuditLogPage({ params: Promise.resolve({ locale: 'en' }) })) as never;
      // The window the server hands the screen: seven days, today the last.
      expect(screenProps(page)).toMatchObject({
        initialFrom: '2026-09-02',
        initialTo: '2026-09-08',
        openedAt: '2026-09-08T23:59:59.500Z',
      });
      renderLtr(withMui(page));
      await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
      // Seven whole days on the clock in force (UTC here), today the last: the
      // read runs from the first day's start to the last millisecond of today.
      expect(lastRange()).toEqual({
        from: '2026-09-02T00:00:00.000Z',
        to: '2026-09-08T23:59:59.999Z',
      });
      expect(Date.parse(lastRange().to) + 1 - Date.parse(lastRange().from)).toBe(
        DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000
      );
      expect(lastFilters()).toEqual({ action: '', entityType: '', actorId: '' });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('authorized company and branch selection', () => {
  const scopeOptions = {
    status: 'ok' as const,
    companies: [
      { id: 'company-a', legalName: 'Company A' },
      { id: 'company-b', legalName: 'Company B' },
    ],
    branches: [
      { id: 'branch-a', companyId: 'company-a', name: 'Branch A' },
      { id: 'branch-b', companyId: 'company-b', name: 'Branch B' },
    ],
  };

  it('requires a named branch, applies only on submit, and clears the pair', async () => {
    const user = userEvent.setup();
    renderScreen({ scopeOptions });
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    const before = listAuditEvents.mock.calls.length;
    await user.selectOptions(screen.getByLabelText(labelled('audit.filter.company')), 'company-a');
    expect(screen.queryByRole('option', { name: 'Branch B' })).toBeNull();
    await user.click(
      within(filterForm()).getByRole('button', { name: EN['audit.filter.apply'] as string })
    );
    expect(screen.getByText(EN['audit.filter.chooseBranch'] as string)).toBeVisible();
    expect(listAuditEvents.mock.calls.length).toBe(before);
    await user.selectOptions(screen.getByLabelText(labelled('audit.filter.branch')), 'branch-a');
    expect(listAuditEvents.mock.calls.length).toBe(before);
    await apply(user);
    expect(listAuditEvents.mock.calls.at(-1)?.[4]).toEqual({
      companyId: 'company-a',
      branchId: 'branch-a',
    });
    await user.selectOptions(screen.getByLabelText(labelled('audit.filter.company')), 'company-b');
    expect(screen.getByLabelText(labelled('audit.filter.branch'))).toHaveValue('');
    await user.click(
      within(filterForm()).getByRole('button', { name: EN['audit.filter.clear'] as string })
    );
    await waitFor(() => expect(listAuditEvents.mock.calls.at(-1)?.[4]).toBeNull());
  });

  it('waits one read for the unfiltered log, and both reads once a branch is applied', async () => {
    /*
     * With a branch applied, `listAuditEvents` re-reads the caller's companies
     * and branches before it reads the events — two server reads in sequence —
     * so a one-read ceiling would abandon it while the second was still running.
     * Without a branch it reads once and keeps the one-read ceiling.
     */
    const unavailable = EN['state.unavailable.title'] as string;
    const user = userEvent.setup();
    renderScreen({ scopeOptions });
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    await user.selectOptions(screen.getByLabelText(labelled('audit.filter.company')), 'company-a');
    await user.selectOptions(screen.getByLabelText(labelled('audit.filter.branch')), 'branch-a');

    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      listAuditEvents.mockImplementation(() => new Promise<never>(() => undefined));
      const before = listAuditEvents.mock.calls.length;
      fireEvent.click(
        within(filterForm()).getByRole('button', { name: EN['audit.filter.apply'] as string })
      );
      await waitFor(() => expect(listAuditEvents.mock.calls.length).toBeGreaterThan(before));
      expect(listAuditEvents.mock.calls.at(-1)?.[4]).toEqual({
        companyId: 'company-a',
        branchId: 'branch-a',
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS);
      });
      expect(screen.queryByText(unavailable)).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(clientReadTimeoutMs(2) - CLIENT_READ_TIMEOUT_MS);
      });
      expect(await screen.findByText(unavailable)).toBeVisible();

      // Back to the unfiltered log: one read, and the one-read ceiling.
      const cleared = listAuditEvents.mock.calls.length;
      fireEvent.click(
        within(filterForm()).getByRole('button', { name: EN['audit.filter.clear'] as string })
      );
      await waitFor(() => expect(listAuditEvents.mock.calls.length).toBeGreaterThan(cleared));
      expect(listAuditEvents.mock.calls.at(-1)?.[4]).toBeNull();
      expect(screen.queryByText(unavailable)).toBeNull();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CLIENT_READ_TIMEOUT_MS);
      });
      expect(await screen.findByText(unavailable)).toBeVisible();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps audit search usable when directory permission is absent', async () => {
    renderScreen({ scopeOptions: { status: 'unavailable', companies: [], branches: [] } });
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    expect(screen.getByText(EN['audit.filter.scopeUnavailable'] as string)).toBeVisible();
    expect(within(filterForm()).queryByRole('combobox')).toBeNull();
    expect(listAuditEvents.mock.calls.at(-1)?.[4]).toBeNull();
  });

  it('names company and branch choices in Arabic', async () => {
    renderRtl(
      withMui(
        <AuditLogScreen
          locale="ar"
          messages={ar}
          initialFrom="2026-09-01"
          initialTo="2026-09-08"
          scopeOptions={scopeOptions}
        />,
        'ar'
      )
    );
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    expect(screen.getByLabelText(labelledAr('audit.filter.company'))).toBeVisible();
    expect(screen.getByLabelText(labelledAr('audit.filter.branch'))).toBeVisible();
  });

  const actualApi = async () =>
    vi.importActual<typeof import('@/features/administration/audit/api')>(
      '@/features/administration/audit/api'
    );
  const request = { pageSize: 25 } as import('@/components/data-table/table-state').TableRequest;
  const range = { from: '2026-09-01T00:00:00.000Z', to: '2026-09-08T23:59:59.999Z' };
  const filters = { action: '', entityType: '', actorId: '' };
  function directoryReads() {
    apiGet.mockImplementation(async (path: string) => ({
      ok: true,
      data:
        path === '/api/v1/org/companies'
          ? { items: scopeOptions.companies }
          : path === '/api/v1/org/branches'
            ? { items: scopeOptions.branches }
            : { items: [], nextCursor: null, hasMore: false },
    }));
  }

  it('sends the validated resource pair and disables retries on the audited read', async () => {
    directoryReads();
    const api = await actualApi();
    const result = await api.listAuditEvents(request, null, range, filters, {
      companyId: 'company-a',
      branchId: 'branch-a',
    });
    expect(result.status).toBe('ok');
    const call = apiGet.mock.calls.find(([path]) =>
      String(path).startsWith('/api/v1/audit-events?')
    );
    const params = new URL(String(call?.[0]), 'https://example.test').searchParams;
    expect(params.get('companyId')).toBe('company-a');
    expect(params.get('branchId')).toBe('branch-a');
    expect(params.has('tenantId')).toBe(false);
    expect(call?.[1]).toEqual({ retries: 0 });
  });

  it.each([
    { companyId: 'company-a', branchId: 'branch-b' },
    { companyId: 'foreign-company', branchId: 'foreign-branch' },
  ])(
    'refuses a tampered or foreign-directory target before reading audit records: %j',
    async (target) => {
      directoryReads();
      const api = await actualApi();
      expect((await api.listAuditEvents(request, null, range, filters, target)).status).toBe(
        'denied'
      );
      expect(
        apiGet.mock.calls.some(([path]) => String(path).startsWith('/api/v1/audit-events'))
      ).toBe(false);
    }
  );

  it('does not need organization permissions for the original unfiltered audit read', async () => {
    apiGet.mockImplementation(async (path: string) =>
      path.startsWith('/api/v1/org/')
        ? { ok: false, kind: 'forbidden', correlationId: 'denied' }
        : { ok: true, data: { items: [], nextCursor: null, hasMore: false } }
    );
    const api = await actualApi();
    expect((await api.readAuditScopeOptions()).status).toBe('unavailable');
    expect((await api.listAuditEvents(request, null, range, filters)).status).toBe('ok');
    apiGet.mockClear();
    expect(
      (
        await api.listAuditEvents(request, null, range, filters, {
          companyId: 'company-a',
          branchId: 'branch-a',
        })
      ).status
    ).toBe('denied');
    expect(
      apiGet.mock.calls.some(([path]) => String(path).startsWith('/api/v1/audit-events'))
    ).toBe(false);
  });
});

describe('people by name, never by identifier (P1-32-PRE-OD-ADM6)', () => {
  const SYSTEM_ID = '33333333-3333-4333-8333-333333333333';
  const SUBJECT_ID = '44444444-4444-4444-8444-444444444444';
  const named = { ...row, actorDisplayName: 'Rana Saleh' };
  const unnamed = { ...row, id: SYSTEM_ID, seq: '4097' };
  const bySystem = {
    ...row,
    id: '55555555-5555-4555-8555-555555555555',
    seq: '4098',
    actorId: null,
    actorKind: 'system',
  };
  const aboutAccount = {
    ...row,
    id: '66666666-6666-4666-8666-666666666666',
    seq: '4099',
    actorDisplayName: 'Rana Saleh',
    action: 'iam.user.updated',
    entityType: 'iam.user_account',
    entityId: SUBJECT_ID,
    subjectDisplayName: 'Omar Haddad',
  };

  function grid(): HTMLElement {
    return screen.getByRole('grid', { name: EN['audit.title'] as string });
  }

  it('names the actor and the account a record is about, and prints no identifier', async () => {
    listAuditEvents.mockResolvedValue(okPage([named, aboutAccount]));
    renderScreen({ canReadUsers: true });
    expect(await within(grid()).findAllByText('Rana Saleh')).toHaveLength(2);
    expect(within(grid()).getByText('Omar Haddad')).toBeVisible();
    expect(document.body.textContent).not.toContain(ACTOR_ID);
    expect(document.body.textContent).not.toContain(SUBJECT_ID);
    // Names come from the read: the screen asks nobody else for them.
    expect(apiGet).not.toHaveBeenCalled();
    expect(screen.queryByTestId('audit-names-withheld')).toBeNull();
  });

  it('says a name is not available, or that the system acted, instead of an identifier', async () => {
    listAuditEvents.mockResolvedValue(okPage([unnamed, bySystem]));
    renderScreen();
    expect(await within(grid()).findByText(EN['audit.actor.unnamed'] as string)).toBeVisible();
    expect(within(grid()).getByText(EN['audit.actor.system'] as string)).toBeVisible();
    expect(document.body.textContent).not.toContain(ACTOR_ID);
    // Without the user read, the screen says why names are absent.
    expect(screen.getByTestId('audit-names-withheld')).toHaveTextContent(
      EN['audit.actor.namesWithheld'] as string
    );
  });

  it('says the same in Arabic, right to left', async () => {
    listAuditEvents.mockResolvedValue(okPage([unnamed, bySystem, aboutAccount]));
    renderRtl(
      withMui(
        <AuditLogScreen
          locale="ar"
          messages={ar}
          initialFrom="2026-09-01"
          initialTo="2026-09-08"
        />,
        'ar'
      )
    );
    const table = await screen.findByRole('grid', { name: AR['audit.title'] as string });
    expect(await within(table).findByText(AR['audit.actor.unnamed'] as string)).toBeVisible();
    expect(within(table).getByText(AR['audit.actor.system'] as string)).toBeVisible();
    expect(within(table).getByText('Omar Haddad')).toBeVisible();
    expect(screen.getByTestId('audit-clock')).toHaveTextContent(AR['audit.clock.utc'] as string);
    expect(document.documentElement.dir).toBe('rtl');
    expect(document.body.textContent).not.toContain(ACTOR_ID);
  });

  it('opens one record in a drawer that names its people, and closes back to the grid', async () => {
    listAuditEvents.mockResolvedValue(okPage([aboutAccount]));
    readAuditEvent.mockResolvedValue({
      status: 'ok',
      record: { ...aboutAccount, details: [] },
      correlationId: 'corr-d',
    });
    const user = userEvent.setup();
    renderScreen({ canReadUsers: true });
    await user.click(
      await within(grid()).findByRole('button', {
        name: new RegExp(
          `^${escape(EN['admin.open'] as string)} ${escape(EN['audit.event.iamUserUpdated'] as string)}`
        ),
      })
    );
    const drawer = await screen.findByRole('dialog', { name: EN['audit.detail.title'] as string });
    expect(readAuditEvent).toHaveBeenCalledWith(aboutAccount.id);
    expect(await within(drawer).findByText('Rana Saleh')).toBeVisible();
    expect(within(drawer).getByText('Omar Haddad')).toBeVisible();
    expect(within(drawer).getByText(EN['audit.detail.noDetails'] as string)).toBeVisible();
    expect(drawer.textContent).not.toContain(SUBJECT_ID);
    await user.click(within(drawer).getByRole('button', { name: EN['admin.close'] as string }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('says a failed record read as itself in the drawer, with a retry', async () => {
    readAuditEvent.mockResolvedValue({ status: 'unavailable', record: null, correlationId: 'c-x' });
    const user = userEvent.setup();
    renderScreen();
    await user.click(
      await within(grid()).findByRole('button', {
        name: new RegExp(`^${escape(EN['admin.open'] as string)}`),
      })
    );
    const drawer = await screen.findByRole('dialog', { name: EN['audit.detail.title'] as string });
    expect(await within(drawer).findByText(EN['state.unavailable.title'] as string)).toBeVisible();
    const before = readAuditEvent.mock.calls.length;
    await user.click(within(drawer).getByRole('button', { name: EN['action.retry'] as string }));
    await waitFor(() => expect(readAuditEvent.mock.calls.length).toBeGreaterThan(before));
  });
});

/**
 * P1-32-PRE-OD-INVG — the drawer drew a refund request's `obligationId` among
 * the details as it came: "Another detail", the machine field name, and a full
 * identifier (CP-20261012-1 new-screens run, A-07c).
 *
 * An audit record is evidence, so nothing of it is left out or rewritten: every
 * detail row the read returns is drawn, each value with the characters it came
 * with. What changed is the layout. The facts come first; the rows that point
 * at another record by its identifier come after them, in a group titled
 * "Record references", each under a label saying what kind of record it is.
 * The identifiers are therefore still drawn — the defect the run recorded is
 * NOT closed by this; closing it needs the read to name the records an event
 * concerns, which is a change to the API.
 *
 * Each case is built from the detail rows the service really writes; the
 * `appendAudit` call it copies is named beside it.
 */
describe('P1-32-PRE-OD-INVG: the drawer draws every detail, references after the facts', () => {
  const ROLE = 'a4b074be-5842-4588-909b-80055f46b76a';
  const OBLIGATION = 'b5c185cf-6953-4699-8a1c-91166a57c87b';
  const INVOICE = 'C6D296D0-7A64-47AA-9B2D-A2277B68D98C';
  const QUOTED = 'd7e3a7e1-8b75-48bb-ac3e-b3388c79ea9d';
  const PERSON = 'e8f4b8f2-9c86-49cc-bd4f-c4499d8afbae';
  const APPROVER = '1bc7ebc5-cfb9-4cff-a07c-f77cc0bdcedf';
  const ITEM = 'f9a5c9a3-ad97-4add-8e5a-d55aae9bacbf';
  const LOCATION = '0ab6dab4-bea8-4bee-9f6b-e66bbfacbdc0';
  const COMPANY = '2cd8fcd6-d0ca-4d00-b18d-088dd1cedfe0';
  const BARE = 'a4b074be58424588909b80055f46b76a';
  const SHA256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
  const MD5 = '5d41402abc4b2a76b9719d911017c592';

  interface Detail {
    readonly fieldName: string;
    readonly oldValueMasked: string | null;
    readonly newValueMasked: string | null;
    readonly valueClassification: string;
  }
  const detail = (
    fieldName: string,
    newValueMasked: string | null,
    oldValueMasked: string | null = null,
    valueClassification = 'internal'
  ): Detail => ({ fieldName, oldValueMasked, newValueMasked, valueClassification });

  async function openDrawer(
    locale: 'en' | 'ar',
    over: Record<string, unknown>,
    details: readonly Detail[]
  ): Promise<HTMLElement> {
    const T = locale === 'en' ? EN : AR;
    const record = { ...row, id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', seq: '6000', ...over };
    listAuditEvents.mockResolvedValue(okPage([record]));
    readAuditEvent.mockResolvedValue({
      status: 'ok',
      record: { ...record, details },
      correlationId: 'corr-d',
    });
    const user = userEvent.setup();
    if (locale === 'en') {
      renderScreen();
    } else {
      renderRtl(
        withMui(
          <AuditLogScreen
            locale="ar"
            messages={ar}
            initialFrom="2026-09-01"
            initialTo="2026-09-08"
          />,
          'ar'
        )
      );
    }
    const table = await screen.findByRole('grid', { name: T['audit.title'] as string });
    await user.click(
      await within(table).findByRole('button', {
        name: new RegExp(`^${escape(T['admin.open'] as string)}`),
      })
    );
    const drawer = await screen.findByRole('dialog', { name: T['audit.detail.title'] as string });
    await within(drawer).findByText(T['audit.detail.details'] as string, { selector: 'dt' });
    return drawer;
  }
  /** The block under "Details". */
  const detailsBlock = (drawer: HTMLElement, locale: 'en' | 'ar'): HTMLElement =>
    within(drawer).getByText((locale === 'en' ? EN : AR)['audit.detail.details'] as string, {
      selector: 'dt',
    }).nextElementSibling as HTMLElement;

  /** A row as drawn: its field, the lines above its value, and each value's own characters. */
  interface Drawn {
    readonly field: string | null;
    readonly label: string;
    readonly code: string | null;
    readonly old: string | null;
    readonly new: string | null;
  }
  const verbatim = (item: Element, which: 'old' | 'new'): string | null =>
    item.querySelector(`[data-audit-value="${which}"] [data-audit-verbatim]`)?.textContent ?? null;
  const drawnIn = (scope: Element | null): Drawn[] =>
    scope === null
      ? []
      : [...scope.querySelectorAll('[data-testid="audit-detail-row"]')].map((item) => ({
          field: item.getAttribute('data-field'),
          label: item.children[0]?.textContent ?? '',
          code: item.children.length === 3 ? (item.children[1]?.textContent ?? '') : null,
          old: verbatim(item, 'old'),
          new: verbatim(item, 'new'),
        }));
  const facts = (block: HTMLElement) =>
    drawnIn(block.querySelector('[data-testid="audit-detail-facts"]'));
  const references = (block: HTMLElement) =>
    drawnIn(block.querySelector('[data-testid="audit-detail-references"]'));
  /** What a row with a label of its own looks like, and one without. */
  const named = (
    field: string,
    label: string,
    value: string | null,
    old: string | null = null
  ) => ({
    field,
    label,
    code: null,
    old,
    new: value,
  });
  const unnamed = (
    locale: 'en' | 'ar',
    kind: 'audit.field.other' | 'audit.reference.other',
    field: string,
    value: string | null,
    old: string | null = null
  ) => {
    const T = locale === 'en' ? EN : AR;
    return {
      field,
      label: T[kind] as string,
      code: `${T['audit.detail.fieldCode'] as string} ${field}`,
      old,
      new: value,
    };
  };
  /** Every row the read returned is drawn once, with its values intact. */
  function expectNothingLost(block: HTMLElement, details: readonly Detail[]): void {
    const key = (field: string | null, old: string | null, value: string | null) =>
      JSON.stringify([field, old, value]);
    const drawn = drawnIn(block);
    expect(drawn).toHaveLength(details.length);
    expect(drawn.map((entry) => key(entry.field, entry.old, entry.new)).sort()).toEqual(
      details
        .map((entry) => key(entry.fieldName, entry.oldValueMasked, entry.newValueMasked))
        .sort()
    );
    // A row is in one group or the other, never in both and never outside them.
    expect(facts(block).length + references(block).length).toBe(details.length);
  }

  for (const locale of ['en', 'ar'] as const) {
    const T = locale === 'en' ? EN : AR;

    // `iam.role.permission_added` — access-administration-service.ts, appendAudit at :286.
    it(`${locale}: a permission added to a role: the permission and its effect, then the role's reference`, async () => {
      const details = [
        detail('role_id', ROLE),
        detail('permission_code', 'inv.stock.read', null, 'public'),
        detail('effect', 'allow', null, 'public'),
      ];
      const drawer = await openDrawer(
        locale,
        { action: 'iam.role.permission_added', entityType: 'iam.role_permission' },
        details
      );
      const block = detailsBlock(drawer, locale);
      expect(facts(block)).toEqual([
        named('permission_code', T['audit.field.permissionCode'] as string, 'inv.stock.read'),
        named('effect', T['audit.field.effect'] as string, 'allow'),
      ]);
      expect(references(block)).toEqual([
        named('role_id', T['audit.reference.role'] as string, ROLE),
      ]);
      // The group is titled and explained, in the page language, and comes after the facts.
      const group = within(block).getByTestId('audit-detail-references');
      expect(
        within(group).getByRole('heading', { name: T['audit.detail.references'] as string })
      ).toBeVisible();
      expect(within(group).getByText(T['audit.detail.referencesHint'] as string)).toBeVisible();
      const list = within(block).getByTestId('audit-detail-facts');
      expect(list.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expectNothingLost(block, details);
    });

    /*
     * `iam.role.permission_changed` — the same service, appendAudit at :325. It
     * writes no role: the record says which permission changed and not on which
     * role, and nothing this screen reads can add it. Held here as it is; the
     * missing role is a gap in what the service records.
     */
    it(`${locale}: a permission's effect changed: both effects, and no reference because none is written`, async () => {
      const details = [
        detail('permission_code', 'sal.invoice.issue', null, 'public'),
        detail('effect', 'deny', 'allow', 'public'),
      ];
      const drawer = await openDrawer(
        locale,
        { action: 'iam.role.permission_changed', entityType: 'iam.role_permission' },
        details
      );
      const block = detailsBlock(drawer, locale);
      expect(facts(block)).toEqual([
        named('permission_code', T['audit.field.permissionCode'] as string, 'sal.invoice.issue'),
        named('effect', T['audit.field.effect'] as string, 'deny', 'allow'),
      ]);
      expect(within(block).queryByTestId('audit-detail-references')).toBeNull();
      expect(within(block).queryByText(T['audit.detail.references'] as string)).toBeNull();
      expectNothingLost(block, details);
    });

    // `iam.role.permission_removed` — the same service, appendAudit at :364.
    it(`${locale}: a permission removed from a role: which permission, the effect it had, and the role`, async () => {
      const details = [
        detail('role_id', ROLE),
        detail('permission_code', 'iam.user.invite', null, 'public'),
        detail('effect', null, 'allow', 'public'),
      ];
      const drawer = await openDrawer(
        locale,
        { action: 'iam.role.permission_removed', entityType: 'iam.role_permission' },
        details
      );
      const block = detailsBlock(drawer, locale);
      expect(facts(block)).toEqual([
        named('permission_code', T['audit.field.permissionCode'] as string, 'iam.user.invite'),
        named('effect', T['audit.field.effect'] as string, null, 'allow'),
      ]);
      expect(references(block)).toEqual([
        named('role_id', T['audit.reference.role'] as string, ROLE),
      ]);
      expectNothingLost(block, details);
    });

    // `iam.grant.issued` (:464) and `iam.grant.revoked` (:526): the grantee is `user_id`.
    it(`${locale}: a role granted and a grant revoked keep the grantee's reference`, async () => {
      const issued = [
        detail('user_id', PERSON),
        detail('role_code', 'stock_approver', null, 'public'),
        detail('scope_mode', 'branches', null, 'public'),
        detail('scope_count', '2'),
      ];
      const drawer = await openDrawer(
        locale,
        { action: 'iam.grant.issued', entityType: 'iam.role_grant' },
        issued
      );
      const block = detailsBlock(drawer, locale);
      expect(facts(block)).toEqual([
        unnamed(locale, 'audit.field.other', 'role_code', 'stock_approver'),
        unnamed(locale, 'audit.field.other', 'scope_mode', 'branches'),
        unnamed(locale, 'audit.field.other', 'scope_count', '2'),
      ]);
      expect(references(block)).toEqual([
        named('user_id', T['audit.reference.userAccount'] as string, PERSON),
      ]);
      expectNothingLost(block, issued);
    });

    // `inv.stock_adjustment.requested` (inventory-adjustment-service.ts :186) and its decision (:304).
    it(`${locale}: a stock adjustment keeps its item, its location and who asked for it`, async () => {
      const details = [
        detail('itemId', ITEM),
        detail('locationId', LOCATION),
        detail('direction', 'remove'),
        detail('quantity', '0.250'),
        detail('reason', `Count of 9 October; same shelf as ${QUOTED}`),
        detail('status', 'approved', 'pending_approval'),
        detail('requestedBy', PERSON),
        detail('approvedBy', APPROVER),
      ];
      const drawer = await openDrawer(
        locale,
        { action: 'inv.stock_adjustment.approved', entityType: 'inv.stock_adjustment' },
        details
      );
      const block = detailsBlock(drawer, locale);
      expect(facts(block)).toEqual([
        unnamed(locale, 'audit.field.other', 'direction', 'remove'),
        named('quantity', T['audit.field.quantity'] as string, '0.250'),
        // The sentence somebody typed is drawn word for word, the identifier it quotes included.
        named(
          'reason',
          T['audit.field.reason'] as string,
          `Count of 9 October; same shelf as ${QUOTED}`
        ),
        named('status', T['audit.field.status'] as string, 'approved', 'pending_approval'),
      ]);
      expect(references(block)).toEqual([
        named('itemId', T['audit.reference.item'] as string, ITEM),
        named('locationId', T['audit.reference.location'] as string, LOCATION),
        named('requestedBy', T['audit.reference.requestedBy'] as string, PERSON),
        named('approvedBy', T['audit.reference.approvedBy'] as string, APPROVER),
      ]);
      expectNothingLost(block, details);
    });

    /*
     * `sal.refund_request.approved` — refund-service.ts :488, the record of the
     * A-07c screenshot. The obligation's identifier is STILL drawn: under
     * "Refund obligation" among the references, no longer as "Another detail"
     * among the facts. The read cannot say which obligation by name.
     */
    it(`${locale}: an approved refund: amount, state and currency, then the obligation's reference`, async () => {
      const details = [
        detail('amount', '***', null, 'restricted'),
        detail('approvalState', 'approved', 'pending'),
        detail('currency', 'JOD'),
        detail('obligationId', OBLIGATION),
      ];
      const drawer = await openDrawer(
        locale,
        { action: 'sal.refund_request.approved', entityType: 'sal.refund_request' },
        details
      );
      const block = detailsBlock(drawer, locale);
      expect(facts(block)).toEqual([
        named('amount', T['audit.field.amount'] as string, '***'),
        unnamed(locale, 'audit.field.other', 'approvalState', 'approved', 'pending'),
        named('currency', T['audit.field.currency'] as string, 'JOD'),
      ]);
      expect(references(block)).toEqual([
        named('obligationId', T['audit.reference.refundObligation'] as string, OBLIGATION),
      ]);
      expectNothingLost(block, details);
    });

    // A reference whose kind has no label of its own, and one in every spelling.
    it(`${locale}: any identifier under a field named for one is a reference, drawn as it came`, async () => {
      const details = [
        detail('invoiceId', INVOICE),
        detail('uomId', BARE),
        // inventory-material-service.ts :1171 — `ids.join(',')`.
        detail('releasedReservationIds', `${ITEM},${LOCATION}`),
        detail('blocker_event_id', QUOTED),
        detail('lines[0].itemId', ITEM),
        detail('payerPartnerId', PERSON, APPROVER),
      ];
      const drawer = await openDrawer(
        locale,
        { action: 'inv.material_request.fulfilled', entityType: 'inv.material_request' },
        details
      );
      const block = detailsBlock(drawer, locale);
      expect(facts(block)).toEqual([]);
      expect(within(block).queryByTestId('audit-detail-facts')).toBeNull();
      expect(references(block)).toEqual([
        named('invoiceId', T['audit.reference.invoice'] as string, INVOICE),
        named('uomId', T['audit.reference.unit'] as string, BARE),
        unnamed(locale, 'audit.reference.other', 'releasedReservationIds', `${ITEM},${LOCATION}`),
        unnamed(locale, 'audit.reference.other', 'blocker_event_id', QUOTED),
        unnamed(locale, 'audit.reference.other', 'lines[0].itemId', ITEM),
        named('payerPartnerId', T['audit.reference.payer'] as string, PERSON, APPROVER),
      ]);
      expectNothingLost(block, details);
    });
  }

  /*
   * `org.company.settings_updated` — organization-settings-service.ts :310: the
   * value is `JSON.stringify(input.settingValue)`, a structured value, and it
   * may hold an identifier. It is one fact, drawn whole.
   */
  it('a setting value is drawn whole, with every member it was written with', async () => {
    const written =
      `{"defaultWarehouseId":"${LOCATION}","rounding":"half_up","limit":12.50,` +
      `"approvers":["${PERSON}","${APPROVER}"],"note":"replaces ${QUOTED}"}`;
    const details = [
      detail('company_id', COMPANY),
      detail('setting_key', 'inventory.defaults', null, 'public'),
      detail('version', '4', null, 'public'),
      detail('setting_value', written, '{ "rounding": "half_even",\n  "limit": 10.00 }'),
    ];
    const drawer = await openDrawer(
      'en',
      { action: 'org.company.settings_updated', entityType: 'org.company_setting' },
      details
    );
    const block = detailsBlock(drawer, 'en');
    expect(facts(block)).toEqual([
      named('setting_key', EN['audit.field.settingKey'] as string, 'inventory.defaults'),
      named('version', EN['audit.field.version'] as string, '4'),
      named(
        'setting_value',
        EN['audit.field.settingValue'] as string,
        written,
        '{ "rounding": "half_even",\n  "limit": 10.00 }'
      ),
    ]);
    expect(references(block)).toEqual([
      named('company_id', EN['audit.reference.company'] as string, COMPANY),
    ]);
    expectNothingLost(block, details);
  });

  it('numbers, digests, file names and long hexadecimal values are facts, character for character', async () => {
    // A value that contains an identifier-shaped run inside a longer one.
    const LONG = `${SHA256}${OBLIGATION.replace(/-/g, '')}`;
    const details = [
      // Numbers a person knows a record by, though three of the names end in "id".
      detail('vatId', '100234567'),
      detail('national_id', '9871234567'),
      detail('registration_id', OBLIGATION),
      detail('customer_id', '70411'),
      detail('receiptNumber', '000031'),
      // report-snapshot-service.ts :462 — a digest, not an identifier.
      detail('rows_digest', SHA256),
      detail('checksum', MD5),
      detail('signature', LONG),
      detail('file_name', 'stock-count 2026-10-09.pdf'),
      detail('note', `  kept as typed: ${QUOTED}  `),
    ];
    const drawer = await openDrawer(
      'en',
      { action: 'rpt.report_snapshot.saved', entityType: 'rpt.report_snapshot' },
      details
    );
    const block = detailsBlock(drawer, 'en');
    expect(facts(block)).toEqual(
      details.map((entry) =>
        unnamed('en', 'audit.field.other', entry.fieldName, entry.newValueMasked)
      )
    );
    expect(within(block).queryByTestId('audit-detail-references')).toBeNull();
    expectNothingLost(block, details);
  });

  for (const locale of ['en', 'ar'] as const) {
    const T = locale === 'en' ? EN : AR;
    // discount-threshold-service.ts :254, report-configuration-service.ts :287,
    // attachment-service.ts :896, export-authorization-service.ts :197.
    it(`${locale}: the service's own vocabulary is labelled among the facts, its code as written`, async () => {
      const details = [
        detail('requiredPermission', 'quo.discount.approve'),
        detail('exportPermissionCode', 'rpt.export'),
        detail('entity_type', 'iam.role', null, 'public'),
        detail('entity_id', ROLE),
        detail('resource', 'crm.customers', null, 'public'),
        detail('fields', 'displayName,phone', null, 'public'),
        detail('trigger', 'sal.refund_request.approved'),
      ];
      const drawer = await openDrawer(
        locale,
        { action: 'shared.attachment.linked', entityType: 'shared.attachment_link' },
        details
      );
      const block = detailsBlock(drawer, locale);
      expect(facts(block)).toEqual([
        named(
          'requiredPermission',
          T['audit.field.requiredPermission'] as string,
          'quo.discount.approve'
        ),
        named(
          'exportPermissionCode',
          T['audit.field.exportPermissionCode'] as string,
          'rpt.export'
        ),
        named('entity_type', T['audit.field.entityType'] as string, 'iam.role'),
        named('resource', T['audit.field.resource'] as string, 'crm.customers'),
        unnamed(locale, 'audit.field.other', 'fields', 'displayName,phone'),
        unnamed(locale, 'audit.field.other', 'trigger', 'sal.refund_request.approved'),
      ]);
      expect(references(block)).toEqual([
        unnamed(locale, 'audit.reference.other', 'entity_id', ROLE),
      ]);
      // A record type is said in the drawer's own words, and its code follows as written.
      const type = within(block)
        .getAllByTestId('audit-detail-row')
        .find((item) => item.getAttribute('data-field') === 'entity_type') as HTMLElement;
      expect(type.lastElementChild).toHaveTextContent(`${T['audit.record.iamRole']} (iam.role)`);
      expectNothingLost(block, details);
    });
  }

  it('a record type the catalogue has no name for is said by its part of the product, with its code', async () => {
    const details = [detail('entity_type', 'wo.work_order', null, 'public')];
    const drawer = await openDrawer(
      'en',
      { action: 'shared.attachment.linked', entityType: 'shared.attachment_link' },
      details
    );
    const block = detailsBlock(drawer, 'en');
    const words = (EN['audit.record.otherIn'] as string).replace(
      '{area}',
      EN['audit.area.wo'] as string
    );
    const [type] = within(block).getAllByTestId('audit-detail-row') as [HTMLElement];
    expect(type.lastElementChild).toHaveTextContent(`${words} (wo.work_order)`);
    expectNothingLost(block, details);
  });

  it('the service writes 123 identifier fields; the frequent ones have a label of their own', () => {
    // Counted from the writers when this was written; the labelled ones are held here.
    const labelled = NAMED_AUDIT_REFERENCES.filter((field) => !/By$/.test(field));
    expect(labelled).toHaveLength(47);
    expect(NAMED_AUDIT_REFERENCES.filter((field) => /By$/.test(field))).toEqual([
      'requestedBy',
      'approvedBy',
      'countedBy',
      'createdBy',
    ]);
  });

  /*
   * The property the drawer is held to: whatever rows the read returns, each
   * (field, old value, new value) is drawn exactly once with its characters
   * intact. The rows are made by a small fixed-seed generator from the field
   * names and value shapes above, and a few a writer would never produce —
   * padding, line breaks, markup-looking text, an empty string, the same field
   * twice — so that neither group, nor any rule, is the only thing exercised.
   */
  describe('whatever the read returns, every row is drawn once with its values intact', () => {
    function arbitraryDetails(seed: number, count: number): Detail[] {
      let state = seed >>> 0;
      const next = (): number => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return state;
      };
      const pick = <T,>(pool: readonly T[]): T => pool[next() % pool.length] as T;
      const hex = (length: number): string =>
        Array.from({ length }, () => '0123456789abcdef'.charAt(next() % 16)).join('');
      const uuid = (): string => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
      const FIELDS = [
        'status',
        'reason',
        'amount',
        'note',
        'setting_value',
        'permission_code',
        'entity_type',
        'resource',
        'vatId',
        'national_id',
        'role_id',
        'user_id',
        'itemId',
        'locationId',
        'obligationId',
        'requestedBy',
        'approvedBy',
        'blocker_event_id',
        'lines[0].itemId',
        'allocation.id',
        'rows_digest',
        'file_name',
        'customer_id',
        'trigger',
        'releasedReservationIds',
        'paid',
      ];
      const VALUES: readonly (() => string)[] = [
        uuid,
        () => uuid().toUpperCase(),
        () => hex(32),
        () => hex(64),
        () => `${uuid()},${uuid()}`,
        () => `see ${uuid()} and ${hex(40)}`,
        () => `{"id":"${uuid()}","total":"4.9390","tax":0.6170,"by":{"partnerId":"${uuid()}"}}`,
        () => `["${uuid()}","${uuid()}"]`,
        () => '  padded with spaces  ',
        () => 'line one\nline two\ttabbed',
        () => '',
        () => '***',
        () => 'سبب مكتوب بالعربية',
        () => '<b>not markup</b> & "quoted"',
        () => String(next() % 100000),
        () => 'inv.stock.read',
        () => 'iam.role',
        () => 'report 2026-10.pdf',
        () => '[reference]',
        () => '—',
      ];
      // One value in three is an identifier in some spelling, so both groups fill.
      const IDENTIFIERS = VALUES.slice(0, 3).concat(VALUES.slice(4, 5));
      return Array.from({ length: count }, () => {
        const shape = next() % 8;
        const value = pick(next() % 3 === 0 ? IDENTIFIERS : VALUES)();
        return detail(
          pick(FIELDS),
          shape === 0 ? null : value,
          shape < 3 ? pick(VALUES)() : null,
          pick(['public', 'internal', 'restricted'])
        );
      });
    }

    it.each([
      ['en', 20261012, 40],
      ['en', 574, 40],
      ['ar', 153, 40],
    ] as const)('%s, seed %i: %i rows', async (locale, seed, count) => {
      const details = arbitraryDetails(seed, count);
      // The generator really does produce both groups, nulls and repeated fields.
      expect(new Set(details.map((entry) => entry.fieldName)).size).toBeLessThan(count);
      expect(details.some((entry) => entry.newValueMasked === null)).toBe(true);
      const drawer = await openDrawer(
        locale,
        { action: 'zzz.thing.happened', entityType: 'zzz.thing' },
        details
      );
      const block = detailsBlock(drawer, locale);
      expect(facts(block).length).toBeGreaterThan(0);
      expect(references(block).length).toBeGreaterThan(0);
      expectNothingLost(block, details);
      // Within each group the rows keep the order the read gave them.
      const order = (rows: readonly Drawn[]) =>
        rows.map((entry) => JSON.stringify([entry.field, entry.old, entry.new]));
      const given = details.map((entry) =>
        JSON.stringify([entry.fieldName, entry.oldValueMasked, entry.newValueMasked])
      );
      for (const group of [order(facts(block)), order(references(block))]) {
        let from = 0;
        for (const one of group) {
          const at = given.indexOf(one, from);
          expect(at, one).toBeGreaterThanOrEqual(from);
          from = at + 1;
        }
      }
    });
  });

  /*
   * The grid. Its last column is the support reference, which at runtime is an
   * identifier (the fixture above the file uses a short word for it). This
   * holds what the product does today and is not a statement that it should:
   * the column draws the reference as it came. Whether a support reference may
   * be shown, and in what form, is the open Owner decision recorded in the
   * route checklist (`P1-32-PRE-OD-INVG`); nothing is changed for it here.
   */
  it('the grid draws no detail; its support reference column draws the reference as it came', async () => {
    const SUPPORT = '2628d9cb-61a0-401f-a5ad-1e485db15edd';
    const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
    const record = {
      ...row,
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      seq: '6000',
      action: 'sal.refund_request.approved',
      entityType: 'sal.refund_request',
      entityId: OBLIGATION,
      correlationId: SUPPORT,
    };
    listAuditEvents.mockResolvedValue(okPage([record]));
    renderScreen();
    const table = await screen.findByRole('grid', { name: EN['audit.title'] as string });
    await within(table).findByText('Another change in sales and payments');
    const text = table.textContent ?? '';
    // No identifier of the record, of its actor or of what it is about, and no code.
    for (const hidden of [record.id, ACTOR_ID, OBLIGATION, 'sal.refund_request']) {
      expect(text, hidden).not.toContain(hidden);
    }
    // The one identifier the grid does draw: the support reference, under its heading.
    expect(
      within(table).getByRole('columnheader', { name: EN['audit.column.correlationId'] as string })
    ).toBeVisible();
    expect(within(table).getByText(SUPPORT)).toBeVisible();
    expect(text.match(UUID_ANYWHERE)).toEqual([SUPPORT]);
  });
});

/**
 * Codes in words (`P1-32-PRE-OD-ADM6`): the action, the record type and each
 * detail's field are named from the catalogue, in both languages; a code the
 * catalogue does not name is said by its part of the product, or plainly; and
 * a code is printed only in the drawer, under a label saying it is a reference
 * for support.
 */
describe('audit codes in words, never as the primary text (P1-32-PRE-OD-ADM6)', () => {
  const roleChanged = {
    ...row,
    id: '88888888-8888-4888-8888-888888888888',
    seq: '5000',
    action: 'iam.role.updated',
    entityType: 'iam.role',
  };
  const inventoryCount = {
    ...row,
    id: '99999999-9999-4999-8999-999999999999',
    seq: '5001',
    action: 'inv.stock_count.closed',
    entityType: 'inv.stock_count',
  };
  const unknownPart = {
    ...row,
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    seq: '5002',
    action: 'zzz.thing.happened',
    entityType: 'zzz.thing',
  };
  const RAW = [
    'iam.audit.viewed',
    'iam.audit_record',
    'iam.role.updated',
    'iam.role',
    'inv.stock_count.closed',
    'inv.stock_count',
    'zzz.thing.happened',
    'zzz.thing',
  ];

  function grid(name = EN['audit.title'] as string): HTMLElement {
    return screen.getByRole('grid', { name });
  }

  it('names known actions and record types, and says unknown ones by their part of the product', async () => {
    listAuditEvents.mockResolvedValue(okPage([row, roleChanged, inventoryCount, unknownPart]));
    renderScreen();
    const table = await screen.findByRole('grid', { name: EN['audit.title'] as string });
    expect(
      await within(table).findByText(EN['audit.event.iamAuditViewed'] as string)
    ).toBeVisible();
    expect(within(table).getByText(EN['audit.record.iamAuditRecord'] as string)).toBeVisible();
    expect(within(table).getByText(EN['audit.event.iamRoleUpdated'] as string)).toBeVisible();
    expect(within(table).getByText(EN['audit.record.iamRole'] as string)).toBeVisible();
    expect(within(table).getByText('Another change in inventory')).toBeVisible();
    expect(within(table).getByText('A record in inventory')).toBeVisible();
    expect(within(table).getByText(EN['audit.event.other'] as string)).toBeVisible();
    expect(within(table).getByText(EN['audit.record.other'] as string)).toBeVisible();
    for (const code of RAW) expect(table.textContent, code).not.toContain(code);
    // The row action names the action in words too.
    expect(
      within(grid()).getAllByRole('button', {
        name: new RegExp(
          `^${escape(EN['admin.open'] as string)} ${escape(EN['audit.event.iamRoleUpdated'] as string)}`
        ),
      })
    ).toHaveLength(1);
    // The support reference keeps its label.
    expect(
      within(table).getByRole('columnheader', { name: EN['audit.column.correlationId'] as string })
    ).toBeVisible();
  });

  it('names them in Arabic, right to left', async () => {
    listAuditEvents.mockResolvedValue(okPage([roleChanged, inventoryCount, unknownPart]));
    renderRtl(
      withMui(
        <AuditLogScreen
          locale="ar"
          messages={ar}
          initialFrom="2026-09-01"
          initialTo="2026-09-08"
        />,
        'ar'
      )
    );
    const table = await screen.findByRole('grid', { name: AR['audit.title'] as string });
    expect(
      await within(table).findByText(AR['audit.event.iamRoleUpdated'] as string)
    ).toBeVisible();
    expect(within(table).getByText(AR['audit.record.iamRole'] as string)).toBeVisible();
    expect(
      within(table).getByText(
        (AR['audit.event.otherIn'] as string).replace('{area}', AR['audit.area.inv'] as string)
      )
    ).toBeVisible();
    expect(
      within(table).getByText(
        (AR['audit.record.otherIn'] as string).replace('{area}', AR['audit.area.inv'] as string)
      )
    ).toBeVisible();
    expect(within(table).getByText(AR['audit.event.other'] as string)).toBeVisible();
    for (const code of RAW) expect(table.textContent, code).not.toContain(code);
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('puts words first in the drawer, and each code only under a label naming it a support reference', async () => {
    listAuditEvents.mockResolvedValue(okPage([roleChanged]));
    readAuditEvent.mockResolvedValue({
      status: 'ok',
      record: {
        ...roleChanged,
        details: [
          {
            fieldName: 'status',
            oldValueMasked: 'active',
            newValueMasked: 'archived',
            valueClassification: 'internal',
          },
          {
            fieldName: 'role_code',
            oldValueMasked: null,
            newValueMasked: 'R-1',
            valueClassification: 'internal',
          },
        ],
      },
      correlationId: 'corr-d',
    });
    const user = userEvent.setup();
    renderScreen();
    await user.click(
      await within(grid()).findByRole('button', {
        name: new RegExp(`^${escape(EN['admin.open'] as string)}`),
      })
    );
    const drawer = await screen.findByRole('dialog', { name: EN['audit.detail.title'] as string });
    expect(
      await within(drawer).findByText(EN['audit.event.iamRoleUpdated'] as string)
    ).toBeVisible();
    expect(within(drawer).getByText(EN['audit.record.iamRole'] as string)).toBeVisible();
    const term = (key: string) => {
      const dt = within(drawer).getByText(EN[key] as string, { selector: 'dt' });
      return dt.nextElementSibling as HTMLElement;
    };
    expect(term('audit.detail.actionCode')).toHaveTextContent('iam.role.updated');
    expect(term('audit.detail.entityCode')).toHaveTextContent(/^iam\.role$/);
    expect(term('audit.column.correlationId')).toHaveTextContent('corr-9');
    // A named field is said in words, with no code; an unnamed one is "Another
    // detail" with its code under the support label.
    const details = within(drawer).getAllByRole('listitem');
    expect(details).toHaveLength(2);
    expect(details[0]).toHaveTextContent(EN['audit.field.status'] as string);
    expect(
      within(details[0] as HTMLElement).queryByText(EN['audit.detail.fieldCode'] as string)
    ).toBeNull();
    expect(details[1]).toHaveTextContent(EN['audit.field.other'] as string);
    expect(details[1]).toHaveTextContent(`${EN['audit.detail.fieldCode'] as string} role_code`);
  });

  it('names only codes the service writes, under the record type it writes them with', () => {
    // Located from this file, not from the directory the run started in, and
    // written from the repository root so the change-scope scan reads it whole.
    const here = dirname(fileURLToPath(import.meta.url));
    const catalogue = readFileSync(
      join(here, '..', '..', '..', 'apps', 'api', 'src', 'server', 'auth', 'audit-actions.ts'),
      'utf8'
    );
    // Each definition from its `code` to the next one, so a comment between its
    // fields cannot hide it; every definition must name its record type.
    const starts = [...catalogue.matchAll(/^\s*code: '([^']+)',$/gm)];
    const written = new Map<string, string>();
    const untyped: string[] = [];
    starts.forEach((start, index) => {
      const body = catalogue.slice(start.index, starts[index + 1]?.index ?? catalogue.length);
      const type = /entityType: '([^']+)'/.exec(body)?.[1];
      if (type === undefined) untyped.push(start[1] as string);
      else written.set(start[1] as string, type);
    });
    expect(untyped, 'every definition names its record type').toEqual([]);
    expect(written.size, 'no code is defined twice').toBe(starts.length);
    expect(written.has('svc.discount.authorized')).toBe(true);
    expect(written.size).toBeGreaterThan(300);
    const entities = new Set(written.values());
    for (const code of NAMED_AUDIT_ACTIONS) {
      expect(written.has(code), `${code} is a code the service writes`).toBe(true);
    }
    for (const type of NAMED_AUDIT_ENTITIES) {
      expect(entities.has(type), `${type} is a record type the service writes`).toBe(true);
    }
    // Every identity, access and organisation action and record type is named.
    for (const [code, type] of written) {
      if (!/^(iam|org)\./.test(code)) continue;
      expect(NAMED_AUDIT_ACTIONS, `${code} is named`).toContain(code);
      expect(NAMED_AUDIT_ENTITIES, `${type} is named`).toContain(type);
    }
  });
});

describe('the clock the log is read and drawn on (P1-32-PRE-OD-ADM6)', () => {
  /** The times drawn on `zone`'s clock inside `root`, as written. */
  const momentsIn = (root: HTMLElement, zone: string) =>
    [...root.querySelectorAll(`[data-moment-zone="${zone}"] > bdi:first-child`)].map(
      (node) => node.textContent ?? ''
    );

  function mountInBranch(snapshot = branchSnapshot()) {
    return renderLtr(
      withMui(
        inBranch(
          <>
            <BranchSwitch to="all" label="everywhere" />
            <AuditLogScreen
              locale="en"
              messages={en}
              initialFrom="2026-09-01"
              initialTo="2026-09-08"
            />
          </>,
          { snapshot }
        )
      )
    );
  }

  it('reads whole days and draws every time on the working branch clock, and names it', async () => {
    mountInBranch();
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    // Asia/Riyadh is three hours ahead of UTC all year.
    expect(TEST_BRANCH.timezone).toBe('Asia/Riyadh');
    expect(lastRange()).toEqual({
      from: '2026-08-31T21:00:00.000Z',
      to: '2026-09-08T20:59:59.999Z',
    });
    const table = screen.getByRole('grid', { name: EN['audit.title'] as string });
    // 09:00 UTC is midday on the branch clock, written with its offset.
    await waitFor(() =>
      expect(momentsIn(table, 'Asia/Riyadh')).toContainEqual(expect.stringMatching(/12:00$/))
    );
    expect(within(table).getByText('GMT+3')).toBeVisible();
    expect(screen.getByTestId('audit-clock').textContent).toMatch(/GMT\+3/);
  });

  it('opens on the branch clock today when the route page gives its moment of opening', async () => {
    renderLtr(
      withMui(
        inBranch(
          <AuditLogScreen
            locale="en"
            messages={en}
            initialFrom="2026-09-01"
            initialTo="2026-09-08"
            openedAt="2026-09-08T22:30:00.000Z"
          />
        )
      )
    );
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    // 22:30 UTC on the eighth is already the ninth in Riyadh: the window ends
    // on the branch's today, and today is the seventh of its seven days.
    expect(lastRange()).toEqual({
      from: '2026-09-02T21:00:00.000Z',
      to: '2026-09-09T20:59:59.999Z',
    });
  });

  it('falls back to UTC under all branches, says so, and reads the window again', async () => {
    const user = userEvent.setup();
    mountInBranch(branchSnapshot([TEST_BRANCH, OTHER_BRANCH]));
    await user.click(screen.getByRole('button', { name: 'everywhere' }));
    await waitFor(() =>
      expect(lastRange()).toEqual({
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-09-08T23:59:59.999Z',
      })
    );
    expect(screen.getByTestId('audit-clock')).toHaveTextContent(EN['audit.clock.utc'] as string);
    const table = screen.getByRole('grid', { name: EN['audit.title'] as string });
    await waitFor(() =>
      expect(momentsIn(table, 'UTC')).toContainEqual(expect.stringMatching(/09:00$/))
    );
    expect(within(table).getByText('UTC')).toBeVisible();
  });
});

describe('paging, empty and refused reads on the grid (P1-32-PRE-OD-ADM6)', () => {
  it('walks the server cursor with Next and Previous, and never counts the records', async () => {
    const first = { ...row, actorDisplayName: 'Hana First' };
    const second = {
      ...row,
      id: '77777777-7777-4777-8777-777777777777',
      actorDisplayName: 'Omar Second',
    };
    listAuditEvents.mockImplementation(async (_request: unknown, cursor: string | null) =>
      cursor === 'cursor-2'
        ? { ...okPage([second]), hasMore: false }
        : { ...okPage([first]), nextCursor: 'cursor-2', hasMore: true }
    );
    const user = userEvent.setup();
    renderScreen();
    const table = await screen.findByRole('grid');
    expect(await within(table).findByText('Hana First')).toBeVisible();
    const firstCursor = listAuditEvents.mock.calls[0]?.[1];
    expect(firstCursor).not.toBe('cursor-2');

    const next = screen.getByRole('button', { name: EN['table.nextPage'] as string });
    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);
    expect(await within(table).findByText('Omar Second')).toBeVisible();
    expect(within(table).queryByText('Hana First')).toBeNull();
    expect(listAuditEvents.mock.calls.at(-1)?.[1]).toBe('cursor-2');

    const previous = screen.getByRole('button', { name: EN['table.previousPage'] as string });
    await waitFor(() => expect(previous).toBeEnabled());
    await user.click(previous);
    expect(await within(table).findByText('Hana First')).toBeVisible();
    expect(within(table).queryByText('Omar Second')).toBeNull();
    // The first page is asked for again from the start, not from the cursor.
    expect(listAuditEvents.mock.calls.at(-1)?.[1]).toBe(firstCursor);
    expect(screen.queryByText(/\bof\b \d+/)).toBeNull();
  });

  it('says a refused read as a refusal, never as an empty log', async () => {
    listAuditEvents.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-denied',
    });
    renderScreen();
    expect(await screen.findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByTestId('audit-empty')).toBeNull();
    expect(screen.queryByRole('grid')).toBeNull();
  });

  it('says an empty period, and an empty filtered period with a way to clear it', async () => {
    listAuditEvents.mockResolvedValue(okPage([]));
    const user = userEvent.setup();
    renderScreen();
    expect(await screen.findByText(EN['audit.empty.title'] as string)).toBeVisible();
    await user.type(
      within(filterForm()).getByLabelText(labelled('audit.filter.action')),
      'iam.audit.viewed'
    );
    await apply(user);
    const empty = await screen.findByTestId('audit-empty-filtered');
    expect(empty).toHaveTextContent(EN['audit.empty.filteredTitle'] as string);
    await user.click(
      within(empty).getByRole('button', { name: EN['audit.filter.clear'] as string })
    );
    await waitFor(() => expect(lastFilters()).toEqual({ action: '', entityType: '', actorId: '' }));
  });
});

/**
 * Codes a page refuses without — ALL of them — beyond what its navigation entry
 * already asks for, read from the pages themselves: departments and employees
 * list one branch's records and refuse without the branch read. The settings
 * pages need no entry here: each needs any one of its entry's `permission` and
 * `orPermissions`, which the navigation entry already states.
 * `the administration hub never offers a page that refuses` below renders those
 * pages, so an entry missing here or in the hub fails against the page itself.
 */
const PAGE_ALSO_REQUIRES: Record<string, readonly string[]> = {
  '/administration/departments': ['org.branch.read'],
  '/administration/employees': ['org.branch.read'],
};

/** The route pages whose refusals the hub is checked against, rendered for real. */
const GATED_PAGES: Record<string, () => Promise<{ default: unknown }>> = {
  '/administration/departments': () =>
    import('@/app/[locale]/(dashboard)/administration/departments/page'),
  '/administration/employees': () =>
    import('@/app/[locale]/(dashboard)/administration/employees/page'),
  '/administration/numbering-rules': () =>
    import('@/app/[locale]/(dashboard)/administration/numbering-rules/page'),
  '/administration/taxes': () => import('@/app/[locale]/(dashboard)/administration/taxes/page'),
  '/administration/currencies': () =>
    import('@/app/[locale]/(dashboard)/administration/currencies/page'),
  '/administration/system-settings': () =>
    import('@/app/[locale]/(dashboard)/administration/system-settings/page'),
};

async function hubHrefs(
  permissions: readonly string[],
  locale: 'en' | 'ar' = 'en'
): Promise<string[]> {
  PERMISSIONS = permissions;
  const ui = (await AdministrationPage({ params: Promise.resolve({ locale }) })) as never;
  const view = locale === 'en' ? renderLtr(ui) : renderRtl(ui);
  const hrefs = screen
    .queryAllByRole('link')
    .map((link) => link.getAttribute('href') ?? '')
    .filter((href) => href.startsWith(`/${locale}/administration/`))
    .map((href) => href.slice(`/${locale}`.length));
  view.unmount();
  return hrefs;
}

describe('the administration hub: departments and employees (P1-32-PRE-OD-ADM6)', () => {
  it('offers both to an administrator holding their codes, under People and access', async () => {
    PERMISSIONS = ['org.department.read', 'org.employee.read', 'org.branch.read'];
    renderLtr((await AdministrationPage({ params: Promise.resolve({ locale: 'en' }) })) as never);
    expect(
      screen.getByRole('heading', { name: EN['admin.section.identity'] as string })
    ).toBeVisible();
    expect(
      screen.getByRole('link', { name: new RegExp(`^${EN['nav.departments']}`) })
    ).toHaveAttribute('href', '/en/administration/departments');
    expect(
      screen.getByRole('link', { name: new RegExp(`^${EN['nav.employees']}`) })
    ).toHaveAttribute('href', '/en/administration/employees');
  });

  it('names both in Arabic, right to left', async () => {
    PERMISSIONS = ['org.department.read', 'org.employee.read', 'org.branch.read'];
    renderRtl((await AdministrationPage({ params: Promise.resolve({ locale: 'ar' }) })) as never);
    expect(
      screen.getByRole('link', { name: new RegExp(`^${AR['nav.departments']}`) })
    ).toHaveAttribute('href', '/ar/administration/departments');
    expect(
      screen.getByRole('link', { name: new RegExp(`^${AR['nav.employees']}`) })
    ).toHaveAttribute('href', '/ar/administration/employees');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('hides each without its own code, and both without the branch read their pages refuse without', async () => {
    // The branch read also opens the settings pages; only these two are asked about.
    const people = async (permissions: readonly string[]) =>
      (await hubHrefs(permissions)).filter(
        (href) => href === '/administration/departments' || href === '/administration/employees'
      );
    expect(await people(['org.employee.read', 'org.branch.read'])).toEqual([
      '/administration/employees',
    ]);
    expect(await people(['org.department.read', 'org.branch.read'])).toEqual([
      '/administration/departments',
    ]);
    expect(await hubHrefs(['org.department.read', 'org.employee.read'])).toEqual([]);
  });
});

describe('the administration hub: every entry is gated as its route is (P1-32-PRE-OD-ADM6)', () => {
  const navigation = flattenNavigation();

  it('shows nothing to a session holding no administration code', async () => {
    expect(await hubHrefs([])).toEqual([]);
  });

  it('matches each entry to its navigation entry, shows it on exactly its codes, and hides it without each', async () => {
    const all = [...ADMINISTRATION_PERMISSIONS];
    const offered = await hubHrefs(all);
    expect(offered).toEqual(
      expect.arrayContaining([
        '/administration/users',
        '/administration/departments',
        '/administration/employees',
        '/administration/numbering-rules',
        '/administration/system-settings',
        '/administration/audit-log',
      ])
    );
    for (const href of offered) {
      const item = navigation.find((entry) => entry.href === href);
      expect(item, `${href} has a navigation entry`).toBeDefined();
      // Any one of these opens the entry (the sidebar's `permission` or an
      // `orPermissions` code); every one of `allOf` is needed besides.
      const anyOf = [item?.permission as string, ...(item?.orPermissions ?? [])];
      const allOf = [...(item?.alsoRequires ?? []), ...(PAGE_ALSO_REQUIRES[href] ?? [])];
      for (const alternative of anyOf) {
        const held = [alternative, ...allOf];
        expect(await hubHrefs(held), `${href} is shown on ${held.join(', ')}`).toContain(href);
      }
      for (const needed of allOf) {
        expect(
          await hubHrefs(all.filter((held) => held !== needed)),
          `${href} is hidden without ${needed}`
        ).not.toContain(href);
      }
      expect(
        await hubHrefs(all.filter((held) => !anyOf.includes(held))),
        `${href} is hidden without any of ${anyOf.join(', ')}`
      ).not.toContain(href);
      if (anyOf.length > 1) {
        for (const missing of anyOf) {
          expect(
            await hubHrefs(all.filter((held) => held !== missing)),
            `${href} is still shown without ${missing} alone`
          ).toContain(href);
        }
      }
    }
  });

  it('offers the settings pages on the reads they show, never on settings management alone', async () => {
    expect(await hubHrefs(['org.settings.manage'])).toEqual([]);
    expect(await hubHrefs(['org.company.read'])).toEqual([
      '/administration/numbering-rules',
      '/administration/taxes',
      '/administration/currencies',
      '/administration/system-settings',
    ]);
    expect(await hubHrefs(['org.branch.read'])).toEqual([
      '/administration/numbering-rules',
      '/administration/taxes',
      '/administration/system-settings',
    ]);
    expect(await hubHrefs(['org.tenant.read'])).toEqual([
      '/administration/organization',
      '/administration/currencies',
      '/administration/languages',
    ]);
  });
});

/**
 * The hub against the pages themselves: every subset of the codes a gated page
 * reads is rendered twice — the page, and the hub — and the hub never offers a
 * page that would draw a refusal; with the entry's navigation code or one of its
 * `orPermissions` held, it offers the page exactly when the page draws something
 * else.
 */
describe('the administration hub never offers a page that refuses (P1-32-PRE-OD-ADM6)', () => {
  const navigation = flattenNavigation();

  function subsets(codes: readonly string[]): string[][] {
    return codes.reduce<string[][]>(
      (sets, code) => [...sets, ...sets.map((set) => [...set, code])],
      [[]]
    );
  }

  async function pageRefuses(href: string, permissions: readonly string[]): Promise<boolean> {
    PERMISSIONS = permissions;
    const loader = GATED_PAGES[href];
    expect(loader, `${href} has a page to render`).toBeDefined();
    const page = (await (loader as () => Promise<{ default: unknown }>)())
      .default as unknown as RoutePage;
    const view = renderLtr(
      withMui((await page({ params: Promise.resolve({ locale: 'en' }) })) as never)
    );
    const refused = screen.queryByText(EN['state.denied.title'] as string) !== null;
    view.unmount();
    return refused;
  }

  it.each(Object.keys(GATED_PAGES))('%s', async (href) => {
    apiGet.mockResolvedValue({ ok: false, kind: 'unavailable', correlationId: 'corr-page' });
    const item = navigation.find((entry) => entry.href === href);
    expect(item, `${href} has a navigation entry`).toBeDefined();
    const code = item?.permission as string;
    const opensOn = [code, ...(item?.orPermissions ?? [])];
    const read = [
      'org.company.read',
      'org.branch.read',
      'org.tenant.read',
      'org.department.read',
      'org.employee.read',
    ];
    const codes = [code, ...read.filter((other) => other !== code)];
    for (const held of subsets(codes)) {
      const refused = await pageRefuses(href, held);
      const offered = (await hubHrefs(held)).includes(href);
      if (offered) expect(refused, `${href} offered on [${held.join(', ')}] refuses`).toBe(false);
      if (held.some((other) => opensOn.includes(other))) {
        expect(offered, `${href} on [${held.join(', ')}] matches its page`).toBe(!refused);
      }
    }
  });
});
