'use client';

import { useCallback, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { DigitsEcho } from '@/components/forms/DigitsEcho';
import { SelectField, TextField } from '@/components/forms/Field';
import { EmptyState } from '@/components/states/States';
import { WorkingBranchField } from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { BranchTarget } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listWorkOrders } from '../api';
import {
  MAX_WORK_ORDER_SEARCH,
  MIN_WORK_ORDER_SEARCH,
  WORK_ORDER_KINDS,
  type WorkOrderKind,
  type WorkOrderListCriteria,
  type WorkOrderListEntry,
} from '../work-orders-contract';

/**
 * The branch work-order board and history (P1-29, `W1`) — `wo.work-order-list`
 * rendered as what the workshop currently holds open, newest first.
 *
 * ## Nothing is requested until an operator names a branch
 *
 * `companyId` and `branchId` are REQUIRED by the operation because they are the
 * authorization TARGET, not a convenience: without them the backend's check
 * degrades to a scope-blind permission test and an operator with a grant in a
 * second branch would be shown that branch's board. So the results are a
 * separately MOUNTED component — before a target is submitted, the component
 * that would issue the read does not exist. "No request before intent" is
 * structural here rather than a flag somebody can forget.
 *
 * ## Number and free text narrow the board, never widen it (P1-32)
 *
 * `number` is an exact work-order number and `q` one box over the number, the
 * party names, any plate and the VIN. Company and branch stay required beside
 * them. The terms live in screen state, never in the address bar
 * (`P1-27-SEC-002`), and Arabic-Indic digits are echoed for reading only — the
 * value is sent as typed and the backend folds it.
 *
 * ## No total, and truncation says so
 *
 * The operation publishes `hasMore` and `nextCursor` and no count. This renders
 * exactly that: "Next" is offered only while the server says more exists, and no
 * page count is invented. The ordering is fixed — most recently opened first —
 * and is stated in a note rather than implied by a clickable header the
 * operation would not honour.
 *
 * ## `state` renders as its own code, deliberately
 *
 * `wo.work_order_states` is tenant-extensible. A translation table keyed on a
 * code the tenant owns would be a second, rotting copy of their configuration,
 * and an unrecognised code would render as the key itself. `kind` is a closed
 * two-value vocabulary and IS translated.
 *
 * ## The customer column can be legitimately empty
 *
 * `customer` is null when the reception visit named no service requester, which
 * the platform permits. The absence renders as an absence. The role travels
 * beside the name because `vehicle_owner` may be a different person, and a name
 * without its role claims something the data does not say.
 *
 * A CLOSED work order reports the customer of its own visit, not the vehicle's
 * current owner. That is intended, and the note under the table says so, because
 * it will otherwise read as a defect to anyone who expects the latter.
 */

interface Submitted {
  readonly target: BranchTarget;
  readonly criteria: WorkOrderListCriteria;
}

interface Draft {
  readonly kind: '' | WorkOrderKind;
  readonly state: string;
  readonly number: string;
  readonly q: string;
}

export function WorkOrderQueueScreen({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /**
   * The session's bare references. Accepted so the page did not have to change,
   * and no longer read: the branch is the working context's named selection.
   */
  readonly companyIds?: readonly string[];
  readonly branchIds?: readonly string[];
}) {
  const branch = useBranchTarget();
  const { version } = useWorkingContext();
  const [draft, setDraft] = useState<Draft>({
    kind: '',
    state: '',
    number: '',
    q: '',
  });
  const [submitted, setSubmitted] = useState<Submitted | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});

  const kindOptions = useMemo(
    () =>
      WORK_ORDER_KINDS.map((kind) => ({
        value: kind,
        label: translateDynamic(messages, `workOrders.kind.${kind}`),
      })),
    [messages]
  );

  const submit = () => {
    // The branch is the header's own named selection or it is nothing, and the
    // button is disabled while it is nothing — there is no local pair left to
    // validate. Everything below is still this screen's own filter checking.
    if (branch.kind !== 'ready') return;
    const found: Record<string, string> = {};
    // The backend regex for a state code. Checked here so a typo is a field
    // message rather than a 422 the operator has to interpret — and NOT to
    // decide which codes exist, which is the tenant's catalogue to answer.
    if (draft.state.trim().length > 0 && !/^[a-z][a-z0-9_]{1,62}$/.test(draft.state.trim())) {
      found['state'] = 'workOrders.queue.stateFormat';
    }
    const q = draft.q.trim();
    // The backend refuses a one-character free-text value.
    if (q.length > 0 && q.length < MIN_WORK_ORDER_SEARCH) {
      found['q'] = 'workOrders.queue.searchTooShort';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const number = draft.number.trim();
    const criteria: WorkOrderListCriteria = {
      ...(draft.kind ? { kind: draft.kind } : {}),
      ...(draft.state.trim() ? { state: draft.state.trim() } : {}),
      // Sent as typed (trimmed). The backend folds Arabic-Indic digits.
      ...(number ? { number } : {}),
      ...(q ? { q } : {}),
    };
    setSubmitted({ target: branch.target, criteria });
  };

  const errorFor = (name: string): string | undefined => {
    const key = errors[name];
    return key ? translateDynamic(messages, key) : undefined;
  };

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        noValidate
        aria-label={translate(messages, 'workOrders.queue.formLabel')}
        className="rounded-lg border border-border bg-surface p-4"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <WorkingBranchField
            messages={messages}
            label={translate(messages, 'workOrders.queue.branch')}
          />
          <SelectField
            label={translate(messages, 'workOrders.queue.kindFilter')}
            value={draft.kind}
            onChange={(event) =>
              setDraft((d) => ({ ...d, kind: event.target.value as Draft['kind'] }))
            }
            options={kindOptions}
            placeholder={translate(messages, 'workOrders.queue.anyKind')}
          />
          <TextField
            label={translate(messages, 'workOrders.queue.stateFilter')}
            description={translate(messages, 'workOrders.queue.stateFilterHelp')}
            spellCheck={false}
            dir="ltr"
            value={draft.state}
            onChange={(event) => setDraft((d) => ({ ...d, state: event.target.value }))}
            error={errorFor('state')}
          />
          <div className="flex flex-col gap-1">
            <TextField
              label={translate(messages, 'workOrders.queue.numberFilter')}
              description={translate(messages, 'workOrders.queue.numberFilterHelp')}
              spellCheck={false}
              dir="ltr"
              maxLength={MAX_WORK_ORDER_SEARCH}
              value={draft.number}
              onChange={(event) => setDraft((d) => ({ ...d, number: event.target.value }))}
            />
            <DigitsEcho messages={messages} value={draft.number} />
          </div>
          <div className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3">
            <TextField
              label={translate(messages, 'workOrders.queue.searchFilter')}
              description={translate(messages, 'workOrders.queue.searchFilterHelp')}
              spellCheck={false}
              dir="auto"
              maxLength={MAX_WORK_ORDER_SEARCH}
              value={draft.q}
              onChange={(event) => setDraft((d) => ({ ...d, q: event.target.value }))}
              error={errorFor('q')}
            />
            <DigitsEcho messages={messages} value={draft.q} />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={branch.kind !== 'ready'}
            className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {translate(messages, 'workOrders.queue.show')}
          </button>
        </div>
      </form>

      {submitted === null ? (
        <EmptyState
          messages={messages}
          titleKey="workOrders.queue.idleTitle"
          descriptionKey="workOrders.queue.idleBody"
        />
      ) : (
        // Mounted only after submission — see the docblock. The key restarts the
        // table on a new target or filter rather than paging the old one, and
        // carries the working-context version so a branch change cannot leave
        // the previous branch's rows on screen under the new heading.
        <QueueResults
          key={`${version}:${JSON.stringify(submitted)}`}
          locale={locale}
          messages={messages}
          submitted={submitted}
        />
      )}
    </div>
  );
}

function QueueResults({
  locale,
  messages,
  submitted,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly submitted: Submitted;
}) {
  const load = useCallback(
    (request: TableRequest, cursor: string | null) =>
      listWorkOrders(submitted.target, submitted.criteria, request, cursor),
    [submitted]
  );
  const table = useServerTable<WorkOrderListEntry>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<WorkOrderListEntry>[]>(
    () => [
      {
        id: 'displayNumber',
        headerKey: 'workOrders.queue.column.reference',
        cell: (row) =>
          row.displayNumber ? (
            <code className="font-mono text-caption" dir="ltr">
              {row.displayNumber}
            </code>
          ) : (
            // Never the internal identifier: a reference slot showing one reads
            // as the work order's number.
            <span className="text-text-muted">
              {translate(messages, 'workOrders.queue.column.noReference')}
            </span>
          ),
      },
      {
        id: 'state',
        headerKey: 'workOrders.queue.column.state',
        // The tenant's own catalogue code, rendered as a code. See the docblock.
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.state}
          </code>
        ),
      },
      {
        id: 'kind',
        headerKey: 'workOrders.queue.column.kind',
        cell: (row) => translateDynamic(messages, `workOrders.kind.${row.kind}`),
      },
      {
        id: 'vehicle',
        headerKey: 'workOrders.queue.column.vehicle',
        cell: (row) =>
          row.vehicle.registrationPlate || row.vehicle.makeModel ? (
            <span className="flex flex-col">
              {row.vehicle.registrationPlate ? (
                <code className="font-mono text-caption" dir="ltr">
                  {row.vehicle.registrationPlate}
                </code>
              ) : null}
              {row.vehicle.makeModel ? <bdi>{row.vehicle.makeModel}</bdi> : null}
            </span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'workOrders.queue.column.noVehicleDetail')}
            </span>
          ),
      },
      {
        id: 'customer',
        headerKey: 'workOrders.queue.column.customer',
        cell: (row) =>
          row.customer === null ? (
            // A real and permitted state, not a fault: the visit named no
            // service requester.
            <span className="text-text-muted">
              {translate(messages, 'workOrders.queue.column.noCustomer')}
            </span>
          ) : (
            <span className="flex flex-col">
              <bdi>{row.customer.displayName}</bdi>
              <span className="text-caption text-text-muted">
                {/*
                 * `receptions.partyRole.*`, not a `workOrders.*` copy of it.
                 * The role IS the reception party role — the same frozen
                 * seven-value vocabulary — surfaced on the work order that
                 * visit produced. Message keys are global, so a second set of
                 * translations for the same seven codes would be fourteen
                 * strings across two locales, free to drift from the ones the
                 * reception screens already render.
                 */}
                {translateDynamic(
                  messages,
                  `receptions.partyRole.${row.customer.relationshipRole}`
                )}
                {row.customer.hasAdditionalParties
                  ? ` · ${translate(messages, 'workOrders.queue.column.moreParties')}`
                  : ''}
              </span>
            </span>
          ),
      },
      {
        id: 'openedAt',
        headerKey: 'workOrders.queue.column.opened',
        cell: (row) => <bdi>{formatDateTime(row.openedAt, locale)}</bdi>,
      },
    ],
    [locale, messages]
  );

  return (
    <section aria-labelledby="work-order-queue-heading" className="flex min-h-0 flex-col gap-2">
      <h2 id="work-order-queue-heading" className="sr-only">
        {translate(messages, 'workOrders.queue.resultsHeading')}
      </h2>
      <DataTable<WorkOrderListEntry>
        messages={messages}
        columns={columns}
        rowId={(row) => row.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'workOrders.queue.caption')}
        /*
         * The criteria live OUTSIDE `TableRequest` (deliberately: nothing here
         * may reach the address bar), so `isNarrowed` is permanently false and
         * the table's own empty state would make a claim about the whole branch
         * on the evidence of one filter. The screen states the true sentence
         * below instead.
         */
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'workOrders.queue.noneMatching')}
        </p>
      ) : null}
      <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'workOrders.queue.orderingNote')}
      </p>
    </section>
  );
}
