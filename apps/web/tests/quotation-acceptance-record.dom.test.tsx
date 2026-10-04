import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  BranchSwitch,
  OTHER_BRANCH,
  TEST_BRANCH,
  WorkingBranchProbe,
  branchSnapshot,
  inBranch,
  renderLtr as renderLtrBare,
  renderRtl as renderRtlBare,
} from './render';
import {
  forgetRememberedBranch,
  heldBranch,
  stayOnBranch,
  switchExpectingQuestion,
  switchWithoutQuestion,
} from './support/branch-switch';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { getMessages } from '@/i18n/get-messages';

/**
 * The acceptance record of a quotation revision (P1-32-PRE-OD-FD11, ADR-023 D11).
 *
 * The properties under test: the detail shows who accepted, through whom, how,
 * when, who recorded it and on what reference — with names, never ids — and is
 * labelled a record, not a signature; a revision accepted before records were
 * kept says it has none; every part that was not given says so. The decision
 * form offers the contact on an approval only, sends it trimmed, refuses a
 * telephone number the server would refuse before any request (red field, text
 * beside it, cursor on it, withdrawn once corrected), shows the server's own
 * refusal beside the field, never sends a contact with a rejection, and declares
 * a typed contact as unsaved work. English and Arabic.
 */

function withMui(ui: ReactElement, locale: 'en' | 'ar'): ReactElement {
  return (
    <UiFoundationProvider locale={locale} text={muiTextOf(getMessages(locale))}>
      {ui}
    </UiFoundationProvider>
  );
}
const renderLtr = (ui: ReactElement) => renderLtrBare(withMui(ui, 'en'));
const renderRtl = (ui: ReactElement) => renderRtlBare(withMui(ui, 'ar'));

const EN = en as Record<string, string>;
const AR = ar as Record<string, string>;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const labelled = (key: string) => new RegExp(`^${escape(EN[key] as string)}`);

const readQuotation = vi.fn();
const listRevisions = vi.fn();
const readRevision = vi.fn();
const readRevisionDecisions = vi.fn();
const decideRevision = vi.fn();
const decideItem = vi.fn();
vi.mock('@/features/quotations/api', () => ({
  readQuotation: (...args: unknown[]) => readQuotation(...args),
  listRevisions: (...args: unknown[]) => listRevisions(...args),
  readRevision: (...args: unknown[]) => readRevision(...args),
  readRevisionDecisions: (...args: unknown[]) => readRevisionDecisions(...args),
  createQuotationRevision: vi.fn(),
  issueQuotation: vi.fn(),
  decideRevision: (...args: unknown[]) => decideRevision(...args),
  decideItem: (...args: unknown[]) => decideItem(...args),
  listQuotations: vi.fn(),
  createQuotation: vi.fn(),
}));

vi.mock('@/features/services/api', () => ({ listServices: vi.fn() }));
vi.mock('@/features/administration/access/api', () => ({ listApprovalLimits: vi.fn() }));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));

vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: () => true,
}));

const { QuotationDetailScreen } =
  await import('@/features/quotations/components/QuotationDetailScreen');

const QUOTATION_ID = '33333333-3333-4333-8333-333333333333';
const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const ISSUED_ID = '44444444-4444-4444-8444-444444444444';
const LINE_1 = 'aaaaaaa1-0000-4000-8000-000000000001';
const PARTNER_ID = '88888888-8888-4888-8888-888888888888';
const RECORDER_ID = 'bbbbbbb1-0000-4000-8000-000000000001';
const RECORD_ID = 'ccccccc1-0000-4000-8000-000000000001';

const line = {
  id: LINE_1,
  lineNumber: 1,
  itemKind: 'service',
  serviceId: '55555555-5555-4555-8555-555555555555',
  description: 'Oil change',
  currency: 'JOD',
  unitPrice: '100.0000',
  quantity: '1.000',
  discount: '0.0000',
  taxRate: '0.100000',
  taxAmount: '10.0000',
  lineTotal: '110.0000',
  priceRuleRef: 'rule-1',
};

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
    currentRevision: {
      id: ISSUED_ID,
      revisionNumber: 1,
      status: 'issued',
      currency: 'JOD',
      issuedAt: '2026-10-01T10:00:00Z',
      expiresAt: null,
      subtotal: '100.0000',
      discountTotal: '0.0000',
      taxTotal: '10.0000',
      grandTotal: '110.0000',
      recordVersion: 1,
      lines: [line],
      discountApproval: null,
    },
    ...over,
  };
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

function record(over: Record<string, unknown> = {}) {
  return {
    id: RECORD_ID,
    quotationRevisionId: ISSUED_ID,
    customerPartnerId: PARTNER_ID,
    contactName: 'Sami Nasser',
    contactPhone: '+962791234567',
    channel: 'phone',
    evidenceKind: 'verbal',
    referenceNote: 'Call ref 42',
    documentVersionId: null,
    acceptedAt: '2026-10-02T09:30:00Z',
    recordedBy: { id: RECORDER_ID, displayName: 'Omar Saleh' },
    recordedByCaller: false,
    ...over,
  };
}

function decisions(over: Record<string, unknown> = {}) {
  return {
    quotationId: QUOTATION_ID,
    revisionId: ISSUED_ID,
    revisionStatus: 'issued',
    itemCount: 1,
    decidedCount: 0,
    outcome: null,
    decisions: [],
    acceptance: null,
    ...over,
  };
}

const accepted = (acceptance: unknown) =>
  decisions({ decidedCount: 1, outcome: 'accepted', acceptance });

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const success = (messageKey: string) => ({ status: 'success' as const, messageKey, attempt: 1 });

function renderDetail(
  over: Record<string, unknown> = {},
  locale: 'en' | 'ar' = 'en',
  q = quotation()
) {
  const ui = inBranch(
    <QuotationDetailScreen
      locale={locale}
      messages={locale === 'en' ? en : ar}
      quotation={q as never}
      workOrder={workOrder as never}
      canManage={false}
      canDecide={false}
      canReadLimits={false}
      canReadServices={false}
      {...over}
    />,
    { locale }
  );
  return locale === 'en' ? renderLtr(ui) : renderRtl(ui);
}

beforeEach(() => {
  vi.clearAllMocks();
  listRevisions.mockResolvedValue({
    status: 'ok',
    rows: [],
    nextCursor: null,
    hasMore: false,
    correlationId: 'corr',
  });
  readRevisionDecisions.mockResolvedValue(okRead(decisions()));
  readQuotation.mockResolvedValue(okRead(quotation()));
  decideRevision.mockResolvedValue({
    state: success('quotations.decision.success'),
    created: { decision: 'approved', itemsDecided: 1 },
  });
});

const recordRegion = (text: Record<string, string> = EN) =>
  screen.findByRole('region', { name: text['quotations.acceptance.heading'] as string });

describe('the acceptance record on the quotation detail', () => {
  it('names who accepted, through whom, how, when, who recorded it and the reference', async () => {
    readRevisionDecisions.mockResolvedValue(okRead(accepted(record())));
    renderDetail();
    const card = await recordRegion();
    // Labelled a record — the heading says so and never says signature.
    expect(within(card).getByRole('heading', { level: 3 })).toHaveTextContent(
      EN['quotations.acceptance.heading'] as string
    );
    expect(within(card).getByRole('heading', { level: 3 }).textContent).not.toMatch(/signature/i);
    expect(within(card).getByText('Layla Haddad')).toBeVisible();
    expect(within(card).getByText('Sami Nasser')).toBeVisible();
    expect(within(card).getByText('+962791234567')).toHaveAttribute('dir', 'ltr');
    expect(within(card).getByText(EN['quotations.channel.phone'] as string)).toBeVisible();
    expect(within(card).getByText('Omar Saleh')).toBeVisible();
    expect(within(card).getByText('Call ref 42')).toBeVisible();
    // Names, never ids.
    expect(card.textContent).not.toContain(RECORDER_ID);
    expect(card.textContent).not.toContain(PARTNER_ID);
    expect(card.textContent).not.toContain(RECORD_ID);
    expect(screen.queryByTestId('acceptance-record-missing')).toBeNull();
  });

  it('says what was not given rather than filling it in', async () => {
    readRevisionDecisions.mockResolvedValue(
      okRead(
        accepted(
          record({
            customerPartnerId: null,
            contactName: null,
            contactPhone: null,
            evidenceKind: null,
            referenceNote: null,
            recordedBy: { id: RECORDER_ID, displayName: null },
            recordedByCaller: false,
          })
        )
      )
    );
    renderDetail();
    const card = await recordRegion();
    for (const key of [
      'quotations.acceptance.customerNotAttributed',
      'quotations.acceptance.contactNotGiven',
      'quotations.acceptance.referenceNone',
      'quotations.acceptance.recordedBySomeone',
    ]) {
      expect(within(card).getByText(EN[key] as string), key).toBeVisible();
    }
    expect(card.textContent).not.toContain(RECORDER_ID);
  });

  it('calls the recorder "you" when the caller recorded it and may not read names', async () => {
    readRevisionDecisions.mockResolvedValue(
      okRead(
        accepted(
          record({ recordedBy: { id: RECORDER_ID, displayName: null }, recordedByCaller: true })
        )
      )
    );
    renderDetail();
    const card = await recordRegion();
    expect(
      within(card).getByText(EN['quotations.acceptance.recordedByYou'] as string)
    ).toBeVisible();
  });

  it('says a revision accepted before records were kept has none', async () => {
    readRevisionDecisions.mockResolvedValue(okRead(accepted(null)));
    renderDetail();
    expect(await screen.findByTestId('acceptance-record-missing')).toHaveTextContent(
      EN['quotations.acceptance.notRecorded'] as string
    );
    expect(
      screen.queryByRole('region', { name: EN['quotations.acceptance.heading'] as string })
    ).toBeNull();
  });

  it('shows neither the record nor its absence while the revision is undecided', async () => {
    renderDetail();
    await waitFor(() => expect(readRevisionDecisions).toHaveBeenCalledWith(ISSUED_ID));
    await screen.findByText(EN['quotations.outcome.pending'] as string);
    expect(screen.queryByTestId('acceptance-record')).toBeNull();
    expect(screen.queryByTestId('acceptance-record-missing')).toBeNull();
  });

  it('reads in Arabic, right to left', async () => {
    readRevisionDecisions.mockResolvedValue(okRead(accepted(record({ contactName: 'سامي ناصر' }))));
    renderDetail({}, 'ar');
    const card = await recordRegion(AR);
    expect(within(card).getByText(AR['quotations.acceptance.explain'] as string)).toBeVisible();
    expect(within(card).getByText('سامي ناصر')).toBeVisible();
    expect(within(card).getByText(AR['quotations.channel.phone'] as string)).toBeVisible();
    expect(card.closest('[dir="rtl"]')).not.toBeNull();
  });

  it('says in Arabic that an older acceptance has no record', async () => {
    readRevisionDecisions.mockResolvedValue(okRead(accepted(null)));
    renderDetail({}, 'ar');
    expect(await screen.findByTestId('acceptance-record-missing')).toHaveTextContent(
      AR['quotations.acceptance.notRecorded'] as string
    );
  });
});

describe('the decision form records who accepted', () => {
  async function openForm(user: ReturnType<typeof userEvent.setup>, decision = 'approved') {
    const form = await screen.findByRole('form', {
      name: EN['quotations.decide.heading'] as string,
    });
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.decision')),
      decision
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.channel')),
      'phone'
    );
    return form;
  }
  const submit = (user: ReturnType<typeof userEvent.setup>, form: HTMLElement) =>
    user.click(
      within(form).getByRole('button', { name: EN['quotations.decide.submit'] as string })
    );

  it('offers the contact on an approval only, and sends it trimmed', async () => {
    const user = userEvent.setup();
    renderDetail({ canDecide: true });
    const form = await screen.findByRole('form', {
      name: EN['quotations.decide.heading'] as string,
    });
    expect(within(form).queryByTestId('quotation-decide-contact-name')).toBeNull();
    await openForm(user);
    const name = within(form).getByLabelText(labelled('quotations.decide.contactName'));
    const phone = within(form).getByLabelText(labelled('quotations.decide.contactPhone'));
    expect(name).toHaveAccessibleDescription(EN['quotations.decide.contactNameHelp'] as string);
    expect(phone).toHaveAccessibleDescription(EN['quotations.decide.contactPhoneHelp'] as string);
    await user.type(name, '  Sami Nasser ');
    // Arabic-Indic digits are a telephone number like any other.
    await user.type(phone, '٠٧٩ ١٢٣ ٤٥٦٧');
    await submit(user, form);
    await waitFor(() => expect(decideRevision).toHaveBeenCalled());
    expect(decideRevision).toHaveBeenCalledWith(ISSUED_ID, {
      decision: 'approved',
      channel: 'phone',
      decidingPartyRef: PARTNER_ID,
      contactName: 'Sami Nasser',
      contactPhone: '٠٧٩ ١٢٣ ٤٥٦٧',
      presentedRevisionId: ISSUED_ID,
    });
  });

  it('sends no contact when nothing was typed — an empty contact stays empty', async () => {
    const user = userEvent.setup();
    renderDetail({ canDecide: true });
    const form = await openForm(user);
    await submit(user, form);
    await waitFor(() => expect(decideRevision).toHaveBeenCalled());
    const body = decideRevision.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty('contactName');
    expect(body).not.toHaveProperty('contactPhone');
  });

  it('refuses a telephone number the server would refuse, beside the box, before any request', async () => {
    const user = userEvent.setup();
    renderDetail({ canDecide: true });
    const form = await openForm(user);
    const phone = within(form).getByLabelText(labelled('quotations.decide.contactPhone'));
    await user.type(phone, 'call me');
    await submit(user, form);
    expect(
      await within(form).findByText(EN['quotations.decide.contactPhoneInvalid'] as string)
    ).toBeVisible();
    await waitFor(() => expect(phone).toHaveFocus());
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    // What was typed is kept for correcting.
    expect(phone).toHaveValue('call me');
    expect(decideRevision).not.toHaveBeenCalled();
    await user.clear(phone);
    await user.type(phone, '0791234567');
    expect(phone).not.toHaveAttribute('aria-invalid', 'true');
    expect(
      within(form).queryByText(EN['quotations.decide.contactPhoneInvalid'] as string)
    ).toBeNull();
  });

  it('shows the server’s refusal of the telephone number beside its box', async () => {
    const user = userEvent.setup();
    decideRevision.mockResolvedValue({
      state: {
        status: 'invalid',
        messageKey: 'form.formError',
        fieldErrors: { contactPhone: 'form.violation.invalid_phone' },
        attempt: 1,
      },
    });
    renderDetail({ canDecide: true });
    const form = await openForm(user);
    const phone = within(form).getByLabelText(labelled('quotations.decide.contactPhone'));
    await user.type(phone, '+1234');
    await submit(user, form);
    expect(
      await within(form).findByText(EN['form.violation.invalid_phone'] as string)
    ).toBeVisible();
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(phone).toHaveValue('+1234');
  });

  it('never sends a contact with a rejection', async () => {
    const user = userEvent.setup();
    renderDetail({ canDecide: true });
    const form = await openForm(user);
    await user.type(
      within(form).getByLabelText(labelled('quotations.decide.contactName')),
      'Sami Nasser'
    );
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.decision')),
      'rejected'
    );
    expect(within(form).queryByTestId('quotation-decide-contact-name')).toBeNull();
    await submit(user, form);
    await waitFor(() => expect(decideRevision).toHaveBeenCalled());
    expect(decideRevision.mock.calls[0]?.[1]).not.toHaveProperty('contactName');
  });

  it('asks for the kind of evidence a typed note refers to instead of dropping the note', async () => {
    const user = userEvent.setup();
    renderDetail({ canDecide: true });
    const form = await openForm(user);
    await user.type(within(form).getByLabelText(labelled('quotations.decide.note')), 'Call ref 42');
    await submit(user, form);
    expect(
      await within(form).findByText(EN['quotations.decide.kindForNote'] as string)
    ).toBeVisible();
    expect(decideRevision).not.toHaveBeenCalled();
  });
});

describe('a decision carrying a typed contact is unsaved work', () => {
  afterEach(forgetRememberedBranch);

  it('asks before a branch switch, and staying keeps the typed contact', async () => {
    const user = userEvent.setup();
    renderLtr(
      inBranch(
        <>
          <BranchSwitch to={TEST_BRANCH.id} label="first" />
          <BranchSwitch to={OTHER_BRANCH.id} label="second" />
          <WorkingBranchProbe />
          <QuotationDetailScreen
            locale="en"
            messages={en}
            quotation={quotation() as never}
            workOrder={workOrder as never}
            canManage={false}
            canDecide
            canReadLimits={false}
            canReadServices={false}
          />
        </>,
        { snapshot: branchSnapshot([TEST_BRANCH, OTHER_BRANCH]) }
      )
    );
    await switchWithoutQuestion(user, 'first');
    await waitFor(() => expect(heldBranch()).toBe(TEST_BRANCH.id));
    const form = await screen.findByRole('form', {
      name: EN['quotations.decide.heading'] as string,
    });
    await user.selectOptions(
      within(form).getByLabelText(labelled('quotations.decide.decision')),
      'approved'
    );
    const name = within(form).getByLabelText(labelled('quotations.decide.contactName'));
    await user.type(name, 'Sami Nasser');
    const dialog = await switchExpectingQuestion(user, 'second');
    await stayOnBranch(user, dialog);
    expect(heldBranch()).toBe(TEST_BRANCH.id);
    expect(name).toHaveValue('Sami Nasser');
  });
});
