import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

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
 * Two of the route's six filters are absent by decision, not by oversight:
 * the company and branch parameters are refused by the shared query builder,
 * which never lets a client assert a scope name (`P1-27-SEC-001`). Surfacing
 * them is a change to that boundary and is recorded for the Owner rather than
 * taken here, so this file asserts nothing about them in either direction.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);
const labelledAr = (key: string) => new RegExp(`^${escape(AR[key] as string)}`);

const listAuditEvents = vi.fn();
const readAuditEvent = vi.fn();
vi.mock('@/features/administration/audit/api', () => ({
  listAuditEvents: (...args: unknown[]) => listAuditEvents(...args),
  readAuditEvent: (...args: unknown[]) => readAuditEvent(...args),
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

const { AuditLogScreen } =
  await import('@/features/administration/audit/components/AuditLogScreen');
const { DEFAULT_WINDOW_DAYS } = await import('@/features/administration/audit/types');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const AuditLogPage = (await import('@/app/[locale]/(dashboard)/administration/audit-log/page'))
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
});

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <AuditLogScreen
      locale="en"
      messages={en}
      initialFrom="2026-09-01"
      initialTo="2026-09-08"
      {...over}
    />
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
      <AuditLogScreen locale="ar" messages={ar} initialFrom="2026-09-01" initialTo="2026-09-08" />
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
      <AuditLogScreen locale="ar" messages={ar} initialFrom="2026-09-01" initialTo="2026-09-08" />
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

describe('the /administration/audit-log route page decides before it reads', () => {
  it('refuses without the audit code, and issues no read', async () => {
    PERMISSIONS = [];
    renderLtr((await AuditLogPage({ params: Promise.resolve({ locale: 'en' }) })) as never);
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listAuditEvents).not.toHaveBeenCalled();
  });

  it('reads a seven-day window with the code held, computed on the server', async () => {
    PERMISSIONS = ['iam.audit.view'];
    renderLtr((await AuditLogPage({ params: Promise.resolve({ locale: 'en' }) })) as never);
    await waitFor(() => expect(listAuditEvents).toHaveBeenCalled());
    const { from, to } = lastRange();
    const days = (Date.parse(to) - Date.parse(from)) / (24 * 60 * 60 * 1000);
    // The screen widens the given dates to whole days, so the measured span is
    // the window plus the last day's tail rather than exactly seven.
    expect(Math.floor(days)).toBe(DEFAULT_WINDOW_DAYS);
    expect(lastFilters()).toEqual({ action: '', entityType: '', actorId: '' });
  });
});
