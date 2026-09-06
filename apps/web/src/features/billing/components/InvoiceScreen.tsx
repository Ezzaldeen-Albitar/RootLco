'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';

import { TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import type { ActionState } from '@/lib/forms/action-result';
import { formatDateTime } from '@/lib/format';

import {
  cancelInvoice,
  createInvoice,
  issueInvoice,
  readInvoice,
  readInvoicePreview,
  readOutstanding,
  readWorkOrderInvoice,
} from '../api';
import {
  MAX_REASON,
  type Invoice,
  type InvoiceDetail,
  type InvoicePreview,
  type Outstanding,
  type WorkOrderInvoice,
} from '../billing-contract';
import { InvoiceDocument } from './InvoiceDocument';
import {
  Figure,
  InvoiceStatusBadge,
  Money,
  OutcomeNote,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  Unavailable,
  UUID,
} from './shared';

/**
 * The invoice of one work order (P1-30, `W6`, FE-014 preview, FE-015 issue
 * and cancel, FE-019 outstanding balance, FE-020 print).
 *
 * ## Reached from a work order
 *
 * There is no invoice list. `sal.work-order-invoice-read` answers the order's
 * live invoice or `null`, and the screen shows one of two things: without an
 * invoice, what the accepted quotation revision would bill (the preview) and
 * the act of creating it; with one, the invoice itself, its outstanding
 * balance, and the acts of issuing, cancelling and printing it.
 *
 * ## `sal.finance.view` splits the screen
 *
 * The preview, the totals, every line's money, the outstanding balance and the
 * create/issue acts belong to a caller who holds the code. Without it the
 * header, status, number, dates, line types and quantities still render; every
 * amount area says it is not available — never zero, never blank.
 *
 * ## Issue and cancel carry the invoice's own version
 *
 * Both send `If-Match` = `detail.invoice.recordVersion` as the detail read
 * published it. A stale version is refused and rendered as "changed since it
 * was read", after which the screen re-reads. The server echoes
 * `replayed: true` only for an issue of an already-issued invoice or a cancel
 * of an already-cancelled one, and only under the CURRENT version; the screen
 * states it as such and offers neither act off a draft. Write notices are held
 * HERE, above the panels that re-read.
 */

interface WriteNotice {
  readonly messageKey: string;
  readonly figure: string | null;
}

export function InvoiceScreen({
  locale,
  messages,
  workOrderId,
  workOrder,
  workOrderRefused,
  initialInvoice,
  canViewFinance,
  canIssue,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** From the address; `null` when the page was reached without one. */
  readonly workOrderId: string | null;
  /** The page's own read of the work order, when the operator may read it; else `null`. */
  readonly workOrder: WorkOrderListEntry | null;
  /** Set when the page tried to read the order and was refused or found nothing, with the reference. */
  readonly workOrderRefused: { readonly reference: string | null } | null;
  /** The page's own read of the order's live invoice, made after the gate. */
  readonly initialInvoice: ReadState<WorkOrderInvoice> | null;
  /** `sal.finance.view` — amounts, the preview, creating and issuing. */
  readonly canViewFinance: boolean;
  /** `sal.invoice.issue` — allocating the number. */
  readonly canIssue: boolean;
}) {
  const router = useRouter();
  const [invoiceRead, setInvoiceRead] = useState<ReadState<WorkOrderInvoice> | null>(
    initialInvoice
  );
  const [epoch, setEpoch] = useState(0);
  const [notice, setNotice] = useState<WriteNotice | null>(null);

  if (workOrderId === null) {
    return <ChooseWorkOrder locale={locale} messages={messages} />;
  }

  // A write re-reads the order's invoice and remounts the panels; what the
  // write had to say is kept here, above them.
  const changed = async (next: WriteNotice | null) => {
    setNotice(next);
    setInvoiceRead(await readWorkOrderInvoice(workOrderId));
    setEpoch((n) => n + 1);
    router.refresh();
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <section
        aria-labelledby="invoice-work-order-heading"
        className="rounded-lg border border-border bg-surface p-4"
        lang={locale}
        data-print="hide"
      >
        <h2 id="invoice-work-order-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'invoices.workOrder.heading')}
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label={translate(messages, 'invoices.workOrder.ref')}>
            <Link
              href={`/${locale}/work-orders/${workOrderId}`}
              className="font-mono text-caption text-primary underline-offset-2 hover:underline"
              dir="ltr"
            >
              {workOrder?.displayNumber ?? workOrderId}
            </Link>
          </Field>
          {workOrder ? (
            <>
              <Field label={translate(messages, 'invoices.workOrder.state')}>
                <bdi>{workOrder.state}</bdi>
              </Field>
              <Field label={translate(messages, 'invoices.workOrder.customer')}>
                {workOrder.customer ? (
                  <bdi>{workOrder.customer.displayName}</bdi>
                ) : (
                  <span className="text-text-muted">
                    {translate(messages, 'invoices.workOrder.noCustomer')}
                  </span>
                )}
              </Field>
            </>
          ) : (
            <Field label={translate(messages, 'invoices.workOrder.state')} wide>
              <span className="text-text-muted">
                {translate(
                  messages,
                  workOrderRefused ? 'invoices.workOrder.refused' : 'invoices.workOrder.notReadable'
                )}
                {workOrderRefused?.reference ? (
                  <>
                    {' '}
                    {translate(messages, 'state.correlationId')}{' '}
                    <code className="font-mono" dir="ltr">
                      {workOrderRefused.reference}
                    </code>
                  </>
                ) : null}
              </span>
            </Field>
          )}
        </dl>
      </section>

      {notice ? (
        <p role="status" className="text-caption text-text-muted" lang={locale} data-print="hide">
          {translateDynamic(messages, notice.messageKey)}
          {notice.figure ? (
            <>
              {' '}
              <code className="font-mono" dir="ltr">
                {notice.figure}
              </code>
            </>
          ) : null}
        </p>
      ) : null}

      {invoiceRead === null || invoiceRead.status !== 'ok' ? (
        <ReadRefusal messages={messages} state={invoiceRead} kind="invoice" />
      ) : invoiceRead.data.invoice === null ? (
        <PreviewPanel
          key={`preview-${epoch}`}
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          canViewFinance={canViewFinance}
          onCreated={(created) =>
            void changed({
              messageKey: created.replayed
                ? 'invoices.create.replayed'
                : 'invoices.create.recorded',
              figure: created.invoice.id,
            })
          }
          onConflict={() => void changed({ messageKey: 'invoices.create.conflict', figure: null })}
        />
      ) : (
        <InvoicePanel
          key={`invoice-${epoch}`}
          locale={locale}
          messages={messages}
          invoice={invoiceRead.data.invoice}
          workOrderNumber={workOrder?.displayNumber ?? null}
          canViewFinance={canViewFinance}
          canIssue={canIssue}
          onChanged={(next) => void changed(next)}
        />
      )}
    </div>
  );
}

function Field({
  label,
  wide = false,
  children,
}: {
  readonly label: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <div className={wide ? 'sm:col-span-2' : ''}>
      <dt className="text-caption text-text-muted">{label}</dt>
      <dd className="text-body text-text-primary">{children}</dd>
    </div>
  );
}

/** A refused, missing or failed read, said with its reference — never an empty result. */
function ReadRefusal({
  messages,
  state,
  kind,
}: {
  readonly messages: Messages;
  readonly state: ReadState<unknown> | null;
  readonly kind: 'invoice' | 'preview' | 'detail' | 'outstanding';
}) {
  if (state === null) {
    return <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>;
  }
  if (state.status === 'ok') return null;
  const key =
    kind === 'preview' && state.status === 'not-found'
      ? 'invoices.preview.noAcceptedRevision'
      : state.status === 'denied'
        ? `invoices.${kind}.refused`
        : state.status === 'not-found'
          ? `invoices.${kind}.missing`
          : `invoices.${kind}.unavailable`;
  return (
    <p role="alert" className="text-body text-error">
      {translateDynamic(messages, key)}
      {state.correlationId ? (
        <>
          {' '}
          <span className="text-caption text-text-muted">
            {translate(messages, 'state.correlationId')}{' '}
            <code className="font-mono" dir="ltr">
              {state.correlationId}
            </code>
          </span>
        </>
      ) : null}
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Without a work order: say so, and take one
 * ------------------------------------------------------------------ */

function ChooseWorkOrder({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const router = useRouter();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const id = value.trim();
        if (!UUID.test(id)) {
          setError(translate(messages, 'invoices.common.idFormat'));
          return;
        }
        router.push(`/${locale}/invoices?workOrderId=${encodeURIComponent(id)}`);
      }}
      noValidate
      aria-labelledby="invoice-choose-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="invoice-choose-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'invoices.choose.heading')}
      </h2>
      <p className="text-body text-text-secondary">
        {translate(messages, 'invoices.choose.explain')}
      </p>
      <p className="text-body">
        <Link
          href={`/${locale}/work-orders`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'invoices.choose.boardLink')}
        </Link>
      </p>
      <TextField
        label={translate(messages, 'invoices.choose.workOrderId')}
        required
        spellCheck={false}
        dir="ltr"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        error={error}
      />
      <div>
        <button type="submit" className={PRIMARY_BUTTON}>
          {translate(messages, 'invoices.choose.submit')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * FE-014 — no invoice yet: the preview, and creating one
 * ------------------------------------------------------------------ */

function PreviewPanel({
  locale,
  messages,
  workOrderId,
  canViewFinance,
  onCreated,
  onConflict,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly canViewFinance: boolean;
  readonly onCreated: (created: { readonly replayed: boolean; readonly invoice: Invoice }) => void;
  /** A refused create most likely means an invoice now exists; the screen re-reads. */
  readonly onConflict: () => void;
}) {
  const [preview, setPreview] = useState<ReadState<InvoicePreview> | null>(null);
  useEffect(() => {
    if (!canViewFinance) return;
    let live = true;
    void readInvoicePreview(workOrderId).then((state) => {
      if (live) setPreview(state);
    });
    return () => {
      live = false;
    };
  }, [workOrderId, canViewFinance]);

  return (
    <section
      aria-labelledby="invoice-preview-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
      data-print="hide"
    >
      <h2 id="invoice-preview-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'invoices.preview.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'invoices.preview.explain')}
      </p>
      {!canViewFinance ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'invoices.preview.needsFinance')}
        </p>
      ) : preview === null || preview.status !== 'ok' ? (
        <ReadRefusal messages={messages} state={preview} kind="preview" />
      ) : (
        <PreviewFigures locale={locale} messages={messages} preview={preview.data} />
      )}
      {canViewFinance && preview?.status === 'ok' ? (
        <CreateForm
          messages={messages}
          workOrderId={workOrderId}
          onCreated={onCreated}
          onConflict={onConflict}
        />
      ) : null}
    </section>
  );
}

function PreviewFigures({
  locale,
  messages,
  preview,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly preview: InvoicePreview;
}) {
  const currency = preview.currency;
  return (
    <div className="flex min-h-0 flex-col gap-3">
      <table className="w-full text-body">
        <caption className="sr-only">{translate(messages, 'invoices.preview.caption')}</caption>
        <thead>
          <tr className="text-caption text-text-muted">
            <th scope="col" className="px-3 py-2 text-start">
              {translate(messages, 'invoices.preview.column.line')}
            </th>
            <th scope="col" className="px-3 py-2 text-start">
              {translate(messages, 'invoices.preview.column.description')}
            </th>
            <th scope="col" className="px-3 py-2 text-start">
              {translate(messages, 'invoices.preview.column.type')}
            </th>
            <th scope="col" className="px-3 py-2 text-end">
              {translate(messages, 'invoices.preview.column.quantity')}
            </th>
            <th scope="col" className="px-3 py-2 text-end">
              {translate(messages, 'invoices.preview.column.unitPrice')}
            </th>
            <th scope="col" className="px-3 py-2 text-end">
              {translate(messages, 'invoices.preview.column.discount')}
            </th>
            <th scope="col" className="px-3 py-2 text-end">
              {translate(messages, 'invoices.preview.column.taxRate')}
            </th>
            <th scope="col" className="px-3 py-2 text-end">
              {translate(messages, 'invoices.preview.column.net')}
            </th>
            <th scope="col" className="px-3 py-2 text-end">
              {translate(messages, 'invoices.preview.column.tax')}
            </th>
            <th scope="col" className="px-3 py-2 text-end">
              {translate(messages, 'invoices.preview.column.gross')}
            </th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map((line) => (
            <tr key={line.sourceQuotationItemId} className="border-t border-border">
              <td className="px-3 py-2" dir="ltr">
                {String(line.lineNumber)}
              </td>
              <td className="px-3 py-2">
                {line.description ? (
                  <bdi>{line.description}</bdi>
                ) : (
                  <span className="text-text-muted">
                    {translate(messages, 'invoices.preview.noDescription')}
                  </span>
                )}
              </td>
              <td className="px-3 py-2">
                {translateDynamic(messages, `invoices.lineType.${line.lineType}`)}
              </td>
              <td className="px-3 py-2 text-end font-mono" dir="ltr">
                {line.quantity}
              </td>
              <td className="px-3 py-2 text-end">
                <Figure amount={line.unitPrice} currency={currency} locale={locale} />
              </td>
              <td className="px-3 py-2 text-end">
                <Figure amount={line.discount} currency={currency} locale={locale} />
              </td>
              <td className="px-3 py-2 text-end font-mono" dir="ltr">
                {line.taxRate}
              </td>
              <td className="px-3 py-2 text-end">
                <Figure amount={line.netAmount} currency={currency} locale={locale} />
              </td>
              <td className="px-3 py-2 text-end">
                <Figure amount={line.taxAmount} currency={currency} locale={locale} />
              </td>
              <td className="px-3 py-2 text-end">
                <Figure amount={line.grossAmount} currency={currency} locale={locale} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ms-auto grid max-w-sm grid-cols-2 gap-1 text-body">
        <dt className="text-text-muted">{translate(messages, 'invoices.preview.subtotal')}</dt>
        <dd className="text-end">
          <Figure amount={preview.subtotal} currency={currency} locale={locale} />
        </dd>
        <dt className="text-text-muted">{translate(messages, 'invoices.preview.discountTotal')}</dt>
        <dd className="text-end">
          <Figure amount={preview.discountTotal} currency={currency} locale={locale} />
        </dd>
        <dt className="text-text-muted">{translate(messages, 'invoices.preview.netTotal')}</dt>
        <dd className="text-end">
          <Figure amount={preview.netTotal} currency={currency} locale={locale} />
        </dd>
        <dt className="text-text-muted">{translate(messages, 'invoices.preview.taxTotal')}</dt>
        <dd className="text-end">
          <Figure amount={preview.taxTotal} currency={currency} locale={locale} />
        </dd>
        <dt className="font-medium">{translate(messages, 'invoices.preview.grossTotal')}</dt>
        <dd className="text-end font-medium">
          <Figure amount={preview.grossTotal} currency={currency} locale={locale} />
        </dd>
      </dl>
      <p className="text-caption text-text-muted">
        {translate(messages, 'invoices.preview.taxRateNote')}
      </p>
    </div>
  );
}

function CreateForm({
  messages,
  workOrderId,
  onCreated,
  onConflict,
}: {
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly onCreated: (created: { readonly replayed: boolean; readonly invoice: Invoice }) => void;
  readonly onConflict: () => void;
}) {
  const [payer, setPayer] = useState('');
  // ONE transport key per opened form, kept across a refusal or a lost answer:
  // pressing again replays the stored answer instead of asking for a second
  // invoice (which the server would refuse as a conflict).
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const found: Record<string, string> = {};
    const payerPartnerId = payer.trim();
    if (payerPartnerId.length > 0 && !UUID.test(payerPartnerId))
      found['payerPartnerId'] = 'invoices.common.idFormat';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const result = await createInvoice(
      {
        workOrderId,
        ...(payerPartnerId ? { payerPartnerId } : {}),
      },
      attemptKey
    );
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setOutcome(null);
      onCreated({ replayed: result.created.replayed, invoice: result.created.invoice });
    } else if (result.state.status === 'conflict') {
      // Most likely an invoice already exists for the order: re-read and show it.
      onConflict();
    } else {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="invoice-create-heading"
      className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
    >
      <h3
        id="invoice-create-heading"
        className="text-body font-medium text-text-primary sm:col-span-2"
      >
        {translate(messages, 'invoices.create.heading')}
      </h3>
      <p className="text-caption text-text-muted sm:col-span-2">
        {translate(messages, 'invoices.create.explain')}
      </p>
      <TextField
        label={translate(messages, 'invoices.create.payer')}
        description={translate(messages, 'invoices.create.payerHelp')}
        spellCheck={false}
        dir="ltr"
        value={payer}
        onChange={(event) => setPayer(event.target.value)}
        error={errorFor('payerPartnerId')}
      />
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'invoices.create.submit')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * FE-015 / FE-019 / FE-020 — the invoice, its balance, and the acts on it
 * ------------------------------------------------------------------ */

function InvoicePanel({
  locale,
  messages,
  invoice,
  workOrderNumber,
  canViewFinance,
  canIssue,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly invoice: Invoice;
  readonly workOrderNumber: string | null;
  readonly canViewFinance: boolean;
  readonly canIssue: boolean;
  readonly onChanged: (notice: WriteNotice | null) => void;
}) {
  const [detail, setDetail] = useState<ReadState<InvoiceDetail> | null>(null);
  useEffect(() => {
    let live = true;
    void readInvoice(invoice.id).then((state) => {
      if (live) setDetail(state);
    });
    return () => {
      live = false;
    };
  }, [invoice.id]);

  if (detail === null || detail.status !== 'ok') {
    return (
      <section
        className="rounded-lg border border-border bg-surface p-4"
        lang={locale}
        data-print="hide"
      >
        <ReadRefusal messages={messages} state={detail} kind="detail" />
      </section>
    );
  }

  return (
    <>
      <DetailPanel locale={locale} messages={messages} detail={detail.data} />
      <OutstandingPanel
        locale={locale}
        messages={messages}
        invoiceId={invoice.id}
        canViewFinance={canViewFinance}
      />
      <ActionsPanel
        locale={locale}
        messages={messages}
        detail={detail.data}
        canViewFinance={canViewFinance}
        canIssue={canIssue}
        onChanged={onChanged}
      />
      <PrintPanel
        locale={locale}
        messages={messages}
        detail={detail.data}
        workOrderNumber={workOrderNumber}
        canViewFinance={canViewFinance}
      />
    </>
  );
}

function DetailPanel({
  locale,
  messages,
  detail,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: InvoiceDetail;
}) {
  const invoice = detail.invoice;
  return (
    <section
      aria-labelledby="invoice-detail-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
      data-print="hide"
    >
      <h2 id="invoice-detail-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'invoices.detail.heading')}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-4">
        <Field label={translate(messages, 'invoices.detail.number')}>
          {invoice.invoiceNumber ? (
            <code className="font-mono" dir="ltr">
              {invoice.invoiceNumber}
            </code>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'invoices.detail.notIssued')}
            </span>
          )}
        </Field>
        <Field label={translate(messages, 'invoices.detail.status')}>
          <InvoiceStatusBadge messages={messages} status={invoice.status} />
        </Field>
        <Field label={translate(messages, 'invoices.detail.issuedAt')}>
          {invoice.issuedAt ? (
            <span dir="ltr">{formatDateTime(invoice.issuedAt, locale)}</span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'invoices.detail.notIssuedYet')}
            </span>
          )}
        </Field>
        <Field label={translate(messages, 'invoices.detail.currency')}>
          <span dir="ltr">{invoice.currency}</span>
        </Field>
        <Field label={translate(messages, 'invoices.detail.payer')}>
          <code className="font-mono text-caption" dir="ltr">
            {invoice.payerPartnerId}
          </code>
        </Field>
        <Field label={translate(messages, 'invoices.detail.identifier')}>
          <code className="font-mono text-caption" dir="ltr">
            {invoice.id}
          </code>
        </Field>
      </dl>

      <h3 className="text-body font-medium text-text-primary">
        {translate(messages, 'invoices.detail.totals')}
      </h3>
      {invoice.totals ? (
        <dl className="grid max-w-sm grid-cols-2 gap-1 text-body">
          <dt className="text-text-muted">{translate(messages, 'invoices.detail.net')}</dt>
          <dd className="text-end">
            <Money money={invoice.totals.net} locale={locale} />
          </dd>
          <dt className="text-text-muted">{translate(messages, 'invoices.detail.tax')}</dt>
          <dd className="text-end">
            <Money money={invoice.totals.tax} locale={locale} />
          </dd>
          <dt className="font-medium">{translate(messages, 'invoices.detail.gross')}</dt>
          <dd className="text-end font-medium">
            <Money money={invoice.totals.gross} locale={locale} />
          </dd>
        </dl>
      ) : (
        <p className="text-body text-text-secondary">
          {translate(messages, 'invoices.detail.totalsUnavailable')}
        </p>
      )}

      <h3 className="text-body font-medium text-text-primary">
        {translate(messages, 'invoices.detail.lines.heading')}
      </h3>
      {detail.lines.length === 0 ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'invoices.detail.lines.none')}
        </p>
      ) : (
        <table className="w-full text-body">
          <caption className="sr-only">
            {translate(messages, 'invoices.detail.lines.caption')}
          </caption>
          <thead>
            <tr className="text-caption text-text-muted">
              <th scope="col" className="px-3 py-2 text-start">
                {translate(messages, 'invoices.detail.column.line')}
              </th>
              <th scope="col" className="px-3 py-2 text-start">
                {translate(messages, 'invoices.detail.column.type')}
              </th>
              <th scope="col" className="px-3 py-2 text-end">
                {translate(messages, 'invoices.detail.column.quantity')}
              </th>
              <th scope="col" className="px-3 py-2 text-end">
                {translate(messages, 'invoices.detail.column.unitPrice')}
              </th>
              <th scope="col" className="px-3 py-2 text-end">
                {translate(messages, 'invoices.detail.column.net')}
              </th>
              <th scope="col" className="px-3 py-2 text-end">
                {translate(messages, 'invoices.detail.column.tax')}
              </th>
              <th scope="col" className="px-3 py-2 text-end">
                {translate(messages, 'invoices.detail.column.gross')}
              </th>
              <th scope="col" className="px-3 py-2 text-end">
                {translate(messages, 'invoices.detail.column.customer')}
              </th>
              <th scope="col" className="px-3 py-2 text-end">
                {translate(messages, 'invoices.detail.column.warranty')}
              </th>
            </tr>
          </thead>
          <tbody>
            {detail.lines.map((line) => (
              <tr key={line.id} className="border-t border-border">
                <td className="px-3 py-2" dir="ltr">
                  {String(line.lineNumber)}
                </td>
                <td className="px-3 py-2">
                  {translateDynamic(messages, `invoices.lineType.${line.lineType}`)}
                </td>
                <td className="px-3 py-2 text-end font-mono" dir="ltr">
                  {line.quantity}
                </td>
                {line.money ? (
                  <>
                    <td className="px-3 py-2 text-end">
                      <Money money={line.money.unitPrice} locale={locale} />
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Money money={line.money.net} locale={locale} />
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Money money={line.money.tax} locale={locale} />
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Money money={line.money.gross} locale={locale} />
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Money money={line.money.payerSplit.customer} locale={locale} />
                    </td>
                    <td className="px-3 py-2 text-end">
                      <Money money={line.money.payerSplit.warranty} locale={locale} />
                    </td>
                  </>
                ) : (
                  <td className="px-3 py-2 text-end" colSpan={6}>
                    <Unavailable messages={messages} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="text-caption text-text-muted">
        {translate(messages, 'invoices.detail.noDescriptionNote')}
      </p>
    </section>
  );
}

function OutstandingPanel({
  locale,
  messages,
  invoiceId,
  canViewFinance,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly invoiceId: string;
  readonly canViewFinance: boolean;
}) {
  const [state, setState] = useState<ReadState<Outstanding> | null>(null);
  useEffect(() => {
    if (!canViewFinance) return;
    let live = true;
    void readOutstanding(invoiceId).then((next) => {
      if (live) setState(next);
    });
    return () => {
      live = false;
    };
  }, [invoiceId, canViewFinance]);

  return (
    <section
      aria-labelledby="invoice-outstanding-heading"
      className="flex min-h-0 flex-col gap-2 rounded-lg border border-border bg-surface p-4"
      lang={locale}
      data-print="hide"
    >
      <h2 id="invoice-outstanding-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'invoices.outstanding.heading')}
      </h2>
      {!canViewFinance ? (
        <p className="text-body text-text-secondary">
          {translate(messages, 'invoices.outstanding.needsFinance')}
        </p>
      ) : state === null || state.status !== 'ok' ? (
        <ReadRefusal messages={messages} state={state} kind="outstanding" />
      ) : (
        <dl className="grid gap-3 sm:grid-cols-3">
          <Field label={translate(messages, 'invoices.outstanding.amount')}>
            <Money money={state.data.outstanding} locale={locale} />
          </Field>
          <Field label={translate(messages, 'invoices.outstanding.settlement')}>
            {state.data.isSettled
              ? translate(messages, 'invoices.outstanding.settled')
              : translate(messages, 'invoices.outstanding.open')}
          </Field>
          <Field label={translate(messages, 'invoices.detail.status')}>
            <InvoiceStatusBadge messages={messages} status={state.data.status} />
            {state.data.status === 'draft' ? (
              <span className="ms-2 text-caption text-text-muted">
                {translate(messages, 'invoices.outstanding.notIssued')}
              </span>
            ) : null}
          </Field>
        </dl>
      )}
      <p className="text-caption text-text-muted">
        {translate(messages, 'invoices.outstanding.note')}
      </p>
    </section>
  );
}

function ActionsPanel({
  locale,
  messages,
  detail,
  canViewFinance,
  canIssue,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: InvoiceDetail;
  readonly canViewFinance: boolean;
  readonly canIssue: boolean;
  readonly onChanged: (notice: WriteNotice | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [issueOutcome, setIssueOutcome] = useState<ActionState | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [cancelErrors, setCancelErrors] = useState<Readonly<Record<string, string>>>({});
  const [cancelOutcome, setCancelOutcome] = useState<ActionState | null>(null);

  const isDraft = detail.invoice.status === 'draft';
  const offerIssue = isDraft && canIssue && canViewFinance;
  const offerCancel = isDraft;

  const issue = async () => {
    setBusy(true);
    // The INVOICE's version, as the detail read published it — never a line's.
    const result = await issueInvoice(detail.invoice.id, detail.invoice.recordVersion);
    setIssueOutcome(result.state);
    notifyActionResult(result.state, messages);
    // On success or conflict the parent re-reads and REMOUNTS this panel; busy
    // stays raised until then so a second press cannot send the superseded
    // version and overwrite a truthful notice.
    if (result.state.status === 'success' && result.created) {
      setIssueOutcome(null);
      onChanged({
        messageKey: result.created.replayed ? 'invoices.issue.replayed' : 'invoices.issue.recorded',
        figure: result.created.invoiceNumber,
      });
    } else if (result.state.status === 'conflict') {
      // Changed since it was read: say so, and re-read.
      onChanged({ messageKey: 'invoices.detail.conflict', figure: null });
    } else {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const found: Record<string, string> = {};
    const trimmed = reason.trim();
    if (trimmed.length === 0) found['reason'] = 'field.required';
    else if (trimmed.length > MAX_REASON) found['reason'] = 'invoices.cancel.reasonTooLong';
    setCancelErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    const result = await cancelInvoice(
      detail.invoice.id,
      { reason: trimmed },
      detail.invoice.recordVersion
    );
    setCancelOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      setCancelOutcome(null);
      onChanged({
        messageKey: result.created.replayed
          ? 'invoices.cancel.replayed'
          : 'invoices.cancel.recorded',
        figure: null,
      });
    } else if (result.state.status === 'conflict') {
      onChanged({ messageKey: 'invoices.detail.conflict', figure: null });
    } else {
      setBusy(false);
    }
  };

  if (!offerIssue && !offerCancel) return null;

  return (
    <section
      aria-labelledby="invoice-actions-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
      data-print="hide"
    >
      <h2 id="invoice-actions-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'invoices.actions.heading')}
      </h2>
      {offerIssue ? (
        <div className="flex flex-col gap-2">
          <p className="text-caption text-text-muted">
            {translate(messages, 'invoices.issue.explain')}
          </p>
          <div>
            <button
              type="button"
              className={PRIMARY_BUTTON}
              disabled={busy}
              onClick={() => {
                void issue();
              }}
            >
              {translate(messages, 'invoices.issue.action')}
            </button>
          </div>
          <OutcomeNote messages={messages} outcome={issueOutcome} />
        </div>
      ) : null}
      {offerCancel ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            aria-expanded={cancelling}
            onClick={() => setCancelling((open) => !open)}
          >
            {translate(messages, 'invoices.cancel.open')}
          </button>
          {cancelling ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void cancel();
              }}
              noValidate
              aria-labelledby="invoice-cancel-heading"
              className="grid gap-3 sm:grid-cols-2"
            >
              <h3
                id="invoice-cancel-heading"
                className="text-body font-medium text-text-primary sm:col-span-2"
              >
                {translate(messages, 'invoices.cancel.heading')}
              </h3>
              <p className="text-caption text-text-muted sm:col-span-2">
                {translate(messages, 'invoices.cancel.explain')}
              </p>
              <TextField
                label={translate(messages, 'invoices.cancel.reason')}
                required
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                error={
                  cancelErrors['reason']
                    ? translateDynamic(messages, cancelErrors['reason'])
                    : cancelOutcome?.fieldErrors?.['reason']
                      ? translateDynamic(messages, cancelOutcome.fieldErrors['reason'])
                      : undefined
                }
              />
              <div className="sm:col-span-2">
                <OutcomeNote messages={messages} outcome={cancelOutcome} />
              </div>
              <div className="sm:col-span-2">
                <button type="submit" className={SECONDARY_BUTTON} disabled={busy}>
                  {translate(messages, 'invoices.cancel.submit')}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function PrintPanel({
  locale,
  messages,
  detail,
  workOrderNumber,
  canViewFinance,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: InvoiceDetail;
  readonly workOrderNumber: string | null;
  readonly canViewFinance: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ReadState<InvoicePreview> | null>(null);
  useEffect(() => {
    // Descriptions live only on the preview, which is money and needs the
    // code; it is read once, when the paper view is asked for.
    if (!open || !canViewFinance || preview !== null) return;
    let live = true;
    void readInvoicePreview(detail.invoice.workOrderId).then((state) => {
      if (live) setPreview(state);
    });
    return () => {
      live = false;
    };
  }, [open, canViewFinance, preview, detail.invoice.workOrderId]);

  return (
    <section
      aria-labelledby="invoice-print-heading"
      className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <div className="flex flex-wrap items-center gap-3" data-print="hide">
        <h2 id="invoice-print-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'invoices.print.heading')}
        </h2>
        <button
          type="button"
          className={SECONDARY_BUTTON}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {translate(messages, open ? 'invoices.print.close' : 'invoices.print.open')}
        </button>
        {open && (!canViewFinance || preview !== null) ? (
          <button type="button" className={PRIMARY_BUTTON} onClick={() => window.print()}>
            {translate(messages, 'invoices.print.print')}
          </button>
        ) : null}
      </div>
      {open ? (
        canViewFinance && preview === null ? (
          <p className="text-caption text-text-muted">{translate(messages, 'state.loading')}</p>
        ) : (
          <InvoiceDocument
            locale={locale}
            messages={messages}
            detail={detail}
            descriptions={
              !canViewFinance
                ? { kind: 'notRead' }
                : preview === null || preview.status !== 'ok'
                  ? { kind: 'refused', reference: preview?.correlationId ?? null }
                  : preview.data.quotationRevisionId === detail.invoice.quotationRevisionId
                    ? { kind: 'matched', preview: preview.data }
                    : { kind: 'mismatch' }
            }
            workOrderNumber={workOrderNumber}
          />
        )
      ) : null}
    </section>
  );
}
