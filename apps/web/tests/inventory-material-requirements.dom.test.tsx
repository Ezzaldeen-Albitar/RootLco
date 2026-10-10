import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  WorkingBranchProbe,
  branchSnapshot,
  inBranch,
  messagesFor,
  renderLtr as renderInLtr,
  renderRtl as renderInRtl,
} from './render';
import {
  discardAndSwitch,
  forgetRememberedBranch,
  heldBranch,
  stayOnBranch,
  switchExpectingQuestion,
} from './support/branch-switch';
import { MATERIAL_REFUSAL_RULES } from '@/features/inventory/inventory-contract';

/*
 * On Material UI since `P1-32-PRE-OD-INV5`: every render goes under the
 * product's Material provider and a working context, as the locale layout
 * mounts them. The fields are still labelled boxes and native selects, the
 * actions buttons with the same names — so the selectors below did not move.
 */
function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(messagesFor(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderLtr = (ui: ReactElement) => renderInLtr(withMui(inBranch(ui), 'en'));
const renderRtl = (ui: ReactElement) => renderInRtl(withMui(inBranch(ui, { locale: 'ar' }), 'ar'));

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
const listItemCategoryPage = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  listServiceLines: (...args: unknown[]) => listServiceLines(...args),
}));
// P1-32-PRE-OD-INVF: the card names its part by reading the item (LANG-identifiers).
const readItemDetail = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  readItemDetail: (...args: unknown[]) => readItemDetail(...args),
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
  // P1-32-PRE-OD-INV5: the item family is chosen from, and named by, the category tree.
  listItemCategoryPage: (...args: unknown[]) => listItemCategoryPage(...args),
}));

// P1-32-PRE-OD-INVF: a listed confirmed capacity is named by its make, read from the make catalogue.
const listMakes = vi.fn();
vi.mock('@/features/vehicles/catalogue-api', () => ({
  listMakes: (...args: unknown[]) => listMakes(...args),
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
/** Two item families, one under the other, as `inv.item-category-list` publishes them. */
const FLUIDS_ID = '14141414-1414-4141-8141-141414141414';
const OILS_ID = '15151515-1515-4151-8151-151515151515';
const categoryRows = [
  {
    id: FLUIDS_ID,
    code: 'engine_fluids',
    name: 'Engine fluids',
    description: null,
    parentCategoryId: null,
    status: 'active',
    recordVersion: 1,
  },
  {
    id: OILS_ID,
    code: 'oils',
    name: 'Oils',
    description: null,
    parentCategoryId: FLUIDS_ID,
    status: 'active',
    recordVersion: 1,
  },
];

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
      canReadItems={true}
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
  readItemDetail.mockResolvedValue({ status: 'denied', correlationId: 'corr' });
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
  listItemCategoryPage.mockImplementation(async () =>
    okRead({ items: categoryRows, nextCursor: null, hasMore: false })
  );
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

  it('an ended session while reading the extras offers the way back to sign in (INV5 review)', async () => {
    const user = userEvent.setup();
    readMaterialRequirement.mockResolvedValue({ status: 'expired' });
    renderPanel({ canDecideException: true });
    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.material.exception.heading'] as string,
      })
    );
    const signIn = await screen.findByRole('link', { name: EN['auth.backToLogin'] as string });
    expect(signIn).toHaveAttribute('href', '/en/login');
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
        canReadItems={true}
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
    // No requirement is listed, so no card needs a line named (P1-32-PRE-OD-INVF):
    // the form opening is the only thing that asks for the lines.
    listMaterialRequirements.mockImplementation(async () => listing([]));
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

/**
 * DEF-T-16 — a refused request that said only "This change cannot be saved".
 *
 * Asking again for a part the chosen service line already has a live request
 * for was refused twice, from two fresh sessions, and the panel said nothing
 * but that sentence and a correlation reference: nine requests before, nine
 * after, and no statement of whether the line already had one or the job no
 * longer took one. The reason existed in the service and died there, because
 * the problem document is assembled from the catalogue entry and the safe
 * details alone.
 *
 * The service now publishes the rule as a violation and `fromFailure` turns it
 * into a sentence. These cases are the rendering half: one per rule the mirror
 * carries, so a rule added there without a case is still asserted, and the
 * catalogue sentences are read rather than restated.
 *
 * `canRequest` is on and the adapter is mocked, as everywhere in this file, so
 * what is under test is the panel — that the state the adapter really produces
 * (pinned in `inventory-api.test.ts` against the body the API really sends)
 * reaches the operator as its own words.
 */
describe('a refused request says which rule refused it', () => {
  const askAndBeRefused = async (
    messageKey: string,
    locale: 'en' | 'ar' = 'en'
  ): Promise<HTMLElement> => {
    const user = userEvent.setup();
    createMaterialRequirement.mockResolvedValue({
      state: { status: 'conflict', messageKey, correlationId: 'ref-409', attempt: 1 },
      created: null,
    });
    const catalogue = locale === 'en' ? EN : AR;
    if (locale === 'en') renderPanel({ canRequest: true });
    else {
      renderRtl(
        <MaterialRequirementsPanel
          locale="ar"
          messages={ar}
          workOrderId={WORK_ORDER_ID}
          target={{ companyId: COMPANY_ID, branchId: BRANCH_ID }}
          currentUserId={USER_ID}
          canRequest={true}
          canApprove={false}
          canDecideException={false}
          canReadWorkOrder={true}
          canReadItems={true}
          chosenId={null}
          onChoose={vi.fn()}
          onChanged={vi.fn()}
        />
      );
    }
    await user.click(
      screen.getByRole('button', { name: catalogue['inventory.material.create.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: catalogue['inventory.material.create.heading'] as string,
    });
    await user.selectOptions(
      await within(form).findByLabelText(
        new RegExp(`^${escape(catalogue['inventory.material.create.serviceLine'] as string)}`)
      ),
      SERVICE_LINE_ID
    );
    await user.type(
      within(form).getByLabelText(
        new RegExp(`^${escape(catalogue['inventory.material.create.serviceCondition'] as string)}`)
      ),
      'oil_change'
    );
    await user.click(
      within(form).getByRole('button', {
        name: catalogue['inventory.material.create.submit'] as string,
      })
    );
    await waitFor(() => expect(createMaterialRequirement).toHaveBeenCalled());
    return within(form).findByRole('alert');
  };

  for (const rule of MATERIAL_REFUSAL_RULES) {
    it(`says in words what ${rule} means, and never the bare sentence`, async () => {
      const alert = await askAndBeRefused(`form.violation.${rule}`);
      expect(alert).toHaveTextContent(EN[`form.violation.${rule}`] as string);
      expect(alert).not.toHaveTextContent(EN['state.conflict.blocked.title'] as string);
      // The reference stays: it is what support is quoted, beside a reason the
      // operator can act on rather than instead of one.
      expect(alert).toHaveTextContent('ref-409');
    });
  }

  it('says the refusal the campaign measured in Arabic too', async () => {
    const alert = await askAndBeRefused('form.violation.material_duplicate_demand', 'ar');
    expect(alert).toHaveTextContent(AR['form.violation.material_duplicate_demand'] as string);
    expect(alert).not.toHaveTextContent(AR['state.conflict.blocked.title'] as string);
  });

  // CC-OD-32: the Owner requirement is "clear English AND Arabic", so the whole
  // material family is measured in both rather than one member standing for the
  // rest. An Arabic operator meeting the English sentence, or the bare banner,
  // is the same defect as before in a different language.
  for (const rule of MATERIAL_REFUSAL_RULES) {
    it(`says in Arabic what ${rule} means`, async () => {
      const alert = await askAndBeRefused(`form.violation.${rule}`, 'ar');
      expect(alert).toHaveTextContent(AR[`form.violation.${rule}`] as string);
      expect(alert).not.toHaveTextContent(EN[`form.violation.${rule}`] as string);
      expect(alert).not.toHaveTextContent(AR['state.conflict.blocked.title'] as string);
    });
  }
});

/**
 * `P1-32-PRE-OD-INV5` — the panel on Material UI, the item family chosen from the
 * category tree, and the completion standard.
 *
 * The properties under test: the family is CHOSEN from the whole category tree
 * and sent as the chosen category, never typed, in both languages; a listed
 * family is said by its path and code, never by its reference, in both
 * languages; without `inv.item.read` the categories are not read and the
 * typed reference stays; a second press of any write inside ONE `act` sends
 * nothing more (the ref guard, not a re-rendered disabled button); a refused
 * quantity is marked on its own box with what was typed kept and the cursor put
 * there; a half-filled form is unsaved work that a branch switch asks about,
 * and a confirmed discard closes it; a form that opens takes the cursor, and a
 * form closed by its own write gives it back to the button that opened it.
 */
describe('the material panel on Material UI (P1-32-PRE-OD-INV5)', () => {
  const CATALOGUE = { en: EN, ar: AR } as const;
  const escapeText = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const starts = (text: string) => new RegExp(`^${escapeText(text)}`);

  function renderIn(locale: 'en' | 'ar', over: Record<string, unknown> = {}) {
    const ui = (
      <MaterialRequirementsPanel
        locale={locale}
        messages={locale === 'en' ? en : ar}
        workOrderId={WORK_ORDER_ID}
        target={{ companyId: COMPANY_ID, branchId: BRANCH_ID }}
        currentUserId={USER_ID}
        canRequest={false}
        canApprove={false}
        canDecideException={false}
        canReadWorkOrder={true}
        canReadItems={true}
        chosenId={null}
        onChoose={vi.fn()}
        onChanged={vi.fn()}
        {...over}
      />
    );
    return locale === 'en' ? renderLtr(ui) : renderRtl(ui);
  }

  /** A deferred answer, so a write stays in flight until the case settles it. */
  function deferred<T>() {
    let settle: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
      settle = resolve;
    });
    return { promise, settle };
  }
  const success = (messageKey: string) => ({
    state: { status: 'success' as const, messageKey, attempt: 1 },
    created: null,
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`chooses the family from the category tree, says its path, and sends it (${locale})`, async () => {
      const T = CATALOGUE[locale];
      createMaterialRequirement.mockResolvedValue(success('inventory.material.create.success'));
      const user = userEvent.setup();
      renderIn(locale, { canRequest: true });
      await user.click(
        await screen.findByRole('button', { name: T['inventory.material.create.open'] as string })
      );
      const form = await screen.findByRole('form', {
        name: T['inventory.material.create.heading'] as string,
      });
      // The typed reference is gone: the family is chosen, never typed.
      expect(
        within(form).queryByLabelText(
          starts(T['inventory.material.create.itemCategoryId'] as string)
        )
      ).toBeNull();
      const tree = await within(form).findByRole('tree', {
        name: starts(T['inventory.material.create.itemCategory'] as string),
      });
      await user.click(within(tree).getByText('Engine fluids (engine_fluids)'));
      await user.click(await within(tree).findByText('Oils (oils)'));
      await waitFor(() =>
        expect(
          document.getElementById((tree.getAttribute('aria-describedby') ?? '').split(' ')[0] ?? '')
        ).toHaveTextContent('Engine fluids / Oils')
      );
      await user.selectOptions(
        await within(form).findByLabelText(
          starts(T['inventory.material.create.serviceLine'] as string)
        ),
        SERVICE_LINE_ID
      );
      await user.type(
        within(form).getByLabelText(
          starts(T['inventory.material.create.serviceCondition'] as string)
        ),
        'oil_change'
      );
      await user.click(
        within(form).getByRole('button', { name: T['inventory.material.create.submit'] as string })
      );
      await waitFor(() => expect(createMaterialRequirement).toHaveBeenCalledTimes(1));
      expect(createMaterialRequirement.mock.calls[0]?.[0]).toEqual({
        basis: 'specification',
        serviceLineId: SERVICE_LINE_ID,
        itemCategoryId: OILS_ID,
        serviceCondition: 'oil_change',
      });
    });

    it(`says a listed family by its path and code, never its reference (${locale})`, async () => {
      const T = CATALOGUE[locale];
      listMaterialRequirements.mockImplementation(async () =>
        listing([requirement({ itemId: null, itemCategoryId: OILS_ID })])
      );
      renderIn(locale);
      const path = await screen.findByTestId('material-category-path');
      expect(path).toHaveTextContent('Engine fluids / Oils');
      expect(path).toHaveTextContent('oils');
      expect(
        screen.getByText(T['inventory.material.itemFamily'] as string, { exact: false })
      ).toBeVisible();
      expect(screen.queryByText(OILS_ID)).toBeNull();
      expect(listItemCategoryPage).toHaveBeenCalledTimes(1);
    });
  }

  it('reads no category until something on the panel names or asks for one', async () => {
    renderIn('en');
    await waitFor(() => expect(listMaterialRequirements).toHaveBeenCalled());
    await screen.findByTestId('material-allowance');
    expect(listItemCategoryPage).not.toHaveBeenCalled();
  });

  it('without the item read, keeps the typed family reference and reads no category', async () => {
    listMaterialRequirements.mockImplementation(async () =>
      listing([requirement({ itemId: null, itemCategoryId: OILS_ID })])
    );
    const user = userEvent.setup();
    renderIn('en', { canRequest: true, canReadItems: false });
    expect(await screen.findByText(OILS_ID)).toBeVisible();
    await user.click(
      screen.getByRole('button', { name: EN['inventory.material.create.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.material.create.heading'] as string,
    });
    expect(
      within(form).getByLabelText(labelled('inventory.material.create.itemCategoryId'))
    ).toBeVisible();
    expect(within(form).queryByRole('tree')).toBeNull();
    expect(listItemCategoryPage).not.toHaveBeenCalled();
  });

  it('a refused category read leaves the listed family as its reference', async () => {
    listItemCategoryPage.mockImplementation(async () => ({
      status: 'denied' as const,
      correlationId: 'corr',
    }));
    listMaterialRequirements.mockImplementation(async () =>
      listing([requirement({ itemId: null, itemCategoryId: OILS_ID })])
    );
    renderIn('en');
    expect(await screen.findByText(OILS_ID)).toBeVisible();
    expect(screen.queryByTestId('material-category-path')).toBeNull();
  });

  it('a second press of Approve inside the same moment decides once', async () => {
    const answer = deferred<unknown>();
    decideMaterialRequirement.mockImplementation(() => answer.promise);
    listMaterialRequirements.mockImplementation(async () =>
      listing([
        requirement({ status: 'pending_approval', requestedBy: OTHER_USER_ID, approvedBy: null }),
      ])
    );
    renderIn('en', { canApprove: true });
    const approve = await screen.findByRole('button', {
      name: EN['inventory.material.decide.approve'] as string,
    });
    act(() => {
      approve.click();
      approve.click();
    });
    await waitFor(() => expect(decideMaterialRequirement).toHaveBeenCalledTimes(1));
    await act(async () => answer.settle(success('inventory.material.decide.success')));
    expect(decideMaterialRequirement).toHaveBeenCalledTimes(1);
  });

  it('a second press of "Turn down" inside the same moment sends one rejection', async () => {
    const answer = deferred<unknown>();
    decideMaterialRequirement.mockImplementation(() => answer.promise);
    listMaterialRequirements.mockImplementation(async () =>
      listing([
        requirement({ status: 'pending_approval', requestedBy: OTHER_USER_ID, approvedBy: null }),
      ])
    );
    const user = userEvent.setup();
    renderIn('en', { canApprove: true });
    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.decide.reject'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.material.decide.rejectHeading'] as string,
    });
    await user.type(
      within(form).getByLabelText(labelled('inventory.material.decide.reason')),
      'Too much'
    );
    const submit = within(form).getByRole('button', {
      name: EN['inventory.material.decide.reject'] as string,
    });
    act(() => {
      submit.click();
      submit.click();
    });
    await waitFor(() => expect(decideMaterialRequirement).toHaveBeenCalledTimes(1));
    await act(async () => answer.settle(success('inventory.material.decide.success')));
    expect(decideMaterialRequirement).toHaveBeenCalledTimes(1);
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`a second press of "Ask for the extra" inside the same moment asks once (${locale})`, async () => {
      const T = CATALOGUE[locale];
      const answer = deferred<unknown>();
      requestMaterialException.mockImplementation(() => answer.promise);
      const user = userEvent.setup();
      renderIn(locale, { canRequest: true });
      await user.click(
        await screen.findByRole('button', {
          name: T['inventory.material.exception.open'] as string,
        })
      );
      const form = await screen.findByRole('form', {
        name: T['inventory.material.exception.formHeading'] as string,
      });
      await user.type(
        within(form).getByLabelText(starts(T['inventory.material.exception.quantity'] as string)),
        '0.750'
      );
      await user.type(
        within(form).getByLabelText(starts(T['inventory.material.exception.reason'] as string)),
        'Overfilled'
      );
      const submit = within(form).getByRole('button', {
        name: T['inventory.material.exception.submit'] as string,
      });
      act(() => {
        submit.click();
        submit.click();
      });
      await waitFor(() => expect(requestMaterialException).toHaveBeenCalledTimes(1));
      await act(async () => answer.settle(success('inventory.material.exception.success')));
      expect(requestMaterialException).toHaveBeenCalledTimes(1);
    });
  }

  it('a second press of "Approve the extra" inside the same moment decides once', async () => {
    const answer = deferred<unknown>();
    decideMaterialException.mockImplementation(() => answer.promise);
    readMaterialRequirement.mockImplementation(async () =>
      okRead({ ...requirement(), exceptions: [exception({ requestedBy: OTHER_USER_ID })] })
    );
    const user = userEvent.setup();
    renderIn('en', { canDecideException: true });
    await user.click(
      await screen.findByRole('button', {
        name: EN['inventory.material.exception.heading'] as string,
      })
    );
    const approve = await screen.findByRole('button', {
      name: EN['inventory.material.exception.approve'] as string,
    });
    act(() => {
      approve.click();
      approve.click();
    });
    await waitFor(() => expect(decideMaterialException).toHaveBeenCalledTimes(1));
    await act(async () => answer.settle(success('inventory.material.exceptionDecision.success')));
    expect(decideMaterialException).toHaveBeenCalledTimes(1);
  });

  it('a second press of "Ask for this material" inside the same moment asks once', async () => {
    const answer = deferred<unknown>();
    createMaterialRequirement.mockImplementation(() => answer.promise);
    const user = userEvent.setup();
    renderIn('en', { canRequest: true });
    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.create.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: EN['inventory.material.create.heading'] as string,
    });
    await user.selectOptions(
      await within(form).findByLabelText(labelled('inventory.material.create.serviceLine')),
      SERVICE_LINE_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.material.create.serviceCondition')),
      'oil_change'
    );
    const submit = within(form).getByRole('button', {
      name: EN['inventory.material.create.submit'] as string,
    });
    act(() => {
      submit.click();
      submit.click();
    });
    await waitFor(() => expect(createMaterialRequirement).toHaveBeenCalledTimes(1));
    await act(async () => answer.settle(success('inventory.material.create.success')));
    expect(createMaterialRequirement).toHaveBeenCalledTimes(1);
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`marks a refused extra quantity on its own box, keeps it and puts the cursor there (${locale})`, async () => {
      const T = CATALOGUE[locale];
      const user = userEvent.setup();
      renderIn(locale, { canRequest: true });
      await user.click(
        await screen.findByRole('button', {
          name: T['inventory.material.exception.open'] as string,
        })
      );
      const form = await screen.findByRole('form', {
        name: T['inventory.material.exception.formHeading'] as string,
      });
      const box = within(form).getByLabelText(
        starts(T['inventory.material.exception.quantity'] as string)
      );
      expect(box).not.toHaveAttribute('aria-invalid');
      expect(box).toHaveAttribute('dir', 'ltr');
      await user.type(box, '0');
      await user.type(
        within(form).getByLabelText(starts(T['inventory.material.exception.reason'] as string)),
        'Overfilled'
      );
      await user.click(
        within(form).getByRole('button', {
          name: T['inventory.material.exception.submit'] as string,
        })
      );
      expect(box).toHaveAttribute('aria-invalid', 'true');
      expect(within(form).getByText(T['inventory.reserve.quantityFormat'] as string)).toBeVisible();
      expect(box).toHaveValue('0');
      await waitFor(() => expect(box).toHaveFocus());
      expect(requestMaterialException).not.toHaveBeenCalled();
    });
  }

  it('a form that opens takes the cursor: the reason box, the extra quantity, the request heading', async () => {
    listMaterialRequirements.mockImplementation(async () =>
      listing([
        requirement({ status: 'pending_approval', requestedBy: OTHER_USER_ID, approvedBy: null }),
      ])
    );
    const user = userEvent.setup();
    renderIn('en', { canApprove: true, canRequest: true });
    await user.click(
      await screen.findByRole('button', { name: EN['inventory.material.decide.reject'] as string })
    );
    const reject = await screen.findByRole('form', {
      name: EN['inventory.material.decide.rejectHeading'] as string,
    });
    await waitFor(() =>
      expect(
        within(reject).getByLabelText(labelled('inventory.material.decide.reason'))
      ).toHaveFocus()
    );
    await user.click(
      screen.getByRole('button', { name: EN['inventory.material.create.open'] as string })
    );
    const create = await screen.findByRole('form', {
      name: EN['inventory.material.create.heading'] as string,
    });
    await waitFor(() =>
      expect(
        within(create).getByRole('heading', {
          name: EN['inventory.material.create.heading'] as string,
        })
      ).toHaveFocus()
    );
  });

  it('a form closed by its own write gives the cursor back to the button that opened it', async () => {
    requestMaterialException.mockResolvedValue(success('inventory.material.exception.success'));
    const user = userEvent.setup();
    renderIn('en', { canRequest: true });
    const open = await screen.findByRole('button', {
      name: EN['inventory.material.exception.open'] as string,
    });
    await user.click(open);
    const form = await screen.findByRole('form', {
      name: EN['inventory.material.exception.formHeading'] as string,
    });
    await waitFor(() =>
      expect(
        within(form).getByLabelText(labelled('inventory.material.exception.quantity'))
      ).toHaveFocus()
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.material.exception.quantity')),
      '0.750'
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.material.exception.reason')),
      'Overfilled'
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.material.exception.submit'] as string,
      })
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('form', {
          name: EN['inventory.material.exception.formHeading'] as string,
        })
      ).toBeNull()
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: EN['inventory.material.exception.open'] as string })
      ).toHaveFocus()
    );
  });

  describe('a half-filled form and a branch switch', () => {
    afterEach(forgetRememberedBranch);

    function renderTwoBranches() {
      renderInLtr(
        withMui(
          inBranch(
            <>
              <BranchSwitch to={TEST_BRANCH.id} label="first" />
              <BranchSwitch to={OTHER_BRANCH.id} label="second" />
              <WorkingBranchProbe />
              <MaterialRequirementsPanel
                locale="en"
                messages={en}
                workOrderId={WORK_ORDER_ID}
                target={{ companyId: COMPANY_ID, branchId: BRANCH_ID }}
                currentUserId={USER_ID}
                canRequest={true}
                canApprove={false}
                canDecideException={false}
                canReadWorkOrder={true}
                canReadItems={true}
                chosenId={null}
                onChoose={vi.fn()}
                onChanged={vi.fn()}
              />
            </>,
            { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
          ),
          'en'
        )
      );
    }

    it('a typed extra asks before a switch; staying keeps it, discarding closes the form', async () => {
      const user = userEvent.setup();
      renderTwoBranches();
      await user.click(screen.getByRole('button', { name: 'first' }));
      await user.click(
        await screen.findByRole('button', {
          name: EN['inventory.material.exception.open'] as string,
        })
      );
      const form = await screen.findByRole('form', {
        name: EN['inventory.material.exception.formHeading'] as string,
      });
      const reason = within(form).getByLabelText(labelled('inventory.material.exception.reason'));
      await user.type(reason, 'Overfilled');
      await stayOnBranch(user, await switchExpectingQuestion(user, 'second'));
      expect(heldBranch()).toBe(TEST_BRANCH.id);
      expect(reason).toHaveValue('Overfilled');
      await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
      await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
      expect(
        screen.queryByRole('form', {
          name: EN['inventory.material.exception.formHeading'] as string,
        })
      ).toBeNull();
    });

    it('a half-filled request for material asks before a switch, and discarding closes it', async () => {
      const user = userEvent.setup();
      renderTwoBranches();
      await user.click(screen.getByRole('button', { name: 'first' }));
      await user.click(
        await screen.findByRole('button', { name: EN['inventory.material.create.open'] as string })
      );
      const form = await screen.findByRole('form', {
        name: EN['inventory.material.create.heading'] as string,
      });
      await user.type(
        within(form).getByLabelText(labelled('inventory.material.create.serviceCondition')),
        'oil_change'
      );
      await discardAndSwitch(user, await switchExpectingQuestion(user, 'second'));
      await waitFor(() => expect(heldBranch()).toBe(OTHER_BRANCH.id));
      expect(
        screen.queryByRole('form', { name: EN['inventory.material.create.heading'] as string })
      ).toBeNull();
    });
  });
});

/**
 * P1-32-PRE-OD-INVF, LANG-identifiers: the requirement card named its service
 * line by its raw identifier, though the form had offered that line by its
 * description. The card now says the line's description and the part's name,
 * read through the reads that already exist, and says in words when either
 * cannot be read — never the identifier.
 */
describe('P1-32-PRE-OD-INVF: a requirement is named, never identified', () => {
  function renderIn(locale: 'en' | 'ar', over: Record<string, unknown> = {}) {
    const props = {
      locale,
      messages: locale === 'en' ? en : ar,
      workOrderId: WORK_ORDER_ID,
      target: { companyId: COMPANY_ID, branchId: BRANCH_ID },
      currentUserId: USER_ID,
      canRequest: false,
      canApprove: false,
      canDecideException: false,
      canReadWorkOrder: true,
      canReadItems: true,
      chosenId: null,
      onChoose: vi.fn(),
      onChanged: vi.fn(),
      ...over,
    } as const;
    return locale === 'en'
      ? renderLtr(<MaterialRequirementsPanel {...props} />)
      : renderRtl(<MaterialRequirementsPanel {...props} />);
  }

  for (const locale of ['en', 'ar'] as const) {
    const messages = locale === 'en' ? EN : AR;

    it(`${locale}: the card says the service line and the part by name`, async () => {
      readItemDetail.mockResolvedValue(okRead({ id: ITEM_ID, name: 'Engine oil 5W-30' }));
      const { container } = renderIn(locale);
      const line = await screen.findByTestId('material-service-line');
      await waitFor(() => expect(line.textContent).toBe('Engine oil change'));
      const part = screen.getByTestId('material-item');
      await waitFor(() => expect(part.textContent).toBe('Engine oil 5W-30'));
      expect(readItemDetail).toHaveBeenCalledWith(ITEM_ID);
      expect(container.textContent).not.toContain(SERVICE_LINE_ID);
      expect(container.textContent).not.toContain(ITEM_ID);
      expect(container.textContent).not.toContain(REQUIREMENT_ID);
    });

    it(`${locale}: a name that cannot be read is said in words, not as the identifier`, async () => {
      listServiceLines.mockImplementation(async () => ({
        status: 'denied' as const,
        correlationId: 'corr',
      }));
      readItemDetail.mockResolvedValue({ status: 'denied', correlationId: 'corr' });
      const { container } = renderIn(locale);
      const line = await screen.findByTestId('material-service-line');
      await waitFor(() =>
        expect(line.textContent).toBe(messages['inventory.material.serviceLineUnavailable'])
      );
      await waitFor(() =>
        expect(screen.getByTestId('material-item').textContent).toBe(
          messages['inventory.material.itemUnavailable']
        )
      );
      expect(container.textContent).not.toContain(SERVICE_LINE_ID);
      expect(container.textContent).not.toContain(ITEM_ID);
    });
  }

  it('without the work order read, no line read is made and the card says the line is not available', async () => {
    const { container } = renderIn('en', { canReadWorkOrder: false });
    const line = await screen.findByTestId('material-service-line');
    expect(line.textContent).toBe(EN['inventory.material.serviceLineUnavailable']);
    expect(listServiceLines).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain(SERVICE_LINE_ID);
  });

  it('a service line the work order no longer lists is said to be unavailable', async () => {
    listServiceLines.mockImplementation(async () => okRead({ items: [] }));
    renderIn('en');
    const line = await screen.findByTestId('material-service-line');
    await waitFor(() =>
      expect(line.textContent).toBe(EN['inventory.material.serviceLineUnavailable'])
    );
  });

  it('choosing the requirement hands the forms its part and unit in words', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    readItemDetail.mockResolvedValue(okRead({ id: ITEM_ID, name: 'Engine oil 5W-30' }));
    renderIn('ar', { onChoose });
    await waitFor(() =>
      expect(screen.getByTestId('material-item').textContent).toBe('Engine oil 5W-30')
    );
    await user.click(screen.getByRole('button', { name: AR['inventory.material.use'] as string }));
    expect(onChoose).toHaveBeenCalledTimes(1);
    const [chosen, summary] = onChoose.mock.calls[0] as [
      { id: string },
      { what: string; itemName: string | null; unit: string | null },
    ];
    expect(chosen.id).toBe(REQUIREMENT_ID);
    expect(summary).toEqual({
      what: 'Engine oil 5W-30',
      itemName: 'Engine oil 5W-30',
      unit: 'Litre',
    });
  });
});

/**
 * P1-32-PRE-OD-INVF: a confirmed capacity the requirement form lists named its
 * make by the raw identifier. It is now named from the make catalogue the
 * vehicle specifications screen reads, when the operator holds the code that
 * reads it, and is said in words to be not available otherwise — never the
 * identifier.
 */
describe('P1-32-PRE-OD-INVF: a listed capacity names its make, never its identifier', () => {
  const MAKE_NAME = 'Make Alpha';

  function makes(options: readonly { id: string; name: string }[]) {
    return {
      status: 'ok' as const,
      options: options.map((option) => ({
        ...option,
        scope: 'platform',
        code: option.name.toUpperCase().replace(/\s+/g, '_'),
        status: 'active',
      })),
      truncated: false,
      correlationId: 'corr',
    };
  }

  async function openMatches(locale: 'en' | 'ar', over: Record<string, unknown> = {}) {
    const messages = locale === 'en' ? EN : AR;
    const user = userEvent.setup();
    const props = {
      locale,
      messages: locale === 'en' ? en : ar,
      workOrderId: WORK_ORDER_ID,
      target: { companyId: COMPANY_ID, branchId: BRANCH_ID },
      currentUserId: USER_ID,
      canRequest: true,
      canApprove: false,
      canDecideException: false,
      canReadWorkOrder: true,
      canReadItems: true,
      chosenId: null,
      onChoose: vi.fn(),
      onChanged: vi.fn(),
      ...over,
    } as const;
    const { container } =
      locale === 'en'
        ? renderLtr(<MaterialRequirementsPanel {...props} />)
        : renderRtl(<MaterialRequirementsPanel {...props} />);
    await user.click(
      screen.getByRole('button', { name: messages['inventory.material.create.open'] as string })
    );
    const form = await screen.findByRole('form', {
      name: messages['inventory.material.create.heading'] as string,
    });
    await user.type(
      within(form).getByLabelText(
        new RegExp(`^${escape(messages['inventory.material.create.serviceCondition'] as string)}`)
      ),
      'oil_change'
    );
    const make = await within(form).findByTestId('material-match-make');
    return { container, form, make, messages };
  }

  beforeEach(() => {
    listMakes.mockImplementation(async () => makes([{ id: MAKE_ID, name: MAKE_NAME }]));
  });

  for (const locale of ['en', 'ar'] as const) {
    it(`${locale}: the make is named from the make catalogue`, async () => {
      const { form, make } = await openMatches(locale, { canReadVehicleCatalogue: true });
      await waitFor(() => expect(make.textContent).toBe(MAKE_NAME));
      expect(listMakes).toHaveBeenCalledTimes(1);
      expect(form.textContent).not.toContain(MAKE_ID);
    });

    it(`${locale}: a make the catalogue cannot name is said to be not available`, async () => {
      listMakes.mockImplementation(async () => ({
        status: 'denied' as const,
        options: [],
        truncated: false,
        correlationId: 'corr',
      }));
      const { form, make, messages } = await openMatches(locale, {
        canReadVehicleCatalogue: true,
      });
      await waitFor(() =>
        expect(make.textContent).toBe(messages['inventory.material.create.matchMakeUnavailable'])
      );
      expect(form.textContent).not.toContain(MAKE_ID);
    });
  }

  it('a make missing from the catalogue answer is said to be not available', async () => {
    listMakes.mockImplementation(async () =>
      makes([{ id: '34343434-3434-4343-8343-343434343434', name: 'Make Beta' }])
    );
    const { form, make } = await openMatches('en', { canReadVehicleCatalogue: true });
    await waitFor(() =>
      expect(make.textContent).toBe(EN['inventory.material.create.matchMakeUnavailable'])
    );
    expect(form.textContent).not.toContain(MAKE_ID);
    expect(form.textContent).not.toContain('Make Beta');
  });

  it('without the vehicle read, no make read is made and the make is said to be not available', async () => {
    const { form, make } = await openMatches('en');
    expect(make.textContent).toBe(EN['inventory.material.create.matchMakeUnavailable']);
    expect(listMakes).not.toHaveBeenCalled();
    expect(form.textContent).not.toContain(MAKE_ID);
  });
});
