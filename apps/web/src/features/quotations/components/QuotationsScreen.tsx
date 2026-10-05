'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useId, useMemo, useState } from 'react';
import Button from '@mui/material/Button';

import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { FormTextField } from '@/components/forms/mui/FormTextField';
import { notifyActionResult } from '@/components/notifications/action-notifications';
import { CustomerPicker, type ChosenCustomer } from '@/components/party/CustomerPicker';
import type { WorkOrderListEntry } from '@/features/work-orders/work-orders-contract';
import {
  WorkOrderPicker,
  useWorkOrderSearchScope,
} from '@/features/work-orders/components/WorkOrderPicker';
import { useUnsavedGuard } from '@/features/working-context/WorkingContextProvider';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { unreachable, type ActionState } from '@/lib/forms/action-result';
import { useFocusFirstInvalid } from '@/lib/forms/use-focus-first-invalid';
import { useLocalRefusal } from '@/lib/forms/use-local-refusal';

import { createQuotation, listQuotations } from '../api';
import { DiscountApprovalsPanel } from './DiscountApprovalsPanel';
import { INTERNAL_CODE, type QuotationSummary } from '../quotations-contract';
import {
  Figure,
  LinesEditor,
  lineErrors,
  lineValues,
  serverLineRefusals,
  linesDirty,
  OutcomeNote,
  QuotationStatusBadge,
  UUID,
  newLine,
  validateLines,
  type DraftLine,
} from './shared';

/**
 * The quotations of one work order, and the builder (P1-30, `W3`, FE-003, FE-005).
 * On the shared Material UI wrappers since the sales and finance slice
 * (ADR-022): the list is `OperationalGrid` (server paging, cursor footer), the
 * job and the payer are found with the shared comboboxes, the builder's fields
 * are the `forms/mui` fields, and every state is the Material state.
 *
 * ## Reached from a work order
 *
 * There is no quotation list wider than a work order — the backend refuses one
 * as scope-inert — so this screen takes the work order's id from its address.
 * Without one it explains that and offers a search over the branch's jobs; with one it
 * lists `quo.quotation-list` and, for a manager, offers the builder.
 *
 * ## The builder sends lines; the server prices them
 *
 * A line is a service, a quantity and an optional discount and description.
 * Every figure on the resulting quotation — unit price, tax, line total, the
 * four totals — is the server's, captured at creation. Nothing is priced here.
 *
 * ## A discount over the threshold is asked for, and approved by somebody else
 *
 * The builder asks for nobody's name. A discount that reaches the company's
 * threshold is recorded by the server as a request from whoever is signed in,
 * and the quotation cannot be issued until a different person approves it
 * (P1-32-PRE-OD-DISC-01). Without a work order this page also lists the working
 * branch's discounts waiting for approval, where an approver decides them.
 *
 * ## Names, not references
 *
 * The job is named by its number; where the operator may not read work orders
 * the link says so in words rather than printing the job's reference.
 */

export function QuotationsScreen({
  locale,
  messages,
  workOrderId,
  workOrder,
  canManage,
  canReadServices,
  canReadItems = false,
  canSearchWorkOrders = false,
  canReadCustomers = false,
  canReadApprovals = false,
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
  /**
   * `inv.item.read` — whether a line may quote a part from the item catalogue
   * (ADR-023 D6). Without it every line is a service line, as before.
   */
  readonly canReadItems?: boolean;
  /** `wo.work_order.read` — decides whether the job can be FOUND when none is named. */
  readonly canSearchWorkOrders?: boolean;
  /** `crm.customer.read` — whether the paying customer can be found by name. */
  readonly canReadCustomers?: boolean;
  /**
   * `quo.quotation.read` — whether the discounts waiting for approval are listed.
   * Whether each one can be decided is the server's per-row answer.
   */
  readonly canReadApprovals?: boolean;
}) {
  const [building, setBuilding] = useState(false);

  if (workOrderId === null) {
    return (
      <div className="flex min-h-0 flex-col gap-4">
        <ChooseWorkOrder
          locale={locale}
          messages={messages}
          canSearchWorkOrders={canSearchWorkOrders}
        />
        {canReadApprovals ? <DiscountApprovalsPanel locale={locale} messages={messages} /> : null}
      </div>
    );
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
              className="text-primary underline-offset-2 hover:underline"
            >
              {workOrder?.displayNumber ? (
                <bdi className="font-mono">{workOrder.displayNumber}</bdi>
              ) : (
                translate(messages, 'quotations.list.openWorkOrder')
              )}
            </Link>
          </Figure>
          {workOrder ? (
            <>
              <Figure label={translate(messages, 'quotations.list.workOrderState')}>
                {translateDynamic(messages, `workOrders.state.${workOrder.state}`)}
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
          <Button
            type="button"
            variant="outlined"
            aria-expanded={building}
            onClick={() => setBuilding((open) => !open)}
          >
            {translate(messages, 'quotations.list.create')}
          </Button>
        </div>
      ) : null}

      {canManage && building ? (
        <QuotationBuilder
          locale={locale}
          messages={messages}
          workOrderId={workOrderId}
          payer={
            workOrder?.customer
              ? {
                  id: workOrder.customer.partnerId,
                  displayName: workOrder.customer.displayName,
                  displayNumber: null,
                }
              : null
          }
          canReadServices={canReadServices}
          canReadItems={canReadItems}
          canReadCustomers={canReadCustomers}
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
   * The chosen job is not unsaved work: this form writes nothing, it opens the
   * quotation page for the job, so a branch switch forgets the choice without
   * asking — the rule the invoice desk's chooser follows (route sweep B3).
   */
  const [chosen, setChosen] = useState<WorkOrderListEntry | null>(null);
  // An attempt counter rather than a flag: the focus hook moves the cursor to
  // the box once per refused attempt, never on a re-render.
  const [refusal, setRefusal] = useState<ActionState>({ status: 'idle' });
  const formRef = useFocusFirstInvalid(refusal);
  const error =
    refusal.status === 'invalid' && chosen === null
      ? translate(messages, 'workOrders.picker.required')
      : undefined;
  /*
   * With nothing to search — "All my branches" spanning companies, or no branch
   * chosen yet — the picker offers no box, so a refusal would have no control to
   * point at. The submit is disabled instead, described by the sentence the
   * picker shows in place of the box.
   */
  const scope = useWorkOrderSearchScope();
  const needsBranchId = useId();
  const blocked = chosen === null && scope === null;
  return (
    <form
      ref={formRef}
      onSubmit={(event) => {
        event.preventDefault();
        if (chosen === null) {
          setRefusal((previous) => ({
            status: 'invalid',
            fieldErrors: { workOrderId: 'workOrders.picker.required' },
            attempt: (previous.attempt ?? 0) + 1,
          }));
          return;
        }
        router.push(`/${locale}/quotations?workOrderId=${encodeURIComponent(chosen.id)}`);
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
      <WorkOrderPicker
        messages={messages}
        label={translate(messages, 'quotations.choose.workOrderId')}
        value={chosen}
        onChange={setChosen}
        error={error}
        canSearch={canSearchWorkOrders}
        needsBranchId={needsBranchId}
        countsAsUnsaved={false}
        offersBranchChooser
        material
      />
      {canSearchWorkOrders ? (
        <div>
          <Button
            type="submit"
            variant="contained"
            disabled={blocked}
            aria-describedby={blocked ? needsBranchId : undefined}
          >
            {translate(messages, 'quotations.choose.submit')}
          </Button>
        </div>
      ) : null}
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

  const columns = useMemo<readonly OperationalColumn<QuotationSummary>[]>(
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
      <OperationalGrid<QuotationSummary>
        messages={messages}
        locale={locale}
        label={translate(messages, 'quotations.list.caption')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        suppressEmptyState
        testId="quotations-grid"
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
  payer: initialPayer,
  canReadServices,
  canReadItems,
  canReadCustomers,
  onClose,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly workOrderId: string;
  /** Prefilled from the work order's customer when the page could read it. */
  readonly payer: ChosenCustomer | null;
  readonly canReadServices: boolean;
  readonly canReadItems: boolean;
  readonly canReadCustomers: boolean;
  readonly onClose: () => void;
}) {
  const router = useRouter();
  /*
   * The paying customer is FOUND and chosen by name (Owner directive,
   * `P1-32-PRE-OD-UX`); it used to be a box asking for a reference. The payer
   * opens on the work order's own customer, which is a default rather than
   * unsaved work. Nobody is named for a discount: the server records whoever is
   * signed in as the one asking for it.
   *
   * The customer search needs `crm.customer.read`, and creating a quotation does
   * NOT: `quo.quotation-create` declares `quo.quotation.manage` and
   * `wo.work_order.read` only. So a caller without the customer read keeps the
   * box they had before — a payer reference, opened on the work order's own
   * customer as it always was, labelled as the fallback it is, checked for shape
   * before it is sent, and counted as unsaved work once it differs from that
   * default. With the customer read there is no box at all.
   */
  const [payer, setPayer] = useState<ChosenCustomer | null>(initialPayer);
  const [payerReference, setPayerReference] = useState(initialPayer?.id ?? '');
  const [customerClass, setCustomerClass] = useState('');
  const [lines, setLines] = useState<readonly DraftLine[]>([newLine()]);
  // Question f: the cursor goes to the first thing to fix, and a complaint is
  // withdrawn once its field changes (route sweep B3).
  const {
    errorKey: localErrorKey,
    errors: localErrors,
    formRef: localFormRef,
    refuse: localRefuse,
  } = useLocalRefusal({
    ...lineValues(lines),
    payerPartnerRef: canReadCustomers ? (payer?.id ?? '') : payerReference,
    customerClass,
  });
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<ActionState | null>(null);
  /*
   * Unsaved work, declared to the shell: a changed payer reference, a customer
   * class, or anything typed or chosen in the lines. A branch switch or leaving
   * the page asks first. A confirmed "Discard and change branch" opens the
   * builder again as it first opened: the work order's own customer as payer
   * and one empty line. The quotation is the work order's, nothing here is
   * keyed on the branch, and the question told the operator what was typed
   * would go. (The payer picker declares its own choice.)
   */
  const dirty =
    (!canReadCustomers && payerReference.trim() !== (initialPayer?.id ?? '')) ||
    customerClass.trim().length > 0 ||
    linesDirty(lines);
  useUnsavedGuard(dirty, () => {
    setPayer(initialPayer);
    setPayerReference(initialPayer?.id ?? '');
    setCustomerClass('');
    setLines([newLine()]);
    setOutcome(null);
  });

  const errorFor = (name: string): string | undefined => {
    const key = localErrorKey(name) ?? outcome?.fieldErrors?.[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  const submit = async () => {
    const { bodies, errors: found } = validateLines(lines, canReadServices);
    const payerId = canReadCustomers ? (payer?.id ?? '') : payerReference.trim();
    if (!canReadCustomers && payerId.length > 0 && !UUID.test(payerId))
      found['payerPartnerRef'] = 'quotations.build.payerReferenceFormat';
    const klass = customerClass.trim();
    if (klass.length > 0 && !INTERNAL_CODE.test(klass))
      found['customerClass'] = 'quotations.common.classFormat';
    localRefuse(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      let result: Awaited<ReturnType<typeof createQuotation>>;
      try {
        result = await createQuotation({
          workOrderId,
          ...(payerId ? { payerPartnerRef: payerId } : {}),
          ...(klass ? { customerClass: klass } : {}),
          lines: bodies,
        });
      } catch {
        // No answer came back: what was typed stays, and the submit works again.
        setOutcome(unreachable(1));
        return;
      }
      setOutcome(result.state);
      notifyActionResult(result.state, messages);
      // A refused discount is marked on its own line, focused and withdrawn once
      // corrected (ADR-023, D1): `lines` here is the draft that was sent.
      const placed = serverLineRefusals(lines, result.state);
      if (Object.keys(placed).length > 0) localRefuse(placed);
      if (result.state.status === 'success' && result.created) {
        // Stored, so nothing is unsaved any more: the lines go before the move.
        setLines([newLine()]);
        setCustomerClass('');
        router.push(`/${locale}/quotations/${result.created.id}`);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      ref={localFormRef}
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
      {canReadCustomers ? (
        <div className="flex flex-col gap-1.5">
          <CustomerPicker
            messages={messages}
            locale={locale}
            label={translate(messages, 'quotations.build.payer')}
            value={payer}
            onChange={setPayer}
            canSearch
            error={errorFor('payerPartnerRef')}
            pristineId={initialPayer?.id ?? null}
            testId="quotation-payer-picker"
            material
          />
          <p className="text-caption text-text-muted">
            {translate(messages, 'quotations.build.payerHelp')}
          </p>
        </div>
      ) : (
        <FormTextField
          label={translate(messages, 'quotations.build.payerReference')}
          description={translate(messages, 'quotations.build.payerReferenceHelp')}
          autoComplete="off"
          dir="ltr"
          value={payerReference}
          onChange={setPayerReference}
          error={errorFor('payerPartnerRef')}
        />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormTextField
          label={translate(messages, 'quotations.build.customerClass')}
          description={translate(messages, 'quotations.common.classHelp')}
          dir="ltr"
          autoComplete="off"
          value={customerClass}
          onChange={setCustomerClass}
          error={errorFor('customerClass')}
        />
      </div>
      <p className="text-caption text-text-muted">
        {translate(messages, 'quotations.build.discountApprovalHelp')}
      </p>
      <LinesEditor
        messages={messages}
        locale={locale}
        currency={null}
        lines={lines}
        onChange={setLines}
        canReadServices={canReadServices}
        canReadItems={canReadItems}
        errors={lineErrors(localErrors, outcome)}
      />
      <OutcomeNote
        messages={messages}
        outcome={outcome}
        hintKey="quotations.build.discountRefusedHint"
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="contained" disabled={busy} aria-busy={busy || undefined}>
          {translate(messages, 'quotations.build.submit')}
        </Button>
        <Button type="button" variant="outlined" onClick={onClose}>
          {translate(messages, 'quotations.build.cancel')}
        </Button>
      </div>
    </form>
  );
}
