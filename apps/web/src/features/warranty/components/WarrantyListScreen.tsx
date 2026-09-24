'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';

import { DataTable, type Column } from '@/components/data-table/DataTable';
import { SearchBox } from '@/components/search/SearchBox';
import { SearchStates } from '@/components/search/SearchStates';
import { SessionExpiredState } from '@/components/states/States';
import {
  RequiresConcreteBranch,
  WorkingBranchField,
} from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { BranchScope, CursorPage, ReadState } from '@/lib/api/read-operation';
import { useSearchRequest } from '@/lib/api/use-search-request';
import type { Locale } from '@/i18n/config';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import { formatDate } from '@/lib/format';

import { listWarranties } from '../warranty-api';
import {
  MAX_WARRANTY_SEARCH,
  MIN_WARRANTY_SEARCH,
  type WarrantyListCriteria,
  type WarrantyListRow,
} from '../warranty-contract';
import { Distance, SECONDARY_BUTTON, Section, WarrantyStatusLabel } from './shared';

/**
 * A branch's warranty records (P1-31, FE-008 entry point, FE-009 partial;
 * rebuilt under the Owner directive `P1-32-PRE-OD-UX`).
 *
 * ## The branch is no longer typed, and the list no longer waits
 *
 * This screen used to open on a sentence saying "choose a branch first", above a
 * form that asked the operator to PASTE two identifiers — a company reference
 * and a branch reference — whenever the branch directory read was refused them,
 * which is precisely the operator whose grant is not narrowed. Nothing was read
 * until they had done it.
 *
 * Both halves are gone. The branch is the working context's own named selection,
 * chosen once in the header, and there is exactly one place it can be changed;
 * and because there is no longer a value to validate, the list reads on arrival.
 * `branchId` also became OPTIONAL on `wty.warranty-list` with the same
 * directive, so "all my branches" is a request the backend documents rather
 * than a guess made here: the company is named, the branch is omitted, and the
 * API resolves the authorized set one branch at a time.
 *
 * ## One box, five things it can match
 *
 * `q` reaches part of a party's name on the originating visit, the tail of their
 * phone number, part of any plate the vehicle has carried, part of its VIN, or
 * part of the work-order number. It replaces the vehicle-reference box the
 * screen used to offer, which asked an operator to know a vehicle by a string
 * they could not read and would not have.
 *
 * The vehicle filter itself SURVIVES, because that is how a vehicle screen hands
 * over to one vehicle's warranty history — it arrives in the address, it is
 * shown as a filter in force with a control that lifts it, and the reference is
 * never printed at the operator.
 *
 * ## What this read still cannot say
 *
 * `wty.warranty-list` publishes no vehicle display number, plate or VIN on a
 * row, so the vehicle column is a bare reference. That is recorded as a backend
 * prerequisite rather than papered over: resolving a name here would mean a read
 * per row, and inventing one is not available.
 *
 * ## A refusal is never drawn as an empty branch
 *
 * The whole outcome is kept, not flattened into rows, so "you may not see these"
 * and "this branch has issued none" stay two different sentences with two
 * different next steps.
 *
 * ## The end of the set is the server's to declare
 *
 * `hasMore` and `nextCursor` come from the response; nothing here infers the end
 * from a short page and no total is requested or invented.
 */

/** What the read is asked for: the scope it is addressed to, and the filters. */
interface Asked {
  readonly scope: BranchScope;
  readonly filters: WarrantyListCriteria;
}

export function WarrantyListScreen({
  locale,
  messages,
  initialVehicleId,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** From the address, when the screen was reached from a vehicle. Filters on arrival. */
  readonly initialVehicleId: string | null;
}) {
  const context = useWorkingContext();
  const branch = useBranchTarget();

  const [vehicleId, setVehicleId] = useState<string | null>(initialVehicleId);
  const [term, setTerm] = useState('');

  /*
   * The scope, or the reason there is none.
   *
   * "All my branches" spanning MORE THAN ONE COMPANY resolves to no company at
   * all — `companyId` is mandatory on this operation and there is no honest
   * single answer — so the screen says so rather than picking one.
   */
  const scope: BranchScope | null =
    branch.kind === 'ready'
      ? { companyId: branch.target.companyId, branchId: branch.target.branchId }
      : branch.kind === 'all' && context.selection?.companyId
        ? { companyId: context.selection.companyId, branchId: null }
        : null;

  const trimmed = term.trim();
  const termIsSearchable = trimmed.length >= MIN_WARRANTY_SEARCH;
  const termTooShort = trimmed.length > 0 && !termIsSearchable;

  /*
   * Built inline on every render: `useSearchRequest` keys on the SERIALISED
   * criteria rather than on the object's identity, so memoising buys nothing.
   * `null` is "there is nothing to ask for yet", and the hook makes no request
   * at all in that state.
   */
  const asked: Asked | null =
    scope === null
      ? null
      : {
          scope,
          filters: {
            ...(vehicleId === null ? {} : { vehicleId }),
            ...(termIsSearchable ? { q: trimmed } : {}),
          },
        };

  const load = useCallback(
    async (
      criteria: Asked,
      cursor: string | null
    ): Promise<ReadState<CursorPage<WarrantyListRow>>> => {
      const state = await listWarranties(criteria.scope, criteria.filters, cursor);
      if (state.status !== 'ok')
        return { status: state.status, correlationId: state.correlationId };
      return {
        status: 'ok',
        data: { items: state.rows, nextCursor: state.nextCursor, hasMore: state.hasMore },
        correlationId: state.correlationId,
      };
    },
    []
  );

  const search = useSearchRequest<WarrantyListRow, Asked>({
    criteria: asked,
    load,
    version: context.version,
  });

  const clearFilters = () => {
    setVehicleId(null);
    setTerm('');
  };

  const columns = useMemo<readonly Column<WarrantyListRow>[]>(
    () => [
      {
        id: 'policy',
        headerKey: 'warranty.list.columnPolicy',
        cell: (row) => (
          <Link
            href={`/${locale}/warranty/${row.id}`}
            className="text-primary underline-offset-2 hover:underline"
          >
            <bdi>{row.policy.name}</bdi>
          </Link>
        ),
      },
      {
        id: 'status',
        headerKey: 'warranty.list.columnStatus',
        cell: (row) => <WarrantyStatusLabel messages={messages} status={row.status} />,
      },
      {
        id: 'branch',
        headerKey: 'warranty.list.columnBranch',
        // Rendered only while the list spans branches. The name, never the
        // identifier: a reference here would be a second thing to look up.
        cell: (row) => <bdi>{context.branchName(row.branchId) ?? ''}</bdi>,
      },
      {
        id: 'start',
        headerKey: 'warranty.list.columnStart',
        cell: (row) => formatDate(row.startDate, locale),
      },
      {
        id: 'expiry',
        headerKey: 'warranty.list.columnExpiry',
        cell: (row) => formatDate(row.expiryDate, locale),
      },
      {
        id: 'odometerLimit',
        headerKey: 'warranty.list.columnOdometerLimit',
        cell: (row) =>
          row.odometerLimit === null ? (
            translate(messages, 'warranty.summary.noDistanceLimit')
          ) : (
            <Distance value={row.odometerLimit} />
          ),
      },
      {
        id: 'vehicle',
        headerKey: 'warranty.list.columnVehicle',
        cell: (row) => (
          /*
           * A bare reference, because this read publishes no plate, chassis
           * number or display number for the vehicle. Showing what there is and
           * recording the gap beats leaving the column blank or resolving a name
           * with one read per row — see the docblock.
           */
          <code className="font-mono text-caption" dir="ltr">
            {row.vehicleId}
          </code>
        ),
      },
    ],
    [context, locale, messages]
  );

  const blocked =
    branch.kind === 'unchosen' || branch.kind === 'none' || branch.kind === 'unavailable';
  const spansCompanies = branch.kind === 'all' && scope === null;
  const spansBranches = branch.kind === 'all';

  return (
    <div className="flex flex-col gap-6">
      {/*
       * The way to the plan administration screen, offered to everyone who can
       * read a warranty. It is NOT gated on `wty.policy.manage` here: the plan
       * list and the plan read both answer the read code, so a clerk may look at
       * the terms they issue under, and it is that screen which withholds the
       * controls that change them.
       */}
      <p className="text-body">
        <Link
          href={`/${locale}/warranty/policies`}
          className="text-primary underline-offset-2 hover:underline"
        >
          {translate(messages, 'warranty.list.openPolicies')}
        </Link>
      </p>

      <Section
        headingId="warranty-filter-heading"
        titleKey="warranty.filter.heading"
        messages={messages}
        description={translate(messages, 'warranty.filter.explain')}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {/*
            The branch is STATED, not asked. A second editable control here would
            be a second authority for the same fact.
          */}
          <WorkingBranchField messages={messages} testId="warranty-branch-target" />
          <div className="sm:col-span-2">
            <SearchBox
              messages={messages}
              label={translate(messages, 'warranty.filter.searchLabel')}
              placeholder={translate(messages, 'warranty.filter.searchPlaceholder')}
              example={translate(messages, 'warranty.filter.searchExample')}
              value={term}
              onChange={setTerm}
              onSubmit={search.submit}
              busy={search.phase === 'loading'}
              maxLength={MAX_WARRANTY_SEARCH}
              {...(termTooShort
                ? { error: translate(messages, 'warranty.filter.searchTooShort') }
                : {})}
            />
          </div>
        </div>

        {vehicleId === null ? null : (
          // The filter that arrived with the address, said in words rather than
          // printed as the reference it is, with the way out beside it.
          <p
            role="status"
            data-testid="warranty-vehicle-filter"
            className="mt-3 flex flex-wrap items-center gap-3 rounded-md bg-surface-subtle px-3 py-2 text-supporting text-text-secondary"
          >
            {translate(messages, 'warranty.filter.oneVehicleOnly')}
            <button type="button" className={SECONDARY_BUTTON} onClick={() => setVehicleId(null)}>
              {translate(messages, 'warranty.filter.showAllVehicles')}
            </button>
          </p>
        )}
      </Section>

      {blocked ? (
        <RequiresConcreteBranch messages={messages} state={branch} testId="warranty-list-blocked" />
      ) : spansCompanies ? (
        <p
          role="status"
          data-testid="warranty-list-spans-companies"
          className="rounded-md bg-warning-subtle px-3 py-2 text-supporting text-text-secondary"
        >
          {translate(messages, 'workingContext.spansCompanies')}
        </p>
      ) : (
        <Section
          headingId="warranty-results-heading"
          titleKey="warranty.list.heading"
          messages={messages}
        >
          {/*
            An ended session, said as itself. `SearchPhase` collapses it into
            `failed` and `SearchStates` renders that arm with a Try again control
            — a button that cannot work for somebody whose session has ended. The
            finer `table.status` still distinguishes the two. A shared `expired`
            arm would be the better home for this; `components/search` is owned
            elsewhere and is left untouched.
          */}
          {search.table.status === 'expired' ? (
            <SessionExpiredState messages={messages} />
          ) : (
            <SearchStates
              messages={messages}
              phase={search.phase}
              correlationId={search.correlationId}
              {...(search.phase === 'empty' && (termIsSearchable || vehicleId !== null)
                ? {
                    onClearFilters: (
                      <button type="button" className={SECONDARY_BUTTON} onClick={clearFilters}>
                        {translate(messages, 'warranty.filter.clearFilters')}
                      </button>
                    ),
                  }
                : {})}
              {...(search.phase === 'unavailable' || search.phase === 'failed'
                ? {
                    retry: (
                      <button type="button" className={SECONDARY_BUTTON} onClick={search.submit}>
                        {translate(messages, 'state.retry')}
                      </button>
                    ),
                  }
                : {})}
            />
          )}

          {search.phase === 'ready' ? (
            <DataTable<WarrantyListRow>
              messages={messages}
              columns={columns}
              rowId={(row) => row.id}
              request={search.table.request}
              response={search.table.response}
              status={search.table.status}
              onRequestChange={search.table.setRequest}
              onRetry={search.table.refresh}
              correlationId={search.table.correlationId}
              caption={translate(messages, 'warranty.list.tableCaption')}
              hiddenColumnIds={spansBranches ? [] : ['branch']}
              /*
               * The filters live outside `TableRequest`, so the table's own
               * empty state would claim something about the whole branch on the
               * evidence of one filter. `SearchStates` says it instead.
               */
              suppressEmptyState
            />
          ) : null}
        </Section>
      )}
    </div>
  );
}
