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
 * the codes its page needs — its navigation entry's code, plus any further code
 * the page refuses without — and hidden without them.
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
const { DEFAULT_WINDOW_DAYS } = await import('@/features/administration/audit/types');
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
    PERMISSIONS = ['iam.audit.view'];
    renderLtr(
      withMui((await AuditLogPage({ params: Promise.resolve({ locale: 'en' }) })) as never)
    );
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    const { from, to } = lastRange();
    const days = (Date.parse(to) - Date.parse(from)) / (24 * 60 * 60 * 1000);
    // The screen widens the given dates to whole days, so the measured span is
    // the window plus the last day's tail rather than exactly seven.
    expect(Math.floor(days)).toBe(DEFAULT_WINDOW_DAYS);
    expect(lastFilters()).toEqual({ action: '', entityType: '', actorId: '' });
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
        name: new RegExp(`^${escape(EN['admin.open'] as string)} iam\\.user\\.updated`),
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
    // on the branch's today and starts seven days before it.
    expect(lastRange()).toEqual({
      from: '2026-09-01T21:00:00.000Z',
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
    listAuditEvents
      .mockResolvedValueOnce({ ...okPage([row]), nextCursor: 'cursor-2', hasMore: true })
      .mockResolvedValue(okPage([{ ...row, id: '77777777-7777-4777-8777-777777777777' }]));
    const user = userEvent.setup();
    renderScreen();
    const next = await screen.findByRole('button', { name: EN['table.nextPage'] as string });
    await waitFor(() => expect(next).toBeEnabled());
    await user.click(next);
    await waitFor(() => expect(listAuditEvents.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(listAuditEvents.mock.calls.at(-1)?.[1]).toBe('cursor-2');
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
 * Codes a page refuses without, beyond its navigation entry's own — read from
 * the pages themselves: departments and employees list one branch's records and
 * refuse without the branch read.
 */
const PAGE_ALSO_REQUIRES: Record<string, readonly string[]> = {
  '/administration/departments': ['org.branch.read'],
  '/administration/employees': ['org.branch.read'],
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
    expect(await hubHrefs(['org.employee.read', 'org.branch.read'])).toEqual([
      '/administration/employees',
    ]);
    expect(await hubHrefs(['org.department.read', 'org.branch.read'])).toEqual([
      '/administration/departments',
    ]);
    expect(await hubHrefs(['org.department.read', 'org.employee.read'])).toEqual([]);
  });

  it('offers no technician roster, because no roster route exists', async () => {
    expect(await hubHrefs([...ADMINISTRATION_PERMISSIONS, 'tech.technician.read'])).not.toContain(
      '/technicians'
    );
  });
});

describe('the administration hub: every entry is gated as its route is (P1-32-PRE-OD-ADM6)', () => {
  const navigation = flattenNavigation();

  it('shows nothing to a session holding no administration code', async () => {
    expect(await hubHrefs([])).toEqual([]);
  });

  it('matches each entry to its navigation entry, shows it on that code alone, and hides it without', async () => {
    const all = [...ADMINISTRATION_PERMISSIONS];
    const offered = await hubHrefs(all);
    expect(offered).toEqual(
      expect.arrayContaining([
        '/administration/users',
        '/administration/departments',
        '/administration/employees',
        '/administration/audit-log',
      ])
    );
    for (const href of offered) {
      const item = navigation.find((entry) => entry.href === href);
      expect(item, `${href} has a navigation entry`).toBeDefined();
      const code = item?.permission as string;
      const minimal = [code, ...(item?.alsoRequires ?? []), ...(PAGE_ALSO_REQUIRES[href] ?? [])];
      expect(await hubHrefs(minimal), `${href} is shown on ${minimal.join(', ')}`).toContain(href);
      expect(
        await hubHrefs(all.filter((held) => held !== code)),
        `${href} is hidden without ${code}`
      ).not.toContain(href);
    }
  });
});
