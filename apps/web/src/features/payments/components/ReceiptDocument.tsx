'use client';

import { PrintDocument, PrintTable } from '@/components/print/PrintDocument';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';

import type { ReceiptAllocation, ReceiptDetail } from '../payments-contract';
import { Money, When } from './shared';

/**
 * Who paid, as the screen could name them: by name, still being found, or not
 * shown to this reader. Never the payer's reference (browser QA row 5.6b).
 */
export type ReceiptPayerName =
  | { readonly kind: 'named'; readonly name: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'notShown' };

/**
 * The printable receipt (P1-30, `W7`, FE-021).
 *
 * The backend publishes no print or document route, so the paper view is
 * composed here from the one read that has everything: `sal.receipt-detail`,
 * which carries the reference, the method, the amount, the remainder and the
 * allocation history. No PDF is generated: this is HTML that prints well.
 *
 * ## The payer and the invoices are named, never referenced
 *
 * The payer is printed by name when the screen could name them — the receipt
 * list names the payer for a caller who may read customers — and otherwise the
 * copy says the name is not shown; the payer's reference is never printed. The
 * screen hands this copy over only once the name lookup has settled, so it never
 * says "not shown" for a payer about to be named. Each allocation names its
 * invoice by number, with the customer that invoice bills where the reader may
 * read customers: `sal.receipt-detail` publishes both beside each allocation
 * (finance retest DF-R2-2), so no invoice reference is printed. No receipt read
 * carries the cashier who took the money — `received_by` is stored and
 * deliberately never selected — and the document says so.
 *
 * ## Dates read in order in both languages
 *
 * Every moment is isolated in the reader's direction (`When`), so an Arabic copy
 * prints the day, month and year in order.
 *
 * ## The remainder is the database's figure
 *
 * `unallocated` is recomputed per call by PostgreSQL; nothing here subtracts an
 * allocation from a total, and the printed remainder is the one the read
 * published at the moment it was taken.
 */
export function ReceiptDocument({
  locale,
  messages,
  receipt,
  payer,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: ReceiptDetail;
  /** Who paid, as the screen could name them. */
  readonly payer: ReceiptPayerName;
}) {
  const headers = [
    translate(messages, 'payments.print.column.invoice'),
    translate(messages, 'payments.print.column.applied'),
    translate(messages, 'payments.print.column.when'),
  ];
  const rows = receipt.allocations.map((allocation) => [
    <AllocatedInvoice key="i" messages={messages} allocation={allocation} />,
    <Money key="a" money={allocation.money} locale={locale} />,
    <When key="w" value={allocation.allocatedAt} locale={locale} />,
  ]);

  return (
    <PrintDocument
      title={translate(messages, 'payments.print.title')}
      header={
        <dl className="grid gap-1">
          <div>
            <dt className="inline text-text-muted">
              {translate(messages, 'payments.print.reference')}{' '}
            </dt>
            <dd className="inline font-mono" dir="ltr">
              {receipt.reference}
            </dd>
          </div>
          <div>
            <dt className="inline text-text-muted">
              {translate(messages, 'payments.print.status')}{' '}
            </dt>
            <dd className="inline">
              {translateDynamic(messages, `payments.status.${receipt.status}`)}
            </dd>
          </div>
          <div>
            <dt className="inline text-text-muted">
              {translate(messages, 'payments.print.receivedAt')}{' '}
            </dt>
            <dd className="inline" data-testid="receipt-print-received-at">
              <When value={receipt.receivedAt} locale={locale} />
            </dd>
          </div>
          <div>
            <dt className="inline text-text-muted">
              {translate(messages, 'payments.print.payer')}{' '}
            </dt>
            <dd className="inline" data-testid="receipt-print-payer">
              {payer.kind === 'named' ? (
                <bdi>{payer.name}</bdi>
              ) : (
                translate(
                  messages,
                  payer.kind === 'loading'
                    ? 'payments.receipt.payerLoading'
                    : 'payments.list.payerNotShown'
                )
              )}
            </dd>
          </div>
          <div>
            <dt className="inline text-text-muted">
              {translate(messages, 'payments.print.method')}{' '}
            </dt>
            <dd className="inline">
              {receipt.method
                ? receipt.method.displayName
                : translate(messages, 'payments.list.methodGone')}
            </dd>
          </div>
        </dl>
      }
      footer={
        <p>
          {translate(messages, 'payments.print.noCashier')}
          {receipt.allocationsTruncated ? (
            <> {translate(messages, 'payments.print.truncated')}</>
          ) : null}
        </p>
      }
    >
      <dl className="grid max-w-xs grid-cols-2 gap-1 text-body">
        <dt className="font-medium">{translate(messages, 'payments.print.received')}</dt>
        <dd className="text-end font-medium">
          <Money money={receipt.money} locale={locale} />
        </dd>
        <dt className="text-text-muted">{translate(messages, 'payments.print.unapplied')}</dt>
        <dd className="text-end">
          <Money money={receipt.unallocated} locale={locale} />
        </dd>
      </dl>

      <div className="mt-6">
        {receipt.allocations.length === 0 ? (
          <p className="text-supporting text-text-muted">
            {translate(messages, 'payments.print.noAllocations')}
          </p>
        ) : (
          <PrintTable
            headers={headers}
            rows={rows}
            caption={translate(messages, 'payments.print.allocationsCaption')}
          />
        )}
      </div>
    </PrintDocument>
  );
}

/**
 * The invoice an allocation went to, as a reader names it (finance retest
 * DF-R2-2): its number, isolated left to right so an Arabic line keeps its
 * digits in order, and the customer it bills where the server named them. An
 * invoice this scope cannot see says so; its reference is never shown. Shared by
 * the receipt panel and this copy, so the screen and the paper name it alike.
 */
export function AllocatedInvoice({
  messages,
  allocation,
}: {
  readonly messages: Messages;
  readonly allocation: ReceiptAllocation;
}) {
  if (allocation.invoiceNumber === null) {
    return (
      <span className="text-text-muted">
        {translate(messages, 'payments.allocations.invoiceNotShown')}
      </span>
    );
  }
  return (
    <span data-testid="receipt-allocation-invoice">
      <bdi className="font-mono" dir="ltr">
        {allocation.invoiceNumber}
      </bdi>
      {allocation.invoicePayerName === null ? null : (
        <>
          {' '}
          <span className="text-text-muted">
            <bdi>{allocation.invoicePayerName}</bdi>
          </span>
        </>
      )}
    </span>
  );
}
