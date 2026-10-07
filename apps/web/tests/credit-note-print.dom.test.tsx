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
import { getMessages } from '@/i18n/get-messages';
import { formatMoney } from '@/lib/money';

/**
 * The printable credit note (Owner decision D10, P1-32-PRE-OD-FD10).
 *
 * The properties under test: the copy names the invoice it credits by number,
 * the customer, the amount at the currency's minor unit, the reason, the state
 * and who requested and decided it, by name and date, and the return that raised
 * it — never an id; with no credit-note number in existence it is identified by a
 * reference composed from the invoice and the request time, and says so; it is
 * read again when opened, prints alone (the print scope), and says it is
 * unavailable when that read fails, offering to try again. English and Arabic.
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

const readCreditNote = vi.fn();
const listCreditNotes = vi.fn();
vi.mock('@/features/billing/api', () => ({
  readCreditNote: (...args: unknown[]) => readCreditNote(...args),
  listCreditNotes: (...args: unknown[]) => listCreditNotes(...args),
  approveCreditNote: vi.fn(),
  withdrawCreditNote: vi.fn(),
  rejectCreditNote: vi.fn(),
  requestCreditNote: vi.fn(),
  listInvoices: vi.fn(),
}));
vi.mock('@/features/inventory/api', () => ({
  listBranches: vi.fn(),
  listLocations: vi.fn(),
  listItems: vi.fn(),
  listItemCategories: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error('notFound() was called');
  },
}));
vi.mock('@/components/notifications/action-notifications', () => ({
  notifyActionResult: () => true,
}));

const { CreditNotesScreen } = await import('@/features/billing/components/CreditNotesScreen');
const { CreditNoteDocument } = await import('@/features/billing/components/CreditNotePrint');

const NOTE_ID = 'dddddddd-0000-4000-8000-000000000001';
const INVOICE_ID = 'eeeeeeee-0000-4000-8000-000000000001';
const WORK_ORDER_ID = '77777777-7777-4777-8777-777777777777';
const RETURN_ID = 'ffffffff-0000-4000-8000-000000000001';
const REQUESTER = 'u1';
const APPROVER = 'u3';

function note(over: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    invoiceId: INVOICE_ID,
    companyId: TEST_BRANCH.companyId,
    branchId: TEST_BRANCH.id,
    amount: { amount: '40.5000', currency: 'JOD', minorUnit: 3 },
    reason: 'A part was billed twice on the same job',
    approvalState: 'approved',
    requestedBy: REQUESTER,
    approvedBy: APPROVER,
    approvedAt: '2026-09-20T09:00:00Z',
    issuedAt: '2026-09-20T09:00:00Z',
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    recordVersion: 2,
    requestedAt: '2026-09-19T08:00:00Z',
    requestedByName: 'Rana Saleh',
    approvedByName: 'Khaled Odeh',
    decidedByName: null,
    invoice: {
      invoiceNumber: 'INV-000123',
      saleKind: 'work_order',
      workOrderId: WORK_ORDER_ID,
      payerName: 'Layla Haddad',
    },
    sourceReturn: {
      id: RETURN_ID,
      itemCode: 'BRK-PAD-01',
      itemName: 'Brake pads',
      quantity: '1.000',
      receivedAt: '2026-09-18T15:00:00Z',
    },
    ...over,
  };
}

const okRead = (data: unknown) => ({ status: 'ok' as const, data, correlationId: 'corr' });

function renderScreen(locale: 'en' | 'ar' = 'en') {
  const ui = inBranch(
    <CreditNotesScreen
      locale={locale}
      messages={locale === 'en' ? en : ar}
      initialCreditNoteId={NOTE_ID}
      currentUserId="u2"
    />,
    { locale }
  );
  return locale === 'en' ? renderLtr(ui) : renderRtl(ui);
}

async function openCopy(text: Record<string, string> = EN) {
  const user = userEvent.setup();
  const panel = await screen.findByTestId('credit-note-print-panel');
  await user.click(
    within(panel).getByRole('button', { name: text['creditNotes.print.open'] as string })
  );
  return { user, panel };
}

const documentIn = (root: ParentNode) =>
  root.querySelector('[data-print="document"]') as HTMLElement | null;

beforeEach(() => {
  vi.clearAllMocks();
  readCreditNote.mockResolvedValue(okRead(note()));
  listCreditNotes.mockResolvedValue({
    status: 'ok',
    data: { items: [], nextCursor: null, hasMore: false },
    correlationId: 'corr',
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the printable credit note', () => {
  it('names the invoice, the customer, the people and the return, with the amount at the minor unit', async () => {
    renderScreen();
    const { panel } = await openCopy();
    await waitFor(() => expect(documentIn(panel)).not.toBeNull());
    const paper = documentIn(panel) as HTMLElement;

    expect(within(paper).getByRole('heading', { level: 1 })).toHaveTextContent(
      EN['creditNotes.print.title'] as string
    );
    const reference = within(paper).getByTestId('credit-note-print-reference');
    expect(reference).toHaveTextContent('Credit note for invoice INV-000123, requested');
    expect(within(paper).getByTestId('credit-note-print-amount')).toHaveTextContent('40.500 JOD');
    for (const text of [
      'Layla Haddad',
      'A part was billed twice on the same job',
      'Rana Saleh',
      'Khaled Odeh',
      'BRK-PAD-01',
      'Brake pads',
      EN['creditNotes.state.approved'] as string,
      EN['creditNotes.detail.approvedBy'] as string,
      EN['creditNotes.print.noNumber'] as string,
    ]) {
      expect(paper, text).toHaveTextContent(text);
    }
    for (const id of [NOTE_ID, INVOICE_ID, WORK_ORDER_ID, RETURN_ID]) {
      expect(paper.textContent).not.toContain(id);
    }
    // The copy is read again when it is opened, not taken from the screen.
    expect(readCreditNote.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('prints in Arabic, right to left, with the composed reference', async () => {
    renderScreen('ar');
    const { panel } = await openCopy(AR);
    await waitFor(() => expect(documentIn(panel)).not.toBeNull());
    const paper = documentIn(panel) as HTMLElement;
    expect(document.documentElement.dir).toBe('rtl');
    expect(within(paper).getByRole('heading', { level: 1 })).toHaveTextContent(
      AR['creditNotes.print.title'] as string
    );
    expect(within(paper).getByTestId('credit-note-print-reference')).toHaveTextContent(
      'INV-000123'
    );
    expect(paper).toHaveTextContent(
      formatMoney({ amount: '40.5000', currency: 'JOD', minorUnit: 3 }, 'ar')
    );
    expect(paper).toHaveTextContent(AR['creditNotes.print.noNumber'] as string);
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
    // The detail stays on the screen beside the copy.
    expect(document.getElementById('credit-note-detail-heading')).toHaveTextContent(
      EN['creditNotes.detail.heading'] as string
    );

    const printButton = within(panel).getByRole('button', {
      name: EN['creditNotes.print.print'] as string,
    });
    expect(printButton.closest('[data-print="hide"]')).not.toBeNull();
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    await user.click(printButton);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('says the copy is unavailable when the read fails, and prints once it is read again', async () => {
    renderScreen();
    // The screen's own detail has read the note before the copy's read fails.
    await screen.findByTestId('credit-note-requested-by');
    readCreditNote.mockResolvedValue({ status: 'unavailable', correlationId: 'ref-1' });
    const { user, panel } = await openCopy();
    const failure = await within(panel).findByTestId('credit-note-print-unavailable');
    expect(failure).toHaveTextContent(EN['creditNotes.print.unavailable'] as string);
    expect(documentIn(panel)).toBeNull();
    expect(
      within(panel).queryByRole('button', { name: EN['creditNotes.print.print'] as string })
    ).toBeNull();

    readCreditNote.mockResolvedValue(okRead(note()));
    await user.click(
      within(failure).getByRole('button', { name: EN['creditNotes.print.retry'] as string })
    );
    await waitFor(() => expect(documentIn(panel)).not.toBeNull());
  });
});

describe('the credit-note copy, document only', () => {
  const renderDocument = (over: Record<string, unknown>, locale: 'en' | 'ar' = 'en') =>
    (locale === 'en' ? renderLtr : renderRtl)(
      <CreditNoteDocument
        locale={locale}
        messages={locale === 'en' ? en : ar}
        note={note(over) as never}
      />
    );

  it('writes a zero-decimal currency without decimals', () => {
    const { container } = renderDocument({
      amount: { amount: '1500.0000', currency: 'JPY', minorUnit: 0 },
    });
    expect(container).toHaveTextContent('1,500 JPY');
    expect(container.textContent).not.toContain('1,500.0');
  });

  it('names itself on every printed page by the same reference as its header, and invents no number', () => {
    // Pages after the first otherwise carried nothing that said which note they
    // belonged to (2026-10-07 browser retest). A credit note has no number of
    // its own, so the repeated row carries the composed reference — and only it.
    for (const over of [{}, { invoice: null }]) {
      const { getByTestId, unmount } = renderDocument(over);
      const identity = getByTestId('print-document-identity');
      expect(identity.tagName).toBe('THEAD');
      const classes = identity.className.split(/\s+/);
      expect(classes).toContain('hidden');
      expect(classes).toContain('print:table-header-group');
      const reference = getByTestId('credit-note-print-reference').textContent ?? '';
      expect(reference.length).toBeGreaterThan(0);
      expect(identity.textContent).toBe(`${EN['creditNotes.print.title']} · ${reference}`);
      unmount();
    }
  });

  it('identifies a note whose invoice has no number by its request time alone', () => {
    const { getByTestId } = renderDocument({ invoice: null });
    expect(getByTestId('credit-note-print-reference')).toHaveTextContent('Credit note requested');
    expect(getByTestId('credit-note-print-invoice')).toHaveTextContent(
      EN['creditNotes.detail.invoiceUnavailable'] as string
    );
    expect(getByTestId('credit-note-print-customer')).toHaveTextContent(
      EN['creditNotes.detail.customerNotShown'] as string
    );
  });

  it('prints a rejection with who rejected it, when, and why, and a withheld name as not shown', () => {
    const { container, getByTestId } = renderDocument({
      approvalState: 'rejected',
      approvedBy: null,
      approvedAt: null,
      issuedAt: null,
      approvedByName: null,
      decidedBy: APPROVER,
      decidedAt: '2026-09-21T11:00:00Z',
      decidedByName: null,
      decisionReason: 'The part was billed once only',
      sourceReturn: null,
    });
    expect(container).toHaveTextContent(EN['creditNotes.state.rejected'] as string);
    expect(container).toHaveTextContent(EN['creditNotes.detail.rejectedAt'] as string);
    expect(container).toHaveTextContent('The part was billed once only');
    expect(getByTestId('credit-note-print-decided-by')).toHaveTextContent(
      EN['creditNotes.detail.nameNotShown'] as string
    );
    expect(getByTestId('credit-note-print-source')).toHaveTextContent(
      EN['creditNotes.detail.sourceByHand'] as string
    );
    expect(container.textContent).not.toContain(APPROVER);
  });

  it('prints a pending note as not approved yet, and a withdrawn one with its date', () => {
    const pending = renderDocument({
      approvalState: 'pending',
      approvedBy: null,
      approvedAt: null,
      approvedByName: null,
    });
    expect(pending.container).toHaveTextContent(EN['creditNotes.detail.notApproved'] as string);
    pending.unmount();

    const withdrawn = renderDocument({
      approvalState: 'withdrawn',
      approvedBy: null,
      approvedAt: null,
      approvedByName: null,
      decidedBy: REQUESTER,
      decidedAt: '2026-09-19T09:00:00Z',
      decidedByName: 'Rana Saleh',
    });
    expect(withdrawn.container).toHaveTextContent(EN['creditNotes.state.withdrawn'] as string);
    expect(withdrawn.container).toHaveTextContent(EN['creditNotes.detail.withdrawnBy'] as string);
    expect(withdrawn.container).toHaveTextContent(EN['creditNotes.detail.withdrawnAt'] as string);
  });
});
