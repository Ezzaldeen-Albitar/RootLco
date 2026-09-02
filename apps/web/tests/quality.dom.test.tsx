/**
 * P1-29 W8 — the quality and closure screens in the DOM: the queue renders a
 * real page shape and links each record to its order; the closure view renders
 * the gate as the backend states it, joins the QC vocabulary to a record's
 * results, offers each command only for its code, withholds the two restricted
 * narratives without `iam.sensitive.view`, and disables closure while the gate
 * refuses. The adapters are mocked at the module boundary; the request they
 * build is proved in `quality-api.test.ts`, the responses in
 * `tests/backend/p1-29-w8-quality-and-closure.test.ts`.
 */
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import { renderLtr } from './render';

const EN = en as Record<string, string>;
const t = (key: string): string => EN[key] ?? key;

const listQcQueue = vi.fn();
const listQcChecks = vi.fn();
const listQcRecords = vi.fn();
const readQcRecord = vi.fn();
const readClosureEligibility = vi.fn();
const listReworkLinks = vi.fn();
const readReworkCost = vi.fn();
const listReopenAttempts = vi.fn();
const listAdditionalWork = vi.fn();
const readAdditionalWorkDetail = vi.fn();
const readAdditionalWorkApproval = vi.fn();
const writeQcCheckResult = vi.fn();
const finalizeQcRecord = vi.fn();
const closeWorkOrder = vi.fn();
vi.mock('@/features/quality/api', () => ({
  listQcQueue: (...args: unknown[]) => listQcQueue(...args),
  listQcChecks: () => listQcChecks(),
  listQcRecords: (...args: unknown[]) => listQcRecords(...args),
  readQcRecord: (...args: unknown[]) => readQcRecord(...args),
  readClosureEligibility: (...args: unknown[]) => readClosureEligibility(...args),
  listReworkLinks: (...args: unknown[]) => listReworkLinks(...args),
  readReworkCost: (...args: unknown[]) => readReworkCost(...args),
  listReopenAttempts: (...args: unknown[]) => listReopenAttempts(...args),
  listAdditionalWork: (...args: unknown[]) => listAdditionalWork(...args),
  readAdditionalWorkDetail: (...args: unknown[]) => readAdditionalWorkDetail(...args),
  readAdditionalWorkApproval: (...args: unknown[]) => readAdditionalWorkApproval(...args),
  readWorkOrderTimeline: vi.fn(),
  listJobBlockers: vi.fn(),
  openQcRecord: vi.fn(),
  writeQcCheckResult: (...args: unknown[]) => writeQcCheckResult(...args),
  finalizeQcRecord: (...args: unknown[]) => finalizeQcRecord(...args),
  createRework: vi.fn(),
  signOffRework: vi.fn(),
  recordReworkCost: vi.fn(),
  raiseReopenAttempt: vi.fn(),
  requestAdditionalWork: vi.fn(),
  recordAdditionalWorkDetail: vi.fn(),
  recordAdditionalWorkApproval: vi.fn(),
  fulfillAdditionalWork: vi.fn(),
  withdrawAdditionalWork: vi.fn(),
  closeWorkOrder: (...args: unknown[]) => closeWorkOrder(...args),
  raiseJobBlocker: vi.fn(),
  resolveJobBlocker: vi.fn(),
}));
const readWorkOrderDetail = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
}));
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: () => false,
}));

const { QualityQueueScreen } = await import('@/features/quality/components/QualityQueueScreen');
const { WorkOrderClosureScreen } =
  await import('@/features/quality/components/WorkOrderClosureScreen');

const WORK_ORDER = '11111111-1111-4111-8111-111111111111';
const RECORD = '22222222-2222-4222-8222-222222222222';
const CHECK_A = '33333333-3333-4333-8333-333333333333';
const CHECK_B = '44444444-4444-4444-8444-444444444444';
const COMPANY = '88888888-8888-4888-8888-888888888888';
const BRANCH = '99999999-9999-4999-8999-999999999999';

const ok = <T,>(data: T) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const denied = { status: 'denied' as const, correlationId: 'corr-denied' };
const notFound = { status: 'not-found' as const, correlationId: 'corr' };

const record = {
  id: RECORD,
  workOrderId: WORK_ORDER,
  overallResult: 'open',
  checkerId: null,
  finalizedAt: null,
  recordVersion: 2,
};
const checks = [
  {
    id: CHECK_A,
    code: 'road_safety',
    name: 'Road safety',
    isMandatory: true,
    isSafetyCritical: true,
    scope: 'platform',
    status: 'active',
    recordVersion: 1,
  },
  {
    id: CHECK_B,
    code: 'cosmetic',
    name: 'Cosmetic finish',
    isMandatory: false,
    isSafetyCritical: false,
    scope: 'tenant',
    status: 'active',
    recordVersion: 1,
  },
];
const detail = {
  record,
  results: [
    {
      id: 'r1',
      qcCheckId: CHECK_B,
      checkCode: 'cosmetic',
      result: 'pass',
      note: null,
      recordVersion: 1,
    },
  ],
  unresolvedMandatory: [
    {
      id: CHECK_A,
      code: 'road_safety',
      name: 'Road safety',
      isMandatory: true,
      isSafetyCritical: true,
    },
  ],
};
const eligibility = {
  workOrderId: WORK_ORDER,
  state: 'in_progress',
  eligible: false,
  blockers: [
    {
      code: 'B1',
      message: 'A job on this work order is not in a terminal state.',
      enforcedBy: 'wo.guard_closure',
    },
  ],
  alreadyTerminal: false,
  deferred: {
    owner: 'P1-21',
    conditions: ['B5', 'B6'],
    reason: 'Stock reservation is not represented yet.',
  },
  inventoryCommitments: { activeReservations: 0, openIssues: 0, blocking: false },
};
const workOrderDetail = {
  workOrder: {
    id: WORK_ORDER,
    companyId: COMPANY,
    branchId: BRANCH,
    receptionVisitId: 'v',
    vehicleId: 'veh',
    kind: 'ordinary',
    state: 'in_progress',
    partsForwardState: 'none',
    displayNumber: 'WO-0007',
    openedAt: '2026-09-01T08:00:00.000Z',
    recordVersion: 4,
    customer: null,
    vehicle: { id: 'veh', plate: null, vin: null, make: null, model: null, modelYear: null },
  },
  jobs: [],
  nextStates: [
    { code: 'closed', requiresReason: false, isTerminal: true, isCancellation: false },
    { code: 'cancelled', requiresReason: true, isTerminal: true, isCancellation: true },
  ],
};

const everything = {
  canReadQc: true,
  canRecordQc: true,
  canFinalizeQc: true,
  canManageRework: true,
  canSignOffRework: true,
  canTransition: true,
  canClose: true,
  canRequestAdditionalWork: true,
  canApproveAdditionalWork: true,
  canViewSensitive: false,
};

beforeEach(() => {
  for (const fn of [
    listQcQueue,
    listQcChecks,
    listQcRecords,
    readQcRecord,
    readClosureEligibility,
    listReworkLinks,
    readReworkCost,
    listReopenAttempts,
    listAdditionalWork,
    readAdditionalWorkDetail,
    readAdditionalWorkApproval,
    writeQcCheckResult,
    finalizeQcRecord,
    closeWorkOrder,
    readWorkOrderDetail,
  ]) {
    fn.mockReset();
  }
  readWorkOrderDetail.mockResolvedValue(ok(workOrderDetail));
  readClosureEligibility.mockResolvedValue(ok(eligibility));
  listQcRecords.mockResolvedValue(ok({ items: [record] }));
  listQcChecks.mockResolvedValue(ok({ items: checks }));
  readQcRecord.mockResolvedValue(ok(detail));
  listReworkLinks.mockResolvedValue(ok({ items: [] }));
  listReopenAttempts.mockResolvedValue(ok({ items: [] }));
  listAdditionalWork.mockResolvedValue(
    ok({
      items: [
        {
          id: 'aw1',
          workOrderId: WORK_ORDER,
          originatingJobId: null,
          originatingFindingId: null,
          summary: 'Rear pads',
          state: 'requested',
          fulfillmentState: 'pending',
          isRequired: false,
          createdAt: '2026-09-02T08:00:00.000Z',
          recordVersion: 1,
        },
      ],
    })
  );
  readAdditionalWorkApproval.mockResolvedValue(notFound);
  readAdditionalWorkDetail.mockResolvedValue(
    ok({
      additionalWorkRequestId: 'aw1',
      description: 'Rear pads at 2 mm',
      classification: 'restricted',
      recordVersion: 1,
    })
  );
});

describe('the QC queue', () => {
  it('with one branch, reads the queue at once and links each record to its order', async () => {
    listQcQueue.mockResolvedValue(
      ok({ items: [{ ...record, cursor: 'c1' }], nextCursor: null, hasMore: false })
    );
    renderLtr(
      <QualityQueueScreen locale="en" messages={en} companyIds={[COMPANY]} branchIds={[BRANCH]} />
    );
    const link = await screen.findByRole('link', { name: t('quality.queue.openOrder') });
    expect(link).toHaveAttribute('href', `/en/work-orders/${WORK_ORDER}/closure`);
    expect(listQcQueue).toHaveBeenCalledWith({ companyId: COMPANY, branchId: BRANCH }, {}, null);
  });

  it('renders a refused queue as the refusal it was', async () => {
    listQcQueue.mockResolvedValue(denied);
    renderLtr(
      <QualityQueueScreen locale="en" messages={en} companyIds={[COMPANY]} branchIds={[BRANCH]} />
    );
    expect(await screen.findByText('corr-denied', { exact: false })).toBeInTheDocument();
  });
});

describe('the closure view', () => {
  it('renders the gate as the backend states it, with the deferred conditions named', async () => {
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    expect(await screen.findByText(t('quality.closure.notEligible'))).toBeInTheDocument();
    expect(
      screen.getByText('A job on this work order is not in a terminal state.', { exact: false })
    ).toBeInTheDocument();
    expect(screen.getByText('wo.guard_closure')).toBeInTheDocument();
    expect(screen.getByText('B5, B6', { exact: false })).toBeInTheDocument();
    expect(screen.queryByText(t('quality.closure.inventoryBlocking'))).not.toBeInTheDocument();
    // Rework corrects a closed order: on an open one the form is withheld and the reason stated.
    expect(screen.getByText(t('quality.closure.reworkNeedsClosed'))).toBeInTheDocument();
    expect(screen.queryByText(t('quality.closure.openRework'))).not.toBeInTheDocument();
  });

  it('offers the rework form once the gate reports the order terminal', async () => {
    readClosureEligibility.mockResolvedValue(
      ok({ ...eligibility, eligible: false, blockers: [], alreadyTerminal: true })
    );
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    expect(await screen.findByText(t('quality.closure.alreadyTerminal'))).toBeInTheDocument();
    expect(await screen.findByText(t('quality.closure.openRework'))).toBeInTheDocument();
    expect(screen.queryByText(t('quality.closure.reworkNeedsClosed'))).not.toBeInTheDocument();
  });

  it('names held stock as the reason when no guard blocker stands and the order is still not eligible', async () => {
    readClosureEligibility.mockResolvedValue(
      ok({
        ...eligibility,
        blockers: [],
        inventoryCommitments: { activeReservations: 2, openIssues: 1, blocking: true },
      })
    );
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    expect(await screen.findByText(t('quality.closure.notEligible'))).toBeInTheDocument();
    expect(
      screen.getByText(t('quality.closure.inventoryBlocking'), { exact: false })
    ).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.queryByText('wo.guard_closure')).not.toBeInTheDocument();
  });

  it('joins the vocabulary to the record: the answered check shows its result, the mandatory one is unanswered', async () => {
    const user = userEvent.setup();
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    await user.click(await screen.findByRole('button', { name: t('quality.closure.openRecord') }));
    expect(await screen.findByText('Road safety')).toBeInTheDocument();
    const road = screen.getByText('Road safety').closest('li') as HTMLElement;
    expect(within(road).getByText(t('quality.closure.unanswered'))).toBeInTheDocument();
    const cosmetic = screen.getByText('Cosmetic finish').closest('li') as HTMLElement;
    // The answered check shows its result in the row's status span; the answer form's
    // option of the same name is not the status.
    expect(
      within(cosmetic).getByText(t('quality.checkResult.pass'), { selector: 'span' })
    ).toBeInTheDocument();
    expect(within(road).getByText('road_safety')).toBeInTheDocument();
  });

  it('records a check result by the check’s id and re-reads the record', async () => {
    writeQcCheckResult.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    await user.click(await screen.findByRole('button', { name: t('quality.closure.openRecord') }));
    const road = (await screen.findByText('Road safety')).closest('li') as HTMLElement;
    await user.selectOptions(within(road).getByRole('combobox'), 'pass');
    await user.click(within(road).getByRole('button', { name: t('quality.closure.record') }));
    await waitFor(() =>
      expect(writeQcCheckResult).toHaveBeenCalledWith(RECORD, CHECK_A, { result: 'pass' })
    );
    await waitFor(() => expect(readQcRecord).toHaveBeenCalledTimes(2));
  });

  it('finalizes with the record’s version and hands the outcome onward', async () => {
    finalizeQcRecord.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    await user.click(await screen.findByRole('button', { name: t('quality.closure.openRecord') }));
    await user.selectOptions(
      await screen.findByLabelText(new RegExp(`^${t('quality.closure.overallResult')}`)),
      'passed'
    );
    await user.click(screen.getByRole('button', { name: t('quality.closure.finalize') }));
    await waitFor(() =>
      expect(finalizeQcRecord).toHaveBeenCalledWith(RECORD, { overallResult: 'passed' }, 2)
    );
    await waitFor(() => expect(listQcRecords).toHaveBeenCalledTimes(2));
  });

  it('withholds the restricted description without the sensitive code, and reads it with it', async () => {
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    expect(await screen.findByText('Rear pads')).toBeInTheDocument();
    expect(readAdditionalWorkDetail).not.toHaveBeenCalled();
    expect(screen.queryByText('Rear pads at 2 mm', { exact: false })).toBeNull();
  });

  it('reads the restricted description only with iam.sensitive.view', async () => {
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={{ ...everything, canViewSensitive: true }}
      />
    );
    expect(await screen.findByText('Rear pads at 2 mm', { exact: false })).toBeInTheDocument();
    expect(readAdditionalWorkDetail).toHaveBeenCalledWith('aw1');
  });

  it('offers closure only to a terminal, non-cancelling state, and keeps it disabled while the gate refuses', async () => {
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    const select = await screen.findByLabelText(new RegExp(`^${t('quality.closure.closeTo')}`));
    const options = within(select)
      .getAllByRole('option')
      .map((o) => (o as HTMLOptionElement).value);
    expect(options).toContain('closed');
    expect(options).not.toContain('cancelled');
    expect(screen.getByRole('button', { name: t('quality.closure.close') })).toBeDisabled();
    expect(screen.getByText(t('quality.closure.closeBlocked'))).toBeInTheDocument();
    expect(closeWorkOrder).not.toHaveBeenCalled();
  });

  it('closes with the order’s version once the gate is open', async () => {
    readClosureEligibility.mockResolvedValue(ok({ ...eligibility, eligible: true, blockers: [] }));
    closeWorkOrder.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    await user.selectOptions(
      await screen.findByLabelText(new RegExp(`^${t('quality.closure.closeTo')}`)),
      'closed'
    );
    await user.click(screen.getByRole('button', { name: t('quality.closure.close') }));
    await waitFor(() =>
      expect(closeWorkOrder).toHaveBeenCalledWith(WORK_ORDER, { toState: 'closed' }, 4)
    );
    await waitFor(() => expect(readClosureEligibility).toHaveBeenCalledTimes(2));
  });

  it('shows nothing of QC to a caller without the QC read code, and no closure command without the close code', async () => {
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={{ ...everything, canReadQc: false, canClose: false }}
      />
    );
    expect(await screen.findByText(t('quality.closure.notEligible'))).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: t('quality.closure.qcHeading') })).toBeNull();
    expect(screen.queryByRole('heading', { name: t('quality.closure.closeHeading') })).toBeNull();
    expect(listQcRecords).not.toHaveBeenCalled();
  });
});
