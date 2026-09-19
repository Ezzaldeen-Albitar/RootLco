import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import { renderLtr, renderRtl } from './render';

/**
 * A refused signature document, met by the two P1-31 delivery surfaces
 * (SEC-002, file-access half).
 *
 * ## What a "refused download" is on this surface, stated exactly
 *
 * There is no download control on this screen, and its absence is deliberate
 * rather than missing: `shared.attachment-download-authorize` is
 * `auditClass: 'security'`, so a prefetched or speculative dereference would
 * write a security audit record for a download nobody performed. No adapter in
 * `apps/web/src` calls that operation, and `SignaturesPanel` says in its own
 * docblock that a signature is an event rather than a picture.
 *
 * So the only way a signature document is reachable from a P1-31 screen is the
 * read that publishes its REFERENCE — `sal.delivery-signature-list`,
 * `listSignatures` — and the refusal this file exercises is that read answering
 * `403`, which `STATUS_BY_KIND` in `lib/api/read-operation.ts` maps from
 * `forbidden` to the `denied` view state. That is the real shape. Nothing here
 * invents an error code, a catalogue code or a message: every expected string is
 * read out of the shipped message files.
 *
 * ## The properties under test
 *
 *   - the ledger renders the SHARED permissions message, with the reference the
 *     backend logged, in both text directions;
 *   - a refusal is never drawn as an empty ledger — "no signatures yet" is a
 *     statement about the handover and would be a lie about a refusal;
 *   - the screen stays USABLE: every other panel keeps the answer it got, the
 *     printable sheet is still offered, and the write control the caller's own
 *     code grants is still drawn. A refused READ is not a refused WRITE;
 *   - nothing is swallowed: the panel does not fall back to a blank surface, and
 *     no further page is requested after a refusal;
 *   - the stored document reference is never published, refused or not, and no
 *     control on either surface offers to dereference one;
 *   - the printable sheet composed over the same refusal SAYS the part could not
 *     be read and carries the reference, rather than printing a shorter document
 *     that looks complete.
 *
 * ## The mock boundary, and where it came from
 *
 * The seven mocked modules below — the delivery adapter, the work-order
 * adapter, `signature-capture`, the customer directory, the session, the action
 * notifications and `next/navigation` — are the set
 * `delivery-document.dom.test.tsx` establishes at its lines 44-88, copied
 * deliberately rather than reduced: this file renders the same screen AND opens
 * the same printable sheet, so it needs the same boundary. It is not the
 * `delivery.dom.test.tsx` set, which serves the queue as well as the record.
 *
 * The last case pairs with `delivery-document.dom.test.tsx` lines 351-362. That
 * suite prints the same "could not be read" section for an `unavailable`
 * refusal; this one proves the printable sheet behaves identically when the
 * refusal is `denied`, which is the state SEC-002 is about. The duplication is
 * the intended pairing, not an oversight.
 *
 * ## What this file does NOT prove
 *
 * It mocks the delivery adapters, so it proves how the SCREEN behaves when its
 * adapter reports a refusal. It does not prove that the API refuses, that the
 * adapter maps a real 403 onto `denied` (that mapping is `read-operation.ts`'s
 * own contract), or anything about transport. A green run here is not evidence
 * of an end-to-end refusal path.
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

const DELIVERY_ID = '33333333-3333-4333-8333-333333333333';
const WORK_ORDER_ID = '44444444-4444-4444-8444-444444444444';
const VEHICLE_ID = '55555555-5555-4555-8555-555555555555';
const VISIT_ID = '66666666-6666-4666-8666-666666666666';
const EMPLOYEE_ID = '77777777-7777-4777-8777-777777777777';
const PARTNER_ID = '88888888-8888-4888-8888-888888888888';

/** The reference the backend logged for the refusal — the operator's only lead. */
const REFUSAL_REFERENCE = 'corr-403';

/**
 * The stored signature document, by reference only.
 *
 * A negative assertion about this id is only worth making where the id could
 * have reached the DOM, so the control case below feeds it in through a signature
 * the adapter DOES return, and the refused cases pair it with
 * `receiver.identityEvidenceDocumentVersionId`, which the mocked `readReceiver`
 * returns in every case in this file.
 */
const SIGNATURE_DOCUMENT_VERSION_ID = 'signature-document-1';

const delivery = {
  id: DELIVERY_ID,
  companyId: '11111111-1111-4111-8111-111111111111',
  branchId: '22222222-2222-4222-8222-222222222222',
  workOrderId: WORK_ORDER_ID,
  receptionVisitId: VISIT_ID,
  vehicleId: VEHICLE_ID,
  deliveringEmployeeId: EMPLOYEE_ID,
  deliveringEmployeeDisplayName: 'Maryam Haddad',
  status: 'delivered',
  deliveredAt: '2026-09-10T11:00:00.000Z',
  finalOdometerReadingId: '99999999-9999-4999-8999-999999999999',
  recordVersion: 7,
};

const eligibility = {
  deliveryId: DELIVERY_ID,
  workOrderId: WORK_ORDER_ID,
  status: 'delivered',
  eligible: true,
  blockers: [],
  overridden: [],
  facts: [],
  checklistGaps: [],
  overridable: [],
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

/** A signature the adapter answers with, carrying its stored document reference. */
const signature = {
  id: 'signature-1',
  deliveryRecordId: DELIVERY_ID,
  signerRole: 'receiver',
  signatureDocumentVersionId: SIGNATURE_DOCUMENT_VERSION_ID,
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

/** A read the backend refused, in the shape `readOperation()` publishes one. */
const deniedRead = (correlationId: string | null = REFUSAL_REFERENCE) => ({
  status: 'denied',
  correlationId,
});

beforeEach(() => {
  vi.clearAllMocks();
  PERMISSIONS = ['sal.delivery.view', 'sal.finance.view', 'wo.work_order.read'];
  readDelivery.mockResolvedValue(okRead(delivery));
  readEligibility.mockResolvedValue(okRead(eligibility));
  readReceiver.mockResolvedValue(okRead({ deliveryId: DELIVERY_ID, receiver }));
  // THE CASE UNDER TEST: the one read that would publish a signature document
  // reference is refused. Every other read answers, so any collapse observed
  // below belongs to the refusal and not to a screen with nothing to draw.
  listSignatures.mockResolvedValue(deniedRead());
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
      canManage={false}
      canReadWorkOrder={true}
      {...over}
    />
  );
}

/** One panel of the screen, by its heading. */
const panel = (key: string) => screen.getByRole('region', { name: EN[key] as string });

/**
 * Every write REACHABLE from what these cases render. A refused read may reach
 * none of them.
 *
 * Three further writes are deliberately not asserted here, because nothing in
 * this file could make them fire and a passing negative would say nothing:
 * `completeDelivery` lives in `CompletionPanel`, which is not rendered while
 * `canComplete` is false; `attachSignature` is reached only through
 * `captureDeliverySignature`, which is mocked and already asserted below; and
 * `transitionWorkOrder` belongs to the work-order tree, which the delivery
 * screen never calls.
 */
function expectNothingWritten() {
  expect(verifyReceiver).not.toHaveBeenCalled();
  expect(recordChecklistResult).not.toHaveBeenCalled();
  expect(captureDeliverySignature).not.toHaveBeenCalled();
}

describe('a refused signature ledger on the handover screen', () => {
  it('renders the shared permissions message with the reference the backend logged', async () => {
    renderScreen();
    await waitFor(() => expect(listSignatures).toHaveBeenCalledWith(DELIVERY_ID, null));
    const region = panel('delivery.signatures.heading');
    expect(within(region).getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(within(region).getByText(EN['state.denied.description'] as string)).toBeVisible();
    expect(within(region).getByText(REFUSAL_REFERENCE)).toBeVisible();
  });

  it('never draws the refusal as an empty ledger', async () => {
    renderScreen();
    await waitFor(() => expect(listSignatures).toHaveBeenCalled());
    const region = panel('delivery.signatures.heading');
    expect(within(region).queryByText(EN['delivery.signatures.noneTitle'] as string)).toBeNull();
    expect(
      within(region).queryByText(EN['delivery.signatures.noneDescription'] as string)
    ).toBeNull();
    expect(within(region).queryByText(EN['delivery.signatures.onFile'] as string)).toBeNull();
    expect(within(region).queryByRole('listitem')).toBeNull();
  });

  it('does not swallow the refusal into a blank surface', async () => {
    renderScreen();
    await waitFor(() => expect(listSignatures).toHaveBeenCalled());
    const region = panel('delivery.signatures.heading');
    // The heading alone is not "the refusal was shown". The panel must carry
    // readable prose beyond its own title, which is what a silently swallowed
    // refusal would lack.
    expect(region.textContent ?? '').toContain(EN['state.denied.title'] as string);
    expect((region.textContent ?? '').length).toBeGreaterThan(
      (EN['delivery.signatures.heading'] as string).length
    );
    // The refusal is announced, not merely printed: `StateShell` is the one
    // `role="status"` region of this panel, and a skeleton placeholder left in
    // its place would still be loading rather than refused.
    const announced = within(region).getByRole('status');
    expect(announced).toHaveTextContent(EN['state.denied.title'] as string);
    expect(announced.querySelector('code')).toHaveTextContent(REFUSAL_REFERENCE);
  });

  it('asks for no further page once the first was refused', async () => {
    renderScreen();
    await waitFor(() => expect(listSignatures).toHaveBeenCalled());
    const region = panel('delivery.signatures.heading');
    expect(
      within(region).queryByRole('button', { name: EN['delivery.action.loadMore'] as string })
    ).toBeNull();
    expect(listSignatures).toHaveBeenCalledTimes(1);
    expect(listSignatures).toHaveBeenCalledWith(DELIVERY_ID, null);
  });

  it('leaves the rest of the handover readable', async () => {
    renderScreen();
    await waitFor(() => expect(listStatusHistory).toHaveBeenCalled());
    // Each panel reads its own subresource, so a refusal on one may not take the
    // others with it.
    expect(
      within(panel('delivery.receiver.heading')).queryByText(EN['state.denied.title'] as string)
    ).toBeNull();
    expect(
      await within(panel('delivery.checklist.heading')).findByText(checklistResult.label)
    ).toBeVisible();
    expect(
      within(panel('delivery.signatures.heading')).getByText(EN['state.denied.title'] as string)
    ).toBeVisible();
    expect(screen.getByText(EN['delivery.document.heading'] as string)).toBeVisible();
  });

  it('still draws the write control the caller’s own code grants', async () => {
    renderScreen({ canManage: true });
    await waitFor(() => expect(listSignatures).toHaveBeenCalled());
    const region = panel('delivery.signatures.heading');
    // A refused READ is not a refused WRITE. The capture control is resolved
    // against the code the attachment operation declares, and the ledger's
    // refusal says nothing about it.
    expect(
      within(region).getByText(EN['delivery.signatures.captureHeading'] as string)
    ).toBeVisible();
    // Found, not got: the refusal renders after the read settles, and the wait
    // above only proves the read was asked for.
    expect(await within(region).findByText(EN['state.denied.title'] as string)).toBeVisible();
    expectNothingWritten();
  });

  it('offers nothing that would dereference a stored signature document', async () => {
    const { container } = renderScreen({ canManage: true });
    await waitFor(() => expect(listSignatures).toHaveBeenCalled());
    const region = panel('delivery.signatures.heading');
    // `shared.attachment-download-authorize` is a security-class command. No
    // link and no download affordance may exist here, refused or not — and a
    // speculative one would write an audit record for a download nobody
    // performed.
    expect(within(region).queryAllByRole('link')).toHaveLength(0);
    expect(container.textContent ?? '').not.toContain(SIGNATURE_DOCUMENT_VERSION_ID);
    // The refused read publishes no id of its own, so the load-bearing negative
    // here is the receiver's evidence reference: `readReceiver` DOES return it
    // in every case in this file, and `ReceiverPanel` withholds it by design.
    expect(container.textContent ?? '').not.toContain(receiver.identityEvidenceDocumentVersionId);
  });

  it('withholds the document reference even when the ledger READS successfully', async () => {
    // The control for the two negatives above. Without a case in which the id
    // is actually in the adapter's answer, `not.toContain` would pass on a
    // screen that had simply rendered nothing.
    listSignatures.mockResolvedValue(
      okRead({ deliveryId: DELIVERY_ID, signatures: page([signature]) })
    );
    const { container } = renderScreen({ canManage: true });
    const region = panel('delivery.signatures.heading');
    // The signature is on the screen as an EVENT...
    expect(
      await within(region).findByText(EN['delivery.signatures.onFile'] as string)
    ).toBeVisible();
    expect(within(region).queryByText(EN['state.denied.title'] as string)).toBeNull();
    // ...and the receiver's evidence likewise, as prose rather than a reference.
    expect(await screen.findByText(EN['delivery.receiver.evidenceOnFile'] as string)).toBeVisible();
    // Neither stored document reference is published, and nothing offers to
    // dereference one.
    expect(container.textContent ?? '').not.toContain(SIGNATURE_DOCUMENT_VERSION_ID);
    expect(container.textContent ?? '').not.toContain(receiver.identityEvidenceDocumentVersionId);
    expect(within(region).queryAllByRole('link')).toHaveLength(0);
    expectNothingWritten();
  });

  it('says the same thing in Arabic', async () => {
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
    await waitFor(() => expect(listSignatures).toHaveBeenCalled());
    const region = screen.getByRole('region', {
      name: AR['delivery.signatures.heading'] as string,
    });
    // The same assertions the English cases make, so a locale that lost the
    // reference or the announcement could not pass on the title alone.
    expect(within(region).getByText(AR['state.denied.title'] as string)).toBeVisible();
    expect(within(region).getByText(AR['state.denied.description'] as string)).toBeVisible();
    expect(within(region).getByText(REFUSAL_REFERENCE)).toBeVisible();
    const announced = within(region).getByRole('status');
    expect(announced).toHaveTextContent(AR['state.denied.title'] as string);
    expect(announced.querySelector('code')).toHaveTextContent(REFUSAL_REFERENCE);
    expect(within(region).queryByText(AR['delivery.signatures.noneTitle'] as string)).toBeNull();
    expect(document.documentElement.dir).toBe('rtl');
  });
});

describe('a refused signature ledger on the printable handover sheet', () => {
  /** Opens the sheet and waits for the reads it makes to land. */
  async function openDocument() {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: EN['delivery.document.open'] as string }));
    await waitFor(() => expect(document.querySelector('[data-print="document"]')).not.toBeNull());
    return user;
  }

  it('prints that the part could not be read, with its reference', async () => {
    renderScreen();
    await openDocument();
    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    expect(
      within(sheet).getByText(EN['delivery.document.sectionRefused'] as string, { exact: false })
    ).toBeVisible();
    expect(within(sheet).getByText(REFUSAL_REFERENCE)).toBeVisible();
    expect(within(sheet).queryByText(EN['delivery.document.signaturesNone'] as string)).toBeNull();
  });

  it('still composes and offers the rest of the sheet', async () => {
    renderScreen();
    await openDocument();
    const sheet = document.querySelector('[data-print="document"]') as HTMLElement;
    expect(within(sheet).getByText('WO-000119')).toBeVisible();
    expect(within(sheet).getByText(checklistResult.label)).toBeVisible();
    expect(
      screen.getByRole('button', { name: EN['delivery.document.print'] as string })
    ).toBeVisible();
    expect(sheet.textContent ?? '').not.toContain(SIGNATURE_DOCUMENT_VERSION_ID);
    // The receiver read SUCCEEDED, so its evidence reference is the one that
    // could have been printed here, and the sheet states the fact instead.
    expect(sheet.textContent ?? '').not.toContain(receiver.identityEvidenceDocumentVersionId);
    expect(within(sheet).getByText(EN['delivery.receiver.evidenceOnFile'] as string)).toBeVisible();
    expectNothingWritten();
  });
});
