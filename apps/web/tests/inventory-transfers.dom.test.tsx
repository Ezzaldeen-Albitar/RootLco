import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '../src/i18n/messages/ar.json';
import en from '../src/i18n/messages/en.json';
import type { ReactElement } from 'react';
import { inBranch, renderLtr as renderInLtr, renderRtl as renderInRtl } from './render';

/*
 * Every screen in this file is addressed by the WORKING CONTEXT: the branch it
 * reads is the header's own named selection, not a pair typed into the screen
 * (Owner directive, `P1-32-PRE-OD-UX`). So each render goes inside a provider.
 *
 * The two names are shadowed rather than changed at every call site, which
 * keeps the default snapshot — one authorized branch, selected for the operator
 * — true for every case below. A case that needs a different snapshot builds
 * one and renders it explicitly.
 */
const renderLtr = (ui: ReactElement, options?: Parameters<typeof renderInLtr>[1]) =>
  renderInLtr(inBranch(ui), options);
const renderRtl = (ui: ReactElement, options?: Parameters<typeof renderInRtl>[1]) =>
  renderInRtl(inBranch(ui, { locale: 'ar' }), options);
import {
  BRANCH_ID,
  COMPANY_ID,
  EN,
  ITEM_ID,
  LOCATION_ID,
  OTHER_LOCATION_ID,
  OTHER_USER_ID,
  USER_ID,
  branch,
  chooseBranch,
  chooseItem,
  item,
  itemPage,
  labelled,
  okPage,
  refusedWith,
  seriousViolations,
  shelf,
  succeeded,
  warehouse,
} from './support/stock-operations';
import { TRANSFER_REFUSAL_RULES } from '@/features/inventory/inventory-contract';

/**
 * Stock transfers, rendered (P1-32).
 *
 * The properties under test: the list is addressed to the chosen branch and read
 * again for the other direction; the figures are the server's strings, with what
 * is still on its way shown as the server states it; a PARTIAL receipt sends only
 * what arrived and the screen then says what is still on its way, taken from the
 * answer; a write-off request says it waits for a second person; the branch's
 * pending write-offs are listed and decided with a reason by someone other than
 * the requester, who is told why they cannot decide their own; a refusal is said
 * in words; nothing that writes is offered without `inv.stock.operate`, and no
 * decision without `inv.adjustment.approve`; and the route page decides before it
 * reads.
 */

const AR = ar as Record<string, string>;

const listTransfers = vi.fn();
const createTransfer = vi.fn();
const receiveTransfer = vi.fn();
const cancelTransfer = vi.fn();
const resolveTransferDiscrepancy = vi.fn();
const listTransferWriteOffs = vi.fn();
const decideTransferWriteOff = vi.fn();
const listItems = vi.fn();
const listLocations = vi.fn();
const listBranches = vi.fn();
vi.mock('@/features/inventory/api', () => ({
  listTransfers: (...args: unknown[]) => listTransfers(...args),
  createTransfer: (...args: unknown[]) => createTransfer(...args),
  receiveTransfer: (...args: unknown[]) => receiveTransfer(...args),
  cancelTransfer: (...args: unknown[]) => cancelTransfer(...args),
  resolveTransferDiscrepancy: (...args: unknown[]) => resolveTransferDiscrepancy(...args),
  listTransferWriteOffs: (...args: unknown[]) => listTransferWriteOffs(...args),
  decideTransferWriteOff: (...args: unknown[]) => decideTransferWriteOff(...args),
  listItems: (...args: unknown[]) => listItems(...args),
  listLocations: (...args: unknown[]) => listLocations(...args),
  listBranches: (...args: unknown[]) => listBranches(...args),
  // `./shared` names this export; this screen never calls it.
  listItemCategories: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    userId: USER_ID,
    permissions: PERMISSIONS,
    email: 'operator@test.local',
  }),
}));

const notifyActionResult = vi.fn<(...args: unknown[]) => boolean>(() => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { TransfersScreen } = await import('@/features/inventory/components/TransfersScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const TransfersPage = (await import('@/app/[locale]/(dashboard)/inventory/transfers/page'))
  .default as unknown as RoutePage;

const TRANSFER_ID = '55555555-5555-4555-8555-555555555555';

function transfer(over: Record<string, unknown> = {}) {
  return {
    id: TRANSFER_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    itemId: ITEM_ID,
    fromLocationId: LOCATION_ID,
    transitLocationId: 'transit',
    toBranchId: BRANCH_ID,
    toLocationId: OTHER_LOCATION_ID,
    quantity: '2.500',
    receivedQuantity: null,
    resolvedQuantity: '0.000',
    outstandingQuantity: '2.500',
    status: 'dispatched',
    inTransit: true,
    reason: null,
    cancelReason: null,
    dispatchedAt: '2026-09-17T08:00:00Z',
    receivedAt: null,
    cancelledAt: null,
    recordVersion: 1,
    sku: 'BRK-001',
    fromLocationCode: 'WH-1',
    toLocationCode: 'SH-2',
    createdAt: '2026-09-17T08:00:00Z',
    ...over,
  };
}

const TARGET_FORM = 'inventory.transfers.targetLabel';
const listRegion = () =>
  screen.getByRole('region', { name: EN['inventory.transfers.list.heading'] as string });

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <TransfersScreen
      locale="en"
      messages={en}
      currentUserId={USER_ID}
      canOperate={true}
      canApprove={true}
      canReadBranches={true}
      {...over}
    />
  );
}

async function openAction(user: ReturnType<typeof userEvent.setup>, actionKey: string) {
  const table = await within(listRegion()).findByRole('table');
  await user.click(
    within(table).getByRole('button', { name: `${EN[actionKey] as string} BRK-001` })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  listTransfers.mockResolvedValue(okPage([transfer()]));
  listTransferWriteOffs.mockResolvedValue(okPage([]));
  listLocations.mockResolvedValue(okPage([warehouse, shelf]));
  listBranches.mockResolvedValue({ status: 'ok', data: { items: [branch] }, correlationId: 'c' });
  listItems.mockResolvedValue(itemPage([item]));
});

describe('the transfers of a branch', () => {
  it('reads the working branch on arrival, and lists what it sent', async () => {
    /*
     * This used to assert that nothing was read until a branch was named in a
     * form on this screen. The branch is the header's own named selection now,
     * so opening the screen IS naming it — and no directory read is issued,
     * because the shell already holds the names.
     */
    renderScreen();
    await chooseBranch(TARGET_FORM);
    expect(listBranches).not.toHaveBeenCalled();
    await waitFor(() => expect(listTransfers).toHaveBeenCalled());
    expect(listTransfers.mock.calls[0]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
    const table = await within(listRegion()).findByRole('table');
    expect(within(table).getAllByText('2.500')).toHaveLength(2);
    expect(
      within(table).getByText(EN['inventory.transferStatus.dispatched'] as string)
    ).toBeVisible();
    expect(
      within(table).getByText(EN['inventory.transfers.nothingReceived'] as string)
    ).toBeVisible();
  });

  it('reads the list again for the transfers coming to the branch', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(TARGET_FORM);
    await within(listRegion()).findByRole('table');
    await user.click(
      within(listRegion()).getByLabelText(EN['inventory.transfers.direction.inbound'] as string)
    );
    await waitFor(() => expect(listTransfers).toHaveBeenCalledTimes(2));
    expect(listTransfers.mock.calls[0]?.[1]).toBe('outbound');
    expect(listTransfers.mock.calls[1]?.[1]).toBe('inbound');
    expect(listTransfers.mock.calls[1]?.[0]).toEqual({
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
    });
  });

  it('a refused list is a refusal, never an empty branch', async () => {
    listTransfers.mockResolvedValue({ status: 'denied', correlationId: 'c' });
    renderScreen();
    await chooseBranch(TARGET_FORM);
    expect(
      await within(listRegion()).findByText(EN['inventory.transfers.list.refused'] as string)
    ).toBeVisible();
    expect(
      within(listRegion()).queryByText(EN['inventory.transfers.list.none'] as string)
    ).toBeNull();
  });
});

describe('receiving what arrived', () => {
  it('a partial receipt sends only what arrived and keeps the remainder on its way', async () => {
    const user = userEvent.setup();
    receiveTransfer.mockResolvedValue(
      succeeded(
        'inventory.transfers.receive.success',
        transfer({
          status: 'partially_received',
          receivedQuantity: '1.000',
          outstandingQuantity: '1.500',
          replayed: false,
        })
      )
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    await openAction(user, 'inventory.transfers.receive.action');
    const form = screen.getByRole('form', { name: /Receive the transfer of/ });
    await user.type(
      within(form).getByLabelText(labelled('inventory.transfers.receive.quantity')),
      '1.000'
    );
    listTransfers.mockResolvedValue(
      okPage([
        transfer({
          status: 'partially_received',
          receivedQuantity: '1.000',
          outstandingQuantity: '1.500',
        }),
      ])
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.transfers.receive.submit'] as string })
    );
    await waitFor(() => expect(receiveTransfer).toHaveBeenCalledTimes(1));
    expect(receiveTransfer).toHaveBeenCalledWith(TRANSFER_ID, { quantity: '1.000' });
    expect(
      await screen.findByText(EN['inventory.transfers.receive.partial'] as string, { exact: false })
    ).toBeVisible();
    expect(screen.getByText(EN['inventory.transfers.receive.partialNext'] as string)).toBeVisible();
    // The list is read again and states the remainder the server now holds.
    await waitFor(() => expect(listTransfers).toHaveBeenCalledTimes(2));
    const table = await within(listRegion()).findByRole('table');
    expect(
      await within(table).findByText(EN['inventory.transferStatus.partially_received'] as string)
    ).toBeVisible();
    expect(within(table).getByText('1.500')).toBeVisible();
  });

  it('refuses a malformed or zero quantity before sending', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(TARGET_FORM);
    await openAction(user, 'inventory.transfers.receive.action');
    const form = screen.getByRole('form', { name: /Receive the transfer of/ });
    await user.type(
      within(form).getByLabelText(labelled('inventory.transfers.receive.quantity')),
      '0'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.transfers.receive.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['inventory.stockOps.quantityFormat'] as string)
    ).toBeVisible();
    expect(receiveTransfer).not.toHaveBeenCalled();
  });

  it('a refused receipt is said in words, with its reference', async () => {
    const user = userEvent.setup();
    receiveTransfer.mockResolvedValue(refusedWith('inventory.transfers.receive.refused'));
    renderScreen();
    await chooseBranch(TARGET_FORM);
    await openAction(user, 'inventory.transfers.receive.action');
    const form = screen.getByRole('form', { name: /Receive the transfer of/ });
    await user.type(
      within(form).getByLabelText(labelled('inventory.transfers.receive.quantity')),
      '9'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.transfers.receive.submit'] as string })
    );
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(EN['inventory.transfers.receive.refused'] as string);
    expect(alert).toHaveTextContent('corr-refused');
  });

  // CC-OD-32. Every transfer state refusal used to arrive as one sentence -
  // "this cannot be done in its current state" - whether the delivery had
  // already arrived, was cancelled, or the quantity was simply too large. Each
  // now names its own rule, and this walks the mirror so a token added without
  // a sentence fails here rather than rendering the vague one again.
  for (const rule of TRANSFER_REFUSAL_RULES) {
    it(`says in words what ${rule} means, and keeps the typed quantity`, async () => {
      const user = userEvent.setup();
      receiveTransfer.mockResolvedValue(refusedWith(`form.violation.${rule}`));
      renderScreen();
      await chooseBranch(TARGET_FORM);
      await openAction(user, 'inventory.transfers.receive.action');
      const form = screen.getByRole('form', { name: /Receive the transfer of/ });
      const quantity = within(form).getByLabelText(
        labelled('inventory.transfers.receive.quantity')
      );
      await user.type(quantity, '9');
      await user.click(
        within(form).getByRole('button', {
          name: EN['inventory.transfers.receive.submit'] as string,
        })
      );
      const alert = await within(form).findByRole('alert');
      expect(alert).toHaveTextContent(EN[`form.violation.${rule}`] as string);
      expect(alert).not.toHaveTextContent(EN['form.violation.invalid'] as string);
      expect(alert).toHaveTextContent('corr-refused');
      // Entered data is preserved: the operator corrects it rather than retypes it.
      expect(quantity).toHaveValue('9');
    });
  }
});

describe('settling what did not arrive', () => {
  it('a write-off request says it waits for a second person and is not decided here', async () => {
    const user = userEvent.setup();
    listTransfers.mockResolvedValue(
      okPage([
        transfer({
          status: 'partially_received',
          receivedQuantity: '1.500',
          outstandingQuantity: '1.000',
        }),
      ])
    );
    resolveTransferDiscrepancy.mockResolvedValue(
      succeeded('inventory.transfers.resolve.writeOffRequested', {
        id: 'settlement-1',
        transferId: TRANSFER_ID,
        kind: 'write_off',
        quantity: '1.000',
        reason: 'Lost on the way',
        status: 'pending',
        requestedBy: 'user-1',
        createdAt: '2026-09-17T09:00:00Z',
        recordVersion: 1,
        transfer: transfer(),
        replayed: false,
      })
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    await openAction(user, 'inventory.transfers.resolve.action');
    const form = screen.getByRole('form', { name: /Settle missing units of/ });
    await user.click(
      within(form).getByLabelText(EN['inventory.transfers.resolve.kind.write_off'] as string)
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.transfers.resolve.quantity')),
      '1.000'
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.stockOps.reason')),
      'Lost on the way'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.transfers.resolve.submit'] as string })
    );
    await waitFor(() => expect(resolveTransferDiscrepancy).toHaveBeenCalledTimes(1));
    const [id, body, key] = resolveTransferDiscrepancy.mock.calls[0] as [string, unknown, string];
    expect(id).toBe(TRANSFER_ID);
    expect(body).toEqual({ kind: 'write_off', quantity: '1.000', reason: 'Lost on the way' });
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
    expect(
      await screen.findByText(EN['inventory.transfers.resolve.writeOffPending'] as string, {
        exact: false,
      })
    ).toBeVisible();
    expect(
      screen.getByText(EN['inventory.transfers.resolve.writeOffNoDecision'] as string)
    ).toBeVisible();
  });

  it('a return to origin is sent as one and says the units went back at once', async () => {
    const user = userEvent.setup();
    listTransfers.mockResolvedValue(
      okPage([
        transfer({
          status: 'partially_received',
          receivedQuantity: '1.500',
          outstandingQuantity: '1.000',
        }),
      ])
    );
    resolveTransferDiscrepancy.mockResolvedValue(
      succeeded('inventory.transfers.resolve.returned', {
        id: 'settlement-2',
        transferId: TRANSFER_ID,
        kind: 'return_to_origin',
        quantity: '1.000',
        reason: 'Sent back',
        status: 'posted',
        requestedBy: 'user-1',
        createdAt: '2026-09-17T09:00:00Z',
        recordVersion: 1,
        transfer: transfer({ status: 'received', outstandingQuantity: '0.000' }),
        replayed: false,
      })
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    await openAction(user, 'inventory.transfers.resolve.action');
    const form = screen.getByRole('form', { name: /Settle missing units of/ });
    // Return to origin is the preselected choice.
    expect(
      within(form).getByLabelText(EN['inventory.transfers.resolve.kind.return_to_origin'] as string)
    ).toBeChecked();
    await user.type(
      within(form).getByLabelText(labelled('inventory.transfers.resolve.quantity')),
      '1.000'
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.stockOps.reason')),
      'Sent back'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.transfers.resolve.submit'] as string })
    );
    await waitFor(() => expect(resolveTransferDiscrepancy).toHaveBeenCalledTimes(1));
    expect(resolveTransferDiscrepancy.mock.calls[0]?.[1]).toEqual({
      kind: 'return_to_origin',
      quantity: '1.000',
      reason: 'Sent back',
    });
    expect(
      await screen.findByText(EN['inventory.transfers.resolve.returnedDone'] as string, {
        exact: false,
      })
    ).toBeVisible();
    expect(
      screen.queryByText(EN['inventory.transfers.resolve.writeOffNoDecision'] as string)
    ).toBeNull();
  });

  it('a refused settlement is said in words, with its reference', async () => {
    const user = userEvent.setup();
    listTransfers.mockResolvedValue(
      okPage([transfer({ status: 'partially_received', receivedQuantity: '1.500' })])
    );
    resolveTransferDiscrepancy.mockResolvedValue(
      refusedWith('inventory.transfers.resolve.refused')
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    await openAction(user, 'inventory.transfers.resolve.action');
    const form = screen.getByRole('form', { name: /Settle missing units of/ });
    await user.type(
      within(form).getByLabelText(labelled('inventory.transfers.resolve.quantity')),
      '9.000'
    );
    await user.type(within(form).getByLabelText(labelled('inventory.stockOps.reason')), 'Too many');
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.transfers.resolve.submit'] as string })
    );
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(EN['inventory.transfers.resolve.refused'] as string);
    expect(alert).toHaveTextContent('corr-refused');
    expect(
      screen.queryByText(EN['inventory.transfers.resolve.returnedDone'] as string, { exact: false })
    ).toBeNull();
  });

  it('cancel is offered only while nothing has been received', async () => {
    listTransfers.mockResolvedValue(
      okPage([transfer({ status: 'partially_received', receivedQuantity: '1.000' })])
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const table = await within(listRegion()).findByRole('table');
    expect(
      within(table).getByRole('button', {
        name: `${EN['inventory.transfers.receive.action'] as string} BRK-001`,
      })
    ).toBeVisible();
    expect(
      within(table).queryByRole('button', {
        name: `${EN['inventory.transfers.cancel.action'] as string} BRK-001`,
      })
    ).toBeNull();
  });
});

const SETTLEMENT_ID = '66666666-6666-4666-8666-666666666666';

function writeOff(over: Record<string, unknown> = {}) {
  return {
    id: SETTLEMENT_ID,
    transferId: TRANSFER_ID,
    companyId: COMPANY_ID,
    branchId: BRANCH_ID,
    toBranchId: BRANCH_ID,
    itemId: ITEM_ID,
    sku: 'BRK-001',
    kind: 'write_off',
    quantity: '1.000',
    reason: 'Lost on the way',
    status: 'pending',
    requestedBy: OTHER_USER_ID,
    decision: 'pending',
    decidedBy: null,
    decidedAt: null,
    recordVersion: 1,
    createdAt: '2026-09-17T09:00:00Z',
    ...over,
  };
}

const writeOffRegion = () =>
  screen.getByRole('region', { name: EN['inventory.transfers.writeOffs.heading'] as string });
const DECIDE_BUTTON = `${EN['inventory.transfers.writeOffs.decide.action'] as string} BRK-001`;

describe('deciding a write-off that waits for a second person', () => {
  it("lists the branch's pending write-offs, and a different person decides one with a reason", async () => {
    const user = userEvent.setup();
    listTransferWriteOffs.mockResolvedValue(okPage([writeOff()]));
    decideTransferWriteOff.mockResolvedValue(
      succeeded('inventory.transfers.writeOffs.decide.approved', {
        ...writeOff({ status: 'posted' }),
        transfer: transfer({ status: 'settled', outstandingQuantity: '0.000' }),
        replayed: false,
      })
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    await waitFor(() => expect(listTransferWriteOffs).toHaveBeenCalledTimes(1));
    expect(listTransferWriteOffs.mock.calls[0]).toEqual([
      { companyId: COMPANY_ID, branchId: BRANCH_ID },
      'pending',
    ]);
    const table = await within(writeOffRegion()).findByRole('table');
    expect(within(table).getByText('Lost on the way')).toBeVisible();
    expect(within(table).getByText('1.000')).toBeVisible();

    await user.click(within(table).getByRole('button', { name: DECIDE_BUTTON }));
    const form = screen.getByRole('form', { name: /Decide the write-off of/ });
    // No reason, nothing sent.
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.transfers.writeOffs.decide.approve'] as string,
      })
    );
    expect(decideTransferWriteOff).not.toHaveBeenCalled();
    await user.type(
      within(form).getByLabelText(labelled('inventory.transfers.writeOffs.decide.reason')),
      'Carrier confirmed the loss'
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.transfers.writeOffs.decide.approve'] as string,
      })
    );
    await waitFor(() => expect(decideTransferWriteOff).toHaveBeenCalledTimes(1));
    expect(decideTransferWriteOff.mock.calls[0]).toEqual([
      SETTLEMENT_ID,
      { decision: 'approved', reason: 'Carrier confirmed the loss' },
    ]);
    expect(
      await screen.findByText(EN['inventory.transfers.writeOffs.decide.approvedDone'] as string, {
        exact: false,
      })
    ).toBeVisible();
    // Both lists are read again: the write-off and the transfer it settled moved.
    await waitFor(() => expect(listTransferWriteOffs).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(listTransfers).toHaveBeenCalledTimes(2));
  });

  it('a rejection keeps the units on their way and says so', async () => {
    const user = userEvent.setup();
    listTransferWriteOffs.mockResolvedValue(okPage([writeOff()]));
    decideTransferWriteOff.mockResolvedValue(
      succeeded('inventory.transfers.writeOffs.decide.rejected', {
        ...writeOff({ status: 'rejected' }),
        transfer: transfer(),
        replayed: false,
      })
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const table = await within(writeOffRegion()).findByRole('table');
    await user.click(within(table).getByRole('button', { name: DECIDE_BUTTON }));
    const form = screen.getByRole('form', { name: /Decide the write-off of/ });
    await user.type(
      within(form).getByLabelText(labelled('inventory.transfers.writeOffs.decide.reason')),
      'Found at the dock'
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.transfers.writeOffs.decide.reject'] as string,
      })
    );
    await waitFor(() => expect(decideTransferWriteOff).toHaveBeenCalledTimes(1));
    expect(decideTransferWriteOff.mock.calls[0]?.[1]).toEqual({
      decision: 'rejected',
      reason: 'Found at the dock',
    });
    expect(
      await screen.findByText(EN['inventory.transfers.writeOffs.decide.rejectedDone'] as string, {
        exact: false,
      })
    ).toBeVisible();
    expect(
      screen.getByText(EN['inventory.transfers.writeOffs.decide.rejectedNext'] as string)
    ).toBeVisible();
  });

  it('the requester is not offered the decision and is told another person must decide it', async () => {
    listTransferWriteOffs.mockResolvedValue(okPage([writeOff({ requestedBy: USER_ID })]));
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const table = await within(writeOffRegion()).findByRole('table');
    expect(
      within(table).getByText(EN['inventory.transfers.writeOffs.ownRequest'] as string)
    ).toBeVisible();
    expect(
      within(table).getByText(EN['inventory.transfers.writeOffs.byYou'] as string)
    ).toBeVisible();
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
  });

  it('without the approval permission no decision is offered, and the row says why', async () => {
    listTransferWriteOffs.mockResolvedValue(okPage([writeOff()]));
    renderScreen({ canApprove: false });
    await chooseBranch(TARGET_FORM);
    const table = await within(writeOffRegion()).findByRole('table');
    expect(
      within(table).getByText(EN['inventory.transfers.writeOffs.needsApprove'] as string)
    ).toBeVisible();
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
  });

  it('a refused decision is said in words, with its reference', async () => {
    const user = userEvent.setup();
    listTransferWriteOffs.mockResolvedValue(okPage([writeOff()]));
    decideTransferWriteOff.mockResolvedValue(
      refusedWith('inventory.transfers.writeOffs.decide.refused')
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const table = await within(writeOffRegion()).findByRole('table');
    await user.click(within(table).getByRole('button', { name: DECIDE_BUTTON }));
    const form = screen.getByRole('form', { name: /Decide the write-off of/ });
    await user.type(
      within(form).getByLabelText(labelled('inventory.transfers.writeOffs.decide.reason')),
      'Checked'
    );
    await user.click(
      within(form).getByRole('button', {
        name: EN['inventory.transfers.writeOffs.decide.approve'] as string,
      })
    );
    const alert = await within(form).findByRole('alert');
    expect(alert).toHaveTextContent(EN['inventory.transfers.writeOffs.decide.refused'] as string);
    expect(alert).toHaveTextContent('corr-refused');
  });

  it('a refused write-off list is a refusal, never an empty list', async () => {
    listTransferWriteOffs.mockResolvedValue({ status: 'denied', correlationId: 'c' });
    renderScreen();
    await chooseBranch(TARGET_FORM);
    expect(
      await within(writeOffRegion()).findByText(
        EN['inventory.transfers.writeOffs.refused'] as string
      )
    ).toBeVisible();
    expect(
      within(writeOffRegion()).queryByText(EN['inventory.transfers.writeOffs.none'] as string)
    ).toBeNull();
  });
});

describe('sending a transfer', () => {
  it('sends the chosen item, both locations, the typed quantity and one key per form', async () => {
    const user = userEvent.setup();
    createTransfer.mockResolvedValue(
      succeeded('inventory.transfers.create.success', { ...transfer(), replayed: false })
    );
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const form = screen.getByRole('form', {
      name: EN['inventory.transfers.create.heading'] as string,
    });
    await chooseItem(user, form);
    await within(form).findAllByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.transfers.create.from')),
      LOCATION_ID
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.transfers.create.to')),
      OTHER_LOCATION_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.transfers.create.quantity')),
      '2.500'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.transfers.create.submit'] as string })
    );
    await waitFor(() => expect(createTransfer).toHaveBeenCalledTimes(1));
    const body = createTransfer.mock.calls[0]?.[0] as Record<string, string>;
    expect(body).toMatchObject({
      itemId: ITEM_ID,
      fromLocationId: LOCATION_ID,
      toLocationId: OTHER_LOCATION_ID,
      quantity: '2.500',
    });
    expect(typeof body['idempotencyKey']).toBe('string');
    expect(
      await screen.findByText(EN['inventory.transfers.create.done'] as string, { exact: false })
    ).toBeVisible();
  });

  it('refuses the same location at both ends before sending', async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseBranch(TARGET_FORM);
    const form = screen.getByRole('form', {
      name: EN['inventory.transfers.create.heading'] as string,
    });
    await chooseItem(user, form);
    await within(form).findAllByRole('option', { name: 'WH-1 — Main warehouse' });
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.transfers.create.from')),
      LOCATION_ID
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('inventory.transfers.create.to')),
      LOCATION_ID
    );
    await user.type(
      within(form).getByLabelText(labelled('inventory.transfers.create.quantity')),
      '1'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['inventory.transfers.create.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['inventory.transfers.create.sameLocation'] as string)
    ).toBeVisible();
    expect(createTransfer).not.toHaveBeenCalled();
  });
});

describe('permission decides what is offered', () => {
  it('without the operate permission there is no action and no form, and the screen says why', async () => {
    renderScreen({ canOperate: false });
    expect(screen.getByText(EN['inventory.transfers.needsOperate'] as string)).toBeVisible();
    await chooseBranch(TARGET_FORM);
    const table = await within(listRegion()).findByRole('table');
    expect(within(table).queryAllByRole('button')).toHaveLength(0);
    expect(
      screen.queryByRole('form', { name: EN['inventory.transfers.create.heading'] as string })
    ).toBeNull();
  });
});

describe('the /inventory/transfers route page decides before it reads', () => {
  async function renderPage(locale = 'en') {
    const tree = await TransfersPage({ params: Promise.resolve({ locale }) });
    return renderLtr(tree as React.ReactElement);
  }

  it('refuses without inv.stock.read and issues no read', async () => {
    PERMISSIONS = ['inv.item.read', 'inv.stock.operate'];
    await renderPage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(listBranches).not.toHaveBeenCalled();
    expect(listTransfers).not.toHaveBeenCalled();
  });

  it('binds the operate capability to inv.stock.operate, and reads no directory either way', async () => {
    /*
     * The second half of this case used to bind the branch LIST to
     * `org.branch.read`. That binding is gone: the working context publishes
     * the named branches this caller may act in, is gated on `iam.user.read`,
     * and is read once by the shell — so no screen issues `org.branch-list` for
     * a picker any more, with the code or without it.
     */
    PERMISSIONS = ['inv.stock.read'];
    const { unmount } = await renderPage();
    expect(screen.getByText(EN['inventory.transfers.needsOperate'] as string)).toBeVisible();
    expect(
      screen.queryByRole('form', { name: EN['inventory.transfers.create.heading'] as string })
    ).toBeNull();
    expect(listBranches).not.toHaveBeenCalled();
    unmount();

    PERMISSIONS = ['inv.stock.read', 'inv.stock.operate', 'org.branch.read'];
    await renderPage();
    expect(screen.queryByText(EN['inventory.transfers.needsOperate'] as string)).toBeNull();
    await waitFor(() => expect(listTransfers).toHaveBeenCalled());
    expect(listBranches).not.toHaveBeenCalled();
  });

  it('binds the decision to inv.adjustment.approve and the requester to the signed-in person', async () => {
    listTransferWriteOffs.mockResolvedValue(
      okPage([writeOff(), writeOff({ id: 'own', sku: 'OWN-001', requestedBy: USER_ID })])
    );
    PERMISSIONS = ['inv.stock.read', 'org.branch.read'];
    const { unmount } = await renderPage();
    await chooseBranch(TARGET_FORM);
    let table = await within(writeOffRegion()).findByRole('table');
    expect(
      within(table).getAllByText(EN['inventory.transfers.writeOffs.needsApprove'] as string)
    ).toHaveLength(2);
    unmount();

    PERMISSIONS = ['inv.stock.read', 'inv.adjustment.approve', 'org.branch.read'];
    await renderPage();
    await chooseBranch(TARGET_FORM);
    table = await within(writeOffRegion()).findByRole('table');
    expect(within(table).getByRole('button', { name: DECIDE_BUTTON })).toBeVisible();
    expect(
      within(table).getByText(EN['inventory.transfers.writeOffs.ownRequest'] as string)
    ).toBeVisible();
  });

  it('a locale it does not serve is not found', async () => {
    PERMISSIONS = ['inv.stock.read'];
    await expect(renderPage('xx')).rejects.toThrow('notFound');
  });
});

describe('accessibility and Arabic', () => {
  it('the listed branch has no serious or critical accessibility finding', async () => {
    const { container } = renderScreen();
    await chooseBranch(TARGET_FORM);
    await within(listRegion()).findByRole('table');
    expect(await seriousViolations(container)).toEqual([]);
  });

  it('renders in Arabic, right to left, and reads its branch there too', async () => {
    renderRtl(
      <TransfersScreen
        locale="ar"
        messages={ar}
        currentUserId={USER_ID}
        canOperate={true}
        canApprove={true}
      />
    );
    expect(screen.getByText(AR['inventory.transfers.explain'] as string)).toBeVisible();
    expect(
      screen.getByRole('region', { name: AR['inventory.transfers.targetLabel'] as string })
    ).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
    // Addressed on arrival in Arabic exactly as in English.
    await waitFor(() => expect(listTransfers).toHaveBeenCalled());
  });
});
