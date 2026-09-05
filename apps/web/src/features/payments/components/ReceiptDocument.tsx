'use client';

import { PrintDocument, PrintTable } from '@/components/print/PrintDocument';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatDateTime } from '@/lib/format';

import type { ReceiptDetail } from '../payments-contract';
import { Money } from './shared';

/**
 * The printable receipt (P1-30, `W7`, FE-021).
 *
 * The backend publishes no print or document route, so the paper view is
 * composed here from the one read that has everything: `sal.receipt-detail`,
 * which carries the reference, the method, the amount, the remainder and the
 * allocation history. No PDF is generated: this is HTML that prints well.
 *
 * ## It names identifiers, because names are not published
 *
 * No receipt read carries a payer NAME, and none carries the cashier who took
 * the money — `received_by` is stored and deliberately never selected. Each
 * allocation names its invoice by identifier and never by number: reading a
 * number would take one `sal.invoice-detail` call per allocation, and that
 * operation requires `sal.invoice.manage`, a code the cashier printing this
 * receipt does not hold. The document says so rather than leaving three blanks
 * that look like a fault.
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
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly receipt: ReceiptDetail;
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
    <span key="w" dir="ltr">
      {formatDateTime(allocation.allocatedAt, locale)}
    </span>,
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
            <dd className="inline" dir="ltr">
              {formatDateTime(receipt.receivedAt, locale)}
            </dd>
          </div>
          <div>
            <dt className="inline text-text-muted">
              {translate(messages, 'payments.print.payer')}{' '}
            </dt>
            <dd className="inline font-mono" dir="ltr">
              {receipt.payerPartnerId}
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
