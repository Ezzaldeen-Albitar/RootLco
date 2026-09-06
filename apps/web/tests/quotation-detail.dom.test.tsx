import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import { renderLtr } from './render';

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
 */

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
vi.mock('@/features/quotations/api', () => ({
  readQuotation: (...args: unknown[]) => readQuotation(...args),
  listRevisions: (...args: unknown[]) => listRevisions(...args),
  readRevision: (...args: unknown[]) => readRevision(...args),
  readRevisionDecisions: (...args: unknown[]) => readRevisionDecisions(...args),
  createQuotationRevision: (...args: unknown[]) => createQuotationRevision(...args),
  issueQuotation: (...args: unknown[]) => issueQuotation(...args),
  decideRevision: (...args: unknown[]) => decideRevision(...args),
  decideItem: (...args: unknown[]) => decideItem(...args),
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
    ...over,
  };
}

function quotation(over: Record<string, unknown> = {}) {
  return {
    id: QUOTATION_ID,
    quotationNumber: 'QUO-000001',
    workOrderId: WORK_ORDER_ID,
    companyId: 'company-1',
    branchId: 'b',
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
    ...over,
  };
}

function renderDetail(over: Record<string, unknown> = {}, q = quotation()) {
  return renderLtr(
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
  );
}

async function renderPage(params: Record<string, string>) {
  const tree = await QuotationDetailPage({ params: Promise.resolve(params) });
  return renderLtr(tree as React.ReactElement);
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
    const table = await within(revisions).findByRole('table');
    expect(
      within(table).getByText(EN['quotations.revisionStatus.superseded'] as string)
    ).toBeVisible();
    await user.click(
      within(table).getByRole('button', { name: `${EN['quotations.revisions.show']} 1` })
    );
    await waitFor(() => expect(readRevision).toHaveBeenCalledWith(OLD_ID));
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

describe('guarded writes send the QUOTATION version and renew it', () => {
  it('issues the current draft with the quotation’s recordVersion, then refreshes', async () => {
    const user = userEvent.setup();
    renderDetail({}, quotation({ currentRevision: revision({ status: 'draft', issuedAt: null }) }));
    const form = screen.getByRole('form', { name: EN['quotations.issue.heading'] as string });
    fireEvent.change(within(form).getByLabelText(labelled('quotations.issue.expiresAt')), {
      target: { value: '2026-12-01T10:00' },
    });
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    await waitFor(() => expect(issueQuotation).toHaveBeenCalled());
    const [id, body, ifMatch] = issueQuotation.mock.calls[0] as [
      string,
      Record<string, unknown>,
      number,
    ];
    expect(id).toBe(QUOTATION_ID);
    expect(body['revisionId']).toBe(ISSUED_ID);
    expect(typeof body['expiresAt']).toBe('string');
    // The QUOTATION's version (5), never the revision's own (1).
    expect(ifMatch).toBe(5);
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it('says there is no draft to issue when the current revision is issued', () => {
    renderDetail();
    expect(screen.getByText(EN['quotations.issue.noDraft'] as string)).toBeVisible();
  });

  it('a conflict on issue renders as a conflict and does not refresh', async () => {
    issueQuotation.mockResolvedValue({ status: 'conflict', correlationId: 'corr-9', attempt: 1 });
    const user = userEvent.setup();
    renderDetail({}, quotation({ currentRevision: revision({ status: 'draft', issuedAt: null }) }));
    const form = screen.getByRole('form', { name: EN['quotations.issue.heading'] as string });
    await user.click(
      within(form).getByRole('button', { name: EN['quotations.issue.submit'] as string })
    );
    expect(await within(form).findByText(EN['quotations.detail.conflict'] as string)).toBeVisible();
    expect(within(form).getByText('corr-9')).toBeVisible();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('adds a revision from lines with the quotation’s recordVersion', async () => {
    const user = userEvent.setup();
    renderDetail();
    const form = screen.getByRole('form', { name: EN['quotations.revise.heading'] as string });
    await user.type(
      within(form).getByLabelText(labelled('quotations.picker.serviceIdField')),
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
    expect(region('quotations.detail.summaryHeading')).toBeVisible();
    expect(screen.getByText(EN['quotations.revise.heading'] as string)).toBeVisible();
    expect(
      await screen.findByRole('form', { name: EN['quotations.decide.heading'] as string })
    ).toBeVisible();
  });

  it('a locale it does not serve is not found', async () => {
    PERMISSIONS = ['quo.quotation.read'];
    await expect(renderPage({ locale: 'xx', quotationId: QUOTATION_ID })).rejects.toThrow(
      'notFound'
    );
  });
});
