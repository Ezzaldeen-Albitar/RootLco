import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  TEST_COMPANY,
  branchSnapshot,
  inBranch,
  renderLtr,
} from './render';

/**
 * The technician workspace, rendered (P1-29, `W4`).
 *
 * The backend proof says the queue is unpaged, the log is append-only, and a
 * start needs a resolved identity. This file proves the SCREEN says the same
 * thing: no paging control on the queue, no edit and no delete on a note, no
 * start button until the identity is confirmed, a stop only on the caller's
 * own open session — and every write addressed by the assignment, never by a
 * technician id the component could have chosen.
 */

const EN = en as Record<string, string>;

const readMyQueue = vi.fn();
const resolveOwnAssignment = vi.fn();
const listLaborSessions = vi.fn();
const listWorkLog = vi.fn();
const listJobEvidence = vi.fn();
const startLaborSession = vi.fn();
const stopLaborSession = vi.fn();
const recordWorkLog = vi.fn();
const correctLaborSession = vi.fn();
vi.mock('@/features/technicians/api', () => ({
  readMyQueue: (...args: unknown[]) => readMyQueue(...args),
  resolveOwnAssignment: (...args: unknown[]) => resolveOwnAssignment(...args),
  listLaborSessions: (...args: unknown[]) => listLaborSessions(...args),
  listWorkLog: (...args: unknown[]) => listWorkLog(...args),
  listJobEvidence: (...args: unknown[]) => listJobEvidence(...args),
  startLaborSession: (...args: unknown[]) => startLaborSession(...args),
  stopLaborSession: (...args: unknown[]) => stopLaborSession(...args),
  correctLaborSession: (...args: unknown[]) => correctLaborSession(...args),
  recordWorkLog: (...args: unknown[]) => recordWorkLog(...args),
  captureJobEvidence: vi.fn(),
}));
vi.mock('@/features/attachments/api', () => ({
  listDocumentCategories: async () => ({ status: 'ok', correlationId: 'c', data: { items: [] } }),
}));
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: () => false,
}));

const { TechnicianWorkspaceScreen } =
  await import('@/features/technicians/components/TechnicianWorkspaceScreen');

// The branch the technician is standing in, chosen once in the header rather
// than picked from two selects over raw references on this screen.
const COMPANY = TEST_COMPANY.id;
const BRANCH = TEST_BRANCH.id;
const JOB = '77777777-7777-4777-8777-777777777777';
const ASSIGNMENT = 'aaaaaaaa-0000-4000-8000-000000000001';
const ME = 'bbbbbbbb-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';

const ok = <T,>(data: T) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const entry = {
  assignmentId: ASSIGNMENT,
  jobId: JOB,
  workOrderId: '33333333-3333-4333-8333-333333333333',
  assignmentRole: 'primary',
  validFrom: '2026-07-26T08:00:00.000Z',
  jobTitle: 'Replace front pads',
  jobState: 'assigned',
  workOrderState: 'open',
  displayNumber: 'WO-0001',
};
const own = {
  assignmentId: ASSIGNMENT,
  jobId: JOB,
  workOrderId: entry.workOrderId,
  technicianProfileId: ME,
};
const page = <T,>(items: readonly T[]) => ok({ items, nextCursor: null, hasMore: false });

const ALL = {
  canRecordLabor: true,
  canCorrectLabor: false,
  canReadWork: true,
  canCaptureDocuments: false,
};

function renderScreen(capabilities = ALL) {
  return renderLtr(
    inBranch(<TechnicianWorkspaceScreen locale="en" messages={en} capabilities={capabilities} />)
  );
}

beforeEach(() => {
  for (const mock of [
    readMyQueue,
    resolveOwnAssignment,
    listLaborSessions,
    listWorkLog,
    listJobEvidence,
    startLaborSession,
    stopLaborSession,
    recordWorkLog,
    correctLaborSession,
  ]) {
    mock.mockReset();
  }
  readMyQueue.mockResolvedValue(ok({ items: [entry] }));
  resolveOwnAssignment.mockResolvedValue(ok(own));
  listLaborSessions.mockResolvedValue(page([]));
  listWorkLog.mockResolvedValue(page([]));
  listJobEvidence.mockResolvedValue(ok({ items: [] }));
});

describe('the queue', () => {
  it('loads at once for a single-branch session, as a TARGET, and lists the job', async () => {
    renderScreen();
    expect(await screen.findByText('Replace front pads')).toBeInTheDocument();
    expect(readMyQueue).toHaveBeenCalledWith({ companyId: COMPANY, branchId: BRANCH });
  });

  it('offers NO paging control — the read is unpaged and the screen says so', async () => {
    renderScreen();
    await screen.findByText('Replace front pads');
    expect(screen.getByText(EN['technicians.workspace.queueNote']!)).toBeInTheDocument();
    for (const name of [/next/i, /previous/i, /page size/i, /load more/i, /^page/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('navigation', { name: /pagination/i })).toBeNull();
  });

  it('renders an empty queue as an absence, not a failure', async () => {
    readMyQueue.mockResolvedValue(ok({ items: [] }));
    renderScreen();
    expect(await screen.findByText(EN['technicians.workspace.emptyTitle']!)).toBeInTheDocument();
  });

  it('renders a refusal as a refusal, with the reference', async () => {
    readMyQueue.mockResolvedValue({ status: 'denied', correlationId: 'corr-denied' });
    renderScreen();
    expect(await screen.findByText(/corr-denied/)).toBeInTheDocument();
    expect(screen.queryByText(EN['technicians.workspace.emptyTitle']!)).toBeNull();
  });
});

describe('a job opened for execution', () => {
  async function openJob(capabilities = ALL) {
    const user = userEvent.setup();
    renderScreen(capabilities);
    await user.click(
      await screen.findByRole('button', { name: EN['technicians.workspace.open']! })
    );
    return user;
  }

  it('confirms the assignment is the caller’s own before offering a start', async () => {
    let release: (value: unknown) => void = () => {};
    resolveOwnAssignment.mockReturnValue(new Promise((resolve) => (release = resolve)));
    await openJob();
    expect(screen.getByText(EN['technicians.workspace.identityResolving']!)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN['technicians.workspace.start']! })).toBeNull();
    release(ok(own));
    expect(
      await screen.findByRole('button', { name: EN['technicians.workspace.start']! })
    ).toBeInTheDocument();
    expect(resolveOwnAssignment).toHaveBeenCalledWith(
      { companyId: COMPANY, branchId: BRANCH },
      JOB,
      ASSIGNMENT
    );
  });

  it('offers nothing when the identity cannot be confirmed', async () => {
    resolveOwnAssignment.mockResolvedValue({ status: 'not-found', correlationId: null });
    await openJob();
    expect(
      await screen.findByText(EN['technicians.workspace.identityRefused']!)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN['technicians.workspace.start']! })).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['technicians.workspace.addEntry']! })
    ).toBeNull();
  });

  it('starts by ASSIGNMENT — the call carries no technician id', async () => {
    startLaborSession.mockResolvedValue({ status: 'success' });
    const user = await openJob();
    await user.click(
      await screen.findByRole('button', { name: EN['technicians.workspace.start']! })
    );
    await waitFor(() => expect(startLaborSession).toHaveBeenCalledTimes(1));
    const args = startLaborSession.mock.calls[0] ?? [];
    expect(args).toEqual([{ companyId: COMPANY, branchId: BRANCH }, JOB, ASSIGNMENT]);
    expect(JSON.stringify(args)).not.toContain(ME);
    // The truth is re-read after a write; nothing is patched locally.
    await waitFor(() => expect(listLaborSessions).toHaveBeenCalledTimes(2));
  });

  it('offers a stop ONLY on the caller’s own open session, with its version', async () => {
    listLaborSessions.mockResolvedValue(
      page([
        {
          id: 'their-open',
          technicianProfileId: OTHER,
          jobId: JOB,
          startedAt: '2026-07-26T08:00:00.000Z',
          endedAt: null,
          source: 'manual',
          correctionOfId: null,
          recordVersion: 1,
        },
      ])
    );
    const user = await openJob();
    // Another technician's open session is not a reason to offer a stop.
    expect(
      await screen.findByRole('button', { name: EN['technicians.workspace.start']! })
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN['technicians.workspace.stop']! })).toBeNull();
    expect(
      screen.getByText(new RegExp(EN['technicians.workspace.session.other']!))
    ).toBeInTheDocument();

    listLaborSessions.mockResolvedValue(
      page([
        {
          id: 'mine-open',
          technicianProfileId: ME,
          jobId: JOB,
          startedAt: '2026-07-26T08:00:00.000Z',
          endedAt: null,
          source: 'manual',
          correctionOfId: null,
          recordVersion: 7,
        },
      ])
    );
    stopLaborSession.mockResolvedValue({ status: 'success' });
    // Re-open to re-read.
    await user.click(screen.getByRole('button', { name: EN['technicians.workspace.close']! }));
    await user.click(
      await screen.findByRole('button', { name: EN['technicians.workspace.open']! })
    );
    await user.click(
      await screen.findByRole('button', { name: EN['technicians.workspace.stop']! })
    );
    await waitFor(() => expect(stopLaborSession).toHaveBeenCalledTimes(1));
    expect(stopLaborSession.mock.calls[0]).toEqual([
      { companyId: COMPANY, branchId: BRANCH },
      JOB,
      ASSIGNMENT,
      'mine-open',
      7,
    ]);
  });

  it('a conflict on stop is said, and the write is not retried', async () => {
    listLaborSessions.mockResolvedValue(
      page([
        {
          id: 'mine-open',
          technicianProfileId: ME,
          jobId: JOB,
          startedAt: '2026-07-26T08:00:00.000Z',
          endedAt: null,
          source: 'manual',
          correctionOfId: null,
          recordVersion: 7,
        },
      ])
    );
    stopLaborSession.mockResolvedValue({ status: 'conflict' });
    const user = await openJob();
    await user.click(
      await screen.findByRole('button', { name: EN['technicians.workspace.stop']! })
    );
    expect(await screen.findByText(EN['technicians.workspace.conflict']!)).toBeInTheDocument();
    expect(stopLaborSession).toHaveBeenCalledTimes(1);
  });

  it('read authority without labour authority sees the clock and no control', async () => {
    await openJob({ ...ALL, canRecordLabor: false });
    expect(
      await screen.findByText(EN['technicians.workspace.noLaborPermission']!)
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: EN['technicians.workspace.start']! })).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['technicians.workspace.addEntry']! })
    ).toBeNull();
  });
});

describe('the work log', () => {
  const note = {
    id: 'log-1',
    jobId: JOB,
    entry: 'Bled the rear circuit; pedal firm.',
    loggedAt: '2026-07-26T09:00:00.000Z',
    createdAt: '2026-07-26T09:01:00.000Z',
    createdBy: 'u-1',
  };

  async function openWithNotes() {
    listWorkLog.mockResolvedValue(page([note]));
    const user = userEvent.setup();
    renderScreen();
    await user.click(
      await screen.findByRole('button', { name: EN['technicians.workspace.open']! })
    );
    await screen.findByText(note.entry);
    return user;
  }

  it('renders entries as written and offers NO edit and NO delete', async () => {
    await openWithNotes();
    const list = screen.getByText(note.entry).closest('ul');
    expect(list).not.toBeNull();
    expect(within(list!).queryAllByRole('button')).toHaveLength(0);
    for (const name of [/edit/i, /delete/i, /remove/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    // And no structured vocabulary is offered on the add form: one textarea, no select.
    const form = screen
      .getByRole('button', { name: EN['technicians.workspace.addEntry']! })
      .closest('form')!;
    expect(within(form).queryAllByRole('combobox')).toHaveLength(0);
    expect(within(form).getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByText(EN['technicians.workspace.workLogNote']!)).toBeInTheDocument();
  });

  it('appends by ASSIGNMENT with the exact text, then re-reads', async () => {
    recordWorkLog.mockResolvedValue({ status: 'success' });
    const user = await openWithNotes();
    await user.type(
      screen.getByRole('textbox', { name: new RegExp(EN['technicians.workspace.entry']!) }),
      'Road test done.'
    );
    await user.click(screen.getByRole('button', { name: EN['technicians.workspace.addEntry']! }));
    await waitFor(() => expect(recordWorkLog).toHaveBeenCalledTimes(1));
    expect(recordWorkLog.mock.calls[0]).toEqual([
      { companyId: COMPANY, branchId: BRANCH },
      JOB,
      ASSIGNMENT,
      { entry: 'Road test done.' },
    ]);
    await waitFor(() => expect(listWorkLog).toHaveBeenCalledTimes(2));
  });

  it('refuses an empty note beside the field, sending nothing', async () => {
    const user = await openWithNotes();
    await user.click(screen.getByRole('button', { name: EN['technicians.workspace.addEntry']! }));
    expect(await screen.findByText(EN['field.required']!)).toBeInTheDocument();
    expect(recordWorkLog).not.toHaveBeenCalled();
  });
});

/**
 * Owner directive, user-facing errors: the workspace says why the clock or a
 * correction was refused.
 *
 * The three clock refusals are published against the technician profile the
 * ADAPTER resolved. No screen here holds a technician reference — that is the
 * identity seam this slice was built on — so each sentence was filed under a
 * control that cannot exist and the technician saw only the generic apology.
 * The correction refusals DO name controls the form has; those belong beside
 * them, with the times as typed.
 */
describe('a refused clock or correction says what is wrong', () => {
  async function openJob(capabilities = ALL) {
    const user = userEvent.setup();
    renderScreen(capabilities);
    await user.click(
      await screen.findByRole('button', { name: EN['technicians.workspace.open']! })
    );
    return user;
  }

  const stopped = {
    id: 'mine-stopped',
    technicianProfileId: ME,
    jobId: JOB,
    startedAt: '2026-07-26T08:00:00.000Z',
    endedAt: '2026-07-26T10:00:00.000Z',
    source: 'manual',
    correctionOfId: null,
    recordVersion: 3,
  };

  it('says a session is already running instead of the generic apology', async () => {
    startLaborSession.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.invalid',
      fieldErrors: { technicianProfileId: 'form.violation.session-already-open' },
      correlationId: 'corr-open',
      attempt: 1,
    });
    const user = await openJob();
    await user.click(
      await screen.findByRole('button', { name: EN['technicians.workspace.start']! })
    );

    expect(await screen.findByText(EN['form.violation.session-already-open']!)).toBeInTheDocument();
    expect(screen.queryByText(EN['technicians.workspace.conflict']!)).toBeNull();
    // The refusal is about the profile the adapter resolved, and the sentence
    // names no profile: the reference never reaches the screen.
    expect(document.body.textContent).not.toContain(ME);
    expect(document.body.textContent).not.toContain('session-already-open');
  });

  it('leaves a clock refusal it has not been told about to the generic line', async () => {
    startLaborSession.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.invalid',
      fieldErrors: { technicianProfileId: 'form.violation.a_rule_this_screen_never_heard_of' },
      correlationId: 'corr-unknown',
      attempt: 1,
    });
    const user = await openJob();
    await user.click(
      await screen.findByRole('button', { name: EN['technicians.workspace.start']! })
    );

    expect(await screen.findByText(EN['technicians.workspace.conflict']!)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('a_rule_this_screen_never_heard_of');
  });

  it('puts an overlap refusal beside the start time, leaves the form open, and keeps both times', async () => {
    listLaborSessions.mockResolvedValue(page([stopped]));
    correctLaborSession.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.invalid',
      fieldErrors: { startedAt: 'form.violation.window-overlaps' },
      correlationId: 'corr-overlap',
      attempt: 1,
    });
    const user = await openJob({ ...ALL, canCorrectLabor: true });
    await user.click(
      await screen.findByRole('button', { name: EN['technicians.workspace.correctHeading']! })
    );
    const startedAt = await screen.findByLabelText(
      new RegExp(`^${EN['technicians.workspace.correctStartedAt']!}`)
    );
    const reason = screen.getByLabelText(
      new RegExp(`^${EN['technicians.workspace.correctReason']!}`)
    );
    await user.type(reason, 'Clocked in late by mistake');
    await user.click(
      screen.getByRole('button', { name: EN['technicians.workspace.correctSubmit']! })
    );

    const alert = await screen.findByText(EN['form.violation.window-overlaps']!);
    expect(alert).toBeVisible();
    expect(startedAt.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    // The form is still open with everything as it was typed: the cure is to
    // adjust a time, not to start the correction again.
    expect((reason as HTMLInputElement).value).toBe('Clocked in late by mistake');
    expect((startedAt as HTMLInputElement).value).not.toBe('');
  });

  it('closes the correction form only when the correction was accepted', async () => {
    listLaborSessions.mockResolvedValue(page([stopped]));
    correctLaborSession.mockResolvedValue({ status: 'success', attempt: 1 });
    const user = await openJob({ ...ALL, canCorrectLabor: true });
    await user.click(
      await screen.findByRole('button', { name: EN['technicians.workspace.correctHeading']! })
    );
    await user.type(
      screen.getByLabelText(new RegExp(`^${EN['technicians.workspace.correctReason']!}`)),
      'Clocked in late by mistake'
    );
    await user.click(
      screen.getByRole('button', { name: EN['technicians.workspace.correctSubmit']! })
    );

    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: EN['technicians.workspace.correctSubmit']! })
      ).toBeNull()
    );
  });
});

describe('the technician queue is about ONE branch', () => {
  it('reads nothing and says which control answers while "all my branches" is chosen', async () => {
    // A technician stands in one workshop. A queue spanning several would mix
    // other people jobs into their own list.
    const user = userEvent.setup();
    readMyQueue.mockClear();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to="all" label="use all" />
          <TechnicianWorkspaceScreen locale="en" messages={en} capabilities={ALL} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));
    expect(await screen.findByTestId('requires-concrete-branch')).toHaveTextContent(
      en['workingContext.needsOneBranch']
    );
    expect(readMyQueue).not.toHaveBeenCalled();
  });
});
