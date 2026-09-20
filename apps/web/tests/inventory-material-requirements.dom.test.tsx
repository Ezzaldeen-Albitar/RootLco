import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * What a job is allowed to consume, rendered (P1-32).
 *
 * The properties under test:
 *
 * - every allowance figure is the server exact decimal string, and the panel
 *   derives none of them — a remainder that is not the difference of the two
 *   figures beside it is still rendered as the server sent it;
 * - a requirement waiting on a missing fact says WHICH fact in plain words,
 *   names the act that closes it, and offers nothing that would be refused;
 * - the person who asked is told they cannot decide their own request and is
 *   offered no decision, and the refusal the server raises if one reaches it
 *   anyway is rendered as published;
 * - asking for extra material sends the exact quantity typed with its reason;
 * - a requirement derived from the confirmed capacity sends no quantity at all,
 *   and an entered one cannot be sent without the source it was read from.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const listMaterialRequirements = vi.fn();
const readMaterialRequirement = vi.fn();
const createMaterialRequirement = vi.fn();
const decideMaterialRequirement = vi.fn();
const recheckMaterialRequirement = vi.fn();
const cancelMaterialRequirement = vi.fn();
const requestMaterialException = vi.fn();
const decideMaterialException = vi.fn();
const listUnitsOfMeasure = vi.fn();
const listVehicleSpecifications = vi.fn();
const listServiceLines = vi.fn();
const listItems = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  listServiceLines: (...args: unknown[]) => listServiceLines(...args),
}));
vi.mock('@/features/inventory/api', () => ({
  listMaterialRequirements: (...args: unknown[]) => listMaterialRequirements(...args),
  readMaterialRequirement: (...args: unknown[]) => readMaterialRequirement(...args),
  createMaterialRequirement: (...args: unknown[]) => createMaterialRequirement(...args),
  decideMaterialRequirement: (...args: unknown[]) => decideMaterialRequirement(...args),
  recheckMaterialRequirement: (...args: unknown[]) => recheckMaterialRequirement(...args),
  cancelMaterialRequirement: (...args: unknown[]) => cancelMaterialRequirement(...args),
  requestMaterialException: (...args: unknown[]) => requestMaterialException(...args),
  decideMaterialException: (...args: unknown[]) => decideMaterialException(...args),
  listUnitsOfMeasure: (...args: unknown[]) => listUnitsOfMeasure(...args),
  listVehicleSpecifications: (...args: unknown[]) => listVehicleSpecifications(...args),
  // DEF-M-05, second half: the item is CHOSEN from the catalogue now, so the
  // search the finder issues belongs to this panel's surface.
  listItems: (...args: unknown[]) => listItems(...args),
}));

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { MaterialRequirementsPanel } =
  await import('@/features/inventory/components/MaterialRequirementsPanel');

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ITEM_ID = '33333333-3333-4333-8333-333333333333';
const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const USER_ID = '99999999-9999-4999-8999-999999999999';
const OTHER_USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUIREMENT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SERVICE_LINE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
/** One service line of the work order, as `wo.service-line-list` publishes it. */
const serviceLine = {
  id: SERVICE_LINE_ID,
  workOrderId: WORK_ORDER_ID,
  jobId: null,
  description: 'Engine oil change',
  quantity: '1.000',
  unit: 'EA',
  reference: null,
  recordVersion: 1,
};
const SPECIFICATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const UOM_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const EXCEPTION_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const MAKE_ID = '12121212-1212-4121-8121-121212121212';
const MODEL_ID = '13131313-1313-4131-8131-131313131313';

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const listing = (rows: readonly unknown[]) =>
  okRead({ items: rows, nextCursor: null, hasMore: false });

function requirement(over: Record<string, unknown> = {}) {
  return {
    id: REQUIREMENT_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    workOrderId: WORK_ORDER_ID,
    serviceLineId: SERVICE_LINE_ID,
    itemId: ITEM_ID,
    itemCategoryId: null,
    basis: 'specification',
    specificationId: SPECIFICATION_ID,
    serviceCondition: 'oil_change',
    engineVariant: null,
    uomId: UOM_ID,
    sourceReference: null,
    status: 'approved',
    approvalRequiredReason: null,
    requestedBy: OTHER_USER_ID,
    approvedBy: USER_ID,
    approvedAt: '2026-09-01T09:00:00Z',
    rejectedBy: null,
    rejectedAt: null,
    rejectionReason: null,
    allowanceQuantity: '4.250',
    approvedExceptionQuantity: '0.500',
    effectiveAllowance: '4.750',
    requestedQuantity: '0.000',
    reservedQuantity: '1.000',
    issuedQuantity: '0.250',
    returnedQuantity: '0.000',
    committedQuantity: '1.250',
    remainingQuantity: '3.500',
    recordVersion: 1,
    createdAt: '2026-09-01T08:30:00Z',
    ...over,
  };
}

/**
 * A confirmed capacity on file, as `inv.vehicle-specification-list` publishes
 * one. The create form shows these beside the service kind being asked about so
 * the operator sees what can answer before sending; nothing here is ever copied
 * into a field.
 */
function specification(over: Record<string, unknown> = {}) {
  return {
    id: SPECIFICATION_ID,
    makeId: MAKE_ID,
    modelId: MODEL_ID,
    modelYearFrom: null,
    modelYearTo: null,
    engineVariant: null,
    serviceCondition: 'oil_change',
    itemCategoryId: null,
    capacity: '4.250',
    uomId: UOM_ID,
    uomCode: 'L',
    sourceReference: 'Workshop manual, page 41',
    status: 'confirmed',
    createdBy: OTHER_USER_ID,
    createdAt: '2026-08-01T08:00:00Z',
    confirmedBy: USER_ID,
    confirmedAt: '2026-08-02T08:00:00Z',
    retiredBy: null,
    retiredAt: null,
    recordVersion: 1,
    ...over,
  };
}

function exception(over: Record<string, unknown> = {}) {
  return {
    id: EXCEPTION_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    requirementId: REQUIREMENT_ID,
    additionalQuantity: '0.750',
    resultingAllowance: null,
    reason: 'The sump was overfilled on arrival',
    status: 'pending',
    requestedBy: OTHER_USER_ID,
    decidedBy: null,
    decidedAt: null,
    decisionNote: null,
    recordVersion: 1,
    createdAt: '2026-09-01T10:00:00Z',
    ...over,
  };
}

function renderPanel(over: Record<string, unknown> = {}) {
  return renderLtr(
    <MaterialRequirementsPanel
      locale="en"
      messages={en}
      workOrderId={WORK_ORDER_ID}
      target={{ companyId: COMPANY_ID, branchId: BRANCH_ID }}
      currentUserId={USER_ID}
      canRequest={false}
      canApprove={false}
      canDecideException={false}
      canReadWorkOrder={true}
      chosenId={null}
      onChoose={vi.fn()}
      onChanged={vi.fn()}
      {...over}
    />
  );
}

const allowance = () => screen.getByTestId('material-allowance');

beforeEach(() => {
  vi.clearAllMocks();
  listMaterialRequirements.mockImplementation(async () => listing([requirement()]));
  readMaterialRequirement.mockImplementation(async () =>
    okRead({ ...requirement(), exceptions: [] })
  );
  listUnitsOfMeasure.mockImplementation(async () =>
    okRead({
      items: [{ id: UOM_ID, scope: 'platform', code: 'L', name: 'Litre', dimension: 'volume' }],
    })
  );
  listVehicleSpecifications.mockImplementation(async () => listing([specification()]));
  listServiceLines.mockImplementation(async () => okRead({ items: [serviceLine] }));
  listItems.mockImplementation(async () => ({
    status: 'ok' as const,
    rows: [{ id: ITEM_ID, sku: 'OIL-5W30', name: 'Engine oil', lifecycleStatus: 'active' }],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr',
  }));
});

describe('the allowance is the server figure', () => {
  it('renders each figure exactly as sent and derives none of them', async () => {
    renderPanel();
    await waitFor(() => expect(listMaterialRequirements).toHaveBeenCalled());
    const bar = allowance();
    expect(within(bar).getByText('4.750')).toBeVisible();
    expect(within(bar).getByText('0.500')).toBeVisible();
    expect(within(bar).getByText('1.250')).toBeVisible();
    // 4.750 - 1.250 is 3.500, and the server said 3.500. What matters is that the
    // string is the SERVER's: a panel that recomputed would print 3.5, not 3.500.
    expect(within(bar).getByText('3.500')).toBeVisible();
  });

  it('says an allowance is not set rather than printing a zero for it', async () => {
    listMaterialRequirements.mockImplementation(async () =>
      listing([
        requirement({
          status: 'approval_required',
          approvalRequiredReason: 'missing_specification',
          specificationId: null,
          allowanceQuantity: null,
          effectiveAllowance: null,
          remainingQuantity: null,
          approvedExceptionQuantity: '0.000',
          committedQuantity: '0.000',
        }),
      ])
    );
    renderPanel();
    const bar = await waitFor(() => allowance());
    expect(
      within(bar).getAllByText(EN['inventory.material.allowance.unset'] as string)
    ).toHaveLength(2);
    expect(within(bar).getAllByText('0.000')).toHaveLength(2);
  });

  it('is requested at all only when the branch of the job is known', async () => {
    renderPanel({ target: null });
    expect(screen.getByText(EN['inventory.material.needBranch'] as string)).toBeVisible();
    expect(listMaterialRequirements).not.toHaveBeenCalled();
  });
});

describe('a requirement waiting on a missing fact', () => {
  it('names the fact and the act that closes it, and offers a re-check', async () => {
    const user = userEvent.setup();
    recheckMaterialRequirement.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.material.recheck.success' },
      created: null,
    });
    listMaterialRequirements.mockImplementation(async () =>
      listing([
        requirement({
          status: 'approval_required',
          approvalRequiredReason: 'missing_specification',
          specificationId: null,
          allowanceQuantity: null,
          effectiveAllowance: null,
          remainingQuantity: null,
        }),
      ])
    );
    renderPanel({ canRequest: true });

    const blocked = await screen.findByText(
      EN['inventory.material.blocked.missing_specification'] as string
    );
    expect(blocked).toBeVisible();
    // The sentence names the act, not a code.
    expect(EN['inventory.material.blocked.missing_specification']).toContain('Confirm');
    expect(
      screen.queryByRole('button', { name: EN['inventory.material.use'] as string })
    ).toBeNull();

    await user.click(
      screen.getByRole('button', { name: EN['inventory.material.recheck.action'] as string })
    );
    await waitFor(() => expect(recheckMaterialRequirement).toHaveBeenCalledWith(REQUIREMENT_ID));
  });

  it('names the missing conversion when that is what is lacking', async () => {
    listMaterialRequirements.mockImplementation(async () =>
      listing([
        requirement({
          status: 'approval_required',
          approvalRequiredReason: 'missing_unit_conversion',
          allowanceQuantity: null,
          effectiveAllowance: null,
          remainingQuantity: null,
        }),
      ])
    );
    renderPanel({ canRequest: true });
    expect(
      await screen.findByText(EN['inventory.material.blocked.missing_unit_conversion'] as string)
    ).toBeVisible();
  });
});

describe('two people', () => {
  it('offers no decision to the person who asked, and says why', async () => {
    listMaterialRequirements.mockImplementation(async () =>
      listing([requirement({ status: 'pending_approval', requestedBy: USER_ID, approvedBy: null })])
    );
    renderPanel({ canApprove: true });
    expect(
      await screen.findByText(EN['inventory.material.decide.ownRequest'] as string)
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: EN['inventory.material.decide.approve'] as string })
    ).toBeNull();
    expect(decideMaterialRequirement).not.toHaveBeenCalled();
  });

  it('offers the decision to a different approver and renders a server refusal as published', async () => {
    const user = userEvent.setup();
    decideMaterialRequirement.mockResolvedValue({
      state: {
        status: 'conflict',
        messageKey: 'inventory.material.decide.refused',
        correlationId: 'ref-409',
      },
      created: null,
    });
    listMaterialRequirements.mockImplementation(async () =>
      listing([
        requirement({ status: 'pending_approval', requestedBy: OTHER_USER_ID, approvedBy: null }),
      ])
    );
    renderPanel({ canApprove: true });

    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.material.decide.approve'] as string,
      })
    );
    await waitFor(() =>
      expect(decideMaterialRequirement).toHaveBeenCalledWith(REQUIREMENT_ID, {
        decision: 'approved',
      })
    );
    const refusal = await screen.findByRole('alert');
    expect(refusal).toHaveTextContent(EN['inventory.material.decide.refused'] as string);
    expect(refusal).toHaveTextContent('ref-409');
  });

  it('sends a rejection with the reason typed for it', async () => {
    const user = userEvent.setup();
    decideMaterialRequirement.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.material.decide.success' },
      created: null,
    });
    listMaterialRequirements.mockImplementation(async () =>
      listing([
        requirement({ status: 'pending_approval', requestedBy: OTHER_USER_ID, approvedBy: null }),
      ])
    );
    renderPanel({ canApprove: true });

    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.decide.reject'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.material.decide.rejectHeading'] as string,
    });
    await user.type(
      within(form).getByLabelText(labelled('inventory.material.decide.reason')),
      'The vehicle takes less than that'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.material.decide.reject'] as string })
    );
    await waitFor(() =>
      expect(decideMaterialRequirement).toHaveBeenCalledWith(REQUIREMENT_ID, {
        decision: 'rejected',
        reason: 'The vehicle takes less than that',
      })
    );
  });

  it('offers no decision on an extra asked for by the reader, and offers one on another person’s', async () => {
    const user = userEvent.setup();
    readMaterialRequirement
      .mockImplementationOnce(async () =>
        okRead({ ...requirement(), exceptions: [exception({ requestedBy: USER_ID })] })
      )
      .mockImplementation(async () =>
        okRead({ ...requirement(), exceptions: [exception({ requestedBy: OTHER_USER_ID })] })
      );
    decideMaterialException.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.material.exceptionDecision.success' },
      created: null,
    });
    const { unmount } = renderPanel({ canDecideException: true });

    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.material.exception.heading'] as string,
      })
    );
    expect(
      await screen.findByText(EN['inventory.material.exception.ownRequest'] as string)
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: EN['inventory.material.exception.approve'] as string })
    ).toBeNull();
    unmount();

    renderPanel({ canDecideException: true });
    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.material.exception.heading'] as string,
      })
    );
    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.material.exception.approve'] as string,
      })
    );
    await waitFor(() =>
      expect(decideMaterialException).toHaveBeenCalledWith(EXCEPTION_ID, { decision: 'approved' })
    );
  });
});

describe('asking for extra', () => {
  it('sends the exact quantity typed, with its reason', async () => {
    const user = userEvent.setup();
    requestMaterialException.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.material.exception.success' },
      created: null,
    });
    renderPanel({ canRequest: true });

    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.exception.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.material.exception.formHeading'] as string,
    });
    await user.type(
      within(form).getByLabelText(labelled('inventory.material.exception.quantity')),
      '0.750'
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.material.exception.reason')),
      'The sump was overfilled on arrival'
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.material.exception.submit'] as string,
      })
    );
    await waitFor(() =>
      expect(requestMaterialException).toHaveBeenCalledWith(REQUIREMENT_ID, {
        additionalQuantity: '0.750',
        reason: 'The sump was overfilled on arrival',
      })
    );
    // The string is passed through, never turned into a figure and back.
    const sent = requestMaterialException.mock.calls[0]?.[1] as { additionalQuantity: string };
    expect(sent.additionalQuantity).toBe('0.750');
  });

  it('sends nothing without a reason', async () => {
    const user = userEvent.setup();
    renderPanel({ canRequest: true });
    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.exception.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.material.exception.formHeading'] as string,
    });
    await user.type(
      within(form).getByLabelText(labelled('inventory.material.exception.quantity')),
      '0.750'
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.material.exception.submit'] as string,
      })
    );
    expect(requestMaterialException).not.toHaveBeenCalled();
    expect(within(form).getByText(EN['field.required'] as string)).toBeVisible();
  });
});

describe('asking for a requirement', () => {
  it('derives from the confirmed capacity and states no quantity at all', async () => {
    const user = userEvent.setup();
    createMaterialRequirement.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.material.create.success' },
      created: null,
    });
    renderPanel({ canRequest: true });

    await user.click(
      screen.getByRole('button', { name: EN['inventory.material.create.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.material.create.heading'] as string,
    });
    // No quantity field is offered on this branch at all, so there is nothing to
    // prefill with a capacity nobody stated.
    expect(
      within(form).queryByLabelText(labelled('inventory.material.create.allowanceQuantity'))
    ).toBeNull();
    await user.selectOptions(
      await within(form).findByLabelText(labelled('inventory.material.create.serviceLine')),
      SERVICE_LINE_ID
    );
    // DEF-M-05, second half: the part is CHOSEN from the catalogue search every
    // other stock screen uses. The free-text reference it replaced was a
    // 36-character identifier no screen in the product prints.
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.stockOps.item.search'] as string })
    );
    await user.selectOptions(
      await within(form).findByLabelText(labelled('inventory.stockOps.item.label')),
      ITEM_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.material.create.serviceCondition')),
      'oil_change'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.material.create.submit'] as string })
    );
    await waitFor(() => expect(createMaterialRequirement).toHaveBeenCalled());
    expect(createMaterialRequirement.mock.calls[0]?.[0]).toEqual({
      basis: 'specification',
      serviceLineId: SERVICE_LINE_ID,
      itemId: ITEM_ID,
      serviceCondition: 'oil_change',
    });
  });

  it('shows the confirmed capacities on file for the service kind, with each source', async () => {
    /*
     * The half that was missing: the operator saw no capacity at all until the
     * request came back. Now the confirmed ones on file for the service kind
     * are shown BEFORE it is sent, each with its unit and where it was read —
     * and only the confirmed ones are asked for, because a recorded one answers
     * for no vehicle.
     */
    const user = userEvent.setup();
    renderPanel({ canRequest: true });

    await user.click(
      screen.getByRole('button', { name: EN['inventory.material.create.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.material.create.heading'] as string,
    });
    // Before a service kind is typed the form claims nothing about any capacity.
    expect(
      within(form).getByText(EN['inventory.material.create.matchIdle'] as string)
    ).toBeVisible();
    expect(listVehicleSpecifications).not.toHaveBeenCalled();

    await user.type(
      within(form).getByLabelText(labelled('inventory.material.create.serviceCondition')),
      'oil_change'
    );
    await waitFor(() => expect(listVehicleSpecifications).toHaveBeenCalled());
    expect(listVehicleSpecifications.mock.calls[0]?.[0]).toEqual({
      serviceCondition: 'oil_change',
      status: 'confirmed',
    });
    expect(await within(form).findByText('4.250')).toBeVisible();
    expect(within(form).getByText('Workshop manual, page 41')).toBeVisible();
    // Shown, never copied: this branch still offers no amount field to prefill.
    expect(
      within(form).queryByLabelText(labelled('inventory.material.create.allowanceQuantity'))
    ).toBeNull();
  });

  it('says no confirmed capacity is on file rather than offering a figure', async () => {
    const user = userEvent.setup();
    listVehicleSpecifications.mockImplementation(async () => listing([]));
    renderPanel({ canRequest: true });

    await user.click(
      screen.getByRole('button', { name: EN['inventory.material.create.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.material.create.heading'] as string,
    });
    await user.type(
      within(form).getByLabelText(labelled('inventory.material.create.serviceCondition')),
      'oil_change'
    );
    expect(
      await within(form).findByText(EN['inventory.material.create.matchNone'] as string)
    ).toBeVisible();
  });

  it('refuses an entered amount with no source, and sends both together once given', async () => {
    const user = userEvent.setup();
    createMaterialRequirement.mockResolvedValue({
      state: { status: 'success', messageKey: 'inventory.material.create.success' },
      created: null,
    });
    renderPanel({ canRequest: true });

    await user.click(
      screen.getByRole('button', { name: EN['inventory.material.create.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.material.create.heading'] as string,
    });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.material.create.basis')),
      'entered'
    );
    const quantity = within(form).getByLabelText(
      labelled('inventory.material.create.allowanceQuantity')
    );
    // The field an operator could mistake for a suggestion starts EMPTY.
    expect(quantity).toHaveValue('');
    await user.selectOptions(
      await within(form).findByLabelText(labelled('inventory.material.create.serviceLine')),
      SERVICE_LINE_ID
    );
    await user.type(quantity, '4.250');
    await user.selectOptions(
      await within(form).findByLabelText(labelled('inventory.material.create.uom')),
      UOM_ID
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.material.create.submit'] as string })
    );
    expect(createMaterialRequirement).not.toHaveBeenCalled();
    expect(within(form).getAllByText(EN['field.required'] as string).length).toBeGreaterThan(0);

    await user.type(
      within(form).getByLabelText(labelled('inventory.material.create.sourceReference')),
      'Workshop manual, page 41'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.material.create.submit'] as string })
    );
    await waitFor(() => expect(createMaterialRequirement).toHaveBeenCalled());
    expect(createMaterialRequirement.mock.calls[0]?.[0]).toEqual({
      basis: 'entered',
      serviceLineId: SERVICE_LINE_ID,
      allowanceQuantity: '4.250',
      uomId: UOM_ID,
      sourceReference: 'Workshop manual, page 41',
    });
  });
});

describe('Arabic, right to left', () => {
  it('states the same allowance figures in Arabic', async () => {
    renderRtl(
      <MaterialRequirementsPanel
        locale="ar"
        messages={ar}
        workOrderId={WORK_ORDER_ID}
        target={{ companyId: COMPANY_ID, branchId: BRANCH_ID }}
        currentUserId={USER_ID}
        canRequest={false}
        canApprove={false}
        canDecideException={false}
        canReadWorkOrder={true}
        chosenId={null}
        onChoose={vi.fn()}
        onChanged={vi.fn()}
      />
    );
    await waitFor(() => expect(listMaterialRequirements).toHaveBeenCalled());
    expect(screen.getByText(AR['inventory.material.heading'] as string)).toBeVisible();
    expect(within(allowance()).getByText('3.500')).toBeVisible();
  });
});

/**
 * DEF-M-05 — the service line is CHOSEN, not typed.
 *
 * The form asked for "the reference of the line this material is for" as free
 * text, and no screen in the product publishes a service line's identifier, so
 * an operator had to already know a 36-character identifier to use the screen
 * at all. `wo.service-line-list` publishes the lines under the same code that
 * renders the work-order header, so they are offered. The box survives only for
 * the cases the picker cannot cover, and then the screen says which case it is.
 */
describe('the service line is offered rather than demanded', () => {
  const openForm = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      screen.getByRole('button', { name: EN['inventory.material.create.open'] as string })
    );
    return screen.findByRole('form', {
      name: EN['inventory.material.create.heading'] as string,
    });
  };

  it('reads the lines only when the form is opened, and only for this work order', async () => {
    const user = userEvent.setup();
    renderPanel({ canRequest: true });
    await waitFor(() => expect(listMaterialRequirements).toHaveBeenCalled());
    expect(listServiceLines).not.toHaveBeenCalled();
    await openForm(user);
    await waitFor(() => expect(listServiceLines).toHaveBeenCalledTimes(1));
    expect(listServiceLines.mock.calls[0]?.[0]).toBe(WORK_ORDER_ID);
  });

  it('offers each line by what it is, and no identifier box at all', async () => {
    const user = userEvent.setup();
    renderPanel({ canRequest: true });
    const form = await openForm(user);
    const picker = await within(form).findByLabelText(
      labelled('inventory.material.create.serviceLine')
    );
    expect(
      within(picker).getByRole('option', { name: 'Engine oil change — 1.000 EA' })
    ).toBeInTheDocument();
    expect(
      within(form).queryByLabelText(labelled('inventory.material.create.serviceLineId'))
    ).toBeNull();
  });

  it('keeps the box, and says why, when the operator may not read the work order', async () => {
    const user = userEvent.setup();
    renderPanel({ canRequest: true, canReadWorkOrder: false });
    const form = await openForm(user);
    expect(listServiceLines).not.toHaveBeenCalled();
    expect(
      within(form).getByLabelText(labelled('inventory.material.create.serviceLineId'))
    ).toBeVisible();
    expect(
      within(form).getByText(EN['inventory.material.create.serviceLineNoRead'] as string)
    ).toBeVisible();
  });

  it('says the work order has no line yet rather than offering an empty picker', async () => {
    const user = userEvent.setup();
    listServiceLines.mockImplementation(async () => okRead({ items: [] }));
    renderPanel({ canRequest: true });
    const form = await openForm(user);
    expect(
      await within(form).findByText(EN['inventory.material.create.serviceLineNone'] as string)
    ).toBeVisible();
  });

  it('says a refused read was refused, and keeps the box so the work can continue', async () => {
    const user = userEvent.setup();
    listServiceLines.mockImplementation(async () => ({
      status: 'denied' as const,
      correlationId: 'corr',
    }));
    renderPanel({ canRequest: true });
    const form = await openForm(user);
    expect(
      await within(form).findByText(EN['inventory.material.create.serviceLineRefused'] as string)
    ).toBeVisible();
    expect(
      within(form).getByLabelText(labelled('inventory.material.create.serviceLineId'))
    ).toBeVisible();
  });
});
