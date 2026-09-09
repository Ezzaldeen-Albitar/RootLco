import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * The vehicle handover, rendered (P1-31, FE-002, FE-003, FE-004, FE-006,
 * FE-007).
 *
 * The properties under test: the route page decides before it reads; the
 * release checks are neither shown nor REQUESTED without the financial read
 * code, because the operation would refuse the request anyway; a check that
 * could not be read is drawn differently from a check that failed, which is the
 * difference between "chase the customer" and "raise a platform problem"; every
 * panel tells an empty result from a refusal; the two sensitive references are
 * named and never fetched; the reasons read in Arabic as Arabic; and the work
 * order's own section reads nothing without the authority to see a handover.
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
vi.mock('@/features/delivery/api', () => ({
  readDelivery: (...args: unknown[]) => readDelivery(...args),
  readEligibility: (...args: unknown[]) => readEligibility(...args),
  readReceiver: (...args: unknown[]) => readReceiver(...args),
  listSignatures: (...args: unknown[]) => listSignatures(...args),
  listChecklistResults: (...args: unknown[]) => listChecklistResults(...args),
  listStatusHistory: (...args: unknown[]) => listStatusHistory(...args),
  readWorkOrderDelivery: (...args: unknown[]) => readWorkOrderDelivery(...args),
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'advisor@test.local' }),
}));

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

const { DeliveryDetailScreen } =
  await import('@/features/delivery/components/DeliveryDetailScreen');
const { WorkOrderDeliveryPanel } =
  await import('@/features/delivery/components/WorkOrderDeliveryPanel');
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
const COMPLETE = 'sal.delivery.complete';

const delivery = {
  id: DELIVERY_ID,
  companyId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
  workOrderId: WORK_ORDER_ID,
  receptionVisitId: VISIT_ID,
  vehicleId: VEHICLE_ID,
  deliveringEmployeeId: EMPLOYEE_ID,
  status: 'ready',
  deliveredAt: null,
  finalOdometerReadingId: null,
  recordVersion: 4,
};

const eligibility = {
  deliveryId: DELIVERY_ID,
  workOrderId: WORK_ORDER_ID,
  status: 'ready',
  eligible: false,
  blockers: ['financial_balance_outstanding', 'signature_missing'],
  overridden: [],
  facts: [
    {
      blocker: 'financial_balance_outstanding',
      established: true,
      source: 'billing open receivable',
    },
    { blocker: 'signature_missing', established: true, source: 'delivery signatures' },
    { blocker: 'quality_control_not_passed', established: false, source: 'quality gate' },
  ],
  checklistGaps: [
    {
      templateItemId: 'item-1',
      templateId: 'template-1',
      itemCode: 'FUEL',
      label: 'Fuel level agreed',
    },
  ],
  overridable: [{ code: 'financial_balance_outstanding', permission: COMPLETE }],
  recordVersion: 4,
};

const receiver = {
  id: 'receiver-1',
  deliveryRecordId: DELIVERY_ID,
  receiverPartnerId: PARTNER_ID,
  identityEvidenceDocumentVersionId: 'evidence-1',
  verifiedBy: EMPLOYEE_ID,
  verifiedAt: '2026-09-08T09:00:00.000Z',
  recordVersion: 1,
};

const page = (items: readonly unknown[], over: Record<string, unknown> = {}) => ({
  items,
  nextCursor: null,
  hasMore: false,
  ...over,
});

const okRead = (data: unknown) => ({ status: 'ok', data, correlationId: 'corr-1' });
const refusedRead = (status: string, correlationId: string | null = 'corr-403') => ({
  status,
  correlationId,
});

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = [];
  readDelivery.mockResolvedValue(okRead(delivery));
  readEligibility.mockResolvedValue(okRead(eligibility));
  readReceiver.mockResolvedValue(okRead({ deliveryId: DELIVERY_ID, receiver: null }));
  listSignatures.mockResolvedValue(okRead({ deliveryId: DELIVERY_ID, signatures: page([]) }));
  listChecklistResults.mockResolvedValue(okRead({ deliveryId: DELIVERY_ID, results: page([]) }));
  listStatusHistory.mockResolvedValue(okRead({ deliveryId: DELIVERY_ID, transitions: page([]) }));
  readWorkOrderDelivery.mockResolvedValue(okRead({ workOrderId: WORK_ORDER_ID, delivery: null }));
});

function renderScreen(over: Record<string, unknown> = {}) {
  return renderLtr(
    <DeliveryDetailScreen
      locale="en"
      messages={en}
      delivery={delivery}
      canReadFinance={true}
      canComplete={false}
      {...over}
    />
  );
}

async function renderPage(params: Record<string, string>) {
  const tree = await DeliveryPage({ params: Promise.resolve(params) });
  return renderLtr(tree as React.ReactElement);
}

/** One panel of the screen, by its own heading. */
const panel = (headingKey: string) =>
  screen.getByRole('region', { name: EN[headingKey] as string });

describe('the route page decides before it reads', () => {
  it('refuses without the delivery code: the refusal is rendered and NOTHING is read', async () => {
    PERMISSIONS = [FINANCE, COMPLETE];
    await renderPage({ locale: 'en', deliveryId: DELIVERY_ID });
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    // Both halves. "Nothing was read" alone would stay green with the gate
    // deleted if the screen happened not to render.
    expect(screen.queryByText(EN['delivery.summary.heading'] as string)).toBeNull();
    expect(readDelivery).not.toHaveBeenCalled();
    expect(readEligibility).not.toHaveBeenCalled();
    expect(readReceiver).not.toHaveBeenCalled();
    expect(listSignatures).not.toHaveBeenCalled();
    expect(listChecklistResults).not.toHaveBeenCalled();
    expect(listStatusHistory).not.toHaveBeenCalled();
  });

  it('reads the record for a caller who holds the delivery code', async () => {
    PERMISSIONS = [VIEW];
    await renderPage({ locale: 'en', deliveryId: DELIVERY_ID });
    await waitFor(() => expect(readDelivery).toHaveBeenCalledWith(DELIVERY_ID));
    expect(screen.getByText(EN['delivery.summary.heading'] as string)).toBeVisible();
  });

  it('states a delivery it cannot resolve as not found, not as a denial', async () => {
    PERMISSIONS = [VIEW];
    readDelivery.mockResolvedValue(refusedRead('not-found', null));
    await renderPage({ locale: 'en', deliveryId: DELIVERY_ID });
    expect(screen.getByText(EN['state.notFound.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['state.denied.title'] as string)).toBeNull();
  });

  it('states an ended session as an ended session rather than as a fault', async () => {
    PERMISSIONS = [VIEW];
    readDelivery.mockResolvedValue(refusedRead('expired', null));
    await renderPage({ locale: 'en', deliveryId: DELIVERY_ID });
    expect(screen.getByText(EN['state.expired.title'] as string)).toBeVisible();
    expect(screen.queryByText(EN['state.error.title'] as string)).toBeNull();
  });

  it('prints the backend’s reference when the BACKEND refused, and none when the page did', async () => {
    PERMISSIONS = [VIEW];
    readDelivery.mockResolvedValue(refusedRead('denied', 'corr-777'));
    const backend = await renderPage({ locale: 'en', deliveryId: DELIVERY_ID });
    expect(within(backend.container).getByText('corr-777')).toBeVisible();
    backend.unmount();

    PERMISSIONS = [];
    const gate = await renderPage({ locale: 'en', deliveryId: DELIVERY_ID });
    expect(within(gate.container).queryByText('corr-777')).toBeNull();
  });
});

describe('the release checks respect the second permission the operation demands', () => {
  it('is neither shown nor REQUESTED without the financial read code', async () => {
    renderScreen({ canReadFinance: false });
    expect(
      within(panel('delivery.eligibility.heading')).getByText(
        EN['delivery.eligibility.needsFinance'] as string
      )
    ).toBeVisible();
    expect(
      within(panel('delivery.eligibility.heading')).getByText(EN['state.denied.title'] as string)
    ).toBeVisible();
    // The request is the point. A screen that asks and renders the 403 would
    // put a denial in the backend's log for a decision it could make itself.
    await waitFor(() => expect(readReceiver).toHaveBeenCalled());
    expect(readEligibility).not.toHaveBeenCalled();
  });

  it('reads and renders the reasons for a caller who holds both codes', async () => {
    renderScreen();
    await waitFor(() => expect(readEligibility).toHaveBeenCalledWith(DELIVERY_ID));
    const region = panel('delivery.eligibility.heading');
    expect(
      within(region).getByText(EN['delivery.eligibility.notEligible'] as string)
    ).toBeVisible();
    expect(
      within(region).getAllByText(EN['delivery.blocker.financialBalanceOutstanding'] as string)
        .length
    ).toBeGreaterThan(0);
    expect(
      within(region).getAllByText(EN['delivery.blocker.signatureMissing'] as string).length
    ).toBeGreaterThan(0);
  });

  it('draws a check that COULD NOT BE READ differently from one that failed', async () => {
    renderScreen();
    await waitFor(() => expect(readEligibility).toHaveBeenCalled());
    const region = panel('delivery.eligibility.heading');
    const unreadable = region.querySelectorAll('[data-established="no"]');
    const established = region.querySelectorAll('[data-established="yes"]');
    // Exactly the one unestablished fact, and the established ones beside it —
    // an assertion on the unreadable count alone would pass if every row were
    // drawn that way.
    expect(unreadable).toHaveLength(1);
    expect(established).toHaveLength(2);
    expect(
      within(region).getByText(EN['delivery.eligibility.factUnreadable'] as string)
    ).toBeVisible();
    // The source is offered for support on the unreadable row only.
    expect(unreadable[0]?.textContent).toContain('quality gate');
  });

  it('says who may override the one overridable reason, and which side of it the reader is on', async () => {
    const held = renderScreen({ canComplete: true });
    await waitFor(() => expect(readEligibility).toHaveBeenCalled());
    expect(screen.getByText(EN['delivery.eligibility.overridableByYou'] as string)).toBeVisible();
    held.unmount();

    renderScreen({ canComplete: false });
    await waitFor(() => expect(readEligibility).toHaveBeenCalledTimes(2));
    expect(screen.getByText(EN['delivery.eligibility.overridableByOther'] as string)).toBeVisible();
  });

  it('names the required checklist items still open, and says the list is a sample', async () => {
    renderScreen();
    await waitFor(() => expect(readEligibility).toHaveBeenCalled());
    const region = panel('delivery.eligibility.heading');
    expect(within(region).getByText('Fuel level agreed')).toBeVisible();
    expect(
      within(region).getByText(EN['delivery.eligibility.gapsExplain'] as string)
    ).toBeVisible();
  });

  it('renders a refusal of the checks as a refusal, not as "everything is fine"', async () => {
    readEligibility.mockResolvedValue(refusedRead('denied'));
    renderScreen();
    await waitFor(() => expect(readEligibility).toHaveBeenCalled());
    const region = panel('delivery.eligibility.heading');
    expect(within(region).getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(within(region).queryByText(EN['delivery.eligibility.eligible'] as string)).toBeNull();
  });
});

describe('the confirmed receiver', () => {
  it('states that nobody is confirmed yet, rather than leaving the panel blank', async () => {
    renderScreen();
    await waitFor(() => expect(readReceiver).toHaveBeenCalledWith(DELIVERY_ID));
    expect(
      within(panel('delivery.receiver.heading')).getByText(
        EN['delivery.receiver.noneTitle'] as string
      )
    ).toBeVisible();
  });

  it('names the identity evidence and never asks for it', async () => {
    readReceiver.mockResolvedValue(okRead({ deliveryId: DELIVERY_ID, receiver }));
    const { container } = renderScreen();
    await waitFor(() => expect(readReceiver).toHaveBeenCalled());
    const region = panel('delivery.receiver.heading');
    expect(
      within(region).getByText(EN['delivery.receiver.evidenceOnFile'] as string)
    ).toBeVisible();
    // The reference itself is the sensitive part and is not printed anywhere.
    expect(container.textContent).not.toContain('evidence-1');
    expect(within(region).getByText(PARTNER_ID)).toBeVisible();
  });

  it('renders a refusal of the receiver as a refusal', async () => {
    readReceiver.mockResolvedValue(refusedRead('denied'));
    renderScreen();
    await waitFor(() => expect(readReceiver).toHaveBeenCalled());
    const region = panel('delivery.receiver.heading');
    expect(within(region).getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(within(region).queryByText(EN['delivery.receiver.noneTitle'] as string)).toBeNull();
  });
});

describe('the signatures', () => {
  const signature = {
    id: 'signature-1',
    deliveryRecordId: DELIVERY_ID,
    signerRole: 'receiver',
    signatureDocumentVersionId: 'signature-document-1',
    signedAt: '2026-09-08T10:00:00.000Z',
  };

  it('says there are none yet when the page is empty', async () => {
    renderScreen();
    await waitFor(() => expect(listSignatures).toHaveBeenCalledWith(DELIVERY_ID, null));
    expect(
      within(panel('delivery.signatures.heading')).getByText(
        EN['delivery.signatures.noneTitle'] as string
      )
    ).toBeVisible();
  });

  it('names the role and the moment, and never the stored image', async () => {
    listSignatures.mockResolvedValue(
      okRead({ deliveryId: DELIVERY_ID, signatures: page([signature]) })
    );
    const { container } = renderScreen();
    await waitFor(() => expect(listSignatures).toHaveBeenCalled());
    const region = panel('delivery.signatures.heading');
    expect(within(region).getByText(EN['delivery.signerRole.receiver'] as string)).toBeVisible();
    expect(within(region).getByText(EN['delivery.signatures.onFile'] as string)).toBeVisible();
    expect(container.textContent).not.toContain('signature-document-1');
  });

  it('asks for the next page with the server’s own cursor', async () => {
    const user = userEvent.setup();
    listSignatures.mockResolvedValueOnce(
      okRead({
        deliveryId: DELIVERY_ID,
        signatures: page([signature], { nextCursor: 'cursor-2', hasMore: true }),
      })
    );
    listSignatures.mockResolvedValueOnce(
      okRead({
        deliveryId: DELIVERY_ID,
        signatures: page([{ ...signature, id: 'signature-2', signerRole: 'witness' }]),
      })
    );
    renderScreen();
    const region = await screen.findByRole('region', {
      name: EN['delivery.signatures.heading'] as string,
    });
    await user.click(
      await within(region).findByRole('button', {
        name: EN['delivery.action.loadMore'] as string,
      })
    );
    await waitFor(() => expect(listSignatures).toHaveBeenLastCalledWith(DELIVERY_ID, 'cursor-2'));
    expect(
      await within(region).findByText(EN['delivery.signerRole.witness'] as string)
    ).toBeVisible();
  });

  it('renders a fault as a fault rather than as an empty ledger', async () => {
    listSignatures.mockResolvedValue(refusedRead('error', 'corr-500'));
    renderScreen();
    await waitFor(() => expect(listSignatures).toHaveBeenCalled());
    const region = panel('delivery.signatures.heading');
    expect(within(region).getByText(EN['state.error.title'] as string)).toBeVisible();
    expect(within(region).queryByText(EN['delivery.signatures.noneTitle'] as string)).toBeNull();
  });
});

describe('the checklist results', () => {
  it('says nothing has been recorded, and that this is not the whole checklist', async () => {
    renderScreen();
    await waitFor(() => expect(listChecklistResults).toHaveBeenCalledWith(DELIVERY_ID, null));
    const region = panel('delivery.checklist.heading');
    expect(within(region).getByText(EN['delivery.checklist.noneTitle'] as string)).toBeVisible();
    expect(within(region).getByText(EN['delivery.checklist.resultsOnly'] as string)).toBeVisible();
  });

  it('shows the outcome and the reason a waiver was given', async () => {
    listChecklistResults.mockResolvedValue(
      okRead({
        deliveryId: DELIVERY_ID,
        results: page([
          {
            id: 'result-1',
            deliveryRecordId: DELIVERY_ID,
            templateItemId: 'item-1',
            itemCode: 'FUEL',
            label: 'Fuel level agreed',
            outcome: 'waived',
            waiverReason: 'Agreed with the branch manager at handover.',
            recordedBy: EMPLOYEE_ID,
            recordVersion: 1,
          },
        ]),
      })
    );
    renderScreen();
    await waitFor(() => expect(listChecklistResults).toHaveBeenCalled());
    const region = panel('delivery.checklist.heading');
    expect(within(region).getByText(EN['delivery.outcome.waived'] as string)).toBeVisible();
    expect(within(region).getByText('Agreed with the branch manager at handover.')).toBeVisible();
  });
});

describe('the history', () => {
  it('draws a first transition as a start rather than as a missing value', async () => {
    listStatusHistory.mockResolvedValue(
      okRead({
        deliveryId: DELIVERY_ID,
        transitions: page([
          {
            id: 'transition-1',
            fromStatus: null,
            toStatus: 'ready',
            reason: null,
            actorId: EMPLOYEE_ID,
            occurredAt: '2026-09-08T08:00:00.000Z',
          },
          {
            id: 'transition-2',
            fromStatus: 'ready',
            toStatus: 'receiver_verified',
            reason: 'Identity confirmed at the counter.',
            actorId: EMPLOYEE_ID,
            occurredAt: '2026-09-08T09:00:00.000Z',
          },
        ]),
      })
    );
    renderScreen();
    await waitFor(() => expect(listStatusHistory).toHaveBeenCalledWith(DELIVERY_ID, null));
    const region = panel('delivery.history.heading');
    // The stage names sit in the same sentence as the wording around them, so
    // the assertion is on the sentence rather than on a bare label node.
    const started = within(region).getByText(/Started at/);
    expect(started).toHaveTextContent(EN['delivery.status.ready'] as string);
    const moved = within(region).getByText(/Moved from/);
    expect(moved).toHaveTextContent(EN['delivery.status.receiverVerified'] as string);
    expect(within(region).getByText('Identity confirmed at the counter.')).toBeVisible();
  });

  it('says there is no history rather than showing an empty list', async () => {
    renderScreen();
    await waitFor(() => expect(listStatusHistory).toHaveBeenCalled());
    expect(
      within(panel('delivery.history.heading')).getByText(
        EN['delivery.history.noneTitle'] as string
      )
    ).toBeVisible();
  });
});

describe('the summary', () => {
  it('names the identifiers as identifiers and explains why', async () => {
    const { container } = renderScreen();
    const region = panel('delivery.summary.heading');
    expect(within(region).getByText(VEHICLE_ID)).toBeVisible();
    expect(within(region).getByText(VISIT_ID)).toBeVisible();
    expect(within(region).getByText(EMPLOYEE_ID)).toBeVisible();
    expect(
      within(region).getByText(EN['delivery.summary.identifiersExplain'] as string)
    ).toBeVisible();
    expect(
      within(region).getByText(EN['delivery.summary.notDeliveredYet'] as string)
    ).toBeVisible();
    const link = within(region).getByRole('link', {
      name: EN['delivery.summary.workOrderLink'] as string,
    });
    expect(link.getAttribute('href')).toBe(`/en/work-orders/${WORK_ORDER_ID}`);
    expect(container.textContent).toContain(EN['delivery.status.ready'] as string);
  });
});

describe('the reasons read in Arabic as Arabic', () => {
  it('renders every blocker label from the Arabic catalogue, in a right-to-left document', async () => {
    renderRtl(
      <DeliveryDetailScreen
        locale="ar"
        messages={ar}
        delivery={delivery}
        canReadFinance={true}
        canComplete={false}
      />
    );
    await waitFor(() => expect(readEligibility).toHaveBeenCalled());
    expect(document.documentElement.dir).toBe('rtl');
    const region = screen.getByRole('region', {
      name: AR['delivery.eligibility.heading'] as string,
    });
    for (const key of [
      'delivery.blocker.financialBalanceOutstanding',
      'delivery.blocker.signatureMissing',
      'delivery.blocker.qualityControlNotPassed',
    ]) {
      expect(within(region).getAllByText(AR[key] as string).length).toBeGreaterThan(0);
      // The English of the same reason must not be on screen: a copy-paste that
      // leaves the English string in the Arabic catalogue reads as translated.
      expect(within(region).queryByText(EN[key] as string)).toBeNull();
    }
  });
});

describe('the work order’s own handover section', () => {
  it('says there is none, and offers no control that would create one', async () => {
    renderLtr(<WorkOrderDeliveryPanel locale="en" messages={en} workOrderId={WORK_ORDER_ID} />);
    await waitFor(() => expect(readWorkOrderDelivery).toHaveBeenCalledWith(WORK_ORDER_ID));
    const region = screen.getByRole('region', {
      name: EN['delivery.workOrder.heading'] as string,
    });
    expect(within(region).getByText(EN['delivery.workOrder.none'] as string)).toBeVisible();
    expect(within(region).queryAllByRole('button')).toHaveLength(0);
    expect(within(region).queryAllByRole('link')).toHaveLength(0);
  });

  it('links to the handover it found, and states its stage', async () => {
    readWorkOrderDelivery.mockResolvedValue(
      okRead({ workOrderId: WORK_ORDER_ID, delivery: { ...delivery, status: 'signed' } })
    );
    renderLtr(<WorkOrderDeliveryPanel locale="en" messages={en} workOrderId={WORK_ORDER_ID} />);
    const region = await screen.findByRole('region', {
      name: EN['delivery.workOrder.heading'] as string,
    });
    const link = await within(region).findByRole('link', {
      name: EN['delivery.workOrder.open'] as string,
    });
    expect(link.getAttribute('href')).toBe(`/en/delivery/${DELIVERY_ID}`);
    expect(within(region).getByText(/Signed/)).toBeVisible();
  });

  it('reports a refusal of that read rather than reporting no handover', async () => {
    readWorkOrderDelivery.mockResolvedValue(refusedRead('denied', 'corr-403'));
    renderLtr(<WorkOrderDeliveryPanel locale="en" messages={en} workOrderId={WORK_ORDER_ID} />);
    await waitFor(() => expect(readWorkOrderDelivery).toHaveBeenCalled());
    const region = screen.getByRole('region', {
      name: EN['delivery.workOrder.heading'] as string,
    });
    expect(within(region).getByRole('alert')).toHaveTextContent('corr-403');
    expect(within(region).queryByText(EN['delivery.workOrder.none'] as string)).toBeNull();
  });
});
