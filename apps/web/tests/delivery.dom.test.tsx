import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * The vehicle handover, rendered (P1-31, FE-001, FE-002, FE-003, FE-004,
 * FE-006, FE-007).
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
 *
 * FE-001 adds the ready-for-delivery queue, whose properties are its own: all
 * three of the operation's codes gate the page and each one alone is enough to
 * refuse it; the branch pair is named before anything is read; and the verdict
 * is rendered exactly as the server composed it — an empty reason list is never
 * read as "ready", because a vehicle already handed over produces exactly that.
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
// Regression trap: a restored create call must fail the unavailable-selection cases.
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

/*
 * The handover screen draws the warranty issue control (FE-008) for a caller who
 * holds the code the generation declares. These cases hold none of it, so the
 * control is never reached — but the adapter module is still loaded through the
 * import graph, and the transport is not this file's subject. Replaced here, and
 * exercised for real in `warranty.dom.test.tsx`.
 */
const generateWarranty = vi.fn();
const listWarrantyPolicies = vi.fn(async () => ({
  status: 'ok' as const,
  data: { policies: { items: [], nextCursor: null, hasMore: false } },
  correlationId: 'corr-1',
}));
vi.mock('@/features/warranty/warranty-api', () => ({
  generateWarranty: (...args: unknown[]) => generateWarranty(...args),
  listWarranties: vi.fn(),
  listBranches: vi.fn(),
  readWarranty: vi.fn(),
  listWarrantyPolicies: () => listWarrantyPolicies(),
}));

const searchCustomerDirectory = vi.fn();
vi.mock('@/lib/customers/directory', () => ({
  searchCustomerDirectory: (...args: unknown[]) => searchCustomerDirectory(...args),
}));

const listDeliveryReadiness = vi.fn();
const readDeliveryReadinessScopes = vi.fn();
vi.mock('@/features/delivery/readiness-api', () => ({
  listDeliveryReadiness: (...args: unknown[]) => listDeliveryReadiness(...args),
  readDeliveryReadinessScopes: (...args: unknown[]) => readDeliveryReadinessScopes(...args),
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({
    permissions: PERMISSIONS,
    email: 'advisor@test.local',
    // The session's RESOLVED scope. The queue screen offers these as choices and
    // never lets the browser assert one of its own.
    companyIds: [COMPANY_ID],
    branchIds: [BRANCH_ID],
  }),
}));

const notifyActionResult = vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(true);
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
const { DeliveryReadinessScreen } =
  await import('@/features/delivery/components/DeliveryReadinessScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const DeliveryPage = (await import('@/app/[locale]/(dashboard)/delivery/[deliveryId]/page'))
  .default as unknown as RoutePage;
const DeliveryQueuePage = (await import('@/app/[locale]/(dashboard)/delivery/page'))
  .default as unknown as RoutePage;

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const WORK_ORDER_ID = '44444444-4444-4444-8444-444444444444';
const VEHICLE_ID = '55555555-5555-4555-8555-555555555555';
const VISIT_ID = '66666666-6666-4666-8666-666666666666';
const EMPLOYEE_ID = '77777777-7777-4777-8777-777777777777';
const PARTNER_ID = '88888888-8888-4888-8888-888888888888';
const SECOND_WORK_ORDER_ID = '99999999-9999-4999-8999-999999999999';

const VIEW = 'sal.delivery.view';
const FINANCE = 'sal.finance.view';
const COMPLETE = 'sal.delivery.complete';
const WORK_ORDER_READ = 'wo.work_order.read';
/** The three codes the ready-for-delivery queue requires, all of them. */
const QUEUE_CODES = [VIEW, WORK_ORDER_READ, FINANCE] as const;
const QUEUE_SCOPES = {
  status: 'ok' as const,
  data: {
    companies: [{ id: COMPANY_ID, legalName: 'Workshop company' }],
    branches: [{ id: BRANCH_ID, companyId: COMPANY_ID, name: 'Service branch' }],
  },
  correlationId: null,
};

const delivery = {
  id: DELIVERY_ID,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
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

/* ------------------------------------------------------------------ *
 * FE-001 — the ready-for-delivery queue
 * ------------------------------------------------------------------ */

/** One page of the queue, as the adapter hands it to the table. */
const queuePage = (rows: readonly unknown[], over: Record<string, unknown> = {}) => ({
  status: 'ok',
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr-queue',
  ...over,
});

const QUEUE_CURSOR = 'cXVldWUtY3Vyc29y';

/** The four checks this surface reports, all read and all clear. */
const clearFacts = [
  { blocker: 'work_order_not_complete', established: true, source: 'work order state' },
  { blocker: 'quality_control_not_passed', established: true, source: 'quality gate' },
  { blocker: 'financial_balance_outstanding', established: true, source: 'open receivable' },
  { blocker: 'part_obligation_outstanding', established: true, source: 'open commitments' },
];

const workOrderOf = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  companyId: COMPANY_ID,
  branchId: BRANCH_ID,
  receptionVisitId: VISIT_ID,
  vehicleId: VEHICLE_ID,
  kind: 'ordinary',
  state: 'closed',
  partsForwardState: 'settled',
  displayNumber: 'W-000123',
  openedAt: '2026-09-01T08:30:00.000Z',
  recordVersion: 3,
  customer: {
    partnerId: PARTNER_ID,
    displayName: 'Counter party at the desk',
    relationshipRole: 'service_requester',
    hasAdditionalParties: false,
  },
  vehicle: { vehicleId: VEHICLE_ID, registrationPlate: 'AA-1234', makeModel: 'Saloon, mid-size' },
  ...over,
});

const readyRow = {
  workOrder: workOrderOf(WORK_ORDER_ID),
  delivery: null,
  facts: clearFacts,
  blockers: [],
  readyToStartDelivery: true,
};

const heldRow = {
  workOrder: workOrderOf(SECOND_WORK_ORDER_ID, { displayNumber: 'W-000124' }),
  delivery: null,
  facts: [
    { blocker: 'financial_balance_outstanding', established: true, source: 'open receivable' },
    // Could not be READ. Still holds the vehicle back, and must not be drawn as
    // an ordinary failed check.
    { blocker: 'quality_control_not_passed', established: false, source: 'quality gate' },
  ],
  blockers: ['financial_balance_outstanding', 'quality_control_not_passed'],
  readyToStartDelivery: false,
};

/**
 * Already handed over: NOT ready, and NO reason named.
 *
 * The backend states that the reason for this is bound to the handover record
 * and is outside this surface's four, so the queue reports an empty reason list
 * for a vehicle that has already left. A screen that read "no reasons" as
 * "ready" would offer it again.
 */
const deliveredRow = {
  workOrder: workOrderOf(WORK_ORDER_ID),
  delivery: { ...delivery, status: 'delivered' },
  facts: clearFacts,
  blockers: [],
  readyToStartDelivery: false,
};

async function renderQueuePage(locale = 'en') {
  const tree = await DeliveryQueuePage({ params: Promise.resolve({ locale }) });
  return renderLtr(tree as React.ReactElement);
}

/** Mounts the queue and asks for the pre-filled branch, which is where it reads. */
async function showQueue(locale: 'en' | 'ar' = 'en') {
  const catalogue = locale === 'ar' ? ar : en;
  const render = locale === 'ar' ? renderRtl : renderLtr;
  const view = render(
    <DeliveryReadinessScreen locale={locale} messages={catalogue} scopeOptions={QUEUE_SCOPES} />
  );
  await userEvent.click(
    screen.getByRole('button', {
      name: (catalogue as Record<string, string>)['delivery.queue.show'] as string,
    })
  );
  await waitFor(() => expect(listDeliveryReadiness).toHaveBeenCalled());
  return view;
}

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
  verifyReceiver.mockResolvedValue(succeeded('delivery.receiver.verified'));
  recordChecklistResult.mockResolvedValue(succeeded('delivery.checklist.recorded'));
  completeDelivery.mockResolvedValue(succeeded('delivery.completion.done'));
  captureDeliverySignature.mockResolvedValue(succeeded('delivery.signature.attached'));
  searchCustomerDirectory.mockResolvedValue(customerPage([CUSTOMER]));
  listDeliveryReadiness.mockResolvedValue(queuePage([]));
  readDeliveryReadinessScopes.mockResolvedValue(QUEUE_SCOPES);
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
    expect(
      within(region).queryByText(EN['delivery.start.employeeSelectionUnavailable'] as string)
    ).toBeNull();
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

describe('employee selection is unavailable when starting a handover', () => {
  it.each(['en', 'ar'] as const)(
    'offers no employee input or Start action in %s and makes no create call',
    async (locale) => {
      const messages = locale === 'en' ? en : ar;
      const text = locale === 'en' ? EN : AR;
      const render = locale === 'en' ? renderLtr : renderRtl;
      render(
        <WorkOrderDeliveryPanel
          locale={locale}
          messages={messages}
          workOrderId={WORK_ORDER_ID}
          canManage={true}
        />
      );
      const region = screen.getByRole('region', {
        name: text['delivery.workOrder.heading'] as string,
      });
      expect(
        await within(region).findByText(
          text['delivery.start.employeeSelectionUnavailable'] as string
        )
      ).toBeVisible();
      expect(within(region).queryAllByRole('textbox')).toHaveLength(0);
      expect(within(region).queryAllByRole('button')).toHaveLength(0);
      expect(startDelivery).not.toHaveBeenCalled();
      expect(readWorkOrderDelivery).toHaveBeenCalledWith(WORK_ORDER_ID);
      if (locale === 'ar') {
        expect(
          within(region).queryByText(EN['delivery.start.employeeSelectionUnavailable'] as string)
        ).toBeNull();
      }
    }
  );

  it('keeps an existing handover accessible to a manager without offering employee entry', async () => {
    readWorkOrderDelivery.mockResolvedValue(okRead({ workOrderId: WORK_ORDER_ID, delivery }));
    renderLtr(
      <WorkOrderDeliveryPanel
        locale="en"
        messages={en}
        workOrderId={WORK_ORDER_ID}
        canManage={true}
      />
    );
    const link = await screen.findByRole('link', { name: EN['delivery.workOrder.open'] as string });
    expect(link.getAttribute('href')).toBe(`/en/delivery/${DELIVERY_ID}`);
    expect(
      screen.queryByText(EN['delivery.start.employeeSelectionUnavailable'] as string)
    ).toBeNull();
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(startDelivery).not.toHaveBeenCalled();
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

describe('the warranty control follows the code its own operation declares', () => {
  it('is absent for a caller who may release the vehicle but not issue a warranty', () => {
    // `wty.warranty.issue` is neither delivery write code. A caller holding both of
    // those and not this one sees no warranty control at all, rather than a button
    // whose only outcome is a denial.
    renderScreen({ canComplete: true, canManage: true, canIssueWarranty: false });
    expect(
      screen.queryByRole('region', { name: EN['warranty.generate.heading'] as string })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: EN['warranty.generate.submit'] as string })
    ).toBeNull();
  });

  it('is drawn for a caller who holds the issue code, and withheld before handover', () => {
    // Both halves: present, and present in the state this handover is actually in.
    // The stage is `ready` here, and the database refuses to date a warranty from a
    // handover that has not completed.
    renderScreen({ canIssueWarranty: true });
    expect(
      screen.getByRole('region', { name: EN['warranty.generate.heading'] as string })
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: EN['warranty.generate.submit'] as string })
    ).toBeDisabled();
  });

  it('is usable once the vehicle has been handed over', () => {
    renderScreen({
      delivery: { ...delivery, status: 'delivered', deliveredAt: '2026-09-08T09:00:00.000Z' },
      canIssueWarranty: true,
    });
    expect(
      screen.getByRole('button', { name: EN['warranty.generate.submit'] as string })
    ).toBeEnabled();
  });

  it('asks for no warranty plan without the warranty READ code', async () => {
    // Issuing and reading are two codes. A caller holding only the issue code gets
    // the control and no plan list is requested, because the answer could only be a
    // refusal — and the request that names no plan is still the one that works.
    renderScreen({ canIssueWarranty: true });
    await waitFor(() => expect(listWarrantyPolicies).not.toHaveBeenCalled());
  });

  it('asks for the plans when the caller holds the warranty read code', async () => {
    renderScreen({ canIssueWarranty: true, canReadWarrantyPolicies: true });
    await waitFor(() => expect(listWarrantyPolicies).toHaveBeenCalled());
  });
});

describe('the ready-for-delivery queue decides before it reads', () => {
  it.each([
    ['the delivery code', VIEW],
    ['the work-order code', WORK_ORDER_READ],
    ['the financial code', FINANCE],
  ])('refuses without %s, and reads NOTHING', async (_name, missing) => {
    PERMISSIONS = QUEUE_CODES.filter((code) => code !== missing);
    await renderQueuePage();
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    // Both halves. "Nothing was read" alone would stay green with the gate
    // deleted if the screen happened not to render.
    expect(screen.queryByText(EN['delivery.queue.show'] as string)).toBeNull();
    expect(listDeliveryReadiness).not.toHaveBeenCalled();
    expect(readDeliveryReadinessScopes).not.toHaveBeenCalled();
  });

  it('renders the queue for a caller who holds all three codes', async () => {
    PERMISSIONS = [...QUEUE_CODES];
    await renderQueuePage();
    expect(screen.getByRole('button', { name: EN['delivery.queue.show'] as string })).toBeVisible();
    expect(screen.queryByText(EN['state.denied.title'] as string)).toBeNull();
  });

  it('requests nothing at all until an operator names a branch', async () => {
    PERMISSIONS = [...QUEUE_CODES];
    await renderQueuePage();
    expect(screen.getByText(EN['delivery.queue.idleTitle'] as string)).toBeVisible();
    // The branch pair is the authorization TARGET. Reading before it is named
    // would degrade a branch-scoped check into a scope-blind permission test.
    expect(listDeliveryReadiness).not.toHaveBeenCalled();
  });
});

describe('the queue selects authorized named scopes', () => {
  it('shows directory names rather than raw identifier inputs', async () => {
    PERMISSIONS = [...QUEUE_CODES];
    await renderQueuePage();
    expect(screen.getByRole('option', { name: 'Workshop company' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'Service branch' })).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(listDeliveryReadiness).not.toHaveBeenCalled();
  });

  it('clears the selected branch when its company changes and requires a new matching branch', async () => {
    const secondCompany = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const secondBranch = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    renderLtr(
      <DeliveryReadinessScreen
        locale="en"
        messages={en}
        scopeOptions={{
          ...QUEUE_SCOPES,
          data: {
            companies: [
              ...QUEUE_SCOPES.data.companies,
              { id: secondCompany, legalName: 'Second company' },
            ],
            branches: [
              ...QUEUE_SCOPES.data.branches,
              { id: secondBranch, companyId: secondCompany, name: 'Second branch' },
            ],
          },
        }}
      />
    );
    const user = userEvent.setup();
    const company = screen.getByRole('combobox', {
      name: new RegExp(EN['delivery.queue.company'] as string),
    });
    const branch = screen.getByRole('combobox', {
      name: new RegExp(EN['delivery.queue.branch'] as string),
    });
    await user.selectOptions(company, COMPANY_ID);
    await user.selectOptions(branch, BRANCH_ID);
    await user.selectOptions(company, secondCompany);
    expect(branch).toHaveValue('');
    expect(screen.queryByRole('option', { name: 'Service branch' })).toBeNull();
    await user.click(screen.getByRole('button', { name: EN['delivery.queue.show'] as string }));
    expect(listDeliveryReadiness).not.toHaveBeenCalled();
    await user.selectOptions(branch, secondBranch);
    await user.click(screen.getByRole('button', { name: EN['delivery.queue.show'] as string }));
    await waitFor(() =>
      expect(listDeliveryReadiness).toHaveBeenCalledWith(
        expect.objectContaining({ companyId: secondCompany, branchId: secondBranch })
      )
    );
  });

  it.each(['denied', 'unavailable', 'expired'])(
    'shows directory %s without offering raw scope entry or reading the queue',
    async (status) => {
      PERMISSIONS = [...QUEUE_CODES];
      readDeliveryReadinessScopes.mockResolvedValue({ status, correlationId: 'scope-unavailable' });
      await renderQueuePage();
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(
        screen.queryByRole('button', { name: EN['delivery.queue.show'] as string })
      ).toBeNull();
      expect(listDeliveryReadiness).not.toHaveBeenCalled();
      expect(screen.getByText(EN[`state.${status}.title`] as string)).toBeVisible();
    }
  );

  it('distinguishes an empty authorized directory from an empty readiness queue', async () => {
    PERMISSIONS = [...QUEUE_CODES];
    readDeliveryReadinessScopes.mockResolvedValue({
      status: 'ok',
      data: { companies: [], branches: [] },
      correlationId: null,
    });
    await renderQueuePage();
    expect(screen.getByText(EN['delivery.queue.noScopesTitle'] as string)).toBeVisible();
    expect(screen.queryByText(EN['delivery.queue.noneMatching'] as string)).toBeNull();
    expect(listDeliveryReadiness).not.toHaveBeenCalled();
  });
});

describe('the queue renders the verdict it was given and derives none of it', () => {
  it('names the branch the operator chose, and no scope of its own', async () => {
    listDeliveryReadiness.mockResolvedValue(queuePage([readyRow]));
    await showQueue();
    const asked = listDeliveryReadiness.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(asked['companyId']).toBe(COMPANY_ID);
    expect(asked['branchId']).toBe(BRANCH_ID);
    expect(asked['cursor']).toBeNull();
    // No eligibility is ever asserted by a request. There is no such parameter
    // on the operation and this screen must never invent one.
    expect(asked['ready']).toBeUndefined();
  });

  it('draws a ready row as ready, with no reason list', async () => {
    listDeliveryReadiness.mockResolvedValue(queuePage([readyRow]));
    const { container } = await showQueue();
    const row = (await within(container).findByText('W-000123')).closest('tr') as HTMLElement;
    expect(within(row).getByText(EN['delivery.queue.ready'] as string)).toBeVisible();
    expect(within(row).queryByText(EN['delivery.queue.notReady'] as string)).toBeNull();
    expect(
      within(row).queryByText(EN['delivery.blocker.financialBalanceOutstanding'] as string)
    ).toBeNull();
  });

  it('shows an absent server verdict as unknown even for a closed work order with no blockers', async () => {
    listDeliveryReadiness.mockResolvedValue(
      queuePage([{ ...readyRow, readyToStartDelivery: undefined }])
    );
    const { container } = await showQueue();
    const row = (await within(container).findByText('W-000123')).closest('tr') as HTMLElement;
    expect(within(row).getByText(EN['delivery.queue.unknown'] as string)).toBeVisible();
    expect(within(row).queryByText(EN['delivery.queue.ready'] as string)).toBeNull();
  });

  it('draws a held row as not ready and names every reason the server gave', async () => {
    listDeliveryReadiness.mockResolvedValue(queuePage([heldRow]));
    const { container } = await showQueue();
    const row = (await within(container).findByText('W-000124')).closest('tr') as HTMLElement;
    expect(within(row).getByText(EN['delivery.queue.notReady'] as string)).toBeVisible();
    expect(
      within(row).getByText(EN['delivery.blocker.financialBalanceOutstanding'] as string)
    ).toBeVisible();
    expect(
      within(row).getByText(EN['delivery.blocker.qualityControlNotPassed'] as string)
    ).toBeVisible();
  });

  it('marks a check that could not be READ apart from one that failed', async () => {
    listDeliveryReadiness.mockResolvedValue(queuePage([heldRow]));
    const { container } = await showQueue();
    const row = (await within(container).findByText('W-000124')).closest('tr') as HTMLElement;
    // Exactly one of the two reasons could not be established, and only that one
    // carries the mark. Marking both would send an operator to support for a
    // customer's unpaid bill; marking neither turns an outage into a customer
    // conversation.
    const quality = within(row)
      .getByText(EN['delivery.blocker.qualityControlNotPassed'] as string)
      .closest('li') as HTMLElement;
    expect(quality.textContent).toContain(EN['delivery.queue.reasonUnreadable'] as string);
    const money = within(row)
      .getByText(EN['delivery.blocker.financialBalanceOutstanding'] as string)
      .closest('li') as HTMLElement;
    expect(money.textContent).not.toContain(EN['delivery.queue.reasonUnreadable'] as string);
  });

  it('never reads an empty reason list as ready', async () => {
    listDeliveryReadiness.mockResolvedValue(queuePage([deliveredRow]));
    const { container } = await showQueue();
    const row = (await within(container).findByText('W-000123')).closest('tr') as HTMLElement;
    // The row carries NO reason and is NOT ready. Inferring readiness from the
    // empty list would offer a vehicle that has already left the workshop.
    expect(within(row).getByText(EN['delivery.queue.notReady'] as string)).toBeVisible();
    expect(within(row).queryByText(EN['delivery.queue.ready'] as string)).toBeNull();
    expect(within(row).getByText(EN['delivery.queue.notReadyNoReasons'] as string)).toBeVisible();
  });

  it('links a started handover and states plainly when there is none', async () => {
    listDeliveryReadiness.mockResolvedValue(
      queuePage([
        readyRow,
        {
          ...deliveredRow,
          workOrder: workOrderOf(SECOND_WORK_ORDER_ID, { displayNumber: 'W-000124' }),
        },
      ])
    );
    const { container } = await showQueue();
    await within(container).findByText('W-000123');
    const rows = Array.from(container.querySelectorAll('tbody tr')) as HTMLElement[];
    expect(rows).toHaveLength(2);
    const first = rows[0] as HTMLElement;
    const second = rows[1] as HTMLElement;
    expect(within(first).getByText(EN['delivery.queue.noHandover'] as string)).toBeVisible();
    const open = within(second).getByRole('link', {
      name: EN['delivery.queue.openHandover'] as string,
    });
    expect(open.getAttribute('href')).toBe(`/en/delivery/${DELIVERY_ID}`);
    expect(within(second).getByText(EN['delivery.status.delivered'] as string)).toBeVisible();
  });

  it('links every row to its work order and offers no action of its own', async () => {
    listDeliveryReadiness.mockResolvedValue(queuePage([readyRow]));
    const { container } = await showQueue();
    await within(container).findByText('W-000123');
    const body = container.querySelector('tbody') as HTMLElement;
    const link = within(body).getByRole('link', { name: 'W-000123' });
    expect(link.getAttribute('href')).toBe(`/en/work-orders/${WORK_ORDER_ID}`);
    // Starting a handover belongs to the work order's own panel, with its own
    // authority. A control here would be an affordance this read cannot enforce.
    expect(within(body).queryAllByRole('button')).toHaveLength(0);
  });

  it('carries the cursor the server published rather than one of its own', async () => {
    listDeliveryReadiness.mockResolvedValueOnce(
      queuePage([readyRow], { nextCursor: QUEUE_CURSOR, hasMore: true })
    );
    listDeliveryReadiness.mockResolvedValue(queuePage([heldRow]));
    await showQueue();
    await screen.findByText('W-000123');
    await userEvent.click(screen.getByRole('button', { name: EN['table.nextPage'] as string }));
    await waitFor(() => expect(listDeliveryReadiness).toHaveBeenCalledTimes(2));
    const next = listDeliveryReadiness.mock.calls[1]?.[0] as Record<string, unknown>;
    expect(next['cursor']).toBe(QUEUE_CURSOR);
    expect(await screen.findByText('W-000124')).toBeVisible();
  });

  it('says a refusal is a refusal rather than showing an empty queue', async () => {
    listDeliveryReadiness.mockResolvedValue({
      status: 'denied',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-queue-403',
    });
    const { container } = await showQueue();
    // "Nothing is ready" and "you may not see this" are different sentences.
    expect(await within(container).findByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(within(container).queryByText(EN['delivery.queue.noneMatching'] as string)).toBeNull();
  });

  it('states an empty branch as an empty branch', async () => {
    listDeliveryReadiness.mockResolvedValue(queuePage([]));
    const { container } = await showQueue();
    expect(
      await within(container).findByText(EN['delivery.queue.noneMatching'] as string)
    ).toBeVisible();
  });
});

describe('the queue reads in Arabic as Arabic', () => {
  it('renders its verdict and its reasons from the Arabic catalogue, right to left', async () => {
    listDeliveryReadiness.mockResolvedValue(queuePage([heldRow]));
    const { container } = await showQueue('ar');
    expect(document.documentElement.dir).toBe('rtl');
    const row = (await within(container).findByText('W-000124')).closest('tr') as HTMLElement;
    for (const key of [
      'delivery.queue.notReady',
      'delivery.blocker.financialBalanceOutstanding',
      'delivery.blocker.qualityControlNotPassed',
      'delivery.queue.reasonUnreadable',
    ]) {
      expect(row.textContent, key).toContain(AR[key] as string);
      // A copy-paste that leaves the English string in the Arabic catalogue
      // reads as translated to anyone who does not read Arabic.
      expect(row.textContent, key).not.toContain(EN[key] as string);
    }
  });
});
