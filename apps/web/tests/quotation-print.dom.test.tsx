import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/i18n/messages/en.json';
import ar from '../src/i18n/messages/ar.json';
import {
  TEST_BRANCH,
  inBranch,
  renderLtr as renderLtrBare,
  renderRtl as renderRtlBare,
} from './render';
import { UiFoundationProvider } from '@/components/ui-foundation/UiFoundationProvider';
import { muiTextOf } from '@/components/ui-foundation/mui-text';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import { getMessages } from '@/i18n/get-messages';
import { formatMoney } from '@/lib/money';

/**
 * The printable quotation (Owner decision D10, P1-32-PRE-OD-FD10).
 *
 * The properties under test: the copy names the quotation, its revision, its
 * dates, its branch, the job, the customer and the vehicle by name and number —
 * never by id — and prints each line and the totals exactly as issued, at the
 * currency's minor unit; it carries the acceptance record as a record, not a
 * signature; it carries nothing from finance (D17) even when the reads hand it
 * more; it prints alone (the print scope) while every working panel stays
 * mounted; a read that fails says the copy is unavailable and offers to try
 * again; a chosen earlier revision prints instead of the current one; unsaved
 * work on the screen is named beside the Print button. English and Arabic.
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

const readQuotation = vi.fn();
const listRevisions = vi.fn();
const readRevision = vi.fn();
const readRevisionDecisions = vi.fn();
vi.mock('@/features/quotations/api', () => ({
  readQuotation: (...args: unknown[]) => readQuotation(...args),
  listRevisions: (...args: unknown[]) => listRevisions(...args),
  readRevision: (...args: unknown[]) => readRevision(...args),
  readRevisionDecisions: (...args: unknown[]) => readRevisionDecisions(...args),
  createQuotationRevision: vi.fn(),
  issueQuotation: vi.fn(),
  decideRevision: vi.fn(),
  decideItem: vi.fn(),
  withdrawDiscountApproval: vi.fn(),
  listQuotations: vi.fn(),
  createQuotation: vi.fn(),
}));
vi.mock('@/features/services/api', () => ({ listServices: vi.fn() }));
vi.mock('@/features/administration/access/api', () => ({ listApprovalLimits: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: () => true,
}));

const { QuotationDetailScreen } =
  await import('@/features/quotations/components/QuotationDetailScreen');
const { QuotationDocument, QuotationPrintPanel } =
  await import('@/features/quotations/components/QuotationPrint');
const { Money } = await import('@/features/quotations/components/shared');

const QUOTATION_ID = '33333333-3333-4333-8333-333333333333';
const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const CURRENT_ID = '44444444-4444-4444-8444-444444444444';
const OLDER_ID = '44444444-4444-4444-8444-444444444440';
const LINE_ID = 'aaaaaaa1-0000-4000-8000-000000000001';
const PART_LINE_ID = 'aaaaaaa1-0000-4000-8000-000000000002';
const SERVICE_ID = '55555555-5555-4555-8555-555555555555';
const ITEM_ID = '66666666-6666-4666-8666-666666666666';
const PARTNER_ID = '88888888-8888-4888-8888-888888888888';
const RECORDER_ID = 'bbbbbbb1-0000-4000-8000-000000000001';

const serviceLine = {
  id: LINE_ID,
  lineNumber: 1,
  itemKind: 'service',
  serviceId: SERVICE_ID,
  item: null,
  unit: null,
  description: 'Brake inspection',
  currency: 'JOD',
  unitPrice: '100.0000',
  quantity: '1.000',
  discount: '5.0000',
  taxRate: '0.160000',
  taxAmount: '15.2000',
  lineTotal: '110.2000',
  priceRuleRef: null,
};
const partLine = {
  ...serviceLine,
  id: PART_LINE_ID,
  lineNumber: 2,
  itemKind: 'part',
  serviceId: null,
  item: { id: ITEM_ID, code: 'BRK-PAD-01', name: 'Brake pads' },
  unit: { code: 'set', name: 'Set' },
  description: null,
  unitPrice: '12.5000',
  quantity: '2.000',
  discount: '0.0000',
  taxAmount: '4.0000',
  lineTotal: '29.0000',
};

function revision(over: Record<string, unknown> = {}) {
  return {
    id: CURRENT_ID,
    revisionNumber: 2,
    status: 'issued',
    currency: 'JOD',
    issuedAt: '2026-10-01T10:00:00Z',
    expiresAt: '2026-10-15T10:00:00Z',
    subtotal: '125.0000',
    discountTotal: '5.0000',
    taxTotal: '19.2000',
    grandTotal: '139.2000',
    recordVersion: 1,
    lines: [serviceLine, partLine],
    discountApproval: null,
    ...over,
  };
}

function quotation(over: Record<string, unknown> = {}) {
  return {
    id: QUOTATION_ID,
    quotationNumber: 'QUO-000077',
    workOrderId: WORK_ORDER_ID,
    companyId: TEST_BRANCH.companyId,
    branchId: TEST_BRANCH.id,
    currency: 'JOD',
    status: 'active',
    payerPartnerRef: PARTNER_ID,
    currentRevisionId: CURRENT_ID,
    recordVersion: 5,
    currentRevision: revision(),
    ...over,
  };
}

const workOrder = {
  id: WORK_ORDER_ID,
  companyId: TEST_BRANCH.companyId,
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
  assignedTechnician: null,
  completedAt: null,
  qualityState: null,
};

function decisions(over: Record<string, unknown> = {}) {
  return {
    quotationId: QUOTATION_ID,
    revisionId: CURRENT_ID,
    revisionStatus: 'issued',
    itemCount: 2,
    decidedCount: 0,
    outcome: null,
    decisions: [],
    acceptance: null,
    ...over,
  };
}

const acceptance = {
  id: 'ccccccc1-0000-4000-8000-000000000001',
  quotationRevisionId: CURRENT_ID,
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
};

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });
const page = (rows: unknown[]) => ({
  status: 'ok' as const,
  rows,
  nextCursor: null,
  hasMore: false,
  correlationId: 'corr',
});
const header = (over: Record<string, unknown>) => ({
  id: CURRENT_ID,
  quotationId: QUOTATION_ID,
  revisionNumber: 2,
  status: 'issued',
  currency: 'JOD',
  issuedAt: '2026-10-01T10:00:00Z',
  expiresAt: null,
  subtotal: '125.0000',
  discountTotal: '5.0000',
  taxTotal: '19.2000',
  grandTotal: '139.2000',
  recordVersion: 1,
  isCurrent: true,
  ...over,
});

function screenUi(locale: 'en' | 'ar', q: ReturnType<typeof quotation>) {
  return inBranch(
    <QuotationDetailScreen
      locale={locale}
      messages={locale === 'en' ? en : ar}
      quotation={q as never}
      workOrder={workOrder as never}
      canManage={false}
      canDecide={false}
      canReadLimits={false}
      canReadServices={false}
    />,
    { locale }
  );
}

function renderScreen(locale: 'en' | 'ar' = 'en', q = quotation()) {
  const ui = screenUi(locale, q);
  return locale === 'en' ? renderLtr(ui) : renderRtl(ui);
}

async function openCopy(text: Record<string, string> = EN) {
  const user = userEvent.setup();
  const panel = await screen.findByTestId('quotation-print-panel');
  await user.click(
    within(panel).getByRole('button', { name: text['quotations.print.open'] as string })
  );
  return { user, panel };
}

const documentIn = (root: ParentNode) =>
  root.querySelector('[data-print="document"]') as HTMLElement | null;

beforeEach(() => {
  vi.clearAllMocks();
  listRevisions.mockResolvedValue(page([header({})]));
  readRevisionDecisions.mockResolvedValue(okRead(decisions()));
  readQuotation.mockResolvedValue(okRead(quotation()));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the printable quotation', () => {
  it('names the quotation, the job, the customer and the vehicle, and prints lines and totals as issued', async () => {
    renderScreen();
    const { panel } = await openCopy();
    await waitFor(() => expect(documentIn(panel)).not.toBeNull());
    const paper = documentIn(panel) as HTMLElement;

    expect(within(paper).getByRole('heading', { level: 1 })).toHaveTextContent(
      EN['quotations.print.title'] as string
    );
    for (const text of [
      'QUO-000077',
      'WO-000042',
      'Layla Haddad',
      '12-34567 · Toyota Corolla',
      TEST_BRANCH.name,
      'Brake inspection',
      'Brake pads',
      'BRK-PAD-01',
      'Set',
    ]) {
      expect(paper, text).toHaveTextContent(text);
    }
    expect(within(paper).getByTestId('quotation-print-valid-until').textContent).not.toBe('');
    // Every money figure at the JOD minor unit: three decimals.
    for (const figure of ['100.000 JOD', '5.000 JOD', '110.200 JOD', '12.500 JOD', '139.200 JOD']) {
      expect(paper, figure).toHaveTextContent(figure);
    }
    // A real table, so the header repeats on every printed page.
    const table = within(paper).getByRole('table');
    expect(table.querySelector('thead')).not.toBeNull();
    // The two lines are the table's body rows. The totals close the table in the
    // row group of the last line, so they print beside it (P1-32-PRE-OD-FRXR), and
    // that closing row is not a line.
    expect(table.querySelectorAll(':scope > tbody > tr:not([data-print-table-tail])')).toHaveLength(
      2
    );
    expect(table.querySelector('[data-print-table-tail]')).toContainElement(
      within(paper).getByTestId('quotation-print-totals')
    );
    expect(within(paper).getByTestId('quotation-print-totals')).toHaveTextContent(
      EN['quotations.print.totalsHeading'] as string
    );
    // Names and numbers, never ids.
    for (const id of [
      QUOTATION_ID,
      WORK_ORDER_ID,
      CURRENT_ID,
      LINE_ID,
      SERVICE_ID,
      ITEM_ID,
      PARTNER_ID,
    ]) {
      expect(paper.textContent).not.toContain(id);
    }
    expect(readQuotation).not.toHaveBeenCalled();
    expect(readRevisionDecisions).toHaveBeenCalledWith(CURRENT_ID);
  });

  it('prints in Arabic, right to left, with the same figures', async () => {
    renderScreen('ar');
    const { panel } = await openCopy(AR);
    await waitFor(() => expect(documentIn(panel)).not.toBeNull());
    const paper = documentIn(panel) as HTMLElement;
    expect(document.documentElement.dir).toBe('rtl');
    expect(within(paper).getByRole('heading', { level: 1 })).toHaveTextContent(
      AR['quotations.print.title'] as string
    );
    expect(paper).toHaveTextContent(AR['quotations.print.validUntil'] as string);
    expect(paper).toHaveTextContent(AR['quotations.print.totalsHeading'] as string);
    expect(paper).toHaveTextContent(formatMoney({ amount: '139.2000', currency: 'JOD' }, 'ar'));
    expect(paper).toHaveTextContent('QUO-000077');
    expect(paper.textContent).not.toContain(PARTNER_ID);
  });

  it('prints the acceptance record as a record, never as a signature', async () => {
    readRevisionDecisions.mockResolvedValue(
      okRead(decisions({ decidedCount: 2, outcome: 'accepted', acceptance }))
    );
    renderScreen();
    const { panel } = await openCopy();
    const record = await within(panel).findByTestId('quotation-print-acceptance');
    expect(record).toHaveTextContent(EN['quotations.acceptance.heading'] as string);
    expect(record).toHaveTextContent(EN['quotations.acceptance.explain'] as string);
    expect(record.textContent).not.toMatch(/signed by|signature:/i);
    for (const text of [
      'Layla Haddad',
      'Sami Nasser',
      '+962791234567',
      'Omar Saleh',
      'Call ref 42',
    ]) {
      expect(record, text).toHaveTextContent(text);
    }
    expect(record.textContent).not.toContain(RECORDER_ID);
    expect(within(panel).getByTestId('quotation-print-decision')).toHaveTextContent(
      EN['quotations.outcome.accepted'] as string
    );
  });

  it('prints alone: one direct child of the scope holds the copy, and Print opens the browser dialogue', async () => {
    const { container } = renderScreen();
    const scope = container.querySelector('[data-print-scope]') as HTMLElement;
    expect(scope).not.toBeNull();
    const holding = () =>
      [...scope.children].filter((child) => child.querySelector('[data-print="document"]'));
    expect(holding()).toHaveLength(0);

    const { user, panel } = await openCopy();
    await waitFor(() => expect(holding()).toHaveLength(1));
    expect(holding()[0]).toBe(panel);
    expect(scope.children.length).toBeGreaterThan(1);
    // The working panels stay mounted: the copy never replaces them.
    expect(
      screen.getByRole('heading', { name: EN['quotations.revisions.heading'] as string })
    ).toBeInTheDocument();

    const printButton = within(panel).getByRole('button', {
      name: EN['quotations.print.print'] as string,
    });
    expect(printButton.closest('[data-print="hide"]')).not.toBeNull();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await user.click(printButton);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('keeps one print panel when the quotation is read again at a higher version', async () => {
    // A reload after issue, a decision or a new revision raises recordVersion,
    // which remounts the print panel. Its key must not collide with a sibling's,
    // or React leaves the old panel behind and the paper carries two copies.
    const duplicateKey = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container, rerender } = renderScreen();
    const panels = () => container.querySelectorAll('[data-testid="quotation-print-panel"]');
    expect(panels()).toHaveLength(1);

    rerender(withMui(screenUi('en', quotation({ recordVersion: 6 })), 'en'));
    await waitFor(() => expect(panels()).toHaveLength(1));
    expect(
      duplicateKey.mock.calls.some((call) =>
        String(call[0]).includes('two children with the same key')
      )
    ).toBe(false);

    const { panel } = await openCopy();
    await waitFor(() => expect(documentIn(panel)).not.toBeNull());
    const scope = container.querySelector('[data-print-scope]') as HTMLElement;
    expect(scope.querySelectorAll('[data-print="document"]')).toHaveLength(1);
  });

  it('says the copy is unavailable when a read fails, and prints once it is read again', async () => {
    // Every decisions read fails until the operator asks again — the screen's own
    // decisions panel reads it too, so a one-off failure could land there instead.
    readRevisionDecisions.mockResolvedValue({ status: 'unavailable', correlationId: 'ref-1' });
    renderScreen();
    const { user, panel } = await openCopy();
    const failure = await within(panel).findByTestId('quotation-print-unavailable');
    expect(failure).toHaveTextContent(EN['quotations.print.unavailable'] as string);
    expect(documentIn(panel)).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: EN['quotations.print.print'] as string })
    ).toBeNull();

    readRevisionDecisions.mockResolvedValue(okRead(decisions()));
    await user.click(
      within(failure).getByRole('button', { name: EN['quotations.print.retry'] as string })
    );
    await waitFor(() => expect(documentIn(panel)).not.toBeNull());
    expect(
      within(panel).getByRole('button', { name: EN['quotations.print.print'] as string })
    ).toBeVisible();
  });

  it('prints a chosen earlier revision instead of the current one', async () => {
    listRevisions.mockResolvedValue(
      page([
        header({}),
        header({ id: OLDER_ID, revisionNumber: 1, status: 'superseded', isCurrent: false }),
      ])
    );
    readRevision.mockResolvedValue(
      okRead(
        revision({ id: OLDER_ID, revisionNumber: 1, status: 'superseded', grandTotal: '150.0000' })
      )
    );
    renderScreen();
    const { user, panel } = await openCopy();
    const chooser = await within(panel).findByLabelText(
      EN['quotations.print.revisionLabel'] as string
    );
    await user.selectOptions(chooser, OLDER_ID);
    await waitFor(() => expect(readRevision).toHaveBeenCalledWith(OLDER_ID));
    await waitFor(() => expect(documentIn(panel)).toHaveTextContent('150.000 JOD'));
    expect(readRevisionDecisions).toHaveBeenCalledWith(OLDER_ID);
    expect(documentIn(panel)).toHaveTextContent(
      EN['quotations.revisionStatus.superseded'] as string
    );
  });

  it('names unsaved work on the screen beside the Print button, and keeps it off the paper', async () => {
    function Dirty() {
      useUnsavedGuard(true);
      return null;
    }
    renderLtr(
      inBranch(
        <>
          <Dirty />
          <QuotationPrintPanel
            locale="en"
            messages={en}
            quotation={quotation() as never}
            workOrder={workOrder as never}
          />
        </>
      )
    );
    const { panel } = await openCopy();
    const note = await within(panel).findByTestId('print-unsaved-note');
    expect(note).toHaveTextContent(EN['print.unsavedNote'] as string);
    expect(note.closest('[data-print="hide"]')).not.toBeNull();
    await waitFor(() => expect(documentIn(panel)).not.toBeNull());
    expect(documentIn(panel)?.contains(note)).toBe(false);
  });
});

describe('what a quotation copy never carries (D17)', () => {
  it('prints no invoice, payment, balance, cost or margin even when the reads carry them', () => {
    const carrying = {
      ...quotation(),
      invoiceNumber: 'INV-000777',
      payments: [{ amount: '987.6540', reference: 'RCPT-000555' }],
      balance: { outstanding: '444.3330', currency: 'JOD' },
      cost: '321.1110',
      margin: '0.4567',
    };
    const lineWith = {
      ...serviceLine,
      cost: '55.5550',
      margin: '0.3333',
      invoicedQuantity: '1.000',
    };
    const { container } = renderLtr(
      inBranch(
        <QuotationDocument
          locale="en"
          messages={en}
          quotation={carrying as never}
          revision={revision({ lines: [lineWith], costTotal: '66.6660' }) as never}
          decisions={decisions() as never}
          workOrder={workOrder as never}
          branchName={TEST_BRANCH.name}
        />
      )
    );
    const text = container.textContent ?? '';
    for (const leaked of [
      'INV-000777',
      'RCPT-000555',
      '987.654',
      '444.333',
      '321.111',
      '55.555',
      '66.666',
      '0.4567',
      '0.3333',
    ]) {
      expect(text, leaked).not.toContain(leaked);
    }
    for (const key of [
      'invoices.print.balanceDue',
      'invoices.print.amountPaid',
      'invoices.print.amountCredited',
      'invoices.print.settlementAsOf',
    ]) {
      expect(text, key).not.toContain(EN[key] as string);
    }
    expect(text).not.toMatch(/\b(cost|margin|balance due|payment history)\b/i);
  });
});

describe('the quotation money figure, at the currency minor unit', () => {
  it('writes JOD with three decimals and JPY with none, in both languages', () => {
    const { container } = renderLtr(
      <p>
        <Money amount="12.5000" currency="JOD" locale="en" />
        {' | '}
        <Money amount="1500.0000" currency="JPY" locale="en" />
        {' | '}
        <Money amount="1.9752" currency="JOD" locale="en" />
      </p>
    );
    expect(container).toHaveTextContent('12.500 JOD | 1,500 JPY | 1.9752 JOD');

    const arabic = renderRtl(
      <p data-testid="ar-money">
        <Money amount="12.5000" currency="JOD" locale="ar" />
      </p>
    );
    expect(arabic.getByTestId('ar-money')).toHaveTextContent(
      formatMoney({ amount: '12.5000', currency: 'JOD', minorUnit: 3 }, 'ar')
    );
  });

  it('follows a minor unit the server publishes over the browser register', () => {
    const { container } = renderLtr(
      <Money amount="7.0000" currency="IQD" minorUnit={3} locale="en" />
    );
    expect(container).toHaveTextContent('7.000 IQD');
  });

  it('prints a zero-decimal currency without decimals on the copy', () => {
    const yen = {
      ...serviceLine,
      currency: 'JPY',
      unitPrice: '1500.0000',
      discount: '0.0000',
      taxAmount: '150.0000',
      lineTotal: '1650.0000',
    };
    const { container } = renderLtr(
      inBranch(
        <QuotationDocument
          locale="en"
          messages={en}
          quotation={quotation({ currency: 'JPY' }) as never}
          revision={
            revision({
              currency: 'JPY',
              lines: [yen],
              subtotal: '1500.0000',
              discountTotal: '0.0000',
              taxTotal: '150.0000',
              grandTotal: '1650.0000',
            }) as never
          }
          decisions={decisions() as never}
          workOrder={workOrder as never}
          branchName={TEST_BRANCH.name}
        />
      )
    );
    expect(container).toHaveTextContent('1,500 JPY');
    expect(container).toHaveTextContent('1,650 JPY');
    expect(container.textContent).not.toContain('1,650.0');
  });
});

/**
 * The copy names itself at the top of every printed page (2026-10-07 browser
 * retest): only the first page carried the title and number, so a second page
 * on its own said nothing about which quotation it belonged to. The repeated row
 * is a table head the browser draws on each page, kept off the screen.
 */
describe('the quotation copy names itself on every printed page', () => {
  it('repeats the title and the quotation number in a head row drawn only on paper', () => {
    renderLtr(
      inBranch(
        <QuotationDocument
          locale="en"
          messages={en}
          quotation={quotation() as never}
          revision={revision() as never}
          decisions={decisions() as never}
          workOrder={workOrder as never}
          branchName={TEST_BRANCH.name}
        />
      )
    );
    const identity = screen.getByTestId('print-document-identity');
    expect(identity.tagName).toBe('THEAD');
    const classes = identity.className.split(/\s+/);
    // Not shown on screen; a repeating table head on paper.
    expect(classes).toContain('hidden');
    expect(classes).toContain('print:table-header-group');
    expect(identity).toHaveTextContent(`${EN['quotations.print.title']} · QUO-000077`);
    // The first page is unchanged: the title is still its heading.
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      EN['quotations.print.title'] as string
    );
  });
});

/**
 * Unit names in the reader's language (2026-10-07 browser retest): a line's
 * unit is a snapshot of the unit's stored name, and the platform's own units
 * were seeded in English, so an Arabic copy printed "Set". A seeded code is
 * worded by the catalogue; any other code keeps the name it was stored with.
 */
describe('the unit a line is counted in', () => {
  it('prints a unit the platform seeded by its Arabic name on an Arabic copy', () => {
    const ui = inBranch(
      <QuotationDocument
        locale="ar"
        messages={ar}
        quotation={quotation() as never}
        revision={revision({ lines: [partLine] }) as never}
        decisions={decisions() as never}
        workOrder={workOrder as never}
        branchName={TEST_BRANCH.name}
      />,
      { locale: 'ar' }
    );
    const { container } = renderRtl(ui);
    const table = within(container).getByRole('table');
    expect(table).toHaveTextContent(AR['units.name.set'] as string);
    expect(table.textContent).not.toContain('Set');
  });

  it('prints a unit the platform did not seed by the name it was stored with', () => {
    const own = { ...partLine, unit: { code: 'drum_200', name: 'Drum 200 L' } };
    const ui = inBranch(
      <QuotationDocument
        locale="ar"
        messages={ar}
        quotation={quotation() as never}
        revision={revision({ lines: [own] }) as never}
        decisions={decisions() as never}
        workOrder={workOrder as never}
        branchName={TEST_BRANCH.name}
      />,
      { locale: 'ar' }
    );
    const { container } = renderRtl(ui);
    expect(within(container).getByRole('table')).toHaveTextContent('Drum 200 L');
  });

  it('prints a seeded code by the name it was stored with when that name is not the seeded one', () => {
    // The code is one the platform seeds, but the line's unit carries another
    // name: the catalogue's word would show a name the record does not hold
    // (P1-32-PRE-OD-FD16B).
    const renamed = { ...partLine, unit: { code: 'set', name: 'Kit of four' } };
    const ui = inBranch(
      <QuotationDocument
        locale="ar"
        messages={ar}
        quotation={quotation() as never}
        revision={revision({ lines: [renamed] }) as never}
        decisions={decisions() as never}
        workOrder={workOrder as never}
        branchName={TEST_BRANCH.name}
      />,
      { locale: 'ar' }
    );
    const { container } = renderRtl(ui);
    const table = within(container).getByRole('table');
    expect(table).toHaveTextContent('Kit of four');
    expect(table.textContent).not.toContain(AR['units.name.set'] as string);
  });

  it('shows the Arabic name on the quotation screen’s own lines too', async () => {
    renderScreen('ar');
    const lines = await screen.findByText('BRK-PAD-01');
    const row = lines.closest('tr') as HTMLElement;
    expect(row).toHaveTextContent(AR['units.name.set'] as string);
    expect(row.textContent).not.toContain('Set');
  });
});
