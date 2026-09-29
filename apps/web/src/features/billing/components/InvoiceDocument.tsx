'use client';

import type { ReactNode } from 'react';

import { PrintDocument, PrintTable } from '@/components/print/PrintDocument';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';

import type { InvoiceDetail, InvoicePreview } from '../billing-contract';
import { Money, Unavailable, When } from './shared';

/**
 * Who the invoice bills, as the screen could name them: by name, still being
 * found, or not shown to this reader. Never the payer's reference (browser QA
 * OBS-4: the printed copy used to carry it).
 */
export type PayerName =
  | { readonly kind: 'named'; readonly name: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'notShown' };

/**
 * Where the line descriptions come from, as the screen established it:
 * `matched` — the preview describes the revision this invoice was made from;
 * `mismatch` — a preview was read but describes another revision;
 * `refused` — the preview read failed, with its reference;
 * `notRead` — no read was made, because the caller may not see amounts;
 * `items` — a counter sale: each line names the item it sold on the detail
 * itself, so no preview exists or is needed (GAP-09).
 */
export type DescriptionSource =
  | { readonly kind: 'matched'; readonly preview: InvoicePreview }
  | { readonly kind: 'mismatch' }
  | { readonly kind: 'refused'; readonly reference: string | null }
  | { readonly kind: 'notRead' }
  | { readonly kind: 'items' };

/**
 * The printable invoice (P1-30, `W6`, FE-020).
 *
 * The backend publishes no print or document route, so the paper view is
 * composed here from what it does publish: the detail (header, status, number,
 * lines with their quantities and — for a caller who may see them — amounts)
 * and, when one is readable, the preview, which is the only read carrying line
 * descriptions. A description is taken ONLY when the preview describes the
 * same quotation revision the invoice was made from, joined by the line's
 * source item; otherwise the document says descriptions are unavailable rather
 * than guess. No PDF is generated: this is HTML that prints well.
 *
 * ## Names, and a date that reads in order
 *
 * The payer is printed by name when the screen could name them, and otherwise
 * the copy says the name is not shown — never the payer's reference. The work
 * order is printed by its number, or not at all. The issue moment is isolated in
 * the reader's direction (`When`), so an Arabic copy prints it in order.
 */
export function InvoiceDocument({
  locale,
  messages,
  detail,
  descriptions,
  workOrderNumber,
  payer,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: InvoiceDetail;
  /** Where line descriptions come from, decided by the screen; the document states it. */
  readonly descriptions: DescriptionSource;
  readonly workOrderNumber: string | null;
  /** Who the invoice bills, as the screen could name them. */
  readonly payer: PayerName;
}) {
  const invoice = detail.invoice;
  const describe = (line: InvoiceDetail['lines'][number]): ReactNode | null => {
    if (descriptions.kind === 'items') {
      // The item the line sold, by name and code. The code is isolated left to
      // right so an Arabic copy does not reorder its characters.
      return line.item ? (
        <>
          <bdi>{line.item.name}</bdi>{' '}
          <span className="font-mono text-text-muted" dir="ltr">
            {line.item.code}
          </span>
        </>
      ) : null;
    }
    if (descriptions.kind !== 'matched' || line.sourceQuotationItemId === null) return null;
    const found = descriptions.preview.lines.find(
      (row) => row.sourceQuotationItemId === line.sourceQuotationItemId
    );
    return found?.description ? <bdi>{found.description}</bdi> : null;
  };
  const amountsVisible = invoice.totals !== null;

  const headers = [
    translate(messages, 'invoices.print.column.line'),
    translate(messages, 'invoices.print.column.description'),
    translate(messages, 'invoices.print.column.type'),
    translate(messages, 'invoices.print.column.quantity'),
    translate(messages, 'invoices.print.column.unitPrice'),
    translate(messages, 'invoices.print.column.net'),
    translate(messages, 'invoices.print.column.tax'),
    translate(messages, 'invoices.print.column.gross'),
  ];
  const rows = detail.lines.map((line) => {
    const description = describe(line);
    return [
      <span key="n" dir="ltr">
        {String(line.lineNumber)}
      </span>,
      description !== null ? (
        <span key="d">{description}</span>
      ) : (
        <span key="d" className="text-text-muted">
          {translate(messages, 'invoices.print.noDescription')}
        </span>
      ),
      <span key="t">{translateDynamic(messages, `invoices.lineType.${line.lineType}`)}</span>,
      <span key="q" className="font-mono" dir="ltr">
        {line.quantity}
      </span>,
      line.money ? (
        <Money key="u" money={line.money.unitPrice} locale={locale} />
      ) : (
        <Unavailable key="u" messages={messages} />
      ),
      line.money ? (
        <Money key="ne" money={line.money.net} locale={locale} />
      ) : (
        <Unavailable key="ne" messages={messages} />
      ),
      line.money ? (
        <Money key="ta" money={line.money.tax} locale={locale} />
      ) : (
        <Unavailable key="ta" messages={messages} />
      ),
      line.money ? (
        <Money key="g" money={line.money.gross} locale={locale} />
      ) : (
        <Unavailable key="g" messages={messages} />
      ),
    ];
  });

  return (
    <PrintDocument
      title={translate(messages, 'invoices.print.title')}
      header={
        <dl className="grid gap-1">
          <div>
            <dt className="inline text-text-muted">
              {translate(messages, 'invoices.print.number')}{' '}
            </dt>
            <dd className="inline font-mono" dir="ltr">
              {invoice.invoiceNumber ?? translate(messages, 'invoices.detail.notIssued')}
            </dd>
          </div>
          <div>
            <dt className="inline text-text-muted">
              {translate(messages, 'invoices.print.status')}{' '}
            </dt>
            <dd className="inline">
              {translateDynamic(messages, `invoices.status.${invoice.status}`)}
            </dd>
          </div>
          <div>
            <dt className="inline text-text-muted">
              {translate(messages, 'invoices.print.issuedAt')}{' '}
            </dt>
            <dd className="inline" data-testid="invoice-print-issued-at">
              {invoice.issuedAt ? (
                <When value={invoice.issuedAt} locale={locale} />
              ) : (
                translate(messages, 'invoices.detail.notIssuedYet')
              )}
            </dd>
          </div>
          {workOrderNumber !== null ? (
            <div>
              <dt className="inline text-text-muted">
                {translate(messages, 'invoices.print.workOrder')}{' '}
              </dt>
              <dd className="inline font-mono" dir="ltr">
                {workOrderNumber}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="inline text-text-muted">
              {translate(messages, 'invoices.print.payer')}{' '}
            </dt>
            <dd className="inline" data-testid="invoice-print-payer">
              {payer.kind === 'named' ? (
                <bdi>{payer.name}</bdi>
              ) : (
                translate(messages, 'invoices.detail.payerNotShown')
              )}
            </dd>
          </div>
        </dl>
      }
      footer={
        <p>
          {descriptions.kind === 'matched'
            ? translate(messages, 'invoices.print.descriptionsFromQuotation')
            : descriptions.kind === 'items'
              ? translate(messages, 'invoices.print.descriptionsFromItems')
              : descriptions.kind === 'mismatch'
                ? translate(messages, 'invoices.print.descriptionsUnavailable')
                : descriptions.kind === 'refused'
                  ? translate(messages, 'invoices.print.previewRefused')
                  : translate(messages, 'invoices.print.descriptionsNeedFinance')}
          {descriptions.kind === 'refused' && descriptions.reference ? (
            <>
              {' '}
              {translate(messages, 'state.correlationId')}{' '}
              <code className="font-mono" dir="ltr">
                {descriptions.reference}
              </code>
            </>
          ) : null}
          {amountsVisible ? null : <> {translate(messages, 'invoices.print.amountsUnavailable')}</>}
        </p>
      }
    >
      <PrintTable
        headers={headers}
        rows={rows}
        caption={translate(messages, 'invoices.print.linesCaption')}
      />
      <dl className="mt-6 ms-auto grid max-w-xs grid-cols-2 gap-1 text-body">
        <dt className="text-text-muted">{translate(messages, 'invoices.detail.net')}</dt>
        <dd className="text-end">
          {invoice.totals ? (
            <Money money={invoice.totals.net} locale={locale} />
          ) : (
            <Unavailable messages={messages} />
          )}
        </dd>
        <dt className="text-text-muted">{translate(messages, 'invoices.detail.tax')}</dt>
        <dd className="text-end">
          {invoice.totals ? (
            <Money money={invoice.totals.tax} locale={locale} />
          ) : (
            <Unavailable messages={messages} />
          )}
        </dd>
        <dt className="font-medium">{translate(messages, 'invoices.detail.gross')}</dt>
        <dd className="text-end font-medium">
          {invoice.totals ? (
            <Money money={invoice.totals.gross} locale={locale} />
          ) : (
            <Unavailable messages={messages} />
          )}
        </dd>
      </dl>
    </PrintDocument>
  );
}
