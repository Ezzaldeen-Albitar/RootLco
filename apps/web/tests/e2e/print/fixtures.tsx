import type { ReactElement, ReactNode } from 'react';
import en from '../../../src/i18n/messages/en.json';
import ar from '../../../src/i18n/messages/ar.json';
import { PrintToolbar } from '@/components/print/PrintToolbar';
import { PageBody, PageHeader } from '@/components/shell/PageHeader';
import type {
  CreditNoteDetail,
  InvoiceDetail,
  Outstanding,
} from '@/features/billing/billing-contract';
import { CreditNoteDocument } from '@/features/billing/components/CreditNotePrint';
import { InvoiceDocument } from '@/features/billing/components/InvoiceDocument';
import { DeliveryDocument } from '@/features/delivery/components/DeliveryDocument';
import { ReceiptDocument } from '@/features/payments/components/ReceiptDocument';
import type { ReceiptDetail } from '@/features/payments/payments-contract';
import { QuotationDocument } from '@/features/quotations/components/QuotationPrint';
import { AcknowledgementDocument } from '@/features/receptions/components/AcknowledgementDocument';
import type { ReceptionDetail } from '@/features/receptions/receptions-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';

/**
 * The seven printable documents, each inside the page that prints it.
 *
 * Every document is the REAL component with fixture props. What surrounds it is
 * a copy of the page as the application composes it — the shell's boxes, the
 * page header and body, the print scope, and the panel the copy opens in, with
 * the classes those carry — because the print defects this guards against were
 * never inside a document: a page heading printed above one, and a panel's
 * padding pushed one off its first page. The source each copy follows is named
 * beside it; `tests/gallery-and-print.dom.test.tsx` and the page tests hold the
 * pages themselves to the same scope.
 *
 * Fixture values are test data, named as such.
 */

export const MESSAGES: Record<Locale, Messages> = { en: en as Messages, ar: ar as Messages };

export type DocumentName =
  | 'invoice'
  | 'counter-sale'
  | 'receipt'
  | 'quotation'
  | 'credit-note'
  | 'delivery'
  | 'acknowledgement';

export interface PrintCase {
  readonly document: DocumentName;
  readonly locale: Locale;
  /** The document's title, as its identity row and its own header print it. */
  readonly title: string;
  /**
   * What the identity row prints beside the title: the document's number, or
   * for the credit note (which has none) the credited invoice's. `null` when the
   * row is the title alone because the title already carries the number.
   */
  readonly reference: string;
  /** Screen text around the document that must never reach the paper. */
  readonly chrome: readonly string[];
  readonly page: () => ReactElement;
}

/** Marker text the shell's own chrome carries in these copies. */
export const SHELL_CHROME = ['Navigation of the test shell', 'Header of the test shell'] as const;

const t = (locale: Locale, key: string): string => {
  const value = (MESSAGES[locale] as unknown as Record<string, string>)[key];
  if (value === undefined) throw new Error(`no ${locale} message ${key}`);
  return value;
};

/** `components/shell/AppShell.tsx`: the shell's boxes around a page. */
function Shell({ children }: { readonly children: ReactNode }) {
  return (
    <div
      data-app-shell="root"
      className="relative flex h-dvh overflow-hidden bg-app-background text-text-primary"
    >
      <nav data-print="hide" className="w-64 shrink-0">
        {SHELL_CHROME[0]}
      </nav>
      <div data-app-shell="column" className="flex min-w-0 flex-1 flex-col">
        <header
          data-print="hide"
          className="z-header flex h-16 shrink-0 items-center gap-2 border-b border-border-subtle bg-surface px-4 shadow-xs"
        >
          {SHELL_CHROME[1]}
        </header>
        <div data-app-shell="body" className="flex min-h-0 flex-1">
          <main
            id="main"
            data-scroll-region="main"
            className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto overscroll-contain focus:outline-none"
          >
            {children}
          </main>
        </div>
      </div>
    </div>
  );
}

/** A page whose header and body share one print scope. */
function ScopedPage({
  locale,
  titleKey,
  descriptionKey,
  children,
}: {
  readonly locale: Locale;
  readonly titleKey: string;
  readonly descriptionKey: string;
  readonly children: ReactNode;
}) {
  return (
    <Shell>
      <div data-print-scope="document">
        <PageHeader
          locale={locale}
          messages={MESSAGES[locale]}
          titleKey={titleKey}
          descriptionKey={descriptionKey}
        />
        <PageBody>
          {/* `ConcreteRouteGate` renders the screen inside a `contents` box. */}
          <div className="contents">{children}</div>
        </PageBody>
      </div>
    </Shell>
  );
}

/** A working panel a screen shows beside the copy; marked for the screen only. */
function WorkingPanel({ label }: { readonly label: string }) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4" data-print="hide">
      {label}
    </section>
  );
}

/** A panel left unmarked, which only the print scope keeps off the paper. */
function UnmarkedPanel({ label }: { readonly label: string }) {
  return <p className="rounded-md border border-border bg-surface p-3 text-body">{label}</p>;
}

const JOD = (amount: string) => ({ amount, currency: 'JOD' });

// --- the invoice: `app/[locale]/(dashboard)/invoices/page.tsx`, `InvoiceScreen`

export function invoiceDetail(lines: number): InvoiceDetail {
  return {
    invoice: {
      id: 'invoice-of-the-test',
      companyId: 'company-of-the-test',
      branchId: 'branch-of-the-test',
      workOrderId: 'work-order-of-the-test',
      saleKind: 'work_order',
      quotationRevisionId: 'revision-of-the-test',
      payerPartnerId: 'payer-of-the-test',
      currency: 'JOD',
      status: 'issued',
      invoiceNumber: '000021',
      issuedAt: '2026-10-06T18:31:00.000Z',
      recordVersion: 3,
      totals: { net: JOD('44.6900'), tax: JOD('0.0000'), gross: JOD('44.6900') },
    },
    lines: Array.from({ length: lines }, (_, index) => {
      const service = index % 2 === 0;
      return {
        id: `line-${index + 1}`,
        lineNumber: index + 1,
        lineType: service ? 'service' : 'part',
        quantity: service ? '0.500' : '2.000',
        currency: 'JOD',
        sourceQuotationItemId: `quotation-line-${index + 1}`,
        item: null,
        unit: null,
        source: {
          description: `Test ${service ? 'service' : 'part'} line ${index + 1}`,
          quotedQuantity: service ? '0.500' : '2.000',
          discount: JOD('0.0000'),
        },
        recordVersion: 1,
        money: {
          unitPrice: JOD(service ? '40.0000' : '12.3450'),
          net: JOD(service ? '20.0000' : '24.6900'),
          tax: JOD('0.0000'),
          gross: JOD(service ? '20.0000' : '24.6900'),
          payerSplit: { customer: JOD(service ? '20.0000' : '24.6900'), warranty: JOD('0.0000') },
        },
      } as InvoiceDetail['lines'][number];
    }),
    source: {
      quotationRevisionId: 'revision-of-the-test',
      lineCount: lines,
      subtotal: JOD('44.6900'),
      discountTotal: JOD('0.0000'),
    },
    recordVersion: 3,
  };
}

const BALANCE: Outstanding = {
  invoiceId: 'invoice-of-the-test',
  status: 'issued',
  outstanding: JOD('44.6900'),
  isSettled: false,
  settlement: {
    creditStatus: 'none',
    paymentStatus: 'open',
    refundStatus: 'none',
    credited: JOD('0.0000'),
    paid: JOD('0.0000'),
    thirdPartyPayments: [],
    thirdPartyPaymentsTruncated: false,
  },
  asOf: '2026-10-07T21:13:00.000Z',
};

export function invoiceCase(locale: Locale, lines = 2): PrintCase {
  const messages = MESSAGES[locale];
  return {
    document: 'invoice',
    locale,
    title: t(locale, 'invoices.print.title'),
    reference: '000021',
    chrome: [t(locale, 'invoices.page.description'), t(locale, 'invoices.print.heading')],
    page: () => (
      <ScopedPage
        locale={locale}
        titleKey="invoices.page.title"
        descriptionKey="invoices.page.description"
      >
        <div data-print-scope="document" className="flex min-h-0 flex-col gap-4">
          <WorkingPanel label="Work order panel of the test" />
          <section
            aria-labelledby="invoice-print-heading"
            className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
            lang={locale}
          >
            <div className="flex flex-wrap items-center gap-3" data-print="hide">
              <h2 id="invoice-print-heading" className="text-body font-medium text-text-primary">
                {t(locale, 'invoices.print.heading')}
              </h2>
            </div>
            <InvoiceDocument
              locale={locale}
              messages={messages}
              detail={invoiceDetail(lines)}
              descriptions={{ kind: 'source' }}
              workOrderNumber="000011"
              payer={{ kind: 'named', name: 'Paying customer of the test' }}
              balance={BALANCE}
            />
          </section>
        </div>
      </ScopedPage>
    ),
  };
}

// --- the counter sale: `app/[locale]/(dashboard)/inventory/counter-sales/page.tsx`,
// `CounterSalesScreen` (the screen's scope) and `SaleView` (the sale's scope)

/** A counter sale of `lines` parts: no work order, each line naming the item sold. */
export function counterSaleDetail(lines: number): InvoiceDetail {
  const job = invoiceDetail(lines);
  return {
    ...job,
    invoice: {
      ...job.invoice,
      workOrderId: null,
      saleKind: 'counter_sale',
      quotationRevisionId: null,
    },
    lines: job.lines.map((line, index) => ({
      ...line,
      lineType: 'part',
      sourceQuotationItemId: null,
      source: null,
      item: {
        id: `item-${index + 1}`,
        code: `SKU-TEST-${index + 1}`,
        name: `Test part of the counter ${index + 1}`,
      },
    })),
    source: null,
  };
}

export function counterSaleCase(locale: Locale, lines = 2): PrintCase {
  const messages = MESSAGES[locale];
  return {
    document: 'counter-sale',
    locale,
    title: t(locale, 'invoices.print.title'),
    reference: '000021',
    chrome: [
      t(locale, 'inventory.counterSales.description'),
      t(locale, 'inventory.counterSales.explain'),
      t(locale, 'invoices.print.heading'),
    ],
    page: () => (
      <ScopedPage
        locale={locale}
        titleKey="inventory.counterSales.title"
        descriptionKey="inventory.counterSales.description"
      >
        <div data-print-scope="document" className="flex min-h-0 flex-col gap-4">
          <UnmarkedPanel label={t(locale, 'inventory.counterSales.explain')} />
          <div data-print-scope="document" className="flex min-h-0 flex-col gap-4">
            <WorkingPanel label="Sale panel of the test" />
            <section
              aria-labelledby="invoice-print-heading"
              className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
              lang={locale}
            >
              <div className="flex flex-wrap items-center gap-3" data-print="hide">
                <h2 id="invoice-print-heading" className="text-body font-medium text-text-primary">
                  {t(locale, 'invoices.print.heading')}
                </h2>
              </div>
              <InvoiceDocument
                locale={locale}
                messages={messages}
                detail={counterSaleDetail(lines)}
                descriptions={{ kind: 'items' }}
                workOrderNumber={null}
                payer={{ kind: 'named', name: 'Paying customer of the test' }}
                balance={BALANCE}
              />
            </section>
          </div>
        </div>
      </ScopedPage>
    ),
  };
}

// --- the receipt: `app/[locale]/(dashboard)/payments/page.tsx`, `PaymentsScreen`

const RECEIPT: ReceiptDetail = {
  id: 'receipt-of-the-test',
  reference: '000002',
  companyId: 'company-of-the-test',
  branchId: 'branch-of-the-test',
  payerPartnerId: 'payer-of-the-test',
  method: {
    id: 'method-of-the-test',
    scope: 'tenant',
    kind: 'cash',
    displayName: 'Cash method of the test',
    status: 'active',
  },
  money: JOD('25.0000'),
  unallocated: JOD('0.0000'),
  status: 'allocated',
  receivedAt: '2026-10-06T18:40:00.000Z',
  evidenceDocumentVersionId: null,
  recordVersion: 1,
  allocations: [
    {
      id: 'allocation-of-the-test',
      sequence: '1',
      invoiceId: 'invoice-of-the-test',
      invoiceNumber: '000021',
      invoicePayerName: 'Paying customer of the test',
      money: JOD('25.0000'),
      allocatedAt: '2026-10-06T18:41:00.000Z',
    },
  ],
  allocationsTruncated: false,
  reversal: null,
  replaces: null,
  replacedBy: null,
};

function receiptCase(locale: Locale): PrintCase {
  return {
    document: 'receipt',
    locale,
    title: t(locale, 'payments.print.title'),
    reference: '000002',
    chrome: [
      t(locale, 'payments.page.description'),
      t(locale, 'payments.print.heading'),
      t(locale, 'payments.print.explain'),
    ],
    page: () => (
      <ScopedPage
        locale={locale}
        titleKey="payments.page.title"
        descriptionKey="payments.page.description"
      >
        <div data-print-scope="document" className="flex flex-col gap-6">
          <WorkingPanel label="Branch panel of the test" />
          <UnmarkedPanel label="Write notice of the test" />
          <section
            aria-label={t(locale, 'payments.print.heading')}
            className="rounded-md border border-border bg-surface p-4"
          >
            <div data-print="hide" className="flex flex-col gap-2">
              <h2 className="text-section-title">{t(locale, 'payments.print.heading')}</h2>
              <p className="text-body text-text-secondary">{t(locale, 'payments.print.explain')}</p>
            </div>
            <div className="mt-4" id="payments-print">
              <ReceiptDocument
                locale={locale}
                messages={MESSAGES[locale]}
                receipt={RECEIPT}
                payer={{ kind: 'named', name: 'Paying customer of the test' }}
              />
            </div>
          </section>
        </div>
      </ScopedPage>
    ),
  };
}

// --- the quotation: `app/[locale]/(dashboard)/quotations/[quotationId]/page.tsx`,
// `QuotationDetailScreen`, `QuotationPrintPanel`

function quotationLine(index: number) {
  const service = index % 2 === 0;
  return {
    id: `quotation-line-${index + 1}`,
    lineNumber: index + 1,
    itemKind: service ? 'service' : 'part',
    serviceId: service ? 'service-of-the-test' : null,
    item: service
      ? null
      : { id: 'item-of-the-test', code: 'TEST-PART', name: `Test part line ${index + 1}` },
    unit: service ? null : { code: 'each', name: 'Each' },
    description: service ? `Test service line ${index + 1}` : null,
    currency: 'JOD',
    unitPrice: '40.0000',
    quantity: '0.500',
    discount: '0.0000',
    taxRate: '0.000000',
    taxAmount: '0.0000',
    lineTotal: '20.0000',
    priceRuleRef: null,
  };
}

const QUOTATION_LINES = 14;

/**
 * The quotation's subtotal and grand total, a figure no line prints, so a printed
 * page can be told to hold the totals by it in any language and with any font.
 */
export const QUOTATION_TOTAL = '987.654';

function quotationRevision(lines: number) {
  return {
    id: 'revision-of-the-test',
    revisionNumber: 2,
    status: 'issued',
    currency: 'JOD',
    issuedAt: '2026-10-06T18:32:00.000Z',
    expiresAt: null,
    subtotal: '987.6540',
    discountTotal: '0.0000',
    taxTotal: '0.0000',
    grandTotal: '987.6540',
    recordVersion: 1,
    lines: Array.from({ length: lines }, (_, index) => quotationLine(index)),
    discountApproval: null,
  };
}

/** The quotation of `lines` lines (fourteen unless a test asks for a longer one). */
export function quotationCase(locale: Locale, lines = QUOTATION_LINES): PrintCase {
  const revision = quotationRevision(lines);
  return {
    document: 'quotation',
    locale,
    title: t(locale, 'quotations.print.title'),
    reference: '000012',
    chrome: [t(locale, 'quotations.detail.description'), t(locale, 'quotations.print.heading')],
    page: () => (
      <ScopedPage
        locale={locale}
        titleKey="quotations.detail.title"
        descriptionKey="quotations.detail.description"
      >
        <div data-print-scope="document" className="flex flex-col gap-4">
          <WorkingPanel label="Current revision panel of the test" />
          <section
            aria-labelledby="quotation-print-heading"
            className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 print:border-0 print:p-0"
          >
            <div className="flex flex-wrap items-center gap-3" data-print="hide">
              <h2 id="quotation-print-heading" className="text-body font-medium text-text-primary">
                {t(locale, 'quotations.print.heading')}
              </h2>
            </div>
            <QuotationDocument
              locale={locale}
              messages={MESSAGES[locale]}
              quotation={
                {
                  id: 'quotation-of-the-test',
                  quotationNumber: '000012',
                  workOrderId: 'work-order-of-the-test',
                  companyId: 'company-of-the-test',
                  branchId: 'branch-of-the-test',
                  currency: 'JOD',
                  status: 'active',
                  payerPartnerRef: 'payer-of-the-test',
                  currentRevisionId: revision.id,
                  recordVersion: 5,
                  currentRevision: revision,
                } as never
              }
              revision={revision as never}
              decisions={
                {
                  quotationId: 'quotation-of-the-test',
                  revisionId: revision.id,
                  revisionStatus: 'issued',
                  itemCount: lines,
                  decidedCount: lines,
                  outcome: 'accepted',
                  decisions: [],
                  acceptance: {
                    id: 'acceptance-of-the-test',
                    quotationRevisionId: revision.id,
                    customerPartnerId: 'payer-of-the-test',
                    contactName: 'Contact of the test',
                    contactPhone: null,
                    channel: 'in_person',
                    evidenceKind: 'verbal',
                    referenceNote: null,
                    documentVersionId: null,
                    acceptedAt: '2026-10-06T18:33:00.000Z',
                    recordedBy: { id: 'recorder-of-the-test', displayName: 'Recorder of the test' },
                    recordedByCaller: false,
                  },
                } as never
              }
              workOrder={
                {
                  id: 'work-order-of-the-test',
                  companyId: 'company-of-the-test',
                  branchId: 'branch-of-the-test',
                  receptionVisitId: 'visit-of-the-test',
                  vehicleId: 'vehicle-of-the-test',
                  kind: 'ordinary',
                  state: 'open',
                  partsForwardState: 'none',
                  displayNumber: '000011',
                  openedAt: '2026-10-06T18:00:00.000Z',
                  recordVersion: 2,
                  customer: {
                    partnerId: 'payer-of-the-test',
                    displayName: 'Customer of the test',
                    relationshipRole: 'vehicle_owner',
                    hasAdditionalParties: false,
                  },
                  vehicle: {
                    vehicleId: 'vehicle-of-the-test',
                    registrationPlate: 'TEST-1',
                    makeModel: 'Vehicle of the test',
                  },
                  assignedTechnician: null,
                  completedAt: null,
                  qualityState: null,
                } as never
              }
              branchName="Branch of the test"
            />
          </section>
        </div>
      </ScopedPage>
    ),
  };
}

// --- the credit note: `app/[locale]/(dashboard)/credit-notes/page.tsx`,
// `CreditNotesScreen`, `CreditNotePrintPanel`

const CREDIT_NOTE: CreditNoteDetail = {
  id: 'credit-note-of-the-test',
  invoiceId: 'invoice-of-the-test',
  companyId: 'company-of-the-test',
  branchId: 'branch-of-the-test',
  amount: { amount: '5.0000', currency: 'JOD', minorUnit: 3 },
  reason: 'Reason of the test',
  approvalState: 'approved',
  requestedBy: 'requester-of-the-test',
  approvedBy: 'approver-of-the-test',
  approvedAt: '2026-10-01T07:00:00.000Z',
  issuedAt: '2026-10-01T07:00:00.000Z',
  decidedBy: null,
  decidedAt: null,
  decisionReason: null,
  recordVersion: 2,
  requestedAt: '2026-10-01T06:50:00.000Z',
  requestedByName: 'Requester of the test',
  approvedByName: 'Approver of the test',
  decidedByName: null,
  invoice: {
    invoiceNumber: '000007',
    saleKind: 'work_order',
    workOrderId: 'work-order-of-the-test',
    payerName: 'Paying customer of the test',
  },
  sourceReturn: null,
};

function creditNoteCase(locale: Locale): PrintCase {
  return {
    document: 'credit-note',
    locale,
    title: t(locale, 'creditNotes.print.title'),
    // No number of its own: the credited invoice's is what identifies it.
    reference: '000007',
    chrome: [t(locale, 'creditNotes.page.description'), t(locale, 'creditNotes.print.heading')],
    page: () => (
      <ScopedPage
        locale={locale}
        titleKey="creditNotes.page.title"
        descriptionKey="creditNotes.page.description"
      >
        <div data-print-scope="document" className="flex min-h-0 flex-col gap-4">
          <WorkingPanel label="Credit note list of the test" />
          <section
            aria-labelledby="credit-note-print-heading"
            className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 print:border-0 print:p-0"
          >
            <div className="flex flex-wrap items-center gap-3" data-print="hide">
              <h2
                id="credit-note-print-heading"
                className="text-body font-medium text-text-primary"
              >
                {t(locale, 'creditNotes.print.heading')}
              </h2>
            </div>
            <CreditNoteDocument locale={locale} messages={MESSAGES[locale]} note={CREDIT_NOTE} />
          </section>
        </div>
      </ScopedPage>
    ),
  };
}

// --- the handover sheet: `app/[locale]/(dashboard)/delivery/[deliveryId]/page.tsx`,
// `DeliveryDetailScreen`, `DeliveryDocumentPanel`

const read = <T,>(value: T) => ({ kind: 'read' as const, value });
const rows = <T,>(list: readonly T[]) => ({ kind: 'read' as const, rows: list, hasMore: false });

function deliveryCase(locale: Locale): PrintCase {
  const signatures = (['receiver', 'service_advisor'] as const).map((role, index) => ({
    id: `signature-${index}`,
    deliveryRecordId: 'delivery-of-the-test',
    signerRole: role,
    signatureDocumentVersionId: `signature-document-${index}`,
    signedAt: '2026-10-06T19:00:00.000Z',
  }));
  const checklist = Array.from({ length: 6 }, (_, index) => ({
    id: `result-${index}`,
    deliveryRecordId: 'delivery-of-the-test',
    templateItemId: `item-${index}`,
    itemCode: `CHECK-${index + 1}`,
    label: `Checklist item ${index + 1} of the test`,
    outcome: 'passed',
    waiverReason: null,
    recordedBy: 'employee-of-the-test',
    recordVersion: 1,
  }));
  const history = (['pending', 'ready', 'signed'] as const).map((from, index) => ({
    id: `transition-${index}`,
    fromStatus: from,
    toStatus: (['ready', 'signed', 'delivered'] as const)[index],
    reason: null,
    actorId: 'employee-of-the-test',
    actorDisplayName: 'Recording employee of the test',
    occurredAt: '2026-10-06T19:00:00.000Z',
  }));
  return {
    document: 'delivery',
    locale,
    title: t(locale, 'delivery.document.title'),
    reference: '000001',
    chrome: [t(locale, 'delivery.detail.description'), t(locale, 'delivery.document.heading')],
    page: () => (
      <ScopedPage
        locale={locale}
        titleKey="delivery.detail.title"
        descriptionKey="delivery.detail.description"
      >
        <div data-print-scope="document" className="flex min-h-0 flex-col gap-6">
          <UnmarkedPanel label="Release panel of the test" />
          <section
            aria-labelledby="delivery-document-heading"
            className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4 print:border-0 print:p-0"
          >
            <div className="flex flex-wrap items-center gap-3" data-print="hide">
              <h2
                id="delivery-document-heading"
                className="text-body font-medium text-text-primary"
              >
                {t(locale, 'delivery.document.heading')}
              </h2>
            </div>
            <DeliveryDocument
              locale={locale}
              messages={MESSAGES[locale]}
              delivery={
                {
                  id: 'delivery-of-the-test',
                  companyId: 'company-of-the-test',
                  branchId: 'branch-of-the-test',
                  workOrderId: 'work-order-of-the-test',
                  receptionVisitId: 'visit-of-the-test',
                  vehicleId: 'vehicle-of-the-test',
                  deliveringEmployeeId: 'employee-of-the-test',
                  deliveringEmployeeDisplayName: 'Delivering employee of the test',
                  status: 'delivered',
                  deliveredAt: '2026-10-06T19:05:00.000Z',
                  finalOdometerReadingId: null,
                  recordVersion: 7,
                } as never
              }
              workOrder={
                read({
                  workOrder: {
                    id: 'work-order-of-the-test',
                    companyId: 'company-of-the-test',
                    branchId: 'branch-of-the-test',
                    receptionVisitId: 'visit-of-the-test',
                    vehicleId: 'vehicle-of-the-test',
                    kind: 'repair',
                    state: 'handed_over',
                    partsForwardState: 'none',
                    displayNumber: '000001',
                    openedAt: '2026-10-06T18:00:00.000Z',
                    recordVersion: 3,
                    customer: {
                      partnerId: 'payer-of-the-test',
                      displayName: 'Customer of the test',
                      relationshipRole: 'service_requester',
                      hasAdditionalParties: false,
                    },
                    vehicle: {
                      vehicleId: 'vehicle-of-the-test',
                      registrationPlate: 'TEST-1',
                      makeModel: 'Vehicle of the test',
                    },
                  },
                  jobs: [],
                  nextStates: [],
                }) as never
              }
              eligibility={
                read({
                  deliveryId: 'delivery-of-the-test',
                  workOrderId: 'work-order-of-the-test',
                  status: 'delivered',
                  eligible: true,
                  blockers: [],
                  overridden: [],
                  facts: [],
                  checklistGaps: [],
                  overridable: [],
                  recordVersion: 7,
                }) as never
              }
              receiver={
                read({
                  id: 'receiver-of-the-test',
                  deliveryRecordId: 'delivery-of-the-test',
                  receiverPartnerId: 'payer-of-the-test',
                  receiverDisplayName: 'Receiving person of the test',
                  identityEvidenceDocumentVersionId: 'evidence-of-the-test',
                  verifiedBy: 'employee-of-the-test',
                  verifiedByDisplayName: 'Verifying employee of the test',
                  verifiedAt: '2026-10-06T18:50:00.000Z',
                  recordVersion: 1,
                }) as never
              }
              checklist={rows(checklist) as never}
              signatures={rows(signatures) as never}
              history={rows(history) as never}
            />
          </section>
        </div>
      </ScopedPage>
    ),
  };
}

// --- the reception acknowledgement:
// `app/[locale]/(dashboard)/receptions/check-in/[receptionId]/acknowledgement/page.tsx`

const RECEPTION: ReceptionDetail = {
  id: 'reception-of-the-test',
  displayNumber: '000028',
  receptionStatus: 'converted',
  origin: 'walk_in',
  appointmentId: null,
  walkInId: 'walk-in-of-the-test',
  companyId: 'company-of-the-test',
  branchId: 'branch-of-the-test',
  vehicleId: 'vehicle-of-the-test',
  vehicleDisplayNumber: 'TEST-VEH-3',
  odometerReadingId: null,
  fuelLevelId: null,
  fuelLevelName: null,
  evSocPercent: null,
  receivingEmployeeId: 'employee-of-the-test',
  receivingEmployeeDisplayName: 'Receiving employee of the test',
  custodyAcceptedAt: '2026-10-04T07:01:00.000Z',
  custodyReleasedAt: null,
  recordVersion: 7,
  createdAt: '2026-10-04T07:00:00.000Z',
  updatedAt: null,
};

const section = (list: readonly unknown[]) => ({
  status: 'ok' as const,
  rows: list,
  hasMore: false,
  correlationId: null,
});

function acknowledgementCase(locale: Locale): PrintCase {
  return {
    document: 'acknowledgement',
    locale,
    title: t(locale, 'receptions.acknowledgement.title'),
    reference: '000028',
    chrome: [
      t(locale, 'receptions.acknowledgement.description'),
      t(locale, 'receptions.acknowledgement.print'),
      t(locale, 'receptions.acknowledgement.backToVisit'),
    ],
    page: () => (
      <Shell>
        <div data-print-scope="document">
          <PageHeader
            locale={locale}
            messages={MESSAGES[locale]}
            titleKey="receptions.acknowledgement.title"
            descriptionKey="receptions.acknowledgement.description"
          />
          <PageBody>
            <div className="contents">
              <div data-print-scope="document" className="flex flex-col gap-4">
                <PrintToolbar
                  printLabel={t(locale, 'receptions.acknowledgement.print')}
                  backHref="/"
                  backLabel={t(locale, 'receptions.acknowledgement.backToVisit')}
                />
                <AcknowledgementDocument
                  locale={locale}
                  messages={MESSAGES[locale]}
                  detail={RECEPTION}
                  sections={
                    {
                      parties: section([
                        {
                          id: 'party-of-the-test',
                          partnerId: 'payer-of-the-test',
                          partnerDisplayName: 'Party of the test',
                          partnerDisplayNumber: 'TEST-0001',
                          relationshipRole: 'service_requester',
                          validFrom: '2026-10-04T07:01:00.000Z',
                          validTo: null,
                          assignmentSource: 'front desk',
                          recordVersion: 1,
                        },
                      ]),
                      authorizations: section([
                        {
                          kind: 'authorization',
                          id: 'authorization-of-the-test',
                          partnerId: 'payer-of-the-test',
                          partnerDisplayName: 'Party of the test',
                          authorizingRole: 'service_requester',
                          decision: 'approved',
                          channel: 'in_person',
                          authorizedScope: null,
                          evidenceDocumentId: null,
                          occurredAt: '2026-10-04T07:05:00.000Z',
                          isStanding: true,
                        },
                      ]),
                      evidence: section([]),
                    } as never
                  }
                />
              </div>
            </div>
          </PageBody>
        </div>
      </Shell>
    ),
  };
}

/** The seven documents, as each prints in `locale`. */
export function printCases(locale: Locale): PrintCase[] {
  return [
    invoiceCase(locale),
    counterSaleCase(locale),
    receiptCase(locale),
    quotationCase(locale),
    creditNoteCase(locale),
    deliveryCase(locale),
    acknowledgementCase(locale),
  ];
}
