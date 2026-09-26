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
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  TEST_COMPANY,
  branchSnapshot,
  inBranch,
  renderLtr,
  renderRtl,
} from './render';

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
const requestAdditionalWork = vi.fn();
const recordAdditionalWorkApproval = vi.fn();
const signOffRework = vi.fn();
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
  signOffRework: (...args: unknown[]) => signOffRework(...args),
  recordReworkCost: vi.fn(),
  raiseReopenAttempt: vi.fn(),
  requestAdditionalWork: (...args: unknown[]) => requestAdditionalWork(...args),
  recordAdditionalWorkDetail: vi.fn(),
  recordAdditionalWorkApproval: (...args: unknown[]) => recordAdditionalWorkApproval(...args),
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
const JOB = '55555555-5555-4555-8555-555555555555';
// The branch the screen is standing in. It is no longer a pair of controls on
// the queue form — the operator chooses once, in the header — so the test says
// which branch the operator is working in rather than filling two boxes.
const COMPANY = TEST_COMPANY.id;
const BRANCH = TEST_BRANCH.id;

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
  jobs: [
    {
      id: JOB,
      workOrderId: WORK_ORDER,
      title: 'Front brake service',
      jobType: null,
      departmentId: null,
      state: 'in_progress',
      requiresDiagnostic: false,
      recordVersion: 1,
    },
  ],
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
    requestAdditionalWork,
    recordAdditionalWorkApproval,
    signOffRework,
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
    renderLtr(inBranch(<QualityQueueScreen locale="en" messages={en} />));
    const link = await screen.findByRole('link', { name: t('quality.queue.openOrder') });
    expect(link).toHaveAttribute('href', `/en/work-orders/${WORK_ORDER}/closure`);
    expect(listQcQueue).toHaveBeenCalledWith({ companyId: COMPANY, branchId: BRANCH }, {}, null);
  });

  it('renders a refused queue as the refusal it was', async () => {
    listQcQueue.mockResolvedValue(denied);
    renderLtr(inBranch(<QualityQueueScreen locale="en" messages={en} />));
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

  /**
   * Owner directive, user-facing errors. Closing an order that still holds
   * parts is refused by the service, and the screen printed the same line it
   * prints for every other conflict: 'this record was changed by someone
   * else', which is not what happened and says nothing about what to do. The
   * service names the rule (`path.workOrderId`, so it arrives as the banner
   * key), and the screen shows the sentence for the rules it has been told
   * about.
   */
  it('says why a close was refused when parts are still held, not the generic conflict line', async () => {
    readClosureEligibility.mockResolvedValue(ok({ ...eligibility, eligible: true, blockers: [] }));
    closeWorkOrder.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.work_order_stock_still_held',
      correlationId: 'corr-stock-held',
      attempt: 1,
    });
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

    expect(
      await screen.findByText(t('form.violation.work_order_stock_still_held'))
    ).toBeInTheDocument();
    expect(screen.queryByText(t('quality.closure.conflict'))).toBeNull();
    // The rule name itself never reaches the screen; only its sentence does.
    expect(document.body.textContent).not.toContain('work_order_stock_still_held');
  });

  /**
   * And a rule the screen has NOT been told about still gets the fixed
   * sentence. Without this, the membership test above could be satisfied by a
   * screen that rendered whatever key arrived, which is how a raw rule name
   * reaches an operator.
   */
  it('keeps the fixed sentence for a refusal it has not been told about', async () => {
    readClosureEligibility.mockResolvedValue(ok({ ...eligibility, eligible: true, blockers: [] }));
    closeWorkOrder.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.some_rule_this_screen_never_heard_of',
      correlationId: 'corr-unknown-rule',
      attempt: 1,
    });
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

    expect(await screen.findByText(t('quality.closure.conflict'))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('some_rule_this_screen_never_heard_of');
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

/**
 * Owner directive, user-facing errors: the closure screen says what was
 * refused, in the place the reader can act on.
 *
 * Every refusal below arrives as a violation against a path, and every one of
 * them was invisible before: `body.toState` and `body.signOffBy` name controls
 * the forms have but were not reading, while `closure.<blocker>` and
 * `body.originatingJobId` name no control at all — the first because the
 * blockers are keyed by their own codes, the second because the request form
 * offers no origin. Both of the latter belong in the form alert.
 */
const AR = ar as Record<string, string>;
const arT = (key: string): string => AR[key] ?? key;

const reworkLink = {
  id: 'rw1',
  originalWorkOrderId: WORK_ORDER,
  reworkWorkOrderId: '55555555-5555-4555-8555-555555555555',
  rootCause: 'Caliper refitted out of true',
  correctiveAction: 'Refit and retest',
  responsibility: 'workshop',
  leadTechnicianId: null,
  isSafetyCritical: true,
  independentSignOffBy: null,
  signOffAt: null,
  recordVersion: 1,
};

describe('the closure screen says why a command was refused', () => {
  it('puts the not-a-closing-state refusal beside the state control and keeps the reason', async () => {
    readClosureEligibility.mockResolvedValue(ok({ ...eligibility, eligible: true, blockers: [] }));
    closeWorkOrder.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { toState: 'form.violation.not_a_closing_state' },
      correlationId: 'corr-not-closing',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    const select = await screen.findByLabelText(new RegExp(`^${t('quality.closure.closeTo')}`));
    await user.selectOptions(select, 'closed');
    // Scoped to the closure panel: the additional-work row carries a control
    // under the same label, and this case is about the closure command.
    const closure = within(screen.getByRole('region', { name: t('quality.closure.closeHeading') }));
    const reason = closure.getByLabelText(new RegExp(`^${t('quality.closure.reason')}`));
    await user.type(reason, 'Customer collected the vehicle');
    await user.click(screen.getByRole('button', { name: t('quality.closure.close') }));

    const alert = await screen.findByText(t('form.violation.not_a_closing_state'));
    expect(alert).toBeVisible();
    // Re-queried, because the select is remounted on its own choice after each
    // attempt — that remount is what keeps the choice through a refusal.
    const settled = screen.getByLabelText(new RegExp(`^${t('quality.closure.closeTo')}`));
    expect(settled.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    expect((settled as HTMLSelectElement).value).toBe('closed');
    expect((reason as HTMLInputElement).value).toBe('Customer collected the vehicle');
    expect(document.body.textContent).not.toContain('not_a_closing_state');
  });

  it('lifts the outstanding-steps refusal into the alert, since each one is keyed by its own code', async () => {
    readClosureEligibility.mockResolvedValue(ok({ ...eligibility, eligible: true, blockers: [] }));
    closeWorkOrder.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.invalid',
      fieldErrors: {
        B1: 'form.violation.closure_blocked',
        B3: 'form.violation.closure_blocked',
      },
      correlationId: 'corr-blocked',
      attempt: 1,
    });
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

    expect(await screen.findByText(t('form.violation.closure_blocked'))).toBeVisible();
    // Not the fixed conflict line, and not the blocker codes either.
    expect(screen.queryByText(t('quality.closure.conflict'))).toBeNull();
    expect(document.body.textContent).not.toContain('closure_blocked');
  });

  it('reads the outstanding-steps refusal in Arabic', async () => {
    readClosureEligibility.mockResolvedValue(ok({ ...eligibility, eligible: true, blockers: [] }));
    closeWorkOrder.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.invalid',
      fieldErrors: { B1: 'form.violation.closure_blocked' },
      correlationId: 'corr-blocked-ar',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderRtl(
      <WorkOrderClosureScreen
        locale="ar"
        messages={ar}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    await user.selectOptions(
      await screen.findByLabelText(new RegExp(`^${arT('quality.closure.closeTo')}`)),
      'closed'
    );
    await user.click(screen.getByRole('button', { name: arT('quality.closure.close') }));

    expect(await screen.findByText(arT('form.violation.closure_blocked'))).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
  });

  it('puts the deciding-party refusal beside the party control, naming nobody on the visit', async () => {
    recordAdditionalWorkApproval.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { decidingPartyRoleId: 'form.violation.not_on_reception_visit' },
      correlationId: 'corr-party',
      attempt: 1,
    });
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
      await screen.findByLabelText(new RegExp(`^${t('quality.closure.decision')}`)),
      'approved'
    );
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${t('quality.closure.channel')}`)),
      'phone'
    );
    const party = screen.getByLabelText(new RegExp(`^${t('quality.closure.decidingParty')}`));
    await user.type(party, 'the-party-reference');
    const scope = screen.getByLabelText(new RegExp(`^${t('quality.closure.presentedScope')}`));
    await user.type(scope, 'Rear pads only');
    await user.click(screen.getByRole('button', { name: t('quality.closure.recordApproval') }));

    const alert = await screen.findByText(t('form.violation.not_on_reception_visit'));
    expect(alert).toBeVisible();
    expect(party.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    expect((scope as HTMLInputElement).value).toBe('Rear pads only');
  });

  it('puts the independent sign-off refusal beside the name, and keeps the name', async () => {
    listReworkLinks.mockResolvedValue(ok({ items: [reworkLink] }));
    signOffRework.mockResolvedValue({
      status: 'conflict',
      messageKey: 'form.violation.invalid',
      fieldErrors: { signOffBy: 'form.violation.not_independent' },
      correlationId: 'corr-signoff',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    const who = await screen.findByLabelText(new RegExp(`^${t('quality.closure.signOffBy')}`));
    await user.type(who, 'the-colleague-reference');
    await user.click(screen.getByRole('button', { name: t('quality.closure.signOff') }));

    const alert = await screen.findByText(t('form.violation.not_independent'));
    expect(alert).toBeVisible();
    expect(who.getAttribute('aria-describedby') ?? '').toContain(alert.id);
    expect((who as HTMLInputElement).value).toBe('the-colleague-reference');
    // The rework order is reached by a link in words, never by its bare reference
    // (route sweep B3).
    expect(
      screen.getByRole('link', { name: t('quality.closure.openReworkOrder') })
    ).toHaveAttribute('href', `/en/work-orders/${reworkLink.reworkWorkOrderId}`);
    expect(screen.queryByText(reworkLink.reworkWorkOrderId)).toBeNull();
  });

  it('sends the origin chosen from the job picker, and the request is accepted', async () => {
    // The product defect this closes: the form sent neither origin and
    // `additional-work-service` refuses exactly that, so every request raised
    // from this screen was refused whatever was typed into it.
    requestAdditionalWork.mockResolvedValue({
      status: 'success',
      messageKey: 'action.saved',
      correlationId: 'corr-origin-ok',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    const summary = await screen.findByLabelText(
      new RegExp(`^${t('quality.closure.additionalWorkSummary')}`)
    );
    await user.type(summary, 'Rear pads at 2 mm');
    const origin = screen.getByLabelText(new RegExp(`^${t('quality.closure.originatingJob')}`));
    // The picker offers the order's own jobs by their titles, so nobody types
    // a 36-character identifier to say where the work came from.
    expect(
      within(origin as HTMLSelectElement).getByRole('option', { name: 'Front brake service' })
    ).toBeInTheDocument();
    await user.selectOptions(origin, JOB);
    await user.click(screen.getByRole('button', { name: t('quality.closure.requestWork') }));

    await waitFor(() =>
      expect(requestAdditionalWork).toHaveBeenCalledWith(WORK_ORDER, {
        originatingJobId: JOB,
        summary: 'Rear pads at 2 mm',
      })
    );
  });

  it('refuses a request with no origin chosen, beside the picker, and keeps the typed text', async () => {
    const user = userEvent.setup();
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    const summary = await screen.findByLabelText(
      new RegExp(`^${t('quality.closure.additionalWorkSummary')}`)
    );
    await user.type(summary, 'Rear pads at 2 mm');
    await user.click(screen.getByRole('button', { name: t('quality.closure.requestWork') }));

    const origin = screen.getByLabelText(new RegExp(`^${t('quality.closure.originatingJob')}`));
    const sentence = await screen.findByText(t('form.violation.origin_required'));
    expect(sentence).toBeVisible();
    expect(origin.getAttribute('aria-describedby') ?? '').toContain(sentence.id);
    expect((summary as HTMLInputElement).value).toBe('Rear pads at 2 mm');
    expect(requestAdditionalWork).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('origin_required');
  });

  it('puts a refused origin from the service beside the picker, not in the form alert', async () => {
    requestAdditionalWork.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { originatingJobId: 'form.violation.origin_conflict' },
      correlationId: 'corr-origin-conflict',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    const summary = await screen.findByLabelText(
      new RegExp(`^${t('quality.closure.additionalWorkSummary')}`)
    );
    await user.type(summary, 'Rear pads at 2 mm');
    const origin = screen.getByLabelText(new RegExp(`^${t('quality.closure.originatingJob')}`));
    await user.selectOptions(origin, JOB);
    await user.click(screen.getByRole('button', { name: t('quality.closure.requestWork') }));

    const sentence = await screen.findByText(t('form.violation.origin_conflict'));
    /*
     * Re-queried, not re-used. The picker is remounted once the action settles —
     * an uncontrolled value is the only shape that survives the form reset a
     * `<form action>` performs — so the node captured before the submit is
     * detached, and asserting against it would be asserting about a control that
     * is no longer on the page.
     */
    const refused = screen.getByLabelText(new RegExp(`^${t('quality.closure.originatingJob')}`));
    expect(refused.getAttribute('aria-describedby') ?? '').toContain(sentence.id);
    // And the refusal did not cost the operator the choice they had made: the
    // remounted control comes back on the same job, which is what the sentence
    // beside it is about.
    expect((refused as HTMLSelectElement).value).toBe(JOB);
    expect((summary as HTMLInputElement).value).toBe('Rear pads at 2 mm');
    expect(document.body.textContent).not.toContain('origin_conflict');
  });

  it('leaves a refusal it has not been told about to the generic banner', async () => {
    requestAdditionalWork.mockResolvedValue({
      status: 'invalid',
      messageKey: 'form.violation.invalid',
      fieldErrors: { somethingElse: 'form.violation.a_rule_this_screen_never_heard_of' },
      correlationId: 'corr-unknown-field',
      attempt: 1,
    });
    const user = userEvent.setup();
    renderLtr(
      <WorkOrderClosureScreen
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER}
        capabilities={everything}
      />
    );
    const summary = await screen.findByLabelText(
      new RegExp(`^${t('quality.closure.additionalWorkSummary')}`)
    );
    await user.type(summary, 'Rear pads at 2 mm');
    await user.selectOptions(
      screen.getByLabelText(new RegExp(`^${t('quality.closure.originatingJob')}`)),
      JOB
    );
    await user.click(screen.getByRole('button', { name: t('quality.closure.requestWork') }));

    expect(await screen.findByText(t('form.violation.invalid'))).toBeVisible();
    expect(document.body.textContent).not.toContain('a_rule_this_screen_never_heard_of');
  });
});

describe('the QC queue is about ONE branch', () => {
  it('reads nothing and says which control answers while "all my branches" is chosen', async () => {
    // `qms.qc-record-branch-list` takes one branch. A board that guessed would
    // show an operator somebody else work under a heading naming everybody.
    const user = userEvent.setup();
    listQcQueue.mockClear();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to="all" label="use all" />
          <QualityQueueScreen locale="en" messages={en} />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use all' }));
    expect(await screen.findByTestId('requires-concrete-branch')).toHaveTextContent(
      t('workingContext.chooseBranchHere')
    );
    expect(listQcQueue).not.toHaveBeenCalled();
  });
});

describe('the unsaved-work guard stands down once a check is recorded', () => {
  it('asks while a result is chosen and NOT after it is recorded', async () => {
    /*
     * The chosen result is deliberately RETAINED after a successful submit: it
     * seeds the `defaultValue` of a select React remounts, and blanking it
     * would show a placeholder for a check the operator has just recorded. So
     * "the draft is non-empty" was the wrong question — it left the guard
     * permanently dirty, and the shell asked about every later branch switch
     * for work that was saved. "Different from what was recorded" is the right
     * one, and this case is the difference between them.
     */
    writeQcCheckResult.mockResolvedValue({ status: 'success', correlationId: 'c', attempt: 1 });
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <WorkOrderClosureScreen
            locale="en"
            messages={en}
            workOrderId={WORK_ORDER}
            capabilities={everything}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await user.click(await screen.findByRole('button', { name: t('quality.closure.openRecord') }));
    const road = (await screen.findByText('Road safety')).closest('li') as HTMLElement;
    await user.selectOptions(within(road).getByRole('combobox'), 'pass');

    // Chosen and unsent: the switch asks.
    await user.click(screen.getByRole('button', { name: 'use second' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    await user.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' })
    );

    await user.click(within(road).getByRole('button', { name: t('quality.closure.record') }));
    await waitFor(() => expect(writeQcCheckResult).toHaveBeenCalled());

    // Recorded, and the result is still on screen because it is what was saved.
    await user.click(screen.getByRole('button', { name: 'use main' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});

describe('a confirmed "Discard and change branch" empties the rework draft', () => {
  /*
   * The closure view is the work order's, and nothing on it is keyed on the
   * branch. The discard question says the typed entries go; without a reset
   * the rework draft — including the safety answer, a select seeded through its
   * default — would stay on screen after the operator agreed to lose it.
   */
  it('empties the root cause, the corrective action and the safety answer', async () => {
    readClosureEligibility.mockResolvedValue(
      ok({ ...eligibility, eligible: false, blockers: [], alreadyTerminal: true })
    );
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="use main" />
          <BranchSwitch to={OTHER_BRANCH.id} label="use second" />
          <WorkOrderClosureScreen
            locale="en"
            messages={en}
            workOrderId={WORK_ORDER}
            capabilities={everything}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await user.click(screen.getByRole('button', { name: 'use main' }));
    await screen.findByText(t('quality.closure.openRework'));
    const rootCause = () => screen.getByLabelText(new RegExp(`^${t('quality.closure.rootCause')}`));
    const corrective = () =>
      screen.getByLabelText(new RegExp(`^${t('quality.closure.correctiveAction')}`));
    const safety = () =>
      screen.getByLabelText(
        new RegExp(`^${t('quality.closure.safetyCritical')}`)
      ) as HTMLSelectElement;

    await user.type(rootCause(), 'Caliper refitted out of true');
    await user.type(corrective(), 'Refit and torque');
    await user.selectOptions(safety(), 'yes');

    await user.click(screen.getByRole('button', { name: 'use second' }));
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: t('workingContext.discard.confirm') })
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    await waitFor(() => expect(rootCause()).toHaveValue(''));
    expect(corrective()).toHaveValue('');
    expect(safety().value).toBe('');
    // Nothing is left to lose, so the next switch asks nothing.
    await user.click(screen.getByRole('button', { name: 'use main' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    window.localStorage.clear();
  });
});
