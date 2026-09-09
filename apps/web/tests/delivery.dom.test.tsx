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
 *
 * The execution half adds: every control is drawn only for a caller holding the
 * code ITS OWN operation declares, and is ABSENT rather than disabled for anyone
 * else; a waiver states its reason and a pass never carries one; a recorded
 * outcome is final and a second attempt says so in those words; the release
 * quotes the version the RELEASE CHECKS published and never one a preparation
 * step answered with; a reading with two decimals is refused by the form before
 * a request is spent; and a blocked release names the reasons the server gave,
 * read again, rather than a sentence this tier composed.
 */

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

/*
 * A required control's `<label>` carries a decorative asterisk, so its label
 * text is the catalogue string PLUS a character the catalogue does not hold.
 * Anchoring at the start matches the label without asserting the marker, which
 * is a styling decision rather than a property of this screen.
 */
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);
const labelledAr = (key: string) => new RegExp(`^${escape(AR[key] as string)}`);

const readDelivery = vi.fn();
const readEligibility = vi.fn();
const readReceiver = vi.fn();
const listSignatures = vi.fn();
const listChecklistResults = vi.fn();
const listStatusHistory = vi.fn();
const readWorkOrderDelivery = vi.fn();
const readActiveChecklistItems = vi.fn();
const startDelivery = vi.fn();
const verifyReceiver = vi.fn();
const recordChecklistResult = vi.fn();
const completeDelivery = vi.fn();
vi.mock('@/features/delivery/api', () => ({
  readDelivery: (...args: unknown[]) => readDelivery(...args),
  readEligibility: (...args: unknown[]) => readEligibility(...args),
  readReceiver: (...args: unknown[]) => readReceiver(...args),
  listSignatures: (...args: unknown[]) => listSignatures(...args),
  listChecklistResults: (...args: unknown[]) => listChecklistResults(...args),
  listStatusHistory: (...args: unknown[]) => listStatusHistory(...args),
  readWorkOrderDelivery: (...args: unknown[]) => readWorkOrderDelivery(...args),
  readActiveChecklistItems: (...args: unknown[]) => readActiveChecklistItems(...args),
  startDelivery: (...args: unknown[]) => startDelivery(...args),
  verifyReceiver: (...args: unknown[]) => verifyReceiver(...args),
  recordChecklistResult: (...args: unknown[]) => recordChecklistResult(...args),
  completeDelivery: (...args: unknown[]) => completeDelivery(...args),
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

const TEMPLATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ITEM_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SECOND_ITEM_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const item = (id: string, code: string, label: string, isMandatory = true) => ({
  id,
  templateId: TEMPLATE_ID,
  itemCode: code,
  label,
  isMandatory,
  sortOrder: 1,
  recordVersion: 1,
});

const checklist = {
  templates: [
    {
      template: {
        id: TEMPLATE_ID,
        companyId: '11111111-1111-4111-8111-111111111111',
        templateCode: 'HANDOVER',
        name: 'Handover checks',
        status: 'active',
        recordVersion: 1,
      },
      items: [
        item(ITEM_ID, 'FUEL', 'Fuel level agreed'),
        item(SECOND_ITEM_ID, 'KEYS', 'All keys returned', false),
      ],
    },
  ],
  templateCount: 1,
};

/** The release checks as they read when nothing is holding the vehicle back. */
const clearEligibility = {
  ...eligibility,
  eligible: true,
  blockers: [],
  checklistGaps: [],
  facts: [{ blocker: 'signature_missing', established: true, source: 'delivery signatures' }],
};

/** The release checks with ONLY the one reason the platform lets an authority set aside. */
const moneyOnlyEligibility = {
  ...eligibility,
  eligible: false,
  blockers: ['financial_balance_outstanding'],
  checklistGaps: [],
};

const CUSTOMER = {
  id: PARTNER_ID,
  displayNumber: 'C-000482',
  displayName: 'Layla Haddad',
  partyType: 'individual',
  lifecycleStatus: 'active',
  createdAt: '2026-01-01T00:00:00.000Z',
};

const customerPage = (rows: readonly unknown[]) => ({
  status: 'ok',
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr-1',
});

const succeeded = (messageKey: string) => ({ status: 'success', messageKey, attempt: 1 });
const refusedWrite = (status: string, code?: string) => ({
  status,
  messageKey: 'state.conflict.title',
  correlationId: 'corr-9',
  attempt: 1,
  ...(code === undefined ? {} : { code }),
});

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
  readActiveChecklistItems.mockResolvedValue(okRead(checklist));
  startDelivery.mockResolvedValue(succeeded('delivery.start.done'));
  verifyReceiver.mockResolvedValue(succeeded('delivery.receiver.verified'));
  recordChecklistResult.mockResolvedValue(succeeded('delivery.checklist.recorded'));
  completeDelivery.mockResolvedValue(succeeded('delivery.completion.done'));
  captureDeliverySignature.mockResolvedValue(succeeded('delivery.signature.attached'));
  searchCustomerDirectory.mockResolvedValue(customerPage([CUSTOMER]));
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

const recordedWaiver = {
  id: 'result-1',
  deliveryRecordId: DELIVERY_ID,
  templateItemId: ITEM_ID,
  itemCode: 'FUEL',
  label: 'Fuel level agreed',
  outcome: 'waived',
  waiverReason: 'Agreed with the branch manager at handover.',
  recordedBy: EMPLOYEE_ID,
  recordVersion: 1,
};

describe('the checklist results', () => {
  it('says which checklists are in use, rather than presenting a subset as the whole', async () => {
    readActiveChecklistItems.mockResolvedValue(okRead({ templates: [], templateCount: 0 }));
    renderScreen();
    await waitFor(() => expect(listChecklistResults).toHaveBeenCalledWith(DELIVERY_ID, null));
    const region = panel('delivery.checklist.heading');
    expect(
      within(region).getByText(EN['delivery.checklist.noTemplatesTitle'] as string)
    ).toBeVisible();
  });

  it('renders every item of every checklist in use, whether or not it has a result', async () => {
    renderScreen();
    const region = await screen.findByRole('region', {
      name: EN['delivery.checklist.heading'] as string,
    });
    expect(await within(region).findByText('Fuel level agreed')).toBeVisible();
    expect(within(region).getByText('All keys returned')).toBeVisible();
    // The required marker is on the required item and not on the other.
    expect(within(region).getAllByText(EN['delivery.checklist.mandatory'] as string)).toHaveLength(
      1
    );
  });

  it('shows the outcome and the reason a waiver was given', async () => {
    listChecklistResults.mockResolvedValue(
      okRead({ deliveryId: DELIVERY_ID, results: page([recordedWaiver]) })
    );
    renderScreen();
    await waitFor(() => expect(listChecklistResults).toHaveBeenCalled());
    const region = panel('delivery.checklist.heading');
    expect(await within(region).findByText(EN['delivery.outcome.waived'] as string)).toBeVisible();
    expect(within(region).getByText('Agreed with the branch manager at handover.')).toBeVisible();
  });

  it('keeps a result recorded against an item that has since been withdrawn', async () => {
    listChecklistResults.mockResolvedValue(
      okRead({
        deliveryId: DELIVERY_ID,
        results: page([{ ...recordedWaiver, templateItemId: 'withdrawn-item', itemCode: 'MATS' }]),
      })
    );
    renderScreen();
    const region = await screen.findByRole('region', {
      name: EN['delivery.checklist.heading'] as string,
    });
    expect(
      await within(region).findByText(EN['delivery.checklist.withdrawnHeading'] as string)
    ).toBeVisible();
    expect(within(region).getByText('MATS')).toBeVisible();
  });

  it('reports a refusal of the CONFIGURATION as a refusal, not as an empty checklist', async () => {
    readActiveChecklistItems.mockResolvedValue(refusedRead('denied'));
    renderScreen();
    const region = await screen.findByRole('region', {
      name: EN['delivery.checklist.heading'] as string,
    });
    expect(await within(region).findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(within(region).queryByText('Fuel level agreed')).toBeNull();
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
  it('says there is none, and offers no way to start one WITHOUT the write code', async () => {
    renderLtr(<WorkOrderDeliveryPanel locale="en" messages={en} workOrderId={WORK_ORDER_ID} />);
    await waitFor(() => expect(readWorkOrderDelivery).toHaveBeenCalledWith(WORK_ORDER_ID));
    const region = screen.getByRole('region', {
      name: EN['delivery.workOrder.heading'] as string,
    });
    expect(within(region).getByText(EN['delivery.workOrder.none'] as string)).toBeVisible();
    // Absent, not disabled. A button whose only outcome is a denial teaches an
    // operator to ignore denials.
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

describe('starting a handover from the work order', () => {
  const renderPanel = (over: Record<string, unknown> = {}) =>
    renderLtr(
      <WorkOrderDeliveryPanel
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER_ID}
        canManage={true}
        {...over}
      />
    );

  it('sends the work order and the chosen employee, and nothing the service derives', async () => {
    const user = userEvent.setup();
    renderPanel();
    const field = await screen.findByLabelText(labelled('delivery.start.deliveringEmployee'));
    await user.type(field, EMPLOYEE_ID);
    await user.click(screen.getByRole('button', { name: EN['delivery.start.submit'] as string }));
    await waitFor(() =>
      expect(startDelivery).toHaveBeenCalledWith({
        workOrderId: WORK_ORDER_ID,
        deliveringEmployeeId: EMPLOYEE_ID,
      })
    );
    // The vehicle and the visit are the service's to derive from the work order.
    expect(JSON.stringify(startDelivery.mock.calls[0])).not.toContain(VEHICLE_ID);
    expect(JSON.stringify(startDelivery.mock.calls[0])).not.toContain(VISIT_ID);
  });

  it('refuses to send with no employee named, and spends no request', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(
      await screen.findByRole('button', { name: EN['delivery.start.submit'] as string })
    );
    expect(startDelivery).not.toHaveBeenCalled();
    expect(screen.getByText(EN['form.required'] as string)).toBeVisible();
  });

  it('re-reads the work order once a handover has been opened', async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.type(
      await screen.findByLabelText(labelled('delivery.start.deliveringEmployee')),
      EMPLOYEE_ID
    );
    await user.click(screen.getByRole('button', { name: EN['delivery.start.submit'] as string }));
    await waitFor(() => expect(readWorkOrderDelivery).toHaveBeenCalledTimes(2));
  });

  it('reports a refusal and does NOT re-read, because nothing was opened', async () => {
    const user = userEvent.setup();
    startDelivery.mockResolvedValue(refusedWrite('conflict'));
    renderPanel();
    await user.type(
      await screen.findByLabelText(labelled('delivery.start.deliveringEmployee')),
      EMPLOYEE_ID
    );
    await user.click(screen.getByRole('button', { name: EN['delivery.start.submit'] as string }));
    await waitFor(() => expect(notifyActionResult).toHaveBeenCalled());
    expect(readWorkOrderDelivery).toHaveBeenCalledTimes(1);
  });
});

describe('confirming who may receive the vehicle', () => {
  it('is absent for a caller without the write code, and present with it', async () => {
    const without = renderScreen();
    await waitFor(() => expect(readReceiver).toHaveBeenCalled());
    expect(
      within(panel('delivery.receiver.heading')).queryByText(
        EN['delivery.receiver.verifyHeading'] as string
      )
    ).toBeNull();
    without.unmount();

    renderScreen({ canManage: true });
    const region = await screen.findByRole('region', {
      name: EN['delivery.receiver.heading'] as string,
    });
    expect(
      await within(region).findByText(EN['delivery.receiver.verifyHeading'] as string)
    ).toBeVisible();
  });

  it('sends the partner chosen by NAME, and no identity reference it did not capture', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    const region = await screen.findByRole('region', {
      name: EN['delivery.receiver.heading'] as string,
    });
    await user.type(
      await within(region).findByLabelText(labelled('crm.customers.column.name')),
      'Layla'
    );
    await user.click(
      within(region).getByRole('button', { name: EN['customerSelector.search'] as string })
    );
    await user.click(await within(region).findByRole('button', { name: /Layla Haddad/ }));
    await user.click(
      within(region).getByRole('button', { name: EN['delivery.receiver.verifySubmit'] as string })
    );
    await waitFor(() =>
      expect(verifyReceiver).toHaveBeenCalledWith(DELIVERY_ID, { receiverPartnerId: PARTNER_ID })
    );
  });

  it('refuses to send with nobody chosen, and spends no request', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    const region = await screen.findByRole('region', {
      name: EN['delivery.receiver.heading'] as string,
    });
    await user.click(
      await within(region).findByRole('button', {
        name: EN['delivery.receiver.verifySubmit'] as string,
      })
    );
    expect(verifyReceiver).not.toHaveBeenCalled();
    expect(
      within(region).getByText(EN['delivery.receiver.partnerRequired'] as string)
    ).toBeVisible();
  });

  it('offers no second confirmation once somebody is confirmed', async () => {
    readReceiver.mockResolvedValue(okRead({ deliveryId: DELIVERY_ID, receiver }));
    renderScreen({ canManage: true });
    const region = await screen.findByRole('region', {
      name: EN['delivery.receiver.heading'] as string,
    });
    await within(region).findByText(EN['delivery.receiver.evidenceOnFile'] as string);
    expect(within(region).queryByText(EN['delivery.receiver.verifyHeading'] as string)).toBeNull();
  });
});

describe('working through the checklist', () => {
  const openChecklist = async () => {
    renderScreen({ canManage: true });
    return screen.findByRole('region', { name: EN['delivery.checklist.heading'] as string });
  };

  /** The row of one item, found by the code the backend published for it. */
  const rowFor = (region: HTMLElement, code: string) => {
    const row = region.querySelector(`[data-item-code="${code}"]`);
    expect(row).not.toBeNull();
    return row as HTMLElement;
  };

  it('records a pass with NO reason attached to it', async () => {
    const user = userEvent.setup();
    const region = await openChecklist();
    await within(region).findByText('Fuel level agreed');
    const row = rowFor(region, 'FUEL');
    await user.click(
      within(row).getByRole('button', { name: EN['delivery.checklist.record'] as string })
    );
    await waitFor(() =>
      // The waiver rule is a biconditional: a reason on a pass is refused, not
      // ignored, so the field must be absent rather than empty.
      expect(recordChecklistResult).toHaveBeenCalledWith(DELIVERY_ID, {
        templateItemId: ITEM_ID,
        outcome: 'passed',
      })
    );
  });

  it('refuses a waiver with no reason, before a request is spent', async () => {
    const user = userEvent.setup();
    const region = await openChecklist();
    await within(region).findByText('Fuel level agreed');
    const row = rowFor(region, 'FUEL');
    await user.selectOptions(
      within(row).getByLabelText(EN['delivery.checklist.outcome'] as string),
      'waived'
    );
    await user.click(
      within(row).getByRole('button', { name: EN['delivery.checklist.record'] as string })
    );
    expect(recordChecklistResult).not.toHaveBeenCalled();
    // The reason box says so itself, rather than the row saying it somewhere.
    const reason = within(row).getByLabelText(labelled('delivery.checklist.waiverReasonLabel'));
    expect(reason).toHaveAttribute('aria-invalid', 'true');
    expect(within(row).getByText(EN['form.required'] as string)).toBeVisible();
  });

  it('sends a waiver WITH the reason once one is given', async () => {
    const user = userEvent.setup();
    const region = await openChecklist();
    await within(region).findByText('Fuel level agreed');
    const row = rowFor(region, 'FUEL');
    await user.selectOptions(
      within(row).getByLabelText(EN['delivery.checklist.outcome'] as string),
      'waived'
    );
    await user.type(
      within(row).getByLabelText(labelled('delivery.checklist.waiverReasonLabel')),
      'Tank was already empty on arrival.'
    );
    await user.click(
      within(row).getByRole('button', { name: EN['delivery.checklist.record'] as string })
    );
    await waitFor(() =>
      expect(recordChecklistResult).toHaveBeenCalledWith(DELIVERY_ID, {
        templateItemId: ITEM_ID,
        outcome: 'waived',
        waiverReason: 'Tank was already empty on arrival.',
      })
    );
  });

  it('says "already recorded" in those words rather than reporting a bare conflict', async () => {
    const user = userEvent.setup();
    recordChecklistResult.mockResolvedValue(refusedWrite('conflict', 'ERR-INT-001'));
    const region = await openChecklist();
    await within(region).findByText('Fuel level agreed');
    const row = rowFor(region, 'FUEL');
    await user.click(
      within(row).getByRole('button', { name: EN['delivery.checklist.record'] as string })
    );
    expect(
      await within(row).findByText(EN['delivery.checklist.alreadyRecorded'] as string)
    ).toBeVisible();
  });

  it('offers no control at all for an item that already has an outcome', async () => {
    listChecklistResults.mockResolvedValue(
      okRead({ deliveryId: DELIVERY_ID, results: page([recordedWaiver]) })
    );
    const region = await openChecklist();
    await within(region).findByText('Fuel level agreed');
    const done = rowFor(region, 'FUEL');
    const open = rowFor(region, 'KEYS');
    // Absent, not disabled: there is no way to change a recorded outcome, so a
    // greyed control would invite the operator to look for one.
    expect(
      within(done).queryByRole('button', { name: EN['delivery.checklist.record'] as string })
    ).toBeNull();
    expect(
      within(open).getByRole('button', { name: EN['delivery.checklist.record'] as string })
    ).toBeVisible();
  });

  it('shows the outcome and no control to a caller without the write code', async () => {
    renderScreen();
    const region = await screen.findByRole('region', {
      name: EN['delivery.checklist.heading'] as string,
    });
    await within(region).findByText('Fuel level agreed');
    expect(
      within(region).queryByRole('button', { name: EN['delivery.checklist.record'] as string })
    ).toBeNull();
    expect(
      within(region).getAllByText(EN['delivery.checklist.notRecordedYet'] as string).length
    ).toBeGreaterThan(0);
  });
});

describe('adding a signature', () => {
  it('is absent without the write code and present with it', async () => {
    const without = renderScreen();
    await waitFor(() => expect(listSignatures).toHaveBeenCalled());
    expect(
      within(panel('delivery.signatures.heading')).queryByText(
        EN['delivery.signatures.captureHeading'] as string
      )
    ).toBeNull();
    without.unmount();

    renderScreen({ canManage: true });
    const region = await screen.findByRole('region', {
      name: EN['delivery.signatures.heading'] as string,
    });
    expect(
      within(region).getByText(EN['delivery.signatures.captureHeading'] as string)
    ).toBeVisible();
  });

  it('captures against the VISIT the delivery names, and the delivery it belongs to', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    const region = await screen.findByRole('region', {
      name: EN['delivery.signatures.heading'] as string,
    });
    const file = new File(['x'], 'signature.png', { type: 'image/png' });
    await user.upload(
      within(region).getByLabelText(EN['delivery.signatures.signatureFile'] as string),
      file
    );
    await user.click(
      within(region).getByRole('button', {
        name: EN['delivery.signatures.captureSubmit'] as string,
      })
    );
    await waitFor(() => expect(captureDeliverySignature).toHaveBeenCalled());
    const [deliveryArg, visitArg, formData] = captureDeliverySignature.mock.calls[0] ?? [];
    expect(deliveryArg).toBe(DELIVERY_ID);
    // The visit comes from the record the page read, never from the form.
    expect(visitArg).toBe(VISIT_ID);
    expect((formData as FormData).get('signerRole')).toBe('receiver');
    expect((formData as FormData).get('signatureFile')).toBeInstanceOf(File);
  });

  it('re-reads the ledger once a signature is on file', async () => {
    const user = userEvent.setup();
    renderScreen({ canManage: true });
    const region = await screen.findByRole('region', {
      name: EN['delivery.signatures.heading'] as string,
    });
    await user.upload(
      within(region).getByLabelText(EN['delivery.signatures.signatureFile'] as string),
      new File(['x'], 'signature.png', { type: 'image/png' })
    );
    await user.click(
      within(region).getByRole('button', {
        name: EN['delivery.signatures.captureSubmit'] as string,
      })
    );
    await waitFor(() => expect(listSignatures).toHaveBeenCalledTimes(2));
  });
});

describe('releasing the vehicle', () => {
  const renderRelease = (over: Record<string, unknown> = {}) =>
    renderScreen({ canComplete: true, canManage: true, ...over });

  const releasePanel = async () =>
    screen.findByRole('region', { name: EN['delivery.completion.heading'] as string });

  it('is not drawn at all for a caller without the authority to release', async () => {
    readEligibility.mockResolvedValue(okRead(clearEligibility));
    renderScreen({ canComplete: false, canManage: true });
    await waitFor(() => expect(readEligibility).toHaveBeenCalled());
    expect(
      screen.queryByRole('region', { name: EN['delivery.completion.heading'] as string })
    ).toBeNull();
  });

  it('quotes the version the RELEASE CHECKS published, not one a preparation step answered with', async () => {
    const user = userEvent.setup();
    readEligibility.mockResolvedValue(okRead({ ...clearEligibility, recordVersion: 7 }));
    renderRelease();
    const region = await releasePanel();
    await user.type(
      within(region).getByLabelText(labelled('delivery.completion.odometer')),
      '120.5'
    );
    await user.click(
      within(region).getByRole('button', { name: EN['delivery.completion.submit'] as string })
    );
    await waitFor(() =>
      expect(completeDelivery).toHaveBeenCalledWith({
        deliveryId: DELIVERY_ID,
        ifMatch: 7,
        finalOdometerValue: '120.5',
        odometerUnit: 'km',
      })
    );
  });

  it('refuses a reading with two decimals before a request is spent', async () => {
    const user = userEvent.setup();
    readEligibility.mockResolvedValue(okRead(clearEligibility));
    renderRelease();
    const region = await releasePanel();
    await user.type(
      within(region).getByLabelText(labelled('delivery.completion.odometer')),
      '120.45'
    );
    await user.click(
      within(region).getByRole('button', { name: EN['delivery.completion.submit'] as string })
    );
    // The route's own rule admits two decimals; the column holds one, so the
    // request would be refused after the fact by a field the operator has left.
    expect(completeDelivery).not.toHaveBeenCalled();
    expect(
      within(region).getByText(EN['delivery.completion.odometerInvalid'] as string)
    ).toBeVisible();
  });

  it('cannot be sent while a reason the platform will not set aside is outstanding', async () => {
    renderRelease();
    const region = await releasePanel();
    expect(
      within(region).getByRole('button', { name: EN['delivery.completion.submit'] as string })
    ).toBeDisabled();
    expect(within(region).getByText(EN['delivery.completion.heldBack'] as string)).toBeVisible();
  });

  it('offers the override ONLY when the server says that reason may be set aside', async () => {
    readEligibility.mockResolvedValue(okRead(clearEligibility));
    const clear = renderRelease();
    let region = await releasePanel();
    // Nothing is blocking, so nothing is offered to set aside.
    expect(within(region).queryByText(EN['delivery.completion.override'] as string)).toBeNull();
    clear.unmount();

    readEligibility.mockResolvedValue(okRead(moneyOnlyEligibility));
    renderRelease();
    region = await releasePanel();
    expect(within(region).getByText(EN['delivery.completion.override'] as string)).toBeVisible();
  });

  it('demands a written reason for an override, and sends it when one is given', async () => {
    const user = userEvent.setup();
    readEligibility.mockResolvedValue(okRead(moneyOnlyEligibility));
    renderRelease();
    const region = await releasePanel();
    await user.type(within(region).getByLabelText(labelled('delivery.completion.odometer')), '90');
    await user.click(within(region).getByLabelText(EN['delivery.completion.override'] as string));
    await user.click(
      within(region).getByRole('button', { name: EN['delivery.completion.submit'] as string })
    );
    expect(completeDelivery).not.toHaveBeenCalled();

    await user.type(
      within(region).getByLabelText(labelled('delivery.completion.overrideReason')),
      'Settlement agreed in writing.'
    );
    await user.click(
      within(region).getByRole('button', { name: EN['delivery.completion.submit'] as string })
    );
    await waitFor(() =>
      expect(completeDelivery).toHaveBeenCalledWith(
        expect.objectContaining({ overrideReason: 'Settlement agreed in writing.' })
      )
    );
  });

  it('names the reasons a refused release gave, read again, with the item codes', async () => {
    const user = userEvent.setup();
    readEligibility.mockResolvedValue(okRead(clearEligibility));
    completeDelivery.mockResolvedValue(refusedWrite('conflict', 'ERR-TRN-001'));
    renderRelease();
    const region = await releasePanel();
    await user.type(within(region).getByLabelText(labelled('delivery.completion.odometer')), '90');
    // The refusal itself carries no reasons, so the release checks are read
    // again and it is THAT answer the panel renders.
    readEligibility.mockResolvedValue(okRead(eligibility));
    await user.click(
      within(region).getByRole('button', { name: EN['delivery.completion.submit'] as string })
    );
    const alert = await within(region).findByRole('alert');
    expect(alert).toHaveTextContent(EN['delivery.completion.refusedBlocked'] as string);
    expect(alert).toHaveTextContent(EN['delivery.blocker.signatureMissing'] as string);
    expect(alert).toHaveTextContent('FUEL');
  });

  it('names the authority a refused override needed', async () => {
    const user = userEvent.setup();
    readEligibility.mockResolvedValue(okRead(moneyOnlyEligibility));
    completeDelivery.mockResolvedValue({
      ...refusedWrite('denied', 'ERR-IAM-001'),
      requiredPermissions: [COMPLETE],
    });
    renderRelease();
    const region = await releasePanel();
    await user.type(within(region).getByLabelText(labelled('delivery.completion.odometer')), '90');
    await user.click(
      within(region).getByRole('button', { name: EN['delivery.completion.submit'] as string })
    );
    const alert = await within(region).findByRole('alert');
    expect(alert).toHaveTextContent(EN['delivery.completion.refusedOverride'] as string);
    expect(alert).toHaveTextContent(COMPLETE);
  });

  it('states that the release checks are not readable without the financial code', async () => {
    renderScreen({ canComplete: true, canManage: true, canReadFinance: false });
    const region = await releasePanel();
    expect(
      within(region).getByText(EN['delivery.completion.needsFinance'] as string)
    ).toBeVisible();
    expect(
      within(region).queryByRole('button', { name: EN['delivery.completion.submit'] as string })
    ).toBeNull();
  });

  it('re-reads every panel after a release', async () => {
    const user = userEvent.setup();
    readEligibility.mockResolvedValue(okRead(clearEligibility));
    renderRelease();
    const region = await releasePanel();
    await user.type(within(region).getByLabelText(labelled('delivery.completion.odometer')), '90');
    await user.click(
      within(region).getByRole('button', { name: EN['delivery.completion.submit'] as string })
    );
    await waitFor(() => expect(listStatusHistory).toHaveBeenCalledTimes(2));
    expect(readEligibility).toHaveBeenCalledTimes(2);
  });
});

describe('the execution controls read in Arabic as Arabic', () => {
  it('renders the release form and the checklist controls from the Arabic catalogue', async () => {
    readEligibility.mockResolvedValue(okRead(clearEligibility));
    renderRtl(
      <DeliveryDetailScreen
        locale="ar"
        messages={ar}
        delivery={delivery}
        canReadFinance={true}
        canComplete={true}
        canManage={true}
      />
    );
    expect(document.documentElement.dir).toBe('rtl');
    const region = await screen.findByRole('region', {
      name: AR['delivery.completion.heading'] as string,
    });
    expect(within(region).getByLabelText(labelledAr('delivery.completion.odometer'))).toBeVisible();
    expect(
      within(region).getByRole('button', { name: AR['delivery.completion.submit'] as string })
    ).toBeVisible();
    // The English of the same control must not be on screen: a copy-paste that
    // leaves the English string in the Arabic catalogue reads as translated.
    expect(within(region).queryByText(EN['delivery.completion.submit'] as string)).toBeNull();

    const checklistRegion = await screen.findByRole('region', {
      name: AR['delivery.checklist.heading'] as string,
    });
    const records = await within(checklistRegion).findAllByRole('button', {
      name: AR['delivery.checklist.record'] as string,
    });
    // One control per item still open, all of them Arabic.
    expect(records).toHaveLength(2);
    expect(
      within(checklistRegion).queryByRole('button', {
        name: EN['delivery.checklist.record'] as string,
      })
    ).toBeNull();
  });
});
