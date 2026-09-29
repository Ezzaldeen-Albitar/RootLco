'use client';

import { PrintDocument, PrintTable } from '@/components/print/PrintDocument';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';

import type { ReceiptDetail } from '../payments-contract';
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
 * ## The payer is named; the invoices are not, because no read numbers them
 *
 * The payer is printed by name when the screen could name them — the receipt
 * list names the payer for a caller who may read customers — and otherwise the
 * copy says the name is not shown; the payer's reference is never printed. No
 * receipt read carries the cashier who took the money — `received_by` is stored
 * and deliberately never selected. Each allocation names its invoice by
 * reference and never by number: reading a number would take one
 * `sal.invoice-detail` call per allocation, and that operation requires
 * `sal.invoice.manage`, a code the cashier printing this receipt does not hold.
 * The document says so rather than leaving blanks that look like a fault.
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
    <span key="i" className="font-mono" dir="ltr">
      {allocation.invoiceId}
    </span>,
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
                translate(messages, 'payments.list.payerNotShown')
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
          {translate(messages, 'payments.print.identifiersOnly')}
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
