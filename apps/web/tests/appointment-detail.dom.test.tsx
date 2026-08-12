import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';
import {
  APPOINTMENT_STATUSES,
  APPOINTMENT_TRANSITIONS,
  type AppointmentDetail,
  type AppointmentStatus,
} from '@/features/appointments/appointments-contract';
import type { IntakeCatalogueResult } from '@/features/appointments/catalogue-api';

/**
 * The appointment detail screen and its three lifecycle commands
 * (`P1-28-FE-003`/`FE-004`/`FE-005`; `TC-P1-28-APT-003/004/005`).
 *
 * The affordance matrix is asserted GRAPH-DERIVED: for every status the
 * contract publishes, the expected set of controls is computed from
 * `APPOINTMENT_TRANSITIONS` itself — reschedule wherever any move remains,
 * cancel wherever `cancelled` is a listed destination, no-show wherever
 * `no_show` is — and the rendering is held to that computation. A hand-written
 * list here would be a second copy of the graph that drifts.
 *
 * The If-Match discipline (QA-004) is asserted behaviourally: the version a
 * command sends comes from the page's own read, and after a success the NEXT
 * command sends the version the previous command's response returned.
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
    branchId: '22222222-2222-4222-8222-222222222222',
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
});

function renderScreen({
  status = 'requested' as AppointmentStatus,
  canManage = true,
  canEndLifecycle = true,
  reasons = REASONS as IntakeCatalogueResult | null,
  base = {} as Partial<AppointmentDetail>,
} = {}) {
  return renderLtr(
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

const rescheduleHeading = () =>
  screen.queryByRole('heading', { name: en['appointments.reschedule.title'] });
const cancelButton = () =>
  screen.queryByRole('button', { name: en['appointments.cancel.openDialog'] });
const noShowButton = () =>
  screen.queryByRole('button', { name: en['appointments.noShow.openDialog'] });

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
    expect(
      screen.getByRole('button', { name: en['appointments.reschedule.submit'] })
    ).toBeInTheDocument();
    expect(en['appointments.reschedule.submit']).toMatch(/rescheduling/i);
  });
});

async function fillWindow(from: string, to: string) {
  fireEvent.change(screen.getByLabelText(new RegExp(en['appointments.window.from'])), {
    target: { value: from },
  });
  fireEvent.change(screen.getByLabelText(new RegExp(en['appointments.window.to'])), {
    target: { value: to },
  });
}

describe('confirm by rescheduling (FE-003)', () => {
  it('sends the version the page READ, and a window carrying explicit offsets', async () => {
    rescheduleAppointment.mockResolvedValue({
      status: 'success',
      attempt: 1,
      correlationId: 'cid',
      changed: {
        appointmentId: detail().id,
        changeKind: 'rescheduled',
        lifecycleStatus: 'confirmed',
        recordVersion: 8,
      },
    });
    const user = userEvent.setup();
    renderScreen({ status: 'requested' });
    await fillWindow('2026-08-21T09:00', '2026-08-21T10:00');
    await user.click(screen.getByRole('button', { name: en['appointments.reschedule.submit'] }));

    await waitFor(() => expect(rescheduleAppointment).toHaveBeenCalledTimes(1));
    const [id, ifMatch, input] = rescheduleAppointment.mock.calls[0] as [
      string,
      number,
      { confirmedFrom: string; confirmedTo: string },
    ];
    expect(id).toBe(detail().id);
    // QA-004: the version comes from the detail read this page was given.
    expect(ifMatch).toBe(7);
    expect(input.confirmedFrom).toMatch(/^2026-08-21T09:00:00(?:Z|[+-]\d{2}:\d{2})$/);
    expect(input.confirmedTo).toMatch(/^2026-08-21T10:00:00(?:Z|[+-]\d{2}:\d{2})$/);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('refuses an inverted window locally, against the end field, without a request', async () => {
    const user = userEvent.setup();
    renderScreen({ status: 'requested' });
    await fillWindow('2026-08-21T10:00', '2026-08-21T09:00');
    await user.click(screen.getByRole('button', { name: en['appointments.reschedule.submit'] }));
    expect(await screen.findByText(en['field.windowEndsBeforeStart'])).toBeInTheDocument();
    expect(rescheduleAppointment).not.toHaveBeenCalled();
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
    await fillWindow('2026-08-21T09:00', '2026-08-21T10:00');
    await user.click(screen.getByRole('button', { name: en['appointments.reschedule.submit'] }));

    expect(await screen.findByText(en['state.conflict.title'])).toBeInTheDocument();
    const reload = screen.getByRole('button', { name: en['appointments.detail.reload'] });
    await user.click(reload);
    expect(refresh).toHaveBeenCalled();
  });

  it('sources the NEXT command version from the previous command response', async () => {
    // Reschedule succeeds and returns version 8; the cancel that follows must
    // present 8, not the page's stale 7 (QA-004's exact rule).
    rescheduleAppointment.mockResolvedValue({
      status: 'success',
      attempt: 1,
      correlationId: 'cid',
      changed: {
        appointmentId: detail().id,
        changeKind: 'rescheduled',
        lifecycleStatus: 'confirmed',
        recordVersion: 8,
      },
    });
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
    await fillWindow('2026-08-21T09:00', '2026-08-21T10:00');
    await user.click(screen.getByRole('button', { name: en['appointments.reschedule.submit'] }));
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

describe('cancellation needs its catalogued reason (FE-004)', () => {
  it('sends the chosen reason with the read version', async () => {
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
    await user.selectOptions(
      screen.getByLabelText(new RegExp(en['appointments.cancel.reason'])),
      REASONS.options[0]!.id
    );
    await user.click(screen.getByRole('button', { name: en['appointments.cancel.confirm'] }));

    await waitFor(() => expect(cancelAppointment).toHaveBeenCalledTimes(1));
    expect(cancelAppointment).toHaveBeenCalledWith(
      detail().id,
      7,
      { cancellationReasonId: REASONS.options[0]!.id },
      1
    );
  });

  it('refuses to submit without a reason — there is no free-text escape', async () => {
    const user = userEvent.setup();
    renderScreen({ status: 'confirmed' });
    await user.click(screen.getByRole('button', { name: en['appointments.cancel.openDialog'] }));
    await user.click(screen.getByRole('button', { name: en['appointments.cancel.confirm'] }));
    expect(await screen.findByText(en['field.required'])).toBeInTheDocument();
    expect(cancelAppointment).not.toHaveBeenCalled();
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
});

describe('facts and directions', () => {
  it('shows the record facts an operator reports from', () => {
    renderScreen({ status: 'requested' });
    expect(screen.getByText('APT-0007')).toBeInTheDocument();
    expect(screen.getByText('Nadia Khoury')).toBeInTheDocument();
    expect(screen.getByText('V-0100')).toBeInTheDocument();
    // The version is displayed as a record fact; the commands carry it
    // invisibly.
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: en['appointments.detail.openVehicle'] })
    ).toHaveAttribute('href', `/en/vehicles/${detail().vehicleId}`);
  });

  it('renders in Arabic, right to left', () => {
    renderRtl(
      <AppointmentDetailScreen
        locale="ar"
        messages={ar}
        detail={detail()}
        canManage
        canEndLifecycle
        cancellationReasons={REASONS}
      />
    );
    expect(
      screen.getByRole('heading', { name: ar['appointments.reschedule.title'] })
    ).toBeInTheDocument();
    // `requested` refuses no-show in Arabic exactly as it does in English —
    // the graph, not the locale, decides.
    expect(screen.queryByRole('button', { name: ar['appointments.noShow.openDialog'] })).toBeNull();
    expect(
      screen.getByRole('button', { name: ar['appointments.cancel.openDialog'] })
    ).toBeInTheDocument();
  });
});
