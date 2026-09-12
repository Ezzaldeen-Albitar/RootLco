import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * The printable handover sheet, rendered (P1-31, FE-007).
 *
 * The properties under test, each one a way this sheet could lie:
 *
 *   - a caller the route refuses never reaches the control at all, and nothing
 *     the sheet needs is read;
 *   - the sheet is composed from the reads that ACTUALLY answered — the frame
 *     the print stylesheet finds, the checklist rows, the signature rows — and
 *     it is composed only when it is asked for;
 *   - the financial half is left off for a caller without the financial read
 *     code, and the sheet SAYS it was left off rather than printing a shorter
 *     document that looks complete;
 *   - the disclaimer the Owner's D-7 answer requires is on the sheet in both
 *     languages, so nobody can read the printout as an archived copy;
 *   - the print control appears only once the reads have landed;
 *   - and nothing is written. Every write adapter of this feature is asserted
 *     untouched, because "a print view that quietly records something" is the
 *     defect D-7 forbids and no other case here would notice it.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const readDelivery = vi.fn();
const readEligibility = vi.fn();
const readReceiver = vi.fn();
const listSignatures = vi.fn();
const listChecklistResults = vi.fn();
const listStatusHistory = vi.fn();
const readWorkOrderDelivery = vi.fn();
const readActiveChecklistItems = vi.fn();
const verifyReceiver = vi.fn();
const recordChecklistResult = vi.fn();
const completeDelivery = vi.fn();
const attachSignature = vi.fn();
vi.mock('@/features/delivery/api', () => ({
  readDelivery: (...args: unknown[]) => readDelivery(...args),
  readEligibility: (...args: unknown[]) => readEligibility(...args),
  readReceiver: (...args: unknown[]) => readReceiver(...args),
  listSignatures: (...args: unknown[]) => listSignatures(...args),
  listChecklistResults: (...args: unknown[]) => listChecklistResults(...args),
  listStatusHistory: (...args: unknown[]) => listStatusHistory(...args),
  readWorkOrderDelivery: (...args: unknown[]) => readWorkOrderDelivery(...args),
  readActiveChecklistItems: (...args: unknown[]) => readActiveChecklistItems(...args),
  verifyReceiver: (...args: unknown[]) => verifyReceiver(...args),
  recordChecklistResult: (...args: unknown[]) => recordChecklistResult(...args),
  completeDelivery: (...args: unknown[]) => completeDelivery(...args),
  attachSignature: (...args: unknown[]) => attachSignature(...args),
}));

const readWorkOrderDetail = vi.fn();
const transitionWorkOrder = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
  transitionWorkOrder: (...args: unknown[]) => transitionWorkOrder(...args),
}));

const captureDeliverySignature = vi.fn();
vi.mock('@/features/delivery/signature-capture', () => ({
  captureDeliverySignature: (...args: unknown[]) => captureDeliverySignature(...args),
}));

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
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

const { DeliveryDetailScreen } =
  await import('@/features/delivery/components/DeliveryDetailScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const DeliveryPage = (await import('@/app/[locale]/(dashboard)/delivery/[deliveryId]/page'))
  .default as unknown as RoutePage;

const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const WORK_ORDER_ID = '44444444-4444-4444-8444-444444444444';
const VEHICLE_ID = '55555555-5555-4555-8555-555555555555';
const VISIT_ID = '66666666-6666-4666-8666-666666666666';
const EMPLOYEE_ID = '77777777-7777-4777-8777-777777777777';
const PARTNER_ID = '88888888-8888-4888-8888-888888888888';

const VIEW = 'sal.delivery.view';
const FINANCE = 'sal.finance.view';
const WORK_ORDER_READ = 'wo.work_order.read';

const delivery = {
  id: DELIVERY_ID,
  companyId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
  workOrderId: WORK_ORDER_ID,
  receptionVisitId: VISIT_ID,
  vehicleId: VEHICLE_ID,
  deliveringEmployeeId: EMPLOYEE_ID,
  status: 'delivered',
  deliveredAt: '2026-09-10T11:00:00.000Z',
  finalOdometerReadingId: '99999999-9999-4999-8999-999999999999',
  recordVersion: 7,
};

const eligibility = {
  deliveryId: DELIVERY_ID,
  workOrderId: WORK_ORDER_ID,
  status: 'delivered',
  eligible: false,
  blockers: ['financial_balance_outstanding', 'quality_control_not_passed'],
  overridden: [],
  facts: [
    { blocker: 'financial_balance_outstanding', established: true, source: 'billing' },
    { blocker: 'quality_control_not_passed', established: false, source: 'quality gate' },
  ],
  checklistGaps: [],
  overridable: [{ code: 'financial_balance_outstanding', permission: 'sal.delivery.complete' }],
  recordVersion: 7,
};

const receiver = {
  id: 'receiver-1',
  deliveryRecordId: DELIVERY_ID,
  receiverPartnerId: PARTNER_ID,
  identityEvidenceDocumentVersionId: 'evidence-1',
  verifiedBy: EMPLOYEE_ID,
  verifiedAt: '2026-09-09T09:00:00.000Z',
  recordVersion: 1,
};

const checklistResult = {
  id: 'result-1',
  deliveryRecordId: DELIVERY_ID,
  templateItemId: 'item-1',
  itemCode: 'FUEL',
  label: 'Fuel level agreed',
  outcome: 'waived',
  waiverReason: 'Agreed with the customer at collection',
  recordedBy: EMPLOYEE_ID,
  recordVersion: 1,
};

const signature = {
  id: 'signature-1',
  deliveryRecordId: DELIVERY_ID,
  signerRole: 'receiver',
  signatureDocumentVersionId: 'signature-document-1',
  signedAt: '2026-09-10T10:30:00.000Z',
};

const transition = {
  id: 'transition-1',
  fromStatus: 'signed',
  toStatus: 'delivered',
  reason: null,
  actorId: EMPLOYEE_ID,
  occurredAt: '2026-09-10T11:00:00.000Z',
};

const workOrderDetail = {
  workOrder: {
    id: WORK_ORDER_ID,
    companyId: delivery.companyId,
    branchId: delivery.branchId,
    receptionVisitId: VISIT_ID,
    vehicleId: VEHICLE_ID,
    kind: 'repair',
    state: 'handed_over',
    partsForwardState: 'none',
    displayNumber: 'WO-000119',
    openedAt: '2026-09-01T07:00:00.000Z',
    recordVersion: 3,
    customer: {
      partnerId: PARTNER_ID,
      displayName: 'Layla Haddad',
      relationshipRole: 'service_requester',
      hasAdditionalParties: false,
    },
    vehicle: { vehicleId: VEHICLE_ID, registrationPlate: 'ABC-1234', makeModel: 'Saloon' },
  },
  jobs: [],
  nextStates: [],
};

const page = (items: readonly unknown[], over: Record<string, unknown> = {}) => ({
  items,
  nextCursor: null,
  hasMore: false,
  ...over,
});

const okRead = (data: unknown) => ({ status: 'ok', data, correlationId: 'corr-1' });
const refusedRead = (status: string, correlationId: string | null = 'corr-503') => ({
  status,
  correlationId,
});

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [VIEW, FINANCE, WORK_ORDER_READ];
  readDelivery.mockResolvedValue(okRead(delivery));
  readEligibility.mockResolvedValue(okRead(eligibility));
  readReceiver.mockResolvedValue(okRead({ deliveryId: DELIVERY_ID, receiver }));
  listSignatures.mockResolvedValue(
    okRead({ deliveryId: DELIVERY_ID, signatures: page([signature]) })
  );
  listChecklistResults.mockResolvedValue(
    okRead({ deliveryId: DELIVERY_ID, results: page([checklistResult]) })
  );
  listStatusHistory.mockResolvedValue(
    okRead({ deliveryId: DELIVERY_ID, transitions: page([transition]) })
  );
  readActiveChecklistItems.mockResolvedValue(okRead({ templates: [], templateCount: 0 }));
  readWorkOrderDetail.mockResolvedValue(okRead(workOrderDetail));
});

/** The screen as the route renders it for a caller holding the codes under test. */
function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <DeliveryDetailScreen
      locale="en"
      messages={en}
      delivery={delivery}
      canReadFinance={true}
      canComplete={false}
      canReadWorkOrder={true}
      {...over}
    />
  );
}

/** Opens the sheet and waits for the reads it makes to land. */
async function openDocument(label = EN['delivery.document.open'] as string) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: label }));
  await waitFor(() => expect(document.querySelector('[data-print="document"]')).not.toBeNull());
  return user;
}

/** Every write this feature can send. None of them may be reached by a printout. */
function expectNothingWritten() {
  expect(verifyReceiver).not.toHaveBeenCalled();
  expect(recordChecklistResult).not.toHaveBeenCalled();
  expect(completeDelivery).not.toHaveBeenCalled();
  expect(attachSignature).not.toHaveBeenCalled();
  expect(captureDeliverySignature).not.toHaveBeenCalled();
  expect(transitionWorkOrder).not.toHaveBeenCalled();
}

describe('the sheet is behind the same gate as the screen that carries it', () => {
  it('is absent for a caller the route refuses, and nothing it needs is read', async () => {
    PERMISSIONS = [FINANCE, WORK_ORDER_READ];
    const tree = await DeliveryPage({
      params: Promise.resolve({ locale: 'en', deliveryId: DELIVERY_ID }),
    });
    renderLtr(tree as React.ReactElement);

    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['delivery.document.heading'] as string)).toBeNull();
    expect(readReceiver).not.toHaveBeenCalled();
    expect(listChecklistResults).not.toHaveBeenCalled();
    expect(listSignatures).not.toHaveBeenCalled();
    expect(listStatusHistory).not.toHaveBeenCalled();
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
  });

  it('reads nothing for the sheet until it is opened', async () => {
    renderScreen();
    // The screen's own panels read for themselves; the sheet's work-order read
    // is the one nothing else on this screen makes, so it is the honest probe.
    await waitFor(() => expect(listStatusHistory).toHaveBeenCalled());
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
    expect(document.querySelector('[data-print="document"]')).toBeNull();
  });
});

describe('what the opened sheet carries', () => {
  it('renders the print frame with its checklist, signature and history rows', async () => {
    renderScreen();
    await openDocument();

    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    expect(within(sheet).getByText('FUEL')).toBeVisible();
    expect(within(sheet).getByText('Fuel level agreed')).toBeVisible();
    expect(within(sheet).getByText(EN['delivery.outcome.waived'] as string)).toBeVisible();
    expect(within(sheet).getByText('Agreed with the customer at collection')).toBeVisible();
    expect(within(sheet).getByText(EN['delivery.signatures.onFile'] as string)).toBeVisible();
    expect(within(sheet).getByText(EN['delivery.signerRole.receiver'] as string)).toBeVisible();
    expect(within(sheet).getAllByRole('table').length).toBe(3);
    expectNothingWritten();
  });

  it('prints the signature as a record on file and never the image', async () => {
    renderScreen();
    await openDocument();

    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    // The only image on the sheet is the brand mark the frame renders. A
    // signature image would arrive as a second one, so the assertion is on the
    // whole set rather than on the absence of any image at all.
    const images = within(sheet).getAllByRole('img');
    expect(images).toHaveLength(1);
    expect(images[0]?.getAttribute('src') ?? '').toMatch(/^\/brand\//);
    expect(sheet.textContent).not.toContain(signature.signatureDocumentVersionId);
    expect(sheet.textContent).not.toContain(receiver.identityEvidenceDocumentVersionId);
    expect(within(sheet).getByText(EN['delivery.receiver.evidenceOnFile'] as string)).toBeVisible();
  });

  it('takes the customer and the plate from the work-order read when the code is held', async () => {
    renderScreen();
    await openDocument();

    await waitFor(() => expect(readWorkOrderDetail).toHaveBeenCalledWith(WORK_ORDER_ID));
    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    expect(within(sheet).getByText('Layla Haddad')).toBeVisible();
    expect(within(sheet).getByText(/ABC-1234/)).toBeVisible();
    expect(within(sheet).getByText('WO-000119')).toBeVisible();
  });

  it('does not ask for the work order without its code, and says the sheet has references only', async () => {
    renderScreen({ canReadWorkOrder: false });
    await openDocument();

    expect(readWorkOrderDetail).not.toHaveBeenCalled();
    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    expect(
      within(sheet).getByText(EN['delivery.document.workOrderWithheld'] as string)
    ).toBeVisible();
    expect(within(sheet).queryByText('Layla Haddad')).toBeNull();
  });

  it('says a part could not be read instead of printing it as empty', async () => {
    listSignatures.mockResolvedValue(refusedRead('unavailable'));
    renderScreen();
    await openDocument();

    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    expect(
      within(sheet).getByText(EN['delivery.document.sectionRefused'] as string, { exact: false })
    ).toBeVisible();
    expect(within(sheet).getByText('corr-503')).toBeVisible();
    expect(within(sheet).queryByText(EN['delivery.document.signaturesNone'] as string)).toBeNull();
  });

  it('says when only the first page of a list is printed', async () => {
    listStatusHistory.mockResolvedValue(
      okRead({
        deliveryId: DELIVERY_ID,
        transitions: page([transition], { hasMore: true, nextCursor: 'next' }),
      })
    );
    renderScreen();
    await openDocument();

    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    expect(within(sheet).getByText(EN['delivery.document.partialList'] as string)).toBeVisible();
  });
});

describe('the financial half', () => {
  it('is printed for a caller holding the financial read code', async () => {
    renderScreen();
    await openDocument();

    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    expect(
      within(sheet).getByText(EN['delivery.blocker.financialBalanceOutstanding'] as string)
    ).toBeVisible();
    // A reason the server could not establish is marked as unchecked rather
    // than printed as an observed failure.
    expect(
      within(sheet).getByText(EN['delivery.document.factUnreadable'] as string, { exact: false })
    ).toBeVisible();
  });

  it('is left off without the code, is not requested, and the sheet says so', async () => {
    renderScreen({ canReadFinance: false });
    await openDocument();

    expect(readEligibility).not.toHaveBeenCalled();
    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    expect(
      within(sheet).getByText(EN['delivery.document.financeWithheld'] as string)
    ).toBeVisible();
    expect(
      within(sheet).queryByText(EN['delivery.blocker.financialBalanceOutstanding'] as string)
    ).toBeNull();
    expectNothingWritten();
  });
});

describe('the disclaimer the Owner required', () => {
  it('is on the English sheet', async () => {
    renderScreen();
    await openDocument();

    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    expect(within(sheet).getByText(EN['delivery.document.disclaimer'] as string)).toBeVisible();
  });

  it('is on the Arabic sheet, in Arabic', async () => {
    renderRtl(
      <DeliveryDetailScreen
        locale="ar"
        messages={ar}
        delivery={delivery}
        canReadFinance={true}
        canComplete={false}
        canReadWorkOrder={true}
      />
    );
    await openDocument(AR['delivery.document.open'] as string);

    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    expect(within(sheet).getByText(AR['delivery.document.disclaimer'] as string)).toBeVisible();
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('printing', () => {
  it('offers the print control only once the reads have landed, and writes nothing', async () => {
    renderScreen();
    expect(
      screen.queryByRole('button', { name: EN['delivery.document.print'] as string })
    ).toBeNull();

    const user = await openDocument();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await user.click(screen.getByRole('button', { name: EN['delivery.document.print'] as string }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
    expectNothingWritten();
  });

  it('keeps the controls off the paper', async () => {
    renderScreen();
    await openDocument();

    const toolbar = screen
      .getByRole('button', { name: EN['delivery.document.print'] as string })
      .closest('[data-print="hide"]');
    expect(toolbar).not.toBeNull();
  });
});
