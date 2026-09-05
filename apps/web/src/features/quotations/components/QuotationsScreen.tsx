'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { TextField } from '@/components/forms/Field';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import type { ActionState } from '@/lib/forms/action-result';

import { createQuotation, listQuotations } from '../api';
import { INTERNAL_CODE, type QuotationSummary } from '../quotations-contract';
import {
  Figure,
  LinesEditor,
  OutcomeNote,
  PRIMARY_BUTTON,
  QuotationStatusBadge,
  SECONDARY_BUTTON,
  UUID,
  newLine,
  validateLines,
  type DraftLine,
} from './shared';

/**
 * The quotations of one work order, and the builder (P1-30, `W3`, FE-003, FE-005).
 *
 * ## Reached from a work order
 *
 * There is no quotation list wider than a work order — the backend refuses one
 * as scope-inert — so this screen takes the work order's id from its address.
 * Without one it explains that and offers an identifier field; with one it
 * lists `quo.quotation-list` and, for a manager, offers the builder.
 *
 * ## The builder sends lines; the server prices them
 *
 * A line is a service, a quantity and an optional discount and description.
 * Every figure on the resulting quotation — unit price, tax, line total, the
 * four totals — is the server's, captured at creation. Nothing is priced here.
 *
 * ## The discount request is the discount field, and its refusal is shown
 *
 * A discount is authorized synchronously inside the write: the company's
 * policy decides whether it needs an elevated permission and the actor's
 * approval limit decides whether the amount is within reach. A refusal comes
 * back as a denial with a reference, and it renders as that refusal — never
 * as a quotation with the discount quietly dropped.
 */

export function QuotationsScreen({
  locale,
  messages,
  workOrderId,
  workOrder,
  canManage,
  canReadServices,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** From the address; `null` when the page was reached without one. */
  readonly workOrderId: string | null;
  /** The page's own read of the work order, when the operator may read it; else `null`. */
  readonly workOrder: WorkOrderListEntry | null;
  /** `quo.quotation.manage` — decides whether the builder is offered. */
  readonly canManage: boolean;
  /** `svc.service.read` — decides whether a service can be found by code. */
  readonly canReadServices: boolean;
}) {
  const [building, setBuilding] = useState(false);

  if (workOrderId === null) {
    return <ChooseWorkOrder locale={locale} messages={messages} />;
  }

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <section
        aria-labelledby="quotations-work-order-heading"
        className="rounded-lg border border-border bg-surface p-4"
        lang={locale}
      >
        <h2 id="quotations-work-order-heading" className="text-body font-medium text-text-primary">
          {translate(messages, 'quotations.list.workOrderHeading')}
        </h2>
        <dl className="mt-3 grid gap-3 sm:grid-cols-3">
          <Figure label={translate(messages, 'quotations.list.workOrderRef')}>
            <Link
              href={`/${locale}/work-orders/${workOrderId}`}
              className="font-mono text-caption text-primary underline-offset-2 hover:underline"
              dir="ltr"
            >
              {workOrder?.displayNumber ?? workOrderId}
            </Link>
          </Figure>
          {workOrder ? (
            <>
              <Figure label={translate(messages, 'quotations.list.workOrderState')}>
                <bdi>{workOrder.state}</bdi>
              </Figure>
              <Figure label={translate(messages, 'quotations.list.customer')}>
                {workOrder.customer ? (
                  <bdi>{workOrder.customer.displayName}</bdi>
                ) : (
                  <span className="text-text-muted">
                    {translate(messages, 'quotations.list.noCustomer')}
                  </span>
                )}
              </Figure>
            </>
          ) : (
            <Figure label={translate(messages, 'quotations.list.workOrderState')} wide>
              <span className="text-text-muted">
                {translate(messages, 'quotations.list.workOrderNotReadable')}
              </span>
            </Figure>
          )}
        </dl>
      </section>

      {canManage ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className={SECONDARY_BUTTON}
            aria-expanded={building}
            onClick={() => setBuilding((open) => !open)}
          >
            {translate(messages, 'quotations.list.create')}
          </button>
        </div>
      ) : null}

      {canManage && building ? (
        <QuotationBuilder
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          payerPartnerRef={workOrder?.customer?.partnerId ?? ''}
          canReadServices={canReadServices}
          onClose={() => setBuilding(false)}
        />
      ) : null}

      <QuotationsResults locale={locale} messages={messages} workOrderId={workOrderId} />
    </div>
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
          setError(translate(messages, 'quotations.common.idFormat'));
          return;
        }
        router.push(`/${locale}/quotations?workOrderId=${encodeURIComponent(id)}`);
      }}
      noValidate
      aria-labelledby="quotations-choose-heading"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotations-choose-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.choose.heading')}
      </h2>
      <p className="text-body text-text-secondary">
        {translate(messages, 'quotations.choose.explain')}
      </p>
      <p className="text-body">
        <Link
          href={`/${locale}/work-orders`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'quotations.choose.boardLink')}
        </Link>
      </p>
      <TextField
        label={translate(messages, 'quotations.choose.workOrderId')}
        required
        spellCheck={false}
        dir="ltr"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        error={error}
      />
      <div>
        <button type="submit" className={PRIMARY_BUTTON}>
          {translate(messages, 'quotations.choose.submit')}
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------ *
 * The list
 * ------------------------------------------------------------------ */

function QuotationsResults({
  locale,
  messages,
  workOrderId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) => listQuotations(workOrderId, request, cursor),
    [workOrderId]
  );
  const table = useServerTable<QuotationSummary>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<QuotationSummary>[]>(
    () => [
      {
        id: 'quotationNumber',
        headerKey: 'quotations.list.column.number',
        cell: (row) => (
          <Link
            href={`/${locale}/quotations/${row.id}`}
            className="font-mono text-caption text-primary underline-offset-2 hover:underline"
            dir="ltr"
          >
            {row.quotationNumber}
          </Link>
        ),
      },
      {
        id: 'status',
        headerKey: 'quotations.list.column.status',
        cell: (row) => <QuotationStatusBadge messages={messages} status={row.status} />,
      },
      {
        id: 'currency',
        headerKey: 'quotations.list.column.currency',
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.currency}
          </code>
        ),
      },
      {
        id: 'currentRevision',
        headerKey: 'quotations.list.column.currentRevision',
        cell: (row) =>
          row.currentRevisionId ? (
            <span>{translate(messages, 'quotations.list.hasCurrent')}</span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'quotations.list.noCurrent')}
            </span>
          ),
      },
    ],
    [locale, messages]
  );

  return (
    <section aria-labelledby="quotations-heading" className="flex min-h-0 flex-col gap-2">
      <h2 id="quotations-heading" className="sr-only">
        {translate(messages, 'quotations.list.resultsHeading')}
      </h2>
      <DataTable<QuotationSummary>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'quotations.list.caption')}
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'quotations.list.none')}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * The builder — FE-003 and FE-005
 * ------------------------------------------------------------------ */

function QuotationBuilder({
  locale,
  messages,
  workOrderId,
  payerPartnerRef,
  canReadServices,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  /** Prefilled from the work order's customer when the page could read it. */
  readonly payerPartnerRef: string;
  readonly canReadServices: boolean;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  const [payer, setPayer] = useState(payerPartnerRef);
  const [customerClass, setCustomerClass] = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const [lines, setLines] = useState<readonly DraftLine[]>([newLine()]);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);

  const errorFor = (name: string): string | undefined => {
    const key = errors[name] ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const { bodies, errors: found } = validateLines(lines);
    const payerId = payer.trim();
    if (payerId.length > 0 && !UUID.test(payerId))
      found['payerPartnerRef'] = 'quotations.common.idFormat';
    const klass = customerClass.trim();
    if (klass.length > 0 && !INTERNAL_CODE.test(klass))
      found['customerClass'] = 'quotations.common.classFormat';
    const requester = requestedBy.trim();
    if (requester.length > 0 && !UUID.test(requester)) {
      found['discountRequestedBy'] = 'quotations.common.idFormat';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    const result = await createQuotation({
      workOrderId,
      ...(payerId ? { payerPartnerRef: payerId } : {}),
      ...(klass ? { customerClass: klass } : {}),
      lines: bodies,
      ...(requester ? { discountRequestedBy: requester } : {}),
    });
    setBusy(false);
    setOutcome(result.state);
    notifyActionResult(result.state, messages);
    if (result.state.status === 'success' && result.created) {
      router.push(`/${locale}/quotations/${result.created.id}`);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      aria-labelledby="quotation-build-heading"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
      lang={locale}
    >
      <h2 id="quotation-build-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'quotations.build.heading')}
      </h2>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.build.explain')}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          label={translate(messages, 'quotations.build.payer')}
          description={translate(messages, 'quotations.build.payerHelp')}
          spellCheck={false}
          dir="ltr"
          value={payer}
          onChange={(event) => setPayer(event.target.value)}
          error={errorFor('payerPartnerRef')}
        />
        <TextField
          label={translate(messages, 'quotations.build.customerClass')}
          description={translate(messages, 'quotations.common.classHelp')}
          spellCheck={false}
          dir="ltr"
          value={customerClass}
          onChange={(event) => setCustomerClass(event.target.value)}
          error={errorFor('customerClass')}
        />
        <TextField
          label={translate(messages, 'quotations.build.requestedBy')}
          description={translate(messages, 'quotations.build.requestedByHelp')}
          spellCheck={false}
          dir="ltr"
          value={requestedBy}
          onChange={(event) => setRequestedBy(event.target.value)}
          error={errorFor('discountRequestedBy')}
        />
      </div>
      <LinesEditor
        messages={messages}
        currency={null}
        lines={lines}
        onChange={setLines}
        canReadServices={canReadServices}
        errors={errors}
      />
      <OutcomeNote
        messages={messages}
        outcome={outcome}
        hintKey="quotations.build.discountRefusedHint"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className={PRIMARY_BUTTON} disabled={busy}>
          {translate(messages, 'quotations.build.submit')}
        </button>
        <button type="button" className={SECONDARY_BUTTON} onClick={onClose}>
          {translate(messages, 'quotations.build.cancel')}
        </button>
      </div>
    </form>
  );
}
