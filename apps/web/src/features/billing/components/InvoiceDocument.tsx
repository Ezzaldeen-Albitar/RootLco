'use client';

import type { ReactNode } from 'react';

import { PrintDocument, PrintTable } from '@/components/print/PrintDocument';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import { directionOf, type Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatInZone, zoneLabelAt } from '@/lib/branch-time';
import { intlLocale } from '@/lib/format';

import type { InvoiceDetail, MoneyView, Outstanding } from '../billing-contract';
import { Money, ThirdPartyPaymentItems, Unavailable, When } from './shared';

/**
 * Who the invoice bills, as the screen could name them: by name, still being
 * found, not shown to this reader, or not available because the lookup did not
 * answer in time (finance QA fixes D: a lookup that never settled held the copy
 * and its Print button in the loading state for good). Never the payer's
 * reference (browser QA OBS-4: the printed copy used to carry it).
 */
export type PayerName =
  | { readonly kind: 'named'; readonly name: string }
  | { readonly kind: 'loading' }
  | { readonly kind: 'notShown' }
  | { readonly kind: 'unavailable' };

/** The words for a payer the screen could not name, by why it could not. */
export function payerNameKey(kind: Exclude<PayerName['kind'], 'named'>): keyof Messages {
  if (kind === 'loading') return 'invoices.detail.payerLoading';
  if (kind === 'unavailable') return 'invoices.detail.payerUnavailable';
  return 'invoices.detail.payerNotShown';
}

/**
 * Where the line descriptions come from, as the screen established it:
 * `source` — the detail carries the quotation revision this invoice was made
 * from and each line's own source line, as quoted (ADR-023 D5/D15);
 * `unavailable` — the caller may see amounts, but the detail carries no source
 * revision (it could not be read for this caller);
 * `notRead` — the caller may not see amounts, so the detail carries no source;
 * `items` — a counter sale: each line names the item it sold on the detail
 * itself (GAP-09).
 */
export type DescriptionSource =
  | { readonly kind: 'source' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'notRead' }
  | { readonly kind: 'items' };

/**
 * The printable invoice (P1-30, `W6`, FE-020).
 *
 * The backend publishes no print or document route, so the paper view is
 * composed here from what it does publish: the detail (header, status, number,
 * lines with their quantities and — for a caller who may see them — amounts,
 * and each work-order line's own source quotation line as quoted). A line is
 * described ONLY from the quotation line it was copied from, which the detail
 * reads through the line itself — never from the work order's current preview,
 * which since ADR-023 D5/D15 may name another quotation or another revision
 * (several invoices per work order). Where the detail carries no source the
 * document says descriptions are unavailable rather than guess. No PDF is
 * generated: this is HTML that prints well.
 *
 * ## Names, and a date that reads in order
 *
 * The payer is printed by name when the screen could name them, and otherwise
 * the copy says the name is not shown — never the payer's reference. The work
 * order is printed by its number, or not at all. The issue moment is isolated in
 * the reader's direction (`When`), so an Arabic copy prints it in order.
 *
 * ## What was issued, and what has happened since (Owner decision D10)
 *
 * The paper keeps two things apart. The ISSUED facts — the lines, each line's
 * discount and the totals — never change once the invoice is issued, and are
 * printed exactly as the server holds them. The SETTLEMENT — paid, credited,
 * still due, and the payment and credit positions — moves with every payment
 * and credit note, so it is printed in a section of its own headed with the
 * moment it was read, on the branch's clock with the clock's name beside it
 * (finance checkpoint, DF-B1). What a third party paid for the customer (D14) is
 * printed inside it, "Paid by <payer> (<relationship>) for <customer>" with the
 * authorisation reference, exactly as the screen shows it.
 *
 * Every figure is the server's. A job's line discount comes from the quotation
 * line the invoice line was copied from, as the detail carries it, and is
 * otherwise said to be unavailable rather than guessed. A counter sale takes no
 * discount (its create body refuses one), so its copy has no discount column.
 * The settlement is the balance read (`sal.invoice-outstanding-read`): it is
 * printed only when the screen passes one, which it reads only for a reader
 * holding `sal.finance.view`, and only for an invoice that claims something
 * (issued or credited). Nothing on this paper is added, subtracted or rounded
 * here.
 */
export function InvoiceDocument({
  locale,
  messages,
  detail,
  descriptions,
  workOrderNumber,
  payer,
  balance = null,
  settlementUnavailable = false,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: InvoiceDetail;
  /** Where line descriptions come from, decided by the screen; the document states it. */
  readonly descriptions: DescriptionSource;
  readonly workOrderNumber: string | null;
  /** Who the invoice bills, as the screen could name them. */
  readonly payer: PayerName;
  /**
   * The balance read the screen made (`sal.invoice-outstanding-read`): what is
   * still due, the credit and payment positions (Owner decision D7) and the
   * moment they were read. Printed as its own "settlement as of" section when it
   * carries a settlement. Omitted — never guessed — when the reader may not see
   * amounts or the invoice claims nothing yet.
   */
  readonly balance?: Outstanding | null;
  /**
   * The balance read was refused, failed or did not answer in time (DX-2). The
   * copy then says that what was paid could not be read, rather than printing as
   * if nothing had been.
   */
  readonly settlementUnavailable?: boolean;
}) {
  const invoice = detail.invoice;
  const context = useWorkingContext();
  const settlement = balance?.settlement ?? null;
  /*
   * A job's discount is printed per line; a counter sale takes none. The detail
   * carries each work-order line's own source quotation line, so the discount is
   * that line's as quoted. A job's invoice is the one with a work order
   * (`ck_invoices_sale_kind_source`).
   */
  const discounted = invoice.workOrderId !== null;
  const revision = descriptions.kind === 'source' ? detail.source : null;
  /*
   * Since ADR-023 D5/D15 an invoice may bill PART of its revision — some lines, or
   * what remains of one — so the revision's figures are this invoice's only where
   * it billed them whole. A line's discount is printed only when the line billed its
   * quotation line's whole quoted quantity; the revision's subtotal and discount only
   * when the invoice billed every line of the revision whole. Otherwise the copy says
   * they are not available, never a figure of another document.
   */
  const sourceOf = (line: InvoiceDetail['lines'][number]) =>
    descriptions.kind === 'source' ? line.source : null;
  const billedWhole = (line: InvoiceDetail['lines'][number]): boolean =>
    sourceOf(line)?.quotedQuantity === line.quantity;
  const wholeRevision =
    revision !== null &&
    revision.lineCount === detail.lines.length &&
    detail.lines.every(billedWhole);
  const lineDiscount = (line: InvoiceDetail['lines'][number]): MoneyView | null => {
    const found = sourceOf(line);
    return found !== null && billedWhole(line) ? found.discount : null;
  };
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
    const found = sourceOf(line);
    return found?.description ? <bdi>{found.description}</bdi> : null;
  };
  const amountsVisible = invoice.totals !== null;

  const headers = [
    translate(messages, 'invoices.print.column.line'),
    translate(messages, 'invoices.print.column.description'),
    translate(messages, 'invoices.print.column.type'),
    translate(messages, 'invoices.print.column.quantity'),
    translate(messages, 'invoices.print.column.unitPrice'),
    ...(discounted ? [translate(messages, 'invoices.print.column.discount')] : []),
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
      ...(discounted
        ? [<LineDiscount key="di" value={lineDiscount(line)} locale={locale} messages={messages} />]
        : []),
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
      reference={invoice.invoiceNumber ?? translate(messages, 'invoices.detail.notIssued')}
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
                translate(messages, payerNameKey(payer.kind))
              )}
            </dd>
          </div>
        </dl>
      }
    >
      {/*
        Where the line descriptions come from, and whether amounts are shown, said
        once ABOVE the lines it describes. It used to be the document's footer, and
        a counter sale whose last block ended near the foot of a page printed one
        more page holding only the identity row and "Each line is described by the
        item that was sold." (local runtime QA). Above the table it always prints
        with the lines, so no page is spent on it alone.
      */}
      <p className="mb-3 text-supporting text-text-muted" data-testid="invoice-print-lines-note">
        {descriptions.kind === 'source'
          ? translate(messages, 'invoices.print.descriptionsFromQuotation')
          : descriptions.kind === 'items'
            ? translate(messages, 'invoices.print.descriptionsFromItems')
            : descriptions.kind === 'unavailable'
              ? translate(messages, 'invoices.print.descriptionsUnavailable')
              : translate(messages, 'invoices.print.descriptionsNeedFinance')}
        {amountsVisible ? null : <> {translate(messages, 'invoices.print.amountsUnavailable')}</>}
      </p>
      <PrintTable
        headers={headers}
        rows={rows}
        caption={translate(messages, 'invoices.print.linesCaption')}
      />
      <dl
        className="mt-6 ms-auto grid max-w-xs grid-cols-2 gap-1 text-body"
        aria-label={translate(messages, 'invoices.print.issuedTotals')}
        data-testid="invoice-print-issued-totals"
      >
        <dt className="col-span-2 text-caption font-medium text-text-muted">
          {translate(messages, 'invoices.print.issuedTotals')}
        </dt>
        {discounted ? (
          <>
            <dt className="text-text-muted">{translate(messages, 'invoices.print.subtotal')}</dt>
            <dd className="text-end" data-testid="invoice-print-subtotal">
              <PreviewFigure
                value={wholeRevision && revision ? revision.subtotal : null}
                locale={locale}
                messages={messages}
              />
            </dd>
            <dt className="text-text-muted">{translate(messages, 'invoices.print.discount')}</dt>
            <dd className="text-end" data-testid="invoice-print-discount-total">
              <PreviewFigure
                value={wholeRevision && revision ? revision.discountTotal : null}
                locale={locale}
                messages={messages}
              />
            </dd>
          </>
        ) : null}
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
      {balance !== null && settlement !== null ? (
        <SettlementSection
          locale={locale}
          messages={messages}
          balance={balance}
          settlement={settlement}
          customer={payer}
          zone={context.branches.find((entry) => entry.id === invoice.branchId)?.timezone || 'UTC'}
        />
      ) : settlementUnavailable ? (
        <p
          className="mt-6 border-t border-border pt-4 text-body"
          data-testid="invoice-print-settlement-unavailable"
        >
          {translate(messages, 'invoices.print.settlementUnavailable')}
        </p>
      ) : null}
    </PrintDocument>
  );
}

/** A line's discount as its source quotation line states it, or "not available". */
function LineDiscount({
  value,
  locale,
  messages,
}: {
  readonly value: MoneyView | null;
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  return value === null ? (
    <Unavailable messages={messages} />
  ) : (
    <span data-testid="invoice-print-line-discount">
      <Money money={value} locale={locale} />
    </span>
  );
}

/** A figure of the source revision (subtotal, discount), or "not available". */
function PreviewFigure({
  value,
  locale,
  messages,
}: {
  readonly value: MoneyView | null;
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  return value === null ? (
    <Unavailable messages={messages} />
  ) : (
    <Money money={value} locale={locale} />
  );
}

/**
 * The settlement, apart from the issued facts and headed with the moment it was
 * read (D10). The moment is the server's (`asOf`), written on the branch's clock
 * with that clock's name beside it, so a copy printed in another zone still
 * says which clock it means. Amounts and positions are the balance read's own.
 */
function SettlementSection({
  locale,
  messages,
  balance,
  settlement,
  customer,
  zone,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly balance: Outstanding;
  readonly settlement: NonNullable<Outstanding['settlement']>;
  /** Who the invoice bills, as the copy names them — for "Paid by … for …" (D14). */
  readonly customer: PayerName;
  readonly zone: string;
}) {
  const language = intlLocale(locale);
  const thirdParty = settlement.thirdPartyPayments ?? [];
  return (
    <section
      className="mt-6 border-t border-border pt-4"
      aria-labelledby="invoice-print-settlement-heading"
      data-testid="invoice-print-settlement"
    >
      <h3 id="invoice-print-settlement-heading" className="text-body font-medium">
        {translate(messages, 'invoices.print.settlementAsOf')}{' '}
        <bdi dir={directionOf(locale)} data-testid="invoice-print-settlement-as-of">
          {formatInZone(balance.asOf, language, zone)}
        </bdi>{' '}
        <bdi className="text-caption text-text-muted" data-testid="invoice-print-settlement-clock">
          {zoneLabelAt(balance.asOf, language, zone)}
        </bdi>
      </h3>
      <p className="text-caption text-text-muted">
        {translate(messages, 'invoices.print.settlementExplain')}
      </p>
      <dl className="mt-2 ms-auto grid max-w-xs grid-cols-2 gap-1 text-body">
        <dt className="text-text-muted">{translate(messages, 'invoices.settlement.payment')}</dt>
        <dd className="text-end" data-testid="invoice-print-payment-status">
          {translateDynamic(messages, `invoices.paymentStatus.${settlement.paymentStatus}`)}
        </dd>
        <dt className="text-text-muted">{translate(messages, 'invoices.settlement.credit')}</dt>
        <dd className="text-end" data-testid="invoice-print-credit-status">
          {translateDynamic(messages, `invoices.creditStatus.${settlement.creditStatus}`)}
        </dd>
        <dt className="text-text-muted">{translate(messages, 'invoices.print.amountPaid')}</dt>
        <dd className="text-end" data-testid="invoice-print-paid">
          <Money money={settlement.paid} locale={locale} />
        </dd>
        <dt className="text-text-muted">{translate(messages, 'invoices.print.amountCredited')}</dt>
        <dd className="text-end" data-testid="invoice-print-credited">
          <Money money={settlement.credited} locale={locale} />
        </dd>
        <dt className="font-medium">{translate(messages, 'invoices.print.balanceDue')}</dt>
        <dd className="text-end font-medium" data-testid="invoice-print-balance-due">
          <Money money={balance.outstanding} locale={locale} />
        </dd>
      </dl>
      {thirdParty.length > 0 ? (
        // What a third party paid for the customer is part of the settlement as
        // read (D14): the paper carries it as the screen does, so a copy handed
        // over says who paid, for whom, and on what authorisation.
        <div className="mt-3" data-testid="invoice-print-third-party-payments">
          <h4 className="text-body font-medium">
            {translate(messages, 'invoices.thirdParty.heading')}
          </h4>
          <ThirdPartyPaymentItems
            locale={locale}
            messages={messages}
            payments={thirdParty}
            truncated={settlement.thirdPartyPaymentsTruncated === true}
            customer={customer}
          />
        </div>
      ) : null}
    </section>
  );
}
