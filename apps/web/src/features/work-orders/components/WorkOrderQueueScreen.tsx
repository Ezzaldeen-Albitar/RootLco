'use client';

import { useCallback, useMemo, useState } from 'react';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import { SelectField, TextField } from '@/components/forms/Field';
import { EmptyState } from '@/components/states/States';
import type { BranchTarget } from '@/lib/api/read-operation';
import { formatDateTime } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { listWorkOrders } from '../api';
import {
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
  readonly companyId: string;
  readonly branchId: string;
  readonly kind: '' | WorkOrderKind;
  readonly state: string;
}

export function WorkOrderQueueScreen({
  locale,
  messages,
  companyIds,
  branchIds,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** The session's resolved scope — server-resolved, never asserted back. */
  readonly companyIds: readonly string[];
  readonly branchIds: readonly string[];
}) {
  const [draft, setDraft] = useState<Draft>({
    companyId: companyIds.length === 1 ? (companyIds[0] ?? '') : '',
    branchId: branchIds.length === 1 ? (branchIds[0] ?? '') : '',
    kind: '',
    state: '',
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
    const found: Record<string, string> = {};
    if (draft.companyId.trim().length === 0) found['companyId'] = 'field.required';
    if (draft.branchId.trim().length === 0) found['branchId'] = 'field.required';
    // The backend regex for a state code. Checked here so a typo is a field
    // message rather than a 422 the operator has to interpret — and NOT to
    // decide which codes exist, which is the tenant's catalogue to answer.
    if (draft.state.trim().length > 0 && !/^[a-z][a-z0-9_]{1,62}$/.test(draft.state.trim())) {
      found['state'] = 'workOrders.queue.stateFormat';
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    const criteria: WorkOrderListCriteria = {
      ...(draft.kind ? { kind: draft.kind } : {}),
      ...(draft.state.trim() ? { state: draft.state.trim() } : {}),
    };
    setSubmitted({
      target: { companyId: draft.companyId.trim(), branchId: draft.branchId.trim() },
      criteria,
    });
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
          <ScopeField
            messages={messages}
            label={translate(messages, 'workOrders.queue.company')}
            ids={companyIds}
            value={draft.companyId}
            onChange={(next) => setDraft((d) => ({ ...d, companyId: next }))}
            error={errorFor('companyId')}
          />
          <ScopeField
            messages={messages}
            label={translate(messages, 'workOrders.queue.branch')}
            ids={branchIds}
            value={draft.branchId}
            onChange={(next) => setDraft((d) => ({ ...d, branchId: next }))}
            error={errorFor('branchId')}
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
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="rounded-md bg-primary px-4 py-2 text-body font-medium text-on-primary transition-colors duration-fast ease-standard hover:bg-primary-hover"
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
        // table on a new target or filter rather than paging the old one.
        <QueueResults
          key={JSON.stringify(submitted)}
          locale={locale}
          messages={messages}
          submitted={submitted}
        />
      )}
    </div>
  );
}

/**
 * One scope identifier: a select over the session's resolved ids, or a plain
 * identifier input when the session is UNRESTRICTED (an empty array means
 * "everything in the workspace", and the platform publishes no company/branch
 * directory this screen could turn into names).
 */
function ScopeField({
  messages,
  label,
  ids,
  value,
  onChange,
  error,
}: {
  readonly messages: Messages;
  readonly label: string;
  readonly ids: readonly string[];
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly error?: string | undefined;
}) {
  if (ids.length > 0) {
    return (
      <SelectField
        label={label}
        description={translate(messages, 'admin.contractGap.noDirectory')}
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
        options={ids.map((id) => ({ value: id, label: id }))}
        placeholder={translate(messages, 'form.select.placeholder')}
        error={error}
      />
    );
  }
  return (
    <TextField
      label={label}
      description={translate(messages, 'workOrders.queue.scopeUnrestricted')}
      required
      spellCheck={false}
      dir="ltr"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      error={error}
    />
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
