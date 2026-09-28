import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
import { formatInZone } from '@/lib/branch-time';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  type AppointmentDetail,
  type AppointmentStatus,
} from '@/features/appointments/appointments-contract';
import type { IntakeCatalogueResult } from '@/features/appointments/catalogue-api';

/**
 * The appointment detail screen and its three lifecycle commands
 * (`P1-28-FE-003`/`FE-004`/`FE-005`; `TC-P1-28-APT-003/004/005`), on the
 * Material UI wrappers (ADR-022).
 *
 * The affordance matrix is asserted GRAPH-DERIVED: for every status the
 * contract publishes, the expected set of controls is computed from
 * `APPOINTMENT_TRANSITIONS` itself, and the rendering is held to that
 * computation. A hand-written list here would be a second copy of the graph
 * that drifts.
 *
 * The If-Match discipline (QA-004) is asserted behaviourally: the version a
 * command sends comes from the page's own read, after a success the NEXT
 * command sends the version the previous command's response returned, and the
 * reschedule form sends the version its typed times were based on
 * (`useEditBaseline`) — a refresh that arrives while times are typed does not
 * move it, and "Load the latest version" discards the typed times.
 */

const rescheduleAppointment = vi.fn();
const cancelAppointment = vi.fn();
const recordAppointmentNoShow = vi.fn();

vi.mock('@/features/appointments/api', () => ({
  rescheduleAppointment: (...args: unknown[]) => rescheduleAppointment(...args),
  cancelAppointment: (...args: unknown[]) => cancelAppointment(...args),
  recordAppointmentNoShow: (...args: unknown[]) => recordAppointmentNoShow(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, refresh }) }));

const { AppointmentDetailScreen } =
  await import('@/features/appointments/components/AppointmentDetailScreen');

function detail(overrides: Partial<AppointmentDetail> = {}): AppointmentDetail {
  return {
    id: 'a1b2c3d4-0000-4000-8000-00000000000a',
    displayNumber: 'APT-0007',
    lifecycleStatus: 'requested',
    companyId: '11111111-1111-4111-8111-111111111111',
    branchId: TEST_BRANCH.id,
    vehicleId: 'a1b2c3d4-0000-4000-8000-00000000000b',
    vehicleDisplayNumber: 'V-0100',
    requesterPartnerId: 'a1b2c3d4-0000-4000-8000-00000000000c',
    requesterDisplayName: 'Nadia Khoury',
    appointmentTypeId: 'a1b2c3d4-0000-4000-8000-00000000000d',
    appointmentTypeName: 'Periodic service',
    sourceChannelId: null,
    sourceChannelName: null,
    requestedFrom: '2026-08-20T09:00:00+03:00',
    requestedTo: '2026-08-20T10:00:00+03:00',
    confirmedFrom: null,
    confirmedTo: null,
    cancellationReasonId: null,
    cancellationReasonName: null,
    cancelledAt: null,
    noShowRecordedAt: null,
    recordVersion: 7,
    createdAt: '2026-08-10T08:00:00+03:00',
    updatedAt: null,
    ...overrides,
  };
}

const REASONS: IntakeCatalogueResult = {
  status: 'ok',
  options: [
    {
      id: 'b1b2c3d4-0000-4000-8000-000000000001',
      scope: 'platform',
      code: 'CUST',
      name: 'Customer request',
    },
  ],
  truncated: false,
  correlationId: null,
};

beforeEach(() => {
  rescheduleAppointment.mockReset();
  cancelAppointment.mockReset();
  recordAppointmentNoShow.mockReset();
  push.mockReset();
  refresh.mockReset();
  window.localStorage.clear();
});

/** The product's Material provider, as the locale layout mounts it. */
function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}

interface RenderOptions {
  readonly status?: AppointmentStatus;
  readonly canManage?: boolean;
  readonly canEndLifecycle?: boolean;
  readonly reasons?: IntakeCatalogueResult | null;
  readonly base?: Partial<AppointmentDetail>;
}

function screenFor({
  status = 'requested',
  canManage = true,
  canEndLifecycle = true,
  reasons = REASONS,
  base = {},
}: RenderOptions = {}): ReactElement {
  return (
    <AppointmentDetailScreen
      locale="en"
      messages={en}
      detail={detail({ ...base, lifecycleStatus: status })}
      canManage={canManage}
      canEndLifecycle={canEndLifecycle}
      cancellationReasons={reasons}
    />
  );
}

function renderScreen(options: RenderOptions = {}) {
  return renderLtr(withMui(inBranch(screenFor(options))));
}

const rescheduleHeading = () =>
  screen.queryByRole('heading', { name: en['appointments.reschedule.title'] });
const cancelButton = () =>
  screen.queryByRole('button', { name: en['appointments.cancel.openDialog'] });
const noShowButton = () =>
  screen.queryByRole('button', { name: en['appointments.noShow.openDialog'] });
const rescheduleSubmit = () =>
  screen.getByRole('button', { name: en['appointments.reschedule.submit'] });
const half = (key: 'appointments.window.from' | 'appointments.window.to') =>
  screen.getByRole('group', { name: new RegExp(`^${en[key]}`) });

/** Types a moment, part by part, in English order: day, month, year, hour, minute. */
async function typeMoment(
  user: ReturnType<typeof userEvent.setup>,
  key: 'appointments.window.from' | 'appointments.window.to',
  digits: string
) {
  const group = half(key);
  await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
  await user.keyboard(digits);
}

async function fillWindow(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await typeMoment(user, 'appointments.window.from', from);
  await typeMoment(user, 'appointments.window.to', to);
}

function rescheduled(recordVersion: number) {
  return {
    status: 'success',
    attempt: 1,
    correlationId: 'cid',
    changed: {
      appointmentId: detail().id,
      changeKind: 'rescheduled',
      lifecycleStatus: 'confirmed',
      recordVersion,
    },
  };
}

describe('the affordance matrix is the transition graph, rendered', () => {
  // Computed from the graph, not written down: a status offers reschedule
  // while ANY move remains (the contract's "still honourable" rule), cancel
  // while `cancelled` is a listed destination, no-show while `no_show` is.
  for (const status of APPOINTMENT_STATUSES) {
    const moves = APPOINTMENT_TRANSITIONS[status] ?? [];
    const expectReschedule = moves.length > 0;
    const expectCancel = moves.includes('cancelled');
    const expectNoShow = moves.includes('no_show');

    it(`offers exactly the graph's moves for '${status}'`, () => {
      renderScreen({ status });
      expect(rescheduleHeading(), `reschedule for ${status}`).toEqual(
        expectReschedule ? expect.anything() : null
      );
      expect(cancelButton(), `cancel for ${status}`).toEqual(
        expectCancel ? expect.anything() : null
      );
      expect(noShowButton(), `no-show for ${status}`).toEqual(
        expectNoShow ? expect.anything() : null
      );
    });
  }

  it('is not vacuous: the graph offers all three somewhere and refuses all three somewhere', () => {
    const all = APPOINTMENT_STATUSES.map((s) => APPOINTMENT_TRANSITIONS[s] ?? []);
    expect(all.some((moves) => moves.includes('no_show'))).toBe(true);
    expect(all.some((moves) => moves.includes('cancelled'))).toBe(true);
    expect(all.some((moves) => moves.length === 0)).toBe(true);
  });

  it('withholds arranging from a non-holder of the manage permission', () => {
    renderScreen({ status: 'confirmed', canManage: false, canEndLifecycle: true });
    expect(rescheduleHeading()).toBeNull();
    expect(cancelButton()).not.toBeNull();
  });

  it('withholds ending from a non-holder of the lifecycle permission', () => {
    renderScreen({ status: 'confirmed', canManage: true, canEndLifecycle: false });
    expect(noShowButton()).toBeNull();
    expect(cancelButton()).toBeNull();
    expect(rescheduleHeading()).not.toBeNull();
  });

  it('labels pending_confirmation as render-only and offers no control that promises to reach it', () => {
    renderScreen({ status: 'pending_confirmation' });
    expect(screen.getByText(en['appointments.status.pendingNote'])).toBeInTheDocument();
    // The graph refuses no-show here; confirming happens by rescheduling.
    expect(noShowButton()).toBeNull();
    expect(rescheduleHeading()).not.toBeNull();
  });

  it('has no control that says Confirm without saying rescheduling', () => {
    renderScreen({ status: 'requested' });
    // The one confirmation affordance is the reschedule submit, and its label
    // names the operation it truthfully calls.
    expect(rescheduleSubmit()).toBeInTheDocument();
    expect(en['appointments.reschedule.submit']).toMatch(/rescheduling/i);
  });
});

describe('confirm by rescheduling (FE-003)', () => {
  it('sends the version the page READ, and a window carrying explicit offsets', async () => {
    rescheduleAppointment.mockResolvedValue(rescheduled(8));
    const user = userEvent.setup();
    renderScreen({ status: 'requested' });
    await fillWindow(user, '210820260900', '210820261000');
    await user.click(rescheduleSubmit());

    await waitFor(() => expect(rescheduleAppointment).toHaveBeenCalledTimes(1));
    const [id, ifMatch, input] = rescheduleAppointment.mock.calls[0] as [
      string,
      number,
      { confirmedFrom: string; confirmedTo: string },
    ];
    expect(id).toBe(detail().id);
    // QA-004: the version comes from the detail read this page was given.
    expect(ifMatch).toBe(7);
    // Asia/Riyadh, UTC+3 all year: the typed wall clock with the branch's offset.
    expect(input).toEqual({
      confirmedFrom: '2026-08-21T09:00:00+03:00',
      confirmedTo: '2026-08-21T10:00:00+03:00',
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("types on the APPOINTMENT's branch clock, not the working branch's", async () => {
    rescheduleAppointment.mockResolvedValue(rescheduled(8));
    const user = userEvent.setup();
    const tokyo = { ...OTHER_BRANCH, timezone: 'Asia/Tokyo' };
    renderLtr(
      withMui(
        inBranch(screenFor({ base: { branchId: tokyo.id } }), {
          snapshot: branchSnapshot([TEST_BRANCH, tokyo]),
        })
      )
    );
    expect(screen.getByTestId('appointment-reschedule-window-zone')).toHaveTextContent(
      'Asia/Tokyo'
    );
    await fillWindow(user, '210820260900', '210820261000');
    await user.click(rescheduleSubmit());
    await waitFor(() => expect(rescheduleAppointment).toHaveBeenCalledTimes(1));
    const input = rescheduleAppointment.mock.calls[0]?.[2] as { confirmedFrom: string };
    expect(input.confirmedFrom).toBe('2026-08-21T09:00:00+09:00');
  });

  it('refuses an inverted window locally, against the end field, without a request', async () => {
    const user = userEvent.setup();
    renderScreen({ status: 'requested' });
    await fillWindow(user, '210820261000', '210820260900');
    await user.click(rescheduleSubmit());
    expect(await screen.findByText(en['field.windowEndsBeforeStart'])).toBeInTheDocument();
    expect(half('appointments.window.to')).toHaveAttribute('aria-invalid', 'true');
    expect(half('appointments.window.from')).not.toHaveAttribute('aria-invalid');
    expect(rescheduleAppointment).not.toHaveBeenCalled();
  });

  it('refuses an empty window with the cursor on the first moment, and withdraws it on correction', async () => {
    const user = userEvent.setup();
    renderScreen({ status: 'requested' });
    await user.click(rescheduleSubmit());
    const from = half('appointments.window.from');
    await waitFor(() => expect(from).toHaveAttribute('aria-invalid', 'true'));
    await waitFor(() => expect(from.contains(document.activeElement)).toBe(true));
    expect(rescheduleAppointment).not.toHaveBeenCalled();

    await user.keyboard('210820260900');
    await waitFor(() => expect(from).not.toHaveAttribute('aria-invalid'));
    // The other half keeps its complaint until it is corrected.
    expect(half('appointments.window.to')).toHaveAttribute('aria-invalid', 'true');
  });

  it('surfaces a lost race as a conflict with a re-read affordance', async () => {
    rescheduleAppointment.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.title',
      correlationId: 'cid-409',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderScreen({ status: 'requested' });
    await fillWindow(user, '210820260900', '210820261000');
    await user.click(rescheduleSubmit());

    expect(await screen.findByText(en['state.conflict.title'])).toBeInTheDocument();
    // The typed times survive the refusal until the operator chooses otherwise.
    expect(half('appointments.window.from')).toHaveTextContent('2026');
    await user.click(screen.getByRole('button', { name: en['appointments.detail.reload'] }));
    expect(refresh).toHaveBeenCalled();
    expect(half('appointments.window.from')).not.toHaveTextContent('2026');
    expect(screen.queryByText(en['state.conflict.title'])).toBeNull();
  });

  it('keeps the version typed work was based on when a newer read arrives, and follows it when clean', async () => {
    rescheduleAppointment.mockResolvedValue(rescheduled(10));
    const user = userEvent.setup();
    const { rerender } = renderLtr(withMui(inBranch(screenFor())));
    await fillWindow(user, '210820260900', '210820261000');

    // Somebody else moved the record; the page read now says version 9.
    rerender(withMui(inBranch(screenFor({ base: { recordVersion: 9 } }))));
    // The typed times are kept — the refresh does not take work away.
    expect(half('appointments.window.from')).toHaveTextContent('2026');
    await user.click(rescheduleSubmit());
    await waitFor(() => expect(rescheduleAppointment).toHaveBeenCalledTimes(1));
    // The work was based on version 7, so 7 is sent: the server's conflict,
    // never a silent overwrite of what version 9 brought.
    expect(rescheduleAppointment.mock.calls[0]?.[1]).toBe(7);
  });

  it('a clean form follows a newer read', async () => {
    rescheduleAppointment.mockResolvedValue(rescheduled(10));
    const user = userEvent.setup();
    const { rerender } = renderLtr(withMui(inBranch(screenFor())));
    rerender(withMui(inBranch(screenFor({ base: { recordVersion: 9 } }))));
    await fillWindow(user, '210820260900', '210820261000');
    await user.click(rescheduleSubmit());
    await waitFor(() => expect(rescheduleAppointment).toHaveBeenCalledTimes(1));
    expect(rescheduleAppointment.mock.calls[0]?.[1]).toBe(9);
  });

  it('sources the NEXT command version from the previous command response', async () => {
    // Reschedule succeeds and returns version 8; the cancel that follows must
    // present 8, not the page's stale 7 (QA-004's exact rule).
    rescheduleAppointment.mockResolvedValue(rescheduled(8));
    cancelAppointment.mockResolvedValue({
      status: 'success',
      attempt: 1,
      correlationId: 'cid2',
      changed: {
        appointmentId: detail().id,
        changeKind: 'cancelled',
        lifecycleStatus: 'cancelled',
        recordVersion: 9,
      },
    });
    const user = userEvent.setup();
    renderScreen({ status: 'requested' });
    await fillWindow(user, '210820260900', '210820261000');
    await user.click(rescheduleSubmit());
    await waitFor(() => expect(rescheduleAppointment).toHaveBeenCalledTimes(1));

    // The affordances also moved with the returned status: `confirmed` still
    // cancels, so the control is there to press.
    await user.click(screen.getByRole('button', { name: en['appointments.cancel.openDialog'] }));
    await user.selectOptions(
      screen.getByLabelText(new RegExp(en['appointments.cancel.reason'])),
      REASONS.options[0]!.id
    );
    await user.click(screen.getByRole('button', { name: en['appointments.cancel.confirm'] }));

    await waitFor(() => expect(cancelAppointment).toHaveBeenCalledTimes(1));
    const [, ifMatch] = cancelAppointment.mock.calls[0] as [string, number];
    expect(ifMatch).toBe(8);
  });
});

describe('typed times are unsaved work until they are stored', () => {
  function renderInTwo() {
    return renderLtr(
      withMui(
        inBranch(
          <>
            <BranchSwitch to={TEST_BRANCH.id} label="first" />
            <BranchSwitch to={OTHER_BRANCH.id} label="second" />
            {screenFor()}
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
        )
      )
    );
  }

  it('asks before a branch switch, keeps the times on Stay and empties them on Discard', async () => {
    const user = userEvent.setup();
    renderInTwo();
    await user.click(screen.getByRole('button', { name: 'first' }));
    await typeMoment(user, 'appointments.window.from', '210820260900');

    await user.click(screen.getByRole('button', { name: 'second' }));
    let dialog = await screen.findByRole('alertdialog');
    await user.click(within(dialog).getByRole('button', { name: en['overlay.cancel'] }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(half('appointments.window.from')).toHaveTextContent('2026');

    await user.click(screen.getByRole('button', { name: 'second' }));
    dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: en['workingContext.discard.confirm'] })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    await waitFor(() => expect(half('appointments.window.from')).not.toHaveTextContent('2026'));
  });

  it('asks nothing once the times are stored', async () => {
    rescheduleAppointment.mockResolvedValue(rescheduled(8));
    const user = userEvent.setup();
    renderInTwo();
    await user.click(screen.getByRole('button', { name: 'first' }));
    await fillWindow(user, '210820260900', '210820261000');
    await user.click(rescheduleSubmit());
    await waitFor(() => expect(rescheduleAppointment).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'second' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('cancellation needs its catalogued reason (FE-004)', () => {
  it('asks in a decision dialog with Cancel focused, and sends the chosen reason with the read version', async () => {
    cancelAppointment.mockResolvedValue({
      status: 'success',
      attempt: 1,
      correlationId: 'cid',
      changed: {
        appointmentId: detail().id,
        changeKind: 'cancelled',
        lifecycleStatus: 'cancelled',
        recordVersion: 8,
      },
    });
    const user = userEvent.setup();
    renderScreen({ status: 'confirmed' });
    await user.click(screen.getByRole('button', { name: en['appointments.cancel.openDialog'] }));
    const dialog = screen.getByRole('alertdialog', {
      name: en['appointments.cancel.dialogTitle'],
    });
    // Ending an appointment cannot be undone: Enter must not do it.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(dialog).getByRole('button', { name: en['overlay.cancel'] })
      )
    );
    await user.selectOptions(
      within(dialog).getByLabelText(new RegExp(en['appointments.cancel.reason'])),
      REASONS.options[0]!.id
    );
    await user.click(
      within(dialog).getByRole('button', { name: en['appointments.cancel.confirm'] })
    );

    await waitFor(() => expect(cancelAppointment).toHaveBeenCalledTimes(1));
    expect(cancelAppointment).toHaveBeenCalledWith(
      detail().id,
      7,
      { cancellationReasonId: REASONS.options[0]!.id },
      1
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('refuses to submit without a reason — there is no free-text escape', async () => {
    const user = userEvent.setup();
    renderScreen({ status: 'confirmed' });
    await user.click(screen.getByRole('button', { name: en['appointments.cancel.openDialog'] }));
    await user.click(screen.getByRole('button', { name: en['appointments.cancel.confirm'] }));
    expect(await screen.findByText(en['field.required'])).toBeInTheDocument();
    const reason = screen.getByLabelText(new RegExp(en['appointments.cancel.reason']));
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(cancelAppointment).not.toHaveBeenCalled();

    // Choosing one withdraws the complaint.
    await user.selectOptions(reason, REASONS.options[0]!.id);
    expect(reason).not.toHaveAttribute('aria-invalid');
  });

  it('says an EMPTY reason catalogue is unpopulated, not broken', () => {
    renderScreen({
      status: 'confirmed',
      reasons: { status: 'ok', options: [], truncated: false, correlationId: null },
    });
    // The honest sentence: the workspace has no reasons configured yet. No
    // cancel control, no error state, no retry that could not help.
    expect(screen.getByText(en['appointments.cancel.noReasons'])).toBeInTheDocument();
    expect(cancelButton()).toBeNull();
    expect(screen.queryByText(en['state.error.title'])).toBeNull();
  });

  it('says a FAILED catalogue read is unavailable, with the reference', () => {
    renderScreen({
      status: 'confirmed',
      reasons: { status: 'unavailable', options: [], truncated: false, correlationId: 'cid-cat' },
    });
    expect(screen.getByText(en['appointments.cancel.catalogueUnavailable'])).toBeInTheDocument();
    expect(screen.getByText('cid-cat')).toBeInTheDocument();
    expect(cancelButton()).toBeNull();
  });
});

describe('no-show is recorded, not assumed (FE-005)', () => {
  it('confirms before sending, then sends the read version with no body input', async () => {
    recordAppointmentNoShow.mockResolvedValue({
      status: 'success',
      attempt: 1,
      correlationId: 'cid',
      changed: {
        appointmentId: detail().id,
        changeKind: 'no_show_recorded',
        lifecycleStatus: 'no_show',
        recordVersion: 8,
      },
    });
    const user = userEvent.setup();
    renderScreen({ status: 'confirmed' });
    await user.click(screen.getByRole('button', { name: en['appointments.noShow.openDialog'] }));
    // An alertdialog: the decision interrupts, deliberately.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en['appointments.noShow.confirm'] }));

    await waitFor(() => expect(recordAppointmentNoShow).toHaveBeenCalledTimes(1));
    expect(recordAppointmentNoShow).toHaveBeenCalledWith(detail().id, 7, 1);
  });

  it('surfaces the state-machine refusal as a conflict that re-reading does not cure', async () => {
    recordAppointmentNoShow.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.blocked.title',
      correlationId: 'cid-trn',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderScreen({ status: 'confirmed' });
    await user.click(screen.getByRole('button', { name: en['appointments.noShow.openDialog'] }));
    await user.click(screen.getByRole('button', { name: en['appointments.noShow.confirm'] }));
    // The blocked-state sentence, not the someone-else-edited one: the two
    // causes read differently and send the operator to different next steps.
    expect(await screen.findByText(en['state.conflict.blocked.title'])).toBeInTheDocument();
  });
  /**
   * Owner directive, user-facing errors. 'The state does not allow this' was
   * the whole of what a clerk was told, for four lifecycle refusals whose cures
   * are different. The service now publishes a rule name beside each one and
   * the banner renders the sentence it selects.
   */
  it('names the unmet precondition instead of the generic state sentence', async () => {
    recordAppointmentNoShow.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.appointment_not_confirmed_for_no_show',
      correlationId: 'cid-token',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderScreen({ status: 'confirmed' });
    await user.click(screen.getByRole('button', { name: en['appointments.noShow.openDialog'] }));
    await user.click(screen.getByRole('button', { name: en['appointments.noShow.confirm'] }));

    expect(
      await screen.findByText(en['form.violation.appointment_not_confirmed_for_no_show'])
    ).toBeInTheDocument();
    // Not in addition to the generic sentence: one banner, and it says the
    // specific thing.
    expect(screen.queryByText(en['state.conflict.blocked.title'])).toBeNull();
  });
});

describe('facts and directions', () => {
  it('shows the record facts an operator reports from, by name', () => {
    renderScreen({ status: 'requested' });
    expect(screen.getByText('APT-0007')).toBeInTheDocument();
    expect(screen.getByText('Nadia Khoury')).toBeInTheDocument();
    expect(screen.getByText('V-0100')).toBeInTheDocument();
    expect(screen.getByText(TEST_BRANCH.name)).toBeInTheDocument();
    // The version is displayed as a record fact; the commands carry it
    // invisibly.
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: en['appointments.detail.openVehicle'] })
    ).toHaveAttribute('href', `/en/vehicles/${detail().vehicleId}`);
  });

  it("draws the times on the appointment's branch clock and names it", () => {
    const tokyo = { ...OTHER_BRANCH, timezone: 'Asia/Tokyo' };
    renderLtr(
      withMui(
        inBranch(screenFor({ base: { branchId: tokyo.id } }), {
          snapshot: branchSnapshot([TEST_BRANCH, tokyo]),
        })
      )
    );
    // 09:00 at +03:00 is 15:00 in Tokyo.
    expect(
      screen.getByText(formatInZone(detail().requestedFrom, 'en-GB', 'Asia/Tokyo'))
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('appointment-clock')[0]).toHaveTextContent('GMT+9');
  });

  it('falls back to UTC, and says UTC, when the branch clock is not published', () => {
    renderLtr(withMui(inBranch(screenFor({ base: { branchId: OTHER_BRANCH.id } }))));
    expect(
      screen.getByText(formatInZone(detail().requestedFrom, 'en-GB', 'UTC'))
    ).toBeInTheDocument();
    expect(screen.getAllByTestId('appointment-clock')[0]).toHaveTextContent('UTC');
    expect(screen.getByTestId('appointment-reschedule-window-zone')).toHaveTextContent('UTC');
  });

  it('renders in Arabic, right to left', () => {
    renderRtl(
      withMui(
        inBranch(
          <AppointmentDetailScreen
            locale="ar"
            messages={ar}
            detail={detail()}
            canManage
            canEndLifecycle
            cancellationReasons={REASONS}
          />,
          { locale: 'ar' }
        ),
        'ar'
      )
    );
    expect(
      screen.getByRole('heading', { name: ar['appointments.reschedule.title'] })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: new RegExp(`^${ar['appointments.window.from']}`) })
    ).toBeInTheDocument();
    // `requested` refuses no-show in Arabic exactly as it does in English —
    // the graph, not the locale, decides.
    expect(screen.queryByRole('button', { name: ar['appointments.noShow.openDialog'] })).toBeNull();
    expect(
      screen.getByRole('button', { name: ar['appointments.cancel.openDialog'] })
    ).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
  });
});
