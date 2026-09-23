'use client';

import { useCallback, useId, useState } from 'react';

import { INITIAL_REQUEST } from '@/components/data-table/table-state';
import { SearchBox } from '@/components/search/SearchBox';
import { SearchStates } from '@/components/search/SearchStates';
import { SessionExpiredState } from '@/components/states/States';
import { RequiresConcreteBranch } from '@/features/working-context/components/WorkingBranchField';
import { useBranchTarget } from '@/features/working-context/use-branch-target';
import { useWorkingContext } from '@/features/working-context/WorkingContextProvider';
import type { Messages } from '@/i18n/get-messages';
import { translate } from '@/i18n/get-messages';
import type { CursorPage, ReadState } from '@/lib/api/read-operation';
import { useSearchRequest } from '@/lib/api/use-search-request';

import { listWorkOrders } from '../api';
import {
  MAX_WORK_ORDER_SEARCH,
  MIN_WORK_ORDER_SEARCH,
  type WorkOrderListEntry,
} from '../work-orders-contract';

/**
 * One work order, FOUND and chosen rather than typed (Owner directive,
 * `P1-32-PRE-OD-UX`).
 *
 * ## What it replaces
 *
 * The quotation builder and the invoice desk opened on a box labelled "Work
 * order identifier" and refused anything that was not shaped like one. A
 * work-order reference is a 36-character string that appears on no printed
 * document and on no other screen, so the only way to fill that box in was to
 * copy one out of the address bar of a different page.
 *
 * `wo.work-order-list` already answers the question those screens were really
 * asking: which of this branch's jobs do you mean. It takes one free-text `q`
 * over the work-order number, a party's name, any plate the vehicle has carried
 * and its chassis number — the things somebody standing at a counter holds.
 *
 * ## The search is the server's, and it never reaches the address
 *
 * `useSearchRequest` sends one read per pause and discards a superseded answer,
 * so a slow reply for "WO-1" cannot land under "WO-12". The term lives in
 * memory only: a customer's name in a query string is in browser history and in
 * every proxy log between here and the operator. The CHOSEN job is what the
 * caller puts in the address, and that is a record reference, not a search.
 *
 * ## The scope is the working context's, exactly as the board's
 *
 * The company travels, and the branch travels when the operator is working in
 * one; "All my branches" inside one company is the union the server enforces on
 * the board. "All my branches" spanning more than one company resolves to no
 * scope at all, because `companyId` is mandatory on the read and there is no
 * honest single answer — the operator is told to choose one branch.
 *
 * ## Permission-aware
 *
 * Without `wo.work_order.read` the read would be refused every time, so the
 * picker offers no box: it says the job cannot be looked up here, and the
 * caller offers no submit. A refusal that arrives anyway (a revoked grant) is
 * rendered as a refusal, never as "no matches".
 *
 * ## It is not a `<form>`
 *
 * Both callers render it inside their own form. Every button here is
 * `type="button"`, and Enter in the box searches rather than submitting the
 * caller's form with nothing chosen.
 */
export function WorkOrderPicker({
  messages,
  label,
  value,
  onChange,
  error,
  canSearch,
  testId = 'work-order-picker',
}: {
  readonly messages: Messages;
  /** The question this picker asks. Supplied by the caller — see `SearchBox`. */
  readonly label: string;
  /** The chosen work order, or null. */
  readonly value: WorkOrderListEntry | null;
  readonly onChange: (next: WorkOrderListEntry | null) => void;
  /** The caller's own refusal — nothing chosen yet, for instance. */
  readonly error?: string | undefined;
  /** `wo.work_order.read` — whether a search can be answered at all. */
  readonly canSearch: boolean;
  readonly testId?: string;
}) {
  const base = useId();
  const context = useWorkingContext();
  const branch = useBranchTarget();
  const [term, setTerm] = useState('');

  const scope =
    branch.kind === 'ready'
      ? { companyId: branch.target.companyId, branchId: branch.target.branchId }
      : branch.kind === 'all' && context.selection?.companyId
        ? { companyId: context.selection.companyId, branchId: null }
        : null;

  const trimmed = term.trim();
  const tooShort = trimmed.length > 0 && trimmed.length < MIN_WORK_ORDER_SEARCH;
  const criteria =
    canSearch && value === null && scope !== null && trimmed.length >= MIN_WORK_ORDER_SEARCH
      ? { companyId: scope.companyId, branchId: scope.branchId, q: trimmed }
      : null;

  const load = useCallback(
    async (
      asked: { readonly companyId: string; readonly branchId: string | null; readonly q: string },
      cursor: string | null
    ): Promise<ReadState<CursorPage<WorkOrderListEntry>>> => {
      const page = await listWorkOrders(
        { companyId: asked.companyId, branchId: asked.branchId },
        { q: asked.q },
        { ...INITIAL_REQUEST, pageSize: 10 },
        cursor
      );
      if (page.status !== 'ok') return { status: page.status, correlationId: page.correlationId };
      return {
        status: 'ok',
        data: { items: page.rows, nextCursor: page.nextCursor, hasMore: page.hasMore },
        correlationId: page.correlationId,
      };
    },
    []
  );

  const search = useSearchRequest({ criteria, load, version: context.version });

  /** What an operator recognises a job by: its number, then the vehicle, then the party. */
  const labelOf = (entry: WorkOrderListEntry): string => {
    const parts = [
      entry.displayNumber ?? translate(messages, 'workOrders.picker.unnumbered'),
      entry.vehicle.registrationPlate ?? entry.vehicle.makeModel ?? null,
      entry.customer?.displayName ?? null,
    ].filter((part): part is string => typeof part === 'string' && part.length > 0);
    return parts.join(' — ');
  };

  const heading = (
    <span id={`${base}-label`} className="text-label font-medium text-text-primary">
      {label}
    </span>
  );

  if (!canSearch) {
    return (
      <div className="flex flex-col gap-1.5" data-testid={testId}>
        {heading}
        <p role="status" className="text-supporting text-text-secondary">
          {translate(messages, 'workOrders.picker.notPermitted')}
        </p>
      </div>
    );
  }

  if (value !== null) {
    return (
      <div className="flex flex-col gap-1.5" data-testid={testId}>
        {heading}
        <div
          aria-labelledby={`${base}-label`}
          role="group"
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2"
        >
          <bdi className="text-body text-text-primary" data-testid={`${testId}-chosen`}>
            {labelOf(value)}
          </bdi>
          <button
            type="button"
            onClick={() => {
              onChange(null);
              setTerm('');
            }}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {translate(messages, 'workOrders.picker.change')}
          </button>
        </div>
      </div>
    );
  }

  if (scope === null) {
    return (
      <div className="flex flex-col gap-1.5" data-testid={testId}>
        {heading}
        {/* "All my branches" across companies says "choose one branch"; the rest say their own reason. */}
        <RequiresConcreteBranch
          messages={messages}
          state={branch}
          testId={`${testId}-needs-branch`}
        />
      </div>
    );
  }

  const shownError = tooShort ? translate(messages, 'workOrders.picker.tooShort') : error;
  const retry = (
    <button
      type="button"
      onClick={search.submit}
      className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
    >
      {translate(messages, 'state.retry')}
    </button>
  );

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <SearchBox
        messages={messages}
        label={label}
        placeholder={translate(messages, 'workOrders.picker.searchPlaceholder')}
        example={translate(messages, 'workOrders.picker.searchExample')}
        value={term}
        onChange={setTerm}
        onSubmit={search.submit}
        busy={search.phase === 'loading'}
        maxLength={MAX_WORK_ORDER_SEARCH}
        error={shownError}
        testId={`${testId}-search`}
      />
      {search.phase === 'idle' ? null : (
        <div aria-live="polite" className="flex flex-col gap-3">
          {search.phase === 'failed' && search.error === 'state.expired.message' ? (
            // No retry: the same request on the same ended session fails the same way.
            <SessionExpiredState messages={messages} />
          ) : search.phase !== 'ready' ? (
            <SearchStates
              messages={messages}
              phase={search.phase}
              correlationId={search.correlationId}
              {...(search.phase === 'unavailable' || search.phase === 'failed' ? { retry } : {})}
            />
          ) : (
            <ul
              aria-label={translate(messages, 'workOrders.picker.results')}
              className="flex flex-col divide-y divide-border rounded-md border border-border"
            >
              {search.rows.map((entry) => (
                <li key={entry.id}>
                  <button
                    // Choosing a job must not submit the caller's form.
                    type="button"
                    onClick={() => {
                      onChange(entry);
                      setTerm('');
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2 text-start text-body text-text-primary transition-colors duration-fast ease-standard hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    <bdi>{labelOf(entry)}</bdi>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {search.phase === 'ready' && (search.hasMore || search.pageNumber > 1) ? (
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={search.pageNumber <= 1}
                onClick={search.previous}
                className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {translate(messages, 'table.previousPage')}
              </button>
              <button
                type="button"
                disabled={!search.hasMore}
                onClick={search.next}
                className="rounded-md border border-border px-3 py-1.5 text-body text-text-primary disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {translate(messages, 'table.nextPage')}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
