import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  TEST_BRANCH,
  branchSnapshot,
  inBranch,
  renderLtr as renderLtrBare,
  renderRtl as renderRtlBare,
} from './render';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';

/**
 * One quotation, rendered (P1-30, `W3`, FE-004 revisions, FE-007 approval
 * display, and the writes).
 *
 * The properties under test: totals and line figures render as the captured
 * strings (with the ISO code, never a percentage, never recomputed); the two
 * guarded writes send the QUOTATION's record version; decisions render the
 * server's outcome and are recorded against the presented revision; the
 * approval limits appear only under their own code; a closed quotation
 * offers no writes; and the route page renders every read outcome as itself.
 *
 * On the shared Material UI wrappers since the sales and finance slice
 * (ADR-022): the revision history is a grid, the forms are the Material fields,
 * the expiry is typed part by part on the quotation's own branch clock, issuing
 * asks first, and a write stays busy until the quotation has been read again.
 * The job and the payer are named, never shown as references.
 */

function withMui(ui: ReactElement, locale: 'en' | 'ar' = 'en'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderLtr = (ui: ReactElement) => renderLtrBare(withMui(ui, 'en'));

const EN = en as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const readQuotation = vi.fn();
const listRevisions = vi.fn();
const readRevision = vi.fn();
const readRevisionDecisions = vi.fn();
const createQuotationRevision = vi.fn();
const issueQuotation = vi.fn();
const decideRevision = vi.fn();
const decideItem = vi.fn();
const withdrawDiscountApproval = vi.fn();
vi.mock('@/features/quotations/api', () => ({
  readQuotation: (...args: unknown[]) => readQuotation(...args),
  listRevisions: (...args: unknown[]) => listRevisions(...args),
  readRevision: (...args: unknown[]) => readRevision(...args),
  readRevisionDecisions: (...args: unknown[]) => readRevisionDecisions(...args),
  createQuotationRevision: (...args: unknown[]) => createQuotationRevision(...args),
  issueQuotation: (...args: unknown[]) => issueQuotation(...args),
  decideRevision: (...args: unknown[]) => decideRevision(...args),
  decideItem: (...args: unknown[]) => decideItem(...args),
  withdrawDiscountApproval: (...args: unknown[]) => withdrawDiscountApproval(...args),
  listQuotations: vi.fn(),
  createQuotation: vi.fn(),
}));

const listServices = vi.fn();
vi.mock('@/features/services/api', () => ({
  listServices: (...args: unknown[]) => listServices(...args),
}));

const listApprovalLimits = vi.fn();
vi.mock('@/features/administration/access/api', () => ({
  listApprovalLimits: (...args: unknown[]) => listApprovalLimits(...args),
}));

const push = vi.fn();
const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

let PERMISSIONS: readonly string[] = [];
vi.mock('@/features/authentication/api/session', () => ({
  requireSession: async () => ({ permissions: PERMISSIONS, email: 'operator@test.local' }),
}));

const readWorkOrderDetail = vi.fn();
vi.mock('@/features/work-orders/api', () => ({
  readWorkOrderDetail: (...args: unknown[]) => readWorkOrderDetail(...args),
}));

const notifyActionResult = vi.fn((..._args: unknown[]): boolean => true);
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: (...args: unknown[]) => notifyActionResult(...args),
}));

const { QuotationDetailScreen } =
  await import('@/features/quotations/components/QuotationDetailScreen');
type RoutePage = (args: { params: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
const QuotationDetailPage = (
  await import('@/app/[locale]/(dashboard)/quotations/[quotationId]/page')
).default as unknown as RoutePage;

const QUOTATION_ID = '33333333-3333-4333-8333-333333333333';
const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const ISSUED_ID = '44444444-4444-4444-8444-444444444444';
const OLD_ID = '22222222-2222-4222-8222-222222222222';
const LINE_1 = 'aaaaaaa1-0000-4000-8000-000000000001';
const LINE_2 = 'aaaaaaa2-0000-4000-8000-000000000002';
const PARTNER_ID = '88888888-8888-4888-8888-888888888888';
const SERVICE_ID = '55555555-5555-4555-8555-555555555555';

const line = (id: string, lineNumber: number, over: Record<string, unknown> = {}) => ({
  id,
  lineNumber,
  itemKind: 'service',
  serviceId: SERVICE_ID,
  description: lineNumber === 1 ? 'Oil change' : 'Brake pads',
  currency: 'JOD',
  unitPrice: '100.0000',
  quantity: '2.000',
  discount: '0.0000',
  taxRate: '0.100000',
  taxAmount: '20.0000',
  lineTotal: '220.0000',
  priceRuleRef: 'rule-1',
  ...over,
});

function revision(over: Record<string, unknown> = {}) {
  return {
    id: ISSUED_ID,
    revisionNumber: 2,
    status: 'issued',
    currency: 'JOD',
    issuedAt: '2026-09-05T10:00:00Z',
    expiresAt: null,
    subtotal: '400.0000',
    discountTotal: '0.0000',
    taxTotal: '40.0000',
    grandTotal: '440.0000',
    recordVersion: 1,
    lines: [line(LINE_1, 1), line(LINE_2, 2)],
    discountApproval: null,
    ...over,
  };
}

/** A discount request as the revision carries it (P1-32-PRE-OD-DISC-01). */
function discountApproval(over: Record<string, unknown> = {}) {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    quotationId: QUOTATION_ID,
    quotationNumber: 'QUO-000001',
    revisionId: ISSUED_ID,
    revisionNumber: 2,
    companyId: 'company-1',
    branchId: TEST_BRANCH.id,
    status: 'pending',
    origin: 'requested',
    currency: 'JOD',
    discountTotal: '40.0000',
    discountBase: '400.0000',
    elevatedLineCount: 1,
    threshold: null,
    requiredPermission: 'svc.price.manage',
    requestedBy: { id: 'aaaaaaaa-0000-4000-8000-000000000001', displayName: 'Omar Saleh' },
    requestedAt: '2026-09-20T09:00:00Z',
    requestedByCaller: false,
    canApprove: false,
    cannotApproveReason: 'missing_permission',
    canReject: false,
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    supersededAt: null,
    requesterSetPolicy: false,
    requesterSetPrice: false,
    canWithdraw: false,
    withdrawnBy: null,
    withdrawnAt: null,
    recordVersion: 1,
    ...over,
  };
}

/** The current revision as a DRAFT carrying a discount request in `state`. */
const draftWith = (over: Record<string, unknown>) =>
  quotation({
    currentRevision: revision({
      status: 'draft',
      issuedAt: null,
      discountApproval: discountApproval(over),
    }),
  });

function quotation(over: Record<string, unknown> = {}) {
  return {
    id: QUOTATION_ID,
    quotationNumber: 'QUO-000001',
    workOrderId: WORK_ORDER_ID,
    companyId: 'company-1',
    branchId: TEST_BRANCH.id,
    currency: 'JOD',
    status: 'active',
    payerPartnerRef: PARTNER_ID,
    currentRevisionId: ISSUED_ID,
    recordVersion: 5,
    currentRevision: revision(),
    ...over,
  };
}

const header = (id: string, revisionNumber: number, status: string, isCurrent: boolean) => ({
  id,
  quotationId: QUOTATION_ID,
  revisionNumber,
  status,
  currency: 'JOD',
  issuedAt: null,
  expiresAt: null,
  subtotal: '400.0000',
  discountTotal: '0.0000',
  taxTotal: '40.0000',
  grandTotal: '440.0000',
  recordVersion: 1,
  isCurrent,
});

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const okPage = (rows: readonly unknown[]) => ({
  status: 'ok' as const,
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr',
});
const success = (messageKey: string) => ({ status: 'success' as const, messageKey, attempt: 1 });

function decisions(over: Record<string, unknown> = {}) {
  return {
    quotationId: QUOTATION_ID,
    revisionId: ISSUED_ID,
    revisionStatus: 'issued',
    itemCount: 2,
    decidedCount: 0,
    outcome: null,
    decisions: [],
    acceptance: null,
    ...over,
  };
}

function renderDetail(over: Record<string, unknown> = {}, q = quotation()) {
  return renderLtr(
    inBranch(
      <QuotationDetailScreen
        locale="en"
        messages={en}
        quotation={q as never}
        canManage
        canDecide={false}
        canReadLimits={false}
        canReadServices={false}
        {...over}
      />
    )
  );
}

async function renderPage(params: Record<string, string>) {
  const tree = await QuotationDetailPage({ params: Promise.resolve(params) });
  return renderLtr(inBranch(tree as ReactElement));
}

const workOrder = {
  id: WORK_ORDER_ID,
  companyId: 'company-1',
  branchId: TEST_BRANCH.id,
  receptionVisitId: 'r',
  vehicleId: 'v',
  kind: 'ordinary',
  state: 'open',
  partsForwardState: 'none',
  displayNumber: 'WO-000042',
  openedAt: '2026-09-01T08:00:00Z',
  recordVersion: 2,
  customer: {
    partnerId: PARTNER_ID,
    displayName: 'Layla Haddad',
    relationshipRole: 'vehicle_owner',
    hasAdditionalParties: false,
  },
  vehicle: { vehicleId: 'v', registrationPlate: '12-34567', makeModel: 'Toyota Corolla' },
};

/** A moment typed part by part, in English order: day, month, year, hour, minute. */
async function typeMoment(user: ReturnType<typeof userEvent.setup>, key: string, digits: string) {
  const group = screen.getByRole('group', { name: labelled(key) });
  await user.click(within(group).getAllByRole('spinbutton')[0] as HTMLElement);
  await user.keyboard(digits);
}

beforeEach(() => {
  vi.clearAllMocks();
  listRevisions.mockResolvedValue(
    okPage([header(ISSUED_ID, 2, 'issued', true), header(OLD_ID, 1, 'superseded', false)])
  );
  readRevision.mockResolvedValue(
    okRead(
      revision({ id: OLD_ID, revisionNumber: 1, status: 'superseded', lines: [line(LINE_1, 1)] })
    )
  );
  readRevisionDecisions.mockResolvedValue(okRead(decisions()));
  listApprovalLimits.mockResolvedValue(
    okPage([
      {
        id: 'l-1',
        companyId: 'company-1',
        roleId: 'role-1',
        userId: null,
        limitType: 'discount',
        amount: '1000.0000',
        currencyCode: 'JOD',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        recordVersion: 1,
      },
      {
        id: 'l-2',
        companyId: 'company-1',
        roleId: 'role-1',
        userId: null,
        limitType: 'credit',
        amount: '9999.0000',
        currencyCode: 'JOD',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        recordVersion: 1,
      },
    ])
  );
  createQuotationRevision.mockResolvedValue({
    state: success('quotations.revision.created'),
    created: revision({ id: 'rev-new', revisionNumber: 3, status: 'draft' }),
  });
  issueQuotation.mockResolvedValue(success('quotations.issue.success'));
  decideRevision.mockResolvedValue({
    state: success('quotations.decision.success'),
    created: { decision: 'approved', itemsDecided: 2 },
  });
  decideItem.mockResolvedValue({ state: success('quotations.decision.success'), created: {} });
  // What a write reads again before it lets go of its button.
  readQuotation.mockResolvedValue(okRead(quotation()));
});

const region = (key: string) => screen.getByRole('region', { name: EN[key] as string });

describe('the captured figures render as stated', () => {
  it('shows the current revision’s lines and totals from the strings, with the ISO code', async () => {
    renderDetail();
    const current = region('quotations.current.heading');
    const table = within(current).getByRole('table');
    // The captured quantity and the tax fraction, verbatim; the money with its code.
    expect(within(table).getAllByText('2.000').length).toBe(2);
    expect(within(table).getAllByText('0.100000').length).toBe(2);
    expect(within(table).getAllByText(/JOD/).length).toBeGreaterThan(0);
    expect(within(current).queryByText(/10 ?%/)).toBeNull();
    // The four totals, each as the server captured it.
    expect(within(current).getByText(EN['quotations.totals.grand'] as string)).toBeVisible();
    expect(within(current).getAllByText(/440/).length).toBeGreaterThan(0);
    expect(within(current).getByText(EN['quotations.totals.note'] as string)).toBeVisible();
  });

  it('a draft revision says its totals are captured on issue and prints no total', () => {
    renderDetail(
      {},
      quotation({
        currentRevision: revision({
          status: 'draft',
          issuedAt: null,
          subtotal: '0.0000',
          taxTotal: '0.0000',
          grandTotal: '0.0000',
        }),
      })
    );
    const current = region('quotations.current.heading');
    expect(within(current).getByText(EN['quotations.totals.draftNote'] as string)).toBeVisible();
    expect(within(current).queryByText(EN['quotations.totals.grand'] as string)).toBeNull();
    // The lines still carry their captured figures.
    expect(within(current).getByRole('table')).toBeVisible();
  });

  it('lists the revision history and shows a superseded revision on request', async () => {
    const user = userEvent.setup();
    renderDetail();
    await waitFor(() =>
      expect(listRevisions).toHaveBeenCalledWith(QUOTATION_ID, expect.anything(), null)
    );
    const revisions = region('quotations.revisions.heading');
    const grid = await within(revisions).findByRole('grid', {
      name: EN['quotations.revisions.caption'] as string,
    });
    expect(
      await within(grid).findByText(EN['quotations.revisionStatus.superseded'] as string)
    ).toBeVisible();
    const show = within(grid).getByRole('button', { name: `${EN['quotations.revisions.show']} 1` });
    // A choice among the rows: which revision is shown is announced with it.
    expect(show).toHaveAttribute('aria-pressed', 'false');
    await user.click(show);
    await waitFor(() => expect(readRevision).toHaveBeenCalledWith(OLD_ID));
    await waitFor(() =>
      expect(
        within(grid).getByRole('button', { name: `${EN['quotations.revisions.show']} 1` })
      ).toHaveAttribute('aria-pressed', 'true')
    );
    const chosen = await within(revisions).findByRole('region', {
      name: EN['quotations.revisions.chosenHeading'] as string,
    });
    expect(within(chosen).getByRole('table')).toBeVisible();
  });
});

describe('decisions are the server’s outcome, recorded against the presented revision', () => {
  it('renders an undecided revision as pending, with the counts as sent', async () => {
    renderDetail();
    await waitFor(() => expect(readRevisionDecisions).toHaveBeenCalledWith(ISSUED_ID));
    const panel = region('quotations.decisions.heading');
    expect(
      await within(panel).findByText(EN['quotations.outcome.pending'] as string)
    ).toBeVisible();
    expect(within(panel).getByText(EN['quotations.decisions.none'] as string)).toBeVisible();
  });

  it('renders recorded decisions with their evidence and the outcome', async () => {
    readRevisionDecisions.mockResolvedValue(
      okRead(
        decisions({
          decidedCount: 2,
          outcome: 'accepted',
          decisions: [
            {
              decisionId: 'd-1',
              quotationRevisionId: ISSUED_ID,
              quotationItemId: LINE_1,
              lineNumber: 1,
              description: 'Oil change',
              decision: 'approved',
              channel: 'phone',
              decidedAt: '2026-09-05T11:00:00Z',
              recordedBy: 'user-1',
              evidence: [
                {
                  id: 'e-1',
                  evidenceKind: 'verbal',
                  documentVersionId: null,
                  referenceNote: 'Agreed by phone',
                  recordedAt: '2026-09-05T11:00:00Z',
                },
              ],
            },
          ],
        })
      )
    );
    renderDetail();
    const panel = region('quotations.decisions.heading');
    expect(
      await within(panel).findByText(EN['quotations.outcome.accepted'] as string)
    ).toBeVisible();
    expect(within(panel).getByText('Agreed by phone')).toBeVisible();
    expect(within(panel).getByText(EN['quotations.decision.approved'] as string)).toBeVisible();
  });

  it('offers the decision form only with quo.decision.record on the current issued revision', async () => {
    renderDetail({ canDecide: false });
    await waitFor(() => expect(readRevisionDecisions).toHaveBeenCalled());
    expect(
      screen.queryByRole('form', { name: EN['quotations.decide.heading'] as string })
    ).toBeNull();
  });

  it('records a whole-revision decision with the presented revision and the payer', async () => {
    const user = userEvent.setup();
    renderDetail({ canDecide: true });
    const form = await screen.findByRole('form', {
      name: EN['quotations.decide.heading'] as string,
    });
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.decision')),
      'approved'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.channel')),
      'phone'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.evidenceKind')),
      'verbal'
    );
    await user.type(
      within(form).getByLabelText(labelled('quotations.decide.note')),
      'Agreed by phone'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.decide.submit'] as string })
    );
    await waitFor(() => expect(decideRevision).toHaveBeenCalled());
    expect(decideRevision).toHaveBeenCalledWith(ISSUED_ID, {
      decision: 'approved',
      channel: 'phone',
      decidingPartyRef: PARTNER_ID,
      evidence: { evidenceKind: 'verbal', referenceNote: 'Agreed by phone' },
      presentedRevisionId: ISSUED_ID,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('records the decision as NOT the payer’s when the box is cleared', async () => {
    const user = userEvent.setup();
    renderDetail({ canDecide: true });
    const form = await screen.findByRole('form', {
      name: EN['quotations.decide.heading'] as string,
    });
    const byPayer = within(form).getByRole('checkbox', {
      name: EN['quotations.decide.party'] as string,
    });
    expect(byPayer).toBeChecked();
    await user.click(byPayer);
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.decision')),
      'approved'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.channel')),
      'phone'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.decide.submit'] as string })
    );
    await waitFor(() => expect(decideRevision).toHaveBeenCalled());
    expect(decideRevision.mock.calls[0]?.[1]).not.toHaveProperty('decidingPartyRef');
  });

  it('with no paying customer on the quotation, asks nothing about one', async () => {
    renderDetail({ canDecide: true }, quotation({ payerPartnerRef: null }));
    const form = await screen.findByRole('form', {
      name: EN['quotations.decide.heading'] as string,
    });
    expect(within(form).queryByRole('checkbox')).toBeNull();
    expect(within(form).getByText(EN['quotations.decide.noPayer'] as string)).toBeVisible();
  });

  it('records a single-line decision against that line', async () => {
    const user = userEvent.setup();
    renderDetail({ canDecide: true });
    const form = await screen.findByRole('form', {
      name: EN['quotations.decide.heading'] as string,
    });
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.target')),
      LINE_2
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.decision')),
      'rejected'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.channel')),
      'in_person'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.decide.submit'] as string })
    );
    await waitFor(() => expect(decideItem).toHaveBeenCalled());
    expect(decideItem.mock.calls[0]?.[0]).toBe(LINE_2);
    expect((decideItem.mock.calls[0]?.[1] as Record<string, unknown>)['decision']).toBe('rejected');
    expect(decideRevision).not.toHaveBeenCalled();
  });

  it('refuses document evidence without a document version, before any request', async () => {
    const user = userEvent.setup();
    renderDetail({ canDecide: true });
    const form = await screen.findByRole('form', {
      name: EN['quotations.decide.heading'] as string,
    });
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.decision')),
      'approved'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.channel')),
      'email'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.evidenceKind')),
      'document'
    );
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.decide.submit'] as string })
    );
    expect(
      await within(form).findByText(EN['quotations.decide.documentNeeded'] as string)
    ).toBeVisible();
    expect(decideRevision).not.toHaveBeenCalled();
  });
});

describe('the decision form points at what to fix (route sweep B3)', () => {
  it('offers the document box only for document evidence, moves the cursor to it, and withdraws its complaint once typed', async () => {
    const user = userEvent.setup();
    renderDetail({ canDecide: true });
    const form = await screen.findByRole('form', {
      name: EN['quotations.decide.heading'] as string,
    });
    // No evidence chosen: no document box to fill in.
    expect(within(form).queryByTestId('quotation-decide-document')).toBeNull();
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.decision')),
      'approved'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.channel')),
      'email'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.evidenceKind')),
      'document'
    );
    expect(within(form).getByTestId('quotation-decide-document')).toBeVisible();
    const box = within(form).getByLabelText(labelled('quotations.decide.documentVersionId'));
    expect(box).toHaveAccessibleDescription(EN['quotations.decide.documentHelp'] as string);
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.decide.submit'] as string })
    );
    await waitFor(() => expect(box).toHaveFocus());
    expect(box).toHaveAttribute('aria-invalid', 'true');
    await user.type(box, 'a');
    expect(box).not.toHaveAttribute('aria-invalid', 'true');
    expect(within(form).queryByText(EN['quotations.decide.documentNeeded'] as string)).toBeNull();
    // Another kind of evidence: the box goes, and what was typed goes with it.
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.evidenceKind')),
      'verbal'
    );
    expect(within(form).queryByTestId('quotation-decide-document')).toBeNull();
    expect(decideRevision).not.toHaveBeenCalled();
  });
});

describe('guarded writes send the QUOTATION version and renew it', () => {
  it('issues the current draft with the quotation’s recordVersion, then refreshes', async () => {
    const user = userEvent.setup();
    renderDetail({}, quotation({ currentRevision: revision({ status: 'draft', issuedAt: null }) }));
    const form = screen.getByRole('form', { name: EN['quotations.issue.heading'] as string });
    // The expiry is typed on the quotation's own branch clock (Asia/Riyadh, +03:00).
    await typeMoment(user, 'quotations.issue.expiresAt', '011220261000');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    // Issuing asks first; nothing is sent until the question is answered.
    const dialog = await screen.findByRole('alertdialog', {
      name: (EN['quotations.issue.confirmTitle'] as string).replace('{number}', '2'),
    });
    expect(issueQuotation).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    await waitFor(() => expect(issueQuotation).toHaveBeenCalled());
    const [id, body, ifMatch] = issueQuotation.mock.calls[0] as [
      string,
      Record<string, unknown>,
      number,
    ];
    expect(id).toBe(QUOTATION_ID);
    expect(body['revisionId']).toBe(ISSUED_ID);
    // An instant with the branch's offset for that moment, as the route accepts it.
    expect(body['expiresAt']).toBe('2026-12-01T10:00:00+03:00');
    // The QUOTATION's version (5), never the revision's own (1).
    expect(ifMatch).toBe(5);
    // The quotation is read again before the question lets go.
    await waitFor(() => expect(readQuotation).toHaveBeenCalledWith(QUOTATION_ID));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  /*
   * An expiry that is only partly typed, or typed whole but impossible, holds no
   * instant: the field's value is `''`, the same as no expiry at all. Issuing is
   * refused on the field instead of going out without the expiry the operator
   * was typing. Falsified by restoring the guard `expiresAt !== '' && problem
   * !== null` (and, for the partial entry, by removing the field's `'incomplete'`
   * report): the question then opens and the issue is sent with no expiry.
   */
  async function refusedExpiry(user: ReturnType<typeof userEvent.setup>, digits: string) {
    renderDetail({}, quotation({ currentRevision: revision({ status: 'draft', issuedAt: null }) }));
    const form = screen.getByRole('form', { name: EN['quotations.issue.heading'] as string });
    await typeMoment(user, 'quotations.issue.expiresAt', digits);
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    const group = screen.getByRole('group', { name: labelled('quotations.issue.expiresAt') });
    await waitFor(() => expect(group).toHaveAttribute('aria-invalid', 'true'));
    expect(within(form).getByText(EN['quotations.issue.dateFormat'] as string)).toBeInTheDocument();
    // The cursor is put back into the expiry, and nothing was asked or sent.
    await waitFor(() => expect(group.contains(document.activeElement)).toBe(true));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(issueQuotation).not.toHaveBeenCalled();
    return { form, group };
  }

  it('refuses a partly typed expiry on the field, keeps what was typed, and issues once it is finished', async () => {
    const user = userEvent.setup();
    const { form, group } = await refusedExpiry(user, '0112');
    // The cursor waits on the empty year; finishing the entry withdraws the complaint.
    await user.keyboard('20261000');
    await waitFor(() => expect(group).not.toHaveAttribute('aria-invalid'));
    expect(within(form).queryByText(EN['quotations.issue.dateFormat'] as string)).toBeNull();
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    await waitFor(() => expect(issueQuotation).toHaveBeenCalled());
    expect((issueQuotation.mock.calls[0]?.[1] as Record<string, unknown>)['expiresAt']).toBe(
      '2026-12-01T10:00:00+03:00'
    );
  });

  it('refuses an impossible expiry on the field and sends nothing', async () => {
    const user = userEvent.setup();
    const { form } = await refusedExpiry(user, '310220261000');
    // Asking again with the entry unchanged is refused again.
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(issueQuotation).not.toHaveBeenCalled();
  });

  it('stays busy until the quotation has been read again, so a second press cannot send the spent version', async () => {
    let answer: (value: unknown) => void = () => undefined;
    readQuotation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const user = userEvent.setup();
    renderDetail({}, quotation({ currentRevision: revision({ status: 'draft', issuedAt: null }) }));
    const form = screen.getByRole('form', { name: EN['quotations.issue.heading'] as string });
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    await waitFor(() => expect(issueQuotation).toHaveBeenCalledTimes(1));
    // The re-read is still out: the question is still up, and its buttons are held.
    await waitFor(() =>
      expect(
        within(screen.getByRole('alertdialog')).getByRole('button', {
          name: EN['overlay.working'] as string,
        })
      ).toBeDisabled()
    );
    expect(
      within(screen.getByRole('alertdialog')).getByRole('button', {
        name: EN['overlay.cancel'] as string,
      })
    ).toBeDisabled();
    answer(okRead(quotation({ recordVersion: 6 })));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(issueQuotation).toHaveBeenCalledTimes(1);
  });

  it('without the quotation’s branch clock, offers no expiry and still issues without one', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <QuotationDetailScreen
          locale="en"
          messages={en}
          quotation={
            quotation({ currentRevision: revision({ status: 'draft', issuedAt: null }) }) as never
          }
          canManage
          canDecide={false}
          canReadLimits={false}
          canReadServices={false}
        />,
        {
          snapshot: branchSnapshot([
            { ...TEST_BRANCH, id: '99999999-0000-4000-8000-000000000009' },
          ]),
        }
      )
    );
    expect(screen.getByTestId('quotation-issue-no-clock')).toHaveTextContent(
      EN['quotations.issue.zoneUnknown'] as string
    );
    expect(
      screen.queryByRole('group', { name: labelled('quotations.issue.expiresAt') })
    ).toBeNull();
    const form = screen.getByRole('form', { name: EN['quotations.issue.heading'] as string });
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    await waitFor(() => expect(issueQuotation).toHaveBeenCalled());
    expect(issueQuotation.mock.calls[0]?.[1]).toEqual({ revisionId: ISSUED_ID });
  });

  describe('the version an issue sends is the one its work was based on (useEditBaseline)', () => {
    const draft = () =>
      quotation({ currentRevision: revision({ status: 'draft', issuedAt: null }) });
    const screenFor = (q: ReturnType<typeof quotation>) =>
      withMui(
        inBranch(
          <QuotationDetailScreen
            locale="en"
            messages={en}
            quotation={q as never}
            canManage
            canDecide={false}
            canReadLimits={false}
            canReadServices={false}
          />
        )
      );

    async function issueNow(user: ReturnType<typeof userEvent.setup>) {
      const form = screen.getByRole('form', { name: EN['quotations.issue.heading'] as string });
      await user.click(
        within(form).getByRole('button', { name: EN['quotations.issue.submit'] as string })
      );
      const dialog = await screen.findByRole('alertdialog');
      await user.click(
        within(dialog).getByRole('button', { name: EN['quotations.issue.submit'] as string })
      );
      await waitFor(() => expect(issueQuotation).toHaveBeenCalledTimes(1));
    }

    it('with an expiry typed, a refresh that moves the quotation on does not move the version sent', async () => {
      const user = userEvent.setup();
      const view = renderLtrBare(screenFor(draft()));
      await typeMoment(user, 'quotations.issue.expiresAt', '011220261000');
      // Another tab moved the quotation on; the page read now holds version 6.
      view.rerender(screenFor({ ...draft(), recordVersion: 6 }));
      await issueNow(user);
      // The work was built on version 5, so version 5 is sent — and a server
      // that has moved on refuses it as a conflict rather than applying it.
      expect(issueQuotation.mock.calls[0]?.[2]).toBe(5);
    });

    it('with nothing typed, the refreshed quotation’s version is the one sent', async () => {
      const user = userEvent.setup();
      const view = renderLtrBare(screenFor(draft()));
      view.rerender(screenFor({ ...draft(), recordVersion: 6 }));
      await issueNow(user);
      expect(issueQuotation.mock.calls[0]?.[2]).toBe(6);
    });
  });

  it('says there is no draft to issue when the newest revision is the issued one', async () => {
    renderDetail();
    expect(await screen.findByText(EN['quotations.issue.noDraft'] as string)).toBeVisible();
  });

  it('a conflict on issue renders as a conflict and does not refresh', async () => {
    issueQuotation.mockResolvedValue({ status: 'conflict', correlationId: 'corr-9', attempt: 1 });
    const user = userEvent.setup();
    renderDetail({}, quotation({ currentRevision: revision({ status: 'draft', issuedAt: null }) }));
    const form = screen.getByRole('form', { name: EN['quotations.issue.heading'] as string });
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    const dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    expect(await within(form).findByText(EN['quotations.detail.conflict'] as string)).toBeVisible();
    expect(within(form).getByText('corr-9')).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
    // The way out of a conflict is to look again: offered beside it.
    await userEvent
      .setup()
      .click(within(form).getByRole('button', { name: EN['quotations.detail.reload'] as string }));
    await waitFor(() => expect(readQuotation).toHaveBeenCalledWith(QUOTATION_ID));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('adds a revision from lines with the quotation’s recordVersion', async () => {
    const user = userEvent.setup();
    renderDetail();
    const form = screen.getByRole('form', { name: EN['quotations.revise.heading'] as string });
    await user.type(
      within(form).getByLabelText(labelled('pricing.picker.serviceReference')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '3');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.revise.submit'] as string })
    );
    await waitFor(() => expect(createQuotationRevision).toHaveBeenCalled());
    expect(createQuotationRevision).toHaveBeenCalledWith(
      QUOTATION_ID,
      { lines: [{ serviceId: SERVICE_ID, quantity: '3' }] },
      5
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('sends a discounted revision with nobody named: whoever is signed in is the one asking', async () => {
    const user = userEvent.setup();
    renderDetail();
    const form = screen.getByRole('form', { name: EN['quotations.revise.heading'] as string });
    expect(within(form).queryByLabelText(/requested by/i)).toBeNull();
    expect(
      within(form).getByText(EN['quotations.build.discountApprovalHelp'] as string)
    ).toBeVisible();
    await user.type(
      within(form).getByLabelText(labelled('pricing.picker.serviceReference')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '3');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.revise.submit'] as string })
    );
    await waitFor(() => expect(createQuotationRevision).toHaveBeenCalled());
    expect(Object.keys(createQuotationRevision.mock.calls[0]?.[1] as object)).not.toContain(
      'discountRequestedBy'
    );
  });

  it('states an inexact line above the lines, with the revision draft still filled in', async () => {
    /*
     * `quo.quotation-revise` prices each line and refuses one whose quantity
     * times the unit price cannot be held exactly, against
     * `body.lines[0].quantity`. Only the LEAF of that path survives the client,
     * so the line it belonged to is gone by the time a control could be found —
     * the sentence is stated over the lines rather than guessed onto one.
     */
    createQuotationRevision.mockResolvedValue({
      state: {
        status: 'invalid',
        messageKey: 'form.formError',
        fieldErrors: { quantity: 'form.violation.inexact_line_base' },
        correlationId: 'corr-inexact',
        attempt: 1,
      },
      created: null,
    });
    const user = userEvent.setup();
    renderDetail();
    const form = screen.getByRole('form', { name: EN['quotations.revise.heading'] as string });
    await user.type(
      within(form).getByLabelText(labelled('pricing.picker.serviceReference')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '0.333');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.revise.submit'] as string })
    );
    await waitFor(() => expect(createQuotationRevision).toHaveBeenCalledTimes(1));
    expect(
      await within(form).findByText(EN['form.violation.inexact_line_base'] as string)
    ).toBeVisible();
    expect(within(form).getByLabelText(labelled('quotations.lines.quantity'))).toHaveValue('0.333');
    expect(within(form).getByLabelText(labelled('pricing.picker.serviceReference'))).toHaveValue(
      SERVICE_ID
    );
  });

  it('states a discount finer than the currency above the lines, with what was typed kept (D1)', async () => {
    /*
     * A fixed discount is money, so it must fit the quotation currency's minor unit
     * (ADR-023, D1) — which only the server knows once it has priced the lines. The
     * refusal arrives against `body.lines[0].discount`, as the leaf `discount`, and
     * is stated over the lines exactly like the quantity refusal above.
     */
    createQuotationRevision.mockResolvedValue({
      state: {
        status: 'invalid',
        messageKey: 'form.formError',
        fieldErrors: { discount: 'form.violation.minor_unit_scale' },
        correlationId: 'corr-minor-unit',
        attempt: 1,
      },
      created: null,
    });
    const user = userEvent.setup();
    renderDetail();
    const form = screen.getByRole('form', { name: EN['quotations.revise.heading'] as string });
    await user.type(
      within(form).getByLabelText(labelled('pricing.picker.serviceReference')),
      SERVICE_ID
    );
    await user.type(within(form).getByLabelText(labelled('quotations.lines.quantity')), '1');
    await user.type(within(form).getByLabelText(labelled('quotations.lines.discount')), '0.0005');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.revise.submit'] as string })
    );
    await waitFor(() => expect(createQuotationRevision).toHaveBeenCalledTimes(1));
    expect(
      await within(form).findByText(EN['form.violation.minor_unit_scale'] as string)
    ).toBeVisible();
    expect(within(form).getByLabelText(labelled('quotations.lines.discount'))).toHaveValue(
      '0.0005'
    );
  });

  it('marks the discount of the line the server names: red, described, focused, and cleared once corrected (D1)', async () => {
    /*
     * The adapter keeps the position of `body.lines[1].discount` as
     * `lines.1.discount`, so on a quotation with two lines the sentence goes
     * beside the SECOND line's discount — never the first, and not only above
     * the lines — with `aria-invalid` on that box and the cursor in it. What was
     * typed stays, and correcting the figure withdraws the complaint.
     */
    createQuotationRevision.mockResolvedValue({
      state: {
        status: 'invalid',
        messageKey: 'form.formError',
        fieldErrors: {
          discount: 'form.violation.minor_unit_scale',
          'lines.1.discount': 'form.violation.minor_unit_scale',
        },
        correlationId: 'corr-minor-unit-2',
        attempt: 1,
      },
      created: null,
    });
    const user = userEvent.setup();
    renderDetail();
    const form = screen.getByRole('form', { name: EN['quotations.revise.heading'] as string });
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.lines.add'] as string })
    );
    const lineGroup = (n: number) =>
      within(form).getByRole('group', { name: `${EN['quotations.lines.one'] as string} ${n}` });
    for (const n of [1, 2]) {
      const group = within(lineGroup(n));
      await user.type(
        group.getByLabelText(labelled('pricing.picker.serviceReference')),
        SERVICE_ID
      );
      await user.type(group.getByLabelText(labelled('quotations.lines.quantity')), '1');
    }
    await user.type(
      within(lineGroup(1)).getByLabelText(labelled('quotations.lines.discount')),
      '0.500'
    );
    const offending = within(lineGroup(2)).getByLabelText(
      labelled('quotations.lines.discount')
    ) as HTMLInputElement;
    await user.type(offending, '0.0005');
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.revise.submit'] as string })
    );
    await waitFor(() => expect(createQuotationRevision).toHaveBeenCalledTimes(1));

    const sentence = EN['form.violation.minor_unit_scale'] as string;
    expect(await within(lineGroup(2)).findByText(sentence)).toBeVisible();
    expect(offending).toHaveAttribute('aria-invalid', 'true');
    await waitFor(() => expect(offending).toHaveFocus());
    expect(offending.value).toBe('0.0005');
    // Only that line: the first discount is not marked, and the sentence is not
    // repeated above the lines.
    const first = within(lineGroup(1)).getByLabelText(labelled('quotations.lines.discount'));
    expect(first).not.toHaveAttribute('aria-invalid', 'true');
    expect(within(lineGroup(1)).queryByText(sentence)).toBeNull();
    expect(within(form).getAllByText(sentence)).toHaveLength(1);

    // Correcting the figure withdraws the complaint.
    await user.clear(offending);
    await user.type(offending, '0.500');
    await waitFor(() => expect(offending).not.toHaveAttribute('aria-invalid', 'true'));
    expect(within(form).queryByText(sentence)).toBeNull();
  });
});

/**
 * The discount a draft carries, and what it means for issuing (P1-32-PRE-OD-DISC-01).
 *
 * The request is shown with its state, who asked and when; the operator's own request
 * says it waits for ANOTHER approver; and a draft whose discount is waiting or was
 * turned down is not offered for issue — the page says why instead.
 */
describe('a discount waiting for approval is shown, and holds the draft back from issue', () => {
  it('the operator’s own request says it waits for another approver, and issue is not offered', () => {
    renderDetail({}, draftWith({ requestedByCaller: true }));
    const note = screen.getByTestId('discount-approval-note');
    expect(
      within(note).getByText(EN['quotations.discountApproval.status.pending'] as string)
    ).toBeVisible();
    expect(within(note).getByText('Omar Saleh')).toBeVisible();
    expect(
      within(note).getByText(EN['quotations.discountApproval.waitingForAnother'] as string, {
        exact: false,
      })
    ).toBeVisible();
    expect(screen.getByTestId('issue-blocked-by-discount')).toHaveTextContent(
      EN['quotations.issue.discountPending'] as string
    );
    expect(
      screen.queryByRole('button', { name: EN['quotations.issue.submit'] as string })
    ).toBeNull();
  });

  it('somebody else’s request says another person must approve it, and links to the approvals', () => {
    renderDetail({}, draftWith({}));
    const note = screen.getByTestId('discount-approval-note');
    expect(
      within(note).getByText(EN['quotations.discountApproval.waiting'] as string, {
        exact: false,
      })
    ).toBeVisible();
    expect(
      within(note).getByRole('link', {
        name: EN['quotations.discountApproval.openApprovals'] as string,
      })
    ).toHaveAttribute('href', '/en/quotations');
  });

  it('a turned-down discount says so, with who decided and why, and the draft is not offered for issue', () => {
    renderDetail(
      {},
      draftWith({
        status: 'rejected',
        decidedBy: { id: 'bbbbbbbb-0000-4000-8000-000000000002', displayName: 'Nadia Karim' },
        decidedAt: '2026-09-21T09:00:00Z',
        decisionReason: 'More than this job can carry',
      })
    );
    const note = screen.getByTestId('discount-approval-note');
    expect(
      within(note).getByText(EN['quotations.discountApproval.status.rejected'] as string)
    ).toBeVisible();
    expect(within(note).getByText('Nadia Karim')).toBeVisible();
    expect(within(note).getByText('More than this job can carry')).toBeVisible();
    expect(screen.getByTestId('issue-blocked-by-discount')).toHaveTextContent(
      EN['quotations.issue.discountRejected'] as string
    );
  });

  it('a request a newer draft replaced says so, and this draft is not offered for issue', () => {
    renderDetail(
      {},
      draftWith({
        status: 'superseded',
        supersededAt: '2026-09-22T09:00:00Z',
        canApprove: false,
        cannotApproveReason: 'not_pending',
        canReject: false,
      })
    );
    expect(
      within(screen.getByTestId('discount-approval-note')).getByText(
        EN['quotations.discountApproval.status.superseded'] as string
      )
    ).toBeVisible();
    expect(screen.getByTestId('issue-blocked-by-discount')).toHaveTextContent(
      EN['quotations.issue.discountSuperseded'] as string
    );
    expect(
      screen.queryByRole('button', { name: EN['quotations.issue.submit'] as string })
    ).toBeNull();
  });

  it('an approved discount lets the draft be issued', () => {
    renderDetail(
      {},
      draftWith({
        status: 'approved',
        decidedBy: { id: 'bbbbbbbb-0000-4000-8000-000000000002', displayName: 'Nadia Karim' },
        decidedAt: '2026-09-21T09:00:00Z',
        canApprove: false,
        cannotApproveReason: 'not_pending',
        canReject: false,
      })
    );
    expect(
      within(screen.getByTestId('discount-approval-note')).getByText(
        EN['quotations.discountApproval.status.approved'] as string
      )
    ).toBeVisible();
    expect(screen.queryByTestId('issue-blocked-by-discount')).toBeNull();
    expect(
      screen.getByRole('button', { name: EN['quotations.issue.submit'] as string })
    ).toBeVisible();
  });
});

/**
 * A revision added after an issue is a later DRAFT (P1-32-PRE-OD-QRI).
 *
 * The quotation's current revision is set only by issuing, so once revision 2 is
 * issued the detail read keeps naming it while revision 3 waits as a draft. The
 * server issues that draft; the screen must find it and offer it, held back by its
 * own discount request exactly as a first draft is. Falsified by restoring the
 * current-revision-only lookup: the panel then says there is no draft to issue.
 */
describe('a draft added after an issue can be issued from the screen', () => {
  const LATER_ID = '99999999-3333-4333-8333-333333333333';
  const laterDraft = (over: Record<string, unknown> = {}) =>
    revision({ id: LATER_ID, revisionNumber: 3, status: 'draft', issuedAt: null, ...over });

  function withLaterDraft(over: Record<string, unknown> = {}) {
    listRevisions.mockResolvedValue(
      okPage([header(LATER_ID, 3, 'draft', false), header(ISSUED_ID, 2, 'issued', true)])
    );
    readRevision.mockImplementation((id: string) =>
      Promise.resolve(id === LATER_ID ? okRead(laterDraft(over)) : okRead(revision()))
    );
  }

  it('offers the later draft and issues that revision with the quotation’s version', async () => {
    withLaterDraft();
    const user = userEvent.setup();
    renderDetail();
    const form = await screen.findByRole('form', {
      name: EN['quotations.issue.heading'] as string,
    });
    expect(within(form).getByText('3')).toBeVisible();
    expect(screen.queryByText(EN['quotations.issue.noDraft'] as string)).toBeNull();
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    const dialog = await screen.findByRole('alertdialog', {
      name: (EN['quotations.issue.confirmTitle'] as string).replace('{number}', '3'),
    });
    await user.click(
      within(dialog).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    await waitFor(() => expect(issueQuotation).toHaveBeenCalledTimes(1));
    const [id, body, ifMatch] = issueQuotation.mock.calls[0] as [
      string,
      Record<string, unknown>,
      number,
    ];
    expect(id).toBe(QUOTATION_ID);
    expect(body['revisionId']).toBe(LATER_ID);
    expect(ifMatch).toBe(5);
    // The quotation is read again, and the later draft looked for again, before the
    // question lets go.
    await waitFor(() => expect(readQuotation).toHaveBeenCalledWith(QUOTATION_ID));
    await waitFor(() =>
      expect(readRevision.mock.calls.filter(([read]) => read === LATER_ID).length).toBeGreaterThan(
        1
      )
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it.each([
    ['pending', 'quotations.issue.discountPending'],
    ['withdrawn', 'quotations.issue.discountWithdrawn'],
  ])('a %s discount on the later draft still holds it back from issue', async (status, key) => {
    withLaterDraft({
      discountApproval: discountApproval({ status, revisionId: LATER_ID, revisionNumber: 3 }),
    });
    renderDetail();
    expect(await screen.findByTestId('issue-blocked-by-discount')).toHaveTextContent(
      EN[key] as string
    );
    expect(
      screen.queryByRole('button', { name: EN['quotations.issue.submit'] as string })
    ).toBeNull();
    expect(issueQuotation).not.toHaveBeenCalled();
  });

  it('a never-issued quotation offers its first draft at once, without looking further', () => {
    renderDetail(
      {},
      quotation({
        status: 'draft',
        currentRevisionId: null,
        currentRevision: revision({ status: 'draft', issuedAt: null }),
      })
    );
    const form = screen.getByRole('form', { name: EN['quotations.issue.heading'] as string });
    expect(within(form).getByText('2')).toBeVisible();
    expect(readRevision).not.toHaveBeenCalled();
  });

  it('when the later draft cannot be looked for, says so and offers a retry instead of “no draft”', async () => {
    listRevisions.mockResolvedValue({
      status: 'unavailable',
      rows: [],
      nextCursor: null,
      hasMore: false,
      correlationId: 'corr-7',
    });
    renderDetail();
    const issue = region('quotations.issue.heading');
    expect(
      await within(issue).findByText(EN['quotations.revisions.unavailable'] as string)
    ).toBeVisible();
    expect(within(issue).queryByText(EN['quotations.issue.noDraft'] as string)).toBeNull();
    expect(within(issue).queryByRole('form')).toBeNull();
  });

  it('speaks Arabic: the later draft is offered for issue', async () => {
    withLaterDraft();
    const AR = ar as Record<string, string>;
    renderRtlBare(
      withMui(
        inBranch(
          <QuotationDetailScreen
            locale="ar"
            messages={ar}
            quotation={quotation() as never}
            canManage
            canDecide={false}
            canReadLimits={false}
            canReadServices={false}
          />,
          { locale: 'ar' }
        ),
        'ar'
      )
    );
    const form = await screen.findByRole('form', {
      name: AR['quotations.issue.heading'] as string,
    });
    expect(
      within(form).getByText(AR['quotations.issue.draftLabel'] as string, { exact: false })
    ).toBeVisible();
    expect(
      within(form).getByRole('button', { name: AR['quotations.issue.submit'] as string })
    ).toBeVisible();
    expect(screen.queryByText(AR['quotations.issue.noDraft'] as string)).toBeNull();
  });
});

describe('what is offered follows the row and the operator', () => {
  it('a closed quotation offers no writes and says so', async () => {
    renderDetail({ canDecide: true }, quotation({ status: 'accepted' }));
    expect(screen.getByText(EN['quotations.detail.closedNote'] as string)).toBeVisible();
    expect(screen.queryByText(EN['quotations.issue.heading'] as string)).toBeNull();
    expect(screen.queryByText(EN['quotations.revise.heading'] as string)).toBeNull();
    await waitFor(() => expect(readRevisionDecisions).toHaveBeenCalled());
    expect(
      screen.queryByRole('form', { name: EN['quotations.decide.heading'] as string })
    ).toBeNull();
  });

  it('without quo.quotation.manage, offers neither issue nor revision', () => {
    renderDetail({ canManage: false });
    expect(screen.queryByText(EN['quotations.issue.heading'] as string)).toBeNull();
    expect(screen.queryByText(EN['quotations.revise.heading'] as string)).toBeNull();
  });
});

describe('approval limits appear only under their own code', () => {
  it('without iam.approval.manage, says the limits cannot be shown and asks for none', () => {
    renderDetail({ canReadLimits: false });
    expect(screen.getByText(EN['quotations.limits.noPermission'] as string)).toBeVisible();
    expect(listApprovalLimits).not.toHaveBeenCalled();
  });

  it('with it, lists the company’s DISCOUNT limits as the server states them', async () => {
    renderDetail({ canReadLimits: true });
    await waitFor(() => expect(listApprovalLimits).toHaveBeenCalled());
    const request = listApprovalLimits.mock.calls[0]?.[0] as {
      filters: { key: string; value: string }[];
    };
    expect(request.filters).toEqual([{ key: 'companyId', value: 'company-1' }]);
    const panel = region('quotations.limits.heading');
    const table = await within(panel).findByRole('table');
    expect(within(table).getByText(/1,?000/)).toBeVisible();
    // The credit limit is not a discount limit and is not shown as one.
    expect(within(table).queryByText(/9,?999/)).toBeNull();
  });
});

describe('the /quotations/[quotationId] route page renders the read as what it was', () => {
  const failed = (status: string) => ({ status, correlationId: 'corr-p' });

  it('refuses without quo.quotation.read, before the read', async () => {
    PERMISSIONS = [];
    await renderPage({ locale: 'en', quotationId: QUOTATION_ID });
    expect(screen.getByText(EN['state.denied.title'] as string)).toBeVisible();
    expect(readQuotation).not.toHaveBeenCalled();
  });

  it.each([
    ['not-found', 'state.notFound.title'],
    ['denied', 'state.denied.title'],
    ['expired', 'state.expired.title'],
    ['unavailable', 'state.unavailable.title'],
    ['error', 'state.error.title'],
  ])('a %s read renders that state and nothing else', async (status, key) => {
    PERMISSIONS = ['quo.quotation.read'];
    readQuotation.mockResolvedValue(failed(status));
    await renderPage({ locale: 'en', quotationId: QUOTATION_ID });
    expect(screen.getByText(EN[key] as string)).toBeVisible();
    expect(screen.queryByText('QUO-000001')).toBeNull();
  });

  it('renders the quotation with the capabilities the session holds', async () => {
    PERMISSIONS = ['quo.quotation.read', 'quo.quotation.manage', 'quo.decision.record'];
    readQuotation.mockResolvedValue(okRead(quotation()));
    await renderPage({ locale: 'en', quotationId: QUOTATION_ID });
    expect(readQuotation).toHaveBeenCalledWith(QUOTATION_ID);
    // Without the work-order read the job is not read, and nothing prints a reference.
    expect(readWorkOrderDetail).not.toHaveBeenCalled();
    const summary = region('quotations.detail.summaryHeading');
    expect(summary).toBeVisible();
    expect(summary.textContent).not.toContain(WORK_ORDER_ID);
    expect(summary.textContent).not.toContain(PARTNER_ID);
    expect(
      within(summary).getByText(EN['quotations.detail.payerNotNamed'] as string)
    ).toBeVisible();
    expect(screen.getByText(EN['quotations.revise.heading'] as string)).toBeVisible();
    expect(
      await screen.findByRole('form', { name: EN['quotations.decide.heading'] as string })
    ).toBeVisible();
  });

  it('with the work-order read, names the job by its number and the payer by name', async () => {
    PERMISSIONS = ['quo.quotation.read', 'wo.work_order.read'];
    readQuotation.mockResolvedValue(okRead(quotation()));
    readWorkOrderDetail.mockResolvedValue(
      okRead({ workOrder, jobs: [], nextStates: [], reachableStates: [] })
    );
    await renderPage({ locale: 'en', quotationId: QUOTATION_ID });
    expect(readWorkOrderDetail).toHaveBeenCalledWith(WORK_ORDER_ID);
    const summary = region('quotations.detail.summaryHeading');
    expect(within(summary).getByRole('link', { name: 'WO-000042' })).toHaveAttribute(
      'href',
      `/en/work-orders/${WORK_ORDER_ID}`
    );
    expect(within(summary).getByText('Layla Haddad')).toBeVisible();
    expect(summary.textContent).not.toContain(WORK_ORDER_ID);
    expect(summary.textContent).not.toContain(PARTNER_ID);
  });

  it('a job that could not be read is linked in words, never by its reference', async () => {
    PERMISSIONS = ['quo.quotation.read', 'wo.work_order.read'];
    readQuotation.mockResolvedValue(okRead(quotation()));
    readWorkOrderDetail.mockResolvedValue({ status: 'denied', correlationId: 'corr-wo' });
    await renderPage({ locale: 'en', quotationId: QUOTATION_ID });
    const summary = region('quotations.detail.summaryHeading');
    expect(
      within(summary).getByRole('link', { name: EN['quotations.list.openWorkOrder'] as string })
    ).toBeVisible();
    expect(summary.textContent).not.toContain(WORK_ORDER_ID);
  });

  it('a locale it does not serve is not found', async () => {
    PERMISSIONS = ['quo.quotation.read'];
    await expect(renderPage({ locale: 'xx', quotationId: QUOTATION_ID })).rejects.toThrow(
      'notFound'
    );
  });
});

/**
 * The requester withdraws their own pending discount request (ADR-023 D3), and the
 * note says when another person must approve because the requester set the threshold
 * or a price themselves (ADR-023 D8).
 */
describe('the requester withdraws their own discount request, and the note says why another person approves', () => {
  const OWN_PENDING = {
    requestedByCaller: true,
    canWithdraw: true,
    cannotApproveReason: 'own_request',
    recordVersion: 3,
  };
  const withdrawButton = () =>
    within(screen.getByTestId('discount-approval-note')).queryByRole('button', {
      name: EN['quotations.discountApproval.withdraw.action'] as string,
    });

  it('asks first, sends the request’s own version, and reads the quotation again', async () => {
    withdrawDiscountApproval.mockResolvedValue({
      state: success('quotations.discountApproval.withdrawSuccess'),
      created: { discountApproval: discountApproval({ status: 'withdrawn' }), replayed: false },
    });
    const user = userEvent.setup();
    renderDetail({}, draftWith(OWN_PENDING));
    const note = screen.getByTestId('discount-approval-note');
    expect(
      within(note).getByText(EN['quotations.discountApproval.withdraw.explain'] as string)
    ).toBeVisible();

    // Cancelling sends nothing.
    await user.click(withdrawButton() as HTMLElement);
    let dialog = await screen.findByRole('alertdialog');
    expect(
      within(dialog).getByText(EN['quotations.discountApproval.withdraw.confirmTitle'] as string)
    ).toBeVisible();
    expect(
      within(dialog).getByText(EN['quotations.discountApproval.withdraw.confirmExplain'] as string)
    ).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: EN['overlay.cancel'] as string }));
    expect(withdrawDiscountApproval).not.toHaveBeenCalled();

    await user.click(withdrawButton() as HTMLElement);
    dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: EN['quotations.discountApproval.withdraw.action'] as string,
      })
    );
    await waitFor(() => expect(withdrawDiscountApproval).toHaveBeenCalledTimes(1));
    expect(withdrawDiscountApproval).toHaveBeenCalledWith(
      '66666666-6666-4666-8666-666666666666',
      3
    );
    await waitFor(() => expect(readQuotation).toHaveBeenCalledWith(QUOTATION_ID));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(notifyActionResult).toHaveBeenCalledWith(
      expect.objectContaining({ messageKey: 'quotations.discountApproval.withdrawSuccess' }),
      expect.anything()
    );
  });

  it('offers no withdrawal for somebody else’s request, nor without the quotation write code', () => {
    const first = renderDetail({}, draftWith({ canWithdraw: false }));
    expect(withdrawButton()).toBeNull();
    first.unmount();
    renderDetail({ canManage: false }, draftWith(OWN_PENDING));
    expect(withdrawButton()).toBeNull();
  });

  it('puts a refusal by rule in words, and a stale version as a conflict with a way out', async () => {
    withdrawDiscountApproval.mockResolvedValueOnce({
      state: {
        status: 'conflict',
        messageKey: 'form.violation.discount_approval_already_decided',
        correlationId: 'corr-w1',
        attempt: 1,
      },
      created: null,
    });
    const user = userEvent.setup();
    renderDetail({}, draftWith(OWN_PENDING));
    await user.click(withdrawButton() as HTMLElement);
    let dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: EN['quotations.discountApproval.withdraw.action'] as string,
      })
    );
    const note = screen.getByTestId('discount-approval-note');
    expect(
      await within(note).findByText(
        EN['form.violation.discount_approval_already_decided'] as string
      )
    ).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();

    withdrawDiscountApproval.mockResolvedValueOnce({
      state: { status: 'conflict', correlationId: 'corr-w2', attempt: 1 },
      created: null,
    });
    await user.click(withdrawButton() as HTMLElement);
    dialog = await screen.findByRole('alertdialog');
    await user.click(
      within(dialog).getByRole('button', {
        name: EN['quotations.discountApproval.withdraw.action'] as string,
      })
    );
    expect(await within(note).findByText(EN['quotations.detail.conflict'] as string)).toBeVisible();
    await user.click(
      within(note).getByRole('button', { name: EN['quotations.detail.reload'] as string })
    );
    await waitFor(() => expect(readQuotation).toHaveBeenCalledWith(QUOTATION_ID));
  });

  it('a withdrawn request says so and who withdrew it, and the draft is not offered for issue', () => {
    renderDetail(
      {},
      draftWith({
        status: 'withdrawn',
        requestedByCaller: true,
        cannotApproveReason: 'not_pending',
        withdrawnBy: { id: 'aaaaaaaa-0000-4000-8000-000000000001', displayName: 'Omar Saleh' },
        withdrawnAt: '2026-09-21T10:00:00Z',
      })
    );
    const note = screen.getByTestId('discount-approval-note');
    expect(
      within(note).getByText(EN['quotations.discountApproval.status.withdrawn'] as string)
    ).toBeVisible();
    expect(
      within(note).getByText(EN['quotations.discountApproval.withdrawnBy'] as string)
    ).toBeVisible();
    expect(
      within(note).getByText(EN['quotations.discountApproval.withdrawnNext'] as string)
    ).toBeVisible();
    expect(withdrawButton()).toBeNull();
    expect(screen.getByTestId('issue-blocked-by-discount')).toHaveTextContent(
      EN['quotations.issue.discountWithdrawn'] as string
    );
  });

  it('says when the requester’s own threshold or price is why another person approves', () => {
    const first = renderDetail({}, draftWith({ requesterSetPolicy: true }));
    expect(screen.getByTestId('discount-approval-own-policy')).toHaveTextContent(
      EN['quotations.discountApproval.ownPolicy'] as string
    );
    expect(screen.queryByTestId('discount-approval-own-price')).toBeNull();
    first.unmount();
    renderDetail({}, draftWith({ requesterSetPrice: true }));
    expect(screen.getByTestId('discount-approval-own-price')).toHaveTextContent(
      EN['quotations.discountApproval.ownPrice'] as string
    );
    expect(screen.queryByTestId('discount-approval-own-policy')).toBeNull();
  });

  it('speaks Arabic: the withdrawal and the reason are in Arabic', () => {
    const AR = ar as Record<string, string>;
    renderRtlBare(
      withMui(
        inBranch(
          <QuotationDetailScreen
            locale="ar"
            messages={ar}
            quotation={draftWith({ ...OWN_PENDING, requesterSetPolicy: true }) as never}
            canManage
            canDecide={false}
            canReadLimits={false}
            canReadServices={false}
          />,
          { locale: 'ar' }
        ),
        'ar'
      )
    );
    const note = screen.getByTestId('discount-approval-note');
    expect(
      within(note).getByRole('button', {
        name: AR['quotations.discountApproval.withdraw.action'] as string,
      })
    ).toBeVisible();
    expect(screen.getByTestId('discount-approval-own-policy')).toHaveTextContent(
      AR['quotations.discountApproval.ownPolicy'] as string
    );
  });
});

describe('dates read in order in both languages', () => {
  it('isolates each moment in the direction of the language it is written in', () => {
    renderRtlBare(
      withMui(
        inBranch(
          <QuotationDetailScreen
            locale="ar"
            messages={ar}
            quotation={quotation() as never}
            canManage={false}
            canDecide={false}
            canReadLimits={false}
            canReadServices={false}
          />,
          { locale: 'ar' }
        ),
        'ar'
      )
    );
    const current = screen.getByRole('region', {
      name: (ar as Record<string, string>)['quotations.current.heading'] as string,
    });
    const moments = Array.from(current.querySelectorAll('bdi[dir]')).filter((node) =>
      /2026/.test(node.textContent ?? '')
    );
    expect(moments.length).toBeGreaterThan(0);
    // Never boxed left to right: the Arabic date would be re-ordered on paper.
    for (const moment of moments) expect(moment).toHaveAttribute('dir', 'rtl');
  });
});
