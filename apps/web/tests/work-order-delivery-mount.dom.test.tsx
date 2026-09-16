import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import { renderLtr } from './render';

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
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
  transitionWorkOrder: vi.fn(),
  listDepartments: vi.fn(),
  listJobAssignments: vi.fn(),
  updateJob: vi.fn(),
  assignTechnician: vi.fn(),
  listWorkOrders: vi.fn(),
}));

const readWorkOrderTimeline = vi.fn();
vi.mock('@/features/quality/api', () => ({
  readWorkOrderTimeline: (...args: unknown[]) => readWorkOrderTimeline(...args),
  listJobBlockers: vi.fn(),
  raiseJobBlocker: vi.fn(),
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
