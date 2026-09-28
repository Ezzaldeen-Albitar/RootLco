'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import Button from '@mui/material/Button';

import { OperationalGrid, type OperationalColumn } from '@/components/data/OperationalGrid';
import { FilterToolbar } from '@/components/filters/FilterToolbar';
import {
  MuiEmptyState,
  MuiSearchStates,
  type NoResultsReason,
} from '@/components/states/MuiStates';
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
import { CustomerWords, Distance, Section, VehicleWords, WarrantyStatusLabel } from './shared';

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
 * ## The car and the customer are named
 *
 * `wty.warranty-list` carries a `vehicle` block and a `customer` block on every
 * row, resolved by the backend for the whole page (route sweep B2). The vehicle
 * column says the plate and the make and model — or the display number — and
 * the customer column the party who brought the car in. Both say in words when
 * the value is withheld or absent, and neither ever prints a reference.
 *
 * ## A refusal is never drawn as an empty branch
 *
 * The whole outcome is kept, not flattened into rows, so "you may not see these"
 * and "this branch has issued none" stay two different sentences with two
 * different next steps.
 *
 * ## On the shared Material wrappers (ADR-022)
 *
 * The box is `FilterToolbar`'s search, the rows are `OperationalGrid` over the
 * same `useSearchRequest(...).table` (server mode, no count, the cursor footer),
 * and every state other than an answer is `MuiSearchStates` — or `MuiEmptyState`
 * for a read with nothing narrowing it. Nothing about how the list reads changed:
 * the same criteria, the same read, the same working-context version key, so a
 * branch switch still drops a late answer for the branch left.
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
  searchesCustomers = true,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  /** From the address, when the screen was reached from a vehicle. Filters on arrival. */
  readonly initialVehicleId: string | null;
  /**
   * Whether the server matches the box against a customer's name and phone for
   * this account (`crm.customer.read`). Without it an empty search says it was
   * matched on fewer details rather than that nothing exists.
   */
  readonly searchesCustomers?: boolean;
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
    // A read with no term and no vehicle is the branch as it is (G10).
    narrows: (criteria) => Object.keys(criteria.filters).length > 0,
  });

  const clearFilters = () => {
    setVehicleId(null);
    setTerm('');
  };

  const blocked =
    branch.kind === 'unchosen' || branch.kind === 'none' || branch.kind === 'unavailable';
  const spansCompanies = branch.kind === 'all' && scope === null;
  const spansBranches = branch.kind === 'all';

  const columns = useMemo<readonly OperationalColumn<WarrantyListRow>[]>(
    () => [
      {
        id: 'policy',
        headerKey: 'warranty.list.columnPolicy',
        flex: 1.4,
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
      /*
       * Passed only while the list spans branches (G7): under one branch the
       * column would repeat the header's own answer on every row. The name, never
       * the identifier: a reference here would be a second thing to look up.
       */
      ...(spansBranches
        ? [
            {
              id: 'branch',
              headerKey: 'warranty.list.columnBranch',
              cell: (row: WarrantyListRow) => <bdi>{context.branchName(row.branchId) ?? ''}</bdi>,
            },
          ]
        : []),
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
        cell: (row) => <VehicleWords messages={messages} vehicle={row.vehicle} />,
      },
      {
        id: 'customer',
        headerKey: 'warranty.list.columnCustomer',
        cell: (row) => (
          <CustomerWords locale={locale} messages={messages} customer={row.customer} />
        ),
      },
    ],
    [context, locale, messages, spansBranches]
  );

  /*
   * What an empty answer says narrowed it (S5): the term — for an account the
   * server does not match on a customer's name or phone, said as such — or the
   * one-vehicle filter that arrived with the address.
   */
  const emptyReason: NoResultsReason = termIsSearchable
    ? searchesCustomers
      ? 'search'
      : 'searchLimited'
    : 'filters';

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
        <div className="flex flex-col gap-3">
          {/*
            The branch is STATED, not asked. A second editable control here would
            be a second authority for the same fact.
          */}
          <div className="max-w-md">
            <WorkingBranchField
              messages={messages}
              testId="warranty-branch-target"
              acceptsAllBranches
            />
          </div>
          {/*
            The one box, on the shared toolbar (T1): the term goes to the server
            as typed — Arabic-Indic digits included, which the server folds, and
            which the echo under the box shows as Latin — the read hook's pause
            and Enter decide when, Escape clears, and nothing reaches the address.
          */}
          <FilterToolbar
            messages={messages}
            label={translate(messages, 'warranty.filter.heading')}
            testId="warranty-list-toolbar"
            search={{
              label: translate(messages, 'warranty.filter.searchLabel'),
              placeholder: translate(messages, 'warranty.filter.searchPlaceholder'),
              example: translate(messages, 'warranty.filter.searchExample'),
              value: term,
              onChange: setTerm,
              onSubmit: search.submit,
              busy: search.phase === 'loading',
              maxLength: MAX_WARRANTY_SEARCH,
              error: termTooShort
                ? translate(messages, 'warranty.filter.searchTooShort')
                : undefined,
              echoDigits: true,
            }}
          />
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
            <Button
              type="button"
              variant="outlined"
              size="small"
              onClick={() => setVehicleId(null)}
            >
              {translate(messages, 'warranty.filter.showAllVehicles')}
            </Button>
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
            Every state other than an answer, on the shared Material states: an
            ended session is said as itself with the way back to signing in and no
            retry; an outage (a throttled or unanswered read included) or a fault
            offers Try again; a refusal is never drawn as an empty branch; and an
            empty answer names what narrowed it.
          */}
          {search.phase === 'empty' && search.table.narrowed !== true ? (
            // Nothing typed and no vehicle named: the branch as it is. An empty
            // answer there is "nothing here yet", never "no matches" (G10).
            <MuiEmptyState messages={messages} />
          ) : (
            <MuiSearchStates
              messages={messages}
              locale={locale}
              phase={search.phase}
              correlationId={search.correlationId}
              emptyReason={emptyReason}
              onRetry={search.submit}
              onClearFilters={
                search.phase === 'empty' && (termIsSearchable || vehicleId !== null) ? (
                  <Button type="button" variant="outlined" size="small" onClick={clearFilters}>
                    {translate(messages, 'warranty.filter.clearFilters')}
                  </Button>
                ) : undefined
              }
            />
          )}

          {search.phase === 'ready' ? (
            <OperationalGrid<WarrantyListRow>
              messages={messages}
              locale={locale}
              label={translate(messages, 'warranty.list.tableCaption')}
              columns={columns}
              rowId={(row) => row.id}
              table={search.table}
              /*
               * The filters live outside `TableRequest`, so the grid's own empty
               * state would claim something about the whole branch on the
               * evidence of one filter. `MuiSearchStates` says it instead.
               */
              suppressEmptyState
              testId="warranty-list-grid"
            />
          ) : null}
        </Section>
      )}
    </div>
  );
}
