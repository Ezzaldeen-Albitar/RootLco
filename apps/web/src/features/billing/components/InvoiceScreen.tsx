'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';

import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog';
import { ReasonDialog } from '@/components/dialogs/ReasonDialog';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerPicker, type ChosenCustomer } from '@/components/party/CustomerPicker';
import { MuiLoadingState, MuiReadFailureState } from '@/components/states/MuiStates';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import {
  WorkOrderPicker,
  useWorkOrderSearchScope,
} from '@/features/work-orders/components/WorkOrderPicker';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ReadState } from '@/lib/api/read-operation';
import { unreachable, type ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';

import {
  cancelInvoice,
  createInvoice,
  issueInvoice,
  listInvoices,
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
  type Settlement,
  type WorkOrderInvoice,
} from '../billing-contract';
import { CreditNoteRequestForm } from './CreditNoteRequestForm';
import { InvoiceDocument, type PayerName } from './InvoiceDocument';
import { Figure, InvoiceStatusBadge, Money, OutcomeNote, Unavailable, UUID, When } from './shared';

/**
 * The invoice of one work order (P1-30, `W6`, FE-014 preview, FE-015 issue
 * and cancel, FE-019 outstanding balance, FE-020 print). On the shared Material
 * UI wrappers since the sales and finance slice (ADR-022): the job and a
 * different payer are found with the shared comboboxes, issuing asks first
 * (`ConfirmDialog`), cancelling takes its reason in `ReasonDialog`, and every
 * read that fails is the Material state with its retry.
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
 * HERE, above the panels that re-read, and the act stays busy until the re-read
 * has remounted them.
 *
 * ## Names, not references
 *
 * The invoice is named by its number and its payer by name — never by the
 * payer's or the invoice's reference (browser QA rows 5.1b and OBS-4). The
 * invoice read publishes the payer's id only, so the name is the work order's
 * customer when that customer pays, and otherwise the name the branch's invoice
 * list gives this very invoice (`sal.invoice-list`, found by its number, under
 * the list's own rule: named only for a caller who may read customers). Where
 * neither can name the payer the screen says the name is not shown here.
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
  canSearchWorkOrders = false,
  canReadCustomers = false,
  canRaiseCredit = false,
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
  /** `wo.work_order.read` — decides whether the job can be FOUND when none is named. */
  readonly canSearchWorkOrders?: boolean;
  /** `crm.customer.read` — whether a different payer can be found by name. */
  readonly canReadCustomers?: boolean;
  /**
   * `sal.credit.manage` AND `sal.finance.view` — raising a credit note against an
   * issued invoice with money still open. Both, because `sal.credit-note-create`
   * declares both; a cashier holding finance view alone is not offered it.
   */
  readonly canRaiseCredit?: boolean;
}) {
  const router = useRouter();
  const [invoiceRead, setInvoiceRead] = useState<ReadState<WorkOrderInvoice> | null>(
    initialInvoice
  );
  const [epoch, setEpoch] = useState(0);
  const [notice, setNotice] = useState<WriteNotice | null>(null);

  if (workOrderId === null) {
    return (
      <ChooseWorkOrder
        locale={locale}
        messages={messages}
        canSearchWorkOrders={canSearchWorkOrders}
      />
    );
  }

  // A write re-reads the order's invoice and remounts the panels; what the
  // write had to say is kept here, above them. Resolves once the re-read landed.
  const changed = async (next: WriteNotice | null) => {
    setNotice(next);
    let answer: ReadState<WorkOrderInvoice>;
    try {
      answer = await readWorkOrderInvoice(workOrderId);
    } catch {
      answer = { status: 'unavailable', correlationId: null };
    }
    setInvoiceRead(answer);
    setEpoch((n) => n + 1);
    router.refresh();
  };

  /*
   * `data-print-scope`: while the invoice's printable copy is open below,
   * printing carries the copy and not the panels around it (the delivery
   * sheet's rule, `styles/print/_index.scss`). Each panel is also marked
   * `data-print="hide"` on its own; the scope covers what is not — the
   * write notice, a refusal — so no stray panel reaches the paper.
   */
  return (
    <div data-print-scope="document" className="flex min-h-0 flex-col gap-4">
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
              className="text-primary underline-offset-2 hover:underline"
            >
              {workOrder?.displayNumber ? (
                <bdi className="font-mono">{workOrder.displayNumber}</bdi>
              ) : (
                translate(messages, 'quotations.list.openWorkOrder')
              )}
            </Link>
          </Field>
          {workOrder ? (
            <>
              <Field label={translate(messages, 'invoices.workOrder.state')}>
                {translateDynamic(messages, `workOrders.state.${workOrder.state}`)}
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
        <ReadRefusal
          messages={messages}
          locale={locale}
          state={invoiceRead}
          kind="invoice"
          onRetry={() => void changed(null)}
        />
      ) : invoiceRead.data.invoice === null ? (
        <PreviewPanel
          key={`preview-${epoch}`}
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          canViewFinance={canViewFinance}
          canReadCustomers={canReadCustomers}
          onCreated={(created) =>
            changed({
              messageKey: created.replayed
                ? 'invoices.create.replayed'
                : 'invoices.create.recorded',
              figure: null,
            })
          }
          onConflict={() => changed({ messageKey: 'invoices.create.conflict', figure: null })}
        />
      ) : (
        <InvoicePanel
          key={`invoice-${epoch}`}
          locale={locale}
          messages={messages}
          invoice={invoiceRead.data.invoice}
          workOrder={workOrder}
          canViewFinance={canViewFinance}
          canIssue={canIssue}
          canRaiseCredit={canRaiseCredit}
          onChanged={changed}
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

/**
 * A refused, missing or failed read, as the Material state it is — never an
 * empty result. An outage and a fault offer a retry where the panel can read
 * again; a refusal, an ended session and a missing record never do. A preview
 * the order cannot have (no accepted revision) says exactly that.
 */
function ReadRefusal({
  messages,
  locale,
  state,
  kind,
  onRetry,
}: {
  readonly messages: Messages;
  readonly locale: Locale;
  readonly state: ReadState<unknown> | null;
  readonly kind: 'invoice' | 'preview' | 'detail' | 'outstanding';
  readonly onRetry?: (() => void) | undefined;
}) {
  if (state === null) return <MuiLoadingState messages={messages} variant="inline" />;
  if (state.status === 'ok') return null;
  if (state.status === 'not-found') {
    // An absence says what is absent, with the reference an operator can quote.
    const preview = kind === 'preview';
    return (
      <p
        role={preview ? 'status' : 'alert'}
        className={preview ? 'text-body text-text-secondary' : 'text-body text-error'}
      >
        {translateDynamic(
          messages,
          preview ? 'invoices.preview.noAcceptedRevision' : `invoices.${kind}.missing`
        )}
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
  return (
    <MuiReadFailureState
      messages={messages}
      locale={locale}
      status={state.status}
      correlationId={state.correlationId}
      descriptionKey={
        (state.status === 'denied'
          ? `invoices.${kind}.refused`
          : `invoices.${kind}.unavailable`) as keyof Messages
      }
      onRetry={onRetry}
    />
  );
}

/* ------------------------------------------------------------------ *
 * Without a work order: say so, and take one
 * ------------------------------------------------------------------ */

function ChooseWorkOrder({
  locale,
  messages,
  canSearchWorkOrders,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** `wo.work_order.read` — whether the jobs of the branch can be searched. */
  readonly canSearchWorkOrders: boolean;
}) {
  const router = useRouter();
  /*
   * The job is FOUND, not typed.
   *
   * This form used to take a work-order reference as free text and refuse
   * anything that was not shaped like one — a 36-character string that appears
   * on no printed document and on no other screen, so the only way to fill it
   * in was to copy one out of another page's address bar. `wo.work-order-list`
   * answers the question the form was really asking (Owner directive,
   * `P1-32-PRE-OD-UX`).
   *
   * No role loses a workflow the server allows. Creating an invoice
   * (`sal.invoice-create`) needs `sal.invoice.manage` and `sal.finance.view`
   * only — not `wo.work_order.read` — so a caller without the job read keeps
   * the box they had before the picker: a labelled job reference, explained in
   * both languages and checked against the server's own identifier rule before
   * the page is opened on it (route sweep B2, the parts desk precedent).
   *
   * Neither control is unsaved work, and that is one rule for both: this form
   * writes nothing — it only opens the invoice page for the job — so a job
   * chosen in the picker is forgotten on a branch switch without a question,
   * exactly as a typed reference is kept without one (route sweep B3).
   */
  const [chosen, setChosen] = useState<WorkOrderListEntry | null>(null);
  const [reference, setReference] = useState('');
  // An attempt counter rather than a flag: the focus hook moves the cursor to
  // the box once per refused attempt, never on a re-render.
  const [refusal, setRefusal] = useState<ActionState>({ status: 'idle' });
  const formRef = useFocusFirstInvalid(refusal);
  const refused = refusal.status === 'invalid' ? refusal.fieldErrors?.['workOrderId'] : undefined;
  const error =
    refused === undefined || (canSearchWorkOrders && chosen !== null)
      ? undefined
      : translateDynamic(messages, refused);
  /*
   * With nothing to search — "All my branches" spanning companies, or no branch
   * chosen yet — the picker offers no box, so a refusal would have no control to
   * point at. The submit is disabled instead, described by the sentence the
   * picker shows in place of the box. The typed reference needs no scope.
   */
  const scope = useWorkOrderSearchScope();
  const needsBranchId = useId();
  const blocked = canSearchWorkOrders && chosen === null && scope === null;
  const refuse = (key: string) =>
    setRefusal((previous) => ({
      status: 'invalid',
      fieldErrors: { workOrderId: key },
      attempt: (previous.attempt ?? 0) + 1,
    }));
  const open = (id: string) =>
    router.push(`/${locale}/invoices?workOrderId=${encodeURIComponent(id)}`);
  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        if (!canSearchWorkOrders) {
          const typed = reference.trim();
          if (!UUID.test(typed)) {
            refuse('invoices.choose.referenceFormat');
            return;
          }
          open(typed);
          return;
        }
        if (chosen === null) {
          refuse('workOrders.picker.required');
          return;
        }
        open(chosen.id);
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
      {canSearchWorkOrders ? (
        <WorkOrderPicker
          messages={messages}
          label={translate(messages, 'invoices.choose.workOrderId')}
          value={chosen}
          onChange={setChosen}
          error={error}
          canSearch
          needsBranchId={needsBranchId}
          countsAsUnsaved={false}
          offersBranchChooser
          material
        />
      ) : (
        <FormTextField
          label={translate(messages, 'invoices.choose.referenceLabel')}
          description={translate(messages, 'invoices.choose.referenceHelp')}
          required
          autoComplete="off"
          dir="ltr"
          value={reference}
          onChange={(next) => {
            setReference(next);
            setRefusal({ status: 'idle' });
          }}
          error={error}
          testId="invoice-work-order-reference"
        />
      )}
      <div>
        <Button
          type="submit"
          variant="contained"
          disabled={blocked}
          aria-describedby={blocked ? needsBranchId : undefined}
        >
          {translate(messages, 'invoices.choose.submit')}
        </Button>
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
  canReadCustomers,
  onCreated,
  onConflict,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly canViewFinance: boolean;
  readonly canReadCustomers: boolean;
  /** Re-reads the order's invoice; resolves once the panels were remounted. */
  readonly onCreated: (created: {
    readonly replayed: boolean;
    readonly invoice: Invoice;
  }) => Promise<void>;
  /** A refused create most likely means an invoice now exists; the screen re-reads. */
  readonly onConflict: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<ReadState<InvoicePreview> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!canViewFinance) return;
    let live = true;
    void readInvoicePreview(workOrderId).then((state) => {
      if (live) setPreview(state);
    });
    return () => {
      live = false;
    };
  }, [workOrderId, canViewFinance, attempt]);

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
        <ReadRefusal
          messages={messages}
          locale={locale}
          state={preview}
          kind="preview"
          onRetry={() => {
            setPreview(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : (
        <PreviewFigures locale={locale} messages={messages} preview={preview.data} />
      )}
      {canViewFinance && preview?.status === 'ok' ? (
        <CreateForm
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          canReadCustomers={canReadCustomers}
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
      <div className="overflow-x-auto">
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
      </div>
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
  locale,
  messages,
  workOrderId,
  canReadCustomers,
  onCreated,
  onConflict,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  readonly canReadCustomers: boolean;
  readonly onCreated: (created: {
    readonly replayed: boolean;
    readonly invoice: Invoice;
  }) => Promise<void>;
  readonly onConflict: () => Promise<void>;
}) {
  /*
   * A different payer is FOUND among customers and chosen by name (Owner
   * directive, `P1-32-PRE-OD-UX`); it used to be a box asking for a partner
   * reference. Left empty, the server bills the work order's own customer.
   *
   * The search needs `crm.customer.read`, and creating an invoice does NOT:
   * `sal.invoice-create` declares `sal.invoice.manage` and `sal.finance.view`
   * only, and when the accepted quotation names no payer the server REQUIRES
   * one here. So a caller without the customer read keeps the box they had
   * before — a pasted payer reference, labelled as the fallback it is, checked
   * for shape before it is sent, and counted as unsaved work. With the customer
   * read there is no box at all.
   */
  const [payer, setPayer] = useState<ChosenCustomer | null>(null);
  const [payerReference, setPayerReference] = useState('');
  // ONE transport key per opened form, kept across a refusal or a lost answer:
  // pressing again replays the stored answer instead of asking for a second
  // invoice (which the server would refuse as a conflict).
  const [attemptKey] = useState(() => crypto.randomUUID());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  // A confirmed "Discard and change branch" empties the box: the form is the
  // work order's, nothing here is keyed on the branch, and the question told
  // the operator the reference would go.
  useUnsavedGuard(!canReadCustomers && payerReference.trim().length > 0, () => {
    setPayerReference('');
    setErrors({});
    setOutcome(null);
  });
  // One per refusal the server files under a field, so the cursor moves there once.
  const [attempt, setAttempt] = useState(0);
  const formRef = useFocusFirstInvalid({
    status: 'invalid',
    fieldErrors: { ...(outcome?.fieldErrors ?? {}), ...errors },
    attempt,
  });
  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const typed = payerReference.trim();
    const payerPartnerId = canReadCustomers ? (payer?.id ?? null) : typed || null;
    if (!canReadCustomers && typed.length > 0 && !UUID.test(typed)) {
      setErrors({ payerPartnerId: 'invoices.create.payerReferenceFormat' });
      setAttempt((n) => n + 1);
      return;
    }
    setErrors({});
    setBusy(true);
    let settled = false;
    try {
      let result: Awaited<ReturnType<typeof createInvoice>>;
      try {
        result = await createInvoice(
          {
            workOrderId,
            ...(payerPartnerId ? { payerPartnerId } : {}),
          },
          attemptKey
        );
      } catch {
        setOutcome(unreachable(1));
        return;
      }
      setOutcome(result.state);
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success' && result.created) {
        setOutcome(null);
        // The panel is remounted by the re-read; busy stays raised until then.
        settled = true;
        await onCreated({ replayed: result.created.replayed, invoice: result.created.invoice });
      } else if (result.state.status === 'conflict') {
        // Most likely an invoice already exists for the order: re-read and show it.
        settled = true;
        await onConflict();
      } else if (Object.keys(result.state.fieldErrors ?? {}).length > 0) {
        setAttempt((n) => n + 1);
      }
    } finally {
      if (!settled) setBusy(false);
    }
  };

  return (
    <form
      ref={formRef}
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
      {canReadCustomers ? (
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <CustomerPicker
            messages={messages}
            locale={locale}
            label={translate(messages, 'invoices.create.payer')}
            value={payer}
            onChange={(next) => {
              setPayer(next);
              setErrors({});
              setOutcome(null);
            }}
            canSearch
            error={errorFor('payerPartnerId')}
            testId="invoice-payer-picker"
            material
          />
          <p className="text-caption text-text-muted">
            {translate(messages, 'invoices.create.payerHelp')}
          </p>
        </div>
      ) : (
        <div className="sm:col-span-2">
          <FormTextField
            label={translate(messages, 'invoices.create.payerReference')}
            description={translate(messages, 'invoices.create.payerReferenceHelp')}
            autoComplete="off"
            dir="ltr"
            value={payerReference}
            onChange={(next) => {
              setPayerReference(next);
              setErrors({});
              setOutcome(null);
            }}
            error={errorFor('payerPartnerId')}
          />
        </div>
      )}
      <div className="sm:col-span-2">
        <OutcomeNote messages={messages} outcome={outcome} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
          {translate(messages, 'invoices.create.submit')}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * The payer, by name
 * ------------------------------------------------------------------ */

/**
 * Who the invoice bills, by name (browser QA rows 5.1b and OBS-4).
 *
 * The invoice read publishes the payer's id and nothing else, so the name comes
 * from what already names it: the work order's customer when that customer is
 * the payer, and otherwise this invoice's own row of the branch's invoice list
 * (`sal.invoice-list`), found by its number — the list names a payer only for a
 * caller who may read customers, and this screen shows no more than that. A
 * draft has no number to find it by; then, as when nothing names the payer, the
 * screen says the name is not shown here, and never prints the reference.
 */
function usePayerName(
  invoice: Invoice,
  workOrder: WorkOrderListEntry | null,
  canLookUp: boolean
): PayerName {
  const fromJob =
    workOrder?.customer && workOrder.customer.partnerId === invoice.payerPartnerId
      ? workOrder.customer.displayName
      : null;
  const number = invoice.invoiceNumber;
  const lookUp = fromJob === null && canLookUp && number !== null;
  const [found, setFound] = useState<PayerName | null>(null);
  useEffect(() => {
    if (!lookUp || number === null) return;
    let live = true;
    void listInvoices(
      { companyId: invoice.companyId, branchId: invoice.branchId },
      { q: number },
      null
    )
      .then((page) => {
        if (!live) return;
        const name =
          page.status === 'ok'
            ? (page.data.items.find((row) => row.id === invoice.id)?.payer.displayName ?? null)
            : null;
        setFound(name === null ? { kind: 'notShown' } : { kind: 'named', name });
      })
      .catch(() => {
        if (live) setFound({ kind: 'notShown' });
      });
    return () => {
      live = false;
    };
  }, [lookUp, number, invoice.companyId, invoice.branchId, invoice.id]);

  if (fromJob !== null) return { kind: 'named', name: fromJob };
  if (!lookUp) return { kind: 'notShown' };
  return found ?? { kind: 'loading' };
}

function PayerText({
  messages,
  payer,
}: {
  readonly messages: Messages;
  readonly payer: PayerName;
}) {
  if (payer.kind === 'named') return <bdi>{payer.name}</bdi>;
  return (
    <span className="text-text-muted">
      {translate(
        messages,
        payer.kind === 'loading' ? 'invoices.detail.payerLoading' : 'invoices.detail.payerNotShown'
      )}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * FE-015 / FE-019 / FE-020 — the invoice, its balance, and the acts on it
 * ------------------------------------------------------------------ */

function InvoicePanel({
  locale,
  messages,
  invoice,
  workOrder,
  canViewFinance,
  canIssue,
  canRaiseCredit,
  onChanged,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly invoice: Invoice;
  readonly workOrder: WorkOrderListEntry | null;
  readonly canViewFinance: boolean;
  readonly canIssue: boolean;
  readonly canRaiseCredit: boolean;
  /** Re-reads the order's invoice and remounts the panels; resolves once it has. */
  readonly onChanged: (notice: WriteNotice | null) => Promise<void>;
}) {
  const [detail, setDetail] = useState<ReadState<InvoiceDetail> | null>(null);
  const [attempt, setAttempt] = useState(0);
  // The balance panel's own read, reported up so the credit form is offered
  // only while money is still open — one read, not two.
  const [balance, setBalance] = useState<Outstanding | null>(null);
  const payer = usePayerName(invoice, workOrder, canViewFinance);
  useEffect(() => {
    let live = true;
    void readInvoice(invoice.id).then((state) => {
      if (live) setDetail(state);
    });
    return () => {
      live = false;
    };
  }, [invoice.id, attempt]);

  if (detail === null || detail.status !== 'ok') {
    return (
      <section
        className="rounded-lg border border-border bg-surface p-4"
        lang={locale}
        data-print="hide"
      >
        <ReadRefusal
          messages={messages}
          locale={locale}
          state={detail}
          kind="detail"
          onRetry={() => {
            setDetail(null);
            setAttempt((n) => n + 1);
          }}
        />
      </section>
    );
  }

  return (
    <>
      <DetailPanel locale={locale} messages={messages} detail={detail.data} payer={payer} />
      <OutstandingPanel
        locale={locale}
        messages={messages}
        invoiceId={invoice.id}
        canViewFinance={canViewFinance}
        onRead={setBalance}
      />
      <ActionsPanel
        messages={messages}
        locale={locale}
        detail={detail.data}
        canViewFinance={canViewFinance}
        canIssue={canIssue}
        onChanged={onChanged}
      />
      {canRaiseCredit &&
      canViewFinance &&
      (detail.data.invoice.status === 'issued' || detail.data.invoice.status === 'credited') &&
      balance !== null &&
      !balance.isSettled ? (
        <section
          aria-labelledby="credit-note-request-heading"
          className="flex min-h-0 flex-col gap-3 rounded-lg border border-border bg-surface p-4"
          lang={locale}
          data-print="hide"
        >
          <CreditNoteRequestForm
            locale={locale}
            messages={messages}
            source={{ kind: 'known', invoice: { id: invoice.id, open: balance.outstanding } }}
            onRequested={(echo) =>
              onChanged({
                messageKey: echo.replayed
                  ? 'creditNotes.request.replayed'
                  : 'creditNotes.request.recorded',
                figure: null,
              })
            }
          />
        </section>
      ) : null}
      <PrintPanel
        locale={locale}
        messages={messages}
        detail={detail.data}
        workOrderNumber={workOrder?.displayNumber ?? null}
        payer={payer}
        canViewFinance={canViewFinance}
        settlement={balance?.settlement ?? null}
      />
    </>
  );
}

function DetailPanel({
  locale,
  messages,
  detail,
  payer,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: InvoiceDetail;
  readonly payer: PayerName;
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
            <When value={invoice.issuedAt} locale={locale} />
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'invoices.detail.notIssuedYet')}
            </span>
          )}
        </Field>
        <Field label={translate(messages, 'invoices.detail.currency')}>
          <span dir="ltr">{invoice.currency}</span>
        </Field>
        <Field label={translate(messages, 'invoices.detail.payer')} wide>
          <PayerText messages={messages} payer={payer} />
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
        <div className="overflow-x-auto">
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
        </div>
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
  onRead,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly invoiceId: string;
  readonly canViewFinance: boolean;
  /** The balance as read, or `null` when it could not be — never a guessed zero. */
  readonly onRead?: (balance: Outstanding | null) => void;
}) {
  const [state, setState] = useState<ReadState<Outstanding> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!canViewFinance) return;
    let live = true;
    void readOutstanding(invoiceId).then((next) => {
      if (!live) return;
      setState(next);
      onRead?.(next.status === 'ok' ? next.data : null);
    });
    return () => {
      live = false;
    };
    // `onRead` is the parent's state setter, so it is stable and never re-reads.
  }, [invoiceId, canViewFinance, onRead, attempt]);

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
        <ReadRefusal
          messages={messages}
          locale={locale}
          state={state}
          kind="outstanding"
          onRetry={() => {
            setState(null);
            setAttempt((n) => n + 1);
          }}
        />
      ) : (
        <dl className="grid gap-3 sm:grid-cols-3">
          <Field label={translate(messages, 'invoices.outstanding.amount')}>
            <Money money={state.data.outstanding} locale={locale} />
          </Field>
          {state.data.settlement ? (
            <SettlementFields
              locale={locale}
              messages={messages}
              settlement={state.data.settlement}
            />
          ) : (
            <Field label={translate(messages, 'invoices.outstanding.settlement')}>
              {state.data.isSettled
                ? translate(messages, 'invoices.outstanding.settled')
                : translate(messages, 'invoices.outstanding.open')}
            </Field>
          )}
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

/**
 * The three positions of an issued invoice, kept apart (Owner decision D7,
 * ADR-023): how much has been credited, how much of what is payable has been
 * paid, and whether anything was handed back. Each is the server's derivation,
 * worded here; a fully credited invoice reads "Fully credited" and "Nothing to
 * pay", never "Settled". The credited and paid amounts are shown beside them.
 */
function SettlementFields({
  locale,
  messages,
  settlement,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly settlement: Settlement;
}) {
  return (
    <>
      <Field label={translate(messages, 'invoices.settlement.credit')}>
        <span data-testid="invoice-credit-status">
          {translateDynamic(messages, `invoices.creditStatus.${settlement.creditStatus}`)}
        </span>
      </Field>
      <Field label={translate(messages, 'invoices.settlement.credited')}>
        <Money money={settlement.credited} locale={locale} />
      </Field>
      <Field label={translate(messages, 'invoices.settlement.payment')}>
        <span data-testid="invoice-payment-status">
          {translateDynamic(messages, `invoices.paymentStatus.${settlement.paymentStatus}`)}
        </span>
      </Field>
      <Field label={translate(messages, 'invoices.settlement.paid')}>
        <Money money={settlement.paid} locale={locale} />
      </Field>
      <Field label={translate(messages, 'invoices.settlement.refund')}>
        <span data-testid="invoice-refund-status">
          {translateDynamic(messages, `invoices.refundStatus.${settlement.refundStatus}`)}
        </span>
      </Field>
    </>
  );
}

/**
 * Issuing and cancelling a draft. Issuing asks first (`ConfirmDialog`: the
 * number is allocated and the invoice is fixed); cancelling takes a reason in
 * `ReasonDialog`, refused as a field error on the box when it is missing or too
 * long. Both carry the INVOICE's version as the detail read published it, and
 * both stay busy — the dialog's buttons disabled, Escape inert — until the
 * screen has re-read the invoice and remounted this panel, so a second press
 * can never send the version just spent.
 */
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
  readonly onChanged: (notice: WriteNotice | null) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState<'issue' | 'cancel' | null>(null);
  const [issueOutcome, setIssueOutcome] = useState<ActionState | null>(null);
  const [cancelOutcome, setCancelOutcome] = useState<ActionState | null>(null);

  const isDraft = detail.invoice.status === 'draft';
  const offerIssue = isDraft && canIssue && canViewFinance;
  const offerCancel = isDraft;

  const issue = async () => {
    setBusy(true);
    let settled = false;
    try {
      let result: Awaited<ReturnType<typeof issueInvoice>>;
      try {
        // The INVOICE's version, as the detail read published it — never a line's.
        result = await issueInvoice(detail.invoice.id, detail.invoice.recordVersion);
      } catch {
        setAsking(null);
        setIssueOutcome(unreachable(1));
        return;
      }
      setIssueOutcome(result.state);
      notifyActionResult(result.state, messages);
      // On success or conflict the parent re-reads and REMOUNTS this panel; busy
      // stays raised until then so a second press cannot send the superseded
      // version and overwrite a truthful notice.
      if (result.state.status === 'success' && result.created) {
        settled = true;
        await onChanged({
          messageKey: result.created.replayed
            ? 'invoices.issue.replayed'
            : 'invoices.issue.recorded',
          figure: result.created.invoiceNumber,
        });
      } else if (result.state.status === 'conflict') {
        // Changed since it was read: say so, and re-read.
        settled = true;
        await onChanged({ messageKey: 'invoices.detail.conflict', figure: null });
      } else {
        setAsking(null);
      }
    } finally {
      if (!settled) setBusy(false);
    }
  };

  const cancel = async (reason: string) => {
    if (reason.length > MAX_REASON) {
      setCancelOutcome({
        status: 'invalid',
        fieldErrors: { reason: 'invoices.cancel.reasonTooLong' },
      });
      return;
    }
    setBusy(true);
    let settled = false;
    try {
      let result: Awaited<ReturnType<typeof cancelInvoice>>;
      try {
        result = await cancelInvoice(detail.invoice.id, { reason }, detail.invoice.recordVersion);
      } catch {
        setCancelOutcome(unreachable(1));
        return;
      }
      setCancelOutcome(result.state);
      notifyActionResult(result.state, messages);
      if (result.state.status === 'success' && result.created) {
        settled = true;
        await onChanged({
          messageKey: result.created.replayed
            ? 'invoices.cancel.replayed'
            : 'invoices.cancel.recorded',
          figure: null,
        });
      } else if (result.state.status === 'conflict') {
        settled = true;
        await onChanged({ messageKey: 'invoices.detail.conflict', figure: null });
      }
    } finally {
      if (!settled) setBusy(false);
    }
  };

  if (!offerIssue && !offerCancel) return null;

  const cancelReasonError = cancelOutcome?.fieldErrors?.['reason']
    ? translateDynamic(messages, cancelOutcome.fieldErrors['reason'])
    : undefined;
  const cancelRefusal =
    cancelOutcome &&
    cancelReasonError === undefined &&
    cancelOutcome.status !== 'success' &&
    cancelOutcome.status !== 'idle'
      ? translateDynamic(messages, cancelOutcome.messageKey ?? 'action.failed')
      : undefined;

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
            <Button
              type="button"
              variant="contained"
              disabled={busy}
              onClick={() => {
                setIssueOutcome(null);
                setAsking('issue');
              }}
            >
              {translate(messages, 'invoices.issue.action')}
            </Button>
          </div>
          {asking === 'issue' ? null : <OutcomeNote messages={messages} outcome={issueOutcome} />}
        </div>
      ) : null}
      {offerCancel ? (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          <p className="text-caption text-text-muted">
            {translate(messages, 'invoices.cancel.explain')}
          </p>
          <div>
            <Button
              type="button"
              variant="outlined"
              disabled={busy}
              onClick={() => {
                setCancelOutcome(null);
                setAsking('cancel');
              }}
            >
              {translate(messages, 'invoices.cancel.open')}
            </Button>
          </div>
        </div>
      ) : null}
      <ConfirmDialog
        open={asking === 'issue'}
        messages={messages}
        title={translate(messages, 'invoices.issue.confirmTitle')}
        description={translate(messages, 'invoices.issue.explain')}
        confirmLabel={translate(messages, 'invoices.issue.action')}
        pending={busy}
        error={
          issueOutcome && issueOutcome.status !== 'success' && issueOutcome.status !== 'idle'
            ? translateDynamic(messages, issueOutcome.messageKey ?? 'action.failed')
            : undefined
        }
        onCancel={() => setAsking(null)}
        onConfirm={() => void issue()}
        testId="invoice-issue-dialog"
      />
      <ReasonDialog
        open={asking === 'cancel'}
        messages={messages}
        title={translate(messages, 'invoices.cancel.heading')}
        description={translate(messages, 'invoices.cancel.explain')}
        reasonLabel={translate(messages, 'invoices.cancel.reason')}
        confirmLabel={translate(messages, 'invoices.cancel.submit')}
        maxLength={MAX_REASON}
        destructive
        pending={busy}
        error={cancelRefusal}
        reasonError={cancelReasonError}
        onCancel={() => {
          setAsking(null);
          setCancelOutcome(null);
        }}
        onConfirm={(reason) => void cancel(reason)}
        testId="invoice-cancel-dialog"
      />
    </section>
  );
}

/**
 * The printable copy of a COUNTER SALE (P1-32-PRE-OD-FIN, GAP-09).
 *
 * A counter sale has no work order, so it never reaches the invoice screen above,
 * which is entered through one — and the counter-sales screen offered no copy at
 * all. This is the same paper view: the same document, the same Print button, the
 * payer found the same way, and lines described by the item each one sold, which
 * the detail itself now names. The caller places it as its own direct child of a
 * `data-print-scope`, so paper carries the copy and not the working panels.
 */
export function CounterSalePrintPanel({
  locale,
  messages,
  detail,
  canViewFinance,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: InvoiceDetail;
  readonly canViewFinance: boolean;
}) {
  const payer = usePayerName(detail.invoice, null, canViewFinance);
  return (
    <PrintPanel
      locale={locale}
      messages={messages}
      detail={detail}
      workOrderNumber={null}
      payer={payer}
      canViewFinance={canViewFinance}
      settlement={null}
    />
  );
}

function PrintPanel({
  locale,
  messages,
  detail,
  workOrderNumber,
  payer,
  canViewFinance,
  settlement,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly detail: InvoiceDetail;
  readonly workOrderNumber: string | null;
  readonly payer: PayerName;
  readonly canViewFinance: boolean;
  /** The credit and payment positions as the balance panel read them (D7), or null. */
  readonly settlement: Settlement | null;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<ReadState<InvoicePreview> | null>(null);
  const workOrderId = detail.invoice.workOrderId;
  useEffect(() => {
    // Descriptions live only on the preview, which is money and needs the
    // code; it is read once, when the paper view is asked for.
    //
    // A counter sale carries no work order (P1-32) and so has no preview to
    // read: its lines were priced from the item price list rather than
    // snapshotted from an accepted quotation revision, and the preview route
    // takes a work order in its path. Nothing is read for one.
    if (!open || !canViewFinance || preview !== null || workOrderId === null) return;
    let live = true;
    void readInvoicePreview(workOrderId).then((state) => {
      if (live) setPreview(state);
    });
    return () => {
      live = false;
    };
  }, [open, canViewFinance, preview, workOrderId]);

  // A counter sale has no preview to wait for: its lines name their items on the
  // detail itself (GAP-09). Waiting for a preview that is never requested left the
  // panel loading forever and offered no Print button.
  const counterSale = workOrderId === null;
  const ready = counterSale || !canViewFinance || preview !== null;

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
        <Button
          type="button"
          variant="outlined"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {translate(messages, open ? 'invoices.print.close' : 'invoices.print.open')}
        </Button>
        {open && ready ? (
          <Button type="button" variant="contained" onClick={() => window.print()}>
            {translate(messages, 'invoices.print.print')}
          </Button>
        ) : null}
      </div>
      {open ? (
        !ready ? (
          <MuiLoadingState messages={messages} variant="inline" />
        ) : (
          <InvoiceDocument
            locale={locale}
            messages={messages}
            detail={detail}
            payer={payer}
            descriptions={
              counterSale
                ? { kind: 'items' }
                : !canViewFinance
                  ? { kind: 'notRead' }
                  : preview === null || preview.status !== 'ok'
                    ? { kind: 'refused', reference: preview?.correlationId ?? null }
                    : preview.data.quotationRevisionId === detail.invoice.quotationRevisionId
                      ? { kind: 'matched', preview: preview.data }
                      : { kind: 'mismatch' }
            }
            workOrderNumber={workOrderNumber}
            settlement={settlement}
          />
        )
      ) : null}
    </section>
  );
}
