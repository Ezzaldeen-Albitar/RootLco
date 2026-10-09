'use client';

/**
 * Refunds (ADR-023 D2, part 2, P1-32-PRE-OD-FD2B) — one branch's refund requests,
 * newest first, in the finance navigation; on the Material UI wrappers
 * (P1-32-PRE-OD-REPB).
 *
 * Who asked for what, by which method, what was decided and what was paid out —
 * narrowed by state, by customer and by invoice, in the working branch. Each row
 * links to the invoice, where the request is decided and its payout recorded: this
 * list finds the work, the invoice's refunds panel does it.
 *
 * `sal.finance.view` is what every refund read declares, and the page checks it
 * before anything is read. The customer filter is offered to a reader of customers
 * (`crm.customer.read`) and the invoice filter to a reader of invoices
 * (`sal.invoice.manage`), the codes their pickers' own reads declare. Every figure
 * is the server's; nothing is computed here. A request's moment is written on the
 * branch's clock, with the clock named.
 *
 * The branch is the working context's (`useBranchTarget`), named by
 * `WorkingBranchField` with its chooser while none is chosen, exactly as the
 * payments desk names it. An empty list says which empty it is: nothing asked for
 * in the branch yet, or nothing matching the choices — with the way to clear them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Button from '@mui/material/Button';

import {
  OperationalGrid,
  type OperationalColumn,
  type RowAction,
} from '@/components/data/OperationalGrid';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable, type ServerPage } from '@/components/data-table/use-server-table';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import { CustomerPicker, type ChosenCustomer } from '@/components/party/CustomerPicker';
import { MuiEmptyState } from '@/components/states/MuiStates';
import { WorkingBranchField } from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { formatMoney } from '@/lib/money';

import { listRefundRequests } from '../api';
import {
  REFUND_REQUEST_STATES,
  type InvoiceListEntry,
  type RefundRequest,
  type RefundRequestState,
} from '../billing-contract';
import { InvoicePicker } from './InvoicePicker';
import { RefundMoment, useBranchClock } from './RefundsPanel';

/** The branch a refund list reads, as the working context names it. */
interface RefundTarget {
  readonly companyId: string;
  readonly branchId: string;
}

const PANEL = 'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4';

export function RefundsScreen({
  locale,
  messages,
  currentUserId,
  canReadCustomers,
  canSearchInvoices,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly currentUserId: string;
  /** `crm.customer.read` — the customer filter's picker. */
  readonly canReadCustomers: boolean;
  /** `sal.invoice.manage` — the invoice filter's picker, and opening the invoice. */
  readonly canSearchInvoices: boolean;
}) {
  const [target, setTarget] = useState<RefundTarget | null>(null);
  return (
    <div className="flex min-h-0 flex-col gap-4">
      <p className="text-caption text-text-muted">{translate(messages, 'refunds.page.explain')}</p>
      <TargetPanel messages={messages} onChosen={setTarget} />
      {target === null ? null : (
        <BranchRefunds
          key={`${target.companyId}:${target.branchId}`}
          locale={locale}
          messages={messages}
          target={target}
          currentUserId={currentUserId}
          canReadCustomers={canReadCustomers}
          canSearchInvoices={canSearchInvoices}
        />
      )}
    </div>
  );
}

/**
 * The branch the list is read for: the working context's single branch, stated
 * rather than asked. It reports `null` while the selection is not one branch, so
 * the list is never left reading one branch under another branch's name.
 */
function TargetPanel({
  messages,
  onChosen,
}: {
  readonly messages: Messages;
  readonly onChosen: (next: RefundTarget | null) => void;
}) {
  const branch = useBranchTarget();
  const chosen = branch.kind === 'ready' ? branch.target : null;
  const reported = useRef<string | null>(null);

  useEffect(() => {
    const key = chosen === null ? '' : `${chosen.companyId}:${chosen.branchId}`;
    if (reported.current === key) return;
    reported.current = key;
    onChosen(chosen);
  }, [chosen, onChosen]);

  return (
    <section aria-label={translate(messages, 'refunds.targetLabel')} className={PANEL}>
      <p className="text-caption text-text-muted">{translate(messages, 'refunds.targetExplain')}</p>
      <WorkingBranchField messages={messages} testId="refunds-branch-target" />
    </section>
  );
}

type StateFilter = RefundRequestState | '';

function BranchRefunds({
  locale,
  messages,
  target,
  currentUserId,
  canReadCustomers,
  canSearchInvoices,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly target: RefundTarget;
  readonly currentUserId: string;
  readonly canReadCustomers: boolean;
  readonly canSearchInvoices: boolean;
}) {
  const [state, setState] = useState<StateFilter>('');
  const [customer, setCustomer] = useState<ChosenCustomer | null>(null);
  const [invoice, setInvoice] = useState<InvoiceListEntry | null>(null);
  const zone = useBranchClock(target.branchId);
  const narrowed = state !== '' || customer !== null || invoice !== null;

  const load = useCallback(
    async (request: TableRequest, cursor: string | null): Promise<ServerPage<RefundRequest>> => {
      const page = await listRefundRequests(
        target,
        {
          ...(state === '' ? {} : { state }),
          ...(customer === null ? {} : { partnerId: customer.id }),
          ...(invoice === null ? {} : { invoiceId: invoice.id }),
        },
        { cursor, limit: request.pageSize }
      );
      if (page.status !== 'ok') {
        return {
          status: page.status,
          rows: [],
          nextCursor: null,
          hasMore: false,
          correlationId: page.correlationId,
        };
      }
      return {
        status: 'ok',
        rows: page.data.items,
        nextCursor: page.data.nextCursor,
        hasMore: page.data.hasMore,
        correlationId: page.correlationId,
      };
    },
    [target, state, customer, invoice]
  );
  const table = useServerTable<RefundRequest>(load, {
    initial: INITIAL_REQUEST,
    loadKey: `${state}#${customer?.id ?? ''}#${invoice?.id ?? ''}`,
  });

  const columns = useMemo<readonly OperationalColumn<RefundRequest>[]>(
    () => [
      {
        id: 'reason',
        headerKey: 'refunds.column.reason',
        flex: 2,
        cell: (row) => (
          <span className="flex flex-col">
            <bdi>{row.reason}</bdi>
            <span className="text-caption text-text-muted">
              <RefundMoment value={row.requestedAt} locale={locale} zone={zone} />
              {row.requestedBy === currentUserId
                ? ` · ${translate(messages, 'refunds.history.byYou')}`
                : ''}
            </span>
          </span>
        ),
      },
      {
        id: 'invoice',
        headerKey: 'refunds.column.invoice',
        cell: (row) => (
          <bdi className="font-mono" dir="ltr">
            {row.invoiceNumber ?? translate(messages, 'refunds.invoiceNotShown')}
          </bdi>
        ),
      },
      {
        id: 'amount',
        headerKey: 'refunds.column.amount',
        numeric: true,
        cell: (row) => (
          <span className="font-mono" dir="ltr">
            {formatMoney(row.amount, locale)}
          </span>
        ),
      },
      {
        id: 'method',
        headerKey: 'refunds.column.method',
        // The approved method is on the invoice's refunds panel too (G8).
        hideBelow: 'md',
        cell: (row) => (
          <bdi>
            {row.paymentMethod?.displayName ?? translate(messages, 'refunds.methodNotShown')}
          </bdi>
        ),
      },
      {
        id: 'state',
        headerKey: 'refunds.column.state',
        flex: 1.2,
        cell: (row) => (
          <span className="flex flex-col">
            <span>{translateDynamic(messages, `refunds.state.${row.state}`)}</span>
            {row.payoutReference !== null ? (
              <bdi className="text-caption text-text-muted">{row.payoutReference}</bdi>
            ) : null}
          </span>
        ),
      },
    ],
    [currentUserId, locale, messages, zone]
  );

  // The invoice screen opens by its work order: a row links there for a reader of
  // invoices, and a counter-sale invoice, which has none, is named but not linked.
  const rowActions = useCallback(
    (row: RefundRequest): readonly RowAction[] =>
      canSearchInvoices && row.workOrderId !== null
        ? [
            {
              kind: 'link',
              label: translate(messages, 'refunds.openInvoice'),
              about: row.invoiceNumber ?? undefined,
              href: `/${locale}/invoices?workOrderId=${encodeURIComponent(row.workOrderId)}`,
            },
          ]
        : [],
    [canSearchInvoices, locale, messages]
  );

  const clearChoices = () => {
    setState('');
    setCustomer(null);
    setInvoice(null);
  };
  const empty =
    table.status === 'idle' && table.response !== null && table.response.rows.length === 0;

  return (
    <section aria-labelledby="refunds-heading" className={PANEL}>
      <h2 id="refunds-heading" className="text-body font-medium text-text-primary">
        {translate(messages, 'refunds.list.heading')}
      </h2>
      <FilterToolbar
        messages={messages}
        label={translate(messages, 'refunds.list.filtersLabel')}
        testId="refunds-toolbar"
        filters={[
          {
            kind: 'chips',
            key: 'state',
            label: translate(messages, 'refunds.list.status'),
            options: REFUND_REQUEST_STATES.map((value) => ({
              value,
              label: translateDynamic(messages, `refunds.state.${value}`),
            })),
            value: state,
            onChange: (next) => setState(next as StateFilter),
          },
        ]}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {canReadCustomers ? (
          <CustomerPicker
            messages={messages}
            locale={locale}
            label={translate(messages, 'refunds.list.customer')}
            value={customer}
            onChange={setCustomer}
            canSearch
            countsAsUnsaved={false}
            testId="refunds-customer-filter"
            material
          />
        ) : null}
        {canSearchInvoices ? (
          <InvoicePicker
            messages={messages}
            locale={locale}
            label={translate(messages, 'refunds.list.invoice')}
            target={target}
            value={invoice}
            onChange={setInvoice}
            canSearch
            testId="refunds-invoice-filter"
            material
          />
        ) : null}
      </div>
      <OperationalGrid<RefundRequest>
        messages={messages}
        locale={locale}
        label={translate(messages, 'refunds.list.caption')}
        columns={columns}
        rowId={(row) => row.id}
        table={table}
        rowActions={rowActions}
        suppressEmptyState
        stateDescriptions={{
          denied: 'refunds.list.refused',
          unavailable: 'refunds.list.unavailable',
          error: 'refunds.list.unavailable',
        }}
        testId="refunds-grid"
      />
      {empty && narrowed ? (
        // The choices narrowed the list to nothing: clearing them may widen it.
        <MuiEmptyState
          messages={messages}
          titleKey="state.noResults.title"
          descriptionKey="refunds.list.none"
          testId="refunds-no-matches"
          action={
            <Button type="button" variant="outlined" size="small" onClick={clearChoices}>
              {translate(messages, 'refunds.list.clearChoices')}
            </Button>
          }
        />
      ) : null}
      {empty && !narrowed ? (
        <MuiEmptyState
          messages={messages}
          titleKey="refunds.list.emptyTitle"
          descriptionKey="refunds.list.empty"
          testId="refunds-empty"
        />
      ) : null}
    </section>
  );
}
