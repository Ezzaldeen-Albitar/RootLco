'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { DataTable, type Column } from '@/components/data-table/DataTable';
import { INITIAL_REQUEST, type TableRequest } from '@/components/data-table/table-state';
import { useServerTable } from '@/components/data-table/use-server-table';
import {
  RequiresConcreteBranch,
  WorkingBranchField,
} from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { BranchTarget } from '@/lib/api/read-operation';
import { formatDate } from '@/lib/format';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate, translateDynamic } from '@/i18n/get-messages';
import { BlockerLabel, StatusLabel } from './CodeLabel';
import { listDeliveryReadiness } from '../readiness-api';
import { MAX_READINESS_PAGE_SIZE, type DeliveryReadinessRow } from '../readiness-contract';

/**
 * The ready-for-delivery queue (P1-31, FE-001, Owner decision **D-3**).
 *
 * The work orders of one branch that are finished, each with the checks that
 * decide whether its vehicle may be handed over — including the ones that have
 * no handover record at all, which is the population the handover list cannot
 * contain by construction and is exactly what a service adviser needs at the
 * counter.
 *
 * ## Readiness is never worked out here
 *
 * The row carries the verdict, the reasons and the provenance of every check.
 * This component renders those three fields and derives none of them from the
 * others. In particular it does **not** treat "no reasons" as "ready": the
 * backend says in terms that a work order already handed over raises no reason
 * on this surface, because the reasons bound to a handover record are outside
 * the four this queue reports. A screen that inferred readiness from an empty
 * list would offer a vehicle that has already left.
 *
 * There is also no "ready only" control, because the operation publishes no such
 * parameter — a request that could ask for the ready ones could ask for their
 * opposite, and the verdict would start to look like something a request can
 * influence.
 *
 * ## A check that could not be READ is not a check that FAILED
 *
 * Each reason carries whether its check could be established. An unestablished
 * one still holds the vehicle back — that is the fail-closed default — but it
 * means "this could not be read", which is a cue to raise a platform problem
 * rather than to chase the customer. The two are drawn differently on purpose;
 * collapsing them turns an outage into a customer conversation.
 *
 * ## It reads on arrival, for the branch the operator is working in
 *
 * The queue used to open on two selects and a Show button, above a sentence
 * saying nothing was loaded. The branch is the working context's own named
 * selection now — chosen once, in the header — so there is nothing left to
 * validate before asking, and a service adviser who opens the ready-for-delivery
 * queue has expressed intent by opening it.
 *
 * The pair is still the authorization TARGET rather than a convenience: without
 * it the backend's check degrades to a scope-blind permission test. This
 * operation makes both halves mandatory, unlike the boards whose branch became
 * optional, so "all my branches" is refused here in the shared words and the
 * header is named as the one control that answers.
 *
 * ## No action is offered here
 *
 * Starting a handover belongs to the work order's own handover panel, which owns
 * the write and its authority. This queue links to the work order and to the
 * handover record; it offers no button that would create one, because an
 * affordance rendered from a read this screen cannot enforce is how a dead
 * control gets in.
 *
 * ## `state` renders as its own code, deliberately
 *
 * The work-order state catalogue is extensible by the workshop, so a translation
 * table keyed on a code the workshop owns would be a second, rotting copy of
 * their configuration and an unrecognised code would render as its own key. The
 * work-order board takes the same position for the same reason.
 */

interface Submitted {
  readonly target: BranchTarget;
}

export function DeliveryReadinessScreen({
  locale,
  messages,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();

  return (
    <div className="flex min-h-0 flex-col gap-4">
      <div className="rounded-lg border border-border bg-surface p-4">
        {/*
          The branch is STATED, not asked. It is the header's own selection and
          there is exactly one place it can be changed; a second control here
          would be a second authority for the same fact.
        */}
        <WorkingBranchField messages={messages} testId="delivery-queue-branch" />
      </div>

      {branch.kind === 'ready' ? (
        /*
         * Keyed on the branch AND the working-context version, so a branch
         * changed in the header throws the previous branch's cursor stack away
         * with its rows rather than paging one branch's queue under another
         * branch's name.
         */
        <ReadinessResults
          key={`${context.version}:${branch.target.branchId}`}
          locale={locale}
          messages={messages}
          submitted={{ target: branch.target }}
        />
      ) : (
        <RequiresConcreteBranch
          messages={messages}
          state={branch}
          testId="delivery-queue-blocked"
        />
      )}
    </div>
  );
}

function ReadinessResults({
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
      listDeliveryReadiness({
        companyId: submitted.target.companyId,
        branchId: submitted.target.branchId,
        cursor,
        limit: request.pageSize,
      }),
    [submitted]
  );
  const table = useServerTable<DeliveryReadinessRow>(load, { initial: INITIAL_REQUEST });

  const columns = useMemo<readonly Column<DeliveryReadinessRow>[]>(
    () => [
      {
        id: 'workOrder',
        headerKey: 'delivery.queue.column.workOrder',
        cell: (row) => (
          <Link
            href={`/${locale}/work-orders/${row.workOrder.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            {row.workOrder.displayNumber ? (
              <code className="font-mono text-caption" dir="ltr">
                {row.workOrder.displayNumber}
              </code>
            ) : (
              // Never the internal identifier: a reference slot showing one
              // reads as the work order's number.
              translate(messages, 'delivery.queue.column.noReference')
            )}
          </Link>
        ),
      },
      {
        id: 'vehicle',
        headerKey: 'delivery.queue.column.vehicle',
        cell: (row) =>
          row.workOrder.vehicle.registrationPlate || row.workOrder.vehicle.makeModel ? (
            <span className="flex flex-col">
              {row.workOrder.vehicle.registrationPlate ? (
                <code className="font-mono text-caption" dir="ltr">
                  {row.workOrder.vehicle.registrationPlate}
                </code>
              ) : null}
              {row.workOrder.vehicle.makeModel ? (
                <bdi>{row.workOrder.vehicle.makeModel}</bdi>
              ) : null}
            </span>
          ) : (
            <span className="text-text-muted">
              {translate(messages, 'delivery.queue.column.noVehicleDetail')}
            </span>
          ),
      },
      {
        id: 'customer',
        headerKey: 'delivery.queue.column.customer',
        cell: (row) =>
          row.workOrder.customer === null ? (
            // A real and permitted state, not a fault: the visit named no
            // service requester.
            <span className="text-text-muted">
              {translate(messages, 'delivery.queue.column.noCustomer')}
            </span>
          ) : (
            <span className="flex flex-col">
              <bdi>{row.workOrder.customer.displayName}</bdi>
              <span className="text-caption text-text-muted">
                {/*
                 * `receptions.partyRole.*`, the same frozen vocabulary the
                 * reception and work-order screens render. A second set of
                 * translations for the same codes would be free to drift.
                 */}
                {translateDynamic(
                  messages,
                  `receptions.partyRole.${row.workOrder.customer.relationshipRole}`
                )}
                {row.workOrder.customer.hasAdditionalParties
                  ? ` · ${translate(messages, 'delivery.queue.column.moreParties')}`
                  : ''}
              </span>
            </span>
          ),
      },
      {
        id: 'opened',
        headerKey: 'delivery.queue.column.opened',
        cell: (row) => <bdi>{formatDate(row.workOrder.openedAt, locale)}</bdi>,
      },
      {
        id: 'state',
        headerKey: 'delivery.queue.column.state',
        // The workshop's own catalogue code, rendered as a code. See the docblock.
        cell: (row) => (
          <code className="font-mono text-caption" dir="ltr">
            {row.workOrder.state}
          </code>
        ),
      },
      {
        id: 'readiness',
        headerKey: 'delivery.queue.column.readiness',
        cell: (row) => <ReadinessCell messages={messages} row={row} />,
      },
      {
        id: 'handover',
        headerKey: 'delivery.queue.column.handover',
        cell: (row) =>
          row.delivery === null ? (
            <span className="text-text-muted">
              {translate(messages, 'delivery.queue.noHandover')}
            </span>
          ) : (
            <span className="flex flex-col">
              <span>
                <StatusLabel messages={messages} status={row.delivery.status} />
              </span>
              <Link
                href={`/${locale}/delivery/${row.delivery.id}`}
                className="text-caption text-primary underline-offset-2 hover:underline"
              >
                {translate(messages, 'delivery.queue.openHandover')}
              </Link>
            </span>
          ),
      },
    ],
    [locale, messages]
  );

  // Said out loud rather than applied silently: the table offers a page size
  // above what this queue serves, and the request carries the smaller number.
  const capped = table.request.pageSize > MAX_READINESS_PAGE_SIZE;

  return (
    <section aria-labelledby="delivery-readiness-heading" className="flex min-h-0 flex-col gap-2">
      <h2 id="delivery-readiness-heading" className="sr-only">
        {translate(messages, 'delivery.queue.resultsHeading')}
      </h2>
      <DataTable<DeliveryReadinessRow>
        messages={messages}
        columns={columns}
        rowId={(row) => row.workOrder.id}
        request={table.request}
        response={table.response}
        status={table.status}
        onRequestChange={table.setRequest}
        onRetry={table.refresh}
        correlationId={table.correlationId}
        caption={translate(messages, 'delivery.queue.caption')}
        /*
         * The branch lives OUTSIDE `TableRequest` — it is an authorization
         * target, not a filter an operator applied — so `isNarrowed` is
         * permanently false and the table's own empty state would make a claim
         * about the whole branch. The screen states the true sentence below.
         */
        suppressEmptyState
      />
      {table.response && table.response.rows.length === 0 ? (
        <p className="py-6 text-center text-body text-text-secondary" lang={locale}>
          {translate(messages, 'delivery.queue.noneMatching')}
        </p>
      ) : null}
      {capped ? (
        <p className="px-2 text-caption text-text-secondary" lang={locale}>
          {translate(messages, 'delivery.queue.pageSizeCapped')}
        </p>
      ) : null}
      <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'delivery.queue.orderingNote')}
      </p>
      <p className="px-2 pb-2 text-caption text-text-muted" lang={locale}>
        {translate(messages, 'delivery.queue.reasonsExplain')}
      </p>
    </section>
  );
}

/**
 * The server's verdict for one row, and every reason behind it.
 *
 * Three cases, because there are three. A row that is ready. A row held back by
 * named reasons. And a row that is not ready with NO reason named — which the
 * backend produces for a vehicle that has already been handed over, since the
 * reason for that is bound to the handover record and is outside this surface's
 * four. The third case is stated rather than inferred: this component does not
 * decide why, it says that the queue reported no outstanding check and points at
 * the column that shows how far the vehicle has already got.
 */
function ReadinessCell({
  messages,
  row,
}: {
  readonly messages: Messages;
  readonly row: DeliveryReadinessRow;
}) {
  if (row.readyToStartDelivery !== true && row.readyToStartDelivery !== false) {
    return (
      <span className="text-body text-text-secondary">
        {translate(messages, 'delivery.queue.unknown')}
      </span>
    );
  }
  if (row.readyToStartDelivery === true) {
    return (
      <span className="text-body font-medium text-success">
        {translate(messages, 'delivery.queue.ready')}
      </span>
    );
  }

  if (row.blockers.length === 0) {
    return (
      <span className="flex flex-col gap-1">
        <span className="text-body font-medium text-text-primary">
          {translate(messages, 'delivery.queue.notReady')}
        </span>
        <span className="text-caption text-text-secondary">
          {translate(messages, 'delivery.queue.notReadyNoReasons')}
        </span>
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-1">
      <span className="text-body font-medium text-text-primary">
        {translate(messages, 'delivery.queue.notReady')}
      </span>
      <ul className="flex flex-col gap-1">
        {row.blockers.map((code) => {
          const fact = row.facts.find((candidate) => candidate.blocker === code);
          return (
            <li key={code} className="text-caption text-text-secondary">
              <BlockerLabel messages={messages} code={code} />
              {fact && !fact.established ? (
                // Not "this failed" — "this could not be read". The fail-closed
                // default still holds the vehicle back, but the operator is being
                // told to raise a platform problem, not to chase the customer.
                <span className="text-text-muted">
                  {' · '}
                  {translate(messages, 'delivery.queue.reasonUnreadable')}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </span>
  );
}
