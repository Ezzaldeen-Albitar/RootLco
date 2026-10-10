import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';
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
 *
 * The record is mounted as the dashboard mounts it — inside the working context
 * (the work order's branch is `TEST_BRANCH`, whose clock the assignment window
 * is typed on) and the Material provider (ADR-022, Owner directive slice 4).
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
const listDepartments = vi.fn();
const updateJob = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
  transitionWorkOrder: (...args: unknown[]) => transitionWorkOrder(...args),
  listDepartments: (...args: unknown[]) => listDepartments(...args),
  listJobAssignments: (...args: unknown[]) => listJobAssignments(...args),
  updateJob: (...args: unknown[]) => updateJob(...args),
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

/** The dashboard's providers: the working context and the Material foundation. */
function mounted(tree: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {inBranch(tree, { locale })}
    </UiFoundationProvider>
  );
}

async function renderRecord() {
  const tree = await WorkOrderPage({
    params: Promise.resolve({ locale: 'en', workOrderId: WORK_ORDER_ID }),
  });
  return renderLtr(mounted(tree as ReactElement, 'en'));
}

/** The same record in Arabic, so a refusal is read in the direction it ships in. */
async function renderRecordInArabic() {
  const tree = await WorkOrderPage({
    params: Promise.resolve({ locale: 'ar', workOrderId: WORK_ORDER_ID }),
  });
  return renderRtl(mounted(tree as ReactElement, 'ar'));
}

/** The field error's own element — the one `aria-describedby` names. */
const errorElement = (text: HTMLElement) => text.closest('[role="alert"]') as HTMLElement;

/** A moment typed into a date-time field, part by part: day, month, year, hour, minute. */
async function typeMoment(user: ReturnType<typeof userEvent.setup>, label: string, digits: string) {
  const group = screen.getByRole('group', { name: new RegExp(`^${label}`) });
  await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
  await user.keyboard(digits);
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

/**
 * ADR-023 D17 (Owner decision): a quotation user sees no invoice, payment, balance
 * or cost on the work-order record. The quotation codes, the work-order read and
 * the customer read — nothing of `sal.*` or `inv.*` — draw the record with its
 * quotation link and with no way into, or word of, the work order's finance.
 */
describe('a quotation user sees no finance on the work-order record (D17)', () => {
  const QUOTATION_USER = [
    'quo.quotation.read',
    'quo.quotation.manage',
    'quo.decision.record',
    WORK_ORDER_READ,
    'crm.customer.read',
  ];
  const FINANCE_WORDS = /invoice|payment|receipt|settle|balance|outstanding|credit|cost|margin/i;
  const FINANCE_ROUTES = /\/(invoices|payments|credit-notes|delivery-readiness|counter-sales)\b/;

  it('draws the record and its quotation link, and no invoice link, settlement, balance or cost', async () => {
    PERMISSIONS = QUOTATION_USER;
    const { container } = await renderRecord();

    expect(await screen.findByText('WO-000207')).toBeVisible();
    // Non-vacuity: the quotation link is drawn, so the links below were rendered.
    expect(
      screen.getByRole('link', { name: EN['workOrders.detail.quotationsLink'] as string })
    ).toBeVisible();
    expect(
      screen.queryByRole('link', { name: EN['workOrders.detail.invoiceLink'] as string })
    ).toBeNull();
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.filter((href) => FINANCE_ROUTES.test(href))).toEqual([]);
    expect(container.textContent).not.toMatch(FINANCE_WORDS);
    // No handover panel either: delivery readiness needs the finance view.
    expect(handoverSection()).toBeNull();
    expect(readWorkOrderDelivery).not.toHaveBeenCalled();
  });

  it('draws the invoice link once the invoice code is held, so the absence above is the gate', async () => {
    PERMISSIONS = [...QUOTATION_USER, 'sal.invoice.manage'];
    await renderRecord();

    expect(await screen.findByText('WO-000207')).toBeVisible();
    expect(
      screen.getByRole('link', { name: EN['workOrders.detail.invoiceLink'] as string })
    ).toHaveAttribute('href', `/en/invoices?workOrderId=${WORK_ORDER_ID}`);
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
    // A move no state follows is asked about first; nothing is sent before the answer.
    expect(transitionWorkOrder).not.toHaveBeenCalled();
    const question = within(await screen.findByTestId('work-order-move-confirm'));
    await user.click(
      question.getByRole('button', { name: EN['workOrders.detail.moveWorkOrder'] as string })
    );

    const sentence = EN['form.violation.closure_requires_closure_operation'] as string;
    const alert = errorElement(await screen.findByText(sentence));
    expect(alert).toBeVisible();
    expect(alert.id).not.toBe('');
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
    const question = within(await screen.findByTestId('work-order-move-confirm'));
    await user.click(
      question.getByRole('button', { name: AR['workOrders.detail.moveWorkOrder'] as string })
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

    await user.click(await screen.findByRole('button', { name: 'Open job Front brake overhaul' }));
    const profile = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.technicianProfileId'] as string}`)
    );
    await user.type(profile, 'the-reference-on-screen');
    await typeMoment(user, EN['workOrders.detail.windowFrom'] as string, '010920260800');
    await typeMoment(user, EN['workOrders.detail.windowTo'] as string, '010920261200');
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.assignTechnician'] as string })
    );

    const role = screen.getByRole('radiogroup', {
      name: new RegExp(`^${EN['workOrders.detail.assignmentRole'] as string}`),
    });
    const alert = errorElement(
      await screen.findByText(EN['form.violation.primary_already_assigned'] as string)
    );
    expect(alert).toBeVisible();
    expect(alert.id).not.toBe('');
    expect(role.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    // The window went as the branch's instants, with the branch's offset.
    expect(assignTechnician.mock.calls[0]?.[1]).toEqual({
      technicianProfileId: 'the-reference-on-screen',
      assignmentRole: 'primary',
      window: { from: '2026-09-01T08:00:00+03:00', to: '2026-09-01T12:00:00+03:00' },
    });
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

    await user.click(await screen.findByRole('button', { name: 'Open job Front brake overhaul' }));
    const profile = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.technicianProfileId'] as string}`)
    );
    const from = screen.getByRole('group', {
      name: new RegExp(`^${EN['workOrders.detail.windowFrom'] as string}`),
    });
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.assignTechnician'] as string })
    );
    await waitFor(() => expect(profile).toHaveFocus());
    expect(profile).toHaveAttribute('aria-invalid', 'true');
    expect(from).toHaveAttribute('aria-invalid', 'true');
    await typeMoment(user, EN['workOrders.detail.windowFrom'] as string, '010920260800');
    await waitFor(() => expect(from).not.toHaveAttribute('aria-invalid', 'true'));
    expect(profile).toHaveAttribute('aria-invalid', 'true');
    expect(assignTechnician).not.toHaveBeenCalled();
  });

  it('says a window bound typed only in part is unfinished, never that it is required, and assigns nothing', async () => {
    // A partly typed moment holds no value, and the form used to answer it with
    // "This field is required." (2026-10-07 browser retest).
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

    await user.click(await screen.findByRole('button', { name: 'Open job Front brake overhaul' }));
    const profile = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.technicianProfileId'] as string}`)
    );
    await user.type(profile, 'the-reference-on-screen');
    await typeMoment(user, EN['workOrders.detail.windowFrom'] as string, '010920260800');
    // The end: day and month only.
    await typeMoment(user, EN['workOrders.detail.windowTo'] as string, '0109');
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.assignTechnician'] as string })
    );

    expect(await screen.findByText(EN['field.dateTimeIncomplete'] as string)).toBeVisible();
    expect(screen.queryByText(EN['field.required'] as string)).toBeNull();
    const to = screen.getByRole('group', {
      name: new RegExp(`^${EN['workOrders.detail.windowTo'] as string}`),
    });
    expect(to).toHaveAttribute('aria-invalid', 'true');
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

    await user.click(await screen.findByRole('button', { name: 'Open job Front brake overhaul' }));
    const profile = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.technicianProfileId'] as string}`)
    );
    await user.type(profile, 'the-reference-on-screen');
    await typeMoment(user, EN['workOrders.detail.windowFrom'] as string, '010920260800');
    await typeMoment(user, EN['workOrders.detail.windowTo'] as string, '010920261200');
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.assignTechnician'] as string })
    );

    const alert = errorElement(
      await screen.findByText(EN['form.violation.profile-inactive'] as string)
    );
    expect(alert).toBeVisible();
    expect(alert.id).not.toBe('');
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

    await user.click(await screen.findByRole('button', { name: 'Open job Front brake overhaul' }));
    const note = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.blockerNote'] as string}`)
    );
    await user.type(note, 'Waiting on the hoist');
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.raiseBlocker'] as string })
    );

    const alert = errorElement(await screen.findByText(EN['form.violation.refused'] as string));
    expect(alert).toBeVisible();
    expect(alert.id).not.toBe('');
    expect(note.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    expect((note as HTMLInputElement).value).toBe('Waiting on the hoist');
  });
});

/*
 * Checkpoint browser QA, DEF-02: the facts panel drew the state and the parts
 * position as raw codes in monospace ("closed", "none") and showed the record
 * version as a field. The facts are said in words in both languages, the
 * version is not drawn, and it still travels as the If-Match of every guarded
 * command.
 */
describe('the work-order facts are said in words (checkpoint browser QA, DEF-02)', () => {
  const factsPanel = (name: string) => screen.findByRole('region', { name });

  it('says the state and the parts position in English, and draws no version', async () => {
    PERMISSIONS = [WORK_ORDER_READ];
    await renderRecord();
    const panel = await factsPanel(EN['workOrders.detail.factsHeading'] as string);
    const facts = within(panel);
    expect(facts.getByText(EN['workOrders.state.closed'] as string)).toBeVisible();
    expect(facts.getByText(EN['workOrders.partsForward.none'] as string)).toBeVisible();
    expect(facts.queryByText('closed')).toBeNull();
    expect(facts.queryByText('none')).toBeNull();
    expect(panel.querySelector('code')?.textContent).toBe('WO-000207');
    expect(facts.queryByText('Version')).toBeNull();
    expect(panel.querySelectorAll('dt')).toHaveLength(7);
  });

  it('says them in Arabic, right to left', async () => {
    PERMISSIONS = [WORK_ORDER_READ];
    await renderRecordInArabic();
    const panel = await factsPanel(AR['workOrders.detail.factsHeading'] as string);
    const facts = within(panel);
    expect(facts.getByText(AR['workOrders.state.closed'] as string)).toBeVisible();
    expect(facts.getByText(AR['workOrders.partsForward.none'] as string)).toBeVisible();
    expect(panel.textContent).not.toContain('closed');
    expect(panel.textContent).not.toContain('none');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('keeps sending the version as the If-Match of a move, and names the states in words', async () => {
    PERMISSIONS = [WORK_ORDER_READ, 'wo.work_order.transition'];
    readWorkOrderDetail.mockResolvedValue({
      status: 'ok',
      data: movable,
      correlationId: 'corr-wo',
    });
    transitionWorkOrder.mockResolvedValue({ status: 'success', correlationId: 'corr-t' });
    const user = userEvent.setup();
    await renderRecord();

    const select = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.toState'] as string}`)
    );
    expect(
      within(select).getByRole('option', {
        name: `${EN['workOrders.state.awaiting_parts'] as string}`,
      })
    ).toBeTruthy();
    expect(within(select).queryByRole('option', { name: 'awaiting_parts' })).toBeNull();
    expect(
      screen.getByText(EN['workOrders.state.in_progress'] as string, { selector: 'bdi' })
    ).toBeVisible();

    await user.selectOptions(select, 'awaiting_parts');
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.moveWorkOrder'] as string })
    );
    await waitFor(() => expect(transitionWorkOrder).toHaveBeenCalled());
    expect(transitionWorkOrder.mock.calls[0]?.[0]).toBe(WORK_ORDER_ID);
    expect(transitionWorkOrder.mock.calls[0]?.[1]).toEqual({ toState: 'awaiting_parts' });
    expect(transitionWorkOrder.mock.calls[0]?.[2]).toBe(detail.workOrder.recordVersion);
  });
});

/*
 * Browser QA at 305e79c8 (DEF-R1): the History block printed every move as
 * the read carries it — "work_order_status", "ready_to_close → closed" — in
 * English and inside the Arabic page. Each entry is now said in words, the job
 * a job-level entry belongs to by its title, and the kinds withheld from the
 * caller without the permission code that would show them.
 */
describe('the history says each move in words (DEF-R1)', () => {
  const timeline = {
    workOrderId: WORK_ORDER_ID,
    items: [
      {
        kind: 'work_order_status',
        id: 'h1',
        jobId: null,
        actorId: 'actor-reference',
        occurredAt: '2026-09-03T10:00:00.000Z',
        fromState: 'ready_to_close',
        toState: 'closed',
        note: null,
        reference: null,
        detail: null,
      },
      {
        kind: 'job_status',
        id: 'h2',
        jobId: JOB_ID,
        actorId: null,
        occurredAt: '2026-09-02T10:00:00.000Z',
        fromState: 'assigned',
        toState: 'in_progress',
        note: null,
        reference: null,
        detail: null,
      },
    ],
    nextCursor: null,
    hasMore: false,
    omittedKinds: [
      { kind: 'assignment', requires: 'tech.technician.read' },
      { kind: 'qc_status', requires: 'qms.quality_control.read' },
    ],
  };

  it('in English: the kind, both states and the job in words, and no code', async () => {
    PERMISSIONS = [WORK_ORDER_READ];
    readWorkOrderDetail.mockResolvedValue({ status: 'ok', data: movable, correlationId: 'c' });
    readWorkOrderTimeline.mockResolvedValue({ status: 'ok', data: timeline, correlationId: 'c' });
    await renderRecord();
    const history = within(await screen.findByTestId('work-order-history'));
    expect(
      await history.findByText(EN['workOrders.history.kind.work_order_status'] as string)
    ).toBeVisible();
    expect(
      history.getByText(
        `from ${EN['workOrders.state.ready_to_close'] as string} to ${EN['workOrders.state.closed'] as string}`
      )
    ).toBeVisible();
    expect(history.getByText(EN['workOrders.history.kind.job_status'] as string)).toBeVisible();
    expect(
      history.getByText(
        `from ${EN['workOrders.jobState.assigned'] as string} to ${EN['workOrders.jobState.in_progress'] as string}`
      )
    ).toBeVisible();
    expect(history.getByText('Job: Front brake overhaul')).toBeVisible();
    const text = screen.getByTestId('work-order-history').textContent ?? '';
    for (const code of [
      'work_order_status',
      'job_status',
      'ready_to_close',
      'in_progress',
      'tech.technician.read',
      'qms.quality_control.read',
      'actor-reference',
    ]) {
      expect(text, code).not.toContain(code);
    }
    expect(history.getByTestId('work-order-history-omitted')).toHaveTextContent(
      EN['workOrders.history.kind.assignment'] as string
    );
  });

  it('in Arabic, right to left', async () => {
    PERMISSIONS = [WORK_ORDER_READ];
    readWorkOrderDetail.mockResolvedValue({ status: 'ok', data: movable, correlationId: 'c' });
    readWorkOrderTimeline.mockResolvedValue({ status: 'ok', data: timeline, correlationId: 'c' });
    await renderRecordInArabic();
    const history = within(await screen.findByTestId('work-order-history'));
    expect(
      await history.findByText(AR['workOrders.history.kind.work_order_status'] as string)
    ).toBeVisible();
    expect(screen.getByTestId('work-order-history').textContent).not.toContain('ready_to_close');
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('says an unanswered history is unavailable, with a retry that reads again', async () => {
    PERMISSIONS = [WORK_ORDER_READ];
    readWorkOrderTimeline.mockResolvedValueOnce({ status: 'unavailable', correlationId: 'down' });
    const user = userEvent.setup();
    await renderRecord();
    const failure = await screen.findByTestId('work-order-history-failure');
    expect(failure).toHaveTextContent(EN['workOrders.history.unavailable'] as string);
    await user.click(within(failure).getByRole('button', { name: EN['state.retry'] as string }));
    expect(
      await within(screen.getByTestId('work-order-history')).findByText(
        EN['workOrders.detail.noHistory'] as string
      )
    ).toBeVisible();
  });
});

describe('a job is said in words, and its routing rides the edit baseline', () => {
  const departments = [
    { id: 'dep-1', departmentCode: 'MECH', name: 'Mechanical' },
    { id: 'dep-2', departmentCode: 'ELEC', name: 'Electrical' },
  ];

  it('says the job state in words, never its code', async () => {
    PERMISSIONS = [WORK_ORDER_READ];
    readWorkOrderDetail.mockResolvedValue({ status: 'ok', data: movable, correlationId: 'c' });
    await renderRecord();
    const state = await screen.findByTestId('job-state');
    expect(state).toHaveTextContent(EN['workOrders.jobState.in_progress'] as string);
    const jobs = screen.getByRole('region', {
      name: EN['workOrders.detail.jobsHeading'] as string,
    });
    expect(jobs.textContent).not.toContain('in_progress');
  });

  it('routes with the job version, offers the latest version on a conflict, and discards to it', async () => {
    PERMISSIONS = [WORK_ORDER_READ, 'wo.job.manage', 'org.department.read'];
    readWorkOrderDetail.mockResolvedValue({ status: 'ok', data: movable, correlationId: 'c' });
    listDepartments.mockResolvedValue({
      status: 'ok',
      data: { items: departments },
      correlationId: 'c',
    });
    listJobBlockers.mockResolvedValue({ status: 'ok', data: { items: [] }, correlationId: 'c' });
    updateJob.mockResolvedValue({
      status: 'conflict',
      messageKey: 'state.conflict.message',
      correlationId: 'corr-stale',
      attempt: 1,
    });
    const user = userEvent.setup();
    await renderRecord();
    await user.click(await screen.findByRole('button', { name: 'Open job Front brake overhaul' }));
    const department = await screen.findByLabelText(
      new RegExp(`^${EN['workOrders.detail.department'] as string}`)
    );
    // Nothing chosen differs from what is stored: nothing to apply.
    const apply = screen.getByRole('button', {
      name: EN['workOrders.detail.applyRouting'] as string,
    });
    expect(apply).toBeDisabled();
    await user.selectOptions(department, 'dep-2');
    await user.click(apply);
    await waitFor(() =>
      expect(updateJob).toHaveBeenCalledWith(
        JOB_ID,
        { title: 'Front brake overhaul', departmentId: 'dep-2' },
        2
      )
    );
    expect(await screen.findByText(EN['workOrders.detail.conflict'] as string)).toBeVisible();
    // The choice survives the refusal until the operator asks for the latest.
    expect((department as HTMLSelectElement).value).toBe('dep-2');
    readWorkOrderDetail.mockResolvedValue({
      status: 'ok',
      data: { ...movable, jobs: [{ ...job, departmentId: 'dep-1', recordVersion: 5 }] },
      correlationId: 'c',
    });
    await user.click(screen.getByRole('button', { name: EN['form.loadLatest'] as string }));
    await waitFor(() =>
      expect(
        (
          screen.getByLabelText(
            new RegExp(`^${EN['workOrders.detail.department'] as string}`)
          ) as HTMLSelectElement
        ).value
      ).toBe('dep-1')
    );
    // The next routing is built on the version the re-read brought.
    updateJob.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${EN['workOrders.detail.department'] as string}`)),
      ''
    );
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.applyRouting'] as string })
    );
    await waitFor(() =>
      expect(updateJob).toHaveBeenLastCalledWith(
        JOB_ID,
        { title: 'Front brake overhaul', departmentId: null },
        5
      )
    );
  });

  /*
   * The two cases below are where the baseline's version and the live one
   * DIFFER. In the conflict case above they are the same number, so sending the
   * live `job.recordVersion` instead of `edit.version`, or dropping the
   * post-save `edit.rebase`, left every case green (fix round 2, PR #482).
   */
  const departmentBox = () =>
    screen.getByLabelText(
      new RegExp(`^${EN['workOrders.detail.department'] as string}`)
    ) as HTMLSelectElement;
  const applyButton = () =>
    screen.getByRole('button', { name: EN['workOrders.detail.applyRouting'] as string });

  function routable() {
    PERMISSIONS = [WORK_ORDER_READ, 'wo.job.manage', 'org.department.read', 'tech.labor.record'];
    readWorkOrderDetail.mockResolvedValue({ status: 'ok', data: movable, correlationId: 'c' });
    listDepartments.mockResolvedValue({
      status: 'ok',
      data: { items: departments },
      correlationId: 'c',
    });
    listJobBlockers.mockResolvedValue({ status: 'ok', data: { items: [] }, correlationId: 'c' });
  }

  it('keeps the chosen department on its baseline version when another command re-reads a newer job', async () => {
    routable();
    raiseJobBlocker.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    updateJob.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    await renderRecord();
    await user.click(await screen.findByRole('button', { name: 'Open job Front brake overhaul' }));
    await screen.findByLabelText(new RegExp(`^${EN['workOrders.detail.department'] as string}`));
    await user.selectOptions(departmentBox(), 'dep-2');

    // Another panel's command stores something and re-reads the work order,
    // which brings the job at a newer version while the choice is unapplied.
    readWorkOrderDetail.mockResolvedValue({
      status: 'ok',
      data: { ...movable, jobs: [{ ...job, recordVersion: 4 }] },
      correlationId: 'c',
    });
    const readsBefore = readWorkOrderDetail.mock.calls.length;
    await user.type(
      screen.getByLabelText(new RegExp(`^${EN['workOrders.detail.blockerNote'] as string}`)),
      'Waiting on the hoist'
    );
    await user.click(
      screen.getByRole('button', { name: EN['workOrders.detail.raiseBlocker'] as string })
    );
    await waitFor(() => expect(readWorkOrderDetail.mock.calls.length).toBeGreaterThan(readsBefore));
    // The choice survives the re-read.
    await waitFor(() => expect(applyButton()).toBeEnabled());
    expect(departmentBox().value).toBe('dep-2');

    await user.click(applyButton());
    // Built on version 2, so it is sent at version 2: the job moved since, and
    // that is the server's conflict to decide, never a silent overwrite.
    await waitFor(() =>
      expect(updateJob).toHaveBeenCalledWith(
        JOB_ID,
        { title: 'Front brake overhaul', departmentId: 'dep-2' },
        2
      )
    );
  });

  it('leaves the form clean after a stored routing: Apply is off and a branch switch asks nothing', async () => {
    routable();
    updateJob.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    const tree = await WorkOrderPage({
      params: Promise.resolve({ locale: 'en', workOrderId: WORK_ORDER_ID }),
    });
    renderLtr(
      <UiFoundationProvider locale="en" text={muiTextOf(getMessages('en'))}>
        {inBranch(
          <>
            <BranchSwitch to={TEST_BRANCH.id} label="first" />
            <BranchSwitch to={OTHER_BRANCH.id} label="second" />
            {tree as ReactElement}
          </>,
          { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]), locale: 'en' }
        )}
      </UiFoundationProvider>
    );
    await user.click(screen.getByRole('button', { name: 'first' }));
    await user.click(await screen.findByRole('button', { name: 'Open job Front brake overhaul' }));
    await screen.findByLabelText(new RegExp(`^${EN['workOrders.detail.department'] as string}`));
    await user.selectOptions(departmentBox(), 'dep-2');

    // The re-read after the save brings the routing as stored, one version on.
    readWorkOrderDetail.mockResolvedValue({
      status: 'ok',
      data: { ...movable, jobs: [{ ...job, departmentId: 'dep-2', recordVersion: 3 }] },
      correlationId: 'c',
    });
    const readsBefore = readWorkOrderDetail.mock.calls.length;
    await user.click(applyButton());
    await waitFor(() => expect(updateJob).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readWorkOrderDetail.mock.calls.length).toBeGreaterThan(readsBefore));
    await waitFor(() =>
      expect(applyButton()).toHaveTextContent(EN['workOrders.detail.applyRouting'] as string)
    );
    expect(departmentBox().value).toBe('dep-2');
    // Nothing is left to apply, so nothing is unsaved.
    expect(applyButton()).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'second' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
