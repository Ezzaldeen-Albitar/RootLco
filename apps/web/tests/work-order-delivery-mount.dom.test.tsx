import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import { renderLtr, renderRtl } from './render';

/**
 * The handover panel on the work-order record, mounted where it ships (P1-31,
 * QA-001, coverage hole H-4).
 *
 * `delivery-start.dom.test.tsx` renders `WorkOrderDeliveryPanel` on its own, so
 * the panel's behaviour was covered while the decision that puts it on the
 * record was not: no suite rendered `WorkOrderDetailScreen` with the panel
 * mounted, nor the work-order route page's permission branch. These cases
 * render the ROUTE PAGE — the way `delivery.dom.test.tsx` renders its own — and
 * assert both: the panel's own content inside the record for a caller who may
 * see a handover, its absence (and no read) for one who may not, and the page's
 * refusal, before anything is read, for a caller without the work-order read.
 */

const EN = en as Record<string, string>;

const WORK_ORDER_ID = '44444444-4444-4444-8444-444444444444';
const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const VEHICLE_ID = '55555555-5555-4555-8555-555555555555';
const VISIT_ID = '66666666-6666-4666-8666-666666666666';
const PARTNER_ID = '88888888-8888-4888-8888-888888888888';

const WORK_ORDER_READ = 'wo.work_order.read';
const DELIVERY_VIEW = 'sal.delivery.view';
const DELIVERY_MANAGE = 'sal.delivery.manage';

const readWorkOrderDetail = vi.fn();
const transitionWorkOrder = vi.fn();
const listJobAssignments = vi.fn();
const assignTechnician = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
  transitionWorkOrder: (...args: unknown[]) => transitionWorkOrder(...args),
  listDepartments: vi.fn(),
  listJobAssignments: (...args: unknown[]) => listJobAssignments(...args),
  updateJob: vi.fn(),
  assignTechnician: (...args: unknown[]) => assignTechnician(...args),
}));
vi.mock('@/features/work-orders/work-order-list-read', () => ({
  listWorkOrdersCancellable: vi.fn(),
}));

const readWorkOrderTimeline = vi.fn();
const listJobBlockers = vi.fn();
const raiseJobBlocker = vi.fn();
vi.mock('@/features/quality/api', () => ({
  readWorkOrderTimeline: (...args: unknown[]) => readWorkOrderTimeline(...args),
  listJobBlockers: (...args: unknown[]) => listJobBlockers(...args),
  raiseJobBlocker: (...args: unknown[]) => raiseJobBlocker(...args),
  resolveJobBlocker: vi.fn(),
}));

const readWorkOrderDelivery = vi.fn();
vi.mock('@/features/delivery/api', () => ({
  readWorkOrderDelivery: (...args: unknown[]) => readWorkOrderDelivery(...args),
  createDelivery: vi.fn(),
}));

const listEmployees = vi.fn();
vi.mock('@/features/delivery/employee-api', () => ({
  listEmployees: (...args: unknown[]) => listEmployees(...args),
}));

const listBranches = vi.fn();
vi.mock('@/features/delivery/branch-api', () => ({
  listBranches: (...args: unknown[]) => listBranches(...args),
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'advisor@test.local' }),
}));

vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: () => true,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const WorkOrderPage = (await import('@/app/[locale]/(dashboard)/work-orders/[workOrderId]/page'))
  .default as unknown as RoutePage;

const detail = {
  workOrder: {
    id: WORK_ORDER_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    receptionVisitId: VISIT_ID,
    vehicleId: VEHICLE_ID,
    kind: 'repair',
    state: 'closed',
    partsForwardState: 'none',
    displayNumber: 'WO-000207',
    openedAt: '2026-09-01T07:00:00.000Z',
    recordVersion: 3,
    customer: {
      partnerId: PARTNER_ID,
      displayName: 'Counter party at the desk',
      relationshipRole: 'service_requester',
      hasAdditionalParties: false,
    },
    vehicle: { vehicleId: VEHICLE_ID, registrationPlate: 'ABC-1234', makeModel: 'Saloon' },
  },
  jobs: [],
  nextStates: [],
};

async function renderRecord() {
  const tree = await WorkOrderPage({
    params: Promise.resolve({ locale: 'en', workOrderId: WORK_ORDER_ID }),
  });
  return renderLtr(tree as React.ReactElement);
}

/** The same record in Arabic, so a refusal is read in the direction it ships in. */
async function renderRecordInArabic() {
  const tree = await WorkOrderPage({
    params: Promise.resolve({ locale: 'ar', workOrderId: WORK_ORDER_ID }),
  });
  return renderRtl(tree as React.ReactElement);
}

/** The handover section, addressed by the heading its own `aria-labelledby` names. */
const handoverSection = () =>
  screen.queryByRole('region', { name: EN['delivery.workOrder.heading'] as string });

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  readWorkOrderDetail.mockResolvedValue({ status: 'ok', data: detail, correlationId: 'corr-wo' });
  readWorkOrderTimeline.mockResolvedValue({
    status: 'ok',
    data: {
      workOrderId: WORK_ORDER_ID,
      items: [],
      nextCursor: null,
      hasMore: false,
      omittedKinds: [],
    },
    correlationId: 'corr-timeline',
  });
  readWorkOrderDelivery.mockResolvedValue({
    status: 'ok',
    data: { workOrderId: WORK_ORDER_ID, delivery: null },
    correlationId: 'corr-delivery',
  });
});

describe('the work-order record mounts the handover panel', () => {
  it('draws the panel inside the record, reading THIS work order’s handover', async () => {
    PERMISSIONS = [WORK_ORDER_READ, DELIVERY_VIEW];
    await renderRecord();

    expect(readWorkOrderDetail).toHaveBeenCalledWith(WORK_ORDER_ID);
    // The record itself is on screen — this is the detail screen, not the panel alone.
    expect(await screen.findByText('WO-000207')).toBeVisible();

    await waitFor(() => expect(readWorkOrderDelivery).toHaveBeenCalledWith(WORK_ORDER_ID));
    const section = handoverSection();
    expect(section, 'the handover panel is not mounted on the record').not.toBeNull();
    expect(
      await within(section as HTMLElement).findByText(EN['delivery.workOrder.none'] as string)
    ).toBeVisible();
    // A caller who may see a handover but not open one is offered no form.
    expect(
      within(section as HTMLElement).queryByRole('form', {
        name: EN['delivery.start.formLabel'] as string,
      })
    ).toBeNull();
  });

  it('carries the write authority into the mounted panel, and nothing wider', async () => {
    PERMISSIONS = [WORK_ORDER_READ, DELIVERY_VIEW, DELIVERY_MANAGE];
    await renderRecord();

    await waitFor(() => expect(readWorkOrderDelivery).toHaveBeenCalledWith(WORK_ORDER_ID));
    const section = handoverSection() as HTMLElement;
    expect(section).not.toBeNull();
    // The manage code draws the Start surface; without the register read code the
    // panel says employee selection cannot be offered, and reads no register.
    expect(
      await within(section).findByText(EN['delivery.start.employeeSelectionUnavailable'] as string)
    ).toBeVisible();
    expect(listEmployees).not.toHaveBeenCalled();
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('omits the panel, and reads no handover, without the delivery view code', async () => {
    PERMISSIONS = [WORK_ORDER_READ];
    await renderRecord();

    expect(await screen.findByText('WO-000207')).toBeVisible();
    expect(handoverSection()).toBeNull();
    expect(readWorkOrderDelivery).not.toHaveBeenCalled();
  });
});

describe('the work-order route decides before it reads', () => {
  it('refuses without the work-order read code, and reads neither the record nor a handover', async () => {
    PERMISSIONS = [DELIVERY_VIEW, DELIVERY_MANAGE];
    await renderRecord();

    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
    expect(readWorkOrderDelivery).not.toHaveBeenCalled();
    expect(handoverSection()).toBeNull();
    expect(screen.queryByText('WO-000207')).toBeNull();
  });
});

/**
 * Owner directive, user-facing errors: the work-order record says what was
 * refused, where the reader can act on it.
 *
 * Each of these refusals arrives as a violation against a named field, which
 * the client files under a control name and the banner never sees. The screens
 * rendered only the banner, so every one of them reached a service adviser as
 * the same "something went wrong" while a specific sentence sat unread in the
 * response. The cases below drive each command through the real screen and
 * assert three things: the sentence is on screen, it is attached to the control
 * it is about, and what the reader typed or chose is still there.
 */
const AR = ar as Record<string, string>;

const JOB_ID = '77777777-7777-4777-8777-777777777777';
const job = {
  id: JOB_ID,
  workOrderId: WORK_ORDER_ID,
  title: 'Front brake overhaul',
  jobType: null,
  departmentId: null,
  state: 'in_progress',
  requiresDiagnostic: false,
  recordVersion: 2,
};
const movable = {
  ...detail,
  workOrder: { ...detail.workOrder, state: 'in_progress' },
  jobs: [job],
  nextStates: [
    { code: 'closed', requiresReason: false, isTerminal: true, isCancellation: false },
    { code: 'awaiting_parts', requiresReason: false, isTerminal: false, isCancellation: false },
  ],
};

describe('the work-order record says why a command was refused', () => {
  it('puts the closing-state refusal beside the state control and keeps the choice', async () => {
    PERMISSIONS = [WORK_ORDER_READ, 'wo.work_order.transition'];
    readWorkOrderDetail.mockResolvedValue({
      status: 'ok',
      data: movable,
      correlationId: 'corr-wo',
    });
    transitionWorkOrder.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { toState: 'form.violation.closure_requires_closure_operation' },
      correlationId: 'corr-transition',
      attempt: 1,
    });
    const user = userEvent.setup();
    await renderRecord();

    const select = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.toState'] as string}`)
    );
    await user.selectOptions(select, 'closed');
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.moveWorkOrder'] as string })
    );

    const sentence = EN['form.violation.closure_requires_closure_operation'] as string;
    const alert = await screen.findByText(sentence);
    expect(alert).toBeVisible();
    // Attached, not merely present: the control names the paragraph that
    // carries the sentence, which is what a screen reader follows.
    expect(select.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    // The choice survives the refusal; the cure is to choose again, not to
    // start again.
    expect((select as HTMLSelectElement).value).toBe('closed');
    expect(document.body.textContent).not.toContain('closure_requires_closure_operation');
  });

  it('reads the same refusal in Arabic', async () => {
    PERMISSIONS = [WORK_ORDER_READ, 'wo.work_order.transition'];
    readWorkOrderDetail.mockResolvedValue({
      status: 'ok',
      data: movable,
      correlationId: 'corr-wo',
    });
    transitionWorkOrder.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { toState: 'form.violation.closure_requires_closure_operation' },
      correlationId: 'corr-transition',
      attempt: 1,
    });
    const user = userEvent.setup();
    await renderRecordInArabic();

    const select = await screen.findByLabelText(
      new RegExp(`^${AR['workOrders.detail.toState'] as string}`)
    );
    await user.selectOptions(select, 'closed');
    await user.click(
      screen.getByRole('button', { name: AR['workOrders.detail.moveWorkOrder'] as string })
    );

    expect(
      await screen.findByText(AR['form.violation.closure_requires_closure_operation'] as string)
    ).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('puts the second-lead refusal beside the role control and keeps what was typed', async () => {
    PERMISSIONS = [WORK_ORDER_READ, 'tech.technician.read', 'tech.assignment.manage'];
    readWorkOrderDetail.mockResolvedValue({
      status: 'ok',
      data: movable,
      correlationId: 'corr-wo',
    });
    listJobAssignments.mockResolvedValue({
      status: 'ok',
      data: { items: [] },
      correlationId: 'corr-assignments',
    });
    listJobBlockers.mockResolvedValue({
      status: 'ok',
      data: { items: [] },
      correlationId: 'corr-blockers',
    });
    assignTechnician.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.invalid',
      fieldErrors: { assignmentRole: 'form.violation.primary_already_assigned' },
      correlationId: 'corr-assign',
      attempt: 1,
    });
    const user = userEvent.setup();
    await renderRecord();

    await user.click(
      await screen.findByRole('button', { name: EN['workOrders.detail.openJob'] as string })
    );
    const profile = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.technicianProfileId'] as string}`)
    );
    await user.type(profile, 'the-reference-on-screen');
    await user.type(
      screen.getByLabelText(new RegExp(`^${EN['workOrders.detail.windowFrom'] as string}`)),
      '2026-09-01T08:00'
    );
    await user.type(
      screen.getByLabelText(new RegExp(`^${EN['workOrders.detail.windowTo'] as string}`)),
      '2026-09-01T12:00'
    );
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.assignTechnician'] as string })
    );

    const role = screen.getByLabelText(
      new RegExp(`^${EN['workOrders.detail.assignmentRole'] as string}`)
    );
    const alert = await screen.findByText(EN['form.violation.primary_already_assigned'] as string);
    expect(alert).toBeVisible();
    expect(role.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    // Nothing the operator typed was thrown away by the refusal.
    expect((profile as HTMLInputElement).value).toBe('the-reference-on-screen');
    expect(document.body.textContent).not.toContain('primary_already_assigned');
  });

  it('marks each missing assignment field, moves the cursor to the first, and withdraws a complaint once it is filled (route sweep B3)', async () => {
    PERMISSIONS = [WORK_ORDER_READ, 'tech.technician.read', 'tech.assignment.manage'];
    readWorkOrderDetail.mockResolvedValue({
      status: 'ok',
      data: movable,
      correlationId: 'corr-wo',
    });
    listJobAssignments.mockResolvedValue({
      status: 'ok',
      data: { items: [] },
      correlationId: 'corr-assignments',
    });
    listJobBlockers.mockResolvedValue({
      status: 'ok',
      data: { items: [] },
      correlationId: 'corr-blockers',
    });
    const user = userEvent.setup();
    await renderRecord();

    await user.click(
      await screen.findByRole('button', { name: EN['workOrders.detail.openJob'] as string })
    );
    const profile = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.technicianProfileId'] as string}`)
    );
    const from = screen.getByLabelText(
      new RegExp(`^${EN['workOrders.detail.windowFrom'] as string}`)
    );
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.assignTechnician'] as string })
    );
    await waitFor(() => expect(profile).toHaveFocus());
    expect(profile).toHaveAttribute('aria-invalid', 'true');
    expect(from).toHaveAttribute('aria-invalid', 'true');
    await user.type(from, '2026-09-01T08:00');
    expect(from).not.toHaveAttribute('aria-invalid', 'true');
    expect(profile).toHaveAttribute('aria-invalid', 'true');
    expect(assignTechnician).not.toHaveBeenCalled();
  });

  it('puts the inactive-technician refusal beside the technician control', async () => {
    // `assign()` runs the eligibility check before the write, and an inactive
    // profile comes back on `body.technicianProfileId` — the control this form
    // actually has. Without this case the field mapping added for it is
    // unexercised, and the only covered assignment refusal is the role one.
    PERMISSIONS = [WORK_ORDER_READ, 'tech.technician.read', 'tech.assignment.manage'];
    readWorkOrderDetail.mockResolvedValue({
      status: 'ok',
      data: movable,
      correlationId: 'corr-wo',
    });
    listJobAssignments.mockResolvedValue({
      status: 'ok',
      data: { items: [] },
      correlationId: 'corr-assignments',
    });
    listJobBlockers.mockResolvedValue({
      status: 'ok',
      data: { items: [] },
      correlationId: 'corr-blockers',
    });
    assignTechnician.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { technicianProfileId: 'form.violation.profile-inactive' },
      correlationId: 'corr-assign',
      attempt: 1,
    });
    const user = userEvent.setup();
    await renderRecord();

    await user.click(
      await screen.findByRole('button', { name: EN['workOrders.detail.openJob'] as string })
    );
    const profile = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.technicianProfileId'] as string}`)
    );
    await user.type(profile, 'the-reference-on-screen');
    await user.type(
      screen.getByLabelText(new RegExp(`^${EN['workOrders.detail.windowFrom'] as string}`)),
      '2026-09-01T08:00'
    );
    await user.type(
      screen.getByLabelText(new RegExp(`^${EN['workOrders.detail.windowTo'] as string}`)),
      '2026-09-01T12:00'
    );
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.assignTechnician'] as string })
    );

    const alert = await screen.findByText(EN['form.violation.profile-inactive'] as string);
    expect(alert).toBeVisible();
    expect(profile.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    // The sentence has to hold on THIS screen too: the refusal here is that the
    // technician cannot be given the job, not only that time cannot be logged.
    expect(alert.textContent).toContain('work cannot be given to them');
    expect((profile as HTMLInputElement).value).toBe('the-reference-on-screen');
    expect(document.body.textContent).not.toContain('profile-inactive');
  });

  it('puts the blocker refusal beside the note, with the note still in the box', async () => {
    PERMISSIONS = [WORK_ORDER_READ, 'tech.labor.record'];
    readWorkOrderDetail.mockResolvedValue({
      status: 'ok',
      data: movable,
      correlationId: 'corr-wo',
    });
    listJobBlockers.mockResolvedValue({
      status: 'ok',
      data: { items: [] },
      correlationId: 'corr-blockers',
    });
    raiseJobBlocker.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { note: 'form.violation.refused' },
      correlationId: 'corr-blocker',
      attempt: 1,
    });
    const user = userEvent.setup();
    await renderRecord();

    await user.click(
      await screen.findByRole('button', { name: EN['workOrders.detail.openJob'] as string })
    );
    const note = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.blockerNote'] as string}`)
    );
    await user.type(note, 'Waiting on the hoist');
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.raiseBlocker'] as string })
    );

    const alert = await screen.findByText(EN['form.violation.refused'] as string);
    expect(alert).toBeVisible();
    expect(note.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    expect((note as HTMLInputElement).value).toBe('Waiting on the hoist');
  });
});
